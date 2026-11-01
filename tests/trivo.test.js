// TRIVO con sesión: solo lectura, costos reales en «mitienda-costos»,
// existencias y ventas de 30 días. Los datos de TRIVO de aquí son inventados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { centenaArriba, precioConMargen, resumenInventario, sugerirPrecio } from '../public/precios.js';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-trivo-'));
process.env.DATOS_DIR = carpeta;
process.env.TRIVO_USUARIO = 'tienda-prueba';
process.env.TRIVO_CLAVE = 'clave-prueba';
test.after(() => rm(carpeta, { recursive: true, force: true }));

const carta = await readFile(new URL('./fixtures/aguapure.json', import.meta.url), 'utf8');

const REVENTA = {
  success: true,
  data: {
    count: 3,
    results: [
      { product_id: 1, product_name: 'Aguila Original 330ml', unit_code: 'und', purchase_cost: '2000.00', sale_price: '3500.00', quantity: '0.0000', min_quantity: '10.0000', is_low: false, is_active: true, variants: [] },
      {
        product_id: 4, product_name: 'Aguardiente Antioqueño 750ml', unit_code: 'botella', purchase_cost: '0.00', sale_price: '48000.00', quantity: '0', min_quantity: '0', is_low: false, is_active: true,
        variants: [{ variant_id: 9, variant_name: 'Tapa azul', purchase_cost: '31000.00', sale_price: '49000.00', quantity: '5.0000', min_quantity: '6.0000', is_low: true }],
      },
      { product_id: 50, product_name: 'Hielo en cubo 3 kg', unit_code: 'bolsa', purchase_cost: '1500.00', sale_price: '5000.00', quantity: '20.0000', min_quantity: '5.0000', is_low: false, is_active: true, variants: [] },
    ],
  },
};
const STOCK = {
  1: { success: true, count: 3, total_pages: 2, next: 'https://trivo-pos.com/api/inventory/product-stock/?page=2', results: [
    { product_id: 1, variant_id: null, warehouse_id: 1, quantity: '60.0000' },
    { product_id: 1, variant_id: null, warehouse_id: 2, quantity: '40.0000' },
  ] },
  2: { success: true, count: 3, total_pages: 2, next: null, results: [{ product_id: 4, variant_id: 9, warehouse_id: 1, quantity: '5.0000' }] },
};
const VENTAS = { success: true, data: [
  { product_id: 1, name_snapshot: 'Aguila', quantity_sold: 30, total_revenue: 105000, orders_count: 10 },
  { product_id: 4, name_snapshot: 'Aguardiente', quantity_sold: 2, total_revenue: 98000, orders_count: 2 },
] };

// Compras cargadas y precios en el catálogo de TRIVO (cambian durante los tests).
const COMPRAS = [];
const PRECIOS = { 1: 3500, 2: 72000, 3: 85000, 4: 48000, '4-9': 49000 };
const detalle = (id) => ({
  id: Number(id),
  base_price: `${PRECIOS[id]}.00`,
  variants: Object.entries(PRECIOS).filter(([k]) => k.startsWith(`${id}-`)).map(([k, v]) => ({ id: Number(k.split('-')[1]), price: `${v}.00` })),
});
const llamadas = [];
let claveValida = true;
const respuesta = (cuerpo, { estado = 200, cookies = [] } = {}) => {
  const h = new Headers({ 'content-type': 'application/json' });
  for (const c of cookies) h.append('set-cookie', c);
  return new Response(JSON.stringify(cuerpo), { status: estado, headers: h });
};
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const metodo = opciones.method || 'GET';
  llamadas.push({ metodo, ruta: u.pathname, query: u.search, headers: opciones.headers || {}, body: opciones.body });
  if (u.pathname.startsWith('/api/public/')) return new Response(carta);
  if (u.pathname === '/api/auth/csrf/') return respuesta({}, { cookies: ['csrftoken=tok123; Path=/'] });
  if (u.pathname === '/api/auth/login/') {
    if (!claveValida) return respuesta({ success: false }, { estado: 400 });
    return respuesta({ success: true, data: { user: { id: 1 } } }, { cookies: ['access_token=acc; HttpOnly; Path=/', 'refresh_token=ref; HttpOnly; Path=/'] });
  }
  const conSesion = String(opciones.headers?.cookie || '').includes('access_token=acc');
  if (!conSesion) return respuesta({ detail: 'no' }, { estado: 401 });
  if (u.pathname === '/api/inventory/resale-products/') return respuesta(REVENTA);
  if (u.pathname === '/api/inventory/product-stock/') return respuesta(STOCK[u.searchParams.get('page') || '1']);
  if (u.pathname === '/api/reports/sales-by-product/') return respuesta(VENTAS);
  if (u.pathname === '/api/inventory/movements/') return respuesta({ success: true, count: COMPRAS.length, results: COMPRAS });
  const prod = u.pathname.match(/^\/api\/catalog\/products\/(\d+)\/(?:variants\/(\d+)\/)?$/);
  if (prod) {
    const clave = prod[2] ? `${prod[1]}-${prod[2]}` : prod[1];
    if (metodo === 'PATCH') {
      if (opciones.headers['x-csrftoken'] !== 'tok123') return respuesta({}, { estado: 403 });
      const cuerpo = JSON.parse(opciones.body);
      PRECIOS[clave] = Number(prod[2] ? cuerpo.price : cuerpo.base_price);
      return respuesta({ success: true });
    }
    return respuesta({ success: true, data: detalle(prod[1]) });
  }
  return respuesta({ detail: 'no encontrado' }, { estado: 404 });
};

