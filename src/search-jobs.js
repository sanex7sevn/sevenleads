import crypto from 'crypto';
import { deleteExpiredSearchJobs, getPersistedActiveSearchJob, getPersistedSearchJob, recoverInterruptedSearchJobs,
  releaseSearchJobQuota, saveSearchJob, saveJobProgress, listRunningSearchJobs, getLatestSearchJob } from './database.js';
import { prepareSearchResults } from './lead-normalization.js';

const controllers = new Map();
const JOB_TTL_MS = 24 * 60 * 60 * 1000;
const INACTIVITY_MS = 5 * 60 * 1000;
function cancellationError() {
  const error = new Error('Busca cancelada pelo usuário.'); error.code = 'SEARCH_CANCELLED'; return error;
}
function launchJob(job, runner) {
  job.searchId ||= 'srch_' + crypto.randomUUID();
  const controller = new AbortController();
  controllers.set(job.id, controller);
  job.status = 'queued'; job.phase = 'queued'; job.error = null;
  job.updatedAt = new Date().toISOString(); saveSearchJob(job);
  Promise.resolve().then(async () => {
    let timer;
    let alive = true;
    let timedOut = false;
    let rejectIdle;
    const idle = new Promise((_, reject) => { rejectIdle = reject; });
    const guard = () => { if (!alive || controller.signal.aborted) throw cancellationError(); };
    // Starts only when the scraper gets its queue slot. Total search duration
    // has no deadline; a stuck operation is a technical interruption, not success.
    const heartbeat = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true; controller.abort();
        const error = new Error('Busca interrompida: o coletor ficou sem responder. O progresso foi salvo; use Retomar busca.');
        error.code = 'SEARCH_STALLED'; rejectIdle(error);
      }, INACTIVITY_MS);
    };
    try {
      const outcome = await Promise.race([runner({
        signal: controller.signal, checkpoint: job.checkpoint, searchId: job.searchId,
        onProgress(progress) {
          guard(); heartbeat();
          Object.assign(job, progress, { status: 'running', updatedAt: new Date().toISOString() });
          saveSearchJob(job);
        },
        onCheckpoint(state) {
          guard(); heartbeat();
          job.checkpoint = structuredClone(state);
          job.results = prepareSearchResults(job.userId, state.results).filter((lead) => lead.whatsappPhone).slice(0, job.maxResults);
          job.found = state.candidates.length; job.analyzed = state.processed.length;
          job.remaining = Math.max(0, job.maxResults - job.results.length);
          job.updatedAt = new Date().toISOString();
          saveJobProgress(job);
        }
      }), idle]);
      guard();
      const results = Array.isArray(outcome) ? outcome : outcome.results || [];
      job.results = results;
      if (!Array.isArray(outcome)) {
        job.searchId = outcome.searchId || job.searchId;
        job.error = outcome.warning || null;
        job.completionReason = outcome.completionReason || null;
        job.hasActiveSubscription = Boolean(outcome.hasActiveSubscription);
        job.interpretedLocation = outcome.interpretedLocation || job.interpretedLocation;
      }
      if (job.source === 'google_maps' && results.length < job.maxResults && job.completionReason !== 'source_exhausted') {
        throw new Error('Busca interrompida; quantidade ainda não atingida e a fonte não confirmou o fim da lista. Use Retomar busca.');
      }
      if (job.source !== 'google_maps') { job.found = results.length; job.analyzed = results.length; }
      job.remaining = Math.max(0, job.maxResults - results.length);
      job.status = 'completed'; job.phase = job.completionReason || 'completed';
    } catch (error) {
      const cancelled = !timedOut && (controller.signal.aborted || error.code === 'SEARCH_CANCELLED');
      job.status = cancelled ? 'cancelled' : job.source === 'google_maps' ? 'interrupted' : 'failed';
      job.phase = job.status;
      job.error = cancelled ? 'Busca cancelada. Os leads já coletados foram preservados.' : error.message || 'Busca interrompida. Use Retomar busca.';
      if ((cancelled || job.status === 'failed') && job.quotaReserved && !job.quotaReleased) {
        releaseSearchJobQuota(job.id, job.userId); job.quotaReleased = true;
      }
    } finally {
      alive = false; clearTimeout(timer); controllers.delete(job.id);
      job.updatedAt = new Date().toISOString();
      saveJobProgress(job);
    }
  });
  return publicJob(job);
}
export function startSearchJob(userId, query, runner, meta = {}) {
  const now = new Date().toISOString();
  const job = {
    id: 'job_' + crypto.randomUUID(), userId, query, criteria: meta.criteria || {}, source: meta.source || null,
    sourceLabel: meta.sourceLabel || null, maxResults: Number(meta.maxResults || 50), status: 'queued', phase: 'queued',
    found: 0, analyzed: 0, remaining: Number(meta.maxResults || 50), results: [], error: null,
    searchId: 'srch_' + crypto.randomUUID(), checkpoint: null, completionReason: null,
    interpretedLocation: null, hasActiveSubscription: Boolean(meta.hasActiveSubscription),
    quotaReserved: Boolean(meta.quotaReserved), quotaReleased: false, quotaDate: meta.quotaDate || null,
    createdAt: now, updatedAt: now
  };
  return launchJob(job, runner);
}
export function getActiveSearchJob(userId) { return publicJob(getPersistedActiveSearchJob(userId)); }
export function getSearchJob(userId, id) { return publicJob(getPersistedSearchJob(userId, id)); }
export function getLatestJob(userId) { return publicJob(getLatestSearchJob(userId)); }
export function resumeSearchJob(userId, id, makeRunner) {
  const job = getPersistedSearchJob(userId, id);
  if (!job || job.source !== 'google_maps' || job.status !== 'interrupted' || controllers.has(id) || getPersistedActiveSearchJob(userId)) return null;
  return launchJob(job, makeRunner(job));
}
export function restoreSearchJobs(makeRunner) {
  const saved = listRunningSearchJobs();
  recoverInterruptedSearchJobs({ preserveGoogle: true });
  for (const job of saved.filter((item) => item.source === 'google_maps')) {
    try { launchJob(job, makeRunner(job)); }
    catch (error) { job.status = 'interrupted'; job.phase = 'interrupted'; job.error = error.message; saveSearchJob(job); }
  }
}
export function cancelSearchJob(userId, id) {
  const job = getPersistedSearchJob(userId, id);
  if (!job) return null;
  if (['queued', 'running', 'interrupted'].includes(job.status)) {
    controllers.get(id)?.abort(); job.status = 'cancelled'; job.phase = 'cancelled'; job.error = 'Busca cancelada pelo usuário.';
    if (job.quotaReserved && !job.quotaReleased) { releaseSearchJobQuota(id, userId); job.quotaReleased = true; }
    job.updatedAt = new Date().toISOString(); saveJobProgress(job);
  }
  return publicJob(job);
}
function publicJob(job) {
  if (!job) return null;
  const { userId, checkpoint, quotaReserved, quotaReleased, quotaDate, ...safe } = job;
  return { ...safe, savedCount: job.results?.length || 0, canResume: job.source === 'google_maps' && job.status === 'interrupted',
    warning: job.status === 'completed' ? job.error : null, error: job.status === 'completed' ? null : job.error };
}
setInterval(() => deleteExpiredSearchJobs(JOB_TTL_MS), 30 * 60 * 1000).unref();
