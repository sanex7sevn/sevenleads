import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sevenleads-api-'));
process.env.SEVENLEADS_DIR = tempDir;
process.env.PORT = '0';
process.env.JWT_SECRET = 'test-secret-that-is-only-used-in-tests';
process.env.ADMIN_EMAIL = 'admin@teste.local';
process.env.ADMIN_PASSWORD = 'admin-test-password';
process.env.PIX_KEY = 'pix@teste.local';
const { server, closeDatabase } = await import('../server.js');
await new Promise((resolve) => server.listening ? resolve() : server.once('listening', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

async function json(pathname, options = {}) {
  const response = await fetch(baseUrl + pathname, options);
  const body = await response.json();
  return { response, body };
}

function sessionCookie(result) {
  const value = result.response.headers.get('set-cookie');
  assert.match(value || '', /sevenleads_session=/);
  return value.split(';')[0];
}

test('health check responde', async () => {
  const { response, body } = await json('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('cadastro, login e recursos de CRM funcionam', async () => {
  const register = await json('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Maria Teste', email: 'maria@teste.local', password: 'senha123' })
  });
  assert.equal(register.response.status, 200);
  assert.equal(register.body.token, undefined);
  assert.match(register.response.headers.get('set-cookie') || '', /HttpOnly/i);
  assert.match(register.response.headers.get('set-cookie') || '', /SameSite=Strict/i);
  const cookie = sessionCookie(register);
  const headers = { cookie, 'content-type': 'application/json' };

  const list = await json('/api/lists', { method: 'POST', headers, body: JSON.stringify({ name: 'Minha lista' }) });
  assert.equal(list.response.status, 201);
  const dashboard = await json('/api/dashboard', { headers });
  assert.equal(dashboard.response.status, 200);
  assert.equal(dashboard.body.total, 0);
  const reminders = await json('/api/reminders', { headers });
  assert.deepEqual(reminders.body.reminders, []);
});

test('pagamento PIX permanece manual até aprovação do administrador', async () => {
  const clientLogin = await json('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maria@teste.local', password: 'senha123' })
  });
  const clientCookie = sessionCookie(clientLogin);
  const request = await json('/api/payments/request', {
    method: 'POST', headers: { cookie: clientCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ plan: 'weekly' })
  });
  assert.equal(request.response.status, 200);
  assert.equal(request.body.payment.status, 'pending');

  const adminLogin = await json('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@teste.local', password: 'admin-test-password' })
  });
  const adminCookie = sessionCookie(adminLogin);
  const approve = await json(`/api/admin/payments/${request.body.payment.id}/approve`, {
    method: 'POST', headers: { cookie: adminCookie }
  });
  assert.equal(approve.response.status, 200);
  assert.equal(approve.body.payment.status, 'approved');
});

test('logout encerra a sessão protegida', async () => {
  const login = await json('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maria@teste.local', password: 'senha123' })
  });
  const cookie = sessionCookie(login);
  const logout = await json('/api/auth/logout', { method: 'POST', headers: { cookie } });
  assert.equal(logout.response.status, 200);
  assert.match(logout.response.headers.get('set-cookie') || '', /Expires=Thu, 01 Jan 1970/i);
});

test('API bloqueia fontes indisponíveis e a rota antiga de busca', async () => {
  const login = await json('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maria@teste.local', password: 'senha123' })
  });
  const headers = { cookie: sessionCookie(login), 'content-type': 'application/json' };
  const unavailable = await json('/api/places/search/start', {
    method: 'POST', headers,
    body: JSON.stringify({ query: 'pizzaria em Campinas, SP', source: 'fonte_removida', maxResults: 50 })
  });
  assert.equal(unavailable.response.status, 400);
  assert.match(unavailable.body.error, /ainda não está disponível/i);

  const legacy = await json('/api/places/search', {
    method: 'POST', headers,
    body: JSON.stringify({ query: 'pizzaria em Campinas, SP', source: 'google_maps', maxResults: 50 })
  });
  assert.equal(legacy.response.status, 410);
  assert.equal(legacy.body.endpoint, '/api/places/search/start');
});

test('clientes ficam isolados e entradas excessivas são recusadas', async () => {
  const first = await json('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cliente Um', email: 'um@teste.local', password: 'senha123' })
  });
  const firstCookie = sessionCookie(first);
  const saved = await json('/api/places/save', {
    method: 'POST', headers: { cookie: firstCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ leads: [{ id: 'lead_isolado', name: 'Empresa privada' }] })
  });
  assert.equal(saved.response.status, 200);

  const second = await json('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Cliente Dois', email: 'dois@teste.local', password: 'senha123' })
  });
  const secondCookie = sessionCookie(second);
  const forbiddenLead = await json('/api/leads/lead_isolado/status', {
    method: 'PATCH', headers: { cookie: secondCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'cliente' })
  });
  assert.equal(forbiddenLead.response.status, 404);

  const longList = await json('/api/lists', {
    method: 'POST', headers: { cookie: secondCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'x'.repeat(81) })
  });
  assert.equal(longList.response.status, 400);

  const tooManyPhones = await json('/api/whatsapp/check', {
    method: 'POST', headers: { cookie: secondCookie, 'content-type': 'application/json' },
    body: JSON.stringify({ phones: Array.from({ length: 101 }, (_, index) => `1199999${String(index).padStart(4, '0')}`) })
  });
  assert.equal(tooManyPhones.response.status, 400);

  const deniedAdmin = await json('/api/admin/users', { headers: { cookie: secondCookie } });
  assert.equal(deniedAdmin.response.status, 403);
});

test('recuperação de senha não revela se o e-mail existe', async () => {
  const known = await json('/api/auth/forgot-password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'maria@teste.local' })
  });
  const unknown = await json('/api/auth/forgot-password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'inexistente@teste.local' })
  });
  assert.equal(known.response.status, 200);
  assert.equal(unknown.response.status, 200);
  assert.equal(known.body.message, unknown.body.message);

  const invalidReset = await json('/api/auth/reset-password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: 'invalido', password: 'nova-senha-segura' })
  });
  assert.equal(invalidReset.response.status, 400);
});

test('administrador não pode excluir a própria conta', async () => {
  const login = await json('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@teste.local', password: 'admin-test-password' })
  });
  const cookie = sessionCookie(login);
  const response = await json(`/api/admin/users/${login.body.user.id}`, { method: 'DELETE', headers: { cookie } });
  assert.equal(response.response.status, 400);
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  closeDatabase();
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
