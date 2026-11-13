// La tienda pública (versión 2): la tienda del distribuidor como si fuera
// suya, con su nombre, sus iniciales y su color (src/marca.js). Los productos y
// los precios salen de su carta en TRIVO; el pedido se arma aquí mismo
// (public/tienda.js) y se manda a TRIVO (src/caja.js), donde entra igual que
// uno hecho en la carta. No se nombra a TRIVO ni a nadie más.
//
// Páginas: inicio («/»), todos los productos («/productos», con buscador),
// una por categoría («/categoria/…») y una por producto («/producto/…»). Todo
// se arma en el servidor para que Google lea los productos, los precios y los
// datos del negocio. El panel administrativo (la app con clave) está en /panel.
import { escribir, leer } from './almacen.js';
import { pedir } from './http.js';
import { colores, leerMarca, marcaCss, marcaSvg } from './marca.js';
import { BASE, SLUG } from './tiendas/aguapure.js';

// La última carta buena: si TRIVO no responde, la página sale con esa.
const CLAVE = 'tienda-carta';
const MEMORIA = 60_000;
let enMemoria = null;
let envioEnMemoria = null;

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
export const nombreVariante = (nombre) => {
  const n = String(nombre || '').trim().replace(/\bfria\b/gi, (m) => (m[0] === 'F' ? 'Fría' : 'fría'));
  return n.charAt(0).toLocaleUpperCase('es-CO') + n.slice(1);
};

// 0 = por unidad, 1 = six pack, 2 = caja: el orden en que se muestran. Solo es
// caja lo que dice «caja» (el agua «paquete x 24» sigue con los paquetes).
export const GRUPOS = ['Por unidad', 'Six pack', 'Cajas'];
const GRUPO_CORTO = ['Unidad', 'Six pack', 'Caja'];
export function presentacion(nombre) {
  const n = String(nombre || '').toLowerCase();
  if (/\bcaja\b/.test(n)) return 2;
  if (/\bsix\s*-?\s*pack\b|\bx\s*6\s*unidades\b/.test(n)) return 1;
  return 0;
}

// El nombre que el negocio le puso a la promoción en TRIVO («Envio gratis» → «Envío gratis»).
const textoPromo = (nombre) => {
  const t = String(nombre || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
    .replace(/\benvio\b/gi, (m) => (m[0] === 'E' ? 'Envío' : 'envío'));
  return t.charAt(0).toLocaleUpperCase('es-CO') + t.slice(1);
};

// «Caja de cerveza Heineken x 24» y «Six pack Heineken» se ordenan por «Heineken».
const claveOrden = (nombre) =>
  nombre
    .toLowerCase()
    .replace(/^(combo\s+)?(caja|six\s*-?\s*pack)\s+(de\s+)?/, '')
    .replace(/^cerveza\s+/, '')
    .replace(/\bfr[ií]a\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// La «familia» junta la lata, el six pack y la caja de la misma cerveza:
// «Aguila Original fría x 330ml (lata)», «Six pack Aguila Original x 6…» y
// «Caja Aguila Original x 24…» → «aguila original».
export function familia(nombre) {
  return String(nombre || '')
    .toLowerCase()
    .replace(/\bfr[ií]a\b/g, ' ')
    .split(/\s+x\s+|\s+x(?=\d)/)[0]
    .replace(/^(combo\s+)?(caja|six\s*-?\s*pack)\s+(de\s+)?/, '')
    .replace(/^cerveza\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const slug = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'productos';

const sinTildes = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

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

// El horario de cada día («0» = lunes en TRIVO), solo con horas válidas.
function horarioSemana(horas) {
  const semana = {};
  for (const [dia, par] of Object.entries(horas || {})) {
    if (/^[0-6]$/.test(dia) && Array.isArray(par) && par.length === 2 && par.every((x) => /^\d{2}:\d{2}$/.test(String(x)))) semana[dia] = par.map(String);
  }
  return Object.keys(semana).length ? semana : null;
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
            nombrePromo: precio < lista ? textoPromo(p.active_promo?.name) : '',
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
    marca: datos.brand?.name || 'Tienda',
    lema: tema.branding?.tagline || '',
    ciudad: datos.branch?.city || 'Valledupar',
    telefono: soloDigitos(datos.branch?.phone) || null,
    direccion: datos.branch?.address || null,
    horario: horarioUnico(datos.branch?.opening_hours),
    semana: horarioSemana(datos.branch?.opening_hours),
    whatsapp: numeroWhatsapp(datos),
    sucursal: datos.branch?.code || null,
    abierto: datos.branch?.is_open !== false,
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

// El domicilio de la sucursal (sin dirección): lo que se muestra antes de
// pedir. Media hora en memoria; si TRIVO tarda, la página sale sin el valor.
export async function domicilioBase({ ahora = Date.now(), sucursal = 'B001', ciudad = 'Valledupar' } = {}) {
  if (envioEnMemoria && ahora - envioEnMemoria.t < 30 * 60_000) return envioEnMemoria.valor;
  try {
    const res = await fetch(`${BASE}/api/public/menu/${SLUG}/delivery-quote/`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ branch_code: sucursal, city: ciudad, address: '', subtotal: 0 }),
      signal: AbortSignal.timeout(2500),
    });
    const datos = await res.json();
    const valor = Number(datos?.data?.fee);
    if (!res.ok || !Number.isFinite(valor) || valor < 0) return null;
    envioEnMemoria = { t: ahora, valor };
    return valor;
  } catch {
    return null;
  }
}

// ── ¿Abierto? ──────────────────────────────────────────────────────────────
// TRIVO dice si está abierto ahora; con el horario de cada día se dice hasta
// qué hora o cuándo abre. El navegador lo vuelve a calcular (public/tienda.js).
const horaTexto = (hhmm) => {
  const [h24, m] = String(hhmm).split(':').map(Number);
  if (h24 === 0 && !m) return 'medianoche';
  if (h24 === 12 && !m) return 'mediodía';
  return `las ${((h24 + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
};
const minutos = (hhmm) => {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + (m || 0);
};

export function ahoraEnBogota(t = Date.now()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(t)
      .map((p) => [p.type, p.value]),
  );
  return { dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(partes.weekday), min: Number(partes.hour) * 60 + Number(partes.minute) };
}

export function estadoTienda(abierto, semana, t = Date.now()) {
  const { dia, min } = ahoraEnBogota(t);
  const hoy = semana?.[dia];
  if (abierto) {
    if (hoy && minutos(hoy[1]) !== minutos(hoy[0])) return { abierto: true, texto: `Abierto hasta ${horaTexto(hoy[1])}` };
    return { abierto: true, texto: 'Abierto ahora' };
  }
  if (hoy && min < minutos(hoy[0])) return { abierto: false, texto: `Cerrado · abre hoy a ${horaTexto(hoy[0])}` };
  const manana = semana?.[(dia + 1) % 7];
  if (manana) return { abierto: false, texto: `Cerrado · abre mañana a ${horaTexto(manana[0])}` };
  return { abierto: false, texto: 'Cerrado ahora' };
}

// ── HTML ────────────────────────────────────────────────────────────────────
const esc = (x) =>
  String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const precioTexto = (n) => pesos.format(n).replace(/\s/g, '');

const telefonoTexto = (n) => (n?.length === 10 ? `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}` : n);

const mayuscula = (texto) => texto.charAt(0).toUpperCase() + texto.slice(1);

export function enlaceWhatsapp(numero, texto) {
  return numero ? `https://wa.me/${numero}?text=${encodeURIComponent(texto)}` : null;
}

// Cada producto tiene su página para que Google lo muestre solo:
// «/producto/caja-aguila-original-x-24-unidades-lata-al-por-mayor-523». El
// número es el id de TRIVO; si el nombre cambia, la dirección vieja redirige.
export const rutaProducto = (p) => `/producto/${slug(p.nombre)}-${p.id}`;
export const rutaCategoria = (s) => `/categoria/${s.id}`;

function buscarProducto(carta, id) {
  for (const seccion of carta.secciones) {
    const p = seccion.productos.find((x) => String(x.id) === id);
    if (p) return { p, seccion };
  }
  return null;
}

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" aria-hidden="true"${extra}><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const ICONOS = {
  bolsa: svg('M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2'),
  pin: svg('M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Zm0-9.7a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z'),
  lupa: svg('M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM16 16l4 4'),
  chat: svg('M4.5 19.5 5.6 16A8 8 0 1 1 8.4 18.6l-3.9.9ZM9.5 9.5c.4 2.2 2.2 4.1 4.6 4.6'),
  inicio: svg('M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4v-9.5Z'),
  productos: svg('M4 4h7v7H4V4Zm9 0h7v7h-7V4ZM4 13h7v7H4v-7Zm9 0h7v7h-7v-7Z'),
  pedidos: svg('M7 3.5h10a1 1 0 0 1 1 1V20l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.2V4.5a1 1 0 0 1 1-1ZM9 8h6M9 12h6'),
  mas: svg('M12 5v14M5 12h14'),
  flecha: svg('M5 12h14M13 6l6 6-6 6'),
  atras: svg('M19 12H5M11 6l-6 6 6 6'),
  camion: svg('M3 7h11v9H3V7Zm11 3h4l3 3v3h-7v-6ZM7 18.5a1.5 1.5 0 1 0 0-.1M17 18.5a1.5 1.5 0 1 0 0-.1'),
  destello: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c.6 4.6 4.4 8.4 9 9-4.6.6-8.4 4.4-9 9-.6-4.6-4.4-8.4-9-9 4.6-.6 8.4-4.4 9-9Z" fill="currentColor"/></svg>',
};

