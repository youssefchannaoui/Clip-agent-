/**
 * Every public, indexable page — in one place.
 *
 * Three lists used to describe the public site and none of them knew about the
 * others: the route table in server.js, PUBLIC_PAGES for the sitemap, and
 * TRACKED_PATHS for analytics. A new page was three edits, and forgetting one
 * failed quietly — a page that served fine, never appeared in the sitemap, and
 * recorded no visits. This is the one list they all read.
 *
 * Deliberately PURE DATA. marketing.js renders these, metrics.js allowlists
 * them and server.js routes them; if this module imported any of those, they
 * could not import it back.
 *
 * `lastmod` is the date the page's CONTENT last meaningfully changed, written
 * by hand. It is not the deploy date and must never be generated: a sitemap
 * that claims every page changed today teaches Google to ignore the field.
 */

/** Page kinds, which decide the template and the breadcrumb trail. */
export const KIND = {
  HOME: 'home',
  TOOL: 'tool',
  AUDIENCE: 'audience',
  USE_CASE: 'use-case',
  TRUST: 'trust',
  LEGAL: 'legal',
  COMMERCE: 'commerce',
};

/**
 * The registry.
 *
 * intent      — the search this page exists to satisfy. One page, one intent.
 * cluster     — which topic group it belongs to, used for internal linking.
 * links       — sibling paths this page should link to in its own words.
 * indexable   — false keeps it out of the sitemap and adds a noindex robots tag.
 * tracked     — false keeps it out of first-party analytics.
 */
