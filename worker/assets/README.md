# Render assets

Binary artwork the renderer composites into a clip. Everything here is
OPTIONAL at runtime: a missing file makes the feature that uses it inert
rather than failing a render.

## promo-bar.png

The brand call-out that slides in over a clip, holds, and leaves — switched on
per template under **Templates → Promo bar**.

Requirements:

- **PNG with transparency.** It is composited with `format=rgba`; a JPEG or a
  flattened PNG renders as a black slab across the video.
- **Wide and short**, around 8:1. It is scaled to 86% of the frame width and
  centred, so its own height decides how much of the frame it covers.
- **At least 1600px wide**, so it stays crisp on a 1080-wide final.

Drop the file in beside this README as `promo-bar.png`. Nothing else is
needed — the worker picks it up on its next deploy.

## Nothing here is needed for the atmosphere

Rain, snow, dust and bokeh (**Templates → Style → Atmosphere**) are GENERATED
by the renderer from a deterministic noise field — `ATMOSPHERES` and
`atmosphere_chain` in `clip_worker.py`. There is no `rain.png` to look for and
none to keep in step with a deploy, which is why they were built that way.