// Ícono de cada categoría según su nombre.
const ICONOS_CATEGORIA = [
  [/cab[aá]|nevera|combo/, 'M4 9h16v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9Zm2-3h12l2 3H4l2-3Zm4 7h4'],
  [/cerve/, 'M8 4h8l-1 3v12a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 9 19V7L8 4Zm1 7h6'],
  [/agua/, 'M12 3.5s6 6.4 6 10.5a6 6 0 0 1-12 0c0-4.1 6-10.5 6-10.5Z'],
  [/hielo/, 'M5 8.5 12 5l7 3.5v7L12 19l-7-3.5v-7Zm0 0L12 12l7-3.5M12 12v7'],
  [/licor|aguardiente|\bron\b|whisk|vino|tequila|vodka/, 'M10 3h4v4l2 3v9.5a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10l2-3V3Zm-2 10h8'],
  [/gaseosa|refresco|jugo|energ/, 'M9 3h6M10 3v3.5L8 9v10.5a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V9l-2-2.5V3M8 13h8'],
  [/pasaboca|picar|snack|papa|mecato/, 'M6 6h12l-1.5 14h-9L6 6Zm2-2.5h8M9 10l1 2M14 11l-1 2'],
];
const iconoCategoria = (nombre) => svg((ICONOS_CATEGORIA.find(([re]) => re.test(sinTildes(nombre))) || [null, 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2'])[1]);

const sinFoto = () => `<span class="t-sinfoto">${ICONOS.destello}</span>`;

const foto = (p, pendientes, tam = 400) =>
  p.imagen
    ? `<img src="${esc(p.imagen)}" alt="" width="${tam}" height="${tam}" ${pendientes.fotos-- > 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
    : sinFoto();

const detalleTarjeta = (p) => (p.variantes.length > 1 ? p.variantes.map((v) => v.nombre).join(' · ') : '');

// «+» mete el producto al pedido de esta página (public/tienda.js), que se
// manda a la tienda al final. Sin JavaScript lleva a la página del producto.
const botonMas = (p) =>
  p.disponible
    ? `<a class="t-mas" href="${esc(rutaProducto(p))}" data-agregar="${esc(p.id)}" aria-label="Agregar ${esc(p.nombre)}">${ICONOS.mas}</a>`
    : '<span class="t-agotado">Agotado</span>';

const precioTarjeta = (p) =>
  `<p class="t-prod-precio">${p.desde ? '<small>Desde</small>' : ''}<strong>${precioTexto(p.precio)}</strong>${p.antes ? `<del>${precioTexto(p.antes)}</del>` : ''}</p>`;

// Una tarjeta de producto: en rejilla (inicio) o en lista (categorías).
function tarjeta(p, pendientes, nivel = 3) {
  const ruta = rutaProducto(p);
  const detalle = detalleTarjeta(p);
  return `<li class="t-prod${p.disponible ? '' : ' t-no'}" data-grupo="${p.grupo}" data-precio="${p.precio}"${p.antes ? ' data-oferta' : ''}>
  <a class="t-prod-foto" href="${esc(ruta)}" tabindex="-1" aria-hidden="true">${foto(p, pendientes)}${p.antes ? '<span class="t-sello">Oferta</span>' : ''}</a>
  <div class="t-prod-texto">
    <h${nivel} class="t-prod-nombre"><a href="${esc(ruta)}">${esc(p.nombre)}</a></h${nivel}>
    ${detalle ? `<p class="t-prod-detalle">${esc(detalle)}</p>` : ''}
    <div class="t-prod-pie">${precioTarjeta(p)}${botonMas(p)}</div>
  </div>
</li>`;
}

// Lo que el carrito y el buscador necesitan de cada producto. Es un bloque de
// datos: no se ejecuta.
function datosPagina(carta) {
  const productos = {};
  for (const s of carta.secciones) {
    for (const p of s.productos) {
      productos[p.id] = {
        n: p.nombre,
        p: p.precio,
        a: p.antes,
        f: p.imagen,
        u: rutaProducto(p),
        ok: p.disponible,
        s: s.nombre,
        g: p.grupo,
        v: p.variantes.map((v) => ({ id: v.id, n: v.nombre, p: v.precio })),
      };
    }
  }
  const datos = {
    marca: carta.marca,
    sigla: carta.tienda.sigla,
    tiempo: carta.tienda.tiempo,
    ciudad: carta.ciudad,
    whatsapp: carta.whatsapp,
    minimo: carta.pedidos.minimo || 0,
    enLinea: carta.pedidos.enLinea,
    abierto: carta.vieja ? null : carta.abierto,
    semana: carta.semana,
    envio: carta.envio,
    productos,
  };
  return `<script type="application/json" id="t-datos">${JSON.stringify(datos).replace(/</g, '\\u003c')}</script>`;
}

// Título y descripción para Google: lo que de verdad se vende, en la ciudad.
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
    telephone: carta.telefono ? `+57${carta.telefono}` : undefined,
    address: { '@type': 'PostalAddress', streetAddress: carta.direccion || undefined, addressLocality: carta.ciudad, addressRegion: 'Cesar', addressCountry: 'CO' },
    areaServed: { '@type': 'City', name: carta.ciudad },
    currenciesAccepted: 'COP',
    paymentAccepted: carta.pedidos.pagos.join(', ') || undefined,
    openingHoursSpecification: carta.horario
      ? [{ '@type': 'OpeningHoursSpecification', dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'], opens: carta.horario.abre, closes: carta.horario.cierra }]
      : undefined,
  };
}

// La lista apunta a la página de cada producto (ahí van sus datos completos).
function catalogoLd(carta, base, secciones = carta.secciones) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: `Productos de ${carta.marca} en ${carta.ciudad}`,
    itemListElement: secciones
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
    migasLd(base, [
      ['Inicio', `${base}/`],
      [seccion.nombre, `${base}${rutaCategoria(seccion)}`],
      [p.nombre, url],
    ]),
  ];
}

const migasLd = (base, pasos) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: pasos.map(([name, item], i) => ({ '@type': 'ListItem', position: i + 1, name, item })),
});

const descripcionProducto = (p, carta) =>
  `${p.nombre} a ${precioTexto(p.precio)} con domicilio en ${carta.ciudad}. ` +
  (p.descripcion ? `${p.descripcion.replace(/\.?$/, '.')} ` : '') +
  (p.variantes.length > 1 ? `Presentaciones: ${p.variantes.map((v) => `${v.nombre} ${precioTexto(v.precio)}`).join(', ')}. ` : '') +
  `Arma tu pedido en línea${carta.pedidos.minimo ? `; pedido mínimo ${precioTexto(carta.pedidos.minimo)}` : ''}.`;

const fechaTexto = (t) =>
  new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' }).format(t);

const versionMarca = (carta) => `${carta.tienda.color.slice(1)}${carta.tienda.sigla}`.toLowerCase();

// Lo que comparten todas las páginas.
function cabeza(carta, { titulo, descripcion, canonica, imagen, tipo = 'website', datos = '', robots = 'index, follow, max-image-preview:large', clase = '' }) {
  const v = encodeURIComponent(versionMarca(carta));
  return `<!doctype html>
<html lang="es-CO">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(descripcion)}">
${canonica ? `<link rel="canonical" href="${esc(canonica)}">` : ''}
<meta name="robots" content="${robots}">
<meta name="theme-color" content="${colores(carta.tienda.color).oscuro}">
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
<link rel="icon" href="/marca.svg?v=${v}" type="image/svg+xml">
<link rel="preload" href="/fuentes/bricolage-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fuentes/inter-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/tienda.css">
<link rel="stylesheet" href="/marca.css?v=${v}">
${datos}
<script src="/tienda.js" type="module"></script>
</head>
<body${clase ? ` class="${clase}"` : ''}>`;
}

const whatsappGeneral = (carta) => enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero hacer un pedido a domicilio en ${carta.ciudad}.`);

// Encabezado con el color de la tienda: iniciales, nombre, si está abierta,
// a dónde se entrega, el buscador y «Tu pedido». Debajo, las categorías.
function cabecera(carta, { actual = '', buscar = '' } = {}) {
  const t = carta.tienda;
  const wa = whatsappGeneral(carta);
  const estado = estadoTienda(carta.vieja ? false : carta.abierto, carta.semana, carta.ahora);
  return `<a class="t-saltar" href="#contenido">Ir al contenido</a>
<header class="t-cab">
  <div class="t-ancho t-cab-fila">
    <a class="t-tienda" href="/" aria-label="${esc(t.nombre)}, inicio">
      <span class="t-sigla" aria-hidden="true">${esc(t.sigla)}</span>
      <span class="t-tienda-texto"><strong>${esc(t.nombre)}</strong><small class="t-estado${estado.abierto ? '' : ' t-cerrada'}" data-estado>${esc(estado.texto)}</small></span>
    </a>
    <p class="t-entregar">${ICONOS.pin}<span><small data-entregar-titulo>Domicilios en</small><b data-entregar>${esc(carta.ciudad)}</b></span></p>
    <form class="t-buscar" role="search" action="/productos" method="get">
      <label class="t-oculto" for="t-q">Buscar productos</label>
      ${ICONOS.lupa}
      <input id="t-q" name="buscar" type="search" placeholder="Busca cerveza, hielo, agua…" autocomplete="off" enterkeyhint="search" maxlength="60" value="${esc(buscar)}">
    </form>
    <div class="t-cab-acciones">
      <button type="button" class="t-cab-wa t-cab-mis" data-mis-pedidos hidden>${ICONOS.pedidos}<span>Mis pedidos</span></button>
      ${wa ? `<a class="t-cab-wa" href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span>Escríbenos</span></a>` : ''}
      <button type="button" class="t-cab-pedido" data-abrir-pedido hidden>${ICONOS.bolsa}<span class="t-cab-pedido-texto" data-pedido-texto>Tu pedido</span><span class="t-cab-n" data-pedido-n hidden></span></button>
    </div>
  </div>
  <nav class="t-cats-barra" aria-label="Categorías">
    <div class="t-ancho"><a href="/productos"${actual === 'productos' ? ' aria-current="page"' : ''}>Todo</a>${carta.secciones
      .map((s) => `<a href="${rutaCategoria(s)}"${actual === s.id ? ' aria-current="page"' : ''}>${esc(s.nombre)}</a>`)
      .join('')}</div>
  </nav>
</header>`;
}

function pie(carta, actual) {
  const t = carta.tienda;
  const wa = whatsappGeneral(carta);
  return `<footer class="t-pie">
  <div class="t-ancho">
    <p class="t-pie-marca"><span class="t-sigla" aria-hidden="true">${esc(t.sigla)}</span><strong>${esc(t.nombre)}</strong></p>
    ${t.lema ? `<p>${esc(t.lema)}</p>` : ''}
    <p>Domicilios en ${esc(carta.ciudad)}, Cesar${carta.direccion ? ` · ${esc(carta.direccion)}` : ''}${carta.telefono ? ` · <a href="tel:+57${esc(carta.telefono)}">${esc(telefonoTexto(carta.telefono))}</a>` : ''}${wa ? ` · <a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ''}</p>
    ${carta.pedidos.nota ? `<p>${esc(carta.pedidos.nota)}</p>` : ''}
    <p class="t-pie-nota">Precios en pesos colombianos (actualizados el ${esc(fechaTexto(carta.t))}). La venta de bebidas alcohólicas es solo para mayores de edad. El exceso de alcohol es perjudicial para la salud.</p>
  </div>
</footer>
<nav class="t-nav" aria-label="Navegación">
  <a href="/"${actual === 'inicio' ? ' aria-current="page"' : ''}>${ICONOS.inicio}<span>Inicio</span></a>
  <a href="/productos"${actual === 'productos' ? ' aria-current="page"' : ''}>${ICONOS.productos}<span>Productos</span></a>
  <button type="button" data-mis-pedidos hidden>${ICONOS.pedidos}<span>Mis pedidos</span></button>
  ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${ICONOS.chat}<span>Escríbenos</span></a>` : ''}
</nav>
</body>
</html>`;
}

