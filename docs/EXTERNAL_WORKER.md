# DeenClipped external worker deployment

Production uses two services. Render serves the website, authentication, metadata, settings, job creation, progress, and publishing controls. A private Ubuntu VPS imports and processes source videos. Completed media is stored in S3-compatible object storage.

## Required infrastructure

- Render Starter web service with the 1 GB metadata disk from `render.yaml`.
- A third-party Linux compute server sized for the chosen Whisper model and concurrent workload.
- S3-compatible bucket with CORS allowing `PUT` from `https://deenclipped.online` and `GET`/`HEAD` for the configured public media hostname.
- A FFMPEGAPI key. The adapter uses the official `POST /api/youtube_to_mp4` contract with `X-API-Key`, `youtube_url`, and the returned `success`, `download_url`, `filename`, and `title` fields.
- Two random secrets of at least 32 characters: one for web-to-worker requests and one for worker callbacks/assets.

Generate secrets:

```bash
openssl rand -hex 48
```

## Render

Deploy the repository Blueprint using `render.yaml`. Render runs only:

```text
node src/server.js
```

Set every `sync: false` value in the Render dashboard. The processing-specific values are:

```env
PROCESSING_MODE=remote
WORKER_BASE_URL=https://worker.deenclipped.online
WORKER_SHARED_SECRET=<web-to-worker-secret>
WORKER_CALLBACK_SECRET=<worker-to-web-secret>
VIDEO_IMPORT_PROVIDER=ffmpegapi
VIDEO_IMPORT_API_URL=https://ffmpegapi.net
VIDEO_IMPORT_API_KEY=<provider-key>
OBJECT_STORAGE_ENDPOINT=https://<s3-endpoint>
OBJECT_STORAGE_REGION=<region-or-auto>
OBJECT_STORAGE_BUCKET=<bucket>
OBJECT_STORAGE_ACCESS_KEY=<access-key>
OBJECT_STORAGE_SECRET_KEY=<secret-key>
OBJECT_STORAGE_PUBLIC_URL=https://<public-media-host>
```

The 1 GB Render disk at `/var/data` contains small application metadata only. Source videos, rendered clips, thumbnails, and transcripts are stored in the object bucket. Browser MP4 uploads use a short-lived signed PUT and never pass through Render.

Publishing remains compatible with the existing platform integrations. Instagram receives the signed public media URL directly. YouTube, Facebook, and TikTok use a bounded temporary relay of the finished short clip (maximum 256 MB), which is removed immediately after upload and cleared on restart. Original source videos never use this relay. TikTok clips must use a template without an app watermark.

## Ubuntu VPS

Install Docker and its Compose plugin using the official Docker repository, clone the repository, and create `worker/.env`:

```env
WORKER_SHARED_SECRET=<web-to-worker-secret>
WORKER_CALLBACK_SECRET=<worker-to-web-secret>
WORKER_PORT=8080
WORKER_MAX_CONCURRENT_JOBS=1
WORKER_MAX_DOWNLOAD_MB=4096
WORKER_MIN_FREE_GB=10
WORKER_TEMP_TTL_HOURS=24

VIDEO_IMPORT_PROVIDER=ffmpegapi
VIDEO_IMPORT_API_URL=https://ffmpegapi.net
VIDEO_IMPORT_API_KEY=<provider-key>
VIDEO_IMPORT_TIMEOUT_MS=1800000
VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS=<provider-host,comma-separated-provider-cdn-hosts>

OBJECT_STORAGE_ENDPOINT=https://<s3-endpoint>
OBJECT_STORAGE_REGION=<region-or-auto>
OBJECT_STORAGE_BUCKET=<bucket>
OBJECT_STORAGE_ACCESS_KEY=<access-key>
OBJECT_STORAGE_SECRET_KEY=<secret-key>
OBJECT_STORAGE_PUBLIC_URL=https://<public-media-host>

WHISPER_DEVICE=cpu
WHISPER_COMPUTE_TYPE=int8
WHISPER_MODEL=small
FFMPEG_THREADS=4
```

Start the worker from the repository root:

```bash
docker compose -f worker/docker-compose.yml up -d --build
docker compose -f worker/docker-compose.yml logs -f --tail=200
```

Update it:

```bash
git pull --ff-only
docker compose -f worker/docker-compose.yml up -d --build
```

The Compose service binds to `127.0.0.1:8080`. Put Caddy, Nginx, or Cloudflare Tunnel in front of it for HTTPS. Allow inbound TCP 22 only from the administrator IP and inbound 443 from Render or the tunnel. Do not expose port 8080 publicly. Every worker endpoint, including health and readiness, requires a timestamped HMAC signature.

The worker persists job status and model cache in its Docker volume. It requeues interrupted jobs after restart, processes one job at a time, checks disk space, enforces download limits, supports cancellation, removes each job's temporary directory in `finally`, and removes abandoned temporary directories at startup.

## Operational checks

The DeenClipped owner can run the in-app system check. It calls the protected worker readiness endpoint and reports disk, queue, and running-job state.

On the VPS:

```bash
docker compose -f worker/docker-compose.yml ps
docker compose -f worker/docker-compose.yml logs --tail=200 deenclipped-worker
docker system df
```

If managed YouTube import is unavailable, users should choose **Upload MP4**. Playlist URLs are rejected intentionally.
