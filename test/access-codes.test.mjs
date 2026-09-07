import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

/*
 * TESTER AND CAMPAIGN ACCESS CODES.
 *
 * Youssef, 7 Sept 2026, recruiting testers by DM: "we'll give them a code ...
 * they will get, let's say, fourteen days ... of pro, and they get everything
 * that's included on the pro subscription ... once it's over the two weeks,
 * it'll just say everything is done purchase a subscription and shouldnt
 * allow them to post further."
 *
 * Driven rather than read. What matters here is not that the model has the
 * right shape but that redeeming actually changes what an account may DO, and
 * that the end of the fortnight actually takes it back -- so the tier gates,
 * the token allowance and the publish loop are all exercised for real.
 */
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-codes-'));
process.env.DATA_DIR = dataDir;
process.env.PORT = '0';
process.env.APP_SESSION_SECRET = 'access-codes-test-secret-long-enough';
process.env.AUTH_REQUIRED = 'true';
process.env.EMAIL_SIGNIN_ENABLED = 'true';
process.env.ADMIN_EMAIL = 'operator@deenclipped.test';

const billing = await import('../src/billing.js');
const store = await import('../src/store.js');
const agent = await import('../src/agent.js');
const { server } = await import('../src/server.js');
await new Promise(resolve => (server.listening ? resolve() : server.once('listening', resolve)));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir must never fail a green suite */ }
});

/*
 * ONE sign-up, reused. The sign-up throttle is three accounts per connection
 * per day and a file that spends it reports a broken route when the route is
 * fine. The second account below is made directly for the same reason.
 */
const signup = await fetch(`${base}/auth/email`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: base },
  body: new URLSearchParams({ email: 'tester@deenclipped.test', password: 'correct horse battery staple', returnTo: '/app' }),
  redirect: 'manual',
});
const cookie = (signup.headers.get('set-cookie') || '').split(';')[0];
const auth = await import('../src/auth.js');
const me = () => auth.currentUser({ headers: { cookie } });

