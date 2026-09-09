function checkCancelled(signal) {
  if (!signal?.aborted) return;
  const error = new Error('Busca cancelada pelo usuário.');
  error.code = 'SEARCH_CANCELLED';
  throw error;
}

export async function readPlaceDetails(browser, item, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    checkCancelled(signal);
    let page;
    try {
      page = await browser.newPage();
      await page.goto(new URL(item.mapsUrl, 'https://www.google.com').toString(), {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      checkCancelled(signal);
      // A heading alone does not mean that the contact panel has loaded.
      await page.waitForSelector('button[data-item-id="address"], button[data-item-id^="phone:tel:"], a[href^="tel:"]', { timeout: 15000 });
      try {
        await page.waitForSelector('button[data-item-id^="phone:tel:"], a[href^="tel:"]', { timeout: 5000 });
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
      console.warn(`[Scraper] Falha ao coletar detalhes (tentativa ${attempt}/2): ${error.message}`);
    } finally {
      if (page) await page.close().catch(() => {});
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
