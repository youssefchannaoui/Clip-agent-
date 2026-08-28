import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-editor-save-'));
process.env.DATA_DIR = dataDir;
// AUTH_REQUIRED defaults to on now, so a test that calls routes without a
// session has to say that is what it means to do.
process.env.AUTH_REQUIRED = 'false';
process.env.APP_SESSION_SECRET = 'editor-save-scope-secret-long-enough';

const templates = await import('../src/templates.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

test('the framing fields are the whole Framing tab, not just the crop offsets', () => {
  // cropPositionX/Y alone were protected; fitMode, zoom and the face toggle were
  // not, so "Save to all clips" re-cropped every sibling onto this clip's frame.
  for (const field of ['cropPositionX', 'cropPositionY', 'fitMode', 'smartFramingZoom', 'smartFramingEnabled']) {
    assert.ok(templates.FRAMING_FIELDS.includes(field), `${field} must stay per-clip`);
  }
});

test('applying one clip\'s look keeps each sibling\'s own framing', () => {
  // The transformation the apply-style route performs, stated as data: the look
  // is taken from the edited clip, the framing is whatever the sibling had.
  const edited = { captionFont: 'Amiri', captionPrimary: '#FFFFFF', fitMode: 'crop', cropPositionX: 0.1, smartFramingZoom: 1.8 };
  const sibling = { captionFont: 'Open Sans', cropPositionX: 0.9, smartFramingZoom: 1.1 };

  const keptFraming = {};
  for (const field of templates.FRAMING_FIELDS) {
    if (sibling[field] !== undefined) keptFraming[field] = sibling[field];
  }
  const look = { ...edited };
  for (const field of templates.FRAMING_FIELDS) delete look[field];
  const result = { ...look, ...keptFraming };

  // The look travelled.
  assert.equal(result.captionFont, 'Amiri');
  assert.equal(result.captionPrimary, '#FFFFFF');
  // Two clips are two moments: the speaker is elsewhere in each frame, so this
  // sibling keeps the crop that was framed for it.
  assert.equal(result.cropPositionX, 0.9);
  assert.equal(result.smartFramingZoom, 1.1);
  // And a framing field the edited clip set does not leak across.
  assert.equal(result.fitMode, undefined);
});

test('saving a recitation clip untouched is not an edit', async () => {
  // The editor draws the matched verse in place of what Whisper heard. Saving
  // used to join what was drawn, so opening a Quran clip and pressing Save
  // replaced the transcript with the ayahs -- each one repeated once per
  // caption block -- and marked the clip edited. Every later re-render then
  // captioned one flat span with no timings and ran seconds ahead of the
  // recitation.
  const { isAyahEcho } = await import('../src/store.js');
  const clip = {
    transcript: 'ولا تحسبن الذين قتلوا في سبيل الله أمواتا',
    ayahs: [
      { arabic: 'وَلَا تَحْسَبَنَّ ٱلَّذِينَ قُتِلُوا۟', start: 0, end: 4 },
      { arabic: 'وَلَا تَحْسَبَنَّ ٱلَّذِينَ قُتِلُوا۟', start: 4, end: 9 },
      { arabic: 'فَرِحِينَ بِمَآ ءَاتَىٰهُمُ ٱللَّهُ', start: 9, end: 16 },
    ],
  };
  const echo = clip.ayahs.map(a => a.arabic).join(' ');
  assert.equal(isAyahEcho(clip, echo), true);
  assert.equal(isAyahEcho(clip, `${echo} `), true, 'whitespace alone is not an edit');
  assert.equal(isAyahEcho(clip, 'the words the user actually typed'), false);
  assert.equal(isAyahEcho({ ...clip, ayahs: [] }, echo), false, 'a clip with no ayahs cannot echo one');
});
