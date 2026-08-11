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

**1. If `APP_SESSION_SECRET` is ever removed, the session secret becomes four characters.**

`src/config.js:89`

```js
sessionSecret: process.env.APP_SESSION_SECRET
  || process.env.SOCIAL_TOKEN_KEY
  || process.env.APP_PASSWORD
  || 'dev-session-secret-change-me',
```

If `APP_SESSION_SECRET` is not set on Render, the session secret silently falls
back to `SOCIAL_TOKEN_KEY`, and failing that to `APP_PASSWORD` — currently
`Yc12`. Session cookies signed with a four-character secret can be forged
essentially instantly, which means anyone can mint a session for any account.

The startup warning at line 187 does **not** catch this. It only fires when the
secret equals the literal dev default, so a four-character real value passes
silently.

Status: **set on Render, not a live problem.** Never remove it. Worth adding a
startup check that fails loudly when the session secret is shorter than 32
characters, since the existing warning at line 187 only catches the literal dev
default and would let a four-character real value through in silence.

**2. `WORKER_CALLBACK_SECRET` falls back to `WORKER_SHARED_SECRET`.**

`src/config.js:55` uses the shared secret when the callback secret is unset, so
rotating one would silently rotate both.

Status: **both set explicitly on Render, not a live problem.** Keep it that way.

---

## Order

### 1. `APP_SESSION_SECRET` — already set, but rotate it anyway

It exists on Render, so it is not urgent, but it was in the leaked set.

- Generate 64 hex characters, replace on Render.
- Effect: everyone signed out once. With your current user count, nobody notices.
- Because it is set explicitly, rotating it does not disturb anything else.

### 2. `APP_PASSWORD`

Currently four characters on a public domain.

- Generate something long, set on Render.
- Effect: none, once step 1 is done. Before step 1, this would also change every
  session secret — which is exactly why step 1 comes first.

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
