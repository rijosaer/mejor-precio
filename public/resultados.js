// Resultados de una búsqueda: grupos por presentación, filas con foto,
// historial y margen, ficha del producto, filtros, avisos y precio por litro.
import {
  ajustes,
  claveDe,
  costoLlegada,
  descartarAlerta,
  descartarTodas,
  descuento,
  devolucion,
  enRango,
  estadoPrecio,
  guardarVenta,
  hayCostosDeLlegada,
  listarAlertas,
  llegadaInfo,
  margen,
  patronCompra,
  porcentajeCashback,
  posicion,
  prediccionStock,
  presentacionesFavoritas,
  resumen as resumenSerie,
  serie,
  venta,
} from './datos.js';
import {
  $,
  acciones,
  boton,
  compartir,
  el,
  enlace,
  fechaCorta,
  fechaLarga,
  foto,
  guardado,
  hace,
  miles,
  pesos,
  precioLitro,
  precioPorLitro,
  presentacion,
} from './util.js';

export let ultimo = null; // última respuesta del servidor
export const fijarUltimo = (datos) => {
  ultimo = datos;
};
let iguales = new Map(); // código de barras o firma → tiendas que tienen ese mismo producto

// Une los productos que comparten código de barras o firma (nombre + tamaño):
// si Makro y Éxito comparten código y Éxito y Bevgo comparten firma, los tres
// son el mismo producto.
export function productosIguales(datos) {
  const padre = new Map();
  const raiz = (k) => {
    while (padre.get(k) !== k) k = padre.get(k);
    return k;
  };
  const unir = (a, b) => {
    for (const k of [a, b]) if (!padre.has(k)) padre.set(k, k);
    padre.set(raiz(a), raiz(b));
  };
  const claves = [];
  for (const t of datos.tiendas) {
    for (const p of t.productos) {
      const propias = [p.ean && `ean:${p.ean}`, p.firma && `firma:${p.firma}`].filter(Boolean);
      if (!propias.length) continue;
      unir(propias[0], propias[propias.length - 1]);
      claves.push([propias, t.id]);
    }
  }
  const tiendas = new Map();
  for (const [propias, id] of claves) {
    const r = raiz(propias[0]);
    if (!tiendas.has(r)) tiendas.set(r, new Set());
    tiendas.get(r).add(id);
  }
  const salida = new Map();
  for (const [propias] of claves) for (const k of propias) salida.set(k, tiendas.get(raiz(k)));
  return salida;
}

// ── Agrupar por presentación ────────────────────────────────────────────────
// modo: 'precio' (lo que cobra la tienda), 'total' (+ envío o traslado),
// 'litro' (los grupos se ordenan por el mejor precio por litro).
export function agrupar(datos, { soloDisponibles = true, modo = 'precio', variantes = false, filtros = {} } = {}) {
  const costo = (p) => (modo === 'total' ? costoLlegada(p.tienda.id, p.precio) ?? 0 : 0);
  const total = (p) => p.precio + costo(p);
  const ocultas = filtros.ocultas || [];
  const grupos = new Map();
  let variantesOcultas = 0;
  for (const t of datos.tiendas) {
    if (ocultas.includes(t.id)) continue;
    for (const p of t.productos) {
      if (soloDisponibles && !p.disponible) continue;
      if (p.otraVariante && !variantes) {
        variantesOcultas++;
        continue;
      }
      if (filtros.soloOfertas && !(descuento(p) >= ajustes().ofertas.oferta || p.nota)) continue;
      if (filtros.min > 0 && p.precio < filtros.min) continue;
      if (filtros.max > 0 && p.precio > filtros.max) continue;
      // Una variante que no se pidió (Light, sin alcohol, Zero…) va en su propio
      // grupo: nunca se compara con la normal.
      const tipo = p.otraVariante ? p.variante : '';
      const clave = p.ml ? `${p.unidades || 1}x${p.ml}${tipo ? `|${tipo}` : ''}` : `sin${tipo ? `|${tipo}` : ''}`;
      if (!grupos.has(clave)) grupos.set(clave, { clave, ml: p.ml, unidades: p.unidades || 1, variante: tipo || null, productos: [], mios: [] });
      // La tienda propia no compite: va aparte como «Tu precio».
      grupos.get(clave)[t.miTienda ? 'mios' : 'productos'].push({ ...p, tienda: t });
    }
  }
  const lista = [...grupos.values()].map((g) => {
    g.productos.sort((a, b) => b.disponible - a.disponible || Boolean(a.otraVariante) - Boolean(b.otraVariante) || total(a) - total(b));
    const porTienda = new Map();
    for (const p of g.productos) if (!porTienda.has(p.tienda.id)) porTienda.set(p.tienda.id, p);
    g.mejores = [...porTienda.values()].sort((a, b) => b.disponible - a.disponible || total(a) - total(b));
    g.litro = g.mejores[0]?.disponible ? precioPorLitro(g.mejores[0]) : null;
    g.mio = g.mios.sort((a, b) => b.disponible - a.disponible || a.precio - b.precio)[0] || null;
    return g;
  });
  const favoritas = presentacionesFavoritas();
  const orden = lista.sort((a, b) => {
    if (a.clave.startsWith('sin') !== b.clave.startsWith('sin')) return a.clave.startsWith('sin') ? 1 : -1;
    // Las variantes que no se pidieron, después de lo que se buscó.
    if (Boolean(a.variante) !== Boolean(b.variante)) return a.variante ? 1 : -1;
    const fa = favoritas.indexOf(a.clave);
    const fb = favoritas.indexOf(b.clave);
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    if (modo === 'litro' && a.litro && b.litro) return a.litro - b.litro;
    return b.mejores.length - a.mejores.length || a.ml * a.unidades - b.ml * b.unidades;
  });
  orden.variantesOcultas = variantesOcultas;
  return orden;
}

