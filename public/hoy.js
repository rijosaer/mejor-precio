// «Hoy»: al abrir la app, antes de buscar, lo que pide atención: la plata que
// se pierde por precios bajo el costo, los precios por aprobar, lo que hay que
// pedir, el inventario en negativo y las ofertas de los últimos dos días, cada
// cosa con su botón. Abajo, el historial de lo que se avisó y qué se hizo.
import { ultimo } from './resultados.js';
import { $, acciones, api, boton, el, guardado, hace, pesos } from './util.js';

let cargando = null;

// Se ve solo en la pantalla de búsqueda sin resultados.
export function mostrarHoy() {
  const caja = $('#hoy');
  caja.hidden = Boolean(ultimo) || !caja.childElementCount;
}

export async function cargarHoy() {
  const previo = guardado('mp-hoy');
  if (previo) pintar(previo);
  cargando ??= api('/api/hoy')
    .then((datos) => {
      guardado('mp-hoy', datos);
      pintar(datos);
    })
    .catch(() => {})
    .finally(() => (cargando = null));
  return cargando;
}

function bloque(clase, titulo, detalle, accion) {
  const b = el('article', `hoy-bloque ${clase}`);
  b.append(el('h3', '', titulo));
  if (detalle) b.append(detalle);
  if (accion) b.append(accion);
  return b;
}

function lista(items, max = 3) {
  const ul = el('ul', 'hoy-lista');
  for (const texto of items.slice(0, max)) ul.append(el('li', '', texto));
  if (items.length > max) ul.append(el('li', 'hoy-mas', `y ${items.length - max} más`));
  return ul;
}

const ir = (vista, texto = 'Ver en Mi tienda') => boton(texto, 'boton-texto', () => acciones.mostrar(vista));

function pintar(datos) {
  const caja = $('#hoy');
  const bloques = [];
  const m = datos.miTienda;
  const wa = datos.whatsapp;

  if (wa?.error && (!wa.ultimo || wa.error.t > wa.ultimo.t)) {
    bloques.push(bloque('mal', 'WhatsApp no pudo enviar los avisos', el('p', 'ayuda', `${wa.error.mensaje} · ${hace(wa.error.t)}. Los avisos esperan y se reintenta en cada revisión.`), boton('Revisar en Ajustes', 'boton-texto', () => acciones.abrirAjustes?.())));
  }
  if (m?.bajoCosto.length) {
    const titulo = m.perdida30 > 0 ? `Pierdes ${pesos.format(m.perdida30)} al mes` : `${m.bajoCosto.length} por debajo del costo`;
    const detalle = el('div');
    detalle.append(
      el('p', 'ayuda', `${m.bajoCosto.length} ${m.bajoCosto.length === 1 ? 'producto se vende' : 'productos se venden'} por debajo del costo (según las ventas de ${m.diasVentas} días en TRIVO).`),
      lista(m.bajoCosto.map((x) => `${x.nombre}: pierdes ${pesos.format(x.pierde)} c/u${x.vendidos ? ` · ${x.vendidos} vendidos` : ''}`)),
    );
    bloques.push(bloque('mal', titulo, detalle, ir('mitienda', 'Corregir precios')));
  }
  if (m?.propuestas) {
    bloques.push(bloque('aviso', `${m.propuestas} ${m.propuestas === 1 ? 'precio espera' : 'precios esperan'} tu aprobación`, el('p', 'ayuda', 'Calculados con tu margen. También se aprueban respondiendo el WhatsApp con el número.'), ir('mitienda', 'Revisar y aplicar')));
  }
  if (m?.porPedir.length) {
    bloques.push(bloque('', `${m.porPedir.length} por pedir`, lista(m.porPedir.map((x) => `${x.nombre}: ${x.existencias > 0 ? `quedan ${x.existencias}` : 'agotado'}${x.vendidos ? ` · ${x.vendidos} vendidos` : ''}`), 4), ir('mitienda')));
  }
  if (m?.negativos.length) {
    const detalle = el('div');
    detalle.append(lista(m.negativos.map((x) => `${x.nombre}: ${x.existencias}`)), el('p', 'ayuda', 'Se vendió sin cargar la compra o el conteo quedó mal: corrígelo en TRIVO.'));
    bloques.push(bloque('aviso', `${m.negativos.length} con inventario en negativo`, detalle));
  }
  if (datos.ofertas?.length) {
    const ul = el('ul', 'hoy-lista');
    for (const o of datos.ofertas) {
      const li = el('li');
      const unidad = o.unidades > 1 ? ` (${pesos.format(Math.round(o.precio / o.unidades))} c/u)` : '';
      const b = boton(`${o.nombre}: ${o.tienda} ${pesos.format(o.precio)}${unidad}`, 'hoy-enlace', () => acciones.buscar(o.q));
      li.append(b);
      ul.append(li);
    }
    bloques.push(bloque('bien', 'Para comprar barato', ul));
  }
  if (m?.trivo?.error) bloques.push(bloque('mal', 'TRIVO no está respondiendo', el('p', 'ayuda', m.trivo.error), ir('mitienda')));

  const cabeza = el('div', 'hoy-cabeza');
  cabeza.append(el('h2', '', 'Hoy'));
  if (m?.trivo?.t) cabeza.append(el('span', 'ayuda', `TRIVO leído ${hace(m.trivo.t)}`));
  const contenido = [cabeza];
  if (bloques.length) {
    const rejilla = el('div', 'hoy-rejilla');
    rejilla.append(...bloques);
    contenido.push(rejilla);
  } else contenido.push(el('p', 'hoy-orden', m ? 'Todo en orden: nada bajo el costo, nada por pedir ni por aprobar.' : 'Sin avisos nuevos.'));
  if (datos.historial?.length) contenido.push(historial(datos.historial));
  caja.replaceChildren(...contenido);
  mostrarHoy();
}

