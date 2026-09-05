import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

/**
 * The product audit of 5 Sept 2026, driven through the real controls with a
 * new account, an established one and a spent one. Each test here pins a
 * fault that was FOUND BY USING THE APP rather than by reading it, and every
 * one had passed a green suite:
 *
 *   - the "one all the way through" dialog rose over every screen of every
 *     established account on every new device (nine times in one run);
 *   - Home told every customer with one channel "TikTok, Instagram, Facebook
 *     needs reconnecting" while the YouTube that had actually expired read
 *     "Posting";
 *   - a failed import was filed as "Archived · no clips yet" and its detail
 *     screen offered "Approve all remaining";
 *   - the trial countdown outranked "no nasheed" and "nothing connected" in
 *     the banner, so a new account learned both seven wizard steps later;
 *   - step 3 blocked on "Pick at least one length", a requirement the worker
 *     never had; the last step said "Nasheed, ducked" over an empty library
 *     and offered "Generate clips" to an account with no tokens;
 *   - the rail badge sold DeenAI as STUDIO two releases after it moved to Pro.
 *
 * Executed output wherever there is any: the journey's own return value, the
 * server's connection status, the adapter's bindings. Source assertions are
 * kept only for what CI has no browser to run.
 */

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const HOUR = 3600000, DAY = 86400000;

/* ── The adapter, loaded the way nasheed-note.test.mjs loads it ── */
function bindings(over, ui) {
  const src = read('src/public/studio-adapter.js');
  const sandbox = {
    console, Date, Math, JSON, Intl, setTimeout, clearTimeout, isNaN, parseInt, parseFloat, Number, String, Boolean, Array, Object, RegExp,
    // The walkthrough steers the screen while it is up (UI.screen = tourStep.screen),
    // so the harness marks it seen -- the browser sessions the audit drove had it dismissed.
    localStorage: { getItem: k => (/dcTour/.test(String(k)) ? '1' : null), setItem: () => {}, removeItem: () => {} },
    innerWidth: 1440, matchMedia: () => ({ matches: false, addEventListener() {} }),
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], body: { classList: { add() {}, remove() {}, contains: () => false } }, documentElement: { classList: { add() {}, remove() {}, contains: () => false } }, addEventListener() {} },
    navigator: { userAgent: '' }, location: { href: '', search: '', hash: '' }, history: { replaceState() {} },
    requestAnimationFrame: fn => fn(), addEventListener() {}, removeEventListener() {},
  };
  sandbox.window = sandbox; sandbox.globalThis = sandbox; sandbox.global = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const DATA = Object.assign({
    clips: [], projects: [], music: [], tracks: [], postTimes: [],
    social: { providers: {} }, billing: { notices: [], current: {} },
    onboarding: null, user: { id: 'u1' }, templates: [], clipSettings: {},
  }, over);
  if (ui) Object.assign(sandbox.StudioAdapter.ui, ui);
  return { v: sandbox.StudioAdapter.bindings(DATA), A: sandbox.StudioAdapter, DATA };
}
const nasheeds = n => Array.from({ length: n }, (_, i) => ({ id: 't' + i, name: 'Nasheed ' + i, url: '/m/' + i + '.mp3', ready: true }));

