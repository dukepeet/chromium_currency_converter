const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({ self: {} });
for (const file of ['shared/currencies.js', 'content/converter.js']) {
  const filename = path.join(__dirname, '..', file);
  vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename });
}
const { findMatches, parseAmount, convert, QUICK_TEST } = context.self.DoCConverter;

// Explicit values form an independent oracle, rather than deriving expected
// values with the production parser or reading its multiplier table.
const magnitudes = [
  ['k', 1000], ['thousand', 1000],
  ['m', 1000000], ['mn', 1000000], ['million', 1000000],
  ['b', 1000000000], ['bn', 1000000000], ['billion', 1000000000],
  ['t', 1000000000000], ['tn', 1000000000000], ['trillion', 1000000000000],
];
const amounts = [
  ['0', 0], ['.5', 0.5], [',5', 0.5],
  ['.500', 0.5], [',500', 0.5], ['.123', 0.123], [',123', 0.123],
  ['1.2345', 1.2345], ['1,2345', 1.2345],
  ['1234.5', 1234.5], ['1234,5', 1234.5],
  ['1,234.5', 1234.5], ['1.234,5', 1234.5],
  ['1 234,5', 1234.5], ['1\u00a0234,5', 1234.5],
  ['1\u202f234.5', 1234.5],
];
const currencies = [
  ['USD', '$', 0.25], ['EUR', '€', 0.125], ['BRL', 'R$', 0.5],
];
const spaces = ['', ' ', '\u202f'];
const signs = ['', '-'];
const prefix = 'Prices 😀: ';
const casesPerGroup = 3 * spaces.length * amounts.length * signs.length * 4;

