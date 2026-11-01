// Rutas /api/* con Request/Response estándar: las usan el servidor local
// (server.js) y la función de Netlify (netlify/functions/api.mjs).
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { comparar, TIENDAS } from './comparador.js';
import { guardarLista, leerLista, novedades, registrarSiEstaEnLista } from './monitor.js';

const DIAS_SESION = 30;
let secretoTemporal;

function config() {
  return {
    clave: process.env.APP_PASSWORD || '',
    secreto: process.env.SESSION_SECRET || (secretoTemporal ??= randomBytes(32).toString('hex')),
  };
}

// ── Sesión: cookie firmada "vence.firma" ────────────────────────────────────
function firmar(valor) {
  return createHmac('sha256', config().secreto).update(valor).digest('base64url');
}

function crearSesion() {
  const vence = String(Date.now() + DIAS_SESION * 86_400_000);
  return `${vence}.${firmar(vence)}`;
}

function sesionValida(request) {
  const cookie = (request.headers.get('cookie') || '').split(/;\s*/).find((c) => c.startsWith('mp='));
  if (!cookie) return false;
  const [vence, firma] = cookie.slice(3).split('.');
  if (!vence || !firma || Number(vence) < Date.now()) return false;
  const esperada = Buffer.from(firmar(vence));
  const recibida = Buffer.from(firma);
  return esperada.length === recibida.length && timingSafeEqual(esperada, recibida);
}

function claveCorrecta(intento) {
  const a = createHash('sha256').update(String(intento)).digest();
  const b = createHash('sha256').update(config().clave).digest();
  return timingSafeEqual(a, b);
}

// Máximo 10 intentos de contraseña cada 15 minutos por IP. En Netlify cada
// instancia de la función lleva su propia cuenta, así que es un freno parcial.
const intentos = new Map();
function bloqueado(ip) {
  const ahora = Date.now();
  const lista = (intentos.get(ip) || []).filter((t) => ahora - t < 15 * 60_000);
  intentos.set(ip, lista);
  return lista.length >= 10;
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
  if (texto.length > limite) throw new Error('Cuerpo demasiado grande');
  return texto ? JSON.parse(texto) : {};
}

export async function manejarApi(request, { ip = '', https = false } = {}) {
  const url = new URL(request.url);
  const ruta = url.pathname;
  try {
    if (ruta === '/api/salud') return json(200, { ok: true });

    if (!config().clave) return json(500, { error: 'Falta configurar APP_PASSWORD en el servidor' });

    if (ruta === '/api/sesion' && request.method === 'GET') return json(200, { ok: sesionValida(request) });

    if (ruta === '/api/entrar' && request.method === 'POST') {
      if (bloqueado(ip)) return json(429, { error: 'Demasiados intentos. Espera 15 minutos.' });
      const { clave } = await leerJson(request);
      if (!claveCorrecta(clave || '')) {
        intentos.get(ip).push(Date.now());
        return json(401, { error: 'Contraseña incorrecta' });
      }
      const cookie = `mp=${crearSesion()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DIAS_SESION * 86400}${https ? '; Secure' : ''}`;
      return json(200, { ok: true }, { 'set-cookie': cookie });
    }

    if (ruta === '/api/salir' && request.method === 'POST') {
      return json(200, { ok: true }, { 'set-cookie': 'mp=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' });
    }

    if (!sesionValida(request)) return json(401, { error: 'Inicia sesión' });

    if (ruta === '/api/tiendas') return json(200, { tiendas: TIENDAS.map((t) => t.tienda) });

    if (ruta === '/api/buscar') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2 || q.length > 80) return json(400, { error: 'Escribe entre 2 y 80 caracteres' });
      const datos = await comparar(q);
      // Si es un producto de la lista, la búsqueda también alimenta el monitoreo.
      await registrarSiEstaEnLista(q, datos).catch((error) => console.error('[monitor]', error.message));
      return json(200, datos);
    }

    if (ruta === '/api/lista' && request.method === 'GET') return json(200, { lista: await leerLista() });

    if (ruta === '/api/lista' && request.method === 'PUT') {
      const { lista } = await leerJson(request, 50_000);
      try {
        return json(200, { lista: await guardarLista(lista) });
      } catch (error) {
        if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: error.message });
        throw error;
      }
    }

    if (ruta === '/api/monitoreo') {
      const desde = Number(url.searchParams.get('desde')) || 0;
      return json(200, await novedades(desde));
    }

    return json(404, { error: 'No encontrado' });
  } catch (error) {
    console.error(error);
    return json(500, { error: 'Error interno' });
  }
}
