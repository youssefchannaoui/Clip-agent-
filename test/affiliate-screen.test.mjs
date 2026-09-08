import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

/**
 * Affiliate is a screen in the rail, not a panel under the plan cards.
 *
 * Youssef, 8 Sept 2026: "no make affilate on the side bar ... add instructons
 * and all that good stuff". It used to be a host panel two thirds of the way
 * down Tokens & billing -- a screen people open to check a balance -- so the
 * one place this product asks a creator to go and EARN was reachable only by
 * scrolling past six plan cards.
 *
 * Everything guarded here fails SILENTLY: the app renders, every other test
 * stays green, and the only symptom is a rail item that leads nowhere, a
 * header reading "Studio", a second application form, or a tab bar with six
 * tabs on a 375px phone.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'src/public/studio-adapter.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'src/public/index.html'), 'utf8');

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

const base = {
  clips: [], projects: [],
  user: { role: 'creator', email: 'someone@deenclipped.test' },
  billing: { current: { plan: 'pro_monthly' } },
};
const railOf = data => {
  A.ui.screen = 'home';
  A.ui.railOpen = true;
  // Array.from, because the adapter runs in a vm realm and its arrays are that
  // realm's Array -- strict deepEqual rejects them on the prototype.
  return Array.from(A.bindings(data).navSetup, i => ({
    key: String(i.key), label: String(i.label), mobileClass: String(i.mobileClass || ''),
  }));
};

test('the rail carries Affiliate wherever the programme is open', () => {
  const on = railOf({ ...base, affiliates: { enabled: true } });
  const item = on.find(i => i.key === 'affiliate');
  assert.ok(item, 'no Affiliate item in the rail');
  assert.equal(item.label, 'Affiliate');
  assert.deepEqual(on.map(i => i.key), ['templates', 'music', 'deenai', 'affiliate', 'help'],
    'it joins the tail cluster -- earning is not a step in the working loop');
});

test('and never where there is no programme to apply to', () => {
  // AFFILIATES_ENABLED=false, or a commission of 0%, means there is nothing
  // behind the item. A control that leads to a screen saying "not open yet" is
  // a control that does nothing.
  for (const data of [base, { ...base, affiliates: { enabled: false } }, { ...base, affiliates: {} }]) {
    assert.equal(railOf(data).some(i => i.key === 'affiliate'), false,
      'the rail offers a programme this deployment does not run');
  }
});

test('the flag comes from the server, not from the screen own fetch', () => {
  // The RAIL has to decide on its FIRST paint. Reading it from /api/affiliate
  // would flash the item in a moment after every reload -- and it is the same
  // answer publicView() gives, from the same two config values, so the rail
  // and the screen cannot disagree about whether there is a programme.
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  assert.match(server, /affiliates: \{\s*enabled: Boolean\(config\.affiliatesEnabled\) && Number\(config\.affiliateCommissionPercent\) > 0,/,
    '/api/state does not carry whether the programme is open');
  assert.match(source, /function affiliatesOn\(DATA\)[\s\S]{0,200}affiliates \|\| \{\}\)\.enabled/,
    'the adapter derives the flag itself instead of reading the payload');
});

test('the header names the screen rather than falling through to "Studio"', () => {
  // The lecture detail screen shipped for weeks titled "Studio" for want of
  // exactly this entry, and nothing but a test says so.
  A.ui.screen = 'affiliate';
  const b = A.bindings({ ...base, affiliates: { enabled: true } });
  assert.equal(String(b.pageTitle), 'Affiliate');
  assert.ok(String(b.subline).length > 0, 'and says what the screen is for');
  A.ui.screen = 'home';
});

test('it stays out of the phone tab bar, which fits five', () => {
  const item = railOf({ ...base, affiliates: { enabled: true } }).find(i => i.key === 'affiliate');
  assert.match(item.mobileClass, /dc-nav-secondary/,
    'a sixth tab runs off the right edge of a 375px screen');
  assert.doesNotMatch(item.mobileClass, /dc-nav-primary/);
  // And the phone must not claim the screen: it frames the desktop one, like
  // Help and Owner, so there is only ever one copy to keep in step.
  const mobile = fs.readFileSync(path.join(root, 'src/public/studio-mobile.js'), 'utf8');
  const owned = mobile.slice(mobile.indexOf('var OWNED'), mobile.indexOf('\n', mobile.indexOf('var OWNED')));
  assert.ok(!owned.includes('affiliate'));
});

test('the Tokens & billing panel is retired, so there is one place to apply', () => {
  // Two controls for one thing is the fault this codebase has shipped four
  // times, and a second application form is the worst shape of it: somebody
  // could apply twice and be told their own application was already in.
  assert.ok(!/const paintAffiliate=async/.test(host),
    'the old panel painter is still here');
  assert.ok(!/getElementById\('dcAffiliate'\)/.test(host),
    'something still looks for the retired panel');
  assert.ok(host.includes('const paintAffiliateScreen='), 'the screen painter is gone');
});

test('the screen is host-rendered, marked, and painted with every other panel', () => {
  const at = host.indexOf('const paintAffiliateScreen=');
  const body = host.slice(at, host.indexOf('window.dcPaintAffiliateScreen=', at));
  assert.match(body, /data-host-owned/,
    'an unmarked host node is paired against a generated sibling by the patcher');
  assert.match(body, /window\.dcSetHtml\(el,/,
    'a bare innerHTML per poll rebuilds the form under whoever is typing in it');
  assert.match(body, /StudioAdapter\.ui\.screen==='affiliate'/, 'it is gated on its own screen');
  assert.doesNotMatch(body, /\.s[0-9][0-9a-z]{0,2}\b/,
    'the painter names a generated class, which a design re-import renumbers');
  // In paintStudio's list, never on an observer -- the lesson v3.53.5 paid
  // three attempts for. Sliced to paintStudio's own body: the call also exists
  // at the window pin, so a bare search passes with the registration deleted.
  const ps = host.indexOf('function paintStudio(');
  assert.ok(ps > 0);
  const psBody = host.slice(ps, host.indexOf('\nfunction ', ps + 10));
  assert.match(psBody, /dcPaintAffiliateScreen/, 'the screen is not in paintStudio\'s list');
});

test('the instructions quote the terms the server sent, never a typed number', () => {
  // A rate changed on Render must not leave this screen promising the old one
  // -- the public /affiliates page reads the same config values, and the two
  // saying different things about somebody's commission is the worst copy
  // fault this feature can have.
  const at = host.indexOf('const affSideHtml=');
  assert.ok(at > 0, 'the instructions are gone');
  const body = host.slice(at, host.indexOf('const paintAffiliateScreen=', at));
  // Every term, INCLUDING the minimum payout: it is stated on the plate now,
  // and before v3.170.0 it was on no screen at all though no balance is paid
  // until it clears one.
  for (const field of ['t.percent', 't.months', 't.cookieDays', 't.holdDays', 't.minimumMinor']) {
    assert.ok(body.includes(field), `the instructions do not read ${field} from the terms`);
  }
  // The three things somebody needs to be told, and the rules every serious
  // programme forbids. The two rule lists are pinned by their CLASSES rather
  // than by their headings -- a heading is a word somebody will reword, and
  // what has to survive is that both lists are still there and still read as
  // earns/does-not.
  for (const phrase of ['How it works', 'Getting paid', 'coupon sites', 'refer myself']) {
    assert.ok(host.includes(phrase), `the instructions no longer say "${phrase}"`);
  }
  assert.match(body, /dcaf-list dcaf-yes/, 'the list of what earns commission is gone');
  assert.match(body, /dcaf-list dcaf-no/, 'the list of what does not is gone');
  assert.doesNotMatch(body, /\b25\s*%/, 'the commission is typed into the copy instead of read');
});

test('the sheet is served, linked, and themed for daylight', () => {
  const server = fs.readFileSync(path.join(root, 'src/server.js'), 'utf8');
  assert.match(server, /'\/studio-affiliate\.css'/, 'the sheet is not allowlisted, so it 404s silently');
  assert.match(host, /<link rel="stylesheet" href="\/studio-affiliate\.css">/, 'nothing links it');
  const gen = fs.readFileSync(path.join(root, 'scripts/build-light-theme.mjs'), 'utf8');
  assert.match(gen, /studio-affiliate\.css/,
    'left out of the generator, the whole screen stays night on a paper theme');
  const light = fs.readFileSync(path.join(root, 'src/public/studio-light.generated.css'), 'utf8');
  // A dcaf- rule, not #dcAffScreen: the generator re-emits only what names a
  // colour, and the screen root sets layout alone. Asserting on the root is
  // how this test failed against a correctly generated sheet.
  assert.match(light, /body\.dc-light \.dcaf-/, 'the generated daylight sheet has not been re-run');
});

/* ───────────────────────────────────────────────────────────────────────────
 * v3.170.0: the screen has a SPINE, and the reference is not a card.
 *
 * Youssef, 8 Sept 2026, looking at it: "these boxes and weird, like, ugly
 * looking ... It looks so dull, ugly, AI looking. Like, it's horrible these
 * pages." Measured at 1440x950 before anything moved: FIVE stacked sections,
 * FOUR of them byte-identical -- #17171A ground, 1px #26262A border, 14px
 * radius, 18px 20px padding, every one running the full 232..1414 -- so
 * "Getting paid", which is reference prose nobody reads twice, carried exactly
 * the weight of the one thing on the screen you can DO.
 *
 * Every assertion below fails SILENTLY: re-flatten this into a stack and the
 * app renders, every other test stays green, and the only symptom is a screen
 * that reads as generic again.
 * ------------------------------------------------------------------------ */

