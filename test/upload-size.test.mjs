import assert from 'node:assert/strict';
import test from 'node:test';

// A presigned PUT was a licence to write a file of ANY size into the bucket.
// The only size anyone checked was one the client reported about itself, after
// the upload had already happened -- so the bill was already run up.

process.env.OBJECT_STORAGE_ENDPOINT = 'https://example-account.r2.cloudflarestorage.com';
process.env.OBJECT_STORAGE_BUCKET = 'deenclipped-test';
process.env.OBJECT_STORAGE_ACCESS_KEY = 'test-access-key';
process.env.OBJECT_STORAGE_SECRET_KEY = 'test-secret-key';
process.env.MAX_VIDEO_UPLOAD_MB = '2048';

const storage = await import('../src/object-storage.js');
const { config } = await import('../src/config.js');

test('the signature commits to the exact size, so the bucket enforces it', () => {
  const upload = storage.createUpload('user-1', 'lecture.mp4', 5 * 1024 * 1024);
  const signed = new URL(upload.uploadUrl).searchParams.get('X-Amz-SignedHeaders');
  assert.match(signed, /content-length/,
    'content-length must be signed -- unsigned, any size is accepted');
});

test('a different size produces a different signature', () => {
  // This is the whole protection: the client cannot declare 5MB, receive a URL
  // and then send 3GB through it. The bucket recomputes the signature over the
  // Content-Length it actually received.
  // Both are legal sizes -- the point is that the signature differs, so a URL
  // issued for one cannot be spent on the other.
  const small = new URL(storage.createUpload('user-1', 'a.mp4', 5 * 1024 * 1024).uploadUrl);
  const large = new URL(storage.createUpload('user-1', 'a.mp4', 500 * 1024 * 1024).uploadUrl);
  assert.notEqual(small.searchParams.get('X-Amz-Signature'), large.searchParams.get('X-Amz-Signature'));
});

test('a file over the limit is refused before any URL is handed out', () => {
  assert.throws(
    () => storage.createUpload('user-1', 'huge.mp4', config.maxVideoUploadBytes + 1),
    /limit is/,
    'the refusal happens at signing time, not after the bytes have arrived');
});

test('an upload that declares no size gets no URL', () => {
  // Without a declared size there is nothing to bind the signature to, which
  // is exactly the unlimited licence this replaced.
  assert.throws(() => storage.createUpload('user-1', 'x.mp4', 0), /size of the file is required/);
  assert.throws(() => storage.createUpload('user-1', 'x.mp4'), /size of the file is required/);
});

test('the type is still decided by the extension, not the caller', () => {
  assert.throws(() => storage.createUpload('user-1', 'promo.html', 1000), /MP4, MOV/);
  assert.equal(storage.createUpload('user-1', 'clip.mov', 1000).contentType, 'video/quicktime');
});

test('reads and deletes are unaffected', () => {
  // They carry no body, so binding a length to them would break them.
  const url = new URL(storage.presign({ method: 'GET', key: 'clips/x.mp4' }));
  assert.doesNotMatch(url.searchParams.get('X-Amz-SignedHeaders'), /content-length/);
});
