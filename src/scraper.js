import { collectToTarget, newTargetState, technicalError } from './search-target.js';
import { recordDebugEvent } from './debug-state.js';
import puppeteer from 'puppeteer';
import { readPlaceDetails } from './maps-details.js';
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
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, timeoutMs);
  });

  try {
    await Promise.race([browser.close(), timeout]);
  } catch (e) {
    timedOut = true;
  }

  clearTimeout(timer);
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
  let exhausted = false;
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
      console.log('[Scraper] Fim da lista confirmado no painel.');
      exhausted = true;
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

  return { candidates: Array.from(collected.values()), exhausted };
}


async function launchBrowser() {
  return puppeteer.launch({
    headless: true, executablePath: resolveChromePath(), timeout: 60000, protocolTimeout: 60000,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-background-networking', '--disable-extensions', '--window-size=1280,900', '--lang=pt-BR']
  });
}

export async function scrapeGoogleMaps(query, maxResults = 50, options = {}) {
  const { onProgress, signal, onCheckpoint } = options;
  const state = newTargetState(options.checkpoint);
  return scraperQueue.run(async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      throwIfCancelled(signal);
      let browser;
      let page;
      let reads = 0;
      const open = async () => {
        browser = await launchBrowser();
        page = (await browser.pages())[0] || await browser.newPage();
        await page.setViewport({ width: 1280, height: 900 });
      };
      try {
        onProgress?.({ phase: 'starting', found: state.candidates.length, analyzed: state.processed.length, remaining: maxResults - state.results.length });
        await open();
        const outcome = await collectToTarget(state, maxResults, {
          signal, onProgress,
          checkpoint: async (next) => { throwIfCancelled(signal); await onCheckpoint?.(next); },
          discover: async () => {
            await page.goto('https://www.google.com/maps/search/' + encodeURIComponent(query) + '?hl=pt-BR', { waitUntil: 'domcontentloaded', timeout: 60000 });
            throwIfCancelled(signal);
            for (const button of await page.$$('button')) {
              const label = await button.evaluate((element) => element.innerText || '');
              if (/^(aceitar tudo|accept all|concordo|i agree)$/i.test(label.trim())) { await button.click(); break; }
            }
            const blocked = await page.evaluate(() => /unusual traffic|não é um robô|automated requests|recaptcha/i.test(document.body.innerText || ''));
            if (blocked) throw technicalError('O Google solicitou uma verificação ou bloqueou a coleta.');
            try {
              await page.waitForSelector('div[role="feed"], div.Nv2PK, h1.DUwDvf', { timeout: 30000 });
            } catch (error) {
              const empty = await page.evaluate(() => /nenhum resultado encontrado|não foi possível encontrar|no results found|can't find/i.test(document.body.innerText || ''));
              if (empty) return { candidates: [], exhausted: true };
              throw error;
            }
            if (!(await page.$('div[role="feed"], div.Nv2PK'))) {
              const single = await page.evaluate(() => ({ name: document.querySelector('h1.DUwDvf')?.innerText?.trim(), mapsUrl: location.href }));
              if (!single.name) throw technicalError('Painel do estabelecimento não reconhecido.');
              return { candidates: [single], exhausted: true };
            }
            // Collect the available list, not just N cards: missing phones and
            // duplicates must be replaced by further candidates.
            return scrollFeedUntilEnd(page, (items) => onProgress?.({ phase: 'collecting', found: items.length, analyzed: state.processed.length, remaining: maxResults - state.results.length }), signal, 0);
          },
          read: async (item) => {
            if (reads && reads % 20 === 0) {
              await closeBrowserSafely(browser); browser = null;
              throwIfCancelled(signal); await open();
            }
            reads++;
            return processPlace(await readPlaceDetails(browser, item, signal, { page }), reads);
          }
        });
        recordDebugEvent('Coleta finalizada: ' + outcome.completionReason + '; ' + outcome.results.length + '/' + maxResults + ' leads.');
        return { results: outcome.results, metadata: { warning: outcome.warning || null, completionReason: outcome.completionReason } };
      } catch (error) {
        if (signal?.aborted || error.code === 'SEARCH_CANCELLED') throw error;
        recordDebugEvent('Tentativa ' + attempt + '/3 interrompida: ' + error.message + '; progresso preservado: ' + state.results.length + '/' + maxResults);
        if (attempt === 3) throw technicalError(error.message);
      } finally {
        await closeBrowserSafely(browser);
      }
    }
  });
}
export { normalizePhone };
