// Catálogo de reventa: cada producto de la lista que "vendo" tiene su precio y
// una regla. Con el resumen del mercado que deja el monitoreo se calcula el
// precio sugerido y si conviene pausar la publicación porque ninguna tienda lo
// tiene. También lleva el inventario: compras, ventas y lo que queda.
import { ajustes, costoLlegada, devolucion, margen, precioSugerido, registrar } from './datos.js';
import { escribirCsv } from './csv.js';
import { inventarioDe } from './inventario.js';
import { lineaSalida } from './resultados.js';
import { cargarMovimientos, listaGuardar, listaLeer, movimientosGuardados, registrarMovimiento, resumenes, sincronizar, tiendasActivas } from './sync.js';
import { $, api, boton, campoNumero, descargar, el, enlace, hace, pesos, presentacion } from './util.js';

// La compra que menos cuesta de verdad: precio + envío o traslado − cashback.
function mejorCompra(resumen) {
  let mejor = null;
  for (const o of resumen?.ofertas || []) {
    const llegada = costoLlegada(o.tienda, o.precio);
    if (llegada === null) continue;
    const costo = o.precio + llegada - devolucion(o.tienda, o.precio);
    if (!mejor || costo < mejor.costo) mejor = { ...o, costo };
  }
  return mejor;
}

function analizarItem(item) {
  const a = ajustes().margen;
  const r = resumenes()[item.id];
  const compra = mejorCompra(r);
  const base = { r, compra, item };
  if (!r || r.sinDatos) return { ...base, estado: 'sin-datos' };
  if (!compra) return { ...base, estado: 'pausar' };
  const comunes = { envio: a.envio, comisionPct: a.comisionPct, comisionFija: a.comisionFija, ivaPct: a.ivaPct };
  const sugerido = precioSugerido({
    costo: compra.costo,
    ...comunes,
    modo: item.modo || 'margen',
    margenPct: item.margen ?? a.objetivo,
    mediana: r.mediana,
    bajoPct: item.bajoMercado ?? 0,
  });
  const netoDe = (v) => (v > 0 ? margen({ venta: v, compra: compra.costo, ...comunes }) : null);
  let accion = 'mantener';
  if (sugerido?.precio && item.venta > 0) {
    const diferencia = sugerido.precio - item.venta;
    if (Math.abs(diferencia) >= item.venta * 0.01) accion = diferencia > 0 ? 'subir' : 'bajar';
  } else if (sugerido?.precio) accion = 'fijar';
  return { ...base, estado: 'activo', sugerido, actual: netoDe(item.venta), conSugerido: netoDe(sugerido?.precio), accion };
}

const TEXTO_MOTIVO = {
  imposible: 'Con esas comisiones e impuestos ese margen es imposible: baja el margen objetivo.',
  'sin-mercado': 'No hay precios de mercado suficientes: usa la regla de margen.',
  'mercado-bajo-costo': 'El mercado está por debajo de tu costo: se sugiere el precio en el que no pierdes.',
};

function actualizarItem(id, cambios) {
  listaGuardar(listaLeer().map((x) => (x.id === id ? { ...x, ...cambios } : x)));
  pintarCatalogo();
}

// Formulario corto para registrar una compra, una venta o un conteo.
function formularioMovimiento(item, tipo, sugerido) {
  const caja = el('div', 'mov-form');
  const valores = { cantidad: tipo === 'ajuste' ? null : 1, precio: sugerido ?? null };
  const rejilla = el('div', 'rejilla');
  rejilla.append(campoNumero(tipo === 'ajuste' ? 'Unidades contadas' : 'Cantidad', valores.cantidad, (v) => (valores.cantidad = v), { paso: '1', evento: 'input' }));
  if (tipo !== 'ajuste') {
    rejilla.append(campoNumero(tipo === 'compra' ? 'Costo por unidad ($)' : 'Precio de venta por unidad ($)', valores.precio, (v) => (valores.precio = v), { evento: 'input' }));
  }
  const mensaje = el('p', 'ayuda');
  const guardar = boton('Guardar', 'mini activo', async () => {
    guardar.disabled = true;
    try {
      await registrarMovimiento({ item: item.id, tipo, cantidad: Number(valores.cantidad), precio: tipo === 'ajuste' ? 0 : Number(valores.precio) });
      pintarCatalogo();
    } catch (error) {
      mensaje.textContent = error.message;
      mensaje.className = 'error';
      guardar.disabled = false;
    }
  });
  caja.append(rejilla, guardar, boton('Cancelar', 'mini', () => caja.remove()), mensaje);
  return caja;
}

