import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import puppeteer from 'puppeteer';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'seven-ui-target-'));
Object.assign(process.env, { SEVENLEADS_DATA_DIR: temp, SEVENLEADS_DIR: process.cwd(), PORT: '0', JWT_SECRET: 'ui-test-only-secret', ADMIN_EMAIL: 'admin@ui.test', ADMIN_PASSWORD: 'test-password', PIX_KEY: 'test-key' });
const { server, closeDatabase } = await import('../server.js');
const db = await import('../src/database.js');
const { generateToken } = await import('../src/auth.js');
await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
const user = db.createUser({ id: 'ui-user', name: 'Cliente de teste', email: 'client@ui.test', passwordHash: 'unused', isTrial: false });
db.updateUserSubscription(user.id, 30, 'monthly');
const now = new Date().toISOString();
const lead = { id: 'ui-lead', name: 'Clínica de teste', phone: '11999999999', whatsappPhone: '5511999999999' };
db.saveSearchJob({ id: 'ui-job', userId: user.id, query: 'Clínicas em São Paulo', source: 'google_maps', maxResults: 50,
 status: 'interrupted', phase: 'interrupted', error: 'Falha técnica. Progresso preservado.', results: [lead], searchId: 'ui-search',
 createdAt: now, updatedAt: now, hasActiveSubscription: true });
let browser;
try {
 browser = await puppeteer.launch({ headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu'], executablePath: process.env.UI_BROWSER });
 console.log('UI: navegador iniciado');
 const page = await browser.newPage(); await page.setViewport({ width: 1360, height: 1100 });
 const errors = []; page.on('pageerror', (error) => errors.push(error.message));
 await page.setCookie({ name: 'sevenleads_session', value: generateToken(user), url: base });
 console.log('UI: abrindo site');
 await page.goto(base, { waitUntil: 'domcontentloaded' });
 console.log('UI: aguardando retomada');
 await page.waitForFunction(() => !document.getElementById('resumeSearchPanel').classList.contains('hidden'));
 console.log('UI: retomada visível');
 assert.match(await page.$eval('#resumeSearchText', (node) => node.textContent), /1 de 50/);
 const denied = await page.evaluate(async () => (await fetch('/api/admin/debug')).status); assert.equal(denied, 403);
 console.log('UI: acesso negado confirmado');
 await page.screenshot({ path: '../../ui-target-resume.png', fullPage: false, timeout: 10000 });
 console.log('UI: captura salva');
 const results = Array.from({ length: 50 }, (_, i) => ({ ...lead, id: 'lead-' + i, name: 'Clínica ' + i }));
 await page.setRequestInterception(true);
 page.on('request', (request) => {
   if (request.url().includes('/api/places/search/jobs/ui-job')) return request.respond({ status: 200, contentType: 'application/json', body: JSON.stringify({ job: { id: 'ui-job', source: 'google_maps', status: 'completed', phase: 'target_reached', completionReason: 'target_reached', maxResults: 50, savedCount: 50, found: 60, analyzed: 55, remaining: 0, results, hasActiveSubscription: true } }) });
   return request.continue();
 });
 console.log('UI: clicando retomar');
 await page.click('#btnResumeSearch');
 await page.waitForFunction(() => document.getElementById('resultsCount').textContent.trim() === '50');
 assert.equal(await page.$eval('#resumeSearchPanel', (node) => node.classList.contains('hidden')), true);
 assert.deepEqual(errors, []);
 await page.screenshot({ path: '../../ui-target-completed.png', fullPage: false, timeout: 10000 });
 console.log('UI OK: retomada após login, progresso 1/50, resultado 50, bloqueio de debug para cliente, nenhum erro JS.');
} finally {
 if (browser) await browser.close();
 await new Promise((resolve) => server.close(resolve)); closeDatabase();
 fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 });
}
