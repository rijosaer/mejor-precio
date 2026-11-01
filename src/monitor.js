// Monitoreo automático de "Mi lista": la función programada revisa cada
// producto de la lista cada pocas horas, guarda su historial y genera avisos,
// aunque nadie abra la app. El navegador baja lo nuevo con /api/monitoreo.
//
// Cada producto tiene sus propias claves (serie/<id> y alertas/<id>): así una
// búsqueda a mano y la revisión programada no se pisan un documento común.
import { createHash } from 'node:crypto';
import { comparar } from './comparador.js';
import { actualizar, borrar, leer } from './almacen.js';
import { horaLocal, leerConfig } from './config.js';
import { refrescarMiTienda, refrescarTrivo } from './mitienda.js';
import { notificarAvisos } from './push.js';
import { codigoBarras, coincide, normalizar, palabrasClave } from './normalizar.js';
import { cambios, claveDe, DIA, podar, punto, puntoDulce, sumarPunto } from '../public/reglas.js';

export const MAX_ITEMS = 60;
const AGRUPA = 3 * 60 * 60_000; // dos lecturas a menos de 3 h se funden en una
const AGRUPA_CONSULTA = 30 * 60_000;
const POR_TIENDA = 12; // productos guardados por tienda en cada consulta
const OLVIDAR_DIAS = 60; // un producto que no aparece en 60 días sale del monitoreo
const MAX_ALERTAS = 30; // por producto
const EN_PARALELO = 3;
const VIGILADOS = 3; // por tienda, los más relevantes reciben avisos de stock y condiciones
const SISTEMA = '_sistema'; // avisos que no son de un producto: tiendas caídas, resumen semanal
// Búsqueda de control para saber si cada tienda sigue respondiendo: se mira
// cuántos productos devuelve su buscador, no cuántos coinciden.
export const CANARIO = 'aguila';

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
    // Inventario: aviso cuando quedan estas unidades o menos.
    stockMinimo: numeroOpcional(x.stockMinimo),
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
  let quitados = [];
  await actualizar('lista', (antes) => {
    quitados = (antes || []).filter((viejo) => !vistos.has(viejo.id));
    return limpia;
  });
  // Su historial y sus avisos también se van.
  await Promise.all(quitados.flatMap((viejo) => [borrar(`serie/${viejo.id}`), borrar(`alertas/${viejo.id}`)]));
  return limpia;
}

// Qué productos de una búsqueda son "el" producto de la lista: con un código
// de barras, los que lo tienen (o los que se emparejaron por nombre en las
// tiendas que no lo publican); con texto, los que traen todas las palabras y
// no son otra variante (zero, sin azúcar…) que no se pidió.
function exactoPara(q) {
  const codigo = codigoBarras(q);
  if (codigo) return (p) => p.ean === codigo || Boolean(p.porNombre);
  const palabras = palabrasClave(q);
  return (p) => !p.otraVariante && coincide(p, palabras);
}

// ── Registro ────────────────────────────────────────────────────────────────
// `notificar`: false cuando lo llama revisar(), que manda las notificaciones de
// toda la tanda de una vez.
export async function registrar(item, datos, { ahora = Date.now(), notificar = true } = {}) {
  const avisos = [];
  await actualizar(`serie/${item.id}`, (actual) => {
    const doc = actual || { productos: {} };
    doc.q = item.q;
    doc.revisado = ahora;
    const base = { q: item.q, item: item.id, t: ahora };
    // Para el precio objetivo y "nadie lo tiene" solo cuentan los productos con
    // todas las palabras de la búsqueda, tamaño incluido (la búsqueda general
    // tolera que falte una palabra de categoría).
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
    olvidarViejos(doc, ahora);
    return doc;
  });
  if (avisos.length) await sumarAlertas(item.id, avisos);
  if (notificar && avisos.length) await notificarAvisos(avisos, { ahora }).catch((e) => console.error('[push]', e.message));
  return avisos;
}

