// Proveedores propios: distribuidores sin página web cuyos precios conocemos
// (lista de precios por WhatsApp, factura, visita). Se crean a mano o se
// importan desde un CSV y entran a la comparación como una tienda más.
import { actualizar, leer } from './almacen.js';
import { codigoBarras, extraerMl, extraerUnidades, repararNombre } from './normalizar.js';

export const MAX_PROVEEDORES = 20;
export const MAX_PRODUCTOS = 1500;

const texto = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const numero = (v) => {
  if (v === null || v === undefined || v === '') return null;
  // "$ 45.900" / "45,900" / "45900.5" → 45900 / 45900 / 45900.5
  let s = String(v).replace(/[^\d.,-]/g, '');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function limpiarProducto(p) {
  const nombre = repararNombre(texto(p?.nombre, 140));
  const precio = numero(p?.precio);
  if (nombre.length < 2 || !(precio > 0) || precio > 1e9) return null;
  const ml = numero(p?.ml);
  const unidades = numero(p?.unidades);
  return {
    nombre,
    precio,
    precioAntes: numero(p?.precioAntes) > precio ? numero(p.precioAntes) : null,
    ml: ml >= 50 && ml <= 20000 ? Math.round(ml) : extraerMl(nombre),
    unidades: Number.isInteger(unidades) && unidades >= 1 && unidades <= 60 ? unidades : extraerUnidades(nombre),
    disponible: p?.disponible === undefined || p?.disponible === null || p?.disponible === '' ? true : !/^(no|0|false|agotado)$/i.test(String(p.disponible).trim()),
    ean: codigoBarras(p?.ean),
    nota: texto(p?.nota, 80) || null,
  };
}

export function limpiarProveedor(x) {
  const id = String(x?.id || '');
  const nombre = texto(x?.nombre, 40);
  if (!/^[\w-]{1,40}$/.test(id)) throw new TypeError('Identificador de proveedor no válido');
  if (nombre.length < 2) throw new TypeError('Escribe el nombre del proveedor');
  if (!Array.isArray(x.productos)) throw new TypeError('Los productos deben ser una lista');
  const productos = x.productos.map(limpiarProducto).filter(Boolean);
  if (productos.length > MAX_PRODUCTOS) throw new RangeError(`Un proveedor admite hasta ${MAX_PRODUCTOS} productos`);
  const contacto = texto(x.contacto, 80);
  return {
    id,
    nombre,
    alcance: texto(x.alcance, 60) || 'Proveedor propio',
    contacto: contacto || null,
    activo: x.activo === undefined ? true : Boolean(x.activo),
    actualizado: Number(x.actualizado) || Date.now(),
    productos,
  };
}

export async function leerProveedores() {
  return (await leer('proveedores')) || [];
}

export async function guardarProveedor(datos) {
  const p = limpiarProveedor(datos);
  return actualizar('proveedores', (actual) => {
    const lista = (actual || []).filter((x) => x.id !== p.id);
    if (lista.length >= MAX_PROVEEDORES) throw new RangeError(`Se admiten hasta ${MAX_PROVEEDORES} proveedores`);
    return [...lista, p].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  });
}

export async function borrarProveedor(id) {
  return actualizar('proveedores', (actual) => (actual || []).filter((x) => x.id !== id));
}

// Cada proveedor activo se ve como una tienda para el comparador: `buscar`
// devuelve su lista entera y el comparador filtra como con las demás.
export const idTienda = (p) => `prov-${p.id}`;

export function comoTienda(p) {
  const id = idTienda(p);
  return {
    tienda: { id, nombre: p.nombre, web: null, alcance: p.alcance, propio: true, contacto: p.contacto, actualizado: p.actualizado },
    buscar: async () =>
      p.productos.map((x) => ({
        ...x,
        stock: null,
        // Sin página: el historial se separa por el nombre del producto.
        url: null,
        imagen: null,
      })),
  };
}
