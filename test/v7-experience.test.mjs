import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/public/studio-v6.css', import.meta.url), 'utf8');
const visualSource = `${ui}\n${css}`;

function functionBody(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must remain a named application hook`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${name} must have a complete implementation body`);
}

function cssMediaBlock(source, marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `${marker} breakpoint must remain present`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}' && --depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`${marker} breakpoint must have a complete CSS block`);
}

// These tests deliberately assert the boundaries of the V7 visual release,
// rather than pixel-level implementation details. The dashboard can continue
// to evolve without losing the behaviours that make it a usable product.

test('V7 keeps the working editor and the established publishing/settings renderers', () => {
  for (const hook of [
    'openEditor', 'ensureEditor', 'saveEditorDraft', 'undoEditor', 'redoEditor',
    'renderPublishingWorkspace', 'renderSettingsPage'
  ]) {
    assert.match(ui, new RegExp(`function\\s+${hook}\\s*\\(`), `${hook} must remain a callable application hook`);
  }
  assert.match(ui, /dc-editor-route/, 'the editor must remain a dedicated fixed workspace route');
  assert.match(ui, /dc-editor-panel-collapsed/, 'the editor’s preview-widening collapse affordance must remain');
});

test('V7 has one identifiable shell and a first-class screen surface for every dashboard destination', () => {
  assert.match(ui, /dc-v7-shell/, 'the redesigned shell must be independently addressable');
  for (const screen of [
    'home', 'projects', 'review', 'channels', 'brand', 'director', 'audio',
    'insights', 'admin', 'subscription', 'templates'
  ]) {
    assert.match(ui, new RegExp(`dc-v7-${screen}`), `V7 ${screen} needs a scoped screen class`);
  }
});

