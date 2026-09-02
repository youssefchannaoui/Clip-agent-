/*
 * The first hundred paid subscribers, measured.
 *
 * Everything here is DERIVED from records the product already writes —
 * accounts, projects, clips, revenue events, and the analytics buckets. There
 * is no new event stream, and that is a deliberate refusal rather than a
 * shortcut: a parallel log of "user did X" would be a second source of truth
 * that drifts from the first, and the first is the one the customer can see.
 * If this file and the review queue ever disagree, the review queue is right.
 *
 * What it will NOT do:
 *
 * - **No behavioural surveillance.** No page-by-page journeys, no session
 *   replay, no fingerprint. The funnel is built from things the account did
 *   with the product, which it already stores because the product needs them.
 * - **No renewal counted as an acquisition.** A customer is acquired once.
 *   Recurring revenue is real and belongs in the finance figures; putting it
 *   here would make last month's channel look like it wins a new customer
 *   every month.
 * - **No invented Search Console data.** Impressions, queries and positions
 *   are not here, and the payload says so rather than showing a zero, because
 *   a zero reads as "nobody searched" instead of "we cannot see".
 *
 * The ordering principle throughout: rank by PAID, then by activated, then by
 * signups. Never by traffic. A channel with a thousand visits and no customers
 * is a channel to stop working on, and sorting by visits hides exactly that.
 */
import { activationOf, isActivated } from './referrals.js';
import { stats as nudgeStats } from './nudges.js';

const asArray = v => (Array.isArray(v) ? v : []);
const idOf = v => String(v || '');

/** Where an account came from, decided once and in a fixed order. */
export function channelOf(user) {
  if (!user) return 'other';
  // Referral wins over campaign wins over search: a person sent by a friend
  // who then clicked an ad-tagged link is still a referral, and the friend is
  // the reason they are here.
  if (user.referredBy) return 'referral';
  if (user.affiliate?.code) return 'affiliate';
  const utm = user.arrival || {};
  if (utm.utm_medium === 'creator' || utm.utm_source) return 'campaign';
  if (utm.referrerHost) {
    const host = String(utm.referrerHost);
    if (/(^|\.)(google|bing|duckduckgo|yahoo|ecosia|brave)\./.test(host)) return 'organic';
    return 'referral-link';
  }
  if (user.signupLanding) return 'direct-or-organic';
  return 'other';
}

/**
 * The funnel, per account, collapsed to counts.
 *
 * Each stage is a strict superset test rather than a "furthest step reached"
 * flag, so a user who imported twice and approved once is counted once at
 * each stage they genuinely passed.
 */
export function funnel(state, users) {
  const stages = { signedUp: 0, imported: 0, processed: 0, clipsMade: 0, reviewed: 0, approved: 0, published: 0, paid: 0 };
  for (const user of users) {
    const a = activationOf(state, user.id);
    stages.signedUp += 1;
    if (a.imported) stages.imported += 1;
    if (a.processed) stages.processed += 1;
    if (a.clipsMade) stages.clipsMade += 1;
    if (a.reviewed) stages.reviewed += 1;
    if (a.approved) stages.approved += 1;
    if (a.published) stages.published += 1;
    if (a.paid) stages.paid += 1;
  }
  return stages;
}

const rate = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/**
 * The step losing the most people.
 *
 * Reported as a COUNT and a rate together: 90% drop-off across four users is
 * noise, and a rate on its own cannot say which it is.
 */
export function biggestDropOff(stages) {
  const order = [
    ['signed up', 'imported a video', 'signedUp', 'imported'],
    ['imported', 'finished processing', 'imported', 'processed'],
    ['processed', 'got clips back', 'processed', 'clipsMade'],
    ['got clips', 'reviewed one', 'clipsMade', 'reviewed'],
    ['reviewed', 'approved one', 'reviewed', 'approved'],
    ['approved', 'published one', 'approved', 'published'],
    ['approved', 'subscribed', 'approved', 'paid'],
  ];
  let worst = null;
  for (const [fromLabel, toLabel, from, to] of order) {
    const lost = (stages[from] || 0) - (stages[to] || 0);
    if (lost <= 0) continue;
    if (!worst || lost > worst.lost) {
      worst = { from: fromLabel, to: toLabel, lost, of: stages[from], rate: rate(stages[to], stages[from]) };
    }
  }
  return worst;
}

/** Group accounts and rank the groups by paying customers, never by traffic. */
function ranked(state, users, keyOf) {
  const groups = new Map();
  for (const user of users) {
    const key = keyOf(user);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(user);
  }
  const rows = [];
  for (const [key, members] of groups) {
    const activated = members.filter(u => isActivated(state, u.id));
    const paid = members.filter(u => activationOf(state, u.id).paid);
    const revenueMinor = paid.reduce((sum, u) => sum + (Number(u.firstPaidAmountMinor) || 0), 0);
    rows.push({
      key,
      signups: members.length,
      activated: activated.length,
      paid: paid.length,
      signupToActivated: rate(activated.length, members.length),
      activatedToPaid: rate(paid.length, activated.length),
      initialRevenueMinor: revenueMinor,
    });
  }
  return rows.sort((a, b) => (b.paid - a.paid) || (b.activated - a.activated) || (b.signups - a.signups));
}

