import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ownerOf, ownedBy, findOwned, canAccess, assertOwned, withOwner,
  connectionsFor, connectionFor, setConnection, removeConnection,
  userSettings, readUserSetting, writeUserSetting,
  migrateToMultiTenant, findUnownedRecords,
} from '../src/tenancy.js';

const alice = { id: 'user_alice', role: 'creator' };
const bob = { id: 'user_bob', role: 'creator' };
const operator = { id: 'user_admin', role: 'owner' };

test('ownedBy returns only that account\'s records', () => {
  const clips = [{ id: 'a', userId: 'user_alice' }, { id: 'b', userId: 'user_bob' }];
  assert.deepEqual(ownedBy(clips, 'user_alice').map(c => c.id), ['a']);
  assert.deepEqual(ownedBy(clips, 'user_bob').map(c => c.id), ['b']);
});

test('ownedBy returns nothing for a missing user id rather than everything', () => {
  const clips = [{ id: 'a', userId: 'user_alice' }, { id: 'b', userId: 'user_bob' }];
  assert.deepEqual(ownedBy(clips, ''), []);
  assert.deepEqual(ownedBy(clips, null), []);
  assert.deepEqual(ownedBy(clips, undefined), []);
  assert.deepEqual(ownedBy(null, 'user_alice'), []);
});

test('findOwned refuses to return another account\'s record', () => {
  const clips = [{ id: 'a', userId: 'user_alice' }];
  assert.equal(findOwned(clips, 'a', 'user_alice').id, 'a');
  assert.equal(findOwned(clips, 'a', 'user_bob'), null);
  assert.equal(findOwned(clips, 'a', ''), null);
});

test('ownerOf reads the legacy ownerId field', () => {
  assert.equal(ownerOf({ userId: 'user_alice' }), 'user_alice');
  assert.equal(ownerOf({ ownerId: 'user_bob' }), 'user_bob');
  assert.equal(ownerOf({}), null);
  assert.equal(ownerOf(null), null);
});

test('canAccess confines creators and lets the operator through', () => {
  const clip = { id: 'a', userId: 'user_alice' };
  assert.equal(canAccess(clip, alice), true);
  assert.equal(canAccess(clip, bob), false);
  assert.equal(canAccess(clip, operator), true);
  assert.equal(canAccess(clip, null), false);
  assert.equal(canAccess(null, alice), false);
});

test('assertOwned throws a 404 that does not reveal the record exists', () => {
  const clip = { id: 'a', userId: 'user_alice' };
  assert.equal(assertOwned(clip, alice).id, 'a');
  assert.throws(() => assertOwned(clip, bob, 'clip'), (error) => {
    assert.equal(error.statusCode, 404);
    assert.match(error.message, /not found/i);
    assert.doesNotMatch(error.message, /permission|forbidden|another/i);
    return true;
  });
});

test('withOwner refuses to create a record with no owner', () => {
  assert.equal(withOwner({ id: 'a' }, 'user_alice').userId, 'user_alice');
  assert.throws(() => withOwner({ id: 'a' }, ''), /cannot be created without an owner/);
});

test('social connections are separated by account', () => {
  const connections = {};
  setConnection(connections, 'user_alice', 'youtube', { provider: 'youtube', accountId: 'chan_alice' });
  setConnection(connections, 'user_bob', 'youtube', { provider: 'youtube', accountId: 'chan_bob' });

  assert.equal(connectionFor(connections, 'user_alice', 'youtube').accountId, 'chan_alice');
  assert.equal(connectionFor(connections, 'user_bob', 'youtube').accountId, 'chan_bob');
  assert.equal(connectionFor(connections, 'user_carol', 'youtube'), null);
  assert.deepEqual(connectionsFor(connections, 'user_carol'), {});
});

test('removing one account\'s connection leaves the other connected', () => {
  const connections = {};
  setConnection(connections, 'user_alice', 'youtube', { provider: 'youtube' });
  setConnection(connections, 'user_bob', 'youtube', { provider: 'youtube' });

  assert.equal(removeConnection(connections, 'user_alice', 'youtube'), true);
  assert.equal(connectionFor(connections, 'user_alice', 'youtube'), null);
  assert.ok(connectionFor(connections, 'user_bob', 'youtube'));
  assert.equal(removeConnection(connections, 'user_alice', 'youtube'), false);
});

test('a connection cannot be stored without an owner', () => {
  assert.throws(() => setConnection({}, '', 'youtube', {}), /needs an owner/);
});

test('settings are held per account', () => {
  const state = {};
  writeUserSetting(state, 'user_alice', 'clipSettings', { clipsPerVideo: 3 });
  writeUserSetting(state, 'user_bob', 'clipSettings', { clipsPerVideo: 9 });

  assert.equal(readUserSetting(state, 'user_alice', 'clipSettings').clipsPerVideo, 3);
  assert.equal(readUserSetting(state, 'user_bob', 'clipSettings').clipsPerVideo, 9);
  assert.equal(readUserSetting(state, 'user_carol', 'clipSettings'), undefined);
  assert.deepEqual(userSettings(state, 'user_carol'), {});
});

