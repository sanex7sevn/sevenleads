import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { runMigrations } from './migrations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = process.env.SEVENLEADS_DATA_DIR || path.join(process.env.SEVENLEADS_DIR || path.join(__dirname, '..'), 'data');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LEGACY_DB_PATH = path.join(DATA_DIR, 'prospector.sqlite');
const DB_PATH = path.join(DATA_DIR, 'sevenleads.sqlite');
if (!fs.existsSync(DB_PATH) && fs.existsSync(LEGACY_DB_PATH)) {
  fs.copyFileSync(LEGACY_DB_PATH, DB_PATH);
}
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ==========================================
// 💾 BACKUP AUTOMÁTICO DO BANCO (diário)
// ==========================================
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const MAX_BACKUPS = 14; // guarda até 14 backups (2 semanas)

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function runBackup() {
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUP_DIR, `sevenleads-${stamp}.sqlite`);

    // backup() cria um snapshot consistente mesmo com WAL ativo
    db.backup(dest).then(() => {
      console.log(`[Backup] Banco copiado → ${dest}`);

      // Mantém apenas os MAX_BACKUPS mais recentes
      const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.endsWith('.sqlite'))
        .sort()
        .reverse();
      for (const old of files.slice(MAX_BACKUPS)) {
        fs.unlinkSync(path.join(BACKUP_DIR, old));
        console.log(`[Backup] Removendo backup antigo: ${old}`);
      }

      const externalDir = process.env.BACKUP_EXTERNAL_DIR;
      if (externalDir) {
        fs.mkdirSync(externalDir, { recursive: true });
        fs.copyFileSync(dest, path.join(externalDir, path.basename(dest)));
      }
    }).catch((err) => {
      console.error('[Backup] Falha ao criar backup:', err.message);
    });
  } catch (err) {
    console.error('[Backup] Erro:', err.message);
  }
}

// Roda um backup ao iniciar e agenda os próximos a cada 24h
setTimeout(runBackup, 5000).unref();
setInterval(runBackup, BACKUP_INTERVAL_MS).unref();
console.log(`[Backup] Agendado — rodará a cada 24h em ${BACKUP_DIR}`);

export const PLANS = {
  weekly: {
    id: 'weekly',
    name: 'Semanal',
    price: 20,
    days: 7,
    label: 'R$ 20 / semana',
    highlight: false
  },
  monthly: {
    id: 'monthly',
    name: 'Mensal',
    price: 60,
    days: 30,
    label: 'R$ 60 / mês',
    highlight: true
  },
  quarterly: {
    id: 'quarterly',
    name: 'Trimestral',
    price: 150,
    days: 90,
    label: 'R$ 150 / 90 dias',
    highlight: false
  }
};

export function listPlans() {
  return Object.values(PLANS);
}

export function getPlan(id) {
  return PLANS[id] || null;
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT DEFAULT 'client',
    status TEXT DEFAULT 'active',
    subscription_expires_at TEXT,
    plan TEXT DEFAULT 'weekly',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS searches (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    query TEXT NOT NULL,
    total_leads INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    plan TEXT NOT NULL,
    amount INTEGER NOT NULL,
    days INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    reviewed_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id, created_at);

  CREATE TABLE IF NOT EXISTS leads (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    address TEXT,
    phone TEXT,
    whatsapp_phone TEXT,
    website TEXT,
    has_website INTEGER DEFAULT 0,
    has_real_website INTEGER DEFAULT 0,
    is_social_media INTEGER DEFAULT 0,
    rating REAL DEFAULT 0,
    total_ratings INTEGER DEFAULT 0,
    maps_url TEXT,
    status TEXT DEFAULT 'novo',
    contacted INTEGER DEFAULT 0,
    selected_message TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id, updated_at);
`);

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((col) => col.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'plan', "TEXT DEFAULT 'weekly'");
ensureColumn('users', 'last_search_date', 'TEXT');
ensureColumn('users', 'daily_search_count', 'INTEGER DEFAULT 0');
ensureColumn('users', 'is_trial', 'INTEGER DEFAULT 0');
runMigrations(db);

export function seedAdmin(adminEmail, adminPassword, defaultPixKey) {
  const existingAdmin = db.prepare('SELECT * FROM users WHERE role = ?').get('admin');

  // Conta mestre já existe: sincroniza e-mail e senha com o .env (seed automático)
  if (existingAdmin && adminEmail && adminPassword && adminPassword !== 'admin123') {
    let changed = false;

    if (!bcrypt.compareSync(adminPassword, existingAdmin.password_hash)) {
      const newHash = bcrypt.hashSync(adminPassword, 10);
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newHash, existingAdmin.id);
      changed = true;
    }

    if (existingAdmin.email.toLowerCase() !== adminEmail.toLowerCase()) {
      db.prepare('UPDATE users SET email = ? WHERE id = ?').run(adminEmail.toLowerCase(), existingAdmin.id);
      changed = true;
    }

    if (changed) {
      console.log(`Conta mestre atualizada para: ${adminEmail}`);
    }
  }

  if (!existingAdmin && adminEmail && adminPassword) {
    const passwordHash = bcrypt.hashSync(adminPassword, 10);
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + 10);

    db.prepare(`
      INSERT INTO users (id, name, email, password_hash, role, status, subscription_expires_at, plan)
      VALUES (?, ?, ?, ?, 'admin', 'active', ?, 'weekly')
    `).run('admin_root_1', 'Administrador', adminEmail.toLowerCase(), passwordHash, expires.toISOString());
    console.log(`Administrador padrão criado: ${adminEmail}`);
  }

  const existingPix = db.prepare('SELECT * FROM settings WHERE key = ?').get('pix_key');
  if (!existingPix) {
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('pix_key', defaultPixKey || 'seu-pix-aqui@chave.com');
  }
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE LOWER(email) = LOWER(?)').get(email);
}

export function getUserById(id) {
  return db.prepare(`
    SELECT id, name, email, role, status, subscription_expires_at, plan, is_trial, email_verified, created_at
    FROM users WHERE id = ?
  `).get(id);
}

export function createUser({ id, name, email, passwordHash, role = 'client', daysOfSubscription = 7, plan = 'weekly', isTrial = false, verificationToken = null }) {
  const planId = getPlan(plan) ? plan : 'weekly';

  // daysOfSubscription > 0 => concede período de teste (assinatura com prazo). O flag is_trial
  // marca a conta como teste grátis (recursos pagos bloqueados até virar assinante).
  let expiresAtIso = null;
  if (daysOfSubscription > 0) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysOfSubscription);
    expiresAtIso = expiresAt.toISOString();
  }

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, status, subscription_expires_at, plan, is_trial, email_verification_token)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)
  `).run(id, name, email.toLowerCase(), passwordHash, role, expiresAtIso, planId, isTrial ? 1 : 0, verificationToken);

  return getUserById(id);
}

