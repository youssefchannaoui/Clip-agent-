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

test('NO BOOT MIGRATION DELETES A STORED CREDENTIAL', () => {
  /*
   * `retireDirectYoutubeConnections` is gone with the Buffer brokerage it was
   * written for (14 Sept 2026). It is pinned as ABSENT rather than quietly
   * dropped, because the shape is what did the damage rather than the
   * particular platform: a start-up pass that removes stored OAuth credentials
   * ran on every boot, took three channels in production at 15:53 on 11 Sept,
   * and would have taken any reconnected one again at the next deploy. A
   * customer's connection is theirs; nothing that runs unattended at boot may
   * delete one.
   *
   * Written against the SOURCE because there is no longer a function to call,
   * and CI has no browser or box -- this is exactly the shape that is invisible
   * when it comes back: the app boots, the suite stays green, and somebody's
   * channel is simply gone.
   */
  const src = fs.readFileSync(path.join(path.dirname(path.dirname(new URL(import.meta.url).pathname)), 'src/social.js'), 'utf8');
  assert.equal(social.retireDirectYoutubeConnections, undefined, 'the retirement pass must not come back');
  assert.doesNotMatch(src, /retireDirectYoutubeConnections/, 'nor linger in social.js');
  assert.doesNotMatch(
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''),
    /directYoutubeRetiredAt/,
    'and neither must its stamp, which is only meaningful to a pass that deletes',
  );
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
