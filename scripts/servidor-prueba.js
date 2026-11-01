// Uso: npm run prueba-local
// Levanta la app con respuestas de ejemplo de cada tienda (tests/fixtures), sin
// internet y con datos en una carpeta temporal. Contraseña: "prueba".
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.APP_PASSWORD ||= 'prueba';
process.env.SESSION_SECRET ||= 'secreto-local-de-prueba';
process.env.DATOS_DIR ||= mkdtempSync(join(tmpdir(), 'mp-prueba-'));
// TRIVO con sesión simulado (tests/fixtures/trivo.json): nunca se usa el real.
process.env.TRIVO_USUARIO = 'prueba';
process.env.TRIVO_CLAVE = 'prueba';

const fixture = (nombre) => readFileSync(new URL(`../tests/fixtures/${nombre}`, import.meta.url), 'utf8');
const RUTAS = [
  [/bevgo\.com\.co\/wp-json/, 'bevgo.json'],
  [/dislicores\.com\/search\/suggest/, 'dislicores-suggest.json'],
  [/dislicores\.com\/search\?/, 'dislicores-search.html'],
  [/dislicores\.com\/products\/aguardiente-antioqueno-750\.js/, 'dislicores-ficha-750.json'],
  [/dislicores\.com\/products\/aguardiente-antioqueno-garrafa\.js/, 'dislicores-ficha-garrafa.json'],
  [/intelligent-search/, 'vtex.json'],
  [/tienda\.makro\.com\.co\/search/, 'makro.html'],
  [/trivo-pos\.com\/api\/public/, 'aguapure.json'],
];
const trivo = JSON.parse(fixture('trivo.json'));
const RUTAS_TRIVO = {
  '/api/auth/csrf/': [{}, 'csrftoken=prueba; Path=/'],
  '/api/auth/login/': [{ success: true }, 'access_token=prueba; Path=/'],
  '/api/inventory/resale-products/': [trivo.reventa],
  '/api/inventory/product-stock/': [trivo.stock],
  '/api/reports/sales-by-product/': [trivo.ventas],
  '/api/inventory/movements/': [{ success: true, count: 0, results: [] }],
};
// «Aplicar en TRIVO» en la prueba local: un catálogo en memoria, nunca el real.
const preciosPrueba = { 1: 3500, 2: 72000, 3: 85000, 4: 48000, '4-9': 49000 };
const real = globalThis.fetch;
globalThis.fetch = async (url, opciones) => {
  const u = new URL(String(url));
  if (u.hostname === 'trivo-pos.com' && RUTAS_TRIVO[u.pathname]) {
    const [cuerpo, cookie] = RUTAS_TRIVO[u.pathname];
    const headers = new Headers({ 'content-type': 'application/json' });
    if (cookie) headers.append('set-cookie', cookie);
    return new Response(JSON.stringify(cuerpo), { status: 200, headers });
  }
  const prod = u.hostname === 'trivo-pos.com' && u.pathname.match(/^\/api\/catalog\/products\/(\d+)\/(?:variants\/(\d+)\/)?$/);
  if (prod) {
    if (opciones?.method === 'PATCH') {
      const cuerpo = JSON.parse(opciones.body);
      preciosPrueba[prod[2] ? `${prod[1]}-${prod[2]}` : prod[1]] = Number(cuerpo.price ?? cuerpo.base_price);
      return new Response('{"success":true}', { status: 200 });
    }
    const variants = Object.entries(preciosPrueba).filter(([k]) => k.startsWith(`${prod[1]}-`)).map(([k, v]) => ({ id: Number(k.split('-')[1]), price: String(v) }));
    return new Response(JSON.stringify({ success: true, data: { id: Number(prod[1]), base_price: String(preciosPrueba[prod[1]]), variants } }), { status: 200 });
  }
  if (u.hostname === 'trivo-pos.com' && !u.pathname.startsWith('/api/public/')) return new Response('{}', { status: 404 });
  const ruta = RUTAS.find(([re]) => re.test(String(url)));
  if (!ruta) return real(url, opciones);
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
  return new Response(fixture(ruta[1]), { status: 200 });
};

console.log(`Datos de prueba en ${process.env.DATOS_DIR} · contraseña: ${process.env.APP_PASSWORD}`);
await import('../server.js');
