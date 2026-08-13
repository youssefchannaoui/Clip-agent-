#!/usr/bin/env python3
r"""
Rebuild Clip Styles as a full template studio.

THE BRIEF
---------
Match OpusClip's brand-template editor: a top bar with a template switcher,
undo / redo and Save; a strip of saved templates you can add to; a grouped
settings rail that drills into each group; and a live 9:16 preview. Same
structure, DeenClipped's visual language.

WHAT IT IS BUILT ON
-------------------
src/templates.js already defines ~60 real fields, and the server already has
full CRUD (GET/POST /api/templates, PUT and DELETE /api/templates/:id,
POST .../duplicate). Nothing here is mocked — every control writes a field
the renderer actually reads:

  Clip layout   fitMode, frameBackground, blurStrength, filterPreset,
                brightness, contrast, saturation, sharpen, vignette
  Captions      captionMode, three fonts, uppercase, size, weight, spacing,
                line height, primary/highlight/outline/background colours,
                outline width, shadow, x/y position, words per card, pause
                and hold timing, timing offset
  Auto headline hookEnabled, hookDuration, hookFontSize, hookColour,
                hookBackground, hookBackgroundOpacity
  Framing       smartFramingEnabled, bias, padding, zoom, smoothing
  Overlay       watermark text, size, colour, opacity, position, margins,
                brandLineEnabled, brandLineColor, brandLineHeight
  Audio         voiceEnhance

WHAT OPUS HAS THAT THIS DOES NOT
--------------------------------
Deliberately omitted rather than shipped as dead switches: remove filler
words, remove pauses, AI keyword highlighter, AI emojis, stock B-roll, and
intro/outro clips. None of them exist in worker/clip_worker.py, so a toggle
would change nothing and quietly lie about what the render will do. They
need worker work first.

SAVE SEMANTICS
--------------
Built-in templates are `editable:false` server-side, so saving edits to one
creates a new custom template from the draft and selects it, rather than
failing. Editing a custom template saves in place via PUT. Both paths are
what the existing endpoints already support.

Run from your repo root:

    python3 patch24/apply.py
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

NEW_JS = r"""const STYLE_GROUPS=[
  ['layout','Clip layout','style','Style'],
  ['captions','Captions','captions','Style'],
  ['headline','Auto headline','details','Style'],
  ['framing','Speaker framing','canvas','Style'],
  ['overlay','Overlay','brand','Brand'],
  ['audio','Audio','audio','Brand'],
];
const STYLE_FONTS=['DejaVu Sans','DejaVu Serif','Manrope','Roboto','Lato','Noto Sans','Noto Serif','Play','Liberation Sans','Liberation Serif','Amiri','Scheherazade New','Noto Naskh Arabic','Noto Kufi Arabic'];
const styleStudio={draft:null,baseId:'',group:'',history:[],index:-1,dirty:false};

function styleStudioLoad(template){
  styleStudio.draft=clone(template);styleStudio.baseId=template.id||'';
  styleStudio.history=[clone(template)];styleStudio.index=0;styleStudio.dirty=false;styleStudio.group='';
}
function styleStudioPush(){
  styleStudio.history=styleStudio.history.slice(0,styleStudio.index+1);
  styleStudio.history.push(clone(styleStudio.draft));
  if(styleStudio.history.length>60)styleStudio.history.shift();
  styleStudio.index=styleStudio.history.length-1;styleStudio.dirty=true;
}
function styleStudioSet(key,value){if(!styleStudio.draft)return;styleStudio.draft[key]=value;styleStudioPush()}
function styleStudioUndo(){if(styleStudio.index<=0)return;styleStudio.index--;styleStudio.draft=clone(styleStudio.history[styleStudio.index]);styleStudio.dirty=true;renderTemplatesPage()}
function styleStudioRedo(){if(styleStudio.index>=styleStudio.history.length-1)return;styleStudio.index++;styleStudio.draft=clone(styleStudio.history[styleStudio.index]);styleStudio.dirty=true;renderTemplatesPage()}
function styleStudioRevert(){const base=(data()?.templates||[]).find(t=>t.id===styleStudio.baseId);if(!base)return;styleStudioLoad(base);renderTemplatesPage();notify('Reverted to the saved template')}

