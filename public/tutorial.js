// Tutorial de la app: se abre solito en la primera visita y siempre desde el
// botón «Cómo funciona». No depende del servidor ni de datos.js: cada paso
// enseña una demostración hecha con HTML y CSS.
const CLAVE_VISTO = 'mp-tutorial-v1';

const PASOS = [
  {
    titulo: 'Buscas una vez, comparas todas las tiendas',
    cuerpo:
      'Escribe la marca y el tamaño. Bevgo, Dislicores, Éxito, Makro, Olímpica y Agua Pure se consultan al mismo tiempo ' +
      'y la app te muestra cuál lo tiene más barato.',
    demo: `
      <div class="demo demo-busqueda">
        <div class="demo-buscador">
          <span class="demo-texto">cerveza aguila 330</span><span class="demo-caret"></span>
          <span class="demo-boton">Buscar</span>
        </div>
        <div class="demo-pastillas">
          <span class="demo-pastilla ok">Bevgo · 6</span>
          <span class="demo-pastilla ok">Dislicores · 4</span>
          <span class="demo-pastilla ok">Éxito · 9</span>
          <span class="demo-pastilla ok">Makro · 5</span>
          <span class="demo-pastilla ok">Olímpica · 7</span>
        </div>
      </div>`,
  },
  {
    titulo: 'La etiqueta amarilla es la más barata',
    cuerpo:
      'Los resultados se agrupan por presentación (750 ml, 6 × 330 ml…). Dentro de cada grupo el más barato ' +
      'lleva la etiqueta amarilla; los demás quedan ordenados de menor a mayor.',
    demo: `
      <div class="demo demo-filas">
        <div class="demo-fila ganadora">
          <span class="demo-tienda">Makro</span>
          <span class="demo-etiqueta">Mejor precio</span>
          <span class="demo-precio">$3.890</span>
        </div>
        <div class="demo-fila">
          <span class="demo-tienda">Éxito</span>
          <span class="demo-precio">$4.190</span>
        </div>
        <div class="demo-fila">
          <span class="demo-tienda">Olímpica</span>
          <span class="demo-precio">$4.450</span>
        </div>
      </div>`,
  },
  {
    titulo: 'Cada búsqueda deja un punto en tu historial',
    cuerpo:
      'Con el tiempo ves la gráfica del precio y los chips «Bajó $X», «Subió $X» o «Mínimo histórico». ' +
      'Si un producto cae más de 3 % por debajo del mínimo de la semana, sale un aviso.',
    demo: `
      <div class="demo demo-grafica">
        <div class="demo-chips-demo">
          <span class="demo-chip verde">Bajó $6.000</span>
          <span class="demo-chip verde-suave">Mínimo histórico</span>
        </div>
        <svg viewBox="0 0 300 88" role="img" aria-label="Ejemplo de gráfica de precios">
          <line x1="8" y1="78" x2="292" y2="78" class="demo-eje"></line>
          <polyline class="demo-linea" points="12,22 78,30 144,18 210,40 288,64"></polyline>
          <g class="demo-puntos">
            <circle cx="12" cy="22" r="2.5"></circle>
            <circle cx="78" cy="30" r="2.5"></circle>
            <circle cx="144" cy="18" r="2.5"></circle>
            <circle cx="210" cy="40" r="2.5"></circle>
            <circle cx="288" cy="64" r="4"></circle>
          </g>
        </svg>
      </div>`,
  },
  {
    titulo: 'Si revendes, mira el margen neto',
    cuerpo:
      'En cada fila, Margen calcula precio de venta menos compra, envío, comisión de pago e impuestos. ' +
      'Si da negativo, te avisa antes de que compres.',
    demo: `
      <div class="demo demo-margen">
        <div class="demo-linea-salida"><span>Precio de venta</span><b>$68.000</b></div>
        <div class="demo-linea-salida"><span>Costos (compra + envío + comisión)</span><b>$59.300</b></div>
        <div class="demo-linea-salida resultado"><span>Margen neto</span><b class="positivo">+$8.700</b></div>
      </div>`,
  },
  {
    titulo: 'Suma lo que te cuesta ir a buscarlo',
    cuerpo:
      'En Ajustes marcas tu ubicación y la de cada tienda. Así puedes ordenar por «precio + traslado», ' +
      'ver los kilómetros de cada una y sumar su cashback al margen.',
    demo: `
      <div class="demo demo-logistica">
        <span class="demo-chip aviso">12,4 km · +$9.920 de traslado</span>
        <span class="demo-chip aviso">3,1 km · +$2.480 de traslado</span>
        <div class="demo-orden">Ordenar por <b>precio + traslado</b></div>
      </div>`,
  },
  {
    titulo: 'Tus proveedores también cuentan',
    cuerpo:
      'En «Proveedores» anotas los precios del distribuidor que no tiene página web (a mano, desde un Excel o ' +
      'pegando su lista de WhatsApp) y aparece en cada búsqueda junto a las tiendas.',
    demo: `
      <div class="demo demo-filas">
        <div class="demo-fila ganadora"><span class="demo-tienda">Don José</span><span class="demo-etiqueta">Mejor precio</span><span class="demo-precio">$41.500</span></div>
        <div class="demo-fila"><span class="demo-tienda">Makro</span><span class="demo-precio">$43.900</span></div>
      </div>`,
  },
  {
    titulo: 'Arma el pedido y que la app decida dónde',
    cuerpo:
      'Con «Agregar al pedido» juntas varios productos. La app reparte la compra entre tiendas para pagar menos ' +
      'en total, contando el envío y el pedido mínimo de cada una.',
    demo: `
      <div class="demo demo-margen">
        <div class="demo-linea-salida"><span>Makro · 3 productos</span><b>$128.400</b></div>
        <div class="demo-linea-salida"><span>Don José · 2 productos</span><b>$83.000</b></div>
        <div class="demo-linea-salida resultado"><span>Ahorras frente a una sola tienda</span><b class="positivo">$14.600</b></div>
      </div>`,
  },
];

