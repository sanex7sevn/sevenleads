# ============================================
# SevenLeads SaaS — Dockerfile para Railway
# ============================================

# Build stage
FROM node:20-slim AS builder

WORKDIR /app

# Dependências de build
RUN apt-get update && apt-get install -y \
python3 \
make \
g++ \
&& rm -rf /var/lib/apt/lists/*

# Instalar dependências
COPY package.json package-lock.json ./
RUN npm ci --production=false

# Copiar projeto
COPY . .

# Build CSS
RUN npm run build:css

RUN chmod +x start.sh


# ============================================
# Runtime stage
# ============================================

FROM node:20-slim

# Chromium + SQLite + ferramentas para recompilar módulos nativos
RUN apt-get update && apt-get install -y \
chromium \
sqlite3 \
libsqlite3-0 \
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

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copiar aplicação
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/package-lock.json ./
COPY --from=builder /app/server.js ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public
COPY --from=builder /app/ecosystem.config.cjs ./
COPY --from=builder /app/start.sh ./
COPY --from=builder /app/.env.example ./

# Recompilar better-sqlite3 dentro do runtime
RUN npm rebuild better-sqlite3 --build-from-source

# Diretórios persistentes
RUN mkdir -p \
data \
data/backups \
data/receipts \
auth_sessions \
auth_info_baileys

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV SEVENLEADS_DATA_DIR=/app/data
ENV SEVENLEADS_DIR=/app

CMD ["bash", "start.sh"]
