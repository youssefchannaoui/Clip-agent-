import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config, productionConfigurationErrors, fatalConfigurationErrors } from './config.js';
import {
  state, save, log, logFor, clipSettings, setClipSettings, musicSettings, setMusicSettings,
  automationSettings, setAutomationSettings, publishingSettings, setPublishingSettings,
  importNetworkSettings, setImportNetworkSettings, stateRev, emailNotifsOff,
} from './store.js';
import { ownedBy, findOwned } from './tenancy.js';
import * as audio from './audio.js';
import * as templates from './templates.js';
import * as throttle from './throttle.js';
import * as backgrounds from './backgrounds.js';
import { wordsForClip, silenceSpans } from './captions.js';
import * as agent from './agent.js';
import * as backup from './backup.js';
import * as alerts from './alerts.js';
import * as ownerFeed from './owner-feed.js';
import { fallbackThumb } from './local-engine.js';
import * as social from './social.js';
import { formatLocal, postTimesFor } from './slots.js';
import { checkFfmpeg } from './ffmpeg.js';
import * as auth from './auth.js';
import * as billing from './billing.js';
import * as geo from './geo.js';
import * as help from './help.js';
import * as marketing from './marketing.js';
import * as seoPages from './seo-pages.js';
import * as financeAudit from './finance-audit.js';
import * as referrals from './referrals.js';
import * as growth from './growth.js';
import * as push from './push.js';
import * as onboarding from './onboarding.js';
import * as admin from './admin.js';
import * as owner from './owner.js';
import * as deenai from './deenai.js';
import * as metrics from './metrics.js';
import { startYouTubeRetention } from './youtube-retention.js';
import { saveVideoUpload, removeUploadedFile } from './uploads.js';
import * as objectStorage from './object-storage.js';
import { assertStorageObjectKey } from './video-import.js';
import * as workerClient from './worker-client.js';

const page = path.join(config.root, 'src', 'public', 'index.html');
const activityFixPage = path.join(config.root, 'src', 'public', 'activity-fix.js');
const premiumDashboardPage = path.join(config.root, 'src', 'public', 'premium-dashboard.js');
const marketingCssPage = path.join(config.root, 'src', 'public', 'marketing.css');
const studioAsset = name => path.join(config.root, 'src', 'public', name);
const JS_TYPE = 'text/javascript; charset=utf-8';
const STUDIO_ASSETS = {
  '/studio-template.generated.js': { file: studioAsset('studio-template.generated.js'), type: JS_TYPE },
  '/studio-runtime.js': { file: studioAsset('studio-runtime.js'), type: JS_TYPE },
  '/studio-adapter.js': { file: studioAsset('studio-adapter.js'), type: JS_TYPE },
  '/studio-styles.generated.css': { file: studioAsset('studio-styles.generated.css'), type: 'text/css; charset=utf-8' },
  // Hand-written, and kept out of the generated bundle so a design re-import
  // cannot silently delete the app's only mobile layout.
  '/studio-responsive.css': { file: studioAsset('studio-responsive.css'), type: 'text/css; charset=utf-8' },
  // Motion and hover for the Tokens & billing screen. Kept out of the design
  // export because it hangs off ids rather than the export's hashed classes.
  '/studio-tokens.css': { file: studioAsset('studio-tokens.css'), type: 'text/css; charset=utf-8' },
  // Motion and hover for the Owner screen, same arrangement for the same
  // reason: its dcow- hooks are hand-authored, not the export's hashed classes.
  '/studio-owner.css': { file: studioAsset('studio-owner.css'), type: 'text/css; charset=utf-8' },
  // The in-app help centre, same arrangement again: its dch- hooks are
  // hand-authored, so a design re-import cannot take the screen with it.
  '/studio-help.css': { file: studioAsset('studio-help.css'), type: 'text/css; charset=utf-8' },
  '/studio-motion.css': { file: studioAsset('studio-motion.css'), type: 'text/css; charset=utf-8' },
  /*
   * The notification dock. Hand-written for the same reason as the sheets
   * above -- it hangs off ids and literal dcn- classes, so a design re-import
   * cannot renumber it out from under the host.
   */
  '/studio-notify.css': { file: studioAsset('studio-notify.css'), type: 'text/css; charset=utf-8' },
  '/studio-notify.js': { file: studioAsset('studio-notify.js'), type: JS_TYPE },
  '/studio-theme.generated.css': { file: studioAsset('studio-theme.generated.css'), type: 'text/css; charset=utf-8' },
  '/studio-light.generated.css': { file: studioAsset('studio-light.generated.css'), type: 'text/css; charset=utf-8' },
  // The editor's launch gate (see index.html). Two files and these two lines;
  // turning the editor on again is a deletion rather than an untangling.
  '/studio-editor-gate.css': { file: studioAsset('studio-editor-gate.css'), type: 'text/css; charset=utf-8' },
  '/editor-gate.js': { file: studioAsset('editor-gate.js'), type: JS_TYPE },
  // The phone dashboard (studio-mobile.js renders a second template over the
  // same bindings; the sheet lives entirely inside the 820px query).
  '/studio-mobile.css': { file: studioAsset('studio-mobile.css'), type: 'text/css; charset=utf-8' },
  '/studio-mobile.js': { file: studioAsset('studio-mobile.js'), type: JS_TYPE },
  /*
   * The push service worker, and it must be served from THE ROOT. A worker's
   * scope cannot rise above its own path, so at /studio-sw.js it could only
   * ever control /studio-* -- and pushes would arrive with nothing registered
   * to show them. The handler's default no-cache + ETag is right for it: a
   * deploy takes effect on the next update check, and it is the one file whose
   * staleness cannot be fixed from inside the app.
   */
  '/sw.js': { file: studioAsset('sw.js'), type: JS_TYPE },
  // Needed for iOS: Safari only delivers Web Push to a site added to the home
  // screen, and only a site with a manifest can be added as an app.
  '/manifest.webmanifest': { file: studioAsset('manifest.webmanifest'), type: 'application/manifest+json; charset=utf-8' },
  // The editor's "coming soon" gate. Two files and one <link> so that turning
  // the editor on again is a deletion rather than an untangling.
  // Signed-out page enhancements. A file rather than an inline block because
  // the CSP hashes inline scripts from index.html only.
  '/auth-enhance.js': { file: studioAsset('auth-enhance.js'), type: JS_TYPE },
  // The browser-tab identity. /favicon.ico is served as PNG -- every modern
  // browser accepts it, and agents that request the path blindly stop 404ing.
  '/favicon.svg': { file: studioAsset('favicon.svg'), type: 'image/svg+xml' },
  '/favicon.ico': { file: studioAsset('apple-touch-icon.png'), type: 'image/png' },
  '/apple-touch-icon.png': { file: studioAsset('apple-touch-icon.png'), type: 'image/png' },
  // The Templates preview frame. A real photograph rather than the grey
  // illustration that used to stand in, at Youssef's instruction (1 Sept
  // 2026) and supplied by him.
  '/preview-sample.webp': { file: studioAsset('preview-sample.webp'), type: 'image/webp' },
  '/og-image.jpg': { file: studioAsset('og-image.jpg'), type: 'image/jpeg' },
};
const marketingJsPage = path.join(config.root, 'src', 'public', 'marketing.js');
// Marketing images are looked for in a dedicated subfolder first, then in
// src/public itself. They are currently committed directly to src/public, so
// serving only from the subfolder means every request 404s against a directory
// that does not exist. Accepting both keeps existing files working and still
// supports tidying them into the subfolder later.
const marketingAssetDirs = [
  path.resolve(config.root, 'src', 'public', 'marketing-assets'),
  path.resolve(config.root, 'src', 'public'),
];

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
  res.end(body);
}
// Rendered media lives in R2. Its pub-*.r2.dev public endpoint is a dev URL
// that Cloudflare rate-limits (measured: consecutive GET 503s mid-session),
// so when MEDIA_PUBLIC_BASE names a custom domain on the same bucket, every
// r2.dev URL is swapped to it here -- one choke point, stored records untouched.
function mediaUrl(url) {
  if (!url || !config.mediaPublicBase) return url || '';
  try {
    const parsed = new URL(url);
    if (parsed.host.endsWith('.r2.dev')) return config.mediaPublicBase + parsed.pathname + parsed.search;
  } catch { /* not a URL: leave it alone */ }
  return url;
}

function redirect(res, location) { res.writeHead(302, { Location: location, 'Cache-Control': 'no-store' }); res.end(); }
function temporaryRedirect(res, location) { res.writeHead(307, { Location: location, 'Cache-Control': 'private, no-store' }); res.end(); }

function redirectWithCookies(res, location, cookies = []) {
  const headers = { Location: location, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(302, headers); res.end();
}

// For the fetch-driven equivalents of the redirect flows: signing out
// everywhere has to clear this browser's cookie too, or the tab that asked for
// it is the one device still holding a session.
function jsonWithCookies(res, status, value, cookies = []) {
  const body = Buffer.from(JSON.stringify(value));
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' };
  if (cookies.length) headers['Set-Cookie'] = cookies;
  res.writeHead(status, headers); res.end(body);
}
/**
 * The client address, as far as it can be trusted.
 *
 * Behind exactly one proxy the LAST entry of x-forwarded-for is the address
 * that proxy actually observed; anything earlier was supplied by the caller
 * and can be invented. Reading the first entry -- the usual mistake -- would
 * let an attacker send a fresh fake address on every request and walk straight
 * past a per-IP limit.
 */
/**
 * The page this visitor first landed on, from their own browser.
 *
 * Returned raw; metrics.attribute() checks it against the page registry before
 * using it as a key, so a hand-edited cookie cannot mint state.
 */
/**
 * Everything known about how this account arrived, recorded once at sign-up.
 *
 * FIRST-TOUCH is kept as the answer to "which page earned this customer": the
 * landing cookie is written once and never overwritten, so the page that
 * brought them keeps the credit rather than the last page before checkout
 * taking it. What is added here is the CONTEXT around that first touch --
 * campaign, referrer, the page they actually signed up on -- so a later
 * question ("did the guides convert better than the tool pages?", "is that
 * campaign worth the money?") can be answered from records that already exist
 * rather than from a tracking script added afterwards.
 *
 * Every value is bounded and validated before it is stored:
 *
 * - The landing path is checked against the page REGISTRY, so a hand-edited
 *   cookie cannot invent a page or write an unbounded key.
 * - UTM values are truncated and stripped to a safe character set. They come
 *   from a query string a stranger controls, and an unbounded string written
 *   to an account record is how a state file becomes a denial-of-service.
 * - The referrer is reduced to its HOST. A full referring URL can carry
 *   somebody's search terms, session ids and private paths; the host answers
 *   the question that is actually being asked and carries none of that.
 * - Nothing here is a fingerprint. No IP, no user agent, no canvas, no device
 *   id, and no third-party script -- the first-party cookie and the query
 *   string the visitor arrived with are enough.
 */
const UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

function arrivalContext(req, url) {
  const clean = value => String(value || '')
    .slice(0, 80)
    .toLowerCase()
    .replace(/[^a-z0-9._/+-]/g, '');
  const context = {};
  for (const field of UTM_FIELDS) {
    const value = clean(url.searchParams.get(field));
    if (value) context[field] = value;
  }
  // Host only, and never our own — an internal referrer says nothing about
  // where a customer came from.
  try {
    const referrer = String(req.headers.referer || '');
    if (referrer) {
      const host = new URL(referrer).hostname.replace(/^www\./, '').slice(0, 100);
      const own = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^www\./, '');
      if (host && host !== own) context.referrerHost = host;
    }
  } catch { /* an unparseable referrer is simply absent */ }
  return context;
}

function creditLanding(req, user, isNew = true, url = null) {
  try {
    if (!isNew || !user) return;
    const landing = landingPath(req);
    let changed = false;

    if (landing && !user.signupLanding) {
      // FIRST touch. The Stripe webhook carries no cookie, so this field is
      // the only road back from a payment to the page that earned it.
      user.signupLanding = landing;
      changed = true;
    }
    // The page the form was actually submitted from, which is often not the
    // page they arrived on and is the one to look at when a landing page
    // brings people who then sign up somewhere else.
    if (url && !user.signupPage) {
      const here = String(url.pathname || '').slice(0, 120);
      if (here) { user.signupPage = here; changed = true; }
    }
    if (!user.signupAt) { user.signupAt = Date.now(); changed = true; }

    if (url && !user.arrival) {
      const context = arrivalContext(req, url);
      if (Object.keys(context).length) { user.arrival = context; changed = true; }
    }

    // The invite, if there was one. Kept SEPARATE from first-touch landing:
    // a referral says who sent them, the landing page says what convinced
    // them, and collapsing the two loses whichever question you ask next.
    if (config.referralsEnabled && !user.referredBy) {
      const code = referralCode(req);
      if (code && referrals.attachReferral(state, user, code)) {
        changed = true;
        metrics.event('referral_signup');
        // The invited person's bonus, if one is configured. Zero by default.
        if (config.referralBonusInvited > 0) grantReferralMinutes(user, config.referralBonusInvited, 'invited');
      }
    }

    if (changed) save();
    if (landing) metrics.attribute('signup', landing);
  } catch { /* attribution must never block a sign-up */ }
}

/**
 * Stamp referral activation and conversion, and pay whatever is configured.
 *
 * Runs on the owner's growth read rather than on a hook, because both facts
 * are DERIVED -- there is no single moment when "processed a video and
 * approved a clip" becomes true, and hooking every path that could make it
 * true is how one of them gets missed. The stamps are the guard: a timestamp
 * that already exists is never rewritten, so this is safe to run as often as
 * it likes and cannot pay twice.
 */
function settleReferralRewards() {
  if (!config.referralsEnabled) return [];
  const changes = referrals.settleReferrals(state);
  if (!changes.length) return changes;
  for (const change of changes) {
    const referrer = (state.authUsers || []).find(u => String(u.id) === String(change.referrerId));
    if (!referrer) continue;
    const minutes = change.kind === 'activated' ? config.referralBonusActivated : config.referralBonusPaid;
    if (minutes > 0) grantReferralMinutes(referrer, minutes, change.kind, change.userId);
    metrics.event(change.kind === 'activated' ? 'referral_activated' : 'referral_paid');
  }
  save();
  return changes;
}

function referralCode(req) {
  const match = /(?:^|;\s*)dc_ref=([^;]*)/.exec(String(req.headers.cookie || ''));
  if (!match) return '';
  try { return referrals.normaliseCode(decodeURIComponent(match[1])); } catch { return ''; }
}

/**
 * Grant bonus source minutes, idempotently.
 *
 * Every grant is written into a ledger keyed by reason, and a reason that has
 * already been granted is never granted twice. Without that, a renewal or a
 * re-run of the settle pass would top somebody up every time it ran.
 */
function grantReferralMinutes(user, minutes, reason, subjectId = '') {
  if (!user || !(minutes > 0)) return false;
  state.referralRewards ||= {};
  const ledger = (state.referralRewards[user.id] ||= { minutes: 0, entries: [] });
  const key = `${reason}:${subjectId || user.id}`;
  if (ledger.entries.some(entry => entry.key === key)) return false;
  ledger.entries.push({ key, minutes, reason, at: Date.now() });
  ledger.minutes = (ledger.minutes || 0) + minutes;
  // Same balance a purchased top-up writes to, so the number the customer
  // sees is the number that spends.
  billing.grantBonusTokens(user, minutes, `Referral bonus (${reason})`, key);
  return true;
}

/**
 * The task ladder's reward, claimed rather than granted quietly.
 *
 * Youssef, 3 Sept 2026: "it should be able to claim the tokens, and it should
 * say claimed."
 *
 * The first version paid out on the next state poll, so tokens simply appeared
 * -- nothing to press, nothing saying they had arrived, and a write on the
 * hottest path in the app. Reaching a rung now only makes it CLAIMABLE.
 *
 * Everything that made the automatic version safe still holds and is what
 * makes this safe too: the rung is recomputed server-side from the account's
 * own records (a claim for a rung this account has not reached is refused, so
 * the button is not the check), and the grant is keyed in
 * `billing.processedBonusGrants`, which refuses a key it has honoured -- so a
 * double-tap, a replayed request or a lost display record cannot pay twice.
 */
function claimTaskReward(user, id) {
  if (!config.taskRewardsEnabled) return { error: 'Task rewards are switched off.' };
  if (!user) return { error: 'Sign in first.' };
  // An operator's balance is unlimited, so a grant is a no-op. Offering the
  // claim at all would be a control that cannot do anything.
  if (billing.isUnlimited(user)) return { error: 'Your plan already has unlimited tokens.' };
  const ladder = onboarding.tasks(state, user.id, config, { unlimited: false });
  const task = ladder.list.find(row => row.id === String(id || ''));
  if (!task) return { error: 'No such task.' };
  if (!task.done) return { error: 'That one is not finished yet.' };
  if (task.claimed) return { error: 'Already claimed.' };
  if (!(task.reward > 0)) return { error: 'That task has no reward.' };
  const result = billing.grantBonusTokens(user, task.reward, `Task reward (${task.id})`, `task:${task.id}`);
  user.taskRewards ||= {};
  // A duplicate means billing has already paid this rung and only the display
  // record was missing -- stamp it so the screen agrees, and never re-grant.
  user.taskRewards[task.id] = { at: Date.now(), tokens: result.duplicate ? 0 : task.reward };
  save();
  return { granted: result.granted || 0, tokens: task.reward };
}

function landingPath(req) {
  const match = /(?:^|;\s*)dc_land=([^;]*)/.exec(String(req.headers.cookie || ''));
  if (!match) return '';
  try { return decodeURIComponent(match[1]).slice(0, 120); } catch { return ''; }
}

function clientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').map(v => v.trim()).filter(Boolean);
  if (forwarded.length) return forwarded[forwarded.length - 1];
  return req.socket?.remoteAddress || '';
}

/** A refused attempt says how long to wait, and nothing about the account. */
/**
 * Work costs real money -- worker time, storage, egress -- so it waits for a
 * confirmed address. Only where email can actually be sent: on a deployment
 * with no provider configured every account counts as verified and nothing
 * changes, because refusing there would refuse everyone forever.
 */
function assertVerified(user) {
  if (auth.isVerified(user)) return;
  // Names the CODE, because that is what the mail now leads with and what the
  // /verify screen asks for. Reaching this at all is the fallback path -- a
  // new account is sent to that screen before it ever sees the app.
  const error = new Error('Confirm your email address first — we sent you a six-digit code. Check your inbox, including spam.');
  error.statusCode = 403;
  error.needsVerification = true;
  throw error;
}

function tooManyAttempts(res, retryAfterSec, returnTo) {
  res.setHeader('Retry-After', String(Math.max(1, retryAfterSec)));
  const wait = retryAfterSec >= 60
    ? `${Math.ceil(retryAfterSec / 60)} minutes`
    : `${Math.max(1, retryAfterSec)} seconds`;
  return redirect(res, `/login?error=${encodeURIComponent(`Too many sign-in attempts. Try again in ${wait}.`)}&returnTo=${encodeURIComponent(returnTo || '/app')}`);
}

const CSRF_EXEMPT = new Set(['/auth/apple/callback']);

// Link previews, briefly. The title and duration of a lecture do not change
// between two pastes of the same URL, and every miss is a live API call.
const sourceInfoCache = new Map();

/**
 * A state-changing POST must come from this site.
 *
 * Browsers send Origin on every cross-origin POST, so an absent Origin with a
 * Referer that disagrees is equally a refusal. Apple's form_post callback is
 * genuinely cross-origin and carries its own signed token, and the Stripe and
 * worker webhooks verify signatures of their own, so those are exempt.
 */
function sameOriginPost(req, url) {
  if (CSRF_EXEMPT.has(url.pathname)) return true;
  const expected = (config.publicBaseUrl || `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || ''}`).replace(/\/+$/, '');
  const origin = String(req.headers.origin || '');
  if (origin) return origin.replace(/\/+$/, '') === expected;
  const referer = String(req.headers.referer || '');
  if (referer) { try { return new URL(referer).origin.replace(/\/+$/, '') === expected; } catch { return false; } }
  // Neither header: not a browser form post from this site.
  return false;
}

