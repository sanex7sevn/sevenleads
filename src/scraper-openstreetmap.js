import { config } from './config.js';
import { getSearchCache, pruneSearchCache, setSearchCache } from './database.js';
import { criteriaFromLegacyQuery, getSearchCategory, normalizeSearchCriteria } from './search-criteria.js';
import { normalizeInternationalPhone } from './phone-normalization.js';

const locationCache = new Map();
const searchCache = new Map();
const LOCATION_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
let overpassTail = Promise.resolve();
let nominatimTail = Promise.resolve();
let lastNominatimRequestAt = 0;

const LEGACY_FILTERS = [
  { pattern: /pizzaria|pizza/i, selectors: ['["cuisine"~"pizza",i]'] },
  { pattern: /restaurante|restaurant/i, selectors: ['["amenity"="restaurant"]'] },
  { pattern: /lanchonete|hamburgueria|fast[ -]?food|burger/i, selectors: ['["amenity"="fast_food"]'] },
  { pattern: /padaria|confeitaria|bakery|panader[ií]a|pasteler[ií]a/i, selectors: ['["shop"="bakery"]', '["shop"="pastry"]'] },
  { pattern: /mercado|supermercado|supermarket|grocery/i, selectors: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  { pattern: /farm[aá]cia|pharmacy/i, selectors: ['["amenity"="pharmacy"]'] },
  { pattern: /dentista|odontol|dentist/i, selectors: ['["amenity"="dentist"]'] },
  { pattern: /cl[ií]nica|m[eé]dico|clinic|doctor/i, selectors: ['["amenity"="clinic"]', '["amenity"="doctors"]'] },
  { pattern: /academia|fitness|gym/i, selectors: ['["leisure"="fitness_centre"]'] },
  { pattern: /sal[aã]o|barbearia|cabeleireiro|salon|barbershop|hairdresser|barber[ií]a|peluquer[ií]a/i, selectors: ['["shop"="hairdresser"]', '["shop"="beauty"]'] },
  { pattern: /pet|veterin/i, selectors: ['["shop"="pet"]', '["amenity"="veterinary"]'] },
  { pattern: /hotel|hostel|pousada|guest[ -]?house/i, selectors: ['["tourism"="hotel"]', '["tourism"="hostel"]', '["tourism"="guest_house"]'] },
  { pattern: /oficina|mec[aâ]nica|mechanic|car[ -]?repair|taller/i, selectors: ['["shop"="car_repair"]'] },
  { pattern: /autope[cç]as|auto[ -]?parts/i, selectors: ['["shop"="car_parts"]'] },
  { pattern: /escola|col[eé]gio|school|escuela/i, selectors: ['["amenity"="school"]'] },
  { pattern: /imobili[aá]ria|real[ -]?estate/i, selectors: ['["office"="estate_agent"]'] },
  { pattern: /contabil|contabilidade|accountant|accounting/i, selectors: ['["office"="accountant"]'] },
  { pattern: /advocacia|advogado|lawyer|attorney|abogado/i, selectors: ['["office"="lawyer"]'] }
];

const SEARCH_SCOPES = Object.freeze({
  directories: { source: 'directories', label: 'OpenStreetMap Brasil', countryCode: 'br', countryName: 'Brasil' },
  all_world: { source: 'all_world', label: 'All World', countryCode: null, countryName: null }
});

function requestSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function throwIfCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Busca cancelada pelo usuário.');
  error.code = 'SEARCH_CANCELLED';
  throw error;
}

function sourceError(message, status) {
  const error = new Error(message);
  error.status = status;
  error.code = status === 429 ? 'SOURCE_RATE_LIMIT' : 'SOURCE_HTTP_ERROR';
  return error;
}

