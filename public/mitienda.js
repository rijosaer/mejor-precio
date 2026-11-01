// Mi tienda: cada producto de tu carta (Agua Pure) frente al más barato de
// las demás tiendas, con el precio sugerido según tu regla. Con acceso a TRIVO
// (solo lectura) los costos reales, las existencias y las ventas de 30 días
// salen de TRIVO; sin él, los costos se anotan a mano.
import { ajustes, guardarAjustes } from './datos.js';
import { escribirCsv } from './csv.js';
import { limpiarMargen, limpiarRegla, MARGEN_POR_DEFECTO, precioConMargen, resumenInventario, sugerirPrecio } from './precios.js';
import { subirAjustes } from './sync.js';
import { $, acciones, api, boton, descargar, el, guardado, hace, pesos, presentacion } from './util.js';

const VIGENCIA = 20 * 60 * 60_000;
let estado = guardado('mp-mitienda') || null; // { miTienda, productos, costos }
let filtro = 'todos';
let analizando = false;
let leyendoTrivo = false;
let aplicando = false;
const VIGENCIA_TRIVO = 6 * 60 * 60_000;

const regla = () => limpiarRegla(ajustes().miTiendaRegla);

function analisis(p) {
  return sugerirPrecio(p, p.resultado, estado?.costos?.[p.id] ?? null, regla());
}

const ETIQUETA = {
  caro: ['Más caro que el mercado', 'chip-subio'],
  barato: ['Más barato que el mercado', 'chip-baja'],
  'en-mercado': ['En precio', 'chip'],
  perdida: ['Bajo tu costo', 'chip-subio'],
  'sin-mercado': ['Sin comparación', 'chip'],
};

function pintarRegla() {
  const r = regla();
  for (const [campo, valor] of Object.entries(r)) {
    const entrada = $(`#mt-${campo}`);
    if (entrada) entrada.value = valor;
  }
}

async function guardarRegla() {
  const nueva = {};
  for (const campo of ['sobreMinimo', 'recargoFria', 'tolerancia', 'margenMin', 'redondeo']) nueva[campo] = $(`#mt-${campo}`).value;
  guardarAjustes({ ...ajustes(), miTiendaRegla: limpiarRegla(nueva) });
  subirAjustes();
  pintar();
}

function textoReferencia(r) {
  if (!r) return 'Todavía no se ha comparado.';
  if (r.sinTamano) return 'El nombre no dice el tamaño: no se puede comparar.';
  if (!r.referencia) return `Ninguna de las ${r.respondieron ?? ''} tiendas que respondieron tiene este producto.`.replace('  ', ' ');
  const base = `Más barato: ${r.referencia.tienda} ${pesos.format(r.referencia.precio)}`;
  const extra = r.referencia.fuente === 'por-unidad' ? ` (juntando ${r.referencia.detalle})` : r.ofertas?.length > 1 ? ` · ${r.ofertas.length} tiendas, mediana ${pesos.format(Math.round(r.mediana))}` : '';
  return base + extra;
}

