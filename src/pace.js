/**
 * How long this deployment's worker actually takes, learned from its own jobs.
 *
 * WHY THIS EXISTS. Every ETA in the product was quoted from four constants
 * hardcoded in the dashboard and measured on 26 Aug 2026 against a two-core
 * box that no longer exists. The box has been rescaled to eight cores, moved
 * from whisper `small` toward `medium`, and taught to render clips in parallel
 * lanes -- so the constants are now wrong in BOTH directions at once. Measured
 * on the box against a real 1936-second lecture that made 12 clips:
 *
 *     phase        the constants said   it actually took   error
 *     transcribe   310s                 531s               -42%
 *     score         75s                 286s               -74%
 *     render      1320s                 450s              +193%
 *     whole job   1783s (29.7 min)     1269s (21.2 min)    +40%
 *
 * A number that is 40% wrong overall while each part of it is wrong by up to
 * 193% cannot be fixed by picking better constants -- the next hardware change
 * invalidates them again, and this one has changed twice in a fortnight. So the
 * rates are LEARNED from the jobs this deployment has already finished.
 * `worker/clip_worker.py` has stamped `timings` on every result since v3.77.0
 * and nothing had ever read it.
 *
 * Three properties this holds, each of them a way it could otherwise mislead:
 *
 * 1. **The median, never the mean.** One pathological lecture -- a three-hour
 *    upload, a job that sat behind a stalled Ollama -- must not move the
 *    estimate every other customer is shown. A single outlier cannot shift a
 *    median at all, which is the whole reason for choosing it.
 * 2. **Recent jobs only.** The rates describe the HARDWARE, and the hardware
 *    changes. A rate averaged over every job this product has ever run would be
 *    dominated by the two-core box for months after it was retired.
 * 3. **A learned rate is clamped to a sane band around the shipped one.** The
 *    guard is against a rate learned from mis-recorded timings, not against the
 *    box genuinely being slow: the band is wide enough (a quarter to four
 *    times) that any real hardware change passes through it.
 * 4. **A small sample moves the estimate a small way.** The first version
 *    refused to learn at all below three lectures, so an account's first two
 *    ran on figures measured against somebody else's box -- and the third
 *    changed the answer in one step. The measurement is BLENDED toward the
 *    shipped rate by how much of it there is (`PRIOR_STRENGTH`): one lecture
 *    moves the estimate a third of the way, three move it three fifths, ten
 *    move it most of the way. Nothing is thrown away and nothing is believed
 *    on the strength of a single job.
 *
 * Nothing here is per-account. The worker is one box shared by every account,
 * so how fast it runs is a property of the deployment; learning it per account
 * would give a new customer no history and the operator a private answer to a
 * question that is not about them.
 */

/**
 * The fallback, for a deployment that has not finished a lecture yet.
 *
 * These are the figures measured on the box on 9 Sept 2026, not the retired
 * constants above: a new account should start from what this hardware does
 * today rather than from what different hardware did in August.
 */
export const SHIPPED_PACE = Object.freeze({
  // Import time is bytes over bandwidth, and bytes are roughly bitrate times
  // length -- so a fraction of the source's length is the right SHAPE, with the
  // constant standing for this deployment's bitrate over its bandwidth. That is
  // exactly the quantity that varies between proxy exits, which is why it is
  // learned per deployment and why the default only has to be reasonable.
  //
  // 0.11 is a 1080p lecture at about 2.6 Mbit a second of video (631 MB for
  // 1936s, measured on the box) arriving at around 3 MB/s. THE 0.03 THIS
  // REPLACES was six times too fast: it made a queued lecture quote five
  // minutes less than the same lecture quoted the moment its download started,
  // and an estimate that JUMPS UP when work begins is the one thing an ETA must
  // never do. Erring slightly slow here is deliberate -- before any measurement
  // exists the number should come down as it learns, not climb.
  importPerSourceSec: 0.11,
  transcribePerSourceSec: 0.27,
  // Scoring is Ollama over a shortlist, so it grows with the transcript and has
  // a floor no short lecture gets under. A flat 75s was the single worst
  // constant in the old model.
  scorePerSourceSec: 0.15,
  scoreFloorSec: 60,
  // With the parallel render lanes of v3.173.0. It was 110 when clips rendered
  // strictly one after another.
  renderPerClipSec: 40,
  // Uploading the finished clips and closing the job out.
  tailSec: 20,
});

