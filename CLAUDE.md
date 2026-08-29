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

- `npm test` and `npm run check` must pass. Currently **848 JS + 407 Python**
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
  **It is NOT ARMED YET, and until it is, nothing about it has run on the box.**
  It needs one repository secret, once — Settings → Secrets and variables →
  Actions — and either of two will do:
  **`WORKER_SSH_KEY`** = the whole of `~/.ssh/deenclipped_worker`, which lives
  on the Mac; or **`WORKER_SSH_PASSWORD`** = the box's root password, which is
  the one a PHONE session can arm, since the key file is out of reach there.
  The key is preferred and wins when both are set; adding it later leaves the
  password unused. **The password path is unverified** — nothing in this
  container can reach port 22 to test it, and a key-provisioned box usually
  ships `PasswordAuthentication no`, in which case only the key works. Use the
  key when the Mac is at hand. (`WORKER_HOST`/`WORKER_USER` optional.) Without either, the
  run fails at the first step and prints exactly this, rather than reporting
  green having done nothing — dispatched twice on 29 Aug 2026 to confirm that
  is precisely what happens.
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
  no privacy control at all. **But Google also locks uploads from an API
  project that has not passed the compliance audit to private**, whatever the
  request asks for — the dialog says so in one line, because without it a
  private video reads as the app ignoring the instruction. **TikTok is the one
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
- The host caches `/api/deenai` on `window.DC_DEENAI` and reattaches it on
  every state poll (the same move as DC_OWNER), because `/api/state` replaces
  DATA wholesale. The answer itself lives in UI state (`aiAnswer`), not DATA,
  so a poll cannot wipe a reply mid-read.

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
- **A tagline is a promise.** Studio's said "approve on autopilot" for one
  release after auto-approve was dropped from it. Corrected to "jump the
  queue"; if a feature moves, its sales copy moves with it.

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

## Open items

### Waiting on Youssef (nothing in the repo unblocks these)

1. **Send the YouTube compliance reply** — drafted in Gmail, unsent, deadline
   ~8 Sept 2026. Details below; the short version is that it withdraws the
   quota request rather than repeating it. The AUDIT, not the quota, is what
   forces uploads private.
2. **TikTok app review** — record the demo and submit (`TIKTOK-SUBMISSION.md`).
   Until then an unreviewed app may only post to a TikTok account that is
   itself private; setting the account private is the way to post today.
3. **Worker deploy on Hetzner** — the section-download saving (v3.12.0) is not
   live until it runs.
4. **Stripe identity document**, task `astask_1U94FLKKpFy0S4hepCXWS9HY`.
   Payments work; payouts are paused until it is uploaded.
5. **Hetzner CPX41 rescale.** Once done: worker retune (4 jobs, whisper medium,
   `qwen3:4b`), ETA recalibration, an end-to-end run with before/after numbers.
6. **Reconnect YouTube** — the stored token is expired and posts are missing
   their slots.
7. **A stranger test** — someone who has never seen the product signs up and
   uses it. Claude cannot create an account, so this one needs a real person.

### Known gaps in the product

- **One account per platform.** `publishingSettings[provider].accountId` is a
  single id, so a clip cannot go to two YouTube channels. Posting to several
  accounts needs the settings shape to become a list and the target builder to
  fan out over it.

- **YouTube API compliance review** (project 881648803263) is at its last open
  question, drafted in Gmail and unsent; deadline ~8 Sept 2026 (7 business days
  from Google's 27 Aug message).
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
