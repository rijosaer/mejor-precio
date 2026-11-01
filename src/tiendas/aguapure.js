// Agua Pure (carta digital de TRIVO POS): la carta pública trae todos los
// productos en un solo JSON; no tiene buscador, así que aquí se hace el papel de
// uno: quedan los productos con todas las palabras en su nombre o su sección
// ("Cervezas"), y después el comparador filtra como en las demás tiendas.
import { pedir } from '../http.js';
import { coincideBusqueda, extraerMl, extraerUnidades, palabrasClave, repararNombre, urlSegura } from '../normalizar.js';

const BASE = 'https://trivo-pos.com';
const SLUG = 'agua-pure';

export const tienda = { id: 'aguapure', nombre: 'Agua Pure', web: `${BASE}/m/${SLUG}`, alcance: 'Domicilio en Valledupar' };

// "Caja de Aguila Original x 330ml + Hielo": la carta no dice cuántas latas
// trae; por el precio (paquete x 24 + hielo) es una caja de 24.
const LATAS_POR_CAJA = 24;

// Lo que va antes de la presentación: "Aguila Original x 24 unidades" → "aguila original".
const base = (nombre) => nombre.split(/\s+x\s+/i)[0].replace(/^caja de\s+/i, '').trim().toLowerCase();

export async function buscar(consulta) {
  const datos = (await pedir(`${BASE}/api/public/menu/${SLUG}/`)).data;
  const productos = (datos?.sections ?? []).flatMap((s) => (s.products ?? []).map((p) => ({ ...p, seccion: s.name })));

  // Los paquetes ("x 24 unidades (lata)") no dicen el tamaño de la lata: se
  // toma de la lata suelta con el mismo nombre.
  const mlPorBase = new Map();
  for (const p of productos) {
    const ml = extraerMl(p.name);
    if (ml && !mlPorBase.has(base(p.name))) mlPorBase.set(base(p.name), ml);
  }

  const palabras = palabrasClave(consulta);
  const buscados = productos.filter((p) => coincideBusqueda({ nombre: `${p.seccion} ${p.name}` }, palabras));

  return buscados.flatMap((p) => {
    const variantes = p.variants?.length ? p.variants : [null];
    return variantes.map((v) => {
      const nombre = repararNombre(v ? `${p.name} ${v.name}` : p.name);
      const lista = Number(v ? v.price : p.price);
      // La promoción se descuenta del precio del producto, no de la variante.
      const promo = !v && p.active_promo ? Number(p.active_promo.promo_price) : null;
      const precio = promo && promo < lista ? promo : lista;
      const esCaja = /^caja de\s/i.test(p.name) && !/\bx\s*\d{1,2}\b(?!\s*ml)/i.test(p.name);
      return {
        nombre,
        precio,
        precioAntes: precio < lista ? lista : null,
        ml: extraerMl(p.name) ?? mlPorBase.get(base(p.name)) ?? null,
        unidades: esCaja ? LATAS_POR_CAJA : extraerUnidades(p.name),
        disponible: Boolean(p.is_available),
        stock: Number.isFinite(p.stock_left) ? p.stock_left : null,
        ean: null,
        // No hay página por producto; el ancla separa su historial.
        url: urlSegura(`${BASE}/m/${SLUG}#producto-${p.id}${v ? `-${v.id}` : ''}`),
        imagen: p.image_url ? urlSegura(`${BASE}${p.image_url}`) : null,
      };
    });
  });
}