function tarjeta(p) {
  const a = analisis(p);
  const caja = el('article', `mt-item mt-${a.estado}`);
  const cabeza = el('div', 'mt-cabeza');
  const titulo = el('div', 'cat-titulo');
  titulo.append(el('b', '', p.nombre), el('span', 'ayuda', `${p.ml ? presentacion(p) : 'sin tamaño'}${p.valorHielo ? ` · incluye hielo (${pesos.format(p.valorHielo)} en tu carta)` : ''}${p.disponible ? '' : ' · agotado en tu carta'}`));
  const precio = el('div', 'fila-precio');
  precio.append(el('strong', '', pesos.format(p.precio)));
  if (p.precioAntes) precio.append(el('s', '', pesos.format(p.precioAntes)));
  cabeza.append(titulo, precio);
  caja.append(cabeza);

  const chips = el('div', 'fila-hist');
  const [texto, clase] = ETIQUETA[a.estado] || ETIQUETA['sin-mercado'];
  chips.append(el('span', `chip ${clase}`, a.diferencia !== undefined && a.estado !== 'en-mercado' ? `${texto} ${a.diferencia > 0 ? '+' : ''}${a.diferencia.toFixed(0)} %` : texto));
  if (p.resultado?.t) chips.append(el('span', 'chip', `Comparado ${hace(p.resultado.t)}`));
  caja.append(chips, el('p', 'ayuda mt-ref', textoReferencia(p.resultado)));

  const inv = resumenInventario(p.trivo, estado.trivo?.dias || 30);
  if (inv && (inv.existencias || inv.ventas)) {
    const fila = el('div', 'fila-hist mt-inventario');
    if (inv.existencias) fila.append(el('span', `chip ${inv.agotado || inv.bajo ? 'chip-subio' : ''}`, `${inv.existencias}${inv.agotado ? ' · agotado' : inv.bajo ? ' · bajo el mínimo' : ''}`));
    if (inv.ventas) fila.append(el('span', 'chip', inv.ventas));
    if (inv.cobertura !== null) fila.append(el('span', 'chip', `Alcanza para unos ${inv.cobertura} días`));
    caja.append(fila);
  }

  const rejilla = el('div', 'rejilla cat-rejilla');
  const deTrivo = p.trivo?.costo > 0;
  const costo = el('label', '', deTrivo ? (p.trivo.fuente === 'calculado' ? 'Tu costo ($) · calculado de TRIVO' : 'Tu costo ($) · de TRIVO') : 'Tu costo ($)');
  const entrada = el('input');
  entrada.type = 'number';
  entrada.inputMode = 'numeric';
  entrada.min = '0';
  entrada.step = '100';
  entrada.placeholder = 'opcional';
  entrada.value = estado.costos?.[p.id] ?? '';
  entrada.addEventListener('change', async () => {
    const valor = entrada.value === '' ? null : Number(entrada.value);
    try {
      const { costos } = await api('/api/mi-tienda/costos', { method: 'PUT', cuerpo: { costos: { [p.id]: valor } } });
      estado.costos = costos;
      guardado('mp-mitienda', estado);
      pintar();
    } catch (error) {
      entrada.setCustomValidity(error.message);
      entrada.reportValidity();
    }
  });
  costo.append(entrada);
  rejilla.append(costo);
  if (estado.trivo?.activo) {
    const propio = estado.margenes?.porProducto?.[p.id];
    const margen = el('label', '', 'Tu margen (%)');
    const m = el('input');
    m.type = 'number';
    m.inputMode = 'decimal';
    m.min = '0';
    m.max = '89';
    m.step = '1';
    m.placeholder = `${estado.margenes?.general ?? MARGEN_POR_DEFECTO} (general)`;
    m.value = propio ?? '';
    m.addEventListener('change', () => guardarMargen({ porProducto: { [p.id]: m.value === '' ? null : Number(m.value) } }, m));
    margen.append(m);
    rejilla.append(margen);
  }
  caja.append(rejilla);
  if (deTrivo) caja.append(el('p', 'ayuda', p.trivo.fuente === 'calculado' ? `${p.trivo.detalle}. Si lo cambias aquí, la próxima lectura de TRIVO lo vuelve a poner.` : 'Costo de compra en TRIVO. Si lo cambias aquí, la próxima lectura de TRIVO lo vuelve a poner.'));

  const salida = el('div', 'panel-salida');
  const linea = (t, v, c = '') => {
    const f = el('div', `salida-linea ${c}`);
    f.append(el('span', '', t), el('b', '', v));
    salida.append(f);
  };
  if (a.margen !== null) linea('Margen con tu precio', `${a.margen.toFixed(1)} %`, a.margen > 0 ? 'positivo' : 'negativo');
  if (a.accion !== 'mantener' && a.sugerido) {
    linea(`Sugerido: ${a.accion === 'subir' ? 'subir' : 'bajar'} a`, `${pesos.format(a.sugerido)} (${a.cambio > 0 ? '+' : ''}${a.cambio.toFixed(0)} %)`, a.accion === 'subir' ? 'positivo' : 'negativo');
    if (a.motivo === 'costo') salida.append(el('p', 'ayuda', 'El mercado está por debajo de tu costo + margen mínimo: se sugiere el precio en el que no pierdes.'));
  } else if (a.estado !== 'sin-mercado') linea('Sugerido', 'Mantener');
  if (a.piso) linea('Precio mínimo con tu margen', pesos.format(a.piso));
  const conMargen = precioTrivo(p);
  if (conMargen) linea(`Con tu margen de ${conMargen.margen} % (TRIVO)`, conMargen.precio === (p.precioAntes ?? p.precio) ? `${pesos.format(conMargen.precio)} · ya está` : pesos.format(conMargen.precio));
  if (salida.childElementCount) caja.append(salida);

  const botones = el('div', 'aj-botones');
  botones.append(
    boton('Ver en el mercado', 'mini', () => {
      acciones.mostrar('buscar');
      acciones.buscar(p.consulta);
    }),
    boton('Comparar de nuevo', 'mini', async (e) => {
      e.target.disabled = true;
      await compararUno(p).catch(() => {});
      pintar();
    }),
  );
  caja.append(botones);
  return caja;
}

