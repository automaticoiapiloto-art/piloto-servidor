/*
 * licenca.js — rota /api/ativar.
 *
 * Recebe {chave, fingerprint}, valida contra data/licencas.json, respeita o
 * limite de fingerprints por licenca (FP_POR_LIC), emite token Ed25519 com
 * validade TOKEN_DIAS. O token e verificado OFFLINE pelo cliente com a chave
 * publica embutida em piloto/src/license.js.
 */
import express from 'express';
import { ler, gravar } from './storage.js';
import { assinarPayload } from './crypto.js';

export function rotaLicenca(cfg) {
  const r = express.Router();

  r.post('/ativar', async (req, res) => {
    const chave = String(req.body?.chave || '').trim();
    const fp = String(req.body?.fingerprint || '').trim();
    if (!chave || !fp) return res.status(400).json({ erro: 'chave e fingerprint sao obrigatorios' });

    const licencas = await ler('licencas', {});
    const par = await ler('chaves', null);
    if (!par || !par.privPem) return res.status(500).json({ erro: 'servidor sem par de chaves (rode: npm run gerar-chaves)' });

    const lic = licencas[chave];
    if (!lic) return res.status(404).json({ erro: 'chave nao encontrada' });
    if (lic.ativa === false) return res.status(403).json({ erro: 'chave inativa' });
    const agora = Math.floor(Date.now() / 1000);
    if (lic.validoAte && agora > lic.validoAte) return res.status(403).json({ erro: 'chave expirada' });

    lic.fingerprints = lic.fingerprints || [];
    if (!lic.fingerprints.includes(fp)) {
      if (lic.fingerprints.length >= cfg.fpPorLic) {
        return res.status(403).json({ erro: 'limite de maquinas atingido', limite: cfg.fpPorLic });
      }
      lic.fingerprints.push(fp);
      lic.ativadaEm = lic.ativadaEm || agora;
      await gravar('licencas', licencas);
    }
    lic.ultimaAtivacao = agora;
    lic.ultimoFp = fp;
    await gravar('licencas', licencas);

    const exp = Math.min(lic.validoAte || (agora + cfg.tokenDias * 86400), agora + cfg.tokenDias * 86400);
    const payload = {
      chave,
      fp,
      exp,
      plano: lic.plano || 'padrao',
      emitidoEm: agora,
    };
    const token = assinarPayload(payload, par.privPem);
    return res.json({ token, payload, ate: exp });
  });

  r.get('/status/:chave', async (req, res) => {
    const licencas = await ler('licencas', {});
    const lic = licencas[req.params.chave];
    if (!lic) return res.status(404).json({ erro: 'nao existe' });
    res.json({
      plano: lic.plano || 'padrao',
      ativa: lic.ativa !== false,
      validoAte: lic.validoAte || null,
      maquinas: (lic.fingerprints || []).length,
    });
  });

  return r;
}