// Llega en · Domicilio · Pedido mínimo.
function hechos(carta) {
  const filas = [];
  if (carta.tienda.tiempo) filas.push(['Llega en', esc(carta.tienda.tiempo)]);
  filas.push(['Domicilio', carta.envio == null ? 'Según la dirección' : carta.envio ? precioTexto(carta.envio) : 'Gratis']);
  if (carta.pedidos.minimo) filas.push(['Pedido mínimo', precioTexto(carta.pedidos.minimo)]);
  return `<dl class="t-hechos">${filas.map(([a, b]) => `<div><dt>${a}</dt><dd>${b}</dd></div>`).join('')}</dl>`;
}

const avisoViejo = (carta) => (carta.vieja ? '<p class="t-aviso">Estos precios son de la última vez que cargó nuestra carta. Confirma el precio al pedir.</p>' : '');

const todos = (carta) => carta.secciones.flatMap((s) => s.productos.map((p) => ({ p, s })));

// Las promociones de hoy: las que TRIVO tiene activas ahora (de la de mayor
// descuento a la de menor). Si no hay, lo destacado con foto.
export function promosDelDia(carta) {
  const lista = todos(carta).filter(({ p }) => p.disponible);
  const promos = lista.filter(({ p }) => p.antes).sort((a, b) => b.p.antes / b.p.precio - a.p.antes / a.p.precio);
  if (promos.length) return promos.slice(0, 10).map((x) => ({ ...x, promo: true }));
  return lista
    .filter(({ p }) => p.destacado && p.imagen)
    .slice(0, 4)
    .map((x) => ({ ...x, promo: false }));
}

