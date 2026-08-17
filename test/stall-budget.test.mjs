import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-stall-'));
const { stallBudgetFor } = await import('../src/local-engine.js');
const { config } = await import('../src/config.js');

// The import phase used to be judged by the five-minute stall budget while
// emitting no status at all, so every download longer than five minutes was
// cancelled as hung. MAX_SOURCE_MINUTES is 180 — the product's core case is a
// lecture that takes far longer than five minutes to fetch.

test('the import is given the import timeout, not the stall budget', () => {
  for (const stage of ['queued', 'importing', 'downloading', 'Importing', 'DOWNLOADING']) {
    assert.ok(
      stallBudgetFor(stage) >= config.videoImportTimeoutMs,
      `${stage} must survive a full-length download`,
    );
  }
});

test('stages after the worker starts keep the tight stall budget', () => {
  for (const stage of ['transcribing', 'Rendering clip 1 of 8', 'Verifying rendered clips', 'analysing']) {
    assert.ok(
      stallBudgetFor(stage) < config.videoImportTimeoutMs,
      `${stage} heartbeats every 10s, so silence there is a real stall`,
    );
  }
});

test('an unknown or empty stage falls back to the tight budget', () => {
  // Anything unrecognised is past the import, so it should not get half an hour
  // of grace by accident.
  const tight = stallBudgetFor('transcribing');
  assert.equal(stallBudgetFor(''), tight);
  assert.equal(stallBudgetFor(undefined), tight);
  assert.equal(stallBudgetFor('something new'), tight);
});

test('the import budget clears the configured import timeout with headroom', () => {
  assert.ok(
    stallBudgetFor('importing') > config.videoImportTimeoutMs,
    'a download that runs to its own timeout must fail as a timeout, not as a stall',
  );
});

// ── failure classification survives the remote path ────────────────────────
const { customerSafeProjectError } = await import('../src/local-engine.js');

test('a YouTube block keeps its own code, not a generic one', () => {
  // The remote path overwrote this with 'processing_failed', discarding the one
  // failure a customer can actually act on — upload the MP4 instead.
  const blocked = customerSafeProjectError('ERROR: Sign in to confirm you are not a bot. Use --cookies-from-browser');
  assert.equal(blocked.code, 'youtube_import_blocked');
  assert.match(blocked.message, /Upload the original MP4/i);
  assert.doesNotMatch(blocked.message, /cookies-from-browser/, 'the raw yt-dlp advice must not reach a customer');
});

test('an unclassified failure still falls back to the generic code', () => {
  const other = customerSafeProjectError('ffmpeg exited with status 1');
  assert.equal(other.code, 'processing_failed');
});
