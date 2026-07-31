import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, log, automationSettings, publishingSettings } from './store.js';
import { nextSlot } from './slots.js';
import * as engine from './local-engine.js';
import * as social from './social.js';

let timer = null;
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

export async function submitVideo(url, title = '') { return engine.submitVideo(url, title); }

export function approveClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (!clip.musicVerified || !clip.renderVerified || !clip.templateId) throw new Error('This clip did not pass mandatory music/template verification.');
  if (clip.status !== 'waiting') throw new Error('Only clips waiting for review can be approved.');
  clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'manual';
  if (publishingSettings().enabled && publishingSettings().tiktok?.enabled) clip.tiktokConsentAt = Date.now();
  save(); tick().catch(() => {}); return clip;
}

export function scheduleSelected(ids = []) {
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
        if (!clip.musicVerified || !clip.renderVerified || !clip.templateId) {
          throw new Error('This clip did not pass mandatory music/template verification.');
        }
        clip.status = 'approved';
        clip.approvedAt = Date.now();
        clip.approvedBy = 'manual';
        if (publishingSettings().enabled && publishingSettings().tiktok?.enabled) clip.tiktokConsentAt = Date.now();
      }
      if (clip.status !== 'approved') throw new Error(`This clip cannot be scheduled from its current ${clip.status} state.`);

      scheduleApprovedClip(clip);
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

export function updateClip(id, fields = {}) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  for (const key of ['title', 'description', 'hashtags']) if (typeof fields[key] === 'string') clip[key] = fields[key].trim();
  save(); return clip;
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
  const settings = publishingSettings();
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

export function scheduleApprovedClip(clip) {
  if (clip.status !== 'approved') return clip;
  const taken = state.clips.map(item => item.scheduledAt).filter(Boolean);
  clip.scheduledAt = clip.scheduledAt || nextSlot(taken);
  setTargets(clip);
  for (const target of clip.targets || []) target.nextTryAt = clip.scheduledAt;
  clip.status = 'scheduled'; save();
  const destinationText = clip.targets?.length ? ` to ${clip.targets.map(target => target.provider).join(', ')}` : ' for local export';
  log(`Scheduled "${clip.title}"${destinationText}${clip.approvedBy === 'automation' ? ' automatically' : ''}.`);
  return clip;
}

export function readyNow(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (!clip.musicVerified || !clip.renderVerified) throw new Error('The clip has not passed render verification.');
  if ((clip.targets || []).some(target => ['publishing', 'processing', 'posted'].includes(target.status))) throw new Error('This clip already has an active or completed platform upload.');
  clip.status = 'ready'; clip.readyAt = Date.now(); clip.scheduledAt = null; clip.targets = []; save(); return clip;
}

export function markPosted(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  clip.status = 'posted'; clip.postedAt = Date.now(); clip.scheduledAt = null; save();
  log(`Marked "${clip.title}" as posted manually.`); return clip;
}

export function deleteClip(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if ((clip.targets || []).some(target => ['publishing', 'processing'].includes(target.status))) throw new Error('Wait for the active platform transfer to finish before deleting this clip.');
  state.clips = state.clips.filter(item => item.id !== id); save();
  for (const file of [clip.clipFile, clip.thumbFile]) { try { removeDataFile(file); } catch {} }
}

