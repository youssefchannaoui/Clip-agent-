import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * Web Push — notifications with the app CLOSED (v3.90.0).
 *
 * The reason this file leans on the RFC's own worked example rather than on
 * round-tripping our own encrypt/decrypt: a self-consistent implementation
 * that disagrees with the spec passes a round-trip test perfectly and then
 * fails SILENTLY in production. The push service accepts the POST, returns
 * 201, and the device shows nothing — indistinguishable from the feature not
 * being built. RFC 8291 §5 publishes fixed keys, a fixed salt and the exact
 * expected body; reproducing it byte for byte is the only proof available
 * without a real push service to send to.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-push-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'push-test-secret-long-enough-here';

const push = await import('../src/push.js');
const { state } = await import('../src/store.js');
const { config } = await import('../src/config.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* harmless */ }
});

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = str => Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

test('encryption reproduces RFC 8291 §5 byte for byte', () => {
  const body = push.encryptPayload({
    payload: 'When I grow up, I want to be a watermelon',
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
    salt: unb64('DGv6ra1nlYgDCS1FRnbzlw'),
    serverKeys: {
      privateKey: unb64('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw'),
      publicKey: unb64('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'),
    },
  });
  assert.equal(
    b64url(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
    'the aes128gcm body must match the RFC exactly — a body that is merely self-consistent is accepted by the push service and shows nothing',
  );
});

test('a fresh salt and ephemeral key are used for every real send', () => {
  // Reusing either across two messages to the same subscription leaks the
  // plaintext. Nothing passes them in production; this proves the default path
  // does not quietly reuse one.
  const sub = {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  };
  const a = push.encryptPayload({ payload: 'hello', ...sub });
  const b = push.encryptPayload({ payload: 'hello', ...sub });
  assert.notEqual(a.subarray(0, 16).toString('hex'), b.subarray(0, 16).toString('hex'), 'salt must differ');
  assert.notEqual(a.subarray(21, 86).toString('hex'), b.subarray(21, 86).toString('hex'), 'ephemeral key must differ');
  assert.notEqual(a.toString('hex'), b.toString('hex'));
});

test('a malformed subscription is refused rather than encrypted to nothing', () => {
  const good = { payload: 'x', p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' };
  assert.throws(() => push.encryptPayload({ ...good, p256dh: b64url(Buffer.alloc(65)) }), /uncompressed P-256/);
  assert.throws(() => push.encryptPayload({ ...good, p256dh: b64url(Buffer.alloc(32)) }), /uncompressed P-256/);
  assert.throws(() => push.encryptPayload({ ...good, auth: b64url(Buffer.alloc(8)) }), /16 bytes/);
});

test('the VAPID header is a real ES256 JWT the push service can verify', () => {
  const keys = push.generateVapidKeys();
  const now = 1_700_000_000_000;
  const header = push.vapidHeader({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc123?x=1',
    keys, subject: 'mailto:support@deenclipped.online', now,
  });
  const match = header.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/);
  assert.ok(match, `header must be "vapid t=<jwt>, k=<key>" — got ${header}`);

  const [, jwt, key] = match;
  assert.equal(key, keys.publicKey, 'k= must carry the public key the subscription was made with');
  const [h, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(unb64(h).toString()), { typ: 'JWT', alg: 'ES256' });

  const body = JSON.parse(unb64(claims).toString());
  // The ORIGIN, never the full URL: the endpoint path is the secret half of a
  // subscription and does not belong in a token that gets logged.
  assert.equal(body.aud, 'https://fcm.googleapis.com');
  assert.equal(body.sub, 'mailto:support@deenclipped.online');
  assert.ok(body.exp > now / 1000 && body.exp <= now / 1000 + 24 * 3600, 'RFC 8292 caps the lifetime at 24h');

  // Verify it the way a push service does. Node signs DER by default, which
  // every push service rejects with a bare 401 that reads like a wrong key —
  // so this asserts the raw r||s encoding JWS actually requires.
  const raw = unb64(signature);
  assert.equal(raw.length, 64, 'ES256 signatures are 64 raw bytes, not DER');
  const pub = unb64(keys.publicKey);
  const verified = crypto.verify('sha256', Buffer.from(`${h}.${claims}`), {
    key: crypto.createPublicKey({
      format: 'jwk',
      key: { kty: 'EC', crv: 'P-256', x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)) },
    }),
    dsaEncoding: 'ieee-p1363',
  }, raw);
  assert.ok(verified, 'the signature must verify against the public key we advertise');
});

