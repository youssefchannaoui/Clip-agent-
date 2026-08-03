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
COPY package.json ./
COPY worker/requirements.txt ./worker/requirements.txt
RUN python3 -m pip install --break-system-packages --upgrade pip setuptools wheel \
    && python3 -m pip install --break-system-packages -r worker/requirements.txt \
    && python3 -c "import yt_dlp, faster_whisper; print('yt-dlp and faster-whisper verified')"

# Verify OpenCV is genuinely usable, not merely importable.
#
# `import cv2` succeeds even when the native bindings fail to load, leaving a
# module with no CascadeClassifier. That is how a broken framing install
# reached production silently. If the pip wheel lands incomplete, fall back to
# Debian's python3-opencv, which is a complete build on this base image.
COPY scripts/verify-opencv.py ./scripts/verify-opencv.py
RUN python3 scripts/verify-opencv.py \
    || ( echo "pip OpenCV is incomplete, falling back to the Debian package" \
         && python3 -m pip uninstall --break-system-packages -y opencv-python-headless opencv-python || true \
         && apt-get update \
         && apt-get install -y --no-install-recommends python3-opencv \
         && rm -rf /var/lib/apt/lists/* \
         && python3 scripts/verify-opencv.py )
COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]
