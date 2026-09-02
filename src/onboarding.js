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
export function journey(state, userId) {
  const a = activationOf(state, userId);
  const times = milestones(state, userId);
  const clips = ownedBy(state.clips || [], userId);
  const projects = ownedBy(state.projects || [], userId);
  const working = projects.some(p => ['queued', 'processing'].includes(String(p.status || '')));
  const waiting = clips.filter(c => String(c.status || '') === 'waiting').length;

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

  const hint = {
    create: working ? 'Your lecture is being processed. Nothing to do while it runs.'
      : a.imported && !created ? 'That import came back with no clips. Try a different stretch of the lecture.'
      : 'Paste a YouTube link or upload a file, and choose the minutes worth clipping.',
    review: waiting === 1 ? 'One clip is waiting. Keep the ones worth posting — nothing publishes until you approve it.'
      : waiting > 1 ? `${waiting} clips are waiting. Keep the ones worth posting — nothing publishes until you approve it.`
      : 'Watch your clips and keep the ones worth posting.',
    publish: 'Connect a channel and your approved clip goes out in the next posting window.',
  }[at] || '';

  return {
    show: at !== 'done',
    at,
    stepIndex: ['create', 'review', 'publish'].indexOf(at),
    steps: STEPS.map(step => ({ ...step, state: stateOf(step.key) })),
    hint,
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
