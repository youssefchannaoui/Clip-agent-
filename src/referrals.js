/*
 * Referrals, and what counts as one.
 *
 * The rule that shapes everything here: **a signup is not a referral.** An
 * account costs nothing to create, so rewarding one buys fake accounts. A
 * referral counts when the person it brought has ACTIVATED — processed a
 * source video and approved at least one clip — because that is the first
 * moment they have seen what the product does, and it is expensive enough to
 * fake that faking it is not worth anyone's time.
 *
 * Three design decisions worth knowing before changing anything:
 *
 * 1. **Activation is DERIVED, not stored as an event stream.** A user has
 *    activated when their own records say so: a project that completed and a
 *    clip they approved. Both already exist. Adding a parallel event log would
 *    be a second source of truth that drifts from the first, and the first is
 *    the one the customer can see.
 * 2. **Rewards default to ZERO.** The economics are not approved, and code
 *    that pays out by default is code that pays out before anyone decided to.
 *    `config.referralRewards` turns them on; nothing here hard-codes a number.
 * 3. **Every credit is stamped once.** Activation and conversion each write a
 *    timestamp that is checked before writing, so a renewal, a replayed
 *    webhook or a second approved clip cannot pay twice.
 *
 * What this deliberately does NOT do: detect one person running several
 * accounts. Doing that properly means fingerprinting, which is off the table,
 * and doing it badly means punishing a household or an office on one IP.
 * Instead suspicious pairs are SURFACED for the owner (`suspicious()`), and
 * nothing pays out automatically.
 */
import crypto from 'node:crypto';

/** Unambiguous in speech and in a URL: no 0/O, no 1/I/L. */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const CODE_LENGTH = 8;

/**
 * A code that reveals nothing about the account behind it.
 *
 * Random, not derived from the user id: a sequential or hashed-id code lets
 * anyone holding one enumerate the others and count the customers.
 */
export function generateCode(existing = new Set()) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = crypto.randomBytes(CODE_LENGTH);
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) code += ALPHABET[bytes[i] % ALPHABET.length];
    if (!existing.has(code)) return code;
  }
  // 31^8 is ~850 billion; forty collisions means something is very wrong, and
  // a longer code is better than an infinite loop.
  return crypto.randomBytes(12).toString('base64url').toUpperCase().slice(0, 12);
}

/** Codes are compared in one case and one character set, always. */
export const normaliseCode = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16);

/** The referrer's own code, made on first use rather than at signup. */
export function codeFor(state, user) {
  if (!user) return '';
  if (user.referralCode) return user.referralCode;
  const taken = new Set((state.authUsers || []).map(u => u.referralCode).filter(Boolean));
  user.referralCode = generateCode(taken);
  return user.referralCode;
}

export function userByCode(state, code) {
  const wanted = normaliseCode(code);
  if (!wanted) return null;
  return (state.authUsers || []).find(user => user.referralCode === wanted) || null;
}

/**
 * Has this account seen what the product does?
 *
 * A completed import AND an approved clip. Both halves matter: a completed
 * import with nothing approved means they never judged the output, and an
 * approved clip with no completed import cannot happen honestly.
 *
 * Approved is a floor, not an exact match — a clip that has moved on to
 * scheduled or posted was approved to get there, and reading only 'approved'
 * would un-activate a user the moment their clip published.
 */
const APPROVED_OR_BEYOND = new Set(['approved', 'scheduled', 'publishing', 'posted']);
/*
 * The statuses that mean an import FINISHED.
 *
 * This said ['complete','completed','ready'] and the engine has always written
 * 'done' (local-engine.js). So `processed` was false for every project this
 * product has ever run, and three things quietly depended on it:
 *
 *  - `isActivated` is `processed && approved`, so NOBODY has ever counted as
 *    activated -- which is what gates a referral payout.
 *  - `nextStep` returns "your lecture is being processed" the moment it sees
 *    !processed, so every account that had ever imported was told that for
 *    ever, in DeenAI's next-action card and in the lifecycle nudge emails.
 *  - the owner's funnel reported "Processing finished: 0" beside "Imported: 4".
 *    That WAS noticed, and read as a reason to show raw statuses rather than
 *    as a wrong constant.
 *
 * The other three are kept: they cost nothing and an older record may carry
 * one. `done` is what the engine actually writes, and the test pins it against
 * the engine's own assignment rather than against this list.
 */
const IMPORT_DONE = new Set(['done', 'complete', 'completed', 'ready']);

