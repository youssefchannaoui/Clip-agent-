# Editor rebuild — groundwork notes

Written 12 Aug after mapping the existing editor against Opus Clip's. Everything
here was verified against the code, not assumed. The point of this file is that
the next session starts building instead of re-deriving.

## The goal

Make the **transcript the editor**. Opus's left panel is the full transcript:
click a word to seek, keywords highlighted, filler shown with timing chips you
delete. You edit the video by editing text. DeenClipped currently leads with a
settings form — Captions / Canvas / Look / Audio / Post, mostly sliders — which
is why it reads as a control panel rather than an editor.

## The good news: the data model is already right

This was the main risk and it is not a problem.

- `editor.captionWords` holds `{word, start, end}` per word.
- Real Whisper timings reach it. `editor.captionSource` is one of
  `whisper` | `edited` | `fallback`; `approximateWords()` (evenly spaced, fake)
  is only the fallback when no timed transcript is available.
- `mapEditedWordsToSpeech()` already maps edited text back onto real speech
  timing — so deleting a word and keeping everything else in sync is solved.
- `editor.captionTimingReference` keeps the untouched original to map against.

So word-level editing does not need new plumbing. It needs a surface.

## What already exists to build on

| Thing | Where |
|---|---|
| Seek to a time | `seekEditor(seconds)` |
| Current playhead | `editor.currentTime`, updated in `video.ontimeupdate` |
| Words + timings | `editor.captionWords` |
| Original timing map | `editor.captionTimingReference` |
| Re-map after an edit | `mapEditedWordsToSpeech(text, reference, duration)` |
| Caption render on canvas | `updateCaptionAtTime(time)` → `captionHtmlAtTime(time)` |
| Timeline | `renderTimeline()`, `#dcCaptionTrack`, `#dcRuler` |
| Editor markup | built in JS; canvas ids `#dcEditorVideo`, `#dcCaptionOverlay` |

There is already an "Exact speech timing" control and a caption text editor;
they are secondary UI. The rebuild promotes that idea to the primary surface.

## Build order

1. **Transcript panel, left side.** Render `editor.captionWords` as clickable
   spans. Click → `seekEditor(word.start)`. Highlight the active word from
   `editor.currentTime` — update on `ontimeupdate` and mutate only the changed
   span, the same way `updateCaptionAtTime` avoids re-writing innerHTML every
   frame or it will shimmer.
2. **Delete / restore words.** Removing a span edits `editor.captionText`, then
   `mapEditedWordsToSpeech` re-derives timings. Mark `editor.dirty`.
3. **Gap chips.** Where `next.start - word.end` exceeds ~0.3s, show the gap as a
   chip. That is where filler and dead air live and it is what makes Opus's
   panel feel like an editing tool.
4. **Contextual right panel.** Select the caption on canvas → caption
   properties; select video → framing. The panels exist; what changes is that
   selection drives them instead of a category rail.
5. **Quieten the canvas.** Safe zones, thirds guides, "KEEP TEXT INSIDE" and
   "Fill · drag/resize video" are currently always on. Show them while dragging.

## Constraints that already bit once

- **The caption box must stay draggable.** It was hidden in the baked-export
  state and that removed caption positioning from most of the library, because
  a YouTube import discards its raw download and so most clips have no clean
  source. See `dc-editor-baked-preview` and the test that pins this.
- **Do not hide a control to fix a visual conflict.** Label it instead.
- `activity-fix.js` is ~4,600 lines and holds the whole client. Regex over it
  backtracks badly — use Python string search, not `grep -oE`.
- `npm run check` does **not** validate CSS. An unbalanced stylesheet passes it.
  `test/studio-layout.test.mjs` has a brace-balance guard for this reason.

## Not verified

Framing (P2) and Arabic RTL (P3) are live on the worker and have never been
looked at on screen. Marketing screenshots show speakers cropped with their
heads out of frame, which is the single biggest quality gap in the product.
`scripts/render-probe.py` renders a clip and pulls stills; it needs ffmpeg and
a lecture file, and has not itself been run end to end.