function bloqueInventario(item, inventario, info, tarjeta) {
  const inv = inventario[item.id];
  const caja = el('div', 'cat-inventario');
  const texto = el('div', 'cat-inv-texto');
  if (inv) {
    texto.append(el('b', '', `${inv.unidades} u. en inventario`));
    if (inv.costoPromedio) texto.append(el('span', 'ayuda', `costo promedio ${pesos.format(Math.round(inv.costoPromedio))} · vendidas ${inv.vendidas}`));
    if (item.stockMinimo !== null && item.stockMinimo !== undefined && inv.unidades <= item.stockMinimo) {
      texto.append(el('span', 'chip chip-subio', inv.unidades <= 0 ? 'Sin unidades' : 'Te quedan pocas'));
    }
  } else texto.append(el('span', 'ayuda', 'Sin movimientos de inventario.'));
  const botones = el('div', 'cat-inv-botones');
  const abrir = (tipo, sugerido) => () => {
    tarjeta.querySelector('.mov-form')?.remove();
    caja.after(formularioMovimiento(item, tipo, sugerido));
  };
  botones.append(
    boton('Compré', 'mini', abrir('compra', info.compra?.precio)),
    boton('Vendí', 'mini', abrir('venta', item.venta ?? info.sugerido?.precio)),
    boton('Contar', 'mini', abrir('ajuste')),
  );
  caja.append(texto, botones);
  return caja;
}

