// La tienda pública (página principal): la carta de TRIVO como catálogo con
// fotos, «Comprar» hacia TRIVO, «Pedir» por WhatsApp y lo que lee Google.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-tienda-'));
process.env.DATOS_DIR = carpeta;
delete process.env.URL;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const real = JSON.parse(await readFile(new URL('./fixtures/trivo-carta.json', import.meta.url), 'utf8'));
let respuestaTrivo = () => new Response(JSON.stringify(real));
globalThis.fetch = async (url) => (/trivo-pos\.com\/api\/public\/menu\/agua-pure/.test(String(url)) ? respuestaTrivo() : new Response('no', { status: 404 }));

const { armarCarta, nombreVisible, paginaHtml, responderTienda, olvidarMemoria } = await import('../src/tienda.js');
const { enPanel } = await import('../src/push.js');

const copia = () => structuredClone(real.data);

test('los nombres se ven limpios: sin «valledupar» ni «agua pure» de relleno', () => {
  assert.equal(nombreVisible('Hielo en cubo agua pure valledupar  3 kg'), 'Hielo en cubo 3 kg');
  assert.equal(nombreVisible('Caja de Aguila Original x 330ml + Hielo agua pure valledupar (3 kilos)'), 'Caja de Aguila Original x 330ml + Hielo (3 kilos)');
  assert.equal(nombreVisible('caja de cerveza Heineken x 24 unidades (lata) al por mayor valledupar'), 'Caja de cerveza Heineken x 24 unidades (lata) al por mayor');
  assert.equal(nombreVisible('Aguila Original fria  x 330ml (lata) valledupar'), 'Aguila Original fría x 330ml (lata)');
  assert.equal(nombreVisible('Agua Pure botella 600 ml'), 'Agua Pure botella 600 ml', 'si el producto se llama así, se deja');
});

