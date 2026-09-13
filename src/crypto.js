/*
 * crypto.js — Ed25519 via Node nativo (crypto). Sem dependencia externa.
 *
 * O par (privKey, pubKey) e gerado uma vez em data/chaves.json pelo script
 * scripts/gerar-chaves.mjs; ambos ficam em PEM. A chave publica em base64
 * (raw 32 bytes) tambem eh impressa pra colar em piloto/src/license.js.
 */
import crypto from 'node:crypto';

// gera par novo
export function gerarPar() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pubRaw = publicKey.export({ format: 'der', type: 'spki' });
  // Ed25519 raw = ultimos 32 bytes do SPKI DER (12 bytes de prefixo padrao)
  const raw = pubRaw.subarray(pubRaw.length - 32);
  return {
    pubPem: publicKey.export({ format: 'pem', type: 'spki' }),
    privPem: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    pubRawB64: raw.toString('base64'),
  };
}

// assina JSON payload -> token base64url("payload").base64url(sig)
export function assinarPayload(payload, privPem) {
  const priv = crypto.createPrivateKey(privPem);
  const payloadStr = JSON.stringify(payload);
  const payloadB64u = Buffer.from(payloadStr, 'utf-8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(payloadB64u, 'utf-8'), priv);
  const sigB64u = sig.toString('base64url');
  return payloadB64u + '.' + sigB64u;
}

export function verificar(token, pubPem) {
  const [p, s] = String(token).split('.');
  if (!p || !s) return null;
  try {
    const pub = crypto.createPublicKey(pubPem);
    const ok = crypto.verify(null, Buffer.from(p, 'utf-8'), pub, Buffer.from(s, 'base64url'));
    if (!ok) return null;
    return JSON.parse(Buffer.from(p, 'base64url').toString('utf-8'));
  } catch (_) { return null; }
}
