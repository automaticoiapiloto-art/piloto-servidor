/*
 * storage.js — persistencia em JSON (dev). Trocar por SQLite/Postgres em prod.
 * Escritas serializadas para evitar corrida de arquivos concorrentes.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Permite override do path via env — util pra Render onde o disk pode nao
// bater com o path relativo do build. Se DATA_DIR estiver setado, usa ele.
// Senao, path relativo tradicional (bom pra local + Docker).
const DATA_DIR = process.env.DATA_DIR || path.resolve(__dirname, '..', 'data');

console.log('[storage] DATA_DIR =', DATA_DIR);

let filaEscrita = Promise.resolve();

export async function ler(nome, padrao) {
  const p = path.join(DATA_DIR, nome + '.json');
  if (!existsSync(p)) return padrao;
  try {
    const txt = await fs.readFile(p, 'utf-8');
    return JSON.parse(txt);
  } catch (_) {
    return padrao;
  }
}

export function gravar(nome, dados) {
  filaEscrita = filaEscrita.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const p = path.join(DATA_DIR, nome + '.json');
    const tmp = p + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(dados, null, 2), 'utf-8');
    await fs.rename(tmp, p);
  }).catch((e) => { console.error('[storage] erro gravando', nome, e.message); });
  return filaEscrita;
}
