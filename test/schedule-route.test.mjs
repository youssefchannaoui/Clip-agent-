import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// The gap this file exists to close: schedule-day.test.mjs calls
// agent.scheduleSelected directly, so it passed with a full green suite while
// the HTTP route silently dropped `day` on the floor. Every per-day button in
// the calendar was landing its clip in the next open slot regardless of which
// day was pressed -- the exact bug the parameter was added to fix. A parameter
// is only wired when something crosses the route.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-sched-route-'));
const port = 39000 + Math.floor(Math.random() * 900);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const auth = await import('../src/auth.js');

// Clips are owned; an unowned one is "not found" to every route.
const owner = auth.ownerUser();

test.after(() => new Promise(resolve => server.close(resolve)));

for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}

const DAY_MS = 86_400_000;
const zonedDay = ms => new Intl.DateTimeFormat('en-CA', {
  timeZone: config.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ms));

function approvedClip(id) {
  state.projects.push({ id: 'p-' + id, title: 'Lecture', userId: owner.id });
  state.clips.push({
    id, projectId: 'p-' + id, title: id, status: 'approved', userId: owner.id,
    musicVerified: true, renderVerified: true, templateId: 'clean-line',
  });
  return id;
}

const post = (body) => fetch(`${base}/api/clips/schedule-selected`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('the route honours a calendar day', async () => {
  approvedClip('route-day');
  const wanted = Date.now() + 6 * DAY_MS;
  const response = await post({ ids: ['route-day'], day: wanted });
  assert.equal(response.status, 200);
  const clip = state.clips.find(item => item.id === 'route-day');
  assert.equal(zonedDay(clip.scheduledAt), zonedDay(wanted),
    'the clip landed on the day the button named');
});

test('the route honours an exact slot', async () => {
  const slot = state.clips.find(item => item.id === 'route-day').scheduledAt + 14 * DAY_MS;
  assert.ok(!state.clips.some(item => item.scheduledAt === slot), 'the slot starts free');
  approvedClip('route-slot');
  const response = await post({ ids: ['route-slot'], at: slot });
  assert.equal(response.status, 200);
  const clip = state.clips.find(item => item.id === 'route-slot');
  assert.equal(clip.scheduledAt, slot, 'to the minute');
});

test('the route still works with neither, taking the next open slot', async () => {
  approvedClip('route-plain');
  const response = await post({ ids: ['route-plain'] });
  assert.equal(response.status, 200);
  const clip = state.clips.find(item => item.id === 'route-plain');
  assert.ok(clip.scheduledAt > Date.now());
});

test('a junk day is ignored rather than failing the request', async () => {
  approvedClip('route-junk');
  const response = await post({ ids: ['route-junk'], day: 'not-a-day' });
  assert.equal(response.status, 200);
  const clip = state.clips.find(item => item.id === 'route-junk');
  assert.ok(clip.scheduledAt > Date.now(), 'still scheduled, just not where it asked');
});
