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
    python3 python3-pip ffmpeg ca-certificates fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY worker/requirements.txt ./worker/requirements.txt
RUN python3 -m pip install --break-system-packages --upgrade pip setuptools wheel \
    && python3 -m pip install --break-system-packages -r worker/requirements.txt \
    && python3 -c "import yt_dlp, faster_whisper; print('Python AI dependencies verified')"
COPY . .
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "src/server.js"]
