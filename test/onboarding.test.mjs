import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * First run (v3.92.0), against the five gaps Youssef named:
 *
 *   1. no obvious Step 1 Create -> Step 2 Review -> Step 3 Publish state
 *   2. no first-clip success moment
 *   3. no automatic handoff from processing -> first review
 *   4. no onboarding that disappears after activation
 *   5. no tracking of signup -> first source -> first clip -> first approval
 *      -> first publish
 *
 * The law this file mostly exists to hold: there is ONE definition of where an
 * account is, and it is referrals.activationOf. The owner's growth funnel, the
 * lifecycle nudge emails and DeenAI's next-action card already read it. A
 * second definition here would eventually disagree with those three, and then
 * the dashboard, the email and the operator's funnel would each tell a
 * different story about one person.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-onboarding-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'onboarding-test-secret-long-enough';

const onboarding = await import('../src/onboarding.js');
const { state } = await import('../src/store.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* harmless */ }
});

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function seed({ projects = [], clips = [], settings = null, createdAt = now - 3 * DAY } = {}) {
  state.authUsers.length = 0;
  state.projects.length = 0;
  state.clips.length = 0;
  state.revenueEvents = [];
  state.userSettings = {};
  state.authUsers.push({ id: 'u1', email: 'new@example.test', name: 'New', role: 'creator', createdAt });
  state.projects.push(...projects.map(p => ({ userId: 'u1', ...p })));
  state.clips.push(...clips.map(c => ({ userId: 'u1', projectId: 'p1', ...c })));
  if (settings) state.userSettings.u1 = settings;
  return 'u1';
}

const PROJECT = { id: 'p1', title: 'A lecture', status: 'done', submittedAt: now - 2 * DAY };
const CLIP = { id: 'c1', status: 'waiting', addedAt: now - 2 * DAY + 900000 };

// ── 1. the three steps ─────────────────────────────────────────────────────

test('a brand new account is on Step 1 Create', () => {
  const id = seed();
  const j = onboarding.journey(state, id, { nasheeds: 1 });
  assert.equal(j.show, true);
  assert.equal(j.at, 'create');
  assert.equal(j.progress, 'Step 1 of 3');
  assert.deepEqual(j.steps.map(s => s.state), ['now', 'todo', 'todo']);
  assert.deepEqual(j.steps.map(s => s.label), ['Create', 'Review', 'Publish']);
  assert.match(j.hint, /Paste a YouTube link/);
  assert.equal(j.action, 'paste');
});

test('the nasheed prerequisite is spoken before the lecture is asked for', () => {
  // The retired five-step checklist led with "Upload a nasheed — every clip
  // mixes one in, so nothing finishes without it". It is the ONE item whose
  // absence silently stalls a run, so losing it with the list would have been
  // the real cost of removing it. Folded into Create rather than kept as a
  // fourth step.
  const id = seed();
  const without = onboarding.journey(state, id, { nasheeds: 0 });
  assert.match(without.hint, /nasheed/i);
  assert.equal(without.action, 'nasheed', 'and the button must reach the library');
  assert.equal(without.at, 'create', 'it changes the copy, never the step');

  const with_ = onboarding.journey(state, id, { nasheeds: 2 });
  assert.match(with_.hint, /Paste a YouTube link/);
  assert.equal(with_.action, 'paste');
});

test('Publish asks for a channel first, then a time', () => {
  // "Connect somewhere to post" and "Give a clip a time" were two of the
  // retired list's five. Both are reachable from the one Publish step.
  const id = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'approved', approvedAt: now }] });
  const unconnected = onboarding.journey(state, id, { connected: 0 });
  assert.equal(unconnected.action, 'connect');
  assert.match(unconnected.hint, /Connect a channel/);

  const connected = onboarding.journey(state, id, { connected: 1 });
  assert.equal(connected.action, 'schedule');
  assert.match(connected.hint, /Give your approved clip a time/);

  const slotted = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'approved', approvedAt: now, scheduledAt: now + 3600000 }] });
  assert.match(onboarding.journey(state, slotted, { connected: 1 }).hint, /posts itself/);
});

test('the step never depends on the context, only the copy does', () => {
  // growth.js calls journey() with NO context for the operator's report. If a
  // missing nasheed could move the step, the owner's funnel and the customer's
  // dashboard would disagree about where one person is.
  const id = seed({ projects: [PROJECT], clips: [CLIP] });
  const bare = onboarding.journey(state, id);
  for (const ctx of [{ nasheeds: 0 }, { nasheeds: 9, connected: 3 }]) {
    const withCtx = onboarding.journey(state, id, ctx);
    assert.equal(withCtx.at, bare.at);
    assert.deepEqual(withCtx.steps.map(s => s.state), bare.steps.map(s => s.state));
  }
});

