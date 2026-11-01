import {
  ajustes,
  claveDe,
  coordenadasDe,
  descartarAlerta,
  descartarTodas,
  descuento,
  devolucion,
  distanciaKm,
  enRango,
  estadoPrecio,
  fusionarServidor,
  LIQUIDACION,
  guardarAjustes,
  guardarVenta,
  listarAlertas,
  margen,
  porcentajeCashback,
  posicion,
  precioSugerido,
  prediccionStock,
  registrar,
  resumen as resumenSerie,
  serie,
  traslado,
  trasladoInfo,
  venta,
} from './datos.js';
import { abrirTutorial, configurarTutorial, iniciarTutorial } from './tutorial.js';

const $ = (sel) => document.querySelector(sel);
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const miles = new Intl.NumberFormat('es-CO');
const TIENDAS = ['Bevgo', 'Dislicores', 'Éxito', 'Makro', 'Olímpica', 'Agua Pure'];
const fechaCorta = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' });

let ultimo = null; // última respuesta del servidor
let codigos = new Map(); // código de barras → tiendas que lo tienen, en la búsqueda en pantalla

// ── Utilidades ──────────────────────────────────────────────────────────────
function guardado(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    return null;
  }
}

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function presentacion({ ml, unidades }) {
  if (!ml) return 'Sin tamaño identificado';
  const tam = `${miles.format(ml)} ml`;
  return unidades > 1 ? `${unidades} × ${tam}` : tam;
}

function precioLitro(p) {
  if (!p.ml) return '';
  const litros = (p.ml * (p.unidades || 1)) / 1000;
  return `${pesos.format(Math.round(p.precio / litros))} / L`;
}

async function api(ruta, opciones = {}) {
  const res = await fetch(ruta, { credentials: 'same-origin', ...opciones });
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/api/entrar') {
    mostrar('entrar');
    throw new Error('Inicia sesión');
  }
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

// ── Vistas ──────────────────────────────────────────────────────────────────
function mostrar(vista) {
  $('#vista-entrar').hidden = vista !== 'entrar';
  $('#vista-buscar').hidden = vista !== 'buscar';
  $('#vista-ajustes').hidden = vista !== 'ajustes';
  $('#vista-lista').hidden = vista !== 'lista';
  $('#vista-catalogo').hidden = vista !== 'catalogo';
  $('#salir').hidden = vista === 'entrar';
  $('#abrir-ajustes').hidden = vista === 'entrar';
  $('#abrir-lista').hidden = vista === 'entrar';
  $('#abrir-catalogo').hidden = vista === 'entrar';
  if (vista === 'entrar') $('#clave').focus();
}

function pintarRecientes() {
  const caja = $('#recientes');
  caja.replaceChildren();
  if (ultimo) return;
  for (const q of guardado('mp-recientes') || []) {
    const b = el('button', '', q);
    b.type = 'button';
    b.addEventListener('click', () => buscar(q));
    caja.append(b);
  }
}

