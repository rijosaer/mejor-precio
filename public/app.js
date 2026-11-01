// Arranque de la app: sesión, navegación entre vistas, búsqueda,
// autocompletar, apariencia y service worker. Cada vista vive en su módulo.
import { abrirAjustes, configurarAjustes } from './ajustes.js';
import { abrirCatalogo, configurarCatalogo } from './catalogo.js';
import { ajustes, fusionarServidor, registrar } from './datos.js';
import { configurarEscaner } from './escaner.js';
import { abrirEstado, configurarEstado } from './estado.js';
import { abrirLista, analizarLista, configurarLista, propuestaVieja } from './lista.js';
import { LISTAS } from './listas-sugeridas.js';
import { abrirMiTienda, configurarMiTienda } from './mitienda.js';
import { configurarNovedades, iniciarNovedades } from './novedades.js';
import { agregarAlPedido, configurarPedido, pintarPedido } from './pedido.js';
import { abrirProveedores, configurarProveedores } from './proveedores.js';
import { cerrarFicha, fijarUltimo, pintarResultados, refrescar, ultimo } from './resultados.js';
import { catalogoTiendas, listaLeer, sincronizar, tiendasActivas, tiendasGuardadas } from './sync.js';
import { abrirTutorial, configurarTutorial, iniciarTutorial } from './tutorial.js';
import { $, acciones, api, el, guardado } from './util.js';
import { abrirVentas, configurarVentas } from './ventas.js';

const VISTAS = ['entrar', 'buscar', 'ajustes', 'lista', 'mitienda', 'catalogo', 'pedido', 'ventas', 'proveedores', 'estado'];
const AL_ABRIR = {
  lista: abrirLista,
  mitienda: abrirMiTienda,
  catalogo: abrirCatalogo,
  pedido: pintarPedido,
  ventas: abrirVentas,
  proveedores: abrirProveedores,
  estado: abrirEstado,
};

// ── Vistas ──────────────────────────────────────────────────────────────────
function mostrar(vista) {
  for (const v of VISTAS) $(`#vista-${v}`).hidden = v !== vista;
  const dentro = vista !== 'entrar';
  for (const b of document.querySelectorAll('.acciones [data-vista], #salir')) b.hidden = !dentro;
  for (const b of document.querySelectorAll('.acciones [data-vista]')) b.setAttribute('aria-current', String(b.dataset.vista === vista));
  if (vista === 'entrar') $('#clave').focus();
  AL_ABRIR[vista]?.();
  window.scrollTo({ top: 0 });
}

function volver() {
  mostrar('buscar');
  refrescar();
}

// ── Apariencia ─────────────────────────────────────────────────────────────
function aplicarApariencia() {
  const { tema, letra } = ajustes().apariencia;
  const raiz = document.documentElement;
  if (tema === 'claro' || tema === 'oscuro') raiz.dataset.theme = tema === 'oscuro' ? 'dark' : 'light';
  else delete raiz.dataset.theme;
  raiz.style.setProperty('--escala', String((Number(letra) || 100) / 100));
  const oscuro = tema === 'oscuro' || (tema !== 'claro' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]').content = oscuro ? '#111418' : '#eef0f3';
}

// ── Autocompletar ──────────────────────────────────────────────────────────
// Lo buscado antes, Mi lista y nombres de productos vistos en resultados.
function recordarNombres(datos) {
  const vistos = guardado('mp-nombres') || [];
  const nuevos = datos.tiendas.flatMap((t) => t.productos.slice(0, 5).map((p) => p.nombre.replace(/\s+/g, ' ').trim()));
  const unidos = [...new Set([...nuevos, ...vistos])].slice(0, 250);
  guardado('mp-nombres', unidos);
}

function pintarSugerencias() {
  const lista = $('#sugerencias');
  const opciones = [...new Set([...(guardado('mp-recientes') || []), ...listaLeer().map((x) => x.q), ...(guardado('mp-nombres') || [])])];
  lista.replaceChildren(...opciones.slice(0, 300).map((v) => new Option(v)));
}

function pintarRecientes() {
  const caja = $('#recientes');
  caja.replaceChildren();
  $('#rapidas').hidden = Boolean(ultimo);
  if (ultimo) return;
  for (const q of guardado('mp-recientes') || []) {
    const b = el('button', '', q);
    b.type = 'button';
    b.addEventListener('click', () => buscar(q));
    caja.append(b);
  }
  // Búsquedas rápidas de cervezas (la lista predeterminada).
  const cervezas = LISTAS.find((l) => l.id === 'cervezas');
  const rapidas = $('#rapidas');
  rapidas.replaceChildren(el('span', 'rapidas-titulo', 'Cervezas'));
  for (const p of cervezas.productos) {
    const b = el('button', '', p.corto);
    b.type = 'button';
    b.title = p.q;
    b.addEventListener('click', () => buscar(p.q));
    rapidas.append(b);
  }
}

