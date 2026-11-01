// Utilidades para limpiar nombres, leer presentaciones (ml y unidades) y
// decidir si un producto corresponde a lo que se buscó.

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'x', 'por']);

// Minúsculas, sin tildes (ñ → n) y con el número pegado a su unidad ("750 ml" → "750ml").
export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`´]/g, '')
    .replace(/(\d)\s+(ml|cc|lts?|litros?|l)(?![a-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

const caracter = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');

// Algunas tiendas entregan nombres con caracteres dañados (ANTIOQUE�O, 24�).
export function repararNombre(texto = '') {
  return String(texto)
    .replace(/(?<=[A-Z])[�#](?=[A-Z])/g, 'Ñ')
    .replace(/(?<=[a-z])�(?=[a-z])/g, 'ñ')
    .replace(/(?<=\d)�/g, '°')
    .replace(/�/g, '')
    .replace(/&#x([0-9a-f]{1,6});/gi, (_, h) => caracter(parseInt(h, 16)))
    .replace(/&#(\d{1,7});/g, (_, d) => caracter(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

// La "x" puede ir pegada a la unidad: "330MLX6U".
const RE_VOLUMEN = /(\d+(?:[.,]\d+)?)\s*(ml|cc|mililitros?|litros?|lts?|l)(?![a-wyz])/i;

// Devuelve el contenido en ml de una unidad, o null si el texto no lo dice.
export function extraerMl(texto = '') {
  const m = String(texto).match(RE_VOLUMEN);
  if (!m) return null;
  const unidad = m[2].toLowerCase();
  let numero = m[1];
  const enMl = unidad === 'ml' || unidad === 'cc' || unidad.startsWith('mili');
  // "1.750 ml" usa punto de miles; "1.05 L" usa punto decimal.
  if (enMl && /^\d{1,2}[.,]\d{3}$/.test(numero)) numero = numero.replace(/[.,]/, '');
  const valor = parseFloat(numero.replace(',', '.'));
  const ml = enMl ? valor : valor * 1000;
  return ml >= 50 && ml <= 20000 ? Math.round(ml) : null;
}

// Algunas tiendas ponen el contenido total del empaque ("six pack (1614 ml)"):
// si al dividir por las unidades da un tamaño de lata o botella conocido, ese
// es el tamaño de cada una.
const TAMANOS_UNIDAD = [180, 200, 207, 210, 220, 237, 250, 269, 275, 300, 310, 330, 350, 355, 375, 473, 500, 750];
export function mlPorUnidad(ml, unidades) {
  if (!ml || !(unidades > 1) || ml < 1000) return ml;
  const porUnidad = ml / unidades;
  const conocido = TAMANOS_UNIDAD.find((t) => Math.abs(t - porUnidad) <= 1);
  return conocido ?? ml;
}

// Cerveza publicada como una sola lata con el contenido del paquete entero
// ("Cerveza STELLA ARTOIS lata (1614 ml)" = 6 × 269). Una lata o botella de
// cerveza no pasa de 1 litro: si el total se reparte exacto en 4, 6, 12, 24 o
// 30 unidades de un tamaño conocido, ese es el paquete.
export function inferirPaquete(nombre, ml, unidades) {
  if (!ml || unidades > 1 || ml < 1000 || !/cerveza|beer/i.test(String(nombre))) return { ml, unidades };
  for (const n of [6, 24, 12, 4, 30]) {
    const conocido = TAMANOS_UNIDAD.find((t) => t < 750 && Math.abs(t - ml / n) <= 1);
    if (conocido) return { ml: conocido, unidades: n };
  }
  return { ml, unidades };
}

// Unidades por empaque: six pack, "x6", "6 latas", "caja x 24"…
export function extraerUnidades(texto = '') {
  const t = normalizar(texto);
  // "PAGUE 11 LLEVE 12", "PAG11 LLEV12": el paquete trae las que se llevan.
  const promo = t.match(/pag(?:ue)?\s*\d{1,2}\s*l+lev(?:e|a)?\s*(\d{1,2})(?!\d)/);
  if (promo) return Number(promo[1]);
  if (/six\s*-?\s*pack|sixpack/.test(t)) return 6;
  if (/twelve\s*-?\s*pack/.test(t)) return 12;
  if (/four\s*-?\s*pack/.test(t)) return 4;
  const m =
    t.match(/\d(?:ml|cc|l|lt)\s*x\s*(\d{1,2})(?!\d)/) ||
    t.match(/(?:^|[^a-z])(?:x|pack|paquete|canasta|caja|display)\s*(?:de\s*|x\s*)?(\d{1,2})(?![\d.,]|\s*(?:ml|cc|l|lt|litros?)\b)/) ||
    t.match(/(?:^|\D)(\d{1,2})\s*(?:unidades|unds?|uds?|latas|botellas|botellines)\b/);
  const n = m ? parseInt(m[1], 10) : 1;
  return n >= 1 && n <= 60 ? n : 1;
}

// Palabras de la búsqueda que deben aparecer en el nombre del producto.
export function palabrasClave(consulta) {
  return normalizar(consulta)
    .split(/[^a-z0-9.]+/)
    .filter((p) => p && !PALABRAS_VACIAS.has(p));
}

// Lo que se le manda al buscador de cada tienda: sin tamaños ni números, porque
// cada tienda escribe la presentación distinto ("750 ML", "750ml", "0,75 L").
// El tamaño se filtra después con `coincide`.
export function consultaParaTienda(consulta) {
  const limpia = String(consulta)
    .replace(/\b\d+(?:[.,]\d+)?\s*(?:ml|cc|lts?|litros?|l)?\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return limpia || String(consulta).trim();
}

// ── Coincidencia de palabras ─────────────────────────────────────────────────
// Se compara palabra por palabra, nunca dentro de otra ("ron" no encuentra
// "toronja"). Una palabra coincide si es igual, si es su plural, si una es la
// abreviatura de la otra ("aguardient", "antioq") o, en palabras largas, si
// solo cambia una letra ("buchanas" → "buchanans").

const SINONIMOS = [
  ['aguardiente', 'aguard', 'aguardient'],
  ['antioqueno', 'antioquena', 'antioq'],
  ['whisky', 'whiskey', 'wisky', 'wiskey', 'whisk'],
  ['vodka', 'vodca'],
  ['tequila', 'teq'],
  ['champana', 'champagne', 'champan'],
  ['ginebra', 'gin'],
  ['cerveza', 'cerv'],
  ['santafe', 'santa fe'],
  ['cero', 'zero', 'sin alcohol'],
];

// Palabras de categoría: si la tienda no las escribe ("Old Parr 12 años" sin
// "whisky"), el producto sigue contando. Las demás palabras son obligatorias.
const GENERICAS = new Set([
  'aguardiente', 'whisky', 'whiskey', 'ron', 'vodka', 'tequila', 'ginebra', 'gin', 'vino', 'cerveza',
  'champana', 'champagne', 'espumoso', 'espumante', 'brandy', 'cognac', 'conac', 'licor', 'crema', 'aperitivo',
  'mezcal', 'pisco', 'sake', 'agua', 'gaseosa', 'refresco', 'bebida', 'energizante', 'jugo', 'soda', 'sangria',
  'tradicional', 'original', 'clasico', 'clasica', 'regular', 'nacional', 'importado', 'importada',
]);

export const PRESENTACIONES = new Set([
  'ml', 'cc', 'lt', 'lts', 'litro', 'litros', 'l',
  'unid', 'unids', 'unidad', 'unidades', 'u', 'uds', 'und', 'unds',
  'pack', 'sixpack', 'six', 'twelve', 'four', 'caja', 'display', 'canasta', 'paquete', 'botella', 'botellas',
  'lata', 'latas', 'garrafa', 'botellin', 'botellines', 'pet', 'vidrio', 'tetrapak', 'tetra', 'media', 'medias',
]);

// Variantes que cambian el producto. Si no se escribieron y hay otras opciones
// sin ellas, el producto se marca como «otra variante» y se oculta por defecto.
const VARIANTES = [
  ['sin azucar', 'Sin azúcar'], ['cero azucar', 'Sin azúcar'], ['zero', 'Zero'], ['cero', 'Zero'],
  ['light', 'Light'], ['lite', 'Light'], ['ligth', 'Light'], ['ligh', 'Light'], ['refajo', 'Refajo'], ['guayera', 'Con obsequio'],
  // La tapa roja es el Antioqueño de siempre: no cuenta como variante.
  ['tapa azul', 'Tapa azul'], ['tapa verde', 'Tapa verde'], ['azul', 'Azul'], ['verde', 'Verde'],
  ['real', 'Real'], ['amarillo', 'Amarillo'], ['herencia', 'Herencia'], ['double', 'Double'],
  ['con gas', 'Con gas'], ['gasificada', 'Con gas'], ['imperial', 'Imperial'], ['colombia roja', 'Roja'], ['colombia negra', 'Negra'], ['pink', 'Pink'], ['rosado', 'Rosado'], ['vasos', 'Con vaso'], ['gratis', 'Con obsequio'],
  ['obsequio', 'Con obsequio'], ['regalo', 'Con obsequio'],
  ['gran reserva', 'Gran reserva'], ['reserva', 'Reserva'], ['anejo', 'Añejo'], ['extra anejo', 'Extra añejo'],
  ['sabor', 'Con sabor'], ['saborizado', 'Con sabor'], ['saborizada', 'Con sabor'], ['michelada', 'Michelada'],
  ['radler', 'Radler'], ['limon', 'Limón'], ['mango', 'Mango'], ['maracuya', 'Maracuyá'], ['cereza', 'Cereza'],
  ['manzana', 'Manzana'], ['durazno', 'Durazno'], ['coco', 'Coco'], ['pina', 'Piña'], ['fresa', 'Fresa'],
  ['mandarina', 'Mandarina'], ['naranja', 'Naranja'], ['uva', 'Uva'], ['cafe', 'Café'], ['vainilla', 'Vainilla'],
  ['canela', 'Canela'], ['chocolate', 'Chocolate'], ['ice', 'Ice'], ['sin alcohol', 'Sin alcohol'],
  ['estuche', 'Estuche'], ['kit', 'Kit'], ['combo', 'Combo'], ['ancheta', 'Ancheta'], ['vaso', 'Con vaso'],
];

// Palabras de un texto ya normalizado (sin tildes, apóstrofos ni signos).
export function tokens(texto) {
  return normalizar(texto).split(/[^a-z0-9]+/).filter(Boolean);
}

// Distancia de edición (Damerau, con letras cambiadas de lugar: "jhonnie" →
// "johnnie" es 1) con tope: devuelve tope + 1 si se pasa.
export function distancia(a, b, tope = 2) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let antes = null;
  let previa = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (antes && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) fila[j] = Math.min(fila[j], antes[j - 2] + 1);
      menor = Math.min(menor, fila[j]);
    }
    if (menor > tope) return tope + 1;
    antes = previa;
    previa = fila;
  }
  return Math.min(previa[b.length], tope + 1);
}

function parecida(p, t) {
  if (p === t) return 3;
  if (t === `${p}s` || t === `${p}es` || p === `${t}s` || p === `${t}es`) return 2;
  // Abreviaturas en cualquier sentido: "cristal" → "cristalino", "aguardient" → "aguardiente".
  if (p.length >= 4 && t.startsWith(p) && t.length - p.length <= 4) return 2;
  if (t.length >= 5 && p.startsWith(t)) return 2;
  if (p.length >= 6 && t.length >= 5 && distancia(p, t, 1) <= 1) return 1;
  return 0;
}

const esNumero = (p) => /^\d/.test(p);
const reNumero = (p) => new RegExp(`(?<![\\d.,])${p.replace('.', '\\.')}(?![\\d])`);

// Qué tan bien aparece una palabra de la búsqueda en el producto: 3 exacta,
// 2 plural, abreviatura o sinónimo, 1 con una letra distinta, 0 no aparece.
export function puntajePalabra(p, texto, lista = tokens(texto)) {
  if (esNumero(p)) return reNumero(p).test(texto) ? 3 : 0;
  let mejor = 0;
  for (const t of lista) {
    mejor = Math.max(mejor, parecida(p, t));
    if (mejor === 3) return 3;
  }
  if (mejor) return mejor;
  const grupo = SINONIMOS.find((g) => g.some((s) => s === p || (!s.includes(' ') && parecida(p, s) >= 2)));
  if (grupo) {
    const unido = ` ${lista.join(' ')} `;
    if (grupo.some((s) => (s.includes(' ') ? unido.includes(` ${s} `) : lista.some((t) => parecida(s, t) >= 2)))) return 2;
  }
  return 0;
}

// Abreviaturas y sinónimos de las tiendas: "S/A" (sin azúcar), "S/ALCOHOL",
// "0,0", "libre de alcohol" y, en cerveza, "Cero": todo queda como "sin
// alcohol". "Sabor sin igual" es el eslogan de la Águila Light, no un sabor.
const expandir = (nombre) => {
  let t = String(nombre)
    .replace(/sabor sin igual/gi, ' ')
    .replace(/\bs\s*\/\s*a\b/gi, ' sin azucar ')
    .replace(/\bs\s*\/\s*alcohol\b/gi, ' sin alcohol ')
    .replace(/(?<![\d.,])0[.,]0\s*%?(?![\d])/g, ' sin alcohol ')
    .replace(/libre de alcohol/gi, ' sin alcohol ');
  if (/cervez|beer/i.test(t) && /\b(cero|zero)\b/i.test(t)) t = t.replace(/\b(cero|zero)\b/gi, ' sin alcohol ');
  return t;
};

const textoDe = (producto) => normalizar(`${expandir(producto.nombre)} ${producto.ml ? `${producto.ml}ml` : ''}`);

// Todas las palabras de la búsqueda aparecen (incluidas las de categoría y el
// tamaño). Lo usa el monitoreo para saber qué es exactamente «el» producto.
export function coincide(producto, palabras) {
  const texto = textoDe(producto);
  const lista = tokens(texto);
  return palabras.filter((p) => !PRESENTACIONES.has(p)).every((p) => puntajePalabra(p, texto, lista) > 0);
}

// Palabras que el producto tiene que traer sí o sí: todo menos las de
// categoría. Si la búsqueda solo trae palabras de categoría, todas.
export function obligatorias(palabras) {
  const validas = palabras.filter((p) => !PRESENTACIONES.has(p));
  const propias = validas.filter((p) => !GENERICAS.has(p));
  return propias.length ? propias : validas;
}

export function coincideBusqueda(producto, palabras) {
  const texto = textoDe(producto);
  const lista = tokens(texto);
  const necesarias = obligatorias(palabras);
  return necesarias.length > 0 && necesarias.every((p) => puntajePalabra(p, texto, lista) > 0);
}

// Palabras de una consulta que describen presentación, no producto.
export function palabrasPresentacion(consulta) {
  return normalizar(consulta)
    .split(/[^a-z0-9.]+/)
    .filter((p) => PRESENTACIONES.has(p));
}

// Variantes que trae el nombre y que la búsqueda no pidió.
export function variantesNoPedidas(producto, palabras) {
  const texto = ` ${tokens(expandir(producto.nombre)).join(' ')} `;
  const pedido = ` ${palabras.join(' ')} `;
  const vistas = new Set();
  // Una variante se pidió si la búsqueda trae cualquiera de sus formas ("light" cubre "ligh" y "lite").
  const pedidas = new Set(VARIANTES.filter(([frase]) => frase.split(' ').filter((f) => !PALABRAS_VACIAS.has(f)).every((f) => pedido.includes(` ${f} `))).map(([, etiqueta]) => etiqueta));
  // En cerveza, «cero» es «sin alcohol»: pedir una cubre la otra.
  if (pedidas.has('Zero') || pedidas.has('Sin alcohol')) pedidas.add('Zero').add('Sin alcohol');
  for (const [frase, etiqueta] of VARIANTES) {
    if (texto.includes(` ${frase} `) && !pedidas.has(etiqueta)) vistas.add(etiqueta);
  }
  // "Extra añejo" ya incluye "añejo".
  if (vistas.has('Extra añejo')) vistas.delete('Añejo');
  if (vistas.has('Gran reserva')) vistas.delete('Reserva');
  if (vistas.has('Tapa azul')) vistas.delete('Azul');
  if (vistas.has('Tapa verde')) vistas.delete('Verde');
  return [...vistas];
}

// Qué tan bien coincide un producto con la búsqueda (mayor = mejor). Resta por
// cada palabra que falta y por cada variante que no se pidió.
export function puntuar(producto, palabras) {
  const texto = textoDe(producto);
  const lista = tokens(texto);
  const validas = palabras.filter((p) => !PRESENTACIONES.has(p));
  if (!validas.length) return 0;
  let puntos = 0;
  for (const p of validas) {
    const n = puntajePalabra(p, texto, lista);
    puntos += n || -1;
  }
  return puntos - 2 * variantesNoPedidas(producto, palabras).length;
}

// Artículos que no son bebida aunque lleven la marca ("Destapador Cerveza Águila").
const NO_BEBIDA = new Set(['destapador', 'destapadores', 'abridor', 'camiseta', 'gorra', 'llavero', 'nevera', 'hielera', 'cava', 'decoracion', 'adorno', 'iman', 'mesa', 'silla', 'cojin', 'vela', 'termo', 'mug', 'pocillo', 'copa', 'copas']);

export function esBebida(producto, palabras = []) {
  const pedidas = new Set(palabras);
  return !tokens(producto.nombre).some((t) => NO_BEBIDA.has(t) && !pedidas.has(t));
}

// Filtra y ordena por relevancia: quedan los productos con todas las palabras
// obligatorias; las de categoría solo suman puntos.
export function filtrarProductos(productos, palabras) {
  if (!obligatorias(palabras).length) return [];
  return productos
    .filter((p) => Number.isFinite(p.precio) && p.precio > 0 && coincideBusqueda(p, palabras) && esBebida(p, palabras))
    .map((p) => ({ producto: p, puntos: puntuar(p, palabras) }))
    .sort((a, b) => b.puntos - a.puntos || a.producto.precio - b.producto.precio)
    .map((x) => x.producto);
}

// Marca, en todas las tiendas a la vez, los productos que son otra variante
// (zero, sin azúcar, con sabor…) cuando hay opciones que no lo son. Así
// «coca cola» no mezcla la Zero, pero «johnnie walker» sigue mostrando todas
// las etiquetas (todas tienen color y ninguna es «la normal»).
export function marcarVariantes(resultados, palabras) {
  const todos = resultados.flatMap((r) => r.productos);
  for (const p of todos) {
    const v = variantesNoPedidas(p, palabras);
    if (v.length) p.variante = v.join(' · ');
    else delete p.variante;
  }
  const hayNormal = todos.some((p) => !p.variante);
  for (const p of todos) {
    if (p.variante && hayNormal) p.otraVariante = true;
    else delete p.otraVariante;
  }
  return resultados;
}

// Grados de alcohol que dice el nombre: "29°", "40 % vol", "24 grados".
export function extraerGrados(texto = '') {
  const m = String(texto).match(/(\d{1,2}(?:[.,]\d)?)\s*(?:°|º|grados?\b|%\s*(?:vol|alc)?\.?)/i);
  if (!m) return null;
  const g = parseFloat(m[1].replace(',', '.'));
  return g >= 2 && g <= 80 ? g : null;
}

// Firma para reconocer el mismo producto en tiendas que no publican el código
// de barras: palabras propias del nombre (sin categoría, presentación ni
// números) + tamaño + unidades + grados.
const RELLENO = new Set(['tapa', 'roja', 'botella', 'unidad', 'und', 'x', 'pet', 'vidrio', 'ml', 'cc', 'lt', 'l', 'litro', 'tradicional', 'original', 'garrafa', 'media']);
export function firmaProducto(p) {
  if (!p.ml) return null;
  const propias = [...new Set(tokens(p.nombre))]
    .filter((t) => !/\d/.test(t) && t.length > 1 && !GENERICAS.has(t) && !PRESENTACIONES.has(t) && !RELLENO.has(t) && !PALABRAS_VACIAS.has(t))
    .sort();
  if (!propias.length) return null;
  return `${propias.join(' ')}|${p.ml}|${p.unidades || 1}|${p.grados ?? ''}`;
}

// «¿Quisiste decir…?»: las palabras de la búsqueda que no aparecen en ningún
// producto se cambian por la más parecida entre los nombres que devolvieron las
// tiendas (sus buscadores toleran errores de escritura). null si no hay nada que corregir.
export function sugerirConsulta(consulta, productos) {
  const vocabulario = new Map();
  for (const p of productos) for (const t of tokens(p.nombre)) if (t.length >= 3 && !/\d/.test(t)) vocabulario.set(t, (vocabulario.get(t) || 0) + 1);
  if (!vocabulario.size) return null;
  const lista = [...vocabulario.keys()];
  let cambio = false;
  const partes = String(consulta).trim().split(/\s+/).map((original) => {
    const p = tokens(original)[0];
    if (!p || p.length < 4 || esNumero(p) || PRESENTACIONES.has(p)) return original;
    if (lista.some((t) => parecida(p, t) >= 2)) return original;
    let mejor = null;
    for (const t of lista) {
      const d = distancia(p, t, 2);
      if (d <= (p.length >= 7 ? 2 : 1) && (!mejor || d < mejor.d || (d === mejor.d && vocabulario.get(t) > vocabulario.get(mejor.t)))) mejor = { t, d };
    }
    if (!mejor) return original;
    cambio = true;
    return mejor.t;
  });
  return cambio ? partes.join(' ') : null;
}

// Versión pequeña de la foto para la lista (menos datos en el teléfono). VTEX
// (Éxito, Olímpica, Carulla, Jumbo) acepta el tamaño en la ruta y Shopify
// (Dislicores) el ancho como parámetro.
export function miniatura(url, lado = 240) {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (/vteximg\.com\.br|vtexassets\.com/.test(u.hostname)) {
      u.pathname = u.pathname.replace(/\/arquivos\/ids\/(\d+)(?:-\d+-\d+)?\//, `/arquivos/ids/$1-${lado}-${lado}/`);
      return u.href;
    }
    if (u.hostname === 'cdn.shopify.com' || u.pathname.includes('/cdn/shop/')) {
      u.searchParams.set('width', String(lado));
      return u.href;
    }
    return u.href;
  } catch {
    return null;
  }
}

// Código de barras EAN/UPC (8 a 14 dígitos) o null. Algunas tiendas lo dan en
// una lista; se toma el primero válido.
export function codigoBarras(valor) {
  const lista = Array.isArray(valor) ? valor : [valor];
  return lista.map((c) => String(c ?? '').trim()).find((c) => /^\d{8,14}$/.test(c)) ?? null;
}

export function urlSegura(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}
