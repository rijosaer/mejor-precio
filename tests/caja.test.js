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
let geoCaido = false;
let respuestaPedido = () => new Response(JSON.stringify({ success: true, data: { uuid: 'a1b2c3d4-0000-4000-8000-000000000001', order_number: 901, delivery_number: 12, daily_number: 34, total: '20600.00', business_whatsapp: '573007643274' } }), { status: 201 });
globalThis.fetch = async (url, opciones = {}) => {
  const u = new URL(String(url));
  const cuerpo = opciones.body ? JSON.parse(opciones.body) : null;
  llamadas.push({ ruta: u.pathname, metodo: opciones.method || 'GET', cuerpo, consulta: Object.fromEntries(u.searchParams) });
  const ok = (data) => new Response(JSON.stringify({ success: true, data }));
  if (u.pathname === '/api/public/menu/agua-pure/') return new Response(JSON.stringify(real));
  if (u.pathname.endsWith('/payment-methods/')) return ok(PAGOS);
  if (u.pathname.endsWith('/delivery-quote/')) return ok({ fee: '8000.00', fee_original: '8000.00', free_delivery: null, zone_name: '' });
  if (u.pathname.endsWith('/reverse-geocode/')) {
    if (geoCaido) return new Response('{"detail":"x"}', { status: 503 });
    // Lo que TRIVO devolvió de verdad (2026-11-09): La Paz (Cesar) cerca de 10.387; Valledupar en el resto.
    return Number(u.searchParams.get('lat')) < 10.4
      ? ok({ address: 'La Paz, Cesar, 202010', display_name: 'La Paz, Cesar, RAP Caribe, Colombia', precision: 'area', components: { city: 'La Paz', state: 'Cesar' } })
      : ok({ address: 'Calle 16 # 9-20, Centro, Valledupar', display_name: 'Comuna 1, Perímetro Urbano Valledupar, Valledupar, Cesar, RAP Caribe, 200001, Colombia', precision: 'house', components: { city: 'Perímetro Urbano Valledupar', state: 'Cesar' } });
  }
  if (u.pathname.endsWith('/order/')) return respuestaPedido(cuerpo);
  if (/\/order\/[^/]+\/status\/$/.test(u.pathname)) {
    return ok({
      status: { stage: 1, label: 'En preparación', is_final: false, mapping: 'preparing' },
      service_type: 'delivery',
      account: { items: [{ quantity: 4, name: 'Aguila Original fria  x 330ml (lata) valledupar', variant: 'Fria', line_total: '11600.00' }, { quantity: 1, name: 'Hielo en cubo agua pure valledupar  3 kg', variant: null, line_total: '5000.00' }], total: '24600.00' },
    });
  }
  return new Response('{"detail":"no"}', { status: 404 });
};

const { armarPedido, celularLocal, domicilioGratis, enCiudad, manejarCaja, referencia, reiniciarCaja } = await import('../src/caja.js');
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
  autoriza: true,
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
  falla({ autoriza: false }, /mayor de edad y autoriza el tratamiento de tus datos/);
  falla({ autoriza: 'si' }, /mayor de edad/, 'tiene que ser la casilla marcada (true), no otro valor');
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
  assert.deepEqual(await r.json(), { valor: 8000, antes: 8000, zona: '', gratis: null });
  const cotiza = llamadas.find((l) => l.ruta.endsWith('/delivery-quote/'));
  assert.deepEqual(cotiza.cuerpo, { branch_code: 'B001', address: 'Calle 16 # 9-20', city: 'Valledupar', lat: 10.47, lng: -73.24, subtotal: 16600 });

  r = await pedir('ubicacion', { lat: 10.47, lng: -73.24 });
  assert.deepEqual(await r.json(), { direccion: 'Calle 16 # 9-20, Centro, Valledupar', precision: 'house', enZona: true });
  r = await pedir('ubicacion', { lat: 10.387, lng: -73.172 });
  assert.deepEqual(await r.json(), { direccion: 'La Paz, Cesar, 202010', precision: 'area', enZona: false, error: 'Tu ubicación queda en La Paz. Solo hacemos domicilios en Valledupar.' });
  assert.equal((await pedir('ubicacion', { lat: 40.4, lng: -3.7 })).status, 400, 'fuera de Colombia no');

  r = await pedir('pedido', base);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { uuid: 'a1b2c3d4-0000-4000-8000-000000000001', referencia: 'Domicilio #12 · Pedido del día #34', total: 20600, whatsapp: '573007643274' });
  const enviado = llamadas.find((l) => l.ruta.endsWith('/order/'));
  assert.equal(enviado.metodo, 'POST');
  assert.equal(enviado.cuerpo.idempotency_key, CLAVE);

  r = await pedir('pedido/a1b2c3d4-0000-4000-8000-000000000001');
  assert.deepEqual(await r.json(), {
    etapa: 1,
    etiqueta: 'En preparación',
    final: false,
    cancelado: false,
    detalle: {
      lineas: [
        { cantidad: 4, nombre: 'Aguila Original fría x 330ml (lata)', presentacion: 'Fría', total: 11600 },
        { cantidad: 1, nombre: 'Hielo en cubo 3 kg', presentacion: null, total: 5000 },
      ],
      total: 24600,
    },
  }, 'el detalle que TRIVO registró, con los nombres limpios');
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

