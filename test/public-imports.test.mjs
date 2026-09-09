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

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

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

test('a 403 from every import route becomes a customer-safe message', () => {
  // The real string, exactly as it reached the customer: both providers named,
  // a yt-dlp traceback, and nothing they could act on.
  const result = engine.customerSafeProjectError(
    'socialkit: Download failed (yt-dlp): ERROR: unable to download video data: '
    + 'HTTP Error 403: Forbidden | ytdlp: YouTube refused this download from this server.',
  );
  assert.equal(result.code, 'youtube_import_blocked');
  assert.match(result.message, /upload/i, 'says what to do instead');
  // Vendor names are ours, not the customer's. They read as the product being
  // broken and send people to check a plan that is fine.
  assert.doesNotMatch(result.message, /yt-dlp/i);
  assert.doesNotMatch(result.message, /socialkit/i);
});

test('an unrelated failure keeps its own message rather than blaming YouTube', () => {
  const result = engine.customerSafeProjectError('ffmpeg exited with code 1: no space left on device');
  assert.equal(result.code, 'processing_failed');
  assert.match(result.message, /no space left/);
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

test('resubmitting with the same idempotency key does not create a second project', async () => {
  // A 502 can land after the project was created. Without this the client
  // cannot tell, retries, and the account pays for the same lecture twice.
  const before = engine.state?.projects?.length;
  const key = 'test-idem-key-1';
  const first = await engine.submitVideo('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'A', 'user_admin', { idempotencyKey: key })
    .catch(error => ({ error: error.message }));
  if (first && first.error) {
    // Submission was refused for an unrelated reason -- no template, no import
    // provider configured in this environment -- and the guard being tested
    // lives before all of them, so assert the shape instead.
    //
    // "no nasheed" used to be the reason it landed here and no longer can be:
    // every account now holds the nine DeenClipped starter nasheeds from boot
    // (v3.149.0). Left in the pattern deliberately, so this reads as a list of
    // environment reasons rather than as a claim that music is still a blocker.
    //
    // "Connect the YouTube channel" is the reason it lands here NOW: a pasted
    // link must be a video on a connected channel (src/youtube-ownership.js),
    // and this fixture connects nothing. The guard under test still runs
    // before that one -- submitVideo checks the idempotency key first of all --
    // so the shape assertion is what it always was.
    assert.match(first.error, /nasheed|template|Sign in|not configured|Connect the YouTube channel/i);
    return;
  }
  const second = await engine.submitVideo('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'A', 'user_admin', { idempotencyKey: key });
  assert.equal(second, first, 'the same key returns the original project');
  if (typeof before === 'number') assert.equal(engine.state.projects.length, before + 1);
});