function html(res, status, value) {
  const body = Buffer.from(String(value));
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  res.end(body);
}

function importNetworkPage({ saved = false, error = '' } = {}) {
  const current = importNetworkSettings();
  const mask = value => {
    try { const u = new URL(value); return `${u.protocol}//…@${u.hostname}:${u.port || '80'}`; } catch { return '(set)'; }
  };
  const esc = value => String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  // Credentials are never echoed back into the form: a saved proxy shows as a
  // masked summary and saved cookies as a count, so the page can be screenshared
  // without leaking either. Submitting empty fields clears them.
  const cookieLines = current.cookiesText ? current.cookiesText.split('\n').filter(line => line.includes('youtube.com')).length : 0;
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Import network — DeenClipped</title>
<style>body{font:15px/1.5 system-ui;max-width:640px;margin:40px auto;padding:0 16px;color:#1a1a1a}
input,textarea{width:100%;padding:8px;margin:4px 0 16px;border:1px solid #bbb;border-radius:6px;font:inherit}
textarea{height:140px;font-family:ui-monospace,monospace;font-size:12px}
button{padding:10px 22px;border:0;border-radius:6px;background:#111;color:#fff;font:inherit;cursor:pointer}
.ok{background:#e8f6ec;border:1px solid #9fd4ad;padding:10px 14px;border-radius:6px}
.err{background:#fbeaea;border:1px solid #e3a6a6;padding:10px 14px;border-radius:6px}
small{color:#666}</style>
<h1>Import network</h1>
<p>Used by the worker's YouTube downloader to get past the bot wall on its datacenter IP. Saved values are sent to the worker with each import job; they are never shown back here.</p>
${saved ? '<p class="ok">Saved. The next URL import uses these settings — no rebuild needed.</p>' : ''}
${error ? `<p class="err">${esc(error)}</p>` : ''}
<form method="post">
<label>Residential proxy URL <small>— currently ${current.proxy ? esc(mask(current.proxy)) : 'not set'}</small></label>
<input name="proxy" placeholder="http://username:password@host:port" autocomplete="off">
<label>YouTube cookies export <small>— currently ${cookieLines ? `${cookieLines} youtube.com cookie(s) saved` : 'not set'}. Use a throwaway Google account, never the channel's.</small></label>
<textarea name="cookiesText" placeholder="# Netscape HTTP Cookie File&#10;.youtube.com&#9;TRUE&#9;/&#9;…"></textarea>
<label><input type="checkbox" name="clearProxy" value="1" style="width:auto"> clear the saved proxy</label>
<label><input type="checkbox" name="clearCookies" value="1" style="width:auto"> clear the saved cookies</label>
<p><button>Save</button></p>
<p><small>An empty field keeps what is already saved; use the checkboxes to clear.</small></p>
</form>`;
}

function publicBase(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim() || 'https';
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'deenclipped.online').split(',')[0].trim() || 'deenclipped.online';
  return (config.publicBaseUrl || `${proto}://${host}`).replace(/\/+$/, '');
}
function marketingContext(req) {
  // The visitor's currency travels with every marketing render so the pricing
  // grid can say which money it is quoting. No price is converted here -- see
  // currencyNote in marketing.js.
  return { base: publicBase(req), currentUser: auth.currentUser(req), currency: geo.currencyOf(req) };
}
function marketingHome(req) { return marketing.home(marketingContext(req)); }
function featuresPage(req) { return marketing.features(marketingContext(req)); }
function pricingPage(req) { return marketing.pricing(marketingContext(req)); }
function contactPage(req) { return marketing.contact(marketingContext(req)); }
function privacyPage(req) { return marketing.privacy(marketingContext(req)); }
function termsPage(req) { return marketing.terms(marketingContext(req)); }

// Injected into <head> for the Studio shell. Declared here, once, because the
// Content-Security-Policy has to allow this exact text by hash: shipping it as
// a literal at the injection site meant the policy knew nothing about it, the
// browser refused it, window.STUDIO_SHELL was never set, and every visitor got
// the old dashboard instead of the studio.
const STUDIO_SHELL_SCRIPT = 'window.STUDIO_SHELL=true;';

function serveAppShell(req, res, url, currentUser) {
  if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  if (auth.enabled() && currentUser && billing.needsPlanChoice(currentUser)) return redirect(res, `/plans?returnTo=${encodeURIComponent('/app' + (url.search || ''))}`);
  let html = fs.readFileSync(page, 'utf8');
  // activity-fix.js builds the current dashboard shell (#dcSidebar/#dcTopbar/#dcWork)
  // by appending to document.body, and premium-dashboard.js layers onto it. The
  // Studio dashboard is a full replacement for that shell, so the two cannot both
  // run — loading them together leaves each overwriting the other's markup.
  // `?studio=1` serves the page without them.
  // The Studio dashboard is the default. `?classic=1` serves the previous shell
  // and is the escape hatch: the two cannot both run, so if something is wrong
  // with Studio in production that URL is the way back without a deploy.
  const studioShell = url.searchParams.get('classic') !== '1';
  if (studioShell) {
    // Into <head>, not before </body>: the page's inline script calls boot() during
    // parse, so a flag set at the end of the body would arrive after the decision.
    // The page reads this rather than sniffing for the scripts, so that merely
    // mentioning a script path in index.html cannot change what gets injected.
    html = html.replace('</head>', `<script>${STUDIO_SHELL_SCRIPT}</script>\n</head>`);
  } else {
    const has = tag => html.includes(`src="${tag}"`);
    if (!has('/activity-fix.js')) html = html.replace('</body>', '<script src="/activity-fix.js"></script>\n</body>');
    if (!has('/premium-dashboard.js')) html = html.replace('</body>', '<script src="/premium-dashboard.js"></script>\n</body>');
  }
  const body = Buffer.from(html);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
  return res.end(body);
}

function formBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let raw = '', size = 0;
    req.on('data', chunk => { size += chunk.length; if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; } raw += chunk; });
    req.on('end', () => { const params = new URLSearchParams(raw); const body = {}; for (const [key, value] of params.entries()) body[key] = value; resolve(body); });
    req.on('error', reject);
  });
}
function userRecordForRequest(req) { return auth.currentUser(req); }
/*
 * Record lookup is scoped to the signed-in account, always.
 *
 * These previously found the record first and checked permission second, and
 * answered 403 when the check failed — which told a stranger that a clip id
 * exists and belongs to someone else. Now a record owned by another account is
 * simply not found, and the response is identical to a genuinely missing id.
 */
function assertCanAccessClip(user, clipId) {
  const clip = findOwned(state.clips, clipId, user?.id);
  if (!clip) throw Object.assign(new Error('Clip not found.'), { statusCode: 404 });
  return clip;
}
function assertCanAccessProject(user, projectId) {
  const project = findOwned(state.projects, projectId, user?.id);
  if (!project) throw Object.assign(new Error('Project not found.'), { statusCode: 404 });
  return project;
}
function requireOperator(user) {
  if (!['owner', 'admin'].includes(String(user?.role || '').toLowerCase())) throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  return user;
}

// One clip's look becomes the shared template (per-account patch on a
// built-in). Framing never travels. Returns the saved template.
function promoteClipLook(user, clip) {
  const overrides = clip.styleOverrides && Object.keys(clip.styleOverrides).length ? clip.styleOverrides : null;
  if (!overrides) throw new Error('This clip has no changes of its own to apply.');
  const base = templates.templateById(clip.templateId, user);
  if (!base) throw new Error('The style this clip uses no longer exists.');
  const look = { ...overrides };
  for (const field of templates.FRAMING_FIELDS) delete look[field];
  if (!Object.keys(look).length) throw new Error('Only framing was changed, and framing belongs to this clip alone.');
  const { template } = templates.saveTemplate(user, base.id, look);
  // The look now lives in the style itself; holding it twice would make a
  // later style edit look like it had no effect on this clip. The framing
  // never travelled, so it stays the clip's own.
  const keptFraming = {};
  for (const field of templates.FRAMING_FIELDS) {
    if (clip.styleOverrides[field] !== undefined) keptFraming[field] = clip.styleOverrides[field];
  }
  if (Object.keys(keptFraming).length) clip.styleOverrides = keptFraming;
  else delete clip.styleOverrides;
  clip.stylePending = true;
  return template;
}

function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update', projectId = '') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // Only the acting account's clips. This used to sweep `state.clips`, so one
  // customer saving a template queued a re-render of every other customer's
  // work onto their own template.
  for (const clip of ownedBy(state.clips, user?.id)) {
    if (clip.variantOf) { skipped += 1; continue; }
    // Approved is a decision about a particular render, so a later template
    // change must not reach back and replace it -- a clip that was approved,
    // scheduled, or already out stays exactly as it was signed off. Saving a
    // template re-renders what nobody has decided on yet, and nothing else.
    if (clip.status !== 'waiting') { skipped += 1; continue; }
    // Saving from the clip editor applies to that lecture, per the design; the
    // Templates screen still applies to everything unposted.
    if (projectId && clip.projectId !== projectId) { skipped += 1; continue; }
    // ... everything unposted THAT USES THIS TEMPLATE. Without this, saving
    // Quran Recitation queued a re-render of every unposted clip the account
    // had ever made -- lecture clips, old test clips -- onto the recitation
    // template, flooding the worker with twenty-plus renders nobody asked for
    // and overwriting clips with a style that was never theirs.
    if (clip.templateId !== template.id) { skipped += 1; continue; }
    try {
      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false, priority: 2 });
      queued += 1;
    } catch (error) {
      skipped += 1;
      errors.push({ clipId: clip.id, error: error.message });
    }
  }
  log(`Template "${template.name}" queued for ${queued} unposted clips after ${reason}; ${skipped} skipped.`, 'info', user?.id);
  return { queued, skipped, errors: errors.slice(0, 20) };
}
function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let difference = 0; for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return difference === 0;
}
function verifyWorkerRequest(req, pathname, rawBody) {
  const timestamp = String(req.headers['x-deenclipped-timestamp'] || '');
  const supplied = String(req.headers['x-deenclipped-signature'] || '');
  if (!config.workerSharedSecret || !timestamp || !supplied || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = crypto.createHmac('sha256', config.workerSharedSecret).update(`${timestamp}\n${req.method || 'GET'}\n${pathname}\n${rawBody}`).digest('hex');
  return sameSecret(expected, supplied);
}
function authed(req, url) { return !config.password || sameSecret(req.headers['x-app-password'] || url.searchParams.get('pw') || '', config.password); }
/*
 * A name for a push subscription that a person could recognise in a device
 * list -- "Chrome on Android", not the user agent string. Deliberately coarse:
 * the full UA is a fingerprint, and this product's whole analytics posture is
 * that it stores neither an address nor a user agent (src/metrics.js).
 */
function deviceLabel(req) {
  const ua = String(req.headers['user-agent'] || '');
  const browser = /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : 'Browser';
  const platform = /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'Mac'
    : /Windows/.test(ua) ? 'Windows'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  return platform ? `${browser} on ${platform}` : browser;
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    // A declared length over the cap is refused before a byte is buffered.
    const declared = Number(req.headers['content-length'] || 0);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new Error('Request body is too large.'));
      req.destroy();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Request body was not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function readRawBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function streamFile(req, res, file, { downloadName = '', contentType = '', cacheControl = 'private, no-store' } = {}) {
  if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'File not found.' });
  const stat = fs.statSync(file); const range = req.headers.range;
  const headers = { 'Content-Type': contentType || (path.extname(file).toLowerCase() === '.jpg' ? 'image/jpeg' : 'video/mp4'), 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl };
  if (downloadName) headers['Content-Disposition'] = `attachment; filename="${downloadName.replace(/["\r\n]/g, '')}"`;
  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0; const end = match[2] ? Number(match[2]) : stat.size - 1;
      if (start >= stat.size || end < start) { res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` }); return res.end(); }
      const finalEnd = Math.min(end, stat.size - 1);
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${finalEnd}/${stat.size}`, 'Content-Length': finalEnd - start + 1 });
      return fs.createReadStream(file, { start, end: finalEnd }).pipe(res);
    }
  }
  res.writeHead(200, { ...headers, 'Content-Length': stat.size }); return fs.createReadStream(file).pipe(res);
}

function latestRerender(clipId) {
  // The full render outranks a preview window in the status line -- the
  // preview's whole life is seconds, and it has its own chip in the editor.
  // A social variant is excluded outright: it renders a platform-specific COPY
  // and never touches the clip, so reporting it here would put "re-rendering"
  // on a clip whose own render is finished and offer an editor spinner for
  // work the customer did not ask for and cannot see.
  const jobs = state.rerenderJobs.filter(job => job.clipId === clipId && !job.socialVariant);
  return jobs.find(job => !job.preview && ['queued', 'processing'].includes(job.status)) || jobs[0] || null;
}
function publicClip(clip, { detail = false } = {}) {
  // Resolved as the clip's owner sees it. Without the user, the account's own
  // template edits are invisible here, so "outdated" compared against the
  // shipped file and the badge never showed for an edited built-in.
  const currentTemplate = templates.templateById(clip.templateId, clip.userId || '');
  const rerender = latestRerender(clip.id);
  return {
    id: clip.id, projectId: clip.projectId, projectTitle: clip.projectTitle,
    title: clip.title, description: clip.description, hashtags: clip.hashtags, transcript: clip.transcript,
    // Sentence-level caption timings and matched ayahs are editor-only and by
    // far the heaviest fields on a clip (~85% of its bytes). The list payload
    // the dashboard polls every 2s omits them; the editor fetches
    // /api/clips/:id/detail for the one clip it has open.
    ...(detail ? {
      captionSegments: Array.isArray(clip.captionSegments) ? clip.captionSegments : [],
      ayahs: Array.isArray(clip.ayahs) ? clip.ayahs : [],
    } : {}),
    score: clip.score, scoreReasons: clip.scoreReasons || [], quality: clip.quality || null,
    reviewRequired: Boolean(clip.reviewRequired), startSec: clip.startSec, endSec: clip.endSec, durationMs: clip.durationMs,
    status: clip.status, approvedBy: clip.approvedBy || null,
    // Approved but the allocator could not place it -- nowhere enabled to post,
    // usually. The approval stands and this says why nothing is scheduled,
    // instead of the clip quietly reappearing in the review queue.
    scheduleError: clip.status === 'approved' ? (clip.scheduleError || null) : null,
    scheduledAt: clip.scheduledAt, scheduledLabel: clip.scheduledAt ? formatLocal(clip.scheduledAt) : null,
    readyAt: clip.readyAt || null, postedAt: clip.postedAt,
    musicName: clip.musicName, musicVerified: Boolean(clip.musicVerified),
    // false only when the job deliberately had no nasheed; absent means required.
    musicEnabled: clip.musicEnabled !== false,
    templateId: clip.templateId, templateName: clip.templateName, templateVersion: clip.templateVersion || 1,
    templateOutdated: Boolean(currentTemplate && Number(currentTemplate.version || 1) > Number(clip.templateVersion || 1)),
    // This clip's own style tweaks, and whether the rendered file still matches
    // them. The editor reads both so it can show what is unsaved to the video.
    styleOverrides: clip.styleOverrides ? { ...clip.styleOverrides } : null,
    styleOverrideCount: clip.styleOverrides ? Object.keys(clip.styleOverrides).length : 0,
    stylePending: Boolean(clip.stylePending),
    renderVersion: clip.renderVersion || 1, renderVerified: Boolean(clip.renderVerified), renderQuality: clip.renderQuality || null,
    renderedWidth: clip.renderedWidth || null, renderedHeight: clip.renderedHeight || null,
    // The clip's own loudness, drawn as the bars on its review card. Absent for
    // anything rendered before the worker measured it, and the card then draws
    // a quiet baseline rather than inventing a shape.
    waveform: Array.isArray(clip.waveform) && clip.waveform.length ? clip.waveform : null,
    variantOf: clip.variantOf || null, addedAt: clip.addedAt,
    targets: (clip.targets || []).map(social.targetPublic),
    // WHERE THIS CLIP IS GOING, answered before the decision instead of after
    // it. `targets` only exist once a clip has been scheduled, so the review
    // queue -- the one screen where somebody is deciding whether to publish --
    // could say nothing at all about the destination. Committed targets win
    // where they exist; otherwise this is the plan.
    willPostTo: (clip.targets || []).length
      ? (clip.targets || []).map(social.targetPublic).map(t => ({
        id: t.id, provider: t.provider, accountId: t.accountId || '', accountName: t.accountName || '',
      }))
      : social.plannedChannelsFor(clip),
    rerender: rerender ? { id: rerender.id, status: rerender.status, stage: rerender.stage, progress: rerender.progress, error: rerender.error || null, asVariant: rerender.asVariant, preview: Boolean(rerender.preview) } : null,
    stylePreview: clip.stylePreview ? { ...clip.stylePreview, url: mediaUrl(clip.stylePreview.url) } : null,
    videoUrl: mediaUrl(clip.clipUrl) || `/api/clips/${encodeURIComponent(clip.id)}/video`, thumbUrl: mediaUrl(clip.thumbUrl) || `/api/clips/${encodeURIComponent(clip.id)}/thumb`,
  };
}

