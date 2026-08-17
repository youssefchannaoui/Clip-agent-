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
  // Automation is off by default, so this has to ask for it: the test is about
  // what automation does once an account has chosen to turn it on.
  store.setAutomationSettings({ id: USER }, { enabled: true });
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
  // user_auto_2 never touched automation, so its defaults apply: off. A clip
  // scoring 99 must not be approved just because user_auto_1 has automation on
  // and a threshold this clip would clear.
  store.state.clips.push(
    { id: 'other-strong', projectId: 'p2', userId: 'user_auto_2', title: 'Other', status: 'waiting', score: 99, quality: { overall: 99 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
  );
  const other = () => store.state.clips.find(item => item.id === 'other-strong');
  await agent.tick();
  assert.equal(other().status, 'waiting', "another account's automation must not reach this clip");

  // Turned on for this account, but with a threshold the clip cannot clear.
  // Still waiting — which shows its own account's numbers are the ones applied,
  // not user_auto_1's more permissive 80.
  store.setAutomationSettings({ id: 'user_auto_2' }, { enabled: true, minimumScore: 100 });
  await agent.tick();
  assert.equal(other().status, 'waiting', 'evaluated under its own account\'s threshold');

  // Lower that account's own threshold and the same clip goes through, so the
  // gate is the setting rather than anything account-specific in the pipeline.
  store.setAutomationSettings({ id: 'user_auto_2' }, { minimumScore: 80 });
  await agent.tick();
  assert.equal(other().status, 'scheduled');
});