// «Recomendados»: lo destacado, unas promociones y lo primero de cada categoría
// (sin repetir lo que ya sale en el carrusel).
function recomendados(carta, enCarrusel = []) {
  const lista = todos(carta).filter(({ p }) => p.disponible);
  const elegidos = [
    ...lista.filter(({ p }) => p.destacado),
    ...lista.filter(({ p }) => p.antes).slice(0, 3),
    ...carta.secciones.map((s) => s.productos.find((p) => p.disponible && p.imagen) || s.productos.find((p) => p.disponible)).filter(Boolean).map((p) => ({ p })),
    ...lista.filter(({ p }) => p.imagen),
  ];
  const vistos = new Set(enCarrusel.map(({ p }) => p.id));
  return elegidos.filter(({ p }) => !vistos.has(p.id) && vistos.add(p.id)).slice(0, 6).map(({ p }) => p);
}

const ICONO_PAUSA = svg('M9 6v12M15 6v12');
const ICONO_ANTERIOR = svg('M15 6l-6 6 6 6');
const ICONO_SIGUIENTE = svg('M9 6l6 6-6 6');

// El carrusel: se desliza con el dedo; con JavaScript pasa solo, con puntos,
// flechas y pausa (public/tienda.js). La foto va sobre blanco, con sus colores.
function carruselPromos(promos) {
  const n = promos.length;
  const diapositivas = promos
    .map(({ p, promo }, i) => {
      const ruta = esc(rutaProducto(p));
      const pct = p.antes ? Math.round((1 - p.precio / p.antes) * 100) : 0;
      const foto = p.imagen
        ? `<img src="${esc(p.imagen)}" alt="" width="400" height="400" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`
        : sinFoto();
      return `<article class="t-promo" id="t-promo-${i + 1}" role="group" aria-roledescription="diapositiva" aria-label="${i + 1} de ${n}: ${esc(p.nombre)}">
    <div class="t-promo-texto">
      <p class="t-promo-ceja">${promo ? 'Promoción de hoy' : 'Recomendado'}${p.nombrePromo ? ` · ${esc(p.nombrePromo)}` : ''}</p>
      <h2 class="t-promo-nombre">${esc(p.nombre)}</h2>
      <p class="t-promo-precio"><strong>${precioTexto(p.precio)}</strong>${p.antes ? `<del>${precioTexto(p.antes)}</del>${pct > 0 ? `<span class="t-promo-pct">−${pct}%</span>` : ''}` : ''}</p>
      <div class="t-promo-botones"><a class="t-boton" href="${ruta}">Pedir ya</a><a class="t-boton t-boton-borde" href="${promo ? '/productos?oferta=1' : '/productos'}">${promo ? 'Ver todas las promociones' : 'Ver todos los productos'}</a></div>
    </div>
    <a class="t-promo-foto" href="${ruta}" tabindex="-1" aria-hidden="true">${foto}</a>
  </article>`;
    })
    .join('\n');
  const controles =
    n > 1
      ? `<div class="t-promos-control" data-control hidden>
    <button type="button" class="t-promos-boton" data-pausa aria-label="Pausar las promociones">${ICONO_PAUSA}</button>
    <div class="t-promos-puntos">${promos.map((_, i) => `<button type="button" data-punto="${i}" aria-label="Promoción ${i + 1} de ${n}"${i === 0 ? ' aria-current="true"' : ''}></button>`).join('')}</div>
    <button type="button" class="t-promos-boton t-promos-flecha" data-paso="-1" aria-label="Promoción anterior">${ICONO_ANTERIOR}</button>
    <button type="button" class="t-promos-boton t-promos-flecha" data-paso="1" aria-label="Siguiente promoción">${ICONO_SIGUIENTE}</button>
  </div>`
      : '';
  return `<section class="t-promos" aria-roledescription="carrusel" aria-label="${promos[0].promo ? 'Promociones de hoy' : 'Recomendados'}" data-carrusel>
  <div class="t-promos-pista" data-pista>
  ${diapositivas}
  </div>
  ${controles}
</section>`;
}

