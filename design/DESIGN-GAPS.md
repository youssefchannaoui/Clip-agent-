# What the design needs to change

The adapter can only fill a `{{ binding }}`. Everything below is a place where the
Studio design either bakes data in as literal text, or draws a control the product
cannot deliver. None of it is fixable from this repo — it needs a change in the
Claude Design project, then a re-import.

Written 17 Aug 2026 against `Studio Dashboard.dc.html`, 303 bindings.

Fixing any of this means editing the Claude Design project, then running
`npm run design:pull` here. Claude Design's GitHub access is read-only, so a fix
on that side never reaches this repo on its own.

## 1. Hardcoded data that must become bindings

These render as fixed text today. On a real account they are wrong, and a few are
actively misleading — this app is multi-tenant (`src/tenancy.js` scopes every
record to an account), so anything naming Youssef or a card number ships to every
customer.

The worst offenders:

| Shown | Why it matters |
| --- | --- |
| `3 connected · TikTok needs reconnecting` | States a connection status that is never checked. An account with nothing connected still reads "3 connected". |
| `Visa ending 4242 · expires 04/29` | A payment method that does not exist, on the billing screen. |
| `Youssef Channaoui`, `Studio · Salām, Youssef` | Another customer sees Youssef's name. |
| `148 of 250 GB`, `112 GB`, `34 GB`, `2 GB` | Storage figures the product does not measure. |
| `Patience in Hardship — Part 2`, `42:11 source · 6 clips requested` | A fake job on the "Processing now" card, beside the *real* progress rail. |
| `860 spent this month`, `≈ 20 hours of lecture processing` | Invented spend against a real token balance. |

Full list of literal strings containing data:

- `2 need you`
- `Youssef Channaoui`
- `Studio · Salām, Youssef`
- `3 connected · TikTok needs reconnecting`
- `This is what one 38-minute lecture produces`
- `0:34`
- `0:41`
- `0:52`
- `12 in total`
- `A URL you have permission to use, or upload the MP4.`
- `From one 38-min talk`
- `Patience in Hardship — Part 2`
- `42:11 source · 6 clips requested`
- `Upload MP4`
- `Playlists and unsupported links fall back to upload. MP4, MOV, M4V, WebM and MKV go straight to storage.`
- `148 of 250 GB`
- `112 GB`
- `34 GB`
- `2 GB`
- `Long lectures cost more tokens — 1 per source minute.`
- `0:14`
- `Four posts a day, spread across your connected accounts. The worker will not queue a fifth — it holds the clip for the next open day.`
- `Today is full — 4 of 4. Nothing posts unless its four checks pass.`
- `13:00–15:00`
- `18:00–19:30`
- `21:00–23:00`
- `MP3, M4A or WAV · instrument-free or duff-only recommended`
- `drops 6 dB while the shaykh talks`
- `1080 × 1920`
- `30 fps`
- `AAC 192 kbps`
- `Re-rendering this clip costs 1 token. Saving to all clips of the lecture re-renders each of them.`
- `≈ 20 hours of lecture processing, or about 62 rendered clips at your current settings.`
- `860 spent this month · resets nothing — tokens never expire`
- `Visa ending 4242 · expires 04/29`
- `42:11 · source lecture`
- `09:14 / 42:11`
- `Reconnecting refreshes the publishing token — your scheduled posts keep their times. A test upload posts privately and deletes itself.`
Some of these are genuinely static and fine to leave (`1080 × 1920`, `30 fps`,
`AAC 192 kbps` are fixed output specs; the guidance copy about permitted content
is policy text). The rule of thumb: if it would differ between two accounts, it
has to be a binding.

## 2. Controls the product cannot deliver

`CLAUDE.md` records this as a load-bearing invariant: *"No dead controls. A
control that cannot reach an export must not be shown."* The render pipeline has
no `concat`, `trim`, `atrim` or `select`, and its only `overlay=` is the blur
background.

These are drawn by the design and are **omitted by the adapter** rather than wired
to nothing. They should come out of the design too:

