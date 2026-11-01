import * as aguapure from './tiendas/aguapure.js';
import * as bevgo from './tiendas/bevgo.js';
import * as carulla from './tiendas/carulla.js';
import * as d1 from './tiendas/d1.js';
import * as dislicores from './tiendas/dislicores.js';
import * as exito from './tiendas/exito.js';
import * as jumbo from './tiendas/jumbo.js';
import * as makro from './tiendas/makro.js';
import * as olimpica from './tiendas/olimpica.js';
import {
  codigoBarras,
  consultaParaTienda,
  extraerGrados,
  filtrarProductos,
  firmaProducto,
  inferirPaquete,
  marcarVariantes,
  miniatura,
  mlPorUnidad,
  normalizar,
  palabrasClave,
  sugerirConsulta,
} from './normalizar.js';
import { Bloqueo } from './http.js';
import { comoTienda, idTienda, leerProveedores } from './proveedores.js';

// Todas las tiendas que la app sabe consultar. Las que tienen `porDefecto:
// false` solo se consultan si se activan en Ajustes.
export const TIENDAS = [bevgo, dislicores, exito, makro, olimpica, aguapure, d1, carulla, jumbo];
export const POR_DEFECTO = TIENDAS.filter(({ tienda }) => tienda.porDefecto !== false).map(({ tienda }) => tienda.id);

// Tiendas cuyo buscador encuentra un producto por su código de barras.
const BUSCAN_CODIGO = new Set(['dislicores', 'exito', 'olimpica', 'd1', 'carulla', 'jumbo']);

const CACHE_MINUTOS = 10;
const LIMITE_MS = 9000; // cada tienda tiene este tiempo en total (Netlify corta a los 10 s)
const MAX_CACHE = 400;

// Caché por tienda y por lo que se le pidió a esa tienda: si una tienda falla,
// las demás no se vuelven a consultar en los próximos 10 minutos.
const cache = new Map();

// ── Estadísticas de cada tienda (para la página «Estado de las tiendas») ────
const estadisticas = new Map();

function anotar(id, { ok, ms, n = 0, error = null }) {
  const e = estadisticas.get(id) || { consultas: 0, fallos: 0, msPromedio: null, ultimoOk: null, ultimoFallo: null, ultimoError: null, ultimoN: null };
  e.consultas++;
  e.msPromedio = e.msPromedio === null ? ms : Math.round(e.msPromedio * 0.8 + ms * 0.2);
  if (ok) {
    e.ultimoOk = Date.now();
    e.ultimoN = n;
  } else {
    e.fallos++;
    e.ultimoFallo = Date.now();
    e.ultimoError = error;
  }
  estadisticas.set(id, e);
}

export function estadoTiendas() {
  return TIENDAS.map(({ tienda }) => ({ ...tienda, ...(estadisticas.get(tienda.id) || { consultas: 0, fallos: 0 }) }));
}

export function limpiarCache() {
  cache.clear();
}

function conLimite(promesa, ms = LIMITE_MS) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(Object.assign(new Error('tiempo'), { name: 'TimeoutError' })), Math.max(0, ms));
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

// Datos que se calculan igual para todas las tiendas.
function completar(p) {
  const grados = extraerGrados(p.nombre);
  const paquete = inferirPaquete(p.nombre, mlPorUnidad(p.ml, p.unidades), p.unidades);
  const salida = { ...p, ...paquete, grados, imagen: miniatura(p.imagen), imagenGrande: p.imagen ?? null };
  salida.firma = firmaProducto(salida);
  return salida;
}

// Lo que devuelve la tienda para `texto`, desde la caché si es reciente.
async function crudos(modulo, texto, ms, { fresco = false } = {}) {
  const clave = `${modulo.tienda.id}|${normalizar(texto)}`;
  const guardado = cache.get(clave);
  if (!fresco && !modulo.tienda.propio && guardado && Date.now() - guardado.hora < CACHE_MINUTOS * 60_000) return { ...guardado, enCache: true };
  const inicio = Date.now();
  const todos = (await conLimite(modulo.buscar(texto), ms))
    .filter((p) => Number.isFinite(p.precio) && p.precio > 0)
    .map(completar);
  const entrada = { hora: Date.now(), todos, ms: Date.now() - inicio };
  cache.set(clave, entrada);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
  return entrada;
}

