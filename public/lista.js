// Mi lista: los productos que se monitorean solos, la propuesta del día (en qué
// tienda sale más barato cada uno) y el resumen de la semana.
import { cambioSemanal, claveDe, registrar } from './datos.js';
import { faltantes, LISTAS, yaEsta } from './listas-sugeridas.js';
import { agrupar } from './resultados.js';
import { listaGuardar, listaLeer, tiendasActivas } from './sync.js';
import { $, acciones, api, boton, compartir, el, enlace, fechaLarga, guardado, hace, idNuevo, pesos, presentacion } from './util.js';

const propuestaLeer = () => guardado('mp-lista-propuesta') || null;

export function pintarLista() {
  const caja = $('#lista-items');
  caja.replaceChildren();
  const items = listaLeer();
  $('#lista-analizar').disabled = !items.length;
  if (!items.length) {
    caja.append(el('p', 'ayuda', 'Tu lista está vacía. Agrega el primer producto arriba.'));
    return;
  }
  const revisados = guardado('mp-revisado') || {};
  for (const item of items) {
    const filaItem = el('div', 'lista-fila');
    const texto = el('div', 'lista-texto');
    const nombre = boton(item.q, 'enlace-boton lista-nombre', () => {
      acciones.mostrar('buscar');
      acciones.buscar(item.q);
    });
    texto.append(nombre);
    const revisado = revisados[item.id];
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
    const quitar = boton('Quitar', 'mini', () => {
      listaGuardar(listaLeer().filter((x) => x.id !== item.id));
      pintarLista();
      pintarSugeridas();
    });
    const acc = el('div', 'lista-acciones');
    acc.append(umbral, quitar);
    filaItem.append(texto, acc);
    caja.append(filaItem);
  }
}

export async function analizarLista() {
  const items = listaLeer();
  if (!items.length) return;
  const botonAnalizar = $('#lista-analizar');
  const estado = $('#lista-estado');
  botonAnalizar.disabled = true;
  const filas = [];
  const tiendas = tiendasActivas().join(',');
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    estado.replaceChildren(el('p', '', `Consultando ${i + 1} de ${items.length}: ${item.q}…`));
    try {
      const datos = await api(`/api/buscar?q=${encodeURIComponent(item.q)}&tiendas=${tiendas}`);
      registrar(datos);
      const grupos = agrupar(datos, { soloDisponibles: true, modo: 'precio' });
      // La presentación del tamaño que se escribió ("…750"); si no hay, la más comparada.
      const tamanos = item.q.match(/\d+/g) || [];
      const g = grupos.find((x) => x.clave !== 'sin' && tamanos.includes(String(x.ml))) || grupos.find((x) => x.clave !== 'sin');
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
          claves: g.productos.map((p) => claveDe(p.tienda.id, p)),
        });
      } else filas.push({ q: item.q, id: item.id, error: 'Sin presentación comparable' });
    } catch (error) {
      filas.push({ q: item.q, id: item.id, error: error.message });
    }
    if (i < items.length - 1) await new Promise((r) => setTimeout(r, 300));
  }
  guardado('mp-lista-propuesta', { generadaEn: Date.now(), filas });
  pintarPropuesta();
  botonAnalizar.disabled = false;
  estado.replaceChildren();
}

export function pintarPropuesta() {
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

  const cabeza = el('div', 'propuesta-cabeza');
  cabeza.append(el('p', 'propuesta-titulo', `Propuesta del día (${fechaLarga(p.generadaEn)})`));
  cabeza.append(boton('Compartir', 'mini', () => {
    const lineas = validas.map((f) => `• ${f.q}${f.presentacion ? ` (${f.presentacion})` : ''}: ${f.tienda} ${pesos.format(f.precio)}`);
    compartir(['Mi lista · dónde sale más barato hoy:', ...lineas].join('\n'));
  }));
  caja.append(cabeza);
  for (const f of validas) {
    const filaP = el('div', 'propuesta-fila');
    if (f.id === decidida.id && f.ahorro > 0) filaP.append(el('span', 'chip chip-decision', 'Decisión'));
    const izq = el('div', 'propuesta-izq');
    izq.append(el('b', '', f.q));
    if (f.presentacion) izq.append(el('span', 'ayuda', f.presentacion));
    const der = el('div', 'propuesta-der');
    der.append(f.url ? enlace(f.tienda, f.url) : el('span', '', f.tienda), el('strong', '', pesos.format(f.precio)));
    if (f.ahorro > 0) der.append(el('span', 'chip chip-baja', `Ahorras ${pesos.format(f.ahorro)}`));
    filaP.append(izq, der);
    caja.append(filaP);
  }
  if (totalAhorro > 0) caja.append(el('p', 'propuesta-total', `Total que ahorras en esta lista: ${pesos.format(totalAhorro)}`));
  for (const f of p.filas.filter((x) => x.error)) caja.append(el('p', 'error', `${f.q}: ${f.error}`));
  pintarSemana(caja, validas);
}

