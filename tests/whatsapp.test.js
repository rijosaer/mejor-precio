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
let greenVinculado = false;
let metaFalla = false;
globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.green-api.com/')) {
    if (u.includes('/setSettings/')) {
      enviados.push({ url: u, cuerpo: JSON.parse(opciones.body) });
      return new Response(JSON.stringify({ saveSettings: true }));
    }
    if (u.includes('/getStateInstance/')) return new Response(JSON.stringify({ stateInstance: greenVinculado ? 'authorized' : 'notAuthorized' }));
    if (u.includes('/qr/')) return new Response(JSON.stringify(greenVinculado ? { type: 'alreadyLogged', message: 'instance account already authorized' } : { type: 'qrCode', message: 'iVBORw0KGgo=' }));
    if (u.includes('/logout/')) {
      greenVinculado = false;
      return new Response(JSON.stringify({ isLogout: true }));
    }
    enviados.push({ url: u, cuerpo: JSON.parse(opciones.body) });
    return new Response(JSON.stringify({ idMessage: 'BAE5' }));
  }
  if (!u.startsWith('https://graph.facebook.com/')) return new Response('no', { status: 404 });
  const cuerpo = JSON.parse(opciones.body);
  if (metaFalla) return new Response(JSON.stringify({ error: { code: 4, message: 'Límite de mensajes' } }), { status: 429 });
  enviados.push({ url: u, auth: opciones.headers.authorization, cuerpo });
  if (cuerpo.type === 'text' && !ventanaAbierta) {
    return new Response(JSON.stringify({ error: { code: 131047, message: 'Re-engagement message', error_data: { details: 'More than 24 hours have passed' } } }), { status: 400 });
  }
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.1' }] }));
};

const { limpiarNumero, textoParaPlantilla, enviarWhatsapp, guardarWhatsapp, leerWhatsapp, vinculoGreen, desvincularGreen } = await import('../src/whatsapp.js');
const { notificarAvisos, mensajeWhatsapp, armarMensaje, nombreCorto } = await import('../src/push.js');
const { leerOrden, procesarEntrante } = await import('../src/respuestas.js');
const { tokenWebhook, activarRespuestas } = await import('../src/whatsapp.js');
const { manejarApi } = await import('../src/api.js');
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
  assert.match(texto, /^\*Mejor Precio\* · lun, 2 de nov, 12:00 p\. ?m\.\n💲 precios por aprobar · 📦 1 por pedir · 🏷️ 1 para comprar · 🛠️ 1 de conexión\n/);
  // En orden de urgencia: aprobar, pedir, comprar, conexiones.
  assert.ok(texto.indexOf('Precios por aprobar') < texto.indexOf('Por pedir') && texto.indexOf('Por pedir') < texto.indexOf('Para comprar') && texto.indexOf('Para comprar') < texto.indexOf('Conexiones'));
  assert.match(texto, /• Compra en TRIVO: 2 precios para aprobar\n {3}Aguila: \$3\.500 → \$3\.300\n↳ https:\/\/mejor-precio\.example\/panel#mitienda/, 'los enlaces abren el panel, no la tienda pública');
  assert.match(texto, /• Hielo 3 kg — quedan 4/);
  assert.match(texto, /• Aguila 330\n {3}Makro \*\$\s2\.900\* \(bajó de \$\s3\.300\)/);
  assert.match(texto, /Éxito no está respondiendo[\s\S]*#estado$/);
  assert.match(mensajeWhatsapp([avisos[1]]), /^\*Mejor Precio\* · [^\n]+\n\n💲/, 'con una sola sección no hace falta el resumen');
});

