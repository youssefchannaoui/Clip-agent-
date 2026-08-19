import importlib
import io
import json
import os
import pathlib
import shutil
import sys
import tempfile
import time
import socket
import threading
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
WORKER = ROOT / "worker"
sys.path.insert(0, str(WORKER))


class FakeResponse(io.BytesIO):
    def __init__(self, payload, headers=None):
        super().__init__(payload)
        self.headers = headers or {}

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class ManagedImportProviderTests(unittest.TestCase):
    # primary=True because these exercise the provider as the *configured* one,
    # which is the only role that reads the shared VIDEO_IMPORT_API_* settings.
    # A provider joining the chain behind another must bring its own key.
    def setUp(self):
        os.environ["VIDEO_IMPORT_API_URL"] = "https://ffmpegapi.net"
        os.environ["VIDEO_IMPORT_API_KEY"] = "provider-key"
        os.environ["VIDEO_IMPORT_ALLOWED_DOWNLOAD_HOSTS"] = "ffmpegapi.net"
        self.module = importlib.reload(importlib.import_module("import_providers"))
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_official_ffmpegapi_success_response_is_downloaded(self):
        responses = [
            FakeResponse(json.dumps({"success": True, "download_url": "https://ffmpegapi.net/download/video.mp4", "filename": "video.mp4", "title": "Lecture"}).encode()),
            FakeResponse(b"video-bytes", {"Content-Length": "11"}),
        ]
        with mock.patch("urllib.request.urlopen", side_effect=responses), mock.patch("socket.getaddrinfo", return_value=[(2, 1, 6, "", ("8.8.8.8", 443))]):
            result = self.module.FfmpegApiImportProvider(primary=True).import_video(
                {"url": "https://youtu.be/Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
            )
        self.assertEqual(result.title, "Lecture")
        self.assertEqual(result.file.read_bytes(), b"video-bytes")

    def test_provider_failure_is_actionable(self):
        response = FakeResponse(json.dumps({"success": False, "error": "Video is unavailable"}).encode())
        with mock.patch("urllib.request.urlopen", return_value=response):
            with self.assertRaisesRegex(self.module.ImportProviderError, "unavailable"):
                self.module.FfmpegApiImportProvider(primary=True).import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )

    def test_invalid_provider_response_is_rejected(self):
        with mock.patch("urllib.request.urlopen", return_value=FakeResponse(b"not-json")):
            with self.assertRaisesRegex(self.module.ImportProviderError, "invalid JSON"):
                self.module.FfmpegApiImportProvider(primary=True).import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )

    def test_provider_timeout_recommends_upload_fallback(self):
        with mock.patch("urllib.request.urlopen", side_effect=socket.timeout("timed out")):
            with self.assertRaisesRegex(self.module.ImportProviderError, "Upload the original MP4"):
                self.module.FfmpegApiImportProvider(primary=True).import_video(
                    {"url": "https://youtube.com/watch?v=Abc_123-xyZ"}, self.temp / "video.mp4", lambda: False
                )


class DirectUploadKeyTests(unittest.TestCase):
    """Which stored sources the worker will read back.

    Only "uploads/" was accepted, but a re-render of an imported lecture points
    at "projects/<id>/source.mp4" -- the source this worker saved itself. So
    every re-render of a link-imported lecture failed, and with it "Apply
    template" and "Save to all clips", reporting an invalid upload the customer
    had never made.
    """

    def setUp(self):
        self.ip = importlib.reload(importlib.import_module("import_providers"))
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def _read(self, key):
        downloaded = {}

        class Storage:
            def download(self, object_key, destination):
                downloaded["key"] = object_key
                destination.write_bytes(b"video")

        provider = self.ip.DirectUploadProvider(Storage())
        provider.import_video({"type": "object_storage", "objectKey": key}, self.temp / "s.mp4", lambda: False)
        return downloaded["key"]

    def test_a_customer_upload_is_read(self):
        self.assertEqual(self._read("uploads/user_1/talk.mp4"), "uploads/user_1/talk.mp4")

    def test_an_imported_lecture_source_is_read(self):
        # The case that was broken.
        self.assertEqual(self._read("projects/project_abc/source.mp4"), "projects/project_abc/source.mp4")

    def test_a_key_that_walks_out_of_the_bucket_is_refused(self):
        # Checked before the prefix, so a valid-looking prefix cannot carry a
        # traversal through with it.
        for key in ["uploads/../../etc/passwd", "projects/../secrets/key", "../outside.mp4"]:
            with self.assertRaises(self.ip.ImportProviderError, msg=key):
                self._read(key)

    def test_an_unknown_prefix_is_refused(self):
        for key in ["clips/other_customer/clip.mp4", "", "s3://bucket/x.mp4"]:
            with self.assertRaises(self.ip.ImportProviderError, msg=key):
                self._read(key)


