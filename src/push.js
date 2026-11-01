// Notificaciones push (Web Push): los avisos del monitoreo llegan al teléfono
// aunque la app esté cerrada. Necesita las claves VAPID en las variables
// VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (se crean con `npm run claves-push`).
import { actualizar, leer } from './almacen.js';
import { enSilencio, leerConfig, ZONA } from './config.js';
import { enviarWhatsapp, leerWhatsapp, whatsappActivo } from './whatsapp.js';

const MAX_SUSCRIPCIONES = 10;
const MAX_PENDIENTES = 40;
let webpush = null;

export function clavePublica() {
  return process.env.VAPID_PUBLIC_KEY || '';
}

export const pushActivo = () => Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);

async function cliente() {
  if (!webpush) {
    webpush = (await import('web-push')).default;
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:mejor-precio@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  }
  return webpush;
}

export function limpiarSuscripcion(s) {
  const endpoint = String(s?.endpoint || '');
  const p256dh = String(s?.keys?.p256dh || '');
  const auth = String(s?.keys?.auth || '');
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || endpoint.length > 1000 || !/^[\w-]{20,200}$/.test(p256dh) || !/^[\w-]{8,100}$/.test(auth)) return null;
  return { endpoint, keys: { p256dh, auth } };
}

export async function suscripciones() {
  return (await leer('push')) || [];
}

export async function suscribir(datos, etiqueta = '') {
  const s = limpiarSuscripcion(datos);
  if (!s) throw new TypeError('Suscripción no válida');
  await actualizar('push', (lista) => {
    const otras = (lista || []).filter((x) => x.endpoint !== s.endpoint);
    return [{ ...s, etiqueta: String(etiqueta).slice(0, 60), t: Date.now() }, ...otras].slice(0, MAX_SUSCRIPCIONES);
  });
}

export async function desuscribir(endpoint) {
  await actualizar('push', (lista) => (lista || []).filter((x) => x.endpoint !== endpoint));
}

// Envía una notificación a todos los teléfonos suscritos. Quita las
// suscripciones que el servicio de push ya no reconoce (404 / 410).
export async function enviar(notificacion) {
  if (!pushActivo()) return { enviadas: 0, motivo: 'sin-claves' };
  const lista = await suscripciones();
  if (!lista.length) return { enviadas: 0, motivo: 'sin-suscripciones' };
  const wp = await cliente();
  const vencidas = [];
  let enviadas = 0;
  await Promise.all(
    lista.map(async (s) => {
      try {
        await wp.sendNotification(s, JSON.stringify(notificacion), { TTL: 12 * 60 * 60, timeout: 8000 });
        enviadas++;
      } catch (error) {
        if (error.statusCode === 404 || error.statusCode === 410) vencidas.push(s.endpoint);
        else console.error('[push]', error.statusCode || '', error.message);
      }
    }),
  );
  if (vencidas.length) await actualizar('push', (actual) => (actual || []).filter((x) => !vencidas.includes(x.endpoint)));
  return { enviadas };
}

const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export function textoAviso(a) {
  const precio = a.precio ? pesos.format(a.precio) : '';
  switch (a.tipo) {
    case 'umbral':
      return { title: `Precio objetivo: ${a.nombre}`, body: `${a.tienda} lo tiene a ${precio} (pediste bajo ${pesos.format(a.umbral)})` };
    case 'dulce':
      return { title: `Bajó: ${a.nombre}`, body: `${a.tienda}: ${precio}, antes ${pesos.format(a.antes)}` };
    case 'oferta':
      return { title: `Nueva oferta: ${a.nombre}`, body: `${a.tienda}: ${precio}${a.a ? ` (antes ${pesos.format(a.a)})` : ''}` };
    case 'agota':
      return { title: `Se agota: ${a.nombre}`, body: `${a.tienda}: quedan ${a.stock} u.` };
    case 'agotado':
      return { title: `Se agotó: ${a.nombre}`, body: a.tienda };
    case 'volvio':
      return { title: `Volvió a haber: ${a.nombre}`, body: `${a.tienda}: ${precio}` };
    case 'sinstock':
      return { title: `Ninguna tienda lo tiene: ${a.nombre}`, body: 'Si lo publicas, conviene pausarlo.' };
    case 'tienda':
      return { title: `${a.tienda} no está respondiendo`, body: a.detalle || 'Revisa Estado de las tiendas.' };
    case 'semanal':
      return { title: 'Resumen de la semana', body: a.detalle };
    case 'bajo-minimo':
      return { title: `Hay que pedir: ${a.nombre}`, body: `Quedan ${a.existencias} en TRIVO (mínimo ${a.minimo}).` };
    case 'bajo-costo':
      return { title: `Bajo tu costo: ${a.nombre}`, body: `Lo vendes a ${pesos.format(a.precio)} y te cuesta ${pesos.format(a.costo)}.` };
    default:
      // Avisos que ya traen su texto (precios por compra, TRIVO, recordatorios).
      if (a.title) return { title: a.title, body: a.body || '' };
      return { title: a.nombre || 'Mejor Precio', body: `${a.tienda || ''} ${precio}`.trim() };
  }
}

