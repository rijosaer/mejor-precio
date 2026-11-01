// Movimientos de inventario (compras, ventas y ajustes) de los productos de
// Mi lista. El inventario no se guarda: se calcula de los movimientos, así un
// teléfono con la lista vieja no puede pisar lo que registró el otro. Cada
// movimiento guarda el nombre del producto: si se quita de la lista, las
// ventas siguen contando en el resumen del mes.
import { randomUUID } from 'node:crypto';
import { actualizar, leer } from './almacen.js';
import { costoEn, TIPOS_MOVIMIENTO } from '../public/inventario.js';

const MAX_MOVIMIENTOS = 5000;

export async function leerMovimientos() {
  return (await leer('movimientos')) || [];
}

export function limpiarMovimiento(m, ids) {
  const item = String(m?.item || '');
  const tipo = String(m?.tipo || '');
  const cantidad = Number(m?.cantidad);
  const precio = m?.precio === undefined || m?.precio === null || m?.precio === '' ? 0 : Number(m.precio);
  const t = m?.t === undefined ? Date.now() : Number(m.t);
  if (!ids.has(item)) throw new TypeError('Ese producto no está en Mi lista');
  if (!TIPOS_MOVIMIENTO.includes(tipo)) throw new TypeError('Tipo de movimiento no válido');
  const minimo = tipo === 'ajuste' ? 0 : 1;
  if (!Number.isInteger(cantidad) || cantidad < minimo || cantidad > 100_000) throw new RangeError('Cantidad no válida');
  if (!Number.isFinite(precio) || precio < 0 || precio > 1e9) throw new RangeError('Precio no válido');
  if (tipo !== 'ajuste' && !(precio > 0)) throw new RangeError('Escribe el precio');
  if (!Number.isFinite(t) || t < Date.UTC(2020, 0, 1) || t > Date.now() + 86_400_000) throw new RangeError('Fecha no válida');
  const nota = String(m?.nota || '').slice(0, 120);
  return { item, tipo, cantidad, precio, t, ...(nota ? { nota } : {}) };
}

export async function registrarMovimiento(datos, lista) {
  const m = limpiarMovimiento(datos, new Set(lista.map((x) => x.id)));
  m.id = randomUUID();
  m.nombre = lista.find((x) => x.id === m.item).q;
  const movimientos = await actualizar('movimientos', (actual) => {
    const todos = actual || [];
    // La venta guarda el costo promedio de ese momento: la ganancia no cambia
    // si después se compra más caro.
    if (m.tipo === 'venta') m.costo = costoEn(todos, m.item, m.t);
    return [...todos, m].sort((a, b) => a.t - b.t).slice(-MAX_MOVIMIENTOS);
  });
  return { movimiento: m, movimientos };
}

export async function borrarMovimiento(id) {
  return actualizar('movimientos', (actual) => (actual || []).filter((m) => m.id !== id));
}
