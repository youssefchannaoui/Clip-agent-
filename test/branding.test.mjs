import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-branding-'));

const billing = await import('../src/billing.js');
const store = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

function user(id, plan = 'free', role = 'creator') {
  return {
    id, role, email: `${id}@deenclipped.test`, createdAt: Date.now(),
    billing: { plan, status: plan === 'free' ? 'free' : 'active', tokensUsed: 0, tokensReserved: 0 },
  };
}

const baseTemplate = {
  id: 'brand-test', name: 'Brand test', watermark: '', watermarkOpacity: 0,
  watermarkPosition: 'bottom-right', watermarkColor: '#FFFFFF', brandLineEnabled: false,
};

test('free accounts always render with the DeenClipped watermark', () => {
  const free = user('free-brand');
  store.state.authUsers = [free];
  store.setBrandSettings(free, { watermarkEnabled: false, watermarkText: 'HIDDEN', watermarkOpacity: 10 });
  const rendered = engine.effectiveTemplateForUser(free, baseTemplate);
  assert.equal(billing.featureAccess(free).watermarkRequired, true);
  assert.equal(rendered.watermark, 'DEENCLIPPED');
  assert.ok(rendered.watermarkOpacity >= 72);
  assert.equal(rendered.watermarkPosition, 'top-center');
  assert.equal(rendered.watermarkColor, '#D9B478');
  assert.equal(rendered.watermarkRequired, true);
});

test('weekly unlocks branding while AI Director begins on monthly', () => {
  const weekly = user('weekly-features', 'weekly');
  const monthly = user('monthly-features', 'monthly');
  assert.equal(billing.featureAccess(weekly).customBranding, true);
  assert.equal(billing.featureAccess(weekly).creatorLab, false);
  assert.equal(billing.featureAccess(weekly).batchPublishing, false);
  assert.equal(billing.featureAccess(monthly).creatorLab, true);
  assert.equal(billing.featureAccess(monthly).batchPublishing, true);
});

test('paid accounts can switch the watermark off', () => {
  const paid = user('paid-brand', 'monthly');
  store.state.authUsers = [paid];
  store.setBrandSettings(paid, { watermarkEnabled: false, watermarkText: 'MY STUDIO' });
  const rendered = engine.effectiveTemplateForUser(paid, baseTemplate);
  assert.equal(billing.featureAccess(paid).canRemoveWatermark, true);
  assert.equal(rendered.watermark, '');
  assert.equal(rendered.watermarkRequired, false);
});

test('paid Brand Kit values are applied to every render template', () => {
  const paid = user('custom-brand', 'yearly');
  store.state.authUsers = [paid];
  store.setBrandSettings(paid, {
    watermarkEnabled: true, watermarkText: 'MY DEEN STUDIO', watermarkPosition: 'top-left',
    watermarkColor: '#12AB34', watermarkOpacity: 64, brandLineEnabled: true, brandLineColor: '#654321',
  });
  const rendered = engine.effectiveTemplateForUser(paid, baseTemplate);
  assert.equal(rendered.watermark, 'MY DEEN STUDIO');
  assert.equal(rendered.watermarkPosition, 'top-left');
  assert.equal(rendered.watermarkColor, '#12AB34');
  assert.equal(rendered.watermarkOpacity, 64);
  assert.equal(rendered.brandLineEnabled, true);
  assert.equal(rendered.brandLineColor, '#654321');
});

test('the product UI includes Brand Kit and AI Director as first-class screens', () => {
  const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
  assert.match(ui, /\['brand','Brand Kit','brand','PRO'\]/);
  assert.match(ui, /\['lab','AI Director','lab','PRO'\]/);
  assert.match(ui, /function renderBrandKit\(\)/);
  assert.match(ui, /function renderCreatorLab\(\)/);
  assert.match(ui, /Free exports are branded/);
  assert.match(ui, /AI language & growth profile/);
  assert.match(ui, /Names and specialist vocabulary/);
  assert.match(ui, /Explainable intelligence/);
  assert.match(ui, /Copy post pack/);
});

test('production releases two remote jobs while the worker serialises heavy AI work', () => {
  const render = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
  const compose = fs.readFileSync(new URL('../worker/docker-compose.yml', import.meta.url), 'utf8');
  assert.match(render, /key: MAX_CONCURRENT_JOBS\s+value: "2"/);
  assert.match(compose, /WORKER_MAX_CONCURRENT_JOBS: "2"/);
  assert.match(compose, /WORKER_MAX_HEAVY_JOBS: "1"/);
  assert.match(compose, /mem_limit: 3500m/);
});

test('subscription is a first-class account screen with real billing actions', () => {
  const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
  assert.match(ui, /\['subscription','Subscription','billing'\]/);
  assert.match(ui, /function renderSubscriptionPage\(\)/);
  assert.match(ui, /Billing & payment/);
  assert.match(ui, /Add tokens without changing your plan/);
  assert.match(ui, /\/api\/billing\/portal/);
  assert.match(ui, /\/api\/billing\/topup/);
});

test('the token chooser shows every real plan together without period tabs', () => {
  const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
  assert.match(ui, /const sortPlans=\['free','weekly','monthly','yearly'\]/);
  assert.match(ui, /Every option, side by side\./);
  assert.match(ui, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(ui, /data-billing-tab=/);
  assert.doesNotMatch(ui, /role="tabpanel"/);
  assert.doesNotMatch(ui, /\$\{id==='monthly'\?'':'hidden'\}/);
});

test('first-run onboarding is account-scoped and explains free publishing limits', () => {
  const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
  const legacy = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(ui, /seenGet\('guided_demo','complete'\)/);
  assert.match(ui, /seenSet\('guided_demo','complete'\)/);
  assert.doesNotMatch(ui, /dc-guided-demo-complete/);
  assert.match(ui, /Your 3-day trial wallet/);
  assert.match(ui, /social posting unlocks with Premium/i);
  assert.match(legacy, /function maybeOpenTour\(\)\{\}/);
});

test('publishing keeps a complete command-centre layout', () => {
  const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
  assert.match(ui, /Publishing command centre/);
  assert.match(ui, /Live publishing queue/);
  assert.match(ui, /data-publish-tab="slots">Slots/);
  assert.doesNotMatch(ui, /data-publish-tab="scheduled"/);
  assert.match(ui, /Open posting slot/);
  assert.match(ui, /data-publish-slot-days/);
  assert.match(ui, /Approve a clip and it moves straight into the next open slot/);
  assert.match(ui, /Platform connections/);
  assert.match(ui, /Quick preview/);
  assert.match(ui, /dc-publish-next-media/);
  assert.match(ui, /nextClip\.thumbUrl/);
  assert.match(ui, /formatDuration\(nextClip\.durationMs\)/);
  assert.match(ui, /Your publishing queue is clear/);
  assert.match(ui, /Publishing unlocks with Premium/);
  assert.match(ui, /data-open-billing/);
  assert.doesNotMatch(ui, /ICON\.calendar/);
});