test('an import in flight stays on Create and says there is nothing to do', () => {
  const id = seed({ projects: [{ ...PROJECT, status: 'processing' }] });
  const j = onboarding.journey(state, id);
  assert.equal(j.at, 'create');
  assert.equal(j.working, true);
  assert.match(j.hint, /being processed/);
});

test('a lecture that came back with NO clips has not finished Create', () => {
  // The status says done. Nothing came back. Calling that step complete would
  // send someone to an empty review queue and tell them nothing.
  const id = seed({ projects: [PROJECT] });
  const j = onboarding.journey(state, id);
  assert.equal(j.at, 'create');
  assert.match(j.hint, /no clips/i);
});

test('clips back but none decided is Step 2 Review, and it counts them', () => {
  const id = seed({ projects: [PROJECT], clips: [CLIP, { ...CLIP, id: 'c2' }] });
  const j = onboarding.journey(state, id);
  assert.equal(j.at, 'review');
  assert.deepEqual(j.steps.map(s => s.state), ['done', 'now', 'todo']);
  assert.equal(j.waiting, 2);
  assert.match(j.hint, /2 clips are waiting/);
});

test('one waiting clip is spoken of in the singular', () => {
  const id = seed({ projects: [PROJECT], clips: [CLIP] });
  assert.match(onboarding.journey(state, id).hint, /^One clip is waiting/);
});

test('an approved clip is Step 3 Publish', () => {
  const id = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'approved', approvedAt: now - 3600000 }] });
  const j = onboarding.journey(state, id);
  assert.equal(j.at, 'publish');
  assert.deepEqual(j.steps.map(s => s.state), ['done', 'done', 'now']);
  assert.match(j.hint, /Connect a channel/);
});

// ── 4. it disappears after activation ──────────────────────────────────────

test('a published clip ends the onboarding, and nothing can bring it back', () => {
  const id = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'posted', approvedAt: now - 7200000, postedAt: now - 3600000 }] });
  const j = onboarding.journey(state, id);
  assert.equal(j.show, false, 'it must vanish once the run is complete');
  assert.equal(j.at, 'done');
  // DERIVED, not dismissed: there is no flag to clear, so it cannot come back
  // on another device and cannot be waved away before it is true.
  assert.equal(onboarding.journey(state, id).show, false);
});

// ── 2 & 3. the moment, and the handoff ─────────────────────────────────────

test('the first clips raise the moment exactly once, ever', () => {
  const id = seed({ projects: [PROJECT], clips: [CLIP, { ...CLIP, id: 'c2' }] });
  assert.equal(onboarding.journey(state, id).firstClip, true);
  assert.equal(onboarding.journey(state, id).firstClipCount, 2);

  assert.equal(onboarding.markSeen(state, id, 'firstClip'), true);
  assert.equal(onboarding.journey(state, id).firstClip, false, 'spent means spent');
  // Marking again must not move the timestamp: a second call is a replayed
  // request, not a second moment.
  const at = onboarding.seenAt(state, id, 'firstClip');
  assert.equal(onboarding.markSeen(state, id, 'firstClip'), false);
  assert.equal(onboarding.seenAt(state, id, 'firstClip'), at);
});

test('the moment is never raised at someone who already engaged with their clips', () => {
  // "Your first clips are ready" at an account that has already approved one
  // is a nag, not a moment. Found by looking at the render, not the code.
  const id = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'approved', approvedAt: now }] });
  assert.equal(onboarding.journey(state, id).firstClip, false);
  assert.equal(onboarding.journey(state, id).handoff, false);
});

test('the handoff and the moment are spent separately', () => {
  const id = seed({ projects: [PROJECT], clips: [CLIP] });
  assert.equal(onboarding.journey(state, id).handoff, true);
  onboarding.markSeen(state, id, 'firstClip');
  assert.equal(onboarding.journey(state, id).handoff, true, 'showing the card must not spend the handoff');
  onboarding.markSeen(state, id, 'handoff');
  assert.equal(onboarding.journey(state, id).handoff, false);
});

test('neither fires for an account with no clips', () => {
  const id = seed({ projects: [{ ...PROJECT, status: 'processing' }] });
  const j = onboarding.journey(state, id);
  assert.equal(j.firstClip, false);
  assert.equal(j.handoff, false);
});

