import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/*
 * THE OPTIONAL FIRST STEP: "What would you like clipped?"
 *
 * The property everything else here rests on is that it is OPTIONAL, and that
 * is not a claim about a screen -- it is a claim about the wire, the record
 * and the worker payload. A job that skipped the step must reach the worker
 * carrying exactly what it carried before this step existed.
 *
 * The other property is the split the worker's own tests pin from the other
 * side: the brief steers WHICH moments are chosen and never how they render,
 * and it never touches a clip's score.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-brief-'));
process.env.DATA_DIR = dataDir;
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.APP_SESSION_SECRET = 'clip-brief-test-secret-long-enough-x';
const engine = await import('../src/local-engine.js');
const { state } = await import('../src/store.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* harmless */ }
});

// ── the one definition of what a brief is ─────────────────────────────────

test('a brief is trimmed, collapsed and capped, and absence is an empty string', () => {
  assert.equal(engine.clipBrief({}), '');
  assert.equal(engine.clipBrief({ clipBrief: null }), '');
  assert.equal(engine.clipBrief({ clipBrief: '  the parts about   repentance \n' }),
    'the parts about repentance');
  const long = 'x'.repeat(engine.CLIP_BRIEF_MAX + 500);
  assert.equal(engine.clipBrief({ clipBrief: long }).length, engine.CLIP_BRIEF_MAX);
});

test('the cap the browser enforces is the cap the server applies', () => {
  // Two copies of this number is how a brief that saved fine comes back
  // truncated somewhere else.
  const adapter = read('src/public/studio-adapter.js');
  const shown = Number((adapter.match(/jobBriefMax:\s*(\d+)/) || [])[1]);
  assert.equal(shown, engine.CLIP_BRIEF_MAX, 'the textarea and the engine disagree about the cap');
});

// ── the wire ──────────────────────────────────────────────────────────────

