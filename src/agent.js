import fs from 'node:fs';
import * as ownerFeed from './owner-feed.js';
import * as mailer from './mailer.js';
import path from 'node:path';
import { config } from './config.js';
import * as billing from './billing.js';
import { state, save, log, automationSettings, publishingSettings, ownerOfRecord, musicSatisfied, isAyahEcho, emailNotifsOff } from './store.js';
import * as push from './push.js';
import { ownedBy, ownerOf } from './tenancy.js';
import { sanitiseClipStyle } from './templates.js';
import { nextSlot, startOfZonedDay, postTimesFor as slotTimes } from './slots.js';
import * as engine from './local-engine.js';
import * as social from './social.js';
import * as nudges from './nudges.js';
import { codeFor } from './referrals.js';

let timer = null;
// The nudge sweep walks every account; every fifteen seconds would be waste.
let lastNudgeSweep = 0;
const NUDGE_SWEEP_EVERY = 10 * 60 * 1000;
let ticking = false;
const publishing = new Set();

function clipById(id) { return state.clips.find(clip => clip.id === id) || null; }
function removeDataFile(file) {
  if (!file) return;
  const resolved = path.resolve(file);
  const allowedRoot = path.resolve(config.dataDir) + path.sep;
  if (resolved.startsWith(allowedRoot)) fs.rmSync(resolved, { force: true });
}
function activeTarget(target) { return ['scheduled', 'retrying', 'publishing', 'processing'].includes(target.status); }
function finishedTarget(target) { return ['posted', 'failed', 'blocked'].includes(target.status); }

// One email per clip, when its LAST platform finishes -- not one per platform.
// A clip posting to four channels in the same slot must not send four emails
// in the same minute, and a partial failure belongs in the same message as
// the successes so the user sees the whole picture at once.
function maybeEmailPostSummary(clip) {
  const targets = clip.targets || [];
  if (!targets.length || !targets.every(finishedTarget)) return;
  if (clip.postSummaryEmailedAt) return;
  if (!targets.some(target => target.status === 'posted')) return; // total failure is the schedule's story, not a celebration email
  clip.postSummaryEmailedAt = Date.now();
  const owner = ownerOfRecord(clip);
  if (!owner?.id) return;
  const base = config.publicBaseUrl || 'https://deenclipped.online';
  /*
   * Push first, and NOT behind the email switch. They are two channels, and
   * somebody who turned product email off has not asked to stop being told
   * their clip went live -- they asked to stop being mailed. The subscription
   * is push's own preference: no subscription, no push (src/push.js).
   */
  const posted = targets.filter(target => target.status === 'posted');
  push.notify(owner.id, {
    title: posted.length === targets.length ? 'Clip published' : 'Clip published, with a problem',
    body: `"${clip.title || 'Your clip'}" is live on ${posted.map(whereText).join(', ') || 'your channel'}.`,
    url: `${base}/app#schedule`, tag: `clip-posted-${clip.id}`,
  }).catch(() => {});
  if (!owner.email || emailNotifsOff(owner.id)) return;
  mailer.send({
    to: owner.email,
    ...mailer.postSummaryMessage({
      clipTitle: clip.title,
      targets,
      scheduleUrl: `${base}/app#schedule`,
      // The invite rides on the one email that arrives at a moment of
      // delight. The paragraph writes itself out when nothing is configured.
      invite: config.referralsEnabled
        ? { url: `${base}/r/${codeFor(state, owner)}`, bonus: config.referralBonusPaid, discount: Boolean(config.stripeReferralCoupon) }
        : null,
    }),
  }).catch(() => {});
}


export async function submitVideo(url, title = '', userId = '', options = {}) { return engine.submitVideo(url, title, userId, options); }
export async function sourceInfo(url) { return engine.sourceInfo(url); }

// Statuses that mean the decision has already been made. Approving one of
// these again is what a second tap on a stale card is -- the card was showing
// the state it had -- so it answers yes, not an error message.
const DECIDED = ['approved', 'scheduled', 'publishing', 'retrying', 'ready', 'posted'];

/**
 * Record the reviewer's consent to post this clip to TikTok -- per ACCOUNT.
 *
 * One clip going to three TikToks is three posts, and TikTok's content-sharing
 * guidelines make consent a per-post act. A single timestamp on the clip said
 * "they agreed to TikTok" and would have carried one approval onto three
 * separate posts. `tiktokConsentAt` stays as well, because every clip already
 * on disk has one and the publish path still reads it.
 */
function stampTikTokConsent(clip, publishing) {
  const at = Date.now();
  clip.tiktokConsentAt = at;
  const ids = publishing.tiktok?.accountIds?.length
    ? publishing.tiktok.accountIds
    : [publishing.tiktok?.accountId || ''];
  clip.tiktokConsent = { ...(clip.tiktokConsent || {}) };
  for (const id of ids) clip.tiktokConsent[String(id || 'default')] = at;
}

