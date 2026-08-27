/**
 * The owner's books.
 *
 * Two halves, and they come from different places for a reason worth writing
 * down, because it is the whole shape of this module:
 *
 * MONEY IN is Stripe's to answer. The app never recorded a currency amount --
 * `invoice.paid` arrived and only the fact of it was kept -- so there is no
 * local history to total. Stripe's balance transactions are also the only
 * source that knows the *fee*, and revenue before fees is a number that
 * flatters and misleads. `recordRevenue` in billing.js now accrues amounts
 * locally as webhooks arrive, which gives this page something to show when
 * Stripe is unreachable, but Stripe stays the authority for anything historic.
 *
 * MONEY OUT cannot be derived at all. Nothing in the codebase knows what
 * Render or Hetzner or R2 charge. So it is an owner-maintained ledger, seeded
 * with the infrastructure this repo demonstrably runs on -- and seeded with no
 * amounts, because inventing a plausible hosting bill would produce a profit
 * figure that looks authoritative and is fiction. Entries that still need a
 * number say so, everywhere they are totalled.
 *
 * Every amount in here is an integer in the currency's minor unit, exactly as
 * Stripe sends it. Never a float: 17.99 + 6.99 in binary floating point is not
 * 24.98, and a money total that is wrong in the last cent is one nobody
 * trusts twice.
 */

import { state, save, log } from './store.js';
import { config } from './config.js';
import * as billing from './billing.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = () => Date.now();

export const CADENCES = Object.freeze(['weekly', 'monthly', 'quarterly', 'yearly', 'once']);
export const COST_CATEGORIES = Object.freeze(['hosting', 'storage', 'domain', 'ai', 'tooling', 'marketing', 'other']);

function requireOperator(user) {
  if (!user || !['owner', 'admin'].includes(String(user.role || '').toLowerCase())) {
    // 404 rather than 403, matching the rest of the product: an operator-only
    // surface should be indistinguishable from one that does not exist.
    throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  }
  return user;
}

/**
 * What this deployment is demonstrably running on, seeded once.
 *
 * Amounts are deliberately absent. Everything here is verifiable from the
 * repo -- the Render service and its disk from render.yaml, the worker box
 * from CLAUDE.md's deploy note, the bucket from the rotation runbook, the
 * domain from the public base URL -- but none of those files record a price,
 * and a seeded guess would be indistinguishable from a real figure once it is
 * sitting in a total.
 */
const SEED_COSTS = [
  { name: 'Render — web service', vendor: 'Render', category: 'hosting', cadence: 'monthly',
    notes: 'deenclipped-ai, starter plan, Oregon, plus a 10GB disk.' },
  { name: 'Hetzner — render worker', vendor: 'Hetzner', category: 'hosting', cadence: 'monthly',
    notes: 'The box at 135.181.149.182 that runs the ffmpeg worker and self-hosted Ollama.' },
  { name: 'Cloudflare R2 — media storage', vendor: 'Cloudflare', category: 'storage', cadence: 'monthly',
    notes: 'Bucket deenclipped-media-us. Usage-based, so this is an average rather than a fixed bill.' },
  { name: 'Domain — deenclipped.online', vendor: 'Registrar', category: 'domain', cadence: 'yearly',
    notes: 'Renewal. Set the due date to the actual renewal date.' },
];

function ensureCostState() {
  if (!Array.isArray(state.ownerCosts)) {
    state.ownerCosts = SEED_COSTS.map((seed, index) => ({
      id: `cost_seed_${index + 1}`,
      ...seed,
      amountMinor: 0,
      currency: defaultCurrency(),
      nextDueAt: null,
      active: true,
      createdAt: now(),
      updatedAt: now(),
    }));
    state.ownerCostsSeededAt = now();
    save();
    log('Owner cost ledger seeded with this deployment\'s infrastructure. Amounts need setting.', 'info');
  }
  return state.ownerCosts;
}

