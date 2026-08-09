import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const activityFix = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const indexHtml = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');

test('legacy project navigation cannot reopen the retired overlay in V4', () => {
  const openProject = indexHtml.slice(indexHtml.indexOf('function openProjectClips'), indexHtml.indexOf('function closeProjectClips'));
  assert.match(openProject, /document\.body\.classList\.contains\('dc-app'\)/);
  assert.match(openProject, /new CustomEvent\('deen:open-project'/);
  assert.match(indexHtml, /\$\('#libraryList'\)\?\.querySelectorAll\('\[data-open-project\]'\)/);
  assert.doesNotMatch(indexHtml, /;\$\$\('\[data-open-project\]'\)\.forEach/);
});

test('project clip cards route approval into Review instead of posting directly', () => {
  const clipCard = activityFix.slice(activityFix.indexOf('function clipCard(c,opts={})'), activityFix.indexOf('function renderReview()'));
  assert.match(clipCard, /data-review-clip/);
  assert.match(clipCard, />Approve<\/button>/);
  assert.doesNotMatch(clipCard, /data-post-clip/);
  assert.doesNotMatch(clipCard, /data-schedule-clip/);
});

test('Review owns the final post-now and scheduling actions', () => {
  const reviewRow = activityFix.slice(activityFix.indexOf('function reviewRow(c)'), activityFix.indexOf('function clipReviewText'));
  assert.match(reviewRow, /data-post-clip/);
  assert.match(reviewRow, />Post now<\/button>/);
  assert.match(reviewRow, /data-schedule-clip/);
  assert.match(reviewRow, />Schedule<\/button>/);
  assert.doesNotMatch(reviewRow, /data-approve-clip/);
});

test('approving from a project focuses that clip in Review', () => {
  assert.match(activityFix, /reviewFocusClipId=reviewClip\.dataset\.reviewClip/);
  assert.match(activityFix, /reviewFilter='all'; go\('review'\)/);
  assert.match(activityFix, /data-review-row=/);
  assert.match(activityFix, /scrollIntoView\(\{block:'center',behavior:'smooth'\}\)/);
});
