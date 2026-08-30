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
  // A guide answers a question a person typed. It is not a landing page and
  // must not read like one -- the answer comes first, the product second, and
  // only where it genuinely applies.
  GUIDE: 'guide',
  // An interactive utility that does the thing it says on the page, for free,
  // with no sign-up. A "free tool" that is a form leading to a sign-up is the
  // oldest bait in this industry and is not one of these.
  FREE_TOOL: 'free-tool',
  // A finished clip with the reasoning behind it. NOT REGISTERED YET: an
  // example page without a real, public, accessible video would need a
  // fabricated VideoObject, and there is no repo-owned demo clip. The renderer
  // and the schema exist and refuse to emit VideoObject without a real URL.
  EXAMPLE: 'example',
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
    title: 'DeenClipped — Turn Long Lectures Into Reviewed Clips',
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
    links: ['/tools/podcast-clip-generator', '/tools/ai-caption-generator', '/pricing'],
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
    links: ['/tools/ai-video-clipper', '/tools/ai-caption-generator', '/pricing'],
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
    links: ['/islamic-lecture-clipper', '/tools/arabic-english-captions', '/pricing'],
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
    links: ['/tools/youtube-to-tiktok', '/tools/youtube-to-reels', '/pricing'],
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
    links: ['/tools/youtube-to-shorts', '/tools/youtube-to-tiktok', '/pricing'],
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
    links: ['/islamic-lecture-clipper', '/tools/arabic-english-captions', '/review-safety'],
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
    links: ['/islamic-video-clipper', '/review-safety', '/pricing'],
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

  // ── Guides ───────────────────────────────────────────────────────────────
  // Five, not fifty. The brief asked for enough to establish the cluster and
  // explicitly not for a hundred generic articles, and a hub of thin posts is
  // worse than no hub.
  {
    path: '/guides',
    kind: KIND.GUIDE,
    title: 'Guides — Clipping Long Video for Short-Form | DeenClipped',
    description: 'Practical guides to cutting long videos into short-form clips: safe zones, dimensions, caption choices and what actually makes a clip work.',
    intent: 'short form video guides',
    breadcrumb: 'Guides',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/guides/long-video-to-shorts', '/guides/caption-safe-zones', '/tools/safe-zone-checker'],
  },
  {
    path: '/guides/long-video-to-shorts',
    kind: KIND.GUIDE,
    title: 'How to Turn a Long Video Into Shorts | DeenClipped',
    description: 'A practical method for cutting a long video into short-form clips: how to find the moments, where to cut, and what to fix before publishing.',
    intent: 'how to turn a long video into shorts',
    breadcrumb: 'Long video to Shorts',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/guides', '/guides/caption-safe-zones'],
  },
  {
    path: '/guides/caption-safe-zones',
    kind: KIND.GUIDE,
    title: 'Caption Safe Zones for Shorts, Reels and TikTok | DeenClipped',
    description: 'Where each platform covers your video with its own interface, and where captions have to sit so they survive on all three without re-editing.',
    intent: 'caption safe zones short form video',
    breadcrumb: 'Caption safe zones',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/tools/safe-zone-checker', '/guides', '/guides/9-16-video-dimensions'],
  },
  {
    path: '/guides/9-16-video-dimensions',
    kind: KIND.GUIDE,
    title: '9:16 Video Dimensions: The Numbers That Matter | DeenClipped',
    description: 'What 9:16 means in pixels, why 1080x1920 is the number to use, and what happens to a 16:9 video when it is cropped to vertical.',
    intent: '9 16 video dimensions',
    breadcrumb: '9:16 dimensions',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/guides/caption-safe-zones', '/guides', '/tools/safe-zone-checker'],
  },
  {
    path: '/guides/islamic-lecture-clips',
    kind: KIND.GUIDE,
    title: 'How to Clip Islamic Lectures Without Losing the Point | DeenClipped',
    description: 'Cutting lectures and khutbahs into short clips: choosing complete moments, handling recitation and Arabic, and what to check before publishing.',
    intent: 'how to make islamic reminder clips',
    breadcrumb: 'Clipping Islamic lectures',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/islamic-lecture-clipper', '/tools/lecture-clip-generator', '/review-safety'],
  },
  {
    path: '/guides/caption-best-practices',
    kind: KIND.GUIDE,
    title: 'Short-Form Caption Best Practices | DeenClipped',
    description: 'How many words to show at once, when word-by-word helps and when it distracts, and the caption mistakes that cost you the first three seconds.',
    intent: 'short form caption best practices',
    breadcrumb: 'Caption best practices',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/tools/ai-caption-generator', '/guides/caption-safe-zones', '/guides'],
  },

  // ── Free tools ───────────────────────────────────────────────────────────
  // Both do the thing on the page, client-side, with no account and no server
  // cost. Neither can be used to make the pipeline do free work.
  {
    path: '/tools/safe-zone-checker',
    kind: KIND.FREE_TOOL,
    title: 'Free Safe Zone Checker for Vertical Video | DeenClipped',
    description: 'Drop in a frame and see exactly where TikTok, Reels and Shorts cover it with their own interface. Free, runs in your browser, nothing uploaded.',
    intent: 'safe zone checker vertical video',
    breadcrumb: 'Safe zone checker',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/guides/caption-safe-zones', '/guides/9-16-video-dimensions', '/tools/ai-caption-generator'],
  },
  {
    path: '/tools/clip-calculator',
    kind: KIND.FREE_TOOL,
    title: 'Clip Calculator — How Many Clips From One Video | DeenClipped',
    description: 'Work out how many short clips a long video yields, how much of it is worth processing, and what that costs in DeenClipped tokens. Free, no sign-up.',
    intent: 'how many clips from a long video',
    breadcrumb: 'Clip calculator',
    cluster: 'guides',
    lastmod: '2026-08-30',
    links: ['/pricing', '/guides/long-video-to-shorts'],
  },

  // ── Comparison ───────────────────────────────────────────────────────────
  // ONE page, not one per competitor. A page per rival means a page per rival
  // to keep true, and a comparison that has gone stale is worse for the reader
  // than none -- they check, they find it wrong, and they stop believing the
  // rest of the site. No price is quoted anywhere on it for the same reason:
  // pricing moves, and a wrong number about someone else's product is both a
  // credibility problem and a legal one.
  {
    path: '/alternatives',
    kind: KIND.TRUST,
    title: 'DeenClipped vs General AI Clip Tools | DeenClipped',
    description: 'An honest comparison: what general AI clipping tools do better, what DeenClipped does that they do not, and how to tell which one fits your videos.',
    intent: 'ai clip tool alternative comparison',
    breadcrumb: 'How it compares',
    cluster: 'trust',
    lastmod: '2026-08-30',
    links: ['/islamic-video-clipper', '/pricing', '/how-it-works'],
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

/*
 * Localisation, prepared but not populated.
 *
 * Youssef's instruction and the brief agree: do NOT publish machine-translated
 * Arabic pages to inflate the page count. A bad translation of a religious
 * product is worse than no translation -- it is the kind of thing a native
 * reader forwards to friends as a joke, and this product cannot afford that.
 *
 * So the MACHINERY exists and the CONTENT does not. When a real Arabic page is
 * written by a person, it is added here with `lang: 'ar'` and `translationOf`
 * pointing at its English equivalent; hreflang, the `dir` attribute and the
 * x-default then follow automatically and nothing else has to be remembered.
 *
 * Everything currently registered is English, so `alternatesFor` returns an
 * empty list and no hreflang is emitted at all -- which is correct. hreflang
 * pointing at a page that does not exist is worse than none: Google drops the
 * whole cluster.
 */
export const DEFAULT_LANG = 'en';

/** The language a page is written in. */
export const langOf = page => (page && page.lang) || DEFAULT_LANG;

/** Right-to-left languages, for the `dir` attribute. */
const RTL = new Set(['ar', 'ur', 'fa', 'he']);
export const isRtl = lang => RTL.has(String(lang || '').slice(0, 2));

/**
 * Every language version of one page, INCLUDING itself.
 *
 * Returns [] for a page with no translations, because a one-entry hreflang set
 * is noise: it tells a crawler about a cluster of one.
 */
export function alternatesFor(page) {
  if (!page) return [];
  const rootPath = page.translationOf || page.path;
  const family = SEO_PAGES.filter(item =>
    item.path === rootPath || item.translationOf === rootPath);
  if (family.length < 2) return [];
  return family.map(item => ({ path: item.path, lang: langOf(item) }));
}

/*
 * Pages that used to exist and now redirect.
 *
 * Both were retired for the same reason: they made the SAME ARGUMENT as a
 * stronger page in different words, which is what a doorway page is even when
 * no sentence is repeated. Measured before removing them --
 * /tools/long-video-to-shorts shared 44% of its argument with
 * /tools/youtube-to-shorts and 33% with /tools/lecture-clip-generator, and
 * /for/islamic-creators shared 32% with /how-it-works while covering ground
 * /islamic-video-clipper already owned.
 *
 * "Long video to shorts" and "AI video clipper" are the same job described two
 * ways; one page answering it well beats two answering it identically. The
 * audience page was the third Islamic page arguing the same three points.
 *
 * 301, not 410: these URLs are in the sitemap Google read on 30 Aug 2026, so
 * they will be crawled, and a permanent redirect passes their value to the
 * page that absorbed them instead of throwing it away.
 */
export const RETIRED_PAGES = {
  '/tools/long-video-to-shorts': '/tools/ai-video-clipper',
  '/for/islamic-creators': '/islamic-video-clipper',
};
