import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { VERSIONES, VERSION_ACTUAL, versionesNuevas } from '../public/novedades.js';

test('cada versión tiene número, fecha, título y cambios, de la más nueva a la más vieja', () => {
  const numeros = VERSIONES.map((v) => v.version);
  assert.equal(new Set(numeros).size, numeros.length, 'no se repiten versiones');
  for (const v of VERSIONES) {
    assert.match(v.version, /^\d+\.\d+(\.\d+)?$/);
    assert.match(v.fecha, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(v.titulo && v.cambios.length);
    for (const c of v.cambios) assert.ok(c.titulo && c.ahora, `${v.version}: cada cambio dice qué hay ahora`);
  }
  const fechas = VERSIONES.map((v) => v.fecha);
  assert.deepEqual(fechas, [...fechas].sort().reverse());
});

test('el service worker cambia de versión con cada actualización', async () => {
  const sw = await readFile(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, new RegExp(`const VERSION = 'mp-${VERSION_ACTUAL.replace('.', '\\.')}'`), 'actualiza VERSION en public/sw.js');
  assert.match(sw, /'novedades\.js'/);
});

test('versiones que un dispositivo no ha visto', () => {
  assert.deepEqual(versionesNuevas(null).map((v) => v.version), [VERSION_ACTUAL], 'dispositivo nuevo: solo la última');
  assert.deepEqual(versionesNuevas(VERSION_ACTUAL), [], 'ya la vio');
  assert.deepEqual(versionesNuevas('1.0').map((v) => v.version), VERSIONES.slice(0, VERSIONES.findIndex((v) => v.version === '1.0')).map((v) => v.version));
  assert.deepEqual(versionesNuevas('0.1').map((v) => v.version), [VERSION_ACTUAL], 'una versión desconocida muestra la última');
});

test('las listas predeterminadas son búsquedas válidas y sin repetir', async () => {
  const { LISTAS, faltantes } = await import('../public/listas-sugeridas.js');
  for (const lista of LISTAS) {
    const qs = lista.productos.map((p) => p.q);
    assert.equal(new Set(qs).size, qs.length, `${lista.nombre}: sin repetidos`);
    for (const p of lista.productos) {
      assert.ok(p.q.length >= 2 && p.q.length <= 80 && p.corto);
      assert.match(p.q, /\d{3}/, `${p.q}: lleva el tamaño para comparar la misma presentación`);
    }
  }
  const cervezas = LISTAS[0];
  assert.equal(faltantes(cervezas, [{ q: 'Cerveza Águila 330' }]).length, cervezas.productos.length - 1, 'reconoce lo que ya está aunque cambien tildes y mayúsculas');
});
