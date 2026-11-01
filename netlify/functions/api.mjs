// Función de Netlify: atiende todo /api/* con la misma lógica del servidor local.
import { manejarApi } from '../../src/api.js';
import { usarBlobs } from '../../src/almacen.js';

export default async (request, context) => {
  await usarBlobs();
  return manejarApi(request, { ip: context.ip, https: true });
};

export const config = { path: '/api/*' };