export function listAllUsers() {
  return db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.status, u.subscription_expires_at, u.plan, u.is_trial, u.created_at,
           COUNT(s.id) as total_searches
    FROM users u
    LEFT JOIN searches s ON s.user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
}

export function updateUserSubscription(userId, daysToAdd = 7, planId = null) {
  const user = getUserById(userId);
  if (!user) return null;

  let baseDate = new Date();
  if (user.subscription_expires_at) {
    const currentExpire = new Date(user.subscription_expires_at);
    if (currentExpire > baseDate) {
      baseDate = currentExpire;
    }
  }

  baseDate.setDate(baseDate.getDate() + daysToAdd);
  const newDateIso = baseDate.toISOString();
  const nextPlan = getPlan(planId) ? planId : (user.plan || 'weekly');

  db.prepare(`
    UPDATE users
    SET subscription_expires_at = ?, status = 'active', plan = ?, is_trial = 0
    WHERE id = ?
  `).run(newDateIso, nextPlan, userId);

  return getUserById(userId);
}

export function updateUserStatus(userId, status) {
  db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, userId);
  return getUserById(userId);
}

export function deleteUserById(userId) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

export function logSearch(id, userId, query, totalLeads, source = 'google_maps', metadata = {}) {
  db.prepare(`
    INSERT INTO searches (
      id, user_id, query, total_leads, source, category, city, region, country,
      location_label, duration_ms, phone_count, website_count, cache_hit
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET total_leads = excluded.total_leads, duration_ms = excluded.duration_ms, phone_count = excluded.phone_count, website_count = excluded.website_count
  `).run(
    id, userId, query, totalLeads, source,
    metadata.category || null, metadata.city || null, metadata.region || null,
    metadata.country || null, metadata.locationLabel || null,
    Number(metadata.durationMs || 0), Number(metadata.phoneCount || 0),
    Number(metadata.websiteCount || 0), metadata.cacheHit ? 1 : 0
  );
}

export function listSearchHistory(userId, limit = 30) {
  return db.prepare(`
    SELECT id, query, total_leads AS totalLeads, status, source, list_id AS listId, created_at AS createdAt
    FROM searches WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(userId, limit);
}

export function getSearchById(userId, searchId) {
  return db.prepare(`
    SELECT id, query, total_leads AS totalLeads, status, source, list_id AS listId, created_at AS createdAt
    FROM searches WHERE id = ? AND user_id = ?
  `).get(searchId, userId);
}

export function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

export function setSetting(key, value) {
  db.prepare(`
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value);
}

// ==========================================
// 🔎 OPERAÇÃO DE BUSCAS, CACHE E MÉTRICAS
// ==========================================

