import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * THE BROKERAGE IS GONE, AND YOUTUBE CONNECTS ON ITS OWN LOGIN AGAIN.
 *
 * Buffer was reached for on 11 September 2026 for ONE reason, in Youssef's own
 * words: "The only reason why I did that buffer thing is specifically for
 * that" -- the "Google hasn't verified this app" screen. It works, in the sense
 * that the OAuth grant then belongs to Buffer rather than to us. What it cost,
 * measured rather than argued:
 *
 *   - every customer needs their OWN Buffer account and subscription, in front
 *     of their first post, on a funnel whose oldest number is accounts that
 *     sign up and never import;
 *   - `mode: addToQueue` posts on BUFFER'S schedule, so the posting windows,
 *     the week grid and the month pips describe times that are not when a clip
 *     goes out;
 *   - there is no poll, so a clip is filed posted with an empty postUrl the
 *     moment Buffer accepts the queue item -- if Buffer then fails to publish,
 *     nothing here ever learns;
 *   - TikTok was never carried, so the dialog held two connection models;
 *   - and no channel was ever connected to it in production, so from 15:53 on
 *     11 Sept until this release YouTube posted NOTHING.
 *
 * The verification screen is not removable by any of that. It is what Google
 * shows for an unverified SENSITIVE scope, `youtube.upload` is one, and the
 * only two ways past it are finishing verification or not uploading on the
 * customer's behalf at all -- which is what the clippers with no warning screen
 * do: they hand you a file. So the brokerage bought a worse product and did not
 * buy the thing it was for.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Comments are not code, and a test that reads its own explanation is noise. */
const code = rel => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-nobuffer-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'n'.repeat(40);
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.GOOGLE_CLIENT_ID = 'google-client';
process.env.GOOGLE_CLIENT_SECRET = 'google-secret';
const social = await import('../src/social.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* harmless on a runner */ }
});

test('no Buffer integration survives anywhere in src/', () => {
  /*
   * Read across the whole of src/ rather than the two files it mostly lived
   * in, because a half-removed brokerage is worse than either state: a stray
   * `viaBuffer` makes `selectedAccount` answer for a road that no longer has a
   * token behind it, and the clip fails at its slot rather than at a save.
   */
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|mjs|html)$/.test(entry.name)) continue;
      const body = code(rel);
      // `Buffer.from`/`Buffer.alloc` and a local variable called `buffer` are
      // Node's own and have nothing to do with the service.
      for (const hit of body.match(/\bbuffer[A-Za-z]*\b/gi) || []) {
        if (/^buffer$/i.test(hit)) continue;
        if (/^Buffer(From|Alloc|Concat)?$/.test(hit)) continue;
        if (/^buffering$/i.test(hit)) continue;
        offenders.push(`${rel}: ${hit}`);
      }
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'the brokerage must be gone, not half-gone');
});

test('the flag that switched direct YouTube off is gone with it', () => {
  /*
   * `directYoutubeOAuthEnabled` defaulted FALSE, so a fresh deployment could
   * not publish to YouTube at all and nothing said why. Leaving it behind at a
   * new default would be a switch nobody reads that can turn the product off.
   */
  assert.doesNotMatch(code('src/config.js'), /directYoutubeOAuthEnabled|DIRECT_YOUTUBE_OAUTH_ENABLED/);
  assert.doesNotMatch(code('src/social.js'), /directYoutubeOAuthEnabled/);
});

test('YouTube is configured by its own credentials, and by nothing else', () => {
  const status = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
  assert.equal(status.providers.youtube.configured, true);
  assert.equal(status.providers.youtube.viaBuffer, undefined, 'no brokerage is claimed');
  assert.equal(status.buffer, undefined, 'and none is reported');
});

test('all three OAuth routes accept youtube again', () => {
  /*
   * The half that made this a THREE-DAY outage rather than a bad release: the
   * dialog went on offering a YouTube Connect button while the matcher had
   * dropped `youtube`, so pressing it reached nothing at all. Callback and
   * disconnect matter as much -- without the callback a grant can be given and
   * never stored, and without disconnect a customer cannot take it back.
   */
  const server = code('src/server.js');
  for (const [label, pattern] of [
    ['callback', /\^\\\/auth\\\/\(([a-z|]+)\)\\\/callback\$/],
    ['connect', /\^\\\/api\\\/social\\\/\(([a-z|]+)\)\\\/connect\$/],
    ['disconnect', /\^\\\/api\\\/social\\\/\(([a-z|]+)\)\\\/disconnect\$/],
  ]) {
    const found = pattern.exec(server);
    assert.ok(found, `the ${label} matcher must be findable`);
    const accepts = found[1].split('|');
    assert.ok(accepts.includes('youtube'), `${label} must accept youtube, got ${accepts.join('|')}`);
    assert.ok(!accepts.includes('buffer'), `${label} must not still accept buffer`);
  }
});

/* ── Google's own screen ──────────────────────────────────────────────── */

test('the YouTube row warns about the verification screen before it is met', () => {
  /*
   * NOTHING HERE REMOVES THAT SCREEN, and the notice must not imply otherwise.
   * What it removes is the surprise: an unexpected warning reads as a dodgy
   * app, an expected one reads as a queue.
   */
  const status = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
  assert.equal(status.providers.youtube.unverifiedNotice, true, 'sent by the SERVER, so it can be switched off in one place');

  const html = code('src/public/index.html');
  assert.match(html, /function verifyNotice\(/, 'the dialog must have it');
  /*
   * AND MUST CALL IT. The first cut of this test asserted only that the
   * function was DEFINED, so a probe that deleted the call site left it
   * declared, unused and never rendered -- and the test stayed green. A
   * function nobody calls is the same as no function, and this repo has now
   * recorded that shape nine times.
   */
  assert.match(html, /\$\{verifyNotice\(r,\s*linked\)\}/, 'and must actually draw it in the row');
  assert.match(html, /r\.key!=='youtube'\|\|linked\|\|!r\.unverifiedNotice/,
    'YouTube only, before connecting only, and only while the server says so');
  assert.match(html, /Advanced/, 'and say how to get past it, which is the whole point');
});

test('the notice is carried explicitly, because this binding picks its fields one by one', () => {
  /*
   * The exact trap `connectWith` already paid for in this file: the row renders
   * perfectly with the field undefined, so the notice simply never appears and
   * nothing anywhere says so.
   */
  assert.match(code('src/public/studio-adapter.js'), /unverifiedNotice: Boolean\(p\.status && p\.status\.unverifiedNotice\)/);
});

test('it can be switched off the day verification lands', async () => {
  /*
   * A notice that outlives the thing it describes tells every customer the app
   * is unverified when it is not -- the stale-claim failure this repo keeps
   * paying for. Run in its own process: config.js reads the environment once,
   * at first import.
   */
  const { execFileSync } = await import('node:child_process');
  const MARK = '<<<answer>>>';
  const script = `
    const social = await import(${JSON.stringify(new URL('../src/social.js', import.meta.url).href)});
    const s = social.connectionStatus({ id: 'u1', email: 'a@example.com' });
    process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify(s.providers.youtube.unverifiedNotice) + ${JSON.stringify(MARK)});`;
  const env = {
    ...process.env,
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dc-verified-')),
    GOOGLE_UNVERIFIED_NOTICE: 'false',
  };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.equal(out.split(MARK)[1], 'false', 'one variable, and the notice is gone everywhere');
});
