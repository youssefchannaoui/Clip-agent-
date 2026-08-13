#!/usr/bin/env python3
"""
DeenClipped — admin console + UI fixes.

Run from your repo root, with this patch/ folder sitting next to it:

    python3 patch/apply.py

Applies:
  1. src/object-storage.js   — bucket usage reporting (S3 ListObjectsV2)
  2. src/admin-ops.js        — NEW: integrations, storage, subscriptions, vendors
  3. src/server.js           — user role in /api/state + 3 admin routes
  4. src/public/activity-fix.js — admin nav/view + sidebar overlap fix
                                  + floating clip layout + demo tour fix

Safe to re-run: every step no-ops if already applied.
"""
import pathlib, sys, shutil

ROOT = pathlib.Path.cwd()
PATCH = pathlib.Path(__file__).resolve().parent

def fail(msg):
    print(f"\n  ERROR: {msg}")
    sys.exit(1)

def read(rel):
    p = ROOT / rel
    if not p.exists():
        fail(f"Can't find {rel} — run this from your repo root.")
    return p, p.read_text()

def sub(text, old, new, label):
    """Replace `old` with `new` exactly once. Returns (text, changed)."""
    if new in text:
        print(f"  · already applied: {label}")
        return text, False
    if old not in text:
        fail(f"could not find the anchor for '{label}'. "
             f"The file may have changed since this patch was generated.")
    print(f"  ✓ {label}")
    return text.replace(old, new, 1), True


print("\nDeenClipped admin console + UI fixes\n" + "=" * 38)

# ---------------------------------------------------------------- 1. storage
print("\n[1/4] src/object-storage.js")
path, text = read("src/object-storage.js")
append = (PATCH / "object-storage-append.js").read_text()
if "export async function storageUsage" in text:
    print("  · already applied: storageUsage()")
else:
    text = text.rstrip() + "\n" + append
    path.write_text(text)
    print("  ✓ added storageUsage() + presignBucketQuery()")

# --------------------------------------------------------------- 2. admin-ops
print("\n[2/4] src/admin-ops.js")
dest = ROOT / "src" / "admin-ops.js"
if dest.exists():
    print("  · already exists (overwriting with current version)")
shutil.copyfile(PATCH / "admin-ops.js", dest)
print("  ✓ wrote src/admin-ops.js")

# ----------------------------------------------------------------- 3. server
print("\n[3/4] src/server.js")
path, text = read("src/server.js")

text, _ = sub(text,
    "import * as admin from './admin.js';",
    "import * as admin from './admin.js';\nimport * as adminOps from './admin-ops.js';",
    "import admin-ops module")

# Expose the signed-in user's role so the front end can show the Admin tab.
text, _ = sub(text,
    "publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),",
    "publishingSettings: publishingSettings(user), social: social.connectionStatus(user), billing: billing.publicBilling(user),\n    role: String(user?.role || 'creator').toLowerCase(),",
    "expose user role in /api/state")

# New admin routes, added next to the existing analytics route.
old_route = """  if (method === 'GET' && pathname === '/api/admin/analytics') {
    try { requireOperator(currentUser); return json(res, 200, admin.analytics(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }
"""
new_route = old_route + """
  if (method === 'GET' && pathname === '/api/admin/operations') {
    try { requireOperator(currentUser); return json(res, 200, await adminOps.operations(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/admin/vendors') {
    try { requireOperator(currentUser); return json(res, 200, adminOps.listVendors(currentUser)); }
    catch (error) { return json(res, error.statusCode || 404, { error: error.message }); }
  }

  if (method === 'POST' && pathname === '/api/admin/vendors') {
    try {
      requireOperator(currentUser);
      const body = await readBody(req);
      return json(res, 200, adminOps.saveVendor(currentUser, body));
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }

  if (method === 'DELETE' && pathname.startsWith('/api/admin/vendors/')) {
    try {
      requireOperator(currentUser);
      const id = decodeURIComponent(pathname.slice('/api/admin/vendors/'.length));
      return json(res, 200, adminOps.deleteVendor(currentUser, id));
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }
"""
text, _ = sub(text, old_route, new_route, "add /api/admin/operations + vendor routes")
path.write_text(text)

# --------------------------------------------------------------- 4. frontend
print("\n[4/4] src/public/activity-fix.js")
path, text = read("src/public/activity-fix.js")

# 4a — register 'admin' as a custom view
text, _ = sub(text,
    "const CUSTOM = new Set(['home','projects','review','editor','publishing','templates','music','automation','insights']);",
    "const CUSTOM = new Set(['home','projects','review','editor','publishing','templates','music','automation','insights','admin']);",
    "register admin view")

# 4b — create the #view-admin panel
text, _ = sub(text,
    "for (const name of ['home','projects','review','editor','publishing','templates','music','automation','insights']) {",
    "for (const name of ['home','projects','review','editor','publishing','templates','music','automation','insights','admin']) {",
    "create #view-admin panel")

