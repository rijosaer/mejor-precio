import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cambios, prediccionStock } from '../public/reglas.js';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-reglas-'));
process.env.DATOS_DIR = carpeta;
const { registrar } = await import('../src/monitor.js');
test.after(() => rm(carpeta, { recursive: true, force: true }));

const DIA = 24 * 60 * 60 * 1000;
const T = Date.UTC(2026, 9, 1);

test('predice cuántos días alcanza el stock y reinicia la cuenta al reponer', () => {
  const serie = [
    { t: T, p: 1, d: true, s: 50 },
    { t: T + DIA, p: 1, d: true, s: 40 },
    { t: T + 2 * DIA, p: 1, d: true, s: 30 },
  ];
  const r = prediccionStock(serie, T + 2 * DIA);
  assert.equal(r.actual, 30);
  assert.ok(Math.abs(r.porDia - 10) < 1e-9);
  assert.ok(Math.abs(r.dias - 3) < 1e-9);

  // Repuso: solo cuenta desde que subió el stock.
  const repuesto = [...serie, { t: T + 3 * DIA, p: 1, d: true, s: 200 }];
  assert.deepEqual(prediccionStock(repuesto, T + 3 * DIA), { actual: 200, porDia: 0, dias: null });
  assert.equal(prediccionStock([{ t: T, p: 1, d: true }], T), null);
});

test('detecta agotado, regreso, oferta nueva y últimas unidades sin repetir', () => {
  const previo = [{ t: T, p: 100, d: true, s: 40 }];
  assert.deepEqual(cambios(previo, { t: T + DIA, p: 100, d: false, s: 0 }).map((e) => e.tipo), ['agotado']);
  assert.deepEqual(cambios([{ t: T, p: 100, d: false }], { t: T + DIA, p: 100, d: true }).map((e) => e.tipo), ['volvio']);
  assert.deepEqual(
    cambios([{ t: T, p: 100, d: true }], { t: T + DIA, p: 80, d: true, a: 100 }),
    [{ tipo: 'oferta', a: 100, n: null }],
  );

  const avisado = {};
  const pocas = cambios(previo, { t: T + DIA, p: 100, d: true, s: 4 }, avisado);
  assert.deepEqual(pocas.map((e) => e.tipo), ['agota']);
  assert.equal(cambios([...previo, { t: T + DIA, p: 100, d: true, s: 4 }], { t: T + 2 * DIA, p: 100, d: true, s: 3 }, avisado).length, 0);
  // Al reponer, el aviso queda listo para la próxima vez.
  cambios([{ t: T, p: 100, d: true, s: 3 }], { t: T + DIA, p: 100, d: true, s: 90 }, avisado);
  assert.equal(avisado.agota, undefined);
});

const busqueda = (productos) => ({
  tiendas: [
    { id: 'makro', nombre: 'Makro', ok: true, productos },
    { id: 'exito', nombre: 'Éxito', ok: true, productos: [] },
    { id: 'olimpica', nombre: 'Olímpica', ok: true, productos: [] },
  ],
});
const ron = (precio, disponible = true) => ({ nombre: 'Ron 750 ml', precio, disponible, url: 'https://t.test/ron-umbral', ml: 750 });

test('avisa una sola vez cuando llega al precio objetivo y cuando nadie lo tiene', async () => {
  const item = { id: 'u1', q: 'ron 750', umbral: 50000 };
  assert.deepEqual((await registrar(item, busqueda([ron(52000)]), { ahora: T })).map((a) => a.tipo), []);
  const llego = await registrar(item, busqueda([ron(49000)]), { ahora: T + DIA });
  assert.deepEqual(llego.map((a) => a.tipo), ['umbral']);
  assert.equal(llego[0].precio, 49000);
  assert.equal(llego[0].q, 'ron 750');
  assert.deepEqual((await registrar(item, busqueda([ron(49000)]), { ahora: T + 2 * DIA })).map((a) => a.tipo), []);
  assert.deepEqual((await registrar(item, busqueda([ron(47000)]), { ahora: T + 3 * DIA })).map((a) => a.tipo), ['umbral']);

  const agotado = await registrar(item, busqueda([ron(47000, false)]), { ahora: T + 4 * DIA });
  assert.deepEqual(agotado.map((a) => a.tipo).sort(), ['agotado', 'sinstock']);
  assert.deepEqual((await registrar(item, busqueda([ron(47000, false)]), { ahora: T + 5 * DIA })).map((a) => a.tipo), []);
  assert.deepEqual((await registrar(item, busqueda([ron(47000)]), { ahora: T + 6 * DIA })).map((a) => a.tipo).sort(), ['umbral', 'volvio']);
});

test('el precio objetivo no se activa con otra presentación más barata', async () => {
  const item = { id: 'u2', q: 'ron 750', umbral: 30000 };
  const media = { nombre: 'Ron media 375 ml', precio: 15000, disponible: true, url: 'https://t.test/ron-375', ml: 375 };
  const avisos = await registrar(item, busqueda([ron(52000), media]), { ahora: T });
  assert.deepEqual(avisos.filter((a) => a.tipo === 'umbral'), []);
});

test('el resumen del mercado toma la presentación que más tiendas comparan', async () => {
  const { novedades, guardarLista } = await import('../src/monitor.js');
  await guardarLista([{ id: 'r1', q: 'ron 750' }]);
  const datos = {
    tiendas: [
      { id: 'makro', nombre: 'Makro', ok: true, productos: [ron(50000), { ...ron(30000), url: 'https://t.test/otro', ml: 375, nombre: 'Ron 375 ml 750' }] },
      { id: 'exito', nombre: 'Éxito', ok: true, productos: [{ ...ron(54000), url: 'https://t.test/e' }] },
      { id: 'olimpica', nombre: 'Olímpica', ok: true, productos: [{ ...ron(58000), url: 'https://t.test/o' }, { ...ron(40000, false), url: 'https://t.test/o2' }] },
    ],
  };
  await registrar({ id: 'r1', q: 'ron 750' }, datos, { ahora: T });
  const { resumenes } = await novedades(0);
  const r = resumenes.r1;
  assert.equal(r.ml, 750);
  assert.deepEqual(r.ofertas.map((o) => [o.tienda, o.precio]), [['makro', 50000], ['exito', 54000], ['olimpica', 58000]]);
  assert.equal(r.mediana, 54000);
});
