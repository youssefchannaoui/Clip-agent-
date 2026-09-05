import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

/**
 * The box can be ASKED why a run produced nothing (5 Sept 2026).
 *
 * A failed import says one sentence -- "No complete clip candidates fit the
 * selected duration range" -- and everything behind it lives only on the
 * Hetzner box: the job's payload and status, and the transcript the run
 * cached a moment before it gave up. The service removes the job's working
 * directory on failure and never echoes the child's progress events, so
 * `docker logs` cannot answer either. deploy-worker.yml's `diagnose` input
 * runs .github/scripts/worker-diagnose.py INSIDE the container, replaying
 * the candidate pipeline over that transcript at the job's own settings.
 *
 * What CI can pin is the drift it can see: the script parses, keeps the
 * seam the workflow substitutes, prints counts and never content, and the
 * workflow asks the question WITHOUT deploying.
 */
const script = fs.readFileSync(new URL('../.github/scripts/worker-diagnose.py', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');

test('the diagnostics script parses', () => {
  execFileSync('python3', ['-m', 'py_compile', '.github/scripts/worker-diagnose.py'], { stdio: 'pipe' });
});

test('it keeps the PARAMS seam the workflow substitutes', () => {
  assert.ok(script.includes('\nPARAMS = {}\n'), 'the literal the runner replaces');
  assert.match(workflow, /src\.replace\("PARAMS = \{\}", "PARAMS = " \+ JSON\.stringify\(params\)\)/);
});

test('a diagnose dispatch never deploys, and a push never diagnoses', () => {
  const rebuild = workflow.indexOf('- name: Pull and rebuild on the box');
  const rebuildBlock = workflow.slice(rebuild, workflow.indexOf('- name:', rebuild + 10));
  assert.match(rebuildBlock, /if: inputs\.diagnose != true/, 'the rebuild stands down for a question');
  const ask = workflow.indexOf('- name: Ask the box what happened to its recent jobs');
  assert.ok(ask > 0, 'the step exists');
  const askBlock = workflow.slice(ask, workflow.indexOf('- name:', ask + 10));
  assert.match(askBlock, /if: inputs\.diagnose == true/, 'and only runs when asked');
  // The push trigger carries no inputs, so `inputs.diagnose` is empty there
  // and the rebuild's guard reads true -- pinned by asserting the trigger
  // itself has no way to say diagnose.
  const push = workflow.slice(workflow.indexOf('\n  push:'), workflow.indexOf('\npermissions:'));
  assert.ok(!/diagnose/.test(push), 'a push cannot ask for diagnostics');
});

test('it prints counts and timings, never a word of a transcript', () => {
  // Every use of a segment's text is a measurement of it. A print of the
  // text itself would put a customer's lecture into a public run log.
  const prints = script.split('\n').filter(line => /\bout\(/.test(line));
  for (const line of prints) {
    assert.ok(!/\.get\(['"]text['"]\)\s*\)/.test(line.replace(/len\([^)]*\)/g, '')),
      `a print carries transcript text: ${line.trim()}`);
  }
  assert.match(script, /def redact/, 'errors are redacted before they are printed');
  assert.ok(!/print\(json\.dumps\(segments/.test(script), 'the segment list is never dumped');
});

test('the script runs end to end against a synthetic failed job and reports the replay', () => {
  const dir = fs.mkdtempSync('/tmp/deenclipped-diagnose-');
  fs.mkdirSync(`${dir}/jobs/job_a`, { recursive: true });
  fs.mkdirSync(`${dir}/cache/transcripts`, { recursive: true });
  fs.writeFileSync(`${dir}/jobs/job_a/status.json`, JSON.stringify({ status: 'failed', stage: 'failed', progress: 69, error: 'No complete clip candidates fit the selected duration range. via http://user:secret@1.2.3.4' }));
  fs.writeFileSync(`${dir}/jobs/job_a/payload.json`, JSON.stringify({ title: 'A recitation', settings: { clipMinSeconds: 20, clipMaxSeconds: 90, clipsPerVideo: 8 }, template: { id: 'quran-recitation', captionMode: 'quran' } }));
  const segments = [];
  for (let i = 0; i < 12; i++) segments.push({ start: i * 16, end: i * 16 + 12, text: 'كلمات مسموعة هنا', words: [] });
  fs.writeFileSync(`${dir}/cache/transcripts/k_small_transcribe_auto_0.00_200.00.json`, JSON.stringify(segments));
  const printed = execFileSync('python3', ['.github/scripts/worker-diagnose.py'], {
    env: { ...process.env, WORKER_DATA_DIR: dir, DC_WORKER_CODE: new URL('../worker', import.meta.url).pathname },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(printed, /job job_a/, 'names the job');
  assert.match(printed, /status='failed'/);
  assert.match(printed, /segments=12 span=0\.0\.\.188\.0s/, 'measures the transcript');
  assert.match(printed, /replay\[newest job's settings\] range 20-90s .* candidates=\d+ banded=\d+ selected=\d+/, 'replays the pipeline');
  assert.match(printed, /:\/\/\*\*\*@/, 'and redacts the userinfo in the error');
  assert.ok(!printed.includes('كلمات'), 'without printing the transcript');
});
