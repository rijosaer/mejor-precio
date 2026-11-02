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
    case 'negativo':
      return { title: `Inventario en negativo: ${a.nombre}`, body: `TRIVO marca ${a.existencias}: revisa el conteo o la compra sin cargar.` };
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

// Un paquete también por unidad, y lo que tú cobras por la misma unidad:
// «$ 2.319 c/u · tú la vendes a $ 3.000 (+$ 681)».
function lineaUnidad(a) {
  const unidades = Number(a.unidades) || 1;
  if (!(a.precio > 0) || (unidades <= 1 && !(a.tuUnidad > 0))) return '';
  const unidad = a.precio / unidades;
  const partes = unidades > 1 ? [`${plata(unidad)} c/u`] : [];
  if (a.tuUnidad > 0) {
    const gana = a.tuUnidad - unidad;
    partes.push(`tú la vendes a ${plata(a.tuUnidad)}${Math.round(gana) ? ` (${gana > 0 ? '+' : '−'}${plata(Math.abs(gana))})` : ''}`);
  }
  return `\n   ${partes.join(' · ')}`;
}

function lineaCompra(a) {
  const nombre = nombreCorto(a.nombre);
  switch (a.tipo) {
    case 'oferta': {
      const pct = a.a > a.precio ? Math.round((1 - a.precio / a.a) * 100) : null;
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}*${a.a ? ` (antes ${plata(a.a)}${pct ? `, −${pct} %` : ''})` : ''}${lineaUnidad(a)}`;
    }
    case 'dulce':
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}* (bajó de ${plata(a.antes)})${lineaUnidad(a)}`;
    case 'umbral':
      return `• ${nombre}\n   ${a.tienda} *${plata(a.precio)}* (tu objetivo: ${plata(a.umbral)})${lineaUnidad(a)}`;
    case 'volvio':
      return `• ${nombre}\n   volvió a ${a.tienda} a *${plata(a.precio)}*${lineaUnidad(a)}`;
    default:
      return lineaGeneral(a);
  }
}

// Lo que se puede aprobar respondiendo lleva una marca con el id de la
// propuesta; al armar el mensaje se cambia por su número («*1.*»).
const MARCA = /\u0001([^\u0002]+)\u0002/g;
const vineta = (propuesta) => (propuesta ? `\u0001${propuesta}\u0002` : '• ');

