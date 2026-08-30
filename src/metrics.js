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
import { trackedPaths } from './seo-pages.js';

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
// Derived from the SEO registry so a new public page is counted the day it
// ships, plus the few app paths that are not SEO pages but are worth seeing in
// the funnel. Still a closed set: a scanner spraying /wp-admin must never mint
// a state key, which is the whole reason this allowlist exists.
const APP_PATHS = ['/login', '/plans', '/app'];
const TRACKED_PATHS = new Set([...trackedPaths(), ...APP_PATHS]);

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
    metrics.days[day] = { views: {}, uniques: 0, uniqueIds: [], referrers: {}, utm: {}, events: {}, attribution: {} };
  }
  const bucket = metrics.days[day];
  // Older builds of a bucket may lack a field added later; heal in place.
  bucket.views ||= {}; bucket.referrers ||= {}; bucket.utm ||= {}; bucket.events ||= {};
  bucket.devices ||= {}; bucket.languages ||= {}; bucket.campaigns ||= {};
  bucket.entries ||= {}; bucket.missing ||= {}; bucket.attribution ||= {};
  bucket.direct ||= 0; bucket.botHits ||= 0;
  bucket.newVisitors ||= 0; bucket.returningVisitors ||= 0;
  // Two numbers per hour of the day, so a day can be read as a shape rather
  // than a single total. 24 keys per day bucket, dropped with the day.
  bucket.hours ||= {};
  if (!Array.isArray(bucket.uniqueIds)) bucket.uniqueIds = [];
  return bucket;
}

