#!/usr/bin/env python3
"""
Public site: social previews, SEO, positioning, analytics.

Findings this addresses, in rough order of impact:

1. NO og:image ANYWHERE. Every link shared to WhatsApp, X, Discord or iMessage
   rendered as a bare grey box. For a product that spreads by creators sharing
   it, this was the single cheapest fix available. Also adds twitter:card,
   og:site_name and og:locale.

2. NO FAVICON, NO robots.txt, NO sitemap.xml. Blank tab icon and no crawl
   guidance for search engines.

3. THE NICHE WAS INVISIBLE. "Islamic" appeared once, in a meta tag. Against
   Opus Clip the moat is Arabic and bilingual captions, RTL text, sermons
   rather than podcasts, nasheed rather than music. None of it was on the page.
   Hero, eyebrow, titles and descriptions now say so.

4. TITLE WAS JUST "DeenClipped". No keywords, so no search surface.
   Description read like it was written for a compliance reviewer.

5. NO ANALYTICS. Every conversion change was unmeasurable. Now driven by
   ANALYTICS_SCRIPT_URL / ANALYTICS_SITE_ID so a privacy-friendly provider can
   be switched on without a deploy.

6. NO DEMO VIDEO. A video product with no video on it. DEMO_VIDEO_URL renders a
   real player section when set, and nothing at all when it isn't — so this
   ships dark until there's a clip worth showing.

7. FAQ answered "what does it do" but none of the real objections: refunds,
   cancellation, what happens to clips, Arabic support, AI training on content.

NOT CHANGED, deliberately:
- The repeated reel images are a CSS marquee track doubled for seamless
  looping (marketing.js:197-198), not padding. Trimming them breaks the
  animation.
- The "DeenClipped is a web application that..." purpose line stays. It reads
  oddly as marketing copy but it is plainly a platform-review statement, and
  removing it during an open Google compliance review is not worth the risk.
- No testimonials or user counts are added. Inventing social proof is fraud,
  and there is no real data to use yet.

Run from your repo root:

    python3 patch11/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "marketing.js").exists():
    sys.exit("Can't find src/marketing.js — run this from your repo root, not ~.")

for asset in ("og-cover.png", "favicon-32.png", "apple-touch-icon.png"):
    if not (ROOT / "src" / "public" / "marketing-assets" / asset).exists():
        sys.exit(f"Missing src/public/marketing-assets/{asset} — copy the generated assets in first.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:300]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ----------------------------------------------------------------- config.js

edit(
    "src/config.js",
    "  freeTierDays: Math.max(0, Math.round(number(process.env.FREE_TIER_DAYS, 3))),",
    "  freeTierDays: Math.max(0, Math.round(number(process.env.FREE_TIER_DAYS, 3))),\n"
    "  // Privacy-friendly analytics (Plausible, Umami, Fathom). Both must be set\n"
    "  // or nothing is injected — no silent half-configured tracking.\n"
    "  analyticsScriptUrl: process.env.ANALYTICS_SCRIPT_URL || '',\n"
    "  analyticsSiteId: process.env.ANALYTICS_SITE_ID || '',\n"
    "  // A real sample clip. The section does not render until this is set.\n"
    "  demoVideoUrl: process.env.DEMO_VIDEO_URL || '',\n"
    "  demoVideoPoster: process.env.DEMO_VIDEO_POSTER || '/marketing-assets/reel-winter.webp',\n"
    "  socialImagePath: process.env.SOCIAL_IMAGE_PATH || '/marketing-assets/og-cover.png',",
    "config: analytics, demo video, social image",
)


# -------------------------------------------------------------- head / meta

edit(
    "src/marketing.js",
    '  <meta property="og:title" content="${safeTitle}">\n'
    '  <meta property="og:description" content="${safeDescription}">\n'
    '  <meta property="og:type" content="website">\n'
    '  <meta property="og:url" content="${canonical}">\n'
    '  <link rel="canonical" href="${canonical}">\n'
    '  <link rel="stylesheet" href="/marketing.css">',
    '  <meta property="og:title" content="${safeTitle}">\n'
    '  <meta property="og:description" content="${safeDescription}">\n'
    '  <meta property="og:type" content="website">\n'
    '  <meta property="og:url" content="${canonical}">\n'
    '  <meta property="og:site_name" content="DeenClipped">\n'
    '  <meta property="og:locale" content="en_AU">\n'
    '  <meta property="og:image" content="${socialImage}">\n'
    '  <meta property="og:image:width" content="1200">\n'
    '  <meta property="og:image:height" content="630">\n'
    '  <meta property="og:image:alt" content="DeenClipped — turn long lectures into short clips with Arabic and English captions">\n'
    '  <meta name="twitter:card" content="summary_large_image">\n'
    '  <meta name="twitter:title" content="${safeTitle}">\n'
    '  <meta name="twitter:description" content="${safeDescription}">\n'
    '  <meta name="twitter:image" content="${socialImage}">\n'
    '  <link rel="icon" type="image/png" sizes="32x32" href="/marketing-assets/favicon-32.png">\n'
    '  <link rel="apple-touch-icon" href="/marketing-assets/apple-touch-icon.png">\n'
    '  <link rel="canonical" href="${canonical}">\n'
    '  <link rel="stylesheet" href="/marketing.css">\n'
    "  ${analyticsTag}",
    "head: og:image, twitter card, favicon, analytics slot",
)

edit(
    "src/marketing.js",
    "  const canonical = `${String(base || 'https://deenclipped.online').replace(/\\/+$/, '')}${canonicalPath === '/' ? '' : canonicalPath}`;\n"
    "  const safeTitle = escapeHtml(title);\n"
    "  const safeDescription = escapeHtml(description);",
    "  const origin = String(base || 'https://deenclipped.online').replace(/\\/+$/, '');\n"
    "  const canonical = `${origin}${canonicalPath === '/' ? '' : canonicalPath}`;\n"
    "  const safeTitle = escapeHtml(title);\n"
    "  const safeDescription = escapeHtml(description);\n"
    "  // Social scrapers do not resolve relative URLs — this has to be absolute.\n"
    "  const socialImage = escapeHtml(`${origin}${config.socialImagePath}`);\n"
    "  const analyticsTag = config.analyticsScriptUrl && config.analyticsSiteId\n"
    "    ? `<script defer data-website-id=\"${escapeHtml(config.analyticsSiteId)}\" data-domain=\"${escapeHtml(config.analyticsSiteId)}\" src=\"${escapeHtml(config.analyticsScriptUrl)}\"></script>`\n"
    "    : '';",
    "layout: absolute social image + analytics tag",
)


# ------------------------------------------------------------- titles / copy

edit(
    "src/marketing.js",
    "  return layout({ base, currentUser, title: 'DeenClipped', description: 'DeenClipped is a web application that helps users create, edit, and publish short-form clips from long videos.', canonicalPath: '/', body });",
    "  return layout({ base, currentUser, title: 'DeenClipped — Turn Islamic lectures into short clips with captions', description: 'Turn long lectures and khutbahs into vertical short clips with Arabic and English captions, then publish to your own TikTok, YouTube and Instagram. Free to start.', canonicalPath: '/', body });",
    "home: keyworded title + selling description",
)

edit(
    "src/marketing.js",
    "  return layout({ base, currentUser, title: 'Features — DeenClipped', description: 'Explore DeenClipped AI clipping, captions, templates, review, editing, scheduling and social publishing features.', canonicalPath: '/features', body });",
    "  return layout({ base, currentUser, title: 'Features — bilingual captions, vertical framing, scheduled publishing | DeenClipped', description: 'AI clip discovery, Arabic and English captions, reusable templates, a real editor, review-before-posting and scheduling to your own channels.', canonicalPath: '/features', body });",
    "features: better title + description",
)

edit(
    "src/marketing.js",
    "  return layout({ base, currentUser, title: 'Pricing & Token Shop — DeenClipped', description: 'Compare DeenClipped free, weekly, monthly and yearly plans and optional one-time token packs.', canonicalPath: '/pricing', body });",
    "  return layout({ base, currentUser, title: 'Pricing — from A$9.99/week, about half the cost of Opus Clip | DeenClipped', description: 'One token per source minute. Free tier to start, weekly, monthly and yearly plans, plus one-time token packs that never expire.', canonicalPath: '/pricing', body });",
    "pricing: better title + description",
)

edit(
    "src/marketing.js",
    '      <span class="eyebrow"><i></i>Built for lecture-to-short workflows</span>\n'
    "      <h1>Turn long lectures into <span>powerful short clips.</span></h1>\n"
    '      <p class="hero-copy">DeenClipped finds strong moments, creates vertical clips, adds captions, gives you a real editor, and helps publish to your connected platforms.</p>',
    '      <span class="eyebrow"><i></i>Built for khutbahs, halaqas and long-form lectures</span>\n'
    "      <h1>Turn long lectures into <span>short clips that get watched.</span></h1>\n"
    '      <p class="hero-copy">DeenClipped finds the strongest moments in a lecture, cuts them vertical, burns in Arabic and English captions, and publishes to your own channels. Built for sermons rather than podcasts, so the captioning and pacing actually fit the material.</p>',
    "hero: lead with the niche",
)


# ----------------------------------------------------------------------- FAQ

edit(
    "src/marketing.js",
    "    <details><summary>How are tokens calculated?</summary><p>One token represents one selected source-video minute. You see the estimated usage before confirming a generation.</p></details>\n"
    "  </div>`;",
    "    <details><summary>How are tokens calculated?</summary><p>One token represents one selected source-video minute. You see the estimated usage before confirming a generation.</p></details>\n"
    "    <details><summary>Does it handle Arabic captions?</summary><p>Yes. Clips can carry Arabic, English or both together, with right-to-left text handled correctly. This is the main reason DeenClipped exists rather than a general-purpose clipping tool.</p></details>\n"
    "    <details><summary>Is my content used to train AI models?</summary><p>No. Your uploads and generated clips are processed to produce your clips and nothing else. They are not used as training data.</p></details>\n"
    "    <details><summary>What happens to my clips if I cancel?</summary><p>Cancelling stops future billing. You keep access until the end of the period you have already paid for, and you can download anything you have made before then.</p></details>\n"
    "    <details><summary>Can I cancel any time?</summary><p>Yes, from the billing portal, without contacting support. There is no minimum term on any plan.</p></details>\n"
    "    <details><summary>Do unused tokens roll over?</summary><p>Subscription tokens refresh each period and do not accumulate. One-time top-up tokens are different: they stay in your wallet until you use them, including across renewals.</p></details>\n"
    "  </div>`;",
    "FAQ: answer the actual objections",
)


# ------------------------------------------------------------ demo + compare

edit(
    "src/marketing.js",
    "export function home({ base, currentUser }) {",
    "// A video product with no video on it is a hard sell. Renders only when\n"
    "// DEMO_VIDEO_URL is set, so it stays hidden until there is a clip worth showing.\n"
    "function demoBlock() {\n"
    "  if (!config.demoVideoUrl) return '';\n"
    "  return `<section class=\"section wrap demo-section reveal\">\n"
    "    <div class=\"section-head\"><span class=\"section-label\">See the output</span><h2>A real clip, start to finish.</h2><p>No mockups. This is what comes out of a single lecture import.</p></div>\n"
    "    <div class=\"demo-frame\"><video controls playsinline preload=\"none\" poster=\"${escapeHtml(config.demoVideoPoster)}\" src=\"${escapeHtml(config.demoVideoUrl)}\"></video></div>\n"
    "  </section>`;\n"
    "}\n"
    "\n"
    "export function home({ base, currentUser }) {",
    "demo video block",
)

# Placed immediately after the reel marquee — high on the page, because proof of
# output is the thing a visitor most wants and currently cannot get anywhere.
edit(
    "src/marketing.js",
    '    <section class="reel-showcase" aria-label="Examples of vertical clips created with DeenClipped">',
    "    ${demoBlock()}\n\n"
    '    <section class="reel-showcase" aria-label="Examples of vertical clips created with DeenClipped">',
    "home: render the demo block",
)

edit(
    "src/marketing.js",
    '      <div class="hero-actions"><a class="button secondary" href="/features">Explore the workflow</a><a class="button text-link" href="/pricing">View pricing ${icon(\'arrow\')}</a></div>',
    '      <div class="hero-actions"><a class="button secondary" href="/features">Explore the workflow</a><a class="button text-link" href="/pricing">View pricing ${icon(\'arrow\')}</a></div>\n'
    '      <p class="hero-reassure">Start free with ${config.tokensFree} tokens${config.freeTierDays > 0 ? ` for ${config.freeTierDays} days` : \'\'} &middot; no card needed &middot; cancel any time</p>',
    "hero: risk reversal under the CTA",
)

# CTA wording — "Get started" says nothing; the free tier is the offer.
edit(
    "src/marketing.js",
    '<a class="button primary compact" href="/login?returnTo=/app">Get started ${icon(\'arrow\')}</a>',
    '<a class="button primary compact" href="/login?returnTo=/app">Start free ${icon(\'arrow\')}</a>',
    "nav CTA: name the offer",
)


# --------------------------------------------------------------------- styles

edit(
    "src/public/marketing.css",
    ".pricing-compare{",
    ".hero-reassure{margin:15px 0 0;color:var(--muted);font-size:12px;letter-spacing:.01em}"
    ".demo-section .demo-frame{max-width:420px;margin:0 auto;border:1px solid var(--line);border-radius:24px;overflow:hidden;background:#0b0b0d;box-shadow:0 30px 80px rgba(0,0,0,.45)}"
    ".demo-section video{display:block;width:100%;aspect-ratio:9/16;object-fit:cover;background:#0b0b0d}"
    ".pricing-compare{",
    "css: hero reassurance + demo frame",
)


print("patch11 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  python3 patch12/apply.py   (robots.txt, sitemap.xml, favicon routes)\n  npm run check && npm test\n")
