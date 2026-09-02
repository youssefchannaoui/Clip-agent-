/**
 * Which country a request came from, and what money that country spends.
 *
 * Used to show a visitor the price they will actually be charged rather than
 * an Australian one they have to convert in their head. NOTHING here converts
 * money: the amount shown always comes from Stripe, in a currency Stripe has
 * been configured to charge. This module only answers "which currency should
 * we ask Stripe about", and it is deliberately allowed to be wrong -- being
 * wrong means the visitor sees the default currency, never a wrong number.
 *
 * No IP address is stored or logged. The country is read from a header the
 * edge already added, used for the length of the request, and dropped.
 */

/**
 * The country header, in the order it can be trusted.
 *
 * `cf-ipcountry` is added by Cloudflare, which sits in front of Render for
 * this domain, and is not forwardable by a caller -- Cloudflare overwrites it.
 * The others are their equivalents at other edges, kept so a move off
 * Cloudflare does not silently turn this off. `x-country` is last and is only
 * honoured because it is also what the tests drive.
 */
const COUNTRY_HEADERS = [
  'cf-ipcountry',
  'x-vercel-ip-country',
  'x-appengine-country',
  'fastly-client-country',
  'x-country',
];

/**
 * Country to the currency its people are actually charged in.
 *
 * The euro, the two dollar zones and the CFA franc are the reason this is a
 * map rather than a lookup on the country code: twenty countries share the
 * euro, and getting that wrong would ask Stripe about a currency that does not
 * exist. Everything absent from this map falls back to the default, which is
 * the honest answer for a country whose currency Stripe cannot charge.
 */
const COUNTRY_CURRENCY = {
  // Australia and New Zealand
  AU: 'aud', NZ: 'nzd', NF: 'aud', CX: 'aud', CC: 'aud', HM: 'aud', KI: 'aud', NR: 'aud', TV: 'aud',
  // The euro area, including the microstates and territories that use it
  AD: 'eur', AT: 'eur', AX: 'eur', BE: 'eur', BL: 'eur', CY: 'eur', DE: 'eur', EE: 'eur',
  ES: 'eur', FI: 'eur', FR: 'eur', GF: 'eur', GP: 'eur', GR: 'eur', HR: 'eur', IE: 'eur',
  IT: 'eur', LT: 'eur', LU: 'eur', LV: 'eur', MC: 'eur', ME: 'eur', MF: 'eur', MQ: 'eur',
  MT: 'eur', NL: 'eur', PM: 'eur', PT: 'eur', RE: 'eur', SI: 'eur', SK: 'eur', SM: 'eur',
  VA: 'eur', XK: 'eur', YT: 'eur',
  // The rest of Europe
  AL: 'all', BA: 'bam', BG: 'bgn', BY: 'byn', CH: 'chf', CZ: 'czk', DK: 'dkk', FO: 'dkk',
  GB: 'gbp', GG: 'gbp', GI: 'gip', IM: 'gbp', IS: 'isk', JE: 'gbp', LI: 'chf', MD: 'mdl',
  MK: 'mkd', NO: 'nok', PL: 'pln', RO: 'ron', RS: 'rsd', RU: 'rub', SE: 'sek', UA: 'uah',
  // The Americas
  AR: 'ars', BB: 'bbd', BM: 'bmd', BO: 'bob', BR: 'brl', BS: 'bsd', BZ: 'bzd', CA: 'cad',
  CL: 'clp', CO: 'cop', CR: 'crc', CU: 'cup', DO: 'dop', EC: 'usd', GT: 'gtq', GY: 'gyd',
  HN: 'hnl', HT: 'htg', JM: 'jmd', KY: 'kyd', MX: 'mxn', NI: 'nio', PA: 'pab', PE: 'pen',
  PR: 'usd', PY: 'pyg', SR: 'srd', SV: 'usd', TT: 'ttd', US: 'usd', UY: 'uyu', VE: 'ves',
  VG: 'usd', VI: 'usd',
  // The Middle East and North Africa
  AE: 'aed', BH: 'bhd', DZ: 'dzd', EG: 'egp', IL: 'ils', IQ: 'iqd', JO: 'jod', KW: 'kwd',
  LB: 'lbp', LY: 'lyd', MA: 'mad', OM: 'omr', PS: 'ils', QA: 'qar', SA: 'sar', SY: 'syp',
  TN: 'tnd', TR: 'try', YE: 'yer',
  // Sub-Saharan Africa
  AO: 'aoa', BF: 'xof', BI: 'bif', BJ: 'xof', BW: 'bwp', CD: 'cdf', CF: 'xaf', CG: 'xaf',
  CI: 'xof', CM: 'xaf', CV: 'cve', DJ: 'djf', ER: 'ern', ET: 'etb', GA: 'xaf', GH: 'ghs',
  GM: 'gmd', GN: 'gnf', GQ: 'xaf', GW: 'xof', KE: 'kes', KM: 'kmf', LR: 'lrd', LS: 'lsl',
  MG: 'mga', ML: 'xof', MR: 'mru', MU: 'mur', MW: 'mwk', MZ: 'mzn', NA: 'nad', NE: 'xof',
  NG: 'ngn', RW: 'rwf', SC: 'scr', SD: 'sdg', SL: 'sll', SN: 'xof', SO: 'sos', SS: 'ssp',
  ST: 'stn', SZ: 'szl', TD: 'xaf', TG: 'xof', TZ: 'tzs', UG: 'ugx', ZA: 'zar', ZM: 'zmw',
  ZW: 'usd',
  // Asia
  AF: 'afn', AM: 'amd', AZ: 'azn', BD: 'bdt', BN: 'bnd', BT: 'btn', CN: 'cny', GE: 'gel',
  HK: 'hkd', ID: 'idr', IN: 'inr', JP: 'jpy', KG: 'kgs', KH: 'khr', KR: 'krw', KZ: 'kzt',
  LA: 'lak', LK: 'lkr', MM: 'mmk', MN: 'mnt', MO: 'mop', MV: 'mvr', MY: 'myr', NP: 'npr',
  PH: 'php', PK: 'pkr', SG: 'sgd', TH: 'thb', TJ: 'tjs', TM: 'tmt', TW: 'twd', UZ: 'uzs',
  VN: 'vnd',
  // The Pacific
  FJ: 'fjd', FM: 'usd', GU: 'usd', MH: 'usd', MP: 'usd', NC: 'xpf', PF: 'xpf', PG: 'pgk',
  PW: 'usd', SB: 'sbd', TO: 'top', VU: 'vuv', WS: 'wst', WF: 'xpf',
};

