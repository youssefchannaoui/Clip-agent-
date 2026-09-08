import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';

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
/**
 * What "the same nasheed" means when one copy is ours and one is theirs.
 *
 * Youssef, 8 Sept 2026: "Allah Allah (Muffled) is duplicated keep this one."
 * He had uploaded that nasheed himself before the starter library shipped, so
 * his own copy and ours sat in his list together.
 *
 * BYTES CANNOT ANSWER THIS. The starter copies were re-encoded to 96kbps for a
 * ducked bed, so ours and his are the same recording and different files -- a
 * content hash sees two unrelated tracks. The name is what a person is
 * actually comparing, so that is what is compared: case, punctuation and the
 * "(Muffled)" suffix his filenames carry are not differences anybody means.
 */
function sameNasheed(a, b) {
  const key = value => String(value || '')
    .toLowerCase()
    .replace(/\((?:muffled|instrumental|bed|loop)\)/g, ' ')
    .replace(/\.(mp3|m4a|wav|ogg)$/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const left = key(a);
  return Boolean(left) && left === key(b);
}

// The id every track seeded from assets/nasheeds carries. ONE definition: the
// list needs it to know what may be hidden, and the seeder to mint it, and two
// copies of a prefix is how a starter stops being recognised as one.
const STARTER_ID_PREFIX = 'dc-starter-';

export function listNasheeds(user) {
  const userId = user?.id || user || '';
  if (!userId) return [];
  const all = loadLibrary();
  // An account that uploaded a nasheed BEFORE the starter library shipped
  // holds both copies, and only that account does -- his own is private. So
  // the shared one is HIDDEN FROM HIM rather than deleted: his copy wins, no
  // other account loses a track, and if he ever removes his own the starter
  // comes back by itself. Nothing is destroyed to tidy a list.
  // WHAT IS HIDDEN IS THE STARTER, and the test is the starter's own id rather
  // than the shared flag. The first cut asked whether the account's copy was
  // PRIVATE -- true for a customer's upload, and false for the operator's own
  // legacy tracks, which have always been marked shared because that flag has
  // always meant "the app's own". So on the one account that had uploaded this
  // nasheed before the starter library shipped, neither copy hid the other and
  // "Allah Allah (Muffled)" sat beside "Allah Allah", both captioned as
  // shipping with the studio. That is the duplicate that was reported, fixed
  // once and still on screen.
  //
  // A starter cannot hide another starter, so the shipped set can never eat
  // itself; and the copy that survives is the one somebody actually uploaded,
  // which is what "keep this one" meant.
  const isStarter = entry => String(entry?.id || '').startsWith(STARTER_ID_PREFIX);
  const visible = entry => entry.shared || entry.userId === userId;
  const uploaded = all.filter(entry => entry && !isStarter(entry) && visible(entry));
  const hidden = entry => isStarter(entry) && uploaded.some(own => sameNasheed(own.name, entry.name));
  // `owned` is derived here rather than left to each caller to work out from
  // userId: the browser needs to know whether Remove can do anything (a
  // starter track is not the account's to delete), and deriving it there would
  // mean shipping every entry's owner id to every account.
  return all
    .filter(entry => entry.shared || entry.userId === userId)
    .filter(entry => !hidden(entry))
    .map(entry => ({ ...entry, owned: ownsTrack(entry, userId) }));
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
  // `force` already tolerates a starter whose bytes were never copied here,
  // and this only ever removes from musicDir -- never the repo asset, which
  // every other account still reads.
  fs.rmSync(path.join(musicDir, path.basename(entry.filename)), { force: true });
  writeLibrary(list.filter(item => item.id !== id));
  // A starter track the operator deleted must stay deleted: the seeder runs on
  // every boot and would otherwise put it straight back, which reads as the
  // delete button not working.
  if (entry.starter) rememberRemoved(entry.id);
  return true;
}

export function nasheedFilePath(user, id) {
  const userId = user?.id || user || '';
  const entry = loadLibrary().find(item => item.id === id);
  if (!entry || !(entry.shared || ownsTrack(entry, userId))) return null;
  ensureStarterFile(entry);
  const file = path.join(musicDir, path.basename(entry.filename));
  if (!file.startsWith(musicDir) || !fs.existsSync(file)) return null;
  return { file, entry };
}

export function workerMusicTracks(user) {
  return listNasheeds(user)
    .filter(entry => ensureStarterFile(entry))
    .map(entry => ({ ...entry, path: path.join(musicDir, path.basename(entry.filename)) }))
    .filter(entry => fs.existsSync(entry.path));
}

/* ── The nine starter nasheeds DeenClipped ships with ─────────────────────
 * Youssef, 8 Sept 2026: "add these to the nasheeds, show its uploaded by
 * deenclipped."
 *
 * WHY THEY SHIP IN THE REPO RATHER THAN LIVING ONLY ON THE DISK. Music is
 * mandatory on every clip -- an account with no nasheed cannot finish a single
 * render, and "No nasheed uploaded" is one of the three blockers a brand-new
 * account meets on its very first screen. Leaving the starter library on one
 * Render disk makes it a property of THAT DISK: a fresh deployment, or a
 * restored one, comes up with nothing to mix and no account can render.
 * Shipping them makes it a property of the PRODUCT. The cost is stated rather
 * than hidden: 27MB against a 14MB tracked tree, paid once by every clone.
 *
 * They are COPIED into musicDir rather than read in place, because the worker
 * is handed a path and nasheedFilePath, deleteNasheed and workerMusicTracks
 * all resolve inside musicDir. One home for audio, not two.
 */
const starterDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'nasheeds');
const removedFile = path.join(musicDir, 'starter-removed.json');

