// La caja de la tienda: el pedido armado en la página se revisa contra la
// carta y se manda a TRIVO por la entrada de su carta. TRIVO es de mentira.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-caja-'));
process.env.DATOS_DIR = carpeta;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const real = JSON.parse(await readFile(new URL('./fixtures/trivo-carta.json', import.meta.url), 'utf8'));
const PAGOS = [
  { id: 55, name: 'Efectivo', type: 'cash', account_number: '', requires_reference: false },
  { id: 51, name: 'Nequi', type: 'wallet', account_number: '3105174290', requires_reference: true },
];
const llamadas = [];
let respuestaPedido = () => new Response(JSON.stringify({ success: true, data: { uuid: 'a1b2c3d4-0000-4000-8000-000000000001', order_number: 901, delivery_number: 12, daily_number: 34, total: '20600.00', business_whatsapp: '573007643274' } }), { status: 201 });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
  llamadas.push({ ruta: u.pathname, metodo: opciones.method || 'GET', cuerpo, consulta: Object.fromEntries(u.searchParams) });
  const ok = (data) => new Response(JSON.stringify({ success: true, data }));
  if (u.pathname === '/api/public/menu/agua-pure/') return new Response(JSON.stringify(real));
  if (u.pathname.endsWith('/payment-methods/')) return ok(PAGOS);
  if (u.pathname.endsWith('/delivery-quote/')) return ok({ fee: '8000.00', fee_original: '8000.00', free_delivery: null, zone_name: '' });
  if (u.pathname.endsWith('/reverse-geocode/')) return ok({ address: 'Calle 16 # 9-20, Centro, Valledupar', precision: 'house' });
  if (u.pathname.endsWith('/order/')) return respuestaPedido(cuerpo);
  if (/\/order\/[^/]+\/status\/$/.test(u.pathname)) return ok({ status: { stage: 1, label: 'En preparación', is_final: false, mapping: 'preparing' }, service_type: 'delivery' });
  return new Response('{"detail":"no"}', { status: 404 });
};

const { armarPedido, celularLocal, manejarCaja, referencia, reiniciarCaja } = await import('../src/caja.js');
const { armarCarta, olvidarMemoria } = await import('../src/tienda.js');

const carta = () => armarCarta(structuredClone(real.data), { t: 1 });
const CLAVE = '0f8a2c1e-1111-4222-8333-444455556666';
const base = {
  clave: CLAVE,
  nombre: 'Ana Pérez',
  celular: '300 123 4567',
  direccion: 'Calle 16 # 9-20, Centro',
  indicaciones: 'Casa azul',
  lat: 10.4747,
  lng: -73.2436,
  pago: 51,
  lineas: [
    { id: 598, variante: 229, cantidad: 4 }, // Aguila lata fría x 4 = 11.600
    { id: 520, variante: null, cantidad: 1 }, // Hielo 3 kg = 5.000
  ],
};
const pagos = PAGOS.map((m) => ({ id: m.id, nombre: m.name, tipo: m.type, cuenta: m.account_number || null }));

const pedir = (ruta, cuerpo, ip = '1.1.1.1') =>
  manejarCaja(
    new Request(`https://tienda.example/api/tienda/${ruta}`, cuerpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) } : {}),
    { ip },
  );

test('el pedido se arma con lo que espera TRIVO: producto, presentación, cliente, ubicación y pago', () => {
  const { pedido, subtotal } = armarPedido(carta(), base, pagos);
  assert.equal(subtotal, 4 * 2900 + 5000, 'los precios salen de la carta, no del navegador');
  assert.deepEqual(pedido, {
    idempotency_key: CLAVE,
    branch_code: 'B001',
    service_type: 'delivery',
    notes: 'Casa azul · Pedido hecho en la página web',
    customer: { name: 'Ana Pérez', phone: '573001234567' },
    items: [
      { product_id: 598, variant_id: 229, quantity: 4, modifiers: [] },
      { product_id: 520, variant_id: null, quantity: 1, modifiers: [] },
    ],
    address: 'Calle 16 # 9-20, Centro',
    lat: 10.4747,
    lng: -73.2436,
    payment_method_id: 51,
  });
});

test('el pedido se rechaza con un mensaje claro si algo no cuadra', () => {
  const c = carta();
  const falla = (cambio, mensaje) => assert.throws(() => armarPedido(c, { ...base, ...cambio }, pagos), (e) => e instanceof TypeError && mensaje.test(e.message));
  falla({ lineas: [] }, /vacío/);
  falla({ lineas: [{ id: 598, cantidad: 4 }] }, /Escoge la presentación de Aguila/);
  falla({ lineas: [{ id: 598, variante: 999, cantidad: 4 }] }, /presentación/);
  falla({ lineas: [{ id: 99999, cantidad: 1 }] }, /ya no está en la carta/);
  falla({ lineas: [{ id: 520, cantidad: 0 }] }, /cantidad/);
  falla({ lineas: [{ id: 520, cantidad: 1 }] }, /pedido mínimo es de \$ 10\.000/);
  falla({ celular: '12345' }, /celular de 10 dígitos/);
  falla({ nombre: ' ' }, /nombre/);
  falla({ direccion: 'x' }, /dirección/);
  falla({ pago: 7 }, /cómo vas a pagar/);
  falla({ clave: 'x' }, /clave/);
  const agotado = structuredClone(real.data);
  agotado.sections.find((s) => s.id === 113).products.find((p) => p.id === 520).is_available = false;
  assert.throws(() => armarPedido(armarCarta(agotado), base, pagos), /agotado/);
  const sinGps = armarPedido(c, { ...base, lat: null, lng: 'x' }, pagos).pedido;
  assert.ok(!('lat' in sinGps) && !('lng' in sinGps), 'sin ubicación válida no se manda');
  assert.equal(celularLocal('+57 300 123 4567'), '3001234567');
  assert.equal(celularLocal('6055701234'), null, 'un fijo no sirve');
});