export function approveClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (DECIDED.includes(clip.status)) return clip;
  if (clip.status === 'rejected') throw new Error('This clip was rejected. Restore it first, then approve it.');
  if (clip.status !== 'waiting') throw new Error(`This clip is still ${clip.status === 'processing' ? 'rendering' : clip.status}, so there is nothing to approve yet.`);
  if (!musicSatisfied(clip) || !clip.renderVerified || !clip.templateId) throw new Error('This clip did not pass mandatory music/template verification.');
  clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'manual';
  clip.scheduleError = null;
  const publishing = publishingSettings(ownerOfRecord(clip));
  if (publishing.enabled && publishing.tiktok?.enabled) stampTikTokConsent(clip, publishing);
  save();
  // Legacy only. Clips are rendered at full quality from the start now, so
  // approving one queues nothing -- that churn ("why is it re-rendering when I
  // approve?") is exactly what this stopped doing. A clip rendered before that
  // change still holds a quarter-resolution draft that must never be posted,
  // and this is its one promotion.
  if (clip.renderQuality === 'draft') {
    try { engine.queueClipRerender(clip.id, clip.templateId || '', { priority: 1, quality: 'final' }); }
    catch (error) { log(`The full-quality render of "${clip.title}" could not start: ${error.message}`, 'warn', ownerOf(clip)); }
  }
  tick().catch(() => {}); return clip;
}

// Rejecting is a real, persisted decision. It used to live only in the browser,
// so reviewing a large batch and rejecting half of it survived nothing: a reload
// put every rejected clip back in the queue. Deleting is not the answer either --
// a one-tap deck button should not destroy a render.
export function rejectClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (clip.status === 'posted' || (clip.targets || []).some(target => target.status === 'posted')) {
    throw new Error('A clip that has already posted cannot be rejected.');
  }
  clip.status = 'rejected';
  clip.rejectedAt = Date.now();
  clip.scheduledAt = null;
  clip.approvedBy = null;
  clip.approvedAt = null;
  clip.targets = [];
  save();
  return clip;
}

// Undoing a rejection returns the clip to the queue it came from.
export function unrejectClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (clip.status !== 'rejected') return clip;
  clip.status = 'waiting';
  clip.rejectedAt = null;
  save();
  return clip;
}

export function scheduleSelected(ids = [], { at = null, day = null } = {}) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!uniqueIds.length) throw new Error('Select at least one clip to schedule.');
  if (uniqueIds.length > 100) throw new Error('Schedule no more than 100 clips at once.');

  const results = [];
  let scheduled = 0;
  let alreadyScheduled = 0;

  for (const clipId of uniqueIds) {
    const clip = clipById(clipId);
    if (!clip) {
      results.push({ id: clipId, ok: false, error: 'That clip no longer exists.' });
      continue;
    }

    try {
      if (clip.status === 'posted' || (clip.targets || []).some(target => target.status === 'posted')) {
        throw new Error('This clip has already been posted.');
      }
      if ((clip.targets || []).some(target => ['publishing', 'processing'].includes(target.status))) {
        throw new Error('This clip is currently being transferred to a platform.');
      }
      if (clip.status === 'scheduled' && clip.scheduledAt) {
        alreadyScheduled++;
        results.push({ id: clip.id, ok: true, alreadyScheduled: true, status: clip.status, scheduledAt: clip.scheduledAt });
        continue;
      }

      if (['ready', 'publish_failed', 'scheduled'].includes(clip.status)) pullBack(clip.id);
      if (clip.status === 'waiting') {
        if (!musicSatisfied(clip) || !clip.renderVerified || !clip.templateId) {
          throw new Error('This clip did not pass mandatory music/template verification.');
        }
        clip.status = 'approved';
        clip.approvedAt = Date.now();
        clip.approvedBy = 'manual';
        const publishing = publishingSettings(ownerOfRecord(clip));
  if (publishing.enabled && publishing.tiktok?.enabled) stampTikTokConsent(clip, publishing);
      }
      if (clip.status !== 'approved') throw new Error(`This clip cannot be scheduled from its current ${clip.status} state.`);

      scheduleApprovedClip(clip, { at, day });
      scheduled++;
      results.push({ id: clip.id, ok: true, status: clip.status, scheduledAt: clip.scheduledAt });
    } catch (error) {
      results.push({ id: clip.id, ok: false, error: error.message });
    }
  }

  const failed = results.filter(result => !result.ok).length;
  if (scheduled) log(`Scheduled ${scheduled} selected clip${scheduled === 1 ? '' : 's'} from the Library.`);
  if (failed) log(`${failed} selected Library clip${failed === 1 ? '' : 's'} could not be scheduled.`, 'warn');
  save();
  return { scheduled, alreadyScheduled, failed, results };
}

/**
 * Move one scheduled clip onto an exact slot, swapping with whatever is there.
 *
 * Dragging a card in the Schedule is the only way this is reached, and the two
 * halves of a swap have to happen together or the drag can strand a clip: move
 * A onto B's slot first and B is homeless; free B first and A's old slot is
 * open for the scheduler to hand to somebody else. So both writes happen here,
 * after every check, with nothing between them.
 *
 * `at` is an exact instant, never a day — the caller dropped the card on one
 * specific square, and quietly putting the clip somewhere else would make the
 * grid disagree with what the person just did.
 */
