# Editor Step 2 — pre-implementation audit

Required before implementation. Every number below was measured against the
deployed editor in a real browser at 1440×756, not derived from reading code.

---

## 1. Source of document scrolling

**The editor overflows the viewport by exactly 96px.** Measured:

```
viewport                    1440 × 756
document.scrollHeight             852     → 96px of outer scroll
#view-editor computed height      650px
#view-editor min-height           650px
--dc-top                           68px
body overflow-y                   auto
```

Three causes stack, and the arithmetic closes exactly:

**a. `.wrap` reserves 202px of padding, declared `!important`.**

```css
.wrap{padding: calc(var(--dc-top) + 24px) 24px 110px calc(var(--dc-side) + 24px) !important}
```

That is 92px top (68 + 24) and 110px bottom. The bottom 110px exists to clear
the floating activity dock on scrolling pages; the editor does not need it.

**b. The editor's own height calc under-counts that padding by 160px.**

```css
.dc-editor-page{height: calc(100vh - var(--dc-top) - 42px); min-height: 650px}
```

`-42px` was an estimate of surrounding chrome. The real figure is 202px, so
the editor asks for 646px inside a box that only has 554px of room.

**c. `min-height: 650px` then removes the ability to shrink.** Even with the
calc corrected, this floor forces overflow on any viewport under ~850px tall —
which is most 13" laptops with a browser toolbar.

Sum: `92 + 650 + 110 = 852` = the measured `scrollHeight`. The overflow is
fully explained; there is no fourth mystery contributor.

**Also relevant:** `#app > .wrap` is the scroll container for every route. The
fix must disable outer scrolling *only* on the editor route and restore it on
leaving, per §14.

---

## 2. Proposed fixed editor shell

```
#view-editor.dc-editor-page          height:100%; min-height:0; overflow:hidden
└── grid rows: auto / minmax(0,1fr) / var(--dc-timeline-h)
    ├── .dc-editor-header            auto        (stable height)
    ├── .dc-editor-workspace         minmax(0,1fr)
    │   └── grid cols: 62px / var(--dc-tool-panel) / minmax(0,1fr)
    │       ├── .dc-tool-rail        always reachable
    │       ├── .dc-tool-panel       min-height:0; overflow-y:auto   ← only scroller
    │       └── .dc-canvas-area      min-width:0; min-height:0
    │           └── .dc-canvas-wrap  place-items:center  ← black framing lives here
    └── .dc-timeline                 bounded, resizable, collapsible
```

Changes from today:

- Height comes from the **parent chain**, not `100vh`. The editor stops
  guessing what its ancestors consume — the arithmetic error in §1b becomes
  structurally impossible rather than corrected to a new wrong number.
- `.wrap` padding is neutralised on the editor route only. It is `!important`,
  so this needs an equally specific route-scoped rule, not a lower-specificity
  override.
- `min-height:650px` is dropped. Replaced by a minimum-width guard per §12
  rather than a height floor.
- The timeline row becomes `var(--dc-timeline-h)` so resizing it takes space
  from the preview and never from the document.

**The black framing is preserved and is not incidental.** It comes from
`.dc-canvas-wrap{display:grid;place-items:center}` with a 9:16 child. Centring
a portrait composition in a landscape area *produces* those two areas. Making
the preview responsive by scaling that child keeps them; only stretching the
child to fill the width would remove them, which §1 forbids.

---

## 3. Current timeline zoom/scroll model, and required change

**There is no zoom model.** The scale is one hard-coded constant:

```js
editor.timelineWidth = Math.max(scroll.clientWidth, 72 + Math.ceil(duration * 46));
```

46 pixels per second, always. Measured on a 35.92s clip:

```
--dc-timeline-width      1725px
timeline client width     876px
                         → 1.97× too wide; the clip cannot be seen at once
```

That single constant is the whole of §4's complaint. There are no zoom
controls in the DOM at all — verified live: `zoomIn`, `fitTimeline`, `split`
and `snap` all resolve to `false`.

**What already works and must not be rebuilt:**

- One shared horizontal coordinate system already exists. `timelineGeometry()`
  is the single answer to "where does time *t* sit", and the ruler, caption
  blocks and playhead were unified onto it earlier today. §5's requirement
  that tracks never drift apart is already satisfied and pinned by
  `test/timeline-geometry.test.mjs`.
- Click-to-seek and drag-to-scrub work, including a `wasPlaying` guard.
- Tracks share one scroll container (`#dcTimelineScroll`); no track has an
  independent scrollbar.

**Required change:** replace the constant with `editor.pixelsPerSecond`,
derived on open as `(usableWidth - padding) / duration` (Fit), and settable by
zoom controls. `timelineGeometry()` becomes the natural place for it, so the
ruler/playhead/tracks inherit any new scale for free. Guard `duration <= 0`
per §15.

**Risk:** `renderTimeline()` currently rebuilds all caption blocks on every
call. At Fit scale that is fine; at high zoom on a long clip it will not be.
Windowing is out of scope for this step but should be noted.

