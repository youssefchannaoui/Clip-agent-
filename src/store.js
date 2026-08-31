import fs from 'node:fs';
import * as secretBox from './secret-box.js';
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
      clipLengthBands: [],
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
      // Each provider carries accountIds -- the destinations a clip goes to on
      // that platform -- with accountId kept as its first entry so every reader
      // written before multi-account keeps working. See withAccountList and
      // mergeAccountList below.
      // Public, and not a setting. Youssef, 28 Aug 2026: "publishing to all
      // should be AUTOMATICLY Public no settings needed IT MUST BE PUBLIC
      // STRAIGHAWAY". The field stays in the shape so old records still load;
      // nothing writes anything else to it.
      youtube: { enabled: false, accountId: '', accountIds: [], privacy: 'public', categoryId: '22', notifySubscribers: true, madeForKids: false },
      instagram: { enabled: false, accountId: '', accountIds: [], shareToFeed: true },
      facebook: { enabled: false, accountId: '', accountIds: [] },
      // privacy starts EMPTY on purpose. TikTok's content-sharing guidelines
      // require the creator to select a privacy status themselves, with no
      // default -- a pre-filled 'SELF_ONLY' is a choice the product made for
      // them. Enabling TikTok without choosing one is refused in
      // validatePublishingSettings.
      // accountOptions holds one set of posting choices per TikTok account:
      // their guidelines make the audience a per-post decision, and one clip to
      // three TikToks is three posts. The flat fields below stay as the
      // fallback for every record written before that existed.
      tiktok: { enabled: false, accountId: '', accountIds: [], accountOptions: {}, privacy: '', allowComments: true, allowDuet: false, allowStitch: false,
        // Commercial content disclosure. Off by default, as the guidelines
        // require; the two sub-options only mean anything when it is on.
        commercialContent: false, yourBrand: false, brandedContent: false },
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

// The editor shows the matched verse in place of what Whisper heard, so a Save
// that changed nothing arrives as the ayahs joined together -- each one
// repeated once per caption block. Accepting that as an edit throws away the
// timings every later re-render needs, and the captions drift seconds out.
// Older browsers still run the old editor, so the guard lives on this side too.
export function isAyahEcho(clip, text) {
  const ayahs = Array.isArray(clip?.ayahs) ? clip.ayahs : [];
  if (!ayahs.length) return false;
  const flat = value => String(value || '').replace(/\s+/g, ' ').trim();
  const incoming = flat(text);
  if (!incoming) return false;
  return incoming === flat(ayahs.map(ayah => ayah.arabic).join(' '));
}

