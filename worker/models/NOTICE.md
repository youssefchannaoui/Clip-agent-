# Bundled models

- `selfie_segmenter.tflite` — MediaPipe Selfie Segmenter (float16), © Google
  LLC, Apache License 2.0. Separates a person from the background at 256x256.
  It is what draws the captions behind the speaker on the stacked-build
  lecture template.

Vendored rather than downloaded at run time: a render must not depend on a CDN
being reachable, and the file is 250KB. Newer MediaPipe releases removed the
legacy `mp.solutions` API, so this is loaded through the Tasks ImageSegmenter,
which needs the model file passed to it explicitly.
