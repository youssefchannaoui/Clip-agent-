import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const activity = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const page = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');

test('V4 polling does not rebuild the retired dashboard', () => {
  assert.match(page, /if\(!document\.body\.classList\.contains\('dc-app'\)\)renderAll\(\)/);
});

test('numeric progress is excluded from structural screen renders', () => {
  const signature = activity.slice(activity.indexOf('function structuralDataSignature'), activity.indexOf('function patchLiveProgress'));
  assert.doesNotMatch(signature, /p\.progress|moreJob\?\.progress|r\.progress|progressPercent/);
  assert.match(signature, /p\.status/);
  assert.match(signature, /t\.status/);
});

test('live percentages and stages are patched in place', () => {
  assert.match(activity, /function patchLiveProgress\(\)/);
  assert.match(activity, /data-live-job="current"/);
  assert.match(activity, /data-live-project=/);
  assert.match(activity, /data-live-more-job=/);
  assert.match(activity, /position \$\{Math\.round\(item\.queuePosition\)\}/);
  assert.match(activity, /patchLiveProgress\(\);\n  paintWork\(\)/);
});