// Consulta una tienda y deja solo los productos que `elegir` acepta.
async function consultar(modulo, texto, elegir, ms = LIMITE_MS, opciones = {}) {
  const { tienda } = modulo;
  const inicio = Date.now();
  try {
    const { todos, hora, enCache } = await crudos(modulo, texto, ms, opciones);
    const productos = elegir(todos).map((p) => ({ ...p }));
    if (!enCache && !tienda.propio) anotar(tienda.id, { ok: true, ms: Date.now() - inicio, n: todos.length });
    return { ...tienda, ok: true, productos, descartados: todos.length - productos.length, ms: Date.now() - inicio, hora, _crudos: todos };
  } catch (error) {
    console.error(`[${tienda.id}]`, error.message);
    const mensaje = mensajeError(error);
    if (!tienda.propio) anotar(tienda.id, { ok: false, ms: Date.now() - inicio, error: mensaje });
    return { ...tienda, ok: false, error: mensaje, productos: [], ms: Date.now() - inicio, _crudos: [] };
  }
}

// Las tiendas que se consultan: las de la app que se pidieron (o las de
// siempre) más los proveedores propios activos (cada uno se prende o se apaga
// en su ficha).
export function elegirTiendas(ids, proveedores = []) {
  const propios = proveedores.filter((p) => p.activo).map(comoTienda);
  const pedidas = Array.isArray(ids) ? new Set(ids.map(String)) : null;
  const elegidas = pedidas ? TIENDAS.filter(({ tienda }) => pedidas.has(tienda.id)) : [];
  const base = elegidas.length ? elegidas : TIENDAS.filter(({ tienda }) => POR_DEFECTO.includes(tienda.id));
  return [...base, ...propios];
}

// Tiendas de la app + proveedores propios, para Ajustes.
export async function catalogoTiendas() {
  const proveedores = await leerProveedores().catch(() => []);
  return [
    ...TIENDAS.map(({ tienda }) => ({ id: tienda.id, nombre: tienda.nombre, alcance: tienda.alcance, porDefecto: tienda.porDefecto !== false })),
    ...proveedores.map((p) => ({ id: idTienda(p), nombre: p.nombre, alcance: p.alcance, porDefecto: p.activo, propio: true })),
  ];
}

export async function comparar(consulta, { tiendas, fresco = false } = {}) {
  const proveedores = await leerProveedores().catch((e) => (console.error('[proveedores]', e.message), []));
  const modulos = elegirTiendas(tiendas, proveedores);
  const codigo = codigoBarras(consulta);
  const resultados = codigo ? await porCodigo(codigo, modulos, { fresco }) : await porNombre(consulta, modulos, { fresco });

  const datos = { consulta, consultadoEn: new Date().toISOString(), tiendas: resultados };
  if (codigo) datos.codigo = codigo;
  else {
    marcarVariantes(resultados, palabrasClave(consulta));
    // «¿Quisiste decir…?» cuando nada coincide o una palabra no aparece en ningún nombre.
    const sugerencia = sugerirConsulta(consulta, resultados.flatMap((r) => r._crudos));
    if (sugerencia && normalizar(sugerencia) !== normalizar(consulta)) datos.sugerencia = sugerencia;
  }
  for (const r of resultados) delete r._crudos;
  return datos;
}

function porNombre(consulta, modulos, opciones) {
  const palabras = palabrasClave(consulta);
  const enTienda = consultaParaTienda(consulta);
  return Promise.all(modulos.map((m) => consultar(m, enTienda, (todos) => filtrarProductos(todos, palabras), LIMITE_MS, opciones)));
}

