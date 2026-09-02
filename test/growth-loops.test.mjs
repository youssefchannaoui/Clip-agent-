import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/*
 * The growth loops of 2 Sept 2026: lifecycle nudges, the invite at the moment
 * of delight, and the free-plan post credit.
 *
 * Every one of these is a way to reach a customer's inbox or a customer's
 * public post, so every test here is about the ways it must NOT fire as much
 * as the ways it must.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-loops-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'growth-loops-test-secret-long-enough';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.REFERRALS_ENABLED = 'true';
process.env.REFERRAL_BONUS_PAID = '50';

const { state } = await import('../src/store.js');
const { config } = await import('../src/config.js');
const nudges = await import('../src/nudges.js');
const mailer = await import('../src/mailer.js');
const social = await import('../src/social.js');
const growth = await import('../src/growth.js');
const billing = await import('../src/billing.js');

config.emailApiKey = 'test-key';
config.emailFrom = 'DeenClipped <hello@deenclipped.online>';

test.after(async () => {
  await new Promise(resolve => setTimeout(resolve, 50));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* cleanup must not fail a run */ }
});

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);

const reset = () => {
  state.authUsers = [];
  state.projects = [];
  state.clips = [];
  state.revenueEvents = [];
  state.userSettings = {};
  config.nudgeEmailsEnabled = true;
  config.postCreditEnabled = true;
  config.referralsEnabled = true;
};
const account = (id, extra = {}) => {
  const user = { id, email: `${id}@example.com`, name: 'Yusuf Ali', role: 'creator', providers: {}, createdAt: T0, billing: {}, ...extra };
  state.authUsers.push(user);
  billing.ensureUserBilling(user);
  return user;
};
const sends = [];
const fakeSend = async msg => { sends.push(msg); return true; };

// ── nudges ─────────────────────────────────────────────────────────────────

