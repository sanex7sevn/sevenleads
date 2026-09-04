import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

import {
  seedAdmin,
  getUserByEmail,
  getUserById,
  createUser,
  listAllUsers,
  updateUserSubscription,
  updateUserStatus,
  deleteUserById,
  logSearch,
  getSetting,
  setSetting,
  getSystemStats,
  listPlans,
  getPlan,
  createPayment,
  getPendingPaymentByUser,
  listPendingPayments,
  listRecentPayments,
  listPaymentsByUser,
  approvePayment,
  rejectPayment,
  canUserSearch,
  consumeSearchQuota,
  getSourceMetrics,
  recordSourceMetric,
  requireActiveSubscriptionCheck,
  upsertLeads,
  getLeadsByUser,
  updateLeadStatus,
  markLeadContacted,
  clearUserLeads,
  replaceUserLeads
  ,listSearchHistory
  ,getSearchById
  ,updateLeadDetails
  ,getFollowUpReminders
  ,createProspectingList
  ,listProspectingLists
  ,addLeadsToList
  ,deleteProspectingList
  ,getLeadDashboardStats
  ,createPasswordResetToken
  ,resetPasswordWithToken
  ,changeUserPassword
  ,verifyUserEmail
  ,logAdminAction
  ,listAdminActions
  ,closeDatabase
} from './src/database.js';

import {
  generateToken,
  setSessionCookie,
  clearSessionCookie,
  authenticateToken,
  requireAdmin,
  requireActiveSubscription
} from './src/auth.js';
import { config } from './src/config.js';

import {
  getWhatsAppStatus,
  initWhatsApp,
  sendWhatsAppMessage,
  logoutWhatsApp,
  resetWhatsApp,
  processSpintax,
  buildWaMeLink,
  toWhatsAppPhone
  ,checkWhatsAppNumbers
  ,purgeWhatsAppSession
} from './src/whatsapp.js';

import { scrapeGoogleMaps } from './src/scraper.js';
import { resolveOpenStreetMapLocation, scrapeOpenStreetMap, scrapeOpenStreetMapWorld } from './src/scraper-openstreetmap.js';
import { sendWelcomeEmail, sendPasswordResetEmail } from './src/mailer.js';
import { generateMessageVariations, pickRandomVariation, getOllamaConfig } from './src/ollama.js';
import { startSearchJob, getSearchJob, getActiveSearchJob, cancelSearchJob } from './src/search-jobs.js';
import { prepareSearchResults } from './src/lead-normalization.js';
import { criteriaFromLegacyQuery, normalizeSearchCriteria, SEARCH_CATEGORIES } from './src/search-criteria.js';
import logger, { requestLogger } from './src/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(process.env.SEVENLEADS_DIR || __dirname, '.env') });
const APP_URL = config.appUrl;
const PORT = config.port;
const RECEIPTS_DIR = path.join(process.env.SEVENLEADS_DATA_DIR || path.join(process.env.SEVENLEADS_DIR || __dirname, 'data'), 'receipts');
fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
const receiptUpload = multer({
  storage: multer.diskStorage({
    destination: RECEIPTS_DIR,
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'application/pdf'].includes(file.mimetype))
});

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
if (APP_URL) app.use(cors({ origin: APP_URL, credentials: true }));
app.use(express.json({ limit: '256kb' }));
app.use(requestLogger);
// Remove o aviso intersticial do ngrok ("You are about to visit...") para quem acessa o link
app.use((req, res, next) => {
  res.setHeader('ngrok-skip-browser-warning', 'true');
  next();
});
app.use(express.static(path.join(process.env.SEVENLEADS_DIR || __dirname, 'public')));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.' }
});

const searchLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, keyGenerator: (req) => req.user.id, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas buscas em pouco tempo. Aguarde alguns minutos.' } });
const locationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, keyGenerator: (req) => req.user.id, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas verificações de local em pouco tempo.' } });
const aiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Limite temporário da IA atingido.' } });
const whatsappLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false, message: { error: 'Muitas operações de WhatsApp. Aguarde alguns minutos.' } });

