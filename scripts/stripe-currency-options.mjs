#!/usr/bin/env node
/**
 * Give each Stripe Price a real amount in the currencies we quote.
 *
 * WHY THIS EXISTS
 * Adaptive Pricing is already enabled on the account, so Stripe converts at
 * Checkout and every country can already pay in its own money. What it does
 * not do is fill in `currency_options`, which is what the pricing pages read
 * — so the pages quote Australian dollars. Setting these amounts is what lets
 * a visitor SEE their own currency, and because the app then passes that same
 * currency to the Checkout Session, the price shown is the price charged.
 *
 * WHAT IT COSTS YOU
 * These are FIXED amounts. Unlike Adaptive Pricing, they do not follow the
 * exchange rate, so they drift and are yours to revisit. That is the whole
 * reason this covers five major currencies rather than fifty: everything else
 * keeps being converted automatically by Stripe at the live rate, which needs
 * no maintenance at all.
 *
 * USAGE
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-currency-options.mjs
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-currency-options.mjs --apply
 *
 * The first form changes NOTHING: it reads every price and prints exactly what
 * would be written. Only --apply writes. The key is read from the environment
 * and never printed.
 */

const APPLY = process.argv.includes('--apply');
const KEY = process.env.STRIPE_SECRET_KEY || '';

if (!KEY) {
  console.error('STRIPE_SECRET_KEY is not set. Run:\n'
    + '  STRIPE_SECRET_KEY=sk_live_... node scripts/stripe-currency-options.mjs');
  process.exit(1);
}

/**
 * Amounts, in the currency's major unit.
 *
 * Converted from the Australian price at the rate on 2 Sept 2026 and rounded
 * UP to the local .99 convention, so no currency is ever cheaper than the
 * Australian one after rounding. Three-figure yearly prices are whole numbers,
 * which is how yearly prices are normally written.
 */
const PLAN_PRICES = {
  weekly:        { aud: 9.99,   usd: 7.99,   gbp: 5.99,   eur: 6.99,   cad: 9.99,   nzd: 12.99 },
  monthly:       { aud: 29.99,  usd: 21.99,  gbp: 15.99,  eur: 18.99,  cad: 29.99,  nzd: 36.99 },
  yearly:        { aud: 249,    usd: 178,    gbp: 132,    eur: 154,    cad: 248,    nzd: 302 },
  studioWeekly:  { aud: 19.99,  usd: 14.99,  gbp: 10.99,  eur: 12.99,  cad: 19.99,  nzd: 24.99 },
  studioMonthly: { aud: 59.99,  usd: 42.99,  gbp: 31.99,  eur: 36.99,  cad: 59.99,  nzd: 72.99 },
  studioYearly:  { aud: 499,    usd: 357,    gbp: 264,    eur: 308,    cad: 496,    nzd: 606 },
  topup100:      { aud: 8.99,   usd: 6.99,   gbp: 4.99,   eur: 5.99,   cad: 8.99,   nzd: 10.99 },
  topup300:      { aud: 24.49,  usd: 17.99,  gbp: 12.99,  eur: 15.99,  cad: 24.99,  nzd: 29.99 },
  topup750:      { aud: 49.99,  usd: 35.99,  gbp: 26.99,  eur: 30.99,  cad: 49.99,  nzd: 60.99 },
};

/** Which environment variable holds each price id. */
const PRICE_ENV = {
  weekly: 'STRIPE_PRICE_WEEKLY',
  monthly: 'STRIPE_PRICE_MONTHLY',
  yearly: 'STRIPE_PRICE_YEARLY',
  studioWeekly: 'STRIPE_PRICE_STUDIO_WEEKLY',
  studioMonthly: 'STRIPE_PRICE_STUDIO_MONTHLY',
  studioYearly: 'STRIPE_PRICE_STUDIO_YEARLY',
  topup100: 'STRIPE_PRICE_TOPUP_100',
  topup300: 'STRIPE_PRICE_TOPUP_300',
  topup750: 'STRIPE_PRICE_TOPUP_750',
};

// None of the five is zero-decimal, but the conversion is written out rather
// than assumed: the yen would be a hundred times wrong under `* 100`.
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);
const minor = (amount, code) => Math.round(amount * (ZERO_DECIMAL.has(code) ? 1 : 100));

async function stripe(path, { method = 'GET', form = null } = {}) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: form || undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
  return payload;
}

const mode = KEY.startsWith('sk_live') ? 'LIVE' : KEY.startsWith('sk_test') ? 'TEST' : 'UNKNOWN';
console.log(`Stripe key mode: ${mode}`);
console.log(APPLY ? 'Applying changes.\n' : 'Dry run — nothing will be written. Add --apply to write.\n');

let written = 0;
let skipped = 0;
let failed = 0;

for (const [plan, envName] of Object.entries(PRICE_ENV)) {
  const priceId = process.env[envName] || '';
  if (!priceId) {
    console.log(`· ${plan.padEnd(14)} ${envName} is not set — skipped`);
    skipped += 1;
    continue;
  }
  let price;
  try {
    price = await stripe(`/prices/${encodeURIComponent(priceId)}?expand[]=currency_options`);
  } catch (error) {
    console.log(`✗ ${plan.padEnd(14)} could not read ${priceId}: ${error.message}`);
    failed += 1;
    continue;
  }

  const base = String(price.currency || '').toLowerCase();
  const wanted = PLAN_PRICES[plan];
  const baseMajor = Number(price.unit_amount || 0) / (ZERO_DECIMAL.has(base) ? 1 : 100);

  // The base amount in Stripe must match the table, or the table is describing
  // a price that no longer exists and every converted amount derived from it
  // is wrong too. Refuse rather than write a set of numbers built on a stale
  // Australian price.
  if (base !== 'aud' || Math.abs(baseMajor - wanted.aud) > 0.005) {
    console.log(`✗ ${plan.padEnd(14)} ${priceId} is ${baseMajor} ${base.toUpperCase()}, `
      + `but this script was written for ${wanted.aud} AUD. Update PLAN_PRICES first.`);
    failed += 1;
    continue;
  }

  const form = new URLSearchParams();
  const plan_line = [];
  for (const [code, amount] of Object.entries(wanted)) {
    if (code === 'aud') continue;   // the base currency is not a currency option
    form.append(`currency_options[${code}][unit_amount]`, String(minor(amount, code)));
    plan_line.push(`${code.toUpperCase()} ${amount}`);
  }

  const already = Object.keys(price.currency_options || {}).length;
  console.log(`${APPLY ? '→' : '·'} ${plan.padEnd(14)} ${priceId}  A$${wanted.aud}  ⇒  ${plan_line.join(', ')}`
    + (already ? `   (replacing ${already} existing)` : ''));

  if (!APPLY) continue;
  try {
    await stripe(`/prices/${encodeURIComponent(priceId)}`, { method: 'POST', form });
    written += 1;
  } catch (error) {
    console.log(`  ✗ write failed: ${error.message}`);
    failed += 1;
  }
}

console.log('');
if (APPLY) {
  console.log(`Wrote ${written} price(s). ${skipped} skipped, ${failed} failed.`);
  if (written) console.log('The pricing pages pick these up within ten minutes (the price cache).');
} else {
  console.log(`Dry run complete: ${Object.keys(PRICE_ENV).length - skipped - failed} price(s) ready to write, `
    + `${skipped} skipped, ${failed} blocked.`);
  console.log('Re-run with --apply to write them.');
}
process.exit(failed ? 1 : 0);
