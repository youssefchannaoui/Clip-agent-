/**
 * What's new — the release notes a customer actually reads.
 *
 * Pure data with NO imports, deliberately, for the same reason `help.js` and
 * `seo-copy.js` are: the server serves it, the tests read it, and anything
 * that describes the product must not be able to import in a circle.
 *
 * ── THE BAR FOR ADDING AN ENTRY ──────────────────────────────────────────
 *
 * An entry costs a customer their attention and interrupts whatever they
 * opened the dashboard to do. So it earns its place only if BOTH are true:
 *
 *   1. It changes what somebody can DO, or fixes something they had actually
 *      noticed. A new screen, a new control, a limit lifted, a bug they hit.
 *   2. They could not work it out by looking. A control that explains itself
 *      the moment it is seen does not need an announcement.
 *
 * Which rules OUT, however much work went into them: refactors, test-only
 * work, performance nobody complained about, copy fixes, an internal guard,
 * anything behind a gate they cannot open, and anything on the Owner screen —
 * that surface has one reader and he already knows.
 *
 * **One entry per release at most, and not most releases.** A dozen a month
 * is a notification nobody reads, and then the one that mattered is missed
 * too — the same failure `alerts.js` exists to prevent. If in doubt, leave it
 * out: nothing is lost, because the CHANGE still shipped.
 *
 * ── HOW TO ADD ONE ───────────────────────────────────────────────────────
 *
 *   - Newest FIRST. The file's order is the order on screen, and the first
 *     entry is the one that raises the dialog.
 *   - `id` is permanent and never reused: it is the seen-marker, so editing
 *     an entry's words is free and changing its id shows it to everybody
 *     again.
 *   - `image` is a REAL capture of this app, in `src/public/whats-new-assets/`.
 *     `test/whats-new.test.mjs` fails on an image that is not on disk and on
 *     one on disk that nothing references, so a broken picture cannot reach a
 *     customer and a renamed file cannot rot in the directory.
 *   - `action` is a key of `StudioAdapter.goToStep` — the studio's ONE
 *     destination map. The test walks every action against it, so an entry
 *     can never offer a screen the app cannot reach. Omit it and no button is
 *     drawn, which is the honest answer for a change with nowhere to go.
 *   - Keep the list to `MAX_SHOWN`. Past that, delete from the bottom: this
 *     is what is new, not a changelog, and CLAUDE.md is the durable history.
 */

/** Where the captures live, served by the /whats-new-assets/ route. */
export const IMAGE_BASE = '/whats-new-assets/';

/**
 * How many entries the page carries. Older ones are deleted rather than
 * archived — a customer scrolling a year of releases is reading a changelog,
 * and this is not one.
 */
export const MAX_SHOWN = 8;

