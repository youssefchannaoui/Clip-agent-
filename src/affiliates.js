/*
 * The affiliate programme: cash commission on money that actually arrived.
 *
 * Modelled on OpusClip's published terms because that is what was asked for
 * (Youssef, 8 Sept 2026: "just kinda look at Opus and see how they how they do
 * it") -- 25% of every subscription payment for the first twelve months of each
 * referred account, a 60-day attribution window, a 30-day hold, and a small
 * per-currency payout floor. The numbers live in config.js with the field
 * research beside them; this file is the arithmetic and the rules.
 *
 * FIVE DECISIONS SHAPE EVERYTHING HERE, and each is a way the money could
 * otherwise go wrong:
 *
 * 1. **What is OWED is DERIVED; what was PAID is STORED.** A commission is
 *    computed from `state.revenueEvents` -- Stripe's own paid invoices, already
 *    deduped on the Stripe object id -- every time it is asked for. So it is
 *    retroactive, needs no migration, and cannot drift from the books. A
 *    PAYOUT is a fact about the world that nothing can re-derive, so it is
 *    written down (`state.affiliatePayouts`). Storing what is owed as well
 *    would be two answers to one question, and this file exists because one of
 *    them would eventually be wrong about somebody's money.
 *
 * 2. **NOTHING HERE CONVERTS MONEY.** A payment carries the currency Stripe
 *    charged in, and the commission is that currency. Balances are a map of
 *    currency -> minor units and are never summed across currencies, for the
 *    same reason the pricing pages never convert a price: a number we invented
 *    an exchange rate for is a promise the payout does not keep.
 *
 * 3. **ONE CODE, ONE COOKIE, ONE ATTRIBUTION.** There is no second affiliate
 *    link. `referrals.js` already owns the code, the `/r/CODE` route, the
 *    `dc_ref` cookie and `user.referredBy`; an affiliate simply is a referrer
 *    whose application was approved. What changes is what the referrer is
 *    PAID: an approved affiliate earns cash and NOT the token bonus, which
 *    makes "never both" true by construction rather than by a check somebody
 *    has to remember.
 *
 * 4. **THE HOLD IS ONLY MEANINGFUL BECAUSE REFUNDS ARE WATCHED.** A commission
 *    sits pending for `affiliatePendingDays` so the refund window closes
 *    first -- but a delay that nothing checks is just a delay. `billing.js`
 *    now records `charge.refunded` and `charge.dispute.created` into
 *    `state.refundEvents`, and a commission whose source payment appears there
 *    is VOID. A refund arriving after the money was paid out is a clawback,
 *    which is reported for the operator and never deducted automatically:
 *    taking money back from someone's balance without telling them is how an
 *    affiliate programme loses its affiliates.
 *
 * 5. **NOBODY IS APPROVED AUTOMATICALLY AND NOTHING IS PAID AUTOMATICALLY.**
 *    An application is `pending` until a person approves it, and a commission
 *    becomes `paid` only when a person records a payout. Both are one click
 *    and both are deliberate.
 *
 * What this deliberately does NOT do: automatic transfers. Paying out for real
 * needs Stripe Connect and its KYC, or a PayPal Payouts integration, and
 * claiming otherwise would be the stale-claim failure this codebase keeps
 * paying for. The operator pays by whatever rail they already use and records
 * it here; `payoutMethods()` says exactly that on screen.
 */

const DAY = 24 * 60 * 60 * 1000;

/** An application, and therefore an affiliate, can be in exactly these. */
export const STATUSES = Object.freeze(['pending', 'approved', 'declined', 'suspended']);

/** A commission row, derived. Order matters: the first that applies wins. */
export const COMMISSION_STATES = Object.freeze(['void', 'paid', 'pending', 'due']);

const num = value => (Number.isFinite(Number(value)) ? Number(value) : 0);
const str = value => String(value == null ? '' : value);
const lower = value => str(value).toLowerCase();

/**
 * The application record, or null.
 *
 * Read-only: nothing here mints one, because applying is an act a person takes
 * and `apply()` is where the terms are agreed to.
 */
export function applicationFor(state, userId) {
  const id = str(userId);
  if (!id) return null;
  return (state?.affiliates || []).find(item => str(item?.userId) === id) || null;
}

/** Is this account earning commission right now? */
export function isApproved(state, userId) {
  return applicationFor(state, userId)?.status === 'approved';
}

/**
 * Apply to the programme.
 *
 * The payout details are collected at APPLICATION rather than at payout time,
 * because the single most common operational mistake in this field is paying
 * first and chasing the details afterwards. They are also the only personal
 * data this module holds, so they are the only thing it is careful about:
 * `publicView` never returns them, and only the operator's own routes do.
 */