const trivo = await import('../src/trivo.js');
const { emparejarTrivo, catalogoPropio, sincronizarTrivo, estadoMiTienda, refrescarTrivo, guardarCostos, aplicarPropuesta, deshacerCambio, guardarMargenes, proponerTodos } = await import('../src/mitienda.js');

test('inicia sesión con CSRF, usuario y clave, y después solo hace GET', async () => {
  trivo.cerrarSesionLocal();
  llamadas.length = 0;
  const datos = await trivo.leerTrivo({ ahora: Date.parse('2026-11-01T15:00:00Z') });
  const login = llamadas.find((l) => l.ruta === '/api/auth/login/');
  assert.equal(login.metodo, 'POST');
  assert.equal(login.headers['x-csrftoken'], 'tok123');
  assert.deepEqual(JSON.parse(login.body), { username: 'tienda-prueba', password: 'clave-prueba' });
  const otras = llamadas.filter((l) => !l.ruta.startsWith('/api/auth/'));
  assert.ok(otras.length >= 4);
  assert.ok(otras.every((l) => l.metodo === 'GET'), 'fuera del inicio de sesión todo es GET');
  assert.ok(!llamadas.some((l) => /catalog\/products/.test(l.ruta)), 'no toca el catálogo (aplicar precios no está programado)');
  // Existencias: suma las bodegas y sigue las páginas.
  assert.equal(datos.stock.get('1'), 100);
  assert.equal(datos.stock.get('4-9'), 5);
  // Ventas de los últimos 30 días, en fechas de Colombia.
  const ventas = llamadas.find((l) => l.ruta === '/api/reports/sales-by-product/');
  assert.equal(ventas.query, '?date_from=2026-10-03&date_to=2026-11-01');
  assert.deepEqual(datos.ventas.get('1'), { unidades: 30, ingresos: 105000, pedidos: 10 });
});

test('en TRIVO solo se escribe el precio de venta: un POST (sesión) y un PATCH', async () => {
  const fuente = await readFile(new URL('../src/trivo.js', import.meta.url), 'utf8');
  const metodos = [...fuente.matchAll(/method:\s*'([A-Z]+)'/g)].map((m) => m[1]);
  assert.deepEqual(metodos.sort(), ['PATCH', 'POST'], 'POST del inicio de sesión y PATCH del precio');
  assert.doesNotMatch(fuente, /PUT'|DELETE'/);
  assert.match(fuente, /\{ price: String\(precio\) \} : \{ base_price: String\(precio\) \}/, 'el PATCH solo lleva el precio');
});

test('usuario o clave equivocados dan un error claro', async () => {
  trivo.cerrarSesionLocal();
  claveValida = false;
  await assert.rejects(trivo.leerTrivo(), /rechazó el usuario o la clave/);
  claveValida = true;
});

test('empareja la carta: directo, por variante y paquetes calculados desde la lata', async () => {
  trivo.cerrarSesionLocal();
  const datos = await trivo.leerTrivo();
  const productos = await catalogoPropio('aguapure');
  const { productos: r, sinPareja } = emparejarTrivo(productos, datos);
  assert.deepEqual([r['1'].fuente, r['1'].costo, r['1'].existencias], ['directo', 2000, 100]);
  assert.equal(r['1'].ventas.unidades, 30);
  // Variante: su propio costo y existencias; las ventas son de todo el producto.
  assert.deepEqual([r['4-9'].costo, r['4-9'].existencias, r['4-9'].bajo, r['4-9'].ventas.todasLasVariantes], [31000, 5, true, true]);
  // x 24 sin costo propio: 24 latas; la caja suma el hielo de 3 kg.
  assert.deepEqual([r['2'].fuente, r['2'].costo, r['2'].alcanza], ['calculado', 48000, 4]);
  assert.equal(r['3'].costo, 49500);
  assert.match(r['3'].detalle, /24 × Aguila Original 330ml \+ hielo 3 kg/);
  assert.deepEqual(sinPareja, []);
});

