# TikTok demo video — shooting script

Written 3 Sept 2026. Aim: 3–4 minutes, under 50MB, mp4 or mov.

The last recording failed for one reason above all others: **it never showed
TikTok connected.** At 10:00 of 10:24 the Channels page still read "Not
connected", and the final seconds showed `0 connected`. No consent screen, no
account, no post. A reviewer watching that has been shown nothing.

Everything below exists to prove one specific thing to a reviewer. If a beat
feels redundant, it is not — it is the evidence for a scope.

---

## Before you press record

- [ ] Pause the other Claude session. Its pushes take the site down for ~40s.
      A 502 mid-take means shooting again.
- [ ] Back up the production `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET`.
      This is the only step with no undo.
- [ ] Put the **sandbox** pair into Render, save, wait for the deploy.
- [ ] Use **Safari**, not Chrome — Chrome is holding the filled submission form.
- [ ] Sign in to TikTok as **`deenclipped`** in that browser first. It is the
      registered sandbox target user; no other account can authorise.
- [ ] In the app, **disconnect TikTok**. You are going to connect it on camera.
- [ ] Have one approved clip ready in the review queue.
- [ ] Close every other tab. One window, nothing personal on screen.
- [ ] Record the browser window, not the whole desktop.

---

## The shot list

### 1 — The domain (0:00–0:10)

Start with the address bar visible showing **`deenclipped.online`**, then sign
in.

*Proves: the app is the website named as the Website URL. A reviewer checks
this first and rejects immediately if the domain does not match.*

### 2 — Connect TikTok, on camera (0:10–0:50)

Settings → **Connections** → TikTok → **Connect**.

Let the **TikTok consent screen** fill the frame. Do not rush it. Let the
reviewer read the scopes it lists. Approve it.

Come back to Connections and **rest on the connected row for a full 5 seconds**
— the display name and avatar must be legible.

*Proves: `user.info.basic`. This is the single beat the old recording was
missing. The consent screen and the resulting profile ARE the evidence.*

### 3 — The clip is the creator's own (0:50–1:30)

Open **Lecture library**, show the lecture you imported, and say plainly — out
loud or in a caption — that this is your own lecture. Open the review queue and
play a few seconds of the clip made from it.

*Proves: "only the creator's own content is posted." Reviewers reject apps that
look like they repost other people's videos. Do not skip this.*

### 4 — The publish dialog, slowly (1:30–2:45) — THE MOST IMPORTANT BEAT

Approve/post the clip so the TikTok options panel opens. Then move the cursor
over each item and pause on it:

- The **account** it will post to
- **Privacy level** — open the dropdown so the options are visible. Only
  `SELF_ONLY` will be there. **Say so:** "the app only offers the levels
  TikTok's creator_info endpoint returns for this account."
- **Allow comments / Allow Duet / Allow Stitch** — show their state
- The **commercial content disclosure**, off by default. Turn it ON, so
  "Your brand" and "Branded content" appear, then turn it back OFF.
- **"By posting, you agree to TikTok's Music Usage Confirmation."** Hover it.
  Every DeenClipped clip mixes in a nasheed, so this line matters more here
  than for most apps.

*Proves: `video.publish`, and compliance with the content-sharing guidelines —
options fetched fresh from `creator_info/query/`, privacy chosen and never
defaulted, disclosure not asserted on the creator's behalf, music confirmation
shown.*

### 5 — Post it, and show it landed (2:45–3:30)

Press post. Stay on screen while it uploads. Show the success state in the app,
then **open TikTok and show the video on the `deenclipped` account.**

*Proves: the integration actually works end to end. A recording that stops at
"uploading" proves nothing.*

---

## Say this out loud somewhere in the video

> "The privacy list shows only Private because this app has not been approved
> yet. We render exactly the options the creator_info endpoint returns and
> reject anything not in that list."

Without it, a reviewer may read a private-only post as the app ignoring their
privacy rules — when it is in fact the app obeying them.

---

## What must NOT be in the frame

- Any other person's TikTok content
- A 502 page
- Your production API keys, Render's variable values, the Stripe dashboard
- Any other creator's account
- Dead air longer than ~5 seconds

---

## The five reasons apps like this get rejected, and where each is handled

| Rejection reason | Beat |
|---|---|
| Scope shown but never demonstrated | 2 and 4 |
| Domain does not match the Website URL | 1 |
| Cannot tell whose content is posted | 3 |
| Privacy defaulted rather than chosen | 4 |
| Flow does not complete | 5 |

---

## After the shoot

1. Check the file is under 50MB. If not, send it to me — ffmpeg will bring it
   down without a re-shoot.
2. Do NOT reload the Chrome tab holding the submission form.
3. Send me the file. I upload it, Save (the first moment Save works), submit.
4. Put the production `TIKTOK_CLIENT_KEY` / `TIKTOK_CLIENT_SECRET` back, and
   reconnect TikTok. Confirm `Connected TikTok account "..."` appears in the
   activity log — do NOT trust "Test connection", which passes on a cached
   token for 24 hours even with a wrong secret.