function within(value, max) {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

// Inicializa o Admin padrão no banco SQLite
seedAdmin(
  config.adminEmail,
  config.adminPassword,
  config.pixKey
);

// ==========================================
// 🔑 ROTAS DE AUTENTICAÇÃO
// ==========================================

// 1. Registro de novo cliente (Ganha 7 dias de degustação ou pendente de PIX)
app.post('/api/auth/register', authLimiter, (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  }
  if (!within(name, 100) || !within(email, 254) || String(password).length > 128) return res.status(400).json({ error: 'Nome, e-mail ou senha excedem o tamanho permitido.' });

  if (password.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres.' });
  }

  const existing = getUserByEmail(email);
  if (existing) {
    return res.status(400).json({ error: 'Este e-mail já está cadastrado.' });
  }

  try {
    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = 'usr_' + crypto.randomUUID();
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Modelo freemium: conta nova recebe 7 dias de teste grátis (1 busca/dia, sem WhatsApp/IA)
    const user = createUser({
      id: userId,
      name: name.trim(),
      email: email.trim(),
      passwordHash,
      role: 'client',
      daysOfSubscription: 7,
      isTrial: true,
      verificationToken
    });

    // Dispara e-mail de boas-vindas assíncrono (com dados de PIX e tutorial)
    sendWelcomeEmail({
      name: user.name,
      email: user.email,
      pixKey: getSetting('pix_key'),
      verificationToken
    }).catch(err => {
      console.error('Falha ao disparar e-mail de boas-vindas:', err.message);
    });

    const token = generateToken(user);
    setSessionCookie(res, token);

    res.json({
      success: true,
      user
    });
  } catch (err) {
    console.error('Erro ao registrar usuário:', err);
    res.status(500).json({ error: 'Erro interno ao criar conta.' });
  }
});

// 2. Login
app.post('/api/auth/login', authLimiter, (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  if (!within(email, 254) || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'Credenciais inválidas.' });

  const user = getUserByEmail(email);
  if (!user) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  if (user.status === 'blocked') {
    return res.status(403).json({ error: 'Sua conta está suspensa. Fale com o suporte.' });
  }

  const validPassword = bcrypt.compareSync(password, user.password_hash);
  if (!validPassword) {
    return res.status(401).json({ error: 'E-mail ou senha incorretos.' });
  }

  const cleanUser = getUserById(user.id);
  const token = generateToken(cleanUser);
  setSessionCookie(res, token);

  res.json({
    success: true,
    user: cleanUser
  });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ success: true });
});

// 3. Obter dados do usuário logado
app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/forgot-password', authLimiter, async (req, res) => {
  const email = String(req.body?.email || '').trim();
  if (email.length > 254) return res.status(400).json({ error: 'E-mail inválido.' });
  const user = email ? getUserByEmail(email) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    createPasswordResetToken(email, token, expiresAt);
    await sendPasswordResetEmail({ name: user.name, email: user.email, token }).catch((error) => {
      logger.warn({ error: error.message }, 'password reset email failed');
    });
  }
  res.json({ success: true, message: 'Se o e-mail estiver cadastrado, enviaremos as instruções de recuperação.' });
});

app.post('/api/auth/reset-password', authLimiter, (req, res) => {
  const token = String(req.body?.token || '');
  const password = String(req.body?.password || '');
  if (!token || token.length > 128 || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Link inválido ou senha com menos de 8 caracteres.' });
  }
  const changed = resetPasswordWithToken(token, bcrypt.hashSync(password, 10));
  if (!changed) return res.status(400).json({ error: 'Este link expirou ou já foi utilizado.' });
  res.json({ success: true, message: 'Senha alterada. Você já pode entrar.' });
});

app.post('/api/auth/change-password', authenticateToken, (req, res) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const user = getUserByEmail(req.user.email);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  if (newPassword.length < 8 || newPassword.length > 128) return res.status(400).json({ error: 'A nova senha deve ter entre 8 e 128 caracteres.' });
  changeUserPassword(req.user.id, bcrypt.hashSync(newPassword, 10));
  res.json({ success: true, message: 'Senha alterada com sucesso.' });
});

app.get('/api/auth/verify-email', (req, res) => {
  const verified = verifyUserEmail(String(req.query.token || ''));
  res.redirect(`/?verified=${verified ? '1' : '0'}`);
});

// 4. Configurações Públicas (PIX + planos)
app.get('/api/settings/public', (req, res) => {
  const pixKey = getSetting('pix_key') || process.env.PIX_KEY || 'seu-pix-aqui@chave.com';
  res.json({
    pixKey,
    plans: listPlans(),
    appUrl: APP_URL || `http://localhost:${PORT}`
  });
});

// ==========================================
// PAGAMENTOS PIX (FILA MANUAL)
// ==========================================

