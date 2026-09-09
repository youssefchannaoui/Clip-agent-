/**
 * First run: where a new account is in the journey, and when it got there.
 *
 * Youssef, 2 Sept 2026, on what first-user mode was missing: no obvious
 * Step 1 Create → Step 2 Review → Step 3 Publish state, no first-clip success
 * moment, no handoff from processing to the first review, no onboarding that
 * disappears after activation, and no tracking of signup → first source →
 * first clip → first approval → first publish.
 *
 * TWO RULES SHAPE ALL OF IT.
 *
 * 1. **There is one definition of "where is this account", and it is
 *    `referrals.activationOf`.** The owner's growth funnel, the lifecycle
 *    nudge emails and DeenAI's next-action card already read it. A second
 *    definition here would eventually disagree with those three, and then the
 *    dashboard, the email and the operator's funnel would each tell a
 *    different story about one person. Everything below is derived from it.
 *
 * 2. **Nothing is stamped.** Every milestone time is read from the record that
 *    already carries it — the project's submittedAt, the clip's addedAt,
 *    approvedAt, postedAt. So this works RETROACTIVELY for accounts that
 *    predate it (there are eight, and they are the only real data this product
 *    has), it needs no migration, and it cannot drift from what actually
 *    happened the way an observation-time stamp does.
 */
import { activationOf } from './referrals.js';

const ownedBy = (rows, userId) => rows.filter(row => String(row.userId || '') === String(userId || ''));
// Math.min of an empty list is Infinity, which reads as a real date once it
// reaches a formatter. Absent must stay absent.
const earliest = values => {
  const times = values.map(Number).filter(n => Number.isFinite(n) && n > 0);
  return times.length ? Math.min(...times) : null;
};

/**
 * The five moments Youssef named, each read off the record that owns it.
 *
 * `clipsAt` is the clip's own addedAt rather than the project's completedAt:
 * a lecture can finish and produce nothing (a stretch too short, unclear
 * audio), and calling that "first clip" would count an account as having got
 * something back when it did not.
 */
export function milestones(state, userId) {
  const projects = ownedBy(state.projects || [], userId);
  const clips = ownedBy(state.clips || [], userId);
  const user = (state.authUsers || []).find(u => String(u.id || '') === String(userId || ''));
  return {
    signedUpAt: Number(user?.createdAt) || null,
    importedAt: earliest(projects.map(p => p.submittedAt)),
    clipsAt: earliest(clips.map(c => c.addedAt)),
    approvedAt: earliest(clips.map(c => c.approvedAt)),
    publishedAt: earliest(clips.map(c => c.postedAt)),
  };
}

/** The three steps, exactly as Youssef named them. */
export const STEPS = [
  { key: 'create', label: 'Create' },
  { key: 'review', label: 'Review' },
  { key: 'publish', label: 'Publish' },
];

/**
 * The onboarding state one account sees.
 *
 * Returns `{ show: false }` once the account has published — that is the
 * "disappears after activation" half, and it is derived rather than dismissed,
 * so it cannot come back on another device or be dismissed before it is true.
 *
 * A step is `done`, `now` (exactly one, ever) or `todo`. `now` is what the
 * strip highlights and what the copy speaks to.
 */
/**
 * How long after the first publish the "one all the way through" moment is
 * still a moment. Past this it is history: an account that posted its first
 * clip three weeks ago is not being congratulated, it is being interrupted.
 */
const CELEBRATE_WINDOW_MS = 3 * 86400000;
function isRecent(t, now) {
  const n = Number(t) || 0;
  return n > 0 && ((Number(now) || Date.now()) - n) <= CELEBRATE_WINDOW_MS;
}

