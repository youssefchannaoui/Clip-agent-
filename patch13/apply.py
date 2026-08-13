#!/usr/bin/env python3
"""
Stop a failed upload from killing the whole server.

WHAT HAPPENED (Render logs, 11 Aug)
-----------------------------------
07:00  YouTube publish fails: "Token has been expired or revoked."   <- ordinary
07:45  YouTube reconnected, publish retried
07:46  "youtube publishing will retry ... (2/5): fetch failed"
07:46  Error: ENOENT ... /app/data/publish-cache/project_...-03.mp4
       Emitted 'error' event on ReadStream instance
       ==> Instance restarted
07:48  identical crash on retry 3/5

So every retry took the entire Node process down. Not one failed post — the
whole service, repeatedly.

THREE BUGS, IN THE ORDER THEY BITE
----------------------------------
1. Content-Length is literally the string "undefined".

   src/social.js sends `String(body.length)` where `body` is a ReadStream.
   Streams have no `.length`, so every YouTube chunk upload declared
   `Content-Length: undefined`. That is what "fetch failed" was — undici
   rejecting the request before it left the machine. The upload could never
   have succeeded. Fixed to the real byte count of the chunk.

2. A ReadStream error with no listener kills the process.

   When the upload fails, agent.js runs `releaseSocialPublishFile(file)` in a
   `finally`, which deletes the cached MP4. The ReadStream opened for the
   in-flight chunk is still live, so it then errors with ENOENT. Node's rule:
   an 'error' event with no listener is rethrown as an uncaught exception and
   terminates the process. Both upload paths (YouTube chunks, TikTok/Facebook
   whole-file) created streams with no error handler.

3. Render's filesystem is ephemeral.

   After each crash-restart, /app/data/publish-cache is empty, so the next
   retry could not find the file even if it had been readable. Combined with
   (2), that guaranteed a crash loop rather than a single failure.

WHAT THIS PATCH DOES
--------------------
- Sends the correct Content-Length for each chunk.
- Routes both uploads through publishReadStream(), which verifies the file
  exists and attaches an error listener, converting a missing or unreadable
  file into a normal retryable SocialError instead of a process-level crash.

Deliberately NOT added: a global uncaughtException handler. It would have
masked this bug rather than surfacing it, and the crash was the only reason
this got noticed at all.

Run from your repo root:

    python3 patch13/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "social.js").exists():
    sys.exit("Can't find src/social.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:300]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ---------------------------------------------------------------- the helper

edit(
    "src/social.js",
    "const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));",
    "const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));\n"
    "\n"
    "/**\n"
    " * Open an upload stream that cannot take the process down.\n"
    " *\n"
    " * A ReadStream that emits 'error' with no listener attached is rethrown by\n"
    " * Node as an uncaught exception, which terminates the server. That is\n"
    " * exactly how one missing publish-cache file turned a failed YouTube upload\n"
    " * into a repeating production outage: the upload fails, the caller deletes\n"
    " * the cached file in its `finally`, and the still-open stream then errors\n"
    " * with ENOENT against a process that is not listening.\n"
    " *\n"
    " * Publishing is best-effort and retried, so a missing file is a normal\n"
    " * retryable condition, never a fatal one.\n"
    " */\n"
    "function publishReadStream(file, options = {}, provider = '') {\n"
    "  if (!file || !fs.existsSync(file)) {\n"
    "    throw new SocialError(\n"
    "      'The prepared upload file is no longer available. It will be rebuilt on the next attempt.',\n"
    "      { retryable: true, provider },\n"
    "    );\n"
    "  }\n"
    "  const stream = fs.createReadStream(file, options);\n"
    "  // The listener alone is what prevents the crash. fetch() still rejects on\n"
    "  // a broken stream, so the failure surfaces normally through the caller.\n"
    "  stream.on('error', () => {});\n"
    "  return stream;\n"
    "}",
    "publishReadStream() helper",
)


# ------------------------------------------------------------------- youtube

edit(
    "src/social.js",
    "    const body = fs.createReadStream(file, { start: offset, end: endExclusive - 1 });",
    "    const body = publishReadStream(file, { start: offset, end: endExclusive - 1 }, 'youtube');",
    "youtube: crash-safe chunk stream",
)

edit(
    "src/social.js",
    "          'Content-Length': String(body.length),",
    "          // A ReadStream has no .length, so this used to send the literal\n"
    "          // string \"undefined\" and undici rejected the request as\n"
    "          // \"fetch failed\" before it ever reached YouTube.\n"
    "          'Content-Length': String(endExclusive - offset),",
    "youtube: real Content-Length instead of \"undefined\"",
)


# --------------------------------------------------------- tiktok / facebook

edit(
    "src/social.js",
    "    const bytes = fs.createReadStream(file);",
    "    const bytes = publishReadStream(file, {}, target.provider || '');",
    "tiktok/facebook: crash-safe upload stream",
)


print("patch13 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
