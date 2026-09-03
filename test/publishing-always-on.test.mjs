import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The master automatic-publishing switch is RETIRED.
 *
 * Youssef, 3 Sept 2026, with TikTok connected, ticked, an audience chosen and
 * two approved clips on today's schedule reading "Automatic publishing is off":
 * "doesnt WORK FIX IT KEEP AUTO UPLOAD ON ALWAYS".
 *
 * `publishingSettings.enabled` defaulted to FALSE and the studio has no
 * control for it. The only checkbox that ever wrote it -- "Enable automatic
 * publishing globally" -- lives in the legacy dashboard, behind a
 * `renderStudio()` that returns first, so no studio customer has ever seen it.
 * With it off, `setTargets` gives a clip no destinations at all, `tick()` files
 * it as `ready`, and nothing posts, for ever, with every visible switch on.
 *
 * That is invariant 9 inverted: not a control that does nothing, but a hidden
 * control whose default silently breaks the product. Nothing is loosened by
 * retiring it -- the per-platform ticks still decide WHERE a clip goes, and an
 * approval still decides WHETHER it goes at all.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-autopub-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'publishing-always-on-secret-long-enough';
process.env.SOCIAL_TOKEN_KEY = 'social-token-key-at-least-thirty-two-chars';
process.env.PUBLIC_BASE_URL = 'https://app.test';

const { state, save, publishingSettings, setPublishingSettings, settingDefaults } = await import('../src/store.js');
const agent = await import('../src/agent.js');

test.after(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* nothing to do */ }
});

const userId = 'user_autopub';
const read = file => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

/**
 * @param storedEnabled what the account's record on disk says. `false` is the
 *   shape EVERY account written before this release carries.
 */
function seed(storedEnabled) {
  state.authUsers = [{
    id: userId, email: 'autopub@test', name: 'Auto', role: 'creator', providers: {},
    createdAt: Date.now(), billing: { plan: 'pro', status: 'active' },
  }];
  state.clips = [{
    id: 'c1', userId, projectId: 'p1', title: 'A Reminder of Mercy',
    status: 'scheduled', scheduledAt: Date.now() - 1000,
    approvedAt: Date.now() - 60_000, approvedBy: 'manual',
    musicEnabled: false, musicVerified: false, renderVerified: true, renderQuality: 'final',
    transcript: 'Some words.', templateId: 'clean-line', targets: [],
    tiktokConsentAt: Date.now(),
  }];
  state.projects = [{ id: 'p1', userId, title: 'A lecture', status: 'done' }];
  state.socialConnections = {
    [userId]: {
      tiktok: [{
        provider: 'tiktok', accountId: 'tt1', name: 'DeenClipped', avatar: '',
        scopes: 'user.info.basic,video.publish', token: '', connectedAt: Date.now(),
        creatorInfo: { at: Date.now(), privacyOptions: ['SELF_ONLY'] },
      }],
    },
  };
  state.userSettings = {
    [userId]: {
      publishingSettings: {
        enabled: storedEnabled,
        tiktok: { enabled: true, accountId: 'tt1', accountIds: ['tt1'], privacy: 'SELF_ONLY' },
      },
    },
  };
  save();
  return state.authUsers[0];
}

test('a brand new account can publish without finding a switch first', () => {
  // BOTH halves, because either alone hides the other. Asserting only the
  // read would pass with the default still false (the correction covers it),
  // and asserting only the default would leave every existing record broken
  // -- which is the whole bug. A probe that flipped the default back came
  // back GREEN against the first cut of this test, which is how that was
  // found rather than reasoned about.
  assert.equal(settingDefaults().publishingSettings.enabled, true,
    'a record written today says on');

  const user = seed(true);
  delete state.userSettings[userId];
  assert.equal(publishingSettings(user).enabled, true,
    'and an account with no record at all reads as on');
});

test('AN ACCOUNT THAT ALREADY STORED false IS FREED ON READ', () => {
  // The one that matters. Every record this product has ever written holds
  // `false`, so a default change alone would have fixed nobody -- Youssef's
  // own account included, in the middle of the TikTok recording.
  const user = seed(false);
  assert.equal(state.userSettings[userId].publishingSettings.enabled, false,
    'the record on disk is untouched — this is a read-time correction, not a migration');
  assert.equal(publishingSettings(user).enabled, true,
    'and it reads as on anyway');
});

