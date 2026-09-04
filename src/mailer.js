import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(process.env.SEVENLEADS_DIR || path.join(__dirname, '..'), '.env') });

// Cria o transporter de e-mail (usando SMTP configurado no .env)
function createTransporter() {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass || pass === 'sua_senha_de_app_aqui') {
    return null;
  }

  return nodemailer.createTransport({
    host,
    port: parseInt(port, 10),
    secure: port == 465,
    auth: { user, pass }
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envia e-mail de boas-vindas com dados de acesso e instruções do PIX
 */
export async function sendWelcomeEmail({ name, email, pixKey: configuredPixKey, verificationToken }) {
  const pixKey = configuredPixKey || process.env.PIX_KEY || 'Configure a chave PIX no painel';
  const safeName = escapeHtml(name);
  const safePixKey = escapeHtml(pixKey);
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const verificationUrl = verificationToken ? `${appUrl}/api/auth/verify-email?token=${encodeURIComponent(verificationToken)}` : null;
  const from = process.env.EMAIL_FROM || `"SevenLeads" <${pixKey}>`;

  const htmlContent = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #020617; color: #f8fafc; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background-color: #0f172a; border: 1px solid #1e293b; border-radius: 16px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #065f46 0%, #047857 100%); padding: 30px 20px; text-align: center; color: #ffffff; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 800; }
    .content { padding: 30px 24px; }
    .badge { display: inline-block; background-color: #10b981; color: #022c22; font-weight: bold; font-size: 12px; padding: 4px 10px; border-radius: 20px; text-transform: uppercase; margin-bottom: 15px; }
    .step-box { background-color: #020617; border: 1px solid #334155; border-radius: 10px; padding: 16px; margin: 15px 0; }
    .step-title { font-weight: bold; color: #34d399; margin-bottom: 6px; font-size: 14px; }
    .pix-box { background-color: #064e3b; border: 1px dashed #10b981; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0; }
    .pix-key { font-family: monospace; font-size: 16px; color: #6ee7b7; font-weight: bold; background-color: #022c22; padding: 8px 12px; border-radius: 6px; display: inline-block; margin-top: 6px; }
    .footer { text-align: center; padding: 20px; font-size: 12px; color: #64748b; border-top: 1px solid #1e293b; }
    .btn { display: inline-block; background-color: #10b981; color: #022c22; text-decoration: none; font-weight: bold; padding: 12px 24px; border-radius: 8px; margin: 15px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🗺️ SevenLeads SaaS</h1>
      <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.9;">Sua máquina de prospecção B2B & WhatsApp</p>
    </div>

    <div class="content">
      <span class="badge">🎁 Acesso Liberado</span>
      <h2 style="color: #ffffff; margin-top: 0;">Olá, ${safeName}! Seja muito bem-vindo(a).</h2>
      <p style="color: #94a3b8; font-size: 14px; line-height: 1.6;">
        Sua conta no <strong>SevenLeads</strong> foi criada com sucesso. Durante os 7 dias de teste, você pode fazer <strong>1 busca por dia</strong>. IA e contato pelo WhatsApp ficam disponíveis nos planos pagos.
      </p>

      <div class="step-box">
        <div class="step-title">1. Como Fazer suas Buscas</div>
        <p style="color: #cbd5e1; font-size: 13px; margin: 0;">
          Digite no campo de busca seu nicho e cidade (ex: <em>"Restaurantes em Campinas"</em>, <em>"Dentistas em Curitiba"</em>). O robô irá capturar nome, telefone, endereço, avaliação e identificar se o comércio tem site ou não.
        </p>
      </div>

      <div class="step-box">
        <div class="step-title">2. Como Disparar pelo WhatsApp</div>
        <p style="color: #cbd5e1; font-size: 13px; margin: 0;">
          Nos planos pagos, use <strong>"Abrir no WhatsApp"</strong> para revisar e enviar cada mensagem manualmente pelo seu próprio aplicativo.
        </p>
      </div>

      <div class="pix-box">
        <h3 style="margin: 0; color: #ffffff; font-size: 15px;">💰 Renovação Semanal (R$ 20,00)</h3>
        <p style="color: #a7f3d0; font-size: 13px; margin: 6px 0 0 0;">
          Após o período de teste, a renovação semanal custa <strong>R$ 20,00</strong> e libera todas as funções do plano.
        </p>
        <div style="margin-top: 10px;">
          <span style="font-size: 12px; color: #94a3b8; display: block;">Chave PIX:</span>
          <span class="pix-key">${safePixKey}</span>
        </div>
        <p style="font-size: 11px; color: #6ee7b7; margin-top: 8px;">
          Envie o comprovante para este mesmo e-mail ou WhatsApp para liberação imediata.
        </p>
      </div>

      <div style="text-align: center; margin-top: 25px;">
        ${verificationUrl ? `<a href="${verificationUrl}" class="btn">Confirmar meu e-mail</a>` : ''}
        <a href="${appUrl}" class="btn">Acessar Meu Painel Agora →</a>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 0;">SevenLeads SaaS — Desenvolvido para alavancar suas vendas B2B.</p>
      <p style="margin: 4px 0 0 0;">Suporte e pagamentos: <strong>${safePixKey}</strong></p>
    </div>
  </div>
</body>
</html>
`;

  const textContent = `
Olá, ${name}! Seja bem-vindo ao SevenLeads SaaS!

Sua conta foi criada com 7 dias de teste e 1 busca por dia. IA e WhatsApp ficam disponíveis nos planos pagos.

Como usar:
1. Acesse seu painel e faça buscas no Google Maps por nicho e cidade.
2. Organize seus leads em listas e acompanhe o funil.
3. No plano pago, abra o WhatsApp para revisar e enviar cada mensagem manualmente.

Renovação Semanal:
A assinatura custa apenas R$ 20,00 por semana.
Chave PIX: ${pixKey}
Basta fazer o PIX e enviar o comprovante para liberação de +7 dias.

Bons negócios!
`;

  try {
    const transporter = createTransporter();
    if (transporter) {
      const info = await transporter.sendMail({
        from,
        to: email,
        subject: `Bem-vindo ao SevenLeads, ${name}! Seu teste começou`,
        text: textContent,
        html: htmlContent
      });
      console.log(`✉️ E-mail de boas-vindas enviado para ${email} (ID: ${info.messageId})`);
      return { sent: true, messageId: info.messageId };
    } else {
      console.log(`ℹ️ [Simulador de E-mail] E-mail de boas-vindas gerado para ${email} (Configure SMTP_PASS no .env para envio real).`);
      return { sent: false, simulated: true };
    }
  } catch (err) {
    console.error(`Aviso ao enviar e-mail para ${email}:`, err.message);
    return { sent: false, error: err.message };
  }
}

export async function sendPasswordResetEmail({ name, email, token }) {
  const transporter = createTransporter();
  if (!transporter) return { sent: false, simulated: true };
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const resetUrl = `${appUrl}/?reset=${encodeURIComponent(token)}`;
  const from = process.env.EMAIL_FROM || `"SevenLeads" <${process.env.SMTP_USER}>`;
  const safeName = escapeHtml(name);
  const info = await transporter.sendMail({
    from,
    to: email,
    subject: 'Redefinição de senha — SevenLeads',
    text: `Redefina sua senha: ${resetUrl}\nEste link expira em 30 minutos.`,
    html: `<p>Olá, ${safeName}.</p><p>Recebemos um pedido para redefinir sua senha.</p><p><a href="${resetUrl}">Criar uma nova senha</a></p><p>O link expira em 30 minutos.</p>`
  });
  return { sent: true, messageId: info.messageId };
}
