/**
 * Dragging a scheduled clip onto another slot.
 *
 * Youssef, 3 Sept 2026: "so you can hold the box then move it and it swaps or
 * it moves to new location."
 *
 * The swap is ONE server call on purpose. Done as two — free the target, then
 * move — a drag can strand a clip: move A onto B's slot first and B is
 * homeless; free B first and A's old slot is open for the scheduler to hand to
 * somebody else. Both writes happen together, after every check, with nothing
 * in between.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-move-'));
process.env.DATA_DIR = dataDir;
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');

const USER = 'user_move_1';
const HOUR = 3_600_000;
const soon = () => Date.now() + 24 * HOUR;

function scheduled(id, at, extra = {}) {
  store.state.clips.push({
    id, projectId: 'p1', userId: USER, title: id, status: 'scheduled',
    musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold',
    scheduledAt: at, targets: [], ...extra,
  });
  return store.state.clips.find(c => c.id === id);
}
const at = id => store.state.clips.find(c => c.id === id).scheduledAt;

test('setup', () => {
  store.state.projects.push({ id: 'p1', title: 'Lecture', userId: USER });
});

test('a clip moves to an empty slot', () => {
  const a = soon(), b = soon() + HOUR;
  scheduled('m-a', a);
  const out = agent.moveClipToSlot('m-a', b);
  assert.equal(out.moved, true);
  assert.equal(out.swapped, false);
  assert.equal(at('m-a'), b);
});

test('two clips swap, and neither is left without a slot', () => {
  const a = soon() + 2 * HOUR, b = soon() + 3 * HOUR;
  scheduled('m-x', a);
  scheduled('m-y', b);
  const out = agent.moveClipToSlot('m-x', b);
  assert.equal(out.swapped, true);
  assert.equal(out.swappedWith, 'm-y');
  assert.equal(at('m-x'), b, 'the dragged clip took the slot it was dropped on');
  assert.equal(at('m-y'), a, 'and the one that was there took its place');
  // The property that matters: after any swap both clips still hold a slot,
  // and they are different slots.
  assert.notEqual(at('m-x'), at('m-y'));
});

test('dropping a clip on its own slot changes nothing', () => {
  const a = soon() + 4 * HOUR;
  scheduled('m-same', a);
  const out = agent.moveClipToSlot('m-same', a);
  assert.equal(out.moved, false);
  assert.equal(at('m-same'), a);
});

test('a slot that has already passed refuses the drop', () => {
  scheduled('m-past', soon() + 5 * HOUR);
  assert.throws(() => agent.moveClipToSlot('m-past', Date.now() - HOUR), /already passed/);
});

test('a clip that has gone out cannot be dragged, nor displaced', () => {
  const gone = soon() + 6 * HOUR, live = soon() + 7 * HOUR;
  scheduled('m-posted', gone, { status: 'posted' });
  scheduled('m-live', live);
  assert.throws(() => agent.moveClipToSlot('m-posted', live), /already gone out/);
  // And it cannot be evicted by something dropped on top of it either.
  assert.throws(() => agent.moveClipToSlot('m-live', gone), /already gone out/);
  assert.equal(at('m-posted'), gone, 'the posted clip did not move');
  assert.equal(at('m-live'), live, 'and neither did the other');
});

test('a clip mid-publish is not dragged out from under the publisher', () => {
  const a = soon() + 8 * HOUR, b = soon() + 9 * HOUR;
  scheduled('m-publishing', a, { targets: [{ provider: 'youtube', status: 'publishing' }] });
  scheduled('m-other', b);
  assert.throws(() => agent.moveClipToSlot('m-publishing', b), /already gone out/);
  assert.equal(at('m-other'), b);
});

test('a clip with no slot is not on the calendar to move', () => {
  store.state.clips.push({ id: 'm-none', projectId: 'p1', userId: USER, status: 'approved', targets: [] });
  assert.throws(() => agent.moveClipToSlot('m-none', soon() + 10 * HOUR), /not on the schedule/);
});

test('a drag can never reach another account\'s clip', () => {
  const mine = soon() + 11 * HOUR, theirs = soon() + 12 * HOUR;
  scheduled('m-mine', mine);
  store.state.clips.push({
    id: 'm-theirs', projectId: 'p2', userId: 'someone_else', status: 'scheduled',
    scheduledAt: theirs, targets: [],
  });
  // Dropping onto a slot another account happens to hold moves ours there and
  // leaves theirs entirely alone — it is not a swap across owners.
  const out = agent.moveClipToSlot('m-mine', theirs);
  assert.equal(out.swapped, false, 'no cross-account swap');
  assert.equal(at('m-mine'), theirs);
  assert.equal(at('m-theirs'), theirs, 'their clip is untouched');
});

test('rubbish input is refused rather than scheduling something at zero', () => {
  scheduled('m-junk', soon() + 13 * HOUR);
  for (const bad of [0, -1, NaN, null, undefined, 'soon']) {
    assert.throws(() => agent.moveClipToSlot('m-junk', bad), /not a posting slot/);
  }
  assert.throws(() => agent.moveClipToSlot('nope', soon() + 14 * HOUR), /no longer exists/);
});

/**
 * The Day view drags too, and a card that can be picked up says so.
 *
 * Youssef, 3 Sept 2026: "the drag icon needs to be added, weekly only works
 * daily should also work or use any logo or icon that makes sense."
 *
 * Both halves are silent when they break — the Day list simply stops
 * responding to a drag, and the grip simply stops being drawn — so each is
 * asserted separately. The last assertion is the one that matters most: Home's
 * "Posting today" list renders the SAME article, and tagging that one would
 * have made the home screen draggable into a schedule it does not show.
 */
test('the Day view carries the same drag hooks as the Week grid', () => {
  const design = fs.readFileSync(new URL('../design/studio-dashboard.dc.html', import.meta.url), 'utf8');
  const cards = design.split('\n').filter(l => l.includes('data-dc-sched-card'));
  assert.equal(cards.length, 2, 'two lists render this card: the Day view and Home');

  const draggable = cards.filter(l => l.includes('data-slot='));
  assert.equal(draggable.length, 1, 'only the schedule Day card may be draggable');
  const day = draggable[0];
  for (const attr of ['data-slot="{{ post.at }}"', 'data-slot-clip="{{ post.clipId }}"', 'data-slot-title="{{ post.caption }}"']) {
    assert.ok(day.includes(attr), `the Day card must carry ${attr}`);
  }
});

test('a draggable cell is given a grip, and only while it can move', () => {
  const host = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  assert.ok(/\.dc-grip\s*\{/.test(host), 'the grip needs a style, or it draws nothing');
  assert.ok(host.includes("g.className='dc-grip'"), 'the grip is injected by the host');
  // A posted clip cannot be rescheduled, and neither can one whose slot has
  // passed: showing them a handle promises something the server refuses.
  assert.ok(host.includes("Number(cell.dataset.slot)>=Date.now()"), 'the grip is gated on the slot still being ahead');
  assert.ok(host.includes("dayCard.parentElement"), 'the Day list is wired as well as the week grid');
});
