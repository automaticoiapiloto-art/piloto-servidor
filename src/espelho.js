/*
 * espelho.js — rota /espelho/:pin (fila entre PC e celular).
 *
 * O PC (motor espelho.js) chama POST com metricas -> guarda estado e devolve
 * o comando pendente (se houver). O celular (PWA) chama POST com {app:true}
 * -> le o estado E, opcionalmente, deixa um comando ({acao:'encerrar'|'falso_alarme'}).
 *
 * Sem banco: cache em memoria com TTL curto (30 min). Se cair o processo, o
 * celular reconecta e o PC re-publica em 3s. O PIN eh o identificador — deve
 * ser aleatorio e trocavel.
 */
import express from 'express';

export function rotaEspelho() {
  const r = express.Router();
  const estados = new Map(); // pin -> {estado, at}
  const comandos = new Map(); // pin -> [{acao, at}]
  const TTL_MS = 30 * 60_000;

  function limparAntigos() {
    const corte = Date.now() - TTL_MS;
    for (const [pin, e] of estados) if (e.at < corte) estados.delete(pin);
    for (const [pin, fila] of comandos) {
      const viva = (fila || []).filter((c) => c.at > corte);
      if (viva.length) comandos.set(pin, viva);
      else comandos.delete(pin);
    }
  }
  setInterval(limparAntigos, 5 * 60_000);

  r.post('/:pin', (req, res) => {
    const pin = String(req.params.pin || '').trim();
    if (!pin || pin.length > 64) return res.status(400).json({ erro: 'pin invalido' });
    const body = req.body || {};
    const agora = Date.now();

    // veio do celular?
    if (body.app === true) {
      if (body.acao) {
        const fila = comandos.get(pin) || [];
        fila.push({ acao: String(body.acao), at: agora });
        comandos.set(pin, fila);
      }
      const est = estados.get(pin);
      if (!est) return res.json({ vazio: true });
      return res.json(est.estado);
    }

    // veio do PC — grava estado, devolve comando pendente
    estados.set(pin, { estado: body, at: agora });
    const fila = comandos.get(pin) || [];
    if (fila.length) {
      const c = fila.shift();
      comandos.set(pin, fila);
      return res.json({ ok: true, acao: c.acao });
    }
    res.json({ ok: true });
  });

  // rota GET simples pra debug (mostra o ultimo estado)
  r.get('/:pin', (req, res) => {
    const est = estados.get(req.params.pin);
    if (!est) return res.status(404).json({ erro: 'sem estado' });
    res.json({ estado: est.estado, atualizadoHa: Math.floor((Date.now() - est.at) / 1000) + 's' });
  });

  return r;
}
