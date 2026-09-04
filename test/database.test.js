import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import bcrypt from 'bcryptjs';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sevenleads-db-'));
process.env.SEVENLEADS_DIR = tempDir;
const database = await import('../src/database.js');

test('cria usuário e controla dados comerciais do lead', () => {
  const user = database.createUser({
    id: 'usr_test', name: 'Cliente Teste', email: 'cliente@teste.local',
    passwordHash: bcrypt.hashSync('senha-segura', 4), isTrial: true
  });
  assert.equal(user.email, 'cliente@teste.local');

  database.logSearch('search_test', user.id, 'Dentistas em Limeira', 1);
  database.upsertLeads(user.id, [{
    id: 'lead_test', name: 'Clínica Teste', address: 'Centro', phone: '19999999999',
    whatsappPhone: '5519999999999', status: 'novo'
  }], { searchId: 'search_test' });

  const updated = database.updateLeadDetails(user.id, 'lead_test', {
    status: 'proposta', tags: ['quente'], notes: 'Enviar proposta',
    nextFollowUp: '2030-01-10T10:00:00.000Z', estimatedValue: 1500
  });
  assert.equal(updated.status, 'proposta');
  assert.deepEqual(updated.tags, ['quente']);
  assert.equal(updated.estimatedValue, 1500);

  const list = database.createProspectingList(user.id, 'Dentistas de Limeira');
  database.addLeadsToList(user.id, list.id, ['lead_test']);
  assert.equal(database.getLeadsByUser(user.id, { listId: list.id }).length, 1);
  assert.equal(database.listSearchHistory(user.id)[0].query, 'Dentistas em Limeira');
});

test('gera métricas do funil', () => {
  database.updateLeadDetails('usr_test', 'lead_test', { status: 'cliente' });
  database.markLeadContacted('usr_test', 'lead_test');
  const stats = database.getLeadDashboardStats('usr_test');
  assert.equal(stats.clients, 1);
  assert.equal(stats.conversionRate, 100);
});

test('reserva a busca gratuita de forma atômica', () => {
  const first = database.consumeSearchQuota('usr_test');
  const second = database.consumeSearchQuota('usr_test');
  assert.equal(first.allowed, true);
  assert.equal(second.allowed, false);
});

test('persiste trabalho, devolve cota com falha e mantém cache', () => {
  const user = database.createUser({
    id: 'usr_job', name: 'Cliente Job', email: 'job@teste.local',
    passwordHash: bcrypt.hashSync('senha-segura', 4), isTrial: true
  });
  const quota = database.consumeSearchQuota(user.id);
  const now = new Date().toISOString();
  database.saveSearchJob({
    id: 'job_test', userId: user.id, query: 'Dentistas — Los Angeles, USA',
    criteria: { categoryId: 'dentists', city: 'Los Angeles', country: 'USA' },
    source: 'all_world', sourceLabel: 'All World', maxResults: 50,
    status: 'running', phase: 'collecting', quotaReserved: quota.reserved,
    quotaReleased: false, quotaDate: quota.quotaDate, createdAt: now, updatedAt: now
  });
  assert.equal(database.getPersistedActiveSearchJob(user.id).id, 'job_test');
  assert.equal(database.releaseSearchJobQuota('job_test', user.id), true);
  assert.equal(database.canUserSearch(user.id).allowed, true);

  database.setSearchCache('world:test', 'all_world', { count: 2 }, 60_000);
  assert.deepEqual(database.getSearchCache('world:test'), { count: 2 });
});

test('registra monitoramento das fontes', () => {
  database.recordSourceMetric({
    userId: 'usr_job', source: 'all_world', query: 'dentista em Los Angeles',
    location: 'Los Angeles, USA', status: 'completed', durationMs: 1200,
    resultCount: 50, phoneCount: 20, websiteCount: 30, cacheHit: true
  });
  const metrics = database.getSourceMetrics(7);
  assert.equal(metrics.sources[0].source, 'all_world');
  assert.equal(metrics.sources[0].results, 50);
  assert.equal(metrics.sources[0].cacheHits, 1);
});

test('excluir usuário remove seus dados relacionados em cascata', () => {
  database.deleteUserById('usr_test');
  assert.equal(database.getUserById('usr_test'), undefined);
  assert.equal(database.getLeadsByUser('usr_test').length, 0);
  assert.equal(database.listSearchHistory('usr_test').length, 0);
  assert.equal(database.listProspectingLists('usr_test').length, 0);
});

test.after(() => {
  database.closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