function escapeOverpass(value) {
  return String(value || '').replace(/["\\\n\r]/g, ' ').trim();
}

function remember(map, key, value, maxEntries) {
  if (map.size >= maxEntries) map.delete(map.keys().next().value);
  map.set(key, value);
}

function normalizedCriteria(input, source) {
  if (typeof input === 'string') return criteriaFromLegacyQuery(input, source);
  if (input?.providerQuery && input?.locationLabel) return input;
  return normalizeSearchCriteria(input, source);
}

function enqueueNominatim(task) {
  const run = nominatimTail.then(async () => {
    const waitMs = Math.max(0, 1000 - (Date.now() - lastNominatimRequestAt));
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastNominatimRequestAt = Date.now();
    return task();
  }, task);
  nominatimTail = run.catch(() => {});
  return run;
}

async function geocode(criteria, searchScope, signal) {
  const cacheKey = `location:${searchScope.countryCode || 'world'}:${criteria.locationLabel.toLocaleLowerCase('pt-BR')}`;
  const memory = locationCache.get(cacheKey);
  if (memory && memory.expiresAt > Date.now()) return { place: memory.place, cacheHit: true };
  const persisted = getSearchCache(cacheKey);
  if (persisted?.boundingbox) {
    remember(locationCache, cacheKey, { place: persisted, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS }, 500);
    return { place: persisted, cacheHit: true };
  }

  const place = await enqueueNominatim(async () => {
    throwIfCancelled(signal);
    const url = new URL(config.nominatimUrl);
    const params = {
      format: 'jsonv2', addressdetails: '1', featureType: 'city', limit: '1',
      q: searchScope.countryName ? [criteria.city, criteria.region, searchScope.countryName].filter(Boolean).join(', ') : criteria.locationLabel
    };
    if (searchScope.countryCode) params.countrycodes = searchScope.countryCode;
    url.search = new URLSearchParams(params);
    const response = await fetch(url, {
      headers: { 'User-Agent': config.osmUserAgent, 'Accept-Language': 'pt-BR,en,es' },
      signal: requestSignal(signal, 15000)
    });
    if (!response.ok) throw sourceError(`Localização respondeu HTTP ${response.status}.`, response.status);
    const [result] = await response.json();
    return result;
  });
  if (!place?.boundingbox) {
    const error = new Error(`Não encontrei a cidade "${criteria.locationLabel}".`);
    error.code = 'LOCATION_NOT_FOUND';
    throw error;
  }
  remember(locationCache, cacheKey, { place, expiresAt: Date.now() + LOCATION_CACHE_TTL_MS }, 500);
  setSearchCache(cacheKey, searchScope.source, place, LOCATION_CACHE_TTL_MS);
  return { place, cacheHit: false };
}

function selectorsFor(criteria) {
  const predefined = getSearchCategory(criteria.categoryId);
  if (predefined) return predefined.osmSelectors;
  const legacy = LEGACY_FILTERS.find((entry) => entry.pattern.test(criteria.category));
  return legacy?.selectors || [`["name"~"${escapeOverpass(criteria.category)}",i]`];
}

function buildOverpassQuery(criteria, boundingbox, maxResults) {
  const [south, north, west, east] = boundingbox;
  const bbox = `(${south},${west},${north},${east})`;
  const selectors = selectorsFor(criteria);
  const overfetch = Math.min(Math.max(maxResults * 3, 150), 450);
  return `[out:json][timeout:25];(${selectors.map((selector) => `nwr${selector}${bbox};`).join('\n')});out center tags ${overfetch};`;
}

function enqueueOverpass(task) {
  const run = overpassTail.then(task, task);
  overpassTail = run.catch(() => {});
  return run;
}

async function requestOverpass(query, signal) {
  return enqueueOverpass(async () => {
    let lastError;
    for (const endpoint of config.overpassUrls) {
      throwIfCancelled(signal);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { 'User-Agent': config.osmUserAgent, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ data: query }),
          signal: requestSignal(signal, 35000)
        });
        if (response.ok) return response.json();
        lastError = sourceError(`OpenStreetMap respondeu HTTP ${response.status}.`, response.status);
        if (![429, 502, 503, 504].includes(response.status)) break;
      } catch (error) {
        if (signal?.aborted) throwIfCancelled(signal);
        lastError = error;
      }
    }
    throw lastError || new Error('Não foi possível consultar o OpenStreetMap.');
  });
}

function addressFromTags(tags, fallback) {
  const street = [tags['addr:street'], tags['addr:housenumber']].filter(Boolean).join(', ');
  return [street, tags['addr:suburb'], tags['addr:city'], tags['addr:state'], tags['addr:postcode'], tags['addr:country']].filter(Boolean).join(' - ') || fallback;
}

