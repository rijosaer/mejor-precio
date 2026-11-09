// La página principal: la tienda pública de Agua Pure, sin clave. Muestra la
// carta de TRIVO como catálogo con fotos; cada producto tiene «Comprar» (abre
// la carta de TRIVO, donde se arma el pedido) y «Pedir» (abre WhatsApp con el
// producto ya escrito). Se arma en el servidor para que Google lea los
// productos, los precios y los datos del negocio en Valledupar.
// El panel administrativo (la app con clave) quedó en /panel.
import { escribir, leer } from './almacen.js';
import { pedir } from './http.js';
import { BASE, SLUG } from './tiendas/aguapure.js';

const CARTA = `${BASE}/m/${SLUG}`;
// La última carta buena: si TRIVO no responde, la página sale con esa.
const CLAVE = 'tienda-carta';
const MEMORIA = 60_000;
let enMemoria = null;

const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

// En la carta los nombres llevan «valledupar» y «agua pure» para el buscador de
// TRIVO: «Hielo en cubo agua pure valledupar 3 kg» → «Hielo en cubo 3 kg».
export function nombreVisible(nombre) {
  const n = String(nombre || '')
    .replace(/\bvalledupar\b/gi, ' ')
    .replace(/(\S)\s+agua pure\b/gi, '$1')
    .replace(/\bfria\b/g, 'fría')
    .replace(/\s+([)\]])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return n.charAt(0).toLocaleUpperCase('es-CO') + n.slice(1);
}

const slug = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'productos';

