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

function isOperator(user) {
  return ['owner', 'admin'].includes(String(user?.role || '').toLowerCase());
}

/**
 * What a viewer may see.
 *
 * The public set, their own uploads (including one still waiting on review,
 * so the person who sent it can see what happened to it), and -- for the
 * operator -- everything waiting, because the picker is where they review it.
 */
export function listBackgrounds(user) {
  const userId = user?.id || user || '';
  if (!userId) return [];
  const operator = isOperator(user);
  return loadLibrary().filter(entry =>
    entry.shared || entry.userId === userId || (operator && entry.pendingShare));
}

/**
 * The shape the browser gets. Vote TOTALS travel, never who cast them: a
 * library where everyone can see who disliked your video is a library nobody
 * submits to twice.
 */
export function publicBackground(entry, user) {
  const userId = user?.id || user || '';
  const votes = entry.votes && typeof entry.votes === 'object' ? entry.votes : {};
  const tally = Object.values(votes);
  return {
    id: entry.id,
    name: entry.name,
    durationSec: entry.durationSec,
    shared: Boolean(entry.shared),
    // Only ever true for the uploader and the operator -- listBackgrounds
    // does not hand a pending entry to anybody else.
    pending: Boolean(entry.pendingShare),
    rejected: Boolean(entry.shareRejected),
    rejectedReason: entry.shareRejectedReason || '',
    // Attribution belongs to the shared set. On a private upload it would be
    // the viewer's own name on their own video, which says nothing.
    by: entry.shared || entry.pendingShare ? (entry.by || '') : '',
    likes: tally.filter(v => v > 0).length,
    dislikes: tally.filter(v => v < 0).length,
    myVote: Number(votes[userId]) || 0,
    posterUrl: `/api/backgrounds/${encodeURIComponent(entry.id)}/poster`,
    own: entry.userId === userId && !entry.shared,
    mine: entry.userId === userId,
    deletable: entry.userId === userId || (Boolean(entry.shared) && isOperator(user)),
  };
}

/**
 * A like or a dislike on a video in the shared library.
 *
 * Only on the SHARED set: a vote on your own private upload is a vote nobody
 * else can read. One vote per account, stored by id so pressing the same
 * button again clears it rather than stacking.
 */
export function voteBackground(user, id, value) {
  const userId = user?.id || user || '';
  if (!userId) throw new Error('Sign in to vote.');
  const list = loadLibrary();
  const entry = list.find(item => item.id === id);
  if (!entry || !entry.shared) return null;
  const vote = Number(value) > 0 ? 1 : Number(value) < 0 ? -1 : 0;
  entry.votes = entry.votes && typeof entry.votes === 'object' ? entry.votes : {};
  // Pressing the button you already chose clears it. Without that the only
  // way out of a mis-tap is the opposite opinion.
  if (!vote || entry.votes[userId] === vote) delete entry.votes[userId];
  else entry.votes[userId] = vote;
  writeLibrary(list);
  return publicBackground(entry, user);
}

/** Everything submitted to the shared library and not yet decided. */
export function pendingBackgrounds(user) {
  if (!isOperator(user)) return [];
  return loadLibrary().filter(entry => entry.pendingShare);
}

/**
 * The operator's decision on a submission.
 *
 * A refusal does NOT delete the file -- it stays the uploader's own private
 * background, which is what they had before they offered it. Taking somebody's
 * video away because it was not right for everybody would be a punishment for
 * offering.
 */
export function reviewBackground(user, id, approve, reason = '') {
  if (!isOperator(user)) throw new Error('Only the operator reviews submissions.');
  const list = loadLibrary();
  const entry = list.find(item => item.id === id && item.pendingShare);
  if (!entry) return null;
  entry.pendingShare = false;
  if (approve) {
    entry.shared = true;
    entry.shareRejected = false;
    entry.shareRejectedReason = '';
    entry.sharedAt = Date.now();
  } else {
    entry.shared = false;
    entry.shareRejected = true;
    entry.shareRejectedReason = String(reason || '').slice(0, 200);
  }
  writeLibrary(list);
  return publicBackground(entry, user);
}

function ownsEntry(entry, userId) {
  return Boolean(entry && userId && entry.userId === userId);
}

/** Register a video file already sitting on this disk as a library entry.
 * Owns the file from here: it is renamed into the library on success and
 * removed on failure. */
export async function registerBackgroundFile(user, name, sourceFile, mimeType = '', { shared = false, pendingShare = false, by = '' } = {}) {
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

  // The picker's thumbnail, made now while the file is hot in page cache.
  // A failure only costs the poster -- the route backfills on first view.
  try { await writePoster(file, file.replace(/\.[^.]+$/, '.jpg'), probed.durationSec); } catch { /* backfilled lazily */ }

  const entry = {
    id,
    userId,
    shared: Boolean(shared),
    name: String(name || '').trim().slice(0, 120) || 'Untitled background',
    filename,
    durationSec: probed.durationSec,
    sizeBytes: size,
    addedAt: Date.now(),
    // Offered to everybody, and waiting on a human. `shared` stays false
    // until someone has watched it -- the library must never show a video
    // nobody has seen.
    pendingShare: Boolean(pendingShare) && !shared,
    // Captured at upload time rather than looked up per render: the name is
    // what the card credits, and an account that later changes its display
    // name has not changed who contributed the video.
    by: String(by || '').trim().slice(0, 60),
    votes: {},
  };
  const list = loadLibrary();
  list.push(entry);
  writeLibrary(list);
  return entry;
}

export async function saveBackground(user, name, base64Data, mimeType = '', { shared = false, pendingShare = false, by = '' } = {}) {
  const userId = user?.id || user || '';
  if (!userId) throw new Error('Sign in to add background videos.');
  const buffer = Buffer.from(String(base64Data || ''), 'base64');
  if (!buffer.length) throw new Error('Choose a valid video file.');
  if (buffer.length > MAX_BACKGROUND_BYTES) throw new Error('Keep each background video under 120MB — a short loop is all a clip needs.');
  const temp = path.join(backgroundsDir, `incoming-${crypto.randomBytes(6).toString('hex')}`);
  fs.writeFileSync(temp, buffer);
  return registerBackgroundFile(user, name, temp, mimeType, { shared, pendingShare, by });
}

/** One poster frame per background, made server-side with ffmpeg so the
 * browser never loads whole videos just to paint a picker. Generated at
 * register time and lazily backfilled for entries that predate posters. */
async function writePoster(videoFile, posterFile, durationSec = 0) {
  const at = Math.max(0.5, Math.min(2, (Number(durationSec) || 4) / 2));
  await run(config.ffmpegPath, [
    '-y', '-ss', String(at), '-i', videoFile,
    '-frames:v', '1', '-vf', 'scale=216:-2', '-q:v', '4', posterFile,
  ]);
}

export async function posterPathFor(user, id) {
  const userId = user?.id || user || '';
  const entry = loadLibrary().find(item => item.id === id && (item.shared || item.userId === userId));
  if (!entry) return null;
  const video = path.join(backgroundsDir, path.basename(entry.filename));
  if (!video.startsWith(backgroundsDir) || !fs.existsSync(video)) return null;
  const poster = video.replace(/\.[^.]+$/, '.jpg');
  if (!fs.existsSync(poster)) {
    try { await writePoster(video, poster, entry.durationSec); } catch { return null; }
  }
  return fs.existsSync(poster) ? poster : null;
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
  fs.rmSync(path.join(backgroundsDir, path.basename(entry.filename).replace(/\.[^.]+$/, '.jpg')), { force: true });
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
