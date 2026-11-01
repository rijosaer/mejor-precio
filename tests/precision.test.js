// Tabla de búsquedas reales: qué debe aparecer y qué no. Cada cambio en la
// búsqueda tiene que seguir cumpliéndola.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  distancia,
  extraerGrados,
  filtrarProductos,
  firmaProducto,
  marcarVariantes,
  miniatura,
  palabrasClave,
  sugerirConsulta,
} from '../src/normalizar.js';
import { extraerMl, extraerUnidades } from '../src/normalizar.js';

const producto = (nombre, precio = 50000) => ({ nombre, precio, ml: extraerMl(nombre), unidades: extraerUnidades(nombre) });

const CASOS = [
  {
    q: 'whisky johnnie walker black',
    si: ['Whisky Johnnie Walker Black Label 750 ml', 'JOHNNIE WALKER BLACK LABEL 12 AÑOS 1000ML', 'Whisky Jhonnie Walker Black Label 700ml'],
    no: ['Whisky Johnnie Walker Red Label 750 ml', 'Whisky Old Parr 12 años 750 ml'],
  },
  {
    q: 'ron medellin',
    si: ['Ron Medellín Añejo 3 años 750 ml', 'RON MEDELLIN EXTRA ANEJO 8 AÑOS 750ML'],
    no: ['Jugo de toronja 1 litro', 'Aguardiente Antioqueño 750 ml', 'Ron Viejo de Caldas 750 ml'],
  },
  {
    q: 'aguardiente antioqueño 750',
    si: ['AGUARDIENTE ANTIOQUEÑO 750ML', 'Aguardiente Antioqueno Tapa Azul Sin Azúcar 750 ml', 'AGUARDIENT ANTIOQ 750ML'],
    no: ['Aguardiente Antioqueño Garrafa 1750 ml', 'Aguardiente Néctar 750 ml', 'Aguardiente Antioqueño 375 ml'],
  },
  {
    q: 'cerveza aguila six pack',
    si: ['Cerveza Águila Lata 330 ml x6', 'CERVEZA AGUILA ORIGINAL LATA 330MLX6U'],
    no: ['Cerveza Club Colombia Dorada x6 330 ml'],
  },
  {
    q: 'buchanans 12',
    si: ["Whisky Buchanan's Deluxe 12 años 750 ml"],
    no: ['Whisky Old Parr 12 años 750 ml'],
  },
  {
    q: 'old parr',
    si: ['Whisky Old Parr 12 Años 750ml'],
    no: ['Parrilla eléctrica', 'Whisky Buchanans 750 ml'],
  },
  {
    q: 'tequila jose cuervo',
    si: ['Tequila José Cuervo Especial Reposado 750 ml', 'TEQ JOSE CUERVO ESPECIAL 750ML'],
    no: ['Tequila Don Julio 750 ml'],
  },
  {
    q: 'vino gato negro',
    si: ['Vino Tinto Gato Negro Cabernet Sauvignon 750 ml'],
    no: ['Vino Casillero del Diablo 750 ml'],
  },
  {
    q: 'cristal',
    si: ['Ron Medellín Cristalino 750 ml'],
    no: ['Copa de cristal'.replace('cristal', 'vidrio')],
  },
];

for (const caso of CASOS) {
  test(`búsqueda «${caso.q}»`, () => {
    const palabras = palabrasClave(caso.q);
    const productos = [...caso.si, ...caso.no].map((n) => producto(n));
    const salida = filtrarProductos(productos, palabras).map((p) => p.nombre);
    for (const n of caso.si) assert.ok(salida.includes(n), `debe aparecer: ${n}`);
    for (const n of caso.no) assert.ok(!salida.includes(n), `no debe aparecer: ${n}`);
  });
}

test('"ron" no encuentra palabras que solo lo contienen', () => {
  const salida = filtrarProductos([producto('Jugo Hit Toronja 1 L'), producto('Ron Viejo de Caldas 750 ml')], palabrasClave('ron'));
  assert.deepEqual(salida.map((p) => p.nombre), ['Ron Viejo de Caldas 750 ml']);
});

test('las variantes que no se pidieron se marcan y quedan al final', () => {
  const resultados = [
    { productos: [producto('Gaseosa Coca Cola 1.5 L', 6000), producto('Gaseosa Coca Cola Zero 1.5 L', 5500)] },
    { productos: [producto('Coca-Cola Sin Azúcar 1.5 L', 5000)] },
  ];
  const palabras = palabrasClave('coca cola');
  resultados[0].productos = filtrarProductos(resultados[0].productos, palabras);
  marcarVariantes(resultados, palabras);
  const [normal, zero] = resultados[0].productos;
  assert.equal(normal.nombre, 'Gaseosa Coca Cola 1.5 L', 'la normal va primero aunque la Zero sea más barata');
  assert.equal(normal.otraVariante, undefined);
  assert.equal(zero.variante, 'Zero');
  assert.ok(zero.otraVariante);
  assert.ok(resultados[1].productos[0].otraVariante, 'se marca en todas las tiendas');
});

