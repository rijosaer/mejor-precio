// La marca de la tienda pública (versión 2): cada distribuidor ve la tienda
// como suya, con su nombre, sus iniciales y su color. No sale el nombre de
// TRIVO ni el de nadie más. Se cambia en el panel (Ajustes → Tienda en línea).
import { escribir, leer } from './almacen.js';

const CLAVE = 'tienda-marca';
const MEMORIA = 60_000;
let enMemoria = null;

// responsable, documento y correo: quién responde por los datos personales
// (política de datos); si están vacíos, la política usa el nombre de la tienda.
export const MARCA_POR_DEFECTO = Object.freeze({ nombre: 'Mejor Precio', sigla: 'MP', color: '#07794C', tiempo: '', lema: '', responsable: '', documento: '', correo: '' });

const PEQUENAS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en']);

// «Depósito El Pilón» → «DP»; «Licorera La 19» → «L1».
export function siglaDe(nombre) {
  const palabras = String(nombre || '')
    .split(/\s+/)
    .filter((w) => w && !PEQUENAS.has(w.toLowerCase()));
  const letras = palabras
    .slice(0, 2)
    .map((w) => w.match(/[\p{L}\p{N}]/u)?.[0] || '')
    .join('');
  return (letras || 'T').toLocaleUpperCase('es-CO');
}

const texto = (x, max) => String(x ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

export function limpiarMarca(m = {}) {
  const nombre = texto(m?.nombre, 40) || MARCA_POR_DEFECTO.nombre;
  const sigla =
    texto(m?.sigla, 3)
      .replace(/[^\p{L}\p{N}&]/gu, '')
      .toLocaleUpperCase('es-CO') || (nombre === MARCA_POR_DEFECTO.nombre ? MARCA_POR_DEFECTO.sigla : siglaDe(nombre));
  const color = /^#[0-9a-f]{6}$/i.test(String(m?.color || '')) ? String(m.color).toUpperCase() : MARCA_POR_DEFECTO.color;
  const correo = texto(m?.correo, 80).toLowerCase();
  return {
    nombre,
    sigla,
    color,
    tiempo: texto(m?.tiempo, 24),
    lema: texto(m?.lema, 90),
    responsable: texto(m?.responsable, 80),
    documento: texto(m?.documento, 24).replace(/[^\p{L}\p{N} .\-]/gu, ''),
    correo: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo) ? correo : '',
  };
}

export async function leerMarca({ ahora = Date.now() } = {}) {
  if (enMemoria && ahora - enMemoria.t < MEMORIA) return enMemoria.marca;
  const guardada = await leer(CLAVE).catch(() => null);
  const marca = limpiarMarca(guardada || {});
  enMemoria = { t: ahora, marca };
  return marca;
}

export async function guardarMarca(m) {
  const marca = limpiarMarca(m);
  await escribir(CLAVE, marca);
  enMemoria = { t: Date.now(), marca };
  return marca;
}

export function olvidarMarca() {
  enMemoria = null;
}

// ── Colores ─────────────────────────────────────────────────────────────────
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const aHex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
export const mezclar = (a, b, t) => {
  const x = rgb(a);
  const y = rgb(b);
  return aHex(x.map((v, i) => v * (1 - t) + y[i] * t));
};
const luz = (hex) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contraste = (a, b) => {
  const [x, y] = [luz(a), luz(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// El color escogido, oscurecido lo necesario para que el texto blanco encima
// se lea (4,5:1); el oscuro del encabezado y el suave de los avisos salen de él.
export function colores(color) {
  let marca = color;
  for (let t = 0.08; contraste(marca, '#FFFFFF') < 4.6 && t < 0.9; t += 0.08) marca = mezclar(color, '#000000', t);
  return { marca, oscuro: mezclar(color, '#000000', 0.55), suave: mezclar(color, '#FFFFFF', 0.88) };
}

export function marcaCss(m) {
  const c = colores(m.color);
  return `:root{--marca:${c.marca};--oscuro:${c.oscuro};--suave:${c.suave}}\n`;
}

const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// El ícono de la pestaña: las iniciales sobre el color de la tienda.
export function marcaSvg(m) {
  const c = colores(m.color);
  const tam = m.sigla.length > 2 ? 21 : 27;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${c.oscuro}"/><text x="32" y="${32 + tam * 0.36}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="800" font-size="${tam}" fill="#FFFFFF">${esc(m.sigla)}</text></svg>`;
}
