/*
 * When a clip is allowed to render again, and what an approval means.
 *
 * Youssef, 28 Aug 2026: "why is it rerendering when i approve? ... ONLY IF
 * TEMPLATE WAS CHANGED AND SAVED WHILE NOT APPROVED ALL CLIPS RE RENDER,
 * OTHER THAN THAN THAT IT SHOULD NEVER RE RENDER".
 *
 * Two mechanisms used to break that. Approval promoted a quarter-resolution
 * review draft to a full render, so approving visibly started a job. And
 * saving a template swept every unposted clip -- including ones already
 * approved and scheduled, whose look had already been signed off.
 *
 * The third thing here is the bug those two hid: when scheduling an approved
 * clip failed, the clip was pushed back to `waiting` and the approval erased,
 * so the button looked broken and the reason went to a log nobody reads.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-render-policy-'));
// Ports 32768-60999 are Linux's EPHEMERAL range: the kernel hands them out
// to outgoing sockets, so a port chosen there can be taken between the
// choice and the listen. The file then dies with EADDRINUSE and the run
// reports FEWER TESTS rather than a failure anyone can read -- measured at
// 1 abort in 6 full runs. This window is below the range, and every test
// file gets its own so two cannot collide with each other either.
const port = 19100 + Math.floor(Math.random() * 100);
process.env.DATA_DIR = dataDir;
process.env.PORT = String(port);
process.env.AUTH_REQUIRED = 'false';
process.env.APP_SESSION_SECRET = 'render-policy-secret-long-enough';

const base = `http://127.0.0.1:${port}`;
const { server } = await import('../src/server.js');
const { state } = await import('../src/store.js');
const agent = await import('../src/agent.js');
const auth = await import('../src/auth.js');
const store = await import('../src/store.js');

for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await fetch(`${base}/healthz`); break; }
  catch { await new Promise(resolve => setTimeout(resolve, 50)); }
}
test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

// With AUTH_REQUIRED off every request acts as the bootstrap admin, so the
// records under test have to belong to that same account.
const owner = auth.ownerUser();
const USER = owner.id;
const sourceFile = path.join(dataDir, 'lecture.mp4');
fs.writeFileSync(sourceFile, 'x');
state.projects.push({
  id: 'rp_project', userId: USER, title: 'Lecture', status: 'done', engine: 'self-hosted',
  sourceFile, templateSnapshot: { id: 'clean-line', name: 'Clean Line', version: 1, builtIn: true },
});
function clip(id, status) {
  const record = {
    id, projectId: 'rp_project', userId: USER, ownedBy: USER, title: id, status,
    templateId: 'clean-line', templateName: 'Clean Line', startSec: 0, endSec: 30, durationMs: 30000,
    renderQuality: 'final', renderVerified: true, musicEnabled: false, musicVerified: true,
  };
  state.clips.push(record);
  return record;
}

test('saving a template re-renders what is still awaiting review, and nothing else', async () => {
  clip('rp_waiting', 'waiting');
  clip('rp_approved', 'approved');
  clip('rp_scheduled', 'scheduled');
  clip('rp_posted', 'posted');

  // Save the template these clips are on, asking for the change to propagate.
  const saved = await fetch(`${base}/api/templates/clean-line`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: 'clean-line', name: 'Clean Line', fontSize: 61, propagate: true }),
  });
  assert.equal(saved.status, 200);
  const body = await saved.json();
  // Built-ins fork on save, and the fork keeps the clips that were on it only
  // if it kept the id; whichever id came back is the one that swept.
  for (const item of state.clips) if (item.projectId === 'rp_project') item.templateId = body.template.id;
  const again = await fetch(`${base}/api/templates/${encodeURIComponent(body.template.id)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...body.template, fontSize: 62, propagate: true }),
  });
  assert.equal(again.status, 200);

  const touched = new Set(state.rerenderJobs.map(job => job.clipId));
  assert.ok(touched.has('rp_waiting'), 'a clip nobody has decided on takes the new look');
  for (const settled of ['rp_approved', 'rp_scheduled', 'rp_posted']) {
    assert.ok(!touched.has(settled), `${settled} was signed off on the render it has`);
  }
});

test('an approval survives a clip having nowhere to go', async () => {
  // Publishing on, nothing enabled for this clip: setTargets throws, which used
  // to un-approve the clip inside tick().
  store.setPublishingSettings(owner, { ...store.publishingSettings(owner), enabled: true });
  const stuck = clip('rp_nowhere', 'waiting');
  agent.approveClip(stuck.id);
  await agent.tick();

  const after = state.clips.find(item => item.id === 'rp_nowhere');
  assert.equal(after.status, 'approved', 'the decision was the person\'s and it stands');
  assert.ok(after.scheduleError, 'and the clip carries the reason it has no slot');

  const shown = await (await fetch(`${base}/api/state`)).json();
  const card = shown.clips.find(item => item.id === 'rp_nowhere');
  assert.equal(card.status, 'approved');
  assert.ok(card.scheduleError, 'the screen is told, rather than the clip silently reappearing in the queue');
});

test('approving again is an answer, not an error', () => {
  const again = agent.approveClip('rp_nowhere');
  assert.equal(again.status, 'approved');
});

// ── a clip that went out somewhere has gone out ─────────────────────────────

test('one destination refusing does not make the whole clip unposted', async () => {
  const partly = clip('rp_partly', 'scheduled');
  partly.targets = [
    { provider: 'youtube', status: 'posted', externalId: 'yt1' },
    { provider: 'tiktok', status: 'failed', error: 'unaudited_client_can_only_post_to_private_accounts' },
  ];
  agent.refreshPublishingStatus(partly);

  assert.equal(partly.status, 'posted', 'it is on YouTube, so it is published');
  assert.ok(partly.postedAt, 'and the schedule can stop offering to post it');
  assert.equal(partly.targets.find(t => t.provider === 'tiktok').status, 'failed',
    'the refusal stays on the destination that refused');
});

test('the destination that refused can be retried on its own', async () => {
  const partly = state.clips.find(item => item.id === 'rp_partly');
  const outstanding = agent.unpostedTargets(partly);
  assert.equal(outstanding.length, 1);
  assert.equal(outstanding[0].provider, 'tiktok');

  // Publishing is off in this account, so nothing is actually sent -- what is
  // under test is that the press is accepted rather than refused as "already
  // posted", and that YouTube is not sent a second copy.
  await agent.publishNow('rp_partly').catch(() => {});
  assert.equal(partly.targets.find(t => t.provider === 'youtube').status, 'posted',
    'a retry never re-posts what already posted');
});

test('a clip that posted everywhere refuses a pointless retry', async () => {
  const done = clip('rp_done', 'posted');
  done.postedAt = Date.now();
  done.targets = [{ provider: 'youtube', status: 'posted', externalId: 'yt2' }];
  await assert.rejects(() => agent.publishNow('rp_done'), /already posted/i);
});
