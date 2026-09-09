# Rebuilding the job panel — a brief

The **job panel** (a.k.a. the Start-job panel) is the eight-step wizard that
opens after a link is pasted. This document is the map, the ideas, and the list
of things a rebuild must not break. It is a PROPOSAL — nothing here has been
decided, and the ranking is mine, not Youssef's.

**Why it is worth rebuilding:** it is the product's whole funnel. Every lecture
this app has ever made went through it, and it is the only screen where a
customer says what they want before spending tokens.

**Why a "complete rebuild" is the risky kind of change:** this panel carries a
lot of behaviour that was bought with real bugs, and none of it is obvious from
looking at the screen. The Constraints section is the important half of this
document; a rebuild that does not carry those forward will reintroduce faults
that are already fixed and already recorded.

---

## 1. What it is today

Eight steps, in `JOB_STEPS` (`src/public/studio-adapter.js`):

```
brief → kind → trim → lengths → style → picture → sound → review
```

| piece | where |
|---|---|
| The overlay's markup | the design export → generated template, hashed `.sNN` classes |
| Step list & order | `JOB_STEPS` — the ONE source of the order; `jobStepNo(id)` reads it |
| State | `UI.job`, `UI.jobStep`, `UI.jobTplId`, `UI.jobLang`, `UI.jobBrief`, `UI.jobPublishTo` |
| Open / fill / close | `beginJob` · `resolveJob` · `failJob` · `openJob` · `closeJob` |
| Bindings | everything prefixed `job…` |
| Host-rendered rows dock into | `#studioJobSlot` |
| On a phone | the same overlay as a bottom sheet, tagged `data-host-ov="job"` |
| Submission | `onGenerate` → `POST /api/videos` |

**What the job actually submits today:** `sourceStartSeconds`/`sourceEndSeconds`,
`templateId`, `musicEnabled`, `musicTrackId`, `language`, `backgroundMode`,
`backgroundId`, `introSeconds`, `publishTo`, `clipBrief`, `sourceMeta`,
`idempotencyKey`.

---

## 2. The configuration gaps

Ranked by how much they change what somebody can actually do. Every one is a
statement about the current code, not a guess.

### A. Two of the eight steps write ACCOUNT settings, not job settings — **worst offender**

The **lengths** step and the **clip count** control both call `onClipSettings`
→ `POST /api/clip-settings`, which writes `clipsPerVideo`, `clipMinSeconds`,
`clipMaxSeconds` and `clipLengthBands` to the ACCOUNT.

So configuring one lecture silently changes the default for every future
lecture, and there is no way to say *"just this one — twenty clips of
30–45 seconds"*. It is a per-lecture wizard quietly editing global settings, and
nothing on the screen says so.

**The fix:** `clipsRequested` and `clipLengthBands` become per-job fields
carried on the project (like `clipBrief` already is), with the account setting
as the default and an explicit, separate **"make this my default"** act. That
is the same shape `clipBrief` already has, so there is a working precedent for
the whole round trip.

### B. The style step picks a template and can adjust nothing inside it

Picking a style picks one of five templates. Every one of the ~60 style fields —
caption size, position, colour, the twelve looks, the four weather effects,
grain, darken — is reachable only from the Templates screen (account-wide, per
template) or the clip editor (per clip, after the fact).

So there is no *"this lecture, bigger captions and the warm look"* without
changing it for every lecture that template renders.

**The fix, and it does NOT break the one-template-per-content-type law:** a
per-job **style overrides** layer stored on the PROJECT and applied to every
clip it produces, never written back to the template. `clip.styleOverrides`
already exists and already works this way per clip — this is the same object one
level up. Offer a handful (caption size, position, look, atmosphere), not all
sixty.

### C. The server already takes several links; the panel only ever sends one

`POST /api/videos` splits `body.urls` on newlines and commas and submits each
one, returning a `results` array. The panel has never sent more than one.

**The idea:** paste a playlist or five links, configure once, queue them all.
Two real design problems to solve first, so this is not a free win: one
`sourceRange` is shared across the batch (so a batch means "whole lecture" or a
range per link), and one `idempotencyKey` is shared (so it needs to be per link
or the dedupe collapses the batch into one project).

### D. Auto-approve is account-wide, so it cannot be trusted per lecture

`automationSettings` (on/off, minimum score, max per source) is a global switch.
There is no *"this speaker is reliable — approve anything over 80 from this
lecture"*, and no *"this one I want to review myself"* on an account that
otherwise runs automatically.

Note the law it must respect: a clip containing scripture forces human review
whatever the setting says (`QUOTE_RISK`), and approving automatically stamps
`approvedBy` in a way that **skips TikTok**, which requires a per-post consent a
person gave. So per-job auto-approve must keep both.

### E. Output shape is not offered at all

Templates carry `width`/`height` and the safe-zone model already follows the
output shape (a 1:1 export is letterboxed and loses less to platform chrome).
Every shipped template is 1080×1920 and nothing anywhere lets anyone ask for a
square or a landscape cut.

### F. Nothing about WHEN it posts is decided here

`publishTo` chooses the destinations. There is no *"spread these over the next
three days"*, *"one a day"*, or *"hold everything for me"* — the schedule is
decided afterwards, on another screen, by rules the panel never mentions.

---

## 3. The idea that would matter most: job presets

Everything above is a knob. This is the thing that makes eight steps bearable.

**A named, saved configuration** — brief, kind, lengths, count, style, picture,
sound, destinations — reusable in one tap. *"Friday khutbah"*, *"Quran short"*,
*"Podcast clip"*. Configure once, then paste-and-go forever.