function parseJson(value, fallback = null) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function searchJobRowToObject(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    query: row.query,
    criteria: parseJson(row.criteria, {}),
    checkpoint: parseJson(row.checkpoint, null),
    completionReason: row.completion_reason || null,
    source: row.source,
    sourceLabel: row.source_label,
    maxResults: Number(row.max_results || 50),
    status: row.status,
    phase: row.phase,
    found: Number(row.found || 0),
    analyzed: Number(row.analyzed || 0),
    remaining: Number(row.remaining || 0),
    results: parseJson(row.results, null),
    error: row.error || null,
    searchId: row.search_id || null,
    interpretedLocation: row.interpreted_location || null,
    hasActiveSubscription: row.has_active_subscription === 1,
    quotaReserved: row.quota_reserved === 1,
    quotaReleased: row.quota_released === 1,
    quotaDate: row.quota_date || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function saveSearchJob(job) {
  db.prepare(`
    INSERT INTO search_jobs (
      id, user_id, query, criteria, source, source_label, max_results, status, phase,
      found, analyzed, remaining, results, error, search_id, interpreted_location,
      has_active_subscription, quota_reserved, quota_released, quota_date, created_at, updated_at, checkpoint, completion_reason
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      checkpoint = excluded.checkpoint,
      completion_reason = excluded.completion_reason,
      criteria = excluded.criteria,
      source = excluded.source,
      source_label = excluded.source_label,
      max_results = excluded.max_results,
      status = excluded.status,
      phase = excluded.phase,
      found = excluded.found,
      analyzed = excluded.analyzed,
      remaining = excluded.remaining,
      results = excluded.results,
      error = excluded.error,
      search_id = excluded.search_id,
      interpreted_location = excluded.interpreted_location,
      has_active_subscription = excluded.has_active_subscription,
      quota_reserved = excluded.quota_reserved,
      quota_released = excluded.quota_released,
      quota_date = excluded.quota_date,
      updated_at = excluded.updated_at
  `).run(
    job.id, job.userId, job.query, JSON.stringify(job.criteria || {}), job.source,
    job.sourceLabel || null, Number(job.maxResults || 50), job.status, job.phase,
    Number(job.found || 0), Number(job.analyzed || 0), Number(job.remaining || 0),
    job.results == null ? null : JSON.stringify(job.results), job.error || null,
    job.searchId || null, job.interpretedLocation || null,
    job.hasActiveSubscription ? 1 : 0, job.quotaReserved ? 1 : 0,
    job.quotaReleased ? 1 : 0, job.quotaDate || null, job.createdAt, job.updatedAt,
    job.checkpoint ? JSON.stringify(job.checkpoint) : null, job.completionReason || null
  );
  return searchJobRowToObject(db.prepare('SELECT * FROM search_jobs WHERE id = ?').get(job.id));
}

export function getPersistedSearchJob(userId, id) {
  return searchJobRowToObject(db.prepare('SELECT * FROM search_jobs WHERE id = ? AND user_id = ?').get(id, userId));
}

export function getPersistedActiveSearchJob(userId) {
  return searchJobRowToObject(db.prepare(`
    SELECT * FROM search_jobs
    WHERE user_id = ? AND status IN ('queued', 'running')
    ORDER BY created_at DESC LIMIT 1
  `).get(userId));
}

function releaseQuotaReservation(userId, quotaDate) {
  const user = db.prepare('SELECT last_search_date, daily_search_count FROM users WHERE id = ?').get(userId);
  if (!user || !quotaDate || user.last_search_date !== quotaDate || Number(user.daily_search_count || 0) < 1) return false;
  const nextCount = Math.max(0, Number(user.daily_search_count || 0) - 1);
  db.prepare('UPDATE users SET daily_search_count = ?, last_search_date = ? WHERE id = ?')
    .run(nextCount, nextCount ? quotaDate : null, userId);
  return true;
}

const releaseSearchJobQuotaTransaction = db.transaction((jobId, userId) => {
  const job = db.prepare('SELECT quota_reserved, quota_released, quota_date FROM search_jobs WHERE id = ? AND user_id = ?').get(jobId, userId);
  if (!job || job.quota_reserved !== 1 || job.quota_released === 1) return false;
  const released = releaseQuotaReservation(userId, job.quota_date);
  db.prepare('UPDATE search_jobs SET quota_released = 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), jobId);
  return released;
});

export function releaseSearchJobQuota(jobId, userId) {
  return releaseSearchJobQuotaTransaction(jobId, userId);
}

export function recoverInterruptedSearchJobs({ preserveGoogle = false } = {}) {
  const interrupted = db.prepare("SELECT id, user_id, source FROM search_jobs WHERE status IN ('queued', 'running')").all();
  const recover = db.transaction(() => {
    for (const job of interrupted) {
      if (preserveGoogle && job.source === 'google_maps') {
        db.prepare("UPDATE search_jobs SET status = 'interrupted', phase = 'interrupted', error = 'Servidor reiniciado; progresso preservado.', updated_at = ? WHERE id = ?").run(new Date().toISOString(), job.id);
        continue;
      }
      releaseSearchJobQuotaTransaction(job.id, job.user_id);
      db.prepare(`
        UPDATE search_jobs SET status = 'failed', phase = 'failed',
          error = 'A busca foi interrompida por uma reinicialização do servidor.', updated_at = ?
        WHERE id = ?
      `).run(new Date().toISOString(), job.id);
    }
  });
  recover();
  return interrupted.length;
}

export function deleteExpiredSearchJobs(maxAgeMs = 24 * 60 * 60 * 1000) {
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  return db.prepare("DELETE FROM search_jobs WHERE updated_at < ? AND status NOT IN ('queued', 'running')").run(cutoff).changes;
}

export function getSearchCache(cacheKey) {
  const row = db.prepare('SELECT payload, expires_at FROM search_cache WHERE cache_key = ?').get(cacheKey);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    db.prepare('DELETE FROM search_cache WHERE cache_key = ?').run(cacheKey);
    return null;
  }
  return parseJson(row.payload, null);
}

export function setSearchCache(cacheKey, source, payload, ttlMs) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + Math.max(1000, Number(ttlMs || 0)));
  db.prepare(`
    INSERT INTO search_cache (cache_key, source, payload, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(cache_key) DO UPDATE SET source = excluded.source, payload = excluded.payload,
      created_at = excluded.created_at, expires_at = excluded.expires_at
  `).run(cacheKey, source, JSON.stringify(payload), now.toISOString(), expiresAt.toISOString());
}

