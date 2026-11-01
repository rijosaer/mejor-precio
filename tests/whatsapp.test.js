// WhatsApp del dueño: los mismos avisos que el push, desde el número de la empresa.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const carpeta = await mkdtemp(join(tmpdir(), 'mp-whatsapp-'));
process.env.DATOS_DIR = carpeta;
process.env.WHATSAPP_TOKEN = 'token-prueba';
process.env.WHATSAPP_PHONE_ID = '123456';
process.env.URL = 'https://mejor-precio.example';
delete process.env.WHATSAPP_DESTINO;
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;
test.after(() => rm(carpeta, { recursive: true, force: true }));

const enviados = [];
let ventanaAbierta = true;
globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.green-api.com/')) {
    enviados.push({ url: u, cuerpo: JSON.parse(opciones.body) });
    return new Response(JSON.stringify({ idMessage: 'BAE5' }));
  }
  if (!u.startsWith('https://graph.facebook.com/')) return new Response('no', { status: 404 });
  const cuerpo = JSON.parse(opciones.body);
  enviados.push({ url: u, auth: opciones.headers.authorization, cuerpo });
  if (cuerpo.type === 'text' && !ventanaAbierta) {
    return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed' } } }), { status: 400 });
  }
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }));
};

const { limpiarNumero, textoParaPlantilla, enviarWhatsapp, guardarWhatsapp, leerWhatsapp } = await import('../src/whatsapp.js');
const { notificarAvisos, mensajeWhatsapp } = await import('../src/push.js');
const { avisosDeAtencion } = await import('../src/mitienda.js');
const MEDIODIA = Date.parse('2026-11-02T17:00:00Z'); // 12:00 en Colombia, fuera del silencio

test('el número del dueño se guarda en formato internacional', async () => {
  assert.equal(limpiarNumero('300 466 0472'), '573004660472');
  assert.equal(limpiarNumero('+57 300-466-0472'), '573004660472');
  assert.equal(limpiarNumero('12'), null);
  await assert.rejects(guardarWhatsapp({ numero: 'abc' }), /indicativo/);
  const wa = await guardarWhatsapp({ numero: '3001234567' });
  assert.deepEqual([wa.numero, wa.activo, wa.servidor], ['573001234567', true, true]);
});

test('manda texto; fuera de la ventana de 24 h usa la plantilla', async () => {
  enviados.length = 0;
  ventanaAbierta = true;
  assert.deepEqual(await enviarWhatsapp('Hola\nmundo'), { enviado: true, via: 'texto' });
  assert.equal(enviados[0].url, 'https://graph.facebook.com/v21.0/123456/messages');
  assert.equal(enviados[0].auth, 'Bearer token-prueba');
  assert.deepEqual([enviados[0].cuerpo.to, enviados[0].cuerpo.text.body], ['573001234567', 'Hola\nmundo']);

  enviados.length = 0;
  ventanaAbierta = false;
  assert.deepEqual(await enviarWhatsapp('Hola\n\n• uno\n  dos'), { enviado: true, via: 'plantilla' });
  const plantilla = enviados[1].cuerpo.template;
  assert.equal(plantilla.name, 'aviso_mejor_precio');
  assert.equal(plantilla.components[0].parameters[0].text, 'Hola · • uno · dos', 'la variable no admite saltos de línea');
  assert.equal(textoParaPlantilla('a    b\tc'), 'a b c');
  ventanaAbierta = true;
});

test('apagado o sin número no se manda nada', async () => {
  enviados.length = 0;
  await guardarWhatsapp({ activo: false });
  assert.equal((await enviarWhatsapp('x')).motivo, 'apagado');
  assert.equal(enviados.length, 0);
  await guardarWhatsapp({ activo: true });
});

