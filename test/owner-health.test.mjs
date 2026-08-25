import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-health-'));

const { state } = await import('../src/store.js');
const owner = await import('../src/owner.js');

const OPERATOR = { id: 'u_owner', role: 'owner' };
const CREATOR = { id: 'u_creator', role: 'user' };
const HOUR = 3600_000;

function seed(projects) {
  state.projects = projects;
}

function project(over = {}) {
  return { id: 'p1', title: 'Lecture', status: 'completed', updatedAt: Date.now() - HOUR, ...over };
}

test('a creator cannot read the pipeline health at all', () => {
  seed([]);
  assert.throws(() => owner.pipelineHealth(CREATOR), /not found|404/i);
});

test('failures are grouped by code, not by message', () => {
  // The whole point: messages carry ids and byte counts, so a hundred
  // instances of one bug would otherwise list as a hundred separate lines.
  seed([
    project({ id: 'a', status: 'failed', errorCode: 'youtube_import_blocked', error: 'job 111 blocked' }),
    project({ id: 'b', status: 'failed', errorCode: 'youtube_import_blocked', error: 'job 222 blocked' }),
    project({ id: 'c', status: 'failed', errorCode: 'processing_failed', error: 'ffmpeg said no' }),
  ]);
  const health = owner.pipelineHealth(OPERATOR);
  assert.equal(health.topFailures.length, 2, 'two codes, not three messages');
  assert.equal(health.topFailures[0].code, 'youtube_import_blocked');
  assert.equal(health.topFailures[0].count, 2);
});

test('the failure rate counts only jobs that reached an ending', () => {
  // Counting the queued as successes reads as healthy every time the queue
  // is busy, which is exactly when it is least true.
  seed([
    project({ id: 'a', status: 'completed' }),
    project({ id: 'b', status: 'failed', errorCode: 'x' }),
    project({ id: 'c', status: 'queued' }),
    project({ id: 'd', status: 'processing' }),
  ]);
  const health = owner.pipelineHealth(OPERATOR);
  assert.equal(health.totals.failureRate, 50, 'one of two finished jobs failed');
});

test('a job with no code is still counted, under one name', () => {
  seed([project({ id: 'a', status: 'failed', error: 'something' })]);
  const health = owner.pipelineHealth(OPERATOR);
  assert.equal(health.topFailures[0].code, 'unclassified');
});

test('only successes credit an import provider', () => {
  // Counting failures here would credit socialkit for the job it lost.
  seed([
    project({ id: 'a', status: 'completed', importProvider: 'socialkit' }),
    project({ id: 'b', status: 'failed', errorCode: 'x', importProvider: 'socialkit' }),
  ]);
  const health = owner.pipelineHealth(OPERATOR);
  assert.equal(health.importProviders.socialkit, 1);
});

test('anything older than the window is left out', () => {
  seed([
    project({ id: 'old', status: 'failed', errorCode: 'x', updatedAt: Date.now() - 40 * 24 * HOUR }),
    project({ id: 'new', status: 'failed', errorCode: 'y', updatedAt: Date.now() - HOUR }),
  ]);
  assert.equal(owner.pipelineHealth(OPERATOR, { days: 7 }).totals.failed, 1);
  assert.equal(owner.pipelineHealth(OPERATOR, { days: 90 }).totals.failed, 2);
});

test('the recent list is newest first and carries what is needed to act', () => {
  seed([
    project({ id: 'older', status: 'failed', errorCode: 'x', updatedAt: Date.now() - 5 * HOUR }),
    project({ id: 'newer', status: 'failed', errorCode: 'y', updatedAt: Date.now() - HOUR }),
  ]);
  const [first] = owner.pipelineHealth(OPERATOR).recent;
  assert.equal(first.id, 'newer');
  assert.ok('code' in first && 'error' in first && 'at' in first);
});

test('an empty week reports zero rather than dividing by it', () => {
  seed([]);
  const health = owner.pipelineHealth(OPERATOR);
  assert.equal(health.totals.failureRate, 0);
  assert.deepEqual(health.topFailures, []);
});
