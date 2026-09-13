/*
 * scripts/listar-licencas.mjs
 * Lista as licencas emitidas.
 *
 * Uso:
 *   npm run listar
 */
import { ler } from '../src/storage.js';

const licencas = await ler('licencas', {});
const entries = Object.entries(licencas);
if (!entries.length) {
  console.log('nenhuma licenca emitida ainda. Use: npm run emitir');
  process.exit(0);
}

console.log('chave                        plano       cliente        validoAte             maquinas');
console.log('-------------------------------------------------------------------------------------------');
for (const [chave, lic] of entries) {
  const va = lic.validoAte ? new Date(lic.validoAte * 1000).toISOString().slice(0, 10) : 'vitalicio ';
  const fp = (lic.fingerprints || []).length;
  console.log(chave.padEnd(28), (lic.plano || '').padEnd(10), (lic.cliente || '').padEnd(14), va.padEnd(20), fp);
}