/**
 * The currency to default new entries to.
 *
 * Taken from the configured plan price labels rather than hardcoded: those read
 * `A$9` on this deployment, so the owner thinks in AUD and a ledger that
 * defaulted to USD would quietly mix two currencies into one total.
 */
function defaultCurrency() {
  const label = String(config.planPriceMonthlyLabel || '');
  if (/A\$/i.test(label)) return 'aud';
  if (/^\s*£/.test(label)) return 'gbp';
  if (/^\s*€/.test(label)) return 'eur';
  if (/^\s*\$/.test(label)) return 'usd';
  return 'aud';
}

/** Per-month equivalent of a recurring cost, so unlike cadences can be compared. */
function monthlyMinor(entry) {
  const amount = Math.round(Number(entry?.amountMinor) || 0);
  if (!amount || entry?.active === false) return 0;
  switch (String(entry.cadence || 'monthly')) {
    // 52/12, not 4: four-week months lose a payment a year, which is the
    // classic way a burn figure comes out under the real one.
    case 'weekly': return Math.round(amount * 52 / 12);
    case 'monthly': return amount;
    case 'quarterly': return Math.round(amount / 3);
    case 'yearly': return Math.round(amount / 12);
    // A one-off is a real payment but not a run rate, so it counts in the
    // upcoming list and never in the monthly burn.
    case 'once': return 0;
    default: return amount;
  }
}

function cadenceStepMs(cadence) {
  switch (String(cadence || 'monthly')) {
    case 'weekly': return 7 * DAY_MS;
    case 'quarterly': return 91 * DAY_MS;
    case 'yearly': return 365 * DAY_MS;
    case 'once': return 0;
    default: return 30 * DAY_MS;
  }
}

/**
 * The next time this entry is actually due.
 *
 * Rolls a stale date forward instead of reporting a payment that was due three
 * months ago: a due date nobody updated is the normal state of a ledger, and
 * showing "overdue since May" for a subscription that has been quietly
 * charging monthly is noise that trains you to ignore the page.
 */
function nextDue(entry, from = now()) {
  const due = Number(entry?.nextDueAt || 0);
  if (!due) return null;
  const step = cadenceStepMs(entry.cadence);
  if (!step) return due;
  let next = due;
  let guard = 0;
  while (next < from && guard < 500) { next += step; guard += 1; }
  return next;
}

export function costs(user) {
  requireOperator(user);
  const ledger = ensureCostState();
  return ledger.map(entry => ({
    ...entry,
    monthlyMinor: monthlyMinor(entry),
    nextDueAt: nextDue(entry),
    needsAmount: !Math.round(Number(entry.amountMinor) || 0),
    needsDueDate: !Number(entry.nextDueAt || 0) && entry.active !== false,
  }));
}

