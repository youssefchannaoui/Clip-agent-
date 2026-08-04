import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const stateFile = path.join(config.dataDir, 'state.json');

function blankState() {
  return {
    engineVersion: 3,
    selectedTemplateId: config.defaultTemplateId,
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
      enabled: true,
      minimumScore: 80,
      minimumQuality: 72,
      maxPerProject: 4,
      skipReviewRequired: true,
    },
    projects: [],
    clips: [],
    rerenderJobs: [],
    socialConnections: {},
    oauthStates: {},
    publishingSettings: {
      enabled: false,
      youtube: { enabled: false, accountId: '', privacy: 'private', categoryId: '22', notifySubscribers: true, madeForKids: false },
      instagram: { enabled: false, accountId: '', shareToFeed: true },
      facebook: { enabled: false, accountId: '' },
      tiktok: { enabled: false, accountId: '', privacy: 'SELF_ONLY', allowComments: true, allowDuet: false, allowStitch: false },
    },
    publishJobs: [],
    authUsers: [],
    authSessions: [],
    authOAuthStates: {},
    authSettings: { onboardingComplete: false },
    log: [],
    legacyState: null,
  };
}

function migrate(parsed) {
  const fresh = blankState();
  if (parsed?.engineVersion === 2 || parsed?.engineVersion === 3) {
    return {
      ...fresh,
      ...parsed,
      engineVersion: 3,
      clipSettings: { ...fresh.clipSettings, ...(parsed.clipSettings || {}) },
      musicSettings: { ...fresh.musicSettings, ...(parsed.musicSettings || {}), required: true },
      automationSettings: { ...fresh.automationSettings, ...(parsed.automationSettings || {}) },
      rerenderJobs: Array.isArray(parsed.rerenderJobs) ? parsed.rerenderJobs : [],
      socialConnections: parsed.socialConnections && typeof parsed.socialConnections === 'object' ? parsed.socialConnections : {},
      oauthStates: parsed.oauthStates && typeof parsed.oauthStates === 'object' ? parsed.oauthStates : {},
      publishingSettings: {
        ...fresh.publishingSettings,
        ...(parsed.publishingSettings || {}),
        youtube: { ...fresh.publishingSettings.youtube, ...(parsed.publishingSettings?.youtube || {}) },
        instagram: { ...fresh.publishingSettings.instagram, ...(parsed.publishingSettings?.instagram || {}) },
        facebook: { ...fresh.publishingSettings.facebook, ...(parsed.publishingSettings?.facebook || {}) },
        tiktok: { ...fresh.publishingSettings.tiktok, ...(parsed.publishingSettings?.tiktok || {}) },
      },
      publishJobs: Array.isArray(parsed.publishJobs) ? parsed.publishJobs : [],
      authUsers: Array.isArray(parsed.authUsers) ? parsed.authUsers : [],
      authSessions: Array.isArray(parsed.authSessions) ? parsed.authSessions : [],
      authOAuthStates: parsed.authOAuthStates && typeof parsed.authOAuthStates === 'object' ? parsed.authOAuthStates : {},
      authSettings: { ...fresh.authSettings, ...(parsed.authSettings || {}) },
    };
  }

  if (parsed && typeof parsed === 'object') {
    fresh.legacyState = {
      migratedAt: Date.now(),
      projects: Array.isArray(parsed.projects) ? parsed.projects.length : 0,
      clips: Array.isArray(parsed.clips) ? parsed.clips.length : 0,
      note: 'Previous state was preserved during the self-hosted engine migration.',
    };
    if (parsed.musicSettings?.volumePercent != null) fresh.musicSettings.volumePercent = parsed.musicSettings.volumePercent;
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

export function log(message, level = 'info') {
  state.log.unshift({ at: Date.now(), level, message: String(message) });
  state.log.length = Math.min(200, state.log.length);
  console.log(`[${level}] ${message}`);
  save();
}

export function clipSettings() { return { ...blankState().clipSettings, ...(state.clipSettings || {}) }; }
export function setClipSettings(next) { state.clipSettings = { ...clipSettings(), ...next }; save(); }
export function musicSettings() { return { ...blankState().musicSettings, ...(state.musicSettings || {}), required: true }; }
export function setMusicSettings(next) { state.musicSettings = { ...musicSettings(), ...next, required: true }; save(); }
export function automationSettings() { return { ...blankState().automationSettings, ...(state.automationSettings || {}) }; }
export function setAutomationSettings(next) { state.automationSettings = { ...automationSettings(), ...next }; save(); }

export function publishingSettings() {
  const fresh = blankState().publishingSettings;
  const current = state.publishingSettings || {};
  return {
    ...fresh, ...current,
    youtube: { ...fresh.youtube, ...(current.youtube || {}) },
    instagram: { ...fresh.instagram, ...(current.instagram || {}) },
    facebook: { ...fresh.facebook, ...(current.facebook || {}) },
    tiktok: { ...fresh.tiktok, ...(current.tiktok || {}) },
  };
}
export function setPublishingSettings(next) {
  const current = publishingSettings();
  state.publishingSettings = {
    ...current, ...next,
    youtube: { ...current.youtube, ...(next.youtube || {}) },
    instagram: { ...current.instagram, ...(next.instagram || {}) },
    facebook: { ...current.facebook, ...(next.facebook || {}) },
    tiktok: { ...current.tiktok, ...(next.tiktok || {}) },
  };
  save();
}
