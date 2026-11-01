// TRIVO POS con la sesión de la tienda (TRIVO_USUARIO / TRIVO_CLAVE): costos
// de compra, existencias, ventas y compras por producto. Todo es lectura salvo
// UNA escritura: cambiarPrecio(), que solo cambia el precio de venta de un
// producto o variante y solo se llama cuando apruebas una propuesta en Mi tienda.
//
//   /api/auth/csrf/                  cookie csrftoken
//   /api/auth/login/                 POST {username, password} con X-CSRFToken → cookies access_token y refresh_token
//   /api/inventory/resale-products/  costo de compra (purchase_cost), precio, existencias; por variante
//   /api/inventory/product-stock/    existencias por bodega y variante (paginado)
//   /api/reports/sales-by-product/   unidades vendidas, ingresos y pedidos por producto (date_from / date_to)
//   /api/inventory/movements/        compras cargadas (type=purchase): producto, variante, cantidad, costo unitario
//   PATCH /api/catalog/products/<id>/                   {base_price}   (producto sin variantes)
//   PATCH /api/catalog/products/<id>/variants/<vid>/    {price}        (variante)
import { ZONA } from './config.js';

const BASE = 'https://trivo-pos.com';
const TIEMPO = 8000;
const SESION_MIN = 10; // se reutiliza la sesión unos minutos
const MAX_PAGINAS = 10;

let sesion = null; // { cookies: Map, t }

export const trivoActivo = () => Boolean(process.env.TRIVO_USUARIO && process.env.TRIVO_CLAVE);

function guardarCookies(cookies, res) {
  const lista = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  for (const c of lista) {
    const [par] = c.split(';');
    const i = par.indexOf('=');
    if (i > 0) cookies.set(par.slice(0, i).trim(), par.slice(i + 1).trim());
  }
}

const textoCookies = (cookies) => [...cookies].map(([k, v]) => `${k}=${v}`).join('; ');

async function llamar(ruta, cookies, opciones = {}) {
  const res = await fetch(`${BASE}${ruta}`, {
    ...opciones,
    headers: { accept: 'application/json', cookie: textoCookies(cookies), ...(opciones.headers || {}) },
    signal: AbortSignal.timeout(TIEMPO),
    redirect: 'manual',
  });
  guardarCookies(cookies, res);
  return res;
}

export async function iniciarSesion() {
  if (!trivoActivo()) throw new Error('Faltan TRIVO_USUARIO y TRIVO_CLAVE en el servidor');
  const cookies = new Map();
  await llamar('/api/auth/csrf/', cookies);
  const csrf = cookies.get('csrftoken');
  if (!csrf) throw new Error('TRIVO no entregó el token CSRF');
  const res = await llamar('/api/auth/login/', cookies, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrftoken': csrf, referer: `${BASE}/auth/login`, origin: BASE },
    body: JSON.stringify({ username: process.env.TRIVO_USUARIO, password: process.env.TRIVO_CLAVE }),
  });
  if (res.status === 400 || res.status === 401) throw new Error('TRIVO rechazó el usuario o la clave');
  if (!res.ok) throw new Error(`TRIVO: inicio de sesión HTTP ${res.status}`);
  const datos = await res.json().catch(() => ({}));
  if (datos.success === false || !cookies.get('access_token')) throw new Error('TRIVO rechazó el usuario o la clave');
  sesion = { cookies, t: Date.now() };
  return sesion;
}

// GET con la sesión; si venció, se vuelve a entrar una vez.
async function leerRuta(ruta) {
  if (!sesion || Date.now() - sesion.t > SESION_MIN * 60_000) await iniciarSesion();
  let res = await llamar(ruta, sesion.cookies);
  if (res.status === 401 || res.status === 403) {
    await iniciarSesion();
    res = await llamar(ruta, sesion.cookies);
  }
  if (!res.ok) throw new Error(`TRIVO ${ruta.split('?')[0]}: HTTP ${res.status}`);
  return res.json();
}