test('an account that never imported is asked once, after a day, and never again', async () => {
  reset(); sends.length = 0;
  const user = account('u_import');
  assert.equal(nudges.dueNudge(user, T0 + 2 * 60 * 60 * 1000), null, 'two hours in is too soon');
  assert.equal(nudges.dueNudge(user, T0 + DAY + 1), 'import');
  const sent = await nudges.sweep({ now: T0 + DAY + 1, send: fakeSend });
  assert.deepEqual(sent, [{ userId: 'u_import', step: 'import' }]);
  assert.equal(sends[0].to, 'u_import@example.com');
  assert.match(sends[0].subject, /One lecture is all it takes/);
  assert.match(sends[0].text, /deenclipped\.online\/app#home/, 'lands on the paste field');
  assert.match(sends[0].text, /switch these emails off/, 'says how to stop them');
  assert.equal(user.nudges.import, T0 + DAY + 1);
  assert.equal(nudges.dueNudge(user, T0 + 30 * DAY), null, 'once per step, ever');
  assert.deepEqual(await nudges.sweep({ now: T0 + 30 * DAY, send: fakeSend }), []);
});

test('the bell toggle, the operator role and the kill switch each silence it', async () => {
  reset(); sends.length = 0;
  const off = account('u_off');
  state.userSettings.u_off = { emailNotifs: false };
  assert.equal(nudges.dueNudge(off, T0 + 2 * DAY), null, 'the person switched product emails off');
  const owner = account('u_owner', { role: 'owner' });
  assert.equal(nudges.dueNudge(owner, T0 + 2 * DAY), null, 'the operator is never nudged about their own product');
  const plain = account('u_plain');
  config.nudgeEmailsEnabled = false;
  assert.equal(nudges.dueNudge(plain, T0 + 2 * DAY), null, 'NUDGE_EMAILS=false');
  assert.deepEqual(await nudges.sweep({ now: T0 + 2 * DAY, send: fakeSend }), []);
  config.nudgeEmailsEnabled = true;
  assert.equal(nudges.dueNudge(plain, T0 + 2 * DAY), 'import');
});

test('the step comes from the one definition of stuck, and moves as the account moves', async () => {
  reset(); sends.length = 0;
  const user = account('u_steps');
  state.projects.push({ id: 'p1', userId: 'u_steps', status: 'complete', createdAt: T0 });
  state.clips.push({ id: 'c1', userId: 'u_steps', projectId: 'p1', status: 'waiting', createdAt: T0 + DAY });
  assert.equal(nudges.dueNudge(user, T0 + DAY + 1000), null, 'clips just came back');
  assert.equal(nudges.dueNudge(user, T0 + 2 * DAY + 1000), 'review');
  await nudges.sweep({ now: T0 + 2 * DAY + 1000, send: fakeSend });
  assert.match(sends.at(-1).subject, /waiting for a yes/);
  // They approve it. Nothing is connected, nothing posts.
  state.clips[0].status = 'approved';
  state.clips[0].approvedAt = T0 + 2 * DAY + 2000;
  assert.equal(nudges.dueNudge(user, T0 + 3 * DAY), null, 'never two in a row inside a day');
  assert.equal(nudges.dueNudge(user, T0 + 4 * DAY + 3000), 'publish', '48h approved, nothing published');
  await nudges.sweep({ now: T0 + 4 * DAY + 3000, send: fakeSend });
  assert.match(sends.at(-1).subject, /One connection/);
  assert.match(sends.at(-1).text, /deenclipped\.online\/r\/[A-Z0-9]+/, 'the invite rides on the publish nudge');
  assert.match(sends.at(-1).text, /you get 50 tokens/);
});

test('the free window closing is announced once, at two days, and never to a paying account', async () => {
  reset(); sends.length = 0;
  const user = account('u_free');
  const free = billing.publicBilling(user)?.current?.freeTrial;
  assert.ok(free && free.endsAt, 'a fresh account has a free window');
  // Day one: the import nudge went, as it would have in production. The
  // closing window is announced AFTER the step nudge, never instead of it.
  assert.deepEqual(await nudges.sweep({ now: T0 + DAY + 1, send: fakeSend }), [{ userId: 'u_free', step: 'import' }]);
  sends.length = 0;
  // Two days before the window closes -- or a day after the import nudge,
  // whichever is later, because two nudges never go inside one day. The free
  // window is a server setting (three days at the time of writing), so the
  // test computes the moment rather than assuming it.
  const closing = Math.max(free.endsAt - 2 * DAY + 60_000, T0 + DAY + 1 + DAY);
  const realNow = Date.now;
  Date.now = () => closing;
  try {
    assert.equal(nudges.dueNudge(user, closing), 'upgrade');
    const sent = await nudges.sweep({ now: closing, send: fakeSend });
    assert.equal(sent.length, 1);
    assert.match(sends[0].subject, /Your free days end (today|in \d+ days?)/);
    assert.equal(nudges.dueNudge(user, closing + DAY), null, 'once');
    // The payer's own import nudge went on day one, as it would have; what
    // is being tested is the closing-window check alone.
    const payer = account('u_paid', { nudges: { import: T0 } });
    billing.ensureUserBilling(payer).plan = 'pro_monthly';
    assert.equal(nudges.dueNudge(payer, closing), null, 'a paying account is not told to pay');
  } finally { Date.now = realNow; }
});

test('a sweep is capped and marks before it sends, so a slow provider cannot double-send', async () => {
  reset(); sends.length = 0;
  for (let i = 0; i < nudges.MAX_PER_SWEEP + 5; i += 1) account(`u_bulk_${i}`);
  const slow = async msg => { sends.push(msg); await new Promise(r => setTimeout(r, 5)); return true; };
  const first = await nudges.sweep({ now: T0 + 2 * DAY, send: slow });
  assert.equal(first.length, nudges.MAX_PER_SWEEP, 'a trickle, not a burst');
  const second = await nudges.sweep({ now: T0 + 2 * DAY + 1, send: slow });
  assert.equal(second.length, 5, 'the rest go next time, none twice');
  const ids = new Set(sends.map(m => m.to));
  assert.equal(ids.size, sends.length, 'no address received two');
});

// ── the invite at the moment of delight ────────────────────────────────────

test('the "your clip is live" email carries the invite only when there is something true to offer', () => {
  const base = { clipTitle: 'Patience', targets: [{ provider: 'youtube', status: 'posted', postUrl: 'https://youtu.be/x' }], scheduleUrl: 'https://deenclipped.online/app#schedule' };
  const bare = mailer.postSummaryMessage(base);
  assert.doesNotMatch(bare.text, /invite/i);
  const withInvite = mailer.postSummaryMessage({ ...base, invite: { url: 'https://deenclipped.online/r/ABCD1234', bonus: 50, discount: true } });
  assert.match(withInvite.text, /they get a discount on their first plan, and you get 50 tokens when they subscribe/);
  assert.match(withInvite.text, /deenclipped\.online\/r\/ABCD1234/);
  assert.match(withInvite.html, /href="https:\/\/deenclipped\.online\/r\/ABCD1234"/);
  // The discount is only claimed when a coupon is armed; the percentage is
  // never named here because it lives on the coupon.
  const noCoupon = mailer.postSummaryMessage({ ...base, invite: { url: 'https://deenclipped.online/r/ABCD1234', bonus: 50, discount: false } });
  assert.doesNotMatch(noCoupon.text, /discount/);
  assert.match(noCoupon.text, /you get 50 tokens/);
  assert.doesNotMatch(noCoupon.text, /%/);
  const nothing = mailer.postSummaryMessage({ ...base, invite: { url: 'https://deenclipped.online/r/ABCD1234', bonus: 0, discount: false } });
  assert.doesNotMatch(nothing.text, /invite/i, 'no reward configured, no promise made');
});

// ── the free-plan post credit ──────────────────────────────────────────────

test('a free-plan post carries the credit and the poster\'s own invite link; a paid plan never does', () => {
  reset();
  const free = account('u_credit_free');
  const paid = account('u_credit_paid');
  billing.ensureUserBilling(paid).plan = 'pro_monthly';
  const clip = owner => ({ id: 'c', userId: owner.id, description: 'A reminder about patience.', hashtags: '#IslamicReminder' });
  const credit = social.postCredit(clip(free));
  assert.match(credit, /^Clipped with DeenClipped · deenclipped\.online\/r\/[A-Z0-9]{4,}$/);
  assert.equal(credit.split('/r/')[1], free.referralCode, 'the poster\'s own code, so the credit pays them');
  assert.equal(social.postCredit(clip(paid)), '', 'a paid plan is what removes it -- the watermark policy in text');
  const operator = account('u_credit_owner', { role: 'owner' });
  assert.equal(social.postCredit(clip(operator)), '');
  config.postCreditEnabled = false;
  assert.equal(social.postCredit(clip(free)), '', 'POST_CREDIT=false');
  config.postCreditEnabled = true;
  config.referralsEnabled = false;
  assert.equal(social.postCredit(clip(free)), '', 'a credit with nothing in it for the poster is an advert, not a loop');
  config.referralsEnabled = true;
});

test('the credit survives the tightest caption limit; the description gives way, never the credit', () => {
  reset();
  const free = account('u_credit_long');
  const long = 'x'.repeat(2500);
  const text = social.captionTextFor({ id: 'c', userId: free.id, description: long, hashtags: '#tag' }, 2200);
  assert.ok(text.length <= 2200);
  assert.match(text, /Clipped with DeenClipped · deenclipped\.online\/r\/[A-Z0-9]+$/, 'the credit is the LAST thing, intact');
});

// ── measured on the First 100 screen ───────────────────────────────────────

test('the growth report counts what the nudges did, without inventing attribution', () => {
  reset();
  const moved = account('u_moved', { nudges: { import: T0 } });
  state.projects.push({ id: 'p', userId: moved.id, status: 'complete' });
  account('u_stuck', { nudges: { import: T0 } });
  account('u_never');
  const report = growth.report(state, {});
  assert.deepEqual(report.nudges.import, { sent: 2, moved: 1 });
  assert.deepEqual(report.nudges.upgrade, { sent: 0, moved: 0 });
});
