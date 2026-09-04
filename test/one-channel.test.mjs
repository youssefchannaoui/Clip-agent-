import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * ONE CHANNEL PER PLATFORM, and Studio is capacity instead.
 *
 * Youssef, 4 Sept 2026: "FOR STUDIO REMOVE ALL THINGS TO DO WITH 3 CHANNELS
 * REMOVE IT, ITS NOT PRCATICAL THEY JUST GET 8 UPLAODS AND MORE TOKENS."
 *
 * Multi-channel shipped v3.41.0 and was retired v3.125.0. The reason is in
 * this repo's own record rather than in anybody's opinion: three channels
 * needed a lane switcher, a share-out mode, a per-channel denominator on every
 * count and a channel name beside every logo -- and TWO RELEASES RUNNING
 * (v3.115.4, v3.116.0) went on the schedule being "very confusing" as a direct
 * result. The feature was retired rather than the symptom.
 *
 * This file is the guard against it creeping back, because the pieces are
 * scattered: an allowance in billing, a cap enforced twice, a switcher in the
 * host, a picker in the dialog and a mode in the store.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-onechan-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const billing = await import('../src/billing.js');
const social = await import('../src/social.js');

test('the allowance is one, on every plan and every platform', () => {
  // Not "one unless Studio". A function that still branches on the tier is a
  // feature waiting to be switched back on by a config change nobody reviews.
  for (const user of [
    null,
    { id: 'u', role: 'owner' },
    { id: 'u', role: 'creator', billing: { plan: 'studio_yearly', status: 'active' } },
    { id: 'u', role: 'creator', billing: { plan: 'pro_monthly', status: 'active' } },
  ]) {
    for (const provider of ['youtube', 'tiktok', 'instagram', 'facebook', '']) {
      assert.equal(billing.accountsPerPlatform(user, provider), 1);
    }
  }
});

test('a record holding three still posts to one, and says which', () => {
  // Nothing was migrated, deliberately: an account that connected three while
  // they were sold has three on disk, and capping the ALLOWANCE stops the
  // extras without a migration that could lose a working credential.
  const userId = 'u_one';
  state.authUsers = [{ id: userId, email: 'o@example.com', role: 'owner' }];
  state.socialConnections = { [userId]: { youtube: [
    { provider: 'youtube', accountId: 'y1', name: 'Main', tokens: {} },
    { provider: 'youtube', accountId: 'y2', name: 'Shorts', tokens: {} },
    { provider: 'youtube', accountId: 'y3', name: 'Arabic', tokens: {} },
  ] } };
  state.userSettings = { [userId]: { publishingSettings: {
    enabled: true,
    youtube: { enabled: true, accountId: 'y1', accountIds: ['y1', 'y2', 'y3'] },
    tiktok: { enabled: false }, instagram: { enabled: false }, facebook: { enabled: false },
  } } };
  state.projects = [{ id: 'p1', userId }];
  const clip = { id: 'c1', userId, projectId: 'p1', title: 'One', addedAt: 1, targets: [], approvedBy: 'manual' };
  state.clips = [clip];
  state.log = [];

  const targets = social.enabledTargetsForClip(clip);
  assert.equal(targets.length, 1);
  assert.equal(targets[0].accountName, 'Main', 'the first, not an arbitrary one');
  // Said out loud rather than silently dropped: two destinations disappearing
  // from a customer's account with no line anywhere is how a "my clips stopped
  // posting" report starts.
  assert.ok(state.log.some(row => /posts to the first one/.test(row.message || '')),
    'the extras being ignored is recorded');
});

test('the share-out mode is gone from the store, the route and the publish path', () => {
  // It only ever meant anything with more than one channel to share between,
  // so leaving it would be a stored setting no code path can act on -- the
  // dead flag this repo already paid for once (v3.116.0, the master publishing
  // switch that had been false in production for the life of the product).
  assert.ok(!/spread/.test(read('src/social.js')), 'the publish path');
  assert.ok(!/rotationIndex/.test(read('src/social.js')), 'and the ordinal it needed');
  assert.ok(!/spread:/.test(read('src/store.js')), 'the stored default');
  assert.ok(!/body\.spread/.test(read('src/server.js')), 'and the route that wrote it');
});

test('no surface offers a channel to switch between', () => {
  const host = read('src/public/index.html');
  const adapter = read('src/public/studio-adapter.js');
  // The schedule's switcher, its chips and the mode pair.
  for (const gone of ['dcSchedChannels', 'data-sched-lane', 'data-sched-spread', 'dcsc']) {
    assert.ok(!host.includes(gone), `${gone} is still in the host`);
  }
  // Its bindings, and the setter behind the chips. A binding left behind is
  // read by nothing and drifts silently until somebody trusts it.
  for (const gone of ['schedLanes', 'schedHasLanes', 'schedChannel', 'schedLaneTotal', 'setSchedChannel']) {
    assert.ok(!adapter.includes(gone), `${gone} is still a binding`);
  }
  // And the connections dialog's picker.
  assert.ok(!host.includes('data-conn-account'), 'the account picker');
  assert.ok(!host.includes('onPublishingAccounts'), 'and the handler behind it');
});

test('the schedule has ONE denominator again', () => {
  // "3 of 4 scheduled" beside "Up to 8 posts a day" beside "0 of 8 scheduled
  // today" is the three-numbers-disagreeing bug that multi-channel caused and
  // v3.116.0 papered over by removing the denominator entirely.
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /schedDayCount: schedDayItems\.length \+ ' of ' \+ daySlots \+ ' scheduled'/);
  assert.ok(!/on each of your/.test(adapter), 'no per-channel wording anywhere');
  assert.ok(!/across your channels/.test(adapter));
});

test('the plan sells the two things it actually gives', () => {
  assert.deepEqual(Object.keys(billing.STUDIO_FEATURES).sort(),
    ['extraSlots', 'moreTokens', 'priorityRender']);
  assert.match(billing.STUDIO_FEATURES.extraSlots, /8 times a day, not four/);
  // Derived from the two plans' own figures, so the sales line cannot claim a
  // multiple the billing code does not grant.
  assert.match(billing.STUDIO_FEATURES.moreTokens, /^About \d+\.\d+× the tokens of Pro/);
});

test('help no longer teaches a feature that is gone', () => {
  // An article describing "press Connect again — it now reads Add another" is
  // worse than no article: it sends somebody looking for a button that does
  // not exist and reads as the product being broken.
  const help = read('src/help.js');
  assert.ok(!/multi-channel/.test(help));
  assert.ok(!/Add another/.test(help));
  assert.ok(!/up to 3 accounts/.test(help));
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
