// Función de Netlify: la tienda pública (inicio, productos, categorías y la
// página de cada producto), los colores e ícono de la marca, robots.txt y el
// mapa del sitio para Google. La CDN la guarda unos minutos (src/tienda.js).
import { responderTienda } from '../../src/tienda.js';
import { usarBlobs } from '../../src/almacen.js';

export default async (request) => {
  await usarBlobs();
  return responderTienda(request);
};

export const config = { path: ['/', '/productos', '/productos/', '/producto/*', '/categoria/*', '/terminos', '/privacidad', '/marca.css', '/marca.svg', '/robots.txt', '/sitemap.xml'] };
