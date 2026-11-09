// Función de Netlify: la página principal (tienda pública), la página de cada
// producto, robots.txt y el mapa del sitio para Google. La CDN la guarda unos minutos (src/tienda.js).
import { responderTienda } from '../../src/tienda.js';
import { usarBlobs } from '../../src/almacen.js';

export default async (request) => {
  await usarBlobs();
  return responderTienda(request);
};

export const config = { path: ['/', '/producto/*', '/robots.txt', '/sitemap.xml'] };
