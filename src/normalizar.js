// Utilidades para limpiar nombres, leer presentaciones (ml y unidades) y
// decidir si un producto corresponde a lo que se buscó.

const PALABRAS_VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'con', 'en', 'x', 'por']);

// Minúsculas, sin tildes (ñ → n) y con el número pegado a su unidad ("750 ml" → "750ml").
export function normalizar(texto = '') {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/(\d)\s+(ml|cc|lts?|litros?|l)(?![a-z])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
}

// Algunas tiendas entregan nombres con caracteres dañados (ANTIOQUE�O, 24�).
export function repararNombre(texto = '') {
  return String(texto)
    .replace(/(?<=[A-Z])�(?=[A-Z])/g, 'Ñ')
    .replace(/(?<=[a-z])�(?=[a-z])/g, 'ñ')
    .replace(/(?<=\d)�/g, '°')
    .replace(/�/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#8211;/g, '–')
    .replace(/&#8217;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
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

// Unidades por empaque: six pack, "x6", "6 latas", "caja x 24"…
export function extraerUnidades(texto = '') {
  const t = normalizar(texto);
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

export function coincide(producto, palabras) {
  const texto = normalizar(`${producto.nombre} ${producto.ml ? producto.ml + 'ml' : ''}`);
  return palabras.every((p) => {
    // Los números van completos: "750" no debe encontrar "1750ml".
    if (/^\d/.test(p)) return new RegExp(`(?<![\\d.,])${p.replace('.', '\\.')}(?![\\d])`).test(texto);
    if (texto.includes(p)) return true;
    // Plural simple: "cervezas" también encuentra "cerveza".
    return p.length > 4 && p.endsWith('s') && texto.includes(p.slice(0, -1));
  });
}

// ── Búsqueda asertiva ─────────────────────────────────────────────────────
// Algunas tiendas escriben las marcas distinto; esto acerca "aguardiente
// antioqueño" a "antioqueño real", "cristal" a "cristalino", etc.

const SINONIMOS = [
  ['aguardiente', 'aguard'],
  ['antioqueno', 'antioquena', 'real'],
  ['cristalino', 'cristal'],
  ['tequila', 'teq'],
  ['whisky', 'wiskey', 'wisky', 'whiskey'],
  ['ron', 'ronno', 'santafe'],
  ['vodka', 'vodca'],
  ['cerveza', 'cervezas', 'lata'],
  ['aguardiente antioqueno', 'aguardiente real'],
];

const PRESENTACIONES = new Set([
  'ml', 'cc', 'lt', 'lts', 'litro', 'litros', 'l',
  'unid', 'unids', 'unidad', 'unidades', 'u', 'uds', 'und',
  'pack', 'sixpack', 'caja', 'display', 'botella', 'botellas',
  'lata', 'latas', 'garrafa', 'botellin', 'botellines',
]);

// Palabras de una consulta que describen presentación, no producto.
export function palabrasPresentacion(consulta) {
  return normalizar(consulta)
    .split(/[^a-z0-9.]+/)
    .filter((p) => PRESENTACIONES.has(p));
}

// Cuenta cuántas palabras de la búsqueda aparecen en el producto
// (directo, plural o sinónimo). Ignora las de presentación.
function contarCoincidencias(producto, palabras) {
  const texto = normalizar(`${producto.nombre} ${producto.ml ? producto.ml + 'ml' : ''}`);
  const validas = palabras.filter((p) => !PRESENTACIONES.has(p));
  let n = 0;
  for (const p of validas) {
    if (/^\d/.test(p)) {
      if (new RegExp(`(?<![\\d.,])${p.replace('.', '\\.')}(?![\\d])`).test(texto)) n++;
    } else if (texto.includes(p)) {
      n++;
    } else if (p.length > 4 && p.endsWith('s') && texto.includes(p.slice(0, -1))) {
      n++;
    } else {
      const sin = SINONIMOS.find(([a, ...resto]) => a === p || resto.includes(p));
      if (sin && sin.some((s) => texto.includes(s))) n++;
    }
  }
  return { n, total: validas.length };
}

// Qué tan bien coincide un producto con la búsqueda (mayor = mejor).
export function puntuar(producto, palabras) {
  const texto = normalizar(`${producto.nombre} ${producto.ml ? producto.ml + 'ml' : ''}`);
  const palabrasValidas = palabras.filter((p) => !PRESENTACIONES.has(p));
  if (!palabrasValidas.length) return 0;

  let puntos = 0;
  for (const p of palabrasValidas) {
    if (/^\d/.test(p)) {
      if (new RegExp(`(?<![\\d.,])${p.replace('.', '\\.')}(?![\\d])`).test(texto)) puntos += 3;
    } else if (texto.includes(p)) {
      puntos += 3;
    } else if (p.length > 4 && p.endsWith('s') && texto.includes(p.slice(0, -1))) {
      puntos += 2;
    } else {
      const sin = SINONIMOS.find(([a, ...resto]) => a === p || resto.includes(p));
      if (sin && sin.some((s) => texto.includes(s))) puntos += 2;
      else puntos -= 1;
    }
  }
  return puntos;
}

// Filtra y ordena por relevancia. Más asertivo que `coincide`: admite
// productos que falten como máximo una palabra y los ordena por puntuación.
export function filtrarProductos(productos, palabras) {
  const validas = palabras.filter((p) => !PRESENTACIONES.has(p));
  if (!validas.length) return [];
  const umbral = Math.max(1, validas.length - 1); // puede faltar una palabra
  return productos
    .filter((p) => Number.isFinite(p.precio) && p.precio > 0)
    .map((p) => ({ producto: p, puntos: puntuar(p, palabras), ...contarCoincidencias(p, palabras) }))
    .filter((x) => x.n >= umbral)
    .sort((a, b) => b.puntos - a.puntos || a.producto.precio - b.producto.precio)
    .map((x) => x.producto);
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
