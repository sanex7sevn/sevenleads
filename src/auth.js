import jwt from 'jsonwebtoken';
import { getUserById } from './database.js';
import { config } from './config.js';

const SESSION_COOKIE = 'sevenleads_session';

export function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role
    },
    config.jwtSecret,
    { expiresIn: '8h' }
  );
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/',
    maxAge: 8 * 60 * 60 * 1000
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: config.secureCookies,
    sameSite: 'strict',
    path: '/'
  });
}

function readSessionCookie(req) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const cookie of cookies) {
    const [name, ...parts] = cookie.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(parts.join('='));
  }
  return null;
}

// Middleware de Autenticação
export function authenticateToken(req, res, next) {
  const token = readSessionCookie(req);

  if (!token) {
    return res.status(401).json({ error: 'Acesso não autorizado. Faça login primeiro.' });
  }

  jwt.verify(token, config.jwtSecret, (err, payload) => {
    if (err) {
      return res.status(403).json({ error: 'Sessão expirada ou inválida. Faça login novamente.' });
    }

    const user = getUserById(payload.id);
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    if (user.status === 'blocked') {
      return res.status(403).json({ error: 'Sua conta foi suspensa pelo administrador. Entre em contato com o suporte.' });
    }

    req.user = user;
    next();
  });
}

// Middleware: Exige que seja Administrador
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao Administrador.' });
  }
  next();
}

// Middleware: Verifica se a Assinatura está Ativa
export function requireActiveSubscription(req, res, next) {
  if (req.user.role === 'admin') {
    return next();
  }

  // Teste grátis: recursos pagos (WhatsApp, IA) ficam bloqueados até virar assinante
  if (req.user.is_trial) {
    return res.status(402).json({
      error: 'Recurso exclusivo para assinantes. Escolha um plano para liberar.',
      requiresPayment: true,
      trial: true
    });
  }

  if (!req.user.subscription_expires_at) {
    return res.status(402).json({
      error: 'Você não possui uma assinatura ativa. Escolha um plano e pague via PIX para liberar o acesso.',
      expired: true
    });
  }

  const expiresAt = new Date(req.user.subscription_expires_at);
  const now = new Date();

  if (now > expiresAt) {
    return res.status(402).json({
      error: 'Sua assinatura expirou. Renove o plano para continuar buscando e enviando mensagens.',
      expired: true,
      expiresAt: req.user.subscription_expires_at
    });
  }

  next();
}
