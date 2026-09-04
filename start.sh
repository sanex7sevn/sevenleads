#!/bin/bash
# ============================================
# SevenLeads SaaS — Script de Inicialização
# ============================================

echo "🚀 Iniciando SevenLeads SaaS..."

# No Railway as variáveis vêm do painel (não de .env).
# Se existir .env local, o app ainda o carrega — não bloqueia a falta dele.
if [ ! -f .env ]; then
    echo "⚠️  Nenhum .env encontrado. Usando variáveis de ambiente do Railway."
fi

# Apontar dados/banco/sessões para /app (onde os volumes do Railway são montados)
if [ -z "$SEVENLEADS_DIR" ]; then
    export SEVENLEADS_DIR=/app
fi

# Criar todos os dados persistentes dentro do único volume
mkdir -p \
  /app/data/backups \
  /app/data/receipts \
  /app/data/auth_sessions \
  /app/data/auth_info_baileys

# Direcionar os caminhos antigos para dentro do volume
rmdir /app/auth_sessions /app/auth_info_baileys 2>/dev/null || true
ln -sfn /app/data/auth_sessions /app/auth_sessions
ln -sfn /app/data/auth_info_baileys /app/auth_info_baileys

# Verificar variáveis obrigatórias
required_vars=("JWT_SECRET" "ADMIN_EMAIL" "ADMIN_PASSWORD" "PIX_KEY")
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "❌ Variável obrigatória ausente: $var"
        exit 1
    fi
done

echo "✅ Configuração verificada"
echo "🌐 Iniciando servidor na porta ${PORT:-3000}..."

# Iniciar o servidor
echo "[DEBUG-7f31] Executando Node $(node --version)"
exec node --trace-uncaught --trace-warnings --trace-exit server.js
