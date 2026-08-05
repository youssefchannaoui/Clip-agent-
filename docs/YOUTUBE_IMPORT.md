# YouTube URL import

DeenClipped uses Vizard's commercial API for server-side YouTube URL ingestion and moment selection. Customers paste a normal public YouTube URL; the Vizard API key remains only on the server.

## Production setup

1. Use a paid Vizard workspace with API access.
2. In Vizard, open **Workspace Settings → API** and generate an API key.
3. In the Render service environment, set `VIZARD_API_KEY` to that key and redeploy.

Optional settings:

- `VIZARD_MAX_CLIPS` — maximum returned clips, from 1 to 100; default 8.
- `VIZARD_CLIP_MODEL` — `clip_v1` or `clip_v2`; v2 uses more Vizard processing credit.
- `VIZARD_POLL_INTERVAL_MS` — project status interval; default 30000, matching Vizard's recommendation.
- `VIZARD_PROCESSING_TIMEOUT_MS` — maximum wait; default 90 minutes.

## Processing path

1. DeenClipped validates the YouTube URL and records an account-owned project.
2. The backend submits the URL directly to Vizard with subtitles and headlines disabled.
3. It polls the provider until the selected moments are ready.
4. Each provider clip is immediately downloaded from its temporary Vizard URL.
5. DeenClipped renders its own captions, selected template, and required nasheed, then runs the existing media verification.
6. The completed clips enter the normal Review, Schedule, and connected-YouTube publishing workflow.

DeenClipped does not request or store customer browser cookies. A connected YouTube channel is used only for channel identity and publishing; it is not used to download source files.
