import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-supersede-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'supersede-test-secret-long-enough-yes';

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => {
  // Guarded: a leftover temp directory on a CI runner is harmless; a red
  // branch from a cleanup race is not. See admin-page.test.mjs for the race.
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

test('a new re-render supersedes any still-queued one for the same clip', async () => {
  // Seed a self-hosted project with a live source file and one clip.
  const src = path.join(dataDir, 'source.mp4');
  fs.writeFileSync(src, 'x');
  state.authUsers.push({ id: 'user_admin', email: 'a@a', role: 'owner', providers: {}, createdAt: Date.now() });
  state.projects.push({ id: 'p1', userId: 'user_admin', title: 'L', status: 'done', engine: 'self-hosted',
    sourceFile: src, templateIdUsed: 'simple-bold',
    templateSnapshot: { id: 'simple-bold', name: 'Simple Bold', version: 1, builtIn: true } });
  state.clips.push({ id: 'c1', projectId: 'p1', userId: 'user_admin', title: 'C', status: 'waiting',
    templateId: 'simple-bold', startSec: 0, endSec: 30, durationMs: 30000 });
  // Music is mandatory for the queue call; give the account a fake track.
  const musicDir = path.join(dataDir, 'music');
  fs.mkdirSync(musicDir, { recursive: true });
  fs.writeFileSync(path.join(musicDir, 't1.mp3'), 'x');
  fs.writeFileSync(path.join(musicDir, 'library.json'), JSON.stringify([
    { id: 't1', userId: 'user_admin', shared: false, name: 'T', filename: 't1.mp3', durationSec: 60 },
  ]));

  // The first render takes the single slot immediately; the next two queue
  // behind it. The third must replace the second -- only the latest style
  // matters -- while the one already processing is left to the import-time
  // supersede check.
  const first = engine.queueClipRerender('c1', 'simple-bold', {});
  const second = engine.queueClipRerender('c1', 'simple-bold', {});
  const third = engine.queueClipRerender('c1', 'simple-bold', {});
  const jobs = state.rerenderJobs.filter(j => j.clipId === 'c1');
  assert.equal(jobs.length, 3);
  assert.equal(jobs.find(j => j.id === first.id).status, 'processing', 'the running job is left to finish');
  assert.equal(jobs.find(j => j.id === second.id).status, 'superseded', 'the older queued job is replaced');
  assert.equal(jobs.find(j => j.id === third.id).status, 'queued', 'only the newest waits to run');
});

test('interactive renders carry a higher priority than batch sweeps', () => {
  const interactive = engine.queueClipRerender('c1', 'simple-bold', { priority: 0 });
  const batch = engine.queueClipRerender('c1', 'simple-bold', { priority: 2 });
  assert.equal(interactive.priority, 0, 'someone watching goes first');
  assert.equal(batch.priority, 2);
  assert.equal(engine.queueClipRerender('c1', 'simple-bold', {}).priority, 1, 'a deliberate single action sits between');
});
