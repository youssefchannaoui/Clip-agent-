import assert from 'node:assert/strict';
import test from 'node:test';

/**
 * What made the schedule confusing once there were three channels.
 *
 * Youssef, 3 Sept 2026, after multi-channel scheduling shipped: "for the
 * scheduling and everything, it's very confusing. Like, everything's posting
 * together, and I don't know. It's just confusing."
 *
 * Two faults, and the first is the one his sentence describes exactly.
 *
 *  1. THE CARD DID NOT SAY WHICH CHANNEL. v3.107.0 made the destination a bare
 *     platform logo -- right while a platform meant one channel, and actively
 *     wrong once it means three. Two clips at 07:00 drew two identical YouTube
 *     logos. They were going to different channels and nothing on screen said
 *     so, which reads as "everything's posting together".
 *  2. THREE NUMBERS ON ONE SCREEN DISAGREED. The day view said "3 of 4
 *     scheduled" (a literal 4 that v3.71.3 missed), the header said "Up to 8
 *     posts a day", and the sidebar said "0 of 8 scheduled today".
 *
 * Rendered through the real adapter rather than grepped, because what matters
 * is what the screen says.
 */

await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

const DAY = 86400000;
const tomorrow = () => {
  const d = new Date(Date.now() + DAY);
  d.setHours(7, 0, 0, 0);
  return d.getTime();
};

function target(accountId, accountName) {
  return { id: `youtube:${accountId}`, provider: 'youtube', accountId, accountName, status: 'scheduled' };
}

function stateWith({ channels, clips }) {
  const ids = channels.map(c => c.id);
  return {
    user: { email: 'a@b.c' },
    projects: [],
    tracks: [],
    clips,
    postTimes: ['07:00', '08:15', '09:30', '12:00', '14:30', '17:00', '18:45', '20:30'],
    timezone: 'Australia/Perth',
    social: { providers: {
      youtube: { connected: true, configured: true, accounts: channels },
      tiktok: { connected: false, accounts: [] },
      instagram: { connected: false, accounts: [] },
      facebook: { connected: false, accounts: [] },
    } },
    publishingSettings: {
      enabled: true,
      youtube: { enabled: true, accountId: ids[0], accountIds: ids },
      tiktok: { enabled: false }, instagram: { enabled: false }, facebook: { enabled: false },
    },
    billing: { current: { plan: 'studio', unlimited: true } },
  };
}

const THREE = [
  { id: 'y1', name: 'Main channel' },
  { id: 'y2', name: 'Shorts channel' },
  { id: 'y3', name: 'Arabic channel' },
];

function paint(state, ui = {}) {
  Object.assign(StudioAdapter.ui, { screen: 'schedule', schedView: 'day', schedChannel: '' }, ui);
  return StudioAdapter.bindings(state);
}

test('with three channels, a card says WHICH channel', () => {
  const at = tomorrow();
  const state = stateWith({ channels: THREE, clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
    { id: 'c2', title: 'Two', status: 'scheduled', scheduledAt: at, targets: [target('y2', 'Shorts channel')] },
  ] });
  const vals = paint(state, { schedAnchor: at });
  const items = Array.from(vals.schedDayItems || []);
  assert.equal(items.length, 2, 'both clips are on the day');
  const named = items.map(p => Array.from(p.dests).map(d => d.who));
  assert.deepEqual(named, [['Main channel'], ['Shorts channel']],
    'two clips at one time, and the screen says they go to different channels');
});

test('with ONE channel the logo still stands alone', () => {
  // Youssef, 3 Sept 2026, on the schedule row: "dont be writing just put logos
  // that are posting." That stays true where the logo is unambiguous -- the
  // name appears only where it is doing work.
  const at = tomorrow();
  const state = stateWith({ channels: [{ id: 'y1', name: 'Main channel' }], clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
  ] });
  const vals = paint(state, { schedAnchor: at });
  const dests = Array.from(Array.from(vals.schedDayItems)[0].dests);
  assert.equal(dests[0].who, '', 'no name beside a logo that already says it');
  assert.ok(dests[0].icon, 'the logo is still there');
  // The whole sentence stays on hover either way.
  assert.match(dests[0].title, /YouTube/);
});