export function pruneSearchCache(maxEntries = 5000) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM search_cache WHERE expires_at <= ?').run(now);
  const count = db.prepare('SELECT COUNT(*) AS total FROM search_cache').get().total;
  if (count <= maxEntries) return 0;
  return db.prepare(`
    DELETE FROM search_cache WHERE cache_key IN (
      SELECT cache_key FROM search_cache ORDER BY created_at ASC LIMIT ?
    )
  `).run(count - maxEntries).changes;
}

export function recordSourceMetric(metric) {
  const id = metric.id || `metric_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO source_metrics (
      id, user_id, source, query, location, status, error_code, http_status,
      duration_ms, result_count, phone_count, website_count, cache_hit, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, metric.userId || null, metric.source, metric.query || '', metric.location || null,
    metric.status, metric.errorCode || null, metric.httpStatus || null,
    Number(metric.durationMs || 0), Number(metric.resultCount || 0),
    Number(metric.phoneCount || 0), Number(metric.websiteCount || 0),
    metric.cacheHit ? 1 : 0, metric.createdAt || new Date().toISOString()
  );
  return id;
}

export function listDebugSearches(email = '') {
  return db.prepare(`
    SELECT j.id, u.email, j.query, j.source, j.status, j.phase,
      j.found, j.analyzed, j.remaining, j.error, j.created_at, j.updated_at
    FROM search_jobs j JOIN users u ON u.id = j.user_id
    WHERE (? = '' OR LOWER(u.email) = ?)
    ORDER BY j.created_at DESC LIMIT 100
  `).all(email, email);
}

export function getSourceMetrics(days = 7) {
  const safeDays = Math.min(Math.max(Number(days) || 7, 1), 90);
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  const sources = db.prepare(`
    SELECT source,
      COUNT(*) AS attempts,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failures,
      SUM(CASE WHEN http_status = 429 OR error_code = 'SOURCE_RATE_LIMIT' THEN 1 ELSE 0 END) AS rate_limited,
      ROUND(AVG(duration_ms)) AS average_duration_ms,
      SUM(result_count) AS results,
      SUM(phone_count) AS phones,
      SUM(website_count) AS websites,
      SUM(cache_hit) AS cache_hits,
      MAX(created_at) AS last_attempt_at
    FROM source_metrics WHERE created_at >= ? GROUP BY source ORDER BY attempts DESC
  `).all(cutoff).map((row) => ({
    source: row.source,
    attempts: Number(row.attempts || 0),
    successes: Number(row.successes || 0),
    failures: Number(row.failures || 0),
    rateLimited: Number(row.rate_limited || 0),
    averageDurationMs: Number(row.average_duration_ms || 0),
    results: Number(row.results || 0),
    phones: Number(row.phones || 0),
    websites: Number(row.websites || 0),
    cacheHits: Number(row.cache_hits || 0),
    lastAttemptAt: row.last_attempt_at
  }));
  const recentErrors = db.prepare(`
    SELECT source, error_code AS errorCode, http_status AS httpStatus, created_at AS createdAt
    FROM source_metrics WHERE created_at >= ? AND status = 'failed'
    ORDER BY created_at DESC LIMIT 20
  `).all(cutoff);
  return { days: safeDays, sources, recentErrors };
}

export function getPendingPaymentByUser(userId) {
  return db.prepare(`
    SELECT * FROM payments
    WHERE user_id = ? AND status = 'pending'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(userId);
}

export function createPayment({ id, userId, plan, receiptPath = null, receiptName = null }) {
  const planData = getPlan(plan);
  if (!planData) {
    throw new Error('Plano inválido.');
  }

  const existing = getPendingPaymentByUser(userId);
  if (existing) {
    const err = new Error('Você já tem um pagamento aguardando aprovação.');
    err.code = 'PENDING_EXISTS';
    err.payment = existing;
    throw err;
  }

  db.prepare(`
    INSERT INTO payments (id, user_id, plan, amount, days, status, receipt_path, receipt_name)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
  `).run(id, userId, planData.id, planData.price, planData.days, receiptPath, receiptName);

  return db.prepare('SELECT * FROM payments WHERE id = ?').get(id);
}

