#!/usr/bin/env python3
"""
Live service metrics for the admin console.

  worker/worker_metrics.py  NEW  CPU / RAM / disk / load, read from /proc
  worker/service.py               adds an authenticated GET /metrics endpoint
  src/service-metrics.js    NEW  Cloudflare R2 + Hetzner Cloud + SocialKit estimate
  src/worker-client.js            adds metrics() call
  src/config.js                   adds CLOUDFLARE_* / HETZNER_API_TOKEN
  src/admin-ops.js                includes live metrics in the payload
  src/public/activity-fix.js      new "Services" tab in the admin console

Run from your repo root:

    python3 patch3/apply.py

Safe to re-run.
"""
import pathlib, shutil, sys

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
    if new in text:
        print(f"  · already applied: {label}")
        return text
    if old not in text:
        fail(f"could not find the anchor for '{label}'.")
    print(f"  ✓ {label}")
    return text.replace(old, new, 1)

print("\nLive service metrics\n" + "=" * 22)

# ------------------------------------------------------------- worker module
print("\n[1/7] worker/worker_metrics.py")
shutil.copyfile(PATCH / "worker_metrics.py", ROOT / "worker" / "worker_metrics.py")
print("  ✓ wrote worker/worker_metrics.py")

# ------------------------------------------------------------ worker service
print("\n[2/7] worker/service.py")
path, text = read("worker/service.py")
text = sub(text,
    "from import_providers import ImportProviderError, download_https, provider_for",
    "import worker_metrics\nfrom import_providers import ImportProviderError, download_https, provider_for",
    "import worker_metrics")
text = sub(text,
    '''        if self.command == "GET" and path == "/readiness":''',
    '''        if self.command == "GET" and path == "/metrics":
            return self.send_json(200, worker_metrics.snapshot(
                str(TEMP_DIR),
                queue_depth=PROCESSOR.queue.qsize(),
                running=len(PROCESSOR.running),
                max_concurrent=MAX_CONCURRENT,
            ))
        if self.command == "GET" and path == "/readiness":''',
    "add authenticated GET /metrics")
path.write_text(text)

# ------------------------------------------------------------ worker client
print("\n[3/7] src/worker-client.js")
path, text = read("src/worker-client.js")
text = sub(text,
    "export const readiness = () => request('/readiness');",
    "export const readiness = () => request('/readiness');\nexport const metrics = () => request('/metrics');",
    "add metrics() client call")
path.write_text(text)

# ------------------------------------------------------------------- config
print("\n[4/7] src/config.js")
path, text = read("src/config.js")
text = sub(text,
    "  adminEmail: process.env.ADMIN_EMAIL || 'admin@deenclipped.local',",
    "  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',\n"
    "  cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || '',\n"
    "  hetznerApiToken: process.env.HETZNER_API_TOKEN || '',\n"
    "  adminEmail: process.env.ADMIN_EMAIL || 'admin@deenclipped.local',",
    "add Cloudflare + Hetzner token config")
path.write_text(text)

# ---------------------------------------------------------- service-metrics
print("\n[5/7] src/service-metrics.js")
shutil.copyfile(PATCH / "service-metrics.js", ROOT / "src" / "service-metrics.js")
print("  ✓ wrote src/service-metrics.js")

# --------------------------------------------------------------- admin-ops
print("\n[6/7] src/admin-ops.js")
path, text = read("src/admin-ops.js")
text = sub(text,
    "import { publicBilling } from './billing.js';",
    "import { publicBilling } from './billing.js';\nimport * as serviceMetrics from './service-metrics.js';",
    "import service-metrics")
text = sub(text,
    "  const rows = integrations();\n  return {\n    generatedAt: Date.now(),",
    "  const rows = integrations();\n"
    "  let live;\n"
    "  try { live = await serviceMetrics.allMetrics(); }\n"
    "  catch (error) { live = { error: error.message }; }\n"
    "  return {\n    generatedAt: Date.now(),\n    live,",
    "include live metrics in payload")
path.write_text(text)

# ---------------------------------------------------------------- frontend
print("\n[7/7] src/public/activity-fix.js")
path, text = read("src/public/activity-fix.js")

text = sub(text,
    "const tabs=[['overview','Overview'],['subscriptions','Subscriptions'],['storage','Storage'],['integrations','Integrations'],['vendors','Costs & renewals'],['users','Users']];",
    "const tabs=[['overview','Overview'],['services','Services'],['subscriptions','Subscriptions'],['storage','Storage'],['integrations','Integrations'],['vendors','Costs & renewals'],['users','Users']];",
    "add Services tab")

