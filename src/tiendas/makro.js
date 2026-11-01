// Makro (Instaleap + Next.js): la página de búsqueda trae los productos dentro
// del HTML. La tienda se elige con cookies; 194 / 22Val = Makro Valledupar.
import { pedir } from '../http.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

export const tienda = { id: 'makro', nombre: 'Makro', web: 'https://tienda.makro.com.co', alcance: 'Tienda Valledupar' };

const TIENDA_ID = process.env.MAKRO_STORE_ID || '194';
const TIENDA_REF = process.env.MAKRO_STORE_REF || '22Val';

const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const formatoPesos = (n) => pesos.format(n);

const RE_FRAGMENTO = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;

// Une los fragmentos del HTML en un texto con una entrada "id:valor" por línea.
function leerCarga(html) {
  let texto = '';
  for (const m of html.matchAll(RE_FRAGMENTO)) texto += JSON.parse(m[1]);
  const entradas = new Map();
  for (const linea of texto.split('\n')) {
    const i = linea.indexOf(':');
    if (i > 0 && /^[0-9a-f]+$/.test(linea.slice(0, i))) entradas.set(linea.slice(0, i), linea.slice(i + 1));
  }
  // Una entrada que va justo después de un bloque de texto (la descripción en
  // HTML) no empieza en una línea nueva: "…</p>11a:["7702049002245"]".
  for (const m of texto.matchAll(/(?<![0-9a-zA-Z])([0-9a-f]+):([[{][^\n]*)/g)) {
    if (!entradas.has(m[1])) entradas.set(m[1], m[2]);
  }
  return entradas;
}

function resolver(entradas, valor) {
  if (typeof valor === 'string' && /^\$[0-9a-f]+$/.test(valor)) {
    try {
      return JSON.parse(entradas.get(valor.slice(1)));
    } catch {
      return null;
    }
  }
  return valor;
}

// subQty es el contenido TOTAL del empaque (6 × 330 = 1980); se prefiere el
// tamaño por unidad que dice el nombre y, si no está, se divide el total.
function mlDe(p, nombre, unidades) {
  const delNombre = extraerMl(nombre);
  if (delNombre) return delNombre;
  const sub = String(p.subUnit || '').toUpperCase();
  if (!p.subQty) return null;
  const total = sub === 'ML' || sub === 'CC' ? p.subQty : sub === 'L' || sub === 'LT' ? p.subQty * 1000 : null;
  return total ? Math.round(total / unidades) : null;
}

export async function buscar(consulta) {
  const html = await pedir(`https://tienda.makro.com.co/search?name=${encodeURIComponent(consulta)}`, {
    como: 'texto',
    encabezados: { cookie: `_IL-storeId=${TIENDA_ID}; _IL-storeReference=${TIENDA_REF}` },
  });
  const entradas = leerCarga(html);
  if (!entradas.size) throw new Error('La página de Makro cambió de formato');

  const vistos = new Set();
  const productos = [];
  for (const crudo of entradas.values()) {
    if (!crudo.startsWith('{') || !crudo.includes('"sku"') || !crudo.includes('"subQty"')) continue;
    let p;
    try {
      p = JSON.parse(crudo);
    } catch {
      continue;
    }
    if (typeof p.price !== 'number' || !p.name || vistos.has(p.sku)) continue;
    vistos.add(p.sku);
    const nombre = repararNombre(p.name);
    // Oferta: { type: "specialPrice", conditions: [{ quantity, price }] }. Si exige
    // llevar varias unidades, el precio normal se mantiene y la oferta va como nota.
    const promo = resolver(entradas, p.promotion);
    const condicion = promo?.isActive ? resolver(entradas, resolver(entradas, promo.conditions)?.[0]) : null;
    let precio = p.price;
    let nota = null;
    if (condicion?.price > 0 && condicion.price < p.price) {
      if ((condicion.quantity ?? 1) <= 1) precio = condicion.price;
      else nota = `Oferta: ${formatoPesos(condicion.price)} c/u llevando ${condicion.quantity}`;
    }
    const fotos = resolver(entradas, p.photosUrl);
    const unidades = extraerUnidades(nombre);
    productos.push({
      nombre,
      precio,
      precioAntes: precio < p.price ? p.price : null,
      ml: mlDe(p, nombre, unidades),
      unidades,
      disponible: Boolean(p.isAvailable && p.stock > 0),
      stock: Number.isFinite(p.stock) ? Math.max(0, p.stock) : null,
      ean: codigoBarras(resolver(entradas, p.ean)),
      nota,
      url: urlSegura(`https://tienda.makro.com.co/p/${p.slug}`),
      imagen: urlSegura(Array.isArray(fotos) ? fotos[0] : null),
    });
  }
  return productos;
}
