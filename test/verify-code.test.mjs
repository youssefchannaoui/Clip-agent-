import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * The confirmation screen: six cells, and the promise that it works without
 * its script.
 *
 * Driven over the real router rather than read, because the whole point of the
 * rebuild is a form shape that changed: six inputs where there was one. A test
 * that greps the markup would pass against a route that quietly reads a `code`
 * field nobody sends any more -- which is not a broken pixel, it is a person
 * locked out of an account they have just created.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-verify-code-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'verify-code-test-secret-long-enough';
// Without these the server auto-signs every request as the local admin, which
// is already verified -- /verify redirects to the app and nothing below runs.
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';
// Confirmation is only ASKED FOR when mail is configured (verificationRequired
// is mailer.configured()). Without these the account is verified on arrival,
// /verify redirects to the app, and every assertion below tests nothing.
process.env.EMAIL_API_KEY = 'test-key';
process.env.EMAIL_FROM = 'test@deenclipped.online';

const auth = await import('../src/auth.js');
const { server } = await import('../src/server.js');
await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir must never fail a green suite */ }
});

/*
 * ONE sign-up, shared. The sign-in throttle is real (three new accounts per
 * connection per day), and a file that spends it reports a broken route when
 * the route is fine.
 */
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'signet@deenclipped.test', password: 'correct horse battery staple', returnTo: '/app' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
// currentUser is how the router itself resolves the account -- a second lookup
// here would be a second answer to the same question.
const whoami = () => auth.currentUser({ headers: { cookie } });

test('a brand new account lands on the confirmation screen, not in the app', () => {
  assert.ok(cookie.startsWith('dc_session='), 'the account signed up');
  assert.match(signup.headers.get('location') || '', /^\/verify/);
  assert.equal(auth.isVerified(whoami()), false);
});

test('the screen draws six cells, and only the first offers the one-time code', async () => {
  const page = await (await fetch(`${base}/verify`, { headers: { cookie } })).text();
  for (const n of [1, 2, 3, 4, 5, 6]) {
    assert.match(page, new RegExp(`name="code${n}"`), `cell ${n} must be a real input`);
  }
  assert.equal((page.match(/autocomplete="one-time-code"/g) || []).length, 1,
    'on every cell, some keyboards offer the code six times over');
  // The button must never be `disabled`: with the enhancement blocked, a form
  // that cannot be submitted is an account nobody can get into. It is dimmed
  // by :valid in the stylesheet instead, which is a look and not a lock.
  assert.ok(!/<button[^>]*\sdisabled/.test(page), 'the submit must stay pressable');
});

