import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AJUSTES_POR_DEFECTO,
  ajustes,
  claveDe,
  coordenadasDe,
  distanciaKm,
  estadoPrecio,
  guardarAjustes,
  listarAlertas,
  margen,
  registrar,
  serie,
  traslado,
  trasladoInfo,
} from '../public/datos.js';

const DIA = 24 * 60 * 60 * 1000;

function moverTiempo(desde) {
  const real = Date.now;
  let ahora = desde;
  Date.now = () => ahora;
  return {
    sumar(ms) {
      ahora += ms;
    },
    restaurar() {
      Date.now = real;
    },
  };
}

test('lee el margen neto con envío, comisión e impuestos', () => {
  const r = margen({ venta: 100000, compra: 70000, envio: 5000, comisionPct: 10, comisionFija: 0, ivaPct: 19 });
  assert.equal(r.comision, 10000);
  assert.equal(r.impuestos, 19000);
  assert.equal(r.costo, 104000);
  assert.equal(r.neto, -4000);
  assert.equal(r.pct, -4);
});

test('sin precio de venta el margen porcentual es cero', () => {
  const r = margen({ venta: 0, compra: 50000, envio: 0, comisionPct: 0, comisionFija: 0, ivaPct: 0 });
  assert.equal(r.pct, 0);
  assert.equal(r.neto, -50000);
});

test('encuentra las coordenadas en un enlace de Google Maps o en texto suelto', () => {
  assert.deepEqual(
    coordenadasDe('https://www.google.com/maps/place/Olimpica/@9.41052,-75.30127,17z/data=abc'),
    { lat: 9.41052, lng: -75.30127 },
  );
  assert.deepEqual(coordenadasDe('https://www.google.com/maps?q=9.41,-75.30'), { lat: 9.41, lng: -75.3 });
  assert.deepEqual(coordenadasDe('  9.41 , -75.30 '), { lat: 9.41, lng: -75.3 });
  assert.equal(coordenadasDe('Valledupar, Cesar'), null);
  assert.equal(coordenadasDe(''), null);
  assert.equal(coordenadasDe('@200,-75'), null);
});

test('la distancia se calcula en kilómetros y el traslado suma ida y vuelta', () => {
  assert.equal(distanciaKm(9.4, -75.3, 9.4, -75.3), 0);
  const unGrado = distanciaKm(9.4, -75.3, 10.4, -75.3);
  assert.ok(unGrado > 110 && unGrado < 112, `esperaba ~111 km y dio ${unGrado}`);

  guardarAjustes({
    logistica: {
      activo: true,
      porKm: 1000,
      tuLat: 9.4105,
      tuLng: -75.3012,
      tiendas: { makro: { lat: 9.5105, lng: -75.3012 } },
    },
    cashback: { makro: 5 },
  });
  const info = trasladoInfo('makro');
  assert.ok(info.km > 22 && info.km < 22.5, `esperaba ~22,2 km ida y vuelta y dio ${info.km}`);
  assert.equal(info.costo, Math.round(info.km * 1000));
  assert.equal(traslado('makro'), info.costo);
  assert.equal(trasladoInfo('bevgo'), null);
  assert.deepEqual(ajustes().cashback, { makro: 5 });

  guardarAjustes(AJUSTES_POR_DEFECTO);
  assert.equal(traslado('makro'), 0);
});

test('la clave de producto es estable y usa el enlace de la ficha', () => {
  const p = { nombre: ' Aguardiente Antioqueño 750 ml ', url: 'https://tienda.test/p/agu-750' };
  assert.equal(claveDe('bevgo', p), 'bevgo|https://tienda.test/p/agu-750');
  assert.equal(claveDe('bevgo', p), claveDe('bevgo', p));
  assert.equal(claveDe('makro', { nombre: 'Aguardiente Antioqueño 750 ml' }), claveDe('makro', { nombre: 'aguardiente antioqueño  750 ml' }));
});

