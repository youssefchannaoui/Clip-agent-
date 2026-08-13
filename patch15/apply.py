#!/usr/bin/env python3
"""
Rebuild Quality Center from scratch — not a restyle.

WHAT WAS WRONG (user's own words, 4 screenshots)
--------------------------------------------------
"publish center on quality center looks so bad and messed up, quality
center also doesn't make sense fix all these issues" — plus, separately:
layout broken/overlapping, too complicated, too many options, doesn't
understand what it does, looks cheap.

The old page: a circular score gauge, a 4-tile metrics row, a scrollable
list where every row carried FOUR mini status badges (Captions / Render /
Speaker / Safety) plus a 0-100 number on the thumbnail, and a whole second
sidebar column with a "Publishing preflight" card and a "Studio quality
controls" upsell card. Nine visually distinct components competing for
attention, most of them not asking the user to do anything.

WHAT THIS PAGE ANSWERS NOW
---------------------------
One question: which clips can post right now, and what's blocking the rest.
Two lists. Each blocked row gets exactly one plain-language reason and one
button that fixes it — not four badges to interpret. The raw 0-100 score is
gone from the UI entirely (kept internally in qualityAssessment() for
sorting); each clip instead gets a two-state badge: Good or Needs review.
The sidebar upsell cards are gone — publishing/channel status belongs on
the Publishing page, not duplicated here.

qualityAssessment() itself is untouched: same five checks (captions,
render, audio, human-review safety, post metadata), same scoring math nothing
downstream depends on changes there.

Run from your repo root:

    python3 patch15/apply.py
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


# ------------------------------------------------------------------- the page

OLD_JS = """function qualityCheck(label,ready,copy){return `<span class="dc-v6-check ${ready?'ready':'warn'}"><i>${ready?ICON.check:ICON.warning}</i><b>${esc(label)}</b><em>${esc(copy)}</em></span>`}
function renderQualityCenter(){
  const panel=$('#view-quality'),d=data();if(!panel||!d)return;const clips=d.clips||[],exp=clientExperience(),advanced=Boolean(billingInfo().features?.advancedFraming||billingInfo().current?.unlimited);
  const assessed=clips.map(clip=>({clip,...qualityAssessment(clip)})).sort((a,b)=>a.score-b.score),ready=assessed.filter(item=>item.score>=90&&item.safe&&item.renderReady).length,needs=assessed.filter(item=>item.issues.length).length,framed=assessed.filter(item=>item.framingReady).length;
  const average=Math.round(assessed.reduce((sum,item)=>sum+item.score,0)/Math.max(1,assessed.length));const publishing=publishingAccess(),connected=connectedPlatformCount(d);
  const rows=assessed.slice(0,12).map(item=>`<article class="dc-v6-quality-row"><button class="dc-v6-quality-thumb" data-edit-video-clip="${esc(item.clip.id)}">${item.clip.thumbUrl?`<img src="${authedUrl(item.clip.thumbUrl)}" alt="${esc(item.clip.title||'Clip')} thumbnail">`:ICON.play}<span>${Math.round(item.score)}</span></button><div class="dc-v6-quality-copy"><strong>${esc(shortText(item.clip.title||'Untitled clip',72))}</strong><small>${item.issues.length?`${esc(item.issues.join(' · '))} needs attention`:'All export checks passed'}${item.confidence===null?'':` · transcript ${item.confidence}%`}</small><div>${qualityCheck('Captions',item.captionReady,item.captionReady?'Speech timing available':'Open captions and auto-sync')}${qualityCheck('Render',item.renderReady,item.renderReady?'Verified output':'Render again before posting')}${qualityCheck('Speaker',item.framingReady,item.framingReady?'Tracked':'Optional AI framing check')}${qualityCheck('Safety',item.safe,item.safe?'Clear':'Human check required')}</div></div><div class="dc-v6-quality-actions"><button class="dc-btn secondary" data-edit-video-clip="${esc(item.clip.id)}">Open editor</button>${!item.captionReady?`<button class="dc-btn" data-edit-clip="${esc(item.clip.id)}">Fix captions</button>`:!item.framingReady?`<button class="dc-btn" data-edit-video-clip="${esc(item.clip.id)}">Frame speaker</button>`:`<button class="dc-btn" data-review-clip="${esc(item.clip.id)}">Review</button>`}</div></article>`).join('');
  panel.innerHTML=`<div class="dc-v6-quality-page"><section class="dc-v6-quality-hero"><div><span class="dc-product-kicker">${ICON.quality} Quality Center</span><h1>Know what is safe to publish.</h1><p>One preflight for caption timing, transcript confidence, render verification, audio, active-speaker framing and grounded post metadata.</p><div class="dc-v6-quality-hero-actions"><button class="dc-btn" id="dcQualityRefresh">Run fresh checks</button><button class="dc-btn secondary" data-dc-nav="review">Open Review</button></div></div><div class="dc-v6-quality-score"><span style="--score:${average}"><b>${average}</b><em>studio quality</em></span><small>${ready} ready · ${needs} need attention</small></div></section>
    <section class="dc-v6-quality-metrics"><article><span>${ICON.check}</span><b>${ready}</b><em>publish ready</em></article><article><span>${ICON.warning}</span><b>${needs}</b><em>need a check</em></article><article><span>${ICON.canvas}</span><b>${framed}</b><em>speaker framed</em></article><article><span>${ICON.social}</span><b>${connected}/4</b><em>channels connected</em></article></section>
    <div class="dc-v6-quality-layout"><main><div class="dc-v6-quality-head"><div><small>Clip preflight</small><h2>Fix the weakest signal first.</h2><p>Scores are explainable and never override a required human review.</p></div><span class="dc-pill ${needs?'warn':'good'}">${needs?`${needs} to check`:'All clear'}</span></div><div class="dc-v6-quality-list">${rows||`<div class="dc-v6-quality-empty">${ICON.quality}<strong>No clips to inspect yet.</strong><p>Create a project and Quality Center will build a preflight automatically.</p><button class="dc-btn" data-dc-nav="home">Create clips</button></div>`}</div></main><aside><section class="dc-v6-preflight"><span>${ICON.publish}</span><small>Publishing preflight</small><h3>${esc(publishing.title)}</h3><p>${esc(publishing.copy)}</p>${qualityCheck('Account access',publishing.allowed,publishing.allowed?'Premium publishing is active':'Choose Premium to publish')}${qualityCheck('Connected channels',connected>0,connected?`${connected} ready`:'Connect at least one destination')}${qualityCheck('Human approval',true,'Nothing posts without your workflow')}<button class="dc-btn ${publishing.allowed?'secondary':''}" ${publishing.allowed?'data-dc-nav="publishing"':'data-open-billing'}>${publishing.allowed?'Manage channels':'View Premium'}</button></section><section class="dc-v6-quality-pro ${advanced?'unlocked':'locked'}"><span>${ICON.sparkles}</span><small>Studio quality controls</small><h3>${advanced?'AI repair tools unlocked':'Unlock active-speaker repair'}</h3><p>${advanced?'Use active-speaker framing, AI Director, Brand Kit vocabulary and clean exports on every clip.':exp.premium?'Your current plan includes clean exports, Brand Kit and publishing. Monthly and Yearly add active-speaker framing and AI Director.':'Premium adds clean exports and social publishing; Monthly and Yearly also add active-speaker framing and AI Director.'}</p><button class="dc-btn secondary" ${advanced?'data-dc-nav="lab"':'data-open-billing'}>${advanced?'Open AI Director':'Compare plans'}</button></section></aside></div>
  </div>`;
  $('#dcQualityRefresh')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Checking…';await refreshData();renderQualityCenter();notify('Quality checks refreshed','good')});
  requestAnimationFrame(()=>animatePanel(panel));
}"""

NEW_JS = """function qualityPrimaryIssue(item){
  const id=esc(item.clip.id);
  if(!item.captionReady)return{reason:\"Captions haven't been synced to the speech yet.\",button:`<button class="dc-btn" data-edit-clip="${id}">Fix captions</button>`};
  if(!item.renderReady)return{reason:\"This clip hasn't been rendered and verified yet.\",button:`<button class="dc-btn" data-edit-video-clip="${id}">Open editor</button>`};
  if(!item.audioReady)return{reason:\"Background audio hasn't been verified yet.\",button:`<button class="dc-btn" data-edit-video-clip="${id}">Open editor</button>`};
  if(!item.safe)return{reason:'This clip needs a quick human check before it can go out.',button:`<button class="dc-btn" data-review-clip="${id}">Review</button>`};
  if(!item.growthReady)return{reason:\"Title, description or hashtags haven't been generated yet.\",button:`<button class="dc-btn" data-edit-video-clip="${id}">Open editor</button>`};
  return{reason:'All checks passed.',button:''};
}
function qualityRow(item,isReady){
  const id=esc(item.clip.id),primary=isReady?null:qualityPrimaryIssue(item);
  return `<article class="dc-qc-row"><button class="dc-qc-thumb" data-edit-video-clip="${id}">${item.clip.thumbUrl?`<img src="${authedUrl(item.clip.thumbUrl)}" alt="${esc(item.clip.title||'Clip')} thumbnail">`:ICON.play}</button><div class="dc-qc-copy"><div class="dc-qc-title-row"><strong>${esc(shortText(item.clip.title||'Untitled clip',72))}</strong><span class="dc-pill ${isReady?'good':'warn'}">${isReady?'Good':'Needs review'}</span></div><p>${isReady?'All checks passed.':esc(primary.reason)}</p></div><div class="dc-qc-actions">${isReady?`<button class="dc-btn secondary" data-edit-video-clip="${id}">Open editor</button>`:primary.button}</div></article>`;
}
function renderQualityCenter(){
  const panel=$('#view-quality'),d=data();if(!panel||!d)return;const clips=d.clips||[];
  const assessed=clips.map(clip=>({clip,...qualityAssessment(clip)}));
  const blocked=assessed.filter(item=>item.issues.length).sort((a,b)=>b.issues.length-a.issues.length);
  const ready=assessed.filter(item=>!item.issues.length);
  const lists=`<section class="dc-qc-group"><div class="dc-qc-group-head"><h2>Ready to post</h2><span class="dc-pill good">${ready.length}</span></div><div class="dc-qc-list">${ready.length?ready.map(item=>qualityRow(item,true)).join(''):'<div class="dc-qc-empty">Nothing is fully clear yet — fix the items below first.</div>'}</div></section>
    <section class="dc-qc-group"><div class="dc-qc-group-head"><h2>Needs a fix</h2><span class="dc-pill ${blocked.length?'warn':'good'}">${blocked.length}</span></div><div class="dc-qc-list">${blocked.length?blocked.map(item=>qualityRow(item,false)).join(''):`<div class="dc-qc-empty">${ICON.check} Nothing is blocked.</div>`}</div></section>`;
  const empty=`<div class="dc-qc-empty dc-qc-empty-page">${ICON.quality}<strong>No clips to inspect yet.</strong><p>Create a project and Quality Center will build a preflight automatically.</p><button class="dc-btn" data-dc-nav="home">Create clips</button></div>`;
  panel.innerHTML=`<div class="dc-qc-page"><section class="dc-qc-hero"><div><span class="dc-product-kicker">${ICON.quality} Quality Center</span><h1>What can post right now.</h1><p>Everything ready to go out, and everything that's blocked with one reason and one fix.</p></div><button class="dc-btn" id="dcQualityRefresh">Run fresh checks</button></section>
    ${clips.length?lists:empty}
  </div>`;
  $('#dcQualityRefresh')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;button.textContent='Checking…';await refreshData();renderQualityCenter();notify('Quality checks refreshed','good')});
  requestAnimationFrame(()=>animatePanel(panel));
}"""

edit("src/public/activity-fix.js", OLD_JS, NEW_JS, "renderQualityCenter: single ready/blocked list, one reason + one button per row")


# ---------------------------------------------------------------------- CSS

CSS_PATH = ROOT / "src/public/studio-v6.css"
css_text = CSS_PATH.read_text()

CSS_BLOCK_ANCHOR_START = "body.dc-app .dc-v6-quality-page {"
if CSS_BLOCK_ANCHOR_START not in css_text:
    if "body.dc-app .dc-qc-page {" in css_text:
        skipped.append("CSS: dc-qc-* rules (already applied)")
        CSS_BLOCK_OLD = None
    else:
        sys.exit("CSS anchor for the Quality Center rules has moved — check studio-v6.css by hand before rerunning.")
else:
    CSS_BLOCK_OLD = css_text[css_text.index("body.dc-app .dc-v6-quality-page {"):css_text.index("body.dc-app .dc-v6-quality-empty {") + len(
        "body.dc-app .dc-v6-quality-empty { min-height:260px;display:grid;place-items:center;align-content:center;text-align:center;border:1px dashed var(--v6-line);border-radius:16px;color:var(--v6-muted); }.dc-v6-quality-empty>svg{width:35px;height:35px;margin-bottom:10px;color:var(--v6-green)}.dc-v6-quality-empty strong{color:#fff;font-size:13px}.dc-v6-quality-empty p{margin:4px 0 13px;font-size:9px}"
    )]

CSS_BLOCK_NEW = """body.dc-app .dc-qc-page { display:flex;flex-direction:column;gap:14px; }
body.dc-app .dc-qc-hero { display:flex;align-items:flex-end;justify-content:space-between;gap:16px;padding:24px;border:1px solid var(--v6-line);border-radius:22px;background:linear-gradient(155deg,var(--v6-panel-raised),var(--v6-panel-soft));box-shadow:var(--v6-shadow); }
body.dc-app .dc-qc-hero h1 { margin:9px 0 6px;font-size:clamp(28px,3.2vw,42px);line-height:1;letter-spacing:-.05em; }
body.dc-app .dc-qc-hero p { max-width:560px;margin:0;color:#9a9ca5;font-size:11px;line-height:1.6; }
body.dc-app .dc-qc-group { border:1px solid var(--v6-line);border-radius:20px;background:linear-gradient(155deg,var(--v6-panel-raised),var(--v6-panel-soft));box-shadow:var(--v6-shadow);padding:16px; }
body.dc-app .dc-qc-group-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:11px; }
body.dc-app .dc-qc-group-head h2 { margin:0;font-size:15px; }
body.dc-app .dc-qc-list { display:flex;flex-direction:column;gap:8px; }
body.dc-app .dc-qc-row { display:grid;grid-template-columns:60px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(0,0,0,.18); }
body.dc-app .dc-qc-thumb { width:60px;height:58px;border-radius:11px;overflow:hidden;background:#060607;color:#fff;display:grid;place-items:center; }.dc-qc-thumb img{width:100%;height:100%;object-fit:cover}
body.dc-app .dc-qc-copy { min-width:0; }
body.dc-app .dc-qc-title-row { display:flex;align-items:center;gap:8px;flex-wrap:wrap; }.dc-qc-title-row strong{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}
body.dc-app .dc-qc-copy p { margin:4px 0 0;color:var(--v6-muted);font-size:9px;line-height:1.5; }
body.dc-app .dc-qc-actions { display:flex;gap:6px;flex-shrink:0; }.dc-qc-actions .dc-btn{min-height:33px;padding:0 11px;font-size:8px}
body.dc-app .dc-qc-empty { padding:22px;text-align:center;color:var(--v6-muted);border:1px dashed var(--v6-line);border-radius:14px;font-size:10px; }
body.dc-app .dc-qc-empty-page { min-height:220px;display:grid;place-items:center;align-content:center; }.dc-qc-empty-page>svg{width:35px;height:35px;margin-bottom:10px;color:var(--v6-green)}.dc-qc-empty-page strong{color:#fff;font-size:13px;display:block;margin-bottom:4px}.dc-qc-empty-page p{margin:0 0 13px}"""

if CSS_BLOCK_OLD is not None:
    if css_text.count(CSS_BLOCK_OLD) != 1:
        sys.exit(f"CSS anchor block is not unique ({css_text.count(CSS_BLOCK_OLD)}x). Aborting.")
    CSS_PATH.write_text(css_text.replace(CSS_BLOCK_OLD, CSS_BLOCK_NEW))
    changed.append("CSS: replaced dc-v6-quality-* rules with dc-qc-* rules")

# Responsive rules referencing the old class names.
DEAD_1320 = (
    "  body.dc-app .dc-v6-quality-layout { grid-template-columns:1fr; }\n"
    "  body.dc-app .dc-v6-quality-layout>aside { display:grid;grid-template-columns:1fr 1fr; }\n"
)
css_text = CSS_PATH.read_text()
if DEAD_1320 in css_text:
    CSS_PATH.write_text(css_text.replace(DEAD_1320, ""))
    changed.append("CSS: drop the old two-column quality layout breakpoint (page is single-column now)")
else:
    skipped.append("CSS: drop the old two-column quality layout breakpoint (already applied)")

edit(
    "src/public/studio-v6.css",
    "  body.dc-app .dc-v6-quality-hero { grid-template-columns:1fr; }\n"
    "  body.dc-app .dc-v6-quality-score { display:none; }\n"
    "  body.dc-app .dc-v6-quality-row { grid-template-columns:66px minmax(0,1fr); }\n"
    "  body.dc-app .dc-v6-quality-thumb { width:66px;height:70px; }\n"
    "  body.dc-app .dc-v6-quality-actions { grid-column:1/-1;justify-content:flex-end; }\n",
    "  body.dc-app .dc-qc-row { grid-template-columns:66px minmax(0,1fr); }\n"
    "  body.dc-app .dc-qc-thumb { width:66px;height:70px; }\n"
    "  body.dc-app .dc-qc-actions { grid-column:1/-1;justify-content:flex-end; }\n",
    "CSS: 980px breakpoint uses dc-qc-* row layout",
)

edit(
    "src/public/studio-v6.css",
    "  body.dc-app .dc-v6-quality-metrics { grid-template-columns:1fr 1fr; }\n"
    "  body.dc-app .dc-v6-quality-layout>aside { grid-template-columns:1fr; }\n"
    "  body.dc-app .dc-v6-quality-hero { padding:22px 18px;min-height:0; }\n"
    "  body.dc-app .dc-v6-quality-hero h1 { font-size:36px; }\n"
    "  body.dc-app .dc-v6-quality-layout>main { padding:12px; }\n"
    "  body.dc-app .dc-v6-quality-row { grid-template-columns:54px minmax(0,1fr); }.dc-v6-quality-thumb{width:54px!important;height:62px!important}.dc-v6-quality-copy>div{display:none!important}\n",
    "  body.dc-app .dc-qc-hero { padding:20px 16px;min-height:0;flex-direction:column;align-items:flex-start;gap:12px; }\n"
    "  body.dc-app .dc-qc-hero h1 { font-size:30px; }\n"
    "  body.dc-app .dc-qc-row { grid-template-columns:54px minmax(0,1fr); }.dc-qc-thumb{width:54px!important;height:62px!important}.dc-qc-actions{grid-column:1/-1;justify-content:flex-end}\n",
    "CSS: 760px breakpoint uses dc-qc-* rules, hero stacks",
)

print("patch15 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
