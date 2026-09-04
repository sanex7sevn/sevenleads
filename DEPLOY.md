# Deploy — SevenLeads SaaS

Guia passo a passo para colocar o SaaS no ar em uma VPS Ubuntu.

## Pré-requisitos

- VPS Ubuntu 22.04+ (mínimo 1GB RAM)
- Domínio apontado para o IP da VPS
- Node.js 20+
- Acesso SSH root

## 1. Preparar o servidor

```bash
apt update && apt upgrade -y

# Instalar Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Dependências do Puppeteer (Chromium headless)
apt install -y chromium-browser fonts-liberation libappindicator3-1 libasound2 libatk-bridge2.0-0 libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxss1 xdg-utils

# PM2 e Nginx
npm install -g pm2
apt install -y nginx certbot python3-certbot-nginx
```

## 2. Subir o código

```bash
cd /opt
git clone https://github.com/SEU-USER/sevenleads.git
cd sevenleads

npm install

# Criar .env
cp .env.example .env
nano .env   # Preencher JWT_SECRET, ADMIN_PASSWORD, PIX_KEY, APP_URL
```

## 3. Iniciar com PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup   # segue as instruções do output
```

## 4. Configurar Nginx

```bash
cp nginx.example.conf /etc/nginx/sites-available/sevenleads
# Edite o arquivo e substitua seu-dominio.com.br pelo domínio real

ln -sf /etc/nginx/sites-available/sevenleads /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx
```

## 5. SSL com Certbot

```bash
certbot --nginx -d seu-dominio.com.br -d www.seu-dominio.com.br
```

## 6. Monitorar

```bash
pm2 logs sevenleads    # ver logs em tempo real
pm2 status                  # status do processo
```

## Variáveis de Ambiente (.env)

| Variável | Obrigatória | Descrição |
|----------|------------|-----------|
| PORT | Não | Porta do servidor (padrão 3000) |
| APP_URL | Sim | URL pública (https://dominio.com.br) |
| JWT_SECRET | Sim em prod | Segredo JWT (openssl rand -hex 32) |
| ADMIN_EMAIL | Sim | E-mail da conta administradora |
| ADMIN_PASSWORD | Sim | Senha forte da conta administradora |
| PIX_KEY | Sim | Chave PIX exibida aos clientes; aprovação permanece manual |
| SMTP_HOST/USER/PASS | Não | SMTP para envio de e-mails reais |
| NOMINATIM_URL | Não | Geocodificador usado pelas fontes OpenStreetMap e All World |
| OVERPASS_URLS | Não | Endpoints separados por vírgula para pesquisa de estabelecimentos |
| OSM_USER_AGENT | Não | Identificação pública e contato do aplicativo ao consultar OpenStreetMap |

Em produção com tráfego comercial, use instâncias próprias ou um provedor contratado de Nominatim/Overpass. Não dependa das instâncias comunitárias para alto volume.

## Backup do banco

```bash
# O banco fica em data/sevenleads.sqlite
cp data/sevenleads.sqlite /backup/sevenleads_$(date +%Y%m%d).sqlite
```

## Comandos úteis

```bash
pm2 restart sevenleads    # reiniciar
pm2 logs sevenleads       # ver logs
pm2 monit                      # monitorar CPU/memória
```