/** The UTC hour of an instant, 0-23, as the key its day bucket files it under. */
function utcHour(ms = Date.now()) {
  return String(new Date(ms).getUTCHours()).padStart(2, '0');
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
export function pageview({ path, ip = '', userAgent = '', referrer = '', ownHost = '', query = null, viewerRole = '', language = '', seenBefore = false }) {
  if (!TRACKED_PATHS.has(path)) return false;
  if (['owner', 'admin'].includes(String(viewerRole || '').toLowerCase())) return false;
  const day = utcDay();
  const bucket = dayBucket(day);

  // A crawler is recorded as the one number it is — a bot hit — and nothing
  // else: no view, no unique, no referrer. The count exists so a traffic dip
  // can be told apart from a filter change.
  if (BOT_UA.test(String(userAgent))) { bucket.botHits += 1; scheduleFlush(); return false; }

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
    // NEW vs RETURNING -- "has this browser ever opened the site before?"
    //
    // It cannot come from the visitor id: that hash is salted with a DAY salt
    // on purpose, so yesterday's visitor is unrecognisable today. That is the
    // privacy property, not an oversight, and widening the salt to find
    // returners would trade it away.
    //
    // So the answer lives in the visitor's own browser instead: a bare flag,
    // no identifier in it, nothing derived from it, and nothing about it
    // stored here but these two counters. The server still keeps no address,
    // no user agent and no cross-day id.
    if (seenBefore) bucket.returningVisitors = (bucket.returningVisitors || 0) + 1;
    else bucket.newVisitors = (bucket.newVisitors || 0) + 1;
  }
  const hour = (bucket.hours[utcHour()] ||= { views: 0, uniques: 0 });
  hour.views += 1;
  if (firstToday) hour.uniques += 1;

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
  // Tell the caller to mark this browser as seen. Only ever true for a real
  // (non-bot, non-operator) visitor on a tracked page who did not carry the
  // flag already, so the header is set once per browser rather than on every
  // response.
  return !seenBefore;
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
/**
 * Which page a paying customer arrived on.
 *
 * Everything else here counts traffic; this counts MONEY, which is the only
 * number that says whether writing landing pages was worth the effort. A page
 * with a thousand visits and no subscription is a page to rewrite or delete,
 * and views alone cannot tell you that.
 *
 * It stays inside the same privacy posture as the rest of the module. The
 * landing path travels in a first-party cookie holding A PATH AND NOTHING
 * ELSE -- no identifier, nothing derived from one, nothing that survives being
 * read by anyone but this server. What lands in state is a counter per path.
 *
 * `path` is checked against the registry before it is used as a key, so a
 * scanner spraying `?` at the cookie cannot mint unbounded state.
 */
export function attribute(kind, path) {
  const key = String(kind || '').trim().slice(0, 16);
  const page = String(path || '').trim();
  if (!key || !TRACKED_PATHS.has(page)) return;
  const bucket = dayBucket(utcDay());
  const row = (bucket.attribution ||= {});
  const per = (row[key] ||= {});
  per[page] = (per[page] || 0) + 1;
  scheduleFlush();
}

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
      newVisitors: bucket?.newVisitors || 0,
      returningVisitors: bucket?.returningVisitors || 0,
    });
  }

  const byPath = {}; const referrers = {}; const utm = {}; const events = {};
  const devices = {}; const languages = {}; const campaigns = {}; const entries = {}; const missingPages = {};
  const attribution = {};
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
    for (const [kind, per] of Object.entries(bucket.attribution || {})) {
      const into = (attribution[kind] ||= {});
      for (const [k, v] of Object.entries(per || {})) into[k] = (into[k] || 0) + v;
    }
    direct += bucket.direct || 0;
    botHits += bucket.botHits || 0;
  }

  // The last 48 hours as one series, so "by hour" is a shape and not a guess
  // from a daily total. Read across day boundaries because the interesting
  // question -- when do people actually turn up -- crosses midnight.
  const hourly = [];
  for (let back = 47; back >= 0; back -= 1) {
    const at = today - back * 60 * 60 * 1000;
    const bucket = metrics.days[utcDay(at)];
    const slot = bucket?.hours?.[String(new Date(at).getUTCHours()).padStart(2, '0')];
    hourly.push({
      at, hour: String(new Date(at).getUTCHours()).padStart(2, '0') + ':00',
      day: utcDay(at), views: slot?.views || 0, uniques: slot?.uniques || 0,
    });
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
  // Days before this was captured have neither counter, so they read as zero
  // rather than as "everyone was new" -- an honest gap beats a flattering one.
  const newVisitors = sumLast(rows, 'newVisitors', window);
  const returningVisitors = sumLast(rows, 'returningVisitors', window);
  const rate = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

  return {
    windowDays: window,
    captureSince: Object.keys(metrics.days).sort()[0] || null,
    days: rows,
    hourly,
    totals: {
      views, uniques,
      newVisitors, returningVisitors,
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
      // Of the visitors we could classify -- not of all uniques, or the days
      // before capture would drag it towards zero and read as "nobody comes
      // back" when the truth is "we were not counting yet".
      returning: rate(returningVisitors, newVisitors + returningVisitors),
    },
    byPath, referrers, utm, events,
    channels, devices, languages, campaigns, entries,
    missing: missingPages, botHits,
    liveNow: liveNow(),
    signupsByDay,
    // Landing pages ranked by what they EARN, not by what they attract.
    //
    // The join happens here rather than on the screen because the screen would
    // then be a second place that computes it, and the two would drift -- the
    // same reason DeenAI's metrics() lives beside its cards.
    //
    // A page can show paid > signup: someone who signed up last month and
    // subscribes today counts in one column only. That is real, so it is left
    // alone rather than capped into looking tidy.
    // The key set is entries UNION everything attributed, not entries alone.
    //
    // Built from entries only, a page whose visit fell outside the window but
    // whose signup landed inside it vanished from the table completely --
    // dropping exactly the row worth reading. A conversion must never be lost
    // because its visit aged out.
    landingPages: [...new Set([
      ...Object.keys(entries),
      ...Object.values(attribution).flatMap(per => Object.keys(per || {})),
    ])]
      .map(path => ({
        path,
        entries: entries[path] || 0,
        signups: attribution.signup?.[path] || 0,
        paid: attribution.paid?.[path] || 0,
      }))
      .filter(row => row.entries || row.signups || row.paid)
      .sort((a, b) => (b.paid - a.paid) || (b.signups - a.signups) || (b.entries - a.entries)),
  };
}
