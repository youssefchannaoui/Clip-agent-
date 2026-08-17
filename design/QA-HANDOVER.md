# QA handover — Studio dashboard, 17 Aug 2026

Written for whoever tests next. Covers what changed since the 16–17 Aug fix
brief (audited at `23c25be`), what is deliberately still open, and the two
things that will look like bugs but are not.

Branch `deenclipped-v2-2`, head `9a1e7aa`.

---

## Read this first — two false positives

**1. The pipeline rail will sit on step 1 until the worker is redeployed.**

The rail is now driven by a stable `phase` enum emitted by `clip_worker.py`
rather than by matching words. The web service is deployed; **the worker is not**
— that deploy is manual:

```sh
cd /opt/deenclipped && git pull && docker compose -f worker/docker-compose.yml up -d --build
```

Until then the old worker sends no `phase`, and the UI degrades to "start of
rail" rather than breaking. Do not file this as a regression before checking
whether the box has been rebuilt. Same applies to the stall watchdog and to the
grain/warmth/zoom render filters.

**2. `1`, `2`, `3` on Home are onboarding step numbers, not data.**

They read like fabricated stats and are deliberately *not* in
`design/text-overrides.json`. Overriding them breaks the "Paste a lecture / Set
the job / Review and post" steps. The override file says so.

---

## What the fix brief asked for, and where it landed

Every P0, P1, P2 and P3 item is addressed. Highlights worth re-testing rather
than trusting:

| Item | What to check |
| --- | --- |
| P0-1 password wall | Sign up in a private window with email. You should reach the dashboard with no `localStorage` at all. |
| P0-2 nasheed upload | On a fresh account, upload a nasheed from the Studio dashboard, then start a lecture. Both must work. |
| P0-3 plans loop | New account → `/app` → `/plans` → click Dashboard. Must not bounce back. |
| P1-1 `done` vs `ready` | A finished lecture must read Ready, appear under the Ready tab, and leave the live dock. |
| P1-3 slider debounce | Drag a template slider hard. Expect one `PUT`, not one per pixel, and no re-render storm. |
| P1-9 reject | Reject clips, reload. They must stay rejected. |
| P1-10 tenancy | Two accounts. Neither may see the other's log entries — including the owner account. |
| P2-4 template select | Templates must open the *active* style, not the first one. |

## The class of bug the brief was really about

`studio-runtime.js` drops a handler that is not a function, silently — the
element still renders, styled and `cursor: pointer`, with no listener. That is
how seven controls shipped dead.

`test/studio-design.test.mjs` now renders the template across every screen, walks
every `on` binding and asserts it resolves to a function. **If you find another
dead control, that test should have caught it — please work out why it did not,
rather than only fixing the control.** The likely cause is a list that is empty
in the test fixture, since an empty `sc-for` renders no rows and is skipped.

There are matching guards for: every `sc-for` list being supplied as an array
(a string renders one row per character), no `StudioAdapter.on*` hook being
assigned twice, and generated CSS asset paths resolving from the site root.

## Deliberately open — please do not "fix" these

All recorded in `design/DESIGN-GAPS.md` with reasoning.

- **Performance** collects nothing. No views, saves or watch-through exist
  anywhere in the product. Tiles report what is real; the rest reads `—`.
- **Arabic & terms** has no glossary in the data model at all.
- **Token reservation is only as good as the estimate.** In remote mode the
  source duration is unknown until the worker downloads it, so an untrimmed
  remote job holds nothing. The charge still lands on completion.
- **Read state is per browser.** No read/seen field or route exists server-side.
- **Template options are keyed by name.** Duplicates are numbered
  ("Gold (1)") as a label, not a fix — the design needs to emit ids.
- **Empty means empty.** Where there is no data, the screen says so. That is the
  intended behaviour, not an unfinished one.

## What I could not verify

- **A job completing end to end.** Never ran a lecture through download →
  transcribe → score → render. Local attempts were blocked by needing an
  uploaded nasheed and a reachable worker.
- **Anything visual on the live site.** Verified in a local browser and in
  `design/preview.html`. CLAUDE.md's rule holds: a green suite is not
  verification for anything visual.
- **The render filters.** Grain, warmth and zoom are covered by tests that
  assert the *filter string*; no test runs ffmpeg. `colorbalance`, `noise` and
  `vignette` were confirmed present in the worker image by hand.

## Reproducing the environment

```sh
npm run check && npm test          # 310 JS + 82 Python (7 skipped)
npm start                          # then /app, or /app?classic=1 for the previous shell
open design/preview.html           # every screen, sample data, no server
```

`?classic=1` is the escape hatch: the previous dashboard, no deploy needed.
