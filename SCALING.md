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

## The thing a bigger box does NOT fix

**This server's IP is blocked by YouTube.** Probed 25 Aug 2026 against a video
that certainly exists:

```
visionos player response playability status: LOGIN_REQUIRED
web player response playability status: LOGIN_REQUIRED
ERROR: Sign in to confirm you're not a bot
```

The PO-token provider is healthy and correctly wired -- `bgutil:http-1.3.1
(external)`, versions matched -- and it is not enough against a hard IP block.
So SocialKit is currently the only working YouTube path, and it is the thing
that has been timing out. Uploads bypass YouTube entirely and always work.

The three ways through, in the order I would try them:

1. Confirm whether SocialKit's plan is what is timing out.
2. `VIDEO_IMPORT_PROXY` -- already supported, needs a proxy that is not a
   datacenter range.
3. `VIDEO_IMPORT_COOKIES` -- a cookies.txt from a signed-in account. Free, but
   it is an account credential and Google bans accounts used this way from
   datacenter IPs, so not on the main account.

No amount of CPU changes any of this.
