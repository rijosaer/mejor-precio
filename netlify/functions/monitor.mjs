// Función programada de Netlify: cada hora revisa los productos de "Mi lista"
// que llevan 6 horas o más sin revisarse (hasta 6 por vez: la función tiene 30 s).
import { usarBlobs } from '../../src/almacen.js';
import { revisar } from '../../src/monitor.js';

export default async () => {
  await usarBlobs();
  const resultado = await revisar({ maximo: 6 });
  console.log('[monitor]', JSON.stringify(resultado));
};

export const config = { schedule: '@hourly' };
