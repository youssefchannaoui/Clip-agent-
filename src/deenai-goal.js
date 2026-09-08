/**
 * The creator's own goal, and the profile DeenAI reasons about.
 *
 * DeenAI V2 answers differently depending on what the account is actually
 * trying to do: "post this one tonight" is a different clip for somebody
 * chasing subscribers than for somebody chasing retention. That choice was
 * nowhere in the product, so every answer was written for an average creator
 * who does not exist.
 *
 * It is stored per account under `state.userSettings[uid].creator`, read
 * through the same `readUserSetting` every other setting uses, so it is
 * tenant-scoped by construction rather than by a check bolted on afterwards.
 *
 * THE GOAL SHAPES RANKING AND COPY, NEVER THE FACTS. Every figure DeenAI
 * quotes is computed the same way whatever goal is set; the goal decides
 * which of those figures leads and how a list is ordered. A goal that changed
 * the arithmetic would be a second source of truth about one account.
 */

import { state } from './store.js';
import { readUserSetting, writeUserSetting } from './tenancy.js';

/**
 * The six goals, in the order they are offered.
 *
 * `ranks` names the deterministic signals the ranking code weighs for that
 * goal — it is documentation AND the contract the ranker reads, so a goal
 * cannot be offered without something in the app knowing how to serve it
 * (invariant 9: no dead controls).
 *
 * `measure` is what the account should look at afterwards, and it is
 * deliberately honest: where this product holds no audience data, the measure
 * is something the account can see in DeenClipped itself.
 */
export const GOALS = Object.freeze({
  views: Object.freeze({
    id: 'views',
    label: 'More views',
    blurb: 'Reach as many people as possible with each clip.',
    ranks: Object.freeze(['hookStrength', 'shortDuration', 'scoreReasons']),
    measure: 'views per post, once you have imported results for at least five posts',
  }),
  followers: Object.freeze({
    id: 'followers',
    label: 'More followers',
    blurb: 'Turn viewers into people who come back.',
    ranks: Object.freeze(['completeEnding', 'seriesFromOneLecture', 'scoreReasons']),
    measure: 'follower change between two imported measurement dates',
  }),
  subscribers: Object.freeze({
    id: 'subscribers',
    label: 'More YouTube subscribers',
    blurb: 'Grow the channel rather than the individual clip.',
    ranks: Object.freeze(['youtubeReady', 'completeEnding', 'seriesFromOneLecture']),
    measure: 'subscriber change on YouTube between two imported measurement dates',
  }),
  retention: Object.freeze({
    id: 'retention',
    label: 'Better viewer retention',
    blurb: 'Keep people watching to the end.',
    ranks: Object.freeze(['shortDuration', 'completeEnding', 'captionReadability']),
    measure: 'completion rate on imported results, compared with your own baseline',
  }),
  consistency: Object.freeze({
    id: 'consistency',
    label: 'More consistent posting',
    blurb: 'Never miss a posting window.',
    ranks: Object.freeze(['readyToSchedule', 'fillsEmptySlot']),
    measure: 'posting windows filled this week, on the Schedule',
  }),
  yield: Object.freeze({
    id: 'yield',
    label: 'More usable clips from each lecture',
    blurb: 'Get more keepers out of every import.',
    ranks: Object.freeze(['fromBestLecture', 'scoreReasons']),
    measure: 'your keep rate per lecture, in the Lecture library',
  }),
});

export const GOAL_IDS = Object.freeze(Object.keys(GOALS));

/** The starting profile. No goal is chosen for anybody — the account picks. */
export function profileDefaults() {
  return {
    goal: '',
    niche: '',
    language: '',
    // Posts a week the account can realistically sustain. 0 means "not said",
    // and DeenAI then reads the plan's own posting capacity rather than
    // inventing a number.
    weeklyCapacity: 0,
    notes: '',
    setAt: 0,
  };
}

function idOf(user) {
  const id = String(user?.id || user || '');
  return id || null;
}

export function creatorProfile(user) {
  const id = idOf(user);
  if (!id) return profileDefaults();
  const stored = readUserSetting(state, id, 'creator');
  const merged = { ...profileDefaults(), ...(stored && typeof stored === 'object' ? stored : {}) };
  // A goal id read back from disk is only honoured while it is still one we
  // offer: a retired goal must not keep steering an account's answers from a
  // record nothing can see or change.
  if (!GOALS[merged.goal]) merged.goal = '';
  merged.weeklyCapacity = clampCapacity(merged.weeklyCapacity);
  return merged;
}

function clampCapacity(value) {
  const n = Math.round(Number(value) || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, 70);
}

function text(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Save what the account told us, and NOTHING it did not.
 *
 * A patch carrying only `goal` must leave the niche alone — a settings object
 * spread wholesale into storage is how one screen quietly clears another
 * screen's field, and this repo has already paid for that once with TikTok's
 * per-account options.
 */
export function setCreatorProfile(user, patch) {
  const id = idOf(user);
  if (!id) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  const current = creatorProfile(user);
  const next = { ...current };
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'goal')) {
    const goal = String(patch.goal || '');
    if (goal && !GOALS[goal]) {
      throw Object.assign(new Error('That is not one of the growth goals.'), { statusCode: 400 });
    }
    next.goal = goal;
  }
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'niche')) next.niche = text(patch.niche, 80);
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'language')) next.language = text(patch.language, 40);
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'notes')) next.notes = text(patch.notes, 400);
  if (patch && Object.prototype.hasOwnProperty.call(patch, 'weeklyCapacity')) {
    next.weeklyCapacity = clampCapacity(patch.weeklyCapacity);
  }
  next.setAt = next.goal ? (current.setAt || 1) : 0;
  writeUserSetting(state, id, 'creator', next);
  return next;
}

/** The goal record, or null while the account has not chosen one. */
export function goalOf(user) {
  const profile = creatorProfile(user);
  return profile.goal ? GOALS[profile.goal] : null;
}

/** The list the screen draws, with the account's own choice marked. */
export function goalOptions(user) {
  const chosen = creatorProfile(user).goal;
  return GOAL_IDS.map(id => ({ ...GOALS[id], chosen: id === chosen }));
}
