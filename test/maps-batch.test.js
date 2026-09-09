import test from 'node:test';
import assert from 'node:assert/strict';
import { collectDetails } from '../src/maps-batch.js';

test('isolated detail failure preserves earlier results and continues to next business', async () => {
  const visited = [];
  const outcome = await collectDetails([1, 2, 3], async (item) => {
    visited.push(item);
    if (item === 2) { const error = new Error('timeout'); error.code = 'SCRAPER_DETAILS_FAILED'; throw error; }
    return item;
  });
  assert.deepEqual(visited, [1, 2, 3]); assert.deepEqual(outcome.results, [1, 3]);
  assert.equal(outcome.failed, 1); assert.equal(outcome.pending, 0); assert.match(outcome.warning, /Resultado parcial/);
});
test('budget returns collected results without starting another navigation', async () => {
  let time = 0;
  const outcome = await collectDetails([1, 2, 3], async (item) => { time += 10; return item; }, { now: () => time, budgetMs: 10 });
  assert.deepEqual(outcome.results, [1]); assert.equal(outcome.pending, 2);
});
test('unresponsive browser stops further commands but retains results', async () => {
  const visited = [];
  const outcome = await collectDetails([1, 2, 3], async (item) => {
    visited.push(item);
    if (item === 2) { const error = new Error('protocol timeout'); error.code = 'SCRAPER_BROWSER_UNRESPONSIVE'; throw error; }
    return item;
  });
  assert.deepEqual(visited, [1, 2]); assert.deepEqual(outcome.results, [1]); assert.equal(outcome.pending, 1);
});
test('cancellation is never converted to successful partial completion', async () => {
  const controller = new AbortController();
  await assert.rejects(collectDetails([1, 2], async () => { controller.abort(); return 1; }, { signal: controller.signal }), { code: 'SEARCH_CANCELLED' });
});
test('complete collection has no warning', async () => {
  const outcome = await collectDetails([1, 2], async (item) => item);
  assert.equal(outcome.warning, null); assert.deepEqual(outcome.results, [1, 2]);
});