/* ── 1. The celebration is once per account and only while fresh ── */
test('the "all the way through" moment is decided by the server: fresh, once, then never', async () => {
  const { journey } = await import('../src/onboarding.js');
  const now = Date.parse('2026-09-05T10:00:00Z');
  const stateAt = postedAt => ({
    authUsers: [{ id: 'u1', createdAt: now - 30 * DAY }],
    projects: [{ id: 'p1', userId: 'u1', status: 'done', submittedAt: now - 20 * DAY }],
    clips: [{ id: 'c1', userId: 'u1', projectId: 'p1', status: 'posted', addedAt: now - 19 * DAY, approvedAt: now - 18 * DAY, postedAt }],
  });
  const fresh = journey(stateAt(now - 2 * HOUR), 'u1', { celebratedAt: 0, now });
  assert.equal(fresh.at, 'done');
  assert.equal(fresh.celebrate, true, 'first publish two hours ago: the moment');
  assert.equal(journey(stateAt(now - 2 * HOUR), 'u1', { celebratedAt: now - HOUR, now }).celebrate, false,
    'already shown to this account, on any device');
  assert.equal(journey(stateAt(now - 20 * DAY), 'u1', { celebratedAt: 0, now }).celebrate, false,
    'a publish three weeks old is history, not a moment');
  const notDone = journey({ ...stateAt(null), clips: [] }, 'u1', { celebratedAt: 0, now });
  assert.notEqual(notDone.at, 'done');
  assert.equal(notDone.celebrate, false);
});

test('the browser shows the moment only when the server says so, and reports it', () => {
  const html = read('src/public/index.html');
  const at = html.indexOf('function paintSetupCelebration(');
  const body = html.slice(at, html.indexOf('\n}\n', at));
  assert.match(body, /DATA\.onboarding\.celebrate===true/, 'keys on the server\'s answer');
  assert.doesNotMatch(body, /onboarding\.at==='done'/, 'and no longer on the journey being finished alone');
  assert.match(body, /api\('\/api\/onboarding\/celebrated'/, 'stamps the account so the next device stays quiet');
  const server = read('src/server.js');
  assert.match(server, /pathname === '\/api\/onboarding\/celebrated'/);
  assert.match(server, /celebratedAt: Number\(state\.userSettings\?\.\[user\.id\]\?\.celebratedAt\)/, 'the stamp reaches the journey');
});

/* ── 2. "Needs reconnecting" names the connection that expired ── */
test('a token past its expiry with no refresh token is flagged by the server; a live one is not', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-social-'));
  process.env.DATA_DIR = dir;
  process.env.SOCIAL_TOKEN_KEY = 'audit-social-token-key-0123456789abcdef-0123456789';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:1';
  const store = await import('../src/store.js');
  const social = await import('../src/social.js');
  const key = crypto.createHash('sha256').update(process.env.SOCIAL_TOKEN_KEY).digest();
  const encrypt = value => {
    const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ct = Buffer.concat([c.update(JSON.stringify(value), 'utf8'), c.final()]);
    return `v1.${iv.toString('base64url')}.${c.getAuthTag().toString('base64url')}.${ct.toString('base64url')}`;
  };
  const conn = token => ({ provider: 'youtube', accountId: 'UC1', name: 'Main', avatar: '', token: encrypt(token), connectedAt: Date.now() });
  store.state.socialConnections ||= {};
  store.state.socialConnections.u9 = { youtube: conn({ access_token: 'dead', expiresAt: Date.now() - DAY }) };
  assert.equal(social.connectionStatus({ id: 'u9' }).providers.youtube.needsReconnect, true, 'expired, nothing to renew it with');
  store.state.socialConnections.u9 = { youtube: conn({ access_token: 'old', refresh_token: 'r', expiresAt: Date.now() - DAY }) };
  assert.equal(social.connectionStatus({ id: 'u9' }).providers.youtube.needsReconnect, false, 'expired but renewable: not a reconnect');
  store.state.socialConnections.u9 = { youtube: conn({ access_token: 'live', expiresAt: Date.now() + DAY }) };
  assert.equal(social.connectionStatus({ id: 'u9' }).providers.youtube.needsReconnect, false, 'live');
  assert.equal(social.connectionStatus({ id: 'u9' }).providers.tiktok.needsReconnect, false, 'never connected is not "needs reconnecting"');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Home names the channel that expired, never the platforms that were never connected', () => {
  const providers = {
    youtube: { configured: true, connected: true, enabled: true, needsReconnect: true, accounts: [{ id: 'UC1', name: 'Main' }] },
    tiktok: { configured: true, connected: false, accounts: [] },
    instagram: { configured: true, connected: false, accounts: [] },
    facebook: { configured: true, connected: false, accounts: [] },
  };
  const publishingSettings = { youtube: { enabled: true, accountId: 'UC1', accountIds: ['UC1'] } };
  const { v } = bindings({ social: { providers }, publishingSettings, tracks: nasheeds(2), music: nasheeds(2) });
  assert.match(String(v.connSummary), /YouTube needs reconnecting/);
  assert.doesNotMatch(String(v.connSummary), /TikTok|Instagram|Facebook/, 'the old sentence listed every unconnected platform');
  const yt = v.schedOutlets.find(o => o.name === 'YouTube');
  assert.equal(yt.note, 'Needs reconnecting', 'the Schedule stops calling an expired channel "Posting"');
  assert.equal(v.connections.find(r => r.key === 'youtube').needsReconnect, true, 'the dialog row carries the flag');
  providers.youtube.needsReconnect = false;
  const ok = bindings({ social: { providers }, publishingSettings, tracks: nasheeds(2), music: nasheeds(2) }).v;
  assert.doesNotMatch(String(ok.connSummary), /reconnect/);
  assert.equal(ok.schedOutlets.find(o => o.name === 'YouTube').note, 'Posting');
});