test('si se pide la variante, no se oculta', () => {
  const resultados = [{ productos: [producto('Gaseosa Coca Cola Zero 1.5 L'), producto('Gaseosa Coca Cola 1.5 L')] }];
  const palabras = palabrasClave('coca cola zero');
  resultados[0].productos = filtrarProductos(resultados[0].productos, palabras);
  marcarVariantes(resultados, palabras);
  assert.deepEqual(resultados[0].productos.map((p) => p.nombre), ['Gaseosa Coca Cola Zero 1.5 L']);
  assert.equal(resultados[0].productos[0].otraVariante, undefined);
});

test('cuando todas son variantes (las etiquetas de Johnnie Walker) no se oculta ninguna', () => {
  const resultados = [{ productos: [producto('Johnnie Walker Red Label 750 ml'), producto('Johnnie Walker Black Label Reserva 750 ml')] }];
  // "Reserva" es variante, pero Red Label no tiene ninguna: Black Reserva sí se oculta.
  marcarVariantes(resultados, palabrasClave('johnnie walker'));
  assert.equal(resultados[0].productos[0].otraVariante, undefined);
  assert.ok(resultados[0].productos[1].otraVariante);
  const sabores = [{ productos: [producto('Smirnoff Ice Limón 275 ml'), producto('Smirnoff Ice Mango 275 ml')] }];
  marcarVariantes(sabores, palabrasClave('smirnoff ice'));
  assert.ok(sabores[0].productos.every((p) => !p.otraVariante), 'todas tienen sabor: ninguna es «la normal»');
});

test('¿quisiste decir?: corrige con los nombres que devolvieron las tiendas', () => {
  const nombres = ["Whisky Buchanan's Deluxe 12 años 750 ml", 'Whisky Buchanans Master 750 ml', 'Whisky Johnnie Walker Black Label'];
  const productos = nombres.map((n) => producto(n));
  assert.equal(sugerirConsulta('buchanas 12', productos), 'buchanans 12');
  assert.equal(sugerirConsulta('jonnie walker', productos), 'johnnie walker');
  assert.equal(sugerirConsulta('buchanans 12', productos), null, 'si está bien escrito no sugiere nada');
  assert.equal(sugerirConsulta('tequila', productos), null, 'una palabra sin nada parecido se deja como está');
});

test('distancia de edición con tope', () => {
  assert.equal(distancia('buchanas', 'buchanans'), 1);
  assert.equal(distancia('jonnie', 'johnnie'), 1);
  assert.equal(distancia('ron', 'gin'), 2);
  assert.equal(distancia('aguardiente', 'ron'), 3, 'pasado el tope devuelve tope + 1');
});

test('lee los grados de alcohol', () => {
  assert.equal(extraerGrados('Aguardiente Antioqueño 29° 750 ml'), 29);
  assert.equal(extraerGrados('Ron Medellín 37,5 % vol'), 37.5);
  assert.equal(extraerGrados('Aguardiente 24 grados'), 24);
  assert.equal(extraerGrados('Pague 2 lleve 3'), null);
  assert.equal(extraerGrados('Descuento 100%'), null);
});

test('la firma reconoce el mismo producto escrito distinto', () => {
  const a = { ...producto('AGUARDIENTE ANTIOQUEÑO TAPA ROJA 750ML'), grados: 29 };
  const b = { ...producto('Aguardiente Antioqueño Tapa Roja Botella 750 ml'), grados: 29 };
  const c = { ...producto('Aguardiente Antioqueño Tapa Azul 750 ml'), grados: 24 };
  assert.equal(firmaProducto(a), firmaProducto(b));
  assert.notEqual(firmaProducto(a), firmaProducto(c));
  assert.equal(firmaProducto({ nombre: 'Aguardiente', ml: null }), null, 'sin tamaño no hay firma');
});

test('miniaturas: VTEX en la ruta, Shopify por parámetro, el resto igual', () => {
  assert.equal(
    miniatura('https://exito.vteximg.com.br/arquivos/ids/12345-500-auto/foto.jpg'.replace('-500-auto', '')),
    'https://exito.vteximg.com.br/arquivos/ids/12345-240-240/foto.jpg',
  );
  assert.equal(
    miniatura('https://olimpica.vtexassets.com/arquivos/ids/98765-1000-1000/foto.png?v=1'),
    'https://olimpica.vtexassets.com/arquivos/ids/98765-240-240/foto.png?v=1',
  );
  assert.equal(miniatura('https://cdn.shopify.com/s/files/1/foto.jpg'), 'https://cdn.shopify.com/s/files/1/foto.jpg?width=240');
  assert.equal(miniatura('https://bevgo.com.co/wp-content/uploads/foto-300x300.jpg'), 'https://bevgo.com.co/wp-content/uploads/foto-300x300.jpg');
  assert.equal(miniatura(null), null);
});

test('la tapa roja es el aguardiente de siempre; la tapa azul es otra variante', () => {
  const resultados = [{ productos: [producto('Aguardiente Antioqueño Tapa Roja 750 ml'), producto('Aguardiente Antioqueño Tapa Azul 750 ml')] }];
  marcarVariantes(resultados, palabrasClave('aguardiente antioqueño 750'));
  assert.equal(resultados[0].productos[0].otraVariante, undefined);
  assert.ok(resultados[0].productos[1].otraVariante);
});
