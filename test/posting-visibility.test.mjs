/*
 * What is going where, and why it did not go.
 *
 * Three real reports, all on the same day:
 *   - YouTube posts arrived private. The Studio shell had no privacy control
 *     for YouTube at all, so the stored default ('private') was the only value
 *     an upload could ever carry, and nothing on screen said so.
 *   - TikTok answered 403 with "Please review our integration guidelines at
 *     <url>" and nothing else. The machine-readable code that says WHICH rule
 *     was broken lost the || chain to that message and was thrown away.
 *   - The schedule named targets[0] and stopped. A clip going to three places
 *     said "YouTube", and a clip whose TikTok post had failed while YouTube
 *     went out looked, on the row, entirely fine.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-posting-'));
const port = 42100 + Math.floor(Math.random() * 400);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';
process.env.APP_SESSION_SECRET = 'posting-visibility-secret-long-enough';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const social = await import('../src/social.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

// ── the refusal has to say what to do ───────────────────────────────────────

test('a TikTok refusal explains itself instead of linking to the guidelines', () => {
  const detail = social.platformDetail({
    error: {
      code: 'unaudited_client_can_only_post_to_private_accounts',
      message: 'Please review our integration guidelines at https://developers.tiktok.com/doc/content-sharing-guidelines/',
    },
  }, 'TikTok', 'Forbidden');
  assert.match(detail, /has not finished reviewing this app/i, 'say what is wrong');
  assert.match(detail, /private/i, 'and what would let it post today');
  assert.doesNotMatch(detail, /^Please review our integration guidelines/,
    'the bare link was the whole of what an operator used to get');
});

test('the machine code survives even when there is nothing to translate', () => {
  // An unmapped code is still the only searchable thing in the message, and
  // dropping it is what made the original 403 undiagnosable.
  const detail = social.platformDetail({
    error: { code: 'something_new_from_tiktok', message: 'Refused.' },
  }, 'TikTok', 'Forbidden');
  assert.match(detail, /something_new_from_tiktok/);
  assert.match(detail, /Refused\./, 'and the platform still gets to speak');
});

test('a translated refusal is not also stamped with a duplicate code', () => {
  const detail = social.platformDetail({
    error: { code: 'spam_risk', message: 'x' },
  }, 'TikTok', '');
  assert.equal(detail.match(/spam_risk/g).length, 1);
});

test('other platforms are left exactly as they were', () => {
  // The guidance table is TikTok's. A YouTube error must not be rewritten by it.
  const detail = social.platformDetail({ error: { message: 'Quota exceeded.' } }, 'YouTube', 'nope');
  assert.equal(detail, 'Quota exceeded.');
  assert.equal(social.platformDetail({}, 'YouTube', 'Service Unavailable'), 'Service Unavailable');
});

// ── YouTube can be published publicly ───────────────────────────────────────

test('the Studio can set a YouTube privacy other than private', async () => {
  const state = await fetch(`${base}/api/state`).then(r => r.json());
  const settings = state.publishingSettings || {};
  const res = await fetch(`${base}/api/publishing-settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...settings, youtube: { ...(settings.youtube || {}), privacy: 'public' } }),
  });
  assert.equal(res.status, 200, await res.text());
  const after = await fetch(`${base}/api/state`).then(r => r.json());
  assert.equal(after.publishingSettings.youtube.privacy, 'public',
    'the choice has to survive the round trip, or the panel is decoration');
});

test('a privacy YouTube does not recognise is refused', async () => {
  const state = await fetch(`${base}/api/state`).then(r => r.json());
  const res = await fetch(`${base}/api/publishing-settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...state.publishingSettings, youtube: { ...state.publishingSettings.youtube, privacy: 'everyone' } }),
  });
  assert.ok(res.status >= 400, 'an unknown privacy would be rejected by YouTube at upload time instead');
});

test('the Studio shell has a YouTube privacy control, not just the old page', () => {
  // The control existed only on ?classic=1, which no customer reaches, so in
  // the shipped product nobody could change it.
  const host = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
  assert.match(host, /paintYouTubeOptions/, 'the panel must be built');
  assert.ok((host.match(/paintYouTubeOptions\(\)/g) || []).length >= 2,
    'and painted wherever the connections dialog is painted — a panel nothing calls is unreachable');
  assert.match(host, /data-yt="privacy"/);
  assert.match(host, /compliance audit/i,
    'and it has to say that Google can override this, or a private upload reads as the app ignoring the choice');
});

// ── the schedule names every destination ────────────────────────────────────

function templateAst() {
  const js = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  const g = {};
  new Function('window', js)(g);
  return g.STUDIO_TEMPLATE;
}

function walk(nodes, visit) {
  for (const node of nodes || []) {
    if (!node || typeof node !== 'object') continue;
    visit(node);
    walk(node.ch, visit);
  }
}

test('the compiled schedule card repeats destinations rather than naming one', () => {
  // Executed output, not a source string: the design file could say anything
  // if the importer did not carry it through.
  let loops = 0;
  walk(templateAst(), node => {
    if (node.t === 'for' && node.l && node.l.p === 'post.dests') loops += 1;
  });
  assert.ok(loops >= 2, `both schedule cards must repeat destinations, found ${loops}`);
});

test('each destination carries its own state, so one failure cannot hide', () => {
  const adapter = fs.readFileSync(path.join(ROOT, 'src/public/studio-adapter.js'), 'utf8');
  for (const status of ['posted', 'publishing', 'retrying', 'failed', 'scheduled']) {
    assert.ok(adapter.includes(`${status}:`), `${status} needs a word and a colour of its own`);
  }
  assert.match(adapter, /No account connected/,
    'a clip going nowhere has to say so — that is the most useful thing the row can tell you');
});

test('a phone drops the account name, never the platform or the outcome', () => {
  // Three destinations at 375px wrapped to nine lines with Post now beside
  // them. The account is the part that can go; which platform and what
  // happened there are the two that carry the meaning.
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-responsive.css'), 'utf8');
  assert.match(css, /\[data-dc-dest-account\][^}]*display:\s*none/);
  assert.match(css, /\[data-dc-sched-card\][^}]*flex-wrap:\s*wrap/,
    'and the actions need their own line rather than squeezing the text');

  const tpl = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  assert.match(tpl, /data-dc-dest-account/, 'the hook has to reach the compiled template');
  assert.match(tpl, /data-dc-sched-card/);
});

test('a platform error code cannot run off the edge of the card', () => {
  // "[unaudited_client_can_only_post_to_private_accounts]" is one unbreakable
  // token, and it overflowed the card on a phone with no way to read the end.
  const tpl = fs.readFileSync(path.join(ROOT, 'src/public/studio-template.generated.js'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'src/public/studio-styles.generated.css'), 'utf8');
  assert.ok(/overflow-wrap:\s*anywhere/.test(tpl) || /overflow-wrap:\s*anywhere/.test(css),
    'the failure line must be allowed to break a long code');
});
