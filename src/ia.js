/*
 * ia.js — rota /api/ia/responder.
 *
 * Recebe {token, produto, faq, autor, pergunta} do cliente. Valida a licenca
 * pelo header, monta prompt pra Anthropic Haiku, devolve a resposta.
 *
 * Rate limit por licenca: 1 pergunta a cada 3s (evita spam do proprio motor);
 * Guarda historia curta em memoria pra nao responder mesma pergunta 2x em 60s.
 */
import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { ler } from './storage.js';
import { verificarTokenPorLicenca } from './licenca-verify.js';

const MODEL = process.env.IA_MODEL || 'claude-haiku-4-5-20251001';
const MAX_TOKENS_OUT = 220;

export function rotaIA(cfg) {
  const r = express.Router();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('⚠️  ANTHROPIC_API_KEY nao setada — /api/ia/responder vai devolver 503');
  }
  const cliente = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : null;

  // rate limit por chave
  const ultimoAt = new Map(); // chave -> ts
  const cache = new Map(); // chave|pergunta -> {resposta, at}

  r.post('/responder', async (req, res) => {
    if (!cliente) return res.status(503).json({ erro: 'IA nao configurada no servidor' });

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
    if (c && (agora - c.at < 60_000)) return res.json({ resposta: c.resposta, cached: true });

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
      const resp = await cliente.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS_OUT,
        system,
        messages: [{ role: 'user', content: user }],
      });
      let texto = '';
      for (const bloco of resp.content || []) {
        if (bloco.type === 'text') texto += bloco.text;
      }
      texto = texto.trim();
      // limita tamanho pra chat da live
      if (texto.length > 200) texto = texto.slice(0, 197) + '...';

      cache.set(chaveCache, { resposta: texto, at: agora });
      // limpa cache antigo esporadicamente
      if (cache.size > 500) {
        for (const [k, v] of cache) if (agora - v.at > 60_000) cache.delete(k);
      }

      return res.json({ resposta: texto });
    } catch (e) {
      console.error('[ia] erro:', e && (e.status || ''), e && e.message, e && e.error);
      // devolve detalhe do erro (nao expoe a chave em si)
      const msg = (e && e.message) || 'erro desconhecido';
      const status = (e && e.status) || 502;
      return res.status(status).json({
        erro: 'IA nao respondeu',
        detalhe: msg.slice(0, 200),
      });
    }
  });

  return r;
}
