import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A button must not wait for the network to look pressed.
 *
 * Youssef, 3 Sept 2026, on the Start-job panel: "THIS PART is very slow and
 * cluckly when i click one of the buttons theres a delay."
 *
 * Measured rather than guessed. Clicking a clip-length or clip-count chip:
 * the handler returned in 0.7ms, then POST /api/clip-settings took 7ms and a
 * full GET /api/state took 37 — and only then did the chip repaint. Locally.
 * On production both legs cross the internet.
 *
 * Two separate faults, and each is asserted here because each is silent: the
 * hook did not paint before its write, and the refresh scheduler made even a
 * lone click wait for a frame it might not get for 80ms.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');

test('a clip-settings choice is drawn before it is saved', () => {
  const at = host.indexOf('StudioAdapter.onClipSettings=');
  assert.ok(at > -1, 'the hook exists');
  const body = host.slice(at, at + 400);
  const painted = body.indexOf('paintStudio()');
  const sent = body.indexOf('studioDo(');
  assert.ok(painted > -1, 'the choice is painted');
  assert.ok(sent > -1, 'and still written');
  assert.ok(painted < sent, 'painted BEFORE the write, or the chip waits on the network again');
  assert.ok(/DATA\.clipSettings=\{\.\.\.\(DATA\.clipSettings\|\|\{\}\),\.\.\.patch\}/.test(body),
    'the local copy carries the change, or the repaint draws the old value');
});

test('a refusal is not swallowed by the optimism', () => {
  // The whole risk of an optimistic write is leaving a lie on the screen. It
  // goes through studioDo, whose catch puts the error in front of the customer
  // and re-renders from the truth — the same road the review deck's ledger
  // takes.
  //
  // This used to match the catch clause's exact source text, and broke on
  // v3.103.0 when studioDo learned to raise a spinner for slow work: the error
  // now resolves that spinner where one is up, and toasts where one is not.
  // Behaviour unchanged, wording different — the source-string weakness this
  // repo keeps paying for. Asserted on what the catch DOES instead.
  const at = host.indexOf('const studioDo=async');
  const body = host.slice(at, host.indexOf('function paintJobBackground'));
  const catchAt = body.indexOf('catch(e){');
  assert.ok(catchAt > -1, 'studioDo catches its own failures');
  const rescue = body.slice(catchAt);
  assert.ok(/note\.fail\(/.test(rescue) || /toast\(e\.message,'bad'\)/.test(rescue),
    'the error reaches the screen');
  assert.ok(/note\.fail\([^)]*e\.message/.test(rescue) || /toast\(e\.message/.test(rescue),
    'and it is the real message, not a generic one');
  assert.ok(rescue.includes('renderAll()'), 'and the screen is rebuilt from what is actually true');
});

test('an isolated click paints without waiting for a frame', () => {
  // The coalescing is not wrong — dragging a caption fires hundreds of events
  // a second and a full render per event throws all but the last away
  // (v3.53.4). But a single click is not a burst, and rAF plus an 80ms
  // fallback made it pay a drag's price.
  const at = host.indexOf('StudioAdapter.setRefresh(');
  assert.ok(at > -1);
  const body = host.slice(at, at + 2600);
  assert.ok(/if\(!paintQueued&&now-lastPaintAt>70\)\{[^}]*paintStudio\(\);return\}/.test(body),
    'a discrete act paints synchronously');
  assert.ok(body.includes('requestAnimationFrame(run)'), 'a burst still coalesces to a frame');
  assert.ok(body.includes('setTimeout(run,80)'),
    'and the timer backstop stays — rAF is suspended in an occluded window');
});
