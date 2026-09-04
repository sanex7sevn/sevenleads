import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWebsite, leadIdentity, prepareSearchResults } from '../src/lead-normalization.js';

test('classifica plataformas como presença digital, não site próprio', () => {
  assert.deepEqual(classifyWebsite('https://app.anota.ai/minha-pizzaria'), {
    hasWebsite: true, hasRealWebsite: false, isSocialMedia: true
  });
  assert.equal(classifyWebsite('https://empresa.com.br').hasRealWebsite, true);
});

test('gera id estável por usuário e remove duplicados pelo place id', () => {
  const first = { name: 'Empresa', mapsUrl: 'https://google.com/maps/place/x/data=!4m1!1sabc123!8m2' };
  const second = { name: 'Empresa alterada', mapsUrl: 'https://google.com/maps/place/x/data=!4m1!1sabc123!8m2' };
  const once = prepareSearchResults('user-1', [first]);
  const repeated = prepareSearchResults('user-1', [first, second]);
  assert.equal(once[0].id, repeated[0].id);
  assert.equal(repeated.length, 1);
  assert.equal(leadIdentity(first), leadIdentity(second));
  assert.notEqual(prepareSearchResults('user-2', [first])[0].id, once[0].id);
});

test('mantém o mesmo identificador para um estabelecimento mundial do OpenStreetMap', () => {
  const first = { id: 'osm_node_353942568', name: 'Pizza Hut', phone: '+1 818-352-8868', source: 'all_world' };
  const updated = { id: 'osm_node_353942568', name: 'Pizza Hut Sunland', phone: '+1 818-352-0000', source: 'all_world' };
  assert.equal(leadIdentity(first), leadIdentity(updated));
  assert.equal(prepareSearchResults('user-1', [first, updated]).length, 1);
});