export function upsertCost(user, patch = {}) {
  requireOperator(user);
  const ledger = ensureCostState();
  const name = String(patch.name || '').trim().slice(0, 120);
  if (!name) throw Object.assign(new Error('A cost needs a name.'), { statusCode: 400 });

  const cadence = CADENCES.includes(String(patch.cadence)) ? String(patch.cadence) : 'monthly';
  const category = COST_CATEGORIES.includes(String(patch.category)) ? String(patch.category) : 'other';
  // Accepts a decimal from the form and stores minor units. Math.round on the
  // way in, so 19.99 cannot arrive as 1998.9999999999998 cents.
  const amountMinor = Math.max(0, Math.round(Number(patch.amountMinor ?? (Number(patch.amount || 0) * 100)) || 0));
  const currency = String(patch.currency || defaultCurrency()).toLowerCase().slice(0, 3);
  const nextDueAt = Number(patch.nextDueAt || 0) > 0 ? Math.round(Number(patch.nextDueAt)) : null;
  const notes = String(patch.notes || '').slice(0, 500);
  const vendor = String(patch.vendor || '').trim().slice(0, 120);

  const existing = patch.id ? ledger.find(item => item.id === String(patch.id)) : null;
  if (patch.id && !existing) throw Object.assign(new Error('That cost no longer exists.'), { statusCode: 404 });

  if (existing) {
    Object.assign(existing, {
      name, vendor, category, cadence, amountMinor, currency, nextDueAt, notes,
      active: patch.active !== false,
      updatedAt: now(),
    });
    save();
    log(`Owner cost updated: ${name}.`, 'info', user.id);
    return existing;
  }

  const entry = {
    id: `cost_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    name, vendor, category, cadence, amountMinor, currency, nextDueAt, notes,
    active: patch.active !== false,
    createdAt: now(), updatedAt: now(),
  };
  ledger.push(entry);
  save();
  log(`Owner cost added: ${name}.`, 'info', user.id);
  return entry;
}

export function removeCost(user, id) {
  requireOperator(user);
  const ledger = ensureCostState();
  const index = ledger.findIndex(item => item.id === String(id));
  if (index === -1) throw Object.assign(new Error('That cost no longer exists.'), { statusCode: 404 });
  const [removed] = ledger.splice(index, 1);
  save();
  log(`Owner cost removed: ${removed.name}.`, 'info', user.id);
  return removed;
}

/**
 * One-off spend, as distinct from a subscription.
 *
 * The ledger models things that recur on a cadence. It cannot model an
 * Anthropic credit top-up that happens twelve times one month and four the
 * next -- averaging those into a monthly figure throws away the only data
 * that would tell you the trend, and quietly turns a variable cost into a
 * fixed one on the page.
 *
 * `externalId` is the important field. It is the receipt number, or the id of
 * the mail the charge was read from, and a second write carrying an id already
 * present is dropped. That is what makes an automated feed safe to re-run:
 * the Stripe side already learned this lesson, where two event types for one
 * invoice would have doubled the revenue.
 */
export function recordSpend(user, entry = {}) {
  requireOperator(user);
  if (!Array.isArray(state.ownerSpend)) state.ownerSpend = [];

  const name = String(entry.name || '').trim().slice(0, 160);
  if (!name) throw Object.assign(new Error('A payment needs a name.'), { statusCode: 400 });
  const amountMinor = Math.max(0, Math.round(Number(entry.amountMinor ?? (Number(entry.amount || 0) * 100)) || 0));
  if (!amountMinor) throw Object.assign(new Error('A payment needs an amount.'), { statusCode: 400 });

  const externalId = String(entry.externalId || '').slice(0, 200);
  if (externalId && state.ownerSpend.some(item => item?.externalId === externalId)) {
    return { duplicate: true, externalId };
  }

  const record = {
    id: `spend_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    name,
    vendor: String(entry.vendor || '').trim().slice(0, 120),
    category: COST_CATEGORIES.includes(String(entry.category)) ? String(entry.category) : 'other',
    amountMinor,
    currency: String(entry.currency || defaultCurrency()).toLowerCase().slice(0, 3),
    paidAt: Number(entry.paidAt || 0) > 0 ? Math.round(Number(entry.paidAt)) : now(),
    // Where the figure came from, so a number nobody recognises can be traced
    // back to a receipt rather than argued about.
    source: String(entry.source || 'manual').slice(0, 40),
    externalId,
    notes: String(entry.notes || '').slice(0, 500),
    createdAt: now(),
  };
  state.ownerSpend.unshift(record);
  state.ownerSpend = state.ownerSpend.slice(0, 5000);
  save();
  return record;
}

export function removeSpend(user, id) {
  requireOperator(user);
  if (!Array.isArray(state.ownerSpend)) state.ownerSpend = [];
  const index = state.ownerSpend.findIndex(item => item.id === String(id));
  if (index === -1) throw Object.assign(new Error('That payment no longer exists.'), { statusCode: 404 });
  const [removed] = state.ownerSpend.splice(index, 1);
  save();
  log(`Owner payment removed: ${removed.name}.`, 'info', user.id);
  return removed;
}

