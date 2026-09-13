/*
 * scripts/emitir-licenca.mjs
 * CLI pra emitir uma nova licenca.
 *
 * Uso:
 *   npm run emitir -- --plano ouro --dias 365 --cliente "Fulano"
 *
 * Argumentos:
 *   --plano <str>     nome do plano (default: padrao)
 *   --dias <num>      validade em dias (default: TRIAL_DIAS do .env)
 *   --cliente <str>   nome do comprador (opcional, so pra rastreio)
 *   --chave <str>     usa esta chave (default: gerada aleatoria)
 *   --forcar          sobrescreve se a chave ja existir
 */
import 'dotenv/config';
import crypto from 'node:crypto';
import { ler, gravar } from '../src/storage.js';

const args = process.argv.slice(2);
function pegar(nome, padrao) {
  const i = args.indexOf('--' + nome);
  return i >= 0 && args[i + 1] ? args[i + 1] : padrao;
}
const forcar = args.includes('--forcar');

const plano = pegar('plano', 'padrao');
const dias = Number(pegar('dias', process.env.TRIAL_DIAS || 30));
const cliente = pegar('cliente', '');
const chaveManual = pegar('chave', '');

const chave = chaveManual || gerarChave();

const licencas = await ler('licencas', {});
if (licencas[chave] && !forcar) {
  console.error('Chave ja existe. Use --forcar pra sobrescrever.');
  process.exit(1);
}

const agora = Math.floor(Date.now() / 1000);
licencas[chave] = {
  ativa: true,
  plano,
  cliente,
  criadaEm: agora,
  validoAte: dias > 0 ? agora + dias * 86400 : null,
  fingerprints: [],
};
await gravar('licencas', licencas);

console.log('Licenca emitida.');
console.log('  chave     :', chave);
console.log('  plano     :', plano);
console.log('  cliente   :', cliente || '(sem)');
console.log('  valido ate:', licencas[chave].validoAte ? new Date(licencas[chave].validoAte * 1000).toISOString() : 'vitalicio');
console.log('');
console.log('Entregue esta chave ao cliente. Ele cola no painel na aba Ajustes -> Licenca.');

function gerarChave() {
  // formato humano: XXXX-XXXX-XXXX-XXXX (uppercase, alfanumerico ex 0/O/1/I)
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) s += '-';
    s += alfa[bytes[i] % alfa.length];
  }
  return s;
}
