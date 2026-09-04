import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * The topbar.
 *
 * Youssef, 3 Sept 2026, looking at the live header: "rearrange, make it look
 * cleaner, idk something's missing."
 *
 * Two of the three faults were silent. The avatar and the name in the account
 * dropdown were LITERALS in the design export -- "YC" and "Youssef Channaoui"
 * -- so every customer was shown the operator's identity on their own account
 * and nothing anywhere would have complained. And the plan was named NOWHERE
 * in the app's chrome: the rail badge that carried it was removed in v3.73.1
 * and the token chip counts tokens, which is a different question.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const design = fs.readFileSync(path.join(root, 'design/studio-dashboard.dc.html'), 'utf8');
const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');

function adapter() {
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
  vm.runInContext(adapterSource, sandbox);
  return sandbox.StudioAdapter;
}

const bind = user => adapter().bindings({ user, clips: [], projects: [], billing: {} });

test('the account wears its own identity, not the operator’s', () => {
  assert.ok(!design.includes('Youssef Channaoui'),
    'a hardcoded name in the export is shown to every customer');
  assert.ok(!/>YC<\/span>/.test(design),
    'hardcoded initials are shown to every customer');
  assert.ok(design.includes('{{ accountInitials }}'), 'the avatar is bound');
  assert.equal((design.match(/\{\{ accountInitials \}\}/g) || []).length, 2,
    'both avatars — the button and the dropdown — are bound');
  assert.ok(design.includes('{{ accountName }}'), 'the name is bound');
  const overrides = JSON.parse(fs.readFileSync(path.join(root, 'design/text-overrides.json'), 'utf8'));
  assert.ok(!('Youssef Channaoui' in overrides.overrides),
    'the name is a real binding now, so the patch over it is retired');
});

test('a name is derived when the record has none', () => {
  assert.equal(bind({ name: 'Aisha Rahman', email: 'a@b.com' }).accountName, 'Aisha Rahman');
  assert.equal(bind({ name: 'Aisha Rahman', email: 'a@b.com' }).accountInitials, 'AR');
  // No name: the local part of the email is still a handle, and it fits. An
  // email truncated to "youssefchannaoui05@gm..." spends the width and says
  // nothing.
  assert.equal(bind({ email: 'youssefchannaoui05@gmail.com' }).accountName, 'youssefchannaoui05');
  assert.equal(bind({ name: 'Bilal', email: 'b@c.com' }).accountInitials, 'B');
  assert.equal(bind({}).accountName, 'Account');
  assert.equal(bind({}).accountInitials, 'A');
});

test('the plan is named in the topbar, and Basic does not wear the gold', () => {
  assert.ok(/function paintPlanChip\(/.test(host), 'the chip has a painter');
  // Host panels belong in paintStudio's list, never on a MutationObserver --
  // the lesson v3.53.5 paid three attempts for.
  assert.ok(host.includes('paintPlanChip((DATA.billing&&DATA.billing.current)||{})'),
    'the chip is repainted with the rest of the studio');
  assert.ok(host.includes("#dcTokenChip[data-paid=\"0\"]"),
    'Basic is styled apart from the paid tiers');
  // ONE pill, not two. Youssef, 3 Sept 2026: "make subscription name with the
  // other pill, too many pills." A separate #dcPlanChip is the older shape and
  // must not come back beside this one.
  assert.ok(!/id='dcPlanChip'|id="dcPlanChip"/.test(host),
    'the plan rides in the token pill, it does not get one of its own');
  assert.ok(!design.includes('tokens · {{ currentPlan }}'),
    'a coin and a number need no label — the pill carries the plan instead');
  // An operator's plan name IS "Unlimited", and the token chip beside it
  // already says so. The Account panel shipped that duplication once.
  assert.ok(host.includes("if(cur.unlimited)name='Owner'"),
    'the operator is not told "Unlimited · Unlimited"');
});

test('the topbar row shares one height and the search does not follow the heading', () => {
  // Measured before this change at 1440x950: five controls at five heights
  // (33/26/29/32/35), and a search that started at x=379 on Performance and
  // x=597 on Help.
  assert.ok(host.includes('#dcTopbar > label, #dcTopbar > button, #dcTopbar > div > button { height: 34px'),
    'one height for the whole control row');
  // THE PROPERTY IS `margin-left: auto` AND THE 300px BASIS, not the shrink
  // factor. This pinned the whole declaration and went red on 4 Sept 2026 when
  // the basis was made shrinkable -- because rigid at 300px, the heading block
  // absorbed every pixel of a narrow desktop and the screen's own subtitle was
  // cut to 22% of itself at 981px (nine of thirteen screens lost part of theirs
  // at 1024). That copy is the app explaining itself, so it gives way LAST.
  // What this test exists for is unaffected and was re-measured across all ten
  // screens: travel at 1440 is 0px with the field at 300px on every one of
  // them, and 28px at 1280 against the 26px v3.94.0 recorded. Below that the
  // field does move -- the deliberate trade, and the alternative is destroying
  // the sentence.
  assert.ok(host.includes('#dcSearchBox { flex: 0 1 300px; min-width: 150px; margin-left: auto; }'),
    'the search hangs off the right cluster, not the heading, and yields before the copy');
  assert.ok(/#dcTopbar > button, #dcTopbar > div:not\(:first-child\) \{ flex: none/.test(host),
    'only the heading gives way, or the chips wrap inside their pills');
});
