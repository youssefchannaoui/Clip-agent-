#!/usr/bin/env python3
"""
Fix the YouTube upload progress bar being stuck at 0% until it posts.

WHY IT WAS STUCK
-----------------
YouTube uploads go in 8 MB chunks (src/social.js). The percentage shown to
the user is only updated in two places: right before a chunk starts, and
after a chunk is confirmed by YouTube (a 308 response, or the final 200).

Most rendered clips are well under 8 MB, or only a few chunks. That means
the whole file goes out in one (or a couple of) fetch() calls, and nothing
updates `providerState.offset` while a chunk is actually in flight — the UI
polls every ~1s and sees 0% for the entire multi-second upload, then jumps
straight to "posted" the instant the last chunk is acknowledged. It was
never actually stuck; it just never reported partial progress within a
chunk.

FIX
---
`publishReadStream()` now takes an optional `onProgress(bytesSentInChunk)`
callback and wires it to the stream's own 'data' event, throttled to once
every 400ms so it doesn't spam saves. `uploadYouTube()` uses it to report
`confirmedOffset + bytesSentInThisChunk` — a real, live number — instead of
a value that only moves at chunk boundaries.

This is optimistic: if the chunk ultimately fails, the existing retry path
already re-queries YouTube for the real confirmed offset (youtubeUploadStatus)
before continuing, so a failed in-flight estimate self-corrects and can never
report a video as further along than YouTube has actually confirmed.

TikTok/Facebook are untouched — they upload chunks as buffers, not streams,
so a slower fix belongs in a separate pass if it turns out to matter there
too.

Run from your repo root:

    python3 patch14/apply.py
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


# ---------------------------------------------------------- the helper itself

edit(
    "src/social.js",
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
    "function publishReadStream(file, options = {}, provider = '', onProgress) {\n"
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
    "  if (onProgress) {\n"
    "    // Without this, the UI only learns about progress at chunk boundaries.\n"
    "    // Most clips are one or two chunks, so the bar sat at 0% for the whole\n"
    "    // upload and then jumped to done. Throttled so we're not calling save()\n"
    "    // on every TCP packet.\n"
    "    let sent = 0;\n"
    "    let lastReport = 0;\n"
    "    stream.on('data', chunk => {\n"
    "      sent += chunk.length;\n"
    "      const now = Date.now();\n"
    "      if (now - lastReport >= 400) {\n"
    "        lastReport = now;\n"
    "        onProgress(sent);\n"
    "      }\n"
    "    });\n"
    "  }\n"
    "  return stream;\n"
    "}",
    "publishReadStream() gains a throttled progress callback",
)


# --------------------------------------------- youtube: report in-flight bytes

edit(
    "src/social.js",
    "    const body = publishReadStream(file, { start: offset, end: endExclusive - 1 }, 'youtube');",
    "    const chunkStart = offset;\n"
    "    const body = publishReadStream(file, { start: offset, end: endExclusive - 1 }, 'youtube', sentInChunk => {\n"
    "      // Optimistic: reports bytes actually written to the socket for this\n"
    "      // chunk. If the chunk fails, the catch block below re-queries YouTube\n"
    "      // for the real confirmed offset before continuing, so this can never\n"
    "      // leave a wrong number behind.\n"
    "      target.providerState = { ...target.providerState, stage: 'uploading', totalSize: stat.size, offset: chunkStart + sentInChunk };\n"
    "      save();\n"
    "    });",
    "youtube: wire live progress into the chunk upload",
)

print("patch14 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
