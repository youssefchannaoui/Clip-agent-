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
  // THE SAFETY IS UNCHANGED; ONE OF ITS THREE LOCKS IS GONE.
  //
  // `publishingSettings.enabled` -- the account's master automatic-publishing
  // switch -- used to be asserted false here. It is retired in v3.116.0: it
  // defaulted to off with no control anywhere in the studio, so it stopped
  // every account from ever posting and nobody could turn it on
  // (test/publishing-always-on.test.mjs). It was the third lock on a door
  // that already had two, and it was the one with no key.
  //
  // The two that actually carry this test's promise are below, and both still
  // hold: nothing is auto-approved, and no destination is connected or on.
  const { automationSettings, publishingSettings } = store.settingDefaults();
  assert.equal(automationSettings.enabled, false, 'clips wait for a person');
  assert.equal(publishingSettings.enabled, true, 'publishing itself needs no switch found');
  for (const provider of ['youtube', 'instagram', 'facebook', 'tiktok']) {
    assert.equal(publishingSettings[provider].enabled, false,
      `${provider} is off, so there is nowhere for a clip to be sent`);
  }
});

test('every publishing destination is off until it is switched on', () => {
  // This is now the WHOLE of "nothing is sent anywhere" on a new account, so
  // it matters more than it did: a provider pre-enabled here would be a
  // destination nobody chose.
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
  assert.equal(store.publishingSettings(user).enabled, true, 'retired, and reads as on');
  assert.equal(store.publishingSettings(user).youtube.enabled, false,
    'while the destination that decides where anything goes is still off');
});

test('the default is commented, so it is not "tidied" back on', () => {
  const source = fs.readFileSync(new URL('../src/store.js', import.meta.url), 'utf8');
  const block = /automationSettings: \{[\s\S]*?enabled: false,/.exec(source);
  assert.ok(block, 'automation defaults to off');
  assert.match(block[0], /review/i, 'and says why');
});
