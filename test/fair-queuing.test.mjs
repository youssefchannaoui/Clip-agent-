import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Fair queuing across accounts.
 *
 * The queue was a global FIFO ordered by arrival. Saving a template queues a
 * re-render of every unposted clip its owner has, so one customer could put
 * forty jobs in front of another customer's brand-new import and there was
 * nothing the second customer could do but wait.
 *
 * These tests assert the resulting order, not the presence of any particular
 * sorting code, so a future rewrite of the scheduler still has to satisfy them.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-fair-queue-'));
process.env.DATA_DIR = dataDir;

const { state } = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

const AT = 1_700_000_000_000;

function rerender(id, userId, at, batchId = '') {
  return { id, userId, engine: 'self-hosted', status: 'queued', createdAt: at, clipId: `clip_${id}`, batchId };
}

function project(id, userId, at) {
  return { id, userId, engine: 'self-hosted', status: 'queued', submittedAt: at };
}

function reset() {
  state.projects = [];
  state.rerenderJobs = [];
  state.clips = [];
}

test('a batch from one account does not bury another account\'s single job', () => {
  reset();
  // What a template save produces: one job per unposted clip, all owned by A.
  for (let index = 0; index < 20; index++) {
    state.rerenderJobs.push(rerender(`a_${index}`, 'user_a', AT + index));
  }
  // B imports a lecture a moment later, behind all twenty.
  state.rerenderJobs.push(rerender('b_0', 'user_b', AT + 500));

  const order = engine.plannedQueueOrder().map(candidate => candidate.item.id);
  assert.equal(order.length, 21);
  assert.equal(order[0], 'a_0');
  assert.equal(order[1], 'b_0', `B waited behind ${order.indexOf('b_0')} of A's jobs`);
  // And A keeps its own arrival order behind that.
  assert.deepEqual(order.slice(2, 5), ['a_1', 'a_2', 'a_3']);
});

test('accounts are served in turn, not in arrival order', () => {
  reset();
  for (let index = 0; index < 3; index++) {
    state.rerenderJobs.push(rerender(`a_${index}`, 'user_a', AT + index));
    state.rerenderJobs.push(rerender(`b_${index}`, 'user_b', AT + 100 + index));
    state.rerenderJobs.push(rerender(`c_${index}`, 'user_c', AT + 200 + index));
  }
  const order = engine.plannedQueueOrder().map(candidate => candidate.item.id);
  assert.deepEqual(order.slice(0, 6), ['a_0', 'b_0', 'c_0', 'a_1', 'b_1', 'c_1']);
});

test('a fresh import is interleaved with someone else\'s re-render batch', () => {
  reset();
  for (let index = 0; index < 10; index++) {
    state.rerenderJobs.push(rerender(`a_${index}`, 'user_a', AT + index));
  }
  state.projects.push(project('project_b', 'user_b', AT + 900));

  const order = engine.plannedQueueOrder();
  assert.equal(order[1].item.id, 'project_b');
  assert.equal(order[1].type, 'project');
});

test('one account cannot hold every slot at once', () => {
  const candidates = [
    { type: 'rerender', item: { id: 'a_0' }, at: AT, owner: 'user_a' },
    { type: 'rerender', item: { id: 'a_1' }, at: AT + 1, owner: 'user_a' },
    { type: 'rerender', item: { id: 'b_0' }, at: AT + 900, owner: 'user_b' },
  ];
  // A is already running its one allowed job, so none of A's remaining work is
  // eligible and B goes next even though it arrived last.
  const running = new Map([['user_a', 1]]);
  const order = engine.fairQueueOrder(candidates, running, 1).map(candidate => candidate.item.id);
  assert.deepEqual(order, ['b_0']);

  // Raise the allowance and A's queued work becomes eligible again, still
  // behind B because A has already had a turn.
  const wider = engine.fairQueueOrder(candidates, running, 2).map(candidate => candidate.item.id);
  assert.deepEqual(wider, ['b_0', 'a_0', 'a_1']);
});

test('jobs already running push their owner down the rotation', () => {
  const candidates = [
    { type: 'rerender', item: { id: 'a_0' }, at: AT, owner: 'user_a' },
    { type: 'rerender', item: { id: 'b_0' }, at: AT + 900, owner: 'user_b' },
  ];
  const order = engine.fairQueueOrder(candidates, new Map([['user_a', 1]]), 4).map(candidate => candidate.item.id);
  assert.deepEqual(order, ['b_0', 'a_0']);
});

test('a template batch yields to its own owner\'s foreground work', () => {
  reset();
  // What saving a template produces: one batched job per unposted clip.
  for (let index = 0; index < 20; index++) {
    state.rerenderJobs.push(rerender(`batch_${index}`, 'user_a', AT + index, 'batch_1'));
  }
  // The same user then imports a lecture and re-renders one clip deliberately.
  state.projects.push(project('project_a', 'user_a', AT + 500));
  state.rerenderJobs.push(rerender('single', 'user_a', AT + 600));

  const order = engine.plannedQueueOrder().map(candidate => candidate.item.id);
  assert.deepEqual(order.slice(0, 2), ['project_a', 'single'],
    'the import and the one-off re-render should not wait behind a bulk batch');
  assert.equal(order[2], 'batch_0');
});

test('batched work still keeps its own arrival order', () => {
  reset();
  for (let index = 0; index < 4; index++) {
    state.rerenderJobs.push(rerender(`batch_${index}`, 'user_a', AT + (10 - index), 'batch_1'));
  }
  const order = engine.plannedQueueOrder().map(candidate => candidate.item.id);
  assert.deepEqual(order, ['batch_3', 'batch_2', 'batch_1', 'batch_0']);
});

test('one account\'s batch still does not delay another account', () => {
  reset();
  // The within-account rule must not weaken the across-account rule.
  for (let index = 0; index < 20; index++) {
    state.rerenderJobs.push(rerender(`a_${index}`, 'user_a', AT + index, 'batch_1'));
  }
  state.rerenderJobs.push(rerender('b_0', 'user_b', AT + 500));
  const order = engine.plannedQueueOrder().map(candidate => candidate.item.id);
  assert.equal(order[1], 'b_0');
});

test('an empty queue and unowned records do not throw', () => {
  reset();
  assert.deepEqual(engine.plannedQueueOrder(), []);
  assert.deepEqual(engine.fairQueueOrder([]), []);
  // Records predating the ownership migration share one group rather than
  // each becoming its own account and starving everyone else.
  const legacy = engine.fairQueueOrder([
    { type: 'rerender', item: { id: 'legacy_1' }, at: AT, owner: null },
    { type: 'rerender', item: { id: 'legacy_2' }, at: AT + 1, owner: undefined },
  ], new Map(), 1);
  assert.deepEqual(legacy.map(candidate => candidate.item.id), ['legacy_1', 'legacy_2']);
});
