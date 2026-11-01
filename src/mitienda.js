// Mi tienda: la carta propia (Agua Pure en TRIVO POS, o un proveedor propio)
// comparada producto por producto con el resto del mercado. Sin credenciales
// se usan los precios de venta públicos; los costos se anotan a mano.
import { createHash } from 'node:crypto';
import { actualizar, leer } from './almacen.js';
import { comparar } from './comparador.js';
import { leerConfig } from './config.js';
import { normalizar, tokens } from './normalizar.js';
import { leerProveedores, idTienda } from './proveedores.js';
import * as aguapure from './tiendas/aguapure.js';

const VIGENCIA_HORAS = 20;
const idDoc = (id) => `mitienda/${createHash('sha1').update(String(id)).digest('hex').slice(0, 20)}`;

// Palabras que describen cómo se vende, no qué es: no ayudan a encontrarlo en otras tiendas.
const SOBRAN = new Set([
  'x', 'de', 'y', 'con', 'unidades', 'unidad', 'und', 'lata', 'latas', 'botella', 'caliente', 'fria', 'frias', 'caja',
  'hielo', 'kilos', 'kg', 'paquete', 'six', 'pack', 'ml', 'cc', 'litro', 'litros', 'l',
  // Los buscadores de las tiendas devuelven menos resultados con estas.
  'original', 'tradicional', 'clasica', 'clasico', 'nacional',
]);

// "Aguila Original x 330ml (lata) Fria" → "cerveza aguila original 330".
export function consultaDe(p) {
  const palabras = String(p.base || p.nombre)
    .toLowerCase()
    .replace(/[()+]/g, ' ')
    .split(/\s+/)
    .filter((w) => {
      const t = tokens(w)[0];
      return t && !SOBRAN.has(t) && !/\d/.test(t);
    });
  const esCerveza = /cervez|cab[aá]s/i.test(p.seccion || '') && !palabras.some((w) => normalizar(w) === 'cerveza');
  return [esCerveza ? 'cerveza' : '', ...palabras, p.ml ? String(p.ml) : ''].filter(Boolean).join(' ').slice(0, 80);
}

// La carta propia con los datos que el análisis necesita.
export async function catalogoPropio(miTienda) {
  if (miTienda === 'aguapure') {
    const productos = await aguapure.catalogo();
    // El hielo de las cajas «+ Hielo (3 kilos)» vale lo que cobras por 3 kg de hielo.
    const hielo3 = productos.find((p) => /hielo/i.test(p.seccion) && /\b3\s*kg/i.test(p.nombre));
    return productos.map((p) => ({ ...p, valorHielo: p.conHielo && hielo3 ? hielo3.precio : 0, consulta: consultaDe(p) }));
  }
  const prov = (await leerProveedores()).find((x) => idTienda(x) === miTienda);
  if (!prov) throw new TypeError('Elige tu tienda en Ajustes → Mi tienda');
  return prov.productos.map((p, i) => ({ ...p, id: `${i}-${normalizar(p.nombre).slice(0, 40)}`, base: p.nombre, seccion: '', variante: null, valorHielo: 0, consulta: consultaDe(p) }));
}

