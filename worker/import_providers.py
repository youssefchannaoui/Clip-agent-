"""Managed source import adapters used by the external DeenClipped worker."""
from __future__ import annotations

import ipaddress
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable


class ImportProviderError(RuntimeError):
    pass


def validate_youtube_url(value: str) -> str:
    parsed = urllib.parse.urlparse(str(value or "").strip())
    if parsed.scheme != "https" or (parsed.hostname or "").lower() not in {
        "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"
    }:
        raise ImportProviderError("Only HTTPS YouTube video URLs are supported.")
    query = urllib.parse.parse_qs(parsed.query)
    if "list" in query:
        raise ImportProviderError("Playlists are not supported. Import one video or upload an MP4.")
    host = (parsed.hostname or "").lower()
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    elif parsed.path == "/watch":
        video_id = (query.get("v") or [""])[0]
    else:
        parts = parsed.path.strip("/").split("/")
        video_id = parts[1] if len(parts) == 2 and parts[0] in {"shorts", "embed", "v"} else ""
    if not 6 <= len(video_id) <= 20 or not all(c.isalnum() or c in "_-" for c in video_id):
        raise ImportProviderError("That is not a supported single-video YouTube URL.")
    return f"https://www.youtube.com/watch?v={urllib.parse.quote(video_id)}"


def assert_public_https_url(value: str, allowed_hosts: set[str] | None = None) -> str:
    parsed = urllib.parse.urlparse(str(value or ""))
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        raise ImportProviderError("The provider returned an unsafe download URL.")
    if allowed_hosts and host not in allowed_hosts and not any(host.endswith(f".{item}") for item in allowed_hosts):
        raise ImportProviderError("The provider returned a download URL from an untrusted host.")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}
    except socket.gaierror as exc:
        raise ImportProviderError("The provider download host could not be resolved.") from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ImportProviderError("The provider returned a private or unsafe download address.")
    return value


def download_https(
    url: str, destination: Path, max_bytes: int, timeout_seconds: int,
    cancelled: Callable[[], bool] = lambda: False,
) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "DeenClipped-Worker/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response, destination.open("wb") as output:
            length = int(response.headers.get("Content-Length") or 0)
            if length and length > max_bytes:
                raise ImportProviderError("The imported video exceeds the configured download limit.")
            total = 0
            while True:
                if cancelled():
                    raise ImportProviderError("Job cancelled.")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ImportProviderError("The imported video exceeds the configured download limit.")
                output.write(chunk)
    except urllib.error.HTTPError as exc:
        raise ImportProviderError(f"Video download failed with HTTP {exc.code}.") from exc


@dataclass
class ImportedSource:
    file: Path
    title: str = ""


class ManagedImportProvider:
    name = "managed"

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        raise NotImplementedError


