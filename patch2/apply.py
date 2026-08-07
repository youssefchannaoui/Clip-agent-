#!/usr/bin/env python3
"""
Fix: the admin console tab buttons were rendered but never given a click
handler, so only Overview was reachable. Also stops the admin cards from
overflowing horizontally (grid children default to min-width:auto).

Run from your repo root:

    python3 patch2/apply.py
"""
import pathlib, sys

ROOT = pathlib.Path.cwd()
path = ROOT / "src/public/activity-fix.js"
if not path.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root.")

text = path.read_text()
changed = False

print("\nAdmin console tab fix\n" + "=" * 22)

# 1. Wire up the tab buttons.
old = "  $('#dcAdminRefresh')?.addEventListener('click',()=>{adminOps=null;adminAnalytics=null;renderAdminPage();});"
new = ("  $$('[data-admin-tab]',panel).forEach(btn=>btn.addEventListener('click',()=>{adminTab=btn.dataset.adminTab;renderAdminPage();}));\n"
       "  $$('[data-vendor-delete]',panel).forEach(btn=>btn.addEventListener('click',async()=>{\n"
       "    try{await callApi(`/api/admin/vendors/${encodeURIComponent(btn.dataset.vendorDelete)}`,{method:'DELETE'});notify('Removed.','good');adminOps=null;renderAdminPage();}\n"
       "    catch(error){notify(error.message,'bad')}\n"
       "  }));\n"
       + old)
if "data-admin-tab]',panel)" in text:
    print("  · already applied: tab click handler")
elif old not in text:
    sys.exit("  ERROR: could not find the anchor (#dcAdminRefresh binding).")
else:
    text = text.replace(old, new, 1)
    changed = True
    print("  ✓ tab buttons are now clickable")
    print("  ✓ vendor Remove buttons now work")

# 2. Stop admin content overflowing its grid track.
old_css = ".dc-admin-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}"
new_css = (".dc-admin-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}\n"
           ".dc-manage-page>*{min-width:0;max-width:100%}\n"
           ".dc-admin-grid,.dc-admin-panel,.dc-admin-list,.dc-admin-row{min-width:0;max-width:100%}\n"
           ".dc-admin-table{display:block;overflow-x:auto;white-space:nowrap}\n"
           ".dc-admin-row-copy strong,.dc-admin-row-copy span{overflow-wrap:anywhere}")
if ".dc-manage-page>*{min-width:0" in text:
    print("  · already applied: overflow CSS")
elif old_css not in text:
    print("  ! skipped overflow CSS (anchor not found)")
else:
    text = text.replace(old_css, new_css, 1)
    changed = True
    print("  ✓ admin cards/tables no longer overflow sideways")

if changed:
    path.write_text(text)
    print("\nSaved. Now:\n")
    print("  node --check src/public/activity-fix.js")
    print("  git add -A && git commit -m 'Fix admin console tab navigation'")
    print("  git push\n")
else:
    print("\nNothing to do — already applied.\n")
