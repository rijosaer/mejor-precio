// Bevgo (WooCommerce): API pública de la tienda.
import { pedir } from '../http.js';
import { extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

export const tienda = { id: 'bevgo', nombre: 'Bevgo', web: 'https://bevgo.com.co', alcance: 'Precio en línea' };

export async function buscar(consulta) {
  const url = `https://bevgo.com.co/wp-json/wc/store/v1/products?search=${encodeURIComponent(consulta)}&per_page=40`;
  const datos = await pedir(url);
  return datos.map((p) => {
    const nombre = repararNombre(p.name);
    const divisor = 10 ** (p.prices?.currency_minor_unit ?? 0);
    const precio = Number(p.prices?.price) / divisor;
    const antes = Number(p.prices?.regular_price) / divisor;
    return {
      nombre,
      precio,
      precioAntes: antes > precio ? antes : null,
      ml: extraerMl(nombre),
      unidades: extraerUnidades(nombre),
      disponible: Boolean(p.is_in_stock && p.is_purchasable),
      // Solo lo dice cuando quedan pocas unidades.
      stock: Number.isFinite(p.low_stock_remaining) ? p.low_stock_remaining : null,
      ean: null,
      url: urlSegura(p.permalink),
      imagen: urlSegura(p.images?.[0]?.thumbnail),
    };
  });
}
