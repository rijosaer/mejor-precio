// Servidor local (o en Railway): la tienda pública en «/» (src/tienda.js), el
// panel en /panel, el resto de public/ y /api/* a src/api.js. En Netlify no se
// usa: allí public/ es sitio estático y la tienda y la API son funciones.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { manejarApi } from './src/api.js';
import { revisar } from './src/monitor.js';
import { responderTienda } from './src/tienda.js';

const PUERTO = Number(process.env.PORT) || 3000;
const CARPETA_PUBLICA = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

if (!process.env.APP_PASSWORD) {
  console.error('Falta la variable APP_PASSWORD (la contraseña para entrar a la app).');
  process.exit(1);
}
if (!process.env.SESSION_SECRET) {
  console.warn('Sin SESSION_SECRET: las sesiones se cierran cada vez que se reinicia el servidor.');
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SEGURIDAD = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'content-security-policy':
    "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'",
};

// La última IP de x-forwarded-for la pone el proxy del hosting; las anteriores
// las puede inventar el cliente.
function ipDe(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',').pop().trim();
}

async function leerCuerpo(req) {
  const partes = [];
  let total = 0;
  for await (const parte of req) {
    total += parte.length;
    if (total > 500_000) throw new Error('Cuerpo demasiado grande');
    partes.push(parte);
  }
  return Buffer.concat(partes);
}

async function responder(res, respuesta) {
  const encabezados = Object.fromEntries(respuesta.headers);
  const cookies = respuesta.headers.getSetCookie();
  if (cookies.length) encabezados['set-cookie'] = cookies;
  res.writeHead(respuesta.status, { ...SEGURIDAD, ...encabezados });
  res.end(Buffer.from(await respuesta.arrayBuffer()));
}

async function pasarApi(req, res) {
  const sinCuerpo = req.method === 'GET' || req.method === 'HEAD';
  const request = new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`), {
    method: req.method,
    headers: Object.entries(req.headers).filter(([, v]) => typeof v === 'string'),
    body: sinCuerpo ? undefined : await leerCuerpo(req),
  });
  await responder(res, await manejarApi(request, { ip: ipDe(req), https: req.headers['x-forwarded-proto'] === 'https' }));
}

async function servirArchivo(res, ruta) {
  const relativa = ruta === '/panel' ? 'panel.html' : decodeURIComponent(ruta).replace(/^\/+/, '');
  const completa = normalize(join(CARPETA_PUBLICA, relativa));
  const noEncontrado = () => {
    res.writeHead(404, { ...SEGURIDAD, 'content-type': 'text/plain; charset=utf-8' });
    res.end('No encontrado');
  };
  if (!completa.startsWith(CARPETA_PUBLICA + sep)) return noEncontrado();
  try {
    const contenido = await readFile(completa);
    const ext = extname(completa);
    // El HTML y el service worker se revisan siempre; lo demás se guarda un día.
    const cache = ext === '.html' || relativa === 'sw.js' ? 'no-cache' : 'public, max-age=86400';
    res.writeHead(200, { ...SEGURIDAD, 'content-type': TIPOS[ext] || 'application/octet-stream', 'cache-control': cache });
    res.end(contenido);
  } catch {
    noEncontrado();
  }
}

const servidor = createServer(async (req, res) => {
  try {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname.startsWith('/api/')) return await pasarApi(req, res);
    if (req.method === 'GET' && (['/', '/productos', '/productos/', '/terminos', '/privacidad', '/marca.css', '/marca.svg', '/robots.txt', '/sitemap.xml'].includes(pathname) || pathname.startsWith('/producto/') || pathname.startsWith('/categoria/'))) {
      return await responder(res, await responderTienda(new Request(new URL(req.url, `http://${req.headers.host || 'localhost'}`))));
    }
    if (req.method === 'GET') return await servirArchivo(res, pathname);
    res.writeHead(405, SEGURIDAD);
    res.end();
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, SEGURIDAD);
    res.end();
  }
});

servidor.listen(PUERTO, () => console.log(`Mejor Precio: tienda en http://localhost:${PUERTO}/ y panel en http://localhost:${PUERTO}/panel`));

// Igual que la función programada de Netlify: cada hora revisa "Mi lista".
const revisarLista = () =>
  revisar({ maximo: 6 })
    .then((r) => r.revisados.length && console.log('[monitor]', JSON.stringify(r)))
    .catch((error) => console.error('[monitor]', error.message));
setInterval(revisarLista, 60 * 60_000).unref();
setTimeout(revisarLista, 30_000).unref();
