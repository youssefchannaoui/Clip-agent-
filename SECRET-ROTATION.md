<!--
  Restored 24 Aug 2026. This file was deleted by the 13 Aug restore to the
  7 Aug tree; the open item it describes was never closed, so it is back.

  Nothing in here asks you to share a secret, and nothing generated it for you.
  That is the point: the values were exposed by being pasted into a transcript
  once already, and a runbook that hands you fresh ones in another transcript
  would do it again. Every command below generates the value on your machine.
-->

# Credential rotation runbook

All of these were pasted into a chat transcript and should be treated as
compromised. Order matters — two of them have side effects that will break
things if rotated in the wrong sequence.

Generate every new value yourself. Nothing here asks you to share one.

```
openssl rand -hex 32
```

---

## Two latent traps in config.js — both CHECKED, neither is currently active

Verified against Render on 9 Aug 2026: `APP_SESSION_SECRET` and
`WORKER_CALLBACK_SECRET` are both set explicitly, so neither fallback below is
in play today. They are recorded because unsetting either one silently
reintroduces the problem, and nothing in the app would tell you.

**1. ~~A four-character session secret makes forgeable cookies.~~ WITHDRAWN --
this was never true.**

Checked properly on 24 Aug 2026: **nothing in the codebase reads
`config.sessionSecret`.** Sessions are opaque 36-byte random tokens, stored
server side as SHA-256 hashes in `state.authSessions` and validated by lookup
in `sessionUser()` (`src/auth.js:146`). They are never signed, so there is no
signing key to be too short.

The original entry claimed cookies signed with `APP_PASSWORD` could be forged
instantly. They could not, because no cookie is signed with anything.

Two guards were built on that mistaken premise -- a fatal startup check and a
`/readyz` check, both refusing a "short session secret". Both have been
removed: a guard over a value no code path reads does not protect anything, and
leaving it in tells whoever runs this rotation that setting the value hardened
something. The real property -- that a token not in the session store is
rejected regardless of any configured secret -- is now pinned by a test in
`test/security-headers.test.mjs`.

Rotating `APP_SESSION_SECRET` is therefore optional and has no effect. The
variable can be deleted outright.

**2. `WORKER_CALLBACK_SECRET` falls back to `WORKER_SHARED_SECRET`.**

`src/config.js:55` uses the shared secret when the callback secret is unset, so
rotating one would silently rotate both.

Status: **both set explicitly on Render, not a live problem.** Keep it that way.

---

## Order

### 1. `APP_SESSION_SECRET` — nothing to do

Rotated on 24 Aug 2026 before the above was discovered. Harmless, and
unnecessary: nothing reads it. **Nobody is signed out by changing it** — the
earlier claim that they would be was wrong.

Delete the variable whenever convenient. It is not a credential.

### 2. `APP_PASSWORD` — already closed

Verified on Render 24 Aug 2026: **it is not set at all.** `config.password`
falls back to `''`, and the admin-password sign-in path is disabled when it is
empty (the startup check only rejects a value that is set *and* under 12
characters). The leaked `Yc12` is not a live credential anywhere.

Leave it unset. Setting it would re-open a sign-in path nothing needs.

### 3. `WORKER_SHARED_SECRET` and `WORKER_CALLBACK_SECRET`

Checked against both sides on 24 Aug 2026. These are **not** symmetric, and the
original instruction to change both on both machines was wrong:

**`WORKER_CALLBACK_SECRET` — Render only, no worker change.**
It never leaves the app. It signs the music and background asset URLs Render
hands to the worker (`src/local-engine.js:178`, `:187`) and verifies them when
the worker fetches (`verifyWorkerAssetSignature`). The worker only ever uses the
signed URL it was given, and the value is not in `/opt/deenclipped/worker/.env`
at all. Rotate it on Render alone.
The only caveat: asset URLs already issued stop working, so do it with no job
running or a mid-flight render loses its nasheed.

**`WORKER_SHARED_SECRET` — must match on both.**
The worker signs its callbacks with it and `verifyWorkerRequest`
(`src/server.js:328`) verifies with it. Different values on the two sides means
every callback answers 401 and finished jobs never come back.

Do it with no job running. Between the two updates, callbacks fail; with an idle
queue nothing is there to fail.

1. Render: replace `WORKER_SHARED_SECRET`, save (this triggers a redeploy).
2. The VPS, same value — over stdin so it stays out of your shell history:

```
printf 'WORKER_SHARED_SECRET: '; read -rs WS; echo
printf '%s' "$WS" | ssh -i ~/.ssh/deenclipped_worker root@135.181.149.182 \
  'read -r NEW; cd /opt/deenclipped/worker \
   && cp .env .env.bak \
   && sed -i "s|^WORKER_SHARED_SECRET=.*|WORKER_SHARED_SECRET=$NEW|" .env \
   && docker compose up -d'
unset WS
```

