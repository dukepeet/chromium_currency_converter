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