function distanceKm(lat1, lon1, lat2, lon2) {
  if (![lat1, lon1, lat2, lon2].every((value) => Number.isFinite(Number(value)))) return Number.POSITIVE_INFINITY;
  const radians = (degrees) => Number(degrees) * Math.PI / 180;
  const earthRadiusKm = 6371;
  const dLat = radians(lat2) - radians(lat1);
  const dLon = radians(lon2) - radians(lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toLead(item, place, searchScope) {
  const tags = item.tags || {};
  const phone = tags['contact:mobile'] || tags.mobile || tags['contact:phone'] || tags.phone || '';
  const website = tags['contact:website'] || tags.website || tags.url || null;
  const lat = Number(item.lat || item.center?.lat);
  const lon = Number(item.lon || item.center?.lon);
  const countryCode = String(tags['addr:country'] || place.address?.country_code || searchScope.countryCode || '').slice(0, 2);
  const addressParts = [tags['addr:street'], tags['addr:housenumber'], tags['addr:suburb'], tags['addr:city'], tags['addr:state'], tags['addr:postcode'], tags['addr:country']].filter(Boolean).length;
  return {
    id: `osm_${item.type}_${item.id}`,
    name: tags.name || tags.brand || 'Estabelecimento',
    address: addressFromTags(tags, place.display_name),
    phone: phone || 'Não informado',
    whatsappPhone: normalizeInternationalPhone(phone, countryCode),
    website,
    rating: 0,
    totalRatings: 0,
    mapsUrl: Number.isFinite(lat) && Number.isFinite(lon) ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=18/${lat}/${lon}` : `https://www.openstreetmap.org/${item.type}/${item.id}`,
    distanceKm: Number.isFinite(lat) && Number.isFinite(lon) ? Number(distanceKm(place.lat, place.lon, lat, lon).toFixed(2)) : null,
    status: 'novo',
    source: searchScope.source,
    _addressCompleteness: addressParts,
    _hasName: Boolean(tags.name || tags.brand)
  };
}

function rankLeads(leads) {
  return leads.sort((left, right) => {
    const comparisons = [
      Number(right.phone !== 'Não informado') - Number(left.phone !== 'Não informado'),
      Number(Boolean(right.website)) - Number(Boolean(left.website)),
      right._addressCompleteness - left._addressCompleteness,
      (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY),
      Number(right._hasName) - Number(left._hasName)
    ];
    return comparisons.find((value) => value !== 0) || left.name.localeCompare(right.name);
  });
}

function publicLead(lead) {
  const { _addressCompleteness, _hasName, ...safe } = lead;
  return safe;
}

function readResultCache(cacheKey) {
  const memory = searchCache.get(cacheKey);
  if (memory && memory.expiresAt > Date.now()) return memory.payload;
  const persisted = getSearchCache(cacheKey);
  if (persisted?.results) {
    remember(searchCache, cacheKey, { payload: persisted, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS }, 200);
    return persisted;
  }
  return null;
}

function writeResultCache(cacheKey, source, payload) {
  remember(searchCache, cacheKey, { payload, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS }, 200);
  setSearchCache(cacheKey, source, payload, SEARCH_CACHE_TTL_MS);
  pruneSearchCache();
}

export async function resolveOpenStreetMapLocation(input, source = 'all_world', signal) {
  const searchScope = SEARCH_SCOPES[source];
  if (!searchScope) throw new Error('Fonte de localização inválida.');
  const criteria = normalizedCriteria(input, source);
  const { place, cacheHit } = await geocode(criteria, searchScope, signal);
  return {
    criteria,
    interpretedLocation: place.display_name,
    countryCode: place.address?.country_code || searchScope.countryCode || null,
    latitude: Number(place.lat),
    longitude: Number(place.lon),
    cacheHit
  };
}

async function searchOpenStreetMap(input, options, searchScope) {
  const { onProgress, signal } = options;
  const maxResults = [50, 100, 150].includes(Number(options.maxResults)) ? Number(options.maxResults) : 50;
  const criteria = normalizedCriteria(input, searchScope.source);
  try {
    throwIfCancelled(signal);
    onProgress?.({ phase: 'starting', source: searchScope.source, found: 0, analyzed: 0, remaining: 0 });
    const { place, cacheHit: locationCacheHit } = await geocode(criteria, searchScope, signal);
    const interpretedLocation = place.display_name;
    throwIfCancelled(signal);
    onProgress?.({ phase: 'location_confirmed', source: searchScope.source, interpretedLocation, found: 0, analyzed: 0, remaining: 0 });

    const cacheKey = `results:${searchScope.source}:${criteria.categoryId}:${criteria.category.toLocaleLowerCase()}:${place.osm_type}:${place.osm_id}:${maxResults}`;
    const cached = readResultCache(cacheKey);
    if (cached) {
      onProgress?.({ phase: 'analyzing', source: searchScope.source, interpretedLocation, found: cached.results.length, analyzed: cached.results.length, remaining: 0 });
      return { results: cached.results, metadata: { interpretedLocation, countryCode: place.address?.country_code || searchScope.countryCode, cacheHit: true } };
    }

    onProgress?.({ phase: 'collecting', source: searchScope.source, interpretedLocation, found: 0, analyzed: 0, remaining: 0 });
    const data = await requestOverpass(buildOverpassQuery(criteria, place.boundingbox, maxResults), signal);
    const unique = new Map();
    for (const item of data.elements || []) {
      const lead = toLead(item, place, searchScope);
      if (!unique.has(lead.id)) unique.set(lead.id, lead);
    }
    const results = rankLeads([...unique.values()]).slice(0, maxResults).map(publicLead);
    const payload = { results };
    writeResultCache(cacheKey, searchScope.source, payload);
    onProgress?.({ phase: 'analyzing', source: searchScope.source, interpretedLocation, found: results.length, analyzed: results.length, remaining: 0 });
    return { results, metadata: { interpretedLocation, countryCode: place.address?.country_code || searchScope.countryCode, cacheHit: locationCacheHit } };
  } catch (error) {
    if (signal?.aborted) throwIfCancelled(signal);
    throw error;
  }
}

export function scrapeOpenStreetMap(input, options = {}) {
  return searchOpenStreetMap(input, options, SEARCH_SCOPES.directories);
}

export function scrapeOpenStreetMapWorld(input, options = {}) {
  return searchOpenStreetMap(input, options, SEARCH_SCOPES.all_world);
}