export function spend(user, { days = 90 } = {}) {
  requireOperator(user);
  const since = now() - days * DAY_MS;
  const rows = (Array.isArray(state.ownerSpend) ? state.ownerSpend : [])
    .filter(item => Number(item.paidAt || 0) >= since)
    .sort((a, b) => b.paidAt - a.paidAt);
  const totalMinor = rows.reduce((sum, item) => sum + item.amountMinor, 0);
  const byVendor = {};
  for (const item of rows) {
    const key = item.vendor || item.name;
    byVendor[key] = (byVendor[key] || 0) + item.amountMinor;
  }
  /**
   * Averaged over the period the data actually covers, not the window asked for.
   *
   * Dividing by a 90-day window when the first payment landed 27 days ago
   * reports a third of the real rate -- and it does it most severely the day
   * you start recording, which is exactly when someone is looking at the page
   * deciding whether to trust it. Measured from the earliest payment in the
   * window to now, floored at a week so a single charge on day one cannot
   * extrapolate to a fortune.
   */
  const earliest = rows.length ? Math.min(...rows.map(item => Number(item.paidAt) || now())) : now();
  const coveredDays = Math.max(7, Math.min(days, Math.round((now() - earliest) / DAY_MS) || 1));

  return {
    days, rows, totalMinor, byVendor,
    coveredDays,
    // A per-month figure derived from what was actually paid, rather than a
    // number somebody guessed once and never revisited.
    monthlyAverageMinor: rows.length ? Math.round(totalMinor / coveredDays * 30) : 0,
  };
}

/**
 * Money in, from Stripe.
 *
 * Balance transactions rather than charges, because they are the only place
 * that carries the fee. Gross tells you what customers paid; net is what you
 * can actually spend, and the gap between them is a real cost that never
 * appears on any invoice you receive.
 */
async function stripeRevenue({ days = 180 } = {}) {
  if (!billing.stripeConfigured()) {
    return { available: false, reason: 'No Stripe key is configured on this deployment.' };
  }
  const since = Math.floor((now() - days * DAY_MS) / 1000);
  const rows = [];
  let starting_after = '';
  // Paginate, but with a hard stop: an owner page must not hang on a busy
  // account, and 10 pages of 100 is plenty for a half-year view.
  for (let page = 0; page < 10; page += 1) {
    const payload = await billing.stripeGet('/balance_transactions', {
      limit: 100, 'created[gte]': since, ...(starting_after ? { starting_after } : {}),
    });
    const data = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...data);
    if (!payload?.has_more || !data.length) break;
    starting_after = data[data.length - 1].id;
  }
  return { available: true, rows };
}

/** Active subscriptions, for a run rate that does not depend on last month happening again. */
async function stripeRecurring() {
  if (!billing.stripeConfigured()) return { available: false, mrrMinor: 0, currency: '', counts: {} };
  const payload = await billing.stripeGet('/subscriptions', { limit: 100, status: 'active' });
  const subs = Array.isArray(payload?.data) ? payload.data : [];
  let mrrMinor = 0;
  let currency = '';
  const counts = {};
  for (const sub of subs) {
    for (const item of sub.items?.data || []) {
      const price = item.price || {};
      const unit = Math.round(Number(price.unit_amount) || 0) * Math.max(1, Number(item.quantity) || 1);
      const interval = String(price.recurring?.interval || 'month');
      const count = Math.max(1, Number(price.recurring?.interval_count) || 1);
      currency = currency || String(price.currency || '').toLowerCase();
      // Normalised to a month so weekly, monthly and yearly plans can sit in
      // one figure. A yearly plan is a twelfth of its price per month, not a
      // spike in whichever month it renewed.
      if (interval === 'day') mrrMinor += Math.round(unit * 30 / count);
      else if (interval === 'week') mrrMinor += Math.round(unit * 52 / 12 / count);
      else if (interval === 'month') mrrMinor += Math.round(unit / count);
      else if (interval === 'year') mrrMinor += Math.round(unit / (12 * count));
      const label = price.nickname || price.id || 'plan';
      counts[label] = (counts[label] || 0) + 1;
    }
  }
  return { available: true, mrrMinor, currency, counts, subscriptions: subs.length };
}

