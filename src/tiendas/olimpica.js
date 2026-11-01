// Olímpica (VTEX): búsqueda pública. Devuelve el precio nacional de olimpica.com;
// la disponibilidad por ciudad se decide al pagar, no en la búsqueda.
import { pedir } from '../http.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

export const tienda = {
  id: 'olimpica',
  nombre: 'Olímpica',
  web: 'https://www.olimpica.com',
  alcance: 'Precio nacional en línea',
};

function mejorVendedor(item) {
  const vendedores = (item.sellers ?? []).filter((s) => s.commertialOffer?.Price > 0);
  return (
    vendedores.find((s) => s.sellerDefault && s.commertialOffer.AvailableQuantity > 0) ||
    vendedores.find((s) => s.commertialOffer.AvailableQuantity > 0) ||
    vendedores[0]
  );
}

// VTEX repite el mismo productName en todas las variantes; el tamaño suele estar
// en el item. Se prefiere el nombre que trae el ml y, si hay varios SKUs, se
// agrega el del item para no duplicar filas idénticas.
function nombreDe(p, item, variantes) {
  const base = repararNombre(p.productName ?? '');
  const propio = repararNombre(item.name ?? '');
  if (propio && !extraerMl(base) && extraerMl(propio)) return propio;
  if (variantes > 1 && propio && !base.toLowerCase().includes(propio.toLowerCase())) {
    return `${base} ${propio}`.replace(/\s+/g, ' ').trim();
  }
  return base;
}

export async function buscar(consulta) {
  const url =
    'https://www.olimpica.com/api/io/_v/api/intelligent-search/product_search' +
    `?query=${encodeURIComponent(consulta)}&count=40&locale=es-CO`;
  const datos = await pedir(url);
  const productos = [];
  for (const p of datos.products ?? []) {
    const variantes = p.items ?? [];
    const enlace = p.link?.startsWith('http') ? p.link : `https://www.olimpica.com${p.link ?? ''}`;
    for (const item of variantes) {
      const vendedor = mejorVendedor(item);
      if (!vendedor) continue;
      const oferta = vendedor.commertialOffer;
      const nombre = nombreDe(p, item, variantes.length);
      productos.push({
        nombre,
        precio: oferta.Price,
        precioAntes: oferta.ListPrice > oferta.Price ? oferta.ListPrice : null,
        ml: extraerMl(nombre),
        unidades: extraerUnidades(nombre),
        disponible: oferta.AvailableQuantity > 0,
        // VTEX responde 10000 cuando no publica el inventario real.
        stock: oferta.AvailableQuantity < 1000 ? oferta.AvailableQuantity : null,
        ean: codigoBarras(item.ean),
        url: urlSegura(enlace),
        imagen: urlSegura(item.images?.[0]?.imageUrl),
      });
    }
  }
  return productos;
}