/* ── 3. A failed import is its own state everywhere the lecture is shown ── */
test('a failed import says so on the card, in the tabs and on the detail screen', () => {
  const failed = { id: 'p1', userId: 'u1', status: 'failed', submittedAt: Date.now() - 2 * HOUR, title: 'Friday khutbah',
    error: 'YouTube blocked the download from this server ("Sign in to confirm you are not a bot").', errorCode: 'youtube_import_blocked' };
  const { v } = bindings({ projects: [failed] });
  assert.equal(v.libraryItems[0].stateChip, 'Failed', 'was "Archived"');
  assert.equal(v.libraryItems[0].isFailed, true);
  assert.notEqual(v.libraryItems[0].metric, 'no clips yet', 'the metric is the reason, not a promise of clips');
  assert.equal(v.libTabs.find(t => t.key === 'failed').count, 1);
  assert.equal(v.libTabs.find(t => t.key === 'archived').count, 0, 'and it no longer hides among the archived');
  const { v: d } = bindings({ projects: [failed] }, { screen: 'detail', openProject: 'p1' });
  assert.match(String(d.subline), /^Import failed/);
  assert.equal(d.bulkLabel, 'Retry this lecture', 'was "Approve all remaining" on a lecture that never came down');
  assert.doesNotMatch(String(d.detailHint), /Approving one queues it/);
  assert.ok(d.detailHint.length > 40, 'the hint carries the cause and the fix');
});

/* ── 4. A countdown never masks a setup blocker ── */
test('a non-blocking money notice becomes a note; the nasheed and connection blockers keep the banner', () => {
  const countdown = [{ id: 'x', kind: 'free_ending', title: '7 free days left', message: 'You have 40 tokens.', action: 'See plans' }];
  const { v } = bindings({ billing: { notices: countdown, current: {} }, tracks: [], music: [] });
  assert.equal(v.blockerTone, 'stop');
  assert.match(String(v.blockerText), /No nasheed uploaded/, 'the countdown used to win this slot');
  const { v: c } = bindings({ billing: { notices: countdown, current: {} }, tracks: nasheeds(2), music: nasheeds(2), social: { providers: {} } });
  assert.match(String(c.blockerText), /No publishing account connected/);
  const { v: n } = bindings({ billing: { notices: countdown, current: {} }, tracks: nasheeds(2), music: nasheeds(2),
    social: { providers: { youtube: { configured: true, connected: true, enabled: true, accounts: [{ id: 'y', name: 'M' }] } } } });
  assert.equal(n.blockerTone, 'note', 'with nothing else wrong the countdown is shown, as information');
  assert.match(String(n.blockerText), /7 free days left/);
  const blocking = [{ id: 'y', kind: 'free_ended', title: 'Your free trial has ended', message: 'Choose a plan.', action: 'Choose plan', blocking: true }];
  const { v: b } = bindings({ billing: { notices: blocking, current: {} }, tracks: [], music: [] });
  assert.equal(b.blockerTone, 'stop');
  assert.match(String(b.blockerText), /free trial has ended/, 'a notice that STOPS the account still comes first');
});

