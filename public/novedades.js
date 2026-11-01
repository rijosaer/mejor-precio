// Novedades: cada actualización de la app queda anotada aquí, con un «antes»
// y un «ahora» por función. La primera vez que se entra en un dispositivo
// después de una actualización se abre la ventana «Nuevas actualizaciones».
//
// Para publicar una actualización:
//   1. Agrega una versión AL PRINCIPIO de VERSIONES (número, fecha, cambios).
//   2. Cambia VERSION en public/sw.js a `mp-<número>` (el test lo exige).
import { $, boton, el, guardado } from './util.js';

export const VERSIONES = [
  {
    version: '2.0',
    fecha: '2026-11-01',
    titulo: 'Proveedores, pedido, inventario y búsqueda más precisa',
    cambios: [
      {
        titulo: 'Proveedores propios',
        antes: 'Solo se comparaban las tiendas con página web.',
        ahora: 'Anotas los precios de tu distribuidor (a mano, con un Excel o pegando su lista de WhatsApp) y aparece en cada búsqueda como una tienda más.',
        donde: 'proveedores',
      },
      {
        titulo: 'Búsqueda más precisa',
        antes: '«johnnie walker black» traía también el Red Label y «ron» encontraba «toronja».',
        ahora: 'La marca es obligatoria, se compara palabra por palabra, se toleran errores de escritura («¿Quisiste decir…?») y las variantes que no escribiste (Zero, sin azúcar, sabores) quedan aparte.',
      },
      {
        titulo: 'Fotos y ficha del producto',
        antes: 'Las filas solo tenían el nombre y el precio.',
        ahora: 'Cada fila trae la foto. Al tocarla ves la ficha con la imagen grande, el precio en cada tienda, el historial y el mejor momento para comprar.',
      },
      {
        titulo: 'Mi pedido',
        antes: 'Comparabas producto por producto.',
        ahora: 'Juntas varios productos y la app te dice en qué tiendas comprar para pagar menos en total, contando envío, envío gratis y pedido mínimo.',
        donde: 'pedido',
      },
      {
        titulo: 'Inventario y ventas',
        antes: 'El catálogo solo sugería precios.',
        ahora: 'Registras lo que compras, vendes y cuentas. La vista Ventas muestra la ganancia de cada mes, lo que más rota y te avisa cuando quedan pocas unidades.',
        donde: 'ventas',
      },
      {
        titulo: 'Precio por litro, filtros y compartir',
        antes: 'Cada presentación se miraba por separado y no había filtros.',
        ahora: 'Ves qué presentación sale más barata por litro, filtras por ofertas, precio o tienda y compartes el resultado por WhatsApp.',
      },
      {
        titulo: 'Notificaciones en el teléfono',
        antes: 'Los avisos de Mi lista solo se veían al abrir la app.',
        ahora: 'Llegan como notificación aunque la app esté cerrada, con horario de silencio y un resumen de la semana los lunes.',
        donde: 'ajustes',
      },
      {
        titulo: 'Ajustes nuevos y tema oscuro',
        antes: 'Margen, logística y cashback.',
        ahora: 'También tiendas activas (Carulla y Jumbo nuevas), envío por tienda, presentaciones favoritas, frecuencia del monitoreo, tema oscuro, tamaño de letra y respaldo. Los ajustes se comparten entre las dos personas.',
        donde: 'ajustes',
      },
      {
        titulo: 'Escáner en iPhone',
        antes: 'El escáner de código de barras solo funcionaba en Chrome de Android.',
        ahora: 'Funciona también en iPhone y en otros navegadores.',
      },
      {
        titulo: 'Más confiable',
        antes: 'Si una tienda fallaba se volvían a consultar todas, y el historial vivía solo en el teléfono.',
        ahora: 'Solo se reintenta la tienda que falló, el historial de tus búsquedas se guarda también en el servidor y «Estado de las tiendas» te dice cuál está fallando.',
      },
    ],
  },
  {
    version: '1.0',
    fecha: '2026-10-31',
    titulo: 'Primera versión',
    cambios: [
      {
        titulo: 'Comparador de seis tiendas',
        antes: 'Había que abrir cada tienda por separado.',
        ahora: 'Una búsqueda consulta Bevgo, Dislicores, Éxito, Makro, Olímpica y Agua Pure a la vez y marca el más barato.',
      },
      { titulo: 'Historial y avisos', ahora: 'Gráfica de precios de hasta un año, punto dulce, precio objetivo y avisos de stock.' },
      { titulo: 'Mi lista y catálogo', ahora: 'Monitoreo automático cada 6 horas y precio de reventa sugerido.' },
    ],
  },
];

