import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seven-target-jobs-'));
process.env.SEVENLEADS_DIR = temp;
const db = await import('../src/database.js');
const jobs = await import('../src/search-jobs.js');
db.createUser({ id: 'owner', name: 'Owner', email: 'owner@test.local', passwordHash: 'not-used', isTrial: false });
db.createUser({ id: 'other', name: 'Other', email: 'other@test.local', passwordHash: 'not-used', isTrial: false });
const state = { version: 1, exhausted: true, candidates: [{ name: 'One' }], processed: ['one'], results: [{ name: 'One', phone: '11999999999', whatsappPhone: '5511999999999' }] };
async function terminal(id) {
  for (let i = 0; i < 200; i++) {
    const job = jobs.getSearchJob('owner', id);
    if (!['queued', 'running'].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail('job never finished');
}
test('checkpoint saves leads, history and state; technical error is resumable and private', async () => {
  const started = jobs.startSearchJob('owner', 'Clinics', async (opts) => {
    opts.onProgress({ phase: 'analyzing' }); opts.onCheckpoint(state); throw new Error('navigation timeout');
  }, { source: 'google_maps', maxResults: 50 });
  const stopped = await terminal(started.id);
  assert.equal(stopped.status, 'interrupted'); assert.equal(stopped.savedCount, 1); assert.equal(stopped.canResume, true);
  assert.equal(stopped.checkpoint, undefined);
  assert.equal(jobs.getSearchJob('other', started.id), null);
  assert.equal(db.getLeadsByUser('owner').length, 1);
  assert.equal(db.getSearchById('owner', stopped.searchId).totalLeads, 1);
  assert.equal(db.getPersistedSearchJob('owner', stopped.id).checkpoint.processed.length, 1);
  assert.equal(jobs.resumeSearchJob('other', started.id, () => assert.fail('not owner')), null);
  const resumed = jobs.resumeSearchJob('owner', started.id, (saved) => async (opts) => {
    assert.equal(opts.checkpoint.results.length, 1); assert.equal(saved.searchId, stopped.searchId);
    return { results: stopped.results, completionReason: 'source_exhausted', warning: 'Lista esgotada', searchId: stopped.searchId };
  });
  assert.equal(resumed.id, started.id);
  const done = await terminal(started.id);
  assert.equal(done.status, 'completed'); assert.equal(done.warning, 'Lista esgotada');
  assert.equal(db.listSearchHistory('owner').filter((s) => s.id === done.searchId).length, 1);
});
test('short successful runner without exhaustion is converted to interrupted', async () => {
  const started = jobs.startSearchJob('owner', 'Short', async () => ({ results: [], completionReason: 'target_reached' }), { source: 'google_maps', maxResults: 50 });
  assert.equal((await terminal(started.id)).status, 'interrupted');
});
test('restart resumes persisted active Google jobs with the same search ID', async () => {
  const now = new Date().toISOString();
  db.saveSearchJob({ id: 'restart', userId: 'owner', query: 'Restart', source: 'google_maps', maxResults: 50, status: 'running', phase: 'analyzing',
    checkpoint: state, searchId: 'restart-search', results: [], createdAt: now, updatedAt: now });
  jobs.restoreSearchJobs((saved) => async (opts) => {
    assert.equal(saved.id, 'restart'); assert.equal(opts.checkpoint.results.length, 1);
    opts.onCheckpoint(state);
    return { results: jobs.getSearchJob('owner', saved.id).results, completionReason: 'source_exhausted', searchId: saved.searchId };
  });
  const done = await terminal('restart');
  assert.equal(done.status, 'completed'); assert.equal(done.searchId, 'restart-search');
});
test('late runner progress after cancellation cannot overwrite terminal state', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const started = jobs.startSearchJob('owner', 'Cancel', async (opts) => {
    opts.onProgress({ phase: 'analyzing' });
    await pending; opts.onCheckpoint(state); return { results: [] };
  }, { source: 'google_maps', maxResults: 50 });
  await new Promise((resolve) => setTimeout(resolve, 10));
  jobs.cancelSearchJob('owner', started.id); release();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const stopped = jobs.getSearchJob('owner', started.id);
  assert.equal(stopped.status, 'cancelled'); assert.equal(stopped.savedCount, 0);
});
test.after(() => { db.closeDatabase(); fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); });
