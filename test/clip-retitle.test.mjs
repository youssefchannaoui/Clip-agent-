import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A NEW TITLE COSTS NOTHING BUT THE ASK.
 *
 * Youssef, 4 Sept 2026: "there should be, like, a star ... which will create,
 * like, a different title without rerendering the video ... no rerendering
 * needs to be done with titlings, of course."
 *
 * That is already true and this pins it: the title is metadata on the clip and
 * is never burned into the frame (the hook overlay is hard-disabled,
 * invariant 9), and `updateClip` writes title/description without touching
 * `stylePending` -- the flag that marks a render out of date and is what the
 * template sweep re-renders on. A single line moving that flag onto this path
 * would silently start re-rendering every retitled clip, so it is DRIVEN here
 * rather than trusted.
 *
 * A fake worker stands in for the box: the whole point is the route, the
 * fencing of the customer's own instruction, and what is written back.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-retitle-'));

// The stub worker, up BEFORE the app imports config -- WORKER_URL is read once.
const seen = [];
let reply = { title: 'Never lose hope in the mercy of Allah', source: 'ai' };
let status = 200;
const worker = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    seen.push({ path: req.url, body: JSON.parse(body || '{}') });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(reply));
  });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));

process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'retitle-secret-long-enough-for-the-check';
process.env.SOCIAL_TOKEN_KEY = 'retitle-test-social-key-over-32-characters-x';
process.env.PROCESSING_MODE = 'remote';
process.env.WORKER_BASE_URL = `http://127.0.0.1:${worker.address().port}`;
process.env.WORKER_SHARED_SECRET = 'retitle-worker-shared-secret';

const { server } = await import('../src/server.js');
const store = await import('../src/store.js');
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => new Promise(resolve => server.close(() => worker.close(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir is harmless */ }
  resolve();
}))));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// One sign-up, reused: the sign-in throttle is real and a file that spends it
// reports a broken route when the route is fine.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'retitle@deenclipped.test', password: 'correct horse battery staple', returnTo: '/' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
assert.ok(cookie.startsWith('dc_session='), 'signed up');

const userId = store.state.authUsers.find(u => u.email === 'retitle@deenclipped.test').id;

/** DeenAI's tier, so the four behaviour tests below exercise the route rather
 *  than the gate. The gate has its own test at the end of this file, and a free
 *  account is asserted there -- without that pair, moving this fixture to Pro
 *  would have quietly deleted the only proof the gate exists. */
function setPlan(plan) {
  // The billing record lives ON the user, not in a side table keyed by id.
  const user = store.state.authUsers.find(u => u.id === userId);
  user.billing = plan
    ? { plan, status: 'active', currentPeriodEnd: Date.now() + 86400000 }
    : {};
  store.save();
}
setPlan('pro_monthly');

function seed(over = {}) {
  store.state.projects = [{ id: 'p1', userId, title: 'Never Lose Hope - Muhammad Hoblos', status: 'done' }];
  store.state.clips = [Object.assign({
    id: 'c1', userId, projectId: 'p1', title: 'At the difference', description: 'old description',
    status: 'waiting', transcript: 'Allah does not turn away the one who comes back to Him.',
    templateId: 'clean-line', renderQuality: 'final', renderVerified: true,
    ayahs: [], stylePending: false, targets: [],
  }, over)];
  store.save();
  return store.state.clips[0];
}

