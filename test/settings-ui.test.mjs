import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('settings are organised as a three-part studio control centre', () => {
  assert.match(ui, /Your studio, tuned your way/);
  assert.match(ui, /data-settings-jump="dcSettingsGeneration"/);
  assert.match(ui, /data-settings-jump="dcSettingsAutomation"/);
  assert.match(ui, /data-settings-jump="dcSettingsAlerts"/);
  assert.match(ui, /01 · Creation defaults/);
  assert.match(ui, /02 · Approval flow/);
  assert.match(ui, /03 · Stay informed/);
});

test('settings redesign retains every persisted control and save action', () => {
  for (const id of [
    'dcSetClipCount', 'dcSetMinSec', 'dcSetMaxSec', 'dcSaveClipSettings',
    'dcAutoEnabled', 'dcAutoScore', 'dcAutoQuality', 'dcAutoMax',
    'dcReviewRequired', 'dcSaveAutomation', 'dcAlertComplete',
    'dcAlertPublishing', 'dcAlertFailures', 'dcAlertStarted',
    'dcAlertSounds', 'dcAlertRespectMedia', 'dcAlertVolume'
  ]) assert.match(ui, new RegExp(id), `${id} remains available`);
});

test('settings explain scope and safety before users save', () => {
  assert.match(ui, /Existing projects keep their current settings/);
  assert.match(ui, /Private by design/);
  assert.match(ui, /TikTok always requires explicit creator approval/);
  assert.match(ui, /Token estimates still appear before processing starts/);
});
