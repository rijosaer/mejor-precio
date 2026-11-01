// Ajustes que viven en el servidor: los que necesita el monitoreo (cada cuántas
// horas revisa, qué tiendas consulta, horario de silencio de las
// notificaciones) y una copia de los ajustes del navegador para que las dos
// personas que usan la app vean lo mismo.
import { actualizar, leer } from './almacen.js';
import { TIENDAS, POR_DEFECTO } from './comparador.js';

export const FRECUENCIAS = [3, 6, 12, 24];
export const ZONA = 'America/Bogota';

export const CONFIG_POR_DEFECTO = {
  cadaHoras: 6,
  tiendas: POR_DEFECTO,
  silencio: { activo: true, desde: 22, hasta: 7 },
  resumenSemanal: true,
};

const hora = (v, porDefecto) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : porDefecto);

export function limpiarConfig(c = {}) {
  const ids = new Set(TIENDAS.map(({ tienda }) => tienda.id));
  const tiendas = Array.isArray(c.tiendas) ? [...new Set(c.tiendas.map(String))].filter((id) => ids.has(id)) : null;
  const s = c.silencio || {};
  return {
    cadaHoras: FRECUENCIAS.includes(Number(c.cadaHoras)) ? Number(c.cadaHoras) : CONFIG_POR_DEFECTO.cadaHoras,
    tiendas: tiendas?.length ? tiendas : CONFIG_POR_DEFECTO.tiendas,
    silencio: {
      activo: s.activo === undefined ? CONFIG_POR_DEFECTO.silencio.activo : Boolean(s.activo),
      desde: hora(s.desde, CONFIG_POR_DEFECTO.silencio.desde),
      hasta: hora(s.hasta, CONFIG_POR_DEFECTO.silencio.hasta),
    },
    resumenSemanal: c.resumenSemanal === undefined ? true : Boolean(c.resumenSemanal),
  };
}

export async function leerConfig() {
  return limpiarConfig((await leer('config')) || {});
}

export async function guardarConfig(cambios) {
  return actualizar('config', (actual) => limpiarConfig({ ...(actual || {}), ...cambios }));
}

// Hora local de Valledupar (0–23) y día de la semana (0 = domingo).
export function horaLocal(t = Date.now()) {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: ZONA, hour: 'numeric', hourCycle: 'h23', weekday: 'short' }).formatToParts(new Date(t));
  const h = Number(partes.find((p) => p.type === 'hour').value);
  const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(partes.find((p) => p.type === 'weekday').value);
  return { hora: h, dia };
}

export function enSilencio(silencio, t = Date.now()) {
  if (!silencio?.activo || silencio.desde === silencio.hasta) return false;
  const { hora: h } = horaLocal(t);
  return silencio.desde < silencio.hasta ? h >= silencio.desde && h < silencio.hasta : h >= silencio.desde || h < silencio.hasta;
}

// ── Ajustes compartidos del navegador ──────────────────────────────────────
// Se guardan tal cual (son de la app, no del servidor), con su fecha para que
// gane el más reciente.
export async function leerAjustesCompartidos() {
  return (await leer('ajustes')) || null;
}

export async function guardarAjustesCompartidos(ajustes, t = Date.now()) {
  if (!ajustes || typeof ajustes !== 'object' || Array.isArray(ajustes)) throw new TypeError('Los ajustes deben ser un objeto');
  if (JSON.stringify(ajustes).length > 30_000) throw new RangeError('Los ajustes son demasiado grandes');
  const doc = { t: Number(t) || Date.now(), ajustes };
  return actualizar('ajustes', (actual) => (actual && actual.t > doc.t ? undefined : doc));
}
