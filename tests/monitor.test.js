import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-monitor-'));
process.env.DATOS_DIR = carpeta;
const { guardarLista, leerLista, novedades, registrar } = await import('../src/monitor.js');
const { fusionarServidor, listarAlertas, serie } = await import('../public/datos.js');

const DIA = 24 * 60 * 60 * 1000;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const busqueda = (precio, extra = {}) => ({
  tiendas: [
    {
      id: 'makro',
      nombre: 'Makro',
      ok: true,
      productos: [{ nombre: 'Ron de prueba 750 ml', precio, disponible: true, url: 'https://t.test/ron', ml: 750, unidades: 1, ...extra }],
    },
    { id: 'bevgo', nombre: 'Bevgo', ok: false, productos: [] },
  ],
});

test('la lista se limpia y valida antes de guardarse', async () => {
  const lista = await guardarLista([
    { id: 'a1', q: '  ron   de prueba 750 ', umbral: '45000' },
    { id: 'a1', q: 'repetido' },
    { id: 'mal id!', q: 'x' },
    { id: 'b2', q: 'cerveza aguila', umbral: -3, vendo: 1, venta: '62000', modo: 'mercado', bajoMercado: 2, extra: 'x' },
  ]);
  const sinVenta = { vendo: false, venta: null, modo: 'margen', margen: null, bajoMercado: null, stockMinimo: null };
  assert.deepEqual(lista, [
    { id: 'a1', q: 'ron de prueba 750', umbral: 45000, ...sinVenta },
    { id: 'b2', q: 'cerveza aguila', umbral: null, vendo: true, venta: 62000, modo: 'mercado', margen: null, bajoMercado: 2, stockMinimo: null },
  ]);
  assert.deepEqual(await leerLista(), lista);
  await assert.rejects(guardarLista('nada'), TypeError);
});

test('el monitoreo guarda el historial, avisa el punto dulce y entrega solo lo nuevo', async () => {
  const item = { id: 'a1', q: 'ron de prueba 750' };
  const inicio = Date.now() - 30 * DIA;
  for (const [dia, precio] of [[0, 60000], [8, 59000], [16, 58000]]) {
    assert.deepEqual(await registrar(item, busqueda(precio, { stock: 40 - dia }), { ahora: inicio + dia * DIA }), []);
  }
  const avisos = await registrar(item, busqueda(55000, { stock: 12, precioAntes: 60000 }), { ahora: inicio + 24 * DIA });
  assert.deepEqual(avisos.map((a) => a.tipo), ['dulce', 'oferta']);
  assert.equal(avisos[0].antes, 58000);

  const todo = await novedades(0);
  const puntos = todo.series['makro|https://t.test/ron'];
  assert.deepEqual(puntos.map((x) => x.p), [60000, 59000, 58000, 55000]);
  assert.equal(puntos[3].s, 12);
  assert.equal(puntos[3].a, 60000);
  assert.equal(todo.alertas.length, 2);
  assert.equal(todo.revisado.a1, inicio + 24 * DIA);

  const despues = await novedades(inicio + 20 * DIA);
  assert.equal(despues.series['makro|https://t.test/ron'].length, 1);

  // El navegador funde lo del servidor con lo suyo y recibe el aviso.
  assert.equal(fusionarServidor(todo), 2);
  assert.deepEqual(serie('makro|https://t.test/ron').map((x) => x.p), [60000, 59000, 58000, 55000]);
  assert.ok(listarAlertas().some((a) => a.id === 'dulce|makro|https://t.test/ron'));
  // Fundir dos veces lo mismo no duplica nada.
  assert.equal(fusionarServidor(todo), 0);
  assert.equal(serie('makro|https://t.test/ron').length, 4);
});

test('quitar un producto de la lista borra su historial del servidor', async () => {
  await guardarLista([{ id: 'b2', q: 'cerveza aguila' }]);
  const todo = await novedades(0);
  assert.equal(todo.series['makro|https://t.test/ron'], undefined);
});

test('dos registros en paralelo de productos distintos no se pisan los avisos', async () => {
  const { leer } = await import('../src/almacen.js');
  await guardarLista([{ id: 'p1', q: 'ron de prueba 750' }, { id: 'p2', q: 'ron de prueba 750 bis' }]);
  const inicio = Date.now() - 30 * DIA;
  for (const id of ['p1', 'p2']) {
    for (const [dia, precio] of [[0, 60000], [8, 59000], [16, 58000]]) await registrar({ id, q: 'ron de prueba 750' }, busqueda(precio), { ahora: inicio + dia * DIA });
  }
  await Promise.all(['p1', 'p2'].map((id) => registrar({ id, q: 'ron de prueba 750' }, busqueda(50000), { ahora: inicio + 24 * DIA })));
  assert.equal((await leer('alertas/p1')).length, 1);
  assert.equal((await leer('alertas/p2')).length, 1);
  const todo = await novedades(0);
  assert.equal(todo.alertas.length, 2);
});

test('las alertas del formato viejo se reparten por producto', async () => {
  const { escribir, leer } = await import('../src/almacen.js');
  const { migrar } = await import('../src/monitor.js');
  // migrar() corre una sola vez por proceso y ya corrió: se prueba en un proceso nuevo.
  await escribir('alertas', [{ tipo: 'dulce', clave: 'x', item: 'p1', t: 1 }]);
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['--input-type=module', '-e', "const m = await import('./src/monitor.js'); await m.migrar();"], {
    env: { ...process.env, DATOS_DIR: carpeta },
  });
  assert.equal(await leer('alertas'), null);
  assert.ok((await leer('alertas/p1')).some((a) => a.clave === 'x'));
  assert.equal(typeof migrar, 'function');
});

test('el resumen semanal compara el más barato de hoy con el de hace una semana', async () => {
  const { cambiosDeLaSemana } = await import('../src/monitor.js');
  const ahora = Date.now();
  const doc = (q, antes, hoy) => ({ q, productos: { a: { puntos: [{ t: ahora - 7 * DIA, p: antes, d: true }, { t: ahora - DIA, p: hoy, d: true }] } } });
  const filas = cambiosDeLaSemana([doc('ron', 50000, 45000), doc('vino', 30000, 33000), doc('igual', 1000, 1000)], ahora);
  assert.deepEqual(filas.map((f) => [f.q, Math.round(f.pct)]), [['ron', -10], ['vino', 10]]);
});

test('la búsqueda a mano también guarda historial en el servidor', async () => {
  const { registrarBusqueda } = await import('../src/monitor.js');
  const datos = busqueda(61000);
  const ahora = Date.now();
  await registrarBusqueda('ron de otra cosa', datos, { ahora: ahora - 2 * DIA });
  const series = await registrarBusqueda('Ron de otra  cosa', busqueda(60000), { ahora });
  assert.deepEqual(series['makro|https://t.test/ron'].map((x) => x.p), [61000, 60000]);
});
