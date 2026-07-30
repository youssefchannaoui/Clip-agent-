import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { state, save } from './store.js';
import { ffmpegPath } from './ffmpeg.js';

const musicDir = path.join(config.dataDir, 'music');
const mixedDir = path.join(config.dataDir, 'mixed');
const libraryFile = path.join(musicDir, 'library.json');

for (const dir of [musicDir, mixedDir]) fs.mkdirSync(dir, { recursive: true });

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${(stderr || stdout).slice(-400)}`));
    });
  });
}

/* ------------------------------------------------------------------ */
/* Library: the nasheeds someone has uploaded                          */
/* ------------------------------------------------------------------ */

function loadLibrary() {
  try { return JSON.parse(fs.readFileSync(libraryFile, 'utf8')); }
  catch { return []; }
}
function saveLibrary(list) {
  fs.writeFileSync(libraryFile, JSON.stringify(list, null, 2));
}

export function listNasheeds() {
  return loadLibrary();
}

/** Probe a media file's duration in seconds using ffprobe (bundled with ffmpeg). */
async function probeDuration(filePath) {
  const ffmpeg = await ffmpegPath();
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, m => (m.includes('.exe') ? 'ffprobe.exe' : 'ffprobe'));
  try {
    const { stdout } = await run(ffprobe, [
      '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
    ]);
    const n = Number(stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    // If ffprobe isn't sitting next to ffmpeg, fall back to plain ffprobe on PATH.
    try {
      const { stdout } = await run('ffprobe', [
        '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath,
      ]);
      const n = Number(stdout.trim());
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch { return 0; }
  }
}

const MAX_TRACK_BYTES = 30 * 1024 * 1024; // 30MB — a full nasheed track fits comfortably

/**
 * Save an uploaded nasheed. Accepts base64 audio data (kept dependency-free —
 * no multipart-form library) and a display name.
 */
export async function saveNasheed(name, base64Data, mimeType) {
  const clean = String(name || '').trim().slice(0, 120) || 'Untitled track';
  if (!base64Data) throw new Error('No audio data received.');

  const buf = Buffer.from(base64Data, 'base64');
  if (!buf.length) throw new Error('That file appears to be empty.');
  if (buf.length > MAX_TRACK_BYTES) {
    throw new Error(`That file is too large (${(buf.length / 1024 / 1024).toFixed(1)}MB). Keep tracks under 30MB.`);
  }

  const ext = mimeType?.includes('wav') ? 'wav'
    : mimeType?.includes('mp4') || mimeType?.includes('m4a') ? 'm4a'
    : mimeType?.includes('ogg') ? 'ogg'
    : 'mp3';
  const id = crypto.randomBytes(8).toString('hex');
  const filename = `${id}.${ext}`;
  fs.writeFileSync(path.join(musicDir, filename), buf);

  const durationSec = await probeDuration(path.join(musicDir, filename));
  if (!durationSec) {
    fs.rmSync(path.join(musicDir, filename), { force: true });
    throw new Error('That did not look like a valid audio file.');
  }

  const list = loadLibrary();
  const entry = { id, name: clean, filename, durationSec, sizeBytes: buf.length, addedAt: Date.now() };
  list.push(entry);
  saveLibrary(list);
  return entry;
}

export function deleteNasheed(id) {
  const list = loadLibrary();
  const entry = list.find(t => t.id === id);
  if (!entry) return false;
  fs.rmSync(path.join(musicDir, entry.filename), { force: true });
  saveLibrary(list.filter(t => t.id !== id));
  return true;
}

export function nasheedFilePath(id) {
  const entry = loadLibrary().find(t => t.id === id);
  if (!entry) return null;
  const full = path.join(musicDir, path.basename(entry.filename));
  return full.startsWith(musicDir) && fs.existsSync(full) ? { path: full, entry } : null;
}

function pickRandomNasheed() {
  const list = loadLibrary();
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)];
}

export function pickNasheed() {
  return pickRandomNasheed();
}

/* ------------------------------------------------------------------ */
/* Settings                                                             */
/* ------------------------------------------------------------------ */

export function musicSettings() {
  const s = state.musicSettings || {};
  const configuredMode = s.mode || config.musicMode || null;
  const enabled = s.enabled ?? config.musicEnabled;
  const mode = configuredMode || (enabled ? 'opus_native' : 'off');
  return {
    enabled: mode !== 'off' && enabled !== false,
    // opus_native = no extra Opus import credits. The app keeps your Music tab
    // library for choosing/previewing tracks, while Opus handles music natively.
    // local_import = old guaranteed local mix + re-import path.
    mode: ['opus_native', 'local_import', 'off'].includes(mode) ? mode : 'opus_native',
    volumePercent: s.volumePercent ?? config.musicVolumePercent,
  };
}
export function setMusicSettings(next) {
  const clean = { ...next };
  if (clean.mode === 'off') clean.enabled = false;
  else if (clean.mode === 'opus_native' || clean.mode === 'local_import') clean.enabled = true;
  state.musicSettings = { ...state.musicSettings, ...clean };
  save();
}

/* ------------------------------------------------------------------ */
/* Downloading and mixing                                              */
/* ------------------------------------------------------------------ */

async function downloadTo(url, destPath) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`Could not download the clip (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('The downloaded clip was empty.');
  fs.writeFileSync(destPath, buf);
  return destPath;
}