text = sub(text,
    "    :adminTab==='subscriptions'?adminSubscriptions()",
    "    :adminTab==='services'?adminServices()\n      :adminTab==='subscriptions'?adminSubscriptions()",
    "route Services tab")

services_fn = r"""
function adminMeter(label,percent,detail,tone=''){
  const pct=percent===null||percent===undefined?null:Math.max(0,Math.min(100,Number(percent)));
  return `<div class="dc-quality-row"><span>${esc(label)}</span><div class="dc-quality-bar${tone?' '+tone:''}"><i style="width:${pct===null?0:pct}%"></i></div><b>${pct===null?'—':pct+'%'}</b></div>${detail?`<div class="dc-admin-dim" style="margin:-4px 0 10px">${esc(detail)}</div>`:''}`;
}

function adminServices(){
  const live=adminOps?.live;
  if(!live)return `<section class="dc-admin-panel"><h2>Services</h2><p class="dc-admin-note">No live metric data in this response.</p></section>`;
  if(live.error)return `<section class="dc-admin-panel"><h2>Services</h2><p class="dc-admin-note">Could not read live metrics: ${esc(live.error)}</p></section>`;

  /* ---- Worker box ---- */
  const w=live.worker||{};
  let workerPanel;
  if(!w.configured){
    workerPanel=`<p class="dc-admin-note">The processing worker is not configured.</p>`;
  }else if(w.error){
    workerPanel=`<p class="dc-admin-note">Worker unreachable: ${esc(w.error)}</p>`;
  }else{
    const cpu=w.cpu||{},mem=w.memory||{},disk=w.disk||{},q=w.queue||{};
    const la=cpu.loadAverage;
    const upt=w.uptimeSeconds?`${Math.floor(w.uptimeSeconds/86400)}d ${Math.floor((w.uptimeSeconds%86400)/3600)}h`:'—';
    workerPanel=`${w.legacy?`<p class="dc-admin-note">${esc(w.note||'Worker needs rebuilding for full metrics.')}</p>`:''}
      <div class="dc-admin-grid">
        <article class="dc-admin-card"><span class="dc-admin-card-label">CPU</span><strong>${cpu.percent===null||cpu.percent===undefined?'—':cpu.percent+'%'}</strong><em>${cpu.cores?cpu.cores+' cores':'—'}${la?` · load ${la['1m']}`:''}</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Memory</span><strong>${mem.percent===null||mem.percent===undefined?'—':mem.percent+'%'}</strong><em>${mem.usedBytes?formatBytes(mem.usedBytes):'—'} of ${mem.totalBytes?formatBytes(mem.totalBytes):'—'}</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Disk</span><strong>${disk.percent===null||disk.percent===undefined?'—':disk.percent+'%'}</strong><em>${disk.freeBytes?formatBytes(disk.freeBytes)+' free':'—'}</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Queue</span><strong>${q.running??0} / ${q.maxConcurrent??'—'}</strong><em>${q.depth??0} waiting · up ${upt}</em></article>
      </div>
      ${adminMeter('CPU',cpu.percent,cpu.cores?`${cpu.cores} cores available`:'')}
      ${adminMeter('Memory',mem.percent,mem.totalBytes?`${formatBytes(mem.usedBytes||0)} of ${formatBytes(mem.totalBytes)}`:'')}
      ${adminMeter('Disk',disk.percent,disk.totalBytes?`${formatBytes(disk.freeBytes||0)} free of ${formatBytes(disk.totalBytes)}`:'')}`;
  }

  /* ---- Hetzner billing ---- */
  const h=live.hetzner||{};
  let hetznerPanel;
  if(!h.configured){
    hetznerPanel=`<p class="dc-admin-note">Add <b>${esc((h.envKeys||['HETZNER_API_TOKEN']).join(', '))}</b> in Render to show server type, cost and bandwidth.</p>`;
  }else if(h.error){
    hetznerPanel=`<p class="dc-admin-note">Hetzner API error: ${esc(h.error)}</p>`;
  }else{
    hetznerPanel=(h.servers||[]).map(s=>`<div class="dc-admin-row"><div class="dc-admin-row-copy"><strong>${esc(s.name)} <span class="dc-admin-req">${esc(s.serverType)}</span></strong><span>${s.cores} vCPU · ${s.memoryGb} GB RAM · ${s.diskGb} GB disk · ${esc(s.location)}</span><span class="dc-admin-dim">Traffic ${s.outgoingTrafficBytes?formatBytes(s.outgoingTrafficBytes):'0 B'} of ${s.includedTrafficBytes?formatBytes(s.includedTrafficBytes):'—'}${s.trafficPercent!==null?` (${s.trafficPercent}%)`:''}</span></div><div class="dc-admin-row-actions"><span class="dc-status-pill${s.status==='running'?' good':' bad'}">${esc(s.status)}</span><span class="dc-status-pill">${s.monthlyCost?`€${s.monthlyCost.toFixed(2)}/mo`:'—'}</span></div></div>`).join('')
      ||`<p class="dc-admin-note">No servers returned by the Hetzner API.</p>`;
  }

  /* ---- Cloudflare R2 ---- */
  const c=live.cloudflare||{};
  let cfPanel;
  if(!c.configured){
    cfPanel=`<p class="dc-admin-note">Add <b>${esc((c.envKeys||['CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID']).join(', '))}</b> in Render to show R2 operation counts and free-tier headroom.</p>`;
  }else if(c.error){
    cfPanel=`<p class="dc-admin-note">Cloudflare API error: ${esc(c.error)}</p>`;
  }else{
    const ft=c.freeTier||{};
    const aPct=ft.classA?Math.min(100,Math.round(c.classAOperations/ft.classA*100)):null;
    const bPct=ft.classB?Math.min(100,Math.round(c.classBOperations/ft.classB*100)):null;
    cfPanel=`<div class="dc-admin-grid">
        <article class="dc-admin-card"><span class="dc-admin-card-label">Class A ops</span><strong>${(c.classAOperations||0).toLocaleString()}</strong><em>writes · last ${c.windowDays} days</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Class B ops</span><strong>${(c.classBOperations||0).toLocaleString()}</strong><em>reads · last ${c.windowDays} days</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Stored</span><strong>${c.storedBytes?formatBytes(c.storedBytes):'—'}</strong><em>${c.objectCount?c.objectCount.toLocaleString()+' objects':'per Cloudflare'}</em></article>
      </div>
      ${adminMeter('Class A free tier',aPct,`${(c.classAOperations||0).toLocaleString()} of ${(ft.classA||0).toLocaleString()} free writes/month`)}
      ${adminMeter('Class B free tier',bPct,`${(c.classBOperations||0).toLocaleString()} of ${(ft.classB||0).toLocaleString()} free reads/month`)}
      ${(c.byAction||[]).length?`<h3 class="dc-admin-subhead">By operation</h3><table class="dc-admin-table"><thead><tr><th>Operation</th><th>Requests</th></tr></thead><tbody>${c.byAction.map(r=>`<tr><td>${esc(r.action)}</td><td>${r.requests.toLocaleString()}</td></tr>`).join('')}</tbody></table>`:''}`;
  }

  /* ---- SocialKit (estimated) ---- */
  const s=live.socialkit||{};
  let skPanel;
  if(!s.applicable){
    skPanel=`<p class="dc-admin-note">Import provider is <b>${esc(s.provider||'none')}</b>, so no SocialKit credits are consumed.</p>`;
  }else{
    skPanel=`<p class="dc-admin-note"><b>Estimated.</b> SocialKit has no usage API, so this is calculated from your own imports at 1 credit per source minute. Treat the SocialKit dashboard as the source of truth.</p>
      <div class="dc-admin-grid">
        <article class="dc-admin-card"><span class="dc-admin-card-label">Credits used (est.)</span><strong>${(s.creditsUsedEstimate||0).toLocaleString()}</strong><em>${s.importsThisWindow||0} link imports this period</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Remaining (est.)</span><strong>${s.creditsRemainingEstimate===null||s.creditsRemainingEstimate===undefined?'—':s.creditsRemainingEstimate.toLocaleString()}</strong><em>${s.planCredits?`of ${s.planCredits.toLocaleString()} plan credits`:'set plan size below'}</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Period started</span><strong>${formatDay(s.windowStart)}</strong><em>day ${s.daysIntoWindow??0}${s.resetDay?` · resets day ${s.resetDay}`:' · rolling 30 days'}</em></article>
        <article class="dc-admin-card"><span class="dc-admin-card-label">Previous period</span><strong>${(s.previousPeriod?.creditsUsed||0).toLocaleString()}</strong><em>${s.previousPeriod?.imports||0} imports last cycle</em></article>
      </div>
      ${s.percentUsed!==null&&s.percentUsed!==undefined?adminMeter('Plan credits used',s.percentUsed,`${(s.creditsUsedEstimate||0).toLocaleString()} of ${(s.planCredits||0).toLocaleString()}`):''}
      <h3 class="dc-admin-subhead">Plan details</h3>
      <form class="dc-admin-form" id="dcSocialkitForm">
        <label>Monthly plan credits<input name="planCredits" type="number" min="0" step="1" value="${s.planCredits||''}" placeholder="12000"></label>
        <label>Resets on day of month<input name="resetDay" type="number" min="1" max="31" step="1" value="${s.resetDay||''}" placeholder="7"></label>
        <div class="wide"><button class="dc-btn" type="submit">Save plan details</button></div>
      </form>`;
  }

  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Processing worker</h2><span class="dc-status-pill">${live.at?formatRelative(live.at):''}</span></div>${workerPanel}</section>
    <section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Hetzner Cloud</h2>${h.configured&&!h.error?`<span class="dc-status-pill">€${(h.totalMonthlyCost||0).toFixed(2)}/mo</span>`:''}</div>${hetznerPanel}</section>
    <section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Cloudflare R2</h2></div>${cfPanel}</section>
    <section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>SocialKit credits</h2><span class="dc-status-pill warn">Estimate</span></div>${skPanel}</section>`;
}
"""

