import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config } from './config.js';
import * as billing from './billing.js';

import { SEO_PAGES, KIND, indexablePages, pageFor, breadcrumbFor, alternatesFor, langOf, isRtl } from './seo-pages.js';
import { SEO_COPY } from './seo-copy.js';

/**
 * Cache-buster for the stylesheet, taken from the stylesheet.
 *
 * This was a hand-typed date. Edit the CSS twice in one day — or forget to
 * change it at all — and every returning visitor keeps the old file, which
 * looks exactly like a layout bug that will not reproduce for you. Reading
 * the bytes means it cannot be forgotten and cannot be wrong. Falls back to
 * the app version if the file is unreadable, so a packaging change degrades
 * to the old behaviour rather than throwing at import time.
 */
export const CSS_VERSION = (() => {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const bytes = fs.readFileSync(path.join(here, 'public', 'marketing.css'));
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
  } catch {
    return String(config.appVersion || '0').replace(/[^\w.]/g, '');
  }
})();

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

/**
 * The DeenClipped mark: the mihrab arch the Studio dashboard already uses.
 *
 * This was a play triangle inside a rounded square, which is YouTube's icon in
 * everything but colour. The YouTube API Services compliance review (policy
 * III.F.2a,b) flagged it in both the site header and the footer -- their
 * branding guidelines do not allow their icon's shape to be reused or altered,
 * and a product that publishes to YouTube must not look like it is YouTube.
 *
 * The arch is the app's own identity, carries no borrowed shape, and now makes
 * the marketing site and the dashboard agree.
 */
function logoMark() {
  // The arch alone. Nothing inside it: a vertical stroke crossed by a
  // horizontal one is a cross, which has no place on a Muslim product.
  return `<span class="brand-mark" aria-hidden="true"><svg viewBox="0 0 32 32" fill="none"><path d="M16 3.5c-5.8 0-10.5 4.7-10.5 10.5v14.5h21V14c0-5.8-4.7-10.5-10.5-10.5Z"/></svg></span>`;
}

function icon(name) {
  const icons = {
    check: '<svg viewBox="0 0 24 24" fill="none"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none"><path d="M10 13.5 14 9.5"/><path d="M7.2 16.3 5.8 17.7a4 4 0 0 1-5.6-5.6l3.5-3.5a4 4 0 0 1 5.6 0"/><path d="m16.8 7.7 1.4-1.4a4 4 0 0 1 5.6 5.6l-3.5 3.5a4 4 0 0 1-5.6 0"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M4 15v5h16v-5"/></svg>',
    // Film frames rather than a play triangle in a rounded rectangle: the same
    // borrowed YouTube shape the brand mark carried, for the same reason.
    clips: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M7 5v14M17 5v14"/><path d="M3 12h4M17 12h4"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none"><path d="m4 16.5 9-9 3.5 3.5-9 9H4Z"/><path d="m15 6 1.5-1.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L18 9"/></svg>',
    publish: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 20h16"/></svg>',
    captions: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 10a3 3 0 1 0 0 4m7-4a3 3 0 1 0 0 4"/></svg>',
    template: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 4 8v8l8 5 8-5V8Z"/><path d="m4 8 8 5 8-5M12 13v8"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4m8-4v4M3 10h18"/></svg>',
    account: '<svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.3 3.5-6.5 8-6.5s7.2 2.2 8 6.5"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none"><path d="M5 12h14m-5-5 5 5-5 5"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none"><path d="m10 6 6 6-6 6"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="none"><path d="m12 3 1.4 4.1L17.5 8.5l-4.1 1.4L12 14l-1.4-4.1-4.1-1.4 4.1-1.4Z"/><path d="m18.5 14 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 3 5 6v5c0 4.7 2.7 8.2 7 10 4.3-1.8 7-5.3 7-10V6Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
    brain: '<svg viewBox="0 0 24 24" fill="none"><path d="M9.5 5.2A3 3 0 0 1 15 6.8a3.3 3.3 0 0 1 2.8 5.2 3.3 3.3 0 0 1-2.8 5.2A3 3 0 0 1 9.5 19a3 3 0 0 1-3.3-4.5A3.2 3.2 0 0 1 6 8.2a3 3 0 0 1 3.5-3Z"/><path d="M9.5 5.2V19M15 6.8c-1.7.1-2.8.9-3.2 2.4m6 2.8c-1.8-.6-3.2-.3-4.2.8M6.2 14.5c1.4-.6 2.6-.5 3.3.2"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 20V10m6 10V4m5 16v-7m5 7V7"/><path d="m4 8 6-5 5 8 5-6"/></svg>',
    language: '<svg viewBox="0 0 24 24" fill="none"><path d="M4 5h9M8.5 3v2m-2 0c.4 3.5 2.4 6.1 5.8 7.8M11 7c-1 2.7-3 4.8-6 6"/><path d="m14 19 3-8 3 8m-5-3h4"/></svg>',
    music: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 18V6l10-2v12M9 9l10-2"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  };
  return icons[name] || icons.check;
}

function navActions(currentUser) {
  if (currentUser) return `<div class="nav-actions"><a class="button primary compact" href="/app">My dashboard ${icon('arrow')}</a></div>`;
  return `<div class="nav-actions"><a class="button text-button" href="/login?returnTo=/app">Sign in</a><a class="button primary compact" href="/login?returnTo=/app">Start free ${icon('arrow')}</a></div>`;
}

/**
 * Intrinsic pixel sizes of the marketing images, read from the files.
 *
 * Every <img> on this site was served without width or height, so the browser
 * reserved no space for any of them and the page jumped as each one arrived --
 * Cumulative Layout Shift on every page, on the slow connections where it
 * matters most. Sixty-two tags across twenty-one pages is too many to keep
 * right by hand, and a hand-typed size is a lie waiting for someone to
 * re-export an asset, so the numbers come from the bytes.
 */
const IMAGE_SIZES = (() => {
  const sizes = new Map();
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = path.join(here, 'public', 'marketing-assets');
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.webp')) continue;
      const head = Buffer.alloc(40);
      const fd = fs.openSync(path.join(dir, name), 'r');
      try { fs.readSync(fd, head, 0, 40, 0); } finally { fs.closeSync(fd); }
      if (head.subarray(0, 4).toString() !== 'RIFF') continue;
      const format = head.subarray(12, 16).toString();
      let size = null;
      if (format === 'VP8 ') {
        size = [head.readUInt16LE(26) & 0x3fff, head.readUInt16LE(28) & 0x3fff];
      } else if (format === 'VP8L') {
        const bits = head.readUInt32LE(21);
        size = [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
      } else if (format === 'VP8X') {
        size = [
          (head[24] | (head[25] << 8) | (head[26] << 16)) + 1,
          (head[27] | (head[28] << 8) | (head[29] << 16)) + 1,
        ];
      }
      if (size && size[0] > 0 && size[1] > 0) sizes.set(`/marketing-assets/${name}`, size);
    }
  } catch { /* a missing asset directory must not stop the site rendering */ }
  return sizes;
})();

/**
 * Stamp width, height and LCP priority onto every image in a finished page.
 *
 * Done here, once, on the way out, rather than at each of the sixty-two call
 * sites: a page added tomorrow gets it without anyone remembering to. Existing
 * attributes are never overwritten, so a deliberate size still wins.
 */
function stampImages(html) {
  let first = true;
  return html.replace(/<img\b[^>]*>/g, tag => {
    const src = (tag.match(/src="([^"]*)"/) || [, ''])[1];
    const size = IMAGE_SIZES.get(src);
    let out = tag;
    if (size && !/\swidth=/.test(out) && !/\sheight=/.test(out)) {
      out = out.replace(/^<img/, `<img width="${size[0]}" height="${size[1]}"`);
    }
    // The first image is the one the browser paints for LCP, so it is fetched
    // at high priority and never lazily -- lazy-loading the largest paint is
    // the classic way to make a fast page score badly.
    if (first && size) {
      first = false;
      out = out.replace(/\sloading="lazy"/, '');
      if (!/fetchpriority=/.test(out)) out = out.replace(/^<img/, '<img fetchpriority="high" decoding="async"');
    } else if (size && !/loading=/.test(out)) {
      out = out.replace(/^<img/, '<img loading="lazy" decoding="async"');
    }
    return out;
  });
}

function layout({ base, currentUser, title, description, canonicalPath = '/', body, jsonLd = [] }) {
  const root = String(base || 'https://deenclipped.online').replace(/\/+$/, '');
  const canonical = `${root}${canonicalPath === '/' ? '' : canonicalPath}`;

  // hreflang, emitted only when there is genuinely more than one language
  // version of this page. A one-entry set describes a cluster of one, and a
  // set pointing at a page that does not exist makes Google drop the cluster
  // entirely -- so nothing is emitted today, which is the correct answer while
  // every page is English. x-default names the English page, since that is
  // what a reader with no matching language should land on.
  const here = pageFor(canonicalPath);
  const alternates = alternatesFor(here);
  const pageLang = langOf(here);
  // Only the two free-tool pages pull the widget script; every other page
  // would be fetching a bundle for a control it does not have.
  const toolScript = /^\/tools\/(safe-zone-checker|clip-calculator)$/.test(canonicalPath)
    ? '\n  <script src="/tool-widgets.js" defer></script>' : '';

  const hreflang = alternates.length ? '\n  ' + [
    ...alternates.map(alt =>
      `<link rel="alternate" hreflang="${alt.lang}" href="${root}${alt.path === '/' ? '' : alt.path}">`),
    `<link rel="alternate" hreflang="x-default" href="${root}${(alternates.find(a => a.lang === 'en') || alternates[0]).path.replace(/^\/$/, '')}">`,
  ].join('\n  ') : '';
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  // "</script>" inside a JSON string would end the block early; \u003c cannot.
  const schemaBlocks = jsonLd.map(schema =>
    `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`).join('\n  ');
  return stampImages(`<!doctype html>
<html lang="${pageLang}"${isRtl(pageLang) ? ' dir="rtl"' : ''}>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <meta name="theme-color" content="#070708">
  <meta property="og:title" content="${safeTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:type" content="website">
  <meta property="og:url" content="${canonical}">
  <meta property="og:image" content="${String(base || 'https://deenclipped.online').replace(/\/+$/, '')}/og-image.jpg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="DeenClipped">
  <meta property="og:locale" content="en_AU">
  <meta property="og:image:alt" content="DeenClipped — lectures turned into captioned short clips">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="canonical" href="${canonical}">${hreflang}${config.googleSiteVerification ? `
  <meta name="google-site-verification" content="${escapeHtml(config.googleSiteVerification)}">` : ''}${config.bingSiteVerification ? `
  <meta name="msvalidate.01" content="${escapeHtml(config.bingSiteVerification)}">` : ''}
  ${schemaBlocks}
  <link rel="stylesheet" href="/marketing.css?v=${CSS_VERSION}">
</head>
<body>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand" href="/" aria-label="DeenClipped home">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a>
      <button class="menu-button" type="button" data-menu aria-label="Open navigation"><span></span><span></span><span></span></button>
      <nav class="nav-links" aria-label="Main navigation">
        <a href="/how-it-works">How it works</a>
        <a href="/features">Features</a>
        <a href="/tools/ai-video-clipper">Tools</a>
        <a href="/guides">Guides</a>
        <a href="/islamic-video-clipper">For Islamic creators</a>
        <a href="/pricing">Pricing</a>
        <a href="/review-safety">Review & safety</a>
      </nav>
      ${navActions(currentUser)}
    </div>
  </header>
  ${body}
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand" href="/">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><p>Turn long lectures and videos into review-ready short clips, refine every detail, then publish to your own connected channels.</p></div>
        <div class="footer-col"><h4>Product</h4><a href="/features">All features</a><a href="/how-it-works">How it works</a><a href="/alternatives">How it compares</a><a href="/pricing">Plans & tokens</a><a href="/review-safety">Review & safety</a><a href="/app">Dashboard</a></div>
        <div class="footer-col"><h4>Clip long video</h4><a href="/tools/ai-video-clipper">AI video clipper</a><a href="/tools/podcast-clip-generator">Podcast clip generator</a><a href="/tools/lecture-clip-generator">Lecture clip generator</a><a href="/tools/ai-caption-generator">AI caption generator</a></div>
        <div class="footer-col"><h4>Publish to</h4><a href="/tools/youtube-to-shorts">YouTube to Shorts</a><a href="/tools/youtube-to-tiktok">YouTube to TikTok</a><a href="/tools/youtube-to-reels">YouTube to Reels</a></div>
        <div class="footer-col"><h4>Islamic creators</h4><a href="/islamic-video-clipper">Islamic video clipper</a><a href="/islamic-lecture-clipper">Islamic lecture clipper</a><a href="/tools/arabic-english-captions">Arabic &amp; English captions</a></div>
        <div class="footer-col"><h4>Guides &amp; tools</h4><a href="/guides">All guides</a><a href="/guides/long-video-to-shorts">Long video to Shorts</a><a href="/guides/caption-safe-zones">Caption safe zones</a><a href="/tools/safe-zone-checker">Safe zone checker</a><a href="/tools/clip-calculator">Clip calculator</a></div>
        <div class="footer-col"><h4>Company</h4><a href="/about">About</a><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
        <div class="footer-col"><h4>Start</h4><a href="/login?returnTo=/app">Start free</a><a href="/login?returnTo=/app">Sign in</a><a href="/pricing#token-shop">Token shop</a><a href="mailto:support@deenclipped.online">Support</a></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} DeenClipped</span><span>Import · Review · Edit · Publish</span></div>
    </div>
  </footer>
  <script src="/marketing.js" defer></script>${toolScript}
</body>
</html>`);
}