function appState(user = null) {
  // Everything below is scoped to one account: its records, its settings, its
  // templates, its music, its connected platforms and its activity feed.
  if (!user?.id) return { engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted', user: null, auth: auth.publicConfig(), projects: [], clips: [], log: [] };
  const readiness = agent.engine.readiness(user);
  /* The comeback rewards' one stamped fact: that this account opened the app
     today. Nothing else in this product records it -- web metrics are
     anonymous and public-page only, deliberately -- so it cannot be derived.
     A no-op on every poll after the first of the day. */
  if (onboarding.noteVisit(state, user.id)) save();
  const projectsForUser = ownedBy(state.projects, user.id);
  const projectIdsForUser = new Set(projectsForUser.map(project => project.id));
  const clipsForUser = ownedBy(state.clips, user.id).filter(clip => projectIdsForUser.has(clip.projectId));
  return {
    engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted', user: auth.userPublic(user), auth: auth.publicConfig(), readiness, clipSettings: clipSettings(user), musicSettings: musicSettings(user), automationSettings: automationSettings(user),
    version: config.appVersion,
    // Five different errors instruct the user to "tell the site owner". Until
    // now the app gave them no way to do that: the only support address lived
    // on the marketing site, behind a link out of the product.
    support: { email: config.supportEmail },
    // Whether product emails (clips ready / posted / failed) go out for this
    // account. Root-level so the bell dropdown reads it without a second fetch.
    emailNotifs: !emailNotifsOff(user.id),
    // The browser needs the server's VAPID public key to subscribe, and the
    // count is what lets the switch say "on this device" honestly. Null key
    // means push is off on this server, and the switch says so rather than
    // offering a control that cannot work.
    pushKey: push.publicKey(),
    pushDevices: push.subscriptionsFor(user.id).length,
    // Where this account is in Create -> Review -> Publish, and the two
    // one-time moments. Derived, never stored, so it is right for the accounts
    // that predate it and cannot drift from what actually happened.
    onboarding: onboarding.journey(state, user.id, {
      // The two prerequisites the retired "Getting set up" list carried. They
      // shape the strip's copy only -- never which step the account is on.
      nasheeds: audio.listNasheeds(user).length,
      connected: Object.keys(state.socialConnections[user.id] || {}).length,
      // Stated beside the field that spends it. Null for an operator, whose
      // balance is unlimited and for whom a number would be a lie.
      tokensLeft: billing.publicBilling(user)?.current?.totalAvailable ?? null,
    }),
    /*
     * The task ladder, and the rail card that draws it. Its first three rungs
     * ARE the journey's three steps, read off the same call rather than
     * recomputed -- v3.96.0 retired a checklist for telling one person two
     * different things about where they were, and this must never become a
     * second answer to that question.
     */
    tasks: onboarding.tasks(state, user.id, config, { unlimited: billing.isUnlimited(user) }),
    selectedTemplate: templates.selectedTemplate(user), templates: templates.listTemplates(user), templateDraft: templates.defaultTemplateDraft(),
    // The two ACCOUNT-wide brand switches. Sent separately from any
    // template because the panel that draws them must not read the
    // selected one: the scripture template is exempt from both, so with
    // it selected the switches read 'off' for a setting that is on
    // everywhere else -- a control that looks broken and is not.
    brand: templates.brandSettings(user) || {},
    // One shape, built in backgrounds.js beside the rules it depends on, so
    // the votes a card draws and the votes a route writes cannot disagree.
    backgrounds: backgrounds.listBackgrounds(user).map(entry => backgrounds.publicBackground(entry, user)),
    tracks: audio.listNasheeds(user),
    storage: agent.engine.storageBytes(user.id),
    projects: projectsForUser.map(project => ({
      id: project.id, title: project.title, url: project.url, engine: project.engine, status: project.status,
      stage: project.stage, phase: project.phase || '', progress: project.progress || 0, etaSec: project.etaSec ?? null, error: project.error || null, errorCode: project.errorCode || null,
      bytesDone: project.bytesDone ?? null, bytesTotal: project.bytesTotal ?? null,
      currentClip: project.currentClip ?? null, totalClips: project.totalClips ?? null,
      clipPercent: project.clipPercent ?? null, clipPlan: project.clipPlan || null,
      submittedAt: project.submittedAt, completedAt: project.completedAt || null, clipCount: project.clipCount || 0,
      queueAhead: project.status === 'queued' ? agent.engine.queueAhead(project.id) : null,
      priority: project.priority ?? null,
      clipsRequested: project.clipsRequested || 0,
      durationSec: project.durationSec || project.sourceDurationSec || null, sourceDurationSec: project.sourceDurationSec || null,       // Derived at read time as well as at submit: lectures queued before the
      // dashboard sent sourceMeta have null on the record, and back-filling here
      // gives the existing library its posters without a migration.
      sourceThumbUrl: project.sourceThumbUrl || fallbackThumb(project.url) || null, sourceTitle: project.sourceTitle || null, templateIdUsed: project.templateIdUsed,
      templateNameUsed: project.templateNameUsed, templateVersionUsed: project.templateVersionUsed || 1, musicRequired: true,
      sourceReusable: Boolean((project.sourceFile && fs.existsSync(project.sourceFile) && project.transcriptFile && fs.existsSync(project.transcriptFile)) || (project.sourceObjectKey && project.transcriptObjectKey)),
      moreJob: project.moreJob ? {
        id: project.moreJob.id, status: project.moreJob.status, stage: project.moreJob.stage,
        progress: project.moreJob.progress || 0, error: project.moreJob.error || null,
        requestedCount: project.moreJob.requestedCount || 0, importedCount: project.moreJob.importedCount || 0,
        createdAt: project.moreJob.createdAt || null, startedAt: project.moreJob.startedAt || null,
        completedAt: project.moreJob.completedAt || null, updatedAt: project.moreJob.updatedAt || null,
        reusedSource: true, reusedTranscript: true,
      } : null,
    })),
    clips: clipsForUser.map(publicClip),
    rerenderJobs: ownedBy(state.rerenderJobs, user.id).filter(job => clipsForUser.some(clip => clip.id === job.clipId)).slice(0, 30),
    // The windows THIS account actually gets, not the configured four.
    // Studio buys eight a day, and the scheduler has always honoured that
    // (agent.js asks slots.js for postSlotsStudio windows) -- but this payload
    // sent config.postTimes to everybody, so a Studio customer was told four
    // while the app gave them eight. The display and the behaviour must come
    // from one function or they drift, which is the failure this codebase has
    // now paid for three times.
    // atLeast, not paysForAtLeast: the operator gets Studio's posting capacity
    // like every other Studio perk (Youssef, 1 Sept 2026: "for admin account
    // should be like studio with all perks"). Extra windows only widen the
    // account's OWN schedule, so nothing is taken from a customer -- unlike
    // queue position, which stays on the paid tier in local-engine.js.
    postTimes: billing.atLeast(user, 'studio') ? postTimesFor(config.postSlotsStudio) : config.postTimes,
    timezone: config.timezone, activeJobs: agent.engine.activeJobCount(),
    log: logFor(user, 60), directPublishingEnabled: config.socialPublishEnabled,
    publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),
    // How many accounts this plan may post to on each platform, computed by the
    // same function the route enforces with. The browser needs it to know how
    // many boxes to let someone tick -- and it is per platform, because the
    // OAuth store can hold several Meta accounts and only one YouTube channel,
    // so a single number would offer a choice that cannot be honoured.
    publishingLimits: Object.fromEntries(['youtube', 'instagram', 'facebook', 'tiktok']
      .map(provider => [provider, billing.accountsPerPlatform(user, provider)])),
  };
}

function runDoctor() {
  return new Promise(resolve => {
    const child = spawn(config.pythonBin, [config.workerScript, '--doctor'], {
      cwd: config.root, env: { ...process.env, FFMPEG_PATH: config.ffmpegPath, FFPROBE_PATH: config.ffprobePath }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => { clearTimeout(timer); let details = null; try { details = JSON.parse(stdout.trim()); } catch {} resolve({ ok: code === 0, details, error: stderr.trim() || (!details ? stdout.trim() : '') }); });
    child.on('error', error => { clearTimeout(timer); resolve({ ok: false, error: error.message }); });
  });
}

/**
 * One set of TikTok posting choices per account, sanitised.
 *
 * The same coercions the flat fields get below: a sub-option arriving true with
 * its parent disclosure off would post a declaration the creator never made,
 * and that is the rule TikTok's review is strictest about.
 */
function tiktokAccountOptions(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [accountId, value] of Object.entries(raw).slice(0, 10)) {
    if (!accountId || !value || typeof value !== 'object') continue;
    const commercial = Boolean(value.commercialContent);
    out[String(accountId).slice(0, 128)] = {
      privacy: String(value.privacy || ''),
      allowComments: value.allowComments !== false,
      allowDuet: Boolean(value.allowDuet),
      allowStitch: Boolean(value.allowStitch),
      commercialContent: commercial,
      yourBrand: commercial && Boolean(value.yourBrand),
      brandedContent: commercial && Boolean(value.brandedContent),
    };
  }
  return out;
}

