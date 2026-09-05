/**
 * Prices in the visitor's own money, and never a converted guess.
 *
 * Youssef, 2 Sept 2026: "fix currency for all countries auto detect".
 *
 * The rule that shapes every test here: a price is shown in a currency ONLY
 * when Stripe holds a real amount in it and will charge that amount. We never
 * convert. A converted number on a pricing page is a promise the checkout does
 * not keep, and this codebase already has a rule that the label and the charge
 * must not disagree (see the note above the price labels in config.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

/* EVERY currencyDrift TEST IN THIS FILE USED TO RETURN EARLY AND NEVER RUN.
   They open `if (!monthly) return;`, nothing anywhere set STRIPE_PRICE_*, and
   config reads the environment ONCE at first import -- so three tests passed
   for free, in CI and locally, on the exact code that then alerted for 49
   hours about a drift that could never be cleared. Set before the first import
   that pulls in config.js, which is the same rule this repo already has for
   PORT. */
process.env.STRIPE_PRICE_WEEKLY ||= 'price_test_weekly';
process.env.STRIPE_PRICE_MONTHLY ||= 'price_test_monthly';
process.env.STRIPE_PRICE_YEARLY ||= 'price_test_yearly';

const geo = await import('../src/geo.js');

test('the country comes from the edge, not from anything a caller can set', () => {
  // Cloudflare sits in front of Render for this domain and overwrites
  // cf-ipcountry, so it cannot be forged by the visitor.
  assert.equal(geo.countryOf({ headers: { 'cf-ipcountry': 'gb' } }), 'GB');
  assert.equal(geo.countryOf({ headers: { 'x-vercel-ip-country': 'DE' } }), 'DE');
  assert.equal(geo.countryOf({ headers: {} }), '');
  // Cloudflare's "we do not know" answers must not be treated as countries.
  assert.equal(geo.countryOf({ headers: { 'cf-ipcountry': 'XX' } }), '');
  assert.equal(geo.countryOf({ headers: { 'cf-ipcountry': 'T1' } }), '', 'Tor is not a country');
  assert.equal(geo.countryOf({ headers: { 'cf-ipcountry': 'GBR' } }), '', 'only ISO-3166 alpha-2');
});

test('every continent lands on the money its people actually spend', () => {
  const cur = cc => geo.currencyOf({ headers: { 'cf-ipcountry': cc } });
  assert.equal(cur('AU'), 'aud');
  assert.equal(cur('US'), 'usd');
  assert.equal(cur('GB'), 'gbp');
  assert.equal(cur('CA'), 'cad');
  assert.equal(cur('IN'), 'inr');
  assert.equal(cur('ID'), 'idr', 'the largest Muslim population in the world');
  assert.equal(cur('PK'), 'pkr');
  assert.equal(cur('EG'), 'egp');
  assert.equal(cur('SA'), 'sar');
  assert.equal(cur('NG'), 'ngn');
  assert.equal(cur('ZA'), 'zar');
  assert.equal(cur('MY'), 'myr');
  assert.equal(cur('TR'), 'try');
  assert.equal(cur('BR'), 'brl');
  assert.equal(cur('JP'), 'jpy');
});

test('the euro area is one currency, not twenty', () => {
  const cur = cc => geo.currencyOf({ headers: { 'cf-ipcountry': cc } });
  for (const cc of ['DE', 'FR', 'IE', 'NL', 'ES', 'IT', 'PT', 'FI', 'GR', 'HR']) {
    assert.equal(cur(cc), 'eur', `${cc} spends euros`);
  }
  // And its neighbours that do not.
  assert.equal(cur('CH'), 'chf');
  assert.equal(cur('PL'), 'pln');
  assert.equal(cur('SE'), 'sek');
  assert.equal(cur('NO'), 'nok');
});