const post = (url, body) => fetch(`${base}${url}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Cookie: cookie },
  body: JSON.stringify(body),
});

test('the account signed up, and starts on the free plan with no grant', () => {
  assert.ok(cookie.startsWith('dc_session='), 'the account signed up');
  const user = me();
  assert.equal(billing.tierOf(user), 'basic');
  assert.equal(billing.planFeatures(user).templates, false, 'Pro features are off to begin with');
  assert.equal(billing.grantState(billing.ensureUserBilling(user)).active, false);
});

test('only the operator may mint a code', async () => {
  const refused = await post('/api/owner/codes', {});
  assert.ok(refused.status >= 400, 'a customer cannot mint themselves fourteen days of Pro');
  const body = await refused.json().catch(() => ({}));
  assert.ok(!body.created, 'and nothing was created');
});

/* Minted directly: the route is proven above, and the operator's own session
 * would cost this file a second sign-up it does not need. */
let code;
test('a minted code carries the terms it was given', () => {
  code = billing.createAccessCode({ id: 'operator' }, { note: '@brother_ahmad' });
  assert.equal(code.tier, 'pro');
  assert.equal(code.days, 14, 'the fortnight Youssef asked for');
  assert.equal(code.tokens, 650, 'and a full Pro month of tokens inside it');
  assert.equal(code.cap, 1, 'one tester, one code, unless a campaign says otherwise');
  assert.match(code.code, /^DEEN-[A-Z0-9]{6}$/);
  // No 0/O, 1/I or 5/S: a tester who mistypes their code reads it as the
  // product refusing them.
  assert.ok(!/[01IOS5]/.test(code.code.split('-')[1]), 'the alphabet has no ambiguous glyphs');
});

test('redeeming turns on every Pro feature and the tokens, over HTTP', async () => {
  // Typed off a phone screen, so case and stray spaces cannot matter.
  const response = await post('/api/billing/redeem', { code: `  ${code.code.toLowerCase()} ` });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.grant.daysLeft, 14);

  const user = me();
  assert.equal(billing.tierOf(user), 'pro', 'the features tier moves');
  const features = billing.planFeatures(user);
  assert.equal(features.templates, true);
  assert.equal(features.watermark, true);
  assert.equal(features.deenai, true);
  assert.equal(billing.publicBilling(user).current.remaining, 650, 'and a full Pro month of tokens');
});

test('A GRANT BUYS FEATURES, NEVER QUEUE POSITION', () => {
  const user = me();
  // The same line this codebase draws for the operator: there is ONE worker
  // slot, so an account that is not paying must not put its lecture in front
  // of one that is. tierOf reads the grant; paidTierOf must not.
  assert.equal(billing.paidTierOf(user), 'basic');
  assert.equal(billing.paysForAtLeast(user, 'pro'), false);
  assert.equal(billing.atLeast(user, 'pro'), true);
});

test('a code cannot be spent twice, and a second one cannot stack on a running grant', async () => {
  const again = await post('/api/billing/redeem', { code: code.code });
  assert.equal(again.status, 400);
  assert.match((await again.json()).error, /already used this code/i);

  const other = billing.createAccessCode({ id: 'operator' }, {});
  const stacked = await post('/api/billing/redeem', { code: other.code });
  assert.equal(stacked.status, 400);
  assert.match((await stacked.json()).error, /already running/i, 'and it says when the current one ends');
});

test('the cap is what stops a screenshotted code, and a disabled one refuses', () => {
  const shared = billing.createAccessCode({ id: 'operator' }, { cap: 2, days: 7, tokens: 100 });
  const a = { id: 'cap_a', createdAt: Date.now(), billing: {} };
  const b = { id: 'cap_b', createdAt: Date.now(), billing: {} };
  const c = { id: 'cap_c', createdAt: Date.now(), billing: {} };
  billing.redeemAccessCode(a, shared.code);
  billing.redeemAccessCode(b, shared.code);
  assert.throws(() => billing.redeemAccessCode(c, shared.code), /fully claimed/i);

  const dead = billing.createAccessCode({ id: 'operator' }, {});
  billing.setAccessCodeDisabled(dead.code, true);
  assert.throws(() => billing.redeemAccessCode(c, dead.code), /no longer active/i);
  // Disabled, never deleted: the redemptions on a code are the record of who
  // was given what, and the same text could otherwise be re-minted on
  // different terms.
  assert.ok(billing.listAccessCodes().some(row => row.code === dead.code && row.disabled));
});

test('an unrecognised code says so in a sentence somebody can act on', async () => {
  const response = await post('/api/billing/redeem', { code: 'DEEN-NOPE99' });
  assert.equal(response.status, 400);
  const said = (await response.json()).error;
  assert.match(said, /not recognised/i);
  // A tester who has been personally asked to try the product and meets
  // "invalid code" cannot tell a typo from a spent code, and gives up rather
  // than writing back.
  assert.match(said, /check it/i);
});

test('WHEN THE FORTNIGHT ENDS the tier, the tokens and posting all go with it', () => {
  const user = me();
  billing.ensureUserBilling(user).grant.endsAt = Date.now() - 1000;
  /*
   * The account is aged past its own free week as well, which is the case that
   * actually happens: a tester redeems on day one, so their seven free days
   * lapse DURING the fortnight and the grant ending is the real wall.
   * The other way round is checked below, and it deliberately does not block.
   */
  user.createdAt = Date.now() - 40 * 24 * 3600 * 1000;

  assert.equal(billing.tierOf(user), 'basic', 'the features go back');
  assert.equal(billing.planFeatures(user).templates, false);
  assert.equal(billing.publicBilling(user).current.remaining, 0, 'and the tokens expire WITH the grant');

  const notices = billing.publicBilling(user).notices;
  const blocking = notices.find(n => n.blocking);
  assert.ok(blocking, 'the screen says so, and says it blockingly');
  assert.equal(blocking.kind, 'grant_ended');
  // The grant is the recent, specific truth: being told on the same screen
  // about seven free days that lapsed a fortnight ago is noise.
  assert.ok(!notices.some(n => n.kind === 'free_ended'), 'and the stale free-window notice is silenced');

  const publish = billing.canPublish(user);
  assert.equal(publish.allowed, false);
  assert.equal(publish.reason, blocking.title, 'the reason posting stops IS the sentence on screen');
});

test('a clip is HELD, not failed — it keeps its approval and its slot', async () => {
  const user = me();
  store.state.projects.push({ id: 'p_hold', title: 'Lecture', userId: user.id });
  store.state.clips.push({
    id: 'c_hold', projectId: 'p_hold', userId: user.id, title: 'Held clip',
    status: 'scheduled', scheduledAt: Date.now() - 60_000, approvedAt: Date.now() - 120_000,
    approvedBy: user.id, musicVerified: true, renderVerified: true, templateId: 'clean-line',
    targets: [{ id: 'youtube:main', provider: 'youtube', accountId: 'main', status: 'scheduled' }],
  });
  await agent.tick();
  const clip = store.state.clips.find(c => c.id === 'c_hold');
  assert.equal(clip.status, 'scheduled', 'still scheduled, not failed');
  assert.ok(clip.approvedAt, 'the approval STANDS — failing it would cost a re-approval each');
  assert.ok(clip.scheduledAt, 'and it keeps its slot, so buying a plan releases the backlog by itself');
  assert.ok(clip.publishHold, 'the row can say why');
  assert.match(clip.publishHold, /has ended/i);

  // Post now meets the same wall and SAYS so, rather than reporting success
  // and posting nowhere.
  await assert.rejects(() => agent.publishNow('c_hold'), /has ended/i);
});

test('buying a plan releases the hold on the next sweep', async () => {
  const user = me();
  const b = billing.ensureUserBilling(user);
  b.plan = 'pro_monthly';
  b.status = 'active';
  assert.equal(billing.canPublish(user).allowed, true, 'a paid plan clears the blocking notice');
  const clip = store.state.clips.find(c => c.id === 'c_hold');
  assert.ok(clip.publishHold, 'still marked from the sweep before');
  await agent.tick();
  assert.ok(!store.state.clips.find(c => c.id === 'c_hold').publishHold, 'and the mark is cleared');
});

test('one source for the copy: the phone and the desktop read the same strings', () => {
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const mobile = fs.readFileSync(new URL('../src/public/studio-mobile.js', import.meta.url), 'utf8');
  const host = fs.readFileSync(new URL('../src/public/index.html', import.meta.url), 'utf8');
  for (const key of ['redeemTitle', 'redeemNote', 'redeemLabel']) {
    assert.ok(adapter.includes(`${key}:`), `${key} is defined in the adapter`);
    assert.ok(mobile.includes(`'${key}'`), `the phone renders ${key}`);
    assert.ok(host.includes(`vals.${key}`), `and the desktop panel reads ${key} rather than writing its own`);
  }
  // Both surfaces call ONE handler, so the action that changes what an account
  // may do cannot behave differently depending on the screen.
  assert.ok(mobile.includes("'redeemGo'"));
  assert.ok(host.includes('StudioAdapter.onRedeemCode()'));
  assert.equal((host.match(/StudioAdapter\.onRedeemCode=/g) || []).length, 1, 'and there is only one of it');
});

test('a grant that ends while free days remain does NOT block — that wall has not arrived', () => {
  /* A short code can lapse before the account's own free week does. Stopping
   * somebody who still has tokens would be the product refusing work it has
   * already given away. */
  const fresh = { id: 'still_free', createdAt: Date.now() - 24 * 3600 * 1000, billing: {} };
  const short = billing.createAccessCode({ id: 'operator' }, { days: 1, tokens: 300 });
  billing.redeemAccessCode(fresh, short.code);
  billing.ensureUserBilling(fresh).grant.endsAt = Date.now() - 1000;

  const info = billing.publicBilling(fresh);
  const ended = info.notices.find(n => n.kind === 'grant_ended');
  assert.ok(ended, 'it still SAYS the features went away');
  assert.ok(!ended.blocking, 'but it does not stop them working');
  assert.equal(billing.canPublish(fresh).allowed, true);
  assert.ok(info.notices.some(n => n.kind === 'free_ending'), 'and the free window takes over as the operative wall');
});

test('EVERY SURFACE AGREES about a running grant — the card, the pill and the box', () => {
  /*
   * Measured in a browser right after redeeming, and it was wrong: the header
   * pill read "PRO" with 650 tokens while the biggest block on the same screen
   * read "Basic / Free / 7 free days left". The subscription really is still
   * `free`; what a tester needs to read is what they HAVE and for how long,
   * and one account described two ways is the fault this repo keeps paying
   * for. Driven through the real bindings rather than read.
   */
  const src = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const sandbox = {
    console, Date, Math, JSON, Intl, setTimeout, clearTimeout, isNaN, parseInt, parseFloat,
    Number, String, Boolean, Array, Object, RegExp,
    localStorage: { getItem: k => (/dcTour/.test(String(k)) ? '1' : null), setItem() {}, removeItem() {} },
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, contains: () => false } }, documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, addEventListener() {} },
    navigator: { userAgent: '' }, location: { href: '', search: '', hash: '' }, history: { replaceState() {} },
    requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);

  // The exact payload the server builds for a granted account: the plan is
  // still `free`, and the free week is still running underneath.
  const DATA = {
    clips: [], projects: [], music: [], tracks: [], postTimes: [], templates: [], clipSettings: {},
    social: { providers: {} }, onboarding: null, user: { id: 'u1' },
    billing: {
      notices: [],
      current: {
        plan: 'free', planName: 'Pro', tier: 'pro', tierName: 'Pro', remaining: 650, status: 'free',
        grant: { active: true, ended: false, tier: 'pro', tokens: 650, daysLeft: 14 },
        grantTierName: 'Pro',
        freeTrial: { endsAt: Date.now() + 7 * 86400000, daysLeft: 7, expired: false },
      },
    },
  };
  sandbox.StudioAdapter.ui.screen = 'tokens';
  const v = sandbox.StudioAdapter.bindings(DATA);

  assert.equal(v.planTitle, 'Pro', 'the card names the tier they actually have');
  assert.equal(v.currentPlan, 'Pro', 'and so does the header pill');
  assert.equal(v.planState, 'Trial', 'the badge says it is temporary, not "Free"');
  assert.equal(v.planPriceLine, 'no charge', 'and they are not being told they pay for it');
  assert.match(v.planNote, /14 days left/, "the note counts the GRANT's fortnight");
  assert.ok(!/free day/.test(v.planNote), 'not the free week running underneath it');
  assert.match(v.redeemTitle, /^Pro access is running/);
});
