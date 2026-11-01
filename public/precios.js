// Precio de venta sugerido para los productos de Mi tienda. Función pura: la
// usan la vista Mi tienda y los tests.
//
// Referencia del mercado: el más barato de las demás tiendas con el mismo
// paquete; si nadie vende ese paquete, el precio por unidad más barato del
// mismo tamaño multiplicado por las unidades (una caja de 24 contra cuatro six pack).
//
// Regla (configurable en la vista):
//   sobreMinimo   % sobre (o bajo, si es negativo) la referencia del mercado.
//   recargoFria   % extra permitido para las frías (variante «Fría»).
//   tolerancia    % de diferencia por debajo del cual no vale la pena cambiar.
//   margenMin     % mínimo sobre el costo, si se conoce el costo.
//   redondeo      múltiplo al que se redondea el precio.

export const REGLA_POR_DEFECTO = { sobreMinimo: 0, recargoFria: 10, tolerancia: 3, margenMin: 15, redondeo: 100 };

export function limpiarRegla(r = {}) {
  const n = (v, porDefecto, min, max) => {
    const x = Number(v);
    return v === '' || v === null || v === undefined || !Number.isFinite(x) ? porDefecto : Math.min(max, Math.max(min, x));
  };
  return {
    sobreMinimo: n(r.sobreMinimo, REGLA_POR_DEFECTO.sobreMinimo, -50, 100),
    recargoFria: n(r.recargoFria, REGLA_POR_DEFECTO.recargoFria, 0, 100),
    tolerancia: n(r.tolerancia, REGLA_POR_DEFECTO.tolerancia, 0, 50),
    margenMin: n(r.margenMin, REGLA_POR_DEFECTO.margenMin, 0, 300),
    redondeo: [50, 100, 500, 1000].includes(Number(r.redondeo)) ? Number(r.redondeo) : REGLA_POR_DEFECTO.redondeo,
  };
}

const redondear = (v, paso) => Math.round(v / paso) * paso;

// producto:  { precio, unidades, variante, valorHielo }  (valorHielo: lo que vale
//            en tu carta el hielo que trae una caja «+ hielo»; se descuenta para
//            comparar con cajas sin hielo y se vuelve a sumar al sugerido)
// resultado: { referencia: { precio, fuente, tienda } , ... }  o null
// costo:     costo de compra del producto entero, o null
export function sugerirPrecio(producto, resultado, costo, reglaEntrada) {
  const regla = limpiarRegla(reglaEntrada);
  const hielo = Number(producto.valorHielo) || 0;
  const comparable = producto.precio - hielo;
  const ref = resultado?.referencia?.precio;
  const fria = /fr[ií]a/i.test(producto.variante || '');
  const piso = costo > 0 ? costo * (1 + regla.margenMin / 100) : null;
  const margen = costo > 0 ? ((producto.precio - costo) / producto.precio) * 100 : null;
  const base = { comparable, referencia: ref ?? null, margen, piso: piso ? redondear(piso + hielo, regla.redondeo) : null };

  if (!(ref > 0)) {
    // Sin mercado: solo se puede cuidar el margen.
    if (piso && producto.precio < piso) {
      const sugerido = Math.ceil(piso / regla.redondeo) * regla.redondeo;
      return { ...base, estado: 'perdida', accion: 'subir', sugerido, cambio: ((sugerido - producto.precio) / producto.precio) * 100, motivo: 'sin-mercado-bajo-costo' };
    }
    return { ...base, estado: 'sin-mercado', accion: 'mantener', sugerido: null, motivo: 'sin-mercado' };
  }

  const diferencia = ((comparable - ref) / ref) * 100; // + = estás más caro que el mercado
  let objetivo = ref * (1 + (regla.sobreMinimo + (fria ? regla.recargoFria : 0)) / 100);
  let motivo = 'mercado';
  if (piso && objetivo < piso) {
    objetivo = piso;
    motivo = 'costo';
  }
  const sugerido = redondear(objetivo + hielo, regla.redondeo);
  const cambio = ((sugerido - producto.precio) / producto.precio) * 100;
  let accion = 'mantener';
  if (Math.abs(cambio) >= regla.tolerancia) accion = cambio > 0 ? 'subir' : 'bajar';
  const estado = piso && producto.precio < piso ? 'perdida' : diferencia > regla.tolerancia ? 'caro' : diferencia < -regla.tolerancia ? 'barato' : 'en-mercado';
  return { ...base, diferencia, estado, accion, sugerido: accion === 'mantener' ? producto.precio : sugerido, cambio: accion === 'mantener' ? 0 : cambio, motivo };
}

