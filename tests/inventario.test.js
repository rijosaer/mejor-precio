import test from 'node:test';
import assert from 'node:assert/strict';
import { costoEn, inventarioDe, rotacion, ventasPorMes } from '../public/inventario.js';
import { enSilencio, limpiarConfig } from '../src/config.js';

const DIA = 24 * 60 * 60 * 1000;
const t0 = Date.UTC(2026, 9, 1, 15);
const movs = [
  { item: 'a', tipo: 'compra', cantidad: 10, precio: 40000, t: t0 },
  { item: 'a', tipo: 'venta', cantidad: 4, precio: 55000, t: t0 + DIA, costo: 40000 },
  { item: 'a', tipo: 'compra', cantidad: 6, precio: 46000, t: t0 + 2 * DIA },
  { item: 'a', tipo: 'venta', cantidad: 2, precio: 56000, t: t0 + 3 * DIA, costo: 43000 },
  { item: 'b', tipo: 'compra', cantidad: 5, precio: 10000, t: t0 },
  { item: 'b', tipo: 'ajuste', cantidad: 3, precio: 0, t: t0 + DIA },
];

test('inventario: unidades y costo promedio ponderado', () => {
  const inv = inventarioDe(movs);
  assert.equal(inv.a.unidades, 10);
  assert.equal(inv.a.costoPromedio, 43000, '(6 × 40.000 + 6 × 46.000) / 12');
  assert.equal(inv.a.vendidas, 6);
  assert.equal(inv.b.unidades, 3, 'el ajuste fija el conteo');
  assert.equal(costoEn(movs, 'a', t0 + DIA), 40000);
});

test('ventas por mes y rotación', () => {
  const [mes] = ventasPorMes(movs);
  assert.equal(mes.mes, '2026-10');
  assert.equal(mes.ingresos, 4 * 55000 + 2 * 56000);
  assert.equal(mes.ganancia, 4 * 15000 + 2 * 13000);
  const [primero] = rotacion(movs, t0 + 5 * DIA);
  assert.deepEqual([primero.item, primero.unidades], ['a', 6]);
});

test('horario de silencio en hora de Valledupar, también cruzando la medianoche', () => {
  const silencio = { activo: true, desde: 22, hasta: 7 };
  const hora = (h) => Date.UTC(2026, 9, 1, h + 5); // UTC-5
  assert.equal(enSilencio(silencio, hora(23)), true);
  assert.equal(enSilencio(silencio, hora(3)), true);
  assert.equal(enSilencio(silencio, hora(7)), false);
  assert.equal(enSilencio(silencio, hora(15)), false);
  assert.equal(enSilencio({ ...silencio, activo: false }, hora(23)), false);
  assert.equal(limpiarConfig({}).cadaHoras, 6);
});
