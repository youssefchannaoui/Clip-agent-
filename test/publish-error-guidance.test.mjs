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
