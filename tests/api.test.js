import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-api-'));
process.env.DATOS_DIR = carpeta;
process.env.APP_PASSWORD = 'clave-1';
process.env.SESSION_SECRET = 'secreto-de-prueba';
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
test.after(() => rm(carpeta, { recursive: true, force: true }));

// Sin red: todas las tiendas fallan, salvo los proveedores propios.
globalThis.fetch = async () => {
  throw new TypeError('fetch failed');
};

const { manejarApi } = await import('../src/api.js');

const BASE = 'http://localhost';
function pedir(ruta, { metodo = 'GET', cuerpo, cookie, ip = '1.1.1.1', tipo = 'application/json' } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (cuerpo !== undefined) headers['content-type'] = tipo;
  return manejarApi(new Request(BASE + ruta, { method: metodo, headers, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) }), { ip });
}

async function entrar(clave = 'clave-1', ip) {
  const r = await pedir('/api/entrar', { metodo: 'POST', cuerpo: { clave }, ip });
  return { r, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('sin sesión no se puede usar la API', async () => {
  assert.equal((await pedir('/api/lista')).status, 401);
  assert.equal((await pedir('/api/salud')).status, 200);
});

test('la sesión deja de valer si cambia la contraseña', async () => {
  const { r, cookie } = await entrar();
  assert.equal(r.status, 200);
  assert.equal((await pedir('/api/lista', { cookie })).status, 200);
  process.env.APP_PASSWORD = 'clave-2';
  try {
    assert.equal((await pedir('/api/lista', { cookie })).status, 401);
  } finally {
    process.env.APP_PASSWORD = 'clave-1';
  }
  assert.equal((await pedir('/api/lista', { cookie: 'mp=abc.def' })).status, 401);
});

test('frena los intentos de contraseña por IP', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await entrar('mala', '9.9.9.9')).r.status, 401);
  assert.equal((await entrar('clave-1', '9.9.9.9')).r.status, 429);
  assert.equal((await entrar('clave-1', '8.8.8.8')).r.status, 200, 'otra IP sigue pudiendo entrar');
});

test('los cambios exigen JSON (un formulario de otro sitio no puede mandarlo)', async () => {
  const { cookie } = await entrar();
  const r = await pedir('/api/lista', { metodo: 'PUT', cuerpo: { lista: [] }, cookie, tipo: 'text/plain' });
  assert.equal(r.status, 415);
});

test('proveedor propio: se guarda, se valida y entra a la búsqueda', async () => {
  const { cookie } = await entrar();
  const malo = await pedir('/api/proveedores', { metodo: 'PUT', cookie, cuerpo: { proveedor: { id: 'x', nombre: '', productos: [] } } });
  assert.equal(malo.status, 400);

  const r = await pedir('/api/proveedores', {
    metodo: 'PUT',
    cookie,
    cuerpo: {
      proveedor: {
        id: 'don-jose',
        nombre: 'Distribuidora Don José',
        contacto: '300 000 0000',
        productos: [
          { nombre: 'Aguardiente Antioqueño 750 ml', precio: '$ 41.500' },
          { nombre: 'Cerveza Águila lata', precio: '2.900', ml: '330', unidades: 1, disponible: 'no' },
          { nombre: 'Sin precio', precio: '' },
        ],
      },
    },
  });
  assert.equal(r.status, 200);
  const { proveedores } = await r.json();
  assert.equal(proveedores[0].productos.length, 2, 'la fila sin precio se descarta');
  assert.equal(proveedores[0].productos[0].precio, 41500);
  assert.equal(proveedores[0].productos[0].ml, 750);
  assert.equal(proveedores[0].productos[1].disponible, false);

  const tiendas = (await (await pedir('/api/tiendas', { cookie })).json()).tiendas;
  assert.ok(tiendas.some((t) => t.id === 'prov-don-jose' && t.propio));

  const busqueda = await (await pedir(`/api/buscar?q=${encodeURIComponent('aguardiente antioqueño 750')}`, { cookie })).json();
  const propio = busqueda.tiendas.find((t) => t.id === 'prov-don-jose');
  assert.ok(propio.ok);
  assert.equal(propio.productos[0].precio, 41500);
  assert.ok(busqueda.tiendas.filter((t) => !t.propio).every((t) => !t.ok), 'las tiendas sin red fallan, el proveedor no');

  await pedir('/api/proveedores?id=don-jose', { metodo: 'DELETE', cookie, cuerpo: {} });
  const otra = await (await pedir('/api/buscar?q=aguardiente+antioqueno', { cookie })).json();
  assert.ok(!otra.tiendas.some((t) => t.id === 'prov-don-jose'));
});

test('inventario: compras, ventas con su costo y validación', async () => {
  const { cookie } = await entrar();
  await pedir('/api/lista', { metodo: 'PUT', cookie, cuerpo: { lista: [{ id: 'i1', q: 'ron de prueba' }] } });
  const mover = (m) => pedir('/api/movimientos', { metodo: 'POST', cookie, cuerpo: m });
  assert.equal((await mover({ item: 'no-existe', tipo: 'compra', cantidad: 1, precio: 10 })).status, 400);
  assert.equal((await mover({ item: 'i1', tipo: 'compra', cantidad: 0, precio: 10 })).status, 400);
  const t = Date.now() - 10_000;
  await mover({ item: 'i1', tipo: 'compra', cantidad: 10, precio: 40000, t });
  await mover({ item: 'i1', tipo: 'compra', cantidad: 10, precio: 44000, t: t + 1 });
  const venta = await (await mover({ item: 'i1', tipo: 'venta', cantidad: 3, precio: 55000, t: t + 2 })).json();
  assert.equal(venta.movimiento.costo, 42000, 'la venta guarda el costo promedio de ese momento');
  assert.equal(venta.movimiento.nombre, 'ron de prueba');
  const { movimientos } = await (await pedir('/api/movimientos', { cookie })).json();
  assert.equal(movimientos.length, 3);
  const r = await pedir(`/api/movimientos?id=${venta.movimiento.id}`, { metodo: 'DELETE', cookie, cuerpo: {} });
  assert.equal((await r.json()).movimientos.length, 2);
});

test('ajustes compartidos: gana el más reciente', async () => {
  const { cookie } = await entrar();
  const guardar = (ajustes, t) => pedir('/api/ajustes', { metodo: 'PUT', cookie, cuerpo: { ajustes, t } });
  await guardar({ margen: { objetivo: 30 } }, 2000);
  await guardar({ margen: { objetivo: 10 } }, 1000);
  const { ajustes } = await (await pedir('/api/ajustes', { cookie })).json();
  assert.equal(ajustes.ajustes.margen.objetivo, 30);
});

test('config del monitoreo se valida', async () => {
  const { cookie } = await entrar();
  const r = await pedir('/api/config', { metodo: 'PUT', cookie, cuerpo: { config: { cadaHoras: 5, tiendas: ['makro', 'nada'], silencio: { activo: true, desde: 23, hasta: 99 } } } });
  const { config } = await r.json();
  assert.equal(config.cadaHoras, 6, 'frecuencia no permitida → la de siempre');
  assert.deepEqual(config.tiendas, ['makro']);
  assert.deepEqual(config.silencio, { activo: true, desde: 23, hasta: 7 });
});

test('push sin claves VAPID responde que no está activo', async () => {
  const { cookie } = await entrar();
  const estado = await (await pedir('/api/push', { cookie })).json();
  assert.equal(estado.activo, false);
  const r = await pedir('/api/push/suscribir', { metodo: 'POST', cookie, cuerpo: { suscripcion: {} } });
  assert.equal(r.status, 503);
});
