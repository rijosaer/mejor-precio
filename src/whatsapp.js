// WhatsApp: los mismos avisos que las notificaciones push, del número de la
// empresa al WhatsApp personal del dueño, con la API oficial de Meta
// (WhatsApp Cloud API). Variables del servidor:
//   WHATSAPP_TOKEN       token de acceso permanente (usuario del sistema de Meta Business)
//   WHATSAPP_PHONE_ID    «Phone number ID» del número de la empresa en la Cloud API
//   WHATSAPP_PLANTILLA   plantilla aprobada (categoría Utilidad) con UNA variable {{1}};
//                        por defecto «aviso_mejor_precio»
//   WHATSAPP_IDIOMA      idioma de la plantilla, por defecto «es»
//   WHATSAPP_DESTINO     número del dueño (opcional: también se pone en Ajustes)
//
// Primero se manda un mensaje de texto normal (no se cobra si el dueño escribió
// al número de la empresa en las últimas 24 horas). Si WhatsApp responde que
// pasó esa ventana, se manda la plantilla, que sí llega siempre.
//
// Sin cuenta de Meta: Green-API (green-api.com) conecta el WhatsApp de la
// empresa escaneando un QR en su consola, como WhatsApp Web. No hay plantillas
// ni ventana de 24 horas: siempre se manda texto. Variables:
//   GREENAPI_ID      idInstance de la instancia
//   GREENAPI_TOKEN   apiTokenInstance
//   GREENAPI_URL     apiUrl que muestra la consola (por defecto https://api.green-api.com)
// Si están las dos cuentas, se usa la de Meta.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { actualizar, leer } from './almacen.js';

const VERSION_API = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const TIEMPO = 8000;
const LARGO_TEXTO = 3500; // WhatsApp admite 4096
const LARGO_VARIABLE = 900; // la variable de una plantilla admite 1024, sin saltos de línea

const metaActivo = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);
const greenActivo = () => /^\d{4,20}$/.test(process.env.GREENAPI_ID || '') && /^[\w-]{10,100}$/.test(process.env.GREENAPI_TOKEN || '');

export const proveedorWhatsapp = () => (metaActivo() ? 'meta' : greenActivo() ? 'green-api' : null);
export const whatsappActivo = () => proveedorWhatsapp() !== null;

// Número en formato internacional sin «+»: «300 466 0472» → «573004660472».
export function limpiarNumero(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) return `57${d}`; // celular de Colombia sin indicativo
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export async function leerWhatsapp() {
  const doc = (await leer('whatsapp')) || {};
  const numero = limpiarNumero(doc.numero) || limpiarNumero(process.env.WHATSAPP_DESTINO);
  return { activo: doc.activo !== false, numero, servidor: whatsappActivo(), proveedor: proveedorWhatsapp(), ultimo: doc.ultimo || null, error: doc.error || null };
}

export async function guardarWhatsapp({ activo, numero } = {}) {
  let limpio;
  if (numero !== undefined && numero !== null && numero !== '') {
    limpio = limpiarNumero(numero);
    if (!limpio) throw new TypeError('Escribe el número con indicativo, por ejemplo 57 300 123 4567');
  }
  await actualizar('whatsapp', (actual) => ({
    ...(actual || {}),
    ...(activo !== undefined ? { activo: Boolean(activo) } : {}),
    ...(numero !== undefined ? { numero: limpio || null } : {}),
  }));
  return leerWhatsapp();
}

