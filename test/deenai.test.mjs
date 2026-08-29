import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * DeenAI over real HTTP: the demo is viewable by everyone signed in, the
 * feature is usable by nobody who has not paid, and the insights are the
 * account's own arithmetic — checked against clips this test seeds, so a
 * card that stops matching its data fails here rather than on screen.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-deenai-'));
const port = 34000 + Math.floor(Math.random() * 4000);

process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.SOCIAL_TOKEN_KEY = 'deenai-test-social-key-over-32-characters!!';
delete process.env.WORKER_BASE_URL; // local mode: ask must refuse honestly, not hang

const base = `http://127.0.0.1:${port}`;

const { server } = await import('../src/server.js');
const store = await import('../src/store.js');
const deenai = await import('../src/deenai.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

async function signUp(email, password) {
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email, password, returnTo: '/' }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), 'expected a session cookie');
  const me = await (await fetch(`${base}/api/auth/me`, { headers: { Cookie: cookie } })).json();
  return { cookie, id: me.user.id };
}

function seedClip(userId, over = {}) {
  const clip = {
    id: 'clip-' + Math.random().toString(36).slice(2, 10),
    userId, projectId: 'proj-a', title: 'Why do we pray at all', description: '', hashtags: '',
    status: 'waiting', targets: [], addedAt: Date.now(), score: 70,
    ...over,
  };
  store.state.clips.push(clip);
  return clip;
}

test('signed out gets 401 on both DeenAI routes', async () => {
  assert.equal((await fetch(`${base}/api/deenai`)).status, 401);
  const ask = await fetch(`${base}/api/deenai/ask`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'anything' }),
  });
  assert.equal(ask.status, 401);
});

test('a free account can look at the demo but cannot ask', async () => {
  const free = await signUp('free@deenclipped.test', 'a long enough password');

  const view = await (await fetch(`${base}/api/deenai`, { headers: { Cookie: free.cookie } })).json();
  assert.equal(view.pro, false);
  assert.equal(view.demo, true);
  assert.ok(view.insights.length >= 3, 'the shop window shows real-shaped cards');
  assert.ok(view.insights.every(card => card.demo === true), 'every demo card says it is a demo');

  const ask = await fetch(`${base}/api/deenai/ask`, {
    method: 'POST', headers: { Cookie: free.cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: 'How do I grow?' }),
  });
  assert.equal(ask.status, 403);
  assert.match((await ask.json()).error, /Pro feature/);
});

test('a paid account gets insights computed from its own clips', async () => {
  const pro = await signUp('pro@deenclipped.test', 'another long password here');
  const user = store.state.authUsers.find(u => u.id === pro.id);
  user.billing = { ...(user.billing || {}), plan: 'monthly', status: 'active' };

  store.state.projects.push({ id: 'proj-a', userId: pro.id, title: 'Patience in Hardship', status: 'done' });
  // Four clips from one lecture, three kept: the best-lecture card must say 3 of 4.
  seedClip(pro.id, { status: 'approved', score: 82 });
  seedClip(pro.id, { status: 'posted', postedAt: Date.now() - 1000, score: 78 });
  seedClip(pro.id, { status: 'scheduled', score: 74 });
  seedClip(pro.id, { status: 'rejected', score: 40 });

  const view = await (await fetch(`${base}/api/deenai`, { headers: { Cookie: pro.cookie } })).json();
  assert.equal(view.pro, true);
  assert.equal(view.demo, false);
  const lecture = view.insights.find(card => /Clip more from/.test(card.title));
  assert.ok(lecture, 'the best-lecture card appears once a lecture has 3+ clips');
  assert.match(lecture.title, /Patience in Hardship/);
  assert.match(lecture.body, /kept 3 of its 4 clips/);
  assert.ok(view.insights.every(card => !card.demo), 'nothing a Pro sees is marked demo');
});

test('ask refuses an empty question, an over-long one, and a deployment with no worker', async () => {
  const cookie = (await signUp('asker@deenclipped.test', 'a third long password')).cookie;
  const user = store.state.authUsers.find(u => u.email === 'asker@deenclipped.test');
  user.billing = { ...(user.billing || {}), plan: 'monthly', status: 'active' };

  const post = body => fetch(`${base}/api/deenai/ask`, {
    method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal((await post({ question: '   ' })).status, 400);
  assert.equal((await post({ question: 'x'.repeat(501) })).status, 400);
  // This test runs in local mode, where there is no Ollama to hand the
  // question to. The honest answer is 503 with a sentence, not a hang.
  const noWorker = await post({ question: 'What should I clip next?' });
  assert.equal(noWorker.status, 503);
  assert.match((await noWorker.json()).error, /render worker/);
});

test('the ask context is numbers and titles, never transcript text', () => {
  const user = store.state.authUsers.find(u => u.email === 'pro@deenclipped.test');
  store.state.clips.filter(c => c.userId === user.id).forEach(c => {
    c.transcript = [{ text: 'SECRET SERMON TEXT', startSec: 0, endSec: 3 }];
    c.description = 'SECRET DESCRIPTION';
  });
  const context = JSON.stringify(deenai.askContext(user));
  assert.ok(!context.includes('SECRET'), 'transcripts and descriptions must never reach the model');
  assert.ok(context.includes('clipsKept'), 'the numbers do');
});

test('insight cards stay honest when the data is too thin to say anything', () => {
  const thin = { id: 'thin-user' };
  store.state.clips.push({ id: 'only-clip', userId: 'thin-user', projectId: 'p-thin', status: 'waiting', title: 'One clip', targets: [] });
  const cards = deenai.insights(thin);
  assert.ok(!cards.some(card => /Clip more from/.test(card.title)), 'one clip is not a keep rate');
  assert.ok(!cards.some(card => /Your bar is around/.test(card.title)), 'no approval bar from zero approvals');
});
