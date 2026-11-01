import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  coincide,
  consultaParaTienda,
  extraerMl,
  extraerUnidades,
  filtrarProductos,
  palabrasClave,
  palabrasPresentacion,
  puntuar,
  repararNombre,
} from '../src/normalizar.js';

test('lee el tamaño en ml', () => {
  assert.equal(extraerMl('Aguardiente ANTIOQUENO real amarillo (750  ml)'), 750);
  assert.equal(extraerMl('AGUARDIENTE ANTIOQUENO SIN AZUCAR 1.05L'), 1050);
  assert.equal(extraerMl('CERVEZA AGUILA ORIGINAL LATA 330MLX6U'), 330);
  assert.equal(extraerMl('CERVEZA AGUILA LIGHT LATA 330CCX6U'), 330);
  assert.equal(extraerMl('Garrafa 1.750 ml'), 1750);
  assert.equal(extraerMl('Whisky Black Label 1 Litro'), 1000);
  assert.equal(extraerMl('Aguardiente Mil Demonios'), null);
});

test('lee las unidades del empaque', () => {
  assert.equal(extraerUnidades('CERVEZA AGUILA ORIGINAL LATA 330MLX6U'), 6);
  assert.equal(extraerUnidades('Cerveza Aguila Lata X6 330ml'), 6);
  assert.equal(extraerUnidades('Cerveza Club Colombia six pack'), 6);
  assert.equal(extraerUnidades('PAGUE 11 LLEVE 12 330MLX12U'), 12);
  assert.equal(extraerUnidades('Canasta x 30 botellas'), 30);
  assert.equal(extraerUnidades('AGUARDIENTE ANTIOQUENO CAJA 1.05L'), 1);
  assert.equal(extraerUnidades('Aguardiente Antioqueño 750 ml'), 1);
});

test('repara caracteres dañados', () => {
  assert.equal(repararNombre('AGUARDIENTE ANTIOQUE�O 24�'), 'AGUARDIENTE ANTIOQUEÑO 24°');
});

test('la búsqueda en tienda va sin tamaños', () => {
  assert.equal(consultaParaTienda('aguardiente antioqueño 750 ml'), 'aguardiente antioqueño');
  assert.equal(consultaParaTienda('750'), '750');
});

test('coincide sin tildes y con el tamaño', () => {
  const p = { nombre: 'AGUARDIENTE ANTIOQUEÑO REAL AMARILLO 750ML', ml: 750 };
  assert.ok(coincide(p, palabrasClave('aguardiente antioqueno 750')));
  assert.ok(coincide(p, palabrasClave('Antioqueño real 750 ml')));
  assert.ok(!coincide(p, palabrasClave('antioqueño 375')));
  assert.ok(!coincide(p, palabrasClave('nectar')));
  const garrafa = { nombre: 'Aguardiente ANTIOQUENO verde sin azúcar garrafa (1750 ml)', ml: 1750 };
  assert.ok(!coincide(garrafa, palabrasClave('aguardiente antioqueño 750')));
  const litro = { nombre: 'Whisky Black Label Litro', ml: 1000 };
  assert.ok(coincide(litro, palabrasClave('black label 1000')));
});

test('separa las palabras de presentación de las de producto', () => {
  assert.deepEqual(palabrasPresentacion('aguardiente antioqueño 750 ml six pack'), ['pack']);
  assert.deepEqual(palabrasPresentacion('cerveza aguila lata x 6'), ['lata']);
  assert.deepEqual(palabrasPresentacion('whisky black label litro'), ['litro']);
  assert.deepEqual(palabrasPresentacion('ron santafe botella'), ['botella']);
});

test('la puntuación premia coincidencias fuertes y penaliza las débiles', () => {
  const p = { nombre: 'AGUARDIENTE ANTIOQUEÑO REAL AMARILLO 750ML', ml: 750 };
  const fuerte = puntuar(p, palabrasClave('aguardiente antioqueño 750'));
  const debil = puntuar(p, palabrasClave('aguardiente nectar'));
  assert.ok(fuerte > 0, `la búsqueda exacta debe puntuar alto y dio ${fuerte}`);
  assert.ok(debil < fuerte, 'una palabra que no aparece debe restar puntos');
});

test('filtrarProductos ordena por relevancia y descarta lo que no coincide', () => {
  const lista = [
    { nombre: 'Aguardiente Néctar 750 ml', precio: 30000, ml: 750 },
    { nombre: 'Aguardiente Antioqueño Real 750 ml', precio: 38000, ml: 750 },
    { nombre: 'Agua purificada 600 ml', precio: 3000, ml: 600 },
  ];
  const salida = filtrarProductos(lista, palabrasClave('aguardiente antioqueño'));
  assert.equal(salida.length, 2, 'el agua no debe aparecer en una búsqueda de aguardiente');
  assert.ok(salida[0].nombre.includes('Antioqueño'), 'Antioqueño debe quedar primero por relevancia');
});

test('el sinónimo acerca "cristal" a "cristalino"', () => {
  const p = { nombre: 'Ron Medellín Cristalino 750 ml', precio: 40000, ml: 750 };
  assert.ok(coincide(p, palabrasClave('cristal')));
  const puntos = puntuar(p, palabrasClave('cristal'));
  assert.ok(puntos > 0, 'el sinónimo debe sumar puntos');
});

test('reconoce un código de barras EAN/UPC', async () => {
  const { codigoBarras } = await import('../src/normalizar.js');
  assert.equal(codigoBarras('7702049002177'), '7702049002177');
  assert.equal(codigoBarras(' 7702049002177 '), '7702049002177');
  assert.equal(codigoBarras(['$x', '7702168420135']), '7702168420135');
  assert.equal(codigoBarras('aguardiente 750'), null);
  assert.equal(codigoBarras('1234567'), null);
  assert.equal(codigoBarras(null), null);
});
