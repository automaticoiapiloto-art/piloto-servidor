FROM node:20-alpine
WORKDIR /app

# Copia package files primeiro pra aproveitar cache de layer
COPY package*.json ./
RUN npm ci --omit=dev

# Copia o resto
COPY src ./src
COPY scripts ./scripts

# Diretorio de dados (bind mount em producao)
RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV PORT=8443
EXPOSE 8443

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O - http://localhost:8443/health || exit 1

CMD ["node", "src/index.js"]