app.post('/api/payments/request', authenticateToken, receiptUpload.single('receipt'), (req, res) => {
  const plan = getPlan(req.body?.plan);
  if (!plan) {
    return res.status(400).json({ error: 'Escolha um plano válido: semanal, mensal ou trimestral.' });
  }

  try {
    const payment = createPayment({
      id: 'pay_' + crypto.randomUUID(),
      userId: req.user.id,
      plan: plan.id,
      receiptPath: req.file?.filename || null,
      receiptName: req.file?.originalname || null
    });
    res.json({ success: true, payment, message: `Pedido de ${plan.name} (R$ ${plan.price}) enviado. Aguarde a confirmação.` });
  } catch (err) {
    if (err.code === 'PENDING_EXISTS') {
      return res.status(409).json({
        error: err.message,
        payment: err.payment
      });
    }
    console.error('Erro ao criar pagamento:', err);
    res.status(500).json({ error: 'Não foi possível registrar o pagamento.' });
  }
});

app.get('/api/payments/mine', authenticateToken, (req, res) => {
  const pending = getPendingPaymentByUser(req.user.id);
  const history = listPaymentsByUser(req.user.id);
  res.json({ pending, history });
});

app.get('/api/admin/payments/:id/receipt', authenticateToken, requireAdmin, (req, res) => {
  const payment = listRecentPayments(500).find((item) => item.id === req.params.id);
  if (!payment?.receipt_path) return res.status(404).json({ error: 'Comprovante não encontrado.' });
  const receiptPath = path.join(RECEIPTS_DIR, path.basename(payment.receipt_path));
  if (!fs.existsSync(receiptPath)) return res.status(404).json({ error: 'Arquivo do comprovante não encontrado.' });
  res.download(receiptPath, payment.receipt_name || path.basename(receiptPath));
});

// ==========================================
// 🤖 ROTAS DE WHATSAPP (MULTI-TENANT ISOLADO)
// ==========================================

// 1. Status do WhatsApp do Usuário
app.get('/api/whatsapp/status', authenticateToken, (req, res) => {
  const status = getWhatsAppStatus(req.user.id);
  res.json(status);
});

// 2. Conectar / Gerar novo QR Code para o Usuário
app.post('/api/whatsapp/connect', whatsappLimiter, authenticateToken, async (req, res) => {
  try {
    await initWhatsApp(req.user.id, false);
    res.json({ success: true, message: 'Inicializando WhatsApp do usuário...' });
  } catch (err) {
    res.status(500).json({ error: 'Falha ao iniciar WhatsApp: ' + err.message });
  }
});

// 3. Resetar QR Code
app.post('/api/whatsapp/reset', whatsappLimiter, authenticateToken, async (req, res) => {
  try {
    await resetWhatsApp(req.user.id);
    res.json({ success: true, message: 'Sessão resetada. Novo QR Code em geração.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao resetar: ' + err.message });
  }
});