export function journey(state, userId, ctx = {}) {
  const a = activationOf(state, userId);
  const times = milestones(state, userId);
  const clips = ownedBy(state.clips || [], userId);
  const projects = ownedBy(state.projects || [], userId);
  const working = projects.some(p => ['queued', 'processing'].includes(String(p.status || '')));
  const waiting = clips.filter(c => String(c.status || '') === 'waiting').length;
  /*
   * The prerequisites the five-step "Getting set up" list used to carry, folded
   * into the three steps it sat beside. They shape only the COPY and the
   * button -- never which step this account is on, which stays purely
   * activationOf's answer (the one-definition law at the top of this file).
   * That matters because growth.js calls journey() with no context at all for
   * the operator's report, and must get the same step back.
   */
  const nasheeds = Number(ctx.nasheeds || 0);
  const connected = Number(ctx.connected || 0);
  const scheduled = clips.some(c => c.scheduledAt || c.postedAt);

  // Create is only DONE once clips actually came back. A lecture that
  // processed and produced nothing has not finished this step, whatever its
  // status says -- and the copy has to send them somewhere useful, which is a
  // different section rather than the review queue.
  const created = Boolean(a.clipsMade);
  const at = !created ? 'create' : !a.approved ? 'review' : !a.published ? 'publish' : 'done';

  const stateOf = key => {
    const order = ['create', 'review', 'publish'];
    if (at === 'done') return 'done';
    const here = order.indexOf(at);
    const mine = order.indexOf(key);
    return mine < here ? 'done' : mine === here ? 'now' : 'todo';
  };

  /*
   * One line of guidance and ONE action per step, chosen by what is actually
   * missing. A nasheed comes first inside Create because a lecture cannot
   * finish without one -- that was the old list's first item and the only one
   * whose absence silently stalls a run, so losing it would have been the real
   * cost of removing that list.
   */
  const say = (hint, action, actionLabel) => ({ hint, action, actionLabel });
  const step = {
    create: working ? say('Your lecture is being processed. Nothing to do while it runs.', '', '')
      : a.imported && !created ? say('That import came back with no clips. Try a different stretch of the lecture.', 'paste', 'Try another range')
      : nasheeds === 0 ? say('Start with a nasheed — every clip mixes one in, so nothing finishes without it.', 'nasheed', 'Add a nasheed')
      : say('Paste a YouTube link or upload a file, and choose the minutes worth clipping.', 'paste', 'Paste a lecture'),
    review: waiting === 1 ? say('One clip is waiting. Keep the ones worth posting — nothing publishes until you approve it.', 'review', 'Open the review queue')
      : waiting > 1 ? say(`${waiting} clips are waiting. Keep the ones worth posting — nothing publishes until you approve it.`, 'review', 'Open the review queue')
      : say('Watch your clips and keep the ones worth posting.', 'review', 'Open the review queue'),
    publish: connected === 0
      ? say('Connect a channel and your approved clip goes out in the next posting window.', 'connect', 'Connect a channel')
      : scheduled
        ? say('Your clip has a slot and a channel. It posts itself when the time comes.', 'schedule', 'See the schedule')
        : say('Give your approved clip a time — press a free slot in the week, or Slot it.', 'schedule', 'Open the schedule'),
  }[at] || say('', '', '');
  const hint = step.hint;

  const stepIndex = ['create', 'review', 'publish'].indexOf(at);
  return {
    show: at !== 'done',
    at,
    // The "one all the way through" dialog, decided HERE rather than in the
    // browser. It used to fire on `at === 'done'` alone behind a localStorage
    // guard -- so every established account met it again on every new device,
    // over every screen, congratulated for a run finished weeks earlier. Once
    // per account (ctx.celebratedAt is stamped by the route the dialog calls
    // when it shows) and only while the first publish is fresh.
    celebrate: at === 'done' && !ctx.celebratedAt && isRecent(times.publishedAt, ctx.now),
    stepIndex,
    // Replaces the old list's "1 of 5 done" chip, which counted a different
    // five things and lived in the header away from anything it described.
    progress: at === 'done' ? 'Done' : `Step ${stepIndex + 1} of ${STEPS.length}`,
    steps: STEPS.map(s => ({ ...s, state: stateOf(s.key) })),
    hint,
    action: step.action,
    actionLabel: step.actionLabel,
    // What the old five-step list checked, kept so nothing it taught is lost.
    nasheeds, connected, scheduled,
    // The first-run panel needs both: it only shows before anything has been
    // imported, and it states the cost beside the field that spends it.
    imported: Boolean(a.imported),
    tokensLeft: ctx.tokensLeft == null ? null : Number(ctx.tokensLeft),
    working,
    waiting,
    // The first-clip moment. It is not "clips exist" -- that is true for ever
    // afterwards -- it is "clips exist, this account has never been shown the
    // moment, AND it has not already engaged with them". Without that last
    // clause it raised "your first clips are ready" at somebody who had
    // already approved one, which is a nag rather than a moment. Held on the
    // ACCOUNT rather than in localStorage: a first clip happens once to a
    // person, not once per browser.
    firstClip: Boolean(a.clipsMade && !a.reviewed && !seenAt(state, userId, 'firstClip')),
    firstClipCount: clips.length,
    // The handoff. Same shape, and separately flagged so acknowledging one
    // does not silently spend the other.
    handoff: Boolean(a.clipsMade && !a.reviewed && !seenAt(state, userId, 'handoff')),
    milestones: times,
  };
}

