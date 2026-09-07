import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * THE ACCOUNT CHOOSES ITS OWN POSTING TIMES.
 *
 * Youssef, 7 Sept 2026: "they can select which hours they would like to do ...
 * even with the four clip, just regular Pro users, they can either turn off,
 * like, make it twice a day, not four times a day, or they can change the
 * times."
 *
 * The hazard this feature walks straight into is the one server.js already
 * carried a comment about: the DISPLAY and the SCHEDULER used to work the
 * windows out separately, and a Studio customer was shown four while eight
 * were filled. So the tests that matter here are not "does the setting save"
 * but "does every reader give the same answer", and "what happens when the
 * account switches everything off".
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-windows-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'posting-windows-test-secret-long-enough';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.POST_TIMES = '07:00,12:00,17:00,20:30';

const slots = await import('../src/slots.js');
const billing = await import('../src/billing.js');
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');
const { config } = await import('../src/config.js');
const { server } = await import('../src/server.js');
await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir must never fail a green suite */ }
});

/* One real account. The sign-up throttle is real (three per IP per day) and a
 * file that spends it reports a broken route when the route is fine. */
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'windows@deenclipped.test', password: 'correct horse battery staple', returnTo: '/app' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
const auth = await import('../src/auth.js');
const userNow = () => auth.currentUser({ headers: { cookie } });

const save = windows => fetch(`${base}/api/posting-windows`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie },
  body: JSON.stringify({ windows }),
});
const stateNow = async () => (await fetch(`${base}/api/state`, { headers: { cookie } })).json();

test('a fresh account gets the shipped windows, all on', async () => {
  const data = await stateNow();
  assert.deepEqual(data.postTimes, ['07:00', '12:00', '17:00', '20:30']);
  assert.equal(data.postWindowAllowance, 4);
  assert.deepEqual(data.postWindows.map(w => w.on), [true, true, true, true],
    'nothing is switched off until somebody switches it off');
});

test('switching two off makes it twice a day, everywhere at once', async () => {
  const res = await save([
    { at: '07:00', on: true }, { at: '12:00', on: false },
    { at: '17:00', on: false }, { at: '20:30', on: true },
  ]);
  assert.equal(res.status, 200);

  /* The whole point of the feature: the payload the screen draws from and the
   * list the scheduler fills have to be the same list. Derived separately, they
   * drifted -- that is what server.js's own comment is about. */
  const data = await stateNow();
  assert.deepEqual(data.postTimes, ['07:00', '20:30'], 'the payload');
  assert.deepEqual(billing.postingWindowsFor(userNow()).times, ['07:00', '20:30'], 'the scheduler');
  assert.deepEqual(data.postWindows.map(w => w.at), ['07:00', '12:00', '17:00', '20:30'],
    'an off window is still drawn, or it could never be switched back on');
});

test('a changed time reaches the scheduler', async () => {
  const res = await save([
    { at: '05:15', on: true }, { at: '12:00', on: true },
    { at: '17:00', on: true }, { at: '20:30', on: true },
  ]);
  assert.equal(res.status, 200);
  assert.deepEqual(billing.postingWindowsFor(userNow()).times, ['05:15', '12:00', '17:00', '20:30']);
  assert.deepEqual((await stateNow()).postTimes, ['05:15', '12:00', '17:00', '20:30']);
});

test('the times are sorted however they arrive', async () => {
  await save([
    { at: '20:30', on: true }, { at: '07:00', on: true },
    { at: '17:00', on: true }, { at: '12:00', on: true },
  ]);
  /* nextSlot walks the list in order inside a day, so an unsorted list hands
   * out a later time before an earlier one and the schedule reads as random. */
  assert.deepEqual(billing.postingWindowsFor(userNow()).times, ['07:00', '12:00', '17:00', '20:30']);
});

test('switching every window off is refused', async () => {
  const res = await save([
    { at: '07:00', on: false }, { at: '12:00', on: false },
    { at: '17:00', on: false }, { at: '20:30', on: false },
  ]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /at least one/i);
  /* And the reason it is refused rather than clamped: nextSlot falls back to
   * the SERVER's configured times when handed an empty list, so an account
   * that switched everything off would go on posting at exactly the times it
   * had just turned off. */
  assert.deepEqual(slots.resolveWindows(4, [{ at: '07:00', on: false }, { at: '12:00', on: false }, { at: '17:00', on: false }, { at: '20:30', on: false }]),
    ['07:00', '12:00', '17:00', '20:30'],
    'even asked directly, the resolver never answers with nothing');
});

