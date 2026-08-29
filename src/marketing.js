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
  };
  return icons[name] || icons.check;
}

function navActions(currentUser) {
  if (currentUser) return `<div class="nav-actions"><a class="button primary compact" href="/app">My dashboard ${icon('arrow')}</a></div>`;
  return `<div class="nav-actions"><a class="button text-button" href="/login?returnTo=/app">Sign in</a><a class="button primary compact" href="/login?returnTo=/app">Get started ${icon('arrow')}</a></div>`;
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
  <link rel="stylesheet" href="/marketing.css">
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
        <a href="/pricing#token-shop">Token shop</a>
        <a href="/#faq">FAQ</a>
        <a href="/contact">Contact</a>
      </nav>
      ${navActions(currentUser)}
    </div>
  </header>
  ${body}
  <footer class="site-footer">
    <div class="wrap">
      <div class="footer-grid">
        <div class="footer-brand"><a class="brand" href="/">${logoMark()}<span class="brand-copy"><strong>DeenClipped</strong><small>AI clip workspace</small></span></a><p>Turn long lectures and videos into review-ready short clips, refine every detail, then publish to your own connected channels.</p></div>
        <div class="footer-col"><h4>Product</h4><a href="/features">Features</a><a href="/pricing">Pricing</a><a href="/app">Dashboard</a></div>
        <div class="footer-col"><h4>Company</h4><a href="/contact">Contact</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a></div>
        <div class="footer-col"><h4>Start</h4><a href="/login?returnTo=/app">Sign in</a><a href="/login?returnTo=/app">Create free clips</a><a href="mailto:support@deenclipped.online">Support</a></div>
      </div>
      <div class="footer-bottom"><span>© ${new Date().getFullYear()} DeenClipped</span><span>Import · Review · Edit · Publish</span></div>
    </div>
  </footer>
  <script src="/marketing.js" defer></script>
</body>
</html>`;
}

function sourceForm() {
  return `<form class="source-bar" data-source-form><span class="source-icon">${icon('link')}</span><label class="sr-only" for="source-url">Video URL</label><input id="source-url" name="source" placeholder="Paste a YouTube or video link" autocomplete="off"><button type="submit">Get clips ${icon('arrow')}</button></form>`;
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

function reelCard([src, alt], className = '') {
  return `<figure class="reel-card ${className}"><img src="/marketing-assets/${src}" alt="${alt}" loading="lazy"><span class="reel-badge">9:16</span></figure>`;
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
    <div class="price">${escapeHtml(Number(config.tokensFree).toLocaleString())} <small>tokens for ${escapeHtml(String(config.stripeTrialDays))} days</small></div>
    <p>${escapeHtml(billing.TIERS.basic.tagline)}</p>
    <ul>${billing.FREE_INCLUDES.slice(0, 4).map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ul>
    <a class="button secondary full" href="${accountUrl}">Start free</a>
  </article>`;

  return `<input type="radio" name="mkperiod" id="mk-weekly" class="mkperiod">`
    + `<input type="radio" name="mkperiod" id="mk-monthly" class="mkperiod" checked>`
    + `<input type="radio" name="mkperiod" id="mk-yearly" class="mkperiod">`
    + `<div class="period-switch"><label for="mk-weekly">Weekly</label><label for="mk-monthly">Monthly</label><label for="mk-yearly">Yearly</label></div>`
    + `<p class="period-note">Two months free on every yearly plan</p>`
    + `<div class="pricing-grid">${basic}${paidCard('pro')}${paidCard('studio')}</div>`;
}

