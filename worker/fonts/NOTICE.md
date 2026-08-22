# Bundled caption fonts

- `UthmanicHafs.ttf` — KFGQPC HAFS Uthmanic Script v2.1, © King Fahd Glorious
  Quran Printing Complex. Distributed free of charge by the Complex for
  rendering the Quranic text; not to be sold. This is the mushaf face most
  Quran apps use, and its U+06DD glyph is the ornamented verse medallion.
- `Outfit-Regular.ttf`, `Outfit-Bold.ttf` — Outfit, © The Outfit Project
  Authors, SIL Open Font License 1.1. Same face the dashboard UI uses, so
  the translation line matches the product.
- `Montserrat-ExtraBold.ttf` — Montserrat, © The Montserrat Project Authors,
  SIL Open Font License 1.1. Instanced to weight 800 from the upstream
  variable font so libass gets a real ExtraBold rather than a synthetic one,
  and named as its own family ("Montserrat ExtraBold") so asking for it cannot
  land on Regular. The stacked-build lecture template is set in it.
- `Montserrat-Bold.ttf` — the same family at weight 700, named the ordinary way
  (family "Montserrat", style "Bold") so an ASS style asking for Montserrat in
  bold resolves to it. The default template's single caption line is set in it.

Installed into the image by the Dockerfile; the web app serves its own copy
of the HAFS face from src/public/fonts so previews draw the same glyphs.
