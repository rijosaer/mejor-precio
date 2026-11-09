// La página principal: la tienda pública de Agua Pure, sin clave. Muestra la
// carta de TRIVO como catálogo con fotos; cada producto tiene «Comprar» (abre
// la carta de TRIVO, donde se arma el pedido) y «Pedir» (abre WhatsApp con el
// producto ya escrito). Cada producto tiene además su propia página
// (/producto/…) para que Google lo muestre solo. Todo se arma en el servidor
// para que Google lea los productos, los precios y los datos del negocio.
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

const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

export function enlaceWhatsapp(numero, texto) {
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

const textoPedido = (marca, p) => `Hola ${marca}, quiero pedir:\n• 1 × ${p.nombre} (${precioTexto(p.precio)})\n\nMi dirección es: `;

// Cada producto tiene su página para que Google lo muestre solo:
// «/producto/caja-aguila-original-x-24-unidades-lata-al-por-mayor-523». El
// número es el id de TRIVO; si el nombre cambia, la dirección vieja redirige.
export const rutaProducto = (p) => `/producto/${slug(p.nombre)}-${p.id}`;

function buscarProducto(carta, id) {
  for (const seccion of carta.secciones) {
    const p = seccion.productos.find((x) => String(x.id) === id);
    if (p) return { p, seccion };
  }
  return null;
}

const ICONOS = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.7-1.2A9 9 0 1 0 12 3Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9" r="2.5" fill="currentColor"/></svg>',
  gota: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6C17 16 12 22.5 12 29a12 12 0 0 0 24 0c0-6.5-5-13-12-23Z" fill="currentColor"/></svg>',
  hielo: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 6 39 14.5v19L24 42 9 33.5v-19L24 6Zm0 0v17m0 0 15-8.5M24 23 9 14.5M24 23v19" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>',
  lata: '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M16 8h16l2 4v26l-2 3H16l-2-3V12l2-4Z" fill="currentColor"/><path d="M14 17h20M14 33h20" stroke="#fff" stroke-opacity=".5" stroke-width="2"/></svg>',
};

const iconoDe = (seccion) => (/hielo/i.test(seccion) && !/cerve|caja|cab/i.test(seccion) ? 'hielo' : /agua/i.test(seccion) ? 'gota' : 'lata');

const sinFoto = (seccion) => `<div class="t-sinfoto t-sinfoto-${iconoDe(seccion.nombre)}">${ICONOS[iconoDe(seccion.nombre)]}</div>`;

const precioHtml = (p) => `${p.desde ? '<span class="t-desde">Desde</span> ' : ''}<strong>${precioTexto(p.precio)}</strong>${p.antes ? ` <s>${precioTexto(p.antes)}</s>` : ''}`;

function botonesCompra(p, carta, grande = false) {
  if (!p.disponible) return '<span class="t-agotado">Agotado por ahora</span>';
  const wa = enlaceWhatsapp(carta.whatsapp, textoPedido(carta.marca, p));
  const g = grande ? ' t-grande' : '';
  return (
    `<a class="t-comprar${g}" href="${CARTA}" target="_blank" rel="noopener" aria-label="Comprar ${esc(p.nombre)} en nuestra carta">${ICONOS.bolsa}<span>${grande ? 'Comprar en la carta' : 'Comprar'}</span></a>` +
    (wa ? `<a class="t-wa${g}" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="Pedir ${esc(p.nombre)} por WhatsApp">${ICONOS.chat}<span>${grande ? 'Pedir por WhatsApp' : 'Pedir'}</span></a>` : '')
  );
}

