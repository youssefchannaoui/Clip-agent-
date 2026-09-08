import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * DeenAI V2 over HTTP, with two real accounts.
 *
 * The unit file drives the modules; this one drives the ROUTES, because that
 * is where the plan gate, the tenant boundary and the confirmation rule
 * actually live. A unit test cannot cross a request handler, and the gate that
 * mattered most in this feature's history — Ask sold at one tier and enforced
 * at another — was invisible to three law tests for exactly that reason.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-aiv2http-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'deenai-v2-http-secret-long-enough-for-it';
process.env.SOCIAL_TOKEN_KEY = 'deenai-v2-http-social-key-over-32-characters';

const { server } = await import('../src/server.js');
const base = `http://127.0.0.1:${server.address().port}`;
const { state, save: saveState } = await import('../src/store.js');
const billing = await import('../src/billing.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// The sign-up throttle is real (three per IP per day), so this file spends
// exactly two and reuses them.
async function signUp(email) {
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email, password: 'correct horse battery staple', returnTo: '/' }),
    redirect: 'manual',
  });
  const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie.startsWith('dc_session='), `${email} signed up`);
  return cookie;
}

const aliceCookie = await signUp('alice@deenclipped.test');
const bobCookie = await signUp('bob@deenclipped.test');

function userBy(email) {
  return (state.authUsers || []).find(u => u.email === email);
}
const alice = userBy('alice@deenclipped.test');
const bob = userBy('bob@deenclipped.test');
assert.ok(alice && bob, 'both accounts exist');

// Pro, so the gate is open and this file tests the FEATURE rather than the
// paywall (which deenai-gate.test.mjs already drives).
for (const user of [alice, bob]) {
  user.billing = { ...(user.billing || {}), plan: 'pro_monthly', status: 'active' };
}

state.projects = [
  { id: 'p-alice', userId: alice.id, title: 'Never lose hope', status: 'done' },
  { id: 'p-bob', userId: bob.id, title: "Bob's lecture", status: 'done' },
];
state.clips = [
  {
    id: 'clip-alice', userId: alice.id, projectId: 'p-alice', title: 'Mercy has no closing time',
    description: 'The original description.', status: 'approved', score: 88,
    scoreReasons: ['question hook', 'complete ending'], transcript: 'What if the door never closed?',
    startSec: 0, endSec: 32, addedAt: 1, renderVersion: 3,
  },
  {
    id: 'clip-bob', userId: bob.id, projectId: 'p-bob', title: "Bob's clip",
    status: 'approved', score: 90, scoreReasons: [], transcript: 'Bob only.',
    startSec: 0, endSec: 30, addedAt: 2,
  },
];
await saveState();

const as = cookie => (url, body, method) => fetch(`${base}${url}`, {
  method: method || (body === undefined ? 'GET' : 'POST'),
  headers: body === undefined
    ? { Cookie: cookie }
    : { 'Content-Type': 'application/json', Cookie: cookie },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const A = as(aliceCookie);
const B = as(bobCookie);

test('the screen payload is present without any model configured', async () => {
  const res = await A('/api/deenai/v2');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.unlocked, true);
  assert.equal(body.goals.length, 6, 'six growth goals');
  assert.ok(body.modes.length >= 6, 'the workflows');
  assert.ok(Array.isArray(body.today), 'today\'s actions are computed with no model');
  assert.equal(body.coverage.hasData, false);
  // The screen must be honest about what would answer, rather than offering
  // an ask box that will refuse.
  assert.equal(body.provider.ready, false, 'this deployment has neither model');
});

test('a signed-out request reaches nothing', async () => {
  for (const url of ['/api/deenai/v2', '/api/deenai/metrics', '/api/deenai/drafts', '/api/deenai/chats']) {
    const res = await fetch(`${base}${url}`);
    assert.equal(res.status, 401, `${url} refuses a stranger`);
  }
});

test('a goal saves and comes back', async () => {
  const res = await A('/api/deenai/goal', { goal: 'subscribers', niche: 'khutbahs' });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.profile.goal, 'subscribers');
  const again = await (await A('/api/deenai/v2')).json();
  assert.equal(again.goals.find(g => g.chosen).id, 'subscribers');
  // And it belongs to Alice alone.
  const bobs = await (await B('/api/deenai/v2')).json();
  assert.equal(bobs.goals.some(g => g.chosen), false, "Bob's account did not inherit it");
});

test('a goal the app does not offer is refused', async () => {
  const res = await A('/api/deenai/goal', { goal: 'world-domination' });
  assert.equal(res.status, 400);
});

test('imported results are per account, with a source and a date', async () => {
  const csv = 'Video title,Platform,Video publish time,Report date,Views,Average percentage viewed\n'
    + 'Mercy has no closing time,YouTube,2026-09-01,2026-09-07,1204,48\n';
  const res = await A('/api/deenai/metrics', { csv });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.imported, 1);
  assert.equal(body.coverage.hasData, true);
  assert.match(body.coverage.note, /entered by csv/);

  const mine = await (await A('/api/deenai/metrics')).json();
  assert.equal(mine.posts.length, 1);
  assert.equal(mine.posts[0].source, 'csv');
  assert.ok(mine.posts[0].measuredAt > 0);

  const theirs = await (await B('/api/deenai/metrics')).json();
  assert.equal(theirs.coverage.hasData, false, 'Bob sees none of it');
  assert.equal(theirs.posts.length, 0);
});

