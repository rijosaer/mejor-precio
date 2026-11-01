// Uso: npm run probar -- "aguardiente antioqueño 750"
import { comparar } from '../src/comparador.js';

const consulta = process.argv.slice(2).join(' ') || 'aguardiente antioqueño 750';
const pesos = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

const datos = await comparar(consulta);
console.log(`Búsqueda: "${consulta}"\n`);
for (const t of datos.tiendas) {
  if (!t.ok) {
    console.log(`✗ ${t.nombre}: ${t.error} (${t.ms} ms)\n`);
    continue;
  }
  console.log(`✓ ${t.nombre} — ${t.productos.length} coinciden, ${t.descartados} descartados (${t.ms} ms)`);
  for (const p of t.productos.slice(0, 6)) {
    const presentacion = p.ml ? `${p.unidades > 1 ? p.unidades + ' × ' : ''}${p.ml} ml` : 'sin tamaño';
    console.log(`   ${pesos.format(p.precio).padStart(12)}  ${presentacion.padEnd(14)} ${p.disponible ? '' : '[agotado] '}${p.nombre}`);
  }
  console.log();
}
