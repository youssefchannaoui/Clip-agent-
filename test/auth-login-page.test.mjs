import test from 'node:test';
import assert from 'node:assert/strict';

const auth = await import('../src/auth.js');

test('login page uses the public-site brand system and real product assets', () => {
  const html = auth.loginPage({ returnTo: '/app?view=projects' });

  assert.match(html, /DeenClipped/);
  assert.match(html, /Turn long lectures into/);
  assert.match(html, /powerful short clips/);
  assert.match(html, /\/marketing-assets\/hero-premium\.webp/);
  assert.match(html, /\/marketing-assets\/reel-beneficial\.webp/);
  assert.match(html, /Back to website/);
  assert.match(html, /name="returnTo" value="\/app\?view=projects"/);
});

test('login page keeps the creator form accessible and does not expose user content', () => {
  const html = auth.loginPage({ error: '<invalid>', info: 'Try again' });

  assert.match(html, /label for="creator-email"/);
  assert.match(html, /id="creator-email" name="email"/);
  assert.match(html, /label for="creator-password"/);
  assert.match(html, /id="creator-password" name="password"/);
  assert.match(html, /&lt;invalid&gt;/);
  assert.doesNotMatch(html, /state\.clips|Recent rendered clips/);
});
