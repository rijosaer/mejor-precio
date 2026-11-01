// Rutas /api/* con Request/Response estándar: las usan el servidor local
// (server.js) y la función de Netlify (netlify/functions/api.mjs).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { actualizar, enBlobs, leer } from './almacen.js';
import { catalogoTiendas, comparar, estadoTiendas } from './comparador.js';
import { guardarAjustesCompartidos, guardarConfig, leerAjustesCompartidos, leerConfig } from './config.js';
import { borrarMovimiento, leerMovimientos, registrarMovimiento } from './inventario.js';
import { guardarLista, leerLista, novedades, registrarBusqueda, revisarSalud } from './monitor.js';
import { analizarProducto, aplicarPropuesta, descartarPropuesta, deshacerCambio, estadoMiTienda, guardarCostos, guardarMargenes, proponerTodos, sincronizarTrivo } from './mitienda.js';
import { borrarProveedor, guardarProveedor, leerProveedores } from './proveedores.js';
import { clavePublica, desuscribir, enviar, pushActivo, suscribir, suscripciones } from './push.js';

const DIAS_SESION = 30;
const MAX_INTENTOS = 10;
const VENTANA_INTENTOS = 15 * 60_000;
let secretoTemporal;

function config() {
  return {
    clave: process.env.APP_PASSWORD || '',
    secreto: process.env.SESSION_SECRET || (secretoTemporal ??= randomBytes(32).toString('hex')),
  };
}

// ── Sesión: cookie firmada "vence.firma" ────────────────────────────────────
// La firma incluye un resumen de la contraseña: al cambiar APP_PASSWORD todas
// las sesiones abiertas dejan de valer.
function firmar(valor) {
  const { clave, secreto } = config();
  const huella = createHash('sha256').update(`mp|${clave}`).digest('base64url');
  return createHmac('sha256', secreto).update(`${valor}.${huella}`).digest('base64url');
}

function crearSesion() {
  const vence = String(Date.now() + DIAS_SESION * 86_400_000);
  return `${vence}.${firmar(vence)}`;
}

function sesionValida(request) {
  const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith('mp='));
  if (!cookie) return false;
  const [vence, firma] = cookie.slice(3).split('.');
  if (!vence || !firma || !/^\d+$/.test(vence) || Number(vence) < Date.now()) return false;
  const esperada = Buffer.from(firmar(vence));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function claveCorrecta(intento) {
  const a = createHash('sha256').update(String(intento)).digest();
  const b = createHash('sha256').update(config().clave).digest();
  return timingSafeEqual(a, b);
}

// ── Límite de intentos de contraseña ───────────────────────────────────────
// 10 intentos fallidos cada 15 minutos por IP. Se cuenta en memoria y, en
// Netlify, también en Blobs: así vale para todas las instancias de la función.
const intentos = new Map();
const huellaIp = (ip) => createHash('sha256').update(`ip|${ip}`).digest('hex').slice(0, 16);

function vigentes(lista, ahora) {
  return (lista || []).filter((t) => ahora - t < VENTANA_INTENTOS);
}

async function bloqueado(ip) {
  const ahora = Date.now();
  // Se limpian las IP viejas para que el mapa no crezca sin fin.
  for (const [k, v] of intentos) if (!vigentes(v, ahora).length) intentos.delete(k);
  let lista = vigentes(intentos.get(ip), ahora);
  if (enBlobs()) {
    const guardados = vigentes(((await leer('intentos')) || {})[huellaIp(ip)], ahora);
    if (guardados.length > lista.length) lista = guardados;
  }
  return lista.length >= MAX_INTENTOS;
}

async function anotarFallo(ip) {
  const ahora = Date.now();
  intentos.set(ip, [...vigentes(intentos.get(ip), ahora), ahora]);
  if (!enBlobs()) return;
  await actualizar('intentos', (actual) => {
    const doc = {};
    for (const [k, v] of Object.entries(actual || {})) {
      const quedan = vigentes(v, ahora);
      if (quedan.length) doc[k] = quedan;
    }
    doc[huellaIp(ip)] = [...(doc[huellaIp(ip)] || []), ahora].slice(-MAX_INTENTOS * 2);
    return doc;
  });
}

// ── Respuestas ──────────────────────────────────────────────────────────────
function json(estado, datos, extra = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extra,
    },
  });
}

