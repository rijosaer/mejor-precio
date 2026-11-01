// Notificaciones push (Web Push): los avisos del monitoreo llegan al teléfono
// aunque la app esté cerrada. Necesita las claves VAPID en las variables
// VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY (se crean con `npm run claves-push`).
import { actualizar, leer } from './almacen.js';
import { enSilencio, leerConfig } from './config.js';
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

// Un solo mensaje de WhatsApp con todos los avisos pendientes.
export function mensajeWhatsapp(avisos) {
  const lineas = avisos.slice(0, 25).map((a) => {
    const t = textoAviso(a);
    return `• *${t.title}*${t.body ? `\n  ${t.body}` : ''}`;
  });
  if (avisos.length > 25) lineas.push(`… y ${avisos.length - 25} más en la app.`);
  const ruta = avisos.some((a) => a.url) && avisos.every((a) => a.url === avisos[0].url) ? avisos[0].url : '/';
  const link = enlace(ruta);
  return [`*Mejor Precio* · ${avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}`, ...lineas, link ? `\nAbrir: ${link}` : ''].filter(Boolean).join('\n');
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
    resultado.whatsapp = await enviarWhatsapp(mensajeWhatsapp(pendientes)).catch((e) => (console.error('[whatsapp]', e.message), { enviado: false, motivo: e.message }));
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
