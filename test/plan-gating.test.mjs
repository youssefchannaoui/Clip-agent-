import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-plans-'));
process.env.DATA_DIR = dataDir;
const templates = await import('../src/templates.js');

const user = { id: 'user_plan_test' };

// ── which templates belong to which plan ──────────────────────────────────
//
// Free gets the default style and the DeenClipped watermark; everything else
// in the catalogue is Pro. The flag is shipped in the template file, so it can
// only be changed by shipping a new one.

test('the default template is the free one and the rest are Pro', () => {
  const list = templates.listTemplates(user);
  const free = list.filter(t => !t.pro).map(t => t.id);
  assert.deepEqual(free, ['clean-line'], 'exactly one free style, and it is the default');
  assert.ok(list.filter(t => t.pro).length >= 3, 'the rest are Pro');
});

test('an account edit cannot move a template onto the free plan', () => {
  // Save writes a patch over the shipped file. If `pro` travelled in that
  // patch, editing a Pro template would unlock it for free.
  templates.saveTemplate(user, 'bold-stack', { pro: false, captionFontSize: 150 });
  const after = templates.templateById('bold-stack', user);
  assert.equal(after.pro, true, 'still Pro');
  assert.equal(after.captionFontSize, 150, 'but the actual edit did save');
});

test('a per-clip override cannot move a template onto the free plan either', () => {
  const base = templates.templateById('headline', user);
  const merged = templates.templateForClip(base, { pro: false, captionFontSize: 120 });
  assert.equal(merged.pro, true);
  assert.equal('pro' in templates.sanitiseClipStyle({ pro: false }), false,
    'pro is not a style field at all');
});

test('a custom template is never Pro', () => {
  // Only built-ins carry the flag; a fork could otherwise declare itself.
  const forged = templates.sanitiseTemplate({ name: 'Mine', pro: true }, { id: 'mine', builtIn: false });
  assert.equal(forged.pro, false);
});


// ── core work stays free ───────────────────────────────────────────────────
//
// Decided 23 Aug 2026: "all scheduling and automation of course should work on
// free, all core work should work." Publishing is the point of the product --
// gating it sells nothing and teaches nobody what DeenClipped is for. And
// capping clips per lecture would protect nothing: tokens are charged per
// source MINUTE, so ten clips from one lecture cost exactly what three do.
//
// These tests read the source. That is deliberate: the rule is about what the
// code is ALLOWED to gate, and the failure they exist to catch is somebody
// adding a gate later, in good faith, somewhere else.

const billing = await import('../src/billing.js');
const src = url => fs.readFileSync(new URL(url, import.meta.url), 'utf8');

test('the feature table is exactly what each tier is sold on', () => {
  // One table, asserted whole. Every entry here is something a customer is
  // told they get; a key added without a gate, or gated without being sold,
  // fails on this line.
  assert.deepEqual(Object.keys(billing.FEATURES).sort(),
    ['deenai', 'deenaiAsk', 'extraSlots', 'multiChannel', 'priorityRender', 'templates', 'watermark']);
  assert.deepEqual(Object.keys(billing.PRO_FEATURES).sort(), ['deenai', 'templates', 'watermark']);
  assert.deepEqual(Object.keys(billing.STUDIO_FEATURES).sort(), ['deenaiAsk', 'extraSlots', 'multiChannel', 'priorityRender']);
});

test('the tiers are cumulative, and Basic is sold nothing', () => {
  const basic = billing.featuresForTier('basic');
  const pro = billing.featuresForTier('pro');
  const studio = billing.featuresForTier('studio');
  assert.ok(Object.values(basic).every(on => on === false), 'Basic is the trial, not a feature set');
  for (const key of Object.keys(billing.FEATURES)) {
    assert.ok(!pro[key] || studio[key], `Studio must include everything Pro has (${key})`);
  }
  assert.equal(pro.deenai, true, 'Pro keeps the insights it shipped with');
  assert.equal(pro.deenaiAsk, false, 'asking is what Studio adds');
  assert.equal(studio.deenaiAsk, true);
});

test('the three original plan ids still mean Pro at that period', () => {
  // They are in Stripe's metadata and on every current subscriber's record.
  // Dropping them would move paying customers onto the free plan.
  assert.equal(billing.normalisePlanId('monthly'), 'pro_monthly');
  assert.equal(billing.normalisePlanId('weekly'), 'pro_weekly');
  assert.equal(billing.normalisePlanId('yearly'), 'pro_yearly');
  assert.equal(billing.normalisePlanId('studio_yearly'), 'studio_yearly');
  assert.equal(billing.normalisePlanId('free'), 'free');
  const grid = billing.plans();
  for (const id of billing.PLAN_ORDER) assert.ok(grid[id], `${id} is missing from the grid`);
  assert.equal(billing.PLAN_ORDER.length, 6, 'three tiers is two paid tiers times three periods');
});