test('an unknown country gets the currency the prices are really held in', () => {
  // Never a guess. The default is the one currency every Stripe price has.
  assert.equal(geo.currencyOf({ headers: {} }), geo.DEFAULT_CURRENCY);
  assert.equal(geo.currencyOf({ headers: { 'cf-ipcountry': 'AQ' } }), 'aud', 'Antarctica has no currency');
  assert.equal(geo.DEFAULT_CURRENCY, 'aud');
});

test('language is never used to pick a currency', () => {
  // A browser set to en-GB in Sydney is ordinary. Charging that person in
  // pounds because of a display preference would be a real billing error made
  // on the strength of a setting that says nothing about where they are.
  assert.equal(geo.currencyOf({ headers: { 'accept-language': 'en-GB,en;q=0.9' } }), 'aud');
});

test('the Australian dollar can never be mistaken for the American one', () => {
  // Two products at "$29" in different dollars is the kind of ambiguity that
  // ends in a chargeback.
  assert.equal(geo.formatMoney(2900, 'aud'), 'A$29');
  assert.equal(geo.formatMoney(1900, 'usd'), '$19');
  assert.equal(geo.formatMoney(2600, 'cad'), 'CA$26');
  assert.equal(geo.formatMoney(3100, 'nzd'), 'NZ$31');
});

test('zero-decimal currencies are not divided by a hundred', () => {
  // Stripe quotes every amount in the smallest unit, and for the yen that IS
  // the whole unit. Dividing would advertise a price a hundred times too
  // small -- and somebody would buy it.
  assert.equal(geo.formatMoney(2900, 'jpy'), '¥2,900');
  // Intl separates these with a NON-BREAKING space, so the comparison has to
  // normalise whitespace or it fails on a character nobody can see.
  assert.equal(geo.formatMoney(12000, 'xof').replace(/\s/g, ' '), 'F CFA 12,000');
  assert.equal(geo.formatMoney(29000, 'krw').replace(/\s/g, ''), '₩29,000');
  // While an ordinary currency still is.
  assert.equal(geo.formatMoney(2900, 'usd'), '$29');
});

test('a currency Intl has never heard of still prints something honest', () => {
  const out = geo.formatMoney(2900, 'zzz');
  assert.match(out, /ZZZ/, 'the code stands in for a symbol rather than throwing');
});

/* ── The Stripe half ──────────────────────────────────────────────────────
   Nothing above decides a PRICE; it only decides which currency to ask Stripe
   about. These pin the rule that makes that safe: an amount is shown only when
   Stripe holds it, and the checkout is then told to charge that same currency. */

/* Dynamic, and that is the whole point: a static `import` is HOISTED and runs
   before any module body code, so the STRIPE_PRICE_* assignments at the top of
   this file would land after config.js had already read the environment -- and
   every drift test would go on returning early exactly as it always has. */
const { config } = await import('../src/config.js');
const billing = await import('../src/billing.js');

function withStripe(prices, run) {
  const key = config.stripeSecretKey;
  const realFetch = globalThis.fetch;
  config.stripeSecretKey = 'sk_test_currency';
  globalThis.fetch = async (url) => {
    const id = decodeURIComponent(String(url).split('/v1/prices/')[1] || '').split('?')[0];
    const price = prices[id];
    if (!price) return { ok: false, status: 404, json: async () => ({ error: { message: 'No such price' } }) };
    return { ok: true, status: 200, json: async () => price };
  };
  billing.forgetPriceCurrencies();
  return Promise.resolve(run()).finally(() => {
    config.stripeSecretKey = key;
    globalThis.fetch = realFetch;
    billing.forgetPriceCurrencies();
  });
}