function assertNear(actual, expected, label) {
  // Decimal fractions and trillion-sized amounts may not have exact binary
  // representations. Scale the tolerance without masking magnitude errors.
  const tolerance = Math.max(1, Math.abs(expected)) * Number.EPSILON * 8;
  assert.ok(Number.isFinite(actual), `${label}: expected finite value, got ${actual}`);
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual} (tolerance ${tolerance})`);
}

for (const [code, symbol, rate] of currencies) {
  for (const [suffix, multiplier] of magnitudes) {
    test(`generated consistency: ${code}, ${suffix} (${casesPerGroup} cases)`, () => {
      const mixedCase = suffix.replace(/[a-z]/g, (ch, index) => index % 2 ? ch.toUpperCase() : ch);
      // Keep three deterministic spellings even for one-letter suffixes so
      // every top-level case exercises the same Cartesian product size.
      const spellings = [suffix, suffix.toUpperCase(), mixedCase];
      let cases = 0;
      for (const spelling of spellings) {
        for (const space of spaces) {
          for (const [number, value] of amounts) {
            for (const sign of signs) {
              const amount = `${sign}${number}${space}${spelling}`;
              const expected = (sign === '-' ? -value : value) * multiplier;
              const layouts = [
                `${symbol}${amount}`, `${amount} ${symbol}`,
                `${code} ${amount}`, `${amount} ${code}`,
              ];
              assertNear(parseAmount(amount), expected, `parseAmount(${amount})`);
              for (const raw of layouts) {
                const text = `${prefix}${raw}; end`;
                assert.ok(QUICK_TEST.test(text), `precheck missed ${raw}`);
                const matches = findMatches(text);
                assert.equal(matches.length, 1, `match count for ${raw}`);
                const [match] = matches;
                assert.equal(match.raw, raw, `raw text for ${raw}`);
                assert.equal(match.code, code, `currency for ${raw}`);
                assert.equal(match.index, prefix.length, `start offset for ${raw}`);
                assert.equal(match.length, raw.length, `length for ${raw}`);
                assert.equal(text.slice(match.index, match.index + match.length), raw);
                assertNear(match.amount, expected, `amount for ${raw}`);
                assertNear(convert(match.amount, code, { [code]: rate }), expected / rate,
                  `converted value for ${raw}`);
                cases++;
              }
            }
          }
        }
      }
      assert.equal(cases, casesPerGroup);
    });
  }
}

test('generated lists preserve order, non-overlap and all price offsets across repeated scans', () => {
  const entries = magnitudes.map(([suffix, multiplier], index) => {
    const [code, symbol] = currencies[index % currencies.length];
    const sign = index % 2 ? '-' : '';
    const raw = index % 2 ? `${sign}2.5${suffix} ${code}` : `${symbol}2,5 ${suffix}`;
    return { raw, code, amount: (index % 2 ? -2.5 : 2.5) * multiplier };
  });
  const text = '😀 ' + entries.map(({ raw }) => raw).join(' | ') + ' end';
  for (let scan = 0; scan < 3; scan++) {
    const matches = findMatches(text);
    assert.equal(matches.length, entries.length);
    let end = 0;
    for (let i = 0; i < matches.length; i++) {
      const match = matches[i];
      const expected = entries[i];
      assert.ok(match.index >= end, `overlapping or unordered match ${i}`);
      assert.equal(match.index, text.indexOf(expected.raw, end));
      assert.equal(text.slice(match.index, match.index + match.length), expected.raw);
      assert.equal(match.raw, expected.raw);
      assert.equal(match.code, expected.code);
      assertNear(match.amount, expected.amount, `list item ${i}`);
      end = match.index + match.length;
    }
  }
});

test('generated line boundaries never attach a magnitude from another line', () => {
  for (const lineBreak of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const [suffix] of magnitudes) {
      const raw = `$300${lineBreak}${suffix}`;
      const matches = findMatches(raw);
      assert.equal(matches.length, 1, `line break ${JSON.stringify(lineBreak)} + ${suffix}`);
      assert.equal(matches[0].raw, '$300');
      assert.equal(matches[0].amount, 300);
    }
  }
});


test('generated signed layouts preserve plus, ASCII minus and Unicode minus around currency markers', () => {
  for (const [code, symbol] of currencies) {
    for (const [suffix, multiplier] of magnitudes) {
      for (const sign of ['+', '-', '−']) {
        const expected = (sign === '+' ? 2.5 : -2.5) * multiplier;
        const layouts = [
          `${sign}${symbol}2.5${suffix}`, `${symbol}${sign}2.5${suffix}`,
          `${sign}${code} 2.5${suffix}`, `${code} ${sign}2.5${suffix}`,
          `${sign}2.5${suffix} ${symbol}`, `${sign}2.5${suffix} ${code}`,
        ];
        for (const raw of layouts) {
          assert.ok(QUICK_TEST.test(raw), `precheck missed ${raw}`);
          const matches = findMatches(raw);
          assert.equal(matches.length, 1, `match count for ${raw}`);
          assert.equal(matches[0].raw, raw);
          assert.equal(matches[0].code, code);
          assertNear(matches[0].amount, expected, raw);
        }
      }
    }
  }
});

test('malformed double signs and numeric word prefixes are never salvaged into valid amounts', () => {
  for (const raw of ['$--300k', '$-+300k', '$+−300k', 'USD --300k', '--300k EUR', '300kk EUR', '300garbage EUR', '$1.2.3m']) {
    assert.equal(findMatches(raw).length, 0, `unexpected match for ${raw}`);
  }
  for (const raw of ['--300k', '-+300k', '+−300k', '300kk', '300garbage', '1.2.3m']) {
    assert.equal(parseAmount(raw), null, `unexpected parsed amount for ${raw}`);
  }
});

function currencyLayouts(number, code, symbol) {
  return [`${symbol}${number}`, `${number} ${symbol}`, `${code} ${number}`, `${number} ${code}`];
}

function assertPricePair(text, left, right, separator, leftCode, rightCode, rightAmount) {
  assert.ok(QUICK_TEST.test(text));
  const matches = findMatches(text);
  assert.equal(matches.length, 2, `expected both prices in ${text}`);
  const expected = [
    { raw: left, index: prefix.length, code: leftCode, amount: 300000 },
    { raw: right, index: prefix.length + left.length + separator.length, code: rightCode, amount: rightAmount },
  ];
  for (let index = 0; index < expected.length; index++) {
    const match = matches[index];
    const wanted = expected[index];
    assert.equal(match.raw, wanted.raw, `raw price ${index} in ${text}`);
    assert.equal(match.index, wanted.index, `offset ${index} in ${text}`);
    assert.equal(match.length, wanted.raw.length, `length ${index} in ${text}`);
    assert.equal(match.code, wanted.code, `code ${index} in ${text}`);
    assert.equal(match.amount, wanted.amount, `amount ${index} in ${text}`);
    assert.equal(text.slice(match.index, match.index + match.length), match.raw);
  }
  assert.ok(matches[0].index + matches[0].length <= matches[1].index, `overlapping prices in ${text}`);
}

// Cross every prefix/suffix symbol/code layout and marker pair. In particular,
// separators immediately following alphabetic currency codes must not become
// decimal syntax, and ASCII hyphens between prices must not become minus signs.
for (const separator of [',', ', ', ';', ' | ', '-', ' - ', '–', ' – ']) {
  test(`generated price pairs separated by ${JSON.stringify(separator)} (144 cases)`, () => {
    let cases = 0;
    for (const [leftCode, leftSymbol] of currencies) {
      for (const [rightCode, rightSymbol] of currencies) {
        for (const left of currencyLayouts('300k', leftCode, leftSymbol)) {
          for (const right of currencyLayouts('500m', rightCode, rightSymbol)) {
            const text = `${prefix}${left}${separator}${right}; end`;
            assertPricePair(text, left, right, separator, leftCode, rightCode, 500000000);
            cases++;
          }
        }
      }
    }
    assert.equal(cases, 144);
  });
}

for (const separator of [',', ', ']) {
  test(`generated negative prices following ${JSON.stringify(separator)} retain their sign (144 cases)`, () => {
    let cases = 0;
    for (const [leftCode, leftSymbol] of currencies) {
      for (const [rightCode, rightSymbol] of currencies) {
        for (const left of currencyLayouts('300k', leftCode, leftSymbol)) {
          for (const right of currencyLayouts('-500m', rightCode, rightSymbol)) {
            const text = `${prefix}${left}${separator}${right}; end`;
            assertPricePair(text, left, right, separator, leftCode, rightCode, -500000000);
            cases++;
          }
        }
      }
    }
    assert.equal(cases, 144);
  });
}