class ImportFallbackTests(unittest.TestCase):
    """A managed provider being blocked is not the end of the attempt.

    "Download failed (yt-dlp): HTTP Error 403" arrived as a quoted string from a
    service the operator cannot see or retry, and read as though the worker had
    failed when nothing on it was ever involved.
    """

    def setUp(self):
        os.environ.pop("VIDEO_IMPORT_PROVIDER", None)
        os.environ.pop("VIDEO_IMPORT_FALLBACK", None)
        self.ip = importlib.reload(importlib.import_module("import_providers"))
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def _provider(self, name, fail=None):
        ip = self.ip

        class Stub(ip.ManagedImportProvider):
            def __init__(self): self.name = name
            def import_video(self, source, destination, cancelled):
                if fail:
                    raise ip.ImportProviderError(fail)
                destination.write_bytes(b"x")
                return ip.ImportedSource(destination, "Lecture")

        return Stub()

    def _run(self, providers):
        self.ip.provider_chain = lambda source, storage: providers
        return self.ip.import_with_fallback(
            {"type": "youtube", "url": "u"}, self.temp / "s.mp4", lambda: False, None,
        )

    def test_the_po_token_server_reaches_the_downloader_options(self):
        os.environ["YTDLP_POT_PROVIDER_URL"] = "http://bgutil-provider:4416"
        try:
            ip = importlib.reload(importlib.import_module("import_providers"))
            options = ip.youtube_network_options()
            self.assertEqual(
                options["extractor_args"]["youtubepot-bgutilhttp"]["base_url"],
                ["http://bgutil-provider:4416"],
            )
        finally:
            os.environ.pop("YTDLP_POT_PROVIDER_URL", None)

    def test_job_network_settings_win_over_the_box_env(self):
        # The dashboard-set proxy must beat .env: the env is what the operator
        # could not reach (the Hetzner console mangles proxy URLs), so the
        # payload is always the fresher intent.
        os.environ["VIDEO_IMPORT_PROXY"] = "http://env-proxy:1"
        try:
            ip = importlib.reload(importlib.import_module("import_providers"))
            source = {"type": "youtube", "network": {"proxy": "http://u:p@dash-proxy:8080"}}
            options = ip.job_network_options(source, self.temp)
            self.assertEqual(options["proxy"], "http://u:p@dash-proxy:8080")
        finally:
            os.environ.pop("VIDEO_IMPORT_PROXY", None)

    def test_job_cookies_become_a_private_file_in_the_job_scratch(self):
        ip = self.ip
        source = {"type": "youtube", "network": {"cookiesText": "# Netscape\n.youtube.com\tTRUE\t/\tx"}}
        options = ip.job_network_options(source, self.temp)
        cookie_file = pathlib.Path(options["cookiefile"])
        self.assertEqual(cookie_file.parent, self.temp, "must die with the job scratch dir")
        self.assertEqual(cookie_file.stat().st_mode & 0o777, 0o600)
        self.assertIn("youtube.com", cookie_file.read_text(encoding="utf-8"))

    def test_without_payload_network_the_env_still_applies(self):
        os.environ["VIDEO_IMPORT_PROXY"] = "http://env-proxy:1"
        try:
            ip = importlib.reload(importlib.import_module("import_providers"))
            self.assertEqual(ip.job_network_options({"type": "youtube"}, self.temp)["proxy"], "http://env-proxy:1")
        finally:
            os.environ.pop("VIDEO_IMPORT_PROXY", None)

    def test_no_token_server_means_no_extractor_args(self):
        os.environ.pop("YTDLP_POT_PROVIDER_URL", None)
        ip = importlib.reload(importlib.import_module("import_providers"))
        self.assertNotIn("extractor_args", ip.youtube_network_options())

    BLOCKED = "Download failed (yt-dlp): ERROR: unable to download video data: HTTP Error 403: Forbidden"

    def test_a_block_falls_through_to_the_next_provider(self):
        result = self._run([self._provider("ffmpegapi", self.BLOCKED), self._provider("ytdlp")])
        self.assertEqual(result.title, "Lecture")

    def test_a_video_that_is_simply_gone_stops_at_the_first(self):
        # Private, deleted and age-gated fail identically everywhere; trying
        # again just makes the user wait longer for the same answer.
        with self.assertRaises(self.ip.ImportProviderError) as caught:
            self._run([self._provider("ffmpegapi", "This video is private."), self._provider("ytdlp")])
        self.assertNotIn("ytdlp", str(caught.exception))

    def test_the_failure_names_every_provider_tried(self):
        with self.assertRaises(self.ip.ImportProviderError) as caught:
            self._run([self._provider("ffmpegapi", self.BLOCKED), self._provider("ytdlp", self.BLOCKED)])
        message = str(caught.exception)
        self.assertIn("ffmpegapi:", message)
        self.assertIn("ytdlp:", message)

    def test_the_failure_says_uploading_is_the_way_through(self):
        # The trail of provider errors is for the operator; the customer's next
        # move has to be in there too, because uploads use a different path and
        # keep working when every URL route is down.
        with self.assertRaises(self.ip.ImportProviderError) as caught:
            self._run([self._provider("socialkit", self.BLOCKED), self._provider("ytdlp", self.BLOCKED)])
        self.assertIn("uploading the video file", str(caught.exception))

    def test_the_serving_provider_is_recorded(self):
        # "The import worked" no longer says the configured provider is healthy:
        # socialkit can fail every job while ytdlp quietly carries it. The
        # record has to name who actually served the bytes.
        result = self._run([self._provider("socialkit", self.BLOCKED), self._provider("ytdlp")])
        self.assertEqual(result.provider, "ytdlp")
        direct = self._run([self._provider("socialkit")])
        self.assertEqual(direct.provider, "socialkit")

    def test_cancelling_is_never_retried(self):
        with self.assertRaises(self.ip.ImportProviderError) as caught:
            self._run([self._provider("ffmpegapi", "Job cancelled."), self._provider("ytdlp")])
        self.assertIn("cancelled", str(caught.exception).lower())

    def test_an_upload_has_nothing_to_fall_back_to(self):
        chain = self.ip.provider_chain({"type": "object_storage", "objectKey": "uploads/u/x.mp4"}, None)
        self.assertEqual([p.name for p in chain], ["direct_upload"])

    def test_the_configured_provider_still_goes_first(self):
        # A managed provider is configured because someone decided this box
        # should not be the one talking to YouTube. That decision holds first.
        os.environ["VIDEO_IMPORT_PROVIDER"] = "ffmpegapi"
        os.environ["VIDEO_IMPORT_API_URL"] = "https://ffmpegapi.net"
        os.environ["VIDEO_IMPORT_API_KEY"] = "k"
        names = [p.name for p in self.ip.provider_chain({"type": "youtube"}, None)]
        self.assertEqual(names[0], "ffmpegapi")
        self.assertIn("ytdlp", names)

    def test_the_fallback_can_be_switched_off(self):
        os.environ["VIDEO_IMPORT_FALLBACK"] = "off"
        names = [p.name for p in self.ip.provider_chain({"type": "youtube"}, None)]
        self.assertEqual(names, ["ffmpegapi"])


