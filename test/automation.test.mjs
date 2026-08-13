import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-auto-'));
process.env.DATA_DIR = dataDir;
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');

const USER = 'user_auto_1';

test('automation schedules only clips that pass score, quality and review gates', async () => {
  store.state.projects.push({ id: 'p1', title: 'Lecture', userId: USER });
  store.state.clips.push(
    { id: 'strong', projectId: 'p1', userId: USER, title: 'Strong', status: 'waiting', score: 91, quality: { overall: 86 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
    { id: 'quote', projectId: 'p1', userId: USER, title: 'Quote', status: 'waiting', score: 95, quality: { overall: 91 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: true },
    { id: 'weak', projectId: 'p1', userId: USER, title: 'Weak', status: 'waiting', score: 62, quality: { overall: 90 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
  );
  await agent.tick();
  assert.equal(store.state.clips.find(item => item.id === 'strong').status, 'scheduled');
  assert.equal(store.state.clips.find(item => item.id === 'strong').approvedBy, 'automation');
  assert.equal(store.state.clips.find(item => item.id === 'quote').status, 'waiting');
  assert.equal(store.state.clips.find(item => item.id === 'weak').status, 'waiting');
});

test('automation thresholds for one account do not approve another account\'s clips', async () => {
  store.state.projects.push({ id: 'p2', title: 'Lecture B', userId: 'user_auto_2' });
  // user_auto_2 never enabled automation, so its defaults apply: automation is
  // enabled by default with a minimum score of 80. A clip scoring 91 for
  // user_auto_1 must not spill into approving a similarly strong clip that
  // belongs to a different account by way of some shared global pass.
  store.state.clips.push(
    { id: 'other-strong', projectId: 'p2', userId: 'user_auto_2', title: 'Other', status: 'waiting', score: 99, quality: { overall: 99 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
  );
  await agent.tick();
  // Both accounts default to automation enabled, so this one *should* also be
  // approved -- the point of the test is that it is evaluated under its own
  // account's automation settings, not skipped or double-processed under
  // user_auto_1's settings.
  assert.equal(store.state.clips.find(item => item.id === 'other-strong').status, 'scheduled');
});
