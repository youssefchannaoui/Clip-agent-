import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Nothing told anyone when the product broke. The worker could be down or
// backups failing for days and the only trace was a line in a feed nobody
// reads. These pin the two things that make an alert useful: it arrives once,
// and it says when the problem is over.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-alerts-'));
process.env.OPERATOR_EMAILS = 'owner@example.com';

const alerts = await import('../src/alerts.js');
const mailer = await import('../src/mailer.js');
const { config } = await import('../src/config.js');

// Intercept at the network rather than the module: ES exports cannot be
// reassigned, and going through the real mailer means these also prove the
// alert actually turns into a request a provider would accept.
const sent = [];
const pushed = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  // Two transports, two shapes: ntfy takes plain text with a Title header,
  // the email providers take JSON.
  if (String(url).includes('ntfy.sh')) {
    pushed.push({ topic: String(url).split('/').pop(), title: options.headers?.Title, body: options.body });
    return new Response('{}', { status: 200 });
  }
  const body = JSON.parse(options.body);
  sent.push({ to: body.to?.[0] ?? body.To, subject: body.subject ?? body.Subject, text: body.text ?? body.TextBody });
  return new Response(JSON.stringify({ id: 'test' }), { status: 200 });
};
test.after(() => { globalThis.fetch = realFetch; });

config.emailApiKey = 'test-key';
config.emailFrom = 'DeenClipped <hello@deenclipped.online>';
assert.equal(mailer.configured(), true);

test.beforeEach(() => { sent.length = 0; pushed.length = 0; alerts.reset(); });

test('a new problem alerts once, and staying broken does not alert again', async () => {
  await alerts.report('worker', true, 'connection refused');
  assert.equal(sent.length, 1, 'the first failure is reported');
  assert.match(sent[0].subject, /problem: worker/);
  assert.match(sent[0].text, /connection refused/);

  // The same condition, checked every five minutes for an hour.
  for (let i = 0; i < 12; i += 1) await alerts.report('worker', true, 'connection refused');
  assert.equal(sent.length, 1,
    'an alert that arrives every five minutes is one that gets filtered, and then the real one is too');
});

test('recovery is reported, because knowing it is over is half the value', async () => {
  await alerts.report('worker', true, 'connection refused');
  sent.length = 0;
  await alerts.report('worker', false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].subject, /recovered: worker/);
});

test('a condition that recovers can alert again when it breaks again', async () => {
  // Flapping must not be silent: the second outage is still an outage.
  await alerts.report('backups', true, 'first');
  await alerts.report('backups', false);
  sent.length = 0;
  await alerts.report('backups', true, 'second');
  assert.equal(sent.length, 1, 'the next failure alerts');
  assert.match(sent[0].text, /second/);
});

test('a recovery with nothing broken says nothing', async () => {
  await alerts.report('worker', false);
  assert.equal(sent.length, 0, 'a healthy check is not news');
});

test('problems are tracked separately', async () => {
  await alerts.report('worker', true, 'down');
  await alerts.report('backups', true, 'refused');
  assert.equal(sent.length, 2);
  await alerts.report('worker', false);
  assert.deepEqual(alerts.active().map(a => a.key), ['backups'],
    'clearing one leaves the other standing');
});

test('with no email configured the problem is still recorded, not lost', async () => {
  const key = config.emailApiKey;
  try {
    config.emailApiKey = '';
    await alerts.report('worker', true, 'down');
    assert.equal(sent.length, 0, 'nothing can be sent');
    assert.equal(alerts.active().length, 1, 'but the condition is still tracked and logged');
  } finally { config.emailApiKey = key; }
});


test('alerts also reach the push channel, which needs no email provider at all', async () => {
  // Production ran for weeks with the email transport unconfigured, so every
  // alert was composed and then silently dropped. The push channel is one env
  // var with no account behind it -- the transport that cannot be forgotten.
  config.alertNtfyTopic = 'test-topic';
  await alerts.report('worker', true, 'not answering');
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].topic, 'test-topic');
  assert.match(pushed[0].title, /problem: worker/);
  assert.match(pushed[0].body, /not answering/);
  config.alertNtfyTopic = '';
});

test('one failed lecture is quiet; a cluster inside an hour is an outage', async () => {
  await alerts.jobFailed('Lecture A', 'import blew up');
  await alerts.jobFailed('Lecture B', 'import blew up');
  assert.equal(sent.length, 0, 'two failures could be two bad links');
  await alerts.jobFailed('Lecture C', 'import blew up');
  assert.equal(sent.length, 1, 'three in an hour is a pattern');
  assert.match(sent[0].subject, /problem: jobs/);
  assert.match(sent[0].text, /3 lectures/);
  assert.match(sent[0].text, /Lecture C/);
});

test('a success closes the failure window and the open alert', async () => {
  await alerts.jobFailed('A', 'x');
  await alerts.jobFailed('B', 'x');
  await alerts.jobFailed('C', 'x');
  assert.equal(sent.length, 1);
  await alerts.jobSucceeded();
  assert.match(sent[1].subject, /recovered: jobs/);
  // The window restarts from zero: the next failure is one, not four.
  await alerts.jobFailed('D', 'x');
  assert.equal(sent.length, 2, 'one failure after recovery stays quiet');
});


test('every failure alert carries its repair manual; recoveries stay short', async () => {
  // The owner reads these on a phone at an inconvenient hour. "worker is
  // failing" without the next action is a fright, not an alert.
  await alerts.report('worker', true, 'not answering');
  assert.match(sent[0].text, /What to do:/);
  assert.match(sent[0].text, /docker compose/, 'the exact command, not a vague suggestion');
  await alerts.report('worker', false);
  assert.doesNotMatch(sent[1].text, /What to do:/, 'good news needs no manual');

  alerts.reset(); sent.length = 0;
  await alerts.jobFailed('A', 'x'); await alerts.jobFailed('B', 'x'); await alerts.jobFailed('C', 'x');
  assert.match(sent[0].text, /What to do:/);
  assert.match(sent[0].text, /Owner tab/, 'points at the screen that diagnoses it');
});