if "function adminServices()" in text:
    print("  · already applied: adminServices()")
else:
    marker = "\nfunction renderAdminPage(){"
    if marker not in text:
        fail("could not find renderAdminPage() to insert adminServices() before.")
    text = text.replace(marker, "\n" + services_fn + marker, 1)
    print("  ✓ adminServices() renderer")

# SocialKit plan form handler
text = sub(text,
    "  $('#dcVendorForm')?.addEventListener('submit',async event=>{",
    """  $('#dcSocialkitForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const fd=new FormData(event.target);
    try{
      await callApi('/api/admin/service-meta',{method:'POST',body:JSON.stringify({service:'socialkit',planCredits:Number(fd.get('planCredits')||0),resetDay:Number(fd.get('resetDay')||0)})});
      notify('Saved.','good');adminOps=null;renderAdminPage();
    }catch(error){notify(error.message,'bad')}
  });
  $('#dcVendorForm')?.addEventListener('submit',async event=>{""",
    "SocialKit plan form handler")
path.write_text(text)

# --------------------------------------------------- service-meta endpoint
print("\n[extra] src/admin-ops.js — service metadata store")
path, text = read("src/admin-ops.js")
if "export function saveServiceMeta" in text:
    print("  · already applied: saveServiceMeta()")
else:
    text += """
/* --- Editable per-service metadata (plan sizes, reset days) --------------- */

export function saveServiceMeta(user, input = {}) {
  requireOperator(user);
  const service = String(input.service || '').trim().toLowerCase();
  if (!service) throw Object.assign(new Error('A service name is required.'), { statusCode: 400 });
  if (!state.adminServiceMeta || typeof state.adminServiceMeta !== 'object') state.adminServiceMeta = {};
  const planCredits = Math.max(0, Number(input.planCredits || 0));
  const resetDayRaw = Number(input.resetDay || 0);
  const resetDay = resetDayRaw >= 1 && resetDayRaw <= 31 ? Math.floor(resetDayRaw) : 0;
  state.adminServiceMeta[service] = { planCredits, resetDay, updatedAt: Date.now() };
  save();
  return state.adminServiceMeta[service];
}
"""
    path.write_text(text)
    print("  ✓ saveServiceMeta()")