test('la carta: orden de TRIVO, sin lo oculto, lo destacado primero y los datos del negocio', () => {
  const datos = copia();
  datos.theme.curation.hiddenProducts.push(datos.sections[0].products[0].id);
  datos.sections[2].products[1].active_promo = { promo_price: '2500.00' };
  datos.sections[2].products[2].is_available = false;
  const c = armarCarta(datos, { t: 1 });
  assert.deepEqual(c.secciones.map((s) => [s.id, s.nombre]), [['agua', 'Agua'], ['hielo', 'Hielo'], ['cervezas', 'Cervezas'], ['cabas-con-hielo', 'Cabás con hielo']]);
  assert.equal(c.secciones[0].productos.length, datos.sections[0].products.length - 1, 'el producto oculto en TRIVO no sale');
  assert.equal(c.secciones[1].productos[0].id, 520, 'el destacado va primero');
  assert.ok(c.secciones.flatMap((s) => s.productos).every((p) => !/valledupar/i.test(p.nombre)));
  const promo = c.secciones[2].productos.find((p) => p.id === datos.sections[2].products[1].id);
  assert.deepEqual([promo.precio, promo.antes], [2500, 3200]);
  assert.equal(c.secciones[2].productos.find((p) => p.id === datos.sections[2].products[2].id).disponible, false);
  assert.match(c.secciones[1].productos[0].imagen, /^https:\/\/trivo-pos\.com\/api\/media\//);
  assert.equal(c.whatsapp, '573007643274');
  assert.deepEqual(c.pedidos, { enLinea: true, minimo: 10000, pagos: ['Nequi', 'Llave'], nota: datos.theme.ordering.note });
  assert.deepEqual(c.horario, { abre: '08:00', cierra: '21:00' });
});

test('la página: SEO de Valledupar, datos para Google, Comprar hacia TRIVO y Pedir por WhatsApp', () => {
  const datos = copia();
  datos.sections[0].products[0].name = 'Agua <script>alert(1)</script> "x"';
  const c = armarCarta(datos, { t: Date.UTC(2026, 10, 9, 16) });
  const html = paginaHtml(c, { base: 'https://tienda.example' });
  assert.match(html, /<title>Cerveza, hielo y agua a domicilio en Valledupar \| Agua Pure<\/title>/);
  assert.match(html, /<meta name="description" content="Pide agua, hielo, cervezas y cabás con hielo a domicilio en Valledupar\./);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/">/);
  assert.match(html, /<h1>Cerveza, hielo y agua a domicilio en Valledupar<\/h1>/);
  assert.ok(!html.includes('<script>alert(1)'), 'los nombres de TRIVO se escapan');
  assert.match(html, /Agua &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot;/);

  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  assert.equal(ld[0]['@type'], 'LiquorStore');
  assert.equal(ld[0].address.addressLocality, 'Valledupar');
  assert.equal(ld[0].telephone, '+573007643274');
  const total = c.secciones.reduce((n, s) => n + s.productos.length, 0);
  assert.equal(ld[1].itemListElement.length, total);
  assert.deepEqual(Object.keys(ld[1].itemListElement[0].item.offers).slice(0, 3), ['@type', 'price', 'priceCurrency']);

  const tarjetas = html.match(/<li class="t-producto/g).length;
  assert.equal(tarjetas, total);
  assert.equal((html.match(/class="t-comprar" href="https:\/\/trivo-pos\.com\/m\/agua-pure"/g) || []).length, total, 'cada producto tiene Comprar hacia la carta de TRIVO');
  const wa = html.match(/class="t-wa" href="(https:\/\/wa\.me\/573007643274\?text=[^"]+)"/);
  assert.ok(wa, 'y Pedir por WhatsApp');
  const texto = decodeURIComponent(new URL(wa[1].replace(/&amp;/g, '&')).searchParams.get('text'));
  assert.match(texto, /^Hola Agua Pure, quiero pedir:\n• 1 × .+\(\$ [\d.]+\)\n\nMi dirección es: $/);
  assert.match(html, /Pedido mínimo <b>\$ 10\.000<\/b>/);
  assert.match(html, /Pagas con <b>Nequi o Llave<\/b>/);
  assert.equal((html.match(/fetchpriority="high"/g) || []).length, 5, 'la portada y las cuatro primeras fotos cargan primero; el resto, al bajar');
});

test('si TRIVO falla sale la última carta buena; si nunca cargó, 503 y enlace a TRIVO', async () => {
  olvidarMemoria();
  respuestaTrivo = () => new Response('caído', { status: 500 });
  let r = await responderTienda(new Request('https://tienda.example/'));
  assert.equal(r.status, 503);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.match(await r.text(), /trivo-pos\.com\/m\/agua-pure/);

  respuestaTrivo = () => new Response(JSON.stringify(real));
  r = await responderTienda(new Request('https://tienda.example/'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
  assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
  assert.ok(!(await r.text()).includes('t-aviso'));

  olvidarMemoria();
  respuestaTrivo = () => new Response('caído', { status: 500 });
  r = await responderTienda(new Request('https://tienda.example/'));
  assert.equal(r.status, 200);
  assert.match(await r.text(), /class="t-aviso">Estos precios son de la última vez/);
  respuestaTrivo = () => new Response(JSON.stringify(real));
});

test('robots.txt deja ver la tienda y no el panel; el mapa del sitio apunta a la página principal', async () => {
  const robots = await (await responderTienda(new Request('https://tienda.example/robots.txt'))).text();
  assert.match(robots, /Disallow: \/panel\n/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/tienda\.example\/sitemap\.xml/);
  const mapa = await responderTienda(new Request('https://tienda.example/sitemap.xml'));
  assert.equal(mapa.headers.get('content-type'), 'application/xml; charset=utf-8');
  assert.match(await mapa.text(), /<loc>https:\/\/tienda\.example\/<\/loc>/);
});

test('los avisos abren el panel, no la tienda', () => {
  assert.equal(enPanel('/'), '/panel');
  assert.equal(enPanel('/#mitienda'), '/panel#mitienda');
  assert.equal(enPanel('/?q=aguila'), '/panel?q=aguila');
  assert.equal(enPanel('/panel#lista'), '/panel#lista');
});
