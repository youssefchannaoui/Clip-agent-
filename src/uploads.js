import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.m4v', '.webm', '.mkv']);

export function safeUploadName(value = '') {
  let decoded = String(value || 'video.mp4');
  try { decoded = decodeURIComponent(decoded); } catch {}
  const base = path.basename(decoded).replace(/[\0\r\n]/g, '').replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  return (base || 'video.mp4').slice(0, 180);
}

export function validateVideoUpload({ name = '', contentType = '', contentLength = null } = {}) {
  const safeName = safeUploadName(name);
  const extension = path.extname(safeName).toLowerCase();
  if (!VIDEO_EXTENSIONS.has(extension)) throw Object.assign(new Error('Choose an MP4, MOV, M4V, WebM or MKV video file.'), { statusCode: 400 });
  const mime = String(contentType || '').toLowerCase().split(';')[0].trim();
  if (mime && mime !== 'application/octet-stream' && !mime.startsWith('video/')) {
    throw Object.assign(new Error('The selected file is not a supported video.'), { statusCode: 400 });
  }
  const length = Number(contentLength);
  if (Number.isFinite(length) && length > config.maxVideoUploadBytes) {
    const maxMb = Math.round(config.maxVideoUploadBytes / 1024 / 1024);
    throw Object.assign(new Error(`The video is larger than the ${maxMb} MB upload limit.`), { statusCode: 413 });
  }
  return { safeName, extension };
}

export function saveVideoUpload(req, userId) {
  const validated = validateVideoUpload({
    name: req.headers['x-file-name'],
    contentType: req.headers['content-type'],
    contentLength: req.headers['content-length'],
  });
  const owner = String(userId || '').replace(/[^A-Za-z0-9_-]/g, '_');
  if (!owner) throw Object.assign(new Error('Sign in before uploading a video.'), { statusCode: 401 });
  const directory = path.join(config.dataDir, 'uploads', owner);
  fs.mkdirSync(directory, { recursive: true });
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(8).toString('hex')}`;
  const finalPath = path.join(directory, `${id}${validated.extension}`);
  const partialPath = `${finalPath}.part`;

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(partialPath, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let settled = false;
    const cleanup = () => {
      try { output.destroy(); } catch {}
      try { fs.unlinkSync(partialPath); } catch {}
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    output.on('error', fail);
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('The video upload was interrupted.'), { statusCode: 400 })));
    req.on('data', chunk => {
      size += chunk.length;
      if (size > config.maxVideoUploadBytes) {
        req.pause();
        const maxMb = Math.round(config.maxVideoUploadBytes / 1024 / 1024);
        fail(Object.assign(new Error(`The video is larger than the ${maxMb} MB upload limit.`), { statusCode: 413 }));
      }
    });
    output.on('finish', () => {
      if (settled) return;
      if (!size) return fail(Object.assign(new Error('The uploaded video was empty.'), { statusCode: 400 }));
      try {
        fs.renameSync(partialPath, finalPath);
        settled = true;
        resolve({ filePath: finalPath, fileName: validated.safeName, title: path.basename(validated.safeName, validated.extension), size });
      } catch (error) { fail(error); }
    });
    req.pipe(output);
  });
}

export function removeUploadedFile(filePath) {
  if (!filePath) return;
  const root = path.resolve(config.dataDir, 'uploads') + path.sep;
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(root)) fs.rmSync(resolved, { force: true });
}