export function activationOf(state, userId) {
  const id = String(userId || '');
  if (!id) return { signedUp: false, imported: false, processed: false, approved: false, paid: false };
  const projects = (state.projects || []).filter(p => String(p.userId || '') === id);
  const clips = (state.clips || []).filter(c => String(c.userId || '') === id);
  const paid = (state.revenueEvents || []).some(e => String(e.userId || '') === id);
  return {
    signedUp: true,
    imported: projects.length > 0,
    processed: projects.some(p => IMPORT_DONE.has(String(p.status || ''))),
    clipsMade: clips.length > 0,
    reviewed: clips.some(c => ['approved', 'rejected', 'scheduled', 'publishing', 'posted'].includes(String(c.status || ''))),
    approved: clips.some(c => APPROVED_OR_BEYOND.has(String(c.status || ''))),
    published: clips.some(c => c.postedAt),
    paid,
  };
}

/** Activated: processed a video AND approved a clip. Nothing less. */
export function isActivated(state, userId) {
  const a = activationOf(state, userId);
  return Boolean(a.processed && a.approved);
}

/**
 * The single next thing this account should do.
 *
 * One step, not a checklist. A user staring at six things to do does none of
 * them; a user told the one next action does it or does not, and either way
 * the owner learns something.
 */
export function nextStep(state, userId) {
  const a = activationOf(state, userId);
  if (!a.imported) {
    return { key: 'import', title: 'Start with one lecture',
      body: 'Paste a YouTube link or upload a file, and mark the minutes worth clipping.', action: 'Import a video' };
  }
  if (!a.processed) {
    return { key: 'processing', title: 'Your lecture is being processed',
      body: 'Nothing to do while this runs. Clips appear in the review queue when it finishes.', action: '' };
  }
  if (!a.clipsMade) {
    return { key: 'no-clips', title: 'No clips came back from that import',
      body: 'That usually means the selected stretch was too short or the audio was unclear. Try a different section.', action: 'Import a video' };
  }
  if (!a.approved) {
    return { key: 'review', title: 'Your clips are waiting for you',
      body: 'Watch them and keep the ones worth posting. Nothing publishes until you approve it.', action: 'Open the review queue' };
  }
  if (!a.published) {
    return { key: 'publish', title: 'You have approved a clip — finish the run',
      body: 'Connect a channel and the clip goes out in your next posting window.', action: 'Connect a channel' };
  }
  if (!a.paid) {
    return { key: 'upgrade', title: 'You have taken a lecture all the way through',
      body: 'That was the whole workflow. A plan gives you the source minutes to keep doing it.', action: 'See plans' };
  }
  return { key: 'done', title: '', body: '', action: '' };
}

/**
 * Record that a new account came from a referral.
 *
 * Refuses, in this order and for these reasons:
 *   - an unknown code, so a hand-edited cookie cannot invent a referrer;
 *   - the account referring itself;
 *   - an account that already has a referrer, so first touch is never
 *     overwritten by a later link.
 */
export function attachReferral(state, user, code) {
  if (!user || user.referredBy) return null;
  const referrer = userByCode(state, code);
  if (!referrer) return null;
  if (String(referrer.id) === String(user.id)) return null;
  user.referredBy = {
    code: referrer.referralCode,
    referrerId: referrer.id,
    landing: String(user.signupLanding || ''),
    createdAt: Date.now(),
    activatedAt: null,
    convertedAt: null,
  };
  return user.referredBy;
}

/**
 * Stamp activation and conversion, once each.
 *
 * Called from a place that runs often (a state read), because both facts are
 * derived and there is no single moment to hook. The guard is the stamp
 * itself: a timestamp that already exists is never rewritten, so a renewal or
 * a replayed webhook cannot pay a second time.
 *
 * Returns what changed, so the caller knows whether to save.
 */
export function settleReferrals(state) {
  const changed = [];
  for (const user of state.authUsers || []) {
    const link = user.referredBy;
    if (!link) continue;
    if (!link.activatedAt && isActivated(state, user.id)) {
      link.activatedAt = Date.now();
      changed.push({ kind: 'activated', referrerId: link.referrerId, userId: user.id });
    }
    if (!link.convertedAt && activationOf(state, user.id).paid) {
      link.convertedAt = Date.now();
      changed.push({ kind: 'converted', referrerId: link.referrerId, userId: user.id });
    }
  }
  return changed;
}