// Para la plantilla: sin saltos de línea, tabulaciones ni más de 4 espacios seguidos.
export const textoParaPlantilla = (texto) =>
  String(texto)
    .replace(/\s*\n+\s*/g, ' · ')
    .replace(/[\t\r]+/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
    .slice(0, LARGO_VARIABLE);

async function llamarApi(cuerpo) {
  const res = await fetch(`https://graph.facebook.com/${VERSION_API()}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(TIEMPO),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = new Error(datos?.error?.error_data?.details || datos?.error?.message || `WhatsApp: HTTP ${res.status}`);
    e.codigo = datos?.error?.code;
    throw e;
  }
  return datos;
}

function urlGreen(metodo) {
  const base = (process.env.GREENAPI_URL || 'https://api.green-api.com').replace(/\/$/, '');
  if (!/^https:\/\/[\w.-]+$/.test(base)) throw new Error('GREENAPI_URL no es válida');
  return `${base}/waInstance${process.env.GREENAPI_ID}/${metodo}/${process.env.GREENAPI_TOKEN}`;
}

async function leerGreen(metodo) {
  const res = await fetch(urlGreen(metodo), { signal: AbortSignal.timeout(TIEMPO) });
  if (!res.ok) throw new Error(`Green-API: HTTP ${res.status}`);
  return res.json();
}

// Vincular desde la app: el estado del WhatsApp de la empresa en Green-API y,
// si falta escanearlo, el QR (Green-API lo cambia cada 20 s; la sesión la guarda Green-API).
export async function vinculoGreen() {
  if (proveedorWhatsapp() !== 'green-api') throw new TypeError('WhatsApp no está conectado con Green-API');
  const { stateInstance } = await leerGreen('getStateInstance');
  if (stateInstance !== 'notAuthorized') return { estado: stateInstance || 'desconocido', qr: null };
  const qr = await leerGreen('qr');
  if (qr.type === 'qrCode' && /^[A-Za-z0-9+/=]+$/.test(qr.message || '')) return { estado: 'qr', qr: `data:image/png;base64,${qr.message}` };
  if (qr.type === 'alreadyLogged') return { estado: 'authorized', qr: null };
  return { estado: 'notAuthorized', qr: null, mensaje: qr.message || '' };
}

// Desvincula el WhatsApp de la empresa (para escanear con otro teléfono).
export async function desvincularGreen() {
  if (proveedorWhatsapp() !== 'green-api') throw new TypeError('WhatsApp no está conectado con Green-API');
  await leerGreen('logout');
  return vinculoGreen();
}

async function enviarGreen(destino, texto) {
  const res = await fetch(urlGreen('sendMessage'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId: `${destino}@c.us`, message: String(texto).slice(0, LARGO_TEXTO) }),
    signal: AbortSignal.timeout(TIEMPO),
  });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 466) throw new Error('Green-API: se pasó el límite del plan gratis (3 chats al mes)');
  if (!res.ok || !datos.idMessage) throw new Error(datos?.message || `Green-API: HTTP ${res.status}`);
  return datos;
}

// Fuera de la ventana de 24 horas WhatsApp no deja mandar texto libre.
const fueraDeVentana = (e) => e.codigo === 131047 || e.codigo === 470 || /24 ?hours|re-?engagement/i.test(e.message);

// El último error de envío queda guardado (se ve en la app) hasta el próximo envío bueno.
export async function enviarWhatsapp(texto, opciones = {}) {
  try {
    const r = await enviarSinRegistro(texto, opciones);
    if (r.enviado) await actualizar('whatsapp', (actual) => ({ ...(actual || {}), ultimo: { t: Date.now(), via: r.via }, error: null }));
    return r;
  } catch (error) {
    await actualizar('whatsapp', (actual) => ({ ...(actual || {}), error: { t: Date.now(), mensaje: error.message } })).catch(() => {});
    throw error;
  }
}

async function enviarSinRegistro(texto, { numero } = {}) {
  if (!whatsappActivo()) return { enviado: false, motivo: 'sin-configurar' };
  const cfg = await leerWhatsapp();
  const destino = limpiarNumero(numero) || cfg.numero;
  if (!destino) return { enviado: false, motivo: 'sin-numero' };
  if (!numero && !cfg.activo) return { enviado: false, motivo: 'apagado' };
  if (proveedorWhatsapp() === 'green-api') {
    await enviarGreen(destino, texto);
    return { enviado: true, via: 'green-api' };
  }
  const comun = { messaging_product: 'whatsapp', recipient_type: 'individual', to: destino };
  let via = 'texto';
  try {
    await llamarApi({ ...comun, type: 'text', text: { preview_url: false, body: String(texto).slice(0, LARGO_TEXTO) } });
  } catch (error) {
    if (!fueraDeVentana(error)) throw error;
    via = 'plantilla';
    await llamarApi({
      ...comun,
      type: 'template',
      template: {
        name: process.env.WHATSAPP_PLANTILLA || 'aviso_mejor_precio',
        language: { code: process.env.WHATSAPP_IDIOMA || 'es' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: textoParaPlantilla(texto) }] }],
      },
    });
  }
  return { enviado: true, via };
}

// ── Respuestas del dueño (Green-API) ────────────────────────────────────────
// Green-API avisa cada mensaje que llega al WhatsApp de la empresa a
// /api/whatsapp/entrante con «Authorization: Bearer <token>». El token sale del
// apiTokenInstance (no hace falta otra variable) y no sirve para otra cosa.
export const tokenWebhook = () => createHmac('sha256', process.env.GREENAPI_TOKEN || '').update('mejor-precio|webhook').digest('base64url').slice(0, 40);

export function webhookAutorizado(request) {
  if (proveedorWhatsapp() !== 'green-api') return false;
  const esperado = Buffer.from(`Bearer ${tokenWebhook()}`);
  const recibido = Buffer.from(request.headers.get('authorization') || '');
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}

const urlWebhook = (base) => `${String(base).replace(/\/$/, '')}/api/whatsapp/entrante`;

// ¿Green-API ya manda las respuestas a esta app?
export async function estadoRespuestas(base) {
  if (proveedorWhatsapp() !== 'green-api') return { disponible: false, activo: false };
  const s = await leerGreen('getSettings');
  return { disponible: true, activo: s.webhookUrl === urlWebhook(base) && s.incomingWebhook === 'yes' };
}

// Solo se tocan el webhook y los mensajes entrantes; el resto de la
// configuración de la instancia queda igual. Green-API tarda hasta 5 minutos en aplicarlo.
export async function activarRespuestas(base) {
  if (proveedorWhatsapp() !== 'green-api') throw new TypeError('Responder desde WhatsApp necesita Green-API');
  if (!/^https:\/\/[\w.-]+(:\d+)?\/?$/.test(String(base))) throw new TypeError('La app debe estar publicada con https para recibir respuestas');
  const res = await fetch(urlGreen('setSettings'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ webhookUrl: urlWebhook(base), webhookUrlToken: `Bearer ${tokenWebhook()}`, incomingWebhook: 'yes' }),
    signal: AbortSignal.timeout(TIEMPO),
  });
  const datos = await res.json().catch(() => ({}));
  if (!res.ok || !datos.saveSettings) throw new Error(datos?.message || `Green-API: HTTP ${res.status}`);
  return { disponible: true, activo: true };
}

// El texto de un mensaje entrante (normal, con vista previa o respondiendo a otro).
export function textoEntrante(m) {
  return String(m?.textMessageData?.textMessage ?? m?.extendedTextMessageData?.text ?? '').trim();
}
