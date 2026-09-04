import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

/**
 * One nasheed blocks NOTHING, and the banner said it did.
 *
 * Youssef, 4 Sept 2026, on being told to upload a second one: "it shouldnt? it
 * should just be that its there to notify?" He was right, and nothing in the
 * code had ever agreed with the banner:
 *
 *   - local-engine refuses a job only with NO track ("Upload at least one
 *     nasheed first"), never with one;
 *   - `readiness()` answers `musicReady: tracks.length > 0`;
 *   - agent.js -- the scheduler and the publisher -- never reads the track
 *     count at all, so posting cannot depend on it.
 *
 * So "rotation needs two or more before automatic posting can run" described a
 * limitation that does not exist, in the app's loudest slot.
 *
 * WORSE THAN THE WORDING: it sat inside the else-if chain ABOVE the connection
 * check, so an account with one nasheed and nothing connected was told to
 * upload a second nasheed and never shown "No publishing account connected" --
 * the true and actionable one. A false alarm that masks a real one is the
 * expensive shape, and it is the one this file pins hardest.
 */

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

function bindings(over, dismissed) {
  const src = read('src/public/studio-adapter.js');
  const sandbox = {
    console, Date, Math, JSON, Intl, setTimeout, clearTimeout, isNaN, parseInt, parseFloat,
    localStorage: { getItem: k => (k === 'deenBlockerDismissed' ? (dismissed || null) : null), setItem: () => {} },
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, contains: () => false } } },
    navigator: { userAgent: '' }, location: { href: '', search: '' }, history: { replaceState() {} },
    requestAnimationFrame: fn => fn(),
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const DATA = Object.assign({
    clips: [], projects: [], music: [], tracks: [], postTimes: [],
    social: { providers: {} }, billing: { notices: [], current: {} },
    onboarding: null, user: { id: 'u1' }, templates: [], clipSettings: {},
  }, over);
  return sandbox.StudioAdapter.bindings(DATA);
}

/** The music library, in the shape /api/state actually sends. */
const nasheeds = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: 'Nasheed ' + i, url: '/m/' + i + '.mp3', ready: true }));
const connected = { providers: { youtube: { connected: true, enabled: true, accounts: [{ accountId: 'y1', name: 'Main' }] } } };

test('ONE NASHEED IS NOT A BLOCKER', () => {
  const v = bindings({ music: nasheeds(1), tracks: nasheeds(1), social: connected });
  assert.equal(v.blockerTone, 'note', 'it is a note, not a stop');
  assert.doesNotMatch(String(v.blockerText), /posting can run|cannot|needs two/i,
    'and it no longer claims anything is prevented');
});

test('AND IT NO LONGER MASKS THE CONNECTION BLOCKER', () => {
  // The case Youssef was actually in: one nasheed, nothing connected. The old
  // chain answered with the nasheed nag and never mentioned the connection.
  const v = bindings({ music: nasheeds(1), tracks: nasheeds(1), social: { providers: {} } });
  assert.equal(v.blockerTone, 'stop');
  assert.match(String(v.blockerText), /No publishing account connected/,
    'the real gap wins the slot');
});

test('no nasheed at all is still a blocker', () => {
  const v = bindings({ music: [], tracks: [], social: connected });
  assert.equal(v.blockerTone, 'stop');
  assert.match(String(v.blockerText), /No nasheed uploaded/);
});

test('the note carries its own mark, and one source feeds both surfaces', () => {
  const note = bindings({ music: nasheeds(1), tracks: nasheeds(1), social: connected });
  const stop = bindings({ music: [], tracks: [], social: connected });
  assert.match(String(note.blockerIcon), /ph-music-notes/);
  assert.match(String(stop.blockerIcon), /ph-warning-diamond/);

  // The phone binds the same two values rather than deciding again.
  const phone = read('src/public/studio-mobile.js');
  assert.match(phone, /phb\('blockerIcon'\)/, 'the phone reads the binding');
  assert.doesNotMatch(phone, /ph-fill ph-warning-diamond/,
    'and no longer hardcodes the alarm mark');
  assert.match(phone, /'data-tone': b\('blockerTone'\)/);
});

