import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * How many lectures the app sends the box at once (8 Sept 2026).
 *
 * `config.maxConcurrentJobs` defaults to 1 and MAX_CONCURRENT_JOBS is set
 * nowhere, so the queue sent ONE lecture at a time while the worker ran three
 * -- two of the box's three slots were unreachable from here, and nothing
 * anywhere said so. The box is authoritative for its own hardware and reports
 * its figure in /readiness's `capabilities.maxConcurrentJobs`; that key name is
 * fixed and both sides depend on it.
 *
 * This file is the UNSET case, which is production: no MAX_CONCURRENT_JOBS, so
 * the box's number stands alone. test/worker-slots-capped.test.mjs is the same
 * machinery with the variable typed -- it has to be a separate process, because
 * config.js reads the environment once, at first import.
 *
 * Everything is executed: the figure concurrencyLimit() returns, and the number
 * of jobs the real pump() actually created against a fake worker.
 */

// Unset here whatever the shell had: this file's whole subject is what happens
// when the app has no opinion of its own.
delete process.env.MAX_CONCURRENT_JOBS;

const BOX_SLOTS = 3;
const calls = { create: 0, readiness: 0 };
let jobMode = 'processing';   // what a GET /jobs/:id answers
let readinessBody = () => ({ ready: true, capabilities: { maxConcurrentJobs: BOX_SLOTS } });

const worker = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/readiness') { calls.readiness += 1; return send(200, readinessBody()); }
  if (req.method === 'POST' && req.url === '/jobs') {
    calls.create += 1;
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { const payload = JSON.parse(raw || '{}'); send(202, { id: payload.id, status: 'queued', stage: 'queued', progress: 0 }); });
    return;
  }
  const match = /^\/jobs\/([^/]+)(\/cancel)?$/.exec(req.url || '');
  if (match && match[2]) return send(200, { id: match[1], status: 'cancelled', stage: 'cancelled' });
  if (match) {
    // Frozen but ALIVE: the heartbeat moves, so nothing is failed for stalling
    // while the count is being taken.
    if (jobMode === 'processing') return send(200, { id: match[1], status: 'processing', stage: 'Rendering', progress: 50, heartbeatAt: Date.now() });
    return send(200, { id: match[1], status: 'cancelled', stage: 'cancelled' });
  }
  send(404, { error: 'Not found.' });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
const port = worker.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-worker-slots-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'worker-slots-secret-long-enough-here';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.PROCESSING_MODE = 'remote';
process.env.WORKER_BASE_URL = `http://127.0.0.1:${port}`;
process.env.WORKER_SHARED_SECRET = 'w'.repeat(40);
process.env.WORKER_POLL_INTERVAL_MS = '2000';
process.env.WORKER_STALL_TIMEOUT_MS = '60000';
process.env.WORKER_REQUEST_TIMEOUT_MS = '5000';

const { state, save } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const engine = await import('../src/local-engine.js');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function queueRerender(id) {
  const jobFile = path.join(dataDir, `${id}.json`);
  fs.writeFileSync(jobFile, JSON.stringify({ id, mode: 'rerender', clip: {} }));
  const item = { id, clipId: `clip-${id}`, status: 'queued', engine: 'remote', preview: false, jobFile, createdAt: Date.now(), stage: 'queued', progress: 0 };
  state.rerenderJobs.push(item);
  save();
  return item;
}

async function until(predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(40);
  }
  return false;
}

after(async () => {
  jobMode = 'cancelled';
  await until(() => state.rerenderJobs.every(item => ['failed', 'cancelled', 'done'].includes(item.status)), 10_000);
  await new Promise(resolve => worker.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ }
});

test('an unset MAX_CONCURRENT_JOBS is the app having no opinion, not an instruction to run one', () => {
  assert.equal(config.maxConcurrentJobsExplicit, false);
  assert.equal(config.maxConcurrentJobs, 1, 'the default underneath it is still one');
});

test('before the box has answered, the app has only its own figure', () => {
  // The first call returns synchronously and starts the ask in the background:
  // stalling the queue on an unanswered request would be worse than the
  // under-use this fixes.
  assert.equal(engine.concurrencyLimit(), config.maxConcurrentJobs);
});

test('the app runs as many lectures as the BOX says it can', async () => {
  const learned = await until(() => engine.concurrencyLimit() === BOX_SLOTS);
  assert.ok(learned, `never learned the box's figure: still ${engine.concurrencyLimit()}`);
  assert.ok(calls.readiness >= 1, 'it asked the box');
});

test('a payload with no such key leaves the last known figure standing', () => {
  // A worker too old to report one must not drop the app to its own default:
  // that is the behaviour before this existed, and it is worse than what the
  // box already told us.
  assert.equal(engine.noteWorkerCapabilities({ ready: true }), BOX_SLOTS);
  assert.equal(engine.noteWorkerCapabilities({ capabilities: {} }), BOX_SLOTS);
  assert.equal(engine.noteWorkerCapabilities(undefined), BOX_SLOTS);
  assert.equal(engine.concurrencyLimit(), BOX_SLOTS);
});

test('a figure that is not a whole number of slots is refused', () => {
  for (const junk of ['many', 0, -2, null, NaN]) {
    assert.equal(engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: junk } }), BOX_SLOTS, String(junk));
  }
  assert.equal(engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: '4' } }), 4, 'a number over the wire is still a number');
  assert.equal(engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 3.7 } }), 3, 'never rounded UP past what the box will run');
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: BOX_SLOTS } });
});

test('the pump starts exactly as many jobs as the box reports, not one', async () => {
  assert.equal(engine.concurrencyLimit(), BOX_SLOTS, 'the figure under test');
  calls.create = 0;
  for (let i = 0; i < 5; i += 1) queueRerender(`slot-${i}`);
  await engine.pump();
  assert.equal(calls.create, BOX_SLOTS, `the box has ${BOX_SLOTS} slots and the queue holds 5`);
  // And it is genuinely bounded rather than merely slow: a second pump with
  // three already in flight starts nothing more.
  await engine.pump();
  assert.equal(calls.create, BOX_SLOTS, 'a second pump does not overfill the box');
});
