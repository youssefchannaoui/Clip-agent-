import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const file = path.join(config.dataDir, 'state.json');

const blank = () => ({
  opusKey: '',
  opusOrgId: '',
  brandTemplateId: '',   // which Opus clip style to use, chosen in the app
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
