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
  // Deliberately exclude all line separators (including U+2028/U+2029).
  const HSPACE = '[\\t\\p{Zs}]';
  const SIGN = '[+\\-−]';
  // Grouped thousands, ordinary decimals, and leading decimal fractions.
  // Grouped alternatives must not win by matching only a numeric prefix.
  const NUM_PATTERN = `(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?` +
    `|\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?` +
    `|\\d{1,3}(?:${HSPACE}\\d{3})+(?:[.,]\\d+)?` +
    `|\\d+(?:[.,]\\d+)?|[.,]\\d+)`;
  const OPTIONAL_SIGN = `(?:${SIGN}${HSPACE}*)?`;
  const NUMBER_RE = new RegExp(`^${OPTIONAL_SIGN}${NUM_PATTERN}$`, 'u');

  // Do not make the entire matcher case-insensitive:
  // currency symbols and ISO codes retain their existing case rules.
  const MULTIPLIERS = {
    k: 1e3, thousand: 1e3,
    m: 1e6, mn: 1e6, million: 1e6,
    b: 1e9, bn: 1e9, billion: 1e9,
    t: 1e12, tn: 1e12, trillion: 1e12,
  };
  const MAGNITUDE_PATTERN = Object.keys(MULTIPLIERS)
    .sort((a, b) => b.length - a.length)
    .map((word) => word.replace(/[a-z]/g, (ch) => `[${ch}${ch.toUpperCase()}]`))
    .join('|');
  // A suffix must end here, not be the start of a word (e.g. "monthly"
  // or "Kč"). Horizontal spaces include non-breaking spaces used in prices.
  const SUFFIX_PATTERN = `(?:${MAGNITUDE_PATTERN})(?![\\p{L}\\p{N}_])`;
  const AMOUNT_PATTERN = `${OPTIONAL_SIGN}${NUM_PATTERN}(?![\\p{N}]|[.,][.,\\d])` +
    `(?:${HSPACE}*${SUFFIX_PATTERN})?`;
  const SUFFIX_RE = new RegExp(`${HSPACE}*(${SUFFIX_PATTERN})$`, 'u');
  // Context checks live in findMatches: a comma or minus can be either
  // numeric syntax or punctuation between two complete currency amounts.
  const MATCH_RE = new RegExp(
    `(?<symbolSign>${OPTIONAL_SIGN})(?<prefixSymbol>${SYMBOL_PATTERN})${HSPACE}*(?<symbolAmount>${AMOUNT_PATTERN})` +
      `|(?<suffixSymbolAmount>${AMOUNT_PATTERN})${HSPACE}*(?<suffixSymbol>${SYMBOL_PATTERN})` +
      `|(?<codeSign>${OPTIONAL_SIGN})(?<prefixCode>${CODE_PATTERN})${HSPACE}+(?<codeAmount>${AMOUNT_PATTERN})` +
      `|(?<suffixCodeAmount>${AMOUNT_PATTERN})${HSPACE}+(?<suffixCode>${CODE_PATTERN})(?![\\p{L}\\p{N}_])`,
    'gu',
  );

  const SINGLE_CHAR_SYMBOLS = SYMBOL_KEYS.filter((s) => [...s].length === 1);
  const MULTI_CHAR_SYMBOLS = SYMBOL_KEYS.filter((s) => [...s].length > 1);
  // Cheap pre-check so we don't run the full regex on every text node on a page.
  const QUICK_TEST = new RegExp(
    `[${SINGLE_CHAR_SYMBOLS.map(escapeRegExp).join('')}]` +
      (MULTI_CHAR_SYMBOLS.length ? `|${MULTI_CHAR_SYMBOLS.map(escapeRegExp).join('|')}` : '') +
      `|\\b(?:${CODE_PATTERN})(?![\\p{L}\\p{N}_])`,
  );

  function parseAmount(raw) {
    let str = raw.trim();
    const suffix = SUFFIX_RE.exec(str);
    const multiplier = suffix ? MULTIPLIERS[suffix[1].toLowerCase()] : 1;
    if (suffix) str = str.slice(0, suffix.index);
    if (!NUMBER_RE.test(str)) return null;
    str = str.replace(/^([+−-])[\t\p{Zs}]*/u, '$1').replace('−', '-');

    const lastComma = str.lastIndexOf(',');
    const lastDot = str.lastIndexOf('.');
    let decimalSep = null;

    if (lastComma > -1 && lastDot > -1) {
      decimalSep = lastComma > lastDot ? ',' : '.';
    } else if (lastComma > -1) {
      const digitsAfter = str.length - lastComma - 1;
      decimalSep = /^[+−-]?,/u.test(str) || digitsAfter !== 3 ? ',' : null;
    } else if (lastDot > -1) {
      const digitsAfter = str.length - lastDot - 1;
      decimalSep = /^[+−-]?\./u.test(str) || digitsAfter !== 3 ? '.' : null;
    }

    let cleaned;
    if (decimalSep) {
      const thousandSep = decimalSep === ',' ? /[.\s]/g : /[,\s]/g;
      cleaned = str.replace(thousandSep, '').replace(decimalSep, '.');
    } else {
      cleaned = str.replace(/[.,\s]/g, '');
    }

    const value = Number(cleaned) * multiplier;
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
      const g = m.groups;
      const code = g.prefixCode || g.suffixCode ||
        resolveSymbolCode(g.prefixSymbol || g.suffixSymbol);
      let numStr = g.symbolAmount || g.suffixSymbolAmount || g.codeAmount || g.suffixCodeAmount;
      const markerSign = g.symbolSign || g.codeSign || '';
      if (!code || !numStr) continue;
      // A sign may precede the marker or number, but never both.
      if (markerSign && /^[+−-]/u.test(numStr)) continue;

      let raw = m[0];
      let index = m.index;
      let before = text.slice(0, index);
      const previous = results[results.length - 1];
      if (previous && previous.index + previous.length === index &&
          /^[.,]/u.test(raw)) {
        // "300k EUR,500k EUR": this comma separates complete prices; it
        // is not the leading decimal separator of the second amount.
        raw = raw.slice(1);
        numStr = numStr.slice(1);
        index++;
        before = text.slice(0, index);
      }
      const sign = markerSign || (/^[+−-][\t\p{Zs}]*/u.exec(numStr) || [''])[0];
      const isRange = sign.trim() === '-' && previous &&
        /^[\t\p{Zs}]*$/u.test(text.slice(previous.index + previous.length, index));
      if (isRange) {
        // "$300k-$500k" contains two positive endpoints, not a negative price.
        raw = raw.slice(sign.length);
        index += sign.length;
        if (!markerSign) numStr = numStr.slice(sign.length);
      } else {
        // Do not salvage the tail of malformed numbers, words or double signs.
        if (/[+−-]$/u.test(before)) continue;
        if (!g.prefixSymbol && /[\p{L}\p{N}_]$/u.test(before)) continue;
        if (!g.prefixSymbol && !g.prefixCode && /\d[.,]+$/u.test(before)) continue;
      }
      const amount = parseAmount((isRange ? '' : markerSign) + numStr);
      if (amount === null) continue;
      results.push({ index, length: raw.length, code, amount, raw });
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
