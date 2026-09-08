/**
 * Platform results, imported by hand, in ONE internal shape.
 *
 * DeenClipped collects no genuine social-performance analytics, and this
 * module does not pretend otherwise. The privacy policy states that no
 * YouTube statistics are requested, `test/youtube-compliance.test.mjs` pins
 * it, and widening an OAuth scope to get views would make that sentence false
 * and reopen a compliance review that is closed. So until an approved
 * integration exists, the numbers come from the creator: typed in, or pasted
 * from a CSV their platform already exports.
 *
 * EVERY ROW CARRIES ITS SOURCE AND ITS MEASUREMENT DATE, and every surface
 * that shows one says both. A view count with no date is a number that was
 * true once; a number whose origin is unstated is indistinguishable from one
 * the product invented, which is exactly the claim DeenAI must never make.
 *
 * The shape is deliberately the one an API would fill. When YouTube Analytics
 * or TikTok's display API is approved, the importer changes and NOTHING
 * downstream does: `source` becomes 'api', and the baseline, the comparison
 * and the model context read the same rows they read today.
 */

import { state } from './store.js';
import { readUserSetting, writeUserSetting } from './tenancy.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many measurement rows one account may hold. */
export const MAX_ROWS = 2000;

/**
 * The metric fields, and what each one means.
 *
 * `cumulative` marks a figure that only makes sense as a difference between
 * two measurement dates — a follower COUNT is not a result, the change is.
 * Nothing in the app treats a cumulative figure as a per-post number.
 */
export const METRIC_FIELDS = Object.freeze({
  views: Object.freeze({ label: 'Views', kind: 'count' }),
  watchTimeSec: Object.freeze({ label: 'Watch time', kind: 'seconds' }),
  completionRate: Object.freeze({ label: 'Completion rate', kind: 'ratio' }),
  likes: Object.freeze({ label: 'Likes', kind: 'count' }),
  comments: Object.freeze({ label: 'Comments', kind: 'count' }),
  shares: Object.freeze({ label: 'Shares', kind: 'count' }),
  saves: Object.freeze({ label: 'Saves', kind: 'count' }),
  followerDelta: Object.freeze({ label: 'Followers gained', kind: 'delta' }),
  subscriberDelta: Object.freeze({ label: 'Subscribers gained', kind: 'delta' }),
});

export const METRIC_KEYS = Object.freeze(Object.keys(METRIC_FIELDS));

export const SOURCES = Object.freeze(['manual', 'csv', 'api']);

/**
 * CSV header synonyms, so a file exported from a platform's own dashboard
 * imports without anyone renaming a column. Matching is on the header with
 * spaces, underscores and punctuation stripped — "Watch time (hours)" and
 * "watch_time_hours" are the same column to a person and must be to us.
 */
const HEADER_ALIASES = Object.freeze({
  clipid: 'clipId', clip: 'clipId', clipreference: 'clipId',
  title: 'title', videotitle: 'title', content: 'title', video: 'title',
  provider: 'provider', platform: 'provider', destination: 'provider', channel: 'provider',
  postedat: 'postedAt', published: 'postedAt', publishtime: 'postedAt', publishedat: 'postedAt',
  videopublishtime: 'postedAt', date: 'postedAt', postdate: 'postedAt',
  measuredat: 'measuredAt', measured: 'measuredAt', asof: 'measuredAt', reportdate: 'measuredAt',
  views: 'views', videoviews: 'views', plays: 'views', impressions: 'views',
  watchtime: 'watchTimeSec', watchtimeseconds: 'watchTimeSec', totaltimewatched: 'watchTimeSec',
  watchtimehours: 'watchTimeHours', watchtimeminutes: 'watchTimeMinutes',
  averageviewduration: 'avgViewSec', averagewatchtime: 'avgViewSec',
  completionrate: 'completionRate', averagepercentageviewed: 'completionRate',
  averageviewpercentage: 'completionRate', fullvideowatchedrate: 'completionRate',
  likes: 'likes', reactions: 'likes',
  comments: 'comments',
  shares: 'shares',
  saves: 'saves', favourites: 'saves', favorites: 'saves', bookmarks: 'saves',
  followerdelta: 'followerDelta', newfollowers: 'followerDelta', followersgained: 'followerDelta',
  subscriberdelta: 'subscriberDelta', subscribersgained: 'subscriberDelta', newsubscribers: 'subscriberDelta',
});