test('la marca puede estar incompleta («Club Colombia» ↔ «Club Colombia Dorada»), pero no ser ambigua', () => {
  const lata = (id, nombre, costo = 2500) => ({ id, nombre, unidad: 'und', costo, existencias: 48, variantes: [] });
  const datos = { productos: [lata(10, 'Club Colombia Dorada x 330ml (lata)'), lata(11, 'Miller lite x 355ml (lata)'), lata(12, 'Poker x 330ml (lata)'), lata(13, 'Poker Ligera x 330ml (lata)')], stock: new Map(), ventas: new Map() };
  const carta = [
    { id: '20', nombre: 'Caja de Club Colombia x 330 ml', base: 'Caja de Club Colombia x 330 ml', ml: 330, unidades: 24 },
    { id: '21', nombre: 'Caja de Miller x 355ml', base: 'Caja de Miller x 355ml', ml: 355, unidades: 24 },
    { id: '22', nombre: 'Poker x 6 unidades (lata)', base: 'Poker x 6 unidades (lata)', ml: 330, unidades: 6 },
    { id: '23', nombre: 'Heineken x 6 unidades (lata)', base: 'Heineken x 6 unidades (lata)', ml: 330, unidades: 6 },
  ];
  const { productos: r, sinPareja } = emparejarTrivo(carta, datos);
  assert.equal(r['20'].costo, 60000);
  assert.equal(r['21'].base, 'Miller lite x 355ml (lata)');
  assert.equal(r['22'].base, 'Poker x 330ml (lata)', 'entre Poker y Poker Ligera gana el nombre exacto');
  assert.equal(r['22'].alcanza, 8);
  assert.deepEqual(sinPareja, ['Heineken x 6 unidades (lata)']);
});

test('sincronizar guarda los costos reales y el precio sugerido respeta el margen mínimo', async () => {
  trivo.cerrarSesionLocal();
  await guardarCostos({ '1': 9999, 'otro-manual': 1234 });
  const r = await sincronizarTrivo({ ahora: Date.now() });
  assert.equal(r.costos['1'], 2000, 'el costo de TRIVO reemplaza el anotado a mano');
  assert.equal(r.costos['otro-manual'], 1234, 'los demás costos anotados se quedan');
  assert.equal(r.costos['2'], 48000);
  const estado = await estadoMiTienda();
  assert.equal(estado.trivo.activo, true);
  assert.equal(estado.trivo.dias, 30);
  const caja24 = estado.productos.find((p) => p.id === '2');
  assert.equal(caja24.trivo.existencias, 100);
  // Mercado a 45.000 pero el costo es 48.000: con 15 % de margen mínimo no baja de 55.200.
  const s = sugerirPrecio(caja24, { referencia: { precio: 45000 } }, estado.costos['2'], { margenMin: 15 });
  assert.deepEqual([s.sugerido, s.motivo], [55200, 'costo']);
  // El monitoreo no vuelve a leer TRIVO antes de 6 horas.
  assert.equal(await refrescarTrivo({ ahora: Date.now() + 60_000 }), false);
});

test('existencias y ventas en frases para la vista', () => {
  const d = resumenInventario({ fuente: 'directo', existencias: 100, bajo: false, ventas: { unidades: 30, pedidos: 10, todasLasVariantes: false } });
  assert.equal(d.existencias, '100 en existencia');
  assert.equal(d.ventas, '30 vendidos en 30 días (10 pedidos)');
  assert.equal(d.cobertura, 100);
  const c = resumenInventario({ fuente: 'calculado', existencias: 20, alcanza: 0, ventas: { unidades: 0, pedidos: 0 } });
  assert.deepEqual([c.existencias, c.agotado, c.ventas, c.cobertura], ['20 latas en TRIVO · alcanzan para 0', true, 'Sin ventas en 30 días', null]);
  assert.equal(resumenInventario(null), null);
});

