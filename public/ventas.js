// Ventas: ganancia por mes, productos que más rotan y los últimos
// movimientos de inventario (con opción de borrar un error).
import { escribirCsv } from './csv.js';
import { inventarioDe, rotacion, ventasPorMes } from './inventario.js';
import { borrarMovimiento, cargarMovimientos, listaLeer, movimientosGuardados } from './sync.js';
import { $, boton, descargar, el, fechaLarga, pesos } from './util.js';

const nombreMes = (clave) => {
  const [a, m] = clave.split('-').map(Number);
  return new Date(a, m - 1, 1).toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
};

function nombreDe(itemId, movs) {
  return listaLeer().find((x) => x.id === itemId)?.q || movs.find((m) => m.item === itemId && m.nombre)?.nombre || 'Producto quitado de la lista';
}

export function pintarVentas() {
  const movs = movimientosGuardados();
  const caja = $('#ventas-contenido');
  caja.replaceChildren();
  $('#ventas-exportar').disabled = !movs.length;
  if (!movs.length) {
    caja.append(el('p', 'ayuda', 'Todavía no hay movimientos. En Catálogo, cada producto que vendes tiene los botones «Compré», «Vendí» y «Contar».'));
    return;
  }
  const meses = ventasPorMes(movs);
  const resumen = el('div', 'cat-resumen');
  const actual = meses[0];
  const dato = (valor, texto, clase = '') => {
    const d = el('div', `cat-dato ${clase}`);
    d.append(el('b', '', valor), el('span', '', texto));
    resumen.append(d);
  };
  if (actual) {
    dato(pesos.format(actual.ingresos), `vendido en ${nombreMes(actual.mes)}`);
    dato(pesos.format(Math.round(actual.ganancia)), 'ganancia (sin comisiones)', actual.ganancia < 0 ? 'perdida' : '');
    dato(String(actual.unidades), 'unidades vendidas');
  }
  const inv = inventarioDe(movs);
  const valorInventario = Object.values(inv).reduce((s, x) => s + Math.max(0, x.unidades) * (x.costoPromedio || 0), 0);
  dato(pesos.format(Math.round(valorInventario)), 'en inventario (al costo)');
  caja.append(resumen);

  if (meses.length) {
    const bloque = el('div', 'panel-salida');
    bloque.append(el('p', 'panel-titulo', 'Por mes'));
    for (const m of meses.slice(0, 12)) {
      const f = el('div', `salida-linea ${m.ganancia >= 0 ? 'positivo' : 'negativo'}`);
      f.append(el('span', '', `${nombreMes(m.mes)} · ${m.unidades} u. · ${pesos.format(m.ingresos)}`), el('b', '', pesos.format(Math.round(m.ganancia))));
      bloque.append(f);
      if (m.sinCosto) bloque.append(el('p', 'ayuda', `${m.sinCosto} u. vendidas sin compra registrada antes: no cuentan en la ganancia.`));
    }
    caja.append(bloque);
  }

  const top = rotacion(movs);
  if (top.length) {
    const bloque = el('div', 'panel-salida');
    bloque.append(el('p', 'panel-titulo', 'Los que más rotan (30 días)'));
    for (const x of top.slice(0, 8)) {
      const f = el('div', 'salida-linea');
      f.append(el('span', '', `${nombreDe(x.item, movs)} · ${x.unidades} u.`), el('b', '', pesos.format(Math.round(x.ganancia))));
      bloque.append(f);
    }
    caja.append(bloque);
  }

  const lista = el('div', 'panel-salida');
  lista.append(el('p', 'panel-titulo', 'Últimos movimientos'));
  const TEXTO = { compra: 'Compra', venta: 'Venta', ajuste: 'Conteo' };
  for (const m of [...movs].sort((a, b) => b.t - a.t).slice(0, 30)) {
    const f = el('div', 'salida-linea mov');
    const detalle = m.tipo === 'ajuste' ? `${m.cantidad} u. contadas` : `${m.cantidad} × ${pesos.format(m.precio)}`;
    f.append(el('span', '', `${TEXTO[m.tipo]} · ${nombreDe(m.item, movs)} · ${detalle} · ${fechaLarga(m.t)}`));
    f.append(boton('Borrar', 'mini', async () => {
      if (!confirm('¿Borrar este movimiento?')) return;
      await borrarMovimiento(m.id).catch(() => {});
      pintarVentas();
    }));
    lista.append(f);
  }
  caja.append(lista);
}

function exportar() {
  const movs = movimientosGuardados();
  const filas = [['fecha', 'tipo', 'producto', 'cantidad', 'precio', 'costo', 'ganancia']];
  for (const m of [...movs].sort((a, b) => a.t - b.t)) {
    const ganancia = m.tipo === 'venta' && Number.isFinite(m.costo) ? (m.precio - m.costo) * m.cantidad : '';
    filas.push([new Date(m.t).toISOString().slice(0, 10), m.tipo, nombreDe(m.item, movs), m.cantidad, m.precio || '', m.costo ?? '', ganancia]);
  }
  descargar(`movimientos-${new Date().toISOString().slice(0, 10)}.csv`, escribirCsv(filas), 'text/csv;charset=utf-8');
}

export async function abrirVentas() {
  pintarVentas();
  await cargarMovimientos();
  pintarVentas();
}

export function configurarVentas() {
  $('#ventas-exportar').addEventListener('click', exportar);
}
