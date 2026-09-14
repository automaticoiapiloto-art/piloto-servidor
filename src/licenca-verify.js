/*
 * licenca-verify.js — verifica um token Ed25519 do lado do servidor.
 * Usado por rotas protegidas (ex: /api/ia/responder) pra confirmar que o
 * request vem de uma extensao com licenca ativa.
 */
import crypto from 'node:crypto';
import { ler } from './storage.js';

export async function verificarTokenPorLicenca(tokenB64u) {
  if (!tokenB64u || typeof tokenB64u !== 'string') return null;
  const partes = tokenB64u.split('.');
  if (partes.length !== 2) return null;
  try {
    const par = await ler('chaves', null);
    if (!par || !par.pubPem) return null;
    const pub = crypto.createPublicKey(par.pubPem);
    const ok = crypto.verify(null, Buffer.from(partes[0], 'utf-8'), pub, Buffer.from(partes[1], 'base64url'));
    if (!ok) return null;
    const payload = JSON.parse(Buffer.from(partes[0], 'base64url').toString('utf-8'));
    const agora = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < agora) return null;

    // dupla checagem: a licenca ainda esta ativa no banco?
    const licencas = await ler('licencas', {});
    const lic = licencas[payload.chave];
    if (!lic || lic.ativa === false) return null;

    return payload;
  } catch (_) { return null; }
}
