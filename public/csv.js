// Leer y escribir CSV como los guarda Excel en español (punto y coma) o en
// inglés (coma). Función pura: la usa la importación de proveedores y la
// prueban los tests.

// Detecta el separador mirando la primera línea.
function separadorDe(texto) {
  const primera = texto.split(/\r?\n/, 1)[0] || '';
  const cuenta = (c) => primera.split(c).length - 1;
  return [';', '\t', ','].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

export function leerCsv(texto) {
  const limpio = String(texto).replace(/^﻿/, '');
  const sep = separadorDe(limpio);
  const filas = [];
  let fila = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (comillas) {
      if (c === '"' && limpio[i + 1] === '"') {
        celda += '"';
        i++;
      } else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === sep) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && limpio[i + 1] === '\n') i++;
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else celda += c;
  }
  if (celda !== '' || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((x) => x.trim() !== ''));
}

const sinTildes = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// Nombres de columna que se aceptan para cada dato.
const COLUMNAS = {
  nombre: ['nombre', 'producto', 'descripcion', 'articulo', 'referencia', 'item'],
  precio: ['precio', 'valor', 'precio venta', 'precio unitario', 'costo', 'precio de venta', 'valor unitario'],
  ml: ['ml', 'tamano', 'contenido', 'volumen', 'presentacion ml'],
  unidades: ['unidades', 'cantidad por empaque', 'und', 'unidades por caja', 'empaque'],
  ean: ['ean', 'codigo', 'codigo de barras', 'barras', 'upc'],
  disponible: ['disponible', 'hay', 'stock', 'existencia'],
  precioAntes: ['precio antes', 'antes', 'precio normal'],
  nota: ['nota', 'observacion', 'observaciones'],
};

// Filas de un CSV de proveedor → productos { nombre, precio, ml, unidades, ean, disponible }.
// Con encabezado se usan sus nombres; sin encabezado, la primera columna es el
// nombre y la segunda el precio.
export function productosDeCsv(texto) {
  const filas = leerCsv(texto);
  if (!filas.length) return { productos: [], columnas: {} };
  const cabeza = filas[0].map(sinTildes);
  const indice = {};
  for (const [campo, nombres] of Object.entries(COLUMNAS)) {
    const i = cabeza.findIndex((c) => nombres.includes(c));
    if (i >= 0) indice[campo] = i;
  }
  const conCabeza = indice.nombre !== undefined && indice.precio !== undefined;
  if (!conCabeza) Object.assign(indice, { nombre: 0, precio: 1 });
  const datos = conCabeza ? filas.slice(1) : filas;
  const productos = datos
    .map((f) => Object.fromEntries(Object.entries(indice).map(([campo, i]) => [campo, (f[i] ?? '').trim()])))
    .filter((p) => p.nombre && p.precio);
  return { productos, columnas: indice, conCabeza };
}

export function escribirCsv(filas) {
  const celda = (v) => {
    const texto = v === null || v === undefined ? '' : String(v);
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  // Punto y coma y BOM: así Excel en español lo abre en columnas y con tildes.
  return '﻿' + filas.map((f) => f.map(celda).join(';')).join('\r\n');
}

// Lista de precios pegada como texto (de WhatsApp, por ejemplo), una línea por
// producto con el precio al final: "Antioqueño 750 ml ...... $41.500".
// Si el texto trae columnas (pegado desde Excel), se lee como CSV.
export function productosDeTexto(texto) {
  const lineas = String(texto).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lineas.some((l) => l.includes('\t') || l.split(';').length > 1)) return productosDeCsv(texto);
  const productos = [];
  for (const l of lineas) {
    // Viñetas o numeración al comienzo ("- ", "• ", "3) "), sin comerse un nombre como "1800 Reposado".
    const sinVineta = l.replace(/^(?:[-•*]\s*|\d{1,2}[.)]\s+)/, '');
    const m = sinVineta.match(/^(.+?)[\s:=–—.-]*\$\s*(\d[\d.,]{2,})\s*$/) || sinVineta.match(/^(.+?)[\s:=–—.-]+(\d{1,3}(?:[.,]\d{3})+|\d{4,})\s*$/);
    if (m) productos.push({ nombre: m[1].trim(), precio: m[2] });
  }
  return { productos, columnas: { nombre: 0, precio: 1 }, conCabeza: false };
}

// "$ 45.900" / "45,900" / "45900.5" → 45900 / 45900 / 45900.5 (null si no es un número).
export function numeroDe(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return s !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

// Tamaño en ml que dice el nombre ("750 ml", "1 litro", "1.75 L").
function mlDe(nombre) {
  const m = String(nombre).match(/(\d+(?:[.,]\d+)?)\s*(ml|cc|litros?|lts?|l)(?![a-z])/i);
  if (!m) return null;
  const enMl = /^(ml|cc)$/i.test(m[2]);
  let n = m[1];
  if (enMl && /^\d{1,2}[.,]\d{3}$/.test(n)) n = n.replace(/[.,]/, '');
  const ml = parseFloat(n.replace(',', '.')) * (enMl ? 1 : 1000);
  return ml >= 50 && ml <= 20000 ? Math.round(ml) : null;
}

// Producto leído de un archivo o de lo pegado, con números de verdad.
export function normalizarProducto(p) {
  const unidades = numeroDe(p.unidades) || Number(String(p.nombre).match(/\bx\s*(\d{1,2})\b/i)?.[1]) || 1;
  return {
    ...p,
    precio: numeroDe(p.precio),
    ml: numeroDe(p.ml) || mlDe(p.nombre),
    unidades,
    disponible: p.disponible === undefined || p.disponible === '' ? true : !/^(no|0|false|agotado)$/i.test(String(p.disponible).trim()),
  };
}
