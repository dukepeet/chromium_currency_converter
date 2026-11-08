const { test, expect } = require('@playwright/test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '../..');
const WRAP = '.doc-currencies-wrap';
const BADGE = '.doc-currencies-annotation';
const state = {
  ok: true,
  targetCurrency: 'HUF',
  rates: { USD: 0.0025, EUR: 0.002, GBP: 0.001 },
  ratesDate: '2026-01-02',
};

// Run the real manifest content scripts in Chromium, with only the extension
// message transport mocked. These are DOM integration tests, not installed-
// extension or live exchange-rate API tests.
async function start(page, html, options = {}) {
  await page.route('**/*', (route) => route.abort());
  await page.setContent(html);
  await page.evaluate(({ response, rejectMessage, fallback }) => {
    window.__rateRequests = [];
    Object.defineProperty(window, 'chrome', {
      configurable: true,
      value: { runtime: { sendMessage: async (message) => {
        window.__rateRequests.push(message);
        if (rejectMessage) throw new Error('Background worker unavailable');
        return response;
      } } },
    });
    if (fallback) delete window.requestIdleCallback;
  }, {
    response: Object.hasOwn(options, 'response') ? options.response : state,
    rejectMessage: options.rejectMessage || false,
    fallback: options.fallback || false,
  });
  for (const file of ['shared/currencies.js', 'content/converter.js', 'content/content.js']) {
    await page.addScriptTag({ path: path.join(ROOT, file) });
  }
}

async function settle(page) {
  // An idle callback followed by a task lets both annotation mutations and
  // their follow-up observer scans drain. No arbitrary multi-second sleep.
  await page.evaluate(async () => {
    for (let i = 0; i < 2; i++) {
      await new Promise((resolve) => {
        if (window.requestIdleCallback) {
          window.requestIdleCallback(() => setTimeout(resolve, 0), { timeout: 1000 });
        } else {
          setTimeout(resolve, 180);
        }
      });
    }
  });
}

async function annotation(value) {
  // Explicit expectations below use fixed rates. Only locale formatting is
  // shared with the browser; no production matching/parsing/conversion here.
  return `(≈ ${new Intl.NumberFormat('hu-HU', {
    style: 'currency', currency: 'HUF', currencyDisplay: 'symbol',
  }).format(value)})`;
}

test('full original suffixed price and punctuation surround the converted badge', async ({ page }) => {
  await start(page, '<p id="price">Budget ($300k), next €1.5m.</p>');
  const wraps = page.locator('#price').locator(WRAP);
  await expect(wraps).toHaveCount(2);
  expect(await wraps.evaluateAll((nodes) => nodes.map((node) => node.firstChild.nodeValue)))
    .toEqual(['$300k', '€1.5m']);
  await expect(wraps.nth(0).locator(BADGE)).toHaveText(await annotation(120000000));
  await expect(wraps.nth(1).locator(BADGE)).toHaveText(await annotation(750000000));
  await expect(page.locator('#price')).toHaveText(
    `Budget ($300k ${await annotation(120000000)}), next €1.5m ${await annotation(750000000)}.`,
  );
  await expect(wraps.nth(0).locator(BADGE)).toHaveAttribute(
    'title', '1 USD ≈ 400.0000 HUF · ECB reference rates via Frankfurter, 2026-01-02',
  );
  expect(await page.evaluate(() => window.__rateRequests)).toEqual([{ type: 'get-rates' }]);
});

test('annotates inserted elements and appended text nodes', async ({ page }) => {
  await start(page, '<main id="prices"></main>');
  await settle(page);
  await page.locator('#prices').evaluate((element) => {
    const item = document.createElement('p');
    item.id = 'new-item';
    item.textContent = 'Price $300k';
    element.appendChild(item);
  });
  await expect(page.locator('#new-item').locator(BADGE)).toHaveText(await annotation(120000000));
  await page.locator('#prices').evaluate((element) => {
    element.appendChild(document.createTextNode(' Plus 2bn GBP.'));
  });
  await expect(page.locator('#prices').locator(BADGE)).toHaveCount(2);
  await expect(page.locator('#prices').locator(BADGE).nth(1)).toHaveText(await annotation(2000000000000));
});

test('moving annotated content and observer rescans do not duplicate badges', async ({ page }) => {
  await start(page, '<main><p id="price">$300k</p></main><aside id="destination"></aside>');
  await expect(page.locator(BADGE)).toHaveCount(1);
  await page.evaluate(() => {
    document.querySelector('#destination').appendChild(document.querySelector('#price'));
    const label = document.createElement('span');
    label.textContent = ' ordinary label';
    document.querySelector('#price').appendChild(label);
  });
  await settle(page);
  await expect(page.locator(BADGE)).toHaveCount(1);
  await expect(page.locator(`${WRAP} ${WRAP}`)).toHaveCount(0);
  await expect(page.locator('#destination').locator(BADGE)).toHaveText(await annotation(120000000));
});

test('target-currency prices stay unchanged while foreign prices convert', async ({ page }) => {
  await start(page, '<p id="price">300k HUF; $300k; 200 Ft.</p>');
  await expect(page.locator(BADGE)).toHaveCount(1);
  expect(await page.locator(WRAP).evaluate((node) => node.firstChild.nodeValue)).toBe('$300k');
  await expect(page.locator('#price')).toHaveText(`300k HUF; $300k ${await annotation(120000000)}; 200 Ft.`);
});

test('missing individual rate preserves that price and surrounding convertible prices', async ({ page }) => {
  await start(page, '<p id="price">€2m; $300k; 3bn GBP; €4m.</p>', {
    response: { ...state, rates: { EUR: 0.002 } },
  });
  await expect(page.locator(BADGE)).toHaveCount(2);
  await expect(page.locator('#price')).toHaveText(
    `€2m ${await annotation(1000000000)}; $300k; 3bn GBP; €4m ${await annotation(2000000000)}.`,
  );
});

for (const [name, options] of [
  ['background reports an error', { response: { ok: false, error: 'Offline' } }],
  ['message transport rejects', { rejectMessage: true }],
  ['background returns no response', { response: null }],
  ['rates are missing', { response: { ...state, rates: null } }],
  ['target currency is missing', { response: { ...state, targetCurrency: null } }],
]) {
  test(`leaves initial and dynamically added prices unchanged when ${name}`, async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await start(page, '<p id="price">$300k</p>', options);
    await page.evaluate(() => {
      const item = document.createElement('p');
      item.textContent = '€2m';
      document.body.appendChild(item);
    });
    await settle(page);
    await expect(page.locator(BADGE)).toHaveCount(0);
    await expect(page.locator('#price')).toHaveText('$300k');
    expect(pageErrors).toEqual([]);
  });
}

