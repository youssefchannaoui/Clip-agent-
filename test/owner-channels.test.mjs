import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * THE OPERATOR'S THREE CHANNELS REACH THE SCHEDULE, and nobody else's do.
 *
 * Youssef, 8 Sept 2026: "for my specific email ... give permission to have
 * three accounts for each social media, so then I can post more, but only for
 * me and state it as a beta testing just for owner ... the whole, like,
 * schedule thing should be different for me because then I would be able to
 * post to more than one account. But, again, only for me, for nobody else
 * ever until I give you the word."
 *
 * v3.158.0 gave the operator the ALLOWANCE. Measured before this release, with
 * three YouTube channels connected: every clip went to all three, so all three
 * lanes were busy and six clips took six different slots. Per-channel slots
 * (v3.115.0) bought nothing, because nothing ever occupied one lane alone --
 * three channels meant the SAME clip three times, which is not posting more.
 *
 * Everything here is gated on `accountsPerPlatform > 1`, which is 1 for every
 * customer, so none of it can resurrect the multi-channel schedule v3.125.0
 * retired for being confusing. That is the law `one-channel.test.mjs` holds;
 * this file holds the operator's exception.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-owner3-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const store = await import('../src/store.js');
const billing = await import('../src/billing.js');
const social = await import('../src/social.js');
const agent = await import('../src/agent.js');
const { state } = store;

const uid = 'u_owner';
const tok = { access_token: 'a', expiry: Date.now() + 9e6, refresh_token: 'r' };
function seed({ shareOut }) {
  state.authUsers = [{ id: uid, email: 'owner@deenclipped.test', role: 'owner' }];
  state.socialConnections = { [uid]: { youtube: [
    { provider: 'youtube', accountId: 'y1', name: 'Main', tokens: tok },
    { provider: 'youtube', accountId: 'y2', name: 'Shorts', tokens: tok },
    { provider: 'youtube', accountId: 'y3', name: 'Arabic', tokens: tok },
  ] } };
  state.userSettings = { [uid]: { publishingSettings: {
    enabled: true, shareOut,
    youtube: { enabled: true, accountId: 'y1', accountIds: ['y1', 'y2', 'y3'] },
    tiktok: { enabled: false }, instagram: { enabled: false }, facebook: { enabled: false },
  } } };
  state.projects = [{ id: 'p1', userId: uid }];
  state.clips = [];
  for (let i = 1; i <= 6; i += 1) {
    state.clips.push({ id: 'c' + i, userId: uid, projectId: 'p1', title: 'Clip ' + i, addedAt: i,
      status: 'approved', approvedAt: Date.now(), approvedBy: 'manual', targets: [],
      musicVerified: true, renderVerified: true, templateId: 'clean-line' });
  }
  state.log = [];
  for (const clip of state.clips) agent.scheduleApprovedClip(clip);
  return state.clips;
}

test('mirroring is the default, and it sends every clip to all three', () => {
  // Turning share-out on silently would reroute an account's posts the moment
  // it deployed, and where somebody's content goes is their decision.
  assert.equal(store.settingDefaults().publishingSettings.shareOut, false);
  const clips = seed({ shareOut: false });
  for (const clip of clips) {
    assert.deepEqual(clip.targets.map(t => t.id), ['youtube:y1', 'youtube:y2', 'youtube:y3']);
  }
  // And so six clips need six windows: every lane is busy on every slot.
  assert.equal(new Set(clips.map(c => c.scheduledAt)).size, 6);
});

test('sharing out gives each clip ONE channel, so the day holds three times as many', () => {
  const clips = seed({ shareOut: true });
  assert.deepEqual(clips.map(c => c.targets.map(t => t.id).join()),
    ['youtube:y1', 'youtube:y2', 'youtube:y3', 'youtube:y1', 'youtube:y2', 'youtube:y3']);
  // THE WHOLE POINT: six clips in TWO windows rather than six.
  assert.equal(new Set(clips.map(c => c.scheduledAt)).size, 2);
});

test('the rotation is stable, so a clip does not move channel after it is scheduled', () => {
  // This runs at schedule time AND again when targets are rebuilt. A rotation
  // that drifted between the two would move a clip to a different channel
  // after it had already been placed.
  const clips = seed({ shareOut: true });
  const before = clips.map(c => c.targets.map(t => t.id).join());
  for (const clip of clips) clip.targets = [];
  const after = clips.map(c => social.enabledTargetsForClip(c, { quiet: true }).map(t => t.id).join());
  assert.deepEqual(after, before);
});

test('a CUSTOMER cannot reach any of it, whatever is stored', () => {
  // Not by a check in the share-out path -- by construction. The allowance is
  // 1 for anyone who is not the operator, so there is never a second channel
  // to share with and the setting can do nothing at all.
  const clips = seed({ shareOut: true });
  state.authUsers[0].role = 'creator';
  state.authUsers[0].billing = { plan: 'studio_yearly', status: 'active' };
  assert.equal(billing.accountsPerPlatform(state.authUsers[0], 'youtube'), 1);
  for (const clip of clips) {
    assert.deepEqual(social.enabledTargetsForClip(clip, { quiet: true }).map(t => t.id), ['youtube:y1'],
      'a customer posts to the first channel, share-out or not');
  }
  state.authUsers[0].role = 'owner';
  delete state.authUsers[0].billing;
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });

