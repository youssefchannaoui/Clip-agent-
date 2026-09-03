import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Removing a clip from the schedule, without un-reviewing it.
 *
 * Youssef, 3 Sept 2026, pointing at the Day view's button: "make this button a
 * remove and it removes also add that to the weekly so you can remove the
 * clips you want to."
 *
 * The button used to call `pullBack`, which un-approves the clip and sends it
 * back to the review queue -- so clearing a day's schedule meant re-reviewing
 * everything you cleared. The approval is a decision a person made; taking a
 * clip off Tuesday is not a retraction of it.
 *
 * The load-bearing half is `scheduleHold`. tick() schedules every approved
 * clip that has no slot, so without it the next sweep -- ten minutes at most
 * -- would hand the clip a new time and Remove would read as a button that
 * does nothing at all.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-unsched-'));
process.env.DATA_DIR = dataDir;
const { state } = await import('../src/store.js');
const agent = await import('../src/agent.js');

const userId = 'user_unsched';

function seed(extra = {}) {
  const clip = {
    id: 'c1',
    userId,
    title: 'A clip',
    status: 'scheduled',
    scheduledAt: Date.now() + 3_600_000,
    approvedAt: Date.now() - 1000,
    approvedBy: 'manual',
    targets: [{ provider: 'youtube', accountId: 'yt1', status: 'scheduled' }],
    ...extra,
  };
  state.clips = [clip];
  state.projects = [];
  return clip;
}

test('the clip comes off the schedule and keeps its approval', () => {
  const clip = seed();
  const out = agent.unschedule('c1');
  assert.equal(out.scheduledAt, null, 'no slot');
  assert.equal(out.status, 'approved', 'still approved');
  assert.equal(out.approvedBy, 'manual', 'the decision stands');
  assert.ok(out.approvedAt, 'and when it was made');
  assert.deepEqual(out.targets, [], 'nothing is aimed anywhere');
});

test('it lands in the same pool the schedule picker reads', () => {
  // "Ready to schedule" is approved + no scheduledAt + not posted. A removed
  // clip has to appear there or it has simply vanished from the product.
  seed();
  const out = agent.unschedule('c1');
  const readyToSchedule = out.status === 'approved' && !out.scheduledAt && !out.postedAt;
  assert.equal(readyToSchedule, true);
});

test('it STAYS off — the hold is what makes Remove mean anything', () => {
  seed();
  agent.unschedule('c1');
  assert.equal(state.clips[0].scheduleHold, true);
  // Proven by driving the real sweep rather than by reading the flag: without
  // the guard in tick() this clip gets a fresh slot and the button reads as
  // broken within ten minutes.
  return agent.tick().then(() => {
    assert.equal(state.clips[0].scheduledAt, null, 'the sweep left it alone');
    assert.equal(state.clips[0].status, 'approved');
  });
});

test('scheduling it again spends the hold', () => {
  // Putting a removed clip back is a fresh instruction, and afterwards it must
  // behave like any other scheduled clip -- including being rescheduled
  // automatically if it loses its slot some other way.
  seed();
  agent.unschedule('c1');
  agent.scheduleApprovedClip(state.clips[0], { at: Date.now() + 7_200_000 });
  assert.equal(state.clips[0].scheduleHold, false, 'the hold is spent');
});

test('a clip that has already posted cannot be removed', () => {
  seed({ status: 'posted', postedAt: Date.now() });
  assert.throws(() => agent.unschedule('c1'), /already posted/i);
});

test('a clip mid-transfer cannot be removed', () => {
  // The upload is in flight; taking its targets away underneath it is how a
  // clip ends up half-published with nothing recording where it went.
  seed({ targets: [{ provider: 'youtube', accountId: 'yt1', status: 'publishing' }] });
  assert.throws(() => agent.unschedule('c1'), /being sent/i);
});

test('one destination already posted also refuses', () => {
  seed({ targets: [
    { provider: 'youtube', accountId: 'yt1', status: 'posted' },
    { provider: 'tiktok', accountId: 'tk1', status: 'scheduled' },
  ] });
  assert.throws(() => agent.unschedule('c1'), /already posted/i);
});

test('remove is NOT send-back — the two are different actions', () => {
  // pullBack still exists and still un-approves. If Remove ever quietly
  // becomes an alias for it, curating a schedule starts costing a re-review
  // per clip, which is the whole reason this function was written.
  seed();
  agent.unschedule('c1');
  assert.equal(state.clips[0].status, 'approved');

  seed();
  agent.pullBack('c1');
  assert.equal(state.clips[0].status, 'waiting', 'send-back still un-approves');
  assert.equal(state.clips[0].approvedBy, null);
});

test('both surfaces offer Remove, and the week cell cannot nest a button', () => {
  // A week cell IS a <button> in the design export, so its remove control must
  // be a role="button" span -- a nested button is invalid markup and swallows
  // the outer click. That is why the week's control is host-rendered beside
  // the drag grip rather than added to the export.
  const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
  const design = fs.readFileSync(path.join(root, 'design/studio-dashboard.dc.html'), 'utf8');

  // The Day card's button, from the export.
  assert.ok(design.includes('onClick="{{ post.removeFromSchedule }}"'), 'the day card removes');
  assert.ok(!design.includes('Send back to review'),
    'and no longer un-approves from the schedule');

  // The week cell's, host-rendered.
  assert.ok(/x\.setAttribute\('role','button'\)/.test(host), 'a span, never a nested button');
  assert.ok(/class='dc-unsched'|className='dc-unsched'/.test(host), 'it has its own class');
  assert.ok(/x\.addEventListener\('pointerdown',ev=>ev\.stopPropagation\(\)\)/.test(host),
    'pressing it must not start a drag');
  // The Day card already carries the export's own Remove; two on one card is
  // worse than none.
  assert.ok(/const isDay=cell\.hasAttribute\('data-dc-sched-card'\)/.test(host),
    'the day card is skipped');
  // The drag ghost carries neither control -- a handle or an x on something
  // already in the air means nothing.
  assert.ok(/'\.dc-grip,\.dc-unsched,\.dc-slot-more'/.test(host),
    'the ghost is stripped of every control drawn into the cell');
  // It writes through the one host handler, which names the route.
  assert.ok(/onUnschedule=id=>studioDo\(\(\)=>api\(`\/api\/clips\/\$\{encodeURIComponent\(id\)\}\/unschedule`/.test(host),
    'and it calls the unschedule route');
});

test('the phone says the same thing as the desktop', () => {
  const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
  const mobile = fs.readFileSync(path.join(root, 'src/public/studio-mobile.js'), 'utf8');
  assert.ok(mobile.includes("click: 'it.p.removeFromSchedule'"), 'the phone removes too');
  assert.ok(!/'Send back to review'/.test(mobile),
    'two surfaces must not tell one person two stories about one button');
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
