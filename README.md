# DeenClipped AI 2.4 — Exact Classic Interface

DeenClipped AI 2.4 keeps the original Clip Agent interface as the visual foundation while replacing Opus processing with a self-hosted AI clipping, rendering and publishing pipeline.

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

1. Paste an authorised lecture/video link.
2. `yt-dlp` downloads the source.
3. Faster-Whisper transcribes or translates it locally.
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

## Render deployment

Use the included **Docker** Blueprint. Do not deploy this as Render's native Node runtime. The Docker image installs Python, FFmpeg, `yt-dlp`, `yt-dlp-ejs` and Faster-Whisper, and the build fails if the Python imports do not work.

1. Put all repository files at the GitHub repository root.
2. Merge them into the branch Render will deploy, normally `main`.
3. In Render choose **New → Blueprint** and select the repository.
4. Use the root `render.yaml`.
5. Set `APP_PASSWORD`.
6. Wait for the Docker build log to print `Python AI dependencies verified`.
7. Open the app and run **Automation → Run system check**.

The Blueprint attaches a persistent disk at `/app/data`. Keep it attached because templates, nasheeds, source files, rendered clips, state and encrypted OAuth tokens are stored there.

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
