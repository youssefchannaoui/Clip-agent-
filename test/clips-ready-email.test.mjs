import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The pipeline takes ~20 minutes and people leave. The completion email is
// what brings them back to a review queue that never posts without them.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-ready-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'clips-ready-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const { state } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const engine = await import('../src/local-engine.js');

const mails = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('resend.com')) {
    const body = JSON.parse(options.body);
    mails.push({ to: body.to[0], subject: body.subject, text: body.text });
    return new Response('{"id":"m"}', { status: 200 });
  }
  return new Response('{}', { status: 200 });
};
test.after(async () => {
  globalThis.fetch = realFetch;
  // The last test's acceptRemoteUpdate leaves an async save in flight; deleting
  // the directory under its rename made the FILE flake in parallel runs while
  // every test in it passed. Let the write land before pulling the floor.
  await new Promise(resolve => setTimeout(resolve, 50));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

config.emailApiKey = 'test-key';
config.emailFrom = 'DeenClipped <hello@deenclipped.online>';

test('a finished lecture emails its owner, with the count and the review link', async () => {
  state.authUsers.push({ id: 'u1', email: 'creator@example.com', role: 'creator', providers: {}, createdAt: Date.now() });
  state.projects.push({ id: 'pr1', userId: 'u1', title: 'Patience under pressure', status: 'processing', engine: 'remote', submittedAt: Date.now() });

  engine.acceptRemoteUpdate('pr1', {
    status: 'completed',
    result: { clips: [
      { id: 'c1', title: 'One', clipUrl: 'https://cdn/1.mp4', thumbUrl: 'https://cdn/1.jpg' },
      { id: 'c2', title: 'Two', clipUrl: 'https://cdn/2.mp4', thumbUrl: 'https://cdn/2.jpg' },
    ] },
  });
  // The send is fire-and-forget; give the microtask queue one turn.
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(mails.length, 1, 'one completion, one email');
  assert.equal(mails[0].to, 'creator@example.com', 'the owner, not the operator');
  assert.match(mails[0].subject, /2 clips ready to review/);
  assert.match(mails[0].subject, /Patience under pressure/);
  assert.match(mails[0].text, /deenclipped\.online\/app#review/, 'the link lands on the review queue');
  assert.match(mails[0].text, /Nothing posts until you approve/i, 'the promise that makes the email safe to send');
});

test('a completion with email unconfigured stays silent and does not throw', async () => {
  config.emailApiKey = '';
  state.projects.push({ id: 'pr2', userId: 'u1', title: 'Second lecture', status: 'processing', engine: 'remote', submittedAt: Date.now() });
  engine.acceptRemoteUpdate('pr2', { status: 'completed', result: { clips: [{ id: 'c3', title: 'T', clipUrl: 'https://cdn/3.mp4', thumbUrl: 'https://cdn/3.jpg' }] } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(mails.length, 1, 'no new mail, no crash');
  config.emailApiKey = 'test-key';
});


test('a clip emails once when its LAST platform finishes, successes and misses together', async () => {
  const mailer = await import('../src/mailer.js');
  const message = mailer.postSummaryMessage({
    clipTitle: 'The verse that stops the scroll',
    targets: [
      { provider: 'youtube', status: 'posted', postUrl: 'https://youtu.be/abc' },
      { provider: 'tiktok', status: 'posted', postUrl: 'https://tiktok.com/x' },
      { provider: 'instagram', status: 'failed' },
    ],
    scheduleUrl: 'https://deenclipped.online/app#schedule',
  });
  assert.match(message.subject, /live on YouTube, TikTok/);
  assert.match(message.text, /youtu\.be\/abc/);
  assert.match(message.text, /Did not go out: Instagram/, 'the miss rides in the same message as the wins');
});

test('a failed lecture email names the problem and points at the fix, not just the grave', async () => {
  const mailer = await import('../src/mailer.js');
  const message = mailer.lectureFailedMessage({
    title: 'Friday khutbah',
    reason: 'YouTube refused this download.',
    dashboardUrl: 'https://deenclipped.online/app',
  });
  assert.match(message.subject, /could not process/i);
  assert.match(message.text, /YouTube refused/);
  assert.match(message.text, /Nothing was charged/, 'the money worry is answered unprompted');
  assert.match(message.text, /deenclipped\.online\/app/);
});

test('a final failure emails the owner with the classified reason', async () => {
  state.projects.push({ id: 'pr3', userId: 'u1', title: 'Failing lecture', status: 'processing', engine: 'remote', submittedAt: Date.now() });
  const before = mails.length;
  engine.acceptRemoteUpdate('pr3', { status: 'failed', error: 'socialkit: This video is unavailable', progress: 3 });
  await new Promise(resolve => setImmediate(resolve));
  const failMail = mails.slice(before).find(mail => /could not process/i.test(mail.subject));
  assert.ok(failMail, 'the failure email went out');
  assert.equal(failMail.to, 'creator@example.com');
});
