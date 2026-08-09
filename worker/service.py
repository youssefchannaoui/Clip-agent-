"""Authenticated, persistent, single-concurrency DeenClipped processing service."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import queue
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import worker_metrics
from import_providers import ImportProviderError, download_https, provider_for
from object_storage import ObjectStorage

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped")).resolve()
JOBS_DIR = DATA_DIR / "jobs"
TEMP_DIR = Path(os.getenv("WORKER_TEMP_DIR", str(DATA_DIR / "tmp"))).resolve()
PORT = int(os.getenv("WORKER_PORT", "8080"))
MAX_CONCURRENT = max(1, int(os.getenv("WORKER_MAX_CONCURRENT_JOBS", "1")))
MAX_DOWNLOAD_BYTES = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
MIN_FREE_BYTES = max(1, int(os.getenv("WORKER_MIN_FREE_GB", "10"))) * 1024**3
JOB_TTL_SECONDS = max(3600, int(os.getenv("WORKER_TEMP_TTL_HOURS", "24")) * 3600)
SHARED_SECRET = os.getenv("WORKER_SHARED_SECRET", "")
CALLBACK_SECRET = os.getenv("WORKER_CALLBACK_SECRET", SHARED_SECRET)
FRAMING_CACHE_LOCK = threading.RLock()


def now_ms() -> int:
    return int(time.time() * 1000)


def clean_error(exc: BaseException) -> str:
    text = " ".join(str(exc).split())
    for secret_name in ("WORKER_SHARED_SECRET", "VIDEO_IMPORT_API_KEY", "OBJECT_STORAGE_SECRET_KEY", "OBJECT_STORAGE_ACCESS_KEY"):
        secret = os.getenv(secret_name, "")
        if secret:
            text = text.replace(secret, "[redacted]")
    return text[-1500:] or "Processing failed."


class JobStore:
    def __init__(self) -> None:
        JOBS_DIR.mkdir(parents=True, exist_ok=True)
        TEMP_DIR.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()

    def directory(self, job_id: str) -> Path:
        return JOBS_DIR / job_id

    def payload_path(self, job_id: str) -> Path:
        return self.directory(job_id) / "payload.json"

    def status_path(self, job_id: str) -> Path:
        return self.directory(job_id) / "status.json"

    def read(self, job_id: str) -> dict[str, Any] | None:
        try:
            return json.loads(self.status_path(job_id).read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None

    def payload(self, job_id: str) -> dict[str, Any]:
        return json.loads(self.payload_path(job_id).read_text(encoding="utf-8"))

    def create(self, payload: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        job_id = str(payload.get("id") or "")
        if not job_id or len(job_id) > 120 or not all(c.isalnum() or c in "_-" for c in job_id):
            raise ValueError("A valid job id is required.")
        with self.lock:
            existing = self.read(job_id)
            if existing:
                return existing, False
            directory = self.directory(job_id)
            directory.mkdir(parents=True, exist_ok=False)
            self.payload_path(job_id).write_text(json.dumps(payload, indent=2), encoding="utf-8")
            status = {
                "id": job_id, "status": "queued", "stage": "queued", "progress": 0,
                "createdAt": now_ms(), "updatedAt": now_ms(), "cancelRequested": False,
                "result": None, "error": None,
            }
            self.write(job_id, status)
            return status, True

    def write(self, job_id: str, status: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            status["updatedAt"] = now_ms()
            target = self.status_path(job_id)
            target.parent.mkdir(parents=True, exist_ok=True)
            temporary = target.with_suffix(".tmp")
            temporary.write_text(json.dumps(status, indent=2), encoding="utf-8")
            temporary.replace(target)
            return status

    def update(self, job_id: str, **changes: Any) -> dict[str, Any]:
        status = self.read(job_id)
        if not status:
            raise KeyError(job_id)
        status.update(changes)
        return self.write(job_id, status)

    def recover(self) -> list[str]:
        recovered = []
        for status_path in JOBS_DIR.glob("*/status.json"):
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            if status.get("status") in {"queued", "importing", "downloading", "extracting audio", "transcribing", "analysing", "creating clips", "rendering", "uploading", "processing"}:
                status.update(status="queued", stage="queued", progress=min(5, int(status.get("progress") or 0)), error=None)
                self.write(str(status["id"]), status)
                recovered.append(str(status["id"]))
        return recovered


class Processor:
    def __init__(self, store: JobStore) -> None:
        self.store = store
        self.storage = ObjectStorage()
        self.queue: queue.Queue[str] = queue.Queue()
        self.running: dict[str, subprocess.Popen] = {}
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.threads = [threading.Thread(target=self.loop, name=f"job-{index}", daemon=True) for index in range(MAX_CONCURRENT)]

    def start(self) -> None:
        for job_id in self.store.recover():
            self.queue.put(job_id)
        self.cleanup_abandoned()
        for thread in self.threads:
            thread.start()

    def submit(self, job_id: str) -> None:
        self.queue.put(job_id)

    def cancelled(self, job_id: str) -> bool:
        return bool(self.store.read(job_id).get("cancelRequested"))

    def cancel(self, job_id: str) -> dict[str, Any]:
        status = self.store.read(job_id)
        if not status:
            raise KeyError(job_id)
        if status.get("status") in {"completed", "failed", "cancelled"}:
            return status
        status.update(cancelRequested=True, status="cancelled", stage="cancelled", error=None)
        self.store.write(job_id, status)
        with self.lock:
            child = self.running.get(job_id)
        if child and child.poll() is None:
            child.terminate()
        return status

    def progress(self, job_id: str, stage: str, progress: int) -> None:
        if self.cancelled(job_id):
            raise ImportProviderError("Job cancelled.")
        self.store.update(job_id, status=stage, stage=stage, progress=max(0, min(100, int(progress))))

    def callback(self, payload: dict[str, Any], status: dict[str, Any]) -> None:
        url = str(payload.get("callbackUrl") or "")
        if not url.startswith("https://"):
            return
        body = json.dumps(status, separators=(",", ":")).encode()
        timestamp = str(now_ms())
        path = __import__("urllib.parse", fromlist=["urlparse"]).urlparse(url).path
        signature = hmac.new(CALLBACK_SECRET.encode(), f"{timestamp}\nPOST\n{path}\n{body.decode()}".encode(), hashlib.sha256).hexdigest()
        request = urllib.request.Request(url, data=body, method="POST", headers={
            "Content-Type": "application/json", "X-DeenClipped-Timestamp": timestamp,
            "X-DeenClipped-Signature": signature, "User-Agent": "DeenClipped-Worker/1.0",
        })
        try:
            urllib.request.urlopen(request, timeout=15).close()
        except Exception:
            pass

    def fetch_music(self, payload: dict[str, Any], work: Path) -> list[dict[str, str]]:
        tracks = []
        for index, track in enumerate(payload.get("musicTracks") or []):
            url = str(track.get("url") or "")
            if not url.startswith("https://"):
                continue
            destination = work / f"music-{index}.mp3"
            download_https(url, destination, 100 * 1024 * 1024, 120, lambda: self.cancelled(str(payload["id"])))
            tracks.append({"name": str(track.get("name") or destination.name), "path": str(destination)})
        if not tracks:
            raise RuntimeError("No worker-accessible nasheed track was supplied.")
        return tracks

    def run_clip_worker(self, job_id: str, job_file: Path, result_path: Path) -> dict[str, Any]:
        env = {
            **os.environ,
            "WHISPER_DEVICE": os.getenv("WHISPER_DEVICE", "cpu"),
            "WHISPER_COMPUTE_TYPE": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
            "WHISPER_MODEL": os.getenv("WHISPER_MODEL", "large-v3-turbo"),
            "FFMPEG_THREADS": os.getenv("FFMPEG_THREADS", "4"),
        }
        child = subprocess.Popen(
            [sys.executable, str(ROOT / "worker" / "clip_worker.py"), str(job_file)],
            cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        with self.lock:
            self.running[job_id] = child
        stderr_lines: list[str] = []
        assert child.stdout and child.stderr

        def collect_stderr() -> None:
            for line in child.stderr:
                stderr_lines.append(line.rstrip())
                del stderr_lines[:-80]

        threading.Thread(target=collect_stderr, daemon=True).start()
        reported_error = ""
        for line in child.stdout:
            if self.cancelled(job_id):
                child.terminate()
                break
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get("type") == "error":
                reported_error = str(event.get("error") or "").strip()
            if event.get("type") == "progress":
                raw = str(event.get("stage") or "processing").lower()
                stage = "extracting audio" if "audio" in raw else "transcribing" if "transcri" in raw else "analysing" if "analys" in raw or "candidate" in raw else "rendering" if "render" in raw or "verif" in raw else "creating clips"
                self.store.update(job_id, status=stage, stage=stage, progress=int(event.get("progress") or 0))
        code = child.wait()
        with self.lock:
            self.running.pop(job_id, None)
        if self.cancelled(job_id):
            raise ImportProviderError("Job cancelled.")
        if code != 0 or not result_path.exists():
            detail = reported_error or " ".join(stderr_lines[-10:]).strip()
            if not detail:
                detail = f"the processing engine exited with code {code} and produced no output."
            raise RuntimeError("Processing engine failed: " + detail[-1000:])
        return json.loads(result_path.read_text(encoding="utf-8"))

    def upload_result(self, job_id: str, result: dict[str, Any]) -> dict[str, Any]:
        self.progress(job_id, "uploading", 97)
        project = dict(result.get("project") or {})
        transcript = Path(str(project.get("transcriptFile") or ""))
        if transcript.is_file():
            stored = self.storage.upload(transcript, f"projects/{job_id}/transcript.json", "application/json")
            project["transcriptObjectKey"] = stored["key"]
            project["transcriptUrl"] = stored["url"]
        source = Path(str(project.get("sourceFile") or ""))
        if source.is_file():
            stored = self.storage.upload(source, f"projects/{job_id}/source.mp4", "video/mp4")
            project["sourceObjectKey"] = stored["key"]
            project["sourceUrl"] = stored["url"]
        project.pop("sourceFile", None)
        project.pop("transcriptFile", None)
        clips = []
        for clip in result.get("clips") or []:
            item = dict(clip)
            clip_file = Path(str(item.get("clipFile") or ""))
            thumb_file = Path(str(item.get("thumbFile") or ""))
            if not clip_file.is_file() or not thumb_file.is_file():
                raise RuntimeError("A rendered clip or thumbnail is missing before upload.")
            video = self.storage.upload(clip_file, f"clips/{job_id}/{item['id']}.mp4", "video/mp4")
            thumb = self.storage.upload(thumb_file, f"clips/{job_id}/{item['id']}.jpg", "image/jpeg")
            item.update(clipObjectKey=video["key"], clipUrl=video["url"], thumbObjectKey=thumb["key"], thumbUrl=thumb["url"])
            item.pop("clipFile", None)
            item.pop("thumbFile", None)
            item.pop("sourceFile", None)
            clips.append(item)
        return {"project": project, "clips": clips}

    def process(self, job_id: str) -> None:
        payload = self.store.payload(job_id)
        work = TEMP_DIR / job_id
        if work.exists():
            shutil.rmtree(work)
        work.mkdir(parents=True)
        try:
            if shutil.disk_usage(TEMP_DIR).free < MIN_FREE_BYTES:
                raise RuntimeError("The worker does not have enough free temporary disk space.")
            self.progress(job_id, "importing", 3)
            source = work / "source.mp4"
            imported = provider_for(payload.get("source") or {}, self.storage).import_video(
                payload.get("source") or {}, source, lambda: self.cancelled(job_id)
            )
            if source.stat().st_size > MAX_DOWNLOAD_BYTES:
                raise RuntimeError("The source exceeds the worker download limit.")
            self.progress(job_id, "downloading", 8)
            tracks = self.fetch_music(payload, work)
            result_path = work / "result.json"
            mode = str(payload.get("mode") or "process")
            transcript_segments = []
            transcript_source = payload.get("transcript") or {}
            if transcript_source.get("objectKey"):
                transcript_file = work / "transcript.json"
                self.storage.download(str(transcript_source["objectKey"]), transcript_file)
                transcript_segments = json.loads(transcript_file.read_text(encoding="utf-8"))
            worker_job = {
                "id": job_id, "url": str(imported.file), "title": imported.title or str(payload.get("title") or ""),
                "sourceDir": str(work / "sources"), "outputDir": str(work / "clips"), "resultPath": str(result_path),
                "ffmpeg": os.getenv("FFMPEG_PATH", "ffmpeg"), "ffprobe": os.getenv("FFPROBE_PATH", "ffprobe"),
                "template": payload.get("template") or {}, "musicTracks": tracks,
                "settings": {
                    **(payload.get("settings") or {}),
                    "device": os.getenv("WHISPER_DEVICE", "cpu"),
                    "computeType": os.getenv("WHISPER_COMPUTE_TYPE", "int8"),
                    "model": os.getenv("WHISPER_MODEL", "large-v3-turbo"),
                    "ffmpegThreads": max(1, int(os.getenv("FFMPEG_THREADS", "4"))),
                    "videoPreset": os.getenv("VIDEO_PRESET", str((payload.get("settings") or {}).get("videoPreset") or "medium")),
                    "videoCrf": int(os.getenv("VIDEO_CRF", str((payload.get("settings") or {}).get("videoCrf") or "18"))),
                },
                "sourceStartSec": payload.get("sourceStartSec") or 0,
                "sourceEndSec": payload.get("sourceEndSec"),
                "sourceTitle": payload.get("title") or imported.title,
            }
            if mode == "rerender":
                worker_job.update(
                    mode="rerender", projectId=payload.get("projectId"), sourceFile=str(imported.file),
                    clipIdOverride=payload.get("clipIdOverride"), clip=payload.get("clip") or {},
                    transcriptSegments=transcript_segments,
                )
            elif mode == "more_clips":
                worker_job.update(
                    mode="more_clips", projectId=payload.get("projectId"), projectTitle=payload.get("projectTitle"),
                    sourceFile=str(imported.file), transcriptSegments=transcript_segments,
                    existingRanges=payload.get("existingRanges") or [], requestedCount=payload.get("requestedCount") or 8,
                )
            job_path = work / "job.json"
            job_path.write_text(json.dumps(worker_job, indent=2), encoding="utf-8")
            result = self.run_clip_worker(job_id, job_path, result_path)
            public_result = self.upload_result(job_id, result)
            status = self.store.update(job_id, status="completed", stage="completed", progress=100, result=public_result, error=None, completedAt=now_ms())
            self.callback(payload, status)
        except Exception as exc:
            if self.cancelled(job_id):
                status = self.store.update(job_id, status="cancelled", stage="cancelled", error=None)
            else:
                status = self.store.update(job_id, status="failed", stage="failed", error=clean_error(exc), completedAt=now_ms())
            self.callback(payload, status)
        finally:
            shutil.rmtree(work, ignore_errors=True)

    def loop(self) -> None:
        while not self.stop.is_set():
            try:
                job_id = self.queue.get(timeout=1)
            except queue.Empty:
                continue
            status = self.store.read(job_id)
            if status and status.get("status") == "queued" and not status.get("cancelRequested"):
                self.process(job_id)
            self.queue.task_done()

    def cleanup_abandoned(self) -> None:
        cutoff = time.time() - JOB_TTL_SECONDS
        for item in TEMP_DIR.iterdir() if TEMP_DIR.exists() else []:
            try:
                if item.stat().st_mtime < cutoff:
                    shutil.rmtree(item) if item.is_dir() else item.unlink()
            except OSError:
                pass


STORE = JobStore()
PROCESSOR = Processor(STORE)


def authenticated(timestamp: str, method: str, pathname: str, body: bytes, supplied: str) -> bool:
    if not SHARED_SECRET or not timestamp or not supplied:
        return False
    try:
        if abs(now_ms() - int(timestamp)) > 5 * 60 * 1000:
            return False
    except ValueError:
        return False
    message = f"{timestamp}\n{method.upper()}\n{pathname}\n{body.decode('utf-8')}".encode()
    expected = hmac.new(SHARED_SECRET.encode(), message, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, supplied)


def analyse_framing(payload: dict[str, Any]) -> dict[str, Any]:
    """Download a stored source and return an active-speaker crop plan."""
    source_key = str(payload.get("sourceKey") or "")
    if (
        not source_key
        or len(source_key) > 512
        or ".." in source_key
        or not re.fullmatch(r"(?:projects|uploads)/[A-Za-z0-9._/-]+", source_key)
    ):
        raise ValueError("A valid stored source key is required.")
    duration = float(payload.get("duration") or 0)
    if duration < 0.25 or duration > 180:
        raise ValueError("Framing analysis supports clips between 0.25 and 180 seconds.")
    width = max(240, min(4096, int(payload.get("width") or 1080)))
    height = max(240, min(4096, int(payload.get("height") or 1920)))
    bias = str(payload.get("bias") or "auto")
    if bias not in {"auto", "left", "center", "right"}:
        raise ValueError("The framing bias is invalid.")

    spans: list[list[float]] = []
    for item in list(payload.get("speechSpans") or [])[:5000]:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            continue
        start, end = max(0.0, float(item[0])), min(duration, float(item[1]))
        if end > start:
            spans.append([round(start, 3), round(end, 3)])

    storage = ObjectStorage()
    if not storage.configured:
        raise RuntimeError("Object storage is not configured on the worker.")
    if shutil.disk_usage(TEMP_DIR).free < MIN_FREE_BYTES:
        raise RuntimeError("The worker does not have enough temporary disk space for framing analysis.")

    work_dir = TEMP_DIR / f"framing-{now_ms()}-{threading.get_ident()}"
    cache_dir = TEMP_DIR / "framing-cache"
    source_file = cache_dir / f"{hashlib.sha256(source_key.encode()).hexdigest()}.mp4"
    request_file = work_dir / "request.json"
    work_dir.mkdir(parents=True, exist_ok=False)
    try:
        cache_dir.mkdir(parents=True, exist_ok=True)
        with FRAMING_CACHE_LOCK:
            if not source_file.exists() or source_file.stat().st_size == 0:
                partial = source_file.with_suffix(f".{threading.get_ident()}.part")
                try:
                    storage.download(source_key, partial)
                    partial.replace(source_file)
                finally:
                    partial.unlink(missing_ok=True)
            source_file.touch()
            cache_dir.touch()
        request = {
            "source": str(source_file), "ffprobe": os.getenv("FFPROBE_PATH", "ffprobe"),
            "start": max(0.0, float(payload.get("start") or 0)), "duration": duration,
            "width": width, "height": height, "bias": bias,
            "padding": max(0.05, min(0.45, float(payload.get("padding", 0.18)))),
            "zoom": max(0.75, min(1.35, float(payload.get("zoom", 1.0)))),
            "smoothing": max(0.0, min(0.95, float(payload.get("smoothing", 0.68)))),
            "sampleHz": max(1.0, min(5.0, float(payload.get("sampleHz", 3.0)))),
            "speechSpans": spans,
        }
        request_file.write_text(json.dumps(request), encoding="utf-8")
        result = subprocess.run(
            [sys.executable, str(ROOT / "worker" / "clip_worker.py"), "--framing", str(request_file)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            timeout=210, check=False,
        )
        if result.returncode != 0:
            detail = (result.stderr or result.stdout).strip().splitlines()
            raise RuntimeError(detail[-1] if detail else "Speaker analysis returned no result.")
        response = json.loads(result.stdout or "{}")
        plan = response.get("plan")
        if not isinstance(plan, dict):
            raise RuntimeError("Speaker analysis returned an invalid result.")
        return plan
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "DeenClippedWorker/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:
        print(json.dumps({"type": "http", "message": fmt % args}), flush=True)

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        raw = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        if length > 2 * 1024 * 1024:
            raise ValueError("Request body is too large.")
        return self.rfile.read(length)

    def route(self) -> None:
        body = self.body() if self.command == "POST" else b""
        timestamp = self.headers.get("X-DeenClipped-Timestamp", "")
        signature = self.headers.get("X-DeenClipped-Signature", "")
        path = self.path.split("?", 1)[0]
        if not authenticated(timestamp, self.command, path, body, signature):
            return self.send_json(401, {"error": "Authentication required.", "code": "unauthorized"})
        if self.command == "GET" and path == "/health":
            return self.send_json(200, {"ok": True, "service": "deenclipped-worker"})
        if self.command == "GET" and path == "/metrics":
            return self.send_json(200, worker_metrics.snapshot(
                str(TEMP_DIR),
                queue_depth=PROCESSOR.queue.qsize(),
                running=len(PROCESSOR.running),
                max_concurrent=MAX_CONCURRENT,
            ))
        if self.command == "GET" and path == "/readiness":
            free = shutil.disk_usage(TEMP_DIR).free
            ready = bool(ObjectStorage().configured and free >= MIN_FREE_BYTES)
            return self.send_json(200 if ready else 503, {"ready": ready, "freeBytes": free, "queueDepth": PROCESSOR.queue.qsize(), "running": len(PROCESSOR.running)})
        if self.command == "POST" and path == "/framing":
            try:
                payload = json.loads(body or b"{}")
                return self.send_json(200, {"plan": analyse_framing(payload)})
            except ValueError as exc:
                return self.send_json(400, {"error": clean_error(exc), "code": "invalid_framing_request"})
            except subprocess.TimeoutExpired:
                return self.send_json(503, {"error": "Speaker analysis took too long. Try again.", "code": "framing_timeout"})
            except Exception as exc:
                return self.send_json(503, {"error": clean_error(exc), "code": "framing_unavailable"})
        if self.command == "POST" and path == "/jobs":
            try:
                payload = json.loads(body or b"{}")
                status, created = STORE.create(payload)
                if created:
                    PROCESSOR.submit(str(status["id"]))
                return self.send_json(202 if created else 200, status)
            except (ValueError, OSError) as exc:
                return self.send_json(400, {"error": clean_error(exc), "code": "invalid_job"})
        parts = path.strip("/").split("/")
        if len(parts) == 2 and parts[0] == "jobs" and self.command == "GET":
            status = STORE.read(parts[1])
            return self.send_json(200, status) if status else self.send_json(404, {"error": "Job not found."})
        if len(parts) == 3 and parts[0] == "jobs" and parts[2] == "cancel" and self.command == "POST":
            try:
                return self.send_json(200, PROCESSOR.cancel(parts[1]))
            except KeyError:
                return self.send_json(404, {"error": "Job not found."})
        return self.send_json(404, {"error": "Not found."})

    do_GET = route
    do_POST = route


def main() -> int:
    if not SHARED_SECRET or len(SHARED_SECRET) < 32:
        raise SystemExit("WORKER_SHARED_SECRET must contain at least 32 characters.")
    if not CALLBACK_SECRET or len(CALLBACK_SECRET) < 32:
        raise SystemExit("WORKER_CALLBACK_SECRET must contain at least 32 characters.")
    PROCESSOR.start()
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    stop = lambda *_: threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    print(json.dumps({"type": "startup", "port": PORT, "concurrency": MAX_CONCURRENT}), flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
