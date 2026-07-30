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

export function listNasheeds() {
  return loadLibrary();
}

export async function saveNasheed(name, base64Data, mimeType = '') {
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

export function deleteNasheed(id) {
  const list = loadLibrary();
  const entry = list.find(item => item.id === id);
  if (!entry) return false;
  fs.rmSync(path.join(musicDir, path.basename(entry.filename)), { force: true });
  writeLibrary(list.filter(item => item.id !== id));
  return true;
}

export function nasheedFilePath(id) {
  const entry = loadLibrary().find(item => item.id === id);
  if (!entry) return null;
  const file = path.join(musicDir, path.basename(entry.filename));
  if (!file.startsWith(musicDir) || !fs.existsSync(file)) return null;
  return { file, entry };
}

export function workerMusicTracks() {
  return loadLibrary()
    .map(entry => ({ ...entry, path: path.join(musicDir, path.basename(entry.filename)) }))
    .filter(entry => fs.existsSync(entry.path));
}

export { musicSettings, setMusicSettings };
