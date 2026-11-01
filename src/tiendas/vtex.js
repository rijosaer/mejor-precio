// Tiendas sobre VTEX (Carulla, Jumbo…): la misma búsqueda pública que usan
// Éxito y Olímpica. Cada tienda solo cambia su dominio y su nombre.
import { pedir } from '../http.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre, urlSegura } from '../normalizar.js';

function mejorVendedor(item) {
  const vendedores = (item.sellers ?? []).filter((s) => s.commertialOffer?.Price > 0);
  return (
    vendedores.find((s) => s.sellerDefault && s.commertialOffer.AvailableQuantity > 0) ||
    vendedores.find((s) => s.commertialOffer.AvailableQuantity > 0) ||
    vendedores[0]
  );
}

function nombreDe(p, item, variantes) {
  const base = repararNombre(p.productName ?? '');
  const propio = repararNombre(item.name ?? '');
  if (propio && !extraerMl(base) && extraerMl(propio)) return propio;
  if (variantes > 1 && propio && !base.toLowerCase().includes(propio.toLowerCase())) {
    return `${base} ${propio}`.replace(/\s+/g, ' ').trim();
  }
  return base;
}

// Convierte la respuesta de intelligent-search en productos.
export function leerVtex(datos, web) {
  const productos = [];
  for (const p of datos?.products ?? []) {
    const variantes = p.items ?? [];
    const enlace = p.link?.startsWith('http') ? p.link : `${web}${p.link ?? ''}`;
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

export function tiendaVtex({ id, nombre, web, alcance = 'Precio nacional en línea', porDefecto = false }) {
  return {
    tienda: { id, nombre, web, alcance, porDefecto },
    async buscar(consulta) {
      const url = `${web}/api/io/_v/api/intelligent-search/product_search?query=${encodeURIComponent(consulta)}&count=40&locale=es-CO`;
      return leerVtex(await pedir(url, { tambienOk: [406] }), web);
    },
  };
}
