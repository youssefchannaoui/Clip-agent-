import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-public-imports-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.GOOGLE_SIGNIN_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_SIGNIN_CLIENT_SECRET = 'google-client-secret';
process.env.APP_SESSION_SECRET = 'public-import-test-secret-long-enough';

const auth = await import('../src/auth.js');
const engine = await import('../src/local-engine.js');
const uploads = await import('../src/uploads.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('Google account sign-in always sends the production callback URL', () => {
  const start = new URL(auth.oauthStart('google', { headers: { host: 'wrong-host.test', 'x-forwarded-proto': 'http' } }, '/app'));
  assert.equal(start.searchParams.get('redirect_uri'), 'https://deenclipped.online/auth/google/callback');
  assert.equal(start.searchParams.get('scope'), 'openid email profile');
});

test('YouTube bot checks become a customer-safe upload recovery message', () => {
  const result = engine.customerSafeProjectError("ERROR: Sign in to confirm you're not a bot. Use --cookies-from-browser for authentication.");
  assert.equal(result.code, 'youtube_import_blocked');
  assert.match(result.message, /Upload the original MP4 or MOV/i);
  assert.doesNotMatch(result.message, /--cookies|cookies-from-browser/i);
});

test('video uploads are streamed into an account-scoped directory', async () => {
  const request = new PassThrough();
  request.headers = { 'x-file-name': encodeURIComponent('My Lecture.mp4'), 'content-type': 'video/mp4', 'content-length': '12' };
  const saving = uploads.saveVideoUpload(request, 'user_public');
  request.end(Buffer.from('video-bytes!'));
  const saved = await saving;
  assert.equal(saved.fileName, 'My Lecture.mp4');
  assert.equal(saved.title, 'My Lecture');
  assert.ok(saved.filePath.startsWith(path.join(dataDir, 'uploads', 'user_public') + path.sep));
  assert.equal(fs.readFileSync(saved.filePath, 'utf8'), 'video-bytes!');
  uploads.removeUploadedFile(saved.filePath);
  assert.equal(fs.existsSync(saved.filePath), false);
});

test('video upload validation rejects executable and traversal filenames', () => {
  assert.throws(() => uploads.validateVideoUpload({ name: '../../malware.sh', contentType: 'application/x-sh' }), /MP4, MOV/i);
  assert.equal(uploads.safeUploadName('../../lecture.mp4'), 'lecture.mp4');
});
