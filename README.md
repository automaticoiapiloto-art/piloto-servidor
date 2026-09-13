# Piloto Automático IA — Servidor

Node/Express. Faz duas coisas:

1. **Licenças** (`/api/ativar`) — recebe `{chave, fingerprint}`, valida contra o banco, devolve token Ed25519 assinado
2. **Espelho** (`/espelho/:pin`) — fila entre o PC (extensão) e o celular (PWA)

Mais um **painel admin** em `/admin` pra você emitir/desativar/listar licenças pelo navegador.

## Rodar (dev)

```bash
cp .env.example .env
# EDITE .env — pelo menos defina ADMIN_TOKEN
npm install
npm run gerar-chaves          # gera par Ed25519 UMA vez (rode --forcar pra regenerar)
# COLE a chave pública impressa em piloto/src/license.js na constante PUB_KEY_B64
npm start                     # http://localhost:8443
```

## Emitir licenças

Por CLI:
```bash
npm run emitir -- --plano basico --dias 365 --cliente "Fulano da Silva"
npm run emitir -- --plano pro --dias 30 --cliente "Trial pro"
npm run listar                # lista todas
```

Por painel: acesse `http://localhost:8443/admin`, cole o `ADMIN_TOKEN` do `.env` e emita/gerencie visualmente.

## Rotas

### Público
- `GET  /health` — `{ok, uptime}` (healthcheck)
- `POST /api/ativar` — `{chave, fingerprint}` → `{token, payload, ate}` ou `{erro}`
- `GET  /api/status/:chave` — info da licença (não expõe fingerprints)
- `POST /espelho/:pin` — do PC: manda métricas / do PWA: `{app:true, acao?}`
- `GET  /espelho/:pin` — debug: último estado

### Admin (header `x-admin-token`)
- `GET  /admin` — HTML do painel
- `GET  /admin/api/licencas` — lista todas
- `POST /admin/api/emitir` — `{plano, dias, cliente, chave?}` → cria nova
- `POST /admin/api/desativar` — `{chave}` → inativa
- `POST /admin/api/reativar` — `{chave}` → reativa
- `POST /admin/api/reset-fp` — `{chave}` → apaga fingerprints (cliente trocou de PC)
- `POST /admin/api/estender` — `{chave, dias}` → soma dias ao validoAte

## Persistência

Sem banco. JSON em `data/`:

- `data/chaves.json` — **par Ed25519 (nunca commite!)**
- `data/licencas.json` — todas as licenças emitidas
- `data/versao.json` — versão publicada da extensão (pra update-check)

Escritas serializadas (não corrompem em concorrência). Pra escala > 10k clientes, migre pra Postgres.

## Deploy em VPS (Docker + Caddy)

Uma vez:
```bash
# no seu computador local
scp -r servidor/ root@seu-vps:/opt/piloto-servidor/

# no VPS
ssh root@seu-vps
cd /opt/piloto-servidor
bash scripts/deploy-vps.sh api.seudominio.com.br seu@email.com
```

O `deploy-vps.sh` instala Docker, gera `ADMIN_TOKEN` aleatório, atualiza `Caddyfile`, gera par Ed25519 e sobe. Caddy pega certificado Let's Encrypt automático.

Atualizações depois:
```bash
scp -r servidor/ root@seu-vps:/opt/piloto-servidor/
ssh root@seu-vps 'cd /opt/piloto-servidor && docker compose up -d --build'
```

## Backup

O que precisa backup:
- `data/chaves.json` — se perder, invalida TODAS as licenças ativas (todas viram inválidas até você regerar par + reemitir todas)
- `data/licencas.json` — banco de clientes

Cronjob simples:
```bash
0 3 * * * cd /opt/piloto-servidor && tar -czf /root/backup-$(date +\%Y\%m\%d).tar.gz data/
```

## Ambiente

Veja `.env.example`. Variáveis:
- `PORT` — porta HTTP (default 8443)
- `CORS_ORIGINS` — lista separada por vírgula, `*` em dev
- `TRIAL_DIAS` — dias default pra `emitir` sem `--dias`
- `TOKEN_DIAS` — validade do token Ed25519
- `TOKEN_RENOVA_SEG` — janela em que o cliente já pede renovação
- `FP_POR_LIC` — max fingerprints por licença (default 3)
- `ADMIN_TOKEN` — obrigatório em produção pra `/admin/api/*`