test('WhatsApp: variantes juntas, lo que se pierde y el precio con tu margen', () => {
  const texto = mensajeWhatsapp([
    { tipo: 'bajo-minimo', nombre: 'Aguila x 330ml (lata) Caliente', base: 'Aguila x 330ml (lata)', variante: 'Caliente', existencias: 0, vendidos: 30 },
    { tipo: 'bajo-minimo', nombre: 'Aguila x 330ml (lata) Fria', base: 'Aguila x 330ml (lata)', variante: 'Fria', existencias: 0, vendidos: 30 },
    { tipo: 'bajo-minimo', nombre: 'Poker x 330ml (lata)', base: 'Poker x 330ml (lata)', existencias: 0, vendidos: 2 },
    { tipo: 'bajo-costo', nombre: 'Miller x 24', precio: 38000, costo: 42000, margen: 20, sugerido: 52500 },
    { tipo: 'bajo-costo', nombre: 'Caja Miller + Hielo', precio: 35000, costo: 43000, margen: 20, sugerido: 53800 },
  ], { ahora: MEDIODIA });
  assert.match(texto, /🔴 2 bajo el costo · 📦 2 por pedir/);
  assert.match(texto, /📦 \*Por pedir\* · agotados en TRIVO\n• Aguila 330ml lata \(Caliente y Fria\) · vendiste 30 en 30 días\n• Poker 330ml lata · vendiste 2 en 30 días/);
  // Primero lo que más se pierde.
  assert.match(texto, /• Caja Miller \+ Hielo\n {3}vendes \$\s35\.000 · cuesta \$\s43\.000 → \*pierdes \$\s8\.000\*\n {3}con tu margen \(20 %\): \*\$\s53\.800\*\n• Miller 24\n/);
  assert.ok(texto.indexOf('debajo del costo') < texto.indexOf('Por pedir'), 'perder plata va primero');
  assert.equal(nombreCorto('Cerveza Sixpack CERVEZA COSTEÑA BACANA 1980 ml'), 'Cerveza Sixpack Costeña Bacana 1980 ml');
});

test('en el horario de silencio se guardan y salen todos juntos después', async () => {
  enviados.length = 0;
  const noche = Date.parse('2026-11-02T04:00:00Z'); // 23:00 en Colombia
  assert.equal((await notificarAvisos([{ tipo: 'agotado', nombre: 'Poker', tienda: 'D1' }], { ahora: noche })).motivo, 'silencio');
  assert.equal(enviados.length, 0);
  await notificarAvisos([{ tipo: 'volvio', nombre: 'Poker', tienda: 'Olímpica', precio: 3000 }], { ahora: MEDIODIA });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].cuerpo.text.body, /Volvió a Olímpica|volvió a Olímpica[\s\S]*Se agotó: Poker/);
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
    // Vincular desde Ajustes: QR mientras falta escanear; vinculado después; desvincular.
    greenVinculado = false;
    assert.deepEqual(await vinculoGreen(), { estado: 'qr', qr: 'data:image/png;base64,iVBORw0KGgo=' });
    greenVinculado = true;
    assert.deepEqual(await vinculoGreen(), { estado: 'authorized', qr: null });
    assert.equal((await desvincularGreen()).estado, 'qr');
    process.env.GREENAPI_ID = '../otra-ruta';
    assert.equal((await leerWhatsapp()).servidor, false, 'un id raro no se usa en la URL');
  } finally {
    delete process.env.GREENAPI_ID;
    delete process.env.GREENAPI_TOKEN;
    process.env.WHATSAPP_TOKEN = meta.token;
    process.env.WHATSAPP_PHONE_ID = meta.id;
  }
});

