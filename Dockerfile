FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
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

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json ./

RUN npm install

COPY . .

RUN npm run build:css

RUN node -e "const Database=require('better-sqlite3'); console.log('IMPORT OK'); const db=new Database(':memory:'); console.log('SQLITE MEMORY OK'); db.prepare('SELECT 1').get(); db.close(); console.log('BETTER-SQLITE3 TEST OK');"

RUN chmod +x start.sh

RUN mkdir -p \
    /app/data \
    /app/data/backups \
    /app/data/receipts \
    /app/data/auth_sessions \
    /app/data/auth_info_baileys

ENV NODE_ENV=production
ENV PORT=3000
ENV SEVENLEADS_DATA_DIR=/app/data
ENV SEVENLEADS_DIR=/app

EXPOSE 3000

CMD ["bash", "start.sh"]
