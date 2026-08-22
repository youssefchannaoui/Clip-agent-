"""A per-frame matte of the speaker, so captions can be drawn behind them.

The lecture templates that stack captions behind the speaker need to know, for
every frame, which pixels are the person. MediaPipe's selfie segmenter answers
that in a few milliseconds a frame on the box's CPU, which is what makes the
effect affordable at all -- a matting network would be minutes per clip.

Everything here fails soft. If the model is missing, the import fails, or a
frame cannot be segmented, write_matte() returns None and the caller draws the
captions in front, which is the look every template had before this existed.
Why it failed is left in LAST_ERROR rather than thrown away, because a silent
fallback that nobody can explain is worse than no fallback.
"""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

# The matte is computed small and scaled back up by ffmpeg. The model's own
# input is 256x256, so segmenting at full 1080p buys nothing but decode time,
# and the soft edge an upscale leaves is closer to the reference than a hard
# one would be.
SEGMENT_WIDTH = 512

# The matte is generated and consumed at this rate, and the render already
# outputs 30fps, so the alpha and the picture stay frame-aligned.
MATTE_FPS = 30

# How much of the previous frame's matte carries into this one. The segmenter
# has no temporal term, so the silhouette shimmers around hair and shoulders;
# carrying part of the last frame forward settles it without smearing ordinary
# movement.
SMOOTHING = 0.45

# Vendored beside this module rather than downloaded at run time: a render must
# not depend on Google's CDN being reachable, and 250KB is nothing. Apache-2.0,
# see models/NOTICE.md.
MODEL = Path(__file__).resolve().parent / "models" / "selfie_segmenter.tflite"

LAST_ERROR: str = ""


def available() -> str | None:
    """None when a matte can be produced, otherwise why it cannot."""
    if not MODEL.exists():
        return f"segmentation model missing at {MODEL}"
    try:
        import mediapipe  # noqa: F401
        from mediapipe.tasks.python import vision  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"mediapipe unavailable ({error.__class__.__name__}: {error})"
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"opencv/numpy unavailable ({error.__class__.__name__})"
    return None


def _person_mask(result: Any) -> Any:
    """The confidence mask that is the person, not the background.

    The selfie segmenter reports two categories, background first and person
    second; older bundles of the same model report a single foreground mask.
    Both shapes are handled because which one you get depends on the bundle,
    not on anything this worker controls.
    """
    masks = getattr(result, "confidence_masks", None) or []
    if not masks:
        return None
    return masks[-1].numpy_view()


def write_matte(
    *, ffmpeg: str, source: Path, destination: Path, start: float, duration: float,
    width: int, height: int,
) -> Path | None:
    """Segment the clip's window and write a greyscale matte video.

    White is the speaker, black is everything else. The result is at
    SEGMENT_WIDTH and MATTE_FPS; the render's filter graph scales it back to
    the source's own size before applying the same crop the picture gets, so
    the alpha lands exactly on the person.
    """
    global LAST_ERROR
    LAST_ERROR = ""
    reason = available()
    if reason or width <= 0 or height <= 0:
        LAST_ERROR = reason or "source has no dimensions"
        return None
    import cv2
    import numpy as np
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    segment_height = max(2, int(round(SEGMENT_WIDTH * height / width / 2)) * 2)
    frame_bytes = SEGMENT_WIDTH * segment_height * 3

    decode = [
        ffmpeg, "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
        "-an", "-vf", f"fps={MATTE_FPS},scale={SEGMENT_WIDTH}:{segment_height}",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    encode = [
        ffmpeg, "-y", "-v", "error", "-nostdin",
        "-f", "rawvideo", "-pix_fmt", "gray",
        "-s", f"{SEGMENT_WIDTH}x{segment_height}", "-r", str(MATTE_FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18",
        "-pix_fmt", "yuv420p", str(destination),
    ]

    destination.parent.mkdir(parents=True, exist_ok=True)
    reader: subprocess.Popen[bytes] | None = None
    writer: subprocess.Popen[bytes] | None = None
    frames = 0
    try:
        options = vision.ImageSegmenterOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(MODEL)),
            running_mode=vision.RunningMode.VIDEO,
            output_confidence_masks=True,
            output_category_mask=False,
        )
        reader = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        writer = subprocess.Popen(encode, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert reader.stdout is not None and writer.stdin is not None
        carried: Any = None
        with vision.ImageSegmenter.create_from_options(options) as model:
            while True:
                raw = reader.stdout.read(frame_bytes)
                if len(raw) < frame_bytes:
                    break
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(segment_height, SEGMENT_WIDTH, 3).copy()
                stamp = int(round(frames * 1000 / MATTE_FPS))
                mask = _person_mask(model.segment_for_video(
                    mp.Image(image_format=mp.ImageFormat.SRGB, data=frame), stamp,
                ))
                if mask is None:
                    mask = np.zeros((segment_height, SEGMENT_WIDTH), dtype=np.float32)
                mask = np.clip(np.asarray(mask, dtype=np.float32), 0.0, 1.0)
                carried = mask if carried is None else (carried * SMOOTHING + mask * (1.0 - SMOOTHING))
                grey = cv2.GaussianBlur((carried * 255.0).astype(np.uint8), (5, 5), 0)
                writer.stdin.write(grey.tobytes())
                frames += 1
        writer.stdin.close()
        writer.wait(timeout=600)
        reader.wait(timeout=60)
    except Exception as error:
        LAST_ERROR = f"{error.__class__.__name__}: {error}"
        for process in (reader, writer):
            if process is not None and process.poll() is None:
                process.kill()
        return None
    finally:
        if reader is not None and reader.stdout is not None:
            reader.stdout.close()
    if frames == 0:
        LAST_ERROR = "no frames were segmented"
        return None
    if not destination.exists() or destination.stat().st_size == 0:
        LAST_ERROR = "the matte encoder wrote nothing"
        return None
    return destination
