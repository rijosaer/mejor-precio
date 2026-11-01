// Dislicores (Shopify): la búsqueda predictiva da hasta 10 productos y la ficha
// de cada uno (/products/<handle>.js) trae el tamaño ("Cantidad: 375 ml").
import { pedir } from '../http.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

export const tienda = { id: 'dislicores', nombre: 'Dislicores', web: 'https://dislicores.com', alcance: 'Precio en línea' };

const BASE = 'https://dislicores.com';

function imagen(src) {
  if (!src) return null;
  return urlSegura(src.startsWith('//') ? `https:${src}` : src);
}

export async function buscar(consulta) {
  const url =
    `${BASE}/search/suggest.json?q=${encodeURIComponent(consulta)}` +
    '&resources%5Btype%5D=product&resources%5Blimit%5D=10';
  const sugeridos = (await pedir(url)).resources?.results?.products ?? [];

  const fichas = await Promise.all(
    sugeridos.map((s) => pedir(`${BASE}/products/${s.handle}.js`).catch(() => null)),
  );

  const productos = [];
  sugeridos.forEach((s, i) => {
    const ficha = fichas[i];
    if (!ficha) {
      // Sin ficha: se usa lo que trae la búsqueda (sin tamaño seguro).
      const nombre = repararNombre(s.title);
      productos.push({
        nombre,
        precio: Number(s.price),
        precioAntes: Number(s.compare_at_price_max) > Number(s.price) ? Number(s.compare_at_price_max) : null,
        ml: extraerMl(`${nombre} ${s.image ?? ''}`),
        unidades: extraerUnidades(nombre),
        disponible: Boolean(s.available),
        stock: null,
        ean: null,
        url: urlSegura(`${BASE}/products/${s.handle}`),
        imagen: imagen(s.image),
      });
      return;
    }
    for (const v of ficha.variants ?? []) {
      const varianteUtil = v.title && v.title !== 'Default Title';
      const nombre = repararNombre(varianteUtil ? `${ficha.title} ${v.title}` : ficha.title);
      const precio = v.price / 100;
      const antes = v.compare_at_price ? v.compare_at_price / 100 : null;
      productos.push({
        nombre,
        precio,
        precioAntes: antes && antes > precio ? antes : null,
        ml: extraerMl(nombre) ?? extraerMl(ficha.featured_image ?? ''),
        unidades: extraerUnidades(nombre),
        disponible: Boolean(v.available),
        stock: null,
        ean: codigoBarras(v.barcode),
        url: urlSegura(`${BASE}/products/${ficha.handle}?variant=${v.id}`),
        imagen: imagen(v.featured_image?.src ?? ficha.featured_image),
      });
    }
  });
  return productos;
}