const absoluta = (ruta) => {
  if (!ruta) return null;
  try {
    const u = new URL(ruta, BASE);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
};

const soloDigitos = (x) => String(x || '').replace(/\D/g, '');

// «3007643274» → «573007643274»: wa.me pide el número con indicativo.
function numeroWhatsapp(datos) {
  const n = soloDigitos(datos.theme?.ordering?.whatsappNumber) || soloDigitos(datos.theme?.social?.whatsapp) || soloDigitos(datos.branch?.phone);
  if (!n) return null;
  return n.length === 10 ? `57${n}` : n;
}

// El horario solo va a Google si es el mismo todos los días (así no hay que
// adivinar si TRIVO cuenta la semana desde el lunes o desde el domingo).
function horarioUnico(horas) {
  const dias = Object.values(horas || {});
  if (dias.length !== 7 || !dias.every((d) => Array.isArray(d) && d.length === 2)) return null;
  const [abre, cierra] = dias[0];
  return dias.every(([a, c]) => a === abre && c === cierra) ? { abre, cierra } : null;
}

// De la respuesta de TRIVO a lo que pinta la página: secciones en el orden de
// la carta, sin lo que el negocio ocultó, con lo destacado primero.
export function armarCarta(datos, { t = Date.now() } = {}) {
  const tema = datos.theme || {};
  const cur = tema.curation || {};
  const ocultasS = new Set(cur.hiddenCategories || []);
  const ocultosP = new Set(cur.hiddenProducts || []);
  const destacados = new Set(cur.featuredProducts || []);
  const orden = cur.categoryOrder || [];
  const posicion = (id) => (orden.includes(id) ? orden.indexOf(id) : orden.length);
  const pedidos = tema.ordering || {};

  const secciones = (datos.sections || [])
    .filter((s) => !ocultasS.has(s.id))
    .map((s, i) => ({ s, i }))
    .sort((a, b) => posicion(a.s.id) - posicion(b.s.id) || a.i - b.i)
    .map(({ s }) => {
      const nombre = nombreVisible(s.name);
      const productos = (s.products || [])
        .filter((p) => !ocultosP.has(p.id))
        .map((p, i) => {
          const variantes = (p.variants || []).map((v) => Number(v.price)).filter((x) => x > 0);
          const lista = variantes.length ? Math.min(...variantes) : Number(p.price);
          const promo = !variantes.length && p.active_promo ? Number(p.active_promo.promo_price) : null;
          const precio = promo && promo < lista ? promo : lista;
          return {
            id: p.id,
            nombre: nombreVisible(p.name),
            descripcion: String(p.description || '').trim(),
            precio,
            antes: precio < lista ? lista : null,
            desde: variantes.length > 1,
            imagen: absoluta(p.image_url),
            disponible: p.is_available !== false,
            destacado: destacados.has(p.id) || Boolean(p.is_featured),
            i,
          };
        })
        .filter((p) => p.nombre && p.precio > 0)
        .sort((a, b) => (tema.sections?.featuredFirst !== false ? b.destacado - a.destacado : 0) || a.i - b.i)
        .map(({ i: _i, ...p }) => p);
      return { id: slug(nombre), nombre, productos };
    })
    .filter((s) => s.productos.length);

  return {
    t,
    marca: datos.brand?.name || 'Agua Pure',
    lema: tema.branding?.tagline || '',
    logo: absoluta(tema.branding?.logoUrl || datos.brand?.logo_url),
    portada: absoluta(tema.branding?.coverUrl || datos.menu?.cover_url),
    ciudad: datos.branch?.city || 'Valledupar',
    telefono: soloDigitos(datos.branch?.phone) || null,
    direccion: datos.branch?.address || null,
    horario: horarioUnico(datos.branch?.opening_hours),
    whatsapp: numeroWhatsapp(datos),
    instagram: absoluta(tema.social?.instagram),
    pedidos: {
      enLinea: pedidos.enabled !== false,
      minimo: Number(pedidos.minOrder) || null,
      pagos: Array.isArray(pedidos.paymentMethods) ? pedidos.paymentMethods.map(String) : [],
      nota: pedidos.note ? String(pedidos.note) : '',
    },
    secciones,
  };
}

// La carta: de memoria (un minuto), de TRIVO, y si TRIVO falla, la última buena.
export async function cargarCarta({ ahora = Date.now() } = {}) {
  if (enMemoria && ahora - enMemoria.t < MEMORIA) return enMemoria;
  try {
    const respuesta = await pedir(`${BASE}/api/public/menu/${SLUG}/`, { tiempo: 8000 });
    const carta = armarCarta(respuesta?.data || {}, { t: ahora });
    if (!carta.secciones.length) throw new Error('La carta llegó vacía');
    enMemoria = carta;
    await escribir(CLAVE, carta).catch((error) => console.error('[tienda]', error.message));
    return carta;
  } catch (error) {
    console.error('[tienda] TRIVO:', error.message);
    const guardada = await leer(CLAVE).catch(() => null);
    if (guardada?.secciones?.length) return { ...guardada, vieja: true };
    return null;
  }
}

// ── HTML ────────────────────────────────────────────────────────────────────
const esc = (x) =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const precioTexto = (n) => pesos.format(n).replace(/\s/g, ' ');

const telefonoTexto = (n) => (n?.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n);

export function enlaceWhatsapp(numero, texto) {
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

const textoPedido = (marca, p) => `Hola ${marca}, quiero pedir:\n• 1 × ${p.nombre} (${precioTexto(p.precio)})\n\nMi dirección es: `;

const ICONOS = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.5" fill="currentColor"/></svg>',
  gota: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6C17 16 12 22.5 12 29a12 12 0 0 0 24 0c0-6.5-5-13-12-23Z" fill="currentColor"/></svg>',
  hielo: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 39 14.5v19L24 42 9 33.5v-19L24 6Zm0 0v17m0 0 15-8.5M24 23 9 14.5M24 23v19" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  lata: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 8h16l2 4v26l-2 3H16l-2-3V12l2-4Z" fill="currentColor"/><path d="M14 17h20M14 33h20" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>',
};

const iconoDe = (seccion) => (/hielo/i.test(seccion) && !/cerve|caja|cab/i.test(seccion) ? 'hielo' : /agua/i.test(seccion) ? 'gota' : 'lata');

// Las primeras fotos (las que se ven al abrir) cargan ya; las demás, al bajar.
function tarjeta(p, seccion, carta, pendientes) {
  const wa = enlaceWhatsapp(carta.whatsapp, textoPedido(carta.marca, p));
  const foto = p.imagen
    ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="400" height="300" ${pendientes.fotos-- > 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : `<div class="t-sinfoto t-sinfoto-${iconoDe(seccion.nombre)}">${ICONOS[iconoDe(seccion.nombre)]}</div>`;
  const precio = `${p.desde ? '<span class="t-desde">Desde</span> ' : ''}<strong>${precioTexto(p.precio)}</strong>${p.antes ? ` <s>${precioTexto(p.antes)}</s>` : ''}`;
  const botones = p.disponible
    ? `<a class="t-comprar" href="${CARTA}" target="_blank" rel="noopener" aria-label="Comprar ${esc(p.nombre)} en nuestra carta">${ICONOS.bolsa}<span>Comprar</span></a>` +
      (wa ? `<a class="t-wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Pedir ${esc(p.nombre)} por WhatsApp">${ICONOS.chat}<span>Pedir</span></a>` : '')
    : '<span class="t-agotado">Agotado por ahora</span>';
  return `<li class="t-producto${p.disponible ? '' : ' t-no'}" id="producto-${esc(p.id)}" data-buscar="${esc(`${p.nombre} ${seccion.nombre}`)}">
  <figure class="t-foto">${foto}${p.antes ? '<span class="t-cinta">Promo</span>' : p.destacado ? '<span class="t-cinta">Destacado</span>' : ''}</figure>
  <div class="t-info">
    <h3>${esc(p.nombre)}</h3>
    ${p.descripcion ? `<p class="t-desc">${esc(p.descripcion)}</p>` : ''}
    <p class="t-precio">${precio}</p>
    <div class="t-botones">${botones}</div>
  </div>
</li>`;
}

// Título y descripción para Google: lo que de verdad se vende, en Valledupar.
function textosSeo(carta) {
  const nombres = carta.secciones.map((s) => s.nombre.toLowerCase());
  const hay = (re) => nombres.some((n) => re.test(n));
  const cosas = [hay(/cervez|cab/) && 'cerveza', hay(/licor|aguardiente|ron|whisk/) && 'licores', hay(/hielo|cab/) && 'hielo', hay(/agua/) && 'agua'].filter(Boolean);
  const lista = cosas.length ? cosas : ['bebidas'];
  const enLista = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}` : lista[0];
  const titulo = `${enLista.charAt(0).toUpperCase()}${enLista.slice(1)} a domicilio en ${carta.ciudad} | ${carta.marca}`;
  const descripcion = `Pide ${nombres.join(', ').replace(/, ([^,]*)$/, ' y $1')} a domicilio en ${carta.ciudad}. Mira fotos y precios al día, y compra en nuestra carta o por WhatsApp.`;
  return { titulo, descripcion, enLista };
}

function datosEstructurados(carta, base) {
  const negocio = {
    '@context': 'https://schema.org',
    '@type': 'LiquorStore',
    name: carta.marca,
    description: carta.lema || undefined,
    url: `${base}/`,
    image: carta.portada || carta.logo || undefined,
    logo: carta.logo || undefined,
    telephone: carta.telefono ? `+57${carta.telefono}` : undefined,
    address: { '@type': 'PostalAddress', streetAddress: carta.direccion || undefined, addressLocality: carta.ciudad, addressRegion: 'Cesar', addressCountry: 'CO' },
    areaServed: { '@type': 'City', name: carta.ciudad },
    currenciesAccepted: 'COP',
    paymentAccepted: carta.pedidos.pagos.join(', ') || undefined,
    sameAs: carta.instagram ? [carta.instagram] : undefined,
    openingHoursSpecification: carta.horario
      ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: carta.horario.abre, closes: carta.horario.cierra }]
      : undefined,
  };
  const productos = carta.secciones.flatMap((s) => s.productos);
  const catalogo = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Productos de ${carta.marca} en ${carta.ciudad}`,
    itemListElement: productos.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'Product',
        name: p.nombre,
        image: p.imagen || undefined,
        description: p.descripcion || undefined,
        offers: {
          '@type': 'Offer',
          price: p.precio,
          priceCurrency: 'COP',
          availability: p.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
          url: `${base}/#producto-${p.id}`,
          seller: { '@type': 'Organization', name: carta.marca },
        },
      },
    })),
  };
  // «</script>» dentro del JSON cerraría la etiqueta.
  return [negocio, catalogo].map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n');
}

