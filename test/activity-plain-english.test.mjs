/*
 * THE BELL SAYS THE PLAIN THING; THE PLATFORM'S OWN WORDS ARE ONE CLICK AWAY.
 *
 * Youssef, 8 Sept 2026, looking at his own bell on production: "when people
 * look at this and they say, oh, TikTok expired, like, they're gonna be
 * confused ... make the messages more, like, shorter ... And once they click,
 * they can then see the original message, like, the error code exactly ... on
 * the back end."
 *
 * What he was reading, measured before this existed, is the RAW message
 * truncated at 150 characters -- written for diagnosis and put in the one
 * place a person looks first. Both fixtures below are his own four failures,
 * verbatim.
 *
 * Everything here drives the real adapter and reads what it RETURNS. The bug
 * this replaces was a wrong WINNER, not a missing table entry, and this repo
 * has been caught a dozen times by a test that greps a source string and
 * passes against behaviour that has changed underneath it.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await import('../src/public/safe-zones.js');
await import('../src/public/studio-adapter.js');
const { StudioAdapter } = globalThis;

// Youssef's own two, verbatim from the failures on his account.
const TIKTOK_RAW = 'The TikTok connection has expired: TikTok error: Refresh token is invalid or expired. Reconnect the account in Connections.';
const YOUTUBE_RAW = 'The YouTube connection has expired: YouTube returned 400: Token has been expired or revoked. Reconnect the channel in Connections.';
const IMPORT_RAW = 'yt-dlp: ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you are not a bot. Use --cookies-from-browser or --cookies for the authentication.';

const at = Date.now() - 60e3;

function withFailure(provider, error, extra) {
  return Object.assign({
    projects: [], tracks: [],
    clips: [{
      id: 'c1', title: 'Surah An-Nisaa 102', status: 'publish_failed',
      targets: [{ id: provider + ':a1', provider, accountId: 'a1', accountName: 'DeenClipped',
        status: 'failed', error, updatedAt: at }],
    }],
  }, extra || {});
}

function rowsFor(data) {
  Object.assign(StudioAdapter.ui, { bellOpen: true, activityAll: true, activityDetail: null });
  return StudioAdapter.bindings(data).activity;
}

function detailFor(data) {
  const row = rowsFor(data)[0];
  assert.ok(row, 'the failure reaches the bell');
  Object.assign(StudioAdapter.ui, { activityDetail: row.id });
  const vals = StudioAdapter.bindings(data);
  Object.assign(StudioAdapter.ui, { bellOpen: false, activityAll: false, activityDetail: null });
  return { row, vals };
}

test('the row a customer reads is the plain line, not the platform’s own words', () => {
  const row = rowsFor(withFailure('tiktok', TIKTOK_RAW))[0];
  // The whole complaint: what used to be here was `shortError(raw)`.
  assert.doesNotMatch(row.meta, /Refresh token/i, 'the raw wording is off the row');
  assert.doesNotMatch(row.meta, /error:/i);
  assert.match(row.meta, /TikTok/, 'and the destination is named, because the row is about one');
  assert.match(row.meta, /reconnect/i, 'in the words the guidance table already had');
  // A row still says when. Losing that would be trading one fault for another.
  assert.match(row.meta, /ago|now/i);
});

test('an import failure loses its command line too', () => {
  const row = rowsFor({ tracks: [], clips: [], projects: [
    { id: 'p1', title: 'A lecture', status: 'failed', error: IMPORT_RAW,
      errorCode: 'import_blocked', submittedAt: at - 6e5, completedAt: at },
  ] })[0];
  // `--cookies-from-browser` in front of a customer is not a message, it is a
  // stack trace with a timestamp on it.
  assert.doesNotMatch(row.meta, /cookies|yt-dlp|dQw4w9WgXcQ/i);
  assert.match(row.meta, /blocked our server/i, 'the import table already knew how to say this');
});

test('the platform’s own words survive, verbatim, behind the row', () => {
  const { row, vals } = detailFor(withFailure('tiktok', TIKTOK_RAW));
  assert.equal(vals.activityDetailRaw, TIKTOK_RAW, 'not truncated, not reworded');
  assert.equal(vals.activityDetailHasRaw, true);
  // Moving the raw off the ROW is not losing it: the row keeps `full`, which
  // is what the detail, the copy button and anything added later read.
  assert.match(String(row.full || ''), /Refresh token/i);
});

test('one guidance entry names all four destinations', () => {
  // Six of the publish entries are written as "the platform ..." because one
  // entry serves every destination. On a row, which names none of its own,
  // that is a sentence about nobody.
  const tiktok = detailFor(withFailure('tiktok', TIKTOK_RAW));
  const youtube = detailFor(withFailure('youtube', YOUTUBE_RAW));
  assert.match(tiktok.vals.activityDetailHeading, /^TikTok/);
  assert.match(youtube.vals.activityDetailHeading, /^YouTube/);
  assert.notEqual(tiktok.vals.activityDetailHeading, youtube.vals.activityDetailHeading);
  // Same entry underneath: the cause and the steps are the shared ones.
  assert.equal(tiktok.vals.activityDetailCause, youtube.vals.activityDetailCause);
});

test('no {platform} token ever reaches a screen', () => {
  // The substitution is what makes one entry serve four destinations, and a
  // token left in place would print `{platform}` at a customer.
  const surfaces = [];
  ['tiktok', 'youtube', 'instagram', 'facebook'].forEach(provider => {
    [TIKTOK_RAW, YOUTUBE_RAW,
      'Quota exceeded: the account has exceeded the number of videos it may upload',
      'rate limit reached, too_many_posts',
      'duplicate: this identical video has already been uploaded',
      'The file is too large and the duration exceeds the maximum',
      'Blocked for copyright: a content ID claim was made',
      'Something nobody has a table entry for at all',
    ].forEach(error => {
      const { row, vals } = detailFor(withFailure(provider, error));
      surfaces.push(row.meta, vals.activityDetailHeading);
    });
  });
  assert.equal(surfaces.length, 64, '4 destinations x 8 messages, a row line and a heading each');
  assert.doesNotMatch(surfaces.join('|'), /\{platform\}/, 'every entry substitutes');
  surfaces.forEach(text => assert.ok(text.trim().length > 3, 'and none of them is empty'));
});

test('the guidance is never classified by its own output', () => {
  // The row's `meta` is now a sentence THIS TABLE produced, and
  // `explainFailure` reads full -> meta -> text. A row whose `full` is empty
  // would therefore be classified by a sentence a previous classification
  // wrote, so the answer travels with the row instead of being asked twice.
  const row = rowsFor(withFailure('tiktok', TIKTOK_RAW))[0];
  assert.ok(row.why, 'the classification travels with the row');
  assert.match(row.why.title, /connection/i);

  // And the hazard is not theoretical. A duplicate refusal reads plainly as
  // "TikTok already has this clip" -- which matches none of the table's own
  // patterns, so asking again from the row would answer with the generic
  // fallback instead of the entry that was actually chosen.
  const dupe = rowsFor(withFailure('tiktok',
    'duplicate: this identical video has already been uploaded'))[0];
  assert.match(dupe.why.title, /duplicate/i);
  const reclassified = StudioAdapter.explainFailure({ provider: 'tiktok',
    text: 'Publish failed · Clip', meta: dupe.meta, full: '' });
  assert.notEqual(reclassified.title, dupe.why.title,
    'which is exactly why the answer is carried rather than recomputed');
});

test('the original message is never this app’s own sentence', () => {
  // Falling back to the row's `meta` would print the plain line we just wrote
  // under "The original message" and claim it was the platform's.
  const spoke = detailFor(withFailure('tiktok', TIKTOK_RAW));
  assert.notEqual(spoke.vals.activityDetailRaw, spoke.vals.activityDetailHeading);
  assert.doesNotMatch(spoke.vals.activityDetailRaw, /needs reconnecting/,
    'the plain wording is not quoted back as the platform’s');

  // And with nothing original anywhere, the block is not drawn at all rather
  // than padded out with something that reads like a quote.
  const { vals } = detailFor(withFailure('tiktok', ''));
  assert.equal(vals.activityDetailHasRaw, false, 'the block is not drawn');
  assert.equal(vals.activityDetailRaw, '');

  // A target that failed carrying only a stage DOES have something original,
  // and the row has always quoted it -- the detail must not be the one place
  // it disappears.
  const staged = withFailure('tiktok', '');
  staged.clips[0].targets[0].stage = 'uploading to tiktok';
  const only = detailFor(staged);
  assert.equal(only.vals.activityDetailHasRaw, true);
  assert.equal(only.vals.activityDetailRaw, 'uploading to tiktok');
});

test('the reference under the buttons is never empty on a publish failure', () => {
  // A publish failure carries no error code at all, so this slot rendered
  // empty on exactly the rows most likely to be reported.
  const { vals } = detailFor(withFailure('tiktok', TIKTOK_RAW));
  assert.ok(vals.activityDetailCode, 'there is something to quote');
  assert.match(vals.activityDetailCode, /tiktok/i, 'which destination');
  assert.match(vals.activityDetailCode, /\d{1,2} \w{3} \d{2}:\d{2}/, 'and which minute');
  // A code from the pipeline still wins: it is more precise than a clock.
  const coded = rowsFor({ tracks: [], clips: [], projects: [
    { id: 'p1', title: 'L', status: 'failed', error: IMPORT_RAW,
      errorCode: 'import_blocked', submittedAt: at - 6e5, completedAt: at },
  ] })[0];
  Object.assign(StudioAdapter.ui, { bellOpen: true, activityAll: true, activityDetail: coded.id });
  const vals2 = StudioAdapter.bindings({ tracks: [], clips: [], projects: [
    { id: 'p1', title: 'L', status: 'failed', error: IMPORT_RAW,
      errorCode: 'import_blocked', submittedAt: at - 6e5, completedAt: at },
  ] });
  assert.equal(vals2.activityDetailCode, 'import_blocked');
  Object.assign(StudioAdapter.ui, { bellOpen: false, activityAll: false, activityDetail: null });
});

/*
 * The copy button is a host node in generated markup, so these are source
 * assertions with the reason CI has no browser: each of them fails SILENTLY
 * in the app -- the panel renders, the suite stays green, and the button
 * either churns every poll or is deleted by the patcher.
 */
