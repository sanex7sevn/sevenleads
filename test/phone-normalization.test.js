import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeInternationalPhone } from '../src/phone-normalization.js';

test('adiciona o código do país em telefones internacionais locais', () => {
  assert.equal(normalizeInternationalPhone('(818) 352-8868', 'us'), '18183528868');
  assert.equal(normalizeInternationalPhone('2222 2222', 'GT'), '50222222222');
  assert.equal(normalizeInternationalPhone('(19) 97411-0466', 'BR'), '5519974110466');
});

test('preserva números E.164 e rejeita valores impossíveis', () => {
  assert.equal(normalizeInternationalPhone('+44 20 7946 0958', 'US'), '442079460958');
  assert.equal(normalizeInternationalPhone('123', 'US'), null);
});
