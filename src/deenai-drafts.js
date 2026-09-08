/**
 * What DeenAI proposes, kept apart from what the account has.
 *
 * Three kinds of record live here and they share one rule: **nothing written
 * from this module ever changes a clip, a schedule or a setting.** A variant
 * is a DRAFT beside the clip; an experiment is a note about something to try;
 * a recommendation outcome is what happened afterwards. Applying any of them
 * is a separate, explicit act by the person, through the route that already
 * owns that change.
 *
 * That ceiling is not caution for its own sake — it is the same reasoning
 * `deenai-actions.js` records for navigation. An assistant that can rewrite a
 * clip's title in place can rewrite it wrongly, silently, on a clip the person
 * was not looking at; and `social.js` skips a TikTok target for any clip not
 * approved manually, so an automated approve would quietly drop a destination
 * the customer pays for. A draft the person previews and accepts cannot do
 * either.
 */

import { state } from './store.js';
import { readUserSetting, writeUserSetting } from './tenancy.js';

export const MAX_DRAFTS_PER_CLIP = 6;
export const MAX_EXPERIMENTS = 40;
export const MAX_RECOMMENDATIONS = 200;

function idOf(user) {
  const id = String(user?.id || user || '');
  return id || null;
}

/**
 * The clip, looked up SCOPED TO THE OWNER rather than fetched and then
 * checked. Every IDOR this codebase has audited for has the other shape.
 */
export function ownClip(user, clipId) {
  const userId = idOf(user);
  if (!userId) return null;
  const id = String(clipId || '');
  if (!id) return null;
  return (state.clips || []).find(c => c.id === id && (!c.userId || c.userId === userId)) || null;
}

function readList(userId, key) {
  const stored = readUserSetting(state, userId, key);
  return Array.isArray(stored) ? stored : [];
}

/* ------------------------------------------------------------------ */
/* Clip variants — a previewable draft, never an overwrite              */
/* ------------------------------------------------------------------ */

/** The fields a draft may carry. Metadata only: nothing here re-renders. */
export const DRAFT_FIELDS = Object.freeze(['title', 'description', 'hashtags']);

function cleanDraftPatch(patch) {
  const out = {};
  const src = patch && typeof patch === 'object' ? patch : {};
  if (typeof src.title === 'string') out.title = src.title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (typeof src.description === 'string') out.description = String(src.description).trim().slice(0, 2200);
  if (src.hashtags !== undefined) {
    const tags = Array.isArray(src.hashtags) ? src.hashtags : String(src.hashtags || '').split(/[\s,]+/);
    out.hashtags = tags
      .map(t => String(t || '').replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 30))
      .filter(Boolean)
      .slice(0, 12);
  }
  return out;
}

/**
 * Store a proposed variant of a clip's metadata.
 *
 * The ORIGINAL is copied onto the draft at the moment it is made, so a
 * preview can always show both halves and an accepted draft can be undone
 * against what was really there rather than against whatever the clip says
 * later. A test drives exactly that: the clip is byte-identical after the
 * draft is created.
 */
