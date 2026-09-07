import { config } from './config.js';

/** How far the given zone is ahead of UTC at that instant, in ms. */
function zoneOffset(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).reduce((acc, p) => {
    if (p.type !== 'literal') acc[p.type] = Number(p.value);
    return acc;
  }, {});
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second);
  return asUtc - date.getTime();
}

/** Turn a wall-clock time in the configured zone into a real instant. */
function wallToInstant(y, m, d, hh, mm, timeZone) {
  const guess = Date.UTC(y, m - 1, d, hh, mm, 0);
  let ms = guess - zoneOffset(new Date(guess), timeZone);
  // Run once more so daylight-saving boundaries land correctly.
  ms = guess - zoneOffset(new Date(ms), timeZone);
  return ms;
}

/** Today's date in the configured zone. */
function localToday(timeZone, from = new Date()) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(from).split('-').map(Number);
  return { y: p[0], m: p[1], d: p[2] };
}

/**
 * Midnight, in the configured zone, of the day the given instant falls on.
 *
 * The schedule screen asks for a DAY, not a moment. Taken literally, "the 2nd"
 * arrived as whatever o'clock it happened to be in the browser, and every
 * posting time earlier in that day was already behind it -- so asking for a day
 * reliably landed the clip on the day after. It also removes the browser's
 * timezone from the answer: the account's zone decides which day is which.
 */
export function startOfZonedDay(ms) {
  const tz = config.timezone;
  const { y, m, d } = localToday(tz, new Date(ms));
  return wallToInstant(y, m, d, 0, 0, tz);
}

/**
 * Next free posting slot, skipping any already taken and anything too soon.
 * `taken` is a list of ms timestamps already spoken for.
 */
/**
 * The posting windows for an account allowed `count` of them a day.
 *
 * The configured POST_TIMES are kept EXACTLY as they are and the extra windows
 * are inserted into the widest gaps between them. Spreading `count` times
 * evenly over 24 hours would have been simpler and would have posted at 3am;
 * the account already chose which part of the day it publishes in, and more
 * slots must not change that.
 */
export function postTimesFor(count = 0) {
  const base = config.postTimes.filter(t => /^\d{1,2}:\d{2}$/.test(String(t)));
  const wanted = Math.round(Number(count) || 0);
  if (!base.length || wanted <= base.length) return base;
  const toMinutes = t => { const [hh, mm] = t.split(':').map(Number); return hh * 60 + mm; };
  const label = mins => String(Math.floor(mins / 60)).padStart(2, '0') + ':' + String(mins % 60).padStart(2, '0');
  let minutes = base.map(toMinutes).sort((a, b) => a - b);
  while (minutes.length < wanted) {
    let widest = 0;
    for (let i = 1; i < minutes.length; i++) {
      if (minutes[i] - minutes[i - 1] > minutes[widest + 1] - minutes[widest]) widest = i - 1;
    }
    const midpoint = Math.round((minutes[widest] + minutes[widest + 1]) / 2);
    // A gap too narrow to split (two slots a minute apart) would loop forever
    // inserting the same time; stop rather than promise windows that collide.
    if (minutes.includes(midpoint)) break;
    minutes = [...minutes, midpoint].sort((a, b) => a - b);
  }
  return minutes.map(label);
}

export function nextSlot(taken = [], { from = Date.now(), leadMinutes = 15, times = null } = {}) {
  const tz = config.timezone;
  const earliest = from + leadMinutes * 60_000;
  const used = new Set(taken.map(Number));
  const { y, m, d } = localToday(tz, new Date(from));
  const windows = (Array.isArray(times) && times.length) ? times : config.postTimes;

  for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
    const base = new Date(Date.UTC(y, m - 1, d + dayOffset));
    const day = { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };

    for (const t of windows) {
      const [hh, mm] = t.split(':').map(Number);
      if (!Number.isFinite(hh) || !Number.isFinite(mm)) continue;
      const ms = wallToInstant(day.y, day.m, day.d, hh, mm, tz);
      if (ms >= earliest && !used.has(ms)) return ms;
    }
  }
  // Everything full for two months, which should never happen.
  return earliest;
}

/** Human-readable time in the user's zone, for the interface. */
export function formatLocal(ms) {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: config.timezone,
    weekday: 'short', day: 'numeric', month: 'short',
    hour: 'numeric', minute: '2-digit',
  }).format(new Date(ms));
}

/**
 * A stored posting-window arrangement, normalised for an account allowed
 * `allowance` windows a day.
 *
 * The stored shape is ONE list of `{ at, on }` rather than a list of times plus
 * a list of switched-off times. Two lists is two answers to one question, and
 * an off row has to keep its time or unticking and re-ticking loses it.
 *
 * Truncation on a downgrade happens at READ time and is never written back, so
 * a Studio account that lapses to Pro keeps its eight rows on disk and gets
 * them all again if it resubscribes. That is the same rule accountsPerPlatform
 * follows for connected channels, and for the same reason: a settings record
 * outlives the plan that wrote it.
 */
export function normaliseWindows(allowance, stored) {
  const want = Math.max(1, Math.round(Number(allowance) || 0) || 1);
  const clean = [];
  const seen = new Set();
  for (const row of Array.isArray(stored) ? stored : []) {
    const at = normaliseTime(row && row.at);
    // A duplicate time is unreachable rather than harmless: nextSlot matches on
    // the resolved instant, so a second 07:00 can never be filled and the
    // account would be told it has a window it does not.
    if (!at || seen.has(at)) continue;
    seen.add(at);
    clean.push({ at, on: row.on !== false });
  }
  clean.sort((a, b) => toMinutes(a.at) - toMinutes(b.at));
  // Short of the allowance (a fresh account, or one that just moved up a tier)
  // the shipped windows fill the gap, so nobody has to build a schedule before
  // the product works.
  if (clean.length < want) {
    for (const at of postTimesFor(want)) {
      if (clean.length >= want) break;
      if (seen.has(at)) continue;
      seen.add(at);
      clean.push({ at, on: true });
    }
    clean.sort((a, b) => toMinutes(a.at) - toMinutes(b.at));
  }
  return clean.slice(0, want);
}

/** The times an account actually posts at: its on windows, earliest first. */
export function resolveWindows(allowance, stored) {
  const rows = normaliseWindows(allowance, stored);
  const on = rows.filter(row => row.on).map(row => row.at);
  // An empty list is the dangerous answer, not a quiet one: nextSlot falls back
  // to the SERVER's configured times when it is handed nothing, so an account
  // that switched every window off would go on posting at times it had just
  // turned off. The setter refuses to save that; this refuses to honour it.
  return on.length ? on : rows.map(row => row.at);
}

/** "7:00" and "07:00" are one window; anything else is not a window at all. */
export function normaliseTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value == null ? '' : value).trim());
  if (!match) return '';
  const hh = Number(match[1]), mm = Number(match[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh > 23 || mm > 59) return '';
  return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
}

function toMinutes(at) {
  const [hh, mm] = at.split(':').map(Number);
  return hh * 60 + mm;
}
