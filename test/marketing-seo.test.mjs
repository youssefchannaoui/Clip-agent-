import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-seo-'));
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';
process.env.FREE_TIER_DAYS = '3';

const marketing = await import('../src/marketing.js');
const { config } = await import('../src/config.js');

const home = () => marketing.home({ base: 'https://deenclipped.online', currentUser: null });

test('social preview tags are present and absolute', () => {
  // Scrapers do not resolve relative URLs — a relative og:image renders as
  // nothing, which is what every shared link looked like before.
  const html = home();
  assert.ok(html.includes('<meta property="og:image" content="https://deenclipped.online/marketing-assets/og-cover.png">'));
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'));
  assert.ok(html.includes('twitter:image" content="https://deenclipped.online/'));
  assert.ok(html.includes('og:image:width" content="1200"'));
});

test('the og:image file actually exists at the advertised path', () => {
  // A 404 on og:image looks identical to having no og:image at all.
  const file = path.resolve('src/public/marketing-assets/og-cover.png');
  assert.ok(fs.existsSync(file), 'og-cover.png missing from marketing-assets');
  assert.ok(fs.statSync(file).size > 5000, 'og-cover.png looks truncated');
});

test('favicon and apple-touch-icon are declared and present', () => {
  const html = home();
  assert.ok(html.includes('rel="icon"'));
  assert.ok(html.includes('rel="apple-touch-icon"'));
  assert.ok(fs.existsSync(path.resolve('src/public/marketing-assets/favicon-32.png')));
  assert.ok(fs.existsSync(path.resolve('src/public/marketing-assets/apple-touch-icon.png')));
});

test('the title carries keywords rather than just the brand', () => {
  const html = home();
  const title = html.match(/<title>([^<]*)<\/title>/)[1];
  assert.notEqual(title, 'DeenClipped');
  assert.ok(/lecture/i.test(title), 'title should describe what it does');
  assert.ok(title.length <= 75, `title is ${title.length} chars, will be truncated in search results`);
});

test('the meta description sells rather than describing the software category', () => {
  const html = home();
  const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
  assert.ok(!description.startsWith('DeenClipped is a web application'));
  assert.ok(description.length <= 175, `description is ${description.length} chars, will be truncated`);
});

test('the page names the niche it actually wins on', () => {
  // "Islamic" appeared exactly once on the whole site, in a meta tag, while
  // Arabic captioning is the entire reason to pick this over Opus Clip.
  const html = home();
  assert.ok(/khutbah|Islamic/i.test(html));
  assert.ok(/Arabic/i.test(html));
});

test('analytics stays out until both env vars are set', () => {
  // Half-configured tracking silently collects nothing, which is worse than
  // none because it looks like it is working.
  assert.ok(!home().includes('data-website-id'), 'no analytics expected by default');

  const url = config.analyticsScriptUrl;
  const site = config.analyticsSiteId;
  config.analyticsScriptUrl = 'https://plausible.io/js/script.js';
  config.analyticsSiteId = 'deenclipped.online';
  try {
    assert.ok(home().includes('plausible.io/js/script.js'));
  } finally {
    config.analyticsScriptUrl = url;
    config.analyticsSiteId = site;
  }
});

test('the demo video section stays hidden until a clip is configured', () => {
  assert.ok(!home().includes('<video'), 'no empty player should render');

  const original = config.demoVideoUrl;
  config.demoVideoUrl = 'https://cdn.example.com/sample.mp4';
  try {
    const html = home();
    assert.ok(html.includes('<video'));
    assert.ok(html.includes('sample.mp4'));
    assert.ok(html.includes('preload="none"'), 'a 9:16 clip should not autoload on every page view');
  } finally {
    config.demoVideoUrl = original;
  }
});

test('the hero states the offer and removes the risk', () => {
  const html = home();
  assert.ok(html.includes('no card needed'));
  assert.ok(html.includes('for 3 days'), 'free window should match what the app enforces');
  assert.ok(html.includes('Start free'), 'nav CTA should name the offer');
});

test('the FAQ answers the objections that stop a purchase', () => {
  const html = marketing.home({ base: 'https://deenclipped.online', currentUser: null });
  for (const topic of [/Arabic captions/i, /train AI|training data/i, /cancel/i, /roll over/i]) {
    assert.ok(topic.test(html), `FAQ is missing: ${topic}`);
  }
});
