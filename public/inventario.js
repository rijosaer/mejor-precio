// Inventario y ventas del negocio de reventa. Funciones puras: las usan el
// navegador (catálogo y vista Ventas) y el servidor (src/inventario.js), que
// guarda los movimientos.

export const TIPOS_MOVIMIENTO = ['compra', 'venta', 'ajuste'];

// Recorre los movimientos en orden y devuelve, por producto de la lista, las
// unidades que quedan y el costo promedio ponderado de lo comprado.
// - compra: suma unidades y recalcula el costo promedio.
// - venta: resta unidades (el costo promedio no cambia).
// - ajuste: fija las unidades contadas a mano (el costo promedio no cambia).
export function inventarioDe(movimientos = []) {
  const salida = {};
  for (const m of [...movimientos].sort((a, b) => a.t - b.t)) {
    const x = salida[m.item] || (salida[m.item] = { unidades: 0, costoPromedio: null, vendidas: 0, compradas: 0 });
    if (m.tipo === 'compra') {
      const antes = Math.max(0, x.unidades);
      x.costoPromedio = x.costoPromedio === null || antes === 0 ? m.precio : (antes * x.costoPromedio + m.cantidad * m.precio) / (antes + m.cantidad);
      x.unidades += m.cantidad;
      x.compradas += m.cantidad;
    } else if (m.tipo === 'venta') {
      x.unidades -= m.cantidad;
      x.vendidas += m.cantidad;
    } else if (m.tipo === 'ajuste') {
      x.unidades = m.cantidad;
    }
  }
  return salida;
}

// Costo promedio de un producto justo antes de `t` (para guardar el costo de
// una venta en el momento en que se hizo).
export function costoEn(movimientos, item, t) {
  return inventarioDe(movimientos.filter((m) => m.item === item && m.t <= t))[item]?.costoPromedio ?? null;
}

const mesDe = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Ventas por mes: ingresos, costo de lo vendido y ganancia (sin comisiones).
export function ventasPorMes(movimientos = []) {
  const meses = new Map();
  for (const m of movimientos) {
    if (m.tipo !== 'venta') continue;
    const clave = mesDe(m.t);
    const x = meses.get(clave) || { mes: clave, ingresos: 0, costo: 0, ganancia: 0, unidades: 0, sinCosto: 0 };
    const ingreso = m.cantidad * m.precio;
    x.ingresos += ingreso;
    x.unidades += m.cantidad;
    if (Number.isFinite(m.costo)) {
      x.costo += m.cantidad * m.costo;
      x.ganancia += ingreso - m.cantidad * m.costo;
    } else x.sinCosto += m.cantidad;
    meses.set(clave, x);
  }
  return [...meses.values()].sort((a, b) => (a.mes < b.mes ? 1 : -1));
}

// Productos que más rotan en los últimos `dias`: unidades vendidas y ganancia.
export function rotacion(movimientos = [], ahora = Date.now(), dias = 30) {
  const desde = ahora - dias * 24 * 60 * 60 * 1000;
  const porItem = new Map();
  for (const m of movimientos) {
    if (m.tipo !== 'venta' || m.t < desde) continue;
    const x = porItem.get(m.item) || { item: m.item, unidades: 0, ingresos: 0, ganancia: 0 };
    x.unidades += m.cantidad;
    x.ingresos += m.cantidad * m.precio;
    if (Number.isFinite(m.costo)) x.ganancia += m.cantidad * (m.precio - m.costo);
    porItem.set(m.item, x);
  }
  return [...porItem.values()].sort((a, b) => b.unidades - a.unidades || b.ganancia - a.ganancia);
}