It also solves a rule that currently costs the customer time on purpose:
`UI.jobPublishTo` is deliberately CLEARED on every job, because a per-lecture
choice must never silently become the new default. A preset is the sanctioned
way round that — choosing one is an explicit act, so it is not a setting
changing behind anybody's back.

Companion ideas:
- **"Use my last settings"** on step 1 → jump straight to review.
- **Guess the kind from the lecture.** The title is already fetched before the
  panel opens; a recitation usually says so. Preselect, never decide silently.

---

## 4. Looks and motion

The panel works and is plain. Things worth doing, all of which the app already
has a precedent for somewhere:

- **A progress rail, not "1 / 8".** Lit nodes along a spine — the device the
  affiliate screen and the task ladder already use — so the eight steps read as
  a path rather than a count.
- **Directional step transitions.** Forward slides in from the right, Back from
  the left. The phone shell already does exactly this (`dcm-in-next` /
  `dcm-in-prev`); the desktop panel does not.
- **A live 9:16 preview that persists across the steps** instead of appearing
  only at the style step — the Templates screen already renders one from the
  real style fields, so the preview would be the renderer's own answer rather
  than a drawing.
- **A cost and ETA footer that is always visible** and updates as the range
  moves, rather than being revealed at the end. The trim step is the step you
  pay for; the number should be next to the handles.
- **The review step as one sentence**, not a table: *"Look for repentance, cut 6
  clips of 30–60s in Clean Line, nasheed underneath, post to YouTube and
  Instagram."*
- **Skeletons while the box is being asked** (already done for the header —
  extend it to the poster and the range).

---

## 5. Constraints a rebuild must not break

**This is the section to hand Fable.** Every line is a bug this repo has already
paid for.

1. **Do not rebuild the panel on every keystroke or press.** The render
   signature must be STRUCTURE ONLY; the selection is applied in place. Putting
   the selected value in the signature rebuilds all four cards on every press,
   kills every CSS transition, and eats the caret in a textarea. (v3.113.0)
2. **A control must paint before the network, not after it.** Chips that waited
   for `POST` + a full `GET /api/state` felt broken. Apply locally, paint, then
   write, and reconcile on the response — through the existing `studioDo` so a
   refusal still surfaces. (v3.99.2)
3. **`JOB_STEPS` is the only copy of the order.** No hardcoded step numbers
   anywhere — `jobStepNo(id)`. Inserting a step at the front once silently
   repointed every review row at the wrong question.
4. **Any host-rendered node needs `data-host-owned`**, and must be redrawn only
   when its markup actually changed (`dcSetHtml`). `data-host-*` is the only
   attribute family the patcher never strips. An unmarked node makes the
   patcher pair every sibling after it one across.
5. **A click inside the panel must not close it.** The overlay's backdrop
   carries the close handler; the card must swallow clicks, or every text field
   dismisses the dialog when you click into it.
6. **Trap focus.** `aria-modal` is a promise; without a trap, Tab walks out
   behind the scrim into the page.
7. **The brief stays OPTIONAL, and its ranking is arithmetic — not the model.**
   An empty brief must produce a byte-identical payload and byte-identical
   clip selection. It is also the one field a customer types that reaches a
   prompt, so it stays fenced against injection.
8. **Cost must never claim a figure it cannot support.** `durationKnown: false`
   is a real state (a link whose length nothing could read) and the panel must
   render it honestly rather than inventing a length.
9. **Gates are server-side.** Pro styles, the watermark, plan limits — a client
   flag is a suggestion. Read them from the FEATURES table, never a typed tier
   name.
10. **Scripture rules are not overridable:** nothing is drawn over an ayah, the
    Quran template captions scripture and nothing else, and those clips force
    human review.
11. **Captions must sit inside the safe zone** the safe-zone model computes.
12. **No dead controls.** Anything shown must reach the export. If a setting
    cannot be honoured, say so instead of drawing a switch.
13. **The phone renders from the SAME bindings.** Do not fork the panel — every
    control needs a 44px target and the overlay becomes a bottom sheet.
14. **Gate every entry animation.** The studio repaints on every state poll, so
    an ungated animation replays every few seconds and reads as a flicker. Use
    `backwards`, never `both` — a forwards fill silently kills hover for the
    element's life. Give every rule a `prefers-reduced-motion` escape, and note
    that a bare `*` rule never matches a pseudo-element.
15. **Theming:** colours come from tokens; re-run `build-light-theme.mjs`; a
    rule written entirely in `var()` names is the escape hatch for anything that
    must not be remapped. Measure contrast on the COMPOSITED ground, in both
    themes, with the body class read back.
16. **Adding to the design export renumbers every hashed class in the app.**
    Adding a `data-` attribute has been proven byte-stable; adding an element
    has not. Prefer host-rendering into `#studioJobSlot`.

---

## 6. What NOT to do

- **Do not put the style editor in here.** The Templates screen owns the
  template; this panel owns THIS LECTURE. Per-job overrides, not a second
  editor. Two controls for one setting is the fault this codebase has shipped
  four times.
- **Do not make the brief mandatory, or gate Continue on anything new.** A false
  gate on the length step already cost every new account a forced choice that
  did nothing.
- **Do not let a per-lecture choice become a new default silently.** Presets, or
  an explicit "save as default".
- **Do not add a step without deleting one.** Eight is already a lot; the win is
  presets and better defaults, not more questions.

---

## 7. Suggested order

1. Per-job clip count and length bands (gap A) — biggest correctness win,
   smallest surface.
2. Job presets + "use my last settings" (§3) — biggest time win.
3. Per-job style overrides (gap B).
4. Looks and motion (§4).
5. Batch links (gap C), per-job auto-approve (D), output shape (E), scheduling
   (F) — each is its own piece of work.