// ── Fila ────────────────────────────────────────────────────────────────────
function fila(p, ganador, grupo) {
  const nodo = $('#tpl-fila').content.firstElementChild.cloneNode(true);
  if (ganador) nodo.classList.add('ganador');
  if (!p.disponible) nodo.classList.add('agotado');
  nodo.querySelector('.fila-tienda').textContent = p.tienda.nombre;
  const caja = foto(p.imagen, 'fila-foto', '');
  const verFicha = boton('', 'fila-foto-boton', () => abrirFicha(p, grupo));
  verFicha.setAttribute('aria-label', `Ver ficha de ${p.nombre}`);
  verFicha.append(caja);
  nodo.querySelector('.fila-producto').prepend(verFicha);
  const nombre = nodo.querySelector('.fila-nombre');
  nombre.textContent = p.nombre;
  if (p.url) nombre.href = p.url;
  else {
    nombre.removeAttribute('href');
    nombre.classList.add('sin-enlace');
  }
  const extra = nodo.querySelector('.fila-extra');
  const partes = [];
  if (!p.disponible) {
    extra.classList.add('aviso');
    partes.push('Agotado');
  } else if (p.nota) {
    extra.classList.add('aviso');
    partes.push(p.nota);
  } else partes.push(p.tienda.alcance);
  if (p.porNombre) partes.push('coincide por nombre y tamaño');
  if (p.grados) partes.push(`${miles.format(p.grados)}°`);
  extra.textContent = partes.join(' · ');
  nodo.querySelector('.fila-precio strong').textContent = pesos.format(p.precio);
  nodo.querySelector('.fila-precio s').textContent = p.precioAntes ? pesos.format(p.precioAntes) : '';
  nodo.querySelector('.fila-litro').textContent = precioLitro(p);

  const clave = claveDe(p.tienda.id, p);
  pintarChips(nodo, clave, p);
  nodo.querySelectorAll('.fila-herr .mini').forEach((b) => {
    b.addEventListener('click', () => alternarPanel(nodo, b.dataset.panel, clave, p));
  });
  return nodo;
}

function chip(caja, texto, clase) {
  caja.append(el('span', `chip ${clase}`, texto));
}

function pintarChips(nodo, clave, p) {
  const caja = nodo.querySelector('.fila-hist');
  if (p.tienda.propio) chip(caja, 'Proveedor propio', 'chip-propio');
  if (p.variante) chip(caja, p.variante, 'chip-variante');
  const estado = estadoPrecio(clave, p.precio);
  if (estado?.esMinimo) chip(caja, 'Mínimo histórico', 'chip-min');
  else if (estado && estado.delta > 0) chip(caja, `Bajó ${pesos.format(estado.delta)}`, 'chip-baja');
  else if (estado && estado.delta < 0) chip(caja, `Subió ${pesos.format(-estado.delta)}`, 'chip-subio');

  const stock = Number.isFinite(p.stock) ? prediccionStock(serie(clave), Date.now()) : null;
  if (stock && p.disponible) {
    if (stock.dias !== null && stock.dias <= 14) chip(caja, `Quedan ${stock.actual} u. · ~${Math.max(1, Math.round(stock.dias))} días`, 'chip-viaje');
    else if (stock.actual <= 20) chip(caja, `Quedan ${stock.actual} u.`, 'chip-viaje');
  }

  const mismas = iguales.get(p.ean ? `ean:${p.ean}` : `firma:${p.firma}`);
  if (mismas && mismas.size > 1) chip(caja, `Mismo producto en ${mismas.size} tiendas`, 'chip-codigo');

  const { oferta, liquidacion } = ajustes().ofertas;
  const rebaja = descuento(p);
  if (rebaja >= liquidacion) chip(caja, `Liquidación −${rebaja} %`, 'chip-oferta');
  else if (rebaja >= oferta) chip(caja, `Oferta −${rebaja} %`, 'chip-oferta');

  const llegada = llegadaInfo(p.tienda.id, p.precio);
  if (llegada?.modo === 'recojo') chip(caja, `${miles.format(Math.round(llegada.km))} km · +${pesos.format(llegada.costo)} de traslado`, 'chip-viaje');
  else if (llegada?.modo === 'domicilio') {
    if (llegada.costo === null) chip(caja, `Pedido mínimo ${pesos.format(llegada.minimo)}`, 'chip-viaje');
    else chip(caja, llegada.costo ? `+${pesos.format(llegada.costo)} de envío` : 'Envío gratis', 'chip-viaje');
  }
}