function monthKey(ms) {
  const d = new Date(Number(ms) || 0);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 7) : '';
}

/**
 * The whole picture: in, out, and what is left.
 *
 * Never throws on Stripe being down or unconfigured -- it degrades to the
 * locally recorded revenue and says so. A finance page that 500s because a
 * third party is slow is a page you cannot use on the morning you need it.
 */
export async function finance(user, { days = 180 } = {}) {
  requireOperator(user);

  let revenue = { available: false, reason: 'Stripe was not read.' };
  let recurring = { available: false, mrrMinor: 0, currency: '', counts: {} };
  const problems = [];
  try { revenue = await stripeRevenue({ days }); }
  catch (error) { problems.push(`Stripe revenue: ${error.message}`); revenue = { available: false, reason: error.message }; }
  try { recurring = await stripeRecurring(); }
  catch (error) { problems.push(`Stripe subscriptions: ${error.message}`); }

  const localEvents = Array.isArray(state.revenueEvents) ? state.revenueEvents : [];
  const currency = (revenue.rows?.[0]?.currency || recurring.currency || localEvents[0]?.currency || defaultCurrency()).toLowerCase();

  // ── money in ──────────────────────────────────────────────────────────────
  const byMonth = new Map();
  const touchMonth = key => {
    if (!byMonth.has(key)) byMonth.set(key, { month: key, grossMinor: 0, feeMinor: 0, netMinor: 0, refundMinor: 0, payouts: 0, count: 0 });
    return byMonth.get(key);
  };
  for (let offset = 5; offset >= 0; offset -= 1) {
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - offset);
    touchMonth(d.toISOString().slice(0, 7));
  }

  let grossMinor = 0; let feeMinor = 0; let netMinor = 0; let refundMinor = 0;
  if (revenue.available) {
    for (const row of revenue.rows || []) {
      const created = Number(row.created || 0) * 1000;
      const bucket = touchMonth(monthKey(created));
      const amount = Math.round(Number(row.amount) || 0);
      const fee = Math.round(Number(row.fee) || 0);
      const type = String(row.type || '');
      // Payouts move money to the bank; they are not revenue and counting them
      // would double every dollar that came in.
      if (type === 'payout' || type === 'transfer') { bucket.payouts += 1; continue; }
      if (type === 'refund' || amount < 0) {
        refundMinor += Math.abs(amount);
        bucket.refundMinor += Math.abs(amount);
        bucket.netMinor += amount;
        netMinor += amount;
        continue;
      }
      grossMinor += amount; feeMinor += fee; netMinor += amount - fee;
      bucket.grossMinor += amount; bucket.feeMinor += fee; bucket.netMinor += amount - fee;
      bucket.count += 1;
    }
  } else {
    // Degraded path: local records carry no fee, so net equals gross and the
    // page must not pretend otherwise.
    for (const event of localEvents) {
      const bucket = touchMonth(monthKey(event.createdAt));
      const amount = Math.round(Number(event.amountMinor) || 0);
      grossMinor += amount; netMinor += amount;
      bucket.grossMinor += amount; bucket.netMinor += amount; bucket.count += 1;
    }
  }

  // ── money out ─────────────────────────────────────────────────────────────
  const ledger = costs(user);
  const activeLedger = ledger.filter(entry => entry.active !== false);
  const burnMinor = activeLedger.reduce((sum, entry) => sum + entry.monthlyMinor, 0);
  const unpriced = activeLedger.filter(entry => entry.needsAmount);

  /**
   * Adding US dollars to Australian dollars produces a number, and the number
   * is wrong. Nothing here converts -- an FX rate fetched at render time would
   * make yesterday's burn disagree with today's for no reason a reader could
   * see -- so costs are expected to be entered in one currency, and the page
   * says so loudly when they are not.
   */
  const byCurrency = {};
  for (const entry of activeLedger) {
    if (!entry.monthlyMinor) continue;
    const code = String(entry.currency || currency).toLowerCase();
    byCurrency[code] = (byCurrency[code] || 0) + entry.monthlyMinor;
  }
  const currencies = Object.keys(byCurrency);
  const mixedCurrency = currencies.length > 1
    ? `Costs are recorded in ${currencies.map(code => code.toUpperCase()).join(' and ')}. `
      + 'The burn and profit totals add them together without converting, so they are not meaningful until every cost uses one currency.'
    : '';

  // Everything that leaves the account in a month: the subscriptions, plus what
  // the variable charges have actually averaged.
  const oneOffLog = spend(user, { days: 90 });
  const totalOutMinor = burnMinor + oneOffLog.monthlyAverageMinor;

  const horizon = now() + 60 * DAY_MS;
  const upcoming = activeLedger
    .filter(entry => entry.nextDueAt && entry.nextDueAt <= horizon)
    .map(entry => ({
      id: entry.id, name: entry.name, vendor: entry.vendor, category: entry.category,
      amountMinor: entry.amountMinor, currency: entry.currency, cadence: entry.cadence,
      dueAt: entry.nextDueAt,
      daysAway: Math.round((entry.nextDueAt - now()) / DAY_MS),
      needsAmount: entry.needsAmount,
    }))
    .sort((a, b) => a.dueAt - b.dueAt);

  const months = [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-6);
  const thisMonth = months[months.length - 1] || { grossMinor: 0, netMinor: 0, feeMinor: 0 };

  return {
    generatedAt: now(),
    currency,
    stripe: {
      configured: billing.stripeConfigured(),
      revenueAvailable: Boolean(revenue.available),
      revenueReason: revenue.available ? '' : (revenue.reason || ''),
      // Named plainly: a sandbox figure must never be mistaken for real money.
      // Three states, not two: "test" on a deployment with no key at all told
      // the operator their sandbox was reporting, when nothing was.
      mode: !config.stripeSecretKey ? 'none'
        : String(config.stripeSecretKey).startsWith('sk_live') ? 'live' : 'test',
      problems,
    },
    moneyIn: {
      grossMinor, feeMinor, netMinor, refundMinor,
      thisMonthGrossMinor: thisMonth.grossMinor,
      thisMonthNetMinor: thisMonth.netMinor,
      mrrMinor: recurring.mrrMinor || 0,
      arrMinor: (recurring.mrrMinor || 0) * 12,
      activeSubscriptions: recurring.subscriptions || 0,
      planCounts: recurring.counts || {},
      windowDays: days,
      source: revenue.available ? 'stripe' : 'local',
      localEventCount: localEvents.length,
    },
    moneyOut: {
      monthlyBurnMinor: burnMinor,
      yearlyBurnMinor: burnMinor * 12,
      entries: activeLedger.length,
      unpricedCount: unpriced.length,
      unpricedNames: unpriced.map(entry => entry.name),
      byCurrency,
      mixedCurrency,
      // Variable spend is reported beside the subscriptions, never folded into
      // them: a top-up that happened twelve times last month is not a fixture.
      oneOff: oneOffLog,
      // What actually leaves the account each month, and what profit uses.
      totalMonthlyOutMinor: totalOutMinor,
      byCategory: activeLedger.reduce((acc, entry) => {
        acc[entry.category] = (acc[entry.category] || 0) + entry.monthlyMinor;
        return acc;
      }, {}),
      dueNext60Days: upcoming,
      dueNext60DaysTotalMinor: upcoming.reduce((sum, item) => sum + item.amountMinor, 0),
    },
    // Net, not gross, minus BOTH kinds of outgoing. Anything else overstates
    // what the business keeps -- the Stripe fee is the part that is easiest to
    // forget, and variable spend is the part that is easiest to file somewhere
    // that never reaches the profit line. Subscriptions alone would have hidden
    // the largest single cost this deployment has.
    profit: {
      monthlyNetMinor: thisMonth.netMinor - totalOutMinor,
      marginPercent: thisMonth.netMinor ? Math.round(((thisMonth.netMinor - totalOutMinor) / thisMonth.netMinor) * 1000) / 10 : null,
      // Stated so the number is never read as more certain than it is.
      completeness: [
        unpriced.length
          ? `${unpriced.length} cost${unpriced.length === 1 ? '' : 's'} still have no amount, so burn is understated.`
          : '',
        mixedCurrency,
      ].filter(Boolean).join(' '),
    },
    months,
    costs: ledger,
    recentRevenue: localEvents.slice(0, 40),
  };
}