function recordar(q) {
  const lista = (guardado('mp-recientes') || []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  guardado('mp-recientes', [q, ...lista].slice(0, 8));
}

function pintarCargando() {
  const fila = el('div', 'tiendas');
  for (const nombre of TIENDAS) fila.append(el('span', 'pastilla cargando', nombre));
  $('#estado').replaceChildren(fila);
  $('#resultados').replaceChildren();
}

// ── Agrupar por presentación ────────────────────────────────────────────────
function agrupar(datos, soloDisponibles, modo) {
  const costo = (t) => (modo === 'total' ? traslado(t.id) : 0);
  const total = (p) => p.precio + costo(p.tienda);

  const grupos = new Map();
  for (const t of datos.tiendas) {
    for (const p of t.productos) {
      if (soloDisponibles && !p.disponible) continue;
      const clave = p.ml ? `${p.unidades}x${p.ml}` : 'sin';
      if (!grupos.has(clave)) grupos.set(clave, { clave, ml: p.ml, unidades: p.unidades, productos: [] });
      grupos.get(clave).productos.push({ ...p, tienda: t });
    }
  }
  const lista = [...grupos.values()].map((g) => {
    g.productos.sort((a, b) => b.disponible - a.disponible || total(a) - total(b));
    const porTienda = new Map();
    for (const p of g.productos) if (!porTienda.has(p.tienda.id)) porTienda.set(p.tienda.id, p);
    g.mejores = [...porTienda.values()].sort((a, b) => b.disponible - a.disponible || total(a) - total(b));
    return g;
  });
  // Primero las presentaciones que comparan más tiendas; "sin tamaño" al final.
  return lista.sort((a, b) => {
    if (a.clave === 'sin') return 1;
    if (b.clave === 'sin') return -1;
    return b.mejores.length - a.mejores.length || a.ml * a.unidades - b.ml * b.unidades;
  });
}

function fila(p, ganador) {
  const nodo = $('#tpl-fila').content.firstElementChild.cloneNode(true);
  if (ganador) nodo.classList.add('ganador');
  if (!p.disponible) nodo.classList.add('agotado');
  nodo.querySelector('.fila-tienda').textContent = p.tienda.nombre;
  const enlace = nodo.querySelector('.fila-nombre');
  enlace.textContent = p.nombre;
  if (p.url) enlace.href = p.url;
  const extra = nodo.querySelector('.fila-extra');
  if (!p.disponible) {
    extra.textContent = 'Agotado';
    extra.classList.add('aviso');
  } else if (p.nota) {
    extra.textContent = p.nota;
    extra.classList.add('aviso');
  } else if (p.porNombre) {
    extra.textContent = `${p.tienda.alcance} · coincide por nombre y tamaño`;
  } else {
    extra.textContent = p.tienda.alcance;
  }
  nodo.querySelector('.fila-precio strong').textContent = pesos.format(p.precio);
  nodo.querySelector('.fila-precio s').textContent = p.precioAntes ? pesos.format(p.precioAntes) : '';
  nodo.querySelector('.fila-litro').textContent = precioLitro(p);

  const clave = claveDe(p.tienda.id, p);
  pintarHistorial(nodo, clave, p);
  nodo.querySelectorAll('.fila-herr .mini').forEach((boton) => {
    boton.addEventListener('click', () => alternarPanel(nodo, boton.dataset.panel, clave, p));
  });
  return nodo;
}

function pintarHistorial(nodo, clave, p) {
  const caja = nodo.querySelector('.fila-hist');
  const chip = (texto, clase) => {
    const s = el('span', `chip ${clase}`);
    s.textContent = texto;
    caja.append(s);
  };
  const estado = estadoPrecio(clave, p.precio);
  if (estado?.esMinimo) chip('Mínimo histórico', 'chip-min');
  else if (estado && estado.delta > 0) chip(`Bajó ${pesos.format(estado.delta)}`, 'chip-baja');
  else if (estado && estado.delta < 0) chip(`Subió ${pesos.format(-estado.delta)}`, 'chip-subio');

  const stock = Number.isFinite(p.stock) ? prediccionStock(serie(clave), Date.now()) : null;
  if (stock && p.disponible) {
    if (stock.dias !== null && stock.dias <= 14) chip(`Quedan ${stock.actual} u. · ~${Math.max(1, Math.round(stock.dias))} días`, 'chip-viaje');
    else if (stock.actual <= 20) chip(`Quedan ${stock.actual} u.`, 'chip-viaje');
  }

  const mismas = p.ean ? codigos.get(p.ean) : null;
  if (mismas && mismas.size > 1) chip(`Mismo código en ${mismas.size} tiendas`, 'chip-codigo');

  const rebaja = descuento(p);
  if (rebaja >= LIQUIDACION) chip(`Liquidación −${rebaja} %`, 'chip-oferta');
  else if (rebaja >= 5) chip(`Oferta −${rebaja} %`, 'chip-oferta');

  const viaje = trasladoInfo(p.tienda.id);
  if (viaje) chip(`${miles.format(Math.round(viaje.km))} km · +${pesos.format(viaje.costo)} de traslado`, 'chip-viaje');
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

function panelHistorial(clave, p) {
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
    cuerpo.replaceChildren(
      el('p', 'panel-titulo', `Mínimo ${pesos.format(r.min)} · Máximo ${pesos.format(r.max)} · Ahora ${pesos.format(p.precio)}`),
    );
    const pos = posicion(puntos, p.precio);
    if (pos) {
      let texto;
      let clase;
      if (pos.sobreMinimo <= 0.5) {
        texto = 'Estás en el mínimo del período: buen momento para comprar.';
        clase = 'positivo';
      } else if (pos.sobrePromedio >= 5) {
        texto = `Precio inflado: ${pos.sobrePromedio.toFixed(0)} % sobre el promedio (${pesos.format(Math.round(pos.promedio))}). Si puedes, espera.`;
        clase = 'negativo';
      } else {
        texto = `${pos.sobreMinimo.toFixed(0)} % sobre el mínimo del período · promedio ${pesos.format(Math.round(pos.promedio))}.`;
        clase = '';
      }
      cuerpo.append(el('p', `panel-veredicto ${clase}`, texto));
    }
    const contenedor = el('div', 'grafica');
    contenedor.innerHTML = graficaSVG(puntos);
    cuerpo.append(
      contenedor,
      el('p', 'ayuda', `${r.n} registros desde el ${fechaCorta.format(r.primero)} · no incluye costos de envío.`),
    );
  }

  for (const [dias, texto] of RANGOS) {
    const b = el('button', 'mini', texto);
    b.type = 'button';
    b.dataset.dias = dias;
    // Un rango más largo que los datos se ve igual que el anterior: se ofrece
    // solo el primero que ya cubre todo.
    const anterior = RANGOS[RANGOS.findIndex(([d]) => d === dias) - 1]?.[0] ?? 0;
    if (anterior > diasDeDatos) b.disabled = true;
    b.addEventListener('click', () => {
      elegido = dias;
      guardado('mp-rango', dias);
      pintarRango();
    });
    rangos.append(b);
  }
  if (rangos.querySelector(`[data-dias="${elegido}"]`)?.disabled) {
    elegido = Number([...rangos.querySelectorAll('button:not(:disabled)')].pop().dataset.dias);
  }
  pintarRango();
  caja.append(rangos, cuerpo);
  return caja;
}

function graficaSVG(puntos) {
  const W = 320;
  const H = 92;
  const B = 10;
  const precios = puntos.map((x) => x.p);
  let min = Math.min(...precios);
  let max = Math.max(...precios);
  if (min === max) {
    const margen = Math.max(Math.round(max * 0.05), 500);
    min -= margen;
    max += margen;
  }
  const t0 = puntos[0].t;
  const t1 = puntos[puntos.length - 1].t || t0 + 1;
  const x = (t) => B + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - B * 2);
  const y = (p) => H - B - ((p - min) / (max - min)) * (H - B * 2);
  const linea = puntos.map((pt) => `${x(pt.t).toFixed(1)},${y(pt.p).toFixed(1)}`).join(' ');
  const puntosSvg = puntos
    .map(
      (pt, i) =>
        `<circle cx="${x(pt.t).toFixed(1)}" cy="${y(pt.p).toFixed(1)}" r="${i === puntos.length - 1 ? 4 : 2.5}" />`,
    )
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

  function leer(campo) {
    return Number(entradas[campo].value) || 0;
  }

  function pintar() {
    guardarVenta(clave, Object.fromEntries(CAMPOS_MARGEN.map(([campo]) => [campo, entradas[campo].value])));
    const r = margen({
      venta: leer('venta'),
      compra: leer('compra'),
      envio: leer('envio'),
      comisionPct: leer('comisionPct'),
      comisionFija: leer('comisionFija'),
      ivaPct: leer('ivaPct'),
    });
    salida.replaceChildren();
    if (!leer('venta')) {
      salida.append(el('p', 'ayuda', 'Escribe el precio al que lo venderías para ver el margen neto.'));
      return;
    }
    const linea = (texto, valor, clase) => {
      const filaLinea = el('div', `salida-linea${clase ? ` ${clase}` : ''}`);
      filaLinea.append(el('span', '', texto), el('b', '', valor));
      return filaLinea;
    };
    const cb = devolucion(p.tienda.id, leer('compra'));
    salida.append(
      linea('Costos: compra + envío + comisión + impuestos', pesos.format(r.costo)),
      linea('Margen neto', pesos.format(r.neto), r.neto > 0 ? 'positivo' : 'negativo'),
      linea('Margen sobre la venta', `${r.pct.toFixed(1)} %`, r.neto > 0 ? 'positivo' : 'negativo'),
    );
    if (cb > 0) {
      const conCb = r.neto + cb;
      salida.append(
        linea(
          `Con el ${porcentajeCashback(p.tienda.id)} % de ${p.tienda.nombre} (+${pesos.format(cb)})`,
          pesos.format(conCb),
          conCb > 0 ? 'positivo' : 'negativo',
        ),
      );
    }
    if (r.neto <= 0) salida.append(el('p', 'error', 'Con esos números esta venta deja pérdida.'));
  }

  pintar();
  caja.append(rejilla, salida);
  return caja;
}

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
    default:
      return `Punto dulce · ${donde}: ${pesos.format(a.precio)} (antes ${pesos.format(a.antes)} en los últimos días)`;
  }
}