test('a CSV with no recognisable columns is refused rather than half-read', async () => {
  const res = await A('/api/deenai/metrics', { csv: 'alpha,beta\n1,2\n' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /column names/);
});

test('a draft is created without touching the clip, and accepting it never re-renders', async () => {
  const clip = state.clips.find(c => c.id === 'clip-alice');
  const before = { title: clip.title, renderVersion: clip.renderVersion, stylePending: clip.stylePending };

  // The draft tool is what DeenAI would call; called directly here because
  // this file has no model to drive it through.
  const tools = await import('../src/deenai-tools.js');
  const made = tools.runTool(alice, 'create_clip_variant', {
    clipId: 'clip-alice', title: 'The door that never closes', reason: 'shorter hook',
  }, { now: Date.now() });
  assert.equal(made.ok, true, made.error);
  assert.equal(clip.title, before.title, 'the clip is untouched while the draft exists');

  const listed = await (await A('/api/deenai/drafts?clipId=clip-alice')).json();
  assert.equal(listed.drafts.length, 1);
  const draftId = listed.drafts[0].id;

  // Bob cannot see it, and cannot decide it.
  const bobList = await (await B('/api/deenai/drafts')).json();
  assert.equal(bobList.drafts.length, 0);
  const bobAccept = await B(`/api/deenai/drafts/${draftId}/accept`, {});
  assert.equal(bobAccept.status, 404, "Bob cannot accept Alice's draft");
  assert.equal(clip.title, before.title, 'and nothing changed on the clip');

  const accept = await A(`/api/deenai/drafts/${draftId}/accept`, {});
  assert.equal(accept.status, 200);
  assert.equal(clip.title, 'The door that never closes', 'the accepted draft applied');
  // THE RULE THAT MATTERS: metadata never re-renders. One line moving
  // stylePending onto this path would silently start re-rendering every
  // retitled clip on a single-slot worker.
  assert.equal(clip.renderVersion, before.renderVersion, 'renderVersion did not move');
  assert.ok(!clip.stylePending, 'stylePending was not set');

  // And it is decided once.
  const again = await A(`/api/deenai/drafts/${draftId}/accept`, {});
  assert.equal(again.status, 409);
});

test('an experiment needs a measure, and belongs to one account', async () => {
  const bad = await A('/api/deenai/experiments', { hypothesis: 'shorter is better' });
  assert.equal(bad.status, 400);
  const good = await A('/api/deenai/experiments', {
    hypothesis: 'shorter is better', measure: 'keep rate', checkAfterDays: 7,
  });
  assert.equal(good.status, 200);
  const mine = await (await A('/api/deenai/v2')).json();
  assert.equal(mine.experiments.length, 1);
  const theirs = await (await B('/api/deenai/v2')).json();
  assert.equal(theirs.experiments.length, 0);
});

test('a recommendation outcome is recorded and counted', async () => {
  const res = await A('/api/deenai/recommendations', {
    recommendation: 'Post the shorter one first', followed: true, result: 'more comments', verdict: 'helpful',
  });
  assert.equal(res.status, 200);
  const payload = await (await A('/api/deenai/v2')).json();
  assert.equal(payload.recommendations.total, 1);
  assert.equal(payload.recommendations.helpful, 1);
});

test('with no model configured the chat stream fails honestly rather than hanging', async () => {
  const res = await A('/api/deenai/chat', { question: 'What should I post next?', mode: 'next' });
  assert.equal(res.status, 200, 'the stream itself opens');
  assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /event: failed/, 'and reports the failure as an event');
  assert.match(text, /No model is configured/);
});

test('a conversation on another account is not readable, deletable or ratable', async () => {
  const chat = await import('../src/deenai-chat.js');
  state.userSettings[alice.id] = state.userSettings[alice.id] || {};
  state.userSettings[alice.id].deenaiChats = [{
    id: 'conv-alice', title: 'Mine', mode: 'ask', clipId: '', createdAt: 1, updatedAt: 1,
    turns: [{ role: 'user', text: 'hi', at: 1 }, { role: 'assistant', text: 'hello', at: 1 }],
  }];
  await saveState();
  assert.equal((await (await A('/api/deenai/chats/conv-alice')).status), 200);
  assert.equal((await B('/api/deenai/chats/conv-alice')).status, 404);
  assert.equal((await B('/api/deenai/chats/conv-alice', undefined, 'DELETE')).status, 200);
  assert.ok(chat.conversation(alice, 'conv-alice'), "Bob's delete removed nothing of Alice's");
  const rate = await B('/api/deenai/feedback', { conversationId: 'conv-alice', turn: 1, rating: 'up' });
  assert.equal(rate.status, 404);
});

test('the plan gate still governs the whole feature', async () => {
  const previous = alice.billing.plan;
  alice.billing.plan = 'free';
  try {
    const payload = await (await A('/api/deenai/v2')).json();
    assert.equal(payload.unlocked, false);
    assert.deepEqual(payload.today, [], 'a locked account is given no computed plan');
    const chat = await A('/api/deenai/chat', { question: 'hello', mode: 'ask' });
    assert.equal(chat.status, 403);
    const body = await chat.json();
    // Named from the FEATURES table, never a typed tier.
    assert.match(body.error, new RegExp(billing.FEATURES.deenaiAsk.tier, 'i'));
  } finally {
    alice.billing.plan = previous;
  }
});
