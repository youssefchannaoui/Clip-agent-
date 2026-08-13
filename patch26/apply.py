#!/usr/bin/env python3
"""
Remove the last Quality Center reference: a dead nav button on the home card.

patch23's final guard looked for the quoted string "'Quality Center'" (as it
appears in the NAV array) and so walked straight past this one, which is
plain text inside a template literal. The result was a button on the home
screen wired to data-dc-nav="quality" — a view that no longer exists, so
clicking it would have navigated to nothing.

Caught by the removal test asserting the whole file is free of the name,
which is the right shape for a guard: assert the absence, not the absence of
one particular spelling.

Run from your repo root:

    python3 patch26/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
JS = ROOT / "src/public/activity-fix.js"
if not JS.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(old, new, label):
    text = JS.read_text()
    if old not in text:
        skipped.append(f"{label} (already applied)")
        return
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    JS.write_text(text.replace(old, new))
    changed.append(label)


edit(
    "'Brand Kit, clean exports, Quality Center and social publishing are unlocked. Upgrade when you need AI Director and active-speaker framing.'",
    "'Brand Kit, clean exports and social publishing are unlocked. Upgrade when you need AI Director and active-speaker framing.'",
    "home card: drop Quality Center from the unlocked list",
)
edit(
    '<button class="dc-btn secondary" data-dc-nav="quality">Open Quality Center</button>',
    '<button class="dc-btn secondary" data-dc-nav="templates">Open Clip Styles</button>',
    "home card: retarget the dead nav button to Clip Styles",
)

edit(
    """exp.premium?'data-dc-nav="quality"':'data-dc-nav="subscription"'""",
    """exp.premium?'data-dc-nav="templates"':'data-dc-nav="subscription"'""",
    "home hero: retarget the secondary action away from the deleted view",
)

js = JS.read_text()
for gone in ("Quality Center", 'data-dc-nav="quality"', "renderQualityCenter", "qualityAssessment"):
    if gone in js:
        sys.exit(f"'{gone}' is still referenced in activity-fix.js.")

print("patch26 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNo Quality Center references remain anywhere in the UI.")
print("\nNext:\n  npm run check && npm test\n")
