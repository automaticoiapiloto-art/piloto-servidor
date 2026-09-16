/*
 * ia.js — rota /api/ia/responder.
 *
 * Recebe {token, produto, faq, autor, pergunta} do cliente. Valida a licenca
 * pelo header, monta prompt, roteia pra Gemini (gratis, padrao) ou Anthropic
 * (pago, opcional), devolve a resposta.
 *
 * Provider e' escolhido por env IA_PROVIDER (gemini|anthropic). Default: gemini
 * se GEMINI_API_KEY estiver setada, senao anthropic.
 *
 * Rate limit por licenca: 1 pergunta a cada 3s (evita spam do proprio motor);
 * Guarda historia curta em memoria pra nao responder mesma pergunta 2x em 60s.
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { verificarTokenPorLicenca } from './licenca-verify.js';

const ANTHROPIC_MODEL = process.env.IA_MODEL || 'claude-haiku-4-5-20251001';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const MAX_TOKENS_OUT = 220;

function providerAtivo() {
  const explicito = (process.env.IA_PROVIDER || '').toLowerCase().trim();
  if (explicito === 'gemini' || explicito === 'anthropic') return explicito;
  if (process.env.GEMINI_API_KEY) return 'gemini';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

async function chamarGemini(system, user) {
  const key = process.env.GEMINI_API_KEY;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: {
      maxOutputTokens: MAX_TOKENS_OUT,
      temperature: 0.7,
    },
    // filtros de seguranca em BLOCK_ONLY_HIGH — chat de live nao pode ser bloqueado a toa
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
    ],
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = await r.text().catch(() => '');
    const err = new Error(`gemini ${r.status}: ${txt.slice(0, 200)}`);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const cand = (data.candidates && data.candidates[0]) || null;
  if (!cand) return '';
  const partes = (cand.content && cand.content.parts) || [];
  return partes.map((p) => p.text || '').join('').trim();
}

async function chamarAnthropic(cliente, system, user) {
  const resp = await cliente.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: MAX_TOKENS_OUT,
    system,
    messages: [{ role: 'user', content: user }],
  });
  let texto = '';
  for (const bloco of resp.content || []) {
    if (bloco.type === 'text') texto += bloco.text;
  }
  return texto.trim();
}

export function rotaIA(cfg) {
  const r = express.Router();
  const prov = providerAtivo();
  if (!prov) {
    console.warn('⚠️  Nenhuma chave de IA setada (GEMINI_API_KEY ou ANTHROPIC_API_KEY) — /api/ia/responder vai devolver 503');
  } else {
    console.log(`[ia] provider ativo: ${prov} (modelo: ${prov === 'gemini' ? GEMINI_MODEL : ANTHROPIC_MODEL})`);
  }

  const clienteAnthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        // se a chave for de organizacao (nao de workspace), precisa do
        // header anthropic-workspace-id. Chave de workspace nao precisa.
        defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
          ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
          : {},
      })
    : null;

  // rate limit por chave
  const ultimoAt = new Map(); // chave -> ts
  const cache = new Map(); // chave|pergunta -> {resposta, at}

  r.post('/responder', async (req, res) => {
    const provAtual = providerAtivo();
    if (!provAtual) return res.status(503).json({ erro: 'IA nao configurada no servidor' });
    if (provAtual === 'anthropic' && !clienteAnthropic) return res.status(503).json({ erro: 'IA (anthropic) nao configurada' });

    // valida licenca pelo header
    const auth = req.headers.authorization || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    const valida = await verificarTokenPorLicenca(token);
    if (!valida) return res.status(401).json({ erro: 'licenca invalida' });
    // so pro/premium/dev usam IA
    if (!['pro', 'premium', 'dev'].includes(valida.plano)) {
      return res.status(403).json({ erro: 'plano nao inclui IA' });
    }

    const { produto, faq, autor, pergunta } = req.body || {};
    if (!pergunta || typeof pergunta !== 'string') return res.status(400).json({ erro: 'pergunta obrigatoria' });
    if (pergunta.length > 300) return res.status(400).json({ erro: 'pergunta muito longa' });

    // rate limit por chave: 1 request a cada 3s
    const agora = Date.now();
    const ult = ultimoAt.get(valida.chave) || 0;
    if (agora - ult < 3000) return res.status(429).json({ erro: 'rate limit — espere um pouco' });
    ultimoAt.set(valida.chave, agora);

    // dedup: se ja respondeu pergunta identica nos ultimos 60s pra essa chave, devolve do cache
    const chaveCache = valida.chave + '|' + (pergunta.trim().toLowerCase().slice(0, 80));
    const c = cache.get(chaveCache);
    if (c && (agora - c.at < 60_000)) return res.json({ resposta: c.resposta, cached: true, provider: provAtual });

    // monta o prompt
    const system = `Voce e o assistente de um vendedor durante uma live. Responda de forma direta, humana e simpatica, como se fosse a propria pessoa vendedora escrevendo no chat de sua live. Regras:
- Curta (1-2 frases, no maximo 200 caracteres)
- Nunca use markdown, negrito, links, ou formatacao
- Use portugues informal brasileiro
- Trate a pessoa pelo primeiro nome dela quando fizer sentido
- Se a pergunta for sobre onde comprar, direcione pra sacolinha ou "link na bio" (nunca coloque URL no texto)
- Se a pergunta nao for uma pergunta real (so emoji, saudacao, spam), responda "" (string vazia)
- Nunca invente informacoes que nao estao no CONTEXTO abaixo. Se nao souber, diga "vou responder no direct depois!"

CONTEXTO DO PRODUTO:
${produto || '(vendedor nao configurou o contexto do produto)'}

PERGUNTAS FREQUENTES E RESPOSTAS PREPARADAS:
${faq || '(sem faq configurada)'}`;

    const user = `${autor || 'Cliente'}: ${pergunta.trim()}`;

    try {
      let texto = '';
      if (provAtual === 'gemini') {
        texto = await chamarGemini(system, user);
      } else {
        texto = await chamarAnthropic(clienteAnthropic, system, user);
      }
      // limita tamanho pra chat da live
      if (texto.length > 200) texto = texto.slice(0, 197) + '...';

      cache.set(chaveCache, { resposta: texto, at: agora });
      // limpa cache antigo esporadicamente
      if (cache.size > 500) {
        for (const [k, v] of cache) if (agora - v.at > 60_000) cache.delete(k);
      }

      return res.json({ resposta: texto, provider: provAtual });
    } catch (e) {
      console.error('[ia] erro:', provAtual, e && (e.status || ''), e && e.message);
      const msg = (e && e.message) || 'erro desconhecido';
      const status = (e && e.status) || 502;
      return res.status(status).json({
        erro: 'IA nao respondeu',
        provider: provAtual,
        detalhe: msg.slice(0, 200),
      });
    }
  });

  return r;
}