const fechaTexto = (t) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(t);

export function paginaHtml(carta, { base }) {
  const { titulo, descripcion, enLista } = textosSeo(carta);
  const waGeneral = enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero hacer un pedido a domicilio en ${carta.ciudad}.`);
  const chips = [
    `${ICONOS.pin}<span>Domicilios en <b>${esc(carta.ciudad)}</b></span>`,
    carta.pedidos.minimo ? `<span>Pedido mínimo <b>${precioTexto(carta.pedidos.minimo)}</b></span>` : '',
    carta.pedidos.pagos.length ? `<span>Pagas con <b>${esc(carta.pedidos.pagos.join(' o '))}</b></span>` : '',
  ].filter(Boolean);
  const pendientes = { fotos: 4 };
  const secciones = carta.secciones
    .map(
      (s) => `<section class="t-seccion" id="${esc(s.id)}" aria-labelledby="t-${esc(s.id)}">
<h2 id="t-${esc(s.id)}">${esc(s.nombre)} <small>${s.productos.length}</small></h2>
<ul class="t-rejilla">
${s.productos.map((p) => tarjeta(p, s, carta, pendientes)).join('\n')}
</ul>
</section>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
<link rel="canonical" href="${esc(base)}/">
<meta name="robots" content="index, follow, max-image-preview:large">
<meta name="theme-color" content="#102c3f">
<meta name="color-scheme" content="light">
<meta name="geo.region" content="CO-CES">
<meta name="geo.placename" content="${esc(carta.ciudad)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_CO">
<meta property="og:site_name" content="${esc(carta.marca)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
<meta property="og:url" content="${esc(base)}/">
${carta.portada ? `<meta property="og:image" content="${esc(carta.portada)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
${carta.logo ? `<link rel="icon" href="${esc(carta.logo)}">\n<link rel="apple-touch-icon" href="${esc(carta.logo)}">` : '<link rel="icon" href="icons/icon-192.png" type="image/png">'}
<link rel="preload" href="fuentes/montserrat-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="tienda.css">
${datosEstructurados(carta, base)}
<script src="tienda.js" type="module"></script>
</head>
<body>
<a class="t-saltar" href="#productos">Ir a los productos</a>
<header class="t-barra">
  <div class="t-ancho t-barra-dentro">
    <a class="t-marca" href="./" aria-label="${esc(carta.marca)}, inicio">
      ${carta.logo ? `<img src="${esc(carta.logo)}" alt="" width="44" height="44">` : ''}
      <span>${esc(carta.marca)}<small>Ice &amp; bebidas</small></span>
    </a>
    ${waGeneral ? `<a class="t-ayuda" href="${esc(waGeneral)}" target="_blank" rel="noopener">${ICONOS.chat}<span>¿Te ayudamos?</span></a>` : ''}
  </div>
</header>

<section class="t-portada">
  ${carta.portada ? `<img class="t-portada-foto" src="${esc(carta.portada)}" alt="" width="1536" height="1024" fetchpriority="high">` : ''}
  <div class="t-ancho t-portada-texto">
    <h1>${esc(enLista.charAt(0).toUpperCase() + enLista.slice(1))} a domicilio en ${esc(carta.ciudad)}</h1>
    <p>${esc(carta.lema || 'Bebidas frías a tu puerta.')}</p>
    <ul class="t-chips">${chips.map((c) => `<li>${c}</li>`).join('')}</ul>
    <div class="t-portada-botones">
      <a class="t-comprar t-grande" href="#productos">Ver productos</a>
      ${waGeneral ? `<a class="t-wa t-grande" href="${esc(waGeneral)}" target="_blank" rel="noopener">${ICONOS.chat}<span>Pedir por WhatsApp</span></a>` : ''}
    </div>
  </div>
</section>

<nav class="t-secciones" aria-label="Secciones">
  <div class="t-ancho t-secciones-dentro">
    <ul>${carta.secciones.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.nombre)}</a></li>`).join('')}</ul>
    <label class="t-buscar" hidden><span class="t-oculto">Buscar un producto</span><input type="search" placeholder="Buscar: Aguila, hielo, six pack…" autocomplete="off"></label>
  </div>
