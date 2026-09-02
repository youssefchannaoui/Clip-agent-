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

- `npm test` and `npm run check` must pass. Currently **1063 JS + 534 Python**
  (7 Python skipped). These numbers were once wrong by more than a factor of
  two, which made them worse than absent — they still read as authoritative.
  **CI now enforces them** (`scripts/check-handover.mjs`, fed the real test
  output), so this line cannot quietly drift again; a shrinking count is
  reported as tests having VANISHED rather than as a number to update.
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
- **A caption question CAN be settled without the box.** `apt-get install -y
  ffmpeg` gives a build with libass, and that is the whole rig: call the real
  `write_ass`/`ayah_events`, render one frame over black
  (`ffmpeg -f lavfi -i color=c=black:s=1080x1920:d=6 -vf "subtitles=x.ass" ...`,
  seeking PAST the fade -- at t=0 every event is fully transparent and the
  frame comes out empty), then measure the ink by decoding the PNG to gray8
  and scanning rows for the leftmost and rightmost lit pixel. That is how the
  overflow fix was proven: unfixed, ink spanned x 0..1079 with 114 rows
  touching an edge; fixed, x 185..915 and zero. Amiri and Outfit are not in a
  fresh container, so the substituted face is WIDER -- which makes a passing
  wrap test conservative rather than optimistic. Say which face rendered.
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
  ayah. It opens no free-plan hole, because that template is Pro-only: a Basic
  account cannot select it, and a paid account may remove a watermark anyway.
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

## Open items

### Waiting on Youssef (nothing in the repo unblocks these)

1. ~~**Send the YouTube compliance reply.**~~ **SENT, AND THE REVIEW IS
   CLOSED.** Verified in Gmail on 31 Aug 2026 by reading the thread rather
   than this file: the withdrawal went out 28 Aug 07:12, and Google replied
   28 Aug 19:33 — *"We have completed your review and don't require any
   further actions from you at this time."* There is no 8 Sept deadline and
   nothing is drafted-and-unsent. This entry said the opposite for three days,
   which is why it is corrected here rather than deleted.
   **One thing left in the mailbox:** the stale 25 Aug draft is still there,
   in a DETACHED thread (`1a039b45…`, not the review thread `19fd1e1f…`), and
   it says "please find attached screenshots" while carrying no attachments.
   It re-answers a question already answered on 26 Aug. Sending it into a
   closed review would be an unforced error — delete it, do not send it.
   **What this does NOT prove:** that uploads now arrive public. The audit was
   the reason Google forced them private, and that reason is gone, but nobody
   has posted a clip since (the stored token is expired — open item 6). The
   product copy was corrected to stop naming a closed review as the cause
   while still warning that Google can override; it deliberately stops short
   of promising public. **One real upload settles it.**
2. **TikTok app review** — record the demo and submit (`TIKTOK-SUBMISSION.md`).
   Until then an unreviewed app may only post to a TikTok account that is
   itself private; setting the account private is the way to post today.
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

**One clip still captions nothing, and that is honest.** Its recitation was
transcribed as "وسيق الذين كفروا بجها لمذمرا حتى جا اتحت بوابها" -- too far from
39:71 for even a named hypothesis. A wrong ayah on screen is worse than none.
The fix for it is to caption from the LECTURE-wide ayah map rather than
re-matching per clip at render time: the lecture walk does find verses across
that clip's window. That is the next step and it is not done.


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