test('la ciudad del GPS: Valledupar y sus corregimientos sí; La Paz, Codazzi, Bogotá no', () => {
  // Respuestas reales de TRIVO (reverse-geocode) del 2026-11-09.
  const punto = (city, display_name) => ({ components: { city }, display_name });
  assert.ok(enCiudad(punto('Perímetro Urbano Valledupar', 'Comuna 1, Perímetro Urbano Valledupar, Valledupar, Cesar, RAP Caribe, 200001, Colombia'), 'Valledupar'));
  assert.ok(enCiudad(punto('Valledupar', 'Homa, Valledupar, Cesar, RAP Caribe, Colombia'), 'Valledupar'), 'Valencia de Jesús es corregimiento de Valledupar');
  assert.ok(enCiudad(punto(undefined, 'Vía Aeropuerto, Comuna 3, Valledupar, Cesar, Colombia'), 'valledupar'), 'sin ciudad, por la dirección completa');
  assert.ok(!enCiudad(punto('La Paz', 'La Paz, Cesar, RAP Caribe, Colombia'), 'Valledupar'));
  assert.ok(!enCiudad(punto('Agustín Codazzi', 'Calle 15, Agustín Codazzi, Cesar, RAP Caribe, 202050, Colombia'), 'Valledupar'));
  assert.ok(!enCiudad(punto('San Diego', 'Carrera 8B, San Diego, Cesar, RAP Caribe, Colombia'), 'Valledupar'));
  assert.ok(!enCiudad(punto('Bogotá ciudad', 'TransMilenio, Suba, Bogotá ciudad, Bogotá, Distrito Capital, Colombia'), 'Valledupar'));
  assert.ok(enCiudad(punto('Bogotá ciudad', 'Suba, Bogotá, Distrito Capital, Colombia'), 'Bogotá'), 'la ciudad sale de la sucursal en TRIVO, no está fija');
});

test('un pedido con GPS fuera de la ciudad no llega a TRIVO', async () => {
  reiniciarCaja();
  olvidarMemoria();
  respuestaPedido = () => new Response(JSON.stringify({ success: true, data: { uuid: 'a1b2c3d4-0000-4000-8000-000000000002', delivery_number: 13 } }), { status: 201 });
  llamadas.length = 0;
  let r = await pedir('pedido', { ...base, lat: 10.387, lng: -73.172 });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { error: 'Tu ubicación queda en La Paz. Solo hacemos domicilios en Valledupar.', codigo: 'fuera_de_zona' });
  assert.ok(!llamadas.some((l) => l.ruta.endsWith('/order/')), 'el pedido no se manda');

  geoCaido = true;
  r = await pedir('pedido', base);
  assert.equal(r.status, 409);
  assert.equal((await r.json()).codigo, 'sin_ubicacion', 'si no se puede confirmar la ubicación, tampoco');
  assert.ok(!llamadas.some((l) => l.ruta.endsWith('/order/')));

  r = await pedir('pedido', { ...base, lat: null, lng: null });
  assert.equal(r.status, 200, 'sin GPS (dirección escrita) el pedido sale');
  geoCaido = false;
  r = await pedir('pedido', base);
  assert.equal(r.status, 200, 'con GPS en Valledupar el pedido sale');
});

test('domicilio gratis: lo que manda TRIVO (aplica, cuánto falta y el nombre de la promoción)', () => {
  assert.equal(domicilioGratis(null), null, 'sin promoción de domicilio gratis');
  assert.deepEqual(domicilioGratis({ applies: false, missing: '63400.00', promotion_name: '  Domicilio gratis ' }), { aplica: false, falta: 63400, nombre: 'Domicilio gratis' });
  assert.deepEqual(domicilioGratis({ applies: true, missing: 0, promotion_name: 'Gratis desde 80 mil' }), { aplica: true, falta: 0, nombre: 'Gratis desde 80 mil' });
});

test('no deja pedir más de las existencias que quedan', () => {
  const datos = structuredClone(real.data);
  const hielo = datos.sections.flatMap((s) => s.products).find((p) => p.id === 520);
  hielo.stock_left = 2;
  const c = armarCarta(datos, { t: 1 });
  const pedido = (cantidad) => armarPedido(c, { ...base, lineas: [{ id: 520, variante: null, cantidad }, { id: 598, variante: 229, cantidad: 4 }] }, [{ id: 51, nombre: 'Nequi' }]);
  assert.ok(pedido(2).pedido.items.length === 2);
  assert.throws(() => pedido(3), (e) => e instanceof TypeError && /solo quedan 2/.test(e.message));
});
