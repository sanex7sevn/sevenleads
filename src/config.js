import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = process.env.SEVENLEADS_DIR || path.join(moduleDir, '..');
dotenv.config({ path: path.join(rootDir, '.env') });

function required(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Configuração obrigatória ausente: ${name}`);
  return value;
}

export const config = {
  jwtSecret: required('JWT_SECRET'),
  adminEmail: required('ADMIN_EMAIL'),
  adminPassword: required('ADMIN_PASSWORD'),
  pixKey: required('PIX_KEY'),
  appUrl: String(process.env.APP_URL || '').replace(/\/$/, ''),
  port: Number(process.env.PORT || 3000),
  secureCookies: process.env.NODE_ENV === 'production' || /^https:\/\//i.test(process.env.APP_URL || ''),
  nominatimUrl: String(process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org/search'),
  overpassUrls: String(process.env.OVERPASS_URLS || 'https://overpass-api.de/api/interpreter,https://overpass.kumi.systems/api/interpreter').split(',').map((value) => value.trim()).filter(Boolean),
  osmUserAgent: String(process.env.OSM_USER_AGENT || 'SevenLeads/1.0')
};
