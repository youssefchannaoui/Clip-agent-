import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-sched-'));
process.env.DATA_DIR = dataDir;
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');
const { config } = await import('../src/config.js');

const USER = 'user_sched_1';
const DAY_MS = 86_400_000;

/** The calendar day an instant falls on, in the account's own zone. */
function zonedDay(ms) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ms));
}

function approved(id) {
  store.state.clips.push({
    id, projectId: 'p1', userId: USER, title: id, status: 'approved',
    musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold',
  });
  return id;
}

test('setup', () => {
  store.state.projects.push({ id: 'p1', title: 'Lecture', userId: USER });
});

test('a clip scheduled with no day asked for lands in the next open slot', () => {
  approved('c-default');
  agent.scheduleSelected(['c-default']);
  const clip = store.state.clips.find(item => item.id === 'c-default');
  assert.equal(clip.status, 'scheduled');
  assert.ok(clip.scheduledAt > Date.now(), 'a slot in the future');
});

// The whole point of a per-day button. Before this, every day's button called
// the same allocator with no day, so pressing the one under Friday put the clip
// wherever the next free slot happened to be -- usually today.
test('a clip scheduled into a named day lands on that day', () => {
  approved('c-target');
  const wanted = Date.now() + 5 * DAY_MS;
  agent.scheduleSelected(['c-target'], { day: wanted });
  const clip = store.state.clips.find(item => item.id === 'c-target');
  assert.equal(clip.status, 'scheduled');
  assert.equal(zonedDay(clip.scheduledAt), zonedDay(wanted),
    'the slot is on the day that was asked for');
});

test('a day already full rolls forward rather than overbooking it', () => {
  const wanted = Date.now() + 9 * DAY_MS;
  const ids = [];
  // config.postTimes is how many posts a day can hold; fill every one of them.
  for (let i = 0; i < config.postTimes.length; i += 1) ids.push(approved('c-full-' + i));
  for (const id of ids) agent.scheduleSelected([id], { day: wanted });
  for (const id of ids) {
    const clip = store.state.clips.find(item => item.id === id);
    assert.equal(zonedDay(clip.scheduledAt), zonedDay(wanted));
  }
  approved('c-overflow');
  agent.scheduleSelected(['c-overflow'], { day: wanted });
  const spill = store.state.clips.find(item => item.id === 'c-overflow');
  assert.notEqual(zonedDay(spill.scheduledAt), zonedDay(wanted),
    'the fifth clip moves to another day instead of doubling up');
  assert.ok(spill.scheduledAt > wanted, 'and it moves forward, never back');
});

test('a day in the past is never scheduled into', () => {
  approved('c-past');
  agent.scheduleSelected(['c-past'], { day: Date.now() - 10 * DAY_MS });
  const clip = store.state.clips.find(item => item.id === 'c-past');
  assert.ok(clip.scheduledAt > Date.now(), 'the slot is still in the future');
});

test('two clips asked for the same day never share a slot', () => {
  const wanted = Date.now() + 3 * DAY_MS;
  approved('c-a'); approved('c-b');
  agent.scheduleSelected(['c-a'], { day: wanted });
  agent.scheduleSelected(['c-b'], { day: wanted });
  const a = store.state.clips.find(item => item.id === 'c-a');
  const b = store.state.clips.find(item => item.id === 'c-b');
  assert.notEqual(a.scheduledAt, b.scheduledAt);
});

// `at` is the other half: one exact posting slot, pressed in the week grid.
test('a clip scheduled into an exact free slot lands on that slot', () => {
  // A real posting time, reached by taking one the allocator already chose and
  // moving a whole number of days -- far enough out that the earlier cases in
  // this file have not spoken for it. (They have: at five days it collided with
  // the clip that spilled out of the full day, and rolling forward was right.)
  const slot = store.state.clips.find(item => item.id === 'c-target').scheduledAt + 20 * DAY_MS;
  assert.ok(!store.state.clips.some(item => item.scheduledAt === slot), 'the slot starts free');
  approved('c-slot');
  agent.scheduleSelected(['c-slot'], { at: slot });
  const clip = store.state.clips.find(item => item.id === 'c-slot');
  assert.equal(clip.scheduledAt, slot, 'the slot asked for, to the minute');
});

test('an exact slot already taken rolls forward instead of doubling up', () => {
  const taken = store.state.clips.find(item => item.id === 'c-slot').scheduledAt;
  approved('c-slot-clash');
  agent.scheduleSelected(['c-slot-clash'], { at: taken });
  const clip = store.state.clips.find(item => item.id === 'c-slot-clash');
  assert.notEqual(clip.scheduledAt, taken);
  assert.ok(clip.scheduledAt > taken, 'forward, never back');
});
