import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * An explicit MAX_CONCURRENT_JOBS may only ever CAP the box, never raise it
 * (8 Sept 2026).
 *
 * The same machinery as test/worker-slots.test.mjs with the variable TYPED,
 * and it has to be its own process: config.js reads the environment once, at
 * first import, so a second value in the same file would be answered from the
 * first one's config -- the trap the Apple sign-in tests already paid for.
 *
 * Both directions matter and they are different rules:
 *   - someone who sets 1 is asking for one whatever the box reports;
 *   - someone who sets 8 against a three-slot box still gets three, because
 *     the box is the thing that has the cores.
 */
process.env.MAX_CONCURRENT_JOBS = '2';

const calls = { create: 0 };
let jobMode = 'processing';

const worker = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.url === '/readiness') return send(200, { ready: true, capabilities: { maxConcurrentJobs: 4 } });
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
    if (jobMode === 'processing') return send(200, { id: match[1], status: 'processing', stage: 'Rendering', progress: 50, heartbeatAt: Date.now() });
    return send(200, { id: match[1], status: 'cancelled', stage: 'cancelled' });
  }
  send(404, { error: 'Not found.' });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
const port = worker.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-worker-slots-cap-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'worker-slots-cap-secret-long-enough-x';
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

test('a typed MAX_CONCURRENT_JOBS is recognised as typed', () => {
  // The default is baked into config.maxConcurrentJobs, so "was it set?"
  // cannot be recovered from that number afterwards and has to travel beside
  // it. Without the distinction the default 1 would look like an operator
  // asking for one, and the box's figure could never be used at all.
  assert.equal(config.maxConcurrentJobsExplicit, true);
  assert.equal(config.maxConcurrentJobs, 2);
});

test('the app keeps its own figure until the box answers', () => {
  assert.equal(engine.concurrencyLimit(), 2);
});

test('an explicit setting caps a bigger box', async () => {
  const learned = await until(() => engine.noteWorkerCapabilities({}) === 4);
  assert.ok(learned, 'the box reported four slots');
  assert.equal(engine.concurrencyLimit(), 2, 'two was asked for, and two is what runs');
});

test('an explicit setting never raises a smaller box', () => {
  // The box is authoritative for its own hardware: eight typed here against a
  // one-slot box is still one, or the app queues work the box cannot start.
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 1 } });
  assert.equal(engine.concurrencyLimit(), 1);
  engine.noteWorkerCapabilities({ capabilities: { maxConcurrentJobs: 4 } });
  assert.equal(engine.concurrencyLimit(), 2);
});

test('the pump obeys the cap rather than the box', async () => {
  calls.create = 0;
  for (let i = 0; i < 5; i += 1) queueRerender(`cap-${i}`);
  await engine.pump();
  assert.equal(calls.create, 2, 'four slots on the box, two asked for here');
});

/*
 * The blank-field case, in its OWN process for the same reason this file is:
 * config.js reads the environment once. A variable left empty in Render's
 * variable list is an operator who never answered -- and Number('') is 0,
 * which read literally is a deliberate instruction to run as few jobs as
 * possible. That would silently pin the queue at one on a three-slot box,
 * which is the bug this whole change exists to fix, arriving by another door.
 */
function explicitIn(value) {
  const out = execFileSync(process.execPath, [
    '-e', "import('./src/config.js').then(m => console.log(JSON.stringify({ explicit: m.config.maxConcurrentJobsExplicit, jobs: m.config.maxConcurrentJobs })))",
  ], { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, MAX_CONCURRENT_JOBS: value }, encoding: 'utf8' });
  // The boot warnings share this stdout, so take the JSON line rather than the
  // whole of it -- parsing everything printed is how the Apple sign-in test
  // came to read a warning as its own answer.
  const line = out.trim().split('\n').filter(Boolean).pop();
  return JSON.parse(line);
}

test('a variable left blank is an operator who never answered, not a request for one job', () => {
  assert.deepEqual(explicitIn(''), { explicit: false, jobs: 1 });
  assert.deepEqual(explicitIn('   '), { explicit: false, jobs: 1 });
  assert.deepEqual(explicitIn('nonsense'), { explicit: false, jobs: 1 }, 'and neither is a typo');
  assert.deepEqual(explicitIn(' 4 '), { explicit: true, jobs: 4 }, 'a real answer, whitespace and all');
  assert.deepEqual(explicitIn('1'), { explicit: true, jobs: 1 }, 'one asked for is one, whatever the box reports');
});
