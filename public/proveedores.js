// Proveedores propios: distribuidores sin página web cuyos precios conocemos.
// Se crean a mano (producto por producto) o se importan desde un CSV de Excel,
// y entran a la búsqueda como una tienda más.
import { escribirCsv, normalizarProducto, productosDeCsv, productosDeTexto } from './csv.js';
import { catalogoTiendas } from './sync.js';
import { $, api, boton, descargar, el, guardado, hace, idNuevo, leerArchivo, presentacion } from './util.js';

let proveedores = guardado('mp-proveedores') || [];
let editando = null; // copia del proveedor abierto

async function cargar() {
  try {
    ({ proveedores } = await api('/api/proveedores'));
    guardado('mp-proveedores', proveedores);
  } catch {
    /* sin red: los últimos conocidos */
  }
}

async function guardarProveedor(p) {
  ({ proveedores } = await api('/api/proveedores', { method: 'PUT', cuerpo: { proveedor: { ...p, actualizado: Date.now() } } }));
  guardado('mp-proveedores', proveedores);
  await catalogoTiendas(); // para que aparezca en Ajustes y en la búsqueda
}

function pintarLista() {
  const caja = $('#prov-lista');
  caja.replaceChildren();
  if (!proveedores.length) {
    caja.append(el('p', 'ayuda', 'Todavía no tienes proveedores propios. Crea uno o importa su lista de precios.'));
    return;
  }
  for (const p of proveedores) {
    const filaP = el('div', 'lista-fila');
    const texto = el('div', 'lista-texto');
    texto.append(el('span', '', p.nombre));
    texto.append(el('span', 'ayuda', `${p.productos.length} productos · actualizado ${hace(p.actualizado)}${p.activo ? '' : ' · apagado'}`));
    const acc = el('div', 'lista-acciones');
    acc.append(boton('Editar', 'mini', () => abrirEditor(p)));
    filaP.append(texto, acc);
    caja.append(filaP);
  }
}

// ── Editor ─────────────────────────────────────────────────────────────────
function abrirEditor(p) {
  editando = structuredClone(p || { id: idNuevo().slice(0, 36), nombre: '', contacto: '', alcance: 'Proveedor propio', activo: true, productos: [] });
  $('#prov-editor').hidden = false;
  $('#prov-nombre').value = editando.nombre;
  $('#prov-contacto').value = editando.contacto || '';
  $('#prov-alcance').value = editando.alcance || '';
  $('#prov-activo').checked = editando.activo;
  $('#prov-borrar').hidden = !p;
  $('#prov-mensaje').textContent = '';
  pintarProductos();
  $('#prov-nombre').focus();
}

function cerrarEditor() {
  editando = null;
  $('#prov-editor').hidden = true;
}

function pintarProductos() {
  const caja = $('#prov-productos');
  caja.replaceChildren();
  $('#prov-cuenta').textContent = editando.productos.length ? `${editando.productos.length} productos` : 'Sin productos todavía';
  editando.productos.forEach((x, i) => {
    const filaX = el('div', 'prov-fila');
    const nombre = el('input');
    nombre.value = x.nombre;
    nombre.setAttribute('aria-label', 'Producto');
    nombre.addEventListener('change', () => (x.nombre = nombre.value));
    const precio = el('input');
    precio.type = 'number';
    precio.inputMode = 'numeric';
    precio.min = '0';
    precio.step = '100';
    precio.value = x.precio;
    precio.setAttribute('aria-label', 'Precio');
    precio.addEventListener('change', () => (x.precio = Number(precio.value)));
    const hay = el('label', 'opciones');
    const check = el('input');
    check.type = 'checkbox';
    check.checked = x.disponible !== false;
    check.addEventListener('change', () => (x.disponible = check.checked));
    hay.append(check, document.createTextNode('Hay'));
    const info = el('span', 'ayuda', x.ml ? presentacion(x) : 'sin tamaño');
    const quitar = boton('Quitar', 'mini', () => {
      editando.productos.splice(i, 1);
      pintarProductos();
    });
    filaX.append(nombre, precio, hay, info, quitar);
    caja.append(filaX);
  });
}

function leerFormulario() {
  editando.nombre = $('#prov-nombre').value.trim();
  editando.contacto = $('#prov-contacto').value.trim();
  editando.alcance = $('#prov-alcance').value.trim() || 'Proveedor propio';
  editando.activo = $('#prov-activo').checked;
}

async function guardarEditor() {
  leerFormulario();
  const mensaje = $('#prov-mensaje');
  if (editando.nombre.length < 2) {
    mensaje.textContent = 'Escribe el nombre del proveedor.';
    return;
  }
  try {
    await guardarProveedor(editando);
    mensaje.textContent = '';
    cerrarEditor();
    pintarLista();
    $('#prov-estado').textContent = 'Guardado. Sus precios ya aparecen en las búsquedas.';
  } catch (error) {
    mensaje.textContent = error.message;
  }
}