async function route(req, res, url) {
  const { pathname } = url; const method = req.method || 'GET';
  if (pathname === '/healthz') return json(res, 200, { ok: true, engine: config.processingMode === 'remote' ? 'remote-worker' : 'self-hosted' });
  if (pathname === '/readyz') {
    const errors = productionConfigurationErrors();
    try { fs.accessSync(config.dataDir, fs.constants.R_OK | fs.constants.W_OK); } catch { errors.push('Persistent data storage is not readable and writable.'); }
    if (config.processingMode === 'remote' && !errors.some(item => item.startsWith('WORKER_'))) {
      try { await workerClient.readiness(); } catch (error) { errors.push(`External worker is not ready: ${error.message}`); }
    }
    // Reported, never fatal. A backup that cannot be written is serious, but
    // failing readiness over it would take a working product offline and, on a
    // platform that restarts unready instances, keep it there.
    const backupState = backup.lastResult();
    const backupReport = backup.blockedReason()
      || (backupState.at === 0 ? 'no backup has run yet'
        : `${backupState.ok ? 'ok' : 'FAILING'} -- ${backupState.detail} (${new Date(backupState.at).toISOString()})`);
    return json(res, errors.length ? 503 : 200, {
      ok: errors.length === 0,
      engine: config.processingMode,
      checks: errors.length ? errors : ['configuration', 'storage', 'worker'],
      backup: backupReport,
    });
  }
  const workerCallback = pathname.match(/^\/api\/worker-callbacks\/([^/]+)$/);
  if (method === 'POST' && workerCallback) {
    const raw = await readRawBody(req, 5_000_000);
    if (!verifyWorkerRequest(req, pathname, raw)) return json(res, 401, { error: 'Invalid worker signature.' });
    let update; try { update = JSON.parse(raw); } catch { return json(res, 400, { error: 'Invalid callback JSON.' }); }
    const project = agent.engine.acceptRemoteUpdate(decodeURIComponent(workerCallback[1]), update);
    return project ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Job not found.' });
  }
  const workerMusic = pathname.match(/^\/api\/worker-assets\/music\/([^/]+)$/);
  if (method === 'GET' && workerMusic) {
    const trackId = decodeURIComponent(workerMusic[1]);
    const userId = String(url.searchParams.get('user') || '');
    if (!agent.engine.verifyWorkerAssetSignature(trackId, userId, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      return json(res, 401, { error: 'Invalid or expired worker asset link.' });
    }
    const found = audio.nasheedFilePath(userId, trackId);
    if (!found) return json(res, 404, { error: 'Track not found.' });
    return streamFile(req, res, found.file, { contentType: 'audio/mpeg' });
  }
  const workerBackground = pathname.match(/^\/api\/worker-assets\/background\/([^/]+)$/);
  if (method === 'GET' && workerBackground) {
    const bgId = decodeURIComponent(workerBackground[1]);
    const userId = String(url.searchParams.get('user') || '');
    if (!agent.engine.verifyWorkerAssetSignature(`background:${bgId}`, userId, url.searchParams.get('exp'), url.searchParams.get('sig'))) {
      return json(res, 401, { error: 'Invalid or expired worker asset link.' });
    }
    const found = backgrounds.backgroundFilePath(userId, bgId);
    if (!found) return json(res, 404, { error: 'Background not found.' });
    return streamFile(req, res, found.file, { contentType: 'video/mp4' });
  }
  if (method === 'POST' && pathname === '/api/billing/webhook') {
    try {
      const raw = await readRawBody(req, 5_000_000);
      const signature = req.headers['stripe-signature'] || '';
      const event = billing.verifyStripeSignature(raw, signature);
      billing.handleWebhookEvent(event);
      alerts.report('billing', false).catch(() => {});
      return json(res, 200, { received: true });
    } catch (error) {
      // A rejected webhook used to return 400 and tell nobody. If the signing
      // secret is ever wrong, the money reaches Stripe, the app never hears
      // about it, and the customer sits there with no tokens until they
      // complain -- the exact silent failure the alerts exist to prevent.
      //
      // Only a request that actually carried a signature raises the alarm.
      // A public endpoint is scanned constantly, and unsigned junk is noise,
      // not a billing outage.
      if (req.headers['stripe-signature']) {
        alerts.report('billing', true,
          `A Stripe webhook was refused: ${error.message}\n` +
          'A payment may have completed without the customer receiving tokens.\n' +
          billing.webhookSecretNote()).catch(() => {});
      }
      return json(res, 400, { error: error.message });
    }
  }

  const currentUser = userRecordForRequest(req);

  // First-party analytics: count public page GETs. The module allowlists
  // paths, skips operators, and keeps only aggregates -- see metrics.js.
  if (method === 'GET') {
    try {
      // "Has this browser been here before?" cannot come from the visitor
      // hash -- that is salted per DAY so yesterday is unrecognisable, which
      // is the privacy property. So the flag lives in the visitor's browser:
      // a bare 1, no identifier, HttpOnly so no script can read it, Lax so it
      // is not sent from other sites.
      const seenBefore = /(?:^|;\s*)dc_seen=1(?:;|$)/.test(String(req.headers.cookie || ''));
      if (metrics.pageview({
        path: pathname, ip: clientIp(req),
        userAgent: String(req.headers['user-agent'] || ''),
        referrer: String(req.headers.referer || ''),
        ownHost: String(req.headers.host || '').replace(/:\d+$/, ''),
        query: url.searchParams, viewerRole: currentUser?.role || '',
        language: String(req.headers['accept-language'] || ''),
        seenBefore,
      })) {
        const secure = config.publicBaseUrl.startsWith('https://') ? '; Secure' : '';
        // Appended, never assigned: a bare setHeader here would drop the
        // session cookie on any response that sets one, and silently signing
        // people out to count them is not a trade worth making.
        const prior = res.getHeader('Set-Cookie');
        const seenCookie = `dc_seen=1; Max-Age=63072000; Path=/; SameSite=Lax; HttpOnly${secure}`;
        const extra = [seenCookie];
        // Which page they arrived on, so a subscription can be credited to the
        // page that earned it. A PATH and nothing else -- no identifier, and
        // no second value to join against. Written once and never overwritten,
        // or the last page before checkout would take the credit that belongs
        // to the page that brought them. 90 days covers a free trial turning
        // into a subscription; past that the answer is not worth keeping.
        if (!landingPath(req)) {
          extra.push(`dc_land=${encodeURIComponent(pathname)}; Max-Age=7776000; Path=/; SameSite=Lax; HttpOnly${secure}`);
        }
        res.setHeader('Set-Cookie', prior ? [].concat(prior, ...extra) : extra);
      }
    } catch { /* analytics must never take a page down */ }
  }
  if (method === 'GET' && pathname === '/login') {
    if (currentUser && auth.enabled()) return redirect(res, billing.postLoginRedirect(currentUser, url.searchParams.get('returnTo') || '/app'));
    return html(res, 200, auth.loginPage({ error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'GET' && pathname === '/plans') {
    if (auth.enabled() && !currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent(pathname + url.search)}`);
    // Seeing the page is what "plans seen" means. Marking it only in the
    // continue-free POST left the page's own "Dashboard" link -- a plain GET
    // /app -- bouncing straight back here forever, with the form button as the
    // only way out.
    if (currentUser) billing.markPlansSeen(currentUser);
    return html(res, 200, billing.plansPage(currentUser, { error: url.searchParams.get('error') || '', info: url.searchParams.get('info') || '', returnTo: url.searchParams.get('returnTo') || '/app' }));
  }
  if (method === 'POST' && pathname === '/billing/continue-free') {
    try { const body = await formBody(req); billing.markPlansSeen(currentUser); return redirect(res, billing.postLoginRedirect(currentUser, body.returnTo || '/app')); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/billing/checkout') {
    try { const body = await formBody(req); const session = await billing.createCheckoutSession(currentUser, String(body.plan || ''), geo.currencyOf(req)); return redirect(res, session.url); }
    catch (error) { return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/billing/topup') {
    try {
      const body = await formBody(req);
      const session = await billing.createTopupCheckoutSession(currentUser, String(body.package || ''));
      return redirect(res, session.url);
    } catch (error) {
      return redirect(res, `/plans?error=${encodeURIComponent(error.message)}`);
    }
  }
  const authStart = pathname.match(/^\/auth\/(google|apple)\/start$/);
  if (method === 'GET' && authStart) {
    try { return redirect(res, auth.oauthStart(authStart[1], req, url.searchParams.get('returnTo') || '/app')); }
    catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'GET' && pathname === '/auth/google/callback') {
    try {
      const result = await auth.completeGoogle(req, url.searchParams.get('code') || '', url.searchParams.get('state') || '');
      creditLanding(req, result.user, result.user?.justCreated === true, url);
      const session = auth.createSession(result.user, { provider: 'google' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/apple/callback') {
    try {
      const body = await formBody(req);
      const result = await auth.completeApple(req, body);
      creditLanding(req, result.user, result.user?.justCreated === true, url);
      const session = auth.createSession(result.user, { provider: 'apple' });
      return redirectWithCookies(res, billing.postLoginRedirect(result.user, result.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) { return redirect(res, `/login?error=${encodeURIComponent(error.message)}`); }
  }
  if (method === 'POST' && pathname === '/auth/email') {
    const body = await formBody(req);
    const ip = clientIp(req);
    const keys = throttle.keysFor(ip, body.email || '');
    const gate = throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(res, gate.retryAfterSec, body.returnTo);
    // Signing in and signing UP are the same request here, and there is no
    // verification step, so one address could mint accounts as fast as it could
    // post -- each one arriving with free tokens that cost real worker time and
    // storage. Existing accounts are unaffected: this only counts addresses
    // that have never been seen before.
    const known = auth.accountExists(body.email || '');
    if (!known) {
      const signups = throttle.rateLimit(`signup:${ip}`, 3, 24 * 60 * 60_000);
      if (!signups.allowed) {
        return redirect(res, `/login?error=${encodeURIComponent('Too many new accounts from this connection today. Sign in to an existing account, or try again tomorrow.')}`);
      }
    }
    // The robot box, on the door where a robot costs something: signing up
    // mints an account with free tokens that cost real worker time, and the
    // per-IP daily cap was the only thing in the way. Checked BEFORE the
    // password is hashed -- hashing is deliberately expensive, and letting an
    // unsolved challenge reach it hands out a cheap way to burn the CPU.
    if (auth.turnstileEnabled() && !(await auth.verifyTurnstile(body['cf-turnstile-response'], ip))) {
      return redirect(res, `/login?error=${encodeURIComponent('That did not confirm you are human. Try the box again.')}&returnTo=${encodeURIComponent(body.returnTo || '/app')}`);
    }
    try {
      const user = await auth.emailLogin(body.email || '', body.password || '', body.name || '');
      throttle.succeed(keys);
      if (!known) creditLanding(req, user, true, url);
      // Fire and forget: a provider outage must not stop someone signing in.
      if (!known) auth.sendVerification(user, config.publicBaseUrl || `https://${req.headers.host || ''}`).catch(() => {});
      const session = auth.createSession(user, { provider: 'email' });
      // A NEW account goes to the code screen, not the app. The confirmation
      // then happens where it makes sense -- while they are still thinking
      // about their email address -- instead of surfacing later as "imports
      // are blocked" in the middle of starting a lecture. An existing account
      // signing in is untouched, and so is a deployment that cannot send mail
      // (auth.isVerified is true for everyone there).
      if (!known && !auth.isVerified(user)) {
        return redirectWithCookies(res, `/verify?returnTo=${encodeURIComponent(body.returnTo || '/app')}`, auth.cookieHeaders(session));
      }
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) {
      throttle.fail(keys);
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }
  if (method === 'POST' && pathname === '/auth/password') {
    const body = await formBody(req);
    // One shared secret and no account to name, so this is the endpoint most
    // worth guessing at and the one that had nothing slowing it down.
    const keys = throttle.keysFor(clientIp(req), 'admin-password');
    const gate = throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(res, gate.retryAfterSec, body.returnTo);
    try {
      const user = await auth.passwordLogin(body.password || '');
      throttle.succeed(keys);
      const session = auth.createSession(user, { provider: 'password' });
      return redirectWithCookies(res, billing.postLoginRedirect(user, body.returnTo || '/app'), auth.cookieHeaders(session));
    } catch (error) {
      throttle.fail(keys);
      return redirect(res, `/login?error=${encodeURIComponent(error.message)}`);
    }
  }
  if (method === 'GET' && pathname === '/verify') {
    // Nothing to confirm without an account to confirm, and nothing to ask
    // someone who is already confirmed.
    if (!currentUser) return redirect(res, '/login?returnTo=%2Fapp');
    if (auth.isVerified(currentUser)) return redirect(res, '/app');
    return html(res, 200, auth.verifyPage({
      email: currentUser.email || '',
      error: url.searchParams.get('error') || '',
      info: url.searchParams.get('info') || '',
      returnTo: url.searchParams.get('returnTo') || '/app',
    }));
  }
  if (method === 'POST' && pathname === '/auth/verify-code') {
    const body = await formBody(req);
    const back = body.returnTo || '/app';
    if (!currentUser) return redirect(res, '/login?returnTo=%2Fapp');
    // Six digits is a million guesses. The record allows six attempts, and
    // this allows a burst of them per address and IP -- the same throttle the
    // sign-in door uses, so a script cannot spend somebody else's six for
    // them in a second.
    const keys = throttle.keysFor(clientIp(req), `verify:${currentUser.id}`);
    const gate = throttle.check(keys);
    if (!gate.allowed) return tooManyAttempts(res, gate.retryAfterSec, back);
    const result = auth.consumeVerificationCode(currentUser.id, body.code || '');
    if (result.ok) {
      throttle.succeed(keys);
      return redirect(res, billing.postLoginRedirect(result.user, back));
    }
    throttle.fail(keys);
    const said = result.reason === 'expired'
      ? 'That code has expired. Send another and try again.'
      : result.reason === 'spent'
        ? 'Too many wrong codes. Send another and try again.'
        : 'That code is not right. Check the email and try again.';
    return redirect(res, `/verify?error=${encodeURIComponent(said)}&returnTo=${encodeURIComponent(back)}`);
  }
  if (method === 'POST' && pathname === '/auth/verify-resend') {
    const body = await formBody(req);
    const back = body.returnTo || '/app';
    if (!currentUser) return redirect(res, '/login?returnTo=%2Fapp');
    // Resending mints a NEW code and retires the old one, which is also how a
    // person recovers from spending their six attempts. Rate-limited, or the
    // button is a way to have us mail somebody repeatedly.
    const again = throttle.rateLimit(`verify-send:${currentUser.id}`, 5, 60 * 60_000);
    if (!again.allowed) {
      return redirect(res, `/verify?error=${encodeURIComponent('We have sent several already. Check your spam folder, or try again later.')}&returnTo=${encodeURIComponent(back)}`);
    }
    await auth.sendVerification(currentUser, config.publicBaseUrl || `https://${req.headers.host || ''}`).catch(() => {});
    return redirect(res, `/verify?info=${encodeURIComponent('Sent. It can take a minute to arrive.')}&returnTo=${encodeURIComponent(back)}`);
  }
  if (method === 'GET' && pathname === '/auth/verify') {
    const confirmed = auth.consumeVerification(url.searchParams.get('token') || '');
    if (!confirmed) {
      return redirect(res, `/login?error=${encodeURIComponent('That confirmation link has expired or has already been used. Sign in and we will send another.')}`);
    }
    // Signed straight in: the link proves the address, and asking someone to
    // type a password immediately after proving it is friction for nothing.
    const session = auth.createSession(confirmed, { provider: 'email' });
    return redirectWithCookies(res, billing.postLoginRedirect(confirmed, '/app'), auth.cookieHeaders(session));
  }
  // Password reset. Until this existed, one forgotten password was a permanent
  // lockout: there was no route, no link and no token anywhere in the app.
  if (method === 'GET' && pathname === '/reset') {
    const raw = url.searchParams.get('token') || '';
    // A dead token is said so on arrival rather than after the person has typed
    // a new password and pressed save.
    if (raw && !auth.peekPasswordReset(raw)) {
      return html(res, 200, auth.resetPage({ error: 'That reset link has expired or has already been used. Ask for a new one below.' }));
    }
    return html(res, 200, auth.resetPage({
      token: raw,
      info: url.searchParams.get('sent') ? 'Check your inbox, including spam. The link works once and expires in an hour.' : '',
    }));
  }
  if (method === 'POST' && pathname === '/auth/forgot') {
    const body = await formBody(req);
    // Throttled on the address so the form cannot be used to bomb an inbox,
    // and on the caller so it cannot be walked across many addresses at speed.
    const target = String(body.email || '').trim().toLowerCase().slice(0, 200);
    const gate = throttle.rateLimit(`forgot:${target || clientIp(req)}`, 3, 60 * 60_000);
    const ipGate = throttle.rateLimit(`forgot-ip:${clientIp(req)}`, 15, 60 * 60_000);
    if (gate.allowed && ipGate.allowed) {
      await auth.requestPasswordReset(target, config.publicBaseUrl || `https://${req.headers.host || ''}`);
    }
    // The same answer either way, whether the address exists, has no password,
    // or was rate limited. Anything else turns this form into a way to find out
    // who has an account here.
    return redirect(res, '/reset?sent=1');
  }
  if (method === 'POST' && pathname === '/auth/reset') {
    const body = await formBody(req);
    try {
      const user = await auth.completePasswordReset(body.token, body.password);
      const session = auth.createSession(user, { provider: 'password' });
      return redirectWithCookies(res, '/app?reset=1', auth.cookieHeaders(session));
    } catch (error) {
      return html(res, 200, auth.resetPage({ token: String(body.token || ''), error: error.message }));
    }
  }
  if (method === 'POST' && pathname === '/auth/resend-verification') {
    if (!currentUser) return json(res, 401, { error: 'Sign in first.' });
    const gate = throttle.rateLimit(`verify:${currentUser.id}`, 5, 60 * 60_000);
    if (!gate.allowed) return json(res, 429, { error: 'Another confirmation was sent recently. Check your inbox, including spam.' });
    const sent = await auth.sendVerification(currentUser, config.publicBaseUrl || `https://${req.headers.host || ''}`);
    return json(res, 200, { ok: true, sent });
  }
  if (method === 'POST' && pathname === '/auth/logout-everywhere') {
    if (!currentUser) return json(res, 401, { error: 'Sign in first.' });
    const count = auth.destroyAllSessions(currentUser);
    return jsonWithCookies(res, 200, { ok: true, signedOut: count }, auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'POST' && pathname === '/auth/logout') {
    auth.destroySession(req);
    return redirectWithCookies(res, '/', auth.cookieHeaders('', { clear: true }));
  }
  if (method === 'GET' && pathname === '/marketing.css') {
    // The URL carries a content hash, so a request that names the CURRENT
    // hash can never be stale — that is the whole point of the hash, and an
    // hour's cache throws it away. A request with no hash or an old one gets
    // the short cache, because it might be a link somebody wrote by hand.
    const versioned = url.searchParams.get('v') === marketing.CSS_VERSION;
    return streamFile(req, res, marketingCssPage, {
      contentType: 'text/css; charset=utf-8',
      cacheControl: versioned ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    });
  }
  if (method === 'GET' && pathname === '/tool-widgets.js') {
    // The free tools' behaviour. A file, not an inline block: the CSP hashes
    // inline scripts from index.html only.
    return streamFile(req, res, path.join(config.root, 'src', 'public', 'tool-widgets.js'),
      { contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' });
  }
  if (method === 'GET' && pathname === '/marketing.js') {
    return streamFile(req, res, marketingJsPage, { contentType: 'text/javascript; charset=utf-8', cacheControl: 'public, max-age=3600' });
  }
  if (method === 'GET' && pathname.startsWith('/fonts/')) {
    // The bundled caption faces (see worker/fonts/NOTICE.md), so the editor
    // previews ayat in the exact face the render burns in.
    const name = path.basename(decodeURIComponent(pathname));
    const fontsDir = path.resolve(config.root, 'src', 'public', 'fonts');
    const file = path.resolve(fontsDir, name);
    if (!file.startsWith(fontsDir + path.sep) || !file.endsWith('.ttf') || !fs.existsSync(file)) {
      return json(res, 404, { error: 'Not found.' });
    }
    return streamFile(req, res, file, { contentType: 'font/ttf', cacheControl: 'public, max-age=604800, immutable' });
  }
  // Help centre screenshots. Their own route rather than the marketing one:
  // these are captures of the signed-in app, and keeping the two apart means a
  // marketing image can never be renamed into a help article by accident.
  if (method === 'GET' && pathname.startsWith('/help-assets/')) {
    const name = path.basename(decodeURIComponent(pathname));
    const dir = path.resolve(config.root, 'src', 'public', 'help-assets');
    const candidate = path.resolve(dir, name);
    if (!candidate.startsWith(dir + path.sep)) return json(res, 404, { error: 'Help asset not found.' });
    if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) return json(res, 404, { error: 'Help asset not found.' });
    const extension = path.extname(candidate).toLowerCase();
    const contentType = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png'
      : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    return streamFile(req, res, candidate, { contentType, cacheControl: 'public, max-age=86400' });
  }
  if (method === 'GET' && pathname.startsWith('/marketing-assets/')) {
    const name = path.basename(decodeURIComponent(pathname));
    let file = null;
    for (const dir of marketingAssetDirs) {
      const candidate = path.resolve(dir, name);
      // Keep the traversal guard: the resolved path must stay inside the
      // directory being searched.
      if (!candidate.startsWith(dir + path.sep)) continue;
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) { file = candidate; break; }
    }
    if (!file) return json(res, 404, { error: 'Marketing asset not found.' });
    const extension = path.extname(file).toLowerCase();
    const contentType = extension === '.webp' ? 'image/webp' : extension === '.png' ? 'image/png' : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.svg' ? 'image/svg+xml' : 'application/octet-stream';
    return streamFile(req, res, file, { contentType, cacheControl: 'public, max-age=86400' });
  }
  // Registry-driven SEO pages. One list drives routing, the sitemap and the
  // analytics allowlist, so a new page cannot ship routed-but-unlisted (or
  // listed-but-404) the way three hand-maintained lists allowed.
  // /r/CODE — an invite link.
  //
  // Sets a cookie holding the CODE and nothing else, then sends the visitor to
  // the page most likely to explain the product to someone a friend just told
  // about it. The code is validated at SIGN-UP rather than here: refusing an
  // unknown code at the door would tell a stranger which codes exist, and the
  // only thing a bad code can do downstream is fail to find a referrer.
  const invite = pathname.match(/^\/r\/([A-Za-z0-9]{1,16})$/);
  if (method === 'GET' && invite) {
    const secure = config.publicBaseUrl.startsWith('https://') ? '; Secure' : '';
    const prior = res.getHeader('Set-Cookie');
    // 30 days: long enough for someone to think about it over a weekend,
    // short enough that a stale code does not follow them for a year.
    const cookie = `dc_ref=${encodeURIComponent(referrals.normaliseCode(invite[1]))}; Max-Age=2592000; Path=/; SameSite=Lax; HttpOnly${secure}`;
    res.writeHead(302, {
      Location: '/islamic-video-clipper',
      'Set-Cookie': prior ? [].concat(prior, cookie) : [cookie],
      'Cache-Control': 'no-store',
    });
    return res.end();
  }

  // A trailing slash on a real page is somebody else's link, typed or pasted
  // that way. 404ing it avoids a duplicate URL and loses the visitor; a 301 to
  // the canonical form avoids the duplicate AND keeps them.
  if (method === 'GET' && pathname.length > 1 && pathname.endsWith('/')) {
    const withoutSlash = pathname.replace(/\/+$/, '');
    if (seoPages.pageFor(withoutSlash) || seoPages.RETIRED_PAGES[withoutSlash]) {
      res.writeHead(301, { Location: withoutSlash + url.search, 'Cache-Control': 'public, max-age=86400' });
      return res.end();
    }
  }
  // A retired page keeps its value by pointing at the page that absorbed it.
  // 301 and not 302: the move is permanent, and a temporary redirect tells
  // Google to keep the old URL in the index and keep asking.
  if (seoPages.RETIRED_PAGES[pathname]) {
    res.writeHead(301, { Location: seoPages.RETIRED_PAGES[pathname], 'Cache-Control': 'public, max-age=86400' });
    return res.end();
  }
  if (method === 'GET' && marketing.SEO_COPY[pathname]) {
    return html(res, 200, marketing.seoPage({
      ...marketingContext(req),
      page: seoPages.pageFor(pathname),
      copy: marketing.SEO_COPY[pathname],
    }));
  }

  if (method === 'GET' && pathname === '/features') return html(res, 200, featuresPage(req));
  if (method === 'GET' && pathname === '/pricing') return html(res, 200, pricingPage(req));
  if (method === 'GET' && pathname === '/contact') return html(res, 200, contactPage(req));
  if (method === 'GET' && pathname === '/privacy') return html(res, 200, privacyPage(req));
  if (method === 'GET' && pathname === '/terms') return html(res, 200, termsPage(req));
  if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    // Google OAuth verification must always see a public homepage here.
    // The logged-in product is served from /app so / is never hidden behind auth.
    return html(res, 200, marketingHome(req));
  }
  if (method === 'GET' && (pathname === '/app' || pathname === '/dashboard')) {
    return serveAppShell(req, res, url, currentUser);
  }

  // The owner surface lives INSIDE the studio now (the Owner tab), at
  // Youssef's instruction on 28 Aug 2026 — the /owner page swap read as the
  // app restarting. The old standalone page is gone entirely; its data
  // endpoints below are unchanged and stay operator-gated. /owner stays in
  // robots.txt's disallow list only because a shorter list is not worth a
  // resubmitted robots file.
  if (method === 'GET' && pathname === '/activity-fix.js') {
    if (!fs.existsSync(activityFixPage)) return json(res, 404, { error: 'Activity UI script not found.' });
    const body = fs.readFileSync(activityFixPage);
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  if (method === 'GET' && pathname === '/premium-dashboard.js') {
    if (!fs.existsSync(premiumDashboardPage)) return json(res, 404, { error: 'Premium dashboard script not found.' });
    const body = fs.readFileSync(premiumDashboardPage);
    res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'no-store' });
    return res.end(body);
  }
  // Studio dashboard assets. Static files are served by explicit route here, so a
  // new generated file is invisible until it is listed. See design/README.md.
  if (method === 'GET' && STUDIO_ASSETS[pathname]) {
    const asset = STUDIO_ASSETS[pathname];
    if (!fs.existsSync(asset.file)) return json(res, 404, { error: 'Studio asset not found. Run `npm run design:import`.' });
    const body = fs.readFileSync(asset.file);
    // no-cache (revalidate), not no-store (re-download): with a content ETag,
    // an unchanged asset costs a 304 instead of shipping ~700KB of JS on
    // every page load, while a deploy still takes effect immediately.
    const etag = `"${crypto.createHash('sha1').update(body).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache' });
      return res.end();
    }
    // Icons and the social card are content that does not change; the app
    // bundles do. A week on the former saves a conditional request from every
    // browser tab and every social scraper, and costs nothing because a change
    // to one is a deploy anyway.
    const stable = /\.(png|svg|ico|jpg|jpeg|webp)$/.test(pathname);
    res.writeHead(200, {
      'Content-Type': asset.type, 'Content-Length': body.length,
      'Cache-Control': stable ? 'public, max-age=604800' : 'no-cache', ETag: etag,
    });
    return res.end(body);
  }
  const oauthCallback = pathname.match(/^\/auth\/(youtube|meta|tiktok)\/callback$/);
  if (method === 'GET' && oauthCallback) {
    const provider = oauthCallback[1];
    try {
      // The account comes from the signed OAuth state, not from whoever holds
      // a session cookie when the callback lands.
      await social.completeOAuth(provider, url);
      return redirect(res, `/app?social=connected&provider=${encodeURIComponent(provider)}`);
    } catch (error) {
      console.error(error);
      return redirect(res, `/app?social=error&provider=${encodeURIComponent(provider)}&message=${encodeURIComponent(error.message)}`);
    }
  }
  const socialMedia = pathname.match(/^\/media\/social\/([^/]+)\.mp4$/);
  if (method === 'GET' && socialMedia) {
    const clipId = decodeURIComponent(socialMedia[1]);
    let allowed = false;
    try { allowed = social.verifyMediaSignature(clipId, url.searchParams.get('exp'), url.searchParams.get('sig')); } catch {}
    if (!allowed) return json(res, 403, { error: 'This media link is invalid or expired.' });
    const remoteClip = state.clips.find(item => item.id === clipId);
    if (remoteClip?.clipUrl) return temporaryRedirect(res, mediaUrl(remoteClip.clipUrl));
    const file = agent.engine.clipFilePath(clipId, 'video');
    return streamFile(req, res, file, { cacheControl: 'public, max-age=3600, immutable' });
  }
  // A wildcard /:name.txt route used to live here and served ANY .txt file in
  // the application directory to anyone, with no session. The narrow TikTok
  // route below is what it was there to do.
  // TikTok URL-prefix verification files are uploaded to the repository root.
  // Serve only root-level TikTok .txt verification files publicly.
  if (method === 'GET' && /^\/tiktok[^/]*\.txt$/i.test(pathname)) {
    const verificationName = path.basename(decodeURIComponent(pathname));
    const verificationFile = path.join(config.root, verificationName);
    if (!fs.existsSync(verificationFile) || !fs.statSync(verificationFile).isFile()) {
      return json(res, 404, { error: 'TikTok verification file not found.' });
    }
    const body = fs.readFileSync(verificationFile);
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    });
    return res.end(body);
  }

  // Import network settings, as a server-rendered page rather than a JSON API.
  // MUST stay above the non-/api catch-all below: this route first shipped
  // underneath it and was unreachable dead code answering the generic 404 --
  // indistinguishable, from the outside, from the operator lacking the role.
  // These get set exactly when URL imports are down and the operator's only
  // other tool is the Hetzner web console, which mangles the characters a
  // proxy URL is made of. A plain form in the browser has no such failure mode.
  if (pathname === '/admin/import-network') {
    // Signed out: to the login page, like every other page. Signed in without
    // the role: the masked 404. The two must stay distinguishable -- when this
    // route was dead code, its generic 404 was read as a role problem and the
    // real bug went unfound.
    if (!currentUser) return redirect(res, `/login?returnTo=${encodeURIComponent('/admin/import-network')}`);
    try { requireOperator(currentUser); } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
    if (method === 'POST') {
      const raw = await readRawBody(req, 2_000_000);
      const form = new URLSearchParams(raw);
      const proxy = String(form.get('proxy') || '').trim();
      const cookiesText = String(form.get('cookiesText') || '').trim();
      if (proxy) {
        let parsed;
        try { parsed = new URL(proxy); } catch { parsed = null; }
        if (!parsed || !['http:', 'https:', 'socks5:'].includes(parsed.protocol)) {
          return html(res, 400, importNetworkPage({ error: 'The proxy must be a full URL like http://user:pass@host:port' }));
        }
      }
      if (cookiesText && !/youtube\.com/.test(cookiesText)) {
        return html(res, 400, importNetworkPage({ error: 'That does not look like a YouTube cookies export — it has no youtube.com lines.' }));
      }
      // Empty means "keep what is saved": values are never echoed back into
      // the form, so an empty field on submit is almost always an untouched
      // one, and treating it as "clear" would wipe a credential the operator
      // could not see was there. Clearing is the explicit checkboxes.
      const update = {};
      if (proxy) update.proxy = proxy; else if (form.get('clearProxy')) update.proxy = '';
      if (cookiesText) update.cookiesText = cookiesText; else if (form.get('clearCookies')) update.cookiesText = '';
      setImportNetworkSettings(update);
      const describe = (value, cleared) => (value ? 'set' : cleared ? 'cleared' : 'kept');
      log(`Import network settings updated by ${currentUser.email || currentUser.id}: proxy ${describe(proxy, form.get('clearProxy'))}, cookies ${describe(cookiesText, form.get('clearCookies'))}.`, 'info');
      return html(res, 200, importNetworkPage({ saved: true }));
    }
    return html(res, 200, importNetworkPage({}));
  }

  if (method === 'GET' && pathname === '/robots.txt') {
    const body = Buffer.from(marketing.robots({ base: publicBase(req) }));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(body);
  }
  if (method === 'POST' && pathname === '/api/tool-event') {
    // The free-tool funnel: opened -> used -> clicked through. Signup and paid
    // already come from the landing cookie, so this closes the only gap.
    //
    // The event name is checked against a FIXED LIST rather than stored as
    // sent. This endpoint takes an unauthenticated POST from a stranger's
    // browser, and an arbitrary string used as a state key is how a JSON state
    // file becomes a denial-of-service. Nothing else in the body is read: no
    // identifier, no payload, no third-party call.
    const ALLOWED = new Set(['safezone_open', 'safezone_used', 'calculator_open', 'calculator_used', 'tool_cta_click']);
    try {
      // 2KB is generous for {"event":"…"}; the default megabyte is an
      // invitation on an unauthenticated route.
      const body = await readBody(req, 2048);
      const name = String(body?.event || '');
      if (ALLOWED.has(name)) metrics.event(name);
    } catch { /* a malformed beacon is simply not counted */ }
    // 204 regardless: a measurement endpoint must never tell a caller whether
    // its guess was on the list.
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (method === 'GET' && pathname === '/llms.txt') {
    const body = Buffer.from(marketing.llmsTxt({ base: publicBase(req) }));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(body);
  }
  if (method === 'GET' && pathname === '/sitemap.xml') {
    const body = Buffer.from(marketing.sitemap({ base: publicBase(req) }));
    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Length': body.length, 'Cache-Control': 'public, max-age=86400' });
    return res.end(body);
  }

  // A person who mistyped an address, or followed an old link, was handed
  // {"error":"Not found."} on a white page with no way back. API callers still
  // get JSON; browsers get a page.
  if (!pathname.startsWith('/api/')) {
    if (method === 'GET' && String(req.headers.accept || '').includes('text/html')) {
      // The broken-links card on the owner screen: a person or a crawler
      // followed a dead link to here. Counted before the page is served.
      try { metrics.missing(pathname); } catch { /* analytics never breaks a 404 */ }
      return html(res, 404, marketing.notFound(marketingContext(req)));
    }
    return json(res, 404, { error: 'Not found.' });
  }
  if (auth.enabled() && !currentUser) return json(res, 401, { error: 'Sign in to continue.', loginRequired: true });
  if (!auth.enabled() && !auth.sessionUser(req) && !authed(req, url)) return json(res, 401, { error: 'Wrong password.' });

  if (method === 'GET' && pathname === '/api/auth/me') return json(res, 200, { user: auth.userPublic(currentUser), auth: auth.publicConfig() });
  if (method === 'GET' && pathname === '/api/state') {
    const rev = stateRev();
    if (url.searchParams.get('rev') === rev) return json(res, 200, { unchanged: true, rev });
    {
      const payload = { ...appState(currentUser), rev };
      /*
       * Prices in the visitor's own currency, and only when Stripe really
       * holds them. plansInCurrency reads Stripe's currency_options and falls
       * back to the configured labels on any failure, so the worst case is
       * the Australian price -- never a converted guess, and never a number
       * the checkout will not honour. The currency travels too, because the
       * screen says which one it is charging in.
       */
      const currency = geo.currencyOf(req);
      if (currency !== geo.DEFAULT_CURRENCY && payload.billing) {
        try { payload.billing = { ...payload.billing, plans: await billing.plansInCurrency(currency) }; }
        catch { /* the configured labels stand */ }
      }
      if (payload.billing) payload.billing.currency = currency;
      return json(res, 200, payload);
    }
  }
  // The Privacy Policy has always promised erasure within 30 days by email --
  // a promise resting on one person's inbox. It is a button now.
  if (method === 'POST' && pathname === '/api/notifications/email') {
    if (!currentUser?.id) return json(res, 401, { error: 'Sign in first.' });
    const body = await readBody(req);
    state.userSettings[currentUser.id] = state.userSettings[currentUser.id] || {};
    state.userSettings[currentUser.id].emailNotifs = Boolean(body.on);
    save();
    return json(res, 200, { ok: true, emailNotifs: Boolean(body.on) });
  }
  /*
   * Web Push. The subscription is the preference: a browser that has one gets
   * notified with the app closed, a browser that does not, does not. There is
   * no separate stored flag to fall out of step with it.
   */
  if (method === 'POST' && pathname === '/api/push/subscribe') {
    if (!currentUser?.id) return json(res, 401, { error: 'Sign in first.' });
    if (!config.pushNotifsEnabled) return json(res, 503, { error: 'Push notifications are switched off on this server.' });
    const body = await readBody(req);
    try {
      // A push service can retire a subscription and hand the worker a fresh
      // one; without dropping the old endpoint the account keeps a row that
      // can never be delivered to and burns a soft-failure budget for ever.
      if (body.replaces) push.unsubscribe(currentUser.id, body.replaces);
      push.subscribe(currentUser.id, body.subscription, { device: deviceLabel(req) });
      return json(res, 200, { ok: true, devices: push.subscriptionsFor(currentUser.id).length });
    } catch (error) {
      return json(res, 400, { error: error.message });
    }
  }
  if (method === 'POST' && pathname === '/api/push/unsubscribe') {
    if (!currentUser?.id) return json(res, 401, { error: 'Sign in first.' });
    const body = await readBody(req);
    const removed = push.unsubscribe(currentUser.id, body.endpoint);
    return json(res, 200, { ok: true, removed, devices: push.subscriptionsFor(currentUser.id).length });
  }
  /*
   * Spending a one-time moment. Two of them: the first-clip celebration and
   * the automatic handoff into the review queue. Held on the ACCOUNT rather
   * than in the browser, because a first clip happens once to a person -- in
   * localStorage it would fire again on their phone, which turns a moment
   * into a nag.
   */
  if (method === 'POST' && pathname === '/api/onboarding/seen') {
    if (!currentUser?.id) return json(res, 401, { error: 'Sign in first.' });
    const body = await readBody(req);
    const what = String(body.what || '');
    if (!['firstClip', 'handoff'].includes(what)) return json(res, 400, { error: 'Unknown moment.' });
    if (onboarding.markSeen(state, currentUser.id, what)) save();
    return json(res, 200, { ok: true, onboarding: onboarding.journey(state, currentUser.id) });
  }
  /*
   * Claim one task-ladder reward.
   *
   * The rung is recomputed here from the account's own records, so the button
   * is not the check -- a request naming a rung this account has not reached is
   * refused whatever the screen was showing. The grant itself is keyed, so a
   * double-tap cannot pay twice.
   */
  if (method === 'POST' && pathname === '/api/tasks/claim') {
    if (!currentUser?.id) return json(res, 401, { error: 'Sign in first.' });
    const body = await readBody(req);
    const result = claimTaskReward(currentUser, body.id);
    if (result.error) return json(res, 400, { error: result.error });
    return json(res, 200, {
      ok: true, granted: result.granted, tokens: result.tokens,
      tasks: onboarding.tasks(state, currentUser.id, config, { unlimited: billing.isUnlimited(currentUser) }),
    });
  }
  if (method === 'DELETE' && pathname === '/api/account') {
    try {
      auth.deleteAccount(currentUser);
      return jsonWithCookies(res, 200, { ok: true }, auth.cookieHeaders('', { clear: true }));
    } catch (error) {
      return json(res, error.statusCode || 400, { error: error.message });
    }
  }
  if (method === 'GET' && pathname === '/api/billing') return json(res, 200, billing.publicBilling(currentUser));
  if (method === 'POST' && pathname === '/api/billing/estimate') {
    const body = await readBody(req);
    try { return json(res, 200, billing.estimateTokenCharge(currentUser, Number(body.minutes || body.sourceMinutes || 0))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createCheckoutSession(currentUser, String(body.plan || ''), geo.currencyOf(req))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/billing/topup-checkout') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.createTopupCheckoutSession(currentUser, String(body.package || ''))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  // The second net under a purchase. The browser calls this the moment it
  // lands back from Stripe, so a plan arrives even when the webhook does not.
  if (method === 'POST' && pathname === '/api/billing/confirm') {
    const body = await readBody(req);
    try { return json(res, 200, await billing.confirmCheckoutSession(currentUser, String(body.sessionId || ''))); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  // Cancelling is a write against Stripe, so it goes through the same POST
  // shape as checkout rather than being a link the browser follows.
  if (method === 'POST' && (pathname === '/api/billing/cancel' || pathname === '/api/billing/resume')) {
    try {
      return json(res, 200, await billing.setCancelAtPeriodEnd(currentUser, pathname.endsWith('/cancel')));
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/billing/portal') {
    try { return json(res, 200, await billing.createPortalSession(currentUser)); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/admin/analytics') {
    try { requireOperator(currentUser); return json(res, 200, admin.analytics(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/owner/webmetrics') {
    const days = Number(url.searchParams.get('days') || 30);
    try {
      requireOperator(currentUser);
      const summary = metrics.summary({ days });
      // The landing rows leave metrics.js with counts and rates; the money is
      // joined on here, because revenue lives on the account rather than in
      // the analytics buckets.
      summary.landingPages = owner.landingPerformance(state, summary.landingPages || []);
      return json(res, 200, summary);
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/owner/finance') {
    // Clamped rather than trusted: an unbounded day count is an unbounded
    // number of Stripe pages, on a route one request can hold open.
    const days = Math.min(365, Math.max(30, Number(url.searchParams.get('days')) || 180));
    try { requireOperator(currentUser); return json(res, 200, await owner.finance(currentUser, { days })); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/referral') {
    // The signed-in customer's own invite link and what it has produced.
    // Scoped to the caller by construction: it reads `currentUser` and never
    // takes an id from the request.
    if (!currentUser) return json(res, 401, { error: 'Sign in first.' });
    if (!config.referralsEnabled) return json(res, 200, { enabled: false });
    const code = referrals.codeFor(state, currentUser);
    save();
    const stats = referrals.statsFor(state, currentUser);
    return json(res, 200, {
      enabled: true,
      // Falls back to the request's own origin: a relative path in a
      // copy-this-link box is not a link, and a deployment without
      // PUBLIC_BASE_URL set would have handed out one.
      url: `${publicBase(req)}/r/${code}`,
      ...stats,
      // Stated so the page cannot imply a reward that is switched off.
      rewards: {
        invitedMinutes: config.referralBonusInvited,
        activatedMinutes: config.referralBonusActivated,
        paidMinutes: config.referralBonusPaid,
      },
      // The discount is only real if a Stripe coupon is configured. Without
      // one the panel must not promise a percentage nobody will receive.
      discount: config.stripeReferralCoupon
        ? { ...referrals.discountsLeft(state, currentUser, config.referralDiscountMaxUses),
            ...(await billing.referralCouponSummary() || { label: '' }) }
        : null,
    });
  }
  if (method === 'GET' && pathname === '/api/owner/growth') {
    try {
      requireOperator(currentUser);
      settleReferralRewards();
      return json(res, 200, growth.report(state, metrics.summary({ days: Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 30)) })));
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/integrity') {
    // Owner only, and read-only by construction: auditFinance never writes.
    // It exists because fixing the userBySubscription comparison did not fix
    // the rows that comparison had already written.
    try {
      requireOperator(currentUser);
      const known = new Set(seoPages.indexablePages().map(page => page.path));
      return json(res, 200, financeAudit.auditFinance(state, known));
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/health') {
    // Clamped for the same reason as finance: the window decides how much
    // state is walked, and an unbounded one is a request that holds the loop.
    const days = Math.min(90, Math.max(1, Number(url.searchParams.get('days')) || 7));
    try {
      requireOperator(currentUser);
      const health = owner.pipelineHealth(currentUser, { days });
      // The worker's own view sits beside the app's. They can disagree -- the
      // app records a job it never managed to hand over -- and that difference
      // is itself the diagnosis, so neither is allowed to stand in for the other.
      const worker = await workerClient.health().catch(error => ({ error: error.message }));
      // Which release the box is ACTUALLY running, against this one. A worker
      // left on old code -- committed, green, pushed, not deployed -- has cost
      // this project weeks twice, and nothing on any screen could say so. A
      // worker that reports no version at all is itself the answer: it predates
      // the build that started reporting one.
      const workerVersion = String(worker?.capabilities?.version || '');
      const deploy = {
        appVersion: config.appVersion,
        workerVersion: workerVersion || null,
        behind: Boolean(config.appVersion) && workerVersion !== config.appVersion,
        note: !worker || worker.error ? 'The worker could not be reached, so its version is unknown.'
          : !workerVersion ? 'This worker predates version reporting, so it is running code older than v3.26.0. Deploy the box.'
            : workerVersion === config.appVersion ? 'The box is running this release.'
              // Says what it KNOWS rather than what it assumes. Most releases
              // touch src/ only, so a version gap usually means nothing: on
              // 30 Aug the box read v3.42.0 against an app on v3.49.1 and was
              // completely current, because no worker/ change had shipped in
              // between. The old wording read as "deploy the box now" and
              // would have bought a pointless rebuild.
              : `The box reports v${workerVersion} and this app is v${config.appVersion}. `
                + `That only matters if worker code changed in between, which most releases do not. `
                + `Check with: git log v${workerVersion}..HEAD -- worker/`,
      };
      return json(res, 200, { ...health, worker, deploy });
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/costs') {
    try {
      requireOperator(currentUser);
      return json(res, 200, { costs: owner.costs(currentUser), cadences: owner.CADENCES, categories: owner.COST_CATEGORIES });
    } catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/owner/costs') {
    const body = await readBody(req);
    try { requireOperator(currentUser); return json(res, 200, { cost: owner.upsertCost(currentUser, body) }); }
    catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/owner/spend') {
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 90));
    try { requireOperator(currentUser); return json(res, 200, owner.spend(currentUser, { days })); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/owner/spend') {
    const body = await readBody(req);
    try {
      requireOperator(currentUser);
      // Accepts one payment or a batch, because the thing that writes here is
      // a sync over a mailbox, and a sync that can only post one row at a time
      // is a sync nobody runs twice.
      const entries = Array.isArray(body.entries) ? body.entries : [body];
      const results = entries.map(entry => owner.recordSpend(currentUser, entry));
      return json(res, 200, {
        recorded: results.filter(item => !item.duplicate).length,
        skipped: results.filter(item => item.duplicate).length,
        results,
      });
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
  const ownerSpendDelete = pathname.match(/^\/api\/owner\/spend\/([\w-]+)$/);
  if (method === 'DELETE' && ownerSpendDelete) {
    try { requireOperator(currentUser); return json(res, 200, { removed: owner.removeSpend(currentUser, ownerSpendDelete[1]) }); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  const ownerCostDelete = pathname.match(/^\/api\/owner\/costs\/([\w-]+)$/);
  if (method === 'DELETE' && ownerCostDelete) {
    try { requireOperator(currentUser); return json(res, 200, { removed: owner.removeCost(currentUser, ownerCostDelete[1]) }); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }


  const socialConnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/connect$/);
  if (method === 'POST' && socialConnect) {
    try { return json(res, 200, { url: social.oauthStartUrl(socialConnect[1], currentUser?.id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialDisconnect = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/disconnect$/);
  if (method === 'POST' && socialDisconnect) {
    try {
      const body = await readBody(req).catch(() => ({}));
      await social.disconnect(socialDisconnect[1], currentUser, String(body?.accountId || ''));
      return json(res, 200, { ok: true });
    }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const socialTest = pathname.match(/^\/api\/social\/(youtube|meta|tiktok)\/test$/);
  if (method === 'POST' && socialTest) {
    const body = await readBody(req);
    try { return json(res, 200, { ok: true, result: await social.testConnection(socialTest[1], String(body.accountId || ''), currentUser), social: social.connectionStatus(currentUser) }); }
    catch (error) { return json(res, 400, { error: error.message, social: social.connectionStatus(currentUser) }); }
  }
  if (method === 'POST' && pathname === '/api/publishing-settings') {
    const body = await readBody(req);
    try {
      const current = publishingSettings(currentUser);
      // How many accounts this plan may publish to on one platform. Enforced
      // here, at the HTTP boundary, because a limiter the route does not cross
      // protects nothing -- and refused rather than silently truncated, so
      // someone who picks four Pages is told why instead of quietly losing one.
      const capAccounts = (provider, supplied) => {
        if (!Array.isArray(supplied)) return undefined;
        const ids = [...new Set(supplied.map(value => String(value || '')).filter(Boolean))];
        const allowed = billing.accountsPerPlatform(currentUser, provider);
        if (ids.length > allowed) {
          throw new Error(allowed === 1
            ? `Your plan can post to one ${provider} account. Studio can post to ${config.accountsPerPlatformStudio} on the platforms that support it.`
            : `Your plan can post to ${allowed} ${provider} accounts at once.`);
        }
        return ids;
      };
      const withCap = (provider, incoming) => {
        const ids = capAccounts(provider, incoming?.accountIds);
        if (ids === undefined) return incoming;
        // accountId is derived here, not left to the store's normalisation:
        // validatePublishingSettings runs on THIS object, before it is saved,
        // and reads accountId to check the destination is connected. A save
        // carrying only the list -- which is what the account picker sends --
        // was refused with "Choose a connected account" for accounts that were
        // connected all along.
        return { ...incoming, accountIds: ids, accountId: ids[0] || '' };
      };
      const next = {
        // Retired, and stored true so the record on disk says what the reader
        // reports. `body.enabled` is deliberately ignored: the only control
        // that ever sent false is the legacy dashboard's checkbox, which no
        // studio user has ever seen, and honouring it here would put an
        // account straight back into "Automatic publishing is off" with no
        // way out. Where a clip goes is the per-platform ticks below; whether
        // it goes at all is the approval. See store.publishingSettings.
        enabled: true,
        // What a clip does when a platform has more than one channel on it:
        // 'all' posts it to every one (the default, and what every record
        // written before this holds), 'rotate' gives each clip to one of them
        // in turn. Coerced to the two known values rather than stored as sent
        // -- an unrecognised mode reaching the publish path would silently
        // become "all" anyway, and this says so at the door.
        spread: body.spread === 'rotate' ? 'rotate' : 'all',
        youtube: { ...current.youtube, ...withCap('youtube', body.youtube || {}), enabled: Boolean(body.youtube?.enabled) },
        instagram: { ...current.instagram, ...withCap('instagram', body.instagram || {}), enabled: Boolean(body.instagram?.enabled), shareToFeed: body.instagram?.shareToFeed !== false },
        facebook: { ...current.facebook, ...withCap('facebook', body.facebook || {}), enabled: Boolean(body.facebook?.enabled) },
        tiktok: {
          ...current.tiktok, ...withCap('tiktok', body.tiktok || {}), enabled: Boolean(body.tiktok?.enabled),
          // Rebuilt key by key rather than spread through. This arrives from a
          // customer's browser and lands in stored settings that the publish
          // path reads, so an unknown key or a truthy string must not survive
          // into a TikTok declaration nobody made.
          accountOptions: tiktokAccountOptions(body.tiktok?.accountOptions),
          allowComments: body.tiktok?.allowComments !== false,
          allowDuet: Boolean(body.tiktok?.allowDuet), allowStitch: Boolean(body.tiktok?.allowStitch),
          // Coerced rather than spread through: a sub-option arriving true with
          // the parent off would post a declaration the creator never made.
          commercialContent: Boolean(body.tiktok?.commercialContent),
          yourBrand: Boolean(body.tiktok?.commercialContent) && Boolean(body.tiktok?.yourBrand),
          brandedContent: Boolean(body.tiktok?.commercialContent) && Boolean(body.tiktok?.brandedContent),
        },
      };
      // Connecting TikTok cannot switch it on, because its guidelines forbid a
      // default audience and an enabled destination without one would queue
      // posts that fail. It is marked at connect time instead, and this is the
      // moment it becomes possible: the first save that carries an audience.
      // Cleared either way, so turning it off later stays off.
      if (next.tiktok.enableWhenReady && String(next.tiktok.privacy || '') && !body.tiktok?.enabled) {
        next.tiktok.enabled = true;
      }
      if (String(next.tiktok.privacy || '')) next.tiktok.enableWhenReady = false;
      social.validatePublishingSettings(next, currentUser);
      if (next.facebook.enabled && clipSettings(currentUser).clipMaxSeconds > 60) {
        throw new Error('Facebook Reels currently requires clips of 60 seconds or less. Set Maximum seconds to 60 before enabling Facebook.');
      }
      setPublishingSettings(currentUser, next);
      // Names the destinations, because that is the half a save can change now.
      const destinations = ['youtube','instagram','facebook','tiktok'].filter(provider => next[provider].enabled);
      log(destinations.length
        ? `Posting to ${destinations.join(', ')}.`
        : 'No destinations are switched on, so nothing will post.', 'info', currentUser.id);
      agent.tick().catch(() => {});
      return json(res, 200, { ok: true, settings: publishingSettings(currentUser), social: social.connectionStatus(currentUser) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/source-info') {
    const body = await readBody(req);
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    // Each URL costs a live YouTube Data API call against one shared key and a
    // daily quota. Eight per request with nothing counting them meant a few
    // hundred scripted requests could burn the whole day's allowance -- for
    // every account at once, since the key is the product's, not the user's.
    const lookups = throttle.rateLimit(`sourceinfo:${currentUser.id}`, 120, 60 * 60_000);
    if (!lookups.allowed) {
      res.setHeader('Retry-After', String(lookups.retryAfterSec));
      return json(res, 429, { error: 'Too many link previews in the last hour. Try again shortly.' });
    }
    const sources = [];
    for (const source of urls.slice(0, 8)) {
      const cached = sourceInfoCache.get(source);
      if (cached && cached.until > Date.now()) { sources.push(cached.value); continue; }
      try {
        const info = await agent.sourceInfo(source);
        // A lecture's title and length do not change; a short cache turns a
        // pasted-and-repasted link into one call instead of many.
        sourceInfoCache.set(source, { value: info, until: Date.now() + 10 * 60_000 });
        if (sourceInfoCache.size > 500) {
          for (const [key, entry] of sourceInfoCache) if (entry.until < Date.now()) sourceInfoCache.delete(key);
        }
        sources.push(info);
      }
      catch (error) { sources.push({ url: source, title: source, durationSec: null, thumbnail: '', error: error.message }); }
    }
    const durations = sources.map(item => Number(item.durationSec)).filter(value => Number.isFinite(value) && value > 0);
    return json(res, 200, {
      ok: true,
      sources,
      known: durations.length === sources.length,
      totalDurationSec: durations.reduce((sum, value) => sum + value, 0),
    });
  }

  if (method === 'POST' && pathname === '/api/uploads/presign') {
    const body = await readBody(req);
    // A signed URL is a licence to write into the bucket, and this handed out
    // an unlimited number of them. The content type is no longer taken from
    // the caller at all -- it is derived from the extension.
    const gate = throttle.rateLimit(`presign:${currentUser.id}`, 60, 60 * 60_000);
    if (!gate.allowed) {
      res.setHeader('Retry-After', String(gate.retryAfterSec));
      return json(res, 429, { error: 'Too many uploads started in the last hour. Try again shortly.' });
    }
    try {
      const upload = objectStorage.createUpload(currentUser.id, String(body.fileName || ''), Number(body.size));
      return json(res, 200, { ok: true, ...upload });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/videos') {
    const body = await readBody(req);
    if (body.objectKey) {
      try {
        assertVerified(currentUser);
        const objectKey = assertStorageObjectKey(body.objectKey);
        // The key shape is checked above; this checks it is *this* account's
        // upload, so one tenant cannot submit another tenant's file.
        if (!objectKey.startsWith(objectStorage.uploadPrefixFor(currentUser.id))) throw new Error('The uploaded video reference is outside the permitted storage area.');
        // templateId / musicEnabled / musicTrackId travel on the URL branch
        // below and were dropped here, so an uploaded MP4 silently ignored the
        // Clip Style that was picked and fell back to the account default.
        const projectId = await agent.submitVideo(objectKey, body.title || body.fileName || '', currentUser.id, {
          templateId: String(body.templateId || ''),
          musicEnabled: body.musicEnabled !== false,
          musicTrackId: String(body.musicTrackId || ''),
          language: String(body.language || ''),
          backgroundMode: body.backgroundMode, backgroundId: body.backgroundId, introSeconds: body.introSeconds,
          publishTo: Array.isArray(body.publishTo) ? body.publishTo : null,
          sourceKind: 'object_storage', originalFileName: body.fileName || '', displayUrl: `Uploaded file · ${body.fileName || 'video'}`,
          sourceMeta: { title: body.title || body.fileName || '', durationSec: Number(body.durationSec || 0) || null, thumbnail: '' },
          sourceRange: { startSec: Number(body.sourceStartSeconds || 0), endSec: Number(body.sourceEndSeconds) || null },
        });
        return json(res, 201, { ok: true, projectId });
      } catch (error) { return json(res, 400, { error: error.message }); }
    }
    const urls = String(body.urls || '').split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!urls.length) return json(res, 400, { error: 'Paste at least one video link.' });
    try { assertVerified(currentUser); }
    catch (error) { return json(res, error.statusCode || 403, { error: error.message, needsVerification: true }); }
    const sourceStartSeconds = Math.max(0, Math.round(Number(body.sourceStartSeconds || 0)));
    const sourceEndRaw = Number(body.sourceEndSeconds);
    const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
    if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) return json(res, 400, { error: 'Choose at least 30 seconds of source video.' });
    const sourceRange = { startSec: sourceStartSeconds, endSec: sourceEndSeconds };
    const sourceMeta = Array.isArray(body.sourceMeta) ? body.sourceMeta : [];
    const results = [];
    for (const source of urls) {
      try { results.push({ url: source, ok: true, projectId: await agent.submitVideo(source, body.title || '', currentUser.id, { sourceRange, sourceMeta, idempotencyKey: body.idempotencyKey, musicEnabled: body.musicEnabled !== false, musicTrackId: String(body.musicTrackId || ''), templateId: String(body.templateId || ''), backgroundMode: body.backgroundMode, backgroundId: body.backgroundId, introSeconds: body.introSeconds, language: String(body.language || ''), publishTo: Array.isArray(body.publishTo) ? body.publishTo : null }) }); }
      catch (error) { results.push({ url: source, error: error.message }); }
    }
    return json(res, 200, { results, sourceRange });
  }

  if (method === 'POST' && pathname === '/api/video-uploads') {
    if (config.processingMode === 'remote') {
      return json(res, 409, { error: 'Large videos upload directly to secure object storage. Refresh the app and try Upload MP4 again.', directUploadRequired: true });
    }
    let upload = null;
    try {
      upload = await saveVideoUpload(req, currentUser.id);
      const sourceStartSeconds = Math.max(0, Math.round(Number(req.headers['x-source-start-seconds'] || 0)));
      const sourceEndRaw = Number(req.headers['x-source-end-seconds']);
      const sourceEndSeconds = Number.isFinite(sourceEndRaw) && sourceEndRaw > sourceStartSeconds ? Math.round(sourceEndRaw) : null;
      if (sourceEndSeconds !== null && sourceEndSeconds - sourceStartSeconds < 30) throw new Error('Choose at least 30 seconds of source video.');
      const durationSec = Math.max(0, Math.round(Number(req.headers['x-source-duration-seconds'] || 0)));
      const projectId = await agent.submitVideo(upload.filePath, upload.title, currentUser.id, {
        backgroundMode: String(req.headers['x-background-mode'] || ''), backgroundId: String(req.headers['x-background-id'] || ''), introSeconds: Number(req.headers['x-intro-seconds'] || 0),
        publishTo: String(req.headers['x-publish-to'] || '').split(',').map(v => v.trim()).filter(Boolean).length
          ? String(req.headers['x-publish-to']).split(',').map(v => v.trim()).filter(Boolean) : null,
        language: String(req.headers['x-source-language'] || ''),
        sourceRange: { startSec: sourceStartSeconds, endSec: sourceEndSeconds },
        sourceMeta: { title: upload.title, durationSec: durationSec || null, thumbnail: '' },
        sourceKind: 'upload', originalFileName: upload.fileName, uploadedInputFile: upload.filePath,
        displayUrl: `Uploaded file · ${upload.fileName}`,
      });
      return json(res, 201, { ok: true, projectId, fileName: upload.fileName, size: upload.size });
    } catch (error) {
      if (upload?.filePath) removeUploadedFile(upload.filePath);
      return json(res, error.statusCode || 400, { error: error.message });
    }
  }

  const projectRetry = pathname.match(/^\/api\/projects\/([^/]+)\/retry$/);
  if (method === 'POST' && projectRetry) {
    try { const id = decodeURIComponent(projectRetry[1]); assertCanAccessProject(currentUser, id); return json(res, 200, { ok: true, project: agent.engine.retryProject(id) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMore = pathname.match(/^\/api\/projects\/([^/]+)\/more-clips$/);
  if (method === 'POST' && projectMore) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(projectMore[1]); assertCanAccessProject(currentUser, id);
      const job = agent.engine.queueMoreClips(id, Number(body.count || 8));
      return json(res, 202, { ok: true, job });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)$/);
  // The Happening-now rows' own controls: remove a job from the queue, or
  // move a queued one to the front. Ownership is checked per kind -- a render
  // belongs to whoever owns its clip, everything else to the project owner.
  if (method === 'POST' && (pathname === '/api/queue/cancel' || pathname === '/api/queue/prioritize')) {
    const body = await readBody(req);
    const kind = String(body.kind || 'project');
    const id = String(body.id || '');
    try {
      if (kind === 'render') {
        const job = state.rerenderJobs.find(item => item.id === id);
        if (!job) throw new Error('That render is no longer in the queue.');
        assertCanAccessClip(currentUser, job.clipId);
      } else {
        assertCanAccessProject(currentUser, id);
      }
      const item = pathname.endsWith('/cancel')
        ? agent.engine.cancelWork(kind, id)
        : agent.engine.prioritizeWork(kind, id);
      return json(res, 200, { ok: true, status: item.status || null });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'DELETE' && projectMatch) {
    try { const id = decodeURIComponent(projectMatch[1]); assertCanAccessProject(currentUser, id); agent.engine.deleteProject(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/templates') return json(res, 200, { templates: templates.listTemplates(currentUser), selectedTemplate: templates.selectedTemplate(currentUser), draft: templates.defaultTemplateDraft() });
  if (method === 'POST' && pathname === '/api/templates') {
    // The editor's Save posts here when the open template is built in -- a
    // holdover from when built-ins were read-only and Save had to mint a copy.
    // Copies are gone (one template per content type), and built-ins take
    // per-account edits now, so this saves onto the template the draft came
    // from. Refusing here made the editor's Save button an error message.
    const body = await readBody(req);
    try {
      const draft = body.template || body;
      const byName = templates.listTemplates(currentUser).find(item => item.name === String(draft.name || '').trim());
      let target = templates.templateById(String(draft.id || ''), currentUser) || byName;
      if (!target && body.select === false) {
        // No identity and no intent to select: this is the old "mint a copy"
        // shape (the Duplicate buttons). Copies are gone, one template per
        // content type -- refuse rather than overwrite a template it never named.
        return json(res, 400, { error: 'One template per content type — edit the template directly; copies are no longer created.' });
      }
      target = target || templates.selectedTemplate(currentUser);
      if (!target?.id) return json(res, 400, { error: 'There is no template to save onto.' });
      // The PUT route has always checked this; POST did not, so saving a draft
      // with the watermark blanked through this door removed it on a free plan
      // -- one of exactly two things the product charges for.
      assertWatermarkAllowed(draft, target.id);
      const saved = templates.saveTemplate(currentUser, target.id, draft);
      if (body.select !== false) templates.setSelectedTemplate(currentUser, target.id);
      log(`Saved template "${saved.template.name}" version ${saved.template.version}. New renders use it automatically.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template: saved.template, propagation: { queued: 0, skipped: 0, errors: [] } });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  // No duplicate route: templates.duplicateTemplate throws unconditionally
  // because the product is one template per content type. The function stays
  // as a guard against minting -- see test/templates.test.mjs -- but nothing
  // is exposed that can only ever answer with its refusal.
  // Publishing without the DeenClipped watermark is a paid feature. The gate
  // sits on the two style write paths, not in sanitiseTemplate, because the
  // sanitiser cannot know who is asking. Only an EXPLICIT empty watermark is
  // blocked -- absent fields and non-empty text pass untouched.
  function assertWatermarkAllowed(style, templateId) {
    if (!style || typeof style !== 'object') return;
    /*
     * The scripture template is the one exemption, and it has to be. Nothing
     * is drawn over the top of an ayah -- no watermark, no brand line, no hook
     * -- which is why it ships with an empty watermark at zero opacity. That
     * cost nothing while the template was Pro-only; the moment Basic could
     * select it (Youssef, 3 Sept 2026: "quran recitation should allow basic
     * plans as well so one quran one lecture") this gate would have refused a
     * free account the ability to SAVE the template it had just been given.
     *
     * It is read from the SHIPPED file, so an account cannot mint an exemption
     * by switching an ordinary template into quran caption mode. A free
     * account's Quran clips still carry the credit line in their caption
     * (postCredit, v3.79.0) -- the attribution moves, it does not disappear.
     */
    if (templates.isScriptureTemplate(templateId)) return;
    // Emptying the text and zeroing the opacity are the same act -- a clip
    // with no visible watermark -- so the gate covers both doors.
    // visibleText rather than trim(). trim() removes whitespace and nothing
    // else, so a watermark of one zero-width space walked straight through
    // this gate and rendered as nothing — the paid feature, taken for free.
    const wantsNone = ('watermark' in style && templates.visibleText(style.watermark) === '')
      || ('watermarkOpacity' in style && Number(style.watermarkOpacity) <= 0);
    if (!wantsNone) return;
    if (billing.isPaid(currentUser)) return;
    throw new Error('Removing the DeenClipped watermark is a Pro feature. Upgrade to any paid plan to publish without it.');
  }

  // Which templates a plan may actually use. Free gets the default one; every
  // other built-in is Pro. Blocked here at the door rather than only at render
  // time so the account is told why, instead of quietly getting a clip in a
  // style it did not pick. The render still enforces it too -- a subscription
  // can lapse between queueing a job and rendering it.
  function assertTemplateAllowed(template) {
    if (!template?.pro) return template;
    if (billing.isPaid(currentUser)) return template;
    throw new Error(`"${template.name}" is a Pro template. The ${templates.templateById(config.defaultTemplateId, currentUser)?.name || 'default'} style is included on the free plan; any paid plan unlocks the rest.`);
  }

  /*
   * The two brand switches belong to the ACCOUNT, not to a caption style, so
   * they have a route of their own and no template is saved. Youssef, 3 Sept
   * 2026: "it just works with all templates once on it turns on for all ...
   * you don't need to click save the template."
   *
   * The paywall is the SAME function the template route uses -- one gate, so
   * removing the mark cannot become free by arriving through a second door.
   * There is no templateId here because the setting is not about a template;
   * '' never matches a scripture template, so the exemption cannot be claimed
   * from this route.
   */
  if (method === 'POST' && pathname === '/api/brand') {
    let body; try { body = await readBody(req); } catch { body = {}; }
    try {
      assertWatermarkAllowed(body, '');
      const saved = templates.setBrandSettings(currentUser, body);
      return json(res, 200, { ok: true, brand: saved, templates: templates.listTemplates(currentUser), selectedTemplate: templates.selectedTemplate(currentUser) });
    } catch (error) { return json(res, 402, { error: error.message }); }
  }
  const templateMatch = pathname.match(/^\/api\/templates\/([^/]+)$/);
  if (method === 'PUT' && templateMatch) {
    const body = await readBody(req);
    try {
      // Editing a built-in forks it onto the user's own copy rather than
      // refusing, so Save always means save. `forked` travels back so the page
      // can say which template it actually saved.
      assertWatermarkAllowed(body.template || body, decodeURIComponent(templateMatch[1]));
      const saved = templates.saveTemplate(currentUser, decodeURIComponent(templateMatch[1]), body.template || body);
      const template = saved.template;
      // Re-rendering every unposted clip is explicit now. It used to fire on any
      // field write, and the editor's sliders write on every `input` event, so
      // dragging one slider queued a re-render per clip per pixel -- each of
      // which re-downloads the whole source on a single-slot worker.
      //
      // The sweep itself is scoped to clips *using this template*, so it no
      // longer also requires the template to be the selected one -- that gate
      // made "save and re-render" silently do nothing whenever the clip's
      // template differed from the account default.
      const propagation = body.propagate === true
        ? queueTemplateForEveryUnpostedClip(template, currentUser, 'saving the template', String(body.propagateProjectId || ''))
        : { queued: 0, skipped: 0, errors: [] };
      log(saved.forked
        ? `"${saved.from}" is built in, so your changes were saved to "${template.name}" and it is now selected.`
        : `Saved template "${template.name}" version ${template.version}. New renders use it automatically.`,
      'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation, forked: saved.forked, forkedFrom: saved.from });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'DELETE' && templateMatch) {
    try { templates.deleteTemplate(currentUser, decodeURIComponent(templateMatch[1])); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/templates/apply-all') {
    const body = await readBody(req);
    const template = templates.templateById(String(body.templateId || ''), currentUser) || templates.selectedTemplate(currentUser);
    if (!template?.id) return json(res, 400, { error: 'Choose a valid saved template.' });
    try { assertTemplateAllowed(template); }
    catch (error) { return json(res, 402, { error: error.message, upgrade: true }); }
    let queued = 0; let skipped = 0; const errors = [];
    for (const clip of ownedBy(state.clips, currentUser.id)) {
      if (clip.variantOf) { skipped += 1; continue; }
      // Same rule as saving a template: only clips still awaiting a decision.
      if (clip.status !== 'waiting') { skipped += 1; continue; }
      try {
        agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false, priority: 2 });
        queued += 1;
      } catch (error) {
        skipped += 1; errors.push({ clipId: clip.id, error: error.message });
      }
    }
    log(`Applied template "${template.name}" to ${queued} existing clips; ${skipped} skipped.`, 'info', currentUser.id);
    return json(res, 202, { ok: true, queued, skipped, errors: errors.slice(0, 20), template });
  }

  if (method === 'POST' && pathname === '/api/template') {
    // Selection is a default for future renders, nothing more. The dashboard
    // posts here on every job submission, and this used to queue a re-render
    // of every unposted clip already on the template -- so submitting one new
    // lecture re-rendered the whole backlog, charged. Re-rendering existing
    // clips stays explicit: /api/templates/apply-all or a template save with
    // propagate: true.
    const body = await readBody(req);
    try {
      assertTemplateAllowed(templates.templateById(String(body.id || ''), currentUser));
      const template = templates.setSelectedTemplate(currentUser, String(body.id || ''));
      log(`Automation template set to "${template.name}". New renders use it.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, template, propagation: { queued: 0, skipped: 0, errors: [] } });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/clip-settings') {
    const body = await readBody(req); const count = Math.round(Number(body.clipsPerVideo));
    const minimum = Math.round(Number(body.clipMinSeconds)); const maximum = Math.round(Number(body.clipMaxSeconds));
    if (!Number.isFinite(count) || count < 1 || count > 30) return json(res, 400, { error: 'Clips per video must be between 1 and 30.' });
    if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || minimum < 3 || maximum > 180 || minimum >= maximum) return json(res, 400, { error: 'Choose a valid clip range between 3 and 180 seconds.' });
    // More than one length preset may be picked; each band is a [min,max]
    // pair inside the envelope the two fields above already carry.
    let bands = [];
    if (Array.isArray(body.clipLengthBands)) {
      bands = body.clipLengthBands
        .map(pair => [Math.round(Number(pair?.[0])), Math.round(Number(pair?.[1]))])
        .filter(([lo, hi]) => Number.isFinite(lo) && Number.isFinite(hi) && lo >= 3 && hi <= 180 && lo < hi)
        .slice(0, 6);
    }
    setClipSettings(currentUser, { clipsPerVideo: count, clipMinSeconds: minimum, clipMaxSeconds: maximum, clipLengthBands: bands });
    return json(res, 200, { ok: true, clipSettings: clipSettings(currentUser) });
  }
  if (method === 'POST' && pathname === '/api/automation-settings') {
    const body = await readBody(req);
    const clean = {
      enabled: Boolean(body.enabled), minimumScore: Math.round(Number(body.minimumScore)), minimumQuality: Math.round(Number(body.minimumQuality)),
      maxPerProject: Math.round(Number(body.maxPerProject)), skipReviewRequired: body.skipReviewRequired !== false,
    };
    if (!Number.isFinite(clean.minimumScore) || clean.minimumScore < 1 || clean.minimumScore > 100) return json(res, 400, { error: 'Minimum score must be 1–100.' });
    if (!Number.isFinite(clean.minimumQuality) || clean.minimumQuality < 1 || clean.minimumQuality > 100) return json(res, 400, { error: 'Minimum quality must be 1–100.' });
    if (!Number.isFinite(clean.maxPerProject) || clean.maxPerProject < 1 || clean.maxPerProject > 20) return json(res, 400, { error: 'Automatic clips per source must be 1–20.' });
    setAutomationSettings(currentUser, clean); log(`Automation ${clean.enabled ? 'enabled' : 'paused'}: score ${clean.minimumScore}+, quality ${clean.minimumQuality}+, up to ${clean.maxPerProject} per source.`, 'info', currentUser.id);
    agent.tick().catch(() => {});
    return json(res, 200, { ok: true, settings: automationSettings(currentUser) });
  }

  // ── DeenAI ──────────────────────────────────────────────────────────────
  // The tab is visible to everyone; the substance is Pro. A locked account
  // gets demo cards marked as such -- the shape of the feature with none of
  // its access -- and the ask endpoint refuses outright. The gate lives here,
  // server-side: a client flag would be a suggestion, not a gate.
  // The help centre. Signed in only -- it describes the signed-in app, and the
  // public site has its own guides -- but no plan gate: someone who cannot work
  // out how to use what they bought is the last person to put a paywall in
  // front of.
  if (method === 'GET' && pathname === '/api/help') {
    if (!currentUser) return json(res, 401, { error: 'Sign in to continue.' });
    return json(res, 200, help.helpPayload({ supportEmail: config.supportEmail }));
  }
  if (method === 'GET' && pathname === '/api/deenai') {
    if (!currentUser) return json(res, 401, { error: 'Sign in to continue.' });
    if (!deenai.deenaiAccess(currentUser)) {
      return json(res, 200, { pro: false, demo: true, ask: false, insights: deenai.demoInsights(), metrics: deenai.demoMetrics() });
    }
    return json(res, 200, {
      pro: true, demo: false, ask: deenai.deenaiAskAccess(currentUser),
      insights: deenai.insights(currentUser), metrics: deenai.metrics(currentUser),
    });
  }
  if (method === 'POST' && pathname === '/api/deenai/ask') {
    if (!currentUser) return json(res, 401, { error: 'Sign in to continue.' });
    // Pro reaches this route and is refused HERE rather than at the tab, so the
    // screen can show a Studio prompt beside real insights instead of a demo.
    if (!deenai.deenaiAskAccess(currentUser)) {
      return json(res, 403, {
        error: deenai.deenaiAccess(currentUser)
          ? 'Asking DeenAI is a Studio feature. Pro shows the insights; Studio answers questions.'
          : 'DeenAI is a Pro feature. Upgrade to see your own numbers.',
      });
    }
    let body;
    try { body = await readBody(req, 64 * 1024); } catch (error) { return json(res, 400, { error: error.message }); }
    try {
      const answer = await deenai.ask(currentUser, body?.question);
      return json(res, 200, { answer });
    } catch (error) {
      return json(res, error.statusCode || (error.code === 'worker_unavailable' ? 503 : 500), { error: error.message });
    }
  }

  if (method === 'GET' && pathname === '/api/music') return json(res, 200, { tracks: audio.listNasheeds(currentUser), settings: musicSettings(currentUser) });
  if (method === 'POST' && pathname === '/api/music') {
    let body;
    try { body = await readBody(req, 24 * 1024 * 1024); }
    catch { return json(res, 413, { error: 'That nasheed is too large to send this way. Keep it under 24MB.' }); }
    try { const track = await audio.saveNasheed(currentUser, body.name, body.data, body.mimeType); log(`Added "${track.name}". The renderer can rotate it across clips.`, 'info', currentUser.id); return json(res, 200, { ok: true, track }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (method === 'POST' && pathname === '/api/music-settings') {
    const body = await readBody(req); const volumePercent = Math.round(Number(body.volumePercent));
    if (!Number.isFinite(volumePercent) || volumePercent < 1 || volumePercent > 50) return json(res, 400, { error: 'Background music volume must be between 1% and 50%.' });
    setMusicSettings(currentUser, { volumePercent, required: true, shuffle: true }); return json(res, 200, { ok: true, settings: musicSettings(currentUser) });
  }
  const musicAudio = pathname.match(/^\/api\/music\/([^/]+)\/audio$/);
  if (method === 'GET' && musicAudio) {
    const found = audio.nasheedFilePath(currentUser, decodeURIComponent(musicAudio[1])); if (!found) return json(res, 404, { error: 'Track not found.' });
    const extension = path.extname(found.file).toLowerCase(); const contentType = extension === '.wav' ? 'audio/wav' : extension === '.ogg' ? 'audio/ogg' : extension === '.m4a' ? 'audio/mp4' : 'audio/mpeg';
    return streamFile(req, res, found.file, { contentType });
  }
  const musicDelete = pathname.match(/^\/api\/music\/([^/]+)$/);
  if (method === 'DELETE' && musicDelete) return audio.deleteNasheed(currentUser, decodeURIComponent(musicDelete[1])) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Track not found.' });

  // Stock background videos for the Quran recitation flow.
  const backgroundPoster = pathname.match(/^\/api\/backgrounds\/([^/]+)\/poster$/);
  if (method === 'GET' && backgroundPoster) {
    const poster = await backgrounds.posterPathFor(currentUser, decodeURIComponent(backgroundPoster[1]));
    if (!poster) {
      res.setHeader('Cache-Control', 'private, max-age=300');
      return json(res, 404, { error: 'No poster for that background.' });
    }
    return streamFile(req, res, poster, { contentType: 'image/jpeg', cacheControl: 'private, max-age=86400' });
  }

  if (method === 'GET' && pathname === '/api/backgrounds') return json(res, 200, { backgrounds: backgrounds.listBackgrounds(currentUser) });
  if (method === 'POST' && pathname === '/api/backgrounds') {
    let body;
    // Anything bigger goes straight to object storage from the browser and
    // arrives here as an objectKey, which never touches this process.
    try { body = await readBody(req, 12 * 1024 * 1024); }
    catch { return json(res, 413, { error: 'That file is too large to send through the API. Configure object storage, or use a shorter loop under 12MB.' }); }
    // Anybody may OFFER a video to the shared library; only the operator
    // publishes one outright. Youssef, 3 Sept 2026: "it has to go through,
    // um, like, a review process, make sure it's not anything disgusting or
    // horrible." So a customer's submission is held as pendingShare and is
    // visible to nobody but them and the operator until it is watched.
    const wantsShared = body.shared === true;
    const operatorNow = ['owner', 'admin'].includes(String(currentUser?.role || '').toLowerCase());
    const shared = wantsShared && operatorNow;
    const pendingShare = wantsShared && !operatorNow;
    const by = String(currentUser?.name || '').trim() || String(currentUser?.email || '').split('@')[0];
    try {
      let entry;
      if (body.objectKey) {
        // The fast path: the browser PUT the raw file straight to object
        // storage with a presigned URL (no base64, no app server in the upload
        // path), and this registers it -- the server pulls it down on its own
        // datacenter bandwidth. Same prefix guard as video submissions.
        const objectKey = assertStorageObjectKey(String(body.objectKey));
        if (!objectKey.startsWith(objectStorage.uploadPrefixFor(currentUser.id))) throw new Error('The uploaded video reference is outside the permitted storage area.');
        const temp = path.join(config.dataDir, 'backgrounds', `incoming-${crypto.randomBytes(6).toString('hex')}`);
        fs.mkdirSync(path.dirname(temp), { recursive: true });
        const response = await fetch(objectStorage.presign({ method: 'GET', key: objectKey, expiresSec: 600 }));
        if (!response.ok || !response.body) throw new Error(`The uploaded file could not be fetched from storage (HTTP ${response.status}).`);
        await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
        entry = await backgrounds.registerBackgroundFile(currentUser, body.name, temp, body.mimeType, { shared, pendingShare, by });
        // The staging object has served its purpose.
        objectStorage.deleteObject(objectKey).catch(() => {});
      } else {
        entry = await backgrounds.saveBackground(currentUser, body.name, body.data, body.mimeType, { shared, pendingShare, by });
      }
      log(`Added background video "${entry.name}"${shared ? ' to the shared stock library' : pendingShare ? ' and offered it to the DeenClipped library for review' : ''}.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, background: backgrounds.publicBackground(entry, currentUser) });
    }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const backgroundVideo = pathname.match(/^\/api\/backgrounds\/([^/]+)\/video$/);
  if (method === 'GET' && backgroundVideo) {
    const found = backgrounds.backgroundFilePath(currentUser, decodeURIComponent(backgroundVideo[1])); if (!found) return json(res, 404, { error: 'Background not found.' });
    return streamFile(req, res, found.file, { contentType: 'video/mp4' });
  }
  // A like or a dislike on a video in the shared library. Pressing the same
  // button again clears the vote -- see voteBackground.
  const backgroundVote = pathname.match(/^\/api\/backgrounds\/([^/]+)\/vote$/);
  if (method === 'POST' && backgroundVote) {
    let body; try { body = await readBody(req); } catch { body = {}; }
    try {
      const updated = backgrounds.voteBackground(currentUser, decodeURIComponent(backgroundVote[1]), body.vote);
      return updated ? json(res, 200, { ok: true, background: updated })
        : json(res, 404, { error: 'That video is not in the shared library.' });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  // The operator's queue, and their decision. Both refuse a non-operator in
  // backgrounds.js rather than here, so the rule has one home.
  if (method === 'GET' && pathname === '/api/backgrounds/pending') {
    return json(res, 200, {
      backgrounds: backgrounds.pendingBackgrounds(currentUser)
        .map(entry => backgrounds.publicBackground(entry, currentUser)),
    });
  }
  const backgroundReview = pathname.match(/^\/api\/backgrounds\/([^/]+)\/review$/);
  if (method === 'POST' && backgroundReview) {
    let body; try { body = await readBody(req); } catch { body = {}; }
    try {
      const decided = backgrounds.reviewBackground(currentUser, decodeURIComponent(backgroundReview[1]), body.approve === true, body.reason);
      if (!decided) return json(res, 404, { error: 'Nothing is waiting on that video.' });
      log(`${body.approve === true ? 'Approved' : 'Declined'} "${decided.name}" for the DeenClipped library.`, 'info', currentUser.id);
      return json(res, 200, { ok: true, background: decided });
    } catch (error) { return json(res, 403, { error: error.message }); }
  }
  const backgroundDelete = pathname.match(/^\/api\/backgrounds\/([^/]+)$/);
  if (method === 'DELETE' && backgroundDelete) {
    const operator = ['owner', 'admin'].includes(String(currentUser?.role || '').toLowerCase());
    return backgrounds.deleteBackground(currentUser, decodeURIComponent(backgroundDelete[1]), { operator }) ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Background not found.' });
  }

  if (pathname === '/api/diagnostics') {
    try { requireOperator(currentUser); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
  if (method === 'GET' && pathname === '/api/diagnostics') {
    if (config.processingMode === 'remote') {
      try {
        // health carries the capability report; readiness carries queue depth.
        // Both, because "is the box up" and "does the box have the current
        // code" are different questions and only the second one has been
        // catching us out.
        const [worker, health] = await Promise.all([
          workerClient.readiness(),
          workerClient.health().catch(error => ({ error: error.message })),
        ]);
        const capabilities = health?.capabilities || worker?.capabilities || null;
        return json(res, 200, {
          ok: Boolean(worker.ready), worker, health, capabilities,
          // Named so the answer to "did the rebuild take" is readable without
          // knowing which flag means what.
          workerBuild: capabilities ? summariseWorkerBuild(capabilities) : 'The worker did not report its capabilities — it is running a build from before they existed.',
          readiness: agent.engine.readiness(currentUser), model: config.aiModel,
          note: 'Heavy processing runs on the external worker.',
        });
      } catch (error) {
        return json(res, 503, { ok: false, error: error.message, readiness: agent.engine.readiness(currentUser) });
      }
    }
    const [ffmpeg, worker] = await Promise.all([checkFfmpeg(), runDoctor()]);
    return json(res, 200, { ok: ffmpeg.ok && worker.ok, ffmpeg, worker, readiness: agent.engine.readiness(currentUser), python: config.pythonBin, model: config.aiModel, note: 'The first real transcription downloads the selected Whisper model once.' });
  }

  if (method === 'POST' && pathname === '/api/clips/schedule-selected') {
    const body = await readBody(req);
    try {
      for (const id of (Array.isArray(body.ids) ? body.ids : [])) assertCanAccessClip(currentUser, String(id));
      // Optional. `day` is a calendar day, `at` one exact posting slot. This
      // route read only `at`, so every per-day button sent a `day` the server
      // dropped on the floor and the clip went to the next open slot -- the
      // exact bug the day parameter was added to fix, still live because the
      // unit tests called scheduleSelected directly and never crossed the route.
      const at = Number(body.at), day = Number(body.day);
      const summary = agent.scheduleSelected(body.ids, {
        at: Number.isFinite(at) && at > 0 ? at : null,
        day: Number.isFinite(day) && day > 0 ? day : null,
      });
      return json(res, 200, { ok: summary.failed === 0, ...summary });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  // Dragging a card in the Schedule. Separate from schedule-selected, which
  // finds a clip its first free slot: this one is told EXACTLY where the card
  // was dropped, and swaps with whatever was already there rather than
  // shuffling the clip somewhere else the person did not choose.
  if (method === 'POST' && pathname === '/api/clips/move-slot') {
    const body = await readBody(req);
    try {
      const id = String(body.id || '');
      assertCanAccessClip(currentUser, id);
      return json(res, 200, agent.moveClipToSlot(id, Number(body.at)));
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }

  const sourcePreview = pathname.match(/^\/api\/clips\/([^/]+)\/source-preview$/);
  if (method === 'GET' && sourcePreview) {
    let clip; try { clip = assertCanAccessClip(currentUser, decodeURIComponent(sourcePreview[1])); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const project = clip ? state.projects.find(item => item.id === clip.projectId) : null;
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (project?.sourceUrl) return temporaryRedirect(res, project.sourceUrl);
    if (!clip || !sourceFile || !fs.existsSync(sourceFile)) return json(res, 404, { error: 'Original source video is unavailable.' });
    return streamFile(req, res, sourceFile, { contentType: 'video/mp4' });
  }

  const clipVideo = pathname.match(/^\/api\/clips\/([^/]+)\/(video|download|thumb)$/);
  if (method === 'GET' && clipVideo) {
    const id = decodeURIComponent(clipVideo[1]); const kind = clipVideo[2];
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
    const remoteUrl = mediaUrl(kind === 'thumb' ? clip?.thumbUrl : clip?.clipUrl);
    const downloadName = `${(clip?.title || 'deenclipped').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 70) || 'deenclipped'}.mp4`;
    // A download has to arrive as a file, not as a video that happens to open
    // in a tab. Redirecting to the CDN gives the browser no filename and no
    // disposition, so it plays instead of saving -- which is indistinguishable
    // from the download being broken. The bytes are relayed instead, which
    // costs egress on a rare action and gets the customer their MP4.
    if (kind === 'download' && remoteUrl) {
      try {
        const upstream = await fetch(remoteUrl);
        if (!upstream.ok || !upstream.body) throw new Error(`storage returned ${upstream.status}`);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${downloadName}"`,
          'Cache-Control': 'private, no-store',
          ...(upstream.headers.get('content-length') ? { 'Content-Length': upstream.headers.get('content-length') } : {}),
        });
        const { Readable } = await import('node:stream');
        return Readable.fromWeb(upstream.body).pipe(res);
      } catch (error) {
        return json(res, 502, { error: `That clip could not be fetched for download: ${error.message}` });
      }
    }
    if (remoteUrl) {
      // Thumbnail redirects may be cached briefly: they are painted as CSS
      // backgrounds on every poll repaint, and a no-store redirect to a dead
      // object meant the browser walked into the same 404 forever. Video
      // redirects stay no-store -- they can point at presigned URLs that
      // expire, and a cached one would replay a signature past its window.
      if (kind === 'thumb') {
        res.writeHead(307, { Location: remoteUrl, 'Cache-Control': 'private, max-age=300' });
        return res.end();
      }
      return temporaryRedirect(res, remoteUrl);
    }
    const file = agent.engine.clipFilePath(id, kind === 'thumb' ? 'thumb' : 'video');
    if (!file) {
      // A cacheable miss. Thumbnails are painted as CSS backgrounds, and a
      // repaint re-resolves the URL: with a plain 404 the browser asked for
      // the same missing file on every poll, forever. Five cached minutes
      // turns the loop into one request, without hiding a thumb for long
      // once a render finally produces it.
      res.setHeader('Cache-Control', 'private, max-age=300');
      return json(res, 404, { error: kind === 'thumb' ? 'No thumbnail rendered.' : 'Rendered file not found.' });
    }
    if (kind === 'thumb') return streamFile(req, res, file, { contentType: 'image/jpeg' });
    return streamFile(req, res, file, kind === 'download' ? { downloadName } : {});
  }

  const rerenderClip = pathname.match(/^\/api\/clips\/([^/]+)\/rerender$/);
  if (method === 'POST' && rerenderClip) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(rerenderClip[1]);
      assertCanAccessClip(currentUser, id);
      // The selection routes check the plan; this one never did, so a free
      // account could re-render a clip onto a Pro style, get a success, and
      // receive a clip in the default style because enforceTemplatePlan swaps
      // it back at render. Refused at the door, with the reason.
      const wanted = String(body.templateId || '');
      if (wanted) assertTemplateAllowed(templates.templateById(wanted, currentUser));
      // Priority 1, level with a submitted lecture. At 0 a free re-render
      // outranked every paying customer's job on a single worker slot.
      // A preview window renders ~6s around the playhead on the worker's quick
      // lane -- the editor's fast feedback loop, never a replacement render.
      const previewWindow = body.preview && Number.isFinite(Number(body.preview.startSec)) && Number.isFinite(Number(body.preview.endSec))
        ? { startSec: Math.max(0, Number(body.preview.startSec)), endSec: Math.max(0, Number(body.preview.endSec)) }
        : null;
      return json(res, 202, { ok: true, job: agent.engine.queueClipRerender(id, wanted, { asVariant: Boolean(body.asVariant), priority: previewWindow ? 0 : 1, preview: previewWindow }) });
    }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPublish = pathname.match(/^\/api\/clips\/([^/]+)\/publish$/);
  if (method === 'POST' && clipPublish) {
    try { const id = decodeURIComponent(clipPublish[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(await agent.publishNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipRetryPublish = pathname.match(/^\/api\/clips\/([^/]+)\/retry-publish$/);
  if (method === 'POST' && clipRetryPublish) {
    const body = await readBody(req);
    try {
      const id = decodeURIComponent(clipRetryPublish[1]); assertCanAccessClip(currentUser, id);
      // targetId addresses ONE destination; provider stays for older clients
      // and for "retry everything on this platform".
      const selector = { targetId: String(body.targetId || ''), provider: String(body.provider || '') };
      return json(res, 200, { ok: true, clip: publicClip(agent.retryPublishing(id, selector)) });
    }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipReady = pathname.match(/^\/api\/clips\/([^/]+)\/ready$/);
  if (method === 'POST' && clipReady) {
    try { const id = decodeURIComponent(clipReady[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.readyNow(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  const clipPosted = pathname.match(/^\/api\/clips\/([^/]+)\/posted$/);
  if (method === 'POST' && clipPosted) {
    try { const id = decodeURIComponent(clipPosted[1]); assertCanAccessClip(currentUser, id); return json(res, 200, { ok: true, clip: publicClip(agent.markPosted(id)) }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }
  // Real speech timing for one clip.
  //
  // The editor requests this to place captions on actual spoken words. When
  // it was missing the request 404'd, the editor fell back to
  // approximateWords(), and captions were spread evenly across the whole
  // clip at a fixed cadence — appearing during silence and drifting out of
  // sync with speech. The worker already stores exact word-level timings
  // from Faster-Whisper in the project transcript, in absolute source time;
  // this converts them to clip-relative time for the clip in question.
  const clipDetail = pathname.match(/^\/api\/clips\/([^/]+)\/detail$/);
  if (method === 'GET' && clipDetail) {
    const id = decodeURIComponent(clipDetail[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    return json(res, 200, { ok: true, clip: publicClip(clip, { detail: true }) });
  }
  const clipCaptions = pathname.match(/^\/api\/clips\/([^/]+)\/captions$/);
  if (method === 'GET' && clipCaptions) {
    const id = decodeURIComponent(clipCaptions[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }

    const project = state.projects.find(item => item.id === clip.projectId);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    let words = [];
    let exact = false;
    if (project?.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        words = wordsForClip(segments, clipStart, clipEnd);
        exact = words.length > 0;
      } catch {
        words = [];
      }
    }

    return json(res, 200, {
      words,
      exact,
      synced: exact,
      edited: Boolean(clip.transcriptEdited),
      transcript: clip.transcript || '',
      durationSec: duration,
      silence: silenceSpans(words, duration),
    });
  }

  // Re-derive caption timing from the original Whisper transcript.
  // Backs the editor's "Auto-sync" button, which 404'd before this existed.
  const clipResync = pathname.match(/^\/api\/clips\/([^/]+)\/captions\/resync$/);
  if (method === 'POST' && clipResync) {
    const id = decodeURIComponent(clipResync[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    if (!project?.transcriptFile || !fs.existsSync(project.transcriptFile)) {
      return json(res, 400, { error: 'No transcript is stored for this lecture, so speech timing cannot be recovered.' });
    }
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    try {
      const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
      const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
      const words = wordsForClip(segments, clipStart, clipEnd);
      if (!words.length) return json(res, 400, { error: 'No speech was found inside this clip.' });
      return json(res, 200, {
        words, exact: true, synced: true,
        transcript: words.map(w => w.word).join(' '),
        silence: silenceSpans(words, Math.max(0, clipEnd - clipStart)),
      });
    } catch (error) {
      return json(res, 400, { error: `The transcript could not be read: ${error.message}` });
    }
  }

  // Active-speaker framing analysis. The editor calls this to preview where
  // the AI crop will sit over time; it 404'd before this existed, which is
  // why smart framing reported "Not found".
  const clipFraming = pathname.match(/^\/api\/clips\/([^/]+)\/framing-preview$/);
  if (method === 'POST' && clipFraming) {
    const id = decodeURIComponent(clipFraming[1]);
    let clip; try { clip = assertCanAccessClip(currentUser, id); } catch (error) { return json(res, error.statusCode || 403, { error: error.message }); }
    const project = state.projects.find(item => item.id === clip.projectId);
    const sourceFile = clip?.sourceFile && fs.existsSync(clip.sourceFile) ? clip.sourceFile : project?.sourceFile;
    if (!sourceFile || !fs.existsSync(sourceFile)) {
      return json(res, 200, { plan: { available: false, reason: 'The original video is no longer stored, so framing cannot be analysed.' } });
    }

    const body = await readBody(req);
    const clipStart = Number(clip.startSec) || 0;
    const clipEnd = Number(clip.endSec) || (clipStart + (Number(clip.durationMs) || 0) / 1000);
    const duration = Math.max(0, clipEnd - clipStart);

    // Give the tracker the real speech spans so it holds position during
    // silence instead of chasing detector noise when nobody is talking.
    let speechSpans = [];
    if (project.transcriptFile && fs.existsSync(project.transcriptFile)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(project.transcriptFile, 'utf8'));
        const segments = Array.isArray(parsed) ? parsed : (parsed.segments || []);
        speechSpans = wordsForClip(segments, clipStart, clipEnd).map(w => [w.start, w.end]);
      } catch { speechSpans = []; }
    }

    const requestFile = path.join(config.dataDir, `framing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
    fs.writeFileSync(requestFile, JSON.stringify({
      source: sourceFile, ffprobe: config.ffprobePath || 'ffprobe',
      start: clipStart, duration,
      width: Number(body.width) || 1080, height: Number(body.height) || 1920,
      bias: String(body.bias || 'auto'), padding: Number(body.padding ?? 0.18),
      zoom: Number(body.zoom ?? 1), smoothing: Number(body.smoothing ?? 0.82),
      speechSpans,
    }));

    try {
      const plan = await new Promise((resolve) => {
        const child = spawn(config.pythonBin, [config.workerScript, '--framing', requestFile], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ available: false, reason: 'Framing analysis took too long and was stopped.' }); }, 120000);
        child.stdout.on('data', d => { out += d; });
        child.stderr.on('data', d => { err += d; });
        child.on('error', e => { clearTimeout(timer); resolve({ available: false, reason: `The analyser could not start: ${e.message}` }); });
        child.on('close', () => {
          clearTimeout(timer);
          try { resolve(JSON.parse(out).plan); }
          catch { resolve({ available: false, reason: (err.trim().split('\n').pop() || 'The analyser returned no result.').slice(0, 300) }); }
        });
      });
      return json(res, 200, { plan });
    } finally {
      try { fs.unlinkSync(requestFile); } catch {}
    }
  }

  const clipMatch = pathname.match(/^\/api\/clips\/([^/]+)$/);
  if (clipMatch && method === 'PATCH') {
    const id = decodeURIComponent(clipMatch[1]); const body = await readBody(req);
    try {
      assertCanAccessClip(currentUser, id);
      // A per-clip override on a scripture clip is exempt for the same reason
      // the template is: the mark was never there to remove.
      assertWatermarkAllowed(body.styleOverrides,
        state.clips.find(item => item.id === id)?.templateId);
      agent.updateClip(id, body); let clip;
      if (body.status === 'approved') clip = agent.approveClip(id); else if (body.status === 'rejected') clip = agent.rejectClip(id); else if (body.status === 'waiting') clip = state.clips.find(item => item.id === id)?.status === 'rejected' ? agent.unrejectClip(id) : agent.pullBack(id); else clip = state.clips.find(item => item.id === id);
      return json(res, 200, { ok: true, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  // Take a clip off the schedule WITHOUT un-reviewing it. Its own route
  // rather than a PATCH status, because the clip's status does not change --
  // it stays approved and simply loses its slot.
  const clipUnschedule = pathname.match(/^\/api\/clips\/([^/]+)\/unschedule$/);
  if (clipUnschedule && method === 'POST') {
    try {
      const id = decodeURIComponent(clipUnschedule[1]);
      assertCanAccessClip(currentUser, id);
      return json(res, 200, { ok: true, clip: publicClip(agent.unschedule(id)) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  if (clipMatch && method === 'DELETE') {
    try { const id = decodeURIComponent(clipMatch[1]); assertCanAccessClip(currentUser, id); agent.deleteClip(id); return json(res, 200, { ok: true }); }
    catch (error) { return json(res, 400, { error: error.message }); }
  }

  // Promote one clip's tweaks onto its shared style, so every clip using that
  // style picks them up. This is the old always-on behaviour, now something the
  // user asks for by name instead of a side effect of dragging a slider.
  // Spread one clip's own tweaks to its siblings.
  //
  // Editing a clip writes only that clip, which is right -- one clip's crop must
  // not move every clip in the lecture. But the common intent after getting a
  // clip looking right is "now do that to the rest of this video", and nothing
  // did it: promote-style writes the shared template, which reaches every other
  // lecture too, and refuses outright on a built-in.
  //
  // scope 'lecture' copies the overrides onto the other clips from the same
  // source video only. scope 'template' is the old promote-style behaviour, kept
  // for when the user really does mean everything.
  const applyStyleMatch = pathname.match(/^\/api\/clips\/([^/]+)\/apply-style$/);
  if (applyStyleMatch && method === 'POST') {
    const id = decodeURIComponent(applyStyleMatch[1]);
    const body = await readBody(req);
    const scope = String(body.scope || 'lecture');
    try {
      assertCanAccessClip(currentUser, id);
      const clip = state.clips.find(item => item.id === id);
      if (!clip) return json(res, 404, { error: 'That clip no longer exists.' });
      const overrides = clip.styleOverrides && Object.keys(clip.styleOverrides).length ? clip.styleOverrides : null;
      // The button shows whenever siblings exist; pressing it with nothing
      // changed is a no-op, not a mistake to scold.
      if (!overrides) return json(res, 200, { ok: true, scope, applied: 0, queued: 0, pending: 0, errors: [] });
      if (scope === 'template') {
        // The old promote-style behaviour the route comment promises: the look
        // lands on the shared template, so every lecture using it follows.
        const updated = promoteClipLook(currentUser, clip);
        save();
        return json(res, 200, { ok: true, scope, template: updated, clip: publicClip(clip) });
      }
      if (scope !== 'lecture') return json(res, 400, { error: 'Unknown scope.' });

      // Siblings from the same lecture, this account only, and never a clip that
      // has already gone out -- rewriting a posted video is not a style change.
      const siblings = ownedBy(state.clips, currentUser.id).filter(item => item.projectId === clip.projectId
        && item.id !== clip.id && !item.variantOf && item.status !== 'posted');
      // The style is stored either way, and stylePending marks the video as out
      // of date -- the same contract promote-style uses. Rolling the style back
      // when a re-render cannot start would mean the whole action silently did
      // nothing on an account whose source files have been cleaned up, which is
      // a supported state rather than an error.
      let applied = 0; let queued = 0; const errors = [];
      for (const sibling of siblings) {
        // They are meant to end up looking the same, so the look replaces the
        // sibling's own tweaks rather than merging underneath them -- but the
        // framing is the sibling's alone and survives.
        //
        // Two clips from one lecture are different moments, so the speaker sits
        // in a different part of each frame. Copying this clip's crop across
        // re-centres every sibling on wherever *this* speaker was and cuts the
        // others' heads off. The whole point of "same look, own framing".
        const keptFraming = {};
        for (const field of templates.FRAMING_FIELDS) {
          if (sibling.styleOverrides && sibling.styleOverrides[field] !== undefined) {
            keptFraming[field] = sibling.styleOverrides[field];
          }
        }
        const look = { ...overrides };
        for (const field of templates.FRAMING_FIELDS) delete look[field];
        sibling.styleOverrides = { ...look, ...keptFraming };
        sibling.stylePending = true;
        applied += 1;
        try {
          agent.engine.queueClipRerender(sibling.id, sibling.templateId || clip.templateId, {});
          queued += 1;
        } catch (error) {
          errors.push({ clipId: sibling.id, error: error.message });
        }
      }
      save();
      const project = state.projects.find(item => item.id === clip.projectId);
      log(`Applied "${clip.title || 'clip'}" styling to ${applied} other clip${applied === 1 ? '' : 's'} in "${project?.title || 'this lecture'}"; ${queued} re-rendering now.`,
        'info', currentUser.id);
      return json(res, 202, { ok: true, scope, applied, queued, pending: applied - queued, errors: errors.slice(0, 20) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }

  const promoteMatch = pathname.match(/^\/api\/clips\/([^/]+)\/promote-style$/);
  if (promoteMatch && method === 'POST') {
    const id = decodeURIComponent(promoteMatch[1]);
    try {
      assertCanAccessClip(currentUser, id);
      const clip = state.clips.find(item => item.id === id);
      if (!clip) return json(res, 404, { error: 'That clip no longer exists.' });
      const updated = promoteClipLook(currentUser, clip);
      save();
      return json(res, 200, { ok: true, template: updated, clip: publicClip(clip) });
    } catch (error) { return json(res, 400, { error: error.message }); }
  }
  return json(res, 404, { error: 'Not found.' });
}

// Turns the worker's capability report into one readable line. Every item here
// has been shipped and then silently not deployed at least once.
function summariseWorkerBuild(capabilities) {
  const missing = [];
  if (!capabilities.captionAnimation) missing.push('caption animation');
  if (!capabilities.clipBreakdown) missing.push('per-clip progress');
  if (!capabilities.downloadProgress) missing.push('download size');
  if (!capabilities.faceDetection) missing.push(`face detection (${capabilities.faceDetectionNote || 'unavailable'})`);
  if (!capabilities.quranCaptions) missing.push('the Quran corpus, so the recitation template falls back to plain captions');
  if ((capabilities.missingFonts || []).length) missing.push(`fonts: ${capabilities.missingFonts.join(', ')}`);
  // Not a missing feature, but the single most useful fact when an import
  // fails: whether the download happened on the worker or on a service the
  // operator cannot see.
  const via = capabilities.importProvider === 'ytdlp'
    ? 'Imports download on the worker itself.'
    : `Imports download via ${capabilities.importProvider || 'a managed provider'}`
      + (capabilities.importFallback === 'off' ? ', with no fallback.' : ', falling back to the worker if it is blocked.');
  // Only worth mentioning once a block is the live problem: without one of
  // these the worker has no way past YouTube refusing its address.
  const past = capabilities.importProxy || capabilities.importCookies
    ? ` The worker can retry through ${[capabilities.importProxy && 'a proxy', capabilities.importCookies && 'signed-in cookies'].filter(Boolean).join(' and ')}.`
    : ' It has no proxy or cookies configured, so a blocked IP has nothing to fall back to.';
  return missing.length
    ? `Rebuild needed — the running worker is missing ${missing.join('; ')}. ${via}${past}`
    : `Up to date — the running worker has every current feature. ${via}${past}`;
}

/**
 * The one inline <script> the studio page carries, hashed so the policy can
 * allow exactly it and nothing else. Computed at startup from the file on
 * disk, so editing the page updates the hash instead of silently breaking it,
 * and no attacker-injected script can ever match.
 */
const INLINE_SCRIPT_HASHES = (() => {
  const hashes = new Set();
  // The shell flag the server injects, not just what is on disk.
  hashes.add(`'sha256-${crypto.createHash('sha256').update(STUDIO_SHELL_SCRIPT, 'utf8').digest('base64')}'`);
  for (const file of [page]) {
    let source; try { source = fs.readFileSync(file, 'utf8'); } catch { continue; }
    for (const match of source.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
      hashes.add(`'sha256-${crypto.createHash('sha256').update(match[1], 'utf8').digest('base64')}'`);
    }
  }
  return [...hashes];
})();

/**
 * Security headers on every response.
 *
 * There were none at all. The Content-Security-Policy is the one that carries
 * weight: script-src allows this origin plus the hash of the page's own inline
 * block, so injected script cannot run even if something did get through the
 * escaping. style-src has to keep 'unsafe-inline' -- the design system writes
 * style="..." on nearly every element -- which is a real limit, and the reason
 * the script side is kept strict.
 */
function securityHeaders(res, { pathname }) {
  const challenge = auth.turnstileEnabled() && pathname === '/login';
  const csp = [
    "default-src 'self'",
    // Turnstile's script and the iframe it opens, and ONLY on the page that
    // carries the box. Widening script-src app-wide for a widget that appears
    // on one form would spend the strictness that makes this policy worth
    // having. Both lines are absent entirely when the keys are not set.
    `script-src 'self' ${INLINE_SCRIPT_HASHES.join(' ')}${challenge ? ' https://challenges.cloudflare.com' : ''}`.trim(),
    // The icon font is served from unpkg: the generated stylesheet @imports
    // two Phosphor sheets from there, and those pull their font files from the
    // same host. Leaving it out blocked every icon in the product -- the nav,
    // the platform row, every control that is an icon rather than a word.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://unpkg.com",
    "font-src 'self' https://fonts.gstatic.com https://unpkg.com data:",
    // Clip thumbnails and renders can live on object storage, and the editor
    // reads frames through blob: URLs.
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "connect-src 'self' https:",
    // The push service worker. worker-src would fall back through child-src to
    // script-src (which allows 'self'), but that fallback chain differs between
    // browsers and a blocked worker fails SILENTLY -- registration rejects and
    // push quietly never works. Stated outright instead. The hashes are not
    // repeated: a worker is a file, never an inline block.
    "worker-src 'self'",
    "manifest-src 'self'",
    // Nothing here is ever framed, and nothing may be framed into it.
    "frame-ancestors 'none'",
    `frame-src https://js.stripe.com https://checkout.stripe.com${challenge ? ' https://challenges.cloudflare.com' : ''}`,
    "base-uri 'self'",
    "form-action 'self' https://checkout.stripe.com",
    "object-src 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  // Only over TLS, and only where it cannot strand a local http deployment.
  if (config.publicBaseUrl.startsWith('https://')) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  // A credentialed API response must never be cached by a shared proxy.
  if (pathname.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');

  // Pages that must not appear in search results.
  //
  // `Disallow` in robots.txt is NOT an indexing control and Google says so:
  // it stops the page being CRAWLED, and a page nobody may crawl can still be
  // listed as a bare URL with no description if anything links to it. /login
  // is linked from the header of every public page, so it is exactly the case
  // that happens.
  //
  // The combination that actually works is the opposite of the instinct: let
  // Google fetch the page, and answer with noindex. `follow` is kept so the
  // links on it are still worth something.
  if (NOINDEX_PATHS.has(pathname)) res.setHeader('X-Robots-Tag', 'noindex, follow');
}

const NOINDEX_PATHS = new Set(['/login', '/reset', '/plans', '/app']);

export const server = http.createServer((req, res) => {
  let url; try { url = new URL(req.url, `http://${req.headers.host || 'localhost'}`); } catch { return json(res, 400, { error: 'Bad request.' }); }

  // HEAD is GET without a body, and it must answer with the headers GET would
  // send (RFC 9110). Every route below matches on `method === 'GET'`, so HEAD
  // fell through all of them to the 404 -- on the homepage included. A link
  // checker, an uptime monitor or a social-card scraper that asks with HEAD
  // was being told the site does not exist, and nothing here went red about
  // it because nothing here had ever asked that way.
  //
  // So it is routed as a GET and the body is dropped on the way out. The
  // Content-Length stays as GET would report it, which is what the spec asks
  // for and what a checker reads.
  if ((req.method || 'GET').toUpperCase() === 'HEAD') {
    req.method = 'GET';
    const finish = res.end.bind(res);
    res.write = (chunk, encoding, callback) => {
      const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : callback;
      if (done) done();
      return true;
    };
    res.end = (chunk, encoding, callback) => {
      const done = typeof chunk === 'function' ? chunk : typeof encoding === 'function' ? encoding : callback;
      return finish(done);
    };
  }

  securityHeaders(res, { pathname: url.pathname });
  if ((req.method || 'GET') === 'POST'
      && (url.pathname.startsWith('/auth/') || url.pathname.startsWith('/billing/'))
      && !sameOriginPost(req, url)) {
    return json(res, 403, { error: 'This request did not come from DeenClipped.' });
  }
  route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected server error.' }); });
});
// Checked before the socket opens. A deployment that cannot be served safely
// must not be served at all -- previously these only turned /readyz red while
// the instance carried on answering customers.
const fatal = fatalConfigurationErrors();
if (fatal.length) {
  for (const problem of fatal) console.error(`[fatal] ${problem}`);
  console.error('[fatal] Fix the environment and redeploy. See SECRET-ROTATION.md.');
  process.exit(1);
}

server.listen(config.port, () => {
  console.log(`DeenClipped self-hosted engine listening on http://localhost:${config.port}`);
  // Before anything schedules or posts: correct clips that went out to one
  // destination and were filed as if they had gone nowhere. Left alone they
  // sit under "missed their slots" for ever, and their button says "Post now"
  // rather than "Retry TikTok" -- which would publish to YouTube twice.
  agent.healPartialPublishes();
  agent.start();
  // Nothing anywhere held a second copy of state.json. Started here for the
  // same reason as the sweep below: importing this module in a test must not
  // ship a real state file to a real bucket.
  backup.start();
  ownerFeed.start();
  // Nothing ever told anyone the worker had stopped answering. Every render
  // fails while the product looks fine, and the first report is a customer's.
  if (config.processingMode === 'remote') {
    const checkWorker = async () => {
      try {
        await workerClient.readiness();
        await alerts.report('worker', false);
      } catch (error) {
        await alerts.report('worker', true, `The render worker is not answering: ${error.message}\nNothing can be transcribed or rendered until it is back.`);
      }
    };
    const workerTimer = setInterval(() => { checkWorker().catch(() => {}); }, 5 * 60_000);
    workerTimer.unref?.();
    checkWorker().catch(() => {});

    /*
     * The fixed currency prices, once a day.
     *
     * currency_options do not follow the exchange rate, so they drift while
     * nobody is looking -- and the only reason anybody would notice is a plan
     * quietly costing a fifth less in one currency than another. This alerts;
     * it never reprices. What a customer pays is a decision a person makes,
     * not something a timer does at 3am on a rate it happened to fetch.
     */
    const checkCurrencyDrift = async () => {
      try {
        const drifted = await billing.currencyDrift();
        if (!drifted.length) { await alerts.report('currency-drift', false); return; }
        const lines = drifted
          .map(row => `  ${row.plan} ${row.currency.toUpperCase()}: charging ${row.charged}, `
            + `worth about ${row.worth} at today's rate (${row.percent > 0 ? '+' : ''}${row.percent}%)`)
          .join('\n');
        await alerts.report('currency-drift', true,
          'Fixed prices in Stripe have drifted from the Australian price:\n' + lines
          + '\n\nNothing has been changed. To reprice, run from the Render shell:\n'
          + '  node scripts/stripe-currency-options.mjs        (dry run)\n'
          + '  node scripts/stripe-currency-options.mjs --apply');
      } catch { /* a rates lookup that fails must never raise an alarm */ }
    };
    const driftTimer = setInterval(() => { checkCurrencyDrift().catch(() => {}); }, 24 * 60 * 60_000);
    driftTimer.unref?.();
    checkCurrencyDrift().catch(() => {});
  }
  // YouTube API Data is cleared after 30 days (policy III.E.4.a-g). Started
  // here rather than on import so a test that loads this module does not sweep
  // a real state file as a side effect.
  startYouTubeRetention();
});
