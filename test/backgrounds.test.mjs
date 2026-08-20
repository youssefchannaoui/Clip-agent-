import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-backgrounds-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'backgrounds-test-secret-long-enough';

const backgrounds = await import('../src/backgrounds.js');
const backgroundsDir = path.join(dataDir, 'backgrounds');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

function seed(entries) {
  fs.mkdirSync(backgroundsDir, { recursive: true });
  fs.writeFileSync(path.join(backgroundsDir, 'library.json'), JSON.stringify(entries));
  for (const entry of entries) fs.writeFileSync(path.join(backgroundsDir, entry.filename), 'x');
}

test('an account sees its own videos and the shared starter set, never another account\'s', () => {
  seed([
    { id: 'a1', userId: 'user_a', shared: false, name: 'Rain', filename: 'a1.mp4', durationSec: 20 },
    { id: 's1', userId: 'user_admin', shared: true, name: 'Clouds', filename: 's1.mp4', durationSec: 30 },
    { id: 'b1', userId: 'user_b', shared: false, name: 'Private', filename: 'b1.mp4', durationSec: 15 },
  ]);
  const names = backgrounds.listBackgrounds({ id: 'user_a' }).map(e => e.name).sort();
  assert.deepEqual(names, ['Clouds', 'Rain']);
});

test('backgroundForJob honours a named pick and refuses another account\'s video', () => {
  const picked = backgrounds.backgroundForJob({ id: 'user_a' }, 'a1');
  assert.equal(picked.name, 'Rain');
  assert.ok(fs.existsSync(picked.path), 'the resolved path points at the real file');
  assert.equal(backgrounds.backgroundForJob({ id: 'user_a' }, 'b1'), null, 'another account\'s id resolves to nothing');
});

test('the shuffle case picks only from what the account can use', () => {
  for (let i = 0; i < 12; i++) {
    const chosen = backgrounds.backgroundForJob({ id: 'user_a' }, '');
    assert.ok(['Rain', 'Clouds'].includes(chosen.name), chosen.name);
  }
});

test('a missing file drops out of the pool instead of rendering a black clip', () => {
  fs.rmSync(path.join(backgroundsDir, 'a1.mp4'));
  assert.equal(backgrounds.backgroundForJob({ id: 'user_a' }, 'a1'), null);
});

test('deleting is confined to your own uploads', () => {
  assert.equal(backgrounds.deleteBackground({ id: 'user_a' }, 's1'), false, 'the shared set stays put');
  assert.equal(backgrounds.deleteBackground({ id: 'user_a' }, 'b1'), false, 'another account\'s video is untouchable');
  seed([{ id: 'a2', userId: 'user_a', shared: false, name: 'Mine', filename: 'a2.mp4', durationSec: 9 }]);
  assert.equal(backgrounds.deleteBackground({ id: 'user_a' }, 'a2'), true);
  assert.equal(fs.existsSync(path.join(backgroundsDir, 'a2.mp4')), false, 'the file goes with the entry');
});

test('the operator curates the shared stock set; nobody else can', () => {
  seed([{ id: 'st1', userId: 'user_admin', shared: true, name: 'Stock', filename: 'st1.mp4', durationSec: 30 }]);
  assert.equal(backgrounds.deleteBackground({ id: 'user_a' }, 'st1', { operator: false }), false, 'a creator cannot delete stock');
  assert.equal(backgrounds.deleteBackground({ id: 'user_admin' }, 'st1', { operator: true }), true, 'the operator can');
});
