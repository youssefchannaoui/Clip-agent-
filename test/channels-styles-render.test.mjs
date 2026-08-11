import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Executed-output tests, not source greps. A card that renders the wrong
// thing still passes `node --check` and still passes any test that only
// looks for strings in the file — that is exactly how Quality Center
// shipped broken.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const between = (from, to) => {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return ui.slice(start, end);
};

const stubs = `
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const shortText = (v, n) => String(v || '').slice(0, n);
const shortError = v => String(v || '');
const formatRelative = () => '2 hours ago';
const socialSvg = k => '<svg data-logo="' + k + '"></svg>';
const providerTitle = p => ({youtube:'YouTube Shorts',tiktok:'TikTok',instagram:'Instagram Reels',facebook:'Facebook Reels'}[p] || p);
const providerBadge = i => !i.configured ? 'bad' : i.enabled ? 'good' : i.connected ? 'warn' : '';
const ICON = { search: '<svg data-icon="search"></svg>' };
`;

const mod = new Function(
  stubs +
  between('function connectionCard(info){', 'async function beginSocialConnection') +
  '; return { connectionCard };',
)();

const channel = (over = {}) => ({
  provider: 'youtube', connectProvider: 'youtube', configured: true, connected: true, enabled: true,
  account: { name: 'Dunya Decoded' }, status: {}, setting: {}, accounts: [],
  ...over,
});

test('a connected channel offers Reconnect plus test and disconnect', () => {
  const html = mod.connectionCard(channel());
  assert.doesNotMatch(html, /\[object Object\]/);
  assert.match(html, /data-social-connect="youtube"/);
  assert.match(html, /data-social-test="youtube"/);
  assert.match(html, /data-social-disconnect="youtube"/);
  assert.match(html, /Reconnect/);
  assert.match(html, /Dunya Decoded/);
  assert.match(html, />Active</);
});

test('an unconnected channel offers Connect and hides destructive actions', () => {
  const html = mod.connectionCard(channel({ connected: false, enabled: false, account: null }));
  assert.match(html, />Connect</);
  assert.doesNotMatch(html, /data-social-disconnect/, 'nothing to disconnect yet');
  assert.match(html, /No account linked/);
});

test('a channel missing API keys is disabled, not silently clickable', () => {
  const html = mod.connectionCard(channel({ configured: false, connected: false, enabled: false }));
  assert.match(html, /data-social-connect="youtube" disabled/);
  assert.match(html, /Needs API keys in Render/);
  assert.match(html, /dc-pill bad/);
});

test('a healthy channel shows no filler status line', () => {
  // Every card carrying a sentence regardless of state is what made this
  // page noisy; the health line should only appear when it says something.
  const html = mod.connectionCard(channel());
  assert.doesNotMatch(html, /dc-channel-health/);
});

test('a channel with a connection error surfaces it', () => {
  const html = mod.connectionCard(channel({ status: { lastTestError: 'Token has been expired or revoked.' } }));
  assert.match(html, /dc-channel-health bad/);
  assert.match(html, /Token has been expired or revoked/);
});

test('each platform keeps its own logo and brand class', () => {
  for (const provider of ['youtube', 'tiktok', 'instagram', 'facebook']) {
    const html = mod.connectionCard(channel({ provider, connectProvider: provider }));
    assert.match(html, new RegExp(`dc-social-logo ${provider}`), `${provider} logo class`);
    assert.match(html, new RegExp(`data-logo="${provider}"`), `${provider} mark`);
  }
});
