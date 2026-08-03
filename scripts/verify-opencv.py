#!/usr/bin/env python3
"""Verify OpenCV is genuinely usable for face detection.

`import cv2` succeeding is not enough. OpenCV's loader can leave a partial
module behind when its native bindings fail to load — the module imports
fine but has no CascadeClassifier, so smart framing fails at runtime with
an AttributeError rather than at install time.

Exits non-zero with a readable reason when OpenCV cannot do the job, so a
broken install fails the build instead of shipping quietly.

Run manually to diagnose:  python3 scripts/verify-opencv.py
"""
import os
import sys

REQUIRED = ("CascadeClassifier", "VideoCapture", "cvtColor")

try:
    import cv2
except Exception as error:
    sys.exit(f"OpenCV could not be imported at all: {error}")

missing = [name for name in REQUIRED if not hasattr(cv2, name)]
if missing:
    sys.exit(
        "OpenCV is installed but incomplete, missing: "
        + ", ".join(missing)
        + ". Its native bindings did not load, so face detection would fail at runtime."
    )

haarcascades = getattr(getattr(cv2, "data", None), "haarcascades", "")
if not haarcascades or not os.path.isdir(haarcascades):
    sys.exit(f"OpenCV is missing its Haar cascade data files at {haarcascades!r}.")

# Loading a real cascade is the only way to be certain detection will work.
cascade_file = os.path.join(haarcascades, "haarcascade_frontalface_alt2.xml")
if not os.path.isfile(cascade_file):
    sys.exit(f"The frontal-face cascade is missing from {haarcascades!r}.")
if cv2.CascadeClassifier(cascade_file).empty():
    sys.exit("The frontal-face cascade is present but could not be loaded.")

print(f"OpenCV {cv2.__version__} verified, face detection available")
