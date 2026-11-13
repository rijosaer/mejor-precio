// La caja de la tienda pública: el cliente arma su pedido en nuestra página y
// aquí se manda a TRIVO por la misma entrada que usa la carta de Agua Pure
// (`/api/public/menu/agua-pure/order/`). Así el pedido cae en TRIVO igual que
// si lo hubieran hecho en la carta, con su número, y el cliente ve en qué va.
//
// No es una API que TRIVO publique para otros: si la cambian, el pedido
// falla con `sinTrivo` y la página ofrece mandarlo completo por WhatsApp.
// El navegador no puede hablar con TRIVO directo (TRIVO no permite otros
// dominios), por eso todo pasa por este servidor.
import { cargarCarta, nombreVariante, nombreVisible } from './tienda.js';
import { BASE, SLUG } from './tiendas/aguapure.js';

const ENTRADA = `${BASE}/api/public/menu/${SLUG}`;
const AGENTE = 'Mozilla/5.0 (compatible; TiendaAguaPure/1.0)';

// ── Límite por IP: un pedido de verdad no necesita más ───────────────────────
const VENTANA = 15 * 60_000;
const LIMITES = { pedido: 6, consulta: 150 };
const usos = new Map();

function pasaLimite(ip, tipo, ahora = Date.now()) {
  const clave = `${tipo}:${ip}`;
  const lista = (usos.get(clave) || []).filter((t) => ahora - t < VENTANA);
  if (lista.length >= LIMITES[tipo]) return false;
  lista.push(ahora);
  usos.set(clave, lista);
  if (usos.size > 5000) for (const [k, v] of usos) if (!v.some((t) => ahora - t < VENTANA)) usos.delete(k);
  return true;
}

// ── TRIVO ────────────────────────────────────────────────────────────────────
export class SinTrivo extends Error {}

async function aTrivo(ruta, { metodo = 'GET', cuerpo, consulta, tiempo = 8000 } = {}) {
  const url = new URL(`${ENTRADA}/${ruta}`);
  for (const [k, v] of Object.entries(consulta || {})) if (v != null) url.searchParams.set(k, String(v));
  let res;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { accept: 'application/json', 'user-agent': AGENTE, ...(cuerpo ? { 'content-type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      signal: AbortSignal.timeout(tiempo),
    });
  } catch (error) {
    throw new SinTrivo(error.name === 'TimeoutError' ? 'TRIVO tardó en responder' : `TRIVO no respondió: ${error.message}`);
  }
  let datos = null;
  try {
    datos = await res.json();
  } catch {
    throw new SinTrivo(`TRIVO respondió algo que no es JSON (HTTP ${res.status})`);
  }
  return { ok: res.ok, estado: res.status, datos: datos?.data ?? datos };
}

// ── Medios de pago (los mismos de la carta), 10 minutos en memoria ───────────
let pagosEnMemoria = null;

export async function mediosDePago({ ahora = Date.now() } = {}) {
  if (pagosEnMemoria && ahora - pagosEnMemoria.t < 10 * 60_000) return pagosEnMemoria.lista;
  const r = await aTrivo('payment-methods/');
  if (!r.ok || !Array.isArray(r.datos)) throw new SinTrivo(`Medios de pago: HTTP ${r.estado}`);
  const lista = r.datos
    .filter((m) => m && Number.isInteger(m.id) && m.name)
    .map((m) => ({ id: m.id, nombre: String(m.name), tipo: String(m.type || ''), cuenta: m.account_number ? String(m.account_number) : null }));
  pagosEnMemoria = { t: ahora, lista };
  return lista;
}

// ── El pedido ────────────────────────────────────────────────────────────────
const texto = (x, max) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

// «300 123 4567», «+57 300…» o «57300…» → «3001234567».
export function celularLocal(x) {
  let n = String(x ?? '').replace(/\D/g, '');
  if (n.length === 12 && n.startsWith('57')) n = n.slice(2);
  return /^3\d{9}$/.test(n) ? n : null;
}

const coordenada = (x, min, max) => {
  if (x === null || x === undefined || x === '') return null;
  const n = Number(x);
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n * 1e6) / 1e6 : null;
};

function productoDe(carta, id) {
  for (const s of carta.secciones) {
    const p = s.productos.find((x) => x.id === id);
    if (p) return p;
  }
  return null;
}