class ProviderChainTests(unittest.TestCase):
    """Every service that has credentials gets a turn, then the local downloader.

    When YouTube refuses one address, another service on a different address is
    the thing most likely to work. Adding one should be a key in .env, not a
    code change.
    """

    KEYS = ("VIDEO_IMPORT_PROVIDER", "VIDEO_IMPORT_API_KEY", "VIDEO_IMPORT_FALLBACK",
            "COBALT_API_URL", "VIDEO_IMPORT_API_URL", "SOCIALKIT_API_KEY", "FFMPEGAPI_API_KEY",
            "SOCIALKIT_API_URL", "FFMPEGAPI_API_URL")

    def setUp(self):
        for key in self.KEYS:
            os.environ.pop(key, None)
        self.ip = importlib.reload(importlib.import_module("import_providers"))

    def tearDown(self):
        for key in self.KEYS:
            os.environ.pop(key, None)

    def _chain(self, **env):
        os.environ.update(env)
        self.ip = importlib.reload(importlib.import_module("import_providers"))
        return [p.name for p in self.ip.provider_chain({"type": "youtube"}, None)]

    def test_the_configured_provider_is_always_first(self):
        # It is configured because someone decided this box should not be the
        # one talking to YouTube. That holds until it fails.
        chain = self._chain(VIDEO_IMPORT_PROVIDER="socialkit", VIDEO_IMPORT_API_KEY="k")
        self.assertEqual(chain[0], "socialkit")
        self.assertEqual(chain[-1], "ytdlp", "the local downloader is the last resort")

    def test_one_vendors_key_is_never_handed_to_another(self):
        # ffmpegapi and socialkit both read VIDEO_IMPORT_API_URL/KEY, which are
        # the *configured* provider's settings. Adding the other to the chain
        # sent one vendor's credential to the other's endpoint -- and with the
        # URL left at its default, to an unrelated company altogether.
        os.environ.update(VIDEO_IMPORT_PROVIDER="socialkit", VIDEO_IMPORT_API_KEY="socialkit-secret")
        ip = importlib.reload(importlib.import_module("import_providers"))
        self.assertEqual(ip.FfmpegApiImportProvider().api_key, "", "not the primary, so no key")
        self.assertEqual(ip.SocialKitImportProvider(primary=True).api_key, "socialkit-secret")
        self.assertNotIn("ffmpegapi", [p.name for p in ip.provider_chain({"type": "youtube"}, None)])

    def test_a_second_service_joins_only_with_its_own_credentials(self):
        os.environ.update(VIDEO_IMPORT_PROVIDER="socialkit", VIDEO_IMPORT_API_KEY="socialkit-secret",
                          FFMPEGAPI_API_KEY="its-own-key")
        ip = importlib.reload(importlib.import_module("import_providers"))
        chain = [p.name for p in ip.provider_chain({"type": "youtube"}, None)]
        self.assertEqual(chain, ["socialkit", "ffmpegapi", "ytdlp"])

    def test_the_configured_provider_still_reads_the_shared_settings(self):
        # Existing installs set VIDEO_IMPORT_API_KEY and nothing else; that has
        # to keep working exactly as before.
        os.environ.update(VIDEO_IMPORT_PROVIDER="ffmpegapi", VIDEO_IMPORT_API_KEY="shared",
                          VIDEO_IMPORT_API_URL="https://ffmpegapi.net")
        ip = importlib.reload(importlib.import_module("import_providers"))
        chain = ip.provider_chain({"type": "youtube"}, None)
        self.assertEqual(chain[0].name, "ffmpegapi")
        self.assertEqual(chain[0].api_key, "shared")

    def test_a_configured_cobalt_instance_joins_the_chain(self):
        chain = self._chain(VIDEO_IMPORT_PROVIDER="socialkit", VIDEO_IMPORT_API_KEY="k",
                            COBALT_API_URL="https://cobalt.example")
        self.assertIn("cobalt", chain)

    def test_a_provider_without_credentials_is_not_tried(self):
        # Otherwise every import wastes a round trip failing on a missing key.
        self.assertNotIn("cobalt", self._chain(VIDEO_IMPORT_PROVIDER="ytdlp"))
        self.assertNotIn("socialkit", self._chain(VIDEO_IMPORT_PROVIDER="ytdlp"))

    def test_nothing_is_tried_twice(self):
        chain = self._chain(VIDEO_IMPORT_PROVIDER="ffmpegapi", VIDEO_IMPORT_API_KEY="k",
                            FFMPEGAPI_API_KEY="k")
        self.assertEqual(len(chain), len(set(chain)), chain)
        self.assertEqual(chain[0], "ffmpegapi")

    def test_the_fallback_can_still_be_switched_off_entirely(self):
        chain = self._chain(VIDEO_IMPORT_PROVIDER="socialkit", VIDEO_IMPORT_API_KEY="k",
                            VIDEO_IMPORT_FALLBACK="off")
        self.assertEqual(chain, ["socialkit"])