// Enlace a la app en el mensaje de WhatsApp (Netlify define URL; si no, APP_URL).
function enlace(ruta = '/') {
  const base = process.env.APP_URL || process.env.URL || '';
  return base ? `${base.replace(/\/$/, '')}${ruta}` : '';
}

// ── Mensaje de WhatsApp ─────────────────────────────────────────────────────
// Un solo mensaje con todos los avisos pendientes, por secciones y en orden de
// urgencia: lo que hace perder plata, lo que espera tu aprobación, lo que hay
// que pedir, las oportunidades de compra y el resto. Cada sección con su enlace.
const MAX_POR_SECCION = 8;

// «CERVEZA COSTEÑA BACANA x 330ml (lata)» → «Cerveza Costeña Bacana 330ml lata»,
// sin palabras repetidas («Cerveza Sixpack CERVEZA…»).
export function nombreCorto(nombre) {
  const vistas = new Set();
  return String(nombre)
    .replace(/\s+x\s+(?=\d)/gi, ' ')
    .replace(/\s*\((lata|botella|vidrio)\)/gi, ' $1')
    .split(/\s+/)
    .map((w) => (/^[A-ZÁÉÍÓÚÑÜ]{4,}$/.test(w) ? w[0] + w.slice(1).toLowerCase() : w))
    .filter((w) => {
      const k = w.toLowerCase();
      if (k.length > 3 && vistas.has(k)) return false;
      vistas.add(k);
      return true;
    })
    .join(' ')
    .trim();
}

const plata = (n) => pesos.format(Math.round(n));
const vendidosTexto = (n) => (n > 0 ? ` · vendiste ${n} en 30 días` : '');

// Un producto por línea aunque tenga variantes: «Aguila Original 330ml lata (Caliente y Fria)».
function porPedir(avisos) {
  const grupos = new Map();
  for (const a of avisos) {
    const clave = a.base || a.nombre;
    const g = grupos.get(clave) || { nombre: clave, variantes: [], existencias: 0, vendidos: 0 };
    if (a.variante && a.base) g.variantes.push(a.variante);
    g.existencias += Math.max(0, Number(a.existencias) || 0);
    g.vendidos = Math.max(g.vendidos, Number(a.vendidos) || 0); // las ventas son del producto, no de la variante
    grupos.set(clave, g);
  }
  // Si todos están agotados, el título lo dice una vez (todosAgotados) y cada línea no lo repite.
  const todos = [...grupos.values()].every((g) => g.existencias === 0);
  return [...grupos.values()]
    .sort((a, b) => b.vendidos - a.vendidos || a.nombre.localeCompare(b.nombre))
    .map((g) => {
      const variantes = g.variantes.length ? ` (${g.variantes.join(' y ')})` : '';
      const estado = todos ? '' : g.existencias > 0 ? ` — quedan ${g.existencias}` : ' — agotado';
      return `• ${nombreCorto(g.nombre)}${variantes}${estado}${vendidosTexto(g.vendidos)}`;
    });
}
const todosAgotados = (avisos) => avisos.every((a) => !(Number(a.existencias) > 0));