/**
 * What has actually been going wrong, counted.
 *
 * Failures were recorded per project and never added up, so the only way to
 * learn a job had failed was for someone to hit it. That is the whole reason
 * bugs here feel random rather than merely present: nothing was watching, so
 * every one arrived as a surprise, and a fault affecting every import for two
 * days looked exactly like a fault affecting one person once.
 *
 * Grouped by `errorCode` rather than by message, because messages carry ids,
 * byte counts and provider prose and no two are ever equal -- a hundred
 * instances of one bug would list as a hundred separate lines.
 */
export function pipelineHealth(user, { days = 7, limit = 25 } = {}) {
  requireOperator(user);
  const span = Math.max(1, Math.min(90, Math.round(Number(days) || 7)));
  const since = now() - span * DAY_MS;
  const projects = (state.projects || []).filter(p => Number(p.updatedAt || p.createdAt || 0) >= since);

  const byStatus = {};
  const byCode = new Map();
  const byProvider = {};
  const failures = [];

  for (const project of projects) {
    const raw = String(project.status || 'unknown');
    // The engine finishes a lecture as 'done'; this census once counted only
    // 'completed', so every success was invisible -- the failure rate pinned
    // at 100% and the importer table said "no completed imports" while
    // imports completed daily. The owner read his own dashboard and despaired.
    const status = raw === 'done' ? 'completed' : raw;
    byStatus[status] = (byStatus[status] || 0) + 1;

    // Only successes say anything about which provider is carrying the load.
    // Counting failures here would credit a provider for the job it lost.
    if (status === 'completed') {
      const provider = String(project.importProvider || 'unknown');
      byProvider[provider] = (byProvider[provider] || 0) + 1;
    }

    if (status !== 'failed') continue;
    const code = String(project.errorCode || 'unclassified');
    const seen = byCode.get(code) || { code, count: 0, lastAt: 0, sample: '' };
    seen.count += 1;
    const at = Number(project.updatedAt || project.createdAt || 0);
    if (at >= seen.lastAt) {
      seen.lastAt = at;
      seen.sample = String(project.error || '').slice(0, 240);
    }
    byCode.set(code, seen);
    failures.push({
      id: String(project.id || ''),
      title: String(project.title || '').slice(0, 120),
      code,
      error: String(project.error || '').slice(0, 240),
      at,
      importProvider: project.importProvider || null,
    });
  }

  failures.sort((a, b) => b.at - a.at);
  const finished = (byStatus.completed || 0) + (byStatus.failed || 0);

  return {
    days: span,
    totals: {
      projects: projects.length,
      completed: byStatus.completed || 0,
      failed: byStatus.failed || 0,
      // Of jobs that reached an ending. Counting the queued and the running as
      // successes would read as a healthy rate every time the queue was busy.
      failureRate: finished ? Math.round(((byStatus.failed || 0) / finished) * 100) : 0,
    },
    byStatus,
    topFailures: [...byCode.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt),
    importProviders: byProvider,
    recent: failures.slice(0, Math.max(1, Math.min(100, Math.round(Number(limit) || 25)))),
  };
}