# 4c — page title
text, _ = sub(text,
    "    automation:['Settings','Generation rules and studio controls']",
    "    automation:['Settings','Generation rules and studio controls'],\n    admin:['Admin','Subscriptions, storage, integrations and sign-ups']",
    "admin page title")

# 4d — render on navigate
text, _ = sub(text,
    "    if (view === 'home') renderHome();",
    "    if (view === 'admin') renderAdminPage();\n    if (view === 'home') renderHome();",
    "render admin on navigate")

# 4e — render on refresh
text, _ = sub(text,
    "function renderCurrent(){if(currentView==='home')renderHome();",
    "function renderCurrent(){if(currentView==='admin')renderAdminPage();if(currentView==='home')renderHome();",
    "render admin on refresh")

# 4f — admin nav group, only drawn for owner/admin accounts
text, _ = sub(text,
    """<div class="dc-nav-group"><div class="dc-nav-label"><span>Studio</span><i></i></div>${STUDIO_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div></div>""",
    """<div class="dc-nav-group"><div class="dc-nav-label"><span>Studio</span><i></i></div>${STUDIO_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group" id="dcAdminNav" style="display:none"><div class="dc-nav-label"><span>Admin</span><i></i></div>${navButton('admin','Admin console','analytics')}</div></div>""",
    "admin nav group")

# 4g — show/hide the admin nav each sync, based on the role from /api/state
text, _ = sub(text,
    "  const jobs=activeJobs(),issues=workspaceFailures(data()),health=$('#dcHealth');",
    "  const adminNav=$('#dcAdminNav');if(adminNav)adminNav.style.display=isOperator()?'':'none';\n  const jobs=activeJobs(),issues=workspaceFailures(data()),health=$('#dcHealth');",
    "toggle admin nav by role")

# 4h — append the admin console code before the closing IIFE
admin_js = (PATCH / "frontend-admin.js").read_text()
if "function renderAdminPage()" in text:
    print("  · already applied: admin console code")
else:
    marker = "\nfunction boot(){"
    if marker not in text:
        fail("could not find boot() to insert the admin console before.")
    text = text.replace(marker, "\n" + admin_js + marker, 1)
    print("  ✓ admin console code")