export function apply(state, user, details = {}) {
  if (!user) return { ok: false, error: 'Sign in first.' };
  state.affiliates ||= [];

  const existing = applicationFor(state, user.id);
  if (existing && existing.status !== 'declined') {
    return { ok: false, error: 'You have already applied.', application: existing };
  }

  const audience = str(details.audience).trim().slice(0, 400);
  const channel = str(details.channel).trim().slice(0, 300);
  const payoutMethod = lower(details.payoutMethod);
  const payoutDetail = str(details.payoutDetail).trim().slice(0, 200);

  if (!audience) return { ok: false, error: 'Tell us where you would share DeenClipped.' };
  if (!payoutMethods().some(m => m.id === payoutMethod)) {
    return { ok: false, error: 'Choose how you would like to be paid.' };
  }
  if (!payoutDetail) return { ok: false, error: 'Add the account we should pay.' };
  if (!details.agreed) return { ok: false, error: 'Agree to the affiliate terms to apply.' };

  // A declined application is REPLACED rather than added to: two rows for one
  // account is two answers to "is this person an affiliate".
  const record = {
    userId: str(user.id),
    status: 'pending',
    audience,
    channel,
    payoutMethod,
    payoutDetail,
    agreedAt: Date.now(),
    // The terms someone agreed to are the terms they are owed under, so the
    // rates are stamped rather than read live. A rate change must never
    // retroactively rewrite what an existing affiliate was promised.
    terms: termsSnapshot(),
    createdAt: Date.now(),
    decidedAt: null,
    decidedBy: '',
    note: '',
  };
  const at = state.affiliates.findIndex(item => str(item?.userId) === str(user.id));
  if (at >= 0) state.affiliates[at] = record; else state.affiliates.push(record);
  return { ok: true, application: record };
}

/** The operator's decision. Approving is what starts commission accruing. */
export function decide(state, userId, status, { by = '', note = '' } = {}) {
  const application = applicationFor(state, userId);
  if (!application) return { ok: false, error: 'No application for that account.' };
  if (!STATUSES.includes(status) || status === 'pending') {
    return { ok: false, error: 'Not a decision this programme makes.' };
  }
  application.status = status;
  application.decidedAt = Date.now();
  application.decidedBy = str(by).slice(0, 120);
  application.note = str(note).slice(0, 400);
  // Stamped once, and never rewritten: commission accrues from the moment
  // somebody was FIRST approved, so a suspend-then-reapprove cannot silently
  // backdate a claim over the gap.
  if (status === 'approved' && !application.approvedAt) application.approvedAt = Date.now();
  return { ok: true, application };
}

/** Where the money can go. Every one of these is a MANUAL transfer today. */
export function payoutMethods() {
  return [
    { id: 'paypal', label: 'PayPal', hint: 'The email on your PayPal account.' },
    { id: 'wise', label: 'Wise', hint: 'The email or Wisetag on your Wise account.' },
    { id: 'bank', label: 'Bank transfer', hint: 'Account name, BSB/IBAN and number.' },
  ];
}

/** The rates as they stand, stamped onto an application when it is made. */
export function termsSnapshot(config = globalConfig()) {
  return {
    percent: num(config.affiliateCommissionPercent),
    months: num(config.affiliateCommissionMonths),
    cookieDays: num(config.affiliateCookieDays),
    holdDays: num(config.affiliatePendingDays),
    minimumMinor: num(config.affiliateMinimumPayoutMinor),
  };
}

// config is injected by every caller in the app; this is only the fallback for
// a direct import in a test, and it must never invent a rate.
let globalConfigValue = { affiliateCommissionPercent: 0, affiliateCommissionMonths: 0, affiliateCookieDays: 60, affiliatePendingDays: 30, affiliateMinimumPayoutMinor: 0 };
function globalConfig() { return globalConfigValue; }
export function useConfig(config) { globalConfigValue = config || globalConfigValue; }

/**
 * Every payment that was ever refunded or disputed, by Stripe charge id.
 *
 * A refund event names the CHARGE; a revenue event names the invoice or the
 * charge depending on which webhook wrote it, and carries `chargeId` where
 * Stripe gave one. Both are checked, because matching on only one silently
 * pays commission on refunded money -- which is exactly the failure the hold
 * window is there to prevent.
 */
function refundedIds(state) {
  const out = new Set();
  for (const event of state?.refundEvents || []) {
    if (event?.stripeId) out.add(str(event.stripeId));
    if (event?.chargeId) out.add(str(event.chargeId));
    if (event?.invoiceId) out.add(str(event.invoiceId));
  }
  return out;
}

