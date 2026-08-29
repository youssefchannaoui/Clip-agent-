import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// The review deck decides clips, so its machinery is tested by RUNNING it:
// bindings computed from real clip rows, and deckAct -- the path every
// keyboard press takes -- called and observed. The design test already pins
// that every template binding has a supplier; these pin what the suppliers do.

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');

const sandbox = {
  window: {},
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.StudioAdapter;

const clip = (id, score, extra = {}) => ({
  id, title: 'Clip ' + id, status: 'waiting', score,
  durationMs: 57_000, templateName: 'Bold Stack', projectId: 'p1',
  thumbUrl: '/thumb/' + id + '.jpg', videoUrl: '/api/clips/' + id + '/video',
  scoreReasons: ['complete ending', 'question hook'],
  ...extra,
});

const DATA = {
  clips: [clip('c1', 92), clip('c2', 88), clip('c3', 71, { videoUrl: null }), clip('c4', 64)],
  projects: [{ id: 'p1', title: 'A lecture on patience', status: 'completed' }],
  reviewGate: true,
};

A.ui.screen = 'queue';
A.ui.deckMode = true;
A.ui.filter = 'review';

test('the deck walks the waiting stack highest score first, with its working shown', () => {
  const v = A.bindings(DATA);
  assert.equal(v.deckHas, true);
  assert.equal(v.deckClip.id, 'c1', 'highest score is up first');
  assert.match(v.deckPos, /^1 of 4$/);
  assert.match(v.deckWhy, /complete ending/, 'the score explains itself on the deck');
  assert.match(v.deckProgStyle, /width: 25%/, 'position 1 of 4');
  assert.equal(v.deckTally, '', 'no decisions yet, no tally');
});

test('a rendered clip hides the drawn caption; an unrendered one keeps it', () => {
  const v = A.bindings(DATA);
  assert.equal(v.deckShowMeta, false,
    'the render carries its own captions; drawing more text over it is the second-engine mistake');
  A.ui.deckIdx = 2; // c3 has no videoUrl
  const v2 = A.bindings(DATA);
  assert.equal(v2.deckShowMeta, true, 'no render, so the card may describe the clip');
  assert.match(v2.deckSoundStyle, /display: none/, 'no video, no sound button');
  A.ui.deckIdx = 0;
});

test('the filmstrip windows around the position and jumps on click', () => {
  const v = A.bindings(DATA);
  assert.equal(v.deckStrip.length, 4);
  assert.match(v.deckStrip[0].style, /#D9B478/, 'current thumb wears the gold ring');
  v.deckStrip[3].jump(null);
  assert.equal(A.ui.deckIdx, 3, 'clicking a thumb jumps the deck');
  A.ui.deckIdx = 0;
});

test('deckAct approve takes the same road as the button: ledger, repaint, API', () => {
  const calls = [];
  A.onApprove = id => calls.push(['approve', id]);
  A.onReject = id => calls.push(['reject', id]);
  A.bindings(DATA); // establishes the current deck clip
  assert.equal(A.deckAct('approve'), true);
  assert.deepEqual(calls, [['approve', 'c1']]);
  assert.equal(A.ui.pending.c1, 'approved', 'the optimistic ledger moves first');

  const v = A.bindings(DATA);
  assert.equal(v.deckClip.id, 'c2', 'the deck advances to the next waiting clip');
  assert.match(v.deckTally, /1 approved/, 'the session tally counts it');
});

test('deckAct reject, skip, back, sound and rate all act', () => {
  A.bindings(DATA);
  assert.equal(A.deckAct('reject'), true);
  assert.equal(A.ui.pending.c2, 'rejected');
  A.bindings(DATA);
  assert.equal(A.deckAct('skip'), true);
  assert.equal(A.ui.deckIdx, 1);
  assert.equal(A.deckAct('back'), true);
  assert.equal(A.ui.deckIdx, 0);
  const wasMuted = A.ui.deckMuted;
  assert.equal(A.deckAct('sound'), true);
  assert.equal(A.ui.deckMuted, !wasMuted);
  A.deckAct('rate'); A.deckAct('rate');
  assert.equal(A.ui.deckRate, 2, '1 -> 1.5 -> 2');
  assert.equal(A.deckAct('nonsense'), false, 'unknown verbs fall through to the browser');
});

test('an empty queue on the decide tab is an achievement, not a blank', () => {
  A.deckAct('approve'); A.bindings(DATA);
  A.deckAct('approve'); A.bindings(DATA); // c3, c4 decided too
  const v = A.bindings(DATA);
  assert.equal(v.deckHas, false);
  assert.equal(v.deckClear, true);
  assert.match(v.deckClearMsg, /3 approved this session/);
  assert.equal(typeof v.deckGoSchedule, 'function');
});

test('deckAct approve refuses when there is nothing to decide', () => {
  A.bindings(DATA); // queue is empty now
  assert.equal(A.deckAct('approve'), false, 'no clip under the deck, no decision fired');
});