const $ = (sel) => document.querySelector(sel);

let actual = 0;

function guardado(clave, valor) {
  try {
    if (valor === undefined) return JSON.parse(localStorage.getItem(clave) || 'null');
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch {
    return null;
  }
}

function pintarPaso() {
  const paso = PASOS[actual];
  $('#tu-demo').innerHTML = paso.demo;
  $('#tu-titulo').textContent = paso.titulo;
  $('#tu-cuerpo').textContent = paso.cuerpo;
  $('#tu-paso').textContent = `${actual + 1} de ${PASOS.length}`;

  const dots = $('#tu-dots');
  dots.replaceChildren();
  PASOS.forEach((_, i) => {
    const d = document.createElement('button');
    d.type = 'button';
    d.className = 'tu-dot' + (i === actual ? ' activo' : '');
    d.setAttribute('aria-label', `Paso ${i + 1}`);
    d.addEventListener('click', () => {
      actual = i;
      pintarPaso();
    });
    dots.append(d);
  });

  const siguiente = $('#tu-siguiente');
  siguiente.textContent = actual === PASOS.length - 1 ? 'Entendido, empezar' : 'Siguiente';
  siguiente.focus({ preventScroll: true });
}

function abrir() {
  actual = 0;
  pintarPaso();
  const caja = $('#tutorial');
  caja.hidden = false;
  document.documentElement.style.overflow = 'hidden';
}

let alCerrar = null;

function cerrar() {
  $('#tutorial').hidden = true;
  document.documentElement.style.overflow = '';
  guardado(CLAVE_VISTO, true);
  const siguiente = alCerrar;
  alCerrar = null;
  siguiente?.();
}

/** Abre el tutorial desde el botón «Cómo funciona». */
export function abrirTutorial() {
  actual = 0;
  abrir();
}

/** Lo abre solo si es la primera vez que entra; `despues` corre al cerrarlo
 *  (o enseguida, si ya lo había visto). */
export function iniciarTutorial(despues) {
  if (guardado(CLAVE_VISTO)) return despues?.();
  alCerrar = despues || null;
  abrir();
}

export function configurarTutorial() {
  $('#tu-siguiente').addEventListener('click', () => {
    if (actual === PASOS.length - 1) return cerrar();
    actual += 1;
    pintarPaso();
  });
  $('#tu-saltar').addEventListener('click', cerrar);
  $('#tu-atras').addEventListener('click', () => {
    if (actual === 0) return cerrar();
    actual -= 1;
    pintarPaso();
  });
  document.querySelectorAll('[data-cerrar-tutorial]').forEach((n) => n.addEventListener('click', cerrar));
  document.addEventListener('keydown', (e) => {
    if ($('#tutorial').hidden) return;
    if (e.key === 'Escape') cerrar();
    if (e.key === 'ArrowRight') $('#tu-siguiente').click();
    if (e.key === 'ArrowLeft') $('#tu-atras').click();
  });
}
