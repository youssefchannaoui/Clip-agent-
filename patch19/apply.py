#!/usr/bin/env python3
"""
Fix Quality Center rendering "[object Object] ... 0%" for every blocked clip.

THE BUG
-------
activity-fix.js ended up with TWO top-level declarations of `qualityRow`:

  line 3197  function qualityRow(item, isReady)        <- Quality Center (mine)
  line 3286  function qualityRow(label, value, total)   <- Insights bar row

Function declarations hoist, and when two share a name the LAST one wins for
the entire script. So every Quality Center call was silently running the
Insights bar renderer:

  qualityRow(item, false)
    -> label = the assessment object  -> esc(label)  -> "[object Object]"
    -> value = false, total = undefined
    -> pct = round(0 / max(1,1) * 100) -> 0          -> "0%"

which is exactly what shipped: sixteen "[object Object] ____ 0%" rows.

No error was thrown, `npm run check` passed (the file is syntactically
valid), and every test passed, because the tests asserted on source text
rather than on rendered output. A duplicate declaration is legal JavaScript.

THE FIX
-------
Rename the Quality Center one to `qualityClipRow`. The Insights function is
older, has other callers, and is the one whose name matches what it does, so
mine is the one that moves.

Also adds a guard test (test/no-duplicate-declarations.test.mjs) that fails
if any top-level function name in activity-fix.js is declared more than
once. That test fails against this bug and passes after the rename, so the
next accidental collision is caught before it reaches a browser.

Run from your repo root:

    python3 patch19/apply.py
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
    "function qualityRow(item,isReady){",
    "function qualityClipRow(item,isReady){",
    "rename the Quality Center row builder off the colliding name",
)

edit(
    "src/public/activity-fix.js",
    "${ready.length?ready.map(item=>qualityRow(item,true)).join('')",
    "${ready.length?ready.map(item=>qualityClipRow(item,true)).join('')",
    "call site: ready list",
)

edit(
    "src/public/activity-fix.js",
    "${blocked.length?blocked.map(item=>qualityRow(item,false)).join('')",
    "${blocked.length?blocked.map(item=>qualityClipRow(item,false)).join('')",
    "call site: blocked list",
)


# Verify the collision is actually gone rather than trusting the edits.
names = re.findall(r"^function ([A-Za-z0-9_]+)", JS.read_text(), re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations remain: {', '.join(dupes)}")

print("patch19 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNo duplicate top-level function declarations remain.")
print("\nNext:\n  npm run check && npm test\n")
