import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * A LOST ANSWER MUST NOT BECOME A SECOND POST.
 *
 * `publishBuffer` fires a createPost mutation that creates the post, and it
 * recorded nothing before making the call. `bufferGraphql` goes through
 * `jsonRequest`, which wraps a timeout, a reset or a proxy 502 as
 * `retryable: true` -- so a call Buffer HONOURED whose response never came
 * back was retried, and put a second post in the queue. Up to
 * `socialMaxAttempts` times.
 *
 * It is the primary path for YouTube, Instagram and Facebook whenever the
 * account connects through Buffer, so it is three platforms rather than one,
 * and it was about to become the live road for all of them.
 *
 * The other providers already carry this guard and are the model:
 *   - YouTube direct persists its resumable session and asks the upload where
 *     it got to before sending bytes again.
 *   - Instagram stamps `publishAttemptedAt` before media_publish and turns
 *     `retryable` off once it is set, with the comment "it does not make the
 *     call idempotent; it makes the ambiguity visible instead of silent".
 *
 * Buffer had neither. This file pins the Instagram-shaped fix, by READING THE
 * SOURCE rather than driving a fake Buffer: the property is an ordering one
 * (stamp before the call, refuse after), and the network shape of Buffer's API
 * is not verified anywhere in this repo, so a stub would be asserting against
 * an invented contract.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const source = fs.readFileSync(path.join(ROOT, 'src/social.js'), 'utf8');

/** publishBuffer's body, brace-matched -- a byte count is not a boundary. */
function publishBufferBody() {
  const at = source.indexOf('async function publishBuffer(');
  assert.ok(at > 0, 'publishBuffer must exist');
  let i = source.indexOf('{', at);
  let depth = 0;
  for (; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') { depth -= 1; if (depth === 0) return source.slice(at, i + 1); }
  }
  throw new Error('publishBuffer body not found');
}

test('the attempt is recorded BEFORE the post is created, not after', () => {
  const body = publishBufferBody();
  const stamp = body.indexOf('publishAttemptedAt');
  const call = body.indexOf('bufferGraphql(');
  assert.ok(stamp > -1, 'publishBuffer must record that it tried');
  assert.ok(call > -1, 'publishBuffer must still make the call');
  assert.ok(stamp < call,
    'stamping AFTER the call is no guard at all: the answer that never came back is the one that matters');
  assert.ok(body.slice(stamp, call).includes('save()'),
    'and it must be persisted, or a restart loses it');
});

test('a second attempt refuses rather than posting again', () => {
  const body = publishBufferBody();
  assert.match(body, /alreadyAttempted/, 'the second attempt has to know it is the second');
  assert.match(body, /retryable: false|retryable: !alreadyAttempted/,
    'once it has been sent, the failure must stop being retryable');
  assert.match(body, /Buffer queue/,
    'and the message must tell somebody where to look before they retry');
});

test('a lost connection is caught, not allowed through as retryable', () => {
  /*
   * The exact shape that produced the duplicate: jsonRequest labels a network
   * failure `retryable: true`, and without a catch here that label survives all
   * the way to processTarget, which schedules another attempt.
   */
  const body = publishBufferBody();
  const call = body.indexOf('bufferGraphql(');
  const after = body.slice(call);
  assert.match(after, /catch\s*\(/, 'the call must be wrapped');
  assert.match(after, /error\?\.retryable !== false|retryable !== false/,
    'a network failure after a recorded attempt must be downgraded, not retried');
});

test('the providers that already had a guard still have one', () => {
  // A regression here would be silent: the duplicate only appears at the
  // platform, never in a log on this side.
  assert.match(source, /publishAttemptedAt/, 'Instagram');
  assert.match(source, /youtubeUploadStatus/, 'YouTube resumable session');
});
