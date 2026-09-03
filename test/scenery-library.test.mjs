import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The shared scenery library: who contributed it, whether it is any good, and
 * whether anyone has watched it yet.
 *
 * Youssef, 3 Sept 2026: "if they add to Deenclipped library, it should give
 * them a couple things on the clip itself, which say who imported it, so
 * imported by, and then it should be a like and dislike button ... And then it
 * has to go through, um, like, a review process, make sure it's not anything
 * disgusting or horrible."
 *
 * The review is the load-bearing half. A video offered to every account is a
 * video that plays under somebody's reminder, so nothing reaches the shared
 * set until a person has watched it -- and a refusal must not punish the
 * person who offered.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-scenery-'));
process.env.DATA_DIR = dataDir;
const backgrounds = await import('../src/backgrounds.js');

const libraryFile = path.join(dataDir, 'backgrounds', 'library.json');
const operator = { id: 'user_op', role: 'owner' };
const alice = { id: 'user_alice' };
const bob = { id: 'user_bob' };

/** Write the library directly: registering goes through ffprobe, and this is
 *  a test of the rules around the entries rather than of the upload. */
function seed(entries) {
  fs.mkdirSync(path.dirname(libraryFile), { recursive: true });
  fs.writeFileSync(libraryFile, JSON.stringify(entries, null, 2));
}

const pending = { id: 'p1', userId: alice.id, filename: 'p1.mp4', name: 'Rain', durationSec: 8, shared: false, pendingShare: true, by: 'Alice', votes: {} };
const live = { id: 's1', userId: alice.id, filename: 's1.mp4', name: 'Mountains', durationSec: 9, shared: true, by: 'Alice', votes: {} };
const priv = { id: 'v1', userId: bob.id, filename: 'v1.mp4', name: 'My own', durationSec: 6, shared: false, votes: {} };

test('a submission is not in the library until someone has watched it', () => {
  seed([pending, priv]);
  // Bob is a stranger to it: not his, not shared, not his to review.
  assert.deepEqual(backgrounds.listBackgrounds(bob).map(e => e.id), ['v1']);
  // Alice can see what happened to her own.
  assert.ok(backgrounds.listBackgrounds(alice).some(e => e.id === 'p1'));
  // The operator sees it because the picker is where they review it.
  assert.ok(backgrounds.listBackgrounds(operator).some(e => e.id === 'p1'));
});

test('approving publishes it; declining leaves it as the uploader\'s own', () => {
  seed([pending]);
  const ok = backgrounds.reviewBackground(operator, 'p1', true);
  assert.equal(ok.shared, true);
  assert.equal(ok.pending, false);
  assert.ok(backgrounds.listBackgrounds(bob).some(e => e.id === 'p1'), 'everyone sees it now');

  seed([pending]);
  const no = backgrounds.reviewBackground(operator, 'p1', false, 'Not scenery');
  assert.equal(no.shared, false);
  assert.equal(no.pending, false);
  // The file is NOT destroyed. Taking somebody's video away because it was not
  // right for everybody would be a punishment for offering it.
  assert.ok(backgrounds.listBackgrounds(alice).some(e => e.id === 'p1'), 'Alice keeps it');
  assert.equal(backgrounds.listBackgrounds(bob).some(e => e.id === 'p1'), false);
});

test('only the operator decides, and a decision happens once', () => {
  seed([pending]);
  assert.throws(() => backgrounds.reviewBackground(bob, 'p1', true), /operator/i);
  assert.throws(() => backgrounds.reviewBackground(alice, 'p1', true), /operator/i,
    'not even the person who submitted it');
  backgrounds.reviewBackground(operator, 'p1', true);
  assert.equal(backgrounds.reviewBackground(operator, 'p1', true), null,
    'nothing is waiting on it any more');
});

test('a vote is one per account, and pressing it again clears it', () => {
  seed([live]);
  let row = backgrounds.voteBackground(bob, 's1', 1);
  assert.deepEqual([row.likes, row.dislikes, row.myVote], [1, 0, 1]);
  // Pressing the same button is how you take it back. Without that the only
  // way out of a mis-tap is the opposite opinion.
  row = backgrounds.voteBackground(bob, 's1', 1);
  assert.deepEqual([row.likes, row.dislikes, row.myVote], [0, 0, 0]);
  // Changing your mind moves the vote rather than adding one.
  backgrounds.voteBackground(bob, 's1', 1);
  row = backgrounds.voteBackground(bob, 's1', -1);
  assert.deepEqual([row.likes, row.dislikes], [0, 1]);
  row = backgrounds.voteBackground(operator, 's1', 1);
  assert.deepEqual([row.likes, row.dislikes], [1, 1], 'two accounts, two votes');
});

test('votes are only for the shared set', () => {
  seed([priv, pending]);
  assert.equal(backgrounds.voteBackground(alice, 'v1', 1), null,
    'a vote on a private upload is a vote nobody can read');
  assert.equal(backgrounds.voteBackground(bob, 'p1', 1), null,
    'and nothing is voted on before it is published');
});

test('who cast a vote never leaves the server', () => {
  seed([live]);
  backgrounds.voteBackground(bob, 's1', -1);
  const row = backgrounds.publicBackground(JSON.parse(fs.readFileSync(libraryFile, 'utf8'))[0], alice);
  // Alice learns there is one dislike, never that it was Bob's. A library
  // where everyone can see who disliked your video is one nobody submits to
  // twice.
  assert.equal(row.dislikes, 1);
  assert.equal(row.myVote, 0);
  assert.equal(JSON.stringify(row).includes(bob.id), false);
});

test('the credit names the contributor, and only where it means something', () => {
  seed([live, priv]);
  const shared = backgrounds.publicBackground(live, bob);
  assert.equal(shared.by, 'Alice');
  // On a private upload it would be the viewer's own name on their own video.
  assert.equal(backgrounds.publicBackground(priv, bob).by, '');
});

test('pendingBackgrounds is the operator\'s queue and nobody else\'s', () => {
  seed([pending, live, priv]);
  assert.deepEqual(backgrounds.pendingBackgrounds(operator).map(e => e.id), ['p1']);
  assert.deepEqual(backgrounds.pendingBackgrounds(alice), []);
  assert.deepEqual(backgrounds.pendingBackgrounds(bob), []);
});

test.after(() => { try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch { /* harmless */ } });
