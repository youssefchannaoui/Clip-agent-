/**
 * First-party web analytics. Nothing leaves the server.
 *
 * The posture is the same one the security audit praised for transcripts: a
 * hosted tracker would ship every visitor's address to a third party, so
 * there is none. The server records what it can see in the requests it
 * already answers -- pageviews on the public pages, where they came from --
 * and everything else the owner screen shows (signups, revenue, posts) is
 * DERIVED at read time from records the app already keeps, so history exists
 * from before this module did and nothing is double-booked.
 *
 * What is stored, per UTC day: view counts by path, one unique-visitor count,
 * referrer hosts, UTM source/medium pairs, and named conversion events. No
 * raw addresses, no user agents, no per-visit rows. The visitor id is
 * sha256(dailySalt | ip | ua) truncated to 16 hex chars; the day salt is
 * derived from a persisted random salt and the date -- deterministic across
 * restarts, impossible to reverse, different tomorrow.
 *
 * Bounded on purpose. Paths are allowlisted (a scanner spraying /wp-admin
 * must not mint state keys), referrer and UTM maps cap per day with an
 * "other" bucket, today's unique-id list caps, and days beyond the retention
 * window are pruned on flush. The store's own rule -- one JSON state file --
 * makes unbounded cardinality here a disk problem there.
 */

import crypto from 'node:crypto';
import { state, save } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 90;
const MAP_CAP = 50; // distinct referrer hosts / utm pairs kept per day
const UNIQUES_CAP = 50_000; // per-day id list; beyond this uniques undercount
const MISSING_CAP = 30; // distinct 404 paths kept per day
const LIVE_WINDOW_MS = 5 * 60 * 1000; // "live now" is the last five minutes

/**
 * Crawlers are not visitors. Counting Googlebot's daily sweep as traffic is
 * how a site with no readers shows forty uniques — every analytics product
 * filters these, and ours does it before hashing, so a bot never even enters
 * the unique-id set.
 */
const BOT_UA = /bot|crawl|spider|slurp|bingpreview|headlesschrome|lighthouse|pingdom|uptimerobot|facebookexternalhit|whatsapp|telegrambot|discordbot|twitterbot|linkedinbot|embedly|quora link preview|curl\/|wget\/|python-requests|python-urllib|aiohttp|axios\/|go-http-client|okhttp|java\/|libwww/i;

/**
 * Referrer hosts grouped the way every analytics product groups them, so the
 * screen can answer "search or social?" without the owner memorising hosts.
 * Applied at read time — the stored data stays plain hosts.
 */
const SEARCH_HOSTS = /(^|\.)google\.[a-z.]+$|(^|\.)bing\.com$|(^|\.)duckduckgo\.com$|(^|\.)yahoo\.com$|(^|\.)baidu\.com$|(^|\.)yandex\.[a-z]+$|(^|\.)ecosia\.org$|(^|\.)search\.brave\.com$|(^|\.)startpage\.com$/;
const SOCIAL_HOSTS = /(^|\.)youtube\.com$|^youtu\.be$|(^|\.)facebook\.com$|^fb\.me$|(^|\.)instagram\.com$|^t\.co$|(^|\.)twitter\.com$|^x\.com$|(^|\.)reddit\.com$|(^|\.)tiktok\.com$|(^|\.)linkedin\.com$|(^|\.)whatsapp\.com$|(^|\.)t\.me$|(^|\.)telegram\.org$|(^|\.)pinterest\.[a-z.]+$|(^|\.)snapchat\.com$|(^|\.)threads\.net$/;

/** Coarse device class from the UA — the class is counted, the UA never kept. */
function deviceClass(userAgent) {
  const ua = String(userAgent || '');
  if (/ipad|tablet|silk/i.test(ua)) return 'tablet';
  if (/mobi|iphone|android/i.test(ua)) return 'mobile';
  return 'desktop';
}

// Live-now: visitor-hash -> last-seen ms, in memory only. Never persisted —
// five minutes of ephemeral presence is not worth a disk write, and a restart
// honestly showing zero for five minutes beats inventing continuity.
const liveVisitors = new Map();

