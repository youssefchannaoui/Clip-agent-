# DeenClipped — working agreement

## Ownership (set 16 Aug 2026, by Youssef)

**Claude owns everything, layout included.** The 12 Aug split that reserved
layout, CSS and visual design for ChatGPT was removed on 16 Aug: "you are now
doing everything ChatGPT does — it's all Claude."

| Area | Owner |
|---|---|
| Everything in this repo | **Claude** |

### The history that split existed for

Keep this. The ownership changed; the failure mode did not.

Claude repeatedly changed editor layout on 11–12 Aug and repeatedly got it
wrong — a preview sized against the wrong box, a timeline nested in the wrong
grid, a panel collapse that did not collapse, and a shell restructure that
left the editor visibly broken on the live site. Each attempt passed a green
test suite, because the failures were visual and the tests were not.

### What this means in practice

- **A green suite is never verification for anything visual.** Look at the
  screen — screenshot it, measure it — before calling a layout change done.
- Layout is now in scope, but it remains the work most likely to ship broken
  while tests stay green. Treat it with more caution than the systems code,
  not less.
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
   **Extended 21 Aug 2026 to the preview itself:** the clip editor plays the
   RENDERED clip (`/api/clips/:id/video?rv=…`) -- the same bytes the review
   queue plays -- with no CSS captions over it and no offset arithmetic. The
   old path (clean source + HTML/CSS captions + `edStartSec` subtraction) was
   a second rendering engine that could never agree with libass, and it is
   what "the preview looks nothing like the export" always meant. The clean
   source survives only when a render does not exist, and must stay labelled
   as the uncaptioned source. Never reintroduce a drawn imitation of a file
   that exists.
   **One deliberate exception (27 Aug 2026, widened same day by Youssef —
   "previews should just show"):** while an edit is UNSAVED, the drag ghost
   echoes the current block's words with the draft's GEOMETRY — size,
   tracking, line-height, case and alignment, sized by the same maths
   captionFaceStyle uses — but always in the ghost's own face and colour,
   with an "approximate · Save renders" label on the box. It returns to
   empty on Save (`edCapWords`/`edCapEchoStyle` in studio-adapter.js).
   Geometry may be claimed because the renderer computes it from the same
   numbers; face, colour and timing may NOT — that mismatch is the second
   rendering engine this invariant exists to prevent. Scripture is never
   echoed: an approximate ayah on screen is unacceptable (invariant 7).
5. **Clip-local vs media time.** `applyMediaTimebase()` — a clean plate offsets
   by `startSec`, an export does not. Getting this wrong makes the editor look
   completely dead, not slightly off.
6. **The clean-source wait is a backstop, not a race.** A 2.5s watchdog once
   sat inside the real 2487–2571ms load spread, so clips fell back to their
   captioned export at random and showed two sets of captions.
7. **Three scripts on every template except the Quran one** (set 22 Aug 2026
   by Youssef). Recited scripture becomes the ayah with its translation;
   other Arabic is captioned in Arabic with an English line under it, from
   Whisper's second (translate) pass; English captions as it always did. The
   Quran template captions scripture and NOTHING else -- an aside or a
   half-heard word in the lecture face under a verse is what made those clips
   look wrong.
8. **No dead controls.** A control that cannot reach an export must not be
   shown. `hookEnabled` is hard-disabled in `sanitiseTemplate()`.

---

## Verification standard

- `npm test` and `npm run check` must pass. Currently **734 JS + 384 Python**
  (7 Python skipped). Update these numbers when they change — they were wrong by
  more than a factor of two, which makes them useless as a tripwire.
- **The 7 skips are `SpeakerTrackingTests`**, which need a test video that is not
  in the repo. So the framing code is unexercised in CI *and*, per the open items
  below, has never been checked visually either. Treat it as untested.
- **Test executed output, not source strings.** Several tests have failed only
  because code moved into a function, while real behaviour changes passed.
- **A green suite is not verification for anything visual.** Every layout bug
  here shipped green.
