// Lo que vive en el servidor y se copia al navegador: Mi lista, el
// monitoreo, los ajustes compartidos, la configuración del monitoreo, los
// movimientos de inventario y la lista de tiendas.
import { ajustes, fusionarServidor, guardarAjustes } from './datos.js';
import { api, guardado } from './util.js';

// ── Mi lista ────────────────────────────────────────────────────────────────
export const listaLeer = () => guardado('mp-lista') || [];

export function listaGuardar(items) {
  guardado('mp-lista', items);
  guardado('mp-lista-pendiente', true);
  return subirLista();
}

// La lista vive también en el servidor: así el monitoreo la revisa sola y se
// comparte entre teléfonos. Si no hay red, se sube en la próxima apertura.
export async function subirLista() {
  try {
    const { lista } = await api('/api/lista', { method: 'PUT', cuerpo: { lista: listaLeer() } });
    guardado('mp-lista', lista);
    guardado('mp-lista-pendiente', false);
  } catch {
    /* queda pendiente */
  }
}

// ── Ajustes compartidos ────────────────────────────────────────────────────
// Gana el más reciente: si el del servidor es más nuevo se adopta; si el del
// navegador es más nuevo se sube.
export async function subirAjustes() {
  try {
    const a = ajustes();
    await api('/api/ajustes', { method: 'PUT', cuerpo: { ajustes: a, t: a.t } });
    guardado('mp-ajustes-pendiente', false);
  } catch {
    guardado('mp-ajustes-pendiente', true);
  }
}

function fusionarAjustes(delServidor) {
  const local = ajustes();
  if (delServidor?.ajustes && delServidor.t > (local.t || 0)) {
    guardarAjustes(delServidor.ajustes, delServidor.t);
    return true;
  }
  if ((local.t || 0) > (delServidor?.t || 0) || guardado('mp-ajustes-pendiente')) subirAjustes();
  return false;
}

// ── Monitoreo ──────────────────────────────────────────────────────────────
export async function sincronizar() {
  try {
    const datos = await api(`/api/monitoreo?desde=${guardado('mp-sync') || 0}`);
    if (guardado('mp-lista-pendiente') || (!datos.lista.length && listaLeer().length)) await subirLista();
    else guardado('mp-lista', datos.lista);
    fusionarServidor(datos);
    guardado('mp-sync', datos.ahora);
    guardado('mp-revisado', datos.revisado);
    guardado('mp-resumenes', datos.resumenes || {});
    if (datos.config) guardado('mp-config', datos.config);
    const cambiaron = fusionarAjustes(datos.ajustes);
    return { ok: true, ajustesCambiaron: cambiaron };
  } catch {
    return { ok: false }; // sin red: se sigue con lo del navegador
  }
}

export const resumenes = () => guardado('mp-resumenes') || {};
export const configServidor = () => guardado('mp-config') || { cadaHoras: 6, silencio: { activo: true, desde: 22, hasta: 7 }, resumenSemanal: true, miTienda: 'aguapure' };

// ── Tiendas ────────────────────────────────────────────────────────────────
const TIENDAS_CONOCIDAS = [
  { id: 'bevgo', nombre: 'Bevgo', porDefecto: true },
  { id: 'dislicores', nombre: 'Dislicores', porDefecto: true },
  { id: 'exito', nombre: 'Éxito', porDefecto: true },
  { id: 'makro', nombre: 'Makro', porDefecto: true },
  { id: 'olimpica', nombre: 'Olímpica', porDefecto: true },
  { id: 'aguapure', nombre: 'Agua Pure', porDefecto: true },
  { id: 'd1', nombre: 'D1', porDefecto: true },
];

export async function catalogoTiendas() {
  try {
    const { tiendas } = await api('/api/tiendas');
    if (tiendas?.length) {
      guardado('mp-tiendas', tiendas);
      return tiendas;
    }
  } catch {
    /* sin red */
  }
  return guardado('mp-tiendas') || TIENDAS_CONOCIDAS;
}

export const tiendasGuardadas = () => guardado('mp-tiendas') || TIENDAS_CONOCIDAS;

// Ids de las tiendas de la app que se consultan, según los ajustes. Los
// proveedores propios se prenden y apagan en su propia ficha.
export function tiendasActivas() {
  const elegidas = ajustes().tiendas || {};
  return tiendasGuardadas()
    .filter((t) => !t.propio)
    .filter((t) => (t.id in elegidas ? elegidas[t.id] : t.porDefecto))
    .map((t) => t.id);
}

// ── Movimientos de inventario ──────────────────────────────────────────────
export const movimientosGuardados = () => guardado('mp-movimientos') || [];

export async function cargarMovimientos() {
  try {
    const { movimientos } = await api('/api/movimientos');
    guardado('mp-movimientos', movimientos);
  } catch {
    /* sin red: los últimos conocidos */
  }
  return movimientosGuardados();
}

export async function registrarMovimiento(m) {
  const { movimientos } = await api('/api/movimientos', { method: 'POST', cuerpo: m });
  guardado('mp-movimientos', movimientos);
  return movimientos;
}

export async function borrarMovimiento(id) {
  const { movimientos } = await api(`/api/movimientos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  guardado('mp-movimientos', movimientos);
  return movimientos;
}
