#!/usr/bin/env python3
"""
Fix the recurring "clean source preview could not be loaded" editor error.

WHAT WAS ACTUALLY HAPPENING
----------------------------
The editor's <video> elements point at /api/clips/:id/source-preview — a
clean, caption-free copy of the source, kept so re-editing captions doesn't
compound on top of a previous render. For clips whose only surviving media
is the already-captioned render (the common case after a YouTube import,
where the raw download is discarded once processing finishes), that route
correctly 404s: there genuinely is no clean source left.

The client's video.onerror handler (bindVideo() in activity-fix.js) reacted
to that 404 by setting a flag and showing a toast — but never actually gave
the <video> elements a working src. Both #dcEditorVideoBg and #dcEditorVideo
were left pointing at the dead URL forever, so the canvas stayed blank: no
frame to preview, drag, or frame against. The toast's own text ("your
rendered clip is still safe") was true but misleading, since the editor
itself was left with nothing playable. That's why it kept recurring — every
visit to that clip's editor hit the same dead end.

THE FIX
-------
On that same error, swap both video elements over to the clip's own
rendered export (/api/clips/:id/video — already served by the app) and
reload them. The editor becomes usable again immediately: you can preview,
scrub and re-frame the clip. The only real limitation is that the preview
now shows baked-in captions instead of a clean plate, so the toast is
reworded to say exactly that instead of implying nothing changed.

Run from your repo root:

    python3 patch16/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "public" / "activity-fix.js").exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:300]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


edit(
    "src/public/activity-fix.js",
    "  video.onerror=()=>{\n"
    "    if(editor.sourceFallback)return;\n"
    "    editor.sourceFallback=true;video.pause();if(bg)bg.pause();\n"
    "    const status=$('#dcCaptionStatus');if(status)status.textContent='Clean source preview unavailable — rendered export preserved';\n"
    "    notify('The clean source preview could not be loaded. Your rendered clip is still safe, but it is not used in the editor because it already contains captions.','bad');\n"
    "  };",
    "  video.onerror=()=>{\n"
    "    if(editor.sourceFallback)return;\n"
    "    editor.sourceFallback=true;video.pause();if(bg)bg.pause();\n"
    "    // No clean plate survived for this clip (common after a YouTube import,\n"
    "    // where the raw download is discarded once processing finishes). Fall\n"
    "    // back to the clip's own rendered export so the editor still has a\n"
    "    // playable frame to preview and re-frame against, instead of a dead\n"
    "    // <video> src that silently breaks the whole canvas.\n"
    "    const fallbackUrl=authedUrl(`/api/clips/${encodeURIComponent(clip.id)}/video`);\n"
    "    video.onerror=null;video.src=fallbackUrl;video.load();\n"
    "    if(bg){bg.onerror=null;bg.src=fallbackUrl;bg.load();}\n"
    "    const status=$('#dcCaptionStatus');if(status)status.textContent='Showing the rendered export — clean source unavailable';\n"
    "    notify('A clean, caption-free source is not available for this clip, so the editor is showing your rendered export instead. Captions will appear baked into the preview, but your edits still apply correctly when you export.','bad');\n"
    "  };",
    "editor: fall back to the rendered export instead of leaving the canvas blank",
)

print("patch16 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