test('the server keeps one identity, and never mints a second', () => {
  // Every subscription in the wild is bound to the public key it was created
  // with. A second pair silently invalidates all of them, and nothing anywhere
  // reports it — the notifications just stop.
  state.pushKeys = null;
  const first = push.serverKeys();
  assert.equal(push.serverKeys().publicKey, first.publicKey);
  assert.equal(push.serverKeys().publicKey, first.publicKey);
  assert.equal(state.pushKeys.publicKey, first.publicKey, 'and it survives a restart because it is in state');
  assert.equal(unb64(first.publicKey).length, 65);
  assert.equal(unb64(first.publicKey)[0], 4);
});

// ── subscriptions ──────────────────────────────────────────────────────────
const SUB = endpoint => ({
  endpoint,
  keys: {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  },
});

test('subscribing twice from one browser is one row, not two notifications', () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/a'), { device: 'Chrome on Mac' });
  push.subscribe('u1', SUB('https://push.example/a'), { device: 'Chrome on Mac' });
  assert.equal(push.subscriptionsFor('u1').length, 1, 'the endpoint is the identity — an insert here is a duplicate pop-up');
  push.subscribe('u1', SUB('https://push.example/b'), { device: 'Safari on iOS' });
  assert.equal(push.subscriptionsFor('u1').length, 2, 'a second device is a second row');
});

test('a subscription that is not one is refused at the door', () => {
  state.pushSubs = {};
  assert.throws(() => push.subscribe('u1', SUB('http://push.example/a')), /https/);
  assert.throws(() => push.subscribe('u1', { endpoint: 'https://p/a', keys: { auth: 'BTBZMqHH6r4Tts7J_aSIgg' } }), /encryption key/);
  assert.throws(() => push.subscribe('u1', { endpoint: 'https://p/a', keys: { p256dh: SUB('x').keys.p256dh } }), /auth secret/);
  assert.equal(push.subscriptionsFor('u1').length, 0);
});

test('one account is separate from another', () => {
  state.pushSubs = {};
  push.subscribe('mine', SUB('https://push.example/mine'));
  push.subscribe('theirs', SUB('https://push.example/theirs'));
  push.unsubscribe('mine', 'https://push.example/theirs');
  assert.equal(push.subscriptionsFor('theirs').length, 1, 'unsubscribing names an endpoint on YOUR account only');
  assert.equal(push.subscriptionsFor('mine').length, 1);
});

// ── sending ────────────────────────────────────────────────────────────────
function fakePush(statusFor) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, body: init.body });
      return { status: typeof statusFor === 'function' ? statusFor(url) : statusFor };
    },
  };
}

test('a delivered push carries the encrypted body and the VAPID headers', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/a'));
  const fake = fakePush(201);
  const result = await push.notify('u1', { title: 'Your clips are ready', body: 'Az-Zumar finished', url: '/app#review' }, fake);

  assert.deepEqual(result, { sent: 1, removed: 0 });
  assert.equal(fake.calls.length, 1);
  const call = fake.calls[0];
  assert.equal(call.url, 'https://push.example/a');
  assert.equal(call.headers['Content-Encoding'], 'aes128gcm');
  assert.match(call.headers.Authorization, /^vapid t=/);
  assert.ok(Buffer.isBuffer(call.body) && call.body.length > 86, 'salt + header + key + ciphertext');
  // The plaintext must not be recoverable from the wire. A body containing the
  // title in the clear would mean the encryption step was skipped entirely.
  assert.ok(!call.body.includes(Buffer.from('Az-Zumar')), 'the payload must be encrypted, not merely posted');
});