test('todos los avisos llegan en un solo mensaje con el enlace a la app', async () => {
  enviados.length = 0;
  const avisos = [
    { tipo: 'dulce', nombre: 'Aguila 330', tienda: 'Makro', precio: 2900, antes: 3300 },
    { tipo: 'precio-compra', title: 'Compra en TRIVO: 2 precios para aprobar', body: 'Aguila: $3.500 → $3.300', url: '/#mitienda' },
    { tipo: 'bajo-minimo', nombre: 'Hielo 3 kg', existencias: 4, minimo: 10 },
    { tipo: 'tienda', tienda: 'Éxito', detalle: 'Bloqueo' },
  ];
  const r = await notificarAvisos(avisos, { ahora: MEDIODIA });
  assert.equal(r.whatsapp.enviado, true);
  assert.equal(enviados.length, 1, 'un solo mensaje');
  const texto = enviados[0].cuerpo.text.body;
  assert.match(texto, /^\*Mejor Precio\* · 4 avisos/);
  assert.match(texto, /Bajó: Aguila 330/);
  assert.match(texto, /Compra en TRIVO: 2 precios para aprobar/);
  assert.match(texto, /Hay que pedir: Hielo 3 kg\*\n {2}Quedan 4 en TRIVO \(mínimo 10\)/);
  assert.match(texto, /Éxito no está respondiendo/);
  assert.match(texto, /Abrir: https:\/\/mejor-precio\.example\/$/);
  assert.match(mensajeWhatsapp([avisos[1]]), /Abrir: https:\/\/mejor-precio\.example\/#mitienda/);
});

test('en el horario de silencio se guardan y salen todos juntos después', async () => {
  enviados.length = 0;
  const noche = Date.parse('2026-11-02T04:00:00Z'); // 23:00 en Colombia
  assert.equal((await notificarAvisos([{ tipo: 'agotado', nombre: 'Poker', tienda: 'D1' }], { ahora: noche })).motivo, 'silencio');
  assert.equal(enviados.length, 0);
  await notificarAvisos([{ tipo: 'volvio', nombre: 'Poker', tienda: 'Olímpica', precio: 3000 }], { ahora: MEDIODIA });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].cuerpo.text.body, /2 avisos[\s\S]*Se agotó: Poker[\s\S]*Volvió a haber: Poker/);
  assert.ok((await leerWhatsapp()).ultimo.t);
});

test('lo que pide atención en TRIVO se avisa una sola vez, al aparecer', () => {
  const carta = [{ id: '1', nombre: 'Hielo 3 kg', precio: 5000 }, { id: '2', nombre: 'Miller x 24', precio: 60000 }];
  const ahora1 = { '1': { fuente: 'directo', bajo: true, existencias: 4, minimo: 10 }, '2': { fuente: 'calculado', costo: 62000, bajoCosto: true } };
  const avisos = avisosDeAtencion(carta, ahora1, { productos: {} });
  assert.deepEqual(avisos.map((a) => a.tipo), ['bajo-minimo', 'bajo-costo']);
  assert.equal(avisosDeAtencion(carta, ahora1, { productos: ahora1 }).length, 0, 'si ya estaba así, no se repite');
});

test('sin cuenta de Meta, Green-API manda el texto al chat del dueño', async () => {
  const meta = { token: process.env.WHATSAPP_TOKEN, id: process.env.WHATSAPP_PHONE_ID };
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
  process.env.GREENAPI_ID = '7103123456';
  process.env.GREENAPI_TOKEN = 'abcdef0123456789abcdef';
  try {
    await guardarWhatsapp({ activo: true, numero: '300 466 0472' });
    assert.equal((await leerWhatsapp()).proveedor, 'green-api');
    enviados.length = 0;
    assert.deepEqual(await enviarWhatsapp('Hola\ncon salto'), { enviado: true, via: 'green-api' });
    assert.equal(enviados[0].url, 'https://api.green-api.com/waInstance7103123456/sendMessage/abcdef0123456789abcdef');
    assert.deepEqual(enviados[0].cuerpo, { chatId: '573004660472@c.us', message: 'Hola\ncon salto' });
    process.env.GREENAPI_ID = '../otra-ruta';
    assert.equal((await leerWhatsapp()).servidor, false, 'un id raro no se usa en la URL');
  } finally {
    delete process.env.GREENAPI_ID;
    delete process.env.GREENAPI_TOKEN;
    process.env.WHATSAPP_TOKEN = meta.token;
    process.env.WHATSAPP_PHONE_ID = meta.id;
  }
});