function sourceForm() {
  return `<form class="source-bar" data-source-form><span class="source-icon">${icon('link')}</span><label class="sr-only" for="source-url">Video URL</label><input id="source-url" name="source" placeholder="Paste a YouTube link to begin" autocomplete="off"><button type="submit">Start with this video ${icon('arrow')}</button></form>`;
}

function checkItem(title, text) {
  return `<div class="detail-item"><span class="detail-check">${icon('check')}</span><span><b>${title}</b><small>${text}</small></span></div>`;
}

const SOURCE_VISUALS = Object.freeze({
  lecturer: ['source-hero.webp', 'A Muslim lecturer recording a long-form talk in a professional studio'],
  educator: ['source-creator-woman.webp', 'A Muslim woman educator recording a thoughtful podcast'],
  teacher: ['source-creator-man.webp', 'A Muslim teacher speaking in a bright library studio'],
  mosque: ['source-mosque.webp', 'A quiet mosque courtyard at sunrise'],
  mountains: ['source-mountains.webp', 'A mountain valley at sunrise used as reflective video footage'],
});

function sourceImage(key, attrs = '') {
  const [src, alt] = SOURCE_VISUALS[key] || SOURCE_VISUALS.lecturer;
  return `<img src="/marketing-assets/${src}" alt="${escapeHtml(alt)}" ${attrs}>`;
}

function clipPreview(key, caption, className = '', badge = 'Ready to review') {
  return `<figure class="clip-preview ${className}">
    ${sourceImage(key, 'loading="lazy"')}
    <span class="clip-preview-badge">${escapeHtml(badge)}</span>
    <figcaption>${escapeHtml(caption)}</figcaption>
    <i class="clip-progress" aria-hidden="true"><b></b></i>
  </figure>`;
}

function productVisual(kind) {
  if (kind === 'import') return `<div class="product-scene import-scene">
    <div class="scene-top"><span class="scene-dot"></span><b>New source</b><em>Step 1 of 3</em></div>
    <div class="import-source"><span>${icon('link')}</span><div><small>Video link</small><strong>youtube.com/watch?v=lecture</strong></div><i>${icon('check')}</i></div>
    <div class="range-card"><div><span>Choose the useful section</span><strong>18:04 — 42:10</strong></div><div class="range-track"><i></i><b></b><b></b></div><div class="range-meta"><span>24 source minutes</span><span>24 tokens</span></div></div>
    <button type="button" tabindex="-1">Find clips in this section ${icon('arrow')}</button>
  </div>`;
  if (kind === 'discover') return `<div class="product-scene discovery-scene">
    <div class="scene-top"><span class="scene-spark">${icon('spark')}</span><b>Strong moments</b><em>7 candidates</em></div>
    <div class="candidate-row"><span>01</span><div><strong>A complete answer about intention</strong><small>Clear hook · complete ending</small></div><b>92</b></div>
    <div class="candidate-row"><span>02</span><div><strong>The habit that protects consistency</strong><small>Practical takeaway · 42 sec</small></div><b>88</b></div>
    <div class="candidate-row"><span>03</span><div><strong>Why the small deed still matters</strong><small>Standalone point · 36 sec</small></div><b>84</b></div>
    <div class="scan-line"><i></i><span>Transcribed · scored · rendered</span></div>
  </div>`;
  if (kind === 'review') return `<div class="product-scene review-scene">
    ${clipPreview('educator', 'Small consistent steps change the direction.', 'review-clip', 'Candidate 2 of 7')}
    <div class="review-side"><div class="scene-top"><b>Ready for your decision</b><em>Score 91</em></div><p>Starts with the answer, holds one complete idea and finishes cleanly.</p><div class="caption-check"><span>${icon('captions')}</span><div><b>Captions checked</b><small>English · Clean Line</small></div></div><div class="review-actions"><button type="button" tabindex="-1">Reject</button><button type="button" tabindex="-1">Approve ${icon('check')}</button></div><small class="key-hint">A approve · X reject · S skip</small></div>
  </div>`;
  if (kind === 'style') return `<div class="product-scene style-scene">
    <div class="style-tools"><div class="scene-top"><b>Clip style</b><em>Saved locally</em></div><label>Template<strong>Clean Line</strong></label><label>Caption position<div class="position-grid"><i></i><i class="active"></i><i></i></div></label><label>Emphasis colour<span class="swatches"><i></i><i></i><i></i><i></i></span></label><div class="editor-gate-note"><span>${icon('edit')}</span><div><b>Full editor preview</b><small>Coming soon while visual checks finish</small></div></div></div>
    ${clipPreview('teacher', 'Make the next step clear enough to act on.', 'style-clip', 'Style preview')}
  </div>`;
  if (kind === 'schedule') return `<div class="product-scene schedule-scene">
    <div class="scene-top"><b>Publishing calendar</b><em>3 destinations connected</em></div>
    <div class="week-strip">${['Mon','Tue','Wed','Thu','Fri'].map((day, i) => `<span class="${i === 2 ? 'today' : ''}"><small>${day}</small><b>${11 + i}</b></span>`).join('')}</div>
    <div class="schedule-row"><i class="platform youtube">YT</i><div><b>Small deeds, lasting change</b><small>Wednesday · 7:00 pm</small></div><em>Scheduled</em></div>
    <div class="schedule-row"><i class="platform tiktok">TT</i><div><b>Choose the habit you can keep</b><small>Thursday · 12:00 pm</small></div><em>Ready</em></div>
    <div class="schedule-row"><i class="platform instagram">IG</i><div><b>A reminder about intention</b><small>Friday · 6:30 pm</small></div><em>Ready</em></div>
  </div>`;
  if (kind === 'performance') return `<div class="product-scene performance-scene">
    <div class="scene-top"><b>Performance</b><em>Last 30 days</em></div>
    <div class="metric-strip"><span><small>Made</small><b data-count="32">32</b></span><span><small>Kept</small><b data-count="18">18</b></span><span><small>Scheduled</small><b data-count="11">11</b></span><span><small>Posted</small><b data-count="9">9</b></span></div>
    <div class="performance-bars"><span><i style="--bar:78%"></i><b>Review completion</b><em>78%</em></span><span><i style="--bar:61%"></i><b>Clips kept</b><em>61%</em></span><span><i style="--bar:50%"></i><b>Posting queue</b><em>50%</em></span></div>
    <p>${icon('chart')} Counts come from your DeenClipped workflow — never invented social views.</p>
  </div>`;
  return `<div class="product-scene ai-scene">
    <div class="scene-top"><span class="scene-spark">${icon('brain')}</span><b>DeenAI</b><em>Private worker model</em></div>
    <div class="ai-prompt"><small>You asked</small><p>What should I focus on before the next post?</p></div>
    <div class="ai-response"><span>${icon('spark')}</span><div><small>DeenAI</small><p>Review the four clips still waiting, then resolve the failed destination before filling Friday’s schedule.</p></div></div>
    <div class="ai-grounding"><span>Approval patterns</span><span>Posting state</span><span>Kept titles</span></div>
    <p class="scene-footnote">Uses compact account figures and kept titles — not your transcript.</p>
  </div>`;
}

const JOURNEY_STEPS = Object.freeze([
  ['import', 'Import', 'Paste or upload', 'Choose the exact source range worth processing. Tokens follow selected source minutes, not the full recording.'],
  ['discover', 'AI clips', 'Find complete moments', 'DeenClipped transcribes, scores and renders candidates that can stand on their own.'],
  ['review', 'Review', 'You make the call', 'Watch the finished render, see why it was selected and approve, reject or skip it.'],
  ['style', 'Style & edit', 'Keep every clip on-brand', 'Apply templates and clip-local style changes today. The full timeline editor remains clearly gated as coming soon.'],
  ['schedule', 'Schedule', 'Fill the publishing queue', 'Post now, download or schedule approved clips to your own connected destinations.'],
  ['performance', 'Performance', 'See what moved', 'Track made, kept, scheduled, posted and failed from real DeenClipped records.'],
  ['deenai', 'DeenAI', 'Know the next move', 'Turn your own workflow state into checkable insights and private Studio guidance.'],
]);

function journey() {
  const tabs = JOURNEY_STEPS.map(([key, label], index) => `<button class="journey-tab ${index === 0 ? 'active' : ''}" type="button" role="tab" aria-selected="${index === 0}" aria-controls="journey-${key}" data-journey-tab="${key}"><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(label)}</button>`).join('');
  const panels = JOURNEY_STEPS.map(([key, , eyebrow, copy], index) => `<article class="journey-panel ${index === 0 ? 'active' : ''}" id="journey-${key}" role="tabpanel" data-journey-panel="${key}" ${index ? 'hidden' : ''}><div class="journey-copy"><span class="section-label">${escapeHtml(eyebrow)}</span><h3>${escapeHtml(JOURNEY_STEPS[index][1])}</h3><p>${escapeHtml(copy)}</p><a href="/features#${key === 'discover' || key === 'review' ? 'source-and-review' : key === 'style' ? 'editor' : key === 'schedule' ? 'publishing' : key === 'performance' || key === 'deenai' ? 'operations' : 'feature-map'}">Explore this feature ${icon('arrow')}</a></div>${productVisual(key)}</article>`).join('');
  return `<div class="journey-shell reveal" data-journey><div class="journey-tabs" role="tablist" aria-label="DeenClipped workflow">${tabs}</div><div class="journey-panels">${panels}</div><div class="journey-progress" aria-hidden="true"><i></i></div></div>`;
}

