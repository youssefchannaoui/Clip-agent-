/*
 * Money integrity: what the records say, and where they contradict themselves.
 *
 * This exists because of a real bug rather than as a precaution.
 * `userBySubscription(undefined)` compared an undefined id against every
 * account's `stripeSubscriptionId` -- ALSO undefined for anyone holding a
 * billing record and no subscription -- so the first such account matched and
 * an invoice carrying no subscription id had its money recorded against a
 * stranger. The comparison is fixed. That does NOT fix the rows already
 * written, and this module exists to find them.
 *
 * Three rules, and the first one is the important one:
 *
 * 1. **It reports. It never writes.** Nothing here mutates a revenue event, a
 *    billing record or a user. A misattributed payment is a question about a
 *    real person's money, and the correction depends on facts only Stripe and
 *    Youssef hold. An automatic "fix" that guessed would turn one wrong row
 *    into two.
 * 2. **Every finding names what would have to be true for it to be benign.**
 *    A flag with no explanation gets ignored on the second reading.
 * 3. **It reads local state only.** No Stripe API call, so it is safe to run
 *    on every owner page load and cannot leak a key or spend a rate limit.
 *    That also bounds it: it can prove two accounts claim one customer id, and
 *    it cannot prove which one Stripe agrees with.
 */

const asArray = value => (Array.isArray(value) ? value : []);
const idOf = value => String(value || '').trim();

/** Money, for a human reading a report at 1am. */
function money(minor, currency) {
  const amount = (Number(minor) || 0) / 100;
  return `${amount.toFixed(2)} ${String(currency || '').toUpperCase() || '?'}`;
}

/**
 * Audit the stored financial relationships.
 *
 * `state` is the app state. `knownPaths` is the set of landing paths that
 * legitimately exist, so an attribution pointing somewhere impossible can be
 * told apart from one pointing at a page that has since been retired.
 */