| Control | Why it cannot work |
| --- | --- |
| Auto headline | Drives `hookEnabled`, which `sanitiseTemplate()` hard-disables (`src/templates.js:129`). |
| Intro / outro | Same field, same problem. Also needs `concat`. |
| Remove filler words | Needs `atrim`/`select`. Not available. |
| Remove long pauses | Needs silence detection plus cutting. Not available. |
| Keyword highlighter | No field in the template schema. |
| Caption emojis | No field in the template schema. |
| Stock B-roll | Needs compositing. Not available. |

## 3. Screens with no backend behind them

Both render their frame and are left empty rather than filled with invented data.

**Performance.** Nothing in the product collects views, saves or watch time —
`social.targetPublic()` carries delivery status only. The screen asks for
`views`, `saves`, `watch` and a `perfPatterns` breakdown that has no source. The
tiles currently report what is real: clips generated, approved, posted, lectures.
Making the rest work needs per-post metrics pulled back from each platform's API
and stored on the clip record.

**Arabic & terms.** There is no glossary in the data model at all;
`settingDefaults()` has only `clipSettings`, `musicSettings`, `automationSettings`,
`publishingSettings` and `selectedTemplateId`. The screen needs a terms field on
the account and an endpoint before it can do anything.

## 4. Fixed since this was written

**Grain, warmth and crop zoom now work.** They were dead in *both* editors, not
just the new one: `sanitiseTemplate()` builds its output from a whitelist, and no
field held `grain`, `warm`, `smartFramingZoom`, `cropPositionX/Y`,
`smartFramingPadding`, `smartFramingSmoothing` or `captionTimingOffsetMs`. Every
one of those values was discarded on save, so moving the sliders in the legacy
editor changed nothing.

`grain`, `warm` and `smartFramingZoom` now have schema fields and worker filters
(`colorbalance`, `noise`, and a zoom applied to the crop). The rest are still
dropped — `cropPositionX/Y` and the tracking controls would need the worker's
framing plan to accept them, and `captionTimingOffsetMs` needs the caption
renderer to shift.

**The worker deploy is manual.** These filters do nothing in production until the
Hetzner box is redeployed:
`cd /opt/deenclipped && git pull && docker compose -f worker/docker-compose.yml up -d --build`

## 5. Smaller fixes

- **Reject has no home.** The server moves a clip between `waiting` and
  `approved` and nothing else; the only way to remove one is `DELETE`. The deck's
  Reject button is therefore local and forgotten on reload. Persisting it needs a
  rejected state on the clip record.
- **`rotCount` pluralisation.** The template writes `{{ rotCount }} nasheeds in
  rotation`, so a single track reads "1 nasheeds". The noun needs to move into
  the binding.


## 5. Still open after the 16–17 Aug QA pass

Everything else from that pass is fixed. What remains needs a design change, not
a code change here.

- **Template options are keyed by name.** The design renders
  `<option value="{{ opt }}">` over a list of strings, so two templates with the
  same name are indistinguishable. Worked around by numbering duplicates
  ("Gold (1)", "Gold (2)"), which is a label, not a fix. The design should emit
  `{ id, name }` and bind the id.
- **The unread dot has no binding.** It is a bare `<span>` compiled in
  unconditionally, so it can only be hidden from `index.html` via CSS targeting
  the Phosphor icon class. A `sc-if` on an `unread` binding would remove that
  workaround.
- **Read state is per browser.** There is no read/seen field or route on the
  server, so "mark all read" is remembered in localStorage with a memory
  fallback. Persisting it properly needs a field on the account.
- **Performance and Arabic & terms still have no backend.** Unchanged from
  section 3: no view/save/watch metrics are collected anywhere, and there is no
  glossary in the data model.
- **Reservation is only as good as the estimate.** Tokens are now held against a
  job before it runs, but in remote mode the source duration is unknown until the
  worker downloads it, so nothing can be held for an untrimmed remote job. The
  charge still lands on completion; the hold is an improvement where the length
  is knowable, not a guarantee everywhere.
