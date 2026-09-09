import test from 'node:test';
import assert from 'node:assert/strict';
import { readPlaceDetails, requireGoogleContacts } from '../src/maps-details.js';

const item = { name: 'Clínica', mapsUrl: 'https://www.google.com/maps/place/test', address: 'São Paulo' };
test('reuses the search page across establishments without creating or closing tabs', async () => {
  let navigations = 0;
  const page = {
    async goto() { navigations++; }, async $$() { return []; },
    async waitForSelector() {}, async evaluate() { return { phone: '+551133334444' }; },
    async close() { assert.fail('Shared page must stay open'); }
  };
  const browser = { async newPage() { assert.fail('No additional tabs'); } };
  await readPlaceDetails(browser, item, undefined, { page });
  await readPlaceDetails(browser, item, undefined, { page });
  assert.equal(navigations, 2);
});

test('protocol timeout immediately returns control to the browser restart', async () => {
  let navigations = 0;
  const page = {
    async goto() { navigations++; throw new Error('Runtime.callFunctionOn timed out. Increase protocolTimeout'); },
    async title() { assert.fail('No additional protocol calls'); },
    async close() { assert.fail('Browser lifecycle belongs to caller'); }
  };
  await assert.rejects(readPlaceDetails({}, item, undefined, { page }), { code: 'SCRAPER_BROWSER_UNRESPONSIVE' });
  assert.equal(navigations, 1);
});

function fixture(failures = 0, phoneTimeout = false) {
  let opened = 0;
  let closed = 0;
  return {
    get opened() { return opened; },
    get closed() { return closed; },
    async newPage() {
      const attempt = ++opened;
      let waits = 0;
      return {
        async $$() { return []; },
        async goto() { if (attempt <= failures) throw new Error('Requesting main frame too early!'); },
        async waitForSelector() {
          if (++waits === 2 && phoneTimeout) {
            const error = new Error('No phone'); error.name = 'TimeoutError'; throw error;
          }
        },
        async evaluate() { return { phone: phoneTimeout ? '' : '+55 11 3333-4444', website: null, address: '' }; },
        async close() { closed++; }
      };
    }
  };
}

test('retries a failed page using a fresh page and preserves the address', async () => {
  const browser = fixture(1);
  const result = await readPlaceDetails(browser, item);
  assert.equal(result.phone, '+55 11 3333-4444');
  assert.equal(result.address, 'São Paulo');
  assert.equal(browser.opened, 2);
  assert.equal(browser.closed, 2);
});

test('persistent navigation failure is an error, never a lead without phone', async () => {
  const browser = fixture(2);
  await assert.rejects(readPlaceDetails(browser, item), { code: 'SCRAPER_DETAILS_FAILED' });
  assert.equal(browser.closed, 2);
});

test('a loaded business without public phone is distinct from a failed page', async () => {
  const browser = fixture(0, true);
  assert.equal((await readPlaceDetails(browser, item)).phone, '');
  assert.equal(browser.opened, 1);
});

test('cancelled search does not open pages or retry', async () => {
  const browser = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(readPlaceDetails(browser, item, controller.signal), { code: 'SEARCH_CANCELLED' });
  assert.equal(browser.opened, 0);
});

test('zero usable contacts is not reported as successful collection', () => {
  assert.throws(() => requireGoogleContacts([{ phone: 'Não informado', whatsappPhone: null }]), { code: 'SCRAPER_NO_CONTACTS' });
  assert.throws(() => requireGoogleContacts([]), { code: 'SCRAPER_NO_CONTACTS' });
  const leads = [{ whatsappPhone: '551133334444' }];
  assert.equal(requireGoogleContacts(leads), leads);
});

test('phone links are read from href when the element has no label', async () => {
  const previous = globalThis.document;
  globalThis.document = {
    querySelector(selector) {
      if (!selector.startsWith('button[data-item-id^="phone:tel:"]')) return null;
      return { getAttribute: (name) => name === 'href' ? 'tel:+551133334444' : null };
    }
  };
  try {
    const browser = { async newPage() { return {
      async $$() { return []; },
      async goto() {}, async waitForSelector() {}, async close() {},
      async evaluate(callback) { return callback(); }
    }; } };
    assert.equal((await readPlaceDetails(browser, item)).phone, '+551133334444');
  } finally { globalThis.document = previous; }
});

test('accepts consent before waiting for the business panel', async () => {
  let accepted = false;
  const browser = { async newPage() { return {
    async goto() {}, async close() {},
    async $$() { return [{ async evaluate() { return 'Aceitar tudo'; }, async click() { accepted = true; } }]; },
    async waitForSelector(selector) {
      assert.equal(accepted, true);
      if (selector.includes('address')) assert.match(selector, /h1\.DUwDvf/);
    },
    async evaluate() { return { phone: '+551133334444' }; }
  }; } };
  assert.equal((await readPlaceDetails(browser, item)).phone, '+551133334444');
});
