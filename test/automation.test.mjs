import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-auto-'));
process.env.DATA_DIR = dataDir;
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');

test('automation schedules only clips that pass score, quality and review gates', async () => {
  store.state.projects.push({ id: 'p1', title: 'Lecture' });
  store.state.clips.push(
    { id: 'strong', projectId: 'p1', title: 'Strong', status: 'waiting', score: 91, quality: { overall: 86 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
    { id: 'quote', projectId: 'p1', title: 'Quote', status: 'waiting', score: 95, quality: { overall: 91 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: true },
    { id: 'weak', projectId: 'p1', title: 'Weak', status: 'waiting', score: 62, quality: { overall: 90 }, musicVerified: true, renderVerified: true, templateId: 'deenclipped-gold', reviewRequired: false },
  );
  await agent.tick();
  assert.equal(store.state.clips.find(item => item.id === 'strong').status, 'scheduled');
  assert.equal(store.state.clips.find(item => item.id === 'strong').approvedBy, 'automation');
  assert.equal(store.state.clips.find(item => item.id === 'quote').status, 'waiting');
  assert.equal(store.state.clips.find(item => item.id === 'weak').status, 'waiting');
});