</nav>

<main id="productos" class="t-ancho">
${carta.vieja ? '<p class="t-aviso">Estos precios son de la última vez que cargó nuestra carta. Confirma el precio al pedir.</p>' : ''}
${secciones}
<p class="t-vacio" hidden>No encontramos ese producto. ${waGeneral ? `<a href="${esc(waGeneral)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>.` : ''}</p>
</main>

<footer class="t-pie">
  <div class="t-ancho">
    <p><b>${esc(carta.marca)}</b> · Domicilios en ${esc(carta.ciudad)}, Cesar${carta.direccion ? ` · ${esc(carta.direccion)}` : ''}</p>
    ${carta.pedidos.nota ? `<p>${esc(carta.pedidos.nota)}</p>` : ''}
    <p>${carta.telefono ? `Teléfono y WhatsApp: <a href="tel:+57${esc(carta.telefono)}">${esc(telefonoTexto(carta.telefono))}</a>` : ''}${carta.instagram ? ` · <a href="${esc(carta.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''} · <a href="${CARTA}" target="_blank" rel="noopener">Nuestra carta en TRIVO</a></p>
    <p class="t-fecha">Precios en pesos colombianos, al ${esc(fechaTexto(carta.t))}. La venta de bebidas alcohólicas es solo para mayores de edad. El exceso de alcohol es perjudicial para la salud.</p>
  </div>
</footer>
</body>
</html>`;
}

