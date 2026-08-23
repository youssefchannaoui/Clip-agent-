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

**These must change on Render and the Hetzner worker together.** Between the two
updates, every job callback fails signature verification.

```
ssh into the VPS
cd /opt/deenclipped
nano .env          # update both values
docker compose up -d
```

Do the Render side and the VPS side back to back. Pick a moment with no job
running — a mid-flight job will fail its callback and look like a worker crash.

Set both keys explicitly this time, per the shadowing note above.

### 4. Cloudflare R2 access key and secret

R2 supports multiple live keys, so this one has no downtime:

1. Create a **new** key pair in the Cloudflare dashboard.
2. Update Render and `/opt/deenclipped/.env` on the VPS.
3. Confirm uploads and the admin storage figures still work.
4. **Then** revoke the old pair.

Revoking first means broken uploads until both sides are updated.

### 5. Provider secrets

`GOOGLE_CLIENT_SECRET`, `TIKTOK_CLIENT_SECRET`, `YOUTUBE_DATA_API_KEY` — rotate
in each provider console, then update Render.

Google and TikTok both let you hold two client secrets briefly. Add the new one,
update Render, verify a connect flow, then delete the old.

Careful with TikTok: the app is mid-submission. Rotating the client secret is
fine, but do it *before* you record the demo video, not after.

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
