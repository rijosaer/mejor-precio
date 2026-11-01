// Estado de las tiendas: cuánto tarda cada una, cuándo respondió y falló por
// última vez (desde que arrancó el servidor) y la búsqueda de control diaria.
import { $, api, el, hace, miles } from './util.js';

function tarjeta(t, control) {
  const caja = el('div', 'estado-tienda');
  const sano = control ? control.ok : t.ultimoOk && (!t.ultimoFallo || t.ultimoOk > t.ultimoFallo);
  const sinDatos = !control && !t.consultas;
  caja.classList.add(sinDatos ? 'sin-datos' : sano ? 'bien' : 'mal');
  const cabeza = el('div', 'estado-cabeza');
  cabeza.append(el('b', '', t.nombre), el('span', 'pastilla ' + (sinDatos ? '' : sano ? 'bien' : 'mal'), sinDatos ? 'Sin datos' : sano ? 'Responde' : 'Con fallas'));
  caja.append(cabeza);
  const lineas = [];
  if (t.porDefecto === false) lineas.push('Apagada por defecto (actívala en Ajustes → Tiendas)');
  if (t.consultas) lineas.push(`${t.consultas} consultas · ${t.fallos} fallos · ${miles.format(t.msPromedio)} ms en promedio`);
  if (t.ultimoOk) lineas.push(`Última respuesta ${hace(t.ultimoOk)}${t.ultimoN !== null && t.ultimoN !== undefined ? ` con ${t.ultimoN} productos` : ''}`);
  if (t.ultimoFallo) lineas.push(`Último fallo ${hace(t.ultimoFallo)}: ${t.ultimoError}`);
  if (control) lineas.push(`Control diario: ${control.ok ? `${control.n} productos en ${miles.format(control.ms)} ms` : control.error}`);
  for (const l of lineas) caja.append(el('p', 'ayuda', l));
  return caja;
}

export async function abrirEstado() {
  const caja = $('#estado-contenido');
  caja.replaceChildren(el('p', 'ayuda', 'Consultando…'));
  try {
    pintar(await api('/api/estado-tiendas'));
  } catch (error) {
    caja.replaceChildren(el('p', 'error', error.message));
  }
}

function pintar({ tiendas, control }) {
  const caja = $('#estado-contenido');
  caja.replaceChildren();
  const porId = new Map((control?.tiendas || []).map((t) => [t.id, t]));
  if (control) caja.append(el('p', 'ayuda', `Búsqueda de control «${control.consulta}» ${hace(control.t)}. Si una tienda falla dos días seguidos llega un aviso.`));
  else caja.append(el('p', 'ayuda', 'La búsqueda de control corre una vez al día con el monitoreo.'));
  const lista = el('div', 'estado-lista');
  for (const t of tiendas) lista.append(tarjeta(t, porId.get(t.id)));
  caja.append(lista);
  caja.append(el('p', 'nota', 'Las cifras de consultas se reinician cada vez que el servidor arranca (en Netlify, cada instancia lleva las suyas).'));
}

export function configurarEstado() {
  $('#estado-probar').addEventListener('click', async () => {
    const b = $('#estado-probar');
    b.disabled = true;
    try {
      pintar(await api('/api/estado-tiendas', { method: 'POST' }));
    } catch (error) {
      $('#estado-contenido').replaceChildren(el('p', 'error', error.message));
    } finally {
      b.disabled = false;
    }
  });
}