export function paginaHtml(carta, { base }) {
  const { titulo, descripcion, enLista } = textosSeo(carta);
  const pendientes = { fotos: 4 };
  const promos = promosDelDia(carta);
  const reco = recomendados(carta, promos);
  const categorias = carta.secciones
    .map((s) => `<li><a href="${rutaCategoria(s)}"><span class="t-cat-icono">${iconoCategoria(s.nombre)}</span><span>${esc(s.nombre)}</span></a></li>`)
    .join('');
  const filas = carta.secciones
    .map(
      (s) => `<section class="t-bloque" aria-labelledby="t-s-${esc(s.id)}">
  <div class="t-bloque-cab"><h2 id="t-s-${esc(s.id)}">${esc(s.nombre)}</h2><a href="${rutaCategoria(s)}">Ver ${s.productos.length > 6 ? `los ${s.productos.length}` : 'todo'}</a></div>
  <ul class="t-rejilla t-fila">
${s.productos
  .slice(0, 6)
  .map((p) => tarjeta(p, pendientes))
  .join('\n')}
  </ul>
</section>`,
    )
    .join('\n');

  return `${cabeza(carta, { titulo, descripcion, canonica: `${base}/`, imagen: promos[0]?.p.imagen, datos: ld(negocioLd(carta, base), catalogoLd(carta, base)) + datosPagina(carta), clase: 't-en-inicio' })}
${cabecera(carta, { actual: 'inicio' })}
<main class="t-principal" id="contenido">
<div class="t-ancho">
  ${avisoViejo(carta)}
  <div class="t-portada">
    <section class="t-info" aria-labelledby="t-h1">
      <h1 id="t-h1">${esc(mayuscula(enLista))} a domicilio en ${esc(carta.ciudad)}</h1>
      ${carta.tienda.lema ? `<p class="t-lema">${esc(carta.tienda.lema)}</p>` : ''}
      ${hechos(carta)}
      ${carta.pedidos.nota ? `<p class="t-info-nota">${esc(carta.pedidos.nota)}</p>` : ''}
    </section>
    ${promos.length ? carruselPromos(promos) : ''}
  </div>
  <section class="t-bloque" aria-labelledby="t-cats">
    <div class="t-bloque-cab"><h2 id="t-cats">¿Qué se te antoja?</h2></div>
    <ul class="t-cats">${categorias}</ul>
  </section>
  ${
    reco.length
      ? `<section class="t-bloque" aria-labelledby="t-reco">
    <div class="t-bloque-cab"><h2 id="t-reco">Recomendados</h2><a href="/productos">Ver todo</a></div>
    <ul class="t-rejilla">
${reco.map((p) => tarjeta(p, pendientes)).join('\n')}
    </ul>
  </section>`
      : ''
  }
  ${filas}
</div>
</main>
${pie(carta, 'inicio')}`;
}

// Las pestañas Unidad / Six pack / Caja y los filtros (los activa public/tienda.js).
function controlesLista(productos) {
  const grupos = [...new Set(productos.map((p) => p.grupo))].sort();
  const pestanas =
    grupos.length > 1
      ? `<div class="t-pestanas" role="group" aria-label="Presentación" data-pestanas hidden><button type="button" aria-pressed="true" data-grupo="">Todo</button>${grupos
          .map((g) => `<button type="button" aria-pressed="false" data-grupo="${g}">${GRUPO_CORTO[g]}</button>`)
          .join('')}</div>`
      : '';
  const oferta = productos.some((p) => p.antes) ? '<button type="button" aria-pressed="false" data-solo-oferta>En oferta</button>' : '';
  return `${pestanas}<div class="t-filtros" data-filtros hidden><button type="button" aria-pressed="false" data-orden-precio>Menor precio</button>${oferta}</div>`;
}

