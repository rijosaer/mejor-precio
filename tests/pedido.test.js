import test from 'node:test';
import assert from 'node:assert/strict';
import { optimizarPedido } from '../public/optimizar.js';
import { leerCsv, productosDeCsv, productosDeTexto, escribirCsv } from '../public/csv.js';

const oferta = (tienda, precio, disponible = true) => ({ tienda, tiendaNombre: tienda.toUpperCase(), precio, disponible });

test('el pedido reparte entre tiendas cuando el ahorro paga el envío', () => {
  const items = [
    { id: 'a', nombre: 'A', cantidad: 2, ofertas: [oferta('x', 10000), oferta('y', 14000)] },
    { id: 'b', nombre: 'B', cantidad: 1, ofertas: [oferta('x', 30000), oferta('y', 20000)] },
  ];
  const r = optimizarPedido(items, () => 3000);
  assert.equal(r.plan.tiendas.length, 2, 'X para A y Y para B');
  assert.equal(r.plan.total, 2 * 10000 + 20000 + 6000);
  assert.equal(r.unaTienda.total, 2 * 14000 + 20000 + 3000);
  assert.equal(r.ahorro, 51000 - 46000);
});

test('con envío caro conviene una sola tienda', () => {
  const items = [
    { id: 'a', nombre: 'A', cantidad: 1, ofertas: [oferta('x', 10000), oferta('y', 11000)] },
    { id: 'b', nombre: 'B', cantidad: 1, ofertas: [oferta('x', 21000), oferta('y', 20000)] },
  ];
  const r = optimizarPedido(items, () => 8000);
  assert.equal(r.plan.tiendas.length, 1);
  assert.equal(r.plan.total, 31000 + 8000);
});

test('respeta el pedido mínimo, el envío gratis y lo agotado', () => {
  // x exige 20.000 de pedido mínimo; y regala el envío desde 55.000; w cobra 3.000.
  const llegada = (t, subtotal) => {
    if (t === 'x') return subtotal < 20000 ? null : 2000;
    if (t === 'y') return subtotal >= 55000 ? 0 : 4000;
    return 3000;
  };
  const items = [
    { id: 'a', nombre: 'A', cantidad: 1, ofertas: [oferta('x', 10000), oferta('w', 12000), oferta('y', 9000, false)] },
    { id: 'b', nombre: 'B', cantidad: 1, ofertas: [oferta('y', 50000)] },
    { id: 'c', nombre: 'C', cantidad: 1, ofertas: [oferta('z', 1, false)] },
  ];
  const r = optimizarPedido(items, llegada);
  assert.deepEqual(r.plan.tiendas.map((t) => t.tienda).sort(), ['w', 'y'], 'x no alcanza el mínimo y en y la A está agotada');
  assert.equal(r.plan.total, 12000 + 3000 + 50000 + 4000);
  assert.deepEqual(r.sinOferta.map((x) => x.id), ['c']);

  items[0].ofertas[2].disponible = true;
  const conGratis = optimizarPedido(items, llegada);
  assert.deepEqual(conGratis.plan.tiendas.map((t) => t.tienda), ['y'], 'todo en y llega al envío gratis');
  assert.equal(conGratis.plan.total, 59000);
});

test('sin combinación posible no hay plan', () => {
  const r = optimizarPedido([{ id: 'a', nombre: 'A', cantidad: 1, ofertas: [oferta('x', 1000)] }], () => null);
  assert.equal(r.plan, null);
});

test('CSV de Excel en español, con comillas y encabezados con tildes', () => {
  const texto = '\uFEFFProducto;Precio;Tamaño;Código de barras\r\n"Ron ""Viejo"" de Caldas";45.900;750;7702049002177\r\nAgua;;600;\r\n';
  assert.deepEqual(leerCsv('a,b\n"c,d",e'), [['a', 'b'], ['c,d', 'e']]);
  const { productos, conCabeza } = productosDeCsv(texto);
  assert.ok(conCabeza);
  assert.deepEqual(productos, [{ nombre: 'Ron "Viejo" de Caldas', precio: '45.900', ml: '750', ean: '7702049002177' }]);
  const sinCabeza = productosDeCsv('Aguila lata,2900\nPoker lata,2700');
  assert.equal(sinCabeza.productos.length, 2);
  assert.equal(escribirCsv([['a;b', 1]]), '\uFEFF"a;b";1');
});

test('lista de precios pegada desde WhatsApp', () => {
  const texto = `*LISTA DE PRECIOS*
- Antioqueño 750 ml ..... $41.500
• Aguila lata x24: 62.000
3) Old Parr 12 años 750 = $ 129900
1800 Reposado 120.000
Pregunta por domicilios`;
  const { productos } = productosDeTexto(texto);
  assert.deepEqual(productos, [
    { nombre: 'Antioqueño 750 ml', precio: '41.500' },
    { nombre: 'Aguila lata x24', precio: '62.000' },
    { nombre: 'Old Parr 12 años 750', precio: '129900' },
    { nombre: '1800 Reposado', precio: '120.000' },
  ]);
  assert.equal(productosDeTexto('Ron\t45000\nVino\t30000').productos.length, 2, 'pegado desde Excel');
});

test('mismo producto: código de barras y firma se unen entre tiendas', async () => {
  const { productosIguales } = await import('../public/resultados.js');
  const datos = {
    tiendas: [
      { id: 'makro', productos: [{ ean: '1', firma: 'antioqueno|750|1|' }] },
      { id: 'exito', productos: [{ ean: '1', firma: 'antioqueno|750|1|29' }] },
      { id: 'bevgo', productos: [{ ean: null, firma: 'antioqueno|750|1|29' }] },
      { id: 'olimpica', productos: [{ ean: null, firma: 'otro|750|1|' }] },
    ],
  };
  const iguales = productosIguales(datos);
  assert.equal(iguales.get('ean:1').size, 3);
  assert.equal(iguales.get('firma:antioqueno|750|1|29').size, 3);
  assert.equal(iguales.get('firma:otro|750|1|').size, 1);
});

test('los productos importados quedan con precio, tamaño y unidades en números', async () => {
  const { normalizarProducto, numeroDe } = await import('../public/csv.js');
  assert.equal(numeroDe('$ 41.500'), 41500);
  assert.equal(numeroDe('45900.5'), 45900.5);
  assert.equal(numeroDe('abc'), null);
  assert.deepEqual(normalizarProducto({ nombre: 'Aguila lata 330 ml x24', precio: '62.000' }), { nombre: 'Aguila lata 330 ml x24', precio: 62000, ml: 330, unidades: 24, disponible: true });
  assert.equal(normalizarProducto({ nombre: 'Whisky 1 litro', precio: '1', disponible: 'no' }).disponible, false);
  assert.equal(normalizarProducto({ nombre: 'Whisky 1 litro', precio: '1' }).ml, 1000);
});
