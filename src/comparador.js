import * as aguapure from './tiendas/aguapure.js';
import * as bevgo from './tiendas/bevgo.js';
import * as dislicores from './tiendas/dislicores.js';
import * as exito from './tiendas/exito.js';
import * as makro from './tiendas/makro.js';
import * as olimpica from './tiendas/olimpica.js';
import { codigoBarras, consultaParaTienda, filtrarProductos, normalizar, palabrasClave } from './normalizar.js';
import { Bloqueo } from './http.js';

export const TIENDAS = [bevgo, dislicores, exito, makro, olimpica, aguapure];

// Tiendas cuyo buscador encuentra un producto por su código de barras.
const BUSCAN_CODIGO = new Set(['dislicores', 'exito', 'olimpica']);

const CACHE_MINUTOS = 10;
const LIMITE_MS = 9000; // cada tienda tiene este tiempo en total (Netlify corta a los 10 s)
const cache = new Map();

function conLimite(promesa, ms = LIMITE_MS) {
  let reloj;
  const limite = new Promise((_, rechazar) => {
    reloj = setTimeout(() => rechazar(Object.assign(new Error('tiempo'), { name: 'TimeoutError' })), Math.max(0, ms));
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
}

// Consulta una tienda y deja solo los productos que `elegir` acepta.
async function consultar(tienda, buscar, elegir, ms = LIMITE_MS) {
  const inicio = Date.now();
  try {
    const todos = (await conLimite(buscar(), ms)).filter((p) => Number.isFinite(p.precio) && p.precio > 0);
    const productos = elegir(todos);
    return { ...tienda, ok: true, productos, descartados: todos.length - productos.length, ms: Date.now() - inicio };
  } catch (error) {
    console.error(`[${tienda.id}]`, error.message);
    return { ...tienda, ok: false, error: mensajeError(error), productos: [], ms: Date.now() - inicio };
  }
}

export async function comparar(consulta) {
  const clave = normalizar(consulta);
  const guardado = cache.get(clave);
  if (guardado && Date.now() - guardado.hora < CACHE_MINUTOS * 60_000) return guardado.datos;

  const codigo = codigoBarras(consulta);
  const resultados = codigo ? await porCodigo(codigo) : await porNombre(consulta);

  const datos = { consulta, consultadoEn: new Date().toISOString(), tiendas: resultados };
  if (codigo) datos.codigo = codigo;
  // Solo se guarda en caché si todas las tiendas respondieron.
  if (resultados.every((r) => r.ok)) {
    cache.set(clave, { hora: Date.now(), datos });
    if (cache.size > 200) cache.delete(cache.keys().next().value);
  }
  return datos;
}

function porNombre(consulta) {
  const palabras = palabrasClave(consulta);
  const enTienda = consultaParaTienda(consulta);
  return Promise.all(TIENDAS.map(({ tienda, buscar }) => consultar(tienda, () => buscar(enTienda), (todos) => filtrarProductos(todos, palabras))));
}

// Búsqueda por código de barras: las tiendas que lo indexan devuelven el
// producto exacto; con el nombre y el tamaño del primero que aparezca se busca
// en las demás (exigiendo el mismo tamaño y empaque).
async function porCodigo(codigo) {
  const inicio = Date.now();
  const conCodigo = TIENDAS.filter(({ tienda }) => BUSCAN_CODIGO.has(tienda.id)).map(({ tienda, buscar }) =>
    consultar(tienda, () => buscar(codigo), (todos) => todos.filter((p) => p.ean === codigo)),
  );
  const referencia = Promise.all(conCodigo).then((rs) => rs.flatMap((r) => r.productos));

  const sinCodigo = TIENDAS.filter(({ tienda }) => !BUSCAN_CODIGO.has(tienda.id)).map(async ({ tienda, buscar }) => {
    const productos = await referencia;
    if (!productos.length) return { ...tienda, ok: true, productos: [], descartados: 0, ms: Date.now() - inicio };
    const ref = productoReferencia(productos);
    const intentar = (enTienda) =>
      consultar(
        tienda,
        () => buscar(enTienda),
        (todos) =>
          filtrarProductos(todos, palabrasClave(enTienda))
            .filter((p) => p.ml === ref.ml && (p.unidades || 1) === (ref.unidades || 1))
            .map((p) => ({ ...p, porNombre: true })),
        LIMITE_MS - (Date.now() - inicio),
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
  return Promise.all([...conCodigo, ...sinCodigo]).then((r) => TIENDAS.map(({ tienda }) => r.find((x) => x.id === tienda.id)));
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
  return error.message || 'Error desconocido';
}