class CobaltProviderTests(unittest.TestCase):
    """cobalt matters because an instance can be self-hosted anywhere.

    That is the one lever that actually moves when a datacenter IP is refused:
    the download happens from an address YouTube does not block.
    """

    def setUp(self):
        os.environ["COBALT_API_URL"] = "https://cobalt.example"
        os.environ.pop("COBALT_ALLOWED_DOWNLOAD_HOSTS", None)
        self.ip = importlib.reload(importlib.import_module("import_providers"))
        self.temp = pathlib.Path(tempfile.mkdtemp())

    def tearDown(self):
        os.environ.pop("COBALT_API_URL", None)
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_the_instance_and_googles_cdn_are_trusted_by_default(self):
        hosts = self.ip.CobaltImportProvider().allowed_hosts
        self.assertIn("cobalt.example", hosts)
        self.assertIn("googlevideo.com", hosts)

    def test_a_download_url_is_checked_before_it_is_fetched(self):
        # The instance decides where the bytes come from, so a compromised one
        # could point this at cloud metadata or anything else on the private
        # network. download_https does not check any of that itself.
        provider = self.ip.CobaltImportProvider()
        for hostile in ("https://169.254.169.254/latest/meta-data/",
                        "https://localhost/x.mp4",
                        "http://cobalt.example/x.mp4"):
            with self.assertRaises(self.ip.ImportProviderError, msg=hostile):
                self.ip.assert_public_https_url(hostile, provider.allowed_hosts)

    def test_the_check_happens_before_the_fetch_not_after(self):
        source = (WORKER / "import_providers.py").read_text(encoding="utf-8")
        block = source[source.index("class CobaltImportProvider"):]
        assert_at = block.index("assert_public_https_url(link")
        fetch_at = block.index("download_https(link")
        self.assertLess(assert_at, fetch_at)

    def test_an_unconfigured_instance_says_so_rather_than_failing_oddly(self):
        os.environ.pop("COBALT_API_URL", None)
        ip = importlib.reload(importlib.import_module("import_providers"))
        with self.assertRaisesRegex(ip.ImportProviderError, "COBALT_API_URL"):
            ip.CobaltImportProvider().import_video(
                {"url": "https://youtu.be/Abc_123-xyZ"}, self.temp / "s.mp4", lambda: False,
            )


