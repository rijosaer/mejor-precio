import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sugerirPrecio, limpiarRegla } from '../public/precios.js';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-mitienda-'));
process.env.DATOS_DIR = carpeta;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const fixture = (n) => readFile(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/trivo-pos\.com\/api/.test(u)) return new Response(await fixture('aguapure.json'));
  if (/tienda\.makro/.test(u)) return new Response(await fixture('makro.html'));
  if (/bevgo/.test(u)) return new Response(await fixture('bevgo.json'));
  return new Response('no', { status: 404 });
};

const { consultaDe, catalogoPropio, resumirMercado, analizarProducto, estadoMiTienda, guardarCostos } = await import('../src/mitienda.js');

test('la búsqueda en el mercado sale del nombre de la carta, sin «fría», «lata» ni «original»', () => {
  assert.equal(consultaDe({ base: 'Aguila Original x 330ml (lata)', seccion: 'Cervezas', ml: 330 }), 'cerveza aguila 330');
  assert.equal(consultaDe({ base: 'Caja de Póker x 330ml + Hielo (3 kilos)', seccion: 'Cabás con hielo', ml: 330 }), 'cerveza póker 330');
  assert.equal(consultaDe({ base: 'Agua Cristal 600 ml · paquete x 24', seccion: 'Agua', ml: 600 }), 'agua cristal · 600'.replace(' ·', ''));
});

test('la carta propia trae id, variante y el valor del hielo de las cajas', async () => {
  const productos = await catalogoPropio('aguapure');
  const caja = productos.find((p) => p.conHielo);
  assert.equal(caja.unidades, 24);
  assert.equal(caja.valorHielo, 0, 'el fixture no tiene hielo de 3 kg en la carta');
  assert.ok(productos.every((p) => p.id && p.consulta));
  assert.ok(productos.some((p) => p.variante === 'Tapa azul'));
});

test('referencia del mercado: el mismo paquete o juntar paquetes más chicos, lo que salga menos', () => {
  const datos = {
    tiendas: [
      { id: 'a', nombre: 'A', ok: true, productos: [{ precio: 20000, ml: 330, unidades: 6, disponible: true }, { precio: 90000, ml: 330, unidades: 24, disponible: true }] },
      { id: 'b', nombre: 'B', ok: true, productos: [{ precio: 3100, ml: 330, unidades: 1, disponible: true }, { precio: 1, ml: 330, unidades: 1, disponible: true, otraVariante: true }] },
      { id: 'yo', nombre: 'Yo', ok: true, miTienda: true, productos: [{ precio: 100, ml: 330, unidades: 24, disponible: true }] },
    ],
  };
  const caja = resumirMercado({ ml: 330, unidades: 24 }, datos);
  assert.equal(caja.referencia.precio, 74400, '24 latas de B a 3.100 salen menos que la caja de 90.000 de A');
  assert.equal(caja.referencia.fuente, 'por-unidad');
  const six = resumirMercado({ ml: 330, unidades: 6 }, datos);
  assert.equal(six.referencia.precio, 18600, '6 latas de B a 3.100 salen menos que el six pack de 20.000');
  const lata = resumirMercado({ ml: 330, unidades: 1 }, datos);
  assert.deepEqual([lata.referencia.precio, lata.referencia.fuente], [3100, 'mismo-paquete']);
  assert.equal(resumirMercado({ ml: 473, unidades: 1 }, datos).referencia, null);
});

test('precio sugerido según la regla', () => {
  const r = (precio) => ({ referencia: { precio } });
  assert.deepEqual(limpiarRegla({ sobreMinimo: 'x', redondeo: 7 }), limpiarRegla({}));
  // Más caro que el mercado: bajar al más barato.
  let s = sugerirPrecio({ precio: 21600, unidades: 6 }, r(19200), null, {});
  assert.deepEqual([s.estado, s.accion, s.sugerido], ['caro', 'bajar', 19200]);
  // Más barato: subir; con la tolerancia, los cambios chicos se dejan.
  s = sugerirPrecio({ precio: 17400, unidades: 6 }, r(19345), null, {});
  assert.deepEqual([s.estado, s.accion, s.sugerido], ['barato', 'subir', 19300]);
  s = sugerirPrecio({ precio: 19200, unidades: 6 }, r(19300), null, {});
  assert.deepEqual([s.estado, s.accion], ['en-mercado', 'mantener']);
  // Las frías pueden ir más caras; el hielo de la caja se descuenta y se vuelve a sumar.
  s = sugerirPrecio({ precio: 2900, unidades: 1, variante: 'Fria' }, r(3200), null, {});
  assert.equal(s.sugerido, 3500);
  s = sugerirPrecio({ precio: 66600, unidades: 24, valorHielo: 5000 }, r(68800), null, {});
  assert.deepEqual([s.accion, s.sugerido], ['subir', 73800]);
  // Con costo: nunca por debajo del margen mínimo.
  s = sugerirPrecio({ precio: 21000, unidades: 6 }, r(18000), 17000, { margenMin: 15 });
  assert.deepEqual([s.sugerido, s.motivo], [19600, 'costo']);
  assert.ok(Math.abs(s.margen - 19.05) < 0.1);
  // Sin mercado: solo se avisa si deja pérdida.
  s = sugerirPrecio({ precio: 1000 }, null, 2000, {});
  assert.deepEqual([s.estado, s.accion, s.sugerido], ['perdida', 'subir', 2300]);
  assert.equal(s.cambio, 130, 'la vista muestra cuánto sube');
  assert.equal(sugerirPrecio({ precio: 1000 }, null, null, {}).accion, 'mantener');
});

test('analizar un producto guarda el resultado y los costos se validan', async () => {
  const { productos } = await estadoMiTienda();
  const lata = productos.find((p) => p.ml === 330 && p.unidades === 1);
  const resultado = await analizarProducto(lata.id);
  assert.equal(resultado.consulta, lata.consulta);
  assert.ok(!resultado.ofertas.some((o) => o.tienda === 'aguapure'), 'no se compara consigo misma');
  const despues = await estadoMiTienda();
  assert.equal(despues.productos.find((p) => p.id === lata.id).resultado.t, resultado.t);
  assert.deepEqual(await guardarCostos({ [lata.id]: '2100', 'mal id!': 5, otro: -1 }), { [lata.id]: 2100 });
  assert.deepEqual(await guardarCostos({ [lata.id]: null }), {});
  await assert.rejects(analizarProducto('no-existe'), TypeError);
});
