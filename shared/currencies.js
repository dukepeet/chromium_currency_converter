// Shared currency metadata, used by the background service worker, the
// popup/options pages, and the content script. Loaded as a classic script
// (not an ES module) so it works via both importScripts() and <script>.
(function (global) {
  // Currencies covered by the Frankfurter API (ECB reference rates).
  const CURRENCIES = [
    { code: 'AUD', name: 'Australian Dollar' },
    { code: 'BGN', name: 'Bulgarian Lev' },
    { code: 'BRL', name: 'Brazilian Real' },
    { code: 'CAD', name: 'Canadian Dollar' },
    { code: 'CHF', name: 'Swiss Franc' },
    { code: 'CNY', name: 'Chinese Yuan' },
    { code: 'CZK', name: 'Czech Koruna' },
    { code: 'DKK', name: 'Danish Krone' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'British Pound' },
    { code: 'HKD', name: 'Hong Kong Dollar' },
    { code: 'HUF', name: 'Hungarian Forint' },
    { code: 'IDR', name: 'Indonesian Rupiah' },
    { code: 'ILS', name: 'Israeli Shekel' },
    { code: 'INR', name: 'Indian Rupee' },
    { code: 'ISK', name: 'Icelandic Krona' },
    { code: 'JPY', name: 'Japanese Yen' },
    { code: 'KRW', name: 'South Korean Won' },
    { code: 'MXN', name: 'Mexican Peso' },
    { code: 'MYR', name: 'Malaysian Ringgit' },
    { code: 'NOK', name: 'Norwegian Krone' },
    { code: 'NZD', name: 'New Zealand Dollar' },
    { code: 'PHP', name: 'Philippine Peso' },
    { code: 'PLN', name: 'Polish Zloty' },
    { code: 'RON', name: 'Romanian Leu' },
    { code: 'SEK', name: 'Swedish Krona' },
    { code: 'SGD', name: 'Singapore Dollar' },
    { code: 'THB', name: 'Thai Baht' },
    { code: 'TRY', name: 'Turkish Lira' },
    { code: 'USD', name: 'US Dollar' },
    { code: 'ZAR', name: 'South African Rand' },
  ];

  // Symbols that map to exactly one currency, safe to auto-detect.
  const UNAMBIGUOUS_SYMBOLS = {
    '€': 'EUR',
    '£': 'GBP',
    '₹': 'INR',
    'zł': 'PLN',
    'Kč': 'CZK',
    'Ft': 'HUF',
    '₺': 'TRY',
    '₩': 'KRW',
    '₪': 'ILS',
    'R$': 'BRL',
  };

  // Symbols shared by several currencies. We still detect them, but fall
  // back to the most common real-world usage. Configurable later.
  const DEFAULT_AMBIGUOUS_SYMBOL = {
    '$': 'USD',
    '¥': 'JPY',
  };

  global.DoC_CURRENCIES = CURRENCIES;
  global.DoC_UNAMBIGUOUS_SYMBOLS = UNAMBIGUOUS_SYMBOLS;
  global.DoC_DEFAULT_AMBIGUOUS_SYMBOL = DEFAULT_AMBIGUOUS_SYMBOL;
})(self);
