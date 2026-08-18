import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { migrateLibraryOwnership } from './audio.js';
import {
  migrateToMultiTenant, findUnownedRecords,
  readUserSetting, writeUserSetting, ownedBy,
} from './tenancy.js';

const stateFile = path.join(config.dataDir, 'state.json');

/**
 * Settings that used to be one global value shared by everybody. They are now
 * held per account under `state.userSettings[userId]`; these are the starting
 * values a brand new account gets.
 */
export function settingDefaults() {
  return {
    clipSettings: {
      clipsPerVideo: config.clipsPerVideo,
      clipMinSeconds: config.clipMinSeconds,
      clipMaxSeconds: config.clipMaxSeconds,
    },
    musicSettings: {
      required: true,
      volumePercent: config.musicVolumePercent,
      shuffle: true,
    },
    automationSettings: {
      // Off by default, deliberately. Shipping this on meant every clip was
      // auto-approved and scheduled the moment it rendered, so nothing ever
      // reached the review queue. Once the clip AI was switched on scores
      // cleared the 80 threshold every time, and a live account had 14 clips
      // queued to publish to a real YouTube channel that no one had seen.
      // Reviewing first is the safe default; turning this on is a choice the
      // account makes once it trusts the scoring.
      enabled: false,
      minimumScore: 80,
      minimumQuality: 72,
      maxPerProject: 4,
      skipReviewRequired: true,
    },
    publishingSettings: {
      enabled: false,
      youtube: { enabled: false, accountId: '', privacy: 'private', categoryId: '22', notifySubscribers: true, madeForKids: false },
      instagram: { enabled: false, accountId: '', shareToFeed: true },
      facebook: { enabled: false, accountId: '' },
      tiktok: { enabled: false, accountId: '', privacy: 'SELF_ONLY', allowComments: true, allowDuet: false, allowStitch: false },
    },
    selectedTemplateId: config.defaultTemplateId,
  };
}

function blankState() {
  return {
    engineVersion: 4,
    projects: [],
    clips: [],
    rerenderJobs: [],
    socialConnections: {},
    oauthStates: {},
    publishJobs: [],
    authUsers: [],
    authSessions: [],
    authOAuthStates: {},
    authSettings: { onboardingComplete: false },
    userSettings: {},
    log: [],
    legacyState: null,
  };
}

function migrate(parsed) {
  const fresh = blankState();
  if ([2, 3, 4].includes(parsed?.engineVersion)) {
    return {
      ...fresh,
      ...parsed,
      engineVersion: 4,
      rerenderJobs: Array.isArray(parsed.rerenderJobs) ? parsed.rerenderJobs : [],
      socialConnections: parsed.socialConnections && typeof parsed.socialConnections === 'object' ? parsed.socialConnections : {},
      oauthStates: parsed.oauthStates && typeof parsed.oauthStates === 'object' ? parsed.oauthStates : {},
      publishJobs: Array.isArray(parsed.publishJobs) ? parsed.publishJobs : [],
      authUsers: Array.isArray(parsed.authUsers) ? parsed.authUsers : [],
      authSessions: Array.isArray(parsed.authSessions) ? parsed.authSessions : [],
      authOAuthStates: parsed.authOAuthStates && typeof parsed.authOAuthStates === 'object' ? parsed.authOAuthStates : {},
      authSettings: { ...fresh.authSettings, ...(parsed.authSettings || {}) },
      userSettings: parsed.userSettings && typeof parsed.userSettings === 'object' ? parsed.userSettings : {},
      // The old global settings are deliberately carried through untouched so
      // that migrateToMultiTenant can move them to the owner's account below.
    };
  }

  if (parsed && typeof parsed === 'object') {
    fresh.legacyState = {
      migratedAt: Date.now(),
      projects: Array.isArray(parsed.projects) ? parsed.projects.length : 0,
      clips: Array.isArray(parsed.clips) ? parsed.clips.length : 0,
      note: 'Previous state was preserved during the self-hosted engine migration.',
    };
  }
  return fresh;
}

function load() {
  try { return migrate(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); }
  catch { return blankState(); }
}

export const state = load();
let writing = false;
let dirty = false;

export function save() {
  if (writing) { dirty = true; return; }
  writing = true;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFile(tmp, JSON.stringify(state, null, 2), error => {
    if (!error) { try { fs.renameSync(tmp, stateFile); } catch {} }
    writing = false;
    if (dirty) { dirty = false; save(); }
  });
}

/**
 * Log lines carry the account they belong to.
 *
 * The activity feed used to be one global list shown to everyone, which leaked
 * other customers' lecture titles. Entries with no account are system-level and
 * are shown only to the operator.
 */
export function log(message, level = 'info', userId = null) {
  state.log.unshift({ at: Date.now(), level, message: String(message), userId: userId || null });
  state.log.length = Math.min(400, state.log.length);
  console.log(`[${level}] ${message}`);
  save();
}

export function logFor(user, limit = 60) {
  const entries = Array.isArray(state.log) ? state.log : [];
  if (!user?.id) return [];
  // Every account sees only its own entries, the owner included. The owner is
  // not a separate admin console -- it is the first registered account using the
  // same dashboard -- so an unfiltered branch here put other customers' sign-in
  // emails, token charges and lecture titles straight into its notification
  // bell. tenancy.js says routes use strict ownership "so the operator does not
  // see paying customers' clips in their own dashboard by accident"; this is
  // that rule applied to the log.
  //
  // Entries with no userId are system-level (startup, migrations, orphan
  // records). They belong in the server console, not in anyone's feed.
  return entries.filter(entry => entry?.userId === user.id).slice(0, limit);
}