const HTML = fs.readFileSync(path.join(ROOT, 'src/public/index.html'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');   // strip comments: they quote what was removed

test('the copy button is host-owned and painted from paintStudio', () => {
  const painter = HTML.slice(HTML.indexOf('function paintActivityCopy'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  assert.match(body, /setAttribute\('data-host-owned'/,
    'or the runtime patcher removes it on the next repaint');
  const paint = HTML.slice(HTML.indexOf('function paintStudio()'));
  assert.match(paint.slice(0, paint.indexOf('\nfunction ')), /paintActivityCopy\(vals/,
    'in paintStudio’s list like every other host panel, never on an observer');
});

test('the copied report is built from the bindings, not scraped off the card', () => {
  // A first cut walked the card's spans for anything with a separator in it
  // and took the last -- which was the code, silently dropping WHICH CLIP and
  // WHEN. Read from `vals` the copy cannot say something the screen does not.
  const painter = HTML.slice(HTML.indexOf('function paintActivityCopy'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  ['activityDetailHeading', 'activityDetailTitle', 'activityDetailWhen',
    'activityDetailCode', 'activityDetailRaw'].forEach(key => {
    assert.match(body, new RegExp('v\\.' + key), 'the report carries ' + key);
  });
  assert.doesNotMatch(body, /querySelectorAll\('span'\)|querySelectorAll\("span"\)/,
    'and does not go looking for it in the DOM');
});

test('the button is anchored on text, never on a generated class', () => {
  const painter = HTML.slice(HTML.indexOf('function paintActivityCopy'));
  const body = painter.slice(0, painter.indexOf('\nfunction '));
  assert.match(body, /The original message/, 'found by the summary’s own words');
  assert.doesNotMatch(body, /\.s[0-9][0-9a-z]/,
    'a hashed class renumbers on every design re-import');
});