function recordar(q) {
  const lista = (guardado('mp-recientes') || []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  guardado('mp-recientes', [q, ...lista].slice(0, 8));
}

function pintarCargando() {
  const fila = el('div', 'tiendas');
  const activas = new Set(tiendasActivas());
  for (const t of tiendasGuardadas()) {
    if (t.propio ? t.porDefecto : activas.has(t.id)) fila.append(el('span', 'pastilla cargando', t.nombre));
  }
  $('#estado').replaceChildren(fila);
  $('#resultados').replaceChildren();
}

// ── Búsqueda ───────────────────────────────────────────────────────────────
async function buscar(q) {
  q = String(q).trim();
  if (q.length < 2) return;
  $('#q').value = q;
  $('#q').blur();
  const b = $('#form-buscar button[type="submit"]');
  b.disabled = true;
  fijarUltimo(null);
  pintarRecientes();
  pintarCargando();
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  try {
    const datos = await api(`/api/buscar?q=${encodeURIComponent(q)}&tiendas=${tiendasActivas().join(',')}`);
    // Primero el historial del servidor (lo que vio la otra persona), luego esta lectura.
    fusionarServidor({ series: datos.series || {} });
    registrar(datos);
    fijarUltimo(datos);
    recordar(q);
    recordarNombres(datos);
    pintarSugerencias();
    pintarRecientes();
    pintarResultados();
  } catch (error) {
    $('#estado').replaceChildren(el('p', 'error', error.message));
  } finally {
    b.disabled = false;
  }
}

Object.assign(acciones, { buscar, mostrar, volver, agregarAlPedido, aplicarApariencia });

// ── Eventos ────────────────────────────────────────────────────────────────
$('#form-buscar').addEventListener('submit', (e) => {
  e.preventDefault();
  buscar($('#q').value);
});

$('#form-entrar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const error = $('#error-entrar');
  error.textContent = '';
  try {
    await api('/api/entrar', { method: 'POST', cuerpo: { clave: $('#clave').value } });
    $('#clave').value = '';
    iniciar();
  } catch (err) {
    error.textContent = err.message;
  }
});

$('#salir').addEventListener('click', async () => {
  await api('/api/salir', { method: 'POST' }).catch(() => {});
  fijarUltimo(null);
  mostrar('entrar');
});

$('#ir-buscar').addEventListener('click', (e) => {
  if (!$('#vista-entrar').hidden) return;
  e.preventDefault();
  volver();
  $('#q').focus();
});
$('#abrir-tutorial').addEventListener('click', () => abrirTutorial());
for (const b of document.querySelectorAll('.acciones [data-vista]')) {
  b.addEventListener('click', () => (b.dataset.vista === 'ajustes' ? abrirAjustes() : mostrar(b.dataset.vista)));
}
for (const b of document.querySelectorAll('[data-volver]')) b.addEventListener('click', volver);
$('#ficha-cerrar').addEventListener('click', cerrarFicha);
$('#ficha').addEventListener('click', (e) => {
  if (e.target === $('#ficha')) cerrarFicha(); // clic fuera de la caja
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', aplicarApariencia);

// Al volver a la app (otra pestaña, teléfono desbloqueado) se baja lo nuevo.
let ultimaSync = 0;
document.addEventListener('visibilitychange', async () => {
  if (document.hidden || $('#vista-entrar').hidden === false || Date.now() - ultimaSync < 5 * 60_000) return;
  ultimaSync = Date.now();
  const r = await sincronizar();
  if (r.ajustesCambiaron) aplicarApariencia();
  if (!$('#vista-buscar').hidden) refrescar();
});

configurarTutorial();
configurarLista();
configurarCatalogo();
configurarPedido();
configurarVentas();
configurarProveedores();
configurarAjustes();
configurarEstado();
configurarMiTienda();
configurarEscaner();
configurarNovedades((vista) => (vista === 'ajustes' ? abrirAjustes() : mostrar(vista)));
aplicarApariencia();

async function iniciar() {
  const { ok } = await api('/api/sesion').catch(() => ({ ok: false }));
  if (!ok) return mostrar('entrar');
  mostrar('buscar');
  pintarRecientes();
  pintarSugerencias();
  // Primera vez en el dispositivo: tutorial; después (o si ya lo vio), las
  // novedades de la versión que este dispositivo todavía no ha visto.
  iniciarTutorial(() => iniciarNovedades((vista) => (vista === 'ajustes' ? abrirAjustes() : mostrar(vista))));
  ultimaSync = Date.now();
  const [r] = await Promise.all([sincronizar(), catalogoTiendas()]);
  if (r.ajustesCambiaron) aplicarApariencia();
  refrescar();
  if (propuestaVieja()) analizarLista().catch(() => {});
  const q = new URLSearchParams(location.search).get('q');
  if (q) buscar(q);
  else $('#q').focus();
}

if ('serviceWorker' in navigator) {
  // Si ya había una versión instalada y entra otra con la app abierta, se
  // ofrece recargar; al recargar se abren las novedades.
  const habiaVersion = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (habiaVersion) $('#nueva-version').hidden = false;
  });
  $('#nueva-version-recargar').addEventListener('click', () => location.reload());
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // Buscar versión nueva al volver a la app (las PWA instaladas pueden pasar días abiertas).
    document.addEventListener('visibilitychange', () => !document.hidden && reg.update().catch(() => {}));
  }).catch(() => {});
  // Al tocar una notificación con la app abierta, el service worker pide la búsqueda.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.tipo === 'abrir' && e.data.q) {
      mostrar('buscar');
      buscar(e.data.q);
    }
  });
}

iniciar();