// Cuando la carta no se pudo leer nunca: una página corta que manda a TRIVO.
function paginaSinCarta() {
  return `<!doctype html>
<html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agua Pure · Valledupar</title><meta name="robots" content="noindex"><link rel="stylesheet" href="tienda.css"><script src="tienda.js" type="module"></script></head>
<body><main class="t-ancho t-caida"><h1>Agua Pure</h1><p>La carta no cargó en este momento.</p><p><a class="t-comprar t-grande" href="${CARTA}">Ver la carta y pedir</a></p></main></body></html>`;
}

// Los encabezados de netlify.toml no llegan a las respuestas de funciones.
const SEGURIDAD = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'content-security-policy': "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

// La CDN de Netlify guarda la página 5 minutos y la sirve vieja (mientras
// refresca) si TRIVO tarda: Google y los clientes la reciben rápido.
const CACHE = { 'cache-control': 'public, max-age=60', 'netlify-cdn-cache-control': 'public, durable, s-maxage=300, stale-while-revalidate=86400' };

const baseDe = (request) => (process.env.URL || new URL(request.url).origin).replace(/\/$/, '');

export async function responderTienda(request) {
  const url = new URL(request.url);
  const base = baseDe(request);
  if (url.pathname === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /panel\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`, {
      headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const carta = await cargarCarta();
  if (url.pathname === '/sitemap.xml') {
    const fecha = new Date(carta?.t || Date.now()).toISOString().slice(0, 10);
    return new Response(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${esc(base)}/</loc><lastmod>${fecha}</lastmod><changefreq>daily</changefreq></url>\n</urlset>\n`,
      { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'application/xml; charset=utf-8' } },
    );
  }
  if (!carta) {
    return new Response(paginaSinCarta(), {
      status: 503,
      headers: { ...SEGURIDAD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
    });
  }
  return new Response(paginaHtml(carta, { base }), { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'text/html; charset=utf-8' } });
}

// Para las pruebas.
export function olvidarMemoria() {
  enMemoria = null;
}
