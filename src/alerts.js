import { config } from './config.js';
import * as mailer from './mailer.js';
import { log } from './store.js';

/**
 * Tell the operator when something is broken.
 *
 * Nothing did. The worker could be unreachable, backups could be failing every
 * four hours, and the only trace was a line in an activity feed nobody is
 * watching at 3am. The first report came from a customer, if it came at all.
 *
 * Deliberately narrow: only conditions that need a person, and only the
 * transition into and out of them. A condition that stays broken sends one
 * mail, not one per check -- an alert that arrives every four hours is an
 * alert that gets filtered, and then the real one is filtered too.
 */

// Re-send a still-broken condition at most this often, so a long outage does
// not go silent forever but never becomes noise either.
const REMINDER_MS = 12 * 60 * 60_000;

const open = new Map();

export function recipients() {
  return (config.operatorEmails || []).filter(Boolean);
}

export function active() {
  return [...open.entries()].map(([key, value]) => ({ key, since: value.since, detail: value.detail }));
}

// Push, no account required: ntfy.sh turns any topic string into a channel a
// phone can subscribe to. This exists because the email path below needs a
// provider key the deployment never had, so every alert was silently unsent.
async function pushNtfy(subject, body) {
  if (!config.alertNtfyTopic) return false;
  try {
    const response = await fetch(`https://ntfy.sh/${encodeURIComponent(config.alertNtfyTopic)}`, {
      method: 'POST',
      headers: { Title: subject, Priority: 'high', Tags: 'rotating_light' },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function notify(subject, body) {
  let sent = await pushNtfy(subject, body);
  if (mailer.configured()) {
    for (const address of recipients()) {
      const ok = await mailer.send({
        to: address,
        subject,
        text: body,
        html: `<p style="font:14px/1.6 -apple-system,Segoe UI,sans-serif">${body.replace(/\n/g, '<br>')}</p>`,
      });
      sent = sent || ok;
    }
  }
  return sent;
}

/**
 * Report the state of one condition. Called on every check, not just failures:
 * knowing something recovered is half the value, and it is what lets the next
 * failure alert at all.
 */
export async function report(key, failing, detail = '') {
  const existing = open.get(key);

  if (!failing) {
    if (!existing) return;
    open.delete(key);
    const minutes = Math.round((Date.now() - existing.since) / 60_000);
    log(`Recovered: ${key} (was failing for ${minutes} minute(s))`, 'info');
    await notify(`DeenClipped recovered: ${key}`,
      `${key} is working again.\n\nIt was failing for ${minutes} minute(s).\nLast error: ${existing.detail}`);
    return;
  }

  if (!existing) {
    open.set(key, { since: Date.now(), detail, lastSent: Date.now() });
    log(`ALERT: ${key} -- ${detail}`, 'error');
    const sent = await notify(`DeenClipped problem: ${key}`,
      `${key} is failing.\n\n${detail}\n\nThis is the first notice. You will get one more only if it is still failing in 12 hours, and one when it recovers.`);
    if (!sent) log(`No alert email was sent for ${key}: email is not configured (EMAIL_API_KEY / EMAIL_FROM).`, 'warn');
    return;
  }

  existing.detail = detail;
  if (Date.now() - existing.lastSent < REMINDER_MS) return;
  existing.lastSent = Date.now();
  const hours = Math.round((Date.now() - existing.since) / 3_600_000);
  await notify(`DeenClipped still failing: ${key}`,
    `${key} has been failing for about ${hours} hour(s).\n\n${detail}`);
}

// One failed lecture is a customer problem; a cluster of them is an outage.
// Cancellations and the app's own auto-retries never reach here -- only jobs
// that ended failed for the customer.
const JOB_FAILURE_WINDOW_MS = 60 * 60_000;
const JOB_FAILURE_THRESHOLD = 3;
const recentJobFailures = [];

export async function jobFailed(title, reason) {
  const now = Date.now();
  recentJobFailures.push(now);
  while (recentJobFailures.length && recentJobFailures[0] < now - JOB_FAILURE_WINDOW_MS) recentJobFailures.shift();
  if (recentJobFailures.length < JOB_FAILURE_THRESHOLD) return;
  await report('jobs', true,
    `${recentJobFailures.length} lectures have failed in the last hour.\n` +
    `Latest: "${title}" -- ${String(reason || '').slice(0, 300)}`);
}

export async function jobSucceeded() {
  // A success both proves the pipeline works and closes an open failure alert.
  recentJobFailures.length = 0;
  await report('jobs', false);
}

/** Tests only. */
export function reset() { open.clear(); recentJobFailures.length = 0; }
