"""A per-frame matte of the speaker, so captions can be drawn behind them.

The lecture templates that stack captions behind the speaker need to know, for
every frame, which pixels are the person. MediaPipe's selfie segmentation model
answers that in about 15ms a frame on the box's CPU, which is what makes the
effect affordable at all -- a matting network would be minutes per clip.

Everything here fails soft. If the model is missing, the import fails, or a
frame cannot be segmented, write_matte() returns None and the caller draws the
captions in front, which is the look every template had before this existed.
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

# How much of the previous frame's matte carries into this one. Selfie
# segmentation is computed per frame with no temporal term, so the silhouette
# shimmers around hair and shoulders; carrying part of the last frame forward
# settles it without smearing ordinary movement.
SMOOTHING = 0.45


def available() -> str | None:
    """None when a matte can be produced, otherwise why it cannot."""
    try:
        import mediapipe  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"mediapipe unavailable ({error.__class__.__name__})"
    try:
        import cv2  # noqa: F401
        import numpy  # noqa: F401
    except Exception as error:  # pragma: no cover - environment dependent
        return f"opencv/numpy unavailable ({error.__class__.__name__})"
    return None


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
    if available() is not None or width <= 0 or height <= 0:
        return None
    import cv2
    import numpy as np
    import mediapipe as mp

    segment_height = max(2, int(round(SEGMENT_WIDTH * height / width / 2)) * 2)
    frame_bytes = SEGMENT_WIDTH * segment_height * 3

    decode = [
        ffmpeg, "-v", "error", "-nostdin",
        "-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", str(source),
        "-an", "-vf", f"fps={MATTE_FPS},scale={SEGMENT_WIDTH}:{segment_height}",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
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
        reader = subprocess.Popen(decode, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        writer = subprocess.Popen(encode, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
        assert reader.stdout is not None and writer.stdin is not None
        blur = (5, 5)
        carried: Any = None
        with mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=1) as model:
            while True:
                raw = reader.stdout.read(frame_bytes)
                if len(raw) < frame_bytes:
                    break
                frame = np.frombuffer(raw, dtype=np.uint8).reshape(segment_height, SEGMENT_WIDTH, 3)
                result = model.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                mask = getattr(result, "segmentation_mask", None)
                if mask is None:
                    mask = np.zeros((segment_height, SEGMENT_WIDTH), dtype=np.float32)
                mask = np.clip(mask.astype(np.float32), 0.0, 1.0)
                carried = mask if carried is None else (carried * SMOOTHING + mask * (1.0 - SMOOTHING))
                grey = cv2.GaussianBlur((carried * 255.0).astype(np.uint8), blur, 0)
                writer.stdin.write(grey.tobytes())
                frames += 1
        writer.stdin.close()
        writer.wait(timeout=600)
        reader.wait(timeout=60)
    except Exception:
        for process in (reader, writer):
            if process is not None and process.poll() is None:
                process.kill()
        return None
    finally:
        if reader is not None and reader.stdout is not None:
            reader.stdout.close()
    if frames == 0 or not destination.exists() or destination.stat().st_size == 0:
        return None
    return destination