const GRUPOS = {
  todos: () => true,
  bajar: (a) => a.accion === 'bajar',
  subir: (a) => a.accion === 'subir',
  mantener: (a) => a.accion === 'mantener' && a.estado !== 'sin-mercado',
  sin: (a) => a.estado === 'sin-mercado',
};

function pintar() {
  const caja = $('#mt-items');
  const resumen = $('#mt-resumen');
  caja.replaceChildren();
  resumen.replaceChildren();
  if (!estado) {
    caja.append(el('p', 'ayuda', 'Cargando tu carta…'));
    return;
  }
  if (!estado.miTienda) {
    caja.append(el('p', 'ayuda', 'Elige cuál es tu tienda en Ajustes → Mi tienda.'));
    return;
  }
  $('#mt-nombre').textContent = estado.nombre || 'Agua Pure';
  pintarTrivo();
  pintarPropuestas();
  const analizados = estado.productos.map((p) => ({ p, a: analisis(p) }));
  const cuenta = (f) => analizados.filter(({ a }) => GRUPOS[f](a)).length;
  const dato = (n, texto, clave, clase = '') => {
    const d = el('button', `cat-dato mt-filtro ${clase}${filtro === clave ? ' activo' : ''}`);
    d.type = 'button';
    d.append(el('b', '', String(n)), el('span', '', texto));
    d.addEventListener('click', () => {
      filtro = filtro === clave ? 'todos' : clave;
      pintar();
    });
    resumen.append(d);
  };
  dato(cuenta('bajar'), 'para bajar', 'bajar', cuenta('bajar') ? 'perdida' : '');
  dato(cuenta('subir'), 'puedes subir', 'subir', cuenta('subir') ? 'aviso' : '');
  dato(cuenta('mantener'), 'en precio', 'mantener');
  dato(cuenta('sin'), 'sin comparar', 'sin');
  const orden = { bajar: 0, subir: 1, mantener: 2, sin: 3 };
  const grupoDe = (a) => (a.accion === 'bajar' ? 'bajar' : a.accion === 'subir' ? 'subir' : a.estado === 'sin-mercado' ? 'sin' : 'mantener');
  analizados
    .filter(({ a }) => GRUPOS[filtro](a))
    .sort((x, y) => orden[grupoDe(x.a)] - orden[grupoDe(y.a)] || Math.abs(y.a.cambio || 0) - Math.abs(x.a.cambio || 0))
    .forEach(({ p }) => caja.append(tarjeta(p)));
  if (!caja.childElementCount) caja.append(el('p', 'ayuda', 'Ningún producto en este grupo.'));
  const viejos = estado.productos.filter((p) => p.ml && (!p.resultado || Date.now() - p.resultado.t > VIGENCIA)).length;
  $('#mt-actualizar').textContent = viejos ? `Comparar ${viejos} pendientes` : 'Comparar todo de nuevo';
}

// Precio con tu margen esperado, como lo calcula el servidor para las propuestas.
function precioTrivo(p) {
  if (!estado?.trivo?.activo) return null;
  const costo = estado.costos?.[p.id];
  const margen = estado.margenes?.porProducto?.[p.id] ?? estado.margenes?.general ?? MARGEN_POR_DEFECTO;
  const descuento = p.precioAntes ? p.precioAntes - p.precio : 0;
  const precio = precioConMargen(costo, margen, { fria: /fr[ií]a/i.test(p.variante || ''), recargoFria: regla().recargoFria, descuento });
  return precio ? { precio, margen } : null;
}

async function guardarMargen(cambios, entrada) {
  try {
    const { margenes } = await api('/api/mi-tienda/margen', { method: 'PUT', cuerpo: cambios });
    estado.margenes = margenes;
    guardado('mp-mitienda', estado);
    pintar();
  } catch (error) {
    entrada.setCustomValidity(error.message);
    entrada.reportValidity();
  }
}

