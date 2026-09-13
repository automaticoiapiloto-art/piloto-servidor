/*
 * index.js — boot do servidor Express.
 *
 * Rotas:
 *   POST /api/ativar          -> emite token Ed25519 pra licenca valida
 *   GET  /api/status/:chave   -> painel admin ve o estado da chave
 *   POST /espelho/:pin        -> fila PC <-> celular
 *   GET  /espelho/:pin        -> debug
 *   GET  /health              -> healthcheck
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { rotaLicenca } from './licenca.js';
import { rotaEspelho } from './espelho.js';
import { rotaAdmin } from './admin.js';

const cfg = {
  port: Number(process.env.PORT || 8443),
  corsOrigins: (process.env.CORS_ORIGINS || '*'),
  trialDias: Number(process.env.TRIAL_DIAS || 30),
  tokenDias: Number(process.env.TOKEN_DIAS || 10),
  tokenRenovaSeg: Number(process.env.TOKEN_RENOVA_SEG || 259200),
  fpPorLic: Number(process.env.FP_POR_LIC || 3),
};

const app = express();

const corsOpts = cfg.corsOrigins === '*'
  ? { origin: true, credentials: false }
  : { origin: cfg.corsOrigins.split(',').map((s) => s.trim()), credentials: false };
app.use(cors(corsOpts));
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, uptime: process.uptime() }));
app.use('/api', rotaLicenca(cfg));
app.use('/espelho', rotaEspelho());
app.use('/admin', rotaAdmin(cfg));

app.use((err, _req, res, _next) => {
  console.error('[erro]', err);
  res.status(500).json({ erro: 'erro interno' });
});

app.listen(cfg.port, () => {
  console.log(`Piloto Automatico IA — servidor rodando em http://localhost:${cfg.port}`);
  console.log(`  POST /api/ativar`);
  console.log(`  POST /espelho/:pin`);
  console.log(`  GET  /admin      (painel admin)`);
  console.log(`  GET  /health`);
  if (!process.env.ADMIN_TOKEN) {
    console.log(`  ⚠️  ADMIN_TOKEN nao setado no .env — /admin/api/* volta 503.`);
  }
});
