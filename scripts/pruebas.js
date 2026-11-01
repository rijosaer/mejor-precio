// Uso: npm test
// Corre todas las pruebas de tests/. Node 20 no entiende patrones como
// "tests/*.test.js" en `node --test`, así que aquí se listan los archivos.
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const archivos = readdirSync('tests')
  .filter((nombre) => nombre.endsWith('.test.js'))
  .map((nombre) => `tests/${nombre}`);

const { status } = spawnSync(process.execPath, ['--test', ...archivos], { stdio: 'inherit' });
process.exit(status ?? 1);