test('so the clip actually gets its destination at its slot', async () => {
  // Driven, not reasoned about: with the switch off this clip got an empty
  // target list and was filed `ready`, which is where it silently died.
  seed(false);
  await agent.tick();
  const after = state.clips[0];
  assert.ok((after.targets || []).length > 0, 'it has somewhere to go');
  assert.equal(after.targets[0].provider, 'tiktok');
  assert.notEqual(after.status, 'ready', 'and was not filed away as merely downloadable');
});

test('Post now says the one thing an empty list can still mean', () => {
  // With the master switch gone, no destinations means no destinations. A
  // button that does nothing has to say why (invariant 9), and it must not
  // send anybody looking for a switch that no longer exists.
  const source = read('src/agent.js');
  assert.ok(!/Automatic publishing is switched off/.test(source),
    'the retired switch is not named in an error a customer can reach');
  assert.match(source, /no connected destination to post to/);
});

test('a save cannot put an account back into the broken state', () => {
  // The legacy dashboard is the only thing that ever POSTed `enabled`, and it
  // is still on disk in this repo. A save carrying false must not strand the
  // account again.
  const user = seed(true);
  setPublishingSettings(user, { enabled: false });
  assert.equal(publishingSettings(user).enabled, true, 'read side holds');

  const route = read('src/server.js');
  const at = route.indexOf("if (method === 'POST' && pathname === '/api/publishing-settings')");
  assert.ok(at > 0, 'found the route');
  const block = route.slice(at, at + 4000);
  assert.ok(!/enabled:\s*Boolean\(body\.enabled\)/.test(block),
    'the route no longer stores whatever the browser sent');
  assert.match(block, /enabled:\s*true/, 'it stores the retired value honestly');
});

test('the dead control is gone from the legacy dashboard too', () => {
  // Left in place it would be a checkbox that changes nothing -- the plain
  // form of invariant 9, and the exact thing this release is fixing.
  const host = read('src/public/index.html');
  assert.ok(!host.includes('publishingEnabled'),
    'no control anywhere still claims to switch publishing on or off');
});

test('and no surface still blames a switch nobody can see', () => {
  const adapter = read('src/public/studio-adapter.js');
  assert.ok(!/Automatic publishing is off/.test(adapter), 'the schedule row');
  assert.ok(!/autoPublishOn/.test(adapter), 'and the variable behind it');
  // The outlets panel's "Posting" must not be gated on it either, or the
  // sidebar and the row go back to answering one question two ways.
  const at = adapter.indexOf('schedOutlets:');
  assert.ok(at > 0, 'found the outlets panel');
  assert.ok(!/publishingSettings/.test(adapter.slice(at, at + 1200)),
    'the outlets panel reads the platform tick alone');
});

test('the DEPLOYMENT kill-switch is a different thing and stays', () => {
  // `directPublishingEnabled` is `config.socialPublishEnabled` -- an operator
  // setting for the whole server (SOCIAL_PUBLISH_ENABLED, default true), not
  // a per-account switch, and it has a real reason to exist: a deployment
  // with no social credentials should not offer Post now at all. It renders
  // the OTHER "Publishing off", and confusing the two cost a run here.
  const adapter = read('src/public/studio-adapter.js');
  assert.match(adapter, /var publishingOn = DATA\.directPublishingEnabled !== false;/);
  assert.match(read('src/config.js'),
    /socialPublishEnabled: boolean\(process\.env\.SOCIAL_PUBLISH_ENABLED, true\)/,
    'and it defaults ON, so it is not a second hidden default that breaks the product');
});

test('where a clip goes is still the per-platform tick, and that still refuses', async () => {
  // The important half of "nothing is loosened". Retiring the master switch
  // must not mean a clip posts to a platform the account switched OFF.
  seed(true);
  state.userSettings[userId].publishingSettings.tiktok.enabled = false;
  save();
  await agent.tick();
  assert.deepEqual(state.clips[0].targets || [], [],
    'a platform switched off is still a platform nothing posts to');
});