export function moveClipToSlot(clipId, at) {
  const when = Number(at);
  if (!Number.isFinite(when) || when <= 0) throw new Error('That is not a posting slot.');
  const clip = clipById(String(clipId || ''));
  if (!clip) throw new Error('That clip no longer exists.');
  if (!clip.scheduledAt) throw new Error('That clip is not on the schedule.');

  // A slot that has passed cannot receive anything: the poster has already
  // walked over it, so a clip dropped there would simply never go out.
  if (when < Date.now()) throw new Error('That slot has already passed.');

  const settled = (item) => item.status === 'posted'
    || (item.targets || []).some(target => ['posted', 'publishing', 'processing'].includes(target.status));
  if (settled(clip)) throw new Error('This clip has already gone out.');

  const from = Number(clip.scheduledAt);
  if (from === when) return { moved: false, swapped: false, scheduledAt: when };
  if (from < Date.now()) throw new Error('This clip is already on its way out.');

  // Only ever this account's own clips, so a drag cannot reach across owners.
  const held = ownedBy(state.clips, ownerOf(clip))
    .find(item => item.id !== clip.id && Number(item.scheduledAt) === when);
  if (held && settled(held)) throw new Error('The clip in that slot has already gone out.');

  // scheduledAt is the only stored truth; the label beside it is computed at
  // read time in server.js, so there is nothing else to keep in step.
  clip.scheduledAt = when;
  if (held) held.scheduledAt = from;
  save();
  log(held
    ? `Swapped two scheduled clips on the calendar.`
    : `Moved a scheduled clip to a different slot.`);
  return { moved: true, swapped: Boolean(held), scheduledAt: when, swappedWith: held ? held.id : null };
}

export function updateClip(id, fields = {}) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');

  for (const key of ['title', 'description', 'hashtags']) {
    if (typeof fields[key] === 'string') clip[key] = fields[key].trim();
  }

  // The editor's caption text. This arrived in every Save and was silently
  // dropped -- the UI toasted "saved" while the edit went nowhere. The burned
  // captions come from the transcript at render time, so an edit also marks
  // the video out of date.
  if (typeof fields.transcript === 'string') {
    const text = fields.transcript.trim().slice(0, 20000);
    if (text !== String(clip.transcript || '') && !isAyahEcho(clip, text)) {
      clip.transcript = text;
      clip.transcriptEdited = true;
      clip.stylePending = true;
      clip.updatedAt = Date.now();
    }
  }

  // Style tweaks belong to THIS clip. Writing them to the shared template is how
  // moving one caption used to move it on every clip in the lecture.
  if (fields.styleOverrides && typeof fields.styleOverrides === 'object') {
    const patch = sanitiseClipStyle(fields.styleOverrides);
    if (Object.keys(patch).length) {
      clip.styleOverrides = { ...(clip.styleOverrides || {}), ...patch };
      // The file on disk was rendered with the old values, so it no longer
      // matches what the editor is showing. Re-rendering stays an explicit
      // action (it is free, per billing) — this only marks that one is owed.
      clip.stylePending = true;
      clip.updatedAt = Date.now();
    }
  }
  /**
   * The trim. Clip-local seconds, as ranges to KEEP.
   *
   * The render pipeline learned to cut in v3.2.0 and nothing has ever asked it
   * to: the only writer of cutsSec was the internal preview lane, so a finished
   * and tested cut engine sat behind no control at all.
   *
   * Kept as a list of ranges rather than a start/end pair because that is the
   * shape the worker already takes, and because delete-a-section is the same
   * primitive with a gap in the middle -- a split is two ranges, a deletion is
   * the complement. Clamped and ordered here so the worker never has to defend
   * itself against a backwards range.
   */
  if (Array.isArray(fields.cutsSec)) {
    const span = Math.max(0, Number(clip.endSec || 0) - Number(clip.startSec || 0));
    const ranges = fields.cutsSec
      .map(pair => (Array.isArray(pair) ? [Number(pair[0]), Number(pair[1])] : null))
      .filter(pair => pair && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
      .map(([from, to]) => [
        Math.max(0, Math.min(span, Math.min(from, to))),
        Math.max(0, Math.min(span, Math.max(from, to))),
      ])
      // A range shorter than a quarter second is a mis-drag, not an edit, and
      // ffmpeg's concat of it produces a frame or two of noise.
      .filter(([from, to]) => to - from >= 0.25)
      .sort((a, b) => a[0] - b[0]);
    const next = JSON.stringify(ranges);
    const nowHeld = JSON.stringify(clip.cutsSec || []);
    if (next !== nowHeld) {
      // Keeping the whole clip is expressed by having no cuts at all, not by
      // one range covering everything: the worker skips the pre-cut plate
      // entirely when the list is empty, which is one less thing to go wrong.
      if (!ranges.length || (ranges.length === 1 && ranges[0][0] <= 0.05 && ranges[0][1] >= span - 0.05)) {
        delete clip.cutsSec;
      } else {
        clip.cutsSec = ranges;
      }
      clip.stylePending = true;
      clip.updatedAt = Date.now();
    }
  }

  // An explicit reset drops every override and goes back to the plain template.
  if (fields.clearStyleOverrides) {
    delete clip.styleOverrides;
    clip.stylePending = true;
    clip.updatedAt = Date.now();
  }

  const wantsTrimChange = Object.prototype.hasOwnProperty.call(fields, 'startSec')
    || Object.prototype.hasOwnProperty.call(fields, 'endSec')
    || Object.prototype.hasOwnProperty.call(fields, 'durationMs');

  if (wantsTrimChange) {
    if (clip.status === 'posted' || (clip.targets || []).some(target => target.status === 'posted')) {
      throw new Error('A posted clip cannot be trimmed. Create a new variant instead.');
    }
    const currentStart = Number(clip.startSec) || 0;
    const currentEnd = Number(clip.endSec) || currentStart + (Number(clip.durationMs) || 0) / 1000;
    const startSec = Object.prototype.hasOwnProperty.call(fields, 'startSec') ? Number(fields.startSec) : currentStart;
    const endSec = Object.prototype.hasOwnProperty.call(fields, 'endSec') ? Number(fields.endSec) : currentEnd;
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec + 3) {
      throw new Error('Choose a valid clip length of at least 3 seconds.');
    }
    clip.startSec = Math.round(startSec * 100) / 100;
    clip.endSec = Math.round(endSec * 100) / 100;
    clip.durationMs = Math.round((clip.endSec - clip.startSec) * 1000);
    clip.renderVerified = false;
    clip.updatedAt = Date.now();
  }

  save(); return clip;
}

