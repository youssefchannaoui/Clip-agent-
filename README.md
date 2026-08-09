# DeenClipped AI 3.0 — Web app + external processing worker

DeenClipped AI keeps the polished editor and publishing workspace while moving video import, Whisper, FFmpeg, rendering, and media storage off the lightweight Render web service.

## Exact classic interface

The dashboard uses the original uploaded interface's:

- animated DeenClipped splash and arch/play logo,
- Inter and Outfit typography,
- original dark/gold palette and spacing,
- queue cards with 9:16 thumbnails and inline caption editing,
- lecture-library cards and selectable clip previews,
- schedule board with vertical thumbnails and posting windows,
- analytics cards, music library, side control centre and activity rail,
- original button motion, hover states and panel transitions.

Three matching tabs were added without replacing the classic screens:

- **Templates** — caption styles, hook card, filters, crop, watermark and saved presets.
- **Publishing** — YouTube, Instagram, Facebook and TikTok OAuth and destination controls.
- **Automation** — AI thresholds, clip limits and dependency diagnostics.

## Automated workflow

1. Upload an original video directly to object storage, or paste an authorised YouTube URL.
2. Render validates the request, creates persistent metadata, and signs a job for the external worker. It never downloads the full source video.
3. The worker obtains YouTube MP4s from the configured managed provider and runs Faster-Whisper in CPU INT8 mode.
4. Candidate moments are segmented and scored.
5. The selected saved template is rendered into every clip.
6. A shuffled nasheed is physically mixed into every final MP4.
7. FFmpeg verifies video, audio, resolution, captions, template and music.
8. Strong clips can be approved and scheduled automatically.
9. Enabled destinations publish at the selected time and store real platform post IDs.

No Opus processing credits are used.

## Mandatory safeguards

The backend blocks submission or posting when any required part is missing:

- no valid template,
- no uploaded nasheed,
- failed caption/template render,
- missing audio or video stream,
- wrong output resolution,
- unverified final MP4.

Possible Quran or hadith quotations are held for review by default.

## Production deployment

Use the root `render.yaml` for the lightweight Node web/API service and `worker/docker-compose.yml` for the CPU worker on an Ubuntu VPS. Render retains a small metadata disk; source videos, clips, thumbnails, and transcripts live in S3-compatible object storage. Full setup, firewall, update, and log commands are in [`docs/EXTERNAL_WORKER.md`](docs/EXTERNAL_WORKER.md).

## First app setup

1. Run **System check**.
2. Upload at least one nasheed in **Music**. Two or more are better for rotation.
3. Open **Templates**, choose a built-in preset or duplicate one and customise it.
4. Set clip count/duration and automation thresholds.
5. Submit one short authorised lecture.
6. Review the generated thumbnails, caption timing, crop and music level.
7. Test a private YouTube upload before enabling public or multi-platform publishing.

## Publishing credentials

Register these exact callbacks using your deployed hostname:

```text
https://YOUR-APP.onrender.com/auth/youtube/callback
https://YOUR-APP.onrender.com/auth/meta/callback
https://YOUR-APP.onrender.com/auth/tiktok/callback
```

Render environment variables:

```env
APP_PASSWORD=choose-a-strong-password
SOCIAL_PUBLISH_ENABLED=true
SOCIAL_TOKEN_KEY=stable-random-secret-at-least-32-characters

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

META_APP_ID=
META_APP_SECRET=

TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
```

Never change `SOCIAL_TOKEN_KEY` after connecting accounts, or stored tokens will become unreadable. See `AUTOMATIC-PUBLISHING-SETUP.md` for provider steps.

## Public Google sign-in

Create a Google OAuth 2.0 **Web application** client and register this exact authorised redirect URI:

```text
https://deenclipped.online/auth/google/callback
```

Set the OAuth app audience to **External**, publish it to **In production**, and configure these Render variables:

```env
AUTH_REQUIRED=true
APP_SESSION_SECRET=<stable-random-secret-at-least-32-characters>
EMAIL_SIGNIN_ENABLED=true
EMAIL_REGISTRATION_ENABLED=false
PUBLIC_BASE_URL=https://deenclipped.online
GOOGLE_SIGNIN_CLIENT_ID=
GOOGLE_SIGNIN_CLIENT_SECRET=
GOOGLE_SIGNIN_REDIRECT_URI=https://deenclipped.online/auth/google/callback
```

Keep email registration disabled for launch unless a verified invite or email-confirmation flow is added. Existing email accounts can still sign in, and new users can use verified Google OAuth.

Google compares redirect URIs exactly, including scheme, hostname, path and trailing slash. Account sign-in credentials are intentionally separate from the YouTube publishing credentials.

The production YouTube publishing OAuth client must also register this exact redirect URI:

```text
https://deenclipped.online/auth/youtube/callback
```

The complete Google OAuth and YouTube approval checklist, scope justifications, reviewer demo script and copy-ready audit answers are in [`docs/YOUTUBE_VERIFICATION.md`](docs/YOUTUBE_VERIFICATION.md).

## YouTube source imports

Do not request or store customer browser cookies. YouTube URLs are validated on Render and sent as metadata to the worker. The worker calls the configurable managed provider; the default FFMPEGAPI adapter follows its documented `youtube_to_mp4` response. Playlists, unsupported URLs, provider failures, and oversized videos direct the user to **Upload MP4**. MP4, MOV, M4V, WebM and MKV uploads go directly from the browser to object storage.

Set `VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS` to the import provider hostname plus every CDN/storage hostname that provider documents for returned download URLs. The worker rejects undeclared hosts to prevent server-side request forgery.

## Local installation

Requirements: Node.js 22+, Python 3.11+, FFmpeg and FFprobe.

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r worker/requirements.txt
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

## Rights and religious accuracy

Only process content and nasheeds you own or are authorised to reuse. AI transcripts are not authoritative Quran or hadith text. Review quotations and references before public posting.
