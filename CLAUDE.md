# DeenClipped — working agreement

## Ownership (split again 31 Aug 2026, by Youssef — then overridden same day)

**OVERRIDDEN for the public-site rebuild, 31 Aug 2026, by Youssef's direct
instruction:** "my direct instruction overrides only the public-site ownership
restriction … ChatGPT/Codex is stood down from the marketing website and will
not touch src/marketing.js, src/public/marketing.css, associated marketing
assets, public routes, or the shared visual system while you work." Claude
rebuilt the entire public visual system at v3.63.0 (see *The public site was
rebuilt as a cinematic scroll story* below). Until Youssef says otherwise,
Claude owns the marketing surfaces too; the split below is kept as history.

**ChatGPT is working on the MAIN WEBSITE. Claude owns the dashboard and
everything else.** Youssef, 31 Aug: "i have chat gpt working on the design for
my main website".

| Area | Owner |
|---|---|
| The public marketing site — the look of `deenclipped.online` | **ChatGPT** |
| The dashboard / app (`/app`, the studio, the Owner screen) | **Claude** |
| Everything else — worker, billing, auth, SEO structure, tests | **Claude** |

This is a split by SURFACE, not by file, and the two overlap: `src/marketing.js`
and `src/public/marketing.css` render the public site AND carry SEO structure
Claude owns. Both agents edit them. That is workable and has been worked —
three times on 30–31 Aug — but only because of the rule below.

**What each side must not do:**

- ChatGPT redesigning a page must not remove a registered page, orphan one,
  drop a canonical, or invent a testimonial. It will not get that far: the
  tests fail first. Its 30 Aug redesign (v3.50.0) was checked against the SEO
  work afterwards and broke nothing — schema clean, no orphans, contextual
  links intact, and its three new images inherited the width/height stamp
  automatically because that is computed from the files rather than typed.
- Claude must not restyle the public site. Structure, copy and metadata are
  Claude's; how it LOOKS is not.

**Whoever edits `src/` bumps `package.json` in the SAME commit.** Not a style
preference -- `scripts/check-version-bump.mjs` fails the run otherwise, and on
30 Aug two consecutive ChatGPT commits (`b31a510`, `02acde9`) left the branch
RED for forty minutes on exactly this. Nothing was wrong with the code; the
tests passed. It cleared only because the next Claude commit bumped the version
on top of it. A phone session that cannot trust the tick has no way to check
anything, so a red branch is worse than no branch -- and a red run whose cause
is a missing bump looks identical, at a glance, to a real failure.

**Do not run both agents in the same minute.** Not a policy, a mechanical
constraint: on 30–31 Aug Claude twice went to push and found ChatGPT's work
already on the branch, and had to rebase and resolve by hand. Each hand-merge
is a chance to silently undo the other side's change, which has happened on
this repo before (see below). Nothing was lost this time; that was checking,
not luck, and it does not scale.

### The earlier history, kept because the failure mode has not changed

The 12 Aug split reserved layout, CSS and visual design for ChatGPT. It was
removed on 16 Aug — "you are now doing everything ChatGPT does — it's all
Claude" — and has now returned in the narrower form above.

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
   **Extended 28 Aug 2026: auto-detect means BOTH, switching per segment.**
   Whisper's default detects one language from the opening seconds and applies
   it to the whole lecture, so an English talk containing recitation had its
   Arabic transcribed as Latin nonsense -- and after that nothing downstream
   could tell it was Arabic, because it was not: no Arabic face, no ayah match,
   no translation line. With no language chosen the first pass now runs
   `multilingual=True`, and the translate pass fires whenever any Arabic was
   actually transcribed rather than only when the whole file was detected as
   non-English. Choosing a language still pins it, exactly as before. An older
   faster-whisper that rejects the flag falls back rather than failing the job.
8. **A caption line that can overflow carries `{\q0}`.** `WrapStyle: 2` breaks
   only where the text says to, so any line built by word count rather than
   glyph width can run off both edges -- seen on real frames FIVE times now
   (phrase captions, spoken-Arabic lines, the ayah translation, and -- found
   29 Aug 2026 by measuring rather than by a complaint -- word and karaoke
   modes). All five carry the override; anything new that emits a Dialogue
   line must too.
   **Word mode was the worst of them and looked like a timing bug.** The group
   is `captionMaxWords` words long, default SIX, and at font 62 an ordinary
   line ("Indeed the prayer prevents immorality and") spanned x 0..985 with 10
   rows cut at the left edge -- so the highlighted first word was off the frame
   entirely. Word mode redraws the SAME group once per word, so that is every
   frame of the group, and the symptom reads as "the highlight is out of sync"
   when the timing is in fact exact. `{\q0}` took it to x 254..989, zero cut
   rows, and left every line that already fitted byte-identical.
   **The two stack modes are deliberately NOT given the override, and do not
   need it.** They place each line at an explicit `\pos`, so a wrap there would
   collide with the line below rather than fix anything -- but they already
   break by WIDTH, not by count: `too_wide()` in the stack builder estimates
   0.46 em per character against the usable width and is deliberately
   pessimistic (rendered lines measure nearer 0.33), so it breaks sooner than
   it must. Measured 29 Aug 2026 on real frames, four deliberately long lines
   including single 30-character words, both modes: ZERO rows cut at either
   edge. An earlier note here called that line-breaking "unwritten"; that was
   wrong, and this corrects it.
9. **No dead controls.** A control that cannot reach an export must not be
   shown. `hookEnabled` is hard-disabled in `sanitiseTemplate()`.

---

## Verification standard

- `npm test` and `npm run check` must pass. Currently **1426 JS + 662 Python**
  (8 Python skipped) — the skips are where ffmpeg is absent, which is CI.
  These numbers were once wrong by more than a factor of
  two, which made them worse than absent — they still read as authoritative.
  **CI now enforces them** (`scripts/check-handover.mjs`, fed the real test
  output), so this line cannot quietly drift again; a shrinking count is
  reported as tests having VANISHED rather than as a number to update.
  **COUNT THE SUITE THE WAY CI COUNTS IT, NOT THE WAY YOUR SHELL DOES.**
  A bare `node --test` scans the WHOLE WORKING TREE, and `scratchpad/` is
  gitignored -- so a stray probe named `*-test.mjs` left lying there is counted
  locally and does not exist in CI. That is how the v3.126.0 line came to say
  1445 against a real 1444: one throwaway file of my own. It never showed up as
  a failure, it showed up as a number one too high -- which `check-handover`
  then reads on the runner as a test having VANISHED, and the branch goes red
  for a file CI has never seen. Before writing a count, check nothing under
  `scratchpad/` matches node's test patterns (`*.test.*`, `*-test.*`,
  `*_test.*`, `test-*.*`, or anything inside a directory called `test`).
- **The 8 skips are `SpeakerTrackingTests` (7) and `AtmosphereFrameTests` (1),
  and they skip ONLY where ffmpeg is absent** (v3.101.2, v3.118.0). They build their own fixture with ffmpeg and run
  wherever it exists -- all seven pass here in 0.9s -- but the CI runner has
  no working ffmpeg, so there they skip, counted as seven skips with the
  reason in each. The crop ARITHMETIC is therefore exercised by anyone running
  the suite with ffmpeg installed, and NOT by CI; face DETECTION on a real
  face is still untested anywhere -- see the open items below.
- **Test executed output, not source strings.** Several tests have failed only
  because code moved into a function, while real behaviour changes passed.
- **A green suite is not verification for anything visual.** Every layout bug
  here shipped green.
- **ALIGNMENT IS MEASURED, NEVER EYEBALLED** (Youssef, 3 Sept 2026: "not
  everything is aligned, like, the ticks and stuff like that ... every time
  you're always doing layout work and etcetera, everything must be centered,
  aligned, correctly done, and matching the dashboard"). Before calling any
  layout work done, read the rectangles and print the numbers:
    * every icon/tick/chip's vertical centre against the centre of the TEXT it
      belongs to, not against its row -- a row with three lines in it centres
      nothing usefully;
    * the left edge of each column across every row, as a SET: more than one
      value is a ragged column;
    * the right edge of every trailing chip, and its WIDTH -- equal right edges
      with unequal widths still leaves ragged left edges;
    * the content's left edge against the panel or dialog HEADER above it;
    * row heights, which should differ only where the content genuinely does.
  Do it at 1440, at a narrow desktop width, and on the phone, in both themes.
- **Centre by geometry, never by a margin.** A `margin-top: 1px` nudge measures
  right on the day and drifts the moment a font size, a line-height or a
  padding moves. Give the icon and the text line the SAME height from one
  shared token and let them start at the same y: then their centres coincide by
  construction. The task panel's `--dctk-line` is the worked example, and
  `test/task-ladder.test.mjs` fails if a nudge reappears.
- **Whole-pixel leading.** `line-height: 1.45` at 11px is 15.95px, and those
  fractions accumulate down a list until a row lands on a half pixel -- which
  is where the task panel's last 1px of misalignment came from. Give list text
  an integral line height.
- **A badge inside a heading inherits the heading's leading.** The "Now" chip
  had 22px of inherited line-height plus its own padding, so its line box came
  out 24px and made the one row carrying it 2px taller than its siblings. Any
  inline badge needs its own `line-height` and a height under the line it sits
  in.
- **Chrome will not run CSS animations in a hidden automation tab either.**
  An agent screenshot brings the tab forward, which is when the animations
  start -- so every capture lands a few frames into the entry animation and
  staggered content photographs as blank or ghosted. Twice this looked like a
  layout bug that was not there. Before capturing, settle them:
  `document.getAnimations().forEach(a => { if (a.effect.getTiming().iterations !== Infinity) a.finish() })`
  (skip the infinite ones -- `finish()` throws on those), then screenshot.
- **A caption question CAN be settled without the box.** `apt-get install -y
  ffmpeg` gives a build with libass, and that is the whole rig: call the real
  `write_ass`/`ayah_events`, render one frame over black
  (`ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=6 -vf "subtitles=x.ass" ...`,
  seeking PAST the fade -- at t=0 every event is fully transparent and the
  frame comes out empty), then measure the ink by decoding the PNG to gray8
  and scanning rows for the leftmost and rightmost lit pixel. That is how the
  overflow fix was proven: unfixed, ink spanned x 0..1079 with 114 rows
  touching an edge; fixed, x 185..915 and zero.
  **CHECK `fc-list` RATHER THAN ASSUMING THE FACE.** This line used to state
  flatly that Amiri and Outfit are not in a fresh container and the substituted
  face is WIDER -- which makes a passing wrap test conservative rather than
  optimistic, and is still true where they are absent. But on 3 Sept 2026 the
  agent container had **Amiri, Amiri Quran and KFGQPC HAFS Uthmanic Script all
  installed**, and the ayah-racing fix below was proven on frames that rendered
  in real Amiri, medallion and tashkeel and all. Run
  `fc-list : family | tr ',' '\n' | sort -u` first, and say which face
  rendered -- an assumed substitution is as misleading as an assumed match.
  **A COMPARISON NEEDS THE OLD CODE, NOT THE OLD ARGUMENTS.**
  `git show <sha>:worker/clip_worker.py > old_worker.py` and load it beside the
  current one under a different module name; then the "before" frames are the
  code that actually shipped. The first attempt here built its "before" by
  withholding the new arguments, and the new code simply defaulted them and
  produced the FIXED output -- a before/after where both halves were after.
- **`node --test` starts the tests it already has at the module's FIRST
  `await`.** So in a test file with top-level await, a server imported BELOW
  the `test()` declarations comes up, the earlier tests run, the file's
  `after` hook fires and closes it -- and the route test fails with a bare
  "fetch failed" against a socket that was open a moment earlier. Import the
  server and run the readiness loop ABOVE every test. Also set `PORT` before
  the first import of anything that pulls in `config.js`: it reads the port
  once, so a PORT set later leaves the server on 3000 and the symptom is
  identical.
- **Chrome will not decode video in a hidden automation tab.** readyState stays
  0 even for a blob URL holding every byte, so "the preview is black" in an
  agent screenshot is usually the harness, not the app. Verify video paths by
  what the element is pointed at plus the file's own frames (ffmpeg), and say
  which one the evidence is.

---

## Rendering gotchas that cost real time

- **libass sizes text by win ascent+descent, not em** (VSFilter compat). Amiri
  reserves ~3.3x its em vertically for tashkeel, so at a nominal font size its
  glyphs render at ~30% of what DejaVu renders. `AYAH_SIZE_SCALE` in
  clip_worker.py compensates (3.54 today; the nominal size is now computed per
  face from `AYAH_FONT_CELL`, so each face lands on the same VISUAL size); it looked like "the multiplier does nothing"
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
  **Proven on the box, 28 Aug 2026, not merely tested.** A live download of a
  1579s lecture: 120.0s asked for, 120.0s delivered, 66.7MB instead of ~878MB.
  Two 8s windows at 300s and 1200s came back 8.01s and 8.02s with DIFFERENT
  first frames, which is what proves the start offset is applied rather than
  silently ignored. **yt-dlp returns NO `section_start` or `section_end` on a
  successful section** — reading them, as the first version did, called every
  honoured range a full download, and clip_worker would then have trimmed the
  already-trimmed file again and cut a 120s source to ONE SECOND. Detection
  comes from the range callback having run; clip_worker still checks the claim
  against the file's measured length and falls back to trimming if it is more
  than 30s longer than the window.

## Deploys

- Branch `deenclipped-v2-2` auto-deploys the web service to Render on push.
- **Every push takes the site down for about 35-40 seconds, and that is not a
  fault.** The service mounts a 10GB disk at `/app/data`, so Render cannot run
  the old and new instances side by side -- it stops one before starting the
  other. Measured 3 Sept 2026: "Deploying..." 03:18:11, listening 03:18:47,
  live 03:18:55, with a plain 502 in between. A 502 within a minute of a push
  is the swap, not a crash; check `list_deploys` and the app log before
  treating it as one. It also means a DOCS-ONLY push costs the same outage as
  a code one, and that a credential change on Render costs it too -- so do not
  push during a posting window.
- **Rendered media is served from `media.deenclipped.online`** (custom domain
  on the R2 bucket `deenclipped-media-us`, bound 27 Aug 2026). The r2.dev
  public URL is a rate-limited dev endpoint -- it returned five straight GET
  503s in one editor session -- and must never be handed to a player again.
  `MEDIA_PUBLIC_BASE` on Render rewrites stored r2.dev URLs at the exits;
  `OBJECT_STORAGE_PUBLIC_URL` in worker/.env on the box stamps new uploads.
- The worker is **manual**, but no longer console-only. The box takes SSH:
  `ssh -i ~/.ssh/deenclipped_worker root@135.181.149.182`, then
  `cd /opt/deenclipped && git pull && bash worker/deploy.sh`. **The key is
  `deenclipped_worker`** — the similarly named `~/.ssh/deenclipped` beside it
  is rejected by the box, which reads as "SSH is not set up" if you stop at the
  first Permission denied. Running an agent's shell on the box needs a Bash
  permission rule the operator adds; it cannot be self-granted, and should not
  be.
- Verified 28 Aug 2026: the box had been sitting on `72fea1a` — every worker
  change since v3.3.x, including the section downloads, had been committed,
  pushed, green and not running. Check `git log --oneline -1` on the box before
  assuming a worker behaviour exists in production.
- **The deploy is a workflow now (v3.27.0), not only a console.**
  `.github/workflows/deploy-worker.yml` pulls, rebuilds and verifies the box
  over SSH: automatically on any push to `deenclipped-v2-2` that touches
  `worker/`, and on `workflow_dispatch` — which means an agent that cannot SSH
  can still deploy, by dispatching the workflow. It **proves** the landing the
  way this file has always demanded: it reads `package.json` out of the RUNNING
  container (`docker exec … worker-deenclipped-worker-1`) and fails the run if
  that version is not this commit's.
  **IT IS ARMED, AND THE WORKER DEPLOY IS NO LONGER MANUAL** (verified against
  the run history on 31 Aug 2026 — this section said the opposite for two days
  after it stopped being true, and a stale "not live" note is exactly what made
  the box sit on old code for weeks in the first place).
  Runs 1–6 failed at the credential step, which is the unarmed behaviour
  described below; **runs 7–21 all succeeded**, and every one since run 9 was
  triggered by a `push` rather than a dispatch. So a `worker/**` change now
  deploys itself, and nobody has to remember.
  The credential is one repository secret — Settings → Secrets and variables →
  Actions — either **`WORKER_SSH_KEY`** (the whole of `~/.ssh/deenclipped_worker`
  from the Mac, preferred and wins when both are set) or
  **`WORKER_SSH_PASSWORD`**, the one a PHONE session can arm.
  (`WORKER_HOST`/`WORKER_USER` optional.) With neither, the run fails at the
  first step and says so rather than reporting green having done nothing.
  **A green run is real proof**: step 6, "Prove the running container holds
  this commit", reads `package.json` out of the RUNNING container over SSH and
  fails the run unless it equals the commit's version. Run 21 printed
  *"Deployed and verified: the running worker is v3.59.1."*
  **So "is the box behind?" is answered by two commands, not by guessing:**
  the newest successful `deploy-worker.yml` run names the commit on the box,
  and `git log --oneline <that sha>..HEAD -- worker/` says whether anything has
  changed since. Empty means the box is current, whatever the app version is.
  The push trigger watches `worker/**` only, deliberately: editing the deploy
  script changes how a deploy runs, not what is running on the box, so it must
  not manufacture a red run of its own.
- **The app now says this itself (v3.26.0).** The worker reports its release in
  `/health` (`worker_version()` in service.py) and `/api/owner/health` compares
  it with `config.appVersion`; **Owner → Health → Deployed** shows the running
  version and, when it differs, "Worker changes since then are not live". A
  worker too old to report a version reads as behind, which is the honest
  answer — that is exactly what a box predating this build is. Nobody has to
  remember to check any more, but the deploy itself is still manual.
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

**Un-gated in v3.78.0 and RE-GATED in v3.78.3, both on 2 Sept 2026.** The
"fix all" pass on the week-one gaps shipped the editor with section cuts;
Youssef then said "just keep editor as coming soon", so the gate is back
exactly as it was -- link, script, allowlist, phone-rule exemption, the eight
tests -- and every public sentence says coming soon again. The section-cut
controls (v3.78.0, below) stay BUILT behind the blur: shipping the editor is
still deleting the two files and their two lines, and the cuts come with it.

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

## What is allowed to re-render, and what an approval means (v3.20.0)

Youssef, 28 Aug 2026: "why is it rerendering when i approve? ... ONLY IF
TEMPLATE WAS CHANGED AND SAVED WHILE NOT APPROVED ALL CLIPS RE RENDER, OTHER
THAN THAT IT SHOULD NEVER RE RENDER."

- **Clips render at full quality from the first render.** The review copy used
  to be a quarter-resolution draft that approve promoted to 1080x1920, so
  approving visibly started a job on a single-slot worker. What the queue plays
  is now the file that posts. For any clip that gets approved this is LESS
  total work, not more -- one final render instead of a draft plus a final.
  Only an editor preview window is still a draft.
  A clip rendered before this change still holds a draft and still gets its one
  promotion on approve (`renderQuality === 'draft'` in `approveClip`); nothing
  new can enter that state.
- **A template save re-renders only clips still `waiting`.** Approved,
  scheduled and posted clips keep the render they were signed off on. The sweep
  used to take everything unposted.
- **An approval survives a scheduling failure.** `tick()` used to push the clip
  back to `waiting` and null the approval when `scheduleApprovedClip` threw
  (usually: publishing on, no destination enabled), so the button looked broken
  and the reason went to a log. The decision now stands, `clip.scheduleError`
  carries the reason, and the review card prints it.
- **Approving twice is an answer, not an error.** A second tap on a stale card
  returns the clip; only `rejected` and genuinely unrendered states refuse, and
  they say which state they are in.
- **Cancelling gives the worker slot back immediately.** A remote run held its
  slot until the WORKER agreed the job was over, so a cancel it never confirmed
  kept the only slot for minutes and the next upload sat on "Next in line" with
  nothing in front of it. `cancelProject` now drops the run from `running`, the
  poll loop exits when the app has cancelled, `acceptRemoteUpdate` refuses to
  revive a cancelled project, and every cancel path kicks `pump()`.
- **A clip that posted anywhere is `posted`.** One destination refusing used to
  file the whole clip as `publish_failed`: a clip live on YouTube read as
  unposted, sat in the schedule as work, and offered "Post now", which re-ran
  the destination that had already refused. The failure now belongs to the
  destination -- the row says "Retry TikTok" and retries only that leg.
  **The rule reached new clips only, and that was missed for a day (v3.29.1).**
  `refreshPublishingStatus` runs when a publish attempt FINISHES, so every clip
  filed before it kept its old shape: four clips live on YouTube still sat under
  "4 posts missed their slots" with a Post now button that would have posted
  them to YouTube a second time. Both symptoms hang off one field -- the overdue
  filter is `!c.postedAt` and so is the Retry-vs-Post-now label -- so healing
  `postedAt` fixes both. `healPartialPublishes()` runs once at boot over
  FINISHED clips only (every target terminal, at least one posted, still filed
  unposted); anything still publishing is left alone. A behaviour change that
  only applies going forward should always be asked of the rows already on
  disk.

## A purchase must land even when the webhook does not (v3.39.0, 30 Aug 2026)

The webhook was not a safety net, it was the ONLY net. A plan was granted by
`checkout.session.completed` and made real by `customer.subscription.*`, so a
signing secret that does not match -- exactly what has been alerting on this
deployment since 29 Aug -- meant a customer paid Stripe successfully and their
account stayed on free. They saw the charge and nothing else. That is the
worst failure this product can have and it was one environment variable away
at all times.

- **The second net reads from a different credential.** `confirmCheckoutSession`
  fetches the session with the SECRET KEY, which has demonstrably been working
  throughout (checkout sessions are being created with it). The signing secret
  and the API key are independent, so the net does not share the failure.
  Stripe's own guidance is to fulfil on both the return and the webhook.
- **Both nets converge on the same two functions**, `grantTopup` and
  `updateFromSubscription`, so there is one place that grants a plan and one
  that grants tokens. Both already refused to act twice -- `grantTopup` dedupes
  on the session id, `recordRevenue` on the Stripe object id -- which is what
  makes this safe: fixing the secret redelivers ~3 days of events and none of
  them double-grants. A test drives exactly that order.
- **Fetching first was unavoidable, so the ownership check is explicit.** Only
  Stripe knows whose session an id names, and the id travels in a query string.
  `metadata.userId` must match the signed-in account, or (for a session made
  before the creators stamped it) the customer id stored on the account. Refuses
  by default. The id is also shape-checked before the network call is spent.
- **A trial is `no_payment_required`, not `paid`.** Accepting only 'paid' would
  have stranded every trial started while the webhook was down.
- **The customer is made whole immediately; the BOOKS catch up on redelivery.**
  Subscription revenue is recorded from `invoice.paid`, which this path does not
  forge -- inventing an invoice would double-count against the real one when it
  arrives. Top-up revenue IS recorded here, because it dedupes on the session id.
- The subscription `success_url` carries `session_id` now. It always did for
  top-ups, and nothing read it.


## Alerts must survive a restart (v3.27.0, 29 Aug 2026)

Youssef, on a run of billing alarms: "Getting a lot of these emails."

- **The open-condition ledger was an in-memory `Map`.** Render restarts the
  service on every deploy, so it came back empty and the next failing check read
  as a brand new condition -- another "this is the first notice", every deploy,
  for a webhook secret that had never stopped being wrong. Eight deploys in one
  day is eight first notices. It lives in `state.alertsOpen` now, so `since` and
  `lastSent` outlive a restart and the 12-hour promise the mail makes is true.
  An alert channel that cries wolf is one nobody reads, and then the real one
  is missed too -- which is the entire reason `alerts.js` exists.
- **A row read back from JSON has whatever numbers were on disk.** A row written
  by an older build has no `since`/`lastSent`, and `Date.now() - undefined` is
  NaN, which compares FALSE against the window -- so the naive read would have
  sent on every single delivery Stripe retried. Both fields are coerced on read,
  failing towards sending once rather than towards sending always.
- **The underlying billing failure was NOT ours.** "Invalid Stripe signature"
  means the HMAC did not match with a well-formed, in-window timestamp: the
  signing secret on Render is not the one belonging to that endpoint. Note the
  three distinct messages in `verifyStripeSignature` -- Missing / Expired /
  Invalid -- they narrow it before anyone opens a dashboard.
- **`STRIPE_WEBHOOK_SECRET` is trimmed now**, as is `STRIPE_SECRET_KEY`. A
  credential pasted into Render's variable field picks up a trailing newline
  routinely, and the resulting failure is indistinguishable from the wrong
  secret entirely. The alert now carries `webhookSecretNote()`: length, whether
  it begins `whsec_`, and whether it had whitespace -- never the value, because
  an alert mail is not a secure channel.
- Stripe retries for ~3 days, so fixing the secret inside that window redelivers
  everything missed. Nothing is lost unless a delivery ages out.

## Posting: the app is not the limit, the platform reviews are (28 Aug 2026)

Two "bugs" reported together turned out to be one app bug each plus one
platform rule each. Keep them apart when triaging the next report.

- **YouTube uploads arrived private.** Fixed twice. The app used to default
  `youtube.privacy` to `private` with no control to change it; a panel was
  added, and then **the whole idea was removed on 28 Aug** at Youssef's
  instruction ("IT MUST BE PUBLIC STRAIGHAWAY no settings to chnage"). The
  upload now names `privacyStatus: 'public'` itself, `publishingSettings()`
  rewrites any stored value to `public` on read, and the connections dialog has
  no privacy control at all. **Google can still file an upload as private on its
  own**, whatever the request asks for — the dialog still says so in one line
  and names YouTube Studio as the fix, because without it a private video reads
  as the app ignoring the instruction. It no longer blames the COMPLIANCE
  AUDIT, which closed on 28 Aug 2026 (open item 1): copy that explains a live
  limitation by a finished process is the stale-claim failure this file keeps
  paying for. Whether uploads now actually arrive public is UNVERIFIED — one
  real post settles it, and the copy promises nothing until then.
  `test/posting-visibility.test.mjs` pins both halves: the warning must stay,
  and it must not name the closed review. **TikTok is the one
  exception and must stay one:** its content-sharing guidelines require the
  creator to choose a privacy level themselves with nothing preselected, so
  that panel remains, and removing it would fail the very review that is
  blocking TikTok posting.
- **TikTok returned 403 with a link to the content-sharing guidelines.**
  TikTok refuses in two parts: a `code` that says which rule, and a `message`
  that is often only that link. `jsonRequest` preferred the message, so the
  code was dropped and the error was undiagnosable. `platformDetail()` now
  keeps the code and translates the known ones. The likeliest cause of this
  particular 403 is `unaudited_client_can_only_post_to_private_accounts`: an
  app TikTok has not reviewed may only post to a TikTok account that is itself
  private. See `TIKTOK-SUBMISSION.md` — the demo recording and submission are
  still outstanding.
- **The schedule showed `targets[0]` and stopped.** A clip going to three
  places said "YouTube", and a clip whose TikTok post failed while YouTube
  went out looked entirely fine on the row. Every destination is now listed
  with its own state and colour (`destinations()` in studio-adapter.js,
  `post.dests` in the design). On a phone the account name is dropped
  (`[data-dc-dest-account]`) — platform and outcome are what carry the meaning
  — and the card wraps its actions onto their own line.

## New vs returning, and hover everywhere (v3.28.0, 29 Aug 2026)

Youssef: "idk if theres new users? like people who never opned ... ALL HOVERING
EFFECTS ON ALL GRAPHICS AND ETC".

- **"Has this browser ever been here?" could not be answered from what was
  stored, and that was deliberate.** The visitor id is salted with a DAY salt,
  so yesterday's visitor is unrecognisable today -- the privacy property, not
  an oversight. Widening the salt to find returners would have traded it away.
  So the answer lives in the visitor's own browser instead: `dc_seen=1`,
  HttpOnly, SameSite=Lax, two years, **a bare 1 with no identifier in it**. The
  server still keeps no address, no user agent and no cross-day id, and a test
  asserts that against the state bytes.
- The cookie is **appended**, never assigned. A bare `setHeader('Set-Cookie')`
  there would drop the session cookie on any response that sets one, and
  silently signing people out to count them is not a trade worth making.
- **A bot is never marked.** Marking one would make the next real visitor from
  that address read as returning.
- New/returning only exist from this deploy, so earlier days are zero on both.
  The tile note says "not counted before this release" rather than showing a
  bare 0 that reads as nobody arriving, and the returning RATE is of visitors
  we could classify -- not of all uniques, which would drag it to zero.
- **Hover is CSS on classes the template already emits**, so no design
  re-import and no regenerated class names. The chart columns had nothing at
  all: now the hovered bar widens (measured 33.9px -> 64.3px) and warms while
  its neighbours drop to 50% opacity. Rows carry both `.dcow-hov` AND a bare
  `tbody tr` rule, because the Traffic tables have no such class and "all
  hovering effects" must not depend on remembering to add one.
- Values still come from the native `title` on each bar. A styled tooltip would
  need `data-tip` in the markup, which means the design export and regenerated
  class names -- deliberately not done for this.

## The rail's bottom, and a tooltip without a re-import (v3.29.0, 29 Aug 2026)

Youssef: "bottom left remove that ugly silloeut and that rnadom tab or make it
the collpas ebutton instead the top one".

- **The mihrab lattice is GONE.** It was one of the three banner devices carried
  in at v3.25.0; the hairline rule and the spaced STUDIO subtitle stay, this one
  did not earn its place. `railMotifStyle` is kept as an empty binding because
  the template still names it -- a missing binding is a render error.
- **The "random tab" was an EMPTY BOX.** The rail's footer card paints its
  border, background and padding with nothing inside it, leaving a 203x24
  rectangle under the nav that looks like a control that does nothing.
  `#dcRail > div:empty { display: none }` in studio-tokens.css: the card returns
  the moment it has something to say, and fixing it in the design export would
  have regenerated every class name in the app for one blank div.
- **The collapse button moved to the bottom of the rail**, absolutely positioned
  against it (the rail is already `position: relative`), so it stays centred at
  228px open and 68px collapsed without the template moving. Verified with a
  real mouse click, not a scripted one: 228 -> 68 and back.
  **Restyled v3.37.1** ("improve that collpas ebutton looks dumb"): a 26px
  bordered square floating in the rail's empty lower half read as a stray
  artefact rather than a control. It is the rail's last ROW now -- same padding,
  radius, gap and hover as a nav item, one shade quieter, with the word
  "Collapse" beside the caret when there is room, and a hairline above it drawn
  as a `::before` in studio-tokens.css rather than another element in the
  export. Still absolutely positioned, so the nav above it does not move.
  The caret is deliberately the SAME glyph as before: it is the one seen
  rendering in the live app, and `ph-seedling` already cost a release by being
  a name that reads fine and draws nothing.
- **A dialog scrim will block any click test.** The first-run tour lays a
  `position: fixed; inset: 0; z-index: 200` span over the whole viewport, and
  Playwright then reports the button as covered -- which reads as a broken
  control and is not one. Dismiss the tour before testing clicks. Two separate
  investigations here were spent on that before it was recognised.
- **The chart tooltip is styled now, and it cost no re-import.** The bars carry
  their numbers in a `title`; the host moves that to `data-tip` on first hover
  and draws its own card (`#dcowTip` in index.html), clamped to the viewport so
  a bar at either end still shows on screen. Putting `data-tip` in the markup
  would have meant regenerating every class name for one attribute.
- **A funnel step may legitimately exceed 100%** -- `checkout_started` is not
  gated on signing up in the same window, so someone who signed up last month
  and checks out today counts in the numerator only. "6000% of signups" is true
  and reads as broken, so past 100 the step says "more checkouts than signups
  this window" instead. Capping it would have hidden real data.

## A publish failure is not an import failure (v3.30.0, 29 Aug 2026)

Youssef, on the failure dialog: "shoul dbe more infromation depeidng on the
error all ate the same this was never updated".

- **One table was answering two different questions.** Every entry in `EXPLAIN`
  is about getting a lecture IN -- download refusals, the clipping service,
  disk, tokens -- and `explainFailure` matched on the error TEXT alone. So
  `/403|forbidden/` caught TikTok's publish refusal and answered it with
  "Download the video yourself and use Upload MP4 or MOV": advice about
  fetching a video that had already been made, rendered and approved.
- `EXPLAIN_PUBLISH` is consulted FIRST for any row that names a destination
  (`row.provider`, or text starting "Publish failed"), so an import guide can
  never answer a publish question again. Seven entries: TikTok's unaudited-app
  refusal, rate limits, daily upload caps, expired connections, duplicates,
  size/length rejections, and rights/policy flags.
- **The generic publish answer still beats the old one**: it names the
  destination, says the clip is rendered and fine, and points at Connections --
  rather than sending someone to re-download a lecture.
- `explainFailure` is exposed on `StudioAdapter` so the guidance is tested by
  CALLING it. Asserting that a table contains a regex proves nothing about
  which entry WINS, and a wrong winner was the entire bug.

## The review deck reviews with the eyes and the keyboard (v3.31.0, 29 Aug 2026)

Youssef, on the queue: "improve this, add cool features expand and wow me".

- **The deck plays the RENDERED clip in place** -- the same bytes that post,
  invariant 4 applied to the queue. The reviewer was deciding on a still frame
  with a title drawn over it; pacing, caption timing and sound are the things
  being judged, and a still shows none of them. The host mounts the video from
  the card's `data-clip` attribute (`paintDeckVideo` in index.html); while a
  render exists the card stops drawing the title over it -- the render carries
  its own captions, and painting more words on top is the second-rendering-
  engine mistake by another door. The title moves below the card. A clip with
  no render keeps the old thumbnail-and-text card.
- **Muted autoplay, deliberately.** The deck can render without a user gesture,
  and autoplay with sound is silently refused by the browser -- it would read
  as broken. M or the sound chip unmutes; both are gestures. Click the video to
  pause/resume, chip in the hints row cycles 1x / 1.5x / 2x.
- **One verb per key**: A approve, X reject, S / → skip, ← previous,
  Space play/pause, M sound. The host owns the window and the <video>, but a
  decision made by key goes through `StudioAdapter.deckAct` -- the optimistic
  ledger, a repaint, then the API -- the identical road the buttons take, so
  the deck advances instantly either way. Keys are inert over the grid, any
  modal, a focused field, and the tour (its veil blocks clicks; the keyboard
  must not slip behind it).
- **The score explains itself on the deck**: the worker's own reasons
  ("complete ending · question hook") sit under the title, where the
  decision is made. A progress bar and a session tally (from UI.pending, which
  already was that ledger) top the card; a filmstrip of the waiting stack
  underneath jumps anywhere out of order; zero left on the decide tab is a
  "Queue clear" card pointing at the schedule, not an empty stream.
- **The delegated open-the-player click skips `[data-deck-card]`** -- the deck
  is now its own player, and a click there is pause/resume, not a second
  player over the first.
- Traps that cost time here, written down: the approve gate refuses seeded
  clips without `musicVerified`/`renderVerified`/`templateId` (the 400 reads
  as a dead button); the queue arms its OWN tour whose veil sits over
  everything (skip it before testing clicks); and a `pkill -f` pattern that
  appears in the same command line kills the command's own shell -- run pkill
  in its own Bash call, always.
- The deck tests run the machinery: `test/review-deck.test.mjs` vm-loads the
  adapter, computes bindings from real clip rows, and calls deckAct, asserting
  the ledger, the advance, the strip jump and the clear state.
- **v3.31.1, from Youssef's first look**: the deck is TWO COLUMNS at desktop
  (card left; progress, title, reasons, labelled actions, filmstrip and keys
  right) so nothing scrolls vertically -- measured scrollDelta 0 at 1440x950.
  The approve/reject icons were `ph-bold`, a Phosphor weight the generated CSS
  has NEVER imported (only regular and fill), so those two glyphs had no font
  anywhere; they are regular-weight now, with small text labels under all
  three buttons. If an icon is missing, check WHICH WEIGHT before blaming the
  CDN.

## DeenAI — the Pro growth assistant (v3.32.0, 29 Aug 2026)

Youssef: "add a ai helper deenAi ... for the top subscribers ONLY pros and
demos can demo and view it but it gives no access to them ... deen ai should
be a tab btw".

- **Two halves, deliberately different in kind.** INSIGHTS (`src/deenai.js`)
  are computed server-side from the account's own records with the arithmetic
  in the card body — no model involved, so a card can never hallucinate a
  number, and a card whose data is too thin (a lecture with two clips has no
  keep rate) is omitted rather than padded. ASK is the worker box's own
  Ollama (`advise_with_ollama` in worker/service.py, `POST /ai/advise` behind
  the same HMAC as jobs): the same privacy posture as transcripts — nothing
  leaves a server the product already runs. `askContext()` hands the model
  numbers and kept titles ONLY, never transcripts; a test feeds a transcript
  in and asserts it never reaches the payload.
- **The gate is `deenaiAccess()` in src/deenai.js — the ONE `isPaid` call**,
  named in test/plan-gating.test.mjs's allowlist. `PRO_FEATURES` gained
  `deenai`, so the exact-list tests in plan-gating and pro-and-blockers both
  changed with it — that pair is the alarm that a Pro feature shipped without
  its gate or its badge.
- **Everyone sees the tab; only Pro gets data.** A free account's
  `GET /api/deenai` returns `demoInsights()` — four static cards each marked
  `demo: true`, drawn with a DEMO chip and a lock banner — and
  `POST /api/deenai/ask` answers 403. The lock state comes from
  `billing.current.features.deenai` already in /api/state, so the screen is
  honest on first paint without waiting for the fetch.
- **The ask is fenced against prompt injection** (invariant 2 applied here):
  the question is typed by a customer, so it travels between BEGIN
  UNTRUSTED/END UNTRUSTED with the defence stated in the system prompt before
  the data. The Python test drives a hostile question through and asserts the
  fence — using `rindex`, because the SAFETY paragraph MENTIONS the markers
  before the real fence opens, and `index` finds the mention.
- **A deployment without a worker refuses honestly**: `config.processingMode
  !== 'remote'` answers the ask 503 with a sentence, and a box without
  OLLAMA_URL does the same from the worker side — never a 75-second hang.
  qwen3 thinks by default; the request sends `"think": False` and strips a
  leaked `<think>` block belt-and-braces.
- **Proven against the real box, 30 Aug 2026.** A signed `POST /ai/advise` on
  the Hetzner worker answered **HTTP 200 in 4.8s** from qwen3:4b, and the
  answer used the context it was handed rather than generic filler — it named
  the clip titles in the payload. This had been carried as untested because the
  session that built it could not reach the box; it is no longer. The test is
  reproducible from any session with SSH: sign
  `<ts>\nPOST\n/ai/advise\n<body>` with `WORKER_SHARED_SECRET` (HMAC-SHA256,
  hex) into `x-deenclipped-timestamp` / `x-deenclipped-signature`, and post to
  `127.0.0.1:8080` from ON the box. Still unexercised: the app→worker leg, which
  needs a signed-in Studio account.
- The host caches `/api/deenai` on `window.DC_DEENAI` and reattaches it on
  every state poll (the same move as DC_OWNER), because `/api/state` replaces
  DATA wholesale. The answer itself lives in UI state (`aiAnswer`), not DATA,
  so a poll cannot wipe a reply mid-read.

### Ask got better answers, a spinner, and its tier badge (v3.37.0)

Youssef: "the ask deenai must improve very much, loading circle when asking,
quicker responses".

- **The model was being asked to notice what this module already knew.**
  `askContext` sent bare totals, so the answer either redid the arithmetic
  badly or drifted into generalities about short-form video. It now carries
  the computed INSIGHTS and the figure band as sentences, and the prompt says
  to treat them as true and build on them. A spoken answer and the cards on
  screen can no longer contradict each other.
- The system prompt is a shape, not a personality: best sentence first, then
  at most three things doable TODAY, naming the screen (Review queue, Schedule,
  Connections), under 160 words, no headings or emoji, never invent a
  statistic, never quote scripture from memory.
- **Three settings make it quick, and none of them is the model.**
  `keep_alive: 60m` is the big one -- Ollama unloads after five minutes by
  default, so the first ask after a quiet spell paid the whole model load,
  which on this box is most of the wait. `num_ctx: 4096` stops the server
  re-planning the window per request, and `num_predict: 260` with a `stop`
  list ends the answer instead of letting a small model spend its last
  hundred tokens inventing a second question. A test pins all three.
- **The wait looks like work.** The button showed "Thinking…" and nothing
  else, which reads as a dead control; it now carries a spinner, and the
  answer area shows the shape of a reply arriving. Both stop under
  `prefers-reduced-motion`.
- DeenAI wears a **STUDIO** tag in the rail (reusing the nav's count slot, so
  no design re-import), in the header pill and in the footer marker. Pro still
  gets the insights -- the subline says so -- but the tab belongs to Studio.

### Both buttons say STUDIO, and one of them was selling the wrong plan (v3.72.10)

Youssef, 1 Sept 2026, looking at the live screen as a Basic account: "it should
be unlock with studio."

- **The screen has TWO gates and had ONE button label.** Insights are `deenai`
  (Pro); asking is `deenaiAsk` (Studio). `aiGateCta` served both call-to-action
  buttons, so the button inside the ASK box told a free account to buy **Pro** --
  the one half of this screen Pro does not include. Somebody could have paid and
  found Ask still locked. A billing button naming the wrong plan is the worst
  copy fault this product can ship.
- **The locked banner was making the same promise in prose**: "On Pro, DeenAI
  reads your own clips ... **and answers your questions**". Pro does not answer
  questions.
- Both CTAs now read **Unlock with Studio** (Studio unlocks the whole screen),
  the subline says "A Studio feature", and Pro is named in the NOTE beside each
  button rather than on it -- "Pro turns the figures real without the asking".
  Saying nothing about Pro would oversell Studio; saying it on the button sold
  the wrong plan. The gates themselves are UNCHANGED: a Pro subscriber still
  gets real insights and still sees "Upgrade to Studio".
- **The banner's button and sentence were LITERALS in the design export**, which
  is exactly how they drifted from the binding beside them. They are entries in
  `design/text-overrides.json` now (`aiGateCta`, `aiDemoNote`), so the plan name
  has one source. **Re-running `npm run design:import` was proven byte-stable
  first** -- same input file, identical output -- so this cost no re-import
  risk: the generated CSS did not change and no hashed class name moved. That is
  the route for any other literal in the export that is really data.
- The test renders the real template at all three tiers and asserts no button
  offers Pro, plus that no `Unlock with Pro` literal survives in the export.
  Proven RED against the old label before being kept.

### The screen was rebuilt out of its card grid (v3.33.0, 29 Aug 2026)

Youssef, on the first version: "this can look 1000 times better". It was six
equal boxes in a grid — the Owner-screen mistake by another door, and it made
the one thing only DeenAI can do (the ask) the smallest thing on the screen.
Three directions were drawn as a canvas; he chose "whichever will do best",
and this is that one.

- **The ask is the centrepiece**, at the top, with three example questions
  that FILL the box rather than merely suggest (a chip that does nothing is
  invariant 9 broken). The answer lands directly beneath it, not at the bottom
  of the page.
- **The strongest insight gets the room.** The server marks it by putting it
  FIRST; the screen never re-ranks, or the two halves of one answer would
  disagree about what matters. Where it carries a `figure` (a lecture's keep
  rate) that figure is drawn large in gold beside the lecture's own name.
- **A lecture titled in Arabic renders right-to-left in Amiri** (`rtl` on the
  card, from a Unicode-range test server-side). That is why the card carries a
  `kicker` — "Clip more from" — separately from the `title`: a name glued into
  the middle of an English sentence cannot carry its own direction. Amiri is
  already in index.html's font link, so this costs nothing.
- **The numbers became a divided band**, the same device as Owner's KPI row:
  approval bar, days posted, worst destination's refusals, awaiting review.
  `metrics()` lives in the same module as the cards deliberately — a screen
  that counts its own figures is a second source of arithmetic, and the two
  would drift.
- Everything else is a **row with a hairline**, two columns. Three columns
  orphaned the last row onto a line of its own, which reads as a fault.
- The demo view is the identical layout with DEMO chips on every figure and
  row — a locked account sees the real shape, not a lesser one.
- **The sign-in throttle is real and the tests must not spend it.** Five
  sign-ups in one file hit it and the failure reads as a broken route; the
  suite now shares one Pro session and tests band arithmetic by calling
  `metrics()` directly.

## Three tiers, sold at three periods (v3.34.0, 29 Aug 2026)

Youssef: "3 types of subscriptions ... basic which is free demo 3 days 40
tokens, pro which is most uses ... and then for the last one maybe studio
which gives you that ai plus multiple channel uploads".

- **What was there was not three plans, it was one plan sold three ways.**
  weekly/monthly/yearly were the "plans"; a BILLING PERIOD was doing the work
  of a product tier. Tier and period are separate axes now and the plan id
  carries both (`pro_monthly`, `studio_yearly`), so the grid is 2 paid tiers x
  3 periods = 6 prices where there were 3.
- **The three original ids still work everywhere** — `normalisePlanId` maps
  them to Pro at that period. They live in Stripe's own metadata and on every
  current subscriber's record, so refusing them would have thrown paying
  customers onto the free plan at the next webhook, and a saved checkout link
  would 400. Checkout, allowances, the period length, the "current plan" name
  and the pricing grid all normalise. A test pins each one.
- **`FEATURES` is one table: feature -> lowest tier that has it.** PRO_FEATURES,
  STUDIO_FEATURES, `planFeatures()` and the pricing columns are all DERIVED
  from it, so a feature cannot be sold without a gate or gated without being
  sold. Both law tests assert the whole table.
- **DeenAI split rather than moved.** Pro keeps the insights it shipped with
  two days earlier (arithmetic over the account's own records, free to serve);
  Studio adds Ask (a slot on the box's Ollama). Taking the whole feature back
  off Pro would have been taking something away from people who had it.
- **Auto-approve was NOT gated, and that was a correction mid-build.** It was
  on the agreed Studio list until the code said otherwise: `automationSettings`
  has always been free for every account, minimum score and all, up to 20 clips
  a lecture. Fencing it would have removed a feature people already have.
  Studio got `priorityRender` instead — new, and takes nothing from anyone.
- **Feature access and queue position are different questions.** `tierOf`
  counts the operator as Studio (they must never be locked out of their own
  product); `paidTierOf` does not. The render queue and the posting windows use
  the PAID one, or the owner's test import would preempt a customer's lecture
  on a single-slot worker. A test caught exactly that and it stays.
- **Extra posting windows are inserted between the configured ones**
  (`postTimesFor` in slots.js), never spread evenly over 24 hours: the account
  chose which part of the day it publishes in, and 8 slots a day must not mean
  posting at 3am. 4 -> 07:00 08:15 09:30 12:00 14:30 17:00 18:45 20:30.
- **The period toggle is not a filter.** It changes the price basis; all three
  tiers stay on screen at every setting. That rule has its own test because the
  screen once filtered by interval and showed a customer one paid plan with
  nothing to compare it against.
- Each column lists what it ADDS over the one before it, from the server's
  lists. Repeating one flat list three times hides the difference being sold.
- **One switch moves the whole page, on BOTH surfaces** (v3.34.1). The public
  /plans page first shipped with three price buttons stacked inside every card
  -- Youssef: "that is not a nice look for billing should be one button chnaging
  ALL". It is one price and one button per card now, with a single segmented
  switch above the grid. That switch is **CSS, not script**: three sibling
  radios and `:checked ~` selectors, because this page's CSP admits no inline
  script and a radio needs none. A test asserts the page carries no script tag.
- **Studio has no Stripe prices yet.** The column renders and says "Opening
  soon" rather than offering a button that cannot charge anyone;
  `STRIPE_PRICE_STUDIO_{WEEKLY,MONTHLY,YEARLY}` on Render arm it.
- **Motion and spacing, v3.35.0** ("NOW ANIAMTIONS, LESS CRAMMING"). Both
  surfaces: cards rise in with an 80ms stagger, lift on hover, and the price
  and token line animate on every flick of the period switch -- a block that
  goes from `display:none` cannot TRANSITION, but an animation runs the moment
  it is shown, which is what makes the CSS-only switch feel live. Card padding
  21 -> 28px, list gaps 8 -> 12px, body type 11.5 -> 12.5px, grid gaps
  14 -> 22px, section titles 34 -> 56px apart.
  **The in-app entry animation is GATED** (`tierAnimClass`, the same device as
  the Owner screen's `owAnimClass`): the studio re-renders on every state poll,
  so an ungated one replays every few seconds and reads as a flicker. Only
  opening the screen or moving the switch stamps `tokensAnimAt`. Verified by
  re-rendering after the gate expires and asserting nothing animates.
  Every rule has a `prefers-reduced-motion` escape.
- **The switch's highlight slides, and it is built twice on purpose (v3.35.1).**
  On /plans it is a `::before` PSEUDO-ELEMENT that survives every state change,
  so a plain `transition: transform` moves it between three stops. In the studio
  it cannot be: the app re-renders through innerHTML, so that node is brand new
  on every paint and a transition has no previous position to move from. There
  it is an ANIMATION instead, with the distance it travelled passed in as
  `--dcx` and consumed by `@keyframes dcPillSlide`. Same effect, opposite
  mechanism, and the reason is the render model — not a style preference.
  The prices slide in from the side the switch travelled
  (`dcslide-next`/`dcslide-prev`, from `UI.billingFrom`), staggered 45ms across
  the three columns.
- **The whole card travels, and there is only one animation system (v3.35.2).**
  studio-tokens.css already owned an entry animation, hover and the
  reduced-motion escape for these cards from v3.23; a second set was added
  beside it and the two fought. Now the older block keeps hover and the button
  states, and only the gate and the sideways travel are declared on top of it.
  Three traps, each measured rather than reasoned about:
  1. **`backwards`, never `both`** -- the same lesson the v3.23 block had
     already written down. A forwards fill leaves the last keyframe beating
     ordinary declarations for the element's life, which silently kills the
     hover transform. Confirmed by hovering after the animation: resting
     `none`, hovered `translateY(-3px)`.
  2. **`animation:` is a SHORTHAND and resets `animation-delay`.** The stagger
     was set earlier in the file and thrown away by the later shorthand, so all
     three cards moved in lockstep -- measured at an identical 9.9px mid-slide.
     Re-declared after the shorthands: 9.9 / 26 / 38px.
  3. **The old entry animation was ungated**, so it replayed on every state
     poll. Switched off and replaced by the two gated classes; a background
     re-render now reports ZERO running animations.
  On /plans the same effect needs a different trick: re-pointing a rule at the
  same `animation-name` does not restart it, so the three checked states use
  three identically-defined keyframes (`dcSlideA/B/C`) to force the restart.
- **`ph-seedling` is not in @phosphor-icons/web 2.1.1.** Basic's mark was an
  empty ring beside Pro's lightning and Studio's sparkle for a release. unpkg
  is not reachable from the build container to check a glyph name, so the rule
  is: use only glyphs seen rendering in the live app. Basic uses
  `ph-fill ph-house`, which is what the rail's Home item uses.
- **A tagline is a promise.** Studio's said "approve on autopilot" for one
  release after auto-approve was dropped from it. Corrected to "jump the
  queue"; if a feature moves, its sales copy moves with it.

## The public site was still selling the old plans (v3.36.0, 29 Aug 2026)

Youssef: "now do the same with the website one".

- **deenclipped.online did not know Studio existed.** `src/marketing.js` had its
  own `pricingCards()` -- rendered on BOTH the homepage's pricing section and
  `/pricing` -- still advertising Free / Weekly / Monthly / Yearly: four cards
  for one paid tier sold three ways. Two pricing surfaces had been updated and
  the one an unsigned-in visitor actually sees had not.
- It is the same three tiers, the same one-switch-moves-everything gesture and
  the same whole-card slide as /plans and the studio. The switch is CSS again
  (`#mk-*` radios), prefixed so it cannot collide with /plans' `#per-*` on a
  page that ever renders both.
- **The stagger needs `!important` here.** The rule that sets the animation is
  an ID selector (`#mk-monthly:checked~…`), so it outranks a plain
  `.price-card:nth-child(2)` on specificity and its shorthand resets the delay
  to 0 -- measured, all three cards moving together at an identical 27.9px.
- **The JSON-LD offers moved with the page.** They listed three plans; the grid
  now sells six paid prices, and `test/site-housekeeping.test.mjs` compares the
  schema against what the page renders, so leaving it would have been a silent
  lie to search engines as well as a failing test.

## Notifications: both kinds live in the bell, and both are real (v3.74.0)

- **Email notifications joined desktop notifications in the bell dropdown**,
  as a host-rendered row beside the generated desktop row (the paintStudio
  pattern; the row and its knob are inline-styled, no hashed classes). The
  pref is SERVER-side: `state.userSettings[uid].emailNotifs`, default ON,
  exposed as `emailNotifs` on /api/state, toggled by
  POST /api/notifications/email — and it GATES the three real senders (post
  summary in agent.js, clips-ready and lecture-failed in local-engine.js),
  so it is not a dead switch. `store.emailNotifsOff()` is the one gate.
- **index.html has MULTIPLE inline script scopes** — the fireClipNotifs
  comment was right and bit again: a function defined near the handlers is
  invisible to paintStudio's scope, and `DATA` is invisible to the handler
  scope. The painter is window-pinned and takes DATA as a parameter; the
  toggle keeps an optimistic `__dcEmailPending` that the painter clears when
  the polled payload agrees.
- The bell rings on hover (studio-motion.css, reduced-motion off), and the
  account menu's Help & guides now opens the in-app Help screen instead of
  a support dialog.

## The notifications toggle was hidden behind having dismissed something

The desktop-notifications switch lived INSIDE the `hasDismissed` branch of the
bell dropdown, so the one control that turns notifications on was shown only to
someone who had already dismissed a notification. It is the first row of the
dropdown now, outside that branch, and says which of its three states it is in
-- off, on, or blocked by the browser, which need different actions.

## How every reply ends (29 Aug 2026)

Youssef: "always give me small lines at the end for updates and needs fixing".

- **Every reply ends with two short lists**, whatever it was about:
  **Updates** — what changed, shipped or went live this turn.
  **Needs fixing** — what is still open, each naming WHO it is on.
- One short line per item. No paragraphs, no nesting. If the detail matters it
  goes in the body above, not in these lists.
- **Never drop "Needs fixing".** If nothing is open, the line is "nothing".
  Silence there reads as "all clear", and that is how the box sat on old code
  for weeks.
- It applies to answers and questions too, not only to work — he reads these
  on a phone and they are how he tracks what is his to do.

## Saying "hand over" (29 Aug 2026)

`/handover` — `.claude/skills/handover/SKILL.md`, in the repo so EVERY session
gets it: the phone one, the cloud one, and the CLI one on the Mac. Youssef's
instruction: "every time i say hand over in this or other chat it should give
exact handover".

- **A handover is a measurement, not a recollection.** Sessions share no memory
  — only git and this file. So the skill measures: branch, unpushed work, other
  branches, the real test numbers, CI, the Render deploy, and the box's version.
  Anything it cannot reach it reports as unknown rather than omitting.
- Output is **Current goal / State / Blockers / Next immediate action**, ten
  bullets max, overwritten each time — never a stacked log, because this file
  already holds the durable history.
- It must name **who** each blocker is on, and must never carry a credential.
- **It reports the box, it does not deploy it.** That is `/deploy-worker`
  (`.claude/skills/deploy-worker/SKILL.md`), which carries all three routes to
  the box — SSH from the Mac, a `deploy-worker.yml` dispatch, or the Hetzner
  console with its shifted-symbol and dead-console traps — and refuses to call
  a deploy done without reading the version out of the RUNNING container. When
  a handover finds the box behind, that skill is the next action, run there and
  then if the session can reach the box and named as someone else's if not.

## Working from a phone (28 Aug 2026)

Youssef works from Claude Code on his phone when he is out, so sessions start
with no laptop, no local state and no earlier conversation.

- **This file is the handover.** Nothing else travels. Conversation history
  does not, and neither does any per-machine memory — a note saved on the Mac
  is invisible to every other session. If a fact will matter next week, it
  belongs in this file, in the repo.
- **CI is the verification of last resort.** `.github/workflows/ci.yml` runs
  `npm run check` and `npm test` on Ubuntu with Node 22 and Python 3.12. The
  repo has **no npm dependencies and the Python tests use only the stdlib**, so
  a clean checkout runs the whole suite anywhere — that is what makes a phone
  session viable at all. Keep it that way; a dependency added carelessly
  removes it.
- **A cleanup race turned a green suite red, in CI only.** `test.after` removed
  the temp DATA_DIR while the server's state saver was still writing
  `state.json.tmp` into it: rmSync retried, the saver re-created the file, and
  the run failed with ENOTEMPTY after every assertion had passed. `maxRetries`
  does not help when something is actively re-creating files. Two fixes, both
  needed -- the server is closed AND AWAITED before the directory goes, and the
  removal is wrapped in try/catch, because a leftover temp directory on a
  runner is harmless and failing a green suite over one is not. 34 files.
  This is the worst shape a red branch can have: it almost never reproduces
  locally, so a phone session cannot diagnose it and cannot trust the tick.
- **A Mac cannot see a case-only path mistake.** `DESIGN/…` opened fine locally
  and threw ENOENT on Linux CI, so the suite was green here and red there —
  the worst failure to hit from a phone, because it cannot be reproduced on the
  machine that wrote it. `test/case-sensitive-paths.test.mjs` compares every
  repo path a test names against the real directory listing.
- **Never leave the branch red.** A phone session that cannot trust the tick
  has no way to check anything.
- **Show him the desktop, every time** (his instruction, 28 Aug 2026: "I need
  screenshots of desktop images of what's new I want that EVERY TIME HERE").
  He is on a phone; he cannot open the app at 1280px to see what changed. So
  any update that alters something visible ships WITH desktop screenshots of
  it in the reply — not a description of it, and not only the phone width.
  Settle animations first (see Verification standard) or the capture lands
  mid-transition. If a change genuinely has no visible surface, say that
  instead of quietly sending nothing.
- What a phone session **cannot** do: the Hetzner worker deploy (browser
  console), Stripe dashboard work, and platform submissions. It also cannot
  screenshot the app — so when the work happens there, say plainly that the
  visual check is outstanding rather than letting silence imply it was done.
- **Work started on a phone lands on its own branch.** Two independent
  sessions fixed the same `DESIGN/` case bug on 28 Aug without either seeing
  the other, and the phone branch sat unmerged for hours with a real owner
  ledger on it. Merge it back to `deenclipped-v2-2` rather than leaving two
  truths, and check for overlap before starting anything large.
- **Finish both halves.** See *Finishing a piece of work* below: a push ships
  the web app and nothing else. If a session cannot reach the box, it has to
  say the worker is still on the old code rather than let the push imply
  otherwise.

## Finishing a piece of work — BOTH halves, every time

Youssef, 28 Aug 2026: "so it always pushes github and hetzner once its done
also cause it may be a mix up". The mix-up is real and has happened twice: the
box sat on `72fea1a` for weeks with every worker change pushed, green and not
running, and a phone branch sat unmerged with an owner ledger on it.

**A push is half a deploy.** Render takes the web app off `deenclipped-v2-2`
automatically. NOTHING takes the worker. Run this checklist to the end before
saying a thing is done:

1. `npm run check` and `npm test` green locally.
2. Bump `package.json` if `src/` or `worker/` changed (CI fails otherwise), and
   update the test counts in **Verification standard**.
3. Commit and push.
4. **If `worker/` changed, deploy the box** — it does not happen on its own:
   ```
   ssh -i ~/.ssh/deenclipped_worker root@135.181.149.182
   cd /opt/deenclipped && git pull && bash worker/deploy.sh
   ```
   Then prove it landed, because a clean build log does not:
   `git log --oneline -1` on the box names the commit you pushed, and
   `docker exec worker-deenclipped-worker-1 grep -c <something new> /app/worker/<file>`
   finds your change inside the running container.
5. Confirm CI went green (`gh run list --branch deenclipped-v2-2 --limit 2`).
   A red branch is worse than no branch when the next session is on a phone.
6. Screenshot anything visible at desktop width and put it in the reply.

**Before starting anything large, check for the other session.**
`git fetch && git log --oneline origin/deenclipped-v2-2..origin/<their-branch>`.
Two sessions independently fixed the same `DESIGN/` case bug on 28 Aug. Merge
phone work back to `deenclipped-v2-2` rather than leaving two truths.

## Releasing

- **`package.json` version is the single source**, announced by both apps. Bump
  it — patch for a fix, minor for a feature — in the same commit as the change.
  **CI enforces this too** (`scripts/check-version-bump.mjs`): a push touching
  `src/` or `worker/` without a bump fails. Docs, tests and workflows may land
  without a release, deliberately — a rule that fires on everything gets worked
  around, and then it protects nothing.
- Update the test counts in **Verification standard** above whenever they move.
- Pushing `deenclipped-v2-2` deploys the web app to Render automatically. The
  **worker is manual** and nothing about a push tells you otherwise: `worker/`
  changes sit unrun on the box until someone runs the deploy in the Deploys
  section above. A worker change that is committed, green and pushed is still
  not live.

## Analytics & the owner tab (v3.16.0)

- **First-party web metrics** live in `src/metrics.js`, hooked once in
  server.js: pageviews on an allowlist of public paths, daily uniques via a
  daily-rotating salted hash, referrer hosts and UTM pairs, all aggregated per
  UTC day in `state.webMetrics` with 90-day retention and capped maps. No raw
  IP or user agent ever persists — a test asserts it against the state bytes.
  **Signed-in operators are excluded**, so the owner's own visits never show
  and local AUTH_REQUIRED=false records nothing (everyone is the admin).
  Signups, revenue and posts are DERIVED at read time from authUsers,
  revenueEvents and clips, so they predate capture; pageviews start at the
  deploy that added this.
- **The whole owner surface is the in-studio Owner screen** (`owner`) as of
  v3.17.0, at Youssef's instruction: seven client-side sub-tabs (Overview,
  Traffic, Money in, Money out, Users, Activity, Health) with the cost ledger
  editable in place. The standalone `/owner` page and its three assets were
  DELETED — the route 404s for everyone, and a test pins that. Data comes
  from `/api/owner/finance`, `/api/admin/analytics`, `/api/owner/webmetrics`
  and `/api/owner/health` (health fetched apart, so a slow worker never
  blocks the books), cached by the host across state polls because
  `/api/state` replaces DATA wholesale. `/owner` stays in robots.txt's
  disallow list only because trimming the list is not worth it.
- **v3.19.0 rebuilt the screen in an open look, per Youssef** ("tabs … that
  dont look boxy and ai … some without boxes, add animations all round", and
  the rail correction "side bar should be seprated … im SAYING OWNER"): the
  Owner rail item sits apart under the nav groups in its own gold ring
  (`ownerNavItem()`), the screen uses text tabs with a gold ink bar, hairline
  dividers and divided KPI rows instead of cards, and Traffic gained live-now,
  funnel, channels, campaigns, devices, languages and broken-links from the
  v3.18 capture. Motion lives in `src/public/studio-owner.css` (hand-written,
  linked from index.html, allowlisted in server.js — same arrangement as
  studio-tokens.css). The entry animation is GATED: `owAnimClass` emits
  `dcow-rise` only within 900ms of a deliberate act (`ownerAnimAt` stamped by
  nav/tab/range/refresh), or every state poll would replay it. Two layout
  traps fixed here, do not regress them: the screen root carries
  `flex: 1; min-height: 0; overflow: auto` like every sibling screen (without
  it nothing scrolls and flex compresses the sections into each other —
  `.dcow-s { flex-shrink: 0 }` in studio-owner.css is the other half), and
  tables inside the `auto-fit, minmax(280px, 1fr)` grids must NOT carry the
  wide tables' `min-width: 420px` — a ~375px column clips the right-aligned
  count column clean off, which reads as "the numbers are missing".
- **v3.23.0: the Owner screen is live and its tiles are dials.** It refreshes
  itself every 30s, but only while it is the screen on display AND the tab is
  visible AND no cost is being edited -- a background tab polling four
  endpoints forever is exactly the "no anythign that will lag the server" being
  guarded against; health (a worker round trip) goes every fourth tick. Each
  Traffic KPI is a `<select>` over twelve metrics (`ANA_METRICS` in the
  adapter), so six slots cover everything without twelve boxes on screen, and
  the visitors chart reads By day or By hour from a 48-hour series
  (`hourly` in metrics.js: two counters per hour, inside the day bucket, so
  retention and the privacy promise are unchanged).
- **A pending cancellation is visible.** Stripe keeps a cancelled-at-period-end
  subscription `active`, so `cancel_at_period_end` is captured from the
  webhook, exposed as `current.cancelAtPeriodEnd`/`cancelAt`, shown as an
  "Ending soon" pill with the spelled-out end date, and a Resume button (drawn
  only then) hits `/api/billing/resume`. Cancelling itself goes through the
  Stripe portal, per Youssef's call on the v3.15.0 rebuild.
- **Marketing pages carry JSON-LD** (Organization, WebSite, SoftwareApplication
  with offers parsed from the SAME config price labels the page renders, and a
  FAQPage built from the array that renders the visible FAQ). Tests compare
  schema against the rendered page, so they cannot drift.

## Performance was rebuilt around what is actually known (v3.24.0)

Youssef, 28 Aug 2026: "performance needs a FULL REDO". It deserved it: half
the screen was dead. Three columns -- views, saves, watched -- printed "—" for
every clip, because no connected platform sends this app audience data, and
`perfPatterns` was an empty array rendering an empty column beside them. That
is invariant 8 (no dead controls) broken in the open.

What it shows now, all of it derived from the account's own records:
a divided KPI row (made, kept, posted, discarded, failed posts, source
minutes), a made → kept → given a slot → posted funnel, where clips went by
destination with failures called out, when they post by hour, which lectures
are worth clipping (clips, kept, posted, average score), and the strongest
clips with their real state and destination. The footnote says plainly why
there are no view counts.

**The flex-shrink trap caught this screen too.** The root is a flex column
with `min-height: 0`, so a child that does not say `flex: none` is shrinkable
-- and with a long page below it the KPI row was squeezed to a height of ZERO
while still reading correctly in `innerText`. Every direct child of a scrolling
flex-column screen needs `flex: none` (the Owner screen's `.dcow-s
{ flex-shrink: 0 }` is the same fix by another route).

## The channel's design language, carried into the studio (v3.25.0)

Youssef sent the DeenClipped YouTube banner on 28 Aug: "see how cool the
deisgn is, empliment it sutbley in the webiste dashboard, not the titles but
the diesgn". Three devices came across, and nothing else:

- the **hairline rule** between the arch mark and the wordmark
  (`brandRuleStyle`, and it disappears with the wordmark when the rail
  collapses),
- the banner's **widely spaced subtitle**, so STUDIO sits at .2em like
  "Qur'an · Reminders · Islamic Talks" does,
- the **mihrab lattice** at the rail's empty lower half (`railMotifStyle`, an
  inline SVG data URI at ~16% stroke alpha under a fade mask). It is
  `#dcRailMotif` and the phone sheet hides it: there is no lower half in a
  bottom tab bar, so it would paint over the tabs.

Subtle is the whole point: the mark, the two-tone wordmark and the gold were
already shared, and nothing about a screen's content or layout changed.

## The public site was rebuilt as a cinematic scroll story (v3.63.0, 31 Aug 2026)

Youssef's brief: scrap the whole website's LOOK — "an Awwwards-calibre,
cinematic product story" — while the dashboard stays visually immutable and
every feature, SEO structure and test contract survives. Delivered in one
pass; 1003 JS + 456 Python green; dashboard baselines byte-identical on
desktop (mobile 98dB PSNR, zero studio files in the diff).

- **The design system lives in a rewritten `marketing.css`**: near-black stage,
  a warm-paper interlude scene, gold as ink, emerald only for "verified/safe".
  Display face is **Fraunces**, UI face **Outfit** (the dashboard's own), both
  loaded from Google Fonts in `layout()` — before this the marketing site
  loaded NO webfont and rendered entirely on system fallbacks.
- **The motion contract, and why it is safe.** `src/public/marketing.js` adds
  `mjs` to `<html>` and stamps `--p` (0→1) on every `[data-scene]` wrapper from
  one rAF-coalesced scroll handler; ALL motion is CSS reading `var(--p, 1)`.
  The default of **1 is the final, legible pose**, `.reveal` hides only under
  `.mjs`, and the tall pinned-scene heights exist only under `.mjs` and are
  removed again under `prefers-reduced-motion` — so no JS, old browsers and
  reduced-motion all get a complete static page. Content is never delivered BY
  an animation.
- **A pinned stage must compose inside 100svh.** Every `.sc-tall` scene's
  content is sized in vh-clamps because the stage is a fixed viewport — the
  first version overflowed two scenes and clipped its own headline off-screen.
- **`grid-template-columns:minmax(0,100%)` on `.sc-stage` is load-bearing.**
  The filmstrip track is `width:max-content` (~4600px); without that line it
  inflates the stage's auto grid column and every margin-centred sibling is
  pushed ~1600px off-screen right — the page MEASURES fine (rects, opacity)
  and paints black, which cost a real bisect to find. overflow-x:clip hides
  the evidence.
- **Real captures replaced invented UI where it matters.** Four help-centre
  screenshots were copied to `marketing-assets/studio-{home,queue,schedule,
  templates}.webp` and drive the homepage workflow chapters, each tagged
  "Real product capture"; the review-queue capture also replaced the stylised
  render in `proofBand()`. `editor-premium.webp` is kept ONLY as the editor
  chapter's image, tagged "Concept preview" beside the coming-soon badge —
  it draws features that do not exist, so it must never be shown untagged.
- **Two Higgsfield images and their provenance** (model
  `cinematic_studio_2_5`, 21:9, 2k, 31 Aug 2026): `hero-hall.webp` (empty
  mosque hall, lone lit microphone by the minbar — the homepage hero backdrop)
  and `final-hall.webp` (stone-arch hall, dimmed to .34 behind the final CTA).
  Prompt shape: empty mosque hall at night, warm lantern light, no people, "no
  visible text, no calligraphy" — generated imagery must NEVER contain
  Arabic-like markings, faces of real scholars, or fabricated product UI.
  Masters live outside the repo; the served WebPs are ~35KB each.
- **The Arabic on the page is never synthesised.** The "difference is one
  frame" scene and the template gallery show `reel-quran.webp` — a real
  render's own burned-in ayah — and the surah reference is plain HTML. No new
  Arabic text was typeset or generated anywhere.
- **What the tests pin, so a restyle does not trip them**: the minified
  `.reel-card img{...}` rule, `.footer-col a` min-height 30px and
  `.faq-item > summary` padding-top 14px in the 620px block, the exact
  source-bar form markup, the five reels on `/`, FAQ `<summary>` parity with
  the schema (and NO other `<details>` on `/`), four JSON-LD blocks exactly,
  first `/marketing-assets/` img = the hero backdrop (stampImages gives it
  fetchpriority), and every compliance string in privacy/terms untouched.
  `seoPage()` itself was left structurally unchanged — the whole 22-page SEO
  cluster restyled through the shared classes alone.
- The old look survives on branch `site-backup-before-rebuild` (v3.61.0).

### The public site's motion on a phone (v3.83.1, 2 Sept 2026)

Youssef: "animations on normal website main website doesnt work like desktop
works the moblie is very weird."

- **The scenes were being SCRUBBED at a width where they are not PINNED.**
  marketing.css only makes `.sc-hero` and `.sc-tall` tall-and-sticky at
  `min-width: 961px`; below that they are ordinary blocks. The engine did not
  know that and went on stamping `--p` across them, so a scene scrolled up the
  screen while its own contents were ALSO being moved by `--p` -- two
  movements at once, and every formula sized in vh (the hero reels travel
  11-15vh, the filmstrip -34%) half-finished somewhere off the top. That is
  the whole of "very weird".
- **They cannot simply be pinned on a phone.** Measured at 390x844: the hero's
  own column is **1116px** and the one-frame scene **1306px**, against 844 of
  screen. A pinned stage that cannot hold its content clips its own headline
  off, which is the trap the original rebuild already recorded.
- So below 961px those scenes keep the CSS default -- the complete, legible
  pose, the same one a browser with no JavaScript gets -- and their blocks are
  given the ordinary `.reveal` entrance instead, seeded in JS before the
  observer is built. **Measured: 3 reveal blocks on a phone before, 24 after**,
  revealing progressively down the page. The journey scene is still scrubbed,
  because at that width it is a stacked list and its rail filling as you read
  is the one scrubbed effect that still makes sense.
- **`.reveal` now has a backstop, and it is not optional once a phone depends
  on it for its entrances.** An IntersectionObserver callback can be missed on
  a fast fling, and a block left at opacity 0 is content delivered BY an
  animation -- the one thing this page may never do. Anything still hidden
  once its top has climbed past the middle of the viewport, or that is sitting
  complete inside the viewport (the foot-of-page case, where the top never
  climbs that far because the page runs out of scroll), is shown outright.
  Half a screen later than the observer, so the staggered entrance still wins
  normally; the pending list shrinks as blocks reveal and costs nothing once
  empty.
- **The desktop is untouched**: only marketing.js changed, and the `--p` sweep
  at 1440x900 steps through the four scenes exactly as before.
- The right-edge clipping this release found and left alone was fixed in
  v3.84.0 below, together with the journey itself.

### The journey pins on a phone too (v3.84.0, 2 Sept 2026)

Youssef: "the animations when you scroll down on desktop is very different to
mobile. On mobile it doesn't have that cool journey one by one effect, it's
just I could see all of the seven steps at one go."

- **Below 961px the journey was explicitly unstacked**: `.journey-stages`
  became `display:block` and every stage was forced `visibility:visible;
  opacity:1; --w:1`, so all seven sat in a list. That was the right call while
  the scene could not be pinned, and the reason it could not be pinned was a
  bug, not the phone.
- **`1fr` has an automatic minimum of min-content.** The mobile override read
  `grid-template-columns:26px 1fr`, so the filmstrip and the URL chip inflated
  the column to **449px inside a 390px viewport** and `overflow:clip` cut the
  copy off at the right edge. The same trap bit at three nested levels --
  `.journey-main` is a flex item, `.journey-stages` a grid, and
  `.journey-stage` a grid with an implicit auto column; each needed
  `min-width:0` or `minmax(0,1fr)` before a stage would sit inside 320px.
  Measured after: **0 elements past the right edge in the whole scene**, from
  125 before.
- With the column honest, a stage fits: 428px against 844 of screen. So
  `.sc-journey` pins at every width (430vh on a phone against the desktop's
  520 -- a phone reads a stage sooner and a thumb travels less) and the
  engine's active-stage stamp no longer asks whether the viewport is wide.
  **Measured at 390, 375 and 430: seven distinct one-stage-at-a-time states,
  the same count desktop produces, and the desktop walk is unchanged.**
- **The hero and the one-frame scene stay unpinned on a phone** -- their
  content is 1116px and 1306px against 844 of screen (v3.83.1). Only the
  journey fits, and only the journey is pinned.
- **The v3.83.1 reveal seeding had to drop `.journey-stage`.** `.mjs .reveal`
  is two classes and `.journey-stage` is one, so the reveal's `opacity:1`
  outranked the windowing and left all seven drawn on top of each other --
  the very symptom being fixed, reintroduced by the fix before it. Found by
  reading the computed `--w` rather than by looking.
- **A scene out of range now gets `--p` stamped to the end it is past** (0
  below, 1 above) instead of being skipped. Unstamped means the CSS default
  of 1 -- the FINISHED pose -- so the journey flashed its seventh stage before
  the engine first reached it.

### The motion system that grew on top of it (v3.64.0–v3.69.0, 31 Aug 2026)

All of it rides the same engine and the same guarantees; a new scene should
join it, not invent a sibling.

- **One rAF scroll handler** in `src/public/marketing.js` stamps `--p` (0→1)
  on every `[data-scene]`, plus `--scroll` and the `condensed` class on
  `<html>`. Derived counters live in CSS: the walkthrough's `--ps` (step
  index, `--p * 4.4`) and each step's window `--w`. **Every formula resolves
  to the finished pose at the default `--p:1`**, `html:not(.mjs)` forces the
  windows open, and the reduced-motion block un-pins every tall scene — that
  triple guarantee is what makes the scroll story safe to extend.
- **Homepage scene order (v3.72.0, after the de-duplication pass)**: hero →
  moments rail (ends by SELECTING one clip, `.strip-pick`) → THE JOURNEY
  (`.sc-journey`, 520vh: the ONE canonical workflow — seven stages stacked in
  one grid cell, windowed by `--js` = `--p * 7.7`; a rail line fills with
  progress, nodes light as passed, the engine stamps `.on` on the active
  stage to gate visibility/interactivity; the Lecture/Quran radios live in
  stage 2 and auto-flip across it) → one-frame comparison → template gallery →
  review beats (safety only) → DeenAI → pricing → FAQ → final. The flow band,
  studio walkthrough, standalone chooser and chapters stack were DELETED at
  Youssef's instruction — the workflow may be explained ONCE. Do not add a
  second telling. Proof sections carry one ambient scrubbed property each so
  no default-motion scroll interval over ~25vh is passive (audited by
  stepping 25vh and checking each scene's `--p` advanced).
- **The chooser (`.sc-choose`) is CSS radios driven two ways**: clicks, and
  the engine setting `checked` from scene progress (first half Lecture,
  second half Quran) on wide viewports only. If its panels change, keep both
  paths working.
- **The brand seal** (`.brand-seal` in `layout()`) wraps `logoMark()` —
  logoMark itself is [SRC]-test-pinned and must stay untouched; the ring is a
  separate 28s-rotation svg, condensing via `condensed` and resolving back to
  the full wordmark at `--scroll ≥ .965`.
- **Route veil**: 170ms `.leaving` fade on plain same-origin link clicks,
  cleared by `pageshow` (bfcache-safe); modified clicks/anchors/mailto pass
  through. Skipped under reduced motion.
- **Traps already paid for**: the header's `backdrop-filter` makes it the
  containing block for `fixed` descendants (the drawer is `absolute` with
  explicit height for that reason); dropdown items carry a hidden/staggered
  base on desktop that the ≤960 block must keep force-visible; and a
  `max-content` child inflates a stage's auto grid column
  (`grid-template-columns:minmax(0,100%)` on `.sc-stage` is load-bearing).
- Two sections were built and then removed at Youssef's call: the paper
  two-paths cards ("kinda useless") — its meaning now lives in the one-frame
  scene and the chooser. Check with him before resurrecting anything like it.

## The dashboard gained a motion layer without a redesign (v3.73.0, 1 Sep 2026)

Youssef authorised a refinement pass tying the studio to the rebuilt public
site — explicitly NOT a redesign. Everything lives in the hand-written
`src/public/studio-motion.css` (linked after studio-tokens.css, allowlisted
in server.js) plus two small hooks in index.html; no generated file was
touched and no design re-import happened.

- **Selectors bind ONLY to re-import-stable hooks**: ids, literal dc-*
  classes, literal data attributes, and host-owned .slb-/.slh-/.studio-conn-
  classes. Never .sNN (renumbered on re-import) and never a JS-added class on
  a generated node — the runtime patcher strips those.
- **The patcher DIFFS, it does not rebuild per poll** (studio-runtime patch();
  identical markup never touches the DOM). Several old comments still claim
  wholesale innerHTML per poll — the gating advice stands, the mechanism
  description is stale.
- **Screen switches could not restart their animation between screens that
  share a wrapper class** (Home and Library both render the same generated
  class), which read as a dead switch. paintStudio now re-toggles
  body.dc-screen-anim on every ui.screen change; skipped while the tour is
  up because its spotlight measures live rects per paint.
- **`*{animation:none}` under reduced motion never matches pseudo-elements**
  — any ::before/::after animation needs its own reduce kill. Also restored
  there deliberately: the processing spinners and progress-width transitions,
  because a frozen spinner reads as a hang (status motion is essential).
- The layer: rail active trace + icon nudge, 14s idle brand light pass
  (paused via body.dc-page-hidden), shine on live progress fills only while
  jobs run, connections-scrim fade, schedule-card lift ([data-dc-sched-card]),
  press feedback on chrome buttons only (never editor precision controls),
  studio-wide :focus-visible ring, and a one-per-session arch arrival veil
  when coming from the public site (sessionStorage dcArrived; skipped warm,
  deep-link and reduced-motion).

## The ayah was rendering as floating tashkeel with no letters (v3.40.0, 30 Aug)

Nobody had ever looked at a frame from the Arabic path. Asked to prove the
render quality, the first frame rendered showed it: the ayah drawn as a row of
disconnected vowel marks hanging in space, with no letterforms underneath, and
the English translation beneath it perfectly fine.

- **The cause was the face, not the code.** `quran_font()` prefers
  `KFGQPC HAFS Uthmanic Script`, which the image bundles from `worker/fonts`.
  Rendered through libass 0.17.1 + HarfBuzz 8.3, that file draws marks and the
  U+06DD medallion and NOTHING for base letters. Amiri renders the identical
  string correctly through the identical libass in the identical container,
  which is what makes it the font rather than the pipeline.
- **Every cheap check said the font was fine, and that is the lesson.** Its
  cmap covers all of 0600-06FF; the glyphs behind those codepoints are real --
  1572 of them, ordinary contours, sane bounding boxes (qaf is 3 contours,
  284 bytes, 70..1045 x); fontconfig resolves the family straight to the right
  file; only 4% of the glyphs are empty and they are scattered, so the
  positional forms are not blanked either. Coverage, resolution and outlines
  all pass. The frame still comes out with no letters.
- **So the guard renders.** `face_draws_arabic()` draws one joined Arabic word
  over black and counts lit pixels, cached per family, and `quran_font()` skips
  any face it has WATCHED fail. It **fails open**: ffmpeg missing, slow or
  unhappy answers True, so a probe that cannot run never costs a render its
  mushaf face. It may only ever demote a face proven blank.
- **Two contradictory comments were sitting in that function** -- "Amiri first,
  deliberately" immediately above "KFGQPC HAFS first" -- which is what a change
  made without rendering a frame looks like in the diff.
- Measured after the fix, same three ayat, real `write_ass`, real matcher:
  lit rows 76 -> 190, 149 -> 177, 82 -> 187, and **zero rows touching either
  edge in all three**, so invariant 8 holds on this path too.
- **Not yet confirmed on the box.** This is a stock Debian ffmpeg/libass and
  the same bundled font file, so the box is very likely identical -- but the
  worker image is not this container, and the honest statement is that the
  frame has been proven here and not there. Render one Quran clip after the
  deploy and look at it.


## One clip, several accounts on a platform (v3.41.0, 31 Aug 2026)

Youssef: "studio permission subscriptions where they can post up to 8 clips a
day with up to 3 channels for each social media". The 8 a day was already
built (v3.34.0); this is the other half. **Studio 3 / Pro 1 / Basic 1.**

- **The cap is two limits multiplied, and only one of them is about money.**
  `billing.accountsPerPlatform(user, provider)` returns 1 unless the account is
  Studio AND the platform's credentials can actually hold more than one. Meta
  stores `{ provider: 'meta', accounts: [...] }` -- one Facebook login carrying
  many Pages -- so Facebook and Instagram fan out today. YouTube and TikTok
  store ONE connection each, so their answer is 1 whatever the plan, and no
  picker is drawn for them: a second YouTube slot would be a control that
  cannot reach an export (invariant 9).
- **`atLeast`, not `paysForAtLeast`.** This is feature access, so the operator
  is not locked out of their own product. The money-based check stays for queue
  position and posting slots, where counting the owner as Studio would let a
  test import preempt a paying customer.
- **The list is derived at read time, not migrated.** Every record on disk holds
  a single `accountId`; `withAccountList` builds `accountIds` from it and keeps
  `accountId` as the first entry, so every reader written before this release
  works untouched. The WRITE side is a different function on purpose:
  `mergeAccountList` lets whichever key the caller supplied win, because reusing
  the read-side merge meant a caller naming `accountId` alone -- every caller
  written before this release -- was outvoted by the stored list and kept
  posting to the old account.
- **A target has an `id` now** (`provider:accountId`). Retry used to select by
  provider, so with three Pages on a clip one Retry re-armed all three and wiped
  their error text, and no button could address a single Page. The old string
  signature still means "the whole platform" for callers that pass one.
- **The cap is applied at the route AND at target-build time.** A settings
  record outlives the plan that wrote it: three ids stay on disk when Studio
  lapses to Pro, and the render path must not keep posting to all three because
  a past subscription once permitted it.
- **The route derives `accountId` from the list before validating.** Found by
  the HTTP test: `validatePublishingSettings` runs on the route's object before
  the store normalises it, so a save carrying only `accountIds` -- which is what
  the picker sends -- was refused with "Choose a connected account" for accounts
  that were connected all along.
- Every destination is named `platform (Account)` in the activity log, the
  stage text, the error text and the summary email. Three Pages otherwise read
  as "facebook, facebook, facebook", and "facebook failed" three times over.
- The picker lives in `#studioConn` in index.html, which is hand-written rather
  than generated, so this cost **no design re-import** and no regenerated class
  names.


## A platform slot holds several credentials (v3.56.0, 31 Aug 2026)

Stage 2 of "3 channels for each social media". Stage 1 let the SETTINGS name
three accounts; this is the store learning to hold three CREDENTIALS, so
YouTube and TikTok join Facebook and Instagram.

- **`socialConnections[userId][provider]` may be a LIST now.** Normalised on
  read (`connectionListFor`), so a bare object written by any earlier build is
  a list of one and nothing had to be migrated. `setConnection` still assigns
  the slot and is what Meta uses; `addConnection` adds alongside.
- **Connecting at a limit of ONE still switches**, deliberately. Pro and Basic
  have a single slot, and refusing there would leave them unable to change
  channel without finding Disconnect first. Accumulation, and the refusal past
  the cap, apply only where the plan permits more than one. Past the cap it
  throws rather than evicting the oldest: silently dropping a channel someone
  publishes to is not a decision that function gets to make.
- **Every credential path resolves by account id.** `youtubeToken`,
  `tiktokToken`, `queryTikTokCreator`, `uploadYouTube`, `startTikTok`,
  `pollTikTok` and `testConnection` all take one. Reading "the user's YouTube"
  instead uploads a clip aimed at channel B with channel A's bearer token --
  three targets, three reported successes, three post URLs, one channel. The
  TikTok half is worse than wrong: polling account B's publish_id with account
  A's token never reaches PUBLISH_COMPLETE, so the target sits in moderation
  for ever.
- **A blank account id is honoured only when exactly one connection exists.**
  It used to match unconditionally, which was harmless with one connection and
  is the wrong-channel bug with several. Every record written before this
  release has a blank id and must keep publishing, so ambiguity refuses rather
  than guessing.
- **The YouTube retention sweep had to be taught the list.** It read each
  provider slot as a connection and checked `.provider`; an array has none, so
  every channel would have been skipped SILENTLY -- and policy III.E.4 is an
  obligation, not a nicety. A compliance job failing quietly is worse than one
  failing loudly.
- **TikTok consent is per account** (`clip.tiktokConsent`), because one clip to
  three TikToks is three posts and their guidelines make consent a per-post
  act. `tiktokConsentAt` stays and still counts, or every clip already approved
  and waiting in the schedule would be stranded.
- **Disconnect names an account**, and only switches the platform off when
  nothing is left on it. Disconnecting one of three channels used to switch
  YouTube off for the other two.
- **The dialog's per-account × is drawn for YouTube and TikTok only.** Facebook
  and Instagram are Pages inside ONE Meta login, so a per-account disconnect
  there would tear out that login and take the other platform with it. Caught
  before it shipped; unticking is the right gesture for a Page.


## Saying which plan you are on, and what it does not include (v3.57.0, 31 Aug)

Youssef: "show users there subscription on the top how would they know wahat
subscrition they have and lable and show things if locked".

- **The header said `Studio_monthly`.** `planLabel` capitalised the raw plan id,
  and the id carries the billing period now, so the one place the app names the
  subscription was spelling an internal identifier at the customer. The server
  names it (`current.planName` -> "Studio · monthly", "Pro · weekly", "Basic")
  so the header, the tokens screen and anything added later cannot disagree.
  The three legacy ids normalise, so a `weekly` subscriber reads "Pro · weekly".
- **`current.locked` names what the plan does NOT include**, each with the tier
  that would -- derived from the same FEATURES table the gates read, so a
  feature cannot be locked without being explainable.
- **A locked thing is labelled, not absent.** The connections dialog drew no
  account picker at all for a non-Studio account with two Pages connected,
  which reads as the app having lost them. It now says which plan posts to
  three and offers the plans screen. A statement and a link is not a dead
  control; silence is worse than either.

## Each TikTok chooses its own audience (v3.57.0, 31 Aug 2026)

- **`settings.tiktok.accountOptions[accountId]`** holds privacy, the three
  interaction toggles and the commercial-content disclosure per account. One
  clip to three TikToks is three posts, and their guidelines make the audience
  a per-post decision -- a shared value carried one creator's choice onto two
  other accounts, and each account has its own allowed options, so it might be
  one the second account does not offer at all.
- **The flat fields remain the fallback**, so every record written before this
  keeps posting exactly as it does today. `tiktokOptionsFor` is the one reader.
- **Validation is per account** and names the account only when there is more
  than one, so a single-account save reads exactly as it always did.
- **The dialog switches rather than triplicating.** One account selector above
  the same controls; the values follow the selection, and a save writes that
  account's slot AND the flat fields so the two stay in step.
- The route rebuilds `accountOptions` key by key (`tiktokAccountOptions` in
  server.js) rather than spreading a customer's object into stored settings: a
  sub-option arriving true with its parent disclosure off would post a
  declaration nobody made, which is the rule TikTok's review is strictest about.


## The help centre, inside the dashboard (v3.59.0, 31 Aug 2026)

Youssef: "a help tab ... it's like learning modules ... splits up everything
into categories ... and it comes with screenshots ... there'll be also a
contact us for any additional helps or referring a bug."

- **The words are in `src/help.js`, apart from the machinery** -- the same
  arrangement as `seo-copy.js` beside `seo-pages.js`, and pure data with NO
  imports so the server, the tests and anything added later can read it without
  an import cycle. Eight categories, twenty articles, every one ending in steps
  somebody can go and do rather than a description.
- **Every screenshot is a real capture of this app**, taken by driving the
  running product with Playwright, not drawn and not a mockup. The capture
  script seeds a plausible account first: an empty app photographs as empty
  states, which teaches nothing.
- **A capture can teach the OPPOSITE of the truth, and nearly did.** The
  connections dialog shot came out reading "UNAVAILABLE -- not set up on the
  server yet" on all four platforms, because the local instance had no OAuth
  app configured. A customer reading the article on connecting would have
  concluded the product cannot connect anything. Placeholder `*_CLIENT_ID`
  values (never real credentials) make the dialog render its true first-run
  state: NOT CONNECTED, with a live Connect. **Look at what a screenshot
  actually says before shipping it, not just that one was taken.**
- **Every screen arms its OWN tour, keyed `dcTour:<screen>`**, and each lays a
  fixed veil over the viewport. The first eight captures came out as a grey
  wash over dimmed content -- the trap this file already warns about, hit
  again. Set `dcTour:<screen>` for every screen before loading. Removing
  visible fixed overlays as a backstop is fine; removing them blindly is not,
  because the connections DIALOG is one, and doing that deleted it and the next
  shot failed on a null node.
- **`$('#id')` is the form `check-ui.mjs` asserts against real markup**, so a
  host-CREATED node must be found with `getElementById` -- which is what every
  other host panel here already does. The screen is mounted into `<main>`
  beside `#dcRail`: an id and a tag name, neither of which the design export
  controls, so this cost no re-import and no regenerated class names.
- **`paintHelp` is in `paintStudio()`'s list**, not on a MutationObserver --
  the lesson v3.53.5 paid three attempts for. Verified across a state poll:
  8 cards before, 8 after, still mounted.
- **The screenshots enlarge on click.** At 320px in the column the text inside
  a capture is unreadable, and that text is the entire reason the capture is
  there. Escape and the backdrop both close it; both were tested rather than
  assumed.
- Two glyphs (`ph-flag-banner`, `ph-plugs`) were **not** among those seen
  rendering in the live app, so they were swapped for ones that are -- the
  `ph-seedling` rule, applied before it cost a release this time.
- The test asserts what fails SILENTLY: a referenced screenshot that is not on
  disk (a broken image in front of a customer, no error anywhere), an image on
  disk nothing references, an article with no steps, and the claims that must
  move if the product does -- the editor being gated, nothing posting without
  approval, no platform sending audience numbers back. Help is behind sign-in
  and behind NO plan gate: a free account is exactly who needs it.

### The subscription sits beside the logo (v3.60.1 — REMOVED v3.73.1, 1 Sept 2026)

**Removed at Youssef's instruction** ("REMOVE PLAN FROM TOP LEFT"): the rail
badge collided with the collapse control once the motion layer's brand sheen
made #dcRailBrand position:relative — which also hijacked the collapse
toggle's bottom:12px anchor (the toggle lives inside the brand row,
positioned against the RAIL). The sheen is now an animated background on the
brand block, needing no positioning; the toggle is back at the rail's foot;
paintPlanBadge and its CSS are deleted. The HEADER chip remains the one
place the plan is named. The section below stays as the record of why the
badge existed.

Youssef: "on top left corner next to logo show users subscription". Asked
twice now -- v3.57.0 put the plan name in the header chip, and that was not
where anyone looks.

- **The wordmark's second line is the literal string "Studio" inside the
  generated template** -- the PRODUCT's name, not the customer's plan -- so it
  could not be rewritten to carry the subscription without a design re-import,
  which regenerates every hashed class name in the app. The plan is therefore
  ADDED under the wordmark (`paintPlanBadge`, host-rendered) rather than
  written over the branding.
- **The brand row is a flex ROW**, so the badge takes the full width and the
  row is allowed to wrap -- that puts it on its own line beneath the wordmark
  instead of squeezed beside it, where "Studio · yearly" has nowhere to go.
  The collapse control is absolutely positioned and out of flow, so wrapping
  cannot disturb it. Measured: 191px wide, no ellipsis at any of the four plan
  names.
- **It is a button, not a label.** Knowing which plan you are on and having no
  way through to it is the worse half of the same question; it opens Tokens &
  billing. Verified by clicking it.
- **Basic does not wear the gold.** Gold is what every paid tier wears across
  this app, so a free account gets the quiet border and an invitation. The
  first measurement said Basic was gold and the CODE was right -- the probe
  spread the override onto the OPERATOR's billing row and left `unlimited:
  true` set. Clear the field being tested, not just the ones you are setting.
- **Collapsed, it goes with the wordmark.** There is no wordmark to sit under
  at 68px and no room for the words. Verified collapsing and reopening with a
  real click.
- **The header chip stays, deliberately.** `#dcRailBrand` is
  `display: none` on a phone, so the badge is desktop-only; the header is where
  a phone reads its plan. This is the one place duplication earns its keep.
- `paintPlanBadge` is in `paintStudio()`'s list, like every other host panel.
- A Studio subscriber sees "STUDIO" under the wordmark (the product) AND
  "STUDIO · YEARLY" in the badge (the plan). Redundant-looking but honest;
  removing the brand subtitle needs the re-import above.

### Help does not load, and the rail has a bottom (v3.59.2)

Youssef: "why does help need to load? ... organize the left hand tabs to look
just a lot neater and a bit nicer."

- **The help content is the same bytes for every account and changes only when
  someone deploys, so there was no reason to make anyone watch it arrive.** It
  is fetched once in `boot()`, in the background and never awaited, so it is
  already in hand before anyone clicks Help. Measured: the "Loading help…"
  state is now painted **0 times** on a click, with all 8 cards present
  immediately. The fetch is still swallowed on failure -- help failing must
  never stop the app booting -- and `json()` keeps its `no-store`, so a deploy
  cannot leave a customer reading last week's instructions.
- **The rail ended 340px short of its own bottom.** Measured at 1440x900: the
  last item finished at y=560 in a 900px column, which reads as a list that ran
  out rather than a column that was designed.
- **The group headings are literal strings in the generated template**, so what
  "Produce" and "Set up" MEAN can only be earned by what goes in them --
  renaming needs a design re-import, which regenerates every hashed class name
  in the app. Produce is now the working loop end to end (library, queue,
  schedule, **performance** -- which had been filed under Set up, though nobody
  configures it); Set up is only the two configure-once screens.
- **DeenAI, Help and Owner are the rail's tail**, anchored at the foot above
  the collapse row with a hairline over them -- the assistant, support and the
  operator's door are not steps in anybody's workflow. `dc-nav-tail` rides on
  `mobileClass`, which the template ALREADY binds as the class attribute, so
  this cost no re-import.
- **The CSS is inside `@media (min-width: 821px)` deliberately.** The same nav
  element becomes a bottom TAB BAR on a phone, laid out in a row, where a
  vertical `margin-top: auto` pushes a tab out of line. Every tail item is
  `dc-nav-secondary` and therefore already hidden there -- scoping the rule
  means that stops being something anyone has to remember, and a test asserts
  no tail item is ever promoted to primary.
- Verified by measurement at **900, 768 and 700px tall**: no overlap with the
  collapse row, no nav overflow, an even 18px under the last item at all three;
  collapsed to 68px and back with a real click; phone still five tabs on one
  row with no horizontal overflow.
- **`dc-nav-tail` is the only thing holding the cluster down**, and losing it
  fails silently -- the app renders, the suite stays green, the sidebar just
  goes back to being top-heavy. `test/rail-nav.test.mjs` was proven RED against
  the hook's removal before being kept.
- **An adapter test must copy values out of the vm realm.** `bindings()` runs
  in a `vm` context, so the arrays it returns are that realm's `Array` and
  strict `deepEqual` rejects them on the prototype -- "same structure but not
  reference-equal". `Array.from` is the host's and fixes it.

### The suite had a 1-in-6 abort and it was invisible (v3.59.0)

Found while verifying the above, and it predates it -- reproduced on the base
branch WITHOUT the help changes.

- **Twenty-one test files picked a random port inside 37000-43900. Linux's
  ephemeral range is 32768-60999**, so the kernel could hand the same port to
  an outgoing socket between the choice and the `listen`. The file died with
  EADDRINUSE and the run reported **fewer tests** -- 958 or 993 instead of 998
  -- rather than a failure anyone would read. Four files also shared one
  window and could collide with each other.
- Measured: **2 aborts in 16 runs before, 0 in 14 after.** Fourteen runs cannot
  prove zero; they can show the shape is gone.
- Every file now has its OWN window below 32768 (17000-20250, 100 wide). The
  four files that already use `PORT = '0'` and read `server.address().port`
  back are the better pattern for anything new.
- This is the worst shape a red branch can have -- it almost never reproduces
  on the run you are looking at, and a phone session that cannot trust the
  tick has no way to check anything.

## The Schedule told a Studio customer "four" and gave them eight (v3.71.3)

Found by answering Youssef's question — "show me how a studio plan can post 8
times and connect 3 channels" — by actually driving it rather than describing
it. The three-channel half was already right, end to end: three credentials in
one platform slot, "POSTING TO 3 OF 3 ALLOWED", a tick and its own × per
account. The eight-a-day half was right in the SCHEDULER and wrong everywhere
a customer could see it.

- **`/api/state` sent `config.postTimes` to everybody.** `agent.js` has always
  asked `slots.js` for `config.postSlotsStudio` windows when the owner
  `paysForAtLeast('studio')`, so a Studio account was scheduled into eight
  windows while being shown four. The feature they pay for was invisible, and
  the app contradicted itself. The payload now derives the account's own list
  from the same function the scheduler uses — one source, so they cannot drift.
- **Three separate literal `4`s on that screen**, which is how they were able
  to disagree: the header subline ("Up to four posts a day"), the sentence
  ("2 of 4 scheduled today") and the meter (`[0,1,2,3]`, four bars). All three
  read one `daySlots` now. Measured after: subline "Up to 8", sentence "0 of 8",
  eight bars, and all eight times in the Posting windows card.
- **It falls back to four when the payload carries no `postTimes`** — an older
  browser, or a misconfigured server. Counting an empty list honestly gives
  zero, and `todayCount >= 0` is true, so the card read "Today is full" beside
  an empty day. A test already existed for exactly that and caught it.
- **"Nothing posts unless its four checks pass" is a DIFFERENT four** — nasheed,
  captions, Clip Style, render — and does not move with the plan. Left alone.
- The HTTP test extends the ONE sign-up that file already spends (the sign-in
  throttle is real, and a suite that spends it reports a broken route when the
  route is fine): it reads `/api/state` as Studio, asserts the eight, drops the
  plan to Pro and asserts the four come back — a lapsed subscription must not
  keep being shown what it no longer buys. Proven red against the old payload.
- **Seeding trap, cost twenty minutes:** publishing settings live under
  `state.userSettings[userId].publishingSettings`, not a top-level
  `state.publishingSettings[userId]`. Seeding the wrong shape renders as
  "POSTING TO 0 OF 3" with every box unticked, which reads exactly like a
  broken picker and is not one.

## Studio's capacity is drawn, not just scheduled (v3.72.1)

Youssef's own design, and the right one: "you see how it has four dots? You
can make another four dots underneath... you don't make them a gray color...
a faint gold, and once it's filled in, a more obvious gold."

- **The month calendar drew four pips on an eight-post plan** -- the same lie
  the header was telling before v3.71.3, in the one place a customer looks to
  see how full a day is. Eight now, in two rows of four, and the EMPTY ones in
  faint gold (`rgba(217,180,120,.26)`) rather than grey: the capacity the plan
  buys reads as something you were given before anything fills it. Filled stays
  solid `#D9B478`. **Everyone else keeps the grey**, or the gold stops meaning
  anything.
- **The pips are positioned from their OWN inline styles**, absolutely, inside
  the cell (which was already `position: relative`). Their container is a
  generated class -- `inline-flex`, no wrap -- so a second row would have
  needed CSS hung on a hashed name that a design re-import silently
  regenerates. This way the export cannot break it.
- **`studioSlots` reads the TIER, not "more than four"**: the base window count
  is a server setting and an operator could configure six tomorrow.
- **"+N more" was falling through the bottom border.** Measured at 1440x950:
  the cell is 101px and a header plus three chips plus the more-line came to
  112. Fixed by showing one chip fewer whenever there is a count to show, not
  by clipping -- `overflow: hidden` hides the number rather than fitting it,
  which is not the same thing. It stays as a backstop. Measured after: 0 of 35
  cells with anything escaping.
- **The connections dialog answers "how do I know I can connect three?"** The
  picker only ever appeared once a SECOND account existed, so a Studio member
  with one channel was told nothing about the other two they pay for. With
  headroom it now says "Studio · 1 of 3 channels connected — press Connect
  again to add another"; with several it says "Posting to 3 of 3 allowed ·
  Studio". The cap is attributed to the plan in both.
- **The Posting windows card attributes them too**: "8 windows a day on Studio
  · Set on the server · Australia/Perth". Counting the times yourself is not an
  answer to "how do I know I get eight?".
- Both new tests were proven RED against four hardcoded pips and three chips
  before being kept.

## Two clips shipped under one title (v3.72.2, 1 Sept 2026)

Found by reading the mailbox rather than the code: the "your clip is live"
emails show two different clips both posted as **"I might find myself in this
situation"** on 31 Aug, and "It's meant to be deceiving" twice. On a public
channel that reads as the same video uploaded twice.

- **It arrives from BOTH directions.** `refine_with_ollama` titles in batches
  of four that cannot see each other, so a small model repeats itself across
  them; and where no AI title survives, `title_from_text` takes the clip's
  FIRST sentence -- which for two clips over the same moment is the same
  sentence. Fixing only the prompt would have left the fallback path repeating.
- **`dedupe_clip_titles` runs in `title_selected_clips`**, which already runs
  after selection over exactly the clips that ship -- the only place that sees
  the whole set that can collide, and at most `MAX_DELIVERABLE_CLIPS` of them.
  Line 3616 (`candidate.ai_title or title_from_text(...)`) is unchanged; the
  resolved title simply lands on `ai_title` first.
- **A duplicate is resolved from the clip's OWN later sentences, never by
  suffixing a number.** "Regret is Repentance (2)" on a public channel is worse
  than the repeat it fixes. `title_candidates()` was split out of
  `title_from_text` for this; `title_from_text` is now its first entry and its
  behaviour is unchanged (its existing tests pass untouched).
- **`normalise_title` decides what "the same" means**: case, a trailing
  ellipsis and punctuation are not differences a viewer would call a different
  title. **A longer version of a taken title counts as a repeat too** -- the
  first cut compared exact strings and happily shipped "I might find myself in
  this situation" beside "I might find myself in this situation one day",
  distinct by the letter and the same line twice to anyone scrolling. That
  shape is the common one, because the model shortens a sentence the fallback
  titler then takes in full.
- **A clip with nothing else to offer keeps its title.** Keeping a real title
  beats inventing a bad one, and that is the honest limit of this pass.
- **Per LECTURE, not per channel.** Two clips from two different lectures can
  still collide; that would need the app's stored clips rather than the
  worker's in-memory set. The observed duplicates were consecutive slots from
  one lecture, which is what this covers.
- Proven RED against the pass being disabled (3 of 34 titling tests fail).
  **Worker change, so `deploy-worker.yml` deploys it on push** -- and it only
  affects lectures processed from now on. The duplicate titles already on the
  channel stay until those clips are renamed by hand.

## The watermark is on by default, top centre, and Basic cannot remove it (v3.72.8)

Youssef, 1 Sept 2026: "The Show watermark should be ticked on for all basic
accounts and actually should be a default for all of them. And the watermark
should be in the middle top for all accounts whenever they post... basic cannot
turn it off."

- **The defaults in `templates.js` already said exactly that** -- `watermark:
  'DEENCLIPPED'`, `watermarkOpacity: 100`, `watermarkPosition: 'top-center'`.
  What was overriding them is the five shipped built-ins in `src/templates/`,
  every one of which carried `watermark: ''`, `opacity: 0` and a bottom
  corner. That is why the switch read as off on a fresh account. Four of them
  now carry the real default.
- **The paywall needed nothing.** `assertWatermarkAllowed` already refuses a
  save that empties the text OR zeroes the opacity for a non-paid account, and
  the Templates row already renders the switch `disabled` for them. Measured
  after the change: Basic sees it CHECKED and LOCKED, with "Removing it is on
  Pro and Studio"; a paid account sees it checked and free to change.
- **Quran Recitation is the one exemption**, and it is deliberate: nothing is
  drawn over the top of scripture -- no watermark, no brand line, no hook, no
  caption box -- which has its own test in `pricing.test.mjs` and is why the
  first pass went red. Top-centre would have put the mark straight over the
  ayah. **This paragraph used to end "it opens no free-plan hole, because that
  template is Pro-only" -- that stopped being true on 3 Sept 2026** when the
  template went free (see *The scripture template is free* below). A free
  account can now publish a recitation clip with no mark burned into the
  frame; the attribution moves to the caption's credit line rather than
  disappearing.
- `test/pricing.test.mjs` now pins the default across every built-in and
  skips that one by id, so the exemption is stated rather than looking like an
  oversight.

## The template preview shows one photograph now (v3.72.9, 1 Sept 2026)

Youssef sent a picture of a speaker at a microphone: "that's the photo going to
be for the template at all times."

- **It used to be two different pictures.** The newest lecture's own
  `sourceThumbUrl` when the account had imported anything, and a grey SVG
  illustration when it had not. So the screen that teaches what a template does
  looked different on every account -- and was emptiest on the brand-new one
  that most needs to see it. It is `/preview-sample.webp` for everyone now,
  served from this origin (so the studio's CSP covers it and a deploy cannot
  break it, neither of which was true of a remote YouTube thumbnail).
- **The photo is 9:16 -- the frame's own shape -- and that is the one real cost
  of the change.** Clip layout's three modes exist to show what happens to an
  imported 16:9 lecture: Fill crops the sides, Fit letterboxes onto the frame
  colour, Blur letterboxes over a blurred blow-up. Against a picture that is
  already vertical there is nothing to letterbox, so all three land within
  about a pixel of each other. Measured, not reasoned about: three captures of
  the frame, three different hashes, and the CSS genuinely differs
  (`cover` / `contain` + frame colour / `contain` + a visible `.pv-back`).
  **They are not dead controls** -- they still reach the export and still frame
  a real lecture -- but the preview no longer demonstrates them.
- **A 16:9 crop of the photo was built and rejected by looking at it.** Cropping
  720x1280 to 720x404 and letting `cover` put it back into the 9:16 frame shows
  the central 31.6% of the width: half a face. The alternative -- padding the
  portrait photo onto a 16:9 canvas -- is baked-in letterboxing pretending to be
  a source. Neither is worth the demonstration.
- **No note was added to the Templates screen.** The row template
  (`tplRow`) has icon/label/value/open and no note slot, so one would have to be
  host-rendered, and Youssef's instruction in the same message was "I love the
  template. Don't mess around with the template at all."

## Three small things the rail and the hero were missing (v3.72.11, 1 Sept)

- **The collapsed rail named nothing, and the fix was already built.** Every
  nav item ends in a `<span>` carrying its label, positioned to the right of
  the icon column and fully styled -- at `opacity: 0`, with nothing anywhere
  turning it on. A control shipped and never wired. Two lines of CSS in
  studio-tokens.css reveal it on `:hover` and `:focus-visible`.
  Three things that rule leans on: the reveal must be `!important` (the opacity
  is an INLINE style from `tipStyle`, which no stylesheet outranks); it cannot
  leak into the open rail, because the same inline style is `display: none`
  there and opacity does not un-hide anything; and it is behind
  `(hover: hover)`, because below 821px this nav is the phone's bottom TAB BAR
  where `:hover` sticks after a tap and a tip at `left: calc(100% + 10px)`
  would land on the next tab. `test/rail-nav.test.mjs` asserts BOTH halves --
  each is silent without the other.
- **The marketing site's rotating seal is on the rail** (Youssef: "that cool,
  like, animated top left logo on the main website ... Can we have that on the
  dashboard?"). Same ring, same words, same 28s rotation as `.seal-ring` in
  marketing.css -- deliberately not a second design. Host-injected
  (`paintBrandSeal`, in paintStudio's list like every other host panel) because
  the arch is drawn inside the generated template. **42px, not the site's 46:**
  the collapsed rail is 68px wide with 12px padding, so 44px is all there is.
  It finds the arch by `svg[viewBox="0 0 40 52"]`, never "the first svg in the
  row" -- once the ring is in, that finds the RING and wraps the wrapper on
  every paint. Measured: 1 seal and 1 ring after five consecutive paints.
  **The RING is bigger than the box it sits in** (v3.73.3, "the circle around
  the arch ... it's kinda overlapping a little bit"). At 42px its text circle
  has a radius of 16.4px and the arch is 34px tall -- 17px from the centre --
  so the words ran straight through the mark. `inset: -7px` makes the ring
  56px without moving the mark or growing the row: text radius 21.9px against
  the arch's 17, so 4.9px of clearance. It reaches 6px into the rail's 12px
  padding and stays inside it -- measured at x 6..62 in a 0..68 rail, with the
  rail `overflow: visible`.
- **The paste field was the smallest thing on the screen it starts.** Now
  `flex: 1 1 340px` in a 640px row (was 220 in 520) with a gold ring and glow,
  hooked on `data-tour="paste"` -- an attribute the design export does not
  control. Measured 365px wide, up from ~220.
  **It breathes, slowly** (v3.73.3, Youssef: "subtly pulsating, not crazy"),
  and only the outer halo moves -- a border that pulses reads as a control
  changing state rather than as light.
  **The replay trap this file warns about does not bite here, and that was
  MEASURED rather than reasoned about.** studio-runtime's `patch()` diffs, so
  markup that has not changed never touches the DOM and an ordinary state poll
  leaves both the node and its running animation alone: across five
  consecutive `paintStudio()` calls the animation kept its identity and its
  `currentTime` went on climbing (2817 -> 3100 -> 4300ms), never resetting to
  zero. The one thing that DOES rewrite this node is typing into it
  (`jobUrlVal` changes) -- and typing means focus, where the animation is
  switched off anyway. Any other infinite animation added to the studio should
  be checked the same way instead of being assumed safe OR assumed broken.

## The Lecture library's sidebar answers questions now (v3.73.4, 1 Sept 2026)

Youssef: "before you import, to be honest, all of them are pretty useless ...
tell me any good ideas to put in the lecture library on the side ... they're
not very informational or helpful." He then approved all five.

- **"Before you import" is gone.** Three warnings, in the most valuable column
  on the screen, that nobody reads twice. It is a literal `<section>` in the
  design export, so the host removes it -- found by its own heading text, since
  a re-import regenerates every hashed class name.
- **The arithmetic lives in the adapter (`libStats`), the DOM work in the host
  (`paintLibraryAside`).** Same split as every other host panel, and it means
  the figures are testable by CALLING `bindings()` rather than by reading
  markup. They are counted from the same projects and clips the Performance
  screen counts, so the two screens cannot tell different stories about one
  lecture, and no new route was added.
- **Mounted off `data-tour="lib-add"`**, an attribute the design export does
  not control. Registered in paintStudio's list, never on a MutationObserver.
- **A keep rate needs FOUR decided clips before it is shown.** With two, "50%"
  is one person's shrug wearing a percentage sign. Lectures under the floor are
  left out rather than ranked on noise.
- **The weakest lecture is named only when it is a different answer** -- one
  lecture is not a comparison, and printing the same lecture as both best and
  worst reads as broken. It also keeps the quiet grey rather than the red that
  means something failed: a low keep rate is information, not an alarm.
- **Minutes are counted on the SELECTED range**, not the lecture's full length
  (`sourceEndSec - sourceStartSec`, falling back to the duration). A 5-minute
  section of a 38-minute talk costs five minutes, and the section download is
  the whole reason that distinction exists.
- **Every block is null when it has nothing true to say, and an empty account
  gets no panel at all.** Verified in the browser: `#dcLibStats` is not drawn
  for an account with no lectures. A card padded out with "0 of 0" teaches less
  than no card.
- **Re-import offers only lectures with a URL that are not still working.** An
  upload has nothing to re-fetch and a lecture mid-import cannot be asked for a
  second range. Clicking fills the sidebar's own paste field rather than
  starting a job -- the range, template and clip count are still the
  customer's to set. Proven by clicking: the field took the URL.
- **No delete button was built, deliberately.** `DELETE /api/projects/:id`
  removes the whole project including its clips; there is no "free the source,
  keep the clips" operation, and inventing one under a storage tile is not a
  decision a sidebar gets to make. Storage states what it holds instead.
- Storage's three rows now carry a count AND a size. They used to read
  "0 / 0 / 0" beside a heading that already said "0 lectures - 0 clips".
- Every control was clicked rather than assumed: best -> that lecture's detail
  screen, a queue chip -> the review queue, re-import -> the paste field filled.
- **Seeding trap, cost two runs:** the state poll REASSIGNS `DATA`, so neither
  a plain seed nor an `Object.defineProperty` getter on the old object survives
  it. Clear the timers first (`for (let i = 1; i < 20000; i++) clearInterval(i)`)
  and then seed.

## Switching screens does not animate (v3.74.2, 1 Sept 2026)

Youssef, on the tabs: "it does a little glitch kinda thing where it looks like
it's refreshing the screen ... it looks horrible."

- **TWO animations were doing it**, and killing either alone leaves the other.
  v3.73.0 added `dcmScreenIn` plus a `body.dc-screen-anim` re-toggle in
  paintStudio to force a restart on every `ui.screen` change -- including
  between screens that SHARE a wrapper class, where nothing had ever animated
  before. Underneath it, the design export bakes
  `animation: dcScreen .24s` into every screen wrapper (`.s29`, `.s4j`, `.s8m`
  and seven more), which cannot be edited without a re-import regenerating
  every hashed class name in the app.
- **So the wrapper animation is CANCELLED rather than removed**:
  `#studio main > *{ animation: none !important; }` in studio-motion.css. The
  `!important` is needed because the generated rule is a class selector on the
  same element.
- **Scoped to main's DIRECT children, deliberately.** Every screen wrapper is
  one; everything with motion worth keeping is nested deeper -- the processing
  spinners (a frozen one reads as a hang), the progress fills, the rail seal
  and the paste field's glow. All four were re-checked after the change and
  still run.
- **Measured, and the measurement was proven able to fail.** Clicking through
  six screens: 0 running animations on main's children each time. Then the old
  behaviour was re-injected at runtime and the same probe reported
  `["dcmScreenIn","dcmScreenIn","dcmScreenIn"]` on every switch. A probe that
  cannot come back red proves nothing.
- The test matches the DECLARATION (`@keyframes dcmScreenIn`,
  `animation: dcmScreenIn`), not the name -- the comment recording what was
  removed mentions it, and a grep for the word fails on the explanation. That
  is the third time this repo has hit that shape.

## The operator is Studio everywhere except the queue (v3.75.2, 1 Sept 2026)

Youssef: "for admin account should be like studio with all perks."

- **The feature gates were already right** -- `tierOf` has counted the operator
  as Studio since v3.34.0, so every entry in `features` is true and `locked` is
  empty. What was NOT right was the posting capacity: `agent.js` and the
  `/api/state` payload both asked `paysForAtLeast`, which reads the account's
  MONEY and answers `basic` for an operator on a free billing record. So the
  owner was scheduled into four windows a day while holding every Studio
  feature -- and the Schedule screen drew four pips beside a plan that says
  Unlimited, which is the app contradicting itself.
- **Both now ask `atLeast`.** Measured after: 8 windows in the payload, "Up to
  8 posts a day", 8 meter bars, 8 calendar pips, "8 windows a day on Studio",
  and 3 accounts on all four platforms.
- **`queuePriority` in local-engine.js deliberately still reads
  `paysForAtLeast`, and that is the whole reason paidTierOf exists.** The
  distinction is no longer "features vs money" but **zero-sum vs not**: extra
  posting windows widen one account's own day and take nothing from anybody,
  while there is ONE worker slot, so an operator jumping the queue costs a
  paying customer their place. If that is ever changed it should be a
  deliberate decision, not a tidy-up of the last remaining `paysForAtLeast`.
- The gate-law tests were updated rather than deleted: `pro-and-blockers` now
  asserts agent.js uses `atLeast` AND that the paid check is gone from it (not
  merely joined by another), and `plan-gating` states which single thing
  paidTierOf still decides.
- **The operator check is a ROLE, not a plan** (`isUnlimited` reads
  `user.role`), so none of this opens a free-plan hole: a customer cannot set
  their own role. The HTTP test makes that explicit by flipping the role on a
  free billing record and asserting the eight windows.

## Account settings was a prompt() asking for a number (v3.75.3, 1 Sept 2026)

Youssef: "improve on account settings inside dashboard its so bad right now."

He was right, and it was worse than untidy. "Account settings" in the profile
menu opened a **browser `prompt()`** reading *"Type a number: 1 Manage or cancel
your subscription, 2 Sign out of every device, 3 Contact support, 4 Delete my
account and all my data"*. Cancelling a subscription and deleting every clip an
account owns were both behind a typed digit in an OS dialog.

- **It is a dialog now (`#studioAccount`), reusing the connections dialog's
  card, backdrop, close button and Escape handling** rather than inventing a
  second modal language. Host-rendered for the usual reason: adding a screen to
  the design export regenerates every hashed class name in the app.
- Six groups: who you are (avatar or initials, name, email, join date, plan
  pill), plan and billing, notifications, signing in, help, and delete.
- **Every row reaches something that exists.** Payment and invoices is drawn
  only when there IS a subscription -- the Stripe portal 404s without a
  customer, so a free account gets "See plans" instead of a button that goes
  nowhere.
- **There is deliberately NO change-password row.** Sign-in is a link or
  Google/Apple; `/auth/password` is the OPERATOR's shared secret, not a
  per-customer credential. A password row would be a control that cannot do
  anything (invariant 9). The panel says which provider you actually use
  instead, read from `user.providers`.
- **The email-notifications switch is the same one as the bell's**, calling the
  same `onToggleEmailNotifs`, so the two cannot disagree. Verified by clicking:
  the label flips and the write goes through.
- `paintAccount` is in **paintStudio's list** like every other host panel, and
  returns immediately when the dialog is shut -- that is what keeps the plan,
  the token count and the switch honest across a state poll while it is open.
  Verified: still open with all rows after three consecutive paints.
- **Two copy faults found by looking at the render, not the code**: an operator
  saw "Unlimited · Unlimited" (plan name and token line are the same word for
  them), and the identity line truncated a real join date to "joined June 1…"
  because the plan pill took the width. The sub-line wraps now.
- Deleting keeps BOTH gates -- a confirm and a typed DELETE -- and still warns
  that a subscription is not cancelled by deleting the account.

## Studio's week scrolls, and its extra dots are their own colour (v3.75.4)

Youssef, 1 Sept 2026: "FOR studio make it the same as a pro or basic account
where you get 4 clips and it looks more spacious ... make it scrollable for the
8 clips for studio ONLY ... also the 8 dots on monthly the 4 new dots should be
different color to show the subscrition i have."

### The week grid was punishing the plan that buys more

It divides its height between the posting windows, so at eight every row
collapsed to its **62px minimum** while Pro's sat at **106px**. Past four
windows the rows now take the height four would have had and the grid scrolls
inside the space it already occupies. Measured at 1440x1000: **62px -> 139px**,
grid capped at 625 with 1354 of content, and Pro untouched at 106 with no class
and no scroll.

**Three traps, each found by measuring rather than reasoning:**

1. **The grid is NOT capped by its parent** -- it grows and the whole SCREEN
   scrolls. So reading its own `clientHeight` after fixing the row heights fed
   itself: **1055 -> 1543 -> 40711px** across four repaints. The space is read
   from the nearest SCROLLING ancestor and the grid's offset inside it, neither
   of which moves when the grid gets taller.
2. **`flex: 1` on the grid means flex-basis 0, which beats any `height` set on
   it.** `.dc-week-tall` declares `flex: none` for that reason -- without it the
   measured height is silently ignored and nothing changes.
3. **A week holding a clip scheduled off the account's posting times grows an
   extra "Other" row.** Counting it made a four-window Pro account look like
   five and switched this on for them.

The weekday header is `position: sticky` inside the scroller: a column of cells
with no weekday above it is unreadable.

**The hook is `data-dc-week`, added to `design/studio-dashboard.dc.html`.**
Re-running `npm run design:import` was proven byte-stable first -- the generated
CSS came back identical and no hashed class name moved -- so an attribute is now
a safe thing to add when the host needs to find something the export owns.

### The four extra pips are a different colour from the base four

The base four are exactly what Pro and Basic draw: solid gold `#D9B478` filled,
quiet grey `#212127` empty. The four Studio ADDS are gold in BOTH states --
`#F0D6A6` filled, `rgba(217,180,120,.34)` empty. That second row is the only
pair of dots on the screen that never goes grey, which is what makes it read as
capacity this subscription bought rather than more of the same. Everyone else's
row is unchanged.

## The version guard refused every docs-only commit in CI (v3.76.5, 1 Sept)

Found by turning the branch red with a commit that changed only CLAUDE.md and
package.json.

- **`git rev-parse --is-shallow-repository` is TRUE for any depth-limited
  clone**, including the `fetch-depth: 60` that `ci.yml` already sets. The
  guard refused whenever that flag was true AND the `src/`+`worker/` diff was
  empty -- which is exactly a genuine docs-only commit. So every docs-only
  push failed CI, and the only reason nobody had noticed is that almost every
  commit here touches `src/`.
- The flag was never the question. What matters is whether enough commits are
  actually present to trust an empty diff and to run the version-uniqueness
  check, so the refusal now also requires `git rev-list --count HEAD` to be
  below the 60 it looks back over. `LOOKBACK` is one constant feeding both.
- **Proven both ways rather than reasoned about**: a `--depth 2` clone still
  refuses ("holding 2 commit(s)"), and a `--depth 60` clone (73 commits, still
  flagged shallow) passes with "no src/ or worker/ changes". A guard that
  cannot come back red proves nothing, and one that cannot come back green
  blocks the branch.

### A MERGE can fail the version guard while both sides bumped correctly

Hit on 3 Sept 2026 and it will happen again every time these two sessions
merge, so it is written down rather than re-diagnosed.

`758f25f` -- a merge, no hand-written code in it at all -- failed with
*"version stayed at 3.101.0 / changed: src/auth.js, src/config.js,
src/mailer.js, src/server.js"*. Both sides HAD bumped: mine to 3.101.0, theirs
to 3.100.0. The guard diffs against the FIRST parent, and because my side
already held the higher number the merge kept 3.101.0 -- unchanged against my
parent -- while pulling in four of their `src/` files. Their `src/` diff, no
version movement, red branch.

**The rule: when you merge and YOUR side already had the higher version, bump
again ON the merge commit.** When theirs is higher the merge moves the number
by itself and there is nothing to do -- which is exactly why the next merge
that day (`deb2191`, resolving to their 3.101.1) went green without anyone
touching it. A merge is not exempt from the release rule just because it wrote
no code; the guard is asking what this commit ships, and a merge ships
everything on the other side.

### The merge trap that produced that commit in the first place

`git merge` printed the conflicts, `tail -6` cut the list short, and the
conflict-marker sweep afterwards named four files by hand -- so the markers left
in CLAUDE.md were committed and pushed. They broke `check-handover`, whose
test-count line is a tripwire on shape as well as numbers.
**Sweep every file** (`grep -rln '^<<<<<<< '`), never a list you typed.

## The live row's tile was spinning with its glyph (v3.76.6, 2 Sept 2026)

Youssef: "that loading animation and the box behind are both rotating it looks
so bad."

- **The row's icon IS the tile.** `.slh-row > i` draws a 32px box -- border,
  warm background, radius -- and the same element carries the `ph-circle-notch`
  glyph, so animating it turned the box as well as the mark.
- **The spin was an INLINE style** written by the adapter (`iconStyle` in the
  live-jobs binding), which is the one thing a stylesheet cannot outrank -- the
  same lesson the rail tooltips paid for in v3.72.11. Three CSS overrides were
  written and measured as having no effect before the inline style was found;
  the probe reported `inlineStyle: "... animation: dcSpin 1.1s linear
  infinite;"` and settled it in one read. **When a CSS override provably does
  not apply, look for an inline style before adding `!important`.**
- It comes off the binding now, and the glyph's `::before` carries the rotation
  in both containers (Home card and floating bar), including inside the
  reduced-motion block -- without that the double rotation returns for anyone
  who asks for less motion. Measured: element `animation-name: none`, `::before`
  `dcSpin`, border and background intact.

## The live bar slides to its corner, and says so (v3.76.6)

Youssef: "arrow facing the right side cause it gets pushed to right side, ALSO
animation when moving to right side or when moving back."

- The caret read down/up while the bar travels sideways. It is **right** when
  open (that is where it is going) and **left** when collapsed.
- **`left: 50% -> auto` and `width: 600px -> auto` cannot be transitioned**,
  which is why it used to teleport. Both states are lengths now and both are
  positioned from the same anchor: the collapsed bar keeps `left: 50%` and is
  pushed by `translate: calc(50vw - 100% - 18px)` -- half the viewport, less
  its own width, less the margin. `100%` is the element's own width, so the
  expression stays correct while the width animates alongside it.
- Measured at 1440x1000: open x=420 w=600, mid-slide x=780 w=438, collapsed
  x=1102 w=320 with its right edge exactly 18px from the viewport; and back
  again through x=673. Reduced motion keeps the move and drops the travel.

## The other three platform marks are the real logos (v3.76.10, 2 Sept 2026)

Youssef: "remmebre when we changed the yt logo cause they told us too now the
others look off, fix the other 3 to look better same look like original yt."

- **Fixing one platform is what broke the other three.** The YouTube
  substitution was a compliance obligation (Policy III.F.2a,b), and once it
  landed the "Posting to" row was a full-colour, uncontained YouTube mark
  beside three Phosphor glyphs -- redrawn monochrome shapes, tinted with the
  dashboard's gold, each in a bordered tile. They read as placeholders for
  logos rather than as the logos. TikTok, Instagram and Facebook are now drawn
  exactly the way YouTube is: `::before{content:""}` suppresses the glyph and
  the official mark is drawn as a data-URI SVG background at the same 22px,
  page-wide, so no call site has to know.
- **TikTok is its on-dark form** -- the white note with the cyan (#25F4EE) and
  magenta (#FE2C55) offsets -- because the black-square version would be
  invisible on this background. Nothing is recoloured or reshaped.
- **":first-child" is what tells a tile from a row**, and adding it fixed a
  fault that had been shipping since the YouTube change. `:has(> i.ph-…)`
  alone also matched Home's "Posting today" rows, whose 1px top hairline is a
  DIVIDER between rows rather than a box around a logo -- so the YouTube row
  was the one row in that panel drawn without one. A tile holds the mark and
  nothing before it (the 34px box in "Posting to", the connections dialog's
  mark); a row ENDS with the mark, after a time, a thumbnail and a title.
  Measured after: tiles `rgba(0,0,0,0)`, rows back to `rgb(30,30,34)`.
  The discriminator is deliberately structural -- naming `.s48` would have
  hung the fix on a hashed class that a design re-import regenerates.
- **The YouTube rule is kept as its own declaration**, not folded into a comma
  list with the other three, so an edit aimed at them cannot take its half with
  it. Its compliance test moved with the selector and still pins the same
  property.
- Both new assertions were proven RED first: against a mark recoloured to the
  dashboard's gold, against a deleted mark, and against the tile-strip without
  `:first-child`. Every screen was swept for these icons afterwards -- only two
  container shapes exist in the running app, and both were measured.

## The worker audit, and everything it changed (v3.77.0, 2 Sept 2026)

Youssef: "check my ai worker in all aspects give me a rating for it and if we
can improve let me know", then "can we make ALL a 10". The audit read every
line of `worker/` and rated it 7.5/10; these are the changes that moved the
scores, each pinned in `test/test_worker_audit.py` (27 tests).

- **The scoring request never declared a context window.** `refine_with_ollama`
  sent ~2,800 tokens of prompt plus a 1,024-token answer with no `num_ctx`,
  while the DeenAI path set 4096 and tested it. Ollama's long-standing default
  is 2048 and it truncates from the FRONT -- so the transcript data survived
  and the instruction block (JSON shape, "never invent a speaker", "5-12
  words") is what was dropped. Four answer shapes, invented scholars, echoed
  lecture titles and arrays closed after one row are all what a model does
  when it has seen the data and not the rules. `AI_NUM_CTX = 4096` now
  (KV cache ~0.5G under the 2G cap), per-item text 1,400 -> 1,000 chars, and
  the budget is enforced in code: a prompt `estimate_tokens` says will not fit
  is asked in halves, so the rules always arrive. Arabic tokenises at ~2
  chars a token, so an all-Arabic batch of four goes as two pairs.
- **The answer is pinned to the batch by JSON schema.** `format` carries
  `clip_rows_schema(n)` with `minItems == maxItems == n`; Ollama constrains
  decoding to it, so the early close is undecodable. A server that answers
  400 to a schema gets plain JSON mode once and is remembered for the run
  (`_SCHEMA_FORMAT_OK`). The singles retry stays as the backstop.
  **Not yet proven on the box** -- the Ollama there is `latest` at build time;
  if the first deploy logs a 400 fallback, the image predates schema formats.
- **Only the Arabic is translated.** `translate_audio` re-ran Whisper over the
  WHOLE file whenever any Arabic was heard; an English hour with forty seconds
  of recitation paid a second full transcription. `arabic_spans()` clips the
  pass to the Arabic segments (padded 0.6s, merged) through faster-whisper's
  `clip_timestamps`; a pinned non-English language or Arabic in more than half
  the file still translates whole. An older library without the argument
  falls back to the whole file rather than failing the job.
- **`condition_on_previous_text` is False.** The classic repeat-loop setting
  for a small model on an hour of audio; VAD is already on.
- **The scorer speaks Arabic.** It found words with `[a-zA-Z']` only, so a
  lecture delivered in Arabic had NO words: -10 for under 35 words, -8 for a
  pace of zero, no hook, no power word -- half the catalogue scored on its
  duration and a full stop. `score_words()` tokenises both scripts (letters
  only -- the Arabic block also holds ؟ and the digits), strips harakat, the
  clitic و/ف/ب/ك/ل and the article so والقبر and قبر are one word; the power,
  story, claim, payoff and context lists carry Arabic forms; ؟ is a question
  mark and ۔ a full stop. **`QUOTE_RISK` is bilingual** -- invariant 1 had an
  Arabic blind spot: a hadith quoted in Arabic never forced review.
- **Filler and intro words match whole words.** `lower.count("like")` charged
  "likely", "unlike" and "Allah likes" -- up to -14 on a clip with no filler.
- **A job has a wall-clock budget** (`job_budget_seconds`): four times the
  selected stretch, floored at 90 minutes, or four times `maxSourceMinutes`
  when the length is unknown; `WORKER_JOB_BUDGET_MIN` overrides. Every ffmpeg
  call had a timeout; Whisper had none, and a hung transcription kept the
  heartbeat thread beating, so the app's stall detector stayed green while the
  only slot was held for ever.
- **Template fields cannot break the formats they land in.** Fonts and colours
  went raw into the ASS `Style:` line and the ffmpeg graph. `safe_font` refuses
  a comma or newline (a new style field, a new event); `safe_hex` refuses
  anything but six hex digits (`#000000,drawtext=` is a filter injection);
  `ass_escape` folds a bare `\r`. Fine while templates are the shipped five;
  mandatory before the Studio custom-templates backlog item starts.
- **Proxy credentials are redacted** from job errors -- yt-dlp quotes the proxy
  it used, and `clean_error` copies its text into the job record, the callback
  and the owner's feed. Every pool URL and its userinfo now.
- **`project.timings`** on every result: import / audio / transcribe / score /
  render / total, in seconds. The CPX41 rescale is a decision about exactly
  this and there was no number to make it with.
- A cache hit is **hardlinked** into the job (`place_local`) instead of copied
  a second time -- 1.5GB of writes per job saved on a hit. `/readiness` reports
  the quick lane's depth. `verify-deploy.sh` checks the four new markers.

**What is still not a ten, and why:** AI titling quality is bounded by
qwen3:1.7b and Arabic transcription by Whisper `small`; both are unlocked by
the CPX41 rescale (open item 5), not by code. The schema format and the
clipped translation are proven by test, not yet on the box -- watch the first
deploy's log for a 400 fallback and read `timings` off the first real job.

## The editor gained section cuts, behind the gate (v3.78.0 / re-gated v3.78.3, 2 Sept 2026)

Youssef, on the audit's "week one" list: "fix all" -- then, an hour later,
"just keep editor as coming soon". So the gate is back on (v3.78.3) and what
follows is what was built and now waits behind it. The editor was the one
gap that was code rather than a decision, and it was smaller than it looked:
the render pipeline has cut on a LIST of keep ranges since 26 Aug
(`cutsSec`, `retime_for_cuts`), `agent.updateClip` has clamped and stored
that list since the trim shipped, and the editor's own comment said "split and
delete-a-section are the same primitive with more ranges". Only the control
was missing.

- **Section cuts are two presses of one button.** "Cut a section from here"
  marks the playhead; move it; "Cut to here" removes the stretch between. The
  removed stretch is hatched on the timeline (`#dcCutLayer`, inside the
  export's own `#dcTrimLane`), each carries a Restore chip, and "Use the whole
  clip" clears sections as well as the trim. Under half a second between the
  presses is a double-press, not a cut. The trim envelope plus the cut-outs
  become `edKeeps`, and Save sends that whole list -- one shape from the
  handle to the render.
- **A saved list reads back as its gaps**, so a clip opened again shows the
  cuts it already carries, not only its outer trim. The keep-shading gradient
  darkens every removed stretch in one rule.
- **Host-rendered, no re-import.** The button row sits after "Use the whole
  clip", found by its TEXT; the hatching is positioned from its own inline
  styles; `paintTrimTools` is in paintStudio's list. Driven with real clicks:
  armed -> cut -> hatched -> "Keeping 0:34 of 0:42 in 2 sections" -> survives
  two repaints -> Restore. Screenshotted at 1440x950: 0 elements overflowing,
  no page scroll.
- **The copy went out and came back.** v3.78.0 rewrote the help article, the
  FAQ, the features chapter, the terms and four SEO pages to say what the
  editor does; v3.78.3 restored every one of them to "coming soon" from git,
  together with the three tests that pin that claim. When the editor ships
  for real, commit `8a07833` holds the shipped wording and the reversed
  `seo-architecture` assertion, ready to cherry-pick.

**Declined from the same list, on purpose, and why:**
- **View counts.** The privacy policy states, and `youtube-compliance` pins,
  that no YouTube statistics are requested. Adding Analytics scope makes that
  sentence false and reopens compliance. Youssef's decision, not a fix.
- **Custom templates as NEW templates.** The catalogue is deliberately one
  template per content type (`createTemplate`/`duplicateTemplate` throw; edits
  are per-account overrides on the built-ins), because copies once turned two
  templates into eight. Every account already customises every template.
  Reversing that needs a spec, not a session.
- **A warm Whisper process.** The per-job model load is ~10s on a job that
  runs minutes to hours, and a resident model steals headroom from renders
  under the 2G cap. Revisit after the rescale, when concurrency > 1 makes it
  matter.
- **`state.json` -> a database.** Every route reads and mutates one in-memory
  object with an atomic, coalesced, retried save. That is fine at eight
  accounts and the migration touches every route; it is a project, and easier
  at eight accounts than eight hundred.
- **Active-speaker framing.** Needs a real face on a real video to verify;
  wiring it in unseen is the failure this file exists to prevent.

## Growth loops: nudges, the invite at the moment of delight, and the free-plan post credit (v3.79.0, 2 Sept 2026)

Youssef: "improve on the growth part you said". The First 100 funnel had already
named the number that matters -- accounts that sign up and never import -- and
nothing spoke to them: every product email fires AFTER a lecture is in.

- **Lifecycle nudges (`src/nudges.js`)**: one email at the one moment an account
  is stuck. Never imported (24h after sign-up), clips back and none reviewed
  (24h), approved and nothing connected (48h), and the free window closing
  (from two days out). The step comes from `referrals.nextStep` -- the SAME
  definition of "stuck" the owner's funnel and DeenAI's next-action card use,
  so the three cannot disagree about what an account should do next.
- **Every rule is a way this could become spam, and each has a test.** Once
  per step, ever (`user.nudges[step]` is the timestamp it went); never two
  inside a day; silenced by the bell's own email switch (`emailNotifsOff`, the
  one gate); inert without EMAIL_API_KEY; capped at 20 a sweep, because the
  first deploy sees every dormant account at once; `NUDGE_EMAILS=false` turns
  it off outright. The sweep runs from `agent.tick()` every ten minutes and
  marks the user BEFORE the send resolves, so a slow provider cannot let the
  next sweep send the same email twice.
- **The invite rides the "your clip is live" email.** The moment someone is
  happiest with the product is the one moment to ask them to bring a friend.
  `inviteParagraph` in mailer.js appears only when a reward is actually
  configured, and never names a percentage -- the coupon lives in Stripe
  (v3.52.0's rule), so the email cannot promise one number while checkout
  charges another.
- **A free-plan post carries a credit line with the poster's OWN invite link**
  (`postCredit` in social.js): "Clipped with DeenClipped ·
  deenclipped.online/r/CODE". The same policy as the watermark, and it is read
  from the same FEATURES entry -- `planFeatures(owner).watermark` -- so whoever
  may remove the mark carries no credit, and social.js holds no plan gate of
  its own. The gate-law test forbids one there and the first cut failed it with
  a bare `isPaid`; the table is the sanctioned route. The credit is the LAST
  thing in the caption and survives the 2200-character limit: the description
  gives way, never the credit. Empty when `POST_CREDIT=false` or when referrals
  are off -- a brand line with nothing in it for the poster is an advert, which
  is a different decision.
- **The First 100 screen reports the nudges** (`growth.report().nudges`: sent
  and moved, per step). "Moved" over-credits the email -- it counts anyone who
  passed the step for any reason -- and the screen says so. Click tracking
  would be the honest measure and is not something this product does to its
  customers.
- **A paying account still has a computed free window** (`freeWindow` reads
  `createdAt`), so the closing-window email needs the PLAN to say no. That
  `isPaid` call in nudges.js is allowlisted in `test/plan-gating.test.mjs` with
  its reason, like every other gate.
- Both loops default ON. No email goes out until EMAIL_API_KEY is set on
  Render; the post credit is live for free accounts from this deploy.

## The phone dashboard: a second template over the same bindings (v3.80.0, 2 Sept 2026)

Youssef's brief: a purpose-designed mobile dashboard that "feels like a native
iOS creator app", every feature kept, and the desktop "pixel-for-pixel
unchanged" -- "a successful mobile redesign with a damaged desktop interface is
considered a FAILED implementation."

**What was actually wrong on a phone, found before anything was built.** The
old phone layer was `studio-responsive.css`: the desktop markup with CSS
overrides hung on inline-style attribute selectors (`[style*="padding: 22px"]`)
and ids, which is exactly the "desktop squeezed onto a phone" the brief
describes. Measured at 390px on the eleven screens: no page overflow on ten of
them, but 11-62 sub-40px targets and 17-72 sub-12px text runs per screen; the
hero's marketing headline and four collage dots above the fold; five 9.5px tab
labels; the library card's duration chip printed OVER its title; "Re-cut
clips" wrapping mid-word; the Performance KPI band running 24 elements off the
right edge; the month grid at 7 columns of 52px; the live bar floating on top
of the tab bar.

**How it is built, and why this shape.** `src/public/studio-mobile.js` is a
SECOND TEMPLATE authored in the runtime's own AST, rendered by the SAME
`StudioRuntime` (same patcher, same delegated events, same handler table) from
the SAME `StudioAdapter.bindings()` object the desktop renders from. Every
button on the phone calls the function the desktop button calls -- no copied
logic, no new state, no new route. `paintMobile(vals, DATA)` runs last in
`paintStudio()`; it mounts `#dcMobile` (before `#studio`, deliberately) only
while `(max-width: 820px)` matches and the studio is up, and unmounts the
moment it stops matching. `src/public/studio-mobile.css` sits ENTIRELY inside
that one query. So a desktop render is byte-for-byte what it was -- and that
was MEASURED, not reasoned about: 14 screens x 3 widths (1280/1440/1920)
pixel-diffed before and after against a snapshot of the previous commit; every
difference was within the noise a second capture of the unchanged baseline
produced (a paused spinner, a breathing halo, under 30 pixels each).

- **The seam is 820px, not the brief's 767.** It said to inspect the existing
  breakpoints and use the safest. 820 is where the app has ALWAYS switched to
  the phone regime, so no device changed regime; a new seam at 767 would have
  left 768-820 in the old squeezed layout as a third state. One clause was
  added beside it: `(pointer: coarse) and (max-height: 500px)` -- a rotated
  PHONE (an iPhone 13 is 844px wide on its side and was falling back to the
  desktop rail in a 390px-tall window). Desktops report a fine pointer and
  every tablet is taller than 500px in landscape, so neither is caught.
- **Five screens are rebuilt** (Home, Clips = the review queue, Lectures, a
  lecture's detail, Schedule). While one is up, `body.dcm-own` hides the
  desktop rendering of that screen -- the LAYOUT, never a feature:
  `test/studio-mobile.test.mjs` renders the mobile template with the real
  bindings and asserts every desktop control is there and every bound handler
  resolves (the runtime's `missing` list, empty). **Every other screen keeps its
  desktop DOM** (Templates, Nasheed, Language, Performance, Tokens, Owner,
  DeenAI, Help, the gated editor), framed by the phone header and tab bar and
  tidied where it broke (the Performance band wraps to two columns).
- **The shell**: 56px header (arch mark, title, search, activity, account),
  bottom tabs Home / Clips / + Create / Schedule / More with safe-area insets,
  and sheets for More, search, activity, account, create and the focused
  review. The More sheet is built FROM the rail's own nav arrays, so a rail
  item cannot be added without appearing there.
- **The design's own overlays become bottom sheets without being touched.**
  They are root-level siblings of `<main>` with hashed classes; after every
  paint the shell stamps `data-host-ov="job|sheet|detail|player|tour|boot|dock|
  toast|conn"` on them in TEMPLATE ORDER (a test pins that order against the
  export) and the stylesheet does the rest. `data-host-*` is the one attribute
  family the patcher never strips. The Start-job panel is therefore the same
  seven-step sequence on a phone, as a full-height sheet.
- **The focused review** (tap any clip card) plays the RENDERED clip in a
  host-owned `<video>` -- invariant 4 -- with the score's reasons, the
  transcript, Reject / Edit / Approve, and prev/next through the list it was
  opened from. A decided clip that leaves the list advances the review the
  way the desktop deck does; an empty list closes it.
- **Host panels that dock into desktop columns learned the mobile slot.**
  `dockLiveHome` docks "Happening now" into `#dcmLiveSlot` when it exists;
  `paintLibraryAside` is scoped to `#studio` -- its first cut mounted the
  desktop stats panel INSIDE the phone's "Add a lecture" button, because the
  button carries the same `data-tour="lib-add"` the tour needs; and
  `paintGlobalSearch` stands down under `body.dcm-on`, because the desktop
  dropdown otherwise opened against the hidden desktop field, off-screen.
- **The tour works on the phone because `#dcMobile` precedes `#studio`.**
  `tourAnchorEl` is a document-order `querySelector('[data-tour=...]')`, so
  the shell's anchors (paste, start, rail, queue-tabs, queue-decide, lib-tabs,
  lib-add, sched-views, sched-ready, sched-outlets) are found before the
  hidden desktop ones.
- **Icons are one `<path>` each.** The runtime writes SVG leaves as void tags,
  and in foreign content a second sibling `<path>` NESTS inside the first and
  never draws -- the search glass lost its handle and the More dots became one
  dot. Every icon's `d` carries all its subpaths; dots are zero-length
  round-capped strokes; the arch mark is two stacked svgs.
- **`.dcm-body` is the flex spacer even when the shell owns nothing.** With
  `display:none` there the tab bar rendered under the HEADER on Performance
  and Templates -- measured, not reasoned. It is see-through and
  `pointer-events:none` on those screens instead.
- **The adapter gained fields, never markup**: `key`/`on` on tabs and view
  options, `isToday/inMonth/past/count` on month cells, `filled/extra` on
  pips, `videoUrl/hasRender` on clip cards, `id` on library items,
  `isOperatorUser`. None is read by the desktop template, so the desktop
  HTML is unchanged.
- **Measured at 320 / 375 / 390 / 430 and landscape**: no page-level
  horizontal overflow on any screen, zero sub-44px targets on the owned
  screens, and the only text under 12px is badge numbers and letter-spaced
  uppercase micro-labels (11px), which the brief's scale allows.
- **Traps paid for, in order**: the CSP hash of index.html's inline script is
  computed at server start, so editing that script mid-session silently
  blocks the whole app (restart the dev server -- the third time this file
  has recorded it); `pkill -f` with the server's command line in the same
  Bash call kills the call's own shell; `Array.from` a vm-realm array before
  `deepEqual`.
- **Not done, and said so**: the phone cannot be driven by a real touch
  device from here -- keyboard-over-sheet behaviour on iOS, the notch insets
  and momentum scroll are what a real phone verifies. The editor stays gated
  on every width (Youssef's call), and the phone shows the same coming-soon
  notice.

## The phone got its own look — night by default, paper on request (v3.82.0)

**v3.81.0 shipped it PAPER and that was wrong.** Youssef, looking at it: "um
why is it white??!?!?! if you want you can do dark mode on settings." The brief
was "a new COMPLETE look for mobile only", and that was read as "get off the
dark", which it never said. Corrected the same day: the phone is NIGHT by
default and the paper palette lives behind **Account > Appearance > Light**,
remembered in that browser (`dcmTheme` in localStorage, guarded in try/catch --
reading storage throws in a private window and must never take the app down).

**It is the FIRST row of the More sheet as well as a row in Account** (v3.82.2).
Under Account alone it could not be found -- "wheres color changing to light
and dark mode? cant see it" -- and at the FOOT of More it was missed a second
time. One `themeRow()` builder feeds both sheets, so the two can never disagree
about which theme is on; the More copy carries a rule under it, or a setting
sitting among navigation rows reads as another destination that happens to have
two buttons on it.

- **The night is NEAR-BLACK, and a first cut got that wrong.** It tinted every
  ground brown to make the phone feel like its own surface; Youssef, looking at
  it: "ew what the hell is that, it used to be mostly black." Corrected in
  v3.82.1 -- the grounds are the neutral charcoal this app has always used
  (#09090A / #121214 / #17171A). **What makes the phone its own surface is the
  FORM, not a tinted ground**: Fraunces headings, large radii, shadows instead
  of hairlines, a floating tab bar. Reach for shape before colour.
- **One class swaps the whole design and NOT ONE LAYOUT RULE MOVES.** Every
  colour in the sheet is a token; `:root` holds night and `body.dcm-light`
  redefines the same names. The test asserts exactly that: every token the
  light block sets must already exist in the default, or a value would fall
  back to nothing in one theme and not the other.
- **The STAGE is night in both themes** -- the focused review, the video
  player, the Start-job panel, the live bar and the design export's own
  overlays. That is where a clip is watched and judged, and those surfaces
  belong to the generated export, which this sheet may reskin but must not
  rewrite.
- **The dark chrome for the three framed screens is a LIGHT-theme rule only.**
  Help, Owner and the gated editor are still the desktop's own dark rendering;
  in paper the header and tab bar go dark with them
  (`body.dcm-light.dcm-on:not(.dcm-own)`), because paper chrome around a night
  screen looks broken. In night there is nothing to reconcile.

The rest of this section is the release that introduced the look, kept because
every trap in it is still live.

## The phone look and what it cost to get right (v3.81.0, 2 Sept 2026)

Youssef, on the v3.80.0 phone build: "Nah you need to figure out with a new
COMPELTLE new look for mobile ONLY." He was right -- that release solved the
LAYOUT (a second template over the same bindings) and then dressed it in the
desktop's dark charcoal and gold, so the phone read as the same app squeezed
smaller. The layout was never the complaint.

- **The look itself.** Cards with
  soft shadows instead of hairline borders, **Fraunces** for every heading
  (loaded from Google Fonts with the stylesheet link MEDIA-SCOPED to the phone
  query, so a desktop pays nothing for it), gold as INK (#A2762C) rather than
  as glow, emerald for done and rust for refused, 18px gutters, and a tab bar
  that floats as a rounded slab clear of the safe area with a raised gold
  Create button. Nothing about the desktop changed: every rule still lives
  inside the one 820px query and `test/studio-mobile.test.mjs` fails if a
  single one escapes it.
- **Two grounds, deliberately.** The workspace is paper; the STAGE is night --
  the focused review, the video player, the Start-job panel, the live bar and
  the design export's own overlays. That is where a clip is watched and judged,
  and those surfaces belong to the generated export, which this sheet may
  reskin but must not rewrite. Paper app, dark stage.
- **Five more screens are drawn by the shell now**, so the phone is one design
  end to end rather than paper chrome around a dark app: Templates (the live
  9:16 preview docks into `#dcmPvFrame`), the Nasheed library, Performance,
  Tokens & billing and DeenAI. All from the SAME `StudioAdapter.bindings()`
  object the desktop renders from -- rendered against the real bindings, every
  one comes back with an EMPTY `missing` list, so not one control lost its
  handler.
- **The three screens still framed from the desktop DOM take dark chrome with
  them.** Help, Owner and the gated editor are host- or export-rendered in the
  dark studio; `body.dcm-on:not(.dcm-own)` flips the header and tab bar to
  night for exactly those, because paper chrome around a night screen looks
  broken and a half-lit screen is worse than a consistent dark one.
- **The shell needed its own ground.** `#dcMobile` is transparent, so behind
  the translucent header and under the floating tab bar sat the desktop's dark
  studio -- the header photographed grey and the strip under the tabs black.
  `body.dcm-own #dcMobile { background: var(--dcm-paper) }`; scoped to `own`,
  or the framed screens would be hidden behind paper.
- **The paste field rendered BLACK on paper**, because it carries
  `data-tour="paste"` and studio-motion.css gives that a dark ground, a gold
  ring and a breathing halo -- written for the desktop and inherited here. An
  id (`#dcMobile .dcm-input`) outranks that class rule without touching it.
  Same family as the v3.76.6 lesson: when a phone control looks like the
  desktop's, look for a rule keyed on an attribute the export owns.
- **A control that measures 40px is not a 44px target, whatever its hit area
  is.** `::before { inset: -11px -4px }` widened the switch's hit region and
  the audit still reported 40x23, because a rect is measured on the element.
  The switch is a 48x44 button that DRAWS a 40x22 track (`::before`) and an
  18px knob (`::after`).
- **A band between 360 and 389 fails where 390 and 320 pass.** At 375 the
  two-up clip grid leaves a 163px card, and three side-by-side actions in it
  measure 40px; the month's cells miss 44 by a fraction. Both fixed in their
  own `@media (max-width: 389px)` block -- the primary action takes its own
  row, the month tightens its padding and gaps. **Audit every width, not the
  round ones**: 390 and 320 both reported zero while 375 had 42 failures.
- Measured after: **zero sub-44px targets at 320, 375 and 390**, no
  page-level horizontal overflow at 320/375/390/430 or in landscape, and the
  only text under 12px is badges and letter-spaced uppercase micro-labels.
- **The desktop was pixel-diffed again**: 42 pairs across 1280/1440/1920,
  **38 identical**, and the four that differ are 12-47 pixels each in the
  topbar and home card -- the breathing paste halo and the idle brand light
  pass, both infinite animations the capture deliberately does not freeze.
  That is the same signature a second capture of an UNCHANGED baseline
  produced last release.

### The phone moves now (v3.83.0)

Youssef: "animations in terms of moving tabs opening and closing etc for
mobile doesnt have it, it just goes quickly."

- **A screen arrives from the side it came from.** The tab order decides the
  direction (`dcm-in-next` / `dcm-in-prev`), the sections stagger 30ms apart,
  and the newly current tab's marker draws itself in with its icon popping --
  keyed off the SAME gated class on `.dcm-body` rather than a class of its
  own, so there is one thing to gate rather than three.
- **The gate is the rule this file keeps restating.** The studio repaints on
  every state poll, so a class that is always present replays the entry every
  few seconds and reads as a flicker. It is stamped only on the paint where
  `ui.screen` actually changed and falls away on the next one. Measured both
  ways: six `dcmScreenNext` plus `dcmDot` and `dcmPop` running right after a
  tab press, and **zero** after three consecutive `paintStudio()` calls.
- **A sheet could not animate OUT, because there was nothing left to
  animate.** Every close set `M.sheet = null` and the patcher removed the node
  in the same frame. Closing is two steps now: the flag moves to
  `M.sheetClosing`, which keeps the sheet rendered with `is-closing` and no
  pointer events, and a 200ms timer drops it for real. Every close path in
  studio-mobile.js goes through one `closeSheet()`, so the behaviour cannot
  vary by which button was pressed. Measured mid-close: the node is still
  there carrying `dcmFadeOut,dcmDown`, and gone 470ms later.
- `backwards`, never `both` -- a forwards fill leaves the last keyframe
  beating ordinary declarations for the element's life, which is how this repo
  has killed a hover three times.
- **Under `prefers-reduced-motion` the exit still runs**, shortened to a plain
  fade: tearing a sheet out mid-animation blinks, which is worse than the
  motion someone asked to reduce. Every new animation has its own kill in that
  block, because a bare `*` rule never matches a pseudo-element.

### Every row in the More sheet closes it (v3.81.0)

Youssef: "with the button saying more when I click ANY tab it should open the
page close the more selection page."

- One wrapper, `closeThen`, clears `M.sheet` and then delegates to the handler
  the RAIL itself uses -- no destination is re-implemented in the sheet, only
  the dismissal is added. Applied to every nav row and to Connections, Tokens,
  Account settings, the tour and Sign out.
- **It repaints AFTER the handler as well as before.** Account settings opens
  a host DIALOG rather than changing the screen, so nothing triggered a studio
  paint and the sheet stayed on screen with `M.sheet` already null -- shut in
  state and open in front of you. Verified by tapping all seven: each one
  navigates and the sheet is gone from the DOM.

## The home-screen icon (v3.83.2, 2 Sept 2026)

Youssef added the site to his phone's home screen and sent the result: a hairline
gold arch, small in its tile, on flat black. "improve it."

- **What was wrong was scale and weight, not the mark.** The arch occupied half
  the tile's width with a 2.6/64 stroke, so at 60px on a home screen it read as
  a faint outline. It is 56% wide with a 4.4/64 stroke now, the play glyph is
  larger and optically centred in the arch's INTERIOR (not the tile), the gold
  is a gradient rather than a flat fill, and a soft radial gold glow behind the
  arch gives the tile depth.
- **The apple-touch PNG is FULL-BLEED and the favicon is not.** iOS applies its
  own squircle mask, so a tile that carries its own `rx` is rounded twice and
  reads as a smaller icon inset in a box -- which is exactly what the
  screenshot showed. The SVG favicon keeps its rounded tile, because a browser
  draws it unmasked.
- **Rasterised with the Chromium that is already here**, not with an image
  library: this repo has no npm dependencies on purpose, and that is what lets
  a phone session run the suite. `scratchpad/rasterise.mjs` renders an SVG at
  any size through a headless page.
- Checked at 120, 60, 32 and 16px, and at 16px in a light browser tab, before
  being kept. The 180x180 grew 3.1KB -> 20KB, which is the gradients; it is
  cached for a week and is not worth flattening for.
- **A home-screen icon already added does NOT update.** iOS copies it when the
  shortcut is created, and the file is served `max-age=604800`. Remove the
  shortcut and add it again to see the new one.

## Owner: what the traffic words mean, and a screen that shows it (v3.86.0)

Youssef, 2 Sept 2026: "for analytics for traffic unique should be ONLY NEW
PEOPLE WHO HAVE NEVER CAME ON THE WEBSITE and visits is anything and revisits",
and "fix the owner to make it look a lot better".

### The words

Four numbers, and the labels had drifted apart from them:

- **Visits** -- every page opened, however many times (`views`).
- **Visitors** -- devices seen, counted once a DAY (`uniques`).
- **First-time** -- this browser had never opened the site (`newVisitors`).
- **Returning** -- it had (`returningVisitors`).

**"Unique visitors" was wrong twice over and is gone.** It summed a per-day
count across the window, so somebody visiting on three days counted three
times -- not unique in the window at all -- and the word "unique" read as "new
people", which is a different number the app already had sitting beside it.
The data never changed; only the labels, the default tile order (Visits,
First-time, Returning, Visitors, Live now, Visit->signup) and the notes under
each, which now define themselves in one line rather than assuming the reader
knows.

The footnote states all four in prose, because the Owner markup lives in the
DESIGN EXPORT and a new element there costs a re-import and every hashed class
name in the app. Folding a sentence into a binding that already renders is the
cheap route, and the per-tile notes are where the confusion actually happens.

### The look

The KPI row was six identical text blocks divided by hairlines: no boundary, no
hierarchy, nothing leading. They are CARDS now (`owKpis` in the adapter, so
every tab's row moved together -- Overview, Traffic, Money in/out, Users,
Health), with the first carrying a gold inset edge, 30px tabular figures, and
the row's gap supplied from `studio-owner.css` because the row element itself
belongs to the export.

- **The tile's label and note are inline-styled literals in the export**, so
  they are reached with an id-scoped `!important` -- the same route the
  v3.76.6 live-row spin lesson establishes. A long label was being cut
  mid-word ("FIRST-TIME VISITOI"), fixed by shortening it AND letting it wrap.
- **No baseline rule was added under the charts, deliberately.** The columns
  sit several levels down inside two different wrappers, and every selector
  loose enough to catch both also catches sections that are not charts. Left
  alone rather than shipped on a guess.
- Tables get tabular figures and room to breathe; every `<strong>` on the
  screen does too, so a number does not shuffle its digits as the 30s poll
  refreshes it.

### The rail seal was cutting through its own arch

Youssef sent a screenshot: "look at the logo on the top left messed up".

- **v3.73.3 measured the clearance against the arch's HEIGHT and it needed to
  be the arch's CORNERS.** The mark is 26 wide by 34 tall, so its top is 17px
  from the centre but its corners are 21.4px -- and the text circle sat at
  21.9px. It cleared the top and ran straight through the shoulders.
- The mark is scaled to .86 (corners at 18.4px) and the ring opened to 58px
  (a 22.7px circle): 4.3px of clear annulus.
- **The svg is `overflow: visible` now.** The glyphs sit OUTSIDE their baseline
  circle and were being clipped by the svg's own viewport, which is what made
  the words look bitten off at the top and bottom.
- Measured collapsed: the ring spans x 1..66 inside a 0..68 rail.

## Owner reads as blocks now, and the live row moves properly (v3.87.0)

Youssef, 2 Sept 2026: "owner is looking good but analytics are perfect other
than that all pages look so messy like idk what im looking at", plus three
things on the Happening-now row.

- **Every labelled table is a card.** Below the tiles each tab was a stack of
  bare tables under 10px grey labels with nothing marking where one block
  ended and the next began. `div:has(> div > table)` is exactly that block in
  BOTH places it is built -- the design export wraps its table in an overflow
  div, and the host-rendered growth panels reuse the export's own
  `.sgw > .sdk > table`. One rule covers both and names no hashed class, so a
  re-import cannot break it. The bar lists (Channels, Devices, Languages) have
  no table, so they are matched on `.dcow-fill` -- a stable dc- class -- and
  card with them; without that they sat bare beside two cards on Traffic.
- **The spinner's glyph now turns about its own middle.** An inline-block
  `::before` rotates about the centre of its LINE box, and an icon font's line
  box carries the face's ascent and descent -- so the ring turned about a
  point above itself and sat high in the 32px tile. A square 1em box with
  `line-height: 1` fixes both the centring and the rotation origin. Measured:
  the `::before` is 14x14 with 9px on all four sides of the tile.
- **The connector sweep starts and ends softly.** It ran linearly from one
  edge to the other and jumped back -- "can end and start smoother if you get
  what i mean". It fades in as it enters, fades out as it leaves, eases at
  both ends and holds dark for the last fifth, so the loop point happens while
  nothing is lit. Sampled across the cycle: opacity 0 at 0%, .95 from 14% to
  66%, 0 by 82% and held to 100%.
- **The MB figure was never broken.** `412 MB / 806 MB` renders the moment
  bytes arrive; the screenshot was taken at 3% with the import at 0% of its
  step, before anything had transferred. Checked rather than assumed: the box
  is current (no `worker/` change since the v3.78.1 deploy) and byte reporting
  has been in `service.py` since well before it. `sizeLabel` returns nothing
  for zero on purpose -- "0 MB" reads as broken.
- **The rail seal is quieter.** The geometry clears the arch (measured: a
  22.7px text circle against the arch's furthest corner at 19.1px), but at
  42px the words were nearly as bright as the mark and read as clutter beside
  the wordmark. Opacity .42 at rest, full on hover, where it is being looked
  at.

## Desktop notifications were on the wrong screen and dropping posts (v3.89.0)

Youssef, 2 Sept 2026, on the Account settings dialog: "add desktop notifcations
as well here, also i dont think desktop notifcations work."

Two things were true, and only the second was a code fault.

- **The only switch was inside the BELL dropdown**, so nobody had ever turned
  them on -- which is indistinguishable from them not working. It is a row in
  Account settings now, above Email notifications, and both surfaces plus the
  phone's Activity sheet read ONE state function (`desktopNotifsState` in
  studio-adapter.js, exposed on `StudioAdapter` for the host-rendered dialog).
  Four derivations of one switch is how two screens end up disagreeing.
- **A clip posted to three Pages notified ONCE, at most.** `fireClipNotifs`
  keyed the already-posted set on `clip.id + provider`, and since v3.56.0 a
  Studio account has three targets sharing one provider -- so once the first
  Page posted, the other two could never fire. Proven by running it: the old
  key returned ZERO notifications for two Pages going live, the new one
  (`clip.id + provider + accountId`, both fields the payload already exposes)
  returns two, each naming its account. `targetPublic` does NOT expose the
  target's `id`, so the key is built from the two fields that are there --
  reading `t.id` would have silently fallen back to the broken behaviour.
- **FOUR states, not a boolean, and that is the whole point.** `denied` and
  `unsupported` cannot be fixed by pressing the switch, so a surface that only
  knows on/off draws a control that silently refuses -- exactly the symptom
  being reported. Blocked shows "How to allow" and NO switch; a browser with no
  `Notification` gets a sentence and no control at all (invariant 9). Switched
  on and then revoked in the browser reads as blocked, never as on.
- The permission prompt must ride a real click, so the ask stays in the handler
  and the dialog repaints AFTER it -- including when the browser refuses, which
  is what turns the row into its "How to allow" state.
- Driven in a browser rather than read: ten checks, all four states rendered,
  the switch pressed for real, the bell dropdown agreeing, the fire path
  notifying for clips-ready / lecture-failed / two of three Pages, and zero
  fired while off. Both new assertions were **proven RED** first -- against the
  provider-only key, and against `denied` collapsed into `off`.
- **What this does NOT fix**: a pop-up needs a tab open. There is no service
  worker and no push subscription, so nothing arrives with the app closed --
  the copy says "while this tab is open, even in the background" rather than
  implying otherwise. Real push is a separate piece of work.

## Report a bug sits in the account menu (v3.89.0)

Youssef, pointing at the account dropdown: "add reoort a bug here."

- **Host-rendered, inserted after Help & guides**, found by that row's own text
  and copying its inline style -- the menu is generated markup, so naming a
  hashed class would break on the next design re-import. `paintBugRow` is in
  paintStudio's list like every other host panel, and is idempotent (one row
  after five repaints).
- **The report carries the facts nobody thinks to include**: release, the
  screen they were on, the account, browser, window size and the time. A bug
  report without the version is a bug report that cannot be acted on.
- Two ways out, because a mailto is not reliable everywhere: "Open email" and
  "Copy details".

## Notifications arrive with the app closed (v3.91.0, 2 Sept 2026)

Youssef: "add push notifcations when app is closed." The previous release's
notification needed a tab open -- it is a `new Notification()` from the page --
and said so. This is real Web Push: the server hands an encrypted message to
the browser vendor's push service, which wakes a service worker on the device
whether or not DeenClipped, or the browser, is running.

- **It is hand-written, and that was the point.** `web-push` is the obvious
  dependency and this repo deliberately has NONE -- that is what lets a clean
  checkout run the whole suite on a phone or on CI. `src/push.js` is RFC 8291
  (message encryption) and RFC 8292 (VAPID) on top of `node:crypto`, which has
  every primitive both need: ECDH, HKDF via HMAC, AES-128-GCM, and ES256 with
  `dsaEncoding: 'ieee-p1363'`.
- **A wrong crypto implementation fails SILENTLY**: the push service accepts
  the POST, answers 201, and the device shows nothing -- indistinguishable from
  the feature not being built. So `encryptPayload` is pinned to the worked
  example in **RFC 8291 §5**, from the RFC's own keys and salt, asserting the
  whole base64url body. A round-trip test would pass against an implementation
  that is merely self-consistent. Proven able to fail: one byte changed in the
  HKDF info string (`WebPush: info` -> `WebPush: Info`) turns it red.
- **Node signs ES256 as DER by default and every push service rejects that**
  with a bare 401 that reads like a wrong key. `ieee-p1363` is the raw r||s
  JWS wants; the test verifies our own signature with `crypto.verify` and
  fails if the encoding regresses.
- **`aud` is the endpoint's ORIGIN, never the full URL.** The endpoint path is
  the secret half of a subscription and does not belong in a token that gets
  logged on error.
- **No setup, deliberately.** With no `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
  set, the server generates one pair and keeps it in `state.json`, so push
  works on a fresh deployment with nobody having to run a key generator first.
  **It must never be regenerated casually**: every subscription in the wild is
  bound to the public key it was created with, and a new pair invalidates all
  of them with nothing anywhere reporting it. Verified across a real restart:
  same key, subscription intact.
- **The subscription IS the preference.** A browser that holds one gets
  notified; one that does not, does not. No second stored flag to fall out of
  step with it, and `getSubscription()` is read from the BROWSER rather than a
  cached boolean -- a push service can retire a subscription, and a flag saying
  otherwise would have the switch claim a channel that no longer exists.
- **THE DEDUP, and it is the thing most likely to be broken by a later
  change.** The in-tab notifier (`fireClipNotifs`) and the service worker fire
  on the same three moments, and the worker fires whether or not a tab is open
  -- so with a subscription live, running both is every notification twice.
  `fireClipNotifs` stands down on `window.__dcPushOn`. It stays as the fallback
  for a browser that cannot subscribe, and that path was driven: with no push
  service reachable the switch still turns on, the copy says "On while
  DeenClipped is open", and the in-tab notifier fires exactly once.
- **404/410 is the ONLY signal that unsubscribes a device.** That is the push
  service saying the subscription is gone. A 500 is a bad ten minutes, and
  dropping a row there loses a real subscriber who would never know; soft
  failures are counted and only give up after eight.
- **Push is NOT behind the email switch.** Two channels, two decisions:
  turning product email off is not a request to stop being told a lecture
  finished, it is a request to stop being mailed. A test reads the guard around
  each `push.notify` call and fails if `emailNotifsOff` appears in it.
- **The service worker does NOTHING else** -- no fetch handler, no caching. A
  caching worker on an app that ships several times a day strands people on a
  stale dashboard with no way to force a refresh. A test fails if a `fetch`
  listener ever appears. It handles `pushsubscriptionchange`, because Chrome
  retires subscriptions periodically and without that the device goes silent
  for ever with nothing anywhere saying so.
- **`userVisibleOnly` means the browser REQUIRES a notification per delivered
  push** and penalises an app that stays silent, so the empty-payload path
  shows a real message rather than returning. Verified by delivering an actual
  push through CDP (`ServiceWorker.deliverPushMessage`) -- no push service
  needed -- and reading `registration.getNotifications()` back: the right title
  and URL, the empty push still showing something, and a repeated `tag`
  replacing rather than stacking.
- **`/sw.js` is served from THE ROOT and that is load-bearing.** A worker's
  scope cannot rise above its own path, so at `/studio-sw.js` it could only
  control `/studio-*` and pushes would arrive with nothing registered to show
  them. `worker-src 'self'` is stated outright in the CSP rather than left to
  the fallback chain through `child-src` -- a blocked worker fails silently.
- **A manifest exists now** (`/manifest.webmanifest`), because iOS Safari
  delivers Web Push only to a site added to the home screen, and only a site
  with a manifest can be added as an app.
- **The switch is called "Notifications on this device" now.** "Desktop
  notifications" stopped being true: it reaches a phone, and reaches it closed.
  The bell dropdown's label is a literal in the design export, so it is a
  `design/text-overrides.json` entry rather than a re-import -- proven
  byte-stable first, and the diff afterwards was the one label node plus its
  name in the sorted binding list, with the CSS untouched.

**The inline-script-scope trap bit again, and it cost the whole app.**
`refreshPushState` was called from `boot()` while being declared in a DIFFERENT
inline script scope, so the bare call threw ReferenceError INSIDE boot's own
catch -- and the app fell back to the password gate reading "refreshPushState
is not defined", with NO page error and a CSP hash that matched. It is
window-pinned and guarded now, exactly like `fireClipNotifs` and `paintAccount`
beside it. Anything a top-of-file function needs must be reached through
`window`.

**What is NOT done:** nothing has been delivered by a real push service. FCM,
Mozilla's autopush and Apple's are not reachable from this container, so the
proof stops at "the bytes are provably right and the worker provably shows
them". The first real notification is the confirmation, and it costs one
lecture: turn the switch on in Chrome, close the tab, and import something.

## The Day view drags too, and a card that can move says so (v3.93.0, 3 Sept)

Youssef: "the drag icon needs to be added, weekly only works daily should also
work or use any logo or icon that makes sense to show you can drag it."

- **One implementation serves both views**, because a Day card and a Week cell
  are the same thing: one clip on one slot. The Day card carries `data-slot`,
  `data-slot-clip` and `data-slot-title` and `wireScheduleDrag` is pointed at
  its list as well as `[data-dc-week]`. Month is still deliberately out -- a
  day is not a time, so there is nothing to swap onto.
- **The Day list is found by its CARDS, not by a container hook.** Home's
  "Posting today" list renders the identical `<article data-dc-sched-card>`,
  so tagging the markup wholesale would have made the home screen draggable
  into a schedule it does not show. Only the schedule's card was given a slot,
  and the test asserts exactly that split -- two cards in the design, one of
  them draggable.
- **The grip is a real element, not a background.** Six dots, inline SVG, top
  right, injected on every paint and removed again the moment a cell stops
  being movable (a posted clip, or a slot now in the past). It is an element
  so it can carry `touch-action: none`: on a phone a drag starting anywhere
  else has to be allowed to scroll the calendar instead.
- **The ghost names the clip.** A week cell holds only the title, but a Day
  card also holds its time and every destination's state -- dragged, that read
  as "07:00YouTube — failed1 failingNever lose h". Hence `data-slot-title`.
- `npm run design:import` was proven byte-stable before and after both
  attribute additions (generated CSS identical, no hashed class name moved) --
  the same route `data-dc-week` and `data-dc-wave` established.
- Driven with real bubbling PointerEvents in both views: grip -> ghost -> gold
  outline on the target -> the two clips swap on the server. Both new tests
  were proven RED against the missing attributes and a renamed grip class.

## First run: Create -> Review -> Publish, and the moment (v3.94.0, 2 Sept 2026)

Youssef named five gaps: no obvious Step 1 Create -> Step 2 Review -> Step 3
Publish state, no first-clip success moment, no automatic handoff from
processing to the first review, no onboarding that disappears after
activation, and no tracking of signup -> first source -> first clip -> first
approval -> first publish.

- **There is ONE definition of where an account is, and it is
  `referrals.activationOf`.** The owner's growth funnel, the lifecycle nudge
  emails and DeenAI's next-action card already read it; `src/onboarding.js` is
  derived from it and adds no second answer. A second definition would
  eventually have the dashboard, the email and the operator's funnel each
  telling a different story about one person.
- **Nothing is stamped.** Every milestone time is read off the record that
  already carries it -- the project's `submittedAt`, the clip's `addedAt`,
  `approvedAt`, `postedAt`. So it works RETROACTIVELY for the accounts that
  predate it (the only real data this product has), needs no migration, and
  cannot drift from what happened the way an observation-time stamp does.
- **It disappears because the server stops sending it**, not because anything
  was dismissed. `journey()` returns `show: false` once a clip has published,
  so there is no flag to clear, nothing to wave away early, and nothing that
  can come back on another device.
- **Create is done only when CLIPS came back**, never when the project status
  says done: a lecture can finish and produce nothing, and calling that step
  complete sends someone to an empty queue.
- **The moment IS the handoff, and that was a deliberate reading.** "Automatic
  handoff" taken literally is a silent screen change, which can land on
  somebody mid-sentence and reads as a bug. The overlay appears by itself the
  instant the first clips land -- nobody has to go looking, which is the
  automatic half -- and its primary button lands them in the review queue.
- **Two bugs found by looking at the render, not the code:**
  1. The overlay was created and then **removed by the very next repaint**:
     the spent-flag guard ran before the already-up check, so it appeared and
     vanished inside a frame and measured as never having fired. An overlay
     that is up is now left alone; spent means "do not raise another".
  2. It fired at an account that had **already approved a clip** -- a nag, not
     a moment. It now also requires `!a.reviewed`.
- **Ink sitting ON the gold must never be a theme token.** The light theme
  flips `--dc-n-0e0e11` to `#F4EFE4`, and the gold underneath does NOT flip:
  measured at **1.7:1** for the step number and **1.18:1** for the button --
  invisible in daylight. Both are literal `#0E0E11` on a solid `#D9B478` fill
  now: **9.87:1 in both themes**. Every neutral around them IS tokenised.
- The steps row is capped at 520px. Unpinned, the flex connectors ate the whole
  1212px and "Create ——— Review ——— Publish" spanned the screen, reading as
  three unrelated words; measured, the last step sat at x=1338.
- Verified at every state by seeding an account at each: create, importing,
  review (+ the moment), publish, and done (nothing drawn). The lifecycle was
  driven end to end -- moment survives repaints, the button lands on
  queue/decide, the strip is Home-only, and neither returns after a reload.
- The phone renders the same three steps from the same bindings, inside the
  820px query (the test that fails on a rule escaping it caught the first cut).

### The status constant that had never matched the engine

Found while checking why the owner funnel said "Processing finished: 0" beside
"Imported a video: 4".

`IMPORT_DONE` in referrals.js was `['complete','completed','ready']`. The
engine has always written **`'done'`**. So `activationOf().processed` was false
for every project this product has ever run, and three things quietly hung off
it:

- **`isActivated` is `processed && approved`, so NOBODY has ever counted as
  activated** -- and that is what gates a referral payout.
- **`nextStep` returns "your lecture is being processed" the moment it sees
  `!processed`**, so every account that had ever imported was told that for
  ever, in DeenAI's next-action card and in the lifecycle nudge emails.
- The owner's funnel reported the 0 above. That WAS noticed once and read as a
  reason to show raw statuses rather than as a wrong constant.

Fixed by adding `'done'`; the other three stay, since an older record may carry
one. The test pins it against `local-engine.js`'s own assignment rather than
against the list -- a test that greps the constant passes against a wrong one.
**It changed DeenAI's card order**, correctly: an account that has approved a
clip and connected nothing now leads with "connect a channel", which is the
documented rule ("the next action comes first"). The DeenAI test that assumed
the lecture card was first now finds it by its kicker.

### Two sessions, one file, and a feature that nearly came back from the dead

The merge conflicted in index.html and `paintBugRow` was absent upstream, which
read exactly like the hand-merge loss this file warns about. It was not:
`test/studio-design.test.mjs` says Report a bug was **moved into Help at
Youssef's request**, which postdates the account-menu instruction this session
built to. The restoration was reverted and their placement kept. **Read the
other side's TESTS before concluding a merge lost something** -- the test
carried the reason, and the diff alone did not.
## The topbar, and the identity it was showing everybody (v3.94.0, 3 Sept)

Youssef, looking at the live header: "rearrange make it look cleaner idk
somethings missing." Three faults, and two of them were silent.

- **Every customer wore the operator's identity.** The avatar initials "YC"
  were a LITERAL in the design export -- in the button AND in the dropdown --
  so a stranger's account showed YC. (The NAME beside it was already patched
  through `text-overrides.json`; the avatar never was.) Both avatars bind
  `{{ accountInitials }}` now, the name is a real binding in the export rather
  than an override, and that override entry is retired -- which is exactly the
  lifecycle its own readme describes.
- **The button rendered the email**, truncated to "youssefchannaoui05@gm...":
  the widest thing in the row, saying nothing. It shows the account's NAME,
  falling back to the email's local part and then to "Account". The full
  address is still in the dropdown, where there is room.
- **The plan was named nowhere a reader would find it.** It WAS in the token
  pill, as "tokens · Unlimited" -- which parses as a description of the tokens,
  not as the subscription. v3.94.0 gave it a pill of its own; v3.96.1 put it
  back INSIDE the token pill, because three pills in a row is what Youssef was
  looking at when he said "too many pills": "make subscription name with the
  other pill ... make how tokens look as in number look simple token icon and
  number." So the word "tokens" is gone -- a coin and a number need no label --
  and the plan follows it, set apart by a rule rather than by an element
  (adding one to the export costs a re-import and every hashed class name).
  The pill names the TIER, not the period: "Studio · yearly" in letter-spaced
  caps is 173px of chrome, and the whole name is in the tooltip. Measured:
  229px across two pills before, 98-118px in one after. Basic's segment is
  quiet grey; gold is what a paid tier wears across this app, and spending it
  on the free plan spends its meaning. An operator reads **Owner**, not
  "Unlimited" -- the balance beside it is already ∞, and the Account panel
  shipped exactly that duplication once.
- **The row had no rhythm, measured rather than felt**: five controls at five
  heights (search 33, setup 26, tokens 29, bell 32, account 35). All 34 now.
- **The search was anchored to the HEADING**, so it moved as you navigated:
  x=379 on Performance, x=597 on Help -- 218px of travel for a control that
  never changes. It hangs off the right-hand cluster (`margin-left: auto`) and
  does not shrink; the heading is the only thing allowed to give way, and its
  subtitle ellipsizes. Measured after: **26px of travel across ten screens**,
  five of them identical, no page overflow at 1440/1280/1100/900.
- Two of the tokens the chip first used (`--dc-n-121214`, `--dc-n-34343a`) are
  **not defined anywhere**, so in daylight it would have fallen back to its
  dark hex. Check a token exists before leaning on it -- a `var()` with a
  fallback fails silently and only in the other theme.
- Host-rendered and in paintStudio's list, like every other host panel. Both
  design edits were proven byte-stable through `npm run design:import`.

## Two onboarding systems became one (v3.96.0, 3 Sept 2026)

Youssef, on the live Home screen: "remove the getting start and improve this
one cause i already had it." He was right and it was my miss: v3.94.0 built the
Create -> Review -> Publish strip **directly above a five-step "Getting set up"
checklist that had been there all along**, so one screen told one person two
different things about where they were.

- **The five-step list is retired, and one binding did it.** `startListOn`
  gates BOTH the Home card and the header's "1 of 5 done" chip -- one `sc-if`
  in the design export wraps each -- so holding it false removes both with no
  re-import, and a re-import regenerates every hashed class name in the app.
  The steps are still COMPUTED because the template names them and a missing
  binding is a render error. The phone rendered its own copy of the card in
  studio-mobile.js; that is deleted outright, along with a decorator loop that
  was styling a list nothing draws.
- **Nothing it taught was lost.** Its five items are three now: the nasheed
  prerequisite folded into Create (the one item whose absence silently STALLS a
  run -- a lecture cannot finish without one), connecting a channel and giving
  a clip a time both into Publish. The old rows were all buttons, so the strip's
  steps are buttons too: a passed step is still somewhere to go back to, and a
  replacement that only moves forwards would be strictly less useful than the
  thing it replaced.
- **THE PREREQUISITES SHAPE THE COPY, NEVER THE STEP.** `journey()` takes an
  optional context (`nasheeds`, `connected`) that changes only the hint and the
  button. growth.js calls it with NO context for the operator's report, and
  must get the same step back -- otherwise the owner's funnel and the
  customer's dashboard would disagree about where one person is, which is the
  law this module exists to hold. A test drives both and asserts the step and
  every step-state are identical.
- **Then I made the same mistake again, one layer down.** The blocker BANNER
  sits directly above the strip and already carries the nasheed and the
  connection, each with its own button -- so the first cut of this had the
  screen saying "no nasheed" twice, with two buttons going to the same place.
  The strip DEFERS now: while the banner is showing it states the step's
  meaning and draws no button, and the moment the banner is dismissed (it is
  dismissible) it picks the prerequisite back up with its own. Driven in a
  browser both ways. `blockersOn` was an inline expression inside the bindings
  object, so it was hoisted to `blockerShowing` and both surfaces read that one
  answer.
- **The completion dialog was repointed.** `paintSetupCelebration` fired on all
  five old steps being done and its copy named them ("a nasheed, a lecture, an
  approved clip, somewhere to post and a time to post it"). With the list gone
  it would have congratulated somebody for finishing a checklist they never
  saw. It keys on the journey reaching `done` -- the same moment the strip
  disappears -- and speaks of the three steps.
- **The current step's number was invisible in daylight**, and it is the same
  trap as last release from the other side: `#F0D6A6` is light gold, which
  reads on the night ground and vanishes on paper. Done sits ON the gold and
  keeps a literal dark; the CURRENT one sits on a transparent fill, so it takes
  the label's own ink token. Measured: **14.15:1 light, 17.8:1 dark**, from
  invisible.
- The strip carries "Step 1 of 3" where the header chip used to say "1 of 5
  done" -- on the thing it counts rather than in the header away from it.

**The test that asserted the retired feature passed for free.**
`pro-and-blockers` asserted `startSteps:` and `startListOn:` appear in the
adapter -- source strings, so it went on passing after the list stopped being
shown. It asserts the retirement now, and the more important half: that every
prerequisite the list carried still reaches the customer somewhere. That is the
third time in this file a source-string test has passed against a behaviour
that had changed underneath it.

## A drag ended in the Day view, and daylight went white (v3.96.0, 3 Sept)

Youssef: "when dragging on weekly it then works but then moves to daily also
day scrap the cream make it white i think its better, white gold and black
maybe? show boxes more like night shows."

### The drag fell through into a click

A `pointerup` is followed by a real `click`, and a schedule cell's own click
opens that day -- so every successful Week drag ALSO threw you into the Day
view. The move had already happened, which is what made it read as two things
at once rather than as a broken drag. The click after a drag means nothing and
is swallowed: one listener, at the CAPTURE phase so it lands before the
studio's delegated handler, `once` so it eats exactly one, and removed on a
timer for the drop that produces no click at all. Gated on `didMove`, and that
half was proven by driving it -- a plain click on the same cell still opens the
day.

### Daylight is white, gold and black

The cream was a wash: at 27 inches every ground read as paper and the cards
had nothing to sit on. Grounds are cool neutral greys now and **a card is
#FFFFFF**, which is what gives a box an edge the way night does (page #09090A,
card #17171A).

- **A plain inversion REVERSES the order among the near-blacks, and it did.**
  The month cell is #151517 -- lighter than its page at night -- and inverting
  put it at a grey DARKER than the page in daylight, so every cell read as a
  hole rather than a card. Anything below .10 lightness is a GROUND now and is
  mapped, in order, onto the band above the page's own lightness. Everything
  above that still inverts, because ink and lines are lighter than their ground
  at night and must be darker than it on white.
- **The inversion multiplier is 0.88, not 0.97.** A night "faint marker"
  (#4A4A52) came back at .68 lightness -- legible on black, a grey nobody reads
  on white. Measured across ten screens: 4 elements too pale before, ONE after,
  and that one (`#3A3A40`, the DeenAI kicker) is faint on purpose in both
  themes -- it is quieter against black than it now is against white.
- **The tokeniser was writing `var()` into SVG presentation attributes**
  (`stroke="var(--dc-n-d9b478, #D9B478)"`), which does not resolve: the path
  then draws with the default, a black fill and no stroke. It had reached the
  arch mark in the onboarding strip. `stroke`/`fill`/`stop-color` are skipped
  now, beside the existing `<meta>` skip -- and the gold needs no theming
  anyway, being the brand colour in both.
- **`test/light-theme.test.mjs` is the guard this theme never had**, and it
  earned its place immediately by failing on two drifts I had just written:
  `--dc-bg-alt` set to #F7F7F9 in the sheet and #FFFFFF by the generator, and a
  page tinted far enough to still read as cream. It compares the hand-written
  token block against `daylight()` colour for colour, asserts a card outranks
  the page IN BOTH THEMES, and fails on a var() in an SVG attribute.
- Night is untouched: every dark value in the generated token sheet is
  byte-identical, the two additions being golds that map to themselves.

## The card itself travels, under a closed fist (v3.98.0, 3 Sept 2026)

Youssef: "make dragging the whole box not the title and also show this logo of
hand gripping."

- **The ghost is a CLONE of the cell**, not a pill with the clip's title in it.
  A rebuilt summary reads as a second, different thing appearing on the
  surface; the clone is the card leaving it -- thumbnail, caption and the
  export's own inline styles, tilted 2° with a shadow and a gold ring. The grip
  is stripped from the copy: a handle on something already in the air means
  nothing. `data-slot-title` existed ONLY to label the old text ghost and is
  removed with it rather than left in the export.
- **A wide row is SCALED, never narrowed.** A Day card is ~814px, and setting
  the clone a smaller width makes the row re-wrap -- what then follows the
  pointer is a jumbled block rather than the thing that was picked up.
  `transform: scale()` from the top left, capped at 400px, with the ghost box
  sized to the scaled result so the ring and shadow still wrap it. Measured:
  814x162 becomes 400x64 and keeps the row's shape.
- **The ghost sits down-and-right of the pointer, never under it.** The cell
  being aimed at is the one at the pointer and it wears the gold ring that says
  so; a ghost centred on the cursor covers exactly what you are trying to see.
- **The grabbing fist is set on BODY, and it has to be.** Pointer capture keeps
  the events on the source cell, but the cursor is drawn from whatever is under
  the pointer -- which mid-drag is a different cell each time, so a `:active`
  rule on the source never shows. `body.dc-dragging` is added when the drag
  actually starts and removed on every ending, cancel included.
- Driven in both views with real PointerEvents: the clone carries a planted
  thumbnail, the body cursor reads `grabbing` mid-drag and `auto` after a
  cancel, and no ghost survives.

## The first screen a new account ever sees (v3.99.0, 3 Sept 2026)

Youssef: "make it VERY OBVIOUS FOR NEW USERS TO HELP THEM." Measured on a
genuinely empty account at 1440x950 before anything was designed, and three
things were wrong -- none of them the Getting-started strip:

1. **The one action that matters was the smallest thing on screen.** The paste
   field sat at y=566 in 13px type, under a **58px marketing headline** and a
   gold button pointing somewhere else. The loudest thing on a signed-in
   beginner's screen was "One lecture. A week of reels." -- the PUBLIC SITE's
   headline, selling the product to somebody who has already signed up. 118px
   of the most valuable space, saying nothing anyone can act on.
2. **Nothing set expectations.** No mention of the ~20 minutes, what it costs,
   or that they would be told when it finished. This file already records the
   consequence -- "The pipeline takes ~20 minutes and people leave" -- as the
   reason the nudge emails exist. The screen never said it.
3. **Nothing showed what a clip looks like.** The right column was three empty
   dashed rectangles under "Latest clips", in front of the one person who has
   never seen the output.

- **It REPLACES the two marketing text nodes and leaves the real paste row
  untouched in place.** Every handler on that row is the export's own;
  reimplementing them is how a second control for one thing gets born. Found
  by TAG and by "the node after it" (`left.querySelector('h1')`, then its
  sibling `<p>`), never by a hashed class -- a test asserts no `.sNN` appears
  anywhere in the painter.
- **It absorbs the strip rather than sitting beside it.** The panel carries the
  same three beats in full, so the strip stands down while it is up and takes
  over the moment a lecture is in. That is the whole lesson of v3.96.0 and
  repeating it one release later would have been indefensible.
- **`imported` had to be carried through the adapter binding, and was not at
  first.** Without it an account whose lecture came back EMPTY -- still on
  Create -- would be shown the entire beginner's guide a second time. One flag
  (`firstRun`) is read by the desktop panel and the phone card, so the two
  surfaces cannot disagree about who is a beginner.
- **A strip of finished clips was built for the empty column and DELETED.** The
  export already carries "Nothing in your library yet -- this is what one
  lecture produces", with scored clip cards, one scroll below. Two answers to
  "what comes back" is the same fault as two onboarding systems. The column
  carries the TOUR instead, which nothing else offers: it walks the four
  screens and had shipped as a **12px grey link**, the quietest element on a
  beginner's screen.
- **The primary action had to LOOK primary.** `body.dc-firstrun` (a body class,
  because the patcher resets an inline style it owns on every render and never
  touches body) enlarges the paste field and makes Start job a SOLID gold
  button. Measured after: field 357x48, Start job 114x48 solid, and the tour
  demoted to an outline -- a gold tour button beside an outlined paste field
  had made the secondary action the loudest thing on the screen.
- **Everything it hides is restored**, marked with `data-dcfr-hid` /
  `data-dcfr-was`, and the body class goes with it. Verified by driving both
  accounts: brand new gets 4 panel parts, strip down, headline hidden, column
  replaced; one that imported and got nothing gets 0 parts, strip back,
  headline back, all 5 column children back.
- **The phone got the same treatment.** The beats and the cost render from the
  same binding, and the greeting plus today's date are hidden for a beginner --
  on an 844px screen they were 90px of the fold above the one thing to do,
  which pushed the paste field off it entirely.

**Two of the three red-probes did not go red the first time**, which is the
rule this file keeps restating earning its keep. The test asserted the
adapter's `firstRun` flag but not the PAINTER's own gate, so deleting
`!ob.imported` from the painter broke nothing; and the showcase probe replaced
a string that no longer existed, so it silently tested the unchanged file. Both
are pinned properly now and both were re-proven red.
## The scripture template is free (v3.99.1, 3 Sept 2026)

Youssef: "quran recitation should allow basic plans as well so one quran one
lecture." So Basic gets TWO styles -- Clean Line for a lecture, Quran
Recitation for a recitation -- and the other three stay Pro.

- **Flipping `pro` in the template file is one line. What it collides with is
  not.** That template ships with an empty watermark at zero opacity, because
  nothing is drawn over an ayah -- and `assertWatermarkAllowed` refuses exactly
  that shape from a free account. So the moment Basic could SELECT it, saving
  it would have been refused with "Removing the DeenClipped watermark is a Pro
  feature": an account handed a template it could not use, and an error
  blaming it for something it never did. Found by asking what else knows about
  this template, not by the change itself.
- **`templates.isScriptureTemplate(id)` reads the SHIPPED file** and answers
  from the caption mode (`quran`), never from an id string typed twice and
  never from the account's own copy. That last part is the hole it closes: an
  override that switches an ordinary template into quran caption mode must not
  mint an exemption for itself, or the watermark paywall is one setting away
  from being off for everybody. It also refuses a path with a slash or a dot in
  it -- the argument reaches a filename.
- **The exemption is passed the template id at every call site**, including the
  per-clip one, where it comes from the clip's own `templateId`.
- **The trade is stated, not hidden.** A free account can now publish a
  recitation clip with no mark burned into the frame. That is deliberate:
  nothing is drawn over scripture, and that rule outranks the watermark. The
  attribution moves rather than disappearing -- a free account's posts already
  carry the credit line in their caption (`postCredit`, v3.79.0). The comment
  in `pricing.test.mjs` that used to justify the exemption by the template
  being Pro-only says this instead.
- `test/free-quran-template.test.mjs` drives it over HTTP with a REAL free
  account, because the gate lives inside the request handler and nothing a
  unit test can reach crosses it. Proven red both ways: with `pro: true`
  restored, and with the exemption removed while the template stayed free --
  each fails one assertion, and they are different assertions.
- The plan-gating law now asserts the free pair covers both KINDS -- one
  template whose caption mode is `quran` and one whose is not -- so "one quran
  one lecture" is checked rather than merely named.

## A button waited for the network to look pressed (v3.99.2, 3 Sept 2026)

Youssef, on the Start-job panel: "THIS PART is very slow and cluckly when i
click one of the buttons theres a delay."

Measured rather than guessed, and it was two faults stacked:

- **The clip-length and clip-count chips wrote to the server before drawing.**
  Timed on a click: the handler returned in 0.7ms, then `POST
  /api/clip-settings` took 7ms and a full `GET /api/state` took 37 -- and only
  THEN did the chip repaint. Locally. On production both legs cross the
  internet. `onClipSettings` applies the change to the local copy and paints at
  once now, then writes; `studioDo`'s own refresh reconciles when it lands.
  **The refusal path was proven, not assumed** -- a stubbed 400 still toasts
  and re-renders from the truth, which is the whole risk of an optimistic write
  and the reason it goes through studioDo rather than around it.
- **Even a lone click waited for a frame.** `setRefresh` coalesced every
  repaint into a rAF with an 80ms timer behind it. That coalescing is not
  wrong -- dragging a caption fires hundreds of events a second and a render
  per event throws all but the last away (v3.53.4) -- but a single click is not
  a burst, and it was paying a drag's price. An interaction with no recent
  paint behind it now renders synchronously; inside a burst the gap is under a
  frame and the old path takes over. The rAF **and** the 80ms backstop both
  stay: rAF is suspended in a window Chrome thinks is occluded, and one
  suspended frame once held the latch and swallowed every later repaint.
- Measured after, same click: **first paint 45.7ms -> 0.3ms**, with the
  reconciling paint at 64.9ms that nobody sees because the screen is already
  right.
- The whole studio render is ~11ms on an empty account and ~45ms with the job
  panel open, and THAT was never the problem -- worth remembering before
  optimising the renderer. The latency was all waiting.

## Sign-up: a robot box, and a six-digit code (v3.100.0, 3 Sept 2026)

Youssef: "when signing up to an account firstfly add cloudflare are you a robot
box, also see how this pops up after email log in add verifcation so this
doesnt pop up so we send them a 6 digit code to their email."

### The dialog was right and its TIMING was wrong

"Your email address is not confirmed yet, so imports are blocked" arrived after
signing up, after picking a lecture, after seven steps of the wizard, at the
press of Start. Nothing was broken -- the confirmation simply happened NOWHERE
until it happened in the way. A new account now goes to `/verify` instead of
the app and types a code while it is still thinking about its email address.

- **The code and the link are one record.** `createVerification` returns
  `{ raw, code }`, both stored hashed, so confirming either way consumes the
  other and a code cannot be replayed after the link was used. The link stays
  for whoever opens the mail on a different device from the one they signed up
  on, and `/auth/verify` is untouched.
- **Six digits is a million guesses, so the record allows SIX attempts** and
  then is spent -- the real code stops working too, which is the half that
  makes the limit mean anything. Resending mints a new one, which is the door a
  real person uses. The route is throttled on top of that, per address and IP.
- **The lookup is scoped to ONE user.** Searching every pending record for
  matching digits would let a guesser hit every open sign-up at once instead of
  one account's six.
- `% 1000000` on a random 32-bit number is very slightly biased towards low
  codes. Rejection sampling costs one loop and removes the argument.
- The mail LEADS with the code, including in the subject, because that is what
  a phone shows on the lock screen -- and `verificationMessage(link)` with no
  code still sends the old mail, so nothing written before this breaks.

### The robot box

- **Inert without keys**, deliberately: an unconfigured deployment signs people
  up exactly as it did rather than rendering a box that cannot load and locking
  everybody out. That is also what keeps the suite honest -- it creates dozens
  of accounts and none can solve a challenge.
- **It FAILS CLOSED once configured.** A challenge that cannot be checked has
  not been passed; an outage at Cloudflare is a bad hour, an open door is
  worse. Proven against a rejecting fetch, a `success:false` body and a
  `success:true` body.
- **Checked BEFORE the password is hashed.** Hashing is deliberately expensive,
  and letting an unsolved challenge reach it hands out a cheap way to burn the
  CPU.
- **The CSP admits `challenges.cloudflare.com` on `/login` ONLY**, and only
  when the keys are set. Widening script-src app-wide for a widget on one form
  would spend the strictness that makes the policy worth having. A blocked
  third-party script fails SILENTLY -- the widget renders nothing, the form has
  no answer to send, and every sign-up is refused -- so the scoping has a test.
- `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` on Render arm it. Both are
  trimmed: a credential pasted into that field picks up a trailing newline
  routinely.

### Switching email on must not lock out the people already here (v3.101.1, 3 Sept)

**It shipped as v3.101.1, whatever its commit subject says.** That commit is
titled "(v3.100.1)" and the `package.json` inside it reads `3.101.1` -- two
sessions were bumping the same minute and the subject was written before the
rebump. The version in `package.json` is the one the worker deploy compares
against the running container, so that is the number this file records.


Found by asking what `EMAIL_API_KEY` actually DOES the moment it is set, rather
than by testing the feature: `verificationRequired()` flips false -> true for
the whole deployment, and `isVerified` then answers false for every account
that ever signed up with an email and password. So setting one environment
variable would have retroactively blocked every existing customer from
importing -- including the operator's own account, unless it came in through
Google. They signed up under different rules and have already paid tokens for
work they would suddenly be refused.

`state.authSettings.verificationSince` is stamped the first time a request
arrives with mail configured, and an account created before it is treated as
confirmed. **The stamp is BOOT time, not the time of the call**: it is written
lazily, on whichever request happens to ask first, so `now()` would grandfather
anything created between the process starting and that first question -- a tiny
window in production and a real one in a test, which is what caught it. A
Google or Apple account is still proof of the address whenever it arrived, and
anyone signing up after the switch is still asked.

**Driven end to end against the real Cloudflare siteverify**, using their
always-passes test keys: a sign-up with no answer was refused, one with an
answer created the account and redirected to `/verify` rather than `/app`, the
widget rendered under the live CSP, and a wrong code came back with its error
on the page. The right-code path is proven by test rather than in the browser
-- the code only exists inside the email, and the mail provider is not
configured here.

## The renderer reads the lecture, not the clip (v3.101.0, 3 Sept 2026)

v3.77.1 rebuilt the Quran matcher around one idea -- recitation runs in order,
so the verse before this one is context worth having -- and walked the WHOLE
lecture once to get it. Then it used that walk for one thing only: moving a
clip's EDGES onto a verse. `write_ass` threw it away and re-derived every
caption from the clip's own segments **in isolation**, which is exactly the
isolation the walk exists to escape. That is why one clip out of that
recitation still captioned nothing, and why this file has carried "that is the
next step and it is not done" since.

- **The premise was measured before anything was built, and it is the whole
  argument.** Whisper wrote 39:71 as "وسيك الذي كفرو بجها لمذمرا حت جا اتحت
  بوبها". Matched on its own that reaches **nothing** -- blind search holds a
  strict floor and this is under it. Matched after the verse before it, it is a
  named hypothesis rather than a search and comes back at **0.713**. The clip's
  words never change; what changes is whether the lecture in front of them is
  there to be read. `ThePremiseTests` pins both halves, so the fix cannot be
  believed without the failure being reproducible.
- **The walk happens ONCE and both consumers read it.** `lecture_ayat` returns
  `{start, end, ayah}` in media time; `ayah_spans` (the snapper) is derived
  from it, and `attach_lecture_ayat` slices each clip's own share onto
  `Candidate.ayat`. Walking twice would be two answers to one question, which
  is how the edges a clip snaps to and the verses it captions drift apart.
- **It runs for EVERY lecture now, not only the Quran template**, because
  scripture is captioned on every template (invariant 7) and the cost is
  nothing: measured at real corpus size (6236 ayat), **0.53s over an
  eight-thousand-word English lecture and 0.07s over Arabic**, against a job
  that runs minutes to hours. `quran.load()` is cache-only and memoised, so
  this adds no download and no second read.
- **It is only ever ADDITIVE.** The map is authoritative wherever it speaks --
  it read the recitation running INTO the clip and the per-segment match
  cannot -- and where it says nothing, the old per-segment match still runs.
  `lecture_covers` uses a half-overlap rule: a segment the map already holds
  half of is a verse the map is already drawing, and letting the weaker guess
  draw over it is two ayat on screen at once; below half there is real
  uncovered speech and the old path gets its turn.
- **A re-render walked nothing in this release, and that was corrected the
  same day** (v3.102.0 below): the job carries the WHOLE lecture's segments,
  so an unedited re-render walks them and gets the same context a first
  render does. `write_ass`'s `ayat is None` path still exists and is still
  tested -- it is what an edited clip's reflowed text or a stored candidate
  from before this takes. **Empty and absent are deliberately different
  statements**: `[]` means a lecture was walked and this clip holds no
  scripture, `None` means nobody walked one.
- **`retime_for_cuts` remaps the map, and that was a real find rather than a
  fix to something broken.** `dataclasses.replace` would have carried `ayat`
  through UNTOUCHED, so after a cut scripture would be drawn at the wrong
  second -- silently, because nothing downstream can tell a stale time from a
  fresh one. Today the two cannot meet (cuts arrive only on a re-render, which
  has no map), so this is written for the release that changes that, not for
  one that has already shipped.
- **`matched_ayahs` is sorted before it returns.** The lecture's verses are
  appended ahead of the per-segment ones, so the list stopped being in the
  order the clip plays -- and the editor draws its caption blocks from it
  (invariant 4), where an out-of-order list reads as the clip jumping about.
- **Counting `,Ayah,,` counts PAGES, not scripture.** A long verse is paged
  across the time it is recited: one ayah, three Dialogue events. The first cut
  of the double-caption test asserted on that count and failed against correct
  code. It asserts on `write_ass`'s returned rows now -- executed output, the
  rule this file keeps restating.
- All four probes were **proven RED** against the behaviour they pin: the
  quran path not reading the map, the covered-stretch skip removed, a cut not
  retiming the map, and attach forgetting the clip-local conversion.
- **Worker change, so `deploy-worker.yml` deploys it on push.** As of
  v3.102.0 it reaches clips already on the channel too, the moment they are
  re-rendered. **Not yet seen on a real recitation** -- the proof here is the
  matcher and the ASS file, not a frame; the confirmation costs one Quran
  import.


## A chosen crop bias was refused whenever OpenCV was missing (v3.101.2, 3 Sept 2026)

Found by going after the suite's seven permanent skips, and it turned out to be
a product fault wearing a test problem's clothes.

- **`smartFramingBias: left` needs no face detector.** The code says so in its
  own comment -- "A fixed bias needs no detection at all" -- and the branch is
  pure arithmetic on ffprobe's width and height. But `cv2_problem()` ran at the
  TOP of both `track_speaker_keyframes` and `detect_main_face_crop`, so a box
  whose OpenCV is missing or broken refused a bias the customer had explicitly
  chosen, with the reason "OpenCV is not installed on this server". Reproduced
  here, where cv2 genuinely is not installed: left, centre and right all came
  back `available: False`. The guard sits BELOW the manual branch now; `auto`
  still refuses honestly, and a portrait source now gets the truer reason
  ("already narrower than the output") instead of blaming OpenCV.
- **This is the v3.x OpenCV-5 incident by another door.** CLAUDE.md records
  every job falling back to a centre crop when `CascadeClassifier` vanished.
  That fallback also silently took `left` and `right` with it, though nothing
  in those branches had broken.
- **The seven skips were never about faces.** The class comment said they check
  "the deterministic paths -- the ones that do not depend on real faces". They
  waited on `/tmp/track_test.mp4`, which nothing created, so the crop maths --
  ratio kept, inside the source, biases ordered left to right -- had never run
  anywhere. The class builds a 6s testsrc with ffmpeg (native `mpeg4`, since
  libx264 is not in every build) and skips per TEST where ffmpeg is absent, so
  a clean checkout still runs and the skips are COUNTED rather than vanishing.
  **The first cut got both of those wrong and turned the branch red twice**:
  it asked for libx264, and it raised SkipTest from `setUpClass`, which counts
  as ONE skip while the seven tests drop out of the total -- the handover
  guard read "541 (1 skipped)" and rightly said seven tests had VANISHED.
  **The CI runner has no working ffmpeg**, measured: with the native codec and
  per-test skips it reports exactly "572 (7 skipped)". So these seven run for
  anyone with ffmpeg and skip in CI, and the count above says so. Installing
  ffmpeg in `ci.yml` (~30s a run) would make them run there; that is a
  trade-off for Youssef, not a default.
- **What this does NOT prove**: that face detection finds a face. testsrc has
  none, `bias=auto` correctly declines, and nothing here replaces the real
  video and the look at a frame the open items still ask for.

## The Quran pages follow the reciter, and every title is English (v3.102.0, 3 Sept 2026)

Youssef, mid-session: "the quran clips DO NOT even sync well, like its very
off, also AI titling needs SO MUCH IMPROVING AND ONLY WRITTEN IN ENGLISH ALL
TITLES." Two faults, both real, both measured before anything was built.

### Sync: a ruler was laid over the recitation

- **A verse's pages shared its time out by WORD COUNT.** `ayah_events` split a
  long ayah into pages of `AYAH_MAX_WORDS` and gave each `span * words/total`
  -- a ruler. A reciter holds a madd on the last word of a page for four
  seconds; the ruler does not know he paused, so the next page was already up
  while the held word was still sounding. **Measured on a 12-word verse with
  one 4s madd: the ruler flips page 1 -> 2 at 4.00s while the word sounds until
  6.18s -- 2.18s EARLY. Paged to the words, 0.00s off.**
- **The lecture walk already knew which transcript words aligned to each verse
  and when Whisper heard them.** Each hit now carries them (`words`), attach
  converts them to clip-local, `retime_for_cuts` moves them through a cut, and
  `ayah_events(word_times=...)` ends each page where its LAST ALIGNED WORD
  ends. Uthmani and transcript word counts differ (Whisper runs words together),
  so the share is carried across by proportion of index and then SNAPPED to a
  real word end. Monotonic by construction: a boundary that would run backwards
  falls back to the ruler for that page only, and a test feeds it one.
- **The outer span was the other half, and v3.101.0 had already fixed it for
  first renders**: a verse used to start at its SEGMENT's start, and a Whisper
  segment on recitation is a whole breath. The word-level map starts it where
  its first aligned word starts.
- **Re-renders get all of it now.** The first cut of this walked only the
  clip's own window on re-render and found nothing for a clip opening on a
  damaged verse -- the v3.101.0 failure, reproduced by the test. The job
  carries the WHOLE lecture's segments (`transcriptSegments`, cut to the window
  a line later), so an unedited re-render walks all of them and has the same
  preceding-verse context a first render has. An EDITED clip walks its reflowed
  text, because the editor's words win over Whisper's there. Driven up to the
  render with `render_clip` replaced, reading the candidate it was handed.
- **What this does NOT fix, said plainly**: Whisper's own timestamp error on
  recitation. Elongated tajweed is closer to singing than to speech and the
  `small` model's word times on it are imperfect; this change follows them
  instead of ignoring them, which is strictly better and still bounded by
  them. The rescale to `medium` (open item 5) is what tightens that. The
  550ms fade-in is a design choice, not lag, and was left alone.

### Titles: three sources, all of them could write Arabic

- **The prompt never mentioned language**, so an Arabic clip got an Arabic
  title. The fallback titler and the dedupe both read `clip.text`, which for an
  Arabic clip IS Arabic. And Whisper's English translation had been sitting on
  `segment["english"]` since the bilingual pass shipped, read by the caption
  path and by nothing that names a clip.
- **`clip_english(candidate)` is the one reader**: the clip's own words when it
  is spoken in English, the joined translations when it is Arabic (letters
  counted, not guessed), its own words when Arabic with no translation. It
  feeds the PROMPT (the model reads English for an Arabic clip -- asking a 1.7B
  model to translate AND title was two jobs), the fallback titler, the dedupe's
  candidates, and `looks_copied` -- which used to compare the model's title
  against the ARABIC text, so a sentence copied out of the translation sailed
  through. Proven by test.
- **The rule is stated in the prompt TWICE** -- in TITLES and in the
  BEFORE-YOU-ANSWER restatement that sits last before the data, the only place
  a rule reliably lands on this model -- **and enforced in code regardless.**
  `is_english_title` refuses any Arabic-script letter; "Allah", "sabr" and
  "dua" in Latin letters are English titles in this niche. A refused row falls
  to the titler that reads the translation. `ship_title` is the last gate at
  every place a title is chosen (the render, the plan, the dedupe), so a title
  stored before this rule cannot reach a channel in Arabic either.
- **The honest limit**: an Arabic clip with NO translation (an older
  faster-whisper) ships the numbered English fallback, "Important reminder N".
  Bland and English, rather than good and Arabic -- the instruction was every
  title, not most. On the production path the translate pass fires whenever
  Arabic was transcribed, so this is the rare case.
- Every probe proven RED: paging ignoring the word times, the row check
  removed, `clip_english` never reading the translation, the re-render walking
  only its window, and the LANGUAGE rule dropped from the prompt. Seventeen
  titling tests and seven sync tests, on executed output -- the prompt bytes
  that go to Ollama, the ASS event times, the candidate handed to the render.
- **Worker change, deploys on push.** Titles change for lectures processed
  from now on; sync reaches existing Quran clips when they are re-rendered
  (a template save re-renders every clip still waiting). Neither has been
  seen on a real frame yet.
## The connections dialog was clunky in three separate ways (v3.102.0)

Youssef, 3 Sept 2026, with a screenshot: "ALL connecting and disccount and so
many issues with connecting tiktok its a mess ... it just messy cluncky
conntions feel un statifying and dont know if im connecting or not, tiktok
gives back 504 errors, when disconnecting nothing changes not instant."

Three faults, none of which errors or logs. The dialog simply feels broken.

- **The 504 was ours, not TikTok's.** `jsonRequest` defaults to a 120-SECOND
  timeout, and `queryTikTokCreator` took it -- but that call runs inside a
  request a BROWSER is waiting on (opening the publish options, testing a
  connection). Render's proxy gives up long before two minutes and answers the
  browser 504, so a slow TikTok could never surface its own error: the gateway
  killed the request first and the customer saw a bare 504 that says nothing
  about TikTok at all. Fifteen seconds now, on that call only -- the long
  default is right for the UPLOAD path, where a big file genuinely takes
  minutes and nobody is watching a spinner.
- **Disconnect waited for a round trip before the row changed.** Same fault as
  the Start-job chips earlier the same day: POST, then a full GET /api/state,
  and only then a repaint. It is optimistic now. **Measured against a
  deliberately 3-SECOND server: the row reaches its final state in 59ms.**
- **THE FIRST CUT MUTATED THE WRONG SHAPE AND ONLY MEASURING CAUGHT IT.** The
  row reads `DATA.social.providers[key]`, not `DATA.socialConnections`; nulling
  the latter took the row as far as "Paused" while it went on naming an account
  that had just been removed. The probe printed that intermediate text, which
  is the only reason it was noticed -- reading the diff would not have shown
  it. Clear `connected`, `accounts` AND the publishing entry, and for Meta
  clear BOTH instagram and facebook or the other one keeps showing a dead
  account.
- **Connect said nothing while it worked.** It hands off to the platform's
  OAuth page, and until that page paints there was nothing on screen: on a slow
  hop, several seconds of a dialog that looks like it ignored the press. The
  button now reads "Opening…", refuses a second press, and puts itself back
  after six seconds if the hand-off never happened -- a button stuck on
  "Opening…" for ever would be a worse lie than the silence.
- **The headroom hint repeated the button beside it, under every platform.**
  "STUDIO · 1 OF 3 CHANNELS CONNECTED" plus "Press Connect again to add
  another." -- four platforms, eight lines of near-identical boilerplate
  burying the actual controls, and the sentence said what the button two inches
  away already says in two words ("Add another"). The COUNT stays, because "how
  do I know I get three?" is a real question and this is the screen that
  answers it (v3.72.1); the plan name goes, because the header pill already
  carries it.

## TikTok's posting options moved into a sheet of their own (v3.103.0)

Youssef, 3 Sept 2026: "add settings next to tiktok and move all the settings on
that button when clicked opens a new page in the middle fix the new look of the
whole thing as well, make it look a lot better easy to congiure less confusing
but looks great."

- **The panel is unchanged; only where it is drawn.** Its per-account privacy,
  the interaction toggles, the commercial disclosure and the Music Usage
  Confirmation line are what TikTok's review checks, so this moves the mount
  point and touches nothing inside. It used to sit permanently under the
  platform list, which made the dialog long AND read as though one platform's
  posting options governed the four connections above them.
- **`HAS_SETTINGS` is an explicit list, not a button on every row.** TikTok is
  the only platform with a real panel behind it today; a Settings button on the
  others would be a control that opens nothing (invariant 9).
- **The sheet lives INSIDE the connections card**, so it is dismissed with the
  dialog and cannot outlive it, and it carries a scrim -- without one the rows
  behind stay clickable and a stray press changes a connection while its
  options are open. Back arrow, ×, and the scrim all close it; all three were
  clicked rather than assumed.
- **The row is three grid rows now**: identity, channel count, actions. A first
  cut gave the count and the actions the same `grid-area` and they were drawn
  ON TOP of each other -- "1 OF 3 CHANNELS CONNECTED" superimposed over "Add
  another Settings Disconnect". Found by looking at it, which is the rule this
  file has repeated since August.
- **THE INLINE-SCRIPT-SCOPE TRAP, FOR THE FOURTH TIME.** `paintTikTokOptions`
  and the sheet live in a different scope from `paintConnections`, so the close
  button threw "paintConnections is not defined" and the sheet would not shut
  -- silently, because a click handler's exception goes to the console and
  nowhere a user looks. It is `window.paintConnections` now, like
  `fireClipNotifs`, `paintAccount` and `openBug` before it. Anything reached
  across scopes in index.html goes through `window`, every time.

## Every connected channel is a row now (v3.104.0, 3 Sept 2026)

Youssef, comparing us with OpusClip: "ours is good but not great and no layout
to see 3 connected channels with each @".

- **The channel list appeared only once a SECOND account existed.** So a
  platform with one connected channel showed a COUNT and no channel -- the app
  knew the account's name and did not print it. Every connected channel is a
  row now, at one as at three.
- **Each row carries the account's own face, name and handle**, plus its tick
  (post here) and its own disconnect. The face is the platform's avatar where
  there is one and the name's initial where there is not.
- **The @handle is shown ONLY where the platform actually gives us one.**
  TikTok's `creator_info` carries `creator_username`; YouTube and Meta hand us a
  display name and nothing else. An @ invented from a display name is a handle
  that may not exist, so it is omitted rather than guessed -- the name stands
  alone.
- **The container is a flex COLUMN.** Left to the row's own grid the labels
  flowed inline and wrapped two-per-line, which reads as a tag cloud rather
  than a list of accounts; and without `width: 100%` on the row they
  shrink-wrapped to their text and sat centred. Measured after: three rows,
  410px each, no page overflow.
- Two tests written earlier the same day asserted strings this moved
  ("channels connected", and the exact one-line `.studio-conn-accounts` rule).
  Both were updated to follow the code rather than deleted -- the behaviour
  they protect is unchanged.

## Every connected channel gets a row of its own (v3.103.1, 3 Sept 2026)

Youssef, comparing us with OpusClip: "opus layout is better like ours is good
but not great and no layout to see 3 connected channels with each @".

He was right, and the gap was structural rather than cosmetic. The dialog was
one row per PLATFORM, and the channel list rendered only once a SECOND account
existed -- so a platform with one channel showed a count and no channel, and
even at three they were bare names in wrapping pills.

- **The list is drawn whenever there is anything to list.** Nothing to show is
  now the only reason to show nothing.
- **A row carries a face, a name and a handle**: the account's avatar (initials
  when the platform gives none), its display name, and its @handle.
- **The @ comes from the platform, never from the display name.** TikTok's
  `creator_info` hands us a real `creator_username`; YouTube and Meta give a
  display name and nothing else. Inventing "@DeenClipped" from a display name
  would be putting a handle on screen that may not exist, so where there is no
  username the name stands alone.
- **They stack full width.** As chips they wrapped two-across and left a ragged
  third on its own line -- fine when a channel was a name, wrong once each row
  carries three pieces of information. The rule is id-scoped (`#studioConnList
  .studio-conn-account`) because the older chip rule was, and specificity
  decides; a plain class rule was written first and lost silently.
- The tick (post here) and the per-channel × are unchanged, and the × is still
  drawn only for YouTube and TikTok -- Facebook and Instagram are Pages inside
  ONE Meta login, where a per-account disconnect would tear out that login and
  take the other platform with it (v3.56.0).

## The ayah renders smaller than its own gloss, and why that is not yet fixed

Youssef, 3 Sept 2026, with a live Short from the channel: "see exmaple of quran
recistiation IS GREAT DONT GET ME WRONG. just make sure quran text is equal
size to translation." On that frame the Arabic is visibly SMALLER than the
English under it.

**Every model in the code says the opposite**, which is the whole problem.
Measured from the exact font files the image ships -- `UthmanicHafs.ttf` win
cell 1.758 em with its tallest un-vowelled letter at 0.806 em, `Outfit-Regular`
win cell 1.260 with cap/ascender 0.724 -- the ayah should draw about **twice**
the gloss on the Quran template, which is what `AYAH_SIZE_SCALE`'s own comment
claims it was tuned for. The photograph disproves it.

**A real bug was found on the way, and it is worth fixing whatever the sizes
turn out to be.** The two sizes come from UNRELATED template fields:

    ayah_size        = captionFontSize x ayah_nominal_scale(face)
    translation_size = captionTranslationSize

So the relationship between scripture and its translation is an ACCIDENT of two
independent numbers. Across the five shipped templates it lands at 2.05x
(quran-recitation), 2.35x (mono-minimal), 2.50x (clean-line), 4.10x (headline)
and 6.86x (bold-stack) -- and a per-account override can put it anywhere.
Scripture is captioned on every template (invariant 7), so this is not confined
to the Quran one. Whatever the right ratio is, it should be DERIVED from one
size rather than emerging from both.

**`AYAH_SIZE_SCALE` is 3.54 -> 4.40 -> 5.80, and the last step is MEASURED.**

3.54 was a guess corrected by eyeballing the Short (4.40). Then a real clip was
re-rendered on the box at 4.40 and the frame measured -- and that is the number
that counts. No libass was needed for it: the render itself came off the
worker, and the frame was pulled from the clip's own R2 URL and decoded with
plain ffmpeg.

    crop the caption band, decode to gray8, threshold the pure-white ink at 254
    Arabic letterforms   y 694-709   16px
    English cap height   y 778-798   21px

16/21 = 0.76 -- still three quarters the size of its gloss at 4.40.
4.40 x 21/16 = 5.78, rounded to **5.80** for the equal sizing that was asked
for.

**This is the route for any future caption-size question, and it does not need
the container:** re-render one clip through the app, download the render from
`media.deenclipped.online`, take a frame with `ffmpeg -ss`, and measure the lit
rows. It settled in one cycle what the arithmetic had had wrong for months.

### And then it was still hard to read, because it was the STROKE

Youssef, on the re-render at 5.80: "it should look cleaner i feel like its too
thin or something its hard to see."

Not size -- **stroke weight**. The Ayah and Translation styles shared one
outline width, and the Quran template sets `captionOutlineWidth: 1`. On Outfit,
a geometric sans with a solid stem, a 1px edge is enough. A mushaf face is not
that: Uthmanic script runs to hairlines at the joins and through the tashkeel,
so the same 1px left scripture with almost no separation from a bright, busy
frame -- which is where these clips live. Making the two lines the same HEIGHT
did nothing for this.

`AYAH_OUTLINE_MIN = 3.0`, applied as a **floor and not a multiple**. A 3x
multiple was written first and would have given Clean Line an 18px edge -- a
black blob round every letter. Only the templates that leave scripture
under-outlined move: quran-recitation 1 -> 3, and clean-line, bold-stack and
mono-minimal are untouched at 5, 6 and 5.

**The arithmetic in the AYAH_SIZE_SCALE comment block is DISPROVED** -- by two
separate frames now -- and must not be trusted over a render.

The overflow risk of a 24% bigger line was checked rather than assumed: the
ayah Dialogue already carries `{\q0}` (clip_worker.py:2579), so a longer line
wraps instead of running off both edges -- invariant 8 holds.

## The promo bar: a brand call-out that comes and goes (v3.106.0, 3 Sept 2026)

Youssef, with the artwork: "add this under watermark ... it comes in the video
after 3 seconds then for 3 seconds it stays on the video then goes, add
animation in and animation out as well."

- **`promoBarEnabled` is OFF by default and carries no plan gate.** It burns a
  brand bar into a customer's clip, which is their decision. The watermark
  above it in the same panel is the opposite -- it is the free plan's price and
  `assertWatermarkAllowed` enforces it. Two switches side by side that look
  alike and mean different things, so the difference is written here.
- **A missing asset makes it inert, never an error.** `promo_bar_plan` returns
  None when `worker/assets/promo-bar.png` is absent, so an account with the
  switch on and no artwork installed renders exactly as before instead of
  losing every clip to a failing overlay.
- **A short clip brings the bar forward rather than dropping it.** A start of
  3s on a 2s clip would otherwise show nothing at all; it is clamped back so
  the brand still appears.
- **It is composited AFTER the draft rescale**, and its input is appended after
  every other, so no existing ffmpeg input index moves. A bar sized for a final
  would be unreadable if it were scaled down with the frame to draft size, and
  a bar added before the rescale would be.
- **Animation is fade AND slide, at both ends**: `fade=…:alpha=1` for the
  opacity and a `t`-dependent `y` expression on the overlay for 46px of travel.
  `format=rgba` first, or transparent artwork composites as a black slab.
- **`promoBarEnabled` had to be added to THREE separate boolean lists** in
  templates.js (the coercion loop, the field list and `BOOLEAN_FIELDS`).
  Missing any one of them drops the field silently: it reads back `undefined`
  and the switch looks broken while every number beside it saves fine. That is
  how it presented on the first attempt.

## The brand switches belong to the account, and the schedule shows logos (v3.107.0)

Youssef, 3 Sept 2026, two things in one sitting.

**"the watermark and promotion should not need to save with template it just
works with all templates once on it turns on for all."** Both are decisions
about what this app puts on top of a video, and neither belongs to a caption
style -- switching the watermark on for Clean Line and then rendering a Quran
clip without it is not a choice anybody meant to make. `applyToAllTemplates`
writes the field to every template the account has, and one helper serves both
switches so they cannot drift apart. **The paywall is untouched**: the server
checks `assertWatermarkAllowed` on every save, so a free account is refused on
the first one and the loop stops there.

**"for the logos here dont be writing just put logos that are posting."** A
schedule row going to two places read as "YouTube · DeenClipped — waiting
TikTok · DeenClipped — waiting" -- two sentences to say what two marks say.
The logo now carries it, at 16px.

**A PROBLEM STILL GETS ITS WORD**, and that is the whole care in this change.
Colour alone would be carrying the state, and this app has already shipped the
bug where a clip live on YouTube with a refused TikTok "looked entirely fine on
the row" (v3.28.0). `waiting`, `posting now` and `posted` are silent; anything
that needs a person keeps its text, and the full sentence stays on the span's
`title` for every row.

## The sync on an OLD clip cannot be fixed by re-rendering it

Youssef: "see how sync isnt there like reciter is talking but captiuons out of
sync." Checked rather than assumed, and the answer is in the stored data: this
clip's `transcript` is a **plain string**. There are no per-word timings on it
at all.

v3.102.0 made the ayah pages follow the reciter's own word times, but those
come from Whisper at TRANSCRIPTION time. A re-render does not re-transcribe --
it captions the stored transcript -- so a lecture transcribed before that
release has nothing for the pager to follow and falls back to sharing the span
out by word count, which drifts against a reciter who holds a madd.

**So the sync fix reaches new imports only.** Re-rendering an old Quran clip
will always drift, however many times it is run. Testing the sync work needs a
fresh import of a recitation, not a re-render of an existing one.

## The home-screen icon is a solid mark now, and the tab icon differs (v3.108.0)

Youssef, with a photo of his home screen: "Can we make deenclipped look better
it's not nice", then "Maybe add text or something idk", then "b".

**The fault was the outline, not the size.** The arch was `fill="none"` with a
4.4/64 stroke -- the only hairline drawing on a screen where iMessage, ChatGPT,
Waze, Facebook and TikTok are all SOLID silhouettes. A thin gold stroke on
near-black recedes among them however well it is drawn. The arch is filled now
with the play knocked out of it by `fill-rule="evenodd"`, so the mark is a
shape rather than a line.

**The text question was settled by rendering it, not by arguing.** Three
options were rasterised at a true 60px: mark only, mark + wordmark, and a "DC"
monogram. He chose the wordmark.

- **"DEEN", not "DEENCLIPPED".** Eleven characters across a 60px tile is a grey
  smear and forces the arch down to nothing; four are readable and leave the
  mark its room. The label under the icon says the rest.
- **THE TWO ASSETS NOW DIFFER, and that is the point.** Rendered at 16px the
  wordmark is an unreadable smudge AND it shrinks the arch, so the browser tab
  loses twice. `favicon.svg` is the mark alone at full size for tabs;
  `design/icon-app.svg` carries the wordmark and is the source rasterised to
  `apple-touch-icon.png` for the home screen. One design, two crops, each
  legible at the size it is actually seen.
- Rasterised with the Chromium already on the machine -- this repo has no npm
  dependencies on purpose, and that is what lets a phone session run the suite.
- **A home-screen icon already added does NOT update.** iOS copies it when the
  shortcut is created. Remove the shortcut and add it again to see the change.

## The promo bar drew nothing, and ffmpeg said it was fine (v3.109.2, 3 Sept 2026)

The bar itself shipped in v3.106.0 -- template fields, the Templates row under
Watermark, the fade-and-slide graph, six tests -- and was inert because the
artwork was never on disk. With the artwork in place it was still inert, and
NOTHING said so.

- **A bare `-i file.png` is ONE FRAME AT t=0.** So `fade=in:st=3` only ever saw
  a frame timestamped before its own start, held alpha at 0, and overlay's
  default eof_action repeated that transparent frame for the whole clip. Exit
  code 0, no warning, a completely flat render: measured at seven timestamps,
  **zero lit pixels at every one**. `-loop 1` with a `-t` to bound it fixes it;
  the same render then measures nothing at t=2.9, half-risen at t=3.1 (rows
  1661..1706), at rest through t=4.5 (1610..1706), sliding out at t=5.7
  (1634..1722) and gone by t=5.95 -- fade AND slide, proven at both ends.
- **Six passing tests could not have caught this**, and that is the point. They
  assert the PLAN and the GRAPH STRING, both of which were correct; the fault
  was one missing input flag two hundred characters away. The seventh test pins
  the flag and was proven red against its removal. Anything composited over a
  render must be measured on a frame, not inferred from a filter graph -- this
  file's oldest rule, hit from a new direction.
- **The artwork is generated, not a supplied file.** `design/promo-bar.svg`
  rasterises through the headless Chrome already on this machine (the route the
  app icon established), so there is no image dependency and no binary anybody
  has to keep. Swapping in different artwork is dropping a PNG with
  transparency at `worker/assets/promo-bar.png`; `worker/assets/README.md`
  states the requirements (~8:1, at least 1600px wide).
- **A missing asset is still never an error.** `promo_bar_plan` returns None
  when the file is absent, so a box that has not pulled it renders exactly as
  it did before.

## Six things from one sitting, and three of them were silent (v3.113.0, 3 Sept 2026)

Youssef sent three screenshots and a list. Each item below is one of them.

### Picking a clip length rebuilt all four cards

"when selecting forty five seconds, sixty seconds, etcetera, it does a weird,
like, refresh."

- The length/style block's signature carried the SELECTION, so every press
  replaced the whole row through `innerHTML`. The nodes were gone, so not one
  of the transitions the stylesheet already declares on `.lb`, `.lb-t`,
  `.lb-fill` and `.lb-k` could run -- and `lbGrow` re-triggered on all four
  bars at once. The CSS was right all along; it was never given a chance.
- The signature is STRUCTURE only now (which cards, on which step) and the
  selection is applied in place on every paint: two class lists and one
  sentence. **Proven both ways in a browser**: with the selection in the
  signature one press left all four probes GONE; without it every node
  survived (`sameNodes: true`) and only the classes and the note changed.
- **The click handler had to stop trusting its closure.** With no rebuild it
  outlives the render that bound it, so a closure over `bands` would hold
  whatever was selected at bind time and the second press would undo the
  first. It re-reads `DATA.clipSettings.clipLengthBands` at click time.
- A hidden Browser pane freezes CSS animations at `currentTime: 0`, so the
  animation-restart question CANNOT be settled by sampling it there -- that
  reading was flat 0 before and after. Node identity is what settles it.

### The live row's spinner sat in a box, off-centre

"this rounding circle is not centered. Remove that background box because we
don't need it, and just leave the rotating circle."

- The tile's border and warm ground come off behind a spinner; the 32px WIDTH
  stays, so nothing beside it shifts when a job stops spinning, and the glyph
  grows into the room the border gave up.
- **The size needed `!important`, and only the size.** `iconStyle` writes
  `font-size: 14px` as an INLINE style, which no stylesheet can outrank --
  the third time this file has recorded that trap. Measured mid-fix: border
  and background went transparent while the glyph stayed at 14px. The border
  and background need no help because the binding does not set them. **When a
  CSS override provably does not apply, look for an inline style before
  reaching for `!important` -- and then apply it to that declaration alone.**
- **Centred by geometry against the TITLE, never by a margin.** `--slh-line`
  (20px) is the title's line box AND the spinner's height, and the boxed
  tile's `margin-top: 1px` nudge is dropped, so the two start at the same y
  and their centres coincide by construction. Measured **7px out before, 0
  after**.

### The scenery library credits, votes and reviews

"if they add to Deenclipped library, it should give them a couple things on
the clip itself, which say who imported it ... a like and dislike button ...
And then it has to go through, um, like, a review process."

- **Anybody may OFFER a video now; only the operator publishes one outright.**
  A customer's submission is held `pendingShare` and is visible to nobody but
  them and the operator until it has been watched. The checkbox used to be
  operator-only, so this is a new door, and the door has a gate.
- **The content rule is stated BEFORE the upload, not delivered as a refusal
  afterwards**: scenery, or a speaker covered appropriately; no women, no
  music video, nothing immodest.
- **A refusal does not delete the file.** It stays the uploader's own private
  background -- what they had before they offered it. Taking somebody's video
  away because it was not right for everybody would be a punishment for
  offering.
- **Vote TOTALS travel; who cast them never leaves the server.** A library
  where everyone can see who disliked your video is one nobody submits to
  twice. One vote per account, and pressing the same button again clears it --
  without that the only way out of a mis-tap is the opposite opinion.
- Votes are on the SHARED set only: a vote on your own private upload is a
  vote nobody can read. The credit is shown for shared and pending entries
  only -- on a private one it would be your own name on your own video.
- The vote and verdict controls are `role="button"` spans with
  `stopPropagation`, because they sit INSIDE the card's own `<button>`:
  nested buttons are invalid, and without the guard a vote would also select
  that background. Verified by clicking -- the count moved and the selection
  did not.

### Where a lecture posts, chosen on the last step

"attach four icons ... they can deselect or select depending on each video ...
always keep it saved from last goal."

- **Connections is the starting point EVERY time.** `UI.jobPublishTo` is
  cleared in `openJob`, so a per-lecture choice never quietly becomes the new
  default. Verified: turning TikTok off for one lecture, then opening the
  next, re-seeded both.
- **The list may only NARROW, never widen.** `enabledTargetsForClip`
  intersects it with the account's settings, so a destination since
  disconnected -- or one the plan no longer allows -- cannot come back because
  a job recorded it days ago. A test asserts naming a switched-off platform
  reaches nothing.
- **It lives on the PROJECT, not on every clip.** Clips are minted in five
  different places (first render, re-cut, import, variants) and a field that
  must be remembered in five places is one that will be forgotten in one. A
  clip may still carry its own list, which wins.
- A platform that is not connected AND enabled is not offered: a tile that
  cannot post is a dead control (invariant 9). With none, the panel says so
  and the clips are still made and reviewed.
- The test reads the builder's own LOG rather than its target list: the
  fixture holds no credentials, so the list is empty in every case and would
  prove nothing.

### The watermark and the promo bar belong to the ACCOUNT

"it just works with all templates once on it turns on for all ... it doesn't
work by template. It's incorrect."

- **v3.107.0 only half-fixed this and he was right to say so.** That release
  wrote the field to every template in a LOOP, which reached the templates
  that existed at the moment the switch was pressed and left the value stored
  per template. `state.userSettings[uid].brand` holds it now and
  `withAccountEdits` -- the one function every template read already passes
  through -- lays it over each one. Nothing to keep in step, nothing to save,
  and a template added later inherits it.
- **The panel reads the ACCOUNT, not the selected template.** Scripture is
  exempt from both switches, so with the Quran template selected the row read
  "off" for a setting that is on everywhere else -- a control that looks
  broken and is not. It says so in a line on that template instead.
- **The paywall is the SAME function**, `assertWatermarkAllowed`, called from
  the new `/api/brand` route: one gate, so removing the mark cannot become
  free by arriving through a second door. There is no templateId on that
  route, and `''` never matches a scripture template, so the exemption cannot
  be claimed from it.
- `BRAND_FIELDS` is the whole list and a test pins it: a field that reached
  this setter without being in it would be a template edit wearing a brand
  switch's clothes -- applied account-wide, with no version bump and no save.
- **Measured live**: one write, four templates changed, Quran untouched, and
  no template saved.

### The promo bar eases now, and its duration is the account's

- Cubic ease-OUT in, cubic ease-IN out, over 58px, and the alpha fades are
  deliberately SHORTER than the travel so the bar is still visibly moving once
  it is fully opaque. The first version ramped position linearly, which is the
  motion of something dragged rather than something arriving. Measured on a
  real render: entry tops at 1663 -> 1622 -> 1610 (decelerating), exit holds
  1612 at t=7.70 and falls to 1657 at t=7.90.
- Duration chips (2-8s) appear only once the bar is on, and the sentence says
  what happens: "It slides in after the first 3 seconds, stays for N seconds,
  then slides away. Every clip, every template."
- **The chips are rewired on EVERY paint**, not guarded by `dataset.wired`:
  they are rebuilt by the innerHTML above them, so a wired flag would leave
  the new buttons dead. The switch above them survives and can carry one.

## Remove takes a clip off the schedule; it does not un-review it (v3.114.0)

Youssef, 3 Sept 2026, pointing at the Day view's one round button: "make this
button a remove and it removes also add that to the weekly so you can remove
the clips you want to."

- **It used to be Send back to review**, which calls `pullBack` -- status
  `waiting`, approval nulled, targets cleared. So tidying one day's schedule
  cost a re-review of everything you tidied. The approval is a decision a
  person made; taking a clip off Tuesday is not a retraction of it. The new
  `agent.unschedule` keeps `approvedAt`/`approvedBy`, clears the slot and the
  targets, and leaves the clip in the pool the schedule picker already reads
  (`approved` + no `scheduledAt` + not posted = "Ready to schedule").
- **`scheduleHold` is the load-bearing half.** `tick()` schedules EVERY
  approved clip that has no slot, so without it the next sweep -- ten minutes
  at most -- hands the clip a fresh time and Remove reads as a button that
  does nothing. `scheduleApprovedClip` spends the hold, because reaching it at
  all means somebody asked for this clip to be scheduled; tick() skips held
  clips before it calls in. The test drives the real sweep rather than reading
  the flag, and was proven red against the guard's removal.
- `pullBack` is untouched and still un-approves. If Remove ever quietly
  becomes an alias for it, curating a schedule starts costing a re-review per
  clip again -- a test asserts the two do different things.
- **Its own route** (`POST /api/clips/:id/unschedule`) rather than a PATCH
  status, because the clip's status does not change: it stays approved and
  simply loses its slot.
- The toast says "Removed from the schedule -- still approved". "Removed"
  alone reads as the clip having been destroyed.

### The week cell is a `<button>`, so its Remove cannot be one

- A nested button is invalid markup and swallows the outer click, so the
  week's control is a host-rendered `role="button"` span injected beside the
  drag grip -- the device `.bgt-del` and the scenery votes already use. It
  costs no design re-import and a re-import cannot renumber it away.
- **It stops `pointerdown` as well as `click`.** The drag starts on
  pointerdown at the grid, so without that guard pressing the x picks the clip
  up instead of removing it.
- **The Day card is skipped**, because the export already gives it a Remove.
  Two remove controls on one card is worse than none.
- Grip top right, x bottom right: measured 129px apart in a 103x172 cell, no
  overlap, both inside it. Hidden until hover, with `:focus-visible` for the
  keyboard and `@media (hover: none)` for a phone, where a control that can
  only be reached by hovering is no control at all.

### Removing needs a CLIP; dragging also needs a SLOT

The first cut tied the x to the grip's own condition (a clip AND a future
slot instant) and that was wrong in a way only the week view shows. A clip on
a time the account no longer posts at lands in the week's **"Other"** row,
whose cells carry no `at` -- and that is precisely the clip somebody wants to
take off the schedule. It had no control of any kind. The Other row now
carries `clipId` (still no `at`: there is nothing to drop onto), and the two
conditions are separate. Anything genuinely un-removable -- posted,
mid-transfer -- is refused by the server, which says why.

### Driven, not assumed

Day card: label "Remove from the schedule", `ph-x`, one click -> `approved`,
no slot, approval intact, card count 2 -> 1, and the clip appears as "1 clip
approved, no slot yet". Week: both a windowed cell and an Other-row stray
removed by their own x, the view staying on week (the x did not trigger the
cell's own click). Drag re-checked afterwards and still moves a clip between
slots, with the ghost carrying neither control and zero ghosts left behind.

**A synthetic `pointerup` on `document` does NOT end a drag**, and the
leftover ghost that produces looks exactly like a cleanup bug. Real drags use
`setPointerCapture`, so every pointer event including the up is delivered to
the source cell and bubbles to the grid. Dispatch on the cell.

**The export edit was proven byte-stable first** (CSS identical, no hashed
class name moved), the route this repo established for `data-dc-week`.

## Three channels, three schedules (v3.115.0, 3 Sept 2026)

Youssef, 3 Sept 2026: "you know how you can connect on a studio membership ...
you can connect to the accounts. The only problem is that with the three
accounts, there should be three different schedules ... you should auto detect.
If it has two accounts, it should show [two] different schedules that you can
switch between ... How will it work with three different accounts? I want you
to have all the freedom. Just make it look very nice, not too clustered and
crazy and confusing."

Multi-channel shipped in v3.41.0-v3.56.0 and the SCHEDULE never learned about
it. Two things were wrong underneath, and the switcher he asked for is the
third.

### Slots were claimed account-wide, so a third channel bought nothing

`scheduleApprovedClip`'s `taken` was every `scheduledAt` the account held, so
three connected channels competed for ONE set of eight daily windows. A Studio
customer paying for three channels got eight posts a day *between* them --
the opposite of what the third channel is for. Slots are claimed **per
channel** now: two clips may share 12:00 when they go to different channels,
and may not when they go to the same one. Eight windows each, not eight
shared.

- The lane key is `provider:accountId`, which is exactly the id a target
  already carried (`social.js`) -- no new identity, nothing to keep in step.
- `laneKeysForClip` answers "where would this clip go" WITHOUT building
  targets, because the scheduler needs the answer before it has picked a time
  and building them wrote every "no account selected" warning twice per clip
  per sweep. That is what `enabledTargetsForClip(clip, { quiet: true })` is
  for; a test asserts the quiet path logs nothing and the loud one still does.
- **A clip going nowhere keeps the old account-wide behaviour.** Publishing
  off, or a local export: it has no lane to be alone in, and letting it stack
  on everything would put two exports on one slot.

### Every clip went everywhere, which is your own channels competing

`spread` is a per-account setting with two values. `all` (the default, and
what every record written before this holds) posts each clip to every
connected channel. `rotate` gives each clip to ONE of them in turn, so three
channels carry three different clips.

- **It rotates WITHIN a platform, never across them.** A clip still reaches
  YouTube and TikTok both; rotating across platforms would mean a clip landing
  on one network and not the other, which is not what "share the clips out"
  means.
- **The index is the clip's own position in its lecture**, so asking twice
  gives the same answer. This function runs at schedule time and again when
  targets are rebuilt, and a rotation that drifted between the two would move
  a clip to a different channel after it had been scheduled for the first.
- One channel on a platform is unaffected either way, so switching the mode on
  before connecting a second channel changes nothing.
- The default is deliberately unchanged. Turning three channels into three
  different schedules is a decision the account makes, not one a release makes
  for it.

### The switcher, and what it had to be told

- **Derived, never stored**: a channel disconnected yesterday leaves no lane
  behind and one connected this morning needs no migration to appear.
- **Drawn only at two or more** -- his "auto detect". One channel sees exactly
  the screen it saw before, and the row appears by itself when a second is
  connected. Nothing to find, nothing to turn on.
- **Each chip carries its count**, so the row says which channel needs
  attention rather than only which channels exist. Day, week and month all
  filter through the one `scheduled` list, so they cannot disagree.
- **`targetPublic` now sends the target's `id`.** It did not, and the browser
  cannot filter a lane without it -- deriving it there instead would be two
  places building one key, the shape that once put one clip's waveform on
  another clip's card. The client still falls back to `provider:accountId` so
  a browser holding an older payload filters correctly rather than showing
  every lane empty.
- **Three chips reading "YouTube" would be a switcher you cannot use.** A
  connection can come back with an empty name, so the fallback chain is the
  connection's name, then the name a target recorded when it was built, then
  the platform plus a short id -- it distinguishes rather than defaults.
- **Two rows on purpose, not by wrapping.** Measured at 1440: the chips and
  the mode pair come to 958px in an 814px column. A wrapped row looks like a
  mistake where a designed one looks deliberate, and the second row earns its
  place by SAYING what the mode does -- "Each clip goes to one channel, so
  your 3 channels carry different clips" -- which is the question three
  channels raise, answered next to the control that changes the answer.

### The consequence that would have hidden clips

Per-lane slots mean two clips can legitimately sit on one instant, and a week
cell can only draw one of them. Drawing one while silently hiding the other is
how a schedule starts lying about what is going out. The cell carries a
**"+N"** badge (bottom left, clear of the grip and the remove x), and the count
is zero inside a single lane by construction. Found by measuring the week after
the engine change, not by looking at it.

### Deliberately NOT built, and why

**Per-channel posting TIMES.** Each lane could have its own clock as well as
its own clips, but that is a configuration screen per channel for a modest
gain, and he asked for this not to be cluttered. The lanes differ by CONTENT,
at the account's own windows. Say so rather than letting anyone assume
otherwise.

### The fixture trap

`accountsPerPlatform` truncates to ONE for anybody below Studio, so a test
fixture without a plan sees a single channel and every lane assertion fails
against correct code. The operator counts as Studio (`atLeast`, not
`paysForAtLeast`), so `role: 'owner'` on the seeded user is the cheapest way
to say it.

## "Everything's posting together, and I don't know" (v3.116.0, 3 Sept 2026)

Youssef, minutes after the multi-channel schedule shipped: "for the scheduling
and everything, it's very confusing. Like, everything's posting together, and
I don't know. It's just confusing."

His sentence names the fault exactly, and it was mine from two releases back.

- **A card did not say WHICH channel.** v3.107.0 made the destination a bare
  platform logo -- "dont be writing just put logos that are posting" -- which
  was right while a platform meant one channel and is actively wrong once it
  means three. Two clips at 07:00 drew two identical YouTube logos. They were
  going to different channels and nothing on screen said so, which is
  precisely "everything's posting together". The channel's name now appears
  beside the logo, and ONLY where there is more than one channel on that
  platform: with one, the logo still stands alone exactly as he asked. A
  failure still gets its word either way.
- **`destinations` is a MODULE-LEVEL helper, so `DATA` is not in scope there.**
  Reading it would have been undefined and the name would simply never have
  appeared. `LAST_DATA` is assigned on `bindings()`'s first line and is the
  current payload by the time this runs.

### Three numbers on one screen disagreed

The day view said **"3 of 4 scheduled"** while the header said "Up to 8 posts
a day" and the sidebar said "0 of 8 scheduled today". The 4 was a literal that
v3.71.3 missed when it fixed the other three -- and `schedDayCanAdd` carried
the same 4, so the Add button was gated on a number nothing else used.

With several channels there is no single total to be "of": the day holds the
account's windows on EACH of them. So the day states its count, the header
says "Up to 8 posts a day on each of your 3 channels", and the sidebar says
"up to 8 on each of your 3 channels". A single-channel account keeps the plain
"N of 8" wording it always had, and a test pins that -- this must not become
per-channel language for somebody who has one.

### The chips counted all time while the day counted one day

Two 3s on one screen meaning different things. The lane counts are computed
over the RANGE ON SCREEN now (day / week / the month grid), so "Main channel
2" and the two rows under it are the same two clips. Measured with a clip a
fortnight out: 3 in day and week, 4 in month.

**They are computed low in `bindings()`, not beside `schedLanes`**, because
`schedView`, `weekStart` and `gridStart` are all declared further down and
reading them earlier gives undefined.

### The lesson worth keeping

**A logo is a name only while there is one of the thing.** This is the second
time a "say less" instruction has been taken past the point where it still
identified anything -- the first was `targets[0]` standing for every
destination (v3.28.0). When a row can now repeat, check that whatever
identifies it still distinguishes it.

## A Quran clip always opens on an ayah, and its edges stopped racing (v3.118.1, 3 Sept 2026)

Youssef, on the sync that shipped in v3.102.0: "quran recitation sync is GREAT
but the start and end, it's like it's finding the aya, so what happens is it
goes through QUICKLY to find where the reciter is speaking" -- then, minutes
later: "best way of fixing ALWAYS find ayas when the clipper finds only for
quran recitation ALWAYS FIND THE START of a AYA."

**MEASURED BEFORE ANYTHING WAS DESIGNED**, driving the real `attach_lecture_ayat`
and `ayah_events` over a twenty-second verse of twelve words, paged four at a
time:

| where the clip cuts | verse inside it | pages drawn |
|---|---|---|
| opens AT the verse start | 20.0s | 6.67 / 6.66 / 6.67s |
| opens with 3s of it left | 3.0s | 1.33 / 0.67 / 1.00s |
| opens with 1s of it left | 1.0s | **0.33 / 0.34 / 0.33s** |
| ENDS 1s into a verse | 1.0s | **0.33 / 0.34 / 0.33s** |

A third of a second a page, each with a fade in and a fade out. That is "goes
through QUICKLY", exactly, and it is two faults compounding.

### The pager was given the whole verse and only the words that survived the cut

`attach_lecture_ayat` clamps a straddling verse to the clip and drops the
transcript words recited outside it -- but it passed only the SURVIVORS on,
with no word of how many there had been or where they sat. So `ayah_events`
spread the full twelve-word Uthmani text across whatever time was left.

It now carries `wordFrom` and `wordCount`, and the pager draws only the pages
whose words were actually recited inside this clip. Measured after: the two
racing cases become ONE page at its real length, and a whole verse is
byte-identical to before.

- **Which page survives is why the OFFSET matters, not just the count.** A clip
  opening one second before a verse ends is hearing its LAST four words.
  Knowing only that one transcript word survived draws the middle page -- the
  wrong words, confidently. The first probe here did exactly that.
- **The verse mark closes a verse.** A clip ending part way through one has not
  reached its end, so no ornament is drawn. `complete` is the flag, and a page
  that is drawn without its mark is the honest picture.
- **The fade is computed over the LIVE pages**, not every page the verse has,
  or a lone surviving page holding the whole window would be given a third of
  the fade it has room for.
- **A transcript with no word times at all takes the path it always did** -- an
  older transcript, or a re-render: every page drawn, the ruler sharing the
  time out. `word_offset`/`word_count` default to zero and the whole-verse case
  is unchanged.
- The translation is still shared out over EVERY page and only the live ones
  are drawn, so a whole verse splits exactly as it always did and the gloss of
  a stretch nobody recited here is dropped with the Arabic it belongs to.

### The snap gave up on precisely the clips that raced

`snap_clips_to_ayat` looked for an ayah start within `AYAH_SNAP_TOLERANCE`
(12s) and abandoned the whole snap -- start AND end -- whenever the pair broke
the duration band. A clip opening seventeen seconds into a twenty-second verse
is beyond that tolerance, so it was left where it was, which is what handed the
pager a verse it had only the tail of. The two faults were one fault.

- **The reach is the VERSE, not a number.** The start is now the beginning of
  the verse being recited AT the cut, however long that verse is -- bounded by
  the verse's own length, which is the honest bound. The tolerance survives for
  the one case it was right for: a cut landing in a GAP between verses, where
  there is no verse to return to.
- **Nearest wins, forward or back.** A clip opening one second before a verse
  ends belongs at the NEXT verse's start, a second away, not nineteen seconds
  back at the start of the one it is leaving -- that would throw away most of
  the moment the scorer chose. Both options are offered, nearest first, so a
  refusal of the nearer one still lands on an ayah.
- **The start is fixed and the END gives way.** The end is chosen to fit around
  it: the ayah end nearest the scorer's own ending that lands inside the band,
  and where none fits, a plain cut clamped into it.
- **One thing "always" does not override**: a snap keeping less than `minimum`
  of the scorer's own window is still declined. A clip in the wrong place is
  worse than one starting mid-verse.

### Two of the six red probes came back GREEN, and that is the entry worth reading

- The ornament probe passed because the case it was tested on never drew the
  last page at all -- the mark was absent for a different reason. The test now
  ends the clip after the verse's TENTH word of twelve, so the last page IS
  drawn and carries no mark.
- The opening-verse-reach probe passed because the fixture was four twenty-
  second verses, and from anywhere inside one of those the tolerance can always
  reach a neighbour. The reach only makes a difference inside a verse longer
  than TWICE the tolerance, so the fixture gained a forty-five-second verse --
  which is not exotic: a slow recitation of an ordinary ayah passes 24s easily.
- A third probe was simply badly chosen (it added a clause `pick_end` already
  made unreachable) and was replaced by one that restores the OLD `pick_end`
  wholesale. All six are red now.

### What this does NOT reach

**New imports only, for the sync half.** A re-render captions the STORED
transcript and does not re-transcribe, so a lecture transcribed before v3.102.0
carries no per-word times and the pager falls back to the ruler however many
times it is run -- the note under *The sync on an OLD clip cannot be fixed by
re-rendering it* still stands. The SNAP is a selection-time decision and
likewise applies to lectures clipped from now on. Neither has been seen on a
real frame yet; the proof here is the ASS event times and the candidate the
render is handed.

### It was proven on FRAMES, not only on event times

libass and Amiri were both on the agent container, so the argument did not have
to stop at the ASS file. The code that SHIPPED and the code in this release
were loaded side by side (`git show <sha>:worker/clip_worker.py` into a second
module -- the Verification standard records the trap that makes that necessary)
and each asked for the same clip; five frames were then rendered across the
same one second at 1080x1920 over the studio's own ground.

    before   three different pages of the ayah, two of them mid-fade
    after    ONE page -- the words actually being recited -- held for the
             whole second, carrying the verse mark

Rendered in real **Amiri**, medallion and tashkeel and all; no substitution.
The events behind those frames:

    before   0.00-0.33  وسيق الذين كفروا إلى
             0.33-0.67  جهنم زمرا حتى إذا
             0.67-1.00  جاءوها فتحت أبوابها وقال ۝٧١
    after    0.00-1.00  جاءوها فتحت أبوابها وقال ۝٧١

That is still not a frame from the BOX, and the honest limit stated above
stands: one Quran import settles it there.

**Worker change, so `deploy-worker.yml` deploys it on push.**

## Twelve looks and weather over the picture (v3.118.0, 4 Sept 2026)

Youssef: "add more configuration make it match and looks super clean things
like on looks of the upload like black and white or idk just more so they can
easily just config beofre posring on the selector so give ideas also add
another thing so they can add sencery or layover, so layour can be dark with
rain drops but still the video of couese."

### Where it lives, and why only there

Three new rows in **Templates → Style**, in the same picker shape as the four
already there -- measured after: ONE left edge (285), ONE row height (38), ONE
right edge (560), and 0px between every icon's centre and its value's centre
across all nine rows. That is what "make it match" is: the rows are the
export's own template, so they inherit the alignment rather than re-deriving it.

**Deliberately NOT also in the job wizard.** The wizard already picks the
template, and putting look and weather there as well is two controls for one
setting -- the fault this file has now recorded three times (two onboarding
systems, two watermark positions, two tour buttons). The template is chosen
before posting, so the configuration is reached before posting.

### The looks: five became twelve, and every one was rendered

`LOOKS` in clip_worker.py is one table of (eq tuple, extra filters). The five
that existed are byte-identical -- a saved template cannot start grading
differently after a deploy, and a test pins each one.

**Two of the first draft were rebuilt because the FRAME said so, not the
numbers.** "Teal" was indistinguishable from "cinematic" on a real lecture
still while looking perfectly different in the code, and "night" did not read
as night at all. Both were re-tuned against the picture. A look that cannot be
told from the one above it in the list is a menu entry, not a feature.

- **Three are black and white on purpose** -- he asked for "black and white",
  and flat (monochrome), hard (noir) and soft-with-lifted-blacks (silver) are
  three different pictures. The row names which is which, or they read as the
  same entry three times.
- **Sepia's brightness is pulled back.** The standard sepia matrix brightens as
  well as tints and the first frame came out blown.
- **A colour matrix goes straight after the eq**, before the sharpen and the
  grain -- applied later it tints the texture as well as the picture.
- The library thumbnail keyed on `monochrome` alone, so noir and silver drew in
  colour on the one screen that exists to show what a template looks like.

### The atmosphere: generated, never shipped as artwork

Rain, snow, dust and bokeh. **There is no asset file**, so nothing can be
missing on a box that has not pulled one -- unlike the promo bar, which is
inert without its PNG. Four effects out of one parameterised generator.

- **A deterministic hash, not `random()`.** ffmpeg's `random()` re-rolls per
  evaluation, so a field built from it FLICKERS instead of falling. Coherent
  motion means a static field that is scrolled.
- **The field is THREE PERIODS TALL with the hash taken modulo one period**, and
  the window scrolls over the middle band -- the only part whose vertical blur
  has real neighbours above and below AND which wraps exactly. Measured: the
  frame-to-frame difference across a wrap is **2.50 against 2.52 mid-cycle**. A
  truncated seam spikes; this does not.
- **Everything before `loop` is paid for ONCE.** The source is a single frame,
  so the hash, the streak blur, the softening and the gain cost one frame
  however long the clip is. That is what makes a real Gaussian affordable, and
  a test asserts the ordering -- moved below `loop` it would run per frame on
  every clip of every lecture.

**Three things were got wrong first, each found by looking at a frame:**

1. **`blend=all_mode=screen` turns the whole frame MAGENTA.** It is the obvious
   compositor for light particles and it operates PER PLANE: screening a
   neutral chroma plane (128) against anything pushes it towards 255. Alpha
   compositing -- what the promo bar already uses -- is correct.
2. **The particle colour must be a CONSTANT with the field as its ALPHA.** The
   first version tinted the field by its own value, so a faint particle was
   dark grey -- and compositing dark grey over a bright wall DARKENS it.
   Rendered on a lecture in a white-walled masjid, "rain" read as dirt on the
   lens. This is the single most important line in the chain.
3. **A box blur makes squares and a Gaussian makes glints.** Bokeh generated
   small and blurred up came out as hard squares; it is generated coarser, with
   `gblur` BEFORE the gain (after it, the blur divides the peak away and the
   particles vanish).

**Cropping a chroma-subsampled stream at a moving odd offset forces
resampling.** Moving the tint above `loop` looked like a free optimisation and
made every effect two to three times SLOWER, because the crop then ran on
yuva420p instead of gray8. Measured, not reasoned about.

### The two halves are separate rows because they are separate decisions

`overlayDarken` dims the picture; `overlayEffect` puts particles over it. "Dark
with rain" is both; either alone is a real choice, and dimming a bright frame
so the captions read is worth doing with no weather at all.

- **Darken stops at 80, and the ceiling is enforced in the RENDERER as well as
  the schema** -- a payload is a dict off the wire, and at 1.0 drawbox paints an
  opaque black rectangle with the captions floating on it. "But still the video
  of course." The test found that gap: the schema clamped and the worker did not.
- **Both go on BEFORE the captions.** Dimming a frame so the words read must not
  dim the words, and rain in front of a caption is rain on a caption nobody can
  read.
- Intensity floors at 10 rather than 0: an effect switched on and drawing
  nothing is a control that does nothing, and `none` is how it is turned off.

### What it costs, said out loud

**Roughly two to three times the video-filter stage** of a render (measured on
30s: 4.2s plain, 12.8s rain, 9.4s snow, 8.9s dust, 7.0s bokeh). Rain is the
dearest because it needs the finer generator -- at half that resolution the
drops come out fat and read as smears, checked side by side. It is OFF by
default and the help article states the cost rather than letting somebody
discover it as a slow queue.

`format=yuv420` on the overlay rather than `auto`: measured a third faster.

### The preview is honest about which half it is guessing

The scrim is EXACT -- the same arithmetic drawbox does. The weather is a static
CSS field carrying the effect's real colour, size and density, and the help
article says the falling is in the export. Animating a lookalike here would be
the second rendering engine invariant 4 exists to prevent.

**A `var()` in an SVG presentation attribute does not resolve** and **every
background layer must state its own size and position**, or the browser cycles
the shorter list and the grain's 3px tile lands on the raindrops. A test counts
them, splitting at the top level only -- these gradients are full of nested
commas and a naive split on `"), "` miscounts.

### Left undone, deliberately

- **The Styles help screenshot predates these rows.** The article for them
  ships with no image rather than pointing at a capture that does not show what
  it describes; recapture `templates.webp` with the rest next time the capture
  script runs, and give the article an image then.
- **Not yet seen on a clip from the real box.** Every frame here came from the
  real `build_video_filter` through ffmpeg on this machine, and the local build
  has no libass -- so the caption stage was swapped for `null` in the probe and
  everything else is exactly the graph the renderer produces. Worker change, so
  `deploy-worker.yml` ships it on push; one Quran or lecture import with rain
  on settles it.

## The banner told everyone one nasheed stopped their posting (v3.119.0, 4 Sept 2026)

Youssef, reading a handover line that repeated it back at him: "it shouldnt? it
should just be that its there to notify?"

He was right, and **nothing in the code had ever agreed with the banner.** The
sentence was *"Only one nasheed uploaded — rotation needs two or more before
automatic posting can run."* Checked against the three places that would have
to implement it:

- `local-engine.js` refuses a job only with NO track ("Upload at least one
  nasheed first"), never with one;
- `readiness()` answers `musicReady: tracks.length > 0`;
- **`agent.js` -- the scheduler and the publisher -- never reads the track
  count at all**, so posting cannot depend on it by construction.

So the app's loudest slot described a limitation that does not exist.

### The masking was worse than the wording

It sat INSIDE the `else if` chain, ABOVE the connection check:

    moneyNotice -> tracks.length === 0 -> tracks.length < 2 -> connectedCount === 0

An account with one nasheed and nothing connected therefore hit the third
branch and was told to upload a second nasheed -- and **never shown "No
publishing account connected"**, which is the true and actionable one. That is
exactly the state Youssef spent days in while fighting TikTok. A false alarm
that MASKS a real one is the expensive shape here, and the test pins that case
hardest.

### What it is now

- **The blocker chain is money -> no nasheed -> no connection**, and the
  one-nasheed case is computed AFTER it, so it can never mask anything again.
- **It is a NOTE**: "Only one nasheed — every clip mixes in the same one. Add
  another and they rotate." True, worth saying, and not a reason to stop.
- **The same banner element carries both**, so this cost no design re-import:
  `#dcBlocker` has an id, the host stamps `data-tone`, and CSS quiets the
  ground, the ink and the primary button. Measured on the real markup with the
  real stylesheet: gold wash + gold ink + gold button for a stop, transparent +
  secondary ink + outline button for a note.
- **`blockersOn` and `blockerShowing` are deliberately no longer one value.**
  The banner renders from `bannerShowing` (a row is up, of either kind); the
  onboarding strip's deferral reads `blockerShowing = bannerShowing &&
  Boolean(blocker)` -- a real STOP. Deferring to a note would silently drop a
  step's button for information nobody has to act on. The strip's flag is still
  DERIVED from the banner's, so the two cannot disagree about a dismissal.
- **The dismissal key had to move with it.** It is compared against
  `bannerText` and was being WRITTEN as `blocker`, which is empty for a note --
  so a dismissed note came straight back on the next paint. Found by reading
  the two sides against each other, not by using it.
- **`blockerIcon` is one source for the mark** (warning diamond vs
  `ph-music-notes`, a glyph already rendering in the live app). The phone binds
  it through `phb()`; the desktop's is a literal in the export, so the host
  swaps only the GLYPH tokens and leaves the hashed sizing class alone --
  replacing className drew the mark at the body's font size.

### The token trap caught this change, and it was my own two lines

The phone rules were written against `--dcm-ink-2` and `--dcm-ink-3`. The
declared tokens are **`--dcm-ink2` / `--dcm-ink3`**, no hyphen before the
digit; the hyphenated pair is declared nowhere in the repo. A `var()` naming a
token that does not exist fails SILENTLY, and this one would only ever have
been seen by an account holding exactly one nasheed. `test/nasheed-note.test.mjs`
now walks every `var()` inside the new rules against the declarations in the
same file, on both surfaces.

### A source-string test failed against correct code, for the FIFTH time

`onboarding.test.mjs` asserted the literal `blockersOn: blockerShowing` to mean
"the banner and the strip read one answer". Those are deliberately no longer
the same value, so it went red while proving nothing about behaviour. The
property it was protecting -- defer to a stop, never to a note, and hand the
button back on dismissal -- is DRIVEN now in `test/nasheed-note.test.mjs`
against the real bindings; the older file keeps one narrow pin that the strip's
flag is derived from the banner's rather than computed twice.

**A trap inside that test, worth writing down:** the onboarding binding's
`action` on the OUTPUT is the click HANDLER, not the step name. `actionLabel`
is the string the deferral empties, and asserting `action` compared a function
against `'nasheed'` in three tests at once.
### The config panel jumped to the bottom after every change (v3.118.1)

Youssef: "when applying anything on template it all works perfectly it just
then once applyed you get scrolled all the way down? on the side config then
you have to go back up."

**Nothing in this app was moving it**, and that is the whole lesson --
`focus()` and `scrollIntoView()` were both instrumented on the live page and
NEITHER WAS CALLED. It is Chrome's **scroll anchoring**: when content above
the visible area changes, the browser shifts `scrollTop` to keep what you are
looking at still. That is the right instinct for a page where an image loads
in above you, and the wrong one for a studio that repaints its panels through
innerHTML -- the anchor Chrome picked is gone by the time it compensates, so
it runs the column to the end of its range.

- **Measured, from a column at 420 of 1129**: opening the option sheet took it
  to 718 and choosing a value took it to **1129, the very bottom**. With
  `overflow-anchor: none` it stays at 420 through both -- and through every
  other control on the screen: font chips, sliders, the AI toggles and the
  host-rendered watermark switch, all 0px moved.
- **It only reproduces from a SCROLLED column.** From the top it never fires,
  which is why it survived the release that added the new rows -- it was in my
  own screenshots and I read it as the panel simply being long.
- Scoped by TAG (`#studio main > *`, `#studio main section`), never by a class:
  every class in the studio's markup is a hashed name that a design re-import
  regenerates. Both halves are needed and each is silent without the other --
  the screen wrapper scrolls on some screens, the panel inside it on others.
- It only ever disables an OPTIMISATION and cannot change a layout. Checked
  across eight screens afterwards: all render, no horizontal overflow, and
  everything that scrolled still scrolls.
- Pinned as a SOURCE test, deliberately -- CI has no browser and this rule is
  invisible when it is missing: the app renders, the suite stays green, and the
  column just jumps again. The same reason `dc-nav-tail` is pinned that way.

## "How do I know where I'm posting my video?" (v3.119.0, 4 Sept 2026)

Youssef, after multi-channel had been called confusing twice already: "Fix the
studio subscription and how the whole posting to multiple channels cause it's
very confusing it needs a massive rethink." Asked which model he wanted, he
answered the question underneath it: "it's not just scheduling. It's more than
just scheduling ... **how do I know where I'm posting my video?**"

**He could not, and that is the whole finding.** `targets` are only written
when a clip is SCHEDULED, so the review queue -- the one screen where a person
decides whether to publish something -- had nothing to say about the
destination. You approved blind and found out afterwards, on the Schedule.
Three releases of patching the Schedule could never fix that, because the
Schedule is downstream of the decision.

### The answer is computed on the server and rendered, never re-derived

`social.plannedChannelsFor(clip)` says where a clip WILL go once approved, and
every clip carries it as `willPostTo`. Where a clip posts is the product of the
account's channels, its share-out mode, the lecture's own narrowing and the
plan's cap -- four rules deep -- and a second implementation of those in the
browser would drift from the one that actually publishes. The card paints what
it is told, and a test forbids it from mentioning `spread`, `rotate`,
`accountsPerPlatform` or `tiktokConsent`.

- **Consent is ASSUMED in the preview and never in the publish path.**
  Approving is what stamps TikTok consent, so a waiting clip has none --
  answering honestly from the stored value would tell every reviewer their clip
  is not going to TikTok, right up until they approve it and it does.
  `assumeConsent` is preview-only; `enabledTargetsForClip` still refuses
  without real consent, which keeps TikTok's per-post rule intact.
- Host-rendered against `[data-clip]`, which the export already carries for the
  waveform strip -- no re-import, and a re-import cannot renumber it away.

### Sharing out is the DEFAULT now

`spread` defaulted to `'all'`: the same clip on all three channels at the same
minute, your own channels competing with each other. That is the opposite of
what connecting three channels is for, and it is why "three different
schedules" kept not appearing. `'rotate'` is the default (`'all'` stays for
accounts that genuinely want mirroring), and it changes nothing for anyone with
one channel per platform -- the rotation only engages where there is more than
one to rotate between.

Measured on a real Studio account with three YouTube channels and a TikTok:
four waiting clips reading Main / Shorts / Arabic / Main, each plus TikTok.
Rotation is WITHIN a platform, so a clip still reaches every network.

### Studio was being sold as something it does not do

Both labels described the old behaviour. `extraSlots` read as ONE shared
allowance when the windows are per CHANNEL (Youssef's call, 4 Sept: 8 on each),
and `multiChannel` described mirroring -- "send one clip to up to 3 accounts"
-- the mode that is no longer the default. They now read "Post up to 8 times a
day on every channel" and "Run up to 3 channels on each platform, each with its
own schedule."

### The channel chips were counting nothing

`targets` only exist once a clip is placed, so a scheduled-but-unplaced clip
matched no lane: four chips all reading **0** beside "8 posts this day", and
picking any channel showed an empty schedule while the clips were plainly on
screen. `clipLanes()` falls back to `willPostTo`, so committed targets still
win and everything else is counted where it is actually going.

### Traps paid for again

- **`window.DATA` is a DIFFERENT object from the studio's `DATA`.** Measured:
  `window.DATA.clips` empty while the scoped `DATA` held four clips, so every
  card read "Nowhere to post". The painter takes DATA as a parameter. Fifth
  time this file has recorded that scope trap.
- **The painter must cover `#dcMobile` as well as `#studio`.** Scoped to the
  latter it painted only the desktop copy, which `body.dcm-own` hides -- the
  rows measured 0px wide and the phone showed nothing.
- **The CSP inline-script hash is computed at server start**, so editing
  index.html mid-session blocks the whole script and the app renders its shell
  and never boots. Restart the preview server.
- **Three fan-out tests failed on the default change and were CORRECTED, not
  weakened**: they test mirroring, so they now name `spread: 'all'`, and a new
  test pins the new default against a record that never expressed a preference.
- A rotation test flapped because three clips shared one `addedAt` and the
  tie-break is a random id. Order them explicitly.

### Still open, and named rather than assumed

He also said "everything literally has to be three different types". That may
mean per-channel STYLE -- an Arabic channel wanting the Arabic template, a
Shorts channel a different caption mode -- which is a real feature and a
different piece of work. It is not built here and should be confirmed before it
is.
## The walkthrough told you to do things and then prevented them (v3.124.2, 4 Sept 2026)

Youssef, with a screenshot of step 3 -- the card reading "Now give it a
lecture", the paste box ringed in gold behind it: **"see cant do anything here,
like it needs to be better."** He was exactly right, and there were FOUR faults
under it, three of them structural and one of them a bug that had nothing to do
with the walkthrough at all.

### The paste box could not be typed into, walkthrough or no walkthrough

**Measured first, and this is the finding of the session.** With the
walkthrough up: type one character, and `{"value":"h","focused":false}`. With
the walkthrough OFF and no veil anywhere: `{"value":"a","focused":false}`. So it
was never the tour.

`studio-runtime`'s `patch()` pairs a container's LIVE children against the
freshly rendered ones **by index**, skipping anything carrying
`data-host-owned`. `paintFirstRun` injects three nodes into the hero column --
`#dcFirstRunHead`, `#dcFirstRunSteps`, `#dcFirstRunCost` -- and a fourth,
`#dcFirstRunShow`, into the column beside it. **None of them said so.** So the
pairing shifted by three, and every repaint of that column removed indices
5, 6 and 7. Index 5 is the paste row.

    rm DIV.s2g          <- the paste box
    rm P#dcFirstRunCost
    rm DIV.s2n          <- "Posting to"

Traced by wrapping `Node.prototype.removeChild` and reading the stack: three
nested `patch` frames, the `!newNode` branch. `captureFocus`/`restoreFocus`
could not save it -- they walk an index PATH, and the path no longer resolved
while the container was three children short, so `restoreFocus` returned
without ever calling `focus()`.

**Typing was destroyed after the first character and focus fell to `<body>`.
Pasting worked**, because a paste is a single input event that completes the
value before the swap -- which is exactly why this survived unnoticed, on the
one control the walkthrough's import step tells you to use, on the first-run
screen where those three nodes exist.

Four `setAttribute('data-host-owned','')` calls. Measured after: **12 DOM
operations on that column per repaint -> 0**, and a 33-character URL typed one
key at a time lands in the box and keeps focus, with the walkthrough up.

**THE GENERAL RULE, and it is not new -- it is stated at the top of index.html
and was simply not followed here: every node the host puts into the generated
tree must carry `data-host-owned`.** A repaint that changes nothing must touch
nothing; the probe for that is to force `STUDIO.lastHtml = ''` and count DOM
operations through a wrapped `removeChild`/`replaceChild`/`appendChild`.

**Two more injectors are still unmarked and are NOT fixed here**, because both
RESTRUCTURE generated markup rather than adding a sibling, so the marker alone
would duplicate a node: `paintBrandSeal` wraps the rail's arch in a
`span.dc-seal`, and `seatTaskCard` MOVES the rail's footer slot into the nav.
Both churn 8 operations per markup-changing repaint and both self-heal --
measured across six repaints, no node accumulates, no duplicate seal, ring, nav
tail or task card. The visible cost is the seal's 28s rotation restarting.

### The veil blocked every action it asked for

`elementFromPoint` at the centre of the spotlit paste box returned the VEIL:
a full-screen span at z-200 with pointer events, under a spotlight that is
`pointer-events: none`. So "let them do it" could not happen for any step
except the one that opens a dialog.

`clip-path` cuts a REAL hit-testing hole -- a clipped-away region is not
hit-tested. Measured on all seven steps: inside the ring the spotlit control is
what the pointer finds (`INPUT`, `SELECT`, `SPAN`, `BUTTON`), and one pixel
outside it the veil is still topmost, so dismissing still works. The polygon
and the ring take their padding from ONE constant (`SPOT_PAD`), so the hole and
the ring cannot drift apart. **The spotlight's own `0 0 0 9999px` shadow had to
go with it**: left in place it dims the page a second time AND paints straight
back over the hole the veil just opened.

### Every gated step was a wall

A step with a `done` refused to advance until its condition was met. So a new
account could not get past "connect a channel" without connecting one, nor past
the import without a lecture -- **and a lecture takes about twenty minutes, so
the review, schedule and finish steps were UNREACHABLE in a first sitting.**
Pressing the button again did nothing at all: a dead control (invariant 9) on
the screen that exists to teach the product.

The first press still performs the step and waits; **the second is an ordinary
Next.** The card says so while it waits ("Waiting for you. This moves on by
itself the moment it is done, or press Next to carry on"), and moving on clears
the wait, or a condition met later would yank somebody back to a step they
deliberately walked past. A step with no `does` never waits -- there is nothing
for its button to perform.

### One stray click spent it for ever

`tourDismiss` called `endTour()`, which writes the seen key. The veil covers the
whole page and eats any click, so a single slip ended the walkthrough
permanently with no way back except finding it in the account menu -- which is
the shape of "it randomly popped up for a sec then disappeared". Clicking the
dim now PUTS IT AWAY without marking it seen, so it is there again next visit;
the explicit **Skip tour** is a decision and still finishes it for good. (The
per-screen pop-ups that message may also have meant are already gone: v3.124.0
replaced six tours keyed by screen with one keyed once.)

### Two steps pointed at nothing, or at everything

- **The review step's anchor does not exist on the account it is written for.**
  `queue-decide` is the deck's Approve button, and somebody walking this has
  just imported and has no clips -- measured on a fresh account, that step drew
  NO highlight. An anchor may be a LIST now, tried in order. It falls back to
  the queue's tab row. **A comma selector would NOT do this**: `querySelector`
  returns the first match in DOCUMENT order and the tab row is above the deck
  in the markup, so the fallback would always win.
- **The fallback had to be a CONTROL, not the screen.** The container already
  tagged `queue-tabs` measures **1224x847 on a 1440x950 screen** -- 96% of the
  viewport. That is the same fault as step one's `rail` anchor, which measured
  `[0,0,228,950]` and has been dropped: a highlight covering a quarter of the
  screen names nothing. Both new anchors (`queue-tabrow`, `tpl-pick`) were
  added to the export with `npm run design:import` **proven byte-stable first**
  -- generated CSS identical, no hashed class name moved, 56 bytes of template
  delta being exactly the two attributes.
- **The new style step first rang the Save button.** "Choose how the captions
  look" highlighting the control that COMMITS a choice rather than makes one is
  the same fault by another door; `tpl-pick` rings the style picker.

### And the caption style had been dropped from the walkthrough entirely

The per-screen tours this replaced covered Templates; the single walkthrough
did not, so a first run went connect -> nasheed -> import and the captions were
whatever the default happened to be. It sits BEFORE the import deliberately --
the style is applied when the clips are cut, so choosing it afterwards means
re-rendering. It carries no `done`: there is always a default, so nothing here
blocks. Seven steps now, not six.

### Verified by driving it, and the tests drive it too

`test/walkthrough.test.mjs` vm-loads the adapter and CALLS `tourNext`,
`tourDismiss` and `tourSkip` -- the tests that shipped with the walkthrough
assert source strings, and this repo has now been caught five times by one of
those passing against a behaviour that changed underneath it. Eight probes,
all proven red. In the browser at 1440x950, all seven steps: the card inside
the viewport, never overlapping the spotlight, no page overflow, and the
spotlit control hit-testable on every step that has one.

## The preview panel was mounting into a card in the grid (v3.124.4, 4 Sept 2026)

Youssef, with a screenshot of the review queue: **"i opened and closed preview
loook what happened also previews that updaded you did doesnt show? like the
title ai etc"**, then **"the ai button is covering the select button its super
buggy evrerything"**. Three faults; the first two are one bug.

### One selector, and it never once found the preview

    const frame = document.querySelector('#studio [style*="aspect-ratio: 9 / 16"]');
    const card  = frame && frame.parentElement;

**Every clip card's thumbnail carries that inline style** -- it is `thumbStyle`
in the adapter, three separate call sites -- and the player overlay is a
root-level sibling of `<main>`, so with the queue or the library behind the
modal the selector loses on DOCUMENT ORDER every single time.

MEASURED with three clips seeded at 1440x950: the panel mounted into
`ARTICLE[data-clip=c1]`, the FIRST CARD IN THE GRID. So

- **the configuration column has never appeared in the preview** when it was
  opened from the queue or the library -- which is every way anybody opens it;
- and the card it landed in was left wrecked.

**v3.121.0 measured this panel carefully and still shipped it**, because the
harness reused a profile and laid the page out at innerWidth 780 (that release
records the trap) -- below the panel's own 900px seam, where the column stacks
and the wrong mount reads as the design working.

It anchors on `[data-dc-player]` now, added to the player card in the export
with `npm run design:import` **proven byte-stable first**: generated CSS
identical, no hashed class moved, 20 bytes of template delta being the
attribute. Measured after: the panel is a 320x678 column at x=751 beside the
360px frame, gap 22, one left edge, inside the card, no page overflow, in both
themes.

### And closing it left the card that way FOR THE SESSION

`data-host-*` is the one attribute family the patcher never strips -- which is
exactly why it survives a re-render, and why nothing but the host removes it.
The close branch removed the panel NODE and left `data-host-pp` on the card and
two of its children, so the preview's own grid CSS went on laying that card out
for every later paint. Measured after closing: **the card 314px wide against
its siblings' 202px**, and `[data-host-pp]` still stamped on three nodes.

`clearClipToolsAreas()` sweeps `#studio [data-host-pp]` on close. It sweeps the
WHOLE studio rather than a remembered node, deliberately: a card wrecked by an
earlier paint then heals on the next close instead of staying broken until a
reload. Measured after: 0 stamped, every card 202px.

**The existing unmount test could not have caught either half.** It asserts the
closed branch calls `clipToolsNode.remove()`, which it always did. Removing the
node is not the same as undoing what mounting it changed -- anything that
stamps a `data-host-*` attribute owns taking it off again.

### The AI star was sitting exactly on the select control

Measured on a real card: the export's select button is at **top 9, right 9,
22x22**; the star was a **26px box at top 8, right 8**. Bigger, on top, and
`z-index: 3` -- so on a hovered card the tick was completely covered and the
clip could not be selected. It is at `top: 40px` now, clearing the button's
bottom edge (31) by 9px, with nothing else drawn there.

The test pins the RELATIONSHIP rather than the number -- the star's top edge
must clear the control's bottom edge -- so it stays true if the star is
resized. Verified by hit-test: with the pointer on the card, the element at the
centre of the select button IS the button, and the star reports zero overlap
with any absolutely-positioned control on all four cards in both themes.

**Five probes, all proven red**: the loose 9:16 lookup restored, the export
anchor deleted, the sweep neutered, the close branch not sweeping, and the star
back at `top: 8px`.

## The same fault was live in ten more panels (v3.124.5, 4 Sept 2026)

Youssef, after the paste-box fix: **"check the whole dashboard for more bugs
like this."** There were ten, and the sweep that found them is reusable.

### The probe

Force a repaint that changes NOTHING and count what the DOM does:

```js
STUDIO.lastHtml = '';                       // defeat the render's own cache
// wrap Node.prototype.removeChild / replaceChild / appendChild / insertBefore
paintStudio();
```

**Any operation at all is a mispairing.** `patch()` pairs a container's live
children against the freshly rendered ones BY INDEX, skipping only nodes
carrying `data-host-owned`, so an unmarked host node is paired against a
generated sibling: given that sibling's attributes (its id stripped -- only
`data-host*` survives `syncAttributes`), its own children replaced with the
sibling's, and everything AFTER it in the container shifted one place across.

A second probe says what it costs a person: focus a control inside each panel,
force the repaint, read `document.activeElement`.

Measured across every screen, before and after:

| | before | after |
|---|---|---|
| DOM operations on an unchanged repaint | 0-29 per screen | **0** |
| host nodes destroyed by one | up to 14 | **0** |
| focus on the Templates watermark switch, the bell's email switch, a Lecture-library row | fell to `<body>` | **kept** |
| the rail seal's 28s rotation | reset every poll | **runs** |

### What was unmarked

The bell's email-notifications row, Owner's earnings table and First 100
funnel, the Tokens invite panel, the Templates brand switches, the Lecture
library sidebar, the Schedule channel switcher (RETIRED the same day -- see
*Three channels is gone* at the foot of this file), the whole Help screen, the Home
onboarding strip, the clip card's "Posts to" row, the schedule cells' drag grip
/ +N badge / remove control, the buffering overlay and the caption echo's
"approximate" tag. **Four were inserted in the MIDDLE of a generated
container** -- `insertBefore(box, mount.firstElementChild)` on the Templates
column, `insertAdjacentElement('afterend')` in the bell dropdown,
`insertBefore(box, grid.nextSibling)` on Tokens, `insertBefore(box, anchorSec)`
on Owner -- so those shifted every sibling after them, every poll.

### MARKING IS ONLY HALF, and the second half is what a person feels

`data-host-owned` stops the PATCHER. It does nothing about the PAINTER, which
assigned `innerHTML` on every call -- so a panel still rebuilt its own controls
every couple of seconds and focus still fell to `<body>`. `window.dcSetHtml`
writes only when the markup actually changed, and keeps its signature on a **JS
property** rather than an attribute: nothing in the patcher can strip it, and it
dies with the node, which is exactly right -- a node that was rebuilt does need
redrawing.

### Three needed more than a marker

- **The waveform strip is the DESIGN'S own node.** `syncAttributes` rewrites a
  generated node's attributes from the render and removes any the render does
  not carry, so its `data-wave` signature was stripped on every paint and the
  guard **never once matched**: every card's bars were rebuilt on every poll.
  It reads `data-host-wave` now, carries `data-host-style` so the host's inline
  styles survive, and each bar is marked or `patch()` removes it.
- **The library sidebar REMOVED the design's "Before you import" card.** Taking
  a generated node out shortens the live list against the rendered one, so
  everything after it pairs one across -- which is how `#dcLibStats` was handed
  that card's markup and lost its own id, every poll. It self-healed only
  because the mangled panel then matched the "Before you import" text and was
  removed as one. **Hidden in place** (`data-host-style` + `display:none`) now.
- **The rail seal WRAPPED the arch in a span, and the ring therefore never
  turned.** A wrapper around a generated node is one the patcher cannot be told
  to skip: marked, the child it holds is inserted a second time; unmarked --
  what shipped -- it is paired against the arch's own span, given its class and
  then patched, which replaced the arch and deleted the ring. Measured on the
  shipped code, the ring's `currentTime` across four repaints a second apart:
  **0, 0, 0, 0**. After: **4983, 6117, 7250, 8366**. The ring is a host-owned
  SIBLING inside the design's own span; the 42px box and the .86 scale moved to
  that span, addressed through the arch it holds rather than a hashed class.
  Its geometry is unchanged -- proven by pausing the animation at 0 in both
  builds: ring 58x58 at [10,12], text rect 57x57 either way. A `getBoundingClientRect`
  taken mid-rotation reads 79 instead of 64 and looks like a size change; it is
  the bounding box of a rotated square.
- **The task ladder's card MOVED the rail's generated footer div into the nav.**
  Same shape, same result: the nav group's remaining children paired one
  across, a nav link was replaced by the slot and the last one deleted, and the
  card's position was unstable between paints. It has its own host-owned
  `#dcTaskSlot` now and moves nothing; the design's footer div stays empty at
  the rail's foot where `#dcRail > div:empty` has always hidden it.

### The rule, and the test

**Every node the host puts into the generated tree carries `data-host-owned`,
and every host panel is redrawn only when its markup changed.** It is stated at
the top of index.html and was simply not followed; `test/host-panels.test.mjs`
now reads the source for it, as `rail-nav` and the `overflow-anchor` test
already do for the same reason -- CI has no browser, and this is exactly the
rule that is invisible when it goes missing: the app renders, the suite stays
green, the panel just churns again. All six assertions proven red first.

**A hit-test sweep over every screen came back clean** (`elementFromPoint` at
each visible control's centre is that control or a descendant), so nothing else
of the "AI star over the select button" shape is live. Two things that sweep
must be told, or it reports faults that are not there: a control scrolled out
of its own overflow container is CLIPPED, not covered, and a modal scrim
covering the page is not a bug -- walk up from the hit element for a
fixed/absolute layer spanning the viewport and skip it when the covered control
sits outside it.

## Two kinds of title, and a star that costs nothing (v3.120.0, 4 Sept 2026)

Youssef: "titling is good, I've realized it's better, it's just not perfectly
the same. For Quran recitations ... maybe try have a search, see how on TikTok
and YouTube they do Quran recitation titles, because titles for those are very
different to just regular lectures. Two different types." And: "there should
be, like, a star ... which will create a different title without rerendering
the video ... no rerendering needs to be done with titlings, of course."

### A lecture title is a promise; a recitation title is a REFERENCE

Researched rather than guessed. Short-form recitation titles are built on the
**surah name and the verse numbers**, because that is what somebody types into
the search box -- "Surah Al-Mulk", "Surah Ar-Rahman", "Surah Yasin" -- where a
lecture clip is found by the hook it promises. Reciter name and a quality word
("heart-touching", "emotional") are the other two conventions in use.

**The whole reason this could be built is that NOTHING IS GENERATED.** The
matcher's own map is already on the candidate (`Candidate.ayat`) and on the
stored clip (`clip.ayahs`), so the surah and the numbers are FACTS. Asking
qwen3:1.7b for them would be asking a 1.7B model to remember scripture, which
is the one thing this product must never do.

    Surah Az-Zumar 71-73
    Surah Al-Ikhlas 1 — Say He is Allah who is One
    Surah An-Naba 31, 33 — Indeed for the righteous is attainment
    Surah An-Naba 40 & Surah An-Naziat 1

- **A GAP IS LISTED, NEVER SMOOTHED.** "31, 33" rather than "31-33": claiming a
  range the clip does not recite is the same fault as inventing a speaker --
  somebody arrives for 78:32 and it is not there.
- **The clause is the verse's OWN translation**, capped so the reference always
  survives. The only hook a recitation title may carry is scripture's own
  meaning, never a model's impression of it.
- **The signal is COVERAGE, not the template.** Scripture is captioned on every
  template (invariant 7), so a khutbah quoting 2:286 in passing would otherwise
  be retitled as a recitation of it. `RECITATION_COVERAGE` is 0.6; below it the
  clip keeps its lecture hook.
- **The reciter is deliberately NOT named**, though it is a real search term:
  the only place it could come from is the lecture title, and putting a name on
  scripture the lecture never claimed is what `strip_unbacked_attribution`
  exists to prevent.
- It wins over the model's line inside `ship_title` -- the one gate every title
  passes -- because the model has neither the surah nor the numbers to work
  from, so its line about a recitation is a guess at what the verses mean.

### The star: a new title, and nothing re-renders

It already cost nothing and this makes it reachable. The title is metadata on
the clip and is never burned into the frame (the hook overlay is hard-disabled,
invariant 9), and `agent.updateClip` writes title/description without touching
`stylePending` -- the flag that marks a render out of date. **A single line
moving that flag onto this path would silently start re-rendering every
retitled clip**, so a test drives it rather than trusting the comment.

- `POST /api/clips/:id/retitle` -> `worker /ai/title`, behind the same HMAC as
  every other worker route, on the box's own Ollama -- the same privacy posture
  the pipeline already makes.
- **A recitation with no instruction never reaches the model.** The route sends
  the clip's stored `ayahs`; the worker imports `clip_worker` and calls
  `recitation_title_from_rows`, so the button and the render cannot disagree
  about the convention. Instant, and it cannot hallucinate.
- **The instruction is free text a customer typed**, so it travels fenced
  between BEGIN/END UNTRUSTED with the defence stated first (invariant 2).
- **`is_english_title` is deliberately NOT applied here.** That rule exists to
  stop the model drifting into Arabic on its own; "make the title Arabic" typed
  into the box is the customer choosing, which is a different thing. The
  automatic titler is unchanged and still English-only.
- Temperature 0.7 rather than the scorer's 0.1: this is writing, and pressing
  the button twice should not return the same line.
- A deployment with no worker refuses in a sentence rather than hanging -- the
  DeenAI precedent.

### The IDOR probe could not go red, first time

`test/clip-retitle.test.mjs` sent NO cookie and asserted a refusal. It passed
with `assertCanAccessClip` REMOVED, because the 401 came from the auth layer
and the route was never reached. It signs up a SECOND account now and asserts
404 -- someone else's clip does not exist to them -- and that probe goes red.

**Two smaller traps:** there is no shared `body` in this router (each route
does its own `await readBody(req)`), and the worker's base URL is
`WORKER_BASE_URL`, not `WORKER_URL` -- the test refused with "this deployment
does not have the clip AI configured" until that was right, which reads exactly
like the guard working.

## The clip preview grew a configuration column (v3.121.0, 4 Sept 2026)

Youssef sent a screenshot of the bare modal -- a title, a 9:16 video and a
scrub bar -- and said: "it should give you buttons on, let's say, on the right
side ... a nice, like, floating new section that has configuration. So you can
use the editor. You can click editor. You can use AI titles ... AI, the
description ... And then it should give you a text box where you can tell the
AI ... make the title Arabic, and it makes the title Arabic, or improve the
title ... no rerendering needs to be done with titlings, of course."

- **The card is never restructured.** Its generated children keep their place
  and are given grid areas through `data-host-pp`, stamped every paint --
  moving a generated node into a wrapper of mine is what would confuse the
  patcher's pairing. `data-host-*` is the one attribute family the patcher
  never strips, so this costs no design re-import and a re-import cannot
  renumber it away. The mount is found by the export's own inline
  `aspect-ratio: 9 / 16`, never by a hashed class.
- **Everything the column writes is METADATA, so nothing re-renders.** Proven
  by driving it rather than by reading: after a title save the server's clip
  carries the new title with `stylePending` null and `renderVersion` unmoved.
  That is Youssef's own condition, and the test asserts the save path is a
  PATCH that mentions no render at all.
- **A typed title saves on BLUR, never per keystroke** -- a PATCH per letter is
  the "waited for the network to look pressed" fault from the other side. Keys
  are stopped inside the panel so the review deck's one-key verbs (A approve,
  X reject) cannot fire while somebody types a title.
- **With no worker the AI refuses in 716ms with a sentence** and re-enables the
  button, rather than hanging -- measured on this dev server, which has none.
- **The AI star on the cards is a shortcut, not a second control.** Injected on
  the article the design already tags with `data-clip` (added for the
  waveform), on the queue, the library and a lecture's detail screen and
  nowhere else. It is a `role="button"` span because a nested `<button>` is
  invalid and swallows the card's own click, and it stops `pointerdown` as well
  as `click` -- the card starts its gestures on pointerdown, so stopping click
  alone still selects the clip underneath. Verified: pressing it does not open
  the preview behind it.

### The measurement was wrong for an hour, and the layout was right all along

**`--window-size` is ignored by headless Chrome when the profile is reused.**
The harness asked for 1440x950 and the page laid out at **innerWidth 780** --
under the panel's own 900px seam AND under studio-responsive.css's 820px phone
seam. So the diagnostic reported one column, `max-width: none` and a stacked
panel, and every explanation for it was wrong: the CSS was correct, the
viewport was not. `Emulation.setDeviceMetricsOverride` is the fix. Anything
measured in an agent browser should print `innerWidth` beside the result.

**The same reused profile kept the THEME**, so a run asking for dark got the
light one: the harness only ever ADDED `dc-light` and never removed it. A
capture that says "dark" in its filename is not evidence it was dark -- read
the body class back.

### Three composition faults, each found by looking rather than by reasoning

1. **An `auto` grid track absorbs the card's free width.** The 360px frame sat
   centred in a 484px column with 84px of dead space beside it. `minmax(0,
   max-content)` plus `width: max-content` on the card hugs the picture: cols
   `360px 320px`, gap exactly 22.
2. **Anchoring the last row to the foot moved the void into the MIDDLE**, which
   reads as something missing rather than as a column that ended. The room goes
   to the field that can use it instead -- the description IS the posted
   caption and runs to 2200 characters, so `flex: 1` on it is the feature, not
   filler.
3. **A card inside the card broke the one left edge.** The "Ask for a change"
   box inset its own children by 13px; measured lefts 751 / 764 before, one
   value after. It is a hairline now -- the Owner screen's own call.

Measured at 1440x950 after: gap 22, the scrub bar exactly the video's width,
both sparkles 0px off the centre of their label TEXT, the column bottom flush
with the bar, one left edge, 0 elements overflowing and 0 page scroll -- at
1280, 1100 and 940 too, stacked-and-scrolling at 860, 390 and 375.

**`--dc-ink-faint` measured 2.92:1 on paper**, under AA, and it was carrying
the sentence the whole panel rests on ("Changing them never re-renders the
clip"). Dim reads 4.89 light / 5.62 dark. The gold-on-tint buttons sit at
4.35-4.46 in daylight, which is exactly where the task ladder's gold already
lives -- left alone rather than making this one panel differ.

**Run `scripts/build-light-theme.mjs` after adding rules to a hand-written
studio sheet.** It re-emits every rule that sets a colour under `body.dc-light`
and it is NOT run by anything automatic. Doing so here also produced the
daylight twin for two v3.119.0 rules that had shipped without one.

### Two red probes came back GREEN, and both assertions read fine

- The un-tokenised-colour probe passed because the filter excluded any hex
  appearing as a `var()` fallback ANYWHERE in the block, so a bare `#E9E9ED`
  was excused by an unrelated fallback three rules down. Strip each var()'s own
  fallback instead.
- The unmount probe passed because `clipToolsNode.remove()` also appears in the
  RE-MOUNT path, and the slice meant to isolate the closed branch searched for
  `return;` at a guessed indentation -- `indexOf` returned -1, `slice(at, -1)`
  handed back the whole function. Brace-match the branch.

Ten probes, all red now. **The CSP inline-script hash is computed at server
start, so the preview server must be restarted after every index.html edit** --
the app renders its shell and never boots otherwise, with no console error.
Fourth time this file has recorded it.

## DeenAI is one feature at one tier, and it writes your titles (v3.122.0, 4 Sept 2026)

Youssef: "integrate DeenAI to everything. And DeenAI should be for pro users
and up, not to studio ... do AI changes and etcetera, like with the titling
and all that and the description as well."

### The clip AI had NO gate at all

`POST /api/clips/:id/retitle` shipped in v3.120.0 with no plan check on it, so
every free account could spend the box's Ollama -- a paid feature given away,
and an unmetered queue on a single-slot worker. It is `deenai.deenaiAccess`
now, the same gate the insights use, and the star that calls it stands down
for an account that may not press it (invariant 9: a control that always
refuses is worse than no control).

### One tier, so a button cannot sell the wrong plan again

`deenaiAsk` moved from **studio to pro**. The two halves of DeenAI sitting at
two tiers is exactly what let v3.72.10 ship a button telling a free account to
buy Pro for the one half Pro did not include -- the worst copy fault this
product can have.

**The fix is not a corrected word, it is a derived one.** `aiGateCta` reads
`current.locked[...].tierName`, which the server builds from the same FEATURES
table the gates themselves read, so the button and the gate cannot disagree
whatever the table says next. `test/studio-design.test.mjs` asserts the button
against `billing.FEATURES` rather than against the string "Pro", so it stays
true through the next tier change instead of failing and being edited to match
-- which is what a test pinning a word does.

`aiPlanName` is a binding, so the preview panel and the DeenAI screen read ONE
name rather than two that can drift.

### The shapes are the automatic titler's own

Researched first, as asked. OpusClip regenerates a title "in various styles
including interesting, catchy, serious, and question formats", and writes
titles, descriptions and hashtags per platform. What was taken and what was
not:

- **Named shapes: taken**, but the four are `clip_worker`'s OWN ("Four shapes
  that work" in its prompt), so a chip in the studio and a title written during
  a render mean the same thing rather than two vocabularies drifting apart.
  Title: Promise / Question / Subject: payoff / Shorter. Description: Shorter /
  Warmer / + Hashtags.
- **The counted list is deliberately NOT offered.** It is only right when the
  clip genuinely enumerates, and a chip that quietly does something else on
  most clips is worse than no chip. A test pins its absence.
- **Hashtags: taken, as part of the description** rather than a field of their
  own -- they belong in the caption on every platform this app posts to, and a
  new field would mean a data-model change for nothing. The rule carries the
  same register ban the titler has: nothing about scrolling, going viral or
  the algorithm.
- **Per-platform titles: NOT taken.** A clip has one title and one description
  that go to every destination; making them per-platform is a real data-model
  change, and the value is available without it by asking in the free-text box.
  B-roll, stock footage and a virality score were also declined -- this product
  already scores clips and explains itself, which is better than a number.

### `style` and `instruction` are separate, and that is load-bearing

A shape travels as `style`; only text a customer TYPED travels as
`instruction`. The recitation override is `if kind == "title" and rows and not
instruction` -- deliberately not `and not style` -- so **a shape chip on a
recitation still returns the verse reference.** A verse reference is the right
title for a recitation whatever shape is asked for, and pushing scripture
through a 1.7B model to make it punchy is the one thing this product must
never do. "Make the title Arabic" typed by hand is the customer choosing, and
still overrides. Both halves have a test, and the probe that adds `and not
style` goes red.

### Verified

Driven in a browser at 1440x950 in both themes: the chips render and press,
the request goes out as `{kind:'title', instruction:'', style:'question'}`, the
description target swaps to its own three, the star returns for Pro and is
absent for Basic, the lock reads "It is on Pro" with an Unlock button that
lands on Tokens, and the title and description stay hand-editable for a free
account -- the gate is on ASKING DeenAI, not on naming your own clip. 0
overflowing, 0 page scroll.

**All nine probes proven red**, including the two that matter most: the gate
removed from the route, and a shape overriding the recitation reference.

**Worker change, so `deploy-worker.yml` deploys it on push.** The shapes reach
the model only from the box; nothing here has been seen against the real
Ollama yet.

## The star was handing back the title it already had (v3.122.1 / v3.123.2, 4 Sept 2026)

The first thing the new probe below was pointed at, and it found this in one
run. Asked for a title with the clip's current one in the prompt, the box's
qwen3:1.7b answered:

    (no shape)         The door that never closes
    Promise / Warmer   The door that never closes
    Question           The door that never closes
    Subject: payoff    The door that never closes: The promise of turning around
    Shorter            The door that never closes

**Four of five shapes returned the current title word for word** -- a Question
chip returning something that is not a question, a Shorter chip returning the
same length. Youssef asked for "a star ... which will create a DIFFERENT
title", and on the case that actually happens (a clip that already has a
title, which is every clip the star is pressed on) it created no title at all.

- **Nine passing tests could not have caught it, and that is the point.** They
  assert the PROMPT and the prompt was correct: `CLIP_STYLES` says what each
  shape means, the fence is right, the style travels. What no test in this repo
  can see is what a 1.7B model DOES with a correct prompt. Only the real model
  showed it, which is the whole argument for the probe.
- **The shape is restated in the BEFORE-YOU-ANSWER line now.** This file
  already records that the restatement last before the data is the only place
  a rule reliably lands on this model; the shape was named once, higher up, and
  that was not enough.
- **AND the echo is caught in code**, because a 1.7B model does not reliably
  obey a negative instruction -- the oldest lesson here about this model, and
  the same reason `looks_copied` and `strip_unbacked_attribution` exist. An
  answer that normalises equal to the current title is asked ONCE more, with
  the failure named outright; the retry costs a whole generation on a
  single-slot box, so it fires only on an actual echo.
- **`normalise_title` is clip_worker's own**, so "the same title" means here
  exactly what it means to the dedupe pass. "The Door That Never Closes..." is
  the same title. Two definitions of one thing is how every drift in this file
  started.
- **A second echo is reported, never dressed up.** `source: "unchanged"` reaches
  the panel as *"DeenAI kept your title -- it could not better it. Try another
  shape, or ask for a change below."* and the toast says the same. A button that
  quietly returns what was already on screen is a control that does nothing
  (invariant 9), and that is exactly how this presented.
- **A failed retry still reports `unchanged`.** The first answer stands rather
  than failing the request -- but it IS the current title, and `source` reaches
  a customer's screen, so a broad `except` around the block would have it claim
  otherwise. Each failure is handled where it happens for that one reason, and
  a test drives the box going away mid-retry.
- Ten tests on executed output -- the bytes that go to Ollama and the dict that
  comes back, never the source that builds them. All five probes proven red.

**Worker change, so `deploy-worker.yml` ships it on push.** Re-probing after
the deploy is one dispatch.

### And with no current title it did three worse things (v3.123.2)

The same probe, asked with NO current title so the model had to write from the
transcript, and this is the run that matters:

    (no shape)         The door does not close because you walked through it
                       yesterday. He is not waiting for you to run out
    Promise / Warmer   The door does not close because you walked through it
                       yesterday. He is waiting for you to turn around.
    Question           What turns shame into grace
    Subject: payoff    The shape asked for: Sheikh Salman : He is not waiting
                       for you to run out of chances, He is
    Shorter            The door does not close because you walked through it
                       yesterday.

**One good title out of five, and the other four are three separate faults.**

- **IT INVENTED A SCHOLAR.** "Sheikh Salman", on a clip whose lecture title was
  EMPTY -- so the prompt's own rule ("name the speaker ONLY if the lecture
  title names them") was broken outright. `strip_unbacked_attribution` could
  not see it: that guard removes a TRAILING "- Name", and this name sits in the
  middle, behind this prompt's own heading. This is the failure this file calls
  the worst available on the product, and it was live.
- **It copied the transcript**, three shapes out of five. `looks_copied` has
  guarded the AUTOMATIC titler against exactly that since 31 Aug 2026 and was
  never applied to the star -- the same function, one call away, on a route
  written three days later.
- **It leaked this prompt's own furniture into the answer** ("The shape asked
  for:"), which is what carried the invented name.
- **Two titles were cut mid-word** ("...turn arou") by the length limit.

`unusable(value)` is one gate for all of it, applied to the first answer and to
the retry: prompt wording, an echo of the current title, a transcript copy.
Rejected once, the model is asked again WITH THE REASON NAMED; rejected twice,
the current title is kept (`unchanged`) or -- with nothing to keep -- the same
`title_from_text` the render falls back to (`fallback`). Both are said plainly
on screen, because a button that quietly hands back what was already there, or
the clip's own opening sentence, is a control that does nothing.

**THE LEAK GUARD IS NOT A GENERAL NAME GUARD, and the comment says so.** There
is no reliable way to spot an invented name mid-sentence; what is caught is the
shape that actually produced one on the box. Claiming more than that is the
stale-claim failure this file keeps paying for.

**A red probe came back GREEN on the word-boundary test**, for the third time
in this repo's history and for the dullest reason: the fixture was
`"Mercy " * 40`, and 120 divides evenly by `"Mercy "`, so the naive cut landed
on a boundary anyway. The replacement asserts character 120 falls inside a word
before testing anything. The second fixture then tripped the COPY guard,
because it was built out of the transcript. Check that a fixture exercises the
line you think it does.

Fifteen tests on executed output -- the prompt bytes and the returned dict.

### Measured again after the fix, on the same box, same transcript

**The real case -- a clip that already has a title**, which is every clip the
star is pressed on:

| shape | v3.122.0 | v3.123.2 |
|---|---|---|
| (no shape) | "The door that never closes" *claimed as new* | **unchanged**, said so |
| Promise / Warmer | "The door that never closes" *claimed as new* | **unchanged**, said so |
| Question | "The door that never closes" | **"The turning point that doesn't fade"** |
| Subject: payoff | "...: The promise of turning around" | **"The door that never closes: a call to turn around and face the opportunity before it slips away."** |
| Shorter | "The door that never closes" | **unchanged**, said so |

**With no current title**, where it had invented a scholar: nothing invented,
nothing leaked, no transcript copied through. Question wrote *"What does
turning around mean in the context of Allah's mercy?"*; the other four fell
back to `title_from_text` and the screen says so.

**THE LYING IS GONE; THE MODEL'S CEILING IS NOT.** Two shapes of five write a
genuinely different title and three admit they cannot -- which is strictly
better than four of five silently handing back what was already there, and it
is not the feature working well. That ceiling is qwen3:1.7b, and this file
already records what raises it: the CPX41 rescale (open item 5) is what makes
`qwen3:4b` fit under the 2G cap. More prompt work is not the lever.

**"Shorter" returning unchanged on a five-word title is arguably right**, and
worth not mistaking for a fault: there is very little to shorten in "The door
that never closes".

**The retry costs a second generation**, so a rejected first answer roughly
doubles the wait -- 6-8s warm on the box, and the route's own Ollama timeout is
90s per generation. Watch that if the box is ever loaded; it is the reason the
retry fires only on an actual rejection rather than on every ask.


## The box can be ASKED what the model writes (4 Sept 2026)

*No version: this is a workflow, a script and five tests, and nothing in
`src/` or `worker/` changed. Bumping would move the number the worker deploy
compares against the running container for a release that ships no code.*

v3.122.0 shipped five named title shapes proven by unit test, and closed with
a "Needs fixing" line putting the last mile on Youssef: *"The shapes have not
been through the real Ollama -- this dev box has no worker. Press a chip on a
live clip and tell me what it writes."* He pasted that line back, verbatim and
with nothing else, which is the same move as the nasheed-banner exchange -- and
he was right again. **The ask was premature, and checking took two commands.**

- **The code WAS on the box the whole time.** `deploy-worker.yml` run 46 fired
  on the v3.122.0 push (`worker/service.py` changed) and its step 6 read the
  version out of the RUNNING container: *"Deployed and verified: the running
  worker is v3.122.0."* So "this has not reached production" was never true;
  only "nobody has read what it writes" was.
- **And that half was answerable too.** The worker's HTTP port is not routable
  from an agent container (`curl :8080` -> no route) and `WORKER_SHARED_SECRET`
  lives only on the box and on Render -- but the deploy workflow already RUNS
  COMMANDS ON THE BOX over SSH. Anything that can be asked from a shell there
  can be asked from a dispatch. That is the general lesson: **before putting a
  verification on somebody, check whether the route you already built for
  deploying reaches it.**

`.github/scripts/clip-ai-probe.py`, run by `deploy-worker.yml` when dispatched
with `probe: true`. It asks the running worker for a title once per shape --
plus the unshaped baseline, without which a shape that changes nothing looks
like a shape that works -- and prints what qwen3:1.7b writes.

- **It runs INSIDE the container**, where `WORKER_SHARED_SECRET` already is and
  the worker answers on 127.0.0.1. The secret is never written to disk, never
  put on a command line and never crosses the wire; only the model's answer
  comes back into a public run log. A test strips string literals before
  looking for `SECRET` in a print, because NAMING the variable in an error is
  what a good error does and matching the raw line failed on the honest one.
- **No dispatch input is ever interpolated into a shell command.** They are
  read from the environment by node, written into the probe as a JSON literal,
  and carried over as ONE base64 blob -- base64 has no shell metacharacter, so
  an input cannot become a command on the box.
- **It lives in the deploy workflow rather than beside it.** The connection to
  the box is one thing, and a second copy is a second thing to keep in step
  with a credential format that has already been mis-pasted twice. It also
  runs immediately after the version proof, so an answer is one you know the
  version of -- which is the entire point of asking.
- **Dispatch-only and off by default.** It spends the box's single-slot Ollama.
  On a push the `inputs` context is empty, so the deploy path is exactly what
  it was.
- **A DULL TITLE IS NOT A FAILED RUN.** Taste is the finding; the run stays
  green and prints it. Two things DO fail it: the box refusing every call, and
  a shape overriding the recitation reference -- that one is a rule, and this
  is where it is checked against the real service rather than a fixture.
- The five tests pin the drift CI can see: the probe parses, it keeps the
  `PARAMS = {}` seam the workflow substitutes, and its shape lists are exactly
  `CLIP_STYLES` -- a chip added or a style renamed with the probe left asking
  about the old set would report confidently on shapes nobody can send. All
  five proven red.
## One walkthrough, not a tour per tab (v3.124.0, 4 Sept 2026)

Youssef: "the first person user demo ... should be more interactive. It should
go to different tabs alone. Not each tab has a different demo ... the first
thing should realistically be is they should connect themselves to a social
media ... you have to go through them, let them do it. And then once they do
it ... it works with the percentage system as well."

**`TOURS` was a map keyed by SCREEN.** Every tab armed its own tour with its
own `dcTour:<screen>` key, so the product was explained in six unconnected
lectures that each began when you happened to arrive, in whatever order you
wandered -- and nothing ever said what to do FIRST. `TOUR` is one ordered list
now, with one key (`dcTour:walkthrough`); the old per-screen keys and the
oldest `dcTourSeen` still count as seen, so nobody who has already been round
the product is started on a new walkthrough because the storage key moved.

- **Connecting comes first**, and that is the argument for the whole order: a
  clip with nowhere to go is the one thing this product cannot finish, and it
  is the step people skipped. Then the nasheed (nothing finishes without one),
  the lecture, the review, the schedule, and the ladder that carries on
  counting afterwards.
- **It steers the tab itself.** Each step names its screen and the walkthrough
  switches to it -- guarded on `tourNavAt` so it only steers on the paint the
  step CHANGES, or it would drag you back every time you clicked another tab
  while the card was up, which is a walkthrough holding you hostage.
- **An interactive step performs itself and WAITS.** The card's own button
  opens the connections dialog and does NOT advance; `tourAwait` records which
  step is waiting, and the walkthrough moves on when the account's own records
  say it is done. Advancing on the press would be the old behaviour with a
  better label. Driven end to end: press → dialog opens, step holds at 1 →
  channel connected → step 2, and the tab changes to Nasheed by itself.
- **Completion is read from the records, never from which buttons were
  pressed**, so an account that connected a channel last week opens the
  walkthrough with step one already ticked and steps past it.
- **The percentage is SHARED, not recounted.** The card reads `DATA.tasks`,
  the same field the rail ring draws. Two numbers describing one person's
  progress would eventually disagree, and this app has shipped that bug more
  than once. Measured: card and ring both 0%.
- The done-tick goes in the BODY text, because the card's markup is in the
  design export and there is no room for an element of its own -- so this cost
  no re-import.

### The bug that only appeared by driving it

**Step one opened the connections dialog UNDER the tour veil.** `otherLayerOpen`
watched `UI.connProvider`, which is only set when a single platform is being
shown -- so the dialog opened with it null, the veil stayed up, and the card
floated over a dialog nobody could reach. Measured at 1440x950: the dialog
full-viewport and fully dimmed. Two overlays at once is the exact failure the
tour already refused to cause for the job panel; the host-rendered dialog was
simply not on the list. It is read from the DOM (`#studioConn` without `.hide`)
because the dialog keeps its state in a class rather than in UI, and guarded
for the no-document case that every test runs in.

**And a reading trap worth keeping:** the rail ring photographed as "13%" in a
screenshot and the DOM said 0%. The card and the ring agreed all along.
Measure the value, do not read it off a low-contrast capture.

## The audit: thirteen faults found by driving the dashboard (v3.125.0, 4 Sept 2026)

Youssef: "figure out any issues in terms of overlaying buttons, not centerned all
issues in terms of lyaout, bugs not working and more give a list and fix them do
a thorowgh and good job please."

Every one below was MEASURED in a real browser before it was believed and again
after it was fixed, at 1440x950 and a narrower desktop width, in both themes.
Twenty-four probes, each proven able to come back red. **All thirteen are silent
faults**: the app renders, the suite stays green, and the only way to see any of
them is to open the screen or press Tab -- which is exactly the shape this file
has been warning about since August.

### THE HARNESS WAS INVALIDATING ITS OWN MEASUREMENTS, and that is the entry to read

The first alignment sweep came back CLEAN against a page that was deliberately
broken. Two things were wrong with the rig, and both make every icon and text
measurement a fiction:

- **`unpkg.com` is unreachable from an agent container** (000 to curl AND to
  the browser), so the Phosphor `@import` in the generated CSS never loads and
  **every `<i>` measures 0x0**. An icon-vs-text centring sweep over 50 icons
  therefore reports nothing, for ever, whatever the app does.
- **Google Fonts is unreachable to CHROMIUM but NOT to curl.** `curl` gets 200
  through the agent proxy; the browser gets `net::ERR_CONNECTION_RESET`. So a
  "the fonts are fine, I checked" conclusion drawn from curl is wrong.
  **573 of 654 leaf text nodes on the studio ask for Inter**, and Inter measures
  **706px** against the fallback's 640.5px on the same string -- ~10% wider, so
  every overflow and truncation reading taken without it UNDER-reports.

Both are fixed in `scratchpad/audit/harness.mjs` by serving the real files from
disk through a Playwright route: the Google Fonts CSS and its 34 woff2 files,
and the Phosphor package. **`registry.npmjs.org` is in the proxy's `noProxy`
list**, so where unpkg and jsdelivr are blocked the npm tarball comes down
directly -- that is the route to any web font this container needs, and it adds
nothing to the repo (the directory is gitignored).

**A sweep that reports zero has to be shown failing before it is believed.**
Two of the fix probes here came back green the first time -- one because the
edit it made never matched (so it tested unmodified code), one because the
fixture did not exercise the line it named. Print the bytes the edit removed.

### What was wrong, and what each fix was

1. **The lecture detail screen was titled "Studio"** with no subtitle -- the one
   screen in the app that did not say what it was, because `TITLES` had no
   `detail` key and `sublineFor` no `detail` case. It reads **Lecture** now,
   with "5 clips · 2 awaiting review · 2 approved". The lecture's own name is
   already drawn 18px bold in the body directly underneath, so the header names
   the KIND rather than repeating it. A test now walks every screen the adapter
   navigates to and fails on any with no title, so the next one added cannot
   ship nameless.

2. **NOT ONE DIALOG TRAPPED FOCUS, though all four declare `aria-modal="true"`.**
   That attribute is a promise to assistive tech that the rest of the page is
   unreachable. Measured escapes over ~20 Tab presses: Connections **16**,
   Account **14**, Report a bug **6**, Your tasks **4** -- landing on Start job,
   Connect an account and the rail, behind the scrim, invisible. Connections did
   not even move focus into itself: `activeElement` stayed on `<body>`, so the
   first Tab went to the top of the PAGE.
   `window.dcTrapFocus` / `dcReleaseFocus` inert every SIBLING along the
   dialog's own ancestor chain -- never an ancestor, which would inert the
   dialog with it (that mistake made the first red-proof read 19 -> 10 instead
   of 19 -> 0). Measured after: **0 escapes into page content on all four**,
   Escape still closes, focus returns to the opener.
   **`document.body` is not an escape.** Tabbing off the last control goes to
   browser chrome and back in; no trap of any kind can prevent that, and
   counting it made the first measurement unreadable.

3. **Account settings rebuilt its own controls on every state poll.** It ran
   from paintStudio with a bare `innerHTML =`, so a keyboard user was thrown out
   of the open dialog every few seconds -- measured, focus inside before three
   repaints and on `<body>` after, while Connections, Your tasks and Report a
   bug all survived. `window.dcSetHtml` now, the v3.124.5 rule that reached
   every host panel except this one.

4. **The failure guidance stated a prerequisite that does not exist.** The
   nasheed entry said *"Upload two or more before turning on automatic
   posting"* -- the claim v3.119.0 removed from the banner, left standing here,
   in front of somebody whose lecture had just failed. `agent.js` never reads
   the track count (`grep -c tracks` is **0**); it calls `musicSatisfied(clip)`,
   a per-clip render check. The test asserts that count is still zero, so the
   copy cannot go stale silently.

5. **It also sent people to "Platforms", a screen that does not exist.** 163
   control labels were measured across all thirteen studio screens, the account
   menu and the connections dialog: not one carries the word. It lives only in
   the DEAD legacy dashboard. Now "Open Connections from the \"Posting to\" row
   on Home" -- the app's own name for the dialog (its sibling entries already
   used it) PLUS where it opens from, since no rail item carries either word.

6. **A clip card's action row moved when its title wrapped.** Cards sit in a
   grid so every card in a row is stretched to the same height, but nothing
   inside was anchored and the title had no reserved box -- so one two-line
   title dropped that card's Approve / Reject / Edit row and its whole POSTS TO
   block by **18.13px** while its neighbours left the line as dead space at the
   bottom. On the most-used screen in the app, and on the lecture detail too.
   Fixed by GEOMETRY: the title is already `-webkit-line-clamp: 2`, so two lines
   is its maximum; making two lines its minimum gives it a fixed box and
   everything below lands at the same y by construction. `min-height: 2lh` with
   the measured px underneath it for a browser without the unit. Measured after:
   **0.00 on both screens**, no card grew.

7. **An Owner panel in its EMPTY state lost its card.** The card treatment was
   keyed on CONTENT (`:has(> div > table)` / `.dcow-fill`), so a bar list with
   no rows matched neither and rendered bare -- 16px above and 18px left of its
   carded neighbours in the same grid row. On **Traffic, Money in AND Money
   out**, which is the operator's normal state on a young deployment. Now keyed
   on the panel's POSITION (a direct child of one of the two panel grids) plus
   the label block every panel opens with; `:has(> div > span)` is what keeps
   the grids' trailing empty cell out, so an empty box is never drawn. The union
   with the old rules was measured across all seven tabs -- it adds exactly the
   bare panels and takes nothing away.

8. **Eleven caption sliders started at seven different x.** `.hl-row` gives the
   LABEL `flex: 1`, so the slider's left edge and width were set by how many
   characters the value happened to read ("Off" vs "5 per line"): spread
   **31.5px**, three widths, and 42px of ragged left edge on the right-pinned
   value chips. A basis for each of the three cells (108px label -- the longest
   measures 104 -- and 80px value -- the longest measures 68), scoped with
   `:has(> input[type="range"])` so the colour rows, which are a different
   shape and 46px tall against 22, are left alone. All four spreads **0.00**.

9. **The three plan buttons were not on one line.** The "Opening soon" note is
   `display: none` in a priced card, so it took its height out of ONE card and
   that card's bottom-anchored button rose **30.79px** with all three cards the
   same height. Live in production -- Studio has no Stripe prices. The note
   keeps its line in every card now (`visibility: hidden` and a non-breaking
   space), so the three CTAs a customer compares are level.

10. **A stranded button retitled a clip that was not on screen.** Going Review
    queue -> Lecture library, `patch()` pairs the queue's clip `<article>`
    against the library's lecture `<article>` by index, `syncAttributes` strips
    `data-clip` because the new render does not carry it, and the
    `data-host-owned` star and Posts-to row survive inside. Both painters walk
    `[data-clip]`, so **neither could ever see them again**: four lecture cards
    each carrying a stranded star, +68px of card height, and the star still
    bound to the QUEUE clip's id -- clickable, keyboard-reachable, and firing a
    retitle against a clip nobody was looking at.
    Both painters sweep by their OWN marker now, the rule `clearClipToolsAreas`
    already followed; the star also carries the id it was built for, so a node
    that ends up on a different clip is rebuilt rather than keeping the first
    clip's closure. Measured: **0 stranded on every navigation path**, card
    height back to the direct-navigation control's 253px.

11. **The live bar was painted over real controls.** `#studioLiveBar` is fixed
    at `bottom: 18px` with `z-index: 150` and nothing reserved space for it, so
    a control whose centre fell in its band received no clicks at all -- they
    went to the bar. `body.dc-livebar` is stamped from the same place that
    un-hides it, and padding `#studio main` shrinks the scroller inside it
    (measured 835 -> 743px, its bottom edge 950 -> 858 against the bar's top at
    877). Covered-not-clipped controls: **3 on the queue at 1280 and 1 on the
    library at 1100 before, 0 at 1100/1280/1440 after.**
    **CLIPPED IS NOT COVERED**, and conflating them is what made two earlier
    readings useless: a control scrolled out of its own overflow container is
    reachable by scrolling, and a probe that only asks "is the bar topmost
    here" counts every one of those as a fault.

12. **On the review deck, "Posts to" was drawn underneath the video.** The
    painter matched the deck card too, and that card is a fixed 9:16 stage with
    `overflow: hidden` into which the host mounts the clip as an
    absolutely-positioned `<video>` at z-index 1 -- so a statically-positioned
    row appended there had a covering fraction of **1.00**, and it was the ONLY
    such row on the screen. The one place the decision is taken showed no
    destination at all. It mounts in the deck's INFO COLUMN now, under the score
    reasons beside the Approve button. `data-deck-info` was added to the design
    export and the re-import **proven byte-stable first**: the generated CSS came
    back identical, no hashed class moved, 21 bytes of template delta.

13. **A confirmation swallowed a navigation click.** The notification dock sits
    above everything and each card takes pointer events back so it can be
    hovered (pausing its countdown) and dismissed. Measured: a real click on
    Home's "Schedule" link was dispatched to the toast and the screen did not
    change, for the whole 4.2s of its life; four stacked cards also covered "See
    all 8" and two Approve buttons. The four kinds that leave BY THEMSELVES pass
    their clicks through now; `work` (sticky) and `bad` (7s, worth re-reading)
    keep both. Proven with a real click: the link is topmost and navigates.

### A source-string test failed against correct code, for the sixth time

`studio-design.test.mjs` asserted the exact expression
`toggle('hide',!(!onHome&&any))`. Hoisting that value to a named constant so the
body class could read it too -- identical behaviour, different bytes -- turned
it red. It pins the PROPERTY now (off Home, and only while something runs) and
accepts either spelling. That is the failure mode this file has recorded more
often than any other, and it goes both ways: the same shape has also passed
against behaviour that had changed underneath it.

### What was measured and found CLEAN, worth recording as negatives

Zero icon-vs-text centring errors across all thirteen screens once the real
fonts and the real icon font were loaded. Zero real page errors across 356
clicks over every screen. All seven Owner sub-tabs structurally sound. No
control made unreachable by scrolling. The topbar's five controls all 34px at
one centre line (v3.94.0 holds); the live row's spinner 0.00px off its title
(v3.113.0 holds); the schedule week grid one set of left edges and identical
heights. The connections dialog IS reachable once every platform is connected --
a definitive probe clicking all 356 controls found 8 routes, which refuted a
high-severity finding I had drafted from a text scan of labels.

### And five more, from the screen-overflow lens (v3.126.0, same day)

The third finder landed after v3.125.0 shipped. Same discipline: measured, fixed,
measured again, seven more probes proven red.

14. **Templates lost its preview column, with no way to scroll to it.**
    `paintTemplatesLayout` forces `overflow-y: hidden` on the scroller so the
    preview stays pinned -- correct while the two columns fit, and a trap the
    moment they do not, because everything below the cut is DRAWN AND THEN
    HIDDEN with nothing able to scroll it. Measured at **1366x768, the
    commonest desktop viewport**: 105px lost, the "Preview on a real clip"
    button drawn at y 751 while the panel clips at 676, and twelve wheel
    gestures totalling 4800px leaving scrollTop at 0. Also 1280x800 (73px) and
    1536x864 (9px, the CTA row half cut), and below 1050px wide where the row
    wraps and the preview goes under the settings entirely. **The preview is
    the screen**, so losing it is worse than a page that scrolls. It now locks
    only when the columns are still side by side AND the row fits, and
    re-evaluates on resize -- a resize changes both answers and does not
    repaint the studio. Reachable at 1024, 1100, 1280, 1366 and 1440 after.

15. **Every notification longer than about 45 characters lost its second
    half.** `toast()` puts the whole message in the TITLE slot and leaves the
    detail line empty, and the title was one `nowrap` line in a 370px dock --
    so the tail, reliably the actionable half, was ellipsised away. Measured on
    the app's own strings, identically at 1440, 1024 and 900: *"Publishing is
    switched off, so nothing was sent. The clip is ready to download"* showed
    57%; *"The browser blocked notifications -- allow them in site settings"*
    showed 68%, losing the entire instruction. The title wraps to three lines
    now: free up to two, one row taller at three, and a short message is
    unchanged.

16. **A busy day in the month calendar cut its second chip in half and lost
    "+N more" entirely.** The cell picks its chips from the ITEM COUNT and had
    a flat 62px floor, and the week row is `flex: 1 1 0` -- so wherever the
    calendar section is short (the schedule's side column wraps below 1246px,
    taking the section from 795px to 415) the row fell to that floor and the
    content no longer fitted. Measured at 1245 and below: cell clientHeight 60
    against scrollHeight 89, the "+2 more" span at y 288..300 while the cell
    clips at 276 -- INVISIBLE, not merely tight. So a day holding four clips
    showed one, half of another, and no count. **The v3.72.1 fix for this exact
    symptom was measured at 1440 only**, where the row is 120-138px. The floor
    is 89px now, which is what the content measures and changes nothing at
    1440. 0 overflowing cells at every width.

17. **A calendar chip could not say which clip it was.** The time and the title
    shared one ellipsis and the fixed-width time always won: a 26-character
    title showed 9 characters at 1440, 3 at 1280 and **ONE at 900**. There was
    no `title` or `aria-label` anywhere from the span up to `#studio`, so
    hovering revealed nothing -- two clips from the same lecture were
    indistinguishable on the one screen whose job is to say which clip goes out
    when. The time is its own `flex: none` cell now so only the title
    ellipsises, and the chip carries the whole "HH:MM - title" on hover.
    `title="{{ chip.tip }}"` was added to the export; the re-import was proven
    byte-stable first (generated CSS byte-identical, no hashed class moved).

18. **The search field starved the screen's own subtitle.** `#dcSearchBox` was
    `flex: 0 0 300px` -- rigid -- so between the 980px collapse and about
    1180px the heading block absorbed the entire shortfall and the subtitle
    took it. Measured at 981px: **84 of 386px, 22%** of "How every part of
    DeenClipped works, with screenshots of the real app". One pixel narrower
    the field hides outright and the subtitle comes back whole, which is what
    proved the field was the cause. At 1024, nine of thirteen screens were
    losing part of theirs. That copy is the app explaining itself, so it gives
    way LAST: the field now shrinks to a 150px floor first. Help went 30% ->
    61% at 1024 and 49% -> 72% at 1100.
    **v3.94.0's property is intact and was re-measured**: travel across all ten
    screens is **0px at 1440** with the field at 300px on every one, and 28px
    at 1280 against the 26px that release recorded. Below that the field does
    move -- the deliberate trade, against destroying the sentence.

**Two more source-string tests failed against correct code in this pass**, on
top of the one in v3.125.0: `topbar.test.mjs` pinned the whole `#dcSearchBox`
declaration when the property it protects is `margin-left: auto` and the 300px
basis, and one of my own new assertions spanned two string literals joined with
`+`. Both are corrected to the property. That is three in one session.

### Still open from this pass

The screen-overflow lens landed after v3.125.0 and its five findings are in
v3.126.0 above. A fourth lens was still running when this shipped, at a
concurrency cap of two agents; its findings are not in either release.

## Open items

### Google verification: branding VERIFIED and PUBLISHED (4 Sept 2026)

Started at Youssef's instruction. The 100-user cap is the only irreversible
ceiling on this product, so this was the right thing to do first.

**Google had already rejected a verification attempt, and the reasons were
sitting unread in the console** behind a "View issues" link nobody had opened:

1. "Your privacy policy page ... does not have sufficient content."
2. "Your homepage does not explain the purpose of your app."
3. "The app name 'DeenClipped' ... does not match the app name on your homepage."

**All three were already fixed** — by the public-site rebuild (v3.63.0) and the
24 Aug privacy rewrite, both of which postdate that attempt. Checked before
claiming so, rather than clicking "I have fixed the issues" on a guess: the
homepage names DeenClipped 15 times and states the purpose in its title,
description and first paragraph; the privacy policy is 1832 words with a
complete YouTube API data list, a 30-day retention statement, and the **Limited
Use** affirmation Google requires for restricted scopes.

Reverification passed **immediately**, and the branding is now published and
being shown to users. Note the trap for next time: a verified branding result
**expires in 7 days if it is not published** — verifying and walking away
silently loses it.

**One blocker remains, and only one:** the data-access form is complete —
scope justifications written, URLs and authorised domain in — and `Confirm` is
disabled solely for *"Missing the following fields for one or more requested
scopes: demo video."* Google wants a **YouTube-hosted** video link showing the
consent screen and each scope in use. The TikTok demo does not qualify: it
demonstrates TikTok.

The App logo is still "Not provided". It did not block branding verification,
so it is optional, but a 480x480 PNG is ready at
`~/Downloads/deenclipped-oauth-logo.png`. Its file input only exists after
clicking Browse, which opens a native picker no session can drive.

### CAN A CUSTOMER ACTUALLY CONNECT? Measured 4 Sept 2026

Youssef: "is this working for sall the public as well". Read off each
platform's own console rather than assumed, because the answer differs per
platform and only one of them is yes.

| Platform | Public? | Why |
|---|---|---|
| **YouTube** | **Yes, but capped at 100 accounts EVER** | OAuth consent screen is *In production*, User type *External* — so anyone can connect. But the app is **unverified**, which imposes a **100-user lifetime cap** (2 used) that "cannot be reset or changed", and users may meet the "unverified app" warning screen. Lifting it needs Google verification. |
| **TikTok** | **No** | Submitted for review 4 Sept. An unaudited app may only post to a TikTok account that is itself private. |
| **Facebook** | **No** | The Meta app is **Unpublished** (development mode) and the permissions are at **Standard Access**. Only someone with a ROLE on the app can connect. |
| **Instagram** | **No** | Same Meta app, and it points at `eurotrimau` rather than a DeenClipped account. |

**So today the product can onboard a paying customer on YouTube alone, and only
100 of them, ever.** That is the real ceiling on the First 100 funnel, and it
was nowhere in this file. Every other platform connects for the operator and
refuses everybody else.

The Google **100-user cap is the one that cannot be undone** — it applies over
the project's lifetime. Verification is the only way past it, and it is worth
starting before the count climbs rather than after.

### Waiting on Youssef (nothing in the repo unblocks these)

1. ~~**Send the YouTube compliance reply.**~~ **SENT, AND THE REVIEW IS
   CLOSED.** Verified in Gmail on 31 Aug 2026 by reading the thread rather
   than this file: the withdrawal went out 28 Aug 07:12, and Google replied
   28 Aug 19:33 — *"We have completed your review and don't require any
   further actions from you at this time."* There is no 8 Sept deadline and
   nothing is drafted-and-unsent. This entry said the opposite for three days,
   which is why it is corrected here rather than deleted.
   **The mailbox is clear too, checked 3 Sept 2026 rather than assumed.** This
   entry warned for days about a stale 25 Aug draft sitting in a DETACHED
   thread (`1a039b45…`) saying "please find attached screenshots" with no
   attachments. It is GONE: the account holds five drafts in total, none in
   that thread, none addressed to Google, and none dated 25 Aug. Nothing is
   waiting to be deleted and nothing is at risk of being sent into a closed
   review. Kept rather than removed because a session acting on the old
   wording would go hunting for a draft that does not exist.
   **What this does NOT prove:** that uploads now arrive public. The audit was
   the reason Google forced them private, and that reason is gone, but nobody
   has posted a clip since (the stored token is expired — open item 6). The
   product copy was corrected to stop naming a closed review as the cause
   while still warning that Google can override; it deliberately stops short
   of promising public. **One real upload settles it.**
2. **TikTok app review** — record the demo and submit (`TIKTOK-SUBMISSION.md`).
   Until then an unreviewed app may only post to a TikTok account that is
   itself private; setting the account private is the way to post today.
   **The sandbox question is answered (3 Sept 2026)** and the answer is in that
   file: the recording MUST be made against the sandbox (the App review page
   says so in as many words), the sandbox already exists with its icon and
   target user, and it points at the real production callback — so the video
   can be shot on the live site. The one cost is that the sandbox has its own
   client key/secret, so recording means swapping the Render pair, reconnecting
   TikTok, recording, and swapping back. Everything else on that submission is
   verified live: both domain-verification files serve 200, /terms and /privacy
   serve 200, and the icon is still on the Mac. **Only the recording is left.**
3. ~~**Worker deploy on Hetzner.**~~ **DONE, and it deploys itself now.**
   Kept rather than deleted because this entry was stale for two days and a
   session acting on it would waste an hour arming a workflow that is already
   armed. `deploy-worker.yml` has succeeded on every run since run 7 and fires
   on any push touching `worker/**`; run 21 verified **v3.59.1 running in the
   container** on 31 Aug 2026. Nothing is waiting on a deploy. To check rather
   than assume, see **Deploys** above — the newest successful run names the
   commit on the box, and `git log <sha>..HEAD -- worker/` says whether
   anything has changed since.
4. **Stripe identity document — this is the most urgent open item.** Checked
   in the dashboard on 31 Aug 2026 rather than assumed, and the earlier note
   here ("payments work; payouts are paused") was WRONG and had been for weeks.
   Stripe → Settings → Business → Account status shows:
   *"Provide an identity document for an account representative (Youssef
   Channaoui)" — **Overdue**, paused on 7 Aug 2026, **impacts payments and
   payouts**.* Capabilities read **Paused: Cartes Bancaires**, and
   **Paused soon: Payments**.
   "Payments paused" is not a delayed withdrawal — it is the checkout refusing
   money. Every piece of growth work in this repo assumes a customer can pay,
   and that assumption has an expiry date on it. Two minutes with a passport
   or licence at
   `dashboard.stripe.com/acct_1U1p3tKKpFy0S4he/account/status`.
5. **Hetzner CPX41 rescale.** Once done: worker retune (4 jobs, whisper medium,
   `qwen3:4b`), ETA recalibration, an end-to-end run with before/after numbers.
6. **Reconnect YouTube** — the stored token is expired and posts are missing
   their slots.
7. **A stranger test** — someone who has never seen the product signs up and
   uses it. Claude cannot create an account, so this one needs a real person.
8. **Bing Webmaster Tools** (`BING_SITE_VERIFICATION` on Render, ~2 min). Once
   Google is verified Bing will offer to import everything, which is faster
   than doing it twice.
   **Google Search Console is DONE and was already verified** — see the note
   below; the old wording here claimed otherwise and was wrong.
9. **Links.** Rankings for anything competitive come from other sites linking
   here, and nothing in this repo can produce one. The DeenClipped YouTube
   channel description pointing at `/islamic-video-clipper` is free, in your
   control, and the highest-value link you own.

### Agreed for Studio, not yet built (30 Aug 2026, Youssef)

Two features, both Studio-only, in the order he asked for them. (Item 1
has since shipped — multi-account landed v3.41.0–v3.57.0; kept here as the
record of the original ask.)

**Idea backlog for Studio** (not yet scoped, noted so they are not lost):
- **Custom templates** (31 Aug 2026, Youssef: "add to ideas for studio,
  custom templates") — a Studio subscriber designs their own caption
  template rather than choosing from the shipped five. Whatever shape this
  takes, it must respect the existing template laws: applying a style writes
  only `CLIP_STYLE_FIELDS` (invariant 3), any line that can overflow carries
  `{\q0}` (invariant 8), the Quran template's rules are not overridable
  (no nasheed, ayah treatment, forced review), and `visibleText()` still
  gates the watermark. A custom template is user input reaching the
  renderer — treat every field as untrusted.

1. **Up to 3 accounts per platform.** Free and Pro keep one; Studio gets three.
   `publishingSettings[provider].accountId` is a single id today, so this is a
   shape change: the field becomes a list, `enabledTargetsForClip` fans out
   over it, and the cap is enforced by TIER rather than by the UI, or a
   downgrade silently keeps posting to three. A clip going to three channels
   is three targets, so the schedule row (which already lists every
   destination with its own state) needs no change -- but the publish retry,
   the "posted anywhere counts as posted" rule and the token cost per clip all
   have to be checked against a fan-out they have never seen.

2. **DeenAI finds the lectures itself. A BETA feature.** Not a channel to
   watch -- Youssef, 30 Aug: "it will learn how to go onto YouTube itself and
   find its own videos", and the feature sits around DeenAI. A Studio customer
   reviews what it found and approves what is worth clipping, or turns on
   auto-approve and the pipeline runs unattended.

   **The name stays DeenAI** (his call, 30 Aug, over Rawi / Muntaqa / Daleel):
   it already ships, is documented throughout this file and carries a STUDIO
   tag in the rail, and renaming would touch the tab, the header pill, the
   footer marker, the routes and several tests for a cosmetic gain.

   Four things settled or flagged before anyone builds it:
   - **Search through yt-dlp, NOT the YouTube API.** `search.list` costs 100
     units against a 10,000/day budget -- 100 searches a day -- and adding it
     reopens the exact quota conversation the compliance review is trying to
     close. The box already runs yt-dlp behind the proxy pool and can search
     without touching Google's API at all. Ollama then ranks the candidates,
     which is work the box already does for scoring.
   - **Close the compliance review FIRST.** Today a customer pastes their own
     link, so the choice is theirs. Searching on their behalf makes the
     PRODUCT the one choosing third-party content, which is a different use
     than the open submission describes. Changing the shape of the API usage
     mid-review is how a review that is nearly closed reopens.
   - **Auto-approve spends tokens with nobody watching.** A 90-minute lecture
     is 90 tokens; a daily channel drains a Studio month in under a fortnight.
     It needs a per-period ceiling the customer sets, and `assertCanSpend`'s
     refusal has to read as "your automation paused" rather than as a failure.
   - **`QUOTE_RISK` does not bend for automation** (invariant 1). A clip
     containing scripture still forces human review, auto-approve or not.

### Known gaps in the product

- **Multi-account is complete on all four platforms**, including per-account
  TikTok audience and interaction options (v3.57.0).

- **YouTube API compliance review** (project 881648803263) is **CLOSED** —
  Google, 28 Aug 2026 19:33: "We have completed your review and don't require
  any further actions from you at this time." It may be re-reviewed at any
  time, so everything below stays true as the record of what was answered.
  **The answer is that we need no extra quota at all.** The quota methodology
  changed in 2026: `videos.insert` costs 1 unit against a dedicated **100
  calls/day** bucket, not 1,600 units out of the general pool. Our 11 Aug reply
  used the old 1,600 figure, concluded we could perform zero uploads a day, and
  asked for 20,000/day; Google has now twice written to correct that arithmetic.
  Real usage is ~5 `videos.insert`/day against a limit of 100, so the reply
  withdraws the request. Asking for quota nobody needs is what has kept this
  review open — the audit, not the quota, is what forces uploads private.
  The three endpoints, verified against the code rather than assumed:
  `channels.list` (`part=snippet&mine=true` on connect, `part=id,snippet` on
  connection test), `videos.list` (`part=snippet,contentDetails`, API key, once
  per submitted URL, with an HTML fallback), and `videos.insert`
  (`part=snippet,status`, resumable — the chunk PUTs are not extra insert calls).
  The ToS Violations Report V.1 items were answered 21 Aug and the Policy
  III.F.2a,b screenshots 26 Aug; a stale draft still sitting in Gmail repeats
  that 26 Aug reply in a **detached thread and without its attachments** — do
  not send it.
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

## Organic search: one registry, fifteen new pages (v3.43.0, 30 Aug 2026)

Youssef asked for an SEO implementation, not an SEO report, aimed at BOTH the
generic AI-clipper searches and the Islamic-creator niche. The overriding KPI
he named is paid subscriptions, not traffic.

- **Three lists described the public site and none knew about the others**: the
  route table in server.js, `PUBLIC_PAGES` for the sitemap, and `TRACKED_PATHS`
  for analytics. Adding a page meant three edits, and missing one failed
  SILENTLY — a page that served fine, never appeared in the sitemap and
  recorded no visits. `src/seo-pages.js` is now the single list (21 pages) and
  all three are derived from it. It is pure data with no imports, deliberately:
  metrics.js and marketing.js both need it and would otherwise import in a
  circle.
- **The words live in `src/seo-copy.js`, apart from the machinery.** Every
  claim is checkable against the code. Where a page says what DeenClipped does
  NOT do — the editor is gated, there is no mobile app, no platform sends
  audience data back — that sentence is load-bearing, not modesty: a visitor
  who finds it out after paying is a refund and a bad review.
- **`.feature-deep-dive` is a TWO-column grid** built for copy beside a product
  shot. The first version of these pages borrowed it with one child, so every
  paragraph was crammed into the left .92fr with the other half empty. It
  rendered as a plainly broken page and no test could have caught it — this is
  the "green suite is not verification" rule again, found by screenshotting.
  Landing pages use `.seo-section` now: heading left, prose right, hairline
  between.
- **The CSS cache-buster is a content hash now, not a hand-typed date.**
  `?v=20260830` meant a second edit on the same day served stale CSS to
  everyone who had already loaded the page — which looks exactly like a layout
  bug that will not reproduce for you. It cost half an hour here before it was
  recognised. `CSS_VERSION` reads the bytes of marketing.css at import.
- **`Disallow: /app` is a PREFIX and it also blocked `/apple-touch-icon.png`.**
  Robots rules are literal prefixes: `$` anchors the end, `*` is the only
  wildcard, and `?` is an ordinary character. Written as `/app$`, `/app/`,
  `/app?` now, and a test walks every rule against every public path and asset.
- **Metadata was typed twice and drifted.** `/contact`'s registry entry
  described the page properly while the page itself served "Contact
  DeenClipped support." — 28 characters, which is what Google shows under the
  link. `meta(path)` reads the registry, so both halves cannot disagree again.
  Titles are capped at 62 characters and descriptions at 160, because past
  those Google truncates mid-sentence.
- **`lastmod` is written by hand, never stamped.** A sitemap claiming all 21
  pages changed today teaches Google to ignore the one field it actually reads.
  A test fails if every page carries today's date.
- `test/seo-architecture.test.mjs` (16 tests) asserts the contract end to end
  over HTTP: every registered page resolves, is in the sitemap, is crawlable,
  is counted by analytics, has one H1 and a unique title, is REACHABLE BY PLAIN
  LINK from the homepage (an orphan page is indexed late or never, whatever the
  sitemap says), and invents no statistic or rating in its schema.

## Landing pages are ranked by what they EARN (v3.43.1, 30 Aug 2026)

Youssef named the KPI for the SEO work himself: paid subscriptions, not
traffic. Every other number in metrics.js counts visits, and a page with a
thousand visits and no subscription is a page to rewrite -- views alone cannot
say which.

- **The loop is: arrive -> cookie -> sign up -> account stamped -> webhook.**
  `dc_land` holds A PATH AND NOTHING ELSE (no identifier, HttpOnly, SameSite,
  90 days) and is written ONCE, never overwritten -- otherwise the last page
  before checkout takes the credit that belongs to the page that brought them.
  `metrics.attribute()` checks the value against the page registry before using
  it as a key, so a hand-edited cookie cannot mint state.
- **The Stripe webhook carries no cookie.** That is why `user.signupLanding` is
  stamped on the ACCOUNT at sign-up: it is the only road back from a payment to
  the page that earned it. Counted once per account (`landingCredited`), or a
  monthly renewal would look like the oldest page winning a new customer every
  month.
- **`userBySubscription(undefined)` matched a stranger.** Found while testing
  this, and worse than the bug being looked for: it compared undefined against
  every account's `stripeSubscriptionId`, ALSO undefined for anyone with a
  billing record and no subscription, so the first such account matched and an
  invoice with no subscription id had its money recorded against them. Both
  lookups refuse an empty id now, and the money is filed against no account
  rather than an arbitrary one.
- **The table's key set is entries UNION everything attributed.** Built from
  entry views alone, a page whose visit fell outside the window but whose
  signup landed inside it vanished entirely -- dropping exactly the row worth
  reading.
- The Owner screen's "Pages that earn subscriptions" table is built by the HOST
  (`dcPaintLandingTable` in index.html), reusing the export's own classes --
  the same device as the chart tooltip, because putting it in the design export
  would regenerate every hashed class name in the app for one table.

### Every HEAD request answered 404, the homepage included (v3.44.0)

Found by running `curl -I` against the live site while measuring page weight.
Every route in server.js matches on `method === 'GET'`, so a HEAD request fell
through all of them to the 404 handler -- `HEAD /` returned 404 on
deenclipped.online. Link validators, uptime monitors, social-card scrapers and
some CDNs ask with HEAD first, and every one of them was being told the site
does not exist. Nothing went red, because nothing in the suite had ever asked
that way.

HEAD is now routed as a GET with the body dropped on the way out, keeping the
Content-Length GET would report (RFC 9110). `res.write` and `res.end` are
wrapped rather than the routes being changed, so a streamed file behaves too.
`curl -I` was also what made `marketing.css` look like it was served `no-store`
-- it is not; the GET carries `public, max-age=3600`.

## Images reserved no space, and phones got 13px targets (v3.45.0, 30 Aug 2026)

Two Core Web Vitals faults that had been served on every page since the site
launched, both found by MEASURING a rendered page rather than by reading CSS.

- **All 62 images were served with no width or height.** The browser reserves
  no box, so every page jumped as the files arrived. Proven both ways in a real
  browser: strip the attributes and 9 of 11 markers move with a worst shift of
  114px; with them, ZERO move. A measurement that cannot fail proves nothing,
  so it was run against the broken state first.
  The sizes are read out of the WebP headers at import (`IMAGE_SIZES`) and
  stamped onto the finished HTML in `layout()` (`stampImages`) -- one place, so
  a page added tomorrow gets it, and a re-exported asset cannot make a
  hand-typed number a lie. The first image also gets `fetchpriority="high"` and
  loses `loading="lazy"`: lazy-loading the LCP element is the classic way to
  make a fast page score badly.
- **21 tap targets under 24px and 63 strings under 12px, on every page**,
  because both live in the shared footer and hero. Footer links were 144x13.
  Fixed with PADDING, not font size, so nothing reflowed. Sentences now have a
  12px floor on phones; the letter-spaced uppercase micro-labels deliberately
  do NOT -- tracking is what makes those legible, and enlarging them turns a
  quiet typographic device into a row of shouting. Inline links inside a
  paragraph are left alone: WCAG 2.5.8 exempts them and padding would break the
  line box.
  **Two rules lost on specificity and had to be matched, not out-ordered:**
  `.price-card li` and `.compare-row > span:first-child` both beat a plain
  descendant selector, which is why 13 plan features and 9 comparison rows
  stayed at 10-11px after the first pass -- the two lists a customer reads to
  decide what to pay for.
- **There was no horizontal overflow, and an early measurement said there was.**
  An iframe has no viewport meta, so a page written into one at 375px reports
  the desktop layout's width. Measured in the real viewport: 0 of 21 pages
  overflow. Check the real thing before fixing a phantom.
- **CI has no browser and must not get one** -- this repo has no npm
  dependencies on purpose, which is what lets a phone session run the suite. So
  the image test asserts served HTML (real executed output) and the tap-target
  test only catches the CSS block being deleted wholesale. It says so in the
  test.

## Guides, two real free tools, and the crawlers named (v3.46.0, 30 Aug 2026)

- **Six guides and a hub, not sixty.** The brief asked for enough to establish
  the cluster and explicitly not for a hundred generic articles. Each answers
  one question and stops; DeenClipped is mentioned only where it genuinely
  does the thing being described, because a guide that turns into a sales page
  halfway through is not one, and nobody trusts the next.
- **The hub lists its cluster, computed.** The first version named three guides
  by hand in the registry's `links` and the other two were reachable from
  NOWHERE. `test/seo-architecture.test.mjs` caught it — that is exactly why the
  crawl test walks links instead of trusting the sitemap. `clusterIndex()`
  derives the list, so a guide added tomorrow appears without anyone
  remembering.
- **Both free tools actually work, and that was verified by driving them.**
  The safe-zone checker draws each platform's covered area over a frame the
  visitor supplies; the clip calculator does arithmetic against
  `config.tokensPerMinute` and `config.tokensFree`, read from data attributes,
  so it cannot drift from billing. Measured in the browser: zones present
  47,364 lit pixels and 887 with every zone off, a dropped frame paints
  123,732, and the tool issues **zero network requests** — which is what makes
  "nothing is uploaded" a statement of fact rather than a promise.
- **The calculator called its own assumption "conservative" and it was not.**
  Two thirds of selected time becoming clips is a CEILING, not a forecast. Both
  the footnote and the page copy now say so. A tool that flatters its own
  numbers is worse than no tool.
- Behaviour lives in `src/public/tool-widgets.js`, loaded only by the two pages
  that have a widget — the CSP hashes inline scripts from index.html only, so a
  marketing page cannot carry one.
- **The AI-search crawlers are named in robots.txt and given the IDENTICAL
  rules.** Naming them makes "this site shows a crawler what it shows a person"
  a stated position rather than an accident of `*`. Serving bots different
  claims is cloaking and would put the whole domain at risk.
- **`/llms.txt` is served and says what it is IN THE FILE**: a convention some
  AI tools follow, not read by search engines and not a ranking signal. Built
  from the registry, so it cannot describe a page that does not exist.
- **Arabic is prepared, not published.** `alternatesFor`, `langOf` and `isRtl`
  exist; hreflang, `lang` and `dir` follow automatically from a page carrying
  `lang: 'ar'` and `translationOf`. Nothing is registered, so no hreflang is
  emitted — which is correct: a set pointing at a page that does not exist
  makes Google drop the whole cluster. A machine-translated religious product
  is worse than an English one.
- **`/examples` and VideoObject are NOT built, deliberately.** There is no
  repo-owned public demo clip, and the brief forbids a VideoObject without a
  real accessible video. `KIND.EXAMPLE` is reserved and the page stays
  unregistered until Youssef publishes one clip publicly.
- **GitHub metadata set** (description, homepage, 8 topics) after scanning the
  tracked tree AND the history for credential shapes — it is a public repo. The
  README opening was stale and named an import provider removed in August.

## The comparison page, the proof band, and research that refuses (v3.47.0)

- **One comparison page, not one per competitor.** A page per rival is a page
  per rival to keep true, and a stale comparison is worse for the reader than
  none: they check, find it wrong, and stop believing the rest of the site.
  `/alternatives` **quotes no competitor price anywhere**, deliberately --
  pricing moves and a wrong number about someone else's product is both a
  credibility and a legal problem. It compares on capability, says outright
  that a general tool is likely the better buy for English podcasts, and lists
  what DeenClipped does NOT have.
  Research found the real niche fact worth having: the existing Islamic tools
  (Quran Caption, QuranClip, Quran Clip Helper) BUILD a recitation video from a
  reciter's audio. DeenClipped goes the other way and cuts an existing lecture.
  Different job, and that is the honest differentiator.
- **The landing pages had no picture of the product.** Fifteen pages of prose
  and a visitor who has read four paragraphs still had not seen a clip.
  `proofBand()` puts the next action and two real product images under the
  hero, on commercial pages only -- a guide should answer before it asks for
  anything, and a free tool already has its own control. The form is the
  homepage's, so a pasted URL survives sign-in and lands in the importer;
  verified by submitting it and reading the resulting
  `/login?returnTo=/app?source=...`.
- **`src/research.js` refuses before it invents.** It exists so that when there
  IS enough data to publish something about what happens to long lectures, the
  analysis is already written and privacy-checked rather than improvised under
  the pressure of wanting something to publish -- which is exactly when eleven
  clips become "a study". `MIN_SAMPLE` 500 clips AND `MIN_ACCOUNTS` 20, because
  a big sample from three accounts describes three workflows and publishing it
  as the practice is a lie of framing rather than of arithmetic. Buckets under
  25 records are dropped and the dropped count travels with the result. It
  reads no titles, transcripts or ids, and a test asserts that by planting them
  in the fixtures. **It is deliberately not wired to a route, and a test fails
  if it ever is** without someone thinking about it.
- **`videoObjectFor()` refuses without a real public video** -- no https URL,
  no thumbnail, no duration, or a signed/private path, and it returns null. A
  page with no VideoObject ranks worse than one with a true VideoObject and
  infinitely better than one with a false one, and the penalty for a false one
  lands on the domain rather than the page.
- **The Owner screen now says what it does NOT know.** Impressions, queries and
  ranking positions come from Search Console, which this app has no connection
  to; the note says so rather than leaving a gap that reads as zero traffic,
  and shows the sitemap's public page count beside it.

## The SEO brief is finished (v3.47.0, 30 Aug 2026)

All 51 sections of Youssef's implementation brief are done. The final report is
an artifact; what matters for the next session is here.

**The self-audit is 20/20 against PRODUCTION, not against localhost** — the
brief's own twenty questions, scripted and re-runnable
(`scratchpad/final-audit.mjs` pattern: fetch the live sitemap, fetch every
page, assert). Worth re-running after any marketing change. It measures
titles DECODED: `&amp;` is five characters on the wire and one in a search
result, and counting the escape called two fine titles too long.

**Deliberately NOT built, each for a stated reason.** Do not "finish" these
without reading why:
- **No `/examples` page and no VideoObject.** No repo-owned public clip exists.
  `videoObjectFor()` is written and refuses without a real https URL, a
  thumbnail and a duration -- a page with no VideoObject beats one with a false
  one, and the penalty lands on the domain rather than the page.
- **No Arabic pages.** `alternatesFor`/`langOf`/`isRtl` are built and hreflang
  follows automatically; nothing is registered, so nothing is emitted. Correct:
  hreflang pointing at a page that does not exist makes Google drop the cluster.
- **No competitor price comparisons anywhere.** Prices move and a wrong number
  about someone else's product is a legal problem as well as a credibility one.
- **No fabricated proof.** A test fails the build on customer counts, ratings,
  "trusted by", "go viral" or "guaranteed".
- **`research.js` is not wired to a route**, and a test fails if it ever is
  without someone thinking about it.

**FAQ schema is kept on purpose.** Google stopped showing ordinary FAQ rich
results, so it earns nothing in search. It stays because it is accurate,
built from the same array that renders the visible questions, and is
machine-readable for AI answers -- NOT as a ranking tactic. If that stops being
true, delete it.

**The crawl test earned its keep three times in one session** -- two orphan
guides and the comparison page, each linked from nowhere. It walks links from
the homepage rather than trusting the sitemap, which is the only way to catch
that. Any new page must be linked from somewhere a crawler can walk to.

## Search Console: verified all along, and the sitemap was never submitted

Checked in the browser on 30 Aug 2026 rather than assumed, and the assumption
was wrong in both directions.

- **The property already existed** as `sc-domain:deenclipped.online`, a DOMAIN
  property, which is DNS-verified and covers every subdomain. So
  `GOOGLE_SITE_VERIFICATION` on Render is **not needed** and never was. The
  config and the meta tag stay because they cost nothing and a URL-prefix
  property may be wanted later, but nothing is blocked on them.
- **No sitemap had ever been submitted** — the Sitemaps page read 0 of 0. That,
  not verification, is why only **2 pages were indexed** against 3 clicks in 28
  days. Submitted; Google read it immediately and reported **30 discovered
  pages, status Success**.
- **Seven pages requested for indexing** through URL Inspection, each confirmed
  "Indexing requested · added to a priority crawl queue": the two clipper
  pages, long-video-to-shorts, islamic-lecture-clipper, youtube-to-shorts,
  how-it-works and guides. Every one reported "URL is unknown to Google"
  beforehand, which is the honest baseline to measure the next few weeks
  against. The daily quota is roughly 10-12, so the rest arrive via the sitemap.
- **A link now exists**, added to the DeenClipped YouTube channel's Links
  section (not the description, which is well written and was left alone):
  "Clip your lectures" → `/islamic-video-clipper`. Live on the public channel.
  Channel links are nofollow, so this is worth REFERRAL traffic from 80
  subscribers and 13.4K views a month rather than ranking signal — say that
  plainly rather than counting it as the backlink problem being solved.

**The trap for the next session:** a Search Console toast covers the URL
inspection box for several seconds after each request. Clicking Dismiss, then
waiting, then clicking the box, then typing is the sequence that works; typing
straight after a request silently goes nowhere and looks like the page ignored
you.

## The SEO audit that challenged the SEO work (v3.48.0, 30 Aug 2026)

Youssef asked for a rigorous audit rather than more pages, and explicitly for
folklore to be removed rather than protected. Several things below reverse an
earlier decision made in this repo.

### Rules that were myths, now gone

- **"No two pages may lead with the same phrase" is deleted.** Google does not
  penalise a shared opening word, and enforcing it pushed titles away from the
  words people type. Distinct TITLES are still asserted; the replacement test
  checks whether two commercial pages make the same ARGUMENT, which is what a
  doorway page actually is.
- **Titles over 62 characters and descriptions over 160 no longer hard-fail.**
  They are truncation thresholds for a SERP snippet, not ranking rules.
- **"No CDN" was described as a performance virtue and is both wrong and
  backwards.** Production sits behind Cloudflare in front of Render, serving
  brotli. Measured: `cf-cache: DYNAMIC`, so HTML is not edge-cached — because
  marketing pages vary by auth state in the header. That is a deliberate
  correctness trade, not an absence of a CDN, and it is the thing to revisit if
  geographic latency ever matters.

### The doorway problem was real and shingles could not see it

Verbatim overlap between the tool pages was low (max 12.8% five-word shingle
Jaccard) because the sentences were rewritten. The ARGUMENTS were not: "you
pick the minutes" appeared on 7 pages, "cuts land on a complete thought" on 7,
"nothing publishes until you approve" on 10.

- **Two pages merged away with 301s** (`RETIRED_PAGES`):
  `/tools/long-video-to-shorts` -> `/tools/ai-video-clipper` (44% argument
  overlap with youtube-to-shorts) and `/for/islamic-creators` ->
  `/islamic-video-clipper`. 30 pages -> 28.
- **Four pages rewritten to earn their existence**: the three YouTube-to-X
  pages now carry genuinely platform-specific substance (TikTok's
  nothing-preselected privacy rule and unaudited-app restriction; Reels' Meta
  connection and its larger covered area; Shorts' under-three-minutes
  classification and the compliance caveat that uploads currently arrive
  private), and lecture-clip-generator is genuinely generic rather than a
  second Islamic page.
- Worst commercial-vs-commercial overlap after: **29%**, down from 44%. The
  test threshold is 32% and compares WITHIN a kind — `/about` restating the
  product is not a doorway page.

### robots.txt is not an indexing control

`/login` and `/reset` were `Disallow`ed and served indexable HTML. Blocking a
page from crawling does NOT keep it out of the index — Google can list it as a
bare URL, and /login is linked from the header of every public page. They are
now CRAWLABLE and answer `X-Robots-Tag: noindex, follow`, which is the
combination that works, because a crawler has to fetch a page to see the
header.

### Other measured findings

- **Not one internal link lived inside body prose.** 22 of 28 pages had no
  contextual inbound link at all. `CONTEXTUAL_LINKS` links phrases that were
  ALREADY in the copy, first occurrence only, one per target, three per page.
  The per-target cap was initially per-SECTION and a page linked one target
  twice — caught by test, not by reading.
- **`/pricing` looked like it had no call to action and does not.** Local has
  no `STRIPE_PRICE_*` variables, so every paid card renders "Opening soon".
  Production serves "Choose Pro" as a primary button. **Check production before
  reporting a conversion bug found locally.**
- Hashed `marketing.css` is now `immutable, max-age=31536000` when the request
  names the current hash; icons and the social card get a week instead of a
  conditional request per page load.
- Structured data: 0 problems across 28 pages. Every FAQPage question is
  visible on its page, breadcrumbs match, no ratings, no VideoObject.
- Claims audit: **0 unproven claims**. Nothing advertises the gated editor,
  multi-account, or a mobile app.

### Money integrity

`src/finance-audit.js` finds what the `userBySubscription(undefined)` bug left
behind — the comparison was fixed, the rows it wrote were not. It **reports and
never writes**: a misattributed payment is a question about a real person's
money and the correction needs the invoice open in Stripe. Owner-only at
`/api/owner/integrity`. `test/finance-integrity.test.mjs` reproduces the bug
exactly, and was **proven to fail against the old comparison** before being
kept.

## Growth: referrals, and what counts as one (v3.49.0, 30 Aug 2026)

Aimed at the first 100 paid subscribers rather than at pageviews.

- **An account is not a referral.** Signing up costs nothing, so paying for one
  buys fake accounts. A referral counts when the invited person has ACTIVATED
  -- processed a video AND approved a clip -- which is the first moment they
  have seen what the product does and is expensive enough that faking it is not
  worth doing. `referrals.isActivated()`.
- **The funnel is DERIVED, not a new event stream.** `growth.js` reads
  projects, clips, revenueEvents and accounts, all of which already exist. A
  parallel "user did X" log would be a second source of truth that drifts from
  the first, and the first is the one the customer can see. Nothing here
  fingerprints or records a journey.
- **Every reward defaulted to ZERO** (`config.referralBonus*`,
  `config.affiliate*`) because the economics were not approved, and code that
  pays out by default pays out before anybody decided to.
  **`referralBonusPaid` is 50 as of 1 Sept 2026** -- Youssef asked for a
  reward on the inviter's side to sit beside the invited person's 30% off, and
  that is the decision the zero was waiting for. 50 is his call over the 100
  first proposed here: Pro monthly is A$29 for 650 tokens, so it is about 7.7%
  of a month, roughly one more lecture. Capped at three invites a link, the
  whole exposure is 150 tokens per referrer against A$29/month recurring.
  The other two stay at zero: rewarding a mere SIGN-UP is the one that buys
  fake accounts. The env var still wins, so it can be turned down without a
  deploy, and the test now asserts the DECISION rather than "everything is
  zero" -- a guard that blocks an approved price is not protecting anything.
- **It pays on SUBSCRIPTION, never on signing up.** `settleReferrals` stamps
  `convertedAt` only when `activationOf(...).paid`, the grant is idempotent on
  `converted:<userId>`, and it lands in the same balance a purchased top-up
  writes to -- so the number the customer sees is the number that spends. The
  panel now says both halves of the deal ("They get 30% off when they
  subscribe. You get 50 tokens when they subscribe to a plan."), each written
  only when it is actually configured.
- **`billing.grantBonusTokens` refuses to run without a key** and refuses a key
  it has already honoured. The settle pass runs on every owner growth read, so
  without that it would top somebody up on every read.
- **Renewals are excluded everywhere.** `activatedAt`/`convertedAt` are stamped
  once and never rewritten, so a renewal, a replayed webhook or a second
  approved clip cannot pay twice. A yearly plan is divided by 12 for MRR rather
  than counted as twelve monthly customers.
- **Everything ranks by PAID, never by traffic.** A channel with a thousand
  visits and no customers is a channel to stop working on, and sorting by
  visits hides exactly that. A test asserts one paying campaign outranks twenty
  free signups.
- **Abuse is FLAGGED, never auto-blocked.** One person with two accounts and
  two colleagues on one email domain look identical, and telling them apart
  properly means fingerprinting. `referrals.suspicious()` surfaces pairs; a
  person decides, and nothing pays automatically.

### The host-panel lifecycle trap, for the third time

The invite panel is host-rendered (the same device as the chart tooltip and the
landing table). Hooking a render function was wrong TWICE: the hook fires at
the START of a render, so it inspects the PREVIOUS DOM and finds nothing, and
the studio coalesces its paint into a frame that neither `setTimeout(0)` nor a
double `requestAnimationFrame` reliably landed after. A **MutationObserver
watching for `#dcPlanGrid`** does not need to know any of that. Use that shape
for the next host-rendered panel rather than rediscovering this.

Also: the panel is keyed off the plan grid EXISTING rather than off
`UI.screen`, so there is one source of truth instead of two that disagree after
a re-render.

### The funnel found the thing that actually matters (30 Aug 2026)

The First 100 screen was built and immediately reported something worth more
than the screen itself:

**No customer has ever completed an import.** Eight accounts, four imported,
`importStatuses: {"failed": 5}` — every non-owner import has failed, and the
eleven completed projects on the box are all Youssef's own.

**The failures are HISTORICAL, and that distinction is the whole story.** All
five are dated 4–18 August, and every one names a cause that has since been
fixed: two YouTube bot walls, one "You are not subscribed to this API" from
SocialKit, and two 403s. SocialKit was removed and the Webshare proxy pool set
up on **26 August**. Nothing has failed since — because nobody has tried.

So the honest position is not "the product is broken". It is:

- the four or five people who tried it in early August met a genuinely broken
  importer and are unlikely to come back;
- the fix has never been proven by a real customer, only by the owner;
- four more accounts signed up and never imported anything at all.

**One real person taken end to end is worth more than any further growth
work.** That is the next action, and no amount of SEO or referral machinery
substitutes for it.

**The deploy note was crying wolf.** Owner → Health compared the worker version
against the APP version and said "Worker changes since then are not live" — on
30 Aug that read v3.42.0 against v3.49.1 while the box was completely current,
because no `worker/` change had shipped in between. It now says how to check
(`git log v<worker>..HEAD -- worker/`) instead of asserting staleness it cannot
know. The test that required the words "not live" was corrected with it.

## The watermark switch had nowhere to live (v3.51.0, 31 Aug 2026)

Pro sells "Remove the DeenClipped watermark". The only control that could do it
was `edWm*` — **in the clip editor, which is behind the coming-soon gate**. So
the feature was sold and could not be used by anyone who bought it.

- The switch is now on the **Templates** screen, host-rendered against the
  export's own classes (no design re-import). Position was ALREADY there in the
  BRAND list; a second position control was built first, immediately disagreed
  with the existing one, and was deleted. **Two controls for one setting is
  worse than none.**
- **Three bugs found by driving it rather than by reading it:**
  1. `PUT /api/templates/:id` refused, because the draft on that screen can
     carry the id `new-template` and has never been saved. `POST /api/templates`
     resolves a draft onto the template it came from and carries the same
     paywall.
  2. Basing the save on `templateDraft` wrote every unsaved draft field onto
     the saved template and **renamed "Clean Line" to "New Template"**. It
     patches `selectedTemplate` now — display may follow the draft, saving
     never does.
  3. The label did not repaint after saving, so it read "Off" beside a switch
     that was on. The MutationObserver only fires when the panel is MISSING.

### A zero-width space was removing the watermark for free

`assertWatermarkAllowed` asked `trim() === ''`, and **JS `trim()` removes
whitespace and line terminators and nothing else.** A watermark of one
zero-width space is not empty by that test, survived the sanitiser, and rendered
as nothing — the paid feature, taken for free. Verified, not reasoned about:
U+200B, U+2060 (word joiner), U+00AD (soft hyphen) and **U+2800 (blank braille,
a real glyph that draws nothing)** all walked through. U+00A0 and U+FEFF did
not, which is why a partial fix would have looked like it worked.

`templates.visibleText()` is now the single answer to "would a viewer see
anything", used by the paywall AND the sanitiser — two different notions of
empty is exactly how the gap opened. Blocked at the gate and at storage, because
a subscription can lapse between saving a template and rendering with it. The
regression test was proven red against the old check before being kept.

## The invite discount (v3.52.0, 31 Aug 2026)

Youssef: "attach 30% off for this invite link max 3 people and also it doesnt
overlap other codes."

- **The percentage is NOT in this repo.** It lives on a Stripe coupon, along
  with its duration, and `STRIPE_REFERRAL_COUPON` holds only the id. A
  `REFERRAL_DISCOUNT_LABEL=30% off` sitting beside a coupon somebody later
  edited to 20% would have the product promising one number while charging
  another — the same "two places that can disagree" fault this codebase has now
  fixed three times. `billing.referralCouponSummary()` asks Stripe and caches
  for an hour; on any failure it returns null and the panel says "a discount"
  without a figure, which is worse copy and true.
- **It cannot stack, and Stripe is what enforces that.** A checkout session may
  carry `discounts` OR `allow_promotion_codes`, never both — Stripe rejects the
  session outright. `checkoutDiscountParams()` makes the choice: an eligible
  invite gets the coupon and NO promo box; everyone else gets the promo box.
  Split into a pure function so the rule is tested by CALLING it. The first
  version of that test read billing.js and matched on text, and failed against
  a comment containing the words it was looking for.
- **The cap counts PAYMENTS, not opened checkouts.** Counting at checkout would
  let anyone burn a referrer's three by opening three checkout pages and
  closing them. The honest cost of counting at payment: three invited people at
  checkout simultaneously are all under the cap, so a fourth discount is
  possible in a race. That is the right way round — a rare extra discount costs
  a few pounds; burning a real referrer's allowance costs the programme.
- `discountUsedAt` is stamped once per invited account, so a renewal or a
  replayed webhook cannot re-spend it.
- **A spent cap does not break the link.** The referral still counts and still
  credits the referrer; it just stops carrying the discount, and the panel says
  so.
- **Nothing is on until the coupon exists.** `STRIPE_REFERRAL_COUPON` is empty
  by default, and with it empty the panel says there is no reward rather than
  promising one nobody will receive.

### The invite panel latched on failure (v3.52.1)

Live on production: `/api/referral` answered perfectly and the panel never
drew. `loadReferral()` set its "already loaded" flag BEFORE the request and
left it set whatever happened, so a single early call — before the session had
settled — cached `null` and no later repaint could ever recover. It now latches
only on SUCCESS, and shares one in-flight promise so a burst of repaints does
not become a burst of requests.

Second half of the same bug: a MutationObserver reacts to CHANGE. Landing
straight on Tokens & billing means the plan grid is already there when the
observer is installed and no mutation ever fires, so the panel also paints once
at boot.

Both only showed up on production, because locally the panel was always reached
by navigating INTO the screen with a warm session.

## DeenAI learned to read your decisions (v3.53.0, 31 Aug 2026)

Everything DeenAI said before this was a pattern anyone could have told you.
Four new cards read the account's OWN judgements, which is the part no
competitor can copy — it is not about short-form video, it is about this
person's taste.

- **The next action comes first.** An account with twelve clips sitting
  unreviewed was being told its approved hooks average nine words. True, and
  useless. `nextActionCard` uses `referrals.nextStep` — the SAME definition of
  "stuck" the owner's growth funnel uses, deliberately, because two definitions
  would eventually have the dashboard and the customer's advice telling
  different stories about one account.
- **What you keep vs what you throw away.** A person watching a clip and saying
  no is the strongest signal in the product and nothing was reading it. Speaks
  only with six of each and a gap over eight seconds: below that a "pattern" is
  one clip's accident wearing a percentage sign.
- **Does the score agree with you?** The worker scores, a human decides, and
  nobody compared them. Reports only when they DISAGREE — "the score broadly
  matches your judgement" is not worth a card. Where three or more clips rated
  85+ were rejected it says plainly that auto-approve would have published
  them.
- **Minutes per keeper**, because the product charges by the source minute and
  that is the question a customer actually has.

**Two bugs found while testing, both of the same kind — a number that makes the
reader distrust every other number beside it:**

1. Untitled clips were averaged into the hook figure, producing "your approved
   hooks average **0** words".
2. The next-action card told a PAYING customer to subscribe, because "paid" is
   derived from revenue events and an account can hold a plan without one
   (granted, comped, migrated).

**Cards are now ranked by how specific they are to the account**, not by the
order they were written. Only five are shown, and the two most specific things
the product can say were falling off the end behind generic advice about hook
length.

**Only the FIRST card gets a kicker slot; every other one is a row with the
title alone** (v3.53.1) -- so "You keep the" / "shorter ones" reached the screen
as a heading reading "shorter ones", and "24 source minutes" beside it. A card
now carries a `line`, the complete statement, which the row uses and the hero
ignores. Adding a kicker slot to the row template would have meant a design
re-import and every hashed class name in the app regenerating, for one span.
The lecture card is the deliberate exception: its title is the lecture's OWN
name and may be Arabic, so its `line` stays the bare name rather than being
glued into an English sentence and rendering as scrambled bidi.
**No assertion about the data could have caught this** -- the cards were
correct and the screen was wrong. Found by screenshotting, which is the rule
this file has been repeating since August.

## The watermark row flickered, and the obvious fix made it vanish (v3.53.3)

Youssef: "the captions when moving is lagging cause the watermark option is
disapearing and coming back."

- **A host-rendered row is destroyed by the render it sits beside.** The panel
  next to it is rewritten through innerHTML on every template change, which
  takes the injected row with it. Measured: one click on Caption position and
  the row came back as a DIFFERENT node (`sameNode: false`). The row carries
  ~66px, so the column under it jumped out and back on every change -- moving
  the caption repeatedly reads as the whole panel lagging.
- **The bug was WHEN it was put back, not that it was.** The observer repainted
  from `setTimeout(...,0)`, which lands after the render but only after the
  browser has already PAINTED a frame with no row in it.
  `requestAnimationFrame` runs after the render and BEFORE the paint, so no
  frame is ever shown without it. rAF is throttled in a hidden tab, so a
  timeout races it and whichever lands first wins; paintWatermark is
  idempotent.
- **Repainting SYNCHRONOUSLY from the observer looks like the obvious answer
  and is worse than the bug.** A MutationObserver is delivered part-way through
  the render, so the row is inserted and then wiped by the innerHTML write that
  follows -- `host.parentNode` ended up with two children and neither was ours,
  and the row then never came back AT ALL. Nearly half a session went on this;
  it is written down so the next person does not try it.
- **The "keep one node and re-attach it" optimisation was also tried and
  reverted.** It is not needed once the timing is right, and it introduced a
  signature gate that stopped the row ever being re-inserted. The fix that
  shipped changes one scheduling call and nothing else.
- Proven the way it was found, on the same control: row present 4/4 changes,
  the SAME node each time, and 0px of movement -- against rebuilt-every-time
  before.

## Dragging a caption re-rendered the whole studio per mouse event (v3.53.4)

Youssef: "it glitches a lot ... like the page is jumping when moving captions."
The v3.53.3 rAF fix was for the row FLICKER; this is the other half, and it is
the one that was actually making the page jump.

- **`makeDrag`'s `move()` called `paintNow()` on every mousemove.** That
  re-renders the entire studio -- rail, header, panels, preview. A mouse
  reports far faster than the screen draws (125Hz is ordinary, 1000Hz exists),
  so the full render ran up to sixteen times per displayed frame and all but
  the last was thrown away. Every one of them also tore out and rebuilt the
  host-injected panels beside it.
- **Measured, on the identical two-move harness drag: FOUR watermark-row
  rebuilds before, TWO after.** Two moves cannot show the real win -- the
  coalescing caps repaints at one per FRAME, so the saving scales with how many
  moves a drag actually generates, which for a human drag is hundreds.
- The drag STATE is still written synchronously on every event; only the render
  is coalesced. So the frame that paints always draws the newest position --
  redundant renders are dropped, never the latest one.
- **`global.requestAnimationFrame` does not exist in the test context.** The
  suite drives `move()` directly and reads the preview immediately after, so
  the coalesced path fell over with nine failures. It falls back to painting
  synchronously when rAF is absent, which is exactly the old behaviour.
- The harness's `left_click_drag` emits only TWO mousemove events, so it cannot
  reproduce the density of a real drag. It is enough to compare before against
  after; it is not enough to measure smoothness. Say which of the two a number
  is.

## The watermark row was the one host panel left out of the render (v3.53.5)

Youssef: "its laggying cause the watermark shows then goes away only when
dragging captions." Third attempt at this, and the first two treated the
symptom.

- **`paintStudio()` restores every host-rendered panel synchronously right
  after `STUDIO.render()`** -- paintTemplatesLayout, paintDeckVideo,
  paintEditorLayout, twenty of them. The watermark row was the ONLY one left to
  a MutationObserver instead, which is why it was the only one that flickered.
  It is in the list now.
- **Reacting to the removal cannot win during a drag, and this is the general
  lesson.** The drag repaints once per frame; an observer's re-attach is
  scheduled from inside that frame's callback, so it lands in the NEXT frame --
  and that frame's drag repaint removes it again. The row alternates
  present/absent for as long as the drag lasts. Measured: **12 of 12 drag
  renders ended with no row** before, **0 of 12** after.
- **Only a DRAG reproduces it.** A bare `paintStudio()` leaves the row alone --
  0/5 either way -- because the subtree is only replaced when the render output
  actually differs, and it is the drag state (`dragKind`, `dragPreview`, the
  grabbing cursor and outline) that changes it. An earlier measurement that
  called paintStudio without drag state said the bug was fixed when it was not.
  Set `StudioAdapter.ui.dragKind`/`dragPreview` to reproduce.
- Calling it at the END of the render is safe; calling it FROM the observer is
  not. The observer is delivered part-way through the render, so a row inserted
  there is wiped by the innerHTML write that follows and never returns at all
  (v3.53.3 notes). The end of paintStudio is after the render has finished.
- **Any future host-injected panel belongs in paintStudio's list**, not on an
  observer. The observer stays as a backstop for renders that do not go through
  paintStudio.

## The watermark row sits in the left column, not across the screen (v3.53.6)

Youssef: "move the water mark on the top of the left side box not the top of
the screen."

- It was injected as a sibling of the toolbar, so it spanned the full 1052px
  content width above BOTH columns. It is now the first child of the left
  column, directly above Style, where the setting it changes actually lives.
- **The mount is `container.querySelector('section')`, not a class.** The left
  column is the first `<section>` under the screen container and the toolbar
  has none, so this finds it without naming a generated class -- the design
  export regenerates every hashed class name on re-import, which is the whole
  reason this row is host-rendered in the first place.
- **`flex:none` is load-bearing here.** The column is a flex container with its
  own scroll, so a child that does not declare it is shrinkable and gets
  squeezed by the cards below -- the same trap the Performance screen hit
  (every direct child of a scrolling flex column needs it).
- Re-seating is idempotent and self-correcting: a render that replaced the
  column leaves the old node orphaned, so the paint checks parent AND position
  rather than trusting the node is still where it was put.
- Verified at 1440x900 and through 12 simulated drag renders: first child every
  time, 0 renders ending with no row, 0 renders where it moved.

## AI titling: the model was never told who was speaking (v3.54.0, 31 Aug 2026)

Youssef: "ai titleing, its not good at all use youtube if you want to learn how
to title". Looking at what actually ranks for "islamic lecture" on YouTube, the
titles that travel almost all carry the SPEAKER'S NAME -- "Never lose hope in
the Mercy of Allah - Muhammad Hoblos" (836k views), "Prophet's Vision: The
Future of The Ummah - Belal Assaad" (114k), "Life's Trials Are Like Pinches ... -
Omar Suleiman" (34k). In this niche the scholar IS the search term.

- **`refine_with_ollama` was given the clip transcripts and NOTHING else.** The
  lecture's own title -- the only field in the entire job that contains the
  speaker's name -- was never passed in, so the model could not have named them
  if it wanted to. It is passed now, fenced as data (invariant 2: it comes from
  a YouTube title a stranger wrote).
- **It must never invent a speaker.** With no lecture title the prompt says so
  explicitly. Attributing words to a scholar who did not say them is the worst
  failure available on this product -- worse than a dull title -- and a model
  asked to "name the speaker" will happily guess one.
- **`temperature: 0.1` was writing the ranking AND the prose.** Near-greedy
  decoding is right for a ranking and wrong for writing: it makes every title in
  a batch come out the same shape, which is what "the titles are not good"
  actually looks like across a finished lecture. Now 0.6. The ranking can afford
  it -- the AI score is blended 45/55 with the heuristic, so it stays anchored.
- **The prompt now bans batch sameness outright**: no two titles may open with
  the same construction. Four shapes are offered instead of one register, with
  the plain warm promise named as the strongest -- it is what the 836k title is,
  and it is not clever.
- **"The verse that stops the scroll" was offered as a GOOD example and is
  gone.** Referencing scrolling, watching or the algorithm is a register this
  content should not borrow.
- **The new tests build the real prompt and read the bytes that would go to
  Ollama**, rather than grepping the source. Proven red against the old prompt
  before being kept. The existing source-string test broke on this change twice
  -- once on rewording, once because the sentence straddles two string literals
  and is not contiguous in the file. That is the weakness CLAUDE.md already
  names; the new file does not have it.
- **NOT YET LIVE.** This is `worker/` and the box is manual. Titles do not change
  until someone deploys it.

## The watermark row looked bolted on, and that was measurable (v3.54.1)

Youssef, after the move: "try again".

- The position was right and the drag held; what was wrong was the LOOK, and it
  did not need an opinion to find. Measured against its neighbours: the row
  carried a 1px border and a background while the Style and Brand groups below
  it have `0px` border and a transparent ground, and it stood 112px tall next
  to their single-line rows. It was the only boxed thing inside the panel.
- It is now the same shape as those groups -- a grey letter-spaced section
  label, then a row whose control sits right, then one muted line of
  explanation. 112px -> 74px, border and background gone.
- **The label is grey, not gold.** Gold is the accent the panel spends on
  values and the brand mark; a gold section label made this one group shout
  over STYLE, BRAND and CAPTION TEXT beside it.
- Rewriting the innerHTML rebuilds the checkbox, so the save path was re-proven
  rather than assumed: toggling wrote `watermark: DEENCLIPPED` and
  `watermarkOpacity: 100`, the label repainted to match, and the template was
  still called "Clean Line" -- the rename bug from v3.51.0 stays fixed.
- Re-checked after the restyle: 12 drag renders, 0 ending with no row, 0 where
  it moved, still the column's first child.

## The titling model invented a Companion of the Prophet (v3.54.2, 31 Aug 2026)

The v3.54.0 prompt was tested against the box's real qwen3:1.7b rather than
only unit-tested, and two things it did on real transcripts could not have been
found any other way.

- **It copied an example title verbatim onto an unrelated clip.** The prompt
  offered "Why does my dua feel unanswered?" as a good SHAPE; the model put it
  on the clip about honouring your mother. A 1.7B model treats a concrete
  example as a template. The four shapes are now DESCRIBED, never demonstrated,
  and the prompt says outright that every word must come from this clip.
- **With no speaker in the lecture title it invented one: "Abu Huraira",** a
  Companion of the Prophet, credited on a modern khutbah, on all three clips.
  The prompt forbids inventing a speaker in plain words. **A small model does
  not reliably obey a negative instruction**, so the rule is enforced in code:
  `strip_unbacked_attribution()` drops a trailing "- Name" the lecture title
  does not actually contain. It fails towards dropping the credit -- a name
  spelled differently from the lecture title is stripped rather than trusted --
  and an ordinary dash ("Repentance - why it never stops") is left alone
  because the trailing fragment must look like a name before it is treated as
  a credit.
- **No real scholar's name appears anywhere in the prompt now**, for the same
  reason the example titles went: a model that lifts an example phrase would
  attach one scholar's name to another's lecture. A test asserts the guidance
  contains none.
- Measured after both fixes, same four transcripts, real model: with a speaker
  in the lecture title all four titles carried it and each described its own
  clip; with none, no name was invented.
- **The production model is `qwen3:1.7b`, not 4b** (`OLLAMA_MODEL` on the box).
  It also drops roughly one candidate in four -- `ollama_partial_scoring` fired
  on most runs -- so those clips keep heuristic scores and transcript-head
  titles. Worth revisiting; 4b is already pulled on the box.

## qwen3:4b is refused, and the titling bug was never the model (31 Aug 2026)

Asked to decide between qwen3:1.7b and qwen3:4b for titling. The answer is
**stay on 1.7b**, and the reason is memory, not quality:

- The box has **3.7G total**, and `worker/docker-compose.yml` caps the Ollama
  container at **2G**. qwen3:4b is **2.5G** and cannot fit.
- This is not theoretical. `dmesg` still holds **five llama-server OOM kills**
  from 22-23 Aug, resident **2.4-3.0G** each -- exactly the 4b footprint. The
  compose comment records forty-two more before the caps existed, "some of them
  mid-job". A 4b call from this session simply timed out.
- Open item 5 (the CPX41 rescale) is what unlocks 4b. Until then it is not a
  preference, it is a job-killing OOM.

**But the model was never the main problem.** Measured on the box:

- Ask 1.7b for 24 rows and it returns **4**. Ask for 12, still 4. Ask for 6, it
  returns 5. Ask for 2, it returns 1. `done_reason` is "stop" and `eval_count`
  ~490 against a 4096 budget, so nothing is truncated -- **it closes the array
  early**, and what comes back is always a PREFIX, never a gap in the middle.
- The shortlist was 24. So **twenty of twenty-four clips kept heuristic scores
  and transcript-head titles**. "The AI titles are not good" was mostly "there
  was no AI title": five clips in six never got one.
- Fixed by asking in **batches of 4 over a shortlist of 12** (`AI_BATCH`,
  `AI_SHORTLIST`) and merging. Indexes are LOCAL to each batch and mapped back
  through an offset -- asking a 1.7B model to answer with index 17 of 24 is the
  bookkeeping it is worst at. Measured after: **8 of 8 titled, no partial
  warning, 75s** for three requests, against 4 of 24 before.
- A failure is caught **per batch**, not per run. Previously a third-request
  failure abandoned the function while the first two batches had already
  written blended scores -- leaving the ranking a silent mix of blended and raw
  heuristic numbers, which are not the same measure.

**Two things the prompt could not fix, now enforced in code.** Both were found
by running the real model, not by reading:

1. Told the title must be "a full phrase of at least five words", it returned
   the clip's **own first sentence verbatim**. Told nothing, it returned bare
   topic names ("Repentance"). `looks_copied()` rejects a title whose first six
   words appear in the transcript, and the clip falls back to the transcript
   titler, which at least strips filler openers and trims on a word boundary.
2. With no speaker in the lecture title it **invented "Abu Huraira"** -- a
   Companion of the Prophet -- and credited a modern khutbah to him, on every
   clip. `strip_unbacked_attribution()` drops a trailing "- Name" the lecture
   title does not contain.

**A 1.7B model does not reliably obey a negative instruction.** Anything that
must not happen belongs in code. Titles from it are clean and correctly
attributed but terse; that is its ceiling, and the rescale is what raises it.

### The deploy check was verifying a model nothing uses

`worker/verify-deploy.sh` said `${OLLAMA_MODEL:-qwen3:4b}`. `OLLAMA_MODEL` is
set inside docker-compose.yml **for the container**, not in the deploy shell, so
the default always won -- and because 4b happens to be pulled, every deploy
printed a confident "clip AI: qwen3:4b loaded OK" while saying nothing about
the model that actually titles clips. It reads `OLLAMA_MODEL` out of the running
worker now, so it checks what runs.

### The version guard had been passing without looking

Two failures, both real, both fixed in `scripts/check-version-bump.mjs`:

1. **It ran blind on a shallow checkout.** CI used `fetch-depth: 2`, so on a
   merge or a multi-commit push `HEAD^` is not the change's logical parent --
   a commit that rewrote `worker/clip_worker.py` was reported as "no src/ or
   worker/ changes" and sailed through. Depth is 60 now, and the script REFUSES
   rather than passing when the clone is shallow and the diff looks empty.
2. **It only looked one commit back**, so two commits could each bump from
   their own parent and both claim the same number -- which happened, two trees
   both called 3.54.1. The version must now be new across the last 60 commits.
   That number is what the worker deploy compares the running container against,
   so a duplicate makes "3.54.1 is live" mean nothing.

### The batching fix had two defects of its own (v3.58.1)

Both found by adversarially reviewing the change rather than by using it, and
both reproduced by running the code. Written down because the first is a trap
anyone tuning this will fall into again.

- **Shrinking the shortlist below the deliverable count inverts the ranking.**
  Only shortlisted candidates get the blended `0.45*heuristic + 0.55*ai`;
  everything outside keeps its RAW heuristic. The blend can only LOWER a
  candidate the model scored below its heuristic, so with a shortlist of 12 and
  20 deliverable, all twelve blended scores fell beneath the eight the model
  never read -- and **0 of 8 delivered clips carried an AI title**, which is the
  exact symptom the change existed to fix. Silent, too: the partial-scoring
  warning compares `len(applied)` against `len(shortlist)`, and 12 of 12 reads
  as complete. `AI_SHORTLIST` is 24 now and `MAX_DELIVERABLE_CLIPS` records why
  it may never drop below 20. The "8 of 8 titled" measurement missed this
  because all 8 fitted inside the shortlist.
- **The attribution guard failed OPEN on Arabic name particles.** It required
  every token to begin with an ASCII capital, so "ibn Uthaymeen", "Sheikh ibn
  Baz", "Abdullah al-Andalusi" -- and "Ismail ibn Musa Menk", Mufti Menk's own
  full name -- were all read as "not a credit" and kept. An invented one would
  have shipped. The test is now at most four words with at least one capital,
  which errs towards stripping: losing a title's tail costs a few words, keeping
  a false attribution puts words in a scholar's mouth. A hyphen inside the name
  also stopped the pattern matching at all, so it splits on the last spaced
  separator now.

## Clip selection scores the industry rubric, and the titling holes are plugged (v3.75.0, 1 Sept 2026)

Youssef: "heavily improve clip selection ... twenty, thirty, forty, fifty,
sixty times better ... has to be Islamic related content ... and then also the
titling". Researched first (OpusClip's virality model -- hook/flow/value/trend
-- and the retention literature: the first three seconds decide, the shape is
hook -> body -> payoff), then measured against the box's real model.

- **`score_candidate` is rebuilt around hook / payoff / standalone clarity /
  value**, computed from the transcript and its timings -- nothing invented.
  New signals, each with a reason string the review deck shows: question or
  story openings, bold claims, direct address, a payoff ending (imperative or
  takeaway marker), an asked-and-answered arc, a weighted pause before a heavy
  word, and CONTEXT-DEPENDENT openings ("as I said", "the second thing")
  penalised hard -- a clip leaning on words the viewer never heard cannot stand
  alone, whatever its punctuation says.
- **"Allah" is not a hook.** The old flat HOOKS list scored it as one, and it
  appears in nearly every sentence of an Islamic lecture -- a signal that fires
  everywhere ranks nothing. The vocabulary is TIERED now: ubiquitous words
  (allah, quran, prophet...) are nearly free, capped +3 total; the stakes
  vocabulary (death, jannah, repentance, mother, dunya...) carries the weight.
- **Distinctiveness comes from the lecture itself**: `build_candidates` counts
  every content word once across the lecture and passes `lecture_freq` in; a
  window rich in words the lecture rarely says is that lecture's MOMENT, not
  its wallpaper, and scores +8. Degrades gracefully to None.
- **The prompt's SCORING section is an explicit rubric** (hook 0-40 from the
  first sentence alone, payoff 0-30 from the ending, standalone clarity 0-20
  with a hard cap of 45 when it leans on context, value 0-10) instead of
  "score how good it is". The pinned scripture sentence stays in ONE literal --
  splitting it across two broke the source test once already.
- **A live A/B on the box found two more failures, both now code-enforced**
  (the standing lesson: qwen3:1.7b does not obey negative instructions):
  1. **It handed the lecture's own title back as a clip title** ("The Door
     That Never Closes - Belal Assaad", verbatim from the lecture title it was
     given). `echoes_lecture_title()` discards a title whose line -- judged
     BEFORE the speaker credit, because naming the speaker is what the lecture
     title is passed in for -- appears as a contiguous run of 3+ normalised
     words inside the lecture title. Falls back to the transcript titler.
  2. **Even a batch of four came back with ONE row** (the early-close, again).
     `AI_RETRY_SINGLES` (8): rows the batches never answered are re-asked ONE
     AT A TIME -- the one size never seen to truncate -- highest heuristic
     first, only while the model is answering at all (a dead box must not
     become a dozen more 180s timeouts), and capped so a bad day costs
     minutes. `ollama_partial_scoring` now means "even the retry could not
     fill it".
- **A source-reading trap, hit twice in one session**: AyahFaceTests locates
  quran_font's fallback list by splitting on the file's first candidate-loop
  literal. A new loop OR A COMMENT containing that literal upstream breaks it.

## The import says how many MB have landed (v3.75.4, 1 Sept 2026)

Youssef, watching a job sit on "importing · 0% of this step" while ffmpeg had
741MB of it on disk: "can you show the mb for example xx / xx so people know
and put it next to the ETA."

- **Everything downstream existed already and had never been fed.** The
  service's pulse turns byte counts into `bytesDone`/`bytesTotal` and a real
  step percentage; local-engine copies them; /api/state sends them; the
  adapter renders them beside the ETA. But the yt-dlp `progress_hook` called
  the bare `cancelled()` and threw its own byte counts away -- so the entire
  chain sat dark on the one path production takes.
- **A section download has NO hook to fix.** yt-dlp hands ranged downloads to
  ffmpeg, which runs as a black box firing no per-byte hooks -- verified live
  on the box: pid 2551 was ffmpeg writing source.mp4.part with the job's
  progress at 0. A watcher thread now reports the on-disk size (summing every
  stem-sibling: .part, per-format .fNNN.part, the merged file) every 2s, with
  NO invented total -- the app prints a bare "623 MB", which is honest, and
  its transferLabel supported exactly that all along.
- **The watcher yields to the hook.** Both feed one pulse; alternating the
  hook's per-file figure with the watcher's on-disk sum makes the number jump
  around. The hook stamps `hook_spoke` whenever it carries bytes and the
  watcher stays quiet for 6s after. It also never acts on cancellation -- the
  main thread owns raising out of yt-dlp, and two owners of one cancel race.
- **The label is "412 MB / 806 MB"** (his wording), was "of". One test pinned
  the old join and moved with it.
- The watcher is stopped in a `finally`, or an import that raises would leave
  a daemon thread statting a deleted directory for the life of the container.

## The live surfaces show the pipeline, not a percentage in the dark (v3.76.0)

Youssef: "make a massive improvements, looks, layout and more for happening
now bar on home page AND the happening bar in other tabs when floating".

- **Both surfaces now draw the pipeline itself**: Import · Transcribe · Score
  · Render · Upload as a station strip -- done stations hold their gold, the
  current one pulses, the rest wait unlit. On Home the stations carry labels;
  the floating bar's head shows the same strip as dots alone
  (`stageStripHtml(idx, compact)`, labels in `<em>` so one builder serves
  both). `stageIdx` comes from the adapter (`liveStageIdx`): the worker's own
  phase for the first four, and the global percentage past the render band
  for upload, which has no phase. A queued job is -1 -- strip drawn, nothing
  lit -- and single-stage jobs (edits, more-clips, publishes) get null and no
  strip.
- **stageIdx is part of liveKey**, so a stage handover repaints the strip --
  four rebuilds a job, nothing. The in-place update path is untouched, and
  the meta selector grew `:not(.slh-stages)` in BOTH the CSS and paintRows,
  because the strip is also a span inside `.what`.
- **Running before waiting.** jobsLive sorted by time alone, so a queued job
  submitted a minute ago took the floating bar's headline off the lecture
  actually rendering. Running jobs lead now, newest first within each group.
- **A queued job says nothing instead of "0%"** -- a percentage on a job that
  has not started reads as stuck.
- **The looks**: the Home card wears a quiet gold ring and warm ground while
  anything runs and settles to the plain site card when idle (both states
  pinned by test); the header is small-caps with the count as a gold chip;
  rows lead with a 32px warm icon tile; the track is 4px. The floating bar
  gets the gold hairline, a slide-up entry (`slbIn`, killed under reduced
  motion), a 3px fill, and collapses into a fully-rounded pill. The idle card
  carries a clock and "Paste a lecture above and the pipeline lights up
  here." All states screenshotted at desktop before shipping; the tour veil
  and the timer-reseed traps both bit again and are already documented above.

### The reason field was babble about the packaging (v3.76.1)

First real lecture through the v3.75.0 scorer surfaced it: the prompt never
said what "reason" was FOR, so qwen3 filled it with commentary on the title it
had just written -- "The title is concise, uses the hook..." -- and since the
reason is prepended to the clip's reasons, the review deck led with that while
the genuine heuristic reasons ("question opening") sat behind it. The prompt
now defines the field (about the MOMENT, never the packaging), and because a
negative instruction is a suggestion to this model, packaging words
(title/description/hashtags) are dropped in apply_clip_rows -- the heuristic
reasons underneath always remain.

## The template preview drew a watermark the export did not carry (v3.76.6)

Youssef, 2 Sept 2026, looking at Quran Recitation with the switch already off:
"once water mark is unticked it should remove water mark of course."

- **The exports were always clean.** `write_ass` draws the mark under
  `if watermark:`, and the Quran template ships `watermark: ""` with opacity 0,
  so nothing was ever burned in. This was the PREVIEW lying -- invariant 4 by
  another door, and the more dangerous direction of the two: it teaches a
  customer that a paid feature does not work, and it drew a mark over
  scripture on the one template forbidden to carry one.
- **The mark node is a LITERAL "DEENCLIPPED" in the design export** with
  `markStyle` its only control, and markStyle set position, colour and size
  and nothing else -- so the frame drew a watermark for every template
  whatever was saved. The EDITOR's own preview (`edMarkStyle`) has carried
  `display: none` on zero opacity since it was written; this frame never did.
  Fixed in the binding, so it cost no design re-import.
- **`markIsVisible` asks the same question `templates.visibleText()` asks**,
  NO_INK regex included, because the two must agree: a watermark of one
  zero-width space renders as nothing, and a preview drawing DEENCLIPPED for
  it is the same lie the v3.51.0 paywall hole was, pointing the other way.
- Proven RED against the old binding before being kept, then driven in a
  browser: ticked -> mark visible, unticked -> `display: none` and 0 nodes on
  screen, re-ticked -> back, and the template still called "Clean Line" (the
  v3.51.0 rename bug stays fixed). Quran Recitation selected with the real
  dropdown shows no mark over the ayah.

### The connectors travel, and the clip list slides (v3.76.9, 2 Sept 2026)

Youssef: "those little lines in between each stage they should have a swipe or
fill up moving right animation in between each stage. also when opening for
example 4 of 5 clips and closing should have an animation too."

- **Two connector states, both derived from one index.** line[i] sits between
  station i-1 and station i, so line[idx] is the one just travelled (`fill` --
  a gold ::after scaling in from the left as the stage lands) and line[idx+1]
  is the one being travelled now (`live` -- a gold sweep running rightwards,
  `dcStFlow`, infinite). A queued job is idx -1 and gets neither: nothing lit
  and nothing moving, which is the honest picture of a job that has not begun.
- **The gold is an ::after over a dim track, and that is load-bearing.** A
  `.done` line painted directly could not scale its fill in from the left
  without also scaling the track. Also: `backwards`, never `both` -- the house
  rule this file has now paid for three times.
- **The compact strip in the floating bar keeps the states and drops the
  motion.** Its connectors are 8px; a 1.5s sweep across that reads as a
  blinking dot rather than travel. The pulsing current station already says
  the job is live.
- **The expand/collapse animates only because the list stopped being
  conditional.** `clipsAreOpen` was in `liveKey`, so every toggle REBUILT the
  row -- the list appeared and vanished with no previous state for a
  transition to move from. The list is always rendered now and only
  `data-open` switches, driven from paintRows' in-place path; the node
  survives, so `grid-template-rows: 0fr -> 1fr` transitions in BOTH
  directions. That is the one way to animate to a height nobody measured, and
  it needs `min-height: 0` as much as `overflow: hidden` on the grid child --
  a grid item's automatic minimum size is its content, which would hold the
  row open at 0fr. The test that demanded the opposite was rewritten rather
  than deleted; its "no moving number in the key" half still stands.
- **Verification trap, and it is the rAF one from a new angle:** a hidden
  Browser pane does not composite, so a running CSS transition FREEZES at its
  start value. Sampling heights across the toggle read a flat 244px seven
  times and looked exactly like a transition that never ran. Proven instead by
  disabling the transition and measuring the two end states (0 and 244), then
  reading `document.getAnimations()` for a real CSSTransition on
  `grid-template-rows` -- and finally by pausing that transition at 45% and
  measuring 28px. Do not trust a wall-clock animation measurement taken
  against a pane that is not on screen.


## The Quran matcher walks the recitation instead of searching it (v3.77.1)

Youssef, 2 Sept 2026: "it didnt be able to catch the quran only on like 2 out
of 5 clips and sometimes it takes a long time then catchss on mid way. if
possible also add where it the clip must start on a aya."

Diagnosed against the five clips that actually shipped from one recitation of
Az-Zumar and An-Naba, not against a fixture. **6 ayat captioned before, two of
them the WRONG verse; 13 correct and none wrong after.** Four causes, each
measured:

- **A six-word smallest window cannot find a three-word verse.** 78:31-34 are
  three or four words each and not one was ever captioned. Worse, `match()`
  refuses outright when the query is more than 1.6x the verse it matched -- a
  guard that is right for its own callers and fatal here, since the walk trims
  the window to the verse's span afterwards anyway. The walk now searches
  through `_best_position`, which has no such guard, and its smallest window
  is three words.
- **Word membership threw away every word Whisper damaged.** A word counted
  towards a verse only if its normalised form appeared in that verse, and
  Whisper is wrong INSIDE a word far more often than about the whole of it:
  "للحبطا" for "ليحبطن", "بجها لمذمرا" for "إلى جهنم زمرا". The right verse
  scored 0.37. `_fit` aligns CHARACTERS instead and scores the same verse at
  0.70. That single change is most of the recovered ayat.
- **The walk could only go forwards, and the missed verses are at the front.**
  A clip opening mid-verse gives its first ayah a partial score, so nothing
  matched until a complete verse came along -- exactly the reported "catches
  on midway". `_fill_back` walks backwards from the first verse found. Two
  adjacent verses share a boundary word, so a candidate reaching ONE word into
  the verse already placed is trimmed rather than rejected: rejecting it threw
  away 39:66 at 0.72 while keeping fragments at 0.44.
- **Recitation is sequential, so the next verse is a hypothesis, not a
  search.** After each ayah the walk tries the next few BY NAME (`LOOKAHEAD`
  3, for a verse Whisper swallowed) at a looser floor (`CONTINUE_FLOOR` 0.5).
  This is safe precisely because every position tried is a named verse in
  order; blind search keeps the strict floor, raised to 0.70 because character
  alignment lifted every score. Both wrong verses -- 23:10 for 39:63 and 27:87
  for 39:68 -- came from blind search and are gone.

**Clips now start where a verse starts** (`snap_clips_to_ayat`), which is the
same fix wearing a different hat: the look, and the detection. The ayah map is
walked ONCE over the whole lecture (`ayah_spans`) rather than per clip -- not
only cheaper but more accurate, because a clip handed to the walk in isolation
has no preceding verse to continue from. Edges move at most
`AYAH_SNAP_TOLERANCE` (12s) and never outside the configured duration band: a
clip in the wrong place is worse than one starting mid-verse. Measured on the
real lecture, 15 ayat found across it, clips 01 and 03 snapped by +0.6s and
-2.4s, and the two whose nearest verse was 22s and 37s away were correctly
left alone.

**One clip still captioned nothing, and that was honest at the time.** Its
recitation was transcribed as "وسيق الذين كفروا بجها لمذمرا حتى جا اتحت بوابها",
and a wrong ayah on screen is worse than none. The fix named here -- caption
from the LECTURE-wide ayah map rather than re-matching per clip at render time
-- **is done as of v3.101.0** (see *The renderer reads the lecture, not the
clip* below).


## The bars under a review card are that clip's own audio (v3.78.1, 2 Sept 2026)

Youssef, on the review queue: "see those gold lines it looks cool make it acc
make more sense towards the clip."

- **They were a CSS gradient.** Measured in the live DOM: nine cards, every one
  a 184x16 span with the identical `repeating-linear-gradient` -- evenly spaced
  bars that looked like a waveform and were not about anything. That is the
  invented-data fault the dashboard brief forbids, sitting on the one screen
  where a person decides what to publish.
- **The worker measures the finished clip** (`audio_peaks`): ffmpeg decodes the
  rendered file to mono 1kHz s16le, and 56 buckets take the PEAK of each. Peak
  rather than mean, because a mean over a bucket this wide flattens speech into
  a straight line. Scaled against the clip's OWN loudest moment, so a quietly
  recorded lecture still shows where its speech is. Proven on the box against
  two real clips: 56 bars in 0.1s, visibly different shapes, silence correctly
  returning nothing.
- **A decoration must never cost a render.** Every failure path -- no audio
  track, ffmpeg missing, a short file, a bad decode -- returns `[]`, and the
  card then draws a quiet baseline. `-map a:0?` is what keeps a clip with no
  audio from failing the probe at all.
- **The un-measured fallback REMOVES the gradient too.** The first cut left it
  in place, which put the invented evenly spaced bars straight back onto
  exactly the clips nothing is known about -- caught by looking at the render,
  not the code.
- **The hook is `data-dc-wave`, added to `design/studio-dashboard.dc.html`.**
  The strip's class is generated and renumbers on re-import, so naming it would
  break the next time anyone touched the design. `npm run design:import` was
  proven byte-stable first -- CSS identical, no hashed class name moved -- which
  is the same route v3.75.4 established for `data-dc-week`.
- **Matched by clip ID, never by position** -- and the first cut got this
  wrong. The same card, and the same strip, is rendered by TWO lists: the
  review queue (`queueClips`) and a lecture's own clips (`detailClips`).
  Keying off one list's order meant the lecture screen drew the queue's
  waveforms onto its cards -- the wrong clip's audio under the wrong
  thumbnail, which is the very fault this replaced. Youssef spotted it as "the
  gold line isnt really there?" on the lecture screen. The card now carries
  `data-clip="{{ clip.id }}"`, bound in the design export (byte-stable
  re-import again, CSS identical), and the painter looks the clip up by id.
- **Clips rendered before this show the baseline**, and there is no backfill:
  the peaks come from the rendered file, which lives on R2, and the web service
  has no ffmpeg. New clips carry it from their first render.
- **Dev trap, hit twice in one session:** the CSP allows the page's inline
  script by a sha256 computed AT SERVER STARTUP, so editing index.html while a
  dev server is running silently blocks the whole script -- the app renders its
  shell and never boots, with no console error. Restart the preview server
  after any index.html edit.


## Prices in the visitor's own currency, and never a converted one (v3.85.0)

Youssef, 2 Sept 2026: "fix currency for all countries auto detect", and when
asked what a UK visitor should SEE he chose real local currency over an
approximation.

- **Nothing here converts money.** A Stripe Price has one base currency and
  optionally `currency_options` holding a REAL amount in others. A price is
  shown in a visitor's currency only when Stripe holds an amount in it, and
  the checkout session is then told to charge that same currency -- so the
  number on the card and the number on the receipt cannot disagree. The
  alternative, converting at some rate of our own, is the exact fault the note
  above the price labels in config.js has always warned about: advertising one
  price and charging another.
- **The country comes from the edge, not from the visitor.** `cf-ipcountry` is
  added by Cloudflare, which sits in front of Render for this domain, and
  cannot be forged by a caller. Cloudflare's "unknown" answers -- `XX` and the
  Tor `T1` -- are treated as no country at all, because guessing from them
  would be worse than the default.
- **Accept-Language is deliberately NOT used.** A browser set to en-GB in
  Sydney is ordinary; charging that person in pounds because of a display
  preference would be a billing error made on the strength of a setting that
  says nothing about where they are.
- **`currencyDisplay: 'symbol'`, never `'narrowSymbol'`.** Narrow strips the
  country prefix, so the Australian dollar comes out as a bare "$" and is
  indistinguishable from the American one -- two products at "$29" in
  different dollars is how a chargeback starts. This keeps A$, CA$, NZ$.
- **Zero-decimal currencies are not divided by a hundred.** Stripe quotes every
  amount in the smallest unit, and for the yen that IS the whole unit;
  dividing would advertise a price a hundred times too small, and somebody
  would buy it.
- **The public pages never wait on Stripe.** They render synchronously and are
  the most visited thing here, so `plansInCurrencyCached` reads only what is
  already cached and warms the rest behind the render. The first visitor from
  a new country sees AUD; nobody waits on a network call to see a price.
  Every failure path -- no key, unknown price, Stripe down -- leaves the
  configured labels standing.
- **It shows AUD everywhere until Stripe holds another currency.** That is a
  dashboard action on the account (Adaptive Pricing, or currency_options on
  each Price), and it is the whole point of reading the amounts from Stripe:
  the moment they exist, this works with no further code.
- **The marketing pages and their JSON-LD are deliberately still AUD.**
  Structured data has to match visible content, so localising the cards means
  localising the offers, which changes what Google indexes; that is an SEO
  decision worth making on purpose rather than as a side effect, and it would
  show nothing different today anyway.


### Adaptive Pricing was already on, which changes what was left to do (v3.86.1)

Checked in the Stripe dashboard on 2 Sept 2026 rather than assumed, and the
assumption in the entry above was wrong in the useful direction: **Adaptive
Pricing is already enabled** on the account (Settings -> Payments -> Adaptive
Pricing; "Payment Links and Managed Payments: Always on", the Checkout toggle
on, supported currencies listed for all six continents). So a customer in any
country ALREADY sees and pays their own money at Stripe Checkout. There was
never a toggle waiting to be flipped.

What Adaptive Pricing does NOT do is populate `currency_options`, which is
what the pricing pages read. So the gap was only ever the DISPLAYED price, and
it is closed the honest way: a visitor whose currency is not AUD is told, in
one line under the period switch, that prices are quoted in Australian dollars
and that Stripe will charge them in their own currency at checkout. No figure
is converted -- the rate belongs to Stripe and is applied at Checkout, so any
number printed on a marketing page would be a promise the checkout does not
keep. Nothing is said to an Australian visitor, or to one whose country could
not be read.

Exact local AMOUNTS on the page still need `currency_options` set per price in
Stripe, which is per-price manual work rather than a toggle. The code for it
shipped in v3.85.0 and activates itself the moment those amounts exist.

**The config price labels are stale fallbacks, not what customers see.** The
defaults in config.js still read A$9 / A$29 / A$290 while Stripe holds A$9.99
and A$29.99 -- production overrides every label through `PLAN_PRICE_*` env
vars, and the live page and Stripe agree. Do not "fix" the config defaults
against Stripe without checking the env first; they are two different things.


### Setting the per-price currency amounts (scripts/stripe-currency-options.mjs)

Adaptive Pricing converts at the LIVE rate and needs no maintenance;
`currency_options` are FIXED amounts that drift and are yours to revisit. That
trade is why the script covers five major currencies (USD, GBP, EUR, CAD, NZD)
and lets Stripe keep converting everything else automatically. Adding fifty
currencies would be fifty amounts per price to maintain for ever.

- **Dry run by default.** It reads every price and prints what it would write;
  only `--apply` writes anything.
- **The key is read from the environment and never printed**, so it stays on
  the machine that runs it and out of any transcript.
- **It refuses when Stripe's base amount does not match its table.** Every
  converted figure is derived from the Australian price, so a price that has
  since changed makes all five wrong -- better to stop and say so than to write
  a set of numbers built on a stale one.
- Amounts were converted on 2 Sept 2026 and rounded UP to the local .99
  convention, so no currency ends up cheaper than the Australian price.
- The pricing pages pick the new amounts up within ten minutes (the price
  cache in billing.js), and the checkout then charges the same currency it
  showed.


### The currency amounts are set, and the public pages show them (v3.87.1)

Run on 3 Sept 2026 from the Render shell: `node scripts/stripe-currency-options.mjs`
then `--apply`. **Wrote 9 prices, 0 skipped, 0 failed**, and verified in the
Stripe dashboard rather than trusted from the exit code -- the monthly price
now lists CAD CA$29.99, EUR EUR18.99, GBP GBP15.99, NZD NZ$36.99 and USD
US$21.99 beside its A$29.99 base.

With real amounts in Stripe the public pages stopped needing the "prices are
Australian" note and started showing the money itself:

- **`pricingCards` reads `plansInCurrencyCached`**, so every card is Stripe's
  own amount for that currency and falls back to the configured label where a
  currency is not configured. The note is suppressed once the cards are
  localised, because it would then be false.
- **The JSON-LD offers read the SAME source.** Structured data has to describe
  what the page shows; a visitor served GBP15.99 with an offer claiming 29.99 AUD
  is a mismatch Google is entitled to distrust the whole page over. A crawler
  arrives from somewhere like everybody else, and now sees a page and a schema
  that agree.
- The test drives a stubbed Stripe through the real page and asserts the card,
  the note's absence and the schema offer all agree on GBP15.99.

**Five currencies are configured; every other country is still converted by
Adaptive Pricing at Checkout.** So the pages show AUD to, say, an Indonesian
visitor and Stripe charges IDR -- which is why `currencyNote` stays for the
un-localised case rather than being deleted.


### Verified from overseas, and the drift now alerts itself (v3.88.0)

**The spot check was done, not deferred.** Fetching production through one of
the box's own Webshare residential proxies gives a genuine foreign IP, which is
the only way to test this from Australia -- Cloudflare sets `cf-ipcountry` from
the real address, so no header can fake it. Through a US exit,
`/pricing` renders `<div class="plan-price-label">$21.99</div>` and its schema
offer says `"price":"21.99","priceCurrency":"USD"`. The Australian figure
appears zero times on that page. Page and schema agree, on production.

The FIRST request from a new country still shows AUD -- that is
`plansInCurrencyCached` warming behind the render, exactly as designed, and it
was visible in this test as a first response carrying the note and the second
carrying the prices.

**Drift alerts instead of waiting to be remembered.** `currencyDrift` compares
every configured `currency_option` against the live rate and reports anything
more than 10% out; `server.js` runs it daily through the same `alerts.report`
ledger the worker check uses. It REPORTS and never reprices: what a customer
pays is a decision a person makes, not something a timer does at 3am on a rate
it happened to fetch -- a bad rate would otherwise rewrite every price in the
account. The mail names the drift and the two commands, and a test asserts the
timer carries no Stripe write and calls nothing but the read-only report.
A rates lookup that fails produces no alert rather than a false one.


## Light mode beyond the phone: measured, not yet built (3 Sept 2026)

Youssef: "make the light mode for desktop and other devices as well not just
mobile". Measured before starting, because the shape of this decides whether it
is an afternoon or a project:

- **The phone's light mode does not generalise.** It lives entirely inside one
  `@media` block in studio-mobile.css and reskins the PHONE SHELL -- host-drawn
  `dcm-*` classes that studio-mobile.js writes. The desktop has no such shell:
  it is the generated design export.
- **The generated CSS has no CSS variables at all.** 91KB of literal hex, and
  it must never be hand-edited -- a design re-import regenerates it. So a
  desktop light theme cannot be a few overrides; it needs a light sheet
  GENERATED from the same source at import time, mapping each dark neutral to
  its paper counterpart under a `body.dc-light` prefix.
- **13% of the elements on Home carry an inline colour** (35 of 272, measured
  in the browser), and a stylesheet cannot reach an inline style. Those come
  from ~850 hex literals across studio-adapter.js and index.html. They have to
  become `var(--dc-…)`, which works fine in an inline style, or every dynamic
  chip, bar and pill stays dark on paper.
- **The palette that has to move is small**: twelve neutrals
  (#0E0E11 #101013 #121214 #17171A #1E1E22 #26262A #34343A #6E6E76 #8B8B93
  #BCBCC3 #E9E9ED #F2F2F4). The gold and the semantic colours stay -- the phone
  proves gold reads as ink on paper.

**Built in v3.90.0.** Two generators and a token layer:

- `scripts/theme-palette.mjs` is the ONE definition of what a colour becomes in
  daylight, shared by both generators so the sheet and the tokens cannot drift
  into two different tans and show a seam down the screen. Twenty-odd named
  colours (taken from the phone's paper theme, so the surfaces are one product)
  and an algorithm for the long tail: a neutral has its lightness inverted and
  warmed; a WARM light tone keeps its hue and darkens; a saturated colour is
  left alone, because red still means failed and green still means posted.
- `scripts/build-light-theme.mjs` reads every studio sheet -- the export AND
  the hand-written ones -- and re-emits each rule that sets a colour, prefixed
  `body.dc-light`. Processing only the export left Help and Owner dark, since
  those screens are drawn almost entirely by their own sheets.
- `scripts/build-theme-tokens.mjs` rewrites the colours in INLINE styles to
  `var(--dc-n-…, #hex)` and emits their two values. A stylesheet cannot reach
  an inline style, and 13% of elements carry one. It is IDEMPOTENT: it counts
  the var() references already in the files, because emitting only what it
  found on a second run dropped every variable the first run had defined.
- The theme class goes on `<html>` AND `<body>`. A variable that references
  another (`--bg: var(--dc-page)`) is substituted where it is DECLARED, so
  overriding tokens only on body left the page ground night while the app lit.
- **The stage stays night**, the call studio-mobile.css made first: the 9:16
  preview and the caption sample keep a dark ground, because a caption is white
  text meant for video and lighting the frame behind it both hides it and shows
  a preview that disagrees with the render (invariant 4). Found by `:has()` on
  the host-rendered ids, never a hashed class.

Traps paid for on the way: the theme-color META cannot take a `var()` -- the
browser reads it as a colour name and paints nothing -- so the tokeniser now
skips meta content and setAttribute('content'); and the CSP inline-script hash
is computed at server start, so every index.html edit needs a preview restart
or the app renders its shell and never boots.

Verified by measurement, not by eye alone: a contrast sweep over eleven screens
reports zero pale-text and zero dark-ground elements, the two exceptions being
the deliberate stage and a marker that is faint on purpose in both themes.
Dark was re-checked after every step and is unchanged -- every literal is kept
as the var() fallback, so a browser that never loads the token sheet renders
exactly what it rendered before.


### The Daylight switch rendered and did nothing (v3.91.1)

Youssef, on the live app: "cant click". He was right, and it was not a UI
fault: `case 'theme'` sat inside a hunk that a rebase conflict resolved to
UPSTREAM, so the Appearance ROW survived and the one line that handles its
click did not. The switch was real, the handler was gone. This is exactly the
failure this file has warned about since August -- "each hand-merge is a chance
to silently undo the other side's change" -- and it reached production because
nothing asserted the wiring. A test now pins the whole path: the row renders,
the dialog dispatches `theme`, and the handler exists.

**Verification trap, worth writing down:** the browser-automation click stopped
reaching the page entirely -- a real `left_click` produced ZERO click events at
a document-level capture listener, while the element was topmost at those exact
coordinates. Do not read that as "the control is broken". Dispatching a real
bubbling MouseEvent on the element exercises the same path a user's click takes
through the DOM (target -> delegated handler on the dialog body) and settled it
in one call.

**Report a bug moved out of the account menu and into Help**, at his request.
It opens the DIALOG rather than a mailto, because the dialog carries the
release, screen, account and browser and a report without the version cannot
be acted on. `openBug` had to be window-pinned: paintHelp lives in a DIFFERENT
inline script scope in index.html, so the scoped function threw at click time
rather than at load -- the third feature in this file to hit that trap. The
now-unreachable menu injector was deleted rather than left as dead code.


## A scheduled clip can be dragged to another slot (v3.92.0, 3 Sept 2026)

Youssef: "on shedule add reagrangments so you can move things around, so you
can hold the box then move it and it swaps or it moves to new location ...
should be for weekly and daily not monthly cause it doesnt make sense."

- **The swap is ONE server call**, `agent.moveClipToSlot`. As two -- free the
  target, then move -- a drag can strand a clip: move A onto B's slot first and
  B is homeless; free B first and A's old slot is open for the scheduler to
  hand to somebody else. Both writes happen after every check with nothing in
  between.
- **Month is deliberately excluded**, as asked, and the reason is worth keeping:
  a month cell is a whole DAY holding up to eight posts, so a card dropped on
  one says nothing about which slot is meant. Inventing an answer would move a
  clip to a time nobody chose.
- **Refusals the server owns, not the browser**: a slot already passed, a clip
  already posted or mid-publish (in EITHER direction -- it cannot be dragged,
  and it cannot be displaced by something dropped on top of it), a clip with no
  slot, and anything belonging to another account, which is not swapped but
  simply left alone. Ten tests, each naming the case.
- **Pointer events, not HTML5 drag-and-drop**, so the same code works for a
  finger; and a 5px threshold means an ordinary click still opens the day. The
  ghost is `pointer-events: none` or `elementFromPoint` returns the ghost
  instead of the cell being aimed at.
- **Bound to `[data-slot]`**, an attribute added to the design export (proven
  byte-stable first, CSS identical), carrying the instant and the clip id. The
  host never works a cell's identity out from its position in the grid -- the
  mistake that once put one clip's waveform on another clip's card.
- Driven in a browser rather than assumed: ghost appears, target rings gold,
  ghost is cleaned up, and the request goes out as
  `{"id":"c-one","at":1788562800000}` -- the clip dragged and the slot dropped
  on.


### Daylight, after looking at it on a real screen (v3.92.1)

Youssef: "not fully chnaged, also it looks too white evrything like colors are
way to light the combo might be a ltitle off."

- **A black strip across the lit calendar**, and the cause was a gap in the
  generator rather than a missed colour: `studio-tokens.css` was not in its
  source list, so its rules were never remapped -- including the week grid's
  sticky weekday header, which is a `linear-gradient(#0E0E11 …)` written by
  hand. The token and motion sheets are now processed too, with a filter that
  SKIPS `:root` and any selector already containing `dc-light`: those define
  the palette rather than wear it, and re-emitting them would remap the light
  values a second time and produce `body.dc-light body.dc-light …`, which
  matches nothing.
- **The paper was too pale to read against.** The first palette was the phone's,
  and a 6-inch screen forgives a wash that a 27-inch one does not. Ground
  deepened (#F4EFE4 -> #EFE7D8), borders strengthened (#E0D6C1 -> #D5C8AC), and
  every ink darkened a step (body #3A342A -> #332D24). Changed in ONE place:
  `theme-palette.mjs` and the token block are checked against each other by a
  probe, because a colour that moved in one and not the other is a seam down
  the middle of the screen.
- **The "+" in an empty posting slot is deliberately NOT a faithful
  inversion.** Inverted honestly it is as faint on paper as on black, but it
  is an affordance -- it says the square can be pressed -- and paper has less
  to hide behind. It is a named override rather than an algorithmic result.

## Every outcome is announced, over the top of everything (v3.103.0, 3 Sept 2026)

Youssef: "make a notification system that popup over all layouts to be clear and
shows when all settings are like turned on or off or things are posted basiclly
showing that the thing they clicked it dojng ... make it bottom right replace
the bad one we have now."

### Why the old one was bad, measured rather than reasoned about

`.toasts` in index.html sat at **z-index 80**. Everything that matters in this
app is above it: the design export's own overlays run **88, 90, 92, 93, 94, 95
and 120** (job panel, sheets, detail, player, tour, boot veil), the
connections / account / bug dialogs **200**, the tour spotlight **202**, the
confirm **240**, the billing layer **420**, the charge layer **520**, the guide
layer **9999**. So the one moment a confirmation matters most -- you have just
ticked a switch INSIDE a dialog -- was the one moment it was painted
underneath, dimmed by that layer's own scrim. Screenshotted with the tour up:
the toast is a barely-legible grey slab in the corner.

Three more faults, each visible on a real screen:

- **It went dark brown on paper.** Computed background `rgb(62,48,20)`, because
  `--surface-2` is not a themed token -- so in Daylight the notifications were
  dark slabs on a white page.
- **A setting turning ON and a clip being POSTED rendered identically**: one
  grey box, one sentence, no icon, no state.
- **The dock was `pointer-events:none` end to end**, so nothing could be
  dismissed or acted on. (That also makes hit-testing lie: `elementFromPoint`
  can never return a toast, so an early probe of mine reported "not topmost"
  for the wrong reason. Measure a `pointer-events:none` layer by PIXELS.)

### What replaces it

`src/public/studio-notify.css` + `studio-notify.js`, hand-written and
allowlisted in server.js like the other host-owned sheets -- they hang off ids
and literal `dcn-` classes, so a design re-import cannot renumber them away.

- **`#dcNotes` is z-index 2147482000**, above the guide layer and the activity
  bar. `test/notify-dock.test.mjs` READS every z-index out of every studio
  asset and fails if any of them outranks the dock, so a layer added next month
  is compared automatically rather than against a list somebody typed.
- **The dock is `pointer-events:none`; each CARD takes its own back**, so it
  never eats a click meant for the page but can be dismissed, hovered or acted
  on.
- **Kinds**: on / off (a state chip -- On wears the colour, Off is deliberately
  quiet), good, bad, work (a spinner that BECOMES its own outcome), info.
- **Hovering pauses the countdown**, timer and hairline both. A notification
  that vanishes while you are reading it is the fault this dock exists to fix,
  wearing a different hat.
- **The palette is declared three times on purpose**: night, `body.dc-light`
  (desktop paper) and `body.dcm-light` -- the phone keeps its theme in a
  SEPARATE preference under a separate key, so one selector would have left the
  dock night on a paper phone.

### The compatibility floor, and why it is the point

`toast(message, type)` is called from **seventy-one places** in index.html and
not one of them was rewritten. It hands off to the dock and **keeps the old
dock underneath as a fallback** -- an outcome that goes unannounced because an
asset 404'd is exactly the bug being replaced.

**A trailing "on" / "off" is read as a switch**, which is how every switch in
this app already phrases itself, so "Email notifications on" becomes a card
titled *Email notifications* with an **On** chip and no call site changed.
Guarded hard: never on a failure (`Could not turn it on` stays a plain error),
never on a long sentence, and only when a label survives taking the word off.

### Showing that the thing you clicked is doing

`studioDo` is the one funnel roughly forty actions go through, so it is the one
place that could answer that half of the ask. Past **400ms** it raises a
spinner card that then becomes the outcome; under 400ms nothing extra appears,
because a card that flashes up and away on an instant action is noise. An
action with no `ok` line is one that is deliberately quiet (an optimistic clip
setting, a caption drag): its spinner closes without a word on success, and
still fails loudly.

**The switch announcements are made INSIDE `fn`, never off studioDo's returned
promise.** studioDo swallows its own failure and resolves either way, so a
`.then()` would have reported a switch that had actually been refused. Proven
live: driving the real publishing toggle on an instance with no YouTube
credentials produced *"youtube developer credentials are not configured"* as a
failure card, not a cheerful "YouTube / On".

### Two bugs found by driving it, not by reading it

1. **`trim()` was an infinite loop, and the FIFTH notification of a burst would
   have frozen the browser.** `remove()` only spliced the card off the live
   list inside its delayed callback, so `while (live.length > MAX)` removed a
   card, saw the length unchanged, and span forever. A card is off the list the
   moment it starts leaving now; only the DOM removal waits for the animation.
   The regression test hangs against the old code, which is the right alarm.
2. **A switch flicked twice kept showing the FIRST state.** The dedupe branch
   counted a repeat without redrawing, so "YouTube / On" stayed on screen after
   it had been switched off -- worse than two stacked cards, because it is
   wrong. A repeat with a different answer redraws in place; only a genuinely
   identical message is counted (`×3`).

### Traps paid for again

- **`pkill -f` with the pattern in the same command line kills the call's own
  shell.** This file has warned about it since August and it still cost a run.
- **An adapter object built in a `vm` realm fails strict `deepEqual`** -- copy
  it out first. Third time.
- **Playwright's default timeout plus a blocked CDN**: `page.goto` hangs for
  minutes on the unreachable Phosphor CDN. Abort off-origin requests in the
  probe rather than concluding the app is broken.
- **Node buffers stdout to a file**, so a probe killed by a timeout loses
  everything it "printed". Append each step to a file instead.

Verified in a browser at 1440x950 and 390x844: all four kinds in both themes,
the dock topmost by real hit-test over the tour AND over a dialog, four cards
inside the viewport, the phone dock clearing the floating tab bar with no
overflow, dismiss by click, hover pausing the countdown, and the dock surviving
three consecutive `paintStudio()` calls as the same node.

## The task ladder, and the tokens it pays (v3.108.0, 3 Sept 2026)

Youssef sent a screenshot of another app's nav -- a "Complete setup / 20%"
card above the account row -- and said: "this is a great idea for new users
also you can add that new user one so then 5 steps then add tasks like upload
your first 3 clips finish 1 week finish 1 month and etc and they can earn
tokens with it as well."

### The risk was never the feature, it was the SECOND ANSWER

v3.96.0 retired a five-step "Getting set up" checklist for sitting directly
above the Create -> Review -> Publish strip and telling one person two
different things about where they were. A ladder that recomputed "have they
imported yet" walks straight back into that.

So **the ladder's first three rungs ARE the journey's three steps, read off the
same `journey()` call** rather than derived again. `test/task-ladder.test.mjs`
drives four different account shapes and asserts the two agree rung for step;
it was proven RED against a version that counted projects itself.

Everything past those three continues from the same records -- `clip.postedAt`
and nothing else -- so the whole thing stays derived and retroactive like the
rest of `onboarding.js`. Seven rungs: import, approve, post, post three, post
ten, seven different days, thirty different days.

- **Distinct DAYS, never a consecutive streak.** A streak breaks on one missed
  day, and this product posts on a schedule the customer chose -- so a streak
  would punish somebody for picking four windows a day over eight, or for a
  platform being down. Distinct days only ever go up. Thirty clips posted on
  ONE day ticks the count rungs and not the day rungs, and a test says so.
- **Progress is capped at the target**: 40 posted clips reads "30 of 30", never
  "40 of 30".

### The money

`config.taskReward*`, five amounts, **45 tokens for the whole ladder, once per
account, ever** (5 / 5 / 10 / 10 / 15). Pro monthly is A$29 for 650 tokens, so
working all of it earns about 6.9% of one month, spread over the thirty
separate posting days the last rung needs.

**It shipped at 150 and Youssef reduced it the same day** ("Reduce token
reward"). 150 was three times what a REFERRAL pays for bringing a paying
customer, which is the wrong ordering: nothing a customer does alone should be
worth more than delivering somebody else's subscription. The ladder is now
deliberately under `referralBonusPaid` (50), and `test/task-ladder.test.mjs`
pins that RELATIONSHIP rather than the numbers, so either can be tuned and the
ordering holds. The unit is 5, which is one five-minute run at about a token a
minute -- the size the product's own first-run copy calls "plenty for a first
run".

**A rung already paid is never re-paid and never clawed back.** The grant is
keyed in `billing.processedBonusGrants`, so an account paid at the old rate
keeps what it was given and simply never earns that rung again. `TASK_REWARDS_ENABLED=false` turns it off without a
deploy and every amount has its own env var.

- **The first two rungs pay NOTHING, deliberately.** Importing already spends
  tokens (paying for it is a partial refund wearing a reward badge) and
  approving is one click. The ladder starts paying when something ships.
- **It cannot be farmed.** Every rung is keyed and granted once through
  `billing.grantBonusTokens`, which refuses a key it has honoured; importing
  costs more than any rung pays; and the two largest rungs need ten posted
  clips across thirty different days on a real connected channel.
- **TWO RECORDS, on purpose.** `billing.processedBonusGrants` makes the money
  idempotent and is the authority; `user.taskRewards` is what the SCREEN reads
  so a card can say "earned" without reaching into billing's internals. A test
  deletes the display record and asserts the grant is still refused.
- **Settled inside the /api/state builder**, which every open tab polls. Cheap
  (the ladder counts clips the payload already loads) and safe to run
  constantly (the grant refuses repeats), and the tokens land the moment they
  are earned rather than up to ten minutes later in `agent.tick()`. A test
  polls three times and asserts the balance does not move.
- **An operator is never paid**, because an operator cannot be: `isUnlimited`
  makes the grant a no-op, so settling for one would write a ledger row on
  every poll for tokens that mean nothing.
- **It is RETROACTIVE and that is the deliberate launch.** An account that
  posted ten clips before this shipped is paid for them on its next poll. At
  eight accounts that is a few hundred tokens, and a ladder that opened with
  five rungs already ticked and nothing paid would read as having missed out.

### The rail card fills the rail's OWN empty footer div

That div has been in the design export all along, painting its border and
padding around nothing -- which is why studio-tokens.css hides it with
`#dcRail > div:empty` and the comment says "the card returns the moment it has
something to say". This is the something, so it cost no design re-import and a
re-import cannot renumber it away. Found by being EMPTY, never by a class.

- **THE COLLAPSE CONTROL IS ABSOLUTELY POSITIONED OVER THAT SLOT.** Measured at
  1440x950: the footer slot is y 873..934 and the collapse row y 906..938, so
  the first cut landed the card directly underneath it -- the identical
  collision that removed the plan badge in v3.73.1. The slot reserves the row's
  height (`#dcRail > div:has(> #dcTaskCard) { margin-bottom: 46px }`), scoped
  with `:has()` so an empty slot still pushes nothing around. Measured after:
  the card clears it.
- **Neither the body nor the rail gains a class when the rail collapses** --
  measured, both keep the same className at 228px and at 68px. Reading the
  rail's WIDTH does not work either: it animates over 180ms, so the paint that
  collapses it measures the OPEN width. The host stamps `is-tight` from
  `StudioAdapter.ui.railOpen`, which is the answer at render time.
- **The card disappears at 100%.** The slot goes back to being empty and
  `:empty` hides it again -- a finished account is not shown a permanent badge.
- "Complete setup" only while the setup half is genuinely unfinished; after
  that it reads "Your tasks", because an established account working the later
  rungs is not setting anything up.
- The ring is a conic gradient with a punched-out middle, no SVG.

### One panel, both surfaces

The rail card and the phone's More-sheet row open the SAME host dialog, which
reuses the connections dialog's card, backdrop, close button and Escape
handling. The phone row shows "3 of 7 done · 15 tokens waiting" and is drawn
only while the ladder has something left to say. The phone never recomputes
anything -- a test fails if a rung's rule appears in either surface's source,
because the copy belongs to `onboarding.js` alone.

Driven in a browser at 1440x950 (night and daylight) and 390x844: card, panel,
seven rows with their counts and prizes, the collapsed rail showing the ring
alone, the card surviving three consecutive `paintStudio()` calls as the same
node, and zero page errors.

### One tour button, and the ring counts what the hero counts (v3.110.0)

Youssef, looking at the shipped ladder: "take the tour there are 2 buttons for
it? also connect the side bar perctnage thing to first user interface hero
thing to work with one another."

- **Two tour buttons, and it was mine.** v3.99.0 gave the first-run right-hand
  column a "New here?" card whose whole purpose is offering the tour, and never
  removed the quiet grey link beside Start job that already offered it -- two
  controls for one thing on the one screen where a beginner is least able to
  tell them apart. `paintTourEntry` stands down while the first-run card is up;
  the link stays for everyone else, because with no card it is their only way
  in. Measured on both accounts: **one control each**, from two and one.
- **It reads the BINDING, not `body.dc-firstrun`.** paintTourEntry runs before
  paintFirstRun in paintStudio's list, so on the paint where an account stops
  being a beginner the class is still on the body -- the first cut left that
  account with NO tour entry for a whole render. Found by driving it.
- **The ring and the hero counted different things.** The rail said 14% (one
  rung of seven) beside a hero saying "Step 1 of 3", with nothing on screen
  relating them. `ringPercent` now counts the hero's own three steps while the
  hero is up, and re-anchors to the whole ladder the moment setup finishes --
  in the same paint the card's title changes from "Complete setup" to "Your
  tasks", so the new denominator is never unexplained. The card's second line
  is the hero's OWN `progress` string, sent by the server, so the two cannot
  phrase it differently. Measured: ring 33%, rail "Step 2 of 3", hero
  "Step 2 of 3".
- **The panel marks the step the hero is standing on** (`nowId`), not merely
  the first unfinished row, so opening the ladder from the rail lands on the
  same answer Home is giving.
- **Every rung is a button that goes where the hero's button goes.**
  `StudioAdapter.goToStep(action)` is the ONE destination map and the hero's
  own button now calls it too. **It has to be a METHOD on StudioAdapter**: the
  first cut put it inside `bindings()`, so `StudioAdapter.goToStep` was
  undefined and clicking a task row silently did nothing. Driven: a row takes
  the screen from home to queue and closes the panel.
- The rail note is the step label ALONE. "Step 1 of 3 · Import your first
  lecture" truncated in a 228px rail; the next task moved to the tooltip.
- **One red-probe did not go red first**, and that is the rule earning its keep
  again: the tour assertion matched `const firstRun = ...` and went on passing
  after `||firstRun` was deleted from the guard. It pins the guard's condition
  now, and was re-proven red.

### The task panel, aligned by measurement (v3.110.2)

Youssef: "not everything is aligned, like, the ticks and stuff like that."
He was right, and every fault was SYSTEMATIC rather than one bad row --
measured at 1440x950 before touching anything:

| what | before | after |
|---|---|---|
| tick vs its title's centre | 3.6px low, all 7 rows | 0px, all 7 |
| reward chip vs title's centre | 4.6px low | 0px |
| chip widths | 88px and 78.8px | 82px, every one |
| left column vs the dialog header | x=487 vs x=479 | 479, both |
| rows with a progress bar | 76.9 / 74.9 / 74.9 / 74.9 | 75 each |

Fixed by geometry, not by nudges: `--dctk-line` (22px) is the tick's height,
the title's line-height AND the chip's height, so all three start at the top of
the grid row and their centres coincide by construction. The row keeps its 8px
padding for the hover background and takes it back with `margin: 0 -8px` so the
content sits on the header's edge.

Two smaller causes, both worth remembering:

- **Fractional leading accumulates.** The note was `line-height: 1.45` at 11px
  = 15.95px, and the fractions built up down the list until a wrapped row sat
  on a half pixel. That was the last 1px of tick offset. Integral leading now.
- **A badge inherits its heading's leading.** The "Now" chip took the title's
  22px line-height plus its own padding, so its line box was 24px -- 2px taller
  on that one row, and 1px off the tick. It carries its own `line-height: 1`
  and a height under the title's line.

Re-measured after: **0px on every row at 1440, 1100 and 390 wide, in night and
in daylight**, every column a single value, no overflow. The rail card measured
clean throughout (ring against copy 0, the percentage dead centre in the ring).
`test/task-ladder.test.mjs` pins the METHOD rather than the numbers -- CI has
no browser -- and both probes were proven red.

## The ladder became three groups, and rewards are CLAIMED (v3.111.0, 3 Sept 2026)

Youssef, on the first version: "so we have all the tasks on one go. Right? I
don't like that ... the beginning will be like the first user one ... then you
have like the second one comes up ... maybe like on the top you have like tabs
that you can go through, to make it more organized ... also, it should be able
to claim the tokens, and it should say claimed ... and then comeback rewards.
So coming back to the website gets you tokens as well ... move perctnage taks
thing up and deen ai help and owner down."

### Three groups, one at a time

`TASK_GROUPS`: **Getting started** (the journey's own three steps, still read
off the same `journey()` call), **Building up** (three clips, ten clips, seven
posting days, thirty), **Coming back**. A group is locked until the one it
`needs` is finished; both later groups need only the FIRST, because gating the
comeback rewards behind thirty posting days would put them months out of reach.
A locked tab is still SHOWN — seeing what is coming is the point of splitting
the ladder up — and its panel says what opens it rather than leaving a padlock
unexplained.

The panel opens on the tab where tokens are waiting, else where the work is,
and then leaves the customer's choice alone: re-picking on every state poll
would move the panel under them.

### Claimed, not granted

The first version paid out on the next `/api/state` poll, so tokens simply
appeared — nothing to press, nothing saying they had arrived, and a disk write
on the hottest path in the app. Reaching a rung now makes it CLAIMABLE;
`POST /api/tasks/claim` pays it; the row then reads **Claimed**.

- **The button is not the check.** The route recomputes the rung from the
  account's own records, so a request naming a rung this account has not
  reached is refused whatever the screen was showing. Proven red by deleting
  that one line.
- The grant is still keyed in `billing.processedBonusGrants`, so a double-tap,
  a replay or a lost display record cannot pay twice. A test wipes
  `user.taskRewards` and asserts the re-claim is accepted and pays **nothing**.
- **An operator is offered nothing**, because an operator cannot be paid:
  `isUnlimited` makes the grant a no-op. Its rungs are still shown — the
  operator has to see what customers get — but nothing is claimable and
  `claimable` is 0. That was a live fault: the operator's own rail read
  **"+30"** for tokens nobody could ever collect.
- The rail chip counts what can be COLLECTED now, which is a real number with a
  button behind it rather than a promise nothing acts on.

### Coming back, and the one thing here that is stamped

Everything else in this module is derived from records that already exist. "Did
they come back" is not one of them: web metrics are anonymous, salted per day
and public-page only, deliberately (v3.28.0), and nothing else notes that an
account opened the app. So `user.visitDays` is written — the narrowest record
that can answer it: ISO dates, no times, no addresses, no user agents, capped
at `VISIT_DAYS_KEPT` (400). `noteVisit` compares the LAST entry first, so a
poll costs one comparison rather than a scan.

**Distinct days, never a consecutive streak**, for the same reason the posting
rungs count distinct days: a streak breaks on one missed day, and a comeback
reward that punishes a week away is not a comeback reward. A test proves a
forty-day gap does not reset it.

### The economics did not move

Eight paying rungs now instead of five, still **45 tokens** total
(5/5/5/5/10 + 5/5/5) — widening the ladder must not quietly raise its price.
Still under `referralBonusPaid` (50), and the test pins that RELATIONSHIP
rather than the numbers.

### The rail card moved above DeenAI / Help / Owner

Those three are the nav's tail, held at the foot of its last group by
`margin-top: auto` on the first of them. `seatTaskCard` moves the slot into the
nav immediately BEFORE that element, so the card lands just under Set up and
the auto margin goes on holding the tail down — nothing about those three
moves. Moved rather than re-created, so the node and its listeners survive, and
only when it is not already in place or every paint would reinsert it. It no
longer needs the collapse-row reservation, because it is no longer at the
rail's foot.

### Alignment, measured again because the column changed

A Claim BUTTON now sits in the column the reward chip used to own. Measured at
1440x950 after: tick 0px and reward 0px off their titles on every row, one
value for every column, chips and claim buttons all 82px, the tab row and the
rows both flush with the dialog header (0px). The claim button takes the same
`--dctk-line` height as the chip, so a row with a claim in it is exactly as
tall as one without.

Driven in a browser: three tabs with counts and a gold dot where tokens wait,
four rows shown instead of ten, a tab switch showing a different set, and a
real claim click sending `{"id":"three"}` — refused here with "Your plan
already has unlimited tokens" (this instance signs in as the operator), which
is the guard above working and the failure surfacing in the notification dock.
The success path is driven over HTTP with a real free account.

## Every error in the Activity list was unreadable, and one was ours (v3.112.0, 3 Sept 2026)

Youssef, looking at the Activity dropdown: "error message?!?!?" Four failures,
two distinct faults, and only one of them was a message problem.

### "Processing engine failed: @ 0x59cf21fd5c80] libass API ver"

That is a fragment of ffmpeg's INFORMATIONAL banner — the lines it prints on
every render, successful or not — cut mid-token. **Three faults stacked to
produce it**, in `service.py`:

1. `" ".join(stderr_lines[-10:])` takes the END of ffmpeg's output. ffmpeg
   prints its complaint and then goes on chattering, so the last ten lines are
   reliably the banner and reliably not the reason.
2. `detail[-1000:]` keeps the last thousand CHARACTERS, so the front is sliced
   off wherever it happens to land — hence a message opening mid-address.
3. **A child killed by a SIGNAL prints nothing at all**, so the one case that
   most needs explaining fell through to whatever ffmpeg had last said. On this
   box that case means MEMORY: 3.7G total, the Ollama container capped at 2G,
   ffmpeg beside it, and five llama-server OOM kills already in `dmesg`.

`failure_detail(code, reported, stderr_lines)` answers in four tiers: the
worker's own reported reason wins outright; a negative code is a signal and is
NAMED, with SIGKILL alone carrying the out-of-memory explanation (claiming it
for SIGTERM would send someone chasing the wrong thing); then the last line
that looks like a complaint; then anything that is not banner noise.

- **The noise filter matches the whole `[Parsed_filter @ 0x...]` family**, not
  a list of the particular sentences it prints. Chasing those one at a time is
  how "Added subtitle file: caption.ass" got through the first cut.
- **Noise UNLESS it also complains.** ffmpeg reports real errors wearing the
  same prefix as its banner, so filtering on the prefix alone would throw the
  diagnosis away with the chatter. `FFMPEG_SIGNAL` rescues those lines.
- **There is deliberately NO raw fallback.** Falling back to the unfiltered
  tail is what produced the libass fragment; a sentence that admits it knows
  nothing beats one that looks like it says something. With nothing usable it
  names the exit code and points at the worker's log.
- `test/test_failure_detail.py` drives the real function with the real banner
  lines, verbatim from a render. Proven RED by restoring the old tail-slice.

**Worker change, so `deploy-worker.yml` deploys it on push.** It changes what
FUTURE failures say; the four rows already on screen keep their stored text.

### The three TikTok failures were DeenClipped refusing, not TikTok

"TikTok requires a clean copy without an app watermark. Choose a TikTok-safe
template and re-render this clip first." Two things wrong with that, and the
second is a product fault rather than a wording one.

- **There is no such thing as a TikTok-safe template.** The advice named a
  control that exists on no screen, so it could not be followed by anyone.
- **The automatic clean copy is only rendered on the LOCAL engine.** The remote
  path returns before it, so it only ever refused — and since v3.72.8 every
  shipped template carries the watermark by default. Production runs the remote
  worker. **So every TikTok post has been refused by this app, before TikTok
  was ever contacted.** Nothing was sent and no tokens were spent, which is the
  one good thing about it.
- The message says what is true and what actually works today, and it is
  PLAN-AWARE: a paid account is told to switch the mark off on the named
  template and re-render; a free account is told the mark cannot be removed, so
  TikTok is not reachable yet, and that the other three platforms are
  unaffected. It reads `billing.planFeatures(owner).watermark` — the FEATURES
  table, the sanctioned route — never a bare `isPaid`.
- `EXPLAIN_PUBLISH` gained a `/watermark/i` entry, placed AFTER the
  unaudited-app entry so that one still wins its own 403. Verified by CALLING
  `explainFailure` rather than by asserting the table contains a regex — a
  wrong winner was the entire bug the publish/import split existed to fix.

**The remote clean-copy render is BUILT (v3.114.0, below).** This paragraph
said it was not for one release; the refusal it describes is gone, on both
engines, and a free account CAN post to TikTok now.

## TikTok gets its own copy, on the remote worker too (v3.114.0, 3 Sept 2026)

Youssef: "build the remote clean copy render for tiktok."

TikTok's Content Posting rules refuse a video carrying another app's
promotional mark. The LOCAL engine has rendered a clean derivative for years;
the REMOTE path returned before it and only ever refused — and production runs
the remote worker, with every template carrying the DeenClipped mark by
default since v3.72.8. **So every TikTok post this product has ever attempted
was refused by this app before TikTok was contacted.**

### It is a re-render, not a new kind of job

`queueClipRerender(clipId, templateId, { socialVariant: 'tiktok' })`. The
render pipeline, the queue, the worker payload, the retry bounds and the
restart recovery are all the ones that already existed; what is new is a third
outcome beside "replace the clip" and "make a library variant" — **land on
`clip.socialVariants[kind]` and touch nothing else.**

- **It costs no tokens.** A re-render never has, and this one is not something
  the customer asked for: TikTok's rules are.
- **It is excluded from the supersede sweeps in both directions**, because it
  is not the clip's own render. Without that a queued copy and a queued
  re-render would cancel each other.
- **A clip already POSTED can still have one made.** The old guard refused
  every change to a posted clip; a clip live on YouTube with a failed TikTok
  leg is exactly the case this exists to serve, and the copy changes nothing
  about the clip.
- The output id is fixed (`<clip>-tiktok-safe`), so a re-render overwrites
  rather than collecting a graveyard of copies in storage.

### `cleanTemplateForTikTok` is ONE definition, and WHERE it runs is the point

Both engines call it, so they cannot disagree about what TikTok is sent. It is
applied **after `enforcePlan`, never before** — enforcePlan puts the free
plan's mandatory watermark back on, so stripping first would have shipped the
mark on the very copy that exists to remove it. A test pins the ORDER, not
just the call, and was proven red against the swap.

**The trade, stated rather than hidden:** a free account's TikTok video now
carries no burned-in mark. That is the same shape as the scripture exemption —
the platform's own rule outranks the paywall — and the attribution MOVES
rather than disappearing: `postCredit` already puts the poster's own invite
link in the caption, on TikTok as everywhere else. A test asserts that caption
still carries it, and was proven red against `postCredit` returning nothing.

### Waiting is not failing, and that distinction is load-bearing

A remote render is a queued job on a shared worker; it runs for minutes. The
publish attempt cannot block on it, so `socialPublishFile` throws
`pendingRender` and `processTarget` answers it **before it counts an attempt**.
`socialMaxAttempts` is 5 on a doubling backoff — about half an hour — so
counting each check would burn the whole budget and file a perfectly good clip
as failed while its copy was still in the queue. That budget exists for
TikTok's own transients; a wait of ours is not one of them.

**It is bounded by the render, not by a timer.** The moment that job reaches
`failed`, socialPublishFile throws an ordinary error carrying the worker's own
reason, which then spends attempts and fails normally. `runRemoteAux` already
bounds every job (worker timeout, capped unavailable-retries), and a restart
recovers `processing` back to `queued`.

### `forRenderVersion` is what refuses to post a stale copy

Stamped at QUEUE time, not at import: the copy renders the style current when
it was queued, so reading the version at import would record a newer number
and call a stale copy fresh. A clip re-rendered since its copy was made gets a
new one; the old files and objects are deleted when the clip re-renders. **The
version check is the authority — the deletion is only what stops the files
accumulating.**

### The copy is machinery, so it is not a second row anywhere

The publish target already says "Clip → TikTok · Rendering a copy TikTok will
accept". The render job is hidden from the live list (where it would have read
**"Editing clip"** at somebody who edited nothing), from the Activity failures
(**"Edit failed"** beside the publish failure that carries the real guidance),
and from `latestRerender` (which would have spun the editor for work the
customer cannot see). Measured in a browser: **one row on screen**, naming the
destination.

### The guidance moved with the behaviour

`EXPLAIN_PUBLISH`'s watermark entry told people to switch the watermark off by
hand. The app does that itself now, so advice for a solved problem is worse
than none: the entry answers the RENDER failing instead. **The test that
asserts nobody is still told to switch it off reads what `explainFailure`
RETURNS, not the source** — a grep matched the comment explaining the removal,
which is the fourth time this repo has been caught by a source-string test
passing or failing on its own explanation.

### What is proven, and what is not

Nine of the eleven tests drive the real functions against a faked worker —
queue, poll, land, publish — because the whole bug was a path that was never
taken. All eight probes were proven RED against the behaviour they pin.

**Not yet seen on a real TikTok.** The app-side proof is complete: the right
job is queued, the payload carries a template with nothing of ours on the
frame, the copy lands and is the file handed to TikTok. Whether TikTok then
ACCEPTS it is still open item 2 — an unreviewed app may only post to a private
account, and that is a submission, not code.

**Two traps paid for again:** the temp directory in the first cut of the test
was named `deenclipped-tiktok-safe-`, so every path matched the pattern under
test and three assertions passed on their own fixture — assert on the
BASENAME. And `remoteMusicTracks` throws without `PUBLIC_BASE_URL` even for an
empty track list, so a music-waived remote re-render fails for the wrong
reason on a deployment that has not set it.

## Connecting TikTok failed with a bare API error (v3.114.2, 3 Sept 2026)

Youssef, mid-way through recording the app-review demo: "when i connect to
tiktok i then ask for perimission when i come back to my dashboard it says a an
error api but the api is the sandbox."

Two faults, and the second is why the first was so hard to see.

### The OAuth credentials were never trimmed

**This repo has now paid for that lesson three times.** Stripe's keys were
trimmed at v3.27.0 and Turnstile's at v3.100.0, both with comments saying a
credential pasted into Render's variable field picks up a trailing newline
routinely -- and both times the OAuth credentials sitting a few lines away were
missed. `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`, the three Meta values and
the four Google/Apple sign-in values all read `process.env.X || ''` raw.

A key with a newline on it fails the token exchange as a TikTok API error
**indistinguishable from having copied the wrong secret** -- and it bites
hardest immediately after a deliberate credential swap, which is exactly the
moment you would believe the error. All ten are trimmed now.

**The error he was actually shown, from the screenshot: "TikTok error: Client
key or secret is incorrect."** That is TikTok's own `invalid_client`, so the
pair the app sent was rejected outright. Whitespace is one way to produce it;
a half-updated pair, a key and secret from different apps, and a Render deploy
that had not finished are the others, and NONE of them can be told apart from
the message. That is the point -- the trim removes the one cause the code
could have removed on its own.

### A failed connection left nothing to read

The callback redirects to `/app?social=error&message=…`, the page toasts that
message and then wipes the URL with `replaceState`. So the platform's own
reason flashed past once and was gone: no activity entry, nothing to scroll
back to, and the only surviving copy in a `console.error` on the server that a
customer cannot open. That is why the report could only be "an error api".

It is logged in `completeOAuth`, deliberately, because that is the LAST place
the `userId` is known -- `verifyState` has run by then, and `log` with a null
user is filtered out of every bell by `logFor`. The error is re-thrown
untouched, so the redirect and its toast are unchanged.

**Both probes proven red**: against the untrimmed declarations, and against the
catch that re-throws without logging. The credential test reads each
DECLARATION rather than grepping the file for `.trim()`, because the
neighbouring Stripe block is full of them and would have passed regardless.

### And the trim was NOT the cause (v3.115.1, same day)

The fix went live at 10:14 and the connect failed again at 10:18 with the same
sentence, which settles it: whitespace was one way to produce that error and
not the one that happened. Worth keeping anyway -- it removed the single cause
the code could remove on its own.

**"Client key or secret is incorrect" is TIKTOK'S OWN WORDING**, passed through
`jsonRequest` verbatim; this repo does not translate it. So TikTok looked at
the pair and rejected it. Three mistakes produce that one sentence -- the
production key where the sandbox one belongs, only one of the two updated, or
a masked value copied out of the portal (**TikTok hides the sandbox key and
secret behind an eye icon**, which is the trap most likely to have been hit) --
and the message distinguishes none of them.

`tiktokCredentialNote()` is appended to the error when, and only when, TikTok
blamed the credentials. It is billing's `webhookSecretNote()` device applied to
OAuth, with one deliberate difference: **the client KEY is named in full**,
because it is not a secret -- it travels in the OAuth URL and is on screen in
the address bar every time anyone presses Connect. The SECRET is never
described beyond its length. It reports the `sbaw` / `aw` prefix TikTok uses
for sandbox and production keys, and never refuses on it: that is a convention,
not a documented guarantee.

**So "is the client key the app is sending the sandbox one?" is now answered by
reading the error**, rather than by trusting that a paste worked.

## "No account connected" beside "TikTok · Posting" (v3.115.2, 3 Sept 2026)

Youssef, on the Schedule screen: "once I get to the end to then click post now
or when it goes to the scheduler, it says no accounts are connected. Even
though on the right side, you can clearly see that there has been accounts
connected and TikTok is connected."

**Both halves were telling the truth about different things.** The ROW reads
`clip.targets`, stamped once by `setTargets` at schedule time; the SIDEBAR
(`schedOutlets`) reads the live connections. Schedule a clip while nothing is
connected, connect TikTok an hour later, and the two disagree for ever --
nothing refreshed the clip.

### The label was the small half

**At its slot, `tick()` filed a clip with no targets as `ready`** ("ready to
download and post") and it silently never posted, however many channels were
connected by then. `publishNow` has re-derived since it was written -- so
pressing Post now worked and letting the slot arrive did not, which is the
worst shape a scheduling bug can have: the manual path proves the automatic
one, and the automatic one is the product.

A clip now asks where it is going when it POSTS, not when it was scheduled.
**Only ever when the list is EMPTY** -- re-deriving targets that already exist
would discard an in-flight upload's status and retry state -- and a clip with
still nowhere to go falls through to `ready` exactly as before.

### The row says something true now

`anyOutletLive()` is ONE answer to "does this account have anywhere to post
right now", shared with the sidebar that renders "Posting", so the two cannot
disagree on screen again. With a live outlet the row reads **"Set when it
posts"**, which is now literally what happens; with none it keeps "No account
connected", which is then true.

**The probe reproduces the original bug rather than describing it**: it seeds a
clip with `targets: []` whose slot has arrived, connects TikTok afterwards, and
drives the real `tick()`. Proven red by removing the re-derive -- the clip
comes back `ready` with nowhere to go.

### Two switches, and every surface read only the near one (v3.115.3)

"im confused i click post now nothing happnes" — with TikTok visibly connected
and the sidebar reading **Posting**. The Render log said all of it:

    Scheduled "If you are a servant…" for local export.
    Publishing started for "A Reminder of Mercy…".
    "A Reminder of Mercy…" is ready to download and post.

**`setTargets` returns an EMPTY list without throwing when the account's master
automatic-publishing switch is off** (`if (!settings.enabled) { clip.targets =
[]; return; }`). So the clip scheduled to nowhere, `publishClip` iterated
nothing, `refreshPublishingStatus` filed it `ready`, and the route answered
success. Pressing the button did exactly nothing, twice, and said so nowhere.

There are TWO switches and they are not the same thing:

| | |
|---|---|
| `publishingSettings[platform].enabled` | TikTok's OWN switch — what `providerInfo` reads |
| `publishingSettings.enabled` | the account's MASTER automatic-publishing switch — what `setTargets` reads |

Three surfaces read the near one and none read the master, which is how the
sidebar said "Posting" beside a schedule row that could never post.

- `autoPublishOn` is now read once in the adapter and consulted by
  `anyOutletLive()`, by `schedOutlets` (which says **"Publishing off"** rather
  than "Posting"), and by the schedule row (**"Automatic publishing is off"**,
  naming the switch instead of blaming the connection).
- **`publishNow` refuses with the reason** rather than reporting success having
  posted nowhere — invariant 9 applied to a button that ran and did nothing.

**One red-probe did not go red the first time and the run was reported as
proof.** A slice-based edit raised `ValueError: substring not found`, the file
was left untouched, and the suite passed against unmodified code — which
proves nothing at all. Re-done by line number, with the removed lines printed
and asserted before the run. Check that a red probe actually EDITED the file.

### Connecting a channel now switches publishing on (v3.115.4)

Youssef: "as soon as I have my thing connected ... it should work normally ...
I shouldn't be doing extra steps."

**The master switch defaults to FALSE** (`settingDefaults().publishingSettings.
enabled`) and `enableOnConnect` only ever set the platform's own switch. So
OUT OF THE BOX a customer could connect TikTok, see "successfully linked", pick
an audience, watch the dot go green — and never have one clip post. That is
every new account this product has ever had, not one misconfigured one.

Enabling a destination now enables publishing, in the two places a connect
finishes: `enableOnConnect` (YouTube, Meta, and TikTok once it is allowed to
switch on) and the settings route's `enableWhenReady` branch, which is where
TikTok's audience first arrives. Both are the app COMPLETING a connect, not a
form the customer submitted — a save that deliberately sends `enabled: false`
is still honoured, the switch is still there to turn off, and nothing posts
without an approval either way.

`enableOnConnectForTests` exports it, because "which switches does connecting
turn on" is a behaviour and the real OAuth path cannot be driven without a
live TikTok.

## The switch that stopped every account posting, ever (v3.116.0, 3 Sept 2026)

Youssef, with TikTok connected, ticked, an audience chosen and two approved
clips on today's schedule reading "Automatic publishing is off":
**"doesnt WORK FIX IT KEEP AUTO UPLOAD ON ALWAYS".**

`publishingSettings.enabled` -- the account's master automatic-publishing
switch -- **defaulted to FALSE, and the studio has no control for it.** The
only checkbox that ever wrote it, "Enable automatic publishing globally", lives
in the legacy dashboard behind a `renderStudio()` that returns first, so no
studio customer has ever seen it. With it off, `setTargets` gives a clip NO
destinations, `tick()` files it as `ready` ("ready to download and post"), and
nothing posts -- for ever, with every visible switch on.

That is **invariant 9 inverted**: not a control that does nothing, but a hidden
control whose default silently breaks the product. It is also the honest answer
to the First 100 funnel's oldest number -- nobody has ever completed a post,
and this is one of the reasons why.

- **It is retired on READ, not migrated** (`store.publishingSettings`), the same
  device as the YouTube privacy correction four lines below it. Every record
  this product has ever written holds `false`, so changing the default alone
  would have fixed NOBODY -- Youssef's own account included, mid-recording. The
  read-time correction frees an account on its next request.
- **Both halves are pinned, because either alone hides the other.** A probe
  that flipped the DEFAULT back came back green against the first cut of the
  test, since the correction covered it. `test/publishing-always-on.test.mjs`
  now asserts `settingDefaults()` and the read separately.
- **Nothing is loosened.** The per-platform ticks still decide WHERE a clip
  goes, and an approval still decides WHETHER it goes at all. A test drives an
  account with the platform unticked and asserts it still posts nowhere.
- The route ignores `body.enabled` and stores `true`, so the record says what
  the reader reports; the legacy checkbox is DELETED rather than left as a
  control that changes nothing.

### THREE REGRESSIONS CAME OUT FROM UNDER IT, and the suite caught all three

This is the entry worth reading. Retiring a flag that was false everywhere
turned on code paths that had **never executed in production**, and every one
of them was worse than the bug being fixed:

1. **`setTargets` threw.** Under the early return it never reached the
   `throw new Error('Automatic publishing is enabled, but no connected
   destination...')` below it. With the switch on, a brand-new account -- which
   has connected nothing -- could not schedule a clip AT ALL. Having nowhere to
   post is not an error: the clip takes its slot "for local export", tick()
   re-derives at the slot, and the place a missing destination is REPORTED is
   `publishNow`, where somebody pressed a button and is owed an answer.
2. **`validateFor` refused every save.** `if (next.enabled &&
   !enabledProviders.length) throw 'Enable at least one connected publishing
   destination.'` guarded turning the master ON with nowhere to send anything.
   Always-on turned it into a refusal of every save by an account with no
   destination ticked -- including the TikTok posting-options save Youssef was
   in the middle of.
3. **Automation stood down for everybody.** `if (publish.enabled &&
   !enabledAutomaticProviders.length) return;` meant to say *TikTok cannot be
   silently auto-consented*; always-on made it say *stand down unless YouTube,
   Instagram or Facebook is on*. It asks about **TikTok** now, which is what it
   always meant, and refuses in strictly more cases than production ever did.

**The general lesson: a flag that has been false in production for the life of
the product is not a flag, it is dead code holding live code hostage.** Turning
it on is a bigger change than it reads as in the diff, and the paths underneath
it have never been run by anyone. Run the whole suite and read every failure as
a possible regression before assuming it is a stale assertion -- twelve of the
fifteen were stale, three were not, and they looked identical in the list.

### Two tests were passing for free, and strengthening them found it

- `tiktok-disclosure` asserted `settings.enabled === false` after a YouTube
  connect. It passed because the connect **threw** -- the file sets no
  `GOOGLE_CLIENT_ID`, so `completeOAuth` raised "youtube OAuth is not
  configured" straight into the test's own `catch { }`. Nothing about YouTube
  was ever exercised. Google credentials are set now and the swallow is gone.
- `render-policy`'s "an approval survives a clip having nowhere to go" tested a
  throw that could not happen in production. The PROPERTY -- an approval is
  never silently retracted -- still holds, by a better route: the clip is
  scheduled rather than parked with a `scheduleError`.

### The remaining "Publishing off" is a DIFFERENT switch and stays

`DATA.directPublishingEnabled` is `config.socialPublishEnabled`
(`SOCIAL_PUBLISH_ENABLED`, **default true**) -- an operator setting for the
whole deployment, not a per-account one, and a deployment with no social
credentials should not offer Post now at all. Confusing the two cost a run
here, so `test/publishing-always-on.test.mjs` states the distinction and pins
its default.

### And Post now answers from every state

The empty-destination guard used to sit inside the `scheduled` branch alone, so
an `approved` or `ready` clip still fell through to "Publishing started" and a
success toast. It sits AFTER the branch chain now and covers approved,
scheduled, publish_failed and ready -- which is what makes invariant 9 true
here rather than true-in-one-case.

### Basic is 40 tokens over SEVEN days, and the repo now says so (v3.116.0)

Asked to check. `plans().free` is `tokens: config.tokensFree` (40) over a
window of `config.stripeTrialDays`, and the allowance drops to ZERO when the
window closes rather than to something smaller -- otherwise cancelling and
re-subscribing mints a fresh free wallet every lap.

**Production was not running the code default, and had never been.** The live
banner reads "Your 7 free days are up", built from `config.stripeTrialDays`, so
`STRIPE_TRIAL_DAYS=7` is set on Render -- while the repo defaulted to 3.
Youssef's call on hearing that: "let's change everything to seven days ... make
sure everything is all correct." The default is **7** now, so the repo and the
live site describe one product.

**The number was named in SIX independent places and they did not agree**,
which is why this needed more than one edit:

| where | said | now |
|---|---|---|
| `config.js` default | 3 | **7** |
| `billing.js` x2 (`config.stripeTrialDays \|\| 7`) | 7 | 7 |
| `billing.js` x2, plans page (`trialDays \|\| 3`) | 3 | **7** |
| `studio-adapter.js`, Basic card (`\|\| 3`) | 3 | **7** |
| `seo-copy.js`, ten claims across the landing pages | seven | seven |
| Render `STRIPE_TRIAL_DAYS` | 7 | 7 |

- **Nothing was broken, and that is what made it dangerous.** Every reader that
  mattered went through `config.stripeTrialDays`, which the environment set
  correctly -- so the app never contradicted itself in front of a customer. But
  a fallback is what runs the day somebody forgets the variable, and then the
  dashboard would have offered "Free / 3 days" beside twenty-two landing pages
  promising seven.
- **The env var stays.** Leaving it set is harmless now that it agrees with the
  code, and removing it would mean a deploy whose only effect is to make the
  live number depend on the deploy having landed. Change the number in ONE
  place -- Render -- and the code default is the honest floor underneath it.
- **`test/trial-length.test.mjs` pins one number across all six surfaces**: the
  loaded config default, every `trialDays || N` fallback, every `N-day trial`
  claim in the SEO copy (digits AND words), any digit hardcoded into a trial
  sentence in billing/marketing/mailer, and the design file's sample data. It
  is deliberately a SOURCE test, which this file normally warns against -- a
  fallback only fires when the environment is absent, so there is no executed
  output to read for it; the default itself IS executed. All six probes were
  proven red.
- **A guard that fires on ordinary prose gets deleted**, so the pattern matches
  only number-words and digits. The first cut allowed any word and flagged
  "the first paid day" in a sentence that mentioned the trial two clauses
  later.
- **The nudge timing got better for free.** `UPGRADE_DAYS_LEFT` is 2, so the
  "your free days are closing" email goes at 2 days left. On a 3-day window
  that was day one, colliding with the 24h import nudge and the one-a-day gap;
  on 7 it is day five, which is when somebody has actually tried the product.
  No code change -- it is worth writing down because it looked like a bug
  waiting to happen and stopped being one.
- **`billing-free-window.test.mjs` still sets the variable explicitly** and now
  tests the boundary rather than the middle: day six passes, day eight is
  expired. What it tests is the WALL, not the number.
- Two literals in `design/studio-dashboard.dc.html` moved with it. Sample data
  only -- the generated template carries neither string -- and
  `npm run design:import` was proven byte-stable before and after.

## The rewrite button handed back the line you pressed it to be rid of (v3.127.0, 4 Sept 2026)

Youssef, on the clip preview panel: "THIS NEDS a lot of fixing its so cheap
barley working so cheap feeling and **cant chnage more than once**."

The last three words are the diagnosis. Three causes, and the first is the one
that matters.

### The prompt handed the model the current title and told it not to use it

That is a NEGATIVE INSTRUCTION, and this file's oldest lesson about qwen3:1.7b
is that it does not obey one. It was already measured on the box: four of five
shapes returned the current title verbatim -- a Question chip answering with
something that is not a question, a Shorter chip returning the same length.
v3.122.0 responded by adding a guard that CATCHES the echo and a note that
SAYS "DeenAI kept your title". Honest, and still a button that does nothing.

The fix is to stop showing it. A named SHAPE is written from the transcript and
the current line is simply not there to copy. Two cases genuinely need it and
keep it: **shorter** is defined against it, and a typed instruction ("make the
title Arabic") means DO THIS TO THE ONE I HAVE.

### Nothing remembered what had already been offered

The worker is stateless, so a second press could only ever differ by luck. The
browser now keeps a per-clip, per-field history and sends it as `avoid`; each
entry is rejected exactly the way the current title is, through
`normalise_title` -- so "the same" means here what it means to the dedupe pass,
and "Mercy Has No Closing Time..." does not count as a new answer.

- **The line on screen goes in the list too**, deduped, or the very first press
  can hand back what is already there.
- **The star and the panel share ONE history.** Two would let the star return
  what Rewrite had just rejected.
- It is not persisted: it is about this conversation with the button, not about
  the clip, and storing it would mean somebody could never be offered a line
  again.

### One shot and a retry is a coin toss

Three attempts now, at rising temperature (0.7 / 0.95 / 1.1) -- rising is what
stops attempt two being attempt one again. Each retry NAMES the reason it was
rejected. A few seconds on a button somebody is already watching is far cheaper
than handing back the line they pressed it to be rid of.

**Keeping the current line still beats the transcript fallback, and that
ordering is deliberate.** The route WRITES whatever comes back, so preferring
the fallback would let one press quietly replace a good title with a raw
transcript sentence, with no undo. With NOTHING to keep, the fallback walks
`title_candidates` rather than calling `title_from_text` -- that one always
returns the FIRST candidate whatever number it is passed, so a second press
would reach the same sentence again, which is the very complaint.

### "So cheap feeling" was partly a CSS bug that had never worked

`.dcct-row /* comment */ .dcct-ai { color: gold }` -- **a comment is not a
separator, and CSS read that as the descendant selector `.dcct-row .dcct-ai`.**
So the one gold mark on the panel had never once been gold, on any screen,
since it shipped. Found by reading the sheet after the complaint, not by
looking at it.

The rest: the four shape chips were a flex wrap measuring 74/84/108/66px on two
ragged lines, and are a 2-up grid of four equal buttons with one right edge; the
Ask DeenAI section gets a warm wash that bleeds past the column with a negative
inline margin and pads the same amount back, so the one left edge every label
and field shares does not move (751 on every element, measured); and Rewrite is
a SOLID gold button rather than the sixth outlined control on a panel of six.

### The solid button measured 1.52:1 IN DAYLIGHT, and only measuring found it

Written with literals on the reasoning that the brand gold is the same in both
themes. It is. **The ink is not.** `build-light-theme` re-emits any rule naming
a colour and remaps every hex it sees, and `#0E0E11` is a page ground
everywhere else in this app -- so the ink on a gold button inverted to paper and
went invisible. The comment above it claiming 9.87:1 was written before the
browser was asked.

`--dc-gold-solid`, `--dc-gold-hover` and `--dc-on-gold` are declared once on
`:root` and deliberately NOT redeclared in the daylight block. **A rule written
entirely in var() names has no hex for the generator to remap**, so one
declaration serves both themes -- that is the escape hatch as well as the
definition, and it is the route for anything else that sits on the gold.

It also had to be **id-scoped**: the generated sheet emits
`body.dc-light .dcct-btn { color: … }` at 0-2-0 and a bare `.dcct-primary` is
0-1-0, so daylight rendered `--dc-ink` instead of the token. Near-black and
legible by luck, which is the shape that stops being true one edit later.
Measured after: **9.87:1 in both themes, the same fill and the same ink.**

### Two probes did not go red the first time

The colour test failed on the HEX IN ITS OWN EXPLANATION -- the fourth time
this repo has hit that shape, and the one that pushes the next person to reword
a comment rather than fix anything. Comments are stripped now. And the
"never redeclared in daylight" probe looked for `body.dc-light` by its first
appearance in the file, which is a line of PROSE in the comment above the
palette; it came back green against a redeclared token until it was pointed at
the block's real selector.

## Three channels is gone; Studio is capacity (v3.127.0, 4 Sept 2026)

Youssef, in the same message: "FOR STUDIO REMOVE ALL THINGS TO DO WITH 3
CHANNELS REMOVE IT, ITS NOT PRCATICAL THEY JUST GET 8 UPLAODS AND MORE TOKENS."

Multi-channel shipped v3.41.0 and is retired here. **The case for retiring it is
in this file's own record rather than in anybody's opinion:** three channels
needed a lane switcher, a share-out mode, a per-channel denominator on every
count and a channel name beside every logo -- and TWO RELEASES RUNNING
(v3.115.4, v3.116.0) went on the schedule being "very confusing" as a direct
result of it. The feature was retired rather than the symptom, which is the
right way round.

- **`accountsPerPlatform()` returns 1, with no argument and no branch.** A
  function that still reads the tier is a feature waiting to be switched back on
  by a config change nobody reviews. `ACCOUNTS_PER_PLATFORM_STUDIO` is deleted
  from config, not defaulted to one.
- **NOTHING WAS MIGRATED, and that is deliberate.** Every credential path
  resolves by account id and a stored connection may still be a LIST: an account
  that connected three while they were sold has three on disk, and capping the
  ALLOWANCE stops the extras without a migration that could lose a working
  credential. The dialog lists them all, says "DeenClipped posts to the first of
  these", and each keeps its own disconnect. `enabledTargetsForClip` LOGS the
  truncation -- two destinations disappearing with no line anywhere is how a
  "my clips stopped posting" report starts.
- **The share-out mode is deleted from the store, the route and the publish
  path**, along with `rotationIndex`. It only ever meant anything with more than
  one channel to share between, so leaving it would be a stored setting no code
  path can act on -- the dead flag this repo already paid for once (v3.116.0,
  the master publishing switch that had been false in production for the life of
  the product).
- **The schedule has ONE denominator again.** "3 of 8 scheduled", in the day
  view and the sidebar and the header, all from `daySlots`. The per-channel
  wording that replaced it, and the "N posts this day, across your channels"
  that had no denominator at all, are gone.
- **The logo stands alone on a schedule row again** -- which is what Youssef
  asked for originally ("dont be writing just put logos that are posting") and
  which only stopped being true because a platform could mean three. A failure
  still gets its word; that never depended on the channel count.
- **What Studio sells is now two things, and the second was invisible.**
  `extraSlots` reads "Post up to 8 times a day, not four" -- said against the
  number it beats, because "up to 8" means nothing to somebody who does not know
  the other plans give four. And `moreTokens` is new: the allowance was only
  ever a number on the pricing card, so nobody comparing the two columns could
  see that Studio buys more lectures a month. Its label is DERIVED from the two
  plans' own figures (`tokensStudioMonthly / tokensMonthly`), so the sales line
  cannot claim a multiple the billing code does not grant.
- **A multi-line entry in `FEATURES` is invisible to the law test.**
  `pro-and-blockers` reads each row as a one-line ``key: Object.freeze({ tier:
  '...' })``, so the first cut of `moreTokens` -- wrapped over four lines for its
  long label -- was silently not a row, and the guard that says "adding a feature
  means adding its gate" passed for free. The label is a const above the table
  now.
- **The help article went with it.** "Press Connect again -- it now reads Add
  another" sends somebody looking for a button that does not exist, which reads
  as the product being broken. An article describing a retired feature is worse
  than no article.
- `test/one-channel.test.mjs` is the guard against it creeping back, because the
  pieces are scattered: an allowance in billing, a cap enforced twice, a switcher
  in the host, a picker in the dialog and a mode in the store. Three files that
  tested the feature (`channel-lanes`, `schedule-clarity`, `multi-channel`) are
  deleted rather than left asserting behaviour nobody ships.