export function listPendingPayments() {
  return db.prepare(`
    SELECT p.*, u.name as user_name, u.email as user_email
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.status = 'pending'
    ORDER BY p.created_at ASC
  `).all();
}

export function listRecentPayments(limit = 20) {
  return db.prepare(`
    SELECT p.*, u.name as user_name, u.email as user_email
    FROM payments p
    JOIN users u ON u.id = p.user_id
    ORDER BY p.created_at DESC
    LIMIT ?
  `).all(limit);
}

export function listPaymentsByUser(userId) {
  return db.prepare(`
    SELECT * FROM payments
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 10
  `).all(userId);
}

export function getPaymentById(id) {
  return db.prepare(`
    SELECT p.*, u.name as user_name, u.email as user_email
    FROM payments p
    JOIN users u ON u.id = p.user_id
    WHERE p.id = ?
  `).get(id);
}

export function approvePayment(id) {
  const payment = getPaymentById(id);
  if (!payment) return null;
  if (payment.status !== 'pending') {
    const err = new Error('Este pagamento já foi processado.');
    err.code = 'ALREADY_REVIEWED';
    throw err;
  }

  const apply = db.transaction(() => {
    db.prepare(`
      UPDATE payments
      SET status = 'approved', reviewed_at = ?
      WHERE id = ?
    `).run(new Date().toISOString(), id);

    return updateUserSubscription(payment.user_id, payment.days, payment.plan);
  });

  const user = apply();
  return { payment: getPaymentById(id), user };
}

export function rejectPayment(id) {
  const payment = getPaymentById(id);
  if (!payment) return null;
  if (payment.status !== 'pending') {
    const err = new Error('Este pagamento já foi processado.');
    err.code = 'ALREADY_REVIEWED';
    throw err;
  }

  db.prepare(`
    UPDATE payments
    SET status = 'rejected', reviewed_at = ?
    WHERE id = ?
  `).run(new Date().toISOString(), id);

  return getPaymentById(id);
}

export function getSystemStats() {
  const totalUsers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin'").get().count;
  const nowIso = new Date().toISOString();
  const activeSubscribers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role != 'admin' AND status = 'active' AND is_trial = 0 AND subscription_expires_at > ?").get(nowIso).count;
  const expiredSubscribers = totalUsers - activeSubscribers;
  const totalSearches = db.prepare('SELECT COUNT(*) as count FROM searches').get().count;
  const pendingPayments = db.prepare("SELECT COUNT(*) as count FROM payments WHERE status = 'pending'").get().count;
  const approvedRevenue = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'approved'").get().total;
  const clientsWon = db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'cliente'").get().count;
  const contactedLeads = db.prepare("SELECT COUNT(*) as count FROM leads WHERE contacted = 1").get().count;

  return {
    totalUsers,
    activeSubscribers,
    expiredSubscribers,
    totalSearches,
    pendingPayments,
    approvedRevenue,
    conversionRate: contactedLeads ? Math.round((clientsWon / contactedLeads) * 1000) / 10 : 0
  };
}

// ==========================================
// 🔒 CONTROLE DE BUSCA DIÁRIA (1 busca/dia grátis)
// ==========================================

function getBRTDate() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).toISOString().split('T')[0];
}

export function hasActiveSubscription(user) {
  if (user.role === 'admin') return true;
  if (!user.subscription_expires_at) return false;
  const expiresAt = new Date(user.subscription_expires_at);
  return expiresAt > new Date();
}

export function requireActiveSubscriptionCheck(user) {
  if (user.role === 'admin') return { allowed: true, reason: 'Admin' };

  // Teste grátis não conta como assinatura ativa (recursos pagos ficam bloqueados)
  if (user.is_trial) {
    return { allowed: false, reason: 'Teste gratuito' };
  }

  if (!user.subscription_expires_at) {
    return { allowed: false, reason: 'Sem assinatura' };
  }

  const expiresAt = new Date(user.subscription_expires_at);
  const now = new Date();

  if (now > expiresAt) {
    return { allowed: false, reason: 'Assinatura expirada' };
  }

  return { allowed: true, reason: 'Assinatura ativa' };
}