function tokenShop(currentUser = null) {
  const accountUrl = currentUser ? '/plans#token-shop' : '/login?returnTo=/plans';
  const packs = [
    { name: 'Quick boost', tokens: 100, price: config.topupPrice100Label, enabled: Boolean(config.stripePriceTopup100) },
    { name: 'Creator boost', tokens: 300, price: config.topupPrice300Label, enabled: Boolean(config.stripePriceTopup300), popular: true },
    { name: 'Studio boost', tokens: 750, price: config.topupPrice750Label, enabled: Boolean(config.stripePriceTopup750) },
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
    a: 'DeenClipped turns long lectures and videos into short-form clips, lets you review and edit every result, then helps publish or schedule approved clips.' },
  { q: 'Can I paste a YouTube link?',
    a: 'Yes. You can begin with a supported video link or upload a video directly. DeenClipped then reads the source and lets you choose the processing range.' },
  { q: 'Does publishing go to my own channel?',
    a: "Yes. Each DeenClipped user connects their own supported social accounts, and publishing uses that user's saved connection." },
  { q: 'Can I review clips before posting?',
    a: 'Yes. The workflow is review-first. You can approve, edit, regenerate, shorten, lengthen or remove clips before they are posted.' },
  { q: 'How are tokens calculated?',
    a: 'One token represents one selected source-video minute. You see the estimated usage before confirming a generation.' },
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
      <span class="eyebrow"><i></i>Built for lecture-to-short workflows</span>
      <h1>Turn long lectures into <span>powerful short clips.</span></h1>
      <p class="hero-copy">DeenClipped finds strong moments, creates vertical clips, adds captions, gives you a real editor, and helps publish to your connected platforms.</p>
      <p class="purpose-line"><strong>DeenClipped</strong> is a web application that helps users create, edit, and publish short-form clips from long videos.</p>
      ${sourceForm()}
      <div class="hero-actions"><a class="button secondary" href="/features">Explore the workflow</a><a class="button text-link" href="/pricing">View pricing ${icon('arrow')}</a></div>

      <div class="hero-product reveal">
        <div class="hero-glow"></div>
        <div class="product-frame hero-main"><img src="/marketing-assets/hero-premium.webp" alt="DeenClipped premium dashboard with floating finished clips" fetchpriority="high"></div>
        ${reelCard(reels[0], 'hero-reel hero-reel-a float-one')}
        ${reelCard(reels[1], 'hero-reel hero-reel-b float-two')}
        ${reelCard(reels[2], 'hero-reel hero-reel-c float-three')}
        ${reelCard(reels[3], 'hero-reel hero-reel-d float-four')}
        <div class="status-float status-left"><span>${icon('spark')}</span><div><b>Strong moments found</b><small>Review the best clips first</small></div></div>
        <div class="status-float status-right"><span>${icon('calendar')}</span><div><b>Schedule ready</b><small>Post to your channels</small></div></div>
      </div>
      <div class="capability-rail reveal"><span>${icon('link')} Import a source</span><i>${icon('arrow')}</i><span>${icon('clips')} Find strong moments</span><i>${icon('arrow')}</i><span>${icon('edit')} Refine every clip</span><i>${icon('arrow')}</i><span>${icon('publish')} Publish or schedule</span></div>
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
        <div class="section-head align-left reveal"><span class="section-label">One connected workflow</span><h2>Everything between the long video and the final post.</h2><p>Import once, let AI identify the strongest moments, refine the clips, then publish or schedule from the same workspace.</p></div>
        <div class="workflow-visual reveal"><div class="product-frame"><img src="/marketing-assets/workflow-premium.webp" alt="DeenClipped workflow from source import to publish-ready clips" loading="lazy"></div></div>
        <div class="workflow-steps reveal">
          <article><span>01</span><h3>Import the right source</h3><p>Paste a supported link or upload a file, then select the exact source range you want processed.</p></article>
          <article><span>02</span><h3>Review strong moments</h3><p>See visual clip results, captions and scores before you spend time editing.</p></article>
          <article><span>03</span><h3>Refine and publish</h3><p>Adjust framing, captions and timing, then download, post now or add the clip to your schedule.</p></article>
        </div>
      </div>
    </section>

    <section class="section clips-section">
      <div class="wrap split-layout">
        <div class="media-stack reveal">
          <div class="product-frame media-main"><img src="/marketing-assets/clip-discovery-premium.webp" alt="Clean DeenClipped clip results with real vertical thumbnails" loading="lazy"></div>
          ${reelCard(reels[4], 'stack-card stack-one float-one')}
          ${reelCard(reels[5], 'stack-card stack-two float-two')}
          ${reelCard(reels[6], 'stack-card stack-three float-three')}
          ${reelCard(reels[7], 'stack-card stack-four float-four')}
        </div>
        <div class="feature-copy reveal"><span class="section-label">AI clip discovery</span><h2>See the actual clips, not a wall of settings.</h2><p>Generated moments appear as real visual results with thumbnails, captions, titles, scores and posting status. You can understand what the AI created before opening the editor.</p><div class="detail-list">${checkItem('Visual clip review','Compare several generated moments at a glance.')}${checkItem('Hook and title guidance','Start with the strongest openings and clearer titles.')}${checkItem('Refine without starting over','Shorten, lengthen, retitle, regenerate or open the editor.')}</div><a class="button primary" href="/login?returnTo=/app">Create your first clips ${icon('arrow')}</a></div>
      </div>
    </section>

    <section class="section editor-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Real editing control</span><h2>AI starts the edit. You decide how it finishes.</h2><p>Move beyond one-click output with practical controls for captions, framing, templates, audio and timing.</p></div>
        <div class="editor-showcase reveal">
          <div class="product-frame editor-main"><img src="/marketing-assets/editor-premium.webp" alt="DeenClipped editor with timeline, framing and caption controls" loading="lazy"></div>
          ${reelCard(reels[8], 'editor-reel editor-reel-left float-two')}
          ${reelCard(reels[9], 'editor-reel editor-reel-right float-four')}
          <div class="editor-label label-one">Drag captions</div><div class="editor-label label-two">Adjust framing</div><div class="editor-label label-three">Refine the timeline</div>
        </div>
        <div class="feature-row reveal"><div><span>${icon('captions')}</span><b>Caption positioning</b><p>Select, drag and place captions around the speaker and important visual content.</p></div><div><span>${icon('edit')}</span><b>Framing and canvas</b><p>Resize and reposition the video for a cleaner vertical composition.</p></div><div><span>${icon('template')}</span><b>Reusable templates</b><p>Keep typography, branding and layout consistent across every clip.</p></div></div>
      </div>
    </section>

    <section class="section organise-section">
      <div class="wrap split-layout reverse">
        <div class="feature-copy reveal"><span class="section-label">Projects and operations</span><h2>Keep every lecture, clip and next action organised.</h2><p>The project library keeps the original source and every generated clip together. Clear workflow status shows what is processing, what needs review and what is ready to publish.</p><div class="detail-list">${checkItem('Source-first project library','Find the original lecture quickly, then open its clips.')}${checkItem('Clear workflow status','See processing, review and publishing progress in one place.')}${checkItem('Built for separate accounts','Each user keeps their own projects and connected platforms.')}</div></div>
        <div class="library-visual reveal"><div class="product-frame"><img src="/marketing-assets/library-premium.webp" alt="Clean DeenClipped project library and workflow queue" loading="lazy"></div>${reelCard(reels[10], 'library-reel library-reel-one float-one')}${reelCard(reels[11], 'library-reel library-reel-two float-three')}</div>
      </div>
    </section>

    <section class="section publishing-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Publish with control</span><h2>Create once. Review carefully. Publish consistently.</h2><p>Approved clips can be downloaded, posted immediately, or placed into a publishing schedule for your own connected accounts.</p></div>
        <div class="publishing-canvas reveal"><div class="product-frame"><img src="/marketing-assets/publishing-premium.webp" alt="Clean DeenClipped publishing schedule and connected platform controls" loading="lazy"></div></div>
        <div class="publishing-points reveal"><div><span>${icon('check')}</span><b>Review before posting</b><small>Nothing leaves the workspace without your approval.</small></div><div><span>${icon('calendar')}</span><b>Post now or schedule</b><small>Choose the action that fits your publishing plan.</small></div><div><span>${icon('account')}</span><b>Your own accounts</b><small>Connections remain scoped to each DeenClipped user.</small></div></div>
      </div>
    </section>

    <section class="section gallery-section">
      <div class="wrap">
        <div class="section-head reveal"><span class="section-label">Inside the workspace</span><h2>A cleaner view of the whole product.</h2><p>Move through the dashboard, clip discovery, editor, library, publishing and complete workflow.</p></div>
        <div class="product-gallery reveal" data-gallery>
          <div class="gallery-track">
            <figure class="gallery-slide active"><img src="/marketing-assets/hero-premium.webp" alt="DeenClipped dashboard"><figcaption><b>Dashboard</b><span>See the entire workflow and the next action.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/clip-discovery-premium.webp" alt="DeenClipped generated clip results"><figcaption><b>Clip discovery</b><span>Review clean visual results instead of error-filled cards.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/editor-premium.webp" alt="DeenClipped editor"><figcaption><b>Editor</b><span>Refine captions, framing and timing.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/library-premium.webp" alt="DeenClipped project library"><figcaption><b>Library</b><span>Keep sources, clips and next actions organised.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/publishing-premium.webp" alt="DeenClipped publishing schedule"><figcaption><b>Publishing</b><span>Post now, download, or schedule the next clip.</span></figcaption></figure>
            <figure class="gallery-slide"><img src="/marketing-assets/workflow-premium.webp" alt="DeenClipped complete workflow"><figcaption><b>Complete workflow</b><span>From source import to publish-ready clips.</span></figcaption></figure>
          </div>
          <button class="gallery-button previous" type="button" data-gallery-prev aria-label="Previous screenshot">${icon('left')}</button><button class="gallery-button next" type="button" data-gallery-next aria-label="Next screenshot">${icon('right')}</button><div class="gallery-dots" data-gallery-dots></div>
        </div>
      </div>
    </section>

    <section class="section pricing-section">
      <div class="wrap"><div class="section-head reveal"><span class="section-label">Simple source-time pricing</span><h2>Use tokens on the video time you choose to process.</h2><p>One token represents one selected source-video minute. See the estimate before confirming.</p></div>${pricingCards()}</div>
    </section>

    <section class="section faq-section" id="faq"><div class="wrap"><div class="section-head reveal"><span class="section-label">Questions</span><h2>Know how the workflow works before you start.</h2></div>${faqBlock()}</div></section>

    <section class="section final-section"><div class="wrap final-cta reveal"><div><span class="section-label">Start creating</span><h2>Turn the next lecture into clips worth watching.</h2><p>Bring in a source, choose the range and build a review-ready set of short clips in one connected workspace.</p></div><a class="button primary" href="/login?returnTo=/app">Open DeenClipped ${icon('arrow')}</a></div></section>
  </main>`;
  return layout({ base, currentUser, title: 'DeenClipped — Turn Islamic lectures into ready-to-post clips', description: 'Turn Islamic lectures into ready-to-post clips with captions and nasheed — the worker transcribes, scores the moments and renders; you review before anything publishes.', canonicalPath: '/', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base), softwareSchema(base), faqSchema()] });
}

export function features({ base, currentUser }) {
  const body = `<main>
    <section class="page-hero wrap"><span class="eyebrow"><i></i>Product features</span><h1>A complete workflow for turning long videos into short-form content.</h1><p>Import, clip, review, edit, organise, schedule and publish without moving between disconnected tools.</p></section>
    <section class="page-content"><div class="wrap">
      <div class="feature-page-grid">
        <article>${icon('clips')}<h3>AI clip discovery</h3><p>Find complete, strong moments from lectures and long-form videos.</p></article>
        <article>${icon('captions')}<h3>Captions</h3><p>Create readable captions and position them around the speaker.</p></article>
        <article>${icon('edit')}<h3>Editor</h3><p>Adjust framing, video position, captions, audio and timing.</p></article>
        <article>${icon('template')}<h3>Templates</h3><p>Reuse consistent caption, branding and layout choices.</p></article>
        <article>${icon('calendar')}<h3>Scheduling</h3><p>Place approved clips into clear publishing windows.</p></article>
        <article>${icon('account')}<h3>Own account connections</h3><p>Each user connects and publishes to their own supported channels.</p></article>
      </div>
      <div class="feature-page-showcase">
        <div class="product-frame reveal"><img src="/marketing-assets/clip-discovery-premium.webp" alt="DeenClipped clip review"></div>
        <div class="product-frame reveal"><img src="/marketing-assets/editor-premium.webp" alt="DeenClipped editor"></div>
        <div class="product-frame reveal"><img src="/marketing-assets/publishing-premium.webp" alt="DeenClipped publishing schedule"></div>
      </div>
      <div class="final-cta reveal"><div><span class="section-label">See it together</span><h2>Open one workspace instead of five separate tools.</h2><p>Start from the source video and continue through generation, review, editing and publishing.</p></div><a class="button primary" href="/login?returnTo=/app">Open DeenClipped ${icon('arrow')}</a></div>
    </div></section>
  </main>`;
  return layout({ base, currentUser, title: 'Features — DeenClipped', description: 'Explore DeenClipped AI clipping, captions, templates, review, editing, scheduling and social publishing features.', canonicalPath: '/features', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function pricing({ base, currentUser }) {
  const body = `<main><section class="page-hero pricing-hero wrap"><span class="eyebrow"><i></i>Affordable creator pricing</span><h1>Choose a plan. Add tokens only when you need them.</h1><p>Pay for the selected source time you process. Subscription allowances refresh normally, while one-time top-up tokens remain in your wallet until used.</p><div class="pricing-trust"><span>Free starter access</span><span>Secure Stripe Checkout</span><span>No raw card storage</span></div></section><section class="page-content"><div class="wrap"><div class="pricing-section-head"><span class="section-label">Subscriptions</span><h2>Built for different publishing rhythms.</h2><p>Prices remain configuration-driven until the final Stripe products are confirmed.</p></div>${pricingCards(currentUser)}${tokenShop(currentUser)}<div class="pricing-explainer"><div><span class="section-label">How tokens work</span><h2>Clear before you render.</h2><p>DeenClipped reads the source duration, lets you select a start and end time, then estimates usage from that selected range. Subscription allowance is used before purchased top-ups.</p>${checkItem(`${config.tokensPerMinute} token per source minute`,'Usage follows the selected source window.')}${checkItem('Editing stays fair','Reviewing, template changes and ordinary template rerenders do not unnecessarily consume tokens.')}${checkItem('Top-ups persist','Purchased tokens do not disappear when a subscription renews or is cancelled.')}</div><div class="product-frame"><img src="/marketing-assets/workflow-premium.webp" alt="DeenClipped token and workflow overview"></div></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Pricing & Token Shop — DeenClipped', description: 'Compare DeenClipped free, weekly, monthly and yearly plans and optional one-time token packs.', canonicalPath: '/pricing', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base), softwareSchema(base)] });
}