// Una sección como lista; si mezcla unidades, six pack y cajas, por grupos.
function listaSeccion(productos, pendientes, nivel) {
  const grupos = [...new Set(productos.map((p) => p.grupo))].sort();
  if (grupos.length < 2) return `<ul class="t-lista">\n${productos.map((p) => tarjeta(p, pendientes, nivel)).join('\n')}\n</ul>`;
  return grupos
    .map((g) => {
      const delGrupo = productos.filter((p) => p.grupo === g);
      return `<div class="t-grupo" data-grupo-lista="${g}">
<h${nivel - 1 < 2 ? 2 : nivel - 1} class="t-subgrupo">${GRUPOS[g]} <span>${delGrupo.length}</span></h${nivel - 1 < 2 ? 2 : nivel - 1}>
<ul class="t-lista">
${delGrupo.map((p) => tarjeta(p, pendientes, nivel)).join('\n')}
</ul>
</div>`;
    })
    .join('\n');
}

const migasHtml = (pasos) =>
  `<nav class="t-migas" aria-label="Estás en"><ol>${pasos
    .map(([texto, ruta], i) => (i === pasos.length - 1 ? `<li aria-current="page">${esc(texto)}</li>` : `<li><a href="${esc(ruta)}">${esc(texto)}</a></li>`))
    .join('')}</ol></nav>`;

// Busca con todas las palabras en el nombre o la categoría, sin tildes.
export function filtrarCarta(carta, buscar) {
  const palabras = sinTildes(buscar).split(/\s+/).filter(Boolean);
  if (!palabras.length) return carta.secciones;
  return carta.secciones
    .map((s) => ({ ...s, productos: s.productos.filter((p) => palabras.every((w) => sinTildes(`${p.nombre} ${s.nombre}`).includes(w))) }))
    .filter((s) => s.productos.length);
}

// Una categoría («/categoria/cervezas») o todos los productos («/productos»,
// con «?buscar=» para el buscador sin JavaScript).
export function paginaCategoria(carta, { base, seccion = null, buscar = '', oferta = false }) {
  const pendientes = { fotos: 4 };
  const secciones = (seccion ? [seccion] : filtrarCarta(carta, buscar))
    .map((s) => (oferta ? { ...s, productos: s.productos.filter((p) => p.antes) } : s))
    .filter((s) => s.productos.length);
  const productos = secciones.flatMap((s) => s.productos);
  const titulo = seccion ? seccion.nombre : buscar ? `Resultados para «${buscar}»` : oferta ? 'Promociones de hoy' : 'Todos los productos';
  const ruta = seccion ? rutaCategoria(seccion) : '/productos';
  const tituloSeo = seccion ? `${seccion.nombre} a domicilio en ${carta.ciudad} | ${carta.marca}` : `Productos a domicilio en ${carta.ciudad} | ${carta.marca}`;
  const descripcion = seccion
    ? `${seccion.nombre} a domicilio en ${carta.ciudad}: ${seccion.productos
        .slice(0, 4)
        .map((p) => p.nombre)
        .join(', ')} y más. Precios al día y pedido en línea en ${carta.marca}.`
    : `Todos los productos de ${carta.marca} con precios al día y domicilio en ${carta.ciudad}.`;
  const wa = whatsappGeneral(carta);
  const contenido = seccion
    ? listaSeccion(productos, pendientes, 3)
    : secciones
        .map(
          (s) => `<section class="t-bloque" id="${esc(s.id)}" aria-labelledby="t-s-${esc(s.id)}" data-seccion>
  <div class="t-bloque-cab"><h2 id="t-s-${esc(s.id)}">${esc(s.nombre)}</h2><a href="${rutaCategoria(s)}">Solo ${esc(s.nombre.toLowerCase())}</a></div>
  ${listaSeccion(s.productos, pendientes, 4)}
</section>`,
        )
        .join('\n');
  return `${cabeza(carta, {
    titulo: tituloSeo,
    descripcion,
    canonica: buscar || oferta ? null : `${base}${ruta}`,
    robots: buscar || oferta ? 'noindex, follow' : undefined,
    datos: ld(catalogoLd(carta, base, secciones), migasLd(base, [['Inicio', `${base}/`], [seccion ? seccion.nombre : 'Productos', `${base}${ruta}`]])) + datosPagina(carta),
    clase: 't-en-lista',
  })}
${cabecera(carta, { actual: seccion ? seccion.id : 'productos', buscar })}
<main class="t-principal" id="contenido">
<div class="t-ancho">
  ${migasHtml([['Inicio', '/'], [seccion ? seccion.nombre : 'Productos', ruta]])}
  ${avisoViejo(carta)}
  <div class="t-titulo"><h1>${esc(titulo)}</h1><p>${productos.length} ${productos.length === 1 ? 'producto' : 'productos'} · ${esc(carta.marca)}</p></div>
  ${productos.length ? controlesLista(productos) : ''}
  ${contenido}
  <p class="t-vacio" data-vacio${productos.length ? ' hidden' : ''}>No encontramos ese producto. ${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a>.` : ''}</p>