test('migration gives genuinely unowned records to the owner account', () => {
  const state = {
    projects: [{ id: 'p1' }],
    clips: [{ id: 'c1' }, { id: 'c2' }],
    rerenderJobs: [], publishJobs: [], socialConnections: {},
  };
  const summary = migrateToMultiTenant(state, 'user_admin');

  assert.equal(summary.alreadyMigrated, false);
  assert.equal(summary.projects, 1);
  assert.equal(summary.clips, 2);
  assert.equal(state.clips.every(c => c.userId === 'user_admin'), true);
  assert.deepEqual(findUnownedRecords(state), []);
});

test('migration keeps records that already name an owner via the legacy ownerId', () => {
  // The engine wrote `ownerId` long before `userId` was canonical. Assigning
  // these to the operator would hand them every customer's work.
  const state = {
    projects: [{ id: 'p1', ownerId: 'user_bob' }],
    clips: [{ id: 'c1', ownerId: 'user_bob' }, { id: 'c2', ownerId: 'user_alice' }],
    rerenderJobs: [], publishJobs: [], socialConnections: {},
  };
  migrateToMultiTenant(state, 'user_admin');

  assert.equal(state.projects[0].userId, 'user_bob');
  assert.equal(state.clips[0].userId, 'user_bob');
  assert.equal(state.clips[1].userId, 'user_alice');
  assert.equal(ownedBy(state.clips, 'user_admin').length, 0);
});

test('migration normalises away the legacy ownerId field', () => {
  const state = {
    clips: [{ id: 'c1', ownerId: 'user_bob' }],
    projects: [], rerenderJobs: [], publishJobs: [], socialConnections: {},
  };
  migrateToMultiTenant(state, 'user_admin');
  assert.equal(state.clips[0].ownerId, undefined);
  assert.equal(state.clips[0].userId, 'user_bob');
});

test('migration moves flat social connections under the owner account', () => {
  const state = {
    projects: [], clips: [], rerenderJobs: [], publishJobs: [],
    socialConnections: {
      youtube: { provider: 'youtube', accountId: 'chan_1' },
      tiktok: { provider: 'tiktok', accountId: 'tt_1' },
    },
  };
  migrateToMultiTenant(state, 'user_admin');

  assert.equal(state.socialConnections.youtube, undefined);
  assert.equal(connectionFor(state.socialConnections, 'user_admin', 'youtube').accountId, 'chan_1');
  assert.equal(connectionFor(state.socialConnections, 'user_admin', 'tiktok').accountId, 'tt_1');
  assert.equal(connectionFor(state.socialConnections, 'user_bob', 'youtube'), null);
});

test('migration moves the old global settings to the owner account', () => {
  const state = {
    projects: [], clips: [], rerenderJobs: [], publishJobs: [], socialConnections: {},
    clipSettings: { clipsPerVideo: 7 },
    selectedTemplateId: 'viral-stacked',
    publishingSettings: { enabled: true },
  };
  migrateToMultiTenant(state, 'user_admin');

  assert.equal(readUserSetting(state, 'user_admin', 'clipSettings').clipsPerVideo, 7);
  assert.equal(readUserSetting(state, 'user_admin', 'selectedTemplateId'), 'viral-stacked');
  assert.equal(state.clipSettings, undefined);
  assert.equal(readUserSetting(state, 'user_bob', 'clipSettings'), undefined);
});

test('migration is safe to run repeatedly and never reassigns data', () => {
  const state = {
    projects: [{ id: 'p1', ownerId: 'user_bob' }],
    clips: [{ id: 'c1' }],
    rerenderJobs: [], publishJobs: [],
    socialConnections: { youtube: { provider: 'youtube', accountId: 'chan_1' } },
    clipSettings: { clipsPerVideo: 7 },
  };

  migrateToMultiTenant(state, 'user_admin');
  const snapshot = JSON.stringify(state);

  const second = migrateToMultiTenant(state, 'user_admin');
  assert.equal(second.alreadyMigrated, true);
  assert.equal(JSON.stringify(state), snapshot);

  // Even a redeploy under a different owner id must not move existing data.
  const third = migrateToMultiTenant(state, 'user_someone_else');
  assert.equal(third.alreadyMigrated, true);
  assert.equal(state.projects[0].userId, 'user_bob');
  assert.equal(state.clips[0].userId, 'user_admin');
});

test('migration needs an owner account id', () => {
  assert.throws(() => migrateToMultiTenant({}, ''), /needs the owner account id/);
  assert.throws(() => migrateToMultiTenant(null, 'user_admin'), /needs the owner account id/);
});

test('findUnownedRecords reports records that escaped the migration', () => {
  const state = { clips: [{ id: 'c1', userId: 'user_alice' }, { id: 'c2' }], projects: [{ id: 'p1' }] };
  const orphans = findUnownedRecords(state);
  assert.equal(orphans.length, 2);
  assert.deepEqual(orphans.map(o => o.id).sort(), ['c2', 'p1']);
});
