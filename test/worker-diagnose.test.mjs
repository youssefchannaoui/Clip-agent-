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
  const prove = workflow.indexOf('- name: Prove the running container holds this commit');
  const proveBlock = workflow.slice(prove, workflow.indexOf('- name:', prove + 10));
  assert.match(proveBlock, /if: inputs\.diagnose != true/,
    'and so does the version proof -- a box that deployed nothing cannot be expected to hold this commit');
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

/**
 * THE CHECK USED TO WARN ON THE CORRECT BEHAVIOUR.
 *
 * It was written when clip_worker read settings["model"] and never looked at
 * the environment, so "asked small, box says medium" meant the run used small
 * and the box's configuration was a lie. v3.162.0 made the environment win --
 * and the same line then meant the box won, exactly as designed, on every job
 * of every run. Measured on the real box, 8 Sept 2026: "4 of the 4 newest jobs
 * disagree with this box about what to run", where all four were correct.
 *
 * An alarm that is always on says nothing on the day it is right. So these two
 * pin the two directions apart, and the second one is driven against a COPY of
 * worker/ with the resolver reverted -- the monitor is only worth having if it
 * can be shown catching the fault it was built for.
 */
const diagnose = (dir, code, env = {}) => execFileSync('python3', ['.github/scripts/worker-diagnose.py'], {
  env: { ...process.env, WORKER_DATA_DIR: dir, DC_WORKER_CODE: code, ...env },
  encoding: 'utf8',
});

const seedJob = () => {
  const dir = fs.mkdtempSync('/tmp/deenclipped-precedence-');
  fs.mkdirSync(`${dir}/jobs/job_p`, { recursive: true });
  fs.writeFileSync(`${dir}/jobs/job_p/status.json`, JSON.stringify({ status: 'completed', stage: 'completed', progress: 100 }));
  fs.writeFileSync(`${dir}/jobs/job_p/payload.json`, JSON.stringify({
    title: 'A lecture',
    // What the WEB APP guesses. It has never seen this box, and these fields
    // exist for the self-hosted engine, which has no such environment.
    settings: { model: 'small', device: 'cpu', computeType: 'int8', ollamaModel: 'qwen3:1.7b' },
    template: { id: 'clean-line' },
  }));
  return dir;
};

test('the box overriding the app is reported as a line, never as an alarm', () => {
  const dir = seedJob();
  const printed = diagnose(dir, new URL('../worker', import.meta.url).pathname, { WHISPER_MODEL: 'medium' });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(printed, /the box won \(as designed\)/, 'says the box won');
  assert.match(printed, /whisper model: box 'medium' over the payload's 'small'/);
  assert.ok(!/::warning::.*whisper model/.test(printed), 'and does NOT raise a warning for it');
  assert.match(printed, /all \d+ newest jobs ran what this box decided/, 'the headline stays quiet');
});

test('the payload beating the box IS the alarm, and the monitor catches it', () => {
  // Revert the resolver to what shipped before v3.162.0 -- payload first, the
  // environment never read -- in a copy, and check the monitor says so. A
  // regression detector nobody has watched fire is not a detector.
  const dir = seedJob();
  const code = fs.mkdtempSync('/tmp/deenclipped-oldworker-');
  fs.cpSync(new URL('../worker', import.meta.url).pathname, code, { recursive: true });
  const file = `${code}/clip_worker.py`;
  const before = fs.readFileSync(file, 'utf8');
  const broken = before.replace(
    /        value = str\(os\.getenv\(env_name\) or ""\)\.strip\(\)\n        if value:\n            return value\n/,
    '        value = str(settings.get(payload_key) or "").strip()\n        if value:\n            return value\n');
  assert.notEqual(broken, before, 'the probe must actually edit the resolver');
  fs.writeFileSync(file, broken);
  const printed = diagnose(dir, code, { WHISPER_MODEL: 'medium' });
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(code, { recursive: true, force: true });
  assert.match(printed, /PAYLOAD WON {2}whisper model: asked 'small', box 'medium', ran 'small'/);
  assert.match(printed, /::warning::job job_p: whisper model -- the PAYLOAD won/);
  assert.match(printed, /did NOT run what this box decided/, 'and the headline names it');
});

/**
 * THE REFUSAL MAKES A CLAIM ABOUT THIS BOX, so the box can be asked to
 * confirm it.
 *
 * A YouTube 403 reaches the customer as either "this looks like the video
 * itself" or "this server's IP is blocked", and `_download_failure` chooses
 * between them purely by whether a proxy or a cookie file reached yt-dlp.
 * The first sentence sends somebody off to download a 1.5GB lecture by hand.
 * It was unverifiable until this: an empty VIDEO_IMPORT_PROXIES or a pool
 * file that would not parse leaves the message blaming the video while our
 * own address is what was refused.
 *
 * Never an address: a proxy URL carries its credentials in its userinfo.
 */
test('the import posture is reported, and never an address', () => {
  const body = script.replace(/#[^\n]*/g, '');
  assert.match(body, /def import_posture\(\)/);
  assert.match(body, /import_posture\(\)\s*\n/, 'and it is actually called');
  assert.match(body, /proxy pool\s+\{len\(pool\)\}/, 'the pool is reported by SIZE');
  // The two things that would leak a credential into a public run log.
  const printed = body.split('\n').filter(line => /\bout\(/.test(line));
  for (const line of printed) {
    assert.ok(!/options\.get\(['"]proxy['"]\)\s*\}/.test(line),
      `a proxy address must never be printed: ${line.trim()}`);
    assert.ok(!/\bpool\[/.test(line) && !/join\(pool\)/.test(line),
      `a pool address must never be printed: ${line.trim()}`);
  }
});

test('it names which sentence a 403 would produce, and warns when that is us', () => {
  const body = script.replace(/#[^\n]*/g, '');
  // The condition must be the SAME one _download_failure branches on, or the
  // diagnosis and the customer's message can disagree about this box.
  assert.match(body, /options\.get\("proxy"\) or options\.get\("cookiefile"\)/);
  assert.match(body, /::warning::a 403 will be reported as this server being blocked/);
});

test('the posture matches import_providers, against a real empty pool', () => {
  const dir = fs.mkdtempSync('/tmp/deenclipped-posture-');
  fs.mkdirSync(`${dir}/jobs`, { recursive: true });
  const printed = execFileSync('python3', ['.github/scripts/worker-diagnose.py'], {
    env: {
      ...process.env,
      WORKER_DATA_DIR: dir,
      DC_WORKER_CODE: new URL('../worker', import.meta.url).pathname,
      VIDEO_IMPORT_PROXIES: '',
      VIDEO_IMPORT_PROXY: '',
      VIDEO_IMPORT_COOKIES: '',
      VIDEO_IMPORT_COOKIES_FROM_BROWSER: '',
      YTDLP_POT_PROVIDER_URL: '',
    },
    encoding: 'utf8',
  });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.match(printed, /== the way in ==/);
  assert.match(printed, /proxy pool\s+0 address\(es\)/, 'an empty pool reads as zero');
  // The BOX's own cookies, and the line must say so: reading a bare
  // "cookies: no" as "the product has no cookies" was a real wrong call --
  // a real job carries whatever /admin/import-network holds.
  assert.match(printed, /cookies \(box\)\s+no/);
  assert.match(printed, /a real job carries whatever \/admin\/import-network holds/,
    'the readout must say the box is not the only source of cookies');
  assert.match(printed, /THIS SERVER'S ADDRESS being blocked/,
    'with nothing configured the honest reading is that the block is ours');
});