/**
 * The task ladder — what to do next, what it earns, and when you may claim it.
 *
 * Youssef, 3 Sept 2026, on the first version: "so we have all the tasks on one
 * go. Right? I don't like that ... there's gonna be multiple tasks ... the
 * beginning will be like the first user one ... then you have like the second
 * one comes up, and then maybe like on the top you have like tabs that you can
 * go through, to make it more organized ... also, it should be able to claim
 * the tokens, and it should say claimed ... and then comeback rewards. So
 * coming back to the website gets you tokens as well."
 *
 * THREE THINGS SHAPE THIS FILE.
 *
 * 1. **The first group IS the journey's three steps**, read off the same
 *    `journey()` call rather than derived again. v3.96.0 retired a checklist
 *    for telling one person two different things about where they were, and a
 *    ladder that recomputed "have they imported yet" walks back into it.
 *
 * 2. **Everything else is derived from records that already exist** —
 *    `clip.postedAt` for the posting rungs — with ONE exception, below.
 *
 * 3. **A reward is CLAIMED, never granted quietly.** The first cut paid out on
 *    the next state poll, so tokens appeared with nothing to press and nothing
 *    saying they had arrived. Reaching a rung now makes it claimable; the
 *    customer presses Claim; the row says Claimed.
 */

/*
 * The one thing here that is STAMPED rather than derived, and why.
 *
 * "Coming back to the website gets you tokens" cannot be read off any record
 * this product already keeps: web metrics are anonymous, salted per day and
 * public-page only, deliberately (v3.28.0), and nothing else notes that an
 * account opened the app. So the day itself has to be written down. It is the
 * narrowest possible record -- a list of ISO dates, no times, no addresses, no
 * user agents -- and it is capped, so it cannot grow without bound.
 *
 * DISTINCT DAYS, not a consecutive streak, for the same reason the posting
 * rungs count distinct days: a streak breaks on one missed day and punishes
 * somebody for a week away, which is the opposite of a comeback reward. The
 * count only ever goes up.
 */
export const VISIT_DAYS_KEPT = 400;

export function noteVisit(state, userId, at = Date.now()) {
  const user = (state.authUsers || []).find(u => String(u.id || '') === String(userId || ''));
  if (!user) return false;
  const day = new Date(at).toISOString().slice(0, 10);
  const days = Array.isArray(user.visitDays) ? user.visitDays : [];
  // The common case by far: already seen today, nothing to write. Checked
  // against the LAST entry first so a poll costs one comparison rather than a
  // scan of four hundred.
  if (days.length && days[days.length - 1] === day) return false;
  if (days.includes(day)) return false;
  days.push(day);
  user.visitDays = days.slice(-VISIT_DAYS_KEPT);
  return true;
}

export const visitDayCount = user => (Array.isArray(user?.visitDays) ? user.visitDays.length : 0);

/**
 * The groups, in the order Youssef named them.
 *
 * A group is LOCKED until the one it `needs` is finished, which is the "then
 * the second one comes up" half of the ask. Both later groups need only the
 * FIRST: gating the comeback rewards behind thirty posting days would put them
 * out of reach for months, which is not a comeback reward.
 */