/**
 * Take a clip OFF the schedule without un-reviewing it.
 *
 * Youssef, 3 Sept 2026: "make this button a remove and it removes ... so you
 * can remove the clips you want to."
 *
 * Deliberately NOT pullBack. That un-approves the clip and sends it back to
 * the review queue, so curating a day's schedule would mean re-reviewing
 * everything you moved -- the approval is a decision a person made and
 * removing a clip from Tuesday is not a retraction of it. The clip returns to
 * "Ready to schedule", where the schedule picker can put it back.
 *
 * `scheduleHold` is what makes that stick. tick() schedules every approved
 * clip with no slot, so without it the next sweep (ten minutes at most) would
 * hand this clip a new time and the button would read as broken. Scheduling it
 * again -- by the picker or by a drag -- clears the hold, because that is a
 * fresh instruction.
 */
export function unschedule(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (clip.status === 'posted' || (clip.targets || []).some(target => target.status === 'posted')) {
    throw new Error('This clip has already posted, so there is nothing left to remove from the schedule.');
  }
  if ((clip.targets || []).some(target => ['publishing', 'processing'].includes(target.status))) {
    throw new Error('This clip is being sent to a platform right now and cannot be taken off the schedule safely.');
  }
  clip.status = 'approved';
  clip.scheduledAt = null;
  clip.readyAt = null;
  clip.targets = [];
  clip.scheduleError = null;
  clip.scheduleErrorAt = null;
  clip.scheduleHold = true;
  save();
  log(`"${clip.title || clip.id}" was taken off the schedule.`, 'info', ownerOf(clip));
  return clip;
}

export function pullBack(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (clip.status === 'posted' || (clip.targets || []).some(target => target.status === 'posted')) throw new Error('A clip that has already posted to a platform cannot be pulled back.');
  if ((clip.targets || []).some(target => ['publishing', 'processing'].includes(target.status))) throw new Error('This clip is already being transferred to a platform and cannot be pulled back safely.');
  clip.status = 'waiting'; clip.scheduledAt = null; clip.readyAt = null; clip.approvedBy = null; clip.targets = [];
  save(); return clip;
}

function setTargets(clip) {
  // Destinations come from the clip owner's publishing settings and the clip
  // owner's connected accounts. Reading a global value here is how a clip ends
  // up uploaded to somebody else's channel.
  const settings = publishingSettings(ownerOfRecord(clip));
  if (!settings.enabled) { clip.targets = []; return; }
  const targets = social.enabledTargetsForClip(clip);
  if (!targets.length) {
    if (clip.approvedBy === 'automation' && settings.tiktok?.enabled) {
      throw new Error('TikTok requires explicit consent for each post, so an automatically selected clip must be manually approved before TikTok can receive it.');
    }
    throw new Error('Automatic publishing is enabled, but no connected destination is enabled for this clip.');
  }
  clip.targets = targets;
}

// Two ways to ask for a time, kept apart because they mean different things.
// `day` is a calendar day, floored to midnight in the ACCOUNT's zone, so the
// browser's clock and zone cannot decide which day was meant. `at` is an
// instant -- one posting slot, pressed in the week grid -- honoured exactly
// when it is free. Either way the allocator refuses the past and skips what is
// taken, so a full day or a claimed slot rolls forward and the caller is told
// where it landed. Without any of this, every day's button landed the clip in
// the next open slot regardless of which day was pressed.
const LEAD_MS = 15 * 60_000;
export function scheduleApprovedClip(clip, { at = null, day = null } = {}) {
  if (clip.status !== 'approved') return clip;
  // Reaching here at all means somebody asked for this clip to be scheduled --
  // tick() skips held clips before it calls in. A fresh instruction spends the
  // hold, so a removed clip put back by the picker behaves normally afterwards.
  clip.scheduleHold = false;
  const taken = ownedBy(state.clips, ownerOf(clip)).map(item => item.scheduledAt).filter(Boolean);
  const exact = Number(at), whole = Number(day);
  // How many windows a day this account may fill. Everyone gets the configured
  // POST_TIMES; Studio gets more, inserted between them rather than spread over
  // the clock, so the account keeps publishing in the part of the day it chose.
  const owner = ownerOfRecord(clip);
  // atLeast: the operator schedules on Studio's windows too. This widens one
  // account's own day and takes nothing from anyone, which is why it does not
  // use the paid tier that queuePriority does.
  const windows = billing.atLeast(owner, 'studio') ? slotTimes(config.postSlotsStudio) : null;
  let opts;
  if (Number.isFinite(exact) && exact > 0) {
    // nextSlot keeps a 15-minute lead so nothing is scheduled a breath from
    // now. Applied to an instant that IS the slot, that lead pushes the slot
    // you pressed just out of reach and quietly hands back the next one -- so
    // here the lead guards the floor instead, and the slot itself is exact.
    opts = { from: Math.max(Date.now() + LEAD_MS, exact), leadMinutes: 0, times: windows };
  } else if (Number.isFinite(whole) && whole > 0) {
    opts = { from: Math.max(Date.now(), startOfZonedDay(whole)), times: windows };
  }
  clip.scheduledAt = clip.scheduledAt || nextSlot(taken, opts || { times: windows });
  setTargets(clip);
  for (const target of clip.targets || []) target.nextTryAt = clip.scheduledAt;
  clip.status = 'scheduled'; clip.scheduleError = null; clip.scheduleErrorAt = null; save();
  const destinationText = clip.targets?.length ? ` to ${clip.targets.map(whereText).join(', ')}` : ' for local export';
  log(`Scheduled "${clip.title}"${destinationText}${clip.approvedBy === 'automation' ? ' automatically' : ''}.`, 'info', ownerOf(clip));
  return clip;
}

