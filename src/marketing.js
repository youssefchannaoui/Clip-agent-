import { config } from './config.js';
import * as billing from './billing.js';

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

function layout({ base, currentUser, title, description, canonicalPath = '/', body, jsonLd = [] }) {
  const canonical = `${String(base || 'https://deenclipped.online').replace(/\/+$/, '')}${canonicalPath === '/' ? '' : canonicalPath}`;
  const safeTitle = escapeHtml(title);
  const safeDescription = escapeHtml(description);
  // "</script>" inside a JSON string would end the block early; \u003c cannot.
  const schemaBlocks = jsonLd.map(schema =>
    `<script type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script>`).join('\n  ');
  return `<!doctype html>
<html lang="en">
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
  <link rel="canonical" href="${canonical}">
  ${schemaBlocks}
  <link rel="stylesheet" href="/marketing.css?v=20260830">
</head>
<body>
  <header class="site-header">
    <div class="wrap nav">
      <a class="brand" href="/" aria-label="DeenClipped home">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a>
      <button class="menu-button" type="button" data-menu aria-label="Open navigation"><span></span><span></span><span></span></button>
      <nav class="nav-links" aria-label="Main navigation">
        <a href="/#how-it-works">How it works</a>
        <a href="/features">Features</a>
        <a href="/pricing">Pricing</a>
        <a href="/#safety">Review & safety</a>
        <a href="/#faq">FAQ</a>
      </nav>
      ${navActions(currentUser)}
    </div>
  </header>
  ${body}
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand" href="/">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><p>Turn long lectures and videos into review-ready short clips, refine every detail, then publish to your own connected channels.</p></div>
        <div class="footer-col"><h4>Product</h4><a href="/features">All features</a><a href="/pricing">Plans & tokens</a><a href="/#safety">Review & safety</a><a href="/app">Dashboard</a></div>
        <div class="footer-col"><h4>Company</h4><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
        <div class="footer-col"><h4>Start</h4><a href="/login?returnTo=/app">Start free</a><a href="/login?returnTo=/app">Sign in</a><a href="/pricing#token-shop">Token shop</a><a href="mailto:support@deenclipped.online">Support</a></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} DeenClipped</span><span>Import · Review · Edit · Publish</span></div>
    </div>
  </footer>
  <script src="/marketing.js" defer></script>
</body>
</html>`;
}

function sourceForm() {
  return `<form class="source-bar" data-source-form><span class="source-icon">${icon('link')}</span><label class="sr-only" for="source-url">Video URL</label><input id="source-url" name="source" placeholder="Paste a YouTube link to begin" autocomplete="off"><button type="submit">Start with this video ${icon('arrow')}</button></form>`;
}

function checkItem(title, text) {
  return `<div class="detail-item"><span class="detail-check">${icon('check')}</span><span><b>${title}</b><small>${text}</small></span></div>`;
}

const reels = [
  ['reel-winter.webp', 'A finished vertical clip with Arabic and English captions'],
  ['reel-dua.webp', 'A lecture clip with bold hook text'],
  ['reel-landscape.webp', 'A scenic vertical clip with bilingual captions'],
  ['reel-halal-way.webp', 'A sermon clip with bold caption styling'],
  ['reel-depart.webp', 'A podcast-style vertical lecture clip'],
  ['reel-beneficial.webp', 'A black-and-white prayer clip'],
  ['reel-quran.webp', 'A vertical lecture clip with Quranic subtitles'],
  ['reel-dunya.webp', 'A speaker clip with strong hook text'],
  ['reel-deeds.webp', 'A podcast clip with minimal typography'],
  ['reel-halal.webp', 'A clean sermon clip'],
  ['reel-kaaba-a.webp', 'A Kaaba clip with a centered caption'],
  ['reel-kaaba-b.webp', 'A second Kaaba clip with a clean vertical composition'],
];

/**
 * The shipped template catalogue paired with the existing photographic reel
 * that best demonstrates each look. These are not invented marketing styles:
 * every name and description comes from src/templates/*.json.
 */
const TEMPLATE_SHOWCASE = Object.freeze([
  { name: 'Clean Line', access: 'Basic', image: 'reel-halal.webp', alt: 'Clean sermon clip using a restrained single-line caption style', description: 'One centred line low in the frame, designed to stay out of the lecture.' },
  { name: 'Bold Stack', access: 'Pro', image: 'reel-dua.webp', alt: 'Lecture clip using large stacked words around the speaker', description: 'Large stacked words build behind the speaker and clear as the thought moves.' },
  { name: 'Headline', access: 'Pro', image: 'reel-dunya.webp', alt: 'Speaker clip using a strong uppercase headline treatment', description: 'Cinematic uppercase lines with the next phrase waiting quietly behind.' },
  { name: 'Mono Minimal', access: 'Pro', image: 'reel-beneficial.webp', alt: 'Black and white Islamic reminder clip with minimal captions', description: 'A grainy monochrome grade with one quiet word at a time.' },
  { name: 'Quran Recitation', access: 'Pro', image: 'reel-quran.webp', alt: 'Quran recitation clip with Arabic ayah and English translation', description: 'Matched ayah text in a mushaf face with its translation beneath it.' },
]);