const POCAS = 5;

function hace(t) {
  const minutos = Math.round((Date.now() - t) / 60_000);
  if (minutos < 60) return minutos <= 1 ? 'ahora' : `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

// Sin una búsqueda en pantalla, la vista de búsqueda muestra solo los avisos.
function refrescar() {
  if (ultimo) return pintarResultados();
  const caja = $('#resultados');
  caja.replaceChildren();
  pintarAlertas(caja);
}

function pintarAlertas(caja) {
  const avisos = listarAlertas();
  if (!avisos.length) return;
  const bloque = el('div', 'alertas');
  bloque.append(el('p', 'alertas-titulo', `Avisos: ${avisos.length === 1 ? '1 aviso' : `${avisos.length} avisos`}`));
  for (const a of avisos.slice(0, 6)) {
    const filaAlerta = el('div', 'alerta');
    const texto = el('p', '', textoAlerta(a));
    texto.prepend(el('span', 'alerta-cuando', `${hace(a.t)} · `));
    const cerrar = el('button', 'mini', 'Descartar');
    cerrar.type = 'button';
    cerrar.addEventListener('click', () => {
      descartarAlerta(a.id);
      refrescar();
    });
    const botones = el('div', 'alerta-botones');
    if (a.q) {
      const ver = el('button', 'mini', 'Ver');
      ver.type = 'button';
      ver.addEventListener('click', () => {
        mostrar('buscar');
        buscar(a.q);
      });
      botones.append(ver);
    }
    botones.append(cerrar);
    filaAlerta.append(texto, botones);
    bloque.append(filaAlerta);
  }
  if (avisos.length > 6) bloque.append(el('p', 'ayuda', `…y ${avisos.length - 6} avisos más.`));
  const todas = el('button', 'boton-texto', 'Descartar todos');
  todas.type = 'button';
  todas.addEventListener('click', () => {
    descartarTodas();
    refrescar();
  });
  bloque.append(todas);
  caja.append(bloque);
}

function pintarResultados() {
  const datos = ultimo;
  if (!datos) return;
  const soloDisponibles = guardado('mp-solo-disponibles') ?? true;
  const logistica = ajustes().logistica;
  let modo = guardado('mp-orden') || 'precio';
  if (modo === 'total' && !logistica.activo) modo = 'precio';

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
  selector.append(new Option('precio de compra', 'precio'), new Option('precio + traslado', 'total'));
  selector.value = modo;
  if (!logistica.activo) selector.options[1].disabled = true;
  selector.addEventListener('change', () => {
    guardado('mp-orden', selector.value);
    pintarResultados();
  });
  orden.append(selector);
  $('#estado').replaceChildren(tiendas, opciones, orden);

  const caja = $('#resultados');
  caja.replaceChildren();
  pintarAlertas(caja);
  codigos = new Map();
  for (const t of datos.tiendas) {
    for (const p of t.productos) {
      if (!p.ean) continue;
      if (!codigos.has(p.ean)) codigos.set(p.ean, new Set());
      codigos.get(p.ean).add(t.id);
    }
  }
  if (datos.codigo) {
    const porNombre = datos.tiendas.filter((t) => t.buscadoComo);
    const texto = `Búsqueda por código de barras ${datos.codigo}.` +
      (porNombre.length && porNombre[0].buscadoComo
        ? ` ${porNombre.map((t) => t.nombre).join(' y ')} no publican el código: se buscó «${porNombre[0].buscadoComo}» con el mismo tamaño.`
        : '');
    caja.append(el('p', 'nota nota-codigo', texto));
  }
  const grupos = agrupar(datos, soloDisponibles, modo);
  if (!grupos.length) {
    const vacio = el('div', 'vacio');
    if (datos.codigo) {
      vacio.append(el('p', '', 'Ninguna tienda tiene un producto con ese código de barras. Prueba buscando por el nombre.'));
      caja.append(vacio);
      return;
    }
    const sinTamano = datos.consulta.replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|lts?|litros?|l)?\b/gi, ' ').replace(/\s+/g, ' ').trim();
    if (sinTamano && sinTamano !== datos.consulta) {
      vacio.append(el('p', '', 'Ninguna tienda tiene esa presentación. Algunas marcas vienen en otro tamaño (por ejemplo 700 ml en vez de 750).'));
      const b = el('button', 'boton', `Buscar «${sinTamano}» en todos los tamaños`);
      b.type = 'button';
      b.addEventListener('click', () => buscar(sinTamano));
      vacio.append(b);
    } else {
      vacio.append(el('p', '', 'Ninguna tienda tiene un producto que coincida. Prueba con menos palabras.'));
    }
    caja.append(vacio);
    return;
  }

  for (const g of grupos) {
    const nodo = $('#tpl-grupo').content.firstElementChild.cloneNode(true);
    nodo.querySelector('.grupo-titulo').textContent = presentacion(g);
    const resumen = nodo.querySelector('.grupo-resumen');
    const [primero, segundo] = g.mejores;
    const conTraslado = modo === 'total';
    const costoDe = (p) => (conTraslado ? traslado(p.tienda.id) : 0);
    if (primero?.disponible && g.clave !== 'sin') {
      const b = el('b', '', `${primero.tienda.nombre} ${pesos.format(primero.precio + costoDe(primero))}`);
      resumen.append('Más barato: ', b);
      if (conTraslado && costoDe(primero)) {
        resumen.append(` (${pesos.format(primero.precio)} + ${pesos.format(costoDe(primero))} de traslado)`);
      }
      if (segundo) {
        resumen.append(
          ` · ${pesos.format(segundo.precio + costoDe(segundo) - primero.precio - costoDe(primero))} menos que ${segundo.tienda.nombre}`,
        );
      } else resumen.append(' · solo una tienda lo tiene');
    } else {
      resumen.textContent = 'No se puede comparar: el nombre no dice el tamaño.';
    }

    const filas = nodo.querySelector('.filas');
    g.mejores.forEach((p, i) => filas.append(fila(p, i === 0 && p.disponible && g.clave !== 'sin')));

    const otros = g.productos.length - g.mejores.length;
    const detalles = nodo.querySelector('.todos');
    if (otros > 0) {
      detalles.querySelector('summary').textContent = `Ver las ${g.productos.length} opciones de esta presentación`;
      const todas = detalles.querySelector('.filas-todos');
      g.productos.forEach((p) => todas.append(fila(p, false)));
    } else {
      detalles.remove();
    }
    caja.append(nodo);
  }

  const fecha = new Date(datos.consultadoEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
  caja.append(
    el(
      'p',
      'nota',
      `Consultado el ${fecha} · Éxito y Olímpica muestran su precio nacional en línea; Makro, el de su tienda en Valledupar; ` +
        'Bevgo y Dislicores, el de su tienda en línea; Agua Pure, el de su carta a domicilio en Valledupar. No incluye costos de envío. Verifica en la tienda antes de comprar.',
    ),
  );
}

// ── Acciones ────────────────────────────────────────────────────────────────
async function buscar(q) {
  q = q.trim();
  if (q.length < 2) return;
  $('#q').value = q;
  $('#q').blur();
  const boton = $('#form-buscar button');
  boton.disabled = true;
  ultimo = null;
  pintarRecientes();
  pintarCargando();
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  try {
    ultimo = await api(`/api/buscar?q=${encodeURIComponent(q)}`);
    recordar(q);
    registrar(ultimo);
    pintarRecientes();
    pintarResultados();
  } catch (error) {
    $('#estado').replaceChildren(el('p', 'error', error.message));
  } finally {
    boton.disabled = false;
  }
}

$('#form-buscar').addEventListener('submit', (e) => {
  e.preventDefault();
  buscar($('#q').value);
});

$('#form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#error-entrar');
  error.textContent = '';
  try {
    await api('/api/entrar', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clave: $('#clave').value }),
    });
    $('#clave').value = '';
    iniciar();
  } catch (err) {
    error.textContent = err.message;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/api/salir', { method: 'POST' }).catch(() => {});
  ultimo = null;
  mostrar('entrar');
});

// ── Ajustes ─────────────────────────────────────────────────────────────────
async function listaTiendas() {
  try {
    const { tiendas } = await api('/api/tiendas');
    if (tiendas?.length) return tiendas;
  } catch {
    /* sin sesión o sin red: se usa lo que ya se había buscado */
  }
  return (ultimo?.tiendas || []).map((t) => ({ id: t.id, nombre: t.nombre }));
}

function etiquetaDato(texto, valor, dataset) {
  const l = el('label', '', texto);
  const i = el('input');
  Object.assign(i.dataset, dataset);
  if (valor !== undefined && valor !== null) i.value = valor;
  l.append(i);
  return l;
}

function pintarResumenLogistica() {
  const caja = $('#aj-log-resumen');
  const origen = coordenadasDe($('#aj-log-origen').value);
  const porKm = Number($('#aj-log-porkm').value) || 0;
  if (!origen) {
    caja.textContent = 'Indica tu ubicación para poder calcular las distancias.';
    return;
  }
  const lineas = [];
  for (const etiqueta of $('#aj-log-tiendas').children) {
    const entrada = etiqueta.querySelector('input');
    const destino = coordenadasDe(entrada.value);
    if (!destino) continue;
    const km = distanciaKm(origen.lat, origen.lng, destino.lat, destino.lng) * 2;
    lineas.push(
      `${entrada.dataset.nombre}: ${km.toFixed(1)} km ida y vuelta · ${pesos.format(Math.round(km * porKm))}`,
    );
  }
  caja.textContent = lineas.length ? lineas.join(' · ') : 'Pega el enlace de Google Maps de una tienda para ver la distancia.';
}

async function abrirAjustes() {
  const a = ajustes();
  $('#aj-comision-pct').value = a.margen.comisionPct;
  $('#aj-comision-fija').value = a.margen.comisionFija;
  $('#aj-iva').value = a.margen.ivaPct;
  $('#aj-envio').value = a.margen.envio;
  $('#aj-objetivo').value = a.margen.objetivo;
  $('#aj-log-activo').checked = a.logistica.activo;
  $('#aj-log-porkm').value = a.logistica.porKm;
  $('#aj-log-origen').value = Number.isFinite(a.logistica.tuLat) ? `${a.logistica.tuLat}, ${a.logistica.tuLng}` : '';
  $('#aj-listo').textContent = '';

  const tiendas = await listaTiendas();
  const cajaLog = $('#aj-log-tiendas');
  const cajaCb = $('#aj-cashback');
  cajaLog.replaceChildren();
  cajaCb.replaceChildren();
  for (const t of tiendas) {
    const destino = a.logistica.tiendas[t.id];
    const conCoords = destino && Number.isFinite(destino.lat) ? `${destino.lat}, ${destino.lng}` : '';
    cajaLog.append(
      etiquetaDato(t.nombre, conCoords, { tienda: t.id, nombre: t.nombre, tipo: 'logistica' }),
    );
    cajaCb.append(
      etiquetaDato(`${t.nombre} (%)`, porcentajeCashback(t.id), { tienda: t.id, tipo: 'cashback' }),
    );
  }
  for (const caja of [cajaLog, cajaCb]) {
    caja.querySelectorAll('input').forEach((i) => {
      if (i.dataset.tipo === 'logistica') {
        i.type = 'text';
        i.inputMode = 'text';
        i.placeholder = 'Enlace de Google Maps';
        i.addEventListener('input', pintarResumenLogistica);
      } else {
        i.type = 'number';
        i.inputMode = 'decimal';
        i.min = '0';
        i.step = '0.5';
      }
    });
  }
  pintarResumenLogistica();
  mostrar('ajustes');
}

function guardarPanelAjustes() {
  const origen = coordenadasDe($('#aj-log-origen').value);
  const tiendas = {};
  for (const etiqueta of $('#aj-log-tiendas').children) {
    const entrada = etiqueta.querySelector('input');
    const destino = coordenadasDe(entrada.value);
    if (destino) tiendas[entrada.dataset.tienda] = destino;
  }
  const cashback = {};
  for (const etiqueta of $('#aj-cashback').children) {
    const entrada = etiqueta.querySelector('input');
    const pct = Number(entrada.value) || 0;
    if (pct > 0) cashback[entrada.dataset.tienda] = pct;
  }
  guardarAjustes({
    margen: {
      comisionPct: Number($('#aj-comision-pct').value) || 0,
      comisionFija: Number($('#aj-comision-fija').value) || 0,
      ivaPct: Number($('#aj-iva').value) || 0,
      envio: Number($('#aj-envio').value) || 0,
      objetivo: Number($('#aj-objetivo').value) || 0,
    },
    logistica: {
      activo: $('#aj-log-activo').checked,
      porKm: Number($('#aj-log-porkm').value) || 0,
      tuLat: origen ? origen.lat : null,
      tuLng: origen ? origen.lng : null,
      tiendas,
    },
    cashback,
  });
  $('#aj-listo').textContent = origen ? 'Guardado.' : 'Guardado, pero falta tu ubicación para el traslado.';
  if (ultimo) pintarResultados();
}

$('#abrir-ajustes').addEventListener('click', abrirAjustes);
$('#ir-buscar').addEventListener('click', (e) => {
  if ($('#vista-entrar').hidden === false) return;
  e.preventDefault();
  mostrar('buscar');
  refrescar();
  $('#q').focus();
});
$('#abrir-tutorial').addEventListener('click', () => abrirTutorial());
$('#aj-volver').addEventListener('click', () => {
  mostrar('buscar');
  if (ultimo) pintarResultados();
});
$('#aj-guardar').addEventListener('click', guardarPanelAjustes);
$('#aj-log-origen').addEventListener('input', pintarResumenLogistica);
$('#aj-log-porkm').addEventListener('input', pintarResumenLogistica);
$('#aj-log-mi').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('#aj-listo').textContent = 'Este navegador no puede ubicarte: pega el enlace de Google Maps.';
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('#aj-log-origen').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
      pintarResumenLogistica();
    },
    () => {
      $('#aj-listo').textContent = 'No se pudo leer tu ubicación: pega el enlace de Google Maps.';
    },
    { enableHighAccuracy: true, timeout: 10000 },
  );
});

// ── Mi lista + Propuesta del día ────────────────────────────────────────────
function listaLeer() {
  return guardado('mp-lista') || [];
}
function listaGuardar(items) {
  guardado('mp-lista', items);
  guardado('mp-lista-pendiente', true);
  subirLista();
}

// La lista vive también en el servidor: así el monitoreo la revisa sola y se
// comparte entre teléfonos. Si no hay red, se sube en la próxima apertura.
async function subirLista() {
  try {
    const { lista } = await api('/api/lista', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lista: listaLeer() }),
    });
    guardado('mp-lista', lista);
    guardado('mp-lista-pendiente', false);
  } catch {
    /* queda pendiente */
  }
}

async function sincronizar() {
  try {
    const datos = await api(`/api/monitoreo?desde=${guardado('mp-sync') || 0}`);
    if (guardado('mp-lista-pendiente') || (!datos.lista.length && listaLeer().length)) await subirLista();
    else guardado('mp-lista', datos.lista);
    fusionarServidor(datos);
    guardado('mp-sync', datos.ahora);
    guardado('mp-revisado', datos.revisado);
    guardado('mp-resumenes', datos.resumenes || {});
  } catch {
    /* sin red: se sigue con lo del navegador */
  }
}
function propuestaLeer() {
  return guardado('mp-lista-propuesta') || null;
}
function propuestaGuardar(p) {
  guardado('mp-lista-propuesta', p);
}

function pintarLista() {
  const caja = $('#lista-items');
  caja.replaceChildren();
  const items = listaLeer();
  if (!items.length) {
    const vacio = el('p', 'ayuda', 'Tu lista está vacía. Agrega el primer producto arriba.');
    caja.append(vacio);
    $('#lista-analizar').disabled = true;
    return;
  }
  $('#lista-analizar').disabled = false;
  for (const item of items) {
    const fila = el('div', 'lista-fila');
    const texto = el('div', 'lista-texto');
    texto.append(el('span', '', item.q));
    const revisado = (guardado('mp-revisado') || {})[item.id];
    texto.append(el('span', 'ayuda', revisado ? `Revisado ${hace(revisado)}` : 'Se revisará en la próxima hora'));
    const umbral = el('label', 'lista-umbral', 'Avísame bajo $');
    const entrada = el('input');
    entrada.type = 'number';
    entrada.inputMode = 'numeric';
    entrada.min = '0';
    entrada.step = '500';
    entrada.placeholder = 'opcional';
    entrada.value = item.umbral ?? '';
    entrada.addEventListener('change', () => {
      const valor = Number(entrada.value);
      listaGuardar(listaLeer().map((x) => (x.id === item.id ? { ...x, umbral: valor > 0 ? valor : null } : x)));
    });
    umbral.append(entrada);
    const quitar = el('button', 'mini', 'Quitar');
    quitar.type = 'button';
    quitar.addEventListener('click', () => {
      listaGuardar(listaLeer().filter((x) => x.id !== item.id));
      pintarLista();
    });
    const acciones = el('div', 'lista-acciones');
    acciones.append(umbral, quitar);
    fila.append(texto, acciones);
    caja.append(fila);
  }
}

async function analizarLista() {
  const items = listaLeer();
  if (!items.length) return;
  const boton = $('#lista-analizar');
  const estado = $('#lista-estado');
  boton.disabled = true;
  const filas = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    estado.replaceChildren(el('p', '', `Consultando ${i + 1} de ${items.length}: ${item.q}…`));
    try {
      const datos = await api(`/api/buscar?q=${encodeURIComponent(item.q)}`);
      registrar(datos);
      const grupos = agrupar(datos, true, 'precio');
      // La presentación del tamaño que se escribió ("…750"); si no hay, la más comparada.
      const tamanos = item.q.match(/\d+/g) || [];
      const g =
        grupos.find((x) => x.clave !== 'sin' && tamanos.includes(String(x.ml))) || grupos.find((x) => x.clave !== 'sin');
      if (g?.mejores?.length) {
        const [primero, segundo] = g.mejores;
        filas.push({
          q: item.q,
          id: item.id,
          tienda: primero.tienda.nombre,
          precio: primero.precio,
          ahorro: primero.disponible && segundo ? segundo.precio - primero.precio : 0,
          url: primero.url || '',
          presentacion: presentacion(g),
        });
      } else {
        filas.push({ q: item.q, id: item.id, error: 'Sin presentación comparable' });
      }
    } catch (error) {
      filas.push({ q: item.q, id: item.id, error: error.message });
    }
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  propuestaGuardar({ generadaEn: Date.now(), filas });
  pintarPropuesta();
  boton.disabled = false;
  estado.replaceChildren();
}

function pintarPropuesta() {
  const caja = $('#propuesta');
  caja.replaceChildren();
  const p = propuestaLeer();
  if (!p?.filas?.length) {
    caja.append(el('p', 'ayuda', 'Todavía no hay una propuesta. Pulsa «Analizar ahora» para generarla.'));
    return;
  }
  const validas = p.filas.filter((f) => !f.error);
  if (!validas.length) {
    caja.append(el('p', 'ayuda', 'No se pudo comparar ningún producto de la lista.'));
    return;
  }
  const decidida = validas.reduce((a, b) => (b.ahorro > a.ahorro ? b : a));
  const totalAhorro = validas.reduce((s, f) => s + f.ahorro, 0);
  const fecha = new Date(p.generadaEn).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

  caja.append(el('p', 'propuesta-titulo', `Propuesta del día (${fecha})`));
  for (const f of validas) {
    const fila = el('div', 'propuesta-fila');
    if (f.id === decidida.id) fila.append(el('span', 'chip chip-decision', 'Decisión'));
    const izq = el('div', 'propuesta-izq');
    izq.append(el('b', '', f.q));
    if (f.presentacion) izq.append(el('span', 'ayuda', f.presentacion));
    const der = el('div', 'propuesta-der');
    const enlace = el('a', '', f.tienda);
    enlace.href = f.url;
    enlace.target = '_blank';
    enlace.rel = 'noopener noreferrer';
    der.append(enlace, el('strong', '', pesos.format(f.precio)));
    if (f.ahorro > 0) der.append(el('span', 'chip chip-baja', `Ahorras ${pesos.format(f.ahorro)}`));
    fila.append(izq, der);
    caja.append(fila);
  }
  if (totalAhorro > 0) {
    caja.append(el('p', 'propuesta-total', `Total que ahorras en esta lista: ${pesos.format(totalAhorro)}`));
  }
  const errores = p.filas.filter((f) => f.error);
  if (errores.length) {
    for (const f of errores) {
      caja.append(el('p', 'error', `${f.q}: ${f.error}`));
    }
  }
}

$('#form-lista').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#lista-q').value.trim();
  if (q.length < 2) return;
  const items = listaLeer();
  if (items.some((x) => x.q.toLowerCase() === q.toLowerCase())) {
    $('#lista-q').value = '';
    return;
  }
  items.push({ q, id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) });
  listaGuardar(items);
  $('#lista-q').value = '';
  pintarLista();
});

$('#lista-analizar').addEventListener('click', analizarLista);

$('#abrir-lista').addEventListener('click', () => {
  mostrar('lista');
  pintarLista();
  pintarPropuesta();
});

// ── Catálogo de reventa ─────────────────────────────────────────────────────
// Cada producto de la lista que "vendo" tiene su precio y una regla. Con el
// resumen del mercado que deja el monitoreo se calcula el precio sugerido y si
// conviene pausar la publicación porque ninguna tienda lo tiene.
const resumenes = () => guardado('mp-resumenes') || {};

// La compra que menos cuesta de verdad: precio + traslado − cashback.
function mejorCompra(resumen) {
  let mejor = null;
  for (const o of resumen?.ofertas || []) {
    const costo = o.precio + traslado(o.tienda) - devolucion(o.tienda, o.precio);
    if (!mejor || costo < mejor.costo) mejor = { ...o, costo };
  }
  return mejor;
}

function analizarItem(item) {
  const a = ajustes().margen;
  const r = resumenes()[item.id];
  const compra = mejorCompra(r);
  const base = { r, compra, item };
  if (!r) return { ...base, estado: 'sin-datos' };
  if (r.sinDatos) return { ...base, estado: 'sin-datos' };
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
  const netoDe = (venta) => (venta > 0 ? margen({ venta, compra: compra.costo, ...comunes }) : null);
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

function campoCatalogo(texto, valor, alCambiar, { paso = '100', placeholder = '' } = {}) {
  const etiqueta = el('label', '', texto);
  const entrada = el('input');
  entrada.type = 'number';
  entrada.inputMode = 'decimal';
  entrada.min = '0';
  entrada.step = paso;
  entrada.placeholder = placeholder;
  entrada.value = valor ?? '';
  entrada.addEventListener('change', () => alCambiar(entrada.value === '' ? null : Number(entrada.value)));
  etiqueta.append(entrada);
  return etiqueta;
}

function actualizarItem(id, cambios) {
  listaGuardar(listaLeer().map((x) => (x.id === id ? { ...x, ...cambios } : x)));
  pintarCatalogo();
}

function tarjetaCatalogo(item) {
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
    estado.append(el('span', 'chip', 'Sin datos todavía'));
    estado.append(el('span', 'ayuda', 'Pulsa «Actualizar precios» o espera la próxima revisión.'));
  } else if (info.estado === 'pausar') {
    estado.append(el('span', 'chip chip-subio', 'Pausar publicación'));
    estado.append(el('span', 'ayuda', `Ninguna tienda lo tiene disponible (${hace(info.r.t)}).`));
  } else {
    estado.append(el('span', 'chip chip-baja', 'Activo'));
    const compra = el('span', 'ayuda');
    compra.append('Compra: ');
    const enlace = el('a', '', `${info.compra.tiendaNombre} ${pesos.format(info.compra.precio)}`);
    if (info.compra.url) {
      enlace.href = info.compra.url;
      enlace.target = '_blank';
      enlace.rel = 'noopener noreferrer';
    }
    compra.append(enlace);
    if (info.compra.costo !== info.compra.precio) compra.append(` (costo real ${pesos.format(Math.round(info.compra.costo))})`);
    if (info.r.mediana) compra.append(` · mercado ${pesos.format(Math.round(info.r.mediana))} en ${info.r.ofertas.length} ${info.r.ofertas.length === 1 ? 'tienda' : 'tiendas'}`);
    compra.append(` · ${hace(info.r.t)}`);
    estado.append(compra);
  }
  tarjeta.append(estado);

  const rejilla = el('div', 'rejilla cat-rejilla');
  rejilla.append(campoCatalogo('Mi precio de venta ($)', item.venta, (v) => actualizarItem(item.id, { venta: v })));
  const regla = el('label', '', 'Regla de precio');
  const selector = el('select');
  selector.append(new Option('Margen objetivo', 'margen'), new Option('Seguir al mercado', 'mercado'));
  selector.value = item.modo || 'margen';
  selector.addEventListener('change', () => actualizarItem(item.id, { modo: selector.value }));
  regla.append(selector);
  rejilla.append(regla);
  if ((item.modo || 'margen') === 'margen') {
    rejilla.append(
      campoCatalogo('Margen neto (%)', item.margen, (v) => actualizarItem(item.id, { margen: v }), {
        paso: '1',
        placeholder: `${ajustes().margen.objetivo} (Ajustes)`,
      }),
    );
  } else {
    rejilla.append(campoCatalogo('Por debajo del mercado (%)', item.bajoMercado, (v) => actualizarItem(item.id, { bajoMercado: v }), { paso: '0.5', placeholder: '0' }));
  }
  tarjeta.append(rejilla);

  if (info.estado !== 'activo') return tarjeta;
  const salida = el('div', 'panel-salida');
  const linea = (texto, valor, clase) => {
    const filaLinea = el('div', `salida-linea${clase ? ` ${clase}` : ''}`);
    filaLinea.append(el('span', '', texto), el('b', '', valor));
    return filaLinea;
  };
  if (info.actual) {
    salida.append(linea('Neto con tu precio', `${pesos.format(Math.round(info.actual.neto))} · ${info.actual.pct.toFixed(1)} %`, info.actual.neto > 0 ? 'positivo' : 'negativo'));
  }
  if (info.sugerido?.precio) {
    salida.append(
      linea(
        `Precio sugerido (${pesos.format(info.sugerido.precio)})`,
        `${pesos.format(Math.round(info.conSugerido.neto))} · ${info.conSugerido.pct.toFixed(1)} %`,
        info.conSugerido.neto > 0 ? 'positivo' : 'negativo',
      ),
    );
  }
  if (info.sugerido?.piso) salida.append(linea('Precio mínimo sin pérdida', pesos.format(info.sugerido.piso)));
  if (info.sugerido?.motivo) salida.append(el('p', 'ayuda', TEXTO_MOTIVO[info.sugerido.motivo]));
  tarjeta.append(salida);

  if (info.sugerido?.precio && info.accion !== 'mantener') {
    const texto = { subir: 'Subir a', bajar: 'Bajar a', fijar: 'Usar' }[info.accion];
    const aplicar = el('button', 'mini activo cat-aplicar', `${texto} ${pesos.format(info.sugerido.precio)}`);
    aplicar.type = 'button';
    aplicar.addEventListener('click', () => actualizarItem(item.id, { venta: info.sugerido.precio }));
    tarjeta.append(aplicar);
  } else if (info.sugerido?.precio) {
    tarjeta.append(el('p', 'ayuda cat-ok', 'Tu precio está en lo sugerido.'));
  }
  return tarjeta;
}

function pintarCatalogo() {
  const items = listaLeer();
  const caja = $('#cat-items');
  caja.replaceChildren();
  if (!items.length) {
    caja.append(el('p', 'ayuda', 'Primero agrega productos en Mi lista; aquí marcas los que revendes.'));
    $('#cat-resumen').replaceChildren();
    return;
  }
  const vendidos = items.filter((x) => x.vendo).map(analizarItem);
  const pausar = vendidos.filter((x) => x.estado === 'pausar').length;
  const cambiar = vendidos.filter((x) => ['subir', 'bajar', 'fijar'].includes(x.accion)).length;
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
  $('#cat-aplicar').disabled = !cambiar;
  $('#cat-exportar').disabled = !vendidos.length;
  // Primero lo que vendo; dentro, lo que pide acción.
  const peso = (x) => (!x.vendo ? 3 : { pausar: 0 }[analizarItem(x).estado] ?? (['subir', 'bajar', 'fijar'].includes(analizarItem(x).accion) ? 1 : 2));
  [...items].sort((a, b) => peso(a) - peso(b)).forEach((item) => caja.append(tarjetaCatalogo(item)));
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
  const celda = (v) => {
    const texto = v === null || v === undefined ? '' : String(v);
    return /[";\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const filas = [['producto', 'presentacion', 'estado', 'tienda_compra', 'costo_compra', 'mi_precio', 'precio_sugerido', 'neto_sugerido', 'enlace_compra']];
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
      info.compra?.url ?? '',
    ]);
  }
  // Punto y coma y BOM: así Excel en español lo abre en columnas y con tildes.
  const texto = '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
  const enlace = el('a');
  enlace.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  enlace.download = `catalogo-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(enlace.href), 5000);
}