export const SEO_PAGES = [
  {
    path: '/',
    breadcrumb: 'Home',
    kind: KIND.HOME,
    title: 'AI Video Clipper for Lectures & Long Videos | DeenClipped',
    description:
      'Turn long lectures into review-ready vertical clips. DeenClipped finds complete moments, captions them in English and Arabic, and waits for your approval.',
    intent: 'ai video clipper',
    cluster: 'core',
    lastmod: '2026-08-29',
    links: ['/tools/ai-video-clipper', '/islamic-video-clipper', '/pricing'],
  },
  {
    path: '/features',
    breadcrumb: 'Features',
    kind: KIND.COMMERCE,
    title: 'Features — Clip, Caption, Review and Publish | DeenClipped',
    description:
      'Every part of the DeenClipped workflow: source selection, AI clip discovery, caption styles, the review queue, scheduling and connected publishing.',
    intent: 'deenclipped features',
    cluster: 'core',
    lastmod: '2026-08-29',
    links: ['/how-it-works', '/pricing', '/tools/ai-video-clipper'],
  },
  {
    path: '/pricing',
    breadcrumb: 'Pricing',
    kind: KIND.COMMERCE,
    title: 'Pricing & Token Shop — Basic, Pro and Studio | DeenClipped',
    description:
      'Compare Basic, Pro and Studio across weekly, monthly and yearly billing, plus one-time token packs. You pay for the source minutes you choose to process.',
    intent: 'deenclipped pricing',
    cluster: 'core',
    lastmod: '2026-08-29',
    links: ['/features', '/how-it-works'],
  },

  // ── Tools: one page per distinct commercial search ────────────────────────
  {
    path: '/tools/ai-video-clipper',
    breadcrumb: 'AI video clipper',
    kind: KIND.TOOL,
    title: 'AI Video Clipper — Long Video to Short Clips | DeenClipped',
    description:
      'An AI video clipper that reads what was said, cuts complete moments rather than fixed intervals, and holds every clip for your review before it publishes.',
    intent: 'ai video clipper',
    cluster: 'clipping',
    lastmod: '2026-08-30',
    links: ['/tools/long-video-to-shorts', '/tools/podcast-clip-generator', '/tools/ai-caption-generator', '/pricing'],
  },
  {
    path: '/tools/long-video-to-shorts',
    breadcrumb: 'Long video to Shorts',
    kind: KIND.TOOL,
    title: 'Long Video to Shorts — Automatic Vertical Clips | DeenClipped',
    description:
      'Turn a long video into vertical short-form clips. Choose the stretch worth clipping, let DeenClipped find complete moments, and review each one first.',
    intent: 'long video to shorts',
    cluster: 'clipping',
    lastmod: '2026-08-30',
    links: ['/tools/ai-video-clipper', '/tools/youtube-to-shorts', '/tools/lecture-clip-generator', '/pricing'],
  },
  {
    path: '/tools/podcast-clip-generator',
    breadcrumb: 'Podcast clip generator',
    kind: KIND.TOOL,
    title: 'Podcast Clip Generator — Podcast to Short Clips | DeenClipped',
    description:
      'Turn a long podcast into short clips. DeenClipped transcribes the episode, scores moments that stand alone, and renders captioned vertical clips to review.',
    intent: 'podcast clip generator',
    cluster: 'clipping',
    lastmod: '2026-08-30',
    links: ['/tools/ai-video-clipper', '/tools/long-video-to-shorts', '/tools/ai-caption-generator', '/pricing'],
  },
  {
    path: '/tools/lecture-clip-generator',
    breadcrumb: 'Lecture clip generator',
    kind: KIND.TOOL,
    title: 'Lecture Clip Generator — Talks to Shorts | DeenClipped',
    description:
      'Turn a recorded lecture into short clips. Built for talks where the words matter: complete points, accurate captions, and a human decision on each one.',
    intent: 'lecture clip generator',
    cluster: 'clipping',
    lastmod: '2026-08-30',
    links: ['/islamic-lecture-clipper', '/tools/long-video-to-shorts', '/tools/arabic-english-captions', '/pricing'],
  },
  {
    path: '/tools/ai-caption-generator',
    breadcrumb: 'AI caption generator',
    kind: KIND.TOOL,
    title: 'AI Caption Generator — Burned-In Subtitles | DeenClipped',
    description:
      'Automatic captions burned into the clip, timed to the words as spoken. Choose a style per template, in English or Arabic, and read every line first.',
    intent: 'ai caption generator',
    cluster: 'captions',
    lastmod: '2026-08-30',
    links: ['/tools/arabic-english-captions', '/tools/ai-video-clipper', '/pricing'],
  },

  // ── Platform-intent pages ────────────────────────────────────────────────
  {
    path: '/tools/youtube-to-shorts',
    breadcrumb: 'YouTube to Shorts',
    kind: KIND.TOOL,
    title: 'YouTube to Shorts — Long Video to Shorts | DeenClipped',
    description:
      'Paste a YouTube link, pick the stretch worth clipping, and get vertical captioned Shorts you can review and publish back to your own channel.',
    intent: 'youtube to shorts',
    cluster: 'platforms',
    lastmod: '2026-08-30',
    links: ['/tools/youtube-to-tiktok', '/tools/youtube-to-reels', '/tools/long-video-to-shorts', '/pricing'],
  },
  {
    path: '/tools/youtube-to-tiktok',
    breadcrumb: 'YouTube to TikTok',
    kind: KIND.TOOL,
    title: 'YouTube to TikTok — Repurpose Long Video | DeenClipped',
    description:
      'Turn a YouTube video into vertical TikTok clips with captions, then post to your connected TikTok account once you have approved each one.',
    intent: 'youtube to tiktok',
    cluster: 'platforms',
    lastmod: '2026-08-30',
    links: ['/tools/youtube-to-shorts', '/tools/youtube-to-reels', '/tools/ai-caption-generator', '/pricing'],
  },
  {
    path: '/tools/youtube-to-reels',
    breadcrumb: 'YouTube to Reels',
    kind: KIND.TOOL,
    title: 'YouTube to Reels — Video Into Instagram Reels | DeenClipped',
    description:
      'Turn a YouTube video into Instagram Reels: vertical framing, burned-in captions, and a review step before anything reaches your account.',
    intent: 'youtube to reels',
    cluster: 'platforms',
    lastmod: '2026-08-30',
    links: ['/tools/youtube-to-shorts', '/tools/youtube-to-tiktok', '/tools/long-video-to-shorts', '/pricing'],
  },

  // ── The niche this product can actually own ──────────────────────────────
  {
    path: '/islamic-video-clipper',
    breadcrumb: 'Islamic video clipper',
    kind: KIND.TOOL,
    title: 'Islamic Video Clipper for Muslim Creators | DeenClipped',
    description:
      'An AI video clipper built for Islamic content: Arabic and English captions, recited ayat matched to the Quran with translation, and human review first.',
    intent: 'islamic video clipper',
    cluster: 'islamic',
    lastmod: '2026-08-30',
    links: ['/islamic-lecture-clipper', '/for/islamic-creators', '/tools/arabic-english-captions', '/review-safety'],
  },
  {
    path: '/islamic-lecture-clipper',
    breadcrumb: 'Islamic lecture clipper',
    kind: KIND.TOOL,
    title: 'Islamic Lecture Clipper — Lectures to Shorts | DeenClipped',
    description:
      'Turn Islamic lectures into short clips without losing the point. Complete moments, Arabic and English captions, and scripture always held for a human decision.',
    intent: 'islamic lecture clipper',
    cluster: 'islamic',
    lastmod: '2026-08-30',
    links: ['/islamic-video-clipper', '/for/islamic-creators', '/review-safety', '/pricing'],
  },
  {
    path: '/for/islamic-creators',
    breadcrumb: 'For Islamic creators',
    kind: KIND.AUDIENCE,
    title: 'DeenClipped for Islamic Creators — Tools for Dawah Content',
    description:
      'For creators publishing Islamic reminders and lectures: multilingual captions, Quran-aware handling, nasheed mixing and a review-first workflow.',
    intent: 'muslim creator tools',
    cluster: 'islamic',
    lastmod: '2026-08-30',
    links: ['/islamic-video-clipper', '/islamic-lecture-clipper', '/tools/arabic-english-captions', '/pricing'],
  },
  {
    path: '/tools/arabic-english-captions',
    breadcrumb: 'Arabic & English captions',
    kind: KIND.TOOL,
    title: 'Arabic & English Captions — Bilingual Subtitles | DeenClipped',
    description:
      'Captions for videos that move between Arabic and English. Arabic is captioned in Arabic with an English line beneath it, drawn from a second translation pass.',
    intent: 'arabic english captions',
    cluster: 'captions',
    lastmod: '2026-08-30',
    links: ['/tools/ai-caption-generator', '/islamic-video-clipper', '/review-safety'],
  },

  // ── Trust and entity pages ───────────────────────────────────────────────
  {
    path: '/how-it-works',
    breadcrumb: 'How it works',
    kind: KIND.TRUST,
    title: 'How DeenClipped Works — Source to Published Clip',
    description:
      'The whole pipeline in order: choose a source and a stretch, transcription, moment scoring, rendering with captions, your review, then publishing.',
    intent: 'how deenclipped works',
    cluster: 'trust',
    lastmod: '2026-08-30',
    links: ['/features', '/review-safety', '/pricing'],
  },
  {
    path: '/review-safety',
    breadcrumb: 'Review & safety',
    kind: KIND.TRUST,
    title: 'Review & Safety — Nothing Publishes Without You | DeenClipped',
    description:
      'How DeenClipped keeps a human in the loop: every clip waits in a review queue, scripture is flagged, and publishing only reaches channels you connect.',
    intent: 'ai video review safety',
    cluster: 'trust',
    lastmod: '2026-08-30',
    links: ['/how-it-works', '/islamic-video-clipper', '/about'],
  },
  {
    path: '/about',
    breadcrumb: 'About',
    kind: KIND.TRUST,
    title: 'About DeenClipped — Why We Built a Review-First Clipper',
    description:
      'What DeenClipped is, who it is for, and why it holds every clip for a human decision instead of publishing automatically.',
    intent: 'about deenclipped',
    cluster: 'trust',
    lastmod: '2026-08-30',
    links: ['/how-it-works', '/review-safety', '/contact'],
  },

  // ── Existing pages that stay exactly as they are ─────────────────────────
  {
    path: '/contact',
    breadcrumb: 'Contact',
    kind: KIND.TRUST,
    title: 'Contact — DeenClipped',
    description: 'Get in touch with the DeenClipped team about billing, publishing or anything the app is doing that it should not.',
    intent: 'contact deenclipped',
    cluster: 'trust',
    lastmod: '2026-08-12',
    links: ['/about', '/pricing'],
  },
  {
    path: '/privacy',
    breadcrumb: 'Privacy',
    kind: KIND.LEGAL,
    title: 'Privacy Policy — DeenClipped',
    description: 'What DeenClipped stores, what it never stores, how transcripts and video are handled, and how to get your data removed.',
    intent: 'deenclipped privacy policy',
    cluster: 'legal',
    lastmod: '2026-08-12',
    links: ['/terms', '/contact'],
  },
  {
    path: '/terms',
    breadcrumb: 'Terms',
    kind: KIND.LEGAL,
    title: 'Terms of Service — DeenClipped',
    description: 'The terms covering DeenClipped accounts, tokens, publishing to connected channels and acceptable use.',
    intent: 'deenclipped terms',
    cluster: 'legal',
    lastmod: '2026-08-12',
    links: ['/privacy', '/contact'],
  },
];

