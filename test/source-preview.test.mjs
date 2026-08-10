import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const serverSource = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const editorSource = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const routeStart = serverSource.indexOf("const sourcePreview = pathname.match(/^\\/api\\/clips");
const routeEnd = serverSource.indexOf('const clipVideo = pathname.match', routeStart);
const sourcePreviewRoute = serverSource.slice(routeStart, routeEnd);

test('clean source previews sign private worker objects before using legacy source URLs', () => {
  assert.ok(routeStart >= 0 && routeEnd > routeStart, 'source preview route should exist');
  assert.match(sourcePreviewRoute, /project\?\.sourceObjectKey/);
  assert.match(sourcePreviewRoute, /objectStorage\.configured\(\)/);
  assert.match(sourcePreviewRoute, /objectStorage\.presign\(\{ method: 'GET', key: sourceObjectKey, expiresSec: 900 \}\)/);
  assert.ok(
    sourcePreviewRoute.indexOf('sourceObjectKey') < sourcePreviewRoute.indexOf('project?.sourceUrl'),
    'private object keys must be handled before legacy raw storage URLs',
  );
});

test('source preview object keys are restricted to clean project source videos', () => {
  assert.ok(sourcePreviewRoute.includes("/^projects\\/[A-Za-z0-9._/-]+\\/source\\.mp4$/"));
  assert.match(sourcePreviewRoute, /sourceObjectKey\.split\('\/'\)\.includes\('\.\.'\)/);
});

test('editor fallback message does not falsely claim the stored file is missing', () => {
  assert.doesNotMatch(editorSource, /The original lecture file is unavailable/);
  assert.match(editorSource, /The clean source preview could not be loaded/);
  assert.match(editorSource, /rendered clip is still safe/);
});