function migrate(parsed) {
  const fresh = blankState();
  if ([2, 3, 4].includes(parsed?.engineVersion)) {
    return {
      ...fresh,
      ...parsed,
      engineVersion: 4,
      // Clips whose "edit" is only the editor echoing back the ayahs it drew.
      // Left standing, each of those re-renders with no timings to caption
      // against and runs seconds ahead of the recitation.
      clips: (Array.isArray(parsed.clips) ? parsed.clips : []).map(clip => (
        clip?.transcriptEdited && isAyahEcho(clip, clip.transcript)
          ? { ...clip, transcriptEdited: false }
          : clip
      )),
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
  let raw;
  try { raw = fs.readFileSync(stateFile, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') return blankState();
    throw new Error(`Cannot read ${stateFile}: ${error.message}. Refusing to start rather than run on an empty state and overwrite it.`);
  }
  try { return migrate(JSON.parse(raw)); }
  catch (error) {
    // Starting blank here would be followed by the first save() writing that
    // blank state over the real file -- atomically, and for good. Keep the
    // evidence and stop.
    const backup = `${stateFile}.corrupt-${Date.now()}`;
    try { fs.copyFileSync(stateFile, backup); } catch {}
    throw new Error(`${stateFile} is not valid state (${error.message}). A copy was kept at ${backup}; fix or remove the file, then start again.`);
  }
}

export const state = load();
// Bumped on every save. /api/state hands it to the client, which echoes it
// back; an unchanged rev turns a poll into a ~60-byte handshake instead of a
// full serialize-transfer-parse-repaint cycle. The boot id makes a restart
// (or state reload) look like a change.
const bootId = Math.random().toString(36).slice(2, 10);
let revCounter = 0;
export function stateRev() { return `${bootId}-${revCounter}`; }
let writing = false;
let dirty = false;
let retryTimer = null;

export function save() {
  revCounter += 1;
  if (writing) { dirty = true; return; }
  writing = true;
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  const tmp = `${stateFile}.tmp`;
  fs.writeFile(tmp, JSON.stringify(state, null, 2), error => {
    let failed = Boolean(error);
    if (!error) {
      try { fs.renameSync(tmp, stateFile); }
      catch (renameError) { failed = true; error = renameError; }
    }
    writing = false;
    if (failed) {
      // Swallowed before, both of them. A write that fails -- ENOSPC is the
      // realistic one, and this box runs at 59% -- meant the rename was skipped
      // and nothing else happened: no log, no retry, and an in-memory state
      // carrying changes that were never on disk. The next restart lost them,
      // and nothing anywhere had said so.
      console.error(`[error] Saving state failed: ${error?.message || error}`);
      fs.rm(tmp, { force: true }, () => {});
      // Marked dirty so the change is not abandoned, but retried on a timer
      // rather than immediately: a full disk fails instantly, and re-entering
      // save() from here would spin the event loop rather than wait for room.
      dirty = true;
      if (!retryTimer) {
        retryTimer = setTimeout(() => { retryTimer = null; if (dirty) { dirty = false; save(); } }, 5_000);
        retryTimer.unref?.();
      }
      return;
    }
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

/**
 * One destination provider's settings, with its account list normalised.
 *
 * `accountId` was a single string for the app's whole life, and every record on
 * disk still holds one. Rather than a migration pass, the list is DERIVED at
 * read time -- the same device the youtube privacy correction below uses -- and
 * `accountId` is kept in step as the first entry of the list.
 *
 * Keeping both is what makes this safe to ship in one release: every existing
 * reader of `item.accountId` (the publish path, the connection test, the UI)
 * carries on working untouched, while anything that wants every destination
 * reads `accountIds`.
 */
function withAccountList(fresh, current) {
  const merged = { ...fresh, ...(current || {}) };
  const stored = Array.isArray(merged.accountIds) ? merged.accountIds : [];
  const ids = stored.length ? stored : [merged.accountId];
  // Deduped: the same account chosen twice would post the same clip twice to
  // the same place, which reads as the app double-posting.
  const accountIds = [...new Set(ids.map(id => String(id || '')).filter(Boolean))];
  return { ...merged, accountIds, accountId: accountIds[0] || '' };
}

/**
 * The write side of the same idea, and it is NOT the read side reused.
 *
 * On write, whichever key the caller actually supplied WINS. A caller that
 * names `accountId` alone -- which is every caller written before this release,
 * including the connections dialog -- is choosing one destination and means to
 * replace the list, not to have the stored list quietly outvote it. Reusing the
 * read-side merge here did exactly that: setting accountId to 'X' against a
 * stored ['A','B'] left the account posting to A.
 */
function mergeAccountList(current = {}, next) {
  const merged = { ...current, ...(next || {}) };
  const clean = list => [...new Set((list || []).map(id => String(id || '')).filter(Boolean))];
  if (next && Array.isArray(next.accountIds)) {
    const accountIds = clean(next.accountIds);
    return { ...merged, accountIds, accountId: accountIds[0] || '' };
  }
  if (next && Object.hasOwn(next, 'accountId')) {
    const accountIds = clean([next.accountId]);
    return { ...merged, accountIds, accountId: accountIds[0] || '' };
  }
  const stored = Array.isArray(merged.accountIds) ? merged.accountIds : [];
  const accountIds = clean(stored.length ? stored : [merged.accountId]);
  return { ...merged, accountIds, accountId: accountIds[0] || '' };
}

export function publishingSettings(user) {
  const fresh = settingDefaults().publishingSettings;
  const current = readSetting(user, 'publishingSettings') || {};
  return {
    ...fresh, ...current,
    // Read-time correction rather than a migration pass: an account that stored
    // `private` back when the app had a control for it publishes publicly from
    // the next upload, without anyone having to go and find the setting.
    youtube: { ...withAccountList(fresh.youtube, current.youtube), privacy: 'public' },
    instagram: withAccountList(fresh.instagram, current.instagram),
    facebook: withAccountList(fresh.facebook, current.facebook),
    tiktok: withAccountList(fresh.tiktok, current.tiktok),
  };
}
export function setPublishingSettings(user, next) {
  const id = userIdOf(user);
  if (!id) throw new Error('Settings need an account.');
  const current = publishingSettings(user);
  writeUserSetting(state, id, 'publishingSettings', {
    ...current, ...next,
    youtube: mergeAccountList(current.youtube, next.youtube),
    instagram: mergeAccountList(current.instagram, next.instagram),
    facebook: mergeAccountList(current.facebook, next.facebook),
    tiktok: mergeAccountList(current.tiktok, next.tiktok),
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

/**
 * Network settings for URL imports: a proxy and/or a cookies export that the
 * worker's downloader uses to get past YouTube's bot wall on datacenter IPs.
 *
 * Instance-level, not per-account: this is infrastructure, set by the operator
 * from the dashboard because the alternative -- editing .env over the Hetzner
 * web console -- mangles the very characters a proxy URL is made of.
 *
 * The values are credentials (a proxy password, a signed-in session), so they
 * are stored but never echoed back whole: readers get presence and a masked
 * preview, and only the worker payload carries the real thing.
 */
export function importNetworkSettings() {
  const stored = state.importNetwork && typeof state.importNetwork === 'object' ? state.importNetwork : {};
  // Sealed on write; a value written before this was added comes back as-is
  // and is sealed the next time it is saved.
  const read = value => { try { return String(secretBox.open(value) || ''); } catch { return ''; } };
  return { proxy: read(stored.proxy), cookiesText: read(stored.cookiesText) };
}
export function setImportNetworkSettings(next = {}) {
  const current = importNetworkSettings();
  const proxy = next.proxy !== undefined ? String(next.proxy || '').trim() : current.proxy;
  const cookiesText = next.cookiesText !== undefined ? String(next.cookiesText || '').trim() : current.cookiesText;
  // A live YouTube session and a proxy password, in the same file where every
  // other third-party credential is already encrypted.
  state.importNetwork = {
    proxy: proxy ? secretBox.seal(proxy) : '',
    cookiesText: cookiesText ? secretBox.seal(cookiesText) : '',
  };
  save();
  return importNetworkSettings();
}

export function clipsOwnedBy(userId) { return ownedBy(state.clips, userId); }
export function projectsOwnedBy(userId) { return ownedBy(state.projects, userId); }
