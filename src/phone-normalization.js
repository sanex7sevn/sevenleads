import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

export function normalizeInternationalPhone(value, countryCode = null) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const candidates = raw.split(/[;/]|\s+or\s+|\s+ou\s+/i).map((item) => item.trim()).filter(Boolean);
  const defaultCountry = String(countryCode || '').trim().toUpperCase() || undefined;
  for (const candidate of candidates) {
    try {
      const phone = parsePhoneNumberFromString(candidate, defaultCountry);
      if (phone?.isPossible()) return phone.number.replace(/\D/g, '');
    } catch {}
  }
  return null;
}
