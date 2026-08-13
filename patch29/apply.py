#!/usr/bin/env python3
r"""
Let template captions be dragged and resized on the preview, like the editor.

THE ASK
-------
"you should be able for the templates to move captions and resize like the
editor does" — the studio only exposed caption position and size as three
sliders, which is a poor way to place text on a frame.

WHY IT REUSES THE EDITOR'S MODEL
--------------------------------
bindCaptionDrag() already solves this for the clip editor: pointer capture,
a bottom-right corner hit test for resize versus move, snap points at 25 /
50 / 75 percent with a 2.5 percent threshold, and guide lines while
dragging. Both surfaces write the same template fields — captionPositionX,
captionPositionY and captionFontSize — so the studio uses the same
constants and the same gestures rather than inventing a second feel.

Two differences the stage requires:
  - The editor drags a standalone overlay element. The stage's caption is
    inside the generated preview, so the drag mutates inline styles live and
    only commits to the draft on pointerup.
  - The preview scales caption size down for display
    (captionFontSize / 3.1, clamped 20-38). Resizing applies that same
    formula while dragging so the specimen matches what the field will be.

Committing on pointerup rather than on every move means one undo step per
drag, not sixty.

Run from your repo root:

    python3 patch29/apply.py
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
        sys.exit(f"ANCHOR NOT FOUND for '{label}'.\nExpected:\n{old[:260]}\n\nNothing written.")
    if outstanding != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({outstanding}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ---------------------------------------------------- stage markup + binding
edit(
    JS,
    "function styleStudioPaint(sourcePreview){",
    """function styleStageInner(sourcePreview){
  return `${templatePreviewMarkup(styleStudio.draft,sourcePreview,true)}<i class="dc-style-guide v" data-style-guide="v"></i><i class="dc-style-guide h" data-style-guide="h"></i>`;
}
function bindStyleCaptionDrag(sourcePreview){
  const frame=$('.dc-style-stage-frame');if(!frame||!styleStudio.draft)return;
  const caption=frame.querySelector('.dc-style-caption');if(!caption)return;
  const guideV=frame.querySelector('[data-style-guide="v"]'),guideH=frame.querySelector('[data-style-guide="h"]');
  // Same snap behaviour as the clip editor so the two surfaces feel identical.
  const snapPoints=[25,50,75],snapDistance=2.5;
  const showGuide=(guide,value,vertical)=>{if(!guide)return;guide.classList.add('show');guide.style[vertical?'left':'top']=`${value}%`};
  const hideGuides=()=>{guideV?.classList.remove('show');guideH?.classList.remove('show')};
  const previewSize=value=>clamp(Number(value||82)/3.1,20,38);
  let drag=null;
  caption.onpointerdown=event=>{
    if(event.button!==undefined&&event.button!==0)return;
    const box=caption.getBoundingClientRect(),rect=frame.getBoundingClientRect();
    const mode=(event.clientX>=box.right-20&&event.clientY>=box.bottom-20)?'resize':'move';
    drag={mode,pointerId:event.pointerId,startClientX:event.clientX,startClientY:event.clientY,
      startX:Number(styleStudio.draft.captionPositionX??50),startY:Number(styleStudio.draft.captionPositionY??58),
      startSize:Number(styleStudio.draft.captionFontSize||96),rect,x:Number(styleStudio.draft.captionPositionX??50),
      y:Number(styleStudio.draft.captionPositionY??58),size:Number(styleStudio.draft.captionFontSize||96)};
    caption.classList.add(mode==='resize'?'is-resizing':'is-dragging');
    caption.setPointerCapture?.(event.pointerId);event.preventDefault();event.stopPropagation();
  };
  caption.onpointermove=event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(drag.mode==='resize'){
      const delta=(event.clientX-drag.startClientX+event.clientY-drag.startClientY)/2;
      drag.size=clamp(drag.startSize+delta/Math.max(1,drag.rect.height)*260,24,160);
      caption.style.fontSize=`${previewSize(drag.size)}px`;
      return;
    }
    let x=drag.startX+(event.clientX-drag.startClientX)/Math.max(1,drag.rect.width)*100;
    let y=drag.startY+(event.clientY-drag.startClientY)/Math.max(1,drag.rect.height)*100;
    hideGuides();
    for(const point of snapPoints){if(Math.abs(x-point)<=snapDistance){x=point;showGuide(guideV,point,true);break}}
    for(const point of snapPoints){if(Math.abs(y-point)<=snapDistance){y=point;showGuide(guideH,point,false);break}}
    drag.x=clamp(x,8,92);drag.y=clamp(y,12,88);
    caption.style.left=`${drag.x}%`;caption.style.top=`${drag.y}%`;
  };
  const finish=event=>{
    if(!drag||(event&&event.pointerId!==undefined&&event.pointerId!==drag.pointerId))return;
    const {mode,x,y,size}=drag;drag=null;hideGuides();
    caption.classList.remove('is-dragging','is-resizing');
    // One history entry per gesture, not one per pointermove.
    if(mode==='resize')styleStudio.draft.captionFontSize=Math.round(size);
    else{styleStudio.draft.captionPositionX=Math.round(x);styleStudio.draft.captionPositionY=Math.round(y)}
    styleStudioPush();
    renderTemplatesPage();
  };
  caption.onpointerup=finish;caption.onpointercancel=finish;
}
function styleStudioPaint(sourcePreview){""",
    "add styleStageInner() and bindStyleCaptionDrag()",
)

edit(
    JS,
    "  frame.innerHTML=templatePreviewMarkup(styleStudio.draft,sourcePreview,true);",
    "  frame.innerHTML=styleStageInner(sourcePreview);\n  bindStyleCaptionDrag(sourcePreview);",
    "repaint: keep guides and rebind the drag",
)

edit(
    JS,
    """<div class="dc-style-stage-frame">${templatePreviewMarkup(draft,sourcePreview,true)}</div><p class="dc-style-stage-note">Sample caption over your own footage. New clips use this look once saved.</p>""",
    """<div class="dc-style-stage-frame">${styleStageInner(sourcePreview)}</div><p class="dc-style-stage-note">Drag the caption to move it · drag its bottom-right corner to resize</p>""",
    "stage: render guides and tell people the caption is draggable",
)

edit(
    JS,
    "  const threadEl=$('#dcDirectorThread');if(threadEl)threadEl.scrollTop=threadEl.scrollHeight;\n  requestAnimationFrame(()=>animatePanel(panel));\n}\nfunction styleStageInner",
    "  const threadEl=$('#dcDirectorThread');if(threadEl)threadEl.scrollTop=threadEl.scrollHeight;\n  requestAnimationFrame(()=>animatePanel(panel));\n}\nfunction styleStageInner",
    "(no-op ordering check)",
) if False else None

# Bind on first render too.
edit(
    JS,
    "  const controls=$('#dcStyleControls');\n  if(controls){",
    "  bindStyleCaptionDrag(sourcePreview);\n  const controls=$('#dcStyleControls');\n  if(controls){",
    "bind the drag on first render",
)


# ---------------------------------------------------------------------- CSS
CSS_ANCHOR = "/* Clip Styles studio"
CSS_BLOCK = """body.dc-app .dc-style-stage-frame .dc-style-caption { cursor:grab;touch-action:none;outline:1px dashed rgba(255,255,255,.28);outline-offset:3px; }
body.dc-app .dc-style-stage-frame .dc-style-caption::after { content:'';position:absolute;right:-6px;bottom:-6px;width:13px;height:13px;border-radius:50%;border:2px solid #fff;background:rgba(4,5,7,.7);box-shadow:0 2px 6px rgba(0,0,0,.5);cursor:nwse-resize; }
body.dc-app .dc-style-stage-frame .dc-style-caption:hover { outline-color:rgba(224,186,117,.75); }
body.dc-app .dc-style-stage-frame .dc-style-caption.is-dragging { cursor:grabbing;outline-color:var(--v6-gold); }
body.dc-app .dc-style-stage-frame .dc-style-caption.is-resizing { outline-color:var(--v6-gold); }
body.dc-app .dc-style-guide { position:absolute;z-index:8;opacity:0;background:rgba(224,186,117,.85);pointer-events:none;transition:opacity .12s ease; }
body.dc-app .dc-style-guide.v { top:0;bottom:0;width:1px;transform:translateX(-.5px); }
body.dc-app .dc-style-guide.h { left:0;right:0;height:1px;transform:translateY(-.5px); }
body.dc-app .dc-style-guide.show { opacity:1; }

"""
css_text = CSS.read_text()
if "dc-style-guide" in css_text:
    skipped.append("CSS: caption drag affordances (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: caption drag affordances and snap guides")
else:
    sys.exit("CSS anchor not found in studio-v6.css. Nothing written.")

js = JS.read_text()
names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")
for needed in ("bindStyleCaptionDrag", "styleStageInner", "captionPositionX", "captionFontSize"):
    if needed not in js:
        sys.exit(f"'{needed}' missing after patch.")

print("patch29 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNext:\n  npm run check && npm test\n")