// Las primeras fotos (las que se ven al abrir) cargan ya; las demás, al bajar.
function tarjeta(p, seccion, carta, pendientes) {
  const ruta = rutaProducto(p);
  const foto = p.imagen
    ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="400" height="300" ${pendientes.fotos-- > 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : sinFoto(seccion);
  return `<li class="t-producto${p.disponible ? '' : ' t-no'}" id="producto-${esc(p.id)}" data-buscar="${esc(`${p.nombre} ${seccion.nombre}`)}">
  <a class="t-foto-enlace" href="${esc(ruta)}" tabindex="-1" aria-hidden="true"><figure class="t-foto">${foto}${p.antes ? '<span class="t-cinta">Promo</span>' : p.destacado ? '<span class="t-cinta">Destacado</span>' : ''}</figure></a>
  <div class="t-info">
    <h3><a href="${esc(ruta)}">${esc(p.nombre)}</a></h3>
    ${p.descripcion ? `<p class="t-desc">${esc(p.descripcion)}</p>` : ''}
    <p class="t-precio">${precioHtml(p)}</p>
    <div class="t-botones">${botonesCompra(p, carta)}</div>
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
  const titulo = `${mayuscula(enLista)} a domicilio en ${carta.ciudad} | ${carta.marca}`;
  const descripcion = `Pide ${nombres.join(', ').replace(/, ([^,]*)$/, ' y $1')} a domicilio en ${carta.ciudad}. Mira fotos y precios al día, y compra en nuestra carta o por WhatsApp.`;
  return { titulo, descripcion, enLista };
}

// «</script>» dentro del JSON cerraría la etiqueta.
const ld = (...datos) => datos.map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n');

function negocioLd(carta, base) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LiquorStore',
    '@id': `${base}/#negocio`,
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
}

// En la principal, la lista apunta a la página de cada producto (ahí van sus datos completos).
function catalogoLd(carta, base) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Productos de ${carta.marca} en ${carta.ciudad}`,
    itemListElement: carta.secciones
      .flatMap((s) => s.productos)
      .map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${base}${rutaProducto(p)}`, name: p.nombre })),
  };
}

function productoLd(p, seccion, carta, base) {
  const url = `${base}${rutaProducto(p)}`;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      '@id': `${url}#producto`,
      name: p.nombre,
      image: p.imagen ? [p.imagen] : undefined,
      description: p.descripcion || descripcionProducto(p, carta),
      sku: String(p.id),
      category: seccion.nombre,
      url,
      offers: {
        '@type': 'Offer',
        url,
        price: p.precio,
        priceCurrency: 'COP',
        availability: p.disponible ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: carta.marca, '@id': `${base}/#negocio` },
        areaServed: { '@type': 'City', name: carta.ciudad },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Inicio', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: seccion.nombre, item: `${base}/#${seccion.id}` },
        { '@type': 'ListItem', position: 3, name: p.nombre, item: url },
      ],
    },
  ];
}

const descripcionProducto = (p, carta) =>
  `${p.nombre} a ${precioTexto(p.precio)} con domicilio en ${carta.ciudad}. ` +
  (p.descripcion ? `${p.descripcion.replace(/\.?$/, '.')} ` : '') +
  `Compra en nuestra carta o pide por WhatsApp${carta.pedidos.minimo ? `; pedido mínimo ${precioTexto(carta.pedidos.minimo)}` : ''}.`;

const fechaTexto = (t) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(t);

// Lo que comparten la principal y la página de cada producto.
function cabeza(carta, { titulo, descripcion, canonica, imagen, tipo = 'website', datos = '', robots = 'index, follow, max-image-preview:large' }) {
  return `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
${canonica ? `<link rel="canonical" href="${esc(canonica)}">` : ''}
<meta name="robots" content="${robots}">
<meta name="theme-color" content="#102c3f">
<meta name="color-scheme" content="light">
<meta name="geo.region" content="CO-CES">
<meta name="geo.placename" content="${esc(carta.ciudad)}">
<meta property="og:type" content="${tipo}">
<meta property="og:locale" content="es_CO">
<meta property="og:site_name" content="${esc(carta.marca)}">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descripcion)}">
${canonica ? `<meta property="og:url" content="${esc(canonica)}">` : ''}
${imagen ? `<meta property="og:image" content="${esc(imagen)}">\n<meta name="twitter:card" content="summary_large_image">` : ''}
${carta.logo ? `<link rel="icon" href="${esc(carta.logo)}">\n<link rel="apple-touch-icon" href="${esc(carta.logo)}">` : '<link rel="icon" href="/icons/icon-192.png" type="image/png">'}
<link rel="preload" href="/fuentes/montserrat-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tienda.css">
${datos}
<script src="/tienda.js" type="module"></script>
</head>
<body>`;
}

const whatsappGeneral = (carta) => enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero hacer un pedido a domicilio en ${carta.ciudad}.`);

function barra(carta) {
  const wa = whatsappGeneral(carta);
  return `<header class="t-barra">
  <div class="t-ancho t-barra-dentro">
    <a class="t-marca" href="/" aria-label="${esc(carta.marca)}, inicio">
      ${carta.logo ? `<img src="${esc(carta.logo)}" alt="" width="44" height="44">` : ''}
      <span>${esc(carta.marca)}<small>Ice &amp; bebidas</small></span>
    </a>
    ${wa ? `<a class="t-ayuda" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span>¿Te ayudamos?</span></a>` : ''}
  </div>