$('#abrir-catalogo').addEventListener('click', async () => {
  mostrar('catalogo');
  pintarCatalogo();
  await sincronizar();
  pintarCatalogo();
});
$('#cat-aplicar').addEventListener('click', aplicarSugeridos);
$('#cat-exportar').addEventListener('click', exportarCatalogo);
$('#cat-actualizar').addEventListener('click', async () => {
  const boton = $('#cat-actualizar');
  boton.disabled = true;
  $('#cat-estado').replaceChildren(el('p', '', 'Consultando las tiendas…'));
  // Cada búsqueda de un producto de la lista también actualiza su resumen en el servidor.
  const items = listaLeer().filter((x) => x.vendo);
  for (const [i, item] of items.entries()) {
    $('#cat-estado').replaceChildren(el('p', '', `Consultando ${i + 1} de ${items.length}: ${item.q}…`));
    try {
      registrar(await api(`/api/buscar?q=${encodeURIComponent(item.q)}`));
    } catch {
      /* esa tienda o ese producto quedan con el dato anterior */
    }
  }
  await sincronizar();
  $('#cat-estado').replaceChildren();
  boton.disabled = false;
  pintarCatalogo();
});

// ── Escáner de código de barras ─────────────────────────────────────────────
// Usa el detector del navegador (Chrome en Android lo trae); donde no existe, el
// botón no aparece y se puede escribir el código a mano.
let escaneo = null;

