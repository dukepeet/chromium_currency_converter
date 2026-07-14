// Pure logic for finding currency amounts in text and converting them.
// No DOM access here so it stays easy to reason about and test in isolation.
(function (global) {
  const UNAMBIGUOUS_SYMBOLS = global.DoC_UNAMBIGUOUS_SYMBOLS;
  const AMBIGUOUS_SYMBOLS = global.DoC_DEFAULT_AMBIGUOUS_SYMBOL;
  const CODES = global.DoC_CURRENCIES.map((c) => c.code);

  const ALL_SYMBOLS = Object.assign({}, UNAMBIGUOUS_SYMBOLS, AMBIGUOUS_SYMBOLS);
  // Longest symbols first so e.g. "Kč" wins over a lone "K".
  const SYMBOL_KEYS = Object.keys(ALL_SYMBOLS).sort((a, b) => b.length - a.length);

  function escapeRegExp(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const SYMBOL_PATTERN = SYMBOL_KEYS.map(escapeRegExp).join('|');
  const CODE_PATTERN = CODES.slice().sort((a, b) => b.length - a.length).join('|');
  // Matches 1,234.56 / 1.234,56 / 1 234,56 / 1234 / 1234.5 etc.
  const NUM_PATTERN = '\\d{1,3}(?:[\\s.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?';

  const MATCH_RE = new RegExp(
    `(${SYMBOL_PATTERN})\\s?(${NUM_PATTERN})` +
      `|(${NUM_PATTERN})\\s?(${SYMBOL_PATTERN})` +
      `|\\b(${CODE_PATTERN})\\s(${NUM_PATTERN})\\b` +
      `|\\b(${NUM_PATTERN})\\s(${CODE_PATTERN})\\b`,
    'g',
  );

  const SINGLE_CHAR_SYMBOLS = SYMBOL_KEYS.filter((s) => [...s].length === 1);
  const MULTI_CHAR_SYMBOLS = SYMBOL_KEYS.filter((s) => [...s].length > 1);
  // Cheap pre-check so we don't run the full regex on every text node on a page.
  const QUICK_TEST = new RegExp(
    `[${SINGLE_CHAR_SYMBOLS.map(escapeRegExp).join('')}]` +
      (MULTI_CHAR_SYMBOLS.length ? `|${MULTI_CHAR_SYMBOLS.map(escapeRegExp).join('|')}` : '') +
      `|\\b(?:${CODE_PATTERN})\\b`,
  );

  function parseAmount(raw) {
    const str = raw.trim();
    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    let decimalSep = null;

    if (lastComma > -1 && lastDot > -1) {
      decimalSep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma > -1) {
      const digitsAfter = str.length - lastComma - 1;
      decimalSep = digitsAfter !== 3 ? ',' : null;
    } else if (lastDot > -1) {
      const digitsAfter = str.length - lastDot - 1;
      decimalSep = digitsAfter !== 3 ? '.' : null;
    }

    let cleaned;
    if (decimalSep) {
      const thousandSep = decimalSep === ',' ? /[.\s]/g : /[,\s]/g;
      cleaned = str.replace(thousandSep, '').replace(decimalSep, '.');
    } else {
      cleaned = str.replace(/[.,\s]/g, '');
    }

    const value = parseFloat(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  function resolveSymbolCode(symbol) {
    return UNAMBIGUOUS_SYMBOLS[symbol] || AMBIGUOUS_SYMBOLS[symbol] || null;
  }

  function findMatches(text) {
    const results = [];
    MATCH_RE.lastIndex = 0;
    let m;
    while ((m = MATCH_RE.exec(text))) {
      let code = null;
      let numStr = null;
      if (m[1] !== undefined) {
        code = resolveSymbolCode(m[1]);
        numStr = m[2];
      } else if (m[3] !== undefined) {
        code = resolveSymbolCode(m[4]);
        numStr = m[3];
      } else if (m[5] !== undefined) {
        code = m[5];
        numStr = m[6];
      } else if (m[7] !== undefined) {
        code = m[8];
        numStr = m[7];
      }
      if (!code || !numStr) continue;
      const amount = parseAmount(numStr);
      if (amount === null) continue;
      results.push({ index: m.index, length: m[0].length, code, amount, raw: m[0] });
    }
    return results;
  }

  function convert(amount, fromCode, rates) {
    if (!rates) return null;
    const rate = rates[fromCode];
    if (!rate) return null;
    return amount / rate;
  }

  // Intl picks currency conventions from the *locale*, not the currency, so
  // an unrelated browser locale (e.g. en-US) would render HUF as "Ft5,196"
  // instead of "5 196 Ft". Pin a sane locale per currency for predictable output.
  const LOCALE_FOR_CURRENCY = {
    HUF: 'hu-HU', EUR: 'de-DE', USD: 'en-US', GBP: 'en-GB', JPY: 'ja-JP',
    CHF: 'de-CH', PLN: 'pl-PL', CZK: 'cs-CZ', RON: 'ro-RO', SEK: 'sv-SE',
    NOK: 'nb-NO', DKK: 'da-DK', TRY: 'tr-TR', INR: 'en-IN', CNY: 'zh-CN',
  };

  function formatAmount(value, currency) {
    try {
      return new Intl.NumberFormat(LOCALE_FOR_CURRENCY[currency], {
        style: 'currency',
        currency,
        currencyDisplay: 'symbol',
      }).format(value);
    } catch (err) {
      return `${value.toFixed(2)} ${currency}`;
    }
  }

  global.DoCConverter = { findMatches, convert, formatAmount, parseAmount, QUICK_TEST };
})(self);
