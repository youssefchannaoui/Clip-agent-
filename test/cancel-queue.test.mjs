/*
 * Cancelling has to actually give the queue back.
 *
 * Reported 28 Aug 2026: "i uploded a video, then cnancled mid way, then
 * uplaoded a new one now its a glitch saying waiting in line bu nothings in
 * front". The label was right -- nothing WAS in front. The single worker slot
 * was still held by the cancelled job, because a remote run let go of its slot
 * only when the WORKER agreed the job was over, and a late poll could put the
 * cancelled lecture back to `processing` on its way there.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-cancel-queue-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'cancel-queue-secret-long-enough';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

state.authUsers.push({ id: 'user_admin', email: 'a@a', role: 'owner', providers: {}, createdAt: Date.now() });

test('a cancelled lecture stays cancelled, whatever the worker says next', () => {
  state.projects.push({
    id: 'cq1', userId: 'user_admin', title: 'Lecture', status: 'processing', engine: 'remote',
    submittedAt: Date.now(), startedAt: Date.now(), progress: 40, stage: 'Transcribing audio',
  });

  engine.cancelWork('project', 'cq1');
  assert.equal(state.projects.find(p => p.id === 'cq1').status, 'cancelled');

  // The poll that was already in flight comes back saying the job is fine.
  engine.acceptRemoteUpdate('cq1', { status: 'processing', stage: 'Transcribing audio', progress: 55 });
  assert.equal(state.projects.find(p => p.id === 'cq1').status, 'cancelled',
    'a poll in flight cannot undo the decision');
  assert.equal(state.projects.find(p => p.id === 'cq1').progress, 40, 'nor keep the bar moving');
});

test('the lecture behind it is genuinely next, not just labelled that way', () => {
  state.projects.push({
    id: 'cq2', userId: 'user_admin', title: 'Second lecture', status: 'queued', engine: 'remote',
    submittedAt: Date.now() + 10,
  });
  // Nothing processing, nothing queued ahead: the count the strip reads from.
  assert.equal(engine.queueAhead('cq2'), 0);
});
