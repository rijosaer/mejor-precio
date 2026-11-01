// TRIVO POS con la sesión de la tienda (TRIVO_USUARIO / TRIVO_CLAVE): costos
// de compra, existencias y ventas por producto. SOLO LECTURA: además del inicio
// de sesión, este módulo únicamente hace GET. Aplicar precios en TRIVO
// (PATCH /api/catalog/products/<id>/) no está programado a propósito.
//
//   /api/auth/csrf/                  cookie csrftoken
//   /api/auth/login/                 POST {username, password} con X-CSRFToken → cookies access_token y refresh_token
//   /api/inventory/resale-products/  costo de compra (purchase_cost), precio, existencias; por variante
//   /api/inventory/product-stock/    existencias por bodega y variante (paginado)
//   /api/reports/sales-by-product/   unidades vendidas, ingresos y pedidos por producto (date_from / date_to)
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

// Todo lo que Mi tienda necesita, en paralelo.
export async function leerTrivo({ dias = 30, ahora = Date.now() } = {}) {
  if (!sesion || Date.now() - sesion.t > SESION_MIN * 60_000) await iniciarSesion();
  const [productos, stock, ventas] = await Promise.all([productosReventa(), existencias(), ventasPorProducto({ dias, ahora })]);
  return { t: ahora, productos, stock, ...ventas };
}