export function canUserSearch(userId) {
  const user = db.prepare('SELECT role, is_trial, subscription_expires_at, last_search_date, daily_search_count FROM users WHERE id = ?').get(userId);

  if (!user) return { allowed: false, reason: 'Usuário não encontrado.' };
  if (user.role === 'admin') return { allowed: true, reason: 'Admin' };

  const isActivePaid = !!user.subscription_expires_at && new Date(user.subscription_expires_at) > new Date();

  if (user.is_trial) {
    // Teste grátis expirado => bloqueio total (deve pagar para continuar)
    if (!isActivePaid) {
      return { allowed: false, reason: 'Seu período grátis de 7 dias terminou. Renove seu plano para continuar.' };
    }
    // Teste ativo => limite de 1 busca/dia
    const today = getBRTDate();
    if (user.last_search_date === today) {
      return {
        allowed: false,
        reason: 'Limite diário atingido (1 busca). Renove seu plano para buscar mais leads.'
      };
    }
    return { allowed: true, reason: 'Busca diária disponível (teste grátis).' };
  }

  // Assinante pago ativo => buscas ilimitadas
  if (isActivePaid) {
    return { allowed: true, reason: 'Assinatura ativa.' };
  }

  // Sem assinatura ativa ou expirada => bloqueado
  return { allowed: false, reason: 'Sem assinatura ativa. Renove seu plano para buscar leads.' };
}

export function recordSearch(userId) {
  const today = getBRTDate();
  const user = db.prepare('SELECT last_search_date, daily_search_count FROM users WHERE id = ?').get(userId);
  const isSameDay = user && user.last_search_date === today;

  db.prepare(`
    UPDATE users
    SET last_search_date = ?, daily_search_count = ?
    WHERE id = ?
  `).run(today, isSameDay ? (user.daily_search_count || 0) + 1 : 1, userId);
}

const consumeSearchQuotaTransaction = db.transaction((userId) => {
  const permission = canUserSearch(userId);
  if (!permission.allowed) return permission;

  const user = db.prepare('SELECT role, is_trial FROM users WHERE id = ?').get(userId);
  if (!user || user.role === 'admin' || !user.is_trial) return permission;

  recordSearch(userId);
  return { ...permission, reserved: true, quotaDate: getBRTDate() };
});

export function consumeSearchQuota(userId) {
  return consumeSearchQuotaTransaction(userId);
}

// ==========================================
// 💾 PERSISTÊNCIA DE LEADS (por usuário)
// ==========================================

function leadRowToObj(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    address: row.address || 'Endereço no Google Maps',
    phone: row.phone || 'Não informado',
    whatsappPhone: row.whatsapp_phone || null,
    website: row.website || null,
    hasWebsite: row.has_website === 1,
    hasRealWebsite: row.has_real_website === 1,
    isSocialMedia: row.is_social_media === 1,
    rating: row.rating || 0,
    totalRatings: row.total_ratings || 0,
    mapsUrl: row.maps_url || '',
    status: row.status || 'novo',
    contacted: row.contacted === 1,
    selectedMessage: row.selected_message || null,
    searchId: row.search_id || null,
    notes: row.notes || '',
    tags: safeJsonArray(row.tags),
    nextFollowUp: row.next_follow_up || null,
    estimatedValue: Number(row.estimated_value || 0),
    whatsappVerified: row.whatsapp_verified === 1,
    source: row.source || 'google_maps'
  };
}

