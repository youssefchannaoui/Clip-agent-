# DeenClipped AI 2.2 — Automated Clip Creation and Publishing

DeenClipped AI is a self-hosted lecture clipping system. It replaces Opus for clipping/rendering and can now publish finished clips automatically through the official YouTube, Meta and TikTok APIs.

## Automated workflow

1. Paste an authorised lecture/video link.
2. The local worker downloads and transcribes it with Faster-Whisper.
3. Candidate moments are segmented, scored and quality checked.
4. The selected saved template is rendered into every clip.
5. A nasheed from the Music library is mixed into every final MP4.
6. Strong clips can be automatically approved and scheduled.
7. At the scheduled time, enabled platform destinations are uploaded automatically.
8. A clip is marked **Posted** only after every selected destination confirms success.
9. Failed destinations retry without reposting platforms that already succeeded.

No Opus processing credits are used.

## Render guarantees

The backend fails closed:

- no saved template → submission blocked,
- no uploaded nasheed → submission blocked,
- failed music mix → clip rejected,
- missing audio/video stream → clip rejected,
- wrong output resolution → clip rejected,
- unverified clip → automatic scheduling and publishing blocked.

## Automatic publishing

Supported destinations:

- **YouTube Shorts** — OAuth, refresh tokens, resumable uploads and recovery after interrupted transfers.
- **Instagram Reels** — Meta OAuth, media-container processing, polling and final publish confirmation.
- **Facebook Reels** — Page OAuth, resumable Reel session and publish confirmation. Clips must be 4–60 seconds.
- **TikTok** — creator capability query, direct-post init, official chunk sizing, upload recovery and status polling.

### TikTok rule

TikTok requires the creator to see current privacy/interaction options and explicitly consent before each direct post. Therefore:

- AI-auto-approved clips can publish silently to YouTube, Instagram and Facebook.
- TikTok is added only after a **manual Approve, consent & schedule** action.
- Once approved, the scheduled upload and status polling are automatic.
- Unaudited TikTok apps are normally restricted to `SELF_ONLY` posts.

TikTok receives an automatically rendered clean copy without the app watermark or promotional brand line, while other platforms keep the normal branded render.

## Publishing safety and reliability

- Account tokens are encrypted with AES-256-GCM.
- OAuth state values are signed, expire after ten minutes and can only be used once.
- Disconnecting an account disables new uploads to that destination.
- Each connection has a **Test connection** button.
- Upload sessions and offsets are saved so restarts do not blindly create duplicate posts.
- Instagram and TikTok processing states are polled.
- Processing jobs time out rather than staying stuck forever.
- Per-platform post IDs, URLs, errors, attempts and stages are stored.
- Successful destinations are never reposted when retrying a failed destination.

## Template Studio

Templates include:

- word-highlight or phrase captions,
- font, size, position, colours, outline, shadow and caption box,
- opening hook card,
- crop/blur layout modes,
- brightness, contrast, saturation, gamma, sharpening and vignette,
- watermark placement,
- optional bottom brand line,
- voice enhancement and loudness normalisation.

Every rendered clip stores the exact template snapshot/version used. Scheduled clips can be re-rendered without losing their schedule. Posted clips create a new repost variant because already-uploaded media cannot be changed.

## Recommended deployment: Render

The included `render.yaml` creates the Docker service, persistent disk and publishing environment-variable placeholders.

After deployment, add platform credentials in Render and register these callback URLs in the developer dashboards:

```text
https://YOUR-APP.onrender.com/auth/youtube/callback
https://YOUR-APP.onrender.com/auth/meta/callback
https://YOUR-APP.onrender.com/auth/tiktok/callback
```

Render supplies `RENDER_EXTERNAL_URL`, so `PUBLIC_BASE_URL` normally does not need to be set unless a custom domain is used.

### Required publishing variables

```env
SOCIAL_PUBLISH_ENABLED=true
SOCIAL_TOKEN_KEY=a-stable-random-secret-with-at-least-32-characters
```

Never change `SOCIAL_TOKEN_KEY` after connecting accounts; existing encrypted tokens would become unreadable.

### YouTube

```env
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

Enable YouTube Data API v3 and add the YouTube callback URL to the Google OAuth client.

### Instagram and Facebook

```env
META_APP_ID=
META_APP_SECRET=
```

Instagram publishing requires a professional Instagram account connected to a Facebook Page managed by the authorised user.

### TikTok

```env
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

Add the Content Posting API product and request `video.publish`. Public posting requires TikTok audit approval.

See `.env.example` for every setting.

## First live test

1. Deploy the app.
2. Run **System Check**.
3. Upload at least one nasheed.
4. Select a template.
5. Connect YouTube.
6. Press **Test connection**.
7. Enable YouTube with privacy set to **Private**.
8. Submit one short authorised lecture.
9. Approve one clip or let the quality gate schedule it.
10. Confirm the private upload appears in YouTube Studio before enabling public posting or other platforms.

## Local installation

Requirements: Node.js 22+, Python 3.11+, FFmpeg and FFprobe.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r worker/requirements.txt
npm install
cp .env.example .env
npm start
```

Validation:

```bash
npm run check
npm test
./scripts/smoke-test.sh
```

## Content rights and religious accuracy

Only process content and nasheeds you own or are authorised to reuse. AI transcripts are not authoritative Quran or hadith text. Possible religious quotations are held for manual review by default.