export const TASK_GROUPS = [
  {
    id: 'start', title: 'Getting started', needs: null,
    note: 'Your first clip, all the way out.',
    tasks: [
      { id: 'create', from: 'create', title: 'Import your first lecture', note: 'Paste a link and pick the minutes worth clipping.', action: 'paste' },
      { id: 'review', from: 'review', title: 'Approve your first clip', note: 'Nothing posts until you keep it.', action: 'review' },
      { id: 'publish', from: 'publish', title: 'Post your first clip', note: 'Connect a channel and give it a slot.', action: 'schedule', reward: 'taskRewardPublish' },
    ],
  },
  {
    id: 'habit', title: 'Building up', needs: 'start',
    note: 'Enough clips out for a channel to look alive.',
    tasks: [
      { id: 'three', title: 'Post three clips', note: 'One lecture usually produces more than three.', action: 'review', reward: 'taskRewardThree', need: 3, of: 'posted' },
      { id: 'ten', title: 'Post ten clips', note: 'Enough for a channel to look alive.', action: 'schedule', reward: 'taskRewardTen', need: 10, of: 'posted' },
      { id: 'week', title: 'Your first week', note: 'Post on seven different days.', action: 'schedule', reward: 'taskRewardWeek', need: 7, of: 'postDays' },
      { id: 'month', title: 'Your first month', note: 'Post on thirty different days.', action: 'schedule', reward: 'taskRewardMonth', need: 30, of: 'postDays' },
    ],
  },
  {
    id: 'comeback', title: 'Coming back', needs: 'start',
    note: 'Tokens for showing up. Counted in days you opened DeenClipped, so a week away costs you nothing.',
    tasks: [
      { id: 'visit3', title: 'Three days back', note: 'Open DeenClipped on three different days.', action: 'paste', reward: 'taskRewardVisit3', need: 3, of: 'visits' },
      { id: 'visit7', title: 'A week of coming back', note: 'Seven different days.', action: 'paste', reward: 'taskRewardVisit7', need: 7, of: 'visits' },
      { id: 'visit30', title: 'A month of coming back', note: 'Thirty different days.', action: 'paste', reward: 'taskRewardVisit30', need: 30, of: 'visits' },
    ],
  },
];

/** Flat, in group order — the ladder as one list where that is what is wanted. */
export const TASKS = TASK_GROUPS.flatMap(group => group.tasks);

/*
 * Distinct DAYS with a post, never a consecutive streak. A streak breaks on one
 * missed day, and this product posts on a schedule the customer set -- so a
 * streak would punish somebody for choosing four windows a day over eight, or
 * for a platform being down. Counted in UTC, the basis the rest of the app's
 * day buckets use.
 */
const daysIn = times => new Set(times
  .map(Number)
  .filter(n => Number.isFinite(n) && n > 0)
  .map(at => new Date(at).toISOString().slice(0, 10))).size;

/**
 * One account's ladder.
 *
 * `rewards` is passed in rather than imported so this module keeps its
 * no-config, pure-data shape and the tests can drive the economics without
 * touching the environment. `unlimited` suppresses the money entirely: an
 * operator's balance cannot be topped up, so offering them a Claim button
 * would be a control that cannot do anything (invariant 9), and counting their
 * unclaimed tokens put a permanent "+30" on the rail for a reward nobody could
 * ever collect.
 */
