# TikTok app: submission state and the secret problem

Recorded 24 Aug 2026 by reading the developer portal against the code.

App: **DeenClipped**, old App ID `7668669224428029959` (to be deleted), new App ID
`7677448222683531285` created 24 Aug 2026. Individual ownership.
Status: **Draft. Never submitted.** The changelog stops at 9 Aug 2026 and
`Submit for review` has never been pressed.

That single fact decides both open questions below, so check it before
trusting any of this again.

---

## The client secret cannot be rotated in the portal

`TIKTOK_CLIENT_SECRET` was pasted into a transcript on 6 Aug and is the last
item outstanding from SECRET-ROTATION.md. There is **no rotation control**:

- Credentials card: reveal (eye) only, for both client key and client secret.
- Overflow menu (`...`): `Transfer ownership` and `Delete app`. Nothing else.

So the choices are delete-and-recreate, or ask TikTok support to reset it.

### Why this is not urgent, and why it is still now-or-never

The leaked value is close to inert today, and it is worth being precise about
why rather than treating every leaked string as equally on fire:

- `client_key` + `client_secret` alone reach nothing. Every Content Posting
  and user call needs a *user* access token.
- Authorization codes are only ever delivered to the registered redirect URI,
  `https://deenclipped.online/auth/tiktok/callback`. An attacker holding the
  secret does not control that host, so they cannot obtain a code.
- Refresh tokens are stored sealed under `SOCIAL_TOKEN_KEY`, which was rotated
  on 24 Aug -- so any copy taken before that date is now undecryptable.
- The app has never been approved, so no third-party creator has ever
  connected an account through it. There is nothing to steal.

It stops being inert the moment the app is approved and real creators connect.
At that point the secret plus any leaked refresh token posts to their profiles.

Recreating the app costs ~15 minutes of form-filling **now** and nothing else,
because nothing has been approved. After approval it costs the approval.

---

## Code / portal reconciliation

Done by reading `src/social.js` against the portal, 24 Aug 2026.

| Portal setting | Code says | Verdict |
|---|---|---|
| Direct Post enabled | `/v2/post/publish/video/init/` + `creator_info/query/` (`social.js:784,858`) | correct, keep |
| `source: FILE_UPLOAD` = push_by_file (`social.js:856`) | — | **domain verification NOT required**; ignore the Verify button |
| Scope `user.info.basic` | requested (`social.js:186`) | keep |
| Scope `video.publish` | requested (`social.js:186`) | keep |
| Scope `video.upload` | **never requested anywhere** | **remove before submitting** |

`video.upload` is the draft-upload scope, served by the `inbox/video` endpoint.
That endpoint appears nowhere in the codebase. The portal warns that scopes you
do not need delay the review, and the review note below does not explain it --
TikTok asks you to explain every scope, so an unexplained one is a rejection
risk on its own.

Privacy handling is already correct for an unaudited app: `privacy` defaults to
`SELF_ONLY` and is rejected unless it appears in the creator's returned
`privacy_level_options` (`social.js:828-829`).

---

## Preserved draft (so a recreate costs nothing)

- **App name:** `DeenClipped`
- **Category:** Education
- **Description (111 chars):**
  `Turns long-form Islamic lectures into short vertical clips with captions, then posts them to your own channels.`
- **Terms of Service URL:** `https://deenclipped.online/terms`
- **Privacy Policy URL:** `https://deenclipped.online/privacy`
- **Website URL:** `https://deenclipped.online/`
- **Platform:** Web
- **Redirect URI (web):** `https://deenclipped.online/auth/tiktok/callback`
- **Products:** Login Kit, Content Posting API (Direct Post ON)
- **Scopes:** `user.info.basic`, `video.publish` (drop `video.upload`)
- **Demo video:** `Screen Recording 2026-08-07 at 6.02.42 pm.mov`

### Review note, verbatim (976 chars)

```
DeenClipped turns a creator's own long-form lecture videos into short vertical clips with captions, then publishes them to that creator's own TikTok account.

Login Kit (user.info.basic): the creator connects their account via OAuth. We read open_id, display_name and avatar_url only, and show them in Settings > Channels so the creator can confirm which account is connected before anything is posted.

Content Posting API (video.publish): posts a clip the creator generated from their own source video. Before every post we call /v2/post/publish/creator_info/query/ and render the returned privacy_level_options, comment/duet/stitch settings and nickname, so the creator always sees current values, never cached ones. The creator picks a privacy level from the options the API returns; any level not in that list is rejected. Nothing posts automatically: each clip is manually approved and carries its own consent timestamp. Only content the creator uploaded is ever posted.
```

---

## If the app is recreated

**Both** `TIKTOK_CLIENT_KEY` and `TIKTOK_CLIENT_SECRET` change together -- a new
app issues a new pair. Updating only the secret leaves the key pointing at a
deleted app, and `isConfigured('tiktok')` (`social.js:74`) reports "configured"
for any two non-empty strings, so the UI will look fine either way.

Also check `tiktok4j8mTWgMoRmOiR9kobH02eR2qThxiQIT.txt` in the repo root -- it
is a domain-verification file for the old app. A new app may issue a new one.

## Verification, once the credentials change

The cheap test lies, for the same reason it lied during the Google rotation:

- `tiktokToken()` (`social.js:472`) returns the cached access token whenever it
  has more than five minutes left, so **Test connection passes without ever
  sending the client secret**.
- TikTok access tokens default to 24h (`social.js:477`), so a wrong secret
  looks healthy for a whole day and then fails at the first refresh.

What actually proves it: **disconnect TikTok in the app and reconnect it**,
which forces a fresh authorization-code exchange through `connectTikTok`
(`social.js:243`) -- the one path that must present the client secret. Look for
`Connected TikTok account "..."` in the activity log.