test('skips code, form controls, editable content, scripts and styles', async ({ page }) => {
  await start(page, `
    <div id="skipped">
      <code><span>$300k</span></code><pre>$300k</pre>
      <textarea>$300k</textarea><input value="$300k">
      <select><option>$300k</option></select>
      <div contenteditable="true"><span>$300k</span></div>
      <div contenteditable><span>$300k</span></div>
      <div contenteditable="plaintext-only"><span>$300k</span></div>
      <script type="application/json">{"price":"$300k"}</script>
      <style>/* $300k */</style>
    </div><p id="normal">$300k</p>`);
  await expect(page.locator('#normal').locator(BADGE)).toHaveCount(1);
  await settle(page);
  await expect(page.locator('#skipped').locator(BADGE)).toHaveCount(0);
  await expect(page.locator('textarea')).toHaveValue('$300k');
  await expect(page.locator('input')).toHaveValue('$300k');
  await page.locator('[contenteditable="true"]').evaluate((element) => {
    const span = document.createElement('span');
    span.textContent = ' €2m';
    element.appendChild(span);
  });
  await settle(page);
  await expect(page.locator('#skipped').locator(BADGE)).toHaveCount(0);
});

test('uses timer fallback when requestIdleCallback is unavailable', async ({ page }) => {
  await start(page, '<p id="price">$300k</p>', { fallback: true });
  await expect(page.locator('#price').locator(BADGE)).toHaveText(await annotation(120000000));
  await settle(page);
  await expect(page.locator(BADGE)).toHaveCount(1);
});