// ── 5. the tracking ────────────────────────────────────────────────────────

test('every milestone is read off the record that already carries it', () => {
  // Nothing is stamped, so this works for the accounts that predate the
  // feature -- which are the only real data this product has -- and cannot
  // drift from what actually happened.
  const id = seed({
    projects: [{ ...PROJECT, submittedAt: now - 5 * DAY }, { id: 'p2', submittedAt: now - 2 * DAY }],
    clips: [
      { ...CLIP, addedAt: now - 4 * DAY, approvedAt: now - 3 * DAY, postedAt: now - 2 * DAY, status: 'posted' },
      { ...CLIP, id: 'c2', addedAt: now - 5 * DAY + 1000, approvedAt: null, postedAt: null },
    ],
    createdAt: now - 6 * DAY,
  });
  const m = onboarding.milestones(state, id);
  // The EARLIEST of each, not the latest: these are firsts.
  assert.equal(m.signedUpAt, now - 6 * DAY);
  assert.equal(m.importedAt, now - 5 * DAY);
  assert.equal(m.clipsAt, now - 5 * DAY + 1000);
  assert.equal(m.approvedAt, now - 3 * DAY);
  assert.equal(m.publishedAt, now - 2 * DAY);
});

test('a milestone never reached is absent, never a date', () => {
  // Math.min of an empty list is Infinity, which renders as a real date once
  // it reaches a formatter.
  const id = seed({ projects: [PROJECT] });
  const m = onboarding.milestones(state, id);
  assert.equal(m.clipsAt, null);
  assert.equal(m.approvedAt, null);
  assert.equal(m.publishedAt, null);
  assert.ok(Number.isFinite(m.importedAt));
});

test('the operator sees counts, timings and who is stuck right now', () => {
  seed({
    projects: [{ ...PROJECT, submittedAt: now - 5 * DAY }],
    clips: [{ ...CLIP, addedAt: now - 4 * DAY }],
    createdAt: now - 6 * DAY,
  });
  state.authUsers.push({ id: 'u2', email: 'never@example.test', role: 'creator', createdAt: now - 6 * DAY });
  state.authUsers.push({ id: 'u3', email: 'done@example.test', role: 'creator', createdAt: now - 6 * DAY });
  state.projects.push({ id: 'p3', userId: 'u3', status: 'done', submittedAt: now - 5 * DAY });
  state.clips.push({ id: 'c3', userId: 'u3', projectId: 'p3', status: 'posted',
    addedAt: now - 4 * DAY, approvedAt: now - 3 * DAY, postedAt: now - 2 * DAY });

  const report = onboarding.activationReport(state, state.authUsers);
  assert.equal(report.accounts, 3);
  const by = Object.fromEntries(report.steps.map(s => [s.key, s.count]));
  assert.deepEqual(by, { signedUp: 3, imported: 2, clips: 2, approved: 1, published: 1 });

  // The timing is the half the counts could not give: a step everybody passes
  // slowly is a different problem from one half of them never pass.
  const toImport = report.steps.find(s => s.key === 'imported');
  assert.equal(toImport.sinceSignup, DAY, 'signed up 6 days ago, imported 5 days ago');
  assert.equal(report.between[0].ms, DAY);

  // Who to go and talk to, right now.
  assert.deepEqual(report.stuckNow, { create: 1, review: 1, publish: 0, done: 1 });
  assert.ok(report.stalled.some(r => r.email === 'never@example.test'));
  assert.ok(report.stalled.every(r => r.waitingMs > DAY));
  assert.ok(!report.stalled.some(r => r.email === 'done@example.test'), 'a finished account is not stalled');
});

test('the report survives an account with nothing on it', () => {
  state.authUsers.length = 0; state.projects.length = 0; state.clips.length = 0; state.userSettings = {};
  const empty = onboarding.activationReport(state, []);
  assert.equal(empty.accounts, 0);
  assert.equal(empty.steps[0].count, 0);
  assert.deepEqual(empty.stalled, []);
  // A median of nothing is nothing, never 0 -- "0m to first clip" would read
  // as instant rather than as unknown.
  assert.equal(empty.between[0].ms, null);
});

// ── the law ────────────────────────────────────────────────────────────────

