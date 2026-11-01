// Carulla (Grupo Éxito, VTEX): precio nacional en línea. Viene apagada: se
// activa en Ajustes → Tiendas.
import { tiendaVtex } from './vtex.js';

export const { tienda, buscar } = tiendaVtex({ id: 'carulla', nombre: 'Carulla', web: 'https://www.carulla.com' });