function pruneLive(now = Date.now()) {
  for (const [id, at] of liveVisitors) {
    if (now - at > LIVE_WINDOW_MS) liveVisitors.delete(id);
  }
}

export function liveNow() {
  pruneLive();
  return liveVisitors.size;
}

/**
 * The public paths worth counting. Everything else is a 404, an asset, or an
 * API call — recording those would let any scanner grow the state file.
 */
const TRACKED_PATHS = new Set(['/', '/features', '/pricing', '/contact', '/privacy', '/terms', '/login', '/plans', '/app']);

function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

function ensure() {
  if (!state.webMetrics || typeof state.webMetrics !== 'object') state.webMetrics = { days: {} };
  if (!state.webMetrics.days || typeof state.webMetrics.days !== 'object') state.webMetrics.days = {};
  // Own salt, minted once and persisted. The session secret is deliberately
  // not readable from config, and coupling analytics to the auth secret would
  // mean rotating one rotates the other's identities mid-day anyway.
  if (!state.webMetrics.salt) { state.webMetrics.salt = crypto.randomBytes(16).toString('hex'); save(); }
  return state.webMetrics;
}

function dayBucket(day) {
  const metrics = ensure();
  if (!metrics.days[day]) {
    metrics.days[day] = { views: {}, uniques: 0, uniqueIds: [], referrers: {}, utm: {}, events: {} };
  }
  const bucket = metrics.days[day];
  // Older builds of a bucket may lack a field added later; heal in place.
  bucket.views ||= {}; bucket.referrers ||= {}; bucket.utm ||= {}; bucket.events ||= {};
  bucket.devices ||= {}; bucket.languages ||= {}; bucket.campaigns ||= {};
  bucket.entries ||= {}; bucket.missing ||= {};
  bucket.direct ||= 0; bucket.botHits ||= 0;
  if (!Array.isArray(bucket.uniqueIds)) bucket.uniqueIds = [];
  return bucket;
}

/**
 * Daily-rotating visitor hash. Derived, never stored: the same inputs give
 * the same id all day (so one person is one unique), and tomorrow's salt
 * makes yesterday's ids unlinkable.
 */
function visitorId(ip, userAgent, day) {
  const daySalt = crypto.createHash('sha256').update(`${ensure().salt}|${day}`).digest('hex');
  return crypto.createHash('sha256').update(`${daySalt}|${ip}|${userAgent}`).digest('hex').slice(0, 16);
}

/** The referrer reduced to what is honest to keep: the external host. */
function referrerHost(referrer, ownHost) {
  try {
    const url = new URL(String(referrer || ''));
    const host = url.hostname.replace(/^www\./, '');
    if (!host) return '';
    // Same-site navigation is not an acquisition source.
    if (ownHost && host === String(ownHost).replace(/^www\./, '')) return '';
    return host.slice(0, 80);
  } catch { return ''; }
}

function bump(map, key, cap = MAP_CAP) {
  if (!key) return;
  if (map[key] === undefined && Object.keys(map).length >= cap) key = 'other';
  map[key] = (map[key] || 0) + 1;
}

let dirty = false;
let flushTimer = null;

function scheduleFlush() {
  dirty = true;
  if (flushTimer) return;
  // One state write a minute at most, and unref'd so a test process exits.
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 60_000);
  if (typeof flushTimer.unref === 'function') flushTimer.unref();
}

export function flush() {
  if (!dirty) return;
  dirty = false;
  const metrics = ensure();
  const cutoff = utcDay(Date.now() - RETENTION_DAYS * DAY_MS);
  const today = utcDay();
  for (const day of Object.keys(metrics.days)) {
    if (day < cutoff) { delete metrics.days[day]; continue; }
    // Only today's id list earns its keep (it is what makes a repeat visit
    // count once, across restarts). Past days keep the count alone.
    if (day !== today && metrics.days[day].uniqueIds?.length) metrics.days[day].uniqueIds = [];
  }
  save();
}

/**
 * Count one request. Callers pass the trusted ip (server.js's clientIp — the
 * LAST x-forwarded-for entry) rather than this module re-deriving it wrongly.
 * Signed-in operators are skipped: the owner reloading their own dashboard is
 * not traffic, and Shopify-style tools exclude the shop owner for the same
 * reason.
 */