// Los precios por aprobar, uno por línea (sin repetir si vienen en la compra y en el recordatorio).
function porAprobar(avisos) {
  const vistos = new Set();
  return avisos.flatMap((a) => {
    if (!a.items?.length) return [lineaGeneral(a)];
    return a.items
      .filter((x) => !vistos.has(x.id) && vistos.add(x.id))
      .map((x) => `${vineta(x.id)}${nombreCorto(x.nombre)}\n   ${plata(x.precioActual)} → *${plata(x.precioNuevo)}*`);
  });
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
            `${vineta(a.propuesta)}${nombreCorto(a.nombre)}\n   vendes ${plata(a.precio)} · cuesta ${plata(a.costo)} → *pierdes ${plata(a.costo - a.precio)}*` +
            (a.vendidos > 0 ? ` (${a.vendidos} vendidos en 30 días: ${plata((a.costo - a.precio) * a.vendidos)})` : '') +
            (a.sugerido ? `\n   con tu margen (${a.margen} %): *${plata(a.sugerido)}*` : ''),
        ),
  },
  { tipos: ['precio-compra', 'recordatorio'], titulo: '💲 *Precios por aprobar*', resumen: (_, lineas, lista) => (lista.some((a) => a.items?.length) ? `💲 ${lineas.length} por aprobar` : '💲 precios por aprobar'), ruta: () => '/#mitienda', lineas: porAprobar, max: 12 },
  {
    tipos: ['bajo-minimo'],
    titulo: (avisos) => `📦 *Por pedir*${todosAgotados(avisos) ? ' · agotados en TRIVO' : ''}`,
    resumen: (_, lineas) => `📦 ${lineas.length} por pedir`,
    ruta: () => '/#mitienda',
    lineas: porPedir,
    max: 15,
  },
  {
    tipos: ['negativo'],
    titulo: '🧮 *Inventario en negativo*',
    resumen: (n) => `🧮 ${n} en negativo`,
    ruta: () => '/#mitienda',
    lineas: (avisos) => avisos.sort((a, b) => a.existencias - b.existencias).map((a) => `• ${nombreCorto(a.nombre)}: TRIVO marca *${a.existencias}*`),
    pie: '   Pasa cuando se vende sin haber cargado la compra o el conteo quedó mal: revísalo en TRIVO.',
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

// `responder`: los precios por aprobar llevan número y se aprueban contestando
// el mensaje (solo con Green-API, que recibe las respuestas). Devuelve el texto
// y, en orden, los ids de las propuestas numeradas.
export function armarMensaje(avisos, { ahora = Date.now(), responder = false, titulo = '' } = {}) {
  const conocidos = new Set(SECCIONES.flatMap((s) => s.tipos));
  const partes = [...SECCIONES.map((s) => [s, avisos.filter((a) => s.tipos.includes(a.tipo))]), [OTROS, avisos.filter((a) => !conocidos.has(a.tipo))]]
    .filter(([, lista]) => lista.length)
    .map(([s, lista]) => {
      const lineas = s.lineas([...lista]);
      const max = s.max || MAX_POR_SECCION;
      const extra = lineas.length > max ? [`   … y ${lineas.length - max} más en la app`] : [];
      const link = enlace(s.ruta(lista));
      const cabeza = typeof s.titulo === 'function' ? s.titulo(lista) : s.titulo;
      return { resumen: s.resumen(lista.length, lineas, lista), texto: [cabeza, ...lineas.slice(0, max), ...extra, s.pie || '', link ? `↳ ${link}` : ''].filter(Boolean).join('\n') };
    });
  const fecha = new Intl.DateTimeFormat('es-CO', { timeZone: ZONA, weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(ahora));
  const encabezado = [`*Mejor Precio* · ${fecha}${titulo ? ` · ${titulo}` : ''}`, partes.length > 1 ? partes.map((p) => p.resumen).join(' · ') : ''].filter(Boolean).join('\n');
  const opciones = [];
  let texto = [encabezado, ...partes.map((p) => p.texto)].join('\n\n').replace(MARCA, (_, id) => {
    if (!responder) return '• ';
    if (!opciones.includes(id)) opciones.push(id);
    return `*${opciones.indexOf(id) + 1}.* `;
  });
  if (opciones.length) {
    const ejemplo = opciones.length > 1 ? '*1* o *1 3*' : '*1*';
    texto += `\n\n↩️ Responde ${ejemplo} para poner ese precio en TRIVO${opciones.length > 1 ? ', o *todos*' : ''}. *precios* muestra los pendientes.`;
  }
  return { texto, opciones };
}

export const mensajeWhatsapp = (avisos, opciones) => armarMensaje(avisos, opciones).texto;

// ── Envío ───────────────────────────────────────────────────────────────────
// Lo urgente sale aunque sea horario de silencio; lo demás espera a la mañana.
const URGENTES = new Set(['bajo-costo']);
// Avisos que son un hecho nuevo cada vez (no un estado que se repite).
const SIEMPRE = new Set(['precio-compra', 'recordatorio', 'semanal', 'trivo', 'prueba']);
const NO_REPETIR_HORAS = 24;
const MAX_HISTORIAL = 60;

// El mismo aviso (tipo, producto y precio) no se repite en 24 horas: un
// producto que entra y sale del mínimo o una oferta que reaparece no llenan el chat.
export const huella = (a) => `${a.tipo}|${a.clave ?? a.nombre ?? a.title ?? ''}|${a.precio ?? ''}`;

function sinRepetidos(avisos, enviados, ahora) {
  const porHuella = new Map();
  for (const a of avisos) {
    const h = huella(a);
    if (!SIEMPRE.has(a.tipo) && ahora - (enviados[h] || 0) < NO_REPETIR_HORAS * 60 * 60_000) continue;
    porHuella.set(SIEMPRE.has(a.tipo) ? `${h}|${porHuella.size}` : h, a); // dentro de la tanda queda el más reciente
  }
  return [...porHuella.values()];
}

// Historial de lo que se avisó (y por dónde), para verlo en la app.
export async function anotarAvisos(entrada) {
  return actualizar('avisos-historial', (lista) => [entrada, ...(lista || [])].slice(0, MAX_HISTORIAL));
}

const resumenAviso = (a) => {
  const t = textoAviso(a);
  const propuestas = [a.propuesta, ...(a.items || []).map((x) => x.id)].filter(Boolean);
  return { tipo: a.tipo, title: t.title, body: t.body, url: a.url || (a.q ? `/?q=${encodeURIComponent(a.q)}` : null), ...(propuestas.length ? { propuestas } : {}) };
};

// Avisos → notificaciones push y WhatsApp. Con más de 3 a la vez el push manda
// una sola que los resume; WhatsApp siempre manda un solo mensaje con todos.
// En horario de silencio se guardan (menos lo urgente) y salen en la primera
// revisión de la mañana, marcados como «lo de la noche».
export async function notificarAvisos(avisos, { ahora = Date.now() } = {}) {
  const wa = whatsappActivo() ? await leerWhatsapp() : null;
  const conWhatsapp = Boolean(wa?.activo && wa.numero);
  if (!pushActivo() && !conWhatsapp) return { enviadas: 0, motivo: 'sin-claves' };
  const config = await leerConfig();
  const nuevos = avisos.map((a) => ({ t: ahora, ...a }));
  const pendientes = await actualizar('push-pendientes', (lista) => [...(lista || []), ...nuevos].slice(-MAX_PENDIENTES));
  if (!pendientes.length) return { enviadas: 0, motivo: 'nada' };
  const silencio = enSilencio(config.silencio, ahora);
  const salen = silencio ? pendientes.filter((a) => URGENTES.has(a.tipo)) : pendientes;
  if (!salen.length) return { enviadas: 0, motivo: 'silencio' };
  const quedan = silencio ? pendientes.filter((a) => !URGENTES.has(a.tipo)) : [];
  await actualizar('push-pendientes', () => quedan);

  const enviados = (await leer('avisos-enviados')) || {};
  const lista = sinRepetidos(salen, enviados, ahora);
  if (!lista.length) return { enviadas: 0, motivo: 'repetidos' };
  const deLaNoche = !silencio && lista.some((a) => a.t < ahora - 30 * 60_000 && enSilencio(config.silencio, a.t));
  const resultado = { enviadas: 0 };
  if (conWhatsapp) {
    const { texto, opciones } = armarMensaje(lista, { ahora, responder: wa.proveedor === 'green-api', titulo: silencio ? '🔴 urgente' : deLaNoche ? '🌙 lo de la noche' : '' });
    resultado.whatsapp = await enviarWhatsapp(texto).catch((e) => (console.error('[whatsapp]', e.message), { enviado: false, motivo: e.message }));
    if (resultado.whatsapp.enviado && opciones.length) await actualizar('whatsapp-opciones', () => ({ t: ahora, ids: opciones }));
  }
  if (pushActivo()) {
    if (lista.length > 3) {
      const r = await enviar({ title: `${lista.length} avisos`, body: lista.slice(0, 3).map((a) => textoAviso(a).title).join(' · '), url: '/', tag: 'mp-resumen' });
      resultado.enviadas = r.enviadas || 0;
    } else {
      for (const a of lista) {
        const r = await enviar({ ...textoAviso(a), url: a.url || (a.q ? `/?q=${encodeURIComponent(a.q)}` : '/'), tag: a.id || `${a.tipo}|${a.clave}` });
        resultado.enviadas += r.enviadas || 0;
      }
    }
  }
  const llego = resultado.enviadas > 0 || resultado.whatsapp?.enviado;
  if (llego) {
    await actualizar('avisos-enviados', (actual) => {
      const doc = Object.fromEntries(Object.entries(actual || {}).filter(([, t]) => ahora - t < 3 * NO_REPETIR_HORAS * 60 * 60_000));
      for (const a of lista) if (!SIEMPRE.has(a.tipo)) doc[huella(a)] = ahora;
      return doc;
    });
  } else if (conWhatsapp && !pushActivo()) {
    // WhatsApp falló (sin cupo, teléfono desvinculado…) y no hay push: se
    // guardan para el próximo intento y no se pierden.
    await actualizar('push-pendientes', (actual) => [...lista, ...(actual || [])].slice(-MAX_PENDIENTES));
  }
  await anotarAvisos({
    t: ahora,
    whatsapp: resultado.whatsapp ? { enviado: Boolean(resultado.whatsapp.enviado), error: resultado.whatsapp.enviado ? null : resultado.whatsapp.motivo || null } : null,
    push: pushActivo() ? resultado.enviadas : null,
    nota: silencio ? 'urgente, en horario de silencio' : deLaNoche ? 'lo de la noche' : null,
    avisos: lista.slice(0, 40).map(resumenAviso),
  }).catch((e) => console.error('[historial avisos]', e.message));
  return resultado;
}
