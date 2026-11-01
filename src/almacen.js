// Dónde guarda el servidor la lista y el monitoreo: Netlify Blobs cuando corre
// como función de Netlify; archivos JSON en la carpeta datos/ con server.js.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARPETA = process.env.DATOS_DIR || fileURLToPath(new URL('../datos/', import.meta.url));
let blobs = null;

export async function usarBlobs() {
  if (blobs) return;
  const { getStore } = await import('@netlify/blobs');
  blobs = getStore({ name: 'mejor-precio', consistency: 'strong' });
}

const archivo = (clave) => join(CARPETA, `${encodeURIComponent(clave)}.json`);

export async function leer(clave) {
  if (blobs) return (await blobs.get(clave, { type: 'json' })) ?? null;
  try {
    return JSON.parse(await readFile(archivo(clave), 'utf8'));
  } catch {
    return null;
  }
}

export async function escribir(clave, valor) {
  if (blobs) return blobs.setJSON(clave, valor);
  await mkdir(CARPETA, { recursive: true });
  // Se escribe aparte y se renombra para no dejar un archivo a medias.
  const temporal = `${archivo(clave)}.tmp`;
  await writeFile(temporal, JSON.stringify(valor));
  await rename(temporal, archivo(clave));
}

export async function borrar(clave) {
  if (blobs) return blobs.delete(clave);
  await writeFile(archivo(clave), 'null').catch(() => {});
}
