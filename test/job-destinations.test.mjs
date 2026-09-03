import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * A lecture may choose where its clips post.
 *
 * Youssef, 3 Sept 2026, on the last step of the job panel: "attach four icons,
 * the YouTube, TikTok, and Instagram and Facebook, and then they can deselect
 * or select depending on each video ... always keep it saved from last goal.
 * ... Keep it how it is as those settings to begin with all the time, and then
 * they can change their mind whenever they post."
 *
 * Two rules fall out of that and both are asserted here:
 *
 *  - the account's Connections settings are the STARTING POINT every time, so
 *    a per-lecture choice never becomes the new default;
 *  - a job may only ever NARROW them. Substituting the list would let a
 *    destination the account has since disconnected, or one its plan no longer
 *    allows, come back because a job recorded it days ago.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-dest-'));
process.env.DATA_DIR = dataDir;
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
const { state } = await import('../src/store.js');
const social = await import('../src/social.js');

const userId = 'user_dest';

function seed({ publishTo }) {
  state.projects = [{ id: 'p1', userId, publishTo }];
  state.userSettings = state.userSettings || {};
  state.userSettings[userId] = {
    ...(state.userSettings[userId] || {}),
    publishingSettings: {
      enabled: true,
      youtube: { enabled: true, accountId: 'yt1', accountIds: ['yt1'] },
      instagram: { enabled: true, accountId: 'ig1', accountIds: ['ig1'] },
      facebook: { enabled: true, accountId: 'fb1', accountIds: ['fb1'] },
    },
  };
  return { id: 'c1', userId, projectId: 'p1', title: 'A clip', approvedBy: 'manual' };
}

/**
 * Which providers the builder actually CONSIDERED.
 *
 * This fixture holds no credentials, so every provider it considers is
 * refused for want of an account and the returned target list is empty
 * whatever the job asked for -- reading that list alone would make every case
 * below look identical and prove nothing. The builder names each provider it
 * reached in the log, so the log is the executed output worth asserting on.
 */
function considered(clip) {
  state.log = [];
  social.enabledTargetsForClip(clip);
  return (state.log || [])
    .map(entry => String(entry?.message || '').split(' ')[0])
    .filter(name => ['youtube', 'instagram', 'facebook', 'tiktok'].includes(name))
    .sort();
}

test('no list means the account settings are taken whole', () => {
  const clip = seed({ publishTo: null });
  assert.deepEqual(considered(clip), ['facebook', 'instagram', 'youtube']);
});

test('a project list narrows, and the clip inherits it without being stamped', () => {
  // The list lives on the PROJECT. Clips are minted in five different places
  // (first render, re-cut, import, variants) and a field that has to be
  // remembered in five places is a field that will be forgotten in one.
  const clip = seed({ publishTo: ['youtube'] });
  assert.equal(clip.publishTo, undefined, 'nothing was stamped onto the clip');
  assert.deepEqual(considered(clip), ['youtube'], 'the other two were never reached');
});

test('a clip may carry its own list, and it wins over the project', () => {
  const clip = seed({ publishTo: ['youtube'] });
  clip.publishTo = ['facebook'];
  assert.deepEqual(considered(clip), ['facebook']);
});

test('the list may only narrow — it can never turn a destination back on', () => {
  // instagram is NOT enabled in settings; naming it in the job must not
  // publish there. This is the difference between intersecting and
  // substituting, and it is the whole safety property.
  const clip = seed({ publishTo: ['youtube', 'tiktok'] });
  state.userSettings[userId].publishingSettings.youtube.enabled = false;
  // instagram and facebook ARE enabled account-wide but were not named by the
  // job, so they stay out; youtube was named but is switched off, so it stays
  // out too. Naming a destination can never turn one back on.
  assert.deepEqual(considered(clip), []);
});

test('publishing switched off account-wide beats any job list', () => {
  const clip = seed({ publishTo: ['youtube'] });
  state.userSettings[userId].publishingSettings.enabled = false;
  assert.deepEqual(social.enabledTargetsForClip(clip), []);
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