export function contact({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Contact</span><h1>Talk to DeenClipped.</h1><p>Questions about your account, publishing connections, billing or the clipping workflow can be sent directly to support.</p></section><section class="page-content"><div class="wrap"><div class="contact-card"><span class="contact-icon">${logoMark()}</span><h2>Support</h2><p>Email <a href="mailto:support@deenclipped.online">support@deenclipped.online</a></p><p>Include the email attached to your account and a short description of what happened.</p><a class="button primary" href="mailto:support@deenclipped.online">Email support</a></div></div></section></main>`;
  return layout({ base, currentUser, title: 'Contact — DeenClipped', description: 'Contact DeenClipped support.', canonicalPath: '/contact', body,
    jsonLd: [organizationSchema(base), webSiteSchema(base)] });
}

export function privacy({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Privacy Policy</h1><p>How DeenClipped handles account, video, billing and connected-platform information.</p></section><section class="page-content"><article class="legal"><p>Last updated: 24 August 2026</p><p>DeenClipped helps users create, edit and publish short-form clips from long videos. This Privacy Policy explains what information is collected and how it is used.</p><h2>Information we collect</h2><p>When you sign in with Google, DeenClipped receives your Google account email address, profile name and profile picture from the <code>openid email profile</code> scopes, and uses them to create and identify your account. When you sign in with email, only your address and a hashed password are stored. We may also store project settings, uploaded source information, generated clips, captions, templates, schedules and publishing preferences.</p><h2>Google and YouTube user data</h2><p>If you choose to connect a YouTube channel, DeenClipped requests the minimum Google permissions needed to identify the channel and upload clips that you expressly approve or schedule. The permissions requested are <code>youtube.upload</code> and <code>youtube.readonly</code>. DeenClipped does not request YouTube watch history, Google passwords or browser cookies.</p><h3>YouTube API Data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through YouTube API Services:</p><ul><li><strong>Channel identifier, channel name and channel profile image</strong> — read once when you connect a channel (<code>channels.list</code>, part <code>snippet</code>), so the app can show you which channel is connected and address uploads to it.</li><li><strong>Granted permission list and encrypted OAuth access and refresh tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>Video title, duration and thumbnail image URL</strong> of a YouTube link you paste for clipping — read through the YouTube Data API (<code>videos.list</code>, parts <code>snippet</code> and <code>contentDetails</code>) so the app can show the video in your library and estimate its processing cost. That API response also contains the video's description and channel name; DeenClipped reads them in the response but does not store or display them.</li><li><strong>The video identifier of a clip DeenClipped uploaded on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display YouTube statistics of any kind. No view counts, like counts, comment counts, subscriber counts or analytics are retrieved: the only metadata request made is for a video's snippet and content details.</p><h3>How long YouTube API Data is kept</h3><p>Cached YouTube API Data — the video title, duration and thumbnail URL of an imported link, and the channel name and profile image of a connected channel — is automatically deleted after 30 days, in line with the YouTube API Services Developer Policies. A daily process removes anything older than that window; the data is read again from YouTube only when you next need it. Your channel identifier and the identifiers of clips DeenClipped uploaded are retained while your account and connection remain active, because they are the address publishing is sent to and the record of what was published.</p><p>When you disconnect a channel, the stored Google credential is removed immediately and DeenClipped asks Google to revoke the grant. You can also revoke DeenClipped's access at any time from your <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">Google account security settings</a>.</p><p>Google and YouTube data is used only to display and test your connected channel and to upload clips to that channel when you request publishing. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers. Service providers acting on our behalf may process data only as needed to host, secure and operate DeenClipped.</p><p>DeenClipped's use and transfer of information received from Google APIs adheres to the <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener">Google API Services User Data Policy</a>, including its Limited Use requirements.</p><p>By connecting a channel you are also using YouTube API Services. The <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a> apply to that use, and you can review or revoke DeenClipped's access to your Google account at any time at <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener">https://myaccount.google.com/permissions</a>.</p><h2>Meta (Facebook and Instagram) user data</h2><p>If you choose to connect Facebook or Instagram, DeenClipped requests these Meta permissions: <code>pages_show_list</code>, <code>pages_read_engagement</code>, <code>pages_manage_posts</code>, <code>instagram_basic</code> and <code>instagram_content_publish</code>. They are the minimum needed to list the Pages you manage, identify the Instagram professional account linked to a Page, and publish the clips you expressly approve or schedule.</p><h3>Meta data we access, store and use</h3><p>This is the complete list of information DeenClipped obtains through the Meta Graph API:</p><ul><li><strong>The Facebook Pages you manage</strong> — Page identifier, Page name and a Page access token, read once when you connect (<code>/me/accounts</code>), so the app can show you which Pages are available and address posts to them.</li><li><strong>The Instagram professional account linked to each Page</strong> — its identifier, username or name and profile picture URL, read in that same request, so the app can show which Instagram account a Page publishes to.</li><li><strong>Encrypted Page access tokens</strong> — stored so publishing works without asking you to sign in again.</li><li><strong>The media identifier of a post DeenClipped published on your behalf</strong> — kept as a record of what was published.</li></ul><p>DeenClipped does <strong>not</strong> request, store or display Facebook or Instagram insights or statistics of any kind — no follower counts, view counts, like counts or comment counts. It does not read your comments or direct messages, does not read posts you did not publish through DeenClipped, and does not read your Facebook profile beyond the list of Pages you manage.</p><p>Publishing sends the rendered clip and the caption you wrote to Meta. An Instagram Reel is created as a media container and then published (<code>/media</code>, then <code>/media_publish</code>); a Facebook Reel is uploaded to the Page you selected. Nothing is posted that you have not approved or scheduled.</p><p>Meta data is used only to display your connected Pages and Instagram accounts and to publish clips you request. It is not sold, used for advertising, used to train a general-purpose AI model or shared with data brokers.</p><p>When you disconnect Facebook or Instagram, the stored Page tokens are removed from DeenClipped immediately and publishing to those accounts stops. You can also remove DeenClipped’s access at any time from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>.</p><h2>TikTok user data</h2><p>If you choose to connect TikTok, DeenClipped requests the <code>user.info.basic</code> and <code>video.publish</code> scopes. It reads your TikTok display name, avatar and open identifier so the app can show which account is connected, and it reads your account’s current posting options (<code>creator_info</code>) — the privacy levels available to you, whether comments, Duet and Stitch are permitted, and the maximum video length — so the app offers only settings your account actually allows.</p><p>Encrypted TikTok access and refresh tokens are stored so publishing works without asking you to sign in again, together with the video identifier of anything DeenClipped published for you. DeenClipped does not request or store TikTok analytics, your follower list, comments or direct messages.</p><p>Every post carries the privacy level and the comment, Duet, Stitch and commercial-content settings you chose for that clip. DeenClipped never selects a privacy level on your behalf. Disconnecting TikTok removes the stored credential immediately, and you can revoke access at any time from your TikTok account settings.</p><h2>Security and storage</h2><p>Connected-platform tokens are encrypted at rest and separated by DeenClipped account. Access is limited to the service operations needed to provide the user-facing connection and publishing features. No internet service can guarantee absolute security, but DeenClipped uses reasonable technical and organisational safeguards appropriate to the data handled.</p><h2>Control, revocation and deletion</h2><p>You can disconnect any connected platform — YouTube, Facebook, Instagram or TikTok — from the Platforms page at any time. Disconnecting immediately removes that platform’s stored credential from your DeenClipped connection and disables future uploads to it; for YouTube, DeenClipped also asks Google to revoke the grant. You can additionally revoke access from <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">Google Account connections</a>, from your <a href="https://www.facebook.com/settings?tab=business_tools" target="_blank" rel="noopener">Facebook business integrations settings</a>, or from your TikTok account settings.</p><p>To request deletion of your account data, email <a href="mailto:support@deenclipped.online?subject=DeenClipped%20data%20deletion%20request">support@deenclipped.online</a> from the address attached to your account. Verified deletion requests, including associated Google, Meta and TikTok user data, are completed within 30 days unless retention is required by law. Published posts on third-party platforms are not deleted merely by disconnecting; they remain under your control on those platforms.</p><h2>Billing</h2><p>Payments are processed by Stripe. DeenClipped may store subscription status, plan, token balance and Stripe customer references, but does not directly store complete payment-card details.</p><h2>Source content and retention</h2><p>You are responsible for ensuring you have permission to process and publish source content. Project files and generated clips may be retained while your account is active so the service can provide editing, rerendering and publishing. You may delete individual projects in the app or request account-data deletion as described above.</p><h2>Contact</h2><p>Privacy and data-control questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
  const disclosedBody = body.replace('<h2>Security and storage</h2>', '<h2>YouTube URL processing</h2><p>When you submit a YouTube URL for clipping on deenclipped.online, DeenClipped sends that URL to <strong>SocialKit</strong> (<code>api.socialkit.dev</code>), a hosted video-download provider, together with DeenClipped\'s own API key and a requested video quality. SocialKit returns a temporary download link; DeenClipped\'s own processing server downloads the file from that link, and transcription, clipping and rendering all happen on that server.</p><p>If SocialKit cannot serve the video — for example when the download is refused — DeenClipped falls back to downloading the video directly from its own processing server instead. Those two are the only paths a submitted URL takes on this site.</p><p><strong>No Google credentials are sent to SocialKit or to any other import provider.</strong> Your Google account email, your OAuth access and refresh tokens, and your YouTube channel information are never included in an import request: the only thing transmitted is the public video URL, DeenClipped\'s own provider key and the requested quality. The Google connection is used solely to identify your channel and to upload clips you approve.</p><p>One other path exists but is not used by this website. A self-hosted copy of DeenClipped running without its own processing server may instead send a submitted YouTube URL to <strong>Vizard</strong>, a commercial clipping provider, which returns generated clip links. deenclipped.online runs with its own processing server, so the Vizard path is never reached here.</p><h2>Security and storage</h2>');
  return layout({ base, currentUser, title: 'Privacy Policy — DeenClipped', description: 'Privacy Policy for DeenClipped.', canonicalPath: '/privacy', body: disclosedBody });
}

export function terms({ base, currentUser }) {
  const body = `<main><section class="page-hero wrap"><span class="eyebrow"><i></i>Legal</span><h1>Terms of Service</h1><p>The rules for using DeenClipped to create, edit and publish short-form clips.</p></section><section class="page-content"><article class="legal"><p>Last updated: 24 August 2026</p><p>These Terms govern use of DeenClipped, a service for creating, editing and publishing short-form clips from long videos.</p><h2>Use of the service</h2><p>You must use DeenClipped lawfully and only with content you own or have permission to use. You are responsible for the videos, links, clips, captions and posts you create or publish through the service.</p><h2>Source content and copyright</h2><p>Uploading or importing videos you do not own or do not have permission to use may violate copyright or platform rules. By using DeenClipped, you confirm that you have the required rights and permissions.</p><h2>Google and YouTube services</h2><p>DeenClipped uses YouTube API Services for connected-channel and publishing features. By using those features, you also agree to the <a href="https://www.youtube.com/t/terms" target="_blank" rel="noopener">YouTube Terms of Service</a> and acknowledge the <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google Privacy Policy</a>. DeenClipped publishes only through the permissions you grant and the actions you approve or schedule. You can remove DeenClipped's access from the Platforms page or from your Google Account connections.</p><h2>Connected platforms</h2><p>DeenClipped can publish to Facebook Pages, Instagram professional accounts and TikTok once you connect them. Publishing happens only through the permissions you grant and the posts you approve or schedule, and each post carries the privacy and interaction settings you chose for it. Using those features also means agreeing to the <a href="https://www.facebook.com/terms.php" target="_blank" rel="noopener">Meta Terms of Service</a>, the <a href="https://help.instagram.com/581066165581870" target="_blank" rel="noopener">Instagram Terms of Use</a> and the <a href="https://www.tiktok.com/legal/page/row/terms-of-service/en" target="_blank" rel="noopener">TikTok Terms of Service</a>, and to each platform’s own content rules. You remain responsible for what you publish. You can disconnect any platform from the Platforms page at any time.</p><h2>Billing and tokens</h2><p>Some features require tokens, subscriptions or paid plans. Token usage may be based on selected source-video time and the plan rules displayed in the app. Checkout displays final billing terms before purchase.</p><h2>Service availability</h2><p>Features may change, pause or be removed over time. DeenClipped does not guarantee uninterrupted access or that every external video URL can be imported. YouTube source-file import is not represented as an official YouTube API capability and remains unavailable where YouTube does not permit access.</p><h2>Contact</h2><p>Questions can be sent to <a href="mailto:support@deenclipped.online">support@deenclipped.online</a>.</p></article></section></main>`;
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
