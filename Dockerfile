FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    DATA_DIR=/app/data \
    HF_HOME=/app/data/models \
    XDG_CACHE_HOME=/app/data/cache \
    FFMPEG_PATH=ffmpeg \
    FFPROBE_PATH=ffprobe

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip ffmpeg ca-certificates fontconfig fonts-dejavu-core \
    fonts-hosny-amiri fonts-sil-scheherazade \
    && fc-cache -f -v \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# ONLY requirements.txt above the Python install, deliberately.
#
# `COPY package.json ./` used to sit here, and there is no npm step anywhere in
# this file -- the repo has no dependencies on purpose. So it did nothing
# except invalidate the layer below it, and package.json changes on EVERY
# release because CI requires a version bump. That meant the expensive install
# (faster-whisper, ctranslate2, OpenCV and its Debian fallback) could never be
# reused between deploys. `COPY . .` further down brings package.json in.
#
# This only pays off with the build cache ON: the Render service is currently
# set to `no-cache`, which rebuilds everything from scratch regardless.
COPY worker/requirements.txt ./worker/requirements.txt
RUN python3 -m pip install --break-system-packages --upgrade pip setuptools wheel \
    && python3 -m pip install --break-system-packages -r worker/requirements.txt \
    && python3 -c "import yt_dlp, faster_whisper; print('yt-dlp and faster-whisper verified')"

# Try hard to get a working OpenCV, but never fail the build over it.
#
# `import cv2` succeeds even when the native bindings fail to load, leaving a
# module with no CascadeClassifier — which is how a broken framing install
# reached production silently. So it is worth checking properly here.
#
# Smart framing is one optional feature though. Everything else — captions,
# rendering, publishing — works without it, and the worker already degrades
# to manual framing with a clear message when OpenCV is unusable. Blocking
# the entire deploy over it would be the wrong trade, so this reports the
# outcome loudly in the build log and carries on.
COPY scripts/verify-opencv.py ./scripts/verify-opencv.py
RUN set -e; \
    if python3 scripts/verify-opencv.py; then \
      echo "=== OpenCV OK from pip, smart framing available ==="; \
    else \
      echo "=== pip OpenCV unusable, trying the Debian package ==="; \
      python3 -m pip uninstall --break-system-packages -y opencv-python-headless opencv-python 2>/dev/null || true; \
      apt-get update && apt-get install -y --no-install-recommends python3-opencv || true; \
      rm -rf /var/lib/apt/lists/*; \
      if python3 scripts/verify-opencv.py; then \
        echo "=== OpenCV OK from the Debian package, smart framing available ==="; \
      else \
        echo "!!! WARNING: OpenCV is unusable. The app will run normally but"; \
        echo "!!! automatic speaker framing will be unavailable. Use the manual"; \
        echo "!!! left/centre/right framing controls instead."; \
        echo "!!! Diagnosis follows:"; \
        python3 -c "import cv2, sys; print('  cv2 file:', getattr(cv2,'__file__','?')); print('  cv2 version:', getattr(cv2,'__version__','?')); print('  has CascadeClassifier:', hasattr(cv2,'CascadeClassifier'))" 2>&1 || echo "  cv2 cannot be imported at all"; \
        python3 -c "import numpy; print('  numpy:', numpy.__version__)" 2>&1 || echo "  numpy cannot be imported"; \
      fi; \
    fi
COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]
