import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * INSTAGRAM AND FACEBOOK ARE HELD BACK, AND THAT IS NOT THE SAME AS BROKEN.
 *
 * Youssef, 14 Sept 2026: "Meta, I don't really care ... if you can put on
 * connections coming soon or something for it, like, make it look very nice
 * and sleek for Facebook and Instagram".
 *
 * It is an honest state rather than a cosmetic one. The Meta app is Unpublished
 * with Standard Access, so only somebody holding a ROLE on it can connect --
 * which means a live-looking Connect button works for the operator and fails
 * for every customer. That is invariant 9 with a worse-than-usual sting,
 * because the failure only appears after somebody has been sent to Facebook
 * and back.
 *
 * The flag is its own rather than derived from providerConfigured: the Meta
 * credentials ARE set, so configuration cannot answer this question.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const read = rel => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const code = rel => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-soon-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.SOCIAL_TOKEN_KEY = 's'.repeat(40);
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.GOOGLE_CLIENT_ID = 'g';
process.env.GOOGLE_CLIENT_SECRET = 'gs';
process.env.META_APP_ID = 'm';
process.env.META_APP_SECRET = 'ms';
process.env.TIKTOK_CLIENT_KEY = 't';
process.env.TIKTOK_CLIENT_SECRET = 'ts';
const social = await import('../src/social.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 }); } catch { /* harmless */ }
});

const providers = () => social.connectionStatus({ id: 'u1', email: 'a@example.com' }).providers;

test('both Meta rows are held, and only the Meta rows', () => {
  const p = providers();
  assert.equal(p.instagram.comingSoon, true);
  assert.equal(p.facebook.comingSoon, true);
  /*
   * The half that matters more. TikTok was approved on 14 Sept and YouTube is
   * the one the product is being pushed towards -- holding either by accident
   * would take the two working platforms off the screen, and the row draws no
   * Connect at all in that state, so there would be no way back from the UI.
   */
  assert.ok(!p.tiktok.comingSoon, 'TikTok is approved and must stay connectable');
  assert.ok(!p.youtube.comingSoon, 'YouTube is the road the product depends on');
});

test('a held row offers nothing to press', () => {
  /*
   * An EMPTY control reads as broken where an ABSENT one reads as not yet, and
   * that difference is the whole feature. The row returns early with mark, name
   * and pill -- no switch, no Connect, no Test, no Disconnect.
   */
  const html = code('src/public/index.html');
  const at = html.indexOf('if(soon)return `<div class="studio-conn-row is-soon">');
  assert.ok(at > 0, 'the held row must have its own branch');
  const row = html.slice(at, html.indexOf('`;', at));
  for (const control of ['data-conn-connect', 'data-conn-toggle', 'data-conn-test', 'data-conn-disconnect']) {
    assert.ok(!row.includes(control), `a held row must not draw ${control}`);
  }
  assert.match(row, /studio-conn-state soon/, 'and must wear the state that explains it');
});

test('held outranks every other state on that row', () => {
  /*
   * `linked` is computed FROM `soon`, so a stale account left on a held
   * platform cannot make the row draw a Reconnect button for a login nobody can
   * complete. Pinned because the ordering is the whole correctness of it.
   */
  const html = code('src/public/index.html');
  assert.match(html, /const linked=!off&&!soon&&/, 'soon must be consulted before linked');
  assert.match(html, /const stateWord=soon\?'Coming soon'/, 'and win the pill');
});

test('it is quieted by TOKEN, never by a blanket opacity', () => {
  /*
   * `opacity: .72` on the row was the first cut, and it fades the TEXT toward
   * the ground with the chrome. Measured on the real tokens: the name fell to
   * 3.38 night / 3.26 paper and the pill's ink to 3.02 on paper -- three of
   * four under AA, on a row whose only job is to be read. Without it they are
   * 5.29 / 6.04 / 8.09 / 5.13.
   */
  const css = code('src/public/index.html');
  const rule = css.slice(css.indexOf('.studio-conn-row.is-soon {'));
  assert.doesNotMatch(rule.slice(0, rule.indexOf('}')), /opacity/,
    'the row itself must not be faded — that is what pushed its text under AA');
});

test('one variable brings both rows back', async () => {
  /*
   * Meta's app review is somebody else's queue, and the day it passes this
   * should not need a deploy. Its own process: config.js reads the environment
   * once, at first import.
   */
  const { execFileSync } = await import('node:child_process');
  const MARK = '<<<a>>>';
  const script = `
    const social = await import(${JSON.stringify(new URL('../src/social.js', import.meta.url).href)});
    const p = social.connectionStatus({ id: 'u1', email: 'a@example.com' }).providers;
    process.stdout.write(${JSON.stringify(MARK)} + JSON.stringify([p.instagram.comingSoon, p.facebook.comingSoon]) + ${JSON.stringify(MARK)});`;
  const env = {
    ...process.env,
    DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'dc-meta-live-')),
    META_COMING_SOON: 'false',
  };
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  assert.equal(out.split(MARK)[1], '[false,false]', 'both rows come back together');
});
