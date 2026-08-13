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
            self._client = boto3.client(
                "s3", endpoint_url=self.endpoint, region_name=self.region,
                aws_access_key_id=os.getenv("OBJECT_STORAGE_ACCESS_KEY"),
                aws_secret_access_key=os.getenv("OBJECT_STORAGE_SECRET_KEY"),
            )
        return self._client

    def download(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.client.download_file(self.bucket, key, str(destination))

    def upload(self, source: Path, key: str, content_type: str) -> dict:
        self.client.upload_file(str(source), self.bucket, key, ExtraArgs={"ContentType": content_type})
        quoted = "/".join(__import__("urllib.parse", fromlist=["quote"]).quote(part, safe="") for part in key.split("/"))
        url = f"{self.public_url}/{quoted}" if self.public_url else f"{self.endpoint}/{self.bucket}/{quoted}"
        return {"key": key, "url": url}

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)
