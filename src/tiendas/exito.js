// Éxito (VTEX): búsqueda pública. Devuelve el precio nacional de exito.com;
// la consulta por región de Valledupar no muestra licores, por eso no se usa.
import { pedir } from '../http.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

export const tienda = { id: 'exito', nombre: 'Éxito', web: 'https://www.exito.com', alcance: 'Precio nacional en línea' };

function mejorVendedor(item) {
  const vendedores = (item.sellers ?? []).filter((s) => s.commertialOffer?.Price > 0);
  // Primero Éxito (vendedor "1"), luego el vendedor por defecto con existencias.
  return (
    vendedores.find((s) => s.sellerId === '1' && s.commertialOffer.AvailableQuantity > 0) ||
    vendedores.find((s) => s.sellerDefault && s.commertialOffer.AvailableQuantity > 0) ||
    vendedores.find((s) => s.commertialOffer.AvailableQuantity > 0) ||
    vendedores[0]
  );
}

export async function buscar(consulta) {
  const url =
    'https://www.exito.com/api/io/_v/api/intelligent-search/product_search' +
    `?query=${encodeURIComponent(consulta)}&count=40&locale=es-CO`;
  const datos = await pedir(url, { tambienOk: [406] });
  const productos = [];
  for (const p of datos.products ?? []) {
    const item = p.items?.[0];
    const vendedor = item && mejorVendedor(item);
    if (!vendedor) continue;
    const oferta = vendedor.commertialOffer;
    const nombre = repararNombre(p.productName);
    const link = p.link?.startsWith('http') ? p.link : `https://www.exito.com${p.link ?? ''}`;
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
      url: urlSegura(link),
      imagen: urlSegura(item.images?.[0]?.imageUrl),
    });
  }
  return productos;
}