# 4i — CSS: admin console styling + sidebar overlap fix + floating clip layout
css = """
/* --- Admin console ------------------------------------------------------- */
.dc-admin-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}
.dc-admin-tab{min-height:34px;padding:0 14px;border:1px solid var(--dc-line);border-radius:999px;background:#0b0b0d;color:var(--dc-muted);font-size:11px;font-weight:700}
.dc-admin-tab:hover{color:var(--dc-text);border-color:rgba(221,183,118,.3)}
.dc-admin-tab.is-active{background:rgba(217,180,120,.13);border-color:rgba(217,180,120,.35);color:var(--dc-text)}
.dc-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.dc-admin-card{padding:15px;border:1px solid var(--dc-line);border-radius:18px;background:linear-gradient(145deg,#151519,#0d0d10)}
.dc-admin-card-label{display:block;color:var(--dc-subtle);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.dc-admin-card strong{display:block;font-size:24px;margin:7px 0 3px;letter-spacing:-.02em}
.dc-admin-card em{display:block;font-style:normal;color:var(--dc-muted);font-size:9.5px}
.dc-admin-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}
.dc-admin-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.dc-admin-panel h2{font-size:16px;margin:0}
.dc-admin-subhead{font-size:12px;margin:16px 0 8px;color:var(--dc-muted)}
.dc-admin-note{margin:0 0 12px;color:var(--dc-muted);font-size:10.5px;line-height:1.55}
.dc-admin-dim{display:block;color:var(--dc-subtle);font-size:9px;margin-top:2px}
.dc-admin-list{display:grid;gap:8px}
.dc-admin-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(0,0,0,.22)}
.dc-admin-row-copy{min-width:0}
.dc-admin-row-copy strong{display:block;font-size:11.5px}
.dc-admin-row-copy span{display:block;font-size:9.5px;color:var(--dc-muted);margin-top:3px}
.dc-admin-row-actions{display:flex;align-items:center;gap:8px;flex:0 0 auto}
.dc-admin-row-actions .dc-btn{min-height:30px;font-size:9.5px;padding:0 10px}
.dc-admin-req{font-style:normal;margin-left:7px;padding:2px 6px;border-radius:999px;background:rgba(217,180,120,.14);color:var(--dc-accent2);font-size:8px;letter-spacing:.06em;text-transform:uppercase}
.dc-admin-table{width:100%;border-collapse:collapse;font-size:10.5px}
.dc-admin-table th{text-align:left;padding:8px 10px;color:var(--dc-subtle);font-size:9px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;border-bottom:1px solid var(--dc-line)}
.dc-admin-table td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.05);vertical-align:top}
.dc-admin-table tr:last-child td{border-bottom:0}
.dc-admin-table strong{font-size:11px}
.dc-admin-alerts{display:grid;gap:7px}
.dc-admin-alert{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid rgba(255,138,138,.24);border-radius:12px;background:rgba(255,90,90,.07);color:#ffb3b3;font-size:10.5px}
.dc-admin-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.dc-admin-form label{display:grid;gap:6px;color:var(--dc-muted);font-size:9px}
.dc-admin-form input,.dc-admin-form select{width:100%;height:38px;padding:0 10px;border:1px solid var(--dc-line);border-radius:10px;background:#0b0b0d;color:var(--dc-text)}
.dc-admin-form .wide{grid-column:1/-1}
@media(max-width:820px){.dc-admin-form{grid-template-columns:1fr}.dc-admin-row{flex-direction:column;align-items:flex-start}}

/* --- Sidebar / main content must never overlap --------------------------- */
/* The sidebar is position:fixed, so any horizontal overflow in a panel used
   to slide underneath it and make the page look broken. Clipping overflow on
   the scroll container and pinning the panel's own stacking context keeps the
   two permanently separated. */
body.dc-app #app>.wrap{max-width:100vw;overflow-x:clip}
body.dc-app .main-col,body.dc-app .main-col>.panel{min-width:0;max-width:100%}
body.dc-app .main-col>.panel{position:relative;z-index:1}
#dcSidebar{z-index:190}
#dcTopbar{z-index:180}
body.dc-project-open #view-projects{width:100%!important;max-width:100%!important;overflow:visible!important;position:relative;z-index:1}
body.dc-project-open .main-col,body.dc-project-open #app>.wrap{overflow-x:clip!important}

/* --- Floating hero clips: wider, more staggered, less clumped ------------- */
.dc-v5-stage{min-height:350px}
.dc-v5-phone:nth-of-type(2){left:0%;top:26%;--rot:-12deg;z-index:2}
.dc-v5-phone:nth-of-type(3){left:33%;top:0%;--rot:2deg;z-index:4}
.dc-v5-phone:nth-of-type(4){right:0%;top:23%;--rot:12deg;z-index:2}
.dc-v5-phone:nth-of-type(3){width:166px}
.dc-v5-phone:nth-of-type(2),.dc-v5-phone:nth-of-type(4){width:142px}
.dc-v5-phone:nth-of-type(2){animation-duration:8.5s;animation-delay:-1.1s}
.dc-v5-phone:nth-of-type(3){animation-duration:7s;animation-delay:-3.4s}
.dc-v5-phone:nth-of-type(4){animation-duration:9.5s;animation-delay:-5.8s}
.dc-v5-phone:hover{transform:rotate(0) translateY(-12px) scale(1.04);z-index:6}
@media(max-width:860px){
  .dc-v5-stage{min-height:300px}
  .dc-v5-phone:nth-of-type(3){width:138px}
  .dc-v5-phone:nth-of-type(2),.dc-v5-phone:nth-of-type(4){width:120px}
  .dc-v5-phone:nth-of-type(2){left:1%;top:24%}
  .dc-v5-phone:nth-of-type(4){right:1%;top:22%}
}
"""
if ".dc-admin-tabs{" in text:
    print("  · already applied: admin + fix CSS")
else:
    # Styles are injected via a <style> block; append to the last CSS string.
    anchor = "\nfunction boot(){"
    css_marker = "const DC_ADMIN_CSS = `"
    inject = f"{css_marker}{css}`;\ntry{{const s=document.createElement('style');s.textContent=DC_ADMIN_CSS;document.head.append(s);}}catch{{}}\n"
    text = text.replace(anchor, "\n" + inject + anchor, 1)
    print("  ✓ admin + fix CSS")

# 4j — demo tour: don't fire before the app shell is actually on screen
text, _ = sub(text,
    "function boot(){injectShell();setTimeout(()=>{go('home');try{if(localStorage.getItem('dc-guided-demo-complete')!=='1')setTimeout(()=>openGuidedTour(0),700)}catch{}},80);setInterval(sync,900)}",
    "function boot(){injectShell();setTimeout(()=>{go('home');try{if(localStorage.getItem('dc-guided-demo-complete')!=='1'){const start=()=>{if($('#app')&&!$('#app').classList.contains('hide')&&$('#view-home'))openGuidedTour(0);else setTimeout(start,400)};setTimeout(start,700)}}catch{}},80);setInterval(sync,900)}",
    "demo tour waits for the app shell")

path.write_text(text)

print("\n" + "=" * 38)
print("Done. Now check it compiles and push:\n")
print("  node --check src/public/activity-fix.js")
print("  node --check src/server.js")
print("  node --check src/admin-ops.js")
print("  node --check src/object-storage.js")
print("  git add -A && git commit -m 'Add admin console, storage reporting, UI fixes'")
print("  git push\n")
