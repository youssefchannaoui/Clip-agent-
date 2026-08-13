#!/usr/bin/env python3
"""
Remove Quality Center.

The screen is gone at the user's request. Views are generated from the NAV
arrays, so dropping the entry removes the sidebar item and the #view-quality
panel together; the render functions and CSS are deleted so nothing is left
behind to rot.

Deliberately NOT removed: the `qualityCenter` entitlement flag in
src/billing.js. It is part of the plan feature matrix the server and the
pricing tests assert on, and ripping it out to tidy up a deleted screen
would be a billing change disguised as a UI change.

Run from your repo root:

    python3 patch23/apply.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path.cwd()
JS = ROOT / "src/public/activity-fix.js"
CSS = ROOT / "src/public/studio-v6.css"
if not JS.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label, required=True):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old) if new else text.count(old)
    if old not in text:
        skipped.append(f"{label} (already applied)")
        return
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ------------------------------------------------------------------ nav item
edit(
    "src/public/activity-fix.js",
    "['lab','AI Director','lab','PRO'], ['quality','Quality Center','quality'],",
    "['lab','AI Director','lab','PRO'],",
    "nav: drop the Quality Center entry",
)

# ------------------------------------------------------------- view dispatch
edit(
    "src/public/activity-fix.js",
    "    if (view === 'quality') renderQualityCenter();\n",
    "",
    "router: drop the quality view dispatch",
)
edit(
    "src/public/activity-fix.js",
    "if(currentView==='quality')renderQualityCenter();",
    "",
    "renderCurrent: drop the quality branch",
)
edit(
    "src/public/activity-fix.js",
    "    brand:['Brand Kit','Watermark, colours and visual identity'], lab:['AI Director','Growth strategy and explainable clip intelligence'], quality:['Quality Center','Caption, framing, render and publishing preflight'],",
    "    brand:['Brand Kit','Watermark, colours and visual identity'], lab:['AI Director','Growth strategy and explainable clip intelligence'],",
    "topbar: drop the quality title/subtitle",
)

# --------------------------------------------------------- the render code
js = JS.read_text()
START = "function qualityAssessment(clip){"
if START in js:
    start = js.index(START)
    end = js.index("function renderTemplatesPage(){", start)
    block = js[start:end]
    for expected in ("renderQualityCenter", "qualityClipRow", "qualityPrimaryIssue"):
        if expected not in block:
            sys.exit(f"Sliced Quality Center block is missing {expected} — aborting rather than guessing.")
    JS.write_text(js[:start] + js[end:])
    changed.append("delete qualityAssessment / qualityPrimaryIssue / qualityClipRow / renderQualityCenter")
elif "function renderQualityCenter(){" not in js:
    skipped.append("Quality Center render code (already removed)")
else:
    sys.exit("Found renderQualityCenter but not the expected block start. Nothing written.")

# Upgrade copy that pointed at the screen.
edit(
    "src/public/activity-fix.js",
    "exp.premium?'Open Quality Center':'See what Premium unlocks'",
    "exp.premium?'Open Clip Styles':'See what Premium unlocks'",
    "home: retarget the Quality Center suggestion",
)

# -------------------------------------------------------------------- CSS
css = CSS.read_text()
if "body.dc-app #view-quality" in css:
    start = css.index("/* Quality Center reuses the Settings")
    end = css.index("/* AI Director", start)
    CSS.write_text(css[:start] + css[end:])
    changed.append("CSS: delete the Quality Center block")
    css = CSS.read_text()
    css = css.replace("body.dc-app #view-quality { --page-accent:var(--v6-green);--page-soft:rgba(104,213,157,.11); }\n", "")
    CSS.write_text(css)
else:
    skipped.append("CSS: Quality Center block (already removed)")

# The empty-state class is shared with other screens, so keep it alive.
css = CSS.read_text()
if ".dc-qc-empty" not in css:
    CSS.write_text(css.replace(
        "/* AI Director",
        "body.dc-app .dc-qc-empty { margin:18px 20px;padding:26px;text-align:center;color:var(--v6-muted);border:1px dashed rgba(255,255,255,.08);border-radius:15px;font-size:9.5px; }\n"
        "body.dc-app .dc-qc-empty svg { width:17px;height:17px;fill:none;stroke:currentColor;vertical-align:-3px;margin-right:6px;color:var(--v6-green); }\n\n"
        "/* AI Director",
        1,
    ))
    changed.append("CSS: keep .dc-qc-empty, still used by Clip Styles and AI Director")

js = JS.read_text()
for gone in ("renderQualityCenter", "qualityClipRow", "qualityPrimaryIssue", "qualityAssessment", "'Quality Center'"):
    if gone in js:
        sys.exit(f"'{gone}' is still referenced in activity-fix.js — removal incomplete.")

names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch23 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNo Quality Center references remain.")
print("\nAlso delete its tests:\n  rm test/quality-center-render.test.mjs\n")
