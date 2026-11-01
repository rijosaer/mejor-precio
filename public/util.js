// Utilidades que comparten todas las vistas de la app.

export const $ = (sel, raiz = document) => raiz.querySelector(sel);
export const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
export const miles = new Intl.NumberFormat('es-CO');
export const fechaCorta = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short' });
export const fechaLarga = (t) => new Date(t).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });

// Acciones que una vista le pide a otra (buscar, mostrar…). app.js las llena:
// así los módulos no se importan en círculo.
export const acciones = {};

// localStorage con JSON; nunca lanza (modo privado, sin espacio).
export function guardado(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    return null;
  }
  return valor;
}

export function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined && texto !== null) nodo.textContent = texto;
  return nodo;
}

export function boton(texto, clase, alHacer) {
  const b = el('button', clase, texto);
  b.type = 'button';
  if (alHacer) b.addEventListener('click', alHacer);
  return b;
}

export function enlace(texto, url, clase) {
  const a = el('a', clase, texto);
  if (url) {
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
  }
  return a;
}

export function campoNumero(texto, valor, alCambiar, { paso = '100', placeholder = '', min = '0', evento = 'change' } = {}) {
  const etiqueta = el('label', '', texto);
  const entrada = el('input');
  entrada.type = 'number';
  entrada.inputMode = 'decimal';
  entrada.min = min;
  entrada.step = paso;
  entrada.placeholder = placeholder;
  entrada.value = valor ?? '';
  entrada.addEventListener(evento, () => alCambiar(entrada.value === '' ? null : Number(entrada.value), entrada));
  etiqueta.append(entrada);
  return etiqueta;
}

export function presentacion({ ml, unidades }) {
  if (!ml) return 'Sin tamaño identificado';
  const tam = `${miles.format(ml)} ml`;
  return unidades > 1 ? `${unidades} × ${tam}` : tam;
}

export function litros(p) {
  return p.ml ? (p.ml * (p.unidades || 1)) / 1000 : null;
}

export function precioPorLitro(p) {
  const l = litros(p);
  return l ? p.precio / l : null;
}

export function precioLitro(p) {
  const v = precioPorLitro(p);
  return v ? `${pesos.format(Math.round(v))} / L` : '';
}

export function hace(t) {
  const minutos = Math.round((Date.now() - t) / 60_000);
  if (minutos < 60) return minutos <= 1 ? 'ahora' : `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  return dias === 1 ? 'ayer' : `hace ${dias} días`;
}

export async function api(ruta, opciones = {}) {
  const { cuerpo, ...resto } = opciones;
  const init = { credentials: 'same-origin', ...resto };
  if (cuerpo !== undefined || (init.method && init.method !== 'GET')) {
    init.headers = { 'content-type': 'application/json', ...(init.headers || {}) };
    init.body = JSON.stringify(cuerpo ?? {});
  }
  const res = await fetch(ruta, init);
  const datos = await res.json().catch(() => ({}));
  if (res.status === 401 && ruta !== '/api/entrar') {
    acciones.mostrar?.('entrar');
    throw new Error('Inicia sesión');
  }
  if (!res.ok) throw new Error(datos.error || `Error ${res.status}`);
  return datos;
}

// Compartir un texto: la hoja del teléfono si existe; si no, WhatsApp.
export async function compartir(texto, titulo = 'Mejor Precio') {
  if (navigator.share) {
    try {
      await navigator.share({ title: titulo, text: texto });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
}

// Descarga un archivo generado en el navegador.
export function descargar(nombre, contenido, tipo) {
  const a = el('a');
  a.href = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  a.download = nombre;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Lee un archivo elegido por la persona como texto.
export function leerArchivo(archivo) {
  return new Promise((resolver, rechazar) => {
    const lector = new FileReader();
    lector.onload = () => resolver(String(lector.result || ''));
    lector.onerror = () => rechazar(lector.error);
    lector.readAsText(archivo);
  });
}

export function idNuevo() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// Foto con carga diferida; si la tienda no la deja cargar, queda el cuadro gris.
export function foto(url, clase, alt = '') {
  const caja = el('span', `${clase} foto-vacia`);
  if (!url) return caja;
  const img = el('img');
  img.loading = 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.alt = alt;
  img.src = url;
  img.addEventListener('load', () => caja.classList.remove('foto-vacia'));
  img.addEventListener('error', () => img.remove());
  caja.append(img);
  return caja;
}
