import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-legacy-session-'));
const port = 39000 + Math.floor(Math.random() * 500);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';
process.env.APP_PASSWORD = 'legacy-admin-password';
process.env.APP_SESSION_SECRET = 'legacy-session-test-secret-long-enough';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');

test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

test('admin session bypasses the legacy password gate after login', async () => {
  const login = await fetch(`${base}/auth/password`, {
    method: 'POST',
    // Sign-in now refuses a post that did not come from the site.
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
    body: new URLSearchParams({ password: 'legacy-admin-password', returnTo: '/app' }),
    redirect: 'manual',
  });
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0];

  assert.equal(login.status, 302);
  assert.ok(cookie.startsWith('dc_session='));
  assert.equal((await fetch(`${base}/api/state`, { headers: { Cookie: cookie } })).status, 200);
});

test('legacy password protection remains for requests without a session', async () => {
  assert.equal((await fetch(`${base}/api/state`)).status, 401);
  assert.equal((await fetch(`${base}/api/state`, { headers: { 'x-app-password': 'legacy-admin-password' } })).status, 200);
});
