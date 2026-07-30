import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'state.json');

const blank = () => ({
  opusKey: '',
  opusOrgId: '',
  brandTemplateId: '',   // which Opus clip style to use, chosen in the app
  brandTemplateMeta: null, // verified name/caption setting for the selected Opus template
  clipSettings: {},      // clipsPerVideo / clipMinSeconds / clipMaxSeconds overrides
  musicSettings: {},     // enabled / volumePercent overrides for the nasheed mixer
  copyPrompt: '',        // instructions for the AI-written title/caption/hashtags — blank means use the default
  vapidKeys: null,       // generated once, kept forever — see push.js
  pushSubscriptions: [], // one entry per browser/device with notifications on
  accounts: [],          // connected social accounts, mirrored from Opus
  accountsCheckedAt: 0,
  projects: [],          // videos sent to Opus
  clips: [],             // clips waiting, scheduled or posted
  log: [],
});

function load() {
  try {
    return { ...blank(), ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    return blank();
  }
}

export const state = load();

let writing = false, dirty = false;
export function save() {
  if (writing) { dirty = true; return; }
  writing = true;
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFile(tmp, JSON.stringify(state, null, 2), err => {
    if (!err) { try { fs.renameSync(tmp, file); } catch {} }
    writing = false;
    if (dirty) { dirty = false; save(); }
  });
}

export function log(message, level = 'info') {
  state.log.unshift({ at: Date.now(), level, message });
  state.log.length = Math.min(state.log.length, 200);
  console.log(`[${level}] ${message}`);
  save();
}

/** The Opus key comes from the environment, or from what was saved in the app. */
export const opusKey = () => state.opusKey || config.opusKey;
export const opusOrgId = () => state.opusOrgId || config.opusOrgId;
export const brandTemplateId = () => state.brandTemplateId || config.brandTemplateId;

export function brandTemplateSelection() {
  const id = brandTemplateId();
  const meta = state.brandTemplateMeta;
  return {
    id,
    name: meta?.id === id ? (meta.name || '') : '',
    enableCaption: meta?.id === id && typeof meta.enableCaption === 'boolean'
      ? meta.enableCaption
      : null,
  };
}

export function setBrandTemplateSelection(template) {
  if (!template?.id) {
    state.brandTemplateId = '';
    state.brandTemplateMeta = null;
  } else {
    state.brandTemplateId = String(template.id);
    state.brandTemplateMeta = {
      id: String(template.id),
      name: String(template.name || ''),
      enableCaption: typeof template.enableCaption === 'boolean'
        ? template.enableCaption
        : null,
    };
  }
  save();
}

/**
 * How many clips to keep per video, and how long each should be.
 * A saved value of 0 for clipsPerVideo means "keep everything Opus finds" —
 * that's also the default, since silently discarding clips was the bug.
 */
export function clipSettings() {
  const s = state.clipSettings || {};
  return {
    clipsPerVideo: s.clipsPerVideo ?? config.clipsPerVideo,
    clipMinSeconds: s.clipMinSeconds ?? config.clipMinSeconds,
    clipMaxSeconds: s.clipMaxSeconds ?? config.clipMaxSeconds,
  };
}

export function setClipSettings(next) {
  state.clipSettings = { ...state.clipSettings, ...next };
  save();
}

/**
 * The instructions sent to Opus for writing each clip's title, description
 * and hashtags. Editable in the app — this is exactly how someone changes
 * the language or tone of what gets generated, without needing to redeploy.
 */
export function copyPrompt() {
  return state.copyPrompt || config.copyPrompt;
}

export function setCopyPrompt(prompt) {
  state.copyPrompt = String(prompt || '').trim();
  save();
}
