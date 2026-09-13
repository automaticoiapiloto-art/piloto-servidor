/*
 * admin.js — painel administrativo.
 *
 * Protecao: header X-Admin-Token bate com process.env.ADMIN_TOKEN.
 * Se ADMIN_TOKEN nao estiver setado no .env, o painel eh recusado (nao expoe
 * dados por engano em deploy sem senha).
 *
 * Rotas:
 *   GET  /admin                        -> HTML do painel
 *   GET  /admin/api/licencas           -> lista todas
 *   POST /admin/api/emitir             -> {plano, dias, cliente, chave?} emite nova
 *   POST /admin/api/desativar          -> {chave} inativa
 *   POST /admin/api/reativar           -> {chave} ativa de novo
 *   POST /admin/api/reset-fp           -> {chave} apaga fingerprints (cliente trocou de PC)
 *   POST /admin/api/estender           -> {chave, dias} soma dias ao validoAte
 *   GET  /admin/api/versao             -> versao atual da extensao (para update-check)
 *   POST /admin/api/versao             -> {versao, changelog} setar versao publicada
 */
import express from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ler, gravar } from './storage.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function rotaAdmin(cfg) {
  const r = express.Router();
  const TOKEN = process.env.ADMIN_TOKEN || '';

  function protegido(req, res, next) {
    if (!TOKEN) return res.status(503).json({ erro: 'ADMIN_TOKEN nao configurado no .env' });
    const t = req.headers['x-admin-token'] || req.query.token || '';
    if (t !== TOKEN) return res.status(401).json({ erro: 'token invalido' });
    next();
  }

  // pagina HTML — carregada sem token pra mostrar a tela de login; a tela pede
  // o token e passa em todas as chamadas /admin/api/*.
  r.get('/', async (_req, res) => {
    const html = await readFile(path.resolve(__dirname, 'admin.html'), 'utf-8');
    res.set('content-type', 'text/html; charset=utf-8').send(html);
  });

  r.get('/api/licencas', protegido, async (_req, res) => {
    const licencas = await ler('licencas', {});
    const entries = Object.entries(licencas).map(([chave, l]) => ({
      chave,
      plano: l.plano,
      cliente: l.cliente,
      ativa: l.ativa !== false,
      criadaEm: l.criadaEm,
      validoAte: l.validoAte,
      maquinas: (l.fingerprints || []).length,
      ultimaAtivacao: l.ultimaAtivacao || 0,
    }));
    entries.sort((a, b) => (b.criadaEm || 0) - (a.criadaEm || 0));
    res.json({ total: entries.length, licencas: entries });
  });

  r.post('/api/emitir', protegido, async (req, res) => {
    const plano = req.body.plano || 'basico';
    const dias = Number(req.body.dias || cfg.trialDias || 30);
    const cliente = req.body.cliente || '';
    let chave = req.body.chave || gerarChave();
    const licencas = await ler('licencas', {});
    if (licencas[chave] && !req.body.forcar) return res.status(409).json({ erro: 'chave ja existe' });
    const agora = Math.floor(Date.now() / 1000);
    licencas[chave] = {
      ativa: true, plano, cliente,
      criadaEm: agora,
      validoAte: dias > 0 ? agora + dias * 86400 : null,
      fingerprints: [],
    };
    await gravar('licencas', licencas);
    res.json({ ok: true, chave, plano, cliente, validoAte: licencas[chave].validoAte });
  });

  r.post('/api/desativar', protegido, async (req, res) => {
    const licencas = await ler('licencas', {});
    const chave = req.body.chave;
    if (!licencas[chave]) return res.status(404).json({ erro: 'nao existe' });
    licencas[chave].ativa = false;
    await gravar('licencas', licencas);
    res.json({ ok: true });
  });

  r.post('/api/reativar', protegido, async (req, res) => {
    const licencas = await ler('licencas', {});
    const chave = req.body.chave;
    if (!licencas[chave]) return res.status(404).json({ erro: 'nao existe' });
    licencas[chave].ativa = true;
    await gravar('licencas', licencas);
    res.json({ ok: true });
  });

  r.post('/api/reset-fp', protegido, async (req, res) => {
    const licencas = await ler('licencas', {});
    const chave = req.body.chave;
    if (!licencas[chave]) return res.status(404).json({ erro: 'nao existe' });
    licencas[chave].fingerprints = [];
    await gravar('licencas', licencas);
    res.json({ ok: true });
  });

  r.post('/api/estender', protegido, async (req, res) => {
    const licencas = await ler('licencas', {});
    const chave = req.body.chave;
    const dias = Number(req.body.dias || 30);
    if (!licencas[chave]) return res.status(404).json({ erro: 'nao existe' });
    const agora = Math.floor(Date.now() / 1000);
    const base = Math.max(licencas[chave].validoAte || 0, agora);
    licencas[chave].validoAte = base + dias * 86400;
    await gravar('licencas', licencas);
    res.json({ ok: true, novoValidoAte: licencas[chave].validoAte });
  });

  r.get('/api/versao', async (_req, res) => {
    const v = await ler('versao', { versao: '0.1.0', changelog: '' });
    res.json(v);
  });

  r.post('/api/versao', protegido, async (req, res) => {
    const v = { versao: String(req.body.versao || ''), changelog: String(req.body.changelog || ''), setEm: Math.floor(Date.now() / 1000) };
    await gravar('versao', v);
    res.json({ ok: true, versao: v.versao });
  });

  return r;
}

function gerarChave() {
  const alfa = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) {
    if (i && i % 4 === 0) s += '-';
    s += alfa[bytes[i] % alfa.length];
  }
  return s;
}
