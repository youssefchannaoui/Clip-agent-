# Bundled caption fonts

- `UthmanicHafs.ttf` — KFGQPC HAFS Uthmanic Script v2.1, © King Fahd Glorious
  Quran Printing Complex. Distributed free of charge by the Complex for
  rendering the Quranic text; not to be sold. This is the mushaf face most
  Quran apps use, and its U+06DD glyph is the ornamented verse medallion.
- `Outfit-Regular.ttf`, `Outfit-Bold.ttf` — Outfit, © The Outfit Project
  Authors, SIL Open Font License 1.1. Same face the dashboard UI uses, so
  the translation line matches the product.

Installed into the image by the Dockerfile; the web app serves its own copy
of the HAFS face from src/public/fonts so previews draw the same glyphs.
