#!/usr/bin/env python3
r"""
Make the template picker a dropdown, and kill the doubled preview badge.

TWO PROBLEMS, BOTH VISIBLE IN THE SCREENSHOT
--------------------------------------------
1. The template gallery was an always-open horizontal strip. In OpusClip the
   picker is a compact control in the top bar that opens a panel on click,
   so the editor and the preview own the screen. Seven permanently-visible
   190px cards pushed the actual settings below the fold and made the page
   look like a gallery rather than an editor.

2. Two badges were stacked on the stage. templatePreviewMarkup() already
   draws its own "Sample preview" pill, and patch24 added a second
   "Preview" pill on top of it — they overlap, which is the smeared
   double-label in the top-left of the large preview.

WHAT THIS DOES
--------------
- Replaces the <select> and the strip with a single dropdown: the top bar
  shows the current template name, and clicking it opens a panel listing
  every template plus "New template". Closes on selection, Escape, or a
  click outside.
- Drops the duplicate badge from both the initial render and
  styleStudioPaint(), so the stage carries exactly one label.
- Rebuilds the template rows as compact menu entries: small 9:16 thumbnail,
  name, built-in/custom, default flag, and the same More actions. The
  is-editing and dc-style-flag hooks are kept so the existing tests still
  cover them.

Run from your repo root:

    python3 patch28/apply.py
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
    if new and new in text and old not in text:
        skipped.append(f"{label} (already applied)")
        return
    if old not in text:
        sys.exit(f"ANCHOR NOT FOUND for '{label}'.\nExpected:\n{old[:260]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ------------------------------------------------- 1. compact menu row card
OLD_CARD = """function styleTemplateCard(t,sourcePreview){
  const editing=t.id===styleStudio.baseId, isDefault=data()?.selectedTemplate?.id===t.id;
  const swatches=[t.captionPrimary,t.captionHighlight,t.watermarkColor,t.brandLineColor].filter(Boolean).slice(0,4);
  const more=`<details class="dc-clip-more"><summary>More</summary><div><button data-duplicate-template="${esc(t.id)}">Duplicate</button>${isDefault?'':`<button data-use-template="${esc(t.id)}">Use for new clips</button>`}${t.builtIn?'':`<button class="danger" data-delete-template="${esc(t.id)}">Delete</button>`}</div></details>`;
  return `<article class="dc-style-card ${editing?'is-editing':''}"><button type="button" class="dc-style-card-art" data-style-open="${esc(t.id)}" aria-label="Edit ${esc(t.name||'template')}">${templatePreviewMarkup(t,sourcePreview)}</button><div class="dc-style-card-foot"><div><strong>${esc(shortText(t.name||'Untitled',22))}</strong><small>${t.builtIn?'Built-in':'Custom'}${isDefault?' · default':''}</small></div><span class="dc-style-swatches">${swatches.map(c=>`<i style="background:${esc(templateSafeColor(c))}"></i>`).join('')}</span></div><div class="dc-style-card-row">${isDefault?'<b class="dc-style-flag">Default</b>':''}${more}</div></article>`;
}"""

NEW_CARD = """function styleTemplateCard(t,sourcePreview){
  const editing=t.id===styleStudio.baseId, isDefault=data()?.selectedTemplate?.id===t.id;
  const swatches=[t.captionPrimary,t.captionHighlight,t.watermarkColor,t.brandLineColor].filter(Boolean).slice(0,4);
  const more=`<details class="dc-clip-more"><summary>More</summary><div><button data-duplicate-template="${esc(t.id)}">Duplicate</button>${isDefault?'':`<button data-use-template="${esc(t.id)}">Use for new clips</button>`}${t.builtIn?'':`<button class="danger" data-delete-template="${esc(t.id)}">Delete</button>`}</div></details>`;
  return `<div class="dc-style-row ${editing?'is-editing':''}"><button type="button" class="dc-style-row-main" data-style-open="${esc(t.id)}" aria-label="Edit ${esc(t.name||'template')}"><span class="dc-style-row-art">${templatePreviewMarkup(t,sourcePreview)}</span><span class="dc-style-row-copy"><strong>${esc(shortText(t.name||'Untitled',26))}</strong><small>${t.builtIn?'Built-in':'Custom'}</small></span><span class="dc-style-swatches">${swatches.map(c=>`<i style="background:${esc(templateSafeColor(c))}"></i>`).join('')}</span>${isDefault?'<b class="dc-style-flag">Default</b>':''}</button>${more}</div>`;
}"""

edit(JS, OLD_CARD, NEW_CARD, "template card becomes a compact dropdown row")


# ------------------------------------------------------- 2. top bar dropdown
OLD_BAR = """      <select id="dcStyleSwitch" aria-label="Choose template">${templates.map(t=>`<option value="${esc(t.id)}" ${t.id===base.id?'selected':''}>${esc(t.name||'Untitled')}${d.selectedTemplate?.id===t.id?' · default':''}</option>`).join('')}</select>"""
NEW_BAR = """      <div class="dc-style-picker ${styleStudio.menuOpen?'is-open':''}"><button type="button" id="dcStyleSwitch" class="dc-style-switch" aria-haspopup="true" aria-expanded="${styleStudio.menuOpen?'true':'false'}"><span>${esc(shortText(base.name||'Untitled',26))}${d.selectedTemplate?.id===base.id?' · default':''}</span>${ICON.chevron}</button>${styleStudio.menuOpen?`<div class="dc-style-menu" id="dcStyleMenu"><button type="button" class="dc-style-new" id="dcStyleNew"><span>+</span>New template</button><div class="dc-style-menu-list">${templates.map(t=>styleTemplateCard(t,sourcePreview)).join('')}</div></div>`:''}</div>"""
edit(JS, OLD_BAR, NEW_BAR, "top bar: dropdown picker instead of a select")

OLD_STRIP = """    <div class="dc-style-strip"><button type="button" class="dc-style-new" id="dcStyleNew"><span>+</span><small>New template</small></button>${templates.map(t=>styleTemplateCard(t,sourcePreview)).join('')}</div>
"""
edit(JS, OLD_STRIP, "", "remove the always-open template strip")


# ------------------------------------------------- 3. one badge, not two
edit(
    JS,
    """<div class="dc-style-stage-frame">${templatePreviewMarkup(draft,sourcePreview,true)}<span class="dc-style-demo">Preview</span></div>""",
    """<div class="dc-style-stage-frame">${templatePreviewMarkup(draft,sourcePreview,true)}</div>""",
    "stage: drop the duplicate preview badge",
)
edit(
    JS,
    """  frame.innerHTML=`${templatePreviewMarkup(styleStudio.draft,sourcePreview,true)}<span class="dc-style-demo">Preview</span>`;""",
    """  frame.innerHTML=templatePreviewMarkup(styleStudio.draft,sourcePreview,true);""",
    "repaint: drop the duplicate preview badge",
)


# ------------------------------------------------------------ 4. menu wiring
OLD_WIRE = """  $('#dcStyleSwitch')?.addEventListener('change',event=>{const next=templates.find(t=>t.id===event.target.value);if(next){styleStudioLoad(next);renderTemplatesPage()}});"""
NEW_WIRE = """  $('#dcStyleSwitch')?.addEventListener('click',event=>{event.stopPropagation();styleStudio.menuOpen=!styleStudio.menuOpen;renderTemplatesPage()});
  if(styleStudio.menuOpen){
    // Close on an outside click or Escape, the way every other menu here does.
    const dismiss=event=>{if(event.target.closest?.('.dc-style-picker'))return;styleStudio.menuOpen=false;document.removeEventListener('click',dismiss);renderTemplatesPage()};
    const escape=event=>{if(event.key!=='Escape')return;styleStudio.menuOpen=false;document.removeEventListener('keydown',escape);renderTemplatesPage()};
    setTimeout(()=>{document.addEventListener('click',dismiss);document.addEventListener('keydown',escape)},0);
  }"""
edit(JS, OLD_WIRE, NEW_WIRE, "wire the dropdown open/close")

edit(
    JS,
    """  $$('[data-style-open]',panel).forEach(button=>button.addEventListener('click',()=>{const next=templates.find(t=>t.id===button.dataset.styleOpen);if(next){styleStudioLoad(next);renderTemplatesPage()}}));""",
    """  $$('[data-style-open]',panel).forEach(button=>button.addEventListener('click',()=>{const next=templates.find(t=>t.id===button.dataset.styleOpen);if(next){styleStudioLoad(next);styleStudio.menuOpen=false;renderTemplatesPage()}}));""",
    "selecting a template closes the menu",
)

edit(
    JS,
    "const styleStudio={draft:null,baseId:'',group:'',history:[],index:-1,dirty:false};",
    "const styleStudio={draft:null,baseId:'',group:'',history:[],index:-1,dirty:false,menuOpen:false};",
    "track menu state",
)
edit(
    JS,
    "  styleStudio.history=[clone(template)];styleStudio.index=0;styleStudio.dirty=false;styleStudio.group='';",
    "  styleStudio.history=[clone(template)];styleStudio.index=0;styleStudio.dirty=false;styleStudio.group='';styleStudio.menuOpen=false;",
    "loading a template closes the menu",
)


# ---------------------------------------------------------------------- CSS
css = CSS.read_text()
start = css.index("body.dc-app .dc-style-strip {")
end = css.index("body.dc-app .dc-style-workspace {")
CSS_NEW = """body.dc-app .dc-style-picker { position:relative; }
body.dc-app .dc-style-switch { display:flex;align-items:center;justify-content:space-between;gap:9px;width:100%;height:38px;padding:0 11px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#09090b;color:var(--v6-text);font-size:10px; }
body.dc-app .dc-style-switch:hover { border-color:rgba(224,186,117,.38); }
body.dc-app .dc-style-switch span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-style-switch svg { width:13px;height:13px;flex-shrink:0;opacity:.55;fill:none;stroke:currentColor; }
body.dc-app .dc-style-picker.is-open .dc-style-switch { border-color:var(--v6-gold);background:#101015; }
body.dc-app .dc-style-menu { position:absolute;z-index:60;top:44px;left:0;width:min(330px,86vw);max-height:min(430px,60vh);overflow-y:auto;display:grid;gap:6px;padding:9px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:#15161c;box-shadow:0 26px 60px rgba(0,0,0,.55); }
body.dc-app .dc-style-menu-list { display:grid;gap:5px; }
body.dc-app .dc-style-new { display:flex;align-items:center;gap:9px;width:100%;min-height:40px;padding:0 10px;border:1px dashed rgba(255,255,255,.16);border-radius:12px;color:var(--v6-muted);font-size:9.5px;text-align:left; }
body.dc-app .dc-style-new span { font-size:15px;line-height:1; }
body.dc-app .dc-style-new:hover { border-color:rgba(224,186,117,.45);color:var(--v6-gold); }
body.dc-app .dc-style-row { position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center;border:1px solid transparent;border-radius:12px;transition:.16s; }
body.dc-app .dc-style-row:hover { border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.03); }
body.dc-app .dc-style-row.is-editing { border-color:rgba(224,186,117,.45);background:rgba(224,186,117,.08); }
body.dc-app .dc-style-row-main { display:grid;grid-template-columns:34px minmax(0,1fr) auto auto;gap:9px;align-items:center;padding:7px;color:var(--v6-text);text-align:left; }
body.dc-app .dc-style-row-art { position:relative;display:block;width:34px;height:50px;overflow:hidden;border-radius:7px;border:1px solid rgba(255,255,255,.10);background:#060607; }
body.dc-app .dc-style-row-art .dc-style-phone { position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;box-shadow:none; }
body.dc-app .dc-style-row-art .dc-style-sample-badge,body.dc-app .dc-style-row-art .dc-style-watermark { display:none; }
body.dc-app .dc-style-row-copy { min-width:0; }
body.dc-app .dc-style-row-copy strong { display:block;font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-style-row-copy small { display:block;margin-top:2px;color:var(--v6-muted);font-size:7.5px; }
body.dc-app .dc-style-swatches { display:flex;gap:3px; }
body.dc-app .dc-style-swatches i { width:8px;height:8px;border-radius:3px;border:1px solid rgba(255,255,255,.16); }
body.dc-app .dc-style-flag { padding:3px 6px;border-radius:999px;background:rgba(104,213,157,.18);color:#8fe6bb;font-size:6.5px;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap; }
body.dc-app .dc-style-row .dc-clip-more { margin-right:6px; }
"""
CSS.write_text(css[:start] + CSS_NEW + css[end:])
changed.append("CSS: dropdown picker replaces the strip")

# The stage badge rule is dead now that the duplicate span is gone.
css = CSS.read_text()
css = re.sub(r"body\.dc-app \.dc-style-demo \{[^}]*\}\n", "", css)
CSS.write_text(css)

js = JS.read_text()
if "dc-style-demo" in js:
    sys.exit("The duplicate preview badge is still rendered somewhere.")
names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")
for ident in ("dcStyleSwitch", "dcStyleNew", "dcStyleUndo", "dcStyleRedo", "dcStyleRevert", "dcStyleSave"):
    if ident not in js:
        sys.exit(f"Control id '{ident}' disappeared.")

print("patch28 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNext:\n  npm run check && npm test\n")