/* ── 5. The wizard: no false gate, and the last step tells the truth ── */
test('step 3 no longer blocks on choosing a length, and the summary calls an empty choice "Any length"', () => {
  const job = { url: 'https://www.youtube.com/watch?v=x', start: 0, end: 120, durationKnown: false };
  const { v } = bindings({ clipSettings: { clipLengthBands: [], clipMinSeconds: 20, clipMaxSeconds: 90 }, tracks: nasheeds(1), music: nasheeds(1) }, { job, jobStep: 3 });
  assert.equal(v.jobNextLabel, 'Continue', 'was "Pick at least one length"');
  const row = v.jobSummaryRows.find(r => r.label === 'Clip lengths');
  assert.equal(row.value, 'Any length');
  const html = read('src/public/index.html');
  assert.doesNotMatch(html, /Nothing can be cut until at least one length is allowed/, 'the note said the pipeline refuses; it does not');
});

test('the last step names what would refuse the job, before it is pressed', () => {
  const job = { url: 'https://www.youtube.com/watch?v=x', start: 0, end: 120, durationKnown: false };
  const tpl = { id: 'clean-line', name: 'Clean Line', captionMode: 'phrase' };
  const noNasheed = bindings({ tracks: [], music: [], templates: [tpl], selectedTemplate: tpl }, { job, jobStep: 7 }).v;
  assert.equal(noNasheed.genLabel, 'Add a nasheed first', 'was "Generate clips", refused after the press');
  assert.equal(noNasheed.jobNoNasheed, true, 'the sound step says so too');
  assert.equal(noNasheed.jobSummaryRows.find(r => r.label === 'Underneath').value, 'No nasheed uploaded yet', 'was "Nasheed, ducked" over an empty library');
  const blocking = [{ id: 'y', kind: 'free_ended', title: 'Your free trial has ended', message: 'Choose a plan.', action: 'Choose plan', blocking: true }];
  const spent = bindings({ tracks: nasheeds(1), music: nasheeds(1), templates: [tpl], selectedTemplate: tpl, billing: { notices: blocking, current: {} } }, { job, jobStep: 7 }).v;
  assert.equal(spent.genLabel, 'Choose a plan to continue');
  const fine = bindings({ tracks: nasheeds(1), music: nasheeds(1), templates: [tpl], selectedTemplate: tpl }, { job, jobStep: 7 }).v;
  assert.equal(fine.genLabel, 'Generate clips');
  assert.equal(fine.jobSummaryRows.find(r => r.label === 'Underneath').value, 'Nasheed, ducked');
});

/* ── 6. The rail sells DeenAI at the tier that unlocks it ── */
test('the DeenAI badge is the locking tier from the FEATURES table, never a literal', () => {
  const locked = { deenai: { tier: 'pro', tierName: 'Pro' } };
  const { v } = bindings({ billing: { notices: [], current: { locked } } });
  assert.equal(v.navSetup.find(i => i.key === 'deenai').count, 'PRO');
  assert.equal(v.aiTierTag, 'PRO', 'and the screen\'s own pill reads the same name');
  const src = read('src/public/studio-adapter.js');
  assert.doesNotMatch(src, /navItem\('deenai', 'DeenAI', 'ph ph-sparkle', 'STUDIO'\)/);
  const tpl = read('src/public/studio-template.generated.js');
  assert.match(tpl, /"aiTierTag"/, 'the design\'s literal STUDIO pill is a binding now');
});

