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

test('Review shows real quality and transcript confidence without object coercion', () => {
  const review = activityFix.slice(activityFix.indexOf('function reviewRow(c)'), activityFix.indexOf('function clipReviewText'));
  assert.match(review, /typeof c\?\.quality==='object'/);
  assert.match(review, /c\.quality\?\.overall/);
  assert.match(review, /clipTranscriptConfidence/);
  assert.match(review, /Human check required/);
  assert.doesNotMatch(review, /Math\.round\(c\.quality\|\|c\.score/);
});

test('bulk Review actions exclude clips requiring a human check', () => {
  const renderReview = activityFix.slice(activityFix.indexOf('function renderReview()'), activityFix.indexOf('function reviewRow(c)'));
  const approveVerified = activityFix.slice(activityFix.indexOf('async function approveVerified()'), activityFix.indexOf('async function approveClip'));
  assert.match(renderReview, /safeWaiting=waiting\.filter\(c=>!c\.reviewRequired\)/);
  assert.match(renderReview, /scheduleMany\(safeWaiting\.map/);
  assert.match(approveVerified, /&&\s*!c\.reviewRequired/);
});

test('post suggestions prefer transcript-grounded growth metadata', () => {
  const copy = activityFix.slice(activityFix.indexOf('function socialCopyForClip'), activityFix.indexOf('async function regenerateClipCopy'));
  assert.match(copy, /growthPack/);
  assert.match(copy, /platformMetadata/);
  assert.match(copy, /platforms\.youtube\?\.title/);
  assert.doesNotMatch(copy, /#Quran/);
  assert.doesNotMatch(copy, /Islamic reminder/);
});

test('approving from a project focuses that clip in Review', () => {
  assert.match(activityFix, /reviewFocusClipId=reviewClip\.dataset\.reviewClip/);
  assert.match(activityFix, /reviewFilter='all'; go\('review'\)/);
  assert.match(activityFix, /data-review-row=/);
  assert.match(activityFix, /scrollIntoView\(\{block:'center',behavior:'smooth'\}\)/);
});