export const VERSION_ACTUAL = VERSIONES[0].version;
const CLAVE = 'mp-version-vista';

const fecha = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

// Versiones que este dispositivo no ha visto (todas, si nunca vio ninguna).
export function versionesNuevas(vista = guardado(CLAVE)) {
  if (!vista) return VERSIONES.slice(0, 1);
  const i = VERSIONES.findIndex((v) => v.version === vista);
  return i < 0 ? VERSIONES.slice(0, 1) : VERSIONES.slice(0, i);
}

export const hayNovedades = () => versionesNuevas().length > 0;

function tarjetaCambio(c, irA) {
  const caja = el('article', 'novedad');
  caja.append(el('h3', 'novedad-titulo', c.titulo));
  if (c.antes) {
    const comparar = el('div', 'novedad-comparar');
    const antes = el('div', 'novedad-antes');
    antes.append(el('span', 'novedad-etiqueta', 'Antes'), el('p', '', c.antes));
    const ahora = el('div', 'novedad-ahora');
    ahora.append(el('span', 'novedad-etiqueta', 'Ahora'), el('p', '', c.ahora));
    comparar.append(antes, ahora);
    caja.append(comparar);
  } else caja.append(el('p', 'novedad-texto', c.ahora));
  if (c.donde && irA) caja.append(boton('Probarlo', 'mini', () => irA(c.donde)));
  return caja;
}

function bloqueVersion(v, irA) {
  const caja = el('section', 'novedad-version');
  const cabeza = el('div', 'novedad-cabeza');
  cabeza.append(el('span', 'novedad-numero', `Versión ${v.version}`), el('span', 'ayuda', fecha(v.fecha)));
  caja.append(cabeza, el('h2', 'novedad-version-titulo', v.titulo));
  for (const c of v.cambios) caja.append(tarjetaCambio(c, irA));
  return caja;
}

function marcarVista() {
  guardado(CLAVE, VERSION_ACTUAL);
  pintarMarca();
}

// «Versión 2.0 · Novedades» al pie de la página, con un punto si hay algo sin ver.
export function pintarMarca() {
  const b = $('#ver-novedades');
  if (!b) return;
  b.textContent = `Versión ${VERSION_ACTUAL} · Novedades`;
  b.classList.toggle('con-punto', hayNovedades());
}

// Ventana «Nuevas actualizaciones» con las versiones no vistas (o todo el
// historial si se abre desde el pie de página).
export function abrirNovedades({ todas = false, irA } = {}) {
  const dialogo = $('#novedades');
  const cuerpo = $('#novedades-cuerpo');
  const nuevas = versionesNuevas();
  const lista = todas || !nuevas.length ? VERSIONES : nuevas;
  cuerpo.replaceChildren();
  cuerpo.append(el('p', 'novedades-sobre', todas ? 'Historial de cambios' : 'Nuevas actualizaciones'));
  const ir = irA
    ? (donde) => {
        cerrarNovedades();
        irA(donde);
      }
    : null;
  for (const v of lista) cuerpo.append(bloqueVersion(v, ir));
  const pie = el('div', 'novedades-pie');
  pie.append(boton('Entendido', 'boton', cerrarNovedades));
  if (!todas && lista.length < VERSIONES.length) pie.append(boton('Ver todas las versiones', 'boton-texto', () => abrirNovedades({ todas: true, irA })));
  cuerpo.append(pie);
  if (typeof dialogo.showModal === 'function') {
    if (!dialogo.open) dialogo.showModal();
  } else dialogo.setAttribute('open', '');
  cuerpo.scrollTop = 0;
  marcarVista();
}

export function cerrarNovedades() {
  const dialogo = $('#novedades');
  if (dialogo.open) dialogo.close?.() ?? dialogo.removeAttribute('open');
}

// Al entrar: si este dispositivo no ha visto la versión actual, se abre sola.
export function iniciarNovedades(irA) {
  pintarMarca();
  if (hayNovedades()) abrirNovedades({ irA });
}

export function configurarNovedades(irA) {
  $('#ver-novedades').addEventListener('click', () => abrirNovedades({ todas: true, irA }));
  $('#novedades-cerrar').addEventListener('click', cerrarNovedades);
  $('#novedades').addEventListener('click', (e) => {
    if (e.target === $('#novedades')) cerrarNovedades();
  });
  pintarMarca();
}
