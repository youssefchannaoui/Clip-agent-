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

// ── the first screen a new account ever sees (v3.98.0) ─────────────────────

test('the beginner panel is only for somebody who has never imported', () => {
  // An account whose lecture came back EMPTY is still on Create. Showing it
  // the whole beginner's guide a second time would be the app forgetting it
  // had already met them — and `imported` was NOT carried through the adapter
  // binding at first, so this was real rather than hypothetical.
  const fresh = seed();
  assert.equal(onboarding.journey(state, fresh, { nasheeds: 1 }).imported, false);

  const tried = seed({ projects: [PROJECT] });   // done, produced no clips
  const j = onboarding.journey(state, tried, { nasheeds: 1 });
  assert.equal(j.at, 'create', 'still on Create, because nothing came back');
  assert.equal(j.imported, true, 'but they have imported, so the guide has been earned once');

  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  assert.match(adapter, /firstRun: ob\.at === 'create' && !ob\.imported/,
    'ONE flag both surfaces read, or the phone and the desktop disagree about who is a beginner');

  // And the PAINTER's own gate, not only the flag beside it — dropping
  // `!ob.imported` there broke nothing until this line existed.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const fn = html.slice(html.indexOf('function paintFirstRun'), html.indexOf('function paintFirstRunShowcase'));
  assert.match(fn, /const first=Boolean\(ob&&ob\.show&&ob\.at==='create'&&!ob\.imported\)/,
    'the panel itself must refuse an account that has already imported');
});

test('the panel replaces the marketing headline and stands the strip down', () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.match(html, /paintFirstRun\(vals\);/, 'registered in paintStudio, never on a MutationObserver');

  // Found by TAG and by "the node after it". A hashed class would break on the
  // next design re-import, which is the whole reason this is host-rendered.
  const fn = html.slice(html.indexOf('function paintFirstRun'), html.indexOf('function paintFirstRunShowcase'));
  assert.match(fn, /left\.querySelector\('h1'\)/, 'the marketing headline is found structurally');
  assert.ok(!/\.s[0-9a-z]{1,3}['"]/.test(fn), 'and no hashed class name is named anywhere in it');
  assert.match(fn, /flex:none/, 'children of a scrolling flex column must declare it or they collapse to zero');

  // ONE onboarding surface at a time — the whole lesson of v3.96.0, and
  // repeating it one release later would be indefensible.
  const strip = html.slice(html.indexOf('function paintOnboarding'), html.indexOf('function paintFirstClip'));
  assert.match(strip, /const panelUp=Boolean\(ob&&ob\.at==='create'&&!ob\.imported\)/);
  assert.match(strip, /\|\|panelUp\|\|/, 'the strip must stand down while the full panel is up');
});

test('it puts everything back the moment a lecture is in', () => {
  // It hides two export nodes and a whole column. Anything hidden and not
  // restored is a screen permanently missing a section, with nothing anywhere
  // reporting it.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const fn = html.slice(html.indexOf('function paintFirstRun'), html.indexOf('function paintFirstRunShowcase'));
  assert.match(fn, /data-dcfr-hid/, 'what it hid is marked');
  assert.match(fn, /data-dcfr-was/, 'and what it hid in the column remembers its own display value');
  assert.match(fn, /const kill=\(\)=>/);
  assert.match(fn, /classList\.remove\('dc-firstrun'\)/, 'and the body class goes with it');
});

test('it does not add a second answer to "what comes back"', () => {
  // The export already carries "Nothing in your library yet — this is what one
  // lecture produces", with scored clip cards, one scroll below. A strip of
  // finished clips was built for the empty column and DELETED for exactly this
  // reason: two answers to one question is the fault v3.96.0 removed.
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const show = html.slice(html.indexOf('function paintFirstRunShowcase'), html.indexOf('/* ── First run'));
  assert.ok(!/marketing-assets\/reel-/.test(show), 'no second gallery of finished clips');
  assert.match(show, /Take the tour/, 'the column carries the tour instead, which nothing else offers');
  // The tour is a BINDING. Calling it off StudioAdapter throws at CLICK time,
  // not at load — the trap this repo has now paid for three times.
  assert.match(show, /vals\.startTour/);
  assert.ok(!/StudioAdapter\.startTour/.test(show));
});

test('the panel states how long it takes, because that is why people leave', () => {
  // "The pipeline takes ~20 minutes and people leave" is already recorded in
  // CLAUDE.md as the reason the nudge emails exist. The screen never said it.
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const at = adapter.indexOf('beats: [');
  assert.ok(at > 0, 'the beats must exist');
  // Searched FROM the beats, not from the start of the file — 'cost:' occurs
  // earlier elsewhere and the slice came back empty, which read as the copy
  // being missing when it was not.
  const beats = adapter.slice(at, adapter.indexOf('cost:', at));
  assert.match(beats, /About 20 minutes/, 'the wait is stated');
  assert.match(beats, /Nothing posts until you approve it/, 'and so is the safety');
  assert.match(adapter, /cost: 'About one token a minute/, 'and what it costs, beside the field that spends it');
});
