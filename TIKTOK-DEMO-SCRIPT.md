# TikTok demo recording — shot by shot

What to record, in order, to pass TikTok's app review. Every numbered shot maps
to something the reviewer is told to look for; a recording that skips one gets
rejected without a reason you can act on.

**Hard constraints:** under 50MB, `.mp4` or `.mov`. The old recording was
286MB / 10m24s and unusable. Aim for **3–4 minutes**. No music, no titles, no
edits that cut between steps — reviewers want one continuous, unedited take.

**Before you press record**

- Sign out of DeenClipped, then sign back in during the recording. A reviewer
  must see the connection made, not one that already existed.
- Have the TikTok account you will post to **set to private**. An unaudited app
  may only post to a private account; posting to a public one returns the 403
  you already hit.
- Close every other tab. The address bar must read `deenclipped.online`
  throughout — it has to match the Website URL on the app.
- Screen only. No webcam, no voiceover needed (captions below are optional).

**Unresolved before you record:** the portal says an app never approved "is
required to use a sandbox environment to demonstrate the integration". Check
the Sandbox tab first. If it demands sandbox credentials, recording against
production may have to be redone.

---

## Shot 1 — the domain (0:00–0:15)

Open a browser. Type `deenclipped.online` in the address bar and press enter.
Let the home page load and sit on it for three seconds.

*Why:* the domain must visibly match the Website URL registered on the app.
Do not start from a bookmark or an already-open tab — they need to see it typed.

## Shot 2 — sign in (0:15–0:35)

Sign in to your account. Land on the studio.

## Shot 3 — the consent screen (0:35–1:15) — **the one that proves `user.info.basic`**

1. Open **Channels** (the connections dialog).
2. Show TikTok reading **Not connected**. Pause two seconds on it.
3. Click **Connect TikTok**.
4. **Let TikTok's own consent screen fill the frame.** Do not rush it. The
   permissions list must be readable.
5. Approve it.
6. Back in Channels, pause on the connected row: your **display name and
   avatar** are now shown.

*Why:* this is the entire justification for `user.info.basic`. The previous
recording failed here — it still showed "Not connected" at 10:00 of 10:24.

## Shot 4 — your own content (1:15–1:45)

1. Go to **Lecture library**.
2. Point at a lecture **you uploaded or own**, and say so in an on-screen note
   if you are narrating.
3. Open the **Review queue** and pick a clip cut from that lecture.
4. Play three or four seconds of it so the reviewer sees a real clip.

*Why:* "Only the creator's own content is posted" is in your review note. Show
it being true. Do not use a clip from someone else's lecture in this recording.

## Shot 5 — the publish dialog (1:45–2:45) — **the compliance shot**

Open the posting options for TikTok and hold still long enough to read:

- **Who can see your posts** — the audience list. It must show the levels
  returned by `creator_info/query/`, with **nothing preselected**.
- **Comment / Duet / Stitch** toggles, in the state the account allows. If your
  account disables one, show it greyed out with its tooltip.
- The **commercial content disclosure** unchecked, and the **Music Usage
  Confirmation** line beneath it.
- Your TikTok **nickname** on the panel.

Then choose **Only me (SELF_ONLY)** deliberately, on camera.

*Why:* TikTok's content-sharing guidelines require the creator to choose a
privacy level with nothing preselected, to see interaction settings fetched
fresh, and to see the music declaration. This shot is where the review is won
or lost.

## Shot 6 — post it (2:45–3:30)

1. Press post.
2. Stay on screen while it uploads — do not cut.
3. Show the success state in DeenClipped.
4. **Open the TikTok app or web, and show the post existing on the account**,
   marked private.

*Why:* they need proof the API call completed, not just that your UI said so.

---

## What must NOT appear

- Any clip from a lecture you do not own.
- A public or friends-only privacy level. `SELF_ONLY` only, until audited.
- Auto-posting. Say plainly — on screen or in the notes — that **every clip is
  approved by hand**; nothing publishes on its own.
- Cuts between steps. One take.

---

## The review note to paste alongside it

Reuse the wording already agreed in `TIKTOK-SUBMISSION.md`, which explains that
`video.upload` ships bundled with the Content Posting API and that your OAuth
request asks only for `user.info.basic` and `video.publish`. That question gets
asked every time it is not answered up front.

---

## After it passes

`TIKTOK-SUBMISSION.md` step 6: **delete the old app `7668669224428029959`.**
Updating Render stopped this app using the leaked secret; the secret stays valid
against the old app until the old app is gone. The rotation is not closed until
then — and do it only once a fresh connect proves the new credentials work,
because the old app is the only way back if they do not.