const send = (url, body) => fetch(`${base}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body),
});

test('a retitle writes the new title and NOTHING marks the render stale', async () => {
  seed();
  const res = await send('/api/clips/c1/retitle', {});
  const out = await res.json();
  assert.equal(res.status, 200, out.error || '');
  assert.equal(out.value, 'Never lose hope in the mercy of Allah');

  const clip = store.state.clips[0];
  assert.equal(clip.title, 'Never lose hope in the mercy of Allah', 'written to the clip');
  assert.notEqual(clip.stylePending, true,
    'THE WHOLE POINT: a new title must not mark the rendered video out of date');
});

test("the customer's own instruction reaches the worker, and is the only free text that does", async () => {
  seed();
  seen.length = 0;
  await send('/api/clips/c1/retitle', { instruction: 'make the title Arabic' });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/ai/title');
  assert.equal(seen[0].body.instruction, 'make the title Arabic');
  assert.equal(seen[0].body.lectureTitle, 'Never Lose Hope - Muhammad Hoblos',
    'the lecture title travels, because it is the only place a speaker may be named from');
});

test('a description is a different kind, and lands on the description', async () => {
  seed();
  reply = { title: 'A short reminder that the door of repentance never closes.', source: 'ai' };
  const res = await send('/api/clips/c1/retitle', { kind: 'description' });
  const out = await res.json();
  assert.equal(res.status, 200, out.error || '');
  assert.equal(store.state.clips[0].description, 'A short reminder that the door of repentance never closes.');
  assert.equal(store.state.clips[0].title, 'At the difference', 'and the title is untouched');
  reply = { title: 'Never lose hope in the mercy of Allah', source: 'ai' };
});

test("the matcher's verses travel, so a recitation is never guessed at", async () => {
  seed({ ayahs: [{ surah: 39, ayah: 71, surahName: 'Az-Zumar', translation: 'And those who disbelieved' }] });
  seen.length = 0;
  await send('/api/clips/c1/retitle', {});
  assert.equal(seen[0].body.ayahs.length, 1);
  assert.equal(seen[0].body.ayahs[0].surahName, 'Az-Zumar');
});

test('ANOTHER SIGNED-IN ACCOUNT CANNOT RETITLE THIS CLIP', async () => {
  /*
   * Owner-scoped lookup, not a check bolted on afterwards -- the shape every
   * IDOR would have had, and the posture the security audit named.
   *
   * It has to be a SECOND SIGNED-IN account. The first version of this test
   * sent no cookie at all and passed with the guard REMOVED, because the 401
   * came from the auth layer and the route was never reached -- a probe that
   * cannot go red proves nothing.
   */
  seed();
  const other = await fetch(`${base}/auth/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ email: 'stranger@deenclipped.test', password: 'correct horse battery staple', returnTo: '/' }),
    redirect: 'manual',
  });
  const theirs = (other.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(theirs.startsWith('dc_session='), 'the second account signed up');

  const res = await fetch(`${base}/api/clips/c1/retitle`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: theirs }, body: '{}',
  });
  assert.equal(res.status, 404, 'someone else\'s clip does not exist to them');
  assert.equal(store.state.clips[0].title, 'At the difference', 'and nothing was written');
});

test('a worker that refuses is reported, not swallowed', async () => {
  seed();
  status = 503;
  reply = { error: 'Rewriting a title needs the clip AI.', code: 'ollama_unavailable' };
  const res = await send('/api/clips/c1/retitle', {});
  assert.notEqual(res.status, 200);
  assert.equal(store.state.clips[0].title, 'At the difference', 'the old title stands');
  status = 200;
  reply = { title: 'Never lose hope in the mercy of Allah', source: 'ai' };
});

test('the route never touches the transcript or the render', async () => {
  seed();
  const before = { ...store.state.clips[0] };
  await send('/api/clips/c1/retitle', { instruction: 'shorter' });
  const after = store.state.clips[0];
  for (const key of ['transcript', 'renderQuality', 'renderVerified', 'templateId', 'status']) {
    assert.deepEqual(after[key], before[key], `${key} must not move`);
  }
  assert.notEqual(after.transcriptEdited, true, 'and the clip is not marked edited');
});


test('the clip AI is DeenAI, so a free account is refused and told which plan', async () => {
  // It shipped in v3.120.0 with NO gate: every free account could spend the
  // box's Ollama. Youssef, 4 Sept 2026: "DeenAI should be for pro users and
  // up." Proven RED by removing the deenaiAccess check from the route.
  setPlan('');
  try {
    seed();
    const res = await send('/api/clips/c1/retitle', {});
    const out = await res.json();
    assert.equal(res.status, 403, 'a free account may not spend the clip AI');
    assert.match(out.error, /Pro/, 'and is told which plan buys it');
    assert.equal(store.state.clips[0].title, 'At the difference', 'nothing was written');
  } finally {
    setPlan('pro_monthly');
  }
});

test('Studio gets it too -- the tiers are cumulative', async () => {
  setPlan('studio_monthly');
  try {
    seed();
    const res = await send('/api/clips/c1/retitle', {});
    assert.equal(res.status, 200, 'Studio has everything Pro has');
  } finally {
    setPlan('pro_monthly');
  }
});

test('a named shape travels as `style`, never as the customer\'s free text', async () => {
  // The distinction is load-bearing: `instruction` is what a customer typed and
  // overrides the recitation reference; `style` is one of OUR OWN named shapes
  // and must not, or a shape chip would push scripture through a 1.7B model.
  seed();
  seen.length = 0;
  const res = await send('/api/clips/c1/retitle', { kind: 'title', style: 'question' });
  assert.equal(res.status, 200);
  const sent = seen.at(-1).body;
  assert.equal(sent.style, 'question');
  assert.equal(sent.instruction, '', 'a shape is not free text');
});
