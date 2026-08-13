import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Executed-output test, written after shipping a blank home page.
//
// renderHome() called formatLocal(), which is a *server* helper and does not
// exist in the browser bundle. The template literal threw before innerHTML was
// assigned, so the entire page rendered as nothing. Every source-string test
// passed, because the identifier was spelled correctly — it simply was not
// there. Greps cannot catch an undefined reference; running the code can.
//
// This builds the real render functions with stubbed dependencies and asserts
// they produce markup. Anything they reference that is not stubbed here is,
// by definition, something the browser would also fail to find.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');

const fn = name => {
  const start = ui.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  let depth = 0, i = ui.indexOf('{', start);
  for (let j = i; j < ui.length; j++) {
    if (ui[j] === '{') depth++;
    else if (ui[j] === '}') { depth--; if (depth === 0) return ui.slice(start, j + 1); }
  }
  throw new Error(`unbalanced ${name}`);
};

// Only genuine, app-provided helpers are stubbed. If a render function reaches
// for anything else, this throws — which is the point.
const DEPS = `
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortText = (v, n) => String(v || '').slice(0, n);
const authedUrl = u => u;
const formatDate = v => (v ? '16 May, 10:00' : '—');
const formatRelative = () => '2h ago';
const projectDisplayTitle = p => p.title || 'Project';
const socialSvg = k => '<svg data-logo="' + k + '"></svg>';
const ICON = new Proxy({}, { get: (_, k) => '<svg data-icon="' + String(k) + '"></svg>' });
`;

const build = (names, deps = DEPS) =>
  new Function(`${deps}\n${names.map(fn).join('\n')}\nreturn {${names.join(',')}};`)();

const CLIP = {
  id: 'c1', title: 'The Power of Sabr in Tough Times', status: 'scheduled',
  scheduledAt: Date.now() + 86400000, scheduledLabel: 'Tomorrow 10:00 AM',
  thumbUrl: '/thumb.jpg', targets: [{ provider: 'tiktok', enabled: true }],
};
const DATA = {
  clips: [CLIP],
  projects: [{ id: 'p1', title: 'Ramadan Reflections', status: 'done', durationSec: 635, submittedAt: Date.now(), progress: 100 }],
};

test('Scheduled next renders from real clip data', () => {
  const { v7Scheduled } = build(['v7Scheduled'], `${DEPS}
    const publishingClipGroups = d => ({ scheduled: d.clips, queue: [], posted: [] });`);
  const html = v7Scheduled(DATA);
  assert.match(html, /Scheduled next/);
  assert.match(html, /The Power of Sabr/);
  assert.match(html, /Tomorrow 10:00 AM/, 'it must use the server-formatted label');
  assert.match(html, /data-logo="tiktok"/, 'the destination platform must be shown');
  assert.doesNotMatch(html, /\[object Object\]|undefined|NaN/);
});

test('Scheduled next has an honest empty state', () => {
  const { v7Scheduled } = build(['v7Scheduled'], `${DEPS}
    const publishingClipGroups = () => ({ scheduled: [], queue: [], posted: [] });`);
  const html = v7Scheduled({ clips: [] });
  assert.match(html, /Nothing scheduled yet/);
  assert.doesNotMatch(html, /View all scheduled/, 'no "view all" when there is nothing to view');
});

test('Recent activity renders from the shared feed', () => {
  const { v7Activity } = build(['v7Activity'], `${DEPS}
    const recentActivity = () => ([{ tone: 'good', text: 'Posted · Why Dua Changes Everything', at: Date.now() }]);`);
  const html = v7Activity(DATA);
  assert.match(html, /Recent activity/);
  assert.match(html, /Why Dua Changes Everything/);
  assert.match(html, /2h ago/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('Uploads renders duration, date and status without leaking placeholders', () => {
  const { v7Uploads } = build(['v7Uploads']);
  const html = v7Uploads(DATA);
  assert.match(html, /Your uploads/);
  assert.match(html, /Ramadan Reflections/);
  assert.match(html, /10:35/, '635 seconds must format as 10:35');
  assert.match(html, /Ready/);
  assert.doesNotMatch(html, /undefined|NaN|\[object Object\]/);
});

test('a processing upload shows its real percentage', () => {
  const { v7Uploads } = build(['v7Uploads']);
  const html = v7Uploads({ clips: [], projects: [{ id: 'p2', title: 'Building', status: 'processing', progress: 63, submittedAt: Date.now() }] });
  assert.match(html, /Processing 63%/);
});

test('an empty workspace still renders every panel', () => {
  // The state a new account opens on. Each panel must stand alone rather than
  // assume there is data.
  const empty = { clips: [], projects: [] };
  const { v7Uploads } = build(['v7Uploads']);
  assert.match(v7Uploads(empty), /Nothing imported yet/);
  const { v7Activity } = build(['v7Activity'], `${DEPS}\nconst recentActivity = () => [];`);
  assert.match(v7Activity(empty), /Activity from your imports/);
});

test('the hero headline emphasises only the closing words', () => {
  const { v7Headline } = build(['v7Headline']);
  const html = v7Headline();
  assert.match(html, /One talk\.<br>Your next month of<br><em>content\.<\/em>/);
});

test('no home render function calls a server-only helper', () => {
  // formatLocal lives in src/server.js. Reaching for it from the browser
  // bundle is what blanked the page; the identifier was spelled correctly, so
  // only running the code revealed it.
  for (const name of ['v7Scheduled', 'v7Activity', 'v7Uploads', 'renderHome']) {
    assert.doesNotMatch(fn(name), /\bformatLocal\s*\(/, `${name} must not call the server's formatLocal`);
  }
});