/* ------------------------------------------------------------------ */
/* Boot migration                                                       */
/* ------------------------------------------------------------------ */

/**
 * The owner account, resolved without importing auth.js (which imports this
 * module). auth.js bootstraps the same `user_admin` id on a fresh install, so
 * the two agree.
 */
function bootOwnerId() {
  const users = Array.isArray(state.authUsers) ? state.authUsers : [];
  return users.find(user => user?.role === 'owner')?.id || users[0]?.id || 'user_admin';
}

const migrationSummary = migrateToMultiTenant(state, bootOwnerId());
if (!migrationSummary.alreadyMigrated) {
  save();
  log(`Migrated existing data for multi-account use: ${JSON.stringify(migrationSummary)}`);
}
// Music that predates accounts becomes the shared starter library, so every
// new account has at least one usable track. Music is mandatory on every clip.
try {
  const adoptedTracks = migrateLibraryOwnership(bootOwnerId());
  if (adoptedTracks) log(`Marked ${adoptedTracks} existing music track(s) as the shared starter library.`);
} catch (error) {
  console.error('Music library migration failed:', error.message);
}

const orphanRecords = findUnownedRecords(state);
if (orphanRecords.length) {
  log(`WARNING: ${orphanRecords.length} record(s) have no owner and are hidden from every account.`, 'warn');
}
export { migrationSummary };

/* ------------------------------------------------------------------ */
/* Per-user settings                                                    */
/* ------------------------------------------------------------------ */

function userIdOf(user) {
  if (!user) return '';
  return typeof user === 'string' ? user : String(user.id || '');
}

function readSetting(user, key) {
  const id = userIdOf(user);
  if (!id) return null;
  return readUserSetting(state, id, key) ?? null;
}

export function clipSettings(user) {
  return { ...settingDefaults().clipSettings, ...(readSetting(user, 'clipSettings') || {}) };
}
export function setClipSettings(user, next) {
  const id = userIdOf(user);
  if (!id) throw new Error('Settings need an account.');
  writeUserSetting(state, id, 'clipSettings', { ...clipSettings(user), ...next });
  save();
  return clipSettings(user);
}

export function musicSettings(user) {
  return { ...settingDefaults().musicSettings, ...(readSetting(user, 'musicSettings') || {}), required: true };
}
export function setMusicSettings(user, next) {
  const id = userIdOf(user);
  if (!id) throw new Error('Settings need an account.');
  writeUserSetting(state, id, 'musicSettings', { ...musicSettings(user), ...next, required: true });
  save();
  return musicSettings(user);
}

export function automationSettings(user) {
  return { ...settingDefaults().automationSettings, ...(readSetting(user, 'automationSettings') || {}) };
}
export function setAutomationSettings(user, next) {
  const id = userIdOf(user);
  if (!id) throw new Error('Settings need an account.');
  writeUserSetting(state, id, 'automationSettings', { ...automationSettings(user), ...next });
  save();
  return automationSettings(user);
}

export function publishingSettings(user) {
  const fresh = settingDefaults().publishingSettings;
  const current = readSetting(user, 'publishingSettings') || {};
  return {
    ...fresh, ...current,
    youtube: { ...fresh.youtube, ...(current.youtube || {}) },
    instagram: { ...fresh.instagram, ...(current.instagram || {}) },
    facebook: { ...fresh.facebook, ...(current.facebook || {}) },
    tiktok: { ...fresh.tiktok, ...(current.tiktok || {}) },
  };
}
export function setPublishingSettings(user, next) {
  const id = userIdOf(user);
  if (!id) throw new Error('Settings need an account.');
  const current = publishingSettings(user);
  writeUserSetting(state, id, 'publishingSettings', {
    ...current, ...next,
    youtube: { ...current.youtube, ...(next.youtube || {}) },
    instagram: { ...current.instagram, ...(next.instagram || {}) },
    facebook: { ...current.facebook, ...(next.facebook || {}) },
    tiktok: { ...current.tiktok, ...(next.tiktok || {}) },
  });
  save();
  return publishingSettings(user);
}

export function selectedTemplateId(user) {
  return readSetting(user, 'selectedTemplateId') || settingDefaults().selectedTemplateId;
}
export function setSelectedTemplateId(user, id) {
  const userId = userIdOf(user);
  if (!userId) throw new Error('Settings need an account.');
  writeUserSetting(state, userId, 'selectedTemplateId', String(id || ''));
  save();
}

/**
 * The account that owns a clip, as a user-like object.
 *
 * Background work (scheduled publishing, re-renders) runs with no request and
 * therefore no signed-in user, but it still has to act with the clip owner's
 * settings and the clip owner's social connections rather than the operator's.
 */
export function ownerOfRecord(record) {
  const id = record?.userId || record?.ownerId || '';
  if (!id) return null;
  return (state.authUsers || []).find(user => user.id === id) || { id, role: 'creator' };
}

// Whether a clip's music requirement is satisfied.
//
// Music is mandatory by default and every gate below used to say so directly:
// `!clip.musicVerified` in eight places. A job may now deliberately be rendered
// without a nasheed, and for those clips musicVerified is false and honest --
// nothing was mixed, so nothing was verified. musicEnabled is what records that
// this was asked for, so the two are never confused.
//
// Absent means the old behaviour: required. A clip from before this existed
// must not become exempt by having no opinion recorded.
export function musicSatisfied(clip) {
  if (!clip) return false;
  if (clip.musicEnabled === false) return true;
  return Boolean(clip.musicVerified);
}

export function clipsOwnedBy(userId) { return ownedBy(state.clips, userId); }
export function projectsOwnedBy(userId) { return ownedBy(state.projects, userId); }
