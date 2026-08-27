import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The health census counted only status 'completed', but the engine finishes
// a lecture as 'done' -- so every success was invisible: the failure rate
// pinned at 100%, and the importer table said "no completed imports in this
// window" while imports completed daily. The owner read his own dashboard
// and concluded the product was broken.

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-health-'));
const { state, save } = await import('../src/store.js');
const owner = await import('../src/owner.js');

const OPERATOR = { id: 'user_owner', role: 'owner' };

test('finished lectures count as successes, whatever the engine calls them', () => {
  state.projects = [
    { id: 'ok1', title: 'Done lecture', status: 'done', importProvider: 'ytdlp', updatedAt: Date.now() },
    { id: 'ok2', title: 'Another', status: 'done', importProvider: 'ytdlp', updatedAt: Date.now() },
    { id: 'bad', title: 'Failed one', status: 'failed', error: 'x', errorCode: 'boom', updatedAt: Date.now() },
  ];
  save();
  const health = owner.pipelineHealth(OPERATOR, { days: 7 });
  assert.equal(health.totals.completed, 2, 'done lectures are completed lectures');
  assert.equal(health.totals.failed, 1);
  assert.equal(health.totals.failureRate, 33, 'one of three finished failed');
  assert.equal(health.importProviders.ytdlp, 2, 'the importer table sees the successes');
});