test('410 unsubscribes the device; a bad day does not', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/gone'));
  push.subscribe('u1', SUB('https://push.example/fine'));

  const gone = fakePush(url => (url.endsWith('/gone') ? 410 : 201));
  const result = await push.notify('u1', { title: 'x', body: 'y' }, gone);
  assert.deepEqual(result, { sent: 1, removed: 1 });
  assert.deepEqual(push.subscriptionsFor('u1').map(r => r.endpoint), ['https://push.example/fine']);

  // A 500 is the push service having a bad ten minutes, not a device that has
  // gone. Dropping it there loses a real subscriber who would never know.
  const flaky = fakePush(500);
  await push.notify('u1', { title: 'x', body: 'y' }, flaky);
  assert.equal(push.subscriptionsFor('u1').length, 1, 'a soft failure keeps the row');
  assert.equal(push.subscriptionsFor('u1')[0].failures, 1);
});

test('a push service that refuses forever eventually gives the row up', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/dead'));
  const flaky = fakePush(500);
  for (let i = 0; i < 8; i++) await push.notify('u1', { title: 'x', body: 'y' }, flaky);
  assert.equal(push.subscriptionsFor('u1').length, 0, 'after the soft-failure budget it is dropped');
});

test('a throwing network never reaches the caller', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/a'));
  const result = await push.notify('u1', { title: 'x', body: 'y' }, {
    fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND'); },
  });
  // A notification is the least important thing happening when a lecture
  // finishes; it must never be able to fail the job that triggered it.
  assert.deepEqual(result, { sent: 0, removed: 0 });
  assert.equal(push.subscriptionsFor('u1').length, 1, 'a DNS failure is not a dead subscription');
});

test('an account with no subscription costs nothing', async () => {
  state.pushSubs = {};
  const fake = fakePush(201);
  assert.deepEqual(await push.notify('nobody', { title: 'x' }, fake), { sent: 0, removed: 0 });
  assert.equal(fake.calls.length, 0, 'no subscription means no request at all');
  assert.equal(push.hasSubscriptions('nobody'), false);
});

test('PUSH_NOTIFS=false stops it dead, everywhere', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/a'));
  const was = config.pushNotifsEnabled;
  config.pushNotifsEnabled = false;
  try {
    const fake = fakePush(201);
    const result = await push.notify('u1', { title: 'x' }, fake);
    assert.equal(result.skipped, 'disabled');
    assert.equal(fake.calls.length, 0);
    assert.equal(push.publicKey(), null, 'and the browser is never offered a key it cannot use');
    assert.equal(push.hasSubscriptions('u1'), false);
  } finally { config.pushNotifsEnabled = was; }
});

test('the payload the service worker receives is the shape it reads', async () => {
  state.pushSubs = {};
  push.subscribe('u1', SUB('https://push.example/a'));
  let captured = null;
  // Decrypt our own body back with the RFC's user-agent private key to read
  // what the worker would see. This is the round trip — worth having ONLY
  // because the vector test above already pins the encryption to the spec.
  const uaPrivate = unb64('q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94');
  const uaPublic = unb64('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4');
  const authSecret = unb64('BTBZMqHH6r4Tts7J_aSIgg');
  await push.notify('u1', { title: 'Clip published', body: 'It is live', url: '/app#schedule', tag: 'clip-posted-c1' }, {
    fetchImpl: async (url, init) => { captured = init.body; return { status: 201 }; },
  });

  const salt = captured.subarray(0, 16);
  const asPublic = captured.subarray(21, 86);
  const ciphertext = captured.subarray(86);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(uaPrivate);
  const shared = ecdh.computeSecret(asPublic);
  const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
  const hkdf = (s, ikm, info, len) => hmac(hmac(s, ikm), Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(ciphertext.length - 16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, ciphertext.length - 16)), decipher.final()]);
  assert.equal(plain[plain.length - 1], 2, 'the last-record delimiter RFC 8188 requires');

  const message = JSON.parse(plain.subarray(0, plain.length - 1).toString());
  // sw.js reads exactly these four keys. A rename on either side shows up as a
  // notification saying "Something happened in your studio".
  assert.deepEqual(Object.keys(message).sort(), ['body', 'tag', 'title', 'url']);
  assert.equal(message.title, 'Clip published');
  assert.equal(message.url, '/app#schedule');
});

