// Monitoreo automático de "Mi lista": la función programada revisa cada
// producto de la lista cada pocas horas, guarda su historial y genera avisos,
// aunque nadie abra la app. El navegador baja lo nuevo con /api/monitoreo.
import { comparar } from './comparador.js';
import { leer, escribir, borrar } from './almacen.js';
import { codigoBarras, coincide, normalizar, palabrasClave } from './normalizar.js';
import { cambios, claveDe, DIA, podar, punto, puntoDulce, sumarPunto } from '../public/reglas.js';

export const MAX_ITEMS = 60;
const CADA_HORAS = 6;
const AGRUPA = 3 * 60 * 60_000; // dos lecturas a menos de 3 h se funden en una
const POR_TIENDA = 12; // productos guardados por tienda en cada consulta
const OLVIDAR_DIAS = 60; // un producto que no aparece en 60 días sale del monitoreo
const MAX_ALERTAS = 60;
const EN_PARALELO = 3;
const VIGILADOS = 3; // por tienda, los más relevantes reciben avisos de stock y condiciones

// ── Lista ───────────────────────────────────────────────────────────────────
function numeroOpcional(v) {
  const n = Number(v);
  return v === null || v === undefined || v === '' || !Number.isFinite(n) || n < 0 ? null : n;
}

function limpiarItem(x) {
  const id = String(x?.id || '');
  const q = String(x?.q || '').trim().replace(/\s+/g, ' ');
  if (!/^[\w-]{1,40}$/.test(id) || q.length < 2 || q.length > 80) return null;
  return {
    id,
    q,
    umbral: numeroOpcional(x.umbral),
    // Catálogo de reventa: si lo vendo, a cuánto y con qué regla de precio.
    vendo: Boolean(x.vendo),
    venta: numeroOpcional(x.venta),
    modo: x.modo === 'mercado' ? 'mercado' : 'margen',
    margen: numeroOpcional(x.margen),
    bajoMercado: numeroOpcional(x.bajoMercado),
  };
}

export async function leerLista() {
  return (await leer('lista')) || [];
}

export async function guardarLista(items) {
  if (!Array.isArray(items)) throw new TypeError('La lista debe ser un arreglo');
  const vistos = new Set();
  const limpia = [];
  for (const x of items) {
    const item = limpiarItem(x);
    if (!item || vistos.has(item.id)) continue;
    vistos.add(item.id);
    limpia.push(item);
  }
  if (limpia.length > MAX_ITEMS) throw new RangeError(`La lista admite hasta ${MAX_ITEMS} productos`);
  const antes = await leerLista();
  const quitados = antes.filter((viejo) => !vistos.has(viejo.id));
  for (const viejo of quitados) await borrar(`serie/${viejo.id}`);
  if (quitados.length) {
    const estado = (await leer('estado')) || {};
    for (const viejo of quitados) delete estado[viejo.id];
    await escribir('estado', estado);
    // Sus avisos también se van.
    const ids = new Set(quitados.map((x) => x.id));
    const consultas = new Set(quitados.map((x) => normalizar(x.q)));
    const alertas = (await leer('alertas')) || [];
    const quedan = alertas.filter((a) => !ids.has(a.item) && !(a.q && consultas.has(normalizar(a.q))));
    if (quedan.length !== alertas.length) await escribir('alertas', quedan);
  }
  await escribir('lista', limpia);
  return limpia;
}

// Qué productos de una búsqueda son "el" producto de la lista: con un código
// de barras, los que lo tienen (o los que se emparejaron por nombre en las
// tiendas que no lo publican); con texto, los que traen todas las palabras.
function exactoPara(q) {
  const codigo = codigoBarras(q);
  if (codigo) return (p) => p.ean === codigo || Boolean(p.porNombre);
  const palabras = palabrasClave(q);
  return (p) => coincide(p, palabras);
}

