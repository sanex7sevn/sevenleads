# ============================================
# SevenLeads SaaS — Dockerfile para Railway
# ============================================

# ============================================
# 1. BUILD
# ============================================

FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Dependências necessárias para módulos nativos
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Evitar download do Chromium pelo Puppeteer
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Instalar todas as dependências, incluindo devDependencies
COPY package.json package-lock.json ./

RUN npm ci

# Copiar código
COPY . .

# Gerar Tailwind CSS
RUN npm run build:css

# Permissão do script
RUN chmod +x start.sh


# ============================================
# 2. RUNTIME
# ============================================

FROM node:20-bookworm-slim

WORKDIR /app

# Chromium + bibliotecas + ferramentas para compilar better-sqlite3
RUN apt-get update && apt-get install -y \
    chromium \
    sqlite3 \
    libsqlite3-0 \
    libsqlite3-dev \
    python3 \
    make \
    g++ \
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

# Puppeteer usará o Chromium instalado pelo Debian
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# ============================================
# Instalar dependências DIRETAMENTE no runtime
# ============================================

COPY package.json package-lock.json ./

# Forçar módulos nativos a serem compilados neste container
RUN npm_config_build_from_source=true npm ci --omit=dev

# Recompilar explicitamente o better-sqlite3
RUN npm rebuild better-sqlite3 --build-from-source

# Teste durante o próprio BUILD.
# Se better-sqlite3 estiver quebrado, o build para aqui.
RUN node -e "const Database=require('better-sqlite3'); const db=new Database(':memory:'); console.log('better-sqlite3 BUILD TEST OK'); db.prepare('SELECT 1').get(); db.close();"

# ============================================
# Copiar aplicação
# ============================================

COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/ecosystem.config.cjs ./ecosystem.config.cjs
COPY --from=builder /app/start.sh ./start.sh
COPY --from=builder /app/.env.example ./.env.example

RUN chmod +x start.sh

# Diretórios utilizados pelo SevenLeads
RUN mkdir -p \
    /app/data \
    /app/data/backups \
    /app/data/receipts \
    /app/data/auth_sessions \
    /app/data/auth_info_baileys

# ============================================
# Railway
# ============================================

ENV NODE_ENV=production
ENV PORT=3000
ENV SEVENLEADS_DATA_DIR=/app/data
ENV SEVENLEADS_DIR=/app

EXPOSE 3000

CMD ["bash", "start.sh"]