export function tasks(state, userId, rewards = {}, opts = {}) {
  const clips = ownedBy(state.clips || [], userId);
  const posted = clips.filter(c => Number(c.postedAt) > 0);
  const user = (state.authUsers || []).find(u => String(u.id || '') === String(userId || ''));
  const j = journey(state, userId);
  const stepState = Object.fromEntries(j.steps.map(s => [s.key, s.state]));
  const paid = paidRewards(state, userId);
  const unlimited = Boolean(opts.unlimited);
  const counts = {
    posted: posted.length,
    postDays: daysIn(posted.map(c => c.postedAt)),
    visits: visitDayCount(user),
  };

  const shape = task => {
    const at = task.of ? counts[task.of] : 0;
    const done = task.from ? stepState[task.from] === 'done' : at >= task.need;
    const reward = Math.max(0, Number(rewards[task.reward] || 0));
    const paidAt = paid[task.id] || null;
    return {
      id: task.id, title: task.title, note: task.note, action: task.action,
      done, reward,
      // Shown only where there is something to count towards. "0 of 30" on a
      // brand new account is discouraging rather than informative.
      progress: task.of ? { at: Math.min(at, task.need), of: task.need } : null,
      // When the reward was CLAIMED, not when the rung was reached. The rung is
      // derived and has no single moment; the claim is an act and does.
      paidAt,
      claimed: Boolean(paidAt),
      claimable: Boolean(done && reward > 0 && !paidAt && !unlimited),
    };
  };

  const doneIn = rows => rows.filter(t => t.done).length;
  const built = [];
  for (const group of TASK_GROUPS) {
    const rows = group.tasks.map(shape);
    const gate = group.needs ? built.find(g => g.id === group.needs) : null;
    const locked = Boolean(gate && gate.done < gate.total);
    built.push({
      id: group.id, title: group.title, note: group.note,
      tasks: rows, done: doneIn(rows), total: rows.length,
      locked,
      // What a locked tab says instead of its rows, so a padlock is never
      // unexplained.
      needsTitle: gate ? gate.title : '',
      claimable: rows.filter(t => t.claimable).length,
    });
  }

  const list = built.flatMap(g => g.tasks);
  const done = list.filter(t => t.done).length;
  const setup = built[0];
  const setupDone = setup.done >= setup.total;
  // The next thing to do, skipping anything inside a group that has not opened.
  const open = built.filter(g => !g.locked);
  const next = open.flatMap(g => g.tasks).find(t => !t.done) || null;

  /*
   * THE RAIL RING AND THE HOME HERO SHOW THE SAME FRACTION.
   *
   * Youssef: "connect the side bar perctnage thing to first user interface hero
   * thing to work with one another." While the hero is up, the ring counts the
   * hero's own three steps; the moment setup finishes the hero disappears by
   * itself and the ring re-anchors to the whole ladder, in the same paint the
   * card's title changes, so the new denominator is never unexplained.
   */
  const ringPercent = setupDone
    ? (list.length ? Math.round((done / list.length) * 100) : 0)
    : Math.round((setup.done / setup.total) * 100);

  return {
    groups: built,
    list,
    done,
    total: list.length,
    percent: list.length ? Math.round((done / list.length) * 100) : 0,
    ringPercent,
    setupDone,
    setup: { done: setup.done, total: setup.total },
    // The hero's own words, so the two surfaces cannot phrase it differently.
    stepLabel: setupDone ? '' : j.progress,
    nowId: setupDone ? (next ? next.id : '') : j.at,
    next,
    // Which tab to open on: where the tokens are, else where the work is.
    openGroup: (built.find(g => g.claimable > 0)
      || built.find(g => !g.locked && g.done < g.total)
      || built.find(g => !g.locked) || built[0]).id,
    earned: list.reduce((sum, t) => sum + (t.claimed ? t.reward : 0), 0),
    // Waiting to be COLLECTED, which is now a real number with a button behind
    // it rather than a promise nothing acts on.
    claimable: list.reduce((sum, t) => sum + (t.claimable ? t.reward : 0), 0),
    unlimited,
  };
}

/** What this account has already claimed, by task id. */
export function paidRewards(state, userId) {
  const user = (state.authUsers || []).find(u => String(u.id || '') === String(userId || ''));
  const rows = user?.taskRewards;
  if (!rows || typeof rows !== 'object') return {};
  const out = {};
  for (const [id, row] of Object.entries(rows)) {
    const at = Number(row?.at ?? row);
    if (Number.isFinite(at) && at > 0) out[id] = at;
  }
  return out;
}

/** One task by id, or null. Used by the claim route to check the rung is real. */
export function taskById(id) {
  return TASKS.find(t => t.id === String(id || '')) || null;
}