const ESTADOS = { aplicado: 'aplicado', descartado: 'descartado', pendiente: 'pendiente' };

function historial(entradas) {
  const d = el('details', 'hoy-historial');
  d.append(el('summary', '', 'Avisos enviados'));
  for (const h of entradas) {
    const fila = el('div', 'hoy-envio');
    const cuando = el('p', 'hoy-envio-cabeza');
    if (h.respuesta) {
      cuando.append(el('b', '', `Respondiste «${h.respuesta.orden}»`), ` · ${hace(h.t)}`);
      fila.append(cuando, el('p', 'hoy-respuesta', h.respuesta.texto.replace(/\*/g, '')));
      d.append(fila);
      continue;
    }
    const canal = h.whatsapp ? (h.whatsapp.enviado ? 'WhatsApp ✓' : `WhatsApp falló: ${h.whatsapp.error || 'sin respuesta'}`) : h.push ? `${h.push} notificaciones` : 'sin enviar';
    cuando.append(el('b', '', `${h.avisos.length} ${h.avisos.length === 1 ? 'aviso' : 'avisos'}`), ` · ${hace(h.t)} · ${canal}${h.nota ? ` · ${h.nota}` : ''}`);
    fila.append(cuando);
    const ul = el('ul', 'hoy-lista');
    for (const a of h.avisos.slice(0, 12)) {
      const li = el('li', '', a.title);
      const desenlaces = a.desenlaces || [];
      if (desenlaces.length > 2) {
        // Muchos precios en un aviso: cuántos de cada uno.
        for (const estado of Object.keys(ESTADOS)) {
          const n = desenlaces.filter((x) => x.estado === estado).length;
          if (n) li.append(' ', el('span', `hoy-estado ${estado}`, `${n} ${ESTADOS[estado]}${n === 1 ? '' : 's'}`));
        }
      } else {
        for (const x of desenlaces) {
          li.append(' ', el('span', `hoy-estado ${x.estado}`, x.estado === 'aplicado' ? `aplicado${x.via === 'whatsapp' ? ' por WhatsApp' : ''}` : ESTADOS[x.estado]));
        }
      }
      ul.append(li);
    }
    if (h.avisos.length > 12) ul.append(el('li', 'hoy-mas', `y ${h.avisos.length - 12} más`));
    fila.append(ul);
    d.append(fila);
  }
  return d;
}
