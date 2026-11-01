// Dónde guarda el servidor la lista y el monitoreo: Netlify Blobs cuando corre
// como función de Netlify; archivos JSON en la carpeta datos/ con server.js.
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CARPETA = process.env.DATOS_DIR || fileURLToPath(new URL('../datos/', import.meta.url));
let blobs = null;

export async function usarBlobs() {
  if (blobs) return;
  const { getStore } = await import('@netlify/blobs');
  blobs = getStore({ name: 'mejor-precio', consistency: 'strong' });
}

export const enBlobs = () => Boolean(blobs);

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
  const temporal = `${archivo(clave)}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temporal, JSON.stringify(valor));
  await rename(temporal, archivo(clave));
}

export async function borrar(clave) {
  if (blobs) return blobs.delete(clave);
  await unlink(archivo(clave)).catch(() => {});
}

// Leer, cambiar y escribir una clave sin que otra operación del mismo proceso
// se cuele en medio (el servidor local corre la API y el monitoreo juntos).
// `cambiar` recibe el valor actual (o null) y devuelve el nuevo; si devuelve
// undefined no se escribe nada. Entre instancias distintas de Netlify cada
// clave la escribe casi siempre una sola: por eso el monitoreo guarda una clave
// por producto en vez de un documento compartido.
const colas = new Map();

export function actualizar(clave, cambiar) {
  const anterior = colas.get(clave) || Promise.resolve();
  const turno = anterior.then(async () => {
    const actual = await leer(clave);
    const nuevo = await cambiar(actual);
    if (nuevo !== undefined) await escribir(clave, nuevo);
    return nuevo === undefined ? actual : nuevo;
  });
  const cola = turno.catch(() => {});
  colas.set(clave, cola);
  cola.then(() => {
    if (colas.get(clave) === cola) colas.delete(clave);
  });
  return turno;
}
