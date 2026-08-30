import test from 'node:test';
import assert from 'node:assert/strict';

const auth = await import('../src/auth.js');

test('login page uses the public-site brand system and real product assets', () => {
  const html = auth.loginPage({ returnTo: '/app?view=projects' });

  assert.match(html, /DeenClipped/);
  assert.match(html, /Turn long lectures into/);
  assert.match(html, /review-ready short clips/);
  assert.match(html, /Human approval first/);
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

test('the primary sign-in button is clickable, and carries the size rule rather than the disabled one', () => {
  // This shipped broken: `.dc-auth-primary` was written into the selector for
  // the DISABLED oauth button instead of the one below it that sets height,
  // radius and font. So the button rendered at 45% opacity with no height and
  // pointer-events:none -- unclickable for every visitor, on the one page the
  // whole funnel starts at, while every test stayed green.
  const html = auth.loginPage({});

  const disabledRule = html.match(/\.dc-oauth-btn\.is-disabled\{([^}]*)\}/);
  assert.ok(disabledRule, 'the disabled-provider rule still exists');
  assert.doesNotMatch(disabledRule[0], /dc-auth-primary/,
    'the primary CTA must never be grouped into the disabled rule');

  const sizeRule = html.match(/\.dc-auth-primary,\.dc-oauth-btn\{([^}]*)\}/);
  assert.ok(sizeRule, 'the primary CTA shares the button sizing rule');
  assert.match(sizeRule[1], /height:\d+px/, 'it has a real height');
  assert.match(sizeRule[1], /cursor:pointer/, 'and reads as clickable');

  // Belt and braces: nothing anywhere may kill pointer events on it.
  for (const rule of html.matchAll(/([^{}]*)\{([^}]*pointer-events:none[^}]*)\}/g)) {
    assert.doesNotMatch(rule[1], /\.dc-auth-primary(?![\w-])/,
      `a rule disables the primary CTA: ${rule[1]}`);
  }
});

test('the admin fallback disclosure exists only when the fallback does', () => {
  // It used to render regardless, expanding to "Password fallback is disabled"
  // -- a control that cannot reach an outcome, which this repo bans outright.
  const html = auth.loginPage({});
  const hasRealFallback = /name="password"[^>]*id="admin-password"|id="admin-password"/.test(html);
  if (!hasRealFallback) {
    assert.doesNotMatch(html, /Admin password fallback/,
      'no disclosure when there is nothing behind it');
    assert.doesNotMatch(html, /Password fallback is disabled/,
      'and no dead note explaining its own uselessness');
  }
});

test('no text on the sign-in page drops below a readable size', () => {
  // The page carried 9px labels and hints, a 9px divider, and 7px text inside
  // the floating status chips. The floor is 10px rather than a rounder number
  // because badges and a logo subtitle are legitimately small; prose is not.
  const html = auth.loginPage({});
  const tooSmall = [...html.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)]
    .map(match => Number(match[1]))
    .filter(size => size < 10);
  assert.deepEqual(tooSmall, [], `font sizes below 10px: ${tooSmall.join(', ')}`);
});
