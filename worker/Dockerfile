FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    WORKER_DATA_DIR=/var/lib/deenclipped \
    WORKER_TEMP_DIR=/var/lib/deenclipped/tmp \
    HF_HOME=/var/lib/deenclipped/models \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe \
    WHISPER_DEVICE=cpu \
    WHISPER_COMPUTE_TYPE=int8 \
    WHISPER_MODEL=small \
    FFMPEG_THREADS=4 \
    WORKER_MAX_CONCURRENT_JOBS=1

# Caption fonts. Every family the Templates picker offers has to be installed
# here, or choosing it silently renders in whatever fontconfig substitutes --
# the picker offered Inter for months and no clip was ever rendered in it.
# test/test_worker.py pins the two lists together.
#
# dejavu-core   DejaVu Sans / Serif / Sans Mono
# liberation    Liberation Sans / Serif / Mono (Arial and Times metrics)
# open-sans     Open Sans
# hosny-amiri   Amiri, for Arabic
# scheherazade  Scheherazade New, for Arabic
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl fontconfig fonts-dejavu-core \
    fonts-liberation fonts-open-sans \
    fonts-hosny-amiri fonts-sil-scheherazade \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

# A JavaScript runtime, for yt-dlp.
#
# YouTube serves its media URLs behind a signature challenge that is solved by
# running JavaScript. yt-dlp does that through yt-dlp-ejs (in requirements.txt),
# which shells out to an *external* runtime -- it does not bundle one. With no
# runtime on PATH the challenge goes unsolved, YouTube answers 403 on the media
# URLs, and the failure surfaces as the generic
#   ERROR: unable to download video data: HTTP Error 403: Forbidden
# which reads like an IP block and sent us looking at proxies and cookies for
# days. It was a missing binary.
#
# Pinned to an exact version: `bin-2` would change the challenge solver under a
# rebuild with nothing in the diff to explain it. test/test_worker.py fails if
# yt-dlp-ejs is required without this line.
COPY --from=denoland/deno:bin-2.9.5 /deno /usr/local/bin/deno

WORKDIR /app
COPY worker/requirements.txt /app/worker/requirements.txt
# --upgrade so a rebuild takes the current yt-dlp rather than a cached wheel.
# YouTube changes its extractor faster than anything else here, and a months-old
# yt-dlp fails in exactly the same 403 way a missing runtime does. The version
# caps in requirements.txt still hold -- this upgrades within them.
RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --upgrade -r /app/worker/requirements.txt

COPY worker /app/worker
RUN mkdir -p /var/lib/deenclipped/jobs /var/lib/deenclipped/tmp /var/lib/deenclipped/models \
    && python -m py_compile /app/worker/service.py /app/worker/import_providers.py /app/worker/object_storage.py /app/worker/clip_worker.py /app/worker/quran.py

# The Quran corpus for the recitation template: the Arabic text and a
# translation, ~3MB, baked into the image so a render never waits on a network
# call and an offline box still works.
#
# Deliberately not vendored into the repo: scripture in a source tree gets
# edited by accident. Deliberately not fatal either -- a build behind a
# firewall still produces a working worker, and the Quran template reports
# itself unavailable rather than captioning approximations of scripture.
RUN python /app/worker/quran.py --build || \
    echo "WARNING: Quran corpus unavailable at build time; the Quran template will be inactive."


EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD python /app/worker/healthcheck.py

CMD ["python", "/app/worker/service.py"]
