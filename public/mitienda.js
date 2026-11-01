// Mi tienda: cada producto de tu carta (Agua Pure) frente al más barato de
// las demás tiendas, con el precio sugerido según tu regla. Los costos se
// anotan a mano mientras no haya acceso a TRIVO con credenciales.
import { ajustes, guardarAjustes } from './datos.js';
import { escribirCsv } from './csv.js';
import { limpiarRegla, sugerirPrecio } from './precios.js';
import { subirAjustes } from './sync.js';
import { $, acciones, api, boton, descargar, el, guardado, hace, pesos, presentacion } from './util.js';

const VIGENCIA = 20 * 60 * 60_000;
let estado = guardado('mp-mitienda') || null; // { miTienda, productos, costos }
let filtro = 'todos';
let analizando = false;

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

  const rejilla = el('div', 'rejilla cat-rejilla');
  const costo = el('label', '', 'Tu costo ($)');
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
  caja.append(rejilla);

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
  const filas = [['producto', 'presentacion', 'mi_precio', 'referencia_mercado', 'tienda_referencia', 'diferencia_pct', 'accion', 'precio_sugerido', 'costo', 'margen_pct']];
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
      a.margen !== null ? a.margen.toFixed(1) : '',
    ]);
  }
  descargar(`mi-tienda-precios-${new Date().toISOString().slice(0, 10)}.csv`, escribirCsv(filas), 'text/csv;charset=utf-8');
}

export async function abrirMiTienda() {
  pintarRegla();
  pintar();
  await cargar();
  pintar();
}

export function configurarMiTienda() {
  $('#mt-actualizar').addEventListener('click', compararTodos);
  $('#mt-exportar').addEventListener('click', exportar);
  for (const campo of ['sobreMinimo', 'recargoFria', 'tolerancia', 'margenMin', 'redondeo']) $(`#mt-${campo}`).addEventListener('change', guardarRegla);
}
