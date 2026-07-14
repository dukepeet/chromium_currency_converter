# Dictionary of Currencies

A Chrome extension inspired by the (now unsupported) *Dictionary of
Numbers*. Instead of annotating physical units, it scans the page you're
browsing for prices and appends the equivalent amount in your own currency
right next to them — so "€49.99" on a foreign webshop shows up as
"€49.99 *(≈ 19 481 Ft)*".

## Status

MVP: converts **anything → Hungarian forint (HUF)**. The target currency is
a single constant (`TARGET_CURRENCY` in `background.js`) so a later
any-to-any version (per-site or user-configurable target currency) is a
small, contained change rather than a rewrite — the rate storage, matching
and rendering logic are already currency-agnostic.

## How it works

- `background.js` — a service worker that fetches exchange rates once on
  install/startup and every hour after that, from the free
  [Frankfurter API](https://www.frankfurter.dev/) (ECB reference rates, no
  API key required), and caches them in `chrome.storage.local`.
- `content/converter.js` — pure matching/parsing logic: finds currency
  amounts in a string (by symbol, e.g. `€12.99`, or by ISO code, e.g.
  `12.99 EUR`), parses locale-formatted numbers (`1,234.56`, `1.234,56`,
  `1 234,56`), converts using the cached rates, and formats the result.
- `content/content.js` — walks the page's text nodes with a `TreeWalker`,
  wraps each detected price in a `<span>` followed by a small converted-value
  annotation, and uses a `MutationObserver` to keep annotating content that
  loads dynamically (infinite scroll, SPA navigation, etc). It skips
  scripts, inputs, editable content, and its own previously-inserted
  annotations to avoid reprocessing loops.
- `shared/currencies.js` — the list of currencies covered by Frankfurter and
  the symbol → ISO code lookup table (splitting unambiguous symbols like `€`
  from ambiguous ones like `$`, which defaults to USD).

## Try it locally

1. Open `chrome://extensions`, enable **Developer mode**.
2. Click **Load unpacked** and select this repository's folder.
3. Browse to any page with foreign-currency prices (e.g. a `.de` or `.com`
   webshop). Amounts get a small green "(≈ … Ft)" badge next to them once
   rates have loaded (a few seconds after install).

No build step — it's plain JS/CSS/JSON.

## Known limitations (MVP)

- `$` defaults to USD and `¥` to JPY; other dollar/yen-using currencies
  aren't disambiguated yet.
- Symbols shared by multiple currencies (e.g. `kr` for SEK/NOK/DKK/ISK)
  aren't auto-detected — only their unambiguous ISO codes are (`SEK 199`,
  `199 SEK`, etc.).
- No on/off toggle or per-site exceptions yet — this is intentionally just
  the core "find price → show conversion" engine for now.