/**
 * The shipped template catalogue paired with the existing photographic reel
 * that best demonstrates each look. These are not invented marketing styles:
 * every name and description comes from src/templates/*.json.
 */
const TEMPLATE_SHOWCASE = Object.freeze([
  { name: 'Clean Line', access: 'Basic', image: 'source-creator-woman.webp', alt: SOURCE_VISUALS.educator[1], caption: 'Small steps become a steady practice.', description: 'One centred line low in the frame, designed to stay out of the lecture.' },
  { name: 'Bold Stack', access: 'Pro', image: 'source-creator-man.webp', alt: SOURCE_VISUALS.teacher[1], caption: 'MAKE THE NEXT STEP CLEAR', description: 'Large stacked words build behind the speaker and clear as the thought moves.' },
  { name: 'Headline', access: 'Pro', image: 'source-mountains.webp', alt: SOURCE_VISUALS.mountains[1], caption: 'THE ROAD IS BUILT ONE STEP AT A TIME', description: 'Cinematic uppercase lines with the next phrase waiting quietly behind.' },
  { name: 'Mono Minimal', access: 'Pro', image: 'source-mosque.webp', alt: SOURCE_VISUALS.mosque[1], caption: 'return', description: 'A grainy monochrome grade with one quiet word at a time.' },
  { name: 'Quran Recitation', access: 'Pro', image: 'source-hero.webp', alt: SOURCE_VISUALS.lecturer[1], caption: 'Matched ayah · translation beneath', description: 'Matched ayah text in a mushaf face with its translation beneath it.' },
]);

function templateCatalogue() {
  return `<div class="template-catalogue reveal" aria-label="DeenClipped template catalogue">
    ${TEMPLATE_SHOWCASE.map((template, index) => `<article class="template-card ${index === 0 ? 'is-basic' : ''}">
      <div class="template-image"><img src="/marketing-assets/${template.image}" alt="${escapeHtml(template.alt)}" loading="lazy"><span>${escapeHtml(template.access)}</span><strong>${escapeHtml(template.caption)}</strong></div>
      <div class="template-copy"><strong>${escapeHtml(template.name)}</strong><p>${escapeHtml(template.description)}</p></div>
    </article>`).join('')}
  </div>`;
}

function planComparison() {
  const rows = [
    ['Source imports, clip discovery and review', true, true, true],
    ['Scheduling, automation and supported publishing', true, true, true],
    ['Default Clean Line template', true, true, true],
    ['Remove the DeenClipped watermark', false, true, true],
    ['All five shipped templates', false, true, true],
    ['DeenAI insights from your own records', false, true, true],
    ['Ask DeenAI on the private worker model', false, false, true],
    ['Priority render queue', false, false, true],
    [`Up to ${escapeHtml(config.postSlotsStudio)} posting windows a day`, false, false, true],
  ];
  const mark = included => included ? '<span class="compare-yes" aria-label="Included">✓</span>' : '<span class="compare-no" aria-label="Not included">—</span>';
  return `<div class="plan-comparison reveal"><div class="compare-row compare-head"><strong>Feature</strong><strong>Basic</strong><strong>Pro</strong><strong>Studio</strong></div>${rows.map(row => `<div class="compare-row"><span>${row[0]}</span>${mark(row[1])}${mark(row[2])}${mark(row[3])}</div>`).join('')}</div>`;
}

/**
 * The public pricing grid: three TIERS, one billing period at a time.
 *
 * This advertised Free/Weekly/Monthly/Yearly until v3.36 -- four cards for one
 * paid tier sold three ways, and no mention of Studio at all. The marketing
 * site was selling a product the app no longer had.
 *
 * The period switch is CSS: three radios and `:checked ~` selectors, because
 * these pages carry no script of their own and a radio needs none. The ids are
 * prefixed so they cannot collide with the switch on /plans.
 */
function pricingCards(currentUser = null) {
  const accountUrl = currentUser ? '/plans' : '/login?returnTo=/plans';
  const tierNames = { pro: 'Pro', studio: 'Studio' };
  const money = { pro: [config.planPriceWeeklyLabel, config.planPriceMonthlyLabel, config.planPriceYearlyLabel],
    studio: [config.planPriceStudioWeeklyLabel, config.planPriceStudioMonthlyLabel, config.planPriceStudioYearlyLabel] };
  const allowance = { pro: [config.tokensWeekly, config.tokensMonthly, config.tokensYearly],
    studio: [config.tokensStudioWeekly, config.tokensStudioMonthly, config.tokensStudioYearly] };
  const configured = { pro: [config.stripePriceWeekly, config.stripePriceMonthly, config.stripePriceYearly],
    studio: [config.stripePriceStudioWeekly, config.stripePriceStudioMonthly, config.stripePriceStudioYearly] };
  const periods = ['weekly', 'monthly', 'yearly'];
  const each = { weekly: 'week', monthly: 'month', yearly: 'year' };

  const paidCard = tier => {
    const rows = periods.map((period, index) => {
      const live = Boolean(configured[tier][index]);
      return `<div class="mk-per-${period}">
        <div class="plan-price-label">${escapeHtml(live ? money[tier][index] : 'Opening soon')}</div>
        <div class="price">${escapeHtml(Number(allowance[tier][index]).toLocaleString())} <small>tokens/${escapeHtml(each[period])}</small></div>
      </div>`;
    }).join('');
    const anyLive = configured[tier].some(Boolean);
    const adds = tier === 'studio' ? Object.values(billing.STUDIO_FEATURES) : Object.values(billing.PRO_FEATURES);
    return `<article class="price-card ${tier === 'pro' ? 'popular' : ''}">
      ${tier === 'pro' ? '<span class="popular-label">Most popular</span>' : '<span class="popular-label subtle">At scale</span>'}
      <span class="plan-kicker">${tier === 'pro' ? 'Consistent' : 'For channels at scale'}</span>
      <h3>${escapeHtml(tierNames[tier])}</h3>
      ${rows}
      <p>${escapeHtml(billing.TIERS[tier].tagline)}</p>
      <ul><li>Everything in ${tier === 'studio' ? 'Pro' : 'Basic'}, plus:</li>${adds.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
      ${anyLive
        ? `<a class="button ${tier === 'pro' ? 'primary' : 'secondary'} full" href="${accountUrl}">Choose ${escapeHtml(tierNames[tier])}</a>`
        : '<span class="button secondary full disabled" aria-disabled="true">Opening soon</span>'}
    </article>`;
  };

  const basic = `<article class="price-card">
    <span class="plan-kicker">Start</span>
    <h3>Basic</h3>
    <div class="plan-price-label">Free</div>
    <div class="price">${escapeHtml(Number(config.tokensFree).toLocaleString())} <small>source minutes · ${escapeHtml(String(config.stripeTrialDays))} days</small></div>
    <p>${escapeHtml(billing.TIERS.basic.tagline)}</p>
    <ul>${billing.FREE_INCLUDES.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    <a class="button secondary full" href="${accountUrl}">Start Basic free</a>
  </article>`;

  return `<input type="radio" name="mkperiod" id="mk-weekly" class="mkperiod">`
    + `<input type="radio" name="mkperiod" id="mk-monthly" class="mkperiod" checked>`
    + `<input type="radio" name="mkperiod" id="mk-yearly" class="mkperiod">`
    + `<div class="period-switch"><label for="mk-weekly">Weekly</label><label for="mk-monthly">Monthly</label><label for="mk-yearly">Yearly</label></div>`
    + `<p class="period-note">Yearly pricing includes two months free</p>`
    + `<div class="pricing-grid">${basic}${paidCard('pro')}${paidCard('studio')}</div>`;
}

function tokenShop(currentUser = null) {
  const accountUrl = currentUser ? '/plans#token-shop' : '/login?returnTo=/plans';
  const packs = [
    { name: 'Quick boost', tokens: 100, price: config.topupPrice100Label, enabled: Boolean(config.stripePriceTopup100) },
    { name: 'Creator boost', tokens: 300, price: config.topupPrice300Label, enabled: Boolean(config.stripePriceTopup300), popular: true },
    { name: 'Campaign boost', tokens: 750, price: config.topupPrice750Label, enabled: Boolean(config.stripePriceTopup750) },
  ];
  return `<section class="token-shop reveal" id="token-shop"><div class="pricing-section-head"><span class="section-label">Token shop</span><h2>Add tokens without changing your plan.</h2><p>One-time top-ups work with free, weekly, monthly and yearly accounts. Purchased tokens stay available through subscription renewals until you use them.</p></div><div class="topup-grid">${packs.map(pack => `<article class="topup-card ${pack.popular ? 'popular' : ''}">${pack.popular ? '<span class="popular-label">Most popular</span>' : ''}<span class="plan-kicker">One-time purchase</span><h3>${escapeHtml(pack.name)}</h3><strong>+${escapeHtml(pack.tokens)}</strong><small>tokens</small><div class="topup-price">${escapeHtml(pack.price)}</div>${pack.enabled ? `<a class="button ${pack.popular ? 'primary' : 'secondary'} full" href="${accountUrl}">Open token shop</a>` : '<span class="button secondary full disabled" aria-disabled="true">Stripe price not configured</span>'}</article>`).join('')}</div><p class="token-shop-note">Stripe Checkout handles payment securely. DeenClipped never stores raw card details, and tokens are credited only after a verified successful Stripe webhook.</p></section>`;
}

/**
 * One array drives both the FAQ the visitor reads and the FAQPage schema the
 * crawler reads. Google's policy for FAQ rich results is that the marked-up
 * questions match the visible ones -- keeping them as a single source is the
 * only arrangement under which they cannot drift apart.
 */
export const FAQ_ITEMS = [
  { q: 'What does DeenClipped do?',
    a: 'DeenClipped turns long lectures and videos into short-form clips, gives you a review queue, captions and templates, then helps publish or schedule the clips you approve.' },
  { q: 'Can I paste a YouTube link?',
    a: 'Yes. You can begin with a supported video link or upload a video directly. DeenClipped then reads the source and lets you choose the processing range.' },
  { q: 'How does DeenClipped handle Arabic and Quran recitation?',
    a: 'Auto-detect can switch between English and Arabic by segment. Recited scripture is matched for an ayah-and-translation treatment and is always held for human review before publishing.' },
  { q: 'Is the clip editor available now?',
    a: 'The editor can be opened as a preview, but it is currently held behind a coming-soon gate while visual verification is completed. Review, templates, re-renders, downloads, scheduling and publishing remain available.' },
  { q: 'What is DeenAI?',
    a: 'Pro includes insights calculated from your own projects and clips. Studio adds Ask DeenAI, answered by the private model on the DeenClipped processing server rather than a hosted consumer chatbot.' },
  { q: 'Does publishing go to my own channel?',
    a: "Yes. Each DeenClipped user connects their own supported accounts. Platform and app-review rules still determine which destinations and visibility options are available." },
  { q: 'Can I review clips before posting?',
    a: 'Yes. The workflow is review-first. Nothing is scheduled or posted until it has an approval, and scripture clips carry an additional human-review gate.' },
  { q: 'How are tokens calculated?',
    a: 'One token represents one selected source-video minute. You see the estimate before confirming; review, ordinary re-renders and making more clips from the same processed source do not charge that source time again.' },
];

