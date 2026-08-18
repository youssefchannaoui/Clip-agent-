import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-pricing-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'pricing-test-secret-long-enough';

const { config } = await import('../src/config.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

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