function alternarPanel(nodo, tipo, clave, p) {
  const panel = nodo.querySelector('.fila-panel');
  const abierto = !panel.hidden && panel.dataset.tipo === tipo;
  panel.replaceChildren();
  panel.dataset.tipo = abierto ? '' : tipo;
  panel.hidden = abierto;
  nodo.querySelectorAll('.fila-herr .mini').forEach((b) => b.classList.toggle('activo', !abierto && b.dataset.panel === tipo));
  if (abierto) return;
  panel.append(tipo === 'historial' ? panelHistorial(clave, p) : panelMargen(clave, p));
}

// ── Historial de precios ────────────────────────────────────────────────────
const RANGOS = [
  [30, '1 mes'],
  [90, '3 meses'],
  [180, '6 meses'],
  [365, '12 meses'],
];

export function panelHistorial(clave, p) {
  const caja = el('div', 'panel-caja');
  const todos = serie(clave);
  if (!todos.length) {
    caja.append(el('p', 'ayuda', 'Todavía no hay registros de este producto.'));
    return caja;
  }
  if (todos.length < 2) {
    caja.append(
      el('p', 'panel-titulo', `Ahora ${pesos.format(p.precio)}`),
      el('p', 'ayuda', 'Solo hay un registro. Vuelve a buscar en unos días para ver cómo se mueve el precio.'),
    );
    return caja;
  }

  const diasDeDatos = (Date.now() - todos[0].t) / 864e5;
  const rangos = el('div', 'rangos');
  rangos.setAttribute('role', 'group');
  rangos.setAttribute('aria-label', 'Período');
  const cuerpo = el('div');
  let elegido = guardado('mp-rango') || 90;

  function pintarRango() {
    rangos.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', Number(b.dataset.dias) === elegido));
    let puntos = enRango(todos, elegido);
    if (puntos.length < 2) puntos = todos.slice(-2);
    const r = resumenSerie(puntos);
    cuerpo.replaceChildren(el('p', 'panel-titulo', `Mínimo ${pesos.format(r.min)} · Máximo ${pesos.format(r.max)} · Ahora ${pesos.format(p.precio)}`));
    const pos = posicion(puntos, p.precio);
    if (pos) {
      let texto;
      let clase = '';
      if (pos.sobreMinimo <= 0.5) {
        texto = 'Estás en el mínimo del período: buen momento para comprar.';
        clase = 'positivo';
      } else if (pos.sobrePromedio >= 5) {
        texto = `Precio inflado: ${pos.sobrePromedio.toFixed(0)} % sobre el promedio (${pesos.format(Math.round(pos.promedio))}). Si puedes, espera.`;
        clase = 'negativo';
      } else {
        texto = `${pos.sobreMinimo.toFixed(0)} % sobre el mínimo del período · promedio ${pesos.format(Math.round(pos.promedio))}.`;
      }
      cuerpo.append(el('p', `panel-veredicto ${clase}`, texto));
    }
    const contenedor = el('div', 'grafica');
    contenedor.innerHTML = graficaSVG(puntos);
    cuerpo.append(contenedor, el('p', 'ayuda', `${r.n} registros desde el ${fechaCorta.format(r.primero)} · no incluye costos de envío.`));
  }

  for (const [dias, texto] of RANGOS) {
    const b = boton(texto, 'mini', () => {
      elegido = dias;
      guardado('mp-rango', dias);
      pintarRango();
    });
    b.dataset.dias = dias;
    // Un rango más largo que los datos se ve igual que el anterior: se ofrece
    // solo el primero que ya cubre todo.
    const anterior = RANGOS[RANGOS.findIndex(([d]) => d === dias) - 1]?.[0] ?? 0;
    if (anterior > diasDeDatos) b.disabled = true;
    rangos.append(b);
  }
  if (rangos.querySelector(`[data-dias="${elegido}"]`)?.disabled) {
    elegido = Number([...rangos.querySelectorAll('button:not(:disabled)')].pop().dataset.dias);
  }
  pintarRango();
  caja.append(rangos, cuerpo);
  const patron = patronCompra(todos);
  if (patron) {
    caja.append(el('p', 'panel-veredicto positivo', `Mejor momento para comprar: suele estar más barato ${patron.texto} (−${patron.baja.toFixed(0)} % frente al promedio).`));
  }
  return caja;
}