</header>`;
}

function pie(carta) {
  return `<footer class="t-pie">
  <div class="t-ancho">
    <p><b>${esc(carta.marca)}</b> · Domicilios en ${esc(carta.ciudad)}, Cesar${carta.direccion ? ` · ${esc(carta.direccion)}` : ''}</p>
    ${carta.pedidos.nota ? `<p>${esc(carta.pedidos.nota)}</p>` : ''}
    <p>${carta.telefono ? `Teléfono y WhatsApp: <a href="tel:+57${esc(carta.telefono)}">${esc(telefonoTexto(carta.telefono))}</a>` : ''}${carta.instagram ? ` · <a href="${esc(carta.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''} · <a href="${CARTA}" target="_blank" rel="noopener">Nuestra carta en TRIVO</a></p>
    <p class="t-fecha">Precios en pesos colombianos (actualizados el ${esc(fechaTexto(carta.t))}). La venta de bebidas alcohólicas es solo para mayores de edad. El exceso de alcohol es perjudicial para la salud.</p>
  </div>
</footer>
</body>
</html>`;
}

function chipsPedido(carta) {
  return [
    `${ICONOS.pin}<span>Domicilios en <b>${esc(carta.ciudad)}</b></span>`,
    carta.pedidos.minimo ? `<span>Pedido mínimo <b>${precioTexto(carta.pedidos.minimo)}</b></span>` : '',
    carta.pedidos.pagos.length ? `<span>Pagas con <b>${esc(carta.pedidos.pagos.join(' o '))}</b></span>` : '',
  ]
    .filter(Boolean)
    .map((c) => `<li>${c}</li>`)
    .join('');
}

const avisoViejo = (carta) => (carta.vieja ? '<p class="t-aviso">Estos precios son de la última vez que cargó nuestra carta. Confirma el precio al pedir.</p>' : '');

export function paginaHtml(carta, { base }) {
  const { titulo, descripcion, enLista } = textosSeo(carta);
  const wa = whatsappGeneral(carta);
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

  return `${cabeza(carta, { titulo, descripcion, canonica: `${base}/`, imagen: carta.portada, datos: ld(negocioLd(carta, base), catalogoLd(carta, base)) })}
<a class="t-saltar" href="#productos">Ir a los productos</a>
${barra(carta)}

<section class="t-portada">
  ${carta.portada ? `<img class="t-portada-foto" src="${esc(carta.portada)}" alt="" width="1536" height="1024" fetchpriority="high">` : ''}
  <div class="t-ancho t-portada-texto">
    <h1>${esc(mayuscula(enLista))} a domicilio en ${esc(carta.ciudad)}</h1>
    <p>${esc(carta.lema || 'Bebidas frías a tu puerta.')}</p>
    <ul class="t-chips">${chipsPedido(carta)}</ul>
    <div class="t-portada-botones">
      <a class="t-comprar t-grande" href="#productos">Ver productos</a>
      ${wa ? `<a class="t-wa t-grande" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span>Pedir por WhatsApp</span></a>` : ''}
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
${avisoViejo(carta)}
${secciones}
<p class="t-vacio" hidden>No encontramos ese producto. ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>.` : ''}</p>
</main>

${pie(carta)}`;
}

// La página de un producto: foto grande, precio, cómo pedirlo y otros de su sección.
export function paginaProducto(carta, p, seccion, { base }) {
  const url = `${base}${rutaProducto(p)}`;
  const otros = seccion.productos.filter((x) => x.id !== p.id).sort((a, b) => Boolean(b.imagen) - Boolean(a.imagen)).slice(0, 8);
  const pendientes = { fotos: 0 };
  return `${cabeza(carta, {
    titulo: `${p.nombre} a domicilio en ${carta.ciudad} | ${carta.marca}`,
    descripcion: descripcionProducto(p, carta),
    canonica: url,
    imagen: p.imagen || carta.portada,
    tipo: 'product',
    datos: ld(...productoLd(p, seccion, carta, base)),
  })}
${barra(carta)}
<nav class="t-ancho t-migas" aria-label="Estás en">
  <ol><li><a href="/">Inicio</a></li><li><a href="/#${esc(seccion.id)}">${esc(seccion.nombre)}</a></li><li aria-current="page">${esc(p.nombre)}</li></ol>
