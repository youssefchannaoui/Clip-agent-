import hashlib
import hmac
import os
import time
import urllib.request

secret = os.environ["WORKER_SHARED_SECRET"]
timestamp = str(int(time.time() * 1000))
path = "/health"
signature = hmac.new(secret.encode(), f"{timestamp}\nGET\n{path}\n".encode(), hashlib.sha256).hexdigest()
request = urllib.request.Request(
    f"http://127.0.0.1:{os.getenv('WORKER_PORT', '8080')}{path}",
    headers={"X-DeenClipped-Timestamp": timestamp, "X-DeenClipped-Signature": signature},
)
with urllib.request.urlopen(request, timeout=5) as response:
    raise SystemExit(0 if response.status == 200 else 1)
