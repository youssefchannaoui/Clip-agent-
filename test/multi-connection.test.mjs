import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * Several connections on one platform.
 *
 * Stage 1 let the SETTINGS name three accounts; this is the store learning to
 * hold three credentials. Every failure guarded here is silent in production:
 * a clip posting to the wrong channel, a token refreshed onto the wrong
 * record, a disconnect taking two other channels with it, or -- worst -- the
 * YouTube retention sweep quietly skipping every channel because the slot it
 * used to read is now a list.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-multiconn-'));
process.env.DATA_DIR = dataDir;
process.env.AUTH_REQUIRED = 'true';
process.env.SOCIAL_TOKEN_KEY = 'multi-connection-test-key-over-32-chars!!!';
process.env.SOCIAL_PUBLISH_ENABLED = 'true';
process.env.PUBLIC_BASE_URL = 'https://multi-connection.test';

const tenancy = await import('../src/tenancy.js');
const store = await import('../src/store.js');
const social = await import('../src/social.js');
const { state } = store;

const studio = {
  id: 'mc-studio', email: 'mc@deenclipped.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'studio_monthly', status: 'active', tokensUsed: 0, tokensReserved: 0, bonusTokens: 0 },
};
state.authUsers.push(studio);

const channel = n => ({
  provider: 'youtube', accountId: `chan-${n}`, name: `Channel ${n}`,
  token: 'encrypted', connectedAt: Date.now(), youtubeDataAt: Date.now(),
});

test('a second channel is added, not written over the first', () => {
  // The whole reason multi-account could not be a settings flag: setConnection
  // assigned the slot, so connecting a second channel destroyed the first
  // one's refresh token.
  const bag = {};
  tenancy.addConnection(bag, studio.id, 'youtube', channel(1), { max: 3 });
  tenancy.addConnection(bag, studio.id, 'youtube', channel(2), { max: 3 });

  const list = tenancy.connectionListFor(bag, studio.id, 'youtube');
  assert.deepEqual(list.map(c => c.accountId), ['chan-1', 'chan-2']);
});

test('reconnecting the same channel replaces it in place', () => {
  const bag = {};
  tenancy.addConnection(bag, studio.id, 'youtube', channel(1), { max: 3 });
  tenancy.addConnection(bag, studio.id, 'youtube', channel(2), { max: 3 });
  tenancy.addConnection(bag, studio.id, 'youtube', { ...channel(1), name: 'Renamed' }, { max: 3 });

  const list = tenancy.connectionListFor(bag, studio.id, 'youtube');
  assert.equal(list.length, 2, 'a reconnect is not a third credential for the same channel');
  assert.equal(list[0].name, 'Renamed');
  assert.equal(list[0].accountId, 'chan-1', 'and it keeps its position');
});

test('at a limit of one, connecting switches channel as it always did', () => {
  // Pro and Basic have a single slot. Refusing here would leave them unable to
  // change channel without finding Disconnect first -- a regression for the
  // majority of accounts, in service of a rule that only matters above one.
  const bag = {};
  tenancy.addConnection(bag, studio.id, 'youtube', channel(1), { max: 1 });
  tenancy.addConnection(bag, studio.id, 'youtube', channel(2), { max: 1 });
  const list = tenancy.connectionListFor(bag, studio.id, 'youtube');
  assert.deepEqual(list.map(c => c.accountId), ['chan-2'], 'the new channel replaces the old');
});

test('past the limit it refuses rather than evicting somebody quietly', () => {
  const bag = {};
  for (const n of [1, 2, 3]) tenancy.addConnection(bag, studio.id, 'youtube', channel(n), { max: 3 });
  assert.throws(() => tenancy.addConnection(bag, studio.id, 'youtube', channel(4), { max: 3 }), /Disconnect one first/);
  assert.equal(tenancy.connectionListFor(bag, studio.id, 'youtube').length, 3, 'nothing was dropped');
});

test('a record written before this release reads as a list of one', () => {
  const bag = { [studio.id]: { youtube: channel(9) } };
  assert.deepEqual(tenancy.connectionListFor(bag, studio.id, 'youtube').map(c => c.accountId), ['chan-9']);
  assert.equal(tenancy.connectionFor(bag, studio.id, 'youtube').accountId, 'chan-9');
});

test('disconnecting one channel leaves the others connected', () => {
  const bag = {};
  for (const n of [1, 2, 3]) tenancy.addConnection(bag, studio.id, 'youtube', channel(n), { max: 3 });
  assert.equal(tenancy.removeConnection(bag, studio.id, 'youtube', 'chan-2'), true);
  assert.deepEqual(tenancy.connectionListFor(bag, studio.id, 'youtube').map(c => c.accountId), ['chan-1', 'chan-3']);
  // Naming none still means the whole platform.
  tenancy.removeConnection(bag, studio.id, 'youtube');
  assert.deepEqual(tenancy.connectionListFor(bag, studio.id, 'youtube'), []);
});

test('a destination resolves to its OWN connection, never the first', () => {
  // The silent one. Reading "the user's YouTube" would upload a clip aimed at
  // channel 3 with channel 1's bearer token: three targets, all reporting
  // success, all landing on one channel.
  const bag = {};
  for (const n of [1, 2, 3]) tenancy.addConnection(bag, studio.id, 'youtube', channel(n), { max: 3 });
  assert.equal(tenancy.connectionByAccount(bag, studio.id, 'youtube', 'chan-3').name, 'Channel 3');
  assert.equal(tenancy.connectionByAccount(bag, studio.id, 'youtube', 'nope'), null, 'an unknown account resolves to nothing, not to the first');
});

