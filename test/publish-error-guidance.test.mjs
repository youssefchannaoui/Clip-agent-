import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// "shoul dbe more infromation depeidng on the error all ate the same this was
// never updated" -- and it was true. Every entry in the failure table is about
// getting a lecture IN, so /403|forbidden/ matched TikTok's PUBLISH refusal and
// answered it with "Download the video yourself and use Upload MP4 or MOV" --
// advice about a video that had already been made and rendered.
//
// These call explainFailure rather than reading the table: asserting a regex
// exists proves nothing about which entry wins, and a wrong winner was the bug.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');

const sandbox = { window: {}, document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null }, setTimeout, clearTimeout, setInterval, clearInterval, console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const explain = sandbox.StudioAdapter.explainFailure;

const publishRow = (error, provider = 'tiktok') => ({
  text: 'Publish failed · A clip', full: error, meta: error, provider,
});
const importRow = error => ({ text: 'Import failed · A lecture', full: error, meta: error });

test('TikTok’s unaudited-app refusal is explained as what it is', () => {
  const g = explain(publishRow(
    'TikTok returned 403: TikTok has not finished reviewing this app yet [unaudited_client_can_only_post_to_private_accounts]'));
  assert.match(g.title, /TikTok has not reviewed this app/i);
  const steps = g.fixes.join(' ');
  assert.match(steps, /set that TikTok account to private/i, 'the step that actually works today');
  assert.match(steps, /app review/i, 'and the permanent fix');
  assert.ok(!/Upload MP4|Download the video/i.test(steps),
    'it must never answer a publish refusal with import advice');
});

test('the same 403 no longer wins the YouTube import entry', () => {
  const g = explain(publishRow('403 Forbidden from the platform', 'tiktok'));
  assert.ok(!/refused this particular video/i.test(g.title),
    'that entry is about downloading a lecture, not about publishing a clip');
});

test('an expired connection says reconnect, not re-download', () => {
  const g = explain(publishRow('The refresh token was revoked', 'youtube'));
  assert.match(g.title, /connection.*expired/i);
  assert.match(g.fixes.join(' '), /Connections/i);
});

test('a daily upload cap is told apart from a refusal', () => {
  const g = explain(publishRow('uploadLimitExceeded: quota', 'youtube'));
  assert.match(g.title, /daily upload limit/i);
  assert.match(g.fixes.join(' '), /resets/i);
});

test('a duplicate says the clip is probably already live', () => {
  const g = explain(publishRow('This video has already been uploaded', 'youtube'));
  assert.match(g.title, /duplicate/i);
  assert.match(g.fixes.join(' '), /already live/i);
});

test('a rights or policy flag is not presented as retryable', () => {
  const g = explain(publishRow('Content ID claim on the audio track', 'youtube'));
  assert.match(g.title, /flagged the content/i);
  assert.match(g.fixes.join(' '), /Do not retry until/i);
});

test('an unrecognised publish error still names the destination and spares the clip', () => {
  const g = explain(publishRow('E_WEIRD_UNMAPPED_THING', 'instagram'));
  assert.match(g.title, /^Instagram would not accept this clip/);
  assert.match(g.cause, /rendered and ready/i, 'the clip is fine; say so');
  assert.ok(!/Upload MP4|Download the video/i.test(g.fixes.join(' ')),
    'the generic answer must not be import advice either');
});

test('import failures still get import guidance', () => {
  const g = explain(importRow('Sign in to confirm you are not a bot'));
  assert.match(g.title, /blocked our server/i);
  const forbidden = explain(importRow('YouTube refused to hand this video over: 403'));
  assert.match(forbidden.title, /refused this particular video/i,
    'the import table is untouched for the rows it was written for');
});

test('every publish guide gives a cause and at least two steps', () => {
  const errors = [
    'unaudited_client_can_only_post_to_private_accounts', 'spam_risk_too_many_posts',
    'quotaExceeded', 'invalid_grant', 'already been uploaded',
    'file is too large', 'community guidelines', 'something unmapped',
  ];
  for (const e of errors) {
    const g = explain(publishRow(e));
    assert.ok(g.cause && g.cause.length > 40, `${e}: needs a real cause`);
    assert.ok(g.fixes.length >= 2, `${e}: needs steps, not one line`);
  }
});