test('the global activity dock uses a durable job key and has one binding path', () => {
  assert.match(ui, /(?:function\s+globalActivityDockKey\s*\(|(?:const|let)\s+globalActivityDockKey\s*=)/,
    'a job identity must not change when only its stage/progress changes');
  assert.match(ui, /(?:data-work-key|dataset\.workKey)/, 'dismissal state must be tied to the stable job key');
  assert.match(ui, /function\s+bindWorkDock\s*\(/, 'the dock needs a single dedicated interaction binder');

  const dockStart = ui.indexOf('function paintWork(');
  const dockEnd = ui.indexOf('\nfunction ', dockStart + 10);
  assert.ok(dockStart >= 0 && dockEnd > dockStart, 'paintWork must have a bounded implementation');
  const dockBody = ui.slice(dockStart, dockEnd);
  assert.ok((dockBody.match(/bindWorkDock\s*\(/g) || []).length <= 1,
    'paintWork must not bind the same dock controls more than once per render');
});

test('onboarding has a short global journey and separate first-visit page tours', () => {
  assert.match(ui, /TOURS_BY_VIEW\s*=/, 'page tours must be defined as a view-keyed registry');
  assert.match(ui, /function\s+openViewTour\s*\(/, 'every page needs a reusable tour launcher');
  assert.match(ui, /guided_demo/, 'the short new-user global tour needs persisted completion state');
  assert.match(ui, /(?:openViewTour|openPageTour)\(currentView/,
    'the account menu should replay help for the page currently open');
});

test('V7 feature labels are a billing-derived registry, not manually scattered Pro labels', () => {
  assert.match(ui, /DC_V7_FEATURES\s*=/, 'feature presentation needs a single V7 registry');
  assert.match(ui, /billingInfo\(\).*features|billingInfo\(\)\.features/s,
    'the V7 registry/gating code must consume authoritative billing features');
  assert.match(ui, /data-premium-feature/, 'gated UI must expose its entitlement key to the shared shell');
});

test('V7 layout protects the viewport and honours reduced-motion preferences', () => {
  assert.match(visualSource, /dc-v7-shell/, 'the visual shell needs an explicit V7 scope');
  assert.match(visualSource, /overflow-x\s*:\s*hidden/,
    'the dashboard must prevent accidental horizontal page scrolling');
  assert.match(visualSource, /@media\s*\(prefers-reduced-motion\s*:\s*reduce\)/,
    'ambient dashboard motion must respect the operating-system preference');
  assert.match(visualSource, /@media\s*\(max-width/,
    'V7 screens need a responsive breakpoint rather than relying on desktop scaling');
});

test('Template Shop contracts are asserted when the V7 shop UI is present', t => {
  if (!/dc-v7-template-shop/.test(ui)) {
    t.skip('Template Shop UI has not landed in this source revision yet');
    return;
  }
  assert.match(ui, /data-template-shop-action/, 'shop cards need explicit, testable user actions');
  assert.match(ui, /template-shop|templateShop/i, 'shop UI must use its dedicated shop data/action path');
  assert.match(ui, /Customize|customize/, 'shop templates must offer the safe-copy customisation path');
});

test('Template Shop is a normal scrolling marketplace, while My Templates stays fitted', () => {
  // The template editor deliberately keeps its preview fixed and puts overflow
  // on its own controls. A shop catalog is different: hiding its container
  // turns lower cards and their purchase/customise actions into unreachable
  // content on a desktop viewport.
  assert.match(ui, /templateWorkspaceTab\s*===\s*'shop'/,
    'Templates needs an explicit Shop branch');
  assert.match(ui, /dc-v7-template-shop/, 'the Shop has a dedicated surface');
  assert.match(ui, /view==='templates'&&templateWorkspaceTab==='shop'[^\n]*classList\.remove\('dc-templates-route'\)/,
    'the fixed editor route must be removed while the scrolling Shop is open');
});

test('customising a Shop template restores the fitted My Templates editor before rendering it', () => {
  const customizeStart = ui.indexOf("if(action==='customize')");
  const previewStart = ui.indexOf("if(action==='preview')", customizeStart);
  assert.ok(customizeStart >= 0 && previewStart > customizeStart,
    'the Customize action needs an isolated implementation branch');

  const customizeBody = ui.slice(customizeStart, previewStart);
  assert.match(customizeBody, /templateWorkspaceTab='mine';\s*syncTemplateRouteMode\(\);\s*renderTemplatesPage\(\)/,
    'Customize must restore the fitted My Templates route before rendering the copied template');
});

test('AI Director exposes the approved V7 intelligence map without pretending unavailable data exists', () => {
  for (const label of ['Hook AI', 'Retention AI', 'Title AI', 'Trend AI', 'Audience AI', 'Posting AI']) {
    assert.match(ui, new RegExp(label), `${label} needs a visible, honest status card`);
  }
  for (const label of ['Viral potential', 'Hooks', 'Titles & captions', 'Trends', 'Audience', 'Posting']) {
    assert.match(ui, new RegExp(label), `${label} needs a discoverable Director mode`);
  }
  assert.match(ui, /Grounded in your transcripts/, 'Director claims must stay anchored to input it actually has');
  assert.match(ui, /nothing I suggest is made up/, 'unavailable intelligence must not become fabricated advice');
});

test('client token purchases use only the dedicated top-up checkout endpoint', () => {
  const checkout = functionBody(ui, 'startTopupCheckout');
  assert.match(checkout, /callApi\(\s*'\/api\/billing\/topup-checkout'/,
    'a client top-up must create its checkout session through /api/billing/topup-checkout');
  assert.doesNotMatch(checkout, /callApi\(\s*'\/api\/billing\/topup'(?:\s|,|\))/,
    'the retired /api/billing/topup endpoint must never be used by the client');
});

test('the token shop disables purchasing whenever billing says top-ups are unavailable', () => {
  const subscription = functionBody(ui, 'renderSubscriptionPage');
  assert.match(subscription, /(?:topup\w*(?:available|enabled)|can\w*topup\w*)/i,
    'the Subscription screen needs an explicit billing-derived top-up availability value');
  for (const state of ['unlimited', 'past_due', 'expired']) {
    assert.match(subscription, new RegExp(state, 'i'),
      `top-up availability must consider ${state.replace('_', ' ')} accounts`);
  }
  const cardsStart = subscription.indexOf('const topupCards=');
  const cardsEnd = subscription.indexOf('panel.innerHTML=', cardsStart);
  assert.ok(cardsStart >= 0 && cardsEnd > cardsStart, 'top-up card rendering must remain bounded');
  const cards = subscription.slice(cardsStart, cardsEnd);
  assert.match(cards, /data-sub-topup[\s\S]*disabled/,
    'top-up cards must expose a disabled state rather than keeping an unavailable checkout CTA live');
  assert.match(cards, /pack\.enabled[\s\S]{0,120}(?:topup\w*(?:available|enabled)|can\w*topup\w*)|(?:topup\w*(?:available|enabled)|can\w*topup\w*)[\s\S]{0,120}pack\.enabled/i,
    'configured packs must additionally be gated by account-level top-up availability');
});

test('Channels describes the actual approval mode instead of making an unconditional manual-review promise', () => {
  const channels = functionBody(ui, 'renderConnections');
  assert.doesNotMatch(channels, /Nothing leaves the studio until you approve it\./,
    'Channels cannot promise manual approval when the workspace can enable automation');
  assert.match(channels, /(?:automationSettings|skipReviewRequired|reviewRequired|approval\w*copy)/,
    'Channels must derive its approval explanation from the workspace automation settings');
});

test('a failed channel health check overrides a green enabled badge', () => {
  const badge = functionBody(ui, 'providerBadge');
  const errorIndex = badge.indexOf('lastTestError');
  const enabledIndex = badge.indexOf('info.enabled');
  assert.ok(errorIndex >= 0 && enabledIndex >= 0 && errorIndex < enabledIndex,
    'providerBadge must report a test error before considering the enabled/green state');
  assert.match(badge, /lastTestError[\s\S]{0,100}['"]bad['"]/,
    'a connection with a known test error needs the error badge tone');
});

test('mobile Insights keeps its metrics as a grid and V7 controls meet the 44px touch target', () => {
  const mobile = cssMediaBlock(css, '@media(max-width:640px)');
  assert.match(mobile, /\.dc-v7-insights\s+\.dc-studio-strip\s*\{[^}]*display\s*:\s*grid/,
    'Insights metrics must explicitly stay a grid on mobile instead of inheriting a fragile display mode');
  assert.match(mobile, /body\.dc-v7-shell[\s\S]{0,240}\.dc-btn[^}]*min-height\s*:\s*44px/,
    'primary V7 controls must meet the 44px minimum touch target on mobile');
});
