/*
 * Lifecycle nudges: one email at the one moment an account is stuck.
 *
 * The First 100 funnel found the number that matters -- accounts that sign up
 * and never import anything. Nothing spoke to them: the product emails all
 * fire AFTER a lecture is in (clips ready, clip live, lecture failed). This is
 * the email that fires before, and the ones that fire when someone stops
 * halfway.
 *
 * Rules, each of which is a way this could become spam:
 *
 *  - **One definition of "stuck".** The step comes from referrals.nextStep --
 *    the same function the owner's funnel and DeenAI's next-action card use --
 *    so the nudge, the dashboard and the advice can never disagree about what
 *    an account should do next.
 *  - **Once per step, ever.** `user.nudges[step]` is the timestamp it went;
 *    a restart, a replayed tick or a second deploy cannot resend it.
 *  - **Never two in a row.** At most one nudge per account per day, whatever
 *    the steps say.
 *  - **The person's switch wins.** emailNotifsOff() -- the bell's own toggle
 *    -- silences these along with every other product email.
 *  - **Inert without email.** mailer.send() is a no-op until EMAIL_API_KEY is
 *    set, and NUDGE_EMAILS=false switches the sweep off outright.
 *  - **Capped per sweep.** The first deploy sees every dormant account at once;
 *    twenty a run keeps that a trickle rather than a burst.
 */
import { config } from './config.js';
import * as mailer from './mailer.js';
import * as billing from './billing.js';
import { nextStep, codeFor, activationOf } from './referrals.js';
import { state, save, log, emailNotifsOff } from './store.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** How long an account may sit on a step before it is asked about it. */
export const WAIT = Object.freeze({
  import: 24 * HOUR,   // signed up, never imported
  review: 24 * HOUR,   // clips came back, none reviewed
  publish: 48 * HOUR,  // approved a clip, nothing connected or posted
  upgrade: 0,          // the free window is about to close
});

export const MAX_PER_SWEEP = 20;
export const MIN_GAP_BETWEEN_NUDGES = DAY;
/** The free window is "closing" from this many days out. */
export const UPGRADE_DAYS_LEFT = 2;

const asArray = value => (Array.isArray(value) ? value : []);
const idOf = value => String(value || '');

function isOperator(user) {
  return ['owner', 'admin'].includes(String(user?.role || '').toLowerCase());
}

/** When this account arrived at its current step, or null when unknown. */
export function stuckSince(user, step) {
  const uid = idOf(user?.id);
  const clips = asArray(state.clips).filter(clip => idOf(clip.userId) === uid);
  const earliest = (items, pick) => {
    const stamps = items.map(pick).map(Number).filter(n => Number.isFinite(n) && n > 0);
    return stamps.length ? Math.min(...stamps) : null;
  };
  if (step === 'import') return Number(user.createdAt) || null;
  if (step === 'review') return earliest(clips, clip => clip.createdAt);
  if (step === 'publish') {
    const approved = clips.filter(clip => ['approved', 'scheduled', 'publishing', 'ready', 'posted'].includes(String(clip.status || '')));
    return earliest(approved, clip => clip.approvedAt || clip.updatedAt || clip.createdAt);
  }
  return null;
}

/**
 * The nudge this account is due right now, or null.
 *
 * Pure: reads state, decides, sends nothing. The sweep below is what acts on
 * it, so a test can ask "would you?" without a mailer in the way.
 */
export function dueNudge(user, now = Date.now()) {
  if (!user?.email || isOperator(user)) return null;
  if (!config.nudgeEmailsEnabled) return null;
  if (emailNotifsOff(user.id)) return null;
  const sent = user.nudges && typeof user.nudges === 'object' ? user.nudges : {};
  const lastSent = Math.max(0, ...Object.values(sent).map(Number).filter(Number.isFinite));
  if (lastSent && now - lastSent < MIN_GAP_BETWEEN_NUDGES) return null;

  const step = nextStep(state, user.id).key;
  if ((step === 'import' || step === 'review' || step === 'publish') && !sent[step]) {
    const since = stuckSince(user, step);
    if (since && now - since >= WAIT[step]) return step;
  }
  // The free window closing is its own moment, whatever step the account is
  // on: a person who never imported, or imported once and stopped, still
  // deserves to hear that the clock is running -- after their step nudge has
  // gone, and once only.
  if (sent.upgrade || billing.isPaid(user) || billing.isUnlimited(user)) return null;
  const free = billing.publicBilling(user)?.current?.freeTrial;
  if (!free || !free.endsAt || free.expired) return null;
  if (free.daysLeft !== null && free.daysLeft <= UPGRADE_DAYS_LEFT) return 'upgrade';
  return null;
}

function inviteFor(user) {
  if (!config.referralsEnabled) return null;
  const base = config.publicBaseUrl || 'https://deenclipped.online';
  return {
    url: `${base}/r/${codeFor(state, user)}`,
    bonus: config.referralBonusPaid,
    discount: Boolean(config.stripeReferralCoupon),
  };
}

/**
 * Send every nudge that is due. Returns what went, so a caller can log it and
 * a test can assert it. `send` is injectable for the same reason.
 */
export async function sweep({ now = Date.now(), send = mailer.send } = {}) {
  if (!config.nudgeEmailsEnabled || !mailer.configured()) return [];
  const base = config.publicBaseUrl || 'https://deenclipped.online';
  const sentNow = [];
  for (const user of asArray(state.authUsers)) {
    if (sentNow.length >= MAX_PER_SWEEP) break;
    const step = dueNudge(user, now);
    if (!step) continue;
    const free = step === 'upgrade' ? billing.publicBilling(user)?.current?.freeTrial : null;
    const message = mailer.nudgeMessage({
      step,
      name: String(user.name || '').split(' ')[0],
      appUrl: `${base}/app`,
      freeDaysLeft: free ? free.daysLeft : null,
      invite: step === 'publish' ? inviteFor(user) : null,
    });
    // Marked BEFORE the send resolves: a provider that is slow to answer must
    // not let the next sweep send the same email a second time.
    user.nudges = { ...(user.nudges || {}), [step]: now };
    sentNow.push({ userId: user.id, step });
    save();
    try {
      const ok = await send({ to: user.email, ...message });
      if (!ok) log(`Nudge "${step}" to ${user.email} was not delivered.`, 'warn');
    } catch (error) {
      log(`Nudge "${step}" to ${user.email} failed: ${error.message}`, 'warn');
    }
  }
  return sentNow;
}

/**
 * What the nudges achieved, for the First 100 screen.
 *
 * "Moved" is measured NOW against the step the nudge was about: an account
 * nudged to import that has since imported counts, whenever it did so and
 * whatever else it read. That over-credits the email and is said so on the
 * screen; a click-tracked link would be the honest measure and is not
 * something this product does to its customers.
 */
export function stats(currentState = state) {
  const out = {};
  const passes = (a, step) => (step === 'import' ? a.imported : step === 'review' ? a.reviewed
    : step === 'publish' ? a.published : step === 'upgrade' ? a.paid : false);
  for (const step of Object.keys(WAIT)) out[step] = { sent: 0, moved: 0 };
  for (const user of asArray(currentState.authUsers)) {
    const sent = user?.nudges && typeof user.nudges === 'object' ? user.nudges : {};
    for (const step of Object.keys(sent)) {
      if (!out[step]) continue;
      out[step].sent += 1;
      if (passes(activationOf(currentState, user.id), step)) out[step].moved += 1;
    }
  }
  return out;
}