const textoMotivo = (x) =>
  x.motivo === 'compra'
    ? `Compra${x.compra?.fecha ? ` del ${new Date(x.compra.fecha).toLocaleDateString('es-CO')}` : ''}${x.compra?.costo ? ` a ${pesos.format(x.compra.costo)} c/u` : ''}`
    : x.motivo === 'costo'
      ? 'Cambió el costo en TRIVO'
      : 'Calculado con tu margen';

async function accionPrecio(ruta, cuerpo, metodo = 'POST') {
  const datos = await api(ruta, { method: metodo, cuerpo });
  estado = { ...datos, nombre: estado.nombre };
  guardado('mp-mitienda', estado);
}

async function aplicarUna(x, b) {
  if (aplicando) return;
  const cambio = ((x.precioNuevo - x.precioActual) / x.precioActual) * 100;
  if (Math.abs(cambio) >= 30 && !confirm(`${x.nombre}: el precio cambia ${cambio > 0 ? '+' : ''}${cambio.toFixed(0)} % (${pesos.format(x.precioActual)} → ${pesos.format(x.precioNuevo)}). ¿Aplicar en TRIVO?`)) return;
  aplicando = true;
  if (b) b.disabled = true;
  try {
    await accionPrecio('/api/mi-tienda/aplicar', { id: x.id });
    $('#mt-estado').replaceChildren(el('p', '', `Listo: ${x.nombre} quedó en ${pesos.format(x.precioNuevo)} en TRIVO.`));
  } catch (error) {
    $('#mt-estado').replaceChildren(el('p', 'error', `${x.nombre}: ${error.message}`));
  } finally {
    aplicando = false;
    pintar();
  }
}

async function aplicarTodas() {
  const lista = [...(estado?.propuestas || [])];
  if (!lista.length || aplicando) return;
  if (!confirm(`¿Aplicar en TRIVO los ${lista.length} precios propuestos?\n\n${lista.map((x) => `${x.nombre}: ${pesos.format(x.precioActual)} → ${pesos.format(x.precioNuevo)}`).join('\n')}`)) return;
  aplicando = true;
  const b = $('#mt-aplicar-todos');
  b.disabled = true;
  let bien = 0;
  const errores = [];
  for (const x of lista) {
    $('#mt-estado').replaceChildren(el('p', '', `Aplicando ${bien + errores.length + 1} de ${lista.length}: ${x.nombre}…`));
    try {
      await accionPrecio('/api/mi-tienda/aplicar', { id: x.id });
      bien++;
    } catch (error) {
      errores.push(`${x.nombre}: ${error.message}`);
    }
  }
  $('#mt-estado').replaceChildren(el('p', errores.length ? 'error' : '', `Aplicados ${bien} de ${lista.length}.${errores.length ? ` ${errores.join(' · ')}` : ''}`));
  aplicando = false;
  b.disabled = false;
  pintar();
}

