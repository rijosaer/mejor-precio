import { claveDe, DIA, DIAS_RETENIDOS, MINUTO, podar, punto, puntoDulce, sumarPunto } from './reglas.js';

export { claveDe, prediccionStock } from './reglas.js';

const MAX_CLAVES = 600;
const MAX_ALERTAS = 30;
const AGRUPA = 30 * MINUTO;

export const AJUSTES_POR_DEFECTO = {
  margen: { comisionPct: 0, comisionFija: 0, ivaPct: 0, envio: 0, objetivo: 20 },
  logistica: { activo: false, porKm: 1000, tuLat: null, tuLng: null, tiendas: {} },
  cashback: {},
};

function leer(clave, porDefecto) {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : porDefecto;
  } catch {
    return porDefecto;
  }
}

function guardar(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    /* sin espacio: la app sigue con lo que ya tenía en memoria */
  }
}

function fusionar(base, extra) {
  const salida = { ...base };
  for (const k of Object.keys(extra || {})) {
    const propio = base[k];
    salida[k] =
      propio && typeof propio === 'object' && !Array.isArray(propio) && typeof extra[k] === 'object'
        ? fusionar(propio, extra[k])
        : extra[k];
  }
  return salida;
}

const historico = leer('mp-historico', {});
const alertasGuardadas = leer('mp-alertas', []);
const ventas = leer('mp-venta', {});
const descartadas = leer('mp-descartadas', {});
let ajustesActuales = fusionar(AJUSTES_POR_DEFECTO, leer('mp-ajustes', {}));

// Puntos de los últimos `dias` días (todo el historial si no se indica).
export function enRango(puntos, dias) {
  if (!dias) return puntos;
  const desde = Date.now() - dias * DIA;
  return puntos.filter((x) => x.t >= desde);
}

// Qué tan caro está el precio actual frente al período: sobre el mínimo y
// sobre el promedio (en %).
export function posicion(puntos, precio) {
  const precios = puntos.map((x) => x.p).filter((x) => x > 0);
  if (precios.length < 2 || !(precio > 0)) return null;
  const min = Math.min(...precios);
  const promedio = precios.reduce((s, x) => s + x, 0) / precios.length;
  return {
    sobreMinimo: ((precio - min) / min) * 100,
    sobrePromedio: ((precio - promedio) / promedio) * 100,
    promedio,
  };
}

// Descuento que la propia tienda anuncia (precio tachado).
export const LIQUIDACION = 25;
export function descuento(p) {
  if (!(p.precioAntes > p.precio) || !(p.precio > 0)) return 0;
  return Math.round(((p.precioAntes - p.precio) / p.precioAntes) * 100);
}

function podarHistorico(ahora) {
  for (const clave of Object.keys(historico)) {
    const serie = historico[clave];
    if (!serie.length || ahora - serie[serie.length - 1].t > DIAS_RETENIDOS * DIA) delete historico[clave];
  }
  const claves = Object.keys(historico);
  if (claves.length > MAX_CLAVES) {
    claves
      .sort((a, b) => historico[a][historico[a].length - 1].t - historico[b][historico[b].length - 1].t)
      .slice(0, claves.length - MAX_CLAVES)
      .forEach((k) => delete historico[k]);
  }
}

// Guarda los precios de una búsqueda y devuelve los avisos nuevos de "punto dulce".
export function registrar(datos) {
  const ahora = Date.now();
  const nuevas = [];
  for (const t of datos.tiendas) {
    if (!t.ok) continue;
    for (const p of t.productos) {
      if (!Number.isFinite(p.precio) || p.precio <= 0) continue;
      const clave = claveDe(t.id, p);
      const serie = historico[clave] || (historico[clave] = []);
      const antes = puntoDulce(serie, p.precio, ahora);
      if (antes && sumarAlerta({ tipo: 'dulce', clave, nombre: p.nombre, tienda: t.nombre, precio: p.precio, antes, t: ahora })) {
        nuevas.push(clave);
      }
      sumarPunto(serie, punto(p, ahora), AGRUPA);
      podar(serie, ahora);
    }
  }
  cerrarCambios(ahora);
  return nuevas;
}

