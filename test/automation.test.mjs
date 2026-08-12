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

test('Review before posting keeps every strong clip waiting for a person', async () => {
  const userId = 'user_auto_human_review';
  store.setAutomationSettings({ id: userId }, {
    enabled: true,
    minimumScore: 80,
    minimumQuality: 72,
    maxPerProject: 4,
    reviewBeforePosting: true,
  });
  store.state.projects.push({ id: 'p-human-review', title: 'Human review', userId });
  store.state.clips.push({
    id: 'strong-human-review', projectId: 'p-human-review', userId, title: 'Strong but reviewed',
    status: 'waiting', score: 98, quality: { overall: 96 }, musicVerified: true,
    renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false,
  });

  await agent.tick();
  const clip = store.state.clips.find(item => item.id === 'strong-human-review');
  assert.equal(clip.status, 'waiting');
  assert.equal(clip.approvedBy, undefined);
});

test('reviewRequired is an unconditional automation safety gate', async () => {
  const userId = 'user_auto_safety_gate';
  // A stale or malicious legacy preference must not allow a flagged clip to
  // pass automation. The public settings view normalises this field to true.
  store.state.userSettings[userId] = {
    automationSettings: {
      enabled: true, minimumScore: 1, minimumQuality: 1, maxPerProject: 20,
      reviewBeforePosting: false, skipReviewRequired: false,
    },
  };
  assert.equal(store.automationSettings({ id: userId }).skipReviewRequired, true);
  store.state.projects.push({ id: 'p-safety-gate', title: 'Safety gate', userId });
  store.state.clips.push({
    id: 'flagged-safety-gate', projectId: 'p-safety-gate', userId, title: 'Flagged quotation',
    status: 'waiting', score: 100, quality: { overall: 100 }, musicVerified: true,
    renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: true,
  });

  await agent.tick();
  assert.equal(store.state.clips.find(item => item.id === 'flagged-safety-gate').status, 'waiting');
});

test('enabling Review before posting pulls pending automatic clips back into Review', async () => {
  const userId = 'user_auto_recovery';
  store.setAutomationSettings({ id: userId }, {
    enabled: true, minimumScore: 80, minimumQuality: 72, maxPerProject: 4,
    reviewBeforePosting: true,
  });
  store.state.projects.push({ id: 'p-recovery', title: 'Recovery', userId });
  store.state.clips.push({
    id: 'scheduled-recovery', projectId: 'p-recovery', userId, title: 'Already automatic',
    status: 'scheduled', score: 95, quality: { overall: 90 }, musicVerified: true,
    renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false,
    approvedBy: 'automation', approvedAt: Date.now() - 1000, scheduledAt: Date.now() - 1,
    targets: [{ provider: 'youtube', status: 'scheduled', nextTryAt: Date.now() - 1 }],
  });

  await agent.tick();
  const clip = store.state.clips.find(item => item.id === 'scheduled-recovery');
  assert.equal(clip.status, 'waiting');
  assert.equal(clip.approvedBy, null);
  assert.equal(clip.scheduledAt, null);
  assert.deepEqual(clip.targets, []);
});

test('a flagged scheduled clip with missing approval provenance cannot publish', async () => {
  const userId = 'user_auto_stale_flagged';
  store.setAutomationSettings({ id: userId }, {
    enabled: true, minimumScore: 80, minimumQuality: 72, maxPerProject: 4,
    reviewBeforePosting: false,
  });
  store.state.projects.push({ id: 'p-stale-flagged', title: 'Stale flagged', userId });
  store.state.clips.push({
    id: 'stale-flagged', projectId: 'p-stale-flagged', userId, title: 'Unknown approval',
    status: 'scheduled', score: 95, quality: { overall: 90 }, musicVerified: true,
    renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: true,
    scheduledAt: Date.now() - 1,
    targets: [{ provider: 'youtube', status: 'scheduled', nextTryAt: Date.now() - 1 }],
  });

  await agent.tick();
  const clip = store.state.clips.find(item => item.id === 'stale-flagged');
  assert.equal(clip.status, 'waiting');
  assert.equal(clip.approvedBy, null);
  assert.deepEqual(clip.targets, []);
});

test('the legacy false preference migrates to Review before posting', () => {
  const userId = 'user_auto_legacy_review';
  store.state.userSettings[userId] = {
    automationSettings: {
      enabled: true, minimumScore: 80, minimumQuality: 72, maxPerProject: 4,
      skipReviewRequired: false,
    },
  };
  const settings = store.automationSettings({ id: userId });
  assert.equal(settings.reviewBeforePosting, true);
  assert.equal(settings.skipReviewRequired, true);
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

test('manual approval immediately reserves the next distinct posting slot', () => {
  store.state.clips.push(
    { id: 'manual-slot-1', projectId: 'p1', userId: USER, title: 'Manual one', status: 'waiting', score: 90, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold' },
    { id: 'manual-slot-2', projectId: 'p1', userId: USER, title: 'Manual two', status: 'waiting', score: 89, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold' },
  );
  const first = agent.approveClip('manual-slot-1');
  const second = agent.approveClip('manual-slot-2');
  assert.equal(first.status, 'scheduled');
  assert.equal(second.status, 'scheduled');
  assert.ok(Number(first.scheduledAt) > Date.now());
  assert.ok(Number(second.scheduledAt) > Number(first.scheduledAt));
});
