import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { journey } from '../src/onboarding.js';

/*
 * The phone's dead gold button, and the screens the shell only FRAMES.
 * Found 4 Sept 2026 by driving the phone shell in a real browser.
 *
 *  1. `studio-mobile.js` rendered the onboarding action button
 *     UNCONDITIONALLY while the desktop guards the identical binding
 *     (`ob.actionLabel ? '<button ...>' : ''`). v3.96.0's deferral rule
 *     empties actionLabel while the blocker banner is up -- which is every
 *     brand-new account, because the banner is "No publishing account
 *     connected" -- so the phone drew a 34x44 SOLID GOLD primary button with
 *     no text, no icon and nothing behind it, on the first screen a new
 *     account sees. A control that cannot do anything must not be shown
 *     (invariant 9).
 *
 *  2. Owner, Help, Arabic & terms and the gated editor are the DESKTOP's own
 *     DOM inside the phone chrome, so their controls arrived at the size a
 *     mouse needs: Owner's range buttons 22x15, its sub-tabs 25px tall, the
 *     blocker banner's buttons 26px -- against the SAME banner at 44px on a
 *     screen the shell owns. v3.81.0's "zero sub-44px targets at 320, 375 and
 *     390" was measured on the owned screens only.
 *
 * The first is tested on EXECUTED OUTPUT -- the mobile template rendered
 * through the real runtime with the real adapter bindings -- because this repo
 * has been caught six times by a source-string test passing against behaviour
 * that changed underneath it. The CSS half has to be a source test: CI has no
 * browser, and this is exactly the rule that is invisible when it goes missing
 * (the app renders, the suite stays green, the buttons just shrink again).
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = rel => fs.readFileSync(path.join(root, rel), 'utf8');

function makeSandbox() {
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, JSON,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: { userAgent: 'test' }, location: { hash: '', search: '' },
    innerWidth: 390,
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src('src/public/studio-runtime.js'), sandbox);
  vm.runInContext(src('src/public/studio-adapter.js'), sandbox);
  vm.runInContext(src('src/public/studio-mobile.js'), sandbox);
  return sandbox;
}

// The onboarding payload is built by the REAL journey() rather than hand-typed,
// so this cannot describe a shape the server stopped sending. An account with
// nothing connected sits on `publish` with action 'connect' -- which is exactly
// the state whose banner triggers the deferral.
const ob = (state, userId) => journey(state, userId);

const STATE = () => ({
  authUsers: [{ id: 'u1', email: 'y@x.com', createdAt: Date.now() - 864e5 }],
  projects: [{ id: 'p1', userId: 'u1', status: 'done', submittedAt: Date.now() - 7200e3 }],
  clips: [{ id: 'c1', userId: 'u1', projectId: 'p1', addedAt: Date.now() - 3600e3,
    approvedAt: Date.now() - 1800e3, status: 'approved' }],
  userSettings: { u1: {} }, socialConnections: {}, musicTracks: {},
});

const DATA = onboarding => ({
  clips: [], projects: [], tracks: [], activity: [],
  social: { providers: {} }, templates: [], clipSettings: {},
  user: { name: 'Yusuf Ali', email: 'y@x.com', role: 'creator' },
  billing: { current: { planName: 'Basic', plan: 'free', tokens: 40, features: {} }, plans: [] },
  postTimes: ['09:00', '12:00', '17:00', '20:00'], emailNotifs: true,
  onboarding,
});

// Render Home with onboarding.actionLabel forced to `label`, through the real
// runtime. Returns the rendered HTML.
function homeHtml(sandbox, label) {
  const A = sandbox.StudioAdapter;
  A.ui.screen = 'home'; A.ui.menuOpen = false; A.ui.bellOpen = false;
  const j = ob(STATE(), 'u1');
  assert.equal(j.show, true, 'the strip is showing for this account');
  const data = DATA(j);
  const vals = A.bindings(data);
  assert.ok(vals.onboarding && vals.onboarding.show, 'the onboarding binding is showing');
  vals.onboarding.actionLabel = label;
  const mv = sandbox.StudioMobile.vals(vals, data);
  const R = new sandbox.StudioRuntime._internals.Renderer();
  const out = [];
  R.render(sandbox.StudioMobile.template(), mv, out);
  return out.join('');
}

// A primary button with nothing at all between its tags.
const EMPTY_PRIMARY = /<button[^>]*class="dcm-btn dcm-btn-p"[^>]*><\/button>/;

test('the phone draws no primary button while the strip is deferring to the banner', () => {
  const sandbox = makeSandbox();
  const html = homeHtml(sandbox, '');
  assert.ok(!EMPTY_PRIMARY.test(html),
    'an EMPTY gold primary button reached the phone Home -- invariant 9: a control '
    + 'that cannot do anything must not be shown');
});

test('...and it comes back the moment there is something to label it with', () => {
  const sandbox = makeSandbox();
  const html = homeHtml(sandbox, 'Connect an account');
  assert.ok(html.includes('>Connect an account<'),
    'the guard removed the button outright instead of deferring -- a fix that always '
    + 'hides it is worse than the bug it replaces');
  assert.ok(!EMPTY_PRIMARY.test(html), 'and it is still never empty');
});

test('the framed screens raise the desktop control sizes to a finger', () => {
  const css = src('src/public/studio-mobile.css');
  const framed = 'body.dcm-on:not(.dcm-own)';
  for (const sel of [
    framed + ' #studio main button',
    framed + ' #studio main select',
    framed + ' #studio main input',
    framed + ' #studio main a[href]',
    framed + ' #dcBlocker button',
  ]) assert.ok(css.includes(sel), 'the framed-screen rule lost: ' + sel);
  assert.match(css, /body\.dcm-on:not\(\.dcm-own\)[\s\S]{0,400}?min-height:\s*44px/,
    'the framed controls no longer reach 44px');
  assert.match(css, /body\.dcm-on:not\(\.dcm-own\)[\s\S]{0,400}?min-width:\s*44px/,
    'the framed controls no longer reach 44px wide');
  // A 19px text field cannot be typed into; the two pronunciation fields on
  // Arabic & terms measured exactly that at 320.
  assert.match(css, /input\[type="text"\][\s\S]{0,160}?min-width:\s*108px/,
    'the framed text fields lost their floor');
});

test('the nasheed play button is a tap target, and the month cell clears 44 in the 360 band', () => {
  const css = src('src/public/studio-mobile.css');
  const track = css.match(/\.dcm-track-p\s*\{[^}]*\}/);
  assert.ok(track, '.dcm-track-p still exists');
  assert.match(track[0], /width:\s*44px/, 'the nasheed play button went back under 44');
  assert.match(track[0], /height:\s*44px/, 'the nasheed play button went back under 44');

  // Seven cells plus six 2px gaps inside the card: at 360 a 4px card padding
  // put every cell at 43.43px -- a pixel short, in a band 320/375/390/430 all
  // miss. Swept every pixel 320..430 after the change: none under 44.
  const band = css.slice(css.indexOf('@media (max-width: 389px)'));
  const month = band.match(/\.dcm-month\s*\{[^}]*\}/);
  assert.ok(month, 'the 389 band still sizes the month card');
  assert.doesNotMatch(month[0], /padding:\s*10px 4px 8px/,
    'the month card is back to 4px of side padding, which puts its cells at 43.4px at 360');
});
