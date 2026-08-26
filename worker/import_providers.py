"""Managed source import adapters used by the external DeenClipped worker."""
from __future__ import annotations

import http.client
import ipaddress
import json
import os
import socket
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


class ImportProviderError(RuntimeError):
    """A provider could not deliver the file.

    `retryable` says whether asking the same provider again could plausibly
    give a different answer. A timeout or a 5xx is the provider's day going
    badly; a 401 or a 404 is an answer, and asking four more times only makes
    someone wait four times longer for it.
    """

    def __init__(self, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


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


def _poll(cancelled, done_bytes, total_bytes):
    """Call the cancellation callback, handing it download progress if it wants it.

    Callers pass a plain `lambda: bool` in most places, so the two-argument form
    is attempted first and a TypeError falls back. That keeps every existing
    provider working unchanged while the service's own pulse can report a real
    percentage.
    """
    try:
        return bool(cancelled(done_bytes, total_bytes))
    except TypeError:
        return bool(cancelled())


def download_https(
    url: str, destination: Path, max_bytes: int, timeout_seconds: int,
    cancelled: Callable[[], bool] = lambda: False,
) -> None:
    request = urllib.request.Request(url, headers={"User-Agent": "DeenClipped-Worker/1.0"})
    # Written beside the destination and moved into place only once the whole
    # file is proven present. A dropped connection used to leave a short file
    # sitting at the destination and RETURN SUCCESSFULLY -- read() answers b""
    # at a broken socket exactly as it does at the end of a file, and nothing
    # compared the bytes written against Content-Length. The pipeline then
    # transcribed a truncated lecture, and source_cache_store filed it, so every
    # later job for that URL was served the same short video.
    scratch = destination.with_name(f".{destination.name}.{os.getpid()}.{uuid.uuid4().hex[:8]}.part")
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response, scratch.open("wb") as output:
            length = int(response.headers.get("Content-Length") or 0)
            if length and length > max_bytes:
                raise ImportProviderError("The imported video exceeds the configured download limit.")
            total = 0
            while True:
                # The callback doubles as the liveness/progress report. Passing the
                # byte counts lets the worker turn a download into a real
                # percentage and ETA instead of a job that sits at 3% for minutes
                # with no sign of movement. Providers that only want the
                # cancellation answer ignore the arguments.
                if _poll(cancelled, total, length):
                    raise ImportProviderError("Job cancelled.")
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > max_bytes:
                    raise ImportProviderError("The imported video exceeds the configured download limit.")
                output.write(chunk)
        if length and total != length:
            raise ImportProviderError(
                f"The download ended early: {total} bytes of {length}.", retryable=True,
            )
        if not total:
            raise ImportProviderError("The download produced an empty file.", retryable=True)
        scratch.replace(destination)
    except urllib.error.HTTPError as exc:
        raise ImportProviderError(f"Video download failed with HTTP {exc.code}.", retryable=exc.code >= 500) from exc
    except ImportProviderError:
        raise
    except (TimeoutError, socket.timeout, urllib.error.URLError, OSError, http.client.HTTPException) as exc:
        # These used to escape as themselves. import_with_fallback only catches
        # ImportProviderError, so a network blip mid-download walked straight
        # past the whole fallback chain and failed the job outright, with no
        # other provider tried and nothing readable in the trail.
        raise ImportProviderError(f"The download did not complete: {exc}", retryable=True) from exc
    finally:
        if scratch.exists():
            scratch.unlink(missing_ok=True)


@dataclass
class ImportedSource:
    file: Path
    title: str = ""
    # Which provider actually served it. With a fallback chain, "the import
    # worked" no longer says the configured provider is healthy -- socialkit can
    # fail on every job while ytdlp quietly carries it, and nothing surfaces
    # that until it is the job record's business to.
    provider: str = ""


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

    def __init__(self, primary: bool = False) -> None:
        # VIDEO_IMPORT_API_URL/KEY are the *configured* provider's settings, and
        # ffmpegapi and socialkit both used to read them. A chain that adds the
        # other one would then send one vendor's key to the other's endpoint --
        # or, with the URL left at its default, to an unrelated company
        # altogether. `primary` is what keeps a credential with its owner.
        base = (os.getenv("FFMPEGAPI_API_URL", "").strip()
                or (os.getenv("VIDEO_IMPORT_API_URL", "").strip() if primary else "")
                or "https://ffmpegapi.net").rstrip("/")
        self.endpoint = base if base.endswith("/api/youtube_to_mp4") else f"{base}/api/youtube_to_mp4"
        self.api_key = (os.getenv("FFMPEGAPI_API_KEY", "").strip()
                        or (os.getenv("VIDEO_IMPORT_API_KEY", "").strip() if primary else ""))
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


# YouTube rejects the media URLs some clients hand out, so a 403 on the video
# data is not a dead end -- it means "not from that client". Each entry is tried
# in turn until one downloads.
#
# None first: yt-dlp's own default is the best-maintained path and usually
# works. The rest are the clients that historically keep working when it does
# not, cheapest first.
YOUTUBE_CLIENTS = [None, "android_vr", "ios", "web_safari", "tv"]

# What a block looks like, as opposed to a video that is simply gone.
_BLOCK_SIGNS = (
    "http error 403", "forbidden", "sign in to confirm", "not a bot",
    "unable to download video data", "please sign in", "http error 429",
)

# A failure that says nothing about the video. A timeout, a dropped connection
# or a 5xx is a statement about one provider's day, not about whether the file
# can be fetched -- so the next provider deserves its turn. A real job died on
# "SocialKit download timed out" with the local downloader untried.
_TRANSPORT_SIGNS = (
    "timed out", "timeout", "connection reset", "connection refused",
    "temporarily unavailable", "http error 5", "bad gateway", "service unavailable",
)

# A verdict about the video itself, which every provider will reach alike.
# Trying again only makes someone wait longer for the same answer.
#
# "unavailable" is deliberately NOT here. It reads like a verdict and is not
# one: YouTube serves "This video is unavailable" to blocked datacenter ranges,
# so from a provider downloading on its own IP it describes their address. A
# real job was lost to that string. "private", "removed" and "members-only" are
# answers about the video and do not change with the asker.
_FINAL_SIGNS = (
    "is private", "private video", "has been removed", "was deleted",
    "account associated with this video has been terminated",
    "members-only", "age-restricted", "sign in to confirm your age",
)


def _looks_blocked(message: str) -> bool:
    lowered = str(message).lower()
    return any(sign in lowered for sign in _BLOCK_SIGNS)


def _looks_transient(message: str) -> bool:
    lowered = str(message).lower()
    return any(sign in lowered for sign in _TRANSPORT_SIGNS)


def _looks_final(message: str) -> bool:
    lowered = str(message).lower()
    return any(sign in lowered for sign in _FINAL_SIGNS)


def youtube_network_options() -> dict[str, Any]:
    """Proxy and cookie settings for the local downloader.

    Once YouTube blocks the box's IP outright, no amount of client rotation
    helps -- the request never gets far enough for the client to matter. The two
    things that do work are asking from somewhere else (a proxy) and asking as
    someone signed in (cookies). Neither is a default: a proxy costs money and
    cookies are an account credential, so both are opt-in.
    """
    options: dict[str, Any] = {}
    proxy = os.getenv("VIDEO_IMPORT_PROXY", "").strip()
    if proxy:
        options["proxy"] = proxy
    cookies = os.getenv("VIDEO_IMPORT_COOKIES", "").strip()
    if cookies and Path(cookies).is_file():
        options["cookiefile"] = cookies
    browser = os.getenv("VIDEO_IMPORT_COOKIES_FROM_BROWSER", "").strip()
    if browser:
        options["cookiesfrombrowser"] = (browser,)
    # The PO-token server (bgutil-provider in docker-compose.yml). YouTube's
    # bot wall on datacenter IPs -- playability LOGIN_REQUIRED, "Sign in to
    # confirm you're not a bot" -- is answered by a proof-of-origin token, not
    # by cookies or a different player client. The plugin from requirements.txt
    # picks this URL up from extractor_args.
    pot = os.getenv("YTDLP_POT_PROVIDER_URL", "").strip()
    if pot:
        options["extractor_args"] = {"youtubepot-bgutilhttp": {"base_url": [pot]}}
    return options


def job_network_options(source: dict, scratch: Path) -> dict[str, Any]:
    """Network options for one job: the payload's settings over the box's.

    The proxy and cookies used to live only in .env on the worker box, which
    meant changing them required the Hetzner web console -- an interface that
    mangles the exact characters a proxy URL is made of. They now also arrive
    inside the job's source, set from the dashboard, and win over the env so
    the operator's latest choice is always the one used.

    Cookies arrive as text and are written into the job's scratch directory,
    which the service deletes with the rest of the job -- a session credential
    must not outlive the work it was lent for.
    """
    options = youtube_network_options()
    network = (source or {}).get("network") or {}
    proxy = str(network.get("proxy") or "").strip()
    if proxy:
        options["proxy"] = proxy
    cookies_text = str(network.get("cookiesText") or "").strip()
    if cookies_text:
        cookie_file = scratch / "job-cookies.txt"
        cookie_file.write_text(cookies_text + "\n", encoding="utf-8")
        cookie_file.chmod(0o600)
        options["cookiefile"] = str(cookie_file)
        options.pop("cookiesfrombrowser", None)
    return options


def _download_failure(failures: list[str]) -> str:
    """One message naming every client that was tried.

    "HTTP Error 403" on its own reads as a broken product. Saying which clients
    were attempted, and that a rebuild picks up a newer yt-dlp, is the
    difference between an actionable report and a dead end -- YouTube changes
    break older versions regularly and that is usually the fix.
    """
    tried = "; ".join(failures[-len(YOUTUBE_CLIENTS):])
    network = youtube_network_options()
    if network.get("proxy") or network.get("cookiefile") or network.get("cookiesfrombrowser"):
        remedy = ("A proxy or cookies are configured and were used, so this looks like the "
                  "video itself rather than the address it was asked from.")
    else:
        # Every client failing is the signature of the address being blocked,
        # not of a stale downloader -- rotating clients cannot help when the
        # request never gets far enough for the client to matter.
        remedy = ("Every client failed, which usually means this server's IP is blocked rather "
                  "than the downloader being out of date. Set VIDEO_IMPORT_PROXY to route the "
                  "request elsewhere, or VIDEO_IMPORT_COOKIES to a cookies.txt from a signed-in "
                  "account. Uploading the MP4 avoids YouTube entirely.")
    return f"YouTube refused this download from every client tried. {remedy} Attempts: {tried}"[:900]


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

        produced = None
        failures: list[str] = []
        for attempt, client in enumerate(YOUTUBE_CLIENTS):
            if cancelled():
                raise ImportProviderError("Job cancelled.")
            options = dict(ydl_opts)
            options.update(job_network_options(source, destination.parent))
            if client:
                # Merged, not assigned: youtube_network_options() may already
                # carry the PO-token server in extractor_args, and replacing
                # the dict wholesale would silently drop it -- the exact
                # rotation that runs when the box is blocked is the one that
                # needs the token most.
                extractor = dict(options.get("extractor_args") or {})
                extractor["youtube"] = {"player_client": [client]}
                options["extractor_args"] = extractor
            try:
                with yt_dlp.YoutubeDL(options) as ydl:
                    info = ydl.extract_info(youtube_url, download=True)
                    info_holder["title"] = info.get("title", "") if isinstance(info, dict) else ""
                    produced = Path(ydl.prepare_filename(info))
                    if produced.suffix != ".mp4":
                        produced = produced.with_suffix(".mp4")
                break
            except yt_dlp.utils.DownloadError as exc:
                message = str(exc)
                if "cancelled" in message.lower():
                    raise ImportProviderError("Job cancelled.") from exc
                failures.append(f"{client or 'default'}: {message[:200]}")
                # Only a block is worth trying another client for. A private or
                # deleted video fails the same way on every one of them, and
                # walking the whole list just makes the user wait longer for the
                # same answer.
                if not _looks_blocked(message) or attempt == len(YOUTUBE_CLIENTS) - 1:
                    raise ImportProviderError(_download_failure(failures)) from exc

        if produced is None or not produced.is_file():
            raise ImportProviderError("yt-dlp did not produce an output file.")
        if produced.stat().st_size > self.max_bytes:
            produced.unlink(missing_ok=True)
            raise ImportProviderError("The imported video exceeds the configured download limit.")
        if produced != destination:
            produced.replace(destination)
        return ImportedSource(destination, info_holder.get("title", ""))


# Consecutive transient poll failures tolerated before giving up on a SocialKit
# job. The overall deadline still governs, so this cannot extend a wait -- it
# only stops one bad answer discarding a download already in progress.
_SOCIALKIT_POLL_STUMBLES = 5

# How long a hosted provider may sit in "queued"/"processing" without ever
# reaching "ready" before the chain gives up on it. This is NOT the download
# budget -- it is the patience for a provider that has not started delivering.
# It defaulted to the full 30-minute import timeout, so a vendor outage cost
# every customer half an hour of a motionless 3% before the fallback was even
# tried. Eight minutes is generous for a long video and four times faster to
# the truth when the vendor is simply down.
_SOCIALKIT_STALL_SECONDS = max(60, int(os.getenv("SOCIALKIT_STALL_SEC", "480")))


def _human_elapsed(seconds: float) -> str:
    seconds = int(max(0, seconds))
    if seconds < 60:
        return f"{seconds}s"
    return f"{seconds // 60}m {seconds % 60:02d}s"


def _notify(cancelled: Callable[..., bool], note: str) -> bool:
    """Report a phase note through the cancellation callback.

    The callback doubles as the import heartbeat. Older callers -- and every
    test that passes a bare ``lambda: False`` -- take no arguments, so the note
    is offered and quietly dropped rather than made a requirement.
    """
    try:
        return bool(cancelled(note=note))
    except TypeError:
        return bool(cancelled())


class SocialKitImportProvider(ManagedImportProvider):
    """Hosted YouTube import via SocialKit's async (v2) download job API.

    SocialKit performs the actual download on its own infrastructure, so this
    works from datacenter IP ranges that YouTube blocks outright. Flow is
    submit job -> poll until ``ready`` -> fetch the temporary download URL.
    """

    name = "socialkit"

    def __init__(self, primary: bool = False) -> None:
        self.base = (os.getenv("SOCIALKIT_API_URL", "").strip()
                     or (os.getenv("VIDEO_IMPORT_API_URL", "").strip() if primary else "")
                     or "https://api.socialkit.dev").rstrip("/")
        self.api_key = (os.getenv("SOCIALKIT_API_KEY", "").strip()
                        or (os.getenv("VIDEO_IMPORT_API_KEY", "").strip() if primary else ""))
        self.quality = os.getenv("SOCIALKIT_QUALITY", "720p")
        self.timeout = max(60, int(os.getenv("VIDEO_IMPORT_TIMEOUT_MS", "1800000")) // 1000)
        self.max_bytes = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
        self.poll_seconds = max(2, int(os.getenv("SOCIALKIT_POLL_SECONDS", "5")))
        self.max_duration = max(0, int(os.getenv("SOCIALKIT_MAX_DURATION_SEC", "0")))
        configured = {h.strip().lower() for h in os.getenv("VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS", "").split(",") if h.strip()}
        self.allowed_hosts = configured or {"amazonaws.com", "socialkit.dev"}

    def _call(self, url: str, method: str = "GET") -> dict:
        request = urllib.request.Request(
            url, method=method,
            headers={"User-Agent": "DeenClipped-Worker/1.0", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            # 5xx is their side falling over and may well pass next time; 4xx is
            # an answer about this request and will not change.
            raise ImportProviderError(
                f"SocialKit request failed with HTTP {exc.code}: {detail}",
                retryable=exc.code >= 500,
            ) from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ImportProviderError("SocialKit request timed out.", retryable=True) from exc
        except urllib.error.URLError as exc:
            raise ImportProviderError(f"SocialKit could not be reached: {exc.reason}", retryable=True) from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ImportProviderError("SocialKit returned invalid JSON.", retryable=True) from exc

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        if not self.api_key:
            raise ImportProviderError("The managed YouTube import provider is not configured.")
        youtube_url = validate_youtube_url(source.get("url", ""))
        if cancelled():
            raise ImportProviderError("Job cancelled.")

        submit_params = {"access_key": self.api_key, "url": youtube_url, "quality": self.quality}
        if self.max_duration:
            submit_params["max_duration"] = str(self.max_duration)
        submit_query = urllib.parse.urlencode(submit_params)
        submitted = self._call(f"{self.base}/v2/youtube/download?{submit_query}", method="POST")
        job = submitted.get("data") if isinstance(submitted, dict) else None
        if not isinstance(job, dict) or not job.get("jobId"):
            message = (submitted or {}).get("error") if isinstance(submitted, dict) else None
            raise ImportProviderError(str(message or "SocialKit did not return a download job id.")[:300])
        job_id = urllib.parse.quote(str(job["jobId"]), safe="")

        status_query = urllib.parse.urlencode({"access_key": self.api_key})
        deadline = time.monotonic() + self.timeout
        submitted_at = time.monotonic()
        stall_deadline = submitted_at + _SOCIALKIT_STALL_SECONDS
        info: dict = {}
        # A thirty-minute wait is around 360 polls. One of them failing used to
        # abandon the whole download -- a single blip out of 360 threw away work
        # SocialKit had already done, and surfaced as a plain failure the job
        # log could not explain. Transient answers are tolerated in a row; a
        # 4xx still stops immediately, because it is an answer.
        stumbles = 0
        first = True
        while True:
            if cancelled():
                raise ImportProviderError("Job cancelled.")
            waited = time.monotonic() - submitted_at
            if time.monotonic() > deadline:
                raise ImportProviderError(
                    f"SocialKit download timed out after {_human_elapsed(waited)}. "
                    "Upload the original MP4 or retry later.",
                    retryable=True,
                )
            if time.monotonic() > stall_deadline:
                # Retryable on purpose: a provider stuck before it ever starts
                # is the case the local downloader exists to rescue.
                raise ImportProviderError(
                    f"SocialKit accepted the job but never started delivering it "
                    f"({_human_elapsed(waited)} with no progress). The import service "
                    "looks unavailable -- uploading the MP4 will still work.",
                    retryable=True,
                )
            # Poll before sleeping. Sleeping first added the poll interval to
            # every single import, including ones already finished.
            if first:
                first = False
            else:
                time.sleep(self.poll_seconds)
            try:
                polled = self._call(f"{self.base}/v2/downloads/{job_id}?{status_query}")
            except ImportProviderError as exc:
                stumbles += 1
                if not getattr(exc, "retryable", False) or stumbles > _SOCIALKIT_POLL_STUMBLES:
                    raise
                continue
            stumbles = 0
            info = polled.get("data") if isinstance(polled, dict) else None
            if not isinstance(info, dict):
                raise ImportProviderError("SocialKit returned an unexpected job status.")
            state = str(info.get("status") or "").lower()
            _notify(cancelled, f"Import service: {state or 'waiting'} ({_human_elapsed(waited)})")
            if state == "ready":
                break
            if state in {"failed", "error", "cancelled", "canceled", "expired"}:
                raise ImportProviderError(str(info.get("error") or f"SocialKit download {state}.")[:300])

        download_url = info.get("downloadUrl")
        if not isinstance(download_url, str) or not download_url:
            raise ImportProviderError("SocialKit did not return a download URL.")
        safe_url = assert_public_https_url(download_url, self.allowed_hosts)
        download_https(safe_url, destination, self.max_bytes, self.timeout, cancelled)
        return ImportedSource(destination, str(info.get("title") or ""))


class DirectUploadProvider(ManagedImportProvider):
    name = "direct_upload"

    def __init__(self, storage) -> None:
        self.storage = storage

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        key = str(source.get("objectKey") or "")
        # Two prefixes are legitimate, and only accepting the first broke every
        # re-render of an imported lecture:
        #
        #   uploads/   a file the customer sent us
        #   projects/  the source this worker saved after importing a link
        #
        # A re-render of a link-imported lecture reads back the second, so
        # "Apply template" and "Save to all clips" failed on every such lecture
        # with a message about an upload the customer never made.
        #
        # The traversal guard stays: it is what stops a crafted key walking out
        # of the bucket, and it is checked before the prefix so a key like
        # "uploads/../../etc" cannot pass on its prefix alone.
        segments = key.split("/")
        if ".." in segments or not (key.startswith("uploads/") or key.startswith("projects/")):
            raise ImportProviderError(f"The stored source reference is not one this worker can read: {key[:80] or '(empty)'}")
        if cancelled():
            raise ImportProviderError("Job cancelled.")
        self.storage.download(key, destination)
        return ImportedSource(destination, str(source.get("title") or ""))


class CobaltImportProvider(ManagedImportProvider):
    """Import through a cobalt instance.

    cobalt is an open-source media downloader with a small JSON API. It matters
    here because an instance can be self-hosted anywhere -- including on a
    connection YouTube does not block -- which is the one lever that actually
    moves when a datacenter IP is refused. Public instances exist too, but they
    rate-limit and come and go, so the URL is configuration rather than a
    default.

    API v10: POST / with {"url": ...}; the reply is either a direct link
    ("redirect"), a proxied one ("tunnel"), or an error.
    """

    name = "cobalt"

    def __init__(self) -> None:
        self.base = os.getenv("COBALT_API_URL", "").rstrip("/")
        self.api_key = os.getenv("COBALT_API_KEY", "")
        self.quality = os.getenv("COBALT_QUALITY", "1080")
        self.timeout = max(60, int(os.getenv("VIDEO_IMPORT_TIMEOUT_MS", "1800000")) // 1000)
        self.max_bytes = max(50, int(os.getenv("WORKER_MAX_DOWNLOAD_MB", "4096"))) * 1024 * 1024
        # The instance decides where the bytes come from, so it is exactly the
        # kind of URL that must not be fetched unchecked: a compromised or
        # hostile instance could point this at cloud metadata or anything else
        # on the private network. Its own host and Google's CDN by default.
        configured = {h.strip().lower() for h in os.getenv("COBALT_ALLOWED_DOWNLOAD_HOSTS", "").split(",") if h.strip()}
        instance = (urllib.parse.urlparse(self.base).hostname or "").lower()
        self.allowed_hosts = configured or {h for h in {instance, "googlevideo.com", "youtube.com"} if h}

    def import_video(self, source: dict, destination: Path, cancelled: Callable[[], bool]) -> ImportedSource:
        if not self.base:
            raise ImportProviderError("No cobalt instance is configured (COBALT_API_URL).")
        youtube_url = validate_youtube_url(source.get("url", ""))
        if cancelled():
            raise ImportProviderError("Job cancelled.")

        body = json.dumps({
            "url": youtube_url,
            "videoQuality": self.quality,
            "filenameStyle": "basic",
            "downloadMode": "auto",
        }).encode()
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": "DeenClipped-Worker/1.0",
        }
        if self.api_key:
            headers["Authorization"] = f"Api-Key {self.api_key}"
        request = urllib.request.Request(self.base or "/", data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            raise ImportProviderError(f"cobalt request failed with HTTP {exc.code}: {detail}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ImportProviderError("cobalt request timed out.") from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ImportProviderError("cobalt returned invalid JSON.") from exc

        status = str(payload.get("status") or "")
        if status in {"redirect", "tunnel"}:
            link = str(payload.get("url") or "")
            if not link:
                raise ImportProviderError("cobalt returned no download URL.")
            # assert_public_https_url before fetching, never after: it is what
            # pins the host and refuses private, loopback and link-local
            # addresses. download_https does not check any of that itself.
            assert_public_https_url(link, self.allowed_hosts)
            download_https(link, destination, self.max_bytes, self.timeout, cancelled)
            return ImportedSource(destination, str(payload.get("filename") or ""))
        if status == "picker":
            raise ImportProviderError("cobalt returned a picker; this link is not a single video.")
        reason = payload.get("error")
        if isinstance(reason, dict):
            reason = reason.get("code") or reason.get("message")
        raise ImportProviderError(str(reason or "cobalt could not download this video.")[:300])


def _named_provider(name: str, storage, primary: bool = False) -> ManagedImportProvider:
    if name == "ffmpegapi":
        return FfmpegApiImportProvider(primary=primary)
    if name == "ytdlp":
        return YtDlpImportProvider()
    if name == "socialkit":
        return SocialKitImportProvider(primary=primary)
    if name == "cobalt":
        return CobaltImportProvider()
    raise ImportProviderError(f"Unsupported VIDEO_IMPORT_PROVIDER: {name}")


def provider_for(source: dict, storage) -> ManagedImportProvider:
    if source.get("type") == "object_storage":
        return DirectUploadProvider(storage)
    return _named_provider(os.getenv("VIDEO_IMPORT_PROVIDER", "ffmpegapi").lower(), storage, primary=True)


def provider_chain(source: dict, storage) -> list[ManagedImportProvider]:
    """The providers to try, in order.

    A managed provider downloads on someone else's infrastructure, so when
    YouTube blocks it there is nothing on this box that can help -- and its error
    arrives as a quoted string from a service the operator cannot see, which
    reads as though the worker itself failed. Falling back to the local
    downloader turns that into something this box can actually retry, from a
    different IP and with client rotation.

    An upload has nothing to fall back to and does not want one.
    """
    if source.get("type") == "object_storage":
        return [DirectUploadProvider(storage)]
    configured = os.getenv("VIDEO_IMPORT_PROVIDER", "ffmpegapi").lower()
    order = [configured]
    if os.getenv("VIDEO_IMPORT_FALLBACK", "ytdlp").lower() != "off":
        # Every other service that has been given credentials, then the local
        # downloader. When YouTube refuses one address, another service on a
        # different address is the thing most likely to work -- and adding one
        # should be a key in .env, not a code change.
        # Only a service with credentials of its *own* joins the chain. Reusing
        # the configured provider's key would hand one vendor's credential to
        # another, and could not have worked anyway: the request formats differ.
        if os.getenv("COBALT_API_URL", "").strip():
            order.append("cobalt")
        if os.getenv("SOCIALKIT_API_KEY", "").strip():
            order.append("socialkit")
        if os.getenv("FFMPEGAPI_API_KEY", "").strip():
            order.append("ffmpegapi")
        order.append("ytdlp")
    # First occurrence wins, so the configured provider keeps its place.
    seen, deduped = set(), []
    for name in order:
        if name in seen:
            continue
        seen.add(name)
        deduped.append(name)
    order = deduped
    providers = []
    for index, name in enumerate(order):
        try:
            providers.append(_named_provider(name, storage, primary=index == 0))
        except ImportProviderError:
            # A provider that cannot be built -- no API key, unknown name -- is
            # skipped rather than taking the whole chain down with it.
            continue
    if not providers:
        raise ImportProviderError(f"No usable import provider: VIDEO_IMPORT_PROVIDER={configured}")
    return providers


def import_with_fallback(source: dict, destination: Path, cancelled: Callable[[], bool], storage) -> ImportedSource:
    """Import through the first provider that manages it.

    Every attempt is named in the failure. "Download failed (yt-dlp): HTTP Error
    403" was a quoted upstream string that gave no clue which machine had failed
    or what to change; naming the provider is the difference between a dead end
    and a decision.
    """
    providers = provider_chain(source, storage)
    failures: list[str] = []
    for index, provider in enumerate(providers):
        try:
            imported = provider.import_video(source, destination, cancelled)
            imported.provider = provider.name
            return imported
        except ImportProviderError as exc:
            message = str(exc)
            if "cancelled" in message.lower():
                raise
            failures.append(f"{provider.name}: {message[:220]}")
            last = index == len(providers) - 1
            # Whether anything left in the chain can still learn something the
            # failed provider could not.
            #
            # The original rule was "only a block is worth another turn", on the
            # reasoning that a private or deleted video fails the same way
            # everywhere. True of a verdict; the trouble is that a managed
            # provider cannot deliver one. It downloads on someone else's IP, so
            # "This video is unavailable" from it describes their address, not
            # the video -- YouTube serves that exact string to blocked
            # datacenter ranges, and this box answers that wall with PO tokens
            # and client rotation the managed provider never had.
            #
            # Two real jobs died here, one on that string and one on a plain
            # timeout, with the local downloader sitting unused one line below.
            # So: give the local downloader its turn unless the message is a
            # verdict about the video (_FINAL_SIGNS). It runs on our own
            # hardware, costs one attempt, and is the only provider whose
            # "unavailable" is worth believing.
            local_left = any(p.name == YtDlpImportProvider.name for p in providers[index + 1:])
            if last or _looks_final(message) or not (local_left or _looks_blocked(message) or _looks_transient(message)):
                # Uploads never reach here (their chain is one provider and
                # raises above), so "upload it instead" is always the honest
                # way through for whoever reads this -- operator or, after the
                # web app's rewrite, the customer.
                trail = " | ".join(failures)[:800]
                # The hint belongs to a link import. Suggesting an upload to
                # someone whose stored source failed to read is advice about a
                # thing they already did.
                if source.get("type") == "youtube":
                    trail += " — uploading the video file (MP4 or MOV) will still work."
                raise ImportProviderError(trail) from exc
    raise ImportProviderError("No import provider was available.")


if __name__ == "__main__":  # pragma: no cover - diagnostic entry point
    # The production download path, runnable by hand:
    #
    #   python /app/worker/import_providers.py --probe <youtube url>
    #
    # Exists because a raw `yt-dlp <url>` probe tests yt-dlp's *default*
    # clients, not this module's rotation -- it said "Sign in to confirm you're
    # not a bot" while the rotation had three clients it never tried, one of
    # which is the client PO tokens pair with. A probe that does not run the
    # real path can pass while production fails, and fail while production
    # passes; this one cannot.
    import argparse
    import tempfile

    parser = argparse.ArgumentParser()
    parser.add_argument("--probe", metavar="URL", help="download this URL the way a job would")
    args = parser.parse_args()
    if not args.probe:
        parser.error("--probe URL is required")
    with tempfile.TemporaryDirectory() as scratch:
        target = Path(scratch) / "probe.mp4"
        try:
            probe_result = YtDlpImportProvider().import_video(
                {"type": "youtube", "url": args.probe}, target, lambda: False
            )
        except Exception as error:  # noqa: BLE001 - the message is the diagnosis
            print(f"PROBE FAILED: {error}")
            raise SystemExit(1)
        size_mb = probe_result.file.stat().st_size / (1024 * 1024)
        print(f"PROBE OK: {size_mb:.1f} MB downloaded — title: {probe_result.title or '(untitled)'}")
