# DeenClipped — working agreement

## Ownership split (set 12 Aug 2026, by Youssef)

**Claude does workers and systems. ChatGPT does layout. Claude stays out of
layout.**

| Area | Owner |
|---|---|
| `worker/` — clip pipeline, scoring, transcription, rendering, framing, Arabic | **Claude** |
| `src/server.js`, `src/local-engine.js` — queueing, jobs, routes, storage | **Claude** |
| `src/templates.js` — schema, Clip Style contract | **Claude** |
| Data models, APIs, tests, audits, deploys | **Claude** |
| Editor shell, sidebar, timeline, CSS, visual design, spacing, sizing | **ChatGPT** |
| Anything about how a screen *looks* or *fits* | **ChatGPT** |

### Why

Claude repeatedly changed editor layout on 11–12 Aug and repeatedly got it
wrong — a preview sized against the wrong box, a timeline nested in the wrong
grid, a panel collapse that did not collapse, and a shell restructure that
left the editor visibly broken on the live site. Each attempt passed a green
test suite, because the failures were visual and the tests were not.

The split exists because of that track record, not as a general rule about
what Claude can do.

### What this means in practice

- Claude does **not** edit CSS, grid/flex structure, sizing, spacing, or
  markup whose purpose is appearance — even to "quickly fix" something.
- If Claude finds a layout bug, Claude **reports it with measurements** and
  hands it to ChatGPT. Claude does not fix it.
- If a systems change would alter layout, Claude flags the layout impact and
  stops at the boundary.
- Claude may still **measure** layout in the browser and produce evidence —
  observation is useful, editing is not.
- Two agents must never edit the same file at once. On 12 Aug Claude and
  Claude Code both edited `src/public/activity-fix.js` with opposite
  intentions and reversed each other's work three times.

---

## State of the editor at handover (12 Aug)

ChatGPT is inheriting a **broken layout that Claude caused**. It is live on
`deenclipped.online` — commits `89348ef` and `de57de3` are deployed.

What Claude changed, so it can be judged or reverted cleanly:

- `.dc-editor-page` was made a three-row grid (header / workspace / timeline)
  and the timeline was moved out of `.dc-editor-workspace` to be its sibling.
- `.dc-editor-workspace` became columns-only; `grid-row` spans were removed
  from `.dc-tool-rail` and `.dc-tool-panel`.
- `min-height:0` and `overflow:hidden` were added across the editor regions.
- A `dc-editor-route` body class disables page scrolling on the editor route,
  with `.wrap` padding overridden inside `src/public/studio-v6.css`.
- The `@media(max-width:980px)` editor rules were rewritten.
- Timeline scale became derived (`timelineFitScale`) instead of a fixed
  46px/sec, with zoom stored as a multiplier.

**The reported symptom after these changes: the whole screen resizes and the
editor is messed up.** Reverting `de57de3` and `89348ef` returns the editor to
the last state the customer described as merely imperfect rather than broken.

The non-layout work in those commits worth keeping if reverting:
`timelineFitScale`/`timelineScale` (Fit Timeline maths), and the removal of
the dead "Opening title" controls.

---

## Load-bearing invariants (do not regress)

These were each a real bug and each has a test named after it.

1. **`QUOTE_RISK` review gate** (`worker/clip_worker.py`) forces human review on
   clips containing scripture. The most important safety property here.
2. **Prompt-injection defence** in the Ollama prompt marks transcript content
   as untrusted data, never instructions.
3. **Clip Style contract** (`src/templates.js`): applying a style writes only
   `CLIP_STYLE_FIELDS`. Never identity (`id`/`name`) and never per-clip framing
   (`cropPositionX/Y`).
4. **One timeline origin.** Ruler, caption blocks and playhead all derive from
   `timelineGeometry()`. Three separate origins once made the playhead miss the
   caption it pointed at.
5. **Clip-local vs media time.** `applyMediaTimebase()` — a clean plate offsets
   by `startSec`, an export does not. Getting this wrong makes the editor look
   completely dead, not slightly off.
6. **The clean-source wait is a backstop, not a race.** A 2.5s watchdog once
   sat inside the real 2487–2571ms load spread, so clips fell back to their
   captioned export at random and showed two sets of captions.
7. **No dead controls.** A control that cannot reach an export must not be
   shown. `hookEnabled` is hard-disabled in `sanitiseTemplate()`.

---

## Verification standard

- `npm test` and `npm run check` must pass. Currently 324 JS + 120 Python.
- **Test executed output, not source strings.** Several tests have failed only
  because code moved into a function, while real behaviour changes passed.
- **A green suite is not verification for anything visual.** Every layout bug
  here shipped green.

---

## Deploys

- Branch `deenclipped-v2-2` auto-deploys the web service to Render on push.
- The worker is **manual**: on the Hetzner box (135.181.149.182),
  `cd /opt/deenclipped && git pull && docker compose -f worker/docker-compose.yml up -d --build`.
- Confirm a worker deploy with `docker exec worker-deenclipped-worker-1 ls /app/worker`
  and check for the file you expect. A clean build log does not prove the new
  code landed — Docker will happily rebuild an identical image from cache.

---

## Open items

- **YouTube API quota reply** is drafted in Gmail, unsent. Google asked for a
  recalculated quota breakdown; deadline ~20 Aug.
- **Render pipeline cannot cut or composite** — no `concat`, `trim`, `atrim` or
  `select`, and the only `overlay=` is the blur background. This blocks Media,
  AI Tools, Split, Trim, filler-word removal and silence removal. One
  dependency, not several separate gaps.
- **Worker P2 (framing) and P3 (Arabic)** are written and unit-tested but no
  one has ever looked at a rendered frame. See `WORKER-HANDOVER.md`.
