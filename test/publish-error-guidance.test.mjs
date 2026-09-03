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
 * Two things were wrong with it. The advice named a "TikTok-safe template",
 * which is not a thing on any screen in this product. And the refusal is
 * OURS, not TikTok's: socialPublishFile refuses before TikTok is contacted,
 * and the automatic watermark-free copy it points at is only rendered on the
 * LOCAL engine -- so on a remote worker, which is production, every TikTok
 * post was refused here. Every template has carried the mark by default since
 * v3.72.8, so that is all of them.
 */
test('the watermark refusal has an answer, and it does not displace the others', () => {
  const title = full => (explain(publishRow(full)) || {}).title;
  const watermark = 'TikTok does not accept a video carrying another app’s watermark. '
    + 'Turn the watermark off on the "Clean Line" template, then re-render this clip and retry.';
  assert.match(title(watermark), /watermark/i, 'the watermark case has its own answer');
  // The older wording is still in flight on rows already on disk.
  assert.match(title('TikTok requires a clean copy without an app watermark.'), /watermark/i);
  // And every entry that was already there still wins its own case. A wrong
  // WINNER was the entire bug the last time this table was touched (v3.30.0).
  assert.match(title('TikTok returned 403: TikTok has not finished reviewing this app'), /not reviewed/i);
  assert.match(title('spam_risk: too many pending posts'), /rate-limiting/i);
  assert.match(title('no access token for that account'), /expired/i);
});

test('the refusal itself names something a person can actually do', () => {
  const src = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  // The refusal the customer is shown, not the module's other uses of the
  // phrase: the local clean-render path legitimately names itself that in a
  // log line and an internal template name, and nobody reads those.
  const at = src.indexOf("if (String(template?.watermark");
  assert.ok(at > -1, 'the refusal is still there');
  // A fixed window, not up to the next `}`: the message interpolates the
  // template's name, so the first brace is inside the string itself.
  const refusal = src.slice(at, at + 1200);
  assert.match(refusal, /watermark/i);
  assert.ok(!/TikTok-safe template/i.test(refusal),
    'that template does not exist on any screen, so it cannot be chosen');
  // Paid accounts can switch the mark off; free accounts cannot, and the
  // message has to say which of those the reader is.
  assert.match(refusal, /planFeatures\(owner\)\.watermark/,
    'the advice depends on whether this account may remove the mark at all');
  assert.match(refusal, /paid feature/, 'and says so plainly when it may not');
});