/** The currency every price is held in, and the answer whenever we do not know better. */
export const DEFAULT_CURRENCY = 'aud';

/**
 * The country this request came from, as an uppercase two-letter code, or ''.
 *
 * "XX" and "T1" are what Cloudflare sends for an unknown country and for Tor;
 * both mean "we do not know", and guessing from them would be worse than the
 * default currency.
 */
export function countryOf(req) {
  const headers = (req && req.headers) || {};
  for (const name of COUNTRY_HEADERS) {
    const value = String(headers[name] || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1') return value;
  }
  return '';
}

/**
 * The currency to ask Stripe about for this request.
 *
 * Falls back to the default rather than guessing from Accept-Language: a
 * browser set to en-GB in Sydney is common, and charging that person in
 * pounds because of a language preference would be a real billing error made
 * on the strength of a display setting.
 */
export function currencyOf(req) {
  return COUNTRY_CURRENCY[countryOf(req)] || DEFAULT_CURRENCY;
}

/** The currency a country spends, for callers that already know the country. */
export function currencyForCountry(country) {
  return COUNTRY_CURRENCY[String(country || '').trim().toUpperCase()] || DEFAULT_CURRENCY;
}

/**
 * Currencies with no minor unit. Stripe still quotes them in the smallest
 * unit, which for these IS the whole unit -- ¥500 is 500, not 50000 -- so
 * dividing by 100 would show a price a hundred times too small.
 */
const ZERO_DECIMAL = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf',
  'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

/**
 * A Stripe amount, written the way that currency is written.
 *
 * Intl does the symbol and the placement, which differ by more than a prefix:
 * the euro follows the number in much of Europe, and the Australian dollar has
 * to read "A$" rather than "$" or an Australian price is indistinguishable
 * from an American one -- which is why the locale is en-US and not en-AU:
 * en-AU writes its own currency as a bare "$", exactly the ambiguity this has
 * to avoid. Falls back to "CODE 12.34" if Intl has no opinion, which is ugly
 * and unambiguous.
 */
export function formatMoney(amountMinor, currency, locale = 'en-US') {
  const code = String(currency || DEFAULT_CURRENCY).toLowerCase();
  const zero = ZERO_DECIMAL.has(code);
  const amount = Number(amountMinor || 0) / (zero ? 1 : 100);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: code.toUpperCase(),
      // 'symbol', not 'narrowSymbol': narrow deliberately strips the country
      // prefix, so the Australian dollar comes out as a bare "$" and is
      // indistinguishable from the American one. This keeps A$, CA$, NZ$.
      currencyDisplay: 'symbol',
      minimumFractionDigits: 0,
      // Whole prices read as prices; 29.50 must not become 30.
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount);
  } catch {
    return `${code.toUpperCase()} ${zero ? amount : amount.toFixed(2)}`;
  }
}