function bucket(state, userId) {
  const key = String(userId || '');
  if (!state.userSettings[key]) state.userSettings[key] = {};
  const settings = state.userSettings[key];
  if (!settings.onboarding || typeof settings.onboarding !== 'object') settings.onboarding = {};
  return settings.onboarding;
}

export function seenAt(state, userId, what) {
  return Number(bucket(state, userId)[what]) || null;
}

/** Marks a one-time moment as spent. Never rewritten, so it cannot fire twice. */
export function markSeen(state, userId, what) {
  const seen = bucket(state, userId);
  if (seen[what]) return false;
  seen[what] = Date.now();
  return true;
}

const DAY = 24 * 60 * 60 * 1000;
const median = values => {
  const sorted = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

/**
 * The operator's view: the five milestones, how many accounts reached each,
 * and how long it took them.
 *
 * The COUNT alone was already on the First 100 screen (growth.funnel). What
 * was missing is the time, and the time is the actionable half: a step
 * everybody eventually passes but takes four days to pass is a different
 * problem from one half of them never pass, and a count cannot tell them
 * apart. Reported as a median rather than a mean, because one account that
 * signed up in August and imported in September would drag a mean into
 * meaninglessness at this sample size.
 *
 * `stuckNow` counts accounts sitting at each step RIGHT NOW, which is the
 * number that says who to go and talk to.
 */
export function activationReport(state, users) {
  const rows = users.map(user => ({ user, m: milestones(state, user.id), j: journey(state, user.id) }));
  const reached = key => rows.filter(row => row.m[key]).length;
  const gap = (from, to) => median(rows
    .filter(row => row.m[from] && row.m[to] && row.m[to] >= row.m[from])
    .map(row => row.m[to] - row.m[from]));

  const stuckNow = { create: 0, review: 0, publish: 0, done: 0 };
  for (const row of rows) stuckNow[row.j.at] += 1;

  return {
    accounts: rows.length,
    // Named as Youssef named them, in his order.
    steps: [
      { key: 'signedUp', label: 'Signed up', count: rows.length, sinceSignup: 0 },
      { key: 'imported', label: 'First source', count: reached('importedAt'), sinceSignup: gap('signedUpAt', 'importedAt') },
      { key: 'clips', label: 'First clip', count: reached('clipsAt'), sinceSignup: gap('signedUpAt', 'clipsAt') },
      { key: 'approved', label: 'First approval', count: reached('approvedAt'), sinceSignup: gap('signedUpAt', 'approvedAt') },
      { key: 'published', label: 'First publish', count: reached('publishedAt'), sinceSignup: gap('signedUpAt', 'publishedAt') },
    ],
    // Step to step, which is where a specific stall shows up. Signup ->
    // import is the one this product has always lost people at.
    between: [
      { from: 'Signed up', to: 'First source', ms: gap('signedUpAt', 'importedAt') },
      { from: 'First source', to: 'First clip', ms: gap('importedAt', 'clipsAt') },
      { from: 'First clip', to: 'First approval', ms: gap('clipsAt', 'approvedAt') },
      { from: 'First approval', to: 'First publish', ms: gap('approvedAt', 'publishedAt') },
    ],
    stuckNow,
    // Accounts that have been sitting at a step for more than a day, which is
    // the list worth acting on rather than the aggregate.
    stalled: rows
      .filter(row => row.j.show && row.m.signedUpAt && Date.now() - (lastMilestone(row.m) || row.m.signedUpAt) > DAY)
      .map(row => ({
        email: row.user.email || '', at: row.j.at,
        waitingMs: Date.now() - (lastMilestone(row.m) || row.m.signedUpAt),
      }))
      .sort((a, b) => b.waitingMs - a.waitingMs)
      .slice(0, 20),
  };
}

/** The most recent thing that happened, so "waiting since" means something. */
function lastMilestone(m) {
  const times = [m.publishedAt, m.approvedAt, m.clipsAt, m.importedAt].filter(Boolean);
  return times.length ? Math.max(...times) : null;
}
