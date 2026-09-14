import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A CONNECT BUTTON MUST REACH A ROUTE.
 *
 * On 11 September 2026 direct YouTube OAuth was retired in favour of Buffer.
 * The connect matcher in server.js became
 *
 *   ^/api/social/(meta|tiktok|instagram|buffer)/connect$
 *
 * and `youtube` was not in it -- but the studio's Connections dialog went on
 * mapping the YouTube row to `onConnect('youtube')`, and connectionStatus went
 * on reporting it `configured` whenever a direct client id was set. So the row
 * drew a live Connect button, pressing it hit nothing at all, and it was the
 * ONE platform with no second way in. Three days, and the only symptom a
 * customer could see was a button that did nothing.
 *
 * Buffer was removed on 14 September and YouTube connects directly again, so
 * the matcher has to carry `youtube` and `configured` has to mean the Google
 * client -- the same trap pointing the other way, which is why this guard is
 * written against the PAIR rather than against either spelling.
 *
 * This is the general guard rather than a note about YouTube: any platform the
 * dialog can offer must send people at an OAuth target the server accepts.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-routes-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'k'.repeat(40);
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
// Every road configured, so the status object reports each platform at its
// most capable -- which is exactly when a wrong target is drawn as a live
// button rather than hidden behind "credentials missing".
process.env.GOOGLE_CLIENT_ID = 'g';
process.env.GOOGLE_CLIENT_SECRET = 'gs';
process.env.META_APP_ID = 'm';
process.env.META_APP_SECRET = 'ms';
process.env.TIKTOK_CLIENT_KEY = 't';
process.env.TIKTOK_CLIENT_SECRET = 'ts';
const social = await import('../src/social.js');
const { state } = await import('../src/store.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* harmless on a runner */ }
});

/** The oauth targets the server's connect route will actually accept. */
function routeTargets() {
  const server = read('src/server.js');
  const m = /\^\\\/api\\\/social\\\/\(([a-z|]+)\)\\\/connect\$/.exec(server);
  assert.ok(m, 'the connect route matcher must be findable');
  return new Set(m[1].split('|'));
}

/** The mapping the studio dialog uses to decide which login to open. */
function oauthForKey(key, status) {
  const src = read('src/public/studio-adapter.js');
  const at = src.indexOf('function oauthFor(');
  assert.ok(at > 0, 'oauthFor must exist');
  const body = src.slice(at, src.indexOf('\n  }', at));
  const map = /OAUTH_OF = (\{[^}]*\})/.exec(src);
  assert.ok(map, 'OAUTH_OF must exist');
  // eslint-disable-next-line no-new-func
  const fn = new Function('key', 'status', 'OAUTH_OF', body.replace('function oauthFor(key, status) {', '') + '\n  ');
  // eslint-disable-next-line no-new-func
  return fn(key, status, new Function('return ' + map[1])());
}

test('every platform the dialog can offer sends people at a route that exists', () => {
  const targets = routeTargets();
  const status = social.connectionStatus({ id: 'u1', email: 'a@example.com' });

  const offered = [];
  for (const [key, provider] of Object.entries(status.providers)) {
    if (!provider.configured) continue;   // nothing is offered, so nothing to reach
    const target = oauthForKey(key, provider);
    offered.push(`${key} -> ${target}`);
    assert.ok(
      targets.has(target),
      `${key} offers Connect but /api/social/${target}/connect does not exist. `
      + `The route accepts: ${[...targets].join(', ')}`,
    );
  }
  assert.ok(offered.length >= 3, `expected several platforms offered, got ${offered.join(' | ')}`);
});

test('YouTube is offered on its own login, and the route accepts it', () => {
  const status = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
  assert.equal(status.providers.youtube.configured, true, 'a Google client is set, so the row is live');
  assert.equal(oauthForKey('youtube', status.providers.youtube), 'youtube');
  assert.ok(routeTargets().has('youtube'), 'and /api/social/youtube/connect must exist to receive it');
  assert.equal(status.providers.youtube.viaBuffer, undefined, 'no brokerage is claimed any more');
});

test('with no Google client, YouTube says so rather than offering a dead button', async () => {
  /*
   * The honest half. `configured` has to mean a road a customer can take: a
   * row claiming otherwise draws a live button that reaches nothing, which is
   * the fault this file exists for. Run in its own process, because config.js
   * reads the environment once at import.
   */
  const { execFileSync } = await import('node:child_process');
  // The store logs its starter-nasheed seed to STDOUT on import, so the answer
  // has to be fenced rather than read as the whole of it.
  const MARK = '<<<answer>>>';
  const script = `
    const social = await import(${JSON.stringify(new URL('../src/social.js', import.meta.url).href)});
    const s = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
    process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(s.providers.youtube.configured) + ${JSON.stringify(MARK)});`;
  const env = { ...process.env, DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dc-noyt-')) };
  delete env.GOOGLE_CLIENT_ID;
  delete env.GOOGLE_CLIENT_SECRET;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  const answer = out.split(MARK)[1];
  assert.equal(answer, 'false', 'no Google client means no YouTube road, and the row must say it');
});

test('the publish refusal names the deployment, not a button that is absent', async () => {
  /*
   * With no Google client there is no Connect button on the YouTube row, so a
   * refusal telling somebody to press it sends them looking for a control that
   * is not on the screen -- and every scheduled clip repeats it, which is what
   * the brokered outage looked like from the customer's side for three days.
   */
  const src = read('src/social.js');
  const at = src.indexOf("target.provider === 'youtube' && !providerConfigured('youtube')");
  assert.ok(at > 0, 'the YouTube refusal must exist and must ask providerConfigured');
  const branch = src.slice(at, at + 1200);
  assert.match(branch, /not set up on this deployment/,
    'it is the deployment that is unconfigured, and the message must say so');
  assert.doesNotMatch(branch, /press Connect|Open Connections/,
    'naming a control that is not drawn is the fault this test exists for');
});

test('TikTok still connects directly', () => {
  // It was the one platform the brokerage never carried, and it must keep its
  // own login now that every other platform has one again.
  const status = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
  assert.notEqual(status.providers.tiktok.viaBuffer, true);
  assert.equal(oauthForKey('tiktok', status.providers.tiktok), 'tiktok');
});

// Keep `state` referenced so the store import is not tree-shaken by a linter.
assert.ok(state);