/** Everything a sitemap may list and a crawler should reach. */
export const indexablePages = () => SEO_PAGES.filter(page => page.indexable !== false);

/** Paths first-party analytics will count. Anything else is a scanner. */
export const trackedPaths = () => SEO_PAGES.filter(page => page.tracked !== false).map(page => page.path);

/** One page by path, or undefined. */
export const pageFor = path => SEO_PAGES.find(page => page.path === path);

/** Sibling pages in the same cluster, for internal linking. */
export const clusterOf = cluster => SEO_PAGES.filter(page => page.cluster === cluster);

/**
 * Breadcrumb trail for a page, as [{name, path}] ending at the page itself.
 * The home entry is always first; nested kinds get their section in between.
 */
export function breadcrumbFor(page) {
  const trail = [{ name: 'Home', path: '/' }];
  if (!page || page.path === '/') return trail;
  const section = {
    [KIND.TOOL]: { name: 'Tools', path: '/tools' },
    [KIND.AUDIENCE]: { name: 'For', path: '/for' },
    [KIND.USE_CASE]: { name: 'Use cases', path: '/use-cases' },
  }[page.kind];
  // Only a section that is itself a real page may appear as a link; the others
  // are path prefixes with nothing behind them, and a breadcrumb pointing at a
  // 404 is worse than a shorter trail.
  if (section && pageFor(section.path)) trail.push(section);
  trail.push({ name: page.breadcrumb || page.intent, path: page.path });
  return trail;
}
