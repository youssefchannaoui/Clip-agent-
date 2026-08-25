# Scaling the worker

The worker sizes itself from the machine it finds. `worker/capacity.py` reads
the cores, the RAM and whether CTranslate2 can see a GPU, and from those picks
the Whisper model, the compute type, how many jobs run at once and how many
threads ffmpeg gets. Nothing downstream is hardcoded.

That means upgrading is **two numbers**, not five, and one of them is the
server itself.

## Measured on the current box (2 vCPU, 3.7G host, 2G worker container)

| | |
|---|---|
| Whisper | `small`, `int8`, CPU |
| Speed | **6.75x realtime** -- a 60-minute lecture transcribes in ~9 minutes |
| Concurrent jobs | 1 |
| ffmpeg threads | 2 |

Transcription is not the bottleneck people assume it is. Import is: see below.

## Before concluding the disk is full

Each `docker compose ... --build` leaves its layer cache behind. Eight rebuilds
in one session grew it to **25.7GB** and put the disk at 69% -- which reads
exactly like a box running out of room for customer data, and is not.

```
docker builder prune -f
```

took it straight back to 35%. Run that before sizing a bigger disk.

## To grow

1. Resize the server in the Hetzner console.
2. In `worker/.env`, raise `WORKER_MEMORY_LIMIT` (and `OLLAMA_MEMORY_LIMIT` if
   you want the larger scoring model back).
3. `docker compose -f worker/docker-compose.yml up -d`.

Then check what it decided:

```
docker exec worker-deenclipped-worker-1 python3 /app/worker/capacity.py
```

It is also printed on every start, as the `startup` log line, so a machine that
chose one job can be told apart from a machine that was told to.

### What each size buys

Concurrency is the smaller of `cores / 2` and `(RAM - reserve) / 1.5`, so both
have to grow together. Raising `WORKER_MEMORY_LIMIT` on a two-core box buys
nothing.

| Machine | Jobs at once | Whisper model |
|---|---|---|
| 2 vCPU / 2G | 1 | `small` |
| 8 vCPU / 12G | 4 | `medium` |
| 16 vCPU / 32G | 8 | `medium` |
| any + CUDA GPU | 2 | `large-v3` at `float16` |

A GPU is capped at two deliberately: one device's memory serialises the work,
so more parallel jobs buy contention rather than throughput.

### Overrides

Every value can still be forced from the environment, and an explicit setting
always wins: `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, `WHISPER_MODEL`,
`WORKER_MAX_CONCURRENT_JOBS`, `FFMPEG_THREADS`.

## Imports: what is actually true

Tested 25 Aug 2026, both halves of the chain.

**SocialKit works.** A probe through the real provider fetched a video in
**7.6 seconds**. It is the primary provider, it is healthy, and it is not the
problem.

**The local yt-dlp fallback is IP-blocked.** Probed against a video that
certainly exists:

```
visionos player response playability status: LOGIN_REQUIRED
ERROR: Sign in to confirm you're not a bot
```

The PO-token provider is wired correctly -- `bgutil:http-1.3.1 (external)`,
healthy, versions matched -- and is not enough against a hard block on this
address range. That matters only when SocialKit cannot serve a video, because
the fallback is the second provider, not the first.

**The two failed jobs, explained.** One was
`This video is unavailable`, and SocialKit returns exactly the same from its
own clean address in six seconds -- that video is genuinely gone, and failing
was correct. The other was `SocialKit download timed out`, which is what one
bad poll out of roughly 360 used to do to a thirty-minute wait; transient poll
failures are tolerated now.

So there is no import emergency. If SocialKit's reliability on long videos
becomes the limit, the levers are its plan, then `VIDEO_IMPORT_PROXY` (already
supported), then `VIDEO_IMPORT_COOKIES` -- and uploading an MP4 bypasses
YouTube entirely and always works.

## The thing a bigger box does NOT fix

A bigger box does not fix an import: the download happens on SocialKit's
infrastructure, and the fallback's problem is this address, not this CPU.