function applyAutomation() {
  const settings = automationSettings();
  if (!settings.enabled) return;
  const publish = publishingSettings();
  const enabledAutomaticProviders = ['youtube', 'instagram', 'facebook'].filter(provider => publish[provider]?.enabled);
  if (publish.enabled && !enabledAutomaticProviders.length) return; // TikTok cannot be silently auto-consented.
  const projects = new Map();
  for (const clip of state.clips) {
    if (!projects.has(clip.projectId)) projects.set(clip.projectId, []);
    projects.get(clip.projectId).push(clip);
  }
  for (const clips of projects.values()) {
    const alreadyAutomatic = clips.filter(clip => clip.approvedBy === 'automation' && ['approved', 'scheduled', 'publishing', 'ready', 'posted', 'publish_failed'].includes(clip.status)).length;
    let remaining = Math.max(0, settings.maxPerProject - alreadyAutomatic);
    if (!remaining) continue;
    const eligible = clips
      .filter(clip => clip.status === 'waiting' && clip.musicVerified && clip.renderVerified)
      .filter(clip => Number(clip.score || 0) >= settings.minimumScore)
      .filter(clip => Number(clip.quality?.overall || 0) >= settings.minimumQuality)
      .filter(clip => !settings.skipReviewRequired || !clip.reviewRequired)
      .sort((a, b) => Number(b.quality?.overall || b.score || 0) - Number(a.quality?.overall || a.score || 0));
    for (const clip of eligible.slice(0, remaining)) {
      clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'automation';
      log(`Automation approved "${clip.title}" (${clip.score}/100, quality ${clip.quality?.overall || 0}/100).`);
      remaining--;
    }
  }
}

function updateClipPublishingStatus(clip) {
  const targets = clip.targets || [];
  if (!targets.length) return;
  if (targets.every(target => target.status === 'posted')) {
    const firstCompletion = clip.status !== 'posted';
    clip.status = 'posted'; clip.postedAt = clip.postedAt || Date.now(); clip.scheduledAt = null;
    if (firstCompletion) log(`"${clip.title}" posted successfully to ${targets.map(target => target.provider).join(', ')}.`);
    return;
  }
  if (targets.some(activeTarget)) {
    clip.status = targets.some(target => ['publishing', 'processing'].includes(target.status)) ? 'publishing' : 'scheduled';
    return;
  }
  if (targets.every(finishedTarget)) {
    clip.status = targets.some(target => target.status === 'failed') ? 'publish_failed' : 'ready';
    clip.readyAt = clip.readyAt || Date.now();
  }
}

async function processTarget(clip, target) {
  const now = Date.now();
  if (target.nextTryAt && target.nextTryAt > now) return;
  if (target.processingStartedAt && now - target.processingStartedAt > config.socialProcessingTimeoutMs) {
    target.status = 'failed'; target.stage = `${target.provider} processing timed out`; target.error = `${target.provider} did not finish processing within the allowed time.`; target.nextTryAt = null;
    updateClipPublishingStatus(clip); save(); return;
  }
  target.updatedAt = now;
  try {
    let result;
    const canResumeProcessing = target.status === 'processing' || (target.externalId && ['instagram', 'tiktok'].includes(target.provider) && target.providerState?.stage !== 'uploading');
    if (canResumeProcessing) {
      target.stage = `Checking ${target.provider} processing status`;
      result = await social.pollTarget(clip, target);
    } else {
      target.status = 'publishing'; target.stage = `Preparing ${target.provider} upload`; target.error = null; target.updatedAt = Date.now(); save();
      log(`Preparing "${clip.title}" for ${target.provider}.`);
      const file = await engine.socialPublishFile(clip.id, target.provider);
      target.stage = `Uploading video to ${target.provider}`; target.updatedAt = Date.now(); save();
      log(`Uploading "${clip.title}" to ${target.provider}.`);
      result = await social.publishTarget(clip, target, file);
    }
    if (result?.pending) {
      target.status = 'processing'; target.externalId = result.externalId || target.externalId;
      target.providerState = result.providerState || target.providerState || {};
      target.stage = result.providerState?.platformStatus || (target.provider === 'instagram' ? 'Instagram is preparing the Reel' : 'TikTok is processing/moderating the post');
      target.processingStartedAt ||= Date.now();
      target.nextTryAt = Date.now() + config.socialPollIntervalMs; target.updatedAt = Date.now(); target.error = null;
    } else {
      target.status = 'posted'; target.postId = result?.postId || target.externalId || '';
      target.postUrl = result?.postUrl || ''; target.stage = 'Published'; target.nextTryAt = null; target.updatedAt = Date.now(); target.error = null; delete target.processingStartedAt;
      log(`Published "${clip.title}" to ${target.provider}${target.accountName ? ` (${target.accountName})` : ''}.`);
    }
  } catch (error) {
    target.attempts = Number(target.attempts || 0) + 1;
    target.error = error.message; target.updatedAt = Date.now();
    const retryable = error.retryable !== false && target.attempts < config.socialMaxAttempts;
    if (retryable) {
      target.status = 'retrying'; target.stage = `Retrying ${target.provider}`; target.nextTryAt = Date.now() + social.retryDelay(target.attempts);
      log(`${target.provider} publishing will retry for "${clip.title}" (${target.attempts}/${config.socialMaxAttempts}): ${error.message}`, 'warn');
    } else {
      target.status = 'failed'; target.stage = `${target.provider} failed`; target.nextTryAt = null; delete target.processingStartedAt;
      log(`${target.provider} publishing failed for "${clip.title}": ${error.message}`, 'error');
    }
  }
  updateClipPublishingStatus(clip); save();
}

