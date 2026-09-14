import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * TWO GUARDS WRITTEN AFTER 11 SEPTEMBER 2026, when publishing was down for
 * three days and nothing anywhere said so.
 *
 * What happened: a start-up migration retired the direct YouTube OAuth
 * connections in favour of Buffer, and it ran on EVERY BOOT. It deleted three
 * credentials in production at 15:53 on 11 Sept; every scheduled clip from
 * 23:00 that night onwards was refused. Owner -> Health reported Posting as
 * configured throughout, because the only check that existed asked whether
 * credentials were present in the ENVIRONMENT -- never whether a channel was
 * actually connected.
 *
 * So there are two separate failures to guard, and each is silent on its own:
 *
 *   1. A destructive migration that repeats. Reconnect a channel and the next
 *      deploy takes it away again, with no error and no way out.
 *   2. A monitor that reads the wrong side. This repo already records that
 *      shape against the worker-version check ("a monitor that reads the wrong
 *      side reports success while the thing it watches is broken"); this is the
 *      same fault on the path that carries the product.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-posthealth-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');
const selfcheck = await import('../src/selfcheck.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* a leftover temp dir on a runner is harmless */ }
});

function seedYoutube(userId) {
  state.socialConnections = state.socialConnections || {};
  state.socialConnections[userId] = {
    ...(state.socialConnections[userId] || {}),
    youtube: { provider: 'youtube', accountId: 'chan-1', name: 'DeenClipped', accessToken: 'x' },
  };
}

test('the YouTube retirement deletes credentials ONCE and can never take another', () => {
  state.authUsers = [{ id: 'u1', email: 'a@example.com', role: 'user' }];
  delete state.authSettings.directYoutubeRetiredAt;
  seedYoutube('u1');

  const first = social.retireDirectYoutubeConnections();
  assert.equal(first, 1, 'the one-time pass removes the stored connection');
  assert.ok(Number(state.authSettings.directYoutubeRetiredAt), 'and stamps that it has run');

  /*
   * THE CASE THAT MATTERS. The customer reconnects, and the next deploy must
   * leave it alone. Before the stamp this returned 1 again and the channel
   * silently vanished for a second time.
   */
  seedYoutube('u1');
  const second = social.retireDirectYoutubeConnections();
  assert.equal(second, 0, 'a channel reconnected afterwards survives the next boot');
  assert.ok(state.socialConnections.u1.youtube, 'and is still there to publish with');
});

test('it stamps even when it removed nothing, so it cannot lie in wait', () => {
  /*
   * A deployment with no YouTube connection today would otherwise stay armed
   * for ever and eat the first channel somebody connects tomorrow -- which is
   * every deployment except the one this migration was written for.
   */
  state.authUsers = [{ id: 'u2', email: 'b@example.com', role: 'user' }];
  state.socialConnections = {};
  delete state.authSettings.directYoutubeRetiredAt;

  assert.equal(social.retireDirectYoutubeConnections(), 0, 'nothing to remove');
  assert.ok(Number(state.authSettings.directYoutubeRetiredAt), 'stamped anyway');

  seedYoutube('u2');
  assert.equal(social.retireDirectYoutubeConnections(), 0, 'the later connection is safe');
  assert.ok(state.socialConnections.u2.youtube, 'and survives');
});

test('a destination switched on with no channel is REPORTED, not passed over', () => {
  const [result] = selfcheck.checks({ publishing: { youtube: { enabled: 1, missing: 1 } } })
    .filter(check => check.key === 'posting');
  assert.equal(result.ok, false, 'this is exactly the 11 September state');
  assert.match(result.detail, /youtube/, 'and it names the destination');
  assert.match(result.detail, /refused/i, 'and says what it costs');
});

test('one account\'s dead channel is not hidden by another account\'s working one', () => {
  /*
   * Reporting only when EVERY account is broken is how a single customer's
   * dead destination stays invisible on a multi-account deployment.
   */
  const [result] = selfcheck.checks({ publishing: { tiktok: { enabled: 4, missing: 1 } } })
    .filter(check => check.key === 'posting');
  assert.equal(result.ok, false, 'one of four is enough to report');
  assert.match(result.detail, /tiktok/);
});

test('everything connected reads clean, and so does nothing switched on', () => {
  const live = selfcheck.checks({ publishing: { youtube: { enabled: 1, missing: 0 } } })
    .find(check => check.key === 'posting');
  assert.equal(live.ok, true);
  assert.match(live.detail, /1 destination/);

  const idle = selfcheck.checks({ publishing: {} }).find(check => check.key === 'posting');
  assert.equal(idle.ok, true, 'a deployment that posts nowhere is not broken');
  assert.match(idle.detail, /no destination switched on/);
});

test('the check is in the list the alert sweep actually runs', () => {
  /*
   * A check that exists and is never called is the monitor this file was
   * written about, one layer along.
   */
  const keys = selfcheck.checks({ publishing: {} }).map(check => check.key);
  assert.ok(keys.includes('posting'), 'checks() must return it');
});
