import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn } from 'child_process';
import puppeteer from 'puppeteer';

const root = process.cwd();
const port = 3217;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sevenleads-visual-'));
const outputDir = path.join(root, 'test-results');
fs.mkdirSync(outputDir, { recursive: true });
const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(port), SEVENLEADS_DATA_DIR: tempDir, JWT_SECRET: 'visual-test-secret', ADMIN_EMAIL: 'admin@visual.local', ADMIN_PASSWORD: 'visual-test-password', PIX_KEY: 'pix@visual.local' },
  stdio: 'ignore'
});

async function waitForServer() {
  for (let attempt = 0; attempt < 50; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Servidor visual não iniciou.');
}

const executablePath = fs.existsSync(path.join(root, 'chromium', 'chrome.exe')) ? path.join(root, 'chromium', 'chrome.exe') : undefined;
let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({ headless: 'new', executablePath, args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: path.join(outputDir, 'landing-desktop.png'), fullPage: true });
  const heading = await page.$eval('.landing-copy h1', (element) => element.textContent.trim());
  if (!heading.includes('Encontre empresas')) throw new Error('Landing page não foi exibida.');
  await page.click('[data-open-auth="login"]');
  if (await page.$eval('#authScreen', (element) => element.classList.contains('hidden'))) throw new Error('Tela de login não abriu.');
  const registration = await page.evaluate(() => fetch('/api/auth/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Visual Teste', email: 'visual@teste.local', password: 'senha123' })
  }).then((response) => response.json()));
  if (!registration.success) throw new Error('Cadastro visual não criou a sessão.');
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => document.getElementById('landingScreen')?.classList.contains('hidden'));
  const searchSources = await page.$$eval('#searchSource option', (options) => options.map((option) => option.value));
  if (JSON.stringify(searchSources) !== JSON.stringify(['google_maps', 'directories', 'all_world'])) {
    throw new Error(`Fontes de pesquisa inesperadas: ${searchSources.join(', ')}`);
  }
  const urlSafety = await page.evaluate(() => ({
    rejected: window.SevenUI.safeUrl('javascript:alert(1)'),
    accepted: window.SevenUI.safeUrl('https://empresa.com.br/site'),
    escaped: window.SevenUI.escapeHtml('<img src=x onerror=alert(1)>'),
    legacyToken: localStorage.getItem('sevenleads_token')
  }));
  if (urlSafety.rejected !== null || urlSafety.accepted !== 'https://empresa.com.br/site') throw new Error('Validação de URLs inseguras falhou.');
  if (urlSafety.escaped.includes('<img') || urlSafety.legacyToken !== null) throw new Error('Proteção da interface ou da sessão falhou.');
  await page.screenshot({ path: path.join(outputDir, 'app-desktop.png'), fullPage: false });
  const whatsappButton = await page.evaluate(async () => {
    const lead = normalizeLead({
      id: 'visual-whatsapp', name: 'Lead de teste', address: 'Rua de teste, 10',
      phone: '(11) 99999-9999', whatsappPhone: '5511999999999', status: 'novo',
      contacted: false, rating: 5, totalRatings: 10
    });
    leadsData = [lead];
    isPaidUser = true;
    renderTable();
    const enabledBeforeClick = !document.getElementById('btn-lead-visual-whatsapp')?.disabled;
    const originalFetch = window.fetch;
    const originalOpen = window.open;
    let openedUrl = '';
    window.open = () => ({
      closed: false,
      opener: null,
      location: { replace: (url) => { openedUrl = url; } },
      close: () => {}
    });
    window.fetch = async (url) => {
      if (String(url).includes('/api/whatsapp/check')) return new Response(JSON.stringify({ connected: false, results: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(url).includes('/api/whatsapp/manual-link')) return new Response(JSON.stringify({ success: true, url: 'https://wa.me/5511999999999' }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (String(url).includes('/contact')) return new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      return originalFetch(url);
    };
    await window.openLeadWhatsApp(lead.id);
    window.fetch = originalFetch;
    window.open = originalOpen;
    leadsData = [];
    renderTable();
    return { enabledBeforeClick, openedUrl, contacted: lead.contacted };
  });
  if (!whatsappButton.enabledBeforeClick || !whatsappButton.openedUrl.startsWith('https://wa.me/') || !whatsappButton.contacted) {
    throw new Error('O botão do WhatsApp não concluiu o fluxo manual esperado.');
  }
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await page.reload({ waitUntil: 'networkidle0' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2);
  if (overflow) throw new Error('Layout móvel possui rolagem horizontal.');
  await page.screenshot({ path: path.join(outputDir, 'app-mobile.png'), fullPage: false });
  if (pageErrors.length) throw new Error(`Erros no navegador: ${pageErrors.join(' | ')}`);
  console.log('Teste visual desktop e celular concluído.');
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await new Promise((resolve) => server.once('exit', resolve));
  try { fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
}
