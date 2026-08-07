#!/usr/bin/env python3
"""
Fix: sidebar/content overlap when opening a clip from the library.

What is actually happening: activity-fix.js is layered on top of the original
app, which still owns the legacy #view-library / #view-queue panels. When both
scripts touch panel visibility around the same moment, one panel can be left
without the .hide class — so two panels render at once and the page looks like
the sidebar is overlapping the content.

Rather than chase the exact race, sync() (which already runs every 900ms) now
asserts the invariant every tick: exactly one panel visible, and it is the one
matching currentView. Any stale panel self-corrects within a second.

Also hardens the sidebar so that if anything ever does escape its container, it
is cleanly covered instead of blending through.

Run from your repo root:

    python3 patch5/apply.py
"""
import pathlib, sys

ROOT = pathlib.Path.cwd()
path = ROOT / "src/public/activity-fix.js"
if not path.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root.")

text = path.read_text()
changed = False

print("\nPanel overlap fix\n" + "=" * 18)

# 1. Enforce single-panel visibility on every sync tick.
anchor = "  const adminNav=$('#dcAdminNav');if(adminNav)adminNav.style.display=isOperator()?'':'none';"
fallback_anchor = "  const jobs=activeJobs(),issues=workspaceFailures(data()),health=$('#dcHealth');"

guard = """  // Only one view panel may ever be visible. The original app still controls
  // the legacy library/queue panels, so if both scripts touch visibility at
  // once a stale panel can be left on screen and appear to overlap the
  // sidebar. Re-asserting it here means any such race self-corrects.
  if(currentView){
    const active=`view-${currentView}`;
    $$('.main-col > .panel').forEach(p=>{
      const shouldHide=p.id!==active;
      if(p.classList.contains('hide')!==shouldHide)p.classList.toggle('hide',shouldHide);
    });
  }
"""

if "Only one view panel may ever be visible" in text:
    print("  · already applied: single-panel guard")
elif anchor in text:
    text = text.replace(anchor, guard + anchor, 1)
    changed = True
    print("  ✓ single-panel visibility guard in sync()")
elif fallback_anchor in text:
    text = text.replace(fallback_anchor, guard + fallback_anchor, 1)
    changed = True
    print("  ✓ single-panel visibility guard in sync() (fallback anchor)")
else:
    sys.exit("  ERROR: could not find sync() to insert the guard.")

# 2. Harden the sidebar stacking so an escaped element is covered, not blended.
css_anchor = ".dc-admin-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}"
css_new = css_anchor + """
#dcSidebar{background:#0c0c0e!important;z-index:400!important}
#dcTopbar{z-index:390!important}
body.dc-app .main-col>.panel{position:relative;z-index:1}
body.dc-app #app>.wrap{box-sizing:border-box}
body.dc-project-open .dc-project-detail-page,body.dc-project-open .dc-project-clip-grid{min-width:0!important;max-width:100%!important}"""

if "#dcSidebar{background:#0c0c0e!important;z-index:400!important}" in text:
    print("  · already applied: sidebar stacking")
elif css_anchor not in text:
    print("  ! skipped sidebar CSS (patch3 not applied yet?)")
else:
    text = text.replace(css_anchor, css_new, 1)
    changed = True
    print("  ✓ sidebar stacking hardened")

if changed:
    path.write_text(text)
    print("""
Saved. Then:

  node --check src/public/activity-fix.js
  git add -A && git commit -m "Stop stale panels overlapping the sidebar"
  git push

To confirm it worked: open a clip from the library the way that triggered it
before. If it still happens, open the browser console (Cmd+Option+J) and run

  document.querySelectorAll('.main-col > .panel:not(.hide)')

and tell me what it lists — that names the panel that is escaping, and I can
target the actual trigger instead of the symptom.""")
else:
    print("\nNothing to do — already applied.")
