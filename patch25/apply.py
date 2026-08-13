#!/usr/bin/env python3
"""
Remove the now-dead template preview modal.

openTemplatePreview() existed to show a style larger than the old thumbnail
grid allowed. The studio's stage is a large live preview of the template you
are editing, so nothing emits data-preview-template any more and the modal
is unreachable. Deleting it rather than leaving an orphan behind.

Run from your repo root:

    python3 patch25/apply.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path.cwd()
JS = ROOT / "src/public/activity-fix.js"
if not JS.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

changed = []
skipped = []

js = JS.read_text()

DELEGATE = "  const previewTemplate = event.target.closest('[data-preview-template]'); if (previewTemplate) { openTemplatePreview(previewTemplate.dataset.previewTemplate); return; }\n"
if DELEGATE in js:
    # Guard: only safe to remove because nothing renders the attribute.
    emitters = js.count("data-preview-template") - 1
    if emitters > 0:
        sys.exit(f"data-preview-template is still rendered in {emitters} place(s) — not removing the handler.")
    js = js.replace(DELEGATE, "")
    JS.write_text(js)
    changed.append("remove the data-preview-template delegation")
else:
    skipped.append("preview delegation (already removed)")

js = JS.read_text()
if "function openTemplatePreview(id){" in js:
    start = js.index("function openTemplatePreview(id){")
    end = js.index("\nfunction ", start + 10) + 1
    block = js[start:end]
    if "dcTemplatePreviewLayer" not in block:
        sys.exit("Sliced openTemplatePreview block looks wrong — aborting.")
    JS.write_text(js[:start] + js[end:])
    changed.append("delete openTemplatePreview()")
else:
    skipped.append("openTemplatePreview() (already removed)")

# Three callers still tried to close the layer. Harmless no-ops now, but dead.
js = JS.read_text()
for snippet, label in (
    ("$('#dcTemplatePreviewLayer')?.remove();", "inline close call"),
    ("$('#dcTemplatePreviewLayer')?.remove()", "escape-key close call"),
):
    if snippet in js:
        js = js.replace(snippet, "")
        changed.append(f"remove the dead {label}")
JS.write_text(js)

js = JS.read_text()
for gone in ("openTemplatePreview", "data-preview-template", "dcTemplatePreviewLayer"):
    if gone in js:
        sys.exit(f"'{gone}' is still referenced — removal incomplete.")

names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch25 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNext:\n  npm run check && npm test\n")
