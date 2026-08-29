import { config } from './config.js';
import * as mailer from './mailer.js';
import { log, state, save } from './store.js';

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

/**
 * The open conditions, PERSISTED.
 *
 * This was an in-memory Map, and that quietly broke the promise the first
 * notice makes. Render restarts the service on every deploy, so the map came
 * back empty and the next failing check read as a brand new condition: another
 * "this is the first notice" mail, every deploy, for a condition that had never
 * stopped failing. Eight deploys in a day turned one broken webhook secret into
 * a mailbox full of first notices -- which is exactly how an alert channel
 * becomes one nobody reads, and then the real one is missed too.
 *
 * It lives in state now, so `since` and `lastSent` survive a restart and 12
 * hours means 12 hours.
 */
function ledger() {
  if (!state.alertsOpen || typeof state.alertsOpen !== 'object') state.alertsOpen = {};
  return state.alertsOpen;
}

const open = {
  get(key) {
    const row = ledger()[key];
    return row && typeof row === 'object' ? row : undefined;
  },
  set(key, value) {
    ledger()[key] = value;
    save();
  },
  delete(key) {
    if (!(key in ledger())) return;
    delete ledger()[key];
    save();
  },
  entries() {
    return Object.entries(ledger());
  },
  clear() {
    state.alertsOpen = {};
    save();
  },
};

// A row read back from state is a plain object, so a mutation to it is only
// remembered if something saves. Every path that touches one goes through here.
function touch(key, row) {
  ledger()[key] = row;
  save();
}

// Every alarm carries its own repair manual. The owner reads these on a phone
// at an inconvenient hour, so each is the exact next action, not a diagnosis
// -- and ordered so the first step is the one that most often fixes it.
const PLAYBOOK = {
  worker: [
    'Open the Hetzner console (console.hetzner.cloud) and check the server is running; reboot it from there if it is frozen.',
    'If the box is up, SSH in and run: cd /opt/deenclipped && docker compose -f worker/docker-compose.yml up -d',
    'Still down? docker logs worker-deenclipped-worker-1 --tail 50 shows why it will not start.',
    'Customers can keep working: uploads and the dashboard are unaffected; only processing waits.',
  ],
  jobs: [
    'Open the Owner tab -> Health to see which step is failing and for whom.',
    'If the failures are imports: the proxy pool may be thin -- check the latest pool message on this channel, and replace burned addresses at dashboard.webshare.io.',
    'Press Retry on one failed lecture and watch it: one shared cause usually explains all of them.',
    'If nothing obvious, screenshot the Health tab and ask Claude to dig in.',
  ],
  billing: [
    'A customer may have paid without their tokens landing. Stripe keeps the money; the app never heard about it.',
    'Open dashboard.stripe.com -> Developers -> Webhooks -> deenclipped-billing -> Event deliveries and look for 400 responses.',
    'The usual cause is STRIPE_WEBHOOK_SECRET on Render not matching the signing secret on that page. Copy it again and redeploy.',
    'Stripe retries for about three days, so fixing the secret inside that window delivers the missed events by itself -- nothing is lost.',
    'If a delivery is already past retrying, resend it by hand from the same Event deliveries page.',
  ],
  backups: [
    'Check Cloudflare R2 (dash.cloudflare.com -> R2) is reachable and the bucket still exists.',
    'The last good backup is still safe -- this alert means NEW copies are failing, not that data is lost.',
    'If R2 looks fine, ask Claude to run a manual backup and read the error.',
  ],
};

function withPlaybook(key, body) {
  const steps = PLAYBOOK[key];
  if (!steps) return body;
  return `${body}\n\nWhat to do:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`;
}

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
  // A row now comes back from JSON, so its numbers are whatever was on disk.
  // A row written by a build that predates this ledger has neither timestamp,
  // and `Date.now() - undefined` is NaN -- which compares false against the
  // reminder window and would send on EVERY check. Fail towards sending once,
  // never towards sending always.
  if (existing) {
    if (!Number.isFinite(existing.since)) existing.since = Date.now();
    if (!Number.isFinite(existing.lastSent)) existing.lastSent = 0;
  }

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
      withPlaybook(key, `${key} is failing.\n\n${detail}`)
      + '\n\nThis is the first notice. You will get one more only if it is still failing in 12 hours, and one when it recovers.');
    if (!sent) log(`No alert email was sent for ${key}: email is not configured (EMAIL_API_KEY / EMAIL_FROM).`, 'warn');
    return;
  }

  existing.detail = detail;
  touch(key, existing);
  if (Date.now() - existing.lastSent < REMINDER_MS) return;
  existing.lastSent = Date.now();
  touch(key, existing);
  const hours = Math.round((Date.now() - existing.since) / 3_600_000);
  await notify(`DeenClipped still failing: ${key}`,
    withPlaybook(key, `${key} has been failing for about ${hours} hour(s).\n\n${detail}`));
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
