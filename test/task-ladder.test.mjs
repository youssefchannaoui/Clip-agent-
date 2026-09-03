import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The task ladder, and the tokens it pays.
 *
 * Youssef, 3 Sept 2026, on a rail card showing "Complete setup 20%": "this is
 * a great idea for new users also you can add that new user one so then 5
 * steps then add tasks like upload your first 3 clips finish 1 week finish 1
 * month and etc and they can earn tokens with it as well."
 *
 * The danger here is not the feature, it is the SECOND ANSWER. v3.96.0 retired
 * a five-step "Getting set up" checklist for sitting beside the Create ->
 * Review -> Publish strip and telling one person two different things about
 * where they were. A ladder that recomputed "have they imported yet" would
 * walk straight back into that, so its first three rungs read the journey's
 * own steps and this file asserts they agree.
 *
 * The money half is driven over HTTP with a REAL free account, because
 * granting lives inside the request handler and an operator's balance is
 * unlimited (so the owner earns nothing and a test signed in as one would
 * prove nothing).
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-tasks-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
process.env.APP_SESSION_SECRET = 'task-ladder-secret-long-enough-for-the-check';
process.env.SOCIAL_TOKEN_KEY = 'task-ladder-test-social-key-over-32-characters';

const { server } = await import('../src/server.js');
const { state, save } = await import('../src/store.js');
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const onboarding = await import('../src/onboarding.js');
const { config } = await import('../src/config.js');

test.after(() => new Promise(resolve => server.close(() => resolve())));

for (let attempt = 0; attempt < 50; attempt++) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(r => setTimeout(r, 50)); }
}

