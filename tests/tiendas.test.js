// Cada tienda con una respuesta guardada (tests/fixtures): si una tienda cambia
// su formato, se actualiza el fixture y este test dice qué dejó de leerse.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-tiendas-'));
process.env.DATOS_DIR = carpeta;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const fixture = (nombre) => readFile(new URL(`./fixtures/${nombre}`, import.meta.url), 'utf8');

// fetch falso: responde según la URL y cuenta las llamadas.
const llamadas = [];
let caidas = new Set();
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
globalThis.fetch = async (url) => {
  const texto = String(url);
  llamadas.push(texto);
  const ruta = RUTAS.find(([re]) => re.test(texto));
  if (!ruta || [...caidas].some((c) => texto.includes(c))) return new Response('no', { status: 404 });
  return new Response(await fixture(ruta[1]), { status: 200 });
};

const bevgo = await import('../src/tiendas/bevgo.js');
const dislicores = await import('../src/tiendas/dislicores.js');
const exito = await import('../src/tiendas/exito.js');
const olimpica = await import('../src/tiendas/olimpica.js');
const makro = await import('../src/tiendas/makro.js');
const aguapure = await import('../src/tiendas/aguapure.js');
const carulla = await import('../src/tiendas/carulla.js');
const { comparar, limpiarCache, elegirTiendas, POR_DEFECTO } = await import('../src/comparador.js');

test('Bevgo: precio en centavos, oferta, stock bajo y agotado', async () => {
  const [a, b] = await bevgo.buscar('aguardiente');
  assert.equal(a.nombre, 'Aguardiente Antioqueño Tapa Roja 750 ml');
  assert.equal(a.precio, 45900);
  assert.equal(a.precioAntes, 49900);
  assert.equal(a.ml, 750);
  assert.equal(a.stock, 4);
  assert.equal(b.unidades, 6);
  assert.equal(b.disponible, false);
});

test('Dislicores: fichas de la búsqueda predictiva y de la página de resultados', async () => {
  const productos = await dislicores.buscar('aguardiente antioqueño');
  const nombres = productos.map((p) => p.nombre);
  assert.deepEqual(nombres, ['Aguardiente Antioqueño 750 ml', 'Aguardiente Antioqueño Media 375 ml', 'Aguardiente Antioqueño Garrafa 1750 ml']);
  const [ficha, sinFicha, garrafa] = productos;
  assert.equal(ficha.precio, 46900);
  assert.equal(ficha.precioAntes, 49900);
  assert.equal(ficha.ean, '7702049002177');
  assert.equal(ficha.url, 'https://dislicores.com/products/aguardiente-antioqueno-750?variant=11');
  assert.equal(sinFicha.ml, 375, 'sin ficha se usa lo que trae la búsqueda');
  assert.equal(garrafa.ml, 1750, 'la garrafa llega solo por la página de resultados');
  assert.equal(garrafa.disponible, false);
  assert.deepEqual(dislicores.handlesDeBusqueda('<a href="/products/a-b">'), ['a-b']);
});

test('Éxito: prefiere el vendedor Éxito con existencias y lee el EAN de una lista', async () => {
  const [a, b] = await exito.buscar('aguardiente');
  assert.equal(a.precio, 45500);
  assert.equal(a.precioAntes, 52000);
  assert.equal(a.stock, 37);
  assert.equal(b.stock, null, '10000 significa que VTEX no publica el inventario');
});

test('Olímpica y Carulla (VTEX): nombre con el tamaño del item', async () => {
  for (const tienda of [olimpica, carulla]) {
    const productos = await tienda.buscar('aguardiente');
    assert.equal(productos.length, 2, 'el producto sin precio se descarta');
    assert.equal(productos[1].nombre, 'Garrafa 1750 ml');
    assert.equal(productos[1].ml, 1750);
    assert.equal(productos[1].ean, '7702049002245');
  }
  assert.equal(carulla.tienda.porDefecto, false, 'Carulla viene apagada');
});

