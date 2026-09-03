# TikTok app: submission state and the secret problem

Recorded 24 Aug 2026 by reading the developer portal against the code.

| | |
|---|---|
| Old app | `7668669224428029959` — Draft, never submitted. **To be deleted.** |
| New app | `7677448222683531285` — created 24 Aug 2026, fresh client key + secret |
| Ownership | Individual |

---

## Why the app was rebuilt instead of the secret rotated

`TIKTOK_CLIENT_SECRET` was pasted into a transcript on 6 Aug and was the last
item outstanding from SECRET-ROTATION.md. **The portal has no rotation
control**: the credentials card reveals only, and the overflow menu offers just
`Transfer ownership` and `Delete app`. Checked directly, not assumed.

So the choice was recreate, or ask support and wait. Recreate, because:

- Recreating is free **only while the app is unapproved**, and it was. After
  approval the same move costs the approval.
- The leak is close to inert today, which is why this was never urgent:
  `client_key` + `client_secret` reach nothing on their own — every API call
  needs a *user* access token; authorization codes are only ever delivered to
  the registered redirect URI, which an attacker does not control; refresh
  tokens are sealed under the `SOCIAL_TOKEN_KEY` rotated on 24 Aug; and no
  third-party creator has ever connected through an unapproved app.
- It stops being inert the moment the app is approved and creators connect —
  exactly when it can no longer be fixed.

---

## Code / portal reconciliation

| Portal setting | Code says | Verdict |
|---|---|---|
| Direct Post ON | `/v2/post/publish/video/init/` + `creator_info/query/` (`social.js:784,858`) | correct, enabled |
| Verify domains | `source: FILE_UPLOAD` = push_by_file (`social.js:856`) | **not needed** — pull_by_url only |
| `user.info.basic` | requested (`social.js:186`) | keep |
| `video.publish` | requested (`social.js:186`) | keep |
| `video.upload` | **never requested** | **cannot be removed** — see below |

**`video.upload` is not removable, and its presence on the old app was never a
mistake.** It ships bundled with Content Posting API: the scope list shows it as
"Included in Content Posting API" with no delete control, and the `Add scopes`
dialog offers only *additional* scopes (`user.info.stats`, `user.info.profile`,
`video.list`) — the bundled three are not listed at all. Since TikTok asks you
to explain every scope, the review note now says outright that `video.upload`
comes with the product and the OAuth request asks only for the other two.

Privacy handling is already correct for an unaudited app: `privacy` defaults to
`SELF_ONLY` and is rejected unless it appears in the creator's returned
`privacy_level_options` (`social.js:828-829`).

---

## URL properties are per-app, not per-account

The new app started unverified, and both the terms and privacy URLs error until
a signature file is served. Verified 24 Aug via **URL prefix**
`https://deenclipped.online/` — the method the codebase already supports, since
`server.js:781` globs any root-level `/tiktok*.txt`.

- New file: `tiktok3SmWqNIyTDMrApqikiaKuTrZPErJ1wCr.txt` (commit `f359a5e`)
- Old file: `tiktok4j8mTWgMoRmOiR9kobH02eR2qThxiQIT.txt` — **delete once the old
  app is deleted**, not before.

The content format is `tiktok-developers-site-verification=<token from the
filename>`, confirmed by the old file serving 200 in production and by the new
one verifying on the first try.

The DNS-record method (whole domain plus subdomains) was the alternative and is
still available if a future app would rather not depend on a deploy.

---

## The form cannot be saved until a video is uploaded

**This is the thing to know before touching the draft.** TikTok refuses `Save`
while any error remains — "Please correct all errors before you save changes" —
and the missing demo video is an error. So there is no way to bank partial
progress: everything below was entered into the browser and is lost if the tab
reloads before a video exists. Every value is recorded here for exactly that
reason.

### Entered and correct (as of 24 Aug, unsaved)

- App name `DeenClipped`, Category Education
- Icon: 1024x1024 (`~/Downloads/DeenClipped-TikTok-App-Icon.png`)
- Description (111 chars): `Turns long-form Islamic lectures into short vertical clips with captions, then posts them to your own channels.`
- Terms `https://deenclipped.online/terms`, Privacy `https://deenclipped.online/privacy`
- Platform Web, Web/Desktop URL `https://deenclipped.online/`
- Products: Login Kit (redirect URI `https://deenclipped.online/auth/tiktok/callback`), Content Posting API with Direct Post ON
- Review note, 996/1000 chars — see below

### Review note, verbatim

```
DeenClipped turns a creator's own long-form lectures into short vertical clips with captions, then publishes them to that creator's own TikTok account.

Login Kit (user.info.basic): the creator connects their account via OAuth. We read open_id, display_name and avatar_url only, and show them in Settings > Channels so the creator can confirm the account before anything is posted.

Content Posting API (video.publish): posts a clip the creator made from their own source video. Before every post we call /v2/post/publish/creator_info/query/ and render the returned privacy_level_options, comment/duet/stitch settings and nickname, fetched fresh. The creator picks a privacy level from the options the API returns; any level not in that list is rejected. Nothing posts automatically: each clip is approved by hand. Only the creator's own content is posted.

video.upload is listed only because it ships with Content Posting API; our OAuth request asks for user.info.basic and video.publish alone.
```

---

## The demo video has to be re-recorded

**The old one is unrecoverable.** In the portal it is a chip with a remove `x`
and no preview or download control, and the local file is gone — Spotlight finds
no `Screen Recording 2026-08-07`. `~/Movies/CapCut/0807.mov` is a different
export (20:42 vs the uploaded 18:02), 286MB and 10m24s, over the 50MB cap.

Whether the old one would have passed is moot, but worth knowing: in that
CapCut recording, the Channels page still shows TikTok **"Not connected"** at
10:00 of 10:24, and `0 connected` in the final seconds. No consent screen, no
connected account, no post.

