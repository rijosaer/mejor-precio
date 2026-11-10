// Tienda pública: el pedido completo se arma aquí. «Agregar» mete productos
// (escogiendo la presentación si hay varias), «Mi pedido» pide los datos de
// entrega, el domicilio y el pago, y el pedido se manda a TRIVO por el servidor
// (/api/tienda/*). Después se ve en qué va. Sin JavaScript, «Agregar» abre la
// carta de TRIVO. También está el buscador y el paso al panel para quien abre
// la app instalada o un enlace viejo de los avisos («/#mitienda», «/?q=…»).
const VISTAS_PANEL = /^#(mitienda|lista|catalogo|pedido|ventas|proveedores|ajustes|estado)$/;
const instalada = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const alPanel = () => {
  if (instalada || VISTAS_PANEL.test(location.hash) || new URLSearchParams(location.search).has('q')) {
    location.replace(`/panel${location.search}${location.hash}`);
  }
};
alPanel();
addEventListener('hashchange', alPanel);

const normal = (texto) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

// ── Buscador ────────────────────────────────────────────────────────────────
const caja = document.querySelector('.t-buscar');
const campo = caja?.querySelector('input');
if (caja && campo) {
  caja.hidden = false;
  const productos = [...document.querySelectorAll('.t-producto')].map((li) => ({ li, texto: normal(li.dataset.buscar || '') }));
  const secciones = [...document.querySelectorAll('.t-seccion')];
  const rejillas = [...document.querySelectorAll('.t-rejilla')];
  const vacio = document.querySelector('.t-vacio');
  campo.addEventListener('input', () => {
    const palabras = normal(campo.value).split(/\s+/).filter(Boolean);
    for (const p of productos) p.li.hidden = !palabras.every((w) => p.texto.includes(w));
    for (const r of rejillas) {
      const vacia = !r.querySelector('.t-producto:not([hidden])');
      r.hidden = vacia;
      if (r.previousElementSibling?.classList.contains('t-subgrupo')) r.previousElementSibling.hidden = vacia;
    }
    for (const s of secciones) s.hidden = !s.querySelector('.t-producto:not([hidden])');
    if (vacio) vacio.hidden = secciones.some((s) => !s.hidden);
  });
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const DATOS = (() => {
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
const plata = (n) => pesos.format(n).replace(/\s/g, ' ');

function h(etiqueta, atributos = {}, ...hijos) {
  const el = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(atributos)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const hijo of hijos.flat()) if (hijo != null && hijo !== false) el.append(hijo instanceof Node ? hijo : String(hijo));
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
  path.setAttribute('stroke-width', '1.8');
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

// ── El pedido ───────────────────────────────────────────────────────────────
if (DATOS?.productos) iniciarPedido(DATOS);

function iniciarPedido(D) {
  const CLAVE_CARRITO = 'ap-carrito';
  const CLAVE_CLIENTE = 'ap-cliente';
  const CLAVE_ULTIMO = 'ap-ultimo';
  const DOCE_HORAS = 12 * 3600_000;

  // Cada línea: producto, presentación y cantidad. El nombre y el precio salen
  // siempre de la carta de hoy (si cambió en TRIVO, aquí ya cambió).
  let carrito = guardado.leer(CLAVE_CARRITO, []).filter((l) => D.productos[l.id] && l.c > 0);
  let clavePedido = null;
  let cajaInfo = null;

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

  // ── Barra «Ver mi pedido» y aviso de «agregado» ─────────────────────────
  const barra = h('button', { type: 'button', class: 't-carrito', hidden: true, onclick: () => abrir(vistaCarrito) });
  const avisoFlotante = h('div', { class: 't-flotante', role: 'status', 'aria-live': 'polite' });
  document.body.append(barra, avisoFlotante);

  function pintarBarra() {
    const n = unidades();
    const u = ultimo();
    barra.replaceChildren();
    if (n) {
      barra.append(icono(ICONO.bolsa), h('span', { class: 't-carrito-n' }, String(n)), h('span', {}, 'Ver mi pedido'), h('strong', {}, plata(subtotal())));
      barra.onclick = () => abrir(vistaCarrito);
    } else if (u) {
      barra.append(icono(ICONO.listo), h('span', {}, u.final ? `Tu último pedido · ${u.referencia}` : `${u.referencia} · ver en qué va`));
      barra.onclick = () => abrir(() => vistaListo(u));
    }
    barra.hidden = !n && !u;
    document.body.classList.toggle('t-con-carrito', !barra.hidden);
  }

  let temporizadorAviso;
  function avisar(texto, conBoton = true) {
    avisoFlotante.replaceChildren(h('span', {}, texto), conBoton ? h('button', { type: 'button', onclick: () => abrir(vistaCarrito) }, 'Ver pedido') : '');
    avisoFlotante.classList.add('t-visible');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => avisoFlotante.classList.remove('t-visible'), 3200);
  }

  // ── La hoja (dialog) donde pasa todo ────────────────────────────────────
  const titulo = h('h2', { id: 't-hoja-titulo' });
  const cuerpo = h('div', { class: 't-hoja-cuerpo' });
  const pieHoja = h('div', { class: 't-hoja-pie' });
  const atras = h('button', { type: 'button', class: 't-hoja-icono', 'aria-label': 'Volver', hidden: true }, icono(ICONO.atras));
  const hoja = h(
    'dialog',
    { class: 't-hoja-pedido', 'aria-labelledby': 't-hoja-titulo' },
    h('div', { class: 't-hoja-cabeza' }, atras, titulo, h('button', { type: 'button', class: 't-hoja-icono', 'aria-label': 'Cerrar', onclick: () => hoja.close() }, icono(ICONO.cerrar))),
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

  function armar({ texto, volver, contenido, pie }) {
    titulo.textContent = texto;
    atras.hidden = !volver;
    atras.onclick = volver || null;
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

  const foto = (p) => (p.f ? h('img', { src: p.f, alt: '', width: 64, height: 64, loading: 'lazy' }) : h('span', { class: 't-mini-sinfoto' }));

  // Escoger la presentación (Caliente / Fría…) y cuántas.
  function vistaEscoger(id) {
    const p = D.productos[id];
    let escogida = p.v[0];
    let cuantas = 1;
    const boton = h('button', { type: 'button', class: 't-comprar t-grande t-ancho-total' });
    const pintarBoton = () => (boton.textContent = `Agregar ${cuantas} · ${plata(escogida.p * cuantas)}`);
    const opciones = h(
      'fieldset',
      { class: 't-presentaciones' },
      h('legend', {}, 'Escoge la presentación'),
      p.v.map((v, i) =>
        h(
          'label',
          {},
          h('input', { type: 'radio', name: 't-escoger', value: v.id, checked: i === 0, onchange: () => ((escogida = v), pintarBoton()) }),
          h('span', {}, v.n),
          h('b', {}, plata(v.p)),
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
      contenido: [
        h('div', { class: 't-escoger-producto' }, foto(p), h('strong', {}, p.n)),
        opciones,
        h('div', { class: 't-escoger-cantidad' }, h('span', {}, 'Cantidad'), contador(cuantas, (d, n) => ((cuantas = Math.max(1, Math.min(99, cuantas + d))), (n.textContent = String(cuantas)), pintarBoton()), 'Cantidad')),
      ],
      pie: boton,
    });
  }

  // El carrito: líneas, cantidades, subtotal y el mínimo.
  function vistaCarrito() {
    const lineas = vigentes();
    const caidas = carrito.filter((l) => !lineas.includes(l));
    if (caidas.length) {
      carrito = lineas;
      guardar();
    }
    if (!lineas.length) {
      armar({
        texto: 'Mi pedido',
        contenido: [h('div', { class: 't-vacio-pedido' }, icono(ICONO.bolsa), h('p', {}, 'Todavía no has agregado productos.'), caidas.length ? h('p', { class: 't-nota' }, 'Quitamos lo que se agotó o ya no está en la carta.') : '')],
        pie: h('button', { type: 'button', class: 't-comprar t-grande t-ancho-total', onclick: () => hoja.close() }, 'Ver productos'),
      });
      return;
    }
    const sub = subtotal();
    const falta = Math.max(0, (D.minimo || 0) - sub);
    armar({
      texto: 'Mi pedido',
      contenido: [
        caidas.length ? h('p', { class: 't-alerta' }, 'Quitamos de tu pedido lo que se agotó o ya no está en la carta.') : '',
        h(
          'ul',
          { class: 't-lineas' },
          lineas.map((l) => {
            const x = info(l);
            const total = h('strong', {}, plata(x.precio * l.c));
            return h(
              'li',
              {},
              foto(x.p),
              h('div', { class: 't-linea-texto' }, h('a', { href: x.p.u }, x.nombre), x.presentacion ? h('small', {}, x.presentacion) : '', h('small', {}, `${plata(x.precio)} c/u`)),
              h('div', { class: 't-linea-lado' }, contador(l.c, (d) => (cambiar(l, l.c + d), vistaCarrito()), `Cantidad de ${x.nombre}`), total),
            );
          }),
        ),
        h('div', { class: 't-resumen' }, h('p', {}, h('span', {}, 'Subtotal'), h('strong', {}, plata(sub))), h('p', { class: 't-nota' }, 'El domicilio se calcula con tu dirección.')),
        falta ? h('p', { class: 't-alerta' }, `El pedido mínimo es ${plata(D.minimo)}: te faltan ${plata(falta)}.`) : '',
        D.enLinea ? '' : h('p', { class: 't-alerta' }, 'Los pedidos en línea están apagados en este momento. Puedes enviarlo por WhatsApp.'),
      ],
      pie: [
        D.enLinea
          ? h('button', { type: 'button', class: 't-comprar t-grande t-ancho-total', disabled: falta > 0, onclick: () => abrir(vistaDatos) }, 'Continuar', icono(ICONO.flecha))
          : botonWhatsapp(),
        h('button', { type: 'button', class: 't-enlace', onclick: () => hoja.close() }, 'Seguir comprando'),
      ],
    });
  }

  function textoWhatsapp(cliente = {}) {
    const lineas = vigentes().map((l) => {
      const x = info(l);
      return `• ${l.c} × ${x.nombre}${x.presentacion ? ` (${x.presentacion})` : ''} — ${plata(x.precio * l.c)}`;
    });
    return [
      `Hola ${D.marca}, quiero pedir:`,
      ...lineas,
      `Subtotal: ${plata(subtotal())}`,
      '',
      cliente.nombre ? `Nombre: ${cliente.nombre}` : null,
      cliente.celular ? `Celular: ${cliente.celular}` : null,
      cliente.direccion ? `Dirección: ${cliente.direccion}${cliente.indicaciones ? ` (${cliente.indicaciones})` : ''}` : 'Mi dirección es: ',
      cliente.lat ? `Ubicación: https://maps.google.com/?q=${cliente.lat},${cliente.lng}` : null,
      cliente.pago ? `Pago: ${cliente.pago}` : null,
    ]
      .filter((x) => x !== null)
      .join('\n');
  }

  const botonWhatsapp = (cliente) =>
    D.whatsapp
      ? h('a', { class: 't-wa t-grande t-ancho-total', href: `https://wa.me/${D.whatsapp}?text=${encodeURIComponent(textoWhatsapp(cliente))}`, target: '_blank', rel: 'noopener' }, 'Enviar el pedido por WhatsApp')
      : '';

  // Datos de entrega, domicilio y pago; «Hacer pedido» lo manda a TRIVO.
  function vistaDatos() {
    const previo = guardado.leer(CLAVE_CLIENTE, {});
    const ubic = { lat: null, lng: null };
    let domicilio = null;
    let enviando = false;

    const campoTexto = (id, etiqueta, atributos) =>
      h('div', { class: 't-campo' }, h('label', { for: id }, etiqueta), h(atributos.filas ? 'textarea' : 'input', { id, ...atributos, filas: null, rows: atributos.filas }));
    const fNombre = campoTexto('t-nombre', 'Nombre', { type: 'text', autocomplete: 'name', required: true, maxlength: 80, value: previo.nombre || '' });
    const fCelular = campoTexto('t-celular', 'Celular', { type: 'tel', inputmode: 'numeric', autocomplete: 'tel-national', required: true, maxlength: 16, placeholder: '300 123 4567', value: previo.celular || '' });
    const fDireccion = campoTexto('t-direccion', 'Dirección de entrega', { type: 'text', autocomplete: 'street-address', required: true, maxlength: 200, placeholder: 'Calle 16 # 9-20, barrio Centro', value: previo.direccion || '' });
    const fIndicaciones = campoTexto('t-indicaciones', 'Indicaciones (opcional)', { filas: 2, maxlength: 300, placeholder: 'Casa, apartamento, punto de referencia…' });
    fIndicaciones.querySelector('textarea').value = previo.indicaciones || '';
    const valor = (f) => f.querySelector('input, textarea').value.trim();

    const estadoUbic = h('p', { class: 't-nota', 'aria-live': 'polite' }, 'Así el domiciliario llega directo.');
    const quitarUbicacion = (aviso) => {
      ubic.lat = null;
      ubic.lng = null;
      botonUbic.classList.remove('t-marcada');
      estadoUbic.textContent = aviso;
      estadoUbic.classList.add('t-fuera');
      domicilio = null;
      pintarTotales();
      cotizar();
    };
    const botonUbic = h('button', { type: 'button', class: 't-wa t-ubicar' }, icono(ICONO.ubicacion), 'Usar mi ubicación');
    botonUbic.onclick = () => {
      if (!navigator.geolocation) return (estadoUbic.textContent = 'Este navegador no comparte la ubicación. Escribe la dirección.');
      botonUbic.disabled = true;
      estadoUbic.textContent = 'Buscando tu ubicación…';
      navigator.geolocation.getCurrentPosition(
        async (pos) => {
          ubic.lat = pos.coords.latitude;
          ubic.lng = pos.coords.longitude;
          botonUbic.disabled = false;
          botonUbic.classList.add('t-marcada');
          estadoUbic.classList.remove('t-fuera');
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

    // Medios de pago (los mismos de la carta de TRIVO).
    const pagos = h('div', { class: 't-pagos', role: 'radiogroup', 'aria-label': 'Método de pago' }, h('p', { class: 't-nota' }, 'Cargando medios de pago…'));
    const cuenta = h('div', { class: 't-cuenta-pago', hidden: true });
    let pagoId = previo.pago || null;
    const pintarCuenta = () => {
      const m = cajaInfo?.pagos.find((x) => x.id === pagoId);
      cuenta.hidden = !(m && m.cuenta && /transfer|wallet/.test(m.tipo));
      if (cuenta.hidden) return;
      const copiar = h('button', { type: 'button', class: 't-enlace' }, 'Copiar');
      copiar.onclick = () => navigator.clipboard?.writeText(m.cuenta).then(() => (copiar.textContent = 'Copiado'));
      cuenta.replaceChildren(h('span', {}, `Transfiere a ${m.nombre}`), h('strong', {}, m.cuenta), copiar, h('small', {}, 'Te pediremos el comprobante por WhatsApp.'));
    };

    const avisoCerrado = h('p', { class: 't-alerta', hidden: true });
    const filaDomicilio = h('strong', {}, '—');
    const filaTotal = h('strong', {}, plata(subtotal()));
    const error = h('p', { class: 't-error', role: 'alert', hidden: true });
    const respaldo = h('div', { hidden: true });
    const boton = h('button', { type: 'submit', class: 't-comprar t-grande t-ancho-total', form: 't-form-pedido' }, `Hacer pedido · ${plata(subtotal())}`);

    const pintarTotales = () => {
      const total = subtotal() + (domicilio?.valor || 0);
      filaDomicilio.textContent = domicilio ? (domicilio.valor ? plata(domicilio.valor) : 'Gratis') : 'Con tu dirección';
      filaTotal.textContent = plata(total);
      boton.textContent = enviando ? 'Enviando…' : `Hacer pedido · ${plata(total)}`;
    };

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
          if (mio === turno) domicilio = null;
        }
        pintarTotales();
      }, 600);
    }
    fDireccion.querySelector('input').addEventListener('input', cotizar);

    const form = h(
      'form',
      { id: 't-form-pedido', class: 't-form', novalidate: true },
      h('section', {}, h('h3', {}, '¿A quién se lo llevamos?'), fNombre, fCelular),
      h('section', {}, h('h3', {}, '¿A dónde?'), botonUbic, estadoUbic, fDireccion, fIndicaciones),
      h('section', {}, h('h3', {}, '¿Cómo pagas?'), pagos, cuenta),
      h(
        'section',
        { class: 't-resumen' },
        h('p', {}, h('span', {}, `Productos (${unidades()})`), h('strong', {}, plata(subtotal()))),
        h('p', {}, h('span', {}, 'Domicilio'), filaDomicilio),
        h('p', { class: 't-resumen-total' }, h('span', {}, 'Total'), filaTotal),
      ),
    );

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (enviando) return;
      const cliente = { nombre: valor(fNombre), celular: valor(fCelular), direccion: valor(fDireccion), indicaciones: valor(fIndicaciones) };
      const faltan = [];
      if (cliente.nombre.length < 2) faltan.push(['tu nombre', fNombre]);
      if (!/^(\+?57)?3\d{9}$/.test(cliente.celular.replace(/\D/g, '').replace(/^57(?=3\d{9}$)/, ''))) faltan.push(['un celular de 10 dígitos', fCelular]);
      if (cliente.direccion.length < 5) faltan.push(['la dirección', fDireccion]);
      if (cajaInfo?.pagos.length && !pagoId) faltan.push(['cómo vas a pagar', pagos]);
      error.hidden = !faltan.length;
      if (faltan.length) {
        error.textContent = `Falta ${faltan.map((f) => f[0]).join(', ')}.`;
        faltan[0][1].querySelector('input, textarea, button')?.focus();
        return;
      }
      guardado.poner(CLAVE_CLIENTE, { ...cliente, pago: pagoId });
      clavePedido ||= nuevaClave();
      enviando = true;
      boton.disabled = true;
      pintarTotales();
      const pago = cajaInfo?.pagos.find((x) => x.id === pagoId);
      try {
        const r = await api('pedido', {
          clave: clavePedido,
          lineas: vigentes().map((l) => ({ id: l.id, variante: l.v, cantidad: l.c })),
          ...cliente,
          lat: ubic.lat,
          lng: ubic.lng,
          pago: pagoId,
        });
        // El detalle queda guardado en el teléfono: la confirmación de TRIVO no lo muestra.
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
          detalle: { lineas, subtotal: sub, domicilio: domicilio ? domicilio.valor : null, total: r.total || sub + (domicilio?.valor || 0) },
          entrega: { ...cliente, ubicacion: ubic.lat !== null },
        };
        guardado.poner(CLAVE_ULTIMO, u);
        carrito = [];
        guardar();
        abrir(() => vistaListo(u));
      } catch (falla) {
        enviando = false;
        boton.disabled = false;
        pintarTotales();
        error.hidden = false;
        error.textContent = falla.datos?.error || 'No pudimos enviar el pedido. Revisa tu conexión e intenta de nuevo.';
        if (falla.datos?.codigo === 'fuera_de_zona') quitarUbicacion(`${falla.datos.error} Si el pedido es para una dirección en ${D.ciudad}, escríbela abajo.`);
        // Si TRIVO no respondió (o no hay internet), el pedido sale completo por WhatsApp.
        const caida = falla.datos?.sinTrivo || !falla.estado;
        respaldo.hidden = !caida;
        if (caida) respaldo.replaceChildren(botonWhatsapp({ ...cliente, ...ubic, pago: pago?.nombre }));
      }
    });

    // El aviso de cerrado y los errores van junto al botón: siempre a la vista.
    armar({ texto: 'Datos de entrega', volver: () => abrir(vistaCarrito), contenido: form, pie: [avisoCerrado, error, respaldo, boton] });

    const cargar = cajaInfo ? Promise.resolve(cajaInfo) : api('caja').then((c) => (cajaInfo = c));
    cargar
      .then((c) => {
        if (!c.pagos.some((m) => m.id === pagoId)) pagoId = null;
        pagos.replaceChildren(
          ...c.pagos.map((m) =>
            h(
              'label',
              { class: 't-pago' },
              h('input', { type: 'radio', name: 't-pago', value: m.id, checked: m.id === pagoId, onchange: () => ((pagoId = m.id), pintarCuenta()) }),
              h('span', {}, m.nombre),
            ),
          ),
        );
        if (!c.pagos.length) pagos.replaceChildren(h('p', { class: 't-nota' }, 'Acuerdas el pago con la tienda al recibir.'));
        pintarCuenta();
        if (c.abierto === false) {
          avisoCerrado.hidden = false;
          avisoCerrado.textContent = `La tienda está cerrada en este momento${c.horario ? ` (atendemos de ${hora(c.horario.abre)} a ${hora(c.horario.cierra)})` : ''}. Tu pedido queda guardado aquí para enviarlo cuando abramos.`;
          boton.disabled = true;
        }
      })
      .catch(() => pagos.replaceChildren(h('p', { class: 't-nota' }, 'No cargaron los medios de pago. Intenta de nuevo en un momento.')));
    if (valor(fDireccion)) cotizar();
  }

  const hora = (hhmm) => {
    const [h24, m] = String(hhmm).split(':').map(Number);
    const sufijo = h24 < 12 ? 'a. m.' : 'p. m.';
    return `${((h24 + 11) % 12) + 1}:${String(m || 0).padStart(2, '0')} ${sufijo}`;
  };

  const horaDe = (t) => new Intl.DateTimeFormat('es-CO', { timeZone: 'America/Bogota', weekday: 'long', hour: 'numeric', minute: '2-digit' }).format(t);

  // El detalle del pedido: productos, presentaciones, valores, entrega y pago.
  // Cuando TRIVO devuelve su cuenta, los productos salen de ahí (lo que TRIVO
  // de verdad registró); mientras tanto, lo que el cliente pidió.
  function detalleHtml(u, cuentaTrivo) {
    const d = u.detalle;
    if (!d && !cuentaTrivo) return '';
    const lineas = cuentaTrivo?.lineas?.length ? cuentaTrivo.lineas : d?.lineas || [];
    const total = cuentaTrivo?.total || d?.total;
    const e = u.entrega || {};
    return h(
      'section',
      { class: 't-detalle', 'aria-label': 'Detalle del pedido' },
      h('h3', {}, 'Detalle del pedido'),
      h(
        'ul',
        { class: 't-detalle-lineas' },
        lineas.map((l) => h('li', {}, h('span', {}, h('b', {}, `${l.cantidad} ×`), ` ${l.nombre}`, l.presentacion ? h('small', {}, l.presentacion) : ''), h('strong', {}, plata(l.total)))),
      ),
      h(
        'div',
        { class: 't-resumen' },
        d && !cuentaTrivo ? h('p', {}, h('span', {}, 'Productos'), h('strong', {}, plata(d.subtotal))) : '',
        d?.domicilio != null && !cuentaTrivo ? h('p', {}, h('span', {}, 'Domicilio'), h('strong', {}, d.domicilio ? plata(d.domicilio) : 'Gratis')) : '',
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
      cuentaTrivo ? h('p', { class: 't-nota' }, 'Productos y total como los registró la tienda.') : '',
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

  // El pedido ya está en TRIVO: número, en qué va, el detalle y el comprobante.
  const PASOS = ['Recibido', 'En preparación', 'Listo', 'En camino', 'Entregado'];
  function vistaListo(u) {
    const estado = h('p', { class: 't-estado', 'aria-live': 'polite' }, 'Recibido');
    const detalle = h('div', {}, detalleHtml(u, u.cuentaTrivo));
    const pasos = h('ol', { class: 't-pasos' }, PASOS.map((p) => h('li', {}, p)));
    const pintar = (s) => {
      estado.textContent = s.cancelado ? 'Pedido cancelado. Escríbenos si tienes dudas.' : s.etiqueta;
      [...pasos.children].forEach((li, i) => li.classList.toggle('t-hecho', !s.cancelado && i <= Math.min(s.etapa, PASOS.length - 1)));
      pasos.hidden = s.cancelado;
    };
    pintar({ etapa: 0, etiqueta: 'Recibido', cancelado: false });

    let reloj = null;
    const revisar = async () => {
      if (!u.uuid) return;
      try {
        const s = await api(`pedido/${u.uuid}`);
        pintar(s);
        if (s.detalle?.lineas?.length) {
          u.cuentaTrivo = s.detalle;
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
    revisar();
    reloj = setInterval(revisar, 15000);
    alCerrar = () => clearInterval(reloj);

    const mensaje = mensajeTienda(u);
    armar({
      texto: u.final ? 'Tu último pedido' : 'Pedido enviado',
      contenido: [
        h('div', { class: 't-listo' }, h('span', { class: 't-listo-icono' }, icono(ICONO.listo)), h('p', {}, u.final ? 'Tu último pedido' : '¡Tu pedido llegó a la tienda!'), h('strong', {}, u.referencia)),
        estado,
        pasos,
        u.transferencia && !u.final ? h('p', { class: 't-nota' }, 'Envía el comprobante de la transferencia por WhatsApp para despachar más rápido.') : '',
        detalle,
      ],
      pie: [
        u.whatsapp ? h('a', { class: u.transferencia ? 't-comprar t-grande t-ancho-total' : 't-wa t-grande t-ancho-total', href: `https://wa.me/${u.whatsapp}?text=${encodeURIComponent(mensaje)}`, target: '_blank', rel: 'noopener' }, u.transferencia ? 'Enviar comprobante por WhatsApp' : 'Escribir a la tienda') : '',
        h('button', { type: 'button', class: 't-enlace', onclick: () => hoja.close() }, 'Seguir comprando'),
      ],
    });
  }

  // ── «Agregar» en las tarjetas y en la página del producto ───────────────
  document.addEventListener('click', (e) => {
    const enlace = e.target.closest('[data-agregar]');
    if (!enlace) return;
    const id = Number(enlace.dataset.agregar);
    const p = D.productos[id];
    if (!p?.ok) return;
    e.preventDefault();
    const ficha = enlace.closest('[data-producto]');
    if (ficha) {
      const marcada = document.querySelector('input[name="presentacion"]:checked');
      const v = p.v.length ? Number(marcada?.value) || p.v[0].id : null;
      const c = Number(ficha.querySelector('.t-contador output')?.textContent) || 1;
      agregar(id, v, c);
      const x = info({ id, v });
      avisar(`Agregaste ${c} × ${p.n}${x.presentacion ? ` (${x.presentacion})` : ''}`);
      return;
    }
    if (p.v.length > 1) return abrir(() => vistaEscoger(id));
    agregar(id, p.v[0]?.id ?? null, 1);
    avisar(`Agregaste ${p.n}`);
  });

  // Página del producto: cantidad junto al botón y el precio de la presentación escogida.
  const ficha = document.querySelector('.t-ficha-botones[data-producto]');
  const pf = ficha && D.productos[ficha.dataset.producto];
  if (ficha && pf?.ok) {
    let c = 1;
    ficha.prepend(contador(c, (d, n) => ((c = Math.max(1, Math.min(99, c + d))), (n.textContent = String(c))), 'Cantidad'));
    const precio = document.querySelector('.t-ficha-precio strong');
    const desde = document.querySelector('.t-ficha-precio .t-desde');
    for (const r of document.querySelectorAll('input[name="presentacion"]')) {
      r.addEventListener('change', () => {
        if (precio) precio.textContent = plata(Number(r.dataset.precio));
        if (desde) desde.hidden = true;
      });
    }
  }
  for (const a of document.querySelectorAll('[data-agregar]')) a.removeAttribute('target');

  pintarBarra();
  addEventListener('storage', (e) => {
    if (e.key === CLAVE_CARRITO) {
      carrito = guardado.leer(CLAVE_CARRITO, []).filter((l) => D.productos[l.id] && l.c > 0);
      pintarBarra();
    }
  });
}