function faqBlock() {
  const items = FAQ_ITEMS.map(item =>
    `<details><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`).join('\n    ');
  return `<div class="faq reveal">
    ${items}
  </div>`;
}

/* ── Structured data ─────────────────────────────────────────────────────────
 *
 * JSON-LD, one block per schema. Everything in here restates something the
 * page already says -- names, prices, questions -- because invented schema is
 * the one thing that can get rich results revoked. Prices are parsed from the
 * SAME config labels the pricing page renders, so the two cannot disagree.
 */

function siteBase(base) { return String(base || 'https://deenclipped.online').replace(/\/+$/, ''); }

/** "A$29" -> { price: "29", currency: "AUD" }; null when unparseable rather than guessed. */
function parsePriceLabel(label) {
  const text = String(label || '').trim();
  const match = text.match(/^(A\$|\$|£|€)\s*([0-9]+(?:\.[0-9]{1,2})?)$/);
  if (!match) return null;
  const currency = { 'A$': 'AUD', $: 'USD', '£': 'GBP', '€': 'EUR' }[match[1]];
  return currency ? { price: match[2], currency } : null;
}

function organizationSchema(base) {
  return {
    '@context': 'https://schema.org', '@type': 'Organization',
    name: 'DeenClipped', url: siteBase(base),
    logo: `${siteBase(base)}/og-image.jpg`,
    email: 'support@deenclipped.online',
  };
}

function webSiteSchema(base) {
  return { '@context': 'https://schema.org', '@type': 'WebSite', name: 'DeenClipped', url: siteBase(base) };
}

function softwareSchema(base) {
  const monthly = parsePriceLabel(config.planPriceMonthlyLabel);
  // One offer per price the page actually shows: six paid, plus the free tier.
  // Listing three when the grid renders six is the kind of drift the tests
  // comparing schema against the rendered page exist to catch.
  const offers = [
    { name: 'Basic', parsed: monthly ? { price: '0', currency: monthly.currency } : null },
    { name: 'Pro weekly', parsed: parsePriceLabel(config.planPriceWeeklyLabel) },
    { name: 'Pro monthly', parsed: monthly },
    { name: 'Pro yearly', parsed: parsePriceLabel(config.planPriceYearlyLabel) },
    { name: 'Studio weekly', parsed: parsePriceLabel(config.planPriceStudioWeeklyLabel) },
    { name: 'Studio monthly', parsed: parsePriceLabel(config.planPriceStudioMonthlyLabel) },
    { name: 'Studio yearly', parsed: parsePriceLabel(config.planPriceStudioYearlyLabel) },
  ].filter(item => item.parsed).map(item => ({
    '@type': 'Offer', name: `${item.name} plan`,
    price: item.parsed.price, priceCurrency: item.parsed.currency,
    url: `${siteBase(base)}/pricing`,
  }));
  const schema = {
    '@context': 'https://schema.org', '@type': 'SoftwareApplication',
    name: 'DeenClipped', url: siteBase(base),
    applicationCategory: 'MultimediaApplication', operatingSystem: 'Web browser',
    description: 'Turns long lectures and videos into review-ready short clips with captions, then publishes or schedules them to your own connected channels.',
  };
  if (offers.length) schema.offers = offers;
  return schema;
}

