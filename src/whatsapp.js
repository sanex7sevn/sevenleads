import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AUTH_BASE_DIR = path.join(process.env.SEVENLEADS_DIR || path.join(__dirname, '..'), 'auth_sessions');

if (!fs.existsSync(AUTH_BASE_DIR)) {
  fs.mkdirSync(AUTH_BASE_DIR, { recursive: true });
}

// Cada sessão de WhatsApp de cada usuário
const sessions = new Map();

function getSessionDir(userId) {
  return path.join(AUTH_BASE_DIR, `user_${userId}`);
}

function cleanSessionDir(userId) {
  const dir = getSessionDir(userId);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`🧹 Sessão WA do usuário ${userId} limpa.`);
    }
  } catch (err) {
    console.error(`Aviso ao limpar sessão WA do user ${userId}:`, err.message);
  }
}

function getSession(userId) {
  return sessions.get(userId) || { socket: null, qrCode: null, connected: false, initializing: false };
}

export function getWhatsAppStatus(userId) {
  const session = getSession(userId);
  return {
    connected: session.connected,
    qrCode: session.qrCode
  };
}

export async function initWhatsApp(userId, forceFresh = false) {
  const current = getSession(userId);
  if (current.initializing) return;

  current.initializing = true;
  sessions.set(userId, current);

  if (forceFresh) {
    cleanSessionDir(userId);
    current.connected = false;
    current.qrCode = null;
  }

  try {
    if (current.socket) {
      try {
        current.socket.ev.removeAllListeners('connection.update');
        current.socket.ev.removeAllListeners('creds.update');
        current.socket.end();
      } catch (e) {}
      current.socket = null;
    }

    const sessionDir = getSessionDir(userId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

    const waSocket = makeWASocket({
      logger: pino({ level: 'silent' }),
      auth: state,
      printQRInTerminal: false,
      browser: Browsers.windows('Desktop'),
      connectTimeoutMs: 60000,
      defaultQueryTimeoutMs: 60000
    });

    current.socket = waSocket;

    waSocket.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        current.qrCode = await QRCode.toDataURL(qr);
        current.connected = false;
        console.log(`⚡ [User ${userId}] Novo QR Code gerado.`);
      }

      if (connection === 'open') {
        console.log(`✅ [User ${userId}] WhatsApp Conectado!`);
        current.connected = true;
        current.qrCode = null;
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

        console.log(`❌ [User ${userId}] WhatsApp desconectado (Status: ${statusCode || 'desconhecido'}).`);
        current.connected = false;

        if (isLoggedOut) {
          cleanSessionDir(userId);
          current.qrCode = null;
          current.initializing = false;
          sessions.set(userId, current);
          setTimeout(() => initWhatsApp(userId, true), 2000);
        } else {
          current.initializing = false;
          sessions.set(userId, current);
          setTimeout(() => initWhatsApp(userId, false), 3000);
        }
      }

      sessions.set(userId, current);
    });

    waSocket.ev.on('creds.update', saveCreds);
  } catch (err) {
    console.error(`Erro ao inicializar WA do user ${userId}:`, err);
    cleanSessionDir(userId);
  } finally {
    current.initializing = false;
    sessions.set(userId, current);
  }
}

export function processSpintax(text) {
  if (!text) return '';
  const regex = /\{([^{}]+)\}/g;
  let processed = text;
  let iterations = 0;
  while (regex.test(processed) && iterations < 10) {
    processed = processed.replace(regex, (_, group) => {
      const choices = group.split('|');
      return choices[Math.floor(Math.random() * choices.length)];
    });
    iterations++;
  }
  return processed;
}

export function toWhatsAppPhone(phone) {
  let digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('0') && digits.length >= 11) {
    digits = digits.substring(1);
  }
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  if (digits.length === 10 || digits.length === 11) {
    return '55' + digits;
  }
  return digits.length >= 10 ? digits : null;
}

export function buildWaMeLink(phone, message) {
  const digits = toWhatsAppPhone(phone);
  if (!digits) return null;
  const text = encodeURIComponent(message || '');
  return `https://wa.me/${digits}?text=${text}`;
}

export async function checkWhatsAppNumbers(userId, phones) {
  const session = getSession(userId);
  if (!session.connected || !session.socket) {
    return { connected: false, results: {} };
  }
  const unique = [...new Set(phones.map(toWhatsAppPhone).filter(Boolean))].slice(0, 100);
  const results = {};
  for (const phone of unique) {
    try {
      const response = await session.socket.onWhatsApp(phone);
      results[phone] = Boolean(response?.[0]?.exists);
    } catch {
      results[phone] = false;
    }
  }
  return { connected: true, results };
}

export async function sendWhatsAppMessage(userId, phone, message) {
  const session = getSession(userId);

  if (!session.connected || !session.socket) {
    throw new Error('WhatsApp não está conectado. Escaneie o QR Code primeiro.');
  }

  const processedMessage = processSpintax(message);
  const jid = `${phone}@s.whatsapp.net`;

  // Anti-ban: Presence update to simulate typing
  await session.socket.sendPresenceUpdate('available', jid);
  await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
  await session.socket.sendPresenceUpdate('composing', jid);

  // Calculate dynamic typing time based on message length (simulating real typing ~ 6 cps)
  const typingMs = Math.min(Math.max(processedMessage.length * (50 + Math.random() * 50), 1500), 10000);
  await new Promise((r) => setTimeout(r, typingMs));

  await session.socket.sendMessage(jid, { text: processedMessage });

  await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
  await session.socket.sendPresenceUpdate('paused', jid);
}

export async function logoutWhatsApp(userId) {
  const session = getSession(userId);
  if (session.socket) {
    try { await session.socket.logout(); } catch (e) {}
  }
  await initWhatsApp(userId, true);
}

export async function resetWhatsApp(userId) {
  await initWhatsApp(userId, true);
}

export function purgeWhatsAppSession(userId) {
  const session = sessions.get(userId);
  try { session?.socket?.end?.(new Error('Usuário removido')); } catch {}
  sessions.delete(userId);
  cleanSessionDir(userId);
}