print("\n[extra] src/server.js — service-meta route")
path, text = read("src/server.js")
text = sub(text,
    "  if (method === 'GET' && pathname === '/api/admin/vendors') {",
    """  if (method === 'POST' && pathname === '/api/admin/service-meta') {
    try {
      requireOperator(currentUser);
      const body = await readBody(req);
      return json(res, 200, adminOps.saveServiceMeta(currentUser, body));
    } catch (error) { return json(res, error.statusCode || 400, { error: error.message }); }
  }

  if (method === 'GET' && pathname === '/api/admin/vendors') {""",
    "add /api/admin/service-meta route")
path.write_text(text)

print("\n" + "=" * 22)
print("""Done.

STEP 1 — push the web service (Render auto-deploys):

  node --check src/service-metrics.js
  node --check src/admin-ops.js
  node --check src/server.js
  node --check src/public/activity-fix.js
  git add -A && git commit -m "Add live service metrics to admin console"
  git push

STEP 2 — rebuild the worker so CPU/RAM appear (SSH to Hetzner):

  ssh root@<your-worker-ip>
  cd /opt/deenclipped && git pull
  docker compose up -d --build

STEP 3 — optional API tokens, added in Render → Environment:

  CLOUDFLARE_API_TOKEN     Cloudflare → My Profile → API Tokens →
                           Create Token → Read analytics and logs
  CLOUDFLARE_ACCOUNT_ID    Cloudflare dashboard URL, or R2 overview page
  HETZNER_API_TOKEN        Hetzner Console → Security → API tokens →
                           Generate, READ permission only

Until those are set the Services tab still shows worker CPU/RAM and the
SocialKit estimate; the Cloudflare and Hetzner panels just say what to add.""")
