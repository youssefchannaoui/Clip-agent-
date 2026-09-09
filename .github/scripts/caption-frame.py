"""Render one caption line on the box and measure it.

CLAUDE.md's oldest rule: only a rendered frame settles a caption question, and
"the arithmetic in the AYAH_SIZE_SCALE comment block is DISPROVED -- by two
separate frames now -- and must not be trusted over a render." Until now the
only rigs for that were a throwaway container or a whole clip re-rendered
through the app. This is the box itself -- the machine that ships every clip,
with its own libass, its own fontconfig and its own bundled faces.

WHAT IT ANSWERS. libass sizes text by the face's win ascent+descent rather than
its em, so two faces at the same nominal size do NOT render the same size on
screen: Amiri reserves roughly three times its em for tashkeel it may never
draw. An Arabic word dropped into a Latin caption line therefore comes out a
fraction of the height of the English words beside it -- and mixed_script_line
has been drawing exactly that, unmeasured, since it was written. This reports
the ink height of each face at one nominal size, which is the multiplier.

WHAT LEAVES THE BOX. Geometry, and PNGs of TEXT THIS FILE WROTE -- no customer
transcript, no cached source, no frame from anybody's lecture. The sample line
is a hand-written sentence a few lines below.
"""
from __future__ import annotations

import base64
import importlib.util
import os
import subprocess
import sys
import tempfile

PARAMS = {}

WIDTH = int(PARAMS.get("width") or 1080)
HEIGHT = int(PARAMS.get("height") or 1920)
FONT_SIZE = int(PARAMS.get("fontSize") or 62)
SCALES = PARAMS.get("scales") or [1.0, 3.0, 3.5, 4.0, 4.25, 4.5, 5.0]

# Ours, written here, so nothing of anybody's lecture is in the picture.
SAMPLE_LATIN = "MERCY"
SAMPLE_ARABIC = "الحمد لله"
SAMPLE_LINE = "He said الحمد لله and carried on"
# What Whisper writes when the speaker drops one Arabic word into an English
# sentence: the segment is English, so the word comes out transliterated.
SAMPLE_TRANSLIT = "He said alhamdulillah and carried on"


def out(line: str = "") -> None:
    sys.stdout.write(line + "\n")
    sys.stdout.flush()


def load_worker():
    path = "/app/worker/clip_worker.py"
    spec = importlib.util.spec_from_file_location("clip_worker", path)
    module = importlib.util.module_from_spec(spec)
    # A module holding a @dataclass cannot be exec'd unless it is in
    # sys.modules first -- CLAUDE.md records this one.
    sys.modules["clip_worker"] = module
    spec.loader.exec_module(module)
    return module


def families() -> list[str]:
    try:
        listed = subprocess.run(["fc-list", ":", "family"], capture_output=True,
                                text=True, timeout=20).stdout
    except Exception:
        return []
    seen = set()
    for row in listed.splitlines():
        for name in row.split(","):
            if name.strip():
                seen.add(name.strip())
    return sorted(seen)


