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
import { actualizar, leer } from './almacen.js';

const VERSION_API = () => process.env.WHATSAPP_API_VERSION || 'v21.0';
const TIEMPO = 8000;
const LARGO_TEXTO = 3500; // WhatsApp admite 4096
const LARGO_VARIABLE = 900; // la variable de una plantilla admite 1024, sin saltos de línea

export const whatsappActivo = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

// Número en formato internacional sin «+»: «300 466 0472» → «573004660472».
export function limpiarNumero(v) {
  const d = String(v ?? '').replace(/\D/g, '');
  if (/^3\d{9}$/.test(d)) return `57${d}`; // celular de Colombia sin indicativo
  return /^[1-9]\d{9,14}$/.test(d) ? d : null;
}

export async function leerWhatsapp() {
  const doc = (await leer('whatsapp')) || {};
  const numero = limpiarNumero(doc.numero) || limpiarNumero(process.env.WHATSAPP_DESTINO);
  return { activo: doc.activo !== false, numero, servidor: whatsappActivo(), ultimo: doc.ultimo || null };
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

// Fuera de la ventana de 24 horas WhatsApp no deja mandar texto libre.
const fueraDeVentana = (e) => e.codigo === 131047 || e.codigo === 470 || /24 ?hours|re-?engagement/i.test(e.message);

export async function enviarWhatsapp(texto, { numero } = {}) {
  if (!whatsappActivo()) return { enviado: false, motivo: 'sin-configurar' };
  const cfg = await leerWhatsapp();
  const destino = limpiarNumero(numero) || cfg.numero;
  if (!destino) return { enviado: false, motivo: 'sin-numero' };
  if (!numero && !cfg.activo) return { enviado: false, motivo: 'apagado' };
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
  await actualizar('whatsapp', (actual) => ({ ...(actual || {}), ultimo: { t: Date.now(), via } }));
  return { enviado: true, via };
}
