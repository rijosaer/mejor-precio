// Mi tienda: la carta propia (Agua Pure en TRIVO POS, o un proveedor propio)
// comparada producto por producto con el resto del mercado. Con las
// credenciales de TRIVO (src/trivo.js, solo lectura) los costos de compra,
// las existencias y las ventas salen de TRIVO; sin ellas, los costos se anotan a mano.
import { createHash } from 'node:crypto';
import { actualizar, leer } from './almacen.js';
import { comparar } from './comparador.js';
import { leerAjustesCompartidos, leerConfig } from './config.js';
import { extraerMl, normalizar, tokens } from './normalizar.js';
import { leerProveedores, idTienda } from './proveedores.js';
import * as aguapure from './tiendas/aguapure.js';
import { cambiarPrecio, leerTrivo, trivoActivo } from './trivo.js';
import { limpiarMargen, limpiarRegla, MARGEN_POR_DEFECTO, margenSobrePrecio, precioConMargen } from '../public/precios.js';
import { notificarAvisos } from './push.js';

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
  const [productos, costos, trivo, propuestas, historial, margenes] = await Promise.all([
    catalogoPropio(config.miTienda),
    leerCostos(),
    leer('mitienda-trivo'),
    leerPropuestas(),
    leerHistorialPrecios(),
    leerMargenes(),
  ]);
  const resultados = await Promise.all(productos.map((p) => leer(idDoc(p.id))));
  const deTrivo = config.miTienda === 'aguapure' && trivo;
  return {
    miTienda: config.miTienda,
    productos: productos.map((p, i) => ({ ...p, resultado: resultados[i], trivo: deTrivo ? trivo.productos?.[p.id] || null : null })),
    costos,
    margenes,
    propuestas: config.miTienda === 'aguapure' ? propuestas : [],
    historial: config.miTienda === 'aguapure' ? historial.slice(0, 20) : [],
    trivo: config.miTienda === 'aguapure' ? { activo: trivoActivo(), t: trivo?.t ?? null, desde: trivo?.desde ?? null, hasta: trivo?.hasta ?? null, dias: trivo?.dias ?? null, sinPareja: trivo?.sinPareja ?? [], error: trivo?.error ?? null } : null,
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

// ── TRIVO: costos reales, existencias y ventas ──────────────────────────────
const VIGENCIA_TRIVO_HORAS = 1;

// Palabras de la marca: «Caja de Club Colombia x 330 ml + Hielo» → [club, colombia].
const marca = (nombre) => tokens(String(nombre).split(/\s+x\s+/i)[0]).filter((t) => !SOBRAN.has(t) && !/\d/.test(t));
const contiene = (a, b) => b.every((t) => a.includes(t));

// La lata o botella suelta de TRIVO de la que sale un paquete de la carta: el
// mismo tamaño y una marca que contiene a la otra («Miller» ↔ «Miller lite»).
function unidadBase(producto, reventa) {
  if (!producto.ml || !(producto.unidades > 1)) return null;
  const m = marca(producto.base || producto.nombre);
  if (!m.length) return null;
  const candidatos = reventa.filter((r) => {
    if (r.unidad !== 'und' || extraerMl(r.nombre) !== producto.ml) return false;
    const mr = marca(r.nombre);
    return mr.length && (contiene(mr, m) || contiene(m, mr));
  });
  if (candidatos.length === 1) return candidatos[0];
  const exactos = candidatos.filter((r) => marca(r.nombre).join(' ') === m.join(' '));
  return exactos.length === 1 ? exactos[0] : null;
}

// El costo de una unidad suelta: el del producto o, si va por variantes, el de
// la «Caliente» (la lata sin enfriar), o el menor.
function costoUnidad(r) {
  if (r.costo > 0 && !r.variantes.length) return r.costo;
  const conCosto = r.variantes.filter((v) => v.costo > 0);
  const caliente = conCosto.find((v) => /caliente|natural|al clima/i.test(v.nombre));
  if (caliente) return caliente.costo;
  if (conCosto.length) return Math.min(...conCosto.map((v) => v.costo));
  return r.costo > 0 ? r.costo : null;
}

function existenciasDe(r, variante, stock) {
  if (variante) return stock.get(`${r.id}-${variante.id}`) ?? variante.existencias;
  if (r.variantes.length) {
    const suma = r.variantes.reduce((t, v) => t + (stock.get(`${r.id}-${v.id}`) ?? v.existencias ?? 0), 0);
    return stock.has(String(r.id)) ? Math.max(suma, stock.get(String(r.id))) : suma;
  }
  return stock.get(String(r.id)) ?? r.existencias;
}

// Para cada producto de la carta: costo, existencias y ventas de TRIVO.
//   directo:   el producto (o su variante) está en «Compra y reventa».
//   calculado: un paquete de la carta (x 6, x 24, caja + hielo) que en TRIVO
//              no tiene costo propio: unidades × costo de la lata + el hielo.
export function emparejarTrivo(carta, { productos: reventa, stock, ventas }) {
  const porId = new Map(reventa.map((r) => [String(r.id), r]));
  const hielo3 = reventa.find((r) => /hielo/i.test(r.nombre) && /\b3\s*kg/i.test(r.nombre));
  const resultado = {};
  const sinPareja = [];
  for (const p of carta) {
    const [idProducto, idVariante] = String(p.id).split('-');
    const venta = ventas.get(idProducto) || null;
    const datos = { ventas: venta ? { ...venta, todasLasVariantes: Boolean(idVariante) } : { unidades: 0, ingresos: 0, pedidos: 0, todasLasVariantes: Boolean(idVariante) } };
    const directo = porId.get(idProducto);
    if (directo) {
      const variante = idVariante ? directo.variantes.find((v) => String(v.id) === idVariante) : null;
      const costo = variante?.costo > 0 ? variante.costo : directo.costo > 0 && !idVariante ? directo.costo : costoUnidad(directo);
      resultado[p.id] = {
        ...datos,
        fuente: 'directo',
        costo: costo > 0 ? costo : null,
        existencias: existenciasDe(directo, variante, stock),
        minimo: variante?.minimo ?? directo.minimo,
        bajo: variante ? variante.bajo : directo.bajo,
      };
      continue;
    }
    const base = unidadBase(p, reventa);
    if (!base) {
      resultado[p.id] = { ...datos, fuente: null, costo: null, existencias: null };
      sinPareja.push(p.nombre);
      continue;
    }
    // Sin costo de la lata (o del hielo que trae la caja) no se puede calcular el del paquete.
    const unitario = costoUnidad(base);
    const faltaHielo = p.conHielo && !(hielo3?.costo > 0);
    const conHielo = p.conHielo && hielo3?.costo > 0 ? hielo3.costo : 0;
    const latas = existenciasDe(base, null, stock);
    resultado[p.id] = {
      ...datos,
      fuente: 'calculado',
      costo: unitario && !faltaHielo ? Math.round(unitario * p.unidades + conHielo) : null,
      detalle: `${p.unidades} × ${base.nombre}${conHielo ? ' + hielo 3 kg' : ''}`,
      existencias: latas,
      alcanza: latas === null ? null : Math.max(0, Math.floor(latas / p.unidades)),
      base: base.nombre,
      baseId: base.id,
    };
  }
  return { productos: resultado, sinPareja };
}

// Lee TRIVO, guarda los costos reales en «mitienda-costos» (reemplazan los
// anotados a mano de esos productos) y las existencias y ventas en «mitienda-trivo».
export async function sincronizarTrivo({ ahora = Date.now(), dias = 30 } = {}) {
  if (!trivoActivo()) throw new TypeError('Faltan TRIVO_USUARIO y TRIVO_CLAVE en el servidor');
  const config = await leerConfig();
  if (config.miTienda !== 'aguapure') throw new TypeError('TRIVO solo se usa cuando tu tienda es Agua Pure');
  let datos;
  try {
    datos = await leerTrivo({ ahora, dias });
  } catch (error) {
    const previo = await leer('mitienda-trivo');
    await actualizar('mitienda-trivo', (actual) => ({ ...(actual || {}), error: error.message, tError: ahora }));
    // Se avisa una vez cuando deja de responder, no en cada intento.
    if (!previo?.error) {
      const aviso = { tipo: 'trivo', title: 'TRIVO no está respondiendo', body: `${error.message}. Los costos, existencias y precios por compra esperan hasta que vuelva.`, url: '/#mitienda', t: ahora };
      await notificarAvisos([aviso], { ahora }).catch((e) => console.error('[push]', e.message));
    }
    // Un fallo de red («fetch failed») es TypeError: no es un error de quien llama.
    throw new Error(error.message);
  }
  const carta = await catalogoPropio('aguapure');
  const { productos, sinPareja } = emparejarTrivo(carta, datos);
  const reales = Object.fromEntries(Object.entries(productos).filter(([, x]) => x.costo > 0).map(([id, x]) => [id, x.costo]));
  const anterior = await leer('mitienda-trivo');
  const costos = await guardarCostos(reales);
  // Compras: las que llegaron desde la última lectura y los costos que cambiaron.
  // null = no hay compras; si no se pudieron leer, se queda la marca anterior.
  const ultimaCompra = datos.compras === null ? anterior?.ultimaCompra : datos.compras.length ? Math.max(...datos.compras.map((c) => Number(c.id))) : null;
  const cambios = anterior?.t ? cambiosPorCompra(carta, productos, anterior, datos.compras) : {};
  // Lo que pide atención: bajo el mínimo y bajo el costo (se avisa al aparecer).
  for (const p of carta) {
    const x = productos[p.id];
    x.bajoCosto = x.costo > 0 && p.precio > 0 && p.precio < x.costo;
  }
  const doc = { t: ahora, desde: datos.desde, hasta: datos.hasta, dias, productos, sinPareja, ultimaCompra, error: null };
  await actualizar('mitienda-trivo', () => doc);
  const nuevas = Object.keys(cambios).length ? await proponerPrecios({ carta, trivo: doc, cambios, ahora }) : [];
  const avisos = [];
  if (nuevas.length) {
    avisos.push({ tipo: 'precio-compra', title: `Compra en TRIVO: ${nuevas.length} ${nuevas.length === 1 ? 'precio' : 'precios'} para aprobar`, body: nuevas.slice(0, 3).map((x) => `${x.nombre}: ${pesosTexto(x.precioActual)} → ${pesosTexto(x.precioNuevo)}`).join(' · '), url: '/#mitienda', t: ahora });
  }
  avisos.push(...avisosDeAtencion(carta, productos, anterior, ahora));
  if (anterior?.error) avisos.push({ tipo: 'trivo', title: 'TRIVO volvió a responder', body: 'Costos, existencias y ventas al día.', url: '/#mitienda', t: ahora });
  if (avisos.length) await notificarAvisos(avisos, { ahora }).catch((e) => console.error('[push]', e.message));
  return { ...doc, costos, conCosto: Object.keys(reales).length, propuestasNuevas: nuevas.length };
}

const pesosTexto = (n) => `$${Math.round(n).toLocaleString('es-CO')}`;

// Avisos de lo que pide atención en TRIVO, solo cuando aparece: un producto que
// baja del mínimo de existencias o un precio que queda por debajo del costo.
export function avisosDeAtencion(carta, productos, anterior, ahora = Date.now()) {
  const avisos = [];
  for (const p of carta) {
    const x = productos[p.id];
    const antes = anterior?.productos?.[p.id];
    if (x?.fuente === 'directo' && x.bajo && !antes?.bajo && x.existencias !== null) {
      avisos.push({ tipo: 'bajo-minimo', clave: p.id, nombre: p.nombre, existencias: x.existencias, minimo: x.minimo ?? 0, url: '/#mitienda', t: ahora });
    }
    if (x?.bajoCosto && !antes?.bajoCosto) {
      avisos.push({ tipo: 'bajo-costo', clave: p.id, nombre: p.nombre, precio: p.precio, costo: x.costo, url: '/#mitienda', t: ahora });
    }
  }
  return avisos;
}

// Recordatorio de los precios sin aprobar: una vez al día, si hay alguno de más de 20 horas.
export async function recordarPropuestas({ ahora = Date.now() } = {}) {
  const viejas = (await leerPropuestas()).filter((x) => ahora - x.t > 20 * 60 * 60_000);
  if (!viejas.length) return false;
  const ultimo = (await leer('mitienda-recordatorio'))?.t || 0;
  if (ahora - ultimo < 23 * 60 * 60_000) return false;
  await actualizar('mitienda-recordatorio', () => ({ t: ahora }));
  const total = (await leerPropuestas()).length;
  await notificarAvisos([{ tipo: 'recordatorio', title: `${total} ${total === 1 ? 'precio espera' : 'precios esperan'} tu aprobación`, body: viejas.slice(0, 3).map((x) => `${x.nombre}: ${pesosTexto(x.precioActual)} → ${pesosTexto(x.precioNuevo)}`).join(' · '), url: '/#mitienda', t: ahora }], { ahora });
  return true;
}

// Para el monitoreo: vuelve a leer TRIVO cada hora (así una compra cargada se nota pronto).
export async function refrescarTrivo({ ahora = Date.now() } = {}) {
  if (!trivoActivo()) return false;
  const config = await leerConfig();
  if (config.miTienda !== 'aguapure') return false;
  const doc = await leer('mitienda-trivo');
  const ultimo = Math.max(doc?.t || 0, doc?.tError || 0);
  await recordarPropuestas({ ahora }).catch((e) => console.error('[recordatorio]', e.message));
  if (ahora - ultimo < VIGENCIA_TRIVO_HORAS * 60 * 60_000) return false;
  await sincronizarTrivo({ ahora });
  return true;
}

// ── Precios por compras: tu margen, con tu aprobación ───────────────────────
// Cuando cargas una compra en TRIVO (o cambia un costo), se calcula el precio
// con tu margen esperado (como TRIVO: costo ÷ (1 − margen %), redondeado hacia
// arriba a la centena) y queda como propuesta. Nada cambia en TRIVO hasta que
// tocas «Aplicar»; cada cambio aplicado queda en el historial y se puede deshacer.
const MAX_HISTORIAL = 200;

export async function leerMargenes() {
  const doc = (await leer('mitienda-margen')) || {};
  return { general: limpiarMargen(doc.general) ?? MARGEN_POR_DEFECTO, porProducto: doc.porProducto || {} };
}

export async function guardarMargenes({ general, porProducto } = {}) {
  return actualizar('mitienda-margen', (actual) => {
    const doc = { general: limpiarMargen(actual?.general) ?? MARGEN_POR_DEFECTO, porProducto: { ...(actual?.porProducto || {}) } };
    if (general !== undefined) {
      if (limpiarMargen(general) === null) throw new RangeError('El margen debe estar entre 0 y 89 %');
      doc.general = limpiarMargen(general);
    }
    for (const [id, v] of Object.entries(porProducto || {})) {
      if (!/^[\w-]{1,80}$/.test(id)) continue;
      if (limpiarMargen(v) === null) delete doc.porProducto[id];
      else doc.porProducto[id] = limpiarMargen(v);
    }
    return doc;
  });
}

// Productos de la carta tocados por una compra o un cambio de costo. Un cambio
// en la lata también toca sus paquetes (x 6, x 24, caja con hielo).
export function cambiosPorCompra(carta, productos, anterior, compras) {
  const cambios = {};
  // Sin marca de la última compra (lectura de antes de la 2.4) todo es punto de
  // partida; con «null» no había compras, así que cualquiera es nueva.
  const desde = anterior.ultimaCompra;
  const nuevas = desde === undefined ? [] : (compras || []).filter((c) => desde === null || Number(c.id) > Number(desde));
  const tocados = new Set(nuevas.map((c) => String(c.producto)));
  for (const p of carta) {
    const x = productos[p.id];
    if (!(x?.costo > 0)) continue;
    const [idProducto, idVariante] = String(p.id).split('-');
    const antes = anterior.productos?.[p.id]?.costo ?? null;
    const compra = nuevas.find((c) => String(c.producto) === idProducto && (!c.variante || !idVariante || String(c.variante) === idVariante)) ||
      (x.baseId ? nuevas.find((c) => String(c.producto) === String(x.baseId)) : null);
    if (compra || tocados.has(idProducto) || (antes !== null && Math.round(antes) !== Math.round(x.costo))) {
      cambios[p.id] = { costoAntes: antes, motivo: compra ? 'compra' : 'costo', compra: compra ? { fecha: compra.fecha, cantidad: compra.cantidad, costo: compra.costo } : null };
    }
  }
  return cambios;
}

async function reglaCompartida() {
  return limpiarRegla((await leerAjustesCompartidos())?.ajustes?.miTiendaRegla || {});
}

// Arma (o reemplaza) las propuestas de los productos indicados. Solo se propone
// si el precio con tu margen es distinto del actual.
export async function proponerPrecios({ carta, trivo, cambios, ahora = Date.now() }) {
  const [margenes, regla, costos] = await Promise.all([leerMargenes(), reglaCompartida(), leerCostos()]);
  const nuevas = [];
  for (const p of carta) {
    if (!cambios[p.id]) continue;
    const t = trivo.productos?.[p.id];
    const costo = t?.costo > 0 ? t.costo : costos[p.id];
    const margen = margenes.porProducto[p.id] ?? margenes.general;
    const lista = p.precioAntes ?? p.precio; // el precio en TRIVO, sin la promo
    const descuento = p.precioAntes ? p.precioAntes - p.precio : 0;
    const precioNuevo = precioConMargen(costo, margen, { fria: /fr[ií]a/i.test(p.variante || ''), recargoFria: regla.recargoFria, descuento });
    if (!precioNuevo || precioNuevo === lista) continue;
    const [producto, variante = null] = String(p.id).split('-');
    nuevas.push({
      id: p.id,
      nombre: p.nombre,
      producto,
      variante,
      costo,
      costoAntes: cambios[p.id].costoAntes ?? null,
      margen,
      precioActual: lista,
      precioNuevo,
      descuento,
      margenActual: margenSobrePrecio(lista - descuento, costo),
      margenNuevo: margenSobrePrecio(precioNuevo - descuento, costo),
      motivo: cambios[p.id].motivo,
      compra: cambios[p.id].compra || null,
      t: ahora,
    });
  }
  if (nuevas.length) await actualizar('mitienda-propuestas', (actual) => ({ ...(actual || {}), ...Object.fromEntries(nuevas.map((x) => [x.id, x])) }));
  return nuevas;
}

// «Calcular todos con mi margen»: propuestas para toda la carta con costo.
export async function proponerTodos({ ahora = Date.now() } = {}) {
  const config = await leerConfig();
  if (config.miTienda !== 'aguapure') throw new TypeError('Los precios con margen se aplican en TRIVO: elige Agua Pure en Ajustes → Mi tienda');
  const [carta, trivo] = await Promise.all([catalogoPropio('aguapure'), leer('mitienda-trivo')]);
  const cambios = Object.fromEntries(carta.map((p) => [p.id, { costoAntes: null, motivo: 'margen' }]));
  // Las que ya no hacen falta (el precio ya es el de tu margen) se quitan.
  await actualizar('mitienda-propuestas', () => ({}));
  return proponerPrecios({ carta, trivo: trivo || {}, cambios, ahora });
}

export async function leerPropuestas() {
  return Object.values((await leer('mitienda-propuestas')) || {}).sort((a, b) => b.t - a.t);
}

export async function descartarPropuesta(id) {
  await actualizar('mitienda-propuestas', (actual) => {
    const doc = { ...(actual || {}) };
    delete doc[String(id)];
    return doc;
  });
  return leerPropuestas();
}

async function anotarHistorial(entrada) {
  return actualizar('mitienda-historial-precios', (lista) => [entrada, ...(lista || [])].slice(0, MAX_HISTORIAL));
}

export async function leerHistorialPrecios() {
  return (await leer('mitienda-historial-precios')) || [];
}

// Aplica en TRIVO una propuesta que tú aprobaste.
export async function aplicarPropuesta(id, { ahora = Date.now() } = {}) {
  const propuesta = ((await leer('mitienda-propuestas')) || {})[String(id)];
  if (!propuesta) throw new TypeError('Esa propuesta ya no existe');
  if (!(propuesta.precioNuevo - propuesta.descuento > propuesta.costo)) throw new TypeError('El precio quedaría por debajo del costo');
  const r = await cambiarPrecio({ producto: propuesta.producto, variante: propuesta.variante, precio: propuesta.precioNuevo, esperado: propuesta.precioActual });
  await descartarPropuesta(id);
  await anotarHistorial({ id: `${ahora}-${propuesta.id}`, producto: propuesta.id, nombre: propuesta.nombre, antes: r.antes, despues: r.despues, costo: propuesta.costo, margen: propuesta.margen, motivo: propuesta.motivo, t: ahora });
  return r;
}

// Vuelve al precio anterior de un cambio aplicado (también con tu aprobación).
export async function deshacerCambio(idHistorial, { ahora = Date.now() } = {}) {
  const lista = await leerHistorialPrecios();
  const cambio = lista.find((h) => h.id === String(idHistorial));
  if (!cambio) throw new TypeError('Ese cambio no está en el historial');
  if (cambio.deshecho) throw new TypeError('Ese cambio ya se deshizo');
  const [producto, variante = null] = String(cambio.producto).split('-');
  const r = await cambiarPrecio({ producto, variante, precio: cambio.antes, esperado: cambio.despues });
  await actualizar('mitienda-historial-precios', (l) => (l || []).map((h) => (h.id === cambio.id ? { ...h, deshecho: ahora } : h)));
  await anotarHistorial({ id: `${ahora}-${cambio.producto}`, producto: cambio.producto, nombre: cambio.nombre, antes: r.antes, despues: r.despues, costo: cambio.costo, margen: null, motivo: 'deshacer', t: ahora });
  return r;
}