// How far a learned rate may sit from the shipped one before it is refused as a
// mis-measurement rather than believed as a slow box. See property 3.
const SANE_LOW = 0.25;
const SANE_HIGH = 4;
// How many lectures' worth of confidence the shipped rate is treated as
// carrying. The blend is `n / (n + PRIOR_STRENGTH)` toward what was measured,
// so the estimate starts moving on the FIRST finished lecture and approaches
// the measurement as the evidence accumulates -- rather than ignoring two
// lectures completely and then jumping on the third.
const PRIOR_STRENGTH = 2;
// Learned from the most recent lectures only. See property 2.
const WINDOW = 25;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The seconds of source a lecture actually asked the worker to process. */
export function sourceSecondsOf(project) {
  if (!project) return 0;
  const end = Number(project.sourceEndSec);
  const start = Number(project.sourceStartSec || 0);
  // A selected stretch is what was processed; the whole file's length is what
  // was processed when none was selected.
  if (Number.isFinite(end) && end > start) return end - start;
  const whole = Number(project.durationSec || project.sourceDurationSec || 0);
  return Number.isFinite(whole) && whole > 0 ? whole : 0;
}

/**
 * What this deployment's worker actually costs, per phase.
 *
 * Returns the shipped pace with whichever phases there is enough history to
 * replace, plus `samples` and `learned` so a caller -- and the operator's own
 * Health screen -- can tell a measurement from a default.
 */
export function measurePace(projects) {
  const finished = (Array.isArray(projects) ? projects : [])
    .filter(project => project && project.status === 'done' && project.timings)
    .sort((a, b) => Number(b.completedAt || 0) - Number(a.completedAt || 0))
    .slice(0, WINDOW);

  const rates = { importPerSourceSec: [], transcribePerSourceSec: [], scorePerSourceSec: [], renderPerClipSec: [] };
  for (const project of finished) {
    const timings = project.timings || {};
    const seconds = sourceSecondsOf(project);
    const clips = Number(project.clipCount || 0);
    if (seconds > 0) {
      // A ZERO IMPORT IS A CACHE HIT, NOT A FAST IMPORT. The worker keeps a
      // source cache keyed by URL and window, so a re-run of the same stretch
      // reports 0s -- and learning from those would teach the model that
      // downloads are free and quote an ETA that omits the longest phase.
      if (Number(timings.import) > 1) rates.importPerSourceSec.push(Number(timings.import) / seconds);
      if (Number(timings.transcribe) > 0) rates.transcribePerSourceSec.push(Number(timings.transcribe) / seconds);
      if (Number(timings.score) > 0) rates.scorePerSourceSec.push(Number(timings.score) / seconds);
    }
    if (clips > 0 && Number(timings.render) > 0) rates.renderPerClipSec.push(Number(timings.render) / clips);
  }

  const pace = { ...SHIPPED_PACE };
  const samples = {};
  const learned = {};
  for (const [key, values] of Object.entries(rates)) {
    samples[key] = values.length;
    const middle = values.length ? median(values) : null;
    const shipped = SHIPPED_PACE[key];
    if (middle !== null && middle > shipped * SANE_LOW && middle < shipped * SANE_HIGH) {
      const weight = values.length / (values.length + PRIOR_STRENGTH);
      pace[key] = Math.round((shipped + weight * (middle - shipped)) * 1000) / 1000;
      // How far this rate has moved from the shipped one, 0 to 1. A flag would
      // say only that SOMETHING was learned; the operator's Health screen wants
      // to know how much of the answer is now this box's own.
      learned[key] = Math.round(weight * 100) / 100;
    } else {
      learned[key] = 0;
    }
  }
  // What a whole lecture costs, for the jobs waiting AHEAD of one in the queue.
  // Their own lengths are not knowable from here -- only how many there are --
  // so the typical job this deployment runs is the honest stand-in.
  const totals = finished.map(project => Number(project.timings?.total || 0)).filter(value => value > 0);
  const wholeJob = totals.length ? median(totals) : null;
  return { ...pace, jobTotalSec: wholeJob, samples, learned, lectures: finished.length };
}

/**
 * The seconds each phase of one lecture is expected to cost, at this pace.
 *
 * The dashboard's ETA is the unfinished part of the phase running now plus all
 * of every phase after it, so it needs the whole shape rather than a total.
 */
export function phaseCosts(pace, sourceSec, clips) {
  const rates = pace || SHIPPED_PACE;
  const seconds = Math.max(0, Number(sourceSec) || 0);
  const count = Math.max(1, Number(clips) || 1);
  return {
    import: Math.max(30, seconds * rates.importPerSourceSec),
    transcribe: Math.max(20, seconds * rates.transcribePerSourceSec),
    score: Math.max(rates.scoreFloorSec, seconds * rates.scorePerSourceSec),
    render: count * rates.renderPerClipSec,
    tail: rates.tailSec,
  };
}
