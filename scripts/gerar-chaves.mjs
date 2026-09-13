/*
 * scripts/gerar-chaves.mjs
 * Gera um par Ed25519, grava em data/chaves.json (privada+publica em PEM)
 * e imprime a chave publica em base64 (raw 32 bytes) pra colar no cliente.
 *
 * Uso:
 *   npm run gerar-chaves
 *
 * ATENCAO: rode UMA vez. Se rodar de novo, invalida todas as licencas ja emitidas
 * (o cliente carrega a chave publica embutida — precisa republicar a extensao
 *  com a nova pubkey). O script recusa sobrescrever se ja existe chaves.json,
 * a menos que voce passe --forcar.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gerarPar } from '../src/crypto.js';
import { gravar } from '../src/storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const arqChaves = path.resolve(__dirname, '..', 'data', 'chaves.json');
const forcar = process.argv.includes('--forcar');

if (existsSync(arqChaves) && !forcar) {
  const j = JSON.parse(await readFile(arqChaves, 'utf-8'));
  console.log('data/chaves.json JA EXISTE.');
  console.log('Se voce quer gerar um par novo (invalida todas as licencas!), rode:');
  console.log('  npm run gerar-chaves -- --forcar');
  console.log('');
  console.log('Chave publica atual (cole no cliente):');
  console.log('  ' + j.pubRawB64);
  process.exit(0);
}

const par = gerarPar();
await gravar('chaves', par);

console.log('Par Ed25519 gerado com sucesso.');
console.log('');
console.log('=== COLE ESTA CHAVE PUBLICA no cliente ===');
console.log('Arquivo: piloto/src/license.js');
console.log('Const: PUB_KEY_B64');
console.log('');
console.log(par.pubRawB64);
console.log('');
console.log('A chave privada esta em data/chaves.json — NAO commite esse arquivo.');
