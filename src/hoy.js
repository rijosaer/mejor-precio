// «Hoy»: lo que pide atención, junto, para la pantalla de inicio. La plata que
// se pierde por precios bajo el costo, lo que hay que pedir, el inventario en
// negativo, los precios por aprobar, las ofertas de los últimos dos días, cómo
// está el WhatsApp y el historial de lo que se avisó (y qué se hizo).
import { leer } from './almacen.js';
import { estadoMiTienda } from './mitienda.js';
import { novedades } from './monitor.js';
import { leerWhatsapp } from './whatsapp.js';

const COMPRA = new Set(['oferta', 'dulce', 'umbral', 'volvio']);
const DIAS_OFERTAS = 2;

// Lo de Mi tienda a partir de su estado (sin red, para poder probarlo).
export function resumirTienda(estado) {
  const productos = estado.productos || [];
  const bajoCosto = productos
    .filter((p) => p.trivo?.bajoCosto && p.trivo.costo > p.precio)
    .map((p) => {
      const pierde = p.trivo.costo - p.precio;
      const vendidos = p.trivo.ventas?.unidades || 0;
      return { id: p.id, nombre: p.nombre, precio: p.precio, costo: p.trivo.costo, pierde, vendidos, perdida: pierde * vendidos };
    })
    .sort((a, b) => b.perdida - a.perdida || b.pierde - a.pierde);
  const porPedir = productos
    .filter((p) => p.trivo?.fuente === 'directo' && p.trivo.bajo)
    .map((p) => ({ id: p.id, nombre: p.nombre, existencias: p.trivo.existencias, minimo: p.trivo.minimo ?? null, vendidos: p.trivo.ventas?.unidades || 0 }))
    .sort((a, b) => b.vendidos - a.vendidos);
  const negativos = productos
    .filter((p) => p.trivo?.fuente === 'directo' && p.trivo.existencias < 0)
    .map((p) => ({ id: p.id, nombre: p.nombre, existencias: p.trivo.existencias }))
    .sort((a, b) => a.existencias - b.existencias);
  return {
    bajoCosto,
    perdida30: bajoCosto.reduce((t, x) => t + x.perdida, 0),
    diasVentas: estado.trivo?.dias ?? 30,
    porPedir,
    negativos,
    propuestas: (estado.propuestas || []).length,
    trivo: estado.trivo ? { t: estado.trivo.t, error: estado.trivo.error } : null,
  };
}

// Qué pasó con cada precio avisado: aplicado (y si fue desde WhatsApp),
// descartado o todavía pendiente.
export function conDesenlace(historial, propuestas, cambios) {
  const pendientes = new Set(propuestas.map((p) => p.id));
  return historial.map((h) => {
    if (!h.avisos) return h;
    const avisos = h.avisos.map((a) => {
      if (!a.propuestas?.length) return a;
      const desenlaces = a.propuestas.map((id) => {
        const cambio = cambios.find((c) => c.producto === id && c.t >= h.t && c.motivo !== 'deshacer');
        if (cambio) return { id, estado: 'aplicado', via: cambio.via || 'app', t: cambio.t, nombre: cambio.nombre, despues: cambio.despues };
        return { id, estado: pendientes.has(id) ? 'pendiente' : 'descartado' };
      });
      return { ...a, desenlaces };
    });
    return { ...h, avisos };
  });
}

export async function hoy({ ahora = Date.now() } = {}) {
  const [estado, nuevas, wa, historial] = await Promise.all([
    estadoMiTienda().catch((e) => ({ error: e.message, productos: [] })),
    novedades(ahora - DIAS_OFERTAS * 24 * 60 * 60_000).catch(() => ({ alertas: [] })),
    leerWhatsapp(),
    leer('avisos-historial'),
  ]);
  const ofertas = nuevas.alertas
    .filter((a) => COMPRA.has(a.tipo))
    .slice(0, 6)
    .map(({ tipo, nombre, tienda, precio, antes, a, umbral, unidades, tuUnidad, q, t }) => ({ tipo, nombre, tienda, precio, antes: antes ?? a ?? null, umbral: umbral ?? null, unidades: unidades ?? 1, tuUnidad: tuUnidad ?? null, q, t }));
  return {
    ahora,
    miTienda: estado.miTienda ? resumirTienda(estado) : null,
    errorTienda: estado.error || null,
    ofertas,
    whatsapp: { servidor: wa.servidor, activo: wa.activo, numero: Boolean(wa.numero), ultimo: wa.ultimo, error: wa.error },
    historial: conDesenlace((historial || []).slice(0, 30), estado.propuestas || [], estado.historial || []),
  };
}