- **Chrome will not run CSS animations in a hidden automation tab either.**
  An agent screenshot brings the tab forward, which is when the animations
  start -- so every capture lands a few frames into the entry animation and
  staggered content photographs as blank or ghosted. Twice this looked like a
  layout bug that was not there. Before capturing, settle them:
  `document.getAnimations().forEach(a => { if (a.effect.getTiming().iterations !== Infinity) a.finish() })`
  (skip the infinite ones -- `finish()` throws on those), then screenshot.
- **Chrome will not decode video in a hidden automation tab.** readyState stays
  0 even for a blob URL holding every byte, so "the preview is black" in an
  agent screenshot is usually the harness, not the app. Verify video paths by
  what the element is pointed at plus the file's own frames (ffmpeg), and say
  which one the evidence is.

---

## Rendering gotchas that cost real time

- **libass sizes text by win ascent+descent, not em** (VSFilter compat). Amiri
  reserves ~3.3x its em vertically for tashkeel, so at a nominal font size its
  glyphs render at ~30% of what DejaVu renders. `AYAH_SIZE_SCALE = 3.0` in
  clip_worker.py compensates; it looked like "the multiplier does nothing"
  until measured on a real frame, because 1.25x of 30% is still tiny.
- **"Amiri Quran" is worse, not better** — even taller metrics; frames came
  out at a quarter size. quran_font() deliberately prefers plain Amiri, which
  is mushaf naskh and draws U+06DD with the digits inside.
- **Only a rendered frame settles a caption question.** Every one of the above
  passed unit tests; two deploy cycles were spent on renders that "should"
  have been right. Frame-check via the clip's public R2 URL in a <video>.
- **The editor must never save what it only draws.** The caption blocks show
  the matched verse in place of Whisper's text, and Save rebuilt the transcript
  from what was drawn -- so opening a recitation clip and pressing Save
  replaced its transcript with the ayahs, each repeated once per block, and
  marked it edited. `process_rerender` honours that flag by collapsing the clip
  into one untimed segment, so every caption then drifted by up to four
  seconds. Blocks carry `sourceText` for saving, `store.isAyahEcho` refuses the
  echo server-side, and `reflow_segments` lays a genuine edit back over
  Whisper's boundaries instead of one flat span.
- **A re-render captions the STORED transcript, not fresh speech.**
  `process_rerender` rebuilds one segment holding the clip's whole transcript,
  so a recitation arrives as a 169-word passage. `Corpus.match()` scores an
  entire query against ONE ayah and therefore matched nothing, and the render
  fell through to plain wrapped captions -- every re-render silently stripped
  the medallion and translation off a Quran clip. `Corpus.match_sequence()`
  splits a passage back into ayat; it advances by the matched ayah's own word
  count, because advancing by the search window swallowed short verses.
  Any future caption feature must be tested on a re-render, not only on a
  first render -- they take different paths through `write_ass`.
- **The Hetzner console silently disconnects.** Keystrokes typed into a dead
  console echo as ghost text and never run — a pull+build was "done" twice
  without happening. Confirm a live prompt echo (type Return, see a fresh
  prompt) before every command batch, and verify `git pull` output names the
  expected commits.
- **The Hetzner console also strips SHIFT from symbol keys** (27 Aug 2026): a
  pipe arrives as a backslash, an underscore as a hyphen, `#` as 3, `*` as 8,
  `$` as 4. Anything beyond plain words typed into it is a hazard — one probe
  line left the shell inside an open backtick. Console commands must be
  letters, digits, dots, slashes, hyphens and spaces only: `git pull` then
  `bash worker/deploy.sh` (which exists for exactly this reason).
- **A caption complaint on a clip is not always our caption.** The "clipped
  typewriter captions" on the prism clip were the SOURCE video's own burned-in
  subtitles, cropped at both edges by the 16:9→9:16 crop — DeenClipped's own
  word-mode caption rendered correctly above them. A centred libass caption
  can never be cut mid-word at the LEFT edge; that shape means baked-in source
  text. Check a frame for it before touching write_ass.

## Security posture (audited 24 Aug 2026)

