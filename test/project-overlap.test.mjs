import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const activityFix = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

test('the V4 workspace permanently suppresses the retired project browser', () => {
  assert.match(activityFix, /body\.dc-app #libraryBrowser\{display:none!important\}/);
  assert.match(activityFix, /function hideLegacyProjectBrowser\(\)/);
  assert.match(activityFix, /if\(legacy\)legacy\.remove\(\)/);
  const injectShell = activityFix.slice(activityFix.indexOf('function injectShell(){'), activityFix.indexOf('function navButton'));
  assert.match(injectShell, /document\.body\.classList\.add\('dc-app'\);\s*hideLegacyProjectBrowser\(\)/);
});

test('project navigation wins before legacy target click handlers can run', () => {
  assert.match(activityFix, /addEventListener\('click', handleProjectOpenCapture, true\)/);
  assert.match(activityFix, /function handleProjectOpenCapture\(event\)/);
  assert.match(activityFix, /event\.stopImmediatePropagation\(\)/);
  assert.match(activityFix, /selectedProjectId=target\.dataset\.openProject/);
});

test('refresh and project rendering clean up stale legacy browser state', () => {
  const renderProjects = activityFix.slice(activityFix.indexOf('function renderProjects(){'), activityFix.indexOf('function renderProjectDetail'));
  const sync = activityFix.slice(activityFix.indexOf('function sync(){'), activityFix.indexOf('/* ==========================================================================\n * ADMIN CONSOLE'));
  assert.match(renderProjects, /hideLegacyProjectBrowser\(\)/);
  assert.match(sync, /hideLegacyProjectBrowser\(\)/);
});
