/*
 * A worker left on old code is this project's most expensive recurring
 * mistake: committed, green, pushed, and not deployed -- for weeks, twice,
 * with nothing on any screen able to say so. ("Verified 28 Aug 2026: the box
 * had been sitting on 72fea1a — every worker change since, including the
 * section downloads, had been committed, pushed, green and not running.")
 *
 * The worker reports the release it is running; the app compares it with its
 * own and says so on the Owner screen. A worker that reports no version is
 * itself the answer -- it predates the build that started reporting one.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-drift-'));
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 17450 + Math.floor(Math.random() * 100);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';
process.env.APP_SESSION_SECRET = 'deploy-drift-secret-long-enough';
process.env.WORKER_BASE_URL = 'https://worker.test';
process.env.WORKER_SHARED_SECRET = 'worker-shared-secret-long-enough-for-signing';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { config } = await import('../src/config.js');

let workerHealth = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (String(url).includes('worker.test')) {
    if (workerHealth === null) return new Response('{"error":"down"}', { status: 503 });
    return new Response(JSON.stringify(workerHealth), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return realFetch(url, options);
};

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}
test.after(async () => {
  globalThis.fetch = realFetch;
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const deploy = async () => (await (await fetch(`${base}/api/owner/health?days=7`)).json()).deploy;

test('a box running this release says so', async () => {
  workerHealth = { ok: true, capabilities: { version: config.appVersion } };
  const state = await deploy();
  assert.equal(state.workerVersion, config.appVersion);
  assert.equal(state.behind, false);
  assert.match(state.note, /running this release/i);
});

test('a box running an older release is named as behind, with both versions', async () => {
  workerHealth = { ok: true, capabilities: { version: '3.12.0' } };
  const state = await deploy();
  assert.equal(state.behind, true);
  assert.match(state.note, /3\.12\.0/, 'says what the box is on');
  assert.match(state.note, new RegExp(config.appVersion.replace(/\./g, '\\.')), 'and what it should be on');
  // Not "not live" any more, and that wording was the problem: most releases
  // touch src/ only, so a version gap usually means nothing. On 30 Aug the box
  // read v3.42.0 against an app on v3.49.1 and was completely current. The
  // note must tell the reader how to CHECK rather than assert a stale box.
  assert.match(state.note, /git log/i, 'says how to check whether it actually matters');
  assert.ok(!/not live/i.test(state.note), 'must not assert staleness it cannot know');
});

test('a box too old to report a version is still caught', async () => {
  // Exactly today's situation: the running image predates version reporting.
  workerHealth = { ok: true, capabilities: { faceDetection: true } };
  const state = await deploy();
  assert.equal(state.workerVersion, null);
  assert.equal(state.behind, true);
  assert.match(state.note, /Deploy the box/i);
});

test('an unreachable worker does not masquerade as up to date', async () => {
  workerHealth = null;
  const state = await deploy();
  assert.equal(state.behind, true);
  assert.match(state.note, /could not be reached/i);
});
