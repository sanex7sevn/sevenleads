import puppeteer from 'puppeteer';
import { readPlaceDetails, requireGoogleContacts } from './maps-details.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyWebsite } from './lead-normalization.js';

// Use the native Puppeteer lifecycle; no asynchronous plugin page hooks.

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const END_OF_LIST_PATTERNS = [
  'você chegou ao final da lista',
  "you've reached the end of the list",
  'you have reached the end of the list',
  'chegou ao final da lista'
];

function resolveChromePath() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  const appDir = process.env.SEVENLEADS_DIR || path.join(__dirname, '..');
  const bundled = path.join(appDir, 'chromium', 'chrome.exe');
  if (fs.existsSync(bundled)) {
    return bundled;
  }

  return undefined;
}

class ScraperQueue {
  constructor(maxConcurrent = 1) {
    this.maxConcurrent = maxConcurrent;
    this.currentRunning = 0;
    this.queue = [];
  }

  async run(task) {
    if (this.currentRunning >= this.maxConcurrent) {
      console.log(`Fila cheia (${this.currentRunning}/${this.maxConcurrent}). Tarefa aguardando...`);
      await new Promise((resolve) => this.queue.push(resolve));
    }

    this.currentRunning++;
    try {
      return await task();
    } finally {
      this.currentRunning--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next();
      }
    }
  }
}

const scraperQueue = new ScraperQueue(1);

function leadKey(name, address) {
  return `${(name || '').trim().toLowerCase()}|${(address || '').trim().toLowerCase()}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// browser.close() do Puppeteer pode nunca resolver se o processo do Chrome
// ficar travado (comum após analisar vários locais em paralelo). Sem um
// timeout aqui, a busca inteira fica pendurada para sempre e o job nunca
// sai do status "running" — bloqueando o usuário com o erro de "busca em
// andamento" até o servidor ser reiniciado manualmente. Damos um prazo e,
// se estourar, matamos o processo na força.
async function closeBrowserSafely(browser, timeoutMs = 10000) {
  if (!browser) return;
  let timedOut = false;
  const timeout = new Promise((resolve) => {
    setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([browser.close(), timeout]);
  } catch (e) {
    timedOut = true;
  }

  if (timedOut) {
    try {
      const proc = browser.process?.();
      if (proc && !proc.killed) {
        console.warn('[Scraper] browser.close() não respondeu a tempo. Encerrando processo à força.');
        proc.kill('SIGKILL');
      }
    } catch (e) {
      console.warn('[Scraper] Falha ao forçar encerramento do Chrome:', e.message);
    }
  }
}

function throwIfCancelled(signal) {
  if (signal?.aborted) {
    const error = new Error('Busca cancelada pelo usuário.');
    error.code = 'SEARCH_CANCELLED';
    throw error;
  }
}

function randomDelay(minMs, maxMs) {
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function normalizePhone(phone) {
  let rawPhone = String(phone || '').replace(/\D/g, '');
  if (rawPhone.startsWith('0') && rawPhone.length >= 11) {
    rawPhone = rawPhone.substring(1);
  }
  if (rawPhone.startsWith('55') && rawPhone.length >= 12) {
    return rawPhone;
  }
  if (rawPhone.length === 10 || rawPhone.length === 11) {
    return '55' + rawPhone;
  }
  return rawPhone.length >= 10 ? rawPhone : null;
}

function processPlace(p, index) {
  const website = p.website;
  const websiteFlags = classifyWebsite(website);

  return {
    id: p.id || 'lead_' + index + '_' + Date.now(),
    name: p.name,
    address: p.address || 'Endereço no Google Maps',
    phone: p.phone || 'Não informado',
    whatsappPhone: normalizePhone(p.phone),
    website: website || null,
    ...websiteFlags,
    rating: p.rating || 0,
    totalRatings: p.totalRatings || 0,
    mapsUrl: p.mapsUrl || '',
    status: 'novo',
    messageVariations: [],
    selectedMessage: null
  };
}

async function extractFeedCards(page) {
  return page.evaluate(() => {
    const feed = document.querySelector('div[role="feed"]');
    const cards = (feed || document).querySelectorAll('div.Nv2PK, div[role="article"]');
    const list = [];
    const seen = new Set();

    cards.forEach((card, idx) => {
      const nameEl = card.querySelector('.qBF1Pd, .fontHeadlineSmall');
      const name = nameEl ? nameEl.innerText.trim() : null;
      if (!name) return;

      const linkEl = card.querySelector('a.hfpxzc, a[href*="/maps/place/"]');
      const mapsUrl = linkEl ? linkEl.getAttribute('href') : null;

      const ratingEl = card.querySelector('.MW4etd');
      const rating = ratingEl ? parseFloat(ratingEl.innerText.replace(',', '.')) : 0;

      const reviewsEl = card.querySelector('.UY7F9');
      const totalRatings = reviewsEl ? parseInt(reviewsEl.innerText.replace(/\D/g, ''), 10) || 0 : 0;

      const textLines = (card.innerText || '').split('\n').filter((l) => l.trim().length > 0);
      let address = textLines.find((l) => /R\.|Rua|Av\.|Avenida|Praça|Alameda|Travessa|Rodovia|\d{5}-\d{3}/i.test(l)) || textLines[2] || '';
      address = address.replace(/^.*·\s*/, '').trim();

      const key = `${name.toLowerCase()}|${address.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);

      list.push({
        id: 'lead_' + idx + '_' + Date.now(),
        name,
        mapsUrl,
        rating,
        totalRatings,
        address: address || 'Endereço no Google Maps'
      });
    });

    return list;
  });
}

