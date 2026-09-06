import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * The app's half of a worker that can be stopped (6 Sept 2026).
 *
 * The worker now resumes an interrupted job (service.py: shutdown(),
 * recover(), the plan checkpoint). This file drives what the APP does around
 * it, against a fake worker on a local port:
 *
 *   - a re-render or more-clips job whose worker stops moving is cancelled
 *     and failed by the same three-way liveness signature runRemoteProject
 *     has always watched -- runRemoteAux had NO stall detection, so such a
 *     job sat at "processing" for the six-hour timeout holding both slots;
 *   - a worker that answers 404 for a job it was given (a replaced data
 *     volume, an aged-out record) is handed the same payload under the same
 *     id ONCE; a second 404 is the failure it always was;
 *   - agent.tick() pumps the queue when a retry is overdue, so a retry timer
 *     lost with the process is no longer lost for good;
 *   - the outage window (MAX_WORKER_RETRIES) outlasts a worker rebuild.
 *
 * Everything executed reads records after the real pump() ran the real
 * runRemoteAux; the two pins at the end are for the constants CI cannot
 * otherwise see.
 */
const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The fake worker. Three behaviours, chosen per test.
const calls = { create: 0, get: 0, cancel: 0 };
let mode = 'stall';
const worker = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && req.url === '/jobs') {
    calls.create += 1;
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => { const payload = JSON.parse(raw || '{}'); send(202, { id: payload.id, status: 'queued', stage: 'queued', progress: 0 }); });
    return;
  }
  const match = /^\/jobs\/([^/]+)(\/cancel)?$/.exec(req.url || '');
  if (match && match[2]) { calls.cancel += 1; return send(200, { id: match[1], status: 'cancelled', stage: 'cancelled' }); }
  if (match) {
    calls.get += 1;
    // Frozen: the same stage, progress and heartbeat on every poll.
    if (mode === 'stall') return send(200, { id: match[1], status: 'processing', stage: 'Rendering', progress: 50, heartbeatAt: 1 });
    // Lost once: 404 until the app submits the job again, then cancelled.
    if (mode === 'lost') return calls.create >= 2 ? send(200, { id: match[1], status: 'cancelled', stage: 'cancelled' }) : send(404, { error: 'Job not found.' });
    return send(404, { error: 'Job not found.' });
  }
  send(404, { error: 'Not found.' });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
const port = worker.address().port;

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-worker-resilience-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'worker-resilience-secret-long-enough';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
process.env.PUBLIC_BASE_URL = 'https://app.test';
process.env.PROCESSING_MODE = 'remote';
process.env.WORKER_BASE_URL = `http://127.0.0.1:${port}`;
process.env.WORKER_SHARED_SECRET = 'w'.repeat(40);
process.env.WORKER_POLL_INTERVAL_MS = '1000';
process.env.WORKER_STALL_TIMEOUT_MS = '1500';
process.env.WORKER_REQUEST_TIMEOUT_MS = '5000';

const { state, save } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

function queueRerender(id) {
  const jobFile = path.join(dataDir, `${id}.json`);
  fs.writeFileSync(jobFile, JSON.stringify({ id, mode: 'rerender', clip: {} }));
  const item = { id, clipId: `clip-${id}`, status: 'queued', engine: 'remote', preview: false, jobFile, createdAt: Date.now(), stage: 'queued', progress: 0 };
  state.rerenderJobs.push(item);
  save();
  return item;
}

async function settled(item, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (['failed', 'cancelled', 'done', 'completed'].includes(item.status)) return item;
    await sleep(50);
  }
  throw new Error(`job ${item.id} never settled: ${item.status} / ${item.stage}`);
}

after(async () => {
  await new Promise(resolve => worker.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* a leftover temp dir is harmless */ }
});