`docker-compose.yml` uses `env_file: .env`, so `up -d` recreates the container
with the new value. Verify with an end-to-end job afterwards: a callback that
fails signature verification shows up as a job that renders and never completes.

### 4. Cloudflare R2 access key and secret — DONE 24 Aug 2026

Rotated to a single Account API token, `deenclipped-rotated-2026-08-24`, scoped
**Object Read & Write** on `deenclipped-media-us` only. Both leaked Aug 6 tokens
(`deenclipped-worker-token-us`, which had access to *all* buckets, and
`deenclipped-worker-token`) were deleted after verification.

Two things worth recording for next time:

- Both Render and the worker use `deenclipped-media-us`. There is a second,
  unused bucket called `deenclipped-media`; the old narrow token pointed at it,
  which means the app had been running on the all-buckets token.
- Object **Read & Write** is the minimum. Read-only breaks deletes of superseded
  renders and thumbnails, and breaks the backup writer.

Verified before deleting the old tokens, and again afterwards: a presigned
upload (200), a backup write plus verification read, an existing clip still
served (206), and a full re-render with zero `AccessDenied` /
`InvalidAccessKeyId` / `SignatureDoesNotMatch` in the worker log -- which is
the only check that exercises the worker's own copy of the credentials.

### 5. Provider secrets — Google DONE 24 Aug 2026, TikTok outstanding

**Blocker met first:** Google Cloud now enforces two-step verification on the
account (from 14 Aug 2026). The console is unreachable until 2SV is on.

**One OAuth client serves both flows.** `GOOGLE_CLIENT_SECRET` and
`GOOGLE_SIGNIN_CLIENT_SECRET` held the *same* value: sign-in and publishing both
resolve to client `881648803263-suqp...`, which carries both redirect URIs
(`/auth/youtube/callback` and `/auth/google/callback`). Both env vars must be
updated together -- and each is only exercised by its own flow, so updating one
leaves the other broken while everything looks healthy.

Rotated by adding a second secret (Google's no-downtime path), updating both
Render vars, verifying, then **disabling** the old `****98Hf` rather than
deleting it. Disabled cannot authenticate, and Enable is one click if anything
turns out to depend on it. Delete it once you are satisfied.

**Verification matters here, because the cheap test lies.** `youtubeToken()`
returns the cached access token whenever it has more than five minutes left, so
a connection test passes without ever using the client secret. What actually
proves it is a fresh code exchange. Both appeared in the activity log:

```
Signed in ... with Google.          -> GOOGLE_SIGNIN_CLIENT_SECRET
Connected YouTube channel "...".    -> GOOGLE_CLIENT_SECRET
```

**`YOUTUBE_DATA_API_KEY`** replaced with `deenclipped-youtube-2026-08-24`,
restricted to YouTube Data API v3, old `API key 1` deleted (restorable for 30
days). A dead key here does **not** surface as an error: `/api/source-info`
falls back to HTML scraping and still returns a duration. Check the
`extractor` field -- `youtube-data-api` means the key worked, anything else
means it fell back. Results are cached for 10 minutes, so test with a video you
have not already looked up.

**TikTok is still outstanding.** `TIKTOK_CLIENT_SECRET` was in the leaked set.
The app is mid-submission and the note above says rotate before recording the
demo video, not after -- confirm where that stands first.

### 6. Stripe test key

Dashboard → Developers → API keys → roll the secret key. Sandbox only, so the
blast radius is test data. Update `STRIPE_SECRET_KEY` on Render.

### 7. `SOCIAL_TOKEN_KEY` — last, and deliberately

This one is different. It encrypts stored OAuth tokens, so rotating it makes
every stored token undecryptable and **forces every user to reconnect every
channel**. There is no migration path short of writing a re-encryption script.

Which is the argument for doing it *now*. You have almost no users. This cost
only ever grows — in six months it is an email to your entire customer base
apologising for a forced reconnect.

Must be ≥32 characters, or `providerConfigured()` in `social.js` returns false
and every social integration silently reports as unconfigured.

After rotating: reconnect YouTube on your own account and confirm publishing
still works.

---

## After all of it

- Restart the worker: `cd /opt/deenclipped && docker compose up -d --build`
  (this also picks up the CPU/RAM metrics fix that has been outstanding since
  the original handover)
- Sign in, confirm sessions work
- Run one end-to-end job: import → transcribe → render → publish
- Check the admin console still reports R2 storage

## Worth doing at the same time

Nothing reads these from a file in the repo, but `render.env` from the earlier
session contained a full copy of production secrets. If a copy still exists
anywhere on disk or in a synced folder, delete it — a rotated secret is no help
if the old file is still sitting in Downloads.
