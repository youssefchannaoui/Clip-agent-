import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-partial-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'partial-clips-test-secret-long-enough';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('clips announced mid-job land in the queue, and completion does not duplicate them', () => {
  state.authUsers.push({ id: 'user_admin', email: 'a@a', role: 'owner', providers: {}, createdAt: Date.now() });
  state.projects.push({
    id: 'pp1', userId: 'user_admin', title: 'Lecture', status: 'processing',
    engine: 'remote', submittedAt: Date.now(),
  });

  // First poll carries one finished clip; the job is still processing.
  engine.acceptRemoteUpdate('pp1', {
    status: 'processing', stage: 'Rendering clip 2 of 3', progress: 80,
    partialClips: [{ id: 'pc1', projectId: 'worker-job-id', title: 'Clip one', clipUrl: 'https://cdn/x1.mp4', thumbUrl: 'https://cdn/x1.jpg' }],
  });
  const early = state.clips.filter((clip) => clip.projectId === 'pp1');
  assert.equal(early.length, 1, 'the finished clip is a record already');
  assert.equal(early[0].status, 'waiting', 'it sits in the review queue');
  assert.equal(early[0].projectId, 'pp1', 'keyed to the project, not the worker job id');

  // The same clip arrives again on the next poll: no duplicate.
  engine.acceptRemoteUpdate('pp1', {
    status: 'processing', stage: 'Rendering clip 3 of 3', progress: 90,
    partialClips: [
      { id: 'pc1', title: 'Clip one', clipUrl: 'https://cdn/x1.mp4', thumbUrl: 'https://cdn/x1.jpg' },
      { id: 'pc2', title: 'Clip two', clipUrl: 'https://cdn/x2.mp4', thumbUrl: 'https://cdn/x2.jpg' },
    ],
  });
  assert.equal(state.clips.filter((clip) => clip.projectId === 'pp1').length, 2);

  // Completion re-sends every clip in the final result: still no duplicates,
  // and the records pick up the final fields.
  engine.acceptRemoteUpdate('pp1', {
    status: 'completed',
    result: {
      project: { title: 'Lecture', durationSec: 300, clipsRequested: 3 },
      clips: [
        { id: 'pc1', title: 'Clip one', clipUrl: 'https://cdn/x1.mp4', thumbUrl: 'https://cdn/x1.jpg', score: 71 },
        { id: 'pc2', title: 'Clip two', clipUrl: 'https://cdn/x2.mp4', thumbUrl: 'https://cdn/x2.jpg', score: 64 },
        { id: 'pc3', title: 'Clip three', clipUrl: 'https://cdn/x3.mp4', thumbUrl: 'https://cdn/x3.jpg', score: 58 },
      ],
    },
  });
  const finals = state.clips.filter((clip) => clip.projectId === 'pp1');
  assert.equal(finals.length, 3, 'three clips total, none doubled');
  assert.equal(finals.find((clip) => clip.id === 'pc1').score, 71, 'the early record picked up the final fields');
  assert.equal(state.projects.find((p) => p.id === 'pp1').status, 'done');
});

test('queueAhead counts processing and earlier-queued lectures across accounts', () => {
  const now = Date.now();
  state.projects.push(
    { id: 'qa1', userId: 'user_admin', title: 'A', status: 'processing', engine: 'remote', submittedAt: now - 5000 },
    { id: 'qa2', userId: 'other', title: 'B', status: 'queued', engine: 'remote', submittedAt: now - 4000 },
    { id: 'qa3', userId: 'user_admin', title: 'C', status: 'queued', engine: 'remote', submittedAt: now - 3000 },
  );
  assert.equal(engine.queueAhead('qa3'), 2, 'one processing plus one queued earlier');
  assert.equal(engine.queueAhead('qa2'), 1, 'just the processing one');
  assert.equal(engine.queueAhead('qa1'), 0, 'a processing job is not waiting');
});
