export const SEARCH_CATEGORIES = Object.freeze([
  { id: 'restaurants', label: 'Restaurantes', query: 'restaurante', osmSelectors: ['["amenity"="restaurant"]'] },
  { id: 'hotels', label: 'Hotéis e pousadas', query: 'hotel', osmSelectors: ['["tourism"="hotel"]', '["tourism"="hostel"]', '["tourism"="guest_house"]'] },
  { id: 'dentists', label: 'Dentistas', query: 'dentista', osmSelectors: ['["amenity"="dentist"]'] },
  { id: 'clinics', label: 'Clínicas e médicos', query: 'clínica', osmSelectors: ['["amenity"="clinic"]', '["amenity"="doctors"]'] },
  { id: 'car_repair', label: 'Oficinas mecânicas', query: 'oficina mecânica', osmSelectors: ['["shop"="car_repair"]'] },
  { id: 'real_estate', label: 'Imobiliárias', query: 'imobiliária', osmSelectors: ['["office"="estate_agent"]'] },
  { id: 'lawyers', label: 'Advogados', query: 'advogado', osmSelectors: ['["office"="lawyer"]'] },
  { id: 'accountants', label: 'Contadores', query: 'contabilidade', osmSelectors: ['["office"="accountant"]'] },
  { id: 'schools', label: 'Escolas e colégios', query: 'escola', osmSelectors: ['["amenity"="school"]'] },
  { id: 'supermarkets', label: 'Mercados e supermercados', query: 'supermercado', osmSelectors: ['["shop"="supermarket"]', '["shop"="convenience"]'] },
  { id: 'stores', label: 'Lojas', query: 'loja', osmSelectors: ['["shop"]'] },
  { id: 'beauty', label: 'Beleza e barbearias', query: 'salão de beleza', osmSelectors: ['["shop"="hairdresser"]', '["shop"="beauty"]'] },
  { id: 'bakeries', label: 'Padarias e confeitarias', query: 'padaria', osmSelectors: ['["shop"="bakery"]', '["shop"="pastry"]'] },
  { id: 'pharmacies', label: 'Farmácias', query: 'farmácia', osmSelectors: ['["amenity"="pharmacy"]'] },
  { id: 'gyms', label: 'Academias', query: 'academia', osmSelectors: ['["leisure"="fitness_centre"]'] },
  { id: 'pet', label: 'Pet shops e veterinários', query: 'pet shop', osmSelectors: ['["shop"="pet"]', '["amenity"="veterinary"]'] },
  { id: 'fast_food', label: 'Lanchonetes e fast-food', query: 'lanchonete', osmSelectors: ['["amenity"="fast_food"]'] },
  { id: 'pizza', label: 'Pizzarias', query: 'pizzaria', osmSelectors: ['["cuisine"~"pizza",i]'] },
  { id: 'auto_parts', label: 'Autopeças', query: 'autopeças', osmSelectors: ['["shop"="car_parts"]'] }
]);

const CATEGORY_BY_ID = new Map(SEARCH_CATEGORIES.map((category) => [category.id, category]));
const FIELD_LIMITS = Object.freeze({ category: 80, city: 100, region: 100, country: 100 });

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function invalid(message) {
  const error = new Error(message);
  error.code = 'INVALID_SEARCH_CRITERIA';
  return error;
}

export function getSearchCategory(id) {
  return CATEGORY_BY_ID.get(String(id || '')) || null;
}

export function normalizeSearchCriteria(payload = {}, source = 'google_maps') {
  const categoryId = clean(payload.categoryId || payload.category, FIELD_LIMITS.category);
  const predefined = getSearchCategory(categoryId);
  const customCategory = clean(payload.customCategory, FIELD_LIMITS.category);
  if (!predefined && categoryId !== 'custom') throw invalid('Escolha uma categoria válida.');
  if (categoryId === 'custom' && customCategory.length < 2) throw invalid('Informe a categoria personalizada.');

  const city = clean(payload.city, FIELD_LIMITS.city);
  const region = clean(payload.region, FIELD_LIMITS.region);
  const requestedCountry = clean(payload.country, FIELD_LIMITS.country);
  if (city.length < 2) throw invalid('Informe a cidade da pesquisa.');

  const country = source === 'directories' ? 'Brasil' : requestedCountry;
  if (source === 'all_world' && country.length < 2) throw invalid('Informe o país da pesquisa mundial.');

  const category = predefined?.query || customCategory;
  const locationParts = [city, region, country].filter(Boolean);
  const locationLabel = locationParts.join(', ');
  return Object.freeze({
    categoryId,
    category,
    categoryLabel: predefined?.label || customCategory,
    city,
    region,
    country,
    locationLabel,
    providerQuery: `${category} em ${locationLabel}`,
    displayQuery: `${predefined?.label || customCategory} — ${locationLabel}`
  });
}

export function criteriaFromLegacyQuery(query, source = 'directories') {
  const text = clean(query, 300);
  const match = text.match(/\s+(?:em|in|en|at|no|na)\s+(.+)$/i);
  if (!match) throw invalid('Informe categoria, cidade e país nos campos da pesquisa.');
  const category = text.slice(0, match.index).trim();
  const location = match[1].split(',').map((part) => part.trim()).filter(Boolean);
  const country = source === 'all_world' ? (location.pop() || '') : 'Brasil';
  const city = location.shift() || '';
  const region = location.join(', ');
  return normalizeSearchCriteria({ categoryId: 'custom', customCategory: category, city, region, country }, source);
}