</nav>
<main class="t-ancho">
${avisoViejo(carta)}
<article class="t-ficha${p.disponible ? '' : ' t-no'}">
  <figure class="t-ficha-foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="800" height="600" fetchpriority="high">` : sinFoto(seccion)}</figure>
  <div class="t-ficha-info">
    <p class="t-ficha-seccion">${esc(seccion.nombre)}</p>
    <h1>${esc(p.nombre)}</h1>
    <p class="t-precio t-ficha-precio">${precioHtml(p)}</p>
    <p class="t-ficha-estado">${p.disponible ? `Disponible · domicilio en ${esc(carta.ciudad)}` : 'Agotado por ahora'}</p>
    ${p.descripcion ? `<p class="t-ficha-desc">${esc(p.descripcion)}</p>` : ''}
    <div class="t-ficha-botones">${botonesCompra(p, carta, true)}</div>
    <ul class="t-chips t-ficha-chips">${chipsPedido(carta)}</ul>
  </div>
</article>
${
  otros.length
    ? `<section class="t-seccion" aria-labelledby="t-otros">
<h2 id="t-otros">Más de ${esc(seccion.nombre.toLowerCase())}</h2>
<ul class="t-rejilla">
${otros.map((x) => tarjeta(x, seccion, carta, pendientes)).join('\n')}
</ul>
<p class="t-mas"><a href="/#productos">Ver todos los productos</a></p>
</section>`
    : ''
}
</main>
${pie(carta)}`;
}

function paginaNoEsta(carta) {
  return `${cabeza(carta, { titulo: `Producto no disponible | ${carta.marca}`, descripcion: `Este producto ya no está en la carta de ${carta.marca}.`, robots: 'noindex' })}
${barra(carta)}
<main class="t-ancho t-caida"><h1>Este producto ya no está en la carta</h1><p>Mira lo que tenemos hoy.</p><p><a class="t-comprar t-grande" href="/#productos">Ver todos los productos</a></p></main>
${pie(carta)}`;
}

// Cuando la carta no se pudo leer nunca: una página corta que manda a TRIVO.
function paginaSinCarta() {
  return `<!doctype html>
<html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agua Pure · Valledupar</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/tienda.css"><script src="/tienda.js" type="module"></script></head>
<body><main class="t-ancho t-caida"><h1>Agua Pure</h1><p>La carta no cargó en este momento.</p><p><a class="t-comprar t-grande" href="${CARTA}">Ver la carta y pedir</a></p></main></body></html>`;
}

function mapaDelSitio(carta, base) {
  const fecha = new Date(carta?.t || Date.now()).toISOString().slice(0, 10);
  const urls = [`  <url><loc>${esc(base)}/</loc><lastmod>${fecha}</lastmod></url>`];
  for (const p of carta?.secciones.flatMap((s) => s.productos) || []) {
    urls.push(
      `  <url><loc>${esc(base + rutaProducto(p))}</loc><lastmod>${fecha}</lastmod>${p.imagen ? `<image:image><image:loc>${esc(p.imagen)}</image:loc></image:image>` : ''}</url>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
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
const HTML = { ...SEGURIDAD, ...CACHE, 'content-type': 'text/html; charset=utf-8' };

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
    return new Response(mapaDelSitio(carta, base), { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'application/xml; charset=utf-8' } });
  }
  if (!carta) {
    return new Response(paginaSinCarta(), {
      status: 503,
      headers: { ...SEGURIDAD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
    });
  }
  if (url.pathname.startsWith('/producto/')) {
    const id = url.pathname.match(/-(\d+)\/?$/)?.[1];
    const hallado = id ? buscarProducto(carta, id) : null;
    if (!hallado) return new Response(paginaNoEsta(carta), { status: 404, headers: HTML });
    const ruta = rutaProducto(hallado.p);
    // Nombre viejo o mal escrito: a la dirección de hoy, para que Google guarde una sola.
    if (url.pathname !== ruta) return new Response(null, { status: 301, headers: { ...SEGURIDAD, ...CACHE, location: `${base}${ruta}` } });
    return new Response(paginaProducto(carta, hallado.p, hallado.seccion, { base }), { headers: HTML });
  }
  return new Response(paginaHtml(carta, { base }), { headers: HTML });
}

// Para las pruebas.
export function olvidarMemoria() {
  enMemoria = null;
}
