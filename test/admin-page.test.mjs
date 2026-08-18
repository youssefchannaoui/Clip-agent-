import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Runs the real HTTP server and requests the operator page from outside, the
// way a browser does. Exists because the page first shipped *below* the
// router's non-/api catch-all: perfectly unit-tested, completely unreachable,
// answering the generic 404 -- which everyone read as a role problem. Only a
// request through the real router can catch that class of bug.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-admin-page-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'admin-page-test-secret-long-enough';
// Auth on, as production runs it. Without these the server auto-signs every
// request as the local admin and the page correctly answers 200 -- which
// proves rendering, but not the signed-out routing this test exists for.
process.env.GOOGLE_SIGNIN_CLIENT_ID = 'google-client-id';
process.env.GOOGLE_SIGNIN_CLIENT_SECRET = 'google-client-secret';

const { server } = await import('../src/server.js');
await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('the operator page is reachable: signed out means login, not the 404 catch-all', async () => {
  const response = await fetch(`${base}/admin/import-network`, { redirect: 'manual' });
  assert.equal(response.status, 302, 'a dead route would fall through to the generic 404');
  assert.match(response.headers.get('location') || '', /^\/login\?returnTo=/);
});

test('unknown pages still hit the catch-all', async () => {
  const response = await fetch(`${base}/admin/no-such-page`, { redirect: 'manual' });
  assert.equal(response.status, 404);
});
