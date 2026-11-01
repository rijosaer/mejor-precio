// Mi pedido: varios productos con su cantidad. La app arma el plan de compra
// más barato entre tiendas, con el envío (o el traslado) y el pedido mínimo
// de cada una (Ajustes → Envío por tienda).
import { costoLlegada, registrar } from './datos.js';
import { optimizarPedido } from './optimizar.js';
import { agrupar } from './resultados.js';
import { tiendasActivas } from './sync.js';
import { $, api, boton, compartir, el, enlace, guardado, hace, idNuevo, pesos, presentacion } from './util.js';

const leer = () => guardado('mp-pedido') || [];
const guardar = (items) => guardado('mp-pedido', items);

const ofertasDe = (grupo) =>
  grupo.mejores.map((p) => ({ tienda: p.tienda.id, tiendaNombre: p.tienda.nombre, precio: p.precio, disponible: p.disponible, url: p.url ?? null, nombre: p.nombre }));

export function agregarAlPedido(grupo, consulta) {
  const items = leer();
  const clave = `${grupo.unidades || 1}x${grupo.ml}`;
  const previo = items.find((x) => x.q === consulta && x.clave === clave);
  if (previo) {
    previo.cantidad += 1;
    previo.ofertas = ofertasDe(grupo);
    previo.t = Date.now();
  } else {
    items.push({ id: idNuevo(), q: consulta, clave, ml: grupo.ml, unidades: grupo.unidades || 1, nombre: `${consulta} · ${presentacion(grupo)}`, cantidad: 1, ofertas: ofertasDe(grupo), t: Date.now() });
  }
  guardar(items);
  avisar(`Agregado al pedido: ${consulta} (${presentacion(grupo)}).`);
  pintarContador();
}

function avisar(texto) {
  const caja = $('#aviso-flotante');
  caja.textContent = texto;
  caja.hidden = false;
  clearTimeout(avisar.reloj);
  avisar.reloj = setTimeout(() => (caja.hidden = true), 2600);
}

export function pintarContador() {
  const n = leer().reduce((s, x) => s + x.cantidad, 0);
  $('#abrir-pedido').textContent = n ? `Pedido (${n})` : 'Pedido';
}

function cambiarCantidad(id, cantidad) {
  const items = leer()
    .map((x) => (x.id === id ? { ...x, cantidad } : x))
    .filter((x) => x.cantidad > 0);
  guardar(items);
  pintarPedido();
  pintarContador();
}

export function pintarPedido() {
  const items = leer();
  const caja = $('#pedido-items');
  const plan = $('#pedido-plan');
  caja.replaceChildren();
  plan.replaceChildren();
  $('#pedido-actualizar').disabled = !items.length;
  $('#pedido-vaciar').disabled = !items.length;
  if (!items.length) {
    caja.append(el('p', 'ayuda', 'Tu pedido está vacío. Busca un producto y pulsa «Agregar al pedido» en la presentación que quieres.'));
    return;
  }
  for (const item of items) {
    const filaP = el('div', 'lista-fila');
    const texto = el('div', 'lista-texto');
    texto.append(el('span', '', item.nombre));
    const disponibles = item.ofertas.filter((o) => o.disponible).length;
    texto.append(el('span', 'ayuda', `${disponibles} ${disponibles === 1 ? 'tienda lo tiene' : 'tiendas lo tienen'} · precios de ${hace(item.t)}`));
    const cantidad = el('div', 'cantidad');
    cantidad.append(
      boton('−', 'mini', () => cambiarCantidad(item.id, item.cantidad - 1)),
      el('b', '', String(item.cantidad)),
      boton('+', 'mini', () => cambiarCantidad(item.id, item.cantidad + 1)),
    );
    cantidad.firstChild.setAttribute('aria-label', 'Quitar uno');
    cantidad.lastChild.setAttribute('aria-label', 'Agregar uno');
    filaP.append(texto, cantidad);
    caja.append(filaP);
  }
  pintarPlan(items, plan);
}

