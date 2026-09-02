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

const PLATFORM_LABELS = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram', facebook: 'Facebook' };

/**
 * The invite, as one paragraph, only when there is something true to offer.
 *
 * Both halves are read from configuration at send time: the token figure from
 * REFERRAL_BONUS_PAID, and "a discount" only when a Stripe coupon is armed --
 * the percentage lives on the coupon, so this never names one. With neither
 * configured the paragraph is empty rather than promising a reward nobody
 * will receive.
 */
export function inviteParagraph(invite) {
  if (!invite?.url) return { text: '', html: '' };
  const theirs = invite.discount ? 'they get a discount on their first plan' : '';
  const yours = invite.bonus > 0 ? `you get ${invite.bonus} tokens when they subscribe` : '';
  const deal = [theirs, yours].filter(Boolean).join(', and ');
  if (!deal) return { text: '', html: '' };
  const lead = 'Know someone with lectures worth clipping? Send them your invite link';
  return {
    text: `\n\n${lead} — ${deal}:\n${invite.url}`,
    html: `<br><br>${lead} — ${deal}:<br><a href="${invite.url}" style="color:#D9B478">${invite.url}</a>`,
  };
}

export function postSummaryMessage({ clipTitle, targets, scheduleUrl, invite = null }) {
  const extra = inviteParagraph(invite);
  const label = key => PLATFORM_LABELS[key] || key;
  // Named per DESTINATION, not per platform: a clip going to three Facebook
  // Pages otherwise reads "Facebook, Facebook, Facebook" in the subject line
  // and gives no way to tell which one refused.
  const named = target => `${label(target.provider)}${target.accountName ? ` (${target.accountName})` : ''}`;
  // The subject stays platform-level and deduped -- "live on Facebook" reads
  // better than the same word three times -- while the body names each one.
  const platforms = list => [...new Set(list.map(target => label(target.provider)))].join(', ');
  const posted = (targets || []).filter(target => target.status === 'posted');
  const missed = (targets || []).filter(target => target.status !== 'posted');
  const lines = posted.map(target => `- ${named(target)}: ${target.postUrl || 'live'}`);
  if (missed.length) lines.push(`Did not go out: ${missed.map(named).join(', ')} — open your schedule to retry.`);
  const where = platforms(posted);
  return {
    subject: `Your clip is live on ${where || 'your channels'} — ${String(clipTitle || 'Untitled').slice(0, 60)}`,
    text: `"${clipTitle}" has been published.\n\n${lines.join('\n')}\n\nSee everything you have posted: ${scheduleUrl}${extra.text}`,
    html: shell(
      `Your clip is live on ${where || 'your channels'}`,
      `"${String(clipTitle || 'Untitled')}" has been published.<br><br>${posted.map(target => `${named(target)}: <a href="${target.postUrl || scheduleUrl}" style="color:#D9B478">${target.postUrl || 'view'}</a>`).join('<br>')}${missed.length ? `<br><br>Did not go out: ${missed.map(named).join(', ')} — you can retry from your schedule.` : ''}${extra.html}`,
      'Open your schedule',
      scheduleUrl,
    ),
  };
}

/**
 * The lifecycle nudges (src/nudges.js). One per step, each saying the ONE
 * thing to do next and nothing else -- a person staring at six things does
 * none of them. The tone is the product's own: plain, no urgency theatre.
 */
export function nudgeMessage({ step, name = '', appUrl, freeDaysLeft = null, invite = null }) {
  const hi = name ? `${name}, ` : '';
  const extra = inviteParagraph(invite);
  const messages = {
    import: {
      subject: 'One lecture is all it takes',
      title: 'Your workspace is ready. It just needs a lecture.',
      body: `${hi}paste a YouTube link, choose the minutes worth clipping, and the review queue fills up while you do something else. Only the stretch you select is charged, so a five-minute section costs five tokens.`,
      action: 'Paste a lecture',
      url: `${appUrl}#home`,
    },
    review: {
      subject: 'Your clips are waiting for a yes',
      title: 'Your clips came back. Nothing posts until you say so.',
      body: `${hi}the review queue plays each clip exactly as it would post. Press A to keep one, X to drop it — a lecture's worth of clips takes about two minutes to go through.`,
      action: 'Open the review queue',
      url: `${appUrl}#review`,
    },
    publish: {
      subject: 'One connection between you and your first post',
      title: 'You approved a clip. Connect a channel and it goes out.',
      body: `${hi}the clip is rendered and sitting in your schedule. Connect YouTube, TikTok, Instagram or Facebook once and it posts in your next window — every clip after it, too.`,
      action: 'Connect a channel',
      url: `${appUrl}#home`,
    },
    upgrade: {
      subject: freeDaysLeft === 0 ? 'Your free days end today' : `Your free days end in ${freeDaysLeft} ${freeDaysLeft === 1 ? 'day' : 'days'}`,
      title: 'The free window is closing.',
      body: `${hi}your free days are nearly up. A plan keeps the source minutes coming so you can keep turning lectures into clips; nothing you have made is lost either way.`,
      action: 'See plans',
      url: `${appUrl}#tokens`,
    },
  };
  const m = messages[step] || messages.import;
  return {
    subject: m.subject,
    text: `${m.title}\n\n${m.body}\n\n${m.action}: ${m.url}${extra.text}\n\nYou can switch these emails off from the bell in your dashboard.`,
    html: shell(m.title, `${m.body}${extra.html}`, m.action, m.url),
  };
}

export function lectureFailedMessage({ title, reason, dashboardUrl }) {
  return {
    subject: `We could not process "${String(title || 'your lecture').slice(0, 60)}"`,
    text: `Your lecture "${title}" could not be processed.\n\nWhat happened: ${reason}\n\nOpen your dashboard for the full explanation and the exact fixes -- most of the time it is retrying once, or uploading the MP4 instead of the link:\n${dashboardUrl}\n\nNothing was charged for work that did not finish.`,
    html: shell(
      'This lecture could not be processed',
      `"${String(title || 'Your lecture')}" hit a problem: ${String(reason || '')}<br><br>Your dashboard has the full explanation and the exact fixes — most of the time it is retrying once, or uploading the MP4 instead of the link. Nothing was charged for work that did not finish.`,
      'See what to do',
      dashboardUrl,
    ),
  };
}

export function passwordResetMessage(link) {
  return {
    subject: 'Reset your DeenClipped password',
    text: `Someone asked to reset the password for this DeenClipped account:\n\n${link}\n\nThe link works once and expires in one hour. If that was not you, ignore this — your password has not changed.`,
    html: shell(
      'Reset your password',
      'This link works once and expires in one hour. If you did not ask for it, ignore this message — nothing has changed.',
      'Choose a new password',
      link,
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
