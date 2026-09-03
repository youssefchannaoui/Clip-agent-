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
 * The task ladder — what to do next, and what it earns.
 *
 * Youssef, 3 Sept 2026, on a rail card showing "Complete setup 20%": "this is
 * a great idea for new users also you can add that new user one so then 5
 * steps then add tasks like upload your first 3 clips finish 1 week finish 1
 * month and etc and they can earn tokens with it as well."
 *
 * THE FIRST THREE RUNGS ARE THE JOURNEY'S OWN THREE STEPS, read straight off
 * `journey()`. Not "the same idea implemented again" — the same call. That is
 * the whole reason this is safe to build: v3.96.0 retired a five-step checklist
 * for sitting beside the Create -> Review -> Publish strip and telling one
 * person two different things about where they were, and a ladder that
 * recomputed "have they imported yet" would walk straight back into it.
 *
 * Everything past those three continues from the same records — clip.postedAt
 * and nothing else — so this stays derived and retroactive like the rest of
 * this module. Nothing is stamped except the fact that a reward was PAID,
 * which is an event and belongs in the ledger rather than in a derivation.
 */
export const TASKS = [
  // The three the journey already owns. `from` names the step whose state
  // decides this rung, so there is one answer rather than two.
  { id: 'create', from: 'create', title: 'Import your first lecture', note: 'Paste a link and pick the minutes worth clipping.', action: 'paste' },
  { id: 'review', from: 'review', title: 'Approve your first clip', note: 'Nothing posts until you keep it.', action: 'review' },
  { id: 'publish', from: 'publish', title: 'Post your first clip', note: 'Connect a channel and give it a slot.', action: 'schedule', reward: 'taskRewardPublish' },
  // And the ones that continue past where the journey stops.
  { id: 'three', title: 'Post three clips', note: 'One lecture usually produces more than three.', action: 'review', reward: 'taskRewardThree', need: 3, of: 'posted' },
  { id: 'ten', title: 'Post ten clips', note: 'Enough for a channel to look alive.', action: 'schedule', reward: 'taskRewardTen', need: 10, of: 'posted' },
  { id: 'week', title: 'Your first week', note: 'Post on seven different days.', action: 'schedule', reward: 'taskRewardWeek', need: 7, of: 'days' },
  { id: 'month', title: 'Your first month', note: 'Post on thirty different days.', action: 'schedule', reward: 'taskRewardMonth', need: 30, of: 'days' },
];

/*
 * Distinct DAYS with a post, never a consecutive-day streak.
 *
 * A streak breaks on one missed day, and this product posts on a schedule the
 * customer set — so a streak would punish somebody for choosing four windows a
 * day over eight, or for a platform being down. Distinct days only ever go up,
 * which is the habit actually worth rewarding. Counted in UTC, the same basis
 * the rest of the app's day buckets use.
 */
const postedDays = clips => new Set(clips
  .map(c => Number(c.postedAt))
  .filter(n => Number.isFinite(n) && n > 0)
  .map(at => new Date(at).toISOString().slice(0, 10))).size;

/**
 * One account's ladder. `rewards` is passed in rather than imported so this
 * module keeps its no-config, pure-data shape and the tests can drive the
 * economics without touching the environment.
 */
export function tasks(state, userId, rewards = {}) {
  const clips = ownedBy(state.clips || [], userId);
  const posted = clips.filter(c => Number(c.postedAt) > 0);
  const j = journey(state, userId);
  const stepState = Object.fromEntries(j.steps.map(s => [s.key, s.state]));
  const paid = paidRewards(state, userId);
  const counts = { posted: posted.length, days: postedDays(posted) };

  const list = TASKS.map(task => {
    const at = task.of ? counts[task.of] : 0;
    const done = task.from ? stepState[task.from] === 'done' : at >= task.need;
    const reward = Math.max(0, Number(rewards[task.reward] || 0));
    return {
      id: task.id, title: task.title, note: task.note, action: task.action,
      done, reward,
      // Shown only where there is something to count towards. "0 of 30" on a
      // brand new account is discouraging rather than informative, so a rung
      // nobody has started reports its target and no progress bar.
      progress: task.of ? { at: Math.min(at, task.need), of: task.need } : null,
      // When the reward actually landed, not when the rung was reached. The
      // rung's completion is derived and has no single moment; the payment is
      // an event and does.
      paidAt: paid[task.id] || null,
    };
  });

  const done = list.filter(t => t.done).length;
  const next = list.find(t => !t.done) || null;
  const setup = list.slice(0, 3);
  const setupDone = setup.every(t => t.done);
  const setupCount = setup.filter(t => t.done).length;

  /*
   * THE RAIL RING AND THE HOME HERO SHOW THE SAME FRACTION.
   *
   * Youssef, 3 Sept 2026: "connect the side bar perctnage thing to first user
   * interface hero thing to work with one another." They read one source
   * already, but they COUNTED different things -- the rail said 14% (one rung
   * of seven) beside a hero saying "Step 1 of 3", and nothing on screen said
   * those were the same fact.
   *
   * So while the hero is up, the ring counts the hero's own three steps and
   * the card speaks the hero's own step label. The moment setup finishes the
   * hero disappears by itself (journey show:false) and the ring re-anchors to
   * the whole ladder, with the card's title changing in the same paint so the
   * new denominator is never unexplained.
   */
  const ringPercent = setupDone
    ? (list.length ? Math.round((done / list.length) * 100) : 0)
    : Math.round((setupCount / setup.length) * 100);

  return {
    list,
    done,
    total: list.length,
    // Whole percent, floored — 99% on a finished ladder would read as broken.
    percent: list.length ? Math.round((done / list.length) * 100) : 0,
    ringPercent,
    // What the rail card says. "Complete setup" only while the setup half is
    // genuinely unfinished, so an established account is not told to set up.
    setupDone,
    setup: { done: setupCount, total: setup.length },
    // The hero's own words, so the two surfaces cannot phrase it differently.
    // Empty once setup is done, because the hero is gone by then.
    stepLabel: setupDone ? '' : j.progress,
    // Which rung the hero is standing on, so the panel marks the same one the
    // strip highlights rather than merely the first unfinished row.
    nowId: setupDone ? (next ? next.id : '') : j.at,
    next,
    earned: list.reduce((sum, t) => sum + (t.paidAt ? t.reward : 0), 0),
    unclaimed: list.reduce((sum, t) => sum + (t.done && !t.paidAt ? t.reward : 0), 0),
  };
}

/** What this account has already been paid for, by task id. */
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
