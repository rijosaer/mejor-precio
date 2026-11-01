// Ajustes: margen, logística, envío por tienda, cashback, tiendas activas,
// resultados, monitoreo, notificaciones, apariencia y respaldo.
import { ajustes, coordenadasDe, distanciaKm, exportarRespaldo, guardarAjustes, importarRespaldo, porcentajeCashback } from './datos.js';
import { catalogoTiendas, configServidor, subirAjustes } from './sync.js';
import { $, acciones, api, boton, descargar, el, guardado, leerArchivo, pesos } from './util.js';

let tiendas = [];

function etiquetaDato(texto, valor, dataset, tipo = 'text') {
  const l = el('label', '', texto);
  const i = el('input');
  Object.assign(i.dataset, dataset);
  i.type = tipo;
  if (tipo === 'number') {
    i.inputMode = 'decimal';
    i.min = '0';
  }
  if (valor !== undefined && valor !== null) i.value = valor;
  l.append(i);
  return l;
}

function pintarResumenLogistica() {
  const caja = $('#aj-log-resumen');
  const origen = coordenadasDe($('#aj-log-origen').value);
  const porKm = Number($('#aj-log-porkm').value) || 0;
  if (!origen) {
    caja.textContent = 'Indica tu ubicación para poder calcular las distancias.';
    return;
  }
  const lineas = [];
  for (const entrada of $('#aj-log-tiendas').querySelectorAll('input')) {
    const destino = coordenadasDe(entrada.value);
    if (!destino) continue;
    const km = distanciaKm(origen.lat, origen.lng, destino.lat, destino.lng) * 2;
    lineas.push(`${entrada.dataset.nombre}: ${km.toFixed(1)} km ida y vuelta · ${pesos.format(Math.round(km * porKm))}`);
  }
  caja.textContent = lineas.length ? lineas.join(' · ') : 'Pega el enlace de Google Maps de una tienda para ver la distancia.';
}

// ── Tiendas activas y envío por tienda ─────────────────────────────────────
function pintarTiendas(a) {
  const activas = $('#aj-tiendas');
  const envios = $('#aj-envios');
  activas.replaceChildren();
  envios.replaceChildren();
  for (const t of tiendas) {
    if (!t.propio) {
      const l = el('label', 'opciones');
      const c = el('input');
      c.type = 'checkbox';
      c.dataset.tienda = t.id;
      c.checked = t.id in a.tiendas ? Boolean(a.tiendas[t.id]) : Boolean(t.porDefecto);
      l.append(c, document.createTextNode(`${t.nombre}${t.porDefecto ? '' : ' (nueva, sin verificar)'}`));
      activas.append(l);
    }
    const e = a.envios[t.id] || {};
    const bloque = el('div', 'aj-envio');
    bloque.dataset.tienda = t.id;
    bloque.append(el('b', '', t.nombre));
    const modo = el('select');
    modo.dataset.campo = 'modo';
    modo.append(new Option('Sin costo', ''), new Option('Lo recojo (traslado por km)', 'recojo'), new Option('Domicilio', 'domicilio'));
    modo.value = e.modo || '';
    modo.setAttribute('aria-label', `Cómo llega de ${t.nombre}`);
    const campos = el('div', 'rejilla');
    campos.append(
      etiquetaDato('Envío ($)', e.costo, { campo: 'costo' }, 'number'),
      etiquetaDato('Gratis desde ($)', e.gratisDesde, { campo: 'gratisDesde' }, 'number'),
      etiquetaDato('Pedido mínimo ($)', e.minimo, { campo: 'minimo' }, 'number'),
    );
    const mostrarCampos = () => {
      campos.hidden = modo.value !== 'domicilio';
    };
    modo.addEventListener('change', mostrarCampos);
    mostrarCampos();
    bloque.append(modo, campos);
    envios.append(bloque);
  }
  if (!tiendas.some((t) => t.propio)) activas.append(el('p', 'ayuda', 'Tus proveedores sin página web se agregan en «Proveedores».'));
}

function leerTiendas() {
  const activas = {};
  for (const c of $('#aj-tiendas').querySelectorAll('input[data-tienda]')) activas[c.dataset.tienda] = c.checked;
  const envios = {};
  for (const bloque of $('#aj-envios').querySelectorAll('.aj-envio')) {
    const modo = bloque.querySelector('[data-campo="modo"]').value;
    if (!modo) continue;
    const numero = (campo) => Number(bloque.querySelector(`[data-campo="${campo}"]`).value) || 0;
    envios[bloque.dataset.tienda] = { modo, costo: numero('costo'), gratisDesde: numero('gratisDesde'), minimo: numero('minimo') };
  }
  return { activas, envios };
}