// One sign-up, reused. The sign-in throttle is real and a file that spends it
// reports a broken route when the route is fine.
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({
    email: 'ladder@deenclipped.test',
    password: 'correct horse battery staple',
    returnTo: '/',
  }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
assert.ok(cookie.startsWith('dc_session='), 'the free account signed up');

const me = state.authUsers.find(u => u.email === 'ladder@deenclipped.test');
assert.ok(me, 'the account is on disk');

const readState = async () => (await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).json();
// The bonus balance lives on the USER's own billing record, which is what
// grantBonusTokens writes and what a purchased top-up writes to as well.
const balance = () => Number(me.billing?.bonusTokens || 0);

/** Give this account a project and `n` clips, posted on `days` distinct days. */
function seed({ clips = 0, posted = 0, days = 1, approved = 0 } = {}) {
  state.projects = (state.projects || []).filter(p => p.userId !== me.id);
  state.clips = (state.clips || []).filter(c => c.userId !== me.id);
  if (!clips) return;
  const projectId = 'p-ladder';
  state.projects.push({ id: projectId, userId: me.id, title: 'Lecture', status: 'done', submittedAt: 1, completedAt: 2 });
  const day = 24 * 60 * 60 * 1000;
  for (let i = 0; i < clips; i += 1) {
    const isPosted = i < posted;
    state.clips.push({
      id: `c-${i}`, userId: me.id, projectId, title: `Clip ${i}`, addedAt: 10,
      status: isPosted ? 'posted' : i < approved + posted ? 'approved' : 'waiting',
      approvedAt: i < approved + posted ? 20 : null,
      // Spread across `days` distinct UTC days, so the week/month rungs are
      // driven by real dates rather than by a count.
      postedAt: isPosted ? Date.UTC(2026, 0, 1) + (i % days) * day : null,
    });
  }
  save();
}

const ladder = () => onboarding.tasks(state, me.id, config);

/* ------------------------------------------------------------------ *
 * 1. The one-definition law. This is the whole risk of the feature.
 * ------------------------------------------------------------------ */
test('the first three rungs ARE the journey, not a second opinion', () => {
  for (const shape of [{}, { clips: 2 }, { clips: 2, approved: 2 }, { clips: 2, posted: 1 }]) {
    seed(shape);
    const j = onboarding.journey(state, me.id);
    const steps = Object.fromEntries(j.steps.map(s => [s.key, s.state === 'done']));
    const rungs = Object.fromEntries(ladder().list.slice(0, 3).map(t => [t.id, t.done]));
    assert.deepEqual(rungs, steps,
      `the ladder and the strip disagree about ${JSON.stringify(shape)}: that is the v3.96.0 fault returning`);
  }
});

test('the ladder names the same three steps the strip does, in order', () => {
  assert.deepEqual(onboarding.TASKS.slice(0, 3).map(t => t.from), onboarding.STEPS.map(s => s.key));
});

/* ------------------------------------------------------------------ *
 * 2. The rungs Youssef named.
 * ------------------------------------------------------------------ */
test('three clips, ten clips, a week and a month', () => {
  seed({ clips: 3, posted: 3, days: 1 });
  let done = new Set(ladder().list.filter(t => t.done).map(t => t.id));
  assert.ok(done.has('three'), 'three posted clips ticks the three rung');
  assert.ok(!done.has('ten'), 'and not the ten rung');
  assert.ok(!done.has('week'), 'three clips on ONE day is not a week');

  seed({ clips: 10, posted: 10, days: 7 });
  done = new Set(ladder().list.filter(t => t.done).map(t => t.id));
  assert.ok(done.has('ten') && done.has('week'), 'ten clips across seven days ticks both');
  assert.ok(!done.has('month'), 'seven days is not thirty');

  seed({ clips: 30, posted: 30, days: 30 });
  assert.ok(new Set(ladder().list.filter(t => t.done).map(t => t.id)).has('month'));
});

test('a week is seven separate DAYS, never a consecutive streak', () => {
  // Thirty clips all posted on one day is not a week of use, and a streak that
  // breaks on a missed day would punish an account for posting four times a
  // day instead of eight -- a setting they chose.
  seed({ clips: 30, posted: 30, days: 1 });
  const done = new Set(ladder().list.filter(t => t.done).map(t => t.id));
  assert.ok(done.has('ten'), 'the count rungs are counts');
  assert.ok(!done.has('week'), 'but the day rungs are days');
});

test('progress is shown for the counted rungs and capped at the target', () => {
  seed({ clips: 40, posted: 40, days: 40 });
  const rows = ladder().list;
  const month = rows.find(t => t.id === 'month');
  assert.deepEqual({ ...month.progress }, { at: 30, of: 30 }, 'never "40 of 30"');
  assert.equal(rows.find(t => t.id === 'create').progress, null, 'a journey rung has no count to show');
});

/* ------------------------------------------------------------------ *
 * 3. The money. Driven over HTTP, because that is where it happens.
 * ------------------------------------------------------------------ */
test('reaching a rung pays it, once, ever', async () => {
  seed({ clips: 3, posted: 3, days: 1 });
  const before = balance();
  const payload = await readState();
  const after = balance();
  const expected = config.taskRewardPublish + config.taskRewardThree;
  assert.equal(after - before, expected, `first publish + three clips should pay ${expected}`);
  assert.ok(payload.tasks, '/api/state carries the ladder');

  // Poll again. A ladder settled on every poll must be a no-op on every poll
  // after the first, or an open tab prints money.
  await readState();
  await readState();
  assert.equal(balance(), after, 'three more polls granted nothing');
});

test('the grant is refused even if the display record is lost', async () => {
  // user.taskRewards is what the SCREEN reads; billing's own ledger is the
  // authority. Wiping the display record must not re-pay the rung.
  const held = balance();
  delete me.taskRewards;
  await readState();
  assert.equal(balance(), held, 'billing refused the repeat');
  assert.ok(me.taskRewards?.three, 'and the display record was restored');
});

test('a rung reached later is paid later', async () => {
  const before = balance();
  seed({ clips: 10, posted: 10, days: 7 });
  await readState();
  const expected = config.taskRewardTen + config.taskRewardWeek;
  assert.equal(balance() - before, expected, `ten clips + a week should pay ${expected}`);
});

test('the ladder reports what it has earned and what is waiting', async () => {
  seed({ clips: 30, posted: 30, days: 30 });
  const payload = await readState();
  const rows = payload.tasks;
  assert.equal(rows.done, rows.total, 'every rung is done');
  assert.equal(rows.percent, 100);
  assert.equal(rows.unclaimed, 0, 'nothing is owed once the poll has settled');
  const total = config.taskRewardPublish + config.taskRewardThree + config.taskRewardTen
    + config.taskRewardWeek + config.taskRewardMonth;
  assert.equal(rows.earned, total, `the whole ladder is ${total} tokens`);
});

/* ------------------------------------------------------------------ *
 * 4. The shape the rail card draws.
 * ------------------------------------------------------------------ */
test('the card knows when setup is finished and what comes next', () => {
  seed({});
  let rows = ladder();
  assert.equal(rows.percent, 0);
  assert.equal(rows.setupDone, false);
  assert.equal(rows.next.id, 'create', 'a brand new account is pointed at its first import');

  seed({ clips: 2, posted: 1 });
  rows = ladder();
  assert.equal(rows.setupDone, true, 'one published clip finishes the setup half');
  assert.equal(rows.next.id, 'three', 'and the ladder carries on past it');
  assert.ok(rows.percent > 0 && rows.percent < 100);
});

test('an operator is never paid, because an operator cannot be', async () => {
  // isUnlimited returns a no-op grant, so settling for one would write a
  // ledger row on every poll for tokens that mean nothing.
  const operator = { id: 'op-1', email: 'operator@deenclipped.test', role: 'owner' };
  const billing = await import('../src/billing.js');
  assert.equal(billing.isUnlimited(operator), true);
  assert.equal(billing.grantBonusTokens(operator, 50, 'Task reward (test)', 'task:test').granted, 0);
});

/* ------------------------------------------------------------------ *
 * 5. Rewards are a decision, and the decision is reversible without a deploy.
 * ------------------------------------------------------------------ */
test('every reward reads config, so it can be tuned or turned off', () => {
  const zeroed = onboarding.tasks(state, me.id, {});
  assert.ok(zeroed.list.every(t => t.reward === 0), 'no config, no payout');
  const raised = onboarding.tasks(state, me.id, { ...config, taskRewardMonth: 999 });
  assert.equal(raised.list.find(t => t.id === 'month').reward, 999);
});

test('the whole ladder is worth less than one referral', () => {
  // Youssef, 3 Sept 2026: "Reduce token reward." The ladder shipped at 150,
  // three times what a referral pays for bringing a PAYING customer -- the
  // wrong ordering, because nothing a customer does alone should be worth more
  // than delivering somebody else's subscription. This pins the relationship
  // rather than the numbers, so either can be tuned and the ordering holds.
  const ladderTotal = ['taskRewardPublish', 'taskRewardThree', 'taskRewardTen',
    'taskRewardWeek', 'taskRewardMonth'].reduce((sum, k) => sum + config[k], 0);
  assert.ok(ladderTotal < config.referralBonusPaid,
    `the ladder pays ${ladderTotal} against a referral's ${config.referralBonusPaid}`);
});

test('the first two rungs pay nothing, deliberately', () => {
  const rows = onboarding.tasks(state, me.id, config).list;
  assert.equal(rows.find(t => t.id === 'create').reward, 0,
    'importing already spends tokens; paying for it would be a partial refund wearing a reward badge');
  assert.equal(rows.find(t => t.id === 'review').reward, 0, 'and approving is one click');
  assert.ok(rows.find(t => t.id === 'publish').reward > 0, 'the ladder starts paying when something ships');
});

/* ------------------------------------------------------------------ *
 * 6. The wiring. Every one of these fails SILENTLY — the app renders,
 *    nothing throws, the card just stops being drawn or lands under
 *    the collapse control. CI has no browser (this repo has no npm
 *    dependencies on purpose), so these read the served files; the
 *    behaviour behind them was driven in a real browser at 1440x950
 *    and 390x844 before shipping.
 * ------------------------------------------------------------------ */
const read = rel => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

test('the card is painted with the other host panels, never on an observer', () => {
  const page = read('src/public/index.html');
  const at = page.indexOf('function paintStudio(){');
  const body = page.slice(at, at + 2600);
  assert.match(body, /paintTaskCard\(\);/, 'the rail card is restored after every render');
  assert.match(body, /paintTasksPanel\(\);/, 'and so is the panel, while it is open');
});

test('the card mounts by being EMPTY, never by a generated class name', () => {
  const page = read('src/public/index.html');
  const at = page.indexOf('function railFooterSlot(){');
  const body = page.slice(at, page.indexOf('function paintTaskCard'));
  assert.match(body, /!kid\.children\.length/, 'found by being the empty footer card');
  assert.ok(!/\.s[0-9a-z]{1,3}\b/.test(body),
    'a hashed class here would break on the next design re-import');
});

test('the rail reserves the collapse row, or the card lands underneath it', () => {
  // Measured at 1440x950: the footer slot is y 873..934 and the collapse
  // control is absolutely positioned at y 906..938, so a card dropped straight
  // in overlaps it — the collision that removed the plan badge in v3.73.1.
  const sheet = read('src/public/studio-tokens.css');
  assert.match(sheet, /#dcRail > div:has\(> #dcTaskCard\)\s*\{[^}]*margin-bottom/,
    'the slot must reserve the collapse row while it holds the card');
});

test('the collapsed rail is read from the adapter, not from a class or a width', () => {
  const page = read('src/public/index.html');
  const at = page.indexOf('function paintTaskCard(){');
  const body = page.slice(at, page.indexOf('function paintTasksPanel'));
  // Neither the body nor the rail gains a class when the rail collapses
  // (measured), and the rail's width ANIMATES over 180ms so reading it during
  // the collapsing paint returns the open width.
  assert.match(body, /StudioAdapter\.ui\.railOpen/, 'the flag is the answer at render time');
  assert.ok(!/getBoundingClientRect\(\)\.width\s*<\s*1[0-9]{2}/.test(body),
    'reading the animating width measures the OPEN rail on the paint that collapses it');
});

test('the phone opens the same panel rather than a second copy of it', () => {
  const phone = read('src/public/studio-mobile.js');
  assert.match(phone, /global\.openTasks\(\)/, 'one panel, opened from both surfaces');
  assert.match(phone, /m\.tasksOn = Boolean\(ladder/, 'and it reads the same payload key');
  assert.ok(!/postedDays|taskRewardWeek/.test(phone),
    'the phone must never recompute the ladder: that is the second-answer fault');
});

test('the ladder is computed once, server-side, and only read by the screens', () => {
  const page = read('src/public/index.html');
  const phone = read('src/public/studio-mobile.js');
  for (const [name, src] of [['index.html', page], ['studio-mobile.js', phone]]) {
    assert.ok(!/Post on (seven|thirty) different days/.test(src),
      `${name} restates a rung's rule; the copy belongs to onboarding.js alone`);
  }
});

/* ------------------------------------------------------------------ *
 * 7. The rail card and the Home hero answer as one.
 *
 *    Youssef, 3 Sept 2026: "take the tour there are 2 buttons for it?
 *    also connect the side bar perctnage thing to first user interface
 *    hero thing to work with one another." Both were real: the hero's
 *    "New here?" card and a quiet link beside Start job both offered
 *    the tour on the same screen, and the rail said 14% beside a hero
 *    saying "Step 1 of 3" with nothing on screen relating the two.
 * ------------------------------------------------------------------ */
test('the ring counts the hero’s own three steps while the hero is up', () => {
  seed({ clips: 2 });                       // clips back, nothing approved
  let rows = ladder();
  assert.equal(rows.setupDone, false);
  assert.equal(rows.setup.done, 1, 'one of the hero’s three steps');
  assert.equal(rows.ringPercent, 33, 'and the ring says so, not 14% of seven rungs');
  assert.equal(rows.stepLabel, onboarding.journey(state, me.id).progress,
    'the rail quotes the hero’s own words rather than phrasing it again');

  // Once setup is finished the hero disappears by itself, so the ring
  // re-anchors to the whole ladder in the same paint the title changes.
  seed({ clips: 4, posted: 4, days: 4 });
  rows = ladder();
  assert.equal(rows.setupDone, true);
  assert.equal(rows.stepLabel, '', 'no hero left to quote');
  assert.equal(rows.ringPercent, rows.percent, 'the ring is the whole ladder now');
});

test('the panel marks the step the hero is standing on', () => {
  seed({ clips: 2 });
  assert.equal(ladder().nowId, onboarding.journey(state, me.id).at,
    'opening the ladder must land on the same answer Home is giving');
  seed({ clips: 4, posted: 4, days: 4 });
  assert.equal(ladder().nowId, ladder().next.id, 'past setup, the next rung is the live one');
});

test('every rung carries a destination, and there is ONE map of them', () => {
  const rows = ladder().list;
  assert.ok(rows.every(t => t.action), 'a task row that goes nowhere is a dead control');
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /^ {4}goToStep: function \(action, e\)/m,
    'goToStep must be a METHOD on StudioAdapter: inside bindings() it is not reachable '
    + 'from the task panel, and clicking a row silently did nothing');
  assert.match(adapter, /global\.StudioAdapter\.goToStep\(ob\.action, e\)/,
    'and the hero’s own button goes through the same map');
  // Two lists of destinations that have to agree is how a row ends up going
  // somewhere the strip beside it does not.
  const page = read('src/public/index.html');
  const at = page.indexOf("const row=event.target.closest('#dcTasks .dctk-row');");
  assert.match(page.slice(at, at + 400), /StudioAdapter\.goToStep/);
});

test('the tour is offered once on the screen that offers it twice', () => {
  const page = read('src/public/index.html');
  const at = page.indexOf('function paintTourEntry(vals){');
  const body = page.slice(at, page.indexOf('row.appendChild(tourLinkEl);'));
  // The GUARD, not merely the declaration. The first cut of this matched
  // `const firstRun = ...` and went on passing after `||firstRun` was deleted
  // from the condition -- the source-string weakness this repo keeps paying
  // for, caught this time by proving it red.
  const guard = /if\(!row\|\|[^)]*\)\{/.exec(body);
  assert.ok(guard, 'the early-return guard is where the decision is made');
  assert.match(guard[0], /firstRun/,
    'the quiet link stands down while the first-run card is offering the tour');
  // And it must read the BINDING, not the body class: paintTourEntry runs
  // before paintFirstRun, so on the paint where an account stops being a
  // beginner the class is still set and the link stayed away for a render.
  assert.ok(!/classList\.contains\('dc-firstrun'\)/.test(body),
    'the body class is set later in the same paint; the flag is not');
});

/* ------------------------------------------------------------------ *
 * 8. Alignment, pinned as a METHOD rather than as a number.
 *
 *    Youssef, 3 Sept 2026: "not everything is aligned, like, the ticks
 *    and stuff like that ... every time you're always doing layout work
 *    and etcetera, everything must be centered, aligned, correctly done,
 *    and matching the dashboard."
 *
 *    Measured at 1440x950 before the fix: the tick sat 3.6px below its
 *    title's centre on ALL SEVEN rows, the reward chip 4.6px below, the
 *    chips were 88px and 78.8px wide so their left edges were ragged,
 *    and the row's own padding put the left column at x=487 against a
 *    dialog header starting at 479. After: 0px on every row, every
 *    column a single value, every chip 82px — at 1440, 1100 and 390,
 *    in night and in daylight.
 *
 *    CI has no browser, so these assert the geometry that PRODUCES that
 *    result: one shared line height driving the tick, the title and the
 *    chip, so they centre on each other by construction. A magic margin
 *    would measure right today and drift the moment a font size moved.
 * ------------------------------------------------------------------ */
test('one line token drives the tick, the title and the reward chip', () => {
  const sheet = read('src/public/studio-tokens.css');
  const block = sheet.slice(sheet.indexOf('#dcTasks .dctk-row {'), sheet.indexOf('#dcTasks .dctk-bar'));
  assert.match(block, /--dctk-line:\s*\d+px/, 'the row declares the shared line height');
  for (const [what, selector] of [
    ['the tick', '#dcTasks .dctk-tick'],
    ['the title', '#dcTasks .dctk-row strong'],
    ['the reward chip', '#dcTasks .dctk-prize'],
  ]) {
    const rule = sheet.slice(sheet.indexOf(selector + ' {'), sheet.indexOf('}', sheet.indexOf(selector + ' {')));
    assert.match(rule, /var\(--dctk-line\)/, `${what} must be sized from the shared line, not by hand`);
  }
});

test('nothing is nudged into place with a margin', () => {
  const sheet = read('src/public/studio-tokens.css');
  const from = sheet.indexOf('#dcTasks .dctk-row {');
  const to = sheet.indexOf('#dcTasks .dctk-prize');
  const block = sheet.slice(from, sheet.indexOf('}', to));
  // margin-top on any of these is the fudge this section replaced: it measures
  // right on the day and drifts the moment a font size changes.
  assert.ok(!/\.dctk-tick[^}]*margin-top/.test(block), 'the tick is centred by geometry, never by a margin');
  assert.ok(!/\.dctk-prize[^}]*margin-top/.test(block), 'and so is the chip');
});

