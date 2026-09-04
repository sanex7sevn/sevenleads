# 🗺️ SevenLeads SaaS (Multi-Tenant B2B Leads)

Sistema completo de prospecção B2B no Google Maps, OpenStreetMap Brasil e All World, com disparo de WhatsApp individual, banco de dados SQLite, controle de assinaturas semanais (R$ 20/semana via PIX) e Central de Controle do Administrador.

---

## ⚡ Novas Funcionalidades SaaS

1. 🔐 **Autenticação e Multi-Tenant:** Cada cliente cria sua conta e acessa seu próprio painel.
2. 🤖 **WhatsApp Isolado:** Cada usuário conecta seu próprio WhatsApp sem interferir nos outros (`auth_sessions/user_<id>`).
3. 👑 **Central de Controle (Painel Admin):**
   - Controle total de clientes (Ativar, Bloquear, Excluir).
   - Botão **"+7 Dias (R$ 20 Pago)"** para prorrogar assinaturas com 1 clique.
   - Métricas em tempo real: Clientes ativos, expirados, total de buscas.
   - Troca dinâmica de Chave PIX.
4. 💸 **Sistema de Assinaturas (R$ 20/semana):**
   - Modal com Chave PIX Copia-e-Cola para o cliente.
   - Alerta visual quando a assinatura expira.
5. 🛡️ **Fila Inteligente de Scraping:** Controla o uso de memória RAM na VPS para evitar travamentos.
6. **CRM de prospecção:** Histórico por pesquisa, listas, notas, etiquetas, lembretes e funil de seis etapas.
7. **Métricas comerciais:** Conversão, clientes, valor estimado no funil e melhores nichos.
8. **Experiência completa:** Landing page pública, interface móvel em cartões, notificações internas e instalação como aplicativo.
9. **Operação confiável:** Migrações versionadas, endpoint `/api/health`, logs estruturados, testes e encerramento seguro.
10. **Pesquisa mundial:** A fonte All World encontra estabelecimentos por nicho, cidade e país em português, inglês ou espanhol.

---

## 🚀 Como Executar Localmente

```bash
# 1. Instalar dependências
npm install

# 2. Iniciar servidor
npm start
```
Ou dê dois cliques em `iniciar.bat` no Windows.

### Qualidade e testes

```bash
npm run quality
npm run test:visual
npm run test:sources
```

Para uso público com muitos clientes, configure `NOMINATIM_URL` e `OVERPASS_URLS` com instâncias próprias ou contratadas. As instâncias comunitárias são adequadas apenas para volume moderado e o sistema mantém cache e fila para reduzir chamadas.

### Controle de versões

O projeto inclui um ponto de restauração local. Execute os comandos pelo atalho:

```bat
git-sevenleads status
git-sevenleads log --oneline
```

Para manter uma segunda cópia dos backups em outro disco ou pasta sincronizada, configure `BACKUP_EXTERNAL_DIR` no `.env`.

Acesse: **http://localhost:3000**

### 🔑 Credenciais do Administrador Padrão
- **E-mail:** configure `ADMIN_EMAIL` no arquivo `.env`
- **Senha:** configure `ADMIN_PASSWORD` no arquivo `.env`

O sistema não inicia sem `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD` e `PIX_KEY`. Não existem credenciais padrão de produção.

---

## ☁️ Como Hospedar em uma VPS Barata (~R$ 25/mês)

Recomendamos **Hetzner Cloud (CX22)** ou **Hostinger VPS** (Ubuntu 22.04 ou 24.04):

```bash
# 1. Atualizar pacotes do Linux e instalar dependências do Puppeteer
sudo apt update && sudo apt upgrade -y
sudo apt install -y nodejs npm git chromium-browser

# 2. Instalar PM2 para manter o sistema rodando 24h
sudo npm install -g pm2

# 3. Clonar ou subir os arquivos do projeto para a VPS
cd /var/www/sevenleads
npm install

# 4. Iniciar com PM2
pm2 start server.js --name "sevenleads"
pm2 startup
pm2 save
```
