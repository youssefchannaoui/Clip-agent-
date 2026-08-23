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
export function nextSlot(taken = [], { from = Date.now(), leadMinutes = 15 } = {}) {
  const tz = config.timezone;
  const earliest = from + leadMinutes * 60_000;
  const used = new Set(taken.map(Number));
  const { y, m, d } = localToday(tz, new Date(from));

  for (let dayOffset = 0; dayOffset < 60; dayOffset++) {
    const base = new Date(Date.UTC(y, m - 1, d + dayOffset));
    const day = { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1, d: base.getUTCDate() };

    for (const t of config.postTimes) {
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