// ── Notificaciones push ────────────────────────────────────────────────────
function claveBinaria(base64) {
  const relleno = '='.repeat((4 - (base64.length % 4)) % 4);
  const texto = atob((base64 + relleno).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(texto, (c) => c.charCodeAt(0));
}

async function suscripcionActual() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

async function pintarPush() {
  const caja = $('#aj-push');
  caja.replaceChildren();
  const texto = el('p', 'ayuda');
  caja.append(texto);
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    texto.textContent = 'Este navegador no recibe notificaciones. En iPhone, primero instala la app: Compartir → «Agregar a pantalla de inicio», y ábrela desde el ícono.';
    return;
  }
  let estado;
  try {
    estado = await api('/api/push');
  } catch {
    texto.textContent = 'No se pudo consultar el servidor.';
    return;
  }
  if (!estado.activo) {
    texto.textContent = 'El servidor todavía no tiene las claves para enviar notificaciones (VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY; se crean con «npm run claves-push»).';
    return;
  }
  const actual = await suscripcionActual().catch(() => null);
  if (Notification.permission === 'denied') {
    texto.textContent = 'Bloqueaste las notificaciones para esta app. Actívalas en los permisos del navegador.';
    return;
  }
  texto.textContent = actual
    ? `Este teléfono recibe los avisos. ${estado.suscripciones} ${estado.suscripciones === 1 ? 'dispositivo suscrito' : 'dispositivos suscritos'}.`
    : 'Recibe en este teléfono los avisos de Mi lista (bajas de precio, precio objetivo, se agota, ofertas) aunque la app esté cerrada.';
  const botones = el('div', 'aj-botones');
  if (actual) {
    botones.append(
      boton('Enviar una prueba', 'boton-texto', async () => {
        const r = await api('/api/push/probar', { method: 'POST' }).catch((e) => ({ error: e.message }));
        texto.textContent = r.error ? r.error : `Prueba enviada a ${r.enviadas} ${r.enviadas === 1 ? 'dispositivo' : 'dispositivos'}.`;
      }),
      boton('Desactivar en este teléfono', 'boton-texto', async () => {
        await api('/api/push/quitar', { method: 'POST', cuerpo: { endpoint: actual.endpoint } }).catch(() => {});
        await actual.unsubscribe().catch(() => {});
        pintarPush();
      }),
    );
  } else {
    botones.append(
      boton('Activar notificaciones', 'boton', async () => {
        try {
          if ((await Notification.requestPermission()) !== 'granted') {
            texto.textContent = 'Sin permiso no se pueden mostrar notificaciones.';
            return;
          }
          const reg = await navigator.serviceWorker.ready;
          const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: claveBinaria(estado.clave) });
          const etiqueta = /iphone|ipad/i.test(navigator.userAgent) ? 'iPhone' : /android/i.test(navigator.userAgent) ? 'Android' : 'Computador';
          await api('/api/push/suscribir', { method: 'POST', cuerpo: { suscripcion: sub.toJSON(), etiqueta } });
          pintarPush();
        } catch (error) {
          texto.textContent = `No se pudo activar: ${error.message}`;
        }
      }),
    );
  }
  caja.append(botones);
}

