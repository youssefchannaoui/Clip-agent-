import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * THE LIVE BAR'S TWO CONTROLS WERE UNDER THE 44px FLOOR.
 *
 * Measured at 375px: the text buttons 81x28 and the collapse icon 22x22, on a
 * bar that FLOATS OVER THE CONTENT and whose icon is the only way to get it out
 * of the way. v3.126.1 settled both the rule and its trap in one line: A
 * CONTROL THAT MEASURES 40px IS NOT A 44px TARGET WHATEVER ITS HIT AREA IS,
 * because an audit measures the ELEMENT's rect -- so widening the hit region
 * with a pseudo-element is not an answer.
 *
 * Measured after, at 375px, injecting the bar's own markup against the real
 * sheet: every control 44px, the pill no longer taller than the open bar
 * (63 -> 57), no page overflow. At 1440 the buttons are 81.4x27.6 and the icon
 * 22x22 -- byte-identical behaviour, with the ::before's `content` computing to
 * `none`, so the pseudo-element is not created off the phone at all.
 *
 * A SOURCE TEST, deliberately, and for the reason `rail-nav` and the
 * overflow-anchor test are: CI has no browser, and this is exactly the shape
 * that is invisible when it goes -- the app renders, the suite stays green, and
 * the controls quietly go back to being too small to hit.
 */

const ROOT = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const html = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8');
/** Comments quote the old sizes and the old selectors; matching them would
 *  pass on the explanation rather than the rule. Eleventh time in this repo. */
const css = html.replace(/\/\*[\s\S]*?\*\//g, '');

/** The phone block that carries the 44px floor. */
function phoneBlock() {
  const at = css.indexOf('.slb-btn, .slb-icon {');
  assert.ok(at > 0, 'the live bar must still give its controls a phone treatment');
  const open = css.lastIndexOf('@media', at);
  const query = css.slice(open, css.indexOf('{', open));
  assert.match(query, /max-width:\s*820px/,
    'it must live inside the phone query -- a 44px row on the desktop bar would make it a slab');
  // Brace-match from the query's own opening brace.
  let i = css.indexOf('{', open), depth = 0;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') { depth -= 1; if (!depth) return { start: open, end: i + 1, body: css.slice(open, i + 1) }; }
  }
  throw new Error('unterminated phone block');
}

test('both controls are given a 44px floor', () => {
  const { body } = phoneBlock();
  assert.match(body, /\.slb-btn,\s*\.slb-icon\s*\{[^}]*min-height:\s*44px/,
    'the text button and the icon share the floor');
  assert.match(body, /\.slb-icon\s*\{[^}]*width:\s*44px/,
    'and the icon needs a WIDTH too -- a 22px-wide button is not a target because it is 44 tall');
});

test('it still DRAWS the small box, so the bar is not a slab of buttons', () => {
  const { body } = phoneBlock();
  assert.match(body, /\.slb-btn,\s*\.slb-icon\s*\{[^}]*border:\s*0/, 'the button paints nothing itself');
  assert.match(body, /\.slb-btn::before,\s*\.slb-icon::before\s*\{[^}]*content:\s*''/,
    'a ::before draws the box it used to be');
  assert.match(body, /\.slb-btn::before\s*\{\s*inset:\s*8px 0/, 'the pill, where it was');
  assert.match(body, /\.slb-icon::before\s*\{\s*inset:\s*11px/, 'the square, where it was');
});

test('THE BLOCK IS DECLARED AFTER THE RULES IT OVERRIDES', () => {
  /*
   * The property that broke this twice while it looked written. `.slb-btn` and
   * `.slb-icon` are plain class selectors, so at equal specificity DOCUMENT
   * ORDER decides -- written above them the override lost and the icon measured
   * 22 wide with a 44 height. HALF-APPLIED IS WORSE THAN NOT APPLIED, because
   * the height looks right and only a width measurement finds it.
   *
   * `#studioLiveBar.slb-min .slb-head` is (1,2,0) and beats any reasonable
   * id-scoping of the same rule, so escalating specificity could not win it
   * either. Order is the fix, and this is what holds it there.
   */
  const { start } = phoneBlock();
  for (const base of [
    '.slb-btn { flex: none;',
    '.slb-icon { flex: none;',
    '.slb-head { display: flex;',
    '#studioLiveBar.slb-min .slb-head {',
  ]) {
    const at = css.indexOf(base);
    assert.ok(at > 0, `${base} must still exist`);
    assert.ok(at < start,
      `${base} is declared AFTER the phone override, so the override silently loses on document order`);
  }
});

test('the collapsed pill is not left taller than the open bar', () => {
  /*
   * #slbMin is deliberately NOT in the slb-min display:none list -- it is the
   * way back. So the pill carries a 44px control now, and inside its own 7px
   * padding that measured 63px against the open bar's 57: the "minimised"
   * state, bigger than the thing it minimises.
   */
  const { body } = phoneBlock();
  const rule = body.match(/#studioLiveBar\.slb-min \.slb-head \{ padding: ([^;]+);/);
  assert.ok(rule, 'the pill must take back the room the bigger button costs');
  const top = Number(rule[1].trim().split(/\s+/)[0].replace('px', ''));
  const openTop = Number(body.match(/\.slb-head \{ padding: (\d+)px/)[1]);
  assert.ok(top <= openTop,
    `the pill's padding (${top}px) must not exceed the open head's (${openTop}px), or it ends up the taller of the two`);

  // And the premise: it is genuinely still drawn there.
  assert.doesNotMatch(
    css.match(/#studioLiveBar\.slb-min \.slb-list[^}]*\{[^}]*\}/)[0],
    /#slbMin/,
    'if #slbMin is ever hidden in the pill, there is no way to expand it again',
  );
});
