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
    version: '2.6',
    fecha: '2026-11-02',
    titulo: 'Hoy, y los precios se aprueban desde WhatsApp',
    cambios: [
      {
        titulo: 'Pantalla «Hoy»',
        antes: 'Al abrir la app solo estaba el buscador; lo que pedía atención estaba repartido en Mi tienda, Mi lista y Estado.',
        ahora: 'Arriba del buscador está lo de hoy: cuánta plata se pierde al mes por precios bajo el costo, los precios por aprobar, lo que hay que pedir, el inventario en negativo y las ofertas de los últimos dos días, cada cosa con su botón. Abajo, «Avisos enviados»: qué se avisó, cuándo, por dónde y qué se hizo con cada precio.',
      },
      {
        titulo: 'Aprobar respondiendo el WhatsApp',
        antes: 'El aviso decía el precio con tu margen, pero para cambiarlo había que abrir la app.',
        ahora: 'Cada precio por aprobar (y cada producto bajo el costo) llega con un número: responde «1», «1 3» o «todos» y se pone en TRIVO; «no 2» lo descarta y «precios» los lista. Queda en el historial de Mi tienda y se puede deshacer. Se activa en Ajustes → Notificaciones.',
        donde: 'ajustes',
      },
      {
        titulo: 'Avisos más útiles y sin repetir',
        antes: 'Un mismo aviso podía repetirse, de noche todo esperaba a la mañana y si WhatsApp fallaba los avisos se perdían.',
        ahora: 'El mismo aviso no se repite en 24 horas. De noche solo sale lo urgente (vender bajo el costo) y lo demás llega al terminar el horario de silencio, como «lo de la noche». Si WhatsApp falla, el error se ve en la app y los avisos se reintentan. Nuevo aviso de inventario en negativo en TRIVO, y las ofertas dicen el precio por unidad y a cuánto la vendes tú.',
      },
    ],
  },
  {
    version: '2.5',
    fecha: '2026-11-01',
    titulo: 'Avisos por WhatsApp al dueño',
    cambios: [
      {
        titulo: 'WhatsApp del dueño',
        antes: 'Los avisos solo llegaban como notificación push, y solo al teléfono donde se activaron.',
        ahora: 'Llegan también al WhatsApp personal del dueño desde el número de la empresa, en un solo mensaje por revisión, con el enlace a la app y respetando el horario de silencio. Se configura en Ajustes → Notificaciones.',
        donde: 'ajustes',
      },
      {
        titulo: 'Todo lo que pide atención',
        antes: 'Solo había avisos de precios de la competencia y de tiendas caídas.',
        ahora: 'También avisa cuando un producto baja del mínimo en TRIVO, cuando un precio queda por debajo del costo, cuando hay una compra con precios por aprobar (y un recordatorio diario si siguen esperando) y cuando TRIVO deja de responder o vuelve.',
      },
    ],
  },
  {
    version: '2.4',
    fecha: '2026-11-01',
    titulo: 'Compras en TRIVO: tu precio con tu margen, con tu aprobación',
    cambios: [
      {
        titulo: 'Precio por compra',
        antes: 'Al cargar una compra en TRIVO había que calcular y cambiar el precio de venta a mano.',
        ahora: 'Mejor Precio revisa TRIVO cada hora (o al tocar «Leer TRIVO»). Si entró una compra o cambió un costo, propone el precio con tu margen esperado y te avisa. Solo cambia en TRIVO cuando tocas «Aplicar».',
        donde: 'mitienda',
      },
      {
        titulo: 'Tu margen, como lo cuenta TRIVO',
        antes: 'No había dónde poner el margen esperado.',
        ahora: 'Pones un margen general y, si quieres, uno por producto. Se cuenta sobre el precio de venta, igual que TRIVO (precio = costo ÷ (1 − margen)), y se redondea siempre hacia arriba a la centena: 3.215 queda en 3.300. Una compra de latas también recalcula sus paquetes x 6, x 24 y la caja con hielo.',
        donde: 'mitienda',
      },
      {
        titulo: 'Historial y deshacer',
        antes: 'No quedaba registro de los cambios de precio.',
        ahora: 'Cada precio aplicado queda con el antes y el después, y con «Deshacer» vuelve al anterior. Si alguien cambió el precio en TRIVO mientras tanto, no se pisa.',
        donde: 'mitienda',
      },
    ],
  },
  {
    version: '2.3',
    fecha: '2026-11-01',
    titulo: 'Mi tienda con tus datos de TRIVO: costos reales, existencias y ventas',
    cambios: [
      {
        titulo: 'Costos reales desde TRIVO',
        antes: 'El costo de cada producto había que anotarlo a mano y, sin él, el precio sugerido no cuidaba tu margen.',
        ahora: 'Se leen de TRIVO (solo lectura) y el precio sugerido nunca baja de tu costo + margen mínimo. Los paquetes x 6, x 24 y las cajas con hielo, que en TRIVO no tienen costo propio, se calculan con el costo de la lata (y del hielo de 3 kg).',
        donde: 'mitienda',
      },
      {
        titulo: 'Existencias y ventas de 30 días',
        antes: 'Mi tienda no sabía cuánto tenías ni cuánto vendías.',
        ahora: 'Cada producto muestra lo que hay en TRIVO (en los paquetes, para cuántos alcanzan las latas), lo vendido en los últimos 30 días y para cuántos días alcanza. También salen en el CSV.',
        donde: 'mitienda',
      },
      {
        titulo: 'Se actualiza solo',
        antes: 'No había conexión con TRIVO.',
        ahora: 'El botón «Leer TRIVO» trae todo al momento, y el monitoreo lo vuelve a leer cada 6 horas. Los precios no se cambian en TRIVO desde la app: «Aplicar en TRIVO» sigue apagado.',
        donde: 'mitienda',
      },
    ],
  },
  {
    version: '2.2',
    fecha: '2026-11-01',
    titulo: 'Mi tienda: tus precios de Agua Pure frente al mercado',
    cambios: [
      {
        titulo: 'Mi tienda',
        antes: 'Agua Pure aparecía en las búsquedas como si fuera una tienda de la competencia.',
        ahora: 'Cada producto de tu carta se compara con el más barato de las demás tiendas: cuáles están caros, cuáles puedes subir y cuáles van en precio, con el precio sugerido según tu regla.',
        donde: 'mitienda',
      },
      {
        titulo: 'Tu regla de precio',
        antes: 'No había forma de decir a cuánto quieres vender frente al mercado.',
        ahora: 'Eliges cuánto por encima o por debajo del más barato, el recargo de las frías, el margen mínimo sobre tu costo y el redondeo. Exportas la lista en CSV para cambiar los precios en TRIVO.',
        donde: 'mitienda',
      },
      {
        titulo: 'Cajas de 24 bien comparadas',
        antes: 'Una caja de 24 solo se comparaba con otras cajas de 24.',
        ahora: 'También con lo que cuesta juntar paquetes más chicos (cuatro six pack). Las cajas con hielo se comparan sin el valor del hielo.',
      },
      {
        titulo: 'Light, sin alcohol y con gas, cada una en su grupo',
        antes: 'Al mostrar las variantes, la Light y la sin alcohol quedaban en el mismo grupo que la cerveza normal, y el agua con gas se comparaba con el agua normal.',
        ahora: 'Cada variante tiene su grupo («6 × 330 ml · Light»). «Cero», «0,0», «libre de alcohol» y «S/ALCOHOL» se reconocen como sin alcohol, y buscar «águila sin alcohol» las encuentra todas.',
      },
      {
        titulo: '«Tu precio» en cada búsqueda',
        antes: 'Tu tienda podía salir como «Mejor precio» entre la competencia.',
        ahora: 'Sale aparte, con cuánto más caro o más barato estás que la tienda más barata.',
      },
    ],
  },
  {
    version: '2.1',
    fecha: '2026-11-01',
    titulo: 'Listas de cervezas y licores, D1 y búsqueda probada con precios reales',
    cambios: [
      {
        titulo: 'Listas predeterminadas',
        antes: 'Mi lista empezaba vacía y había que escribir cada producto.',
        ahora: 'En Mi lista eliges de dos listas armadas con búsquedas reales: 14 cervezas y 10 licores, cada uno en el tamaño que más tiendas comparan.',
        donde: 'lista',
      },
      {
        titulo: 'Cervezas a un toque',
        antes: 'Para buscar una cerveza había que escribirla.',
        ahora: 'Debajo del buscador están las cervezas más comunes (Águila, Poker, Club Colombia, Corona…): un toque y comparas.',
      },
      {
        titulo: 'D1 se suma a la comparación',
        antes: 'Se consultaban seis tiendas.',
        ahora: 'También D1, con sus precios y códigos de barras. Jumbo quedó con su dirección correcta (sigue apagada; actívala en Ajustes).',
      },
      {
        titulo: 'Paquetes bien leídos',
        antes: 'Algunos six pack salían como una sola lata de 1.614 ml y «Paga 11 lleva 12» como una unidad.',
        ahora: 'Se reconocen como 6 × 269 ml, 24 × 269 ml o 12 latas, y se comparan con los demás paquetes.',
      },
      {
        titulo: 'Menos productos que no son',
        antes: 'Aparecían el refajo con la cerveza, la Double Black con la Black Label o un destapador entre las cervezas.',
        ahora: 'Refajo, sin alcohol, Imperial, Double Black, packs con obsequio y artículos que no son bebida quedan aparte.',
      },
    ],
  },
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