export function pageview({ path, ip = '', userAgent = '', referrer = '', ownHost = '', query = null, viewerRole = '', language = '' }) {
  if (!TRACKED_PATHS.has(path)) return;
  if (['owner', 'admin'].includes(String(viewerRole || '').toLowerCase())) return;
  const day = utcDay();
  const bucket = dayBucket(day);

  // A crawler is recorded as the one number it is — a bot hit — and nothing
  // else: no view, no unique, no referrer. The count exists so a traffic dip
  // can be told apart from a filter change.
  if (BOT_UA.test(String(userAgent))) { bucket.botHits += 1; scheduleFlush(); return; }

  bump(bucket.views, path, TRACKED_PATHS.size + 1);

  const id = visitorId(ip, String(userAgent).slice(0, 200), day);
  const firstToday = !bucket.uniqueIds.includes(id);
  if (firstToday) {
    if (bucket.uniqueIds.length < UNIQUES_CAP) bucket.uniqueIds.push(id);
    bucket.uniques = (bucket.uniques || 0) + (bucket.uniqueIds.length <= UNIQUES_CAP ? 1 : 0);
    // The first page of the day is the entry page — Shopify's "landing page",
    // derivable server-side because the daily id set already knows firstness.
    bump(bucket.entries, path, TRACKED_PATHS.size + 1);
    bump(bucket.devices, deviceClass(userAgent), 4);
    const locale = String(language || '').split(',')[0].trim().toLowerCase().slice(0, 12);
    if (locale) bump(bucket.languages, locale, 24);
  }
  liveVisitors.set(id, Date.now());
  if (liveVisitors.size > 10_000) pruneLive();

  const host = referrerHost(referrer, ownHost);
  if (host) bump(bucket.referrers, host);
  // Direct visits are the channel maths' missing half: without this count,
  // "no referrer" is indistinguishable from "referrer map capped".
  else if (firstToday) bucket.direct += 1;

  const source = String(query?.get?.('utm_source') || '').slice(0, 60).toLowerCase();
  if (source) {
    const medium = String(query?.get?.('utm_medium') || '').slice(0, 40).toLowerCase();
    bump(bucket.utm, medium ? `${source} / ${medium}` : source);
    const campaign = String(query?.get?.('utm_campaign') || '').slice(0, 60).toLowerCase();
    if (campaign) bump(bucket.campaigns, campaign);
  }
  scheduleFlush();
}

/**
 * One 404 that a person (or a crawler following a dead link) actually hit.
 * Capped hard: the value is the top few broken links, not a scanner log.
 */
export function missing(path) {
  const key = String(path || '').slice(0, 80);
  if (!key || key.startsWith('/api/')) return;
  const bucket = dayBucket(utcDay());
  bump(bucket.missing, key, MISSING_CAP);
  scheduleFlush();
}

/** A named conversion step the read side cannot derive (e.g. checkout_started). */
export function event(name) {
  const key = String(name || '').trim().slice(0, 40);
  if (!key) return;
  const bucket = dayBucket(utcDay());
  bucket.events[key] = (bucket.events[key] || 0) + 1;
  scheduleFlush();
}

/** Sum an array of {day, ...} rows' field across the last n days. */
function sumLast(rows, field, days) {
  const cutoff = utcDay(Date.now() - (days - 1) * DAY_MS);
  return rows.filter(row => row.day >= cutoff).reduce((total, row) => total + (row[field] || 0), 0);
}

/**
 * Everything the analytics tab shows, in one read.
 *
 * Captured: views, uniques, referrers, utm, events. Derived, so it reaches
 * back before this module existed: signups from authUsers' createdAt,
 * revenue from the billing ledger recordRevenue already keeps, published
 * posts from the clips. Conversion rates divide only numbers from the same
 * window, and a rate whose denominator is zero is null, never 0% — "no
 * visitors yet" and "nobody converted" are different facts.
 */