/** What one account's invites have produced. */
export function statsFor(state, user) {
  const id = String(user?.id || '');
  const referred = (state.authUsers || []).filter(u => String(u.referredBy?.referrerId || '') === id);
  const activated = referred.filter(u => u.referredBy.activatedAt);
  const paid = referred.filter(u => u.referredBy.convertedAt);
  const rewards = state.referralRewards?.[id] || { minutes: 0, entries: [] };
  return {
    code: user?.referralCode || '',
    invited: referred.length,
    activated: activated.length,
    paid: paid.length,
    rewardMinutes: rewards.minutes || 0,
  };
}

/**
 * Pairs a person should look at before anything is paid out.
 *
 * Not blocks — flags. One person with two accounts and one household on one
 * connection look the same from here, and the only way to tell them apart
 * without fingerprinting is to ask. Nothing pays automatically, so a flag
 * costs a conversation rather than a customer.
 */
export function suspicious(state) {
  const flags = [];
  const users = state.authUsers || [];
  const byId = new Map(users.map(u => [String(u.id), u]));

  for (const user of users) {
    const link = user.referredBy;
    if (!link) continue;
    const referrer = byId.get(String(link.referrerId));
    if (!referrer) {
      flags.push({ kind: 'missing-referrer', detail: `${user.email || user.id} names referrer ${link.referrerId}, which is not an account` });
      continue;
    }
    // Same address is not proof and is not treated as any: it is the one
    // signal available without fingerprinting, and it is shown as a question.
    const a = String(user.email || '').split('@')[1] || '';
    const b = String(referrer.email || '').split('@')[1] || '';
    if (a && a === b && !['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com'].includes(a)) {
      flags.push({ kind: 'same-domain', detail: `${user.email} was referred by ${referrer.email} — same email domain`, benignIf: 'They work together, which is a normal way to hear about a tool.' });
    }
    if (link.activatedAt && link.createdAt && link.activatedAt - link.createdAt < 60_000) {
      flags.push({ kind: 'instant-activation', detail: `${user.email || user.id} activated ${Math.round((link.activatedAt - link.createdAt) / 1000)}s after signing up`, benignIf: 'They had a video ready and moved fast. Check the clip is real.' });
    }
  }
  return flags;
}

/**
 * May this account's checkout carry the invite discount?
 *
 * Three conditions, and each is a way the discount could otherwise leak:
 *
 *   1. They were invited. A discount for someone nobody referred is just a
 *      lower price.
 *   2. They have not already used it. The discount is for a first
 *      subscription, not for every future one.
 *   3. Their referrer has room. The cap counts referred accounts that have
 *      ACTUALLY SUBSCRIBED with the discount, not accounts that opened a
 *      checkout — otherwise anyone could burn a referrer's allowance by
 *      opening three checkout pages and closing them.
 *
 * The honest limit of counting at payment: three invited people could sit at
 * checkout simultaneously and all be under the cap, so a fourth discount is
 * possible in a race. That is the right way round — a rare extra discount
 * costs a few pounds, and burning a real referrer's allowance on abandoned
 * checkouts costs the referral programme.
 */
export function discountEligible(state, user, maxUses) {
  const link = user?.referredBy;
  if (!link) return { eligible: false, reason: 'not-referred' };
  if (link.discountUsedAt) return { eligible: false, reason: 'already-used' };

  const cap = Math.max(0, Number(maxUses) || 0);
  if (!cap) return { eligible: false, reason: 'disabled' };

  const used = (state.authUsers || []).filter(other =>
    String(other?.referredBy?.referrerId || '') === String(link.referrerId)
    && other.referredBy.discountUsedAt).length;

  if (used >= cap) return { eligible: false, reason: 'referrer-cap-reached', used, cap };
  return { eligible: true, used, cap, remaining: cap - used };
}

/**
 * Record that the discount has been spent. Once, ever, per invited account.
 *
 * Called when a subscription is actually PAID rather than when a checkout is
 * created, so an abandoned checkout costs the referrer nothing.
 */
export function markDiscountUsed(user) {
  const link = user?.referredBy;
  if (!link || link.discountUsedAt) return false;
  link.discountUsedAt = Date.now();
  return true;
}

/** How many of a referrer's discounted invites are left, for their own panel. */
export function discountsLeft(state, user, maxUses) {
  const cap = Math.max(0, Number(maxUses) || 0);
  const used = (state.authUsers || []).filter(other =>
    String(other?.referredBy?.referrerId || '') === String(user?.id)
    && other.referredBy.discountUsedAt).length;
  return { used, cap, remaining: Math.max(0, cap - used) };
}