function styleField(key,fallback){const value=styleStudio.draft?.[key];return value===undefined||value===null?fallback:value}
function styleSeg(key,list){return `<div class="dc-style-seg" role="group">${list.map(([value,label])=>`<button type="button" data-style-seg="${esc(key)}" data-style-value="${esc(value)}" class="${String(styleField(key,''))===value?'on':''}">${esc(label)}</button>`).join('')}</div>`}
function styleToggle(key,label,hint){return `<label class="dc-switch-row"><span><strong>${esc(label)}</strong><span>${esc(hint||'')}</span></span><input type="checkbox" data-style-key="${esc(key)}" data-style-type="bool" ${styleField(key,false)?'checked':''}></label>`}
function styleColor(key,label){return `<label class="dc-style-ctl">${esc(label)}<input type="color" data-style-key="${esc(key)}" data-style-type="text" value="${esc(templateSafeColor(styleField(key,'#FFFFFF')))}"></label>`}
function styleRange(key,label,min,max,step,suffix){const value=Number(styleField(key,min));return `<label class="dc-style-ctl wide">${esc(label)} <b data-style-out="${esc(key)}">${value}${esc(suffix||'')}</b><input type="range" min="${min}" max="${max}" step="${step}" data-style-key="${esc(key)}" data-style-type="number" data-style-suffix="${esc(suffix||'')}" value="${value}"></label>`}
function styleSelect(key,label,list){return `<label class="dc-style-ctl">${esc(label)}<select data-style-key="${esc(key)}" data-style-type="text">${list.map(v=>{const [value,text]=Array.isArray(v)?v:[v,v];return `<option value="${esc(value)}" ${String(styleField(key,''))===String(value)?'selected':''}>${esc(text)}</option>`}).join('')}</select></label>`}
function styleText(key,label,max){return `<label class="dc-style-ctl wide">${esc(label)}<input type="text" maxlength="${Number(max)||60}" data-style-key="${esc(key)}" data-style-type="text" value="${esc(styleField(key,''))}"></label>`}