function safeJsonArray(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function upsertLeads(userId, leads, { searchId = null, source = 'google_maps' } = {}) {
  const nowIso = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO leads (
      id, user_id, name, address, phone, whatsapp_phone, website,
      has_website, has_real_website, is_social_media, rating, total_ratings,
      maps_url, status, contacted, selected_message, search_id, notes, tags,
      next_follow_up, estimated_value, whatsapp_verified, source, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      address = excluded.address,
      phone = excluded.phone,
      whatsapp_phone = excluded.whatsapp_phone,
      website = excluded.website,
      has_website = excluded.has_website,
      has_real_website = excluded.has_real_website,
      is_social_media = excluded.is_social_media,
      rating = excluded.rating,
      total_ratings = excluded.total_ratings,
      maps_url = excluded.maps_url,
      search_id = COALESCE(excluded.search_id, leads.search_id),
      source = COALESCE(excluded.source, leads.source),
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction((items) => {
    for (const lead of items) {
      upsert.run(
        lead.id,
        userId,
        lead.name || '',
        lead.address || '',
        lead.phone || '',
        lead.whatsappPhone || null,
        lead.website || null,
        lead.hasWebsite ? 1 : 0,
        lead.hasRealWebsite ? 1 : 0,
        lead.isSocialMedia ? 1 : 0,
        lead.rating || 0,
        lead.totalRatings || 0,
        lead.mapsUrl || '',
        lead.status || 'novo',
        lead.contacted ? 1 : 0,
        lead.selectedMessage || null,
        searchId || lead.searchId || null,
        lead.notes || '',
        JSON.stringify(Array.isArray(lead.tags) ? lead.tags : []),
        lead.nextFollowUp || null,
        Number(lead.estimatedValue || 0),
        lead.whatsappVerified ? 1 : 0,
        lead.source || source,
        nowIso,
        nowIso
      );
    }
  });

  transaction(leads);
  return leads.length;
}

export function getLeadsByUser(userId, { searchId = null, listId = null } = {}) {
  let rows;
  if (listId) {
    rows = db.prepare(`
      SELECT l.* FROM leads l
      JOIN lead_lists ll ON ll.lead_id = l.id AND ll.user_id = l.user_id
      WHERE l.user_id = ? AND ll.list_id = ?
      ORDER BY l.updated_at DESC, l.created_at DESC
    `).all(userId, listId);
  } else if (searchId) {
    rows = db.prepare(`
      SELECT * FROM leads WHERE user_id = ? AND search_id = ?
      ORDER BY updated_at DESC, created_at DESC
    `).all(userId, searchId);
  } else {
    rows = db.prepare(`
    SELECT * FROM leads
    WHERE user_id = ?
    ORDER BY updated_at DESC, created_at DESC
    `).all(userId);
  }
  return rows.map(leadRowToObj);
}

export function getLeadById(userId, leadId) {
  const row = db.prepare('SELECT * FROM leads WHERE id = ? AND user_id = ?').get(leadId, userId);
  return leadRowToObj(row);
}

export function updateLead(userId, lead) {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE leads SET
      status = ?, contacted = ?, selected_message = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    lead.status || 'novo',
    lead.contacted ? 1 : 0,
    lead.selectedMessage || null,
    nowIso,
    lead.id,
    userId
  );
  return getLeadById(userId, lead.id);
}

export function updateLeadStatus(userId, leadId, status) {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE leads SET status = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(status, nowIso, leadId, userId);
  return getLeadById(userId, leadId);
}

export function updateLeadDetails(userId, leadId, changes) {
  const current = getLeadById(userId, leadId);
  if (!current) return null;
  const next = {
    notes: changes.notes ?? current.notes,
    tags: changes.tags ?? current.tags,
    nextFollowUp: changes.nextFollowUp === undefined ? current.nextFollowUp : changes.nextFollowUp,
    estimatedValue: changes.estimatedValue ?? current.estimatedValue,
    status: changes.status ?? current.status
  };
  db.prepare(`
    UPDATE leads SET notes = ?, tags = ?, next_follow_up = ?, estimated_value = ?, status = ?, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(
    next.notes,
    JSON.stringify(next.tags),
    next.nextFollowUp || null,
    Number(next.estimatedValue || 0),
    next.status,
    new Date().toISOString(),
    leadId,
    userId
  );
  return getLeadById(userId, leadId);
}

export function getFollowUpReminders(userId) {
  return db.prepare(`
    SELECT * FROM leads
    WHERE user_id = ? AND next_follow_up IS NOT NULL AND status != 'cliente'
    ORDER BY next_follow_up ASC LIMIT 50
  `).all(userId).map(leadRowToObj);
}

export function createProspectingList(userId, name, description = '') {
  const id = `list_${crypto.randomUUID()}`;
  db.prepare('INSERT INTO prospecting_lists (id, user_id, name, description) VALUES (?, ?, ?, ?)')
    .run(id, userId, name, description);
  return getProspectingList(userId, id);
}

export function getProspectingList(userId, listId) {
  return db.prepare(`
    SELECT pl.*, COUNT(ll.lead_id) AS leadCount
    FROM prospecting_lists pl
    LEFT JOIN lead_lists ll ON ll.list_id = pl.id AND ll.user_id = pl.user_id
    WHERE pl.id = ? AND pl.user_id = ? GROUP BY pl.id
  `).get(listId, userId);
}

export function listProspectingLists(userId) {
  return db.prepare(`
    SELECT pl.*, COUNT(ll.lead_id) AS leadCount
    FROM prospecting_lists pl
    LEFT JOIN lead_lists ll ON ll.list_id = pl.id AND ll.user_id = pl.user_id
    WHERE pl.user_id = ? GROUP BY pl.id ORDER BY pl.updated_at DESC
  `).all(userId);
}

export function addLeadsToList(userId, listId, leadIds) {
  const list = getProspectingList(userId, listId);
  if (!list) return null;
  const insert = db.prepare('INSERT OR IGNORE INTO lead_lists (user_id, list_id, lead_id) VALUES (?, ?, ?)');
  db.transaction((ids) => ids.forEach((leadId) => insert.run(userId, listId, leadId)))(leadIds);
  db.prepare('UPDATE prospecting_lists SET updated_at = ? WHERE id = ? AND user_id = ?')
    .run(new Date().toISOString(), listId, userId);
  return getProspectingList(userId, listId);
}

export function deleteProspectingList(userId, listId) {
  return db.prepare('DELETE FROM prospecting_lists WHERE id = ? AND user_id = ?').run(listId, userId);
}

export function getLeadDashboardStats(userId) {
  const stages = db.prepare(`
    SELECT status, COUNT(*) AS total, COALESCE(SUM(estimated_value), 0) AS value
    FROM leads WHERE user_id = ? GROUP BY status
  `).all(userId);
  const total = stages.reduce((sum, item) => sum + item.total, 0);
  const clients = stages.find((item) => item.status === 'cliente')?.total || 0;
  const contacted = db.prepare('SELECT COUNT(*) AS total FROM leads WHERE user_id = ? AND contacted = 1').get(userId).total;
  const topSearches = db.prepare(`
    SELECT query, SUM(total_leads) AS leads, COUNT(*) AS searches
    FROM searches WHERE user_id = ? GROUP BY LOWER(query) ORDER BY leads DESC LIMIT 5
  `).all(userId);
  return {
    total,
    contacted,
    clients,
    conversionRate: contacted ? Math.round((clients / contacted) * 1000) / 10 : 0,
    pipelineValue: stages.reduce((sum, item) => sum + Number(item.value || 0), 0),
    stages,
    topSearches
  };
}

export function createPasswordResetToken(email, token, expiresAt) {
  const result = db.prepare(`
    UPDATE users SET password_reset_token = ?, password_reset_expires_at = ? WHERE LOWER(email) = LOWER(?)
  `).run(token, expiresAt, email);
  return result.changes > 0;
}

export function resetPasswordWithToken(token, passwordHash) {
  const user = db.prepare(`
    SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires_at > ?
  `).get(token, new Date().toISOString());
  if (!user) return false;
  db.prepare(`
    UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires_at = NULL WHERE id = ?
  `).run(passwordHash, user.id);
  return true;
}

export function changeUserPassword(userId, passwordHash) {
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, userId);
}

export function verifyUserEmail(token) {
  const result = db.prepare(`
    UPDATE users SET email_verified = 1, email_verification_token = NULL WHERE email_verification_token = ?
  `).run(token);
  return result.changes > 0;
}

export function logAdminAction(adminId, action, targetType, targetId, details = {}) {
  db.prepare(`
    INSERT INTO admin_actions (id, admin_id, action, target_type, target_id, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`audit_${crypto.randomUUID()}`, adminId, action, targetType, targetId, JSON.stringify(details));
}

export function listAdminActions(limit = 50) {
  return db.prepare(`
    SELECT aa.*, u.name AS adminName FROM admin_actions aa
    JOIN users u ON u.id = aa.admin_id ORDER BY aa.created_at DESC LIMIT ?
  `).all(limit);
}

export function markLeadContacted(userId, leadId) {
  const nowIso = new Date().toISOString();
  db.prepare(`
    UPDATE leads SET contacted = 1, updated_at = ?
    WHERE id = ? AND user_id = ?
  `).run(nowIso, leadId, userId);
  return getLeadById(userId, leadId);
}

export function closeDatabase() {
  if (db.open) db.close();
}

export function clearUserLeads(userId) {
  return db.prepare('DELETE FROM leads WHERE user_id = ?').run(userId);
}

// Substitui a lista completa de leads do usuário de forma atômica (clear + insert)
export function replaceUserLeads(userId, leads) {
  const nowIso = new Date().toISOString();
  const transaction = db.transaction((items) => {
    db.prepare('DELETE FROM leads WHERE user_id = ?').run(userId);
    const insert = db.prepare(`
      INSERT INTO leads (
        id, user_id, name, address, phone, whatsapp_phone, website,
        has_website, has_real_website, is_social_media, rating, total_ratings,
        maps_url, status, contacted, selected_message, search_id, notes, tags,
        next_follow_up, estimated_value, whatsapp_verified, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const lead of items) {
      const id = lead.id || ('lead_' + Math.random().toString(36).slice(2, 10));
      insert.run(
        id,
        userId,
        lead.name || '',
        lead.address || '',
        lead.phone || '',
        lead.whatsappPhone || null,
        lead.website || null,
        lead.hasWebsite ? 1 : 0,
        lead.hasRealWebsite ? 1 : 0,
        lead.isSocialMedia ? 1 : 0,
        lead.rating || 0,
        lead.totalRatings || 0,
        lead.mapsUrl || '',
        lead.status || 'novo',
        lead.contacted ? 1 : 0,
        lead.selectedMessage || null,
        lead.searchId || null,
        lead.notes || '',
        JSON.stringify(Array.isArray(lead.tags) ? lead.tags : []),
        lead.nextFollowUp || null,
        Number(lead.estimatedValue || 0),
        lead.whatsappVerified ? 1 : 0,
        nowIso,
        nowIso
      );
    }
  });
  transaction(leads);
  return leads.length;
}

export default db;

export function listRunningSearchJobs() {
  return db.prepare("SELECT * FROM search_jobs WHERE status IN ('queued', 'running') ORDER BY created_at").all().map(searchJobRowToObject);
}
export function getLatestSearchJob(userId) {
  return searchJobRowToObject(db.prepare('SELECT * FROM search_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').get(userId));
}
export function saveJobProgress(job) {
  db.transaction(() => {
    saveSearchJob(job);
    logSearch(job.searchId, job.userId, job.query, job.results?.length || 0, job.source, job.criteria);
    db.prepare('UPDATE searches SET status = ? WHERE id = ? AND user_id = ?').run(job.status, job.searchId, job.userId);
    if (job.results?.length) upsertLeads(job.userId, job.results, { searchId: job.searchId, source: job.source });
  })();
}