// Solo números: el texto que entra al SVG son cifras y fechas formateadas.
function graficaSVG(puntos) {
  const W = 320;
  const H = 92;
  const B = 10;
  const precios = puntos.map((x) => x.p);
  let min = Math.min(...precios);
  let max = Math.max(...precios);
  if (min === max) {
    const holgura = Math.max(Math.round(max * 0.05), 500);
    min -= holgura;
    max += holgura;
  }
  const t0 = puntos[0].t;
  const t1 = puntos[puntos.length - 1].t;
  const x = (t) => B + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - B * 2);
  const y = (p) => H - B - ((p - min) / (max - min)) * (H - B * 2);
  const linea = puntos.map((pt) => `${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join(' ');
  const puntosSvg = puntos
    .map((pt, i) => `<circle cx="${x(pt.t).toFixed(1)}" cy="${y(pt.p).toFixed(1)}" r="${i === puntos.length - 1 ? 4 : 2.5}" />`)
    .join('');
  const ultimoPt = puntos[puntos.length - 1];
  const etiquetaX = Math.min(W - 4, Math.max(26, x(ultimoPt.t)));
  return `
    <svg viewBox="0 0 ${W} ${H + 14}" role="img" aria-label="Evolución del precio">
      <line x1="${B}" y1="${H - B}" x2="${W - B}" y2="${H - B}" class="eje" />
      <polyline points="${linea}" class="linea-hist" fill="none" />
      <g class="puntos-hist">${puntosSvg}</g>
      <text x="${etiquetaX}" y="${Math.max(12, y(ultimoPt.p) - 8)}" class="etiqueta-hist" text-anchor="end">${pesos.format(ultimoPt.p)}</text>
      <text x="${B}" y="${H + 8}" class="fecha-hist">${fechaCorta.format(t0)}</text>
      <text x="${W - B}" y="${H + 8}" class="fecha-hist" text-anchor="end">${fechaCorta.format(t1)}</text>
    </svg>`;
}

// ── Calculadora de margen ───────────────────────────────────────────────────
const CAMPOS_MARGEN = [
  ['venta', 'Precio de venta', '100'],
  ['compra', 'Precio de compra', '100'],
  ['envio', 'Envío / recogida', '500'],
  ['comisionPct', 'Comisión (%)', '0.5'],
  ['comisionFija', 'Comisión fija ($)', '100'],
  ['ivaPct', 'Impuestos (%)', '0.5'],
];

function linea(texto, valor, clase) {
  const filaLinea = el('div', `salida-linea${clase ? ` ${clase}` : ''}`);
  filaLinea.append(el('span', '', texto), el('b', '', valor));
  return filaLinea;
}
export { linea as lineaSalida };

function panelMargen(clave, p) {
  const a = ajustes();
  const previo = venta(clave) || {};
  const caja = el('div', 'panel-caja');
  const entradas = {};
  const rejilla = el('div', 'rejilla');
  for (const [campo, texto, paso] of CAMPOS_MARGEN) {
    const etiqueta = el('label', '', texto);
    const entrada = el('input');
    entrada.type = 'number';
    entrada.inputMode = 'decimal';
    entrada.min = '0';
    entrada.step = paso;
    entrada.value = previo[campo] ?? (campo === 'venta' ? '' : campo === 'compra' ? p.precio : a.margen[campo]);
    entrada.addEventListener('input', pintar);
    entradas[campo] = entrada;
    etiqueta.append(entrada);
    rejilla.append(etiqueta);
  }
  const salida = el('div', 'panel-salida');
  const leer = (campo) => Number(entradas[campo].value) || 0;

  function pintar() {
    guardarVenta(clave, Object.fromEntries(CAMPOS_MARGEN.map(([campo]) => [campo, entradas[campo].value])));
    const r = margen(Object.fromEntries(CAMPOS_MARGEN.map(([campo]) => [campo, leer(campo)])));
    salida.replaceChildren();
    if (!leer('venta')) {
      salida.append(el('p', 'ayuda', 'Escribe el precio al que lo venderías para ver el margen neto.'));
      return;
    }
    const cb = devolucion(p.tienda.id, leer('compra'));
    salida.append(
      linea('Costos: compra + envío + comisión + impuestos', pesos.format(r.costo)),
      linea('Margen neto', pesos.format(r.neto), r.neto > 0 ? 'positivo' : 'negativo'),
      linea('Margen sobre la venta', `${r.pct.toFixed(1)} %`, r.neto > 0 ? 'positivo' : 'negativo'),
    );
    if (cb > 0) {
      const conCb = r.neto + cb;
      salida.append(linea(`Con el ${porcentajeCashback(p.tienda.id)} % de ${p.tienda.nombre} (+${pesos.format(cb)})`, pesos.format(conCb), conCb > 0 ? 'positivo' : 'negativo'));
    }
    if (r.neto <= 0) salida.append(el('p', 'error', 'Con esos números esta venta deja pérdida.'));
  }

  pintar();
  caja.append(rejilla, salida);
  return caja;
}

// ── Ficha del producto ─────────────────────────────────────────────────────
export function abrirFicha(p, grupo) {
  const dialogo = $('#ficha');
  const cuerpo = $('#ficha-cuerpo');
  cuerpo.replaceChildren();
  cuerpo.append(foto(p.imagenGrande || p.imagen, 'ficha-foto', p.nombre));
  const datos = el('div', 'ficha-datos');
  datos.append(el('p', 'ficha-tienda', p.tienda.nombre), el('h2', 'ficha-nombre', p.nombre));
  const precio = el('p', 'ficha-precio');
  precio.append(el('strong', '', pesos.format(p.precio)));
  if (p.precioAntes) precio.append(el('s', '', pesos.format(p.precioAntes)));
  datos.append(precio);
  const detalles = [presentacion(p), precioLitro(p), p.grados ? `${miles.format(p.grados)}° de alcohol` : '', p.variante || '', p.ean ? `Código ${p.ean}` : '']
    .filter(Boolean)
    .join(' · ');
  datos.append(el('p', 'ayuda', detalles));
  if (!p.disponible) datos.append(el('p', 'error', 'Agotado en esta tienda.'));
  if (p.tienda.contacto) datos.append(el('p', 'ayuda', `Contacto: ${p.tienda.contacto}`));
  const botones = el('div', 'ficha-botones');
  if (p.url) botones.append(enlace('Abrir en la tienda', p.url, 'boton'));
  if (grupo) botones.append(boton('Agregar al pedido', 'boton-texto', () => {
    acciones.agregarAlPedido?.(grupo, ultimo?.consulta);
    cerrarFicha();
  }));
  botones.append(boton('Compartir', 'boton-texto', () => compartir(`${p.nombre} · ${p.tienda.nombre}: ${pesos.format(p.precio)}${p.url ? `\n${p.url}` : ''}`)));
  datos.append(botones);
  cuerpo.append(datos);

  if (grupo?.mejores?.length > 1) {
    const otras = el('div', 'ficha-otras');
    otras.append(el('p', 'panel-titulo', `${presentacion(grupo)} en cada tienda`));
    for (const o of grupo.mejores) {
      const f = el('div', `salida-linea${o === p ? ' ficha-actual' : ''}`);
      const nombre = o.url ? enlace(o.tienda.nombre, o.url) : el('span', '', o.tienda.nombre);
      f.append(nombre, el('b', '', `${pesos.format(o.precio)}${o.disponible ? '' : ' · agotado'}`));
      otras.append(f);
    }
    cuerpo.append(otras);
  }
  cuerpo.append(panelHistorial(claveDe(p.tienda.id, p), p));
  if (typeof dialogo.showModal === 'function') dialogo.showModal();
  else dialogo.setAttribute('open', '');
}

export function cerrarFicha() {
  const dialogo = $('#ficha');
  if (dialogo.open) dialogo.close?.() ?? dialogo.removeAttribute('open');
}

// ── Avisos ─────────────────────────────────────────────────────────────────
const POCAS = 5;

function textoAlerta(a) {
  const donde = `${a.tienda} · ${a.nombre}`;
  switch (a.tipo) {
    case 'umbral':
      return `Precio objetivo · ${donde}: ${pesos.format(a.precio)} (pediste aviso bajo ${pesos.format(a.umbral)})`;
    case 'agota':
      return a.dias !== null && a.dias !== undefined && a.stock > POCAS
        ? `Se agota pronto · ${donde}: quedan ${a.stock} u., al ritmo actual alcanzan para ~${Math.max(1, Math.round(a.dias))} días`
        : `Últimas unidades · ${donde}: quedan ${a.stock}`;
    case 'agotado':
      return `Se agotó · ${donde}`;
    case 'volvio':
      return `Volvió a haber · ${donde}: ${pesos.format(a.precio)}`;
    case 'oferta':
      return `Nueva oferta · ${donde}: ${pesos.format(a.precio)}${a.a ? ` (antes ${pesos.format(a.a)})` : ''}${a.n ? ` · ${a.n}` : ''}`;
    case 'sinstock':
      return `Ninguna tienda lo tiene · «${a.nombre}»: si lo publicas, conviene pausarlo`;
    case 'tienda':
      return `${a.tienda} no está respondiendo · ${a.detalle}`;
    case 'semanal':
      return `Resumen de la semana · ${a.detalle}`;
    default:
      return `Punto dulce · ${donde}: ${pesos.format(a.precio)} (antes ${pesos.format(a.antes)} en los últimos días)`;
  }
}

export function pintarAlertas(caja, refrescar) {
  const avisos = listarAlertas();
  if (!avisos.length) return;
  const bloque = el('div', 'alertas');
  bloque.append(el('p', 'alertas-titulo', `Avisos: ${avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}`));
  for (const a of avisos.slice(0, 6)) {
    const filaAlerta = el('div', 'alerta');
    const texto = el('p', '', textoAlerta(a));
    texto.prepend(el('span', 'alerta-cuando', `${hace(a.t)} · `));
    const botones = el('div', 'alerta-botones');
    if (a.q) {
      botones.append(boton('Ver', 'mini', () => {
        acciones.mostrar('buscar');
        acciones.buscar(a.q);
      }));
    }
    if (a.tipo === 'tienda') botones.append(boton('Estado', 'mini', () => acciones.mostrar('estado')));
    botones.append(boton('Descartar', 'mini', () => {
      descartarAlerta(a.id);
      refrescar();
    }));
    filaAlerta.append(texto, botones);
    bloque.append(filaAlerta);
  }
  if (avisos.length > 6) bloque.append(el('p', 'ayuda', `…y ${avisos.length - 6} avisos más.`));
  bloque.append(boton('Descartar todos', 'boton-texto', () => {
    descartarTodas();
    refrescar();
  }));
  caja.append(bloque);
}

// Sin una búsqueda en pantalla, la vista de búsqueda muestra solo los avisos.
export function refrescar() {
  if (ultimo) return pintarResultados();
  const caja = $('#resultados');
  caja.replaceChildren();
  pintarAlertas(caja, refrescar);
}

// ── Pintar resultados ──────────────────────────────────────────────────────
const filtros = () => guardado('mp-filtros') || {};

function barraFiltros(datos) {
  const f = filtros();
  const caja = el('details', 'filtros');
  const activos = (f.soloOfertas ? 1 : 0) + (f.min > 0 ? 1 : 0) + (f.max > 0 ? 1 : 0) + (f.ocultas?.length || 0);
  if (activos) caja.open = true;
  caja.append(el('summary', '', activos ? `Filtros (${activos})` : 'Filtros'));
  const cambiar = (cambios) => {
    guardado('mp-filtros', { ...filtros(), ...cambios });
    pintarResultados();
  };
  const ofertas = el('label', 'opciones');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = Boolean(f.soloOfertas);
  check.addEventListener('change', () => cambiar({ soloOfertas: check.checked }));
  ofertas.append(check, document.createTextNode('Solo ofertas'));
  const rango = el('div', 'filtros-rango');
  for (const [campo, texto] of [['min', 'Desde $'], ['max', 'Hasta $']]) {
    const l = el('label', '', texto);
    const i = el('input');
    i.type = 'number';
    i.inputMode = 'numeric';
    i.min = '0';
    i.step = '1000';
    i.value = f[campo] || '';
    i.addEventListener('change', () => cambiar({ [campo]: Number(i.value) || 0 }));
    l.append(i);
    rango.append(l);
  }
  const tiendas = el('div', 'filtros-tiendas');
  for (const t of datos.tiendas) {
    const oculta = (f.ocultas || []).includes(t.id);
    const b = boton(t.nombre, `mini${oculta ? '' : ' activo'}`, () => {
      const ocultas = new Set(filtros().ocultas || []);
      if (oculta) ocultas.delete(t.id);
      else ocultas.add(t.id);
      cambiar({ ocultas: [...ocultas] });
    });
    b.setAttribute('aria-pressed', String(!oculta));
    tiendas.append(b);
  }
  const limpiar = boton('Quitar filtros', 'boton-texto', () => {
    guardado('mp-filtros', {});
    pintarResultados();
  });
  caja.append(ofertas, rango, tiendas, limpiar);
  return caja;
}

function textoParaCompartir(datos, grupos) {
  const lineas = [`Mejor precio para «${datos.consulta}»:`];
  for (const g of grupos.slice(0, 4)) {
    if (!g.ml || !g.mejores[0]?.disponible) continue;
    const top = g.mejores.filter((p) => p.disponible).slice(0, 3).map((p) => `${p.tienda.nombre} ${pesos.format(p.precio)}`);
    lineas.push(`• ${presentacion(g)}: ${top.join(' · ')}`);
  }
  return lineas.join('\n');
}

export function pintarResultados() {
  const datos = ultimo;
  if (!datos) return;
  const soloDisponibles = guardado('mp-solo-disponibles') ?? true;
  const verVariantes = guardado('mp-variantes') ?? false;
  let modo = guardado('mp-orden') || ajustes().orden || 'precio';
  if (modo === 'total' && !hayCostosDeLlegada()) modo = 'precio';

  // Estado de cada tienda
  const tiendas = el('div', 'tiendas');
  for (const t of datos.tiendas) {
    const p = el('span', `pastilla ${t.ok ? 'bien' : 'mal'}`);
    p.textContent = t.ok ? `${t.nombre} · ${t.productos.length}${t.buscadoComo ? ' por nombre' : ''}` : `${t.nombre}: ${t.error}`;
    tiendas.append(p);
  }
  const opciones = el('label', 'opciones');
  const check = el('input');
  check.type = 'checkbox';
  check.checked = soloDisponibles;
  check.addEventListener('change', () => {
    guardado('mp-solo-disponibles', check.checked);
    pintarResultados();
  });
  opciones.append(check, document.createTextNode('Solo productos disponibles'));

  const orden = el('label', 'opciones orden');
  orden.append(document.createTextNode('Ordenar por '));
  const selector = el('select');
  selector.append(new Option('precio de compra', 'precio'), new Option('precio + envío o traslado', 'total'), new Option('precio por litro', 'litro'));
  selector.value = modo;
  if (!hayCostosDeLlegada()) selector.options[1].disabled = true;
  selector.addEventListener('change', () => {
    guardado('mp-orden', selector.value);
    pintarResultados();
  });
  orden.append(selector);
  const grupos = agrupar(datos, { soloDisponibles, modo, variantes: verVariantes, filtros: filtros() });
  const herramientas = el('div', 'herramientas');
  herramientas.append(opciones, orden, boton('Compartir', 'boton-texto', () => compartir(textoParaCompartir(datos, grupos))));
  $('#estado').replaceChildren(tiendas, herramientas, barraFiltros(datos));

  const caja = $('#resultados');
  caja.replaceChildren();
  pintarAlertas(caja, refrescar);
  iguales = productosIguales(datos);
  if (datos.sugerencia) {
    const nota = el('p', 'nota nota-codigo sugerencia');
    nota.append('¿Quisiste decir ', boton(`«${datos.sugerencia}»`, 'enlace-boton', () => acciones.buscar(datos.sugerencia)), '?');
    caja.append(nota);
  }
  if (datos.codigo) {
    const porNombre = datos.tiendas.filter((t) => t.buscadoComo);
    const texto =
      `Búsqueda por código de barras ${datos.codigo}.` +
      (porNombre.length && porNombre[0].buscadoComo
        ? ` ${porNombre.map((t) => t.nombre).join(' y ')} no publican el código: se buscó «${porNombre[0].buscadoComo}» con el mismo tamaño.`
        : '');
    caja.append(el('p', 'nota nota-codigo', texto));
  }
  if (grupos.variantesOcultas || verVariantes) {
    const etiquetas = [...new Set(datos.tiendas.flatMap((t) => t.productos.filter((p) => p.otraVariante).map((p) => p.variante)))].slice(0, 4);
    const nota = el('p', 'nota nota-variantes');
    if (verVariantes) nota.append('Se muestran también otras variantes. ', boton('Ocultarlas', 'enlace-boton', () => {
      guardado('mp-variantes', false);
      pintarResultados();
    }));
    else nota.append(`${grupos.variantesOcultas} ${grupos.variantesOcultas === 1 ? 'producto es otra variante' : 'productos son otras variantes'} que no escribiste (${etiquetas.join(', ')}). `, boton('Mostrarlas', 'enlace-boton', () => {
      guardado('mp-variantes', true);
      pintarResultados();
    }));
    caja.append(nota);
  }
  if (!grupos.length) {
    pintarVacio(caja, datos);
    return;
  }
  pintarPorLitro(caja, grupos);

  for (const g of grupos) {
    const nodo = $('#tpl-grupo').content.firstElementChild.cloneNode(true);
    const cabeza = nodo.querySelector('.grupo-cabeza');
    const [primero, segundo] = g.mejores;
    cabeza.prepend(foto(primero?.imagen, 'grupo-foto', ''));
    nodo.querySelector('.grupo-titulo').textContent = `${presentacion(g)}${g.variante ? ` · ${g.variante}` : ''}`;
    const resumen = nodo.querySelector('.grupo-resumen');
    const conLlegada = modo === 'total';
    const costoDe = (p) => (conLlegada ? costoLlegada(p.tienda.id, p.precio) ?? 0 : 0);
    if (primero?.disponible && Boolean(g.ml)) {
      resumen.append('Más barato: ', el('b', '', `${primero.tienda.nombre} ${pesos.format(primero.precio + costoDe(primero))}`));
      if (conLlegada && costoDe(primero)) resumen.append(` (${pesos.format(primero.precio)} + ${pesos.format(costoDe(primero))} de envío o traslado)`);
      if (segundo) resumen.append(` · ${pesos.format(segundo.precio + costoDe(segundo) - primero.precio - costoDe(primero))} menos que ${segundo.tienda.nombre}`);
      else resumen.append(' · solo una tienda lo tiene');
      if (g.litro) resumen.append(` · ${pesos.format(Math.round(g.litro))} / L`);
      cabeza.append(boton('Agregar al pedido', 'mini grupo-pedido', () => acciones.agregarAlPedido?.(g, datos.consulta)));
    } else if (!g.mejores.length && g.mio) {
      resumen.textContent = 'Solo tu tienda tiene esta presentación.';
    } else {
      resumen.textContent = 'No se puede comparar: el nombre no dice el tamaño.';
    }
    if (g.mio) cabeza.append(lineaMia(g, primero));

    const filas = nodo.querySelector('.filas');
    g.mejores.forEach((p, i) => filas.append(fila(p, i === 0 && p.disponible && Boolean(g.ml), g)));

    const otros = g.productos.length - g.mejores.length;
    const detalles = nodo.querySelector('.todos');
    if (otros > 0) {
      detalles.querySelector('summary').textContent = `Ver las ${g.productos.length} opciones de esta presentación`;
      const todas = detalles.querySelector('.filas-todos');
      g.productos.forEach((p) => todas.append(fila(p, false, g)));
    } else detalles.remove();
    caja.append(nodo);
  }

  const propios = datos.tiendas.filter((t) => t.propio && t.ok);
  caja.append(
    el(
      'p',
      'nota',
      `Consultado el ${fechaLarga(datos.consultadoEn)} · Éxito y Olímpica muestran su precio nacional en línea; Makro, el de su tienda en Valledupar; ` +
        'Bevgo y Dislicores, el de su tienda en línea; Agua Pure, el de su carta a domicilio en Valledupar; D1, su precio nacional.' +
        (propios.length ? ` ${propios.map((t) => `${t.nombre} (lista actualizada ${t.actualizado ? hace(t.actualizado) : 'sin fecha'})`).join(', ')}: precios que tú anotaste.` : '') +
        ' Verifica en la tienda antes de comprar.',
    ),
  );
}

// «Tu precio» en el grupo: cuánto cobra tu tienda y qué tan lejos está del más barato.
function lineaMia(g, primero) {
  const linea = el('p', 'grupo-mio');
  linea.append(el('span', 'chip chip-propio', 'Tu tienda'), ` ${g.mio.tienda.nombre}: `, el('b', '', pesos.format(g.mio.precio)));
  if (primero?.disponible) {
    const dif = ((g.mio.precio - primero.precio) / primero.precio) * 100;
    if (Math.abs(dif) < 1) linea.append(' · igual al más barato');
    else linea.append(` · ${Math.abs(dif).toFixed(0)} % ${dif > 0 ? 'más caro' : 'más barato'} que ${primero.tienda.nombre}`);
  }
  if (!g.mio.disponible) linea.append(' · agotado en tu carta');
  return linea;
}

// Cuando hay varias presentaciones, cuál sale más barata por litro.
function pintarPorLitro(caja, grupos) {
  const conLitro = grupos.filter((g) => g.litro && g.ml && !g.variante);
  if (conLitro.length < 2) return;
  const ordenados = [...conLitro].sort((a, b) => a.litro - b.litro);
  const [mejor] = ordenados;
  const peor = ordenados[ordenados.length - 1];
  const ahorro = ((peor.litro - mejor.litro) / peor.litro) * 100;
  if (ahorro < 2) return;
  const nota = el('div', 'por-litro');
  nota.append(
    el('b', '', `Por litro sale más barato ${presentacion(mejor)} en ${mejor.mejores[0].tienda.nombre}`),
    el('span', '', `${pesos.format(Math.round(mejor.litro))} / L · ${ahorro.toFixed(0)} % menos que ${presentacion(peor)} (${pesos.format(Math.round(peor.litro))} / L)`),
  );
  caja.append(nota);
}

function pintarVacio(caja, datos) {
  const vacio = el('div', 'vacio');
  if (datos.codigo) {
    vacio.append(el('p', '', 'Ninguna tienda tiene un producto con ese código de barras. Prueba buscando por el nombre.'));
    caja.append(vacio);
    return;
  }
  const sinTamano = datos.consulta.replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|lts?|litros?|l)?\b/gi, ' ').replace(/\s+/g, ' ').trim();
  if (sinTamano && sinTamano !== datos.consulta) {
    vacio.append(el('p', '', 'Ninguna tienda tiene esa presentación. Algunas marcas vienen en otro tamaño (por ejemplo 700 ml en vez de 750).'));
    vacio.append(boton(`Buscar «${sinTamano}» en todos los tamaños`, 'boton', () => acciones.buscar(sinTamano)));
  } else {
    vacio.append(el('p', '', 'Ninguna tienda tiene un producto que coincida. Prueba con menos palabras o revisa los filtros.'));
  }
  caja.append(vacio);
}
