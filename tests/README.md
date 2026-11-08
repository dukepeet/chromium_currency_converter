# Test plan

## Run locally

Use Node.js 22 or newer. `npm run test:unit` needs no dependencies and runs
all `tests/*.test.cjs` suites. For Chromium integration tests, install the
locked development dependencies and browser once:

```sh
npm ci --include=dev
npx playwright install chromium
npm test
```

`npm run check` checks runtime JavaScript syntax. `npm run test:browser`
runs just the Chromium suite. On a fresh Linux CI host, install browser
system libraries too with `npx playwright install --with-deps chromium`.

## Automated coverage

| Suite | Scope and independent expectations |
| --- | --- |
| `converter.test.cjs` | Fixed expected magnitudes, decimals, Unicode spaces/line breaks, signed/leading fractions, punctuation/ranges, invalid inputs, multiple match offsets, conversion and formatting |
| `generated.test.cjs` | Deterministic cross-product of explicit values, number formats, currencies, suffix spellings, spaces, signs and marker placement; independent values/multipliers, numeric tolerance and match-range invariants |
| `background.test.cjs` | Actual service worker in fresh VM scopes, with fake Chrome storage/messages/fetch and fixed clock; cache persistence/reuse/restart, simultaneous-tab deduplication, fallback, HTTP/network/JSON errors, retry and ignored messages |
| `browser/content.spec.cjs` | Actual content scripts in real headless Chromium; exact annotation content/placement, preserved source text, signed/decimal regressions, line boundaries, dynamic elements/text, no duplicate badges, skipped/editable elements, target filtering, missing rates and messaging errors, timer fallback, removed elements |

Generated expected amounts are NOT calculated with the production parser.
They cover over 38,000 equivalent-format combinations plus sign layouts,
price lists and line boundaries. Each group reports the number of matrix
cases it exercised. The suite is deterministic: no live crawling, live rates,
random seeds, private pages, credentials or external web pages are required.

Background tests execute the real worker with the Chrome API boundary mocked,
not a duplicate implementation of the caching logic. Deferred promises test
concurrent requests without timing sleeps. Each test starts a fresh worker.

Chromium tests use the scripts in manifest load order. Only extension messaging
is mocked, with fixed rates; the DOM, TreeWalker, MutationObserver and idle/timer
schedulers are real browser APIs. External browser requests are blocked. Expected
converted values are explicit, and comparisons normalize formatting only through
Intl. HTML reports and traces are retained for failed browser tests.

## CI plan

`.github/workflows/test.yml` runs on pull requests, pushes to `main`/`fix/**`,
and manual dispatch:

1. Run JavaScript syntax checks, parser regressions, generated consistency
   checks and background tests on Node.js 22 and 24.
2. Independently install the lockfile and Chromium, then run browser integration
   tests on Node.js 24. Upload report/trace artifacts if the job fails.

Jobs have read-only repository access, no secrets, bounded runtimes and
cancellation of superseded runs. The extension has no added runtime dependency;
Playwright is test-only. These checks do not claim line/branch coverage percentages.

## Remaining manual installed-extension smoke test

The browser suite executes the page scripts but does NOT install the extension,
exercise Chrome's real message bridge/service-worker lifecycle, verify host
permissions, or call the live exchange-rate API. For release verification:

1. Load the repository as an unpacked extension via `chrome://extensions`.
2. Open a page containing `$300k`, `€1.5m`, `USD 2bn`, `2 million EUR`,
   `-300k EUR`, `$300 monthly`, `300 Kč`, and an ordinary `$300` amount.
3. Confirm complete source amounts are retained. At the same live rate,
   `$300k` must convert to 1,000 times the value of `$300`; `$300 monthly`
   must not be multiplied. Check the hover tooltip expresses the source
   currency in target-currency units, not the inverse.
4. Reload and try another tab to check real message/cache wiring, then test
   offline startup with previously cached rates.

Existing limitations remain: a lone separator with an integer part and exactly
three trailing digits means grouping; amounts split across DOM text nodes are
not detected. Ambiguous dollar/yen symbols keep their existing default currency.
