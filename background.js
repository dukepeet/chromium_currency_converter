const ALARM_NAME = 'doc-refresh-rates';
const REFRESH_INTERVAL_MINUTES = 60;
// The MVP always converts into forint; this is the one line to change (or
// later replace with a stored, user-configurable value) for any-to-any.
const TARGET_CURRENCY = 'HUF';

async function fetchRates() {
  const url = `https://api.frankfurter.app/latest?from=${TARGET_CURRENCY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Rate fetch failed: HTTP ${res.status}`);
  const data = await res.json();
  await chrome.storage.local.set({
    targetCurrency: TARGET_CURRENCY,
    rates: data.rates,
    ratesDate: data.date,
    ratesUpdated: Date.now(),
  });
}

async function refreshRates() {
  try {
    await fetchRates();
  } catch (err) {
    console.error('[Dictionary of Currencies] failed to refresh rates', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  refreshRates();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
});

chrome.runtime.onStartup.addListener(() => {
  refreshRates();
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) refreshRates();
});
