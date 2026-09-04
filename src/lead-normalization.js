import crypto from 'crypto';

const PLATFORM_HOSTS = [
  'instagram.com', 'facebook.com', 'fb.com', 'linktr.ee', 'wa.me',
  'ifood.com.br', 'anota.ai', 'aiqfome.com', 'deliverymuch.com.br',
  'goomer.app', 'menudino.com', 'querodelivery.com', 'ola.click'
];

function normalizedText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedUrl(value) {
  try {
    const url = new URL(String(value || ''));
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|g_|authuser|hl$)/i.test(key)) url.searchParams.delete(key);
    }
    return `${url.hostname.replace(/^www\./, '')}${url.pathname}`.replace(/\/$/, '').toLowerCase();
  } catch {
    return '';
  }
}

export function classifyWebsite(value) {
  if (!value) return { hasWebsite: false, hasRealWebsite: false, isSocialMedia: false };
  try {
    const hostname = new URL(String(value)).hostname.replace(/^www\./, '').toLowerCase();
    const isPlatform = PLATFORM_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return { hasWebsite: true, hasRealWebsite: !isPlatform, isSocialMedia: isPlatform };
  } catch {
    return { hasWebsite: false, hasRealWebsite: false, isSocialMedia: false };
  }
}

export function leadIdentity(lead) {
  const osmId = String(lead.id || '').match(/^osm_(node|way|relation)_(\d+)$/i);
  if (osmId) return `osm:${osmId[1].toLowerCase()}:${osmId[2]}`;

  const mapsUrl = String(lead.mapsUrl || '');
  const placeToken = mapsUrl.match(/!1s([^!/?]+)/)?.[1]
    || mapsUrl.match(/(?:place_id:|query_place_id=)([^&]+)/)?.[1];
  if (placeToken) return `place:${decodeURIComponent(placeToken)}`;

  const phone = String(lead.whatsappPhone || lead.phone || '').replace(/\D/g, '');
  if (phone.length >= 10) return `phone:${phone}`;

  const site = normalizedUrl(lead.website);
  if (site) return `site:${site}`;

  return `name:${normalizedText(lead.name)}|address:${normalizedText(lead.address)}`;
}

export function prepareSearchResults(userId, leads) {
  const unique = new Map();
  for (const original of Array.isArray(leads) ? leads : []) {
    const identity = leadIdentity(original);
    const websiteFlags = classifyWebsite(original.website);
    const lead = {
      ...original,
      ...websiteFlags,
      id: `lead_${crypto.createHash('sha256').update(`${userId}|${identity}`).digest('hex').slice(0, 24)}`
    };
    if (!unique.has(identity)) unique.set(identity, lead);
  }
  return [...unique.values()];
}