function styleGroupSummary(id){
  const d=styleStudio.draft||{};
  if(id==='layout')return `${templateFitLabel(d.fitMode)} · ${esc(String(d.filterPreset||'natural'))}`;
  if(id==='captions')return `${templateModeLabel(d.captionMode)} · ${esc(String(d.captionFont||'Default'))}`;
  if(id==='headline')return d.hookEnabled?`On · ${Number(d.hookDuration||0)}s`:'Off';
  if(id==='framing')return d.smartFramingEnabled?`Tracking · ${esc(String(d.smartFramingBias||'auto'))}`:'Off';
  if(id==='overlay')return `${d.watermark?esc(shortText(d.watermark,14)):'No mark'}${d.brandLineEnabled?' · accent':''}`;
  if(id==='audio')return d.voiceEnhance?'Voice enhanced':'Raw audio';
  return '';
}
function styleGroupControls(id){
  if(id==='layout')return `${styleSeg('fitMode',[['contain','Fit whole frame'],['blur','Blurred sides'],['crop','Fill 9:16']])}
    ${styleColor('frameBackground','Background')}${styleSelect('filterPreset','Colour look',[['natural','Natural'],['crisp','Crisp'],['warm','Warm'],['cinematic','Cinematic'],['monochrome','Monochrome']])}
    ${styleRange('blurStrength','Side blur',0,60,1,'')}${styleRange('brightness','Brightness',-0.3,0.3,0.01,'')}${styleRange('contrast','Contrast',0.6,1.6,0.01,'')}${styleRange('saturation','Saturation',0,2,0.01,'')}${styleRange('sharpen','Sharpen',0,1.5,0.05,'')}${styleRange('vignette','Vignette',0,1,0.05,'')}`;
  if(id==='captions')return `${styleSeg('captionMode',[['dynamic-stack','Word stack'],['word','Word highlight'],['phrase','Phrase']])}
    ${styleSelect('captionFont','Main font',STYLE_FONTS)}${styleSelect('captionHighlightFont','Highlight font',STYLE_FONTS)}${styleSelect('captionArabicFont','Arabic font',STYLE_FONTS)}
    ${styleColor('captionPrimary','Text')}${styleColor('captionHighlight','Highlight')}${styleColor('captionOutline','Outline')}${styleColor('captionBackground','Card')}
    ${styleToggle('captionUppercase','Uppercase','Force capitals on every caption')}${styleToggle('captionHighlightItalic','Italic highlight','Slant the highlighted word')}
    ${styleRange('captionFontSize','Size',40,160,1,'')}${styleRange('captionFontWeight','Weight',400,900,50,'')}${styleRange('captionOutlineWidth','Outline width',0,12,0.5,'')}${styleRange('captionShadow','Shadow',0,8,0.5,'')}
    ${styleRange('captionBackgroundOpacity','Card opacity',0,100,1,'%')}${styleRange('captionLetterSpacing','Letter spacing',-4,12,0.5,'')}${styleRange('captionLineHeight','Line height',0.65,1.4,0.01,'')}
    ${styleRange('captionPositionX','Horizontal',8,92,1,'%')}${styleRange('captionPositionY','Vertical',12,88,1,'%')}
    ${styleRange('captionMaxWords','Words per card',1,8,1,'')}${styleRange('captionClearPause','Clear after pause',0,2,0.05,'s')}${styleRange('captionHoldSeconds','Hold',0,1,0.02,'s')}${styleRange('captionTimingOffsetMs','Timing offset',-400,400,10,'ms')}`;
  if(id==='headline')return `${styleToggle('hookEnabled','Show auto headline','A short title card over the opening seconds')}
    ${styleColor('hookColor','Text')}${styleColor('hookBackground','Background')}
    ${styleRange('hookDuration','Duration',0.8,6,0.1,'s')}${styleRange('hookFontSize','Size',28,96,1,'')}${styleRange('hookBackgroundOpacity','Background opacity',0,100,1,'%')}`;
  if(id==='framing')return `${styleToggle('smartFramingEnabled','Track the speaker','Keeps the face centred when filling 9:16')}
    ${styleSelect('smartFramingBias','Bias',[['auto','Automatic'],['left','Left'],['center','Centre'],['right','Right']])}
    ${styleRange('smartFramingPadding','Padding',0.05,0.45,0.01,'')}${styleRange('smartFramingZoom','Zoom',0.75,1.35,0.01,'')}${styleRange('smartFramingSmoothing','Smoothing',0,0.95,0.01,'')}
    <p class="dc-style-hint">Only applies when the layout is set to fill 9:16.</p>`;
  if(id==='overlay')return `${styleText('watermark','Watermark text',60)}
    ${styleSelect('watermarkPosition','Position',[['top-left','Top left'],['top-center','Top centre'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom centre'],['bottom-right','Bottom right']])}
    ${styleColor('watermarkColor','Colour')}${styleRange('watermarkOpacity','Opacity',0,100,1,'%')}${styleRange('watermarkFontSize','Size',14,64,1,'')}
    ${styleToggle('brandLineEnabled','Accent line','A colour edge along the clip')}${styleColor('brandLineColor','Accent colour')}${styleRange('brandLineHeight','Accent thickness',2,24,1,'')}`;
  if(id==='audio')return `${styleToggle('voiceEnhance','Enhance voice','Level and clean the speaker before mixing music under it')}
    <p class="dc-style-hint">Background tracks and volume live in Audio.</p>`;
  return '';
}

