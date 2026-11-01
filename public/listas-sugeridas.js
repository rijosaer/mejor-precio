// Listas predeterminadas: productos que se venden en casi todas las tiendas,
// armadas con búsquedas reales (noviembre de 2026). Cada búsqueda trae el
// tamaño que más tiendas comparan; entre paréntesis, en cuántas tiendas se
// encontró el six pack (cervezas) o la botella (licores) exactos.
// Se agregan a Mi lista desde «Listas predeterminadas».
export const LISTAS = [
  {
    id: 'cervezas',
    nombre: 'Cervezas',
    descripcion: 'Las 14 cervezas que más tiendas comparan, en el tamaño de su six pack más común.',
    productos: [
      { q: 'cerveza aguila 330', corto: 'Águila' }, // 6 tiendas
      { q: 'cerveza aguila light 330', corto: 'Águila Light' }, // 6
      { q: 'cerveza poker 330', corto: 'Poker' }, // 6
      { q: 'cerveza club colombia dorada 330', corto: 'Club Colombia' }, // 6
      { q: 'cerveza club colombia roja 330', corto: 'Club Colombia Roja' }, // 6
      { q: 'cerveza costeña 330', corto: 'Costeña' }, // 5
      { q: 'cerveza corona 269', corto: 'Corona' }, // 7
      { q: 'cerveza coronita 210', corto: 'Coronita' }, // 7
      { q: 'cerveza budweiser 269', corto: 'Budweiser' }, // 7
      { q: 'cerveza heineken 330', corto: 'Heineken' }, // 6
      { q: 'cerveza stella artois 300', corto: 'Stella Artois' }, // 7
      { q: 'cerveza michelob ultra 269', corto: 'Michelob Ultra' }, // 5
      { q: 'cerveza andina 310', corto: 'Andina' }, // 5
      { q: 'cerveza redds 269', corto: "Redd's" }, // 5
    ],
  },
  {
    id: 'licores',
    nombre: 'Licores más vendidos',
    descripcion: 'Aguardiente, ron, whisky y tequila en la botella que más tiendas tienen.',
    productos: [
      { q: 'aguardiente antioqueño 750', corto: 'Antioqueño' }, // 6
      { q: 'aguardiente antioqueño sin azucar 750', corto: 'Antioqueño sin azúcar' }, // 4
      { q: 'aguardiente nectar 750', corto: 'Néctar' }, // 5
      { q: 'ron medellin dorado 750', corto: 'Ron Medellín Dorado' }, // 7
      { q: 'ron viejo de caldas 750', corto: 'Viejo de Caldas' }, // 8
      { q: 'whisky old parr 750', corto: 'Old Parr' }, // 7
      { q: 'whisky buchanans 12 750', corto: "Buchanan's 12" }, // 5
      { q: 'whisky johnnie walker black 700', corto: 'Black Label' }, // 7
      { q: 'whisky johnnie walker red 700', corto: 'Red Label' }, // 6
      { q: 'tequila jose cuervo 750', corto: 'José Cuervo' }, // 7
    ],
  },
];

const clave = (q) => q.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Los productos de una lista que todavía no están en Mi lista.
export function faltantes(lista, actuales) {
  const ya = new Set(actuales.map((x) => clave(x.q)));
  return lista.productos.filter((p) => !ya.has(clave(p.q)));
}

export const yaEsta = (q, actuales) => actuales.some((x) => clave(x.q) === clave(q));