// Revisa el pedido contra la carta de hoy y arma lo que espera TRIVO. Los
// precios no los manda el navegador: salen de la carta (y TRIVO los vuelve a
// calcular). Los errores son TypeError con un mensaje para el cliente.
export function armarPedido(carta, entrada, pagos = []) {
  if (!carta?.secciones?.length) throw new SinTrivo('No hay carta');
  const e = entrada && typeof entrada === 'object' ? entrada : {};
  const clave = String(e.clave || '');
  if (!/^[0-9a-f-]{20,40}$/i.test(clave)) throw new TypeError('Falta la clave del pedido');

  const lineas = Array.isArray(e.lineas) ? e.lineas : [];
  if (!lineas.length) throw new TypeError('Tu pedido está vacío');
  if (lineas.length > 40) throw new TypeError('El pedido tiene demasiados productos');
  let subtotal = 0;
  const items = lineas.map((l) => {
    const id = Number(l?.id);
    const cantidad = Number(l?.cantidad);
    const p = Number.isInteger(id) ? productoDe(carta, id) : null;
    if (!p) throw new TypeError('Uno de los productos ya no está en la carta. Revisa tu pedido.');
    if (!p.disponible) throw new TypeError(`${p.nombre} está agotado por ahora. Quítalo para seguir.`);
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 99) throw new TypeError(`Revisa la cantidad de ${p.nombre}`);
    let variante = null;
    if (p.variantes.length) {
      variante = p.variantes.find((v) => v.id === Number(l?.variante));
      if (!variante) throw new TypeError(`Escoge la presentación de ${p.nombre}`);
    }
    subtotal += (variante ? variante.precio : p.precio) * cantidad;
    return { product_id: p.id, variant_id: variante ? variante.id : null, quantity: cantidad, modifiers: [] };
  });
  const minimo = carta.pedidos.minimo || 0;
  if (subtotal < minimo) throw new TypeError(`El pedido mínimo es de $ ${minimo.toLocaleString('es-CO')}`);

  const nombre = texto(e.nombre, 80);
  if (nombre.length < 2) throw new TypeError('Escribe tu nombre');
  const celular = celularLocal(e.celular);
  if (!celular) throw new TypeError('Escribe un celular de 10 dígitos (empieza por 3)');
  const direccion = texto(e.direccion, 200);
  if (direccion.length < 5) throw new TypeError('Escribe la dirección de entrega');
  const indicaciones = texto(e.indicaciones, 300);

  let pago = null;
  if (pagos.length) {
    pago = pagos.find((m) => m.id === Number(e.pago));
    if (!pago) throw new TypeError('Escoge cómo vas a pagar');
  }

  const lat = coordenada(e.lat, -5, 15);
  const lng = coordenada(e.lng, -82, -66);
  const pedido = {
    idempotency_key: clave,
    branch_code: carta.sucursal || undefined,
    service_type: 'delivery',
    // Para que en TRIVO se sepa cuáles llegan por la página.
    notes: [indicaciones, 'Pedido hecho en la página web'].filter(Boolean).join(' · '),
    customer: { name: nombre, phone: `57${celular}` },
    items,
    address: direccion,
    ...(lat !== null && lng !== null ? { lat, lng } : {}),
    ...(pago ? { payment_method_id: pago.id } : {}),
  };
  return { pedido, subtotal };
}

// La promoción de domicilio gratis de TRIVO (con pedido mínimo), como la lee su
// carta: `free_delivery: { applies, missing, promotion_name }`. Sin promoción, null.
export function domicilioGratis(fd) {
  if (!fd || typeof fd !== 'object') return null;
  return {
    aplica: fd.applies === true,
    falta: Math.max(0, Math.round(Number(fd.missing) || 0)),
    nombre: texto(fd.promotion_name, 40),
  };
}

// «Domicilio #12 · Pedido del día #34», como lo muestra la carta.
export function referencia(r) {
  if (r?.delivery_number != null) return `Domicilio #${r.delivery_number}${r.daily_number != null ? ` · Pedido del día #${r.daily_number}` : ''}`;
  if (r?.daily_number != null) return `Pedido del día #${r.daily_number}`;
  return r?.order_number != null ? `Pedido #${r.order_number}` : 'Pedido recibido';
}

// ── Respuestas ───────────────────────────────────────────────────────────────
function json(estado, datos) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  });
}

async function leerJson(request) {
  const cuerpo = await request.text();
  if (cuerpo.length > 20_000) throw new RangeError('Pedido demasiado grande');
  try {
    return cuerpo ? JSON.parse(cuerpo) : {};
  } catch {
    throw new TypeError('Datos no válidos');
  }
}

