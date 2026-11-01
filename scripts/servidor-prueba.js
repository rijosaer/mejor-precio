// Uso: npm run prueba-local
// Levanta la app con respuestas de ejemplo de cada tienda (tests/fixtures), sin
// internet y con datos en una carpeta temporal. Contraseña: "prueba".
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.APP_PASSWORD ||= 'prueba';
process.env.SESSION_SECRET ||= 'secreto-local-de-prueba';
process.env.DATOS_DIR ||= mkdtempSync(join(tmpdir(), 'mp-prueba-'));

const fixture = (nombre) => readFileSync(new URL(`../tests/fixtures/${nombre}`, import.meta.url), 'utf8');
const RUTAS = [
  [/bevgo\.com\.co\/wp-json/, 'bevgo.json'],
  [/dislicores\.com\/search\/suggest/, 'dislicores-suggest.json'],
  [/dislicores\.com\/search\?/, 'dislicores-search.html'],
  [/dislicores\.com\/products\/aguardiente-antioqueno-750\.js/, 'dislicores-ficha-750.json'],
  [/dislicores\.com\/products\/aguardiente-antioqueno-garrafa\.js/, 'dislicores-ficha-garrafa.json'],
  [/intelligent-search/, 'vtex.json'],
  [/tienda\.makro\.com\.co\/search/, 'makro.html'],
  [/trivo-pos\.com\/api/, 'aguapure.json'],
];
const real = globalThis.fetch;
globalThis.fetch = async (url, opciones) => {
  const ruta = RUTAS.find(([re]) => re.test(String(url)));
  if (!ruta) return real(url, opciones);
  await new Promise((r) => setTimeout(r, 150 + Math.random() * 400));
  return new Response(fixture(ruta[1]), { status: 200 });
};

console.log(`Datos de prueba en ${process.env.DATOS_DIR} · contraseña: ${process.env.APP_PASSWORD}`);
await import('../server.js');
