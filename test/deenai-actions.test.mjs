import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// DeenAI's cards can reach the screens they name (v3.142.1).
//
// Every insight named a screen -- "open the Review queue", "the fix is usually
// the account connection" -- and not one was clickable. "TikTok has refused 22
// posts" with nothing to press is a diagnosis with no door, and the headline
// card was the worst case: nextActionCard is built from referrals.nextStep,
// which returns the action, and DeenAI dropped it on the floor -- so the one
// card whose whole job is "do this next" was a dead end while the identical
// step is a button in the task ladder.

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-aiact-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'deenai-actions-secret-long-enough-ok';

const store = await import('../src/store.js');
const deenai = await import('../src/deenai.js');
const actions = await import('../src/deenai-actions.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

function seed() {
  const user = { id: 'u1', email: 'a@a', role: 'user', billing: { plan: 'pro_monthly' }, createdAt: Date.now() - 9e8 };
  store.state.authUsers.push(user);
  store.state.projects.push({ id: 'p1', userId: 'u1', title: 'Mercy of Allah', status: 'done',
    sourceDurationSec: 3600, sourceStartSec: 0, sourceEndSec: 1800, submittedAt: Date.now() - 8e8 });
  for (let i = 0; i < 8; i++) {
    store.state.clips.push({ id: 'a' + i, projectId: 'p1', userId: 'u1',
      status: i < 5 ? 'approved' : 'waiting', approvedAt: i < 5 ? Date.now() : null,
      reviewRequired: i >= 5, score: 80, title: 'clip ' + i, addedAt: Date.now() });
  }
  store.state.clips.push({ id: 'f1', projectId: 'p1', userId: 'u1', status: 'posted', postedAt: Date.now(),
    targets: [{ provider: 'tiktok', status: 'failed' }, { provider: 'tiktok', status: 'failed' },
      { provider: 'tiktok', status: 'failed' }], title: 'f', addedAt: Date.now() });
  return user;
}
const user = seed();

test('EVERY action only navigates — none of them mutates anything', () => {
  // The ceiling, and it is deliberate. A bulk-approve from here would stamp
  // approvedBy 'deenai', and social.js skips a TikTok target for any clip not
  // approved manually (TikTok's per-post consent rule) -- so an "approve these
  // six" button would silently drop a destination the customer pays for.
  for (const [id, entry] of Object.entries(actions.ACTIONS)) {
    assert.ok(entry.step, `${id} names a destination`);
    assert.ok(entry.label, `${id} has a label`);
    assert.equal(Object.keys(entry).length, 2, `${id} carries a label and a step and nothing else`);
  }
  // The PROPERTY, not a word-hunt. A first cut grepped the source for
  // "approve"/"publish" and failed twice: once on the comment explaining why
  // nothing is approved, and once on `publish:` -- a STEP KEY from
  // referrals.nextStep, not a verb. Both would have been "fixed" by rewording
  // the file, which protects nothing. So: every step must be one of the
  // studio's navigation destinations, and this module must import nothing
  // that could act.
  const NAVIGATION_ONLY = new Set(['review', 'connect', 'schedule', 'nasheed', 'paste', 'library']);
  for (const [id, entry] of Object.entries(actions.ACTIONS)) {
    assert.ok(NAVIGATION_ONLY.has(entry.step), `${id} goes to a screen (${entry.step})`);
  }
  const src = fs.readFileSync(new URL('../src/deenai-actions.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /^import /m, 'it imports nothing, so it can reach nothing');
  // And it holds no plan gate: the route gates once, and a second gate here is
  // how two answers to one question start.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/isPaid|atLeast|FEATURES/.test(code), 'no plan gate in the action table');
});

test('an unknown action id resolves to nothing', () => {
  // The client sends an ID and nothing else -- never a screen or handler name
  // -- so there is no capability here to escalate.
  assert.equal(actions.action('open-review').step, 'review');
  assert.equal(actions.action('rm -rf'), null);
  assert.equal(actions.action(''), null);
  assert.equal(actions.action(undefined), null);
  assert.equal(actions.action('constructor'), null, 'and no prototype key is an action');
  assert.equal(actions.action('toString'), null);
});

test('the cards that name a screen carry a button to it', () => {
  const cards = deenai.insights(user);
  const withAction = cards.filter(c => c.action);
  assert.ok(withAction.length >= 3, `most cards act; got ${withAction.length} of ${cards.length}`);
  const byTitle = t => cards.find(c => String(c.title).includes(t));
  assert.equal(byTitle('refused').action.step, 'connect', 'a refusal goes to Connections');
  assert.equal(byTitle('scripture').action.step, 'review', 'held scripture goes to the queue');
  // Every attached action is a real entry in the frozen table.
  for (const card of withAction) {
    assert.ok(actions.ACTIONS[card.action.id], `${card.action.id} is in the table`);
    assert.equal(card.action.step, actions.ACTIONS[card.action.id].step);
  }
});

test('the headline card carries the step it was built from', () => {
  // DRIVEN, not just mapped. A first cut only asserted actionForStep's table
  // and stayed green when `action:` was deleted from nextActionCard -- which
  // is the very bug this file exists for. So: build the real cards and read
  // the headline's own action.
  // A SECOND account, in the state that actually produces the next-action
  // card: a finished import with clips nobody has reviewed. The first account
  // has approved clips and a paid plan, so its next step is 'upgrade' and
  // nextActionCard correctly declines to tell a paying customer to subscribe.
  const stuck = { id: 'u2', email: 'b@b', role: 'user', billing: { plan: 'pro_monthly' }, createdAt: Date.now() - 9e8 };
  store.state.authUsers.push(stuck);
  store.state.projects.push({ id: 'p2', userId: 'u2', title: 'Patience', status: 'done',
    sourceDurationSec: 1800, sourceStartSec: 0, sourceEndSec: 900, submittedAt: Date.now() - 8e8 });
  for (let i = 0; i < 4; i++) {
    store.state.clips.push({ id: 'w' + i, projectId: 'p2', userId: 'u2', status: 'waiting',
      score: 70, title: 'waiting ' + i, addedAt: Date.now() });
  }
  const head = deenai.insights(stuck)[0];
  assert.ok(head, 'the stuck account has a headline card');
  assert.equal(head.kicker, 'Do this next', 'and it is the next-action card');
  assert.ok(head.action, 'which carries somewhere to go — this is the bug that was fixed');
  assert.equal(head.action.step, 'review', 'to the queue its own body names');
  assert.ok(actions.ACTIONS[head.action.id], 'from the frozen table');

  // referrals.nextStep returns the action and this card used to drop it.
  for (const [key, step] of [['review', 'review'], ['publish', 'connect'], ['import', 'paste']]) {
    const mapped = actions.actionForStep(key);
    assert.ok(mapped, `${key} maps to an action`);
    assert.equal(mapped.step, step);
  }
  // The two that are not somewhere to go stay unmapped rather than pointing
  // at a screen that would not help.
  assert.equal(actions.actionForStep('processing'), null);
  assert.equal(actions.actionForStep('done'), null);
  assert.equal(actions.actionForStep('upgrade'), null, 'the plans screen is offered by its own button');
});

test('a demo card never gets a button, and the studio has ONE destination map', () => {
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const fn = adapter.slice(adapter.indexOf('function aiActionOf('), adapter.indexOf('var aiHead ='));
  assert.match(fn, /card\.demo/, 'a demo card describes a sample account, so its button would lie');
  assert.match(fn, /goToStep/, 'and it goes through the studio\'s own destination map');
  // Every step the table names must exist in that map, or a button would be
  // drawn that silently does nothing when pressed.
  const map = adapter.slice(adapter.indexOf('goToStep: function (action, e) {'));
  for (const entry of Object.values(actions.ACTIONS)) {
    assert.match(map, new RegExp('\\n\\s*' + entry.step + ': function'), `goToStep handles "${entry.step}"`);
  }
});

test('the buttons are host-rendered and name no hashed class', () => {
  const host = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  const at = host.indexOf('function paintAiActions(');
  assert.ok(at > 0, 'the painter exists');
  const body = host.slice(at, host.indexOf('\n    }', at));
  assert.doesNotMatch(body.replace(/\/\*[\s\S]*?\*\//g, ''), /\.s[0-9][0-9a-z]?\b/, 'no hashed class');
  assert.match(host.slice(host.indexOf('function aiCardButton(')), /data-host-owned/, 'marked for the patcher');
  assert.match(host, /paintAiAnswerSource\(vals\);\n\s*paintAiActions\(vals\);/, 'and it runs from paintStudio');
  // BOTH SURFACES. The phone draws its own DeenAI screen and body.dcm-own
  // hides the desktop one, so a painter scoped to #studio alone paints the
  // copy nobody can see -- measured as a 0x0 button inside a display:none
  // branch before this was fixed.
  // Bounded to the FUNCTION, not to the end of the file: a first cut sliced
  // from aiRoots to EOF and matched "#dcMobile" in an unrelated painter, so it
  // stayed green with the phone surface removed.
  const rootsAt = host.indexOf('function aiRoots(');
  const roots = host.slice(rootsAt, host.indexOf('\n    }', rootsAt));
  assert.match(roots, /#dcMobile/, 'the phone surface is covered');
  assert.match(host.slice(host.indexOf('function aiCardHost(')), /aiShown/, 'and the hidden copy is skipped');
  // Rects, never offsetParent: #dcMobile is position:fixed and offsetParent is
  // null for a fixed element even when it is plainly on screen -- measured, it
  // dropped the phone's entire surface.
  assert.match(host.slice(host.indexOf('function aiShown(')), /getClientRects/);
  const painters = host.slice(host.indexOf('function aiShown('), host.indexOf('function paintAiAnswerSource('));
  assert.doesNotMatch(painters.replace(/\/\*[\s\S]*?\*\//g, ''), /offsetParent/, 'offsetParent lies about a fixed element');
});
