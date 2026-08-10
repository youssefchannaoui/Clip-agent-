"""Small S3-compatible storage wrapper for worker inputs and outputs."""
from __future__ import annotations

import os
from pathlib import Path


class ObjectStorage:
    def __init__(self, client=None) -> None:
        self.endpoint = os.getenv("OBJECT_STORAGE_ENDPOINT", "").rstrip("/")
        self.region = os.getenv("OBJECT_STORAGE_REGION", "auto")
        self.bucket = os.getenv("OBJECT_STORAGE_BUCKET", "")
        self.public_url = os.getenv("OBJECT_STORAGE_PUBLIC_URL", "").rstrip("/")
        self._client = client

    @property
    def configured(self) -> bool:
        return bool(self.endpoint and self.bucket and os.getenv("OBJECT_STORAGE_ACCESS_KEY") and os.getenv("OBJECT_STORAGE_SECRET_KEY"))

    @property
    def client(self):
        if self._client is None:
            if not self.configured:
                raise RuntimeError("S3-compatible object storage is not configured.")
            import boto3
            from botocore.config import Config
            self._client = boto3.client(
                "s3", endpoint_url=self.endpoint, region_name=self.region,
                aws_access_key_id=os.getenv("OBJECT_STORAGE_ACCESS_KEY"),
                aws_secret_access_key=os.getenv("OBJECT_STORAGE_SECRET_KEY"),
                config=Config(
                    connect_timeout=15,
                    read_timeout=120,
                    retries={"max_attempts": 5, "mode": "adaptive"},
                ),
            )
        return self._client

    def download(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".part")
        temporary.unlink(missing_ok=True)
        try:
            self.client.download_file(self.bucket, key, str(temporary))
            if not temporary.is_file() or temporary.stat().st_size <= 0:
                raise RuntimeError("Object storage returned a missing or empty file.")
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)

    def upload(self, source: Path, key: str, content_type: str) -> dict:
        if not source.is_file() or source.stat().st_size <= 0:
            raise RuntimeError("The file selected for object-storage upload is missing or empty.")
        self.client.upload_file(str(source), self.bucket, key, ExtraArgs={"ContentType": content_type})
        uploaded = self.client.head_object(Bucket=self.bucket, Key=key)
        if int(uploaded.get("ContentLength") or -1) != source.stat().st_size:
            raise RuntimeError("Object-storage verification found an incomplete upload.")
        quoted = "/".join(__import__("urllib.parse", fromlist=["quote"]).quote(part, safe="") for part in key.split("/"))
        url = f"{self.public_url}/{quoted}" if self.public_url else f"{self.endpoint}/{self.bucket}/{quoted}"
        return {"key": key, "url": url}

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)