function tarjetaCatalogo(item, inventario) {
  const info = analizarItem(item);
  const tarjeta = el('article', `cat-item${item.vendo ? '' : ' cat-apagado'}`);
  const cabeza = el('div', 'cat-cabeza');
  const titulo = el('div', 'cat-titulo');
  titulo.append(el('b', '', item.q));
  if (info.r?.ml) titulo.append(el('span', 'ayuda', presentacion(info.r)));
  const vendo = el('label', 'opciones');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = Boolean(item.vendo);
  check.addEventListener('change', () => actualizarItem(item.id, { vendo: check.checked }));
  vendo.append(check, document.createTextNode('Lo vendo'));
  cabeza.append(titulo, vendo);
  tarjeta.append(cabeza);
  if (!item.vendo) return tarjeta;

  const estado = el('div', 'cat-estado');
  if (info.estado === 'sin-datos') {
    estado.append(el('span', 'chip', 'Sin datos todavía'), el('span', 'ayuda', 'Pulsa «Actualizar precios» o espera la próxima revisión.'));
  } else if (info.estado === 'pausar') {
    estado.append(el('span', 'chip chip-subio', 'Pausar publicación'), el('span', 'ayuda', `Ninguna tienda lo tiene disponible (${hace(info.r.t)}).`));
  } else {
    estado.append(el('span', 'chip chip-baja', 'Activo'));
    const compra = el('span', 'ayuda');
    compra.append('Compra: ', enlace(`${info.compra.tiendaNombre} ${pesos.format(info.compra.precio)}`, info.compra.url));
    if (info.compra.costo !== info.compra.precio) compra.append(` (costo real ${pesos.format(Math.round(info.compra.costo))})`);
    if (info.r.mediana) compra.append(` · mercado ${pesos.format(Math.round(info.r.mediana))} en ${info.r.ofertas.length} ${info.r.ofertas.length === 1 ? 'tienda' : 'tiendas'}`);
    compra.append(` · ${hace(info.r.t)}`);
    estado.append(compra);
  }
  tarjeta.append(estado);
  tarjeta.append(bloqueInventario(item, inventario, info, tarjeta));

  const rejilla = el('div', 'rejilla cat-rejilla');
  rejilla.append(campoNumero('Mi precio de venta ($)', item.venta, (v) => actualizarItem(item.id, { venta: v })));
  const regla = el('label', '', 'Regla de precio');
  const selector = el('select');
  selector.append(new Option('Margen objetivo', 'margen'), new Option('Seguir al mercado', 'mercado'));
  selector.value = item.modo || 'margen';
  selector.addEventListener('change', () => actualizarItem(item.id, { modo: selector.value }));
  regla.append(selector);
  rejilla.append(regla);
  if ((item.modo || 'margen') === 'margen') {
    rejilla.append(campoNumero('Margen neto (%)', item.margen, (v) => actualizarItem(item.id, { margen: v }), { paso: '1', placeholder: `${ajustes().margen.objetivo} (Ajustes)` }));
  } else {
    rejilla.append(campoNumero('Por debajo del mercado (%)', item.bajoMercado, (v) => actualizarItem(item.id, { bajoMercado: v }), { paso: '0.5', placeholder: '0' }));
  }
  rejilla.append(campoNumero('Avisar con (u.)', item.stockMinimo, (v) => actualizarItem(item.id, { stockMinimo: v }), { paso: '1', placeholder: 'opcional' }));
  tarjeta.append(rejilla);

  if (info.estado !== 'activo') return tarjeta;
  const salida = el('div', 'panel-salida');
  if (info.actual) salida.append(lineaSalida('Neto con tu precio', `${pesos.format(Math.round(info.actual.neto))} · ${info.actual.pct.toFixed(1)} %`, info.actual.neto > 0 ? 'positivo' : 'negativo'));
  if (info.sugerido?.precio) {
    salida.append(lineaSalida(`Precio sugerido (${pesos.format(info.sugerido.precio)})`, `${pesos.format(Math.round(info.conSugerido.neto))} · ${info.conSugerido.pct.toFixed(1)} %`, info.conSugerido.neto > 0 ? 'positivo' : 'negativo'));
  }
  if (info.sugerido?.piso) salida.append(lineaSalida('Precio mínimo sin pérdida', pesos.format(info.sugerido.piso)));
  if (info.sugerido?.motivo) salida.append(el('p', 'ayuda', TEXTO_MOTIVO[info.sugerido.motivo]));
  tarjeta.append(salida);

  if (info.sugerido?.precio && info.accion !== 'mantener') {
    const texto = { subir: 'Subir a', bajar: 'Bajar a', fijar: 'Usar' }[info.accion];
    tarjeta.append(boton(`${texto} ${pesos.format(info.sugerido.precio)}`, 'mini activo cat-aplicar', () => actualizarItem(item.id, { venta: info.sugerido.precio })));
  } else if (info.sugerido?.precio) tarjeta.append(el('p', 'ayuda cat-ok', 'Tu precio está en lo sugerido.'));
  return tarjeta;
}

export function pintarCatalogo() {
  const items = listaLeer();
  const caja = $('#cat-items');
  caja.replaceChildren();
  if (!items.length) {
    caja.append(el('p', 'ayuda', 'Primero agrega productos en Mi lista; aquí marcas los que revendes.'));
    $('#cat-resumen').replaceChildren();
    return;
  }
  const inventario = inventarioDe(movimientosGuardados());
  const analizados = new Map(items.map((x) => [x.id, analizarItem(x)]));
  const vendidos = items.filter((x) => x.vendo).map((x) => analizados.get(x.id));
  const pausar = vendidos.filter((x) => x.estado === 'pausar').length;
  const cambiar = vendidos.filter((x) => ['subir', 'bajar', 'fijar'].includes(x.accion)).length;
  const pocas = items.filter((x) => x.vendo && x.stockMinimo !== null && x.stockMinimo !== undefined && inventario[x.id] && inventario[x.id].unidades <= x.stockMinimo).length;
  const resumen = $('#cat-resumen');
  resumen.replaceChildren();
  const dato = (n, texto, clase = '') => {
    const d = el('div', `cat-dato ${clase}`);
    d.append(el('b', '', String(n)), el('span', '', texto));
    resumen.append(d);
  };
  dato(vendidos.length, 'en venta');
  dato(cambiar, 'cambios de precio', cambiar ? 'aviso' : '');
  dato(pausar, 'para pausar', pausar ? 'perdida' : '');
  dato(pocas, 'con pocas unidades', pocas ? 'aviso' : '');
  $('#cat-aplicar').disabled = !cambiar;
  $('#cat-exportar').disabled = !vendidos.length;
  // Primero lo que vendo; dentro, lo que pide acción.
  const peso = (x) => {
    if (!x.vendo) return 3;
    const info = analizados.get(x.id);
    if (info.estado === 'pausar') return 0;
    return ['subir', 'bajar', 'fijar'].includes(info.accion) ? 1 : 2;
  };
  [...items].sort((a, b) => peso(a) - peso(b)).forEach((item) => caja.append(tarjetaCatalogo(item, inventario)));
}

