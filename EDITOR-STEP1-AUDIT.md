# Editor Step 1 — control audit

Required by instruction 3: map what exists before moving or deleting anything.
Taken from the working tree on 12 Aug, not from memory.

---

## 1. What the sidebar has today

Five tools, defined in `src/public/activity-fix.js`:

| Current | Function | Becomes |
|---|---|---|
| Captions | `captionTool()` + 4 subtabs | **Captions** (unchanged name) |
| Canvas | `canvasTool()` | **Canvas** |
| Look | `styleTool()` | **Style** (rename) |
| Audio | `audioTool()` | **Audio** |
| Post | `detailsTool()` | **Export flow** (leaves the sidebar) |

Two target sections have **no existing home**:

- **Text** — no multi-layer text overlay feature exists at all. The nearest
  thing is the single "hook" (`hookEnabled`, `hookColor`, `hookBackground`,
  `hookBackgroundOpacity`, `hookFontSize`, `hookDuration`), a one-off title
  card currently edited under Look. It is one overlay, not a layer list.
- **Brand** — exists as a separate top-level page (Brand Kit), plus a summary
  card rendered inside `styleTool()`. Nothing in the editor sidebar.

---

## 2. Control-by-control mapping

Nothing below is deleted. Everything either stays, moves, or is newly built.

### Captions → Captions

`captionTool()` today = a status card, a timing nudge, and four subtabs
(Styles / Text / Format / Position).

| Existing control | Field | Step 1 placement |
|---|---|---|
| Caption preset cards (Viral/Clean/Arabic/Cinema) | — | Caption preset |
| Caption mode | `captionMode` | More settings |
| Main font | `captionFont` | Font |
| Important-word font | `captionHighlightFont` | More settings |
| Arabic font | `captionArabicFont` | More settings |
| Font size | `captionFontSize` | Font size |
| Font weight | `captionFontWeight` | More settings |
| Primary colour | `captionPrimary` | Text colour |
| Highlight colour | `captionHighlight` | Highlight colour |
| Outline + width | `captionOutline`, `captionOutlineWidth` | Stroke/outline |
| Background + opacity | `captionBackground`, `captionBackgroundOpacity` | Background |
| Line height | `captionLineHeight` | Line spacing |
| Letter spacing | `captionLetterSpacing` | More settings |
| Max words | `captionMaxWords` | Maximum words per line |
| Uppercase | `captionUppercase` | Capitalisation |
| 9-cell position grid | `captionPosition`, `captionHorizontal` | Position preset (Top/Centre/Bottom) |
| Margins | `captionMarginV`, `captionMarginH` | More settings |
| Timing nudge | `captionTimingOffsetMs` | More settings |
| Clear-on-silence | `captionClearPause` | More settings |
| Hold seconds | `captionHoldSeconds` | More settings |
| Stack settings | `captionStackMaxWords`, `captionStackProbability` | More settings |
| Highlight glow/italic | `captionHighlightGlow`, `captionHighlightItalic` | More settings |
| Shadow | `captionShadow` | More settings |
| Direction (RTL) | `captionDirection` | More settings |
| Transcript textarea | `editor.captionText` | Edit transcript |

**Missing, to build:** Alignment as an explicit control (currently only
implied by the 9-cell grid), Animation, Regenerate captions, Reset to preset.

**Note:** the spec lists a 3-value Position preset (Top/Centre/Bottom) while
the current control is a 9-cell grid carrying both axes. The grid is strictly
more capable. Keep the grid under More settings rather than losing horizontal
placement.

### (new) Text

Nothing to move. Requires a new clip-owned data structure — a `textLayers`
array on the clip, not on the Clip Style. Per §10 the builder must not store
"custom layer content", so the style owns text *styling defaults* only.

The existing `hook*` fields are the closest precedent and should be treated as
a migration source later, not deleted in Step 1.

### Canvas → Canvas

| Existing control | Field | Step 1 placement |
|---|---|---|
| Portrait/Landscape buttons | `width`, `height` | Aspect ratio (add 1:1, 4:5) |
| Fit / Blur / Fill | `fitMode` | Fit / Fill / Blur, with thumbnails |
| Blur strength | `blurStrength` | Blur background |
| Crop position | `cropPositionX/Y` | Video position (drag) |
| Manual / AI speaker focus | `smartFramingEnabled` | AI speaker focus |
| Framing bias | `smartFramingBias` | Select tracked speaker |
| Zoom | `smartFramingZoom` | Video zoom |
| Padding / smoothing / dwell | `smartFramingPadding`, `smartFramingSmoothing`, `smartFramingDwellSeconds` | More settings |
| Safe zones toggle | `editor.safeZones` | Safe-zone toggle (move from top bar) |

**Missing, to build:** Rotation, Background colour, Reset video position,
Alignment-guides toggle, Original framing, 1:1 and 4:5 ratios.

### Look → Style

| Existing control | Field | Step 1 placement |
|---|---|---|
| Filter preset | `filterPreset` | Colour filter |
| Brightness / Contrast / Saturation | `brightness`, `contrast`, `saturation` | same |
| Sharpen | `sharpen` | More settings |
| Vignette | `vignette` | Vignette |
| Gamma | `gamma` | More settings |
| Frame background | `frameBackground` | Background treatment |
| Hook card | `hook*` | Intro/outro selection (interim) |
| "Saved default" card | — | Replaced by applied-style status |
| Branding summary card | — | **Moves to Brand** |