function agregarProducto(e) {
  e.preventDefault();
  const nombre = $('#prov-p-nombre').value.trim();
  const precio = Number($('#prov-p-precio').value);
  if (nombre.length < 2 || !(precio > 0)) return;
  const ml = Number($('#prov-p-ml').value) || null;
  const unidades = Number($('#prov-p-unidades').value) || null;
  editando.productos.unshift(normalizarProducto({ nombre, precio, ml, unidades, disponible: true }));
  $('#form-prov-producto').reset();
  pintarProductos();
  $('#prov-p-nombre').focus();
}

// `leer` devuelve el texto (de un archivo o de lo pegado); `pegado` usa el
// lector de listas de WhatsApp además del de CSV.
async function importar(leer, reemplazar, pegado = false) {
  const mensaje = $('#prov-mensaje');
  try {
    const texto = await leer();
    const leido = pegado ? productosDeTexto(texto) : productosDeCsv(texto);
    const productos = leido.productos.map(normalizarProducto).filter((p) => p.precio > 0);
    const { conCabeza } = leido;
    if (!productos.length) {
      mensaje.textContent = pegado
        ? 'No se encontraron productos. Cada línea necesita el nombre y el precio al final (por ejemplo «Antioqueño 750 ml $41.500»).'
        : 'No se encontraron productos. El archivo necesita al menos las columnas «nombre» y «precio».';
      return;
    }
    if (reemplazar) editando.productos = productos;
    else {
      // Los que ya estaban (mismo nombre) se actualizan; los demás se agregan.
      const porNombre = new Map(editando.productos.map((x) => [x.nombre.toLowerCase(), x]));
      for (const p of productos) {
        const previo = porNombre.get(p.nombre.toLowerCase());
        if (previo) Object.assign(previo, p);
        else editando.productos.push(p);
      }
    }
    pintarProductos();
    mensaje.textContent = `${productos.length} productos leídos${conCabeza ? '' : ' (sin encabezado: nombre en la primera columna y precio en la segunda)'}. Revisa y pulsa «Guardar».`;
  } catch (error) {
    mensaje.textContent = `No se pudo leer el archivo: ${error.message}`;
  }
}

function plantilla() {
  const filas = [
    ['nombre', 'precio', 'ml', 'unidades', 'ean', 'disponible'],
    ['Aguardiente Antioqueño Tapa Roja 750 ml', '41500', '750', '1', '', 'si'],
    ['Cerveza Águila lata 330 ml x24', '62000', '330', '24', '', 'si'],
  ];
  descargar('plantilla-proveedor.csv', escribirCsv(filas), 'text/csv;charset=utf-8');
}

function exportarProveedor() {
  leerFormulario();
  const filas = [['nombre', 'precio', 'ml', 'unidades', 'ean', 'disponible']];
  for (const x of editando.productos) filas.push([x.nombre, x.precio, x.ml ?? '', x.unidades ?? '', x.ean ?? '', x.disponible === false ? 'no' : 'si']);
  descargar(`${editando.nombre || 'proveedor'}.csv`, escribirCsv(filas), 'text/csv;charset=utf-8');
}

export async function abrirProveedores() {
  cerrarEditor();
  $('#prov-estado').textContent = '';
  pintarLista();
  await cargar();
  pintarLista();
}

export function configurarProveedores() {
  $('#prov-nuevo').addEventListener('click', () => abrirEditor(null));
  $('#prov-plantilla').addEventListener('click', plantilla);
  $('#prov-guardar').addEventListener('click', guardarEditor);
  $('#prov-cancelar').addEventListener('click', cerrarEditor);
  $('#prov-exportar').addEventListener('click', exportarProveedor);
  $('#form-prov-producto').addEventListener('submit', agregarProducto);
  $('#prov-borrar').addEventListener('click', async () => {
    if (!editando || !confirm(`¿Borrar a ${editando.nombre} y sus precios?`)) return;
    ({ proveedores } = await api(`/api/proveedores?id=${encodeURIComponent(editando.id)}`, { method: 'DELETE' }));
    guardado('mp-proveedores', proveedores);
    await catalogoTiendas();
    cerrarEditor();
    pintarLista();
  });
  $('#prov-archivo').addEventListener('change', async (e) => {
    const archivo = e.target.files?.[0];
    if (archivo) await importar(() => leerArchivo(archivo), $('#prov-reemplazar').checked);
    e.target.value = '';
  });
  $('#prov-leer-pegado').addEventListener('click', async () => {
    const texto = $('#prov-pegar').value;
    if (!texto.trim()) return;
    await importar(async () => texto, $('#prov-reemplazar').checked, true);
    $('#prov-pegar').value = '';
  });
}