// Búsqueda por código de barras: las tiendas que lo indexan devuelven el
// producto exacto; con el nombre y el tamaño del primero que aparezca se busca
// en las demás (exigiendo el mismo tamaño y empaque).
async function porCodigo(codigo, modulos, opciones) {
  const inicio = Date.now();
  const conCodigo = modulos
    .filter(({ tienda }) => BUSCAN_CODIGO.has(tienda.id))
    .map((m) => consultar(m, codigo, (todos) => todos.filter((p) => p.ean === codigo), LIMITE_MS, opciones));
  const referencia = Promise.all(conCodigo).then((rs) => rs.flatMap((r) => r.productos));

  // Un proveedor propio puede tener el código anotado; si no, se busca por nombre como en las demás.
  const propios = modulos.filter(({ tienda }) => tienda.propio).map(async (m) => {
    const productos = await referencia;
    const ref = productos.length ? productoReferencia(productos) : null;
    const palabras = ref ? palabrasClave(palabrasNombre(ref.nombre).slice(0, 3).join(' ')) : [];
    return consultar(m, codigo, (todos) => {
      const exactos = todos.filter((p) => p.ean === codigo);
      if (exactos.length || !ref) return exactos;
      return filtrarProductos(todos, palabras)
        .filter((p) => p.ml === ref.ml && (p.unidades || 1) === (ref.unidades || 1))
        .map((p) => ({ ...p, porNombre: true }));
    });
  });

  const sinCodigo = modulos.filter(({ tienda }) => !BUSCAN_CODIGO.has(tienda.id) && !tienda.propio).map(async (m) => {
    const productos = await referencia;
    if (!productos.length) return { ...m.tienda, ok: true, productos: [], descartados: 0, ms: Date.now() - inicio, _crudos: [] };
    const ref = productoReferencia(productos);
    const intentar = (enTienda) =>
      consultar(
        m,
        enTienda,
        (todos) =>
          filtrarProductos(todos, palabrasClave(enTienda))
            .filter((p) => p.ml === ref.ml && (p.unidades || 1) === (ref.unidades || 1))
            .map((p) => ({ ...p, porNombre: true })),
        LIMITE_MS - (Date.now() - inicio),
        opciones,
      ).then((r) => ({ ...r, buscadoComo: enTienda }));
    const palabras = palabrasNombre(ref.nombre);
    const resultado = await intentar(palabras.slice(0, 3).join(' '));
    // Una palabra escrita distinto ("antioqueno" / "antioqueño") deja la búsqueda
    // vacía: se reintenta con dos, si queda tiempo.
    if (resultado.ok && !resultado.productos.length && palabras.length > 2 && Date.now() - inicio < LIMITE_MS - 3000) {
      return intentar(palabras.slice(0, 2).join(' '));
    }
    return resultado;
  });
  const todos = await Promise.all([...conCodigo, ...sinCodigo, ...propios]);
  return modulos.map(({ tienda }) => todos.find((x) => x.id === tienda.id));
}

// Palabras del nombre tal como vienen (con tildes: el buscador de la tienda
// las necesita), sin números, tamaños ni signos.
const palabrasNombre = (nombre) =>
  nombre
    .toLowerCase()
    .split(/[^a-záéíóúüñ]+/)
    .filter((p) => p.length >= 3 && !['con', 'sin', 'por', 'del'].includes(p));

// El tamaño más repetido entre los productos con ese código y, de ese tamaño,
// el nombre más completo (algunas tiendas abrevian: "AGUARDIENT ANTIOQ").
function productoReferencia(productos) {
  const conteo = new Map();
  for (const p of productos) if (p.ml) conteo.set(p.ml, (conteo.get(p.ml) || 0) + 1);
  const ml = [...conteo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const candidatos = productos.filter((p) => p.ml === ml);
  const completas = (p) => palabrasNombre(p.nombre).filter((x) => x.length >= 5).length;
  return candidatos.sort((a, b) => completas(b) - completas(a))[0] || productos[0];
}

function mensajeError(error) {
  if (error.name === 'TimeoutError') return 'La tienda tardó demasiado en responder';
  if (error instanceof Bloqueo) return 'La tienda frenó las consultas por ahora; intenta en unos minutos';
  if (/HTTP \d+/.test(error.message)) return `La tienda respondió con error (${error.message})`;
  if (error.message === 'fetch failed') return 'No se pudo conectar con la tienda';
  return error.message || 'Error desconocido';
}
