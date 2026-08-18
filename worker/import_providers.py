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
from typing import Any, Callable


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
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response, destination.open("wb") as output:
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
    except urllib.error.HTTPError as exc:
        raise ImportProviderError(f"Video download failed with HTTP {exc.code}.") from exc


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


def _looks_blocked(message: str) -> bool:
    lowered = str(message).lower()
    return any(sign in lowered for sign in _BLOCK_SIGNS)


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
            options.update(youtube_network_options())
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
            raise ImportProviderError(f"SocialKit request failed with HTTP {exc.code}: {detail}") from exc
        except (TimeoutError, socket.timeout) as exc:
            raise ImportProviderError("SocialKit request timed out.") from exc
        except (ValueError, json.JSONDecodeError) as exc:
            raise ImportProviderError("SocialKit returned invalid JSON.") from exc

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
        info: dict = {}
        while True:
            if cancelled():
                raise ImportProviderError("Job cancelled.")
            if time.monotonic() > deadline:
                raise ImportProviderError("SocialKit download timed out. Upload the original MP4 or retry later.")
            time.sleep(self.poll_seconds)
            polled = self._call(f"{self.base}/v2/downloads/{job_id}?{status_query}")
            info = polled.get("data") if isinstance(polled, dict) else None
            if not isinstance(info, dict):
                raise ImportProviderError("SocialKit returned an unexpected job status.")
            state = str(info.get("status") or "").lower()
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
        if not key.startswith("uploads/") or ".." in key.split("/"):
            raise ImportProviderError("The uploaded video reference is invalid.")
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
            # A video that is private, deleted or age-gated fails the same way
            # everywhere; only a block is worth another provider's turn.
            if last or not _looks_blocked(message):
                # Uploads never reach here (their chain is one provider and
                # raises above), so "upload it instead" is always the honest
                # way through for whoever reads this -- operator or, after the
                # web app's rewrite, the customer.
                trail = " | ".join(failures)[:800]
                raise ImportProviderError(
                    f"{trail} — uploading the video file (MP4 or MOV) will still work."
                ) from exc
    raise ImportProviderError("No import provider was available.")