function olvidarViejos(doc, ahora) {
  for (const [clave, meta] of Object.entries(doc.productos)) {
    const ultimo = meta.puntos[meta.puntos.length - 1];
    if (!ultimo || ahora - ultimo.t > OLVIDAR_DIAS * DIA) delete doc.productos[clave];
  }
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
    // La tienda propia no es un lugar donde comprar para revender.
    if (!t.ok || t.miTienda) continue;
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
        g.tiendas.set(t.id, { tienda: t.id, tiendaNombre: t.nombre, precio: p.precio, nombre: p.nombre, url: p.url ?? null, imagen: p.imagen ?? null });
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

async function sumarAlertas(grupo, nuevas) {
  await actualizar(`alertas/${grupo}`, (actual) => {
    const alertas = actual || [];
    for (const a of nuevas) {
      a.id = `${a.tipo}|${a.clave}`;
      const i = alertas.findIndex((x) => x.id === a.id);
      if (i >= 0) alertas.splice(i, 1);
      alertas.unshift(a);
    }
    alertas.sort((a, b) => b.t - a.t);
    return alertas.slice(0, MAX_ALERTAS);
  });
}

// ── Historial de cualquier búsqueda ────────────────────────────────────────
// Lo que se busca a mano también queda guardado en el servidor (no solo en el
// navegador): sobrevive a borrar los datos del teléfono y lo ven las dos
// personas. Devuelve las series de los productos que aparecieron.
const idConsulta = (q) => createHash('sha1').update(normalizar(q)).digest('hex').slice(0, 20);

export async function registrarBusqueda(consulta, datos, { ahora = Date.now() } = {}) {
  const q = normalizar(consulta);
  const item = (await leerLista()).find((x) => normalizar(x.q) === q);
  let doc;
  if (item) {
    await registrar(item, datos, { ahora });
    doc = await leer(`serie/${item.id}`);
  } else {
    doc = await actualizar(`consulta/${idConsulta(consulta)}`, (actual) => {
      const d = actual || { productos: {} };
      d.q = consulta;
      d.t = ahora;
      for (const t of datos.tiendas) {
        if (!t.ok) continue;
        for (const p of t.productos.slice(0, POR_TIENDA * 2)) {
          if (!(p.precio > 0)) continue;
          const meta = d.productos[claveDe(t.id, p)] || (d.productos[claveDe(t.id, p)] = { puntos: [] });
          sumarPunto(meta.puntos, punto(p, ahora), AGRUPA_CONSULTA);
          podar(meta.puntos, ahora);
        }
      }
      olvidarViejos(d, ahora);
      return d;
    });
  }
  const series = {};
  for (const t of datos.tiendas) {
    for (const p of t.productos) {
      const puntos = doc?.productos?.[claveDe(t.id, p)]?.puntos;
      if (puntos?.length) series[claveDe(t.id, p)] = puntos;
    }
  }
  return series;
}

// ── Migración desde el formato con documentos compartidos ─────────────────
// Antes había un solo documento "alertas" y otro "estado" para toda la lista.
let migrado = false;
export async function migrar() {
  if (migrado) return;
  migrado = true;
  const viejas = await leer('alertas');
  if (Array.isArray(viejas) && viejas.length) {
    const porItem = new Map();
    for (const a of viejas) {
      const grupo = /^[\w-]{1,40}$/.test(a.item || '') ? a.item : SISTEMA;
      porItem.set(grupo, [...(porItem.get(grupo) || []), a]);
    }
    for (const [grupo, lista] of porItem) await sumarAlertas(grupo, lista.reverse());
  }
  if (viejas !== null) await borrar('alertas');
  if ((await leer('estado')) !== null) await borrar('estado');
}

// ── Revisión programada ─────────────────────────────────────────────────────
export async function revisar({ maximo = 6, ahora = Date.now() } = {}) {
  await migrar();
  const [lista, config] = await Promise.all([leerLista(), leerConfig()]);
  const docs = await Promise.all(lista.map((x) => leer(`serie/${x.id}`)));
  const revisado = Object.fromEntries(lista.map((x, i) => [x.id, docs[i]?.revisado || 0]));
  const vencidos = lista
    .filter((x) => ahora - revisado[x.id] >= config.cadaHoras * 60 * 60_000 - 5 * 60_000)
    .sort((a, b) => revisado[a.id] - revisado[b.id]);
  const pendientes = vencidos.slice(0, maximo);
  const hechos = [];
  const avisos = [];
  for (let i = 0; i < pendientes.length; i += EN_PARALELO) {
    const tanda = pendientes.slice(i, i + EN_PARALELO);
    const resultados = await Promise.all(
      tanda.map(async (item) => {
        try {
          const datos = await comparar(item.q, { tiendas: config.tiendas, miTienda: config.miTienda });
          // Si todas las tiendas fallaron no se marca como revisado: se reintenta en la próxima.
          if (!datos.tiendas.some((t) => t.ok)) return { q: item.q, ok: false };
          const nuevos = await registrar(item, datos, { ahora, notificar: false });
          avisos.push(...nuevos);
          return { q: item.q, ok: true, avisos: nuevos.length };
        } catch (error) {
          console.error('[monitor]', item.q, error.message);
          return { q: item.q, ok: false };
        }
      }),
    );
    hechos.push(...resultados.map(({ q, ok, avisos: n }) => ({ q, ok, avisos: n ?? 0 })));
  }
  const sistema = [
    ...(await revisarSalud({ ahora, config }).catch((e) => (console.error('[salud]', e.message), []))),
    ...(await resumenSemanal({ ahora, config, lista }).catch((e) => (console.error('[semanal]', e.message), []))),
  ];
  if (sistema.length) await sumarAlertas(SISTEMA, sistema);
  // Mi tienda: unos pocos productos por hora, así el análisis se mantiene al día solo.
  // Costos, existencias y ventas de TRIVO (solo lectura), cada 6 horas.
  const trivo = await refrescarTrivo({ ahora }).catch((e) => (console.error('[trivo]', e.message), false));
  const miTienda = await refrescarMiTienda({ maximo: pendientes.length ? 2 : 4, ahora }).catch((e) => (console.error('[mi tienda]', e.message), 0));
  // También se llama sin avisos: así salen los que esperaban fuera del horario de silencio.
  await notificarAvisos([...avisos, ...sistema], { ahora }).catch((e) => console.error('[push]', e.message));
  return { revisados: hechos, quedan: vencidos.length - pendientes.length, sistema: sistema.length, miTienda, trivo };
}

// ── Salud de las tiendas ────────────────────────────────────────────────────
// Una vez al día se hace la búsqueda de control. Si una tienda falla o su
// buscador no devuelve nada dos días seguidos, probablemente cambió su página.
export async function revisarSalud({ ahora = Date.now(), config, forzar = false } = {}) {
  const previo = await leer('salud');
  if (!forzar && previo && ahora - previo.t < 20 * 60 * 60_000) return [];
  const datos = await comparar(CANARIO, { tiendas: (config || (await leerConfig())).tiendas, fresco: true });
  const fallas = { ...(previo?.fallas || {}) };
  const avisos = [];
  const tiendas = datos.tiendas.map((t) => {
    const n = t.ok ? t.productos.length + (t.descartados || 0) : 0;
    const mal = !t.ok || n === 0;
    if (mal) {
      fallas[t.id] = (fallas[t.id] || 0) + 1;
      if (fallas[t.id] === 2) {
        avisos.push({
          tipo: 'tienda',
          clave: `tienda|${t.id}`,
          tienda: t.nombre,
          nombre: t.nombre,
          precio: null,
          t: ahora,
          detalle: t.ok ? 'Su buscador no devolvió productos dos días seguidos: puede que haya cambiado su página.' : `Falló dos días seguidos: ${t.error}`,
        });
      }
    } else delete fallas[t.id];
    return { id: t.id, nombre: t.nombre, ok: t.ok && n > 0, n, ms: t.ms, error: t.ok ? (n ? null : 'Sin productos') : t.error };
  });
  await actualizar('salud', () => ({ t: ahora, consulta: CANARIO, tiendas, fallas }));
  return avisos;
}

// ── Resumen semanal ────────────────────────────────────────────────────────
// Los lunes desde las 8 a. m.: qué productos de la lista bajaron o subieron
// frente a hace una semana (el más barato disponible de cada uno).
export function cambiosDeLaSemana(docs, ahora = Date.now()) {
  const filas = [];
  for (const doc of docs) {
    if (!doc?.productos) continue;
    let hoy = null;
    let antes = null;
    for (const meta of Object.values(doc.productos)) {
      for (const x of meta.puntos) {
        if (!x.d || !(x.p > 0)) continue;
        if (ahora - x.t <= 2 * DIA) hoy = hoy === null ? x.p : Math.min(hoy, x.p);
        if (ahora - x.t >= 5 * DIA && ahora - x.t <= 9 * DIA) antes = antes === null ? x.p : Math.min(antes, x.p);
      }
    }
    if (hoy === null || antes === null || hoy === antes) continue;
    filas.push({ q: doc.q, hoy, antes, pct: ((hoy - antes) / antes) * 100 });
  }
  return filas.filter((f) => Math.abs(f.pct) >= 1).sort((a, b) => a.pct - b.pct);
}

async function resumenSemanal({ ahora, config, lista }) {
  if (!config.resumenSemanal || !lista.length) return [];
  const { hora, dia } = horaLocal(ahora);
  if (dia !== 1 || hora < 8) return [];
  const previo = await leer('semanal');
  if (previo && ahora - previo.t < 6 * DIA) return [];
  const docs = await Promise.all(lista.map((x) => leer(`serie/${x.id}`)));
  const filas = cambiosDeLaSemana(docs, ahora);
  await actualizar('semanal', () => ({ t: ahora, filas }));
  if (!filas.length) return [];
  const pct = (f) => `${f.pct > 0 ? '+' : '−'}${Math.abs(f.pct).toFixed(0)} %`;
  const bajaron = filas.filter((f) => f.pct < 0).slice(0, 3).map((f) => `${f.q} ${pct(f)}`);
  const subieron = filas.filter((f) => f.pct > 0).slice(-3).reverse().map((f) => `${f.q} ${pct(f)}`);
  const detalle = [bajaron.length ? `Bajaron: ${bajaron.join(', ')}` : '', subieron.length ? `Subieron: ${subieron.join(', ')}` : ''].filter(Boolean).join('. ');
  return [{ tipo: 'semanal', clave: 'semanal', nombre: 'Resumen de la semana', tienda: 'Mi lista', precio: null, t: ahora, detalle, filas }];
}

// ── Lo nuevo para el navegador ─────────────────────────────────────────────
export async function novedades(desde = 0) {
  await migrar();
  const ahora = Date.now();
  const lista = await leerLista();
  const [docs, alertasPorItem] = await Promise.all([
    Promise.all(lista.map((item) => leer(`serie/${item.id}`))),
    Promise.all([...lista.map((item) => item.id), SISTEMA].map((id) => leer(`alertas/${id}`))),
  ]);
  const series = {};
  const resumenes = {};
  const revisado = {};
  lista.forEach((item, i) => {
    const doc = docs[i];
    if (doc?.revisado) revisado[item.id] = doc.revisado;
    if (doc?.resumen) resumenes[item.id] = doc.resumen;
    for (const [clave, meta] of Object.entries(doc?.productos || {})) {
      const puntos = meta.puntos.filter((x) => x.t > desde);
      if (puntos.length) series[clave] = puntos;
    }
  });
  const alertas = alertasPorItem
    .flatMap((x) => x || [])
    .filter((a) => a.t > desde)
    .sort((a, b) => b.t - a.t);
  return { ahora, lista, revisado, series, alertas, resumenes };
}
