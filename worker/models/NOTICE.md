# Bundled models

- `selfie_segmenter.tflite` — MediaPipe Selfie Segmenter (float16), © Google
  LLC, Apache License 2.0. Separates a person from the background at 256x256.
  It is what draws the captions behind the speaker on the stacked-build
  lecture template.

- `face_landmarker.task` — MediaPipe Face Landmarker (float16 bundle), © Google
  LLC, Apache License 2.0. 478 landmarks for up to four faces, detector and
  mesh in one bundle. It is what tells the framing WHO IS SPEAKING: landmarks
  13 and 14 are the inner lip centres, and the gap between them divided by the
  face's own height is a mouth opening and closing, at any distance from the
  camera. Correlated against the audio, that is which of the people on screen
  is making the sound. Downloaded from
  `storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/`
  on 9 September 2026; sha256
  `64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`.

Vendored rather than downloaded at run time: a render must not depend on a CDN
being reachable, and a render that quietly loses its framing because a request
timed out is exactly the kind of failure nothing anywhere reports. Newer
MediaPipe releases removed the legacy `mp.solutions` API, so both are loaded
through the Tasks API, which needs the model file passed to it explicitly.

`worker/Dockerfile` copies the whole of `worker/` into the image, so a model
added here needs no build change -- but `verify-deploy.sh` checks each one is
present in the running container, because a model that failed to copy fails
silently at the one moment nobody is watching.
