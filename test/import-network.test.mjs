import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-import-network-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'import-network-test-secret-long-enough';

const store = await import('../src/store.js');
const engine = await import('../src/local-engine.js');

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

test('a partial update keeps the credential it does not mention', () => {
  // The admin form never echoes saved values back, so an update that only
  // carries a proxy must not wipe the cookies the operator cannot see.
  store.setImportNetworkSettings({ proxy: 'http://u:p@proxy.test:8080', cookiesText: '# Netscape\n.youtube.com\tTRUE\t/\tcookie' });
  store.setImportNetworkSettings({ proxy: 'http://u2:p2@proxy.test:8080' });
  const settings = store.importNetworkSettings();
  assert.equal(settings.proxy, 'http://u2:p2@proxy.test:8080');
  assert.match(settings.cookiesText, /youtube\.com/, 'cookies survived a proxy-only update');
  store.setImportNetworkSettings({ proxy: '', cookiesText: '' });
  assert.deepEqual(store.importNetworkSettings(), { proxy: '', cookiesText: '' });
});

test('a YouTube source carries the network settings; an upload never does', () => {
  store.setImportNetworkSettings({ proxy: 'http://u:p@proxy.test:8080', cookiesText: '' });
  const linked = engine.withImportNetwork({ type: 'youtube', url: 'https://www.youtube.com/watch?v=abc12345678' });
  assert.equal(linked.network.proxy, 'http://u:p@proxy.test:8080');
  assert.equal(linked.network.cookiesText, undefined, 'unset cookies are absent, not empty');
  // An upload never talks to YouTube and must not carry credentials it has no
  // use for.
  const upload = engine.withImportNetwork({ type: 'object_storage', objectKey: 'uploads/u/x.mp4' });
  assert.equal(upload.network, undefined);
  store.setImportNetworkSettings({ proxy: '', cookiesText: '' });
});

test('with nothing configured the source is untouched', () => {
  const source = { type: 'youtube', url: 'https://www.youtube.com/watch?v=abc12345678' };
  assert.equal(engine.withImportNetwork(source), source);
});

test('a listed operator email is elevated even for an account that already exists', async () => {
  // Production disables the admin-password fallback, so the bootstrap owner
  // cannot sign in and no living account could reach an operator page. The
  // listed operator's existing creator account must be promoted on boot, not
  // only at sign-up.
  const auth = await import('../src/auth.js');
  const { state } = store;
  auth.ownerUser(); // bootstrap first, as production did long ago
  state.authUsers.push({ id: 'user_op_test', email: 'youssefchannaoui05@gmail.com', role: 'creator', providers: {}, createdAt: Date.now() });
  auth.ownerUser(); // any auth entry point runs ensureAuthState -> elevateOperators
  const promoted = state.authUsers.find(user => user.id === 'user_op_test');
  assert.equal(promoted.role, 'admin');
  // The bootstrap owner is untouched and an unlisted account stays a creator.
  state.authUsers.push({ id: 'user_random', email: 'someone@example.com', role: 'creator', providers: {}, createdAt: Date.now() });
  auth.ownerUser();
  assert.equal(state.authUsers.find(user => user.id === 'user_random').role, 'creator');
  assert.equal(state.authUsers.find(user => user.role === 'owner')?.id, 'user_admin');
});