test('RAISED IS EMPTY, SUNK IS FILLED -- and it is CSS, so it survives the script being blocked', async () => {
  const page = await (await fetch(`${base}/verify`, { headers: { cookie } })).text();
  // COMMENTS ARE STRIPPED, NEVER THE EXPLANATION REWORDED. The stylesheet's
  // own note about this mechanic contains the string being counted, so the
  // naive count is 7 -- the seventh time in this repo a test has failed on its
  // own explanation.
  const markup = page.replace(/\/\*[\s\S]*?\*\//g, '');
  // :placeholder-shown is the whole mechanic. It only matches when the
  // placeholder attribute is non-empty, so the cells carry a space; drop
  // either half and every cell renders as filled, for ever.
  assert.equal((markup.match(/placeholder=" "/g) || []).length, 6);
  assert.match(page, /input:not\(:placeholder-shown\)/, 'the sunk state must be a CSS rule');
  assert.match(page, /#vcForm:valid \.vc-go/, 'the button must light on form validity, not on script');
});

test('the enhancement is an external file, because an inline block is silently blocked', async () => {
  const page = await (await fetch(`${base}/verify`, { headers: { cookie } })).text();
  // The CSP hashes inline scripts from index.html alone. An inline block here
  // would look perfectly correct in the source and never run.
  const inline = (page.match(/<script(?![^>]*\bsrc=)[^>]*>/g) || []);
  assert.deepEqual(inline, [], 'no inline script may appear on this page');
  assert.match(page, /<script src="\/verify-code\.js"/);
  // Allowlisted AND on disk: a 404 here is a page whose lighting, auto-advance
  // and confirmed disc simply never happen, with nothing in any log.
  const asset = await fetch(`${base}/verify-code.js`);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('content-type') || '', /javascript/);
  assert.ok((await asset.text()).length > 500);
});

test('the resend cooldown is stamped only after a code has actually been sent', async () => {
  const plain = await (await fetch(`${base}/verify`, { headers: { cookie } })).text();
  assert.ok(!/data-cooldown/.test(plain), 'nothing has been sent yet, so nothing to wait for');
  const sent = await (await fetch(`${base}/verify?info=Sent.`, { headers: { cookie } })).text();
  assert.match(sent, /id="vcResend" data-cooldown="30"/);
});

test('the six cells are joined by the route, so the form works with no script at all', async () => {
  const { code } = auth.createVerification(whoami());
  const digits = String(code).split('');
  const body = new URLSearchParams({ returnTo: '/app' });
  digits.forEach((digit, index) => body.append(`code${index + 1}`, digit));
  const response = await fetch(`${base}/auth/verify-code`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', Origin: base },
    body: body.toString(),
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.ok(!/^\/verify/.test(response.headers.get('location') || ''),
    'a correct code must not come back to the confirmation screen');
  assert.equal(auth.isVerified(whoami()), true);
});

test('a single `code` field still wins -- every caller written before this sends one', async () => {
  const fresh = whoami();
  delete fresh.emailVerifiedAt;
  const { code } = auth.createVerification(fresh);
  const response = await fetch(`${base}/auth/verify-code`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ code, returnTo: '/app' }).toString(),
    redirect: 'manual',
  });
  assert.equal(response.status, 302);
  assert.ok(!/^\/verify/.test(response.headers.get('location') || ''));
  assert.equal(auth.isVerified(whoami()), true);
});

test('a wrong code is still refused, cell by cell or not', async () => {
  const fresh = whoami();
  delete fresh.emailVerifiedAt;
  auth.createVerification(fresh);
  const body = new URLSearchParams({ returnTo: '/app' });
  '000000'.split('').forEach((digit, index) => body.append(`code${index + 1}`, digit));
  const response = await fetch(`${base}/auth/verify-code`, {
    method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded', Origin: base },
    body: body.toString(),
    redirect: 'manual',
  });
  assert.match(response.headers.get('location') || '', /^\/verify\?error=/);
  assert.equal(auth.isVerified(whoami()), false);
});

test('ONE light source: every shadow is a multiple of the same two numbers', async () => {
  const page = await (await fetch(`${base}/verify`, { headers: { cookie } })).text();
  // The default is declared on :root, so a page with no pointer and no script
  // is still lit -- the resting pose is the finished one, never a blank.
  assert.match(page, /--sx:\.34;--sy:\.72/);
  const script = await (await fetch(`${base}/verify-code.js`)).text();
  assert.match(script, /setProperty\('--sx'/);
  assert.match(script, /setProperty\('--sy'/);
  // A pointer reports far faster than the screen draws. One rAF that parks
  // itself is what keeps a still page free.
  assert.match(script, /requestAnimationFrame\(paintLamp\)/);
});

test('the confirmed disc is drawn on the server\'s answer, never on the press', async () => {
  const script = await (await fetch(`${base}/verify-code.js`)).text();
  // is-verifying goes on at the press; is-done may only be added after a
  // response that did NOT come back to /verify. Adding it on submit would be
  // this product telling somebody they are verified before it knows.
  const done = script.slice(script.indexOf("add('is-done')") - 700, script.indexOf("add('is-done')"));
  assert.match(done, /landed\.pathname === '\/verify'/,
    'the disc must sit behind the check that the server actually accepted it');
  assert.match(script, /form\.submit\(\)/, 'a failed fetch must fall back to the ordinary post');
});
