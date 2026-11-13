// Tienda pública (versión 2): el pedido completo se arma aquí. «+» mete
// productos (escogiendo la presentación si hay varias); «Tu pedido» muestra en
// una sola hoja los productos, la entrega, el pago y el total; el pedido se
// manda a la tienda por el servidor (/api/tienda/*) y después se ve en qué va
// («Mis pedidos»). También: el buscador al instante, las pestañas Unidad / Six
// pack / Caja, si la tienda está abierta, y el paso al panel para quien abre la
// app instalada o un enlace viejo de los avisos («/#mitienda», «/?q=…»).
const VISTAS_PANEL = /^#(mitienda|lista|catalogo|pedido|ventas|proveedores|ajustes|estado)$/;
const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const alPanel = () => {
  const enInicio = location.pathname === '/';
  if (enInicio && (instalada || VISTAS_PANEL.test(location.hash) || new URLSearchParams(location.search).has('q'))) {
    location.replace(`/panel${location.search}${location.hash}`);
  }
};
alPanel();
addEventListener('hashchange', alPanel);

const normal = (texto) =>
  String(texto || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// ── Utilidades ──────────────────────────────────────────────────────────────
const D = (() => {
  try {
    return JSON.parse(document.getElementById('t-datos')?.textContent || 'null');
  } catch {
    return null;
  }
})();

const guardado = {
  leer(clave, defecto) {
    try {
      const x = localStorage.getItem(clave);
      return x ? JSON.parse(x) : defecto;
    } catch {
      return defecto;
    }
  },
  poner(clave, valor) {
    try {
      if (valor == null) localStorage.removeItem(clave);
      else localStorage.setItem(clave, JSON.stringify(valor));
    } catch {
      /* sin almacenamiento: el pedido vive mientras la página esté abierta */
    }
  },
};

const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
const plata = (n) => pesos.format(n).replace(/\s/g, '');

function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const hijo of hijos.flat()) if (hijo != null && hijo !== false && hijo !== '') el.append(hijo instanceof Node ? hijo : String(hijo));
  return el;
}

const icono = (d) => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
};
const ICONO = {
  bolsa: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2',
  cerrar: 'M6 6l12 12M18 6 6 18',
  menos: 'M6 12h12',
  mas: 'M12 6v12M6 12h12',
  ubicacion: 'M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12Zm0-9.7a2.3 2.3 0 1 0 0-4.6 2.3 2.3 0 0 0 0 4.6Z',
  flecha: 'M5 12h14M13 6l6 6-6 6',
  atras: 'M19 12H5M11 6l-6 6 6 6',
  listo: 'M5 12.5 10 17l9-10',
  pedidos: 'M7 3.5h10a1 1 0 0 1 1 1V20l-2.5-1.5L13 20l-2.5-1.5L8 20l-2-1.2V4.5a1 1 0 0 1 1-1ZM9 8h6M9 12h6',
};

const nuevaClave = () =>
  crypto.randomUUID?.() ?? [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function api(ruta, cuerpo) {
  const res = await fetch(`/api/tienda/${ruta}`, cuerpo ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cuerpo) } : {});
  let datos = {};
  try {
    datos = await res.json();
  } catch {
    /* vacío */
  }
  if (!res.ok) throw Object.assign(new Error(datos.error || 'No se pudo completar'), { datos, estado: res.status });
  return datos;
}

// ── ¿Abierta? (lo mismo que calcula el servidor, con el dato de ahora) ─────
const horaTexto = (hhmm) => {
  const [h24, m] = String(hhmm).split(':').map(Number);
  if (h24 === 0 && !m) return 'medianoche';
  if (h24 === 12 && !m) return 'mediodía';
  return `las ${((h24 + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${h24 < 12 ? 'a. m.' : 'p. m.'}`;
};
const minutos = (hhmm) => {
  const [hh, m] = String(hhmm).split(':').map(Number);
  return hh * 60 + (m || 0);
};
function ahoraEnBogota() {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bogota', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(Date.now())
      .map((p) => [p.type, p.value]),
  );
  return { dia: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(partes.weekday), min: Number(partes.hour) * 60 + Number(partes.minute) };
}
function estadoTienda(abierto, semana) {
  const { dia, min } = ahoraEnBogota();
  const hoy = semana?.[dia];
  if (abierto) return { abierto: true, texto: hoy && minutos(hoy[1]) !== minutos(hoy[0]) ? `Abierto hasta ${horaTexto(hoy[1])}` : 'Abierto ahora' };
  if (hoy && min < minutos(hoy[0])) return { abierto: false, texto: `Cerrado · abre hoy a ${horaTexto(hoy[0])}` };
  const manana = semana?.[(dia + 1) % 7];
  return { abierto: false, texto: manana ? `Cerrado · abre mañana a ${horaTexto(manana[0])}` : 'Cerrado ahora' };
}

// Lo que la caja necesita (medios de pago, si está abierta, el domicilio): una vez por página.
let cajaInfo = null;
const leerCaja = () => (cajaInfo ||= api('caja').catch((e) => ((cajaInfo = null), Promise.reject(e))));

function pintarEstado(abierto) {
  const marca = document.querySelector('[data-estado]');
  if (!marca || !D || abierto == null) return;
  const e = estadoTienda(abierto, D.semana);
  marca.textContent = e.texto;
  marca.classList.toggle('t-cerrada', !e.abierto);
}

// ── Pestañas Unidad / Six pack / Caja y filtros de las listas ──────────────
function iniciarListas() {
  const pestanas = document.querySelector('[data-pestanas]');
  const filtros = document.querySelector('[data-filtros]');
  if (!pestanas && !filtros) return;
  const productos = [...document.querySelectorAll('.t-principal .t-prod')];
  const listas = [...document.querySelectorAll('.t-principal .t-lista')];
  const original = new Map(listas.map((ul) => [ul, [...ul.children]]));
  const vacio = document.querySelector('[data-vacio]');
  let grupo = '';
  let soloOferta = false;
  let porPrecio = false;

  const aplicar = () => {
    for (const li of productos) li.hidden = (grupo !== '' && li.dataset.grupo !== grupo) || (soloOferta && !li.hasAttribute('data-oferta'));
    for (const ul of listas) {
      const orden = porPrecio ? [...original.get(ul)].sort((a, b) => Number(a.dataset.precio) - Number(b.dataset.precio)) : original.get(ul);
      ul.append(...orden);
      ul.closest('.t-grupo')?.toggleAttribute('hidden', !ul.querySelector('.t-prod:not([hidden])'));
    }
    for (const s of document.querySelectorAll('[data-seccion]')) s.hidden = !s.querySelector('.t-prod:not([hidden])');
    if (vacio) vacio.hidden = productos.some((li) => !li.hidden);
  };

  if (pestanas) {
    pestanas.hidden = false;
    pestanas.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-grupo]');
      if (!b) return;
      grupo = b.dataset.grupo;
      for (const x of pestanas.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      aplicar();
    });
  }
  if (filtros) {
    filtros.hidden = false;
    filtros.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const activo = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(activo));
      if (b.hasAttribute('data-orden-precio')) porPrecio = activo;
      if (b.hasAttribute('data-solo-oferta')) soloOferta = activo;
      aplicar();
    });
  }
}
iniciarListas();