class FfmpegApiImportProvider(ManagedImportProvider):
    """Official FFMPEGAPI YouTube-to-MP4 contract.

    POST /api/youtube_to_mp4 with ``youtube_url`` and ``X-API-Key`` returns
    ``success``, ``download_url``, ``filename`` and ``title``.
    """

    name = "ffmpegapi"

    def __init__(self) -> None:
        base = os.getenv("VIDEO_IMPORT_API_URL", "https://ffmpegapi.net").rstrip("/")
        self.endpoint = base if base.endswith("/api/youtube_to_mp4") else f"{base}/api/youtube_to_mp4"
        self.api_key = os.getenv("VIDEO_IMPORT_API_KEY", "")
        self.timeout = max(60, int(os.getenv("VIDEO_IMPORT_TIMEOUT_MS", "1800000")) // 1000)
        self.max_bytes = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
        provider_host = (urllib.parse.urlparse(base).hostname or "").lower()
        configured = {h.strip().lower() for h in os.getenv("VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS", "").split(",") if h.strip()}
        self.allowed_hosts = configured or {provider_host}

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        if not self.api_key:
            raise ImportProviderError("The managed YouTube import provider is not configured.")
        youtube_url = validate_youtube_url(source.get("url", ""))
        body = json.dumps({"youtube_url": youtube_url}).encode()
        request = urllib.request.Request(
            self.endpoint, data=body, method="POST",
            headers={"Content-Type": "application/json", "X-API-Key": self.api_key, "User-Agent": "DeenClipped-Worker/1.0"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise ImportProviderError(f"Managed import failed with HTTP {exc.code}: {detail}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ImportProviderError("Managed import timed out. Upload the original MP4 or retry later.") from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ImportProviderError("Managed import returned invalid JSON.") from exc

        if not isinstance(payload, dict) or payload.get("success") is not True:
            raise ImportProviderError(str(payload.get("error") if isinstance(payload, dict) else "Managed import failed.")[:500])
        download_url = payload.get("download_url")
        if not isinstance(download_url, str) or not download_url:
            raise ImportProviderError("Managed import response did not include download_url.")
        safe_url = assert_public_https_url(download_url, self.allowed_hosts)
        download_https(safe_url, destination, self.max_bytes, self.timeout, cancelled)
        return ImportedSource(destination, str(payload.get("title") or ""))


class YtDlpImportProvider(ManagedImportProvider):
    """Self-hosted YouTube download using yt-dlp. Runs on this worker box directly,
    with no third-party download API or subscription required."""

    name = "ytdlp"

    def __init__(self) -> None:
        self.max_bytes = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
        self.timeout = max(60, int(os.getenv("VIDEO_IMPORT_TIMEOUT_MS", "1800000")) // 1000)

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        import yt_dlp

        youtube_url = validate_youtube_url(source.get("url", ""))
        if cancelled():
            raise ImportProviderError("Job cancelled.")

        outtmpl = str(destination.with_suffix(""))
        info_holder: dict = {}

        def progress_hook(status: dict) -> None:
            if cancelled():
                raise yt_dlp.utils.DownloadError("Job cancelled.")
            downloaded = status.get("downloaded_bytes") or 0
            if downloaded and downloaded > self.max_bytes:
                raise yt_dlp.utils.DownloadError("The imported video exceeds the configured download limit.")

        ydl_opts = {
            "format": "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b",
            "merge_output_format": "mp4",
            "outtmpl": outtmpl + ".%(ext)s",
            "quiet": True,
            "no_warnings": True,
            "noplaylist": True,
            "socket_timeout": self.timeout,
            "progress_hooks": [progress_hook],
            "retries": 3,
        }

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(youtube_url, download=True)
                info_holder["title"] = info.get("title", "") if isinstance(info, dict) else ""
                produced = Path(ydl.prepare_filename(info))
                if produced.suffix != ".mp4":
                    produced = produced.with_suffix(".mp4")
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc)
            if "cancelled" in message.lower():
                raise ImportProviderError("Job cancelled.") from exc
            raise ImportProviderError(f"yt-dlp download failed: {message[:500]}") from exc

        if not produced.is_file():
            raise ImportProviderError("yt-dlp did not produce an output file.")
        if produced.stat().st_size > self.max_bytes:
            produced.unlink(missing_ok=True)
            raise ImportProviderError("The imported video exceeds the configured download limit.")
        if produced != destination:
            produced.replace(destination)
        return ImportedSource(destination, info_holder.get("title", ""))


class DirectUploadProvider(ManagedImportProvider):
    name = "direct_upload"

    def __init__(self, storage) -> None:
        self.storage = storage

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        key = str(source.get("objectKey") or "")
        if not key.startswith("uploads/") or ".." in key.split("/"):
            raise ImportProviderError("The uploaded video reference is invalid.")
        if cancelled():
            raise ImportProviderError("Job cancelled.")
        self.storage.download(key, destination)
        return ImportedSource(destination, str(source.get("title") or ""))


def provider_for(source: dict, storage) -> ManagedImportProvider:
    if source.get("type") == "object_storage":
        return DirectUploadProvider(storage)
    selected = os.getenv("VIDEO_IMPORT_PROVIDER", "ffmpegapi").lower()
    if selected == "ffmpegapi":
        return FfmpegApiImportProvider()
    if selected == "ytdlp":
        return YtDlpImportProvider()
    raise ImportProviderError(f"Unsupported VIDEO_IMPORT_PROVIDER: {selected}")