/** Which commission keys have already been paid, and in which batch. */
function paidKeys(state) {
  const out = new Map();
  for (const batch of state?.affiliatePayouts || []) {
    for (const key of batch?.keys || []) out.set(str(key), batch);
  }
  return out;
}

/**
 * Every commission this programme has ever earned, derived from the books.
 *
 * Walks the revenue events once. A row is produced only when ALL of these
 * hold, and each one is a way commission could otherwise be paid wrongly:
 *
 *   - the payment is a SUBSCRIPTION payment (a token top-up is a one-off
 *     purchase, not recurring revenue somebody introduced);
 *   - the paying account was referred, and the referrer exists;
 *   - the referrer is not the payer (an account cannot refer itself, and
 *     `attachReferral` refuses it too -- belt and braces, because this is the
 *     one place it would cost money);
 *   - the referrer was an APPROVED affiliate before the payment landed;
 *   - the payment is within `months` of that account's FIRST subscription
 *     payment, so the window is the customer's, not the affiliate's.
 *
 * The key is the revenue event's own Stripe id, so a replayed webhook cannot
 * create a second commission for one payment -- the same guard `recordRevenue`
 * and `grantBonusTokens` use.
 */
export function commissions(state, config = globalConfig(), { now = Date.now() } = {}) {
  const percent = num(config.affiliateCommissionPercent);
  const months = num(config.affiliateCommissionMonths);
  const holdMs = Math.max(0, num(config.affiliatePendingDays)) * DAY;
  if (!(percent > 0)) return [];

  const users = state?.authUsers || [];
  const byId = new Map(users.map(u => [str(u.id), u]));
  const refunded = refundedIds(state);
  const paid = paidKeys(state);

  // The first subscription payment PER ACCOUNT starts that account's window.
  // Computed from the same list, so it cannot disagree with the rows below.
  const firstPaid = new Map();
  const subscriptionEvents = (state?.revenueEvents || [])
    .filter(event => event?.kind === 'subscription' && num(event.amountMinor) > 0)
    .slice()
    .sort((a, b) => num(a.createdAt) - num(b.createdAt));
  for (const event of subscriptionEvents) {
    const id = str(event.userId);
    if (id && !firstPaid.has(id)) firstPaid.set(id, num(event.createdAt));
  }

  const rows = [];
  for (const event of subscriptionEvents) {
    const payer = byId.get(str(event.userId));
    const link = payer?.referredBy;
    if (!link) continue;

    const affiliateId = str(link.referrerId);
    if (!affiliateId || affiliateId === str(payer.id)) continue;

    const application = applicationFor(state, affiliateId);
    if (application?.status !== 'approved') continue;

    const approvedAt = num(application.approvedAt || application.decidedAt);
    const at = num(event.createdAt);
    if (!approvedAt || at < approvedAt) continue;

    // The window belongs to the referred CUSTOMER. months of 0 means the first
    // payment only, which is what a one-off programme is.
    const start = firstPaid.get(str(payer.id)) || at;
    const windowEnd = months > 0 ? addMonths(start, months) : start;
    if (at > windowEnd) continue;

    // The rate the affiliate agreed to, never today's -- a rate change must
    // not rewrite what somebody was already promised.
    const rate = num(application.terms?.percent) || percent;
    const amountMinor = Math.round(num(event.amountMinor) * rate / 100);
    if (!amountMinor) continue;

    const key = str(event.stripeId) || `rev:${str(event.id)}`;
    const batch = paid.get(key);
    const voided = refunded.has(str(event.stripeId)) || refunded.has(str(event.chargeId));

    rows.push({
      key,
      affiliateId,
      customerId: str(payer.id),
      amountMinor,
      currency: lower(event.currency),
      baseMinor: num(event.amountMinor),
      ratePercent: rate,
      at,
      availableAt: at + holdMs,
      // Order matters. A refunded payment is void whatever else is true; a
      // paid commission stays paid even if it later refunds, and shows up in
      // `clawbacks()` instead of being silently reversed.
      state: batch ? 'paid' : (voided ? 'void' : (now >= at + holdMs ? 'due' : 'pending')),
      paidAt: batch ? num(batch.at) : null,
      payoutId: batch ? str(batch.id) : '',
      refunded: voided,
    });
  }
  return rows;
}

/**
 * A month later, by the calendar rather than by 30 days.
 *
 * Twelve "months" of 30 days is 360, so a yearly plan's twelfth payment could
 * land five days outside a window a customer was told ran a year. Clamped to
 * the end of a short month, so 31 Jan + 1 month is 28 Feb rather than 3 March.
 */
