// La tienda pública (versión 2): la tienda del distribuidor con su nombre y su
// color, inicio, categorías con Unidad / Six pack / Caja, página de cada
// producto, buscador y lo que lee Google.
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
let respuestaEnvio = () => new Response(JSON.stringify({ success: true, data: { fee: '8000.00' } }));
globalThis.fetch = async (url) => {
  const u = String(url);
  if (/agua-pure\/delivery-quote\//.test(u)) return respuestaEnvio();
  return /trivo-pos\.com\/api\/public\/menu\/agua-pure/.test(u) ? respuestaTrivo() : new Response('no', { status: 404 });
};

const { armarCarta, estadoTienda, familia, filtrarCarta, nombreVisible, paginaHtml, paginaCategoria, presentacion, responderTienda, olvidarMemoria, rutaProducto } = await import(
  '../src/tienda.js'
);
const { colores, contraste, guardarMarca, limpiarMarca, olvidarMarca, siglaDe, MARCA_POR_DEFECTO } = await import('../src/marca.js');
const { enPanel } = await import('../src/push.js');

const copia = () => structuredClone(real.data);
const conMarca = (c, marca = MARCA_POR_DEFECTO) => ({ ...c, marca: marca.nombre, lema: marca.lema, tienda: limpiarMarca(marca), envio: 8000, ahora: Date.UTC(2026, 10, 13, 15) });
const pagina = async (ruta) => {
  const r = await responderTienda(new Request(`https://tienda.example${ruta}`));
  return { r, html: await r.text() };
};
const ldDe = (html) => [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

test('los nombres se ven limpios: sin «valledupar» ni «agua pure» de relleno', () => {
  assert.equal(nombreVisible('Hielo en cubo agua pure valledupar  3 kg'), 'Hielo en cubo 3 kg');
  assert.equal(nombreVisible('Caja de Aguila Original x 330ml + Hielo agua pure valledupar (3 kilos)'), 'Caja de Aguila Original x 330ml + Hielo (3 kilos)');
  assert.equal(nombreVisible('caja de cerveza Heineken x 24 unidades (lata) al por mayor valledupar'), 'Caja de cerveza Heineken x 24 unidades (lata) al por mayor');
  assert.equal(nombreVisible('Aguila Original fria  x 330ml (lata) valledupar'), 'Aguila Original fría x 330ml (lata)');
  assert.equal(nombreVisible('Agua Pure botella 600 ml'), 'Agua Pure botella 600 ml', 'si el producto se llama así, se deja');
});

test('la marca: nombre, iniciales y color de cada distribuidor; el color siempre se lee con texto blanco', () => {
  assert.deepEqual(limpiarMarca({}), { ...MARCA_POR_DEFECTO });
  assert.equal(siglaDe('Depósito El Pilón'), 'DP');
  assert.equal(siglaDe('Licorera La 19'), 'L1');
  const m = limpiarMarca({ nombre: '  Depósito   El Pilón ', sigla: '', color: '#1f4e8c', tiempo: '30–45 min', lema: 'x'.repeat(200) });
  assert.deepEqual([m.nombre, m.sigla, m.color, m.tiempo, m.lema.length], ['Depósito El Pilón', 'DP', '#1F4E8C', '30–45 min', 90]);
  assert.equal(limpiarMarca({ color: 'red', sigla: 'a<b' }).color, MARCA_POR_DEFECTO.color, 'un color raro vuelve al de siempre');
  assert.equal(limpiarMarca({ sigla: 'a<b>' }).sigla, 'AB');
  for (const color of ['#FFC53D', '#7FE0B0', '#FFFFFF', '#07794C']) {
    assert.ok(contraste(colores(color).marca, '#FFFFFF') >= 4.5, `${color} con texto blanco se lee`);
  }
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
  assert.deepEqual(c.semana['0'], ['08:00', '21:00']);
});

test('abierta o cerrada, con la hora de cierre o de apertura (hora de Bogotá; «0» es lunes)', () => {
  const semana = { 0: ['08:00', '21:00'], 1: ['08:00', '21:00'], 2: ['08:00', '21:00'], 3: ['08:00', '21:00'], 4: ['08:00', '00:00'], 5: ['09:00', '21:00'], 6: ['08:00', '21:00'] };
  // Viernes 13 de noviembre de 2026.
  assert.deepEqual(estadoTienda(true, semana, Date.UTC(2026, 10, 13, 15)), { abierto: true, texto: 'Abierto hasta medianoche' });
  assert.deepEqual(estadoTienda(false, semana, Date.UTC(2026, 10, 13, 11)), { abierto: false, texto: 'Cerrado · abre hoy a las 8:00 a. m.' });
  assert.deepEqual(estadoTienda(false, semana, Date.UTC(2026, 10, 14, 5)), { abierto: false, texto: 'Cerrado · abre hoy a las 9:00 a. m.' }, 'sábado 12:00 a. m.: abre ese día');
  assert.deepEqual(estadoTienda(false, semana, Date.UTC(2026, 10, 13, 3)), { abierto: false, texto: 'Cerrado · abre mañana a las 8:00 a. m.' }, 'jueves 10:00 p. m.: abre el viernes');
  assert.deepEqual(estadoTienda(true, null), { abierto: true, texto: 'Abierto ahora' });
});

test('el inicio: con el nombre de la tienda (no el de la carta), SEO de Valledupar y datos para Google', () => {
  const datos = copia();
  datos.sections[0].products[0].name = 'Agua <script>alert(1)</script> "x"';
  const c = conMarca(armarCarta(datos, { t: Date.UTC(2026, 10, 9, 16) }), { nombre: 'Depósito El Pilón', color: '#1F4E8C' });
  const html = paginaHtml(c, { base: 'https://tienda.example' });
  assert.match(html, /<title>Cerveza, hielo y agua a domicilio en Valledupar \| Depósito El Pilón<\/title>/);
  assert.match(html, /<meta name="description" content="Pide agua, hielo, cervezas y cabás con hielo a domicilio en Valledupar\./);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/">/);
  assert.match(html, /<h1 id="t-h1">Cerveza, hielo y agua a domicilio en Valledupar<\/h1>/);
  assert.match(html, /<span class="t-sigla" aria-hidden="true">DP<\/span>/);
  assert.match(html, /<link rel="stylesheet" href="\/marca\.css\?v=1f4e8cdp">/);
  assert.ok(!/agua pure|trivo/i.test(html.replace(/https:\/\/trivo-pos\.com\/api\/media\/[^"]+/g, '')), 'no se nombra la carta ni a TRIVO');
  assert.ok(!html.includes('<script>alert(1)'), 'los nombres de TRIVO se escapan');
  assert.match(html, /Agua &lt;script&gt;alert\(1\)&lt;\/script&gt; &quot;x&quot;/);
  assert.ok(!/style="/.test(html), 'sin estilos en línea (la página no los permite)');

  const ld = ldDe(html);
  assert.equal(ld[0]['@type'], 'LiquorStore');
  assert.equal(ld[0].name, 'Depósito El Pilón');
  assert.equal(ld[0].address.addressLocality, 'Valledupar');
  assert.equal(ld[0].telephone, '+573007643274');
  const total = c.secciones.reduce((n, s) => n + s.productos.length, 0);
  assert.equal(ld[1].itemListElement.length, total);
  assert.match(ld[1].itemListElement[0].url, /^https:\/\/tienda\.example\/producto\/[a-z0-9-]+-\d+$/);

  assert.deepEqual([...html.matchAll(/<li><a href="(\/categoria\/[a-z-]+)">/g)].map((m) => m[1]), ['/categoria/agua', '/categoria/hielo', '/categoria/cervezas', '/categoria/cabas-con-hielo']);
  assert.match(html, /<h2 id="t-reco">Recomendados<\/h2>/);
  assert.match(html, /<dt>Domicilio<\/dt><dd>\$8\.000<\/dd>/);
  assert.match(html, /<dt>Pedido mínimo<\/dt><dd>\$10\.000<\/dd>/);
  assert.ok(!html.includes('<dt>Llega en</dt>'), 'sin tiempo configurado no se inventa uno');
  assert.match(html, /<h3 class="t-prod-nombre"><a href="\/producto\/[a-z0-9-]+-\d+">/, 'el nombre de cada tarjeta lleva a su página');
  assert.match(html, /<a class="t-mas" href="\/producto\/[a-z0-9-]+-\d+" data-agregar="\d+" aria-label="Agregar /, '«+» agrega (sin JavaScript abre el producto)');
  const datosPagina = JSON.parse(html.match(/<script type="application\/json" id="t-datos">(.*?)<\/script>/)[1]);
  assert.equal(Object.keys(datosPagina.productos).length, total, 'el carrito y el buscador conocen todos los productos');
  assert.deepEqual([datosPagina.marca, datosPagina.sigla, datosPagina.minimo, datosPagina.whatsapp, datosPagina.envio], ['Depósito El Pilón', 'DP', 10000, '573007643274', 8000]);
  assert.equal((html.match(/fetchpriority="high"/g) || []).length, 5, 'la promoción y las cuatro primeras fotos cargan primero; el resto, al bajar');
  assert.match(html, /<section class="t-promo" aria-labelledby="t-promo">/);
});

test('si TRIVO falla sale la última carta buena; si nunca cargó, 503 sin nombrar a TRIVO', async () => {
  olvidarMemoria();
  respuestaTrivo = () => new Response('caído', { status: 500 });
  try {
    let { r, html } = await pagina('/');
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(html, /La tienda no cargó/);
    assert.ok(!/trivo/i.test(html));

    respuestaTrivo = () => new Response(JSON.stringify(real));
    ({ r, html } = await pagina('/'));
    assert.equal(r.status, 200);
    assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
    assert.match(r.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok(!html.includes('t-aviso'));

    olvidarMemoria();
    respuestaTrivo = () => new Response('caído', { status: 500 });
    ({ r, html } = await pagina('/'));
    assert.equal(r.status, 200);
    assert.match(html, /class="t-aviso">Estos precios son de la última vez/);
  } finally {
    respuestaTrivo = () => new Response(JSON.stringify(real));
    olvidarMemoria();
  }
});

test('el color y el ícono de la tienda salen de lo guardado en el panel', async () => {
  await guardarMarca({ nombre: 'Licorera La 19', color: '#B5482A' });
  try {
    const css = await (await responderTienda(new Request('https://tienda.example/marca.css'))).text();
    assert.match(css, /^:root\{--marca:#[0-9A-F]{6};--oscuro:#[0-9A-F]{6};--suave:#[0-9A-F]{6}\}/);
    const icono = await responderTienda(new Request('https://tienda.example/marca.svg'));
    assert.equal(icono.headers.get('content-type'), 'image/svg+xml; charset=utf-8');
    assert.match(await icono.text(), />L1<\/text>/);
    const { html } = await pagina('/');
    assert.match(html, /<strong>Licorera La 19<\/strong>/);
  } finally {
    await guardarMarca({});
    olvidarMarca();
  }
});

test('robots.txt deja ver la tienda y no el panel; el mapa del sitio lleva inicio, categorías y productos', async () => {
  const robots = await (await responderTienda(new Request('https://tienda.example/robots.txt'))).text();
  assert.match(robots, /Disallow: \/panel\n/);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/tienda\.example\/sitemap\.xml/);
  const mapa = await responderTienda(new Request('https://tienda.example/sitemap.xml'));
  assert.equal(mapa.headers.get('content-type'), 'application/xml; charset=utf-8');
  const xml = await mapa.text();
  assert.match(xml, /<loc>https:\/\/tienda\.example\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/tienda\.example\/productos<\/loc>/);
  assert.match(xml, /<loc>https:\/\/tienda\.example\/categoria\/cervezas<\/loc>/);
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

test('cada producto tiene su página: título, precio, datos para Google, migas y «Va bien con»', async () => {
  olvidarMemoria();
  const { r, html } = await pagina('/producto/hielo-en-cubo-3-kg-520');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('netlify-cdn-cache-control'), /s-maxage=300/);
  assert.match(html, /<title>Hielo en cubo 3 kg a domicilio en Valledupar \| Mejor Precio<\/title>/);
  assert.match(html, /<meta name="description" content="Hielo en cubo 3 kg a \$5\.000 con domicilio en Valledupar\. /);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/producto\/hielo-en-cubo-3-kg-520">/);
  assert.match(html, /<meta property="og:type" content="product">/);
  assert.match(html, /<h1>Hielo en cubo 3 kg<\/h1>/);
  const ld = ldDe(html);
  const producto = ld.find((d) => d['@type'] === 'Product');
  assert.equal(producto.name, 'Hielo en cubo 3 kg');
  assert.match(producto.image[0], /^https:\/\/trivo-pos\.com\//);
  assert.deepEqual([producto.offers.price, producto.offers.priceCurrency, producto.offers.availability], [5000, 'COP', 'https://schema.org/InStock']);
  const migas = ld.find((d) => d['@type'] === 'BreadcrumbList');
  assert.deepEqual(migas.itemListElement.map((x) => [x.name, x.item]), [
    ['Inicio', 'https://tienda.example/'],
    ['Hielo', 'https://tienda.example/categoria/hielo'],
    ['Hielo en cubo 3 kg', 'https://tienda.example/producto/hielo-en-cubo-3-kg-520'],
  ]);
  assert.match(html, /<div class="t-ficha-comprar" data-producto="520"><a class="t-boton t-grande" href="https:\/\/wa\.me\/573007643274\?text=[^"]+" data-agregar="520"/, 'sin JavaScript, «Agregar» pide por WhatsApp');
  assert.match(html, /class="t-duda">¿Tienes dudas\? <a href="https:\/\/wa\.me\/573007643274\?text=/);
  assert.ok(!html.includes('name="presentacion"'), 'sin presentaciones no hay nada que escoger');
  assert.match(html, /<h2 id="t-junto">Va bien con<\/h2>/);
  assert.match(html, /Más de hielo/, 'y otros productos de la misma sección, enlazados');
  assert.ok(!html.includes('href="/producto/hielo-en-cubo-3-kg-520"'), 'sin enlazarse a sí misma');
  assert.match(html, /Domicilio \$8\.000 · pedido mínimo \$10\.000\./);
});

test('la lata, el six pack y la caja de la misma cerveza se ven como presentaciones', async () => {
  assert.equal(familia('Aguila Original fría x 330ml (lata)'), 'aguila original');
  assert.equal(familia('Six pack Aguila Original x 6 unidades (lata)'), 'aguila original');
  assert.equal(familia('Caja Aguila Original x 24 unidades (lata) al por mayor'), 'aguila original');
  assert.equal(familia('Caja de cerveza Stella Artois x 24 unidades (lata)'), familia('Stella fría Artois x 269ml (lata)'));
  assert.equal(familia('Cerveza fría Pilsen x 330ml (lata)'), 'pilsen');
  assert.notEqual(familia('Hielo en cubo 3 kg'), familia('Hielo en cubo 10 kg'));

  olvidarMemoria();
  const c = armarCarta(copia(), { t: 1 });
  const sixAguila = c.secciones.flatMap((s) => s.productos).find((p) => p.grupo === 1 && /aguila/i.test(p.nombre));
  const { html } = await pagina(rutaProducto(sixAguila));
  const opciones = html.match(/<legend>Presentación<\/legend>[\s\S]*?<\/fieldset>/)[0];
  assert.deepEqual([...opciones.matchAll(/<span>([^<]+)<\/span>/g)].map((m) => m[1]), ['Unidad', 'Six pack', 'Caja']);
  assert.match(opciones, /aria-current="page"><span>Six pack<\/span>/);
});

test('presentaciones de TRIVO: la Aguila lata se escoge Caliente o Fría, cada una con su precio', async () => {
  const c = conMarca(armarCarta(copia(), { t: 1 }));
  const aguila = c.secciones.flatMap((s) => s.productos).find((p) => p.id === 598);
  assert.deepEqual(aguila.variantes, [{ id: 228, nombre: 'Caliente', precio: 2700 }, { id: 229, nombre: 'Fría', precio: 2900 }]);
  assert.deepEqual([aguila.precio, aguila.desde], [2700, true]);
  const lista = paginaCategoria(c, { base: 'https://t.example', seccion: c.secciones.find((s) => s.id === 'cervezas') });
  const tarjeta = lista.match(/<li class="t-prod" data-grupo="0" data-precio="2700">[\s\S]*?<\/li>/)[0];
  assert.match(tarjeta, /<small>Desde<\/small><strong>\$2\.700<\/strong>/);
  assert.match(tarjeta, /<p class="t-prod-detalle">Caliente · Fría<\/p>/);

  olvidarMemoria();
  const { html } = await pagina('/producto/aguila-original-fria-x-330ml-lata-598');
  assert.match(html, /<legend>Temperatura<\/legend>/);
  assert.match(html, /<input type="radio" name="presentacion" value="228" data-precio="2700" checked><span>Caliente<\/span><b>\$2\.700<\/b>/);
  assert.match(html, /<input type="radio" name="presentacion" value="229" data-precio="2900"><span>Fría<\/span><b>\$2\.900<\/b>/);
  const oferta = ldDe(html).find((d) => d['@type'] === 'Product').offers;
  assert.deepEqual([oferta['@type'], oferta.lowPrice, oferta.highPrice, oferta.offerCount], ['AggregateOffer', 2700, 2900, 2]);
  assert.match(html, /Presentaciones: Caliente \$2\.700, Fría \$2\.900\./);
});

test('direcciones: el nombre viejo redirige; producto o categoría que no está da 404', async () => {
  olvidarMemoria();
  let r = await responderTienda(new Request('https://tienda.example/producto/hielo-viejo-520'));
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), 'https://tienda.example/producto/hielo-en-cubo-3-kg-520');
  r = await responderTienda(new Request('https://tienda.example/producto/no-existe-99999'));
  assert.equal(r.status, 404);
  assert.match(await r.text(), /<meta name="robots" content="noindex">/);
  r = await responderTienda(new Request('https://tienda.example/categoria/no-existe'));
  assert.equal(r.status, 404);
  assert.equal(rutaProducto({ id: 7, nombre: 'Caja Póker x 24 unidades (lata)' }), '/producto/caja-poker-x-24-unidades-lata-7');
});

test('cada categoría va por unidad, luego six pack, luego caja, con pestañas y subtítulos', async () => {
  const c = armarCarta(copia(), { t: 1 });
  const cervezas = c.secciones.find((s) => s.id === 'cervezas');
  const grupos = cervezas.productos.map((p) => p.grupo);
  assert.deepEqual(grupos, [...grupos].sort((a, b) => a - b), 'nunca una caja antes que una unidad');
  assert.deepEqual([...new Set(grupos)], [0, 1, 2]);
  assert.equal(presentacion('Corona extra x 6 unidades (lata)'), 1);
  assert.equal(presentacion('Six pack Póker x 6 unidades (lata)'), 1);
  assert.equal(presentacion('Caja de cerveza Heineken x 24 unidades (lata) al por mayor'), 2);
  assert.equal(presentacion('Heineken fría x 330ml (lata)'), 0);
  assert.equal(presentacion('Agua Cristal 600 ml · paquete x 24'), 0, 'el agua «paquete x 24» no es una caja');
  assert.match(cervezas.productos.filter((p) => p.grupo === 1)[0].nombre, /Aguila/, 'dentro del grupo, por marca');
  assert.deepEqual(c.secciones.find((s) => s.id === 'hielo').productos.map((p) => p.nombre), ['Hielo en cubo 3 kg', 'Hielo en cubo 6 kg', 'Hielo en cubo 10 kg']);
  assert.deepEqual(
    c.secciones.find((s) => s.id === 'agua').productos.map((p) => p.nombre),
    ['Agua Cristal 300 ml · paquete x 12', 'Agua Cristal 600 ml · paquete x 24', 'Agua Cristal 1000 ml · paquete x 12', 'Bolsas de agua x 40'],
    'el agua de la más chica a la más grande',
  );

  olvidarMemoria();
  let { r, html } = await pagina('/categoria/cervezas');
  assert.equal(r.status, 200);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/categoria\/cervezas">/);
  assert.match(html, /<h1>Cervezas<\/h1>/);
  assert.deepEqual([...html.matchAll(/<h2 class="t-subgrupo">([^<]+) <span>/g)].map((m) => m[1]), ['Por unidad', 'Six pack', 'Cajas']);
  assert.match(html, /<h3 class="t-prod-nombre">/, 'debajo de un subtítulo, el producto es h3');
  assert.match(html, /data-pestanas hidden><button type="button" aria-pressed="true" data-grupo="">Todo<\/button><button type="button" aria-pressed="false" data-grupo="0">Unidad<\/button>/);
  assert.match(html, /<a href="\/categoria\/cervezas" aria-current="page">Cervezas<\/a>/);

  ({ html } = await pagina('/categoria/hielo'));
  assert.ok(!html.includes('t-subgrupo') && !html.includes('data-pestanas'), 'si todo es por unidad no hay subtítulos ni pestañas');
});

test('todos los productos y el buscador sin JavaScript (/productos?buscar=…)', async () => {
  olvidarMemoria();
  let { html } = await pagina('/productos');
  const total = real.data.sections.reduce((n, s) => n + s.products.length, 0);
  assert.equal((html.match(/<li class="t-prod/g) || []).length, total);
  assert.match(html, /<link rel="canonical" href="https:\/\/tienda\.example\/productos">/);
  ({ html } = await pagina('/productos?buscar=pilsen%20caja'));
  assert.match(html, /<meta name="robots" content="noindex, follow">/);
  assert.match(html, /<h1>Resultados para «pilsen caja»<\/h1>/);
  assert.match(html, /value="pilsen caja"/);
  const nombres = [...html.matchAll(/<h4 class="t-prod-nombre"><a href="[^"]+">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.ok(nombres.length && nombres.every((n) => /pilsen/i.test(n) && /caja/i.test(n)), nombres.join(' | '));
  ({ html } = await pagina('/productos?buscar=xyzzy'));
  assert.match(html, /<p class="t-vacio" data-vacio>No encontramos ese producto/);
  assert.deepEqual(
    filtrarCarta(armarCarta(copia(), { t: 1 }), 'costena').flatMap((s) => s.productos).length > 0,
    true,
    'sin tildes también encuentra',
  );
});