test('guarda el histórico y avisa cuando el precio baja bajo el mínimo', () => {
  const url = `https://ejemplo.test/producto-${Date.now()}`;
  const nombre = 'Whisky de prueba 700 ml';
  const buscar = (precio) => ({
    consulta: 'whisky de prueba',
    tiendas: [{ id: 'bevgo', ok: true, productos: [{ nombre, precio, disponible: true, url }] }],
  });

  const reloj = moverTiempo(Date.now());
  try {
    const serie0 = serie(`bevgo|${url}`);
    const desde = serie0.length;

    assert.deepEqual(registrar(buscar(60000)), []);
    reloj.sumar(8 * DIA);
    assert.deepEqual(registrar(buscar(59000)), []);
    reloj.sumar(8 * DIA);
    assert.deepEqual(registrar(buscar(58000)), []);
    reloj.sumar(8 * DIA);
    const nuevas = registrar(buscar(55000));

    assert.equal(nuevas.length, 1, 'la caída del 5 % sobre el mínimo histórico debe avisar');
    const puntos = serie(`bevgo|${url}`);
    assert.equal(puntos.length, desde + 4);
    assert.deepEqual(
      puntos.map((x) => x.p),
      [60000, 59000, 58000, 55000],
    );

    const estado = estadoPrecio(`bevgo|${url}`, 55000);
    assert.equal(estado.delta, 3000);
    assert.equal(estado.esMinimo, true);

    const aviso = listarAlertas().find((a) => a.clave === `bevgo|${url}`);
    assert.ok(aviso, 'el aviso debe quedar guardado');
    assert.equal(aviso.precio, 55000);
    assert.equal(aviso.antes, 58000);
  } finally {
    reloj.restaurar();
  }
});

test('guarda un año: pasados 90 días deja un punto por semana, el más barato', () => {
  const url = `https://ejemplo.test/anual-${Date.now()}`;
  const buscar = (precio) => ({
    consulta: 'ron de prueba',
    tiendas: [{ id: 'makro', ok: true, productos: [{ nombre: 'Ron 750 ml', precio, disponible: true, url }] }],
  });
  const inicio = Date.now() - 300 * DIA;
  const reloj = moverTiempo(inicio);
  try {
    for (let d = 0; d < 300; d++) {
      registrar(buscar(50000 + (d % 7) * 100));
      reloj.sumar(DIA);
    }
    const puntos = serie(`makro|${url}`);
    const viejos = puntos.filter((x) => Date.now() - x.t > 90 * DIA);
    const recientes = puntos.filter((x) => Date.now() - x.t <= 90 * DIA);
    assert.ok(puntos[0].t - inicio < 7 * DIA, 'conserva el inicio del año');
    assert.ok(viejos.length <= 32, `esperaba ~30 puntos semanales y hubo ${viejos.length}`);
    assert.ok(recientes.length >= 89, 'los últimos 90 días quedan día por día');
    // La primera y la última semana pueden estar incompletas (bordes del rango); el último día del bucle aún no se compactó.
    assert.ok(viejos.slice(1, -2).every((x) => x.p === 50000), 'de cada semana queda el precio más bajo');
    assert.ok(puntos.length <= 200);
  } finally {
    reloj.restaurar();
  }
});

test('calcula el descuento anunciado y la posición frente al período', async () => {
  const { descuento, posicion, enRango } = await import('../public/datos.js');
  assert.equal(descuento({ precio: 75000, precioAntes: 100000 }), 25);
  assert.equal(descuento({ precio: 75000, precioAntes: null }), 0);
  assert.equal(descuento({ precio: 75000, precioAntes: 70000 }), 0);

  const ahora = Date.now();
  const puntos = [
    { t: ahora - 100 * DIA, p: 40000 },
    { t: ahora - 20 * DIA, p: 50000 },
    { t: ahora - 1 * DIA, p: 60000 },
  ];
  assert.equal(enRango(puntos, 30).length, 2);
  assert.equal(enRango(puntos).length, 3);
  const pos = posicion(puntos, 60000);
  assert.equal(pos.promedio, 50000);
  assert.equal(pos.sobreMinimo, 50);
  assert.equal(pos.sobrePromedio, 20);
  assert.equal(posicion([puntos[0]], 60000), null);
});

test('sugiere el precio de venta por margen objetivo o siguiendo al mercado', async () => {
  const { precioSugerido } = await import('../public/datos.js');
  const base = { costo: 50000, envio: 3000, comisionPct: 10, comisionFija: 0, ivaPct: 0 };
  // 53.000 / (1 − 0,10 − 0,20) = 75.714 → 75.800
  assert.deepEqual(precioSugerido({ ...base, modo: 'margen', margenPct: 20 }), { precio: 75800, piso: 58900, motivo: null });
  assert.equal(precioSugerido({ ...base, modo: 'margen', margenPct: 95 }).motivo, 'imposible');
  assert.deepEqual(precioSugerido({ ...base, modo: 'mercado', mediana: 70000, bajoPct: 2 }), { precio: 68600, piso: 58900, motivo: null });
  assert.deepEqual(precioSugerido({ ...base, modo: 'mercado', mediana: 55000 }), { precio: 58900, piso: 58900, motivo: 'mercado-bajo-costo' });
  assert.equal(precioSugerido({ ...base, modo: 'mercado' }).motivo, 'sin-mercado');
  assert.equal(precioSugerido({ costo: 0 }), null);
});