export function addMonths(at, months) {
  const date = new Date(num(at));
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + num(months));
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date.getTime();
}

/** Sum a set of rows into a per-currency map. Never across currencies. */
export function totals(rows) {
  const out = {};
  for (const row of rows) {
    const bucket = (out[row.currency] ||= { pending: 0, due: 0, paid: 0, void: 0 });
    bucket[row.state] += row.amountMinor;
  }
  return out;
}

/**
 * One affiliate's own view.
 *
 * WHAT IT DELIBERATELY DOES NOT CARRY: who the referred customers are. An
 * affiliate is owed a number, not a list of other people's accounts, and a
 * dashboard that names them hands one customer's identity to another. Counts
 * and amounts only.
 */
export function statementFor(state, userId, config = globalConfig(), { now = Date.now() } = {}) {
  const id = str(userId);
  const application = applicationFor(state, id);
  const rows = commissions(state, config, { now }).filter(row => row.affiliateId === id);
  const referred = (state?.authUsers || []).filter(u => str(u.referredBy?.referrerId || '') === id);

  return {
    status: application?.status || 'none',
    approvedAt: num(application?.approvedAt) || null,
    terms: application?.terms || termsSnapshot(config),
    referred: referred.length,
    activated: referred.filter(u => u.referredBy?.activatedAt).length,
    subscribed: referred.filter(u => u.referredBy?.convertedAt).length,
    // The customers are never named; a commission is dated and priced, and
    // that is everything an affiliate needs to check their own statement.
    commissions: rows.map(row => ({
      at: row.at, amountMinor: row.amountMinor, currency: row.currency,
      state: row.state, availableAt: row.availableAt, ratePercent: row.ratePercent,
    })),
    totals: totals(rows),
    minimumMinor: num(config.affiliateMinimumPayoutMinor),
    payouts: (state?.affiliatePayouts || [])
      .filter(batch => str(batch?.affiliateId) === id)
      .map(batch => ({ id: str(batch.id), at: num(batch.at), amountMinor: num(batch.amountMinor), currency: lower(batch.currency), method: str(batch.method), reference: str(batch.reference) })),
  };
}

/**
 * What the operator owes, per affiliate and per currency.
 *
 * `due` is what may be paid now. The minimum is reported rather than enforced:
 * it exists so a transfer does not cost more in fees than it moves, and an
 * operator settling a small balance -- closing an account, say -- is a
 * legitimate thing to do that a hard wall would forbid.
 */
export function ledger(state, config = globalConfig(), { now = Date.now() } = {}) {
  const rows = commissions(state, config, { now });
  const byAffiliate = new Map();
  for (const row of rows) {
    const bucket = byAffiliate.get(row.affiliateId) || { affiliateId: row.affiliateId, rows: [] };
    bucket.rows.push(row);
    byAffiliate.set(row.affiliateId, bucket);
  }
  const users = new Map((state?.authUsers || []).map(u => [str(u.id), u]));
  const minimum = num(config.affiliateMinimumPayoutMinor);

  return [...byAffiliate.values()].map(bucket => {
    const user = users.get(bucket.affiliateId);
    const application = applicationFor(state, bucket.affiliateId);
    const sums = totals(bucket.rows);
    return {
      affiliateId: bucket.affiliateId,
      email: str(user?.email),
      name: str(user?.name),
      status: application?.status || 'none',
      payoutMethod: str(application?.payoutMethod),
      payoutDetail: str(application?.payoutDetail),
      totals: sums,
      currencies: Object.entries(sums).map(([currency, sum]) => ({
        currency,
        ...sum,
        overMinimum: sum.due >= minimum,
        // Every key that is payable right now, so recording a payout does not
        // have to re-derive which rows it covered.
        keys: bucket.rows.filter(row => row.state === 'due' && row.currency === currency).map(row => row.key),
      })),
    };
  }).sort((a, b) => {
    const aDue = Math.max(0, ...Object.values(a.totals).map(t => t.due));
    const bDue = Math.max(0, ...Object.values(b.totals).map(t => t.due));
    return bDue - aDue;
  });
}

/**
 * Record a payout that has actually been made.
 *
 * Takes the KEYS rather than an amount, so the batch says exactly which
 * commissions it settled and the amount is computed from them rather than
 * typed. A typed amount is how a payout and a ledger come to disagree.
 *
 * Refuses a key that is not currently `due`: paying a pending commission
 * jumps the refund window, and paying one twice is the whole thing the ledger
 * exists to prevent.
 */