/*
 * TikTok and the watermark, 3 Sept 2026.
 *
 * Youssef, on the Activity list: "error message?!?!?" One of the four read
 * "TikTok requires a clean copy without an app watermark. Choose a TikTok-safe
 * template and re-render this clip first."
 *
 * The advice named a "TikTok-safe template", which is not a thing on any
 * screen; and the refusal was OURS, not TikTok's -- the automatic
 * watermark-free copy it pointed at was only rendered on the LOCAL engine, so
 * on a remote worker (production) every TikTok post was refused before TikTok
 * was ever contacted. Every template has carried the mark by default since
 * v3.72.8, so that was all of them.
 *
 * v3.114.0 built the remote copy, so THE REFUSAL IS GONE. These tests moved
 * with the behaviour rather than being deleted: what they pin now is that the
 * app no longer refuses, that the guidance left over is about the RENDER
 * failing, and that the entries around it still win their own cases.
 */
test('the app no longer refuses a marked clip, on either engine', () => {
  const src = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');

  // The exact refusals that used to end the remote path. Neither may return.
  assert.ok(!/Choose a TikTok-safe template/i.test(src),
    'that template does not exist on any screen, so it could never be chosen');
  assert.ok(!/removing the DeenClipped\s*\n?\s*.?\s*mark is a paid feature/i.test(src),
    'the mark is stripped for TikTok automatically now, so nobody is told to buy their way past it');

  // Both engines reach ONE definition of clean, which is what stops them
  // disagreeing about what TikTok is sent.
  assert.match(src, /function cleanTemplateForTikTok/, 'one definition of clean');
  const uses = src.match(/cleanTemplateForTikTok\(/g) || [];
  assert.ok(uses.length >= 3, `both engines and the definition use it (saw ${uses.length})`);

  // And it is applied AFTER enforcePlan, or the free plan's mandatory
  // watermark would be put straight back on the copy TikTok refuses.
  const planned = src.indexOf('const planned = enforcePlan(');
  const stripped = src.indexOf("socialVariant === 'tiktok' ? cleanTemplateForTikTok(planned)");
  assert.ok(planned > -1 && stripped > planned,
    'the strip has to happen after enforcePlan, never before');
});

test('waiting for the copy is not the same as failing', () => {
  const engine = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  const agent = fs.readFileSync(new URL('../src/agent.js', import.meta.url), 'utf8');

  // The engine says "ask again", distinctly from "this failed".
  assert.match(engine, /pendingRender: true/, 'a distinct signal for still-rendering');

  // And the publisher acts on it BEFORE it counts an attempt. socialMaxAttempts
  // is 5 on a doubling backoff -- about half an hour -- so counting a wait
  // would file a good clip as failed while its copy was still in the queue.
  const at = agent.indexOf('if (error?.pendingRender)');
  const counts = agent.indexOf('target.attempts = Number(target.attempts || 0) + 1');
  assert.ok(at > -1, 'the publisher knows the difference');
  assert.ok(at < counts, 'and answers it before it spends an attempt');
  assert.match(agent.slice(at, counts), /return;/, 'the wait returns rather than falling through');
});

test('the guidance that is left is about the render, not the watermark', () => {
  const title = full => (explain(publishRow(full)) || {}).title;
  // What a customer can actually see now: the copy itself failing to render.
  const failed = 'The watermark-free copy TikTok requires could not be rendered: the render failed.';
  assert.match(title(failed), /could not be rendered/i, 'the render failure has its own answer');

  // Every entry that was already there still wins its own case. A wrong
  // WINNER was the entire bug the last time this table was touched (v3.30.0).
  assert.match(title('TikTok returned 403: TikTok has not finished reviewing this app'), /not reviewed/i);
  assert.match(title('spam_risk: too many pending posts'), /rate-limiting/i);
  assert.match(title('no access token for that account'), /expired/i);
});

test('nothing still tells a customer to switch the watermark off for TikTok', () => {
  // Read the ADVICE, not the source. A grep over the file matches the comment
  // that explains why the advice was removed -- the fourth time this repo has
  // been caught by a source-string test passing (or failing) on its own
  // explanation. So this drives explainFailure and reads what it returns.
  const said = row => {
    const answer = explain(publishRow(row)) || {};
    return [answer.title, answer.cause, ...(answer.fixes || [])].join(' ');
  };
  for (const row of [
    'The watermark-free copy TikTok requires could not be rendered: the render failed.',
    'TikTok requires a clean copy without an app watermark.',
    'TikTok returned 403: unaudited_client_can_only_post_to_private_accounts',
  ]) {
    assert.ok(!/switch the watermark off|turn the watermark off|TikTok-safe template/i.test(said(row)),
      `the app strips the mark itself now, so nothing should ask for it: ${row}`);
  }
});