test('los precios por aprobar van numerados para aprobarlos respondiendo', () => {
  const avisos = [
    { tipo: 'bajo-costo', nombre: 'Caja Miller + Hielo', precio: 35000, costo: 43000, margen: 20, sugerido: 53800, propuesta: '7', vendidos: 3 },
    { tipo: 'precio-compra', title: 'Compra en TRIVO: 2 precios para aprobar', items: [{ id: '1', nombre: 'Aguila x 330ml (lata)', precioActual: 3500, precioNuevo: 3300 }, { id: '4-9', nombre: 'Aguardiente Tapa azul', precioActual: 49000, precioNuevo: 44300 }] },
    { tipo: 'recordatorio', title: '2 precios esperan', items: [{ id: '1', nombre: 'Aguila x 330ml (lata)', precioActual: 3500, precioNuevo: 3300 }] },
  ];
  const { texto, opciones } = armarMensaje(avisos, { ahora: MEDIODIA, responder: true });
  assert.deepEqual(opciones, ['7', '1', '4-9']);
  assert.match(texto, /🔴 1 bajo el costo · 💲 2 por aprobar/);
  assert.match(texto, /\*1\.\* Caja Miller \+ Hielo\n {3}vendes \$\s35\.000 · cuesta \$\s43\.000 → \*pierdes \$\s8\.000\* \(3 vendidos en 30 días: \$\s24\.000\)/);
  assert.match(texto, /💲 \*Precios por aprobar\*\n\*2\.\* Aguila 330ml lata\n {3}\$\s3\.500 → \*\$\s3\.300\*\n\*3\.\* Aguardiente Tapa azul/);
  assert.equal(texto.match(/Aguila 330ml/g).length, 1, 'la compra y el recordatorio no repiten el mismo precio');
  assert.match(texto, /↩️ Responde \*1\* o \*1 3\* para poner ese precio en TRIVO, o \*todos\*/);
  // Sin respuestas (Meta, push) no hay números ni instrucciones.
  const plano = armarMensaje(avisos, { ahora: MEDIODIA });
  assert.deepEqual(plano.opciones, []);
  assert.doesNotMatch(plano.texto, /\*1\.\*|Responde/);
  assert.match(plano.texto, /• Caja Miller/);
});

test('inventario en negativo y las ofertas también por unidad', () => {
  const texto = mensajeWhatsapp([
    { tipo: 'negativo', nombre: 'Poker x 330ml (lata)', existencias: -1 },
    { tipo: 'negativo', nombre: 'Aguila x 330ml (lata) Fria', existencias: -14 },
    { tipo: 'oferta', nombre: 'Cerveza Sixpack COSTEÑA BACANA', tienda: 'Éxito', precio: 13912, a: 18550, unidades: 6, tuUnidad: 3000 },
    { tipo: 'dulce', nombre: 'Aguila 330', tienda: 'Makro', precio: 2900, antes: 3300, tuUnidad: 2800 },
  ], { ahora: MEDIODIA });
  assert.match(texto, /🧮 \*Inventario en negativo\*\n• Aguila 330ml lata Fria: TRIVO marca \*-14\*\n• Poker 330ml lata: TRIVO marca \*-1\*\n {3}Pasa cuando se vende sin haber cargado la compra/);
  assert.match(texto, /Éxito \*\$\s13\.912\* \(antes \$\s18\.550, −25 %\)\n {3}\$\s2\.319 c\/u · tú la vendes a \$\s3\.000 \(\+\$\s681\)/);
  assert.match(texto, /Makro \*\$\s2\.900\* \(bajó de \$\s3\.300\)\n {3}tú la vendes a \$\s2\.800 \(−\$\s100\)/, 'una sola unidad: solo la comparación');
});

test('TRIVO en negativo se avisa una vez, al aparecer', () => {
  const carta = [{ id: '5', nombre: 'Poker x 330ml (lata)', precio: 3000 }];
  const ahora1 = { '5': { fuente: 'directo', bajo: true, existencias: -3, minimo: 10 } };
  assert.deepEqual(avisosDeAtencion(carta, ahora1, { productos: {} }).map((a) => a.tipo), ['bajo-minimo', 'negativo']);
  assert.equal(avisosDeAtencion(carta, ahora1, { productos: ahora1 }).length, 0);
});