function pintarPropuestas() {
  const caja = $('#mt-margen-caja');
  const activo = estado?.trivo?.activo;
  caja.hidden = !activo;
  if (!activo) return;
  const entrada = $('#mt-margenEsperado');
  if (document.activeElement !== entrada) entrada.value = estado.margenes?.general ?? MARGEN_POR_DEFECTO;
  const lista = estado.propuestas || [];
  const zona = $('#mt-propuestas');
  zona.replaceChildren();
  const todos = $('#mt-aplicar-todos');
  todos.hidden = lista.length < 2;
  todos.textContent = `Aplicar todos (${lista.length})`;
  if (!lista.length) zona.append(el('p', 'ayuda', 'No hay precios por aprobar. Cuando cargues una compra en TRIVO, la propuesta aparece aquí (se revisa cada hora o al tocar «Leer TRIVO»).'));
  for (const x of lista) {
    const fila = el('div', 'mt-propuesta');
    const izq = el('div');
    izq.append(
      el('b', '', x.nombre),
      el('p', 'ayuda', `${textoMotivo(x)} · costo ${x.costoAntes && x.costoAntes !== x.costo ? `${pesos.format(x.costoAntes)} → ` : ''}${pesos.format(x.costo)} · margen ${x.margen} %${x.descuento ? ` · promo −${pesos.format(x.descuento)}` : ''}`),
      el('p', 'ayuda', `Margen real: ${x.margenActual !== null ? `${x.margenActual.toFixed(1)} %` : '—'} → ${x.margenNuevo !== null ? `${x.margenNuevo.toFixed(1)} %` : '—'}`),
    );
    const der = el('div', 'mt-propuesta-precio');
    der.append(el('s', '', pesos.format(x.precioActual)), el('br'), el('strong', '', pesos.format(x.precioNuevo)));
    const botones = el('div', 'aj-botones');
    const aplicar = boton('Aplicar en TRIVO', 'mini', (e) => aplicarUna(x, e.target));
    botones.append(
      aplicar,
      boton('Descartar', 'mini', async () => {
        await accionPrecio(`/api/mi-tienda/propuestas?id=${encodeURIComponent(x.id)}`, {}, 'DELETE').catch(() => {});
        pintar();
      }),
    );
    fila.append(izq, der, botones);
    zona.append(fila);
  }
  const historial = estado.historial || [];
  $('#mt-historial-caja').hidden = !historial.length;
  const h = $('#mt-historial');
  h.replaceChildren();
  for (const c of historial) {
    const fila = el('div', 'mt-cambio');
    const texto = el('span', 'ayuda', `${c.nombre}: ${pesos.format(c.antes)} → ${pesos.format(c.despues)} · ${c.motivo === 'deshacer' ? 'deshecho' : `margen ${c.margen} %`} · ${hace(c.t)}`);
    fila.append(texto);
    if (!c.deshecho && c.motivo !== 'deshacer') {
      fila.append(
        boton('Deshacer', 'mini', async (e) => {
          if (!confirm(`¿Volver ${c.nombre} a ${pesos.format(c.antes)} en TRIVO?`)) return;
          e.target.disabled = true;
          try {
            await accionPrecio('/api/mi-tienda/deshacer', { id: c.id });
          } catch (error) {
            $('#mt-estado').replaceChildren(el('p', 'error', error.message));
          }
          pintar();
        }),
      );
    }
    h.append(fila);
  }
}

function pintarTrivo() {
  const t = estado?.trivo;
  const b = $('#mt-trivo');
  const nota = $('#mt-trivo-estado');
  b.hidden = !t?.activo;
  if (!t) {
    nota.hidden = true;
    return;
  }
  nota.hidden = false;
  if (!t.activo) {
    nota.textContent = 'Sin acceso a TRIVO POS: los costos se anotan a mano. Con TRIVO_USUARIO y TRIVO_CLAVE en el servidor salen solos tus costos reales, las existencias y las ventas.';
    return;
  }
  const partes = [];
  partes.push(t.t ? `TRIVO leído ${hace(t.t)} (solo lectura): costos de compra, existencias y ventas del ${t.desde} al ${t.hasta}.` : 'TRIVO conectado (solo lectura). Toca «Leer TRIVO» para traer costos, existencias y ventas.');
  if (t.sinPareja?.length) partes.push(`Sin pareja en TRIVO: ${t.sinPareja.join(', ')}.`);
  if (t.error) partes.push(`Último intento con error: ${t.error}.`);
  partes.push('En TRIVO solo se cambia el precio de venta, y solo cuando apruebas una propuesta.');
  nota.textContent = partes.join(' ');
}

async function leerTrivo({ auto = false } = {}) {
  if (leyendoTrivo || !estado?.trivo?.activo) return;
  leyendoTrivo = true;
  const b = $('#mt-trivo');
  b.disabled = true;
  b.textContent = 'Leyendo TRIVO…';
  try {
    const datos = await api('/api/mi-tienda/trivo', { method: 'POST', cuerpo: {} });
    estado = { ...datos, nombre: estado.nombre };
    guardado('mp-mitienda', estado);
  } catch (error) {
    if (!auto) $('#mt-estado').replaceChildren(el('p', 'error', error.message));
  } finally {
    leyendoTrivo = false;
    b.disabled = false;
    b.textContent = 'Leer TRIVO';
    pintar();
  }
}

async function cargar() {
  try {
    const datos = await api('/api/mi-tienda');
    const tiendas = guardado('mp-tiendas') || [];
    estado = { ...datos, nombre: tiendas.find((t) => t.id === datos.miTienda)?.nombre || (datos.miTienda === 'aguapure' ? 'Agua Pure' : datos.miTienda) };
    guardado('mp-mitienda', estado);
  } catch (error) {
    if (!estado) $('#mt-items').replaceChildren(el('p', 'error', error.message));
  }
}

