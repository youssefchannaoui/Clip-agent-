import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

/**
 * The box can be asked whether it can fetch a video RIGHT NOW.
 *
 * A transient refusal is the one thing a log cannot answer: the log records
 * what happened at 02:14, and the question is what happens at 02:31. Youssef's
 * own evidence -- a lecture that failed and then imported when he pressed
 * Retry -- is exactly that shape, and until this there was no way to ask
 * without a customer submitting a whole job.
 *
 * What CI can see is the drift: it parses, it keeps the seam the workflow
 * substitutes, it runs the PRODUCTION downloader rather than a copy of it, it
 * deploys nothing, and it prints no credential.
 */
const script = fs.readFileSync(new URL('../.github/scripts/import-probe.py', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
// The provider itself, so the injected refusal can be checked against the
// worker's OWN idea of what a block looks like rather than a copy of the list.
const worker = fs.readFileSync(new URL('../worker/import_providers.py', import.meta.url), 'utf8');

test('the probe parses', () => {
  execFileSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())',
    '.github/scripts/import-probe.py']);
});

test('it keeps the PARAMS seam the workflow substitutes', () => {
  assert.match(script, /^PARAMS = \{\}$/m,
    'the workflow rewrites this exact line; without it the URL never arrives');
  assert.match(workflow, /the import probe lost its PARAMS seam/,
    'and the workflow refuses rather than shipping a probe that asks about nothing');
});

test('it runs the REAL downloader, not a second implementation', () => {
  // A probe that builds its own yt-dlp options proves nothing about the code
  // customers get -- it would answer for a downloader nobody uses. Its whole
  // value is that the two cannot differ.
  assert.match(script, /ip\.YtDlpImportProvider\(\)\.import_video\(/);
  assert.ok(!/YoutubeDL\(/.test(script),
    'it must never drive yt-dlp itself');
});

test('a fetch dispatch deploys nothing', () => {
  // Asking a question must never restart a worker mid-job -- the rule the
  // diagnose and quran_sync dispatches already follow.
  const guards = workflow.match(/inputs\.probe_url == ''/g) || [];
  assert.ok(guards.length >= 2, `every deploy step is skipped (${guards.length} guards)`);
  assert.match(workflow, /if: inputs\.probe_url != ''/, 'and the probe step runs only when asked');
});

test('the URL is carried as a JSON literal, never into a shell command', () => {
  // This is the only dispatch input that is a URL somebody pasted, so it is
  // the one that most needs the base64 carriage every other probe here uses.
  const step = /Ask the box to fetch one URL[\s\S]*?REMOTE\n/.exec(workflow);
  assert.ok(step, 'the step is findable');
  assert.match(step[0], /base64 -w0/);
  assert.ok(!/\$\{\{ inputs\.probe_url \}\}[^\n]*(curl|python|docker|bash)/.test(step[0]),
    'the input never lands inside a command line');
});

test('no line it prints can carry a proxy credential', () => {
  const printed = script.split('\n').filter(line => /\bout\(/.test(line));
  for (const line of printed) {
    assert.ok(!/\bpool\[|join\(pool\)|options\.get\(["']proxy["']\)\s*\}/.test(line),
      `a proxy address must never be printed: ${line.trim()}`);
  }
  assert.match(script, /def scrub/, 'and yt-dlp quotes the proxy it used, so failures are scrubbed');
});

test('it takes seconds of video, not the lecture', () => {
  // The 403 lands on the MEDIA fetch, so extraction alone would report success
  // on the exact failure being chased -- but a full download is ~1.5GB off a
  // 250GB monthly plan for a question.
  assert.match(script, /"windowStartSec": 0/);
  assert.match(script, /"windowEndSec": WINDOW/);
  assert.match(workflow, /Math\.min\(120, window\)/, 'and the window is capped on the runner');
});

test('a refusal is an answer, and does not fail the run', () => {
  // Otherwise "this video is genuinely blocked" and "the box could not be
  // reached" look identical, which is the whole thing this probe exists to
  // tell apart.
  const failure = /except ip\.ImportProviderError as exc:[\s\S]*?return 0/.exec(script);
  assert.ok(failure, 'the refusal path returns cleanly');
  // AND THE CONTROL'S OWN REFUSAL TOO. The injected half is the one place this
  // probe may fail a run, so the plain fetch failing must still be an answer:
  // a video YouTube is refusing this minute is not a regression in the rounds.
  const control = /if not ok:[\s\S]*?return 0/.exec(script);
  assert.ok(control && !/::error::/.test(control[0]),
    'a control that cannot fetch reports and exits clean');
});

test('the injected refusal drives the REAL rounds, not a copy of them', () => {
  // The whole value of this half is that the code it exercises is the code a
  // customer meets. A probe that reimplemented the loop -- or that refused at
  // construction, before the real options and the real proxy were chosen --
  // would prove something about the probe instead.
  assert.match(script, /self\.real = ytdlp\.YoutubeDL/,
    'it wraps the real class rather than replacing the provider');
  assert.match(script, /instance = probe\.real\(options/,
    'the real YoutubeDL is still constructed with the real options');
  assert.match(script, /instance\.extract_info = refuse/,
    'only the fetch is refused, so the failure lands where a real 403 lands');
  assert.doesNotMatch(script, /for round_no in range/,
    'the probe must never carry its own copy of the rounds loop');
});

test('the injected message is one _looks_blocked recognises', () => {
  // A message the provider does not read as a block takes the "gone for ever"
  // branch and raises on the FIRST attempt -- so the rounds would never run
  // and the probe would report a pass having tested the opposite path.
  const injected = /raise probe\.ytdlp\.utils\.DownloadError\(\s*"([^"]*)"/.exec(script);
  assert.ok(injected, 'the injected refusal is a DownloadError with a message');
  const signs = [...worker.matchAll(/^\s+"([^"]+)",?\s*(?:#.*)?$/gm)]
    .map((m) => m[1].toLowerCase());
  const blockSigns = /_BLOCK_SIGNS = \(([\s\S]*?)\)/.exec(worker);
  assert.ok(blockSigns, 'the worker still names what a block looks like');
  const known = [...blockSigns[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  assert.ok(known.some((sign) => injected[1].toLowerCase().includes(sign)),
    `the injected message must match one of ${known.join(', ')}`);
  assert.ok(signs.length >= 0);
});

test('only the injected half can fail the run, and only after a clean control', () => {
  // The control proves the video is fetchable from this box right now. Only
  // then is a refusal the rounds cannot recover from a statement about the
  // rounds -- which is a regression worth a red run.
  const error = /::error::/.exec(script);
  assert.ok(error, 'the unrescued case is reported as an error');
  const before = script.slice(0, error.index);
  assert.match(before, /ok, seconds, detail, _ = fetch\(canonical\)/,
    'the control runs before anything can fail the run');
  assert.match(before, /refuse_first=BLOCK_FIRST/,
    'and the error can only follow the injected run');
  assert.equal((script.match(/::error::/g) || []).length, 1,
    'exactly one place fails the run');
});

test('with no injection asked for, nothing changes', () => {
  // The ordinary "can this box fetch this video" dispatch must not start
  // paying for a second download or a second minute of backoff.
  assert.match(script, /BLOCK_FIRST = int\(PARAMS\.get\("blockFirst"\) or 0\)/);
  assert.match(script, /if not BLOCK_FIRST:\s*\n\s*return 0/,
    'a plain fetch returns before the injected half');
});