export function readyNow(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (!musicSatisfied(clip) || !clip.renderVerified) throw new Error('The clip has not passed render verification.');
  if ((clip.targets || []).some(target => ['publishing', 'processing', 'posted'].includes(target.status))) throw new Error('This clip already has an active or completed platform upload.');
  clip.status = 'ready'; clip.readyAt = Date.now(); clip.scheduledAt = null; clip.targets = []; save(); return clip;
}

export function markPosted(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  clip.status = 'posted'; clip.postedAt = Date.now(); clip.scheduledAt = null; save();
  log(`Marked "${clip.title}" as posted manually.`, 'info', ownerOf(clip)); return clip;
}

export function deleteClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if ((clip.targets || []).some(target => ['publishing', 'processing'].includes(target.status))) throw new Error('Wait for the active platform transfer to finish before deleting this clip.');
  state.clips = state.clips.filter(item => item.id !== id);
  // Its pending re-renders go with it -- otherwise the worker runs the whole
  // job (remote: re-downloads the source) and fails at import.
  state.rerenderJobs = state.rerenderJobs.filter(job => job.clipId !== id || job.status === 'processing');
  save();
  for (const file of [clip.clipFile, clip.thumbFile, clip.sourceFile]) { try { removeDataFile(file); } catch {} }
  for (const key of [clip.clipObjectKey, clip.thumbObjectKey]) {
    if (key) engine.deleteStoredObject(key).catch(() => {});
  }
}

function applyAutomation() {
  // Automation thresholds are per account, so this runs once per account over
  // that account's clips only. A single global pass would let one customer's
  // "approve everything above 60" auto-approve another customer's clips.
  const byOwner = new Map();
  for (const clip of state.clips) {
    const owner = ownerOf(clip);
    if (!owner) continue;
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(clip);
  }
  for (const [ownerId, ownerClips] of byOwner) applyAutomationForOwner(ownerId, ownerClips);
}

function applyAutomationForOwner(ownerId, ownerClips) {
  const owner = ownerOfRecord({ userId: ownerId });
  const settings = automationSettings(owner);
  if (!settings.enabled) return;
  const publish = publishingSettings(owner);
  const enabledAutomaticProviders = ['youtube', 'instagram', 'facebook'].filter(provider => publish[provider]?.enabled);
  if (publish.enabled && !enabledAutomaticProviders.length) return; // TikTok cannot be silently auto-consented.
  const projects = new Map();
  for (const clip of ownerClips) {
    if (!projects.has(clip.projectId)) projects.set(clip.projectId, []);
    projects.get(clip.projectId).push(clip);
  }
  for (const clips of projects.values()) {
    const alreadyAutomatic = clips.filter(clip => clip.approvedBy === 'automation' && ['approved', 'scheduled', 'publishing', 'ready', 'posted', 'publish_failed'].includes(clip.status)).length;
    let remaining = Math.max(0, settings.maxPerProject - alreadyAutomatic);
    if (!remaining) continue;
    const eligible = clips
      .filter(clip => clip.status === 'waiting' && musicSatisfied(clip) && clip.renderVerified)
      .filter(clip => Number(clip.score || 0) >= settings.minimumScore)
      .filter(clip => Number(clip.quality?.overall || 0) >= settings.minimumQuality)
      .filter(clip => !settings.skipReviewRequired || !clip.reviewRequired)
      .sort((a, b) => Number(b.quality?.overall || b.score || 0) - Number(a.quality?.overall || a.score || 0));
    for (const clip of eligible.slice(0, remaining)) {
      clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'automation';
      log(`Automation approved "${clip.title}" (${clip.score}/100, quality ${clip.quality?.overall || 0}/100).`, 'info', ownerId);
      remaining--;
    }
  }
}

