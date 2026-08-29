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
