import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';

// Stock background videos for the Quran recitation flow: scenery that plays
// under the recitation instead of (or after) the source video. Owned per
// account exactly like nasheeds; entries marked shared are the app's own
// starter set and are visible to everyone.
const backgroundsDir = path.join(config.dataDir, 'backgrounds');
const libraryFile = path.join(backgroundsDir, 'library.json');
const MAX_BACKGROUND_BYTES = 120 * 1024 * 1024;
fs.mkdirSync(backgroundsDir, { recursive: true });

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
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Video check timed out.')); }, timeoutMs);
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

async function probeVideo(file) {
  const { stdout } = await run(config.ffprobePath, [
    '-v', 'error', '-show_entries', 'format=duration:stream=codec_type',
    '-of', 'json', file,
  ]);
  const info = JSON.parse(stdout || '{}');
  const durationSec = Number(info?.format?.duration) || 0;
  const hasVideo = (info?.streams || []).some(stream => stream.codec_type === 'video');
  return { durationSec, hasVideo };
}

export function listBackgrounds(user) {
  const userId = user?.id || user || '';
  if (!userId) return [];
  return loadLibrary().filter(entry => entry.shared || entry.userId === userId);
}

function ownsEntry(entry, userId) {
  return Boolean(entry && userId && entry.userId === userId);
}

/** Register a video file already sitting on this disk as a library entry.
 * Owns the file from here: it is renamed into the library on success and
 * removed on failure. */
export async function registerBackgroundFile(user, name, sourceFile, mimeType = '', { shared = false } = {}) {
  const userId = user?.id || user || '';
  if (!userId) throw new Error('Sign in to add background videos.');
  const size = fs.statSync(sourceFile).size;
  if (!size) throw new Error('Choose a valid video file.');
  if (size > MAX_BACKGROUND_BYTES) {
    fs.rmSync(sourceFile, { force: true });
    throw new Error('Keep each background video under 120MB — a short loop is all a clip needs.');
  }
  const lowered = `${mimeType} ${sourceFile}`.toLowerCase();
  const extension = lowered.includes('webm') ? 'webm'
    : lowered.includes('quicktime') || lowered.includes('.mov') ? 'mov'
      : 'mp4';
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.${extension}`;
  const file = path.join(backgroundsDir, filename);
  fs.renameSync(sourceFile, file);

  let probed = { durationSec: 0, hasVideo: false };
  let probeError = '';
  // The reason travels: a swallowed probe failure turned "ffprobe is not
  // installed" and "that's a PDF" into the same unhelpful sentence.
  try { probed = await probeVideo(file); } catch (error) { probeError = error.message; }
  if (!probed.hasVideo || probed.durationSec < 3) {
    fs.rmSync(file, { force: true });
    throw new Error(probeError
      ? `The video could not be checked: ${probeError}`
      : 'That file could not be read as a video of at least 3 seconds.');
  }

  const entry = {
    id,
    userId,
    shared: Boolean(shared),
    name: String(name || '').trim().slice(0, 120) || 'Untitled background',
    filename,
    durationSec: probed.durationSec,
    sizeBytes: size,
    addedAt: Date.now(),
  };
  const list = loadLibrary();
  list.push(entry);
  writeLibrary(list);
  return entry;
}

export async function saveBackground(user, name, base64Data, mimeType = '', { shared = false } = {}) {
  const userId = user?.id || user || '';
  if (!userId) throw new Error('Sign in to add background videos.');
  const buffer = Buffer.from(String(base64Data || ''), 'base64');
  if (!buffer.length) throw new Error('Choose a valid video file.');
  if (buffer.length > MAX_BACKGROUND_BYTES) throw new Error('Keep each background video under 120MB — a short loop is all a clip needs.');
  const temp = path.join(backgroundsDir, `incoming-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(temp, buffer);
  return registerBackgroundFile(user, name, temp, mimeType, { shared });
}

export function deleteBackground(user, id, { operator = false } = {}) {
  const userId = user?.id || user || '';
  const list = loadLibrary();
  const entry = list.find(item => item.id === id);
  // Confined to your own uploads; the operator additionally curates the
  // shared stock set. Another account's private video is not even
  // acknowledged to exist.
  const allowed = ownsEntry(entry, userId) || (entry?.shared && operator);
  if (!entry || !allowed) return false;
  fs.rmSync(path.join(backgroundsDir, path.basename(entry.filename)), { force: true });
  writeLibrary(list.filter(item => item.id !== id));
  return true;
}

export function backgroundFilePath(user, id) {
  const userId = user?.id || user || '';
  const entry = loadLibrary().find(item => item.id === id);
  if (!entry || !(entry.shared || ownsEntry(entry, userId))) return null;
  const file = path.join(backgroundsDir, path.basename(entry.filename));
  if (!file.startsWith(backgroundsDir) || !fs.existsSync(file)) return null;
  return { file, entry };
}

/** Pick the background a job will render with: a named one, or any of the
 * account's when the choice was left to us (the shuffle case). */
export function backgroundForJob(user, id = '') {
  const available = listBackgrounds(user)
    .map(entry => ({ ...entry, path: path.join(backgroundsDir, path.basename(entry.filename)) }))
    .filter(entry => fs.existsSync(entry.path));
  if (!available.length) return null;
  if (id) return available.find(entry => entry.id === id) || null;
  return available[Math.floor(Math.random() * available.length)];
}
