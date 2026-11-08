const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const NOW = 1794153600000;
const RATE_KEYS = ['targetCurrency', 'rates', 'ratesDate', 'ratesUpdated'];
const API_DATA = { rates: { USD: 0.0025, EUR: 0.0024 }, date: '2026-11-06' };
const PAYLOAD = {
  targetCurrency: 'HUF', rates: API_DATA.rates,
  ratesDate: API_DATA.date, ratesUpdated: NOW,
};

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function response(data = API_DATA) {
  return { ok: true, status: 200, json: async () => structuredClone(data) };
}

// Each worker gets a fresh global scope/inFlight state. Storage and fetch are
// host-side fakes; all decisions, channel handling and payloads come from the
// real service worker, rather than a reimplementation of its cache logic.
function createWorker({ session = {}, local = {}, fetchImpl = async () => response() } = {}) {
  const calls = { fetch: [], errors: [], sessionGet: [], sessionSet: [], localGet: [], localSet: [] };
  const storage = { session: structuredClone(session), local: structuredClone(local) };
  let listener;
  function area(name) {
    return {
      async get(keys) {
        calls[`${name}Get`].push([...keys]);
        return Object.fromEntries(keys.filter((key) => key in storage[name])
          .map((key) => [key, structuredClone(storage[name][key])]));
      },
      async set(payload) {
        const plain = structuredClone(payload);
        calls[`${name}Set`].push(plain);
        Object.assign(storage[name], plain);
      },
    };
  }
  const context = vm.createContext({
    Date: { now: () => NOW },
    console: { error: (...args) => calls.errors.push(args.map(String)) },
    fetch: (...args) => {
      calls.fetch.push(args);
      return fetchImpl(...args);
    },
    chrome: {
      storage: { session: area('session'), local: area('local') },
      runtime: { onMessage: { addListener(fn) { assert.equal(listener, undefined); listener = fn; } } },
    },
  });
  vm.runInContext(source, context, { filename: 'background.js' });
  function request(message = { type: 'get-rates' }) {
    const answer = deferred();
    let replies = 0;
    const channel = listener(message, {}, (payload) => {
      replies++;
      answer.resolve(structuredClone(payload));
    });
    return { channel, result: answer.promise, get replies() { return replies; } };
  }
  return { calls, storage, request };
}

test('background: session cache is served without fetching or consulting local fallback', async () => {
  const worker = createWorker({ session: PAYLOAD, local: { rates: { USD: 999 } } });
  const request = worker.request();
  assert.equal(request.channel, true, 'Chrome message channel stays open for asynchronous response');
  assert.equal(request.replies, 0, 'response is not sent synchronously');
  assert.deepEqual(await request.result, { ok: true, ...PAYLOAD, stale: false });
  assert.equal(request.replies, 1);
  assert.deepEqual(worker.calls.sessionGet, [RATE_KEYS]);
  assert.equal(worker.calls.fetch.length, 0);
  assert.equal(worker.calls.localGet.length, 0);
  assert.equal(worker.calls.sessionSet.length, 0);
  assert.equal(worker.calls.localSet.length, 0);
});

test('background: first request fetches HUF-based rates and persists both cache tiers', async () => {
  const worker = createWorker();
  const request = worker.request();
  assert.equal(request.channel, true);
  assert.deepEqual(await request.result, { ok: true, ...PAYLOAD, stale: false });
  assert.deepEqual(worker.calls.fetch, [['https://api.frankfurter.app/latest?from=HUF']]);
  assert.deepEqual(worker.calls.sessionSet, [PAYLOAD]);
  assert.deepEqual(worker.calls.localSet, [PAYLOAD]);
  assert.deepEqual(worker.storage.session, PAYLOAD);
  assert.deepEqual(worker.storage.local, PAYLOAD);
  assert.equal(worker.calls.errors.length, 0);
  assert.equal(worker.calls.localGet.length, 0);
});

test('background: later requests reuse the successful session fetch', async () => {
  const worker = createWorker();
  const first = await worker.request().result;
  const second = await worker.request().result;
  assert.deepEqual(second, first);
  assert.equal(worker.calls.fetch.length, 1);
  assert.equal(worker.calls.sessionSet.length, 1);
  assert.equal(worker.calls.localSet.length, 1);
});

test('background: session rates survive a new service worker instance', async () => {
  const firstWorker = createWorker();
  await firstWorker.request().result;
  const restarted = createWorker({ session: firstWorker.storage.session, local: firstWorker.storage.local });
  assert.deepEqual(await restarted.request().result, { ok: true, ...PAYLOAD, stale: false });
  assert.equal(restarted.calls.fetch.length, 0);
});

