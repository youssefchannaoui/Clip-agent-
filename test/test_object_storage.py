import pathlib
import tempfile
import unittest
from typing import Optional

from worker.object_storage import ObjectStorage


class FakeClient:
    def __init__(self, body: bytes = b"video", reported_size: Optional[int] = None):
        self.body = body
        self.reported_size = len(body) if reported_size is None else reported_size
        self.uploaded = None

    def download_file(self, _bucket, _key, destination):
        pathlib.Path(destination).write_bytes(self.body)

    def upload_file(self, source, bucket, key, ExtraArgs=None):
        self.uploaded = (pathlib.Path(source).read_bytes(), bucket, key, ExtraArgs)

    def head_object(self, **_kwargs):
        return {"ContentLength": self.reported_size}


class ObjectStorageReliabilityTests(unittest.TestCase):
    def test_download_is_atomic_and_rejects_empty_objects(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = pathlib.Path(directory) / "source.mp4"
            destination.write_bytes(b"existing")
            ObjectStorage(client=FakeClient(b"new-video")).download("source.mp4", destination)
            self.assertEqual(destination.read_bytes(), b"new-video")
            self.assertFalse(destination.with_name("source.mp4.part").exists())

            with self.assertRaisesRegex(RuntimeError, "empty"):
                ObjectStorage(client=FakeClient(b"")).download("empty.mp4", destination)
            self.assertEqual(destination.read_bytes(), b"new-video")

    def test_upload_verifies_the_remote_content_length(self):
        with tempfile.TemporaryDirectory() as directory:
            source = pathlib.Path(directory) / "clip.mp4"
            source.write_bytes(b"rendered-clip")
            storage = ObjectStorage(client=FakeClient(reported_size=13))
            uploaded = storage.upload(source, "clips/clip.mp4", "video/mp4")
            self.assertEqual(uploaded["key"], "clips/clip.mp4")
            self.assertEqual(storage.client.uploaded[0], b"rendered-clip")

            with self.assertRaisesRegex(RuntimeError, "incomplete"):
                ObjectStorage(client=FakeClient(reported_size=2)).upload(source, "clips/bad.mp4", "video/mp4")


if __name__ == "__main__":
    unittest.main()