/**
 * The starter file, copied into musicDir the first time anything asks for it.
 *
 * IT USED TO BE COPIED AT BOOT, and that was a real cost in the wrong place:
 * 27MB per boot, and the SUITE boots the store in dozens of files with a fresh
 * DATA_DIR each time. Measured while it was live: 20GB of temp directories in
 * one session, and a Python test failing for want of disk rather than for
 * anything it was testing. In production it is one copy either way.
 *
 * Almost nothing reads a nasheed's bytes -- a boot, a screen, a schedule and
 * every gate in between only ever read the library ROW -- so the copy belongs
 * where the bytes are wanted, which is a render or the Play button.
 *
 * One home for audio is still the rule: it lands in musicDir, and everything
 * downstream (the delete guard, the worker's path, the streaming route)
 * resolves there exactly as it did.
 */
function ensureStarterFile(entry) {
  if (!entry || !entry.starter) return true;
  const name = path.basename(String(entry.filename || ''));
  if (!name) return false;
  const to = path.join(musicDir, name);
  if (fs.existsSync(to)) return true;
  try { fs.copyFileSync(path.join(starterDir, name), to); return true; }
  catch { return false; }
}

/** STABLE across deploys, or every boot seeds a second copy of all nine. */
function starterId(file) {
  return STARTER_ID_PREFIX + path.basename(file, path.extname(file));
}

function readStarterManifest() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(starterDir, 'manifest.json'), 'utf8'));
    return Array.isArray(raw?.tracks) ? raw.tracks : [];
  } catch { return []; }
}

/**
 * True when the starter library is missing from this deployment altogether.
 *
 * Kept separate from "nothing to seed", which is the NORMAL state on every
 * restart after the first. An empty manifest means the assets did not ship --
 * a deployment that cannot render a clip for a new account -- and that is worth
 * a line in the log rather than the silence a bare `catch { return [] }` gives.
 */
export function starterNasheedsMissing() {
  return readStarterManifest().length === 0;
}

/* A starter track the operator deleted must STAY deleted. Without this the
 * next restart puts it straight back, which reads as the delete button not
 * working. Its own file, not state.json: store.js imports this module, so
 * reaching back into it would be a cycle. */
function readRemoved() {
  try { const list = JSON.parse(fs.readFileSync(removedFile, 'utf8')); return Array.isArray(list) ? list : []; }
  catch { return []; }
}
function rememberRemoved(id) {
  const list = readRemoved();
  if (list.includes(id)) return;
  list.push(id);
  try { fs.writeFileSync(removedFile, JSON.stringify(list, null, 2)); } catch {}
}