// ── Buscador al instante ────────────────────────────────────────────────────
const svgTexto = (d) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function tarjetaProducto(id, p) {
  const li = h('li', { class: `t-prod${p.ok ? '' : ' t-no'}` });
  const foto = h('a', { class: 't-prod-foto', href: p.u, tabindex: -1, 'aria-hidden': 'true' }, p.f ? h('img', { src: p.f, alt: '', width: 400, height: 400, loading: 'lazy' }) : h('span', { class: 't-sinfoto' }));
  if (p.a) foto.append(h('span', { class: 't-sello' }, 'Oferta'));
  const precio = h('p', { class: 't-prod-precio' }, p.v.length > 1 && new Set(p.v.map((v) => v.p)).size > 1 ? h('small', {}, 'Desde') : '', h('strong', {}, plata(p.p)), p.a ? h('del', {}, plata(p.a)) : '');
  const boton = p.ok ? h('a', { class: 't-mas', href: p.u, 'data-agregar': id, 'aria-label': `Agregar ${p.n}` }) : h('span', { class: 't-agotado' }, 'Agotado');
  if (p.ok) boton.innerHTML = svgTexto(ICONO.mas);
  li.append(
    foto,
    h(
      'div',
      { class: 't-prod-texto' },
      h('h3', { class: 't-prod-nombre' }, h('a', { href: p.u }, p.n)),
      h('p', { class: 't-prod-detalle' }, p.v.length > 1 ? p.v.map((v) => v.n).join(' · ') : p.s),
      h('div', { class: 't-prod-pie' }, precio, boton),
    ),
  );
  return li;
}

function iniciarBuscador() {
  const campo = document.getElementById('t-q');
  const principal = document.querySelector('.t-principal > .t-ancho');
  if (!campo || !principal || !D?.productos) return;
  const indice = Object.entries(D.productos).map(([id, p]) => ({ id, p, texto: normal(`${p.n} ${p.s}`) }));
  const caja = h('section', { class: 't-resultados', 'aria-live': 'polite', hidden: true });
  principal.prepend(caja);
  const inicial = campo.value;
  let temporizador;
  const buscar = () => {
    const texto = campo.value.trim();
    const palabras = normal(texto).split(/\s+/).filter(Boolean);
    // En /productos?buscar=… el servidor ya muestra esos resultados.
    if (!palabras.length || texto === inicial) {
      caja.hidden = true;
      document.body.classList.remove('t-buscando');
      return;
    }
    const hallados = indice.filter((x) => palabras.every((w) => x.texto.includes(w))).sort((a, b) => b.p.ok - a.p.ok);
    const wa = D.whatsapp ? `https://wa.me/${D.whatsapp}?text=${encodeURIComponent(`Hola ${D.marca}, ¿tienen ${texto}?`)}` : null;
    caja.replaceChildren(
      h('div', { class: 't-titulo' }, h('h2', {}, `Resultados para «${texto}»`), h('p', {}, `${hallados.length} ${hallados.length === 1 ? 'producto' : 'productos'}`)),
      hallados.length
        ? h('ul', { class: 't-rejilla' }, hallados.slice(0, 60).map((x) => tarjetaProducto(x.id, x.p)))
        : h('p', { class: 't-vacio' }, 'No encontramos ese producto. ', wa ? h('a', { href: wa, target: '_blank', rel: 'noopener' }, 'Pregúntanos por WhatsApp') : ''),
    );
    caja.hidden = false;
    document.body.classList.add('t-buscando');
  };
  campo.addEventListener('input', () => {
    clearTimeout(temporizador);
    temporizador = setTimeout(buscar, 120);
  });
  campo.form?.addEventListener('submit', (e) => {
    if (!campo.value.trim() || campo.value.trim() === inicial) return;
    e.preventDefault();
    buscar();
    campo.blur();
  });
  campo.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      campo.value = inicial;
      buscar();
    }
  });
}
iniciarBuscador();

// ── Carrusel de promociones: pasa solo cada 6 s y se detiene cuando lo usan ─
function iniciarCarrusel() {
  const caja = document.querySelector('[data-carrusel]');
  const pista = caja?.querySelector('[data-pista]');
  const control = caja?.querySelector('[data-control]');
  if (!pista || !control) return;
  const total = pista.children.length;
  const puntos = [...control.querySelectorAll('[data-punto]')];
  const pausa = control.querySelector('[data-pausa]');
  const quieto = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let actual = 0;
  let pausado = quieto; // con «reducir movimiento» no pasa solo (se puede activar)
  let enUso = false; // el cliente lo está mirando, tocando o recorriendo con el teclado
  control.hidden = false;

  const marcar = () => puntos.forEach((p, i) => p.setAttribute('aria-current', String(i === actual)));
  const ir = (i) => {
    actual = (i + total) % total;
    pista.scrollTo({ left: actual * pista.clientWidth, behavior: quieto ? 'auto' : 'smooth' });
    marcar();
  };
  const pintarPausa = () => {
    pausa.innerHTML = svgTexto(pausado ? 'M8 5.5v13l11-6.5-11-6.5Z' : 'M9 6v12M15 6v12');
    pausa.setAttribute('aria-label', pausado ? 'Pasar las promociones solas' : 'Pausar las promociones');
  };

  // Al deslizar con el dedo, el punto sigue a la promoción que quedó a la vista.
  let tiempo;
  pista.addEventListener(
    'scroll',
    () => {
      clearTimeout(tiempo);
      tiempo = setTimeout(() => {
        actual = Math.round(pista.scrollLeft / pista.clientWidth);
        marcar();
      }, 90);
    },
    { passive: true },
  );
  control.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.punto) ir(Number(b.dataset.punto));
    else if (b.dataset.paso) ir(actual + Number(b.dataset.paso));
    else if (b === pausa) {
      pausado = !pausado;
      pintarPausa();
    }
  });
  caja.addEventListener('pointerenter', () => (enUso = true));
  caja.addEventListener('pointerleave', () => (enUso = false));
  caja.addEventListener('focusin', () => (enUso = true));
  caja.addEventListener('focusout', () => (enUso = false));
  pista.addEventListener('touchstart', () => (enUso = true), { passive: true });
  pista.addEventListener('touchend', () => setTimeout(() => (enUso = false), 4000), { passive: true });
  addEventListener('resize', () => pista.scrollTo({ left: actual * pista.clientWidth }));
  setInterval(() => {
    if (!pausado && !enUso && !document.hidden) ir(actual + 1);
  }, 6000);
  pintarPausa();
}
iniciarCarrusel();