/* ── 7. Dead and false controls ── */
test('"Save as new style" is gone, the fake storage bar is hidden, and the account panel stops naming a sign-in link', () => {
  assert.match(read('src/public/studio-tokens.css'), /#dcSaveAsStyle \{ display: none !important; \}/);
  const html = read('src/public/index.html');
  assert.match(html, /\/\^Storage\/\.test\(\(head\.textContent/, 'the bar under the Storage heading is found and hidden by the host');
  assert.doesNotMatch(html, /email:'a sign-in link'/);
  assert.match(html, /email:'your email and password'/);
});

/* ── 8. Group 2: the chips, the nasheed claim, the free account's portal buttons, the phone's Approve ── */
test('a schedule card lists only the checks that FAIL, worded as what is missing', () => {
  const clip = { id: 'c1', title: 'A clip', status: 'approved', approvedAt: 1, scheduledAt: Date.now() + 3600000, transcript: 'words', templateId: 'clean-line', musicVerified: true, renderVerified: false, targets: [] };
  const { v } = bindings({ clips: [clip], tracks: nasheeds(1), music: nasheeds(1) }, { screen: 'schedule', schedView: 'day' });
  // Wherever the schedule filed it (today, overdue, a week cell): the first
  // card carrying a checks list.
  const findCard = (o, depth = 0) => {
    if (!o || typeof o !== 'object' || depth > 4) return null;
    if (Array.isArray(o.checks) && 'hasFailing' in o) return o;
    for (const k of Object.keys(o)) { const hit = findCard(o[k], depth + 1); if (hit) return hit; }
    return null;
  };
  const card = findCard({ day: v.schedDayItems, overdue: v.schedOverdueItems, week: v.schedWeekRows || v.schedWeek });
  assert.ok(card, 'a day card was drawn for the scheduled clip');
  assert.equal(card.hasFailing, true);
  // Array.from: the adapter's arrays belong to the vm realm and strict deepEqual rejects them on the prototype.
  assert.deepEqual(Array.from(card.checks, k => k.label), ['Render not verified'], 'one failing check, one chip -- the three that passed are not listed');
  assert.doesNotMatch(read('src/public/studio-template.generated.js'), /" missing"/, 'the design no longer appends "missing" to every chip');
});

test('the Nasheed screen no longer claims one track blocks posting', () => {
  assert.doesNotMatch(read('src/public/studio-template.generated.js'), /blocks automatic posting/);
  assert.match(read('src/public/studio-template.generated.js'), /one is enough to post with/);
});

test('Payment method and Invoices are drawn only with a subscription', () => {
  assert.match(read('src/public/studio-template.generated.js'), /"hasSubscription"/, 'the buttons sit under a binding');
  const free = bindings({ billing: { notices: [], current: { plan: 'free' } } }).v;
  assert.equal(free.hasSubscription, false);
  const pro = bindings({ billing: { notices: [], current: { plan: 'pro_monthly', stripeSubscriptionId: 'sub_1' } } }).v;
  assert.equal(pro.hasSubscription, true);
});

test('the phone clip card\'s primary action wraps to its own row up to 409px', () => {
  const css = read('src/public/studio-mobile.css');
  const at = css.indexOf('@media (max-width: 409px)');
  assert.ok(at > 0, 'the seam moved up from 389: "Approve" clipped at exactly 390');
  assert.match(css.slice(at, at + 300), /\.dcm-clip-a \.dcm-btn:first-child \{ flex: 1 1 100%; \}/);
});

test('a plan\'s price line says "per month", not "per monthly"', () => {
  const current = { plan: 'pro_monthly', totalAvailable: 10, allowance: 650, remaining: 10 };
  const plans = { pro_monthly: { id: 'pro_monthly', name: 'Pro Monthly', priceLabel: 'A$29', interval: 'monthly', tokens: 650 } };
  const { v } = bindings({ billing: { notices: [], current, plans } });
  assert.match(String(v.planPriceLine), /per month$/);
});