// ── Registro ────────────────────────────────────────────────────────────────
// `solo`: false cuando lo llama revisar(), que guarda el estado y los avisos
// de toda la tanda de una vez (las revisiones en paralelo no se pisan).
export async function registrar(item, datos, { ahora = Date.now(), solo = true } = {}) {
  const doc = (await leer(`serie/${item.id}`)) || { productos: {} };
  doc.q = item.q;
  doc.revisado = ahora;
  const avisos = [];
  const base = { q: item.q, item: item.id, t: ahora };
  // Para el precio objetivo y "nadie lo tiene" solo cuentan los productos con
  // todas las palabras de la búsqueda, tamaño incluido (la búsqueda general
  // tolera que falte una).
  const esExacto = exactoPara(item.q);
  let exactos = 0;
  let masBarato = null;
  for (const t of datos.tiendas) {
    if (!t.ok) continue;
    for (const [i, p] of t.productos.slice(0, POR_TIENDA).entries()) {
      if (!(p.precio > 0)) continue;
      if (esExacto(p)) {
        exactos++;
        if (p.disponible && (!masBarato || p.precio < masBarato.precio)) masBarato = { ...p, tienda: t.nombre };
      }
      const clave = claveDe(t.id, p);
      const meta = doc.productos[clave] || (doc.productos[clave] = { puntos: [] });
      Object.assign(meta, {
        nombre: p.nombre,
        tienda: t.id,
        tiendaNombre: t.nombre,
        ml: p.ml ?? null,
        unidades: p.unidades ?? 1,
        url: p.url ?? null,
        ean: p.ean ?? null,
      });
      const antes = puntoDulce(meta.puntos, p.precio, ahora);
      const aviso = { ...base, clave, nombre: p.nombre, tienda: t.nombre, precio: p.precio };
      if (antes) avisos.push({ ...aviso, tipo: 'dulce', antes });
      const x = punto(p, ahora);
      if (i < VIGILADOS) {
        meta.avisado ||= {};
        for (const e of cambios(meta.puntos, x, meta.avisado)) avisos.push({ ...aviso, ...e });
      }
      sumarPunto(meta.puntos, x, AGRUPA);
      podar(meta.puntos, ahora);
    }
  }
  avisos.push(...avisosDeLista(item, doc, datos, masBarato, exactos, base));
  doc.resumen = resumir(datos, esExacto, ahora);
  for (const [clave, meta] of Object.entries(doc.productos)) {
    const ultimo = meta.puntos[meta.puntos.length - 1];
    if (!ultimo || ahora - ultimo.t > OLVIDAR_DIAS * DIA) delete doc.productos[clave];
  }
  await escribir(`serie/${item.id}`, doc);
  if (solo) await cerrarRevision({ [item.id]: ahora }, avisos);
  return avisos;
}

// Avisos del producto de la lista en conjunto: llegó al precio objetivo o
// ninguna tienda lo tiene. `doc.avisado` evita repetirlos en cada revisión.
function avisosDeLista(item, doc, datos, masBarato, exactos, base) {
  const avisos = [];
  const avisado = (doc.avisado ||= {});
  const clave = `lista|${item.id}`;
  if (item.umbral > 0 && masBarato && masBarato.precio <= item.umbral) {
    if (!(avisado.umbral <= masBarato.precio)) {
      avisos.push({ ...base, tipo: 'umbral', clave, nombre: masBarato.nombre, tienda: masBarato.tienda, precio: masBarato.precio, umbral: item.umbral });
      avisado.umbral = masBarato.precio;
    }
  } else delete avisado.umbral;

  const respondieron = datos.tiendas.filter((t) => t.ok).length;
  if (respondieron >= 3 && exactos > 0 && !masBarato) {
    if (!avisado.sinStock) avisos.push({ ...base, tipo: 'sinstock', clave, nombre: item.q, tienda: 'Todas las tiendas', precio: null });
    avisado.sinStock = true;
    doc.sinStock = true;
  } else if (masBarato) {
    delete avisado.sinStock;
    doc.sinStock = false;
  }
  return avisos;
}

