# Changelog

## 2.4.0 — Exact classic interface integration

- Rebuilt the dashboard directly from the uploaded original `index(4).html` instead of approximating its styling.
- Preserved the original splash, logo, fonts, spacing, tabs, queue cards, 9:16 thumbnails, lecture library, schedule board, analytics, music page, side rail, animations and responsive rules.
- Added Templates, Publishing and Automation as matching classic-style tabs.
- Wired local AI clips and generated JPEG thumbnails into the original queue, library, schedule, analytics and next-post layouts.
- Kept mandatory nasheed mixing, template locking, re-rendering, OAuth publishing, retries and quality-gated automation.
- Added Docker build-time verification for `yt_dlp` and `faster_whisper`.
- Updated deployment guidance to require a Docker Blueprint rather than the legacy native Node service.

## 2.3.0 — Premium interface restoration

- Restored the original DeenClipped visual system around the self-hosted backend.
- Added a Docker build-time dependency check.

## 2.2.0 — Automatic publishing reliability

- Added YouTube, Instagram, Facebook and TikTok publishing adapters.
- Added OAuth, encrypted tokens, upload recovery, status polling and per-platform retries.