// ── WhatsApp del dueño (desde el número de la empresa) ─────────────────────
async function pintarWhatsapp() {
  const caja = $('#aj-whatsapp');
  caja.replaceChildren();
  const texto = el('p', 'ayuda');
  caja.append(texto);
  let wa;
  try {
    wa = await api('/api/whatsapp');
  } catch {
    texto.textContent = 'No se pudo consultar el servidor.';
    return;
  }
  if (!wa.servidor) {
    texto.textContent = 'Todos los avisos (precios, compras por aprobar, existencias bajas, productos bajo el costo, tiendas caídas, resumen semanal) pueden llegar al WhatsApp del dueño desde el número de la empresa. Falta conectar la API de WhatsApp de Meta en el servidor: WHATSAPP_TOKEN y WHATSAPP_PHONE_ID (ver docs/como-funciona.md).';
    return;
  }
  texto.textContent = wa.numero
    ? `${wa.activo ? 'Los avisos llegan' : 'Apagado: los avisos no llegan'} al WhatsApp +${wa.numero}.${wa.ultimo ? ` Último mensaje ${new Date(wa.ultimo.t).toLocaleString('es-CO')}.` : ''}`
    : 'Escribe el WhatsApp personal del dueño: ahí llegan todos los avisos que piden atención, en un solo mensaje por revisión y respetando el horario de silencio.';
  const fila = el('div', 'rejilla');
  const etiqueta = el('label', '', 'WhatsApp del dueño');
  const numero = el('input');
  numero.type = 'tel';
  numero.inputMode = 'tel';
  numero.placeholder = '300 123 4567';
  numero.value = wa.numero ? `+${wa.numero}` : '';
  etiqueta.append(numero);
  fila.append(etiqueta);
  const activo = el('label', 'opciones');
  const marca = el('input');
  marca.type = 'checkbox';
  marca.checked = wa.activo;
  activo.append(marca, ' Enviar los avisos por WhatsApp');
  const guardar = async (cambios) => {
    try {
      await api('/api/whatsapp', { method: 'PUT', cuerpo: cambios });
      pintarWhatsapp();
    } catch (error) {
      numero.setCustomValidity(error.message);
      numero.reportValidity();
    }
  };
  numero.addEventListener('input', () => numero.setCustomValidity(''));
  numero.addEventListener('change', () => guardar({ numero: numero.value }));
  marca.addEventListener('change', () => guardar({ activo: marca.checked }));
  const botones = el('div', 'aj-botones');
  if (wa.numero) {
    botones.append(
      boton('Enviar una prueba', 'boton-texto', async (e) => {
        e.target.disabled = true;
        const r = await api('/api/whatsapp/probar', { method: 'POST', cuerpo: {} }).catch((error) => ({ error: error.message }));
        texto.textContent = r.error ? r.error : `Prueba enviada${r.via === 'plantilla' ? ' con la plantilla (el dueño no ha escrito en las últimas 24 h)' : ''}. Revisa el WhatsApp.`;
        e.target.disabled = false;
      }),
    );
  }
  caja.append(fila, activo, botones);
}

// ── Monitoreo (vive en el servidor) ────────────────────────────────────────
function pintarMonitoreo() {
  const c = configServidor();
  const mia = $('#aj-mitienda');
  mia.replaceChildren(new Option('Ninguna', ''));
  for (const t of tiendas) mia.append(new Option(t.nombre, t.id));
  mia.value = c.miTienda ?? '';
  $('#aj-mon-horas').value = String(c.cadaHoras);
  $('#aj-mon-silencio').checked = c.silencio.activo;
  $('#aj-mon-desde').value = c.silencio.desde;
  $('#aj-mon-hasta').value = c.silencio.hasta;
  $('#aj-mon-semanal').checked = c.resumenSemanal;
}

async function guardarMonitoreo(activas) {
  const config = {
    cadaHoras: Number($('#aj-mon-horas').value),
    silencio: { activo: $('#aj-mon-silencio').checked, desde: Number($('#aj-mon-desde').value), hasta: Number($('#aj-mon-hasta').value) },
    resumenSemanal: $('#aj-mon-semanal').checked,
    tiendas: Object.entries(activas).filter(([, v]) => v).map(([id]) => id),
    miTienda: $('#aj-mitienda').value || null,
  };
  const r = await api('/api/config', { method: 'PUT', cuerpo: { config } });
  guardado('mp-config', r.config);
}

// ── Abrir y guardar ────────────────────────────────────────────────────────
export async function abrirAjustes() {
  const a = ajustes();
  $('#aj-comision-pct').value = a.margen.comisionPct;
  $('#aj-comision-fija').value = a.margen.comisionFija;
  $('#aj-iva').value = a.margen.ivaPct;
  $('#aj-envio').value = a.margen.envio;
  $('#aj-objetivo').value = a.margen.objetivo;
  $('#aj-log-activo').checked = a.logistica.activo;
  $('#aj-log-porkm').value = a.logistica.porKm;
  $('#aj-log-origen').value = Number.isFinite(a.logistica.tuLat) ? `${a.logistica.tuLat}, ${a.logistica.tuLng}` : '';
  $('#aj-favoritas').value = a.favoritas || '';
  $('#aj-orden').value = a.orden || 'precio';
  $('#aj-oferta').value = a.ofertas.oferta;
  $('#aj-liquidacion').value = a.ofertas.liquidacion;
  $('#aj-tema').value = a.apariencia.tema;
  $('#aj-letra').value = String(a.apariencia.letra);
  $('#aj-listo').textContent = '';

  tiendas = await catalogoTiendas();
  pintarMonitoreo();
  const cajaLog = $('#aj-log-tiendas');
  const cajaCb = $('#aj-cashback');
  cajaLog.replaceChildren();
  cajaCb.replaceChildren();
  for (const t of tiendas) {
    const destino = a.logistica.tiendas[t.id];
    const conCoords = destino && Number.isFinite(destino.lat) ? `${destino.lat}, ${destino.lng}` : '';
    const log = etiquetaDato(t.nombre, conCoords, { tienda: t.id, nombre: t.nombre });
    const entrada = log.querySelector('input');
    entrada.placeholder = 'Enlace de Google Maps';
    entrada.addEventListener('input', pintarResumenLogistica);
    cajaLog.append(log);
    const cb = etiquetaDato(`${t.nombre} (%)`, porcentajeCashback(t.id), { tienda: t.id }, 'number');
    cb.querySelector('input').step = '0.5';
    cajaCb.append(cb);
  }
  pintarTiendas(a);
  pintarResumenLogistica();
  acciones.mostrar('ajustes');
  pintarPush();
  pintarWhatsapp();
}