test('a note is drawn quietly on both surfaces, and every token it names exists', () => {
  for (const file of ['src/public/studio-tokens.css', 'src/public/studio-mobile.css']) {
    const css = read(file);
    const rules = css.match(/\[data-tone="note"\][^{]*\{[^}]*\}/g) || [];
    assert.ok(rules.length, `${file} styles the note tone`);
    // A var() naming a token declared nowhere fails SILENTLY and only in the
    // other theme -- the first cut of this change referenced --dcm-ink-2 and
    // --dcm-ink-3, neither of which is declared anywhere in the repo.
    const declared = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map(m => m[1]));
    for (const rule of rules) {
      for (const [, name] of rule.matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.ok(declared.has(name), `${file} names ${name}, which is declared nowhere in it`);
      }
    }
  }
});

test('nothing anywhere refuses to post over the nasheed count', () => {
  // The claim the banner made, checked against the code that would have to
  // implement it. If a real two-track rule is ever introduced this fails, and
  // it should: the copy would have to come back with it.
  assert.doesNotMatch(read('src/agent.js'), /nasheed|musicTrack/i,
    'the scheduler and publisher do not read the music library at all');
  assert.match(read('src/local-engine.js'), /musicReady: tracks\.length > 0/,
    'and one track is ready');
});

/*
 * The strip below the banner defers to it rather than repeating a line it is
 * already showing with its own button (v3.96.0). That deferral must follow the
 * STOP, not merely "a row is on screen" -- a note about rotation is not the
 * nasheed prerequisite, and letting it suppress the step's button would drop a
 * control for information nobody has to act on.
 *
 * onboarding.test.mjs used to pin this by matching `blockersOn: blockerShowing`
 * in the source. That is the source-string weakness CLAUDE.md keeps recording:
 * the two are deliberately no longer the same value, and the assertion failed
 * against correct code while proving nothing about behaviour. These drive it.
 */
const NASHEED_STEP = { at: 'create', action: 'nasheed', actionLabel: 'Add a nasheed', hint: 'Start with a nasheed.', progress: 'Step 1 of 3', show: true };

test('a real blocker still makes the strip drop its button', () => {
  const v = bindings({ music: [], tracks: [], social: connected, onboarding: NASHEED_STEP });
  assert.equal(v.blockerTone, 'stop');
  // `action` on the OUTPUT is the click handler, not the step name -- the
  // label is the string the deferral empties, and reading the wrong one made
  // these three assert a function against 'nasheed'.
  assert.equal(v.onboarding.actionLabel, '', 'the strip defers to the banner');
  assert.match(v.onboarding.hint, /notice above/);
});

test('A NOTE DOES NOT: the step keeps the button it needs', () => {
  const v = bindings({ music: nasheeds(1), tracks: nasheeds(1), social: connected, onboarding: NASHEED_STEP });
  assert.equal(v.blockerTone, 'note');
  assert.equal(v.onboarding.actionLabel, 'Add a nasheed', 'a note suppresses nothing');
  assert.equal(v.onboarding.hint, 'Start with a nasheed.', 'and does not rewrite the hint');
});

test('and dismissing a real blocker gives the step its button back', () => {
  // The banner is dismissible, so the prerequisite would otherwise be
  // unspoken anywhere. Keyed by the message, which is why the dismissal now
  // stores bannerText rather than blocker.
  const text = 'No nasheed uploaded — every clip mixes one in, so processing cannot finish without at least one.';
  const v = bindings({ music: [], tracks: [], social: connected, onboarding: NASHEED_STEP }, text);
  assert.equal(v.blockersOn, false, 'the banner is gone');
  assert.equal(v.onboarding.actionLabel, 'Add a nasheed', 'so the strip speaks for itself again');
});

test('a dismissed NOTE stays dismissed', () => {
  // The dismissal is compared against bannerText and was WRITTEN as `blocker`,
  // which is empty for a note -- so a dismissed note came straight back on the
  // next paint. Found by reading the two sides against each other.
  const text = 'Only one nasheed — every clip mixes in the same one. Add another and they rotate.';
  const v = bindings({ music: nasheeds(1), tracks: nasheeds(1), social: connected }, text);
  assert.equal(v.blockersOn, false);
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /setItem\('deenBlockerDismissed', bannerText\)/,
    'the message that was dismissed is the one that is stored');
});
