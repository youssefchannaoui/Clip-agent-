import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from './config.js';
import { ffmpegPath } from './ffmpeg.js';

const thumbsDir = path.join(config.dataDir, 'thumbs');
fs.mkdirSync(thumbsDir, { recursive: true });

function run(bin, args, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Timed out grabbing a frame.')); }, timeoutMs);
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', err => { clearTimeout(timer); reject(err); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });
}

function safeName(id) {
  return String(id).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

export function thumbPath(clipId) {
  const file = path.join(thumbsDir, safeName(clipId) + '.jpg');
  return fs.existsSync(file) ? file : null;
}

export function hasThumbnail(clipId) {
  return thumbPath(clipId) !== null;
}

/**
 * Grab a single frame straight from the clip's own video URL — ffmpeg can
 * read directly from an http(s) source, so there's no need to download the
 * whole file first just to make a thumbnail. A second or so in avoids a
 * black opening frame on most talking-head footage.
 */
export async function generateThumbnail(clipId, videoUrl, atSeconds = 1.2) {
  if (!videoUrl) return false;
  const ffmpeg = await ffmpegPath();
  const outFile = path.join(thumbsDir, safeName(clipId) + '.jpg');
  const tmpFile = outFile + '.tmp';
  try {
    await run(ffmpeg, [
      '-ss', String(atSeconds), '-i', videoUrl,
      '-frames:v', '1', '-vf', 'scale=480:-2',
      '-q:v', '4', '-f', 'mjpeg', '-y', tmpFile,
    ]);
    fs.renameSync(tmpFile, outFile);
    return true;
  } catch {
    fs.rm(tmpFile, { force: true }, () => {});
    return false;
  }
}

export function deleteThumbnail(clipId) {
  fs.rmSync(path.join(thumbsDir, safeName(clipId) + '.jpg'), { force: true });
}

/** Remove thumbnails for clips that no longer exist, so the disk doesn't grow forever. */
export function cleanupOrphans(validIds) {
  const keep = new Set([...validIds].map(safeName));
  for (const name of fs.readdirSync(thumbsDir)) {
    const id = name.replace(/\.jpg$|\.tmp$/, '');
    if (!keep.has(id)) fs.rmSync(path.join(thumbsDir, name), { force: true });
  }
}
