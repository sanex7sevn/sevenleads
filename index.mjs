// ============================================================
// SevenLeads — Entry point portátil (compilado com @yao-pkg/pkg)
//
// Entry ESM (.mjs): dentro do pkg, import() dinâmico só funciona
// em contexto ESM. Deixa a pasta do .exe como raiz de tudo.
// ============================================================

import fs from 'fs';
import path from 'path';

const APP_DIR = path.dirname(process.execPath);
process.env.SEVENLEADS_DIR = APP_DIR;

// Chromium embutido na pasta ao lado do .exe
const chromePath = path.join(APP_DIR, 'chromium', 'chrome.exe');
if (fs.existsSync(chromePath)) {
  process.env.PUPPETEER_EXECUTABLE_PATH = chromePath;
} else {
  console.warn('⚠️ Chromium não encontrado ao lado do executável. A busca de leads exigirá um Chrome instalado nesta máquina.');
}

// Garante que .env, data/, auth_sessions/ sejam lidos/gravados na pasta do .exe
try { process.chdir(APP_DIR); } catch (_) {}

// Cria as pastas de dados na primeira execução
for (const dir of ['data', 'auth_sessions', 'logs']) {
  try {
    if (!fs.existsSync(path.join(APP_DIR, dir))) {
      fs.mkdirSync(path.join(APP_DIR, dir), { recursive: true });
    }
  } catch (_) {}
}

try {
  await import('./server.js');
} catch (err) {
  try {
    fs.writeFileSync(
      path.join(APP_DIR, 'logs', 'erro.txt'),
      `[${new Date().toISOString()}] ${err && err.stack ? err.stack : err}\n`,
      'utf8'
    );
  } catch (_) {}
  console.error('❌ Erro ao iniciar o SevenLeads:', err);
  console.error('Detalhes salvos em: logs\\erro.txt');
  process.exit(1);
}