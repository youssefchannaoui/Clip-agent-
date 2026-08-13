#!/usr/bin/env python3
"""
Redesign Brand Kit. "looks way too complicated, redo".

WHY IT FELT COMPLICATED
------------------------
It wasn't the number of controls, it was that two unrelated jobs shared one
undifferentiated form:

  1. what the export LOOKS like  — show watermark, text, position, colour,
     opacity, accent line, accent colour                      (7 controls)
  2. how the AI WRITES for you   — vocabulary, audience, goal, tone,
     avoid phrases                                            (5 controls)

Twelve inputs in one flat run, with a mid-form sub-heading doing all the
work of separating them, then a three-item marketing ribbon underneath
("Server enforced", "One global identity", "Platform aware") that belongs on
the pricing page, not on a settings screen the owner sees every week.

WHAT CHANGES
------------
Two Settings sections with their own icon, kicker and heading — Watermark
(with the live phone preview sitting next to the controls that drive it) and
"How AI writes for you". Same twelve controls, now in two groups of seven
and five, each next to the preview or explanation that makes it meaningful.
The marketing ribbon is gone.

PRESERVED EXACTLY — saveBrandKit() reads these by name off the form, and
paint() drives the live preview from them, so all of it must survive:
  form id  dcBrandForm
  names    watermarkEnabled watermarkText watermarkPosition watermarkColor
           watermarkOpacity brandLineEnabled brandLineColor brandVocabulary
           audience contentGoal brandTone avoidPhrases
  ids      dcBrandPreviewMark dcBrandPreviewLine dcBrandOpacityValue
           dcBrandUpgrade
Both sections stay inside the single <form>, so one Save still submits
everything.

Run from your repo root:

    python3 patch21/apply.py
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

js = JS.read_text()

MARKER = '<div class="dc-brand-page">'
if MARKER not in js:
    if 'class="dc-settings-hub dc-brand-page"' in js:
        skipped.append("renderBrandKit(): two-section layout (already applied)")
    else:
        sys.exit("Could not find the Brand Kit markup. Nothing written.")
else:
    start = js.index("  panel.innerHTML=`<div class=\"dc-brand-page\">")
    end = js.index("  const form=$('#dcBrandForm');", start)
    old_markup = js[start:end]
    for required in ("dcBrandPreviewMark", "watermarkOpacity", "avoidPhrases"):
        if required not in old_markup:
            sys.exit(f"Sliced Brand Kit markup is missing {required} — aborting rather than guessing.")

    NEW_MARKUP = """  const positions=[['top-left','Top left'],['top-center','Top centre'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom centre'],['bottom-right','Bottom right']];
  const options=(list,current)=>list.map(([v,l])=>`<option value="${v}" ${String(current)===v?'selected':''}>${l}</option>`).join('');
  const lock=premium?'':'is-locked',dis=premium?'':'disabled';
  panel.innerHTML=`<div class="dc-settings-hub dc-brand-page">
    <section class="dc-settings-command"><div><span class="dc-settings-kicker">${ICON.brand} Brand Kit <b class="dc-inline-pro">PRO</b></span><h1>Make every clip unmistakably yours.</h1><p>Set it once. Every render, rerender and generated clip uses it.</p></div><div class="dc-settings-command-status"><span class="${premium?'on':''}"><i>${premium?ICON.check:ICON.warning}</i><b>${premium?'Premium':'Free plan'}</b><em>${premium?'full control':'mark required'}</em></span><span class="${enabled?'on':''}"><i>${ICON.brand}</i><b>${enabled?'Watermark on':'Watermark off'}</b><em>on exports</em></span><span class="${brand.brandLineEnabled&&premium?'on':''}"><i>${ICON.style}</i><b>${brand.brandLineEnabled&&premium?'Accent on':'Accent off'}</b><em>colour line</em></span></div></section>
    ${premium?'':`<div class="dc-brand-entitlement free"><span>${ICON.warning}</span><div><strong>Free exports stay branded</strong><p>Every free render includes “DEENCLIPPED”. Upgrade to switch it off or use your own name.</p></div><button class="dc-btn" id="dcBrandUpgrade">Unlock branding</button></div>`}
    <form id="dcBrandForm" class="dc-brand-form-shell">
      <section class="dc-settings-section"><header><span>${ICON.brand}</span><div><small>Appearance</small><h2>Watermark</h2></div><b>${premium?'Editable':'Locked'}</b></header>
        <div class="dc-brand-split">
          <div class="dc-brand-preview-card"><div class="dc-brand-phone"><img src="/marketing-assets/reel-beneficial.webp" alt="Watermark preview"><span class="dc-brand-watermark ${enabled?'':'off'}" id="dcBrandPreviewMark" style="--brand-color:${esc(brand.watermarkColor||'#D9B478')};--brand-opacity:${Number(brand.watermarkOpacity||88)/100}" data-position="${esc(brand.watermarkPosition||'top-center')}">${esc(text)}</span><i id="dcBrandPreviewLine" class="${brand.brandLineEnabled&&premium?'on':''}" style="--brand-color:${esc(brand.brandLineColor||'#D9B478')}"></i></div><small>Updates as you edit</small></div>
          <div class="dc-brand-fields">
            <label class="dc-switch-row wide"><span><strong>Show watermark</strong><span>${required?'Required on the free plan':'On every new render'}</span></span><input type="checkbox" name="watermarkEnabled" ${enabled?'checked':''} ${required?'disabled':''}></label>
            <label class="wide">Watermark text<input name="watermarkText" maxlength="60" value="${esc(text)}" ${dis}></label>
            <label class="${lock}">Position<select name="watermarkPosition" ${dis}>${options(positions,premium?(brand.watermarkPosition||'top-center'):'top-center')}</select></label>
            <label class="${lock}">Colour<input name="watermarkColor" type="color" value="${esc(premium?(brand.watermarkColor||'#D9B478'):'#D9B478')}" ${dis}></label>
            <label class="wide ${lock}">Opacity <b id="dcBrandOpacityValue">${premium?Number(brand.watermarkOpacity||88):88}%</b><input name="watermarkOpacity" type="range" min="20" max="100" step="1" value="${premium?Number(brand.watermarkOpacity||88):88}" ${dis}></label>
            <label class="dc-switch-row wide ${lock}"><span><strong>Accent line</strong><span>A colour edge on every clip</span></span><input type="checkbox" name="brandLineEnabled" ${brand.brandLineEnabled&&premium?'checked':''} ${dis}></label>
            <label class="wide ${lock}">Accent colour<input name="brandLineColor" type="color" value="${esc(brand.brandLineColor||'#D9B478')}" ${dis}></label>
          </div>
        </div></section>
      <section class="dc-settings-section violet"><header><span>${ICON.sparkles}</span><div><small>Language</small><h2>How AI writes for you</h2></div><b>${premium?'Premium':'Locked'}</b></header>
        <div class="dc-brand-fields wide-grid">
          <label class="wide ${lock}">Names and specialist vocabulary<textarea name="brandVocabulary" rows="3" maxlength="1200" placeholder="Speaker names, Arabic terms, series names…" ${dis}>${esc((brand.brandVocabulary||[]).join(', '))}</textarea></label>
          <label class="${lock}">Audience<select name="audience" ${dis}>${options([['general','General audience'],['new-muslims','New Muslims'],['students','Students'],['families','Families'],['creators','Creators']],brand.audience||'general')}</select></label>
          <label class="${lock}">Primary goal<select name="contentGoal" ${dis}>${options([['education','Education'],['growth','Growth'],['community','Community'],['reflection','Reflection']],brand.contentGoal||'education')}</select></label>
          <label class="${lock}">Tone<select name="brandTone" ${dis}>${options([['respectful','Respectful'],['warm','Warm'],['direct','Direct'],['reflective','Reflective']],brand.brandTone||'respectful')}</select></label>
          <label class="${lock}">Avoid phrases<input name="avoidPhrases" maxlength="600" placeholder="Clickbait phrases to avoid" value="${esc((brand.avoidPhrases||[]).join(', '))}" ${dis}></label>
        </div>
        <p class="dc-brand-note">Quoted wording is never rewritten — this only shapes titles and descriptions.</p></section>
      <div class="dc-brand-save"><button class="dc-btn" type="submit">Save Brand Kit</button></div>
    </form>
  </div>`;
"""
    JS.write_text(js[:start] + NEW_MARKUP + js[end:])
    changed.append("renderBrandKit(): split into Watermark and AI-language sections")


# ---------------------------------------------------------------------- CSS

CSS_ANCHOR = "/* Consistent screen language across the existing, already-functional views. */"
CSS_BLOCK = """/* Brand Kit — two grouped sections inside one form. */
body.dc-app .dc-brand-page { display:grid;gap:16px; }
body.dc-app .dc-brand-form-shell { display:grid;gap:16px; }
body.dc-app .dc-brand-split { display:grid;grid-template-columns:266px minmax(0,1fr);gap:18px;padding:18px 20px;align-items:start; }
body.dc-app .dc-brand-preview-card { display:grid;justify-items:center;gap:9px;padding:15px;border:1px solid rgba(255,255,255,.065);border-radius:18px;background:rgba(2,2,4,.26); }
body.dc-app .dc-brand-preview-card small { color:var(--v6-muted);font-size:8.5px; }
body.dc-app .dc-brand-fields { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-content:start; }
body.dc-app .dc-brand-fields.wide-grid { padding:18px 20px; }
body.dc-app .dc-brand-fields .wide { grid-column:1/-1; }
body.dc-app .dc-brand-fields label { display:grid;gap:6px;color:var(--v6-muted);font-size:9px; }
body.dc-app .dc-brand-fields input:not([type=checkbox]):not([type=range]):not([type=color]),body.dc-app .dc-brand-fields select,body.dc-app .dc-brand-fields textarea {
  width:100%;min-height:40px;padding:10px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:#09090b;color:var(--v6-text);font-size:10px;
}
body.dc-app .dc-brand-fields input[type=color] { width:100%;height:40px;padding:3px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:#09090b; }
body.dc-app .dc-brand-fields textarea { resize:vertical;line-height:1.55; }
body.dc-app .dc-brand-fields .dc-switch-row { border-radius:14px; }
body.dc-app .dc-brand-fields .is-locked { opacity:.55; }
body.dc-app .dc-brand-note { margin:0;padding:0 20px 18px;color:var(--v6-muted);font-size:8.5px; }
body.dc-app .dc-brand-entitlement.free { display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:13px;align-items:center;padding:15px 18px;border:1px solid rgba(224,186,117,.20);border-radius:18px;background:rgba(224,186,117,.055); }
body.dc-app .dc-brand-entitlement.free>span { width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(224,186,117,.10);color:var(--v6-gold); }
body.dc-app .dc-brand-entitlement.free svg { width:20px;height:20px;fill:none;stroke:currentColor; }
body.dc-app .dc-brand-entitlement.free strong { font-size:11.5px; }
body.dc-app .dc-brand-entitlement.free p { margin:4px 0 0;color:var(--v6-muted);font-size:9px;line-height:1.5; }
body.dc-app .dc-brand-save { display:flex;justify-content:flex-end; }
body.dc-app .dc-brand-save .dc-btn { min-height:42px;padding:0 26px; }
@media (max-width:900px) {
  body.dc-app .dc-brand-split { grid-template-columns:1fr; }
  body.dc-app .dc-brand-preview-card { justify-self:center;width:100%;max-width:300px; }
}
@media (max-width:620px) {
  body.dc-app .dc-brand-fields { grid-template-columns:1fr; }
  body.dc-app .dc-brand-entitlement.free { grid-template-columns:42px minmax(0,1fr); }
  body.dc-app .dc-brand-entitlement.free .dc-btn { grid-column:1/-1;width:100%; }
}

"""

css_text = CSS.read_text()
if "body.dc-app .dc-brand-split" in css_text:
    skipped.append("CSS: Brand Kit styles (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: Brand Kit styles")
else:
    sys.exit("CSS anchor comment not found in studio-v6.css. Nothing written.")


# Guard every name saveBrandKit()/paint() depends on.
js = JS.read_text()
for field in ("watermarkEnabled", "watermarkText", "watermarkPosition", "watermarkColor",
              "watermarkOpacity", "brandLineEnabled", "brandLineColor", "brandVocabulary",
              "audience", "contentGoal", "brandTone", "avoidPhrases"):
    if f'name="{field}"' not in js:
        sys.exit(f"Form field '{field}' disappeared — saveBrandKit() would silently drop it.")
for ident in ("dcBrandForm", "dcBrandPreviewMark", "dcBrandPreviewLine", "dcBrandOpacityValue"):
    if ident not in js:
        sys.exit(f"Element id '{ident}' disappeared — the live preview would break.")

names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch21 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nAll 12 form fields and 4 preview ids verified present.")
print("\nNext:\n  npm run check && npm test\n")
