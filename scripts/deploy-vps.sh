#!/bin/bash
# Deploy inicial em VPS Ubuntu/Debian.
# Uso: ssh no VPS e rode: curl -fsSL https://.../deploy-vps.sh | bash -s -- api.seudominio.com.br seu@email.com
#
# 1. Instala Docker + Docker Compose se nao tiver
# 2. Clona o projeto (ou copia via scp)
# 3. Gera chaves + admin token
# 4. Sobe docker compose
set -e

DOMINIO="${1:-api.pilotoautomaticoia.com.br}"
EMAIL="${2:-admin@pilotoautomaticoia.com.br}"
DIR="/opt/piloto-servidor"

echo "== Piloto Automatico IA — deploy VPS =="
echo "Dominio: $DOMINIO"
echo "Email  : $EMAIL"
echo ""

# 1) Docker
if ! command -v docker >/dev/null 2>&1; then
  echo "-- Instalando Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# 2) diretorio
mkdir -p "$DIR"
cd "$DIR"

# 3) arquivos — assumindo que voce SCP este diretorio antes.
if [ ! -f Dockerfile ] || [ ! -f docker-compose.yml ]; then
  echo "!! Antes de rodar, copie a pasta 'servidor/' para $DIR"
  echo "   Exemplo: scp -r servidor/ root@vps:$DIR/"
  exit 1
fi

# 4) .env
if [ ! -f .env ]; then
  cp .env.example .env
  ADMIN_TOK=$(openssl rand -base64 32)
  sed -i "s|^ADMIN_TOKEN=.*|ADMIN_TOKEN=$ADMIN_TOK|" .env
  echo "-- ADMIN_TOKEN gerado: $ADMIN_TOK"
  echo "   (Guarde este token pra acessar /admin)"
fi

# 5) troca dominio+email no Caddyfile
sed -i "s|api.pilotoautomaticoia.com.br|$DOMINIO|g" Caddyfile
sed -i "s|seu-email@dominio.com.br|$EMAIL|g" Caddyfile

# 6) chaves Ed25519 (uma vez)
if [ ! -f data/chaves.json ]; then
  docker compose run --rm piloto-api node scripts/gerar-chaves.mjs
fi

# 7) sobe
docker compose up -d --build
sleep 3

# 8) valida
echo ""
echo "-- Status:"
docker compose ps
echo ""
echo "-- Testando /health:"
curl -sk "https://$DOMINIO/health" || echo "!! Aguarde ate o Caddy pegar certificado (pode levar 30s na 1a vez)"
echo ""
echo "== Deploy pronto =="
echo "   Admin: https://$DOMINIO/admin"
echo "   Token: (veja em $DIR/.env)"
