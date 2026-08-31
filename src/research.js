/*
 * Aggregate research over the account's own records.
 *
 * The intent, from the brief: DeenClipped will eventually be able to publish
 * something nobody else can — real numbers about what actually happens when
 * long lectures are cut into short clips. How long the average source is, what
 * share of candidates survive review, how often recitation appears, what clip
 * length people settle on. That is the kind of thing other sites link to, and
 * links are the one thing this repository cannot manufacture.
 *
 * Three rules govern this file and none of them is negotiable:
 *
 * 1. **NOTHING IS PUBLISHED YET AND NOTHING IS FABRICATED.** Every function
 *    here refuses to answer until there is enough data for the answer to mean
 *    something. `MIN_SAMPLE` is not a formality: a "study" of eleven clips
 *    from three accounts is not a finding, and publishing one would be the
 *    single fastest way to lose the credibility the rest of the site is built
 *    on. `report()` returns `{ready: false}` with the reason, and the honest
 *    thing to do with that is wait.
 *
 * 2. **No individual is identifiable, ever.** Nothing here reads an email, an
 *    account name, a lecture title or a transcript. It counts and it averages,
 *    and every bucket must hold at least `MIN_PER_BUCKET` records or it is
 *    dropped rather than reported — a bucket of one is a person.
 *
 * 3. **It is computed, never estimated.** If a number cannot be derived from
 *    the records, it is absent. There is no default, no industry average, and
 *    no placeholder that could survive into a published figure.
 *
 * This module is not wired to a route. It exists so that when there IS enough
 * data, the analysis is already written, already privacy-checked and already
 * tested — rather than being improvised under the pressure of wanting
 * something to publish.
 */

/** Below this, there is no finding — only noise wearing a percentage sign. */
export const MIN_SAMPLE = 500;

/** A bucket smaller than this is dropped: it describes a person, not a trend. */
export const MIN_PER_BUCKET = 25;

/** Accounts below this contribute a bucket that is really one customer. */
export const MIN_ACCOUNTS = 20;

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Drop any bucket too small to be about more than one person, and report what
 * was dropped rather than silently narrowing the picture.
 */
function safeBuckets(counts) {
  const kept = {};
  let dropped = 0;
  for (const [key, n] of Object.entries(counts)) {
    if (n >= MIN_PER_BUCKET) kept[key] = n;
    else dropped += n;
  }
  return { kept, droppedRecords: dropped };
}

/**
 * Everything derivable, or an honest refusal.
 *
 * `clips` and `projects` are the state arrays. Nothing else is read, and no
 * field carrying words — title, transcript, email — is touched.
 */
export function report({ clips = [], projects = [], accounts = 0 } = {}) {
  const usableClips = clips.filter(clip => clip && clip.status);
  const accountCount = Number(accounts) || 0;

  if (usableClips.length < MIN_SAMPLE) {
    return {
      ready: false,
      reason: `Needs ${MIN_SAMPLE} clips; there are ${usableClips.length}.`,
      have: usableClips.length,
      need: MIN_SAMPLE,
    };
  }
  if (accountCount < MIN_ACCOUNTS) {
    return {
      ready: false,
      // A large sample from three accounts describes three workflows, and
      // publishing it as though it described the practice would be a lie of
      // framing rather than of arithmetic.
      reason: `Needs ${MIN_ACCOUNTS} accounts; there are ${accountCount}. A big sample from a few accounts is one workflow, not a finding.`,
      have: accountCount,
      need: MIN_ACCOUNTS,
    };
  }

  const reviewed = usableClips.filter(c => ['approved', 'rejected', 'scheduled', 'posted'].includes(c.status));
  const kept = reviewed.filter(c => c.status !== 'rejected');

  const clipLengths = usableClips
    .map(c => Number(c.endSec) - Number(c.startSec))
    .filter(n => Number.isFinite(n) && n > 0 && n < 600);

  const sourceMinutes = projects
    .map(p => Number(p.durationSec) / 60)
    .filter(n => Number.isFinite(n) && n > 0 && n < 600);

  const lengthBuckets = safeBuckets(clipLengths.reduce((acc, seconds) => {
    const band = seconds < 20 ? 'under 20s'
      : seconds < 40 ? '20-40s'
        : seconds < 60 ? '40-60s'
          : seconds < 90 ? '60-90s' : 'over 90s';
    acc[band] = (acc[band] || 0) + 1;
    return acc;
  }, {}));

  return {
    ready: true,
    sample: {
      clips: usableClips.length,
      reviewedClips: reviewed.length,
      lectures: sourceMinutes.length,
      accounts: accountCount,
    },
    // The headline number, and the one nobody else can publish: of the clips a
    // model proposed and a person then judged, how many survived.
    keepRate: reviewed.length >= MIN_PER_BUCKET
      ? round((kept.length / reviewed.length) * 100)
      : null,
    clipLength: {
      medianSec: clipLengths.length >= MIN_PER_BUCKET ? round(median(clipLengths)) : null,
      distribution: lengthBuckets.kept,
      droppedForPrivacy: lengthBuckets.droppedRecords,
    },
    sourceLength: {
      medianMin: sourceMinutes.length >= MIN_PER_BUCKET ? round(median(sourceMinutes)) : null,
    },
    // Said in the payload, not only in a comment, so a caller cannot present
    // this as more than it is.
    caveats: [
      'Every figure is computed from DeenClipped records only. Nothing is estimated or filled in.',
      'Buckets holding fewer than ' + MIN_PER_BUCKET + ' records are dropped rather than reported.',
      'These describe accounts using this product, not short-form video in general.',
    ],
  };
}