const MENSAJE_CAIDA = 'No pudimos comunicarnos con la tienda. Puedes enviar este mismo pedido por WhatsApp.';

// ── ¿La ubicación del GPS queda en la ciudad de la tienda? ───────────────────
// TRIVO devuelve la ciudad del punto: «Perímetro Urbano Valledupar» en la
// ciudad, «Valledupar» en los corregimientos (Valencia de Jesús…), y el nombre
// propio en otro municipio («La Paz», «Agustín Codazzi»). La ciudad con la que
// se compara es la de la sucursal en TRIVO: si la cambian allá, cambia aquí.
const sinTildes = (x) =>
  String(x ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function enCiudad(geo, ciudad) {
  const c = sinTildes(ciudad);
  if (!c) return true;
  if (sinTildes(geo?.components?.city).includes(c)) return true;
  return String(geo?.display_name || '')
    .split(',')
    .map(sinTildes)
    .includes(c);
}

const ciudadDe = (geo) => String(geo?.components?.city || '').replace(/^Per[ií]metro Urbano\s+/i, '').trim() || 'otra ciudad';

export const fueraDeZona = (geo, ciudad) => `Tu ubicación queda en ${ciudadDe(geo)}. Solo hacemos domicilios en ${ciudad}.`;

async function ubicar(carta, lat, lng, tiempo = 3500) {
  const r = await aTrivo('reverse-geocode/', { consulta: { lat, lng, branch_code: carta?.sucursal }, tiempo });
  if (!r.ok || !r.datos) throw new SinTrivo(`Ubicación: HTTP ${r.estado}`);
  return r.datos;
}

// /api/tienda/* (sin clave: es la tienda pública).
export async function manejarCaja(request, { ip = '' } = {}) {
  const ruta = new URL(request.url).pathname.replace(/^\/api\/tienda/, '');
  const metodo = request.method;
  const esPedido = ruta === '/pedido' && metodo === 'POST';
  if (!pasaLimite(ip || 'sin-ip', esPedido ? 'pedido' : 'consulta')) {
    return json(429, { error: 'Demasiados intentos seguidos. Espera unos minutos o escríbenos por WhatsApp.' });
  }
  if (metodo === 'POST' && !(request.headers.get('content-type') || '').includes('application/json')) {
    return json(415, { error: 'Se esperaba JSON' });
  }
  try {
    // Lo que la página necesita para cobrar: medios de pago y si está abierto.
    if (ruta === '/caja' && metodo === 'GET') {
      const [carta, pagos] = await Promise.all([cargarCarta(), mediosDePago().catch(() => [])]);
      return json(200, {
        abierto: carta && !carta.vieja ? carta.abierto : null,
        enLinea: Boolean(carta?.pedidos.enLinea),
        minimo: carta?.pedidos.minimo || 0,
        horario: carta?.horario || null,
        pagos,
      });
    }

    if (ruta === '/domicilio' && metodo === 'POST') {
      const e = await leerJson(request);
      const carta = await cargarCarta();
      const r = await aTrivo('delivery-quote/', {
        metodo: 'POST',
        cuerpo: {
          branch_code: carta?.sucursal || undefined,
          address: texto(e.direccion, 200),
          city: carta?.ciudad || 'Valledupar',
          lat: coordenada(e.lat, -5, 15),
          lng: coordenada(e.lng, -82, -66),
          subtotal: Math.max(0, Math.round(Number(e.subtotal) || 0)),
        },
      });
      if (!r.ok) return json(502, { error: 'No pudimos calcular el domicilio' });
      return json(200, { valor: Number(r.datos?.fee) || 0, antes: Number(r.datos?.fee_original) || 0, zona: r.datos?.zone_name || '', gratis: domicilioGratis(r.datos?.free_delivery) });
    }

    if (ruta === '/ubicacion' && metodo === 'POST') {
      const e = await leerJson(request);
      const lat = coordenada(e.lat, -5, 15);
      const lng = coordenada(e.lng, -82, -66);
      if (lat === null || lng === null) return json(400, { error: 'Esa ubicación está fuera de Colombia' });
      const carta = await cargarCarta();
      let geo;
      try {
        geo = await ubicar(carta, lat, lng, 6000);
      } catch {
        return json(502, { error: 'No pudimos leer la ubicación' });
      }
      const ciudad = carta?.ciudad || '';
      const dentro = enCiudad(geo, ciudad);
      return json(200, {
        direccion: String(geo.address || ''),
        precision: String(geo.precision || ''),
        enZona: dentro,
        ...(dentro ? {} : { error: fueraDeZona(geo, ciudad) }),
      });
    }

    if (esPedido) {
      const entrada = await leerJson(request);
      const [carta, pagos] = await Promise.all([cargarCarta(), mediosDePago()]);
      if (!carta || carta.vieja) throw new SinTrivo('La carta no cargó');
      if (!carta.pedidos.enLinea) return json(409, { error: 'Los pedidos en línea están apagados en este momento.', codigo: 'apagado' });
      const { pedido } = armarPedido(carta, entrada, pagos);
      // Con GPS, el punto tiene que quedar en la ciudad de la tienda. Si no se
      // puede confirmar, el pedido no sale (el cliente puede quitar la
      // ubicación y escribir la dirección).
      if (pedido.lat !== undefined && carta.ciudad) {
        let geo;
        try {
          geo = await ubicar(carta, pedido.lat, pedido.lng);
        } catch {
          return json(409, { error: 'No pudimos confirmar tu ubicación. Intenta de nuevo, o quita la ubicación y escribe la dirección.', codigo: 'sin_ubicacion' });
        }
        if (!enCiudad(geo, carta.ciudad)) {
          console.log('[caja] pedido fuera de zona:', ciudadDe(geo));
          return json(409, { error: fueraDeZona(geo, carta.ciudad), codigo: 'fuera_de_zona' });
        }
      }
      // 3,5 s para ubicar + 6 s para el pedido: dentro de los 10 s de Netlify.
      // Si se corta, reintentar no duplica (idempotency_key).
      const r = await aTrivo('order/', { metodo: 'POST', cuerpo: pedido, tiempo: 6000 });
      if (!r.ok) {
        const detalle = r.datos?.detail || r.datos?.message;
        console.error('[caja] TRIVO rechazó el pedido:', r.estado, JSON.stringify(r.datos).slice(0, 300));
        if (r.estado >= 500 || !detalle) throw new SinTrivo(`HTTP ${r.estado}`);
        const codigo = String(r.datos?.code || 'rechazado');
        // TRIVO habla de «restaurante»; aquí es una tienda.
        const error = codigo === 'branch_closed' ? 'La tienda está cerrada en este momento. Tu pedido queda guardado aquí para enviarlo cuando abramos.' : String(detalle);
        return json(409, { error, codigo });
      }
      const d = r.datos || {};
      console.log('[caja] pedido creado:', d.uuid, referencia(d));
      return json(200, {
        uuid: d.uuid ? String(d.uuid) : null,
        referencia: referencia(d),
        total: Number(d.total) || null,
        whatsapp: String(d.business_whatsapp || carta.whatsapp || '').replace(/\D/g, '') || null,
      });
    }

    const estado = ruta.match(/^\/pedido\/([0-9a-f-]{20,40})$/i);
    if (estado && metodo === 'GET') {
      const r = await aTrivo(`order/${estado[1]}/status/`);
      if (r.estado === 404) return json(404, { error: 'No encontramos ese pedido' });
      if (!r.ok || !r.datos?.status) throw new SinTrivo(`Estado: HTTP ${r.estado}`);
      const s = r.datos.status;
      // La «cuenta» de TRIVO: lo que de verdad quedó registrado en el pedido.
      const cuenta = r.datos.account;
      const detalle = Array.isArray(cuenta?.items)
        ? {
            lineas: cuenta.items.slice(0, 60).map((i) => ({
              cantidad: Number(i.quantity) || 0,
              nombre: nombreVisible(i.name),
              presentacion: i.variant ? nombreVariante(i.variant) : null,
              total: Number(i.line_total) || 0,
            })),
            total: Number(cuenta.total) || null,
          }
        : null;
      return json(200, {
        etapa: Number(s.stage) || 0,
        etiqueta: String(s.label || 'Recibido'),
        final: Boolean(s.is_final),
        cancelado: s.mapping === 'cancelled',
        detalle,
      });
    }

    return json(404, { error: 'No encontrado' });
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) return json(400, { error: error.message });
    if (error instanceof SinTrivo) {
      console.error('[caja]', error.message);
      return json(502, { error: MENSAJE_CAIDA, sinTrivo: true });
    }
    throw error;
  }
}

// Para las pruebas.
export function reiniciarCaja() {
  usos.clear();
  pagosEnMemoria = null;
}
