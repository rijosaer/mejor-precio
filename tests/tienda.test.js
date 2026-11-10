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

const { armarCarta, nombreVisible, paginaHtml, presentacion, responderTienda, olvidarMemoria, rutaProducto } = await import('../src/tienda.js');
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

test('la página: SEO de Valledupar, datos para Google y Agregar en cada producto', () => {
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
  assert.match(ld[1].itemListElement[0].url, /^https:\/\/tienda\.example\/producto\/[a-z0-9-]+-\d+$/, 'la lista apunta a la página de cada producto');
  assert.match(html, /<h3><a href="\/producto\/[a-z0-9-]+-\d+">/, 'el nombre de cada tarjeta lleva a su página');

  const tarjetas = html.match(/<li class="t-producto/g).length;
  assert.equal(tarjetas, total);
  const agregar = html.match(/class="t-comprar" href="https:\/\/trivo-pos\.com\/m\/agua-pure" target="_blank" rel="noopener" data-agregar="\d+"/g) || [];
  assert.equal(agregar.length, total, 'cada producto tiene Agregar (sin JavaScript abre la carta de TRIVO)');
  const datosCarrito = JSON.parse(html.match(/<script type="application\/json" id="t-datos">(.*?)<\/script>/)[1]);
  assert.equal(Object.keys(datosCarrito.productos).length, total, 'el carrito conoce todos los productos');
  assert.equal(datosCarrito.minimo, 10000);
  assert.equal(datosCarrito.whatsapp, '573007643274');
  assert.match(html, /Pedido mínimo <b>\$ 10\.000<\/b>/);
  assert.match(html, /Pagas con <b>Nequi o Llave<\/b>/);
  assert.equal((html.match(/fetchpriority="high"/g) || []).length, 4, 'las cuatro primeras fotos cargan primero; el resto, al bajar');
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
  const xml = await mapa.text();
  assert.match(xml, /<loc>https:\/\/tienda\.example\/<\/loc>/);
  const total = real.data.sections.reduce((n, s) => n + s.products.length, 0);
  assert.equal((xml.match(/<loc>https:\/\/tienda\.example\/producto\//g) || []).length, total, 'cada producto en el mapa del sitio');
  assert.match(xml, /<url><loc>https:\/\/tienda\.example\/producto\/hielo-en-cubo-3-kg-520<\/loc><lastmod>[\d-]+<\/lastmod><image:image><image:loc>https:\/\/trivo-pos\.com\/api\/media\//);
});

test('los avisos abren el panel, no la tienda', () => {
  assert.equal(enPanel('/'), '/panel');
  assert.equal(enPanel('/#mitienda'), '/panel#mitienda');
  assert.equal(enPanel('/?q=aguila'), '/panel?q=aguila');
  assert.equal(enPanel('/panel#lista'), '/panel#lista');
});

test('cada producto tiene su página: título, precio, datos de producto para Google y migas', async () => {
  olvidarMemoria();
  const r = await responderTienda(new Request('https://tienda.example/producto/hielo-en-cubo-3-kg-520'));
  assert.equal(r.status, 200);
  assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
  const html = await r.text();
  assert.match(html, /<title>Hielo en cubo 3 kg a domicilio en Valledupar \| Agua Pure<\/title>/);
  assert.match(html, /<meta name="description" content="Hielo en cubo 3 kg a \$ 5\.000 con domicilio en Valledupar\. /);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/producto\/hielo-en-cubo-3-kg-520">/);
  assert.match(html, /<meta property="og:type" content="product">/);
  assert.match(html, /<h1>Hielo en cubo 3 kg<\/h1>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const producto = ld.find((d) => d['@type'] === 'Product');
  assert.equal(producto.name, 'Hielo en cubo 3 kg');
  assert.match(producto.image[0], /^https:\/\/trivo-pos\.com\//);
  assert.deepEqual([producto.offers.price, producto.offers.priceCurrency, producto.offers.availability], [5000, 'COP', 'https://schema.org/InStock']);
  assert.equal(producto.offers.url, 'https://tienda.example/producto/hielo-en-cubo-3-kg-520');
  const migas = ld.find((d) => d['@type'] === 'BreadcrumbList');
  assert.deepEqual(migas.itemListElement.map((x) => x.name), ['Inicio', 'Hielo', 'Hielo en cubo 3 kg']);
  assert.match(html, /<div class="t-ficha-botones" data-producto="520"><a class="t-comprar t-grande" href="https:\/\/trivo-pos\.com\/m\/agua-pure" target="_blank" rel="noopener" data-agregar="520"/);
  assert.match(html, /<span>Agregar al pedido<\/span>/);
  assert.match(html, /class="t-duda">¿Tienes dudas\? <a href="https:\/\/wa\.me\/573007643274\?text=/);
  assert.ok(!html.includes('t-presentaciones'), 'sin presentaciones no hay nada que escoger');
  assert.match(html, /Más de hielo/, 'y otros productos de la misma sección, enlazados');
  assert.ok(!html.includes('href="/producto/hielo-en-cubo-3-kg-520"'), 'sin enlazarse a sí misma');
});

test('dirección de producto: el nombre viejo redirige, el que ya no está da 404', async () => {
  let r = await responderTienda(new Request('https://tienda.example/producto/hielo-viejo-520'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://tienda.example/producto/hielo-en-cubo-3-kg-520');
  r = await responderTienda(new Request('https://tienda.example/producto/no-existe-99999'));
  assert.equal(r.status, 404);
  assert.match(await r.text(), /<meta name="robots" content="noindex">/);
  assert.equal(rutaProducto({ id: 7, nombre: 'Caja Póker x 24 unidades (lata)' }), '/producto/caja-poker-x-24-unidades-lata-7');
});

test('cada sección va por unidad, luego six pack, luego caja; con subtítulos si se mezclan', () => {
  const c = armarCarta(copia(), { t: 1 });
  const cervezas = c.secciones.find((s) => s.id === 'cervezas');
  const grupos = cervezas.productos.map((p) => p.grupo);
  assert.deepEqual(grupos, [...grupos].sort((a, b) => a - b), 'nunca una caja antes que una unidad');
  assert.deepEqual([...new Set(grupos)], [0, 1, 2]);
  assert.equal(presentacion('Corona extra x 6 unidades (lata)'), 1);
  assert.equal(presentacion('Six pack Póker x 6 unidades (lata)'), 1);
  assert.equal(presentacion('Caja de cerveza Heineken x 24 unidades (lata) al por mayor'), 2);
  assert.equal(presentacion('Heineken fría x 330ml (lata)'), 0);
  const seis = cervezas.productos.filter((p) => p.grupo === 1).map((p) => p.nombre);
  assert.match(seis[0], /Aguila/, 'dentro del grupo, por marca');
  assert.deepEqual(c.secciones.find((s) => s.id === 'hielo').productos.map((p) => p.nombre), ['Hielo en cubo 3 kg', 'Hielo en cubo 6 kg', 'Hielo en cubo 10 kg']);

  const html = paginaHtml(c, { base: 'https://tienda.example' });
  const bloque = html.slice(html.indexOf('id="cervezas"'), html.indexOf('id="cabas-con-hielo"'));
  assert.deepEqual([...bloque.matchAll(/<h3 class="t-subgrupo">([^<]+) <span>/g)].map((m) => m[1]), ['Por unidad', 'Six pack', 'Cajas']);
  assert.match(bloque, /<h4><a href="\/producto\//, 'debajo de un subtítulo, el producto es h4');
  const hielo = html.slice(html.indexOf('id="hielo"'), html.indexOf('id="cervezas"'));
  assert.ok(!hielo.includes('t-subgrupo'), 'si todo es por unidad no hay subtítulos');
});

test('presentaciones: la Aguila lata se ve con Caliente y Fría, cada una con su precio', async () => {
  const c = armarCarta(copia(), { t: 1 });
  const aguila = c.secciones.flatMap((s) => s.productos).find((p) => p.id === 598);
  assert.deepEqual(aguila.variantes, [{ id: 228, nombre: 'Caliente', precio: 2700 }, { id: 229, nombre: 'Fría', precio: 2900 }]);
  assert.deepEqual([aguila.precio, aguila.desde], [2700, true]);
  const tarjetaHtml = paginaHtml(c, { base: 'https://t.example' }).match(/<li class="t-producto" id="producto-598"[\s\S]*?<\/li>/)[0];
  assert.match(tarjetaHtml, /<small class="t-desde">Desde<\/small><strong>\$ 2\.700<\/strong>/);
  assert.match(tarjetaHtml, /<p class="t-variantes">Caliente · Fría<\/p>/);
  assert.match(tarjetaHtml, /<span>Escoger<\/span>/, 'en la tarjeta el botón abre para escoger la presentación');

  olvidarMemoria();
  const html = await (await responderTienda(new Request('https://t.example/producto/aguila-original-fria-x-330ml-lata-598'))).text();
  assert.match(html, /<legend>Presentación<\/legend>/);
  assert.match(html, /<input type="radio" name="presentacion" value="228" data-precio="2700" checked><span>Caliente<\/span><b>\$ 2\.700<\/b>/);
  assert.match(html, /<input type="radio" name="presentacion" value="229" data-precio="2900"><span>Fría<\/span><b>\$ 2\.900<\/b>/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const oferta = ld.find((d) => d['@type'] === 'Product').offers;
  assert.deepEqual([oferta['@type'], oferta.lowPrice, oferta.highPrice, oferta.offerCount], ['AggregateOffer', 2700, 2900, 2]);
  assert.match(html, /Presentaciones: Caliente \$ 2\.700, Fría \$ 2\.900\./);
});