// 4. Desconectar WhatsApp
app.post('/api/whatsapp/logout', whatsappLimiter, authenticateToken, async (req, res) => {
  try {
    await logoutWhatsApp(req.user.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao desconectar: ' + err.message });
  }
});

// 5. Disparar Mensagem (legado — preferir o modo manual wa.me para evitar ban)
app.post('/api/whatsapp/send', whatsappLimiter, authenticateToken, requireActiveSubscription, async (req, res) => {
  const { phone, message } = req.body;

  if (!phone) {
    return res.status(400).json({ error: 'Telefone é obrigatório.' });
  }
  if (!message) {
    return res.status(400).json({ error: 'Mensagem é obrigatória.' });
  }
  if (String(message).length > 4000) return res.status(400).json({ error: 'Mensagem muito longa.' });

  try {
    await sendWhatsAppMessage(req.user.id, phone, message);
    res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
  } catch (err) {
    console.error(`Erro envio WA [User ${req.user.id}]:`, err.message);
    res.status(400).json({ error: err.message || 'Falha ao enviar mensagem.' });
  }
});

// 6. Link manual wa.me (envio pelo usuário, sem disparo automático)
app.post('/api/whatsapp/manual-link', whatsappLimiter, authenticateToken, requireActiveSubscription, (req, res) => {
  const { phone, message } = req.body || {};
  if (String(message || '').length > 4000) return res.status(400).json({ error: 'Mensagem muito longa.' });
  const digits = toWhatsAppPhone(phone);

  if (!digits) {
    return res.status(400).json({ error: 'Telefone inválido. Informe DDD + número (o DDI 55 é adicionado automaticamente).' });
  }

  const finalMessage = processSpintax(message || '');
  const url = buildWaMeLink(digits, finalMessage);
  res.json({
    success: true,
    phone: digits,
    message: finalMessage,
    url
  });
});

app.post('/api/whatsapp/check', whatsappLimiter, authenticateToken, async (req, res) => {
  const phones = Array.isArray(req.body?.phones) ? req.body.phones : [];
  if (phones.length > 100) return res.status(400).json({ error: 'Envie no máximo 100 telefones por verificação.' });
  const result = await checkWhatsAppNumbers(req.user.id, phones);
  res.json(result);
});

// ==========================================
// IA LOCAL (OLLAMA) — VARIAÇÕES DE MENSAGEM
// ==========================================
app.get('/api/ai/status', authenticateToken, async (req, res) => {
  const config = getOllamaConfig();
  try {
    const ping = await fetch(`${config.url}/api/tags`, { method: 'GET' });
    if (!ping.ok) {
      return res.json({
        online: false,
        model: config.model,
        url: config.url,
        error: `Ollama respondeu HTTP ${ping.status}. Confirme se o serviço está ativo.`
      });
    }
    const data = await ping.json();
    const models = (data.models || []).map((m) => m.name);
    const modelReady = models.some((name) => name === config.model || name.startsWith(`${config.model}:`));
    res.json({
      online: true,
      model: config.model,
      url: config.url,
      modelReady,
      models,
      error: modelReady ? null : `Modelo "${config.model}" não está baixado. Rode: ollama pull ${config.model}`
    });
  } catch (err) {
    res.json({
      online: false,
      model: config.model,
      url: config.url,
      error: `Ollama não está rodando em ${config.url}. Execute: ollama serve`
    });
  }
});

app.post('/api/ai/generate', aiLimiter, authenticateToken, requireActiveSubscription, async (req, res) => {
  const { niche, service } = req.body || {};

  if (!niche || !String(niche).trim()) {
    return res.status(400).json({ error: 'Informe o nicho (ex: salão de beleza).' });
  }
  if (!service || !String(service).trim()) {
    return res.status(400).json({ error: 'Informe o serviço que você oferece (ex: criação de site profissional).' });
  }
  if (String(niche).length > 160 || String(service).length > 1000) return res.status(400).json({ error: 'Nicho ou descrição do serviço muito longos.' });

  try {
    const variations = await generateMessageVariations({
      name: '{nome}',
      niche: String(niche).trim(),
      service: String(service).trim()
    });
    const selected = pickRandomVariation(variations);
    res.json({
      success: true,
      variations,
      selected
    });
  } catch (err) {
    const status = err.code === 'OLLAMA_OFFLINE' || err.code === 'OLLAMA_MODEL_MISSING' ? 503 : 500;
    console.error('Erro Ollama:', err.message);
    res.status(status).json({
      error: err.message,
      code: err.code || 'OLLAMA_ERROR'
    });
  }
});

// ==========================================
// 🔍 ROTAS DE PROSPECÇÃO MULTI-FONTE
// ==========================================
const SCRAPERS = {
  google_maps: scrapeGoogleMaps,
  directories: scrapeOpenStreetMap,
  all_world: scrapeOpenStreetMapWorld
};

const SOURCE_LABELS = {
  google_maps: 'Google Maps',
  directories: 'OpenStreetMap',
  all_world: 'All World'
};

const ENABLED_SEARCH_SOURCES = new Set(Object.keys(SCRAPERS));

function searchPermissionFor(user, reserve = false) {
  const activeCheck = requireActiveSubscriptionCheck(user);
  if (activeCheck.allowed) return { allowed: true, activeCheck };
  const dailyCheck = reserve ? consumeSearchQuota(user.id) : canUserSearch(user.id);
  return { allowed: dailyCheck.allowed, activeCheck, error: dailyCheck.reason, reserved: Boolean(dailyCheck.reserved), quotaDate: dailyCheck.quotaDate || null };
}

async function executeSearch(user, criteria, options = {}) {
  const source = options.source || 'google_maps';
  const scraperFn = SCRAPERS[source] || scrapeGoogleMaps;

  const permission = options.permissionChecked
    ? { allowed: true, activeCheck: requireActiveSubscriptionCheck(user) }
    : searchPermissionFor(user, true);
  if (!permission.allowed) {
    const error = new Error(permission.error);
    error.code = 'DAILY_LIMIT';
    throw error;
  }
  const startedAt = Date.now();
  try {
    const scraperOutcome = source === 'google_maps'
      ? await scraperFn(criteria.providerQuery, options.maxResults, options)
      : await scraperFn(criteria, options);
    const rawResults = Array.isArray(scraperOutcome) ? scraperOutcome : (scraperOutcome.results || []);
    const sourceMetadata = Array.isArray(scraperOutcome) ? {} : (scraperOutcome.metadata || {});
    const results = prepareSearchResults(user.id, rawResults);
    const searchId = 'srch_' + crypto.randomUUID();
    const durationMs = Date.now() - startedAt;
    const phoneCount = results.filter((lead) => lead.whatsappPhone).length;
    const websiteCount = results.filter((lead) => lead.website).length;
    const operationMetadata = {
      ...criteria, durationMs, phoneCount, websiteCount,
      cacheHit: Boolean(sourceMetadata.cacheHit),
      locationLabel: sourceMetadata.interpretedLocation || criteria.locationLabel
    };
    logSearch(searchId, user.id, criteria.displayQuery, results.length, source, operationMetadata);
    upsertLeads(user.id, results, { searchId, source });
    recordSourceMetric({
      userId: user.id, source, query: criteria.displayQuery,
      location: operationMetadata.locationLabel, status: 'completed', durationMs,
      resultCount: results.length, phoneCount, websiteCount, cacheHit: operationMetadata.cacheHit
    });
    return {
      results, searchId, hasActiveSubscription: permission.activeCheck.allowed, source,
      interpretedLocation: operationMetadata.locationLabel
    };
  } catch (error) {
    recordSourceMetric({
      userId: user.id, source, query: criteria.displayQuery, location: criteria.locationLabel,
      status: 'failed', durationMs: Date.now() - startedAt, errorCode: error.code,
      httpStatus: error.status
    });
    throw error;
  }
}

function requestSearchCriteria(body, source) {
  if (body?.categoryId || body?.category) return normalizeSearchCriteria(body, source);
  return criteriaFromLegacyQuery(String(body?.query || ''), source);
}

app.get('/api/places/search/categories', authenticateToken, (_req, res) => {
  res.json({ categories: SEARCH_CATEGORIES.map(({ id, label }) => ({ id, label })) });
});

app.post('/api/places/search/resolve', authenticateToken, locationLimiter, async (req, res) => {
  const source = String(req.body?.source || 'google_maps').trim();
  if (!ENABLED_SEARCH_SOURCES.has(source)) return res.status(400).json({ error: 'Fonte de busca inválida.' });
  try {
    const criteria = requestSearchCriteria(req.body, source);
    if (source === 'google_maps') return res.json({ criteria, interpretedLocation: criteria.locationLabel, cacheHit: false });
    const location = await resolveOpenStreetMapLocation(criteria, source);
    res.json({ criteria, interpretedLocation: location.interpretedLocation, countryCode: location.countryCode, cacheHit: location.cacheHit });
  } catch (error) {
    res.status(error.code === 'LOCATION_NOT_FOUND' || error.code === 'INVALID_SEARCH_CRITERIA' ? 400 : 502).json({ error: error.message, code: error.code });
  }
});

app.post('/api/places/search/start', authenticateToken, searchLimiter, (req, res) => {
  const source = String(req.body?.source || 'google_maps').trim();
  const maxResults = Number(req.body?.maxResults || 50);
  if (!ENABLED_SEARCH_SOURCES.has(source)) return res.status(400).json({ error: 'Esta fonte ainda não está disponível. Use Google Maps, OpenStreetMap Brasil ou All World.' });
  if (![50, 100, 150].includes(maxResults)) return res.status(400).json({ error: 'Escolha 50, 100 ou 150 comércios.' });
  let criteria;
  try {
    criteria = requestSearchCriteria(req.body, source);
  } catch (error) {
    return res.status(400).json({ error: error.message, code: error.code });
  }
  const activeJob = getActiveSearchJob(req.user.id);
  if (activeJob) return res.status(409).json({ error: 'Você já possui uma busca em andamento.', job: activeJob });
  const permission = searchPermissionFor(req.user, true);
  if (!permission.allowed) {
    return res.status(429).json({ error: permission.error, dailyLimit: true, expired: true });
  }
  const job = startSearchJob(
    req.user.id,
    criteria.displayQuery,
    (opts) => executeSearch(req.user, criteria, { ...opts, source, maxResults, permissionChecked: true }),
    {
      source, sourceLabel: SOURCE_LABELS[source] || source, maxResults, criteria,
      quotaReserved: permission.reserved, quotaDate: permission.quotaDate
    }
  );
  res.status(202).json({ job });
});

app.get('/api/places/search/jobs/:id', authenticateToken, (req, res) => {
  const job = getSearchJob(req.user.id, req.params.id);
  if (!job) return res.status(404).json({ error: 'Busca não encontrada.' });
  res.json({ job });
});

app.delete('/api/places/search/jobs/:id', authenticateToken, (req, res) => {
  const job = cancelSearchJob(req.user.id, req.params.id);
  if (!job) return res.status(404).json({ error: 'Busca não encontrada.' });
  res.json({ success: true, job });
});

app.post('/api/places/search', authenticateToken, searchLimiter, (_req, res) => {
  res.status(410).json({
    error: 'Esta rota foi substituída pela busca com progresso e cancelamento.',
    endpoint: '/api/places/search/start'
  });
});

// ==========================================
// 💾 ROTAS DE LEADS PERSISTIDOS (por usuário)
// ==========================================

// Lista todos os leads salvos do usuário (sobrevive a reinícios/buscas)
app.get('/api/leads', authenticateToken, (req, res) => {
  const leads = getLeadsByUser(req.user.id, {
    searchId: req.query.searchId || null,
    listId: req.query.listId || null
  });
  res.json({ leads });
});

// Atualiza o status de um lead (novo / contatado_sem_retorno / fechado)
app.patch('/api/leads/:id/status', authenticateToken, (req, res) => {
  const { status } = req.body;
  if (!['novo', 'contatado', 'respondeu', 'reuniao', 'proposta', 'cliente'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }
  const lead = updateLeadStatus(req.user.id, req.params.id, status);
  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado.' });
  }
  res.json({ success: true, lead });
});

app.patch('/api/leads/:id', authenticateToken, (req, res) => {
  const changes = req.body || {};
  if (changes.notes !== undefined && String(changes.notes).length > 5000) return res.status(400).json({ error: 'Notas devem ter até 5.000 caracteres.' });
  if (changes.tags !== undefined && (!Array.isArray(changes.tags) || changes.tags.length > 20 || changes.tags.some((tag) => typeof tag !== 'string' || tag.length > 50))) return res.status(400).json({ error: 'Use no máximo 20 etiquetas de até 50 caracteres.' });
  if (changes.status !== undefined && !['novo', 'contatado', 'respondeu', 'reuniao', 'proposta', 'cliente'].includes(changes.status)) return res.status(400).json({ error: 'Status inválido.' });
  if (changes.estimatedValue !== undefined && (!Number.isFinite(Number(changes.estimatedValue)) || Number(changes.estimatedValue) < 0)) return res.status(400).json({ error: 'Valor estimado inválido.' });
  const lead = updateLeadDetails(req.user.id, req.params.id, changes);
  if (!lead) return res.status(404).json({ error: 'Lead não encontrado.' });
  res.json({ success: true, lead });
});

app.get('/api/searches', authenticateToken, (req, res) => {
  res.json({ searches: listSearchHistory(req.user.id, 50) });
});

app.get('/api/searches/:id', authenticateToken, (req, res) => {
  const search = getSearchById(req.user.id, req.params.id);
  if (!search) return res.status(404).json({ error: 'Pesquisa não encontrada.' });
  res.json({ search, leads: getLeadsByUser(req.user.id, { searchId: search.id }) });
});

app.get('/api/dashboard', authenticateToken, (req, res) => {
  res.json(getLeadDashboardStats(req.user.id));
});

app.get('/api/reminders', authenticateToken, (req, res) => {
  res.json({ reminders: getFollowUpReminders(req.user.id) });
});

app.get('/api/lists', authenticateToken, (req, res) => {
  res.json({ lists: listProspectingLists(req.user.id) });
});

app.post('/api/lists', authenticateToken, (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Informe um nome para a lista.' });
  if (name.length > 80 || String(req.body?.description || '').length > 500) return res.status(400).json({ error: 'Nome ou descrição da lista muito longos.' });
  const list = createProspectingList(req.user.id, name, String(req.body?.description || '').trim());
  res.status(201).json({ success: true, list });
});

app.post('/api/lists/:id/leads', authenticateToken, (req, res) => {
  const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
  if (leadIds.length > 500 || leadIds.some((id) => typeof id !== 'string' || id.length > 100)) return res.status(400).json({ error: 'Envie no máximo 500 leads válidos.' });
  const list = addLeadsToList(req.user.id, req.params.id, leadIds);
  if (!list) return res.status(404).json({ error: 'Lista não encontrada.' });
  res.json({ success: true, list });
});

app.delete('/api/lists/:id', authenticateToken, (req, res) => {
  const result = deleteProspectingList(req.user.id, req.params.id);
  if (!result.changes) return res.status(404).json({ error: 'Lista não encontrada.' });
  res.json({ success: true });
});

// Marca o lead como contatado (check ✓ no nome) ao clicar no WhatsApp
app.post('/api/leads/:id/contact', authenticateToken, async (req, res) => {
  const lead = markLeadContacted(req.user.id, req.params.id);
  if (!lead) {
    return res.status(404).json({ error: 'Lead não encontrado.' });
  }
  res.json({ success: true, lead });
});

// Limpa todos os leads salvos do usuário (usado ao iniciar busca nova do zero)
app.post('/api/leads/clear', authenticateToken, (req, res) => {
  clearUserLeads(req.user.id);
  res.json({ success: true });
});

// Salva sobrescrevendo a lista completa de leads do usuário (com status/check preservados)
app.post('/api/places/save', authenticateToken, (req, res) => {
  const { leads } = req.body;
  if (!Array.isArray(leads)) {
    return res.status(400).json({ error: 'Lista de leads inválida.' });
  }
  if (leads.length > 500) return res.status(400).json({ error: 'É possível salvar no máximo 500 leads por vez.' });
  if (leads.some((lead) => !lead || !within(String(lead.name || ''), 300))) return res.status(400).json({ error: 'Todos os leads precisam ter um nome válido.' });
  const saved = replaceUserLeads(req.user.id, leads);
  res.json({ success: true, saved });
});

// ==========================================
// 👑 CENTRAL DE CONTROLE — PAINEL ADMIN
// ==========================================

// Estatísticas do Sistema
app.get('/api/admin/stats', authenticateToken, requireAdmin, (req, res) => {
  const stats = getSystemStats();
  res.json(stats);
});

app.get('/api/admin/source-metrics', authenticateToken, requireAdmin, (req, res) => {
  res.json(getSourceMetrics(req.query.days));
});

// Lista todos os usuários
app.get('/api/admin/users', authenticateToken, requireAdmin, (req, res) => {
  const search = String(req.query.search || '').trim().toLowerCase();
  const status = String(req.query.status || 'all');
  const plan = String(req.query.plan || 'all');
  const users = listAllUsers().filter((user) => {
    const matchesSearch = !search || user.name.toLowerCase().includes(search) || user.email.toLowerCase().includes(search);
    const matchesStatus = status === 'all' || user.status === status;
    const matchesPlan = plan === 'all' || user.plan === plan;
    return matchesSearch && matchesStatus && matchesPlan;
  });
  res.json({ users });
});

app.get('/api/admin/actions', authenticateToken, requireAdmin, (req, res) => {
  res.json({ actions: listAdminActions(50) });
});

// Renovar / Adicionar Dias de Assinatura (atalho manual)
app.post('/api/admin/users/:id/renew', authenticateToken, requireAdmin, (req, res) => {
  const { days, plan } = req.body;
  const planData = getPlan(plan);
  const daysToAdd = parseInt(days, 10) || planData?.days || 7;
  const updatedUser = updateUserSubscription(req.params.id, daysToAdd, planData?.id || null);

  if (!updatedUser) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  logAdminAction(req.user.id, 'subscription_renewed', 'user', req.params.id, { days: daysToAdd, plan: planData?.id || null });

  res.json({ success: true, user: updatedUser, message: `Adicionados +${daysToAdd} dias para ${updatedUser.name}!` });
});

app.get('/api/admin/payments', authenticateToken, requireAdmin, (req, res) => {
  res.json({
    pending: listPendingPayments(),
    recent: listRecentPayments(20)
  });
});

app.post('/api/admin/payments/:id/approve', authenticateToken, requireAdmin, (req, res) => {
  try {
    const result = approvePayment(req.params.id);
    if (!result) {
      return res.status(404).json({ error: 'Pagamento não encontrado.' });
    }
    logAdminAction(req.user.id, 'payment_approved', 'payment', req.params.id, { userId: result.user.id, amount: result.payment.amount });
    res.json({
      success: true,
      ...result,
      message: `Pagamento aprovado. ${result.user.name} recebeu +${result.payment.days} dias (${result.payment.plan}).`
    });
  } catch (err) {
    if (err.code === 'ALREADY_REVIEWED') {
      return res.status(409).json({ error: err.message });
    }
    console.error('Erro ao aprovar pagamento:', err);
    res.status(500).json({ error: 'Falha ao aprovar pagamento.' });
  }
});

app.post('/api/admin/payments/:id/reject', authenticateToken, requireAdmin, (req, res) => {
  try {
    const payment = rejectPayment(req.params.id);
    if (!payment) {
      return res.status(404).json({ error: 'Pagamento não encontrado.' });
    }
    logAdminAction(req.user.id, 'payment_rejected', 'payment', req.params.id, { userId: payment.user_id });
    res.json({ success: true, payment, message: 'Pagamento recusado.' });
  } catch (err) {
    if (err.code === 'ALREADY_REVIEWED') {
      return res.status(409).json({ error: err.message });
    }
    console.error('Erro ao recusar pagamento:', err);
    res.status(500).json({ error: 'Falha ao recusar pagamento.' });
  }
});

// Bloquear / Desbloquear Usuário
app.post('/api/admin/users/:id/status', authenticateToken, requireAdmin, (req, res) => {
  const { status } = req.body; // 'active' | 'blocked'

  if (!['active', 'blocked'].includes(status)) {
    return res.status(400).json({ error: 'Status inválido.' });
  }

  const updatedUser = updateUserStatus(req.params.id, status);
  logAdminAction(req.user.id, 'user_status_changed', 'user', req.params.id, { status });
  res.json({ success: true, user: updatedUser });
});

// Deletar Usuário
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, (req, res) => {
  if (req.params.id === req.user.id) return res.status(400).json({ error: 'A conta administradora em uso não pode ser excluída.' });
  const target = getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
  const receipts = listPaymentsByUser(req.params.id)
    .map((payment) => payment.receipt_path)
    .filter(Boolean);
  const deleted = deleteUserById(req.params.id);
  if (!deleted.changes) return res.status(404).json({ error: 'Usuário não encontrado.' });
  purgeWhatsAppSession(req.params.id);
  for (const receipt of receipts) {
    const receiptPath = path.join(RECEIPTS_DIR, path.basename(receipt));
    try { if (fs.existsSync(receiptPath)) fs.unlinkSync(receiptPath); } catch (error) { logger.warn({ error: error.message, receiptPath }, 'receipt cleanup failed'); }
  }
  logAdminAction(req.user.id, 'user_deleted', 'user', req.params.id);
  res.json({ success: true, message: 'Usuário excluído com sucesso.' });
});