// Compara un producto propio con las demás tiendas: el mismo paquete y, si no
// hay, el precio por unidad del mismo tamaño.
export function resumirMercado(producto, datos) {
  const exactos = new Map();
  let porUnidad = null;
  for (const t of datos.tiendas) {
    if (!t.ok || t.miTienda) continue;
    for (const p of t.productos) {
      if (!p.disponible || p.otraVariante || !(p.precio > 0) || p.ml !== producto.ml) continue;
      const unidades = p.unidades || 1;
      if (unidades === (producto.unidades || 1)) {
        const previo = exactos.get(t.id);
        if (!previo || p.precio < previo.precio) exactos.set(t.id, { tienda: t.id, tiendaNombre: t.nombre, nombre: p.nombre, precio: p.precio, url: p.url ?? null });
      }
      const unidad = p.precio / unidades;
      if (!porUnidad || unidad < porUnidad.precioUnidad) porUnidad = { precioUnidad: unidad, tienda: t.id, tiendaNombre: t.nombre, nombre: p.nombre, unidades, precio: p.precio };
    }
  }
  const ofertas = [...exactos.values()].sort((a, b) => a.precio - b.precio);
  const precios = ofertas.map((o) => o.precio);
  const medio = Math.floor(precios.length / 2);
  const mediana = precios.length ? (precios.length % 2 ? precios[medio] : (precios[medio - 1] + precios[medio]) / 2) : null;
  // La referencia es lo más barato a lo que un cliente puede llegar: el mismo
  // paquete en otra tienda o, si sale menos, juntar paquetes más chicos (cuatro
  // six pack en vez de una caja de 24).
  const equivalente = porUnidad ? Math.round(porUnidad.precioUnidad * (producto.unidades || 1)) : null;
  let referencia = null;
  if (ofertas.length && (!equivalente || ofertas[0].precio <= equivalente)) {
    referencia = { precio: ofertas[0].precio, fuente: 'mismo-paquete', tienda: ofertas[0].tiendaNombre };
  } else if (equivalente) {
    referencia = {
      precio: equivalente,
      fuente: 'por-unidad',
      tienda: porUnidad.tiendaNombre,
      detalle: `${porUnidad.nombre} (${porUnidad.unidades > 1 ? `${porUnidad.unidades} u. a ` : ''}$${Math.round(porUnidad.precio).toLocaleString('es-CO')})`,
    };
  }
  const respondieron = datos.tiendas.filter((t) => t.ok && !t.miTienda).length;
  return { ofertas, mediana, referencia, porUnidad, respondieron };
}

export async function analizarProducto(id, { ahora = Date.now() } = {}) {
  const config = await leerConfig();
  if (!config.miTienda) throw new TypeError('Elige tu tienda en Ajustes → Mi tienda');
  const producto = (await catalogoPropio(config.miTienda)).find((p) => p.id === String(id));
  if (!producto) throw new TypeError('Ese producto ya no está en tu carta');
  if (!producto.ml) {
    const resultado = { t: ahora, consulta: producto.consulta, sinTamano: true, ofertas: [], referencia: null };
    await actualizar(idDoc(producto.id), () => resultado);
    return resultado;
  }
  const datos = await comparar(producto.consulta, { tiendas: config.tiendas, excluir: [config.miTienda] });
  const resultado = { t: ahora, consulta: producto.consulta, ...resumirMercado(producto, datos) };
  await actualizar(idDoc(producto.id), () => resultado);
  return resultado;
}

export async function leerCostos() {
  return (await leer('mitienda-costos')) || {};
}

export async function guardarCostos(cambios) {
  if (!cambios || typeof cambios !== 'object' || Array.isArray(cambios)) throw new TypeError('Costos no válidos');
  return actualizar('mitienda-costos', (actual) => {
    const costos = { ...(actual || {}) };
    for (const [id, v] of Object.entries(cambios)) {
      if (!/^[\w-]{1,80}$/.test(id)) continue;
      const n = Number(v);
      if (v === null || v === '' || !Number.isFinite(n) || n <= 0) delete costos[id];
      else if (n < 1e9) costos[id] = n;
    }
    return costos;
  });
}

// La carta con el último análisis de cada producto y los costos anotados.
export async function estadoMiTienda() {
  const config = await leerConfig();
  if (!config.miTienda) return { miTienda: null, productos: [], costos: {} };
  const [productos, costos] = await Promise.all([catalogoPropio(config.miTienda), leerCostos()]);
  const resultados = await Promise.all(productos.map((p) => leer(idDoc(p.id))));
  return {
    miTienda: config.miTienda,
    productos: productos.map((p, i) => ({ ...p, resultado: resultados[i] })),
    costos,
  };
}

// Para el monitoreo: los productos con el análisis más viejo (más de 20 h).
export async function refrescarMiTienda({ maximo = 4, ahora = Date.now() } = {}) {
  const { miTienda, productos } = await estadoMiTienda();
  if (!miTienda) return 0;
  const viejos = productos
    .filter((p) => p.ml && (!p.resultado || ahora - p.resultado.t > VIGENCIA_HORAS * 60 * 60_000))
    .sort((a, b) => (a.resultado?.t || 0) - (b.resultado?.t || 0))
    .slice(0, maximo);
  for (const p of viejos) await analizarProducto(p.id, { ahora }).catch((e) => console.error('[mi tienda]', p.nombre, e.message));
  return viejos.length;
}