async function compararUno(p) {
  const { resultado } = await api('/api/mi-tienda/comparar', { method: 'POST', cuerpo: { id: p.id } });
  p.resultado = resultado;
  guardado('mp-mitienda', estado);
}

// Compara los pendientes (o todos), de a dos a la vez.
async function compararTodos() {
  if (analizando || !estado?.productos) return;
  analizando = true;
  const b = $('#mt-actualizar');
  b.disabled = true;
  const pendientes = estado.productos.filter((p) => p.ml && (!p.resultado || Date.now() - p.resultado.t > VIGENCIA));
  const cola = pendientes.length ? pendientes : estado.productos.filter((p) => p.ml);
  let hechos = 0;
  const trabajar = async () => {
    while (cola.length) {
      const p = cola.shift();
      $('#mt-estado').replaceChildren(el('p', '', `Comparando ${hechos + 1} de ${hechos + cola.length + 1}: ${p.nombre}…`));
      await compararUno(p).catch(() => {});
      hechos++;
      pintar();
    }
  };
  await Promise.all([trabajar(), trabajar()]);
  $('#mt-estado').replaceChildren(el('p', 'ayuda', `Listo: ${hechos} productos comparados.`));
  b.disabled = false;
  analizando = false;
  pintar();
}

function exportar() {
  const filas = [['producto', 'presentacion', 'mi_precio', 'referencia_mercado', 'tienda_referencia', 'diferencia_pct', 'accion', 'precio_sugerido', 'costo', 'costo_fuente', 'margen_pct', 'existencias', 'alcanza_paquetes', 'vendidos_30_dias', 'pedidos_30_dias']];
  for (const p of estado?.productos || []) {
    const a = analisis(p);
    filas.push([
      p.nombre,
      p.ml ? presentacion(p) : '',
      p.precio,
      a.referencia ?? '',
      p.resultado?.referencia?.tienda ?? '',
      a.diferencia !== undefined ? a.diferencia.toFixed(1) : '',
      a.accion,
      a.sugerido ?? '',
      estado.costos?.[p.id] ?? '',
      p.trivo?.costo > 0 ? `trivo-${p.trivo.fuente}` : estado.costos?.[p.id] ? 'manual' : '',
      a.margen !== null ? a.margen.toFixed(1) : '',
      p.trivo?.existencias ?? '',
      p.trivo?.alcanza ?? '',
      p.trivo?.ventas?.unidades ?? '',
      p.trivo?.ventas?.pedidos ?? '',
    ]);
  }
  descargar(`mi-tienda-precios-${new Date().toISOString().slice(0, 10)}.csv`, escribirCsv(filas), 'text/csv;charset=utf-8');
}

export async function abrirMiTienda() {
  pintarRegla();
  pintar();
  await cargar();
  pintar();
  // TRIVO se vuelve a leer solo si la última lectura tiene más de 6 horas.
  const t = estado?.trivo;
  if (t?.activo && Date.now() - Math.max(t.t || 0) > VIGENCIA_TRIVO) leerTrivo({ auto: true });
}

export function configurarMiTienda() {
  $('#mt-actualizar').addEventListener('click', compararTodos);
  $('#mt-exportar').addEventListener('click', exportar);
  $('#mt-trivo').addEventListener('click', () => leerTrivo());
  $('#mt-aplicar-todos').addEventListener('click', aplicarTodas);
  $('#mt-margenEsperado').addEventListener('change', (e) => {
    if (limpiarMargen(e.target.value) === null) return;
    guardarMargen({ general: Number(e.target.value) }, e.target);
  });
  $('#mt-proponer').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await accionPrecio('/api/mi-tienda/propuestas', {});
      $('#mt-estado').replaceChildren(el('p', '', `${estado.propuestas.length} productos con un precio distinto al de tu margen.`));
    } catch (error) {
      $('#mt-estado').replaceChildren(el('p', 'error', error.message));
    }
    e.target.disabled = false;
    pintar();
  });
  for (const campo of ['sobreMinimo', 'recargoFria', 'tolerancia', 'margenMin', 'redondeo']) $(`#mt-${campo}`).addEventListener('change', guardarRegla);
}