const affPaint = (() => {
  const at = host.indexOf('const paintAffiliateScreen=');
  return host.slice(at, host.indexOf('window.dcPaintAffiliateScreen=', at));
})();
const affSheet = fs.readFileSync(path.join(root, 'src/public/studio-affiliate.css'), 'utf8');
const affRules = affSheet.replace(/\/\*[\s\S]*?\*\//g, '');

test('one lit stage over two columns, never a stack of equal cards', () => {
  assert.match(affPaint, /<header class="dcaf-stage">/, 'the stage is gone');
  assert.match(affPaint, /class="dcaf-cols/, 'the two-column spine is gone');
  // The working column and the reference column are different KINDS, which is
  // the whole fix: cards are what you act on, the reference is a column.
  assert.match(affPaint, /<div class="dcaf-main">/, 'nothing carries the working column');
  // The aside is built in affSideHtml, above the painter, so it is asserted
  // against the whole file rather than the painter's own slice.
  assert.match(host, /<aside class="dcaf-side">/, 'nothing carries the reference column');
  assert.match(affRules, /@media \(min-width: 1180px\)[\s\S]*?\.dcaf-cols\s*{[^}]*grid-template-columns/,
    'the columns never go side by side, so it is a stack again');
});

test('the reference column carries no card', () => {
  // A .dcaf-card inside the aside would put "Getting paid" back on the same
  // footing as the application form -- the exact fault this was rebuilt for.
  const from = host.indexOf('const affSideHtml=');
  const side = host.slice(from, host.indexOf("</section></aside>'", from));
  assert.ok(side.length > 200, 'the reference column could not be read');
  assert.doesNotMatch(side, /dcaf-card/, 'the reference is a card again');
  assert.match(side, /class="dcaf-block"/, 'the reference blocks are gone');
  // And the blocks are separated by a hairline rather than boxed.
  assert.match(affRules, /\.dcaf-block\s*{[^}]*border-top:\s*1px/, 'the hairline between blocks is gone');
  assert.doesNotMatch(affRules, /\.dcaf-block\s*{[^}]*background:/, 'the reference grew a ground');
});

test('the four steps are a path with a rail, not four boxes in a row', () => {
  assert.match(host, /<ol class="dcaf-path">/, 'the path is gone');
  assert.match(affRules, /\.dcaf-path li::before\s*{[^}]*background:/, 'the rail between the nodes is gone');
});

test('a node centres on its title by geometry, never by a nudge', () => {
  // ONE line token is the height of the node AND the leading of the title, so
  // they start at the same y and their centres coincide by construction. A
  // margin nudge measures right on the day and drifts the moment a font size
  // moves -- the lesson --dctk-line already paid for in the task panel.
  assert.match(affRules, /--dcaf-line:\s*22px/, 'the shared line token is gone');
  const node = /\.dcaf-path b\s*{([^}]*)}/.exec(affRules);
  assert.ok(node, 'the node rule is gone');
  assert.match(node[1], /height:\s*var\(--dcaf-line\)/, 'the node no longer takes the shared line');
  assert.doesNotMatch(node[1], /margin/, 'the node is nudged instead of centred');
  const title = /\.dcaf-path strong\s*{([^}]*)}/.exec(affRules);
  assert.ok(title && /\/var\(--dcaf-line\)/.test(title[1]),
    'the title no longer takes the shared line, so the two centres can drift');
});