// Atualizar Configurações do Sistema (Ex: Chave PIX)
app.post('/api/admin/settings', authenticateToken, requireAdmin, (req, res) => {
  const { pixKey } = req.body;
  if (typeof pixKey !== 'string' || !pixKey.trim() || pixKey.trim().length > 254) return res.status(400).json({ error: 'Chave PIX inválida.' });
  setSetting('pix_key', pixKey.trim());
  logAdminAction(req.user.id, 'pix_key_updated', 'setting', 'pix_key');
  res.json({ success: true, message: 'Configurações atualizadas com sucesso!' });
});

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'sevenleads', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString() });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError || error?.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Arquivo ou conteúdo maior que o limite permitido.' });
  }
  logger.error({ error: error?.message }, 'unhandled request error');
  res.status(500).json({ error: 'Erro interno ao processar a solicitação.' });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  const publicUrl = APP_URL || `http://localhost:${PORT}`;
  console.log(`\n======================================================`);
  console.log(`SevenLeads SaaS em: ${publicUrl}`);
  console.log(`Admin: ${process.env.ADMIN_EMAIL || 'admin@sevenleads.local'}`);
  console.log(`======================================================\n`);
});

function shutdown(signal) {
  logger.info({ signal }, 'graceful shutdown started');
  server.close((error) => {
    if (error) {
      logger.error({ error: error.message }, 'graceful shutdown failed');
      process.exitCode = 1;
    }
    closeDatabase();
    process.exit();
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

export { app, server, closeDatabase };