---

## 4. Which Media and AI capabilities already exist

Checked against the worker, which is what decides whether a control can
actually reach an export.

| Requested | Exists? | Evidence |
|---|---|---|
| AI speaker focus / reframing | **Yes** | `smartFramingEnabled` + `track_speaker_keyframes()` |
| Enhance speech | **Yes** | `voiceEnhance`, template-owned |
| Remove filler words | **No** | `FILLER` (`clip_worker.py:467`) and `FILLERS` (`intelligence.py:45`) are used to *score* candidates, never to cut |
| Remove pauses/silences | **No** | `long_silence`, `silenceRatio` are scoring inputs only |
| AI B-roll | **No** | no match anywhere |
| AI emojis | **No** | no match anywhere |
| AI keyword highlights | **No** | `keyword` appears only in hashtag matching |
| AI zooms | **No** | no match anywhere |
| Image / video overlay | **No** | the only `overlay=` in the pipeline is the blur-background composite (`clip_worker.py:1752`) |
| Stock media | **No** | no provider |
| Transcript-based cutting | **No** | no `concat`, `trim=`, `atrim` or `select=` in the render path — the pipeline cannot cut a clip into pieces at all |

**So AI Tools has exactly two working operations**, and both are already
reachable (Canvas and Audio). Under §9's "features that are not ready may be
omitted rather than represented by dead buttons", an AI Tools section built
now would be two moved controls and nine placeholders. **Recommendation: do
not add the section in this step.** Surfacing two existing controls under a
new label is presentation, not capability, and it would advertise nine things
that do not exist.

**Media** is the same picture: the pipeline has no overlay compositing path,
so every control in §8 is backend work first.

---

## 5. Defect found in my own previous step

`textTool()` currently exposes an "Opening title" with colour, size and
duration controls. **It can never do anything.** `sanitiseTemplate()` hard-
disables it:

```js
// src/templates.js:157
// Opening title cards are intentionally disabled. Clips begin immediately with spoken captions.
output.hookEnabled = false;
```

and the worker has no hook rendering — `HOOKS` in `clip_worker.py:471` is an
unrelated scoring word-list. I added those controls last step from the schema
without checking the render path. They are dead and must be removed; this
handover's "every visible action must work" rule is the same rule that
condemns them.

---

## 6. Files expected to change

| File | Change |
|---|---|
| `src/public/activity-fix.js` | editor shell grid; `.wrap` neutralisation on route; `pixelsPerSecond` + Fit; zoom/collapse/resize controls; remove dead hook controls from `textTool()` |
| `src/public/studio-v6.css` | timeline panel bounds, resize handle, collapsed strip |
| `test/timeline-geometry.test.mjs` | extend for Fit maths, zoom, zero-duration |
| `test/studio-layout.test.mjs` | shell invariants: no `100vh` in the editor chain, no height floor, single scroller |
| *(new)* `test/editor-shell.test.mjs` | viewport-fitting rules |

No worker changes in this step. Nothing here needs the render pipeline —
which is exactly why §8/§9 are deferred.

---

## 7. Regression risks to completed work

1. **The caption drag model reads `.dc-video-canvas` geometry.** Making the
   preview responsive changes that box. `bindCaptionDrag()` computes from
   `getBoundingClientRect()`, so it should follow correctly — but caption
   position is stored as a percentage and this is the control the customer
   noticed breaking before. Re-test after the shell change.
2. **`timelineGeometry()` is now depended on by three call sites.** Introducing
   `pixelsPerSecond` must go *through* it, not around it. Bypassing it
   reintroduces the three-origin bug that made the playhead miss the caption.
3. **Panel collapse just landed** and reads `--dc-tool-panel` across three
   breakpoints. A rewritten shell must preserve all three or collapse silently
   stops working at some widths — it already failed that way once today.
4. **`min-height:0` is load-bearing.** The canvas wrap and timeline scroll rely
   on it. Removing it during a rewrite reintroduces overflow that looks like
   the original bug.
5. **Disabling outer scroll must be route-scoped.** Leaving `overflow:hidden`
   on the body after navigating away breaks every other page.
6. **Clip Style contract is unaffected** — no template fields change.

---

## 8. Proposed order

Phases A–C only. D (Media / AI Tools) is blocked on render-pipeline work and
should be a separate project with its own handover.

1. **B — fixed shell.** Highest value: it is the actual complaint, and it is
   contained.
2. **C1 — Fit Timeline.** One constant becomes a derived value.
3. **C2 — zoom, bounded resize, collapse.**
4. **C3 — split/trim/snap/frame-step**, only for elements the pipeline can
   actually render. Split and trim imply cutting, which per §4 does not exist,
   so this reduces to frame-step, snap and delete-where-supported.
5. **Remove the dead opening-title controls** (§5) — small, do it first.

Items in §6 (Split, Delete segment) and most of §8/§9 are gated on the same
missing capability: **the render pipeline cannot cut or composite.** That is
one dependency, worth one decision, rather than several separate gaps.