/**
 * Copy any starter nasheed the library does not already hold into musicDir and
 * mark it shared, so every account has it.
 *
 * Runs at boot and MUST NEVER THROW: a starter track that cannot be read is one
 * nasheed missing, and taking the whole app down over it would be far worse
 * than the thing it is fixing. Every failure skips that one track.
 */
export function seedStarterNasheeds(ownerId) {
  const tracks = readStarterManifest();
  if (!tracks.length) return 0;
  const list = loadLibrary();
  const have = new Set(list.map(entry => entry && entry.id));
  const dropped = new Set(readRemoved());
  let added = 0;
  for (const track of tracks) {
    const file = String(track?.file || '');
    // The manifest is ours, but it reaches the filesystem: a name carrying a
    // slash or a .. would write outside musicDir.
    if (!file || file !== path.basename(file)) continue;
    const id = starterId(file);
    if (have.has(id) || dropped.has(id)) continue;
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(path.join(starterDir, file)).size;
      if (!sizeBytes) continue;
    } catch { continue; }
    list.push({
      id,
      userId: ownerId || '',
      shared: true,
      starter: true,
      name: String(track?.name || '').trim().slice(0, 120) || path.basename(file, path.extname(file)),
      filename: file,
      // Filled in after boot by fillStarterDurations. A 0 costs the row its
      // "3:22" label and nothing else -- nothing downstream reads it.
      durationSec: 0,
      sizeBytes,
      addedAt: Date.now(),
    });
    added += 1;
  }
  if (added) writeLibrary(list);
  return added;
}

/**
 * The durations, measured AFTER boot rather than during it.
 *
 * ffprobe is a process per track, and nine of them in front of the server
 * starting to listen -- on every restart, for a label -- is the wrong trade.
 * The row simply carries no duration until this has run once.
 */
export async function fillStarterDurations() {
  const pending = loadLibrary().filter(e => e && e.starter && !e.durationSec);
  if (!pending.length) return 0;
  const measured = new Map();
  for (const entry of pending) {
    // The ASSET, not a copy: measuring a duration is not a reason to spend
    // 27MB of disk on a file nobody has asked to hear yet.
    const name = path.basename(entry.filename || '');
    const copied = path.join(musicDir, name);
    const file = fs.existsSync(copied) ? copied : path.join(starterDir, name);
    if (!fs.existsSync(file)) continue;
    try {
      const seconds = await probeDuration(file);
      if (seconds) measured.set(entry.id, seconds);
    } catch {}
  }
  if (!measured.size) return 0;
  // Re-read before writing: probing is slow and an upload may have landed in
  // the library while it ran.
  const fresh = loadLibrary();
  for (const entry of fresh) {
    if (entry && measured.has(entry.id) && !entry.durationSec) entry.durationSec = measured.get(entry.id);
  }
  writeLibrary(fresh);
  return measured.size;
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

/* NO IMPORT FROM store.js, DELIBERATELY -- and this is not tidying.
 *
 * store.js imports this module for the boot migrations, and this module used to
 * import musicSettings/setMusicSettings straight back and re-export them, which
 * nothing anywhere ever read: every caller takes them from store.js directly.
 * That dead pair made a genuine ES module CYCLE, and the cycle failed SILENTLY.
 * Import audio.js first and store.js's boot block runs while this module's body
 * has not -- so musicDir, libraryFile and starterDir are all in the temporal
 * dead zone, readStarterManifest's own `catch { return [] }` swallows the
 * ReferenceError, and seedStarterNasheeds returns 0 having done nothing at all.
 * No error, no log line, no starter nasheeds, on an app that cannot render a
 * clip without one.
 *
 * It happened to work in production only because server.js imports store.js
 * first. A behaviour that depends on somebody else's import order is not a
 * behaviour, and test/starter-nasheeds.test.mjs imports THIS module first for
 * exactly that reason.
 */
