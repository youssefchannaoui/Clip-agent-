import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// /auth/password accepts one shared admin secret and /auth/email accepts any
// account's password. Neither counted a failure, so neither could refuse the
// next attempt: a client could guess as fast as it could send. These go over
// HTTP, because a limiter that is not wired into the route protects nothing.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-throttle-'));
const port = 39200 + Math.floor(Math.random() * 700);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.APP_PASSWORD = 'a-long-enough-admin-password';
process.env.APP_SESSION_SECRET = 'throttle-test-secret-long-enough-to-pass-validation';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const throttle = await import('../src/throttle.js');

test.after(() => new Promise(resolve => server.close(resolve)));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const post = (pathname, form, ip) => fetch(`${base}${pathname}`, {
  method: 'POST',
  redirect: 'manual',
  headers: {
    'content-type': 'application/x-www-form-urlencoded',
    // A browser sends this on every form post; sign-in refuses anything that
    // does not come from the site, so the tests have to look like a browser.
    origin: base,
    ...(ip ? { 'x-forwarded-for': ip } : {}),
  },
  body: new URLSearchParams(form).toString(),
});

const refused = res => {
  const location = res.headers.get('location') || '';
  return /Too\+many|Too%20many/i.test(location) || res.status === 429;
};

test('guessing the admin password is slowed down, then refused', async () => {
  throttle.reset();
  const ip = '203.0.113.10';
  let refusedAt = 0;
  for (let i = 1; i <= 10; i += 1) {
    const res = await post('/auth/password', { password: `wrong-${i}` }, ip);
    if (refused(res) && !refusedAt) refusedAt = i;
  }
  assert.ok(refusedAt > 0, 'unlimited guesses were possible before this');
  assert.ok(refusedAt <= 8, `refused by attempt ${refusedAt}, not after dozens`);

  const res = await post('/auth/password', { password: 'wrong-again' }, ip);
  assert.ok(res.headers.get('retry-after'), 'and it says how long to wait');
});

test('a refusal does not leak whether the password was right', async () => {
  throttle.reset();
  const ip = '203.0.113.11';
  for (let i = 0; i < 9; i += 1) await post('/auth/password', { password: 'nope' }, ip);
  // The correct password, while locked out, must look exactly like a wrong one.
  const res = await post('/auth/password', { password: process.env.APP_PASSWORD }, ip);
  assert.ok(refused(res), 'a locked-out attempt is refused whatever it carries');
  assert.ok(!(res.headers.get('set-cookie') || '').includes('dc_session='),
    'and no session is minted');
});

test('one attacker cannot lock out everyone else', async () => {
  throttle.reset();
  for (let i = 0; i < 12; i += 1) await post('/auth/password', { password: 'nope' }, '198.51.100.5');
  const victim = await post('/auth/password', { password: 'also-wrong' }, '198.51.100.99');
  assert.ok(!refused(victim), 'a different address is unaffected by their failures');
});

test('a spoofed x-forwarded-for cannot buy a fresh allowance', async () => {
  throttle.reset();
  // Behind one proxy the LAST entry is what the proxy observed. A client that
  // prepends fake addresses must still be counted as itself.
  for (let i = 0; i < 10; i += 1) {
    await post('/auth/password', { password: 'nope' }, `10.0.0.${i}, 203.0.113.77`);
  }
  const res = await post('/auth/password', { password: 'nope' }, '10.9.9.9, 203.0.113.77');
  assert.ok(refused(res), 'the real address is still the one being counted');
});

test('email sign-in is throttled too, and a success clears the count', async () => {
  throttle.reset();
  const ip = '203.0.113.30';
  const email = 'throttled@example.com';
  // Create the account, then fail against it a few times.
  const made = await post('/auth/email', { email, password: 'a-good-password' }, ip);
  assert.ok(!refused(made), 'the first sign-in works');

  for (let i = 0; i < 4; i += 1) await post('/auth/email', { email, password: 'wrong' }, ip);
  // Correct password inside the free allowance still works, and resets things.
  const ok = await post('/auth/email', { email, password: 'a-good-password' }, ip);
  assert.ok((ok.headers.get('set-cookie') || '').includes('dc_session='),
    'a correct password inside the allowance signs in');

  const after = await post('/auth/email', { email, password: 'wrong' }, ip);
  assert.ok(!refused(after), 'and the failure count was cleared by the success');
});

test('a sign-in post from another site is refused outright', async () => {
  throttle.reset();
  // The forced-login attack: a page anywhere posts the attacker's credentials,
  // silently signing the visitor into the attacker's account. They then work in
  // it, and the attacker keeps everything they produce.
  const res = await fetch(`${base}/auth/email`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' },
    body: new URLSearchParams({ email: 'attacker@example.com', password: 'attacker-password' }).toString(),
  });
  assert.equal(res.status, 403);
  assert.ok(!(res.headers.get('set-cookie') || '').includes('dc_session='), 'and no session is minted');
});

test('a post with no Origin or Referer at all is refused too', async () => {
  throttle.reset();
  const res = await fetch(`${base}/auth/password`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ password: process.env.APP_PASSWORD }).toString(),
  });
  assert.equal(res.status, 403, 'a browser always sends one; something that does not is not a form post from this site');
});