function styleTemplateCard(t,sourcePreview){
  const editing=t.id===styleStudio.baseId, isDefault=data()?.selectedTemplate?.id===t.id;
  const swatches=[t.captionPrimary,t.captionHighlight,t.watermarkColor,t.brandLineColor].filter(Boolean).slice(0,4);
  const more=`<details class="dc-clip-more"><summary>More</summary><div><button data-duplicate-template="${esc(t.id)}">Duplicate</button>${isDefault?'':`<button data-use-template="${esc(t.id)}">Use for new clips</button>`}${t.builtIn?'':`<button class="danger" data-delete-template="${esc(t.id)}">Delete</button>`}</div></details>`;
  return `<article class="dc-style-card ${editing?'is-editing':''}"><button type="button" class="dc-style-card-art" data-style-open="${esc(t.id)}" aria-label="Edit ${esc(t.name||'template')}">${templatePreviewMarkup(t,sourcePreview)}</button><div class="dc-style-card-foot"><div><strong>${esc(shortText(t.name||'Untitled',22))}</strong><small>${t.builtIn?'Built-in':'Custom'}${isDefault?' · default':''}</small></div><span class="dc-style-swatches">${swatches.map(c=>`<i style="background:${esc(templateSafeColor(c))}"></i>`).join('')}</span></div><div class="dc-style-card-row">${isDefault?'<b class="dc-style-flag">Default</b>':''}${more}</div></article>`;
}

async function styleStudioSave(){
  const draft=styleStudio.draft;if(!draft)return;
  const base=(data()?.templates||[]).find(t=>t.id===styleStudio.baseId);
  const button=$('#dcStyleSave');if(button){button.disabled=true;button.textContent='Saving…'}
  try{
    let saved;
    if(!base||base.builtIn){
      // Built-in templates are editable:false on the server, so edits become
      // a new custom template rather than a failed write.
      const name=base&&draft.name===base.name?`${base.name} (custom)`:String(draft.name||'Custom template');
      const result=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...draft,name},select:true})});
      saved=result.template;
    }else{
      const result=await callApi(`/api/templates/${encodeURIComponent(base.id)}`,{method:'PUT',body:JSON.stringify({template:draft})});
      saved=result.template;
    }
    await refreshData();
    if(saved)styleStudioLoad(saved);
    notify('Template saved');
  }catch(error){notify(error.message,'bad')}
  renderTemplatesPage();
}
async function styleStudioCreate(){
  const base=styleStudio.baseId||data()?.selectedTemplate?.id;
  if(!base)return notify('No template to start from','bad');
  try{
    const result=await callApi(`/api/templates/${encodeURIComponent(base)}/duplicate`,{method:'POST',body:JSON.stringify({name:'New template'})});
    await refreshData();
    if(result.template)styleStudioLoad(result.template);
    notify('New template created');
  }catch(error){notify(error.message,'bad')}
  renderTemplatesPage();
}