Six dimensions were audited with every finding put through a refutation pass;
twenty survived. What that audit found strong, and what must stay that way:

- **Tenant isolation** is enforced by making the record lookup itself
  owner-scoped, not by a check bolted on afterwards. Keep it that way: a route
  that fetches first and checks second is the shape of every IDOR.
- **Ollama is self-hosted**, so transcripts never leave the server. Any move to
  a hosted model changes what this product can promise about customer content.
- **There is no shell-out anywhere** in the pipeline. Keep it that way.

Habits the tests now enforce, and why:

- `script-src` must never take `'unsafe-inline'`. The policy allows the page's
  own inline block by sha256, computed at startup from the file, so editing the
  page updates the hash rather than silently breaking it -- and no served HTML
  may grow an inline event handler again. One of those was a reflected XSS.
- Revoking a credential must revoke its sessions. Deleting a squatter's
  password while leaving their session alive revoked nothing.
- A limiter that is not crossed by a route protects nothing: the throttle and
  the schedule-day parameter both had unit tests that passed while the route
  ignored them. Test over HTTP.
- Read the LAST `x-forwarded-for` entry. The first is caller-supplied.
- Password hashing runs async. Sync hashing on a pre-auth route stalls every
  other customer for the duration.

## Import path (switched 26 Aug 2026)

- **YouTube imports run through the box's own yt-dlp behind a rotating pool of
  Webshare static residential proxies** — `VIDEO_IMPORT_PROVIDER=ytdlp` and
  `VIDEO_IMPORT_PROXIES` (all 20 addresses, comma-separated) in `worker/.env`
  on the Hetzner box (credentials live only there, never in the repo).
  Measured on switch day: the 53-minute lecture SocialKit could not deliver in
  30+ minutes imported in 56s at 216 Mbit/s, full 1080p.
- **One exit is not enough.** The first single-IP setup was bot-walled within
  the hour of moving that 1.5GB — a burned exit reads as "Sign in to confirm
  you're not a bot" through a proxy that verified fine. Every download attempt
  now picks a random pool address, so retries land on a fresh exit; if the
  wall appears again, check how many pool IPs still pass before concluding
  the approach is dead.
- **SocialKit was removed on 26 Aug 2026** at Youssef's instruction (keys
  deleted from worker/.env; subscription to be cancelled). The chain is ytdlp
  only. The queue-time pre-warm and the app's one-shot import auto-retry are
  no-ops without a hosted provider but stay tested in case one returns.
- The Webshare plan is Static Residential, 20 IPs, 250GB/month. A full-quality
  lecture is ~1.5GB, so ~160 first-time imports/month fit; re-imports of a
  URL the box has seen use the worker's source cache, not bandwidth.
- **Only the selected stretch is downloaded (27 Aug 2026).** `yt-dlp` is given
  `download_ranges`, so picking three minutes of a 90-minute lecture costs
  three minutes of bandwidth instead of 1.5GB. Four things hold it together
  and each was a bug waiting to happen:
  1. **`copy_or_download` in clip_worker.py is NOT the production downloader.**
     `service.py` imports via `import_providers.py` and hands clip_worker a
     local path as `job["url"]`, so the yt-dlp code in clip_worker only runs
     for the local engine. A first attempt implemented all of this there and
     would have shipped a no-op.
  2. **A sectioned file must never be trimmed again.** It already starts at
     10:00; cutting it at 10:00 a second time renders the wrong moment with
     the right captions. `sourceAlreadyWindowed` travels on the job and
     suppresses both the main trim and `apply_source_window`.
  3. **The source cache is keyed by the window too.** It was keyed on the URL
     alone, which would have served one job's section to a job that asked for
     a different part of the same lecture. `sourceCacheKey` (which the
     transcript cache also hangs off) follows the bytes, not the URL.
  4. **Never claim a section the downloader did not confirm.** An extractor
     that ignores ranges returns the whole video; `windowed` is set from
     `info["section_start"]`, not from having asked. A failed section attempt
     falls back to a full download — saving bandwidth must never cost an import.
  No `force_keyframes_at_cuts`: it re-encodes the whole stretch for a
  frame-exact cut, and the ffmpeg trim it replaces was never frame-exact
  either (both land on the keyframe at or before the second asked for).