async function scrollFeedUntilEnd(page, onBatch, signal, maxResults = 0) {
  const maxIdleRounds = 3;
  const maxScrolls = 80;
  let idleRounds = 0;
  let lastHeight = 0;
  let lastCount = 0;
  const collected = new Map();

  for (let i = 0; i < maxScrolls; i++) {
    throwIfCancelled(signal);
    const batch = await extractFeedCards(page);
    for (const item of batch) {
      const key = leadKey(item.name, item.address);
      if (!collected.has(key)) {
        collected.set(key, item);
      }
    }

    if (typeof onBatch === 'function') {
      onBatch(Array.from(collected.values()));
    }

    if (maxResults > 0 && collected.size >= maxResults) {
      console.log(`[Scraper] Limite de ${maxResults} estabelecimentos atingido.`);
      break;
    }

    const state = await page.evaluate((endPatterns) => {
      const feed = document.querySelector('div[role="feed"]')
        || document.querySelector('div[aria-label*="Resultados" i]')
        || document.querySelector('div.m6QErb.DxyBCb');

      if (!feed) {
        return { exists: false, height: 0, endOfList: false };
      }

      feed.scrollTop = feed.scrollHeight;
      const bodyText = (feed.innerText || document.body.innerText || '').toLowerCase();
      const endOfList = endPatterns.some((p) => bodyText.includes(p));

      return {
        exists: true,
        height: feed.scrollHeight,
        endOfList
      };
    }, END_OF_LIST_PATTERNS);

    if (!state.exists) {
      console.log('[Scraper] Container de resultados não encontrado.');
      break;
    }

    if (state.endOfList) {
      console.log('[Scraper] Fim da lista detectado no painel.');
      break;
    }

    const grew = state.height > lastHeight + 20 || collected.size > lastCount;
    if (!grew) {
      idleRounds++;
      if (idleRounds >= maxIdleRounds) {
        console.log('[Scraper] Altura do painel parou de crescer. Encerrando scroll.');
        break;
      }
    } else {
      idleRounds = 0;
    }

    lastHeight = state.height;
    lastCount = collected.size;
    console.log(`[Scraper] Scroll ${i + 1}: ${collected.size} cards únicos (altura ${state.height}).`);
    await sleep(randomDelay(1500, 2000));
  }

  return Array.from(collected.values());
}

