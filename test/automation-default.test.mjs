import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// What a brand-new account gets before it has touched a single setting.
//
// This shipped with automation ON, so every clip was auto-approved and
// scheduled the moment it rendered and nothing ever reached the review queue.
// Once the clip AI was switched on, scores cleared the 80 threshold every time
// and a live account had 14 clips queued to publish to a real YouTube channel
// that nobody had seen. Nothing here is cosmetic: each assertion is a thing that
// would post on a customer's behalf without being asked.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-auto-default-'));
process.env.DATA_DIR = dataDir;
const store = await import('../src/store.js');

test('a new account does not publish anything without being asked', () => {
  const { automationSettings, publishingSettings } = store.settingDefaults();
  assert.equal(automationSettings.enabled, false, 'clips wait for a person');
  assert.equal(publishingSettings.enabled, false, 'and nothing is sent anywhere');
});

test('every publishing destination is off until it is switched on', () => {
  // The master switch alone is not enough: publishingSettings.enabled going true
  // with a provider already enabled would start posting to it immediately.
  const { publishingSettings } = store.settingDefaults();
  for (const provider of ['youtube', 'instagram', 'facebook', 'tiktok']) {
    assert.equal(publishingSettings[provider].enabled, false, provider);
    assert.equal(publishingSettings[provider].accountId, '', `${provider} is not pre-linked`);
  }
});

test('turning automation off did not quietly relax the thresholds behind it', () => {
  // Whoever turns automation on inherits these, so they have to survive the
  // default flipping. A weakened threshold here is the same bug again, just
  // one click further away.
  const { automationSettings } = store.settingDefaults();
  assert.equal(automationSettings.minimumScore, 80);
  assert.equal(automationSettings.minimumQuality, 72);
  assert.equal(automationSettings.maxPerProject, 4);
  assert.equal(automationSettings.skipReviewRequired, true);
});

test('an untouched account reads back the defaults rather than something looser', () => {
  // settingDefaults() is the shape; this is what the code actually gets when it
  // asks for an account that has never saved anything.
  const user = { id: 'user_never_configured' };
  assert.equal(store.automationSettings(user).enabled, false);
  assert.equal(store.publishingSettings(user).enabled, false);
  assert.equal(store.publishingSettings(user).youtube.enabled, false);
});

test('the default is commented, so it is not "tidied" back on', () => {
  const source = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const block = /automationSettings: \{[\s\S]*?enabled: false,/.exec(source);
  assert.ok(block, 'automation defaults to off');
  assert.match(block[0], /review/i, 'and says why');
});
