// D1 (VTEX): el buscador de su tienda a domicilio. Precio nacional (D1 tiene
// el mismo precio en todo el país) y código de barras en cada producto.
import { tiendaVtex } from './vtex.js';

export const { tienda, buscar } = tiendaVtex({ id: 'd1', nombre: 'D1', web: 'https://www.d1.com.co', alcance: 'Precio nacional (tiendas en Valledupar)', porDefecto: true });