test('Makro: fragmentos de Next.js, promoción por unidad y por cantidad, EAN pegado al HTML', async () => {
  const [a, b] = await makro.buscar('aguardiente');
  assert.equal(a.nombre, 'AGUARDIENTE ANTIOQUEÑO 750ML');
  assert.equal(a.precio, 43900);
  assert.equal(a.precioAntes, 47000);
  assert.equal(a.ean, '7702049002177');
  assert.equal(a.imagen, 'https://makro.example/foto-a1.jpg');
  assert.equal(b.ml, 330, '1980 ml en total ÷ 6 latas');
  assert.equal(b.precio, 19900, 'la oferta exige llevar 3: va como nota');
  assert.match(b.nota, /llevando 3/);
  assert.equal(b.disponible, false, 'sin stock no está disponible');
});

test('Agua Pure: filtra la carta, promociones, variantes y cajas de 24', async () => {
  const cervezas = await aguapure.buscar('cerveza aguila');
  assert.deepEqual(cervezas.map((p) => [p.precio, p.ml, p.unidades]), [[3500, 330, 1], [69000, 330, 24], [85000, 330, 24]]);
  const [, , variante] = await aguapure.buscar('antioqueño');
  assert.equal(variante, undefined);
  const aguardiente = await aguapure.buscar('antioqueño');
  assert.deepEqual(aguardiente.map((p) => p.nombre), ['Aguardiente Antioqueño 750ml Tapa azul']);
});

test('el comparador une las tiendas, completa datos y guarda caché por tienda', async () => {
  limpiarCache();
  llamadas.length = 0;
  const datos = await comparar('aguardiente antioqueño 750');
  assert.deepEqual(datos.tiendas.map((t) => t.id), POR_DEFECTO);
  const exitoR = datos.tiendas.find((t) => t.id === 'exito');
  assert.ok(exitoR.ok);
  const p = exitoR.productos[0];
  assert.equal(p.imagen, 'https://exito.vteximg.com.br/arquivos/ids/1234-240-240/antioqueno.jpg');
  assert.equal(p.imagenGrande, 'https://exito.vteximg.com.br/arquivos/ids/1234/antioqueno.jpg');
  assert.ok(p.firma);
  const antes = llamadas.length;
  await comparar('aguardiente antioqueño 750');
  assert.equal(llamadas.length, antes, 'la segunda búsqueda sale de la caché');
});

test('si una tienda falla, las demás quedan en caché y solo esa se reintenta', async () => {
  limpiarCache();
  caidas = new Set(['bevgo.com.co']);
  const primera = await comparar('cerveza aguila');
  assert.equal(primera.tiendas.find((t) => t.id === 'bevgo').ok, false);
  caidas = new Set();
  llamadas.length = 0;
  const segunda = await comparar('cerveza aguila');
  assert.ok(segunda.tiendas.every((t) => t.ok));
  assert.deepEqual(llamadas.map((u) => new URL(u).hostname), ['bevgo.com.co']);
});

test('se pueden elegir las tiendas; un pedido vacío o desconocido usa las de siempre', async () => {
  limpiarCache();
  const datos = await comparar('aguila', { tiendas: ['makro', 'carulla', 'nada'] });
  assert.deepEqual(datos.tiendas.map((t) => t.id), ['makro', 'carulla']);
  assert.deepEqual(elegirTiendas(['nada']).map((m) => m.tienda.id), POR_DEFECTO);
});

test('código de barras: exacto donde lo indexan, por nombre y tamaño en las demás', async () => {
  limpiarCache();
  const datos = await comparar('7702049002177');
  assert.equal(datos.codigo, '7702049002177');
  const exitoR = datos.tiendas.find((t) => t.id === 'exito');
  assert.deepEqual(exitoR.productos.map((p) => p.ean), ['7702049002177']);
  const bevgoR = datos.tiendas.find((t) => t.id === 'bevgo');
  assert.ok(bevgoR.buscadoComo);
  assert.ok(bevgoR.productos.every((p) => p.ml === 750 && p.porNombre));
});

test('un error de conexión se explica en palabras', async () => {
  limpiarCache();
  const real = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new TypeError('fetch failed');
  };
  try {
    const datos = await comparar('aguila', { tiendas: ['bevgo'] });
    assert.equal(datos.tiendas[0].error, 'No se pudo conectar con la tienda');
  } finally {
    globalThis.fetch = real;
  }
});