export function refreshPublishingStatus(clip) {
  const targets = clip.targets || [];
  if (!targets.length) return;
  if (targets.some(activeTarget)) {
    clip.status = targets.some(target => ['publishing', 'processing'].includes(target.status)) ? 'publishing' : 'scheduled';
    return;
  }
  if (!targets.every(finishedTarget)) return;
  const posted = targets.filter(target => target.status === 'posted');
  if (posted.length) {
    // A clip that went out somewhere HAS been published. It used to be filed as
    // `publish_failed` whenever any one destination refused, so a clip that was
    // live on YouTube still read as unposted, sat in the schedule as work to
    // do, and offered "Post now" -- which retried the destination that had
    // already refused and left the row exactly where it was. The failed
    // destination is now the row's problem, not the whole clip's; it stays on
    // the target, where the schedule and the activity feed both read it.
    const firstCompletion = clip.status !== 'posted';
    clip.status = 'posted'; clip.postedAt = clip.postedAt || Date.now(); clip.scheduledAt = null;
    if (firstCompletion) log(`"${clip.title}" posted to ${posted.map(whereText).join(', ')}.`, 'info', ownerOf(clip));
    return;
  }
  clip.status = targets.some(target => target.status === 'failed') ? 'publish_failed' : 'ready';
  clip.readyAt = clip.readyAt || Date.now();
}

/**
 * Heal clips that went out somewhere but were filed as if they had not.
 *
 * `refreshPublishingStatus` only runs when a publish attempt finishes, so the
 * v3.20.0 rule -- a clip that posted anywhere IS posted -- reached new clips
 * and left the existing ones exactly as they were. Four clips live on YouTube
 * still sat under "4 posts missed their slots" with a Post now button that
 * would have posted them to YouTube a SECOND time, because the only thing
 * separating "retry the destination that refused" from "post the whole set"
 * is `postedAt`, and theirs was never set.
 *
 * Runs once at boot, over finished clips only: every target has reached a
 * terminal state, at least one of them posted, and the clip still reads as
 * unposted. A clip still publishing, or one where nothing landed, is left
 * alone -- this corrects the record, it does not decide anything new.
 */
export function healPartialPublishes() {
  let healed = 0;
  for (const clip of state.clips || []) {
    if (clip.postedAt) continue;
    const targets = clip.targets || [];
    if (!targets.length) continue;
    if (!targets.some(target => target.status === 'posted')) continue;
    if (!targets.every(finishedTarget)) continue;
    refreshPublishingStatus(clip);
    if (clip.postedAt) healed += 1;
  }
  if (healed) {
    save();
    log(`Corrected ${healed} clip(s) that had posted to at least one destination but were still filed as unposted.`, 'info');
  }
  return healed;
}

/** Destinations that have not posted yet -- what a retry is actually for. */
export function unpostedTargets(clip) {
  return (clip?.targets || []).filter(target => target.status !== 'posted');
}

// Instagram and TikTok hand back an id to poll. Once the platform has said
// that id failed, keeping it means every later Retry re-polls the same dead
// container and fails again forever; forgetting it lets a retry start over.
// A finished publish is kept, since retrying that must not post twice.
function forgetDeadUpload(target) {
  if (!['instagram', 'tiktok'].includes(target.provider)) return;
  if (target.providerState?.stage === 'published' && target.providerState?.publishedId) return;
  target.externalId = null;
  target.providerState = null;
}