function renderTemplatesPage(){
  const panel=$('#view-templates'),d=data();if(!panel||!d)return;
  const templates=d.templates||[];
  if(!templates.length){panel.innerHTML='<div class="dc-qc-empty">Default styles could not be loaded.</div>';return}
  const base=templates.find(t=>t.id===styleStudio.baseId)||d.selectedTemplate||templates[0];
  if(!styleStudio.draft||!templates.some(t=>t.id===styleStudio.baseId))styleStudioLoad(base);
  const draft=styleStudio.draft;
  const sourcePreview=(d.projects||[]).map(project=>projectThumbUrl(project,[])).find(Boolean)||'';
  const canUndo=styleStudio.index>0,canRedo=styleStudio.index<styleStudio.history.length-1;
  const group=STYLE_GROUPS.find(g=>g[0]===styleStudio.group);

  const rail=group
    ?`<div class="dc-style-panel-head"><button type="button" id="dcStyleBack" class="dc-icon-btn dc-svg" aria-label="Back to all settings">${ICON.back}</button><div><small>${esc(group[3])}</small><strong>${esc(group[1])}</strong></div></div><div class="dc-style-panel" id="dcStyleControls">${styleGroupControls(group[0])}</div>`
    :`<div class="dc-style-rail">${['Style','Brand'].map(section=>`<small>${esc(section)}</small>${STYLE_GROUPS.filter(g=>g[3]===section).map(([id,label,icon])=>`<button type="button" data-style-group="${esc(id)}"><span>${ICON[icon]||ICON.style}</span><div><strong>${esc(label)}</strong><em>${esc(styleGroupSummary(id))}</em></div>${ICON.chevron}</button>`).join('')}`).join('')}</div>`;

  panel.innerHTML=`<div class="dc-style-studio">
    <header class="dc-style-bar"><div class="dc-style-bar-title"><strong>Clip styles</strong><span>Build the look every new clip uses</span></div>
      <select id="dcStyleSwitch" aria-label="Choose template">${templates.map(t=>`<option value="${esc(t.id)}" ${t.id===base.id?'selected':''}>${esc(t.name||'Untitled')}${d.selectedTemplate?.id===t.id?' · default':''}</option>`).join('')}</select>
      <div class="dc-style-bar-actions"><button type="button" class="dc-icon-btn dc-svg" id="dcStyleUndo" title="Undo" ${canUndo?'':'disabled'}>${ICON.undo}</button><button type="button" class="dc-icon-btn dc-svg" id="dcStyleRedo" title="Redo" ${canRedo?'':'disabled'}>${ICON.redo}</button><button type="button" class="dc-icon-btn dc-svg" id="dcStyleRevert" title="Discard changes" ${styleStudio.dirty?'':'disabled'}>${ICON.clock}</button><button class="dc-btn" id="dcStyleSave" ${styleStudio.dirty?'':'disabled'}>${styleStudio.dirty?'Save template':'Saved'}</button></div></header>
    <div class="dc-style-strip"><button type="button" class="dc-style-new" id="dcStyleNew"><span>+</span><small>New template</small></button>${templates.map(t=>styleTemplateCard(t,sourcePreview)).join('')}</div>
    <div class="dc-style-workspace"><aside class="dc-style-side">${rail}</aside>
      <main class="dc-style-stage"><div class="dc-style-stage-frame">${templatePreviewMarkup(draft,sourcePreview,true)}<span class="dc-style-demo">Preview</span></div><p class="dc-style-stage-note">Sample caption over your own footage. New clips use this look once saved.</p></main></div>
  </div>`;

  $('#dcStyleSwitch')?.addEventListener('change',event=>{const next=templates.find(t=>t.id===event.target.value);if(next){styleStudioLoad(next);renderTemplatesPage()}});
  $('#dcStyleUndo')?.addEventListener('click',styleStudioUndo);
  $('#dcStyleRedo')?.addEventListener('click',styleStudioRedo);
  $('#dcStyleRevert')?.addEventListener('click',styleStudioRevert);
  $('#dcStyleSave')?.addEventListener('click',styleStudioSave);
  $('#dcStyleNew')?.addEventListener('click',styleStudioCreate);
  $('#dcStyleBack')?.addEventListener('click',()=>{styleStudio.group='';renderTemplatesPage()});
  $$('[data-style-group]',panel).forEach(button=>button.addEventListener('click',()=>{styleStudio.group=button.dataset.styleGroup;renderTemplatesPage()}));
  $$('[data-style-open]',panel).forEach(button=>button.addEventListener('click',()=>{const next=templates.find(t=>t.id===button.dataset.styleOpen);if(next){styleStudioLoad(next);renderTemplatesPage()}}));
  $$('[data-style-seg]',panel).forEach(button=>button.addEventListener('click',()=>{styleStudioSet(button.dataset.styleSeg,button.dataset.styleValue);renderTemplatesPage()}));
  const controls=$('#dcStyleControls');
  if(controls){
    // Ranges repaint the preview live without re-rendering the panel, so the
    // slider keeps focus while dragging.
    controls.addEventListener('input',event=>{
      const key=event.target.dataset.styleKey;if(!key)return;
      const type=event.target.dataset.styleType;
      const value=type==='number'?Number(event.target.value):type==='bool'?event.target.checked:event.target.value;
      styleStudio.draft[key]=value;styleStudio.dirty=true;
      const out=controls.querySelector(`[data-style-out="${CSS.escape(key)}"]`);
      if(out)out.textContent=`${value}${event.target.dataset.styleSuffix||''}`;
      styleStudioPaint(sourcePreview);
    });
    controls.addEventListener('change',event=>{if(event.target.dataset.styleKey)styleStudioPush()});
  }
  requestAnimationFrame(()=>animatePanel(panel));
}
function styleStudioPaint(sourcePreview){
  const frame=$('.dc-style-stage-frame');if(!frame||!styleStudio.draft)return;
  frame.innerHTML=`${templatePreviewMarkup(styleStudio.draft,sourcePreview,true)}<span class="dc-style-demo">Preview</span>`;
  const save=$('#dcStyleSave');if(save){save.disabled=false;save.textContent='Save template'}
  const revert=$('#dcStyleRevert');if(revert)revert.disabled=false;
}
"""

js = JS.read_text()
if "function renderTemplatesPage(){" not in js:
    sys.exit("Could not find renderTemplatesPage(). Nothing written.")

if "const styleStudio={draft:null" in js:
    skipped.append("Clip Styles studio (already applied)")
else:
    start = js.index("function renderTemplatesPage(){")
    end = js.index("function templateSafeColor(", start)
    old = js[start:end]
    if "templateCard" not in old:
        sys.exit("Sliced Clip Styles block looks wrong — aborting rather than guessing.")
    JS.write_text(js[:start] + NEW_JS + js[end:])
    changed.append("renderTemplatesPage(): full template studio replacing the old grid")

# Remove the now-unused old card builder if it survived elsewhere.
js = JS.read_text()
if "\nfunction templateCard(t,sourcePreview=''){" in js:
    s = js.index("\nfunction templateCard(t,sourcePreview=''){")
    e = js.index("\nfunction ", s + 10)
    JS.write_text(js[:s] + js[e:])
    changed.append("remove the superseded templateCard()")

# ---------------------------------------------------------------------- CSS

CSS_ANCHOR = "/* Consistent screen language across the existing, already-functional views. */"
CSS_BLOCK = """/* Clip Styles studio — top bar, template strip, drill-in rail, live stage. */
body.dc-app .dc-style-studio { display:grid;gap:13px; }
body.dc-app .dc-style-bar { display:grid;grid-template-columns:minmax(0,1fr) minmax(160px,240px) auto;gap:14px;align-items:center;padding:14px 18px;border:1px solid var(--v6-line);border-radius:20px;background:linear-gradient(155deg,var(--v6-panel-raised),var(--v6-panel-soft));box-shadow:var(--v6-shadow); }
body.dc-app .dc-style-bar-title strong { display:block;font-size:15px;letter-spacing:-.03em; }
body.dc-app .dc-style-bar-title span { display:block;margin-top:3px;color:var(--v6-muted);font-size:9px; }
body.dc-app #dcStyleSwitch { height:38px;padding:0 11px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#09090b;color:var(--v6-text);font-size:10px; }
body.dc-app .dc-style-bar-actions { display:flex;gap:7px;align-items:center; }
body.dc-app .dc-style-bar-actions .dc-icon-btn { width:36px;height:36px;border-radius:11px; }
body.dc-app .dc-style-bar-actions .dc-btn { min-height:36px;padding:0 18px; }
body.dc-app .dc-style-strip { display:flex;gap:10px;overflow-x:auto;padding:4px 2px 8px; }
body.dc-app .dc-style-new { flex:0 0 128px;display:grid;place-items:center;align-content:center;gap:6px;height:190px;border:1px dashed rgba(255,255,255,.14);border-radius:16px;color:var(--v6-muted);background:rgba(255,255,255,.015); }
body.dc-app .dc-style-new span { font-size:22px;line-height:1; }
body.dc-app .dc-style-new small { font-size:8.5px; }
body.dc-app .dc-style-new:hover { border-color:rgba(224,186,117,.42);color:var(--v6-gold); }
body.dc-app .dc-style-card { flex:0 0 128px;display:grid;gap:7px;align-content:start; }
body.dc-app .dc-style-card-art { position:relative;display:block;width:128px;height:190px;overflow:hidden;padding:0;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#060607;transition:transform .18s ease,border-color .18s ease; }
body.dc-app .dc-style-card-art:hover { transform:translateY(-2px);border-color:rgba(224,186,117,.42); }
body.dc-app .dc-style-card.is-editing .dc-style-card-art { border-color:var(--v6-gold);box-shadow:0 0 0 1px rgba(224,186,117,.45); }
body.dc-app .dc-style-card-art .dc-style-phone { position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;box-shadow:none; }
body.dc-app .dc-style-card-foot { display:flex;align-items:center;justify-content:space-between;gap:7px; }
body.dc-app .dc-style-card-foot strong { display:block;font-size:9.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:80px; }
body.dc-app .dc-style-card-foot small { display:block;margin-top:2px;color:var(--v6-muted);font-size:7.5px; }
body.dc-app .dc-style-swatches { display:flex;gap:3px; }
body.dc-app .dc-style-swatches i { width:9px;height:9px;border-radius:3px;border:1px solid rgba(255,255,255,.16); }
body.dc-app .dc-style-card-row { display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:22px; }
body.dc-app .dc-style-flag { padding:3px 7px;border-radius:999px;background:rgba(104,213,157,.18);color:#8fe6bb;font-size:7px;text-transform:uppercase;letter-spacing:.06em; }
body.dc-app .dc-style-workspace { display:grid;grid-template-columns:322px minmax(0,1fr);gap:13px;align-items:start; }
body.dc-app .dc-style-side { border:1px solid var(--v6-line);border-radius:20px;background:linear-gradient(155deg,var(--v6-panel-raised),var(--v6-panel-soft));box-shadow:var(--v6-shadow);overflow:hidden; }
body.dc-app .dc-style-rail { display:grid;gap:5px;padding:13px; }
body.dc-app .dc-style-rail>small { padding:8px 8px 4px;color:var(--v6-muted);font-size:7px;font-weight:900;letter-spacing:.13em;text-transform:uppercase; }
body.dc-app .dc-style-rail>button { display:grid;grid-template-columns:34px minmax(0,1fr) 14px;gap:10px;align-items:center;padding:10px;border:1px solid transparent;border-radius:14px;color:var(--v6-text);text-align:left;transition:.16s; }
body.dc-app .dc-style-rail>button:hover { border-color:rgba(224,186,117,.18);background:rgba(224,186,117,.06); }
body.dc-app .dc-style-rail>button>span { width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.045);color:var(--v6-gold); }
body.dc-app .dc-style-rail>button>span svg { width:17px;height:17px;fill:none;stroke:currentColor; }
body.dc-app .dc-style-rail strong { display:block;font-size:10px; }
body.dc-app .dc-style-rail em { display:block;margin-top:3px;color:var(--v6-muted);font-size:8px;font-style:normal;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-style-rail>button>svg { width:13px;height:13px;opacity:.4;fill:none;stroke:currentColor; }
body.dc-app .dc-style-panel-head { display:grid;grid-template-columns:34px minmax(0,1fr);gap:11px;align-items:center;padding:13px;border-bottom:1px solid rgba(255,255,255,.065); }
body.dc-app .dc-style-panel-head small { display:block;color:var(--v6-gold);font-size:7px;font-weight:900;letter-spacing:.12em;text-transform:uppercase; }
body.dc-app .dc-style-panel-head strong { display:block;margin-top:3px;font-size:13px; }
body.dc-app .dc-style-panel { display:grid;grid-template-columns:1fr 1fr;gap:9px;padding:14px;max-height:min(620px,68vh);overflow-y:auto; }
body.dc-app .dc-style-panel .wide,body.dc-app .dc-style-panel .dc-switch-row,body.dc-app .dc-style-panel .dc-style-seg,body.dc-app .dc-style-hint { grid-column:1/-1; }
body.dc-app .dc-style-ctl { display:grid;gap:6px;color:var(--v6-muted);font-size:8.5px; }
body.dc-app .dc-style-ctl b { color:var(--v6-text);font-size:8.5px; }
body.dc-app .dc-style-ctl select,body.dc-app .dc-style-ctl input[type=text] { height:36px;padding:0 9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#09090b;color:var(--v6-text);font-size:9.5px; }
body.dc-app .dc-style-ctl input[type=color] { width:100%;height:34px;padding:3px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#09090b; }
body.dc-app .dc-style-ctl input[type=range] { width:100%; }
body.dc-app .dc-style-seg { display:flex;gap:5px; }
body.dc-app .dc-style-seg button { flex:1;min-height:34px;padding:0 8px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:rgba(0,0,0,.22);color:var(--v6-muted);font-size:8.5px;transition:.16s; }
body.dc-app .dc-style-seg button.on { border-color:rgba(224,186,117,.45);background:rgba(224,186,117,.12);color:var(--v6-gold-bright); }
body.dc-app .dc-style-hint { margin:2px 0 0;color:var(--v6-muted);font-size:8px;line-height:1.5; }
body.dc-app .dc-style-stage { display:grid;justify-items:center;gap:10px;padding:20px;border:1px solid var(--v6-line);border-radius:20px;background:radial-gradient(circle at 50% 0,rgba(224,186,117,.06),transparent 40%),linear-gradient(155deg,var(--v6-panel-raised),var(--v6-panel-soft));box-shadow:var(--v6-shadow); }
body.dc-app .dc-style-stage-frame { position:relative;width:min(300px,62vw);aspect-ratio:9/16;border-radius:18px;overflow:hidden;border:1px solid rgba(255,255,255,.09);background:#060607;box-shadow:0 28px 75px rgba(0,0,0,.46); }
body.dc-app .dc-style-stage-frame .dc-style-phone { position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:0;box-shadow:none; }
body.dc-app .dc-style-demo { position:absolute;top:9px;left:9px;padding:4px 9px;border-radius:999px;background:rgba(3,4,6,.72);color:#cfd0d8;font-size:7.5px;letter-spacing:.06em;text-transform:uppercase; }
body.dc-app .dc-style-stage-note { margin:0;color:var(--v6-muted);font-size:8.5px;text-align:center;max-width:320px; }
@media (max-width:1100px) {
  body.dc-app .dc-style-workspace { grid-template-columns:1fr; }
  body.dc-app .dc-style-bar { grid-template-columns:1fr;gap:10px; }
  body.dc-app .dc-style-bar-actions { justify-content:flex-end; }
}
@media (max-width:620px) { body.dc-app .dc-style-panel { grid-template-columns:1fr; } }

"""

css_text = CSS.read_text()
if "body.dc-app .dc-style-studio" in css_text:
    skipped.append("CSS: Clip Styles studio (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: Clip Styles studio")
else:
    sys.exit("CSS anchor comment not found in studio-v6.css. Nothing written.")

js = JS.read_text()
names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")
for hook in ("data-duplicate-template", "data-delete-template", "data-use-template"):
    if hook not in js:
        sys.exit(f"Action hook '{hook}' disappeared — that control would stop working.")

print("patch24 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNo duplicate declarations. Template action hooks intact.")
print("\nNext:\n  npm run check && npm test\n")
