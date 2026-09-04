# ============================================
# SevenLeads SaaS — Dockerfile para Koyeb
# ============================================

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Instalar dependências de build para better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copiar package.json e instalar dependências
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copiar código fonte
COPY . .

# Build do CSS
RUN npm run build:css

# Garantir permissão de execução do start.sh
RUN chmod +x start.sh

# ============================================
# Runtime stage
# ============================================
FROM node:20-slim

# Instalar Chromium e dependências do Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxss1 \
    xdg-utils \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Configurar Chromium para rodar sem sandbox (necessário no Docker)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar do build stage
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/ecosystem.config.cjs ./
COPY --from=builder /app/start.sh ./
COPY --from=builder /app/.env.example ./

# Criar diretórios necessários
RUN mkdir -p data data/backups data/receipts auth_sessions auth_info_baileys

# Porta padrão
EXPOSE 3000

# Variáveis de ambiente padrão
ENV NODE_ENV=production
ENV PORT=3000
ENV SEVENLEADS_DATA_DIR=/app/data
ENV SEVENLEADS_DIR=/app

# Comando de inicialização
CMD ["bash", "start.sh"]