function aplicarSugeridos() {
  const nuevos = new Map();
  for (const item of listaLeer()) {
    if (!item.vendo) continue;
    const info = analizarItem(item);
    if (info.sugerido?.precio && ['subir', 'bajar', 'fijar'].includes(info.accion)) nuevos.set(item.id, info.sugerido.precio);
  }
  listaGuardar(listaLeer().map((x) => (nuevos.has(x.id) ? { ...x, venta: nuevos.get(x.id) } : x)));
  $('#cat-estado').replaceChildren(el('p', '', `${nuevos.size} ${nuevos.size === 1 ? 'precio actualizado' : 'precios actualizados'}. Exporta el CSV para subirlos a tu tienda.`));
  pintarCatalogo();
}

function exportarCatalogo() {
  const inventario = inventarioDe(movimientosGuardados());
  const filas = [['producto', 'presentacion', 'estado', 'tienda_compra', 'costo_compra', 'mi_precio', 'precio_sugerido', 'neto_sugerido', 'inventario', 'enlace_compra']];
  for (const item of listaLeer()) {
    if (!item.vendo) continue;
    const info = analizarItem(item);
    filas.push([
      item.q,
      info.r?.ml ? presentacion(info.r) : '',
      info.estado === 'pausar' ? 'pausar' : info.estado === 'activo' ? 'activo' : 'sin datos',
      info.compra?.tiendaNombre ?? '',
      info.compra ? Math.round(info.compra.costo) : '',
      item.venta ?? '',
      info.sugerido?.precio ?? '',
      info.conSugerido ? Math.round(info.conSugerido.neto) : '',
      inventario[item.id]?.unidades ?? '',
      info.compra?.url ?? '',
    ]);
  }
  descargar(`catalogo-${new Date().toISOString().slice(0, 10)}.csv`, escribirCsv(filas), 'text/csv;charset=utf-8');
}

export async function abrirCatalogo() {
  pintarCatalogo();
  await Promise.all([sincronizar(), cargarMovimientos()]);
  pintarCatalogo();
}

export function configurarCatalogo() {
  $('#cat-aplicar').addEventListener('click', aplicarSugeridos);
  $('#cat-exportar').addEventListener('click', exportarCatalogo);
  $('#cat-actualizar').addEventListener('click', async () => {
    const b = $('#cat-actualizar');
    b.disabled = true;
    // Cada búsqueda de un producto de la lista también actualiza su resumen en el servidor.
    const items = listaLeer().filter((x) => x.vendo);
    const tiendas = tiendasActivas().join(',');
    for (const [i, item] of items.entries()) {
      $('#cat-estado').replaceChildren(el('p', '', `Consultando ${i + 1} de ${items.length}: ${item.q}…`));
      try {
        registrar(await api(`/api/buscar?q=${encodeURIComponent(item.q)}&tiendas=${tiendas}`));
      } catch {
        /* ese producto queda con el dato anterior */
      }
    }
    await sincronizar();
    $('#cat-estado').replaceChildren();
    b.disabled = false;
    pintarCatalogo();
  });
}