</div>
</main>
${pie(carta, 'productos')}`;
}

// La lata, el six pack y la caja de la misma cerveza, para pasar de una a otra.
function hermanos(p, seccion) {
  const f = familia(p.nombre);
  const lista = seccion.productos.filter((x) => familia(x.nombre) === f);
  return new Set(lista.map((x) => x.grupo)).size > 1 ? lista : [];
}

const unidadesDe = (p) => (p.grupo === 1 ? 6 : p.grupo === 2 ? Number(p.nombre.match(/x\s*(\d+)\s*unidades/i)?.[1]) || null : 1);

// «En caja ahorras $4.800 frente a 24 sueltas»: solo si de verdad sale más barato.
function textoAhorro(p, lista) {
  const sueltas = lista.filter((x) => x.grupo === 0);
  if (!sueltas.length) return '';
  const unidad = Math.min(...sueltas.map((x) => x.precio));
  const ahorro = (x) => (unidadesDe(x) ? unidad * unidadesDe(x) - x.precio : 0);
  const candidatos = p.grupo > 0 ? [p] : lista.filter((x) => x.grupo > 0);
  const mejor = candidatos.filter((x) => ahorro(x) > 0).sort((a, b) => ahorro(b) - ahorro(a))[0];
  if (!mejor) return '';
  const nombre = GRUPO_CORTO[mejor.grupo].toLowerCase();
  return `${mejor === p ? `En ${nombre}` : `Llevando el ${nombre}`.replace('el caja', 'la caja')} ahorras ${precioTexto(ahorro(mejor))} frente a ${unidadesDe(mejor)} sueltas.`;
}

// «Va bien con»: lo primero de otras categorías (el hielo primero).
function acompanantes(carta, seccion) {
  const otras = carta.secciones.filter((s) => s !== seccion).sort((a, b) => /hielo/i.test(b.nombre) - /hielo/i.test(a.nombre));
  return otras
    .map((s) => s.productos.find((p) => p.disponible && p.imagen) || s.productos.find((p) => p.disponible))
    .filter(Boolean)
    .slice(0, 4);
}

// Las opciones de TRIVO (variantes): si son frío / al clima, es la temperatura.
const leyendaVariantes = (p, conHermanos) =>
  p.variantes.every((v) => /^(fr[ií]a|caliente|al clima|natural|helada)$/i.test(v.nombre)) ? 'Temperatura' : conHermanos ? 'Opciones' : 'Presentación';

// La página de un producto: foto, precio, presentación, cantidad y «Agregar».
export function paginaProducto(carta, p, seccion, { base }) {
  const url = `${base}${rutaProducto(p)}`;
  const familiares = hermanos(p, seccion);
  const ahorro = familiares.length ? textoAhorro(p, familiares) : '';
  const otros = seccion.productos
    .filter((x) => x.id !== p.id && !familiares.includes(x))
    .sort((a, b) => (a.grupo === p.grupo ? 0 : 1) - (b.grupo === p.grupo ? 0 : 1) || Boolean(b.imagen) - Boolean(a.imagen))
    .slice(0, 8);
  const junto = acompanantes(carta, seccion);
  const duda = enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, tengo una pregunta sobre ${p.nombre}.`);
  const pedirWa = enlaceWhatsapp(carta.whatsapp, `Hola ${carta.marca}, quiero pedir ${p.nombre} a domicilio en ${carta.ciudad}.`);
  const pendientes = { fotos: 0 };
  const opcionesHermanos = familiares.length
    ? `<fieldset class="t-opciones">
      <legend>Presentación</legend>
      <div>${familiares
        .map(
          (x) =>
            `<a class="t-opcion" href="${esc(rutaProducto(x))}"${x.id === p.id ? ' aria-current="page"' : ''}><span>${esc(familiares.filter((y) => y.grupo === x.grupo).length > 1 ? x.nombre : GRUPO_CORTO[x.grupo])}</span><b>${precioTexto(x.precio)}</b></a>`,
        )
        .join('')}</div>
      ${ahorro ? `<p class="t-ahorro">${esc(ahorro)}</p>` : ''}
    </fieldset>`
    : '';
  const opcionesVariantes =
    p.disponible && p.variantes.length > 1
      ? `<fieldset class="t-opciones">
      <legend>${leyendaVariantes(p, Boolean(familiares.length))}</legend>
      <div>${p.variantes
        .map(
          (v, i) =>
            `<label class="t-opcion"><input type="radio" name="presentacion" value="${esc(v.id)}" data-precio="${esc(v.precio)}"${i === 0 ? ' checked' : ''}><span>${esc(v.nombre)}</span><b>${precioTexto(v.precio)}</b></label>`,
        )
        .join('')}</div>
    </fieldset>`
      : '';
  const comprar = p.disponible
    ? `<div class="t-ficha-comprar" data-producto="${esc(p.id)}"><a class="t-boton t-grande" href="${esc(pedirWa || rutaProducto(p))}" data-agregar="${esc(p.id)}" data-texto="Agregar"><span>Agregar al pedido</span></a></div>`
    : '<p class="t-ficha-agotado">Agotado por ahora</p>';

  return `${cabeza(carta, {
    titulo: `${p.nombre} a domicilio en ${carta.ciudad} | ${carta.marca}`,
    descripcion: descripcionProducto(p, carta),
    canonica: url,
    imagen: p.imagen,
    tipo: 'product',
    datos: ld(...productoLd(p, seccion, carta, base)) + datosPagina(carta),
    clase: 't-en-producto',
  })}
${cabecera(carta, { actual: seccion.id })}
<main class="t-principal" id="contenido">
<div class="t-ancho">
  ${migasHtml([['Inicio', '/'], [seccion.nombre, rutaCategoria(seccion)], [p.nombre, rutaProducto(p)]])}
  ${avisoViejo(carta)}
  <article class="t-ficha${p.disponible ? '' : ' t-no'}">
    <figure class="t-ficha-foto">${p.imagen ? `<img src="${esc(p.imagen)}" alt="${esc(p.nombre)}" width="800" height="800" fetchpriority="high">` : sinFoto()}${p.antes ? '<span class="t-sello">Oferta</span>' : ''}</figure>
    <div class="t-ficha-info">
      <p class="t-ceja"><a href="${rutaCategoria(seccion)}">${esc(seccion.nombre)}</a>${p.grupo || familiares.length ? ` · ${GRUPO_CORTO[p.grupo]}` : ''}</p>
      <h1>${esc(p.nombre)}</h1>
      <p class="t-ficha-precio">${p.desde ? '<small>Desde</small>' : ''}<strong data-precio>${precioTexto(p.precio)}</strong>${p.antes ? `<del>${precioTexto(p.antes)}</del><span class="t-sello">Oferta</span>` : ''}</p>
      ${p.descripcion ? `<p class="t-ficha-desc">${esc(p.descripcion)}</p>` : ''}
      ${opcionesHermanos}
      ${opcionesVariantes}
      ${comprar}
      <section class="t-entrega-info" aria-label="Entrega">
        ${ICONOS.camion}
        <p><strong>${carta.tienda.tiempo ? `Llega en ${esc(carta.tienda.tiempo)}` : `Domicilio en ${esc(carta.ciudad)}`}</strong><span>${carta.envio ? `Domicilio ${precioTexto(carta.envio)}` : 'El domicilio se calcula con tu dirección'}${carta.pedidos.minimo ? ` · pedido mínimo ${precioTexto(carta.pedidos.minimo)}` : ''}.</span></p>
      </section>
      ${duda ? `<p class="t-duda">¿Tienes dudas? <a href="${esc(duda)}" target="_blank" rel="noopener">Pregúntanos por WhatsApp</a></p>` : ''}
    </div>
  </article>
  ${
    junto.length
      ? `<section class="t-bloque" aria-labelledby="t-junto">
  <div class="t-bloque-cab"><h2 id="t-junto">Va bien con</h2></div>
  <ul class="t-rejilla t-fila">