test('a paid tier and the operator role are different questions', () => {
  // The operator has every feature and must never be locked out of their own
  // product -- but their imports must not preempt a paying customer's on the
  // one worker slot, which is what paidTierOf exists to separate.
  const operator = { id: 'op', role: 'owner', billing: { plan: 'free' } };
  assert.equal(billing.tierOf(operator), 'studio');
  assert.equal(billing.paidTierOf(operator), 'basic');
  assert.equal(billing.paysForAtLeast(operator, 'studio'), false);
  const customer = { id: 'c', role: 'creator', billing: { plan: 'studio_monthly' } };
  assert.equal(billing.paidTierOf(customer), 'studio');
  assert.equal(billing.paysForAtLeast(customer, 'studio'), true);
});

test('a free account is told what it already has', () => {
  const includes = billing.FREE_INCLUDES.join(' ').toLowerCase();
  for (const promise of ['publishing', 'scheduling', 'automation', 'as many clips', 'editor']) {
    assert.ok(includes.includes(promise), `the free plan should still promise ${promise}`);
  }
});

test('every plan gate in the app is one of the listed features', () => {
  // isPaid() is the only way to gate on a plan. Each call site is named here
  // with what it guards; a new one fails this test until it is either removed
  // or argued for in PRO_FEATURES.
  const allowed = new Map([
    ['src/server.js', ['assertWatermarkAllowed', 'assertTemplateAllowed']],
    ['src/local-engine.js', ['enforceWatermarkPlan', 'enforceTemplatePlan']],
    // planFeatures derives from the FEATURES table now rather than asking
    // isPaid, so billing.js should hold NO plan gate of its own -- kept in the
    // map at zero so a new one there still fails this test.
    ['src/billing.js', []],
  ]);
  for (const [file, guards] of allowed) {
    const text = src(`../${file}`);
    // The lookbehind skips the declaration itself in billing.js.
    const calls = (text.match(/(?<!function )(?:billing\.)?isPaid\(/g) || []).length;
    assert.equal(calls, guards.length,
      `${file} has ${calls} plan gates but ${guards.length} are accounted for: ${guards.join(', ')}`);
  }

  // Tier comparisons are the newer gate primitive and are allowlisted the same
  // way: a new call site fails this until it is argued for here.
  const tierGates = new Map([
    ['src/deenai.js', ['deenaiAccess', 'deenaiAskAccess']],
    ['src/agent.js', ['scheduleApprovedClip picks the tier\'s posting windows']],
    ['src/local-engine.js', ['queuePriority ranks the render queue']],
  ]);
  for (const [file, guards] of tierGates) {
    const text = src(`../${file}`);
    const calls = (text.match(/billing\.(?:atLeast|paysForAtLeast)\(/g) || []).length;
    assert.equal(calls, guards.length,
      `${file} has ${calls} tier gates but ${guards.length} are accounted for: ${guards.join(', ')}`);
  }
  // And nowhere else reaches for it at all.
  for (const file of ['src/social.js', 'src/agent.js', 'src/slots.js', 'src/backgrounds.js', 'src/uploads.js']) {
    assert.doesNotMatch(src(`../${file}`), /isPaid\(/,
      `${file} is core work and must not be gated on a plan`);
  }
});


// ── the job picker always has something to fall back to ────────────────────
//
// The "Islamic lecture" button used to select mono-minimal by name. That was
// fine until the catalogue was tiered and mono-minimal became Pro -- from then
// on, a free account pressing the lecture button selected a style the server
// refused, with nothing on screen explaining it. The button now takes the
// first style the account is entitled to, which is only safe while one exists.

const { config } = await import('../src/config.js');

test('there is always a free lecture style for the picker to land on', () => {
  const usable = templates.listTemplates(user)
    .filter(t => !t.pro && t.captionMode !== 'quran');
  assert.ok(usable.length >= 1,
    'a free account pressing "Islamic lecture" must land on a style it can use');
});

test('the shipped default template is itself free', () => {
  // Anything else means a brand new account opens on a style it cannot render,
  // which is the same bug one step earlier.
  const fallback = templates.templateById(config.defaultTemplateId, user);
  assert.ok(fallback, `defaultTemplateId "${config.defaultTemplateId}" must exist`);
  assert.equal(fallback.pro, false, 'the default template cannot be Pro');
});

test('the Quran style is reachable by the id the picker asks for', () => {
  // The recitation button asks for 'quran-recitation' by name; renaming the
  // file would leave the button pointing at nothing.
  assert.ok(templates.templateById('quran-recitation', user));
});
