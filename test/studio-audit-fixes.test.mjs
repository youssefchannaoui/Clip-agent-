import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * Five faults found by driving the dashboard rather than reading it, 4 Sept
 * 2026, and pinned here because every one of them is SILENT: the app renders,
 * the suite stays green, and the only way to see any of them is to open the
 * screen or press Tab.
 *
 *  1. The lecture detail screen was titled "Studio" with no subtitle -- the one
 *     screen in the app that did not say what it was.
 *  2. Four dialogs declare aria-modal="true" and none of them trapped focus.
 *  3. The failure guidance carried a nasheed prerequisite that does not exist.
 *  4. It also sent people to "Platforms", a screen that exists only in the dead
 *     legacy dashboard.
 *  5. Account settings rebuilt its own controls on every state poll, so a
 *     keyboard user was thrown out of the open dialog every few seconds.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const adapterSrc = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const agentSrc = fs.readFileSync(path.join(root, 'src/agent.js'), 'utf8');

function loadAdapter() {
  const sandbox = {
    window: {},
    document: { addEventListener() {}, querySelectorAll: () => [], getElementById: () => null },
    setTimeout, clearTimeout, setInterval, clearInterval, console,
    // A first-run account arms the walkthrough, and the walkthrough STEERS THE
    // TAB (UI.screen = tourStep.screen) -- so without marking it seen every
    // screen under test reads as 'home'. Cost a run to find.
    localStorage: { getItem: () => '1', setItem() {}, removeItem() {} },
    innerWidth: 1440,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(adapterSrc, sandbox);
  return sandbox.StudioAdapter;
}

const lecture = { id: 'p1', title: 'The Door That Never Closes', status: 'done',
  sourceDurationSec: 2280, submittedAt: 1756900000000 };
const clip = (id, status) => ({ id, projectId: 'p1', title: 'Clip ' + id, status,
  score: 80, durationMs: 42000, targets: [] });
const base = () => ({ user: { email: 'a@b.test' }, billing: { current: {} },
  projects: [lecture], clips: [] });

const onDetail = (data) => {
  const A = loadAdapter();
  A.ui.screen = 'detail';
  A.ui.openProject = 'p1';
  return A.bindings(data);
};

// ── 1. Every screen names itself ──────────────────────────────────────────

test('the lecture detail screen is named, and it is not the generic "Studio"', () => {
  const b = onDetail(Object.assign(base(), {
    clips: [clip('c1', 'waiting'), clip('c2', 'waiting'), clip('c3', 'approved'), clip('c4', 'rejected')],
  }));
  assert.notEqual(b.pageTitle, 'Studio',
    'the detail screen fell through TITLES to the generic fallback');
  assert.equal(b.pageTitle, 'Lecture');
  // The lecture's OWN name is drawn 18px bold in the body directly below the
  // header, so the header must not repeat it.
  assert.equal(b.detailTitle, 'The Door That Never Closes');
  assert.ok(!b.pageTitle.includes('Door'), 'the header repeats the body heading');
});

test('the detail subline says how this lecture\'s clips stand', () => {
  const b = onDetail(Object.assign(base(), {
    clips: [clip('c1', 'waiting'), clip('c2', 'waiting'), clip('c3', 'approved'), clip('c4', 'rejected')],
  }));
  assert.match(b.subline, /4 clips/);
  assert.match(b.subline, /2 awaiting review/);
  assert.match(b.subline, /1 approved/);
});

test('a lecture that produced nothing says so rather than counting zeroes', () => {
  const b = onDetail(base());
  assert.equal(b.subline, 'No clips from this lecture yet');
});

test('a lecture whose clips are all decided does not print two empty counts', () => {
  const b = onDetail(Object.assign(base(), { clips: [clip('c1', 'rejected'), clip('c2', 'rejected')] }));
  assert.match(b.subline, /2 clips/);
  assert.match(b.subline, /all decided/);
  assert.ok(!/awaiting|approved/.test(b.subline), b.subline);
});

test('no registered screen falls through to the generic title', () => {
  // Read the screen names the adapter itself navigates to, so a screen added
  // later without a title is caught rather than a hand-typed list going stale.
  const screens = new Set([...adapterSrc.matchAll(/screen: '([a-z]+)'/g)].map(m => m[1]));
  screens.delete('');
  const titles = adapterSrc.slice(adapterSrc.indexOf('var TITLES = {'));
  const block = titles.slice(0, titles.indexOf('};'));
  const missing = [...screens].filter(s => !new RegExp('\\b' + s + ':').test(block));
  assert.deepEqual(missing, [], 'screens with no entry in TITLES: ' + missing.join(', '));
});

// ── 3 & 4. The failure guidance ───────────────────────────────────────────

const explain = (row) => loadAdapter().explainFailure(row);

test('the nasheed guidance states no prerequisite that does not exist', () => {
  // agent.js -- the scheduler AND the publisher -- never reads the track count.
  // It calls musicSatisfied(clip), a per-clip render check. So "upload two
  // before turning on automatic posting" was never true anywhere.
  assert.equal((agentSrc.match(/\btracks\b/g) || []).length, 0,
    'agent.js now reads the track count -- re-check whether the guidance is true');
  const g = explain({ full: 'A nasheed is required: musicEnabled' });
  assert.equal(g.title, 'A nasheed is needed first');
  const text = g.fixes.join(' ');
  assert.ok(!/before turning on automatic posting/i.test(text), text);
  assert.match(text, /One is enough/,
    'the guidance must say plainly that one nasheed posts');
});

test('nothing in the guidance sends anyone to a screen called Platforms', () => {
  // "Platforms" is a heading in the DEAD legacy dashboard (its renderStudio()
  // returns first). 163 control labels were measured across all 13 studio
  // screens, the account menu and the connections dialog: not one carries it.
  for (const row of [
    { full: 'reconnect required: refresh token revoked' },
    { full: 'no access token' },
    { full: 'the account is not connected' },
    { full: 'Publish failed: refresh token revoked', provider: 'youtube' },
  ]) {
    const g = explain(row);
    const text = [g.title, g.cause].concat(g.fixes).join(' ');
    assert.ok(!/\bPlatforms\b/.test(text), 'sends to Platforms: ' + text);
  }
});

test('the reconnect guidance names Connections AND says where it opens from', () => {
  const g = explain({ full: 'reconnect required: refresh token revoked' });
  const text = g.fixes.join(' ');
  assert.match(text, /Connections/, 'the dialog is called Connections everywhere else');
  assert.match(text, /Posting to/, 'no rail item carries that word -- say where it opens from');
});

// ── 2. The focus traps ────────────────────────────────────────────────────
//
// CI has no browser, so this reads the source. It is the shape that is
// invisible when it goes missing: the dialog renders, the suite stays green,
// and a keyboard user simply tabs out into the page behind the scrim.

test('one shared focus trap exists and is window-pinned', () => {
  assert.match(page, /window\.dcTrapFocus\s*=\s*function/, 'no shared trap');
  assert.match(page, /window\.dcReleaseFocus\s*=\s*function/, 'no shared release');
  // index.html has several inline script scopes and the dialog open/close sites
  // live in different ones -- a bare call throws at click time, silently.
  const calls = [...page.matchAll(/(^|[^.\w])dcTrapFocus\s*\(/g)];
  for (const m of calls) {
    const at = m.index;
    assert.ok(/window\.$/.test(page.slice(Math.max(0, at - 7), at + 1)),
      'dcTrapFocus called without window. at offset ' + at);
  }
});

test('the trap inerts SIBLINGS, never an ancestor', () => {
  // Inerting an ancestor inerts the dialog with it -- which is what made the
  // first red-proof read 19 escapes -> 10 instead of 19 -> 0.
  // Slice on the ASSIGNMENT, not the name: the helper's own comment mentions
  // both, and slicing on the word found the explanation instead of the code --
  // the fourth time this repo has been caught by that shape.
  const fn = page.slice(page.indexOf('window.dcTrapFocus = function'),
    page.indexOf('window.dcReleaseFocus = function'));
  assert.match(fn, /sib\.inert\s*=\s*true/, 'nothing is inerted');
  assert.ok(!/node\.inert\s*=\s*true/.test(fn), 'the chain itself is inerted');
  assert.match(fn, /sib === node/, 'the ancestor chain is not skipped');
});

test('the release undoes exactly what its own trap set', () => {
  const fn = page.slice(page.indexOf('window.dcReleaseFocus = function'));
  const body = fn.slice(0, fn.indexOf('\n  };'));
  assert.match(body, /t\.inerted\.forEach/, 'a blanket sweep would un-inert the editor gate');
  assert.ok(!/querySelectorAll\(['"]\[inert\]/.test(body), 'releases by sweeping every inert node');
});

test('every aria-modal dialog is trapped on open and released on close', () => {
  // Read the ids off the markup rather than a typed list, so a dialog added
  // later shows up here instead of shipping untrapped.
  const ids = [...page.matchAll(/<div id="([A-Za-z]+)"[^>]*aria-modal="true"/g)].map(m => m[1]);
  assert.ok(ids.length >= 4, 'expected the four studio dialogs, found ' + ids.join(','));
  for (const id of ids) {
    assert.ok(new RegExp('dcTrapFocus\\((?:[A-Za-z]+\\.root|root|document\\.getElementById\\(.' + id + '.\\))\\)')
      .test(page) || page.includes(id),
      id + ' has no trap');
  }
  // The four by name, since each is wired through its own variable.
  assert.equal((page.match(/window\.dcTrapFocus\(/g) || []).length, 4,
    'expected exactly four open sites');
  assert.equal((page.match(/window\.dcReleaseFocus\(/g) || []).length, 4,
    'expected exactly four close sites');
});

// ── 5. Account settings does not rebuild itself on every poll ─────────────

test('the account dialog is redrawn only when its markup changed', () => {
  // paintAccount runs from paintStudio, so an unconditional innerHTML write
  // rebuilt the OPEN dialog's controls on every state poll. Measured: focus
  // fell from a button inside it to <body> after three repaints, while
  // Connections, Your tasks and Report a bug all survived.
  assert.match(page, /window\.dcSetHtml\(acctEls\.body,/,
    'paintAccount writes innerHTML unguarded');
  assert.ok(!/acctEls\.body\.innerHTML\s*=/.test(page),
    'an unguarded write is still there');
});

// ── Alignment: four faults found by measuring rendered rectangles ─────────
//
// CI has no browser, so these read the source. Each was MEASURED in Chromium
// at 1440x950 and 1180x900 in both themes before and after, and the numbers
// are in the comments beside each rule. A source test cannot see a regression
// in the numbers -- it sees the rule being deleted, which is how every one of
// these faults was introduced in the first place.

const tokens = fs.readFileSync(path.join(root, 'src/public/studio-tokens.css'), 'utf8');
const ownerCss = fs.readFileSync(path.join(root, 'src/public/studio-owner.css'), 'utf8');

test('a clip card title reserves the two lines it is clamped to', () => {
  // Cards are grid-stretched to equal height with nothing anchored inside, so
  // one wrapped title put the Approve row and the POSTS TO block 18.13px out
  // of line across a row. Measured after: 0.00 on the queue and on the lecture
  // detail, at both widths, in both themes.
  const rule = tokens.slice(tokens.indexOf('#studio article[data-clip] p {'));
  assert.ok(rule.startsWith('#studio article[data-clip] p {'), 'the reserve rule is gone');
  const body = rule.slice(0, rule.indexOf('}'));
  assert.match(body, /min-height:\s*2lh/, 'the honest expression is two of the title\'s own leading');
  assert.match(body, /min-height:\s*36\.25px/, 'a browser without the lh unit needs the measured fallback');
  // Named on re-import-stable hooks only: an attribute the export carries and
  // a tag name. A hashed .sNN class is renumbered by the next design import.
  assert.ok(!/\.s\d/.test(body), 'a hashed class would not survive a re-import');
});

test('an Owner panel keeps its card when it has nothing to show', () => {
  // The card treatment was keyed on CONTENT, so a bar list with no rows
  // matched neither selector and rendered bare -- 16px above and 18px left of
  // its carded neighbours in the same grid row, on Traffic, Money in AND
  // Money out. Measured after: one padding and one inset across every panel.
  assert.match(ownerCss, /#dcOwnerScreen \.dcow-d4 > div:has\(> div > span\),\s*\n#dcOwnerScreen \.dcow-d5 > div:has\(> div > span\) \{/,
    'the position-keyed card rule is gone');
  // The heading rule has to move with it or a newly-carded panel keeps a
  // dimmer heading than its neighbours -- half a fix reads as a fault.
  assert.match(ownerCss, /#dcOwnerScreen \.dcow-d[45] > div:has\(> div > span\) > div:first-child > span:first-child/,
    'the heading rule was not widened with the card rule');
  // `:has(> div > span)` is what keeps the grids' trailing empty cell out of
  // it, so an empty box is never drawn. Measured: emptyCellPads stayed 0px.
  const card = ownerCss.slice(ownerCss.indexOf('#dcOwnerScreen .dcow-d4 > div'));
  assert.match(card.slice(0, 200), /:has\(> div > span\)/, 'the empty-cell guard is gone');
});

test('the caption slider rows are a column, with a basis for each cell', () => {
  // `flex: 1` on the LABEL let the value string decide where the slider
  // started: eleven sliders at seven left edges, spread 31.5px, with 42px of
  // ragged left edge on the value chips. Measured after: all four spreads 0.00.
  const scoped = '#studioHighlight .hl-row:has(> input[type="range"])';
  assert.ok(page.includes(scoped + ' > span:first-child { flex: 0 0 108px; }'), 'the label has no basis');
  assert.ok(page.includes(scoped + ' > .hl-hex { flex: 0 0 80px; text-align: right; }'), 'the value chip has no basis');
  assert.match(page, new RegExp(scoped.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' > input\\[type="range"\\] \\{ flex: 1 1 auto'),
    'the slider does not take the remainder');
  // Scoped to the slider rows: the colour rows are a different shape (label,
  // hex, swatch; 46px tall against 22) and must be left alone. Measured
  // unchanged at 46px after.
  assert.ok(!/#studioHighlight \.hl-row > \.hl-hex \{ flex: 0 0/.test(page),
    'an unscoped rule would restyle the colour rows too');
});

test('the plan note keeps its line in every card', () => {
  // `display: none` took the note's height out of one card only, and the
  // button is bottom-anchored -- so that card's call-to-action sat 30.79px
  // above the others with all three cards the same height. Live in production:
  // Studio has no Stripe prices, so its column says "Opening soon".
  const src = adapterSrc.slice(adapterSrc.indexOf("foot: unconfigured ?"));
  const block = src.slice(0, src.indexOf('cardStyle:'));
  assert.ok(!/footStyle:[^\n]*display: none/.test(block), 'the note is hidden with display:none again');
  assert.match(block, /visibility: hidden/, 'the note must reserve its line, not vanish');
  assert.match(block, /\\u00a0/, 'an empty note needs a line box to reserve');
});

test('the plan CTA is still bottom-anchored', () => {
  // The whole fault only shows because the button is anchored; if that ever
  // goes, the note fix is measuring nothing.
  assert.match(adapterSrc, /btnStyle: 'margin-top: auto;/, 'the CTA is no longer bottom-anchored');
});

// ── Overlap: four faults where one thing was drawn over another ───────────

const notifyCss = fs.readFileSync(path.join(root, 'src/public/studio-notify.css'), 'utf8');

test('a host panel is swept by its OWN marker, never by the card', () => {
  // patch() pairs a container's children by index and skips data-host-owned
  // ones; syncAttributes strips any attribute the new render does not carry.
  // So Review queue -> Lecture library paired a clip <article> against a
  // lecture <article>, took data-clip off it, and left the star inside -- and
  // a loop over `[data-clip]` could never see it again. Measured: four lecture
  // cards each carrying a stranded star and a Posts-to row, +68px of card
  // height, with the star still bound to the QUEUE clip's id and clickable.
  // After: 0 stranded on every navigation path.
  assert.match(page, /querySelectorAll\('#studio \[data-dc-star\], #dcMobile \[data-dc-star\]'\)/,
    'paintClipStars does not sweep by its own marker');
  assert.match(page, /querySelectorAll\('#studio \[data-dc-dest\], #dcMobile \[data-dc-dest\]'\)/,
    'paintClipDestinations does not sweep by its own marker');
});

test('the star carries the clip id it was built for', () => {
  // Without this a node reused across two real clip cards keeps the first
  // clip's closure -- the same fault with a worse outcome.
  assert.match(page, /star\.setAttribute\('data-dc-star', id\)/,
    'the star is stamped with an empty value again');
  assert.match(page, /getAttribute\('data-clip'\) !== n\.getAttribute\('data-dc-star'\)/,
    'the sweep does not compare the star against its card');
});

test('the deck states where a clip posts, outside the 9:16 stage', () => {
  // The deck card is a fixed stage with overflow:hidden and the video is
  // mounted into it absolutely at z-index 1, so a statically-positioned row
  // appended there was painted behind the video: covering fraction 1.00, and
  // it was the ONLY such row on the screen. It goes in the info column now.
  assert.match(page, /card\.hasAttribute\('data-deck-card'\)/, 'the deck card is not distinguished');
  assert.match(page, /document\.querySelector\('#studio \[data-deck-info\]'\)/,
    'the deck has no info-column mount');
  assert.match(page, /mount\.appendChild\(row\)/, 'the row is still appended to the card');
  // The hook lives in the design export; the re-import was proven byte-stable.
  const design = fs.readFileSync(path.join(root, 'design/studio-dashboard.dc.html'), 'utf8');
  assert.match(design, /<div data-deck-info="1"/, 'the export lost the deck-info hook');
});

test('the page is told the live bar is there', () => {
  // #studioLiveBar is fixed at bottom:18px with z-index 150 and nothing
  // reserved space for it, so a control whose centre fell in its band got no
  // clicks -- they went to the bar. Measured covered-not-clipped controls:
  // 3 on the queue at 1280 and 1 on the library at 1100, 0 at 1440. After the
  // allowance: 0 at all three widths.
  assert.match(page, /classList\.toggle\('dc-livebar',barUp\)/,
    'the body class is not stamped with the bar');
  assert.match(tokens, /body\.dc-livebar #studio main \{ padding-bottom: 92px; \}/,
    'nothing reserves the bar\'s band');
});

test('a confirmation that leaves by itself does not swallow a click', () => {
  // The dock sits above everything and each card takes pointer events back so
  // it can be hovered (pausing its countdown) and dismissed. Measured: a real
  // click on Home's "Schedule" link was dispatched to the toast and the screen
  // did not change, for the whole 4.2s. After: the link is topmost and the
  // click navigates. `bad` (7s) and `work` (sticky) keep both, because those
  // are the two where losing hover-pause would matter.
  assert.match(notifyCss, /\.dcn\.dcn-good, \.dcn\.dcn-on, \.dcn\.dcn-off, \.dcn\.dcn-info \{ pointer-events: none; \}/,
    'transient confirmations still take pointer events');
  assert.ok(!/\.dcn-work[^{]*\{[^}]*pointer-events:\s*none/.test(notifyCss),
    'a sticky work card must stay dismissible');
  assert.ok(!/\.dcn-bad[^{]*\{[^}]*pointer-events:\s*none/.test(notifyCss),
    'an error card must stay dismissible');
});

// ── Overflow: five faults where content was drawn and then hidden ─────────

test('the Templates lock always holds side by side, and the FRAME gives way, never the page', () => {
  // v3.126.0 gated the lock on `row.scrollHeight <= scroller.clientHeight`,
  // measured BEFORE the lock -- when the settings column stands at its full
  // ~1800px -- so the gate was false at every desktop size and the lock never
  // applied again. Measured 5 Sept 2026 at 1440x900 and 1920x1080 with nothing
  // running: row 1872px against a scroller of 832 / 1012, `fits` false, the
  // whole page scrolling. Youssef: "LEFT SIDE ONLY SHOULD BE SCROLLABLE NOT
  // WHOLE PAGE." The column that has to stay whole is the PREVIEW column, and
  // it is the frame that shrinks to make it fit; below FRAME_MIN_HEIGHT the
  // preview column scrolls itself. The page never scrolls as one while the
  // columns sit side by side.
  const fn = page.slice(page.indexOf('function paintTemplatesLayout()'));
  const body = fn.slice(0, fn.indexOf('\n    }\n'));
  assert.match(body, /const sideBySide=/, 'nothing checks the columns are still side by side');
  assert.match(body, /if\(!sideBySide\)\{clearTemplatesLayout\(\);return\}/, 'stacked columns still let the page scroll');
  assert.ok(!/row\.scrollHeight<=scroller\.clientHeight/.test(body),
    'the pre-lock row-height gate is back, and it is false on every desktop size');
  // Measured AFTER the lock is applied: the preview column against the
  // scroller's foot.
  const lock = body.indexOf("set(settings,{'align-self':'stretch','max-height':'100%','overflow-y':'auto','min-height':'0'})");
  const fit = body.indexOf('const over=previewCol.getBoundingClientRect().bottom-limit');
  assert.ok(lock > 0 && fit > lock, 'the preview column is measured after the lock, not before');
  // Stretched, not merely capped: the card fills the row, and the preview
  // column is fitted to the ROW's content foot rather than the scroller's, so
  // the two columns end on one line (Youssef, 5 Sept 2026: "left side bar
  // should be page length").
  assert.match(body, /set\(settings,\{'align-self':'stretch','max-height':'100%','overflow-y':'auto','min-height':'0'\}\)/,
    'the settings card stretches to the row');
  assert.match(body, /const limit=row\.getBoundingClientRect\(\)\.bottom-\(parseFloat\(getComputedStyle\(row\)\.paddingBottom\)\|\|0\)/,
    'the preview column is fitted to the row, not the scroller');
  assert.match(body, /set\(frame,\{'width':Math\.floor\(height\*ratio\)\+'px'\}\)/,
    'the frame gives way in height, through its own aspect-ratio');
  assert.match(body, /if\(height>=FRAME_MIN_HEIGHT\)/, 'down to a floor');
  assert.match(body, /set\(previewCol,\{'max-height':'100%','overflow-y':'auto','min-height':'0'\}\)/,
    'and past the floor the preview column scrolls itself rather than the page');
  assert.match(page, /const FRAME_MIN_HEIGHT=300;/);
  // A resize changes the answer and does not repaint the studio.
  assert.match(page, /addEventListener\('resize',\(\)=>\{ if\(window\.paintTemplatesLayoutNow\)/,
    'the lock is not re-evaluated on resize');
});

test('a notification title wraps rather than losing its second half', () => {
  // toast() puts the WHOLE message in the title slot and leaves the detail
  // line empty, so one nowrap line cut every message past ~45 characters --
  // and the tail is reliably the actionable half. Measured on the app's own
  // strings: 57%, 59% and 68% shown, at 1440, 1024 and 900 alike.
  const rule = notifyCss.slice(notifyCss.indexOf('.dcn-copy strong {'));
  const body = rule.slice(0, rule.indexOf('}'));
  assert.ok(!/white-space:\s*nowrap/.test(body), 'the title is nowrap again');
  assert.match(body, /-webkit-line-clamp:\s*3/, 'the title has no wrap allowance');
});

test('a month cell is tall enough for the chips it chooses to draw', () => {
  // The cell picks its chips from the ITEM COUNT and had a flat 62px floor,
  // so wherever the week row collapsed (below 1246px, where the schedule's
  // side column wraps) the second chip was cut through the middle and the
  // "+N more" line was drawn entirely below the border under overflow:hidden.
  // 89px is what the content measures; it changes nothing at 1440.
  assert.match(adapterSrc, /min-height: 89px; padding: 5px 7px 6px;/,
    'the month cell floor is back below what its content needs');
  // The count is the thing that must never be hidden.
  assert.match(adapterSrc, /moreLabel: items\.length > 3 \? '\+' \+ \(items\.length - 2\) \+ ' more' : ''/);
});

test('a calendar chip says which clip it is', () => {
  // The time and the title shared one ellipsis and the time always won: a
  // 26-character title showed 9 characters at 1440, 3 at 1280 and ONE at 900,
  // with no title or aria-label anywhere from the span up to #studio. Two
  // clips from the same lecture were indistinguishable on the one screen
  // whose job is to say which clip goes out when.
  assert.match(adapterSrc, /time: timeOf\(c\.scheduledAt\),/, 'the time is not its own cell');
  assert.match(adapterSrc, /tip: timeOf\(c\.scheduledAt\) \+ ' \\u2014 ' \+ String\(c\.title \|\| 'Clip'\)/,
    'the chip carries no full label for hover');
  assert.ok(!/label: timeOf\(c\.scheduledAt\) \+ '  ' \+ String\(c\.title/.test(adapterSrc),
    'the time is glued back into the ellipsised label');
  // Only the TITLE may ellipsise, so the time cannot eat its width. Asserted in
  // two halves: this style is built from two string literals joined with `+`,
  // and a regex spanning both fails against correct code -- the straddling-
  // literal trap this repo has recorded before.
  assert.match(adapterSrc, /style: 'flex: 1 1 auto; min-width: 0; font-size: 10\.5px/,
    'the title span has no flex basis, so the time competes with it again');
  assert.match(adapterSrc, /' white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',\n {16}\};/,
    'the title no longer ellipsises');
  // The tooltip needs the attribute in the export; the re-import was proven
  // byte-stable (generated CSS identical, no hashed class moved).
  const design = fs.readFileSync(path.join(root, 'design/studio-dashboard.dc.html'), 'utf8');
  assert.match(design, /<span title="\{\{ chip\.tip \}\}" style="\{\{ chip\.rowStyle \}\}">/,
    'the export lost the chip tooltip');
});

test('the search gives way before the screen\'s own subtitle does', () => {
  // It was `flex: 0 0 300px` -- rigid -- so the heading block absorbed the
  // whole shortfall and the subtitle took it: 22% shown at 981px, and nine of
  // thirteen screens losing part of theirs at 1024. One pixel narrower the
  // field hides outright and every subtitle comes back whole, which is what
  // showed the field was the cause. Measured after: help 30% -> 61% at 1024
  // and 49% -> 72% at 1100, with 1440 unchanged at 100%.
  assert.match(page, /#dcSearchBox \{ flex: 0 1 300px; min-width: 150px; margin-left: auto; \}/,
    'the search is rigid again, so the copy pays for it');
});
