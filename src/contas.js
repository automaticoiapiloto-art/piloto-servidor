/*
 * contas.js — sistema de contas com email + senha.
 *
 * Objetivo: usuario nao precisa decorar a chave. Ele cria uma conta associada
 * a chave (uma vez) e depois so entra com email/senha.
 *
 * Rotas:
 *   POST /api/contas/register   {email, senha, chave}   -> cria conta associada
 *   POST /api/contas/login      {email, senha}          -> {tokenSessao, ate}
 *   POST /api/contas/ativar     {tokenSessao, fp}       -> {token Ed25519, payload}
 *
 * Armazenamento: contas.json { emailNormalizado: {emailOrig, senhaHashHex, salt,
 *   chave, criadoEm, sessoes:[{token, exp, fp}]} }.
 *
 * Hash de senha: scrypt do node:crypto (nao precisa adicionar bcrypt no package).
 */
import express from 'express';
import crypto from 'node:crypto';
import { ler, gravar } from './storage.js';
import { assinarPayload } from './crypto.js';

const SESSAO_DIAS = 60; // token de login vale 60 dias

function normEmail(e) { return String(e || '').trim().toLowerCase(); }
function hashSenha(senha, saltHex) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(senha || ''), salt, 32);
  return { hashHex: hash.toString('hex'), saltHex: salt.toString('hex') };
}
function conferirSenha(senha, saltHex, hashHex) {
  try {
    const cand = crypto.scryptSync(String(senha || ''), Buffer.from(saltHex, 'hex'), 32);
    const alvo = Buffer.from(hashHex, 'hex');
    return cand.length === alvo.length && crypto.timingSafeEqual(cand, alvo);
  } catch (_) { return false; }
}
function novoToken() { return crypto.randomBytes(24).toString('hex'); }

export function rotaContas(cfg) {
  const r = express.Router();

  // POST /register — cria conta associada a uma chave existente
  r.post('/register', async (req, res) => {
    const email = normEmail(req.body?.email);
    const senha = String(req.body?.senha || '');
    const chave = String(req.body?.chave || '').trim();
    if (!email || !email.includes('@')) return res.status(400).json({ erro: 'email invalido' });
    if (senha.length < 6) return res.status(400).json({ erro: 'senha muito curta (min 6)' });
    if (!chave) return res.status(400).json({ erro: 'chave obrigatoria pra registrar' });

    // valida a chave (precisa existir e estar ativa)
    const licencas = await ler('licencas', {});
    const lic = licencas[chave];
    if (!lic) return res.status(404).json({ erro: 'chave nao encontrada' });
    if (lic.ativa === false) return res.status(403).json({ erro: 'chave inativa' });

    const contas = await ler('contas', {});
    if (contas[email]) return res.status(409).json({ erro: 'ja existe conta com esse email — use login' });

    const { hashHex, saltHex } = hashSenha(senha);
    contas[email] = {
      emailOrig: String(req.body.email).trim(),
      senhaHashHex: hashHex,
      salt: saltHex,
      chave,
      criadoEm: Math.floor(Date.now() / 1000),
      sessoes: [],
    };
    await gravar('contas', contas);
    res.json({ ok: true, email });
  });

  // POST /login — valida email/senha, devolve tokenSessao
  r.post('/login', async (req, res) => {
    const email = normEmail(req.body?.email);
    const senha = String(req.body?.senha || '');
    if (!email || !senha) return res.status(400).json({ erro: 'email e senha obrigatorios' });

    const contas = await ler('contas', {});
    const c = contas[email];
    if (!c) return res.status(404).json({ erro: 'conta nao encontrada' });
    if (!conferirSenha(senha, c.salt, c.senhaHashHex)) {
      return res.status(401).json({ erro: 'senha incorreta' });
    }

    const tokenSessao = novoToken();
    const exp = Math.floor(Date.now() / 1000) + SESSAO_DIAS * 86400;
    c.sessoes = (c.sessoes || []).filter((s) => s.exp > Math.floor(Date.now() / 1000)).slice(-9);
    c.sessoes.push({ token: tokenSessao, exp, criadoEm: Math.floor(Date.now() / 1000) });
    await gravar('contas', contas);
    res.json({ tokenSessao, ate: exp, email });
  });

  // POST /ativar — troca tokenSessao + fingerprint por token Ed25519 da licenca
  r.post('/ativar', async (req, res) => {
    const email = normEmail(req.body?.email);
    const tokenSessao = String(req.body?.tokenSessao || '').trim();
    const fp = String(req.body?.fingerprint || '').trim();
    if (!email || !tokenSessao || !fp) return res.status(400).json({ erro: 'email, tokenSessao e fingerprint obrigatorios' });

    const contas = await ler('contas', {});
    const c = contas[email];
    if (!c) return res.status(404).json({ erro: 'conta nao encontrada' });

    const agora = Math.floor(Date.now() / 1000);
    const sessao = (c.sessoes || []).find((s) => s.token === tokenSessao && s.exp > agora);
    if (!sessao) return res.status(401).json({ erro: 'sessao expirada — faca login de novo' });

    const licencas = await ler('licencas', {});
    const lic = licencas[c.chave];
    if (!lic) return res.status(404).json({ erro: 'chave da conta nao existe mais' });
    if (lic.ativa === false) return res.status(403).json({ erro: 'chave inativa' });
    if (lic.validoAte && agora > lic.validoAte) return res.status(403).json({ erro: 'chave expirada' });

    // registra o fingerprint na licenca (limite de maquinas)
    lic.fingerprints = lic.fingerprints || [];
    if (!lic.fingerprints.includes(fp)) {
      if (lic.fingerprints.length >= cfg.fpPorLic) {
        return res.status(403).json({ erro: 'limite de maquinas atingido', limite: cfg.fpPorLic });
      }
      lic.fingerprints.push(fp);
    }
    lic.ultimaAtivacao = agora;
    lic.ultimoFp = fp;
    await gravar('licencas', licencas);

    const par = await ler('chaves', null);
    if (!par || !par.privPem) return res.status(500).json({ erro: 'servidor sem par de chaves' });
    const exp = Math.min(lic.validoAte || (agora + cfg.tokenDias * 86400), agora + cfg.tokenDias * 86400);
    const payload = { chave: c.chave, fp, exp, plano: lic.plano || 'padrao', emitidoEm: agora };
    const token = assinarPayload(payload, par.privPem);
    res.json({ token, payload, ate: exp });
  });

  return r;
}
