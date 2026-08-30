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

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

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

test('a free plan renders with the watermark even when the style says none', () => {
  const src = path.join(dataDir, 'wm-source.mp4');
  fs.writeFileSync(src, 'x');
  const musicDir = path.join(dataDir, 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(path.join(musicDir, 'wm.mp3'), 'x');
  fs.writeFileSync(path.join(musicDir, 'library.json'), JSON.stringify([
    { id: 'wm1', userId: 'free_wm', shared: true, name: 'T', filename: 'wm.mp3', durationSec: 60 },
  ]));
  state.authUsers.push(
    { id: 'free_wm', email: 'f@f', role: 'creator', providers: {}, billing: { plan: 'free' }, createdAt: Date.now() },
    { id: 'paid_wm', email: 'p@p', role: 'creator', providers: {}, billing: { plan: 'monthly' }, createdAt: Date.now() },
  );
  const snapshot = {
    id: 'clean-bold', name: 'Clean Bold', version: 1, builtIn: true,
    watermark: '', watermarkOpacity: 0,
  };
  for (const [pid, cid, uid] of [['wmp1', 'wmc1', 'free_wm'], ['wmp2', 'wmc2', 'paid_wm']]) {
    state.projects.push({ id: pid, userId: uid, title: 'L', status: 'done', engine: 'self-hosted',
      sourceFile: src, templateSnapshot: { ...snapshot } });
    state.clips.push({ id: cid, projectId: pid, userId: uid, title: 'C', status: 'waiting',
      templateId: 'clean-bold', startSec: 0, endSec: 30, durationMs: 30000, musicEnabled: false });
  }
  engine.queueClipRerender('wmc1', 'clean-bold', {});
  engine.queueClipRerender('wmc2', 'clean-bold', {});
  const jobFor = (id) => {
    const record = state.rerenderJobs.find((job) => job.clipId === id);
    return JSON.parse(fs.readFileSync(record.jobFile, 'utf8'));
  };
  const freeTpl = jobFor('wmc1').template;
  assert.equal(freeTpl.watermark, 'DEENCLIPPED', 'free renders carry the watermark');
  assert.ok(Number(freeTpl.watermarkOpacity) > 0, 'and it is visible');
  const paidTpl = jobFor('wmc2').template;
  assert.equal(String(paidTpl.watermark || ''), '', 'paid renders keep the clean style');
});

test('a queued lecture can be cancelled, and a boost moves it to the front', () => {
  const now = Date.now();
  state.projects.push(
    { id: 'qc1', userId: 'user_admin', title: 'A', status: 'queued', engine: 'remote', submittedAt: now - 9000 },
    { id: 'qc2', userId: 'user_admin', title: 'B', status: 'queued', engine: 'remote', submittedAt: now - 8000 },
  );
  // The newer job jumps the older one.
  assert.equal(engine.queueAhead('qc2') > engine.queueAhead('qc1'), true, 'age orders the queue');
  engine.prioritizeWork('project', 'qc2');
  const boosted = state.projects.find((p) => p.id === 'qc2');
  assert.equal(boosted.priority, 0);
  assert.equal(engine.queueAhead('qc2') < engine.queueAhead('qc1'), true, 'the boost reverses the order');
  // Cancel removes the other from the queue entirely.
  engine.cancelWork('project', 'qc1');
  assert.equal(state.projects.find((p) => p.id === 'qc1').status, 'cancelled');
  // Only queued work can be boosted.
  assert.throws(() => engine.prioritizeWork('project', 'qc1'), /queued/i);
});

test('a render is final from the start, so approving queues nothing', async () => {
  const agent = await import('../src/agent.js');
  const src = path.join(dataDir, 'draft-source.mp4');
  fs.writeFileSync(src, 'x');
  state.projects.push({ id: 'dp1', userId: 'user_admin', title: 'L', status: 'done', engine: 'self-hosted',
    sourceFile: src, templateSnapshot: { id: 'clean-bold', name: 'Clean Bold', version: 1, builtIn: true } });
  state.clips.push({ id: 'dc1', projectId: 'dp1', userId: 'user_admin', title: 'C', status: 'waiting',
    templateId: 'clean-bold', startSec: 0, endSec: 30, durationMs: 30000,
    renderQuality: 'final', renderVerified: true, musicEnabled: false, musicVerified: true });

  const readJob = (record) => JSON.parse(fs.readFileSync(record.jobFile, 'utf8'));
  // Every real render is the file that could be posted; only an editor preview
  // window is still a throwaway draft.
  assert.equal(readJob(engine.queueClipRerender('dc1', 'clean-bold', {})).settings.renderQuality, 'final');

  const before = state.rerenderJobs.length;
  const approved = agent.approveClip('dc1');
  assert.ok(['approved', 'scheduled'].includes(approved.status), 'approved (tick may schedule it at once)');
  assert.equal(state.rerenderJobs.length, before, 'approving started no new render');
});

test('approving twice is not an error, and a rejected clip says so', async () => {
  const agent = await import('../src/agent.js');
  // The card the second tap came from was showing the state it had. Answering
  // "only clips waiting for review can be approved" made a working approval
  // read as a broken button.
  const again = agent.approveClip('dc1');
  assert.ok(['approved', 'scheduled'].includes(again.status));

  state.clips.push({ id: 'dc-rej', projectId: 'dp1', userId: 'user_admin', title: 'R', status: 'rejected',
    templateId: 'clean-bold', renderQuality: 'final', renderVerified: true, musicEnabled: false, musicVerified: true });
  assert.throws(() => agent.approveClip('dc-rej'), /rejected/i);
});

test('a clip rendered before the change still gets its one promotion', async () => {
  const agent = await import('../src/agent.js');
  state.clips.push({ id: 'dc-legacy', projectId: 'dp1', userId: 'user_admin', title: 'Old', status: 'waiting',
    templateId: 'clean-bold', startSec: 0, endSec: 30, durationMs: 30000,
    renderQuality: 'draft', renderVerified: true, musicEnabled: false, musicVerified: true });
  agent.approveClip('dc-legacy');
  const promotion = state.rerenderJobs.find((job) => job.clipId === 'dc-legacy' && job.status !== 'superseded');
  assert.equal(JSON.parse(fs.readFileSync(promotion.jobFile, 'utf8')).settings.renderQuality, 'final');

  // And a quarter-resolution file never leaves the house in the meantime.
  state.clips.find((c) => c.id === 'dc-legacy').targets = [{ platform: 'youtube', status: 'pending' }];
  await assert.rejects(() => agent.publishNow('dc-legacy'), /full-quality render/i);
});
