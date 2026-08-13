#!/usr/bin/env python3
r"""
Rebuild the progress notification into a real, expandable activity dock.

WHAT WAS ACTUALLY WRONG
-----------------------
Three separate things, and none of them were "the design needs work":

1. The progress bar was FAKE. The CSS was
       #dcWork .dc-work-toast-progress i { width:42%; animation:dcWorkBar ... }
   — a fixed-width sliver looping forever. It never once reflected the real
   percentage, which is exactly why it looks stuck.

2. It showed ONE job. currentWorkItem() returned activeJobs()[0], so a
   template save that queued four re-renders showed a single anonymous
   "Rendering clip" with no idea three more were behind it.

3. It hid itself on the Home screen (`if (currentView === 'home') return null`),
   so the moment you navigated home, work in progress vanished.

WHAT THIS BUILDS
----------------
A dock that collapses to one honest line and expands to the detail:

  collapsed  Applying "My DeenClipped Template"
             2 of 4 done · 63% · about 2 min left      [63% bar]  [chevron]

  expanded   one row per job with its own stage, percent and bar, plus the
             last few stages of the running job as a timestamped log.

The numbers come from patch30's server work:
  - percent      real per-job progress, and a batch mean across the group
  - "2 of 4"     jobs sharing a batchId, counted by status
  - stage log    the worker's own stage strings with timestamps
  - ETA          measured, not guessed. It averages how long the finished
                 jobs in this batch actually took and multiplies by what is
                 left. A single job falls back to the worker's etaSec, and
                 when there is no evidence yet it shows nothing rather than
                 inventing a number.

Covers re-renders, imports, more-clips and publishing, because activeJobs()
already gathered all four — it just threw the detail away.

Run from your repo root:

    python3 patch31/apply.py
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


def edit(path, old, new, label):
    text = path.read_text()
    # `new` often ENDS with `old` (insert-before-anchor). Counting occurrences
    # of `old` that are not already part of an applied `new` is the only way
    # to tell "not yet applied" from "applied"; a plain `old in text` check
    # re-applies forever and silently duplicates whole functions.
    outstanding = text.replace(new, "").count(old) if new else text.count(old)
    if outstanding == 0 and new and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(f"ANCHOR NOT FOUND for '{label}'.\nExpected:\n{old[:300]}\n\nNothing written.")
    if outstanding != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({outstanding}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# --------------------------------------------- 1. richer activeJobs() model
OLD_JOBS = """  (d.rerenderJobs || []).forEach(j => {
    if (['queued','processing'].includes(j.status)) {
      const clip = (d.clips || []).find(c => c.id === j.clipId);
      jobs.push({kind:'render', title:`Editing ${clip?.title || 'clip'}`, stage:stageWithQueue(j), progress:Number(j.progress || 0), at:j.startedAt || j.createdAt});
    }
  });"""
NEW_JOBS = """  (d.rerenderJobs || []).forEach(j => {
    if (['queued','processing'].includes(j.status)) {
      const clip = (d.clips || []).find(c => c.id === j.clipId);
      jobs.push({kind:'render', title:`${j.clipTitle || clip?.title || 'Clip'}`, stage:stageWithQueue(j),
        progress:Number(j.progress || 0), at:j.startedAt || j.createdAt,
        etaSec:Number.isFinite(Number(j.etaSec)) ? Number(j.etaSec) : null,
        batchId:j.batchId || '', batchLabel:j.batchLabel || '', batchTotal:Number(j.batchTotal || 0),
        stages:Array.isArray(j.stages) ? j.stages : [], status:j.status});
    }
  });"""
edit(JS, OLD_JOBS, NEW_JOBS, "activeJobs(): carry eta, batch and stage log for re-renders")

edit(
    JS,
    "    if (['queued','processing'].includes(p.status)) jobs.push({kind:'project', title:p.title || 'Lecture', stage:stageWithQueue(p), progress:Number(p.progress || 0), at:p.startedAt || p.submittedAt});",
    "    if (['queued','processing'].includes(p.status)) jobs.push({kind:'project', title:p.title || 'Lecture', stage:stageWithQueue(p), progress:Number(p.progress || 0), at:p.startedAt || p.submittedAt, etaSec:Number.isFinite(Number(p.etaSec))?Number(p.etaSec):null, stages:Array.isArray(p.stages)?p.stages:[], status:p.status});",
    "activeJobs(): carry eta and stages for imports",
)


# ------------------------------------------------- 2. the model + formatting
edit(
    JS,
    "function currentWorkItem(){",
    """function formatEta(seconds){
  const value=Number(seconds);
  if(!Number.isFinite(value)||value<=0)return '';
  if(value<45)return 'less than a minute left';
  const minutes=Math.round(value/60);
  if(minutes<60)return `about ${minutes} min left`;
  const hours=Math.floor(minutes/60);
  return `about ${hours}h ${minutes%60}m left`;
}
function activityModel(){
  const d=data();if(!d)return null;
  const jobs=activeJobs();
  const rerenders=(d.rerenderJobs||[]);
  const running=jobs.filter(job=>job.batchId);
  const batchId=running[0]?.batchId||'';
  if(batchId){
    const all=rerenders.filter(j=>j.batchId===batchId);
    const done=all.filter(j=>['done','failed','cancelled'].includes(j.status));
    const total=Math.max(Number(all[0]?.batchTotal||0),all.length);
    const active=all.filter(j=>j.status==='processing');
    // Measured, not guessed: how long finished jobs in THIS batch took.
    const samples=done.map(j=>Number(j.finishedAt||0)-Number(j.startedAt||0)).filter(ms=>ms>1000);
    const perJob=samples.length?samples.reduce((sum,ms)=>sum+ms,0)/samples.length/1000:null;
    const remaining=Math.max(0,total-done.length);
    const partial=active.length?Number(active[0].progress||0)/100:0;
    const eta=perJob!==null?Math.round(perJob*Math.max(0,remaining-partial)):null;
    const percent=total?Math.round(((done.length+partial)/total)*100):0;
    return {
      kind:'batch', title:all[0]?.batchLabel||'Applying template',
      subtitle:`${done.length} of ${total} done`, percent:clamp(percent,0,100), eta,
      jobs:all.map(j=>({id:j.id,title:j.clipTitle||'Clip',stage:j.stage||j.status,progress:Number(j.progress||0),status:j.status,stages:j.stages||[]})),
      log:(active[0]?.stages||done[done.length-1]?.stages||[]).slice(-6),
    };
  }
  if(!jobs.length)return null;
  const job=jobs[0];
  return {
    kind:job.kind, title:job.title||'Working', subtitle:job.stage||'Working now',
    percent:Number.isFinite(Number(job.progress))?clamp(Math.round(Number(job.progress)),0,100):null,
    eta:job.etaSec??null,
    jobs:jobs.map(j=>({id:j.title,title:j.title,stage:j.stage,progress:Number(j.progress||0),status:j.status||'processing',stages:j.stages||[]})),
    log:(job.stages||[]).slice(-6),
  };
}
function currentWorkItem(){""",
    "add formatEta() and activityModel() with a measured batch ETA",
)


# --------------------------------------------------------- 3. the dock markup
edit(
    JS,
    """  work.innerHTML = `<span class="dc-work-toast-orb">${ICON.play}</span><div class="dc-work-toast-copy"><strong>Working…</strong><span>Saving changes</span></div><button id="dcWorkClose" type="button" aria-label="Hide progress notification">×</button><div class="dc-work-toast-progress"><i></i></div>`;""",
    """  work.innerHTML = `<div class="dc-work-head"><span class="dc-work-toast-orb">${ICON.play}</span><div class="dc-work-toast-copy"><strong>Working…</strong><span>Saving changes</span></div><b class="dc-work-percent" id="dcWorkPercent"></b><button class="dc-work-expand" id="dcWorkExpand" type="button" aria-expanded="false" aria-label="Show activity detail">${ICON.chevron}</button><button id="dcWorkClose" type="button" aria-label="Hide progress notification">×</button><div class="dc-work-toast-progress"><i id="dcWorkBar"></i></div></div><div class="dc-work-panel" id="dcWorkPanel"></div>`;""",
    "dock markup: percent, expander and a detail panel",
)


# ------------------------------------------------------------ 4. paint it
OLD_PAINT = """  const copy=workToastCopy(item);
  $('strong', el).textContent=copy.title;
  $('.dc-work-toast-copy span', el).textContent=copy.detail;
  el.classList.add('show');
}"""
NEW_PAINT = """  const model=item.source==='job'?activityModel():null;
  const copy=model?{title:model.title,detail:[model.subtitle,model.percent===null?'':`${model.percent}%`,formatEta(model.eta)].filter(Boolean).join(' · ')}:workToastCopy(item);
  $('strong', el).textContent=copy.title;
  $('.dc-work-toast-copy span', el).textContent=copy.detail;
  // A real bar. This used to be a fixed 42% sliver on an infinite loop, which
  // is why it always looked stuck.
  const bar=$('#dcWorkBar',el),percentEl=$('#dcWorkPercent',el);
  const percent=model?model.percent:null;
  if(bar){
    const known=Number.isFinite(Number(percent));
    bar.classList.toggle('is-indeterminate',!known);
    bar.style.width=known?`${clamp(Number(percent),0,100)}%`:'';
  }
  if(percentEl)percentEl.textContent=Number.isFinite(Number(percent))?`${percent}%`:'';
  const expand=$('#dcWorkExpand',el),panel=$('#dcWorkPanel',el);
  if(expand)expand.hidden=!model;
  if(panel&&model&&el.classList.contains('is-expanded')){
    const rows=model.jobs.map(job=>{
      const pct=clamp(Math.round(Number(job.progress||0)),0,100);
      const state=job.status==='done'?'done':job.status==='failed'?'fail':job.status==='processing'?'live':'wait';
      return `<div class="dc-work-job ${state}"><span class="dc-work-dot"></span><div><strong>${esc(shortText(job.title,42))}</strong><small>${esc(shortText(job.stage||job.status||'Waiting',54))}</small></div><i>${state==='done'?'Done':state==='fail'?'Failed':state==='wait'?'Queued':`${pct}%`}</i><div class="dc-work-job-bar"><b style="width:${state==='done'?100:pct}%"></b></div></div>`;
    }).join('');
    const log=(model.log||[]).map(entry=>`<li><time>${esc(formatClockTime(entry.at))}</time>${esc(shortText(entry.stage||'',60))}</li>`).join('');
    panel.innerHTML=`<div class="dc-work-jobs">${rows||'<div class="dc-work-empty">Nothing queued.</div>'}</div>${log?`<ul class="dc-work-log">${log}</ul>`:''}`;
  }else if(panel&&!el.classList.contains('is-expanded')){panel.innerHTML=''}
  el.classList.add('show');
}
function formatClockTime(at){
  const value=Number(at);if(!Number.isFinite(value)||value<=0)return '';
  try{return new Date(value).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{return ''}
}"""
edit(JS, OLD_PAINT, NEW_PAINT, "paint a real percentage, the job list and the stage log")


# Show on Home too, and wire the expander.
edit(
    JS,
    "  if (currentView === 'home') return null;\n  const job = activeJobs()[0];",
    "  const job = activeJobs()[0];",
    "stop hiding live work on the Home screen",
)

edit(
    JS,
    "  work.innerHTML = `<div class=\"dc-work-head\">",
    "  work.innerHTML = `<div class=\"dc-work-head\">",
    "(anchor check)",
) if False else None

edit(
    JS,
    "function paintWork(){",
    """function bindWorkDock(){
  const el=$('#dcWork');if(!el||el.dataset.bound==='1')return;
  el.dataset.bound='1';
  $('#dcWorkExpand',el)?.addEventListener('click',event=>{
    event.stopPropagation();
    const open=!el.classList.contains('is-expanded');
    el.classList.toggle('is-expanded',open);
    $('#dcWorkExpand',el)?.setAttribute('aria-expanded',String(open));
    paintWork();
  });
}
function paintWork(){
  bindWorkDock();""",
    "bind the expander once",
)

# ---------------------------------------------------------------------- CSS
CSS_ANCHOR = "/* Clip Styles studio"
CSS_BLOCK = """/* Activity dock. The base pill lives in the legacy inline CSS; these rules
 * turn it into an expandable panel with a real progress bar. */
body.dc-app #dcWork { flex-direction:column;align-items:stretch;padding:0;border-radius:20px;overflow:visible; }
body.dc-app #dcWork.is-expanded { width:min(660px,calc(100vw - 34px)); }
body.dc-app #dcWork .dc-work-head { position:relative;display:flex;align-items:center;gap:12px;min-height:62px;padding:10px 48px 12px 16px; }
body.dc-app #dcWork .dc-work-percent { flex-shrink:0;min-width:34px;color:var(--v6-gold-bright);font-size:11px;text-align:right; }
body.dc-app #dcWork .dc-work-expand { flex-shrink:0;width:26px;height:26px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.10);border-radius:8px;background:rgba(0,0,0,.3);color:var(--v6-muted); }
body.dc-app #dcWork .dc-work-expand svg { width:13px;height:13px;fill:none;stroke:currentColor;transition:transform .18s ease; }
body.dc-app #dcWork.is-expanded .dc-work-expand svg { transform:rotate(180deg); }
body.dc-app #dcWork .dc-work-toast-progress { left:16px;right:16px;bottom:6px; }
body.dc-app #dcWork .dc-work-toast-progress i { width:0;animation:none;transition:width .5s cubic-bezier(.2,.75,.25,1); }
body.dc-app #dcWork .dc-work-toast-progress i.is-indeterminate { width:42%;animation:dcWorkBar 1.25s ease-in-out infinite; }
body.dc-app #dcWork .dc-work-panel:empty { display:none; }
body.dc-app #dcWork .dc-work-panel { max-height:min(320px,46vh);overflow-y:auto;padding:4px 14px 14px;border-top:1px solid rgba(255,255,255,.07); }
body.dc-app .dc-work-jobs { display:grid;gap:6px;padding-top:10px; }
body.dc-app .dc-work-job { position:relative;display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px 9px 11px;border:1px solid rgba(255,255,255,.06);border-radius:11px;background:rgba(0,0,0,.26); }
body.dc-app .dc-work-dot { width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.22); }
body.dc-app .dc-work-job.live .dc-work-dot { background:var(--v6-gold);box-shadow:0 0 0 3px rgba(224,186,117,.16); }
body.dc-app .dc-work-job.done .dc-work-dot { background:var(--v6-green); }
body.dc-app .dc-work-job.fail .dc-work-dot { background:var(--v6-red); }
body.dc-app .dc-work-job strong { display:block;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-work-job small { display:block;margin-top:2px;color:var(--v6-muted);font-size:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-work-job>i { font-style:normal;font-size:9px;color:var(--v6-muted);white-space:nowrap; }
body.dc-app .dc-work-job.done>i { color:var(--v6-green); }
body.dc-app .dc-work-job.fail>i { color:var(--v6-red); }
body.dc-app .dc-work-job-bar { position:absolute;left:9px;right:9px;bottom:5px;height:2px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden; }
body.dc-app .dc-work-job-bar b { display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#d5af68,#f2d69b);transition:width .5s ease; }
body.dc-app .dc-work-job.done .dc-work-job-bar b { background:var(--v6-green); }
body.dc-app .dc-work-log { display:grid;gap:4px;margin:11px 0 0;padding:10px 0 0;border-top:1px solid rgba(255,255,255,.06);list-style:none; }
body.dc-app .dc-work-log li { display:grid;grid-template-columns:62px minmax(0,1fr);gap:8px;color:var(--v6-muted);font-size:8.5px; }
body.dc-app .dc-work-log time { color:var(--v6-subtle,#6d6e77);font-variant-numeric:tabular-nums; }
body.dc-app .dc-work-empty { padding:14px;text-align:center;color:var(--v6-muted);font-size:9px; }

"""
css_text = CSS.read_text()
if "body.dc-app #dcWork .dc-work-panel" in css_text:
    skipped.append("CSS: activity dock (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: activity dock")
else:
    sys.exit("CSS anchor not found in studio-v6.css. Nothing written.")

js = JS.read_text()
names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch31 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNext:\n  npm run check && npm test\n")
