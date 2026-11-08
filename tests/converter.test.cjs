const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({ self: {} });
for (const file of ['shared/currencies.js', 'content/converter.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const { findMatches, parseAmount, convert, QUICK_TEST } = context.self.DoCConverter;

const cases = [
  ['$300k', 300000, 'USD'], ['$300K', 300000, 'USD'],
  ['€1.5m', 1500000, 'EUR'], ['£1,5 M', 1500000, 'GBP'],
  ['USD 2bn', 2000000000, 'USD'], ['2.5 billion EUR', 2500000000, 'EUR'],
  ['3tn USD', 3000000000000, 'USD'], ['$4T', 4000000000000, 'USD'],
  ['$2 Mn', 2000000, 'USD'], ['300k €', 300000, 'EUR'],
  ['300 k€', 300000, 'EUR'], ['$300\u00a0k', 300000, 'USD'],
  ['$2 ThOuSaNd', 2000, 'USD'], ['EUR 2 MILLION', 2000000, 'EUR'],
  ['$1 trillion', 1000000000000, 'USD'],
  ['$1,234.56', 1234.56, 'USD'], ['1.234,56 EUR', 1234.56, 'EUR'],
  ['1 234,56 €', 1234.56, 'EUR'], ['300 Kč', 300, 'CZK'],
  ['300Kč', 300, 'CZK'], ['$300', 300, 'USD'], ['USD 300', 300, 'USD'],
];
for (const [raw, amount, code] of cases) {
  test(`matches all of ${raw}`, () => {
    assert.ok(QUICK_TEST.test(raw));
    const matches = findMatches(`Price: ${raw}!`);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].amount, amount);
    assert.equal(matches[0].code, code);
    assert.equal(matches[0].raw, raw);
    assert.equal(matches[0].index, 7);
    assert.equal(matches[0].length, raw.length);
  });
}
test('does not interpret word prefixes as magnitudes', () => {
  for (const word of ['monthly', 'bargain', 'tickets', 'kittens', 'm²', 'm_name']) {
    const [match] = findMatches(`$300 ${word}`);
    assert.equal(match.amount, 300);
    assert.equal(match.raw, '$300');
  }
});
test('multiple matches, repeated scans and conversion use expanded amounts', () => {
  const text = '$300k, €1.5m and 2bn GBP';
  for (let i = 0; i < 2; i++) {
    const matches = findMatches(text);
    assert.equal(matches.length, 3);
    assert.equal(convert(matches[0].amount, 'USD', { USD: 0.0025 }), 120000000);
    assert.equal(matches[1].amount, 1500000);
    assert.equal(matches[2].amount, 2000000000);
  }
});
test('parser applies multipliers after locale parsing', () => {
  assert.equal(parseAmount('1.234,5 k'), 1234500);
  assert.equal(parseAmount('1,234.5 MN'), 1234500000);
  assert.equal(parseAmount('invalid'), null);
  assert.equal(parseAmount('9'.repeat(310) + 't'), null);
});

// Exercise every public suffix with both currency positions and mixed case.
const magnitudes = [
  ['k', 1e3], ['thousand', 1e3],
  ['m', 1e6], ['mn', 1e6], ['million', 1e6],
  ['b', 1e9], ['bn', 1e9], ['billion', 1e9],
  ['t', 1e12], ['tn', 1e12], ['trillion', 1e12],
];
for (const [suffix, multiplier] of magnitudes) {
  for (const spelling of new Set([suffix, suffix.toUpperCase()])) {
    for (const raw of [`$2.5${spelling}`, `2.5 ${spelling} €`, `USD 2.5${spelling}`, `2.5 ${spelling} EUR`]) {
      test(`expands ${raw}`, () => {
        const matches = findMatches(raw);
        assert.equal(matches.length, 1);
        assert.equal(matches[0].raw, raw);
        assert.equal(matches[0].amount, 2.5 * multiplier);
      });
    }
  }
}

test('handles zero, fractions, grouping and narrow non-breaking spaces', () => {
  for (const [raw, amount] of [
    ['$0k', 0], ['$0.5k', 500], ['€0,25m', 250000],
    ['$1,234k', 1234000], ['€1.234k', 1234000],
    ['$1,234.5k', 1234500], ['€1.234,5m', 1234500000],
    ['$300\u202fk', 300000], ['$300\tk', 300000],
  ]) {
    const [match] = findMatches(raw);
    assert.equal(match.raw, raw);
    assert.equal(match.amount, amount);
  }
});

test('suffixes stop before punctuation, not within words or identifiers', () => {
  for (const tail of ['.', ',', ';', ':', ')', '/', '–']) {
    const [match] = findMatches(`$300k${tail}`);
    assert.equal(match.raw, '$300k');
    assert.equal(match.amount, 300000);
  }
  for (const word of ['millionaire', 'bnothing', 'kWh', 'métrique', 'k9']) {
    const [match] = findMatches(`$300 ${word}`);
    assert.equal(match.raw, '$300');
    assert.equal(match.amount, 300);
  }
  assert.equal(findMatches('$300\nk')[0].amount, 300);
});

test('requires a currency marker and preserves ISO code case rules', () => {
  for (const text of ['300k', '1.5 million people', 'usd 300k', '300k eur', 'nothing here']) {
    assert.equal(findMatches(text).length, 0);
  }
});

test('match ranges preserve surrounding text and original suffixes', () => {
  const text = 'Budget ($300k), cost €1.5 M; next: 2bn GBP.';
  const matches = findMatches(text);
  let cursor = 0;
  let rendered = '';
  for (const match of matches) {
    assert.equal(text.slice(match.index, match.index + match.length), match.raw);
    rendered += text.slice(cursor, match.index) + match.raw + ' [converted]';
    cursor = match.index + match.length;
  }
  rendered += text.slice(cursor);
  assert.equal(rendered, 'Budget ($300k [converted]), cost €1.5 M [converted]; next: 2bn GBP [converted].');
});

test('conversion handles zero and unavailable rates', () => {
  assert.equal(convert(0, 'USD', { USD: 0.0025 }), 0);
  assert.equal(convert(300000, 'USD', null), null);
  assert.equal(convert(300000, 'USD', {}), null);
  assert.equal(convert(300000, 'USD', { USD: 0 }), null);
});

test('formatted converted amounts remain valid currency strings', () => {
  const converted = convert(findMatches('$300k')[0].amount, 'USD', { USD: 0.0025 });
  const actual = context.self.DoCConverter.formatAmount(converted, 'HUF');
  const expected = new Intl.NumberFormat('hu-HU', { style: 'currency', currency: 'HUF', currencyDisplay: 'symbol' }).format(120000000);
  assert.equal(actual, expected);
});
