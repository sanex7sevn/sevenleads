import test from 'node:test';
import assert from 'node:assert/strict';
import { collectToTarget, newTargetState } from '../src/search-target.js';
const business = (i, phone = true) => ({ name: 'Business ' + i, mapsUrl: `https://google.com/maps/place/x/data=!1splace${i}!`, whatsappPhone: phone ? '55119' + String(i).padStart(7, '0') : null });
function adapter(items, extras = {}) {
  return { discover: async () => ({ candidates: items, exhausted: true }), read: async (item) => item, checkpoint: async () => {}, ...extras };
}
test('navigation failures signal activity and restart without processing more pages or losing saved leads', async () => {
  const state = newTargetState(); const activity = []; const visited = [];
  await assert.rejects(collectToTarget(state, 50, adapter([business(1), business(2), business(3)], {
    read: async (item) => {
      visited.push(item.name);
      if (item.name === 'Business 2') { const error = new Error('Repeated timeout'); error.code = 'SCRAPER_NAVIGATION_FAILED'; throw error; }
      return item;
    }, onProgress: (progress) => activity.push(progress)
  })), { code: 'SEARCH_INTERRUPTED' });
  assert.deepEqual(visited, ['Business 1', 'Business 2']);
  assert.equal(state.results.length, 1); assert.equal(state.processed.length, 1);
  assert.equal(activity.at(-1).phase, 'retrying'); assert.equal(activity.at(-1).analyzed, 1);
});
for (const target of [50, 100, 150]) test(`saves exactly ${target} unique contacts, replacing missing phones and duplicates`, async () => {
  const items = Array.from({ length: target + 20 }, (_, i) => business(i, i >= 10));
  items.splice(15, 0, business(12));
  const state = newTargetState();
  const outcome = await collectToTarget(state, target, adapter(items));
  assert.equal(outcome.results.length, target); assert.equal(outcome.completionReason, 'target_reached');
  assert.equal(new Set(outcome.results.map((item) => item.mapsUrl)).size, target);
});
test('short result can complete only after confirmed exhaustion', async () => {
  const items = [business(1), business(2, false)];
  assert.equal((await collectToTarget(newTargetState(), 50, adapter(items))).completionReason, 'source_exhausted');
  await assert.rejects(collectToTarget(newTargetState(), 50, adapter(items, { discover: async () => ({ candidates: items, exhausted: false }) })), { code: 'SEARCH_INTERRUPTED' });
});
test('a stalled list is not exhaustion even when some leads were saved', async () => {
  const state = newTargetState();
  await assert.rejects(collectToTarget(state, 50, adapter([business(1)], { discover: async () => ({ candidates: [business(1)], exhausted: false }) })), { code: 'SEARCH_INTERRUPTED' });
  assert.equal(state.results.length, 1);
});
test('technical failure remains pending and resumed collection skips successful details', async () => {
  let snapshot;
  const state = newTargetState();
  await assert.rejects(collectToTarget(state, 50, adapter([business(1), business(2)], {
    read: async (item) => { if (item.name.endsWith('2')) { const e = new Error('timeout'); e.code = 'SCRAPER_DETAILS_FAILED'; throw e; } return item; },
    checkpoint: async (next) => { snapshot = JSON.parse(JSON.stringify(next)); }
  })), { code: 'SEARCH_INTERRUPTED' });
  assert.equal(snapshot.results.length, 1);
  const visited = [];
  const resumed = await collectToTarget(newTargetState(snapshot), 50, adapter([], {
    discover: async () => assert.fail('Already exhausted discovery must be reused'),
    read: async (item) => { visited.push(item.name); return item; }
  }));
  assert.deepEqual(visited, ['Business 2']); assert.equal(resumed.results.length, 2);
});
test('time passing alone never completes a short search', async () => {
  // No time budget input exists; all 150 reads are required, regardless of delays.
  let simulatedMinutes = 0;
  const result = await collectToTarget(newTargetState(), 150, adapter(Array.from({ length: 150 }, (_, i) => business(i)), {
    read: async (item) => { simulatedMinutes += 1; return item; }
  }));
  assert.equal(simulatedMinutes, 150); assert.equal(result.results.length, 150);
});
test('cancel after a read does not persist that read or return completion', async () => {
  const controller = new AbortController(); const state = newTargetState();
  await assert.rejects(collectToTarget(state, 50, adapter([business(1)], { signal: controller.signal,
    read: async (item) => { controller.abort(); return item; } })), { code: 'SEARCH_CANCELLED' });
  assert.equal(state.results.length, 0);
});