// ── El pedido ───────────────────────────────────────────────────────────────
if (D?.productos) iniciarPedido(D);

function iniciarPedido(D) {
  const CLAVE_CARRITO = 'ap-carrito';
  const CLAVE_CLIENTE = 'ap-cliente';
  const CLAVE_ULTIMO = 'ap-ultimo';
  const DOCE_HORAS = 12 * 3600_000;

  // Cada línea: producto, presentación y cantidad. El nombre y el precio salen
  // siempre de la carta de hoy (si cambió en la tienda, aquí ya cambió).
  let carrito = guardado.leer(CLAVE_CARRITO, []).filter((l) => D.productos[l.id] && l.c > 0);
  let clavePedido = null;

  const info = (l) => {
    const p = D.productos[l.id];
    const v = p.v.find((x) => x.id === l.v) || null;
    return { p, v, precio: v ? v.p : p.p, nombre: p.n, presentacion: v && p.v.length > 1 ? v.n : null };
  };
  const vigentes = () => carrito.filter((l) => D.productos[l.id]?.ok && (!D.productos[l.id].v.length || info(l).v));
  const subtotal = () => vigentes().reduce((n, l) => n + info(l).precio * l.c, 0);
  const unidades = () => vigentes().reduce((n, l) => n + l.c, 0);

  function guardar() {
    guardado.poner(CLAVE_CARRITO, carrito);
    clavePedido = null; // el pedido cambió: si se manda, es otro
    pintarBarra();
  }

  function agregar(id, v, c = 1) {
    const l = carrito.find((x) => x.id === id && x.v === v);
    if (l) l.c = Math.min(99, l.c + c);
    else carrito.push({ id, v, c: Math.min(99, c) });
    guardar();
  }

  function cambiar(l, c) {
    if (c <= 0) carrito = carrito.filter((x) => x !== l);
    else l.c = Math.min(99, c);
    guardar();
  }

  const ultimo = () => {
    const u = guardado.leer(CLAVE_ULTIMO, null);
    return u && Date.now() - u.t < DOCE_HORAS ? u : null;
  };

  // ── Encabezado: «Tu pedido», «Mis pedidos», a dónde se entrega, abierta ──
  const botonCab = document.querySelector('[data-abrir-pedido]');
  const textoCab = document.querySelector('[data-pedido-texto]');
  const numeroCab = document.querySelector('[data-pedido-n]');
  const misPedidos = document.querySelectorAll('[data-mis-pedidos]');
  if (botonCab) {
    botonCab.hidden = false;
    botonCab.addEventListener('click', () => abrir(vistaPedido));
  }
  for (const b of misPedidos) {
    b.hidden = false;
    b.addEventListener('click', () => abrir(vistaMisPedidos));
  }
  const cliente = guardado.leer(CLAVE_CLIENTE, {});
  if (cliente.direccion) {
    const titulo = document.querySelector('[data-entregar-titulo]');
    const lugar = document.querySelector('[data-entregar]');
    if (titulo && lugar) {
      titulo.textContent = 'Entregar en';
      lugar.textContent = cliente.direccion;
    }
  }
  pintarEstado(D.abierto);
  leerCaja()
    .then((c) => pintarEstado(c.abierto))
    .catch(() => {});

  // ── Barra «Ver mi pedido» y aviso de «agregado» ─────────────────────────
  const barra = h('button', { type: 'button', class: 't-carrito', hidden: true });
  const avisoFlotante = h('div', { class: 't-flotante', role: 'status', 'aria-live': 'polite' });
  document.body.append(barra, avisoFlotante);

  function pintarBarra() {
    const n = unidades();
    const u = ultimo();
    barra.replaceChildren();
    if (n) {
      barra.append(h('span', { class: 't-carrito-n' }, String(n)), h('span', {}, 'Ver mi pedido'), h('strong', {}, plata(subtotal())));
      barra.onclick = () => abrir(vistaPedido);
    } else if (u && !u.final) {
      barra.append(icono(ICONO.pedidos), h('span', {}, `${u.referencia} · ver en qué va`));
      barra.onclick = () => abrir(() => vistaListo(u));
    }
    barra.hidden = !barra.childElementCount;
    document.body.classList.toggle('t-con-carrito', !barra.hidden);
    if (textoCab) textoCab.textContent = n ? `Tu pedido · ${plata(subtotal())}` : 'Tu pedido';
    if (numeroCab) {
      numeroCab.hidden = !n;
      numeroCab.textContent = String(n);
    }
    botonCab?.setAttribute('aria-label', n ? `Tu pedido: ${n} ${n === 1 ? 'producto' : 'productos'}, ${plata(subtotal())}` : 'Tu pedido');
  }

  let temporizadorAviso;
  function avisar(texto) {
    avisoFlotante.replaceChildren(h('span', {}, texto), h('button', { type: 'button', onclick: () => abrir(vistaPedido) }, 'Ver pedido'));
    avisoFlotante.classList.add('t-visible');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => avisoFlotante.classList.remove('t-visible'), 3200);
  }

  // ── La hoja (dialog) donde pasa todo ────────────────────────────────────
  const titulo = h('h2', { id: 't-hoja-titulo' });
  const subtitulo = h('small', {});
  const cuerpo = h('div', { class: 't-hoja-cuerpo' });
  const pieHoja = h('div', { class: 't-hoja-pie' });
  const atras = h('button', { type: 'button', class: 't-hoja-icono', 'aria-label': 'Volver', hidden: true }, icono(ICONO.atras));
  const hoja = h(
    'dialog',
    { class: 't-hoja-pedido', 'aria-labelledby': 't-hoja-titulo' },
    h('div', { class: 't-hoja-cabeza' }, atras, h('div', {}, titulo, subtitulo), h('button', { type: 'button', class: 't-hoja-icono', 'aria-label': 'Cerrar', onclick: () => hoja.close() }, icono(ICONO.cerrar))),
    cuerpo,
    pieHoja,
  );
  document.body.append(hoja);
  hoja.addEventListener('click', (e) => e.target === hoja && hoja.close());
  let alCerrar = null;
  hoja.addEventListener('close', () => {
    alCerrar?.();
    alCerrar = null;
    document.documentElement.classList.remove('t-sin-scroll');
  });

  function abrir(vista) {
    alCerrar?.();
    alCerrar = null;
    vista();
    if (!hoja.open) {
      hoja.showModal();
      document.documentElement.classList.add('t-sin-scroll');
    }
    cuerpo.scrollTop = 0;
  }

  function armar({ texto, sub = '', volver, contenido, pie, dos = false }) {
    titulo.textContent = texto;
    subtitulo.textContent = sub;
    subtitulo.hidden = !sub;
    atras.hidden = !volver;
    atras.onclick = volver || null;
    cuerpo.classList.toggle('t-dos', dos);
    cuerpo.replaceChildren(...[contenido].flat().filter(Boolean));
    pieHoja.replaceChildren(...[pie].flat().filter(Boolean));
    pieHoja.hidden = !pieHoja.childElementCount;
  }

  const contador = (valor, alCambiar, etiqueta) => {
    const n = h('output', { 'aria-live': 'polite' }, String(valor));
    return h(
      'div',
      { class: 't-contador', role: 'group', 'aria-label': etiqueta },
      h('button', { type: 'button', 'aria-label': 'Quitar uno', onclick: () => alCambiar(-1, n) }, icono(ICONO.menos)),
      n,
      h('button', { type: 'button', 'aria-label': 'Agregar uno', onclick: () => alCambiar(1, n) }, icono(ICONO.mas)),
    );
  };

  const mini = (p) => (p.f ? h('img', { class: 't-mini', src: p.f, alt: '', width: 56, height: 56, loading: 'lazy' }) : h('span', { class: 't-mini' }));
  const tarjeta = (clase, ...hijos) => h('section', { class: `t-tarjeta${clase ? ` ${clase}` : ''}` }, ...hijos);

  // Escoger la presentación (Caliente / Fría…) y cuántas.
  function vistaEscoger(id) {
    const p = D.productos[id];
    let escogida = p.v[0];
    let cuantas = 1;
    const boton = h('button', { type: 'button', class: 't-boton t-grande t-ancho-total' });
    const pintarBoton = () => (boton.textContent = `Agregar · ${plata(escogida.p * cuantas)}`);
    const temperatura = p.v.every((v) => /^(fr[ií]a|caliente|al clima|natural|helada)$/i.test(v.n));
    const opciones = h(
      'fieldset',
      { class: 't-opciones' },
      h('legend', {}, temperatura ? 'Temperatura' : 'Presentación'),
      h(
        'div',
        {},
        p.v.map((v, i) =>
          h(
            'label',
            { class: 't-opcion' },
            h('input', { type: 'radio', name: 't-escoger', value: v.id, checked: i === 0, onchange: () => ((escogida = v), pintarBoton()) }),
            h('span', {}, v.n),
            h('b', {}, plata(v.p)),
          ),
        ),
      ),
    );
    boton.onclick = () => {
      agregar(id, escogida.id, cuantas);
      hoja.close();
      avisar(`Agregaste ${cuantas} × ${p.n} (${escogida.n})`);
    };
    pintarBoton();
    armar({
      texto: 'Agregar al pedido',
      sub: p.n,
      contenido: tarjeta(
        '',
        h('div', { class: 't-entrega-resumen' }, mini(p), h('p', {}, h('strong', {}, p.n), h('span', {}, p.s))),
        opciones,
        h('div', { class: 't-tarjeta-cab' }, h('h3', {}, 'Cantidad'), contador(cuantas, (d, n) => ((cuantas = Math.max(1, Math.min(99, cuantas + d))), (n.textContent = String(cuantas)), pintarBoton()), 'Cantidad')),
      ),
      pie: boton,
    });
  }

  function textoWhatsapp(datos = {}) {
    const lineas = vigentes().map((l) => {
      const x = info(l);
      return `• ${l.c} × ${x.nombre}${x.presentacion ? ` (${x.presentacion})` : ''} — ${plata(x.precio * l.c)}`;
    });
    return [
      `Hola ${D.marca}, quiero pedir:`,
      ...lineas,
      `Subtotal: ${plata(subtotal())}`,
      '',
      datos.nombre ? `Nombre: ${datos.nombre}` : null,
      datos.celular ? `Celular: ${datos.celular}` : null,
      datos.direccion ? `Dirección: ${datos.direccion}${datos.indicaciones ? ` (${datos.indicaciones})` : ''}` : 'Mi dirección es: ',
      datos.lat ? `Ubicación: https://maps.google.com/?q=${datos.lat},${datos.lng}` : null,
      datos.pago ? `Pago: ${datos.pago}` : null,
    ]
      .filter((x) => x !== null)
      .join('\n');
  }

  const botonWhatsapp = (datos) =>
    D.whatsapp
      ? h('a', { class: 't-boton t-wa t-grande t-ancho-total', href: `https://wa.me/${D.whatsapp}?text=${encodeURIComponent(textoWhatsapp(datos))}`, target: '_blank', rel: 'noopener' }, 'Enviar el pedido por WhatsApp')
      : '';

  const sinProductos = (caidas) =>
    armar({
      texto: 'Tu pedido',
      contenido: h(
        'div',
        { class: 't-vacio-pedido' },
        icono(ICONO.bolsa),
        h('strong', {}, 'Todavía no has agregado productos'),
        h('p', {}, caidas ? 'Quitamos lo que se agotó o ya no está en la carta.' : 'Toca «+» en un producto para agregarlo.'),
      ),
      pie: h('a', { class: 't-boton t-grande t-ancho-total', href: '/productos' }, 'Ver productos'),
    });

  // «Tu pedido»: productos, entrega, pago y total en una sola hoja; «Hacer
  // pedido» lo manda a la tienda.
  function vistaPedido() {
    const lineasHoy = vigentes();
    const caidas = carrito.length - lineasHoy.length;
    if (caidas) {
      carrito = lineasHoy;
      guardar();
    }
    if (!lineasHoy.length) return sinProductos(caidas > 0);

    const previo = guardado.leer(CLAVE_CLIENTE, {});
    const ubic = { lat: null, lng: null };
    // El domicilio de la sucursal mientras se calcula el de la dirección.
    let domicilio = D.envio != null ? { valor: D.envio, base: true } : null;
    let enviando = false;

    // Productos.
    const lista = h('ul', { class: 't-lineas' });
    const avisoMinimo = h('p', { class: 't-alerta', hidden: true });
    const pintarLineas = () => {
      const ls = vigentes();
      if (!ls.length) return vistaPedido();
      lista.replaceChildren(
        ...ls.map((l) => {
          const x = info(l);
          return h(
            'li',
            {},
            mini(x.p),
            h('div', { class: 't-linea-texto' }, h('a', { href: x.p.u }, x.nombre), x.presentacion ? h('small', {}, x.presentacion) : '', h('strong', {}, plata(x.precio * l.c))),
            contador(l.c, (d) => (cambiar(l, l.c + d), pintarLineas()), `Cantidad de ${x.nombre}`),
          );
        }),
      );
      subtitulo.textContent = `${unidades()} ${unidades() === 1 ? 'producto' : 'productos'} · ${D.marca}`;
      const falta = Math.max(0, (D.minimo || 0) - subtotal());
      avisoMinimo.hidden = !falta;
      avisoMinimo.textContent = falta ? `El pedido mínimo es ${plata(D.minimo)}: te faltan ${plata(falta)}.` : '';
      pintarTotales();
      cotizar();
    };

    // Entrega: con los datos de la vez pasada se ve el resumen y «Cambiar».
    const campoTexto = (id, etiqueta, atributos) =>
      h('div', { class: 't-campo' }, h('label', { for: id }, etiqueta), h(atributos.filas ? 'textarea' : 'input', { id, ...atributos, filas: null, rows: atributos.filas }));
    const fNombre = campoTexto('t-nombre', 'Nombre', { type: 'text', autocomplete: 'name', required: true, maxlength: 80, value: previo.nombre || '' });
    const fCelular = campoTexto('t-celular', 'Celular', { type: 'tel', inputmode: 'numeric', autocomplete: 'tel-national', required: true, maxlength: 16, placeholder: '300 123 4567', value: previo.celular || '' });
    const fDireccion = campoTexto('t-direccion', 'Dirección de entrega', { type: 'text', autocomplete: 'street-address', required: true, maxlength: 200, placeholder: 'Calle 16 # 9-20, barrio Centro', value: previo.direccion || '' });
    const fIndicaciones = campoTexto('t-indicaciones', 'Indicaciones (opcional)', { filas: 2, maxlength: 300, placeholder: 'Casa, apartamento, punto de referencia…' });
    fIndicaciones.querySelector('textarea').value = previo.indicaciones || '';
    const valor = (f) => f.querySelector('input, textarea').value.trim();

    const estadoUbic = h('p', { class: 't-nota', 'aria-live': 'polite' }, 'Así el domiciliario llega directo.');
    const botonUbic = h('button', { type: 'button', class: 't-ubicar' }, icono(ICONO.ubicacion), 'Usar mi ubicación');
    const quitarUbicacion = (aviso) => {
      ubic.lat = null;
      ubic.lng = null;
      botonUbic.classList.remove('t-marcada');
      estadoUbic.textContent = aviso;
      estadoUbic.classList.add('t-fuera');
      cotizar();
    };
    botonUbic.onclick = () => {
      if (!navigator.geolocation) return (estadoUbic.textContent = 'Este navegador no comparte la ubicación. Escribe la dirección.');
      botonUbic.disabled = true;
      estadoUbic.classList.remove('t-fuera');
      estadoUbic.textContent = 'Buscando tu ubicación…';
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          ubic.lat = pos.coords.latitude;
          ubic.lng = pos.coords.longitude;
          botonUbic.disabled = false;
          botonUbic.classList.add('t-marcada');
          estadoUbic.textContent = 'Ubicación marcada. Escribe también la dirección con número.';
          try {
            const r = await api('ubicacion', ubic);
            // Solo hay domicilios en la ciudad de la tienda: si el GPS marca otra, la ubicación no se usa.
            if (r.enZona === false) return quitarUbicacion(`${r.error} Si el pedido es para una dirección en ${D.ciudad}, escríbela abajo.`);
            if (r.direccion) estadoUbic.textContent = `Ubicación marcada: ${r.direccion}. Escribe también la dirección con número.`;
            const input = fDireccion.querySelector('input');
            if (!input.value.trim() && r.direccion && r.precision !== 'area') input.value = r.direccion;
          } catch {
            /* la ubicación se revisa otra vez al hacer el pedido */
          }
          cotizar();
        },
        (error) => {
          botonUbic.disabled = false;
          estadoUbic.textContent = error.code === 1 ? 'No diste permiso para la ubicación. Escribe la dirección.' : 'No pudimos ubicarte. Escribe la dirección.';
        },
        // Siempre la ubicación de ahora (con ella se revisa que el domicilio sea en la ciudad).
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      );
    };

    const formEntrega = h('div', { class: 't-hoja-col' }, h('div', { class: 't-dos-campos' }, fNombre, fCelular), botonUbic, estadoUbic, fDireccion, fIndicaciones);
    const completo = previo.nombre && previo.celular && previo.direccion;
    const resumenEntrega = h(
      'div',
      { class: 't-entrega-resumen' },
      icono(ICONO.ubicacion),
      h(
        'p',
        {},
        h('strong', {}, previo.direccion || ''),
        h('span', {}, [previo.indicaciones, previo.nombre, previo.celular].filter(Boolean).join(' · ')),
        D.tiempo ? h('span', {}, `Llega en ${D.tiempo}`) : '',
      ),
    );
    const botonCambiar = h('button', { type: 'button', class: 't-chip' }, 'Cambiar');
    const editarEntrega = () => {
      resumenEntrega.hidden = true;
      botonCambiar.hidden = true;
      formEntrega.hidden = false;
    };
    botonCambiar.onclick = () => {
      editarEntrega();
      fDireccion.querySelector('input').focus();
    };
    resumenEntrega.hidden = !completo;
    botonCambiar.hidden = !completo;
    formEntrega.hidden = Boolean(completo);

    // Pago (los mismos medios de la tienda).
    const pagos = h('div', { class: 't-pagos', role: 'radiogroup', 'aria-label': 'Método de pago' }, h('p', { class: 't-nota' }, 'Cargando medios de pago…'));
    const cuenta = h('div', { class: 't-cuenta-pago', hidden: true });
    let pagoId = previo.pago || null;
    const pintarCuenta = () => {
      const m = cajaInfo?.pagos?.find?.((x) => x.id === pagoId);
      cuenta.hidden = !(m && m.cuenta && /transfer|wallet/.test(m.tipo));
      if (cuenta.hidden) return;
      const copiar = h('button', { type: 'button', class: 't-enlace' }, 'Copiar');
      copiar.onclick = () => navigator.clipboard?.writeText(m.cuenta).then(() => (copiar.textContent = 'Copiado'));
      cuenta.replaceChildren(h('span', {}, `Transfiere a ${m.nombre}:`), h('strong', {}, m.cuenta), copiar, h('small', {}, 'Después de pedir, envías el comprobante por WhatsApp.'));
    };

    // Totales y botón.
    const filaProductos = h('span', {});
    const valorProductos = h('strong', {});
    const filaDomicilio = h('strong', {});
    const filaTotal = h('strong', {});
    const avisoCerrado = h('p', { class: 't-alerta', hidden: true });
    const error = h('p', { class: 't-error', role: 'alert', hidden: true });
    const respaldo = h('div', { hidden: true });
    const boton = h('button', { type: 'submit', class: 't-boton t-marca t-grande t-ancho-total', form: 't-form-pedido' });
    let cerrada = false;

    function pintarTotales() {
      const sub = subtotal();
      const total = sub + (domicilio?.valor || 0);
      filaProductos.textContent = `Productos (${unidades()})`;
      valorProductos.textContent = plata(sub);
      filaDomicilio.textContent = domicilio ? (domicilio.valor ? plata(domicilio.valor) : 'Gratis') : 'Con tu dirección';
      filaTotal.textContent = plata(total);
      boton.textContent = enviando ? 'Enviando…' : `Hacer pedido · ${plata(total)}`;
      boton.disabled = enviando || cerrada || sub < (D.minimo || 0);
    }

    let temporizador;
    let turno = 0;
    function cotizar() {
      clearTimeout(temporizador);
      const direccion = valor(fDireccion);
      if (direccion.length < 5 && ubic.lat === null) return;
      temporizador = setTimeout(async () => {
        const mio = ++turno;
        try {
          const r = await api('domicilio', { direccion, lat: ubic.lat, lng: ubic.lng, subtotal: subtotal() });
          if (mio === turno) domicilio = r;
        } catch {
          if (mio === turno) domicilio = D.envio != null ? { valor: D.envio, base: true } : null;
        }
        pintarTotales();
      }, 600);
    }
    fDireccion.querySelector('input').addEventListener('input', cotizar);

    const form = h(
      'form',
      { id: 't-form-pedido', class: 't-hoja-col', novalidate: true },
      tarjeta('', h('div', { class: 't-tarjeta-cab' }, h('h3', {}, 'Entrega'), botonCambiar), resumenEntrega, formEntrega),
      tarjeta('', h('h3', {}, '¿Cómo vas a pagar?'), pagos, cuenta),
      tarjeta(
        't-resumen',
        h('p', {}, filaProductos, valorProductos),
        h('p', {}, h('span', {}, 'Domicilio'), filaDomicilio),
        h('p', { class: 't-resumen-total' }, h('span', {}, 'Total'), filaTotal),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (enviando) return;
      const datos = { nombre: valor(fNombre), celular: valor(fCelular), direccion: valor(fDireccion), indicaciones: valor(fIndicaciones) };
      const faltan = [];
      if (datos.nombre.length < 2) faltan.push(['tu nombre', fNombre]);
      if (!/^(\+?57)?3\d{9}$/.test(datos.celular.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, ''))) faltan.push(['un celular de 10 dígitos', fCelular]);
      if (datos.direccion.length < 5) faltan.push(['la dirección', fDireccion]);
      if (cajaInfo?.pagos?.length && !pagoId) faltan.push(['cómo vas a pagar', pagos]);
      error.hidden = !faltan.length;
      if (faltan.length) {
        error.textContent = `Falta ${faltan.map((f) => f[0]).join(', ')}.`;
        if (faltan.some(([, f]) => f !== pagos)) editarEntrega();
        faltan[0][1].querySelector('input, textarea, button')?.focus();
        return;
      }
      guardado.poner(CLAVE_CLIENTE, { ...datos, pago: pagoId });
      clavePedido ||= nuevaClave();
      enviando = true;
      pintarTotales();
      const pago = cajaInfo?.pagos?.find?.((x) => x.id === pagoId);
      try {
        const r = await api('pedido', {
          clave: clavePedido,
          lineas: vigentes().map((l) => ({ id: l.id, variante: l.v, cantidad: l.c })),
          ...datos,
          lat: ubic.lat,
          lng: ubic.lng,
          pago: pagoId,
        });
        // El detalle queda guardado en el teléfono: la confirmación de la tienda no lo muestra.
        const lineas = vigentes().map((l) => {
          const x = info(l);
          return { cantidad: l.c, nombre: x.nombre, presentacion: x.presentacion, total: x.precio * l.c };
        });
        const sub = subtotal();
        const u = {
          ...r,
          transferencia: Boolean(pago && /transfer|wallet/.test(pago.tipo)),
          pago: pago?.nombre || null,
          t: Date.now(),
          tiempos: { 0: Date.now() },
          detalle: { lineas, subtotal: sub, domicilio: domicilio ? domicilio.valor : null, total: r.total || sub + (domicilio?.valor || 0) },
          entrega: { ...datos, ubicacion: ubic.lat !== null },
        };
        guardado.poner(CLAVE_ULTIMO, u);
        carrito = [];
        guardar();
        abrir(() => vistaListo(u));
      } catch (falla) {
        enviando = false;
        pintarTotales();
        error.hidden = false;
        error.textContent = falla.datos?.error || 'No pudimos enviar el pedido. Revisa tu conexión e intenta de nuevo.';
        if (falla.datos?.codigo === 'fuera_de_zona') {
          editarEntrega();
          quitarUbicacion(`${falla.datos.error} Si el pedido es para una dirección en ${D.ciudad}, escríbela abajo.`);
        }
        // Si la tienda no respondió (o no hay internet), el pedido sale completo por WhatsApp.
        const caida = falla.datos?.sinTrivo || !falla.estado;
        respaldo.hidden = !caida;
        if (caida) respaldo.replaceChildren(botonWhatsapp({ ...datos, ...ubic, pago: pago?.nombre }));
      }
    });

    const productos = tarjeta(
      '',
      h('h3', {}, 'Productos'),
      lista,
      h('a', { class: 't-linea-mas', href: '/productos', onclick: (e) => (location.pathname === '/productos' ? (e.preventDefault(), hoja.close()) : null) }, icono(ICONO.mas), 'Agregar más productos'),
    );

    // El aviso de cerrado y los errores van junto al botón: siempre a la vista.
    armar({
      texto: 'Tu pedido',
      sub: ' ',
      dos: true,
      contenido: [h('div', { class: 't-hoja-col' }, productos, avisoMinimo, D.enLinea ? '' : h('p', { class: 't-alerta' }, 'Los pedidos en línea están apagados en este momento. Puedes enviarlo por WhatsApp.')), form],
      pie: [avisoCerrado, error, respaldo, D.enLinea ? boton : botonWhatsapp(), h('button', { type: 'button', class: 't-enlace', onclick: () => hoja.close() }, 'Seguir comprando')],
    });
    pintarLineas();

    leerCaja()
      .then((c) => {
        if (!c.pagos.some((m) => m.id === pagoId)) pagoId = null;
        pagos.replaceChildren(
          ...c.pagos.map((m) =>
            h('label', { class: 't-pago' }, h('input', { type: 'radio', name: 't-pago', value: m.id, checked: m.id === pagoId, onchange: () => ((pagoId = m.id), pintarCuenta()) }), h('span', {}, m.nombre)),
          ),
        );
        if (!c.pagos.length) pagos.replaceChildren(h('p', { class: 't-nota' }, 'Acuerdas el pago con la tienda al recibir.'));
        pintarCuenta();
        pintarEstado(c.abierto);
        if (c.abierto === false) {
          cerrada = true;
          avisoCerrado.hidden = false;
          avisoCerrado.textContent = `La tienda está cerrada en este momento (${estadoTienda(false, D.semana).texto.replace(/^Cerrado · /, '')}). Tu pedido queda guardado aquí para enviarlo cuando abramos.`;
          pintarTotales();
        }
      })
      .catch(() => pagos.replaceChildren(h('p', { class: 't-nota' }, 'No cargaron los medios de pago. Intenta de nuevo en un momento.')));
  }

  const horaDe = (t) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(t);
  const horaCorta = (t) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }).format(t);

  // El detalle del pedido: productos, presentaciones, valores, entrega y pago.
  // Cuando la tienda devuelve su cuenta, los productos salen de ahí (lo que de
  // verdad registró); mientras tanto, lo que el cliente pidió.
  function detalleHtml(u, cuentaTienda) {
    const d = u.detalle;
    if (!d && !cuentaTienda) return '';
    const lineas = cuentaTienda?.lineas?.length ? cuentaTienda.lineas : d?.lineas || [];
    const total = cuentaTienda?.total || d?.total;
    const e = u.entrega || {};
    return tarjeta(
      't-detalle',
      h('h3', {}, 'Detalle del pedido'),
      h(
        'ul',
        { class: 't-detalle-lineas' },
        lineas.map((l) => h('li', {}, h('span', {}, h('b', {}, `${l.cantidad} ×`), ` ${l.nombre}`, l.presentacion ? h('small', {}, l.presentacion) : ''), h('strong', {}, plata(l.total)))),
      ),
      h(
        'div',
        { class: 't-resumen' },
        d && !cuentaTienda ? h('p', {}, h('span', {}, 'Productos'), h('strong', {}, plata(d.subtotal))) : '',
        d?.domicilio != null && !cuentaTienda ? h('p', {}, h('span', {}, 'Domicilio'), h('strong', {}, d.domicilio ? plata(d.domicilio) : 'Gratis')) : '',
        total ? h('p', { class: 't-resumen-total' }, h('span', {}, 'Total'), h('strong', {}, plata(total))) : '',
      ),
      h(
        'dl',
        { class: 't-detalle-datos' },
        e.nombre ? [h('dt', {}, 'Entregar a'), h('dd', {}, `${e.nombre}${e.celular ? ` · ${e.celular}` : ''}`)] : '',
        e.direccion ? [h('dt', {}, 'Dirección'), h('dd', {}, `${e.direccion}${e.indicaciones ? ` (${e.indicaciones})` : ''}${e.ubicacion ? ' · con ubicación GPS' : ''}`)] : '',
        u.pago ? [h('dt', {}, 'Pago'), h('dd', {}, u.pago)] : '',
        u.t ? [h('dt', {}, 'Hecho'), h('dd', {}, horaDe(u.t))] : '',
      ),
      cuentaTienda ? h('p', { class: 't-nota' }, 'Productos y total como los registró la tienda.') : '',
    );
  }

  // El mensaje para la tienda lleva el detalle completo.
  function mensajeTienda(u) {
    const d = u.detalle;
    const e = u.entrega || {};
    return [
      `Hola ${D.marca}, acabo de hacer el *${u.referencia}* en la página:`,
      ...(d?.lineas || []).map((l) => `• ${l.cantidad} × ${l.nombre}${l.presentacion ? ` (${l.presentacion})` : ''} — ${plata(l.total)}`),
      d?.total || u.total ? `Total: ${plata(u.total || d.total)}${u.pago ? ` · ${u.pago}` : ''}` : null,
      e.nombre ? `Entregar a: ${e.nombre}${e.direccion ? `, ${e.direccion}` : ''}` : null,
      u.transferencia ? 'Te envío el comprobante de pago.' : null,
    ]
      .filter((x) => x !== null)
      .join('\n');
  }

  // Seguimiento: en qué va el pedido (sin mapa: la tienda no comparte dónde va
  // el domiciliario), el detalle y cómo escribirle a la tienda.
  const PASOS = ['Recibido', 'En preparación', 'Listo para salir', 'En camino', 'Entregado'];
  function vistaListo(u) {
    u.tiempos ||= { 0: u.t };
    const estado = h('span', { class: 't-seg-estado', 'aria-live': 'polite' }, 'Recibido');
    const detalle = h('div', { class: 't-hoja-col' }, detalleHtml(u, u.cuentaTienda));
    const pasos = h(
      'ol',
      { class: 't-pasos' },
      PASOS.map((p) => h('li', {}, h('span', { class: 't-paso-punto' }, icono(ICONO.listo)), h('span', { class: 't-paso-texto' }, h('strong', {}, p), h('small', {})))),
    );
    const pintar = (s) => {
      estado.textContent = s.cancelado ? 'Pedido cancelado' : s.etiqueta;
      const etapa = Math.min(Number(s.etapa) || 0, PASOS.length - 1);
      if (!s.cancelado && !u.tiempos[etapa]) u.tiempos[etapa] = Date.now();
      [...pasos.children].forEach((li, i) => {
        li.classList.toggle('t-hecho', !s.cancelado && i <= etapa);
        li.classList.toggle('t-actual', !s.cancelado && i === etapa);
        li.querySelector('small').textContent = u.tiempos[i] && i <= etapa ? horaCorta(u.tiempos[i]) : '';
      });
      pasos.hidden = s.cancelado;
    };
    pintar(u.ultimoEstado || { etapa: 0, etiqueta: 'Recibido', cancelado: false });

    let reloj = null;
    const revisar = async () => {
      if (!u.uuid) return;
      try {
        const s = await api(`pedido/${u.uuid}`);
        u.ultimoEstado = { etapa: s.etapa, etiqueta: s.etiqueta, cancelado: s.cancelado };
        pintar(s);
        if (s.detalle?.lineas?.length) {
          u.cuentaTienda = s.detalle;
          detalle.replaceChildren(detalleHtml(u, s.detalle));
        }
        if (s.final) {
          clearInterval(reloj);
          u.final = true;
          pintarBarra();
        }
        guardado.poner(CLAVE_ULTIMO, u);
      } catch {
        /* se intenta en la próxima vuelta */
      }
    };
    if (!u.final) {
      revisar();
      reloj = setInterval(revisar, 15000);
      alCerrar = () => clearInterval(reloj);
    }

    const mensaje = mensajeTienda(u);
    const wa = u.whatsapp || D.whatsapp;
    const enlaceWa = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(mensaje)}` : null;
    armar({
      texto: u.final ? 'Tu último pedido' : 'Tu pedido',
      dos: true,
      contenido: [
        h(
          'div',
          { class: 't-hoja-col' },
          h('section', { class: 't-seg-hero' }, h('small', {}, `${u.referencia} · ${D.marca}`), estado, h('p', {}, `Hecho el ${horaDe(u.t)}`)),
          tarjeta('', h('h3', {}, 'Estado'), pasos),
          u.transferencia && !u.final ? h('p', { class: 't-alerta' }, 'Envía el comprobante de la transferencia por WhatsApp para despachar más rápido.') : '',
          enlaceWa
            ? tarjeta(
                't-ayuda',
                h('span', { class: 't-sigla', 'aria-hidden': 'true' }, D.sigla || ''),
                h('p', {}, h('strong', {}, '¿Dudas con tu pedido?'), h('span', {}, `Escríbele a ${D.marca} por WhatsApp.`)),
                h('a', { class: 't-boton t-wa', href: enlaceWa, target: '_blank', rel: 'noopener' }, 'Escribir'),
              )
            : '',
        ),
        detalle,
      ],
      pie: [
        u.transferencia && enlaceWa && !u.final ? h('a', { class: 't-boton t-marca t-grande t-ancho-total', href: enlaceWa, target: '_blank', rel: 'noopener' }, 'Enviar comprobante por WhatsApp') : '',
        h('button', { type: 'button', class: 't-enlace', onclick: () => hoja.close() }, 'Seguir comprando'),
      ],
    });
  }

  function vistaMisPedidos() {
    const u = ultimo();
    if (u) return vistaListo(u);
    armar({
      texto: 'Mis pedidos',
      contenido: h(
        'div',
        { class: 't-vacio-pedido' },
        icono(ICONO.pedidos),
        h('strong', {}, 'Todavía no tienes pedidos'),
        h('p', {}, 'Cuando hagas uno, aquí ves en qué va y su detalle.'),
      ),
      pie: h('a', { class: 't-boton t-grande t-ancho-total', href: '/productos' }, 'Ver productos'),
    });
  }

  // ── «+» en las tarjetas y «Agregar» en la página del producto ───────────
  const ficha = document.querySelector('.t-ficha-comprar[data-producto]');
  const pf = ficha && D.productos[ficha.dataset.producto];
  let cantidadFicha = 1;
  const precioFicha = () => {
    const marcada = document.querySelector('input[name="presentacion"]:checked');
    return marcada ? Number(marcada.dataset.precio) : pf.p;
  };

  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('[data-agregar]');
    if (!enlace) return;
    const id = Number(enlace.dataset.agregar);
    const p = D.productos[id];
    if (!p?.ok) return;
    e.preventDefault();
    if (enlace.closest('.t-ficha-comprar')) {
      const marcada = document.querySelector('input[name="presentacion"]:checked');
      const v = p.v.length ? Number(marcada?.value) || p.v[0].id : null;
      agregar(id, v, cantidadFicha);
      const x = info({ id, v });
      avisar(`Agregaste ${cantidadFicha} × ${p.n}${x.presentacion ? ` (${x.presentacion})` : ''}`);
      return;
    }
    if (p.v.length > 1) return abrir(() => vistaEscoger(id));
    agregar(id, p.v[0]?.id ?? null, 1);
    avisar(`Agregaste ${p.n}`);
  });

  // Página del producto: cantidad junto al botón y el precio de la presentación escogida.
  if (ficha && pf?.ok) {
    const boton = ficha.querySelector('[data-agregar]');
    const precio = document.querySelector('.t-ficha-precio [data-precio]');
    const desde = document.querySelector('.t-ficha-precio small');
    const pintarFicha = () => {
      boton.textContent = `Agregar · ${plata(precioFicha() * cantidadFicha)}`;
    };
    ficha.prepend(contador(cantidadFicha, (d, n) => ((cantidadFicha = Math.max(1, Math.min(99, cantidadFicha + d))), (n.textContent = String(cantidadFicha)), pintarFicha()), 'Cantidad'));
    for (const r of document.querySelectorAll('input[name="presentacion"]')) {
      r.addEventListener('change', () => {
        if (precio) precio.textContent = plata(Number(r.dataset.precio));
        if (desde) desde.hidden = true;
        pintarFicha();
      });
    }
    pintarFicha();
  }

  pintarBarra();
  addEventListener('storage', (e) => {
    if (e.key === CLAVE_CARRITO) {
      carrito = guardado.leer(CLAVE_CARRITO, []).filter((l) => D.productos[l.id] && l.c > 0);
      pintarBarra();
    }
  });
}