test('precio con tu margen como TRIVO, redondeado hacia arriba a la centena', () => {
  assert.deepEqual([3215, 3225, 3201, 3200, 3299.999].map(centenaArriba), [3300, 3300, 3300, 3200, 3300]);
  // TRIVO: precio = costo ÷ (1 − margen). 2.572 con 20 % → 3.215 → 3.300.
  assert.equal(precioConMargen(2572, 20), 3300);
  assert.equal(precioConMargen(2560, 20), 3200, '2.560 ÷ 0,8 = 3.200 exacto: no sube');
  assert.equal(precioConMargen(2572, 20, { fria: true, recargoFria: 10 }), 3600, 'la fría lleva su recargo');
  assert.equal(precioConMargen(61728, 20, { descuento: 3000 }), 80200, 'la promo de valor fijo se suma');
  assert.equal(precioConMargen(0, 20), null);
  assert.equal(precioConMargen(2572, 95), null, 'margen imposible');
});

test('una compra en TRIVO deja propuestas con tu margen; nada se aplica sin aprobar', async () => {
  trivo.cerrarSesionLocal();
  await sincronizarTrivo({ ahora: Date.now() }); // punto de partida: sin compras
  llamadas.length = 0;
  // Cargas una compra de latas a 2.572 y TRIVO actualiza el costo.
  COMPRAS.push({ id: 7, type: 'purchase', product_id: 1, variant_id: null, quantity: '48.0000', unit_cost: '2572.00', created_at: '2026-11-01T10:00:00-05:00' });
  REVENTA.data.results[0].purchase_cost = '2572.00';
  const r = await sincronizarTrivo({ ahora: Date.now() });
  assert.equal(r.propuestasNuevas, 3, 'la lata, la x 24 y la caja con hielo');
  assert.ok(!llamadas.some((l) => l.metodo === 'PATCH'), 'sin tu aprobación no se cambia nada');
  const estado = await estadoMiTienda();
  const porId = Object.fromEntries(estado.propuestas.map((x) => [x.id, x]));
  assert.deepEqual([porId['1'].precioActual, porId['1'].precioNuevo, porId['1'].motivo, porId['1'].compra.costo], [3500, 3300, 'compra', 2572]);
  assert.equal(porId['2'].precioNuevo, 80200, '24 × 2.572 ÷ 0,8 + 3.000 de la promo, hacia arriba');
  assert.equal(porId['3'].precioNuevo, 79100, '(24 × 2.572 + 1.500 del hielo) ÷ 0,8');
  assert.ok(Math.abs(porId['2'].margenNuevo - 20) < 0.5, 'lo que paga el cliente deja tu margen');
  // Una segunda lectura sin compras nuevas no repite el aviso.
  assert.equal((await sincronizarTrivo({ ahora: Date.now() })).propuestasNuevas, 0);
});

test('aplicar cambia solo ese precio en TRIVO, queda en el historial y se puede deshacer', async () => {
  llamadas.length = 0;
  await aplicarPropuesta('1');
  const patch = llamadas.filter((l) => l.metodo === 'PATCH');
  assert.equal(patch.length, 1);
  assert.equal(patch[0].ruta, '/api/catalog/products/1/');
  assert.deepEqual(JSON.parse(patch[0].body), { base_price: '3300' });
  assert.equal(PRECIOS[1], 3300);
  let estado = await estadoMiTienda();
  assert.ok(!estado.propuestas.some((x) => x.id === '1'), 'la propuesta aplicada sale de la lista');
  assert.deepEqual([estado.historial[0].antes, estado.historial[0].despues], [3500, 3300]);
  await deshacerCambio(estado.historial[0].id);
  assert.equal(PRECIOS[1], 3500);
  estado = await estadoMiTienda();
  assert.ok(estado.historial[1].deshecho);
  await assert.rejects(deshacerCambio(estado.historial[1].id), /ya se deshizo/);
});

test('si el precio cambió en TRIVO no se pisa; las variantes van por su ruta', async () => {
  PRECIOS[2] = 75000; // alguien lo cambió en el panel de TRIVO
  await assert.rejects(aplicarPropuesta('2'), /ya no es 72000/);
  assert.equal(PRECIOS[2], 75000);
  // Margen propio para el aguardiente: 30 % sobre 31.000 → 44.285,7 → 44.300.
  await guardarMargenes({ porProducto: { '4-9': 30 } });
  await proponerTodos();
  const p = (await estadoMiTienda()).propuestas.find((x) => x.id === '4-9');
  assert.deepEqual([p.margen, p.precioNuevo], [30, 44300]);
  llamadas.length = 0;
  await aplicarPropuesta('4-9');
  const patch = llamadas.find((l) => l.metodo === 'PATCH');
  assert.equal(patch.ruta, '/api/catalog/products/4/variants/9/');
  assert.deepEqual(JSON.parse(patch.body), { price: '44300' });
  await assert.rejects(guardarMargenes({ general: 95 }), /entre 0 y 89/);
});