function pintarPlan(items, caja) {
  const r = optimizarPedido(items, (tienda, subtotal) => costoLlegada(tienda, subtotal));
  if (!r.plan) {
    caja.append(el('p', 'error', 'No hay una combinación de tiendas que tenga todo y cumpla los pedidos mínimos. Actualiza los precios o revisa los mínimos en Ajustes.'));
    return;
  }
  caja.append(el('p', 'propuesta-titulo', 'Dónde comprar para pagar menos'));
  for (const t of r.plan.tiendas) {
    const bloque = el('div', 'plan-tienda');
    bloque.append(el('p', 'plan-nombre', t.tiendaNombre));
    for (const x of t.items) {
      const filaX = el('div', 'salida-linea');
      filaX.append(x.url ? enlace(`${x.cantidad} × ${x.nombre}`, x.url) : el('span', '', `${x.cantidad} × ${x.nombre}`), el('b', '', pesos.format(x.precio * x.cantidad)));
      bloque.append(filaX);
    }
    const envio = el('div', 'salida-linea');
    envio.append(el('span', '', 'Envío o traslado'), el('b', '', t.envio ? pesos.format(t.envio) : 'Sin costo'));
    bloque.append(envio);
    caja.append(bloque);
  }
  const total = el('div', 'panel-salida');
  const lineaT = (texto, valor, clase = '') => {
    const f = el('div', `salida-linea ${clase}`);
    f.append(el('span', '', texto), el('b', '', valor));
    total.append(f);
  };
  lineaT('Productos', pesos.format(r.plan.productos));
  lineaT('Envíos y traslados', pesos.format(r.plan.envios));
  lineaT('Total', pesos.format(r.plan.total), 'positivo');
  if (r.unaTienda && r.ahorro > 0) lineaT(`Ahorro frente a comprar todo en ${r.unaTienda.tiendas[0].tiendaNombre}`, pesos.format(r.ahorro), 'positivo');
  else if (r.plan.tiendas.length === 1) total.append(el('p', 'ayuda', 'Comprar todo en una sola tienda es lo más barato.'));
  caja.append(total);
  if (r.sinOferta.length) caja.append(el('p', 'error', `Sin tienda disponible: ${r.sinOferta.map((x) => x.nombre).join(', ')}.`));
  caja.append(boton('Compartir el plan', 'boton-texto', () => {
    const lineas = r.plan.tiendas.map((t) => `${t.tiendaNombre}: ${t.items.map((x) => `${x.cantidad} × ${x.nombre}`).join(', ')} — ${pesos.format(t.subtotal + t.envio)}`);
    compartir(['Plan de compra:', ...lineas, `Total: ${pesos.format(r.plan.total)}`].join('\n'));
  }));
}

async function actualizarPrecios() {
  const b = $('#pedido-actualizar');
  b.disabled = true;
  const items = leer();
  const tiendas = tiendasActivas().join(',');
  for (const [i, item] of items.entries()) {
    $('#pedido-estado').replaceChildren(el('p', '', `Consultando ${i + 1} de ${items.length}: ${item.q}…`));
    try {
      const datos = await api(`/api/buscar?q=${encodeURIComponent(item.q)}&tiendas=${tiendas}`);
      registrar(datos);
      const grupo = agrupar(datos, { soloDisponibles: false }).find((g) => g.clave === item.clave);
      item.ofertas = grupo ? ofertasDe(grupo) : [];
      item.t = Date.now();
    } catch {
      /* queda con los precios anteriores */
    }
  }
  guardar(items);
  $('#pedido-estado').replaceChildren();
  b.disabled = false;
  pintarPedido();
}

export function configurarPedido() {
  $('#pedido-actualizar').addEventListener('click', actualizarPrecios);
  $('#pedido-vaciar').addEventListener('click', () => {
    guardar([]);
    pintarPedido();
    pintarContador();
  });
  pintarContador();
}