function lineaCompra(a) {
  const nombre = nombreCorto(a.nombre);
  switch (a.tipo) {
    case 'oferta': {
      const pct = a.a > a.precio ? Math.round((1 - a.precio / a.a) * 100) : null;
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}*${a.a ? ` (antes ${plata(a.a)}${pct ? `, −${pct} %` : ''})` : ''}`;
    }
    case 'dulce':
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}* (bajó de ${plata(a.antes)})`;
    case 'umbral':
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}* (tu objetivo: ${plata(a.umbral)})`;
    case 'volvio':
      return `• ${nombre}\n   volvió a ${a.tienda} a *${plata(a.precio)}*`;
    default:
      return lineaGeneral(a);
  }
}

function lineaGeneral(a) {
  const t = textoAviso(a);
  return `• ${t.title}${t.body ? `\n   ${t.body}` : ''}`;
}

const SECCIONES = [
  {
    tipos: ['bajo-costo'],
    titulo: '🔴 *Vendes por debajo del costo*',
    resumen: (n) => `🔴 ${n} bajo el costo`,
    ruta: () => '/#mitienda',
    lineas: (avisos) =>
      avisos
        .sort((a, b) => b.costo - b.precio - (a.costo - a.precio))
        .map(
          (a) =>
            `• ${nombreCorto(a.nombre)}\n   vendes ${plata(a.precio)} · cuesta ${plata(a.costo)} → *pierdes ${plata(a.costo - a.precio)}*` +
            (a.sugerido ? `\n   con tu margen (${a.margen} %): *${plata(a.sugerido)}*` : ''),
        ),
  },
  { tipos: ['precio-compra', 'recordatorio'], titulo: '💲 *Precios por aprobar*', resumen: () => '💲 precios por aprobar', ruta: () => '/#mitienda', lineas: (a) => a.map(lineaGeneral) },
  {
    tipos: ['bajo-minimo'],
    titulo: (avisos) => `📦 *Por pedir*${todosAgotados(avisos) ? ' · agotados en TRIVO' : ''}`,
    resumen: (_, lineas) => `📦 ${lineas.length} por pedir`,
    ruta: () => '/#mitienda',
    lineas: porPedir,
    max: 15,
  },
  {
    tipos: ['oferta', 'dulce', 'umbral', 'volvio'],
    titulo: '🏷️ *Para comprar barato*',
    resumen: (n) => `🏷️ ${n} para comprar`,
    ruta: (avisos) => (new Set(avisos.map((a) => a.q)).size === 1 && avisos[0].q ? `/?q=${encodeURIComponent(avisos[0].q)}` : '/#lista'),
    lineas: (a) => a.map(lineaCompra),
  },
  { tipos: ['agota', 'agotado', 'sinstock'], titulo: '⚠️ *En las tiendas*', resumen: (n) => `⚠️ ${n} en tiendas`, ruta: () => '/#lista', lineas: (a) => a.map(lineaGeneral) },
  { tipos: ['tienda', 'trivo'], titulo: '🛠️ *Conexiones*', resumen: (n) => `🛠️ ${n} de conexión`, ruta: () => '/#estado', lineas: (a) => a.map(lineaGeneral) },
  { tipos: ['semanal'], titulo: '📊 *Resumen de la semana*', resumen: () => '📊 resumen semanal', ruta: () => '/', lineas: (a) => a.map((x) => x.detalle || textoAviso(x).body) },
];
const OTROS = { titulo: '🔔 *Otros avisos*', resumen: (n) => `🔔 ${n} más`, ruta: (a) => a.find((x) => x.url)?.url || '/', lineas: (a) => a.map(lineaGeneral) };

export function mensajeWhatsapp(avisos, { ahora = Date.now() } = {}) {
  const conocidos = new Set(SECCIONES.flatMap((s) => s.tipos));
  const partes = [...SECCIONES.map((s) => [s, avisos.filter((a) => s.tipos.includes(a.tipo))]), [OTROS, avisos.filter((a) => !conocidos.has(a.tipo))]]
    .filter(([, lista]) => lista.length)
    .map(([s, lista]) => {
      const lineas = s.lineas([...lista]);
      const max = s.max || MAX_POR_SECCION;
      const extra = lineas.length > max ? [`   … y ${lineas.length - max} más en la app`] : [];
      const link = enlace(s.ruta(lista));
      const titulo = typeof s.titulo === 'function' ? s.titulo(lista) : s.titulo;
      return { resumen: s.resumen(lista.length, lineas), texto: [titulo, ...lineas.slice(0, max), ...extra, link ? `↳ ${link}` : ''].filter(Boolean).join('\n') };
    });
  const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ahora));
  const encabezado = [`*Mejor Precio* · ${fecha}`, partes.length > 1 ? partes.map((p) => p.resumen).join(' · ') : ''].filter(Boolean).join('\n');
  return [encabezado, ...partes.map((p) => p.texto)].join('\n\n');
}

// Avisos → notificaciones push y WhatsApp. Con más de 3 a la vez el push manda
// una sola que los resume; WhatsApp siempre manda un solo mensaje con todos.
// En horario de silencio se guardan y salen en la próxima revisión.
export async function notificarAvisos(avisos, { ahora = Date.now() } = {}) {
  const wa = whatsappActivo() ? await leerWhatsapp() : null;
  const conWhatsapp = Boolean(wa?.activo && wa.numero);
  if (!pushActivo() && !conWhatsapp) return { enviadas: 0, motivo: 'sin-claves' };
  const config = await leerConfig();
  const nuevos = avisos.map((a) => ({ ...a }));
  const pendientes = await actualizar('push-pendientes', (lista) => [...(lista || []), ...nuevos].slice(-MAX_PENDIENTES));
  if (!pendientes.length || enSilencio(config.silencio, ahora)) return { enviadas: 0, motivo: pendientes.length ? 'silencio' : 'nada' };
  await actualizar('push-pendientes', () => []);
  const resultado = { enviadas: 0 };
  if (conWhatsapp) {
    resultado.whatsapp = await enviarWhatsapp(mensajeWhatsapp(pendientes, { ahora })).catch((e) => (console.error('[whatsapp]', e.message), { enviado: false, motivo: e.message }));
  }
  if (!pushActivo()) return resultado;
  if (pendientes.length > 3) {
    const r = await enviar({
      title: `${pendientes.length} avisos`,
      body: pendientes.slice(0, 3).map((a) => textoAviso(a).title).join(' · '),
      url: '/',
      tag: 'mp-resumen',
    });
    return { ...resultado, enviadas: r.enviadas || 0 };
  }
  for (const a of pendientes) {
    const texto = textoAviso(a);
    const r = await enviar({ ...texto, url: a.url || (a.q ? `/?q=${encodeURIComponent(a.q)}` : '/'), tag: a.id || `${a.tipo}|${a.clave}` });
    resultado.enviadas += r.enviadas || 0;
  }
  return resultado;
}
