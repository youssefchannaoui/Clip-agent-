import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * A CLICK INSIDE A DIALOG IS NOT A CLICK ON THE DIALOG.
 *
 * Youssef, 4 Sept 2026, on the clip preview: "when i click any text box to type
 * it closes the screen."
 *
 * Four overlays in the design are a fixed backdrop carrying `onClick=close*`
 * with a card sitting inside it, and NO card stopped the bubble -- so every
 * click on a card's own contents closed it. That was invisible while a card
 * held nothing but a title and a picture; the moment the clip preview grew text
 * fields (v3.121.0) it meant the title could not be typed into at all. The
 * buttons in that panel went on working, which is what disguised it: the host's
 * own handler calls stopPropagation for `button[data-ct]` and returns BEFORE
 * doing so for anything else.
 *
 * THE FIX IS BOUND TO THE CARD, not written as a stopPropagation in the host.
 * Events are DELEGATED from the studio mount (studio-runtime `bind`), so a
 * stopPropagation below the root kills the delegated dispatch outright -- and
 * the close button lives inside the card. `dispatch` walks up from the target
 * and returns at the FIRST element carrying a handler, so the x fires and stops
 * the walk, and anything else in the card lands on `swallowClick` and goes no
 * further.
 *
 * Asserted against the GENERATED TEMPLATE rather than the design source: that
 * is the tree the runtime actually renders, and a re-import that dropped the
 * attribute would leave the source looking right.
 */

await import('../src/public/studio-runtime.js');
await import('../src/public/studio-template.generated.js');
await import('../src/public/studio-adapter.js');
const { STUDIO_TEMPLATE, StudioAdapter } = globalThis;

/** Every element node in the template, depth first. */
function* walk(node) {
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  if (!node || typeof node !== 'object') return;
  if (node.t === 'el') yield node;
  // Every nested container, whatever the node kind calls it -- `a`, `st` and
  // `on` hold attributes and bindings rather than children.
  for (const key of Object.keys(node)) {
    if (key === 'a' || key === 'st' || key === 'on') continue;
    if (node[key] && typeof node[key] === 'object') yield* walk(node[key]);
  }
}

const clickBinding = node => (node.on && node.on.click && node.on.click.p) || '';

/*
 * The importer HOISTS inline styles into hashed classes, and those renumber on
 * every re-import -- so a scrim cannot be found by naming `.skt`, and cannot be
 * found by reading a style attribute either, because there is none left. It is
 * RESOLVED instead: the class is looked up in the generated sheet and asked
 * whether it paints a full-viewport layer. That survives a re-import, which
 * naming the class would not.
 */
const sheet = fs.readFileSync(
  path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'src/public/studio-styles.generated.css'), 'utf8');
const rulesFor = node => {
  const classes = String((node.a && node.a.class) || '').split(/\s+/).filter(Boolean);
  return classes.map(name => (sheet.match(new RegExp(`\\.${name}\\{([^}]*)\\}`)) || [])[1] || '').join(';');
};
const isFullViewport = node => /position:\s*fixed;\s*inset:\s*0/.test(rulesFor(node));

/** The full-viewport scrims that close on their own click. */
const backdrops = [...walk(STUDIO_TEMPLATE)].filter(node =>
  /^close/.test(clickBinding(node)) && isFullViewport(node));

test('every closing backdrop is a known one, so a new dialog cannot slip past this', () => {
  const names = backdrops.map(clickBinding).sort();
  assert.deepEqual(names, ['closeActivityDetail', 'closeConn', 'closePlayer', 'closeSheet'],
    'a backdrop that closes on click must have a card that does not -- add it below');
});

test('each one holds a card that swallows the click', () => {
  for (const backdrop of backdrops) {
    const card = (backdrop.ch || []).find(child => child && child.t === 'el');
    assert.ok(card, `${clickBinding(backdrop)} has no card element`);
    assert.equal(clickBinding(card), 'swallowClick',
      `a click inside ${clickBinding(backdrop)}'s card still closes it`);
  }
});

test('the binding exists and does nothing at all', () => {
  // Its whole job is to be FOUND by the delegated walk so the walk stops. It
  // must not preventDefault: an input inside the card has to take focus, and
  // the runtime only preventDefaults for an <a href="#">.
  const vals = StudioAdapter.bindings({
    user: { email: 'a@b.c' }, projects: [], clips: [], tracks: [],
    social: { providers: {} }, billing: { current: {} },
  });
  assert.equal(typeof vals.swallowClick, 'function');
  const calls = [];
  const fake = { preventDefault: () => calls.push('preventDefault'), stopPropagation: () => calls.push('stopPropagation') };
  assert.equal(vals.swallowClick(fake), undefined);
  assert.deepEqual(calls, [], 'it neither cancels the event nor stops the bubble');
});

test('the close button is inside the card and still reaches its own handler', () => {
  // The walk returns at the FIRST handler it meets, so a descendant with its
  // own binding fires and the card's is never consulted. If the x ever moved
  // OUTSIDE the card it would be sitting on the backdrop, and the swallow
  // would be the only thing between a stray click and a lost dialog.
  const player = backdrops.find(b => clickBinding(b) === 'closePlayer');
  const card = (player.ch || []).find(child => child && child.t === 'el');
  const closers = [...walk(card)].filter(n => clickBinding(n) === 'closePlayer');
  assert.equal(closers.length, 1, 'exactly one close control, and it is in the card');
  assert.equal(closers[0].tag, 'button');
});
