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

// Casos tomados de las respuestas reales de las tiendas (noviembre de 2026).
test('nombres reales: variantes abreviadas, «#» por Ñ, no bebidas y six pack con el total', async () => {
  const { esBebida, mlPorUnidad, repararNombre, variantesNoPedidas } = await import('../src/normalizar.js');
  const p = (nombre) => ({ nombre });
  const aguila = palabrasClave('cerveza aguila');
  assert.deepEqual(variantesNoPedidas(p('CERVEZA AGUILA S/ALCOHOL 330ML X6'), aguila), ['Sin alcohol']);
  assert.deepEqual(variantesNoPedidas(p('Cerveza Aguila 0,0 lata x330ml'), aguila), ['Sin alcohol']);
  assert.deepEqual(variantesNoPedidas(p('Cerveza Aguila Imperial Botella 330ml'), aguila), ['Imperial']);
  assert.deepEqual(variantesNoPedidas(p('Cerveza Club Colombia Roja Lata 330 ml'), palabrasClave('cerveza club colombia 330')), ['Roja']);
  assert.deepEqual(variantesNoPedidas(p('Cerveza Club Colombia Roja Lata 330 ml'), palabrasClave('club colombia roja')), []);
  assert.deepEqual(variantesNoPedidas(p('Aguardiente Antioqueño tapa roja 750 ml'), palabrasClave('antioqueño')), [], 'la tapa roja sigue siendo la normal');
  assert.deepEqual(variantesNoPedidas(p('Aguardiente Antioqueño Verde S/A 750 Ml'), palabrasClave('antioqueño')), ['Sin azúcar', 'Verde']);
  assert.deepEqual(variantesNoPedidas(p('Whisky Johnnie Walker Double Black Label 700 ml'), palabrasClave('johnnie walker black')), ['Double']);
  assert.deepEqual(variantesNoPedidas(p("Pack Buchanan's 12 Años 750ml Gratis Botella de 200ml"), palabrasClave('buchanans 12')), ['Con obsequio']);
  assert.equal(repararNombre('RON MEDELLIN A#EJO BOT 750 ML'), 'RON MEDELLIN AÑEJO BOT 750 ML');
  assert.equal(repararNombre('Cerveza #1'), 'Cerveza #1', 'un # que no está entre mayúsculas se queda');
  assert.ok(!esBebida(p('Destapador Botella Cerveza Aguila Con Iman'), aguila));
  assert.ok(esBebida(p('Cerveza Aguila lata 330 ml'), aguila));
  assert.equal(mlPorUnidad(1614, 6), 269);
  assert.equal(mlPorUnidad(1980, 6), 330);
  assert.equal(mlPorUnidad(1750, 1), 1750, 'una garrafa no se divide');
  assert.equal(mlPorUnidad(1050, 2), 1050, 'si no da un tamaño conocido, se deja');
  assert.equal(mlPorUnidad(1860, 6), 310);
  const { extraerUnidades } = await import('../src/normalizar.js');
  assert.equal(extraerUnidades('CERVEZA ANDINA LATA 310ML PAG11 LLEV12'), 12);
  assert.equal(extraerUnidades('CERVEZA AGUILA LATA PAGUE 11 LLEVE 12 330MLX12U'), 12);
  const andina = palabrasClave('cerveza andina 310');
  assert.deepEqual(variantesNoPedidas(p('Refajo ANDINA sixpack (1860 ml)'), andina), ['Refajo']);
  assert.deepEqual(variantesNoPedidas(p('CERVEZA ANDINA LIGH LATA 310 ML X6'), andina), ['Light']);
  assert.deepEqual(variantesNoPedidas(p('CERVEZA ANDINA LIGH LATA 310 ML X6'), palabrasClave('cerveza andina light')), [], 'pedir «light» cubre «ligh»');
  assert.equal(mlPorUnidad(1260, 6), 210);
  const { inferirPaquete } = await import('../src/normalizar.js');
  assert.deepEqual(inferirPaquete('Cerveza STELLA ARTOIS lata (1614 ml)', 1614, 1), { ml: 269, unidades: 6 });
  assert.deepEqual(inferirPaquete('Cerveza BUDWEISER lata (6456 ml)', 6456, 1), { ml: 269, unidades: 24 });
  assert.deepEqual(inferirPaquete('Cerveza Botella PILSEN Nacional (1980 ml)', 1980, 1), { ml: 330, unidades: 6 });
  assert.deepEqual(inferirPaquete('Refajo ANDINA refrescante (1500 ml)', 1500, 1), { ml: 1500, unidades: 1 }, 'no es cerveza');
  assert.deepEqual(inferirPaquete('Aguardiente Antioqueño 1050 ml', 1050, 1), { ml: 1050, unidades: 1 });
});

test('cerveza sin alcohol: «Cero», «0,0», «libre de alcohol» y «S/ALCOHOL» son lo mismo, y no se mezclan con la Light', async () => {
  const { variantesNoPedidas } = await import('../src/normalizar.js');
  const nombres = [
    'Cerveza Aguila Cero Lata 330 ml',
    'Cerveza AGUILA lata cero libre de alcohol (330 ml)',
    'Cerveza Aguila 0,0% lata x6unds x330ml',
    'CERVEZA AGUILA S/ALCOHOL 330ML X6',
    'Cerveza Águila sin Alcohol Lata 330 Ml',
  ];
  const aguila = palabrasClave('cerveza aguila');
  for (const n of nombres) assert.deepEqual(variantesNoPedidas({ nombre: n }, aguila), ['Sin alcohol'], n);
  assert.deepEqual(variantesNoPedidas({ nombre: 'Cerveza AGUILA LIGHT lata sabor sin igual (330 ml)' }, aguila), ['Light'], '«sabor sin igual» es el eslogan, no un sabor');
  // Buscar la sin alcohol con cualquiera de sus nombres trae todas y deja fuera la Light.
  const productos = [...nombres, 'Cerveza Aguila Light Lata 330 ml', 'Cerveza Aguila Lata 330 ml'].map((n) => producto(n));
  for (const q of ['cerveza aguila sin alcohol', 'aguila cero', 'cerveza aguila cero']) {
    const salida = filtrarProductos(productos, palabrasClave(q)).map((p) => p.nombre);
    assert.deepEqual(salida.sort(), [...nombres].sort(), q);
  }
  // Y al buscar la Light no aparece la sin alcohol.
  const light = filtrarProductos(productos, palabrasClave('cerveza aguila light')).map((p) => p.nombre);
  assert.deepEqual(light, ['Cerveza Aguila Light Lata 330 ml']);
});

test('el agua con gas es otra variante del agua', async () => {
  const { variantesNoPedidas } = await import('../src/normalizar.js');
  assert.deepEqual(variantesNoPedidas({ nombre: 'Agua con gas CRISTAL botella (600 ml)' }, palabrasClave('agua cristal 600')), ['Con gas']);
  assert.deepEqual(variantesNoPedidas({ nombre: 'Agua con gas CRISTAL botella (600 ml)' }, palabrasClave('agua cristal con gas')), []);
});