test('the service worker shows something for every push, and opens the right screen', () => {
  const sw = fs.readFileSync(new URL('../src/public/sw.js', import.meta.url), 'utf8');
  // userVisibleOnly means the browser REQUIRES a notification per delivered
  // push and penalises an app that stays silent, so there must be no path
  // through the handler that shows nothing.
  assert.match(sw, /showNotification/);
  assert.ok(!/event\.data[\s\S]{0,80}?\breturn\b/.test(sw.split('addEventListener(\'push\'')[1]?.split('notificationclick')[0] || ''),
    'the push handler must not bail out without showing anything');
  assert.match(sw, /notificationclick/);
  assert.match(sw, /pushsubscriptionchange/, 'a retired subscription must re-register itself or the device goes silent for good');
  // A caching service worker on an app that ships several times a day strands
  // people on a stale dashboard with no way to force a refresh.
  assert.ok(!/addEventListener\(\s*['"]fetch['"]/.test(sw), 'sw.js must not intercept fetch');
});

test('the in-tab notifier stands down when push is live', () => {
  const html = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const fn = html.slice(html.indexOf('window.fireClipNotifs=function'));
  const body = fn.slice(0, fn.indexOf('}catch(e){}};'));
  // Both paths fire on the same three moments. With a subscription the service
  // worker already shows them — whether or not a tab is open — so leaving this
  // one running is every notification twice.
  assert.match(body, /if\(window\.__dcPushOn\)return;/,
    'without this the same event notifies twice on any subscribed browser');
  assert.ok(body.indexOf('__dcPushOn') < body.indexOf('Your clips are ready'),
    'and it must stand down BEFORE it decides what to show');
});

test('push and email are separate decisions', () => {
  const engine = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  // Turning product email off is not a request to stop being told a lecture
  // finished — it is a request to stop being mailed. Gating push on
  // emailNotifsOff would silently take a channel away that nobody switched
  // off, so the guard around each push.notify call is read on its own: from
  // the `if (` that opens it to the `.catch` that ends it.
  const guardOf = (src, from) => {
    const call = src.indexOf('push.notify', from);
    const open = src.lastIndexOf('if (', call);
    return src.slice(open, src.indexOf('.catch', call));
  };
  for (const src of [engine, fs.readFileSync(new URL('../src/agent.js', import.meta.url), 'utf8')]) {
    let at = 0;
    while (src.indexOf('push.notify', at) !== -1) {
      const guard = guardOf(src, at);
      assert.ok(!guard.includes('emailNotifsOff'), `push must not sit behind the email switch:\n${guard.slice(0, 160)}`);
      at = src.indexOf('push.notify', at) + 1;
    }
  }
  // All three moments email already covers, each landing on the screen that
  // answers it. Matched on the title and the destination together: a push that
  // says "your clips are ready" and opens the home screen is a worse
  // notification than none, because the person has to go looking.
  const agent = fs.readFileSync(new URL('../src/agent.js', import.meta.url), 'utf8');
  const moments = [
    [engine, "title: 'Your clips are ready'", '/app#review'],
    [engine, "title: 'A lecture could not be processed'", "/app`"],
    [agent, "'Clip published'", '/app#schedule'],
  ];
  for (const [src, title, url] of moments) {
    const at = src.indexOf(title);
    assert.ok(at > 0, `no push for ${title}`);
    const call = src.slice(src.lastIndexOf('push.notify', at), src.indexOf('.catch', at));
    assert.ok(call.startsWith('push.notify'), `${title} must be a push, not only an email`);
    assert.ok(call.includes(url), `${title} must open ${url}, not drop someone on the home screen`);
    assert.ok(/tag: `/.test(call), `${title} must carry a tag, or two lectures finishing stack up two rows to dismiss`);
  }
  assert.ok(agent.indexOf('push.notify') < agent.indexOf('if (!owner.email || emailNotifsOff'),
    'the push send must come before the email gate returns, or a muted inbox mutes push too');
});