test('de noche solo sale lo urgente; lo demás llega en la mañana como «lo de la noche»', async () => {
  enviados.length = 0;
  const noche = Date.parse('2026-11-04T05:00:00Z'); // 00:00 en Colombia
  const r = await notificarAvisos([
    { tipo: 'bajo-costo', clave: 'n1', nombre: 'Club Colombia x 6', precio: 20000, costo: 21000 },
    { tipo: 'agotado', clave: 'n2', nombre: 'Ron Medellín', tienda: 'D1' },
  ], { ahora: noche });
  assert.equal(r.whatsapp.enviado, true);
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].cuerpo.text.body, /^\*Mejor Precio\* · [^\n]+ · 🔴 urgente\n\n🔴 \*Vendes por debajo del costo\*\n• Club Colombia 6/);
  assert.doesNotMatch(enviados[0].cuerpo.text.body, /Ron Medellín/);
  enviados.length = 0;
  const manana = Date.parse('2026-11-04T12:10:00Z'); // 7:10
  await notificarAvisos([], { ahora: manana });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].cuerpo.text.body, /· 🌙 lo de la noche\n[\s\S]*Se agotó: Ron Medellín/);
  assert.doesNotMatch(enviados[0].cuerpo.text.body, /Club Colombia/, 'lo urgente ya había salido');
});

test('el mismo aviso no se repite en 24 horas', async () => {
  const aviso = { tipo: 'agota', clave: 'rep|1', nombre: 'Ron Viejo de Caldas', tienda: 'Olímpica', stock: 2, precio: 50000 };
  const t0 = Date.parse('2026-11-05T15:00:00Z');
  enviados.length = 0;
  assert.equal((await notificarAvisos([aviso], { ahora: t0 })).whatsapp.enviado, true);
  assert.equal((await notificarAvisos([aviso], { ahora: t0 + 2 * 3600_000 })).motivo, 'repetidos');
  assert.equal(enviados.length, 1);
  // Otro precio sí es otro aviso; y pasado un día, el mismo vuelve a salir.
  await notificarAvisos([{ ...aviso, precio: 45000 }], { ahora: t0 + 3 * 3600_000 });
  await notificarAvisos([aviso], { ahora: t0 + 25 * 3600_000 });
  assert.equal(enviados.length, 3);
});

test('si WhatsApp falla, el error queda a la vista y los avisos esperan al próximo intento', async () => {
  enviados.length = 0;
  metaFalla = true;
  const t0 = Date.parse('2026-11-07T15:00:00Z');
  const r = await notificarAvisos([{ tipo: 'agotado', clave: 'f1', nombre: 'Tequila José Cuervo', tienda: 'Makro' }], { ahora: t0 });
  assert.equal(r.whatsapp.enviado, false);
  assert.match((await leerWhatsapp()).error.mensaje, /Límite de mensajes/);
  metaFalla = false;
  await notificarAvisos([], { ahora: t0 + 3600_000 });
  assert.equal(enviados.length, 1);
  assert.match(enviados[0].cuerpo.text.body, /Tequila José Cuervo/);
  assert.equal((await leerWhatsapp()).error, null, 'el envío bueno limpia el error');
});

test('las respuestas del dueño: números, todos, descartar, precios y ayuda', () => {
  assert.deepEqual(leerOrden('1'), { accion: 'aplicar', numeros: [1] });
  assert.deepEqual(leerOrden(' Sí 1, 3 y 4. '), { accion: 'aplicar', numeros: [1, 3, 4] });
  assert.deepEqual(leerOrden('aplicar 2 2'), { accion: 'aplicar', numeros: [2] });
  assert.deepEqual(leerOrden('no 2'), { accion: 'descartar', numeros: [2] });
  assert.deepEqual(leerOrden('Descartar 1 y 2'), { accion: 'descartar', numeros: [1, 2] });
  assert.deepEqual(leerOrden('Todos'), { accion: 'todos' });
  assert.deepEqual(leerOrden('sí, todos'), { accion: 'todos' });
  assert.deepEqual(leerOrden('*precios*'), { accion: 'precios' });
  assert.deepEqual(leerOrden('Ayuda'), { accion: 'ayuda' });
  for (const t of ['hola', 'mándame 2 cajas', '0', 'no', '', 'tengo 300 latas']) assert.equal(leerOrden(t), null, t);
});