test('there is one definition of where an account is, and this is not a second one', () => {
  const src = fs.readFileSync(new URL('../src/onboarding.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ activationOf \} from '\.\/referrals\.js'/,
    'the step must come from referrals.activationOf, which the growth funnel, the nudge emails and DeenAI already read');
  // A milestone read from anywhere but the record that owns it would drift.
  assert.ok(!/Date\.now\(\)/.test(src.slice(src.indexOf('export function milestones'), src.indexOf('export const STEPS'))),
    'milestones must be derived from stored records, never stamped at observation time');
});

test('the strip, the moment and the handoff all reach the client', () => {
  const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
  assert.match(server, /onboarding: onboarding\.journey\(state, user\.id, \{/, '/api/state must carry it');
  assert.match(server, /nasheeds: audio\.listNasheeds\(user\)\.length/, 'with the prerequisites the retired checklist used to carry');
  assert.match(server, /pathname === '\/api\/onboarding\/seen'/, 'and a moment must be spendable');
  assert.match(server, /\['firstClip', 'handoff'\]\.includes\(what\)/,
    'only the two known moments -- an open key would let a caller mint state');

  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  // Registered in paintStudio's list like every other host panel, never on a
  // MutationObserver -- the lesson v3.53.5 paid three attempts for.
  assert.match(html, /paintOnboarding\(vals\);/);
  assert.match(html, /paintFirstClip\(vals\);/);
  // An overlay already up is left alone: checking the spent flag first tore it
  // down on the very next repaint, so it appeared and vanished inside a frame.
  const fn = html.slice(html.indexOf('function paintFirstClip'));
  const body = fn.slice(0, fn.indexOf('function paintLibraryAside'));
  assert.ok(body.indexOf('if(old)return;') < body.indexOf('__dcFirstClipSpent'),
    'the live overlay must be returned on BEFORE the spent flag is consulted');
});

test('the strip is a direct child of a scrolling flex column, so it declares flex:none', () => {
  // Every direct child of one of these screens needs it: without it the child
  // is shrinkable and gets squeezed to a height of ZERO while still reading
  // correctly in innerText. The Performance screen and the watermark row both
  // paid for this.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const fn = html.slice(html.indexOf('function paintOnboarding'), html.indexOf('function paintFirstClip'));
  assert.match(fn, /flex:none/);
});

test('"finished" means the status the engine actually writes', () => {
  // IMPORT_DONE said ['complete','completed','ready'] while local-engine.js has
  // always written 'done'. So `processed` was false for every project this
  // product has ever run: nobody counted as activated (which gates a referral
  // payout), and nextStep told every account that had imported anything that
  // its lecture was still being processed -- for ever, in DeenAI's card and in
  // the nudge emails.
  const engine = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  assert.match(engine, /project\.status = 'done'/, 'the engine writes done on success');

  const id = seed({ projects: [PROJECT], clips: [CLIP] });
  // Asserted through activationOf rather than by reading the constant: a test
  // that greps the list passes against a list that is wrong.
  return import('../src/referrals.js').then(referrals => {
    const a = referrals.activationOf(state, id);
    assert.equal(a.processed, true, 'a finished lecture must read as processed');
    assert.notEqual(referrals.nextStep(state, id).key, 'processing',
      'and the account must not be told it is still processing');
    assert.equal(referrals.nextStep(state, id).key, 'review');

    const done = seed({ projects: [PROJECT], clips: [{ ...CLIP, status: 'approved', approvedAt: now }] });
    assert.equal(referrals.isActivated(state, done), true, 'processed + approved is what activation means');
  });
});

test('the strip never repeats a line the blocker banner is already showing', () => {
  // The banner sits DIRECTLY above the strip and already carries the nasheed
  // and the connection, each with its own button. A strip repeating them is
  // the second control for one thing that removing the five-step checklist
  // was meant to end -- so it states the step's meaning and drops its button
  // while the banner is up, and picks the prerequisite back up the moment the
  // banner is dismissed (it is dismissible; the guidance must not vanish with
  // it). Driven in a browser both ways before this was kept.
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const at = adapter.indexOf('var bannerHas =');
  assert.ok(at > 0, 'the strip must know whether the banner is showing');
  const block = adapter.slice(at, at + 700);
  assert.match(block, /blockerShowing/, 'and read the SAME flag the banner renders from, not a second one');
  assert.match(block, /action: '', actionLabel: ''/, 'dropping its button rather than offering a second one');

  // One source for "is the banner up", or the two can disagree about it.
  assert.match(adapter, /blockersOn: blockerShowing/,
    'the banner and the strip must read one answer');
  assert.equal((adapter.match(/deenBlockerDismissed/g) || []).length, 2,
    'the dismissal is read in one place and written in one place');
});
