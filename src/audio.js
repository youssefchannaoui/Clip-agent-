import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { musicSettings, setMusicSettings } from './store.js';

const musicDir = path.join(config.dataDir, 'music');
const libraryFile = path.join(musicDir, 'library.json');
const MAX_TRACK_BYTES = 40 * 1024 * 1024;
fs.mkdirSync(musicDir, { recursive: true });

function loadLibrary() {
  try { return JSON.parse(fs.readFileSync(libraryFile, 'utf8')); }
  catch { return []; }
}
function writeLibrary(list) {
  fs.writeFileSync(libraryFile, JSON.stringify(list, null, 2));
}
function run(bin, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Audio check timed out.'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error((stderr || stdout).slice(-400)));
    });
  });
}

async function probeDuration(file) {
  const { stdout } = await run(config.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
  ]);
  const duration = Number(stdout.trim());
  return Number.isFinite(duration) ? duration : 0;
}

/**
 * The music one account may use: its own uploads, plus the shared starter
 * library.
 *
 * Music used to be one global list, so any signed-in customer could list and
 * download audio another customer had uploaded. Tracks that predate accounts
 * belong to the operator and are marked shared, because they are the app's own
 * starter nasheeds and every new account needs at least one track before it can
 * render anything.
 */
export function listNasheeds(user) {
  const userId = user?.id || user || '';
  if (!userId) return [];
  return loadLibrary().filter(entry => entry.shared || entry.userId === userId);
}

/** True when this account may delete or otherwise manage the track. */
function ownsTrack(entry, userId) {
  return Boolean(entry && userId && entry.userId === userId);
}

export async function saveNasheed(user, name, base64Data, mimeType = '') {
  const userId = user?.id || user || '';
  if (!userId) throw new Error('Sign in to add music.');
  const buffer = Buffer.from(String(base64Data || ''), 'base64');
  if (!buffer.length) throw new Error('Choose a valid audio file.');
  if (buffer.length > MAX_TRACK_BYTES) throw new Error('Keep each nasheed under 40MB.');

  const extension = mimeType.includes('wav') ? 'wav'
    : mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
        : 'mp3';
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.${extension}`;
  const file = path.join(musicDir, filename);
  fs.writeFileSync(file, buffer);

  let durationSec = 0;
  try { durationSec = await probeDuration(file); }
  catch {}
  if (!durationSec) {
    fs.rmSync(file, { force: true });
    throw new Error('That file could not be read as audio.');
  }

  const entry = {
    id,
    userId,
    shared: false,
    name: String(name || '').trim().slice(0, 120) || 'Untitled nasheed',
    filename,
    durationSec,
    sizeBytes: buffer.length,
    addedAt: Date.now(),
  };
  const list = loadLibrary();
  list.push(entry);
  writeLibrary(list);
  return entry;
}

export function deleteNasheed(user, id) {
  const userId = user?.id || user || '';
  const list = loadLibrary();
  const entry = list.find(item => item.id === id);
  // Deleting is confined to your own uploads: the shared starter tracks stay
  // put, and another account's track is not even acknowledged to exist.
  if (!entry || !ownsTrack(entry, userId)) return false;
  fs.rmSync(path.join(musicDir, path.basename(entry.filename)), { force: true });
  writeLibrary(list.filter(item => item.id !== id));
  return true;
}

export function nasheedFilePath(user, id) {
  const userId = user?.id || user || '';
  const entry = loadLibrary().find(item => item.id === id);
  if (!entry || !(entry.shared || ownsTrack(entry, userId))) return null;
  const file = path.join(musicDir, path.basename(entry.filename));
  if (!file.startsWith(musicDir) || !fs.existsSync(file)) return null;
  return { file, entry };
}

export function workerMusicTracks(user) {
  return listNasheeds(user)
    .map(entry => ({ ...entry, path: path.join(musicDir, path.basename(entry.filename)) }))
    .filter(entry => fs.existsSync(entry.path));
}

/**
 * Tracks that existed before accounts did become the shared starter library.
 *
 * Run once on boot. Without this every existing track would belong to nobody
 * and no account could render at all, since music is mandatory on every clip.
 */
export function migrateLibraryOwnership(ownerId) {
  const list = loadLibrary();
  let changed = 0;
  for (const entry of list) {
    if (entry && !entry.userId) {
      entry.userId = ownerId;
      entry.shared = true;
      changed += 1;
    }
  }
  if (changed) writeLibrary(list);
  return changed;
}

export { musicSettings, setMusicSettings };