async function leerJson(request, limite = 10_000) {
  const texto = await request.text();
  if (texto.length > limite) throw new RangeError('Cuerpo demasiado grande');
  try {
    return texto ? JSON.parse(texto) : {};
  } catch {
    throw new TypeError('JSON no válido');
  }
}

// Errores de validación (TypeError / RangeError) → 400 con su mensaje.
async function validar(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: error.message });
    throw error;
  }
}

const listaDeIds = (texto) =>
  texto
    ? String(texto)
        .split(',')
        .map((x) => x.trim())
        .filter((x) => /^[\w-]{1,50}$/.test(x))
    : undefined;

export async function manejarApi(request, { ip = '', https = false } = {}) {
  const url = new URL(request.url);
  const ruta = url.pathname;
  const metodo = request.method;
  try {
    if (ruta === '/api/salud') return json(200, { ok: true });

    if (!config().clave) return json(500, { error: 'Falta configurar APP_PASSWORD en el servidor' });

    if (ruta === '/api/sesion' && metodo === 'GET') return json(200, { ok: sesionValida(request) });

    if (ruta === '/api/entrar' && metodo === 'POST') {
      if (await bloqueado(ip)) return json(429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      return validar(async () => {
        const { clave } = await leerJson(request);
        if (!claveCorrecta(clave || '')) {
          await anotarFallo(ip);
          return json(401, { error: 'Contraseña incorrecta' });
        }
        const cookie = `mp=${crearSesion()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}${https ? '; Secure' : ''}`;
        return json(200, { ok: true }, { 'set-cookie': cookie });
      });
    }

    if (ruta === '/api/salir' && metodo === 'POST') {
      return json(200, { ok: true }, { 'set-cookie': 'mp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    }

    if (!sesionValida(request)) return json(401, { error: 'Inicia sesión' });

    // Las rutas que cambian datos exigen JSON: un formulario de otro sitio no
    // puede mandar ese tipo sin permiso del navegador (CORS).
    if (!['GET', 'HEAD'].includes(metodo) && !(request.headers.get('content-type') || '').includes('application/json')) {
      return json(415, { error: 'Se esperaba JSON' });
    }

    if (ruta === '/api/tiendas') return json(200, { tiendas: await catalogoTiendas() });

    if (ruta === '/api/estado-tiendas') {
      if (metodo === 'POST') await revisarSalud({ forzar: true });
      return json(200, { tiendas: estadoTiendas(), control: await leer('salud') });
    }

    if (ruta === '/api/buscar') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2 || q.length > 80) return json(400, { error: 'Escribe entre 2 y 80 caracteres' });
      const { miTienda } = await leerConfig();
      const datos = await comparar(q, { tiendas: listaDeIds(url.searchParams.get('tiendas')), miTienda });
      // La búsqueda queda en el historial del servidor (y, si es de la lista, alimenta el monitoreo).
      datos.series = await registrarBusqueda(q, datos).catch((error) => (console.error('[historial]', error.message), {}));
      return json(200, datos);
    }

    if (ruta === '/api/lista' && metodo === 'GET') return json(200, { lista: await leerLista() });
    if (ruta === '/api/lista' && metodo === 'PUT') {
      return validar(async () => {
        const { lista } = await leerJson(request, 60_000);
        return json(200, { lista: await guardarLista(lista) });
      });
    }

    if (ruta === '/api/monitoreo') {
      const desde = Number(url.searchParams.get('desde')) || 0;
      const [datos, config, ajustes] = await Promise.all([novedades(desde), leerConfig(), leerAjustesCompartidos()]);
      return json(200, { ...datos, config, ajustes });
    }

    // Ajustes del monitoreo (frecuencia, tiendas, silencio).
    if (ruta === '/api/config' && metodo === 'GET') return json(200, { config: await leerConfig() });
    if (ruta === '/api/config' && metodo === 'PUT') {
      return validar(async () => json(200, { config: await guardarConfig((await leerJson(request)).config || {}) }));
    }

    // Copia compartida de los ajustes del navegador.
    if (ruta === '/api/ajustes' && metodo === 'GET') return json(200, { ajustes: await leerAjustesCompartidos() });
    if (ruta === '/api/ajustes' && metodo === 'PUT') {
      return validar(async () => {
        const { ajustes, t } = await leerJson(request, 40_000);
        return json(200, { ajustes: await guardarAjustesCompartidos(ajustes, t) });
      });
    }

    // Notificaciones push.
    if (ruta === '/api/push' && metodo === 'GET') {
      return json(200, { activo: pushActivo(), clave: clavePublica(), suscripciones: (await suscripciones()).length });
    }
    if (ruta === '/api/push/suscribir' && metodo === 'POST') {
      if (!pushActivo()) return json(503, { error: 'Faltan las claves VAPID en el servidor' });
      return validar(async () => {
        const { suscripcion, etiqueta } = await leerJson(request);
        await suscribir(suscripcion, etiqueta);
        return json(200, { ok: true });
      });
    }
    if (ruta === '/api/push/quitar' && metodo === 'POST') {
      const { endpoint } = await leerJson(request);
      await desuscribir(String(endpoint || ''));
      return json(200, { ok: true });
    }
    if (ruta === '/api/push/probar' && metodo === 'POST') {
      const r = await enviar({ title: 'Mejor Precio', body: 'Así se ven los avisos de precio en este teléfono.', url: '/', tag: 'mp-prueba' });
      return json(200, r);
    }

    // Inventario y ventas.
    if (ruta === '/api/movimientos' && metodo === 'GET') return json(200, { movimientos: await leerMovimientos() });
    if (ruta === '/api/movimientos' && metodo === 'POST') {
      return validar(async () => json(200, await registrarMovimiento(await leerJson(request), await leerLista())));
    }
    if (ruta === '/api/movimientos' && metodo === 'DELETE') {
      return json(200, { movimientos: await borrarMovimiento(String(url.searchParams.get('id') || '')) });
    }

    // Mi tienda: la carta propia frente al mercado.
    if (ruta === '/api/mi-tienda' && metodo === 'GET') return json(200, await estadoMiTienda());
    if (ruta === '/api/mi-tienda/comparar' && metodo === 'POST') {
      return validar(async () => json(200, { resultado: await analizarProducto(String((await leerJson(request)).id || '')) }));
    }
    if (ruta === '/api/mi-tienda/costos' && metodo === 'PUT') {
      return validar(async () => json(200, { costos: await guardarCostos((await leerJson(request, 40_000)).costos) }));
    }

    // TRIVO (solo lectura): costos reales, existencias y ventas de 30 días.
    if (ruta === '/api/mi-tienda/trivo' && metodo === 'POST') {
      return validar(async () => {
        try {
          await sincronizarTrivo();
        } catch (error) {
          if (error instanceof TypeError) throw error;
          console.error('[trivo]', error.message);
          return json(502, { error: `No se pudo leer TRIVO: ${error.message}` });
        }
        return json(200, await estadoMiTienda());
      });
    }

    // Precios con tu margen: propuestas que solo se aplican en TRIVO con tu aprobación.
    if (ruta === '/api/mi-tienda/margen' && metodo === 'PUT') {
      return validar(async () => json(200, { margenes: await guardarMargenes(await leerJson(request, 40_000)) }));
    }
    if (ruta === '/api/mi-tienda/propuestas' && metodo === 'POST') {
      return validar(async () => {
        await proponerTodos();
        return json(200, await estadoMiTienda());
      });
    }
    if (ruta === '/api/mi-tienda/propuestas' && metodo === 'DELETE') {
      await descartarPropuesta(String(url.searchParams.get('id') || ''));
      return json(200, await estadoMiTienda());
    }
    for (const [camino, accion] of [['/api/mi-tienda/aplicar', aplicarPropuesta], ['/api/mi-tienda/deshacer', deshacerCambio]]) {
      if (ruta !== camino || metodo !== 'POST') continue;
      return validar(async () => {
        const { id } = await leerJson(request);
        try {
          await accion(String(id || ''));
        } catch (error) {
          if (error instanceof TypeError) throw error;
          console.error('[trivo precio]', error.message);
          return json(502, { error: error.message });
        }
        return json(200, await estadoMiTienda());
      });
    }

    // Proveedores propios (sin página web).
    if (ruta === '/api/proveedores' && metodo === 'GET') return json(200, { proveedores: await leerProveedores() });
    if (ruta === '/api/proveedores' && metodo === 'PUT') {
      return validar(async () => {
        const { proveedor } = await leerJson(request, 400_000);
        return json(200, { proveedores: await guardarProveedor(proveedor) });
      });
    }
    if (ruta === '/api/proveedores' && metodo === 'DELETE') {
      return json(200, { proveedores: await borrarProveedor(String(url.searchParams.get('id') || '')) });
    }

    return json(404, { error: 'No encontrado' });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
