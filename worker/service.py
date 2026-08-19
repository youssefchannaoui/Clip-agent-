"""Authenticated, persistent, single-concurrency DeenClipped processing service."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import pathlib
import queue
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable

from import_providers import ImportProviderError, download_https, import_with_fallback, provider_for
from object_storage import ObjectStorage

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = Path(os.getenv("WORKER_DATA_DIR", "/var/lib/deenclipped")).resolve()
JOBS_DIR = DATA_DIR / "jobs"
TEMP_DIR = Path(os.getenv("WORKER_TEMP_DIR", str(DATA_DIR / "tmp"))).resolve()
PORT = int(os.getenv("WORKER_PORT", "8080"))
MAX_CONCURRENT = max(1, int(os.getenv("WORKER_MAX_CONCURRENT_JOBS", "1")))
MAX_DOWNLOAD_BYTES = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
MIN_FREE_BYTES = max(1, int(os.getenv("WORKER_MIN_FREE_GB", "10"))) * 1024**3
# The app treats five minutes of an unchanged status signature as a hung job, so
# the import has to prove liveness well inside that window.
IMPORT_HEARTBEAT_SECONDS = 15

JOB_TTL_SECONDS = max(3600, int(os.getenv("WORKER_TEMP_TTL_HOURS", "24")) * 3600)
SHARED_SECRET = os.getenv("WORKER_SHARED_SECRET", "")


def worker_capabilities() -> dict[str, Any]:
    """What the running clip_worker can do, or why it could not be asked.

    Imported lazily and never allowed to raise: a missing dependency must still
    leave /health answerable, or the one endpoint that would explain the problem
    goes down with it.
    """
    try:
        import clip_worker
        return {**clip_worker.capabilities(), "downloadProgress": "bytesDone" in _service_source()}
    except Exception as exc:  # pragma: no cover - diagnostic path
        return {"error": clean_error(exc)}


def _service_source() -> str:
    try:
        return pathlib.Path(__file__).read_text(encoding="utf-8")
    except OSError:  # pragma: no cover
        return ""

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
            # The payload can carry the operator's session cookies and proxy
            # credentials (source.network); nobody but this process reads it.
            self.payload_path(job_id).write_text(json.dumps(payload, indent=2), encoding="utf-8")
            self.payload_path(job_id).chmod(0o600)
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
        # Read-modify-write under the lock: a progress update racing a cancel
        # could read before the cancel and write after it, silently flipping
        # cancelRequested back off while the app already heard "cancelled".
        with self.lock:
            status = self.read(job_id)
            if not status:
                raise KeyError(job_id)
            status.update(changes)
            return self.write(job_id, status)

    def scrub_network(self, job_id: str) -> None:
        """Drop borrowed credentials from a finished job's payload.

        The cookies and proxy in source.network were lent for the import; a
        job that has ended has no further claim on them, and recover() only
        requeues unfinished jobs, so nothing ever misses them.
        """
        try:
            payload = self.payload(job_id)
        except (OSError, ValueError):
            return
        source = payload.get("source")
        if isinstance(source, dict) and source.pop("network", None) is not None:
            path = self.payload_path(job_id)
            path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
            path.chmod(0o600)

    def recover(self) -> list[str]:
        recovered = []
        for status_path in JOBS_DIR.glob("*/status.json"):
            try:
                status = json.loads(status_path.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            # Recover on "not finished" rather than an allowlist of stage names.
            # The allowlist was written against the five collapsed tokens this
            # service used to emit; clip_worker's own prose now passes straight
            # through, so real stages like "Rendering clip 1 of 8" matched
            # nothing and a worker restart left those jobs frozen forever.
            if status.get("status") not in {"completed", "failed", "cancelled"}:
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
        # read() returns None for a job whose status file has gone or been
        # truncated. Dereferencing that raised an AttributeError out of
        # progress(), past the exception handler in process() -- which calls this
        # too -- and into loop(), which has no try. With MAX_CONCURRENT=1 that
        # killed the only consumer thread, and the worker then went on accepting
        # jobs and processing none, while /readiness still reported ready.
        # A job that has vanished is treated as cancelled so it unwinds cleanly.
        status = self.store.read(job_id)
        if status is None:
            return True
        return bool(status.get("cancelRequested"))

    def cancel(self, job_id: str) -> dict[str, Any]:
        with self.store.lock:
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

    def import_pulse(self, job_id: str) -> Callable[[], bool]:
        """Cancellation check that also proves the worker is alive.

        The import is the longest phase of a job and used to write nothing at all
        between "importing" and clip_worker.py starting -- heartbeats only begin
        once that process launches. The app watches stage|progress|heartbeatAt and
        cancels a job whose signature has not moved for five minutes, so every
        download longer than that was killed as hung while it was downloading
        perfectly well. A three-hour lecture could never survive its own import.

        Every provider already polls the cancellation callback once per megabyte,
        so the heartbeat rides along with it for free. Throttled, because the
        status file is rewritten on each update and a fast download would
        otherwise rewrite it hundreds of times a second.
        """
        # None, not 0.0: time.monotonic()'s epoch is platform-defined -- seconds
        # since boot on Linux, but since process start on macOS. Against 0.0 the
        # first beat therefore fired only by luck of a large clock, and on a
        # freshly started worker it was throttled away for the first 15 seconds
        # of the import -- the one moment liveness most needs proving.
        last = None
        started = time.monotonic()

        def pulse(done_bytes: int = 0, total_bytes: int = 0) -> bool:
            nonlocal last
            now = time.monotonic()
            if last is None or now - last >= IMPORT_HEARTBEAT_SECONDS:
                last = now
                # Turn bytes into something the customer can read. The import
                # occupies 3-8% of the job, so the download maps onto that band
                # rather than pretending to be the whole thing.
                fields: dict[str, Any] = {"heartbeatAt": now_ms()}
                if done_bytes:
                    # The raw counts travel too, so the app can say "142 MB of
                    # 380 MB" rather than only a percentage. A percentage alone
                    # gives no sense of whether a stalled-looking import is a
                    # large file or a broken one.
                    fields["bytesDone"] = int(done_bytes)
                    if total_bytes:
                        fields["bytesTotal"] = int(total_bytes)
                if total_bytes and done_bytes:
                    fraction = max(0.0, min(1.0, done_bytes / total_bytes))
                    fields["progress"] = int(round(3 + fraction * 5))
                    elapsed = now - started
                    if fraction > 0.02 and elapsed > 2:
                        fields["etaSec"] = round((elapsed / fraction) - elapsed, 1)
                # A vanished job must still cancel cleanly rather than raise.
                try:
                    self.store.update(job_id, **fields)
                except KeyError:
                    return True
            return self.cancelled(job_id)

        return pulse

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
        signature = hmac.new(SHARED_SECRET.encode(), f"{timestamp}\nPOST\n{path}\n{body.decode()}".encode(), hashlib.sha256).hexdigest()
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
            "WHISPER_MODEL": os.getenv("WHISPER_MODEL", "small"),
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

        def note(**fields: Any) -> None:
            """Record progress against the job, tolerating it having gone away.

            store.update raises KeyError when the job's status file no longer
            exists -- a cancel plus cleanup mid-run does exactly that. These
            writes happen constantly (a heartbeat every ten seconds), and none of
            them is worth killing the reader loop over.
            """
            try:
                self.store.update(job_id, **fields)
            except KeyError:
                pass

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
            if event.get("type") == "warning":
                # Carried to the caller rather than dropped: a warning about how
                # the clips were produced belongs in front of the user.
                note(
                    lastWarning=str(event.get("warning") or ""),
                    lastWarningCode=str(event.get("code") or ""),
                )
            if event.get("type") == "heartbeat":
                # The worker beats every 10s. Recording it is what lets the
                # caller tell "still working" apart from "hung": without this
                # both look identical -- a percentage that stops moving.
                note(heartbeatAt=now_ms())
            if event.get("type") == "progress":
                # Pass the worker's own words and its phase through untouched.
                # Rewriting the prose here destroyed the distinction between
                # analysing and rendering, and between rendering and verifying,
                # so three of the five pipeline steps never lit in the UI and the
                # rail appeared to run backwards.
                stage = str(event.get("stage") or "processing")
                eta = event.get("etaSec")
                fields: dict[str, Any] = {
                    "status": stage,
                    "stage": stage,
                    "phase": str(event.get("phase") or ""),
                    "progress": int(event.get("progress") or 0),
                    "etaSec": None if eta is None else int(round(float(eta))),
                }
                # The per-clip breakdown behind "Rendering clip 2 of 4". Only
                # forwarded when the worker sends it, so the fields are not
                # cleared back to nothing on every other phase's events.
                for key in ("currentClip", "totalClips", "clipPercent", "clipPlan"):
                    if event.get(key) is not None:
                        fields[key] = event[key]
                note(**fields)
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
            # Falls through to the local downloader when a managed provider is
            # blocked: its error arrives as a quoted string from a service the
            # operator cannot see or retry, which reads as though this box had
            # failed when nothing here was ever involved.
            imported = import_with_fallback(
                payload.get("source") or {}, source, self.import_pulse(job_id), self.storage
            )
            if source.stat().st_size > MAX_DOWNLOAD_BYTES:
                raise RuntimeError("The source exceeds the worker download limit.")
            # Which provider actually served it, in the job record. The chain
            # means a green import no longer says the configured provider works:
            # socialkit can fail every job while ytdlp quietly carries it, and
            # this is where that stops being invisible.
            self.store.update(job_id, importProvider=imported.provider or None)
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
                    "model": os.getenv("WHISPER_MODEL", "small"),
                    "ffmpegThreads": max(1, int(os.getenv("FFMPEG_THREADS", "4"))),
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
            if isinstance(result.get("project"), dict):
                result["project"]["importProvider"] = imported.provider or None
            public_result = self.upload_result(job_id, result)
            status = self.store.update(job_id, status="completed", stage="completed", progress=100, result=public_result, error=None, completedAt=now_ms())
            self.callback(payload, status)
        except Exception as exc:
            # Best effort only: update() writes to disk and can itself raise
            # (ENOSPC is the realistic one, mid-render). That must not escape --
            # it would pass through loop()'s KeyError-only guard and end the one
            # consumer thread, leaving a worker that accepts jobs and runs none.
            try:
                if self.cancelled(job_id):
                    status = self.store.update(job_id, status="cancelled", stage="cancelled", error=None)
                else:
                    status = self.store.update(job_id, status="failed", stage="failed", error=clean_error(exc), completedAt=now_ms())
                self.callback(payload, status)
            except Exception as report_exc:  # noqa: BLE001
                print(f"[worker] job {job_id} failed and the failure could not be recorded: {clean_error(report_exc)}", file=sys.stderr, flush=True)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            self.store.scrub_network(job_id)

    def loop(self) -> None:
        while not self.stop.is_set():
            try:
                job_id = self.queue.get(timeout=1)
            except queue.Empty:
                continue
            status = self.store.read(job_id)
            # This is the only consumer thread at MAX_CONCURRENT=1. Anything that
            # escapes process() would end it permanently, leaving a worker that
            # accepts jobs forever and runs none -- so one bad job must never be
            # able to take the loop down with it.
            try:
                if status and status.get("status") == "queued" and not status.get("cancelRequested"):
                    self.process(job_id)
            except Exception as exc:  # noqa: BLE001 - the loop must outlive any job
                try:
                    self.store.update(job_id, status="failed", stage="failed", error=clean_error(exc))
                except Exception:  # noqa: BLE001 - a failing status write must not end the loop either
                    pass
                print(f"[worker] job {job_id} crashed the processor: {clean_error(exc)}", file=sys.stderr, flush=True)
            finally:
                self.queue.task_done()

    def cleanup_abandoned(self) -> None:
        cutoff = time.time() - JOB_TTL_SECONDS
        for item in TEMP_DIR.iterdir() if TEMP_DIR.exists() else []:
            try:
                if item.stat().st_mtime < cutoff:
                    shutil.rmtree(item) if item.is_dir() else item.unlink()
            except OSError:
                pass
        # Finished job records age out too. They accumulated forever, and each
        # one carried the full payload -- including, before scrub_network, any
        # cookies and proxy credentials the import borrowed.
        for item in JOBS_DIR.iterdir() if JOBS_DIR.exists() else []:
            try:
                status_path = item / "status.json"
                if not item.is_dir() or not status_path.exists():
                    continue
                status = json.loads(status_path.read_text(encoding="utf-8"))
                if status.get("status") in {"completed", "failed", "cancelled"} and status_path.stat().st_mtime < cutoff:
                    shutil.rmtree(item)
            except (OSError, ValueError):
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
            # capabilities() answers "did this box get rebuilt", which nothing
            # could answer before without SSHing to it -- /health said only that
            # the process was up, so a stale image looked identical to a fresh
            # one right up until a clip rendered wrong.
            return self.send_json(200, {
                "ok": True,
                "service": "deenclipped-worker",
                "capabilities": worker_capabilities(),
            })
        if self.command == "GET" and path == "/readiness":
            free = shutil.disk_usage(TEMP_DIR).free
            ready = bool(ObjectStorage().configured and free >= MIN_FREE_BYTES)
            return self.send_json(200 if ready else 503, {
                "ready": ready, "freeBytes": free,
                "queueDepth": PROCESSOR.queue.qsize(), "running": len(PROCESSOR.running),
                "capabilities": worker_capabilities(),
            })
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
