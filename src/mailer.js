import { config } from './config.js';
import { log } from './store.js';

/**
 * Transactional email, over a provider's HTTP API.
 *
 * There was no email of any kind in this product, which is why anyone could
 * create an unlimited number of accounts against addresses they did not own:
 * there was no way to ask whether they owned them.
 *
 * HTTP rather than SMTP on purpose -- no dependency, no long-lived connection,
 * and it works from a container that only has outbound 443. Resend and
 * Postmark are both a single POST, so both are supported by shape rather than
 * by SDK.
 *
 * Everything here is inert until EMAIL_API_KEY and EMAIL_FROM are set. That is
 * deliberate: an unconfigured deployment must keep working exactly as it did,
 * not lock its owner out of their own product waiting for a mail that can
 * never arrive.
 */

export function configured() {
  return Boolean(config.emailApiKey && config.emailFrom);
}

function endpoint() {
  if (config.emailProvider === 'postmark') {
    return {
      url: 'https://api.postmarkapp.com/email',
      headers: { 'X-Postmark-Server-Token': config.emailApiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: ({ to, subject, text, html }) => ({ From: config.emailFrom, To: to, Subject: subject, TextBody: text, HtmlBody: html }),
    };
  }
  // Resend is the default shape.
  return {
    url: 'https://api.resend.com/emails',
    headers: { Authorization: `Bearer ${config.emailApiKey}`, 'Content-Type': 'application/json' },
    body: ({ to, subject, text, html }) => ({ from: config.emailFrom, to: [to], subject, text, html }),
  };
}

/**
 * Send one message. Resolves false rather than throwing when sending is not
 * configured or the provider refuses -- a failed email must never take down the
 * request that triggered it, and the caller decides what that means.
 */
export async function send({ to, subject, text, html }) {
  if (!configured()) return false;
  const target = String(to || '').trim();
  if (!target) return false;
  const api = endpoint();
  try {
    const response = await fetch(api.url, {
      method: 'POST',
      headers: api.headers,
      body: JSON.stringify(api.body({ to: target, subject, text, html })),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      // The provider's reason, never the key that authenticated the call.
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      log(`Email to ${target} was refused by the provider (${response.status}): ${detail}`, 'warn');
      return false;
    }
    return true;
  } catch (error) {
    log(`Email to ${target} could not be sent: ${error.message}`, 'warn');
    return false;
  }
}

const shell = (title, body, action, actionUrl) => `<!doctype html><html><body style="margin:0;background:#0B0B0D;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#E9E9ED">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
  <div style="font:600 15px/1 system-ui;color:#F0D6A6;letter-spacing:-.01em;margin-bottom:26px">DeenClipped</div>
  <h1 style="margin:0 0 14px;font-size:21px;font-weight:600;letter-spacing:-.02em;color:#F6F6F8">${title}</h1>
  <p style="margin:0 0 22px;font-size:14px;line-height:1.6;color:#BCBCC3">${body}</p>
  <a href="${actionUrl}" style="display:inline-block;padding:11px 18px;border-radius:9px;background:#D9B478;color:#141109;font-weight:600;font-size:14px;text-decoration:none">${action}</a>
  <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#6E6E76">If you did not ask for this, you can ignore it and nothing will change.</p>
</div></body></html>`;

export function clipsReadyMessage({ title, clipCount, reviewUrl }) {
  const count = Number(clipCount) || 0;
  const clips = count === 1 ? '1 clip' : `${count} clips`;
  return {
    subject: `${clips} ready to review — ${String(title || 'your lecture').slice(0, 60)}`,
    text: `Your lecture "${title}" has finished processing.\n\n${clips} are waiting in your review queue. Nothing posts until you approve it:\n\n${reviewUrl}`,
    html: shell(
      `${clips} ready to review`,
      `"${String(title || 'Your lecture')}" has finished processing. Nothing posts until you approve it — every clip is waiting for your yes.`,
      'Open the review queue',
      reviewUrl,
    ),
  };
}

export function verificationMessage(link) {
  return {
    subject: 'Confirm your DeenClipped address',
    text: `Confirm your email address to finish setting up DeenClipped:\n\n${link}\n\nThe link works once and expires in 24 hours. If you did not ask for this, ignore it.`,
    html: shell(
      'Confirm your address',
      'One click and your workspace is ready. This link works once and expires in 24 hours.',
      'Confirm my address',
      link,
    ),
  };
}