test('a chip is the same width whatever number is in it', () => {
  const sheet = read('src/public/studio-tokens.css');
  const rule = sheet.slice(sheet.indexOf('#dcTasks .dctk-prize {'), sheet.indexOf('}', sheet.indexOf('#dcTasks .dctk-prize {')));
  assert.match(rule, /min-width:\s*\d+px/, 'a min-width, or 10 and 100 tokens give different left edges');
  assert.match(rule, /tabular-nums/, 'and tabular figures, so the digits do not shuffle the width');
  // The "+" that used to mark a paid chip made it 9px wider than the rest.
  const page = read('src/public/index.html');
  const at = page.indexOf('const prize=task.reward>0');
  assert.ok(!/task\.paidAt\?'\+':''/.test(page.slice(at, at + 200)),
    'a paid chip must not be wider than an unpaid one; its colour already says it is paid');
});

test('the rows sit on the dialog header’s own left edge', () => {
  const sheet = read('src/public/studio-tokens.css');
  const rule = sheet.slice(sheet.indexOf('#dcTasks .dctk-row {'), sheet.indexOf('}', sheet.indexOf('#dcTasks .dctk-row {')));
  // The hover background is inset by padding; the negative margin puts the
  // CONTENT back on the header's edge. Without it the whole left column sat
  // 8px right of "Your tasks".
  assert.match(rule, /padding:\s*\d+px\s+8px/, 'the hover background keeps its inset');
  assert.match(rule, /margin:\s*0\s+-8px/, 'and the content returns to the header edge');
});

test('the Now badge cannot grow the row it sits in', () => {
  const sheet = read('src/public/studio-tokens.css');
  const rule = sheet.slice(sheet.indexOf('#dcTasks .dctk-row strong em {'),
    sheet.indexOf('}', sheet.indexOf('#dcTasks .dctk-row strong em {')));
  // It inherits the title's line-height, so with padding its line box came out
  // 24px against a 22px line -- 2px taller on that row and 1px off the tick.
  assert.match(rule, /line-height:\s*1\b/, 'its own leading, not the title’s');
  assert.match(rule, /height:\s*\d+px/, 'and a height under the title’s line');
});