def ass_file(path: str, body: str, *, font: str, size: int) -> None:
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,{font},{size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
{body}
"""
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(header)


def render(ass_path: str, png_path: str) -> bool:
    cmd = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=black:s={WIDTH}x{HEIGHT}:d=1",
        "-vf", f"subtitles={ass_path}", "-frames:v", "1", png_path,
    ]
    try:
        done = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    except Exception as exc:  # pragma: no cover - probe
        out(f"  ffmpeg failed: {exc}")
        return False
    if done.returncode != 0:
        out(f"  ffmpeg exit {done.returncode}: {(done.stderr or '').strip()[:300]}")
        return False
    return os.path.exists(png_path)


def gray_rows(png_path: str) -> tuple[list[int], int]:
    """Every lit row of the frame, as a list of y, plus the frame width."""
    raw = os.path.join(tempfile.gettempdir(), "dc-frame.gray")
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", png_path,
           "-pix_fmt", "gray", "-f", "rawvideo", raw]
    subprocess.run(cmd, capture_output=True, timeout=120, check=True)
    data = open(raw, "rb").read()
    os.unlink(raw)
    rows: list[int] = []
    for y in range(HEIGHT):
        line = data[y * WIDTH:(y + 1) * WIDTH]
        # The caption band's black is Y=16 in limited range; 254 is the pure
        # white ink. CLAUDE.md records both numbers.
        if any(value >= 200 for value in line):
            rows.append(y)
    return rows, WIDTH


def ink_height(png_path: str) -> tuple[int, int, int]:
    rows, _ = gray_rows(png_path)
    if not rows:
        return 0, 0, 0
    return rows[-1] - rows[0] + 1, rows[0], rows[-1]


def crop_band(png_path: str, dest: str, top: int, bottom: int) -> bool:
    pad = 60
    y0 = max(0, top - pad)
    height = min(HEIGHT - y0, (bottom - top + 1) + pad * 2)
    cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", png_path,
           "-vf", f"crop={WIDTH}:{height}:0:{y0}", dest]
    try:
        subprocess.run(cmd, capture_output=True, timeout=120, check=True)
    except Exception:
        return False
    return os.path.exists(dest)


def emit_png(name: str, path: str) -> None:
    try:
        blob = base64.b64encode(open(path, "rb").read()).decode("ascii")
    except Exception as exc:
        out(f"  could not read {name}: {exc}")
        return
    out(f"@@PNG {name} {len(blob)}")
    for index in range(0, len(blob), 4000):
        out(blob[index:index + 4000])
    out("@@ENDPNG")


def main() -> int:
    cw = load_worker()
    latin = cw.safe_font("Outfit", "Outfit")
    arabic = cw.safe_font("Amiri", "Amiri")
    installed = families()
    out("== the faces this box actually has ==")
    out(f"  caption face {latin}: {'installed' if latin in installed else 'NOT INSTALLED'}")
    out(f"  arabic face  {arabic}: {'installed' if arabic in installed else 'NOT INSTALLED'}")
    out(f"  arabic families present: {[f for f in installed if any(w in f for w in ('Amiri', 'Uthmanic', 'Scheherazade', 'Noto Naskh'))]}")
    out("")

    work = tempfile.mkdtemp(prefix="dc-caption-")

    out(f"== ink height at one nominal size ({FONT_SIZE}) ==")
    heights: dict[str, int] = {}
    for label, text, face in (("latin", SAMPLE_LATIN, latin), ("arabic", SAMPLE_ARABIC, arabic)):
        ass = os.path.join(work, f"{label}.ass")
        png = os.path.join(work, f"{label}.png")
        ass_file(ass, f"Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{text}",
                 font=face, size=FONT_SIZE)
        if not render(ass, png):
            out(f"  {label}: render failed")
            continue
        tall, top, bottom = ink_height(png)
        heights[label] = tall
        out(f"  {label:6s} {face:10s} ink {tall:3d}px  (y {top}..{bottom})")

    if heights.get("latin") and heights.get("arabic"):
        ratio = heights["latin"] / heights["arabic"]
        out("")
        out(f"  ARABIC INLINE SCALE = {ratio:.2f}   "
            f"(latin {heights['latin']}px / arabic {heights['arabic']}px at the same nominal size)")
        out("  -- the multiplier that makes an Arabic word the same height as the")
        out("     English words beside it in one caption line.")
    out("")

    out("== is the shipped multiplier equal? ==")
    # The ratio is what Youssef asked for in as many words -- "make sure sizing
    # of Arabic and English ratio is similar" -- so it is MEASURED at the value
    # that actually ships rather than inferred from the linear one above.
    if hasattr(cw, "arabic_inline_size") and heights.get("latin"):
        want = cw.arabic_inline_size(FONT_SIZE)
        ass = os.path.join(work, "shipped.ass")
        png = os.path.join(work, "shipped.png")
        ass_file(ass, f"Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{SAMPLE_ARABIC}",
                 font=arabic, size=want)
        if render(ass, png):
            tall, top, bottom = ink_height(png)
            latin = heights["latin"]
            out(f"  arabic at the shipped nominal {want}: {tall}px against the Latin's {latin}px")
            out(f"  RATIO {tall / latin:.2f}  (1.00 is equal)")
            if latin:
                out(f"  the multiplier that would make it exactly equal: "
                    f"{cw.ARABIC_INLINE_SCALE * latin / max(1, tall):.2f}")
    out("")

    out("== the mixed line, through the REAL renderer, at each multiplier ==")
    # The scale is set on the module and mixed_script_line is CALLED, rather
    # than the tag being patched into its output: the first cut of this probe
    # did the latter, and what it rendered was the size leaking onto every word
    # AFTER the Arabic -- a bug in the probe's own patching, not the renderer's.
    shipped = getattr(cw, "ARABIC_INLINE_SCALE", None)
    has_size = "arabic_size" in cw.mixed_script_line.__code__.co_varnames
    out(f"  shipped ARABIC_INLINE_SCALE = {shipped}  (renderer takes a size: {has_size})")
    for scale in SCALES:
        if has_size:
            cw.ARABIC_INLINE_SCALE = float(scale)
            size = cw.arabic_inline_size(FONT_SIZE)
            line = cw.mixed_script_line(SAMPLE_LINE, font=latin, arabic_font=arabic,
                                        uppercase=False, arabic_size=size,
                                        latin_size=FONT_SIZE)
        else:
            size = int(round(FONT_SIZE * float(scale)))
            line = cw.mixed_script_line(SAMPLE_LINE, font=latin, arabic_font=arabic,
                                        uppercase=False)
            line = line.replace(f"{{\\fn{arabic}\\i0}}", f"{{\\fn{arabic}\\fs{size}\\i0}}")
        ass = os.path.join(work, f"mixed-{scale}.ass")
        png = os.path.join(work, f"mixed-{scale}.png")
        ass_file(ass, f"Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{{\\q0}}{line}",
                 font=latin, size=FONT_SIZE)
        if not render(ass, png):
            continue
        tall, top, bottom = ink_height(png)
        out(f"  x{scale:<4} arabic nominal {size:3d}  line ink {tall:3d}px (y {top}..{bottom})")
        band = os.path.join(work, f"band-{scale}.png")
        if crop_band(png, band, top, bottom):
            emit_png(f"mixed-x{scale}.png", band)
    if shipped is not None:
        cw.ARABIC_INLINE_SCALE = shipped
    out("")

    out("== a transliterated word, drawn as the box would draw it ==")
    if has_size:
        size = cw.arabic_inline_size(FONT_SIZE)
        line = cw.mixed_script_line(SAMPLE_TRANSLIT, font=latin, arabic_font=arabic,
                                    uppercase=False, arabic_size=size,
                                    latin_size=FONT_SIZE)
        ass = os.path.join(work, "translit.ass")
        png = os.path.join(work, "translit.png")
        ass_file(ass, f"Dialogue: 0,0:00:00.00,0:00:02.00,Caption,,0,0,0,,{{\\q0}}{line}",
                 font=latin, size=FONT_SIZE)
        if render(ass, png):
            tall, top, bottom = ink_height(png)
            out(f"  in:  {SAMPLE_TRANSLIT}")
            out(f"  line ink {tall}px (y {top}..{bottom})")
            band = os.path.join(work, "band-translit.png")
            if crop_band(png, band, top, bottom):
                emit_png("transliterated.png", band)
    else:
        out("  the box is on a build with no inline Arabic size; nothing to show")
    out("")
    out("== done ==")
    return 0


if __name__ == "__main__":
    sys.exit(main())
