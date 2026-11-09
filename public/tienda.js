// Tienda pública: el buscador de productos (sin él la página funciona igual)
// y el paso al panel para quien abre la app instalada o un enlace viejo de los
// avisos («/#mitienda», «/?q=…»), que antes vivían en la página principal.
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

const caja = document.querySelector('.t-buscar');
const campo = caja?.querySelector('input');
if (caja && campo) {
  caja.hidden = false;
  const productos = [...document.querySelectorAll('.t-producto')].map((li) => ({ li, texto: normal(li.dataset.buscar || '') }));
  const secciones = [...document.querySelectorAll('.t-seccion')];
  const vacio = document.querySelector('.t-vacio');
  campo.addEventListener('input', () => {
    const palabras = normal(campo.value).split(/\s+/).filter(Boolean);
    for (const p of productos) p.li.hidden = !palabras.every((w) => p.texto.includes(w));
    for (const s of secciones) s.hidden = !s.querySelector('.t-producto:not([hidden])');
    if (vacio) vacio.hidden = secciones.some((s) => !s.hidden);
  });
}