// Cómo está el mercado de este producto hoy, para el catálogo: la presentación
// que más tiendas comparan, el más barato de cada tienda y la mediana.
function resumir(datos, esExacto, ahora) {
  const grupos = new Map();
  for (const t of datos.tiendas) {
    if (!t.ok) continue;
    for (const p of t.productos) {
      if (!(p.precio > 0) || !p.ml || !esExacto(p)) continue;
      const clave = `${p.unidades || 1}x${p.ml}`;
      if (!grupos.has(clave)) grupos.set(clave, { ml: p.ml, unidades: p.unidades || 1, tiendas: new Map(), agotados: new Set() });
      const g = grupos.get(clave);
      if (!p.disponible) {
        g.agotados.add(t.id);
        continue;
      }
      const previo = g.tiendas.get(t.id);
      if (!previo || p.precio < previo.precio) {
        g.tiendas.set(t.id, { tienda: t.id, tiendaNombre: t.nombre, precio: p.precio, nombre: p.nombre, url: p.url ?? null });
      }
    }
  }
  const lista = [...grupos.values()].sort(
    (a, b) => b.tiendas.size - a.tiendas.size || b.agotados.size - a.agotados.size,
  );
  const g = lista[0];
  if (!g) return { t: ahora, ofertas: [], sinDatos: true };
  const ofertas = [...g.tiendas.values()].sort((a, b) => a.precio - b.precio);
  const precios = ofertas.map((o) => o.precio);
  const medio = Math.floor(precios.length / 2);
  const mediana = precios.length ? (precios.length % 2 ? precios[medio] : (precios[medio - 1] + precios[medio]) / 2) : null;
  return { t: ahora, ml: g.ml, unidades: g.unidades, ofertas, mediana, agotadas: g.agotados.size, sinDatos: false };
}

async function cerrarRevision(revisados, avisos) {
  const estado = (await leer('estado')) || {};
  Object.assign(estado, revisados);
  await escribir('estado', estado);
  if (avisos.length) await sumarAlertas(avisos);
}

async function sumarAlertas(nuevas) {
  const alertas = (await leer('alertas')) || [];
  for (const a of nuevas) {
    a.id = `${a.tipo}|${a.clave}`;
    const i = alertas.findIndex((x) => x.id === a.id);
    if (i >= 0) alertas.splice(i, 1);
    alertas.unshift(a);
  }
  alertas.sort((a, b) => b.t - a.t);
  await escribir('alertas', alertas.slice(0, MAX_ALERTAS));
}

// Si lo que se buscó a mano es un producto de la lista, también cuenta como revisión.
export async function registrarSiEstaEnLista(consulta, datos) {
  const q = normalizar(consulta);
  const item = (await leerLista()).find((x) => normalizar(x.q) === q);
  if (item) await registrar(item, datos);
}

// ── Revisión programada ─────────────────────────────────────────────────────
export async function revisar({ maximo = 6, ahora = Date.now() } = {}) {
  const lista = await leerLista();
  const estado = (await leer('estado')) || {};
  const vencidos = lista
    .filter((x) => !estado[x.id] || ahora - estado[x.id] >= CADA_HORAS * 60 * 60_000 - 5 * 60_000)
    .sort((a, b) => (estado[a.id] || 0) - (estado[b.id] || 0));
  const pendientes = vencidos.slice(0, maximo);
  const hechos = [];
  for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
    const tanda = pendientes.slice(i, i + EN_PARALELO);
    const resultados = await Promise.all(
      tanda.map(async (item) => {
        try {
          const datos = await comparar(item.q);
          // Si todas las tiendas fallaron no se marca como revisado: se reintenta en la próxima.
          if (!datos.tiendas.some((t) => t.ok)) return { q: item.q, ok: false };
          const avisos = await registrar(item, datos, { ahora, solo: false });
          return { id: item.id, q: item.q, ok: true, avisos };
        } catch (error) {
          console.error('[monitor]', item.q, error.message);
          return { q: item.q, ok: false };
        }
      }),
    );
    const ok = resultados.filter((x) => x.ok);
    await cerrarRevision(Object.fromEntries(ok.map((x) => [x.id, ahora])), ok.flatMap((x) => x.avisos));
    hechos.push(...resultados.map(({ q, ok: bien, avisos }) => ({ q, ok: bien, avisos: avisos?.length ?? 0 })));
  }
  return { revisados: hechos, quedan: vencidos.length - pendientes.length };
}

// ── Lo nuevo para el navegador ─────────────────────────────────────────────
export async function novedades(desde = 0) {
  const ahora = Date.now();
  const lista = await leerLista();
  const estado = (await leer('estado')) || {};
  const series = {};
  const resumenes = {};
  for (const item of lista) {
    const doc = await leer(`serie/${item.id}`);
    if (doc?.resumen) resumenes[item.id] = doc.resumen;
    for (const [clave, meta] of Object.entries(doc?.productos || {})) {
      const puntos = meta.puntos.filter((x) => x.t > desde);
      if (puntos.length) series[clave] = puntos;
    }
  }
  const alertas = ((await leer('alertas')) || []).filter((a) => a.t > desde);
  return { ahora, lista, revisado: estado, series, alertas, resumenes };
}