async function abrirEscaner() {
  const formatos = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
  let detector;
  try {
    const soportados = await BarcodeDetector.getSupportedFormats();
    detector = new BarcodeDetector({ formats: formatos.filter((f) => soportados.includes(f)) });
  } catch {
    return;
  }
  const video = $('#escaner-video');
  $('#escaner-texto').textContent = 'Apunta al código de barras de la botella';
  $('#escaner').hidden = false;
  try {
    const flujo = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    escaneo = { flujo, activo: true };
    video.srcObject = flujo;
    await video.play();
  } catch {
    $('#escaner-texto').textContent = 'No se pudo abrir la cámara. Revisa el permiso o escribe el código.';
    return;
  }
  const buscarCodigo = async () => {
    if (!escaneo?.activo) return;
    try {
      const [codigo] = await detector.detect(video);
      if (codigo?.rawValue && /^\d{8,14}$/.test(codigo.rawValue)) {
        cerrarEscaner();
        if (navigator.vibrate) navigator.vibrate(40);
        mostrar('buscar');
        buscar(codigo.rawValue);
        return;
      }
    } catch {
      /* cuadro sin imagen todavía */
    }
    setTimeout(buscarCodigo, 250);
  };
  buscarCodigo();
}

function cerrarEscaner() {
  if (escaneo) {
    escaneo.activo = false;
    escaneo.flujo.getTracks().forEach((t) => t.stop());
    escaneo = null;
  }
  $('#escaner-video').srcObject = null;
  $('#escaner').hidden = true;
}

if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
  $('#escanear').hidden = false;
  $('#escanear').addEventListener('click', abrirEscaner);
}
$('#escaner-cerrar').addEventListener('click', cerrarEscaner);

async function iniciar() {
  const { ok } = await api('/api/sesion').catch(() => ({ ok: false }));
  if (!ok) return mostrar('entrar');
  mostrar('buscar');
  pintarRecientes();
  iniciarTutorial();
  await sincronizar();
  refrescar();
  const p = propuestaLeer();
  if (listaLeer().length && (!p || Date.now() - p.generadaEn > 24 * 60 * 60 * 1000)) {
    analizarLista().catch(() => {});
  }
  const q = new URLSearchParams(location.search).get('q');
  if (q) buscar(q);
  else $('#q').focus();
}

configurarTutorial();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

iniciar();
