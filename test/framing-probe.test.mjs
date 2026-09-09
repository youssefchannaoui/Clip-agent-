/**
 * The framing probe asks the box a question and changes nothing.
 *
 * Youssef, 9 Sept 2026: "see if its 2 people in one frame the framing is not
 * doing well, but once theres 2 people on oppisite sides it does well so who
 * ever talks its must be central."
 *
 * The suspected cause is in `detect_main_face_crop`: it takes the LARGEST face
 * per sampled frame and then the MEDIAN of those centres, so two faces of
 * similar size make the largest alternate and the median lands in the valley
 * BETWEEN two heads. That is a hypothesis, and it can only be measured where
 * OpenCV, the Haar cascades and real lectures are in one place -- the box.
 * These pin the properties that make asking safe.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, '.github/scripts/framing-probe.py');
const WORKFLOW = path.join(ROOT, '.github/workflows/deploy-worker.yml');
const script = fs.readFileSync(SCRIPT, 'utf8');
const workflow = fs.readFileSync(WORKFLOW, 'utf8');

test('the framing probe parses', () => {
  execFileSync('python3', ['-c', `import ast,sys; ast.parse(open(${JSON.stringify(SCRIPT)}).read())`]);
});

test('it keeps the PARAMS seam the workflow substitutes', () => {
  // The workflow writes the dispatch inputs in by replacing this exact literal
  // and throws if it is missing, so losing it fails the run rather than
  // silently probing with defaults.
  assert.match(script, /^PARAMS = \{\}$/m);
  assert.match(workflow, /the framing probe lost its PARAMS seam/);
});

test('asking never deploys, and a push never asks', () => {
  // A question must not restart a worker mid-job. The two build steps carry the
  // guard; the probe step carries the opposite condition.
  const guards = workflow.match(/if: inputs\.diagnose != true[^\n]*/g) || [];
  assert.ok(guards.length >= 2, 'the deploy steps are guarded');
  for (const guard of guards) assert.match(guard, /inputs\.framing != true/, 'framing skips the deploy too');
  assert.match(workflow, /if: inputs\.framing == true/);
  // The push trigger watches worker/** only, so a dispatch input cannot fire on one.
  const push = workflow.slice(0, workflow.indexOf('workflow_dispatch'));
  assert.ok(!/framing/.test(push), 'a push cannot ask for a framing measurement');
});

test('NO DISPATCH INPUT IS INTERPOLATED INTO A SHELL COMMAND', () => {
  // The rule every probe here follows: an input becomes a JSON literal inside
  // the script and the script travels as one base64 blob, which has no shell
  // metacharacter in it.
  const step = workflow.slice(workflow.indexOf('if: inputs.framing == true'));
  const body = step.slice(0, step.indexOf('- name: Clean up the credential'));
  assert.ok(!/\$\{\{\s*inputs\.framing_/.test(body.split('env:')[1]?.split('run:')[0] ?? '') === false,
    'inputs reach the step through env, which is the safe route');
  assert.ok(!/base64 -d[^\n]*\$\{\{/.test(body), 'nothing templated into the remote command');
  assert.match(body, /FRAMING_B64=\$BLOB/, 'the script travels as a blob');
});

test('it reports GEOMETRY, never a frame', () => {
  // A run log is public. Face positions as percentages and box heights in
  // pixels say everything the question needs; an image would be somebody's
  // lecture, and a face, in a public log.
  assert.ok(!/imwrite|imencode|b64encode|tobytes|\.save\(/.test(script),
    'the probe never encodes or writes an image');
  assert.match(script, /% of (the )?width/i, 'positions are reported as fractions of the frame');
});

test('it renders nothing and writes nothing to the box', () => {
  assert.ok(!/render_clip|write_ass|subprocess\.run\(\[["']ffmpeg/.test(script),
    'no render is started');
  assert.ok(!/\.write_text|\.write_bytes|open\([^)]*["']w/.test(script),
    'nothing on the box is written');
});

test('a box with no working OpenCV is an ANSWER, not a failed run', () => {
  // It would mean every auto-framed clip on this box is a centre crop, which is
  // a bigger finding than any number the probe could print -- so it is reported
  // and the run stays green rather than dying on an import.
  assert.match(script, /OpenCV is unusable here/);
  const guard = script.slice(script.indexOf('if problem:'));
  assert.match(guard.slice(0, 600), /return 0/, 'it exits clean');
});

test('it measures the SHIPPED detector, not one of its own', () => {
  // A probe that tunes its own thresholds answers a question nobody asked.
  const worker = fs.readFileSync(path.join(ROOT, 'worker/clip_worker.py'), 'utf8');
  for (const name of ['haarcascade_frontalface_alt2.xml', 'haarcascade_frontalface_default.xml', 'haarcascade_profileface.xml']) {
    assert.ok(script.includes(name) && worker.includes(name), `${name} is the shipped cascade`);
  }
  assert.match(script, /min_face = max\(28, min\(src_w, src_h\) \/\/ 24\)/,
    'and the shipped minimum face size');
  assert.ok(worker.includes('min_face = max(28, min(src_w, src_h) // 24)'),
    'which still matches clip_worker');
});

test('THE RENDER FOLLOWS THE SPEAKER, and the probe measures both paths', () => {
  // This guard was written the other way round -- "the render calls
  // detect_main_face_crop, so if it ever starts calling the tracker this
  // comparison has to be re-read" -- and it fired within the hour, which is
  // exactly what it was for. The render calls the tracker now; the static
  // detector remains only as the fallback for a box with no OpenCV, a source
  // that will not open, or a clip with no face in it.
  const worker = fs.readFileSync(path.join(ROOT, 'worker/clip_worker.py'), 'utf8');
  const render = worker.slice(worker.indexOf('    crop_plan = None\n    if bg_visual is None'));
  const body = render.slice(0, render.indexOf('bg_prelude'));
  assert.match(body, /track_speaker_keyframes\(/, 'the render asks who is speaking');
  assert.match(body, /detect_main_face_crop\(/, 'and still has a fallback');
  assert.ok(body.indexOf('track_speaker_keyframes(') < body.indexOf('detect_main_face_crop('),
    'the tracker is tried FIRST, the static crop is what it falls back to');
  // The probe reports both, so a run says what the render did and what the
  // other method would have done with the same frames.
  assert.match(script, /detect_main_face_crop/);
  assert.match(script, /track_speaker_keyframes/);
});