test('a price is localised only when Stripe holds that currency', async () => {
  const monthly = config.stripePriceMonthly;
  if (!monthly) return; // no price configured in this environment
  await withStripe({
    [monthly]: {
      id: monthly, currency: 'aud', unit_amount: 2900,
      currency_options: { usd: { unit_amount: 1900 } },
    },
  }, async () => {
    const usd = await billing.plansInCurrency('usd');
    assert.equal(usd.pro_monthly.priceLabel, '$19', "Stripe's own USD amount, not ours");
    assert.equal(usd.pro_monthly.localPrice, 1900);
    assert.equal(usd.pro_monthly.localCurrency, 'usd');

    // Stripe holds nothing in rupees for this price, so the visitor sees the
    // real Australian price rather than a number we invented.
    const inr = await billing.plansInCurrency('inr');
    assert.equal(inr.pro_monthly.priceLabel, config.planPriceMonthlyLabel);
    assert.equal(inr.pro_monthly.localPrice, undefined);
  });
});

test('Stripe being unreachable leaves the configured prices standing', async () => {
  const monthly = config.stripePriceMonthly;
  if (!monthly) return;
  const key = config.stripeSecretKey;
  const realFetch = globalThis.fetch;
  config.stripeSecretKey = 'sk_test_currency';
  globalThis.fetch = async () => { throw new Error('network down'); };
  billing.forgetPriceCurrencies();
  try {
    const grid = await billing.plansInCurrency('usd');
    assert.equal(grid.pro_monthly.priceLabel, config.planPriceMonthlyLabel,
      'a pricing page must never depend on a network call succeeding');
  } finally {
    config.stripeSecretKey = key;
    globalThis.fetch = realFetch;
    billing.forgetPriceCurrencies();
  }
});

test('the public pages never wait on Stripe for a price', async () => {
  const monthly = config.stripePriceMonthly;
  if (!monthly) return;
  await withStripe({
    [monthly]: { id: monthly, currency: 'aud', unit_amount: 2900, currency_options: { usd: { unit_amount: 1900 } } },
  }, async () => {
    // Cold: nothing cached, so the Australian label stands and the lookup is
    // warmed behind the render.
    const cold = billing.plansInCurrencyCached('usd');
    assert.equal(cold.pro_monthly.priceLabel, config.planPriceMonthlyLabel);
    // Once warm, the same synchronous call is localised.
    await billing.plansInCurrency('usd');
    assert.equal(billing.plansInCurrencyCached('usd').pro_monthly.priceLabel, '$19');
  });
});

test('the default currency is never asked about at all', async () => {
  let asked = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { asked = true; throw new Error('should not be called'); };
  try {
    const grid = await billing.plansInCurrency(geo.DEFAULT_CURRENCY);
    assert.equal(asked, false, 'the base currency needs no lookup');
    assert.equal(grid.pro_monthly.priceLabel, config.planPriceMonthlyLabel);
  } finally { globalThis.fetch = realFetch; }
});

test('checkout is told to charge the currency the page showed', () => {
  // The other half of the promise. The page reads currency_options; the
  // session must carry the same currency, or the customer is shown one price
  // and charged another. Asking for a currency the price does not have makes
  // Stripe reject the whole session, so a missing one has to mean "charge the
  // base currency", never "fail".
  const source = fsReadBilling();
  const fn = /export async function createCheckoutSession\([\s\S]*?\n\}/.exec(source)[0];
  assert.match(fn, /createCheckoutSession\(user, planId, currency = ''\)/);
  assert.match(fn, /await priceCurrencies\(plan\.priceId\)/, 'checked against Stripe, not assumed');
  assert.match(fn, /Number\.isFinite\(amounts\[wanted\]\)/);
  assert.match(fn, /params\.currency = wanted/);
});

function fsReadBilling() {
  return require('node:fs').readFileSync(new URL('../src/billing.js', import.meta.url), 'utf8');
}
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('a foreign visitor is told which money the prices are in', async () => {
  // Adaptive Pricing is enabled on the Stripe account, so Checkout really does
  // charge in the customer's own currency. The page says so WITHOUT inventing
  // a converted figure: the rate belongs to Stripe and is applied when the
  // customer reaches Checkout, so any number we printed here would be a
  // promise we cannot keep.
  const marketing = await import('../src/marketing.js');
  const page = cur => marketing.pricing({ base: 'https://x.test', currentUser: null, currency: cur });

  assert.match(page('gbp'), /Stripe charges you in GBP at checkout/);
  assert.match(page('usd'), /Stripe charges you in USD at checkout/);
  assert.match(page('gbp'), /Prices shown in Australian dollars/);

  // Nothing is said to somebody who is not converting anything.
  assert.doesNotMatch(page('aud'), /Stripe charges you in/);
  assert.doesNotMatch(page(''), /Stripe charges you in/);

  // And no exchange rate is ever printed, in any currency.
  assert.doesNotMatch(page('gbp'), /£\d/, 'no converted figure appears');
  assert.doesNotMatch(page('usd'), /US\$\d/);
});