## Deploys

- Branch `deenclipped-v2-2` auto-deploys the web service to Render on push.
- **Rendered media is served from `media.deenclipped.online`** (custom domain
  on the R2 bucket `deenclipped-media-us`, bound 27 Aug 2026). The r2.dev
  public URL is a rate-limited dev endpoint -- it returned five straight GET
  503s in one editor session -- and must never be handed to a player again.
  `MEDIA_PUBLIC_BASE` on Render rewrites stored r2.dev URLs at the exits;
  `OBJECT_STORAGE_PUBLIC_URL` in worker/.env on the box stamps new uploads.
- The worker is **manual**: on the Hetzner box (135.181.149.182),
  `cd /opt/deenclipped && git pull && docker compose -f worker/docker-compose.yml up -d --build`.
- **Follow it with `docker builder prune -f`.** Each `--build` leaves its layer
  cache behind, and they accumulate invisibly: eight rebuilds in one session
  grew the cache to **25.7GB** and took the disk to 69%, which reads exactly
  like a box running out of room for customer data. Pruning took it back to
  35%. Check `df -h /` before concluding the box needs a bigger disk.
- Confirm a worker deploy with `docker exec worker-deenclipped-worker-1 ls /app/worker`
  and check for the file you expect. A clean build log does not prove the new
  code landed — Docker will happily rebuild an identical image from cache.

---

## The editor is gated for launch (27 Aug 2026, Youssef's call)

It opens from the queue and draws itself, blurred, behind a "coming soon"
notice. Youssef's words: "the editor for opening will be coming soon so they
can click and open editor then it's a blurred-ish background with a prompt
saying coming soon in the new update."

- It is `src/public/studio-editor-gate.css` + `src/public/editor-gate.js`,
  linked from `index.html` and allowlisted in `server.js`. **Shipping the
  editor is deleting those two files and their two lines** — nothing was added
  to the design export, so no re-import and no regenerated class names.
- **Blur is not a lock.** `pointer-events: none` stops the mouse; only `inert`
  stops tabbing, and a Save button that can be tabbed to writes an edit onto a
  clip nobody meant to edit. The gate sets both, re-applying after every render.
- Two things contradicted the gate and are silenced while it is up: the
  `#edBetaPop` first-run popup ("your edits save the moment you make them")
  and the topbar's beta subtitle. Both come back with the editor.
- The phone rule in `studio-responsive.css` hides every child of the editor.
  The notice is a child, so it carries `:not(#dcEditorSoon)` — without it the
  phone gets a blank screen.

## Open items

- **YouTube API quota reply** is drafted in Gmail, unsent. Google asked for a
  recalculated quota breakdown; deadline ~20 Aug.
- **Render pipeline learned to cut on 26 Aug 2026 (v3.2.0)** — a candidate can
  carry KEEP ranges (`clip.cutsSec`, clip-local, via re-render), rendered as a
  pre-cut trim/concat plate that the untouched pipeline then treats as an
  ordinary source; captions are retimed word-by-word (`retime_for_cuts`).
  Split/Trim/silence-removal UI is NOT yet wired — controls stay hidden per
  invariant 8 until they can reach this. Compositing beyond the blur
  background (overlays, Media, AI Tools) remains absent.
- **Worker P2 (framing) and P3 (Arabic)** are written and unit-tested but no
  one has ever looked at a rendered frame. See `WORKER-HANDOVER.md`.
- **Speaker framing was inert in production until 17 Aug**, not merely
  unverified. `opencv-python-headless` had no upper bound, pip resolved 5.0.0,
  and OpenCV 5 removed `cv2.CascadeClassifier` — so every job fell back to a
  centre crop. It is pinned `<5.0.0` now and `verify-deploy.sh` fails on it.
  Nothing has yet confirmed framing works *with* a 4.x image; that still needs
  a real job and a look at the frame.