// Qué subió y qué bajó frente a hace una semana (con el historial del navegador).
function pintarSemana(caja, filas) {
  const cambios = filas
    .map((f) => ({ f, c: f.claves ? cambioSemanal(f.claves) : null }))
    .filter((x) => x.c && Math.abs(x.c.pct) >= 1)
    .sort((a, b) => a.c.pct - b.c.pct);
  if (!cambios.length) return;
  const bloque = el('div', 'semana');
  bloque.append(el('p', 'propuesta-titulo', 'Esta semana'));
  for (const { f, c } of cambios) {
    const filaS = el('div', 'salida-linea');
    const clase = c.pct < 0 ? 'positivo' : 'negativo';
    filaS.classList.add(clase);
    filaS.append(el('span', '', f.q), el('b', '', `${c.pct < 0 ? 'Bajó' : 'Subió'} ${Math.abs(c.pct).toFixed(0)} % · ${pesos.format(c.antes)} → ${pesos.format(c.hoy)}`));
    bloque.append(filaS);
  }
  caja.append(bloque);
}

export function configurarLista() {
  $('#form-lista').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('#lista-q').value.trim();
    if (q.length < 2) return;
    const items = listaLeer();
    if (!items.some((x) => x.q.toLowerCase() === q.toLowerCase())) {
      items.push({ q, id: idNuevo() });
      listaGuardar(items);
    }
    $('#lista-q').value = '';
    pintarLista();
  });
  $('#lista-analizar').addEventListener('click', analizarLista);
}

// ── Listas predeterminadas ─────────────────────────────────────────────────
const MAX_ITEMS = 60;

export function pintarSugeridas() {
  const caja = $('#listas-sugeridas');
  caja.replaceChildren();
  const actuales = listaLeer();
  for (const lista of LISTAS) {
    const pendientes = faltantes(lista, actuales);
    const tarjeta = el('details', 'sugerida');
    const resumen = el('summary', '');
    resumen.append(el('b', '', lista.nombre), el('span', 'ayuda', pendientes.length ? `${lista.productos.length} productos · ${pendientes.length} por agregar` : 'Ya están todos en tu lista'));
    tarjeta.append(resumen, el('p', 'ayuda', lista.descripcion));
    const opciones = el('div', 'sugerida-opciones');
    for (const p of lista.productos) {
      const l = el('label', 'opciones');
      const c = el('input');
      c.type = 'checkbox';
      c.value = p.q;
      const esta = yaEsta(p.q, actuales);
      c.checked = !esta;
      c.disabled = esta;
      l.append(c, document.createTextNode(` ${p.corto}${esta ? ' (ya está)' : ''}`));
      l.title = p.q;
      opciones.append(l);
    }
    const mensaje = el('p', 'ayuda');
    const agregar = boton(`Agregar a Mi lista`, 'boton', () => {
      const elegidas = [...opciones.querySelectorAll('input:checked:not(:disabled)')].map((c) => c.value);
      const items = listaLeer();
      const espacio = MAX_ITEMS - items.length;
      if (!elegidas.length) return;
      if (espacio <= 0) {
        mensaje.textContent = `Mi lista ya tiene ${MAX_ITEMS} productos, el máximo.`;
        return;
      }
      const nuevas = elegidas.filter((q) => !yaEsta(q, items)).slice(0, espacio);
      listaGuardar([...items, ...nuevas.map((q) => ({ q, id: idNuevo() }))]);
      pintarLista();
      pintarSugeridas();
      $('#lista-estado').replaceChildren(
        el('p', '', `${nuevas.length} ${nuevas.length === 1 ? 'producto agregado' : 'productos agregados'}${nuevas.length < elegidas.length ? ` (no cabían ${elegidas.length - nuevas.length})` : ''}. El servidor los revisará en la próxima hora; pulsa «Analizar ahora» para ver los precios ya.`),
      );
    });
    agregar.disabled = !pendientes.length;
    const todos = boton('Marcar todos', 'boton-texto', () => opciones.querySelectorAll('input:not(:disabled)').forEach((c) => (c.checked = true)));
    const ninguno = boton('Ninguno', 'boton-texto', () => opciones.querySelectorAll('input:not(:disabled)').forEach((c) => (c.checked = false)));
    const acciones = el('div', 'aj-botones');
    acciones.append(agregar, todos, ninguno);
    tarjeta.append(opciones, acciones, mensaje);
    caja.append(tarjeta);
  }
}

export function abrirLista() {
  pintarLista();
  pintarSugeridas();
  pintarPropuesta();
}

export function propuestaVieja() {
  const p = propuestaLeer();
  return listaLeer().length && (!p || Date.now() - p.generadaEn > 24 * 60 * 60 * 1000);
}