What a compliant recording must show, from TikTok's own rules on the page:

1. Open `deenclipped.online` — the domain must match the Website URL.
2. Connect TikTok: the OAuth consent screen, then the connected account's
   display name and avatar in Settings > Channels. That is what demonstrates
   `user.info.basic`.
3. Pick a clip the creator made from their own source video.
4. The publish dialog showing the privacy options returned by
   `creator_info/query/` — comment/duet/stitch state and nickname.
5. Post, and show the result. `SELF_ONLY` is the only level an unaudited app
   can use.

**Sandbox caveat — RESOLVED 3 Sept 2026** by opening the tab rather than
reasoning about it. The requirement is real and is printed on the App review
page verbatim: *"If your app has not been approved before, you are required to
use a sandbox environment on the Developer Portal to demonstrate the
integration."* So the recording must be made against the sandbox.

The good news is that the sandbox was already built on 24 Aug and needs nothing:

| | |
|---|---|
| Sandbox | `DeenClipped Dev`, id `7677507072518473748` |
| Icon | already uploaded (the Production draft's is NOT) |
| Target user | `deenclipped`, added 24 Aug 2026 18:38 |
| Credentials | its OWN client key + secret, separate from Production |
| Redirect URI | `https://deenclipped.online/auth/tiktok/callback` — the real one |

That last row is what makes this workable: the sandbox points at the production
callback, so the recording can be made on the real site, which is also what
TikTok asks for ("showcase the website or app where the features will actually
be integrated").

**The cost, and it is the thing to decide before starting.** The sandbox issues
a DIFFERENT client key and secret, so recording means putting the sandbox pair
into Render for the length of the recording and then putting the production
pair back. While the sandbox pair is live, **the existing TikTok connection
stops working** — the stored refresh token was issued to the other client — so
the account has to be reconnected during the recording (which the recording
wants to show anyway) and reconnected again afterwards. Do not start this
mid-schedule: check nothing is due to post first.

**Production draft state, 3 Sept 2026:** empty except the app name. Everything
entered on 24 Aug was lost exactly as this file predicted, because Save is
refused while the demo video is missing. The values above are still the record
to retype from. The icon is still at
`~/Downloads/DeenClipped-TikTok-App-Icon.png` (verified present).

---

## Content-sharing compliance (added before the demo recording)

TikTok's content-sharing guidelines put requirements on the posting UX, not just
on the API call. Checked against the guidelines rather than from memory, four
were unmet:

- **Commercial content disclosure**, off by default, with "your brand" and
  "branded content" beneath it. The payload previously sent
  `brand_content_toggle: false` as a **constant** -- a declaration the creator
  never made.
- **"By posting, you agree to TikTok's Music Usage Confirmation."** Absent
  entirely, which matters more here than for most apps: every DeenClipped clip
  mixes in a nasheed.
- **Branded Content Policy** wording, shown once branded content is selected.
- **Privacy chosen, never defaulted.** The setting defaulted to `SELF_ONLY` and
  the publish path fell back to it again. Both defaults are gone: the settings
  start empty, enabling TikTok without choosing is refused, and a publish with
  no privacy set stops rather than guessing.

One thing deliberately NOT added: an AI-generated-content declaration. It is not
in the guidelines, and asserting one either way on a creator's behalf is worse
than omitting it. `is_aigc` stays false with a comment saying why.

Also fixed by the same work: **the Studio shell had no TikTok posting UI at
all.** Only the old `?classic=1` page ever had a privacy select, so in the
shipped product a creator could not choose an audience -- everything silently
went out as `SELF_ONLY`. The panel is built in `index.html` and attached to the
connections modal, because the Studio's markup is generated from the design file
and has no slot for it.

Interlock worth keeping: TikTok refuses branded content on a private post, so
that combination is blocked in the UI before the save and again in
`validatePublishingSettings`.

## Remaining steps, in order

0. **Check nothing is scheduled to post to TikTok in the next hour.** Step 1
   swaps the credentials out from under the live connection.
1. **Record the demo video** (above), against the SANDBOX. Under 50MB, mp4 or
   mov. Put the sandbox client key/secret into Render, reconnect TikTok in the
   app, record the five beats, then put the production pair back and reconnect
   again.
2. **Upload it** to the new app's App review section. `Save` becomes possible
   only at this point — save immediately.
3. **Put the new credentials into Render** — owner only, both together:
   `TIKTOK_CLIENT_KEY` *and* `TIKTOK_CLIENT_SECRET`. A new app issues a new
   pair, and `isConfigured('tiktok')` (`social.js:74`) reports "configured" for
   any two non-empty strings, so a half-updated pair looks healthy.
4. **Verify with a fresh code exchange** — disconnect TikTok in the app and
   reconnect it. Do not trust `Test connection`: `tiktokToken()`
   (`social.js:472`) returns the cached access token whenever it has over five
   minutes left, so the test passes without ever sending the client secret, and
   TikTok access tokens last 24h (`social.js:477`) — a wrong secret looks
   healthy for a full day, then fails at the first refresh. Look for
   `Connected TikTok account "..."` in the activity log.
5. **Submit for review.**
6. **Delete old app `7668669224428029959`. This is the revocation, not
   cleanup.** Updating Render only stops *this app* using the leaked secret --
   the secret stays valid against the old app for as long as the old app
   exists. The rotation is not closed until the app is gone. Do it once step 4
   proves the new credentials work, and not before, because the old app is the
   only way back if they do not.
7. Then remove `tiktok4j8mTWgMoRmOiR9kobH02eR2qThxiQIT.txt` from the repo root,
   and mark TIKTOK_CLIENT_SECRET done in SECRET-ROTATION.md.