test('a stored list of three still posts to exactly one, the first', () => {
  // THE STORE STILL HOLDS A LIST, and must, because an account that connected
  // three channels while Studio sold them (v3.41.0 to v3.125.0) has three on
  // disk. What changed on 4 Sept 2026 is the ALLOWANCE: Youssef retired the
  // feature -- "REMOVE ALL THINGS TO DO WITH 3 CHANNELS REMOVE IT" -- so
  // accountsPerPlatform answers 1 for everybody and the extras stop posting
  // without anybody having to migrate a record.
  //
  // `accountName` still comes off the RESOLVED connection, so a wrong
  // resolution shows up here as the wrong channel rather than as no channel.
  state.socialConnections[studio.id] = {};
  for (const n of [1, 2, 3]) {
    tenancy.addConnection(state.socialConnections, studio.id, 'youtube', channel(n), { max: 3 });
  }
  store.setPublishingSettings(studio, {
    enabled: true,
    youtube: { enabled: true, accountIds: ['chan-1', 'chan-2', 'chan-3'] },
  });
  const clip = {
    id: 'mc-clip', userId: studio.id, projectId: 'p', title: 'Patience', status: 'approved',
    approvedBy: 'manual', targets: [], scheduledAt: Date.now(),
  };
  state.clips.push(clip);

  const yt = social.enabledTargetsForClip(clip).filter(t => t.provider === 'youtube');
  assert.equal(yt.length, 1, 'one channel per platform, whatever is on disk');
  assert.equal(yt[0].accountName, 'Channel 1');
});

test('a blank account id is honoured only while there is exactly one channel', () => {
  // Every account written before multi-account has a blank id in its settings
  // and must keep publishing. With several connected, blank is ambiguous --
  // and guessing is how a clip lands on the wrong channel.
  state.socialConnections[studio.id] = {};
  tenancy.addConnection(state.socialConnections, studio.id, 'youtube', channel(1), { max: 3 });
  store.setPublishingSettings(studio, { enabled: true, youtube: { enabled: true, accountIds: [] } });
  const clip = {
    id: 'mc-legacy', userId: studio.id, projectId: 'p', title: 'Legacy', status: 'approved',
    approvedBy: 'manual', targets: [], scheduledAt: Date.now(),
  };
  state.clips.push(clip);
  assert.equal(social.enabledTargetsForClip(clip).filter(t => t.provider === 'youtube').length, 1,
    'one connection and no chosen id still publishes');

  tenancy.addConnection(state.socialConnections, studio.id, 'youtube', channel(2), { max: 3 });
  assert.equal(social.enabledTargetsForClip(clip).filter(t => t.provider === 'youtube').length, 0,
    'two connections and no chosen id publishes nowhere rather than guessing');
});

test('the retention sweep still scrubs channel data when the slot is a list', async () => {
  // Policy III.E.4: YouTube channel titles and avatars must not be kept beyond
  // 30 days. The sweep read each provider slot as a connection object and
  // checked `.provider` -- an array has none, so every channel would have been
  // skipped SILENTLY the moment the slot became a list. A compliance
  // obligation failing quietly is worse than one failing loudly.
  const retention = await import('../src/youtube-retention.js');
  const stale = Date.now() - 40 * 24 * 60 * 60 * 1000;
  state.socialConnections[studio.id] = {
    youtube: [
      { ...channel(1), name: 'Old One', avatar: 'a1.png', youtubeDataAt: stale },
      { ...channel(2), name: 'Old Two', avatar: 'a2.png', youtubeDataAt: stale },
    ],
  };

  retention.sweepYouTubeData({ now: Date.now() });

  const list = tenancy.connectionListFor(state.socialConnections, studio.id, 'youtube');
  assert.equal(list.length, 2, 'the connections themselves survive');
  for (const entry of list) {
    assert.equal(entry.name, '', 'the channel title is scrubbed');
    assert.equal(entry.avatar, '', 'and so is the avatar');
    // accountId stays: it is the publishing address, not a description of a
    // YouTube resource, and losing it would break the connection itself.
    assert.ok(entry.accountId, 'the address it publishes to is kept');
  }
});

test('each TikTok carries its OWN audience, not the first one\'s', async () => {
  // TikTok's guidelines make the audience a per-post choice, and one clip to
  // three TikToks is three posts. A shared value carried one creator's
  // decision onto accounts that may not even offer it.
  const opts = social.tiktokOptionsFor({
    privacy: 'PUBLIC_TO_EVERYONE', allowComments: true, allowDuet: false,
    accountOptions: { 'tt-2': { privacy: 'SELF_ONLY', allowDuet: true } },
  }, 'tt-2');
  assert.equal(opts.privacy, 'SELF_ONLY', 'the account\'s own choice wins');
  assert.equal(opts.allowDuet, true);
  assert.equal(opts.allowComments, true, 'and it inherits what it did not set');
});

test('an account that chose before per-account options existed keeps its choice', () => {
  // Every record on disk holds its answer in the flat fields. Losing that would
  // silently change what a live account posts as.
  const opts = social.tiktokOptionsFor({ privacy: 'FOLLOWER_OF_CREATOR', allowStitch: true }, 'tt-1');
  assert.equal(opts.privacy, 'FOLLOWER_OF_CREATOR');
  assert.equal(opts.allowStitch, true);
});
