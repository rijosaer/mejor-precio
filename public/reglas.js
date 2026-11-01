// Reglas que comparten el navegador (datos.js) y el monitoreo del servidor
// (src/monitor.js): cómo se guarda un punto del historial, cómo se compacta y
// cuándo un precio merece un aviso. Sin DOM ni localStorage.

export const MINUTO = 60_000;
export const DIA = 24 * 60 * MINUTO;

export const DIAS_RETENIDOS = 365;
export const MAX_PUNTOS = 200;
// Pasados 90 días se deja un punto por semana (el más barato) para que un año
// entero quepa en el navegador.
export const DIAS_DETALLE = 90;

const VENTANA_MINIMO = 7 * DIA;
const PUNTOS_MINIMOS = 3;
const BAJA_MINIMA = 0.03;

const sinTildes = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export function claveDe(tiendaId, p) {
  return `${tiendaId}|${p.url || sinTildes(p.nombre)}`;
}

// Lo que se guarda de cada lectura: t fecha, p precio, d disponible y, si la
// tienda los da, s unidades en stock, a precio tachado y n nota de la oferta.
export function punto(p, t) {
  const x = { t, p: p.precio, d: Boolean(p.disponible) };
  if (Number.isFinite(p.stock)) x.s = p.stock;
  if (p.precioAntes > p.precio) x.a = p.precioAntes;
  if (p.nota) x.n = p.nota;
  return x;
}

// Agrega la lectura a la serie; si la anterior tiene menos de `agrupa` ms, la
// reemplaza en vez de duplicarla.
export function sumarPunto(serie, x, agrupa) {
  const ultimo = serie[serie.length - 1];
  if (ultimo && x.t - ultimo.t < agrupa && x.t >= ultimo.t) serie[serie.length - 1] = x;
  else {
    serie.push(x);
    if (ultimo && x.t < ultimo.t) serie.sort((a, b) => a.t - b.t);
  }
}

export function podar(serie, ahora) {
  while (serie.length && ahora - serie[0].t > DIAS_RETENIDOS * DIA) serie.shift();
  compactar(serie, ahora);
  if (serie.length > MAX_PUNTOS) serie.splice(0, serie.length - MAX_PUNTOS);
}

function compactar(serie, ahora) {
  const semanas = new Map();
  const recientes = [];
  for (const x of serie) {
    if (ahora - x.t <= DIAS_DETALLE * DIA) {
      recientes.push(x);
      continue;
    }
    const semana = Math.floor(x.t / (7 * DIA));
    const previo = semanas.get(semana);
    if (!previo || x.p < previo.p) semanas.set(semana, x);
  }
  if (semanas.size + recientes.length === serie.length) return;
  serie.splice(0, serie.length, ...[...semanas.values()].sort((a, b) => a.t - b.t), ...recientes);
}

// "Punto dulce": el precio baja más de 3 % por debajo del mínimo de lo que se
// registró hace más de 7 días (con al menos 3 registros). Devuelve ese mínimo.
export function puntoDulce(serie, precio, ahora) {
  const precios = serie.filter((x) => ahora - x.t > VENTANA_MINIMO).map((x) => x.p).filter((x) => x > 0);
  if (precios.length < PUNTOS_MINIMOS) return null;
  const antes = Math.min(...precios);
  return precio <= antes * (1 - BAJA_MINIMA) ? antes : null;
}

// ── Stock ───────────────────────────────────────────────────────────────────
export const POCAS_UNIDADES = 5;
export const DIAS_AVISO_AGOTA = 3;

// Velocidad de venta con las lecturas de stock de los últimos 14 días, desde
// la última reposición (si el stock sube, la tienda repuso y se cuenta de ahí).
// Devuelve { actual, porDia, dias } o null si la tienda no publica su stock.
export function prediccionStock(serie, ahora) {
  let ventana = serie.filter((x) => Number.isFinite(x.s) && ahora - x.t <= 14 * DIA);
  if (!ventana.length) return null;
  for (let i = ventana.length - 1; i > 0; i--) {
    if (ventana[i].s > ventana[i - 1].s) {
      ventana = ventana.slice(i);
      break;
    }
  }
  const actual = ventana[ventana.length - 1].s;
  if (ventana.length < 3 || ventana[ventana.length - 1].t - ventana[0].t < DIA / 2) return { actual, porDia: 0, dias: null };
  const n = ventana.length;
  const mt = ventana.reduce((s, x) => s + x.t, 0) / n;
  const ms = ventana.reduce((s, x) => s + x.s, 0) / n;
  let cov = 0;
  let varianza = 0;
  for (const x of ventana) {
    cov += (x.t - mt) * (x.s - ms);
    varianza += (x.t - mt) ** 2;
  }
  const porDia = varianza ? (-cov / varianza) * DIA : 0;
  return { actual, porDia: Math.max(0, porDia), dias: porDia > 0 ? actual / porDia : null };
}

// ── Cambios de condiciones ─────────────────────────────────────────────────
// Compara la lectura nueva con la anterior y devuelve los eventos que valen un
// aviso: se agotó, volvió, empezó una oferta o el stock está por acabarse.
// `avisado` recuerda el aviso de agotamiento para no repetirlo en cada revisión.
export function cambios(serie, x, avisado = {}) {
  const previo = serie[serie.length - 1];
  const eventos = [];
  if (previo) {
    if (previo.d && !x.d) eventos.push({ tipo: 'agotado' });
    if (!previo.d && x.d) eventos.push({ tipo: 'volvio' });
    const conOferta = (y) => Boolean(y.a || y.n);
    if (x.d && conOferta(x) && !conOferta(previo)) eventos.push({ tipo: 'oferta', a: x.a ?? null, n: x.n ?? null });
  }
  const pred = prediccionStock([...serie, x], x.t);
  const repuso = previo && Number.isFinite(previo.s) && Number.isFinite(x.s) && x.s > previo.s;
  if (repuso || !x.d) delete avisado.agota;
  if (x.d && pred && !avisado.agota && (pred.actual <= POCAS_UNIDADES || (pred.dias !== null && pred.dias <= DIAS_AVISO_AGOTA))) {
    eventos.push({ tipo: 'agota', stock: pred.actual, dias: pred.dias });
    avisado.agota = x.t;
  }
  return eventos;
}
