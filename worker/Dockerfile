FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    XDG_CACHE_HOME=/var/lib/deenclipped/cache \
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
    # MediaPipe's C bindings dlopen libGLESv2 and libEGL even for a CPU-only
    # graph, so the image needs the GL runtime present or `import
    # mediapipe.tasks` dies with "libGLESv2.so.2: cannot open shared object
    # file". These are the runtime libraries only -- cv2 stays headless.
    libgles2 libegl1 libglib2.0-0 \
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
# Assert at build time that the runtime actually runs (right binary for the
# arch, linked against libs this base image has). A broken copy must fail the
# build here, not a customer job with a 403 three stages later.
RUN deno --version

WORKDIR /app
COPY worker/requirements.txt /app/worker/requirements.txt
# --upgrade so a rebuild takes the current yt-dlp rather than a cached wheel.
# YouTube changes its extractor faster than anything else here, and a months-old
# yt-dlp fails in exactly the same 403 way a missing runtime does. The version
# caps in requirements.txt still hold -- this upgrades within them.
RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install --upgrade -r /app/worker/requirements.txt \
    # mediapipe drags in opencv-contrib-python, the GUI build, whose cv2
    # overwrites the headless one and then fails to import for want of libGL.
    # Put headless back last so `import cv2` is the build this image installed
    # on purpose. Framing detection breaks loudly if this ever regresses:
    # cv2_problem() reports it and capabilities() surfaces it in the app.
    && python -m pip uninstall -y opencv-contrib-python \
    && python -m pip install --upgrade --force-reinstall --no-deps \
       "opencv-python-headless>=4.10.0.84,<5.0.0"

COPY worker /app/worker
# Bundled faces (see worker/fonts/NOTICE.md): the KFGQPC HAFS mushaf face --
# the one Quran apps use, whose U+06DD is the ornamented verse medallion --
# Outfit, the product's own sans, for the translation line, and Montserrat
# ExtraBold, the face the stacked-build lecture template is set in.
RUN mkdir -p /usr/share/fonts/truetype/deenclipped \
    && cp /app/worker/fonts/*.ttf /usr/share/fonts/truetype/deenclipped/ \
    && fc-cache -f
RUN mkdir -p /var/lib/deenclipped/jobs /var/lib/deenclipped/tmp /var/lib/deenclipped/models /var/lib/deenclipped/cache \
    && python -m py_compile /app/worker/service.py /app/worker/import_providers.py /app/worker/object_storage.py /app/worker/clip_worker.py /app/worker/quran.py /app/worker/matte.py \
    # ffmpeg, libass, yt-dlp and OpenCV all parse media a customer chose. None
    # of that needs root, so none of it gets root.
    && useradd --system --no-create-home --shell /usr/sbin/nologin worker \
    && chown -R worker /var/lib/deenclipped

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


USER worker

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD python /app/worker/healthcheck.py

CMD ["python", "/app/worker/service.py"]