/**
 * Everything the First 100 screen needs, in one read.
 *
 * `webSummary` is metrics.summary() — passed in rather than imported so this
 * module stays a pure function of state and can be tested without a server.
 */
export function report(state = {}, webSummary = {}) {
  const users = asArray(state.authUsers).filter(u => u && !['owner', 'admin'].includes(String(u.role || '').toLowerCase()));
  const stages = funnel(state, users);
  const revenue = asArray(state.revenueEvents);

  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const newPaidThisMonth = users.filter(u => u.convertedAt && u.convertedAt >= monthStart.getTime()).length;

  // MRR from accounts acquired, normalised to a month. A yearly plan is real
  // revenue but it is not twelve times a monthly customer this month, and
  // showing it as such is how a business talks itself into a number.
  const monthlyEquivalent = users.reduce((sum, u) => {
    const amount = Number(u.firstPaidAmountMinor) || 0;
    if (!amount) return sum;
    const plan = String(u.firstPaidPlan || '');
    if (plan.includes('yearly')) return sum + amount / 12;
    if (plan.includes('weekly')) return sum + amount * (52 / 12);
    return sum + amount;
  }, 0);

  const referred = users.filter(u => u.referredBy);
  const currency = users.find(u => u.firstPaidCurrency)?.firstPaidCurrency || '';

  return {
    checkedAt: Date.now(),
    // The headline. 100 is the target, so the number shown is the number.
    paidSubscribers: stages.paid,
    newPaidThisMonth,
    mrrMinor: Math.round(monthlyEquivalent),
    currency,
    activatedUsers: users.filter(u => isActivated(state, u.id)).length,

    // The lifecycle emails: how many went, and how many of those accounts
    // have since passed the step they were nudged about. "Moved" over-credits
    // the email -- it counts anyone who moved for any reason -- and the screen
    // says so. Click tracking would be the honest measure and is not
    // something this product does to its customers.
    nudges: nudgeStats(state),

    funnel: stages,
    rates: {
      visitorToSignup: rate(stages.signedUp, webSummary.uniques || 0),
      signupToActivated: rate(users.filter(u => isActivated(state, u.id)).length, stages.signedUp),
      activatedToPaid: rate(stages.paid, users.filter(u => isActivated(state, u.id)).length),
      visitorToPaid: rate(stages.paid, webSummary.uniques || 0),
    },
    biggestDropOff: biggestDropOff(stages),

    channels: ranked(state, users, channelOf),
    landingPages: ranked(state, users, u => u.signupLanding || ''),
    campaigns: ranked(state, users, u => u.arrival?.utm_source || ''),
    referrers: ranked(state, users, u => {
      const id = idOf(u.referredBy?.referrerId);
      if (!id) return '';
      const referrer = users.find(x => idOf(x.id) === id) || asArray(state.authUsers).find(x => idOf(x.id) === id);
      return referrer ? (referrer.email || referrer.id) : id;
    }),

    referrals: {
      invited: referred.length,
      activated: referred.filter(u => u.referredBy.activatedAt).length,
      paid: referred.filter(u => u.referredBy.convertedAt).length,
    },

    // Where accounts are stuck right now, so the next thing to fix is a fact
    // rather than a hunch.
    stuck: (() => {
      const counts = {};
      for (const user of users) {
        if (activationOf(state, user.id).paid) continue;
        const a = activationOf(state, user.id);
        const key = !a.imported ? 'never imported'
          : !a.processed ? 'import never finished'
            : !a.clipsMade ? 'no clips came back'
              : !a.approved ? 'clips waiting, none approved'
                : !a.published ? 'approved, never published'
                  : 'activated, not subscribed';
        counts[key] = (counts[key] || 0) + 1;
      }
      return Object.entries(counts).map(([step, n]) => ({ step, users: n })).sort((a, b) => b.users - a.users);
    })(),

    // What the import statuses actually ARE, for the accounts in this funnel.
    //
    // Added because the funnel said "0 processed" while the health endpoint
    // said 6 completed, and the two could not both be right. They were
    // measuring different things -- health looks at 7 days and all accounts,
    // this looks at all time and excludes the operator -- but the only way to
    // tell that from a guess is to show the raw statuses. A funnel stage that
    // cannot be reconciled with the records behind it is not a measurement.
    importStatuses: (() => {
      const ids = new Set(users.map(u => idOf(u.id)));
      const counts = {};
      for (const project of asArray(state.projects)) {
        if (!ids.has(idOf(project.userId))) continue;
        const status = String(project.status || 'unknown');
        counts[status] = (counts[status] || 0) + 1;
      }
      return counts;
    })(),

    // Said in the payload, not only on the screen, so no reader can mistake
    // an absent number for a measured zero.
    unavailable: [
      'Search impressions, queries and average position come from Google Search Console, which this app has no API connection to. They are absent rather than zero.',
      'Renewals are excluded from every count here. Recurring revenue is in Money in.',
      'Visitor rates use daily unique visitors, which are a salted per-day hash — an accurate count of visits, not of people.',
    ],
  };
}