test('webhook de Green-API: con su token, solo del chat del dueño y una vez por mensaje', async () => {
  const meta = { token: process.env.WHATSAPP_TOKEN, id: process.env.WHATSAPP_PHONE_ID };
  delete process.env.WHATSAPP_TOKEN;
  delete process.env.WHATSAPP_PHONE_ID;
  process.env.GREENAPI_ID = '7103123456';
  process.env.GREENAPI_TOKEN = 'abcdef0123456789abcdef';
  process.env.APP_PASSWORD = 'clave-de-prueba';
  try {
    await guardarWhatsapp({ activo: true, numero: '300 466 0472' });
    const ahora = Date.now();
    const mensaje = (texto, extra = {}) => ({
      typeWebhook: 'incomingMessageReceived',
      instanceData: { idInstance: 7103123456, wid: '573000000000@c.us' },
      timestamp: Math.floor(ahora / 1000),
      idMessage: `ID-${texto}-${Math.random()}`,
      senderData: { chatId: '573004660472@c.us', sender: '573004660472@c.us' },
      messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: texto } },
      ...extra,
    });
    const llamar = (cuerpo, auth) =>
      manejarApi(new Request('https://mejor-precio.example/api/whatsapp/entrante', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(cuerpo) }));
    enviados.length = 0;
    assert.equal((await llamar(mensaje('ayuda'))).status, 401, 'sin token no entra');
    assert.equal((await llamar(mensaje('ayuda'), 'Bearer otro')).status, 401);
    const auth = `Bearer ${tokenWebhook()}`;
    assert.equal((await llamar(mensaje('ayuda'), auth)).status, 200);
    assert.equal(enviados.length, 1);
    assert.match(enviados[0].cuerpo.message, /Puedes responder:[\s\S]*\*todos\*/);
    assert.equal(enviados[0].cuerpo.chatId, '573004660472@c.us');
    // Un cliente que escribe a la empresa, un grupo o un texto cualquiera: nada.
    enviados.length = 0;
    await llamar(mensaje('1', { senderData: { chatId: '573119998877@c.us' } }), auth);
    await llamar(mensaje('hola, ¿cómo vas?'), auth);
    await llamar({ typeWebhook: 'outgoingMessageStatus' }, auth);
    assert.equal(enviados.length, 0);
    // Green-API reintenta: el mismo mensaje se atiende una sola vez; uno de hace horas, ninguna.
    const repetido = mensaje('precios');
    assert.match((await procesarEntrante(repetido, { ahora })).respuesta, /No hay precios esperando/);
    assert.equal((await procesarEntrante(repetido, { ahora })).ignorado, 'repetido');
    assert.equal((await procesarEntrante(mensaje('1'), { ahora: ahora + 3 * 3600_000 })).ignorado, 'viejo');
    // Activar: el webhook de la app con el token, y nada más de la instancia.
    enviados.length = 0;
    await activarRespuestas('https://mejor-precio.example');
    assert.deepEqual(enviados[0].cuerpo, { webhookUrl: 'https://mejor-precio.example/api/whatsapp/entrante', webhookUrlToken: auth, incomingWebhook: 'yes' });
    await assert.rejects(activarRespuestas('http://localhost:8080'), /https/);
  } finally {
    delete process.env.GREENAPI_ID;
    delete process.env.GREENAPI_TOKEN;
    process.env.WHATSAPP_TOKEN = meta.token;
    process.env.WHATSAPP_PHONE_ID = meta.id;
  }
});