export function createClipVariant(user, clipId, patch, { reason = '', now = 0 } = {}) {
  const userId = idOf(user);
  const clip = ownClip(user, clipId);
  if (!clip) throw Object.assign(new Error('That clip is not on this account.'), { statusCode: 404 });
  const changes = cleanDraftPatch(patch);
  if (!Object.keys(changes).length) {
    throw Object.assign(new Error('A variant needs a title, a description or hashtags.'), { statusCode: 400 });
  }
  const drafts = readList(userId, 'deenaiDrafts');
  const draft = {
    id: `d-${userId.slice(0, 6)}-${now || 0}-${drafts.length}`,
    clipId: clip.id,
    createdAt: now || 0,
    reason: String(reason || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    changes,
    // What it would replace, captured now.
    before: {
      title: String(clip.title || ''),
      description: String(clip.description || ''),
      hashtags: Array.isArray(clip.hashtags) ? clip.hashtags.slice(0, 12) : [],
    },
    status: 'draft',
    decidedAt: 0,
  };
  const forClip = drafts.filter(d => d.clipId === clip.id);
  const others = drafts.filter(d => d.clipId !== clip.id);
  const kept = forClip.slice(-(MAX_DRAFTS_PER_CLIP - 1)).concat([draft]);
  writeUserSetting(state, userId, 'deenaiDrafts', others.concat(kept));
  return draft;
}

export function draftsFor(user, clipId) {
  const userId = idOf(user);
  if (!userId) return [];
  const all = readList(userId, 'deenaiDrafts');
  return clipId ? all.filter(d => d.clipId === String(clipId)) : all;
}

export function findDraft(user, draftId) {
  return draftsFor(user).find(d => d.id === String(draftId || '')) || null;
}

function saveDrafts(userId, drafts) {
  writeUserSetting(state, userId, 'deenaiDrafts', drafts.slice(-400));
}

/**
 * Mark a draft accepted or discarded.
 *
 * This records the DECISION. The write to the clip itself is done by the
 * caller — `agent.updateClip`, the one function that already owns a metadata
 * change and knows it must not move `stylePending` (a title change has never
 * re-rendered a clip and must not start).
 */
export function decideDraft(user, draftId, decision, { now = 0 } = {}) {
  const userId = idOf(user);
  if (!userId) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  if (!['accepted', 'discarded'].includes(decision)) {
    throw Object.assign(new Error('A draft is accepted or discarded.'), { statusCode: 400 });
  }
  const drafts = readList(userId, 'deenaiDrafts');
  const draft = drafts.find(d => d.id === String(draftId || ''));
  if (!draft) throw Object.assign(new Error('That draft is not on this account.'), { statusCode: 404 });
  if (draft.status !== 'draft') {
    throw Object.assign(new Error(`That draft was already ${draft.status}.`), { statusCode: 409 });
  }
  draft.status = decision;
  draft.decidedAt = now || 0;
  saveDrafts(userId, drafts);
  return draft;
}

/* ------------------------------------------------------------------ */
/* Growth experiments                                                   */
/* ------------------------------------------------------------------ */

/**
 * One thing to try, with what to measure and when to look.
 *
 * An experiment with no measure is an opinion with a date on it, so `measure`
 * and `checkAfterDays` are required rather than optional — that is the whole
 * difference between advice and an experiment.
 */
export function createExperiment(user, input, { now = 0 } = {}) {
  const userId = idOf(user);
  if (!userId) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  const src = input && typeof input === 'object' ? input : {};
  const hypothesis = String(src.hypothesis || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  const measure = String(src.measure || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!hypothesis) throw Object.assign(new Error('An experiment needs something it is testing.'), { statusCode: 400 });
  if (!measure) throw Object.assign(new Error('An experiment needs a measure — what result to check.'), { statusCode: 400 });
  const days = Math.min(60, Math.max(1, Math.round(Number(src.checkAfterDays) || 7)));
  const list = readList(userId, 'deenaiExperiments');
  const experiment = {
    id: `x-${userId.slice(0, 6)}-${now || 0}-${list.length}`,
    createdAt: now || 0,
    hypothesis,
    measure,
    checkAfterDays: days,
    checkAt: (now || 0) + days * 24 * 60 * 60 * 1000,
    goal: String(src.goal || '').slice(0, 24),
    clipIds: (Array.isArray(src.clipIds) ? src.clipIds : []).map(String).slice(0, 12),
    status: 'running',
    outcome: '',
    closedAt: 0,
  };
  writeUserSetting(state, userId, 'deenaiExperiments', list.concat([experiment]).slice(-MAX_EXPERIMENTS));
  return experiment;
}

export function experiments(user) {
  const userId = idOf(user);
  return userId ? readList(userId, 'deenaiExperiments') : [];
}

export function closeExperiment(user, id, { outcome = '', result = 'done', now = 0 } = {}) {
  const userId = idOf(user);
  if (!userId) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  const list = readList(userId, 'deenaiExperiments');
  const found = list.find(x => x.id === String(id || ''));
  if (!found) throw Object.assign(new Error('That experiment is not on this account.'), { statusCode: 404 });
  found.status = ['worked', 'did not work', 'inconclusive', 'done'].includes(result) ? result : 'done';
  found.outcome = String(outcome || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  found.closedAt = now || 0;
  writeUserSetting(state, userId, 'deenaiExperiments', list);
  return found;
}

/* ------------------------------------------------------------------ */
/* Recommendation outcomes                                              */
/* ------------------------------------------------------------------ */

/**
 * Did the thing DeenAI suggested actually help?
 *
 * Without this the assistant can never be wrong in a way anyone can see, and
 * an assistant that is never measured is one nobody should trust. It is the
 * account's own record: what was suggested, whether it was followed, and what
 * the person observed.
 */
export function recordRecommendationResult(user, input, { now = 0 } = {}) {
  const userId = idOf(user);
  if (!userId) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 });
  const src = input && typeof input === 'object' ? input : {};
  const recommendation = String(src.recommendation || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!recommendation) throw Object.assign(new Error('Say which recommendation this is about.'), { statusCode: 400 });
  const followed = src.followed === undefined ? null : Boolean(src.followed);
  const list = readList(userId, 'deenaiRecommendations');
  const row = {
    id: `r-${userId.slice(0, 6)}-${now || 0}-${list.length}`,
    at: now || 0,
    conversationId: String(src.conversationId || '').slice(0, 48),
    recommendation,
    followed,
    result: String(src.result || '').replace(/\s+/g, ' ').trim().slice(0, 300),
    // helpful / not helpful / unclear — the account's own verdict, never ours.
    verdict: ['helpful', 'not helpful', 'unclear'].includes(src.verdict) ? src.verdict : 'unclear',
  };
  writeUserSetting(state, userId, 'deenaiRecommendations', list.concat([row]).slice(-MAX_RECOMMENDATIONS));
  return row;
}

export function recommendations(user) {
  const userId = idOf(user);
  return userId ? readList(userId, 'deenaiRecommendations') : [];
}

/** How the assistant has actually been doing, for the account to see. */
export function recommendationScore(user) {
  const rows = recommendations(user);
  const judged = rows.filter(r => r.verdict !== 'unclear');
  return {
    total: rows.length,
    judged: judged.length,
    helpful: judged.filter(r => r.verdict === 'helpful').length,
    followed: rows.filter(r => r.followed === true).length,
  };
}
