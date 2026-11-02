// Responder los avisos desde WhatsApp (Green-API): el dueño contesta el
// mensaje con el número de un precio por aprobar y se aplica en TRIVO, igual
// que con «Aplicar» en Mi tienda (queda en el historial y se puede deshacer).
// Solo cuentan los mensajes del chat del dueño; todo lo demás que llegue al
// WhatsApp de la empresa (clientes, grupos) se ignora sin responder.
//   1 · 1 3 · 1, 3 y 4 · sí 2   aplica esos precios
//   todos                        aplica todos los del último mensaje
//   no 2 · descartar 2           descarta esa propuesta
//   precios · pendientes         vuelve a listar los que esperan, numerados
//   ayuda                        qué se puede responder
import { actualizar, leer } from './almacen.js';
import { aplicarPropuesta, descartarPropuesta, leerPropuestas } from './mitienda.js';
import { anotarAvisos } from './push.js';
import { enviarWhatsapp, leerWhatsapp, textoEntrante } from './whatsapp.js';

const VIGENCIA_OPCIONES = 3 * 24 * 60 * 60_000; // los números de un mensaje valen 3 días
const VIGENCIA_MENSAJE = 2 * 60 * 60_000; // Green-API reintenta hasta 24 h: una aprobación vieja no se aplica
const TIEMPO_APLICAR = 7000; // la función de Netlify tiene 10 s
const MAX_LISTA = 15;

const pesos = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Math.round(n));
const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

// Lo que pidió el dueño, o null si el mensaje no es una orden (se ignora).
export function leerOrden(texto) {
  const t = sinTildes(String(texto).toLowerCase()).replace(/[.,;!¡¿?*]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  if (/^(si |dale |aplica(r)? )?tod[oa]s?( los precios)?$/.test(t)) return { accion: 'todos' };
  if (/^(precios|pendientes|lista)$/.test(t)) return { accion: 'precios' };
  if (/^(ayuda|menu|opciones)$/.test(t)) return { accion: 'ayuda' };
  const m = t.match(/^(si|dale|aplica|aplicar|no|descarta|descartar)?\s*((\d{1,2})(\s*(,|y)?\s*\d{1,2})*)$/);
  if (!m) return null;
  const numeros = [...new Set(m[2].match(/\d{1,2}/g).map(Number))].filter((n) => n >= 1);
  if (!numeros.length) return null;
  return { accion: /^(no|descarta)/.test(m[1] || '') ? 'descartar' : 'aplicar', numeros };
}

async function listarPendientes(ahora) {
  const propuestas = (await leerPropuestas()).slice(0, MAX_LISTA);
  if (!propuestas.length) return 'No hay precios esperando tu aprobación. ✅';
  await actualizar('whatsapp-opciones', () => ({ t: ahora, ids: propuestas.map((p) => p.id) }));
  const lineas = propuestas.map((p, i) => `*${i + 1}.* ${p.nombre}\n   ${pesos(p.precioActual)} → *${pesos(p.precioNuevo)}*`);
  return `💲 *Precios por aprobar*\n${lineas.join('\n')}\n\n↩️ Responde el número (o *todos*) para ponerlo en TRIVO; *no 2* lo descarta.`;
}

const AYUDA = [
  'Puedes responder:',
  '• *1* o *1 3* — pone esos precios en TRIVO',
  '• *todos* — todos los del último mensaje',
  '• *no 2* — descarta esa propuesta',
  '• *precios* — los que esperan tu aprobación',
  'Cada cambio queda en Mi tienda → Historial y se puede deshacer.',
].join('\n');

// Ejecuta la orden y devuelve el texto de la respuesta.
export async function ejecutarOrden(orden, { ahora = Date.now() } = {}) {
  if (orden.accion === 'ayuda') return AYUDA;
  if (orden.accion === 'precios') return listarPendientes(ahora);
  const opciones = await leer('whatsapp-opciones');
  if (!opciones?.ids?.length || ahora - opciones.t > VIGENCIA_OPCIONES) {
    return `Esos números ya no están vigentes.\n\n${await listarPendientes(ahora)}`;
  }
  const vigentes = new Map((await leerPropuestas()).map((p) => [p.id, p]));
  const elegidos = orden.accion === 'todos' ? opciones.ids.map((id, i) => [i + 1, id]) : orden.numeros.map((n) => [n, opciones.ids[n - 1]]);
  const lineas = [];
  const inicio = Date.now();
  let faltan = 0;
  for (const [n, id] of elegidos) {
    if (!id) {
      lineas.push(`• ${n}: no hay un precio con ese número`);
      continue;
    }
    const p = vigentes.get(id);
    if (!p) {
      if (orden.accion !== 'todos') lineas.push(`• ${n}: ya se aplicó o se descartó`);
      continue;
    }
    if (orden.accion === 'descartar') {
      await descartarPropuesta(id);
      lineas.push(`🗑️ ${p.nombre}: descartado (sigue en ${pesos(p.precioActual)})`);
      continue;
    }
    if (Date.now() - inicio > TIEMPO_APLICAR) {
      faltan++;
      continue;
    }
    try {
      const r = await aplicarPropuesta(id, { ahora, via: 'whatsapp' });
      lineas.push(`✅ ${p.nombre}: ${pesos(r.antes)} → *${pesos(r.despues)}*`);
    } catch (error) {
      lineas.push(`⚠️ ${p.nombre}: ${error.message}`);
    }
  }
  if (faltan) lineas.push(`Faltan ${faltan}: responde *todos* otra vez para seguir.`);
  if (!lineas.length) return 'Ya no queda ninguno de esos por aprobar. ✅';
  const hechos = lineas.some((l) => l.startsWith('✅'));
  return `${lineas.join('\n')}${hechos ? '\n\nQueda en Mi tienda → Historial, donde se puede deshacer.' : ''}`;
}

// Un aviso de Green-API (webhook). Responde por WhatsApp solo a las órdenes del dueño.
export async function procesarEntrante(cuerpo, { ahora = Date.now() } = {}) {
  if (cuerpo?.typeWebhook !== 'incomingMessageReceived') return { ignorado: 'tipo' };
  if (String(cuerpo.instanceData?.idInstance ?? '') !== String(process.env.GREENAPI_ID)) return { ignorado: 'instancia' };
  const wa = await leerWhatsapp();
  if (!wa.numero || cuerpo.senderData?.chatId !== `${wa.numero}@c.us`) return { ignorado: 'otro-chat' };
  const orden = leerOrden(textoEntrante(cuerpo.messageData));
  if (!orden) return { ignorado: 'texto' };
  if (ahora - Number(cuerpo.timestamp) * 1000 > VIGENCIA_MENSAJE) return { ignorado: 'viejo' };
  // Green-API reintenta si no respondemos a tiempo: cada mensaje se atiende una sola vez.
  const id = String(cuerpo.idMessage || '');
  let repetido = false;
  await actualizar('whatsapp-entrantes', (lista) => {
    if (!id || (lista || []).includes(id)) {
      repetido = true;
      return undefined;
    }
    return [id, ...(lista || [])].slice(0, 50);
  });
  if (repetido) return { ignorado: 'repetido' };
  const respuesta = await ejecutarOrden(orden, { ahora });
  await enviarWhatsapp(respuesta).catch((e) => console.error('[whatsapp respuesta]', e.message));
  await anotarAvisos({ t: ahora, respuesta: { orden: textoEntrante(cuerpo.messageData).slice(0, 60), texto: respuesta.slice(0, 1500) } }).catch(() => {});
  return { orden: orden.accion, respuesta };
}