test('the cards and the schema quote the same money', async () => {
  // Structured data has to describe what the page shows. A visitor served
  // £15.99 with an offer claiming 29.99 AUD is a mismatch Google is entitled
  // to distrust the whole page over -- so both read the same Stripe amounts.
  const marketing = await import('../src/marketing.js');
  const ids = {
    [config.stripePriceWeekly]: 999, [config.stripePriceMonthly]: 2999,
    [config.stripePriceYearly]: 24900, [config.stripePriceStudioWeekly]: 1999,
    [config.stripePriceStudioMonthly]: 5999, [config.stripePriceStudioYearly]: 49900,
  };
  if (!config.stripePriceMonthly) return; // nothing configured in this environment

  const gbp = { 999: 599, 2999: 1599, 24900: 13200, 1999: 1099, 5999: 3199, 49900: 26400 };
  const key = config.stripeSecretKey;
  const realFetch = globalThis.fetch;
  config.stripeSecretKey = 'sk_test_currency';
  globalThis.fetch = async (url) => {
    const id = decodeURIComponent(String(url).split('/v1/prices/')[1] || '').split('?')[0];
    const aud = ids[id];
    if (aud === undefined) return { ok: false, status: 404, json: async () => ({ error: { message: 'no price' } }) };
    return { ok: true, status: 200, json: async () => ({
      id, currency: 'aud', unit_amount: aud, currency_options: { gbp: { unit_amount: gbp[aud] } },
    }) };
  };
  billing.forgetPriceCurrencies();
  try {
    await billing.plansInCurrency('gbp');           // warm the cache the pages read
    const page = marketing.pricing({ base: 'https://x.test', currentUser: null, currency: 'gbp' });

    assert.match(page, /£15\.99/, 'the card shows the amount Stripe holds');
    assert.doesNotMatch(page, /Stripe charges you in GBP/,
      'and the "prices are Australian" note is gone, because they are not');

    const blocks = [...page.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map(m => JSON.parse(m[1]));
    const app = blocks.find(b => b['@type'] === 'SoftwareApplication');
    const monthly = app.offers.find(o => o.name === 'Pro monthly plan');
    assert.equal(monthly.priceCurrency, 'GBP', 'the schema follows the card');
    assert.equal(monthly.price, '15.99');
    assert.ok(page.includes(`>£${monthly.price}<`) || page.includes(`£${monthly.price}`),
      'and that exact figure is on the page');
  } finally {
    config.stripeSecretKey = key;
    globalThis.fetch = realFetch;
    billing.forgetPriceCurrencies();
  }
});

test('drift is reported, never repriced', async () => {
  // currency_options are fixed amounts and the exchange rate is not. This
  // alerts a person; it must never rewrite a price on a timer, because a bad
  // rate — or a rates endpoint returning nonsense — would then reprice the
  // whole account at 3am with nobody watching.
  const monthly = config.stripePriceMonthly;
  if (!monthly) return;
  await withStripe({
    [monthly]: {
      id: monthly, currency: 'aud', unit_amount: 2999,
      // 15.99 GBP against an AUD price that is now worth ~19.50 GBP: 18% out.
      currency_options: { gbp: { unit_amount: 1599 } },
    },
  }, async () => {
    const drifted = await billing.currencyDrift({ gbp: 0.65 });
    const row = drifted.find(item => item.plan === 'pro_monthly' && item.currency === 'gbp');
    assert.ok(row, 'an 18% gap is reported');
    assert.equal(row.charged, '£15.99');
    assert.match(row.worth, /£19/);
    assert.ok(row.percent < -10, `expected a double-digit shortfall, got ${row.percent}`);

    // Within the threshold, nothing is said. An alert that fires on ordinary
    // daily movement is one nobody reads.
    assert.deepEqual(await billing.currencyDrift({ gbp: 0.53 }), []);
  });
});

test('rounding a small price up to .99 is not drift', async () => {
  // THE ALERT THAT COULD NEVER BE CLEARED. The repricer rounds UP to the local
  // .99 so no currency is ever cheaper than the Australian price -- and on a
  // weekly price that rounding is worth more than the 10% threshold by itself:
  // EUR 6.18 becomes EUR 6.99, permanently +13%. pro_weekly alerted on EUR,
  // GBP and USD for ~49 hours, and re-running the script would have written
  // the identical numbers. Compared against what the script WOULD set, it is
  // silent -- and a genuine rate move still is not.
  const weekly = config.stripePriceWeekly;
  if (!weekly) return;
  await withStripe({
    [weekly]: {
      id: weekly, currency: 'aud', unit_amount: 999,
      currency_options: { eur: { unit_amount: 699 } },
    },
  }, async () => {
    // 9.99 AUD at 0.619 is 6.18 EUR, which the convention writes as 6.99.
    assert.deepEqual(await billing.currencyDrift({ eur: 0.619 }), [],
      'the .99 convention is not drift, however small the price');

    // The euro strengthening far enough that even after rounding the charge is
    // short IS drift, and must still be reported.
    const moved = await billing.currencyDrift({ eur: 0.95 });
    assert.ok(moved.find(item => item.currency === 'eur'), 'a real rate move still alerts');
  });
});

test('the convention is one function, and it is stable', () => {
  // Applying it twice must not climb: a monitor that disagrees with the
  // repricer about what a correct price looks like is the whole bug.
  assert.equal(billing.conventionPrice(618, 'eur'), 699);
  assert.equal(billing.conventionPrice(699, 'eur'), 699, 'a price already on the convention does not move');
  assert.equal(billing.conventionPrice(35620, 'usd'), 35700, 'three figures round to a whole unit');
  assert.equal(billing.conventionPrice(1000, 'jpy'), 1000, 'the yen has no .99');
});

test('no rates means no alert, never a false one', async () => {
  const monthly = config.stripePriceMonthly;
  if (!monthly) return;
  await withStripe({
    [monthly]: { id: monthly, currency: 'aud', unit_amount: 2999, currency_options: { gbp: { unit_amount: 1 } } },
  }, async () => {
    // A currency the rates payload does not carry is skipped rather than
    // reported as infinitely wrong.
    assert.deepEqual(await billing.currencyDrift({ usd: 0.71 }), []);
  });
});

test('the daily check alerts and does not reprice', () => {
  const source = fsReadServer();
  const fn = /const checkCurrencyDrift = async \(\) => \{[\s\S]*?\n    \};/.exec(source);
  assert.ok(fn, 'the daily check exists');
  assert.match(fn[0], /alerts\.report\('currency-drift'/);
  // It may NAME the command in the mail -- that is the point of the mail --
  // but it must not be able to write a price itself: no Stripe write form, and
  // the only billing call it makes is the read-only drift report.
  assert.doesNotMatch(fn[0], /currency_options\[/, 'the timer carries no Stripe write');
  const billingCalls = [...fn[0].matchAll(/billing\.(\w+)/g)].map(m => m[1]);
  assert.deepEqual([...new Set(billingCalls)], ['currencyDrift'],
    'the timer reads drift and does nothing else');
  assert.match(fn[0], /Nothing has been changed/, 'and the mail says so');
  assert.match(source, /24 \* 60 \* 60_000/, 'once a day, not every tick');
});

function fsReadServer() {
  return require('node:fs').readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
}
