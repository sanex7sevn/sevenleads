import crypto from 'crypto';
import {
  deleteExpiredSearchJobs,
  getPersistedActiveSearchJob,
  getPersistedSearchJob,
  recoverInterruptedSearchJobs,
  releaseSearchJobQuota,
  saveSearchJob
} from './database.js';

const controllers = new Map();
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

recoverInterruptedSearchJobs();

function cancellationError() {
  const error = new Error('Busca cancelada pelo usuário.');
  error.code = 'SEARCH_CANCELLED';
  return error;
}

export function startSearchJob(userId, query, runner, meta = {}) {
  const id = `job_${crypto.randomUUID()}`;
  const controller = new AbortController();
  const now = new Date().toISOString();
  const job = {
    id,
    userId,
    query,
    criteria: meta.criteria || {},
    source: meta.source || null,
    sourceLabel: meta.sourceLabel || null,
    maxResults: Number(meta.maxResults || 50),
    status: 'queued',
    phase: 'queued',
    found: 0,
    analyzed: 0,
    remaining: 0,
    results: null,
    error: null,
    searchId: null,
    interpretedLocation: null,
    hasActiveSubscription: false,
    quotaReserved: Boolean(meta.quotaReserved),
    quotaReleased: false,
    quotaDate: meta.quotaDate || null,
    createdAt: now,
    updatedAt: now
  };
  controllers.set(id, controller);
  saveSearchJob(job);

  Promise.resolve().then(async () => {
    job.status = 'running';
    job.phase = 'starting';
    job.updatedAt = new Date().toISOString();
    saveSearchJob(job);
    try {
      const outcome = await runner({
        signal: controller.signal,
        onProgress(progress) {
          Object.assign(job, progress, { updatedAt: new Date().toISOString() });
          saveSearchJob(job);
        }
      });
      if (controller.signal.aborted) throw cancellationError();
      const results = Array.isArray(outcome) ? outcome : (outcome.results || []);
      job.results = results;
      if (!Array.isArray(outcome)) {
        job.searchId = outcome.searchId || null;
        job.hasActiveSubscription = Boolean(outcome.hasActiveSubscription);
        job.interpretedLocation = outcome.interpretedLocation || job.interpretedLocation;
      }
      job.found = results.length;
      job.analyzed = results.length;
      job.remaining = 0;
      job.status = 'completed';
      job.phase = 'completed';
    } catch (error) {
      const cancelled = controller.signal.aborted || error.code === 'SEARCH_CANCELLED';
      job.status = cancelled ? 'cancelled' : 'failed';
      job.phase = job.status;
      job.error = error.message || 'Não foi possível concluir a busca.';
      if (job.quotaReserved && !job.quotaReleased) {
        releaseSearchJobQuota(job.id, userId);
        job.quotaReleased = true;
      }
    } finally {
      controllers.delete(id);
      job.updatedAt = new Date().toISOString();
      saveSearchJob(job);
    }
  });

  return publicJob(job);
}

export function getActiveSearchJob(userId) {
  return publicJob(getPersistedActiveSearchJob(userId));
}

export function getSearchJob(userId, id) {
  return publicJob(getPersistedSearchJob(userId, id));
}

export function cancelSearchJob(userId, id) {
  const job = getPersistedSearchJob(userId, id);
  if (!job) return null;
  if (job.status === 'queued' || job.status === 'running') {
    controllers.get(id)?.abort();
    job.status = 'cancelled';
    job.phase = 'cancelled';
    job.error = 'Busca cancelada pelo usuário.';
    if (job.quotaReserved && !job.quotaReleased) {
      releaseSearchJobQuota(id, userId);
      job.quotaReleased = true;
    }
    job.updatedAt = new Date().toISOString();
    saveSearchJob(job);
  }
  return publicJob(job);
}

function publicJob(job) {
  if (!job) return null;
  const { userId, quotaReserved, quotaReleased, quotaDate, ...safe } = job;
  return safe;
}

setInterval(() => {
  deleteExpiredSearchJobs(JOB_TTL_MS);
}, 30 * 60 * 1000).unref();
