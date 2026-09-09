import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerOnly, registerAdminDebug } from '../src/admin-debug.js';
import { getDebugEvents, recordDebugEvent, withDebugContext } from '../src/debug-state.js';

test('only configured owner with an admin role is allowed', () => {
  for (const user of [undefined, { email: 'owner@test', role: 'user' }, { email: 'other@test', role: 'admin' }]) {
    let denied;
    const res = { status(code) { denied = code; return this; }, json() {} };
    ownerOnly('owner@test')({ user }, res, () => assert.fail('Unauthorized access'));
    assert.equal(denied, 403);
  }
  let allowed = false;
  ownerOnly('owner@test')({ user: { email: 'OWNER@test', role: 'admin' } }, {}, () => { allowed = true; });
  assert.equal(allowed, true);
});

test('page, assets and API all use authentication, role and owner checks', () => {
  const routes = [];
  const authenticateToken = () => {};
  const requireAdmin = () => {};
  registerAdminDebug({ get: (...args) => routes.push(args) }, { authenticateToken, requireAdmin, adminEmail: 'owner@test', root: '/', listDebugSearches: () => [] });
  assert.equal(routes.length, 4);
  for (const [url, cache, auth, role, owner] of routes) {
    assert.equal(auth, authenticateToken, url); assert.equal(role, requireAdmin, url);
    cache({}, { set(key, value) { assert.equal(key, 'Cache-Control'); assert.match(value, /no-store/); } }, () => {});
    owner({ user: { role: 'admin', email: 'other@test' } }, { status(code) { assert.equal(code, 403); return this; }, json() {} }, () => assert.fail(url));
  }
});

test('concurrent debug contexts keep each client separate and redact secrets', async () => {
  await Promise.all(['a@test', 'b@test'].map((email) => withDebugContext({ email, query: 'Clínica', source: 'google_maps' }, async () => {
    await Promise.resolve(); recordDebugEvent('Timeout token=private https://example.com/?secret=hidden');
  })));
  const events = getDebugEvents('a@test');
  assert.equal(events.length, 1); assert.equal(events[0].email, 'a@test');
  assert.doesNotMatch(events[0].message, /private|hidden|example\.com/);
});

test('events are bounded and unscoped messages are not recorded', () => {
  const before = getDebugEvents().length; recordDebugEvent('no context'); assert.equal(getDebugEvents().length, before);
  withDebugContext({ email: 'limit@test' }, () => { for (let i = 0; i < 210; i++) recordDebugEvent(String(i)); });
  const events = getDebugEvents('limit@test'); assert.equal(events.length, 100); assert.equal(events[0].message, '209');
});
