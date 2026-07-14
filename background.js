// The MVP always converts into forint; this is the one line to change (or
// later replace with a stored, user-configurable value) for any-to-any.
const TARGET_CURRENCY = 'HUF';

// Coalesces concurrent requests (e.g. several tabs loading at once) into a
// single network call instead of hammering the API.
let inFlight = null;

async function fetchRates() {
  const url = `https://api.frankfurter.app/latest?from=${TARGET_CURRENCY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Rate fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  const payload = {
    targetCurrency: TARGET_CURRENCY,
    rates: data.rates,
    ratesDate: data.date,
    ratesUpdated: Date.now(),
  };
  // Cached only as an offline/error fallback, not as the primary source.
  await chrome.storage.local.set(payload);
  return payload;
}

function getFreshRates() {
  if (!inFlight) {
    inFlight = fetchRates().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function getRatesForContentScript() {
  try {
    const payload = await getFreshRates();
    return { ...payload, stale: false };
  } catch (err) {
    console.error('[Dictionary of Currencies] live rate fetch failed, falling back to cache', err);
    const cached = await chrome.storage.local.get(['targetCurrency', 'rates', 'ratesDate', 'ratesUpdated']);
    if (cached.rates) return { ...cached, stale: true };
    throw err;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'get-rates') {
    getRatesForContentScript()
      .then((payload) => sendResponse({ ok: true, ...payload }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true; // keep the message channel open for the async response
  }
  return undefined;
});