// Existencias y ventas de TRIVO de un producto de Mi tienda, en frases cortas.
// t: { fuente, existencias, alcanza, bajo, ventas: { unidades, pedidos, todasLasVariantes } }
export function resumenInventario(t, dias = 30) {
  if (!t) return null;
  const miles = (n) => Math.round(n).toLocaleString('es-CO');
  const r = { existencias: null, ventas: null, cobertura: null, bajo: Boolean(t.bajo), agotado: false };
  if (t.fuente === 'calculado' && t.existencias !== null && t.existencias !== undefined) {
    r.existencias = `${miles(t.existencias)} latas en TRIVO · alcanzan para ${miles(t.alcanza ?? 0)}`;
    r.agotado = !(t.alcanza > 0);
  } else if (t.existencias !== null && t.existencias !== undefined) {
    r.existencias = `${miles(t.existencias)} en existencia`;
    r.agotado = !(t.existencias > 0);
  }
  const v = t.ventas;
  if (v) {
    r.ventas = v.unidades > 0
      ? `${miles(v.unidades)} vendidos en ${dias} días (${miles(v.pedidos)} ${v.pedidos === 1 ? 'pedido' : 'pedidos'})${v.todasLasVariantes ? ', todas las variantes' : ''}`
      : `Sin ventas en ${dias} días`;
    // Días que dura lo que hay al ritmo de venta (solo si es el mismo producto).
    if (v.unidades > 0 && t.fuente === 'directo' && !v.todasLasVariantes && t.existencias > 0) r.cobertura = Math.round(t.existencias / (v.unidades / dias));
  }
  return r;
}

// ── Precio con tu margen (como lo calcula TRIVO) ────────────────────────────
// TRIVO cuenta el margen sobre el precio de venta: precio = costo ÷ (1 − margen %)
// (y margen = (precio − costo) ÷ precio). Aquí además:
//   - las «Fría» llevan el recargo de las frías de tu regla;
//   - si el producto tiene una promo de valor fijo (Envío gratis −8.000), se
//     suma para que lo que paga el cliente siga dejando tu margen;
//   - se redondea SIEMPRE hacia arriba a la centena: 3.215 → 3.300, 3.200 → 3.200.
export const MARGEN_POR_DEFECTO = 20;

export const centenaArriba = (v) => Math.ceil(Math.round(v * 100) / 100 / 100) * 100;

export function limpiarMargen(v) {
  const n = Number(v);
  return v === '' || v === null || v === undefined || !Number.isFinite(n) || n < 0 || n >= 90 ? null : n;
}

export function precioConMargen(costo, margen, { fria = false, recargoFria = 0, descuento = 0 } = {}) {
  const m = limpiarMargen(margen);
  if (!(costo > 0) || m === null) return null;
  const base = (costo / (1 - m / 100)) * (fria ? 1 + recargoFria / 100 : 1);
  return centenaArriba(base + (descuento > 0 ? descuento : 0));
}

// Margen real (sobre el precio que paga el cliente), como lo muestra TRIVO.
export const margenSobrePrecio = (precio, costo) => (precio > 0 && costo > 0 ? ((precio - costo) / precio) * 100 : null);
