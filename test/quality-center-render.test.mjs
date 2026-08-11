import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// These tests exist because Quality Center shipped rendering
// "[object Object] ____ 0%" for every blocked clip, and the whole suite
// stayed green. The old tests asserted that source strings existed; they
// never executed the renderer. A duplicate `function qualityRow` later in
// the file hoisted over the Quality Center one, so every call silently ran
// the Insights bar renderer instead. That is legal JavaScript, so
// `node --check` passed too.
//
// So: execute the real functions and assert on the HTML they produce.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

const between = (from, to) => {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return ui.slice(start, end);
};

const stubs = `
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortText = (v, n) => String(v || '').slice(0, n);
const authedUrl = u => u;
const ICON = { play: '<svg data-icon="play"></svg>' };
`;

const engine = new Function(
  stubs +
  between('function qualityPrimaryIssue(item){', 'function renderQualityCenter(){') +
  '; return { qualityPrimaryIssue, qualityClipRow };',
)();

const assessment = (over = {}) => ({
  clip: { id: 'c1', title: 'How As-Salaam heals the heart', thumbUrl: '/thumb/c1.jpg' },
  captionReady: true, renderReady: true, audioReady: true, safe: true, growthReady: true,
  issues: [], confidence: 88,
  ...over,
});

test('a cleared clip renders a real row, not a stringified object', () => {
  const html = engine.qualityClipRow(assessment(), true);
  // The exact failure that shipped.
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.doesNotMatch(html, /dc-quality-row/, 'must not fall through to the Insights bar renderer');
  assert.match(html, /class="dc-qc-row"/);
  assert.match(html, /How As-Salaam heals the heart/);
  assert.match(html, /<img src="\/thumb\/c1\.jpg"/);
  assert.match(html, />Good</);
});

test('a cleared clip carries no explanatory sentence', () => {
  const html = engine.qualityClipRow(assessment(), true);
  assert.doesNotMatch(html, /<p>/, 'the list heading already says these are cleared');
});

test('every blocked reason renders its own row with one matching action', () => {
  // Reasons are escaped on the way out, so apostrophes arrive as &#39;.
  const cases = [
    ['captionReady', /Captions haven&#39;t been synced/, /data-edit-clip="c1"/],
    ['renderReady', /hasn&#39;t been rendered and verified/, /data-edit-video-clip="c1"/],
    ['audioReady', /Background audio hasn&#39;t been verified/, /data-edit-video-clip="c1"/],
    ['safe', /needs a quick human check/, /data-review-clip="c1"/],
    ['growthReady', /Title, description or hashtags/, /data-edit-video-clip="c1"/],
  ];
  for (const [field, reason, action] of cases) {
    const html = engine.qualityClipRow(assessment({ [field]: false }), false);
    assert.doesNotMatch(html, /\[object Object\]/, `${field} row stringified an object`);
    assert.match(html, /class="dc-qc-row"/, `${field} row`);
    assert.match(html, reason, `${field} reason`);
    assert.match(html, action, `${field} action button`);
    assert.match(html, />Needs review</, `${field} badge`);
    // Exactly one action button — the whole point of the redesign.
    assert.equal((html.match(/<button class="dc-btn"/g) || []).length, 1, `${field} should offer one fix`);
  }
});

test('the first unmet check wins, so a clip never shows two reasons', () => {
  const html = engine.qualityClipRow(assessment({ captionReady: false, renderReady: false, safe: false }), false);
  assert.match(html, /Captions haven&#39;t been synced/);
  assert.doesNotMatch(html, /hasn&#39;t been rendered/);
  assert.doesNotMatch(html, /human check/);
});

test('clip titles are escaped, not injected', () => {
  const html = engine.qualityClipRow(
    assessment({ clip: { id: 'x"1', title: '<img src=x onerror=alert(1)>', thumbUrl: '' } }),
    true,
  );
  assert.doesNotMatch(html, /<img src=x onerror/);
  assert.match(html, /&lt;img src=x onerror/);
});

test('a clip with no thumbnail falls back to the play icon', () => {
  const html = engine.qualityClipRow(assessment({ clip: { id: 'c9', title: 'No art', thumbUrl: '' } }), true);
  assert.match(html, /data-icon="play"/);
  assert.doesNotMatch(html, /<img/);
});

test('no top-level function name is declared twice in activity-fix.js', () => {
  // The root cause. Two `function qualityRow` declarations hoisted over each
  // other and the later one won for the entire script.
  const names = [...ui.matchAll(/^function ([A-Za-z0-9_]+)/gm)].map(m => m[1]);
  const seen = new Map();
  for (const name of names) seen.set(name, (seen.get(name) || 0) + 1);
  const dupes = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
  assert.deepEqual(dupes, [], `duplicate declarations silently override each other: ${dupes.join(', ')}`);
});
