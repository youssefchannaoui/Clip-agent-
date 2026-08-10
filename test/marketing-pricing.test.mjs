import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-marketing-'));
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.STRIPE_PRICE_WEEKLY = 'price_w';
process.env.STRIPE_PRICE_MONTHLY = 'price_m';
process.env.STRIPE_PRICE_YEARLY = 'price_y';
process.env.STRIPE_PRICE_TOPUP_100 = 'p1';
process.env.STRIPE_PRICE_TOPUP_300 = 'p3';
process.env.STRIPE_PRICE_TOPUP_750 = 'p7';
process.env.PLAN_PRICE_WEEKLY_LABEL = 'A$9.99';
process.env.PLAN_PRICE_MONTHLY_LABEL = 'A$29.99';
process.env.PLAN_PRICE_MONTHLY_LIST_LABEL = 'A$34.99';
process.env.PLAN_PRICE_YEARLY_LABEL = 'A$249';
process.env.FREE_TIER_DAYS = '3';

const marketing = await import('../src/marketing.js');

const page = () => marketing.pricing({ base: 'https://deenclipped.online', currentUser: null });

test('the public page drops the developer scaffolding copy', () => {
  // "Prices remain configuration-driven until the final Stripe products are
  // confirmed" was showing to anyone deciding whether to trust us with a card.
  assert.ok(!page().includes('configuration-driven'));
});

test('"Most popular" is claimed once across the whole page', () => {
  const html = page();
  assert.equal((html.match(/Most popular/g) || []).length, 1);
  assert.ok(html.includes('Best seller'), 'the 300 pack needs its own label');
});

test('monthly shows the struck-through list price', () => {
  const html = page();
  assert.ok(html.includes('<s>A$34.99</s>'));
  assert.ok(html.includes('A$29.99'));
});

test('yearly is anchored with a per-month equivalent and savings badge', () => {
  const html = page();
  assert.ok(html.includes('A$20.75 a month'));
  assert.ok(html.includes('Save 31%'));
});

test('every paid card carries a per-minute rate', () => {
  const html = page();
  assert.ok(html.includes('13.3c per source minute'), 'weekly');
  assert.ok(html.includes('7.5c per source minute'), 'monthly');
  assert.ok(html.includes('5.2c per source minute'), 'yearly');
});

test('the free card advertises the same window the app enforces', () => {
  // Promising an open-ended free tier that dies after 3 days generates refunds.
  assert.ok(page().includes('free for 3 days'));
});

test('pricing explains the watermark and premium creator tools', () => {
  const html = page();
  assert.ok(html.includes('DeenClipped watermark on exports'));
  assert.ok(html.includes('Remove or customise the watermark'));
  assert.ok(html.includes('AI Director intelligence'));
  assert.ok(html.includes('Batch scheduling and publishing'));
});

test('the features page includes Brand Kit and AI Director', () => {
  const html = marketing.features({ base: 'https://deenclipped.online', currentUser: null });
  assert.ok(html.includes('<h3>Brand Kit</h3>'));
  assert.ok(html.includes('<h3>AI Director</h3>'));
});

test('savings maths follows configuration rather than hardcoded numbers', async () => {
  const { config } = await import('../src/config.js');
  const original = config.planPriceYearlyLabel;
  config.planPriceYearlyLabel = 'A$180';
  try {
    // A$180/12 = A$15.00 vs A$29.99 => 50%
    const html = page();
    assert.ok(html.includes('A$15.00 a month'));
    assert.ok(html.includes('Save 50%'));
  } finally {
    config.planPriceYearlyLabel = original;
  }
});