/**
 * Mix a nasheed underneath a clip's existing audio (the speaker's voice stays
 * at full volume). The nasheed is looped so it always covers the whole clip,
 * however short the track, and trimmed to the clip's own length.
 */
async function mixAudio(clipPath, nasheedPath, outPath, volumePercent) {
  const ffmpeg = await ffmpegPath();
  const volume = Math.max(0, Math.min(100, volumePercent)) / 100;
  await run(ffmpeg, [
    '-y',
    '-i', clipPath,
    '-stream_loop', '-1', '-i', nasheedPath,
    '-filter_complex',
    `[1:a]volume=${volume}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
    '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', '-c:a', 'aac', '-shortest',
    outPath,
  ]);
  return outPath;
}

/**
 * The full step: download the rendered clip, pick a random nasheed, mix it
 * in, and return a public URL Opus can fetch to re-import the result.
 * Returns null if there's nothing to do (no library, disabled, or no way
 * to expose a public URL) — callers should fall back to posting the clip
 * unmixed rather than blocking on this.
 */
export async function mixClipMusic(exportUrl, onStage) {
  const settings = musicSettings();
  if (!settings.enabled) return { skipped: 'Music is turned off in settings.' };
  if (!config.publicBaseUrl) return { skipped: 'No public URL configured, so Opus could not fetch a mixed file back.' };

  const nasheed = pickRandomNasheed();
  if (!nasheed) return { skipped: 'No nasheeds uploaded yet.' };
  if (!exportUrl) return { skipped: 'Opus did not provide a downloadable file for this clip.' };

  const workId = crypto.randomBytes(8).toString('hex');
  const clipPath = path.join(mixedDir, `${workId}-src.mp4`);
  const outFile = `${workId}.mp4`;
  const outPath = path.join(mixedDir, outFile);

  try {
    onStage?.('Downloading the clip');
    await downloadTo(exportUrl, clipPath);

    onStage?.(`Mixing in "${nasheed.name}"`);
    await mixAudio(clipPath, path.join(musicDir, nasheed.filename), outPath, settings.volumePercent);

    return { publicUrl: `${config.publicBaseUrl}/media/mixed/${outFile}`, nasheedName: nasheed.name, outFile };
  } finally {
    fs.rm(clipPath, { force: true }, () => {});
  }
}

export function mixedFilePath(filename) {
  // Guard against path traversal on this public, unauthenticated route.
  const safe = path.basename(String(filename || ''));
  const full = path.join(mixedDir, safe);
  return full.startsWith(mixedDir) && fs.existsSync(full) ? full : null;
}

/** Mixed files are only needed until Opus has fetched them once. */
export function cleanupOldMixedFiles(maxAgeMs = 2 * 60 * 60 * 1000) {
  const now = Date.now();
  for (const name of fs.readdirSync(mixedDir)) {
    const full = path.join(mixedDir, name);
    try { if (now - fs.statSync(full).mtimeMs > maxAgeMs) fs.rmSync(full, { force: true }); }
    catch { /* already gone */ }
  }
}