test('two windows at one time are refused', async () => {
  const res = await save([{ at: '07:00', on: true }, { at: '07:00', on: true }]);
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /07:00/);
});

test('a time that is not a time is refused', async () => {
  for (const at of ['25:00', '07:99', 'lunchtime', '']) {
    const res = await save([{ at, on: true }]);
    assert.equal(res.status, 400, `${at} should be refused`);
  }
});

test('more windows than the plan allows is refused, not silently trimmed', async () => {
  const res = await save(Array.from({ length: 8 }, (_, i) => ({ at: `0${i}:00`, on: true })));
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /4 posting windows/);
});

test('a downgrade truncates on READ and never rewrites the arrangement', () => {
  /* Studio's eight, kept on disk. The plan is what decides how many are used,
   * so lapsing to Pro must not destroy the other four -- resubscribing gets
   * them back. That is the rule accountsPerPlatform already follows. */
  const eight = Array.from({ length: 8 }, (_, i) => ({ at: `0${i}:00`, on: true }));
  store.setPostingWindowsRaw(userNow(), eight);
  assert.deepEqual(slots.resolveWindows(4, eight), ['00:00', '01:00', '02:00', '03:00'], 'Pro fills four');
  assert.deepEqual(slots.resolveWindows(8, eight).length, 8, 'Studio fills eight');
  assert.equal(store.postingWindowsRaw(userNow()).length, 8, 'all eight are still on disk');
});

test('the scheduler itself lands a clip in the account’s own windows', () => {
  /* Driven through agent.scheduleApprovedClip rather than through the setting.
   * A first cut of this test read billing.postingWindowsFor for BOTH the
   * expectation and the answer, so it never entered agent.js at all -- and the
   * red probe that made the scheduler derive its own four windows sailed
   * straight past it. A test that asserts what it has just computed proves the
   * computation, not the schedule.
   */
  store.setPostingWindowsRaw(userNow(), [
    { at: '06:00', on: true }, { at: '12:00', on: false },
    { at: '17:00', on: false }, { at: '21:45', on: true },
  ]);
  const owner = userNow();
  const clip = {
    id: 'clip-windows-1', userId: owner.id, ownerId: owner.id, projectId: 'p1',
    title: 'A clip', status: 'approved', approvedAt: Date.now(), targets: [],
  };
  store.state.clips.push(clip);
  agent.scheduleApprovedClip(clip);

  const at = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(clip.scheduledAt));
  assert.ok(['06:00', '21:45'].includes(at),
    `the scheduler chose ${at}, which is not one of the two windows left switched on`);
});

test('nobody works the windows out for themselves any more', () => {
  /* The four-way duplication is the fault this feature could most easily
   * reintroduce, and it is invisible when it comes back: both halves look
   * correct in isolation and simply disagree. */
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const file of ['src/server.js', 'src/agent.js', 'src/deenai.js']) {
    const src = strip(fs.readFileSync(file, 'utf8'));
    assert.ok(!/postTimesFor\s*\(/.test(src), `${file} derives its own windows`);
    assert.ok(!/config\.postTimes/.test(src), `${file} reads the server list instead of the account's`);
    assert.ok(/postingWindowsFor\(/.test(src), `${file} should ask billing.postingWindowsFor`);
  }
});

test('the panel says the summary once, and draws its own tick', () => {
  /* BOTH of these were found by LOOKING at the rendered card, not by any
   * measurement -- the panel measured perfectly aligned in both themes at
   * three widths while saying the same sentence twice and drawing a state
   * control with no mark in it. A green suite is never verification for
   * anything visual, and these are the two halves that CAN be pinned. */
  const src = fs.readFileSync('src/public/index.html', 'utf8');
  const body = src.slice(src.indexOf('function paintPostWindows('));
  const painter = body.slice(0, body.indexOf('\nfunction paintStudio('));
  assert.ok(painter.length > 200 && painter.length < 6000, 'the painter was not isolated');
  const code = painter.replace(/\/\*[\s\S]*?\*\//g, '');

  // The design's own span above the rows already renders postWindowNote. A
  // second copy inside the panel printed the sentence twice.
  assert.ok(!/postWindowNote/.test(code),
    'the panel must not render the note -- the design span above it already does');

  // The mark is drawn in the page. Through the icon font it measured 0x0 with
  // the family falling back to Inter, which leaves a gold square that says
  // nothing about which state the control is in.
  assert.ok(/<svg class="dcpw-mark"/.test(code), 'the tick should be an inline svg');
  assert.ok(!/class="ph /.test(code), 'the tick must not depend on the icon font');
});