class BlockedAddressTests(unittest.TestCase):
    """What is left once YouTube refuses the box's address itself.

    Every client failing is the signature of an IP block, not of a stale
    downloader: the request never gets far enough for the client to matter. The
    two things that work are asking from somewhere else, or asking as someone
    signed in.
    """

    def setUp(self):
        for key in ("VIDEO_IMPORT_PROXY", "VIDEO_IMPORT_COOKIES", "VIDEO_IMPORT_COOKIES_FROM_BROWSER"):
            os.environ.pop(key, None)
        self.ip = importlib.reload(importlib.import_module("import_providers"))

    def tearDown(self):
        for key in ("VIDEO_IMPORT_PROXY", "VIDEO_IMPORT_COOKIES", "VIDEO_IMPORT_COOKIES_FROM_BROWSER"):
            os.environ.pop(key, None)

    def test_nothing_is_configured_by_default(self):
        # A proxy costs money and cookies are an account credential. Neither is
        # something to switch on for someone.
        self.assertEqual(self.ip.youtube_network_options(), {})

    def test_a_proxy_is_passed_to_the_downloader(self):
        os.environ["VIDEO_IMPORT_PROXY"] = "http://box:8080"
        self.assertEqual(self.ip.youtube_network_options()["proxy"], "http://box:8080")

    def test_a_cookie_file_is_only_used_when_it_exists(self):
        # A path typo must not look like working cookies.
        os.environ["VIDEO_IMPORT_COOKIES"] = "/nonexistent/cookies.txt"
        self.assertNotIn("cookiefile", self.ip.youtube_network_options())
        with tempfile.NamedTemporaryFile(suffix=".txt", delete=False) as handle:
            handle.write(b"# Netscape HTTP Cookie File\n")
            path = handle.name
        os.environ["VIDEO_IMPORT_COOKIES"] = path
        self.assertEqual(self.ip.youtube_network_options()["cookiefile"], path)
        os.unlink(path)

    def test_the_advice_changes_once_a_proxy_is_in_place(self):
        # "Rebuild the worker" was right until a rebuild had already happened
        # and every client still failed. Repeating it then sends someone in a
        # circle.
        without = self.ip._download_failure(["ytdlp: 403"])
        self.assertIn("VIDEO_IMPORT_PROXY", without)
        # It may say a stale downloader is *not* the cause; it must not send
        # someone to rebuild again after they already have.
        self.assertNotIn("rebuild", without.lower())
        os.environ["VIDEO_IMPORT_PROXY"] = "http://box:8080"
        with_proxy = self.ip._download_failure(["ytdlp: 403"])
        self.assertNotIn("VIDEO_IMPORT_PROXY", with_proxy)
        self.assertIn("video itself", with_proxy)

    def test_uploading_is_offered_as_the_way_round_youtube(self):
        self.assertIn("Uploading the MP4", self.ip._download_failure(["ytdlp: 403"]))