const idAlerta = (a) => a.id || `${a.tipo || 'dulce'}|${a.clave}`;

// Guarda un aviso si es nuevo o si mejora (precio más bajo) uno igual que ya estaba.
function sumarAlerta(aviso) {
  aviso.id = idAlerta(aviso);
  const descarte = descartadas[aviso.id];
  if (descarte && (aviso.tipo === 'dulce' ? !(aviso.precio < descarte.precio) : aviso.t <= descarte.t)) return false;
  const previa = alertasGuardadas.find((a) => idAlerta(a) === aviso.id);
  if (previa && !(previa.precio > aviso.precio) && aviso.tipo === 'dulce') return false;
  if (previa && previa.t >= aviso.t && aviso.tipo !== 'dulce') return false;
  if (previa) alertasGuardadas.splice(alertasGuardadas.indexOf(previa), 1);
  alertasGuardadas.unshift(aviso);
  alertasGuardadas.sort((a, b) => b.t - a.t);
  return true;
}

function cerrarCambios(ahora) {
  if (alertasGuardadas.length > MAX_ALERTAS) alertasGuardadas.length = MAX_ALERTAS;
  podarHistorico(ahora);
  guardar('mp-historico', historico);
  guardar('mp-alertas', alertasGuardadas);
}

// Suma lo que el monitoreo del servidor registró desde la última sincronización:
// series { clave: [puntos] } y avisos. Devuelve cuántos avisos nuevos hubo.
export function fusionarServidor({ series = {}, alertas = [] } = {}) {
  const ahora = Date.now();
  for (const [clave, puntos] of Object.entries(series)) {
    const serie = historico[clave] || (historico[clave] = []);
    for (const x of puntos) {
      if (!(x.p > 0) || !Number.isFinite(x.t)) continue;
      // Si el navegador ya tiene una lectura a menos de 30 minutos, se queda la suya.
      if (serie.some((y) => Math.abs(y.t - x.t) < AGRUPA)) continue;
      serie.push(x);
    }
    serie.sort((a, b) => a.t - b.t);
    podar(serie, ahora);
  }
  let nuevas = 0;
  for (const a of alertas) if (sumarAlerta({ ...a })) nuevas++;
  cerrarCambios(ahora);
  return nuevas;
}

export const serie = (clave) => historico[clave] || [];

export function resumen(puntos) {
  const precios = puntos.map((x) => x.p).filter((x) => x > 0);
  return {
    min: Math.min(...precios),
    max: Math.max(...precios),
    primero: puntos[0].t,
    ultimo: puntos[puntos.length - 1].t,
    n: puntos.length,
  };
}

// Compara el precio actual con lo que ya se había registrado en ese producto.
export function estadoPrecio(clave, precio) {
  const puntos = serie(clave);
  if (puntos.length < 2) return null;
  const ahora = Date.now();
  const previos = puntos.filter((x) => ahora - x.t > AGRUPA);
  if (!previos.length) return null;
  const ultima = previos[previos.length - 1].p;
  const todos = previos.map((x) => x.p);
  return {
    delta: ultima - precio,
    esMinimo: precio < Math.min(...todos),
    registros: puntos.length,
  };
}

export const listarAlertas = () => alertasGuardadas.map((a) => ({ ...a, id: idAlerta(a) }));

// Un aviso descartado no vuelve a salir mientras el precio no baje todavía más.
function recordarDescarte(a) {
  descartadas[idAlerta(a)] = { precio: a.precio, t: a.t };
  const ids = Object.keys(descartadas);
  if (ids.length > 300) ids.sort((x, y) => descartadas[x].t - descartadas[y].t).slice(0, ids.length - 300).forEach((k) => delete descartadas[k]);
  guardar('mp-descartadas', descartadas);
}

export function descartarAlerta(id) {
  const i = alertasGuardadas.findIndex((a) => idAlerta(a) === id || a.clave === id);
  if (i >= 0) recordarDescarte(alertasGuardadas.splice(i, 1)[0]);
  guardar('mp-alertas', alertasGuardadas);
}

