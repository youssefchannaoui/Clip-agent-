import { config } from './config.js';
import { state } from './store.js';

/**
 * The cash-register bell: every business event, pushed to the owner's phone.
 *
 * A separate ntfy topic from alerts.js on purpose. Alerts are alarms -- rare,
 * high priority, each one demands action. This is a FEED: signups, jobs,
 * sales, posts, and one daily summary. Mixing the two trains the owner to
 * swipe both away, and then the real fire gets swiped with the noise.
 *
 * Everything here is fire-and-forget and inert without ACTIVITY_NTFY_TOPIC:
 * a push that fails or is unconfigured must never touch the request that
 * triggered it.
 */

// A runaway loop posting through this must not carpet-bomb a phone or burn
// ntfy's goodwill. Past the cap, one final "throttled" note, then silence
// until the hour turns.
const HOURLY_CAP = 40;
let windowStart = 0;
let windowCount = 0;

export async function feed(text, tags = 'chart_increasing') {
  const topic = String(config.activityNtfyTopic || '').trim();
  if (!topic) return false;
  const now = Date.now();
  if (now - windowStart > 60 * 60_000) { windowStart = now; windowCount = 0; }
  windowCount += 1;
  if (windowCount > HOURLY_CAP) return false;
  const body = windowCount === HOURLY_CAP
    ? `${text}\n\n(Feed throttled: more than ${HOURLY_CAP} events this hour; the rest are muted until the hour turns.)`
    : text;
  try {
    const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
      method: 'POST',
      headers: { Title: 'DeenClipped', Tags: tags },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function money(minor, currency) {
  const amount = (Number(minor) || 0) / 100;
  return `${String(currency || 'aud').toUpperCase()} ${amount.toFixed(2)}`;
}

function minutes(seconds) {
  const value = Number(seconds) || 0;
  return value >= 60 ? `${Math.round(value / 60)}m` : `${Math.round(value)}s`;
}

// ── The events themselves ────────────────────────────────────────────────
// Each is one line, newest fact first, always naming who. The owner asked for
// exactly this level of detail; it is their own customer data on their own
// channel.

export function signedUp(user, method) {
  return feed(`New signup: ${user?.email || 'unknown'} (via ${method})`, 'tada');
}

export function jobStarted(project, ownerEmail) {
  const length = minutes(project?.sourceDurationSec || project?.durationSec);
  return feed(`Job started: "${(project?.title || 'Untitled').slice(0, 60)}" (${length}) — ${ownerEmail || 'unknown'}`, 'arrow_forward');
}

export function jobFinished(project, ownerEmail, clipCount, tookMs) {
  const took = tookMs ? ` in ${Math.round(tookMs / 60_000)}m` : '';
  return feed(`Job done: "${(project?.title || 'Untitled').slice(0, 60)}" -> ${clipCount} clip(s)${took} — ${ownerEmail || 'unknown'}`, 'white_check_mark');
}

export function jobFailed(project, ownerEmail, reason) {
  return feed(`Job failed: "${(project?.title || 'Untitled').slice(0, 60)}" — ${ownerEmail || 'unknown'} — ${String(reason || '').slice(0, 120)}`, 'x');
}

export function clipPosted(clipTitle, platform, ownerEmail) {
  return feed(`Posted: "${String(clipTitle || 'Clip').slice(0, 60)}" -> ${platform} — ${ownerEmail || 'unknown'}`, 'outbox_tray');
}

export function revenue(kind, user, amountMinor, currency, description) {
  const label = kind === 'topup' ? 'Tokens sold' : kind === 'invoice' ? 'Renewal paid' : 'Payment';
  return feed(`${label}: ${money(amountMinor, currency)} — ${user?.email || 'unknown'} (${String(description || '').slice(0, 60)})`, 'moneybag');
}

export function subscriptionStarted(user, plan) {
  return feed(`New subscriber: ${user?.email || 'unknown'} on ${plan || 'a plan'}`, 'star');
}

export function subscriptionEnded(user) {
  return feed(`Subscription cancelled: ${user?.email || 'unknown'}`, 'wave');
}

export function paymentFailed(user) {
  return feed(`Customer payment FAILED: ${user?.email || 'unknown'} — Stripe will retry; if it keeps failing their plan lapses.`, 'warning');
}

// ── The daily pulse ──────────────────────────────────────────────────────

/** Pure composition over state, so tests can call it with a fixed "now". */
export function composePulse(now = Date.now()) {
  const dayAgo = now - 24 * 60 * 60_000;
  const weekAhead = now + 7 * 24 * 60 * 60_000;

  const users = state.authUsers || [];
  const projects = state.projects || [];
  const clips = state.clips || [];

  const newUsers = users.filter(user => Number(user.createdAt || 0) > dayAgo);
  const jobs = projects.filter(project => Number(project.submittedAt || 0) > dayAgo);
  const done = jobs.filter(project => project.status === 'done');
  const failed = jobs.filter(project => project.status === 'failed');
  const madeClips = clips.filter(clip => Number(clip.createdAt || 0) > dayAgo);
  const posted = clips.filter(clip => clip.postedAt && Number(new Date(clip.postedAt).getTime() || 0) > dayAgo);
  const awaiting = clips.filter(clip => clip.status === 'waiting').length;

  const revenueEvents = (state.revenueEvents || []).filter(entry => Number(entry.createdAt || 0) > dayAgo);
  const takeMinor = revenueEvents.reduce((sum, entry) => sum + (Number(entry.amountMinor) || 0), 0);
  // Paying customers only: the admin account's own always-active plan is not a
  // subscriber, and counting it inflated the number by one forever.
  const activeSubs = users.filter(user => user.billing?.plan !== 'admin'
    && ['active', 'trialing', 'checkout_complete'].includes(user.billing?.status)).length;

  // The operator's own outgoings, from the Owner tab's cost ledger. Renewals
  // inside a week are exactly the "subscriptions coming up" ask.
  const dueSoon = (state.ownerCosts || [])
    .filter(cost => cost.active !== false && Number(cost.nextDueAt || 0) > now && Number(cost.nextDueAt) < weekAhead)
    .map(cost => `  - ${cost.name}: ${money(cost.amountMinor, cost.currency)} due ${new Date(Number(cost.nextDueAt)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: config.timezone || 'Australia/Perth' })}`);

  const lines = [
    `Last 24h: ${newUsers.length} signup(s), ${jobs.length} job(s) (${done.length} done, ${failed.length} failed), ${madeClips.length} clip(s) made, ${posted.length} posted.`,
    `Money: ${money(takeMinor, revenueEvents[0]?.currency)} taken, ${activeSubs} active subscriber(s).`,
    `Review queue: ${awaiting} clip(s) waiting for approval.`,
  ];
  if (dueSoon.length) lines.push(`Your bills due within 7 days:\n${dueSoon.join('\n')}`);
  return lines.join('\n');
}

let pulseTimer = null;
let lastPulseDay = '';

export function start() {
  if (!String(config.activityNtfyTopic || '').trim()) return;
  const tick = () => {
    const zone = config.timezone || 'Australia/Perth';
    const parts = new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: 'numeric', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value || '';
    const day = `${get('year')}-${get('month')}-${get('day')}`;
    // Fires in the 8am hour, once per calendar day in the owner's zone.
    if (Number(get('hour')) === 8 && day !== lastPulseDay) {
      lastPulseDay = day;
      feed(`Daily pulse\n${composePulse()}`, 'sunrise').catch(() => {});
    }
  };
  pulseTimer = setInterval(tick, 10 * 60_000);
  pulseTimer.unref?.();
  tick();
}

export function stop() { if (pulseTimer) clearInterval(pulseTimer); pulseTimer = null; }

/** Tests only. */
export function reset() { windowStart = 0; windowCount = 0; lastPulseDay = ''; }