export function summary({ days = 30 } = {}) {
  flush();
  const metrics = ensure();
  const window = Math.max(1, Math.min(RETENTION_DAYS, Number(days) || 30));
  const today = Date.now();
  const rows = [];
  for (let i = window - 1; i >= 0; i -= 1) {
    const day = utcDay(today - i * DAY_MS);
    const bucket = metrics.days[day];
    rows.push({
      day,
      views: bucket ? Object.values(bucket.views).reduce((a, b) => a + b, 0) : 0,
      uniques: bucket?.uniques || 0,
    });
  }

  const byPath = {}; const referrers = {}; const utm = {}; const events = {};
  const devices = {}; const languages = {}; const campaigns = {}; const entries = {}; const missingPages = {};
  let direct = 0; let botHits = 0;
  const cutoff = utcDay(today - (window - 1) * DAY_MS);
  for (const [day, bucket] of Object.entries(metrics.days)) {
    if (day < cutoff) continue;
    for (const [k, v] of Object.entries(bucket.views)) byPath[k] = (byPath[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.referrers)) referrers[k] = (referrers[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.utm)) utm[k] = (utm[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.events)) events[k] = (events[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.devices || {})) devices[k] = (devices[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.languages || {})) languages[k] = (languages[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.campaigns || {})) campaigns[k] = (campaigns[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.entries || {})) entries[k] = (entries[k] || 0) + v;
    for (const [k, v] of Object.entries(bucket.missing || {})) missingPages[k] = (missingPages[k] || 0) + v;
    direct += bucket.direct || 0;
    botHits += bucket.botHits || 0;
  }

  // Channel grouping happens here, at read time, so the stored data stays
  // plain referrer hosts and a regrouping never needs a migration.
  const channels = { search: 0, social: 0, referral: 0, direct };
  for (const [host, count] of Object.entries(referrers)) {
    if (SEARCH_HOSTS.test(host)) channels.search += count;
    else if (SOCIAL_HOSTS.test(host)) channels.social += count;
    else channels.referral += count;
  }

  const inWindow = ms => Number(ms || 0) && utcDay(Number(ms)) >= cutoff;
  const signupsByDay = {};
  for (const user of state.authUsers || []) {
    if (!inWindow(user.createdAt)) continue;
    const day = utcDay(Number(user.createdAt));
    signupsByDay[day] = (signupsByDay[day] || 0) + 1;
  }
  const signups = Object.values(signupsByDay).reduce((a, b) => a + b, 0);

  let revenueMinor = 0; let paidConversions = 0; let topups = 0; const revenueCurrencies = new Set();
  for (const entry of state.revenueEvents || []) {
    if (!inWindow(entry.createdAt)) continue;
    revenueMinor += Number(entry.amountMinor || 0);
    revenueCurrencies.add(String(entry.currency || '').toLowerCase());
    if (entry.kind === 'subscription') paidConversions += 1;
    if (entry.kind === 'topup') topups += 1;
  }

  let postsPublished = 0;
  for (const clip of state.clips || []) if (inWindow(clip.postedAt)) postsPublished += 1;

  const views = sumLast(rows, 'views', window);
  const uniques = sumLast(rows, 'uniques', window);
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

  return {
    windowDays: window,
    captureSince: Object.keys(metrics.days).sort()[0] || null,
    days: rows,
    totals: {
      views, uniques,
      views7: sumLast(rows, 'views', Math.min(7, window)),
      uniques7: sumLast(rows, 'uniques', Math.min(7, window)),
      signups, postsPublished,
      revenueMinor,
      revenueCurrency: revenueCurrencies.size === 1 ? [...revenueCurrencies][0] : (revenueCurrencies.size ? 'mixed' : null),
      checkoutsStarted: events.checkout_started || 0,
      paidConversions, topups,
    },
    rates: {
      visitToSignup: rate(signups, uniques),
      signupToCheckout: rate(events.checkout_started || 0, signups),
      visitToPaid: rate(paidConversions, uniques),
    },
    byPath, referrers, utm, events,
    channels, devices, languages, campaigns, entries,
    missing: missingPages, botHits,
    liveNow: liveNow(),
    signupsByDay,
  };
}
