#!/usr/bin/env python3
"""
Fix: duration estimation never runs when the external worker is enabled.

sourceInfo() short-circuits on remoteProcessing() and returns durationSec:null
without attempting any lookup, so the token modal always falls back to "Duration
could not be verified" and asks for the length by hand.

The reason for that early return was that yt-dlp and ffprobe are not available
on the Render web service — but the YouTube Data API is just an HTTPS call and
works fine there. This tries the API (and the HTML fallback) before giving up,
and still degrades to manual entry when neither can answer.

Run from your repo root:

    python3 patch4/apply.py
"""
import pathlib, sys

ROOT = pathlib.Path.cwd()
path = ROOT / "src/local-engine.js"
if not path.exists():
    sys.exit("Can't find src/local-engine.js — run this from your repo root.")

text = path.read_text()

print("\nDuration estimation fix\n" + "=" * 24)

old = """  if (remoteProcessing()) {
    const parsed = parseYouTubeUrl(value);
    return { url: parsed.canonicalUrl, title: parsed.canonicalUrl, durationSec: null, durationKnown: false, thumbnail: fallbackThumb(parsed.canonicalUrl), extractor: 'validated-only' };
  }"""

new = """  if (remoteProcessing()) {
    const parsed = parseYouTubeUrl(value);
    // yt-dlp and ffprobe do not exist on the web service, but the YouTube Data
    // API and the public watch page are ordinary HTTPS calls that work here.
    // Trying them means the token estimate is based on the real length instead
    // of forcing the person to type it in by hand every single time.
    try {
      const apiInfo = await sourceInfoViaYouTubeDataApi(value);
      if (apiInfo?.durationSec) return { ...apiInfo, durationKnown: true, extractor: 'youtube-data-api' };
    } catch { /* fall through to the HTML page */ }
    try {
      const htmlInfo = await sourceInfoViaYouTubeHtml(value);
      if (htmlInfo?.durationSec) return { ...htmlInfo, durationKnown: true, extractor: 'youtube-html' };
    } catch { /* fall through to manual entry */ }
    return {
      url: parsed.canonicalUrl, title: parsed.canonicalUrl, durationSec: null, durationKnown: false,
      thumbnail: fallbackThumb(parsed.canonicalUrl), extractor: 'validated-only',
      warning: config.youtubeDataApiKey
        ? 'Could not read the duration from YouTube; enter it manually.'
        : 'Set YOUTUBE_DATA_API_KEY for reliable duration lookup.',
    };
  }"""

if "youtube-data-api'" in text and "remoteProcessing()" in text and "fall through to the HTML page" in text:
    print("  · already applied")
elif old not in text:
    sys.exit("  ERROR: could not find the remoteProcessing() block in sourceInfo().\n"
             "  The file may have changed since this patch was generated.")
else:
    text = text.replace(old, new, 1)
    path.write_text(text)
    print("  ✓ duration lookup now runs in remote-worker mode")

print("""
Then:

  node --check src/local-engine.js
  git add -A && git commit -m "Look up source duration when using the remote worker"
  git push

IMPORTANT — this needs YOUTUBE_DATA_API_KEY set in Render to be reliable.
Without it the code falls back to scraping the YouTube watch page, which works
but breaks whenever YouTube changes their HTML.

  Google Cloud Console -> APIs & Services -> Credentials -> Create API key
  Restrict it to "YouTube Data API v3"
  Render -> Environment -> YOUTUBE_DATA_API_KEY

You already have a Google Cloud project for the OAuth work, so this is the same
project, just an API key rather than an OAuth client.
""")
