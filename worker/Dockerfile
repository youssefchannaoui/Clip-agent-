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

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl fontconfig fonts-dejavu-core \
    fonts-lato fonts-liberation2 fonts-roboto fonts-noto-core fonts-noto-extra \
    fonts-cantarell fonts-manrope fonts-play fonts-sil-andika fonts-sil-charis \
    fonts-hosny-amiri fonts-sil-scheherazade \
    && fc-cache -f \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY worker/requirements.txt /app/worker/requirements.txt
RUN python -m pip install --upgrade pip setuptools wheel \
    && python -m pip install -r /app/worker/requirements.txt

COPY worker /app/worker
RUN mkdir -p /var/lib/deenclipped/jobs /var/lib/deenclipped/tmp /var/lib/deenclipped/models \
    && python -m py_compile /app/worker/service.py /app/worker/import_providers.py /app/worker/object_storage.py /app/worker/clip_worker.py

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=8s --start-period=30s --retries=3 \
  CMD python /app/worker/healthcheck.py

CMD ["python", "/app/worker/service.py"]
