import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// The app sent no security headers at all. These pin the policy that replaced
// that, and the two habits it depends on: no inline handlers anywhere in the
// served HTML, and one inline <script> whose hash the policy names.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-headers-'));
const port = 39900 + Math.floor(Math.random() * 90);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
// A public https base URL is what makes HSTS apply -- and the server now
// refuses to start on one with authentication off or a weak session secret,
// so this has to be a configuration that would really be safe to serve.
process.env.AUTH_REQUIRED = 'true';
process.env.APP_SESSION_SECRET = 'headers-test-secret-long-enough-to-be-accepted';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
test.after(() => new Promise(resolve => server.close(resolve)));
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test('every response carries the security headers', async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(res.headers.get('permissions-policy') || '', /camera=\(\)/);
  assert.match(res.headers.get('strict-transport-security') || '', /max-age=\d{7,}/,
    'HSTS once the public URL is https');
});

test('the policy allows the page its own scripts and nothing injected', async () => {
  const csp = (await fetch(`${base}/healthz`)).headers.get('content-security-policy') || '';
  assert.ok(csp, 'a policy is sent');

  const scriptSrc = csp.split(';').map(p => p.trim()).find(p => p.startsWith('script-src'));
  assert.ok(scriptSrc, 'script-src is set');
  assert.doesNotMatch(scriptSrc, /unsafe-inline/,
    "script-src must never take 'unsafe-inline' -- that is the whole protection");
  assert.doesNotMatch(scriptSrc, /unsafe-eval/);
  assert.match(scriptSrc, /'sha256-[A-Za-z0-9+/=]{40,}'/,
    "the page's own inline block is allowed by hash");

  assert.match(csp, /frame-ancestors 'none'/, 'the app cannot be framed');
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
});

test('every inline script in the SERVED page is allowed by the policy', async () => {
  // This asserted against the file on disk, which is not what the browser gets:
  // serveAppShell injects `window.STUDIO_SHELL=true` into <head>, the policy
  // knew nothing about it, the browser refused it, and every visitor silently
  // got the old dashboard instead of the studio. Fetch the page.
  // /app is behind sign-in, so this needs a session -- which is also the only
  // way to see what a real visitor is actually served.
  const auth = await import('../src/auth.js');
  const token = auth.createSession(auth.ownerUser(), { provider: 'test' });
  const res = await fetch(`${base}/app`, { headers: { cookie: `dc_session=${token}` } });
  const html = await res.text();
  const csp = res.headers.get('content-security-policy') || '';
  const crypto = await import('node:crypto');

  const blocks = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(blocks.length >= 2, 'the served page carries the shell flag and the page script');
  for (const match of blocks) {
    const hash = crypto.createHash('sha256').update(match[1], 'utf8').digest('base64');
    assert.ok(csp.includes(`'sha256-${hash}'`),
      `an inline block the browser will receive is not in the policy: ${JSON.stringify(match[1].slice(0, 60))}`);
  }
  assert.match(html, /STUDIO_SHELL/, 'and the studio shell is what is being served');
});

test('no served HTML carries an inline event handler', () => {
  // One of these on the login page was a reflected XSS. They also force
  // 'unsafe-inline', which would make the whole policy decorative.
  for (const file of ['src/public/index.html', 'src/auth.js', 'src/marketing.js']) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const handlers = source.match(/ on(?:click|mouseover|mouseout|load|error|submit|change|focus|blur)="/g) || [];
    assert.equal(handlers.length, 0, `${file} still has ${handlers.length} inline handler(s)`);
  }
});

test('an API response is never stored by a shared cache', async () => {
  // Headers are set before routing, so this holds whatever the route answers --
  // including the 401 an unauthenticated call gets.
  const res = await fetch(`${base}/api/state`);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('the server refuses to serve a configuration that is not safe', async () => {
  const { fatalConfigurationErrors, config } = await import('../src/config.js');
  const original = { auth: config.authRequired, password: config.password };
  try {
    config.authRequired = false;
    assert.match(fatalConfigurationErrors().join(' '), /AUTH_REQUIRED/);

    config.authRequired = true;
    config.password = 'short';
    assert.match(fatalConfigurationErrors().join(' '), /APP_PASSWORD/);

    config.password = original.password;
    assert.deepEqual(fatalConfigurationErrors(), [], 'a sound configuration starts');
  } finally {
    Object.assign(config, { authRequired: original.auth, password: original.password });
  }
});

test('a session is an opaque token, not something signed with a secret', async () => {
  // There used to be a guard here refusing to start on a short
  // APP_SESSION_SECRET, on the stated grounds that session cookies signed with
  // it could be forged. Nothing ever read that value. Sessions are random
  // tokens stored server side as hashes and validated by lookup, so there is
  // no signing key to get wrong -- and a guard over an unused value tells the
  // operator that rotating it hardened something.
  //
  // This pins the real property, so the guard cannot come back as theatre: a
  // cookie that is not in the session store is rejected no matter what any
  // configured secret is.
  const auth = await import('../src/auth.js');
  const cookieOf = token => ({ headers: { cookie: `dc_session=${token}` } });

  const token = auth.createSession(auth.ownerUser(), { provider: 'test' });
  assert.ok(auth.sessionUser(cookieOf(token)), 'a real session is accepted');
  assert.ok(token.length >= 32, 'the token carries its own entropy');

  assert.equal(auth.sessionUser(cookieOf('forged-session-token')), null,
    'an invented token is refused');
  assert.equal(auth.sessionUser(cookieOf(token + 'x')), null,
    'and so is a tampered one');
});

test('a body over the cap is refused with a reason, not a 500', async () => {
  const res = await fetch(`${base}/api/backgrounds`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'content-length': String(200 * 1024 * 1024) },
    body: JSON.stringify({ name: 'x', data: 'AAAA', mimeType: 'video/mp4' }),
  }).catch(() => null);
  // Either the declared length is refused up front, or the socket is closed --
  // both are correct, and neither is the old behaviour of buffering it all.
  if (res) assert.ok(res.status === 413 || res.status === 400, `got ${res.status}`);
});
