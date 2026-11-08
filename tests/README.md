# Test plan

## Automated checks

Run `node --test tests/*.test.cjs`. The tests load the real extension scripts
in an isolated VM, with the same shared-metadata → converter load order as
the Chrome manifest. No network, exchange-rate API, or extra dependency is
needed; fixed rates make conversion failures reproducible.

| Area | Cases / expected behavior |
| --- | --- |
| Magnitudes | Every supported suffix, upper/lower case, expands to its short-scale multiplier |
| Currency placement | Symbol/code before or after a suffixed amount |
| Locale parsing | Decimal dot/comma, grouped prices, fractional and zero amounts |
| Whitespace | Attached/spaced suffixes, tabs, non-breaking and narrow non-breaking spaces; no suffix across a newline |
| Boundaries | Punctuation ends suffixes; words, Unicode letters, digits and identifiers do not become multipliers |
| Existing formats | Plain amounts and Kč remain unchanged; ISO codes retain case rules |
| Match ranges | Full original text and suffix retained; annotation insertion does not damage surrounding text |
| Conversion | Expanded value reaches rate conversion; zero and missing rates handled |
| Formatting | Converted amount uses the expected HUF currency formatting |
| Repeated scans | Multiple prices and repeated calls do not leak regex state |
| Invalid values | Non-numeric and overflowing parser inputs return null |

`.github/workflows/test.yml` runs the suite and JavaScript syntax checks on
Node.js 22 and 24. Jobs have read-only repository access, a five-minute timeout,
and cancellation of superseded runs. Fork PRs run without secrets.

## Manual Chrome smoke test (not automated)

1. Load the repository as an unpacked extension via `chrome://extensions`.
2. Open a page containing `$300k`, `€1.5m`, `USD 2bn`, `2 million EUR`,
   `$300 monthly`, `300 Kč`, and an ordinary `$300` amount.
3. After rates load, confirm the annotations follow the entire original
   amount. `$300k` must convert to 1,000 times the value of `$300` at the
   same rate; `$300 monthly` must not be multiplied.
4. Add a new text element containing `$300k` dynamically and verify it is
   annotated once, without duplicate annotations.
5. Check inputs, editable elements, and code blocks remain untouched.

Node tests verify parsing, conversion, formatting, and match ranges, not
Chrome's DOM traversal, live rate fetching, or extension permissions. The
manual checks above must be performed in Chrome before claiming browser QA.
Existing limitations remain: a lone separator with exactly three trailing
digits means grouping, and amounts split across DOM text nodes are not detected.
