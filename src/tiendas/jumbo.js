// Jumbo (Cencosud, VTEX): precio nacional en línea. Viene apagada: se activa en
// Ajustes → Tiendas.
import { tiendaVtex } from './vtex.js';

export const { tienda, buscar } = tiendaVtex({ id: 'jumbo', nombre: 'Jumbo', web: 'https://www.jumbocolombia.com' });