export function recordPayout(state, affiliateId, { keys = [], method = '', reference = '', by = '' } = {}, config = globalConfig(), { now = Date.now() } = {}) {
  const id = str(affiliateId);
  if (!isApproved(state, id)) return { ok: false, error: 'That account is not an approved affiliate.' };

  const wanted = new Set(keys.map(str).filter(Boolean));
  if (!wanted.size) return { ok: false, error: 'Nothing selected to pay.' };

  const rows = commissions(state, config, { now })
    .filter(row => row.affiliateId === id && wanted.has(row.key));

  if (rows.length !== wanted.size) return { ok: false, error: 'Some of those commissions are not this affiliate\'s.' };
  const notDue = rows.filter(row => row.state !== 'due');
  if (notDue.length) {
    return { ok: false, error: `${notDue.length} of those are ${notDue[0].state}, not payable.` };
  }
  const currencies = new Set(rows.map(row => row.currency));
  if (currencies.size !== 1) return { ok: false, error: 'One payout, one currency: nothing here converts money.' };

  state.affiliatePayouts ||= [];
  const batch = {
    id: `apo_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    affiliateId: id,
    amountMinor: rows.reduce((sum, row) => sum + row.amountMinor, 0),
    currency: [...currencies][0],
    method: str(method).slice(0, 40),
    reference: str(reference).slice(0, 120),
    by: str(by).slice(0, 120),
    at: now,
    keys: rows.map(row => row.key),
  };
  state.affiliatePayouts.unshift(batch);
  state.affiliatePayouts = state.affiliatePayouts.slice(0, 5000);
  return { ok: true, payout: batch };
}

/**
 * Commission that was paid out and then refunded.
 *
 * REPORTED, NEVER DEDUCTED. Taking money back out of somebody's balance
 * without telling them is how a programme loses the affiliates it has, and the
 * amount is usually small enough that the conversation costs less than the
 * silence. The terms say a clawback may be offset against future earnings;
 * doing it is a decision, and this is the screen it is made on.
 */
export function clawbacks(state, config = globalConfig(), { now = Date.now() } = {}) {
  return commissions(state, config, { now })
    .filter(row => row.state === 'paid' && row.refunded)
    .map(row => ({ ...row, reason: 'The payment behind this commission was refunded or disputed after it was paid out.' }));
}

/**
 * Pairs worth a look before anything is paid.
 *
 * The same posture as `referrals.suspicious`: flags, never blocks. One person
 * with two accounts and a household on one connection look identical from
 * here, and telling them apart properly means fingerprinting, which is off the
 * table. Nothing pays automatically, so a flag costs a conversation.
 */
export function review(state, config = globalConfig(), { now = Date.now() } = {}) {
  const flags = [];
  const users = new Map((state?.authUsers || []).map(u => [str(u.id), u]));

  for (const application of state?.affiliates || []) {
    if (application.status !== 'approved') continue;
    const affiliate = users.get(str(application.userId));
    if (!affiliate) {
      flags.push({ kind: 'missing-account', affiliateId: str(application.userId), detail: 'An approved affiliate whose account no longer exists.' });
      continue;
    }
    const domain = str(affiliate.email).split('@')[1] || '';
    for (const user of users.values()) {
      if (str(user.referredBy?.referrerId || '') !== str(application.userId)) continue;
      const other = str(user.email).split('@')[1] || '';
      if (domain && domain === other && !isConsumerDomain(domain)) {
        flags.push({
          kind: 'same-domain', affiliateId: str(application.userId),
          detail: `${user.email} was referred by ${affiliate.email} — same email domain`,
          benignIf: 'They work together, which is an ordinary way to hear about a tool.',
        });
      }
    }
  }

  for (const row of clawbacks(state, config, { now })) {
    flags.push({ kind: 'clawback', affiliateId: row.affiliateId, detail: row.reason, amountMinor: row.amountMinor, currency: row.currency });
  }
  return flags;
}

const CONSUMER_DOMAINS = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'proton.me', 'protonmail.com']);
function isConsumerDomain(domain) { return CONSUMER_DOMAINS.has(lower(domain)); }

/**
 * What a signed-in account is told about the programme.
 *
 * Never carries the payout detail -- that is the one piece of personal data
 * this module holds, and it belongs to the operator's own screen.
 */
export function publicView(state, user, config = globalConfig(), { now = Date.now() } = {}) {
  const application = applicationFor(state, user?.id);
  const view = {
    enabled: Boolean(config.affiliatesEnabled) && num(config.affiliateCommissionPercent) > 0,
    status: application?.status || 'none',
    terms: termsSnapshot(config),
    methods: payoutMethods(),
  };
  if (application?.status === 'approved') view.statement = statementFor(state, user?.id, config, { now });
  return view;
}
