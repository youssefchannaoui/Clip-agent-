import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-pricing-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'pricing-test-secret-long-enough';

// Every price configured, so the page renders the buttons rather than the
// "not open for checkout yet" state.
for (const key of ['WEEKLY', 'MONTHLY', 'YEARLY']) {
  process.env['STRIPE_PRICE_' + key] = 'price_' + key.toLowerCase();
  process.env['STRIPE_PRICE_STUDIO_' + key] = 'price_studio_' + key.toLowerCase();
}
const { config } = await import('../src/config.js');
const billing = await import('../src/billing.js');

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const money = label => Number(String(label).replace(/[^0-9.]/g, ''));
const perToken = (label, tokens) => money(label) / tokens;

test('a top-up never costs less per token than the monthly plan', () => {
  // Otherwise the cheapest way to buy is to cancel the subscription and live on
  // packs -- which is what the old prices did: the 750 pack was A$0.033 against
  // the plan's A$0.045. Top-ups are for running out mid-month, so they carry a
  // convenience premium.
  const plan = perToken(config.planPriceMonthlyLabel, config.tokensMonthly);
  for (const [label, tokens] of [
    [config.topupPrice100Label, 100],
    [config.topupPrice300Label, 300],
    [config.topupPrice750Label, 750],
  ]) {
    assert.ok(perToken(label, tokens) > plan,
      `${label} for ${tokens} tokens undercuts the monthly plan at A$${plan.toFixed(4)}/token`);
  }
});

test('a longer commitment is always better value per token', () => {
  const weekly = perToken(config.planPriceWeeklyLabel, config.tokensWeekly);
  const monthly = perToken(config.planPriceMonthlyLabel, config.tokensMonthly);
  const yearly = perToken(config.planPriceYearlyLabel, config.tokensYearly);
  assert.ok(monthly < weekly, 'monthly beats weekly');
  assert.ok(yearly < monthly, 'yearly beats monthly');
});

test('every tier stays under the going rate for a minute of video', () => {
  // Opus Clip is about A$0.15/minute on both paid tiers and bills the same unit
  // (source minutes). Self-hosting Whisper and Ollama is what pays for the gap;
  // if a price ever rises past this, the advantage has been given away.
  const marketRate = 0.15;
  assert.ok(perToken(config.planPriceMonthlyLabel, config.tokensMonthly) < marketRate / 2,
    'the monthly plan should be well under half the market rate');
  for (const [label, tokens] of [
    [config.planPriceWeeklyLabel, config.tokensWeekly],
    [config.topupPrice100Label, 100],
  ]) {
    assert.ok(perToken(label, tokens) <= marketRate, `${label} is above the market rate`);
  }
});

test('the free tier is enough to finish one real lecture', () => {
  // 40 tokens is 40 minutes of source: a full talk, not a teaser. Someone has to
  // be able to reach a finished clip before being asked for money.
  assert.ok(config.tokensFree >= 30, 'a trial that cannot finish a lecture proves nothing');
  assert.ok(config.tokensFree * 1 >= config.minimumTokensToStart * 2);
});

test('the Quran template does not mix a nasheed under the recitation by default', () => {
  // Music is mandatory everywhere else, and that default is right -- but a
  // nasheed playing under recited Quran is not a style choice. The reference
  // clips this template copies have recitation and nothing else.
  const template = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/templates/quran-recitation.json'), 'utf8'));
  assert.equal(template.captionMode, 'quran');
  const adapter = fs.readFileSync(path.join(process.cwd(), 'src/public/studio-adapter.js'), 'utf8');
  assert.match(adapter, /jobTemplateMode === 'quran' \? false/, 'the quran template starts with the nasheed off');
  // It stays a choice: once the operator touches the switch, their answer wins.
  assert.match(adapter, /UI\.jobMusicTouched/);
});

test('nothing is drawn over the top of scripture', () => {
  const template = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/templates/quran-recitation.json'), 'utf8'));
  assert.equal(template.watermarkOpacity, 0, 'no watermark over an ayah');
  assert.equal(template.brandLineEnabled, false);
  assert.equal(template.hookEnabled, false);
  assert.equal(template.captionBackgroundOpacity, 0, 'no box behind the ayah');
  assert.ok(template.vignette <= 0.2, 'a heavy vignette reads as a filter over scripture');
});

test('the plans page groups by tier, with each period priced correctly', () => {
  // Six flat cards put "Pro Weekly" beside "Studio Yearly" as though they were
  // rival products. Three columns, three prices each.
  const page = billing.plansPage(null, {});
  const columns = page.match(/<article class="dc-plan/g) || [];
  assert.equal(columns.length, 3, 'Basic, Pro, Studio');
  assert.match(page, />Basic</);
  assert.match(page, />Pro</);
  assert.match(page, />Studio</);

  // ONE switch for the whole page, not three buttons inside every card.
  assert.equal((page.match(/name="dcperiod"/g) || []).length, 3, 'weekly, monthly, yearly');
  assert.match(page, /id="per-monthly" class="dcperiod" checked/, 'monthly is the default view');
  assert.equal((page.match(/class="period-switch"/g) || []).length, 1, 'one switch, above the grid');
  // It is CSS, not script: this page's CSP admits no inline script, and a
  // radio needs none.
  assert.doesNotMatch(page.slice(page.indexOf('</style>')), /<script/, 'no script on the plans page');

  // Each period's price says the period it charges for. Deriving that label by
  // stripping "ly" once made every WEEKLY price read "a year".
  for (const [cls, amount, each] of [['per-weekly', 'A$9', 'week'], ['per-monthly', 'A$29', 'month'],
                                     ['per-yearly', 'A$290', 'year'], ['per-weekly', 'A$19', 'week'],
                                     ['per-monthly', 'A$59', 'month'], ['per-yearly', 'A$590', 'year']]) {
    assert.ok(page.includes(`<div class="money ${cls}">${amount}<small> / ${each}</small></div>`),
      `${amount} should be charged per ${each}`);
  }
  // And each period carries its own token count and its own checkout form.
  assert.match(page, /<div class="tokens per-yearly"><b>22,000<\/b><span>tokens every year<\/span><\/div>/);
  assert.equal((page.match(/name="plan" value="studio_/g) || []).length, 3, 'a form per period');
  // Studio names what it adds, not what Pro already had.
  assert.match(page, /Everything in Pro, plus:/);
  assert.match(page, /Everything in Basic, plus:/);
});
