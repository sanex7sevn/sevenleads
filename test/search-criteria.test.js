import test from 'node:test';
import assert from 'node:assert/strict';
import { criteriaFromLegacyQuery, normalizeSearchCriteria, SEARCH_CATEGORIES } from '../src/search-criteria.js';

test('normaliza os campos de uma pesquisa mundial', () => {
  const criteria = normalizeSearchCriteria({ categoryId: 'dentists', city: 'Los Angeles', region: 'California', country: 'USA' }, 'all_world');
  assert.equal(criteria.category, 'dentista');
  assert.equal(criteria.locationLabel, 'Los Angeles, California, USA');
  assert.equal(criteria.providerQuery, 'dentista em Los Angeles, California, USA');
});

test('força Brasil na fonte brasileira e aceita categoria personalizada', () => {
  const criteria = normalizeSearchCriteria({ categoryId: 'custom', customCategory: 'Loja de móveis', city: 'Limeira', region: 'SP', country: 'Portugal' }, 'directories');
  assert.equal(criteria.country, 'Brasil');
  assert.equal(criteria.category, 'Loja de móveis');
});

test('rejeita pesquisa mundial sem país', () => {
  assert.throws(() => normalizeSearchCriteria({ categoryId: 'hotels', city: 'Guatemala City' }, 'all_world'), /Informe o país/);
});

test('mantém compatibilidade com consulta textual antiga', () => {
  const criteria = criteriaFromLegacyQuery('pizza in Los Angeles, USA', 'all_world');
  assert.equal(criteria.city, 'Los Angeles');
  assert.equal(criteria.country, 'USA');
});

test('oferece um catálogo amplo de categorias', () => {
  assert.ok(SEARCH_CATEGORIES.length >= 15);
});