function faqSchema() {
  return {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(item => ({
      '@type': 'Question', name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}

export function home({ base, currentUser }) {
  const body = `
  <main>
    <section class="hero hero-redesign wrap">
      <div class="hero-copy-column">
        <span class="eyebrow"><i></i>AI clipping, with you in control</span>
        <h1>One lecture.<br><span>A week of clips.</span></h1>
        <p class="hero-copy">Paste a video. DeenClipped finds complete moments, captions and renders them, then waits for your approval before anything reaches your channels.</p>
        ${sourceForm()}
        <div class="hero-actions"><a class="button primary" href="/login?returnTo=/app">Start clipping free ${icon('arrow')}</a><a class="button secondary" href="#how-it-works">Watch the workflow</a></div>
        <p class="purpose-line"><strong>${escapeHtml(Number(config.tokensFree).toLocaleString())} source minutes included for ${escapeHtml(String(config.stripeTrialDays))} days.</strong> No card required to begin.</p>
      </div>
      <div class="hero-live-demo" aria-label="A long lecture becoming review-ready vertical clips">
        <div class="hero-source-photo">${sourceImage('lecturer', 'fetchpriority="high"')}<span><i></i>Source lecture · 48:26</span></div>
        <div class="hero-scan-card"><span>${icon('spark')}</span><div><b>Finding complete moments</b><small>Transcript · context · clean endings</small><i><b></b></i></div><em>68%</em></div>
        <div class="hero-results" aria-label="Generated clip examples">
          ${clipPreview('educator', 'Small steps become a steady practice.', 'hero-result result-one', '92 · Review')}
          ${clipPreview('teacher', 'Make the next step clear enough to act on.', 'hero-result result-two', '88 · Review')}
          ${clipPreview('mosque', 'Keep returning to what matters.', 'hero-result result-three', '84 · Review')}
        </div>
        <div class="hero-approved">${icon('shield')} Nothing publishes without your approval</div>
      </div>
      <div class="trust-strip" aria-label="DeenClipped product assurances"><span>${icon('shield')} Review-first by design</span><span>${icon('language')} English, Arabic and Quran-aware</span><span>${icon('calendar')} Scheduling built in</span><span>${icon('brain')} Private DeenAI on Studio</span></div>
    </section>

    <section class="outcome-strip" aria-label="The DeenClipped workflow"><div class="wrap"><span>Paste or upload</span><i>${icon('arrow')}</i><span>AI finds clips</span><i>${icon('arrow')}</i><span>You approve</span><i>${icon('arrow')}</i><span>Style &amp; schedule</span><i>${icon('arrow')}</i><span>Learn what to do next</span></div></section>

    <section class="section workflow-section" id="how-it-works">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">The whole product, in order</span><h2>From pasted link to published clip—without jumping between tools.</h2><p>Every tab has one job. Move from source selection to review, styling, scheduling, honest performance and private guidance in one connected flow.</p></div>
        ${journey()}
      </div>
    </section>

    <section class="section difference-section" id="safety">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Built for careful creators</span><h2>Fast enough for growth. Deliberate enough for the message.</h2><p>DeenClipped handles the repetitive work while keeping the final decision, the exact rendered video and every connected destination visible to you.</p></div>
        <div class="difference-grid">
          <article class="difference-card difference-large reveal"><div class="difference-copy"><span>${icon('shield')}</span><small>Review-first</small><h3>The AI suggests. You decide.</h3><p>Every candidate waits in Review with its score, reason and finished render. Scripture carries an additional human-review gate.</p><a href="/review-safety">See the safeguards ${icon('arrow')}</a></div><div class="difference-visual">${productVisual('review')}</div></article>
          <article class="difference-card reveal"><div class="difference-copy"><span>${icon('language')}</span><small>Language-aware</small><h3>English, Arabic and recitation are treated differently.</h3><p>Auto-detect can switch by segment. Recited ayat use a matched Quran treatment with translation beneath.</p></div>${clipPreview('mosque', 'Matched ayah · translation beneath', 'difference-clip', 'Quran review required')}</article>
          <article class="difference-card reveal"><div class="difference-copy"><span>${icon('publish')}</span><small>Destination control</small><h3>One failed post does not hide the successful ones.</h3><p>Each connected destination keeps its own publish, refusal and retry state.</p></div><div class="destination-state"><span><i class="platform youtube">YT</i><b>YouTube</b><em>Posted</em></span><span><i class="platform tiktok">TT</i><b>TikTok</b><em class="attention">Needs attention</em></span><span><i class="platform instagram">IG</i><b>Instagram</b><em>Scheduled</em></span></div></article>
        </div>
      </div>
    </section>

    <section class="section operations-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">After approval</span><h2>Your content operation stays in one place.</h2><p>Approved clips move naturally into the calendar, measurable workflow reports and DeenAI—without pretending DeenClipped has social metrics it never fetched.</p></div>
        <div class="operations-grid">
          <article class="operation-card reveal"><div><span>${icon('calendar')}</span><small>Schedule</small><h3>Keep the next posting window full.</h3><p>Post now, download, choose a date or fill the next available slots.</p></div>${productVisual('schedule')}</article>
          <article class="operation-card reveal"><div><span>${icon('chart')}</span><small>Performance</small><h3>See the workflow numbers you can trust.</h3><p>Made, kept, scheduled, posted and failed—drawn from your own records.</p></div>${productVisual('performance')}</article>
          <article class="operation-card reveal"><div><span>${icon('brain')}</span><small>DeenAI</small><h3>Ask what deserves attention next.</h3><p>Studio guidance runs on the private processing server and points back to real product actions.</p></div>${productVisual('deenai')}</article>
        </div>
      </div>
    </section>

    <section class="section templates-section" id="templates">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Five real template styles</span><h2>One message. Five clear visual treatments.</h2><p>Fresh, high-resolution source photography demonstrates each shipped style. Basic starts with Clean Line; Pro unlocks the complete catalogue.</p></div>
        ${templateCatalogue()}
        <div class="template-safety reveal"><span>${icon('shield')}</span><p><strong>Quran Recitation is deliberately different.</strong> It matches recitation to the Quran corpus, shows the ayah and translation, keeps nasheed off and always requires human review.</p></div>
      </div>
    </section>

    <section class="section editor-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Style now. Full editor next.</span><h2>Keep clips consistent without overstating what has launched.</h2><p>Templates, clip-local style changes and re-renders are available today. The complete timeline editor stays visibly marked coming soon while its visual checks finish.</p></div>
        <div class="editor-showcase editor-code-showcase reveal">${productVisual('style')}<span class="availability-badge">Full editor preview · coming soon</span></div>
        <div class="feature-row reveal"><div><span>${icon('template')}</span><b>Reusable caption templates</b><p>Save style changes for future clips or keep a one-clip adjustment local to that render.</p></div><div><span>${icon('music')}</span><b>Nasheed controls</b><p>Upload and rotate vocal-only tracks. Quran recitation is deliberately left without a track underneath it.</p></div><div><span>${icon('edit')}</span><b>Editor held for verification</b><p>Timeline, caption and framing controls are not advertised as launched while the gate is active.</p></div></div>
      </div>
    </section>

    <section class="section pricing-section">
      <div class="wrap"><div class="section-head reveal"><span class="section-label">Basic, Pro and Studio</span><h2>Pay for source minutes. Keep the workflow.</h2><p>One token represents one selected source-video minute. Reviewing, ordinary re-renders and cutting more clips from the processed source do not spend that source time again.</p></div>${pricingCards()}</div>
    </section>

    <section class="section faq-section" id="faq"><div class="wrap"><div class="section-head reveal"><span class="section-label">Questions</span><h2>Know how the workflow works before you start.</h2></div>${faqBlock()}</div></section>

    <section class="section final-section"><div class="wrap final-cta reveal"><div><span class="section-label">Start with the next lecture</span><h2>${escapeHtml(Number(config.tokensFree).toLocaleString())} source minutes. ${escapeHtml(String(config.stripeTrialDays))} days. A real review queue.</h2><p>Choose a range, generate the clips and decide what is worth publishing before anything reaches your channels.</p></div><a class="button primary" href="/login?returnTo=/app">Start Basic free ${icon('arrow')}</a></div></section>
  </main>`;
  return layout({ base, currentUser, ...meta('/'), body,
    jsonLd: [organizationSchema(base), webSiteSchema(base), softwareSchema(base), faqSchema()] });
}

export function features({ base, currentUser }) {
  const body = `<main>
    <section class="page-hero wrap"><span class="eyebrow"><i></i>Every part of the workflow</span><h1>From a long Islamic lecture to clips you are ready to publish.</h1><p>Choose the source minutes, find complete moments, render the real clips, review every decision and publish to your own connected destinations.</p><div class="hero-actions"><a class="button primary" href="/login?returnTo=/app">Start Basic free ${icon('arrow')}</a><a class="button secondary" href="#feature-map">Explore every feature</a></div></section>
    <section class="page-content"><div class="wrap">
      <div class="feature-page-grid" id="feature-map">
        <article>${icon('link')}<h3>Range-based import</h3><p>Paste a supported URL or upload a file, then process only the source minutes you choose.</p></article>
        <article>${icon('clips')}<h3>AI clip discovery</h3><p>Find complete moments, rank them and explain why each candidate is worth reviewing.</p></article>
        <article>${icon('shield')}<h3>Rendered review deck</h3><p>Watch the actual file that will post, then approve, reject or skip by button or keyboard.</p></article>
        <article>${icon('language')}<h3>Multilingual captions</h3><p>Switch between English, Arabic and translation treatment by segment when auto-detect is selected.</p></article>
        <article>${icon('template')}<h3>Five templates</h3><p>Use Clean Line, Bold Stack, Headline, Mono Minimal or the Quran-specific treatment.</p></article>
        <article>${icon('music')}<h3>Vocal-only audio</h3><p>Manage and rotate nasheed tracks while keeping them out of Quran recitation clips.</p></article>
        <article>${icon('chart')}<h3>Performance and DeenAI</h3><p>Work from measurable workflow results, with private AI advice on the highest tier.</p></article>
        <article>${icon('calendar')}<h3>Scheduling and automation</h3><p>Approve manually or use score-based rules, then fill the next available posting windows.</p></article>
        <article>${icon('account')}<h3>Destination-level publishing</h3><p>Connect your own accounts and see success, refusal and retry state separately for each destination.</p></article>
      </div>

      <section class="feature-deep-dive reveal" id="source-and-review"><div class="feature-deep-copy"><span class="section-label">Import, generate and review</span><h2>Spend tokens on the source range, not every decision afterwards.</h2><p>DeenClipped reads the duration before charging, downloads the selected stretch where the source permits it, and renders every candidate at full quality from the first pass. Cutting more clips from that processed source, ordinary re-renders and review actions do not charge the source minutes again.</p><div class="detail-list">${checkItem('Strong moments with reasons','Candidate scores include the worker’s explanation, such as a complete ending or a clear question hook.')}${checkItem('The real rendered file','The review deck plays the exact media that can be published, rather than drawing a second caption imitation in the browser.')}${checkItem('Fast keyboard decisions','Approve with A, reject with X, skip with S or the arrow keys, and control playback without leaving the deck.')}</div></div><div class="feature-scene-stack">${productVisual('discover')}${productVisual('review')}</div></section>

      <section class="feature-deep-dive reverse reveal" id="captions"><div class="feature-deep-copy"><span class="section-label">Captions and faith-sensitive review</span><h2>English, Arabic and recitation are not treated as the same text.</h2><p>With auto-detect, language can switch by segment inside the same lecture. Spoken Arabic receives Arabic captions with an English line beneath it. Recitation follows a separate Quran template that matches the ayah itself rather than trusting a rough transcript.</p><div class="detail-list">${checkItem('Scripture always waits for a person','The QUOTE_RISK gate prevents Quran clips from passing through automatic publishing without human review.')}${checkItem('No approximate ayah in the editor','Scripture is excluded from draft caption echoes because an approximate verse is unacceptable.')}${checkItem('No nasheed beneath recitation','The Quran template deliberately leaves the music track off and removes distracting branding treatments.')}</div></div><div class="caption-photo-stack">${clipPreview('mosque', 'Matched ayah · translation beneath', 'feature-reel-large', 'Quran review required')}${clipPreview('educator', 'Arabic line · English translation', 'feature-reel-small', 'Multilingual')}</div></section>

      <section class="template-feature-section" id="templates"><div class="section-head reveal"><span class="section-label">Template catalogue</span><h2>Five distinct looks, shown with realistic Islamic content.</h2><p>Clean Line is included with Basic. Pro and Studio unlock the complete catalogue, including the Quran-specific treatment.</p></div>${templateCatalogue()}</section>

      <section class="feature-deep-dive reveal" id="editor"><div class="feature-deep-copy"><span class="section-label">Templates, audio and editor preview</span><h2>Style changes work today. The full editor stays clearly marked as coming soon.</h2><p>Templates can be adjusted and re-rendered now, including clip-local caption and visual changes. The complete timeline, framing and drag controls are visible behind a launch gate until their visual verification is finished.</p><div class="detail-list">${checkItem('Clip-local or reusable','Keep one clip’s adjustment local, or save the look back to the shared template for future waiting clips.')}${checkItem('Full-quality review remains available','The editor gate does not remove rendered review, templates, re-renders, downloads, scheduling or publishing.')}${checkItem('Vocal-only track control','Upload, select and rotate nasheed tracks while respecting the Quran template’s music-off rule.')}</div></div><div class="editor-feature-visual">${productVisual('style')}<span class="availability-badge">Full editor preview · coming soon</span></div></section>

      <section class="feature-deep-dive reverse reveal" id="operations"><div class="feature-deep-copy"><span class="section-label">Projects, operations and performance</span><h2>See the lecture, every clip and the next action without manufactured analytics.</h2><p>The library keeps each source and its clips together, while operational status shows what is queued, processing, waiting for review, scheduled, posted or blocked. Performance reports what DeenClipped can prove from its own records instead of pretending to know social view counts it never fetched.</p><div class="detail-list">${checkItem('Honest workflow metrics','Made, kept, scheduled, posted and failed are counted from real account records.')}${checkItem('Clear recovery state','A cancelled job gives the worker slot back, and a restart does not silently revive work the account cancelled.')}${checkItem('DeenAI by tier','Pro receives calculated insights; Studio adds Ask DeenAI on the private processing server and priority rendering.')}</div></div><div class="feature-scene-stack">${productVisual('performance')}${productVisual('deenai')}</div></section>

      <section class="feature-deep-dive reveal" id="publishing"><div class="feature-deep-copy"><span class="section-label">Publishing and scheduling</span><h2>One clip can succeed on one platform and need attention on another.</h2><p>Approved clips can be downloaded, posted immediately or placed into publishing windows. Each destination keeps its own outcome, so a successful YouTube post is not filed as failed because TikTok refused—and retry targets only the failed leg.</p><div class="detail-list">${checkItem('Your connected accounts','YouTube, supported Meta destinations and TikTok connections stay scoped to the signed-in DeenClipped account.')}${checkItem('Platform rules stay visible','TikTok requires the creator to choose privacy; external app reviews can still limit how a platform accepts a post.')}${checkItem('Up to four or eight daily windows','Core scheduling provides four daily windows; Studio expands the same chosen part of the day to eight.')}</div></div>${productVisual('schedule')}</section>

      <div class="feature-page-showcase reveal">${productVisual('import')}</div>
      <div class="final-cta reveal"><div><span class="section-label">Start with the whole workflow</span><h2>Basic includes generation, review, automation and publishing.</h2><p>Upgrade when you need every template, no watermark, DeenAI insights, private Ask, priority rendering or more daily posting windows.</p></div><a class="button primary" href="/pricing">Compare the plans ${icon('arrow')}</a></div>
    </div></section>
  </main>`;
  return layout({ base, currentUser, ...meta('/features'), body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function pricing({ base, currentUser }) {
  const body = `<main><section class="page-hero pricing-hero wrap"><span class="eyebrow"><i></i>Three tiers · one clear token model</span><h1>Start with the whole workflow. Upgrade for scale.</h1><p>One token represents one selected source-video minute. Subscription allowances refresh normally, while one-time top-up tokens stay in your wallet until used.</p><div class="pricing-trust"><span>${escapeHtml(config.tokensFree)} starter tokens</span><span>${escapeHtml(config.stripeTrialDays)} days of Basic access</span><span>Secure Stripe Checkout</span><span>No raw card storage</span></div></section><section class="page-content"><div class="wrap"><div class="pricing-section-head"><span class="section-label">Basic, Pro and Studio</span><h2>Choose the capability level, then the billing period.</h2><p>Basic includes the real workflow. Pro adds every template, watermark removal and calculated DeenAI insights. Studio adds private Ask, priority rendering and more posting windows.</p></div>${pricingCards(currentUser)}<section class="comparison-section"><div class="pricing-section-head"><span class="section-label">Plan comparison</span><h2>See exactly what changes.</h2><p>Core creation, review, automation and supported publishing are not hidden behind a paid tier.</p></div>${planComparison()}</section>${tokenShop(currentUser)}<div class="pricing-explainer"><div><span class="section-label">How tokens work</span><h2>Clear before you render.</h2><p>DeenClipped reads the source duration, lets you select a start and end time, then estimates usage from that selected range. Subscription allowance is used before purchased top-ups.</p>${checkItem(`${config.tokensPerMinute} token per source minute`,'Usage follows the selected source window.')}${checkItem('More clips do not repeat the source charge','Cutting more candidates from an already processed source does not spend the source minutes again.')}${checkItem('Ordinary re-renders stay fair','Review, template changes and ordinary re-renders do not unnecessarily consume tokens.')}${checkItem('Top-ups persist','Purchased tokens do not disappear when a subscription renews or is cancelled.')}</div>${productVisual('import')}</div></div></section></main>`;
  return layout({ base, currentUser, ...meta('/pricing'), body,
    jsonLd: [organizationSchema(base), webSiteSchema(base), softwareSchema(base)] });
}

export function contact({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Direct product support</span><h1>Tell us what stopped the workflow.</h1><p>Questions about an import, rendered clip, connected destination, schedule or payment can be sent directly to DeenClipped support.</p></section><section class="page-content"><div class="wrap contact-layout"><div class="contact-card"><span class="contact-icon">${logoMark()}</span><h2>Support</h2><p>Email <a href="mailto:support@deenclipped.online">support@deenclipped.online</a></p><p>Include the email attached to your account, the project or clip name, the destination involved and the exact message you saw. Never email a password, OAuth token or payment-card number.</p><a class="button primary" href="mailto:support@deenclipped.online?subject=DeenClipped%20support%20request">Email support</a></div><div class="contact-context"><span class="section-label">Useful details</span><h2>Help us find the exact step.</h2>${checkItem('Import or processing','Include the source type, selected time range and the stage where it stopped.')}${checkItem('Captions or render','Name the template, language and whether the issue appears in the rendered review video.')}${checkItem('Publishing','Name every destination and which one posted, failed or is still waiting.')}${checkItem('Billing','Include the plan or token pack and the checkout time, but never raw card details.')}<div class="contact-reels">${clipPreview('educator', 'Caption or render', 'contact-reel')}${clipPreview('teacher', 'Import or processing', 'contact-reel')}${clipPreview('mosque', 'Publishing state', 'contact-reel')}</div></div></div></section></main>`;
  return layout({ base, currentUser, ...meta('/contact'), body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function privacy({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Privacy Policy</h1><p>How DeenClipped handles account, video, billing and connected-platform information.</p></section><section class="page-content"><article class="legal"><p>Last updated: 30 August 2026</p><p>DeenClipped helps users create, review and publish short-form clips from long videos. This Privacy Policy explains what information is collected and how it is used.</p><h2>Information we collect</h2><p>When you sign in with Google, DeenClipped receives your Google account email address, profile name and profile picture from the <code>openid email profile</code> scopes, and uses them to create and identify your account. When you sign in with email, only your address and a hashed password are stored. We may also store project settings, uploaded source information, generated clips, captions, templates, schedules and publishing preferences.</p><h2>Google and YouTube user data</h2><p>If you choose to connect a YouTube channel, DeenClipped requests the minimum Google permissions needed to identify the channel and upload clips that you expressly approve or schedule. The permissions requested are <code>youtube.upload</code> and <code>youtube.readonly</code>. DeenClipped does not request YouTube watch history, Google passwords or browser cookies.</p><h3>YouTube API Data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through YouTube API Services:</p><ul><li><strong>Channel identifier, channel name and channel profile image</strong> — read once when you connect a channel (<code>channels.list</code>, part <code>snippet</code>), so the app can show you which channel is connected and address uploads to it.</li><li><strong>Granted permission list and encrypted OAuth access and refresh tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>Video title, duration and thumbnail image URL</strong> of a YouTube link you paste for clipping — read through the YouTube Data API (<code>videos.list</code>, parts <code>snippet</code> and <code>contentDetails</code>) so the app can show the video in your library and estimate its processing cost. That API response also contains the video's description and channel name; DeenClipped reads them in the response but does not store or display them.</li><li><strong>The video identifier of a clip DeenClipped uploaded on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display YouTube statistics of any kind. No view counts, like counts, comment counts, subscriber counts or analytics are retrieved: the only metadata request made is for a video's snippet and content details.</p><h3>How long YouTube API Data is kept</h3><p>Cached YouTube API Data — the video title, duration and thumbnail URL of an imported link, and the channel name and profile image of a connected channel — is automatically deleted after 30 days, in line with the YouTube API Services Developer Policies. A daily process removes anything older than that window; the data is read again from YouTube only when you next need it. Your channel identifier and the identifiers of clips DeenClipped uploaded are retained while your account and connection remain active, because they are the address publishing is sent to and the record of what was published.</p><p>When you disconnect a channel, the stored Google credential is removed immediately and DeenClipped asks Google to revoke the grant. You can also revoke DeenClipped's access at any time from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google account security settings</a>.</p><p>Google and YouTube data is used only to display and test your connected channel and to upload clips to that channel when you request publishing. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers. Service providers acting on our behalf may process data only as needed to host, secure and operate DeenClipped.</p><p>DeenClipped's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>, including its Limited Use requirements.</p><p>By connecting a channel you are also using YouTube API Services. The <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a> apply to that use, and you can review or revoke DeenClipped's access to your Google account at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">https://myaccount.google.com/permissions</a>.</p><h2>Meta (Facebook and Instagram) user data</h2><p>If you choose to connect Facebook or Instagram, DeenClipped requests these Meta permissions: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code> and <code>instagram_content_publish</code>. They are the minimum needed to list the Pages you manage, identify the Instagram professional account linked to a Page, and publish the clips you expressly approve or schedule.</p><h3>Meta data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through the Meta Graph API:</p><ul><li><strong>The Facebook Pages you manage</strong> — Page identifier, Page name and a Page access token, read once when you connect (<code>/me/accounts</code>), so the app can show you which Pages are available and address posts to them.</li><li><strong>The Instagram professional account linked to each Page</strong> — its identifier, username or name and profile picture URL, read in that same request, so the app can show which Instagram account a Page publishes to.</li><li><strong>Encrypted Page access tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>The media identifier of a post DeenClipped published on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display Facebook or Instagram insights or statistics of any kind — no follower counts, view counts, like counts or comment counts. It does not read your comments or direct messages, does not read posts you did not publish through DeenClipped, and does not read your Facebook profile beyond the list of Pages you manage.</p><p>Publishing sends the rendered clip and the caption you wrote to Meta. An Instagram Reel is created as a media container and then published (<code>/media</code>, then <code>/media_publish</code>); a Facebook Reel is uploaded to the Page you selected. Nothing is posted that you have not approved or scheduled.</p><p>Meta data is used only to display your connected Pages and Instagram accounts and to publish clips you request. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers.</p><p>When you disconnect Facebook or Instagram, the stored Page tokens are removed from DeenClipped immediately and publishing to those accounts stops. You can also remove DeenClipped’s access at any time from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>.</p><h2>TikTok user data</h2><p>If you choose to connect TikTok, DeenClipped requests the <code>user.info.basic</code> and <code>video.publish</code> scopes. It reads your TikTok display name, avatar and open identifier so the app can show which account is connected, and it reads your account’s current posting options (<code>creator_info</code>) — the privacy levels available to you, whether comments, Duet and Stitch are permitted, and the maximum video length — so the app offers only settings your account actually allows.</p><p>Encrypted TikTok access and refresh tokens are stored so publishing works without asking you to sign in again, together with the video identifier of anything DeenClipped published for you. DeenClipped does not request or store TikTok analytics, your follower list, comments or direct messages.</p><p>Every post carries the privacy level and the comment, Duet, Stitch and commercial-content settings you chose for that clip. DeenClipped never selects a privacy level on your behalf. Disconnecting TikTok removes the stored credential immediately, and you can revoke access at any time from your TikTok account settings.</p><h2>Security and storage</h2><p>Connected-platform tokens are encrypted at rest and separated by DeenClipped account. Access is limited to the service operations needed to provide the user-facing connection and publishing features. No internet service can guarantee absolute security, but DeenClipped uses reasonable technical and organisational safeguards appropriate to the data handled.</p><h2>Control, revocation and deletion</h2><p>You can disconnect any connected platform — YouTube, Facebook, Instagram or TikTok — from the Platforms page at any time. Disconnecting immediately removes that platform’s stored credential from your DeenClipped connection and disables future uploads to it; for YouTube, DeenClipped also asks Google to revoke the grant. You can additionally revoke access from <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">Google Account connections</a>, from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>, or from your TikTok account settings.</p><p>To request deletion of your account data, email <a href="mailto:support@deenclipped.online?subject=DeenClipped%20data%20deletion%20request">support@deenclipped.online</a> from the address attached to your account. Verified deletion requests, including associated Google, Meta and TikTok user data, are completed within 30 days unless retention is required by law. Published posts on third-party platforms are not deleted merely by disconnecting; they remain under your control on those platforms.</p><h2>Billing</h2><p>Payments are processed by Stripe. DeenClipped may store subscription status, plan, token balance and Stripe customer references, but does not directly store complete payment-card details.</p><h2>Source content and retention</h2><p>You are responsible for ensuring you have permission to process and publish source content. Project files and generated clips may be retained while your account is active so the service can provide editing, rerendering and publishing. You may delete individual projects in the app or request account-data deletion as described above.</p><h2>Contact</h2><p>Privacy and data-control questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  const disclosedBody = body.replace('<h2>Security and storage</h2>', '<h2>YouTube URL processing</h2><p>When you submit a public YouTube URL for clipping on deenclipped.online, the URL and requested source range are sent to DeenClipped\'s own processing server. That server uses <code>yt-dlp</code> and may route the download through Webshare\'s residential proxy network to retrieve the public source. Where the source permits it, only the selected time range is downloaded. Transcription, clip selection and rendering happen on the DeenClipped processing server.</p><p><strong>No Google credentials are sent to the import downloader or proxy network.</strong> Your Google account email, OAuth access and refresh tokens, and connected-channel information are not included in the import request. The Google connection is used only for channel identity and uploads you approve or schedule.</p><h2>DeenAI processing</h2><p>DeenAI insights are calculated from records already held in your DeenClipped workspace, such as project, approval, schedule and destination outcomes. Studio\'s Ask DeenAI feature runs on the private model hosted on the DeenClipped processing server. Its request contains compact account figures and kept clip titles; it does not send lecture transcripts to the model. DeenAI output is not used to train a general-purpose model.</p><h2>Security and storage</h2>');
  return layout({ base, currentUser, ...meta('/privacy'), body: disclosedBody });
}

export function terms({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Terms of Service</h1><p>The rules for using DeenClipped to create, review and publish short-form clips.</p></section><section class="page-content"><article class="legal"><p>Last updated: 30 August 2026</p><p>These Terms govern use of DeenClipped, a service for creating, reviewing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions.</p><h2>Google and YouTube services</h2><p>DeenClipped uses YouTube API Services for connected-channel and publishing features. By using those features, you also agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and acknowledge the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>. DeenClipped publishes only through the permissions you grant and the actions you approve or schedule. You can remove DeenClipped's access from the Platforms page or from your Google Account connections.</p><h2>Connected platforms</h2><p>DeenClipped can publish to Facebook Pages, Instagram professional accounts and TikTok once you connect them. Publishing happens only through the permissions you grant and the posts you approve or schedule, and each post carries the privacy and interaction settings you chose for it. Using those features also means agreeing to the <a href="https://www.facebook.com/terms.php" target="_blank" rel="noopener">Meta Terms of Service</a>, the <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener">Instagram Terms of Use</a> and the <a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener">TikTok Terms of Service</a>, and to each platform’s own content rules. You remain responsible for what you publish. You can disconnect any platform from the Platforms page at any time.</p><h2>Billing and tokens</h2><p>Some features require tokens, subscriptions or paid plans. Token usage is based on the selected source-video time and the plan rules displayed in the app. Checkout displays final billing terms before purchase.</p><h2>Service availability</h2><p>Features may change, pause or be removed over time. The complete editor is currently marked coming soon. DeenClipped does not guarantee uninterrupted access or that every external video URL can be imported. YouTube URL import is not an official YouTube Data API download capability and remains subject to source availability, provider access and platform restrictions.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  const disclosedBody = body
    .replace('<h2>Billing and tokens</h2>', '<h2>YouTube URL processing</h2><p>DeenClipped may use a commercial video-processing provider to retrieve and clip a public YouTube URL that you submit. This is separate from the official YouTube API connection used for channel identity and publishing. Imports depend on the source being accessible to the provider and may fail because of source restrictions, rights controls, availability, quotas or platform changes.</p><h2>Billing and tokens</h2>')
    .replace('YouTube source-file import is not represented as an official YouTube API capability and remains unavailable where YouTube does not permit access.', 'YouTube URL import is not an official YouTube Data API download capability and remains subject to source availability, provider access and platform restrictions.');
  return layout({ base, currentUser, ...meta('/terms'), body: disclosedBody });
}

/**
 * The page a wrong URL lands on.
 *
 * A bare JSON 404 was being served to people, not just to API callers: a
 * mistyped address, an old link from a message, an expired share — all of them
 * got `{"error":"Not found."}` on a white page and no way back into the
 * product they were trying to reach.
 */
export function notFound({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>404</span><h1>That page isn’t here.</h1><p>The link may be old, or the address slightly off. Nothing has gone wrong with your account.</p><div class="pricing-trust" style="margin-top:22px"><a class="button primary" href="${currentUser ? '/app' : '/'}">${currentUser ? 'Back to the studio' : 'Back to the homepage'}</a><a class="button" href="/contact">Tell support</a></div></section></main>`;
  return layout({ base, currentUser, title: 'Page not found — DeenClipped', description: 'That DeenClipped page could not be found.', canonicalPath: '/404', body });
}

/**
 * robots.txt and sitemap.xml, built from the routes that actually exist.
 *
 * Everything behind sign-in is disallowed: the app, the owner dashboard, the
 * auth endpoints and the API. There is nothing there for a crawler, and a
 * crawler following a sign-out link is its own small outage.
 */

/* ── SEO landing pages ──────────────────────────────────────────────────────
 * One template for every registry-driven page, built from the SAME classes the
 * hand-written pages use. A landing page that looks like a cheap blog beside a
 * premium product page costs more trust than the ranking is worth.
 */


/**
 * Title and description for a registry page, drawn from the registry.
 *
 * These used to be typed a second time at each layout() call, and they drifted:
 * /contact's registry entry described the page properly while the page itself
 * served "Contact DeenClipped support." — 28 characters, which is what Google
 * shows under the link. Two lists, one of them wrong, and nothing to notice it.
 */
function meta(path) {
  const page = pageFor(path);
  if (!page) return {};
  return { title: page.title, description: page.description, canonicalPath: page.path };
}

/**
 * Re-exported so a caller needs one import for a page: the registry entry
 * decides that a path exists, the copy decides what it says.
 */
export { SEO_COPY };

/** Visible breadcrumbs. Schema without these on the page would be a lie. */
function breadcrumbNav(page) {
  const trail = breadcrumbFor(page);
  if (trail.length < 2) return '';
  const crumbs = trail.map((step, i) => {
    const last = i === trail.length - 1;
    const label = escapeHtml(step.name);
    return last
      ? `<span aria-current="page">${label}</span>`
      : `<a href="${escapeHtml(step.path)}">${label}</a>`;
  }).join('<span class="crumb-sep" aria-hidden="true">/</span>');
  return `<nav class="breadcrumbs wrap" aria-label="Breadcrumb">${crumbs}</nav>`;
}

function breadcrumbSchema(base, page) {
  const root = siteBase(base);
  const trail = breadcrumbFor(page);
  if (trail.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: `${root}${step.path === '/' ? '/' : step.path}`,
    })),
  };
}

/** The sibling links that stop a page being a dead end. */
function relatedLinks(page) {
  const links = (page.links || []).map(pageFor).filter(Boolean);
  if (!links.length) return '';
  const items = links.map(item =>
    `<a class="related-card" href="${escapeHtml(item.path)}"><strong>${escapeHtml(item.breadcrumb || item.intent)}</strong><span>${escapeHtml(item.description.split('.')[0])}.</span></a>`
  ).join('');
  return `<section class="related-links"><h2 class="section-label">Keep going</h2><div class="related-grid">${items}</div></section>`;
}

/**
 * The offer that comes AFTER the tool has done its job.
 *
 * Placed below the widget, never in front of it and never as a gate. A free
 * tool that interrupts itself to ask for an email is not a free tool, and one
 * of those would cost more trust than the signups are worth. This is the
 * opposite: the visitor has already had the thing they came for, and this
 * says what the product does about the same problem.
 */
function toolFollowUp(headline, body) {
  return `<div class="tool-followup">
        <div>
          <strong>${escapeHtml(headline)}</strong>
          <span>${escapeHtml(body)}</span>
        </div>
        <a class="button primary" href="/login?returnTo=/app">Clip a video free ${icon('arrow')}</a>
      </div>`;
}

/**
 * The interactive part of a free-tool page.
 *
 * Kept beside the renderer rather than in the copy module because it is
 * markup, not words. The behaviour lives in /tool-widgets.js: the CSP hashes
 * inline scripts from index.html only, so a marketing page cannot carry one.
 */
function toolWidget(path) {
  if (path === '/tools/safe-zone-checker') {
    const zones = [
      ['universal', 'Safe on all three', true],
      ['tiktok', 'TikTok', true],
      ['reels', 'Instagram Reels', false],
      ['shorts', 'YouTube Shorts', false],
    ].map(([key, label, on]) =>
      `<label class="sz-toggle"><input type="checkbox" data-sz-zone="${key}"${on ? ' checked' : ''}> ${escapeHtml(label)}</label>`
    ).join('');
    return `<section class="tool-widget" data-tool="safe-zones">
      <div class="tool-widget-body">
        <div class="sz-stage">
          <canvas data-sz-canvas width="270" height="480" aria-label="Vertical frame with platform safe zones drawn over it"></canvas>
        </div>
        <div class="tool-controls">
          <label class="sz-drop" data-sz-drop>
            <input type="file" accept="image/*" data-sz-file hidden>
            <strong>Add a frame</strong>
            <span>Drop an image here, or choose one. It is read in your browser and never uploaded.</span>
          </label>
          <div class="sz-toggles">${zones}</div>
          <p class="tool-status" data-sz-status role="status"></p>
          <table class="sz-legend">
            <tr><th>Covered area</th><th>Top</th><th>Right</th><th>Bottom</th></tr>
            <tr><td>TikTok</td><td>100</td><td>140</td><td>320</td></tr>
            <tr><td>Instagram Reels</td><td>220</td><td>130</td><td>430</td></tr>
            <tr><td>YouTube Shorts</td><td>90</td><td>60</td><td>250</td></tr>
            <tr class="sz-legend-safe"><td>Safe on all three</td><td colspan="3">900 &times; 1400, centred</td></tr>
          </table>
          <p class="tool-foot">Pixels inside a 1080 &times; 1920 frame, checked August 2026. Platforms move their interface without announcing it, which is why looking at a real frame beats trusting a number.</p>
        </div>
      </div>
      ${toolFollowUp('You have seen where each platform covers the frame.',
        'DeenClipped places captions inside that area automatically and burns them in, so you are not checking this by hand on every clip.')}
    </section>`;
  }

  if (path === '/tools/clip-calculator') {
    // The two figures come from config, so the calculator cannot drift away
    // from what billing actually charges.
    return `<section class="tool-widget" data-tool="clip-calculator"
        data-tokens-per-minute="${escapeHtml(String(config.tokensPerMinute))}"
        data-free-tokens="${escapeHtml(String(config.tokensFree))}">
      <div class="tool-widget-body">
        <div class="tool-controls cc-inputs">
          <label class="cc-field"><span>How long is the recording?</span>
            <input type="number" data-cc="length" value="60" min="1" max="600" step="1"> <em>minutes</em></label>
          <label class="cc-field"><span>How much of it is worth clipping? <b data-cc-echo="useful">20%</b></span>
            <input type="range" data-cc="useful" value="20" min="1" max="100" step="1"></label>
          <label class="cc-field"><span>Typical clip length <b data-cc-echo="cliplen">40s</b></span>
            <input type="range" data-cc="cliplen" value="40" min="10" max="120" step="5"></label>
        </div>
        <div class="cc-output" data-cc-out aria-live="polite"></div>
      </div>
      ${toolFollowUp('That is the arithmetic. The work is the other half.',
        'DeenClipped finds the moments inside those minutes, cuts them, captions them and holds every clip for your approval. Basic is free and includes 40 tokens.')}
      <p class="tool-foot">One token is one source minute. Clip count assumes about two thirds of the selected time becomes finished clips — the rest is the run-up to a moment and the tail after it. Treat it as the ceiling: you will reject some of what comes back.</p>
    </section>`;
  }
  return '';
}

/*
 * Contextual links, inside the prose, where the sentence already points.
 *
 * Before this every internal link on the site was navigation, footer, or a
 * "keep going" card at the bottom — 22 of 28 pages had no link at all from
 * inside another page's body text. That matters twice over: a link inside a
 * sentence carries far more weight than a boilerplate footer link, and a
 * reader mid-paragraph who has just been told about the safe-zone checker will
 * follow a link and will not go hunting in the footer.
 *
 * Curated, not automatic. Each entry is a phrase that ALREADY appears in the
 * copy because the sentence needed it — nothing was written to create a link.
 * Three rules keep it from becoming the thing it is meant to avoid:
 *
 *   1. First occurrence only, and one link per target per page. Repeating an
 *      anchor down a page is the shape of manipulation, not of helpfulness.
 *   2. Never link a page to itself.
 *   3. At most three contextual links in a body. Past that a paragraph reads
 *      like a directory rather than an argument.
 */
const CONTEXTUAL_LINKS = [
  [/\bfree safe[- ]zone checker\b/i, '/tools/safe-zone-checker'],
  [/\bsafe[- ]zone checker\b/i, '/tools/safe-zone-checker'],
  [/\bsafe zones guide\b/i, '/guides/caption-safe-zones'],
  [/\bcaption safe zones\b/i, '/guides/caption-safe-zones'],
  // One phrase per target, not two: "review queue" and "human review" both
  // pointed here and together sent 17 body links to one page, which
  // concentrates weight without helping a reader who has already been offered
  // the link once.
  [/\breview queue\b/i, '/review-safety'],
  [/\bone token per source minute\b/i, '/pricing'],
  [/\bone token is one source minute\b/i, '/pricing'],
  [/\bfree plan\b/i, '/pricing'],
  [/\bmatched against the full corpus\b/i, '/islamic-video-clipper'],
  [/\brecited Quran is matched\b/i, '/islamic-video-clipper'],
  [/\bword-level timings?\b/i, '/tools/ai-caption-generator'],
  [/\bburned[- ]in captions?\b/i, '/tools/ai-caption-generator'],
  [/\bgeneral[- ]purpose clippers?\b/i, '/alternatives'],
  [/\bthe whole pipeline\b/i, '/how-it-works'],
  [/\brecorded lectures? (and talks )?\b/i, '/tools/lecture-clip-generator'],
  [/\bconference (session|talk)s?\b/i, '/tools/lecture-clip-generator'],
  [/\bgeneral (AI )?clip(ping)? tools?\b/i, '/alternatives'],
  [/\ba general tool\b/i, '/alternatives'],
];

/**
 * `state` is shared across every section of ONE page, not created per section.
 *
 * Created per section, the "one link per target" rule reset on each heading
 * and a page linked the same destination twice — which is the repetition this
 * is meant to prevent. Caught by test, not by reading.
 */
function withContextualLinks(html, currentPath, state) {
  const linked = state.linked;
  let out = html;
  for (const [pattern, target] of CONTEXTUAL_LINKS) {
    if (state.used >= 3) break;
    if (target === currentPath || linked.has(target)) continue;
    // Only in running text: never inside an attribute or an existing anchor.
    const match = pattern.exec(out);
    if (!match) continue;
    const before = out.slice(0, match.index);
    if ((before.split('<a ').length - 1) > (before.split('</a>').length - 1)) continue;
    out = `${before}<a href="${target}">${match[0]}</a>${out.slice(match.index + match[0].length)}`;
    linked.add(target);
    state.used += 1;
  }
  return out;
}

/**
 * The next action, and proof that the thing exists.
 *
 * Fifteen landing pages of prose with no picture of the product is a
 * conversion problem, not a design preference: a visitor who has read four
 * paragraphs still has not seen a clip, and "paste a link" is a much smaller
 * ask than "create an account". The form is the same one the homepage uses --
 * it carries the pasted URL through sign-in and into the importer, so the
 * click is not thrown away.
 *
 * Commercial pages only. A guide should answer the question before it asks for
 * anything, and a free tool already has its own control on the page.
 */
function proofBand(page) {
  const commercial = [KIND.TOOL, KIND.AUDIENCE, KIND.USE_CASE].includes(page.kind);
  if (!commercial) return '';
  return `<section class="seo-proof wrap">
      <div class="seo-proof-copy">
        <span class="section-label">Start here</span>
        <h2>Paste a link and see what it finds.</h2>
        <p>Free to try with 40 tokens, no card. You choose the minutes worth clipping, and every clip waits for your approval before anything publishes.</p>
        ${sourceForm()}
      </div>
      <div class="seo-proof-media">${productVisual('discover')}${clipPreview('educator', 'A complete thought, ready for your review.', 'seo-proof-reel', '92 · Review')}</div>
    </section>`;
}

/**
 * VideoObject for an example page.
 *
 * REFUSES unless there is a real, publicly reachable video. That refusal is
 * the whole reason this function exists rather than a template: schema
 * describing a video that cannot be played is a fabrication, Google treats it
 * as one, and the penalty lands on the whole domain rather than the page.
 *
 * `example` must carry: contentUrl (a public media URL), thumbnailUrl,
 * uploadDate (ISO date), durationSec, name and description. Anything missing
 * and this returns null and the page renders without schema, which is the
 * correct outcome -- a page with no VideoObject ranks worse than one with a
 * true VideoObject and infinitely better than one with a false one.
 *
 * Nothing is registered under KIND.EXAMPLE yet: there is no repo-owned public
 * demo clip, and a customer's clip is theirs and must never be published here.
 */
export function videoObjectFor(base, page, example) {
  if (!page || !example) return null;
  const root = siteBase(base);
  const url = String(example.contentUrl || '');
  // A public https URL, and not one of the app's own signed or private paths.
  if (!/^https:\/\//.test(url)) return null;
  if (/\/api\/|token=|signature=/.test(url)) return null;
  if (!example.thumbnailUrl || !example.uploadDate || !example.name) return null;
  const duration = Number(example.durationSec);
  if (!Number.isFinite(duration) || duration <= 0) return null;

  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: example.name,
    description: example.description || page.description,
    thumbnailUrl: [example.thumbnailUrl],
    uploadDate: example.uploadDate,
    // ISO 8601 duration, which is what schema.org expects and what people
    // most often get wrong by writing seconds.
    duration: `PT${Math.floor(duration / 60)}M${Math.round(duration % 60)}S`,
    contentUrl: url,
    embedUrl: example.embedUrl || undefined,
    isFamilyFriendly: true,
    publisher: {
      '@type': 'Organization',
      name: 'DeenClipped',
      url: root,
    },
  };
}

/**
 * A hub page lists everything in its cluster, computed rather than typed.
 *
 * The first version listed three guides by hand in the registry's `links`, and
 * the two it did not list were reachable from nowhere -- the crawl test caught
 * it, which is exactly why that test walks links instead of trusting the
 * sitemap. Derived from the cluster, a guide added tomorrow appears here on
 * its own and cannot be orphaned.
 */
function clusterIndex(page) {
  if (!page || page.kind !== KIND.GUIDE || page.path !== '/guides') return '';
  const rows = SEO_PAGES
    .filter(item => item.cluster === page.cluster && item.path !== page.path)
    .map(item => `<a class="guide-row" href="${escapeHtml(item.path)}">
        <strong>${escapeHtml(item.breadcrumb || item.intent)}</strong>
        <span>${escapeHtml(item.description)}</span>
        <em>${item.kind === KIND.FREE_TOOL ? 'Free tool' : 'Guide'}</em>
      </a>`).join('');
  return rows ? `<section class="guide-index">${rows}</section>` : '';
}

/**
 * Render one registry page from drafted copy.
 * `copy` is {h1, lede, sections[], faqs[], ctaLabel}.
 */
export function seoPage({ base, currentUser, page, copy }) {
  // .seo-section, NOT .feature-deep-dive: that class is a two-column grid
  // built for copy beside a product shot, and giving it one child leaves half
  // the page empty. See the note in marketing.css.
  // One state for the whole page, so the per-target and per-page caps mean
  // what they say.
  const linkState = { linked: new Set(), used: 0 };
  const sections = (copy.sections || []).map(section => `
      <section class="seo-section reveal">
        <h2>${escapeHtml(section.heading)}</h2>
        <p>${withContextualLinks(escapeHtml(section.body), page.path, linkState)}</p>
      </section>`).join('');

  const faqs = (copy.faqs || []).map(item =>
    `<details class="faq-item"><summary>${escapeHtml(item.q)}</summary><p>${escapeHtml(item.a)}</p></details>`).join('');

  const body = `<main>
    ${breadcrumbNav(page)}
    <section class="page-hero wrap">
      <span class="eyebrow"><i></i>${escapeHtml(page.breadcrumb || page.intent)}</span>
      <h1>${escapeHtml(copy.h1)}</h1>
      <p>${escapeHtml(copy.lede)}</p>
      <div class="hero-actions">
        <a class="button primary" href="/login?returnTo=/app">${escapeHtml(copy.ctaLabel)} ${icon('arrow')}</a>
        <a class="button secondary" href="/pricing">See plans and tokens</a>
      </div>
    </section>
    ${toolWidget(page.path)}
    ${clusterIndex(page)}
    ${proofBand(page)}
    <section class="page-content"><div class="wrap">
      <div class="seo-body">${sections}</div>
      ${faqs ? `<section class="faq-section"><h2>Questions</h2><div class="faq-list">${faqs}</div></section>` : ''}
      ${relatedLinks(page)}
      <div class="final-cta reveal">
        <div><span class="section-label">Start free</span><h2>Basic includes the whole workflow.</h2><p>Import a source, generate clips, review every one and publish to your own connected channels. Upgrade when you need more.</p></div>
        <a class="button primary" href="/login?returnTo=/app">${escapeHtml(copy.ctaLabel)} ${icon('arrow')}</a>
      </div>
    </div></section>
  </main>`;

  // FAQPage is built from the SAME array that rendered the list above. Google
  // penalises schema describing questions a visitor cannot see, and the only
  // way to be sure they match is to build both from one source.
  const faqSchema = (copy.faqs || []).length ? {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: copy.faqs.map(item => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  } : null;

  const schema = [organizationSchema(base), breadcrumbSchema(base, page), faqSchema].filter(Boolean);
  return layout({
    base, currentUser,
    title: page.title,
    description: page.description,
    canonicalPath: page.path,
    body,
    jsonLd: schema,
  });
}

/**
 * /llms.txt — a plain-text map of the public site for AI assistants.
 *
 * Stated honestly, because the brief asked for that and because it is true:
 * **this is not a Google ranking factor and no search engine reads it.** It is
 * a convention some AI tools follow to find a site's own description of itself
 * rather than inferring one from marketing copy. It costs one route and it
 * says exactly what the pages say -- no claim here that a human visitor is not
 * also shown, which is the line between a summary and cloaking.
 *
 * Built from the page registry, so it cannot describe a page that does not
 * exist or miss one that does.
 */
export function llmsTxt({ base }) {
  const root = String(base || '').replace(/\/+$/, '');
  const group = (label, kinds) => {
    const rows = indexablePages()
      .filter(page => kinds.includes(page.kind))
      .map(page => `- [${page.breadcrumb || page.intent}](${root}${page.path}): ${page.description}`);
    return rows.length ? [`## ${label}`, '', ...rows, ''] : [];
  };
  return [
    '# DeenClipped',
    '',
    '> AI video clipper that turns long videos and Islamic lectures into',
    '> review-ready short-form clips with multilingual captions, Quran-aware',
    '> rendering and publishing to the creator\'s own channels.',
    '',
    'Every clip waits in a review queue for a person to approve or reject.',
    'Nothing publishes on its own. Clips containing recited scripture are',
    'forced through human review whatever automation is switched on.',
    '',
    'What DeenClipped does NOT do, so it is not inferred from the marketing:',
    'the full clip editor is behind a "coming soon" gate and is not available;',
    'there is no mobile app; and no connected platform sends audience data',
    'back, so there are no view counts or watch-time figures anywhere in the',
    'product.',
    '',
    ...group('Tools', [KIND.TOOL]),
    ...group('For Islamic creators', [KIND.AUDIENCE, KIND.USE_CASE]),
    ...group('About the product', [KIND.HOME, KIND.TRUST, KIND.COMMERCE]),
    '## Notes',
    '',
    `- Full page list: ${root}/sitemap.xml`,
    `- Crawling rules: ${root}/robots.txt`,
    '- This file is a convention for AI assistants. It is not read by search',
    '  engines and is not a ranking signal.',
    '',
  ].join('\n');
}

export function robots({ base }) {
  return [
    'User-agent: *',
    // Every Disallow here is a PREFIX, which is easy to get wrong: plain
    // "/app" also matches /apple-touch-icon.png, and blocking a favicon from
    // every crawler is not what anyone meant. The app itself is /app exactly
    // or /app/..., so say that.
    'Disallow: /app$',
    'Disallow: /app/',
    'Disallow: /app?',
    'Disallow: /owner',
    'Disallow: /api/',
    'Disallow: /auth/',
        // /login and /reset are deliberately NOT disallowed. They answer with
    // `X-Robots-Tag: noindex, follow`, and a crawler must be allowed to FETCH
    // a page to see that header. Blocking them here would leave Google free to
    // list them as bare URLs with no description -- which is what robots.txt
    // actually does, and the opposite of what was wanted.
    // The signed-in billing screen, which 302s to login for everyone else.
    // The PUBLIC pricing page is /pricing and is deliberately crawlable.
    'Disallow: /plans',
    '',
    // The AI-search crawlers are named rather than left to the wildcard, and
    // they are given the SAME rules as everyone else. That is deliberate: this
    // site shows a crawler exactly what it shows a person, and naming them
    // makes that a stated position rather than an accident of `*`. Serving
    // bots different claims than humans is cloaking, and it is the one thing
    // that would put the whole domain at risk.
    'User-agent: OAI-SearchBot',
    'User-agent: ChatGPT-User',
    'User-agent: PerplexityBot',
    'User-agent: Google-Extended',
    'User-agent: Applebot-Extended',
    'Disallow: /app$',
    'Disallow: /app/',
    'Disallow: /app?',
    'Disallow: /owner',
    'Disallow: /api/',
    'Disallow: /auth/',
        'Disallow: /plans',
    '',
    `Sitemap: ${String(base || '').replace(/\/+$/, '')}/sitemap.xml`,
    '',
  ].join('\n');
}

/**
 * Kept as a named export because tests and older callers use it, but it is
 * DERIVED now: the registry is the source of truth, so a new page cannot be
 * added to the site and forgotten by the sitemap.
 */
export const PUBLIC_PAGES = indexablePages().map(page => page.path);

export function sitemap({ base }) {
  const root = String(base || '').replace(/\/+$/, '');
  // No changefreq and no priority: Google ignores both and has said so for
  // years. lastmod is the one field it reads, and only while it is honest --
  // it is written by hand in the registry when a page's content actually
  // changes, never stamped with the deploy date.
  const urls = indexablePages().map(page => {
    const loc = `${root}${page.path === '/' ? '/' : page.path}`;
    const lastmod = page.lastmod ? `<lastmod>${page.lastmod}</lastmod>` : '';
    return `  <url><loc>${loc}</loc>${lastmod}</url>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