export function auditFinance(state = {}, knownPaths = new Set()) {
  const users = asArray(state.authUsers);
  const revenue = asArray(state.revenueEvents);
  const findings = [];
  const add = (severity, kind, detail, benignIf) =>
    findings.push({ severity, kind, detail, benignIf });

  const byUserId = new Map(users.map(user => [idOf(user.id), user]));

  // ── Stripe identifiers claimed by more than one account ───────────────────
  // Two accounts naming one Stripe customer means one of them is receiving
  // somebody else's plan, allowance and invoices. There is no benign version
  // of a shared SUBSCRIPTION id at all.
  for (const field of ['stripeCustomerId', 'stripeSubscriptionId']) {
    const holders = new Map();
    for (const user of users) {
      const id = idOf(user.billing?.[field]);
      if (!id) continue;
      if (!holders.has(id)) holders.set(id, []);
      holders.get(id).push(idOf(user.id));
    }
    for (const [id, owners] of holders) {
      if (owners.length < 2) continue;
      add('critical', 'shared-stripe-id',
        `${field} ${id} is claimed by ${owners.length} accounts: ${owners.join(', ')}`,
        field === 'stripeCustomerId'
          ? 'One account was merged into another and the old record was left behind.'
          : 'Nothing. Two accounts cannot share one subscription.');
    }
  }

  // ── Revenue recorded against an account that no longer exists ─────────────
  for (const event of revenue) {
    const userId = idOf(event.userId);
    if (!userId || byUserId.has(userId)) continue;
    add('warn', 'revenue-orphan-account',
      `${money(event.amountMinor, event.currency)} (${event.stripeId || event.id}) is filed against ${userId}, which is not an account`,
      'The account was deleted after the payment. The money is still real and still counted.');
  }

  // ── The bug's own signature ───────────────────────────────────────────────
  // Before the fix, an invoice with no subscription id matched the FIRST
  // account holding a billing record and no subscription of its own. The trace
  // it leaves: subscription revenue on an account that has never had a
  // subscription id. That is not proof -- a subscription can be cancelled and
  // the id cleared -- so it is reported for checking rather than as fact.
  for (const event of revenue) {
    if (event.kind !== 'subscription') continue;
    const user = byUserId.get(idOf(event.userId));
    if (!user) continue;
    const hasSubscription = idOf(user.billing?.stripeSubscriptionId);
    const hasCustomer = idOf(user.billing?.stripeCustomerId);
    if (!hasSubscription && !hasCustomer) {
      add('critical', 'possible-misattribution',
        `${money(event.amountMinor, event.currency)} of SUBSCRIPTION revenue (${event.stripeId || event.id}) is filed against ${user.email || user.id}, which holds no Stripe customer and no subscription id`,
        'The subscription was cancelled and both ids were cleared afterwards. Check the invoice in Stripe: whose customer is it?');
    }
  }

  // ── One Stripe object counted twice ───────────────────────────────────────
  const byStripeId = new Map();
  for (const event of revenue) {
    const id = idOf(event.stripeId);
    if (!id) continue;
    if (!byStripeId.has(id)) byStripeId.set(id, []);
    byStripeId.get(id).push(event);
  }
  for (const [id, events] of byStripeId) {
    if (events.length < 2) continue;
    const accounts = [...new Set(events.map(e => idOf(e.userId)))];
    add('critical', 'double-counted',
      `Stripe object ${id} appears ${events.length} times${accounts.length > 1 ? `, against ${accounts.length} different accounts` : ''}`,
      'Nothing. The dedupe guard should make this impossible; if it is here, the guard was bypassed or the state was edited.');
  }

  // ── Money that belongs to nobody ──────────────────────────────────────────
  const unattributed = revenue.filter(event => !idOf(event.userId));
  if (unattributed.length) {
    const total = unattributed.reduce((sum, e) => sum + (Number(e.amountMinor) || 0), 0);
    add('warn', 'revenue-unattributed',
      `${unattributed.length} payment(s) totalling ${money(total, unattributed[0].currency)} are filed against no account`,
      'Correct and deliberate: since the lookup was fixed, an invoice whose customer cannot be identified is filed against nobody rather than against an arbitrary account. Better here than on the wrong books.');
  }

  // ── A paying account with no landing attribution ──────────────────────────
  // Not a fault -- attribution only started on 30 Aug 2026 and anyone who
  // signed up earlier has none -- but it bounds how much the landing table can
  // be trusted, so it is stated rather than left to be inferred.
  const payingIds = new Set(revenue.filter(e => idOf(e.userId)).map(e => idOf(e.userId)));
  const payingWithoutLanding = [...payingIds]
    .map(id => byUserId.get(id))
    .filter(user => user && !idOf(user.signupLanding));
  if (payingWithoutLanding.length) {
    add('info', 'paid-without-attribution',
      `${payingWithoutLanding.length} paying account(s) have no landing page recorded`,
      'They signed up before landing attribution shipped on 30 Aug 2026. Expected, and it means the landing table under-counts rather than mis-counts.');
  }

  // ── Attribution pointing somewhere that cannot be landed on ───────────────
  if (knownPaths.size) {
    for (const user of users) {
      const landing = idOf(user.signupLanding);
      if (!landing) continue;
      if (knownPaths.has(landing)) continue;
      add('warn', 'impossible-landing',
        `${user.email || user.id} is attributed to ${landing}, which is not a public page`,
        'The page was retired after they arrived — check RETIRED_PAGES. If it was never a page, the cookie was hand-edited and the value should be ignored.');
    }
  }

  // ── An account credited for a conversion it never had ─────────────────────
  for (const user of users) {
    if (!user.landingCredited) continue;
    if (payingIds.has(idOf(user.id))) continue;
    add('warn', 'credited-without-payment',
      `${user.email || user.id} is marked as a credited conversion but has no revenue recorded`,
      'Their payment was recorded before the revenue ledger existed, or it was refunded. The landing table over-counts this page by one.');
  }

  const rank = { critical: 0, warn: 1, info: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    checkedAt: Date.now(),
    scanned: { accounts: users.length, revenueEvents: revenue.length },
    counts: {
      critical: findings.filter(f => f.severity === 'critical').length,
      warn: findings.filter(f => f.severity === 'warn').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
    findings,
    // Said in the payload so a reader cannot mistake a clean result for proof
    // that Stripe agrees with these records.
    limits: [
      'Reads stored records only — no Stripe API call, so it can show that two accounts claim one customer id and not which one Stripe agrees with.',
      'Nothing here writes. Every correction is a decision about a real person’s money and needs the invoice in Stripe open beside it.',
      'A clean report means the stored records do not contradict each other. It does not mean they match Stripe.',
    ],
  };
}