test('background: simultaneous tabs share one pending network fetch and each receive one reply', async () => {
  const network = deferred();
  const started = deferred();
  const worker = createWorker({ fetchImpl: () => { started.resolve(); return network.promise; } });
  const requests = Array.from({ length: 5 }, () => worker.request());
  await started.promise;
  assert.equal(worker.calls.fetch.length, 1);
  assert.equal(worker.calls.sessionSet.length, 0);
  for (const request of requests) {
    assert.equal(request.channel, true);
    assert.equal(request.replies, 0);
  }
  network.resolve(response());
  const results = await Promise.all(requests.map((request) => request.result));
  for (let i = 0; i < requests.length; i++) {
    assert.deepEqual(results[i], { ok: true, ...PAYLOAD, stale: false });
    assert.equal(requests[i].replies, 1);
  }
  assert.equal(worker.calls.fetch.length, 1);
  assert.equal(worker.calls.sessionSet.length, 1);
  assert.equal(worker.calls.localSet.length, 1);
});

test('background: offline startup falls back to local rates and marks the response stale', async () => {
  const cached = { ...PAYLOAD, ratesDate: '2026-11-01', ratesUpdated: NOW - 86400000 };
  const worker = createWorker({ local: cached, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual(await worker.request().result, { ok: true, ...cached, stale: true });
  assert.equal(worker.calls.fetch.length, 1);
  assert.deepEqual(worker.calls.localGet, [RATE_KEYS]);
  assert.equal(worker.calls.sessionSet.length, 0, 'stale data must not become a fresh session cache');
  assert.equal(worker.calls.localSet.length, 0);
  assert.equal(worker.calls.errors.length, 1);
  assert.match(worker.calls.errors[0].join(' '), /offline/);
});

test('background: HTTP failures use an available local fallback without reading the error body', async () => {
  const worker = createWorker({
    local: PAYLOAD,
    fetchImpl: async () => ({ ok: false, status: 503, json() { assert.fail('HTTP error body must not be parsed as rates'); } }),
  });
  assert.deepEqual(await worker.request().result, { ok: true, ...PAYLOAD, stale: true });
  assert.match(worker.calls.errors[0].join(' '), /HTTP 503/);
});

for (const [name, fetchImpl, expectedError] of [
  ['HTTP error', async () => ({ ok: false, status: 429 }), /HTTP 429/],
  ['network rejection', async () => { throw new Error('network unavailable'); }, /network unavailable/],
  ['invalid JSON', async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }), /invalid JSON/],
]) {
  test(`background: ${name} without cached rates returns an error over the message channel`, async () => {
    const worker = createWorker({ fetchImpl });
    const request = worker.request();
    assert.equal(request.channel, true);
    const result = await request.result;
    assert.equal(result.ok, false);
    assert.match(result.error, expectedError);
    assert.equal(request.replies, 1);
    assert.equal(worker.calls.localGet.length, 1);
    assert.equal(worker.calls.sessionSet.length, 0);
    assert.equal(worker.calls.localSet.length, 0);
  });
}

test('background: a failed request clears inFlight so the next request can recover', async () => {
  let attempts = 0;
  const worker = createWorker({ fetchImpl: async () => {
    if (++attempts === 1) throw new Error('temporary outage');
    return response();
  } });
  assert.equal((await worker.request().result).ok, false);
  assert.deepEqual(await worker.request().result, { ok: true, ...PAYLOAD, stale: false });
  assert.equal(worker.calls.fetch.length, 2);
  assert.equal(worker.calls.sessionSet.length, 1);
  assert.equal(worker.calls.localSet.length, 1);
});

test('background: concurrent failures share one fetch but all tabs receive stale fallback', async () => {
  const network = deferred();
  const started = deferred();
  const worker = createWorker({ local: PAYLOAD, fetchImpl: () => { started.resolve(); return network.promise; } });
  const first = worker.request();
  const second = worker.request();
  await started.promise;
  network.reject(new Error('offline'));
  const results = await Promise.all([first.result, second.result]);
  for (const result of results) assert.deepEqual(result, { ok: true, ...PAYLOAD, stale: true });
  assert.equal(worker.calls.fetch.length, 1);
  assert.equal(first.replies, 1);
  assert.equal(second.replies, 1);
});

test('background: unrelated, missing and null messages leave the channel unclaimed', () => {
  const worker = createWorker();
  for (const message of [{ type: 'other' }, {}, null]) {
    const request = worker.request(message);
    assert.equal(request.channel, undefined);
    assert.equal(request.replies, 0);
  }
  assert.equal(worker.calls.fetch.length, 0);
  assert.equal(worker.calls.sessionGet.length, 0);
  assert.equal(worker.calls.localGet.length, 0);
});