test('a problem still gets its word, name or no name', () => {
  // Colour alone must never carry a failure: this app shipped the bug where a
  // clip live on YouTube with a refused TikTok "looked entirely fine".
  const at = tomorrow();
  const state = stateWith({ channels: THREE, clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at,
      targets: [{ ...target('y1', 'Main channel'), status: 'failed' }] },
  ] });
  const vals = paint(state, { schedAnchor: at });
  const dest = Array.from(Array.from(vals.schedDayItems)[0].dests)[0];
  assert.equal(dest.who, 'Main channel');
  assert.ok(dest.state.trim().length, 'and it still says what went wrong');
});

test('the three numbers on the screen agree', () => {
  const at = tomorrow();
  const state = stateWith({ channels: THREE, clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
  ] });
  const vals = paint(state, { schedAnchor: at });
  // The literal 4 is gone. With several channels there is no single total to
  // be "of" -- the day holds the account's windows on EACH of them -- so it
  // states the count rather than inventing a denominator.
  assert.ok(!/ of 4 /.test(vals.schedDayCount), 'no hardcoded 4: ' + vals.schedDayCount);
  assert.match(vals.schedDayCount, /1 post/);
  assert.match(vals.dailyLimitNote, /up to 8 on each of your 3 channels/);
});

test('inside one channel the day has a real denominator again', () => {
  const at = tomorrow();
  const state = stateWith({ channels: THREE, clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
  ] });
  const vals = paint(state, { schedAnchor: at, schedChannel: 'youtube:y1' });
  assert.equal(vals.schedDayCount, '1 of 8 scheduled');
});

test('one channel keeps the plain wording it always had', () => {
  const at = tomorrow();
  const state = stateWith({ channels: [{ id: 'y1', name: 'Main channel' }], clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
  ] });
  const vals = paint(state, { schedAnchor: at });
  assert.equal(vals.schedHasLanes, false, 'no switcher for one channel');
  assert.equal(vals.schedDayCount, '1 of 8 scheduled');
  // dailyLimitNote counts TODAY, not the day being looked at, and this
  // fixture's clip is tomorrow -- so the number is 0. What matters is that a
  // single-channel account keeps the "N of 8" shape rather than the
  // per-channel wording.
  assert.match(vals.dailyLimitNote, /^\d+ of 8 scheduled today\./);
  assert.ok(!/each of your/.test(vals.dailyLimitNote));
});

test('the chips count what the view is showing, not all time', () => {
  // Counting all time put a number on the chip that had nothing to do with the
  // day underneath it -- two 3s on one screen meaning different things.
  const at = tomorrow();
  const state = stateWith({ channels: THREE, clips: [
    { id: 'c1', title: 'One', status: 'scheduled', scheduledAt: at, targets: [target('y1', 'Main channel')] },
    { id: 'c2', title: 'Far', status: 'scheduled', scheduledAt: at + 14 * DAY, targets: [target('y1', 'Main channel')] },
  ] });
  const day = paint(state, { schedAnchor: at, schedView: 'day' });
  const main = Array.from(day.schedLanes).find(l => l.key === 'youtube:y1');
  assert.equal(main.count, 1, 'the day shows one');
  assert.equal(day.schedLaneTotal, 1);

  const month = paint(state, { schedAnchor: at, schedView: 'month' });
  const mainMonth = Array.from(month.schedLanes).find(l => l.key === 'youtube:y1');
  assert.equal(mainMonth.count, 2, 'the month reaches the clip a fortnight out');
  assert.equal(month.schedLaneTotal, 2);
});