**Missing, to build:** Warmth, Transition style, Reset appearance, and the
applied-style status block (`Applied style:` / `This clip has custom changes`
→ Reset to style / Save as new / Update existing).

### Audio → Audio

Currently two controls only: `voiceEnhance` and `musicVolumePercent`, plus a
"Save global music level" button.

| Existing | Step 1 group |
|---|---|
| Voice enhancement | Speech → Enhance speech |
| Nasheed volume | Background audio → Music volume |

**Missing, to build:** Voice volume, Noise reduction, Mute original audio, Add
music/nasheed, Automatic ducking, Fade in/out, Remove track, Audio delay,
Reset audio settings.

**Caveat:** most of these need worker support to actually affect a render.
Shipping controls that do nothing is what made the old panel untrustworthy, so
anything without a render path must not appear in Step 1.

### (new) Brand

Moves the branding summary out of Style. Fields already exist:
`watermark`, `watermarkColor`, `watermarkPosition`, `watermarkOpacity`,
`watermarkFontSize`, `watermarkMarginH/V`, `brandLineEnabled`,
`brandLineColor`, `brandLineHeight`, plus `data().brandSettings`.

**Missing, to build:** Logo upload/position/size/opacity, brand font, primary
and secondary colour, default caption style, default text style, intro, outro.

### Post → Export

`detailsTool()` holds Title, Description, Hashtags and a save button
(`savePostDetails`). Per instruction 5 this **moves into the Export flow**, it
is not deleted. `dcMetaTitle`, `dcMetaDescription`, `dcMetaHashtags` and
`savePostDetails()` must all survive the move.

---

## 3. Clip Style field contract (instruction 7)

`defaultTemplateDraft()` returns **74 fields**. Applying a style may write
only the fields below, and never anything else on the clip.

**Owned by a Clip Style (58):**

- Captions (31): every `caption*` field.
- Canvas (10): `width`, `height`, `fitMode`, `blurStrength`,
  `smartFramingEnabled`, `smartFramingBias`, `smartFramingZoom`,
  `smartFramingPadding`, `smartFramingSmoothing`, `smartFramingDwellSeconds`.
- Style (8): `filterPreset`, `brightness`, `contrast`, `saturation`,
  `sharpen`, `vignette`, `gamma`, `frameBackground`.
- Audio (1): `voiceEnhance`.
- Hook/intro (6): `hookEnabled`, `hookColor`, `hookBackground`,
  `hookBackgroundOpacity`, `hookFontSize`, `hookDuration`.
- Brand overlay (10): `watermark*` (7), `brandLine*` (3).

Counted: 31 + 10 + 8 + 1 + 6 + 10 = 66 style-owned fields.

**Not owned — identity, never copied onto a clip (8):**
`id`, `name`, `description`, `builtIn`, `editable`, `userId`, `version`,
`updatedAt`.

**Not owned — clip-specific, must survive applying a style:**
`cropPositionX`, `cropPositionY` (this clip's framing), `captionText` /
transcript wording, clip timing (`startSec`, `endSec`, `durationMs`),
`textLayers` (once built), and the clip's video.

> `cropPositionX/Y` are deliberately excluded. They are per-clip framing, not a
> reusable look — copying them would move the subject in every clip a style is
> applied to.

---

## 4. Sequencing

Step 1 as written is large. Proposed order, each independently shippable and
each verifiable in `scripts/editor-preview.mjs` before deploy:

1. **Clip Style contract in code** — export the owned-field list, make apply
   copy only those fields. Nothing visual; everything else depends on it.
2. **Sidebar shell** — six sections, single-open, collapse-to-expand-preview,
   remembered subsection. Move existing controls across unchanged.
3. **Style section status** — applied-style / custom-changes, with Reset,
   Save as new, Update existing.
4. **Top bar** — inline rename, Clip Style dropdown, autosave states,
   Undo/Redo tooltips, Preview mode, Export as primary.
5. **Post → Export** — move publishing metadata into the export flow.
6. **Bottom playback** — prev/next caption, volume, speed, timeline zoom, fit.
7. **Brand section** — move branding out of Style, add what has a render path.
8. **Text layers** — new data model; the largest item, and the only one that
   needs worker changes to render.

Items 7 and 8 have real render-side dependencies. Everything up to 6 is
front-end only and safe to ship incrementally.

---

## 5. Prerequisite defects found during the audit

Reported separately per the closing instruction, not fixed here.

1. **`captionTool()` bypasses its own subtabs when a clip has no clean
   source.** It returns early with a locked card, so Styles/Text/Format/
   Position are unreachable there — including the transcript editor, which
   has nothing to do with caption placement and should still work.
2. **Audio settings are half-global.** `musicVolumePercent` saves globally via
   `saveAudioSettings()` while `voiceEnhance` saves per-style. Grouping them
   under one Audio section without resolving that will read as a bug.
3. **The 9-cell position grid and `captionPositionX/Y` can disagree.** The grid
   writes `captionPosition`/`captionHorizontal`; dragging writes the numeric
   pair. Nothing reconciles them, so the grid appears to do nothing after a
   drag.
