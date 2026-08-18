import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-editor-save-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'editor-save-scope-secret-long-enough';

const templates = await import('../src/templates.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

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
