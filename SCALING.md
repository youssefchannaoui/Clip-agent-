# Scaling the worker

The worker sizes itself from the machine it finds. `worker/capacity.py` reads
the cores, the RAM and whether CTranslate2 can see a GPU, and from those picks
the Whisper model, the compute type, how many jobs run at once and how many
threads ffmpeg gets.

## THE TRAP THIS FILE USED TO SET

This page said "nothing downstream is hardcoded" and "upgrading is two
numbers". **Both were false**, and it cost a whole server upgrade.

`docker-compose.yml` set `WORKER_MAX_CONCURRENT_JOBS`, `FFMPEG_THREADS`,
`WHISPER_MODEL`, `WHISPER_DEVICE` and `WHISPER_COMPUTE_TYPE` explicitly, and an
explicit value ALWAYS wins over the heuristic.

**And they were set in THREE places, which is why removing one changed
nothing.** The compose file, `worker/.env` on the box, and -- the one that
mattered -- five `ENV` lines in `worker/Dockerfile`, so every container ever
built carried them whatever the other two said. An image ENV is
indistinguishable from an operator's override, so capacity.py could never
decide anything on any deployment. All three are cleared now; `deploy.sh`
retires the `.env` copy once, on any box still provisioned from the old
template. Those five were written for a
2-core, 3.7G box and they survived the move to 8 cores and 15.2G. Measured on
the box on 8 Sept 2026, every one read **FORCED**: one job at a time, two
ffmpeg threads, `small`, on a machine with four times the hardware.

There was a second half, and it is the one that would have caught anybody out:
capacity.py reads the **cgroup**, not the host. The worker container's ceiling
was still `2G`, so even with the forces deleted it would have picked `base` and
one job on a 15.2G machine. **Both the forces and the ceiling had to move.**

Four of the five are gone now and follow the machine again. `WHISPER_MODEL` is
still set, deliberately and with its reason written beside it.

## Measured on the current box (8 vCPU, 15.2G host, 10G worker container)

| | |
|---|---|
| Whisper | `medium`, `int8`, CPU |
| Concurrent jobs | 3 (`min(cores/2, (RAM-reserve)/per-job)`) |
| ffmpeg threads | 2 (cores split between the jobs) |
| Scoring model | `qwen3:4b`, capped at 3.5G |

The ceilings are 10G + 3.5G + 0.5G = **14G against a 15.2G host**, which is the
rule the 42 OOM kills bought: a limit above what the machine has is not a
limit, it is a wish, and the kernel does the capping instead.

**How to check rather than assume**, from anywhere, without SSH:

```
gh workflow run deploy-worker.yml -f diagnose=true
```

Its `== the machine ==` block prints the host, the container, what capacity.py
decided, and which settings were FORCED and by which variable.

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

Concurrency is the smaller of `cores / 2` and `(RAM - reserve) / per-job`, so
both have to grow together. Raising `WORKER_MEMORY_LIMIT` on a two-core box
buys nothing.

**The per-job figure follows the MODEL**: 1.5G on `base` and `small`, 2.5G on
`medium`, 4G on `large`. That is why the current box runs three jobs and not
four -- `medium` is forced, and a fourth `medium` inside a 10G container is the
container's OOM killer rather than a slow queue. A model chosen by the
heuristic already fits by construction; only a forced one can cost a slot.

| Machine | Jobs at once | Whisper model |
|---|---|---|
| 2 vCPU / 2G | 1 | `small` |
| 8 vCPU / 12G | 4 | `medium` |
| 8 vCPU / 10G, `medium` forced | 3 | `medium` |
| 16 vCPU / 32G | 8 | `medium` |
| any + CUDA GPU | 2 | `large-v3` at `float16` |

The RAM column is the **container's ceiling**, not the host's -- capacity.py
reads the cgroup. Raising the server without raising `WORKER_MEMORY_LIMIT`
changes nothing.

A GPU is capped at two deliberately: one device's memory serialises the work,
so more parallel jobs buy contention rather than throughput.

### Overrides

Every value can still be forced from the environment, and an explicit setting
always wins: `WHISPER_DEVICE`, `WHISPER_COMPUTE_TYPE`, `WHISPER_MODEL`,
`WORKER_MAX_CONCURRENT_JOBS`, `FFMPEG_THREADS`.

## Imports: what is actually true

**This section described SocialKit as the primary provider. SocialKit was
removed on 26 Aug 2026** at Youssef's instruction, the day after that testing,
and the keys were deleted. Everything below is the chain as it actually runs.

The box downloads with its **own yt-dlp behind a rotating pool of 20 Webshare
static residential proxies** (`VIDEO_IMPORT_PROVIDER=ytdlp` and
`VIDEO_IMPORT_PROXIES` in `worker/.env`). Measured on switch day: a 53-minute
lecture imported in **56s at 216 Mbit/s**, full 1080p.

That is what makes the old note above obsolete rather than merely dated. The
datacenter IP block it describes is exactly what the proxy pool answers, and
**one exit is not enough** -- the first single-IP setup was bot-walled within
the hour of moving 1.5GB. Every attempt now picks a random pool address, so a
retry lands on a fresh exit.

**Only the selected stretch is downloaded.** `yt-dlp` is given
`download_ranges`, so three minutes of a 90-minute lecture costs three minutes
of bandwidth. Proven on the box: 120.0s asked for, 120.0s delivered, 66.7MB
instead of ~878MB.

The plan is 20 IPs and 250GB a month, so roughly 160 first-time imports fit;
re-imports of a URL the box has seen use the source cache, not bandwidth.

## The thing a bigger box does NOT fix

**The import.** The download is bounded by the proxy pool and by YouTube, not
by this CPU -- the 56s figure above was measured on the OLD two-core box.
A bigger machine buys transcription, rendering and concurrency. It buys nothing
at all on the way in.

It also does not fix a **queue of one**. Concurrency 4 only pays when four
lectures are waiting; with one customer importing one lecture at a time, the
win is entirely in the model sizes.