/* ── the surfaces ─────────────────────────────────────────────────────────
   Read from the adapter's real bindings, driven with the payload the server
   sends -- so a change to what a customer is SHOWN turns this red rather than
   passing on a source string. */
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
const sandbox = {
  window: {}, document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  /* THE WALKTHROUGH STEERS THE SCREEN. With nothing in storage the tour is
     live, and its first step forces UI.screen to 'home' on every bindings()
     call -- so a Schedule assertion silently read the Home subline instead.
     Marking it seen is what a real browser does after anybody has been round
     the product once. */
  localStorage: { getItem: key => (/^dcTour/.test(String(key)) ? '1' : null), setItem() {}, removeItem() {} },
  innerWidth: 1440,
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox); vm.runInContext(source, sandbox);
const A = sandbox.StudioAdapter;

const at = Date.UTC(2026, 8, 9, 4, 0);
function payload(perPlatform) {
  return {
    postTimes: ['07:00', '08:15', '09:30', '12:00', '14:30', '17:00', '18:45', '20:30'],
    timezone: 'Australia/Perth',
    user: { role: 'owner' },
    billing: { current: { plan: 'studio_monthly', tier: 'studio' } },
    social: {
      accountsPerPlatform: perPlatform,
      providers: { youtube: { configured: true, connected: true, accounts: [
        { id: 'y1', name: 'Main' }, { id: 'y2', name: 'Shorts' }, { id: 'y3', name: 'Arabic' }] } },
    },
    publishingSettings: { enabled: true, shareOut: true, youtube: { enabled: true, accountId: 'y1', accountIds: ['y1', 'y2', 'y3'] } },
    projects: [{ id: 'p1', title: 'A lecture' }],
    clips: [{ id: 'c1', projectId: 'p1', title: 'One', status: 'scheduled', scheduledAt: at,
      targets: [{ id: 'youtube:y1', provider: 'youtube', accountId: 'y1', accountName: 'Main', status: 'scheduled' }] }],
  };
}
const bind = (perPlatform) => {
  A.ui.screen = 'schedule'; A.ui.schedView = 'day'; A.ui.schedAnchor = at;
  return A.bindings(payload(perPlatform));
};

test('a customer reads ONE denominator and an unnamed logo', () => {
  const b = bind(1);
  assert.equal(String(b.subline), 'Up to 8 posts a day', 'no per-channel wording for a customer');
  assert.match(String(b.schedDayCount), /of 8 scheduled/);
  const dests = Array.from(b.schedDayItems[0].dests, d => String(d.who));
  assert.deepEqual(dests, [''], 'the logo stands alone while a platform means one channel');
});

test('the operator reads the capacity per channel, and the channel is named', () => {
  const b = bind(3);
  assert.equal(String(b.subline), 'Up to 8 posts a day on each of your 3 channels');
  // Eight windows on each of three channels.
  assert.match(String(b.schedDayCount), /of 24 scheduled/);
  const dests = Array.from(b.schedDayItems[0].dests, d => String(d.who));
  assert.deepEqual(dests, [' Main'],
    'two identical YouTube marks on one day say nothing -- "a logo is a name only while there is one of the thing"');
});

test('the month cell draws one pip per WINDOW, never per post', () => {
  // Twenty-four dots in a month cell is a grey mesh rather than a reading, and
  // a cell answers "how full is this DAY".
  A.ui.screen = 'schedule'; A.ui.schedView = 'month'; A.ui.schedAnchor = at;
  const b = A.bindings(payload(3));
  const cells = b.schedMonthWeeks.flatMap(w => Array.from(w.cells));
  const drawn = cells.filter(c => Array.from(c.pips || []).length);
  assert.ok(drawn.length > 0, 'no month cell drew pips');
  for (const cell of drawn) assert.equal(Array.from(cell.pips).length, 8);
});

test('the beta is owner-only and says so, and the control writes through one route', () => {
  const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
  const at2 = host.indexOf('function shareOutRow()');
  assert.ok(at2 > 0, 'the share-out control is gone');
  const body = host.slice(at2, host.indexOf('\n    }', at2));
  assert.match(body, /if\(!shareOutAllowed\(\)\)return ''/,
    'the row must not exist for an account that cannot have a second channel');
  assert.match(body, /Owner beta/, 'and it is marked as the beta it is');
  // ONE save path: a second road into stored settings is how two answers to
  // one question get written.
  const handler = host.slice(host.indexOf('StudioAdapter.onShareOut='));
  assert.match(handler.slice(0, 600), /\/api\/publishing-settings/);
});