async function enrichPlaceDetails(browser, summaries, onProgress, signal) {
  const results = new Array(summaries.length);
  let nextIndex = 0;
  let analyzed = 0;
  let failed = false;
  async function worker() {
    while (!failed) {
      throwIfCancelled(signal);
      const index = nextIndex++;
      if (index >= summaries.length) return;
      try {
        if (!summaries[index].mapsUrl) throw new Error('Estabelecimento sem link de detalhes.');
        results[index] = await readPlaceDetails(browser, summaries[index], signal);
        analyzed++;
        onProgress?.({ phase: 'analyzing', found: summaries.length, analyzed, remaining: summaries.length - analyzed });
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  }
  // Wait for all workers before the caller closes or restarts the browser.
  const workers = await Promise.allSettled(Array.from({ length: Math.min(2, summaries.length) }, () => worker()));
  const failure = workers.find((result) => result.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

export async function scrapeGoogleMaps(query, maxResults = 0, options = {}) {
  const { onProgress, signal } = options;
  return scraperQueue.run(async () => {
    const MAX_ATTEMPTS = 3;
    let lastError = null;

    console.log(`\n[Scraper] Iniciando busca: "${query}"...`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      throwIfCancelled(signal);
      onProgress?.({ phase: 'starting', attempt, found: 0, analyzed: 0, remaining: 0 });
      if (attempt > 1) {
        const waitMs = randomDelay(8000, 15000);
        console.log(`[Scraper] Tentativa ${attempt}/${MAX_ATTEMPTS}. Aguardando ${Math.round(waitMs / 1000)}s antes de repetir...`);
        await sleep(waitMs);
      }

      let browser = null;
      try {
        throwIfCancelled(signal);
        const chromePath = resolveChromePath();
       browser = await puppeteer.launch({
  headless: true,
  executablePath: chromePath,
  timeout: 60000,
  protocolTimeout: 60000,
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--no-zygote',
    '--disable-background-networking',
    '--disable-extensions',
    '--disable-features=Translate,BackForwardCache',
    '--window-size=1280,900',
    '--lang=pt-BR,pt,en-US,en'
  ]
});

        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });

        const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}?hl=pt-BR`;
        await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
        throwIfCancelled(signal);
        onProgress?.({ phase: 'collecting', attempt, found: 0, analyzed: 0, remaining: 0 });

        // Detecta bloqueio/captcha — se acontecer, tenta novamente
        const blocked = await page.evaluate(() => {
          const text = (document.body.innerText || '').toLowerCase();
          return /não é um robô|nao e um robo|unusual traffic|enable javascript and cookies|recaptcha|automated requests/i.test(text);
        });

        if (blocked) {
          const err = new Error('O Google Maps detectou a automação (possível bloqueio).');
          err.code = 'SCRAPER_BLOCKED';
          await closeBrowserSafely(browser);
          lastError = err;
          console.warn(`[Scraper] ${err.message} Tentativa ${attempt}/${MAX_ATTEMPTS}.`);
          continue;
        }

        try {
          const consentButtons = await page.$$('button');
          for (const btn of consentButtons) {
            const text = await page.evaluate((el) => el.innerText || el.getAttribute('aria-label') || '', btn);
            if (/aceitar tudo|concordo|aceito|accept all|i agree|agree/i.test(text)) {
              await btn.click();
              await sleep(1200);
              break;
            }
          }
        } catch (e) {}

        let isSinglePlace = false;
        try {
          await page.waitForSelector('div[role="feed"], div.Nv2PK, h1.DUwDvf', { timeout: 20000 });
          isSinglePlace = !(await page.$('div[role="feed"], div.Nv2PK'));
        } catch (e) {
          console.log('Aviso: Feed padrão não encontrado, tentando extrair da tela atual.');
        }

        const results = [];

        if (isSinglePlace) {
          const single = await page.evaluate(() => {
            const name = document.querySelector('h1.DUwDvf, h1')?.innerText?.trim() || '';
            const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"], button[aria-label*="Telefone:"], a[href^="tel:"]');
            const phone = phoneEl ? (phoneEl.getAttribute('aria-label') || phoneEl.innerText).replace(/telefone:|\+55/gi, '').trim() : '';

            const siteEl = document.querySelector('a[data-item-id="authority"], a[aria-label*="site" i], a[aria-label*="website" i]');
            const website = siteEl ? siteEl.getAttribute('href') : null;

            const addrEl = document.querySelector('button[data-item-id="address"], button[aria-label*="Endereço:" i]');
            const address = addrEl ? (addrEl.getAttribute('aria-label') || addrEl.innerText).replace(/endereço:/gi, '').trim() : '';

            return { name, phone, website, address, mapsUrl: window.location.href };
          });

          if (single.name) results.push(await readPlaceDetails(browser, single, signal));
        } else {
          console.log('[Scraper] Rolando lista de estabelecimentos até o fim...');
          const placeSummaries = await scrollFeedUntilEnd(page, (items) => {
            onProgress?.({ phase: 'collecting', attempt, found: items.length, analyzed: 0, remaining: items.length });
          }, signal, maxResults);
          const limited = maxResults > 0 ? placeSummaries.slice(0, maxResults) : placeSummaries;

          if (limited.length === 0) {
            const err = new Error('Nenhum comércio encontrado. Confira o termo/cidade da busca ou tente novamente.');
            err.code = 'NO_RESULTS';
            await closeBrowserSafely(browser);
            throw err;
          }

          console.log(`[Scraper] ${limited.length} comércios únicos. Buscando telefones e sites...`);
          onProgress?.({ phase: 'analyzing', attempt, found: limited.length, analyzed: 0, remaining: limited.length });
          const detailed = await enrichPlaceDetails(browser, limited, onProgress, signal);
          results.push(...detailed);
        }

        await closeBrowserSafely(browser);

        const processedResults = requireGoogleContacts(results.map((p, index) => processPlace(p, index)));
        console.log(`[Scraper] Busca concluída: ${processedResults.length} resultados.`);
        return processedResults;
      } catch (error) {
        if (browser) await closeBrowserSafely(browser);
        if (error.code === 'SEARCH_CANCELLED') throw error;
        if (error.code === 'NO_RESULTS') throw error;
        lastError = error;
        console.warn(`[Scraper] Erro na tentativa ${attempt}/${MAX_ATTEMPTS}:`, error.message);

        // Se for um erro de navegação/tempo, dá chance de repetir
        if (attempt < MAX_ATTEMPTS) {
          continue;
        }
      }
    }

    // Esgota as tentativas: lança um erro claro e útil
    const friendly = new Error(
      'Não foi possível concluir a busca no Google Maps após várias tentativas. ' +
      'Pode haver falha no navegador, lentidão ou bloqueio temporário do Google. ' +
      'Aguarde alguns minutos e tente novamente, ou troque o termo de busca.'
    );
    friendly.cause = lastError;
    friendly.code = lastError?.code || 'SCRAPER_FAILED';
    console.error('[Scraper] Falha definitiva:', lastError?.message);
    throw friendly;
  });
}

export { normalizePhone };
