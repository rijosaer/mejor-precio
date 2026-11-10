// La página principal: la tienda pública de Agua Pure, sin clave. Muestra la
// carta de TRIVO como catálogo con fotos; cada producto tiene «Agregar» y el
// pedido se arma aquí mismo (public/tienda.js) y se manda a TRIVO
// (src/caja.js), donde entra igual que uno hecho en la carta. Cada producto tiene además su propia página
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

// «Fria» → «Fría»: así se ven las presentaciones.
const nombreVariante = (nombre) => {
  const n = String(nombre || '').trim().replace(/\bfria\b/gi, (m) => (m[0] === 'F' ? 'Fría' : 'fría'));
  return n.charAt(0).toLocaleUpperCase('es-CO') + n.slice(1);
};

// 0 = por unidad, 1 = six pack, 2 = caja (x 24): el orden en que se muestran.
export const GRUPOS = ['Por unidad', 'Six pack', 'Cajas'];
export function presentacion(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/\bcaja\b|\bx\s*24\b/.test(n)) return 2;
  if (/\bsix\s*-?\s*pack\b|\bx\s*6\s*unidades\b/.test(n)) return 1;
  return 0;
}

// «Caja de cerveza Heineken x 24» y «Six pack Heineken» se ordenan por «Heineken».
const claveOrden = (nombre) =>
  nombre
    .toLowerCase()
    .replace(/^(combo\s+)?(caja|six\s*-?\s*pack)\s+(de\s+)?/, '')
    .replace(/^cerveza\s+/, '')
    .replace(/\bfr[ií]a\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

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
        .map((p) => {
          // Las presentaciones (en TRIVO «variantes»): cada una con su precio.
          // Con presentaciones TRIVO cobra el precio de la escogida, sin promo.
          const variantes = (p.variants || [])
            .filter((v) => Number.isInteger(v.id) && Number(v.price) > 0)
            .map((v) => ({ id: v.id, nombre: nombreVariante(v.name), precio: Number(v.price) }));
          const precios = variantes.map((v) => v.precio);
          const lista = variantes.length ? Math.min(...precios) : Number(p.price);
          const promo = !variantes.length && p.active_promo ? Number(p.active_promo.promo_price) : null;
          const precio = promo && promo < lista ? promo : lista;
          const nombre = nombreVisible(p.name);
          return {
            id: p.id,
            nombre,
            descripcion: String(p.description || '').trim(),
            precio,
            antes: precio < lista ? lista : null,
            desde: new Set(precios).size > 1,
            variantes,
            grupo: presentacion(nombre),
            imagen: absoluta(p.image_url),
            disponible: p.is_available !== false,
            destacado: destacados.has(p.id) || Boolean(p.is_featured),
          };
        })
        .filter((p) => p.nombre && p.precio > 0)
        // Por unidad, luego six pack, luego caja; dentro de cada grupo por marca
        // y tamaño (3 kg antes que 10 kg).
        .sort(
          (a, b) =>
            a.grupo - b.grupo ||
            (tema.sections?.featuredFirst !== false ? b.destacado - a.destacado : 0) ||
            claveOrden(a.nombre).localeCompare(claveOrden(b.nombre), 'es', { numeric: true, sensitivity: 'base' }),
        );
      return { id: slug(nombre), nombre, imagen: absoluta(s.image_url), productos };
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
    sucursal: datos.branch?.code || null,
    abierto: datos.branch?.is_open !== false,
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

// La identidad es la de la carta de Agua Pure en TRIVO: encabezado azul con la
// tarjeta de domicilios, hoja blanca, Manrope en los títulos e Inter en el texto,
// fichas de categoría con foto y productos sobre fondo gris claro.
const ICONOS = {
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-8l-4.5 3.5V17.5H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="11.5" r="1.1" fill="currentColor"/><circle cx="12" cy="11.5" r="1.1" fill="currentColor"/><circle cx="15.5" cy="11.5" r="1.1" fill="currentColor"/></svg>',
  bolsa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="9" r="2.3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  flecha: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  inicio: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4v-9.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
  catalogo: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.6" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16.8" cy="7.3" r="1" fill="currentColor"/></svg>',
  destello: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.6 4.6 4.4 8.4 9 9-4.6.6-8.4 4.4-9 9-.6-4.6-4.4-8.4-9-9 4.6-.6 8.4-4.4 9-9Z" fill="currentColor"/></svg>',
};

const sinFoto = () => `<span class="t-sinfoto">${ICONOS.destello}</span>`;

const precioHtml = (p) =>
  `${p.desde ? '<small class="t-desde">Desde</small>' : ''}<strong>${precioTexto(p.precio)}</strong><span>/ presentación</span>${p.antes ? `<del>${precioTexto(p.antes)}</del>` : ''}`;

// «Agregar» mete el producto al pedido de esta página (public/tienda.js), que
// se manda a TRIVO al final. Sin JavaScript el mismo botón abre la carta de TRIVO.
function botonesCompra(p, grande = false) {
  if (!p.disponible) return '<span class="t-agotado">Agotado por ahora</span>';
  const g = grande ? ' t-grande' : '';
  const texto = grande ? 'Agregar al pedido' : p.variantes.length > 1 ? 'Escoger' : 'Agregar';
  return `<a class="t-comprar${g}" href="${CARTA}" target="_blank" rel="noopener" data-agregar="${esc(p.id)}" aria-label="Agregar ${esc(p.nombre)} al pedido">${ICONOS.bolsa}<span>${texto}</span></a>`;
}

const listaVariantes = (p) => (p.variantes.length > 1 ? `<p class="t-variantes">${p.variantes.map((v) => esc(v.nombre)).join(' · ')}</p>` : '');

// En la página del producto: las presentaciones con su precio, para escoger.
function escogerVariante(p) {
  if (p.variantes.length < 2) return '';
  return `<fieldset class="t-presentaciones">
  <legend>Presentación</legend>
  ${p.variantes
    .map(
      (v, i) =>
        `<label><input type="radio" name="presentacion" value="${esc(v.id)}" data-precio="${esc(v.precio)}"${i === 0 ? ' checked' : ''}><span>${esc(v.nombre)}</span><b>${precioTexto(v.precio)}</b></label>`,
    )
    .join('\n  ')}
</fieldset>`;
}

// Las primeras fotos (las que se ven al abrir) cargan ya; las demás, al bajar.
function tarjeta(p, seccion, carta, pendientes, nivel = 3) {
  const ruta = rutaProducto(p);
  const foto = p.imagen
    ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="400" height="400" ${pendientes.fotos-- > 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : sinFoto();
  const cinta = p.antes ? '<span class="t-cinta">Promo</span>' : p.destacado ? '<span class="t-cinta">Destacado</span>' : '';
  return `<li class="t-producto${p.disponible ? '' : ' t-no'}" id="producto-${esc(p.id)}" data-buscar="${esc(`${p.nombre} ${seccion.nombre}`)}">
  <a class="t-arte" href="${esc(ruta)}" tabindex="-1" aria-hidden="true"><span class="t-etiqueta">${esc(seccion.nombre)}</span>${cinta}${foto}</a>
  <p class="t-precio">${precioHtml(p)}</p>
  <h${nivel}><a href="${esc(ruta)}">${esc(p.nombre)}</a></h${nivel}>
  ${listaVariantes(p)}
  ${p.descripcion ? `<p class="t-desc">${esc(p.descripcion)}</p>` : ''}
  <div class="t-botones">${botonesCompra(p)}</div>
</li>`;
}

// Una sección: si mezcla unidades, six pack y cajas, cada grupo con su subtítulo.
function rejilla(seccion, carta, pendientes) {
  const grupos = [...new Set(seccion.productos.map((p) => p.grupo))];
  if (grupos.length < 2) return `<ul class="t-rejilla">\n${seccion.productos.map((p) => tarjeta(p, seccion, carta, pendientes)).join('\n')}\n</ul>`;
  return grupos
    .map((g) => {
      const productos = seccion.productos.filter((p) => p.grupo === g);
      return `<h3 class="t-subgrupo">${GRUPOS[g]} <span>${productos.length}</span></h3>
<ul class="t-rejilla">
${productos.map((p) => tarjeta(p, seccion, carta, pendientes, 4)).join('\n')}
</ul>`;
    })
    .join('\n');
}

// Lo que el carrito necesita de cada producto (nombre, precio, foto,
// presentaciones). Es un bloque de datos: no se ejecuta.
function datosCarrito(carta) {
  const productos = {};
  for (const s of carta.secciones) {
    for (const p of s.productos) {
      productos[p.id] = {
        n: p.nombre,
        p: p.precio,
        f: p.imagen,
        u: rutaProducto(p),
        ok: p.disponible,
        v: p.variantes.map((v) => ({ id: v.id, n: v.nombre, p: v.precio })),
      };
    }
  }
  const datos = { marca: carta.marca, ciudad: carta.ciudad, whatsapp: carta.whatsapp, minimo: carta.pedidos.minimo || 0, enLinea: carta.pedidos.enLinea, productos };
  return `<script type="application/json" id="t-datos">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>`;
}

// Título y descripción para Google: lo que de verdad se vende, en Valledupar.
function textosSeo(carta) {
  const nombres = carta.secciones.map((s) => s.nombre.toLowerCase());
  const hay = (re) => nombres.some((n) => re.test(n));
  const cosas = [hay(/cervez|cab/) && 'cerveza', hay(/licor|aguardiente|ron|whisk/) && 'licores', hay(/hielo|cab/) && 'hielo', hay(/agua/) && 'agua'].filter(Boolean);
  const lista = cosas.length ? cosas : ['bebidas'];
  const enLista = lista.length > 1 ? `${lista.slice(0, -1).join(', ')} y ${lista.at(-1)}` : lista[0];
  const titulo = `${mayuscula(enLista)} a domicilio en ${carta.ciudad} | ${carta.marca}`;
  const descripcion = `Pide ${nombres.join(', ').replace(/, ([^,]*)$/, ' y $1')} a domicilio en ${carta.ciudad}. Mira fotos y precios al día, arma tu pedido aquí y síguelo hasta tu puerta.`;
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
        ...(p.desde
          ? { '@type': 'AggregateOffer', lowPrice: p.precio, highPrice: Math.max(...p.variantes.map((v) => v.precio)), offerCount: p.variantes.length }
          : { '@type': 'Offer', price: p.precio }),
        url,
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
  (p.variantes.length > 1 ? `Presentaciones: ${p.variantes.map((v) => `${v.nombre} ${precioTexto(v.precio)}`).join(', ')}. ` : '') +
  `Arma tu pedido en línea${carta.pedidos.minimo ? `; pedido mínimo ${precioTexto(carta.pedidos.minimo)}` : ''}.`;

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
<meta name="theme-color" content="#0369a1">
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
<link rel="preload" href="/fuentes/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fuentes/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tienda.css">
${datos}
<script src="/tienda.js" type="module"></script>
</head>
<body>`;
}

const whatsappGeneral = (carta) => enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero hacer un pedido a domicilio en ${carta.ciudad}.`);

// Encabezado azul: marca, «¿Te ayudamos?» y la tarjeta de domicilios.
function cabecera(carta) {
  const wa = whatsappGeneral(carta);
  const cobertura = enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero consultar la cobertura de domicilios en ${carta.ciudad}.`);
  return `<a class="t-saltar" href="#contenido">Ir al contenido</a>
<header class="t-cabecera" id="inicio">
  <div class="t-ancho t-cabecera-fila">
    <a class="t-marca" href="/" aria-label="${esc(carta.marca)}, inicio">
      ${carta.logo ? `<img src="${esc(carta.logo)}" alt="" width="56" height="56">` : ''}
      <span>${esc(carta.marca)}<small>Ice &amp; bebidas</small></span>
    </a>
    ${wa ? `<a class="t-ayuda" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span>¿Te ayudamos?</span></a>` : ''}
  </div>
  <div class="t-ancho">
    <div class="t-entrega">
      ${ICONOS.pin}
      <div><span>Domicilios en</span><strong>${esc(carta.ciudad)}, Cesar</strong></div>
      ${cobertura ? `<a href="${esc(cobertura)}" target="_blank" rel="noopener">Consultar ${ICONOS.flecha}</a>` : ''}
    </div>
  </div>
</header>`;
}

function pie(carta) {
  const wa = whatsappGeneral(carta);
  return `<footer class="t-pie">
    <p class="t-pie-marca">${esc(carta.marca)}</p>
    ${carta.lema ? `<p class="t-pie-lema">${esc(carta.lema)}</p>` : ''}
    <p>Domicilios en ${esc(carta.ciudad)}, Cesar${carta.direccion ? ` · ${esc(carta.direccion)}` : ''}${carta.telefono ? ` · <a href="tel:+57${esc(carta.telefono)}">${esc(telefonoTexto(carta.telefono))}</a>` : ''}</p>
    ${carta.pedidos.nota ? `<p>${esc(carta.pedidos.nota)}</p>` : ''}
    <p><a href="${CARTA}" target="_blank" rel="noopener">Nuestra carta en TRIVO</a>${carta.instagram ? ` · <a href="${esc(carta.instagram)}" target="_blank" rel="noopener">Instagram</a>` : ''}</p>
    <p class="t-pie-nota">Precios en pesos colombianos (actualizados el ${esc(fechaTexto(carta.t))}). La venta de bebidas alcohólicas es solo para mayores de edad. El exceso de alcohol es perjudicial para la salud.</p>
  </footer>
</div>
</main>
<nav class="t-barra-inferior" aria-label="Accesos">
  <a href="/#inicio" class="t-activo">${ICONOS.inicio}<span>Inicio</span></a>
  <a href="/#categorias">${ICONOS.catalogo}<span>Catálogo</span></a>
  ${carta.instagram ? `<a href="${esc(carta.instagram)}" target="_blank" rel="noopener">${ICONOS.instagram}<span>Instagram</span></a>` : ''}
  ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" class="t-activo t-fuerte">${ICONOS.chat}<span>Pedir por WhatsApp</span></a>` : ''}
</nav>
</body>
</html>`;
}

function chipsPedido(carta) {
  return [
    carta.pedidos.minimo ? `<li>Pedido mínimo <b>${precioTexto(carta.pedidos.minimo)}</b></li>` : '',
    carta.pedidos.pagos.length ? `<li>Pagas con <b>${esc(carta.pedidos.pagos.join(' o '))}</b></li>` : '',
  ].join('');
}

const avisoViejo = (carta) => (carta.vieja ? '<p class="t-aviso">Estos precios son de la última vez que cargó nuestra carta. Confirma el precio al pedir.</p>' : '');

export function paginaHtml(carta, { base }) {
  const { titulo, descripcion, enLista } = textosSeo(carta);
  const wa = whatsappGeneral(carta);
  const total = carta.secciones.reduce((n, s) => n + s.productos.length, 0);
  const pendientes = { fotos: 4 };
  const categorias = carta.secciones
    .map(
      (s) => `<li><a class="t-categoria" href="#${esc(s.id)}"><span class="t-ficha-cat">${s.imagen ? `<img src="${esc(s.imagen)}" alt="" width="140" height="140" loading="lazy">` : sinFoto()}</span><strong>${esc(s.nombre)}</strong><small>Ver productos</small></a></li>`,
    )
    .join('');
  const secciones = carta.secciones
    .map(
      (s) => `<section class="t-seccion" id="${esc(s.id)}" aria-labelledby="t-${esc(s.id)}">
<div class="t-encabezado"><div><span class="t-ceja">Tu próximo buen momento</span><h2 id="t-${esc(s.id)}">Explora ${esc(s.nombre)}</h2></div><span class="t-cuenta">${s.productos.length} ${s.productos.length === 1 ? 'producto' : 'productos'}</span></div>
${rejilla(s, carta, pendientes)}
</section>`,
    )
    .join('\n');

  return `${cabeza(carta, { titulo, descripcion, canonica: `${base}/`, imagen: carta.portada, datos: ld(negocioLd(carta, base), catalogoLd(carta, base)) + datosCarrito(carta) })}
${cabecera(carta)}
<main class="t-hoja" id="contenido">
<div class="t-ancho">
  <section class="t-intro">
    <span class="t-ceja">${esc(carta.marca)} · ${esc(carta.ciudad)}</span>
    <h1>${esc(mayuscula(enLista))} a domicilio en ${esc(carta.ciudad)}</h1>
    ${carta.lema ? `<p>${esc(carta.lema)}</p>` : ''}
    <ul class="t-chips">${chipsPedido(carta)}</ul>
  </section>
  ${wa ? `<a class="t-pregunta" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span><strong>¿Qué te gustaría hoy?</strong><small>Cuéntanos por WhatsApp</small></span>${ICONOS.flecha}</a>` : ''}

  <section class="t-planes" id="categorias" aria-labelledby="t-planes">
    <div class="t-encabezado"><h2 id="t-planes">Para todos tus planes</h2><span class="t-ceja">${esc(carta.marca)} Ice</span></div>
    <ul class="t-categorias">${categorias}</ul>
  </section>

  <div class="t-filtro">
    <p class="t-total">${total} productos</p>
    <label class="t-buscar" hidden><span class="t-oculto">Buscar un producto</span><input type="search" placeholder="Buscar: Aguila, hielo, six pack…" autocomplete="off"></label>
  </div>
  ${avisoViejo(carta)}
  ${secciones}
  <p class="t-vacio" hidden>No encontramos ese producto. ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>.` : ''}</p>
  ${pie(carta)}`;
}

// La página de un producto: foto grande, precio, cómo pedirlo y otros de su sección.
export function paginaProducto(carta, p, seccion, { base }) {
  const url = `${base}${rutaProducto(p)}`;
  // Primero los de la misma presentación (otras latas, otros six pack…), con foto.
  const otros = seccion.productos
    .filter((x) => x.id !== p.id)
    .sort((a, b) => (a.grupo === p.grupo ? 0 : 1) - (b.grupo === p.grupo ? 0 : 1) || Boolean(b.imagen) - Boolean(a.imagen))
    .slice(0, 8);
  const duda = enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, tengo una pregunta sobre ${p.nombre}.`);
  const pendientes = { fotos: 0 };
  return `${cabeza(carta, {
    titulo: `${p.nombre} a domicilio en ${carta.ciudad} | ${carta.marca}`,
    descripcion: descripcionProducto(p, carta),
    canonica: url,
    imagen: p.imagen || carta.portada,
    tipo: 'product',
    datos: ld(...productoLd(p, seccion, carta, base)) + datosCarrito(carta),
  })}
${cabecera(carta)}
<main class="t-hoja" id="contenido">
<div class="t-ancho">
  <nav class="t-migas" aria-label="Estás en">
    <ol><li><a href="/">Inicio</a></li><li><a href="/#${esc(seccion.id)}">${esc(seccion.nombre)}</a></li><li aria-current="page">${esc(p.nombre)}</li></ol>
  </nav>
  ${avisoViejo(carta)}
  <article class="t-ficha${p.disponible ? '' : ' t-no'}">
    <figure class="t-arte t-ficha-arte"><span class="t-etiqueta">${esc(seccion.nombre)}</span>${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="800" height="800" fetchpriority="high">` : sinFoto()}</figure>
    <div class="t-ficha-info">
      <span class="t-ceja">${esc(seccion.nombre)}</span>
      <h1>${esc(p.nombre)}</h1>
      <p class="t-precio t-ficha-precio">${precioHtml(p)}</p>
      <p class="t-ficha-estado">${p.disponible ? `Disponible · domicilio en ${esc(carta.ciudad)}` : 'Agotado por ahora'}</p>
      ${p.descripcion ? `<p class="t-ficha-desc">${esc(p.descripcion)}</p>` : ''}
      ${p.disponible ? escogerVariante(p) : ''}
      <div class="t-ficha-botones" data-producto="${esc(p.id)}">${botonesCompra(p, true)}</div>
      ${duda ? `<p class="t-duda">¿Tienes dudas? <a href="${esc(duda)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a></p>` : ''}
      <ul class="t-chips">${chipsPedido(carta)}</ul>
    </div>
  </article>
  ${
    otros.length
      ? `<section class="t-seccion" aria-labelledby="t-otros">
<div class="t-encabezado"><div><span class="t-ceja">Tu próximo buen momento</span><h2 id="t-otros">Más de ${esc(seccion.nombre.toLowerCase())}</h2></div><a class="t-ver-todo" href="/#${esc(seccion.id)}">Ver todo ${ICONOS.flecha}</a></div>
<ul class="t-rejilla">
${otros.map((x) => tarjeta(x, seccion, carta, pendientes)).join('\n')}
</ul>
</section>`
      : ''
  }
  ${pie(carta)}`;
}

function paginaNoEsta(carta) {
  return `${cabeza(carta, { titulo: `Producto no disponible | ${carta.marca}`, descripcion: `Este producto ya no está en la carta de ${carta.marca}.`, robots: 'noindex' })}
${cabecera(carta)}
<main class="t-hoja" id="contenido">
<div class="t-ancho">
  <section class="t-caida"><h1>Este producto ya no está en la carta</h1><p>Mira lo que tenemos hoy.</p><p><a class="t-comprar t-grande" href="/#categorias">Ver todos los productos</a></p></section>
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
