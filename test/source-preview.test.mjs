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
});

test('a missing clean source falls back to the rendered export instead of a dead video element', () => {
  // 11 Aug: video.onerror used to just toast and give up, leaving both
  // <video> elements pointed at a dead URL forever — the canvas stayed
  // blank on every visit to that clip's editor. It must now recover by
  // pointing at the clip's own rendered export.
  const afterOnloadedMetadata = editorSource.slice(editorSource.indexOf('video.onloadedmetadata=initialise;'));
  const handler = afterOnloadedMetadata.slice(afterOnloadedMetadata.indexOf('video.onerror=()=>{'));
  const body = handler.slice(0, handler.indexOf('\n  };'));
  assert.match(body, /\/api\/clips\/\$\{encodeURIComponent\(clip\.id\)\}\/video/);
  assert.match(body, /video\.src=fallbackUrl/);
  assert.match(body, /video\.load\(\)/);
  assert.match(body, /bg\.src=fallbackUrl/);
  // The user has to be told why the preview changed. Asserting the behaviour
  // rather than the exact sentence: the previous wording pinned here promised
  // that caption edits "apply correctly" while the editor showed a caption box
  // that could not work against a baked frame, so the copy had to change.
  assert.match(body, /notify\(/, 'the fallback must tell the user what happened');
  assert.match(body, /rendered export/, 'the message must say what is being shown instead');
  // The state is marked so the live caption box can be labelled against the
  // baked ones behind it. It must stay draggable: this path is the common
  // case, not the exception, so disabling it would remove caption positioning
  // from nearly every clip.
  assert.match(body, /dc-editor-baked-preview/, 'the baked-preview state must be marked');
});
