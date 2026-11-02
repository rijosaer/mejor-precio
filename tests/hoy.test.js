// «Hoy»: lo que pide atención junto y el historial de avisos con lo que se hizo.
import test from 'node:test';
import assert from 'node:assert/strict';

const { resumirTienda, conDesenlace } = await import('../src/hoy.js');

test('Hoy: la plata que se pierde, lo que hay que pedir y el inventario en negativo', () => {
  const estado = {
    productos: [
      { id: '1', nombre: 'Caja Miller + Hielo', precio: 35000, trivo: { fuente: 'calculado', costo: 43000, bajoCosto: true, ventas: { unidades: 3 } } },
      { id: '2', nombre: 'Miller x 24', precio: 38000, trivo: { fuente: 'calculado', costo: 42000, bajoCosto: true, ventas: { unidades: 10 } } },
      { id: '3', nombre: 'Aguila Fria', precio: 3500, trivo: { fuente: 'directo', costo: 2000, bajo: true, existencias: -14, minimo: 10, ventas: { unidades: 90 } } },
      { id: '4', nombre: 'Poker', precio: 3000, trivo: { fuente: 'directo', costo: 2000, bajo: true, existencias: 2, minimo: 10, ventas: { unidades: 5 } } },
      { id: '5', nombre: 'Hielo', precio: 5000, trivo: { fuente: 'directo', costo: 1500, bajo: false, existencias: 20 } },
    ],
    propuestas: [{ id: '1' }, { id: '2' }],
    trivo: { t: 1, dias: 30, error: null },
  };
  const r = resumirTienda(estado);
  assert.deepEqual(r.bajoCosto.map((x) => [x.id, x.pierde, x.perdida]), [['2', 4000, 40000], ['1', 8000, 24000]], 'primero lo que más plata se lleva en el mes');
  assert.equal(r.perdida30, 64000);
  assert.deepEqual(r.porPedir.map((x) => x.id), ['3', '4']);
  assert.deepEqual(r.negativos, [{ id: '3', nombre: 'Aguila Fria', existencias: -14 }]);
  assert.equal(r.propuestas, 2);
});

test('historial de avisos: cada precio dice si se aplicó (y por dónde), se descartó o espera', () => {
  const historial = [
    { t: 100, avisos: [{ tipo: 'precio-compra', title: 'Compra', propuestas: ['1', '2', '3'] }, { tipo: 'agotado', title: 'Se agotó' }] },
    { t: 150, respuesta: { orden: '1', texto: '✅ Aguila' } },
  ];
  const cambios = [{ producto: '1', t: 120, via: 'whatsapp', motivo: 'compra', nombre: 'Aguila', despues: 3300 }, { producto: '2', t: 50, motivo: 'compra' }];
  const [h, r] = conDesenlace(historial, [{ id: '3' }], cambios);
  assert.deepEqual(h.avisos[0].desenlaces.map((d) => [d.id, d.estado, d.via]), [['1', 'aplicado', 'whatsapp'], ['2', 'descartado', undefined], ['3', 'pendiente', undefined]]);
  assert.equal(h.avisos[1].desenlaces, undefined);
  assert.equal(r.respuesta.orden, '1');
});
