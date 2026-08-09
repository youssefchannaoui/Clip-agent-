import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('notification preferences are opt-in and account scoped', () => {
  assert.match(ui, /desktop:false, sounds:false/);
  assert.match(ui, /dc_notification_settings_\$\{notificationUserKey\(\)\}/);
  assert.match(ui, /Notification\.requestPermission\(\)/);
  assert.match(ui, /Chrome: click the lock icon/);
  assert.match(ui, /Safari: Safari Settings/);
});

test('workflow alerts cover processing, publishing and failures', () => {
  assert.match(ui, /function detectWorkflowSignals\(d\)/);
  assert.match(ui, /Your clips are ready/);
  assert.match(ui, /Your clip is live/);
  assert.match(ui, /DeenClipped needs your attention/);
  assert.match(ui, /detectWorkflowSignals\(data\(\)\)/);
});

test('sound controls respect playback and use browser generated tones', () => {
  assert.match(ui, /respectMedia:true/);
  assert.match(ui, /\$\$\('video,audio'\)\.some/);
  assert.match(ui, /createOscillator\(\)/);
  assert.match(ui, /id="dcTestSound"/);
});