${junto.map((x) => tarjeta(x, pendientes)).join('\n')}
  </ul>
</section>`
      : ''
  }
  ${
    otros.length
      ? `<section class="t-bloque" aria-labelledby="t-otros">
  <div class="t-bloque-cab"><h2 id="t-otros">Más de ${esc(seccion.nombre.toLowerCase())}</h2><a href="${rutaCategoria(seccion)}">Ver todo</a></div>
  <ul class="t-rejilla t-fila">
${otros.map((x) => tarjeta(x, pendientes)).join('\n')}
  </ul>
</section>`
      : ''
  }
</div>
</main>
${pie(carta, 'productos')}`;
}

function paginaNoEsta(carta, que = 'Este producto') {
  return `${cabeza(carta, { titulo: `No disponible | ${carta.marca}`, descripcion: `${que} ya no está en la carta de ${carta.marca}.`, robots: 'noindex' })}
${cabecera(carta)}
<main class="t-principal" id="contenido">
<div class="t-ancho">
  <section class="t-caida"><h1>${esc(que)} ya no está en la carta</h1><p>Mira lo que tenemos hoy.</p><p><a class="t-boton t-grande" href="/productos">Ver todos los productos</a></p></section>
</div>
</main>
${pie(carta, '')}`;
}

// Cuando la carta no se pudo leer nunca: una página corta.
function paginaSinCarta(marca) {
  return `<!doctype html>
<html lang="es-CO"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(marca.nombre)}</title><meta name="robots" content="noindex"><link rel="stylesheet" href="/tienda.css"><link rel="stylesheet" href="/marca.css"></head>
<body><main class="t-ancho t-caida"><h1>${esc(marca.nombre)}</h1><p>La tienda no cargó en este momento. Intenta de nuevo en unos minutos.</p></main></body></html>`;
}

function mapaDelSitio(carta, base) {
  const fecha = new Date(carta?.t || Date.now()).toISOString().slice(0, 10);
  const url = (ruta, extra = '') => `  <url><loc>${esc(base + ruta)}</loc><lastmod>${fecha}</lastmod>${extra}</url>`;
  const urls = [url('/')];
  if (carta) {
    urls.push(url('/productos'));
    for (const s of carta.secciones) urls.push(url(rutaCategoria(s)));
    for (const p of carta.secciones.flatMap((s) => s.productos)) {
      urls.push(url(rutaProducto(p), p.imagen ? `<image:image><image:loc>${esc(p.imagen)}</image:loc></image:image>` : ''));
    }
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

export async function responderTienda(request, { ahora = Date.now() } = {}) {
  const url = new URL(request.url);
  const base = baseDe(request);
  if (url.pathname === '/robots.txt') {
    return new Response(`User-agent: *\nAllow: /\nDisallow: /panel\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml\n`, {
      headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const marca = await leerMarca();
  if (url.pathname === '/marca.css') return new Response(marcaCss(marca), { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'text/css; charset=utf-8' } });
  if (url.pathname === '/marca.svg') return new Response(marcaSvg(marca), { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'image/svg+xml; charset=utf-8' } });

  const leida = await cargarCarta();
  if (url.pathname === '/sitemap.xml') {
    return new Response(mapaDelSitio(leida, base), { headers: { ...SEGURIDAD, ...CACHE, 'content-type': 'application/xml; charset=utf-8' } });
  }
  if (!leida) {
    return new Response(paginaSinCarta(marca), {
      status: 503,
      headers: { ...SEGURIDAD, 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '300' },
    });
  }
  // La tienda lleva el nombre del distribuidor, no el de la carta de TRIVO.
  const envio = await domicilioBase({ sucursal: leida.sucursal || 'B001', ciudad: leida.ciudad });
  const carta = { ...leida, marca: marca.nombre, lema: marca.lema, tienda: marca, envio, ahora };

  if (url.pathname.startsWith('/producto/')) {
    const id = url.pathname.match(/-(\d+)\/?$/)?.[1];
    const hallado = id ? buscarProducto(carta, id) : null;
    if (!hallado) return new Response(paginaNoEsta(carta), { status: 404, headers: HTML });
    const ruta = rutaProducto(hallado.p);
    // Nombre viejo o mal escrito: a la dirección de hoy, para que Google guarde una sola.
    if (url.pathname !== ruta) return new Response(null, { status: 301, headers: { ...SEGURIDAD, ...CACHE, location: `${base}${ruta}` } });
    return new Response(paginaProducto(carta, hallado.p, hallado.seccion, { base }), { headers: HTML });
  }
  if (url.pathname.startsWith('/categoria/')) {
    const id = url.pathname.slice('/categoria/'.length).replace(/\/$/, '');
    const seccion = carta.secciones.find((s) => s.id === id);
    if (!seccion) return new Response(paginaNoEsta(carta, 'Esta categoría'), { status: 404, headers: HTML });
    return new Response(paginaCategoria(carta, { base, seccion }), { headers: HTML });
  }
  if (url.pathname === '/productos' || url.pathname === '/productos/') {
    const buscar = String(url.searchParams.get('buscar') || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    return new Response(paginaCategoria(carta, { base, buscar, oferta: url.searchParams.get('oferta') === '1' }), { headers: HTML });
  }
  return new Response(paginaHtml(carta, { base }), { headers: HTML });
}

// Para las pruebas.
export function olvidarMemoria() {
  enMemoria = null;
  envioEnMemoria = null;
}