function normaliseHeader(h) {
  return String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function idOf(user) {
  const id = String(user?.id || user || '');
  return id || null;
}

function rowsOf(userId) {
  const stored = readUserSetting(state, userId, 'platformMetrics');
  return Array.isArray(stored) ? stored : [];
}

function saveRows(userId, rows) {
  // Newest first, capped. An account that pastes a year of exports every week
  // must not grow state.json without bound; the oldest measurement is the one
  // worth losing, because every comparison here is against a RECENT baseline.
  const trimmed = rows
    .slice()
    .sort((a, b) => (b.measuredAt || 0) - (a.measuredAt || 0))
    .slice(0, MAX_ROWS);
  writeUserSetting(state, userId, 'platformMetrics', trimmed);
  return trimmed;
}

function num(value) {
  if (value === null || value === undefined || value === '') return null;
  const cleaned = String(value).replace(/[,\s]/g, '').replace(/%$/, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function whenOf(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Seconds or milliseconds — a plausible epoch in seconds is ten digits.
    return value > 1e11 ? Math.round(value) : Math.round(value * 1000);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * A ratio arrives as 0.42, 42, or "42%", and getting it wrong by a factor of
 * a hundred would put a completion rate of 4200% in front of somebody. Over 1
 * is read as a percentage; at or under 1 it is already a fraction.
 */
function ratio(value) {
  const n = num(value);
  if (n === null) return null;
  const r = n > 1 ? n / 100 : n;
  if (r < 0 || r > 1) return null;
  return Math.round(r * 10000) / 10000;
}

function providerOf(value) {
  const p = String(value || '').toLowerCase().trim();
  if (!p) return '';
  if (/youtube|shorts|yt/.test(p)) return 'youtube';
  if (/tiktok|tik tok/.test(p)) return 'tiktok';
  if (/instagram|reels?|ig/.test(p)) return 'instagram';
  if (/facebook|fb/.test(p)) return 'facebook';
  return p.replace(/[^a-z0-9]/g, '').slice(0, 24);
}

/**
 * Turn one loose object — typed into the form or read out of a CSV row — into
 * a stored measurement, or say why it cannot be one.
 *
 * A row with no measurable figure is REFUSED rather than stored empty: an
 * account whose import "worked" and shows nothing has been told a lie about
 * its own data, and will trust the next number less.
 */
export function normaliseRow(raw, { source = 'manual', now = 0 } = {}) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const provider = providerOf(input.provider);
  if (!provider) return { error: 'Each row needs a platform (youtube, tiktok, instagram or facebook).' };

  const measuredAt = whenOf(input.measuredAt) || now || 0;
  if (!measuredAt) return { error: 'Each row needs a measurement date.' };

  const metrics = {};
  for (const key of METRIC_KEYS) {
    if (key === 'completionRate') continue;
    const n = num(input[key]);
    if (n !== null) metrics[key] = Math.round(n);
  }
  // Watch time arrives in whatever unit the export used.
  if (metrics.watchTimeSec === undefined) {
    const hours = num(input.watchTimeHours);
    const minutes = num(input.watchTimeMinutes);
    if (hours !== null) metrics.watchTimeSec = Math.round(hours * 3600);
    else if (minutes !== null) metrics.watchTimeSec = Math.round(minutes * 60);
  }
  const completion = ratio(input.completionRate);
  if (completion !== null) metrics.completionRate = completion;
  // A completion rate can also be derived, but ONLY from two figures that are
  // both present and both about this post — never assumed from one of them.
  if (metrics.completionRate === undefined) {
    const avgView = num(input.avgViewSec);
    const length = num(input.durationSec);
    if (avgView !== null && length !== null && length > 0) {
      const derived = Math.min(1, avgView / length);
      metrics.completionRate = Math.round(derived * 10000) / 10000;
    }
  }

  if (!Object.keys(metrics).length) {
    return { error: 'Each row needs at least one figure (views, watch time, likes and so on).' };
  }

  return {
    row: {
      id: '',
      clipId: String(input.clipId || '').slice(0, 64),
      title: String(input.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      provider,
      postedAt: whenOf(input.postedAt) || 0,
      measuredAt,
      durationSec: num(input.durationSec) || 0,
      source: SOURCES.includes(source) ? source : 'manual',
      importedAt: now || measuredAt,
      ...metrics,
    },
  };
}

/**
 * Split a CSV into objects, tolerantly.
 *
 * Quoted fields with commas and doubled quotes inside them are the shapes
 * every platform export actually produces; anything more exotic is refused
 * rather than half-read, because a mis-split row becomes a wrong number with
 * a confident label on it.
 */
export function parseCsv(text) {
  const src = String(text || '').replace(/^﻿/, '');
  if (!src.trim()) return { error: 'That file is empty.' };
  const rows = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; }
        else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { record.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { record.push(field); rows.push(record); record = []; field = ''; continue; }
    field += ch;
  }
  record.push(field);
  if (record.length > 1 || record[0].trim()) rows.push(record);
  if (rows.length < 2) return { error: 'That file has a header and no rows.' };

  const header = rows[0].map(h => HEADER_ALIASES[normaliseHeader(h)] || '');
  if (!header.some(Boolean)) {
    return { error: 'None of those column names were recognised. A header row naming at least a platform, a date and one figure is what this reads.' };
  }
  const out = [];
  for (const line of rows.slice(1)) {
    if (line.every(cell => !String(cell).trim())) continue;
    const obj = {};
    header.forEach((key, i) => { if (key) obj[key] = line[i]; });
    out.push(obj);
  }
  return { rows: out };
}

/**
 * Store measurements for ONE account.
 *
 * The user id is stamped by the caller's session, never read from the payload
 * — the tenant-isolation rule this codebase already follows everywhere: the
 * lookup itself is owner-scoped rather than checked afterwards.
 */
export function importRows(user, rawRows, { source = 'manual', now = 0, defaults = {} } = {}) {
  const userId = idOf(user);
  if (!userId) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  const list = Array.isArray(rawRows) ? rawRows : [];
  if (!list.length) throw Object.assign(new Error('Nothing to import.'), { statusCode: 400 });
  if (list.length > 500) throw Object.assign(new Error('Import at most 500 rows at a time.'), { statusCode: 400 });

  const stamp = now || 0;
  const existing = rowsOf(userId);
  const added = [];
  const errors = [];
  list.forEach((raw, i) => {
    const merged = { ...defaults, ...(raw && typeof raw === 'object' ? raw : {}) };
    const { row, error } = normaliseRow(merged, { source, now: stamp });
    if (error) { errors.push({ row: i + 1, error }); return; }
    row.id = `m-${userId.slice(0, 6)}-${stamp || 0}-${i}`;
    added.push(row);
  });
  if (!added.length) {
    const why = errors[0]?.error || 'No usable rows.';
    throw Object.assign(new Error(why), { statusCode: 400 });
  }
  // A re-import of the same measurement for the same post replaces it rather
  // than doubling the account's own history — the figures come from a
  // dashboard somebody may well paste twice.
  const key = r => [r.provider, r.clipId || r.title, r.measuredAt].join('|');
  const replaced = new Set(added.map(key));
  const kept = existing.filter(r => !replaced.has(key(r)));
  const saved = saveRows(userId, kept.concat(added));
  return { imported: added.length, skipped: errors.length, errors: errors.slice(0, 10), total: saved.length };
}

export function allRows(user) {
  const userId = idOf(user);
  if (!userId) return [];
  return rowsOf(userId);
}

export function clearRows(user) {
  const userId = idOf(user);
  if (!userId) return 0;
  const n = rowsOf(userId).length;
  writeUserSetting(state, userId, 'platformMetrics', []);
  return n;
}

/**
 * What is actually known, so every screen can say so in one line.
 *
 * An account with nothing imported gets `hasData: false` and a sentence,
 * never a zero — a zero reads as "no views", which is a claim about the
 * audience rather than about our own records.
 */
export function coverage(user) {
  const rows = allRows(user);
  if (!rows.length) {
    return {
      hasData: false,
      rows: 0,
      posts: 0,
      providers: [],
      sources: [],
      from: 0,
      to: 0,
      note: 'No platform results imported yet. DeenClipped does not collect views or watch time from any platform, so nothing here is measured until you import it.',
    };
  }
  const measured = rows.map(r => r.measuredAt).filter(Boolean);
  const providers = [...new Set(rows.map(r => r.provider))];
  const sources = [...new Set(rows.map(r => r.source))];
  const posts = new Set(rows.map(r => r.clipId || r.title || r.id)).size;
  return {
    hasData: true,
    rows: rows.length,
    posts,
    providers,
    sources,
    from: Math.min(...measured),
    to: Math.max(...measured),
    note: `${rows.length} imported measurement${rows.length === 1 ? '' : 's'} across ${posts} post${posts === 1 ? '' : 's'}, `
      + `entered by ${sources.join(' and ')}. Nothing here comes from a platform API.`,
  };
}

/** The newest measurement per post, which is what a comparison should read. */
export function latestPerPost(user, { provider = '' } = {}) {
  const rows = allRows(user).filter(r => !provider || r.provider === provider);
  const byPost = new Map();
  for (const row of rows) {
    const key = `${row.provider}|${row.clipId || row.title || row.id}`;
    const seen = byPost.get(key);
    if (!seen || (row.measuredAt || 0) > (seen.measuredAt || 0)) byPost.set(key, row);
  }
  return [...byPost.values()];
}

/**
 * The creator's OWN baseline for a metric, on one platform.
 *
 * Never a benchmark, never an industry figure, never a number from another
 * account: the only honest comparison this product can make is between one
 * creator's post and the rest of that creator's posts. `n` travels with the
 * answer so the caller can refuse to draw a conclusion from three posts.
 */
export function baseline(user, { provider = '', metric = 'views', minPosts = 3, excludeClipId = '' } = {}) {
  const posts = latestPerPost(user, { provider })
    .filter(r => r.clipId !== excludeClipId || !excludeClipId)
    .filter(r => typeof r[metric] === 'number');
  if (posts.length < minPosts) {
    return { metric, provider, n: posts.length, enough: false, median: null, mean: null };
  }
  const values = posts.map(r => r[metric]).sort((a, b) => a - b);
  const mid = Math.floor(values.length / 2);
  const median = values.length % 2 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    metric, provider, n: values.length, enough: true,
    median: Math.round(median * 1000) / 1000,
    mean: Math.round(mean * 1000) / 1000,
    low: values[0], high: values[values.length - 1],
  };
}

/**
 * How one post did against that creator's own recent posts.
 *
 * Four things are held constant or reported, because ignoring any of them
 * turns a comparison into a wrong story:
 *
 *  - PLATFORM: a TikTok view and a YouTube view are not the same unit.
 *  - AGE: a post measured two days after publishing has not finished; the
 *    comparison says so rather than calling it a failure.
 *  - LENGTH: a 20-second clip and a 90-second clip do not compete on
 *    completion rate, so length travels with the answer.
 *  - SAMPLE SIZE: under `minPosts` the verdict is 'not enough', never a
 *    percentage. This is the one that makes the others honest.
 */
export function comparePost(user, clipId, { metric = 'views', minPosts = 3, now = 0 } = {}) {
  const target = latestPerPost(user).find(r => r.clipId && r.clipId === String(clipId));
  if (!target) {
    return { found: false, reason: 'No imported result for that clip yet.' };
  }
  const base = baseline(user, { provider: target.provider, metric, minPosts, excludeClipId: target.clipId });
  const value = typeof target[metric] === 'number' ? target[metric] : null;
  const ageDays = target.postedAt && target.measuredAt
    ? Math.max(0, Math.round((target.measuredAt - target.postedAt) / DAY_MS))
    : null;
  const out = {
    found: true,
    clipId: target.clipId,
    provider: target.provider,
    metric,
    value,
    durationSec: target.durationSec || 0,
    ageDays,
    measuredAt: target.measuredAt,
    source: target.source,
    baseline: base,
  };
  if (value === null) { out.verdict = 'not measured'; return out; }
  if (!base.enough) {
    out.verdict = 'not enough';
    out.note = `Only ${base.n} other ${target.provider} post${base.n === 1 ? '' : 's'} measured, so there is nothing yet to compare this with.`;
    return out;
  }
  const ratioToBase = base.median > 0 ? value / base.median : null;
  out.ratio = ratioToBase === null ? null : Math.round(ratioToBase * 100) / 100;
  out.verdict = ratioToBase === null ? 'not enough'
    : ratioToBase >= 1.25 ? 'above'
      : ratioToBase <= 0.75 ? 'below' : 'typical';
  if (ageDays !== null && ageDays < 7) {
    out.note = `Measured ${ageDays} day${ageDays === 1 ? '' : 's'} after posting, so this is an early reading rather than a final one.`;
  }
  return out;
}
