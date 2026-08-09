import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import test from 'node:test';

const storeUrl = new URL('../src/store.js', import.meta.url).href;

test('corrupt primary state recovers from the last valid backup', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-recovery-'));
  fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken');
  fs.writeFileSync(path.join(dataDir, 'state.json.bak'), JSON.stringify({
    engineVersion: 4,
    projects: [], clips: [], authUsers: [{ id: 'recovered-owner', role: 'owner', email: 'owner@test.invalid' }],
  }));
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', `const {state}=await import(${JSON.stringify(storeUrl)}); process.stdout.write(state.authUsers[0].id);`], {
    env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
  });
  assert.equal(output, 'recovered-owner');
});

test('corrupt state without a usable backup refuses to boot empty', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-refuse-empty-'));
  fs.writeFileSync(path.join(dataDir, 'state.json'), '{broken');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `await import(${JSON.stringify(storeUrl)});`], {
    env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /refusing to boot empty/i);
});
