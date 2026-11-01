// Mi pedido: en qué tiendas comprar varios productos para pagar menos en
// total, contando el envío (o el traslado) y el pedido mínimo de cada tienda.
// Función pura: la usa la vista Pedido y la prueban los tests.
//
// items:   [{ id, nombre, cantidad, ofertas: [{ tienda, tiendaNombre, precio, disponible, url }] }]
// llegada: (tiendaId, subtotal) → costo de envío/traslado, o null si el
//          subtotal no alcanza el pedido mínimo de esa tienda.
//
// Se prueban todas las combinaciones de tiendas (hasta 12 tiendas: 4.096
// combinaciones) y en cada una cada producto va a la tienda más barata de la
// combinación. Gana la de menor total.

const MAX_TIENDAS = 12;

export function optimizarPedido(items, llegada = () => 0) {
  const conOferta = items.filter((x) => x.cantidad > 0 && x.ofertas?.some((o) => o.disponible && o.precio > 0));
  const sinOferta = items.filter((x) => x.cantidad > 0 && !conOferta.includes(x));
  const nombres = new Map();
  const veces = new Map();
  for (const x of conOferta) {
    for (const o of x.ofertas) {
      if (!o.disponible || !(o.precio > 0)) continue;
      nombres.set(o.tienda, o.tiendaNombre || o.tienda);
      veces.set(o.tienda, (veces.get(o.tienda) || 0) + 1);
    }
  }
  const tiendas = [...veces.keys()].sort((a, b) => veces.get(b) - veces.get(a)).slice(0, MAX_TIENDAS);

  let mejor = null;
  for (let mascara = 1; mascara < 1 << tiendas.length; mascara++) {
    const elegidas = new Set(tiendas.filter((_, i) => mascara & (1 << i)));
    const plan = armar(conOferta, elegidas, llegada, nombres);
    if (plan && (!mejor || plan.total < mejor.total || (plan.total === mejor.total && plan.tiendas.length < mejor.tiendas.length))) mejor = plan;
  }

  // Para comparar: todo en una sola tienda (la más barata que lo tenga todo).
  let unaTienda = null;
  for (const t of tiendas) {
    const plan = armar(conOferta, new Set([t]), llegada, nombres);
    if (plan && (!unaTienda || plan.total < unaTienda.total)) unaTienda = plan;
  }
  return {
    plan: mejor,
    unaTienda,
    ahorro: mejor && unaTienda ? Math.max(0, unaTienda.total - mejor.total) : 0,
    sinOferta,
  };
}

function armar(items, elegidas, llegada, nombres) {
  const porTienda = new Map();
  for (const x of items) {
    let oferta = null;
    for (const o of x.ofertas) {
      if (!o.disponible || !(o.precio > 0) || !elegidas.has(o.tienda)) continue;
      if (!oferta || o.precio < oferta.precio) oferta = o;
    }
    if (!oferta) return null; // esta combinación no cubre todos los productos
    const t = porTienda.get(oferta.tienda) || { tienda: oferta.tienda, tiendaNombre: nombres.get(oferta.tienda), items: [], subtotal: 0, envio: 0 };
    t.items.push({ id: x.id, nombre: x.nombre, cantidad: x.cantidad, precio: oferta.precio, url: oferta.url ?? null });
    t.subtotal += oferta.precio * x.cantidad;
    porTienda.set(oferta.tienda, t);
  }
  // Una tienda elegida que no recibe productos sobra: esa combinación ya se prueba sin ella.
  if (porTienda.size !== elegidas.size) return null;
  let total = 0;
  for (const t of porTienda.values()) {
    const costo = llegada(t.tienda, t.subtotal);
    if (costo === null || costo === undefined || !Number.isFinite(costo)) return null;
    t.envio = costo;
    total += t.subtotal + costo;
  }
  const tiendas = [...porTienda.values()].sort((a, b) => b.subtotal - a.subtotal);
  return { total, productos: tiendas.reduce((s, t) => s + t.subtotal, 0), envios: tiendas.reduce((s, t) => s + t.envio, 0), tiendas };
}
