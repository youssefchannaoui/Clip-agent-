import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * The Lecture library's sidebar.
 *
 * It used to end in "Before you import" -- three warnings in the most valuable
 * column on the screen. Youssef, 1 Sept 2026: "they're not very informational
 * or helpful."
 *
 * What replaced it is arithmetic over the account's OWN projects and clips, so
 * the failure to guard against is not a crash: it is a figure that is quietly
 * wrong, or a card that pads itself out with zeroes on an account that has
 * nothing to say. Both are silent, and both make every other number on the
 * screen less believable.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');

const sandbox = {
  window: {},
  document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
  setTimeout, clearTimeout, setInterval, clearInterval, console,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  innerWidth: 1440,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const A = sandbox.StudioAdapter;

const lecture = (id, title, seconds, url) =>
  ({ id, title, status: 'done', sourceDurationSec: seconds, url });
const clip = (id, projectId, status, posted) =>
  ({ id, projectId, title: 'Clip ' + id, status, score: 80, durationMs: 42000,
     targets: [], postedAt: posted || null });

// Decided clips for one lecture: `kept` approved, the rest rejected.
const decided = (projectId, kept, total, posted = 0) => {
  const out = [];
  for (let i = 0; i < total; i += 1) {
    out.push(clip(projectId + '-' + i, projectId, i < kept ? 'approved' : 'rejected',
      i < posted ? Date.now() : null));
  }
  return out;
};

const statsOf = data => {
  A.ui.screen = 'library';
  return A.bindings(Object.assign({
    user: { email: 'a@b.test' }, billing: { current: {} },
  }, data)).libStats;
};

test('the best lecture is the one whose clips survive review', () => {
  const st = statsOf({
    projects: [lecture('p1', 'Patience', 2280, 'https://y/1'), lecture('p2', 'Khutbah', 1980, 'https://y/2')],
    clips: decided('p1', 7, 9, 5).concat(decided('p2', 1, 8)),
  });
  assert.equal(st.best.name, 'Patience');
  assert.equal(st.best.kept, 7);
  assert.equal(st.best.decided, 9);
  assert.equal(Math.round(st.best.rate * 100), 78);
  assert.equal(st.worst.name, 'Khutbah');
  assert.equal(Math.round(st.worst.rate * 100), 13);
});

test('a keep rate needs a decided sample before it means anything', () => {
  // Two clips reviewed is one person's shrug wearing a percentage sign. The
  // floor is four decided clips, and a lecture under it is left out entirely
  // rather than ranked on noise.
  const thin = statsOf({
    projects: [lecture('p1', 'Only three', 600, 'https://y/1')],
    clips: decided('p1', 2, 3),
  });
  assert.equal(thin.best, null, 'three decided clips is not a verdict');

  const enough = statsOf({
    projects: [lecture('p1', 'Four decided', 600, 'https://y/1')],
    clips: decided('p1', 3, 4),
  });
  assert.equal(enough.best.name, 'Four decided');
});

test('the weakest lecture is named only when it is a different answer', () => {
  // One lecture is not a comparison, and two that agree are not either --
  // printing the same lecture as both best and worst reads as broken.
  const one = statsOf({
    projects: [lecture('p1', 'Alone', 600, 'https://y/1')],
    clips: decided('p1', 4, 6),
  });
  assert.ok(one.best, 'it is still the best');
  assert.equal(one.worst, null, 'but there is nothing to compare it with');

  const tied = statsOf({
    projects: [lecture('p1', 'A', 600, 'https://y/1'), lecture('p2', 'B', 600, 'https://y/2')],
    clips: decided('p1', 3, 6).concat(decided('p2', 3, 6)),
  });
  assert.equal(tied.worst, null, 'a tie is not a weakest');
});

test('minutes are counted on the selected range, which is what tokens buy', () => {
  // A lecture imported as a 5-minute section costs five minutes, not its full
  // 38 -- the section download is the whole reason that distinction exists.
  const st = statsOf({
    projects: [
      Object.assign(lecture('p1', 'Sectioned', 2280, 'https://y/1'), { sourceStartSec: 600, sourceEndSec: 900 }),
      lecture('p2', 'Whole', 1500, 'https://y/2'),
    ],
    clips: decided('p1', 4, 6, 2),
  });
  assert.equal(st.minutes, 30, '5 minutes of the first plus 25 of the second');
  assert.equal(st.made, 6);
  assert.equal(st.kept, 4);
  assert.equal(st.posted, 2);
});

test('the queue counts split into three different jobs for a person', () => {
  const st = statsOf({
    projects: [
      lecture('p1', 'Done', 600, 'https://y/1'),
      { id: 'p2', title: 'Working', status: 'processing', sourceDurationSec: 600 },
      { id: 'p3', title: 'Broken', status: 'failed', sourceDurationSec: 0 },
    ],
    clips: decided('p1', 4, 6).concat([clip('w1', 'p1', 'waiting'), clip('w2', 'p1', 'waiting')]),
  });
  assert.equal(st.waiting, 2, 'clips awaiting a decision');
  assert.equal(st.working, 1, 'lectures still being processed');
  assert.equal(st.failed, 1, 'imports that failed');
});

test('an account with nothing to say gets no card at all', () => {
  // A panel of "0 of 0" teaches less than no panel, and the host draws only
  // what it is handed.
  const st = statsOf({ projects: [], clips: [] });
  assert.equal(st.best, null);
  assert.equal(st.worst, null);
  assert.equal(st.made, 0);
  assert.equal(Array.from(st.again).length, 0);
  assert.equal(st.empty, true);
});

test('re-import offers only lectures with a URL that are not still working', () => {
  // An upload has no URL to re-fetch, and a lecture mid-import cannot be asked
  // for a second range yet.
  const st = statsOf({
    projects: [
      lecture('p1', 'Linked', 2280, 'https://y/1'),
      { id: 'p2', title: 'Uploaded MP4', status: 'done', sourceDurationSec: 900 },
      { id: 'p3', title: 'Mid-import', status: 'processing', sourceDurationSec: 600, url: 'https://y/3' },
    ],
    clips: [],
  });
  const again = Array.from(st.again, r => String(r.name));
  assert.deepEqual(again, ['Linked']);
});

test('storage says what it holds, not the same count twice', () => {
  // The three rows used to read "0 / 0 / 0" beside a heading that already said
  // "0 lectures - 0 clips", so the card repeated itself and answered nothing.
  A.ui.screen = 'library';
  const b = A.bindings({
    user: { email: 'a@b.test' }, billing: { current: {} },
    projects: [lecture('p1', 'A', 600, 'https://y/1'), lecture('p2', 'B', 600, 'https://y/2')],
    clips: decided('p1', 3, 5),
    storage: { sourceBytes: 4.1e9, clipBytes: 3.2e8 },
  });
  assert.match(String(b.storageSources), /^2 lectures · /);
  assert.match(String(b.storageClips), /^5 clips · /);
  assert.match(String(b.storageTranscripts), /^2 lectures transcribed$/);
});

test('the panel is painted with the other host panels, and the warnings go', () => {
  // Every host-injected panel belongs in paintStudio's list -- an observer
  // loses the race during a drag (v3.53.5). And the "Before you import" card
  // is a literal section in the design, so removing it is the host's job.
  const html = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
  const paint = /function paintStudio\(\)\{[\s\S]*?\n\}/.exec(html)[0];
  assert.match(paint, /paintLibraryAside\(vals\)/, 'it runs on every paint');
  assert.match(html, /Before you import/, 'and the warnings card is found by its own heading');
  // Mounted off a data attribute, never a hashed class a re-import regenerates.
  assert.match(html, /\[data-tour="lib-add"\]/);
});