async function processTarget(clip, target) {
  const now = Date.now();
  if (target.nextTryAt && target.nextTryAt > now) return;
  if (target.processingStartedAt && now - target.processingStartedAt > config.socialProcessingTimeoutMs) {
    target.status = 'failed'; target.stage = `${whereText(target)} processing timed out`; target.error = `${whereText(target)} did not finish processing within the allowed time.`; target.nextTryAt = null;
    maybeEmailPostSummary(clip);
    forgetDeadUpload(target);
    refreshPublishingStatus(clip); save(); return;
  }
  target.updatedAt = now;
  try {
    let result;
    const canResumeProcessing = target.status === 'processing' || (target.externalId && ['instagram', 'tiktok'].includes(target.provider) && target.providerState?.stage !== 'uploading');
    if (canResumeProcessing) {
      target.stage = `Checking ${whereText(target)} processing status`;
      result = await social.pollTarget(clip, target);
    } else {
      target.status = 'publishing'; target.stage = `Preparing ${whereText(target)} upload`; target.error = null; target.updatedAt = Date.now(); save();
      log(`Preparing "${clip.title}" for ${whereText(target)}.`, 'info', ownerOf(clip));
      const file = await engine.socialPublishFile(clip.id, target.provider);
      try {
        target.stage = `Uploading video to ${whereText(target)}`; target.updatedAt = Date.now(); save();
        log(`Uploading "${clip.title}" to ${whereText(target)}.`, 'info', ownerOf(clip));
        result = await social.publishTarget(clip, target, file);
      } finally {
        engine.releaseSocialPublishFile(file);
      }
    }
    if (result?.pending) {
      target.status = 'processing'; target.externalId = result.externalId || target.externalId;
      target.providerState = result.providerState || target.providerState || {};
      target.stage = result.providerState?.platformStatus || (target.provider === 'instagram' ? 'Instagram is preparing the Reel' : 'TikTok is processing/moderating the post');
      target.processingStartedAt ||= Date.now();
      target.nextTryAt = Date.now() + config.socialPollIntervalMs; target.updatedAt = Date.now(); target.error = null;
    } else {
      target.status = 'posted'; target.postId = result?.postId || target.externalId || '';
      ownerFeed.clipPosted(clip.title, target.provider, ownerOfRecord(clip)?.email).catch(() => {});
      target.postUrl = result?.postUrl || ''; target.stage = 'Published'; target.nextTryAt = null; target.updatedAt = Date.now(); target.error = null; delete target.processingStartedAt;
      maybeEmailPostSummary(clip);
      log(`Published "${clip.title}" to ${whereText(target)}.`, 'info', ownerOf(clip));
    }
  } catch (error) {
    // WAITING IS NOT FAILING, and it must not spend the retry budget.
    //
    // TikTok will not take a video carrying our watermark, so a clean copy is
    // rendered first -- and on a remote worker that is a queued job behind
    // whatever else the box is doing. `socialMaxAttempts` is 5 on a doubling
    // backoff, so treating each check as an attempt would burn the whole
    // budget inside half an hour and file a perfectly good clip as failed
    // while its copy was still rendering. That budget exists for TikTok's own
    // transients; a wait of ours is not one of them.
    //
    // It is bounded by the render itself: the moment that job fails,
    // socialPublishFile throws an ordinary error naming the reason and falls
    // through to the branch below.
    if (error?.pendingRender) {
      target.status = 'publishing';
      target.stage = `Rendering a copy ${whereText(target)} will accept`;
      target.error = null;
      target.nextTryAt = Date.now() + config.socialPollIntervalMs;
      target.updatedAt = Date.now();
      refreshPublishingStatus(clip); save();
      return;
    }
    target.attempts = Number(target.attempts || 0) + 1;
    target.error = error.message; target.updatedAt = Date.now();
    // `retryable === true`, not `!== false`.
    //
    // The old test read an absent flag as permission to retry, and an absent
    // flag is what every error that is not a SocialError has. So a TypeError
    // in our own code -- a real bug, which no amount of waiting fixes -- was
    // retried up to socialMaxAttempts on a backoff that reaches six hours,
    // logging a warning each time and never a failure. The bug stayed hidden
    // and the clip stayed stuck.
    //
    // Nothing legitimate is lost: jsonRequest already wraps every network and
    // 5xx failure in a SocialError that says retryable: true, so genuine
    // transients are labelled. Anything that reaches here unlabelled is a
    // surprise, and a surprise should be surfaced rather than slept on.
    const retryable = error.retryable === true && target.attempts < config.socialMaxAttempts;
    if (retryable) {
      target.status = 'retrying'; target.stage = `Retrying ${whereText(target)}`; target.nextTryAt = Date.now() + social.retryDelay(target.attempts);
      log(`${whereText(target)} publishing will retry for "${clip.title}" (${target.attempts}/${config.socialMaxAttempts}): ${error.message}`, 'warn', ownerOf(clip));
    } else {
      target.status = 'failed'; target.stage = `${whereText(target)} failed`; target.nextTryAt = null; delete target.processingStartedAt;
      maybeEmailPostSummary(clip);
      forgetDeadUpload(target);
      log(`${whereText(target)} publishing failed for "${clip.title}": ${error.message}`, 'error', ownerOf(clip));
    }
  }
  refreshPublishingStatus(clip); save();
}

async function publishClip(clip) {
  // A draft file must never leave the house. Approve queues the final render;
  // the scheduler skips drafts until it lands, and this is the backstop for
  // every other path into publishing.
  if (clip.renderQuality === 'draft') {
    throw new Error('The full-quality render is still queued for this clip. It publishes as soon as that finishes.');
  }
  if (publishing.has(clip.id)) return;
  publishing.add(clip.id);
  try {
    for (const target of clip.targets || []) {
      if (activeTarget(target)) await processTarget(clip, target);
    }
    refreshPublishingStatus(clip); save();
  } finally { publishing.delete(clip.id); }
}

export async function publishNow(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (!musicSatisfied(clip) || !clip.renderVerified) throw new Error('The clip has not passed render verification.');
  // Say it at the button, not in a background log: the review copy is a
  // draft, and the full render approve queued has not landed yet.
  if (clip.renderQuality === 'draft') {
    throw new Error('The full-quality render is still queued for this clip. It publishes as soon as that finishes.');
  }
  if (clip.status === 'publishing') throw new Error('This clip is already publishing.');
  const outstanding = unpostedTargets(clip);
  if (clip.status === 'posted') {
    // Partly out: everything that posted stays posted, and this retries only
    // what refused. Refusing the whole press because the clip is "already
    // posted" left a failed destination with no way back.
    if (!outstanding.length) throw new Error('This clip has already posted to every destination.');
    for (const target of outstanding) {
      if (target.status === 'failed') { target.status = 'retrying'; target.error = null; }
      target.nextTryAt = Date.now();
    }
    save();
    await publishClip(clip);
    return clip;
  }
  if (clip.status === 'waiting') {
    clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'manual';
    const publishing = publishingSettings(ownerOfRecord(clip));
  if (publishing.enabled && publishing.tiktok?.enabled) stampTikTokConsent(clip, publishing);
  }
  if (clip.status === 'approved') {
    clip.scheduledAt = Date.now();
    setTargets(clip);
    for (const target of clip.targets || []) target.nextTryAt = Date.now();
    clip.status = 'scheduled'; save();
  } else if (['scheduled', 'publish_failed'].includes(clip.status)) {
    clip.scheduledAt = Date.now();
    if (!clip.targets?.length) setTargets(clip);
    for (const target of clip.targets || []) {
      if (target.status === 'failed') { target.status = 'retrying'; target.error = null; }
      if (target.status !== 'posted') target.nextTryAt = Date.now();
    }
    clip.status = 'scheduled'; save();
  } else if (clip.status === 'ready') {
    clip.approvedBy = 'manual';
    const publishing = publishingSettings(ownerOfRecord(clip));
  if (publishing.enabled && publishing.tiktok?.enabled) stampTikTokConsent(clip, publishing);
    clip.scheduledAt = Date.now(); setTargets(clip);
    for (const target of clip.targets || []) target.nextTryAt = Date.now();
    clip.status = 'scheduled'; save();
  }
  const pending = (clip.targets || []).filter(target => target.status !== 'posted').map(whereText);
  log(`Publishing started for "${clip.title}"${pending.length ? ` to ${pending.join(', ')}` : ''}.`, 'info', ownerOf(clip));
  publishClip(clip).catch(error => {
    log(`Publishing crashed for "${clip.title}": ${error.message}`, 'error', ownerOf(clip));
  });
  return clip;
}

