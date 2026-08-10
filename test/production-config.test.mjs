import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-production-config-'));
process.env.AUTH_REQUIRED = 'true';
process.env.APP_SESSION_SECRET = 'short';
process.env.APP_PASSWORD = 'tiny';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'short';
process.env.PROCESSING_MODE = 'local';
process.env.STRIPE_ENABLED = 'true';
process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_placeholder';
process.env.STRIPE_PRICE_WEEKLY = 'price_weekly';
process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
process.env.STRIPE_PRICE_YEARLY = 'price_yearly';
process.env.PLAN_PRICE_MONTHLY_LIST_LABEL = 'A$34.99';
delete process.env.STRIPE_PRICE_TOPUP_100;
delete process.env.STRIPE_PRICE_TOPUP_300;
delete process.env.STRIPE_PRICE_TOPUP_750;
delete process.env.STRIPE_COUPON_MONTHLY;

const { productionConfigurationErrors } = await import('../src/config.js');

test('production readiness refuses weak signing and fallback secrets', () => {
  const errors = productionConfigurationErrors();
  assert.ok(errors.includes('APP_SESSION_SECRET must contain at least 32 characters.'));
  assert.ok(errors.includes('APP_PASSWORD must contain at least 12 characters when the admin password fallback is enabled.'));
  assert.ok(errors.includes('SOCIAL_TOKEN_KEY must contain at least 32 characters when social publishing is enabled.'));
});

test('production readiness refuses incomplete paid checkout configuration', () => {
  const errors = productionConfigurationErrors();
  assert.ok(errors.includes('All token top-up Stripe price IDs are required when Stripe is enabled.'));
  assert.ok(errors.includes('STRIPE_COUPON_MONTHLY is required when a discounted Monthly list price is advertised.'));
});