test('a re-render whose worker stops moving is cancelled on the worker and failed here', async () => {
  mode = 'stall';
  const item = queueRerender('rr-stall');
  await engine.pump();
  await settled(item);
  assert.equal(item.status, 'failed');
  assert.match(String(item.error), /stopped responding/);
  assert.equal(calls.cancel, 1, 'the worker was told to stop before the app gave up');
  assert.ok(calls.get >= 2, `polled more than once before deciding: ${calls.get}`);
});

test('a job the worker has lost is submitted again once, under the same id', async () => {
  await sleep(150);
  Object.assign(calls, { create: 0, get: 0, cancel: 0 });
  mode = 'lost';
  const item = queueRerender('rr-lost');
  await engine.pump();
  await settled(item);
  assert.equal(item.status, 'cancelled', 'the worker answered with its own record once it had one');
  assert.equal(calls.create, 2, 'the original submit plus exactly one re-submit');
  assert.equal(calls.cancel, 0);
});

test('a worker that keeps losing the job gets one re-submit and then the failure it earned', async () => {
  await sleep(150);
  Object.assign(calls, { create: 0, get: 0, cancel: 0 });
  mode = 'lost-forever';
  const item = queueRerender('rr-gone');
  await engine.pump();
  await settled(item);
  assert.equal(item.status, 'failed');
  assert.match(String(item.error), /Job not found/);
  assert.equal(calls.create, 2, 'never a third submit');
});

test('retryDue() is true only for a queued job whose retry time has passed', () => {
  const now = 1_000_000;
  state.projects.length = 0;
  state.rerenderJobs.length = 0;
  assert.equal(engine.retryDue(now), false);
  state.projects.push({ id: 'p1', status: 'queued', engine: 'remote' });
  assert.equal(engine.retryDue(now), false, 'queued with no retry armed is not overdue -- a seeded fixture never starts by itself');
  state.projects.push({ id: 'p2', status: 'queued', engine: 'remote', nextRetryAt: now + 1 });
  assert.equal(engine.retryDue(now), false, 'a retry still in the future');
  state.projects.push({ id: 'p3', status: 'processing', engine: 'remote', nextRetryAt: now - 1 });
  assert.equal(engine.retryDue(now), false, 'a job that is running is not waiting');
  state.projects.push({ id: 'p4', status: 'queued', engine: 'remote', nextRetryAt: now - 1 });
  assert.equal(engine.retryDue(now), true);
  state.projects.length = 0;
  state.projects.push({ id: 'p5', status: 'done', moreJob: { status: 'queued', nextRetryAt: now - 5 } });
  assert.equal(engine.retryDue(now), true, 'a more-clips job counts');
  state.projects.length = 0;
  state.rerenderJobs.push({ id: 'r1', status: 'queued', nextRetryAt: now - 5 });
  assert.equal(engine.retryDue(now), true, 'so does a re-render');
  state.rerenderJobs.length = 0;
});

test('agent.tick() pumps the queue when a retry is overdue, and only then', () => {
  const agent = read('src/agent.js');
  const tick = agent.slice(agent.indexOf('export async function tick()'), agent.indexOf('export function start()'));
  assert.match(tick, /if \(engine\.retryDue\(\)\) engine\.pump\(\)/, 'the pump is gated on an overdue retry');
});

test('the outage window outlasts a worker rebuild, and the stall budget is tunable for tests only', () => {
  const src = read('src/local-engine.js');
  assert.match(src, /const MAX_WORKER_RETRIES = 20;/, 'twenty polls thirty seconds apart: ten minutes');
  assert.match(src, /Number\(process\.env\.WORKER_STALL_TIMEOUT_MS\) \|\| 5 \* 60_000/);
  // Both remote loops share the 404 rule and the stall rule.
  const aux = src.slice(src.indexOf('async function runRemoteAux('), src.indexOf('function importResultObject(') > 0 ? src.length : src.length);
  assert.match(aux, /lostByWorker\(error\)/);
  assert.match(aux, /stallBudgetFor\(update\.stage\)/);
  assert.match(aux, /workerClient\.cancelJob\(jobRecord\.id\)\.catch/, 'a stalled or timed-out aux job tells the worker to stop');
});