test('the minimum payout reaches the screen, worded as /affiliates words it', () => {
  // It was stated NOWHERE on this screen before, though no balance is paid
  // until it clears one. Two surfaces disagreeing about one number is worse
  // than either wording, so both read the same config value the same way.
  assert.match(host, /Minimum payout/, 'the floor is on no screen again');
  assert.match(host, /t\.minimumMinor/, 'the floor is typed rather than read from the terms');
  const marketing = fs.readFileSync(path.join(root, 'src/marketing.js'), 'utf8');
  assert.match(marketing, /affiliateMinimumPayoutMinor \/ 100/, 'the public page stopped quoting the floor');
});

test('the public page sends people to the screen that exists', () => {
  // The panel under the plan cards was deleted at v3.166.0, and /affiliates
  // went on telling applicants to look there -- a route into the one place
  // this product asks somebody to go and earn.
  const marketing = fs.readFileSync(path.join(root, 'src/marketing.js'), 'utf8');
  const page = marketing.slice(marketing.indexOf('export function affiliates('),
    marketing.indexOf('export function', marketing.indexOf('export function affiliates(') + 10));
  assert.doesNotMatch(page, /Tokens &amp; billing/, 'it still points at a screen with no application form on it');
  assert.match(page, /<strong>Affiliate<\/strong> screen/, 'it does not name where to apply');
});

test('the golds stay bare var(), so one value serves both themes', () => {
  // The escape hatch v3.127.0 established: build-light-theme re-emits any rule
  // holding a hex, so a gold written with a fallback is remapped and the brand
  // colour becomes two different tans. A rule with no hex in it is skipped.
  const golds = affRules.match(/var\(--dc-gold[a-z-]*[^)]*\)/g) || [];
  assert.ok(golds.length >= 4, 'the golds are gone');
  for (const g of golds) {
    assert.doesNotMatch(g, /#/, `${g} carries a hex fallback, so daylight remaps the brand colour`);
  }
});