/**
 * Re-arm a clip's failed destinations.
 *
 * `selector` takes a target id, a provider, or nothing (everything). The string
 * form is the old signature and still means a provider, because saved UI and
 * any caller written before multi-account passes one.
 *
 * The id form is what multi-account needs: with three Facebook Pages on a clip,
 * selecting by provider re-armed ALL of them and cleared their error text, so
 * retrying the rate-limited Page also re-ran the one that had been refused
 * outright and destroyed the reason it gave.
 */
/**
 * One destination, named the way a person reading the activity feed would name
 * it: the platform, and which account on it.
 *
 * Line 531 already did this for the success message; everything else said only
 * the provider. That was harmless while a clip could hold one target per
 * platform, and became actively misleading the moment it could hold three --
 * "facebook failed" three times over, with no way to tell which Page.
 */
function whereText(target) {
  return `${target.provider}${target.accountName ? ` (${target.accountName})` : ''}`;
}

export function retryPublishing(id, selector = '') {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  const { targetId = '', provider = '' } = typeof selector === 'string' ? { provider: selector } : (selector || {});
  const targets = (clip.targets || []).filter(target => {
    if (targetId) return target.id === targetId;
    return !provider || target.provider === provider;
  });
  if (!targets.length) throw new Error('No matching publishing destination exists for this clip.');
  for (const target of targets) {
    if (target.status === 'posted') continue;
    target.status = target.externalId && ['instagram', 'tiktok'].includes(target.provider) && target.providerState?.stage !== 'uploading' ? 'processing' : 'retrying';
    target.error = null; target.nextTryAt = Date.now();
  }
  // A clip that already posted somewhere must not be dragged back into the
  // schedule as though nothing had gone out.
  if (clip.status !== 'posted') { clip.status = 'scheduled'; clip.scheduledAt = Date.now(); }
  save();
  publishClip(clip).catch(error => log(error.message, 'error'));
  return clip;
}

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    applyAutomation();
    for (const clip of state.clips) {
      // A clip taken off the schedule on purpose stays off. Without this the
      // next sweep would hand it a new slot within ten minutes and Remove
      // would read as a button that does nothing.
      if (clip.status === 'approved' && !clip.scheduleHold) {
        try { scheduleApprovedClip(clip); }
        catch (error) {
          // The approval STANDS. This used to push the clip back to `waiting`
          // and null the approval, so a clip with nowhere to post simply
          // refused to approve: press the button, watch it come back
          // unapproved, with the reason buried in a log nobody reads. The
          // decision is the person's; only the scheduling failed, and that is
          // now written on the clip where the screen can say it.
          if (clip.scheduleError !== error.message) {
            log(`Could not automatically schedule "${clip.title}": ${error.message}`, 'warn', ownerOf(clip));
          }
          clip.scheduleError = error.message;
          clip.scheduleErrorAt = Date.now();
        }
      }
      if (clip.renderQuality === 'draft' && clip.status === 'scheduled') continue;
      if (clip.status === 'scheduled' && clip.scheduledAt && clip.scheduledAt <= Date.now()) {
        if (publishingSettings(ownerOfRecord(clip)).enabled && clip.targets?.length) await publishClip(clip);
        else { clip.status = 'ready'; clip.readyAt = Date.now(); log(`"${clip.title}" is ready to download and post.`, 'info', ownerOf(clip)); }
      } else if (clip.status === 'publishing' || clip.targets?.some(target => activeTarget(target) && (!target.nextTryAt || target.nextTryAt <= Date.now()))) {
        await publishClip(clip);
      }
    }
    save();
    if (Date.now() - lastNudgeSweep >= NUDGE_SWEEP_EVERY) {
      lastNudgeSweep = Date.now();
      // Off the clip loop's critical path and never allowed to fail it: a
      // nudge that cannot go out is a warning, not a stalled schedule.
      nudges.sweep().then(sent => {
        for (const item of sent) log(`Sent the "${item.step}" nudge.`, 'info', item.userId);
      }).catch(error => log(`Nudge sweep failed: ${error.message}`, 'warn'));
    }
  } finally { ticking = false; }
}

export function start() {
  engine.recoverInterruptedJobs();
  for (const clip of state.clips) for (const target of clip.targets || []) {
    if (target.status === 'publishing') target.status = target.externalId && ['instagram','tiktok'].includes(target.provider) && target.providerState?.stage !== 'uploading' ? 'processing' : 'retrying';
  }
  save();
  if (timer) clearInterval(timer);
  timer = setInterval(() => tick().catch(error => log(error.message, 'error')), Math.min(15_000, config.socialPollIntervalMs));
  timer.unref?.(); tick().catch(() => {});
}
export { engine };