export function cerrarSesionLocal() {
  sesion = null;
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Fecha local de Colombia (AAAA-MM-DD).
export function fechaLocal(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

// ── Lecturas ────────────────────────────────────────────────────────────────
export async function productosReventa() {
  const datos = await leerRuta('/api/inventory/resale-products/');
  return (datos?.data?.results ?? []).map((p) => ({
    id: p.product_id,
    nombre: String(p.product_name || ''),
    categoria: p.category_name || '',
    unidad: p.unit_code || '',
    costo: num(p.purchase_cost),
    precio: num(p.sale_price),
    existencias: num(p.quantity),
    minimo: num(p.min_quantity),
    bajo: Boolean(p.is_low),
    activo: p.is_active !== false,
    variantes: (p.variants ?? []).map((v) => ({
      id: v.variant_id,
      nombre: String(v.variant_name || ''),
      costo: num(v.purchase_cost),
      precio: num(v.sale_price),
      existencias: num(v.quantity),
      minimo: num(v.min_quantity),
      bajo: Boolean(v.is_low),
    })),
  }));
}

// Existencias sumando bodegas: clave «producto» o «producto-variante».
export async function existencias() {
  const total = new Map();
  for (let pagina = 1; pagina <= MAX_PAGINAS; pagina++) {
    const datos = await leerRuta(`/api/inventory/product-stock/?page=${pagina}&page_size=100`);
    for (const f of datos?.results ?? []) {
      const clave = f.variant_id ? `${f.product_id}-${f.variant_id}` : String(f.product_id);
      total.set(clave, (total.get(clave) || 0) + (num(f.quantity) || 0));
    }
    if (!datos?.next || pagina >= (datos.total_pages || 1)) break;
  }
  return total;
}

// Ventas por producto (todas las variantes juntas) entre dos fechas locales.
export async function ventasPorProducto({ dias = 30, ahora = Date.now() } = {}) {
  const desde = fechaLocal(ahora - (dias - 1) * 86_400_000);
  const hasta = fechaLocal(ahora);
  const datos = await leerRuta(`/api/reports/sales-by-product/?date_from=${desde}&date_to=${hasta}`);
  const ventas = new Map();
  for (const f of datos?.data ?? []) {
    ventas.set(String(f.product_id), { unidades: num(f.quantity_sold) || 0, ingresos: num(f.total_revenue) || 0, pedidos: num(f.orders_count) || 0 });
  }
  return { desde, hasta, dias, ventas };
}

// Compras cargadas (orden recibida o movimiento manual de compra), las más nuevas primero.
export async function comprasRecientes() {
  const datos = await leerRuta('/api/inventory/movements/?type=purchase&page_size=50');
  return (datos?.results ?? datos?.data?.results ?? [])
    .filter((m) => !m.type || m.type === 'purchase')
    .map((m) => ({
      id: m.id,
      producto: m.product_id ?? null,
      variante: m.variant_id ?? null,
      cantidad: num(m.quantity),
      costo: num(m.unit_cost),
      fecha: m.created_at || null,
    }))
    .filter((m) => m.producto && m.id !== undefined)
    .sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)) || Number(b.id) - Number(a.id));
}

// ── La única escritura ──────────────────────────────────────────────────────
// Cambia el precio de venta y nada más. Antes comprueba que el precio en TRIVO
// siga siendo `esperado` (si alguien lo cambió, no se pisa) y después lo vuelve
// a leer para confirmar.
const precioEnTrivo = (detalle, variante) => num(variante ? detalle.variants?.find((v) => String(v.id) === String(variante))?.price : detalle.base_price);

export async function cambiarPrecio({ producto, variante = null, precio, esperado }) {
  if (!/^\d{1,9}$/.test(String(producto)) || (variante !== null && !/^\d{1,9}$/.test(String(variante)))) throw new TypeError('Producto no válido');
  if (!Number.isInteger(precio) || precio <= 0 || precio >= 1e8) throw new TypeError('Precio no válido');
  const ruta = `/api/catalog/products/${producto}/`;
  const actual = precioEnTrivo((await leerRuta(ruta))?.data ?? {}, variante);
  if (actual === null) throw new Error('Ese producto ya no está en TRIVO');
  if (esperado !== undefined && Math.round(actual) !== Math.round(esperado)) {
    throw new Error(`El precio en TRIVO ya no es ${esperado} (ahora es ${Math.round(actual)}): vuelve a leer TRIVO`);
  }
  const destino = variante ? `${ruta}variants/${variante}/` : ruta;
  const cuerpo = variante ? { price: String(precio) } : { base_price: String(precio) };
  const res = await llamar(destino, sesion.cookies, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-csrftoken': sesion.cookies.get('csrftoken') || '', referer: `${BASE}/catalog/products/${producto}`, origin: BASE },
    body: JSON.stringify(cuerpo),
  });
  if (!res.ok) throw new Error(`TRIVO no aceptó el precio: HTTP ${res.status}`);
  const nuevo = precioEnTrivo((await leerRuta(ruta))?.data ?? {}, variante);
  if (Math.round(nuevo) !== precio) throw new Error('TRIVO respondió bien pero el precio no cambió');
  return { antes: Math.round(actual), despues: precio };
}

// Todo lo que Mi tienda necesita, en paralelo.
export async function leerTrivo({ dias = 30, ahora = Date.now() } = {}) {
  if (!sesion || Date.now() - sesion.t > SESION_MIN * 60_000) await iniciarSesion();
  const [productos, stock, ventas, compras] = await Promise.all([
    productosReventa(),
    existencias(),
    ventasPorProducto({ dias, ahora }),
    // Si las compras no se pueden leer, lo demás sigue sirviendo.
    comprasRecientes().catch((e) => (console.error('[trivo compras]', e.message), null)),
  ]);
  return { t: ahora, productos, stock, compras, ...ventas };
}