async function publishClip(clip) {
  if (publishing.has(clip.id)) return;
  publishing.add(clip.id);
  try {
    for (const target of clip.targets || []) {
      if (activeTarget(target)) await processTarget(clip, target);
    }
    updateClipPublishingStatus(clip); save();
  } finally { publishing.delete(clip.id); }
}

export async function publishNow(id) {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  if (!clip.musicVerified || !clip.renderVerified) throw new Error('The clip has not passed render verification.');
  if (['posted', 'publishing'].includes(clip.status)) throw new Error(`This clip is already ${clip.status}.`);
  if (clip.status === 'waiting') {
    clip.status = 'approved'; clip.approvedAt = Date.now(); clip.approvedBy = 'manual';
    if (publishingSettings().enabled && publishingSettings().tiktok?.enabled) clip.tiktokConsentAt = Date.now();
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
    if (publishingSettings().enabled && publishingSettings().tiktok?.enabled) clip.tiktokConsentAt = Date.now();
    clip.scheduledAt = Date.now(); setTargets(clip);
    for (const target of clip.targets || []) target.nextTryAt = Date.now();
    clip.status = 'scheduled'; save();
  }
  const providers = (clip.targets || []).filter(target => target.status !== 'posted').map(target => target.provider);
  log(`Publishing started for "${clip.title}"${providers.length ? ` to ${providers.join(', ')}` : ''}.`);
  publishClip(clip).catch(error => {
    log(`Publishing crashed for "${clip.title}": ${error.message}`, 'error');
  });
  return clip;
}

export function retryPublishing(id, provider = '') {
  const clip = clipById(id);
  if (!clip) throw new Error('That clip no longer exists.');
  const targets = (clip.targets || []).filter(target => !provider || target.provider === provider);
  if (!targets.length) throw new Error('No matching publishing destination exists for this clip.');
  for (const target of targets) {
    if (target.status === 'posted') continue;
    target.status = target.externalId && ['instagram', 'tiktok'].includes(target.provider) && target.providerState?.stage !== 'uploading' ? 'processing' : 'retrying';
    target.error = null; target.nextTryAt = Date.now();
  }
  clip.status = 'scheduled'; clip.scheduledAt = Date.now(); save();
  publishClip(clip).catch(error => log(error.message, 'error'));
  return clip;
}

export async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    applyAutomation();
    for (const clip of state.clips) {
      if (clip.status === 'approved') {
        try { scheduleApprovedClip(clip); }
        catch (error) {
          clip.status = 'waiting'; clip.approvedBy = null; clip.approvedAt = null;
          log(`Could not automatically schedule "${clip.title}": ${error.message}`, 'warn');
        }
      }
      if (clip.status === 'scheduled' && clip.scheduledAt && clip.scheduledAt <= Date.now()) {
        if (publishingSettings().enabled && clip.targets?.length) await publishClip(clip);
        else { clip.status = 'ready'; clip.readyAt = Date.now(); log(`"${clip.title}" is ready to download and post.`); }
      } else if (clip.status === 'publishing' || clip.targets?.some(target => activeTarget(target) && (!target.nextTryAt || target.nextTryAt <= Date.now()))) {
        await publishClip(clip);
      }
    }
    save();
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