test('la referencia se ve como en la carta', () => {
  assert.equal(referencia({ delivery_number: 12, daily_number: 34 }), 'Domicilio #12 · Pedido del día #34');
  assert.equal(referencia({ daily_number: 5 }), 'Pedido del día #5');
  assert.equal(referencia({ order_number: 77 }), 'Pedido #77');
});

test('de punta a punta: caja, domicilio, ubicación, pedido a TRIVO y estado', async () => {
  reiniciarCaja();
  olvidarMemoria();
  llamadas.length = 0;
  let r = await pedir('caja');
  assert.equal(r.status, 200);
  const caja = await r.json();
  assert.deepEqual(caja.pagos.map((m) => m.nombre), ['Efectivo', 'Nequi']);
  assert.equal(caja.pagos[1].cuenta, '3105174290');
  assert.deepEqual([caja.abierto, caja.enLinea, caja.minimo], [true, true, 10000]);

  r = await pedir('domicilio', { direccion: 'Calle 16 # 9-20', lat: 10.47, lng: -73.24, subtotal: 16600 });
  assert.deepEqual(await r.json(), { valor: 8000, antes: 8000, zona: '' });
  const cotiza = llamadas.find((l) => l.ruta.endsWith('/delivery-quote/'));
  assert.deepEqual(cotiza.cuerpo, { branch_code: 'B001', address: 'Calle 16 # 9-20', city: 'Valledupar', lat: 10.47, lng: -73.24, subtotal: 16600 });

  r = await pedir('ubicacion', { lat: 10.47, lng: -73.24 });
  assert.deepEqual(await r.json(), { direccion: 'Calle 16 # 9-20, Centro, Valledupar', precision: 'house' });
  assert.equal((await pedir('ubicacion', { lat: 40.4, lng: -3.7 })).status, 400, 'fuera de Colombia no');

  r = await pedir('pedido', base);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { uuid: 'a1b2c3d4-0000-4000-8000-000000000001', referencia: 'Domicilio #12 · Pedido del día #34', total: 20600, whatsapp: '573007643274' });
  const enviado = llamadas.find((l) => l.ruta.endsWith('/order/'));
  assert.equal(enviado.metodo, 'POST');
  assert.equal(enviado.cuerpo.idempotency_key, CLAVE);

  r = await pedir('pedido/a1b2c3d4-0000-4000-8000-000000000001');
  assert.deepEqual(await r.json(), { etapa: 1, etiqueta: 'En preparación', final: false, cancelado: false });
});

test('si TRIVO dice que está cerrado, el cliente lo lee; si TRIVO no responde, se ofrece WhatsApp', async () => {
  reiniciarCaja();
  respuestaPedido = () => new Response(JSON.stringify({ detail: 'El restaurante está cerrado en este momento. Vuelve durante el horario de atención.', code: 'branch_closed' }), { status: 409 });
  let r = await pedir('pedido', base);
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'La tienda está cerrada en este momento. Tu pedido queda guardado aquí para enviarlo cuando abramos.', codigo: 'branch_closed' });

  respuestaPedido = () => new Response('<html>caído</html>', { status: 502 });
  r = await pedir('pedido', base);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).sinTrivo, true);

  respuestaPedido = () => {
    throw new TypeError('fetch failed');
  };
  r = await pedir('pedido', base);
  assert.equal(r.status, 502);
  assert.equal((await r.json()).sinTrivo, true, 'un fallo de red no se confunde con un error del cliente');

  r = await pedir('pedido', { ...base, lineas: [] });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /vacío/);
});

test('sin JSON no entra, y una misma IP no puede llenar a TRIVO de pedidos', async () => {
  reiniciarCaja();
  const r = await manejarCaja(new Request('https://tienda.example/api/tienda/pedido', { method: 'POST', body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } }), { ip: '2.2.2.2' });
  assert.equal(r.status, 415);
  const estados = [];
  for (let i = 0; i < 8; i++) estados.push((await pedir('pedido', { ...base, lineas: [] }, '3.3.3.3')).status);
  assert.deepEqual(estados.slice(-2), [429, 429]);
  assert.equal((await pedir('pedido', { ...base, lineas: [] }, '4.4.4.4')).status, 400, 'otra IP sigue normal');
});