test('does not touch an element removed before its scheduled scan', async ({ page }) => {
  await start(page, '<p>$300k</p>');
  await expect(page.locator(BADGE)).toHaveCount(1);
  await page.evaluate(() => {
    const item = document.createElement('p');
    item.textContent = '€2m';
    document.body.appendChild(item);
    item.remove();
    window.__removedPrice = item;
  });
  await settle(page);
  expect(await page.evaluate(() => window.__removedPrice.textContent)).toBe('€2m');
  expect(await page.evaluate(() => window.__removedPrice.querySelectorAll('.doc-currencies-wrap').length)).toBe(0);
});

test('renders complete decimal-comma and signed amounts without losing their sign', async ({ page }) => {
  const prices = [
    ['$1,2345k', 493800],
    ['-300k EUR', -150000000],
    ['-.5m EUR', -250000000],
    ['$-300k', -120000000],
    ['-$300k', -120000000],
    ['−300k EUR', -150000000],
  ];
  await start(page, prices.map(([raw], i) => `<p id="regression-${i}">${raw}</p>`).join(''));
  for (let i = 0; i < prices.length; i++) {
    const [raw, expected] = prices[i];
    const price = page.locator(`#regression-${i}`);
    await expect(price.locator(BADGE)).toHaveText(await annotation(expected));
    expect(await price.locator(WRAP).evaluate((node) => node.firstChild.nodeValue)).toBe(raw);
    await expect(price).toHaveText(`${raw} ${await annotation(expected)}`);
  }
});

test('a suffix on another line is not joined to the preceding price', async ({ page }) => {
  const separators = ['\n', '\r\n', '\u2028', '\u2029'];
  await start(page, separators.map((separator, i) => `<p id="line-${i}">$300${separator}k</p>`).join(''));
  for (let i = 0; i < separators.length; i++) {
    const price = page.locator(`#line-${i}`);
    await expect(price.locator(BADGE)).toHaveText(await annotation(120000));
    expect(await price.locator(WRAP).evaluate((node) => node.firstChild.nodeValue)).toBe('$300');
    // HTML normalizes CRLF to LF; all other line separators remain untouched.
    const separator = separators[i] === '\r\n' ? '\n' : separators[i];
    expect(await price.textContent()).toBe(`$300 ${await annotation(120000)}${separator}k`);
  }
});

test('preserves spaced unary signs and punctuation between complete prices', async ({ page }) => {
  const layouts = [
    { source: '- 300k EUR', parts: [['- 300k EUR', -150000000]] },
    { source: '- $300k', parts: [['- $300k', -120000000]] },
    { source: '$- 300k', parts: [['$- 300k', -120000000]] },
    { source: '− EUR 300k', parts: [['− EUR 300k', -150000000]] },
    { source: '$300k-$500k', parts: [['$300k', 120000000], '-', ['$500k', 200000000]] },
    { source: '$300k - $500k', parts: [['$300k', 120000000], ' - ', ['$500k', 200000000]] },
    { source: '300k EUR,500k EUR', parts: [['300k EUR', 150000000], ',', ['500k EUR', 250000000]] },
  ];
  await start(page, layouts.map(({ source }, i) => `<p id="layout-${i}">${source}</p>`).join(''));
  for (let i = 0; i < layouts.length; i++) {
    const { parts } = layouts[i];
    const price = page.locator(`#layout-${i}`);
    const expectedPrices = parts.filter(Array.isArray);
    await expect(price.locator(WRAP)).toHaveCount(expectedPrices.length);
    expect(await price.locator(WRAP).evaluateAll((nodes) => nodes.map((node) => node.firstChild.nodeValue)))
      .toEqual(expectedPrices.map(([raw]) => raw));
    const renderedParts = await Promise.all(parts.map(async (part) => (
      Array.isArray(part) ? `${part[0]} ${await annotation(part[1])}` : part
    )));
    expect(await price.textContent()).toBe(renderedParts.join(''));
  }
});