async function guardarPanelAjustes() {
  const origen = coordenadasDe($('#aj-log-origen').value);
  const ubicaciones = {};
  for (const entrada of $('#aj-log-tiendas').querySelectorAll('input')) {
    const destino = coordenadasDe(entrada.value);
    if (destino) ubicaciones[entrada.dataset.tienda] = destino;
  }
  const cashback = {};
  for (const entrada of $('#aj-cashback').querySelectorAll('input')) {
    const pct = Number(entrada.value) || 0;
    if (pct > 0) cashback[entrada.dataset.tienda] = pct;
  }
  const { activas, envios } = leerTiendas();
  const numero = (sel) => Number($(sel).value) || 0;
  guardarAjustes({
    margen: {
      comisionPct: numero('#aj-comision-pct'),
      comisionFija: numero('#aj-comision-fija'),
      ivaPct: numero('#aj-iva'),
      envio: numero('#aj-envio'),
      objetivo: numero('#aj-objetivo'),
    },
    logistica: { activo: $('#aj-log-activo').checked, porKm: numero('#aj-log-porkm'), tuLat: origen ? origen.lat : null, tuLng: origen ? origen.lng : null, tiendas: ubicaciones },
    cashback,
    tiendas: activas,
    envios,
    favoritas: $('#aj-favoritas').value.trim(),
    orden: $('#aj-orden').value,
    ofertas: { oferta: numero('#aj-oferta') || 5, liquidacion: numero('#aj-liquidacion') || 25 },
    apariencia: { tema: $('#aj-tema').value, letra: Number($('#aj-letra').value) || 100 },
  });
  guardado('mp-orden', $('#aj-orden').value);
  acciones.aplicarApariencia();
  const mensajes = [origen || !$('#aj-log-activo').checked ? 'Guardado.' : 'Guardado, pero falta tu ubicación para el traslado.'];
  await subirAjustes();
  try {
    await guardarMonitoreo(activas);
  } catch (error) {
    mensajes.push(`El monitoreo no se pudo guardar en el servidor: ${error.message}`);
  }
  $('#aj-listo').textContent = mensajes.join(' ');
}

export function configurarAjustes() {
  $('#aj-guardar').addEventListener('click', guardarPanelAjustes);
  $('#aj-volver').addEventListener('click', () => acciones.volver());
  $('#aj-log-origen').addEventListener('input', pintarResumenLogistica);
  $('#aj-log-porkm').addEventListener('input', pintarResumenLogistica);
  $('#aj-estado-tiendas').addEventListener('click', () => acciones.mostrar('estado'));
  $('#aj-proveedores').addEventListener('click', () => acciones.mostrar('proveedores'));
  $('#aj-log-mi').addEventListener('click', () => {
    if (!navigator.geolocation) {
      $('#aj-listo').textContent = 'Este navegador no puede ubicarte: pega el enlace de Google Maps.';
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        $('#aj-log-origen').value = `${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`;
        pintarResumenLogistica();
      },
      () => {
        $('#aj-listo').textContent = 'No se pudo leer tu ubicación: pega el enlace de Google Maps.';
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
  $('#aj-respaldo-bajar').addEventListener('click', () => {
    descargar(`mejor-precio-respaldo-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportarRespaldo(), null, 1), 'application/json');
  });
  $('#aj-respaldo-archivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    try {
      const n = importarRespaldo(JSON.parse(await leerArchivo(archivo)));
      $('#aj-respaldo-texto').textContent = `Se recuperaron ${n} datos. La app se recarga…`;
      setTimeout(() => location.reload(), 900);
    } catch (error) {
      $('#aj-respaldo-texto').textContent = error.message;
    }
  });
}
