import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * How long the free window is, said once.
 *
 * Youssef, 3 Sept 2026: "let's change everything to seven days. So make sure
 * everything that says three days change to seven and then, yeah, make sure
 * everything is all correct."
 *
 * He was right that it was not correct. The trial length was named in SIX
 * independent places and they did not agree:
 *
 *   src/config.js          default 3
 *   src/billing.js  x2     `config.stripeTrialDays || 7`
 *   src/billing.js  x2     `trialDays || 3` on the plans page
 *   studio-adapter.js      `DATA.billing.trialDays || 3` on the Basic card
 *   src/seo-copy.js        "seven-day trial", ten times over
 *   Render                 STRIPE_TRIAL_DAYS=7, which is what customers got
 *
 * So the repo said three, the twenty-two public landing pages said seven, and
 * the live site said seven. Nothing was broken -- every reader that mattered
 * went through `config.stripeTrialDays`, which the environment set correctly
 * -- but a fallback is exactly what runs on the day somebody forgets the
 * variable, and then the app starts contradicting its own marketing.
 *
 * This file pins ONE number. It is deliberately a SOURCE test, which this
 * repo normally warns against: the fallbacks it guards only fire when the
 * environment is absent, so there is no executed output to read for them.
 * The one thing that CAN be executed -- the default itself -- is.
 */

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const WORDS = {
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
};

/**
 * A number said either way, and NOTHING else. An earlier cut allowed any
 * word here and flagged "the first paid day" in a sentence that happened to
 * mention the trial two clauses later -- a guard that fires on ordinary prose
 * is one somebody deletes.
 */
const NUMBER = `(?:${Object.values(WORDS).join('|')}|\\d+)`;

/** The number in the code, read from the one declaration that sets it. */
const declared = (() => {
  const source = read('src/config.js');
  const match = source.match(/number\(process\.env\.STRIPE_TRIAL_DAYS,\s*(\d+)\)/);
  assert.ok(match, 'src/config.js must declare a STRIPE_TRIAL_DAYS default');
  return Number(match[1]);
})();

test('the free window is seven days, and it is the code that says so', async () => {
  // Not merely "some number": production has run STRIPE_TRIAL_DAYS=7 since
  // launch, so a repo default of anything else means the checkout, the emails
  // and the landing pages describe a product nobody is being sold.
  assert.equal(declared, 7);

  // And it survives being loaded: `Math.max(0, Math.round(...))` sits between
  // the literal and the value every caller reads.
  delete process.env.STRIPE_TRIAL_DAYS;
  const { config } = await import('../src/config.js');
  assert.equal(config.stripeTrialDays, 7, 'with no variable set, the default is what runs');
});

test('every fallback in the app names the same number', () => {
  // `x || 7` is what renders when the payload is missing a field or the
  // variable is unset. Four of these existed and two said 3.
  const files = ['src/billing.js', 'src/public/studio-adapter.js', 'src/public/activity-fix.js'];
  const found = [];
  for (const file of files) {
    const source = read(file);
    for (const [, name, value] of source.matchAll(/\b(stripeTrialDays|trialDays)\s*\|\|\s*(\d+)/g)) {
      // `|| 0` is a guard against NaN before arithmetic, not a claim about
      // the product -- it renders no number to anybody.
      if (Number(value) === 0) continue;
      found.push({ file, name, value: Number(value) });
    }
  }
  assert.ok(found.length >= 4, `expected the known fallbacks, found ${found.length}`);
  for (const entry of found) {
    assert.equal(entry.value, declared,
      `${entry.file}: \`${entry.name} || ${entry.value}\` contradicts the ${declared}-day default`);
  }
});

test('the landing pages claim the same number, in digits and in words', () => {
  // The SEO copy is hand-written prose across twenty-two pages -- it cannot
  // read config, so it is the surface most able to drift, and the one a
  // stranger reads before they ever sign up.
  const source = read('src/seo-copy.js');
  const claims = [...source.matchAll(new RegExp(`\\b(${NUMBER})[ -]day\\b(?=[^.]{0,40}\\btrial\\b)`, 'gi'))]
    .map(m => m[1].toLowerCase());
  assert.ok(claims.length >= 8, `expected the trial claims, found ${claims.length}`);
  const want = new Set([String(declared), WORDS[declared]]);
  for (const claim of claims) {
    assert.ok(want.has(claim),
      `src/seo-copy.js says "${claim}-day trial"; the code says ${declared}`);
  }
});

test('nothing else in the customer-facing copy hardcodes a trial length', () => {
  // billing.js, marketing.js and mailer.js all interpolate
  // `config.stripeTrialDays`. A digit typed into one of those sentences is
  // how the header once read "Studio_monthly" -- a value that looks right on
  // the day it is written and silently stops being true.
  for (const file of ['src/billing.js', 'src/marketing.js', 'src/mailer.js']) {
    const source = read(file);
    const claim = new RegExp(`\\b(${NUMBER})[ -]days?\\b(?=[^.]{0,50}\\b(?:free )?trial\\b)`, 'gi');
    for (const [phrase, count] of source.matchAll(claim)) {
      const value = count.toLowerCase();
      // A template hole is the sanctioned way to say it.
      if (/\$\{/.test(phrase)) continue;
      assert.ok(new Set([String(declared), WORDS[declared]]).has(value),
        `${file}: "${phrase.trim()}" hardcodes ${value}, not ${declared}`);
    }
  }
});

test('the design file agrees, so nobody redesigns against the wrong number', () => {
  // Sample data only -- the generated template carries neither string, and a
  // re-import was proven byte-stable across this change. It still matters:
  // it is what anybody opening the design tool reads as the product.
  const design = read('design/studio-dashboard.dc.html');
  assert.ok(design.includes(`per: 'for ${declared} days'`), 'the Basic plan card');
  assert.ok(design.includes(`40 tokens · ${declared} days`), 'the Tokens screen subline');
});