test('every submission route carries the brief', () => {
  // Three routes create jobs. A route that forgets it works on one way in and
  // silently drops the step on another, which is indistinguishable from the
  // step not working.
  const server = read('src/server.js');
  const sites = (server.match(/submitVideo\(/g) || []).length;
  const wired = (server.match(/clipBrief:/g) || []).length;
  assert.equal(wired, sites, `${sites} submitVideo call sites, ${wired} pass the brief`);
});

test('the browser sends the brief only when there is one', () => {
  // An ordinary job's payload stays byte-identical to what it was before the
  // step existed, which is what makes "optional" true on the wire too.
  const page = read('src/public/index.html');
  assert.match(page, /if\(opts&&opts\.clipBrief\)body\.clipBrief=opts\.clipBrief;/);
});

// ── the record, and the worker payload ────────────────────────────────────

async function submit(options) {
  try {
    const id = await engine.submitVideo('/tmp/does-not-matter.mp4', 'A lecture', 'user_admin', {
      sourceKind: 'upload', uploadedInputFile: '/tmp/does-not-matter.mp4',
      sourceRange: { startSec: 0, endSec: null }, ...options,
    });
    return { id, project: state.projects.find((p) => p.id === id) };
  } catch (error) {
    // No template, no import provider: environment reasons that live before
    // anything this test is about.
    return { error: error.message };
  }
}

test('the brief is stored on the project and reaches the worker settings', async () => {
  const { id, project, error } = await submit({ clipBrief: '  the parts about  repentance  ' });
  if (error) { assert.match(error, /nasheed|template|not configured|Sign in/i); return; }
  assert.equal(project.clipBrief, 'the parts about repentance', 'normalised once, on the record');
  const job = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', id, 'job.json'), 'utf8'));
  assert.equal(job.settings.clipBrief, 'the parts about repentance',
    'the worker reads it from settings; nothing else looks at the project');
});

test('a job with no brief carries an empty one, never undefined', async () => {
  const { id, project, error } = await submit({});
  if (error) { assert.match(error, /nasheed|template|not configured|Sign in/i); return; }
  assert.equal(project.clipBrief, null, 'nothing to remember for a later run');
  const job = JSON.parse(fs.readFileSync(path.join(dataDir, 'jobs', id, 'job.json'), 'utf8'));
  assert.equal(job.settings.clipBrief, '',
    'the worker reads "" as no brief; undefined would be an absent key it cannot tell from a bug');
});

test('a re-run looks for the same thing the first run was asked for', () => {
  // The brief is stored on the project precisely so more-clips and a retry do
  // not quietly revert to the general scoring. Both read it back.
  const source = read('src/local-engine.js');
  const more = (source.match(/sharedSettings\(owner, \{ language: project\.language, clipBrief: project\.clipBrief \}\)/g) || []).length;
  assert.equal(more, 2, 'both more-clips payloads read the stored brief');
  assert.match(source, /sharedSettings\(projectOwner, \{ language: project\.language, clipBrief: project\.clipBrief \}\)/,
    'the retry path too -- it passed NO options, so it also lost the pinned language');
});

// ── the panel ─────────────────────────────────────────────────────────────

const sandbox = {
  window: {}, document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null, querySelector: () => null },
  innerWidth: 1440, innerHeight: 950, setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(read('src/public/studio-adapter.js'), sandbox);
const A = sandbox.StudioAdapter;

// A real template, because without one the review's Style, Captions from,
// Spoken language and Underneath rows are never pushed -- and the first
// version of this file had no templates, so the row test silently skipped
// exactly the rows its probe attacked and came back green.
const TEMPLATE = { id: 'clean-line', name: 'Clean Line', captionMode: 'words', pro: false, version: 1 };
const DATA = { social: { providers: {} }, tracks: [{ id: 't1' }], projects: [], clips: [], templates: [TEMPLATE], clipSettings: {} };
// The label carries a non-breaking space so it cannot wrap to two lines.
const LOOKING = 'Looking\u00a0for';
const JOB = { url: 'https://youtu.be/x', durationKnown: true, durationSec: 600, start: 0, end: 600, title: 'A lecture' };

function atStep(n, brief) {
  A.ui.job = JOB; A.ui.jobStep = n; A.ui.jobBrief = brief === undefined ? '' : brief;
  return A.bindings(DATA);
}

test('the brief is the first step, and it never blocks', () => {
  const v = atStep(1);
  assert.equal(v.jobIsStepBrief, true, 'step one is the brief');
  assert.match(v.jobStepTitle, /what would you like clipped/i);
  assert.match(v.jobStepHint, /optional/i, 'the hint says so, because the button cannot');
  // Optional means Continue is live with the box empty. jobNextLabel carries
  // the blocker's reason when there is one.
  assert.equal(v.jobNextLabel, 'Continue');
  assert.equal(v.jobStepCounter, '1 / 8');
});

test('typing a brief and clearing it both reach the binding', () => {
  const v = atStep(1);
  v.onJobBrief('  clip the story about his mother  ');
  assert.equal(A.ui.jobBrief, '  clip the story about his mother  ', 'stored verbatim; the engine normalises');
  assert.equal(A.bindings(DATA).jobBrief, '  clip the story about his mother  ');
  v.onJobBrief('');
  assert.equal(A.bindings(DATA).jobBrief, '');
});

test('the examples fill the box rather than only suggesting wording', () => {
  const v = atStep(1);
  assert.ok(v.jobBriefExamples.length >= 3, 'a row worth drawing');
  for (const example of v.jobBriefExamples) {
    v.onJobBrief(example);
    assert.equal(A.bindings(DATA).jobBrief, example, `${example} did not reach the box`);
  }
});

test('the review names what it is looking for, empty or not', () => {
  const blank = atStep(8).jobSummaryRows.find((r) => r.label === LOOKING);
  assert.ok(blank, 'the review says nothing about the first question otherwise');
  assert.match(blank.value, /anything worth clipping/i, 'silence would read as the step not happening');
  const asked = atStep(8, 'the parts about repentance').jobSummaryRows.find((r) => r.label === LOOKING);
  assert.equal(asked.value, 'the parts about repentance');
});

test('every review row lands on the step that produced it', () => {
  // These carried HARDCODED numbers -- 2 for the trim, 4 for the style -- so
  // inserting a step at the front silently repointed every one of them at the
  // question AFTER the one it names, and NOTHING would have failed. Driven
  // rather than grepped: a regex over the source cannot tell a step argument
  // from any other number, and the first version of this test proved that by
  // failing on `brief.slice(0, 57)`.
  const expected = {
    [LOOKING]: 'What would you like clipped?',
    'From the lecture': 'How much of the lecture?',
    'Clip lengths': 'How long should the clips be?',
    Style: 'How should the captions look?',
    'Captions from': 'How should the captions look?',
    'Spoken language': 'What are you clipping?',
    Underneath: 'What plays underneath?',
  };
  const seen = [];
  for (const [label, title] of Object.entries(expected)) {
    const row = atStep(8).jobSummaryRows.find((r) => r.label === label);
    if (!row) continue;
    seen.push(label);
    row.go(null);
    assert.equal(A.bindings(DATA).jobStepTitle, title, `Edit on "${label}" landed on the wrong question`);
  }
  // Every row, or the test is only as strong as whichever rows the fixture
  // happened to produce.
  assert.deepEqual(seen, Object.keys(expected), `rows skipped: ${seen.join(', ')}`);
});

test('closing the panel forgets the brief', () => {
  // A brief left behind would be applied to the NEXT lecture, which nobody
  // asked for and which nothing on screen would explain.
  A.ui.jobBrief = 'the parts about repentance';
  A.bindings(DATA).closeJob(null);
  assert.equal(A.ui.jobBrief, '');
});

test('the step panel is host-owned and drawn only on its own step', () => {
  // An unmarked host node inside the generated tree is paired against a
  // generated sibling by index and reconciled away -- the trap that destroyed
  // the paste box. A textarea is where it shows up worst.
  const page = read('src/public/index.html');
  const block = page.slice(page.indexOf("jobBriefEl.id='studioJobBrief'"), page.indexOf('function paintBriefState'));
  assert.match(block, /jobBriefEl\.setAttribute\('data-host-owned',''\)/);
  assert.match(block, /if\(!open\|\|!vals\.jobIsStepBrief\)/, 'it belongs to one step, like the blocks beside it');
  assert.match(block, /dataset\.built!=='1'/, 'built once; a rebuild per paint would eat what is being typed');
  assert.match(block, /if\(box\.value!==wanted\)box\.value=wanted/, 'assigning every paint moves the caret to the end');
  assert.match(page, /paintJobBrief\(vals\);/, 'registered in paintStudio, not on an observer');
});