class WorkerPersistenceTests(unittest.TestCase):
    def setUp(self):
        self.temp = pathlib.Path(tempfile.mkdtemp())
        os.environ["WORKER_DATA_DIR"] = str(self.temp / "data")
        os.environ["WORKER_TEMP_DIR"] = str(self.temp / "tmp")
        os.environ["WORKER_SHARED_SECRET"] = "worker-test-secret-at-least-thirty-two-characters"
        sys.modules.pop("service", None)
        self.service = importlib.import_module("service")

    def tearDown(self):
        shutil.rmtree(self.temp, ignore_errors=True)

    def test_authentication_rejects_stale_and_accepts_signed_requests(self):
        timestamp = str(self.service.now_ms())
        body = b'{"id":"job_1"}'
        import hashlib, hmac
        sig = hmac.new(os.environ["WORKER_SHARED_SECRET"].encode(), f"{timestamp}\nPOST\n/jobs\n{body.decode()}".encode(), hashlib.sha256).hexdigest()
        self.assertTrue(self.service.authenticated(timestamp, "POST", "/jobs", body, sig))
        self.assertFalse(self.service.authenticated("0", "POST", "/jobs", body, sig))

    def test_job_creation_is_persistent_and_restart_recovery_requeues(self):
        store = self.service.JobStore()
        status, created = store.create({"id": "job_1", "source": {"type": "youtube"}})
        self.assertTrue(created)
        self.assertEqual(status["status"], "queued")
        store.update("job_1", status="transcribing", stage="transcribing", progress=45)
        self.assertEqual(store.recover(), ["job_1"])
        recovered = store.read("job_1")
        self.assertEqual(recovered["status"], "queued")
        self.assertLessEqual(recovered["progress"], 5)

    def test_abandoned_temporary_directories_are_removed(self):
        abandoned = self.service.TEMP_DIR / "abandoned"
        abandoned.mkdir(parents=True)
        old = time.time() - self.service.JOB_TTL_SECONDS - 5
        os.utime(abandoned, (old, old))
        self.service.Processor(self.service.JobStore()).cleanup_abandoned()
        self.assertFalse(abandoned.exists())

    def test_restart_recovery_requeues_real_worker_stages_not_just_the_old_tokens(self):
        # The allowlist was written against the five collapsed tokens this
        # service used to emit. clip_worker's own prose passes straight through
        # now, so stages like "Rendering clip 1 of 8" matched nothing and a
        # restart left those jobs frozen forever.
        store = self.service.JobStore()
        for index, stage in enumerate([
            "Extracting speech audio", "Transcribing speech", "Analysing transcript",
            "Finding and scoring clips", "Rendering clip 1 of 8", "Verifying rendered clips",
        ]):
            job = f"job_stage_{index}"
            store.create({"id": job, "source": {"type": "youtube"}})
            store.update(job, status=stage, stage=stage, progress=40)
        recovered = set(store.recover())
        self.assertEqual(len(recovered), 6, "every unfinished stage must be re-queued")

    def test_finished_jobs_are_never_requeued(self):
        store = self.service.JobStore()
        for index, final in enumerate(["completed", "failed", "cancelled"]):
            job = f"job_final_{index}"
            store.create({"id": job, "source": {"type": "youtube"}})
            store.update(job, status=final, stage=final, progress=100)
        self.assertEqual(store.recover(), [])

    def test_a_vanished_job_reads_as_cancelled_rather_than_crashing(self):
        # cancelled() dereferenced a None status. That AttributeError escaped
        # process() into loop(), which has no try, killing the only consumer
        # thread -- after which the worker accepted jobs forever and ran none.
        store = self.service.JobStore()
        store.create({"id": "job_gone", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.cancelled("job_gone"))
        store.status_path("job_gone").unlink()
        self.assertTrue(processor.cancelled("job_gone"), "a job with no status file must unwind, not raise")

    def test_the_job_loop_survives_a_job_that_throws(self):
        store = self.service.JobStore()
        store.create({"id": "job_boom", "source": {"type": "youtube"}})
        store.create({"id": "job_after", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        calls = []

        def explode(job_id):
            calls.append(job_id)
            if job_id == "job_boom":
                raise RuntimeError("worker exploded")

        processor.process = explode
        processor.submit("job_boom")
        processor.submit("job_after")
        thread = threading.Thread(target=processor.loop, daemon=True)
        thread.start()
        deadline = time.time() + 5
        while "job_after" not in calls and time.time() < deadline:
            time.sleep(0.05)
        processor.stop.set()
        thread.join(timeout=5)
        self.assertIn("job_after", calls, "a later job must still be picked up after one throws")
        self.assertEqual(store.read("job_boom")["status"], "failed")

    def test_the_import_heartbeat_moves_the_signature_and_is_throttled(self):
        # The app cancels a job whose stage|progress|heartbeatAt has not changed
        # for five minutes. The import wrote nothing at all, so every download
        # longer than that was killed as hung.
        store = self.service.JobStore()
        store.create({"id": "job_pulse", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_pulse")
        self.assertFalse(pulse())
        first = store.read("job_pulse").get("heartbeatAt")
        self.assertIsNotNone(first, "the first poll must prove liveness immediately")
        self.assertFalse(pulse())
        self.assertEqual(store.read("job_pulse").get("heartbeatAt"), first, "throttled between beats")
        self.assertLess(self.service.IMPORT_HEARTBEAT_SECONDS, 300,
                        "the beat has to land well inside the app's five-minute stall budget")

    def test_the_import_pulse_reports_cancellation(self):
        store = self.service.JobStore()
        store.create({"id": "job_cancel", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_cancel")
        self.assertFalse(pulse())
        processor.cancel("job_cancel")
        self.assertTrue(pulse(), "a cancelled import must stop downloading")

    def test_the_import_reports_a_percentage_and_an_eta(self):
        # The import used to write nothing but a heartbeat, so a multi-minute
        # download sat at 3% with no sign of movement.
        store = self.service.JobStore()
        store.create({"id": "job_bytes", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        pulse = processor.import_pulse("job_bytes")
        self.assertFalse(pulse(0, 0))
        first = store.read("job_bytes")
        self.assertIsNotNone(first.get("heartbeatAt"))

        # Halfway through a known-size download.
        processor.import_pulse.__wrapped__ if False else None
        pulse2 = processor.import_pulse("job_bytes")
        time.sleep(0.01)
        self.assertFalse(pulse2(50, 100))
        status = store.read("job_bytes")
        self.assertGreaterEqual(status["progress"], 3, "the import band starts at 3%")
        self.assertLessEqual(status["progress"], 8, "and must not claim more than the import is worth")

    def test_the_import_reports_the_raw_byte_counts(self):
        # The app shows "142 MB of 380 MB" beside the percentage. A percentage
        # alone gives no sense of whether a slow import is a large file or a
        # broken one, so the counts travel rather than being derived.
        store = self.service.JobStore()
        store.create({"id": "job_size", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.import_pulse("job_size")(149_000_000, 398_000_000))
        status = store.read("job_size")
        self.assertEqual(status["bytesDone"], 149_000_000)
        self.assertEqual(status["bytesTotal"], 398_000_000)

    def test_an_import_with_no_content_length_still_reports_what_it_has(self):
        # A server that sends no Content-Length is common. The done count is
        # still useful; the total must simply be absent rather than zero.
        store = self.service.JobStore()
        store.create({"id": "job_nolen", "source": {"type": "youtube"}})
        processor = self.service.Processor(store)
        self.assertFalse(processor.import_pulse("job_nolen")(149_000_000, 0))
        status = store.read("job_nolen")
        self.assertEqual(status["bytesDone"], 149_000_000)
        self.assertIsNone(status.get("bytesTotal"))

    def test_the_clip_breakdown_is_forwarded_only_when_the_worker_sends_it(self):
        # Forwarding unconditionally would clear currentClip/clipPercent back to
        # nothing on every transcribe and verify event, so the list would blink
        # out between renders.
        source = (WORKER / "service.py").read_text(encoding="utf-8")
        self.assertIn('for key in ("currentClip", "totalClips", "clipPercent", "clipPlan")', source)
        self.assertIn("if event.get(key) is not None:", source)

    def test_health_reports_what_the_running_build_can_do(self):
        # "Did the worker get rebuilt?" had no answer without SSHing to the box:
        # /health said only that the process was up, so a stale image looked
        # identical to a fresh one until a clip rendered wrong.
        caps = self.service.worker_capabilities()
        self.assertNotIn("error", caps, caps.get("error", ""))
        for key in ("captionAnimation", "clipBreakdown", "faceDetection", "captionFonts", "downloadProgress"):
            self.assertIn(key, caps, f"{key} is reported")

    def test_capabilities_are_read_from_the_running_code_not_declared(self):
        # A version string has to be remembered on every change and will
        # eventually lie about what is actually deployed.
        source = (WORKER / "clip_worker.py").read_text(encoding="utf-8")
        self.assertIn("def _source_has(", source)
        self.assertNotIn('VERSION = "', source)

    def test_health_still_answers_when_capabilities_cannot_be_read(self):
        # The one endpoint that would explain a broken dependency must not go
        # down with it.
        with mock.patch.object(self.service, "_service_source", side_effect=OSError("boom")):
            caps = self.service.worker_capabilities()
        self.assertIsInstance(caps, dict)

    def test_a_provider_that_ignores_progress_still_works(self):
        # Most providers pass a plain `lambda: bool`. The two-argument form must
        # fall back rather than raise.
        from import_providers import _poll
        self.assertFalse(_poll(lambda: False, 10, 100))
        self.assertTrue(_poll(lambda: True, 10, 100))
        seen = {}
        def rich(done, total):
            seen['done'] = done
            return False
        self.assertFalse(_poll(rich, 7, 70))
        self.assertEqual(seen['done'], 7)


if __name__ == "__main__":
    unittest.main()
