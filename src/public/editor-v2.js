(() => {
'use strict';

const q=(s,r=document)=>r.querySelector(s);
const qa=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
const deep=v=>JSON.parse(JSON.stringify(v||{}));
const ICON={
 back:'<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
 play:'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>',
 pause:'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
 undo:'<svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>',
 redo:'<svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></svg>',
 captions:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10a3 3 0 1 0 0 4m7-4a3 3 0 1 0 0 4"/></svg>',
 canvas:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8v8H8Z"/></svg>',
 style:'<svg viewBox="0 0 24 24"><path d="M12 3 4 8v8l8 5 8-5V8Z"/><path d="m4 8 8 5 8-5M12 13v8"/></svg>',
 audio:'<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9Z"/><path d="M17 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/></svg>',
 details:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>'
};
const S={
 clipId:'',tool:'canvas',clip:null,draft:null,captionText:'',words:[],captionSource:'loading',
 offsetMs:-140,sourceBase:0,duration:1,sourceFallback:false,framing:null,framingState:'idle',
 dirty:false,playing:false,drag:null,history:[],historyIndex:-1,audioTrack:null,audioReady:false,
 lastCaptionText:'',opened:false
};

function appData(){try{return typeof DATA!=='undefined'?DATA:null}catch{return null}}
function password(){try{return typeof PW!=='undefined'?PW:''}catch{return''}}
function withAuth(url){
  try{if(typeof withPw==='function')return withPw(url)}catch{}
  const pw=password();return pw?`${url}${url.includes('?')?'&':'?'}pw=${encodeURIComponent(pw)}`:url;
}
async function apiCall(url,options={}){
  const headers={'Content-Type':'application/json',...(options.headers||{})};
  if(password())headers['x-app-password']=password();
  const res=await fetch(url,{...options,headers});
  const text=await res.text();let payload={};
  try{payload=text?JSON.parse(text):{}}catch{payload={error:text}}
  if(!res.ok)throw new Error(payload.error||`${res.status} ${res.statusText}`);
  return payload;
}
function toast(message,bad=false){
  q('.dce-toast')?.remove();const el=document.createElement('div');el.className=`dce-toast${bad?' bad':''}`;el.textContent=message;
  document.body.appendChild(el);setTimeout(()=>el.remove(),3200);
}
function currentClip(){
  return (appData()?.clips||[]).find(c=>c.id===S.clipId)||S.clip;
}
function ensureNav(){
  const existing=q('[data-dc-nav="editor"]');if(existing)return;
  const review=q('[data-dc-nav="review"]');if(!review)return;
  const button=document.createElement('button');button.type='button';button.className='dc-nav-button';button.dataset.dcNav='editor';button.title='Editor';
  button.innerHTML=`<span class="dc-nav-icon">${ICON.style}</span><span class="dc-nav-name">Editor</span>`;
  review.insertAdjacentElement('afterend',button);
}
function chooseClip(id=''){
  const clips=appData()?.clips||[];
  return clips.find(c=>c.id===id)||clips.find(c=>c.status==='waiting')||clips[0]||null;
}
function openEditor(id=''){
  const clip=chooseClip(id);if(!clip){toast('Generate a clip before opening the editor.',true);return}
  S.clipId=clip.id;S.clip=clip;S.opened=true;
  qa('.main-col > .panel').forEach(p=>p.classList.add('hide'));
  const panel=q('#view-editor');if(!panel)return;
  panel.classList.remove('hide');panel.classList.add('dce-owned');
  qa('[data-dc-nav]').forEach(b=>b.classList.toggle('is-active',b.dataset.dcNav==='editor'));
  const title=q('#dcPageName'),sub=q('#dcPageSub');if(title)title.textContent='Editor';if(sub)sub.textContent='Edit the video and see every change live';
  initClip(clip).catch(e=>{toast(e.message,true);renderEmptyError(e.message)});
  window.scrollTo({top:0,behavior:'auto'});
}
function intercept(event){
  const edit=event.target.closest('[data-edit-clip]');const nav=event.target.closest('[data-dc-nav="editor"]');
  if(!edit&&!nav)return;
  event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();
  openEditor(edit?.dataset.editClip||'');
}
document.addEventListener('click',intercept,true);

async function initClip(clip){
  const d=appData()||{};const template=(d.templates||[]).find(t=>t.id===clip.templateId)||d.selectedTemplate||d.templateDraft||{};
  const saved=loadLocal(clip.id);
  Object.assign(S,{
    clipId:clip.id,clip,draft:{...deep(template),...(saved?.draft||{})},captionText:saved?.captionText??clip.transcript??'',
    offsetMs:Number(saved?.offsetMs??template.captionTimingOffsetMs??-140),sourceBase:Number(clip.startSec||0),
    duration:Math.max(.1,Number(clip.durationMs||0)/1000),sourceFallback:false,framing:clip.smartFraming||null,
    framingState:clip.smartFraming?'ready':'idle',dirty:Boolean(saved),playing:false,history:[],historyIndex:-1,audioTrack:null,audioReady:false
  });
  S.draft.width??=1080;S.draft.height??=1920;S.draft.fitMode??='crop';S.draft.cropPositionX??=50;S.draft.cropPositionY??=50;S.draft.cropScale??=1;
  S.draft.smartFramingEnabled??=false;S.draft.smartFramingBias??='auto';S.draft.smartFramingPadding??=.18;S.draft.smartFramingZoom??=1;S.draft.smartFramingSmoothing??=.78;
  S.draft.captionMode??='word';S.draft.captionFont??='Poppins';S.draft.captionFontSize??=92;S.draft.captionMaxWords??=5;
  S.draft.captionPosition??='bottom';S.draft.captionHorizontal??='center';S.draft.captionPrimary??='#FFFFFF';
  S.draft.captionHighlight??='#D9B478';S.draft.captionOutline??='#000000';S.draft.captionOutlineWidth??=5;
  S.draft.captionBackground??='#000000';S.draft.captionBackgroundOpacity??=0;
  S.draft.musicVolumePercent??=d.musicSettings?.volumePercent||13;
  S.words=approxWords(S.captionText,S.duration);S.captionSource='loading';
  pushHistory(true);render();
  await Promise.allSettled([loadCaptions(),loadAudio()]);
  updateCaption(0);renderTimeline();updateHeader();
}
function loadLocal(id){try{return JSON.parse(localStorage.getItem(`dce-v2-${id}`)||'null')}catch{return null}}
function saveLocal(){
  try{localStorage.setItem(`dce-v2-${S.clipId}`,JSON.stringify({draft:cleanDraft(S.draft),captionText:S.captionText,offsetMs:S.offsetMs,savedAt:Date.now()}))}catch{}
}
function clearLocal(){try{localStorage.removeItem(`dce-v2-${S.clipId}`)}catch{}}

function renderEmptyError(message){
  const panel=q('#view-editor');if(panel)panel.innerHTML=`<div class="dc-card dc-card-pad"><div class="dc-empty"><strong>Editor could not open</strong>${esc(message)}</div></div>`;
}
function render(){
  const panel=q('#view-editor'),clip=currentClip(),clips=appData()?.clips||[];if(!panel||!clip)return;
  panel.innerHTML=`<div class="dce-shell">
    <header class="dce-top">
      <button class="dce-back" id="dceBack" title="Back to project">${ICON.back}</button>
      <div class="dce-title"><strong>${esc(clip.title||'Untitled clip')}</strong><span>${esc(clip.projectTitle||'Project')} · ${Math.round(clip.score||0)}/100</span></div>
      <select class="dce-select" id="dceClipSelect">${clips.map(c=>`<option value="${esc(c.id)}" ${c.id===clip.id?'selected':''}>${esc(c.title||'Untitled clip')}</option>`).join('')}</select>
      <span class="dce-save-state ${S.dirty?'dirty':''}" id="dceSaveState">${S.dirty?'Unsaved changes':'Saved'}</span>
      <button class="dce-icon-btn" id="dceUndo" title="Undo" ${S.historyIndex<=0?'disabled':''}>${ICON.undo}</button>
      <button class="dce-icon-btn" id="dceRedo" title="Redo" ${S.historyIndex>=S.history.length-1?'disabled':''}>${ICON.redo}</button>
      <button class="dce-btn secondary" id="dceSave">Save</button>
      <button class="dce-btn" id="dceExport">Export video</button>
    </header>
    <div class="dce-main">
      <nav class="dce-tools">
        ${tool('canvas','Canvas','canvas')}${tool('captions','Captions','captions')}${tool('style','Style','style')}${tool('audio','Audio','audio')}${tool('details','Details','details')}
      </nav>
      <section class="dce-preview-column">
        <div class="dce-preview-bar">
          <button class="dce-icon-btn" id="dcePlay">${ICON.play}</button>
          <span class="dce-time" id="dceTime">0:00 / ${clock(S.duration)}</span><span class="grow"></span>
          <span class="dce-status" id="dcePreviewStatus"><i></i><span>Live preview ready</span></span>
        </div>
        <div class="dce-stage-wrap">
          <div class="dce-stage" id="dceStage" data-mode="${modeName()}">
            <video class="dce-video bg" id="dceVideoBg" src="${withAuth(`/api/clips/${encodeURIComponent(clip.id)}/source-preview`)}" muted playsinline preload="metadata"></video>
            <video class="dce-video fg" id="dceVideo" src="${withAuth(`/api/clips/${encodeURIComponent(clip.id)}/source-preview`)}" playsinline preload="metadata"></video>
            <div class="dce-guide"></div><div class="dce-caption ${esc(S.draft.captionPosition)} ${esc(S.draft.captionHorizontal)}" id="dceCaption"></div>
            <div class="dce-watermark" id="dceWatermark"></div><span class="dce-mode-badge" id="dceModeBadge"></span>
          </div>
          <audio id="dceMusic" preload="metadata"></audio>
        </div>
      </section>
      <aside class="dce-inspector">
        <div class="dce-inspector-head"><strong id="dceInspectorTitle">${toolTitle()}</strong><span>Changes preview instantly</span></div>
        <div class="dce-inspector-body" id="dceInspector"></div>
      </aside>
    </div>
    <section class="dce-timeline">
      <div class="dce-timeline-top"><span class="dce-time" id="dceTimelineTime">0:00.0</span><span class="grow"></span><span class="dce-status"><i></i><span>Click the timeline to seek</span></span></div>
      <div class="dce-scroll" id="dceTimeline">
        <div class="dce-ruler" id="dceRuler"></div>
        <div class="dce-track"><div class="dce-track-name">Video</div><div class="dce-track-body"><div class="dce-block video">${esc(clip.title||'Video')}</div></div></div>
        <div class="dce-track"><div class="dce-track-name">Captions</div><div class="dce-track-body" id="dceCaptionTrack"></div></div>
        <div class="dce-track"><div class="dce-track-name">Framing</div><div class="dce-track-body" id="dceFramingTrack"></div></div>
        <div class="dce-head" id="dceHead"></div>
      </div>
    </section>
  </div>`;
  bindBase();renderInspector();bindVideo();updatePreview();renderTimeline();
}
function tool(id,label,icon){return `<button class="dce-tool ${S.tool===id?'active':''}" data-dce-tool="${id}">${ICON[icon]}<span>${label}</span></button>`}
function toolTitle(){return({canvas:'Canvas',captions:'Captions',style:'Style',audio:'Audio',details:'Details'})[S.tool]}
function modeName(){return S.draft.fitMode==='crop'?'fill':S.draft.fitMode==='blur'?'blur':'fit'}

function bindBase(){
  q('#dceBack').onclick=()=>{const p=currentClip()?.projectId;const btn=q('[data-dc-nav="projects"]');if(btn)btn.click();setTimeout(()=>{const open=p&&q(`[data-open-project="${CSS.escape(p)}"]`);open?.click()},50)};
  q('#dceClipSelect').onchange=e=>openEditor(e.target.value);
  q('#dceUndo').onclick=undo;q('#dceRedo').onclick=redo;q('#dceSave').onclick=saveAll;q('#dceExport').onclick=exportVideo;
  qa('[data-dce-tool]').forEach(b=>b.onclick=()=>{S.tool=b.dataset.dceTool;qa('[data-dce-tool]').forEach(x=>x.classList.toggle('active',x===b));q('#dceInspectorTitle').textContent=toolTitle();renderInspector()});
  q('#dcePlay').onclick=togglePlay;
}
function renderInspector(){
  const box=q('#dceInspector');if(!box)return;
  if(S.tool==='canvas')box.innerHTML=canvasPanel();
  if(S.tool==='captions')box.innerHTML=captionPanel();
  if(S.tool==='style')box.innerHTML=stylePanel();
  if(S.tool==='audio')box.innerHTML=audioPanel();
  if(S.tool==='details')box.innerHTML=detailsPanel();
  bindInspector();
}
function canvasPanel(){
  const ratio=ratioName(),mode=modeName(),ai=S.draft.fitMode==='crop'&&S.draft.smartFramingEnabled;
  return `<div class="dce-intro"><b>Canvas changes only the video.</b> Captions never move when you use Fit, Blur, Fill or speaker tracking.</div>
  <div class="dce-section"><div class="dce-section-title"><h3>Output frame</h3><span>${ratio}</span></div>
    <div class="dce-segment">
      ${choice('ratio','9:16','Portrait 9:16','Shorts, Reels and TikTok',ratio==='9:16')}
      ${choice('ratio','16:9','Landscape 16:9','YouTube and wide video',ratio==='16:9')}
    </div>
    <details class="dce-advanced"><summary>More frame shapes</summary><div class="dce-segment">
      ${choice('ratio','4:5','Portrait 4:5','Feed portrait',ratio==='4:5')}${choice('ratio','1:1','Square 1:1','Square post',ratio==='1:1')}
    </div></details>
  </div>
  <div class="dce-section"><div class="dce-section-title"><h3>How video fits</h3><span>${mode[0].toUpperCase()+mode.slice(1)}</span></div>
    <div class="dce-segment three">
      ${modeChoice('fit','Fit','Show all','fit',mode==='fit')}${modeChoice('blur','Blur','Full video + background','blur',mode==='blur')}${modeChoice('fill','Fill','Cover the frame','fill',mode==='fill')}
    </div>
  </div>
  ${mode==='blur'?`<div class="dce-section">${range('Blur strength','blurStrength',0,60,1,S.draft.blurStrength??28)}</div>`:''}
  ${mode==='fill'?`<div class="dce-section"><div class="dce-section-title"><h3>Fill framing</h3><span>${ai?'AI speaker focus':'Manual crop'}</span></div>
    <div class="dce-segment">
      ${choice('framing','manual','Manual','Drag the video yourself',!ai)}
      ${choice('framing','ai','AI speaker focus','Follow whoever is speaking',ai)}
    </div>
    ${ai?aiPanel():manualPanel()}
  </div>`:''}
  <div class="dce-message ${S.framingState==='error'?'bad':S.framingState==='ready'?'good':''}">${framingMessage()}</div>`;
}
function manualPanel(){
  return `<div style="margin-top:10px"><div class="dce-message good">Click and drag the video directly. Fill always covers the frame; Zoom lets you crop closer without stretching.</div>
  ${range('Zoom','cropScale',1,3,.01,S.draft.cropScale??1)}
  ${range('Horizontal position','cropPositionX',0,100,1,S.draft.cropPositionX??50)}
  ${range('Vertical position','cropPositionY',0,100,1,S.draft.cropPositionY??50)}
  <div class="dce-inline"><button class="dce-btn secondary" id="dceCentreCrop">Centre</button><button class="dce-btn secondary" id="dceResetTransform">Reset transform</button></div></div>`;
}
function aiPanel(){
  return `<div style="margin-top:10px"><button class="dce-btn" id="dceAnalyse" style="width:100%" ${S.framingState==='analysing'?'disabled':''}>${S.framingState==='analysing'?'Analysing speaker…':'Analyse and track speaker'}</button>
  <details class="dce-advanced"><summary>Tracking controls</summary><div>
    ${selectField('Fallback person','smartFramingBias',[['auto','Automatic'],['left','Prefer left'],['center','Prefer centre'],['right','Prefer right']])}
    ${range('Crop zoom','smartFramingZoom',.75,1.35,.05,S.draft.smartFramingZoom??1)}
    ${range('Space around person','smartFramingPadding',.05,.45,.01,S.draft.smartFramingPadding??.18)}
    ${range('Movement smoothing','smartFramingSmoothing',0,.95,.05,S.draft.smartFramingSmoothing??.78)}
  </div></details></div>`;
}
function captionPanel(){
  const exact=S.captionSource==='exact';
  return `<div class="dce-intro"><b>Captions follow speech.</b> Auto-sync reloads the original Whisper word timing. Earlier/Later corrects any small remaining delay.</div>
  <div class="dce-section"><div class="dce-section-title"><h3>Timing</h3><span>${exact?'Exact Whisper timing':'Estimated timing'}</span></div>
    <button class="dce-btn" id="dceSync" style="width:100%">Auto-sync captions</button>
    <div class="dce-inline" style="margin-top:7px"><button class="dce-btn secondary" id="dceEarlier">Earlier −50 ms</button><button class="dce-btn secondary" id="dceLater">Later +50 ms</button></div>
    ${range('Fine timing','captionTimingOffsetMs',-1000,1000,10,S.offsetMs)}
  </div>
  <div class="dce-section"><div class="dce-section-title"><h3>Caption style</h3><span>Live preview</span></div>
    <div class="dce-card-grid">
      ${captionPreset('viral','Viral pop','REMINDER')}${captionPreset('gold','Gold focus','REMINDER')}
      ${captionPreset('clean','Clean','Reminder')}${captionPreset('arabic','Arabic','تذكير')}
    </div>
  </div>
  <details class="dce-advanced" open><summary>Text and layout</summary><div>
    ${selectField('Caption behaviour','captionMode',[['dynamic-stack','Dynamic pop'],['word','Word highlight'],['phrase','Phrase']])}
    ${selectField('Position','captionPosition',[['top','Top'],['middle','Middle'],['bottom','Bottom']])}
    ${selectField('Alignment','captionHorizontal',[['left','Left'],['center','Centre'],['right','Right']])}
    ${range('Font size','captionFontSize',28,140,1,S.draft.captionFontSize??92)}
    ${range('Words per caption','captionMaxWords',1,10,1,S.draft.captionMaxWords??5)}
  </div></details>
  <details class="dce-advanced"><summary>Edit transcript</summary><div>
    <div class="dce-field"><textarea id="dceTranscript">${esc(S.captionText)}</textarea></div>
    <div class="dce-caption-list">${segments().slice(0,30).map(g=>`<button class="dce-caption-row" data-seek="${g.start}"><span>${clock(g.start)}</span><b>${esc(g.text)}</b></button>`).join('')}</div>
  </div></details>`;
}
function stylePanel(){
  return `<div class="dce-intro"><b>Style affects the video look and branding.</b> It does not change the canvas crop or caption timing.</div>
  <div class="dce-section"><div class="dce-section-title"><h3>Video look</h3><span>${esc(S.draft.filterPreset||'natural')}</span></div>
    <div class="dce-card-grid">${['natural','crisp','warm','cinematic'].map(x=>`<button class="dce-preset ${S.draft.filterPreset===x?'active':''}" data-filter="${x}"><div class="sample" style="${filterSample(x)}">${x.toUpperCase()}</div><b>${x[0].toUpperCase()+x.slice(1)}</b><span>Preview instantly</span></button>`).join('')}</div>
  </div>
  <details class="dce-advanced"><summary>Fine adjustments</summary><div>
    ${range('Brightness','brightness',-1,1,.05,S.draft.brightness??0)}${range('Contrast','contrast',.5,2,.05,S.draft.contrast??1)}
    ${range('Saturation','saturation',0,3,.05,S.draft.saturation??1)}${range('Vignette','vignette',0,1,.05,S.draft.vignette??0)}
  </div></details>
  <div class="dce-section"><div class="dce-section-title"><h3>Branding</h3><span>Optional</span></div>
    ${textField('Watermark','watermark',S.draft.watermark||'')}${range('Watermark opacity','watermarkOpacity',0,100,1,S.draft.watermarkOpacity??100)}
  </div>`;
}
function audioPanel(){
  const track=S.audioTrack;
  return `<div class="dce-intro"><b>Music previews with the clip.</b> Play the video after changing volume to hear the mix.</div>
  <div class="dce-section"><div class="dce-section-title"><h3>Current audio</h3><span>${track?esc(track.name):'No matching track'}</span></div>
    ${range('Nasheed volume','musicVolumePercent',0,50,1,S.draft.musicVolumePercent??13)}
    <button class="dce-btn secondary" id="dcePreviewMusic" style="width:100%">${S.playing?'Pause preview':'Play preview'}</button>
  </div>
  <details class="dce-advanced"><summary>Render-only audio processing</summary><div>
    ${checkField('Voice enhancement','voiceEnhance',S.draft.voiceEnhance!==false)}
    <div class="dce-message">Voice enhancement is applied during export because the browser cannot reproduce the final FFmpeg speech chain exactly.</div>
  </div></details>`;
}
function detailsPanel(){
  const c=currentClip();
  return `<div class="dce-intro"><b>Post details are separate from video editing.</b> Saving these fields never posts the clip.</div>
  <div class="dce-section">${textField('Title','metaTitle',c?.title||'')}
    <div class="dce-field"><label>Description</label><textarea id="dceMetaDescription">${esc(c?.description||'')}</textarea></div>
    <div class="dce-field"><label>Hashtags</label><textarea id="dceMetaHashtags">${esc(c?.hashtags||'')}</textarea></div>
    <button class="dce-btn secondary" id="dceSaveDetails" style="width:100%">Save post details</button>
  </div>`;
}
function choice(group,value,title,note,active){return `<button class="dce-choice ${active?'active':''}" data-choice="${group}" data-value="${value}"><b>${title}</b><span>${note}</span></button>`}
function modeChoice(value,title,note,mini,active){return `<button class="dce-choice ${active?'active':''}" data-mode="${value}"><span class="mini ${mini}"></span><b>${title}</b><span>${note}</span></button>`}
function range(label,key,min,max,step,value){return `<div class="dce-field"><label><span>${label}</span><b data-value="${key}">${formatValue(value,key)}</b></label><input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}"></div>`}
function selectField(label,key,opts){return `<div class="dce-field"><label>${label}</label><select data-key="${key}">${opts.map(([v,l])=>`<option value="${v}" ${String(S.draft[key])===String(v)?'selected':''}>${l}</option>`).join('')}</select></div>`}
function textField(label,key,value){return `<div class="dce-field"><label>${label}</label><input data-key="${key}" value="${esc(value)}"></div>`}
function checkField(label,key,value){return `<label class="dce-check"><input type="checkbox" data-key="${key}" ${value?'checked':''}>${label}</label>`}
function captionPreset(id,name,sample){return `<button class="dce-preset" data-caption-preset="${id}"><div class="sample">${sample}</div><b>${name}</b><span>Click to preview</span></button>`}
function filterSample(id){return id==='warm'?'background:#5b4734;color:#ffd8a8':id==='cinematic'?'background:#20242b;color:#d8c9ad':id==='crisp'?'filter:contrast(1.25);background:#303d49':'background:#27272d'}
function formatValue(v,key){return key==='captionTimingOffsetMs'?`${Math.round(v)} ms`:['smartFramingPadding','smartFramingZoom','smartFramingSmoothing'].includes(key)?Number(v).toFixed(2):String(Math.round(Number(v)*100)/100)}

function bindInspector(){
  qa('[data-mode]').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
  qa('[data-choice]').forEach(b=>b.onclick=()=>{
    if(b.dataset.choice==='ratio')setRatio(b.dataset.value);
    if(b.dataset.choice==='framing')setFraming(b.dataset.value);
  });
  qa('[data-key]').forEach(input=>{
    const handler=()=>setField(input.dataset.key,input.type==='checkbox'?input.checked:['range','number'].includes(input.type)?Number(input.value):input.value);
    input.addEventListener('input',handler);input.addEventListener('change',handler);
  });
  qa('[data-caption-preset]').forEach(b=>b.onclick=()=>applyCaptionPreset(b.dataset.captionPreset));
  qa('[data-filter]').forEach(b=>b.onclick=()=>{S.draft.filterPreset=b.dataset.filter;markDirty();pushHistory();renderInspector();updatePreview()});
  qa('[data-seek]').forEach(b=>b.onclick=()=>seek(Number(b.dataset.seek)));
  q('#dceCentreCrop')?.addEventListener('click',()=>{S.draft.cropPositionX=50;S.draft.cropPositionY=50;markDirty();pushHistory();renderInspector();updatePreview()});
  q('#dceResetTransform')?.addEventListener('click',()=>{S.draft.cropPositionX=50;S.draft.cropPositionY=50;S.draft.cropScale=1;markDirty();pushHistory();renderInspector();updatePreview();toast('Video transform reset')});
  q('#dceAnalyse')?.addEventListener('click',analyseFraming);
  q('#dceSync')?.addEventListener('click',syncCaptions);
  q('#dceEarlier')?.addEventListener('click',()=>adjustOffset(-50));
  q('#dceLater')?.addEventListener('click',()=>adjustOffset(50));
  q('#dceTranscript')?.addEventListener('input',e=>{S.captionText=e.target.value;S.words=remapWords(S.captionText,S.words,S.duration);S.captionSource='edited';markDirty();updateCaption(localTime());renderTimeline();debounceHistory()});
  q('#dcePreviewMusic')?.addEventListener('click',togglePlay);
  q('#dceSaveDetails')?.addEventListener('click',saveDetails);
}
function setMode(value){
  S.draft.fitMode=value==='fill'?'crop':value;
  if(value==='fill')S.draft.cropScale??=1;
  if(value!=='fill'){S.draft.smartFramingEnabled=false;S.framing=null;S.framingState='idle';S.draft.cropScale=1}
  markDirty();pushHistory();renderInspector();updatePreview();toast(`${value[0].toUpperCase()+value.slice(1)} preview applied`);
}
function setRatio(value){
  const map={'9:16':[1080,1920],'16:9':[1920,1080],'4:5':[1080,1350],'1:1':[1080,1080]};
  [S.draft.width,S.draft.height]=map[value];S.framing=null;if(S.draft.smartFramingEnabled)S.framingState='idle';
  markDirty();pushHistory();renderInspector();updatePreview();toast(`${value} output frame applied`);
}
function setFraming(value){
  S.draft.smartFramingEnabled=value==='ai';S.framing=null;S.framingState='idle';
  markDirty();pushHistory();renderInspector();updatePreview();
}
function setField(key,value){
  if(key==='captionTimingOffsetMs')S.offsetMs=Number(value);else if(key==='metaTitle')return;else S.draft[key]=value;
  const label=q(`[data-value="${key}"]`);if(label)label.textContent=formatValue(value,key);
  markDirty();updatePreview();if(key.startsWith('caption'))updateCaption(localTime());debounceHistory();
}
function applyCaptionPreset(id){
  const p={
    viral:{captionMode:'dynamic-stack',captionFont:'Poppins',captionFontSize:104,captionMaxWords:4,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:6,captionBackgroundOpacity:0},
    gold:{captionMode:'word',captionFont:'Montserrat',captionFontSize:94,captionMaxWords:5,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:5,captionBackgroundOpacity:0},
    clean:{captionMode:'phrase',captionFont:'Poppins',captionFontSize:72,captionMaxWords:7,captionPrimary:'#FFFFFF',captionHighlight:'#FFFFFF',captionOutline:'#000000',captionOutlineWidth:2,captionBackgroundOpacity:55},
    arabic:{captionMode:'phrase',captionFont:'Amiri',captionFontSize:96,captionMaxWords:8,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:4,captionBackgroundOpacity:25}
  };
  Object.assign(S.draft,p[id]||{});markDirty();pushHistory();renderInspector();updatePreview();updateCaption(localTime());toast('Caption style preview applied');
}
function adjustOffset(delta){S.offsetMs=clamp(S.offsetMs+delta,-1000,1000);markDirty();pushHistory();renderInspector();updateCaption(localTime());renderTimeline();toast(`Captions moved ${delta<0?'earlier':'later'} by ${Math.abs(delta)} ms`)}

function bindVideo(){
  const video=q('#dceVideo'),bg=q('#dceVideoBg'),music=q('#dceMusic'),stage=q('#dceStage');if(!video)return;
  const start=S.sourceBase;
  const init=()=>{try{video.currentTime=start;if(bg)bg.currentTime=start}catch{}updateCaption(0);updatePlayhead(0)};
  video.onloadedmetadata=init;
  video.onerror=()=>{
    if(S.sourceFallback)return;S.sourceFallback=true;S.sourceBase=0;
    video.src=withAuth(`/api/clips/${encodeURIComponent(S.clipId)}/video`);if(bg)bg.src=video.src;
    setPreviewStatus('Rendered clip fallback',true);
  };
  video.ontimeupdate=()=>{
    const t=localTime();syncBg();syncMusic();updateCaption(t);applyFraming(t);updatePlayhead(t);
    q('#dceTime').textContent=`${clock(t)} / ${clock(S.duration)}`;q('#dceTimelineTime').textContent=clock(t,true);
    if(t>=S.duration-.02){pauseAll();seek(0)}
  };
  video.onplay=()=>{S.playing=true;q('#dcePlay').innerHTML=ICON.pause;if(bg){syncBg(true);bg.play().catch(()=>{})}if(music&&S.audioReady){syncMusic(true);music.play().catch(()=>{})};setPreviewStatus('Playing live preview')};
  video.onpause=()=>{S.playing=false;q('#dcePlay').innerHTML=ICON.play;bg?.pause();music?.pause()};
  q('#dceTimeline').onclick=e=>{const body=e.target.closest('.dce-track-body,.dce-ruler');if(!body)return;const r=body.getBoundingClientRect();seek(clamp((e.clientX-r.left)/r.width,0,1)*S.duration)};
  stage.onpointerdown=e=>{
    if(S.draft.fitMode!=='crop'||S.draft.smartFramingEnabled)return;
    S.drag={x:e.clientX,y:e.clientY,px:Number(S.draft.cropPositionX??50),py:Number(S.draft.cropPositionY??50)};
    stage.setPointerCapture?.(e.pointerId);e.preventDefault();
  };
  stage.onpointermove=e=>{
    if(!S.drag)return;const r=stage.getBoundingClientRect();
    S.draft.cropPositionX=clamp(S.drag.px-(e.clientX-S.drag.x)/r.width*100,0,100);
    S.draft.cropPositionY=clamp(S.drag.py-(e.clientY-S.drag.y)/r.height*100,0,100);
    updatePreview();
  };
  const finish=()=>{if(!S.drag)return;S.drag=null;markDirty();pushHistory();renderInspector()};
  stage.onpointerup=finish;stage.onpointercancel=finish;
}
function togglePlay(){const v=q('#dceVideo');if(!v)return;v.paused?v.play():pauseAll()}
function pauseAll(){q('#dceVideo')?.pause();q('#dceVideoBg')?.pause();q('#dceMusic')?.pause()}
function seek(t){const v=q('#dceVideo'),bg=q('#dceVideoBg');if(!v)return;const local=clamp(t,0,S.duration);v.currentTime=S.sourceBase+local;if(bg)bg.currentTime=v.currentTime;updateCaption(local);applyFraming(local);updatePlayhead(local)}
function localTime(){const v=q('#dceVideo');return clamp((v?.currentTime||S.sourceBase)-S.sourceBase,0,S.duration)}
function syncBg(force=false){const v=q('#dceVideo'),bg=q('#dceVideoBg');if(!v||!bg)return;if(force||Math.abs(bg.currentTime-v.currentTime)>.1)try{bg.currentTime=v.currentTime}catch{}}
function syncMusic(force=false){const m=q('#dceMusic');if(!m||!S.audioReady)return;const t=localTime();m.volume=clamp(Number(S.draft.musicVolumePercent||0)/100,0,.5);if(force||Math.abs(m.currentTime-t)>.16)try{m.currentTime=t}catch{}}
function setPreviewStatus(text,bad=false,busy=false){const el=q('#dcePreviewStatus');if(!el)return;el.className=`dce-status ${bad?'bad':busy?'busy':''}`;q('span',el).textContent=text}

function updatePreview(){
  const d=S.draft,stage=q('#dceStage'),v=q('#dceVideo'),bg=q('#dceVideoBg'),cap=q('#dceCaption'),wm=q('#dceWatermark');if(!stage||!v)return;
  stage.style.aspectRatio=`${d.width}/${d.height}`;stage.dataset.mode=modeName();stage.classList.toggle('manual-fill',d.fitMode==='crop'&&!d.smartFramingEnabled);
  stage.classList.toggle('tracking',d.fitMode==='crop'&&d.smartFramingEnabled&&(S.framingState==='ready'||S.framingState==='analysing'));
  v.style.objectFit=d.fitMode==='crop'?'cover':'contain';bg.style.display=d.fitMode==='blur'?'block':'none';
  v.style.transform=d.fitMode==='crop'?`scale(${clamp(Number(d.cropScale??1),1,3)})`:'scale(1)';
  v.style.transformOrigin='center center';
  bg.style.filter=`blur(${Number(d.blurStrength||28)}px) brightness(.72)`;
  const filters={natural:'',crisp:'contrast(1.1) saturate(1.08)',warm:'sepia(.15) saturate(1.15)',cinematic:'contrast(1.14) saturate(.86)'};
  v.style.filter=`${filters[d.filterPreset||'natural']||''} brightness(${1+Number(d.brightness||0)}) contrast(${Number(d.contrast||1)}) saturate(${Number(d.saturation||1)})`;
  if(!d.smartFramingEnabled)applyManualCrop();else applyFraming(localTime());
  cap.className=`dce-caption ${d.captionPosition||'bottom'} ${d.captionHorizontal||'center'}`;
  cap.style.fontFamily=d.captionFont||'Poppins';cap.style.fontSize=`${clamp(Number(d.captionFontSize||92)/3.35,15,48)}px`;
  cap.style.color=d.captionPrimary||'#fff';cap.style.webkitTextStroke=`${Number(d.captionOutlineWidth||0)/3}px ${d.captionOutline||'#000'}`;
  cap.style.setProperty('--dce-cap-highlight',d.captionHighlight||'#d9b478');
  cap.style.setProperty('--dce-cap-bg',hexAlpha(d.captionBackground||'#000',Number(d.captionBackgroundOpacity||0)/100));
  wm.textContent=d.watermark||'';wm.style.opacity=clamp(Number(d.watermarkOpacity??100)/100,0,1);
  q('#dceModeBadge').textContent=d.fitMode==='crop'?(d.smartFramingEnabled?'Fill · AI speaker focus':`Fill · drag · ${Number(d.cropScale??1).toFixed(2)}× zoom`):d.fitMode==='blur'?'Blur · full source':'Fit · full source';
  markDirty(false);updateCaption(localTime());
}
function applyManualCrop(){const v=q('#dceVideo');if(v)v.style.objectPosition=`${clamp(S.draft.cropPositionX??50,0,100)}% ${clamp(S.draft.cropPositionY??50,0,100)}%`}
function frameAt(t){
  const p=S.framing;if(!p?.keyframes?.length)return null;const k=p.keyframes;
  if(t<=k[0].t)return k[0];for(let i=0;i<k.length-1;i++){const a=k[i],b=k[i+1];if(t<=b.t){const m=clamp((t-a.t)/Math.max(.01,b.t-a.t),0,1);return{x:a.x+(b.x-a.x)*m,y:a.y+(b.y-a.y)*m,w:a.w||p.w,h:a.h||p.h}}}return k.at(-1);
}
function applyFraming(t){
  const v=q('#dceVideo');if(!v||S.draft.fitMode!=='crop')return;
  if(S.draft.smartFramingEnabled&&S.framingState==='ready'&&S.framing){
    const f=frameAt(t),sw=Number(S.framing.srcW||0),sh=Number(S.framing.srcH||0);
    if(f&&sw&&sh){v.style.objectPosition=`${clamp((f.x+f.w/2)/sw*100,0,100)}% ${clamp((f.y+f.h/2)/sh*100,0,100)}%`;return}
  }
  if(S.draft.smartFramingEnabled){const pos={left:'28% 50%',center:'50% 50%',right:'72% 50%',auto:'50% 50%'};v.style.objectPosition=pos[S.draft.smartFramingBias||'auto']}else applyManualCrop();
}
function hexAlpha(hex,a){let h=String(hex).replace('#','');if(h.length===3)h=[...h].map(x=>x+x).join('');const n=parseInt(h,16);return`rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${clamp(a,0,1)})`}

async function loadCaptions(resync=false){
  try{
    const url=resync?`/api/clips/${encodeURIComponent(S.clipId)}/captions/resync`:`/api/clips/${encodeURIComponent(S.clipId)}/captions`;
    const p=await apiCall(url,{method:resync?'POST':'GET'});
    if(S.clipId!==currentClip()?.id)return;
    const words=(p.words||[]).map(w=>({word:String(w.word||'').trim(),start:Number(w.start),end:Number(w.end)})).filter(w=>w.word&&w.end>w.start).sort((a,b)=>a.start-b.start);
    if(words.length){S.words=words;S.captionSource=p.exact?'exact':'edited';S.captionText=p.transcript||S.captionText;updateCaption(localTime());renderTimeline()}
    else throw new Error('No word timings were returned.');
  }catch(e){S.captionSource='estimated';if(resync)throw e}
}
async function syncCaptions(){
  const b=q('#dceSync');if(b){b.disabled=true;b.textContent='Syncing…'}setPreviewStatus('Reloading Whisper timing',false,true);
  try{try{await loadCaptions(true)}catch(error){if(/not found|404/i.test(error.message))await loadCaptions(false);else throw error}S.offsetMs=-140;S.draft.captionTimingOffsetMs=S.offsetMs;markDirty();pushHistory();renderInspector();updateCaption(localTime());toast('Captions synced to saved speech timing');setPreviewStatus('Exact captions ready')}
  catch(e){toast(e.message,true);setPreviewStatus('Caption sync failed',true)}
}
function shiftedWords(){const shift=S.offsetMs/1000;return S.words.map(w=>({...w,start:Math.max(0,w.start+shift),end:Math.max(.05,w.end+shift)}))}
function groups(){
  const words=shiftedWords(),max=Math.max(1,Number(S.draft.captionMaxWords||5)),out=[];let start=0;
  for(let i=0;i<words.length;i++){const cur=words[i],next=words[i+1],gap=next?next.start-cur.end:99,punc=/[.!?…]["'’)]?$/.test(cur.word);
    if(i-start+1>=max||gap>.32||punc||!next){out.push({startIndex:start,endIndex:i,start:words[start].start,end:cur.end,text:words.slice(start,i+1).map(x=>x.word).join(' ')});start=i+1}}
  return out;
}
function segments(){return groups()}
function updateCaption(t){
  const box=q('#dceCaption');if(!box)return;const words=shiftedWords();const index=words.findIndex(w=>t>=w.start&&t<w.end+.035);
  if(index<0){box.innerHTML='';return}
  const group=groups().find(g=>index>=g.startIndex&&index<=g.endIndex);if(!group){box.innerHTML='';return}
  const mode=S.draft.captionMode||'word';const list=mode==='dynamic-stack'?words.slice(group.startIndex,index+1):words.slice(group.startIndex,group.endIndex+1);
  const html=mode==='dynamic-stack'?list.map((w,i)=>`<span class="dce-stack ${i===list.length-1?'active':''}">${esc(w.word)}</span>`).join(''):
    list.map((w,i)=>`<span class="dce-word ${group.startIndex+i===index?'active':''}">${esc(w.word)}</span>`).join(' ');
  box.innerHTML=`<span class="dce-cap-bg">${html}</span>`;
}
function approxWords(text,duration){const tokens=String(text||'').trim().split(/\s+/).filter(Boolean);const step=duration/Math.max(1,tokens.length);return tokens.map((word,i)=>({word,start:i*step,end:Math.min(duration,(i+1)*step)}))}
function remapWords(text,source,duration){const tokens=String(text||'').trim().split(/\s+/).filter(Boolean);if(!tokens.length)return[];if(!source.length)return approxWords(text,duration);
  return tokens.map((word,i)=>{const pos=tokens.length===1?0:i/(tokens.length-1)*(source.length-1),a=Math.floor(pos),b=Math.ceil(pos),m=pos-a;
    const start=source[a].start+(source[b].start-source[a].start)*m;const next=Math.min(source.length-1,pos+source.length/tokens.length),na=Math.floor(next),nb=Math.ceil(next),nm=next-na;
    const end=source[na].end+(source[nb].end-source[na].end)*nm;return{word,start,end:Math.max(start+.07,Math.min(duration,end))}})}

async function analyseFraming(){
  S.framingState='analysing';renderInspector();updatePreview();setPreviewStatus('Analysing active speaker',false,true);
  try{
    const p=await apiCall(`/api/clips/${encodeURIComponent(S.clipId)}/framing-preview`,{method:'POST',body:JSON.stringify({
      width:S.draft.width,height:S.draft.height,bias:S.draft.smartFramingBias||'auto',padding:S.draft.smartFramingPadding??.18,
      zoom:S.draft.smartFramingZoom??1,smoothing:S.draft.smartFramingSmoothing??.78
    })});
    if(!p.plan?.available)throw new Error(p.plan?.reason||'No speaker could be detected.');
    S.framing=p.plan;S.framingState='ready';markDirty();pushHistory();renderInspector();updatePreview();renderTimeline();
    toast(`Speaker tracking ready · ${Math.round((p.plan.confidence||0)*100)}% confidence`);setPreviewStatus('AI speaker tracking ready');
  }catch(e){S.framingState='error';renderInspector();updatePreview();const missing=/not found|404/i.test(e.message);toast(missing?'Speaker-tracking backend is not deployed. Run the complete Phase 6B installer and redeploy.':e.message,true);setPreviewStatus(missing?'Tracking backend missing':'Tracking failed',true)}
}
function framingMessage(){
  if(S.draft.fitMode!=='crop')return'Choose Fill to enable manual crop or AI speaker tracking.';
  if(!S.draft.smartFramingEnabled)return'Drag the video inside the preview. The caption layer stays fixed.';
  if(S.framingState==='analysing')return'Analysing faces, mouth movement and speaker continuity…';
  if(S.framingState==='ready')return`Tracking ready · ${Math.round((S.framing?.confidence||0)*100)}% confidence · ${S.framing?.keyframes?.length||0} framing points.`;
  if(S.framingState==='error')return'Automatic tracking could not finish. Choose Manual or a left/centre/right fallback.';
  return'Press Analyse and track speaker. The exported video will use the same tracking settings.';
}

async function loadAudio(){
  const tracks=appData()?.tracks||[],clip=currentClip();S.audioTrack=tracks.find(t=>t.name===clip?.musicName)||tracks[0]||null;
  const audio=q('#dceMusic');if(!audio||!S.audioTrack)return;
  audio.src=withAuth(`/api/music/${encodeURIComponent(S.audioTrack.id)}/audio`);
  audio.oncanplay=()=>{S.audioReady=true;audio.volume=clamp(Number(S.draft.musicVolumePercent||0)/100,0,.5)};
}
function renderTimeline(){
  const ruler=q('#dceRuler'),caps=q('#dceCaptionTrack'),frames=q('#dceFramingTrack');if(!ruler||!caps||!frames)return;
  ruler.innerHTML=Array.from({length:6},(_,i)=>`<span style="left:${i*20}%">${clock(S.duration*i/5)}</span>`).join('');
  caps.innerHTML=segments().map(g=>`<button class="dce-block caption" data-start="${g.start}" data-end="${g.end}" style="left:${g.start/S.duration*100}%;width:${Math.max(.7,(g.end-g.start)/S.duration*100)}%">${esc(g.text)}</button>`).join('');
  frames.innerHTML=(S.framing?.keyframes||[]).map(k=>`<i class="dce-key" style="left:${clamp(k.t/S.duration*100,0,100)}%"></i>`).join('');
  qa('.dce-block.caption').forEach(b=>b.onclick=e=>{e.stopPropagation();seek(Number(b.dataset.start))});
  updatePlayhead(localTime());
}
function updatePlayhead(t){
  const el=q('#dceHead'),timeline=q('#dceTimeline');if(el&&timeline)el.style.left=`${62+(timeline.clientWidth-62)*clamp(t/S.duration,0,1)}px`;
  qa('.dce-block.caption').forEach(b=>b.classList.toggle('active',t>=Number(b.dataset.start)&&t<Number(b.dataset.end)));
}

function markDirty(save=true){S.dirty=true;if(save)saveLocal();updateHeader()}
function updateHeader(){const s=q('#dceSaveState');if(s){s.textContent=S.dirty?'Unsaved changes':'Saved';s.classList.toggle('dirty',S.dirty)}}
let histTimer;
function debounceHistory(){clearTimeout(histTimer);histTimer=setTimeout(()=>pushHistory(),220)}
function snapshot(){return JSON.stringify({draft:cleanDraft(S.draft),captionText:S.captionText,offsetMs:S.offsetMs})}
function pushHistory(initial=false){const snap=snapshot();if(!initial&&S.history[S.historyIndex]===snap)return;S.history=S.history.slice(0,S.historyIndex+1);S.history.push(snap);if(S.history.length>40)S.history.shift();S.historyIndex=S.history.length-1;updateUndo()}
function updateUndo(){q('#dceUndo')?.toggleAttribute('disabled',S.historyIndex<=0);q('#dceRedo')?.toggleAttribute('disabled',S.historyIndex>=S.history.length-1)}
function restoreHistory(){const x=JSON.parse(S.history[S.historyIndex]);S.draft={...x.draft};S.captionText=x.captionText;S.offsetMs=x.offsetMs;S.words=remapWords(S.captionText,S.words,S.duration);markDirty();render()}
function undo(){if(S.historyIndex<=0)return;S.historyIndex--;restoreHistory()}
function redo(){if(S.historyIndex>=S.history.length-1)return;S.historyIndex++;restoreHistory()}
function cleanDraft(d){const x=deep(d);for(const k of ['id','builtIn','editable','updatedAt','version'])delete x[k];x.captionTimingOffsetMs=S.offsetMs;return x}

async function saveDetails(show=true){
  const c=currentClip();if(!c)return;
  const title=q('#dceInspector [data-key="metaTitle"]')?.value??c.title,description=q('#dceMetaDescription')?.value??c.description,hashtags=q('#dceMetaHashtags')?.value??c.hashtags;
  await apiCall(`/api/clips/${encodeURIComponent(c.id)}`,{method:'PATCH',body:JSON.stringify({title,description,hashtags,transcript:S.captionText})});
  if(show)toast('Post details saved');
}
async function saveAll(){
  const b=q('#dceSave');if(b){b.disabled=true;b.textContent='Saving…'}
  try{
    await apiCall(`/api/clips/${encodeURIComponent(S.clipId)}`,{method:'PATCH',body:JSON.stringify({transcript:S.captionText})});
    saveLocal();S.dirty=false;updateHeader();toast('Editor saved');
  }catch(e){toast(e.message,true)}finally{if(b){b.disabled=false;b.textContent='Save'}}
}
async function exportVideo(){
  const b=q('#dceExport');if(b){b.disabled=true;b.textContent='Preparing…'}setPreviewStatus('Preparing render',false,true);
  try{
    await apiCall(`/api/clips/${encodeURIComponent(S.clipId)}`,{method:'PATCH',body:JSON.stringify({transcript:S.captionText})});
    await apiCall('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Math.max(1,Math.round(Number(S.draft.musicVolumePercent||13)))})});
    const name=`${currentClip()?.title||'Clip'} · Edited`;
    const created=await apiCall('/api/templates',{method:'POST',body:JSON.stringify({template:{...cleanDraft(S.draft),id:'',name},select:false})});
    const asVariant=currentClip()?.status==='posted';
    await apiCall(`/api/clips/${encodeURIComponent(S.clipId)}/rerender`,{method:'POST',body:JSON.stringify({templateId:created.template.id,asVariant})});
    S.dirty=false;clearLocal();updateHeader();toast('Export queued. Watch Happening now.');setPreviewStatus('Render queued');
    q('[data-dc-nav="home"]')?.click();
  }catch(e){toast(e.message,true);setPreviewStatus('Export failed',true)}finally{if(b){b.disabled=false;b.textContent='Export video'}}
}

function ratioName(){const w=Number(S.draft.width),h=Number(S.draft.height);if(w===h)return'1:1';if(w===1080&&h===1350)return'4:5';if(w===1920&&h===1080)return'16:9';return'9:16'}
function clock(sec,decimal=false){const n=Math.max(0,Number(sec)||0),m=Math.floor(n/60),s=n%60;return decimal?`${m}:${s.toFixed(1).padStart(4,'0')}`:`${m}:${String(Math.floor(s)).padStart(2,'0')}`}

function boot(){ensureNav();setInterval(ensureNav,1200)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();