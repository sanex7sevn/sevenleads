import { recordDebugEvent } from './debug-state.js';
function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Busca cancelada pelo usuário.');
  error.code = 'SEARCH_CANCELLED';
  throw error;
}

export async function readPlaceDetails(browser, item, signal, { page: sharedPage } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    checkCancelled(signal);
    let page;
    try {
      page = sharedPage || await browser.newPage();
      await page.goto(new URL(item.mapsUrl, 'https://www.google.com').toString(), {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      checkCancelled(signal);
      // Detail tabs may open a consent screen even after the search loaded.
      for (const button of await page.$$('button')) {
        const label = await button.evaluate((element) => element.innerText || element.getAttribute('aria-label') || '');
        if (/^(aceitar tudo|accept all|concordo|i agree)$/i.test(label.trim())) {
          await button.click();
          break;
        }
      }
      // A business without public contacts can still have a valid details panel.
      // Wait separately for the phone instead of requiring an address to exist.
      await page.waitForSelector('h1.DUwDvf, button[data-item-id="address"], button[data-item-id^="phone:tel:"], a[href^="tel:"]', { timeout: 30000 });
      try {
        await page.waitForSelector('button[data-item-id^="phone:tel:"], a[href^="tel:"]', { timeout: 10000 });
      } catch (error) {
        // A loaded business can legitimately have no public phone number.
        if (error.name !== 'TimeoutError') throw error;
      }
      checkCancelled(signal);
      const details = await page.evaluate(() => {
        const phoneEl = document.querySelector('button[data-item-id^="phone:tel:"], button[aria-label*="Telefone:"], a[href^="tel:"]');
        const phone = phoneEl?.getAttribute('data-item-id')?.replace(/^phone:tel:/, '')
          || phoneEl?.getAttribute('href')?.replace(/^tel:/, '')
          || phoneEl?.getAttribute('aria-label')?.replace(/^telefone:\s*/i, '')
          || phoneEl?.innerText?.trim() || '';
        const website = document.querySelector('a[data-item-id="authority"], a[aria-label*="site" i], a[aria-label*="website" i]')?.getAttribute('href') || null;
        const addressEl = document.querySelector('button[data-item-id="address"], button[aria-label*="Endereço:" i]');
        const address = (addressEl?.getAttribute('aria-label') || addressEl?.innerText || '').replace(/^endereço:\s*/i, '').trim();
        return { phone, website, address };
      });
      return { ...item, ...details, address: details.address || item.address };
    } catch (error) {
      checkCancelled(signal);
      lastError = error;
      recordDebugEvent(`Detalhes: tentativa ${attempt}/2 — ${error.message}`);
      console.warn(`[Scraper] Falha ao coletar detalhes (tentativa ${attempt}/2): ${error.message}`);
      // Do not send more commands to an unresponsive browser. The search runner
      // closes it with a deadline and starts a new browser on the next attempt.
      if (/protocolTimeout|Runtime\..*timed out|Target\..*timed out|Session closed|Target closed|Connection closed/i.test(error.message)) {
        error.code = 'SCRAPER_BROWSER_UNRESPONSIVE';
        throw error;
      }
      if (page) {
        try {
          console.warn(`[Scraper] Página de detalhes: ${page.url()}`);
        } catch { /* The browser may already have disconnected. */ }
      }
    } finally {
      if (page && !sharedPage) await page.close().catch(() => {});
    }
  }
  const error = new Error('Falha ao carregar os detalhes dos estabelecimentos no Google Maps. Tente novamente em alguns minutos.');
  error.code = 'SCRAPER_DETAILS_FAILED';
  error.cause = lastError;
  throw error;
}

export function requireGoogleContacts(results) {
  if (results.some((lead) => lead.whatsappPhone)) return results;
  const error = new Error('A busca não retornou telefones utilizáveis. A coleta pode ter falhado ou os estabelecimentos podem não ter telefone público. Tente novamente em alguns minutos.');
  error.code = 'SCRAPER_NO_CONTACTS';
  throw error;
}