function reelCard([src, alt], className = '') {
  return `<figure class="reel-card ${className}"><img src="/marketing-assets/${src}" alt="${alt}" loading="lazy"><span class="reel-badge">9:16</span></figure>`;
}

function templateCatalogue() {
  return `<div class="template-catalogue reveal" aria-label="DeenClipped template catalogue">
    ${TEMPLATE_SHOWCASE.map((template, index) => `<article class="template-card ${index === 0 ? 'is-basic' : ''}">
      <div class="template-image"><img src="/marketing-assets/${template.image}" alt="${escapeHtml(template.alt)}" loading="lazy"><span>${escapeHtml(template.access)}</span></div>
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
    <section class="hero wrap">
      <span class="eyebrow"><i></i>Review-first clipping for Islamic creators</span>
      <h1>Turn long lectures into <span>review-ready short clips.</span></h1>
      <p class="hero-copy">Find the strongest moments, render vertical clips with English, Arabic or ayah-and-translation captions, then review and publish from one focused workspace.</p>
      <p class="purpose-line"><strong>Start with ${escapeHtml(Number(config.tokensFree).toLocaleString())} source minutes for ${escapeHtml(String(config.stripeTrialDays))} days.</strong> No card details are stored by DeenClipped.</p>
      ${sourceForm()}
      <div class="hero-actions"><a class="button primary" href="/login?returnTo=/app">Start Basic free ${icon('arrow')}</a><a class="button secondary" href="#how-it-works">See how it works</a><a class="button text-link" href="/pricing">Compare plans</a></div>
      <div class="trust-strip" aria-label="DeenClipped product assurances"><span>${icon('shield')} Human review before publishing</span><span>${icon('language')} Multilingual and Quran-aware captions</span><span>${icon('brain')} Private DeenAI on our own server</span></div>

      <div class="hero-product reveal">
        <div class="hero-glow"></div>
        <div class="product-frame hero-main"><img src="/marketing-assets/hero-premium.webp" alt="Concept illustration of the DeenClipped lecture-to-clip workspace" fetchpriority="high"></div>
        ${reelCard(reels[0], 'hero-reel hero-reel-a float-one')}
        ${reelCard(reels[1], 'hero-reel hero-reel-b float-two')}
        ${reelCard(reels[2], 'hero-reel hero-reel-c float-three')}
        ${reelCard(reels[3], 'hero-reel hero-reel-d float-four')}
        <div class="status-float status-left"><span>${icon('spark')}</span><div><b>Strong moments found</b><small>Review the best clips first</small></div></div>
        <div class="status-float status-right"><span>${icon('calendar')}</span><div><b>Schedule ready</b><small>Post to your channels</small></div></div>
      </div>
      <div class="capability-rail reveal"><span>${icon('link')} Choose a source range</span><i>${icon('arrow')}</i><span>${icon('clips')} Find strong moments</span><i>${icon('arrow')}</i><span>${icon('shield')} Review the real render</span><i>${icon('arrow')}</i><span>${icon('publish')} Publish or schedule</span></div>
    </section>

    <section class="reel-showcase" aria-label="Examples of vertical clips created with DeenClipped">
      <div class="reel-marquee">
        <div class="reel-marquee-track">
          ${reels.map((reel, index) => reelCard(reel, `marquee-reel float-${(index % 4) + 1}`)).join('')}
          ${reels.map((reel, index) => reelCard(reel, `marquee-reel float-${(index % 4) + 1}`)).join('')}
        </div>
      </div>
    </section>

    <section class="section workflow-section" id="how-it-works">
      <div class="wrap">
        <div class="section-head align-left reveal"><span class="section-label">One connected workflow</span><h2>From the right section of a lecture to the final post.</h2><p>Select only the source range you want to process. DeenClipped transcribes it, finds complete moments, renders full-quality clips and keeps every decision in one place.</p></div>
        <div class="workflow-visual reveal"><div class="product-frame"><img src="/marketing-assets/workflow-premium.webp" alt="DeenClipped workflow from source import to publish-ready clips" loading="lazy"></div></div>
        <div class="workflow-steps reveal">
          <article><span>01</span><h3>Choose the minutes that matter</h3><p>Paste a supported link or upload a file, then set the exact start and end. Tokens follow the selected source time.</p></article>
          <article><span>02</span><h3>Review finished clips</h3><p>Watch the same full-quality render that will be posted, with scores, reasons, captions and keyboard decisions.</p></article>
          <article><span>03</span><h3>Publish with control</h3><p>Download, post now or fill the schedule for your own connected destinations. A failed destination can be retried on its own.</p></article>
        </div>
      </div>
    </section>

    <section class="section clips-section" id="safety">
      <div class="wrap split-layout">
        <div class="media-stack reveal">
          <div class="product-frame media-main"><img src="/marketing-assets/clip-discovery-premium.webp" alt="DeenClipped review queue surrounded by realistic Islamic lecture clips" loading="lazy"></div>
          ${reelCard(reels[4], 'stack-card stack-one float-one')}
          ${reelCard(reels[5], 'stack-card stack-two float-two')}
          ${reelCard(reels[6], 'stack-card stack-three float-three')}
          ${reelCard(reels[7], 'stack-card stack-four float-four')}
        </div>
        <div class="feature-copy reveal"><span class="section-label">Review and faith-sensitive safeguards</span><h2>The AI can find the moment. A person still decides what leaves.</h2><p>Every generated clip lands in a review queue. Scripture is treated more carefully: recitation is matched to an ayah-and-translation treatment and forced through a human review gate.</p><div class="detail-list">${checkItem('Rendered-video review','Watch the exact captioned file that will be posted, not a browser imitation.')}${checkItem('English, Arabic and recitation','Auto-detect can switch language by segment instead of forcing one language across the lecture.')}${checkItem('Nothing approximate for scripture','Quran clips never use the editor’s approximate caption echo and never bypass approval.')}</div><a class="button primary" href="/features#captions">See caption and review features ${icon('arrow')}</a></div>
      </div>
    </section>

    <section class="section organise-section deenai-section">
      <div class="wrap split-layout reverse">
        <div class="feature-copy reveal"><span class="section-label">DeenAI</span><h2>Advice grounded in your clips, not generic creator tips.</h2><p>Pro turns your own approvals, projects and posting history into countable insights. Studio adds Ask DeenAI, answered on the private model running on the DeenClipped processing server.</p><div class="detail-list">${checkItem('Numbers stay checkable','Insight cards show the arithmetic behind every recommendation.')}${checkItem('No transcript sent to Ask','The model receives compact account figures and kept titles, never the transcript.')}${checkItem('Actions point back to the product','Answers name the Review queue, Schedule or Connections screen when that is the next move.')}</div><a class="button secondary" href="/pricing">Compare Pro and Studio ${icon('arrow')}</a></div>
        <div class="deenai-preview reveal" aria-label="DeenAI feature preview">
          <div class="deenai-preview-head"><span>${icon('brain')}</span><div><b>DeenAI</b><small>Insights from your own workflow</small></div><em>STUDIO</em></div>
          <div class="deenai-question"><small>Ask DeenAI</small><strong>What should I focus on before the next post?</strong></div>
          <div class="deenai-answer"><span>${icon('spark')}</span><p>Start with clips still awaiting review, then check the destination showing refusals before filling the next schedule window.</p></div>
          <div class="deenai-sources"><span>Approval patterns</span><span>Posting days</span><span>Destination state</span><span>Kept titles</span></div>
          <p class="deenai-note">Feature preview — advice uses account figures and kept titles, never a transcript.</p>
        </div>
      </div>
    </section>

    <section class="section templates-section" id="templates">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Five real template styles</span><h2>Choose the treatment that suits the reminder.</h2><p>Every preview uses the existing photographic Islamic reel library. Basic starts with Clean Line; Pro unlocks the complete catalogue.</p></div>
        ${templateCatalogue()}
        <div class="template-safety reveal"><span>${icon('shield')}</span><p><strong>Quran Recitation is deliberately different.</strong> It matches recitation to the Quran corpus, shows the ayah and translation, keeps nasheed off and always requires human review.</p></div>
      </div>
    </section>

    <section class="section editor-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Templates, audio and editor preview</span><h2>Keep the look consistent now. Fine-grained editing is coming next.</h2><p>Templates and re-renders are available today. The full clip editor can be opened as a preview, but remains behind a coming-soon gate until its visual checks are complete.</p></div>
        <div class="editor-showcase reveal">
          <div class="product-frame editor-main"><img src="/marketing-assets/editor-premium.webp" alt="Concept preview of the planned DeenClipped clip editor" loading="lazy"></div>
          <span class="availability-badge">Editor preview · coming soon</span>
        </div>
        <div class="feature-row reveal"><div><span>${icon('template')}</span><b>Reusable caption templates</b><p>Save style changes for future clips or keep a one-clip adjustment local to that render.</p></div><div><span>${icon('music')}</span><b>Nasheed controls</b><p>Upload and rotate vocal-only tracks. Quran recitation is deliberately left without a track underneath it.</p></div><div><span>${icon('edit')}</span><b>Editor held for verification</b><p>Timeline, caption and framing controls are not advertised as launched while the gate is active.</p></div></div>
      </div>
    </section>

    <section class="section publishing-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Library, performance and publishing</span><h2>Know what needs attention, then keep the schedule moving.</h2><p>The library groups clips by lecture, Performance reports only what DeenClipped can actually measure, and the calendar shows each destination’s real state.</p></div>
        <div class="publishing-canvas reveal"><div class="product-frame"><img src="/marketing-assets/publishing-premium.webp" alt="Clean DeenClipped publishing schedule and connected platform controls" loading="lazy"></div></div>
        <div class="publishing-points reveal"><div><span>${icon('chart')}</span><b>Honest performance</b><small>Made, kept, scheduled, posted and failed — no invented social view counts.</small></div><div><span>${icon('calendar')}</span><b>Post now or schedule</b><small>Approved clips can fill the next free posting windows automatically.</small></div><div><span>${icon('account')}</span><b>Destination-level status</b><small>A YouTube success and TikTok refusal stay separate, with the failed leg retried alone.</small></div></div>
      </div>
    </section>

    <section class="section pricing-section">
      <div class="wrap"><div class="section-head reveal"><span class="section-label">Basic, Pro and Studio</span><h2>Pay for source minutes. Keep the workflow.</h2><p>One token represents one selected source-video minute. Reviewing, ordinary re-renders and cutting more clips from the processed source do not spend that source time again.</p></div>${pricingCards()}</div>
    </section>

    <section class="section faq-section" id="faq"><div class="wrap"><div class="section-head reveal"><span class="section-label">Questions</span><h2>Know how the workflow works before you start.</h2></div>${faqBlock()}</div></section>

    <section class="section final-section"><div class="wrap final-cta reveal"><div><span class="section-label">Start with the next lecture</span><h2>${escapeHtml(Number(config.tokensFree).toLocaleString())} source minutes. ${escapeHtml(String(config.stripeTrialDays))} days. A real review queue.</h2><p>Choose a range, generate the clips and decide what is worth publishing before anything reaches your channels.</p></div><a class="button primary" href="/login?returnTo=/app">Start Basic free ${icon('arrow')}</a></div></section>
  </main>`;
  return layout({ base, currentUser, title: 'DeenClipped — Review-ready clips from Islamic lectures', description: 'Turn Islamic lectures into full-quality short clips with English, Arabic and Quran-aware captions, human review, scheduling and private AI insights.', canonicalPath: '/', body,
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

      <section class="feature-deep-dive reveal" id="source-and-review"><div class="feature-deep-copy"><span class="section-label">Import, generate and review</span><h2>Spend tokens on the source range, not every decision afterwards.</h2><p>DeenClipped reads the duration before charging, downloads the selected stretch where the source permits it, and renders every candidate at full quality from the first pass. Cutting more clips from that processed source, ordinary re-renders and review actions do not charge the source minutes again.</p><div class="detail-list">${checkItem('Strong moments with reasons','Candidate scores include the worker’s explanation, such as a complete ending or a clear question hook.')}${checkItem('The real rendered file','The review deck plays the exact media that can be published, rather than drawing a second caption imitation in the browser.')}${checkItem('Fast keyboard decisions','Approve with A, reject with X, skip with S or the arrow keys, and control playback without leaving the deck.')}</div></div><div class="media-stack compact"><div class="product-frame media-main"><img src="/marketing-assets/clip-discovery-premium.webp" alt="DeenClipped rendered clip review deck" loading="lazy"></div>${reelCard(reels[4], 'stack-card stack-one')}${reelCard(reels[7], 'stack-card stack-three')}</div></section>

      <section class="feature-deep-dive reverse reveal" id="captions"><div class="feature-deep-copy"><span class="section-label">Captions and faith-sensitive review</span><h2>English, Arabic and recitation are not treated as the same text.</h2><p>With auto-detect, language can switch by segment inside the same lecture. Spoken Arabic receives Arabic captions with an English line beneath it. Recitation follows a separate Quran template that matches the ayah itself rather than trusting a rough transcript.</p><div class="detail-list">${checkItem('Scripture always waits for a person','The QUOTE_RISK gate prevents Quran clips from passing through automatic publishing without human review.')}${checkItem('No approximate ayah in the editor','Scripture is excluded from draft caption echoes because an approximate verse is unacceptable.')}${checkItem('No nasheed beneath recitation','The Quran template deliberately leaves the music track off and removes distracting branding treatments.')}</div></div><div class="caption-photo-stack"><figure class="reel-card feature-reel-large"><img src="/marketing-assets/reel-quran.webp" alt="Quran recitation clip with Arabic ayah and English translation" loading="lazy"><span class="reel-badge">Quran Recitation</span></figure><figure class="reel-card feature-reel-small"><img src="/marketing-assets/reel-winter.webp" alt="Islamic reminder clip with bilingual captions" loading="lazy"><span class="reel-badge">Multilingual</span></figure></div></section>

      <section class="template-feature-section" id="templates"><div class="section-head reveal"><span class="section-label">Template catalogue</span><h2>Five distinct looks, shown with realistic Islamic content.</h2><p>Clean Line is included with Basic. Pro and Studio unlock the complete catalogue, including the Quran-specific treatment.</p></div>${templateCatalogue()}</section>

      <section class="feature-deep-dive reveal" id="editor"><div class="feature-deep-copy"><span class="section-label">Templates, audio and editor preview</span><h2>Style changes work today. The full editor stays clearly marked as coming soon.</h2><p>Templates can be adjusted and re-rendered now, including clip-local caption and visual changes. The complete timeline, framing and drag controls are visible behind a launch gate until their visual verification is finished.</p><div class="detail-list">${checkItem('Clip-local or reusable','Keep one clip’s adjustment local, or save the look back to the shared template for future waiting clips.')}${checkItem('Full-quality review remains available','The editor gate does not remove rendered review, templates, re-renders, downloads, scheduling or publishing.')}${checkItem('Vocal-only track control','Upload, select and rotate nasheed tracks while respecting the Quran template’s music-off rule.')}</div></div><div class="editor-feature-visual"><div class="product-frame"><img src="/marketing-assets/editor-premium.webp" alt="Concept preview of the DeenClipped editor coming soon" loading="lazy"></div><span class="availability-badge">Editor preview · coming soon</span></div></section>

      <section class="feature-deep-dive reverse reveal" id="operations"><div class="feature-deep-copy"><span class="section-label">Projects, operations and performance</span><h2>See the lecture, every clip and the next action without manufactured analytics.</h2><p>The library keeps each source and its clips together, while operational status shows what is queued, processing, waiting for review, scheduled, posted or blocked. Performance reports what DeenClipped can prove from its own records instead of pretending to know social view counts it never fetched.</p><div class="detail-list">${checkItem('Honest workflow metrics','Made, kept, scheduled, posted and failed are counted from real account records.')}${checkItem('Clear recovery state','A cancelled job gives the worker slot back, and a restart does not silently revive work the account cancelled.')}${checkItem('DeenAI by tier','Pro receives calculated insights; Studio adds Ask DeenAI on the private processing server and priority rendering.')}</div></div><div class="library-visual"><div class="product-frame"><img src="/marketing-assets/library-premium.webp" alt="DeenClipped project library and workflow state" loading="lazy"></div>${reelCard(reels[10], 'library-reel library-reel-one')}${reelCard(reels[11], 'library-reel library-reel-two')}</div></section>

      <section class="feature-deep-dive reveal" id="publishing"><div class="feature-deep-copy"><span class="section-label">Publishing and scheduling</span><h2>One clip can succeed on one platform and need attention on another.</h2><p>Approved clips can be downloaded, posted immediately or placed into publishing windows. Each destination keeps its own outcome, so a successful YouTube post is not filed as failed because TikTok refused—and retry targets only the failed leg.</p><div class="detail-list">${checkItem('Your connected accounts','YouTube, supported Meta destinations and TikTok connections stay scoped to the signed-in DeenClipped account.')}${checkItem('Platform rules stay visible','TikTok requires the creator to choose privacy; external app reviews can still limit how a platform accepts a post.')}${checkItem('Up to four or eight daily windows','Core scheduling provides four daily windows; Studio expands the same chosen part of the day to eight.')}</div></div><div class="product-frame"><img src="/marketing-assets/publishing-premium.webp" alt="DeenClipped schedule with connected publishing destinations" loading="lazy"></div></section>

      <div class="feature-page-showcase"><div class="product-frame reveal"><img src="/marketing-assets/workflow-premium.webp" alt="Complete DeenClipped workflow from selected source range to publish-ready clips" loading="lazy"></div></div>
      <div class="final-cta reveal"><div><span class="section-label">Start with the whole workflow</span><h2>Basic includes generation, review, automation and publishing.</h2><p>Upgrade when you need every template, no watermark, DeenAI insights, private Ask, priority rendering or more daily posting windows.</p></div><a class="button primary" href="/pricing">Compare the plans ${icon('arrow')}</a></div>
    </div></section>
  </main>`;
  return layout({ base, currentUser, title: 'Features — DeenClipped', description: 'Explore DeenClipped range-based import, AI clipping, rendered review, multilingual and Quran-aware captions, five templates, DeenAI, scheduling and destination-level publishing.', canonicalPath: '/features', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function pricing({ base, currentUser }) {
  const body = `<main><section class="page-hero pricing-hero wrap"><span class="eyebrow"><i></i>Three tiers · one clear token model</span><h1>Start with the whole workflow. Upgrade for scale.</h1><p>One token represents one selected source-video minute. Subscription allowances refresh normally, while one-time top-up tokens stay in your wallet until used.</p><div class="pricing-trust"><span>${escapeHtml(config.tokensFree)} starter tokens</span><span>${escapeHtml(config.stripeTrialDays)} days of Basic access</span><span>Secure Stripe Checkout</span><span>No raw card storage</span></div></section><section class="page-content"><div class="wrap"><div class="pricing-section-head"><span class="section-label">Basic, Pro and Studio</span><h2>Choose the capability level, then the billing period.</h2><p>Basic includes the real workflow. Pro adds every template, watermark removal and calculated DeenAI insights. Studio adds private Ask, priority rendering and more posting windows.</p></div>${pricingCards(currentUser)}<section class="comparison-section"><div class="pricing-section-head"><span class="section-label">Plan comparison</span><h2>See exactly what changes.</h2><p>Core creation, review, automation and supported publishing are not hidden behind a paid tier.</p></div>${planComparison()}</section>${tokenShop(currentUser)}<div class="pricing-explainer"><div><span class="section-label">How tokens work</span><h2>Clear before you render.</h2><p>DeenClipped reads the source duration, lets you select a start and end time, then estimates usage from that selected range. Subscription allowance is used before purchased top-ups.</p>${checkItem(`${config.tokensPerMinute} token per source minute`,'Usage follows the selected source window.')}${checkItem('More clips do not repeat the source charge','Cutting more candidates from an already processed source does not spend the source minutes again.')}${checkItem('Ordinary re-renders stay fair','Review, template changes and ordinary re-renders do not unnecessarily consume tokens.')}${checkItem('Top-ups persist','Purchased tokens do not disappear when a subscription renews or is cancelled.')}</div><div class="product-frame"><img src="/marketing-assets/workflow-premium.webp" alt="DeenClipped source-minute and workflow overview"></div></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Pricing & Token Shop — DeenClipped', description: 'Compare DeenClipped Basic, Pro and Studio across weekly, monthly and yearly billing, plus optional one-time token packs.', canonicalPath: '/pricing', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base), softwareSchema(base)] });
}

export function contact({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Direct product support</span><h1>Tell us what stopped the workflow.</h1><p>Questions about an import, rendered clip, connected destination, schedule or payment can be sent directly to DeenClipped support.</p></section><section class="page-content"><div class="wrap contact-layout"><div class="contact-card"><span class="contact-icon">${logoMark()}</span><h2>Support</h2><p>Email <a href="mailto:support@deenclipped.online">support@deenclipped.online</a></p><p>Include the email attached to your account, the project or clip name, the destination involved and the exact message you saw. Never email a password, OAuth token or payment-card number.</p><a class="button primary" href="mailto:support@deenclipped.online?subject=DeenClipped%20support%20request">Email support</a></div><div class="contact-context"><span class="section-label">Useful details</span><h2>Help us find the exact step.</h2>${checkItem('Import or processing','Include the source type, selected time range and the stage where it stopped.')}${checkItem('Captions or render','Name the template, language and whether the issue appears in the rendered review video.')}${checkItem('Publishing','Name every destination and which one posted, failed or is still waiting.')}${checkItem('Billing','Include the plan or token pack and the checkout time, but never raw card details.')}<div class="contact-reels">${reelCard(reels[5], 'contact-reel')}${reelCard(reels[6], 'contact-reel')}${reelCard(reels[10], 'contact-reel')}</div></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Contact — DeenClipped', description: 'Contact DeenClipped support.', canonicalPath: '/contact', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function privacy({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Privacy Policy</h1><p>How DeenClipped handles account, video, billing and connected-platform information.</p></section><section class="page-content"><article class="legal"><p>Last updated: 30 August 2026</p><p>DeenClipped helps users create, review and publish short-form clips from long videos. This Privacy Policy explains what information is collected and how it is used.</p><h2>Information we collect</h2><p>When you sign in with Google, DeenClipped receives your Google account email address, profile name and profile picture from the <code>openid email profile</code> scopes, and uses them to create and identify your account. When you sign in with email, only your address and a hashed password are stored. We may also store project settings, uploaded source information, generated clips, captions, templates, schedules and publishing preferences.</p><h2>Google and YouTube user data</h2><p>If you choose to connect a YouTube channel, DeenClipped requests the minimum Google permissions needed to identify the channel and upload clips that you expressly approve or schedule. The permissions requested are <code>youtube.upload</code> and <code>youtube.readonly</code>. DeenClipped does not request YouTube watch history, Google passwords or browser cookies.</p><h3>YouTube API Data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through YouTube API Services:</p><ul><li><strong>Channel identifier, channel name and channel profile image</strong> — read once when you connect a channel (<code>channels.list</code>, part <code>snippet</code>), so the app can show you which channel is connected and address uploads to it.</li><li><strong>Granted permission list and encrypted OAuth access and refresh tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>Video title, duration and thumbnail image URL</strong> of a YouTube link you paste for clipping — read through the YouTube Data API (<code>videos.list</code>, parts <code>snippet</code> and <code>contentDetails</code>) so the app can show the video in your library and estimate its processing cost. That API response also contains the video's description and channel name; DeenClipped reads them in the response but does not store or display them.</li><li><strong>The video identifier of a clip DeenClipped uploaded on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display YouTube statistics of any kind. No view counts, like counts, comment counts, subscriber counts or analytics are retrieved: the only metadata request made is for a video's snippet and content details.</p><h3>How long YouTube API Data is kept</h3><p>Cached YouTube API Data — the video title, duration and thumbnail URL of an imported link, and the channel name and profile image of a connected channel — is automatically deleted after 30 days, in line with the YouTube API Services Developer Policies. A daily process removes anything older than that window; the data is read again from YouTube only when you next need it. Your channel identifier and the identifiers of clips DeenClipped uploaded are retained while your account and connection remain active, because they are the address publishing is sent to and the record of what was published.</p><p>When you disconnect a channel, the stored Google credential is removed immediately and DeenClipped asks Google to revoke the grant. You can also revoke DeenClipped's access at any time from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google account security settings</a>.</p><p>Google and YouTube data is used only to display and test your connected channel and to upload clips to that channel when you request publishing. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers. Service providers acting on our behalf may process data only as needed to host, secure and operate DeenClipped.</p><p>DeenClipped's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>, including its Limited Use requirements.</p><p>By connecting a channel you are also using YouTube API Services. The <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a> apply to that use, and you can review or revoke DeenClipped's access to your Google account at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">https://myaccount.google.com/permissions</a>.</p><h2>Meta (Facebook and Instagram) user data</h2><p>If you choose to connect Facebook or Instagram, DeenClipped requests these Meta permissions: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code> and <code>instagram_content_publish</code>. They are the minimum needed to list the Pages you manage, identify the Instagram professional account linked to a Page, and publish the clips you expressly approve or schedule.</p><h3>Meta data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through the Meta Graph API:</p><ul><li><strong>The Facebook Pages you manage</strong> — Page identifier, Page name and a Page access token, read once when you connect (<code>/me/accounts</code>), so the app can show you which Pages are available and address posts to them.</li><li><strong>The Instagram professional account linked to each Page</strong> — its identifier, username or name and profile picture URL, read in that same request, so the app can show which Instagram account a Page publishes to.</li><li><strong>Encrypted Page access tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>The media identifier of a post DeenClipped published on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display Facebook or Instagram insights or statistics of any kind — no follower counts, view counts, like counts or comment counts. It does not read your comments or direct messages, does not read posts you did not publish through DeenClipped, and does not read your Facebook profile beyond the list of Pages you manage.</p><p>Publishing sends the rendered clip and the caption you wrote to Meta. An Instagram Reel is created as a media container and then published (<code>/media</code>, then <code>/media_publish</code>); a Facebook Reel is uploaded to the Page you selected. Nothing is posted that you have not approved or scheduled.</p><p>Meta data is used only to display your connected Pages and Instagram accounts and to publish clips you request. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers.</p><p>When you disconnect Facebook or Instagram, the stored Page tokens are removed from DeenClipped immediately and publishing to those accounts stops. You can also remove DeenClipped’s access at any time from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>.</p><h2>TikTok user data</h2><p>If you choose to connect TikTok, DeenClipped requests the <code>user.info.basic</code> and <code>video.publish</code> scopes. It reads your TikTok display name, avatar and open identifier so the app can show which account is connected, and it reads your account’s current posting options (<code>creator_info</code>) — the privacy levels available to you, whether comments, Duet and Stitch are permitted, and the maximum video length — so the app offers only settings your account actually allows.</p><p>Encrypted TikTok access and refresh tokens are stored so publishing works without asking you to sign in again, together with the video identifier of anything DeenClipped published for you. DeenClipped does not request or store TikTok analytics, your follower list, comments or direct messages.</p><p>Every post carries the privacy level and the comment, Duet, Stitch and commercial-content settings you chose for that clip. DeenClipped never selects a privacy level on your behalf. Disconnecting TikTok removes the stored credential immediately, and you can revoke access at any time from your TikTok account settings.</p><h2>Security and storage</h2><p>Connected-platform tokens are encrypted at rest and separated by DeenClipped account. Access is limited to the service operations needed to provide the user-facing connection and publishing features. No internet service can guarantee absolute security, but DeenClipped uses reasonable technical and organisational safeguards appropriate to the data handled.</p><h2>Control, revocation and deletion</h2><p>You can disconnect any connected platform — YouTube, Facebook, Instagram or TikTok — from the Platforms page at any time. Disconnecting immediately removes that platform’s stored credential from your DeenClipped connection and disables future uploads to it; for YouTube, DeenClipped also asks Google to revoke the grant. You can additionally revoke access from <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">Google Account connections</a>, from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>, or from your TikTok account settings.</p><p>To request deletion of your account data, email <a href="mailto:support@deenclipped.online?subject=DeenClipped%20data%20deletion%20request">support@deenclipped.online</a> from the address attached to your account. Verified deletion requests, including associated Google, Meta and TikTok user data, are completed within 30 days unless retention is required by law. Published posts on third-party platforms are not deleted merely by disconnecting; they remain under your control on those platforms.</p><h2>Billing</h2><p>Payments are processed by Stripe. DeenClipped may store subscription status, plan, token balance and Stripe customer references, but does not directly store complete payment-card details.</p><h2>Source content and retention</h2><p>You are responsible for ensuring you have permission to process and publish source content. Project files and generated clips may be retained while your account is active so the service can provide editing, rerendering and publishing. You may delete individual projects in the app or request account-data deletion as described above.</p><h2>Contact</h2><p>Privacy and data-control questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  const disclosedBody = body.replace('<h2>Security and storage</h2>', '<h2>YouTube URL processing</h2><p>When you submit a public YouTube URL for clipping on deenclipped.online, the URL and requested source range are sent to DeenClipped\'s own processing server. That server uses <code>yt-dlp</code> and may route the download through Webshare\'s residential proxy network to retrieve the public source. Where the source permits it, only the selected time range is downloaded. Transcription, clip selection and rendering happen on the DeenClipped processing server.</p><p><strong>No Google credentials are sent to the import downloader or proxy network.</strong> Your Google account email, OAuth access and refresh tokens, and connected-channel information are not included in the import request. The Google connection is used only for channel identity and uploads you approve or schedule.</p><h2>DeenAI processing</h2><p>DeenAI insights are calculated from records already held in your DeenClipped workspace, such as project, approval, schedule and destination outcomes. Studio\'s Ask DeenAI feature runs on the private model hosted on the DeenClipped processing server. Its request contains compact account figures and kept clip titles; it does not send lecture transcripts to the model. DeenAI output is not used to train a general-purpose model.</p><h2>Security and storage</h2>');
  return layout({ base, currentUser, title: 'Privacy Policy — DeenClipped', description: 'Privacy Policy for DeenClipped.', canonicalPath: '/privacy', body: disclosedBody });
}

export function terms({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Terms of Service</h1><p>The rules for using DeenClipped to create, review and publish short-form clips.</p></section><section class="page-content"><article class="legal"><p>Last updated: 30 August 2026</p><p>These Terms govern use of DeenClipped, a service for creating, reviewing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions.</p><h2>Google and YouTube services</h2><p>DeenClipped uses YouTube API Services for connected-channel and publishing features. By using those features, you also agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and acknowledge the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>. DeenClipped publishes only through the permissions you grant and the actions you approve or schedule. You can remove DeenClipped's access from the Platforms page or from your Google Account connections.</p><h2>Connected platforms</h2><p>DeenClipped can publish to Facebook Pages, Instagram professional accounts and TikTok once you connect them. Publishing happens only through the permissions you grant and the posts you approve or schedule, and each post carries the privacy and interaction settings you chose for it. Using those features also means agreeing to the <a href="https://www.facebook.com/terms.php" target="_blank" rel="noopener">Meta Terms of Service</a>, the <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener">Instagram Terms of Use</a> and the <a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener">TikTok Terms of Service</a>, and to each platform’s own content rules. You remain responsible for what you publish. You can disconnect any platform from the Platforms page at any time.</p><h2>Billing and tokens</h2><p>Some features require tokens, subscriptions or paid plans. Token usage is based on the selected source-video time and the plan rules displayed in the app. Checkout displays final billing terms before purchase.</p><h2>Service availability</h2><p>Features may change, pause or be removed over time. The complete editor is currently marked coming soon. DeenClipped does not guarantee uninterrupted access or that every external video URL can be imported. YouTube URL import is not an official YouTube Data API download capability and remains subject to source availability, provider access and platform restrictions.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  const disclosedBody = body
    .replace('<h2>Billing and tokens</h2>', '<h2>YouTube URL processing</h2><p>DeenClipped may use a commercial video-processing provider to retrieve and clip a public YouTube URL that you submit. This is separate from the official YouTube API connection used for channel identity and publishing. Imports depend on the source being accessible to the provider and may fail because of source restrictions, rights controls, availability, quotas or platform changes.</p><h2>Billing and tokens</h2>')
    .replace('YouTube source-file import is not represented as an official YouTube API capability and remains unavailable where YouTube does not permit access.', 'YouTube URL import is not an official YouTube Data API download capability and remains subject to source availability, provider access and platform restrictions.');
  return layout({ base, currentUser, title: 'Terms of Service — DeenClipped', description: 'Terms of Service for DeenClipped.', canonicalPath: '/terms', body: disclosedBody });
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
export function robots({ base }) {
  return [
    'User-agent: *',
    'Allow: /$',
    'Disallow: /app',
    'Disallow: /owner',
    'Disallow: /api/',
    'Disallow: /auth/',
    'Disallow: /login',
    'Disallow: /reset',
    'Disallow: /plans',
    '',
    `Sitemap: ${String(base || '').replace(/\/+$/, '')}/sitemap.xml`,
    '',
  ].join('\n');
}

export const PUBLIC_PAGES = ['/', '/features', '/pricing', '/contact', '/privacy', '/terms'];

export function sitemap({ base }) {
  const root = String(base || '').replace(/\/+$/, '');
  const urls = PUBLIC_PAGES.map(p => `  <url><loc>${root}${p === '/' ? '/' : p}</loc><changefreq>weekly</changefreq></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