/** Newest first. See the bar above before adding one. */
export const RELEASES = Object.freeze([
  {
    id: '2026-09-08-clip-brief',
    version: '3.152.0',
    date: '2026-09-08',
    title: 'Tell the clipper what to look for',
    summary: 'A lecture covers five subjects and you only want one of them. Now you can say so.',
    image: 'clip-brief.webp',
    imageAlt: 'The first step of the Start job panel, with a box describing what to clip',
    items: Object.freeze([
      'The Start job panel opens with a box: “clip the parts about repentance”, or “the story about his mother”.',
      'Clips that answer it come first. It ranks — it never filters — so a brief the lecture barely touches still returns a full run rather than nothing.',
      'Quote a phrase in "quotes" to ask for those words together.',
      'Leave it empty and nothing changes: the run is exactly what it was before.',
    ]),
    action: 'paste',
    actionLabel: 'Start a lecture',
  },
  {
    id: '2026-09-08-deenai-copilot',
    version: '3.151.0',
    date: '2026-09-08',
    title: 'DeenAI reads your own clips now',
    summary: 'It was a chat box that guessed. It is a copilot that counts.',
    image: 'deenai.webp',
    imageAlt: 'The DeenAI screen with a goal, today’s actions and a grounded answer',
    items: Object.freeze([
      'Every figure it gives you is computed from your own clips and lectures. It is not allowed to state a number it did not measure.',
      'Attach a clip and ask for a better title or description. It drafts one beside the original and changes nothing until you accept it.',
      'Ask it how something works and it answers from the help centre, with the article beside the answer.',
      'It will never give a ruling, quote scripture from memory, or edit a verse.',
    ]),
    action: 'deenai',
    actionLabel: 'Open DeenAI',
  },
  {
    id: '2026-09-08-starter-nasheeds',
    version: '3.150.0',
    date: '2026-09-08',
    title: 'Nine nasheeds come with DeenClipped',
    summary: 'Every clip mixes one in, so a new account could not finish a render without uploading one first. Not any more.',
    image: 'nasheeds.webp',
    imageAlt: 'The nasheed screen showing the DeenClipped library beneath your own',
    items: Object.freeze([
      'Nine muffled beds ship with the product, in their own section under your own uploads.',
      'They rotate with anything you add, so your clips do not all sound the same.',
      'Upload your own whenever you like — nothing here replaces them.',
    ]),
    action: 'nasheed',
    actionLabel: 'Open nasheeds',
  },
  {
    id: '2026-09-07-posting-windows',
    version: '3.146.0',
    date: '2026-09-07',
    title: 'Choose your own posting times',
    summary: 'The times a clip goes out were set on the server. They are yours now.',
    image: 'posting-windows.webp',
    imageAlt: 'The posting windows card, a tick and a time for each window',
    items: Object.freeze([
      'A row for each window: a tick to switch it on or off, and a dropdown for the time.',
      'Post twice a day instead of four times, or move everything to the evening.',
      'Studio still gets eight windows a day and Pro four — this decides when they are, not how many.',
    ]),
    action: 'schedule',
    actionLabel: 'Open the schedule',
  },
  {
    id: '2026-09-07-editor-open',
    version: '3.139.0',
    date: '2026-09-07',
    title: 'The clip editor is open',
    summary: 'It said “coming soon” for eleven days. It does not any more.',
    image: 'editor.webp',
    imageAlt: 'The clip editor with the timeline, caption blocks and the live preview',
    items: Object.freeze([
      'Open any clip and change it: trim the ends, cut a section out of the middle, fix a caption’s words, move it, resize it.',
      'The preview shows every change as you make it — the look, the framing, the captions and the watermark, live.',
      'Save renders the exact video. Titles and descriptions never re-render anything.',
      'It edits the clip you have. It is not a frame-by-frame editor and has no overlays or stock footage.',
    ]),
    action: 'review',
    actionLabel: 'Open the review queue',
  },
]);

/** The entry that decides whether a dialog is raised. */
export function latest() {
  return RELEASES[0] || null;
}

/** ISO date -> ms. A date is what a person edits; the number is derived. */
export function releasedAt(entry) {
  const ms = Date.parse(`${String(entry?.date || '')}T00:00:00Z`);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Which release, if any, to raise a dialog for.
 *
 * The SERVER decides this, not the browser. A localStorage guard travels with
 * the browser rather than with the person, which is exactly how the "one all
 * the way through" dialog came to greet every established account on every new
 * device (v3.130.0). `seen` is stamped on the account.
 *
 * Two accounts are deliberately never interrupted:
 *
 *  - **One created after the release.** Release notes describe a change from a
 *    version they have never used, so there is nothing new about it to them.
 *  - **One that has never imported a lecture.** The first-run screen is
 *    teaching them step one; a notice about what changed last week is noise
 *    on top of it, and worse, it lands over the panel that explains the
 *    product.
 *
 * Both still reach the page itself from Help — withholding the interruption
 * is not the same as withholding the information.
 */
export function showFor(ctx = {}) {
  const entry = latest();
  if (!entry) return '';
  if (String(ctx.seen || '') === entry.id) return '';
  if (!ctx.imported) return '';
  const born = Number(ctx.createdAt || 0);
  // An unknown creation date reads as an old account rather than a new one:
  // failing towards showing it once is better than never showing it at all.
  if (born && born >= releasedAt(entry)) return '';
  return entry.id;
}

/** What the browser fetches once, in the background, and never awaits. */
export function payload() {
  return {
    imageBase: IMAGE_BASE,
    latest: latest()?.id || '',
    releases: RELEASES.slice(0, MAX_SHOWN).map(entry => ({
      id: entry.id,
      version: entry.version,
      date: entry.date,
      title: entry.title,
      summary: entry.summary,
      image: entry.image,
      imageAlt: entry.imageAlt || entry.title,
      items: entry.items.slice(),
      action: entry.action || '',
      actionLabel: entry.actionLabel || '',
    })),
  };
}