export function descartarTodas() {
  alertasGuardadas.forEach(recordarDescarte);
  alertasGuardadas.length = 0;
  guardar('mp-alertas', alertasGuardadas);
}

export const ajustes = () => ajustesActuales;

export function guardarAjustes(nuevos) {
  ajustesActuales = fusionar(AJUSTES_POR_DEFECTO, nuevos);
  guardar('mp-ajustes', ajustesActuales);
}

export const venta = (clave) => ventas[clave] || null;

export function guardarVenta(clave, datos) {
  ventas[clave] = datos;
  guardar('mp-venta', ventas);
}

export function margen({ venta: v0, compra, envio, comisionPct, comisionFija, ivaPct }) {
  const v = Number(v0) || 0;
  const c = Number(compra) || 0;
  const e = Number(envio) || 0;
  const comision = (v * (Number(comisionPct) || 0)) / 100 + (Number(comisionFija) || 0);
  const impuestos = (v * (Number(ivaPct) || 0)) / 100;
  const costo = c + e + comision + impuestos;
  const neto = v - costo;
  return { neto, costo, comision, impuestos, pct: v > 0 ? (neto / v) * 100 : 0 };
}

export const devolucion = (tiendaId, precio) => {
  const pct = Number(ajustesActuales.cashback[tiendaId]) || 0;
  return ((Number(precio) || 0) * pct) / 100;
};

export const porcentajeCashback = (tiendaId) => Number(ajustesActuales.cashback[tiendaId]) || 0;

export function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function trasladoInfo(tiendaId) {
  const l = ajustesActuales.logistica;
  if (!l.activo || !Number.isFinite(l.tuLat) || !Number.isFinite(l.tuLng)) return null;
  const destino = l.tiendas[tiendaId];
  if (!destino || !Number.isFinite(destino.lat) || !Number.isFinite(destino.lng)) return null;
  const km = distanciaKm(l.tuLat, l.tuLng, destino.lat, destino.lng) * 2;
  return { km, costo: Math.round(km * (Number(l.porKm) || 0)) };
}

export const traslado = (tiendaId) => trasladoInfo(tiendaId)?.costo ?? 0;

export function coordenadasDe(texto) {
  const limpio = String(texto || '').trim();
  const patrones = [
    /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /[?&](?:q|query)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
    /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/,
  ];
  for (const re of patrones) {
    const m = limpio.match(re);
    if (!m) continue;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng };
  }
  return null;
}

// ── Catálogo: precio de venta sugerido (repricing) ─────────────────────────
// Dos reglas:
//  - margen:  el precio que deja `margenPct` % neto sobre la venta.
//  - mercado: la mediana de las tiendas menos `bajoPct` %, sin bajar del piso.
// El piso es el precio en el que el neto da cero. `costo` ya trae compra +
// traslado − cashback. Se redondea hacia arriba a la centena.
export function precioSugerido({ costo, envio = 0, comisionPct = 0, comisionFija = 0, ivaPct = 0, modo = 'margen', margenPct = 0, mediana = null, bajoPct = 0 }) {
  const fijos = (Number(costo) || 0) + (Number(envio) || 0) + (Number(comisionFija) || 0);
  const variables = ((Number(comisionPct) || 0) + (Number(ivaPct) || 0)) / 100;
  const redondear = (v) => Math.ceil(v / 100) * 100;
  if (!(fijos > 0) || variables >= 1) return null;
  const piso = redondear(fijos / (1 - variables));
  if (modo === 'mercado') {
    if (!(mediana > 0)) return { precio: null, piso, motivo: 'sin-mercado' };
    const objetivo = redondear(mediana * (1 - (Number(bajoPct) || 0) / 100));
    return objetivo < piso ? { precio: piso, piso, motivo: 'mercado-bajo-costo' } : { precio: objetivo, piso, motivo: null };
  }
  const resto = 1 - variables - (Number(margenPct) || 0) / 100;
  if (resto <= 0) return { precio: null, piso, motivo: 'imposible' };
  return { precio: redondear(fijos / resto), piso, motivo: null };
}
