(() => {
'use strict';

const $ = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (n, a, b) => Math.min(b, Math.max(a, Number(n) || 0));
const clone = v => JSON.parse(JSON.stringify(v || {}));
const data = () => { try { return typeof DATA !== 'undefined' ? DATA : null; } catch { return null; } };
const authedUrl = url => {
  try {
    if (typeof withPw === 'function') return withPw(url);
    const password = typeof PW !== 'undefined' ? PW : '';
    if (!password) return url;
    return `${url}${url.includes('?') ? '&' : '?'}pw=${encodeURIComponent(password)}`;
  } catch { return url; }
};
const callApi = async (url, options={}) => {
  if (typeof api === 'function') return api(url, options);
  const headers = {'Content-Type':'application/json', ...(options.headers || {})};
  try { if (typeof PW !== 'undefined' && PW) headers['x-app-password'] = PW; } catch {}
  const response = await fetch(url, {...options, headers});
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {error:text}; }
  if (!response.ok) {
    if (response.status === 401 && payload.loginRequired) { window.location.href = '/login?returnTo=' + encodeURIComponent(location.pathname + location.search); return new Promise(()=>{}); }
    const error = new Error(payload.error || `${response.status} ${response.statusText}`);
    Object.assign(error, payload);
    throw error;
  }
  return payload;
};
const notify = (message, kind='good') => {
  if (typeof toast === 'function') return toast(message, kind);
  console[kind === 'bad' ? 'error' : 'log'](message);
};

const NOTIFICATION_DEFAULTS = Object.freeze({
  desktop:false, sounds:false, respectMedia:true, started:false, completed:true, publishing:true, failures:true, volume:55,
});
let notificationAudio = null;
let workflowBaseline = null;
let workflowBaselineUser = '';

function notificationUserKey(){
  const d=data();
  return String(d?.user?.id||d?.user?.email||d?.account?.id||'anon').replace(/[^a-zA-Z0-9_.@-]/g,'_');
}
function notificationStorageKey(){return `dc_notification_settings_${notificationUserKey()}`}
function notificationPrefs(){
  try{return {...NOTIFICATION_DEFAULTS,...JSON.parse(localStorage.getItem(notificationStorageKey())||'{}')}}catch{return {...NOTIFICATION_DEFAULTS}}
}
function saveNotificationPrefs(patch={}){
  const next={...notificationPrefs(),...patch};
  next.volume=clamp(next.volume,0,100);
  try{localStorage.setItem(notificationStorageKey(),JSON.stringify(next))}catch{}
  return next;
}
function notificationPermission(){
  if(!('Notification' in window))return'unsupported';
  return Notification.permission||'default';
}
function notificationPermissionCopy(){
  const permission=notificationPermission(),enabled=notificationPrefs().desktop&&permission==='granted';
  if(permission==='unsupported')return{tone:'bad',label:'Unavailable',copy:'This browser does not expose desktop notifications.'};
  if(permission==='denied')return{tone:'bad',label:'Blocked',copy:'Open this site’s browser settings and change Notifications to Allow.'};
  if(enabled)return{tone:'good',label:'Allowed',copy:'Chrome or Safari can alert you while DeenClipped is open.'};
  if(permission==='granted')return{tone:'warn',label:'Paused',copy:'Browser permission is allowed, but DeenClipped alerts are paused.'};
  return{tone:'warn',label:'Not enabled',copy:'Choose Enable notifications, then press Allow in your browser.'};
}
async function requestDesktopNotifications(){
  if(!('Notification' in window)){notify('Desktop notifications are not supported in this browser.','bad');return false}
  if(Notification.permission==='denied'){notify('Notifications are blocked. Open the site settings in Chrome or Safari and choose Allow.','bad');return false}
  const permission=await Notification.requestPermission();
  const allowed=permission==='granted';
  saveNotificationPrefs({desktop:allowed});
  if(allowed){
    pushDesktopNotification('DeenClipped notifications are on','We’ll tell you when clips finish, posts go live, or something needs attention.','notifications-ready','automation',true);
    playNotificationSound('complete',true);
    notify('Browser notifications enabled','good');
  }else notify('Notifications were not enabled. You can try again from Settings.','bad');
  return allowed;
}
function createNotificationAudio(){
  if(notificationAudio)return notificationAudio;
  const AudioContextClass=window.AudioContext||window.webkitAudioContext;
  if(!AudioContextClass)return null;
  try{notificationAudio=new AudioContextClass();return notificationAudio}catch{return null}
}
function playNotificationSound(kind='complete',force=false){
  const prefs=notificationPrefs();if(!force&&!prefs.sounds)return;
  if(!force&&prefs.respectMedia&&$$('video,audio').some(media=>!media.paused&&!media.ended))return;
  const context=createNotificationAudio();if(!context)return;
  const patterns={start:[[392,0,.08],[523,.10,.10]],complete:[[523,0,.09],[659,.11,.09],[784,.22,.16]],published:[[587,0,.08],[784,.1,.10],[988,.22,.18]],failure:[[330,0,.12],[247,.15,.18]],test:[[523,0,.08],[659,.1,.08],[880,.2,.16]]};
  const notes=patterns[kind]||patterns.complete,volume=clamp(prefs.volume,0,100)/100;
  try{
    if(context.state==='suspended')context.resume().catch(()=>{});
    const base=context.currentTime+.015;
    notes.forEach(([frequency,offset,duration])=>{
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.type=kind==='failure'?'triangle':'sine';oscillator.frequency.value=frequency;
      gain.gain.setValueAtTime(.0001,base+offset);gain.gain.exponentialRampToValueAtTime(Math.max(.0001,.12*volume),base+offset+.015);gain.gain.exponentialRampToValueAtTime(.0001,base+offset+duration);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start(base+offset);oscillator.stop(base+offset+duration+.025);
    });
  }catch{}
}
function pushDesktopNotification(title,body,tag,view='home',force=false){
  const prefs=notificationPrefs();
  if(notificationPermission()!=='granted'||(!force&&!prefs.desktop))return null;
  try{
    const notice=new Notification(title,{body,tag:`deenclipped-${tag}`,icon:'/marketing-assets/apple-touch-icon.png',badge:'/marketing-assets/favicon-32.png',silent:true});
    notice.onclick=()=>{window.focus();notice.close();if(view)go(view)};
    return notice;
  }catch{return null}
}
function workflowSnapshot(d){
  const snapshot={};
  (d?.projects||[]).forEach(project=>{
    snapshot[`project:${project.id}`]={status:project.status,title:project.title||'Lecture',kind:'project'};
    if(project.moreJob)snapshot[`more:${project.id}`]={status:project.moreJob.status,title:project.title||'Lecture',kind:'more'};
  });
  (d?.rerenderJobs||[]).forEach(job=>{
    const clip=(d.clips||[]).find(item=>item.id===job.clipId);
    snapshot[`render:${job.id||job.clipId}`]={status:job.status,title:clip?.title||'Clip',kind:'render'};
  });
  (d?.clips||[]).forEach(clip=>(clip.targets||[]).forEach(target=>{
    snapshot[`publish:${clip.id}:${target.provider}`]={status:target.status,title:clip.title||'Clip',provider:target.provider,kind:'publish'};
  }));
  return snapshot;
}
function workflowSignal(kind,title,body,tag,view){
  const prefs=notificationPrefs();
  if(kind==='start'&&!prefs.started)return;
  if(kind==='complete'&&!prefs.completed)return;
  if(kind==='published'&&!prefs.publishing)return;
  if(kind==='failure'&&!prefs.failures)return;
  playNotificationSound(kind);
  pushDesktopNotification(title,body,tag,view);
}
function detectWorkflowSignals(d){
  const user=notificationUserKey(),current=workflowSnapshot(d);
  if(!workflowBaseline||workflowBaselineUser!==user){workflowBaseline=current;workflowBaselineUser=user;return}
  const active=new Set(['queued','processing','retrying','publishing','uploading','rendering','transcribing','analysing','creating clips']);
  Object.entries(current).forEach(([key,item])=>{
    const previous=workflowBaseline[key];if(!previous||previous.status===item.status)return;
    if(!active.has(previous.status)&&active.has(item.status))workflowSignal('start','DeenClipped is working',`${item.title} has started ${item.kind==='publish'?'publishing':'processing'}.`,`${key}:start`,item.kind==='publish'?'schedule':'home');
    if(active.has(previous.status)&&['completed','done','waiting','ready'].includes(item.status))workflowSignal('complete','Your clips are ready',`${item.title} finished processing and is ready to review.`,`${key}:complete`,'review');
    if(item.kind==='publish'&&item.status==='posted')workflowSignal('published','Your clip is live',`${item.title} finished publishing to ${item.provider||'your channel'}.`,`${key}:posted`,'schedule');
    if(item.status==='failed'||item.status==='publish_failed')workflowSignal('failure','DeenClipped needs your attention',`${item.title} did not finish. Open the workspace to review the error.`,`${key}:failed`,item.kind==='publish'?'schedule':'projects');
  });
  workflowBaseline=current;
}

const ICON = {
  home:'<svg viewBox="0 0 24 24"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/><path d="m9 21 6 0"/></svg>',
  projects:'<svg viewBox="0 0 24 24"><path d="M3 7.5h6l2-2h10v14H3Z"/><path d="M3 10h18"/></svg>',
  review:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 3v3h6V3M8 13l2.3 2.3L16.5 9"/></svg>',
  editor:'<svg viewBox="0 0 24 24"><path d="M4 20h4l11-11-4-4L4 16Z"/><path d="m13.5 6.5 4 4M4 12H2m20 0h-2M12 4V2m0 20v-2"/></svg>',
  publish:'<svg viewBox="0 0 24 24"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5"/><path d="M5 14v5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5"/></svg>',
  analytics:'<svg viewBox="0 0 24 24"><path d="M4 20V10m5 10V4m6 16v-7m5 7H2"/><path d="m4 7 5-4 6 6 5-4"/></svg>',
  social:'<svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="3"/><circle cx="18" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="m8.7 10.7 6.6-3.4m-6.6 6 6.6 3.4"/></svg>',
  music:'<svg viewBox="0 0 24 24"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M9 9l11-2"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><path d="M4 7h10m4 0h2M4 17h2m4 0h10M4 12h3m4 0h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/><circle cx="9" cy="12" r="2"/></svg>',
  captions:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10a3 3 0 1 0 0 4m7-4a3 3 0 1 0 0 4"/></svg>',
  canvas:'<svg viewBox="0 0 24 24"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8v8H8Z"/></svg>',
  style:'<svg viewBox="0 0 24 24"><path d="M12 3 4 8v8l8 5 8-5V8Z"/><path d="m4 8 8 5 8-5M12 13v8"/></svg>',
  audio:'<svg viewBox="0 0 24 24"><path d="M5 9v6h4l5 4V5L9 9Z"/><path d="M17 9a4 4 0 0 1 0 6m2-8a7 7 0 0 1 0 10"/></svg>',
  details:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5Z"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  chevron:'<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  search:'<svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>',
  menu:'<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  collapse:'<svg viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>',
  undo:'<svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5"/><path d="M5 12h8a6 6 0 0 1 6 6"/></svg>',
  redo:'<svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5"/><path d="M19 12h-8a6 6 0 0 0-6 6"/></svg>',
  play:'<svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7Z"/></svg>',
  pause:'<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14"/></svg>',
  back:'<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg>',
  check:'<svg viewBox="0 0 24 24"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
  warning:'<svg viewBox="0 0 24 24"><path d="M12 3 2.5 20.5h19Z"/><path d="M12 9v5m0 3h.01"/></svg>',
  clock:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  sparkles:'<svg viewBox="0 0 24 24"><path d="M12 3 13.8 8.2 19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8Z"/><path d="M19 15l.9 2.6 2.6.9-2.6.9L19 23l-.9-2.6-2.6-.9 2.6-.9Z"/></svg>',
  tokens:'<svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9Z"/><path d="M8.3 9.7 12 7.7l3.7 2-3.7 2.1Z"/><path d="M12 11.8v4.5"/></svg>',
  billing:'<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 9h18M7 15h4"/></svg>',
  scissors:'<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.7 8.7 20 20M8.7 15.3 20 4"/></svg>',
  brand:'<svg viewBox="0 0 24 24"><path d="M12 3 4 7v6c0 4.6 3.1 7.1 8 8 4.9-.9 8-3.4 8-8V7Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  lab:'<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v5l-5 9a2.5 2.5 0 0 0 2.2 4h9.6A2.5 2.5 0 0 0 19 17l-5-9V3"/><path d="M7.5 16h9M9.5 12h5"/></svg>',
  youtube:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>',
  tiktok:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.7 2c.4 3.2 2.2 5.1 5.3 5.3v3.6c-1.8.2-3.5-.4-5.2-1.5v6.8c0 8.6-9.4 11.3-13.2 5.1-2.5-4.1-1-11.3 7-11.6v3.8c-.6.1-1.2.2-1.7.4-1.6.5-2.5 2-2.2 3.7.6 3.2 6.3 4.1 5.8-2.1V2h4.2Z"/></svg>',
  instagram:'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>',
  facebook:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.3-1.3 1.4-1.3H18V2.2c-.5-.1-2.1-.2-3.3-.2-3.2 0-5.2 1.9-5.2 5.3v1.2H6v3.7h3.5V22H14v-9.8h3.5l.6-3.7H14Z"/></svg>',
};

const CREATE_NAV = [
  ['home','Home','home'], ['projects','Projects','projects'], ['review','Review','review']
];
const PUBLISH_NAV = [
  ['schedule','Publishing','publish'], ['publishing','Channels','social']
];
const STUDIO_NAV = [
  ['templates','Templates','style'], ['brand','Brand Kit','brand'], ['lab','Creator Lab','lab'],
  ['music','Audio','music'], ['insights','Insights','analytics'], ['automation','Settings','settings']
];
const ACCOUNT_NAV = [['subscription','Subscription','billing']];
const NAV = [...CREATE_NAV, ...PUBLISH_NAV, ...STUDIO_NAV, ...ACCOUNT_NAV];
const MANAGE = [];
const CUSTOM = new Set(['home','projects','review','editor','schedule','publishing','templates','brand','lab','music','automation','insights','subscription','admin']);

let currentView = 'home';
let selectedProjectId = '';
let reviewFocusClipId = '';
let selectedClipId = '';
let projectQuery = '';
let projectFilter = 'all';
let projectSort = 'newest';
let reviewFilter = 'all';
let reviewSort = 'score';
let publishingQueueTab = 'slots';
let publishingSlotDays = 5;
let shellReady = false;
let lastDataSignature = '';
let lastWriteAt = 0;
let requestMap = new Map();

const editor = {
  tool:'captions', captionTab:'styles', clipId:'', draft:null, captionText:'', captionWords:[],
  captionSource:'fallback', dirty:false, loading:false, history:[], historyIndex:-1,
  currentTime:0, trimIn:0, trimOut:0, playing:false, search:'', presetId:'',
  sourceBase:0, sourceEnd:0, sourceFallback:false, framingPlan:null, framingStatus:'idle',
  framingMessage:'Active-speaker framing has not been analysed', framingRequest:0, framingTimer:null,
  canvasDragging:false, canvasDragStart:null, backendCaptionReady:false,
  selectedLayer:'captions', safeZones:true, localSavedAt:0, saving:false, exporting:false, captionTimingReference:[],
};

const css = String.raw`
:root{--dc-bg:#08080a;--dc-panel:#111113;--dc-panel2:#17171a;--dc-panel3:#202024;--dc-line:#29292f;--dc-line2:#3a3a42;--dc-text:#f7f7f8;--dc-muted:#a1a1ab;--dc-subtle:#74747e;--dc-accent:#d9b478;--dc-accent2:#f0d29e;--dc-green:#53c78b;--dc-red:#ef6b7a;--dc-orange:#e5a957;--dc-side:236px;--dc-top:68px;--dc-radius:10px;--dc-shadow:0 18px 55px rgba(0,0,0,.42)}
*{box-sizing:border-box}body.dc-app{background:var(--dc-bg)!important;overflow-x:hidden}body.dc-app #app>.wrap{width:auto!important;max-width:none!important;margin:0!important;padding:calc(var(--dc-top) + 24px) 24px 110px calc(var(--dc-side) + 24px)!important;transition:padding-left .18s ease}body.dc-app .top,body.dc-app .side{display:none!important}body.dc-app .shell{display:block!important;padding:0!important}body.dc-app .main-col{width:100%!important;min-width:0!important}body.dc-app .panel{max-width:1540px;margin:0 auto;min-width:0}body.dc-app .panel *{min-width:0}body.dc-app.dc-side-collapsed{--dc-side:72px}button{font:inherit}.dc-icon svg,.dc-nav-icon svg,.dc-tool-icon svg,.dc-svg svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
#dcSidebar{position:fixed;inset:0 auto 0 0;z-index:190;width:var(--dc-side);display:flex;flex-direction:column;background:#0c0c0e;border-right:1px solid var(--dc-line);transition:width .18s ease}#dcBrand{height:var(--dc-top);display:flex;align-items:center;gap:11px;padding:0 16px;border-bottom:1px solid var(--dc-line);overflow:hidden}.dc-logo{width:38px;height:38px;flex:0 0 38px;border:1px solid rgba(217,180,120,.28);border-radius:10px;background:rgba(217,180,120,.08);display:grid;place-items:center;color:var(--dc-accent)}.dc-logo svg{width:20px;height:22px}.dc-brand-copy strong,.dc-brand-copy span{display:block;white-space:nowrap}.dc-brand-copy strong{font-size:15px}.dc-brand-copy span{font-size:9px;color:var(--dc-subtle);margin-top:2px}.dc-nav-scroll{flex:1;overflow:auto;padding:12px 9px}.dc-nav-label{padding:11px 10px 6px;color:var(--dc-subtle);font-size:9px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;white-space:nowrap}.dc-nav-button{width:100%;min-height:42px;display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:8px;color:var(--dc-muted);text-align:left;margin-bottom:3px}.dc-nav-button:hover{background:var(--dc-panel2);color:var(--dc-text)}.dc-nav-button.is-active{background:rgba(217,180,120,.11);color:var(--dc-text)}.dc-nav-button.is-active .dc-nav-icon{color:var(--dc-accent)}.dc-nav-icon{width:21px;height:21px;flex:0 0 21px;display:grid;place-items:center}.dc-nav-name{font-size:12.5px;font-weight:540;white-space:nowrap}.dc-sidebar-bottom{padding:9px;border-top:1px solid var(--dc-line)}.dc-collapse{width:100%;height:40px;display:flex;align-items:center;gap:11px;padding:0 10px;border-radius:8px;color:var(--dc-subtle)}.dc-collapse:hover{background:var(--dc-panel2);color:var(--dc-text)}.dc-collapse span{font-size:11px;white-space:nowrap}body.dc-side-collapsed .dc-brand-copy,body.dc-side-collapsed .dc-nav-label,body.dc-side-collapsed .dc-nav-name,body.dc-side-collapsed .dc-collapse span{display:none}body.dc-side-collapsed #dcBrand,body.dc-side-collapsed .dc-nav-button,body.dc-side-collapsed .dc-collapse{justify-content:center;padding-left:0;padding-right:0}
#dcTopbar{position:fixed;inset:0 0 auto var(--dc-side);z-index:180;height:var(--dc-top);display:flex;align-items:center;gap:14px;padding:0 24px;background:rgba(10,10,12,.94);backdrop-filter:blur(16px);border-bottom:1px solid var(--dc-line);transition:left .18s ease}.dc-mobile-menu{display:none;width:38px;height:38px;border-radius:8px;color:var(--dc-muted)}.dc-page-title{min-width:190px}.dc-page-title strong,.dc-page-title span{display:block}.dc-page-title strong{font-size:14px}.dc-page-title span{font-size:9px;color:var(--dc-subtle);margin-top:2px}.dc-global-search{position:relative;flex:1;max-width:620px}.dc-global-search>svg{position:absolute;left:12px;top:10px;width:17px;height:17px;fill:none;stroke:var(--dc-subtle);stroke-width:1.7}.dc-global-search input{width:100%;height:38px!important;min-height:38px!important;padding:0 38px!important;border:1px solid var(--dc-line)!important;border-radius:8px!important;background:var(--dc-panel)!important;color:var(--dc-text)!important}.dc-search-results{display:none;position:absolute;top:44px;left:0;right:0;max-height:420px;overflow:auto;padding:7px;background:#111113;border:1px solid var(--dc-line2);border-radius:9px;box-shadow:var(--dc-shadow)}.dc-search-results.show{display:block}.dc-search-results button{width:100%;display:flex;align-items:center;gap:10px;padding:9px;border-radius:7px;text-align:left;color:var(--dc-text)}.dc-search-results button:hover{background:var(--dc-panel2)}.dc-search-results img{width:48px;height:34px;object-fit:cover;border-radius:5px}.dc-search-results strong,.dc-search-results span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-search-results strong{font-size:11px}.dc-search-results span{font-size:9px;color:var(--dc-muted);margin-top:2px}.dc-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px}.dc-health{display:flex;align-items:center;gap:7px;color:var(--dc-muted);font-size:10px;white-space:nowrap}.dc-health i{width:7px;height:7px;border-radius:50%;background:var(--dc-green)}.dc-health.busy i{background:var(--dc-accent);animation:dcPulse 1s infinite}.dc-health.bad i{background:var(--dc-red)}
.dc-btn{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 13px;border:1px solid transparent;border-radius:8px;background:var(--dc-accent);color:#191207;font-size:11px;font-weight:650;white-space:nowrap}.dc-btn:hover:not(:disabled){background:var(--dc-accent2)}.dc-btn.secondary{background:transparent;color:var(--dc-text);border-color:var(--dc-line)}.dc-btn.secondary:hover:not(:disabled){background:var(--dc-panel2);border-color:var(--dc-line2)}.dc-btn.danger{background:transparent;color:var(--dc-red);border-color:rgba(239,107,122,.3)}.dc-btn:disabled{opacity:.45;cursor:not-allowed}.dc-icon-btn{width:36px;height:36px;display:grid;place-items:center;border:1px solid var(--dc-line);border-radius:8px;color:var(--dc-muted)}.dc-icon-btn:hover:not(:disabled){background:var(--dc-panel2);color:var(--dc-text)}.dc-page-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:17px}.dc-page-head h1{font-size:26px;margin:0;letter-spacing:-.02em}.dc-page-head p{font-size:11px;color:var(--dc-muted);margin:5px 0 0}.dc-card{background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:var(--dc-radius)}.dc-card-pad{padding:17px}.dc-card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:13px}.dc-card-head h2{font-size:13px;margin:0}.dc-card-head p{font-size:9px;color:var(--dc-muted);margin:3px 0 0}.dc-pill{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;background:var(--dc-panel3);color:var(--dc-muted);font-size:9px}.dc-pill.good{background:rgba(83,199,139,.1);color:var(--dc-green)}.dc-pill.warn{background:rgba(229,169,87,.1);color:var(--dc-orange)}.dc-pill.bad{background:rgba(239,107,122,.1);color:var(--dc-red)}.dc-empty{padding:26px 16px;text-align:center;color:var(--dc-muted);font-size:10px;border:1px dashed var(--dc-line);border-radius:8px}.dc-empty strong{display:block;color:var(--dc-text);font-size:12px;margin-bottom:4px}
.dc-create-card{padding:22px;background:linear-gradient(135deg,#18130d,#111113 48%);border-color:rgba(217,180,120,.25)}.dc-create-card h2{font-size:23px;margin:0}.dc-create-card>p{font-size:10px;color:var(--dc-muted);margin:6px 0 15px}.dc-create-grid{display:grid;grid-template-columns:minmax(260px,1fr) 170px 120px 145px auto;gap:8px}.dc-create-grid input,.dc-create-grid select,.dc-filterbar input,.dc-filterbar select,.dc-tool-panel input,.dc-tool-panel select,.dc-tool-panel textarea{width:100%;height:38px;min-height:38px;padding:0 10px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d;color:var(--dc-text)}.dc-tool-panel textarea{height:auto;min-height:88px;padding:9px;resize:vertical}.dc-home-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:14px 0}.dc-metric{padding:14px;background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:9px}.dc-metric strong,.dc-metric span{display:block}.dc-metric strong{font-size:21px}.dc-metric span{font-size:9px;color:var(--dc-muted);margin-top:3px}.dc-home-grid{display:grid;grid-template-columns:minmax(0,1.32fr) minmax(330px,.68fr);gap:14px}.dc-stack{display:flex;flex-direction:column;gap:14px}.dc-now-list,.dc-row-list{display:flex;flex-direction:column;gap:7px}.dc-now-row,.dc-list-row{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d}.dc-now-main,.dc-list-copy{flex:1;min-width:0}.dc-now-main strong,.dc-now-main span,.dc-list-copy strong,.dc-list-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-now-main strong,.dc-list-copy strong{font-size:10.5px}.dc-now-main span,.dc-list-copy span{font-size:9px;color:var(--dc-muted);margin-top:2px}.dc-spinner{width:13px;height:13px;flex:0 0 13px;border:2px solid var(--dc-line2);border-top-color:var(--dc-accent);border-radius:50%;animation:dcSpin .8s linear infinite}.dc-progress{height:3px;margin-top:7px;background:var(--dc-line);border-radius:99px;overflow:hidden}.dc-progress i{display:block;height:100%;background:var(--dc-accent)}.dc-thumb{width:58px;height:38px;flex:0 0 58px;object-fit:cover;border-radius:5px;background:#000}.dc-social-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dc-social-card{padding:11px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d}.dc-social-top{display:flex;align-items:center;gap:8px}.dc-social-logo{width:29px;height:29px;display:grid;place-items:center;border-radius:8px;background:var(--dc-panel3);font-size:10px;font-weight:800}.dc-social-copy{flex:1;min-width:0}.dc-social-copy strong,.dc-social-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-social-copy strong{font-size:10px}.dc-social-copy span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-social-card .dc-btn{width:100%;height:31px;min-height:31px;margin-top:8px;font-size:9px}
.dc-filterbar{display:grid;grid-template-columns:minmax(220px,1fr) 170px 170px;gap:8px;margin-bottom:13px}.dc-project-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:12px}.dc-project-card{overflow:hidden;background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:10px}.dc-project-cover{height:150px;position:relative;background:#0b0b0d;overflow:hidden}.dc-project-cover img{width:100%;height:100%;object-fit:cover;filter:brightness(.78)}.dc-project-cover .dc-project-status{position:absolute;top:10px;right:10px}.dc-project-body{padding:14px}.dc-project-body h3{font-size:13px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-project-body p{font-size:9px;color:var(--dc-muted);margin:5px 0 12px}.dc-project-stats{display:flex;gap:12px;margin-bottom:12px}.dc-project-stat strong,.dc-project-stat span{display:block}.dc-project-stat strong{font-size:12px}.dc-project-stat span{font-size:8px;color:var(--dc-subtle)}.dc-project-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-project-detail-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}.dc-project-detail-copy{flex:1}.dc-project-detail-copy h1{font-size:20px;margin:0}.dc-project-detail-copy p{font-size:10px;color:var(--dc-muted);margin:4px 0 0}.dc-clip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px}.dc-clip-card{overflow:hidden;background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:10px}.dc-clip-media{position:relative;width:100%;aspect-ratio:9/16;background:#000;overflow:hidden}.dc-clip-media img{width:100%;height:100%;object-fit:cover}.dc-score{position:absolute;left:9px;bottom:9px;min-width:30px;height:24px;padding:0 7px;display:grid;place-items:center;border-radius:999px;background:#0a0a0dcc;color:#b9ff69;font-size:10px;font-weight:800}.dc-duration{position:absolute;right:9px;top:9px;padding:4px 7px;border-radius:999px;background:#0a0a0dcc;color:#fff;font-size:9px}.dc-clip-body{padding:12px}.dc-clip-body h3{font-size:11px;line-height:1.35;margin:0;min-height:30px}.dc-clip-body p{font-size:8.5px;color:var(--dc-muted);margin:5px 0 10px}.dc-clip-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-clip-actions .dc-btn{width:100%;min-width:0;padding:0 7px;font-size:9.5px}.dc-review-toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px}.dc-review-toolbar .spacer{flex:1}
.dc-editor-page{max-width:none!important;height:calc(100vh - var(--dc-top) - 42px);min-height:650px}.dc-editor-header{height:52px;display:flex;align-items:center;gap:9px;padding:0 11px;border:1px solid var(--dc-line);border-bottom:0;border-radius:10px 10px 0 0;background:var(--dc-panel)}.dc-editor-title{flex:1;min-width:0}.dc-editor-title strong,.dc-editor-title span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-editor-title strong{font-size:11px}.dc-editor-title span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-editor-workspace{height:calc(100% - 52px);display:grid;grid-template-columns:62px 292px minmax(390px,1fr);grid-template-rows:minmax(0,1fr) 174px;border:1px solid var(--dc-line);border-radius:0 0 10px 10px;overflow:hidden;background:#080809}.dc-tool-rail{grid-row:1/3;padding:8px 6px;background:#0d0d0f;border-right:1px solid var(--dc-line);display:flex;flex-direction:column;gap:5px}.dc-tool-button{width:50px;min-height:54px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;border-radius:8px;color:var(--dc-subtle)}.dc-tool-button:hover{background:var(--dc-panel2);color:var(--dc-text)}.dc-tool-button.on{background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-tool-icon{width:20px;height:20px}.dc-tool-button span{font-size:7.5px}.dc-tool-panel{grid-row:1/3;display:flex;flex-direction:column;background:var(--dc-panel);border-right:1px solid var(--dc-line);overflow:hidden}.dc-tool-head{height:50px;flex:0 0 50px;display:flex;align-items:center;justify-content:space-between;padding:0 13px;border-bottom:1px solid var(--dc-line)}.dc-tool-head strong{font-size:11px}.dc-tool-content{flex:1;overflow:auto;padding:12px}.dc-subtabs{display:flex;gap:4px;padding:4px;background:#0b0b0d;border:1px solid var(--dc-line);border-radius:8px;margin-bottom:12px}.dc-subtabs button{flex:1;min-height:30px;border-radius:6px;color:var(--dc-muted);font-size:8.5px}.dc-subtabs button.on{background:var(--dc-panel3);color:var(--dc-text)}.dc-section{margin-bottom:16px}.dc-section h3{font-size:9px;color:var(--dc-accent2);text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}.dc-field{margin-bottom:9px}.dc-field>label{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:8.5px;color:var(--dc-muted);margin-bottom:5px}.dc-field>label b{color:var(--dc-text);font-size:8px}.dc-field input[type=range]{height:22px;padding:0;background:transparent;border:0}.dc-field input[type=color]{height:36px;padding:3px}.dc-check{display:flex!important;align-items:center!important;justify-content:flex-start!important;gap:7px!important;font-size:9px!important;color:var(--dc-muted)!important}.dc-check input{width:15px!important;height:15px!important;min-height:15px!important}.dc-style-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-style-card{min-height:76px;padding:9px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d;color:var(--dc-muted);text-align:left}.dc-style-card:hover,.dc-style-card.on{border-color:rgba(217,180,120,.65);color:var(--dc-text)}.dc-style-preview{height:31px;display:grid;place-items:center;border-radius:5px;background:#25252a;color:#fff;font-size:9px;font-weight:800;overflow:hidden}.dc-style-card b,.dc-style-card span{display:block}.dc-style-card b{font-size:8.5px;margin-top:7px}.dc-style-card span{font-size:7.5px;color:var(--dc-subtle);margin-top:2px}.dc-color-grid{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-position-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}.dc-position-grid button{height:34px;border:1px solid var(--dc-line);border-radius:6px;color:var(--dc-subtle)}.dc-position-grid button.on{border-color:var(--dc-accent);background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-caption-editor{min-height:160px!important;line-height:1.5}.dc-caption-note{padding:9px;border:1px solid var(--dc-line);border-radius:7px;background:#0b0b0d;color:var(--dc-muted);font-size:8px;line-height:1.5}.dc-caption-list{display:flex;flex-direction:column;gap:5px;max-height:260px;overflow:auto}.dc-caption-line{display:grid;grid-template-columns:40px 1fr;gap:7px;padding:7px;border:1px solid var(--dc-line);border-radius:7px;background:#0b0b0d}.dc-caption-line span{font-size:8px;color:var(--dc-subtle)}.dc-caption-line b{font-size:8.5px;line-height:1.4}.dc-canvas-area{grid-column:3;grid-row:1;display:flex;flex-direction:column;min-width:0;background:#070708}.dc-canvas-toolbar{height:48px;display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid var(--dc-line);background:#0c0c0e}.dc-canvas-toolbar .spacer{flex:1}.dc-zoom{font-size:8.5px;color:var(--dc-muted)}.dc-canvas-wrap{flex:1;display:grid;place-items:center;padding:16px;overflow:hidden;background-image:linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}.dc-video-canvas{position:relative;height:min(59vh,610px);max-width:100%;aspect-ratio:9/16;background:#000;overflow:hidden;box-shadow:0 18px 60px #000;border-radius:2px}.dc-video-canvas video{width:100%;height:100%;object-fit:contain}.dc-caption-overlay{position:absolute;left:50%;top:58%;width:86%;z-index:14;display:flex;flex-direction:column;align-items:center;pointer-events:auto;touch-action:none;cursor:grab;font-weight:800;line-height:.95;text-align:center;color:#fff;font-size:28px;-webkit-text-stroke:1.4px #000;paint-order:stroke fill;transform:translate(-50%,-50%);user-select:none}.dc-caption-overlay.is-dragging{cursor:grabbing}.dc-caption-overlay.is-resizing{cursor:nwse-resize}.dc-caption-overlay.is-selected{outline:1px solid rgba(255,255,255,.72);outline-offset:8px}.dc-caption-overlay.is-selected::after,.dc-caption-overlay.is-dragging::after,.dc-caption-overlay.is-resizing::after{content:'';position:absolute;right:-14px;bottom:-14px;width:28px;height:28px;border:3px solid #fff;border-radius:999px;background:rgba(0,0,0,.88);box-shadow:0 2px 14px #000;cursor:nwse-resize}.dc-caption-overlay.align-left{text-align:left;align-items:flex-start}.dc-caption-overlay.align-right{text-align:right;align-items:flex-end}.dc-snap-guide{position:absolute;z-index:18;pointer-events:none;display:none;background:rgba(217,180,120,.72);box-shadow:0 0 8px rgba(217,180,120,.3)}.dc-snap-guide.show{display:block}.dc-snap-guide.vertical{top:0;bottom:0;width:1px}.dc-snap-guide.horizontal{left:0;right:0;height:1px}.dc-caption-word{display:inline-block;margin:0 .08em}.dc-caption-word.active{color:var(--dc-cap-highlight,#fff);font-family:var(--dc-cap-highlight-font,serif);font-style:var(--dc-cap-highlight-style,italic);text-shadow:0 0 var(--dc-cap-highlight-glow,0px) currentColor;transform:scale(1.08)}.dc-caption-stack-line{display:block}.dc-caption-stack-line.active{color:var(--dc-cap-highlight,#fff);font-family:var(--dc-cap-highlight-font,serif);font-style:var(--dc-cap-highlight-style,italic);text-shadow:0 0 var(--dc-cap-highlight-glow,0px) currentColor;transform:scale(1.08)}.dc-caption-word.is-arabic,.dc-caption-stack-line.is-arabic{font-family:var(--dc-cap-arabic-font,Amiri),serif;font-style:normal}.dc-caption-bg{padding:.12em .28em;border-radius:.18em;background:var(--dc-cap-bg-color,transparent)}.dc-watermark{position:absolute;z-index:5;color:#d9b478;font-size:11px;font-weight:800;letter-spacing:.08em}.dc-watermark.top-left{top:4%;left:4%}.dc-watermark.top-center{top:4%;left:50%;transform:translateX(-50%)}.dc-watermark.top-right{top:4%;right:4%}.dc-watermark.bottom-left{bottom:4%;left:4%}.dc-watermark.bottom-center{bottom:4%;left:50%;transform:translateX(-50%)}.dc-watermark.bottom-right{bottom:4%;right:4%}.dc-brand-line{position:absolute;left:0;right:0;bottom:0;height:4px;background:var(--dc-accent)}.dc-caption-status{position:absolute;left:8px;bottom:8px;z-index:7;padding:4px 6px;border-radius:5px;background:#000b;color:#bbb;font-size:7px}.dc-timeline{grid-column:3;grid-row:2;padding:9px 11px 10px;background:var(--dc-panel);border-top:1px solid var(--dc-line);overflow:hidden}.dc-timeline-top{height:28px;display:flex;align-items:center;gap:8px}.dc-timeline-time{font-variant-numeric:tabular-nums;color:var(--dc-muted);font-size:8.5px}.dc-timeline-top .spacer{flex:1}.dc-timeline-scroll{position:relative;height:124px;overflow:auto;border:1px solid var(--dc-line);border-radius:7px;background:#0b0b0d}.dc-ruler{position:relative;height:20px;min-width:var(--dc-timeline-width,100%);border-bottom:1px solid var(--dc-line);background:#0e0e10}.dc-ruler span{position:absolute;top:5px;font-size:7px;color:var(--dc-subtle);transform:translateX(-50%)}.dc-track-row{height:33px;min-width:var(--dc-timeline-width,100%);display:grid;grid-template-columns:56px 1fr;border-bottom:1px solid rgba(41,41,47,.8)}.dc-track-row:last-child{border-bottom:0}.dc-track-label{display:flex;align-items:center;padding:0 7px;border-right:1px solid var(--dc-line);font-size:7.5px;color:var(--dc-subtle)}.dc-track-content{position:relative;overflow:hidden}.dc-video-block,.dc-audio-block{position:absolute;top:5px;bottom:5px;left:1%;right:1%;border-radius:4px;background:#325c7e;color:#dcefff;font-size:7px;display:flex;align-items:center;padding:0 6px}.dc-audio-block{background:#4e6540;color:#e5f8d7}.dc-caption-block{position:absolute;top:4px;bottom:4px;border-radius:4px;background:#6a4e7d;color:#f3e6fb;font-size:6.5px;display:flex;align-items:center;padding:0 4px;overflow:hidden;white-space:nowrap;cursor:pointer;border:1px solid transparent}.dc-caption-block.active{border-color:#fff;background:#8b61a4}.dc-playhead{position:absolute;top:20px;bottom:0;width:1px;background:var(--dc-accent);z-index:8;pointer-events:none}.dc-playhead::before{content:'';position:absolute;top:-4px;left:-4px;width:9px;height:9px;border-radius:50%;background:var(--dc-accent)}
#dcWork{position:fixed;left:50%;bottom:22px;z-index:300;display:none;align-items:center;gap:12px;width:min(620px,calc(100vw - 34px));min-height:62px;padding:10px 48px 10px 16px;border:1px solid rgba(217,180,120,.34);border-radius:999px;background:linear-gradient(135deg,rgba(18,18,22,.78),rgba(9,9,11,.66));box-shadow:0 0 0 1px rgba(255,255,255,.045) inset,0 0 34px rgba(217,180,120,.22),0 20px 70px rgba(0,0,0,.48);backdrop-filter:blur(20px) saturate(1.18);transform:translate(-50%,18px) scale(.98);opacity:0;overflow:hidden;pointer-events:none}#dcWork.show{display:flex;pointer-events:auto;animation:dcWorkIn .28s cubic-bezier(.2,.8,.2,1) forwards}#dcWork::before{content:'';position:absolute;inset:-2px;background:linear-gradient(100deg,transparent,rgba(217,180,120,.15),rgba(85,183,255,.10),transparent);transform:translateX(-110%);animation:dcWorkGlow 2.3s linear infinite;pointer-events:none}#dcWork .dc-work-toast-orb{position:relative;z-index:1;width:38px;height:38px;flex:0 0 38px;border-radius:50%;display:grid;place-items:center;background:rgba(217,180,120,.14);color:var(--dc-accent2);box-shadow:0 0 0 6px rgba(217,180,120,.06)}#dcWork .dc-work-toast-copy{position:relative;z-index:1;min-width:0;flex:1}#dcWork strong,#dcWork span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#dcWork strong{font-size:12px;letter-spacing:.01em}#dcWork span{font-size:9px;color:var(--dc-muted);margin-top:3px}#dcWork .dc-work-toast-progress{position:absolute;left:58px;right:58px;bottom:7px;height:3px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}#dcWork .dc-work-toast-progress i{display:block;width:42%;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));animation:dcWorkBar 1.25s ease-in-out infinite}#dcWorkClose{position:absolute;right:10px;top:8px;z-index:2;width:24px;height:24px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.09);border-radius:50%;background:rgba(0,0,0,.32);color:var(--dc-muted);font-size:14px;line-height:1}#dcWorkClose:hover{color:var(--dc-text);border-color:rgba(255,255,255,.18)}#dcShade{display:none;position:fixed;inset:0;z-index:185;background:#0009}
@keyframes dcSpin{to{transform:rotate(360deg)}}@keyframes dcPulse{50%{opacity:.35}}@keyframes dcWorkIn{to{opacity:1;transform:translate(-50%,0) scale(1)}}@keyframes dcWorkGlow{to{transform:translateX(110%)}}@keyframes dcWorkBar{0%{transform:translateX(-90%);width:28%}50%{width:58%}100%{transform:translateX(245%);width:28%}}
@media(max-width:1250px){:root{--dc-side:208px}.dc-create-grid{grid-template-columns:minmax(220px,1fr) 150px 110px 135px}.dc-create-grid .dc-btn{grid-column:1/-1}.dc-home-grid{grid-template-columns:1fr}.dc-editor-workspace{grid-template-columns:58px 260px minmax(350px,1fr)}}
@media(max-width:980px){:root{--dc-side:72px}body:not(.dc-side-expanded) .dc-brand-copy,body:not(.dc-side-expanded) .dc-nav-label,body:not(.dc-side-expanded) .dc-nav-name,body:not(.dc-side-expanded) .dc-collapse span{display:none}body:not(.dc-side-expanded) #dcBrand,body:not(.dc-side-expanded) .dc-nav-button,body:not(.dc-side-expanded) .dc-collapse{justify-content:center;padding-left:0;padding-right:0}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-create-grid{grid-template-columns:1fr 1fr}.dc-create-grid input{grid-column:1/-1}.dc-project-grid{grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}.dc-editor-page{height:auto;min-height:0}.dc-editor-workspace{height:auto;grid-template-columns:58px minmax(260px,1fr);grid-template-rows:360px minmax(520px,auto) 174px}.dc-tool-rail{grid-row:1/4}.dc-tool-panel{grid-column:2;grid-row:1;max-height:360px;border-right:0;border-bottom:1px solid var(--dc-line)}.dc-canvas-area{grid-column:2;grid-row:2;min-height:520px}.dc-timeline{grid-column:2;grid-row:3}.dc-tool-content{max-height:310px}.dc-video-canvas{height:min(55vh,520px)}}
@media(max-width:720px){:root{--dc-side:0px;--dc-top:58px}body.dc-app #app>.wrap{padding:calc(var(--dc-top) + env(safe-area-inset-top) + 12px) 10px calc(82px + env(safe-area-inset-bottom))!important}#dcSidebar{width:min(280px,86vw);transform:translateX(-102%);padding-top:env(safe-area-inset-top);box-shadow:var(--dc-shadow)}body.dc-menu-open #dcSidebar{transform:translateX(0)}body.dc-menu-open #dcShade{display:block}#dcTopbar{left:0;top:env(safe-area-inset-top);height:58px;padding:0 10px}.dc-mobile-menu{display:grid;place-items:center}.dc-page-title{min-width:0;flex:1}.dc-page-title span,.dc-global-search,.dc-health{display:none}.dc-top-actions .dc-btn{padding:0 10px}.dc-create-card{padding:16px}.dc-create-card h2{font-size:19px}.dc-create-grid,.dc-filterbar,.dc-social-grid{grid-template-columns:1fr}.dc-create-grid input{grid-column:auto}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-page-head h1{font-size:21px}.dc-project-grid,.dc-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dc-project-cover{height:110px}.dc-project-actions,.dc-clip-actions{grid-template-columns:1fr}.dc-editor-header{position:sticky;top:calc(58px + env(safe-area-inset-top));z-index:10}.dc-editor-workspace{grid-template-columns:1fr;grid-template-rows:58px auto minmax(470px,auto) 174px}.dc-tool-rail{grid-column:1;grid-row:1;flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid var(--dc-line);padding:4px}.dc-tool-button{min-width:58px;height:49px;min-height:49px}.dc-tool-panel{grid-column:1;grid-row:2;max-height:none}.dc-tool-content{max-height:none}.dc-canvas-area{grid-column:1;grid-row:3;min-height:470px}.dc-timeline{grid-column:1;grid-row:4}.dc-video-canvas{height:min(54dvh,490px)}.dc-style-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:460px){.dc-project-grid,.dc-clip-grid{grid-template-columns:1fr}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-page-title strong{font-size:12px}.dc-top-actions .dc-btn span{display:none}.dc-caption-overlay{font-size:22px}.dc-editor-header .dc-pill{display:none}.dc-style-grid{grid-template-columns:1fr 1fr}}


.dc-user-pill{height:38px;display:flex;align-items:center;gap:8px;padding:0 10px;border:1px solid var(--dc-line);border-radius:999px;background:rgba(255,255,255,.035);color:var(--dc-text);font-size:10px;white-space:nowrap}.dc-user-pill img,.dc-user-avatar{width:24px;height:24px;border-radius:999px;background:rgba(217,180,120,.14);display:grid;place-items:center;color:var(--dc-accent);font-weight:800}.dc-logout-form{margin:0}.dc-logout-btn{height:38px;border:1px solid var(--dc-line);border-radius:999px;padding:0 11px;color:var(--dc-muted);font-size:10px;background:transparent}.dc-logout-btn:hover{background:var(--dc-panel2);color:var(--dc-text)}@media(max-width:720px){.dc-user-pill span,.dc-logout-btn{display:none}.dc-user-pill{padding:0 7px}}

/* Phase 4B: motion, real fill preview, framing feedback and clearer states */
.dc-card,.dc-project-card,.dc-clip-card,.dc-social-card,.dc-now-row,.dc-list-row{
  transition:transform .22s cubic-bezier(.2,.75,.25,1),border-color .22s ease,box-shadow .22s ease,background .22s ease;
}
.dc-card:hover,.dc-project-card:hover,.dc-clip-card:hover{border-color:var(--dc-line2);box-shadow:0 14px 38px rgba(0,0,0,.22)}
.dc-project-card:hover,.dc-clip-card:hover{transform:translateY(-3px)}
.dc-btn,.dc-icon-btn,.dc-nav-button,.dc-tool-button,.dc-style-card{position:relative;overflow:hidden;transition:transform .15s ease,background .18s ease,border-color .18s ease,color .18s ease,box-shadow .18s ease}
.dc-btn:active:not(:disabled),.dc-icon-btn:active:not(:disabled),.dc-tool-button:active{transform:scale(.97)}
.dc-ripple{position:absolute;border-radius:999px;background:rgba(255,255,255,.22);transform:translate(-50%,-50%) scale(0);pointer-events:none;animation:dcRipple .55s ease-out forwards}
.dc-view-reveal{animation:dcViewReveal .34s cubic-bezier(.2,.75,.25,1) both}
.dc-stagger-in{opacity:0;animation:dcStaggerIn .42s cubic-bezier(.2,.75,.25,1) both}
.dc-tool-content.dc-panel-swap{animation:dcPanelSwap .24s cubic-bezier(.2,.75,.25,1) both}
.dc-now-row{position:relative;overflow:hidden}
.dc-now-row::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 25%,rgba(217,180,120,.055) 45%,transparent 65%);transform:translateX(-115%);animation:dcShimmer 2.1s linear infinite;pointer-events:none}
.dc-progress i{position:relative;overflow:hidden;transition:width .55s cubic-bezier(.2,.75,.25,1)}
.dc-progress i::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.5),transparent);transform:translateX(-110%);animation:dcProgressSweep 1.55s linear infinite}
.dc-caption-word,.dc-caption-stack-line{transition:color .09s ease,transform .09s ease,opacity .09s ease}
.dc-caption-word.active,.dc-caption-stack-line.active{animation:dcCaptionPop .16s cubic-bezier(.2,1.4,.4,1) both}
.dc-caption-block{transition:background .14s ease,border-color .14s ease,transform .14s ease}
.dc-caption-block:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.55)}
.dc-playhead{transition:left .06s linear}
.dc-video-canvas{isolation:isolate;background:var(--dc-canvas-background,#000);transition:aspect-ratio .28s cubic-bezier(.2,.75,.25,1),background .2s ease}
.dc-video-layer{position:absolute;inset:0;width:100%;height:100%}
.dc-video-bg{z-index:0;object-fit:cover;filter:blur(24px) brightness(.72);transform:scale(1.14);opacity:0;transition:opacity .22s ease,filter .22s ease}
.dc-video-fg{z-index:1;transition:object-position .34s cubic-bezier(.2,.75,.25,1),transform .24s ease,opacity .18s ease}
.dc-video-canvas[data-fill="blur"] .dc-video-bg{opacity:1}
.dc-video-canvas[data-fill="blur"] .dc-video-fg{object-fit:contain}
.dc-video-canvas[data-fill="contain"] .dc-video-bg,.dc-video-canvas[data-fill="crop"] .dc-video-bg{opacity:0}
.dc-video-canvas[data-fill="contain"] .dc-video-fg{object-fit:contain}
.dc-video-canvas[data-fill="crop"] .dc-video-fg{object-fit:cover}
.dc-framing-guide{position:absolute;inset:7%;z-index:3;border:1px dashed rgba(217,180,120,.52);border-radius:8px;opacity:0;transform:scale(.96);transition:opacity .2s ease,transform .2s ease;pointer-events:none}
.dc-video-canvas[data-framing="analysing"] .dc-framing-guide,.dc-video-canvas[data-framing="ready"] .dc-framing-guide{opacity:1;transform:scale(1)}
.dc-video-canvas[data-framing="analysing"] .dc-framing-guide::before{content:'Analysing speaker position';position:absolute;top:8px;left:50%;transform:translateX(-50%);padding:4px 7px;border-radius:5px;background:#000c;color:var(--dc-accent2);font-size:7px;white-space:nowrap}
.dc-video-canvas[data-framing="ready"] .dc-framing-guide{border-color:rgba(83,199,139,.55)}
.dc-fill-options{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}
.dc-fill-option{min-height:62px;padding:7px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d;color:var(--dc-muted);text-align:left}
.dc-fill-option.on{border-color:var(--dc-accent);background:rgba(217,180,120,.1);color:var(--dc-text)}
.dc-fill-swatch{display:block;height:28px;border-radius:5px;margin-bottom:6px;background:#232327;overflow:hidden;position:relative}
.dc-fill-swatch.contain::after{content:'';position:absolute;inset:3px 10px;background:#82828a}
.dc-fill-swatch.blur{background:linear-gradient(135deg,#786a58,#272126);filter:saturate(.7)}
.dc-fill-swatch.blur::after{content:'';position:absolute;inset:3px 10px;background:#8c8c92}
.dc-fill-swatch.crop{background:linear-gradient(135deg,#717177,#2b2b31)}
.dc-fill-option b,.dc-fill-option span{display:block}.dc-fill-option b{font-size:8px}.dc-fill-option span{font-size:7px;color:var(--dc-subtle);margin-top:2px}
.dc-framing-state{display:flex;align-items:flex-start;gap:8px;padding:9px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d;margin-top:8px}
.dc-framing-state i{width:8px;height:8px;flex:0 0 8px;margin-top:3px;border-radius:50%;background:var(--dc-subtle)}
.dc-framing-state.analysing i{background:var(--dc-accent);animation:dcPulse 1s infinite}
.dc-framing-state.ready i{background:var(--dc-green)}
.dc-framing-state.failed i{background:var(--dc-red)}
.dc-framing-state strong,.dc-framing-state span{display:block}.dc-framing-state strong{font-size:8.5px}.dc-framing-state span{font-size:7.5px;color:var(--dc-muted);margin-top:2px;line-height:1.4}
.dc-skeleton{position:relative;overflow:hidden;background:#1a1a1e;border-radius:6px;color:transparent!important}
.dc-skeleton::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.07) 50%,transparent 80%);transform:translateX(-110%);animation:dcShimmer 1.4s linear infinite}
.dc-editor-header{animation:dcHeaderDrop .3s cubic-bezier(.2,.75,.25,1) both}
#dcSidebar{transition:width .2s cubic-bezier(.2,.75,.25,1),transform .2s ease}
#dcTopbar{transition:left .2s cubic-bezier(.2,.75,.25,1),background .2s ease}
.dc-nav-button.is-active .dc-nav-icon{animation:dcNavPop .24s cubic-bezier(.2,1.35,.4,1)}
@keyframes dcViewReveal{from{opacity:0;transform:translateY(7px)}to{opacity:1;transform:none}}
@keyframes dcStaggerIn{from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}}
@keyframes dcPanelSwap{from{opacity:0;transform:translateX(-7px)}to{opacity:1;transform:none}}
@keyframes dcRipple{to{transform:translate(-50%,-50%) scale(1);opacity:0}}
@keyframes dcShimmer{to{transform:translateX(115%)}}
@keyframes dcProgressSweep{to{transform:translateX(110%)}}
@keyframes dcCaptionPop{0%{transform:scale(.86);opacity:.7}100%{transform:scale(1.08);opacity:1}}
@keyframes dcHeaderDrop{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}
@keyframes dcNavPop{0%{transform:scale(.75)}100%{transform:scale(1)}}


/* Phase 4C: clear canvas controls, manual crop and dependable feedback */
.dc-canvas-explainer{padding:10px;border:1px solid rgba(217,180,120,.24);border-radius:8px;background:rgba(217,180,120,.055);color:var(--dc-muted);font-size:8.2px;line-height:1.55;margin-bottom:12px}
.dc-canvas-explainer b{color:var(--dc-accent2)}
.dc-control-group{padding:10px;border:1px solid var(--dc-line);border-radius:9px;background:#0b0b0d;margin-bottom:10px}
.dc-control-group>strong{display:block;font-size:9px;margin-bottom:3px}.dc-control-group>span{display:block;color:var(--dc-muted);font-size:7.7px;line-height:1.45;margin-bottom:9px}
.dc-layout-card-preview{height:38px;border-radius:6px;background:#202024;margin-bottom:7px;position:relative;overflow:hidden}
.dc-layout-card-preview.fit::after{content:'';position:absolute;left:18%;right:18%;top:8px;bottom:8px;background:#8b8b93}
.dc-layout-card-preview.blur{background:linear-gradient(135deg,#6d6257,#29262b);filter:saturate(.7)}.dc-layout-card-preview.blur::after{content:'';position:absolute;left:18%;right:18%;top:8px;bottom:8px;background:#96969e}
.dc-layout-card-preview.fill{background:linear-gradient(90deg,#43434a,#919199,#43434a)}
.dc-layout-card-preview.track{background:linear-gradient(90deg,#34343a,#777780,#34343a)}.dc-layout-card-preview.track::after{content:'';position:absolute;left:43%;top:7px;width:14%;height:24px;border:1px solid var(--dc-accent);border-radius:999px}
.dc-inline-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:8px}.dc-inline-actions .dc-btn{width:100%;padding:0 7px;font-size:9px}
.dc-video-canvas.is-manual-crop .dc-video-fg{cursor:grab}.dc-video-canvas.is-manual-crop.is-dragging .dc-video-fg{cursor:grabbing;transition:none}.dc-resize-handle{display:none;position:absolute;right:8px;bottom:8px;z-index:20;width:56px;height:56px;min-width:56px;min-height:56px;padding:0;border-radius:50%;border:4px solid #fff;background:rgba(0,0,0,.88);box-shadow:0 3px 16px #000;touch-action:none;cursor:nwse-resize}.dc-resize-handle::before{content:'↗';display:grid;place-items:center;width:100%;height:100%;font-size:25px;font-weight:900;color:#fff}.dc-resize-handle::after{content:'ZOOM';position:absolute;right:60px;top:50%;transform:translateY(-50%);padding:5px 8px;border-radius:6px;background:rgba(0,0,0,.82);color:#fff;font-size:8px;letter-spacing:.08em;white-space:nowrap}.dc-video-canvas.is-manual-crop .dc-resize-handle{display:block}.dc-video-canvas.is-resizing .dc-video-fg{transition:none}
.dc-layer-badge{position:absolute;right:8px;top:8px;z-index:8;padding:4px 6px;border-radius:5px;background:#000b;color:#ddd;font-size:7px;pointer-events:none}
.dc-caption-warning{padding:7px 9px;border-radius:7px;background:rgba(229,169,87,.08);border:1px solid rgba(229,169,87,.24);color:var(--dc-orange);font-size:7.8px;line-height:1.4;margin-bottom:10px}
.dc-fill-option[aria-pressed="true"]{box-shadow:0 0 0 1px rgba(217,180,120,.2) inset}
.dc-button-check{display:flex;align-items:center;gap:6px;color:var(--dc-green);font-size:7.5px;margin-top:7px}


/* Phase 5: simpler hierarchy, larger labels and focused editor controls */
.dc-tool-panel{width:auto}.dc-tool-content{padding:16px}.dc-tool-head{padding:0 16px}
.dc-tool-head strong{font-size:13px}.dc-section{margin-bottom:20px}.dc-section h3{font-size:10px;margin-bottom:10px}
.dc-field{margin-bottom:13px}.dc-field>label{font-size:10px;margin-bottom:7px}.dc-field>label b{font-size:9px}
.dc-tool-panel input,.dc-tool-panel select{height:42px;min-height:42px;font-size:11px}
.dc-tool-panel textarea{font-size:11px}.dc-check{font-size:10px!important;min-height:34px}
.dc-tool-button span{font-size:8.5px}.dc-caption-note,.dc-canvas-explainer,.dc-control-group>span{font-size:9px}
.dc-editor-title strong{font-size:13px}.dc-editor-title span{font-size:9px}.dc-page-head p{font-size:11px}
.dc-segmented{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;gap:4px;padding:4px;border:1px solid var(--dc-line);border-radius:10px;background:#0a0a0c}
.dc-segmented button{min-height:40px;padding:0 9px;border-radius:7px;color:var(--dc-muted);font-size:10px;font-weight:650}
.dc-segmented button.on{background:var(--dc-panel3);color:var(--dc-text);box-shadow:0 1px 0 #ffffff0b inset}
.dc-sync-card{padding:12px;border:1px solid var(--dc-line);border-radius:10px;background:#0b0b0d;margin-bottom:14px}
.dc-sync-top{display:flex;align-items:center;gap:10px;margin-bottom:10px}.dc-sync-dot{width:9px;height:9px;border-radius:50%;background:var(--dc-orange);box-shadow:0 0 0 4px rgba(229,169,87,.08)}
.dc-sync-dot.good{background:var(--dc-green);box-shadow:0 0 0 4px rgba(83,199,139,.08)}.dc-sync-dot.busy{background:var(--dc-accent);animation:dcPulse 1s infinite}
.dc-sync-copy{flex:1}.dc-sync-copy strong,.dc-sync-copy span{display:block}.dc-sync-copy strong{font-size:10px}.dc-sync-copy span{font-size:8.5px;color:var(--dc-muted);margin-top:3px;line-height:1.45}
.dc-sync-actions{display:grid;grid-template-columns:1fr auto auto;gap:6px}.dc-sync-actions .dc-btn{min-width:0;padding:0 9px}
.dc-timing-readout{display:flex;justify-content:space-between;align-items:center;color:var(--dc-muted);font-size:9px;margin-bottom:6px}.dc-timing-readout b{color:var(--dc-text)}
.dc-simple-card{padding:12px;border:1px solid var(--dc-line);border-radius:10px;background:#0b0b0d;margin-bottom:12px}
.dc-simple-card>strong{display:block;font-size:10px;margin-bottom:3px}.dc-simple-card>span{display:block;color:var(--dc-muted);font-size:8.5px;line-height:1.5;margin-bottom:10px}
.dc-advanced{margin-top:10px;border-top:1px solid var(--dc-line);padding-top:9px}.dc-advanced summary{cursor:pointer;color:var(--dc-muted);font-size:9px;list-style:none}
.dc-advanced summary::-webkit-details-marker{display:none}.dc-advanced summary::after{content:'＋';float:right}.dc-advanced[open] summary::after{content:'−'}
.dc-fill-options{grid-template-columns:repeat(3,minmax(0,1fr))}.dc-fill-option{min-height:104px;padding:10px}.dc-fill-option b{font-size:10px}.dc-fill-option>span:last-child{font-size:8px}
.dc-frame-note{padding:9px 10px;border-radius:8px;background:rgba(217,180,120,.06);color:var(--dc-muted);font-size:8.5px;line-height:1.5;margin-top:8px}
.dc-ai-primary{width:100%;min-height:44px;margin-top:8px}.dc-framing-state{margin-top:10px}
.dc-caption-warning{font-size:9px}.dc-project-actions{grid-template-columns:1fr}.dc-clip-actions{grid-template-columns:1fr 1fr}
.dc-editor-workspace{grid-template-columns:62px 340px minmax(390px,1fr)}.dc-editor-header{height:58px}.dc-editor-workspace{height:calc(100% - 58px)}
.dc-editor-header .dc-btn{min-height:36px}.dc-editor-header .dc-pill{display:none}
.dc-canvas-toolbar .dc-zoom{max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-timeline-top .dc-btn{display:none}
@media(max-width:1250px){.dc-editor-workspace{grid-template-columns:58px 300px minmax(350px,1fr)}}
@media(max-width:720px){.dc-sync-actions{grid-template-columns:1fr 1fr}.dc-sync-actions .dc-btn:first-child{grid-column:1/-1}.dc-fill-options{grid-template-columns:1fr}.dc-editor-header{height:auto;min-height:58px;padding:8px}.dc-editor-title span{display:none}}

@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}

/* V3 polish pass: premium icons, cleaner sidebar, cards-first home, project cards, clip review queue */
.dc-icon svg,.dc-nav-icon svg,.dc-tool-icon svg,.dc-svg svg{overflow:visible}.dc-nav-button[data-dc-nav="review"] .dc-nav-name::after{content:''}.dc-v3-hero{min-height:310px;padding:28px 28px!important;grid-template-columns:minmax(360px,1.05fr) minmax(320px,.95fr);align-items:center}.dc-v3-kicker svg{width:15px;height:15px}.dc-v3-title{font-size:clamp(28px,3.4vw,42px)!important;line-height:.98!important;max-width:720px}.dc-v3-copy{max-width:680px}.dc-v3-source-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dc-v3-source{position:relative;overflow:hidden;padding:18px 18px 16px!important;min-height:126px;display:grid;grid-template-columns:46px 1fr;grid-template-rows:auto auto;align-content:center;column-gap:14px;text-align:left}.dc-v3-source strong{font-size:14px;align-self:end}.dc-v3-source>span:last-child{grid-column:2;color:var(--dc-muted);font-size:10px;line-height:1.35}.dc-v3-platform{grid-row:1/3;width:46px;height:46px;border-radius:15px;display:grid;place-items:center}.dc-v3-platform svg{width:24px;height:24px}.dc-v3-platform.youtube{background:rgba(255,0,51,.12);color:#ff335f}.dc-v3-platform.template{background:rgba(217,180,120,.14);color:var(--dc-accent2)}.dc-v3-platform.publish{background:rgba(51,203,255,.1);color:#7de4ff}.dc-home-metrics.v3{grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px}.dc-metric{padding:18px!important}.dc-metric strong{font-size:25px!important}.dc-home-dashboard{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(320px,.85fr);gap:14px;margin-top:14px}.dc-dashboard-card{min-height:0}.dc-dashboard-card .dc-card-head p{display:none}.dc-row-list.compact{display:grid;gap:8px}.dc-row-list.compact .dc-list-row{min-height:56px;padding:10px 12px}.dc-list-copy strong{font-size:11.5px}.dc-list-copy span{font-size:9px}.dc-social-grid.clean{grid-template-columns:1fr 1fr;gap:9px}.dc-social-card.v3{padding:12px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border-color:#32323a}.dc-social-logo{width:34px!important;height:34px!important;border-radius:11px!important;display:grid;place-items:center}.dc-social-logo svg{width:18px;height:18px}.dc-social-logo.youtube{background:rgba(255,0,51,.13);color:#ff335f}.dc-social-logo.tiktok{background:linear-gradient(135deg,rgba(37,244,238,.16),rgba(254,44,85,.12));color:#38f2ec}.dc-social-logo.instagram{background:linear-gradient(135deg,rgba(255,221,87,.18),rgba(214,41,118,.18),rgba(81,91,212,.16));color:#ff7ebe}.dc-social-logo.facebook{background:rgba(24,119,242,.15);color:#71adff}.dc-sidebar-live{padding:9px;margin:10px 0 6px;border-radius:12px;background:#111113;border-color:#2c2c33}.dc-sidebar-live-head{margin-bottom:7px}.dc-sidebar-live-head strong{font-size:10px}.dc-sidebar-live-head span{font-size:7.8px}.dc-mini-job{grid-template-columns:24px minmax(0,1fr);padding:7px;margin-top:6px;border-radius:9px}.dc-mini-job-icon{width:24px;height:24px;border-radius:8px}.dc-mini-job strong{font-size:8.7px}.dc-mini-job span{font-size:7.5px}.dc-sidebar-status-pills{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.dc-side-pill{padding:7px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d}.dc-side-pill b,.dc-side-pill span{display:block}.dc-side-pill b{font-size:10px}.dc-side-pill span{font-size:7.3px;color:var(--dc-subtle);margin-top:1px}.dc-sidebar-live-foot{grid-template-columns:1fr;margin-top:7px}.dc-sidebar-live-foot .dc-btn{min-height:28px}.dc-project-grid{grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px}.dc-project-card{border-radius:15px;background:linear-gradient(180deg,#151519,#101013);box-shadow:0 15px 45px rgba(0,0,0,.18)}.dc-project-cover{height:205px;border-bottom:1px solid var(--dc-line);background:radial-gradient(circle at 30% 18%,rgba(217,180,120,.14),transparent 36%),#070708}.dc-project-cover img{filter:none;object-fit:cover;transform:scale(1.01)}.dc-project-cover:empty::after,.dc-project-cover:not(:has(img))::after{content:'Lecture';position:absolute;inset:auto 16px 16px;color:var(--dc-muted);font-size:12px}.dc-project-status{left:12px;right:auto;top:12px}.dc-project-body{padding:15px 15px 16px}.dc-project-body h3{font-size:14px;line-height:1.25;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:34px}.dc-project-body p{display:none}.dc-project-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.dc-project-stat{padding:9px;border:1px solid var(--dc-line);border-radius:9px;background:#0b0b0d}.dc-project-actions{grid-template-columns:1fr}.dc-project-actions .dc-btn.secondary{min-height:36px}.dc-review-list{display:grid;gap:12px}.dc-review-item{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px;border:1px solid var(--dc-line);border-radius:14px;background:linear-gradient(145deg,#151519,#101013)}.dc-review-media{position:relative;width:92px;aspect-ratio:9/16;border-radius:10px;overflow:hidden;background:#000}.dc-review-media img{width:100%;height:100%;object-fit:cover}.dc-review-score{position:absolute;left:6px;bottom:6px;min-width:28px;height:24px;border-radius:999px;background:#0a0a0ddd;color:#b9ff69;display:grid;place-items:center;font-weight:900;font-size:10px}.dc-review-copy h3{font-size:14px;margin:0 0 6px;line-height:1.25}.dc-review-copy p{margin:0;color:var(--dc-muted);font-size:10px}.dc-review-actions{display:grid;grid-template-columns:repeat(4,minmax(80px,1fr));gap:8px;min-width:360px}.dc-btn.ghost{background:transparent;border-color:var(--dc-line)}.dc-empty.v3{min-height:170px;display:grid;place-items:center;text-align:center;border:1px dashed #373740;border-radius:14px;background:#101013}.dc-empty.v3 .dc-empty-icon{width:46px;height:46px;margin:0 auto 10px;border-radius:14px;background:rgba(217,180,120,.11);display:grid;place-items:center;color:var(--dc-accent2)}.dc-empty.v3 .dc-empty-icon svg{width:24px;height:24px}.dc-caption-block{height:28px;display:flex;align-items:center;overflow:visible;white-space:nowrap}.dc-timeline-scroll{overflow-x:auto!important}.dc-timeline-scroll::-webkit-scrollbar{height:10px}.dc-timeline-scroll::-webkit-scrollbar-thumb{background:#555;border-radius:99px}.dc-timeline-scroll::-webkit-scrollbar-track{background:#19191e}
@media(max-width:1200px){.dc-home-dashboard{grid-template-columns:1fr}.dc-home-metrics.v3{grid-template-columns:repeat(3,minmax(120px,1fr))}.dc-review-item{grid-template-columns:78px minmax(0,1fr)}.dc-review-actions{grid-column:1/-1;min-width:0}}
@media(max-width:720px){.dc-v3-hero{grid-template-columns:1fr;min-height:0;padding:18px!important}.dc-v3-source-row,.dc-social-grid.clean{grid-template-columns:1fr}.dc-home-metrics.v3{grid-template-columns:1fr 1fr}.dc-review-item{grid-template-columns:72px 1fr}.dc-review-actions{grid-template-columns:1fr 1fr}.dc-project-grid{grid-template-columns:1fr}}

`;


const billingCss = String.raw`
.dc-token-pill{min-height:38px;display:inline-flex;align-items:center;gap:8px;padding:0 12px;border:1px solid rgba(217,180,120,.24);border-radius:999px;background:rgba(217,180,120,.075);color:var(--dc-accent2);font-size:10px;font-weight:750;white-space:nowrap;box-shadow:0 8px 30px rgba(217,180,120,.06)}
.dc-token-pill svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8}.dc-token-pill em{font-style:normal;color:var(--dc-muted);font-weight:600}.dc-token-pill:hover{background:rgba(217,180,120,.12);border-color:rgba(217,180,120,.38)}
.dc-billing-layer{position:fixed;inset:0;z-index:420;display:none;place-items:center;padding:18px;background:rgba(0,0,0,.68);backdrop-filter:blur(22px) saturate(1.15)}.dc-billing-layer.show{display:grid}
.dc-billing-card{width:min(1080px,100%);max-height:min(860px,92dvh);overflow:auto;border:1px solid rgba(217,180,120,.16);border-radius:28px;background:radial-gradient(circle at 16% 0%,rgba(217,180,120,.18),transparent 34%),radial-gradient(circle at 90% 6%,rgba(85,183,255,.10),transparent 30%),linear-gradient(180deg,#151517,#0b0b0d 70%);box-shadow:0 34px 110px rgba(0,0,0,.68),0 0 0 1px rgba(255,255,255,.03) inset;color:var(--dc-text)}
.dc-billing-head{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;padding:28px 30px 18px}.dc-billing-kicker{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 11px;border:1px solid rgba(217,180,120,.25);border-radius:999px;background:rgba(217,180,120,.09);color:var(--dc-accent2);font-size:10px;font-weight:850;letter-spacing:.08em;text-transform:uppercase}.dc-billing-head h2{margin:14px 0 0;font-size:34px;letter-spacing:-.055em;line-height:.98}.dc-billing-head p{max-width:680px;margin:10px 0 0;color:var(--dc-muted);font-size:12px;line-height:1.7}.dc-billing-head p b{color:var(--dc-accent2)}.dc-billing-close{width:42px;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.28);color:var(--dc-text);font-size:25px;line-height:1;display:grid;place-items:center}.dc-billing-close:hover{background:rgba(255,255,255,.07);border-color:rgba(255,255,255,.18)}
.dc-billing-status{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(250px,.75fr);gap:14px;padding:0 30px 18px}.dc-usage-panel,.dc-rate-panel{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.022));padding:18px}.dc-usage-panel::after,.dc-rate-panel::after{content:'';position:absolute;right:-50px;top:-60px;width:150px;height:150px;border-radius:50%;background:rgba(217,180,120,.06);pointer-events:none}.dc-panel-label{display:flex;align-items:center;justify-content:space-between;gap:10px;color:var(--dc-muted);font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.10em}.dc-status-pill{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 9px;border-radius:999px;background:rgba(83,199,139,.10);color:var(--dc-green);font-size:9px;font-weight:850;text-transform:none;letter-spacing:0}.dc-status-pill.warn{background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-usage-row{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-top:14px}.dc-usage-value{font-size:56px;font-weight:950;letter-spacing:-.075em;line-height:.9}.dc-usage-value span{font-size:12px;color:var(--dc-muted);font-weight:800;letter-spacing:0;margin-left:6px}.dc-usage-meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;min-width:210px}.dc-usage-mini{padding:9px 10px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(0,0,0,.20)}.dc-usage-mini b,.dc-usage-mini span{display:block}.dc-usage-mini b{font-size:15px}.dc-usage-mini span{margin-top:2px;color:var(--dc-muted);font-size:9px}.dc-usage-bar{height:9px;border-radius:999px;background:rgba(255,255,255,.10);margin-top:18px;overflow:hidden}.dc-usage-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),#ffe1a6);box-shadow:0 0 28px rgba(217,180,120,.38)}.dc-rate-big{font-size:28px;font-weight:950;letter-spacing:-.04em;margin-top:14px}.dc-rate-big span{font-size:12px;color:var(--dc-muted);font-weight:800}.dc-rate-panel p{margin:9px 0 0;color:var(--dc-muted);font-size:11px;line-height:1.65}.dc-rate-steps{display:flex;gap:7px;flex-wrap:wrap;margin-top:13px}.dc-rate-steps span{padding:6px 8px;border-radius:999px;background:rgba(255,255,255,.06);color:var(--dc-muted);font-size:9px;font-weight:750}
.dc-plan-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;padding:2px 30px 18px}.dc-plan-card{position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.09);border-radius:22px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));padding:18px;display:flex;flex-direction:column;min-height:248px}.dc-plan-card::before{content:'';position:absolute;left:18px;right:18px;top:0;height:2px;background:linear-gradient(90deg,transparent,var(--dc-accent),transparent);opacity:.35}.dc-plan-card.featured{border-color:rgba(217,180,120,.38);box-shadow:0 0 0 1px rgba(217,180,120,.10) inset,0 18px 50px rgba(217,180,120,.08)}.dc-plan-card.current{border-color:rgba(83,199,139,.46);box-shadow:0 0 0 1px rgba(83,199,139,.12) inset}.dc-plan-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dc-plan-card h3{margin:0;font-size:19px;letter-spacing:-.03em}.dc-plan-card .badge{padding:6px 9px;border-radius:999px;background:rgba(217,180,120,.10);color:var(--dc-accent2);font-size:9px;font-weight:850;white-space:nowrap}.dc-plan-card.current .badge{background:rgba(83,199,139,.11);color:var(--dc-green)}.dc-plan-card .tokens{margin-top:16px;font-size:38px;font-weight:950;letter-spacing:-.065em}.dc-plan-card .tokens span{font-size:11px;color:var(--dc-muted);font-weight:800;letter-spacing:0}.dc-plan-card p{margin:9px 0 0;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-plan-features{display:grid;gap:7px;margin:14px 0 16px}.dc-plan-features span{display:flex;align-items:center;gap:7px;color:var(--dc-muted);font-size:9.5px}.dc-plan-features span::before{content:'✓';width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:rgba(83,199,139,.10);color:var(--dc-green);font-size:10px;font-weight:900}.dc-plan-card .dc-btn{width:100%;margin-top:auto}.dc-plan-card button:disabled{background:rgba(255,255,255,.07)!important;color:var(--dc-muted)!important;border-color:rgba(255,255,255,.08)!important;opacity:1}.dc-billing-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 30px 30px;padding:15px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(0,0,0,.20);color:var(--dc-muted);font-size:10.5px}.dc-billing-foot b{color:var(--dc-text)}.dc-billing-foot .dc-btn{min-height:36px}.dc-billing-note{display:flex;align-items:center;gap:9px}.dc-billing-note i{width:9px;height:9px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-billing-note i.warn{background:var(--dc-accent);box-shadow:0 0 0 5px rgba(217,180,120,.08)}
@media(max-width:900px){.dc-billing-head{padding:22px 20px 14px}.dc-billing-head h2{font-size:28px}.dc-billing-status,.dc-plan-grid{grid-template-columns:1fr;padding-left:20px;padding-right:20px}.dc-usage-row{align-items:flex-start;flex-direction:column}.dc-usage-meta{width:100%;min-width:0}.dc-billing-foot{margin-left:20px;margin-right:20px;flex-direction:column;align-items:stretch}.dc-token-pill em{display:none}}
`;




const rangeChargeCss = String.raw`
.dc-charge-layer{position:fixed;inset:0;z-index:520;display:grid;place-items:center;padding:18px;background:rgba(0,0,0,.70);backdrop-filter:blur(24px) saturate(1.08)}
.dc-charge-card{width:min(720px,calc(100vw - 32px));max-height:calc(100dvh - 38px);overflow:auto;scrollbar-width:none;border:1px solid rgba(255,255,255,.10);border-radius:24px;background:linear-gradient(150deg,rgba(24,24,27,.96),rgba(10,10,12,.97));box-shadow:0 30px 110px rgba(0,0,0,.62),0 0 44px rgba(217,180,120,.08)}
.dc-charge-card::-webkit-scrollbar{display:none}.dc-charge-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:24px 26px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
.dc-charge-head span{display:inline-flex;align-items:center;gap:8px;min-height:26px;padding:0 10px;border-radius:999px;background:rgba(217,180,120,.09);border:1px solid rgba(217,180,120,.20);color:var(--dc-accent2);font-size:10px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.dc-charge-head svg{width:15px;height:15px}.dc-charge-head h2{font-size:25px;letter-spacing:-.04em;margin:14px 0 7px}.dc-charge-head p{max-width:560px;margin:0;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-charge-close{width:38px;height:38px;flex:0 0 38px;border:1px solid rgba(255,255,255,.12);border-radius:999px;background:rgba(255,255,255,.03);color:var(--dc-text);font-size:20px}.dc-charge-close:hover{background:rgba(255,255,255,.08)}
.dc-charge-body{padding:18px 26px 24px}.dc-charge-range-shell{display:grid;gap:12px}.dc-charge-summary{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:12px;padding:14px;border:1px solid rgba(217,180,120,.20);border-radius:18px;background:linear-gradient(135deg,rgba(217,180,120,.11),rgba(255,255,255,.025))}.dc-charge-summary i{width:42px;height:42px;border-radius:14px;background:rgba(217,180,120,.14);box-shadow:0 0 26px rgba(217,180,120,.10);display:grid;place-items:center}.dc-charge-summary i::before{content:'▶';font-size:13px;color:var(--dc-accent2)}.dc-charge-summary strong,.dc-charge-summary span{display:block}.dc-charge-summary strong{font-size:13px}.dc-charge-summary span{font-size:10px;color:var(--dc-muted);margin-top:3px}.dc-charge-summary b{font-size:11px;color:var(--dc-accent2);font-weight:850;white-space:nowrap}
.dc-charge-range-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dc-charge-tile{padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.03)}.dc-charge-tile strong,.dc-charge-tile span{display:block}.dc-charge-tile strong{font-size:24px;letter-spacing:-.04em}.dc-charge-tile span{font-size:10px;color:var(--dc-muted);margin-top:4px}
.dc-range-picker{padding:16px;border:1px solid rgba(255,255,255,.09);border-radius:20px;background:linear-gradient(180deg,rgba(255,255,255,.042),rgba(255,255,255,.018))}.dc-range-top{display:flex;align-items:end;justify-content:space-between;gap:14px;margin-bottom:14px}.dc-range-top strong,.dc-range-top span{display:block}.dc-range-top strong{font-size:13px}.dc-range-top span{color:var(--dc-muted);font-size:10px;margin-top:3px}.dc-range-top label{min-width:160px;color:var(--dc-muted);font-size:9px}.dc-range-top input{width:100%;height:38px;margin-top:5px;padding:0 10px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#0b0b0d;color:var(--dc-text);font-weight:850}.dc-range-bars{display:grid;gap:12px}.dc-range-bars label{display:grid;grid-template-columns:54px minmax(0,1fr) 58px;gap:10px;align-items:center;color:var(--dc-muted);font-size:10px}.dc-range-bars input[type=range]{width:100%;accent-color:var(--dc-accent)}.dc-range-bars b{color:var(--dc-text);font-size:10px;text-align:right}.dc-range-visual{position:relative;height:14px;margin:8px 0 2px;border-radius:999px;background:#222228;overflow:hidden}.dc-range-fill{position:absolute;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));box-shadow:0 0 20px rgba(217,180,120,.28)}.dc-range-readout{display:flex;justify-content:space-between;gap:10px;color:var(--dc-muted);font-size:10px}.dc-range-readout b{color:var(--dc-accent2)}
.dc-charge-cost-panel{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dc-charge-cost{padding:15px;border:1px solid rgba(217,180,120,.20);border-radius:18px;background:rgba(217,180,120,.055)}.dc-charge-cost b{display:block;font-size:32px;letter-spacing:-.055em;color:var(--dc-accent2);line-height:1}.dc-charge-cost span{display:block;font-size:10px;color:var(--dc-muted);margin-top:5px}.dc-charge-muted{min-height:auto;padding:13px 14px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);color:var(--dc-muted);font-size:10px;line-height:1.45}.dc-charge-muted.warn{background:rgba(229,169,87,.09);color:var(--dc-orange);border-color:rgba(229,169,87,.22)}
.dc-charge-actions{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:3px}.dc-charge-actions .dc-btn{min-height:44px;border-radius:999px}.dc-charge-actions .dc-btn:first-child{min-width:220px}.dc-charge-note{color:var(--dc-muted);font-size:9.5px;line-height:1.45}.dc-charge-note b{color:var(--dc-text)}
@media(max-width:720px){.dc-charge-card{width:calc(100vw - 18px);max-height:calc(100dvh - 18px);border-radius:20px}.dc-charge-head,.dc-charge-body{padding-left:16px;padding-right:16px}.dc-charge-range-grid,.dc-charge-cost-panel{grid-template-columns:1fr}.dc-charge-summary{grid-template-columns:36px minmax(0,1fr)}.dc-charge-summary b{grid-column:1/-1}.dc-range-top{display:grid}.dc-range-bars label{grid-template-columns:48px minmax(0,1fr) 52px}.dc-charge-actions{display:grid}.dc-charge-actions .dc-btn:first-child{min-width:0;width:100%}}
`;


const v3Css = String.raw`
/* DeenClipped V3 visual system */
:root{--dc-v3-glow:rgba(217,180,120,.18);--dc-v3-blue:#55b7ff;--dc-v3-pink:#ff5c9a;--dc-v3-purple:#9c7cff;--dc-v3-youtube:#ff0033;--dc-v3-tiktok:#25f4ee;--dc-v3-instagram:#e95a9a;--dc-v3-facebook:#5b8cff}
body.dc-app::before{content:'';position:fixed;inset:-20% -10% auto 20%;height:420px;z-index:-1;background:radial-gradient(circle at 35% 10%,rgba(217,180,120,.16),transparent 34%),radial-gradient(circle at 70% 25%,rgba(85,183,255,.10),transparent 32%);filter:blur(20px);pointer-events:none}
#dcSidebar{background:linear-gradient(180deg,#0d0d10,#08080a 80%);box-shadow:18px 0 50px rgba(0,0,0,.22)}
#dcBrand{background:linear-gradient(135deg,rgba(217,180,120,.09),transparent 62%)}
.dc-logo{position:relative;overflow:hidden}.dc-logo::after{content:'';position:absolute;inset:-40%;background:conic-gradient(from 90deg,transparent,rgba(217,180,120,.28),transparent);animation:dcV3Spin 6s linear infinite}
.dc-logo svg{position:relative;z-index:1}.dc-nav-button{position:relative;overflow:hidden}.dc-nav-button.is-active::after{content:'';position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:999px;background:var(--dc-accent);box-shadow:0 0 20px var(--dc-v3-glow)}
.dc-sidebar-live{margin:12px 0 4px;padding:11px;border:1px solid rgba(217,180,120,.18);border-radius:14px;background:linear-gradient(180deg,rgba(217,180,120,.08),rgba(255,255,255,.018));overflow:hidden}.dc-sidebar-live-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}.dc-sidebar-live-head strong{font-size:10.5px}.dc-sidebar-live-head span{font-size:8.5px;color:var(--dc-muted)}.dc-live-orb{width:8px;height:8px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-live-orb.busy{background:var(--dc-accent);animation:dcPulse 1s infinite}.dc-mini-job{display:grid;grid-template-columns:26px minmax(0,1fr);gap:8px;align-items:center;padding:8px;border:1px solid var(--dc-line);background:#0b0b0d;border-radius:10px;margin-top:7px}.dc-mini-job-icon{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;background:rgba(217,180,120,.1);color:var(--dc-accent2)}.dc-mini-job-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:1.7}.dc-mini-job strong,.dc-mini-job span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-mini-job strong{font-size:9.5px}.dc-mini-job span{font-size:8px;color:var(--dc-muted);margin-top:1px}.dc-sidebar-live-foot{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}.dc-sidebar-live-foot .dc-btn{min-height:30px;font-size:8.5px;padding:0 7px}
body.dc-side-collapsed .dc-sidebar-live{display:none}
.dc-tour-launch{background:rgba(217,180,120,.10)!important;border-color:rgba(217,180,120,.26)!important;color:var(--dc-accent2)!important}
.dc-v3-hero{position:relative;overflow:hidden;border:1px solid rgba(217,180,120,.22);border-radius:24px;background:linear-gradient(135deg,rgba(217,180,120,.13),rgba(17,17,19,.96) 38%,rgba(85,183,255,.075));box-shadow:0 24px 70px rgba(0,0,0,.35);padding:22px;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:22px;margin-bottom:14px}.dc-v3-hero::before{content:'';position:absolute;right:-140px;top:-170px;width:420px;height:420px;background:radial-gradient(circle,rgba(217,180,120,.19),transparent 62%);pointer-events:none}.dc-v3-kicker{display:inline-flex;align-items:center;gap:8px;min-height:30px;padding:0 11px;border-radius:999px;background:rgba(217,180,120,.09);border:1px solid rgba(217,180,120,.22);color:var(--dc-accent2);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.dc-v3-title{font-size:38px;line-height:1.02;letter-spacing:-.055em;margin:18px 0 10px;max-width:760px}.dc-v3-title span{color:var(--dc-accent2);text-shadow:0 0 35px rgba(217,180,120,.18)}.dc-v3-copy{max-width:680px;margin:0;color:var(--dc-muted);font-size:13px;line-height:1.65}.dc-v3-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.dc-v3-actions .dc-btn{min-height:44px;border-radius:12px;font-size:12px}.dc-v3-pipeline{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:18px}.dc-v3-step{padding:11px;border-radius:13px;background:rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.065)}.dc-v3-step i{width:32px;height:32px;border-radius:11px;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2);font-style:normal;margin-bottom:8px}.dc-v3-step i svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.7}.dc-v3-step strong{display:block;font-size:10.5px}.dc-v3-step span{display:block;color:var(--dc-muted);font-size:8.5px;line-height:1.35;margin-top:3px}.dc-v3-phone-wall{position:relative;min-height:280px}.dc-v3-phone{position:absolute;width:122px;aspect-ratio:9/16;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:#0a0a0b;overflow:hidden;box-shadow:0 20px 45px rgba(0,0,0,.35);transform:rotate(var(--r,0deg));animation:dcV3Float 5.6s ease-in-out infinite}.dc-v3-phone:nth-child(1){left:8%;top:8%;--r:-5deg}.dc-v3-phone:nth-child(2){left:36%;top:0%;--r:4deg;animation-delay:.25s}.dc-v3-phone:nth-child(3){right:6%;top:18%;--r:-3deg;animation-delay:.5s}.dc-v3-phone:nth-child(4){left:26%;bottom:2%;--r:2deg;animation-delay:.75s}.dc-v3-phone img{width:100%;height:100%;object-fit:cover;display:block}.dc-v3-phone-empty{height:100%;display:grid;place-items:center;background:linear-gradient(160deg,#24242a,#0d0d0f);color:var(--dc-muted)}.dc-v3-phone-empty svg{width:34px;height:34px;fill:none;stroke:currentColor;stroke-width:1.5}.dc-v3-caption-demo{position:absolute;left:9px;right:9px;bottom:16px;font-size:10px;line-height:1;text-align:center;color:#fff;font-weight:900;text-shadow:0 1px 0 #000,0 0 14px #000}.dc-v3-caption-demo em{font-family:Georgia,serif;font-style:italic;color:#fff}.dc-v3-source-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:14px 0}.dc-v3-source{position:relative;overflow:hidden;min-height:122px;padding:15px;border:1px solid var(--dc-line);border-radius:18px;background:linear-gradient(180deg,#141416,#0d0d0f);text-align:left;color:var(--dc-text)}.dc-v3-source:hover{border-color:var(--dc-line2);transform:translateY(-1px)}.dc-v3-source .dc-v3-platform{width:42px;height:42px;border-radius:14px;margin-bottom:18px}.dc-v3-platform{display:grid;place-items:center;background:var(--dc-panel3);color:var(--dc-text)}.dc-v3-platform svg{width:23px;height:23px;fill:currentColor;stroke:none}.dc-v3-platform.youtube{background:rgba(255,0,51,.12);color:#ff4f72}.dc-v3-platform.template{background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-v3-platform.publish{background:rgba(85,183,255,.12);color:#8ed0ff}.dc-v3-source strong,.dc-v3-source span{display:block}.dc-v3-source strong{font-size:14px}.dc-v3-source span{font-size:10px;color:var(--dc-muted);line-height:1.45;margin-top:4px}.dc-v3-source::after{content:'';position:absolute;right:-24px;bottom:-24px;width:90px;height:90px;border-radius:50%;background:rgba(255,255,255,.035)}
.dc-create-card.v3{padding:0;background:transparent;border:0}.dc-create-card.v3 .dc-create-grid{grid-template-columns:minmax(260px,1fr) 180px 120px 150px auto;background:var(--dc-panel);border:1px solid var(--dc-line);border-radius:18px;padding:10px}.dc-create-card.v3 input,.dc-create-card.v3 select{height:46px!important;border-radius:12px!important}.dc-create-card.v3 .dc-btn{height:46px;border-radius:12px}.dc-home-metrics.v3 .dc-metric{border-radius:16px;background:linear-gradient(180deg,#151518,#101012);position:relative;overflow:hidden}.dc-home-metrics.v3 .dc-metric::after{content:'';position:absolute;right:-18px;top:-22px;width:70px;height:70px;border-radius:50%;background:rgba(217,180,120,.06)}.dc-home-metrics.v3 .dc-metric strong{font-size:27px}.dc-card.v3-card{border-radius:18px;background:linear-gradient(180deg,#131316,#0e0e10);box-shadow:0 18px 45px rgba(0,0,0,.18)}.dc-card.v3-card .dc-card-head h2{font-size:15px}.dc-now-row{position:relative;overflow:hidden}.dc-now-row::after{content:'';position:absolute;inset:auto auto 0 0;width:35%;height:1px;background:linear-gradient(90deg,var(--dc-accent),transparent);opacity:.55}.dc-list-row{transition:transform .16s ease,border-color .16s ease}.dc-list-row:hover{transform:translateY(-1px);border-color:var(--dc-line2)}.dc-social-card.v3{border-radius:14px;background:linear-gradient(180deg,#151519,#0c0c0e)}.dc-social-card.v3 .dc-social-logo{border-radius:12px}.dc-social-logo.youtube{background:rgba(255,0,51,.12);color:#ff4f72}.dc-social-logo.tiktok{background:rgba(37,244,238,.10);color:#25f4ee}.dc-social-logo.instagram{background:rgba(233,90,154,.12);color:#ff89bd}.dc-social-logo.facebook{background:rgba(91,140,255,.12);color:#8ea9ff}.dc-social-logo svg{width:17px;height:17px;fill:currentColor;stroke:none}.dc-command-card{position:sticky;top:calc(var(--dc-top) + 18px)}
.dc-guide-layer{position:fixed;inset:0;z-index:9999;pointer-events:none}.dc-guide-spot{position:fixed;border:2px solid var(--dc-accent);border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.68),0 0 34px rgba(217,180,120,.38);transition:all .22s ease;pointer-events:none}.dc-guide-card{position:fixed;max-width:min(410px,calc(100vw - 28px));padding:17px;border:1px solid rgba(217,180,120,.24);border-radius:18px;background:linear-gradient(180deg,rgba(23,23,26,.96),rgba(14,14,16,.94));backdrop-filter:blur(16px);box-shadow:0 24px 70px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.035) inset;pointer-events:auto;transition:left .22s ease,top .22s ease}.dc-guide-card h3{margin:0;font-size:16px;letter-spacing:-.02em}.dc-guide-card p{margin:7px 0 13px;color:var(--dc-muted);font-size:12px;line-height:1.55}.dc-guide-progress{height:4px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden;margin:0 0 13px}.dc-guide-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));transition:width .22s ease}.dc-guide-foot{display:flex;align-items:center;gap:8px}.dc-guide-count{margin-right:auto;color:var(--dc-muted);font-size:10px}.dc-guide-foot .dc-btn{min-height:36px;font-size:10px}.dc-guide-missing{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}
@keyframes dcV3Float{0%,100%{transform:translateY(0) rotate(var(--r,0deg))}50%{transform:translateY(-9px) rotate(var(--r,0deg))}}@keyframes dcV3Spin{to{transform:rotate(1turn)}}
@media(max-width:1180px){.dc-v3-hero{grid-template-columns:1fr}.dc-v3-phone-wall{min-height:240px}.dc-v3-source-row{grid-template-columns:1fr 1fr 1fr}.dc-create-card.v3 .dc-create-grid{grid-template-columns:1fr 1fr}.dc-create-card.v3 input{grid-column:1/-1}.dc-create-card.v3 .dc-btn{grid-column:1/-1}}
@media(max-width:780px){.dc-v3-title{font-size:28px}.dc-v3-pipeline,.dc-v3-source-row{grid-template-columns:1fr}.dc-v3-phone-wall{display:none}.dc-guide-card{left:14px!important;right:14px;top:auto!important;bottom:16px}.dc-guide-spot{border-radius:12px}.dc-command-card{position:static}}


/* V3F home dashboard polish: more visual, less text */
.dc-create-compact{padding:12px!important}.dc-create-compact .dc-create-grid{align-items:center}
.dc-home-quick.upgraded{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin:14px 0}.dc-home-quick.upgraded .dc-v3-source{min-height:112px;border-radius:18px;background:linear-gradient(145deg,rgba(255,255,255,.045),rgba(255,255,255,.014));border:1px solid #303039}.dc-home-quick.upgraded .dc-v3-source:hover{border-color:rgba(217,180,120,.45);box-shadow:0 18px 50px rgba(0,0,0,.24);transform:translateY(-2px)}
.dc-command-strip{display:grid;grid-template-columns:minmax(0,1.08fr) minmax(0,1fr) minmax(280px,.82fr);gap:12px;margin:14px 0}.dc-work-card{position:relative;overflow:hidden;min-height:116px;display:flex;align-items:center;gap:14px;padding:16px;border:1px solid #303039;border-radius:18px;background:radial-gradient(circle at 100% 0,rgba(217,180,120,.10),transparent 36%),linear-gradient(145deg,#151519,#101013)}.dc-work-card::after{content:'';position:absolute;right:-42px;bottom:-54px;width:140px;height:140px;border-radius:50%;background:rgba(255,255,255,.035);pointer-events:none}.dc-work-card.live{border-color:rgba(217,180,120,.42)}.dc-work-icon,.dc-work-thumb{width:58px;height:58px;flex:0 0 58px;border-radius:18px;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-work-icon svg{width:26px;height:26px}.dc-work-icon.good{background:rgba(83,199,139,.12);color:var(--dc-green)}.dc-work-icon.template{background:rgba(217,180,120,.14)}.dc-work-thumb{overflow:hidden;background:#000}.dc-work-thumb img{width:100%;height:100%;object-fit:cover}.dc-work-copy{position:relative;z-index:1;flex:1;min-width:0}.dc-work-label{display:block;margin-bottom:4px;color:var(--dc-accent2);font-size:9px;text-transform:uppercase;letter-spacing:.08em}.dc-work-copy strong,.dc-work-copy p{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-work-copy strong{font-size:14px}.dc-work-copy p{margin:5px 0 0;color:var(--dc-muted);font-size:10px}.dc-work-progress{height:4px;margin-top:9px;border-radius:999px;background:var(--dc-line);overflow:hidden}.dc-work-progress i{display:block;height:100%;background:var(--dc-accent);border-radius:999px}
.dc-home-main-grid.refined{display:grid;grid-template-columns:minmax(480px,1.15fr) minmax(360px,.85fr);gap:14px;margin-top:14px}.dc-dashboard-panel{border-radius:18px;background:linear-gradient(180deg,#151519,#101013);border-color:#303039}.dc-feature-list{display:grid;gap:10px}.dc-feature-row{min-height:78px;display:grid;grid-template-columns:82px minmax(0,1fr) auto 18px;align-items:center;gap:13px;padding:10px;border:1px solid var(--dc-line);border-radius:14px;background:#0b0b0d;text-align:left;color:var(--dc-text)}.dc-feature-row:hover{border-color:rgba(217,180,120,.42);background:#111115}.dc-feature-row>svg{width:17px;height:17px;color:var(--dc-subtle)}.dc-feature-thumb{width:82px;height:52px;border-radius:10px;overflow:hidden;display:grid;place-items:center;background:#050506}.dc-feature-thumb img{width:100%;height:100%;object-fit:cover}.dc-feature-thumb.empty{color:var(--dc-muted);border:1px solid var(--dc-line)}.dc-feature-thumb.empty svg{width:24px;height:24px}.dc-feature-main{min-width:0}.dc-feature-main strong,.dc-feature-main em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-feature-main strong{font-size:12px;font-style:normal}.dc-feature-main em{margin-top:4px;color:var(--dc-muted);font-size:9px;font-style:normal}
.dc-platform-panel-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dc-platform-tile{position:relative;min-height:92px;display:grid;grid-template-columns:42px 1fr auto;grid-template-rows:auto auto;gap:4px 10px;align-items:center;padding:13px;border:1px solid var(--dc-line);border-radius:15px;background:#0b0b0d;text-align:left;color:var(--dc-text)}.dc-platform-tile:hover{border-color:rgba(217,180,120,.35);background:#111115}.dc-platform-tile .dc-social-logo{grid-row:1/3;width:42px!important;height:42px!important;border-radius:14px!important}.dc-platform-tile strong{font-size:12px}.dc-platform-tile em{font-size:9px;color:var(--dc-muted);font-style:normal;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-platform-tile b{grid-column:3;grid-row:1/3;align-self:center}.dc-platform-tile[aria-disabled="true"]{opacity:.78}.dc-mini-post-list,.dc-activity-grid{display:grid;gap:9px}.dc-mini-post{min-height:62px;display:grid;grid-template-columns:56px minmax(0,1fr) auto 18px;align-items:center;gap:10px;padding:9px;border:1px solid var(--dc-line);border-radius:13px;background:#0b0b0d;text-align:left;color:var(--dc-text)}.dc-mini-post:hover{border-color:rgba(217,180,120,.35);background:#111115}.dc-mini-post img,.dc-mini-post>span:first-child{width:56px;height:40px;border-radius:9px;object-fit:cover;background:#050506;display:grid;place-items:center;color:var(--dc-muted)}.dc-mini-post strong,.dc-mini-post em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-mini-post strong{font-size:10.5px}.dc-mini-post em{font-size:8.5px;color:var(--dc-muted);font-style:normal}.dc-mini-post svg{width:16px;height:16px;color:var(--dc-subtle)}
.dc-activity-chip{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:center;gap:10px;min-height:48px;padding:8px 10px;border:1px solid var(--dc-line);border-radius:13px;background:#0b0b0d}.dc-activity-chip span{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:rgba(83,199,139,.10);color:var(--dc-green)}.dc-activity-chip.live span{background:rgba(217,180,120,.11);color:var(--dc-accent2)}.dc-activity-chip span svg{width:18px;height:18px}.dc-activity-chip strong{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:10.5px}.dc-activity-chip em{color:var(--dc-muted);font-style:normal;font-size:8.5px;white-space:nowrap}
.dc-sidebar-live{background:linear-gradient(180deg,#121215,#0b0b0d)!important;border-color:rgba(217,180,120,.22)!important}.dc-sidebar-status-pills{display:none!important}.dc-sidebar-live-foot{grid-template-columns:1fr 1fr!important}.dc-sidebar-live-foot .dc-btn{font-size:8px}.dc-mini-job{border-radius:12px!important;background:#08080a!important}.dc-mini-job strong{font-size:9px!important}.dc-mini-job span{font-size:7.4px!important}
@media(max-width:1250px){.dc-command-strip,.dc-home-main-grid.refined{grid-template-columns:1fr}.dc-home-quick.upgraded{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.dc-home-quick.upgraded,.dc-platform-panel-grid{grid-template-columns:1fr}.dc-command-strip{grid-template-columns:1fr}.dc-feature-row{grid-template-columns:66px minmax(0,1fr) auto}.dc-feature-thumb{width:66px;height:44px}.dc-work-card{align-items:flex-start}.dc-work-card .dc-btn{width:auto}.dc-platform-tile{grid-template-columns:38px 1fr}.dc-platform-tile b{grid-column:2;grid-row:auto;justify-self:start}.dc-mini-post{grid-template-columns:50px minmax(0,1fr) 16px}.dc-mini-post em{display:none}}
`;


const v3ProjectCss = String.raw`
/* V3E: project detail fit, cleaner home, complete clip actions */
body.dc-app{overflow-x:hidden!important}
body.dc-app #libraryBrowser{display:none!important}
body.dc-project-open .library-browser-foot,body.dc-project-open .library-actions,body.dc-project-open .bulk-actions{display:none!important}
body.dc-project-open #view-projects{width:100%!important;max-width:none!important;overflow:visible!important}
body.dc-project-open .main-col,body.dc-project-open #app>.wrap{overflow-x:hidden!important}
.dc-v3-hero.slim{min-height:250px!important;padding:20px!important;grid-template-columns:minmax(0,1fr) minmax(260px,.48fr)!important;margin-bottom:12px!important}
.dc-v3-hero.slim .dc-v3-title{font-size:clamp(27px,3vw,36px)!important;max-width:660px!important;margin:14px 0 8px!important}
.dc-v3-hero.slim .dc-v3-copy{font-size:11.5px!important;max-width:560px!important;line-height:1.55!important}
.dc-v3-hero.slim .dc-v3-phone-wall{min-height:205px!important}.dc-v3-hero.slim .dc-v3-phone{width:94px!important;border-radius:15px!important}
.dc-home-quick{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin:12px 0}.dc-home-quick .dc-v3-source{min-height:104px!important;padding:13px!important;border-radius:16px!important}.dc-home-quick .dc-v3-source strong{font-size:12.5px}.dc-home-quick .dc-v3-source span:last-child{font-size:9px}.dc-home-quick .dc-v3-platform{width:38px!important;height:38px!important;margin-bottom:12px!important}
.dc-home-main-grid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(340px,.85fr);gap:14px;align-items:start;margin-top:14px}.dc-home-main-grid .dc-card{min-width:0}.dc-home-side-stack{display:grid;gap:14px}.dc-home-main-grid .dc-list-row,.dc-home-main-grid .dc-now-row{min-height:52px;padding:9px 10px;border-radius:12px}.dc-home-main-grid .dc-list-copy strong,.dc-home-main-grid .dc-now-main strong{font-size:10.5px}.dc-home-main-grid .dc-list-copy span,.dc-home-main-grid .dc-now-main span{font-size:8.5px}.dc-home-metrics.v3.tight{grid-template-columns:repeat(5,minmax(92px,1fr));gap:8px}.dc-home-metrics.v3.tight .dc-metric{padding:13px!important}.dc-home-metrics.v3.tight .dc-metric strong{font-size:22px!important}
.dc-project-grid{grid-template-columns:repeat(auto-fill,minmax(285px,1fr))!important;gap:14px!important}.dc-project-card{min-width:0!important}.dc-project-cover{height:190px!important}.dc-project-placeholder{height:100%;display:grid;place-items:center;gap:6px;color:var(--dc-muted);background:radial-gradient(circle at 35% 25%,rgba(217,180,120,.11),transparent 40%),#070708}.dc-project-placeholder svg{width:32px;height:32px}.dc-project-placeholder span{font-size:10px}.dc-project-error-mini{margin:8px 0 0;padding:8px 9px;border-radius:10px;background:rgba(239,107,122,.10);color:#ff8996;font-size:8px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.dc-project-actions.three{grid-template-columns:1fr 1fr!important}.dc-project-actions.three .dc-btn:first-child{grid-column:1/-1}.dc-project-actions .dc-btn.danger{min-height:34px}
.dc-project-detail-page{width:100%;max-width:100%;overflow:hidden;display:flex;flex-direction:column;gap:12px;padding-bottom:30px}.dc-project-detail-hero{display:flex;align-items:flex-end;gap:14px;min-height:148px;padding:14px;border:1px solid var(--dc-line);border-radius:18px;background:linear-gradient(135deg,rgba(217,180,120,.10),#111114 45%,rgba(85,183,255,.06));position:relative;overflow:hidden}.dc-project-detail-hero::after{content:'';position:absolute;right:-90px;top:-120px;width:290px;height:290px;border-radius:50%;background:radial-gradient(circle,rgba(217,180,120,.18),transparent 66%);pointer-events:none}.dc-project-detail-thumb{width:92px;aspect-ratio:9/16;border-radius:13px;overflow:hidden;background:#050506;border:1px solid rgba(255,255,255,.08);box-shadow:0 16px 34px rgba(0,0,0,.32);flex:0 0 auto}.dc-project-detail-thumb img{width:100%;height:100%;object-fit:cover}.dc-project-detail-info{flex:1;min-width:0;position:relative;z-index:1}.dc-project-detail-info h1{font-size:23px;line-height:1.1;letter-spacing:-.03em;margin:0 0 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-project-detail-info p{font-size:10px;color:var(--dc-muted);margin:0}.dc-project-detail-actions{position:relative;z-index:1;display:flex;gap:8px;flex-wrap:wrap}.dc-project-detail-actions .dc-btn{min-height:36px}.dc-project-detail-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.dc-project-detail-stats .dc-metric{padding:12px!important;border-radius:13px}.dc-project-detail-stats .dc-metric strong{font-size:20px!important}.dc-project-detail-stats .dc-metric span{font-size:8.5px!important}.dc-project-detail-filter{display:grid;grid-template-columns:minmax(130px,170px) minmax(130px,170px) minmax(100px,120px) auto;gap:8px;align-items:center;padding:10px;border:1px solid var(--dc-line);border-radius:14px;background:#0e0e11}.dc-project-detail-filter select{height:38px;min-height:38px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d;color:var(--dc-text);padding:0 10px}.dc-project-detail-filter .dc-btn{justify-self:end}.dc-project-clip-grid{display:grid!important;grid-template-columns:repeat(auto-fill,minmax(216px,1fr))!important;gap:14px!important;width:100%!important;max-width:100%!important;overflow:visible!important;padding:0!important}.dc-project-clip-grid .dc-clip-card{min-width:0!important;width:100%!important;max-width:none!important}.dc-project-clip-grid .dc-clip-media{max-height:365px}.dc-clip-card.v3-full .dc-clip-body{padding:11px}.dc-clip-card.v3-full .dc-clip-body h3{font-size:11.5px;min-height:34px}.dc-clip-card.v3-full .dc-clip-body p{font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-clip-card.v3-full .dc-clip-actions{grid-template-columns:1fr 1fr!important;gap:7px}.dc-clip-card.v3-full .dc-clip-actions .dc-btn{min-height:32px;font-size:8.8px;padding:0 6px}.dc-clip-state{position:absolute;left:9px;top:9px}.dc-clip-media-button{display:block;width:100%;height:100%;border:0;padding:0;background:transparent;color:inherit}.dc-clip-media-button img{width:100%;height:100%;object-fit:cover}.dc-empty-full{grid-column:1/-1}.dc-review-actions{grid-template-columns:repeat(5,minmax(76px,1fr))!important;min-width:430px}.dc-caption-edit-shortcut{min-height:34px!important;font-size:9px!important}.dc-caption-editor{min-height:230px!important;font-size:13px!important;line-height:1.55!important}
@media(max-width:1250px){.dc-home-quick{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-home-main-grid{grid-template-columns:1fr}.dc-project-detail-stats{grid-template-columns:repeat(3,minmax(0,1fr))}.dc-project-detail-filter{grid-template-columns:1fr 1fr}.dc-project-detail-filter .dc-btn{justify-self:stretch}.dc-review-actions{grid-column:1/-1;min-width:0!important}}
@media(max-width:720px){.dc-v3-hero.slim{grid-template-columns:1fr!important;min-height:0!important}.dc-home-quick{grid-template-columns:1fr}.dc-home-metrics.v3.tight,.dc-project-detail-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-project-detail-hero{align-items:flex-start;flex-wrap:wrap}.dc-project-detail-thumb{width:74px}.dc-project-detail-info h1{white-space:normal;font-size:20px}.dc-project-detail-actions{width:100%}.dc-project-detail-actions .dc-btn{flex:1}.dc-project-detail-filter{grid-template-columns:1fr}.dc-project-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}.dc-clip-card.v3-full .dc-clip-actions{grid-template-columns:1fr!important}.dc-review-actions{grid-template-columns:1fr 1fr!important}}
@media(max-width:460px){.dc-project-clip-grid,.dc-project-grid{grid-template-columns:1fr!important}}

/* V3G: less boxy home, more cinematic dashboard */
.dc-home-v3g{display:flex;flex-direction:column;gap:18px}.dc-home-hero-g{position:relative;min-height:330px;display:grid;grid-template-columns:minmax(420px,1.1fr) minmax(320px,.9fr);align-items:center;gap:22px;padding:34px 28px;border:1px solid rgba(217,180,120,.28);border-radius:26px;background:radial-gradient(circle at 12% 6%,rgba(217,180,120,.18),transparent 30%),radial-gradient(circle at 86% 20%,rgba(85,183,255,.12),transparent 32%),linear-gradient(135deg,#17130f,#101114 58%,#0b1118);overflow:hidden}.dc-home-hero-g::after{content:'';position:absolute;right:-150px;top:-180px;width:420px;height:420px;border-radius:50%;border:1px solid rgba(217,180,120,.18);background:rgba(217,180,120,.045);pointer-events:none}.dc-home-hero-copy{position:relative;z-index:1}.dc-home-hero-copy h1{font-size:clamp(36px,4vw,58px);line-height:.94;letter-spacing:-.055em;margin:18px 0 12px;max-width:760px}.dc-home-hero-copy p{max-width:620px;margin:0;color:var(--dc-muted);font-size:14px;line-height:1.55}.dc-stat-ribbon{display:flex;flex-wrap:wrap;gap:8px;margin:17px 0 2px}.dc-tiny-stat{display:inline-flex;align-items:center;gap:6px;min-height:30px;padding:0 10px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(0,0,0,.22);color:var(--dc-muted);font-size:10px}.dc-tiny-stat b{color:var(--dc-text);font-size:14px}.dc-hero-stage{position:relative;z-index:1;min-height:250px}.dc-hero-stage .dc-v3-phone-wall{height:100%;min-height:260px}.dc-home-import-g{display:grid;grid-template-columns:44px minmax(320px,1fr) 190px 92px 140px auto;gap:9px;align-items:center;padding:10px;border:1px solid var(--dc-line);border-radius:20px;background:linear-gradient(180deg,#141417,#0d0d10)}.dc-import-icon{width:44px;height:44px;border-radius:15px;display:grid;place-items:center;background:rgba(255,0,51,.12);color:#ff4168}.dc-import-icon svg{width:24px;height:24px}.dc-home-import-g input,.dc-home-import-g select{height:46px;min-height:46px;border:1px solid var(--dc-line);border-radius:14px;background:#09090b;color:var(--dc-text);padding:0 13px}.dc-home-import-g .dc-btn{height:46px;border-radius:14px}.dc-home-flow-g{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dc-flow-card-g{min-height:86px;display:grid;grid-template-columns:42px minmax(0,1fr);grid-template-rows:auto auto;align-content:center;column-gap:12px;padding:14px 15px;border:1px solid var(--dc-line);border-radius:20px;background:linear-gradient(145deg,rgba(255,255,255,.038),rgba(255,255,255,.012));text-align:left;color:var(--dc-text);transition:transform .18s ease,border-color .18s ease,background .18s ease}.dc-flow-card-g:hover{transform:translateY(-2px);border-color:var(--dc-line2);background:linear-gradient(145deg,rgba(217,180,120,.07),rgba(255,255,255,.018))}.dc-flow-card-g>span{grid-row:1/3;width:42px;height:42px;border-radius:14px;display:grid;place-items:center;background:rgba(217,180,120,.10);color:var(--dc-accent2)}.dc-flow-card-g svg{width:21px;height:21px}.dc-flow-card-g strong{font-size:14px}.dc-flow-card-g em{font-style:normal;color:var(--dc-muted);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-home-command-g{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(300px,.65fr);gap:16px;align-items:start}.dc-home-main-g{display:flex;flex-direction:column;gap:16px}.dc-live-focus-g{min-height:128px;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:20px;border:1px solid rgba(217,180,120,.18);border-radius:24px;background:radial-gradient(circle at 100% 0,rgba(217,180,120,.11),transparent 32%),linear-gradient(145deg,#151519,#0f0f12)}.dc-live-focus-g.busy{border-color:rgba(217,180,120,.42)}.dc-live-left{display:flex;align-items:center;gap:15px;min-width:0}.dc-live-icon{width:56px;height:56px;flex:0 0 56px;border-radius:18px;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-live-icon.good{background:rgba(83,199,139,.11);color:var(--dc-green)}.dc-live-icon svg{width:26px;height:26px}.dc-live-focus-g small{display:block;color:var(--dc-accent2);font-size:9px;text-transform:uppercase;letter-spacing:.1em;margin-bottom:5px}.dc-live-focus-g h2{margin:0;font-size:21px;letter-spacing:-.025em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-live-focus-g p{margin:5px 0 0;color:var(--dc-muted);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-project-gallery-g{padding:20px;border:1px solid var(--dc-line);border-radius:24px;background:linear-gradient(180deg,#131316,#0d0d10)}.dc-simple-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.dc-simple-head h2{margin:0;font-size:18px}.dc-simple-head p{margin:4px 0 0;color:var(--dc-muted);font-size:11px}.dc-project-strip-g{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.dc-cinema-project{display:flex;flex-direction:column;gap:10px;min-width:0;padding:10px;border:1px solid var(--dc-line);border-radius:18px;background:#0b0b0d;text-align:left;color:var(--dc-text);transition:transform .18s ease,border-color .18s ease}.dc-cinema-project:hover{transform:translateY(-2px);border-color:var(--dc-line2)}.dc-cinema-thumb{height:132px;border-radius:14px;overflow:hidden;background:#050506;display:grid;place-items:center;color:var(--dc-muted)}.dc-cinema-thumb img{width:100%;height:100%;object-fit:cover}.dc-cinema-copy strong,.dc-cinema-copy em{display:block}.dc-cinema-copy strong{font-size:12px;line-height:1.3;min-height:32px}.dc-cinema-copy em{font-style:normal;color:var(--dc-muted);font-size:9px;margin-top:4px}.dc-cinema-project .dc-pill{align-self:flex-start}.dc-home-dock-g{display:flex;flex-direction:column;gap:12px}.dc-dock-card-g{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(180deg,#141417,#0d0d10)}.dc-dock-card-g.next{border-color:rgba(217,180,120,.22)}.dc-dock-card-g.warn{border-color:rgba(239,107,122,.24)}.dc-dock-head{display:flex;align-items:center;gap:8px;margin-bottom:12px}.dc-dock-head span{width:34px;height:34px;border-radius:12px;display:grid;place-items:center;background:rgba(217,180,120,.10);color:var(--dc-accent2)}.dc-dock-head svg{width:18px;height:18px}.dc-dock-head b{font-size:14px}.dc-dock-card-g p{margin:0 0 12px;color:var(--dc-muted);font-size:11px;line-height:1.45}.dc-dock-post{display:grid;grid-template-columns:58px minmax(0,1fr);grid-template-rows:auto auto;gap:2px 10px;align-items:center;margin-bottom:12px}.dc-dock-post img{grid-row:1/3;width:58px;height:58px;border-radius:14px;object-fit:cover}.dc-dock-post strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.dc-dock-post em{font-style:normal;color:var(--dc-muted);font-size:9px}.dc-platform-dots{display:flex;gap:8px;margin-bottom:10px}.dc-platform-dot{width:40px;height:40px;border-radius:14px;display:grid;place-items:center;background:#0b0b0d;color:var(--dc-subtle);border:1px solid var(--dc-line);opacity:.75}.dc-platform-dot svg{width:19px;height:19px}.dc-platform-dot.on{opacity:1;border-color:rgba(83,199,139,.24)}.dc-platform-dot.ready{opacity:1;border-color:rgba(217,180,120,.24)}.dc-platform-dot.youtube{color:#ff4168}.dc-platform-dot.tiktok{color:#3ef4ee}.dc-platform-dot.instagram{color:#ff7ebe}.dc-platform-dot.facebook{color:#7aa7ff}
@media(max-width:1250px){.dc-home-hero-g,.dc-home-command-g{grid-template-columns:1fr}.dc-project-strip-g{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-home-import-g{grid-template-columns:44px minmax(260px,1fr) 170px 90px}.dc-home-import-g #dcCreateDuration,.dc-home-import-g #dcGenerate{grid-column:auto}.dc-home-flow-g{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:760px){.dc-home-hero-g{padding:22px 18px;min-height:0}.dc-home-hero-copy h1{font-size:32px}.dc-hero-stage{display:none}.dc-home-import-g{grid-template-columns:1fr}.dc-import-icon{display:none}.dc-home-flow-g,.dc-project-strip-g{grid-template-columns:1fr}.dc-live-focus-g{align-items:flex-start;flex-direction:column}.dc-live-focus-g .dc-btn{width:100%}}
.dc-home-import-g{grid-template-columns:44px minmax(280px,1fr) 180px 82px 130px auto auto}
@media(max-width:1250px){.dc-home-import-g{grid-template-columns:44px minmax(260px,1fr) 170px 90px}}
@media(max-width:760px){.dc-home-import-g{grid-template-columns:1fr}}

`;


const clipToolsCss = String.raw`
/* Clip Review feature pass: hook detector + post copy generator. Editor CSS untouched. */
.dc-review-page-pro{display:grid;gap:16px}.dc-review-hero-pro{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:22px;border:1px solid rgba(217,180,120,.20);border-radius:24px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.13),transparent 34%),linear-gradient(145deg,#151519,#0d0d10)}.dc-review-hero-pro h1{font-size:32px;line-height:1;margin:8px 0 8px;letter-spacing:-.035em}.dc-review-hero-pro p{margin:0;color:var(--dc-muted);font-size:12px;max-width:620px;line-height:1.5}.dc-review-kicker{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border:1px solid rgba(217,180,120,.22);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.dc-review-metrics-pro{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-review-metrics-pro span{min-width:92px;padding:10px 12px;border:1px solid var(--dc-line);border-radius:14px;background:#09090b}.dc-review-metrics-pro b,.dc-review-metrics-pro em{display:block}.dc-review-metrics-pro b{font-size:20px}.dc-review-metrics-pro em{font-style:normal;color:var(--dc-muted);font-size:9px;margin-top:2px}.dc-review-list.pro{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:14px}.dc-review-item.pro{display:grid;grid-template-columns:118px minmax(0,1fr);gap:14px;align-items:stretch;padding:14px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 20px 50px rgba(0,0,0,.18)}.dc-review-item.pro:hover{border-color:var(--dc-line2)}.dc-review-item.pro .dc-review-media{width:118px;border-radius:16px;box-shadow:0 16px 40px #0007}.dc-review-item.pro .dc-review-score{left:8px;bottom:8px;height:28px;min-width:34px;font-size:11px}.dc-review-main{min-width:0;display:flex;flex-direction:column;gap:10px}.dc-review-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dc-review-title-row h3{font-size:15px;line-height:1.22;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dc-review-title-row small{white-space:nowrap;color:var(--dc-muted);font-size:9px;margin-top:3px}.dc-hook-strip{display:grid;grid-template-columns:minmax(130px,.38fr) minmax(0,1fr);gap:8px}.dc-hook-card,.dc-copy-card{border:1px solid var(--dc-line);border-radius:14px;background:#09090b;padding:10px}.dc-hook-card strong,.dc-copy-card strong{display:flex;align-items:center;gap:7px;font-size:10px}.dc-hook-card p,.dc-copy-card p{margin:6px 0 0;color:var(--dc-muted);font-size:9px;line-height:1.45}.dc-hook-badge{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 8px;border-radius:999px;font-size:9px;font-weight:800}.dc-hook-badge.good{background:rgba(83,199,139,.10);color:var(--dc-green)}.dc-hook-badge.warn{background:rgba(229,169,87,.10);color:var(--dc-orange)}.dc-copy-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-copy-mini{padding:9px;border:1px solid var(--dc-line);border-radius:12px;background:#0d0d10;min-width:0}.dc-copy-mini b,.dc-copy-mini span{display:block}.dc-copy-mini b{font-size:8.5px;color:var(--dc-accent2);text-transform:uppercase;letter-spacing:.07em}.dc-copy-mini span{font-size:9.5px;color:var(--dc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:5px}.dc-review-actions.pro{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;min-width:0}.dc-review-actions.pro .dc-btn{min-width:0;padding:0 8px;font-size:9.5px}.dc-review-actions.pro .wide{grid-column:span 2}.dc-review-empty-pro{min-height:260px;display:grid;place-items:center;padding:30px;border:1px dashed #373740;border-radius:24px;background:radial-gradient(circle at 50% 0,rgba(217,180,120,.10),transparent 42%),#101013;text-align:center}.dc-review-empty-pro .dc-empty-icon{width:58px;height:58px;margin:0 auto 13px;border-radius:20px;background:rgba(217,180,120,.12);display:grid;place-items:center;color:var(--dc-accent2)}.dc-review-empty-pro strong{display:block;font-size:18px}.dc-review-empty-pro p{color:var(--dc-muted);font-size:12px;margin:7px 0 16px}.dc-review-toolbar.pro{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dc-review-toolbar.pro .spacer{flex:1}@media(max-width:760px){.dc-review-hero-pro{grid-template-columns:1fr}.dc-review-metrics-pro{justify-content:flex-start}.dc-review-list.pro{grid-template-columns:1fr}.dc-review-item.pro{grid-template-columns:94px minmax(0,1fr);padding:11px}.dc-review-item.pro .dc-review-media{width:94px}.dc-hook-strip,.dc-copy-grid{grid-template-columns:1fr}.dc-review-actions.pro{grid-template-columns:1fr 1fr}.dc-review-actions.pro .wide{grid-column:auto}}


/* V3H: premium icons, cleaner sidebar and complete manage tabs */
.dc-nav-icon{border-radius:9px;background:rgba(255,255,255,.035);color:var(--dc-muted);transition:background .18s ease,color .18s ease,transform .18s ease}.dc-nav-button.is-active .dc-nav-icon{background:rgba(217,180,120,.16);box-shadow:0 0 0 1px rgba(217,180,120,.18) inset;color:var(--dc-accent2)}.dc-nav-button:hover .dc-nav-icon{transform:translateY(-1px);background:rgba(255,255,255,.06)}.dc-v3-platform,.dc-social-logo,.dc-mini-job-icon{position:relative;overflow:hidden}.dc-v3-platform::after,.dc-social-logo::after,.dc-mini-job-icon::after{content:'';position:absolute;inset:-40%;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.20),transparent 38%);pointer-events:none}.dc-v3-platform svg,.dc-social-logo svg,.dc-mini-job-icon svg{position:relative;z-index:1}.dc-v3-platform.youtube,.dc-social-logo.youtube{background:linear-gradient(135deg,rgba(255,0,51,.20),rgba(255,255,255,.045));color:#ff456b}.dc-v3-platform.tiktok,.dc-social-logo.tiktok{background:linear-gradient(135deg,rgba(37,244,238,.18),rgba(254,44,85,.12));color:#4ff5ef}.dc-v3-platform.instagram,.dc-social-logo.instagram{background:linear-gradient(135deg,rgba(252,204,99,.20),rgba(225,48,108,.18),rgba(91,81,216,.16));color:#ff91c4}.dc-v3-platform.facebook,.dc-social-logo.facebook{background:linear-gradient(135deg,rgba(24,119,242,.22),rgba(255,255,255,.045));color:#8bbcff}.dc-sidebar-live{background:radial-gradient(circle at 0 0,rgba(217,180,120,.13),transparent 35%),linear-gradient(180deg,#141418,#0b0b0d)!important;border-color:rgba(217,180,120,.22)!important;box-shadow:0 14px 36px rgba(0,0,0,.24)}.dc-sidebar-live-head{align-items:flex-start}.dc-live-orb{position:relative}.dc-live-orb::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:1px solid currentColor;opacity:.18}.dc-sidebar-status-pills{grid-template-columns:1fr 1fr!important}.dc-side-pill{background:rgba(255,255,255,.035)!important;border-color:rgba(255,255,255,.07)!important}.dc-sidebar-live-foot .dc-btn{border-radius:9px!important}.dc-mini-job{background:rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.06)!important}.dc-manage-page{display:grid;gap:16px}.dc-manage-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:22px;border:1px solid rgba(217,180,120,.20);border-radius:24px;background:radial-gradient(circle at 4% 0,rgba(217,180,120,.14),transparent 35%),linear-gradient(145deg,#151519,#0d0d10);overflow:hidden}.dc-manage-hero h1{font-size:32px;line-height:1;margin:8px 0 8px;letter-spacing:-.04em}.dc-manage-hero p{margin:0;color:var(--dc-muted);font-size:12px;max-width:650px;line-height:1.55}.dc-manage-kicker{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border:1px solid rgba(217,180,120,.22);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.dc-manage-metrics{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-manage-metrics span{min-width:98px;padding:10px 12px;border:1px solid var(--dc-line);border-radius:14px;background:#09090b}.dc-manage-metrics b,.dc-manage-metrics em{display:block}.dc-manage-metrics b{font-size:20px}.dc-manage-metrics em{font-style:normal;color:var(--dc-muted);font-size:9px;margin-top:2px}.dc-manage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.dc-manage-card{position:relative;overflow:hidden;padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 18px 45px rgba(0,0,0,.18)}.dc-manage-card::after{content:'';position:absolute;right:-48px;bottom:-60px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.035);pointer-events:none}.dc-manage-card-top{position:relative;z-index:1;display:flex;align-items:flex-start;gap:12px}.dc-manage-logo{width:48px;height:48px;flex:0 0 48px;border-radius:16px;display:grid;place-items:center}.dc-manage-logo svg{width:24px;height:24px;fill:currentColor}.dc-manage-copy{min-width:0;flex:1}.dc-manage-copy strong,.dc-manage-copy span{display:block}.dc-manage-copy strong{font-size:15px}.dc-manage-copy span{color:var(--dc-muted);font-size:10px;line-height:1.45;margin-top:4px}.dc-manage-actions{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.dc-manage-actions .dc-btn{min-width:0;padding:0 9px}.dc-manage-list{position:relative;z-index:1;margin-top:12px;display:grid;gap:7px}.dc-manage-row{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:12px;background:rgba(0,0,0,.22)}.dc-manage-row strong,.dc-manage-row span{display:block}.dc-manage-row strong{font-size:10.5px}.dc-manage-row span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-manage-row audio{width:100%;height:32px}.dc-settings-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.7fr);gap:14px}.dc-settings-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-settings-panel h2{font-size:16px;margin:0 0 4px}.dc-settings-panel p{font-size:10px;color:var(--dc-muted);margin:0 0 14px;line-height:1.5}.dc-settings-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dc-settings-form label{display:grid;gap:6px;color:var(--dc-muted);font-size:9px}.dc-settings-form input,.dc-settings-form select{width:100%;height:40px;padding:0 10px;border:1px solid var(--dc-line);border-radius:11px;background:#0b0b0d;color:var(--dc-text)}.dc-settings-form .wide{grid-column:1/-1}.dc-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(0,0,0,.22)}.dc-switch-row strong,.dc-switch-row span{display:block}.dc-switch-row strong{font-size:11px}.dc-switch-row span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-switch-row input{width:18px;height:18px}.dc-upload-zone{display:grid;gap:8px;padding:14px;border:1px dashed rgba(217,180,120,.28);border-radius:16px;background:rgba(217,180,120,.045)}.dc-upload-zone input{height:auto;padding:10px}.dc-home-quick .dc-v3-source{border-color:rgba(255,255,255,.08);background:radial-gradient(circle at 100% 0,rgba(255,255,255,.045),transparent 38%),linear-gradient(145deg,#151519,#0d0d10)}.dc-home-quick .dc-v3-source:hover{border-color:rgba(217,180,120,.38);box-shadow:0 16px 42px rgba(0,0,0,.25)}
.dc-nav-group{margin-bottom:8px}.dc-nav-label{display:flex;align-items:center;gap:8px;padding:13px 10px 7px}.dc-nav-label span{white-space:nowrap}.dc-nav-label i{height:1px;flex:1;background:linear-gradient(90deg,var(--dc-line),transparent)}body.dc-side-collapsed .dc-nav-label i{display:none}.dc-sidebar-live{margin:12px 0 10px!important}.dc-sidebar-live-head{display:flex;align-items:center;justify-content:space-between}.dc-live-orb{width:9px;height:9px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-live-orb.busy{background:var(--dc-accent);box-shadow:0 0 0 5px rgba(217,180,120,.10);animation:dcPulse 1s infinite}.dc-sidebar-live-foot{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.dc-sidebar-live-foot .dc-btn{min-height:30px;font-size:8px;padding:0 6px}.dc-studio-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:24px;border:1px solid rgba(217,180,120,.20);border-radius:26px;background:radial-gradient(circle at 6% 0,rgba(217,180,120,.16),transparent 34%),radial-gradient(circle at 90% 20%,rgba(85,183,255,.10),transparent 30%),linear-gradient(145deg,#151519,#0d0d10)}.dc-studio-hero h1{font-size:34px;line-height:.98;letter-spacing:-.045em;margin:8px 0 7px}.dc-studio-hero p{max-width:650px;margin:0;color:var(--dc-muted);font-size:12px;line-height:1.55}.dc-studio-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-studio-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.dc-studio-stat{padding:13px;border:1px solid var(--dc-line);border-radius:17px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-studio-stat strong,.dc-studio-stat span{display:block}.dc-studio-stat strong{font-size:21px}.dc-studio-stat span{font-size:9px;color:var(--dc-muted);margin-top:3px}.dc-template-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.dc-template-card{overflow:hidden;border:1px solid var(--dc-line);border-radius:23px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 18px 45px rgba(0,0,0,.18)}.dc-template-preview{height:150px;position:relative;background:linear-gradient(135deg,#111,#222 45%,#09090b);display:grid;place-items:center}.dc-template-preview::before{content:'';position:absolute;inset:18px 42px;border-radius:18px;background:linear-gradient(180deg,#2d2d35,#0e0e10);border:1px solid rgba(255,255,255,.08)}.dc-template-caption{position:relative;text-align:center;font-size:20px;font-weight:900;line-height:1;color:#fff;text-shadow:0 2px 8px #000;-webkit-text-stroke:1px #000}.dc-template-card-body{padding:14px}.dc-template-card-body h3{font-size:14px;margin:0}.dc-template-card-body p{font-size:9px;color:var(--dc-muted);line-height:1.45;margin:5px 0 12px}.dc-template-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-template-actions .dc-btn{min-width:0;padding:0 8px;font-size:9px}.dc-insight-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:14px}.dc-insight-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-insight-panel h2{font-size:16px;margin:0 0 10px}.dc-quality-row{display:grid;grid-template-columns:110px 1fr 48px;gap:10px;align-items:center;margin:10px 0}.dc-quality-row span,.dc-quality-row b{font-size:9px;color:var(--dc-muted)}.dc-quality-row b{color:var(--dc-text);text-align:right}.dc-quality-bar{height:9px;border-radius:999px;background:#25252a;overflow:hidden}.dc-quality-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2))}.dc-studio-roadmap{display:grid;gap:8px}.dc-road-step{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(0,0,0,.22)}.dc-road-step span{width:30px;height:30px;border-radius:11px;display:grid;place-items:center;background:rgba(217,180,120,.10);color:var(--dc-accent2)}.dc-road-step strong,.dc-road-step em{display:block}.dc-road-step strong{font-size:10.5px}.dc-road-step em{font-style:normal;font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-manage-hero{border-radius:26px!important}.dc-manage-kicker svg{width:15px;height:15px}@media(max-width:900px){.dc-studio-hero,.dc-insight-grid{grid-template-columns:1fr}.dc-studio-actions{justify-content:flex-start}.dc-template-actions{grid-template-columns:1fr}}
@media(max-width:900px){.dc-manage-hero,.dc-settings-grid{grid-template-columns:1fr}.dc-manage-metrics{justify-content:flex-start}.dc-manage-actions{grid-template-columns:1fr}.dc-settings-form{grid-template-columns:1fr}.dc-settings-form .wide{grid-column:auto}}

/* V3L: sidebar live removed + focused action toast */
#dcSidebar .dc-nav-scroll{padding-top:14px}
#dcSidebar .dc-nav-group{margin-bottom:12px}
body.dc-side-collapsed #dcSidebar .dc-nav-group{margin-bottom:8px}
@media(max-width:720px){#dcWork{bottom:calc(12px + env(safe-area-inset-bottom));width:calc(100vw - 22px);min-height:58px;padding-left:13px;padding-right:42px}#dcWork .dc-work-toast-orb{width:34px;height:34px;flex-basis:34px}#dcWork strong{font-size:11px}#dcWork span{font-size:8px}#dcWork .dc-work-toast-progress{left:52px;right:50px}}

`;



const scheduleKeepCss = String.raw`
/* V3J: keep the original Schedule board, only polish it to match the new app */
body.dc-app #view-schedule{
  max-width:1540px;
  margin:0 auto;
  overflow-x:hidden;
}
body.dc-app #view-schedule .sched-head{
  position:relative;
  align-items:center;
  padding:22px 24px;
  margin-bottom:14px;
  border:1px solid rgba(217,180,120,.20);
  border-radius:26px;
  background:radial-gradient(circle at 4% 0,rgba(217,180,120,.15),transparent 34%),radial-gradient(circle at 92% 18%,rgba(85,183,255,.10),transparent 32%),linear-gradient(145deg,#151519,#0d0d10);
  overflow:hidden;
}
body.dc-app #view-schedule .sched-head h2{
  margin:0 0 7px;
  font-size:clamp(25px,3vw,36px);
  line-height:1;
  letter-spacing:-.045em;
}
body.dc-app #view-schedule .sched-head .note{
  display:block;
  max-width:620px;
  color:var(--dc-muted);
  font-size:11px;
  line-height:1.5;
}
body.dc-app #view-schedule .sched-range{
  margin-left:auto;
  padding:5px;
  border-radius:14px;
  background:rgba(0,0,0,.24);
  border-color:rgba(255,255,255,.075);
}
body.dc-app #view-schedule .range-btn{
  min-height:36px;
  padding:0 13px;
  border-radius:10px;
  font-size:10px;
  font-weight:750;
  letter-spacing:.01em;
}
body.dc-app #view-schedule .range-btn.on{
  background:var(--dc-accent);
  color:#1a1206;
  box-shadow:0 10px 26px rgba(217,180,120,.14);
}
body.dc-app #view-schedule .sched-health{
  grid-template-columns:repeat(4,minmax(140px,1fr));
  gap:10px;
  margin-bottom:14px;
}
body.dc-app #view-schedule .health-card{
  min-height:94px;
  padding:14px 15px;
  border-radius:18px;
  background:linear-gradient(145deg,#151519,#0d0d10);
  border-color:rgba(255,255,255,.075);
  box-shadow:0 18px 42px rgba(0,0,0,.14);
}
body.dc-app #view-schedule .health-card::after{
  height:3px;
  background:linear-gradient(90deg,var(--dc-accent),transparent);
  opacity:.65;
}
body.dc-app #view-schedule .health-k{
  font-size:9px;
  color:var(--dc-muted);
  letter-spacing:.09em;
}
body.dc-app #view-schedule .health-v{
  font-size:28px;
  line-height:1;
  margin-top:7px;
}
body.dc-app #view-schedule .health-s{
  font-size:9px;
  color:var(--dc-subtle);
  margin-top:6px;
}
body.dc-app #view-schedule .schedule-board{
  border-radius:24px;
  background:linear-gradient(180deg,#111114,#0b0b0d);
  border-color:rgba(255,255,255,.085);
  box-shadow:0 22px 55px rgba(0,0,0,.22);
  overflow:hidden;
}
body.dc-app #view-schedule .board-day{
  top:var(--dc-top);
  padding:13px 18px;
  background:rgba(17,17,20,.92);
  backdrop-filter:blur(12px);
  border-color:rgba(255,255,255,.07);
}
body.dc-app #view-schedule .board-day .code{
  color:var(--dc-text);
  font-size:12px;
}
body.dc-app #view-schedule .board-day-n{
  font-size:9px;
  color:var(--dc-subtle);
}
body.dc-app #view-schedule .slot-card{
  grid-template-columns:72px minmax(72px,86px) minmax(0,1fr) minmax(132px,auto);
  gap:14px;
  padding:13px 16px;
  border-color:rgba(255,255,255,.065);
  min-width:0;
}
body.dc-app #view-schedule .slot-card:hover{
  background:rgba(255,255,255,.035);
}
body.dc-app #view-schedule .slot-card.next{
  background:linear-gradient(90deg,rgba(217,180,120,.10),rgba(217,180,120,.025));
}
body.dc-app #view-schedule .slot-time{
  font-size:14px;
  color:var(--dc-muted);
}
body.dc-app #view-schedule .slot-card.next .slot-time{
  color:var(--dc-accent2);
}
body.dc-app #view-schedule .slot-media{
  width:78px;
  border-radius:14px;
  border-color:rgba(255,255,255,.09);
  box-shadow:0 12px 30px rgba(0,0,0,.30);
}
body.dc-app #view-schedule .slot-media.empty{
  background:radial-gradient(circle at 50% 15%,rgba(217,180,120,.18),transparent 40%),#101014;
}
body.dc-app #view-schedule .slot-title{
  font-size:13px;
  letter-spacing:-.015em;
}
body.dc-app #view-schedule .slot-from{
  font-size:10px;
  margin-top:3px;
}
body.dc-app #view-schedule .slot-badges{
  margin-top:7px;
  gap:5px;
}
body.dc-app #view-schedule .safe-badge{
  font-size:8px;
  padding:5px 7px;
  border-color:rgba(255,255,255,.075);
  background:rgba(0,0,0,.26);
}
body.dc-app #view-schedule .slot-actions{
  max-width:190px;
}
body.dc-app #view-schedule .slot-actions .btn,
body.dc-app #view-schedule .slot-actions .dc-btn{
  min-height:32px;
  padding:0 10px;
  border-radius:10px;
  font-size:9px;
}
body.dc-app #view-schedule .slot-status{
  padding:6px 9px;
  border-radius:999px;
  border:1px solid rgba(255,255,255,.075);
  background:rgba(255,255,255,.035);
  color:var(--dc-muted);
  font-size:9px;
}
body.dc-app #view-schedule #schedNote,
body.dc-app #view-schedule .schedule-empty-note{
  margin-top:12px;
  color:var(--dc-muted);
  font-size:10px;
}
.dc-sidebar-live.v3-now{
  padding:10px!important;
  margin:12px 0 10px!important;
  border-radius:16px!important;
  background:radial-gradient(circle at 0 0,rgba(217,180,120,.14),transparent 42%),linear-gradient(180deg,#141418,#0b0b0d)!important;
  border:1px solid rgba(217,180,120,.20)!important;
  box-shadow:0 14px 36px rgba(0,0,0,.23)!important;
}
.dc-now-topline{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px}
.dc-now-chip{display:inline-flex;align-items:center;gap:5px;min-height:22px;padding:0 8px;border-radius:999px;background:rgba(255,255,255,.055);border:1px solid rgba(255,255,255,.08);color:var(--dc-accent2);font-size:7.5px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;white-space:nowrap}
.dc-now-chip.good{color:var(--dc-green)}.dc-now-chip.busy{color:var(--dc-accent)}
.dc-now-title{font-size:8px;color:var(--dc-muted);white-space:nowrap}
.dc-now-focus{display:grid;grid-template-columns:30px minmax(0,1fr);gap:9px;align-items:center;padding:9px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(0,0,0,.28)}
.dc-now-focus-icon{width:30px;height:30px;border-radius:11px;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2);overflow:hidden}
.dc-now-focus-icon img{width:100%;height:100%;object-fit:cover}.dc-now-focus-icon svg{width:16px;height:16px}
.dc-now-focus strong,.dc-now-focus span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-now-focus strong{font-size:9.5px}.dc-now-focus span{font-size:7.8px;color:var(--dc-muted);margin-top:2px}
.dc-now-progress{height:4px;margin-top:8px;border-radius:999px;background:rgba(255,255,255,.075);overflow:hidden}.dc-now-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));width:0%}
.dc-now-next{display:flex;align-items:center;gap:7px;margin-top:8px;padding:8px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.055);color:var(--dc-muted);font-size:7.8px;min-width:0}.dc-now-next b{color:var(--dc-text);font-size:8px;white-space:nowrap}.dc-now-next span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-now-mini-stats{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.dc-now-mini-stats span{padding:7px;border-radius:11px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}.dc-now-mini-stats b,.dc-now-mini-stats em{display:block}.dc-now-mini-stats b{font-size:11px}.dc-now-mini-stats em{font-style:normal;color:var(--dc-subtle);font-size:7px;margin-top:1px}
body.dc-side-collapsed .dc-sidebar-live.v3-now{display:none!important}
@media(max-width:900px){
  body.dc-app #view-schedule .sched-head{grid-template-columns:1fr;padding:18px}
  body.dc-app #view-schedule .sched-range{margin-left:0;width:100%;justify-content:flex-start}
  body.dc-app #view-schedule .sched-health{grid-template-columns:repeat(2,minmax(0,1fr))}
  body.dc-app #view-schedule .slot-card{grid-template-columns:64px 68px minmax(0,1fr);align-items:start}
  body.dc-app #view-schedule .slot-media{width:68px}
  body.dc-app #view-schedule .slot-actions{grid-column:2/-1;justify-content:flex-start;max-width:none}
}
@media(max-width:560px){body.dc-app #view-schedule .sched-health{grid-template-columns:1fr}body.dc-app #view-schedule .slot-card{grid-template-columns:1fr}body.dc-app #view-schedule .slot-media{width:100%;max-width:170px}.dc-now-mini-stats{grid-template-columns:1fr 1fr}}


/* V3K: schedule board repair — keep the old layout, remove the broken overlap */
body.dc-app #view-schedule .schedule-board{
  position:relative!important;
  isolation:isolate!important;
  overflow:hidden!important;
  border-radius:24px!important;
}
body.dc-app #view-schedule .schedule-board > *{
  min-width:0!important;
}
body.dc-app #view-schedule .board-day{
  position:relative!important;
  top:auto!important;
  z-index:5!important;
  min-height:64px!important;
  padding:0 24px!important;
  display:flex!important;
  align-items:center!important;
  gap:14px!important;
  background:linear-gradient(180deg,#17171b,#121216)!important;
  border-bottom:1px solid rgba(255,255,255,.085)!important;
  box-shadow:0 12px 30px rgba(0,0,0,.16)!important;
}
body.dc-app #view-schedule .board-day.today::before{
  content:'';
  position:absolute;
  left:0;
  top:0;
  bottom:0;
  width:3px;
  background:var(--dc-accent);
  box-shadow:0 0 18px rgba(217,180,120,.35);
}
body.dc-app #view-schedule .board-day .code{
  font-size:15px!important;
  font-weight:760!important;
  letter-spacing:-.015em!important;
}
body.dc-app #view-schedule .board-day-n{
  margin-left:auto!important;
  font-size:10px!important;
  color:var(--dc-muted)!important;
}
body.dc-app #view-schedule .slot-card{
  min-height:124px!important;
  grid-template-columns:88px 84px minmax(0,1fr) 210px!important;
  align-items:center!important;
  gap:18px!important;
  padding:16px 24px!important;
  background:linear-gradient(90deg,rgba(255,255,255,.012),transparent 42%)!important;
}
body.dc-app #view-schedule .slot-card.past{
  opacity:.78!important;
}
body.dc-app #view-schedule .slot-card.next{
  opacity:1!important;
  background:linear-gradient(90deg,rgba(217,180,120,.135),rgba(217,180,120,.028) 62%,transparent)!important;
}
body.dc-app #view-schedule .slot-card.next::before{
  width:3px!important;
  background:var(--dc-accent)!important;
  box-shadow:0 0 16px rgba(217,180,120,.32)!important;
}
body.dc-app #view-schedule .slot-time{
  font-size:18px!important;
  font-weight:820!important;
  letter-spacing:-.03em!important;
}
body.dc-app #view-schedule .slot-media{
  width:74px!important;
  border-radius:13px!important;
}
body.dc-app #view-schedule .slot-title{
  max-width:720px!important;
  font-size:14px!important;
  font-weight:760!important;
  color:var(--dc-text)!important;
}
body.dc-app #view-schedule .slot-from{
  max-width:720px!important;
  font-size:10px!important;
  color:var(--dc-muted)!important;
}
body.dc-app #view-schedule .slot-actions{
  max-width:none!important;
  justify-content:flex-end!important;
  gap:8px!important;
}
body.dc-app #view-schedule .slot-actions .btn,
body.dc-app #view-schedule .slot-actions .dc-btn{
  min-height:38px!important;
  padding:0 16px!important;
  font-size:10px!important;
  border-radius:12px!important;
}
body.dc-app #view-schedule .slot-card.open{
  min-height:86px!important;
}
body.dc-app #view-schedule .slot-card.open .slot-media{
  height:58px!important;
  aspect-ratio:auto!important;
}
@media(max-width:980px){
  body.dc-app #view-schedule .slot-card{
    grid-template-columns:70px 76px minmax(0,1fr)!important;
    padding:14px 16px!important;
  }
  body.dc-app #view-schedule .slot-actions{
    grid-column:2 / -1!important;
    justify-content:flex-start!important;
    margin-top:2px!important;
  }
}
@media(max-width:620px){
  body.dc-app #view-schedule .board-day{padding:0 16px!important;min-height:58px!important}
  body.dc-app #view-schedule .slot-card{grid-template-columns:1fr!important;gap:10px!important}
  body.dc-app #view-schedule .slot-media{width:96px!important}
  body.dc-app #view-schedule .slot-actions{grid-column:auto!important;display:grid!important;grid-template-columns:1fr 1fr!important}
}

`;

const publishingWorkspaceCss = String.raw`
/* Publishing workspace: the real product now matches the polished launch preview. */
body.dc-app #view-schedule{max-width:1540px;margin:0 auto}
.dc-publish-page{display:grid;gap:14px}
.dc-publish-hero{position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:space-between;gap:22px;padding:26px 28px;border:1px solid rgba(217,180,120,.2);border-radius:26px;background:radial-gradient(circle at 4% 0,rgba(217,180,120,.16),transparent 36%),radial-gradient(circle at 92% 15%,rgba(90,174,255,.09),transparent 32%),linear-gradient(145deg,#151519,#0c0c0f);box-shadow:0 26px 70px rgba(0,0,0,.22)}
.dc-publish-hero:after{content:'';position:absolute;right:-80px;top:-110px;width:310px;height:310px;border:1px solid rgba(217,180,120,.09);border-radius:50%;box-shadow:0 0 90px rgba(217,180,120,.05);pointer-events:none}
.dc-publish-kicker{display:inline-flex;align-items:center;gap:7px;color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.dc-publish-kicker svg{width:15px;height:15px}
.dc-publish-hero h1{margin:8px 0 7px;font-size:clamp(30px,3vw,42px);line-height:.98;letter-spacing:-.05em}.dc-publish-hero p{max-width:640px;margin:0;color:var(--dc-muted);font-size:11px;line-height:1.55}
.dc-publish-summary{position:relative;z-index:1;display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end}.dc-publish-summary span{min-width:78px;padding:11px 13px;border:1px solid rgba(255,255,255,.075);border-radius:15px;background:rgba(0,0,0,.28)}.dc-publish-summary b,.dc-publish-summary em{display:block}.dc-publish-summary b{font-size:18px}.dc-publish-summary em{margin-top:2px;color:var(--dc-subtle);font-size:8px;font-style:normal}
.dc-publish-layout{display:grid;grid-template-columns:minmax(0,1fr) 318px;gap:14px;align-items:start}
.dc-publish-board,.dc-publish-side-card{overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:24px;background:linear-gradient(180deg,#141417,#0d0d10);box-shadow:0 22px 60px rgba(0,0,0,.2)}
.dc-publish-tabs{display:flex;min-height:60px;padding:0 16px;border-bottom:1px solid rgba(255,255,255,.075);background:rgba(255,255,255,.012)}
.dc-publish-tab{position:relative;display:inline-flex;align-items:center;gap:8px;padding:0 17px;color:var(--dc-muted);font-size:10px;font-weight:720}.dc-publish-tab b{display:grid;place-items:center;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:rgba(255,255,255,.055);font-size:8px}.dc-publish-tab:hover{color:var(--dc-text)}.dc-publish-tab.on{color:var(--dc-text)}.dc-publish-tab.on:after{content:'';position:absolute;left:15px;right:15px;bottom:0;height:2px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));box-shadow:0 0 16px rgba(217,180,120,.25)}.dc-publish-tab.on b{background:rgba(217,180,120,.13);color:var(--dc-accent2)}
.dc-publish-slot-wrap{padding:14px;background:radial-gradient(circle at 100% 0,rgba(217,180,120,.055),transparent 30%)}.dc-publish-slot-tools{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:3px 3px 13px}.dc-publish-slot-tools strong,.dc-publish-slot-tools span{display:block}.dc-publish-slot-tools strong{font-size:11px}.dc-publish-slot-tools span{margin-top:3px;color:var(--dc-subtle);font-size:8px}.dc-publish-slot-tools .sched-range{display:flex;gap:4px;padding:4px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(0,0,0,.23)}.dc-publish-slot-tools .sched-range button{min-height:29px;padding:0 11px;border-radius:8px;color:var(--dc-muted);font-size:8px;font-weight:750}.dc-publish-slot-tools .sched-range button.on{background:rgba(217,180,120,.13);color:var(--dc-accent2);box-shadow:inset 0 0 0 1px rgba(217,180,120,.14)}.dc-publish-slot-wrap .schedule-board{border-radius:18px!important;box-shadow:none!important}.dc-publish-slot-wrap .slot-media svg{width:23px;height:23px}.dc-publish-slot-wrap .slot-open-icon{font-size:23px;color:var(--dc-accent2)}
.dc-publish-columns{display:grid;grid-template-columns:minmax(260px,1.35fr) minmax(130px,.62fr) minmax(130px,.55fr) minmax(250px,.95fr);gap:14px;padding:11px 18px;border-bottom:1px solid rgba(255,255,255,.055);color:var(--dc-subtle);font-size:8px;font-weight:800;letter-spacing:.09em;text-transform:uppercase}
.dc-publish-list{display:grid}.dc-publish-row{display:grid;grid-template-columns:minmax(260px,1.35fr) minmax(130px,.62fr) minmax(130px,.55fr) minmax(250px,.95fr);gap:14px;align-items:center;min-height:112px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.06);transition:background .2s ease}.dc-publish-row:hover{background:rgba(255,255,255,.025)}.dc-publish-row:last-child{border-bottom:0}
.dc-publish-clip{display:grid;grid-template-columns:78px minmax(0,1fr);gap:12px;align-items:center}.dc-publish-thumb{position:relative;width:78px;height:78px;overflow:hidden;border-radius:13px;background:#08080a;border:1px solid rgba(255,255,255,.08)}.dc-publish-thumb img{width:100%;height:100%;object-fit:cover}.dc-publish-thumb>span{position:absolute;right:5px;bottom:5px;min-height:18px;padding:0 5px;display:grid;place-items:center;border-radius:6px;background:rgba(0,0,0,.76);font-size:7px;color:#fff}.dc-publish-thumb.empty{display:grid;place-items:center;color:var(--dc-accent)}.dc-publish-thumb.empty svg{width:24px;height:24px}
.dc-publish-copy strong,.dc-publish-copy span{display:block}.dc-publish-copy strong{font-size:11px;line-height:1.35}.dc-publish-copy span{margin-top:5px;color:var(--dc-subtle);font-size:8.5px}.dc-publish-when{display:flex;gap:8px;align-items:flex-start}.dc-publish-when>span{width:27px;height:27px;display:grid;place-items:center;flex:0 0 27px;border-radius:9px;background:rgba(217,180,120,.08);color:var(--dc-accent2)}.dc-publish-when svg{width:14px;height:14px}.dc-publish-when b,.dc-publish-when em{display:block}.dc-publish-when b{font-size:9.5px}.dc-publish-when em{margin-top:3px;color:var(--dc-subtle);font-size:8px;font-style:normal}
.dc-publish-brands{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.dc-publish-brand{width:29px;height:29px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:#19191d;color:#84848e}.dc-publish-brand svg{width:15px;height:15px}.dc-publish-brand.youtube.on{color:#ff4c55;background:rgba(255,76,85,.08)}.dc-publish-brand.tiktok.on{color:#fff}.dc-publish-brand.instagram.on{color:#f578c5;background:rgba(245,120,197,.08)}.dc-publish-brand.facebook.on{color:#6c9cff;background:rgba(108,156,255,.08)}.dc-publish-brand-more{font-size:8px;color:var(--dc-muted)}
.dc-publish-actions{display:flex;justify-content:flex-end;align-items:center;gap:7px}.dc-publish-actions .dc-btn{min-height:35px;padding:0 11px;font-size:9px}.dc-publish-actions .dc-btn.primary{min-width:86px}.dc-publish-more{width:34px;height:34px;display:grid;place-items:center;color:var(--dc-muted);border-radius:9px}.dc-publish-more:hover{background:rgba(255,255,255,.05);color:var(--dc-text)}
.dc-publish-empty{min-height:330px;display:grid;place-items:center;padding:34px;text-align:center}.dc-publish-empty>div{max-width:350px}.dc-publish-empty .dc-empty-icon{margin:0 auto 14px}.dc-publish-empty strong{display:block;font-size:15px}.dc-publish-empty p{margin:7px 0 16px;color:var(--dc-muted);font-size:10px;line-height:1.5}
.dc-publish-board-foot{display:flex;align-items:center;justify-content:center;gap:10px;padding:13px;border-top:1px solid rgba(255,255,255,.065);color:var(--dc-muted);font-size:9px}.dc-publish-board-foot button{color:var(--dc-accent2);font-weight:750}.dc-publish-board-foot svg{width:14px;height:14px}
.dc-publish-side{display:grid;gap:14px}.dc-publish-side-card{padding:15px}.dc-publish-side-head{display:flex;align-items:center;gap:9px;margin-bottom:13px}.dc-publish-side-head>span{width:31px;height:31px;display:grid;place-items:center;border-radius:10px;background:rgba(217,180,120,.09);color:var(--dc-accent2)}.dc-publish-side-head svg{width:16px;height:16px}.dc-publish-side-head strong,.dc-publish-side-head small{display:block}.dc-publish-side-head strong{font-size:11px}.dc-publish-side-head small{margin-top:2px;color:var(--dc-subtle);font-size:8px}
.dc-publish-connection-list{display:grid;gap:6px}.dc-publish-connection{display:grid;grid-template-columns:31px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border:1px solid rgba(255,255,255,.06);border-radius:12px;background:rgba(0,0,0,.18)}.dc-publish-connection .dc-publish-brand{width:31px;height:31px}.dc-publish-connection strong,.dc-publish-connection small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-publish-connection strong{font-size:9px}.dc-publish-connection small{margin-top:2px;color:var(--dc-subtle);font-size:7.5px}.dc-publish-connection .dc-pill{min-height:20px;padding:0 7px;font-size:7px}
.dc-publish-connect{width:100%;margin-top:9px}.dc-publish-previews{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-publish-preview{position:relative;aspect-ratio:9/14;overflow:hidden;border-radius:13px;background:#08080a;border:1px solid rgba(255,255,255,.08)}.dc-publish-preview img{width:100%;height:100%;object-fit:cover;transition:transform .35s ease}.dc-publish-preview:hover img{transform:scale(1.04)}.dc-publish-preview span{position:absolute;left:7px;right:7px;bottom:7px;padding:6px;border-radius:8px;background:rgba(0,0,0,.72);color:#fff;font-size:7px;line-height:1.3}.dc-publish-preview.empty{display:grid;place-items:center;color:var(--dc-subtle)}
@media(max-width:1220px){.dc-publish-layout{grid-template-columns:1fr}.dc-publish-side{grid-template-columns:1fr 1fr}.dc-publish-columns,.dc-publish-row{grid-template-columns:minmax(240px,1.25fr) minmax(120px,.62fr) minmax(120px,.5fr) minmax(230px,.9fr)}}
@media(max-width:900px){.dc-publish-hero{align-items:flex-start;flex-direction:column}.dc-publish-summary{justify-content:flex-start}.dc-publish-columns{display:none}.dc-publish-row{grid-template-columns:minmax(0,1fr) auto}.dc-publish-when,.dc-publish-brands{grid-column:1}.dc-publish-actions{grid-column:2;grid-row:1/4;flex-direction:column;align-items:stretch}.dc-publish-side{grid-template-columns:1fr 1fr}}
@media(max-width:620px){.dc-publish-hero{padding:21px}.dc-publish-tabs{padding:0;overflow:auto}.dc-publish-tab{padding:0 12px}.dc-publish-row{grid-template-columns:1fr;padding:14px}.dc-publish-actions{grid-column:1;grid-row:auto;flex-direction:row;justify-content:flex-start;flex-wrap:wrap}.dc-publish-side{grid-template-columns:1fr}.dc-publish-summary span{min-width:72px}.dc-publish-board-foot{flex-wrap:wrap;text-align:center}.dc-publish-slot-tools{align-items:flex-start;flex-direction:column}.dc-publish-slot-tools .sched-range{width:100%}.dc-publish-slot-tools .sched-range button{flex:1}.dc-publish-slot-wrap{padding:10px}}
`;

const premiumStudioCss = String.raw`
/* DeenClipped visual system: restrained colour, clearer hierarchy, real icon language. */
:root{--dc-blue:#65a9ff;--dc-purple:#ad8cff;--dc-pink:#f17ab8;--dc-teal:#5ed6c5;--dc-green:#63d89a;--dc-orange:#efb45f;--dc-gold:#dfb86f}
body.dc-app{background:radial-gradient(circle at 76% -10%,rgba(76,101,170,.08),transparent 35%),radial-gradient(circle at 12% 110%,rgba(217,180,120,.07),transparent 34%),#070709!important}
#dcSidebar{background:linear-gradient(180deg,rgba(14,14,17,.98),rgba(8,8,11,.99));box-shadow:20px 0 70px rgba(0,0,0,.18)}
.dc-logo{background:radial-gradient(circle at 35% 20%,rgba(255,229,174,.18),transparent 45%),rgba(217,180,120,.08);box-shadow:0 0 26px rgba(217,180,120,.08),inset 0 0 0 1px rgba(255,255,255,.025)}
.dc-nav-button{position:relative;border:1px solid transparent}.dc-nav-button .dc-nav-icon{border-radius:8px;transition:color .2s ease,background .2s ease,box-shadow .2s ease}.dc-nav-button .dc-nav-icon svg{width:18px;height:18px}
.dc-nav-button[data-dc-nav="home"] .dc-nav-icon,.dc-nav-button[data-dc-nav="projects"] .dc-nav-icon{color:var(--dc-gold)}
.dc-nav-button[data-dc-nav="review"] .dc-nav-icon{color:var(--dc-orange)}.dc-nav-button[data-dc-nav="schedule"] .dc-nav-icon{color:var(--dc-green)}.dc-nav-button[data-dc-nav="publishing"] .dc-nav-icon{color:var(--dc-purple)}
.dc-nav-button[data-dc-nav="templates"] .dc-nav-icon{color:var(--dc-pink)}.dc-nav-button[data-dc-nav="music"] .dc-nav-icon{color:var(--dc-teal)}.dc-nav-button[data-dc-nav="insights"] .dc-nav-icon{color:var(--dc-blue)}.dc-nav-button[data-dc-nav="automation"] .dc-nav-icon{color:#9ca8bd}
.dc-nav-button.is-active{border-color:rgba(255,255,255,.055);background:linear-gradient(90deg,rgba(217,180,120,.13),rgba(255,255,255,.025))}.dc-nav-button.is-active .dc-nav-icon{background:rgba(255,255,255,.05);box-shadow:0 0 22px currentColor}
.dc-btn:not(.secondary):not(.danger){background:linear-gradient(135deg,#f0cb83,#d9ab5e);box-shadow:0 10px 28px rgba(217,180,120,.13),inset 0 1px rgba(255,255,255,.35)}.dc-btn:not(.secondary):not(.danger):hover:not(:disabled){background:linear-gradient(135deg,#f8dda8,#e2b96f);transform:translateY(-1px)}
.dc-pill.good{background:rgba(99,216,154,.1);color:var(--dc-green);border:1px solid rgba(99,216,154,.12)}.dc-pill.warn{background:rgba(239,180,95,.1);color:var(--dc-orange);border:1px solid rgba(239,180,95,.12)}.dc-pill.bad{border:1px solid rgba(239,107,122,.13)}
.dc-social-logo.youtube,.dc-manage-logo.youtube{color:#ff4c55!important;background:rgba(255,76,85,.09)!important}.dc-social-logo.tiktok,.dc-manage-logo.tiktok{color:#fff!important;background:linear-gradient(135deg,rgba(37,244,238,.12),rgba(254,44,85,.12))!important}.dc-social-logo.instagram,.dc-manage-logo.instagram{color:#f17ab8!important;background:linear-gradient(145deg,rgba(157,78,221,.14),rgba(255,112,67,.11))!important}.dc-social-logo.facebook,.dc-manage-logo.facebook{color:#6c9cff!important;background:rgba(108,156,255,.1)!important}
.dc-manage-card,.dc-template-card,.dc-settings-panel,.dc-insight-panel,.dc-project-card{background:radial-gradient(circle at 100% 0,rgba(255,255,255,.028),transparent 33%),linear-gradient(150deg,#16161a,#0d0d10)!important}

/* Source-first Projects library. */
.dc-library-page{display:grid;gap:14px}.dc-library-hero{position:relative;overflow:hidden;display:flex;align-items:flex-end;justify-content:space-between;gap:24px;padding:27px 29px;border:1px solid rgba(217,180,120,.19);border-radius:27px;background:radial-gradient(circle at 7% 0,rgba(217,180,120,.17),transparent 36%),radial-gradient(circle at 91% 12%,rgba(101,169,255,.1),transparent 31%),linear-gradient(145deg,#16161a,#0c0c0f);box-shadow:0 28px 75px rgba(0,0,0,.23)}
.dc-library-hero:after{content:'';position:absolute;right:7%;top:-155px;width:330px;height:330px;border-radius:50%;border:1px solid rgba(101,169,255,.09);box-shadow:0 0 100px rgba(101,169,255,.06);pointer-events:none}.dc-library-hero-copy{position:relative;z-index:1}.dc-library-kicker{display:inline-flex;align-items:center;gap:8px;color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.dc-library-kicker svg{width:16px;height:16px}.dc-library-hero h1{max-width:760px;margin:9px 0 7px;font-size:clamp(30px,3.4vw,45px);line-height:1;letter-spacing:-.052em}.dc-library-hero p{max-width:660px;margin:0;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-library-hero>.dc-btn{position:relative;z-index:1}
.dc-library-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px}.dc-library-metrics>div{display:grid;grid-template-columns:37px auto;grid-template-rows:auto auto;column-gap:10px;align-items:center;padding:12px 14px;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-library-metrics>div>span{grid-row:1/3;width:37px;height:37px;display:grid;place-items:center;border-radius:12px}.dc-library-metrics svg{width:18px;height:18px}.dc-library-metrics strong{font-size:17px}.dc-library-metrics small{color:var(--dc-subtle);font-size:8px}.dc-library-metrics .gold,.dc-library-side-head .gold{color:var(--dc-gold);background:rgba(223,184,111,.1)}.dc-library-metrics .purple,.dc-library-side-head .purple{color:var(--dc-purple);background:rgba(173,140,255,.1)}.dc-library-metrics .blue,.dc-library-side-head .blue{color:var(--dc-blue);background:rgba(101,169,255,.1)}.dc-library-metrics .orange,.dc-library-side-head .orange{color:var(--dc-orange);background:rgba(239,180,95,.1)}.dc-library-metrics .green,.dc-library-side-head .green{color:var(--dc-green);background:rgba(99,216,154,.1)}
.dc-library-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 180px 160px;gap:8px}.dc-library-toolbar input,.dc-library-toolbar select{width:100%;height:42px;min-height:42px;border:1px solid rgba(255,255,255,.075);border-radius:12px;background:#101014;color:var(--dc-text)}.dc-library-search{position:relative}.dc-library-search>svg{position:absolute;left:13px;top:13px;width:16px;height:16px;fill:none;stroke:var(--dc-subtle);stroke-width:1.8;z-index:1}.dc-library-search input{padding-left:39px}
.dc-library-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:14px;align-items:start}.dc-library-projects,.dc-library-side-card{overflow:hidden;border:1px solid rgba(255,255,255,.075);border-radius:22px;background:linear-gradient(180deg,#141417,#0d0d10);box-shadow:0 22px 56px rgba(0,0,0,.17)}.dc-library-section-head{min-height:60px;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:13px 17px;border-bottom:1px solid rgba(255,255,255,.065)}.dc-library-section-head h2,.dc-library-section-head p{margin:0}.dc-library-section-head h2{font-size:13px}.dc-library-section-head p{margin-top:3px;color:var(--dc-subtle);font-size:8px}
.dc-library-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 44px;border-bottom:1px solid rgba(255,255,255,.055);transition:background .2s ease}.dc-library-row:last-child{border-bottom:0}.dc-library-row:hover{background:rgba(255,255,255,.025)}.dc-library-row-main{display:grid;grid-template-columns:82px minmax(0,1fr) minmax(105px,auto) 18px;gap:13px;align-items:center;min-height:94px;padding:13px 5px 13px 17px;text-align:left;color:var(--dc-text)}.dc-library-row-main>svg{width:16px;height:16px;color:var(--dc-subtle)}.dc-library-row-thumb{width:82px;height:64px;overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#09090b}.dc-library-row-thumb img{width:100%;height:100%;object-fit:cover}.dc-library-row-thumb.empty{display:grid;place-items:center;color:var(--dc-gold);background:radial-gradient(circle at 50% 20%,rgba(217,180,120,.16),transparent 50%),#0c0c0f}.dc-library-row-thumb.empty svg{width:24px;height:24px}.dc-library-row-copy strong,.dc-library-row-copy em{display:block}.dc-library-row-copy strong{font-size:11px;line-height:1.35}.dc-library-row-copy em{margin-top:4px;color:var(--dc-subtle);font-size:8px;font-style:normal}.dc-library-progress{display:block;height:3px;margin-top:9px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden}.dc-library-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--dc-gold),var(--dc-blue))}.dc-library-row-state{display:flex;align-items:center;justify-content:flex-start;gap:7px;color:var(--dc-muted);font-size:8px;white-space:nowrap}.dc-library-row-state i{width:7px;height:7px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 12px currentColor}.dc-library-row-state.blue{color:var(--dc-blue)}.dc-library-row-state.blue i{background:var(--dc-blue)}.dc-library-row-state.orange{color:var(--dc-orange)}.dc-library-row-state.orange i{background:var(--dc-orange)}.dc-library-row-state.bad{color:var(--dc-red)}.dc-library-row-state.bad i{background:var(--dc-red)}
.dc-library-row-menu{position:relative;display:grid;place-items:center}.dc-library-row-menu summary{width:34px;height:34px;display:grid;place-items:center;border-radius:9px;color:var(--dc-muted);cursor:pointer;list-style:none}.dc-library-row-menu summary::-webkit-details-marker{display:none}.dc-library-row-menu summary:hover{background:rgba(255,255,255,.05);color:var(--dc-text)}.dc-library-row-menu>div{position:absolute;z-index:30;right:8px;top:64px;width:170px;padding:6px;border:1px solid var(--dc-line2);border-radius:11px;background:#18181c;box-shadow:0 20px 50px #000}.dc-library-row-menu>div button{width:100%;padding:9px;border-radius:7px;color:var(--dc-text);font-size:9px;text-align:left}.dc-library-row-menu>div button:hover{background:rgba(255,255,255,.05)}.dc-library-row-menu>div button.danger{color:var(--dc-red)}
.dc-library-side{display:grid;gap:12px}.dc-library-side-card{padding:14px}.dc-library-side-head{display:flex;align-items:center;gap:9px;margin-bottom:11px}.dc-library-side-head>span{width:34px;height:34px;display:grid;place-items:center;border-radius:11px}.dc-library-side-head svg{width:17px;height:17px}.dc-library-side-head strong,.dc-library-side-head small{display:block}.dc-library-side-head strong{font-size:10px}.dc-library-side-head small{margin-top:2px;color:var(--dc-subtle);font-size:7.5px}.dc-library-side-card>.wide{width:100%;margin-top:9px}
.dc-library-flow{display:grid;gap:5px}.dc-library-flow button{display:grid;grid-template-columns:7px minmax(0,1fr) auto;gap:8px;align-items:center;padding:8px;border-radius:9px;color:var(--dc-muted);font-size:8.5px;text-align:left}.dc-library-flow button:hover{background:rgba(255,255,255,.035)}.dc-library-flow i{width:7px;height:7px;border-radius:50%}.dc-library-flow i.blue{background:var(--dc-blue)}.dc-library-flow i.orange{background:var(--dc-orange)}.dc-library-flow i.green{background:var(--dc-green)}.dc-library-flow b{color:var(--dc-text)}
.dc-library-platforms{display:grid;gap:5px}.dc-library-platforms>div{display:grid;grid-template-columns:26px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px}.dc-library-platforms .dc-publish-brand{width:26px;height:26px}.dc-library-platforms b{font-size:8.5px}.dc-library-platforms em{color:var(--dc-subtle);font-size:7px;font-style:normal}.dc-library-platforms em.on{color:var(--dc-green)}.dc-library-recent{display:grid;gap:5px}.dc-library-recent>button{display:grid;grid-template-columns:40px minmax(0,1fr) auto;gap:8px;align-items:center;padding:6px;border-radius:9px;text-align:left;color:var(--dc-text)}.dc-library-recent>button:hover{background:rgba(255,255,255,.035)}.dc-library-recent img,.dc-library-recent>button>span{width:40px;height:31px;object-fit:cover;border-radius:7px;background:#09090b;display:grid;place-items:center}.dc-library-recent svg{width:14px;height:14px}.dc-library-recent strong{font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-library-recent em{color:var(--dc-subtle);font-size:7px;font-style:normal}

/* Editor now reads as a creative suite rather than a flat form. */
body.dc-app .dc-editor-page{filter:drop-shadow(0 24px 70px rgba(0,0,0,.22))}.dc-editor-header{position:relative!important;border-color:rgba(217,180,120,.19)!important;background:radial-gradient(circle at 70% -180%,rgba(217,180,120,.16),transparent 48%),linear-gradient(180deg,#19191d,#111114)!important}.dc-editor-header:after{content:'';position:absolute;left:0;right:0;bottom:0;height:1px;background:linear-gradient(90deg,transparent,var(--dc-gold),var(--dc-purple),transparent);opacity:.45}.dc-editor-workspace{border-color:rgba(255,255,255,.09)!important;background:#08080b!important;box-shadow:inset 0 1px rgba(255,255,255,.025)}
.dc-tool-rail{background:linear-gradient(180deg,#111116,#0a0a0d)!important}.dc-tool-button{min-height:58px!important;border:1px solid transparent!important}.dc-tool-button .dc-tool-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:rgba(255,255,255,.035)}.dc-tool-button .dc-tool-icon svg{width:17px;height:17px}.dc-tool-button[data-editor-tool="captions"]{color:var(--dc-purple)}.dc-tool-button[data-editor-tool="canvas"]{color:var(--dc-blue)}.dc-tool-button[data-editor-tool="style"]{color:var(--dc-pink)}.dc-tool-button[data-editor-tool="audio"]{color:var(--dc-teal)}.dc-tool-button[data-editor-tool="details"]{color:var(--dc-orange)}.dc-tool-button.on{border-color:rgba(255,255,255,.07)!important;background:linear-gradient(145deg,rgba(255,255,255,.075),rgba(255,255,255,.025))!important;box-shadow:inset 3px 0 currentColor}.dc-tool-button.on .dc-tool-icon{background:color-mix(in srgb,currentColor 15%,transparent);box-shadow:0 0 24px color-mix(in srgb,currentColor 15%,transparent)}
.dc-tool-panel{background:radial-gradient(circle at 0 0,rgba(173,140,255,.045),transparent 30%),linear-gradient(180deg,#151519,#0e0e11)!important}.dc-tool-head{background:rgba(255,255,255,.012)}.dc-tool-content::-webkit-scrollbar{width:7px}.dc-tool-content::-webkit-scrollbar-thumb{background:#34343c;border-radius:99px}.dc-subtabs{border-radius:11px!important}.dc-subtabs button.on{background:linear-gradient(145deg,#2a2a31,#1d1d22)!important;box-shadow:0 5px 16px rgba(0,0,0,.2)}.dc-style-card{border-radius:11px!important;background:linear-gradient(145deg,#121216,#0b0b0e)!important}.dc-style-card:hover,.dc-style-card.on{box-shadow:0 12px 28px rgba(0,0,0,.24)}
.dc-canvas-area{background:#08080b!important}.dc-canvas-toolbar{background:linear-gradient(180deg,#111115,#0d0d10)!important}.dc-canvas-wrap{background-image:radial-gradient(circle at 50% 45%,rgba(101,169,255,.07),transparent 38%),linear-gradient(rgba(255,255,255,.018) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.018) 1px,transparent 1px)!important;background-size:auto,24px 24px,24px 24px!important;background-position:center,center,center!important}.dc-video-canvas{border:1px solid rgba(255,255,255,.11);box-shadow:0 30px 90px #000,0 0 0 1px rgba(217,180,120,.07),0 0 55px rgba(101,169,255,.05)!important}.dc-layer-switch,.dc-safe-toggle{border-radius:9px!important}.dc-layer-switch button.on,.dc-safe-toggle.on{background:rgba(101,169,255,.11)!important;color:#b9d8ff!important;border-color:rgba(101,169,255,.2)!important}.dc-caption-status{background:rgba(8,8,11,.82)!important;border:1px solid rgba(173,140,255,.18);color:#d8caff!important;backdrop-filter:blur(8px)}
.dc-timeline{background:linear-gradient(180deg,#141418,#0e0e11)!important}.dc-timeline-scroll{border-radius:10px!important}.dc-video-block{background:linear-gradient(90deg,#285c87,#3f82b5)!important}.dc-caption-block{background:linear-gradient(90deg,#5d4380,#8560a8)!important}.dc-caption-block.active{background:linear-gradient(90deg,#8462ab,#b084dc)!important}.dc-audio-block{background:linear-gradient(90deg,#365d4a,#52866a)!important}.dc-playhead{box-shadow:0 0 14px rgba(217,180,120,.45)}
@media(max-width:1180px){.dc-library-layout{grid-template-columns:1fr}.dc-library-side{grid-template-columns:repeat(3,minmax(0,1fr))}.dc-library-metrics{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:760px){.dc-library-hero{align-items:flex-start;flex-direction:column;padding:21px}.dc-library-metrics{grid-template-columns:1fr 1fr}.dc-library-toolbar{grid-template-columns:1fr}.dc-library-side{grid-template-columns:1fr}.dc-library-row-main{grid-template-columns:66px minmax(0,1fr) 16px}.dc-library-row-thumb{width:66px;height:54px}.dc-library-row-state{grid-column:2}.dc-library-row-main>svg{grid-column:3;grid-row:1}.dc-library-section-head>.dc-pill{display:none}}
`;


const topbarCleanCss = String.raw`
/* Phase billing topbar cleanup */
body.dc-app #dcTopbar{gap:12px;padding:0 18px;background:rgba(10,10,12,.96)}
body.dc-app .dc-page-title{min-width:150px;max-width:210px}
body.dc-app .dc-page-title strong{font-size:13px}
body.dc-app .dc-page-title span{max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.dc-app .dc-global-search{max-width:560px}
body.dc-app .dc-top-actions{gap:7px;align-items:center;flex-shrink:0}
body.dc-app .dc-health{height:34px;padding:0 8px;border-radius:999px;background:transparent;color:var(--dc-muted)}
body.dc-app .dc-health span{font-size:9px}
body.dc-app .dc-token-pill{min-height:34px;display:inline-flex;align-items:center;gap:6px;padding:0 10px;border:1px solid rgba(217,180,120,.28);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:10px;font-weight:750;white-space:nowrap;box-shadow:0 0 0 1px rgba(217,180,120,.03) inset}
body.dc-app .dc-token-pill:hover{background:rgba(217,180,120,.12);border-color:rgba(217,180,120,.45)}
body.dc-app .dc-token-pill svg{width:15px;height:15px;flex:0 0 15px}
body.dc-app .dc-token-pill .dc-token-label{display:none}
body.dc-app .dc-token-pill .dc-token-main{font-size:10px;font-weight:850;color:var(--dc-text)}
body.dc-app .dc-token-pill .dc-token-rate{font-size:8px;color:var(--dc-muted);font-style:normal;font-weight:700;padding-left:2px}
body.dc-app .dc-tour-launch{min-height:34px!important;padding:0 12px!important;border-radius:999px!important;font-size:10px!important}
body.dc-app #dcNewProject{min-height:36px!important;border-radius:11px!important;padding:0 13px!important;font-size:10px!important}
.dc-user-menu-wrap{position:relative;display:flex;align-items:center}
.dc-user-menu-button{height:36px;max-width:180px;display:inline-flex;align-items:center;gap:8px;padding:0 10px 0 7px;border:1px solid var(--dc-line);border-radius:999px;background:rgba(255,255,255,.025);color:var(--dc-text);white-space:nowrap}
.dc-user-menu-button:hover{background:var(--dc-panel2);border-color:var(--dc-line2)}
.dc-user-menu-button img,.dc-user-avatar{width:24px;height:24px;flex:0 0 24px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:rgba(217,180,120,.16);color:var(--dc-accent2);font-size:10px;font-weight:850}
.dc-user-copy{min-width:0;display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
.dc-user-copy b,.dc-user-copy small{display:block;max-width:118px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-user-copy b{font-size:9.5px;font-weight:750;color:var(--dc-text)}
.dc-user-copy small{font-size:7.5px;color:var(--dc-subtle);margin-top:2px}
.dc-user-chevron{width:12px;height:12px;color:var(--dc-subtle);flex:0 0 12px}
.dc-account-menu{display:none;position:absolute;right:0;top:calc(100% + 9px);width:250px;padding:9px;border:1px solid var(--dc-line2);border-radius:14px;background:rgba(16,16,18,.98);box-shadow:var(--dc-shadow);z-index:240;backdrop-filter:blur(18px)}
.dc-account-menu.show{display:block;animation:dcViewReveal .16s ease both}
.dc-account-head{padding:9px 10px 10px;border-bottom:1px solid var(--dc-line);margin-bottom:7px}
.dc-account-head strong,.dc-account-head span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-account-head strong{font-size:11px;color:var(--dc-text)}
.dc-account-head span{font-size:8.5px;color:var(--dc-muted);margin-top:3px}
.dc-account-action{width:100%;min-height:36px;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 10px;border-radius:9px;color:var(--dc-muted);font-size:10px;text-align:left;background:transparent;border:0}
.dc-account-action:hover{background:var(--dc-panel2);color:var(--dc-text)}
.dc-account-action b{font-size:9px;color:var(--dc-accent2);font-weight:800}
.dc-account-menu form{margin:3px 0 0}
.dc-logout-btn{width:100%;min-height:36px;border-radius:9px;color:var(--dc-red);font-size:10px;text-align:left;padding:0 10px;background:transparent;border:0}
.dc-logout-btn:hover{background:rgba(239,107,122,.08)}
body.dc-app .dc-logout-form:not(.dc-account-menu .dc-logout-form){display:none}
@media(max-width:1160px){body.dc-app .dc-page-title{min-width:125px}.dc-user-copy small,.dc-token-pill .dc-token-rate{display:none}.dc-user-menu-button{max-width:132px}.dc-user-copy b{max-width:82px}}
@media(max-width:920px){body.dc-app .dc-health span,body.dc-app .dc-tour-launch{display:none}body.dc-app .dc-token-pill{padding:0 9px}.dc-user-menu-button{padding-right:7px}.dc-user-copy{display:none}}
@media(max-width:720px){body.dc-app .dc-token-pill .dc-token-main{display:none}.dc-account-menu{right:-62px}}
`;


const trialUxCss = String.raw`
/* Trial, token confirmation and billing notices */
body.dc-app .dc-token-pill.trial{background:rgba(83,199,139,.08);border-color:rgba(83,199,139,.34);color:var(--dc-green)}
body.dc-app .dc-token-pill.warn{background:rgba(229,169,87,.09);border-color:rgba(229,169,87,.34);color:var(--dc-orange)}
.dc-token-trial-dot{width:7px;height:7px;border-radius:50%;background:currentColor;box-shadow:0 0 0 4px color-mix(in srgb,currentColor 16%,transparent)}
.dc-charge-layer,.dc-billing-notice-layer{position:fixed;inset:0;z-index:520;display:grid;place-items:center;padding:20px;background:rgba(0,0,0,.50);backdrop-filter:blur(16px)}
.dc-charge-card,.dc-billing-notice-card{width:min(620px,calc(100vw - 32px));border:1px solid rgba(255,255,255,.11);border-radius:22px;background:linear-gradient(180deg,rgba(19,19,22,.98),rgba(9,9,12,.98));box-shadow:0 28px 90px rgba(0,0,0,.58),0 0 0 1px rgba(217,180,120,.05) inset;overflow:hidden}
.dc-charge-card{max-height:calc(100dvh - 34px);overflow-y:auto;overflow-x:hidden;scrollbar-width:none}.dc-charge-card::-webkit-scrollbar{width:0;height:0}
.dc-charge-head,.dc-billing-notice-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;padding:22px 22px 16px;border-bottom:1px solid rgba(255,255,255,.07)}
.dc-charge-head span,.dc-billing-notice-head span{display:inline-flex;align-items:center;gap:8px;color:var(--dc-accent2);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.dc-charge-head h2,.dc-billing-notice-head h2{margin:9px 0 0;font-size:25px;line-height:1.06;letter-spacing:-.04em}.dc-charge-head p,.dc-billing-notice-head p{margin:8px 0 0;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-charge-close,.dc-notice-close{width:36px;height:36px;border-radius:50%;border:1px solid rgba(255,255,255,.10);background:#0b0b0d;color:var(--dc-muted);font-size:19px}.dc-charge-close:hover,.dc-notice-close:hover{color:var(--dc-text);border-color:rgba(255,255,255,.18)}
.dc-charge-body{padding:18px 22px 22px}.dc-charge-summary{display:flex;align-items:center;gap:12px;padding:12px 13px;margin-bottom:12px;border:1px solid rgba(217,180,120,.18);border-radius:16px;background:linear-gradient(135deg,rgba(217,180,120,.10),rgba(255,255,255,.025))}.dc-charge-summary i{width:11px;height:11px;flex:0 0 11px;border-radius:999px;background:var(--dc-accent);box-shadow:0 0 0 5px rgba(217,180,120,.08)}.dc-charge-summary strong,.dc-charge-summary span{display:block}.dc-charge-summary strong{font-size:12px}.dc-charge-summary span{font-size:10px;color:var(--dc-muted);margin-top:2px}.dc-charge-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:10px;margin-bottom:10px}.dc-charge-tile{padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(255,255,255,.032)}.dc-charge-tile strong,.dc-charge-tile span{display:block}.dc-charge-tile strong{font-size:25px;letter-spacing:-.045em}.dc-charge-tile span{font-size:10px;color:var(--dc-muted);margin-top:4px}.dc-charge-estimate{display:grid;grid-template-columns:minmax(0,1fr) 146px;gap:10px;align-items:stretch;padding:12px;border:1px solid rgba(217,180,120,.22);border-radius:17px;background:rgba(217,180,120,.055);margin-bottom:12px}.dc-charge-estimate label{display:block;font-size:10px;color:var(--dc-muted)}.dc-charge-estimate input{width:100%;height:44px;margin-top:7px;padding:0 12px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:#0b0b0d;color:var(--dc-text);font-size:18px;font-weight:850}.dc-charge-cost{display:flex;flex-direction:column;justify-content:center;align-items:flex-start;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:13px;background:rgba(0,0,0,.22)}.dc-charge-estimate b{display:block;font-size:30px;line-height:.95;letter-spacing:-.055em;color:var(--dc-accent2)}.dc-charge-estimate small{display:block;color:var(--dc-muted);font-size:9px;margin-top:6px;line-height:1.35}.dc-charge-steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.dc-charge-step{display:flex;gap:8px;align-items:flex-start;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:rgba(255,255,255,.025)}.dc-charge-step b{width:21px;height:21px;flex:0 0 21px;border-radius:50%;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2);font-size:10px}.dc-charge-step strong,.dc-charge-step span{display:block}.dc-charge-step strong{font-size:10px}.dc-charge-step span{font-size:8.6px;color:var(--dc-muted);margin-top:2px;line-height:1.35}.dc-charge-terms{display:grid;gap:8px;margin:14px 0}.dc-charge-terms span{display:flex;align-items:center;gap:9px;color:var(--dc-muted);font-size:10px;line-height:1.35}.dc-charge-terms span::before{content:'✓';width:18px;height:18px;flex:0 0 18px;display:grid;place-items:center;border-radius:50%;background:rgba(83,199,139,.10);color:var(--dc-green);font-weight:900}.dc-charge-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:10px;margin-top:14px}.dc-charge-actions .dc-btn{min-height:44px;border-radius:999px}.dc-charge-actions .dc-btn:first-child{min-width:0}.dc-charge-muted{grid-column:1/-1;min-height:20px;padding:8px 10px;border-radius:12px;background:rgba(255,255,255,.025);color:var(--dc-muted);font-size:10px;line-height:1.35}.dc-charge-muted.warn{background:rgba(229,169,87,.09);color:var(--dc-orange);border:1px solid rgba(229,169,87,.20)}.dc-billing-notice-body{padding:20px 24px 24px}.dc-billing-notice-actions{display:flex;gap:10px;align-items:center;justify-content:flex-end;margin-top:18px}.dc-billing-notice-actions .dc-btn{border-radius:999px;min-height:42px}.dc-token-toast{position:fixed;right:22px;bottom:92px;z-index:515;max-width:360px;padding:14px 16px;border:1px solid rgba(217,180,120,.25);border-radius:18px;background:rgba(16,16,19,.88);box-shadow:0 18px 60px rgba(0,0,0,.42),0 0 28px rgba(217,180,120,.13);backdrop-filter:blur(18px);animation:dcViewReveal .22s ease both}.dc-token-toast strong,.dc-token-toast span{display:block}.dc-token-toast strong{font-size:12px}.dc-token-toast span{font-size:10px;color:var(--dc-muted);margin-top:4px;line-height:1.4}.dc-token-toast.good{border-color:rgba(83,199,139,.25)}.dc-token-toast.warn{border-color:rgba(229,169,87,.30)}.dc-trial-mini{display:inline-flex;align-items:center;gap:5px;margin-left:2px;padding-left:6px;border-left:1px solid rgba(255,255,255,.10);font-size:8px;color:inherit;font-weight:850;font-style:normal}
.dc-youtube-consent-card .dc-charge-terms{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.dc-youtube-consent-card .dc-charge-terms span{min-height:62px;align-items:flex-start;padding:11px 12px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(255,255,255,.025);font-size:10px}.dc-youtube-consent-card .dc-charge-terms span::before{margin-top:1px}.dc-youtube-consent-card .dc-charge-muted a{color:var(--dc-accent2)}
.dc-billing-notice-card{width:min(500px,calc(100vw - 28px));border-radius:20px;background:radial-gradient(circle at 8% 0%,rgba(217,180,120,.10),transparent 32%),linear-gradient(180deg,#141416,#0a0a0c)}
.dc-billing-notice-card .dc-billing-notice-head{padding:24px 24px 18px}.dc-billing-notice-card .dc-billing-notice-head h2{font-size:27px;line-height:1.08;margin-top:10px}.dc-billing-notice-card .dc-billing-notice-head p{max-width:390px;font-size:12px;line-height:1.6;margin-top:9px}
.dc-billing-notice-card .dc-billing-notice-body{padding:18px 24px 24px}.dc-billing-notice-card .dc-charge-terms{display:grid;grid-template-columns:1fr;gap:0;margin:0;border:1px solid rgba(255,255,255,.075);border-radius:14px;background:rgba(255,255,255,.018);overflow:hidden}
.dc-billing-notice-card .dc-charge-terms span{min-height:45px;padding:10px 13px;border-bottom:1px solid rgba(255,255,255,.06);font-size:11px;line-height:1.4}.dc-billing-notice-card .dc-charge-terms span:last-child{border-bottom:0}.dc-billing-notice-card .dc-charge-terms span::before{width:20px;height:20px;flex-basis:20px}
.dc-billing-notice-card .dc-billing-notice-actions{display:grid;grid-template-columns:1fr 1.35fr;gap:10px;margin-top:16px}.dc-billing-notice-card .dc-billing-notice-actions .dc-btn{width:100%;min-height:44px;border-radius:12px}
.dc-notice-mark{width:7px;height:7px;border-radius:50%;background:var(--dc-accent);box-shadow:0 0 0 4px rgba(217,180,120,.10)}
@media(max-width:720px){.dc-charge-card{width:calc(100vw - 18px)}.dc-charge-grid,.dc-charge-estimate,.dc-charge-steps{grid-template-columns:1fr}.dc-charge-actions,.dc-billing-notice-actions{grid-template-columns:1fr;flex-direction:column;align-items:stretch}.dc-token-toast{left:12px;right:12px;bottom:84px;max-width:none}}
@media(max-width:620px){.dc-youtube-consent-card .dc-charge-terms{grid-template-columns:1fr}}


/* Source range selector v2: cleaner, homepage-matched, no ugly side scroll */
body.dc-app .dc-source-range-layer{padding:22px;overflow:hidden;background:rgba(0,0,0,.58);backdrop-filter:blur(18px)}
body.dc-app .dc-source-range-card{width:min(920px,calc(100vw - 44px));max-height:calc(100dvh - 44px);overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:28px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.16),transparent 32%),linear-gradient(180deg,rgba(20,20,23,.98),rgba(8,8,10,.98));box-shadow:0 34px 110px rgba(0,0,0,.62),0 0 0 1px rgba(217,180,120,.05) inset;color:var(--dc-text)}
body.dc-app .dc-source-range-head{display:flex;justify-content:space-between;align-items:flex-start;gap:18px;padding:28px 28px 18px;border-bottom:1px solid rgba(255,255,255,.08)}
body.dc-app .dc-source-range-head span{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid rgba(217,180,120,.28);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
body.dc-app .dc-source-range-head h2{margin:14px 0 0;font-size:34px;line-height:.98;letter-spacing:-.055em}
body.dc-app .dc-source-range-head p{max-width:690px;margin:10px 0 0;color:var(--dc-muted);font-size:12px;line-height:1.55}
body.dc-app .dc-source-range-body{padding:18px 28px 26px;display:grid;gap:13px;max-height:calc(100dvh - 190px);overflow:auto;scrollbar-width:none}
body.dc-app .dc-source-range-body::-webkit-scrollbar{width:0;height:0}
body.dc-app .dc-source-preview-card{display:grid;grid-template-columns:96px minmax(0,1fr) auto;gap:14px;align-items:center;padding:13px;border:1px solid rgba(217,180,120,.18);border-radius:20px;background:linear-gradient(135deg,rgba(217,180,120,.095),rgba(255,255,255,.025))}
body.dc-app .dc-source-thumb{width:96px;height:56px;border-radius:13px;background:#050507;display:grid;place-items:center;overflow:hidden;color:var(--dc-accent2)}
body.dc-app .dc-source-thumb.loading{background:linear-gradient(110deg,#151519,#25252b,#151519);background-size:220% 100%;animation:dcShimmer 1.1s linear infinite}
body.dc-app .dc-source-thumb img{width:100%;height:100%;object-fit:cover;display:block}
body.dc-app .dc-source-preview-copy small,body.dc-app .dc-source-preview-copy strong,body.dc-app .dc-source-preview-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.dc-app .dc-source-preview-copy small{color:var(--dc-accent2);font-size:8.5px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}
body.dc-app .dc-source-preview-copy strong{font-size:15px;margin-top:3px}.dc-source-preview-copy span{font-size:10px;color:var(--dc-muted);margin-top:3px}
body.dc-app .dc-source-duration{padding:8px 11px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(0,0,0,.22);font-size:12px;color:var(--dc-accent2)}

body.dc-app .dc-source-manual{display:grid;grid-template-columns:minmax(0,1fr) 140px;gap:12px;align-items:center;padding:12px 14px;border:1px solid rgba(229,169,87,.22);border-radius:18px;background:rgba(229,169,87,.065)}
body.dc-app .dc-source-manual[hidden]{display:none!important}
body.dc-app .dc-source-manual strong,body.dc-app .dc-source-manual span{display:block}.dc-source-manual strong{font-size:12px}.dc-source-manual span{margin-top:3px;color:var(--dc-muted);font-size:9.5px;line-height:1.4}
body.dc-app .dc-source-manual label{display:block;color:var(--dc-muted);font-size:8.5px}.dc-source-manual label span{margin:0 0 5px}.dc-source-manual input{width:100%;height:40px;padding:0 11px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:#0b0b0d;color:var(--dc-text);font-size:15px;font-weight:800}
body.dc-app .dc-processing-card{padding:18px;border:1px solid rgba(255,255,255,.09);border-radius:22px;background:rgba(255,255,255,.033)}
body.dc-app .dc-processing-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:18px}
body.dc-app .dc-processing-head strong,body.dc-app .dc-processing-head span{display:block}.dc-processing-head strong{font-size:16px}.dc-processing-head span{color:var(--dc-muted);font-size:10.5px;margin-top:4px}.dc-processing-head em{font-style:normal;color:var(--dc-muted);font-size:9px;font-weight:900;padding:7px 10px;border:1px solid rgba(255,255,255,.08);border-radius:999px;background:rgba(0,0,0,.2);white-space:nowrap}.dc-processing-head em.good{color:var(--dc-green);border-color:rgba(83,199,139,.24);background:rgba(83,199,139,.08)}
body.dc-app .dc-dual-range{position:relative;height:46px;margin:4px 0 14px}.dc-dual-track{position:absolute;left:0;right:0;top:21px;height:6px;border-radius:999px;background:rgba(255,255,255,.16);overflow:hidden}.dc-dual-track i{position:absolute;top:0;bottom:0;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2));box-shadow:0 0 20px rgba(217,180,120,.22)}
body.dc-app .dc-dual-range input[type=range]{position:absolute;left:0;right:0;top:0;width:100%;height:46px;background:transparent;pointer-events:none;appearance:none;-webkit-appearance:none}
body.dc-app .dc-dual-range input[type=range]::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:28px;height:28px;border-radius:50%;border:3px solid #f8f0df;background:#0b0b0d;box-shadow:0 4px 18px rgba(0,0,0,.55);pointer-events:auto;cursor:pointer}
body.dc-app .dc-dual-range input[type=range]::-moz-range-thumb{width:28px;height:28px;border-radius:50%;border:3px solid #f8f0df;background:#0b0b0d;box-shadow:0 4px 18px rgba(0,0,0,.55);pointer-events:auto;cursor:pointer}
body.dc-app .dc-time-boxes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.dc-time-boxes label{padding:10px 12px;border:1px solid rgba(255,255,255,.075);border-radius:14px;background:rgba(0,0,0,.20);color:var(--dc-muted);font-size:9px}.dc-time-boxes b{display:block;color:var(--dc-text);font-size:17px;margin-top:4px;font-variant-numeric:tabular-nums}
body.dc-app .dc-import-options-card{display:grid;grid-template-columns:1fr 110px 140px;gap:10px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(255,255,255,.025)}.dc-import-options-card label{display:block;color:var(--dc-muted);font-size:9px}.dc-import-options-card select{width:100%;height:40px;margin-top:6px;padding:0 10px;border:1px solid rgba(255,255,255,.10);border-radius:12px;background:#0b0b0d;color:var(--dc-text)}
body.dc-app .dc-token-result-card{display:grid;grid-template-columns:210px minmax(0,1fr);gap:12px;align-items:center}.dc-token-result-card>div,.dc-token-result-card>p{min-height:88px;margin:0;padding:15px;border:1px solid rgba(255,255,255,.08);border-radius:18px;background:rgba(0,0,0,.20)}.dc-token-result-card small,.dc-token-result-card strong,.dc-token-result-card span{display:block}.dc-token-result-card small{color:var(--dc-muted);font-size:9px}.dc-token-result-card strong{font-size:34px;letter-spacing:-.06em;color:var(--dc-accent2);margin-top:3px}.dc-token-result-card span,.dc-token-result-card p{color:var(--dc-muted);font-size:10.5px;line-height:1.45}.dc-token-result-card p{display:flex;align-items:center}.dc-token-result-card p.warn{color:var(--dc-orange);border-color:rgba(229,169,87,.22);background:rgba(229,169,87,.07)}
body.dc-app .dc-source-range-actions{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px}.dc-source-range-actions .dc-btn{min-height:48px;border-radius:999px}.dc-source-note{margin:0;color:var(--dc-muted);font-size:10px;line-height:1.45;text-align:center}.dc-source-note b{color:var(--dc-text)}
@media(max-width:760px){body.dc-app .dc-source-range-card{width:calc(100vw - 18px)}body.dc-app .dc-source-range-head{padding:20px 18px 14px}body.dc-app .dc-source-range-head h2{font-size:27px}body.dc-app .dc-source-range-body{padding:14px 18px 18px;max-height:calc(100dvh - 145px)}body.dc-app .dc-source-preview-card{grid-template-columns:74px minmax(0,1fr)}body.dc-app .dc-source-duration{grid-column:1/-1;width:max-content}.dc-source-thumb{width:74px!important;height:46px!important}.dc-time-boxes,.dc-import-options-card,.dc-token-result-card,.dc-source-range-actions{grid-template-columns:1fr!important}}


/* Phase billing modal fit + account logout repair */
body.dc-app .dc-account-menu .dc-logout-form{display:block!important}
body.dc-app .dc-account-menu .dc-logout-btn{display:flex!important;align-items:center;justify-content:space-between;width:100%;min-height:38px;border-radius:10px;color:var(--dc-red);font-size:10px;text-align:left;padding:0 10px;background:transparent;border:0}
body.dc-app .dc-account-menu .dc-logout-btn::after{content:'→';color:currentColor;opacity:.72}
body.dc-app .dc-account-menu .dc-logout-btn:hover{background:rgba(239,107,122,.09);color:#ff8f9a}
body.dc-app .dc-billing-layer{padding:18px;overflow:hidden}
body.dc-app .dc-billing-card{width:min(1040px,calc(100vw - 36px));max-height:calc(100dvh - 44px);overflow-y:auto;overflow-x:hidden;scrollbar-width:none;border-radius:24px}
body.dc-app .dc-billing-card::-webkit-scrollbar{width:0;height:0}
body.dc-app .dc-billing-head{padding:22px 24px 12px;grid-template-columns:minmax(0,1fr) 40px}
body.dc-app .dc-billing-head h2{font-size:28px;line-height:1.02;margin-top:12px;max-width:760px}
body.dc-app .dc-billing-head p{font-size:11px;line-height:1.55;margin-top:8px;max-width:760px}
body.dc-app .dc-billing-close{width:38px;height:38px;font-size:22px}
body.dc-app .dc-billing-status{padding:0 24px 12px;grid-template-columns:minmax(0,1.15fr) minmax(240px,.85fr);gap:12px}
body.dc-app .dc-usage-panel,body.dc-app .dc-rate-panel{border-radius:18px;padding:15px}
body.dc-app .dc-usage-row{margin-top:10px;gap:12px;align-items:center}
body.dc-app .dc-usage-value{font-size:44px;letter-spacing:-.065em}
body.dc-app .dc-usage-value span{font-size:11px}
body.dc-app .dc-usage-meta{min-width:185px;gap:7px}
body.dc-app .dc-usage-mini{padding:8px;border-radius:11px}
body.dc-app .dc-usage-mini b{font-size:13px}
body.dc-app .dc-usage-bar{height:7px;margin-top:12px}
body.dc-app .dc-rate-big{font-size:24px;margin-top:10px}
body.dc-app .dc-rate-panel p{font-size:10px;line-height:1.5;margin-top:7px}
body.dc-app .dc-rate-steps{margin-top:9px;gap:6px}
body.dc-app .dc-rate-steps span{font-size:8px;padding:5px 7px}
body.dc-app .dc-charge-terms{grid-template-columns:repeat(5,minmax(0,1fr));gap:7px!important;margin:0 24px 12px!important}
body.dc-app .dc-charge-terms span{font-size:8.5px;line-height:1.25;padding:7px 8px;border:1px solid rgba(255,255,255,.07);border-radius:999px;background:rgba(255,255,255,.025);white-space:normal}
body.dc-app .dc-charge-terms span::before{width:15px;height:15px;flex-basis:15px;font-size:9px}
body.dc-app .dc-youtube-consent-card{max-height:calc(100dvh - 32px);overflow-y:auto}
body.dc-app .dc-youtube-consent-card .dc-charge-terms{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important;margin:14px 0!important}
body.dc-app .dc-youtube-consent-card .dc-charge-terms span{min-height:62px;align-items:flex-start;padding:11px 12px;font-size:10px;line-height:1.4;border-radius:14px}
body.dc-app .dc-youtube-consent-card .dc-charge-terms span::before{width:18px;height:18px;flex-basis:18px;margin-top:1px;font-size:10px}
body.dc-app .dc-plan-grid{padding:0 24px 14px;gap:12px}
body.dc-app .dc-plan-card{min-height:208px;border-radius:19px;padding:15px}
body.dc-app .dc-plan-card h3{font-size:16px}
body.dc-app .dc-plan-card .tokens{font-size:32px;margin-top:12px}
body.dc-app .dc-plan-card p{font-size:10px;line-height:1.45;margin:9px 0 11px}
body.dc-app .dc-plan-features{gap:6px;margin-top:auto}
body.dc-app .dc-plan-features span{font-size:8.7px}
body.dc-app .dc-plan-card .dc-btn{min-height:36px;margin-top:12px;border-radius:10px}
body.dc-app .dc-billing-foot{padding:0 24px 20px;margin-top:0}
body.dc-app .dc-billing-note span{font-size:9px}
@media(max-height:760px){body.dc-app .dc-billing-card{max-height:calc(100dvh - 28px)}body.dc-app .dc-billing-head{padding:16px 20px 8px}body.dc-app .dc-billing-head h2{font-size:24px;margin-top:8px}body.dc-app .dc-billing-head p{font-size:10px;line-height:1.45}body.dc-app .dc-billing-kicker{min-height:24px;font-size:8.5px}body.dc-app .dc-billing-status{padding:0 20px 10px}body.dc-app .dc-usage-value{font-size:36px}body.dc-app .dc-plan-grid{padding:0 20px 10px}body.dc-app .dc-plan-card{min-height:184px;padding:13px}body.dc-app .dc-plan-card .tokens{font-size:28px}body.dc-app .dc-plan-card p{margin:6px 0 8px}body.dc-app .dc-charge-terms{margin:0 20px 10px!important}body.dc-app .dc-billing-foot{padding:0 20px 14px}}
@media(max-width:860px){body.dc-app .dc-billing-card{width:calc(100vw - 22px);overflow-y:auto}body.dc-app .dc-billing-status,body.dc-app .dc-plan-grid,body.dc-app .dc-charge-terms{grid-template-columns:1fr}body.dc-app .dc-charge-terms span{border-radius:12px}body.dc-app .dc-usage-row{align-items:flex-start;flex-direction:column}body.dc-app .dc-usage-meta{width:100%;min-width:0}}
/* Precision pass: consistent optical centring, readable compact text and a calmer token modal. */
body.dc-app .dc-btn,body.dc-app .dc-pill,body.dc-app .dc-status-pill,body.dc-app .dc-billing-kicker,body.dc-app .dc-token-pill{display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2}
body.dc-app .dc-btn{min-height:40px;padding-top:9px;padding-bottom:9px}
body.dc-app .dc-pill,body.dc-app .dc-status-pill{min-height:26px;padding:5px 10px}
body.dc-app .dc-billing-card{background:radial-gradient(circle at 14% 0%,rgba(217,180,120,.13),transparent 32%),linear-gradient(180deg,#141416,#0b0b0d 72%)}
body.dc-app .dc-billing-head p,body.dc-app .dc-rate-panel p,body.dc-app .dc-plan-card p{font-size:11.5px}
body.dc-app .dc-usage-mini span,body.dc-app .dc-plan-features span,body.dc-app .dc-billing-note span{font-size:10px;line-height:1.45}
body.dc-app .dc-plan-card{min-height:224px}body.dc-app .dc-plan-card .dc-btn{min-height:40px;font-size:11px}
body.dc-app .dc-billing-card{width:min(940px,calc(100vw - 36px));border-radius:22px}
body.dc-app .dc-billing-head{padding:24px 26px 15px}.dc-billing-head h2{max-width:700px}
body.dc-app .dc-billing-status{padding:0 26px 14px;grid-template-columns:minmax(0,1.2fr) minmax(260px,.8fr)}
body.dc-app .dc-usage-panel,body.dc-app .dc-rate-panel{padding:17px;border-radius:17px}
body.dc-app .dc-usage-row{display:grid;grid-template-columns:minmax(170px,1fr) 240px;align-items:end;gap:18px}.dc-usage-value{font-size:48px}
body.dc-app .dc-usage-meta{min-width:0}.dc-usage-mini{padding:10px 11px}
body.dc-app .dc-billing-card>.dc-charge-terms{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px!important;margin:0 26px 14px!important}
body.dc-app .dc-billing-card>.dc-charge-terms span{min-height:50px;padding:10px 11px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(255,255,255,.022);align-items:flex-start;font-size:9.5px}
body.dc-app .dc-billing-card>.dc-charge-terms span::before{margin-top:1px}
body.dc-app .dc-plan-grid{padding:0 26px 16px}.dc-plan-card{border-radius:17px}
/* Calm, plan-first billing layout inspired by the clearest parts of modern creator pricing pages. */
body.dc-app .dc-billing-card{width:min(1060px,calc(100vw - 36px));background:radial-gradient(circle at 50% -18%,rgba(217,180,120,.12),transparent 38%),linear-gradient(180deg,#121214,#09090b 78%)}
body.dc-app .dc-billing-head{padding:25px 30px 18px;text-align:center;grid-template-columns:40px minmax(0,1fr) 40px}
body.dc-app .dc-billing-head>div{grid-column:2}.dc-billing-head .dc-billing-close{grid-column:3;grid-row:1}
body.dc-app .dc-billing-kicker{margin:0 auto;min-height:28px}
body.dc-app .dc-billing-head h2{max-width:none;margin-top:11px;font-size:31px}
body.dc-app .dc-billing-head p{max-width:none;margin-top:7px;font-size:11.5px}
body.dc-app .dc-billing-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:3px;width:min(610px,calc(100% - 60px));margin:0 auto 18px;padding:4px;border:1px solid rgba(255,255,255,.10);border-radius:999px;background:#09090b}
body.dc-app .dc-billing-tabs button{min-height:43px;display:flex;align-items:center;justify-content:center;gap:6px;padding:0 14px;border:0;border-radius:999px;background:transparent;color:var(--dc-muted);font-size:11px;font-weight:850;cursor:pointer;transition:background .18s ease,color .18s ease,box-shadow .18s ease}
body.dc-app .dc-billing-tabs button:hover{color:var(--dc-text)}.dc-billing-tabs button.active{background:linear-gradient(180deg,#343438,#29292d);color:var(--dc-text);box-shadow:0 5px 16px rgba(0,0,0,.24),0 0 0 1px rgba(255,255,255,.055) inset}.dc-billing-tabs button small{padding:3px 6px;border-radius:999px;background:rgba(217,180,120,.10);color:var(--dc-accent2);font-size:7px;letter-spacing:.04em;text-transform:uppercase}
body.dc-app .dc-wallet-strip{position:relative;display:grid;grid-template-columns:1.05fr 1fr 1fr 1fr auto;gap:0;align-items:center;margin:0 30px 22px;padding:13px 15px 17px;border:1px solid rgba(255,255,255,.085);border-radius:17px;background:rgba(255,255,255,.025)}
body.dc-app .dc-wallet-strip>div:not(.dc-wallet-progress){min-width:0;padding:2px 15px;border-right:1px solid rgba(255,255,255,.07)}
body.dc-app .dc-wallet-strip>div:first-child{padding-left:3px}.dc-wallet-strip>div:nth-child(4){border-right:0}
body.dc-app .dc-wallet-strip span,body.dc-app .dc-wallet-strip strong{display:block}.dc-wallet-strip>div>span{color:var(--dc-muted);font-size:8.5px;text-transform:uppercase;letter-spacing:.08em;font-weight:800}.dc-wallet-strip strong{margin-top:4px;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-wallet-strip>div:first-child strong{font-size:22px;color:var(--dc-accent2)}.dc-wallet-strip small{color:var(--dc-muted);font-size:9px;font-weight:750}
body.dc-app .dc-wallet-strip>.dc-status-pill{justify-self:end;margin-left:10px;white-space:nowrap}
body.dc-app .dc-wallet-progress{position:absolute;left:15px;right:15px;bottom:8px;height:3px;border-radius:999px;background:rgba(255,255,255,.07);overflow:hidden}.dc-wallet-progress i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--dc-green),var(--dc-accent2))}
body.dc-app .dc-plan-grid{display:block;width:min(560px,100%);margin:0 auto;padding:0 30px 18px}
body.dc-app .dc-tab-plan[hidden]{display:none!important}.dc-tab-plan.active{animation:dcViewReveal .22s ease both}
body.dc-app .dc-plan-card{overflow:visible;min-height:390px;padding:0;border-radius:22px;background:#131315}
body.dc-app .dc-plan-card::before{display:none}.dc-plan-card.featured{border-color:rgba(217,180,120,.68);box-shadow:0 0 0 1px rgba(217,180,120,.14),0 22px 65px rgba(0,0,0,.28)}
body.dc-app .dc-plan-featured-label{height:38px;display:flex;align-items:center;justify-content:center;margin:-1px -1px 0;border-radius:22px 22px 0 0;background:linear-gradient(110deg,#d2a85f,#efd18e);color:#17120a;font-size:10px;font-weight:950;letter-spacing:.12em;text-transform:uppercase}
body.dc-app .dc-plan-content{display:flex;flex-direction:column;min-height:390px;padding:21px}.dc-plan-card.featured .dc-plan-content{min-height:351px}
body.dc-app .dc-plan-top{min-height:44px;align-items:flex-start}.dc-plan-top>div>span{display:block;margin-top:4px;color:var(--dc-muted);font-size:9px}.dc-plan-card h3{font-size:20px;text-transform:capitalize}
body.dc-app .dc-plan-price{margin-top:20px;color:var(--dc-text);font-size:24px;font-weight:900;letter-spacing:-.04em}.dc-plan-price span{color:var(--dc-muted);font-size:9px;font-weight:750;letter-spacing:0}
body.dc-app .dc-plan-card .tokens{margin-top:9px;color:var(--dc-accent2);font-size:31px}.dc-plan-card .tokens span{color:var(--dc-muted);font-size:9px}
body.dc-app .dc-plan-card p{min-height:36px;margin:9px 0 0;color:#aaa9b0;font-size:10px;line-height:1.55}
body.dc-app .dc-plan-divider{height:1px;margin:15px 0;background:rgba(255,255,255,.075)}
body.dc-app .dc-plan-features{gap:10px;margin:0 0 18px}.dc-plan-features span{font-size:10px;color:#c2c1c7}.dc-plan-features span::before{background:rgba(217,180,120,.11);color:var(--dc-accent2)}
body.dc-app .dc-plan-card .dc-btn{min-height:44px;margin-top:auto;border-radius:999px;font-size:11px}.dc-plan-card.featured .dc-btn:not(.secondary){background:linear-gradient(110deg,#d2a85f,#efd18e);color:#17120a}
body.dc-app .dc-billing-explainer{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 30px 16px;padding:14px 16px;border:1px solid rgba(255,255,255,.075);border-radius:16px;background:rgba(255,255,255,.02)}.dc-billing-explainer span{position:relative;padding-left:25px;color:var(--dc-muted);font-size:9px;line-height:1.4}.dc-billing-explainer span::before{content:'✓';position:absolute;left:0;top:1px;width:17px;height:17px;display:grid;place-items:center;border-radius:50%;background:rgba(83,199,139,.11);color:var(--dc-green);font-size:10px;font-weight:900}.dc-billing-explainer b{display:block;margin-bottom:2px;color:var(--dc-text);font-size:9.5px}
body.dc-app .dc-billing-foot{margin:0;padding:0 30px 24px}
@media(max-width:860px){body.dc-app .dc-billing-head{padding-left:18px;padding-right:18px}body.dc-app .dc-billing-tabs{width:calc(100% - 36px)}body.dc-app .dc-billing-tabs button{padding:0 8px}.dc-billing-tabs button small{display:none}body.dc-app .dc-wallet-strip{grid-template-columns:1fr 1fr;margin-left:18px;margin-right:18px;gap:12px}.dc-wallet-strip>div{border-right:0!important;padding:2px!important}.dc-wallet-strip>.dc-status-pill{grid-column:1/-1;justify-self:start;margin:0}.dc-wallet-progress{left:12px!important;right:12px!important}.dc-plan-grid{padding-left:18px!important;padding-right:18px!important}.dc-plan-card,.dc-plan-content{min-height:0!important}.dc-billing-explainer{grid-template-columns:1fr!important;margin-left:18px!important;margin-right:18px!important}.dc-billing-foot{padding-left:18px!important;padding-right:18px!important}}
.dc-tiktok-controls{grid-column:1/-1;display:grid;grid-template-columns:minmax(170px,.7fr) repeat(3,minmax(0,1fr));gap:10px;padding:14px;border:1px solid rgba(37,244,238,.16);border-radius:16px;background:rgba(37,244,238,.035)}
.dc-tiktok-controls>label:first-child{display:grid;gap:7px;color:var(--dc-muted);font-size:10px;font-weight:700}.dc-tiktok-controls select{width:100%;min-height:42px;border:1px solid rgba(255,255,255,.10);border-radius:11px;background:#0b0b0d;color:var(--dc-text);padding:0 11px}
.dc-tiktok-controls .dc-switch-row{min-height:66px;margin:0}.dc-tiktok-review-note{grid-column:1/-1;margin:0;color:var(--dc-muted);font-size:10px;line-height:1.5}.dc-tiktok-review-note b{color:var(--dc-text)}
@media(max-width:980px){.dc-tiktok-controls{grid-template-columns:1fr 1fr}}@media(max-width:860px){body.dc-app .dc-usage-row{grid-template-columns:1fr}body.dc-app .dc-billing-card>.dc-charge-terms{grid-template-columns:1fr 1fr}}@media(max-width:620px){.dc-tiktok-controls{grid-template-columns:1fr}body.dc-app .dc-billing-card>.dc-charge-terms{grid-template-columns:1fr}}
@media(max-width:620px){body.dc-app .dc-youtube-consent-card .dc-charge-terms{grid-template-columns:1fr!important}}

`;

/* V4 dashboard: a focused creator command centre, built from live workspace data. */
const v4DashboardCss = String.raw`
.dc-home-v4{display:grid;gap:16px}.dc-v4-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:18px;padding:26px;border:1px solid rgba(217,180,120,.28);border-radius:26px;background:radial-gradient(circle at 9% 6%,rgba(217,180,120,.17),transparent 30%),radial-gradient(circle at 93% 12%,rgba(74,193,255,.13),transparent 31%),linear-gradient(135deg,#16130f,#101116 55%,#0b1017)}.dc-v4-hero:after{content:'';position:absolute;width:360px;height:360px;right:-170px;bottom:-210px;border-radius:50%;border:1px solid rgba(217,180,120,.16);box-shadow:0 0 0 32px rgba(217,180,120,.025),0 0 0 64px rgba(217,180,120,.018);pointer-events:none}.dc-v4-eyebrow{display:inline-flex;align-items:center;gap:7px;min-height:28px;padding:0 10px;border:1px solid rgba(217,180,120,.26);border-radius:999px;background:rgba(217,180,120,.08);color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.dc-v4-eyebrow i{width:7px;height:7px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 4px rgba(83,199,139,.08)}.dc-v4-hero h1{max-width:740px;margin:13px 0 7px;font-size:clamp(32px,3.6vw,52px);line-height:.98;letter-spacing:-.06em}.dc-v4-hero p{max-width:630px;margin:0;color:var(--dc-muted);font-size:12px;line-height:1.55}.dc-v4-hero-actions{display:flex;gap:9px;flex-wrap:wrap;margin-top:18px}.dc-v4-hero-actions .dc-btn{min-height:43px;border-radius:13px}.dc-v4-scoreboard{position:relative;z-index:1;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;align-content:center}.dc-v4-stat{min-height:96px;padding:15px;border:1px solid rgba(255,255,255,.085);border-radius:18px;background:rgba(6,7,9,.36);backdrop-filter:blur(12px)}.dc-v4-stat b,.dc-v4-stat span{display:block}.dc-v4-stat b{font-size:30px;letter-spacing:-.07em}.dc-v4-stat span{margin-top:4px;color:var(--dc-muted);font-size:9px}.dc-v4-stat.good b{color:var(--dc-green)}.dc-v4-stat.gold b{color:var(--dc-accent2)}.dc-v4-start{display:grid;grid-template-columns:48px minmax(0,1fr) auto;gap:12px;align-items:center;padding:12px 14px;border:1px solid rgba(217,180,120,.22);border-radius:20px;background:linear-gradient(130deg,rgba(217,180,120,.09),rgba(255,255,255,.022) 46%,rgba(85,183,255,.06))}.dc-v4-start-icon{width:48px;height:48px;border-radius:16px;display:grid;place-items:center;background:rgba(217,180,120,.15);color:var(--dc-accent2)}.dc-v4-start-icon svg{width:23px;height:23px}.dc-v4-start-copy strong,.dc-v4-start-copy span{display:block}.dc-v4-start-copy strong{font-size:13px}.dc-v4-start-copy span{margin-top:3px;color:var(--dc-muted);font-size:9.5px}.dc-v4-import{display:grid;grid-template-columns:minmax(280px,1fr) 142px 105px 150px auto auto;gap:8px;align-items:center;margin-top:11px}.dc-v4-import input,.dc-v4-import select{height:45px;min-height:45px;padding:0 12px;border:1px solid var(--dc-line);border-radius:13px;background:#09090b;color:var(--dc-text)}.dc-v4-import .dc-btn{height:45px;border-radius:13px}.dc-v4-grid{display:grid;grid-template-columns:minmax(0,1.38fr) minmax(300px,.62fr);gap:16px}.dc-v4-panel{padding:18px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(155deg,#151518,#0e0e11)}.dc-v4-panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.dc-v4-panel-head h2{margin:0;font-size:17px;letter-spacing:-.025em}.dc-v4-panel-head p{margin:4px 0 0;color:var(--dc-muted);font-size:10px}.dc-v4-next{display:grid;grid-template-columns:50px minmax(0,1fr) auto;gap:11px;align-items:center;padding:11px;border:1px solid rgba(217,180,120,.19);border-radius:16px;background:radial-gradient(circle at 100% 0,rgba(217,180,120,.10),transparent 40%),#0a0a0c}.dc-v4-next-icon{width:50px;height:50px;border-radius:15px;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2)}.dc-v4-next-icon.good{background:rgba(83,199,139,.12);color:var(--dc-green)}.dc-v4-next-icon svg{width:23px;height:23px}.dc-v4-next strong,.dc-v4-next span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-v4-next strong{font-size:12px}.dc-v4-next span{margin-top:4px;color:var(--dc-muted);font-size:9px}.dc-v4-projects{display:grid;gap:8px;margin-top:12px}.dc-v4-project{display:grid;grid-template-columns:62px minmax(0,1fr) auto 17px;align-items:center;gap:10px;width:100%;padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:14px;background:rgba(0,0,0,.18);text-align:left;color:var(--dc-text)}.dc-v4-project:hover{border-color:rgba(217,180,120,.34);background:#111115}.dc-v4-project img,.dc-v4-project-thumb{width:62px;height:42px;border-radius:9px;object-fit:cover;background:#09090a;display:grid;place-items:center;color:var(--dc-subtle)}.dc-v4-project strong,.dc-v4-project span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-v4-project strong{font-size:10.5px}.dc-v4-project span{margin-top:3px;color:var(--dc-muted);font-size:8.7px}.dc-v4-project svg{width:16px;color:var(--dc-subtle)}.dc-v4-rail{display:grid;gap:11px}.dc-v4-readiness{padding:16px;border:1px solid var(--dc-line);border-radius:20px;background:linear-gradient(155deg,#141418,#0d0d10)}.dc-v4-readiness h2{margin:0;font-size:15px}.dc-v4-readiness>p{margin:4px 0 12px;color:var(--dc-muted);font-size:9.5px}.dc-v4-check{display:grid;grid-template-columns:27px minmax(0,1fr) auto;gap:9px;align-items:center;padding:9px 0;border-top:1px solid rgba(255,255,255,.065)}.dc-v4-check:first-of-type{border-top:0}.dc-v4-check i{width:27px;height:27px;border-radius:9px;display:grid;place-items:center;background:rgba(239,107,122,.10);color:var(--dc-red);font-style:normal;font-size:12px;font-weight:900}.dc-v4-check.on i{background:rgba(83,199,139,.12);color:var(--dc-green)}.dc-v4-check strong,.dc-v4-check span{display:block}.dc-v4-check strong{font-size:10px}.dc-v4-check span{margin-top:2px;color:var(--dc-muted);font-size:8.2px}.dc-v4-check .dc-pill{font-size:8px}.dc-v4-queue{display:grid;gap:8px}.dc-v4-queue-row{display:grid;grid-template-columns:27px minmax(0,1fr) auto;align-items:center;gap:9px;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:13px;background:#0b0b0d}.dc-v4-queue-row>span:first-child{width:27px;height:27px;border-radius:9px;display:grid;place-items:center;background:rgba(217,180,120,.11);color:var(--dc-accent2)}.dc-v4-queue-row svg{width:14px;height:14px}.dc-v4-queue-row strong,.dc-v4-queue-row em{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-v4-queue-row strong{font-size:10px}.dc-v4-queue-row em{margin-top:2px;color:var(--dc-muted);font-size:8px;font-style:normal}.dc-v4-queue-row .dc-pill{font-size:8px}@media(max-width:1180px){.dc-v4-hero,.dc-v4-grid{grid-template-columns:1fr}.dc-v4-import{grid-template-columns:minmax(260px,1fr) 145px 105px}.dc-v4-import .dc-btn{grid-column:auto}}@media(max-width:720px){.dc-v4-hero{padding:19px}.dc-v4-scoreboard{grid-template-columns:repeat(4,minmax(0,1fr))}.dc-v4-stat{min-height:74px;padding:10px}.dc-v4-stat b{font-size:21px}.dc-v4-stat span{font-size:7.8px}.dc-v4-start{grid-template-columns:42px minmax(0,1fr)}.dc-v4-start-icon{width:42px;height:42px}.dc-v4-start>.dc-btn{grid-column:1/-1}.dc-v4-import{grid-template-columns:1fr 1fr}.dc-v4-import input{grid-column:1/-1}.dc-v4-import .dc-btn{grid-column:auto}.dc-v4-project{grid-template-columns:54px minmax(0,1fr) 17px}.dc-v4-project .dc-pill{display:none}.dc-v4-project img,.dc-v4-project-thumb{width:54px;height:38px}}
`;

const v4WorkspaceCss = String.raw`
/* V4 shared workspace language */
body.dc-app .dc-page-head{align-items:center;padding:18px 20px;border:1px solid rgba(255,255,255,.075);border-radius:20px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.10),transparent 38%),linear-gradient(145deg,#151519,#0e0e11);margin-bottom:14px}body.dc-app .dc-page-head h1{font-size:28px;letter-spacing:-.045em}body.dc-app .dc-page-head p{font-size:10px;margin-top:5px}body.dc-app .dc-filterbar{padding:8px;border:1px solid rgba(255,255,255,.07);border-radius:16px;background:#101013}body.dc-app .dc-filterbar input,body.dc-app .dc-filterbar select{height:42px;border-radius:11px}
body.dc-app .dc-project-card{border-radius:20px;border-color:rgba(255,255,255,.08);background:linear-gradient(155deg,#151518,#0e0e11);box-shadow:0 16px 40px rgba(0,0,0,.20)}body.dc-app .dc-project-cover{height:190px}body.dc-app .dc-project-body{padding:15px}body.dc-app .dc-project-actions.three{grid-template-columns:1fr auto auto}body.dc-app .dc-project-actions.three .dc-btn{padding:0 11px;border-radius:11px}body.dc-app .dc-project-error-mini{border-radius:11px}
body.dc-app .dc-review-hero-pro{border-radius:24px;background:radial-gradient(circle at 5% 0,rgba(217,180,120,.14),transparent 38%),radial-gradient(circle at 94% 0,rgba(85,183,255,.09),transparent 34%),linear-gradient(145deg,#151519,#0d0d10)}body.dc-app .dc-review-toolbar.pro{position:sticky;top:calc(var(--dc-top) + 8px);z-index:30;border-radius:16px;backdrop-filter:blur(18px);background:rgba(15,15,18,.92)}.dc-v4-filter-group{display:flex;gap:6px;flex-wrap:wrap}.dc-v4-filter{min-height:32px;padding:0 10px;border:1px solid var(--dc-line);border-radius:999px;color:var(--dc-muted);font-size:9px}.dc-v4-filter:hover,.dc-v4-filter.on{border-color:rgba(217,180,120,.34);background:rgba(217,180,120,.10);color:var(--dc-accent2)}body.dc-app .dc-review-item.pro{border-radius:20px;border-color:rgba(255,255,255,.08);background:linear-gradient(155deg,#151518,#0e0e11);box-shadow:0 14px 40px rgba(0,0,0,.18)}body.dc-app .dc-review-actions.pro .dc-btn{border-radius:10px}
body.dc-app .dc-manage-hero,body.dc-app .dc-studio-hero{border-radius:24px}body.dc-app .dc-manage-card,body.dc-app .dc-settings-panel,body.dc-app .dc-insight-panel,body.dc-app .dc-template-card{border-radius:20px;border-color:rgba(255,255,255,.08);background:linear-gradient(155deg,#151518,#0e0e11)}body.dc-app .dc-manage-actions .dc-btn{border-radius:11px}body.dc-app .dc-switch-row{border-radius:14px}
body.dc-app .dc-editor-header{border-radius:16px 16px 0 0;background:linear-gradient(180deg,#17171b,#101013)}body.dc-app .dc-editor-workspace{border-radius:0 0 16px 16px}body.dc-app .dc-tool-panel{background:linear-gradient(180deg,#141417,#0e0e11)}body.dc-app .dc-canvas-toolbar{background:#101013}body.dc-app .dc-video-canvas{border-radius:10px;box-shadow:0 26px 70px rgba(0,0,0,.58)}
@media(max-width:720px){body.dc-app .dc-page-head{align-items:flex-start;padding:15px}.dc-v4-filter-group{width:100%;overflow:auto;flex-wrap:nowrap}.dc-v4-filter{flex:0 0 auto}body.dc-app .dc-review-toolbar.pro{top:calc(var(--dc-top) + 4px)}body.dc-app .dc-project-actions.three{grid-template-columns:1fr 1fr}body.dc-app .dc-project-actions.three .dc-btn:first-child{grid-column:1/-1}}
`;

const v4CinematicCss = String.raw`
.dc-home-v4-cinema{display:flex;flex-direction:column;gap:16px}.dc-home-v4-cinema .dc-home-hero-g{min-height:390px;padding:38px 34px;grid-template-columns:minmax(420px,1.02fr) minmax(390px,.98fr);border-color:rgba(217,180,120,.35);box-shadow:0 30px 90px rgba(0,0,0,.42),0 0 60px rgba(217,180,120,.055) inset}.dc-home-v4-cinema .dc-home-hero-g::before{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 45%,rgba(255,255,255,.025) 46%,transparent 48%);pointer-events:none}.dc-home-v4-cinema .dc-home-hero-copy h1{font-size:clamp(40px,4.8vw,68px);max-width:780px}.dc-home-v4-cinema .dc-hero-stage{min-height:320px}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone{width:132px;border-radius:21px;border-color:rgba(255,255,255,.18);box-shadow:0 28px 62px rgba(0,0,0,.48),0 0 0 1px rgba(217,180,120,.08) inset}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone:nth-child(1){left:2%;top:12%}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone:nth-child(2){left:31%;top:-2%}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone:nth-child(3){right:3%;top:14%}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone:nth-child(4){left:34%;bottom:-8%}.dc-v4-brand-rail{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:18px}.dc-v4-brand-label{color:var(--dc-muted);font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin-right:2px}.dc-v4-brand{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 10px;border:1px solid rgba(255,255,255,.09);border-radius:999px;background:rgba(0,0,0,.25);font-size:9px;color:var(--dc-muted)}.dc-v4-brand svg{width:16px;height:16px}.dc-v4-brand.youtube{color:#ff4e70}.dc-v4-brand.tiktok{color:#48f4ee}.dc-v4-brand.instagram{color:#ff8bc2}.dc-v4-brand.facebook{color:#83b6ff}.dc-v4-brand b{color:var(--dc-text);font-size:9px}.dc-v4-brand i{width:6px;height:6px;border-radius:50%;background:var(--dc-subtle)}.dc-v4-brand.on i{background:var(--dc-green);box-shadow:0 0 0 3px rgba(83,199,139,.09)}.dc-v4-feature-band{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.dc-v4-feature-band .dc-flow-card-g{min-height:96px;background:radial-gradient(circle at 100% 0,rgba(217,180,120,.07),transparent 40%),linear-gradient(145deg,#151519,#0e0e11)}.dc-v4-action-shell{padding:16px;border:1px solid rgba(217,180,120,.20);border-radius:22px;background:linear-gradient(145deg,#151518,#0e0e11)}.dc-v4-action-shell .dc-v4-next{min-height:82px}.dc-home-v4-cinema .dc-cinema-thumb{height:150px}.dc-home-v4-cinema .dc-platform-dot{width:46px;height:46px;border-radius:15px}.dc-home-v4-cinema .dc-platform-dot svg{width:22px;height:22px}@media(max-width:1250px){.dc-home-v4-cinema .dc-home-hero-g{grid-template-columns:1fr}.dc-home-v4-cinema .dc-hero-stage{min-height:300px}.dc-v4-feature-band{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:780px){.dc-home-v4-cinema .dc-home-hero-g{padding:22px 19px;min-height:0}.dc-home-v4-cinema .dc-home-hero-copy h1{font-size:37px}.dc-home-v4-cinema .dc-hero-stage{display:block;min-height:235px}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone{width:92px}.dc-home-v4-cinema .dc-hero-stage .dc-v3-phone:nth-child(4){display:none}.dc-v4-feature-band{grid-template-columns:1fr 1fr}.dc-v4-brand-label{width:100%}.dc-home-v4-cinema .dc-home-import-g{grid-template-columns:44px 1fr}.dc-home-v4-cinema .dc-home-import-g input{grid-column:2}.dc-home-v4-cinema .dc-home-import-g select,.dc-home-v4-cinema .dc-home-import-g .dc-btn{grid-column:auto}.dc-home-v4-cinema .dc-project-strip-g{grid-template-columns:1fr}}
`;

const v4DeclutterCss = String.raw`
/* V4 clarity pass: one primary action per surface. */
#dcTourLaunch{display:none!important}.dc-top-actions{gap:7px}.dc-top-actions>.dc-btn{border-radius:12px}.dc-token-pill{border-radius:12px}.dc-user-menu-button{border-radius:12px!important}.dc-nav-button{min-height:46px;margin-bottom:2px}.dc-nav-name{font-size:12px}.dc-nav-label{padding-top:14px}
.dc-empty-visual{grid-column:1/-1;width:100%;min-height:330px;display:grid;grid-template-columns:minmax(300px,.8fr) minmax(380px,1.2fr);align-items:center;gap:24px;padding:28px;border:1px dashed rgba(217,180,120,.25);border-radius:22px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.10),transparent 35%),#0d0d10;overflow:hidden}.dc-empty-visual-copy{max-width:430px}.dc-empty-visual-copy span{display:inline-flex;align-items:center;gap:7px;color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.09em;text-transform:uppercase}.dc-empty-visual-copy h2{margin:10px 0 7px;font-size:27px;letter-spacing:-.045em}.dc-empty-visual-copy p{margin:0 0 16px;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-empty-visual-media{height:270px;border-radius:18px;overflow:hidden;background:#09090b;box-shadow:0 24px 60px rgba(0,0,0,.38)}.dc-empty-visual-media img{width:100%;height:100%;object-fit:cover;display:block}.dc-review-page-pro.is-empty .dc-review-hero-pro{margin-bottom:14px}.dc-review-page-pro.is-empty .dc-review-metrics-pro{display:none}.dc-review-empty-pro.visual{min-height:340px;grid-template-columns:minmax(260px,.65fr) minmax(390px,1.35fr);gap:24px;text-align:left;padding:28px}.dc-review-empty-pro.visual>div:first-child{max-width:420px}.dc-review-empty-pro.visual .dc-empty-icon{margin:0 0 12px}.dc-review-empty-pro.visual img{width:100%;height:280px;object-fit:cover;border-radius:18px;box-shadow:0 22px 60px rgba(0,0,0,.38)}
.dc-review-toolbar.pro select{min-width:170px;height:38px;padding:0 34px 0 11px;border:1px solid var(--dc-line);border-radius:11px;background:#0b0b0d;color:var(--dc-text);font-size:9px}.dc-review-actions.pro.clear{grid-template-columns:auto auto auto;justify-content:start;min-width:0}.dc-clip-more{position:relative}.dc-clip-more summary{list-style:none;min-height:38px;display:grid;place-items:center;padding:0 13px;border:1px solid var(--dc-line);border-radius:10px;color:var(--dc-muted);font-size:9px;cursor:pointer}.dc-clip-more summary::-webkit-details-marker{display:none}.dc-clip-more[open] summary{border-color:rgba(217,180,120,.35);color:var(--dc-accent2)}.dc-clip-more>div{position:absolute;right:0;bottom:44px;z-index:35;width:170px;padding:6px;border:1px solid var(--dc-line2);border-radius:12px;background:#151518;box-shadow:0 18px 55px rgba(0,0,0,.5)}.dc-clip-more>div button{width:100%;min-height:34px;padding:0 9px;border-radius:8px;color:var(--dc-muted);font-size:9px;text-align:left}.dc-clip-more>div button:hover{background:rgba(255,255,255,.05);color:var(--dc-text)}.dc-clip-more>div button.danger{color:var(--dc-red)}
.dc-manage-actions.simple{grid-template-columns:1fr}.dc-manage-actions.simple.two{grid-template-columns:1fr auto}.dc-manage-actions.simple .dc-btn{min-height:40px}.dc-template-actions.simple{grid-template-columns:1fr auto}.dc-template-actions.simple .dc-btn{min-width:0}.dc-template-actions.simple .dc-btn.danger{width:40px;padding:0;font-size:0}.dc-template-actions.simple .dc-btn.danger::before{content:'×';font-size:16px}.dc-social-logo.instagram svg,.dc-manage-logo.instagram svg{fill:none!important;stroke:currentColor!important}.dc-social-logo.instagram svg circle:last-child,.dc-manage-logo.instagram svg circle:last-child{fill:currentColor!important;stroke:none!important}#dcPremiumManageGroup,.dc-premium-site-link{display:none!important}
.dc-upload-zone input[type=file]{width:100%;padding:7px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:#09090b;color:var(--dc-muted);font-size:9px}.dc-upload-zone input[type=file]::file-selector-button{height:34px;margin-right:10px;padding:0 12px;border:0;border-radius:9px;background:rgba(217,180,120,.14);color:var(--dc-accent2);font:inherit;font-weight:800;cursor:pointer}
.dc-editor-empty{min-height:430px;display:grid;grid-template-columns:minmax(280px,.7fr) minmax(400px,1.3fr);align-items:center;gap:24px;padding:28px;border:1px solid var(--dc-line);border-radius:22px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.10),transparent 35%),linear-gradient(145deg,#151519,#0e0e11)}.dc-editor-empty h1{margin:10px 0 7px;font-size:30px;letter-spacing:-.045em}.dc-editor-empty p{margin:0 0 16px;color:var(--dc-muted);font-size:11px;line-height:1.55}.dc-editor-empty img{width:100%;height:330px;object-fit:cover;border-radius:18px;box-shadow:0 24px 70px rgba(0,0,0,.42)}
@media(max-width:900px){.dc-empty-visual,.dc-review-empty-pro.visual,.dc-editor-empty{grid-template-columns:1fr}.dc-empty-visual-media,.dc-review-empty-pro.visual img,.dc-editor-empty img{height:230px}}@media(max-width:720px){#dcTopbar .dc-token-label{display:none}.dc-empty-visual,.dc-review-empty-pro.visual,.dc-editor-empty{padding:18px;min-height:0}.dc-empty-visual-copy h2,.dc-editor-empty h1{font-size:23px}}
`;

const v5ExperienceCss = String.raw`
/* V5 creator workspace: fewer surfaces, stronger imagery and reliable icons. */
.dc-home-v5{display:flex;flex-direction:column;gap:18px}.dc-v5-hero{position:relative;min-height:420px;display:grid;grid-template-columns:minmax(480px,1.02fr) minmax(410px,.98fr);gap:26px;align-items:center;padding:38px;border:1px solid rgba(221,183,118,.3);border-radius:30px;overflow:hidden;background:radial-gradient(circle at 4% 0,rgba(221,183,118,.2),transparent 31%),radial-gradient(circle at 91% 18%,rgba(53,118,157,.16),transparent 29%),linear-gradient(135deg,#1a1510 0,#101115 48%,#081018 100%);box-shadow:0 32px 100px rgba(0,0,0,.42)}.dc-v5-hero::before{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 42%,rgba(255,255,255,.025) 43%,transparent 44%);pointer-events:none}.dc-v5-hero::after{content:'';position:absolute;width:420px;height:420px;right:-200px;top:-230px;border:1px solid rgba(221,183,118,.22);border-radius:50%;box-shadow:0 0 0 70px rgba(221,183,118,.025),0 0 0 140px rgba(221,183,118,.015);pointer-events:none}.dc-v5-hero-copy{position:relative;z-index:2}.dc-v5-eyebrow{display:inline-flex;align-items:center;gap:8px;color:#e5c68e;font-size:9px;font-weight:850;letter-spacing:.16em;text-transform:uppercase}.dc-v5-eyebrow i{width:7px;height:7px;border-radius:50%;background:#71d6a0;box-shadow:0 0 0 5px rgba(113,214,160,.09)}.dc-v5-hero h1{max-width:740px;margin:14px 0 12px;font-size:clamp(43px,4.5vw,66px);line-height:.92;letter-spacing:-.062em}.dc-v5-hero-copy>p{max-width:620px;margin:0;color:#a9a8b0;font-size:13px;line-height:1.6}.dc-v5-hero-actions{display:flex;align-items:center;gap:10px;margin-top:19px}.dc-v5-hero-actions .dc-btn{min-height:44px;padding:0 18px;border-radius:13px}.dc-v5-inline-stats{display:flex;gap:18px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.08)}.dc-v5-inline-stat{min-width:67px}.dc-v5-inline-stat b,.dc-v5-inline-stat span{display:block}.dc-v5-inline-stat b{font-size:18px;letter-spacing:-.03em}.dc-v5-inline-stat span{margin-top:3px;color:#777780;font-size:7.5px;font-weight:750;letter-spacing:.1em;text-transform:uppercase}.dc-v5-brands{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:17px}.dc-v5-brands>small{margin-right:3px;color:#6f6f77;font-size:8px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.dc-v5-brand{position:relative;width:34px;height:34px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.1);border-radius:11px;background:rgba(0,0,0,.24);color:#666771}.dc-v5-brand svg{width:16px;height:16px}.dc-v5-brand.youtube{color:#ff4168}.dc-v5-brand.tiktok{color:#3df4ee}.dc-v5-brand.instagram{color:#ff7fba}.dc-v5-brand.facebook{color:#76a8ff}.dc-v5-brand.on{border-color:rgba(109,211,154,.35);box-shadow:0 0 0 1px rgba(109,211,154,.06) inset}.dc-v5-brand.on::after{content:'';position:absolute;right:-2px;top:-2px;width:7px;height:7px;border:2px solid #101115;border-radius:50%;background:#6dd39a}
.dc-v5-stage{position:relative;z-index:2;min-height:325px}.dc-v5-stage-glow{position:absolute;inset:14% 8% 8%;border-radius:50%;background:radial-gradient(circle,rgba(221,183,118,.15),transparent 66%);filter:blur(16px)}.dc-v5-phone{position:absolute;width:150px;aspect-ratio:9/16;border:1px solid rgba(255,255,255,.18);border-radius:22px;overflow:hidden;background:#08090b;box-shadow:0 30px 70px rgba(0,0,0,.58);transform:rotate(var(--rot));transition:transform .3s ease}.dc-v5-phone:hover{transform:rotate(0) translateY(-7px);z-index:5}.dc-v5-phone:nth-of-type(2){left:4%;top:17%;--rot:-7deg}.dc-v5-phone:nth-of-type(3){left:35%;top:2%;--rot:3deg;z-index:3}.dc-v5-phone:nth-of-type(4){right:2%;top:19%;--rot:7deg}.dc-v5-phone img{width:100%;height:100%;display:block;object-fit:cover}.dc-v5-phone::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,transparent 45%,rgba(0,0,0,.84));pointer-events:none}.dc-v5-phone-copy{position:absolute;z-index:2;left:12px;right:12px;bottom:13px}.dc-v5-phone-copy small,.dc-v5-phone-copy strong{display:block}.dc-v5-phone-copy small{color:#e3c388;font-size:6.5px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.dc-v5-phone-copy strong{margin-top:4px;color:#fff;font-size:10px;line-height:1.25;text-shadow:0 2px 12px #000}.dc-v5-score{position:absolute;z-index:2;right:9px;top:9px;min-width:32px;height:23px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.14);border-radius:999px;background:rgba(5,6,8,.75);color:#c7ff87;font-size:8.5px;font-weight:850;backdrop-filter:blur(10px)}
.dc-v5-create{padding:20px;border:1px solid rgba(255,255,255,.09);border-radius:24px;background:linear-gradient(145deg,#151518,#0c0d10);box-shadow:0 20px 55px rgba(0,0,0,.2)}.dc-v5-create-head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:14px}.dc-v5-create-head h2{margin:0;font-size:21px;letter-spacing:-.035em}.dc-v5-create-head p{margin:4px 0 0;color:#7e7e87;font-size:10px}.dc-v5-token-note{display:inline-flex;align-items:center;gap:6px;color:#96969e;font-size:9px}.dc-v5-token-note svg{width:15px;height:15px}.dc-v5-url-row{display:grid;grid-template-columns:48px minmax(320px,1fr) auto;gap:9px}.dc-v5-url-brand{height:50px;display:grid;place-items:center;border-radius:15px;background:rgba(255,0,51,.13);color:#ff456b}.dc-v5-url-brand svg{width:23px;height:23px}.dc-v5-url-row input{height:50px!important;padding:0 16px!important;border:1px solid rgba(255,255,255,.09)!important;border-radius:15px!important;background:#08090b!important;color:#fff!important;font-size:12px!important}.dc-v5-url-row .dc-btn{height:50px;padding:0 24px;border-radius:15px}.dc-v5-options{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.dc-v5-option{display:flex;align-items:center;gap:7px;min-height:38px;padding:0 11px;border:1px solid rgba(255,255,255,.075);border-radius:12px;background:#0a0b0d}.dc-v5-option span{color:#73737b;font-size:8px;text-transform:uppercase;letter-spacing:.08em}.dc-v5-option select{height:34px!important;min-height:34px!important;padding:0 24px 0 0!important;border:0!important;background:transparent!important;color:#d7d7db!important;font-size:9px!important}.dc-v5-upload{margin-left:auto;min-height:38px!important;border-radius:12px!important}.dc-v5-upload svg{width:16px;height:16px;margin-right:6px}
.dc-v5-now{min-height:76px;display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:13px;align-items:center;padding:13px 16px;border:1px solid rgba(221,183,118,.17);border-radius:18px;background:linear-gradient(90deg,rgba(221,183,118,.075),rgba(255,255,255,.018) 48%,rgba(52,112,151,.045));box-shadow:0 14px 40px rgba(0,0,0,.16)}.dc-v5-now.fail{border-color:rgba(239,107,122,.35);background:linear-gradient(90deg,rgba(239,107,122,.12),rgba(255,255,255,.018) 50%,rgba(239,107,122,.045));box-shadow:0 14px 42px rgba(92,18,27,.18)}.dc-v5-now-icon{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(221,183,118,.11);color:#d8b875}.dc-v5-now-icon.live{background:rgba(109,211,154,.1);color:#6dd39a}.dc-v5-now-icon.fail{background:rgba(239,107,122,.13);color:#ef6b7a}.dc-v5-now-icon svg{width:20px;height:20px;fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round;stroke-linejoin:round}.dc-v5-now-copy{min-width:0}.dc-v5-now-copy small,.dc-v5-now-copy strong,.dc-v5-now-copy span{display:block}.dc-v5-now-copy small{margin-bottom:3px;color:#c6a86d;font-size:7.5px;font-weight:850;letter-spacing:.13em;text-transform:uppercase}.dc-v5-now.fail .dc-v5-now-copy small{color:#ef8290}.dc-v5-now-copy strong{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}.dc-v5-now-copy span{margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#7f7f88;font-size:8.5px}.dc-v5-now.fail .dc-v5-now-copy span{color:#b68c92}.dc-v5-now .dc-btn{min-height:36px;border-radius:11px}.dc-v5-now-progress{height:3px;margin-top:7px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.07)}.dc-v5-now-progress i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#d5af68,#f2d69b)}
.dc-v5-lower{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.55fr);gap:16px}.dc-v5-library,.dc-v5-side-card{border:1px solid rgba(255,255,255,.085);border-radius:25px;background:linear-gradient(160deg,#121316,#0b0c0e)}.dc-v5-library{padding:22px}.dc-v5-section-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:16px}.dc-v5-section-head h2{margin:0;font-size:20px;letter-spacing:-.035em}.dc-v5-section-head p{margin:4px 0 0;color:#797981;font-size:10px}.dc-v5-text-link{display:inline-flex;align-items:center;gap:6px;color:#cfb276;font-size:9px;font-weight:800}.dc-v5-text-link svg{width:15px;height:15px}.dc-v5-project-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px}.dc-v5-project{min-width:0;padding:9px;border:1px solid rgba(255,255,255,.075);border-radius:18px;background:#090a0c;text-align:left;color:#fff}.dc-v5-project:hover{border-color:rgba(221,183,118,.32);transform:translateY(-2px)}.dc-v5-project-media{position:relative;height:155px;display:block;overflow:hidden;border-radius:13px;background:#050506}.dc-v5-project-media img{width:100%;height:100%;object-fit:cover}.dc-v5-project-media .dc-ui-icon{position:absolute;inset:0;display:grid;place-items:center;color:#a88e5b}.dc-v5-project-media .dc-ui-icon svg{width:28px;height:28px}.dc-v5-project-status{position:absolute;left:8px;top:8px;z-index:2}.dc-v5-project-copy{display:block;padding:11px 3px 3px}.dc-v5-project-copy strong,.dc-v5-project-copy small{display:block}.dc-v5-project-copy strong{min-height:32px;font-size:11px;line-height:1.4}.dc-v5-project-copy small{margin-top:5px;color:#777780;font-size:8px}.dc-v5-library-empty{position:relative;min-height:270px;display:flex;align-items:center;overflow:hidden;padding:32px;border-radius:19px;background:#090a0c}.dc-v5-library-empty img{position:absolute;inset:0 0 0 auto;width:65%;height:100%;object-fit:cover;opacity:.58;mask-image:linear-gradient(90deg,transparent,#000 45%)}.dc-v5-library-empty::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,#090a0c 25%,transparent 78%)}.dc-v5-library-empty-copy{position:relative;z-index:2;max-width:360px}.dc-v5-library-empty-copy span{color:#d8bb80;font-size:8px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.dc-v5-library-empty-copy h3{margin:8px 0 7px;font-size:25px;letter-spacing:-.045em}.dc-v5-library-empty-copy p{margin:0;color:#8b8b94;font-size:10px;line-height:1.55}.dc-v5-side{display:flex;flex-direction:column;gap:14px}.dc-v5-side-card{padding:19px}.dc-v5-side-head{display:flex;align-items:center;gap:9px;margin-bottom:13px}.dc-v5-side-head>.dc-ui-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(221,183,118,.09);color:#d8b875}.dc-v5-side-head>.dc-ui-icon svg{width:17px;height:17px}.dc-v5-side-head strong{font-size:13px}.dc-v5-side-card p{margin:0;color:#82828b;font-size:10px;line-height:1.5}.dc-v5-next-main{display:flex;align-items:center;gap:10px;margin-bottom:13px}.dc-v5-next-main img{width:62px;height:78px;object-fit:cover;border-radius:12px}.dc-v5-next-main strong,.dc-v5-next-main small{display:block}.dc-v5-next-main strong{font-size:11px;line-height:1.4}.dc-v5-next-main small{margin-top:4px;color:#7b7b84;font-size:8px}.dc-v5-channel-row{display:flex;gap:8px;margin:5px 0 12px}.dc-v5-channel-row .dc-v5-brand{width:40px;height:40px}.dc-v5-side-card .dc-btn{width:100%;margin-top:14px;border-radius:12px}.dc-v5-status-line{display:flex;align-items:center;gap:8px;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:#090a0c}.dc-v5-status-line>.dc-ui-icon{width:28px;height:28px;display:grid;place-items:center;border-radius:9px;background:rgba(109,211,154,.09);color:#6dd39a}.dc-v5-status-line span{font-size:9px;color:#9b9ba4}
/* Line icons must stay visible even when older dashboard rules set SVG fills. */
.dc-ui-icon svg,.dc-empty-icon svg,.dc-empty-visual-copy>span svg,.dc-live-icon svg,.dc-v4-next-icon svg,.dc-dock-head>span svg,.dc-manage-kicker svg,.dc-manage-logo:not(.dc-social-logo) svg,.dc-flow-card-g>span svg,.dc-road-step>span svg{fill:none!important;stroke:currentColor!important;stroke-width:1.8!important;stroke-linecap:round!important;stroke-linejoin:round!important}.dc-empty-visual-copy>span svg{width:16px;height:16px}.dc-v5-brand.youtube svg,.dc-v5-brand.tiktok svg,.dc-v5-brand.facebook svg,.dc-v5-url-brand svg,.dc-social-logo.youtube svg,.dc-social-logo.tiktok svg,.dc-social-logo.facebook svg{fill:currentColor!important;stroke:none!important}.dc-v5-brand.instagram svg,.dc-social-logo.instagram svg{fill:none!important;stroke:currentColor!important;stroke-width:2!important}.dc-v5-brand.instagram svg circle:last-child,.dc-social-logo.instagram svg circle:last-child{fill:currentColor!important;stroke:none!important}
/* Carry the new visual language through the rest of the workspace. */
.dc-page-head,.dc-review-hero-pro,.dc-manage-hero,.dc-studio-hero{border-radius:25px!important;border-color:rgba(255,255,255,.09)!important;background:radial-gradient(circle at 100% 0,rgba(55,113,151,.1),transparent 35%),linear-gradient(145deg,#151518,#0d0e11)!important}.dc-project-card,.dc-review-item,.dc-manage-card,.dc-template-card,.dc-settings-panel,.dc-insight-panel{border-color:rgba(255,255,255,.08)!important;box-shadow:0 20px 55px rgba(0,0,0,.18)!important}.dc-manage-metrics{gap:22px}.dc-manage-metrics span{min-width:0!important;padding:0 0 0 18px!important;border:0!important;border-left:1px solid rgba(255,255,255,.1)!important;border-radius:0!important;background:transparent!important}.dc-studio-strip{display:flex!important;align-items:center;gap:0!important;padding:2px 4px;overflow:auto}.dc-studio-stat{min-width:160px;padding:0 24px!important;border:0!important;border-right:1px solid rgba(255,255,255,.09)!important;border-radius:0!important;background:transparent!important}.dc-studio-stat:last-child{border-right:0!important}.dc-nav-button.is-active{background:linear-gradient(90deg,rgba(221,183,118,.15),rgba(221,183,118,.06))!important}.dc-btn{font-weight:760!important}.dc-btn.secondary{background:#0c0d0f!important}
/* One motion language: ambient colour, useful live states and tactile depth. */
.dc-v5-hero{background-size:135% 135%,125% 125%,100% 100%;animation:dcV5Aurora 16s ease-in-out infinite;will-change:background-position}.dc-v5-hero::before{transform:translateX(-35%);animation:dcV5Sheen 9s ease-in-out infinite}.dc-v5-hero::after{animation:dcV5Orbit 13s ease-in-out infinite}.dc-v5-eyebrow i{animation:dcV5ReadyPulse 2.8s ease-in-out infinite}.dc-v5-stage-glow{animation:dcV5GlowBreath 5.8s ease-in-out infinite}.dc-v5-phone{will-change:transform;animation:dcV5Float 7s ease-in-out infinite}.dc-v5-phone:nth-of-type(3){animation-delay:-2.3s}.dc-v5-phone:nth-of-type(4){animation-delay:-4.6s}.dc-v5-phone:hover{animation:none}.dc-v5-phone img{transition:transform .55s cubic-bezier(.2,.75,.25,1),filter .35s ease}.dc-v5-phone:hover img{transform:scale(1.035);filter:saturate(1.08)}.dc-v5-score{animation:dcV5ScoreBreath 4.2s ease-in-out infinite}.dc-v5-hero-actions .dc-btn:first-child::after{content:'';position:absolute;inset:-60% auto -60% -45%;width:38%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.42),transparent);transform:skewX(-18deg) translateX(-210%);animation:dcV5ButtonGlint 5.4s ease-in-out infinite;pointer-events:none}
.dc-v5-create,.dc-v5-library,.dc-v5-side-card,.dc-v5-project{transition:transform .28s cubic-bezier(.2,.75,.25,1),border-color .28s ease,box-shadow .28s ease,background .28s ease}.dc-v5-create:focus-within{border-color:rgba(221,183,118,.34);box-shadow:0 22px 65px rgba(0,0,0,.28),0 0 0 1px rgba(221,183,118,.06) inset}.dc-v5-url-brand{animation:dcV5SourcePulse 4.5s ease-in-out infinite}.dc-v5-option{transition:border-color .2s ease,background .2s ease,transform .2s ease}.dc-v5-option:hover,.dc-v5-option:focus-within{border-color:rgba(221,183,118,.24);background:#0e0e11;transform:translateY(-1px)}
.dc-v5-now{position:relative;overflow:hidden;transition:border-color .25s ease,box-shadow .25s ease,background .25s ease}.dc-v5-now::after{content:'';position:absolute;inset:0;background:linear-gradient(105deg,transparent 28%,rgba(221,183,118,.07) 47%,rgba(86,176,221,.05) 53%,transparent 72%);transform:translateX(-115%);animation:dcV5StatusSweep 6.8s ease-in-out infinite;pointer-events:none}.dc-v5-now>*{position:relative;z-index:1}.dc-v5-now-icon.live{animation:dcV5LivePulse 2.5s ease-in-out infinite}.dc-v5-now.fail{animation:dcV5FailureBreath 3.4s ease-in-out infinite}.dc-v5-now.fail::after{background:linear-gradient(105deg,transparent 30%,rgba(239,107,122,.08) 50%,transparent 70%)}.dc-v5-now.fail .dc-v5-now-icon{animation:dcV5FailureIcon 2.2s ease-in-out infinite}.dc-v5-now-progress i{position:relative;overflow:hidden;transition:width .65s cubic-bezier(.2,.75,.25,1)}.dc-v5-now-progress i::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.7),transparent);transform:translateX(-110%);animation:dcProgressSweep 1.6s linear infinite}
.dc-v5-brand{transition:transform .22s cubic-bezier(.2,.75,.25,1),border-color .22s ease,box-shadow .22s ease,background .22s ease}.dc-v5-brand:hover{transform:translateY(-2px) scale(1.04);background:rgba(255,255,255,.035)}.dc-v5-brand.on{animation:dcV5Connected 3.8s ease-in-out infinite}.dc-v5-project:hover{box-shadow:0 18px 42px rgba(0,0,0,.28)}.dc-v5-project-media img{transition:transform .5s cubic-bezier(.2,.75,.25,1),filter .4s ease}.dc-v5-project:hover .dc-v5-project-media img{transform:scale(1.045);filter:saturate(1.08)}.dc-v5-side-card:hover{transform:translateY(-2px);border-color:rgba(221,183,118,.19);box-shadow:0 18px 44px rgba(0,0,0,.22)}.dc-v5-library-empty img{animation:dcV5LibraryDrift 12s ease-in-out infinite}.dc-v5-text-link svg{transition:transform .2s ease}.dc-v5-text-link:hover svg{transform:translateX(3px)}
.dc-page-head,.dc-review-hero-pro,.dc-manage-hero,.dc-studio-hero{background-size:125% 125%!important;animation:dcV5PanelAura 14s ease-in-out infinite}.dc-project-card,.dc-review-item,.dc-manage-card,.dc-template-card,.dc-settings-panel,.dc-insight-panel{transition:transform .25s cubic-bezier(.2,.75,.25,1),border-color .25s ease,box-shadow .25s ease!important}.dc-project-card:hover,.dc-review-item:hover,.dc-manage-card:hover,.dc-template-card:hover{transform:translateY(-3px);border-color:rgba(221,183,118,.22)!important;box-shadow:0 26px 68px rgba(0,0,0,.28)!important}.dc-template-preview::after{content:'';position:absolute;inset:0;background:linear-gradient(110deg,transparent 28%,rgba(221,183,118,.08) 48%,transparent 68%);transform:translateX(-115%);animation:dcV5StatusSweep 8s ease-in-out infinite;pointer-events:none}.dc-quality-bar i{position:relative;overflow:hidden;transition:width .65s cubic-bezier(.2,.75,.25,1)}.dc-quality-bar i::after{content:'';position:absolute;inset:0;background:linear-gradient(90deg,transparent,rgba(255,255,255,.45),transparent);transform:translateX(-110%);animation:dcProgressSweep 2.2s linear infinite}.dc-nav-button.is-active::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 25%,rgba(221,183,118,.07),transparent 75%);transform:translateX(-115%);animation:dcV5NavSweep 7s ease-in-out infinite;pointer-events:none}.dc-health.bad i{animation:dcV5IssuePulse 1.9s ease-in-out infinite}
@keyframes dcV5Aurora{0%,100%{background-position:0 0,100% 0,0 0}50%{background-position:9% 5%,91% 9%,0 0}}@keyframes dcV5Sheen{0%,62%{transform:translateX(-38%);opacity:.45}82%,100%{transform:translateX(38%);opacity:.85}}@keyframes dcV5Orbit{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(-12px,10px,0) scale(1.035)}}@keyframes dcV5ReadyPulse{0%,100%{box-shadow:0 0 0 5px rgba(113,214,160,.08),0 0 0 rgba(113,214,160,0)}50%{box-shadow:0 0 0 5px rgba(113,214,160,.12),0 0 18px rgba(113,214,160,.32)}}@keyframes dcV5GlowBreath{0%,100%{opacity:.65;transform:scale(.96)}50%{opacity:1;transform:scale(1.07)}}@keyframes dcV5Float{0%,100%{transform:translate3d(0,0,0) rotate(var(--rot))}50%{transform:translate3d(0,-9px,0) rotate(calc(var(--rot) + 1deg))}}@keyframes dcV5ScoreBreath{0%,100%{box-shadow:0 0 0 rgba(199,255,135,0)}50%{box-shadow:0 0 18px rgba(199,255,135,.18)}}@keyframes dcV5ButtonGlint{0%,68%{transform:skewX(-18deg) translateX(-210%)}88%,100%{transform:skewX(-18deg) translateX(650%)}}@keyframes dcV5SourcePulse{0%,100%{box-shadow:0 0 0 rgba(255,65,104,0)}50%{box-shadow:0 0 25px rgba(255,65,104,.12)}}@keyframes dcV5StatusSweep{0%,64%{transform:translateX(-115%)}92%,100%{transform:translateX(115%)}}@keyframes dcV5LivePulse{0%,100%{box-shadow:0 0 0 0 rgba(109,211,154,0)}50%{box-shadow:0 0 0 6px rgba(109,211,154,.055)}}@keyframes dcV5FailureBreath{0%,100%{box-shadow:0 14px 42px rgba(92,18,27,.16)}50%{box-shadow:0 14px 48px rgba(141,27,40,.27),0 0 0 1px rgba(239,107,122,.04) inset}}@keyframes dcV5FailureIcon{0%,100%{transform:scale(1)}50%{transform:scale(1.055)}}@keyframes dcV5Connected{0%,100%{box-shadow:0 0 0 1px rgba(109,211,154,.06) inset,0 0 0 rgba(109,211,154,0)}50%{box-shadow:0 0 0 1px rgba(109,211,154,.1) inset,0 0 16px rgba(109,211,154,.1)}}@keyframes dcV5LibraryDrift{0%,100%{transform:scale(1.02) translateX(0)}50%{transform:scale(1.06) translateX(-1.5%)}}@keyframes dcV5PanelAura{0%,100%{background-position:100% 0,0 0}50%{background-position:88% 10%,0 0}}@keyframes dcV5NavSweep{0%,74%{transform:translateX(-115%)}94%,100%{transform:translateX(115%)}}@keyframes dcV5IssuePulse{0%,100%{box-shadow:0 0 0 0 rgba(239,107,122,0)}50%{box-shadow:0 0 0 5px rgba(239,107,122,.11)}}
@media(max-width:1250px){.dc-v5-hero{grid-template-columns:1fr;padding:34px}.dc-v5-stage{min-height:320px}.dc-v5-phone:nth-of-type(2){left:15%}.dc-v5-phone:nth-of-type(3){left:41%}.dc-v5-phone:nth-of-type(4){right:15%}.dc-v5-lower{grid-template-columns:1fr}.dc-v5-side{display:grid;grid-template-columns:1fr 1fr}}
@media(max-width:860px){.dc-v5-hero{min-height:0;padding:26px 20px}.dc-v5-hero h1{font-size:43px}.dc-v5-stage{min-height:290px}.dc-v5-phone{width:130px}.dc-v5-phone:nth-of-type(2){left:5%}.dc-v5-phone:nth-of-type(3){left:35%}.dc-v5-phone:nth-of-type(4){right:4%}.dc-v5-url-row{grid-template-columns:44px 1fr}.dc-v5-url-row .dc-btn{grid-column:1/-1}.dc-v5-options{display:grid;grid-template-columns:1fr 1fr}.dc-v5-option{min-width:0}.dc-v5-upload{width:auto!important;margin:0}.dc-v5-project-grid{grid-template-columns:1fr}.dc-v5-side{grid-template-columns:1fr}}
@media(max-width:560px){.dc-v5-hero h1{font-size:36px}.dc-v5-stage{min-height:245px}.dc-v5-phone{width:105px;border-radius:18px}.dc-v5-inline-stats{gap:13px}.dc-v5-create{padding:14px}.dc-v5-create-head{display:block}.dc-v5-token-note{margin-top:8px}.dc-v5-options{grid-template-columns:1fr}.dc-v5-now{grid-template-columns:38px minmax(0,1fr);padding:12px}.dc-v5-now-icon{width:38px;height:38px}.dc-v5-now>.dc-btn,.dc-v5-now>.dc-pill{grid-column:1/-1}.dc-v5-library{padding:15px}.dc-v5-library-empty{padding:22px}.dc-v5-library-empty img{width:100%;opacity:.35}}
`;

function injectShell(){
  if (shellReady) return;
  shellReady = true;
  const style = document.createElement('style');
  style.id = 'dcPhase4Styles'; style.textContent = css + billingCss + rangeChargeCss + v3Css + v3ProjectCss + clipToolsCss + scheduleKeepCss + topbarCleanCss + trialUxCss + v4DashboardCss + v4WorkspaceCss + v4CinematicCss + v4DeclutterCss + v5ExperienceCss + publishingWorkspaceCss + premiumStudioCss; document.head.appendChild(style);
  document.body.classList.add('dc-app');
  hideLegacyProjectBrowser();

  const side = document.createElement('aside'); side.id = 'dcSidebar';
  side.innerHTML = `<div id="dcBrand"><div class="dc-logo"><svg viewBox="0 0 24 26" fill="none"><path d="M3.2 25V11.4C3.2 6.6 12 1 12 1s8.8 5.6 8.8 10.4V25Z" stroke="currentColor" stroke-width="1.7"/><path d="M10 11.2 15.4 14.6 10 18Z" fill="currentColor"/></svg></div><div class="dc-brand-copy"><strong>DeenClipped</strong><span>AI clip workspace</span></div></div><div class="dc-nav-scroll"><div class="dc-nav-group"><div class="dc-nav-label"><span>Create</span><i></i></div>${CREATE_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group"><div class="dc-nav-label"><span>Publish</span><i></i></div>${PUBLISH_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group"><div class="dc-nav-label"><span>Studio</span><i></i></div>${STUDIO_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group"><div class="dc-nav-label"><span>Account</span><i></i></div>${ACCOUNT_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group" id="dcAdminNav" style="display:none"><div class="dc-nav-label"><span>Admin</span><i></i></div>${navButton('admin','Admin console','analytics')}</div></div><div class="dc-sidebar-bottom"><button class="dc-collapse" id="dcCollapse"><span class="dc-nav-icon">${ICON.collapse}</span><span>Collapse sidebar</span></button></div>`;

  const top = document.createElement('header'); top.id = 'dcTopbar';
  const appData = data() || {};
  const bill = appData.billing || {};
  const ownerFallback = bill?.current?.unlimited ? {name:'DeenClipped Admin', email:'Owner account'} : null;
  const signedUser = appData.user || appData.account || ownerFallback || {name:'Account', email:'Signed in'};
  const avatar = signedUser?.picture ? `<img src="${esc(signedUser.picture)}" alt="">` : `<span class="dc-user-avatar">${esc((signedUser?.name || signedUser?.email || 'D').slice(0,1).toUpperCase())}</span>`;
  top.innerHTML = `<button class="dc-mobile-menu dc-svg" id="dcMobileMenu" type="button" aria-label="Open menu">${ICON.menu}</button><div class="dc-page-title"><strong id="dcPageName">Home</strong><span id="dcPageSub">Everything important in one place</span></div><div class="dc-global-search">${ICON.search}<input id="dcGlobalSearch" placeholder="Search projects and clips"><div class="dc-search-results" id="dcSearchResults"></div></div><div class="dc-top-actions"><div class="dc-health" id="dcHealth"><i></i><span>Checking</span></div><button class="dc-token-pill" id="dcTokenPill" type="button" aria-label="Open tokens and plans">${ICON.tokens}<span class="dc-token-label">Tokens</span></button><button class="dc-btn secondary dc-tour-launch" id="dcTourLaunch" type="button">Demo</button><div class="dc-user-menu-wrap"><button class="dc-user-menu-button" id="dcUserMenuButton" type="button" aria-haspopup="menu" aria-expanded="false">${avatar}<span class="dc-user-copy"><b>${esc(signedUser.name || signedUser.email || 'Signed in')}</b><small>${esc(signedUser.email || 'Admin account')}</small></span><svg class="dc-user-chevron" viewBox="0 0 24 24"><path d="m7 10 5 5 5-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="dc-account-menu" id="dcAccountMenu" role="menu"><div class="dc-account-head"><strong>${esc(signedUser.name || 'DeenClipped account')}</strong><span>${esc(signedUser.email || 'Signed in')}</span></div><button class="dc-account-action" id="dcAccountBilling" type="button">Tokens & billing <b>Open</b></button><form class="dc-logout-form" method="post" action="/auth/logout"><button class="dc-logout-btn" type="submit">Log out</button></form></div></div><button class="dc-btn" id="dcNewProject"><span>＋ New</span></button></div>`;

  const work = document.createElement('div'); work.id = 'dcWork'; work.setAttribute('role','status'); work.setAttribute('aria-live','polite');
  work.innerHTML = `<span class="dc-work-toast-orb">${ICON.play}</span><div class="dc-work-toast-copy"><strong>Working…</strong><span>Saving changes</span></div><button id="dcWorkClose" type="button" aria-label="Hide progress notification">×</button><div class="dc-work-toast-progress"><i></i></div>`;
  const shade = document.createElement('button'); shade.id = 'dcShade'; shade.type='button'; shade.setAttribute('aria-label','Close menu');
  document.body.append(side, top, shade, work);

  const main = $('.main-col');
  if (main) {
    for (const name of ['home','projects','review','editor','publishing','templates','brand','lab','music','automation','insights','subscription','admin']) {
      if (!$(`#view-${name}`)) {
        const panel = document.createElement('section'); panel.id = `view-${name}`; panel.className = 'panel hide';
        main.prepend(panel);
      }
    }
  }

  bindGlobal();
}

function navButton(view, label, icon){
  return `<button class="dc-nav-button" type="button" data-dc-nav="${view}" title="${esc(label)}"><span class="dc-nav-icon">${ICON[icon]}</span><span class="dc-nav-name">${esc(label)}</span></button>`;
}

function bindGlobal(){
  document.addEventListener('click', handleProjectOpenCapture, true);
  document.addEventListener('click', handleClick);
  document.addEventListener('pointerdown', createRipple);
  $('#dcCollapse').onclick = () => {
    document.body.classList.toggle('dc-side-collapsed');
    localStorage.setItem('dc-side-collapsed', document.body.classList.contains('dc-side-collapsed') ? '1' : '0');
  };
  if (localStorage.getItem('dc-side-collapsed') === '1') document.body.classList.add('dc-side-collapsed');
  $('#dcMobileMenu').onclick = () => document.body.classList.add('dc-menu-open');
  $('#dcShade').onclick = () => document.body.classList.remove('dc-menu-open');
  $('#dcNewProject').onclick = () => { go('home'); setTimeout(() => $('#dcCreateUrl')?.focus(), 30); };
  $('#dcTourLaunch').onclick = () => openGuidedTour(0);
  $('#dcTokenPill').onclick = () => go('subscription');
  $('#dcUserMenuButton')?.addEventListener('click', event => {
    event.stopPropagation();
    const menu = $('#dcAccountMenu');
    const btn = $('#dcUserMenuButton');
    const open = !menu?.classList.contains('show');
    menu?.classList.toggle('show', open);
    btn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  $('#dcAccountBilling')?.addEventListener('click', () => { $('#dcAccountMenu')?.classList.remove('show'); $('#dcUserMenuButton')?.setAttribute('aria-expanded','false'); go('subscription'); });
  document.addEventListener('click', event => { if (!event.target.closest?.('.dc-user-menu-wrap')) { $('#dcAccountMenu')?.classList.remove('show'); $('#dcUserMenuButton')?.setAttribute('aria-expanded','false'); } });
  $('#dcWorkClose').onclick = () => { const el=$('#dcWork'); if(el){ el.dataset.dismissed='1'; el.dataset.dismissedKey = el.dataset.workKey || ''; el.classList.remove('show'); } };
  $('#dcGlobalSearch').addEventListener('input', renderGlobalSearch);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { document.body.classList.remove('dc-menu-open'); $('#dcSearchResults')?.classList.remove('show');if(currentView==='editor')selectEditorLayer('none'); }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoEditor() : undoEditor(); }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' && currentView === 'editor') { event.preventDefault(); saveEditorDraft(); }
    if (!typing && event.code === 'Space' && currentView === 'editor') { event.preventDefault(); togglePlayback(); }
    if (!typing && currentView==='editor' && /^Arrow/.test(event.key)) {
      event.preventDefault();
      if(event.shiftKey){const step=event.altKey?5:1;const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;nudgeEditorLayer(dx,dy)}
      else if(event.key==='ArrowLeft'||event.key==='ArrowRight')seekEditor(editor.currentTime+(event.key==='ArrowLeft'?-1:1));
    }
  });
  window.addEventListener('deen:api-start', onApiStart);
  window.addEventListener('deen:api-end', onApiEnd);
  window.addEventListener('deen:open-project', event => {
    const projectId=String(event.detail?.projectId||'');
    if(!projectId)return;
    hideLegacyProjectBrowser();
    selectedProjectId=projectId;
    go('projects');
  });
}

function hideLegacyProjectBrowser(){
  const legacy=$('#libraryBrowser');
  const wasOpen=Boolean(legacy&&!legacy.classList.contains('hide'));
  if(legacy)legacy.remove();
  try{
    if(typeof LIBRARY_PROJECT_ID!=='undefined')LIBRARY_PROJECT_ID='';
    if(typeof LIBRARY_SELECTED!=='undefined')LIBRARY_SELECTED.clear();
  }catch{}
  if(wasOpen&&!$('#dcBillingLayer')&&!$('#dcGuideLayer')&&!$('#videoModal:not(.hide)')&&!$('#rerenderModal:not(.hide)'))document.body.style.overflow='';
}

function handleProjectOpenCapture(event){
  if(!document.body.classList.contains('dc-app'))return;
  const target=event.target instanceof Element?event.target.closest('[data-open-project]'):null;
  if(!target)return;
  event.preventDefault();
  event.stopImmediatePropagation();
  hideLegacyProjectBrowser();
  selectedProjectId=target.dataset.openProject||'';
  if(selectedProjectId)go('projects');
}

function handleClick(event){
  const openBilling = event.target.closest('[data-open-billing]');
  if (openBilling) { openBillingModal(); return; }
  const publishTab = event.target.closest('[data-publish-tab]');
  if (publishTab) { publishingQueueTab = publishTab.dataset.publishTab || 'slots'; renderPublishingWorkspace(); return; }
  const slotRange = event.target.closest('[data-publish-slot-days]');
  if (slotRange) { publishingSlotDays = Math.max(1,Math.min(14,Number(slotRange.dataset.publishSlotDays)||5)); renderPublishingWorkspace(); return; }
  const nav = event.target.closest('[data-dc-nav]');
  if (nav) { go(nav.dataset.dcNav); document.body.classList.remove('dc-menu-open'); return; }
  const result = event.target.closest('[data-search-type]');
  if (result) {
    $('#dcSearchResults').classList.remove('show'); $('#dcGlobalSearch').value='';
    if (result.dataset.searchType === 'clip') openEditor(result.dataset.searchId);
    else if (result.dataset.searchType === 'project') { selectedProjectId = result.dataset.searchId; go('projects'); }
    else go(result.dataset.searchId);
    return;
  }
  const project = event.target.closest('[data-open-project]');
  if (project) { hideLegacyProjectBrowser(); selectedProjectId = project.dataset.openProject; go('projects'); return; }
  const reviewClip = event.target.closest('[data-review-clip]');
  if (reviewClip) { reviewFocusClipId=reviewClip.dataset.reviewClip||''; reviewFilter='all'; go('review'); return; }
  const editStyle = event.target.closest('[data-edit-style-clip]'); if (editStyle) { openEditor(editStyle.dataset.editStyleClip, 'style'); return; }
  const editVideo = event.target.closest('[data-edit-video-clip]'); if (editVideo) { openEditor(editVideo.dataset.editVideoClip, 'canvas'); return; }
  const edit = event.target.closest('[data-edit-clip]'); if (edit) { openEditor(edit.dataset.editClip, 'captions'); return; }
  const download = event.target.closest('[data-download-clip]'); if (download) { location.href = authedUrl(`/api/clips/${encodeURIComponent(download.dataset.downloadClip)}/download`); return; }
  const regenTitle = event.target.closest('[data-regenerate-title]'); if (regenTitle) { regenerateClipCopy(regenTitle.dataset.regenerateTitle); return; }
  const shorter = event.target.closest('[data-make-shorter]'); if (shorter) { adjustClipLength(shorter.dataset.makeShorter, 'shorter'); return; }
  const longer = event.target.closest('[data-make-longer]'); if (longer) { adjustClipLength(longer.dataset.makeLonger, 'longer'); return; }
  const schedule = event.target.closest('[data-schedule-clip]'); if (schedule) { scheduleClip(schedule.dataset.scheduleClip); return; }
  const approve = event.target.closest('[data-approve-clip]'); if (approve) { approveClip(approve.dataset.approveClip); return; }
  const post = event.target.closest('[data-post-clip]'); if (post) { postClip(post.dataset.postClip); return; }
  const openIssues = event.target.closest('[data-open-issues]'); if (openIssues) { openIssuesPanel(); return; }
  const discard = event.target.closest('[data-delete-clip]'); if (discard) { deleteClip(discard.dataset.deleteClip); return; }
  const retry = event.target.closest('[data-retry-project]'); if (retry) { retryProject(retry.dataset.retryProject); return; }
  const uploadFallback = event.target.closest('[data-upload-fallback]'); if (uploadFallback) { go('home'); requestAnimationFrame(()=>$('#dcVideoUpload')?.click()); return; }
  const more = event.target.closest('[data-more-project]'); if (more) { generateMore(more.dataset.moreProject); return; }
  const delProject = event.target.closest('[data-delete-project]'); if (delProject) { deleteProject(delProject.dataset.deleteProject); return; }
  const useTemplate = event.target.closest('[data-use-template]'); if (useTemplate) { selectStudioTemplate(useTemplate.dataset.useTemplate); return; }
  const applyTemplate = event.target.closest('[data-apply-template]'); if (applyTemplate) { applyStudioTemplate(applyTemplate.dataset.applyTemplate); return; }
  const duplicateTemplate = event.target.closest('[data-duplicate-template]'); if (duplicateTemplate) { duplicateStudioTemplate(duplicateTemplate.dataset.duplicateTemplate); return; }
  const deleteTemplate = event.target.closest('[data-delete-template]'); if (deleteTemplate) { deleteStudioTemplate(deleteTemplate.dataset.deleteTemplate); return; }
  const socialConnect = event.target.closest('[data-social-connect]'); if (socialConnect) { connectSocial(socialConnect.dataset.socialConnect); return; }
  const socialTest = event.target.closest('[data-social-test]'); if (socialTest) { testSocial(socialTest.dataset.socialTest); return; }
  const socialDisconnect = event.target.closest('[data-social-disconnect]'); if (socialDisconnect) { disconnectSocial(socialDisconnect.dataset.socialDisconnect); return; }
  const musicDelete = event.target.closest('[data-delete-track]'); if (musicDelete) { deleteTrack(musicDelete.dataset.deleteTrack); return; }
  const tool = event.target.closest('[data-editor-tool]'); if (tool) { editor.tool = tool.dataset.editorTool; renderEditorTool(); return; }
  const layer = event.target.closest('[data-select-layer]'); if (layer) { selectEditorLayer(layer.dataset.selectLayer); return; }
  const tab = event.target.closest('[data-caption-tab]'); if (tab) { editor.captionTab = tab.dataset.captionTab; renderEditorTool(); return; }
  const style = event.target.closest('[data-caption-style]'); if (style) { applyCaptionStyle(style.dataset.captionStyle); return; }
  const position = event.target.closest('[data-caption-position]'); if (position) { applyCaptionPosition(position.dataset.captionPosition); return; }
  const captionBlock = event.target.closest('[data-caption-start]'); if (captionBlock) { seekEditor(Number(captionBlock.dataset.captionStart)); return; }
  const frameRatio = event.target.closest('[data-frame-ratio]'); if (frameRatio) { const map={'9:16':[1080,1920],'16:9':[1920,1080]};[editor.draft.width,editor.draft.height]=map[frameRatio.dataset.frameRatio];markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();if(editor.draft.fitMode==='crop'&&editor.draft.smartFramingEnabled)requestFramingPlan(true);return; }
  const fillMode = event.target.closest('[data-fill-mode]'); if (fillMode) { editor.draft.fitMode=fillMode.dataset.fillMode;editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;if(editor.draft.fitMode!=='crop'){editor.framingPlan=null;editor.framingStatus='idle';editor.draft.smartFramingEnabled=false}markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();return; }
  const framingMode = event.target.closest('[data-framing-mode]'); if (framingMode) { editor.draft.smartFramingEnabled=framingMode.dataset.framingMode==='ai';editor.framingPlan=null;editor.framingStatus='idle';editor.framingMessage=editor.draft.smartFramingEnabled?'Ready to analyse the speaker':'Manual crop selected';markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();return; }
  const nudge = event.target.closest('[data-caption-nudge]'); if (nudge) { nudgeCaptionTiming(Number(nudge.dataset.captionNudge||0)); return; }
  if (!event.target.closest('.dc-global-search')) $('#dcSearchResults')?.classList.remove('show');
}

function onApiStart(event){
  const item = event.detail || {}; const method = String(item.method || 'GET').toUpperCase();
  if (method === 'GET') return;
  const el=$('#dcWork'); if(el){ delete el.dataset.dismissed; delete el.dataset.dismissedKey; }
  requestMap.set(item.id, item); paintWork();
}
function onApiEnd(event){
  const item = event.detail || {}; const method = String(item.method || 'GET').toUpperCase();
  if (method === 'GET') return;
  requestMap.delete(item.id); paintWork(); lastWriteAt = Date.now();
}
function workToastCopy(item){
  if(item?.source === 'job'){
    const progress = Number.isFinite(Number(item.progress)) ? ` · ${Math.round(Number(item.progress))}%` : '';
    const stage = shortText(item.stage || 'Working in the background', 44);
    if(item.kind === 'publish') return {title:'Publishing clip', detail:`${stage}${progress}`};
    if(item.kind === 'render') return {title:'Rendering clip', detail:`${stage}${progress}`};
    return {title:'Working now', detail:`${stage}${progress}`};
  }
  const url=String(item?.url||''), method=String(item?.method||'POST').toUpperCase();
  if(method==='DELETE')return{title:'Removing item',detail:'Cleaning this from your workspace.'};
  if(/video-uploads/.test(url))return{title:'Uploading source video',detail:'Sending your original file securely to the clip worker.'};
  if(/music/.test(url))return{title:'Updating nasheed audio',detail:'Saving your background audio settings.'};
  if(/templates\/apply-all|\/api\/template|\/api\/templates/.test(url))return{title:'Updating template',detail:'Applying the latest look to your clip workflow.'};
  if(/schedule-selected|scheduled|schedule/.test(url))return{title:'Scheduling clips',detail:'Preparing selected clips for the posting calendar.'};
  if(/publish/.test(url))return{title:'Starting publishing',detail:'Sending the clip to the selected platform.'};
  if(/rerender|render|export/.test(url))return{title:'Rendering clip',detail:'Building the final vertical video with captions and audio.'};
  if(/more-clips/.test(url))return{title:'Generating more clips',detail:'Finding extra moments from this lecture.'};
  if(/\/api\/videos|\/api\/projects/.test(url))return{title:'Uploading lecture',detail:'Starting download, transcription and clip generation.'};
  if(/\/api\/clips/.test(url))return{title:'Saving clip changes',detail:'Updating this clip and refreshing the workspace.'};
  return{title:'Saving changes',detail:'DeenClipped is updating your workspace.'};
}
function currentWorkItem(){
  const pending = [...requestMap.values()].at(-1);
  if (pending) return {...pending, source:'request', key:`request:${pending.id || pending.url || Date.now()}`};
  if (currentView === 'home') return null;
  const job = activeJobs()[0];
  if (!job) return null;
  return {...job, source:'job', key:`job:${job.kind}:${job.title}:${job.stage}:${job.at || ''}`};
}
function paintWork(){
  const el = $('#dcWork'); if (!el) return;
  const item = currentWorkItem();
  if (!item){ el.classList.remove('show'); delete el.dataset.dismissed; delete el.dataset.dismissedKey; return; }
  const key = item.key || `${item.source || 'work'}:${item.id || item.url || item.title || ''}`;
  if (el.dataset.workKey !== key){ el.dataset.workKey = key; delete el.dataset.dismissed; delete el.dataset.dismissedKey; }
  if (el.dataset.dismissed === '1' && el.dataset.dismissedKey === key){ el.classList.remove('show'); return; }
  const copy=workToastCopy(item);
  $('strong', el).textContent=copy.title;
  $('.dc-work-toast-copy span', el).textContent=copy.detail;
  el.classList.add('show');
}

function go(view){
  const changedView=currentView!==view;
  if(view!=='projects')document.body.classList.remove('dc-project-open');
  currentView = view;
  $$('[data-dc-nav]').forEach(b => b.classList.toggle('is-active', b.dataset.dcNav === view));
  const labels = {
    home:['Home','Everything important in one place'], projects:['Projects','Lectures and all generated clips'],
    review:['Clip Review','Approve AI clips before posting'], editor:['Editor','Edit the selected clip'],
    schedule:['Publishing','Post now, download, or schedule your clips'], insights:['Insights','Clip quality and studio signals'],
    publishing:['Channels','Connected publishing destinations'], templates:['Templates','Caption styles and reusable looks'], music:['Audio','Background tracks and audio level'],
    brand:['Brand Kit','Watermark, colours and visual identity'], lab:['Creator Lab','Content intelligence and growth opportunities'],
    automation:['Settings','Generation rules and studio controls'], subscription:['Subscription','Plan, tokens and payment details'],
    admin:['Admin','Subscriptions, storage, integrations and sign-ups']
  };
  $('#dcPageName').textContent = labels[view]?.[0] || view;
  $('#dcPageSub').textContent = labels[view]?.[1] || '';
  if(changedView)requestAnimationFrame(()=>window.scrollTo(0,0));

  if (CUSTOM.has(view)) {
    $$('.main-col > .panel').forEach(p => p.classList.add('hide'));
    $(`#view-${view}`)?.classList.remove('hide');
    if (view === 'admin') renderAdminPage();
    if (view === 'home') renderHome();
    if (view === 'projects') renderProjects();
    if (view === 'review') renderReview();
    if (view === 'editor') ensureEditor();
    if (view === 'schedule') renderPublishingWorkspace();
    if (view === 'publishing') renderConnections();
    if (view === 'templates') renderTemplatesPage();
    if (view === 'brand') renderBrandKit();
    if (view === 'lab') renderCreatorLab();
    if (view === 'music') renderAudioLibrary();
    if (view === 'insights') renderInsightsPage();
    if (view === 'automation') renderSettingsPage();
    if (view === 'subscription') renderSubscriptionPage();
  } else if (typeof showView === 'function') {
    showView(view);
  } else {
    $$('.main-col > .panel').forEach(p => p.classList.toggle('hide', p.id !== `view-${view}`));
  }
  lastDataSignature=structuralDataSignature(data());
  requestAnimationFrame(()=>animatePanel($(`#view-${view}`)));
  window.scrollTo({top:0, behavior:'auto'});
}

function activeJobs(){
  const d = data(); if (!d) return [];
  const jobs = [];
  (d.projects || []).forEach(p => {
    if (['queued','processing'].includes(p.status)) jobs.push({kind:'project', title:p.title || 'Lecture', stage:p.stage || p.status, progress:Number(p.progress || 0), at:p.startedAt || p.submittedAt});
    if (p.moreJob && ['queued','processing'].includes(p.moreJob.status)) jobs.push({kind:'project', title:`More clips · ${p.title || 'Lecture'}`, stage:p.moreJob.stage || p.moreJob.status, progress:Number(p.moreJob.progress || 0), at:p.moreJob.startedAt || p.moreJob.createdAt});
  });
  (d.rerenderJobs || []).forEach(j => {
    if (['queued','processing'].includes(j.status)) {
      const clip = (d.clips || []).find(c => c.id === j.clipId);
      jobs.push({kind:'render', title:`Editing ${clip?.title || 'clip'}`, stage:j.stage || j.status, progress:Number(j.progress || 0), at:j.startedAt || j.createdAt});
    }
  });
  (d.clips || []).forEach(c => (c.targets || []).forEach(t => {
    if (['retrying','publishing','processing'].includes(t.status)) jobs.push({kind:'publish', title:`${c.title || 'Clip'} → ${t.provider}`, stage:t.stage || t.status, progress:Number.isFinite(Number(t.progressPercent)) ? Number(t.progressPercent) : null, at:t.updatedAt});
  }));
  return jobs.sort((a,b)=>Number(b.at||0)-Number(a.at||0));
}

function renderHome(){
  const panel = $('#view-home'), d = data(); if (!panel || !d) return;
  document.body.classList.remove('dc-project-open');
  const clips = d.clips || [], projects = d.projects || [], jobs = activeJobs();
  const waiting = clips.filter(c=>c.status==='waiting').length;
  const scheduled = clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
  const posted = clips.filter(c=>c.status==='posted').length;
  const selectedTemplate = d.selectedTemplate?.name || d.templateDraft?.name || 'Choose template';
  const connected = connectedPlatformCount(d);
  const next = nextScheduledClip(clips);
  panel.innerHTML = `
    <div class="dc-home-v5">
      <section class="dc-v5-hero" data-tour="home-hero">
        <div class="dc-v5-hero-copy">
          <div class="dc-v5-eyebrow"><i></i> AI clip studio</div>
          <h1>One talk.<br>Your next month of content.</h1>
          <p>DeenClipped finds the strongest moments, builds clean vertical clips and prepares them for every channel—while you stay in control of what gets published.</p>
          <div class="dc-v5-hero-actions"><button class="dc-btn" id="dcHeroCreate">Start clipping</button>${waiting?`<button class="dc-btn secondary" data-dc-nav="review">Review ${waiting} ready</button>`:''}</div>
          <div class="dc-v5-inline-stats" aria-label="Workspace summary">${v5InlineStat(projects.length,'Sources')}${v5InlineStat(clips.length,'Clips')}${v5InlineStat(waiting,'To review')}${v5InlineStat(posted,'Published')}</div>
          ${v5BrandRail(d)}
        </div>
        <div class="dc-v5-stage" aria-label="Preview of vertical clips"><div class="dc-v5-stage-glow"></div>${v5HeroCards(clips)}</div>
      </section>

      <section class="dc-v5-create" data-tour="create-form">
        <div class="dc-v5-create-head"><div><h2>Create your clips</h2><p>Paste a supported video link or upload your original file.</p></div><span class="dc-v5-token-note">${uiIcon('tokens')} Token cost is confirmed before processing</span></div>
        <div class="dc-v5-url-row"><span class="dc-v5-url-brand">${socialSvg('youtube')}</span><input id="dcCreateUrl" placeholder="Paste a YouTube or video URL"><button class="dc-btn" id="dcGenerate" data-tour="generate-button">Generate clips</button></div>
        <div class="dc-v5-options">
          <label class="dc-v5-option"><span>Look</span><select id="dcCreateTemplate" data-tour="template-picker">${(d.templates||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===d.selectedTemplate?.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></label>
          <label class="dc-v5-option"><span>Clips</span><select id="dcCreateCount" aria-label="Number of clips"><option>4</option><option selected>8</option><option>12</option><option>16</option></select></label>
          <label class="dc-v5-option"><span>Length</span><select id="dcCreateDuration" aria-label="Clip duration"><option value="15,45">15–45 sec</option><option value="30,60" selected>30–60 sec</option><option value="45,90">45–90 sec</option></select></label>
          <button class="dc-btn secondary dc-v5-upload" id="dcPickVideo" type="button">${uiIcon('publish')} Upload original</button>
        </div>
        <input id="dcVideoUpload" type="file" accept="video/mp4,video/quicktime,video/x-m4v,video/webm,video/x-matroska" hidden>
      </section>

      ${v5HappeningNow(d,jobs,next,waiting,selectedTemplate)}

      <section class="dc-v5-lower">
        <div class="dc-v5-library"><div class="dc-v5-section-head"><div><h2>Your library</h2><p>Recent source videos and generated clips.</p></div><button class="dc-v5-text-link" data-dc-nav="projects">View all ${uiIcon('chevron')}</button></div>${v5ProjectLibrary(projects,clips)}</div>
        <aside class="dc-v5-side">${v5UpNext(d,jobs,next,waiting,selectedTemplate)}${v5Channels(d,connected)}</aside>
      </section>
    </div>`;
  $('#dcGenerate').onclick=generateProject;
  $('#dcPickVideo').onclick=()=>$('#dcVideoUpload').click();
  $('#dcVideoUpload').onchange=()=>prepareVideoUpload($('#dcVideoUpload').files?.[0]);
  $('#dcHeroCreate').onclick=()=>$('#dcCreateUrl').focus();
  lastDataSignature=structuralDataSignature(d);
  requestAnimationFrame(()=>animatePanel(panel));
}
function uiIcon(name){return `<span class="dc-ui-icon">${ICON[name]||ICON.sparkles}</span>`}
function v5InlineStat(value,label){return `<span class="dc-v5-inline-stat"><b>${esc(value)}</b><span>${esc(label)}</span></span>`}
function v5BrandRail(d){
  const providers=d.social?.providers||{};
  return `<div class="dc-v5-brands"><small>Ready for</small>${['youtube','tiktok','instagram','facebook'].map(key=>`<span class="dc-v5-brand ${key} ${providers[key]?.connected?'on':''}" title="${key}">${socialSvg(key)}</span>`).join('')}</div>`;
}
function v5HeroCards(clips){
  const recent=[...clips].filter(c=>c.thumbUrl).sort((a,b)=>Number(b.createdAt||b.renderedAt||0)-Number(a.createdAt||a.renderedAt||0)).slice(0,3);
  const fallback=[
    ['/marketing-assets/reel-dua.webp','Powerful reminder'],
    ['/marketing-assets/reel-deeds.webp','Strongest moment'],
    ['/marketing-assets/reel-quran.webp','Ready to publish']
  ];
  return fallback.map(([image,title],index)=>{const clip=recent[index],src=clip?.thumbUrl?authedUrl(clip.thumbUrl):image;return `<article class="dc-v5-phone"><img src="${src}" alt="${esc(clip?.title||title)} preview"><span class="dc-v5-score">${clip?Math.round(clip.score||0):[94,89,92][index]}</span><span class="dc-v5-phone-copy"><small>${clip?'AI selected':['Hook','Caption','Publish'][index]}</small><strong>${esc(shortText(clip?.title||title,38))}</strong></span></article>`}).join('');
}
/* Dismissed issues -------------------------------------------------------- */
const DISMISS_KEY='dc-dismissed-issues';
function dismissedIssues(){
  try{const raw=localStorage.getItem(DISMISS_KEY);const list=raw?JSON.parse(raw):[];return Array.isArray(list)?list:[]}catch{return []}
}
function issueKey(issue){return `${issue.kind}:${issue.id}:${issue.at||0}`}
function dismissIssue(key){
  try{const list=dismissedIssues();if(!list.includes(key)){list.push(key);localStorage.setItem(DISMISS_KEY,JSON.stringify(list.slice(-200)))}}catch{}
}
function clearDismissedIssues(){try{localStorage.removeItem(DISMISS_KEY)}catch{}}
/* Recent activity --------------------------------------------------------- */
function recentActivity(d,limit=14){
  const items=[];
  (d.projects||[]).forEach(p=>{
    const title=projectDisplayTitle(p);
    if(p.status==='done')items.push({tone:'good',text:`${title} finished · ${p.clipCount||0} clips`,at:p.completedAt||p.updatedAt});
    else if(p.status==='failed'||p.error)items.push({tone:'bad',text:`${title} failed`,at:p.updatedAt||p.completedAt});
    else if(['queued','processing'].includes(p.status))items.push({tone:'live',text:`${title} · ${p.stage||'processing'}`,at:p.updatedAt||p.startedAt||p.submittedAt});
  });
  (d.clips||[]).forEach(c=>{
    const title=shortText(c.title||'Clip',40);
    if(c.status==='posted')items.push({tone:'good',text:`Posted · ${title}`,at:c.postedAt||c.updatedAt});
    else if(c.status==='publish_failed')items.push({tone:'bad',text:`Publish failed · ${title}`,at:c.updatedAt});
    else if(c.status==='scheduled'&&c.scheduledAt)items.push({tone:'live',text:`Scheduled · ${title}`,at:c.scheduledAt});
  });
  return items.filter(i=>Number(i.at)).sort((a,b)=>Number(b.at||0)-Number(a.at||0)).slice(0,limit);
}
/* Issues + activity drawer ------------------------------------------------ */
function closeIssuesPanel(){const el=document.getElementById('dcIssuesPanel');if(el)el.remove()}
function openIssuesPanel(){
  const d=data();if(!d)return;
  closeIssuesPanel();
  const issues=workspaceFailures(d),activity=recentActivity(d);
  const wrap=document.createElement('div');
  wrap.id='dcIssuesPanel';
  wrap.setAttribute('style','position:fixed;inset:0;z-index:9000;display:flex;justify-content:flex-end;background:rgba(6,6,10,.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);');
  const issueRows=issues.length?issues.map(issue=>`<div style="display:flex;gap:12px;align-items:flex-start;padding:14px;border:1px solid rgba(255,255,255,.09);border-radius:14px;background:rgba(255,255,255,.035);margin-bottom:10px">
      <span style="width:8px;height:8px;border-radius:99px;background:#ff6b6b;margin-top:7px;flex:none"></span>
      <div style="flex:1;min-width:0">
        <strong style="display:block;font-size:13.5px;line-height:1.35">${esc(shortText(issue.title,70))}</strong>
        <span style="display:block;color:rgba(255,255,255,.62);font-size:12px;margin-top:3px">${esc(shortText(issue.detail,150))}</span>
        <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">${v5FailureAction(issue)}<button class="dc-btn secondary" data-dismiss-issue="${esc(issueKey(issue))}">Dismiss</button></div>
      </div></div>`).join(''):`<div style="padding:20px;text-align:center;color:rgba(255,255,255,.55);font-size:13px">Nothing needs attention.</div>`;
  const activityRows=activity.length?activity.map(a=>`<div style="display:flex;gap:10px;align-items:center;padding:9px 2px;border-bottom:1px solid rgba(255,255,255,.05)">
      <span style="width:6px;height:6px;border-radius:99px;flex:none;background:${a.tone==='bad'?'#ff6b6b':a.tone==='live'?'#f5c451':'#4ade80'}"></span>
      <span style="flex:1;min-width:0;font-size:12.5px;color:rgba(255,255,255,.85);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(a.text)}</span>
      <span style="font-size:11px;color:rgba(255,255,255,.4);flex:none">${esc(formatDate(a.at))}</span>
    </div>`).join(''):`<div style="padding:14px 2px;color:rgba(255,255,255,.45);font-size:12.5px">No recent activity yet.</div>`;
  wrap.innerHTML=`<aside style="width:min(430px,100%);height:100%;overflow:auto;background:rgba(18,18,24,.92);border-left:1px solid rgba(255,255,255,.10);padding:22px;box-shadow:-30px 0 60px rgba(0,0,0,.45)">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
      <strong style="font-size:16px;letter-spacing:-.01em">Issues & activity</strong>
      <button id="dcIssuesClose" class="dc-btn secondary" type="button" aria-label="Close">Close</button>
    </div>
    <div style="display:flex;align-items:center;justify-content:space-between;margin:0 0 10px">
      <span style="font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5)">Needs attention${issues.length?` · ${issues.length}`:''}</span>
      ${issues.length?`<button class="dc-btn secondary" id="dcDismissAll" type="button">Dismiss all</button>`:`<button class="dc-btn secondary" id="dcRestoreDismissed" type="button">Restore dismissed</button>`}
    </div>
    ${issueRows}
    <div style="margin:22px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5)">Recently</div>
    ${activityRows}
  </aside>`;
  document.body.appendChild(wrap);
  wrap.addEventListener('click',e=>{if(e.target===wrap)closeIssuesPanel()});
  const closeBtn=wrap.querySelector('#dcIssuesClose');if(closeBtn)closeBtn.onclick=closeIssuesPanel;
  const dismissAll=wrap.querySelector('#dcDismissAll');if(dismissAll)dismissAll.onclick=()=>{issues.forEach(i=>dismissIssue(issueKey(i)));openIssuesPanel();try{sync()}catch{}};
  const restore=wrap.querySelector('#dcRestoreDismissed');if(restore)restore.onclick=()=>{clearDismissedIssues();openIssuesPanel();try{sync()}catch{}};
  wrap.querySelectorAll('[data-dismiss-issue]').forEach(btn=>{btn.onclick=()=>{dismissIssue(btn.dataset.dismissIssue);openIssuesPanel();try{sync()}catch{}}});
}
function workspaceFailures(d){
  const issues=[];
  (d.projects||[]).forEach(p=>{
    if(p.status==='failed'||p.error)issues.push({kind:'project',id:p.id,title:`${projectDisplayTitle(p)} needs attention`,detail:shortError(p.error||p.stage||'Processing failed.'),at:p.updatedAt||p.completedAt||p.startedAt||p.submittedAt});
    if(p.moreJob?.status==='failed')issues.push({kind:'more',id:p.id,title:`More clips failed · ${projectDisplayTitle(p)}`,detail:shortError(p.moreJob.error||p.moreJob.stage||'Could not generate more clips.'),at:p.moreJob.updatedAt||p.moreJob.completedAt||p.moreJob.startedAt||p.moreJob.createdAt});
  });
  (d.rerenderJobs||[]).forEach(j=>{if(j.status==='failed'){const clip=(d.clips||[]).find(c=>c.id===j.clipId);issues.push({kind:'render',id:j.clipId,title:`Edit failed · ${clip?.title||'Clip'}`,detail:shortError(j.error||j.stage||'The edited clip could not be rendered.'),at:j.updatedAt||j.completedAt||j.startedAt||j.createdAt})}});
  (d.clips||[]).forEach(c=>{const failed=(c.targets||[]).filter(t=>t.status==='failed');if(c.status==='publish_failed'||failed.length){const target=failed[0];issues.push({kind:'publish',id:c.id,title:`Publish failed · ${c.title||'Clip'}`,detail:shortError(target?.error||target?.stage||c.error||'A connected channel rejected this upload.'),at:target?.updatedAt||c.updatedAt||c.postedAt||c.createdAt})}});
  const dismissed=dismissedIssues();
  return issues.filter(issue=>!dismissed.includes(issueKey(issue))).sort((a,b)=>Number(b.at||0)-Number(a.at||0));
}
function v5FailureAction(issue){
  if(issue.kind==='project')return `<button class="dc-btn danger" data-retry-project="${esc(issue.id)}">Retry</button>`;
  if(issue.kind==='more')return `<button class="dc-btn secondary" data-open-project="${esc(issue.id)}">Open project</button>`;
  if(issue.kind==='render')return `<button class="dc-btn secondary" data-edit-video-clip="${esc(issue.id)}">Open editor</button>`;
  return `<button class="dc-btn secondary" data-dc-nav="schedule">Open status</button>`;
}
function v5HappeningNow(d,jobs,next,waiting,templateName){
  const issues=workspaceFailures(d);
  // Live work always wins this slot. A failure from days ago must never hide
  // the job that is running right now; unresolved issues are surfaced as a
  // badge here and in full via the issues panel in the top bar.
  if(jobs.length){const job=jobs[0],progress=Number.isFinite(job.progress)?Math.round(job.progress):null;return `<section class="dc-v5-now" data-tour="happening-now" data-live-job="current"><span class="dc-v5-now-icon live">${uiIcon(job.kind==='publish'?'publish':job.kind==='render'?'editor':'sparkles')}</span><div class="dc-v5-now-copy"><small>Happening now</small><strong data-live-title>${esc(shortText(job.title,72))}</strong><span data-live-stage>${esc(shortText(job.stage||'Working now',90))}</span><div class="dc-v5-now-progress" data-live-progress-wrap ${progress===null?'hidden':''}><i data-live-progress style="width:${clamp(progress||0,0,100)}%"></i></div></div>${issues.length?`<button class="dc-pill bad" data-open-issues="1" title="Open issues">${issues.length} ${issues.length===1?'issue':'issues'}</button>`:''}<span class="dc-pill warn" data-live-percent>${progress!==null?`${progress}%`:'Live'}</span></section>`}
  if(issues.length){const issue=issues[0];return `<section class="dc-v5-now fail" data-tour="happening-now"><span class="dc-v5-now-icon fail">${uiIcon('warning')}</span><div class="dc-v5-now-copy"><small>Needs attention${issues.length>1?` · ${issues.length} issues`:''}</small><strong>${esc(shortText(issue.title,72))}</strong><span>${esc(shortText(issue.detail,110))}</span></div>${issues.length>1?`<button class="dc-btn secondary" data-open-issues="1">View all</button>`:''}${v5FailureAction(issue)}</section>`}
  if(waiting)return `<section class="dc-v5-now" data-tour="happening-now"><span class="dc-v5-now-icon">${uiIcon('review')}</span><div class="dc-v5-now-copy"><small>Happening now</small><strong>${waiting} ${waiting===1?'clip is':'clips are'} ready to review</strong><span>Choose the strongest moments before they enter the publishing queue.</span></div><button class="dc-btn secondary" data-dc-nav="review">Review clips</button></section>`;
  if(next)return `<section class="dc-v5-now" data-tour="happening-now"><span class="dc-v5-now-icon live">${uiIcon('clock')}</span><div class="dc-v5-now-copy"><small>Happening now</small><strong>${esc(shortText(next.title||'Your next clip',72))}</strong><span>Scheduled for ${esc(formatDate(next.scheduledAt))}</span></div><button class="dc-btn secondary" data-dc-nav="schedule">View schedule</button></section>`;
  return `<section class="dc-v5-now" data-tour="happening-now"><span class="dc-v5-now-icon live">${uiIcon('check')}</span><div class="dc-v5-now-copy"><small>Happening now</small><strong>Your studio is ready for the next source</strong><span>${esc(templateName)} is selected. Nothing is processing right now.</span></div><span class="dc-pill good">Ready</span></section>`;
}
function v5ProjectLibrary(projects,clips){
  const list=[...projects].sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0)).slice(0,3);
  if(!list.length)return `<div class="dc-v5-library-empty"><img src="/marketing-assets/library-premium.webp" alt="DeenClipped project library"><div class="dc-v5-library-empty-copy"><span>Your content library</span><h3>Every source and clip, organised.</h3><p>Your first project will appear here with its strongest clips, review state and publishing progress.</p></div></div>`;
  return `<div class="dc-v5-project-grid">${list.map(p=>{const own=clips.filter(c=>c.projectId===p.id),thumb=projectThumbUrl(p,clips),failed=p.status==='failed'||p.error,busy=['queued','processing'].includes(p.status);return `<button class="dc-v5-project" type="button" data-open-project="${esc(p.id)}"><span class="dc-v5-project-media">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(projectDisplayTitle(p))} thumbnail">`:uiIcon('projects')}<b class="dc-v5-project-status dc-pill ${failed?'bad':busy?'warn':'good'}">${failed?'Fix':busy?'Processing':'Ready'}</b></span><span class="dc-v5-project-copy"><strong>${esc(shortText(projectDisplayTitle(p),48))}</strong><small>${own.length} clips · ${own.filter(c=>['approved','scheduled','publishing','posted'].includes(c.status)).length} approved</small></span></button>`}).join('')}</div>`;
}
function v5UpNext(d,jobs,next,waiting,templateName){
  let body='';
  if(jobs.length){const j=jobs[0];body=`<div class="dc-v5-status-line" data-live-job="current">${uiIcon(j.kind==='publish'?'publish':'scissors')}<span data-live-summary>${esc(shortText(j.title,58))} · ${esc(shortText(j.stage||'Working now',50))}</span></div>`}
  else if(waiting)body=`<p>${waiting} ${waiting===1?'clip is':'clips are'} ready for your decision.</p><button class="dc-btn" data-dc-nav="review">Open review</button>`;
  else if(next)body=`<div class="dc-v5-next-main">${next.thumbUrl?`<img src="${authedUrl(next.thumbUrl)}" alt="${esc(next.title||'Scheduled clip')}">`:uiIcon('publish')}<div><strong>${esc(shortText(next.title||'Scheduled clip',46))}</strong><small>${esc(formatDate(next.scheduledAt))}</small></div></div><button class="dc-btn secondary" data-dc-nav="schedule">View schedule</button>`;
  else body=`<div class="dc-v5-status-line">${uiIcon('check')}<span>Workspace ready · ${esc(templateName)} selected</span></div>`;
  return `<section class="dc-v5-side-card"><div class="dc-v5-side-head">${uiIcon(jobs.length?'sparkles':next?'clock':waiting?'review':'check')}<strong>Up next</strong></div>${body}</section>`;
}
function v5Channels(d,connected){
  const providers=d.social?.providers||{};
  return `<section class="dc-v5-side-card"><div class="dc-v5-side-head">${uiIcon('social')}<strong>Publishing channels</strong></div><div class="dc-v5-channel-row">${['youtube','tiktok','instagram','facebook'].map(key=>`<span class="dc-v5-brand ${key} ${providers[key]?.connected?'on':''}">${socialSvg(key)}</span>`).join('')}</div><p>${connected?`${connected} connected. Approved clips can be prepared for publishing.`:'Connect a channel when you are ready to publish.'}</p><button class="dc-btn secondary" data-dc-nav="publishing">Manage channels</button></section>`;
}
function tinyStat(value,label){return `<span class="dc-tiny-stat"><b>${esc(value)}</b>${esc(label)}</span>`}
function v4Stat(value,label,tone=''){return `<div class="dc-v4-stat ${esc(tone)}"><b>${esc(value)}</b><span>${esc(label)}</span></div>`}
function heroPlatformRail(d){
  const providers=d.social?.providers||{};
  const names={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
  return `<div class="dc-v4-brand-rail"><span class="dc-v4-brand-label">Publish to</span>${Object.entries(names).map(([key,name])=>{const p=providers[key]||{};return `<span class="dc-v4-brand ${key} ${p.connected?'on':''}">${socialSvg(key)}<b>${name}</b><i></i></span>`}).join('')}</div>`;
}
function v4NextAction(d,jobs,next,waiting,templateName){
  if(jobs.length){const j=jobs[0];return `<div class="dc-v4-next"><span class="dc-v4-next-icon">${j.kind==='publish'?ICON.publish:j.kind==='render'?ICON.editor:ICON.scissors}</span><div><strong>${esc(shortText(j.title,62))}</strong><span>${esc(shortText(j.stage||'Working now',80))}</span></div><span class="dc-pill warn">${Number.isFinite(j.progress)?`${Math.round(j.progress)}%`:'Live'}</span></div>`}
  if(waiting)return `<div class="dc-v4-next"><span class="dc-v4-next-icon">${ICON.review}</span><div><strong>${waiting} ${waiting===1?'clip is':'clips are'} ready for your decision</strong><span>Approve the strong ones, then edit or schedule them.</span></div><button class="dc-btn" data-dc-nav="review">Review</button></div>`;
  if(next)return `<div class="dc-v4-next"><span class="dc-v4-next-icon good">${ICON.publish}</span><div><strong>${esc(shortText(next.title||'Scheduled clip',62))}</strong><span>Next delivery: ${esc(formatDate(next.scheduledAt))}</span></div><button class="dc-btn secondary" data-dc-nav="schedule">View</button></div>`;
  return `<div class="dc-v4-next"><span class="dc-v4-next-icon good">${ICON.scissors}</span><div><strong>Start with your next long-form video</strong><span>Current template: ${esc(templateName)}. You will see the token check before processing begins.</span></div><button class="dc-btn" id="dcV4Start">Create</button></div>`;
}
function v4ProjectRows(projects,clips){
  const list=[...projects].sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0)).slice(0,4);
  if(!list.length)return `<div class="dc-empty v3"><strong>Your workspace is ready</strong><span>Start a source above and your projects will live here.</span></div>`;
  return list.map(p=>{const own=clips.filter(c=>c.projectId===p.id),thumb=projectThumbUrl(p,clips),failed=p.status==='failed'||p.error,busy=['queued','processing'].includes(p.status);return `<button class="dc-v4-project" data-open-project="${esc(p.id)}" type="button">${thumb?`<img src="${authedUrl(thumb)}" alt="">`:`<span class="dc-v4-project-thumb">${ICON.projects}</span>`}<span><strong>${esc(shortText(projectDisplayTitle(p),58))}</strong><span>${own.length} clips · ${busy?'Processing':failed?'Needs attention':'Ready to continue'}</span></span><b class="dc-pill ${failed?'bad':busy?'warn':'good'}">${failed?'Fix':busy?'Live':'Ready'}</b>${ICON.chevron}</button>`}).join('');
}
function v4Readiness(d,connected,templateName){
  const readiness=[
    [Boolean(d.selectedTemplate?.id||d.templateDraft?.id),'Template',templateName,'templates'],
    [connected>0,'Channels',connected?`${connected} connected destination${connected===1?'':'s'}`:'Connect when you are ready to publish','publishing'],
    [Boolean((d.tracks||[]).length),'Audio',(d.tracks||[]).length?'Background audio ready':'Optional: add a nasheed track','music']
  ];
  return `<section class="dc-v4-readiness"><h2>Publishing readiness</h2><p>Nothing posts automatically without your approval.</p>${readiness.map(([on,title,copy,target])=>`<button class="dc-v4-check ${on?'on':''}" data-dc-nav="${target}" type="button"><i>${on?'✓':'+'}</i><span><strong>${title}</strong><span>${esc(copy)}</span></span><b class="dc-pill ${on?'good':'warn'}">${on?'Ready':'Set up'}</b></button>`).join('')}</section>`;
}
function v4QueueRows(clips){
  const list=clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt||Infinity)-Number(b.scheduledAt||Infinity)).slice(0,3);
  if(!list.length)return `<div class="dc-empty"><strong>No clips in the queue</strong>Approve your best clip to plan the next post.</div>`;
  return list.map(c=>`<button class="dc-v4-queue-row" data-edit-style-clip="${esc(c.id)}" type="button"><span>${ICON.publish}</span><span><strong>${esc(shortText(c.title||'Untitled clip',42))}</strong><em>${c.scheduledAt?esc(formatDate(c.scheduledAt)):'Ready to schedule'}</em></span><b class="dc-pill ${c.status==='publishing'?'warn':'good'}">${c.status==='publishing'?'Sending':'Ready'}</b></button>`).join('');
}
function flowCard(title,note,icon,target){
  const attr = target === 'dcSourceYouTube' ? 'id="dcSourceYouTube"' : `data-dc-nav="${esc(target)}"`;
  return `<button class="dc-flow-card-g" type="button" ${attr}><span>${icon}</span><strong>${esc(title)}</strong><em>${esc(note)}</em></button>`;
}

function youtubeThumbFromUrl(value){
  const text=String(value||'');
  const patterns=[/[?&]v=([^&#]+)/, /youtu\.be\/([^?&#/]+)/, /youtube\.com\/shorts\/([^?&#/]+)/, /youtube\.com\/embed\/([^?&#/]+)/];
  for(const pattern of patterns){
    const match=text.match(pattern);
    if(match?.[1]) return `https://i.ytimg.com/vi/${encodeURIComponent(match[1])}/hqdefault.jpg`;
  }
  return '';
}
function projectThumbUrl(p,clips=[]){
  return p?.sourceThumbUrl || p?.thumbnailUrl || p?.youtubeThumbnail || youtubeThumbFromUrl(p?.url) || (clips||[]).find(c=>c.projectId===p?.id&&c.thumbUrl)?.thumbUrl || '';
}
function sourceThumbnailFromInfo(info,url){
  return info?.thumbnail || youtubeThumbFromUrl(url) || '';
}
function liveFocusPanel(d,jobs,next,templateName){
  const latest=(d.log||[])[0];
  if(jobs.length){
    const j=jobs[0];
    return `<article class="dc-live-focus-g busy"><div class="dc-live-left"><span class="dc-live-icon">${j.kind==='publish'?ICON.publish:j.kind==='render'?ICON.editor:ICON.scissors}</span><div><small>Working now</small><h2>${esc(shortText(j.title,56))}</h2><p>${esc(shortText(j.stage,72))}</p>${Number.isFinite(j.progress)?`<div class="dc-work-progress"><i style="width:${clamp(j.progress,0,100)}%"></i></div>`:''}</div></div><span class="dc-pill warn">${Number.isFinite(j.progress)?`${Math.round(j.progress)}%`:'Live'}</span></article>`;
  }
  const message=latest?logItemMessage(latest):'Ready for the next lecture';
  return `<article class="dc-live-focus-g"><div class="dc-live-left"><span class="dc-live-icon good">${ICON.home}</span><div><small>Workspace ready</small><h2>${esc(shortText(message,58))}</h2><p>${latest?logItemTime(latest):`Template: ${templateName}`}</p></div></div><button class="dc-btn secondary" data-dc-nav="projects">Open projects</button></article>`;
}
function recentProjectsCinema(projects,clips){
  const list=[...projects].sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0)).slice(0,3);
  if(!list.length)return `<div class="dc-empty v3"><div><span class="dc-empty-icon">${ICON.projects}</span><strong>No projects yet</strong><span>Paste a lecture above to start.</span></div></div>`;
  return list.map(p=>{
    const own=clips.filter(c=>c.projectId===p.id), thumb=projectThumbUrl(p,clips), failed=p.status==='failed'||p.error, scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
    return `<button class="dc-cinema-project" type="button" data-open-project="${esc(p.id)}"><span class="dc-cinema-thumb ${thumb?'':'empty'}">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(projectDisplayTitle(p))} thumbnail">`:ICON.projects}</span><span class="dc-cinema-copy"><strong>${esc(shortText(projectDisplayTitle(p),46))}</strong><em>${own.length} clips · ${scheduled} scheduled</em></span><b class="dc-pill ${failed?'bad':p.status==='processing'?'warn':'good'}">${failed?'Fix':p.status==='processing'?'Live':'Ready'}</b></button>`;
  }).join('');
}
function nextPostDock(next){
  if(!next)return `<section class="dc-dock-card-g"><div class="dc-dock-head"><span>${ICON.publish}</span><b>Next post</b></div><p>No scheduled clip.</p><button class="dc-btn secondary" data-dc-nav="review">Open review</button></section>`;
  return `<section class="dc-dock-card-g next"><div class="dc-dock-head"><span>${ICON.publish}</span><b>Next post</b></div><div class="dc-dock-post">${next.thumbUrl?`<img src="${authedUrl(next.thumbUrl)}" alt="${esc(next.title||'Clip')} thumbnail">`:''}<strong>${esc(shortText(next.title||'Scheduled clip',42))}</strong><em>${formatDate(next.scheduledAt)}</em></div><button class="dc-btn secondary" data-edit-style-clip="${esc(next.id)}">Preview</button></section>`;
}
function platformDock(d){
  const providers=d.social?.providers||{};
  const items=['youtube','tiktok','instagram','facebook'].map(key=>{const p=providers[key]||{};return `<span class="dc-platform-dot ${key} ${p.connected?'on':p.configured?'ready':'off'}">${socialSvg(key)}</span>`}).join('');
  const connected=Object.values(providers).filter(p=>p.connected).length;
  return `<section class="dc-dock-card-g"><div class="dc-dock-head"><span>${ICON.social}</span><b>Platforms</b></div><div class="dc-platform-dots">${items}</div><p>${connected} connected. Finish setup before public posting.</p><button class="dc-btn secondary" data-dc-nav="publishing">Manage</button></section>`;
}
function attentionDock(d){
  const problems=[];
  (d.projects||[]).filter(p=>p.status==='failed'||p.error).slice(0,1).forEach(p=>problems.push(shortError(p.error||p.stage)));
  if(!d.readiness?.musicReady) problems.push('Nasheed library needs a track.');
  if(!problems.length) return `<section class="dc-dock-card-g"><div class="dc-dock-head"><span>${ICON.review}</span><b>Needs attention</b></div><p>Nothing important is blocking the workspace.</p></section>`;
  return `<section class="dc-dock-card-g warn"><div class="dc-dock-head"><span>!</span><b>Needs attention</b></div><p>${esc(shortText(problems[0],86))}</p><button class="dc-btn secondary" data-dc-nav="projects">Fix</button></section>`;
}
function workflowStep(iconName,title,note){return `<div class="dc-v3-step"><i>${ICON[iconName]||ICON.scissors}</i><strong>${esc(title)}</strong><span>${esc(note)}</span></div>`}
function heroThumbs(clips){
  const recent=[...clips].filter(c=>c.thumbUrl).sort((a,b)=>Number(b.createdAt||b.renderedAt||0)-Number(a.createdAt||a.renderedAt||0)).slice(0,4);
  const fallback=['Review captions','Smart crop','Modern template','Ready to post'];
  const cards=[];
  for(let i=0;i<4;i++){
    const clip=recent[i];
    cards.push(`<div class="dc-v3-phone">${clip?.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="${esc(clip.title||'Clip thumbnail')}">`:`<div class="dc-v3-phone-empty">${ICON.captions}</div>`}<div class="dc-v3-caption-demo">${clip?esc((clip.title||'Clean clip').split(/\s+/).slice(0,4).join(' ')):fallback[i]} <em>${i===1?'style':''}</em></div></div>`);
  }
  return cards.join('');
}
function socialSvg(key){const map={youtube:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>',tiktok:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.7 2c.4 3.2 2.2 5.1 5.3 5.3v3.6c-1.8.2-3.5-.4-5.2-1.5v6.8c0 8.6-9.4 11.3-13.2 5.1-2.5-4.1-1-11.3 7-11.6v3.8c-.6.1-1.2.2-1.7.4-1.6.5-2.5 2-2.2 3.7.6 3.2 6.3 4.1 5.8-2.1V2h4.2Z"/></svg>',instagram:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none"/></svg>',facebook:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.3-1.3 1.4-1.3H18V2.2c-.5-.1-2.1-.2-3.3-.2-3.2 0-5.2 1.9-5.2 5.3v1.2H6v3.7h3.5V22H14v-9.8h3.5l.6-3.7H14Z"/></svg>'};return map[key]||ICON.social}

function metric(value,label){ return `<div class="dc-metric"><strong>${value}</strong><span>${label}</span></div>`; }
function jobRow(j){ return `<div class="dc-now-row"><span class="dc-spinner"></span><div class="dc-now-main"><strong>${esc(shortText(j.title,58))}</strong><span>${esc(shortText(j.stage,48))}</span>${Number.isFinite(j.progress)?`<div class="dc-progress"><i style="width:${clamp(j.progress,0,100)}%"></i></div>`:''}</div><span class="dc-pill warn">${Number.isFinite(j.progress)?`${Math.round(j.progress)}%`:'Live'}</span></div>`; }
function shortText(value, limit=70){const text=String(value||'');return text.length>limit?`${text.slice(0,Math.max(0,limit-1)).trim()}…`:text}
function projectDisplayTitle(p){const raw=String(p?.title||'').trim();const url=String(p?.url||'').trim();if(p?.sourceTitle && (!raw || raw===url || /^https?:\/\//i.test(raw)))return p.sourceTitle;return raw || cleanUrlTitle(url) || 'Untitled lecture'}
function cleanUrlTitle(value){try{const u=new URL(String(value||''));return u.hostname.replace(/^www\./,'') + (u.searchParams.get('v')?` · ${u.searchParams.get('v')}`:'')}catch{return String(value||'').replace(/^https?:\/\//,'').slice(0,70)}}
function shortError(value){return String(value||'Processing issue').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,170)}
function clipThumb(c){return c?.thumbUrl ? `<img src="${authedUrl(c.thumbUrl)}" alt="${esc(c.title||'Clip')} thumbnail">` : `<div class="dc-project-placeholder">${ICON.play}<span>Clip</span></div>`}
function latestActivity(d){
  const logs = (d.log || []).slice(0,3);
  if (!logs.length) return `<div class="dc-empty"><strong>Idle</strong>No job is running right now.</div>`;
  return logs.map(item=>`<div class="dc-list-row"><div class="dc-social-logo">✓</div><div class="dc-list-copy"><strong>${esc(shortText(typeof item==='string'?item:item.message||item.text||'Activity',62))}</strong><span>${item.at?formatRelative(item.at):'Latest activity'}</span></div></div>`).join('');
}
function recentProjects(projects, clips){
  const list = [...projects].sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0)).slice(0,4);
  if (!list.length) return `<div class="dc-empty"><strong>No projects yet</strong>Generate clips from a lecture above.</div>`;
  return list.map(p=>{const own=clips.filter(c=>c.projectId===p.id);const thumb=own.find(c=>c.thumbUrl)?.thumbUrl;const failed=p.status==='failed'||p.error;return `<button class="dc-list-row" data-open-project="${esc(p.id)}" type="button">${thumb?`<img class="dc-thumb" src="${authedUrl(thumb)}">`:'<div class="dc-thumb"></div>'}<div class="dc-list-copy"><strong>${esc(shortText(projectDisplayTitle(p),58))}</strong><span>${own.length} clips · ${failed?'Needs retry':statusName(p.status)}</span></div><span class="dc-pill ${failed?'bad':p.status==='processing'?'warn':'good'}">${failed?'Issue':statusName(p.status)}</span></button>`}).join('');
}
function socialCards(d){
  const providers=d.social?.providers||{}, names={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
  return Object.entries(names).map(([key,name])=>{
    const p=providers[key]||{}, account=p.accounts?.[0]?.name;
    const status=p.connected?'Connected':p.configured?'Ready':'Missing';
    const copy=p.connected?esc(account||'Connected account'):p.configured?'Ready to connect':'Setup required';
    return `<div class="dc-social-card v3"><div class="dc-social-top"><div class="dc-social-logo ${key}">${socialSvg(key)}</div><div class="dc-social-copy"><strong>${name}</strong><span>${copy}</span></div><span class="dc-pill ${p.connected?'good':p.configured?'warn':'bad'}">${status}</span></div><button class="dc-btn ${p.connected?'secondary':''}" data-dc-nav="publishing" ${!p.configured?'disabled':''}>${p.connected?'Manage':'Connect'}</button></div>`;
  }).join('');
}
function attentionRows(d){
  const items=[];
  if(!d.readiness?.templateReady) items.push(['Choose template','Open editor look','editor']);
  if(!d.readiness?.musicReady) items.push(['Add nasheed','Audio library','music']);
  (d.projects||[]).filter(p=>p.status==='failed'||p.error).slice(0,2).forEach(p=>items.push([projectDisplayTitle(p),shortError(p.error||p.stage),'projects']));
  (d.clips||[]).filter(c=>c.status==='publish_failed').slice(0,2).forEach(c=>items.push([c.title||'Publishing failed','Open publish status','schedule']));
  if(!items.length) return `<div class="dc-empty"><strong>All good</strong>No blocker right now.</div>`;
  return items.slice(0,4).map(i=>`<button class="dc-list-row" data-dc-nav="${i[2]}" type="button"><div class="dc-social-logo">!</div><div class="dc-list-copy"><strong>${esc(shortText(i[0],44))}</strong><span>${esc(shortText(i[1],54))}</span></div><span class="dc-svg">${ICON.chevron}</span></button>`).join('');
}
function upcomingRows(clips){
  const list=clips.filter(c=>Number(c.scheduledAt)>Date.now()&&!['posted','ready'].includes(c.status)).sort((a,b)=>a.scheduledAt-b.scheduledAt).slice(0,3);
  if(!list.length) return `<div class="dc-empty"><strong>No clips scheduled</strong>Approve clips to fill this.</div>`;
  return list.map(c=>`<button class="dc-list-row" data-edit-style-clip="${esc(c.id)}" type="button"><img class="dc-thumb" src="${authedUrl(c.thumbUrl)}"><div class="dc-list-copy"><strong>${esc(shortText(c.title,46))}</strong><span>${formatDate(c.scheduledAt)} · ${(c.targets||[]).map(t=>t.provider).join(', ')||'Export'}</span></div><span class="dc-svg">${ICON.chevron}</span></button>`).join('');
}


function logItemMessage(item){
  if(typeof item==='string')return item;
  return item?.message || item?.text || item?.title || 'Latest activity';
}
function logItemTime(item){
  if(typeof item==='object' && item?.at)return formatRelative(item.at);
  return 'Latest';
}
function nextScheduledClip(clips){
  return clips.filter(c=>Number(c.scheduledAt)>Date.now()&&!['posted','ready'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt))[0];
}
function latestWorkflowCard(d,jobs){
  const latest=(d.log||[])[0];
  if(jobs.length){
    const job=jobs[0];
    return `<article class="dc-work-card live"><div class="dc-work-icon">${job.kind==='publish'?ICON.publish:job.kind==='render'?ICON.editor:ICON.scissors}</div><div class="dc-work-copy"><span class="dc-work-label">Live now</span><strong>${esc(shortText(job.title,48))}</strong><p>${esc(shortText(job.stage,60))}</p>${Number.isFinite(job.progress)?`<div class="dc-work-progress"><i style="width:${clamp(job.progress,0,100)}%"></i></div>`:''}</div><span class="dc-pill warn">${Number.isFinite(job.progress)?`${Math.round(job.progress)}%`:'Live'}</span></article>`;
  }
  return `<article class="dc-work-card"><div class="dc-work-icon good">${ICON.home}</div><div class="dc-work-copy"><span class="dc-work-label">Latest result</span><strong>${esc(shortText(logItemMessage(latest)||'All clear',58))}</strong><p>${latest?logItemTime(latest):'Nothing is processing right now.'}</p></div><span class="dc-pill good">Ready</span></article>`;
}
function nextPostCard(clips){
  const next=nextScheduledClip(clips);
  if(!next)return `<article class="dc-work-card"><div class="dc-work-icon">${ICON.publish}</div><div class="dc-work-copy"><span class="dc-work-label">Next post</span><strong>No scheduled post</strong><p>Approve clips to fill the calendar.</p></div><button class="dc-btn secondary" data-dc-nav="review">Review</button></article>`;
  return `<article class="dc-work-card visual"><div class="dc-work-thumb">${next.thumbUrl?`<img src="${authedUrl(next.thumbUrl)}" alt="${esc(next.title||'Clip')} thumbnail">`:ICON.play}</div><div class="dc-work-copy"><span class="dc-work-label">Next post</span><strong>${esc(shortText(next.title||'Scheduled clip',46))}</strong><p>${formatDate(next.scheduledAt)} · ${(next.targets||[]).map(t=>t.provider).join(', ')||'Export'}</p></div><button class="dc-btn secondary" data-edit-style-clip="${esc(next.id)}">Preview</button></article>`;
}
function templateLiveCard(name){
  return `<article class="dc-work-card"><div class="dc-work-icon template">${ICON.style}</div><div class="dc-work-copy"><span class="dc-work-label">Template live</span><strong>${esc(name)}</strong><p>Used for new clips and global re-renders.</p></div><button class="dc-btn secondary" data-dc-nav="editor">Edit</button></article>`;
}
function recentProjectsV3(projects,clips){
  const list=[...projects].sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0)).slice(0,4);
  if(!list.length)return `<div class="dc-empty v3"><div><span class="dc-empty-icon">${ICON.projects}</span><strong>No lectures yet</strong><span>Paste a lecture above to create the first project.</span></div></div>`;
  return list.map(p=>{
    const own=clips.filter(c=>c.projectId===p.id),thumb=projectThumbUrl(p,clips),failed=p.status==='failed'||p.error,busy=['queued','processing'].includes(p.status),scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
    return `<button class="dc-feature-row" data-open-project="${esc(p.id)}" type="button"><span class="dc-feature-thumb ${thumb?'':'empty'}">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(projectDisplayTitle(p))} thumbnail">`:ICON.projects}</span><span class="dc-feature-main"><strong>${esc(shortText(projectDisplayTitle(p),64))}</strong><em>${own.length} clips · ${scheduled} scheduled</em></span><span class="dc-pill ${failed?'bad':busy?'warn':'good'}">${failed?'Issue':busy?'Working':'Ready'}</span>${ICON.chevron}</button>`;
  }).join('');
}
function compactActivityFeed(d,jobs){
  const logs=(d.log||[]).slice(0,4);
  const rows=jobs.length?jobs.slice(0,3).map(j=>`<div class="dc-activity-chip live"><span>${j.kind==='publish'?ICON.publish:j.kind==='render'?ICON.editor:ICON.scissors}</span><strong>${esc(shortText(j.title,42))}</strong><em>${esc(shortText(j.stage,32))}</em></div>`).join(''):logs.length?logs.map(item=>`<div class="dc-activity-chip"><span>✓</span><strong>${esc(shortText(logItemMessage(item),42))}</strong><em>${logItemTime(item)}</em></div>`).join(''):`<div class="dc-empty"><strong>All quiet</strong>No current processing.</div>`;
  return `<section class="dc-card dc-card-pad v3-card dc-dashboard-panel compact"><div class="dc-card-head"><div><h2>Activity</h2><p>Latest only.</p></div><span class="dc-pill ${jobs.length?'warn':'good'}">${jobs.length?'Live':'Clear'}</span></div><div class="dc-activity-grid">${rows}</div></section>`;
}
function platformPanelV3(d){
  return `<section class="dc-card dc-card-pad v3-card dc-dashboard-panel" data-tour="platform-cards"><div class="dc-card-head"><div><h2>Platform connections</h2><p>Connect before publishing.</p></div><button class="dc-btn secondary" data-dc-nav="publishing">Manage</button></div><div class="dc-platform-panel-grid">${platformTilesV3(d)}</div></section>`;
}
function platformTilesV3(d){
  const providers=d.social?.providers||{}, names={youtube:'YouTube',tiktok:'TikTok',instagram:'Instagram',facebook:'Facebook'};
  return Object.entries(names).map(([key,name])=>{
    const p=providers[key]||{}, account=p.accounts?.[0]?.name;
    const status=p.connected?'Connected':p.configured?'Ready':'Missing';
    return `<button class="dc-platform-tile ${key}" data-dc-nav="publishing" ${!p.configured && !p.connected?'aria-disabled="true"':''}><span class="dc-social-logo ${key}">${socialSvg(key)}</span><strong>${name}</strong><em>${p.connected?esc(account||'Connected'):p.configured?'Ready to connect':'Setup required'}</em><b class="dc-pill ${p.connected?'good':p.configured?'warn':'bad'}">${status}</b></button>`;
  }).join('');
}
function upcomingPanelV3(clips){
  const next=clips.filter(c=>Number(c.scheduledAt)>Date.now()&&!['posted','ready'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt)).slice(0,3);
  const rows=next.length?next.map(c=>`<button class="dc-mini-post" data-edit-style-clip="${esc(c.id)}" type="button">${c.thumbUrl?`<img src="${authedUrl(c.thumbUrl)}" alt="${esc(c.title||'Clip')} thumbnail">`:`<span>${ICON.play}</span>`}<strong>${esc(shortText(c.title||'Scheduled clip',46))}</strong><em>${formatDate(c.scheduledAt)}</em>${ICON.chevron}</button>`).join(''):`<div class="dc-empty"><strong>No scheduled clips</strong>Approve clips from Clip Review.</div>`;
  return `<section class="dc-card dc-card-pad v3-card dc-dashboard-panel"><div class="dc-card-head"><div><h2>Upcoming posts</h2><p>${next.length} ready or scheduled.</p></div><button class="dc-btn secondary" data-dc-nav="schedule">Open publish</button></div><div class="dc-mini-post-list">${rows}</div></section>`;
}

function splitVideoLinks(value=''){
  return String(value||'').split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
}
async function fetchTokenEstimate(minutes){
  try{return await callApi('/api/billing/estimate',{method:'POST',body:JSON.stringify({minutes})});}
  catch(e){
    const bill=billingInfo(); const rate=Number(bill.tokenRatePerMinute||1);
    return {estimatedMinutes:Math.max(1,Math.ceil(Number(minutes||0))),estimatedTokens:Math.max(1,Math.ceil(Math.max(1,Number(minutes||0))*rate)),rate,unlimited:bill.current?.unlimited,remaining:bill.current?.remaining,enough:true,terms:bill.terms||[]};
  }
}
async function fetchSourceInfo(urls){
  try{
    const result=await callApi('/api/source-info',{method:'POST',body:JSON.stringify({urls})});
    return result;
  }catch(e){
    const links=splitVideoLinks(urls);
    return {ok:false,error:e.message,sources:links.map(url=>({url,error:e.message,durationSec:null,thumbnail:youtubeThumbFromUrl(url),title:url})),known:false};
  }
}
function clockFromSeconds(value){
  const total=Math.max(0,Math.round(Number(value||0)));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
  return h?`${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${m}:${String(sec).padStart(2,'0')}`;
}
function minutesFromSeconds(value){return Math.max(0,Number(value||0)/60)}
function clockFromMinutes(value){
  const total=Math.max(0,Math.round(Number(value||0)*60));
  const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),sec=total%60;
  if(h) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  return `${m}:${String(sec).padStart(2,'0')}`;
}
function openTokenEstimateModal({urls,onConfirm,sourceInfoOverride=null}){
  $('#dcChargeLayer')?.remove();
  const bill=billingInfo(),rate=Number(bill.tokenRatePerMinute||1),links=splitVideoLinks(urls);
  // No invented duration. Everything here — the range slider, the token
  // estimate — is only meaningful against a real length, so this starts at
  // zero and stays there until a lookup verifies it or the person enters it
  // by hand. Seeding a guess is what previously let an unverified number be
  // shown and charged against as though it were fact.
  const fallbackSec=0;
  const currentTemplate=$('#dcCreateTemplate')?.value || data()?.selectedTemplate?.id || '';
  const currentCount=$('#dcCreateCount')?.value || '8';
  const currentDuration=$('#dcCreateDuration')?.value || '30,60';
  const templateOptions=(data()?.templates||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===currentTemplate?'selected':''}>${esc(t.name)}</option>`).join('');
  const layer=document.createElement('div'); layer.id='dcChargeLayer'; layer.className='dc-charge-layer dc-source-range-layer';
  layer.innerHTML=`<section class="dc-source-range-card" role="dialog" aria-modal="true" aria-labelledby="dcChargeTitle">
    <div class="dc-source-range-head">
      <div><span>${ICON.tokens} Token check</span><h2 id="dcChargeTitle">Choose the source window.</h2><p>DeenClipped reads the video length first. Full video is selected by default; trim the processing window to save tokens before rendering.</p></div>
      <button class="dc-charge-close" id="dcChargeClose" type="button" aria-label="Close">×</button>
    </div>
    <div class="dc-source-range-body">
      <div class="dc-source-preview-card" id="dcSourcePreviewCard">
        <div class="dc-source-thumb loading" id="dcSourceThumb">${ICON.play}</div>
        <div class="dc-source-preview-copy"><small id="dcSourceState">Reading source</small><strong id="dcSourceTitle">Checking video duration…</strong><span id="dcSourceSub">Full range will appear here once the source is checked.</span></div>
        <b class="dc-source-duration" id="dcSourceDuration">--:--</b>
      </div>
      <div class="dc-source-manual" id="dcSourceManual" hidden>
        <div><strong>Duration could not be verified</strong><span>Enter the full video length so token estimates are not guessed.</span></div>
        <div class="dc-source-why" id="dcSourceWhy" hidden></div>
        <label><span>Minutes</span><input id="dcManualDurationMin" type="number" min="1" step="0.1" value="20"></label>
      </div>
      <div class="dc-processing-card">
        <div class="dc-processing-head"><div><strong>Processing timeframe</strong><span>Move the handles to choose exactly what part DeenClipped should analyse.</span></div><em id="dcCreditSaver">Full video selected</em></div>
        <div class="dc-dual-range" id="dcDualRange"><div class="dc-dual-track"><i id="dcRangeFill"></i></div><input id="dcRangeStart" type="range" min="0" max="${fallbackSec}" step="1" value="0" aria-label="Start time"><input id="dcRangeEnd" type="range" min="1" max="${fallbackSec}" step="1" value="${fallbackSec}" aria-label="End time"></div>
        <div class="dc-time-boxes"><label>Start<b id="dcStartReadout">0:00</b></label><label>End<b id="dcEndReadout">20:00</b></label><label>Selected<b id="dcSelectedReadout">20:00</b></label></div>
      </div>
      <div class="dc-import-options-card">
        <label>Template<select id="dcChargeTemplate">${templateOptions}</select></label>
        <label>Clips<select id="dcChargeCount"><option ${currentCount==='4'?'selected':''}>4</option><option ${currentCount==='8'?'selected':''}>8</option><option ${currentCount==='12'?'selected':''}>12</option><option ${currentCount==='16'?'selected':''}>16</option></select></label>
        <label>Clip length<select id="dcChargeDuration"><option value="15,45" ${currentDuration==='15,45'?'selected':''}>15–45 sec</option><option value="30,60" ${currentDuration==='30,60'?'selected':''}>30–60 sec</option><option value="45,90" ${currentDuration==='45,90'?'selected':''}>45–90 sec</option></select></label>
      </div>
      <div class="dc-token-result-card">
        <div><small>Estimated charge</small><strong id="dcEstimateTokens">…</strong><span id="dcEstimateSub">tokens after exact duration is confirmed</span></div>
        <p id="dcChargeBalance">Checking your token balance…</p>
      </div>
      <div class="dc-source-range-actions"><button class="dc-btn" id="dcConfirmCharge" type="button" disabled>Reading video…</button><button class="dc-btn secondary" id="dcOpenBillingFromCharge" type="button">View plans</button></div>
      <p class="dc-source-note">Tokens are based on selected source minutes, not output clip count. Template rerenders and style fixes stay free.</p>
    </div>
  </section>`;
  document.body.append(layer);
  const close=()=>layer.remove();
  $('#dcChargeClose').onclick=close; layer.addEventListener('click',event=>{if(event.target===layer)close()});
  const startInput=$('#dcRangeStart',layer),endInput=$('#dcRangeEnd',layer),fill=$('#dcRangeFill',layer);
  const startRead=$('#dcStartReadout',layer),endRead=$('#dcEndReadout',layer),selectedRead=$('#dcSelectedReadout',layer),creditSaver=$('#dcCreditSaver',layer);
  const tokensEl=$('#dcEstimateTokens',layer),subEl=$('#dcEstimateSub',layer),balanceEl=$('#dcChargeBalance',layer),confirm=$('#dcConfirmCharge',layer);
  const manualBox=$('#dcSourceManual',layer),manualInput=$('#dcManualDurationMin',layer);
  let sourceInfo={sources:links.map(url=>({url,durationSec:null,durationKnown:false,title:url,thumbnail:youtubeThumbFromUrl(url)})),known:false};
  let maxSec=fallbackSec, durationVerified=false, latest={enough:true}, selectedSeconds=fallbackSec*links.length, sourceStartSeconds=0, sourceEndSeconds=fallbackSec;
  const knownDurations=()=>sourceInfo.sources.map(src=>Number(src.durationSec)).filter(v=>Number.isFinite(v)&&v>0);
  const durations=()=>sourceInfo.sources.map(src=>Number(src.durationSec)>0?Number(src.durationSec):maxSec).filter(v=>v>0);
  const selectedTotalSeconds=(start,end)=>durations().reduce((sum,dur)=>sum+Math.max(0,Math.min(end,dur)-Math.min(start,dur)),0);
  const applyMaxSeconds=(seconds,{keepRange=false}={})=>{
    maxSec=Math.max(60,Math.round(Number(seconds)||fallbackSec));
    startInput.max=String(Math.max(0,maxSec-1)); endInput.max=String(maxSec);
    if(!keepRange){startInput.value='0'; endInput.value=String(maxSec)}
    else {startInput.value=String(Math.min(Number(startInput.value||0),Math.max(0,maxSec-1))); endInput.value=String(Math.min(Math.max(Number(endInput.value||maxSec),1),maxSec));}
  };
  const setSourceVisual=()=>{
    const first=sourceInfo.sources?.[0]||{};
    const thumb=sourceThumbnailFromInfo(first,links[0]);
    const thumbEl=$('#dcSourceThumb',layer); thumbEl.classList.remove('loading');
    thumbEl.innerHTML=thumb?`<img src="${esc(thumb)}" alt="Source thumbnail">`:ICON.play;
    $('#dcSourceTitle',layer).textContent=first.title||links[0]||'Source video';
    const loaded=durationVerified&&knownDurations().length===links.length;
    $('#dcSourceState',layer).textContent=loaded?'Duration loaded':'Duration needs check';
    $('#dcSourceSub',layer).textContent=loaded?`${links.length} source${links.length===1?'':'s'} · real video length loaded`:`${links.length} source${links.length===1?'':'s'} · enter duration if the server could not read it`;
    $('#dcSourceDuration',layer).textContent=loaded?clockFromSeconds(maxSec):'Manual';
    if(manualBox) manualBox.hidden=loaded;
    // Surface why the lookup failed. The backend already records this per
    // source; without showing it, a fixable cause like a missing API key
    // looks exactly the same as an unfixable one.
    const whyBox=$('#dcSourceWhy',layer);
    if(whyBox){
      const reasons=[...new Set((sourceInfo?.sources||[])
        .map(s=>String(s?.warning||s?.error||'').trim())
        .filter(Boolean)
        .flatMap(text=>text.split(' | ')))].filter(Boolean);
      if(!loaded&&reasons.length){
        whyBox.hidden=false;
        whyBox.innerHTML=`<strong>Why:</strong> ${reasons.map(r=>esc(r)).join('<br>')}`;
      }else whyBox.hidden=true;
    }
  };
  const readRange=()=>{
    let start=Math.max(0,Math.min(maxSec-1,Number(startInput.value||0)));
    let end=Math.max(start+1,Math.min(maxSec,Number(endInput.value||maxSec)));
    if(start>=end) start=Math.max(0,end-1);
    startInput.value=String(Math.round(start)); endInput.value=String(Math.round(end));
    sourceStartSeconds=Math.round(start); sourceEndSeconds=Math.round(end); selectedSeconds=selectedTotalSeconds(sourceStartSeconds,sourceEndSeconds);
    return {start:sourceStartSeconds,end:sourceEndSeconds,total:selectedSeconds};
  };
  const updateVisual=(range)=>{
    const left=(range.start/maxSec)*100, width=Math.max(.5,((range.end-range.start)/maxSec)*100);
    fill.style.left=`${left}%`; fill.style.width=`${width}%`;
    startRead.textContent=clockFromSeconds(range.start); endRead.textContent=clockFromSeconds(range.end); selectedRead.textContent=clockFromSeconds(range.end-range.start);
    const full=Math.abs(range.start)<1 && Math.abs(range.end-maxSec)<2;
    creditSaver.textContent=full?'Full video selected':'Credit saver range'; creditSaver.classList.toggle('good',!full);
  };
  const update=async()=>{
    const range=readRange(); updateVisual(range);
    const minutes=Math.max(1/60,minutesFromSeconds(range.total));
    latest=await fetchTokenEstimate(minutes);
    const estimate=latest.unlimited?'∞':String(latest.estimatedTokens||Math.ceil(minutes*rate));
    tokensEl.textContent=estimate;
    subEl.textContent=latest.unlimited?'admin account':`${clockFromSeconds(range.total)} selected source time`;
    const remaining=latest.unlimited?'Unlimited tokens':`${Math.max(0,Math.round(Number(latest.remaining||0)))} tokens left`;
    const enough=latest.enough||latest.unlimited;
    balanceEl.classList.toggle('warn',!enough);
    balanceEl.textContent=enough?`${remaining}. Ready to process selected range.`:`${remaining}. Shorten the range or upgrade before rendering.`;
    confirm.disabled=false; confirm.textContent=enough?'Create clips from selected range':'Upgrade to continue';
  };
  const scheduleUpdate=()=>{clearTimeout(layer._timer);layer._timer=setTimeout(update,80)};
  [startInput,endInput].forEach(el=>el.addEventListener('input',scheduleUpdate));
  manualInput?.addEventListener('input',()=>{
    const minutes=Math.max(1,Number(manualInput.value||20));
    applyMaxSeconds(minutes*60,{keepRange:false});
    setSourceVisual(); update();
  });
  $('#dcOpenBillingFromCharge').onclick=()=>{close();openBillingModal();};
  $('#dcChargeTemplate').onchange=e=>{const t=$('#dcCreateTemplate'); if(t)t.value=e.target.value};
  $('#dcChargeCount').onchange=e=>{const t=$('#dcCreateCount'); if(t)t.value=e.target.value};
  $('#dcChargeDuration').onchange=e=>{const t=$('#dcCreateDuration'); if(t)t.value=e.target.value};
  confirm.onclick=async()=>{
    if(!latest.enough&&!latest.unlimited){close();openBillingModal();return;}
    confirm.disabled=true; confirm.textContent='Queueing…';
    try{
      await onConfirm({sourceStartSeconds,sourceEndSeconds,estimatedMinutes:minutesFromSeconds(selectedSeconds),sourceMeta:sourceInfo.sources});
      close();
    } catch(e){notify(e.message,'bad');confirm.disabled=false;confirm.textContent='Try again';}
  };
  (sourceInfoOverride?Promise.resolve(sourceInfoOverride):fetchSourceInfo(urls)).then(info=>{
    sourceInfo=info||sourceInfo;
    const realDurations=knownDurations();
    durationVerified=Boolean(sourceInfo.known)&&realDurations.length===links.length;
    if(durationVerified) applyMaxSeconds(Math.max(...realDurations.map(v=>Math.round(v))),{keepRange:false});
    else {
      const fallbackMinutes=Math.max(1,Number(manualInput?.value||20));
      applyMaxSeconds(fallbackMinutes*60,{keepRange:false});
      const warning=(sourceInfo.sources||[]).map(src=>src.warning||src.error).filter(Boolean)[0];
      if(warning) console.warn('Source duration was not verified:', warning);
    }
    setSourceVisual(); update();
  }).catch(error=>{
    durationVerified=false;
    applyMaxSeconds(Math.max(1,Number(manualInput?.value||20))*60,{keepRange:false});
    console.warn('Source info failed:', error);
    setSourceVisual();update();
  });
}
async function queueProjectImport(url,button,range={}){
  const [min,max]=$('#dcCreateDuration').value.split(',').map(Number);
  button.disabled=true; button.textContent='Queueing…';
  try{
    await callApi('/api/template',{method:'POST',body:JSON.stringify({id:$('#dcCreateTemplate').value})});
    await callApi('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcCreateCount').value),clipMinSeconds:min,clipMaxSeconds:max})});
    const payload={urls:url,sourceStartSeconds:Math.max(0,Math.round(Number(range.sourceStartSeconds||0)))};
    if(Number.isFinite(Number(range.sourceEndSeconds))&&Number(range.sourceEndSeconds)>payload.sourceStartSeconds) payload.sourceEndSeconds=Math.round(Number(range.sourceEndSeconds));
    if(Array.isArray(range.sourceMeta)) payload.sourceMeta=range.sourceMeta;
    const result=await callApi('/api/videos',{method:'POST',body:JSON.stringify(payload)});
    const failed=(result.results||[]).filter(x=>!x.ok).length;
    notify(failed?`${result.results.length-failed} queued, ${failed} failed`:'Lecture queued — watch Working now',failed?'bad':'good');
    $('#dcCreateUrl').value=''; await refreshData(); renderHome();
  }finally{button.disabled=false;button.textContent='Generate clips'}
}
async function generateProject(){
  const url=$('#dcCreateUrl')?.value.trim(), button=$('#dcGenerate'); if(!url) return notify('Paste a video link first','bad');
  openTokenEstimateModal({urls:url,onConfirm:(range)=>queueProjectImport(url,button,range)});
}

function videoDuration(file){
  return new Promise((resolve,reject)=>{
    const video=document.createElement('video'),url=URL.createObjectURL(file);
    video.preload='metadata';
    video.onloadedmetadata=()=>{const duration=Number(video.duration);URL.revokeObjectURL(url);Number.isFinite(duration)&&duration>0?resolve(duration):reject(new Error('Could not read the video duration.'))};
    video.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read this video file.'))};
    video.src=url;
  });
}

async function prepareVideoUpload(file){
  if(!file)return;
  if(file.size>2*1024*1024*1024){$('#dcVideoUpload').value='';return notify('Choose a video smaller than 2 GB.','bad')}
  const button=$('#dcPickVideo');button.disabled=true;button.textContent='Reading…';
  try{
    const durationSec=Math.round(await videoDuration(file));
    const sourceInfo={ok:true,known:true,totalDurationSec:durationSec,sources:[{url:file.name,title:file.name.replace(/\.[^.]+$/,''),durationSec,durationKnown:true,thumbnail:'',extractor:'browser-upload'}]};
    openTokenEstimateModal({urls:file.name,sourceInfoOverride:sourceInfo,onConfirm:(range)=>queueVideoUpload(file,button,{...range,durationSec})});
  }catch(error){notify(error.message,'bad')}
  finally{button.disabled=false;button.textContent='Upload file';$('#dcVideoUpload').value=''}
}

async function queueVideoUpload(file,button,range={}){
  const [min,max]=$('#dcCreateDuration').value.split(',').map(Number);
  button.disabled=true;button.textContent='Uploading…';
  try{
    await callApi('/api/template',{method:'POST',body:JSON.stringify({id:$('#dcCreateTemplate').value})});
    await callApi('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcCreateCount').value),clipMinSeconds:min,clipMaxSeconds:max})});
    const contentType=file.type||'video/mp4';
    const upload=await callApi('/api/uploads/presign',{method:'POST',body:JSON.stringify({fileName:file.name,contentType})});
    const response=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':contentType},body:file});
    if(!response.ok)throw new Error(`Secure upload failed (${response.status}). Check the object-storage CORS settings and try again.`);
    const payload={objectKey:upload.key,fileName:file.name,title:file.name.replace(/\.[^.]+$/,''),durationSec:Number(range.durationSec||0),sourceStartSeconds:Math.max(0,Math.round(Number(range.sourceStartSeconds||0)))};
    if(Number.isFinite(Number(range.sourceEndSeconds))&&Number(range.sourceEndSeconds)>payload.sourceStartSeconds)payload.sourceEndSeconds=Math.round(Number(range.sourceEndSeconds));
    await callApi('/api/videos',{method:'POST',body:JSON.stringify(payload)});
    notify('Video uploaded directly to processing storage — clip generation is queued');await refreshData();renderHome();
  }finally{button.disabled=false;button.textContent='Upload file'}
}

function renderProjects(){
  const panel=$('#view-projects'),d=data();if(!panel||!d)return;
  hideLegacyProjectBrowser();
  if(selectedProjectId){renderProjectDetail(panel,d);return}
  document.body.classList.remove('dc-project-open');
  panel.classList.remove('dc-project-detail-view');
  let projects=[...(d.projects||[])];
  if(projectQuery)projects=projects.filter(p=>`${p.title||''} ${p.url||''}`.toLowerCase().includes(projectQuery));
  if(projectFilter==='processing')projects=projects.filter(p=>['queued','processing'].includes(p.status));
  if(projectFilter==='ready')projects=projects.filter(p=>(d.clips||[]).some(c=>c.projectId===p.id&&c.status==='waiting'));
  if(projectFilter==='issues')projects=projects.filter(p=>p.status==='failed'||p.error);
  if(projectSort==='oldest')projects.sort((a,b)=>Number(a.submittedAt||0)-Number(b.submittedAt||0));
  else if(projectSort==='az')projects.sort((a,b)=>String(projectDisplayTitle(a)).localeCompare(String(projectDisplayTitle(b))));
  else projects.sort((a,b)=>Number(b.submittedAt||0)-Number(a.submittedAt||0));
  const hasAny=(d.projects||[]).length>0;
  const allClips=d.clips||[], waiting=allClips.filter(c=>c.status==='waiting').length, processing=(d.projects||[]).filter(p=>['queued','processing'].includes(p.status)).length, ready=allClips.filter(c=>['approved','ready','scheduled'].includes(c.status)).length;
  panel.innerHTML=`<div class="dc-library-page"><section class="dc-library-hero"><div class="dc-library-hero-copy"><span class="dc-library-kicker">${ICON.projects} Source-first library</span><h1>Every lecture, clip and next action—organised.</h1><p>Keep the original source at the top level, then move cleanly from processing to review and publishing.</p></div><button class="dc-btn" data-dc-nav="home">＋ New project</button></section>
    <div class="dc-library-metrics"><div><span class="gold">${ICON.projects}</span><strong>${(d.projects||[]).length}</strong><small>Projects</small></div><div><span class="purple">${ICON.editor}</span><strong>${allClips.length}</strong><small>Generated clips</small></div><div><span class="blue">${ICON.sparkles}</span><strong>${processing}</strong><small>Processing</small></div><div><span class="orange">${ICON.review}</span><strong>${waiting}</strong><small>In review</small></div><div><span class="green">${ICON.publish}</span><strong>${ready}</strong><small>Ready to publish</small></div></div>
    ${hasAny?`<div class="dc-library-toolbar"><div class="dc-library-search">${ICON.search}<input id="dcProjectSearch" placeholder="Search projects, lectures and sources" value="${esc(projectQuery)}"></div><select id="dcProjectFilter"><option value="all">All projects</option><option value="processing" ${projectFilter==='processing'?'selected':''}>Processing</option><option value="ready" ${projectFilter==='ready'?'selected':''}>Ready to review</option><option value="issues" ${projectFilter==='issues'?'selected':''}>Needs attention</option></select><select id="dcProjectSort"><option value="newest">Newest first</option><option value="oldest" ${projectSort==='oldest'?'selected':''}>Oldest first</option><option value="az" ${projectSort==='az'?'selected':''}>A–Z</option></select></div>`:''}
    ${hasAny?`<div class="dc-library-layout"><section class="dc-library-projects"><div class="dc-library-section-head"><div><h2>Your projects</h2><p>${projects.length} source${projects.length===1?'':'s'} in this view</p></div><span class="dc-pill">Source → clips → publish</span></div><div class="dc-library-rows">${projects.length?projects.map(p=>libraryProjectRow(p,allClips)).join(''):`<div class="dc-empty"><strong>No projects match</strong>Clear the search or choose another filter.</div>`}</div></section><aside class="dc-library-side">${libraryWorkflowCard(processing,waiting,ready)}${libraryPlatformsCard(d)}${libraryRecentClips(allClips)}</aside></div>`:`<section class="dc-empty-visual"><div class="dc-empty-visual-copy"><span>${ICON.projects} Your project library</span><h2>Start with one source video.</h2><p>Paste a supported link or upload your original video. DeenClipped keeps the source, generated clips and publishing status together.</p><button class="dc-btn" data-dc-nav="home">Create your first project</button></div><div class="dc-empty-visual-media"><img src="/marketing-assets/library-premium.webp" alt="DeenClipped project library preview"></div></section>`}
  </div>`;
  upgradeYoutubeFallbackButtons(panel,projects);
  if($('#dcProjectSearch'))$('#dcProjectSearch').oninput=e=>{projectQuery=e.target.value.trim().toLowerCase();renderProjects()};
  if($('#dcProjectFilter'))$('#dcProjectFilter').onchange=e=>{projectFilter=e.target.value;renderProjects()};
  if($('#dcProjectSort'))$('#dcProjectSort').onchange=e=>{projectSort=e.target.value;renderProjects()};
  lastDataSignature=structuralDataSignature(d);
  requestAnimationFrame(()=>animatePanel(panel));
}
function libraryProjectRow(p,clips){
  const own=clips.filter(c=>c.projectId===p.id),thumb=projectThumbUrl(p,clips),waiting=own.filter(c=>c.status==='waiting').length,scheduled=own.filter(c=>['approved','ready','scheduled','publishing'].includes(c.status)).length;
  const failed=p.status==='failed'||p.error,busy=['queued','processing'].includes(p.status),tone=failed?'bad':busy?'blue':waiting?'orange':'good';
  const label=failed?'Needs attention':busy?(p.stage||'Processing'):waiting?`${waiting} to review`:scheduled?`${scheduled} ready`:'Ready';
  const progress=busy?clamp(Number(p.progress||0),0,100):own.length?Math.round(((own.length-waiting)/Math.max(1,own.length))*100):100;
  return `<article class="dc-library-row" data-live-project="${esc(p.id)}"><button class="dc-library-row-main" type="button" data-open-project="${esc(p.id)}"><span class="dc-library-row-thumb ${thumb?'':'empty'}">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(projectDisplayTitle(p))} thumbnail">`:ICON.projects}</span><span class="dc-library-row-copy"><strong>${esc(shortText(projectDisplayTitle(p),72))}</strong><em>${own.length} clip${own.length===1?'':'s'} · updated ${esc(formatRelative(p.updatedAt||p.submittedAt||Date.now()))}</em><span class="dc-library-progress"><i data-live-progress style="width:${progress}%"></i></span></span><span class="dc-library-row-state ${tone}" data-live-stage><i></i>${esc(shortText(label,30))}</span>${ICON.chevron}</button><details class="dc-library-row-menu"><summary aria-label="Project actions">•••</summary><div><button data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>Generate more clips</button>${failed?`<button data-retry-project="${esc(p.id)}">Retry processing</button>`:''}<button class="danger" data-delete-project="${esc(p.id)}">Delete project</button></div></details></article>`;
}
function libraryWorkflowCard(processing,waiting,ready){
  return `<section class="dc-library-side-card"><div class="dc-library-side-head"><span class="blue">${ICON.analytics}</span><div><strong>Workflow overview</strong><small>Keep your content moving.</small></div></div><div class="dc-library-flow"><button data-dc-nav="projects"><i class="blue"></i><span>Processing</span><b>${processing}</b></button><button data-dc-nav="review"><i class="orange"></i><span>In review</span><b>${waiting}</b></button><button data-dc-nav="schedule"><i class="green"></i><span>Ready to publish</span><b>${ready}</b></button></div><button class="dc-btn secondary wide" data-dc-nav="review">Open workflow</button></section>`;
}
function libraryPlatformsCard(d){
  const infos=['youtube','tiktok','instagram','facebook'].map(providerInfo);
  return `<section class="dc-library-side-card"><div class="dc-library-side-head"><span class="purple">${ICON.social}</span><div><strong>Platform connections</strong><small>Where your clips can publish.</small></div></div><div class="dc-library-platforms">${infos.map(info=>`<div><span class="dc-publish-brand ${info.provider} ${info.connected?'on':''}">${socialSvg(info.provider)}</span><b>${esc(providerTitle(info.provider).replace(' Shorts','').replace(' Reels',''))}</b><em class="${info.connected?'on':''}">${info.connected?'Connected':'Connect'}</em></div>`).join('')}</div><button class="dc-btn secondary wide" data-dc-nav="publishing">Manage channels</button></section>`;
}
function libraryRecentClips(clips){
  const recent=[...clips].sort((a,b)=>Number(b.createdAt||b.renderedAt||0)-Number(a.createdAt||a.renderedAt||0)).slice(0,3);
  return `<section class="dc-library-side-card"><div class="dc-library-side-head"><span class="gold">${ICON.play}</span><div><strong>Recent clips</strong><small>Your latest generated moments.</small></div></div><div class="dc-library-recent">${recent.length?recent.map(c=>`<button type="button" data-edit-style-clip="${esc(c.id)}">${c.thumbUrl?`<img src="${authedUrl(c.thumbUrl)}" alt="">`:`<span>${ICON.play}</span>`}<strong>${esc(shortText(c.title||'Untitled clip',38))}</strong><em>${formatDuration(c.durationMs)}</em></button>`).join(''):`<div class="dc-empty"><strong>No clips yet</strong>Create a project to fill this list.</div>`}</div></section>`;
}
function projectCard(p,clips){
  const own=clips.filter(c=>c.projectId===p.id),thumb=projectThumbUrl(p,clips),waiting=own.filter(c=>c.status==='waiting').length,scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
  const title=projectDisplayTitle(p);
  const failed=p.status==='failed'||p.error, busy=['queued','processing'].includes(p.status);
  const badgeClass=failed?'bad':busy?'warn':'good';
  const stage=failed?'Processing failed':busy?(p.stage||'Processing'):waiting?'Clips need review':'Ready';
  return `<article class="dc-project-card"><button class="dc-project-cover" data-open-project="${esc(p.id)}" type="button" aria-label="Open ${esc(title)}">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(title)} thumbnail">`:`<div class="dc-project-placeholder">${ICON.projects}<span>Lecture</span></div>`}<span class="dc-project-status dc-pill ${badgeClass}">${esc(statusName(p.status))}</span></button><div class="dc-project-body"><h3>${esc(shortText(title,70))}</h3><div class="dc-project-meta-pills"><span class="dc-pill ${badgeClass}">${esc(stage)}</span></div>${failed?`<div class="dc-project-error-mini">${esc(shortError(p.error||p.stage))}</div>`:''}<div class="dc-project-stats"><div class="dc-project-stat"><strong>${own.length}</strong><span>clips</span></div><div class="dc-project-stat"><strong>${waiting}</strong><span>review</span></div><div class="dc-project-stat"><strong>${scheduled}</strong><span>scheduled</span></div></div><div class="dc-project-actions three"><button class="dc-btn" data-open-project="${esc(p.id)}">Open project</button>${failed?`<button class="dc-btn secondary" data-retry-project="${esc(p.id)}">Retry</button>`:`<button class="dc-btn secondary" data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>More clips</button>`}<button class="dc-btn danger" data-delete-project="${esc(p.id)}">Delete</button></div></div></article>`;
}
function renderProjectDetail(panel,d){
  const p=(d.projects||[]).find(x=>x.id===selectedProjectId);if(!p){selectedProjectId='';return renderProjects()}
  document.body.classList.add('dc-project-open');
  panel.classList.add('dc-project-detail-view');
  const clips=(d.clips||[]).filter(c=>c.projectId===p.id).sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const title=projectDisplayTitle(p), thumb=projectThumbUrl(p,d.clips||clips);
  const waiting=clips.filter(c=>c.status==='waiting').length, scheduled=clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length, posted=clips.filter(c=>c.status==='posted').length, failed=p.status==='failed'||p.error;
  panel.innerHTML=`<div class="dc-project-detail-page"><div class="dc-project-detail-hero"><button class="dc-icon-btn dc-svg" id="dcBackProjects" title="Back to projects">${ICON.back}</button><div class="dc-project-detail-thumb">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(title)} thumbnail">`:`<div class="dc-project-placeholder">${ICON.projects}<span>Lecture</span></div>`}</div><div class="dc-project-detail-info"><span class="dc-pill ${failed?'bad':['queued','processing'].includes(p.status)?'warn':'good'}">${failed?'Needs retry':statusName(p.status)}</span><h1>${esc(title)}</h1><p>${clips.length} clips · ${posted} posted · ${scheduled} scheduled</p></div><div class="dc-project-detail-actions"><button class="dc-btn secondary" data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>Generate more</button>${failed?`<button class="dc-btn secondary" data-retry-project="${esc(p.id)}">Retry</button>`:''}<button class="dc-btn danger" data-delete-project="${esc(p.id)}">Delete project</button></div></div><div class="dc-project-detail-stats">${metric(clips.length,'Clips')}${metric(waiting,'Review')}${metric(scheduled,'Scheduled')}${metric(posted,'Posted')}${metric(Math.round((clips[0]?.score||0)),'Top score')}</div>${failed?`<div class="dc-project-error-mini">${esc(shortError(p.error||p.stage))}</div>`:''}${p.moreJob&&['queued','processing'].includes(p.moreJob.status)?`<div class="dc-card dc-card-pad" data-live-more-job="${esc(p.id)}"><div class="dc-now-row"><span class="dc-spinner"></span><div class="dc-now-main"><strong data-live-stage>${esc(p.moreJob.stage||'Generating more clips')}</strong><span>Reusing saved lecture and transcript.</span><div class="dc-progress"><i data-live-progress style="width:${clamp(p.moreJob.progress,0,100)}%"></i></div></div><span class="dc-pill warn" data-live-percent>${Math.round(p.moreJob.progress||0)}%</span></div></div>`:''}<div class="dc-project-detail-filter"><select><option>All clips</option><option>Waiting review</option><option>Scheduled</option><option>Posted</option></select><select><option>Highest score</option><option>Newest first</option><option>Longest</option></select><span class="dc-pill">${clips.length} clips</span><button class="dc-btn secondary" data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>More clips</button></div><div class="dc-project-clip-grid">${clips.length?clips.map(c=>clipCard(c,{detail:true})).join(''):`<div class="dc-empty dc-empty-full"><strong>No clips yet</strong>${['queued','processing'].includes(p.status)?'Processing is still underway.':'Generate more clips from this lecture.'}</div>`}</div></div>`;
  upgradeYoutubeFallbackButtons(panel,[p]);
  $('#dcBackProjects').onclick=()=>{selectedProjectId='';document.body.classList.remove('dc-project-open');renderProjects()};
  lastDataSignature=structuralDataSignature(d);
  requestAnimationFrame(()=>animatePanel(panel));
}
function upgradeYoutubeFallbackButtons(panel,projects){
  for(const project of projects||[]){
    if(project?.errorCode!=='youtube_import_blocked')continue;
    const button=$(`[data-retry-project="${CSS.escape(String(project.id))}"]`,panel);
    if(!button)continue;
    button.removeAttribute('data-retry-project');button.setAttribute('data-upload-fallback','');button.textContent='Upload original video';button.classList.remove('secondary');
  }
}
function clipCard(c,opts={}){
  const reviewAction=c.status==='waiting'?`<button class="dc-btn" data-review-clip="${esc(c.id)}">Approve</button>`:'';
  const scheduleAction=['approved','scheduled','publishing'].includes(c.status)?`<button class="dc-btn secondary" data-dc-nav="publishing">View schedule</button>`:'';
  const title=shortText(c.title||'Untitled clip', opts.detail?54:44);
  const sub=c.scheduledAt?`Scheduled · ${formatDate(c.scheduledAt)}`:statusName(c.status);
  return `<article class="dc-clip-card v3-full"><div class="dc-clip-media"><button class="dc-clip-media-button" data-edit-style-clip="${esc(c.id)}" type="button">${clipThumb(c)}</button><span class="dc-score">${Math.round(c.score||0)}</span><span class="dc-duration">${formatDuration(c.durationMs)}</span><span class="dc-clip-state dc-pill ${c.status==='posted'?'good':c.status==='waiting'?'warn':c.status==='publish_failed'?'bad':''}">${statusName(c.status)}</span></div><div class="dc-clip-body"><h3>${esc(title)}</h3><p>${esc(sub)}</p><div class="dc-clip-actions"><button class="dc-btn secondary" data-edit-style-clip="${esc(c.id)}">Edit style</button><button class="dc-btn secondary" data-edit-video-clip="${esc(c.id)}">Edit video</button>${reviewAction}${scheduleAction}<button class="dc-btn secondary" data-download-clip="${esc(c.id)}">Download</button><button class="dc-btn danger" data-delete-clip="${esc(c.id)}">Delete</button></div></div></article>`;
}

function renderReview(){
  const panel=$('#view-review'),d=data();if(!panel||!d)return;
  const allWaiting=[...(d.clips||[])].filter(c=>c.status==='waiting');
  const strong=allWaiting.filter(c=>hookInfo(c).strong).length;
  const avg=allWaiting.length?Math.round(allWaiting.reduce((sum,c)=>sum+Number(c.score||0),0)/allWaiting.length):0;
  let waiting=allWaiting.filter(c=>reviewFilter==='strong'?hookInfo(c).strong:reviewFilter==='short'?Number(c.durationMs||0)<=60000:reviewFilter==='verified'?Boolean(c.musicVerified&&c.renderVerified):true);
  waiting.sort(reviewSort==='duration'?(a,b)=>Number(a.durationMs||0)-Number(b.durationMs||0):(a,b)=>Number(b.score||0)-Number(a.score||0));
  if(reviewFocusClipId)waiting.sort((a,b)=>(a.id===reviewFocusClipId?-1:0)-(b.id===reviewFocusClipId?-1:0));
  const toolbar=allWaiting.length?`<div class="dc-review-toolbar pro"><select id="dcReviewFilter" aria-label="Filter clips"><option value="all">All clips (${allWaiting.length})</option><option value="strong" ${reviewFilter==='strong'?'selected':''}>Strong hooks (${strong})</option><option value="short" ${reviewFilter==='short'?'selected':''}>Under 60 seconds</option><option value="verified" ${reviewFilter==='verified'?'selected':''}>Render verified</option></select><select id="dcReviewSort" aria-label="Sort clips"><option value="score">Highest score</option><option value="duration" ${reviewSort==='duration'?'selected':''}>Shortest first</option></select><span class="spacer"></span><button class="dc-btn secondary" id="dcApproveVerified">Schedule verified</button><button class="dc-btn" id="dcScheduleAll" ${!waiting.length?'disabled':''}>Schedule visible</button></div>`:'';
  const empty=allWaiting.length?`<div class="dc-review-empty-pro"><div><div class="dc-empty-icon">${ICON.review}</div><strong>No clips match</strong><p>Choose another filter to keep reviewing.</p><button class="dc-btn" data-review-filter="all">Show every clip</button></div></div>`:`<div class="dc-review-empty-pro visual"><div><div class="dc-empty-icon">${ICON.review}</div><strong>Your review queue is clear.</strong><p>New clips will appear here with their score, hook strength and suggested posting copy.</p><button class="dc-btn" data-dc-nav="home">Create new clips</button></div><img src="/marketing-assets/clip-review.webp" alt="DeenClipped clip review preview"></div>`;
  panel.innerHTML=`<div class="dc-review-page-pro ${allWaiting.length?'':'is-empty'}"><section class="dc-review-hero-pro"><div><span class="dc-review-kicker">Final review</span><h1>Choose when each clip goes live.</h1><p>Check the hook, captions and posting copy, then post now or reserve the next publishing slot.</p></div><div class="dc-review-metrics-pro"><span><b>${allWaiting.length}</b><em>waiting</em></span><span><b>${strong}</b><em>strong hooks</em></span><span><b>${avg}</b><em>avg score</em></span></div></section>${toolbar}<div class="dc-review-list pro">${waiting.length?waiting.map(reviewRow).join(''):empty}</div></div>`;
  if($('#dcApproveVerified'))$('#dcApproveVerified').onclick=approveVerified;
  if($('#dcScheduleAll'))$('#dcScheduleAll').onclick=()=>scheduleMany(waiting.map(c=>c.id));
  if($('#dcReviewFilter'))$('#dcReviewFilter').onchange=e=>{reviewFilter=e.target.value;renderReview()};
  if($('#dcReviewSort'))$('#dcReviewSort').onchange=e=>{reviewSort=e.target.value;renderReview()};
  $$('[data-review-filter]',panel).forEach(button=>button.onclick=()=>{reviewFilter=button.dataset.reviewFilter;renderReview()});
  requestAnimationFrame(()=>{animatePanel(panel);if(reviewFocusClipId)panel.querySelector(`[data-review-row="${CSS.escape(reviewFocusClipId)}"]`)?.scrollIntoView({block:'center',behavior:'smooth'})});
}
function reviewRow(c){
  const hook=hookInfo(c), copy=socialCopyForClip(c);
  return `<article class="dc-review-item pro ${c.id===reviewFocusClipId?'is-focused':''}" data-review-row="${esc(c.id)}"><button class="dc-review-media" type="button" data-edit-clip="${esc(c.id)}" aria-label="Open ${esc(c.title||'clip')}">${c.thumbUrl?`<img src="${authedUrl(c.thumbUrl)}" alt="${esc(c.title||'Clip')} thumbnail">`:''}<span class="dc-review-score">${Math.round(c.score||0)}</span></button><div class="dc-review-main"><div class="dc-review-title-row"><h3>${esc(c.title||copy.title)}</h3><small>${formatDuration(c.durationMs)} · quality ${Math.round(c.quality||c.score||0)}/100</small></div><div class="dc-hook-strip"><div class="dc-hook-card"><strong><span class="dc-hook-badge ${hook.strong?'good':'warn'}">${hook.strong?'Strong':'Needs work'} hook</span></strong><p>${esc(hook.suggestion)}</p></div><div class="dc-copy-card"><strong>Suggested post</strong><div class="dc-copy-grid"><div class="dc-copy-mini"><b>Caption</b><span>${esc(copy.tiktok)}</span></div><div class="dc-copy-mini"><b>Shorts title</b><span>${esc(copy.youtube)}</span></div></div></div></div><div class="dc-review-actions pro clear"><button class="dc-btn" data-post-clip="${esc(c.id)}">Post now</button><button class="dc-btn secondary" data-schedule-clip="${esc(c.id)}">Schedule</button><button class="dc-btn secondary" data-edit-style-clip="${esc(c.id)}">Open editor</button><details class="dc-clip-more"><summary>More</summary><div><button data-regenerate-title="${esc(c.id)}">Regenerate title</button><button data-make-shorter="${esc(c.id)}">Make shorter</button><button data-make-longer="${esc(c.id)}">Make longer</button><button class="danger" data-delete-clip="${esc(c.id)}">Delete clip</button></div></details></div></div></article>`;
}
function clipReviewText(c){
  return String(c.transcript||c.description||c.title||'').replace(/\s+/g,' ').trim();
}
function wordsFromClip(c){return clipReviewText(c).split(/\s+/).filter(Boolean)}
function hookInfo(c){
  const text=clipReviewText(c), first=text.slice(0,180).toLowerCase();
  const hasQuestion=/\?/.test(first)||/\b(why|what|how|when|do you|did you|have you|can you)\b/i.test(first);
  const hasHook=/\b(let me|imagine|most of us|the first|this is|if you|when you|you could|without|before|after|never|always)\b/i.test(first);
  const strong=Number(c.score||0)>=92||hasQuestion||hasHook;
  const suggestion=strong?'The opening has a clear idea or curiosity gap.':'Start from 2 seconds later — a stronger sentence may begin there.';
  return {strong,suggestion};
}
function cleanTitlePhrase(text){
  let t=String(text||'').replace(/[“”]/g,'').replace(/\s+/g,' ').trim();
  t=t.replace(/^(and|but|so|because|like|um|uh|you know)\s+/i,'');
  t=t.split(/[.!?،؛]/)[0]||t;
  const words=t.split(/\s+/).filter(Boolean).slice(0,9).join(' ');
  return words.charAt(0).toUpperCase()+words.slice(1);
}
function titleCaseSimple(text){return String(text||'').toLowerCase().replace(/\b\w/g,m=>m.toUpperCase())}
function socialCopyForClip(c,variant=0){
  const text=clipReviewText(c), base=cleanTitlePhrase(text||c.title||'Islamic reminder');
  const ideas=[base,`A reminder about ${base.toLowerCase()}`,`${base} — Islamic reminder`,`${base} in one minute`].filter(Boolean);
  const title=shortText(ideas[Math.abs(Number(variant)||0)%ideas.length],72);
  const tiktok=shortText(`${title}. A short reminder to reflect on and act on.`,110);
  const instagram=shortText(`${title}. Save this reminder and share it with someone who may benefit.`,125);
  const youtube=shortText(title,80);
  const hashtags=['#Islam','#MuslimReminder','#Dawah','#Quran','#DeenClipped'];
  return {title,tiktok,instagram,youtube,hashtags};
}
async function regenerateClipCopy(id){
  const c=(data()?.clips||[]).find(x=>x.id===id);if(!c)return notify('Clip not found','bad');
  const copy=socialCopyForClip(c,Date.now());
  try{
    await callApi(`/api/clips/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({title:copy.title,description:copy.tiktok,hashtags:copy.hashtags.join(' ')})});
    notify('Generated title, caption and hashtags');
    await refreshData();renderReview();
  }catch(e){notify(e.message,'bad')}
}
async function adjustClipLength(id,mode){
  const c=(data()?.clips||[]).find(x=>x.id===id);if(!c)return notify('Clip not found','bad');
  const start=Number(c.startSec)||0, end=Number(c.endSec)||start+(Number(c.durationMs)||0)/1000;
  const duration=Math.max(0,end-start); if(duration<8)return notify('Clip is already too short to adjust safely','bad');
  let nextStart=start,nextEnd=end;
  if(mode==='shorter'){
    const cut=Math.min(8,Math.max(3,duration*.18));
    if(duration-cut<12)return notify('This clip is already close to the minimum length','bad');
    nextStart=start+Math.min(2,cut*.35); nextEnd=end-(cut-Math.min(2,cut*.35));
  }else{
    nextStart=Math.max(0,start-2); nextEnd=end+5;
  }
  const body={startSec:Number(nextStart.toFixed(2)),endSec:Number(nextEnd.toFixed(2)),durationMs:Math.round((nextEnd-nextStart)*1000)};
  try{
    await callApi(`/api/clips/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(body)});
    await callApi(`/api/clips/${encodeURIComponent(id)}/rerender`,{method:'POST',body:JSON.stringify({templateId:c.templateId||'',asVariant:false})});
    notify(mode==='shorter'?'Shorter version queued':'Longer version queued');
    await refreshData();renderReview();
  }catch(e){notify(e.message,'bad')}
}
async function approveVerified(){
  const list=(data()?.clips||[]).filter(c=>c.status==='waiting'&&c.musicVerified&&c.renderVerified);if(!list.length)return notify('No verified waiting clips','bad');
  try{for(const c of list)await callApi(`/api/clips/${encodeURIComponent(c.id)}`,{method:'PATCH',body:JSON.stringify({status:'approved'})});notify(`${list.length} clips approved`);await refreshData();renderReview()}catch(e){notify(e.message,'bad')}
}
async function approveClip(id){
  try{const result=await callApi(`/api/clips/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:'approved'})});notify(result.clip?.scheduledLabel?`Approved · next slot ${result.clip.scheduledLabel}`:'Clip approved and scheduled');await refreshData();renderReview()}catch(e){if(!handlePublishingError(e))notify(e.message,'bad')}
}
async function scheduleMany(ids){
  if(!ids.length)return;if(!confirm(`Schedule ${ids.length} clip${ids.length===1?'':'s'}?`))return;
  try{const result=await callApi('/api/clips/schedule-selected',{method:'POST',body:JSON.stringify({ids})});notify(`${result.scheduled||0} clips scheduled`,result.failed?'bad':'good');await refreshData();renderReview()}catch(e){if(!handlePublishingError(e))notify(e.message,'bad')}
}
async function scheduleClip(id){await scheduleMany([id]);if(currentView==='projects')renderProjects()}
async function postClip(id){const access=publishingAccess();if(!access.allowed){openBillingModal();return}if(!confirm('Post this clip now to the enabled destinations?'))return;try{await callApi(`/api/clips/${encodeURIComponent(id)}/publish`,{method:'POST'});notify('Publishing transfer created');await refreshData();renderCurrent()}catch(e){if(!handlePublishingError(e))notify(e.message,'bad')}}
async function deleteClip(id){if(!confirm('Discard this clip permanently?'))return;try{await callApi(`/api/clips/${encodeURIComponent(id)}`,{method:'DELETE'});notify('Clip discarded');await refreshData();renderCurrent()}catch(e){notify(e.message,'bad')}}
async function retryProject(id){try{await callApi(`/api/projects/${encodeURIComponent(id)}/retry`,{method:'POST'});notify('Project queued again');await refreshData();renderProjects()}catch(e){notify(e.message,'bad')}}
async function generateMore(id){const amount=Number(prompt('How many new clips?', '8'));if(!Number.isFinite(amount)||amount<1)return;try{await callApi(`/api/projects/${encodeURIComponent(id)}/more-clips`,{method:'POST',body:JSON.stringify({count:Math.min(20,Math.round(amount))})});notify('More clips queued');await refreshData();renderProjects()}catch(e){notify(e.message,'bad')}}
async function deleteProject(id){if(!confirm('Delete this project and its generated clips?'))return;try{await callApi(`/api/projects/${encodeURIComponent(id)}`,{method:'DELETE'});notify('Project deleted');selectedProjectId='';await refreshData();renderProjects()}catch(e){notify(e.message,'bad')}}


function editorSourceUrl(clip){return authedUrl(`/api/clips/${encodeURIComponent(clip.id)}/source-preview`)}
function createRipple(event){
  const target=event.target.closest('.dc-btn,.dc-icon-btn,.dc-nav-button,.dc-tool-button,.dc-style-card,.dc-fill-option');
  if(!target||target.disabled)return;
  const rect=target.getBoundingClientRect(),size=Math.max(rect.width,rect.height)*1.55,ripple=document.createElement('span');
  ripple.className='dc-ripple';ripple.style.width=ripple.style.height=`${size}px`;ripple.style.left=`${event.clientX-rect.left}px`;ripple.style.top=`${event.clientY-rect.top}px`;
  target.appendChild(ripple);setTimeout(()=>ripple.remove(),600);
}
function animatePanel(panel){
  if(!panel)return;panel.classList.remove('dc-view-reveal');void panel.offsetWidth;panel.classList.add('dc-view-reveal');
  const items=$$('.dc-v5-create,.dc-v5-library,.dc-v5-side-card,.dc-card,.dc-project-card,.dc-clip-card,.dc-now-row,.dc-list-row,.dc-social-card,.dc-manage-card,.dc-template-card,.dc-settings-panel,.dc-insight-panel',panel).slice(0,18);
  items.forEach((item,index)=>{item.classList.remove('dc-stagger-in');item.style.animationDelay=`${Math.min(index*32,320)}ms`;void item.offsetWidth;item.classList.add('dc-stagger-in')});
}
function framingStatusCopy(){
  if(editor.framingStatus==='analysing')return['Finding the active speaker','Detecting faces and comparing mouth movement throughout this clip.'];
  if(editor.framingStatus==='ready'){
    const plan=editor.framingPlan||{},confidence=Math.round(Number(plan.confidence||0)*100),method=String(plan.method||'speaker').replace(/-/g,' '),switches=Number(plan.speakerSwitches||0);
    return['Active-speaker framing ready',`${method}${confidence?` · ${confidence}% confidence`:''}${switches?` · ${switches} speaker switch${switches===1?'':'es'}`:''}${plan.keyframes?.length?` · ${plan.keyframes.length} crop points`:''}`];
  }
  if(editor.framingStatus==='failed')return['Automatic framing unavailable',editor.framingMessage||'Use manual crop position or choose Left, Centre or Right.'];
  return['AI active-speaker framing','Turn it on, then press Analyse active speaker. The crop moves; captions stay fixed.'];
}
function requestFramingPlan(immediate=false){
  clearTimeout(editor.framingTimer);
  const d=editor.draft,clip=currentClip();
  if(!clip||!d||d.fitMode!=='crop'||!d.smartFramingEnabled){editor.framingStatus='idle';editor.framingPlan=null;updateEditorPreview();if(editor.tool==='canvas')renderEditorTool();return}
  editor.framingTimer=setTimeout(async()=>{
    const request=++editor.framingRequest;editor.framingStatus='analysing';editor.framingMessage='Detecting faces and mouth movement';updateEditorPreview();if(editor.tool==='canvas')renderEditorTool();
    try{
      const result=await callApi(`/api/clips/${encodeURIComponent(clip.id)}/framing-preview`,{method:'POST',body:JSON.stringify({
        width:Number(d.width||1080),height:Number(d.height||1920),bias:d.smartFramingBias||'auto',
        padding:Number(d.smartFramingPadding??.18),zoom:Number(d.smartFramingZoom??1),smoothing:Number(d.smartFramingSmoothing??.68),sampleHz:3
      })});
      if(request!==editor.framingRequest)return;
      if(!result.plan?.available)throw new Error(result.plan?.reason||'No face or subject could be detected.');
      editor.framingPlan=result.plan;editor.framingStatus='ready';editor.framingMessage='Active-speaker crop is ready';markEditorDirty(false);
    }catch(error){
      if(request!==editor.framingRequest)return;
      editor.framingPlan=null;editor.framingStatus='failed';editor.framingMessage=error.message;
      if(/opencv|cascadeclassifier|not installed|unavailable/i.test(String(error.message||''))){
        editor.draft.smartFramingEnabled=false;editor.framingMessage=`${error.message} Manual crop is enabled.`;
      }
    }
    updateEditorPreview();applyFrameAtTime(editor.currentTime);if(editor.tool==='canvas')renderEditorTool();
  },immediate?0:420);
}
function interpolateFramePlan(time){
  const plan=editor.framingPlan,frames=plan?.keyframes||[];
  if(!frames.length)return plan?.available?plan:null;
  if(time<=Number(frames[0].t||0))return frames[0];
  for(let i=1;i<frames.length;i++){
    const a=frames[i-1],b=frames[i],ta=Number(a.t||0),tb=Number(b.t||ta+.01);
    if(time<=tb){const ratio=clamp((time-ta)/Math.max(.01,tb-ta),0,1);return{x:Number(a.x)+(Number(b.x)-Number(a.x))*ratio,y:Number(a.y)+(Number(b.y)-Number(a.y))*ratio,w:Number(a.w||plan.w),h:Number(a.h||plan.h),srcW:plan.srcW,srcH:plan.srcH}}
  }
  return frames.at(-1);
}
function applyFrameAtTime(time){
  const video=$('#dcEditorVideo'),d=editor.draft;if(!video||!d)return;
  // The preview stylesheet sets object-fit:contain, which letterboxes the
  // video and never fills the frame. It also makes object-position a no-op,
  // so the crop maths below had no visible effect. Fill mode needs cover.
  video.style.objectFit=d.fitMode==='crop'?'cover':'contain';video.style.transform=d.fitMode==='crop'?`scale(${clamp(Number(d.smartFramingZoom||1),.75,2.5)})`:'none';
  // The blurred backdrop exists to fill the frame behind a fitted video, so
  // it should always cover — letterboxing it defeats the point.
  const backdrop=$('#dcEditorVideoBg');
  if(backdrop)backdrop.style.objectFit='cover';
  if(d.fitMode!=='crop'){video.style.objectPosition='50% 50%';return}
  if(d.smartFramingEnabled&&editor.framingStatus==='ready'){
    const point=interpolateFramePlan(time),srcW=Number(editor.framingPlan?.srcW||point?.srcW||0),srcH=Number(editor.framingPlan?.srcH||point?.srcH||0);
    if(point&&srcW&&srcH){video.style.objectPosition=`${clamp((Number(point.x)+Number(point.w)/2)/srcW*100,0,100)}% ${clamp((Number(point.y)+Number(point.h)/2)/srcH*100,0,100)}%`;return}
  }
  if(!d.smartFramingEnabled){video.style.objectPosition=`${clamp(Number(d.cropPositionX??50),0,100)}% ${clamp(Number(d.cropPositionY??50),0,100)}%`;return}
  const positions={left:'28% 50%',center:'50% 50%',right:'72% 50%',auto:'50% 50%'};
  video.style.objectPosition=positions[d.smartFramingBias||'auto']||'50% 50%';
}
function syncBackgroundVideo(force=false){
  const fg=$('#dcEditorVideo'),bg=$('#dcEditorVideoBg');if(!fg||!bg)return;
  if(force||Math.abs(bg.currentTime-fg.currentTime)>.12){try{bg.currentTime=fg.currentTime}catch{}}
}

function openEditor(id, tool='captions', captionTab='styles'){ selectedClipId=id; editor.pendingTool=tool; editor.pendingCaptionTab=captionTab; editor.clipId=''; go('editor'); }
async function ensureEditor(){
  const panel=$('#view-editor'),d=data();if(!panel||!d)return;
  const clips=d.clips||[];
  if(!selectedClipId||!clips.some(c=>c.id===selectedClipId))selectedClipId=(clips.find(c=>c.status==='waiting')||clips[0])?.id||'';
  const clip=clips.find(c=>c.id===selectedClipId);
  if(!clip){panel.innerHTML=`<section class="dc-editor-empty"><div><span class="dc-manage-kicker">${ICON.editor} Clip editor</span><h1>Choose a clip before editing.</h1><p>The editor opens from Projects or Review, keeping this workspace focused on the clip you selected.</p><button class="dc-btn" data-dc-nav="home">Create clips</button></div><img src="/marketing-assets/editor.webp" alt="DeenClipped video editor preview"></section>`;return}
  if(editor.clipId!==clip.id){
    const pendingTool=editor.pendingTool||'captions', pendingTab=editor.pendingCaptionTab||'styles'; editor.pendingTool=''; editor.pendingCaptionTab='';
    editor.loading=true; editor.clipId=clip.id; editor.tool=pendingTool;editor.captionTab=pendingTool==='captions'?pendingTab:'styles';editor.search='';
    const template=(d.templates||[]).find(t=>t.id===clip.templateId)||d.selectedTemplate||(d.templates||[])[0]||d.templateDraft||{};
    const saved=loadEditorDraft(clip.id);
    editor.draft={...clone(template),...(saved?.draft||{}),__clipId:clip.id};editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;editor.draft.captionTimingOffsetMs??=0;
    editor.captionText=saved?.captionText??clip.transcript??'';
    editor.trimIn=0;editor.trimOut=Math.max(.1,Number(clip.durationMs||0)/1000);
    editor.dirty=Boolean(saved);editor.localSavedAt=Number(saved?.savedAt||0);editor.selectedLayer='captions';editor.history=[];editor.historyIndex=-1;editor.sourceBase=Number(clip.startSec||0);editor.sourceEnd=Number(clip.endSec||editor.sourceBase+editor.trimOut);editor.sourceFallback=false;editor.framingPlan=clip.smartFraming||null;editor.framingStatus=editor.framingPlan?'ready':'idle';editor.framingMessage=editor.framingPlan?'Using the framing saved with this render':'Smart framing has not been analysed';
    editor.captionWords=approximateWords(editor.captionText,editor.trimOut);editor.captionTimingReference=clone(editor.captionWords);editor.captionSource='fallback';editor.backendCaptionReady=false;
    await loadCaptionWords(clip);
    pushHistory(true);
    editor.loading=false;
  }
  renderEditor(clip);
}
async function loadCaptionWords(clip){
  try{
    const payload=await callApi(`/api/clips/${encodeURIComponent(clip.id)}/captions`);
    if(editor.clipId!==clip.id)return;
    if(Array.isArray(payload.words)&&payload.words.length){
      const timed=payload.words.map(w=>({start:Number(w.start),end:Number(w.end),word:String(w.word||'').trim()})).filter(w=>w.word&&w.end>w.start).sort((a,b)=>a.start-b.start);
      editor.captionTimingReference=clone(timed);editor.captionWords=editor.dirty?mapEditedWordsToSpeech(editor.captionText,timed,Math.max(.1,editor.trimOut)):timed;
      editor.captionSource=editor.dirty?'edited':payload.exact?'whisper':payload.edited?'edited':'fallback';editor.backendCaptionReady=true;editor.captionSyncStatus='idle';editor.captionSyncMessage=payload.synced?'Clip-specific speech timing loaded':'';if(!editor.dirty&&payload.transcript)editor.captionText=payload.transcript;
    }
  }catch{editor.captionWords=approximateWords(editor.captionText,Math.max(.1,Number(clip.durationMs||0)/1000));editor.captionTimingReference=clone(editor.captionWords);editor.captionSource='fallback'}
}
function loadEditorDraft(id){try{return JSON.parse(localStorage.getItem(`dc-editor-${id}`)||'null')}catch{return null}}
function saveEditorLocal(){try{editor.localSavedAt=Date.now();localStorage.setItem(`dc-editor-${editor.clipId}`,JSON.stringify({version:2,draft:cleanDraft(editor.draft),captionText:editor.captionText,savedAt:editor.localSavedAt}));updateEditorSaveState()}catch{}}
function clearEditorLocal(){try{localStorage.removeItem(`dc-editor-${editor.clipId}`)}catch{}}

function renderEditor(clip){
  const panel=$('#view-editor'),d=data();if(!panel||!clip)return;
  panel.classList.add('dc-editor-page');
  const source=editorSourceUrl(clip);
  panel.innerHTML=`<div class="dc-editor-header"><button class="dc-icon-btn dc-svg" id="dcEditorBack" title="Back to project">${ICON.back}</button><div class="dc-editor-title"><strong>${esc(clip.title||'Untitled clip')}</strong><span>${esc(clip.projectTitle||'Lecture')} · ${Math.round(clip.score||0)}/100 · <b id="dcEditorSaveState">${editor.dirty?'Draft backed up locally':'All changes saved'}</b></span></div><button class="dc-icon-btn dc-svg" id="dcUndo" title="Undo (⌘Z)" ${editor.historyIndex<=0?'disabled':''}>${ICON.undo}</button><button class="dc-icon-btn dc-svg" id="dcRedo" title="Redo (⇧⌘Z)" ${editor.historyIndex>=editor.history.length-1?'disabled':''}>${ICON.redo}</button><button class="dc-btn secondary" id="dcSaveDraft" title="Save and apply this template (⌘S)">Save</button><button class="dc-btn" id="dcRenderClip">Export video</button></div><div class="dc-editor-workspace"><nav class="dc-tool-rail">${toolButton('captions','Captions','captions')}${toolButton('canvas','Canvas','canvas')}${toolButton('style','Look','style')}${toolButton('audio','Audio','audio')}${toolButton('details','Post','details')}</nav><aside class="dc-tool-panel"><div class="dc-tool-head"><strong id="dcToolTitle">Captions</strong><span class="dc-pill ${editor.captionSource==='whisper'?'good':'warn'}" id="dcCaptionSource">${editor.captionSource==='whisper'?'Exact speech timing':editor.captionSource==='edited'?'Edited speech timing':'Estimated timing'}</span></div><div class="dc-tool-content" id="dcToolContent"></div></aside><main class="dc-canvas-area"><div class="dc-canvas-toolbar"><button class="dc-icon-btn dc-svg" id="dcPlayButton" title="Play / pause (Space)">${ICON.play}</button><span class="dc-timeline-time" id="dcCanvasTime">0:00 / ${formatClock(editor.trimOut)}</span><div class="dc-layer-switch" role="group" aria-label="Select editor layer"><button type="button" data-select-layer="video" class="${editor.selectedLayer==='video'?'on':''}">Video</button><button type="button" data-select-layer="captions" class="${editor.selectedLayer==='captions'?'on':''}">Captions</button></div><button type="button" class="dc-safe-toggle ${editor.safeZones?'on':''}" id="dcSafeZones" aria-pressed="${editor.safeZones}">Safe zones</button><span class="spacer"></span><button type="button" class="dc-btn secondary dc-caption-edit-shortcut" id="dcOpenCaptionText">Edit captions</button><span class="dc-zoom">Shift + arrows nudge · arrows seek</span></div><div class="dc-canvas-wrap"><div class="dc-video-canvas ${editor.selectedLayer==='video'?'is-video-selected':''}" id="dcVideoCanvas"><video id="dcEditorVideoBg" class="dc-video-layer dc-video-bg" src="${source}" preload="metadata" muted playsinline></video><video id="dcEditorVideo" class="dc-video-layer dc-video-fg" src="${source}" preload="metadata" playsinline></video><div class="dc-safe-zone ${editor.safeZones?'show':''}" id="dcSafeZone"><span>Keep text inside</span></div><div class="dc-framing-guide"></div><button type="button" class="dc-resize-handle" id="dcResizeHandle" aria-label="Resize video"></button><span class="dc-layer-badge" id="dcLayerBadge">Video layer</span><div class="dc-snap-guide vertical" id="dcSnapGuideV"></div><div class="dc-snap-guide horizontal" id="dcSnapGuideH"></div><div class="dc-caption-overlay ${editor.selectedLayer==='captions'?'is-selected':''}" id="dcCaptionOverlay" role="group" aria-label="Caption layer"></div><div class="dc-watermark" id="dcWatermark"></div><div class="dc-brand-line" id="dcBrandLine"></div><span class="dc-caption-status" id="dcCaptionStatus">Captions follow the spoken words</span></div></div></main><section class="dc-timeline"><div class="dc-timeline-top"><span class="dc-timeline-time" id="dcTimelineTime">0:00.0</span><span class="dc-timeline-help">Click a caption to jump · Space to preview</span><span class="spacer"></span></div><div class="dc-timeline-scroll" id="dcTimelineScroll"><div class="dc-ruler" id="dcRuler"></div><div class="dc-track-row"><div class="dc-track-label">Video</div><div class="dc-track-content"><div class="dc-video-block">${esc(clip.title||'Video')}</div></div></div><div class="dc-track-row"><div class="dc-track-label">Captions</div><div class="dc-track-content" id="dcCaptionTrack"></div></div><div class="dc-track-row"><div class="dc-track-label">Audio</div><div class="dc-track-content"><div class="dc-audio-block">${esc(clip.musicName||'Nasheed')}</div></div></div><div class="dc-playhead" id="dcPlayhead"></div></div></section></div>`;
  $('#dcEditorBack').onclick=()=>{selectedProjectId=clip.projectId;go('projects')};
  $('#dcUndo').onclick=undoEditor;$('#dcRedo').onclick=redoEditor;$('#dcSaveDraft').onclick=saveEditorDraft;$('#dcRenderClip').onclick=renderEditedClip;$('#dcPlayButton').onclick=togglePlayback;$('#dcOpenCaptionText')?.addEventListener('click',()=>{editor.tool='captions';editor.captionTab='text';renderEditorTool();setTimeout(()=>$('#dcCaptionText')?.focus(),0);});
  $('#dcSafeZones')?.addEventListener('click',()=>{editor.safeZones=!editor.safeZones;$('#dcSafeZone')?.classList.toggle('show',editor.safeZones);$('#dcSafeZones')?.classList.toggle('on',editor.safeZones);$('#dcSafeZones')?.setAttribute('aria-pressed',String(editor.safeZones))});
  bindVideo(clip);bindCanvasDrag();bindCaptionDrag();renderEditorTool();updateEditorPreview();renderTimeline();
  queueMicrotask(()=>verifyEditorControls());requestAnimationFrame(()=>animatePanel(panel));
  if(editor.draft.fitMode==='crop'&&editor.draft.smartFramingEnabled&&!editor.framingPlan)requestFramingPlan(true);
}
function toolButton(name,label,icon){return `<button class="dc-tool-button ${editor.tool===name?'on':''}" data-editor-tool="${name}" type="button"><span class="dc-tool-icon">${ICON[icon]}</span><span>${label}</span></button>`}
function verifyEditorControls(){
  const required=['dcEditorBack','dcUndo','dcRedo','dcSaveDraft','dcRenderClip','dcPlayButton'];
  const missing=required.filter(id=>!document.getElementById(id));
  if(missing.length)notify(`Editor controls failed to load: ${missing.join(', ')}`,'bad');
  $$('#view-editor button').forEach(button=>{if(!button.type)button.type='button'});
}
function updateEditorSaveState(){
  const state=$('#dcEditorSaveState');if(!state)return;
  state.textContent=editor.dirty?`Draft backed up locally${editor.localSavedAt?' · just now':''}`:'All changes saved';
  state.className=editor.dirty?'is-draft':'is-saved';
}
function selectEditorLayer(layer){
  editor.selectedLayer=['video','captions'].includes(layer)?layer:'none';
  const canvas=$('#dcVideoCanvas'),caption=$('#dcCaptionOverlay');
  canvas?.classList.toggle('is-video-selected',editor.selectedLayer==='video');caption?.classList.toggle('is-selected',editor.selectedLayer==='captions');
  $$('[data-select-layer]').forEach(button=>button.classList.toggle('on',button.dataset.selectLayer===editor.selectedLayer));
  if(editor.selectedLayer==='video'){editor.tool='canvas';renderEditorTool()}else if(editor.selectedLayer==='captions'&&editor.tool!=='captions'){editor.tool='captions';renderEditorTool()}
}
function nudgeEditorLayer(dx,dy){
  if(!editor.draft||editor.selectedLayer==='none')return;
  if(editor.selectedLayer==='video'){
    if(editor.draft.fitMode!=='crop')editor.draft.fitMode='crop';switchToManualFraming('Manual crop nudged with keyboard');
    editor.draft.cropPositionX=clamp(Number(editor.draft.cropPositionX??50)-dx,0,100);editor.draft.cropPositionY=clamp(Number(editor.draft.cropPositionY??50)-dy,0,100);applyFrameAtTime(editor.currentTime);
  }else{
    editor.draft.captionPositionX=clamp(Number(editor.draft.captionPositionX??50)+dx,7,93);editor.draft.captionPositionY=clamp(Number(editor.draft.captionPositionY??58)+dy,8,88);updateEditorPreview();
  }
  markEditorDirty();debouncedHistory();
}
function renderEditorTool(){
  const title={captions:'Captions',canvas:'Canvas',style:'Look',audio:'Audio',details:'Post details'}[editor.tool];$('#dcToolTitle').textContent=title;$$('[data-editor-tool]').forEach(b=>b.classList.toggle('on',b.dataset.editorTool===editor.tool));
  const box=$('#dcToolContent');if(!box)return;
  if(editor.tool==='captions')box.innerHTML=captionTool();
  if(editor.tool==='canvas')box.innerHTML=canvasTool();
  if(editor.tool==='style')box.innerHTML=styleTool();
  if(editor.tool==='audio')box.innerHTML=audioTool();
  if(editor.tool==='details')box.innerHTML=detailsTool();
  box.classList.remove('dc-panel-swap');void box.offsetWidth;box.classList.add('dc-panel-swap');
  bindToolInputs();
}
function captionTool(){
  const exact=editor.captionSource==='whisper',busy=editor.captionSyncStatus==='syncing';
  const offset=Number(editor.draft.captionTimingOffsetMs??0);
  const syncTitle=busy?'Synchronising speech…':exact?'Automatically synced to speech':editor.captionSource==='edited'?'Edits kept on speech timing':'Timing needs synchronising';
  const syncText=busy?'Reloading the exact Whisper word timestamps for this clip.':exact?'Every word follows its Whisper timestamp and captions disappear during silence.':'Press Sync captions to recover the original word-by-word speech timing.';
  return `<div class="dc-sync-card"><div class="dc-sync-top"><i class="dc-sync-dot ${busy?'busy':exact?'good':''}"></i><div class="dc-sync-copy"><strong>${syncTitle}</strong><span>${syncText}</span></div></div><div class="dc-sync-actions"><button type="button" class="dc-btn ${exact?'secondary':''}" id="dcSyncCaptions" ${busy?'disabled':''}>${busy?'Syncing…':'Sync captions'}</button><button type="button" class="dc-btn secondary" data-caption-nudge="-100">Earlier</button><button type="button" class="dc-btn secondary" data-caption-nudge="100">Later</button></div><div class="dc-field" style="margin-top:11px"><div class="dc-timing-readout"><span>Fine timing</span><b id="dcTimingLabel">${formatCaptionOffset(offset)}</b></div><input type="range" data-template-key="captionTimingOffsetMs" value="${offset}" min="-1500" max="1500" step="20"></div></div><div class="dc-subtabs">${['styles','text','format','position'].map(x=>`<button type="button" class="${editor.captionTab===x?'on':''}" data-caption-tab="${x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div>${editor.captionTab==='styles'?captionStyles():editor.captionTab==='text'?captionTextPanel():editor.captionTab==='format'?captionFormat():captionPosition()}`;
}

function captionStyles(){
  const styles=[['viral','Viral','Active spoken word'],['clean','Clean','Easy-to-read phrases'],['arabic','Arabic','Readable Arabic layout'],['cinema','Cinema','Lower cinematic captions']];
  return `<div class="dc-section"><h3>Caption style</h3><div class="dc-style-grid">${styles.map(([id,name,note])=>`<button type="button" class="dc-style-card" data-caption-style="${id}"><div class="dc-style-preview" style="${captionStylePreview(id)}">${id==='arabic'?'تذكير':'REMINDER'}</div><b>${name}</b><span>${note}</span></button>`).join('')}</div></div><div class="dc-caption-note">Drag the caption directly in the preview, or use Position. Guides snap at 25%, centre and 75%.</div>`;
}

function captionStylePreview(id){
  if(id==='gold')return'color:#d9b478;-webkit-text-stroke:1px #000';if(id==='clean')return'font-weight:600;background:#0008';if(id==='arabic')return"font-family:Amiri,serif;font-size:15px";if(id==='bold')return'font-size:13px;font-weight:900';if(id==='cinema')return"font-family:'Noto Serif',serif;font-size:11px";return'font-family:Manrope,sans-serif;font-weight:900';
}
function captionTextPanel(){
  const groups=captionSegments().slice(0,30);
  return `<div class="dc-section"><h3>Edit caption transcript</h3><textarea class="dc-caption-editor" id="dcCaptionText">${esc(editor.captionText)}</textarea><div class="dc-caption-note" style="margin-top:7px">Whisper word timings are preserved. When words are changed, DeenClipped maps them onto the original speech spans instead of stretching captions across silence.</div></div><div class="dc-section"><h3>Speech-timed segments</h3><div class="dc-caption-list">${groups.map(g=>`<button class="dc-caption-line" data-caption-start="${g.start}"><span>${formatClock(g.start)}</span><b>${esc(g.text)}</b></button>`).join('')}</div></div>`; 
}
function captionFormat(){
  const fonts=[['Manrope','Manrope'],['Roboto','Roboto'],['Lato','Lato'],['Noto Sans','Noto Sans'],['Noto Serif','Noto Serif'],['Cantarell','Cantarell'],['Play','Play'],['Andika','Andika'],['Liberation Sans','Liberation Sans'],['Liberation Serif','Liberation Serif'],['DejaVu Sans','DejaVu Sans'],['DejaVu Serif','DejaVu Serif'],['Amiri','Amiri'],['Scheherazade New','Scheherazade Arabic'],['Noto Naskh Arabic','Noto Naskh Arabic'],['Noto Kufi Arabic','Noto Kufi Arabic']];
  const emphasis=[['Noto Serif','Noto Serif'],['DejaVu Serif','DejaVu Serif'],['Liberation Serif','Liberation Serif'],['Manrope','Manrope'],['Roboto','Roboto'],['Lato','Lato'],['Amiri','Amiri']];
  return `<div class="dc-section"><h3>Type and layout</h3>${selectField('Caption mode','captionMode',[['dynamic-stack','Dynamic pop'],['word','Word highlight'],['phrase','Phrase captions']])}${selectField('Main font','captionFont',fonts)}${selectField('Important-word font','captionHighlightFont',emphasis)}${selectField('Arabic font','captionArabicFont',[['Amiri','Amiri'],['Scheherazade New','Scheherazade Arabic'],['Noto Naskh Arabic','Noto Naskh Arabic'],['Noto Kufi Arabic','Noto Kufi Arabic'],['Noto Sans Arabic','Noto Sans Arabic']])}${rangeField('Font size','captionFontSize',24,180,1)}${rangeField('Font weight','captionFontWeight',400,900,100)}${rangeField('Letter spacing','captionLetterSpacing',-4,12,.5)}${rangeField('Words per caption','captionMaxWords',1,12,1)}${checkField('Italic important words','captionHighlightItalic')}${checkField('Uppercase captions','captionUppercase')}</div><div class="dc-section"><h3>Speech flow</h3>${rangeField('Clear on silent gap','captionClearPause',.15,2,.05)}${rangeField('Hold after each word','captionHoldSeconds',0,.2,.01)}${rangeField('Maximum stacked words','captionStackMaxWords',1,6,1)}${rangeField('Stack frequency','captionStackProbability',0,1,.05)}<div class="dc-caption-note">Silence always clears the caption. These controls only decide how quickly it clears and how spoken words build on screen.</div></div><div class="dc-section"><h3>Clean emphasis</h3>${rangeField('Important-word glow','captionHighlightGlow',0,30,1)}<div class="dc-color-grid">${colorField('Text','captionPrimary')}${colorField('Important word','captionHighlight')}${colorField('Outline','captionOutline')}${colorField('Background','captionBackground')}</div>${rangeField('Outline','captionOutlineWidth',0,14,1)}${rangeField('Shadow','captionShadow',0,8,.5)}${rangeField('Background opacity','captionBackgroundOpacity',0,100,1)}${rangeField('Line spacing','captionLineHeight',.65,1.4,.05)}</div>`;
}
function captionPosition(){
  const key=`${editor.draft.captionPosition||'middle'}-${editor.draft.captionHorizontal||'center'}`;
  const positions=[['top-left','↖'],['top-center','↑'],['top-right','↗'],['middle-left','←'],['middle-center','•'],['middle-right','→'],['bottom-left','↙'],['bottom-center','↓'],['bottom-right','↘']];
  return `<div class="dc-section"><h3>Position</h3><div class="dc-position-grid">${positions.map(([p,l])=>`<button type="button" class="${p===key?'on':''}" data-caption-position="${p}">${l}</button>`).join('')}</div></div><div class="dc-section"><h3>Margins</h3>${rangeField('Vertical margin','captionMarginV',20,800,5)}${rangeField('Horizontal margin','captionMarginH',20,700,5)}</div>`;
}
function canvasTool(){
  const [stateTitle,stateText]=framingStatusCopy(),fill=editor.draft.fitMode||'contain',ai=fill==='crop'&&Boolean(editor.draft.smartFramingEnabled),ratio=ratioValue();
  return `<div class="dc-canvas-explainer"><b>Canvas changes only the video.</b> Captions stay in the position selected under Captions.</div><div class="dc-section"><h3>1 · Output frame</h3><div class="dc-segmented"><button type="button" class="${ratio==='9:16'?'on':''}" data-frame-ratio="9:16">Portrait 9:16</button><button type="button" class="${ratio==='16:9'?'on':''}" data-frame-ratio="16:9">Landscape 16:9</button></div><details class="dc-advanced"><summary>More frame sizes</summary><div style="margin-top:10px">${selectField('Other ratio','__ratio',[['9:16','Vertical 9:16'],['4:5','Portrait 4:5'],['1:1','Square 1:1'],['16:9','Landscape 16:9']])}</div></details></div><div class="dc-section"><h3>2 · Fit imported video</h3><div class="dc-fill-options"><button type="button" aria-pressed="${fill==='contain'}" class="dc-fill-option ${fill==='contain'?'on':''}" data-fill-mode="contain"><span class="dc-fill-swatch contain"></span><b>Fit</b><span>Show the complete source</span></button><button type="button" aria-pressed="${fill==='blur'}" class="dc-fill-option ${fill==='blur'?'on':''}" data-fill-mode="blur"><span class="dc-fill-swatch blur"></span><b>Blur</b><span>Full source over background</span></button><button type="button" aria-pressed="${fill==='crop'}" class="dc-fill-option ${fill==='crop'?'on':''}" data-fill-mode="crop"><span class="dc-fill-swatch crop"></span><b>Fill</b><span>Cover frame and crop edges</span></button></div><div class="dc-frame-note">${fill==='crop'?'Fill enlarges the imported video until the entire frame is covered. A landscape source becomes a proper vertical crop without stretching.':fill==='blur'?'The complete source stays visible while a blurred copy fills empty space.':'Nothing is cropped; empty space remains where needed.'}</div></div>${fill==='blur'?`<div class="dc-simple-card"><strong>Blur background</strong><span>The foreground remains sharp.</span>${rangeField('Blur strength','blurStrength',0,60,1)}</div>`:''}${fill==='crop'?`<div class="dc-section"><h3>3 · Framing</h3><div class="dc-segmented"><button type="button" class="${!ai?'on':''}" data-framing-mode="manual">Manual</button><button type="button" class="${ai?'on':''}" data-framing-mode="ai">AI speaker focus</button></div>${ai?`<div class="dc-simple-card" style="margin-top:10px"><strong>Follow the person speaking</strong><span>DeenClipped analyses faces and mouth movement through the clip, then creates smooth crop keyframes. Captions are not touched.</span><button type="button" class="dc-btn dc-ai-primary" id="dcAnalyseFraming" ${editor.framingStatus==='analysing'?'disabled':''}>${editor.framingStatus==='analysing'?'Analysing speaker…':'Analyse and track speaker'}</button><div class="dc-framing-state ${editor.framingStatus}"><i></i><div><strong>${esc(stateTitle)}</strong><span>${esc(stateText)}</span></div></div><details class="dc-advanced"><summary>Advanced tracking controls</summary><div style="margin-top:10px">${selectField('Fallback focus','smartFramingBias',[['auto','Automatic'],['left','Prefer left person'],['center','Prefer centre'],['right','Prefer right person']])}${rangeField('Crop zoom','smartFramingZoom',.75,1.35,.05)}${rangeField('Space around person','smartFramingPadding',.05,.45,.01)}${rangeField('Movement smoothing','smartFramingSmoothing',0,.95,.05)}<button type="button" class="dc-btn secondary" id="dcResetFraming" style="width:100%">Reset tracking</button></div></details></div>`:`<div class="dc-simple-card" style="margin-top:10px"><strong>Position the crop</strong><span>Drag the video to reposition it. Drag the white circle in the bottom-right corner to resize/zoom it.</span>${rangeField('Video size / zoom','smartFramingZoom',.75,2.5,.05)}<button type="button" class="dc-btn secondary" id="dcResetFraming" style="width:100%">Centre and reset size</button><details class="dc-advanced"><summary>Exact crop position</summary><div style="margin-top:10px">${rangeField('Horizontal','cropPositionX',0,100,1)}${rangeField('Vertical','cropPositionY',0,100,1)}</div></details></div>`}</div>`:''}${editor.captionSource==='fallback'?'<div class="dc-caption-warning">Caption timing is still estimated. Open Captions and press Auto-sync before exporting.</div>':''}`;
}

function styleTool(){
  const selected=DATA?.selectedTemplate;
  const clip=currentClip();
  const clipTemplate=(DATA?.templates||[]).find(template=>template.id===clip?.templateId);
  const savedName=selected?.name||'No template selected';
  const savedType=selected?.builtIn?'Built-in template':'Your saved template';
  const clipName=clipTemplate?.name||savedName;
  const sameTemplate=!clipTemplate||!selected||clipTemplate.id===selected.id;
  const templateStatus=`<div class="dc-simple-card" style="margin-bottom:12px"><strong>Saved default: ${esc(savedName)}</strong><span>${esc(savedType)} · All new clips use this template.</span>${sameTemplate?'':`<span style="margin-top:5px">This clip currently uses: <b style="color:var(--dc-text)">${esc(clipName)}</b></span>`}</div>`;
  const premium=Boolean(billingInfo().features?.customBranding),brand=data()?.brandSettings||{};
  const branding=`<div class="dc-section"><h3>Branding</h3><div class="dc-editor-brand-summary ${premium?'premium':'locked'}"><span>${ICON.brand}</span><div><strong>${premium?(brand.watermarkEnabled===false?'Clean export enabled':esc(brand.watermarkText||'DEENCLIPPED')):'DeenClipped watermark required'}</strong><small>${premium?'Your global Brand Kit is applied safely during rendering.':'Free exports are branded. Upgrade to customise or remove the watermark.'}</small></div><button type="button" class="dc-btn secondary" data-dc-nav="brand">${premium?'Open Brand Kit':'View premium'}</button></div></div>`;
  return `${templateStatus}<div class="dc-section"><h3>Video look</h3>${selectField('Filter','filterPreset',[['natural','Natural'],['crisp','Crisp'],['warm','Warm'],['cinematic','Cinematic'],['monochrome','Monochrome'],['custom','Custom']])}${rangeField('Brightness','brightness',-1,1,.05)}${rangeField('Contrast','contrast',.5,2,.05)}${rangeField('Saturation','saturation',0,3,.05)}<details class="dc-advanced"><summary>Advanced image controls</summary><div style="margin-top:10px">${rangeField('Sharpen','sharpen',0,2,.05)}${rangeField('Vignette','vignette',0,1,.05)}</div></details></div>${branding}<div class="dc-inline-actions"><button type="button" class="dc-btn secondary" id="dcSavePreset">Save as default for new clips</button><button type="button" class="dc-btn" id="dcApplyPresetAll">Apply default to new + old clips</button></div><div class="dc-caption-note" style="margin-top:7px">The saved default name is shown above. The second button saves the current look as that default and re-renders every existing clip with it.</div>`;
}

function audioTool(){
  editor.draft.musicVolumePercent ??= data()?.musicSettings?.volumePercent || 13;
  return `<div class="dc-section"><h3>Speech and music</h3>${checkField('Voice enhancement','voiceEnhance')}${rangeField('Nasheed volume','musicVolumePercent',1,50,1)}<button class="dc-btn secondary" id="dcSaveAudio" style="width:100%;margin-top:6px">Save global music level</button></div><div class="dc-caption-note">Music volume applies globally. Voice enhancement is stored with this editor style and used on the next render.</div>`;
}
function detailsTool(){
  const c=currentClip();
  return `<div class="dc-section"><h3>Post details</h3><div class="dc-field"><label>Title</label><input id="dcMetaTitle" value="${esc(c?.title||'')}"></div><div class="dc-field"><label>Description</label><textarea id="dcMetaDescription">${esc(c?.description||'')}</textarea></div><div class="dc-field"><label>Hashtags</label><textarea id="dcMetaHashtags">${esc(c?.hashtags||'')}</textarea></div><button class="dc-btn secondary" id="dcSaveDetails" style="width:100%">Save post details</button></div>`;
}
function selectField(label,key,options){
  const value=key==='__ratio'?ratioValue():editor.draft[key];
  return `<div class="dc-field"><label>${label}</label><select data-template-key="${key}">${options.map(([v,l])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
}
function rangeField(label,key,min,max,step){const value=editor.draft[key]??min;return `<div class="dc-field"><label><span>${label}</span><b data-value-for="${key}">${value}</b></label><input type="range" data-template-key="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></div>`}
function colorField(label,key){return `<div class="dc-field"><label>${label}</label><input type="color" data-template-key="${key}" value="${esc(editor.draft[key]||'#FFFFFF')}"></div>`}
function textField(label,key){return `<div class="dc-field"><label>${label}</label><input data-template-key="${key}" value="${esc(editor.draft[key]||'')}"></div>`}
function checkField(label,key){return `<label class="dc-check"><input type="checkbox" data-template-key="${key}" ${editor.draft[key]?'checked':''}>${label}</label>`}
function ratioValue(){const w=Number(editor.draft.width||1080),h=Number(editor.draft.height||1920);if(w===h)return'1:1';if(w===1080&&h===1350)return'4:5';if(w===1920&&h===1080)return'16:9';return'9:16'}

function bindToolInputs(){
  $$('[data-template-key]').forEach(input=>{
    const handler=()=>changeTemplateInput(input);input.addEventListener('input',handler);input.addEventListener('change',handler);
  });
  $('#dcCaptionText')?.addEventListener('input',event=>{
    editor.captionText=event.target.value;editor.captionWords=mapEditedWordsToSpeech(editor.captionText,editor.captionTimingReference.length?editor.captionTimingReference:editor.captionWords,Math.max(.1,editor.trimOut-editor.trimIn));editor.captionSource='edited';markEditorDirty();updateCaptionAtTime(editor.currentTime);renderTimeline();debouncedHistory();
  });
  $('#dcSaveAudio')?.addEventListener('click',saveAudioSettings);
  $('#dcSaveDetails')?.addEventListener('click',savePostDetails);
  $('#dcSavePreset')?.addEventListener('click',saveEditorPreset);$('#dcApplyPresetAll')?.addEventListener('click',applyPresetToAllClips);
  $('#dcSyncCaptions')?.addEventListener('click',resyncCaptions);
  $('#dcAnalyseFraming')?.addEventListener('click',()=>requestFramingPlan(true));
  $('#dcResetFraming')?.addEventListener('click',resetFraming);
}
function changeTemplateInput(input){
  const key=input.dataset.templateKey;let value=input.type==='checkbox'?input.checked:['range','number'].includes(input.type)?Number(input.value):input.value;
  if(key==='__ratio'){
    const map={'9:16':[1080,1920],'4:5':[1080,1350],'1:1':[1080,1080],'16:9':[1920,1080]};[editor.draft.width,editor.draft.height]=map[value];
  }else editor.draft[key]=value;
  if(key==='smartFramingEnabled'&&!value){editor.framingPlan=null;editor.framingStatus='idle';editor.framingMessage='Automatic framing is off';}
  $(`[data-value-for="${key}"]`)?.replaceChildren(document.createTextNode(String(value)));
  markEditorDirty();updateEditorPreview();updateCaptionAtTime(editor.currentTime);debouncedHistory();
  if(['__ratio','smartFramingEnabled','smartFramingBias','smartFramingZoom','smartFramingPadding','smartFramingSmoothing'].includes(key)&&editor.draft.fitMode==='crop'&&editor.draft.smartFramingEnabled)requestFramingPlan();
  if(key==='captionTimingOffsetMs'){const label=$('#dcTimingLabel');if(label)label.textContent=formatCaptionOffset(value);renderTimeline();}
  if(key==='smartFramingEnabled'||key==='__ratio')renderEditorTool();
}
function debouncedHistory(){clearTimeout(historyTimer);historyTimer=setTimeout(()=>pushHistory(),220)}
function pushHistory(initial=false){
  const snap=JSON.stringify({draft:cleanDraft(editor.draft),captionText:editor.captionText,captionWords:editor.captionWords,captionSource:editor.captionSource,framingPlan:editor.framingPlan});
  if(!initial&&editor.history[editor.historyIndex]===snap)return;
  editor.history=editor.history.slice(0,editor.historyIndex+1);editor.history.push(snap);if(editor.history.length>40)editor.history.shift();editor.historyIndex=editor.history.length-1;
  $('#dcUndo')?.toggleAttribute('disabled',editor.historyIndex<=0);$('#dcRedo')?.toggleAttribute('disabled',editor.historyIndex>=editor.history.length-1);
}
function undoEditor(){if(editor.historyIndex<=0)return;editor.historyIndex--;restoreHistory()}
function redoEditor(){if(editor.historyIndex>=editor.history.length-1)return;editor.historyIndex++;restoreHistory()}
function restoreHistory(){const snap=JSON.parse(editor.history[editor.historyIndex]);editor.draft={...snap.draft,__clipId:editor.clipId};editor.captionText=snap.captionText;editor.captionWords=Array.isArray(snap.captionWords)?snap.captionWords:approximateWords(editor.captionText,Math.max(.1,editor.trimOut-editor.trimIn));editor.captionSource=snap.captionSource||'edited';editor.framingPlan=snap.framingPlan||null;markEditorDirty(false);renderEditorTool();updateEditorPreview();updateCaptionAtTime(editor.currentTime);renderTimeline();$('#dcUndo')?.toggleAttribute('disabled',editor.historyIndex<=0);$('#dcRedo')?.toggleAttribute('disabled',editor.historyIndex>=editor.history.length-1)}
function markEditorDirty(){editor.dirty=true;saveEditorLocal()}

function applyCaptionStyle(id){
  const presets={
    viral:{captionMode:'dynamic-stack',captionFont:'Manrope',captionFontWeight:900,captionFontSize:100,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#09090A',captionOutlineWidth:5,captionBackgroundOpacity:0,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:4,captionUppercase:false},
    gold:{captionMode:'word',captionFont:'Lato',captionFontWeight:900,captionFontSize:92,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:5,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:5},
    clean:{captionMode:'phrase',captionFont:'Roboto',captionFontWeight:700,captionFontSize:72,captionPrimary:'#FFFFFF',captionHighlight:'#FFFFFF',captionOutline:'#000000',captionOutlineWidth:2,captionBackground:'#000000',captionBackgroundOpacity:55,captionPosition:'bottom',captionHorizontal:'center',captionMaxWords:7},
    arabic:{captionMode:'phrase',captionFont:'Amiri',captionFontSize:94,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:4,captionBackgroundOpacity:30,captionPosition:'bottom',captionHorizontal:'right',captionMaxWords:8},
    bold:{captionMode:'dynamic-stack',captionFont:'Manrope',captionFontWeight:900,captionFontSize:122,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:7,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:3,captionUppercase:true},
    cinema:{captionMode:'phrase',captionFont:'Noto Serif',captionFontWeight:700,captionFontSize:70,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:3,captionBackgroundOpacity:0,captionPosition:'bottom',captionHorizontal:'center',captionMaxWords:8}
  };
  Object.assign(editor.draft,presets[id]||{});markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();updateCaptionAtTime(editor.currentTime);renderTimeline();
}
function captionPresetPoint(vertical='middle',horizontal='center'){
  return {x:{left:22,center:50,right:78}[horizontal]??50,y:{top:24,middle:58,bottom:76}[vertical]??58};
}
function applyCaptionPosition(value){
  const [vertical,horizontal]=value.split('-'),point=captionPresetPoint(vertical,horizontal);
  Object.assign(editor.draft,{captionPosition:vertical,captionHorizontal:horizontal,captionPositionX:point.x,captionPositionY:point.y});
  markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();
}
function applyQuickLayout(id){
  editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;
  if(id==='speaker')Object.assign(editor.draft,{fitMode:'crop',smartFramingEnabled:true,smartFramingBias:'auto',smartFramingZoom:1,smartFramingPadding:.18,smartFramingSmoothing:.68});
  if(id==='full')Object.assign(editor.draft,{fitMode:'contain',smartFramingEnabled:false});
  if(id==='blur')Object.assign(editor.draft,{fitMode:'blur',smartFramingEnabled:false,blurStrength:Number(editor.draft.blurStrength||28)});
  if(id==='fill')Object.assign(editor.draft,{fitMode:'crop',smartFramingEnabled:false,cropPositionX:50,cropPositionY:50});
  if(id!=='speaker'){editor.framingPlan=null;editor.framingStatus='idle'}
  markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview();
  if(id==='speaker')requestFramingPlan(true);
}
function resetFraming(){
  editor.draft.cropPositionX=50;editor.draft.cropPositionY=50;editor.draft.smartFramingZoom=1;editor.framingPlan=null;editor.framingStatus='idle';editor.framingMessage='Framing reset';
  if(editor.draft.smartFramingEnabled)requestFramingPlan(true);else{markEditorDirty();pushHistory();renderEditorTool();updateEditorPreview()}
}
function switchToManualFraming(message='Manual crop selected'){
  if(!editor.draft)return;
  if(editor.draft.smartFramingEnabled||editor.framingPlan){
    editor.draft.smartFramingEnabled=false;editor.framingPlan=null;editor.framingStatus='idle';editor.framingMessage=message;
    editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;editor.draft.smartFramingZoom=clamp(Number(editor.draft.smartFramingZoom||1),.75,2.5);
    updateEditorPreview();if(editor.tool==='canvas')renderEditorTool();markEditorDirty(false);
  }
}
function bindCanvasDrag(){
  const canvas=$('#dcVideoCanvas'),video=$('#dcEditorVideo'),handle=$('#dcResizeHandle');if(!canvas||!video)return;
  let drag=null,resize=null;
  const ensureManual=()=>{if(!editor.draft)return false;if(editor.draft.fitMode!=='crop'){editor.draft.fitMode='crop';editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;}switchToManualFraming('Manual crop selected by dragging the video');return true};
  video.onpointerdown=event=>{
    if(event.button!==undefined&&event.button!==0)return;
    if(!ensureManual())return;selectEditorLayer('video');
    drag={x:event.clientX,y:event.clientY,px:Number(editor.draft.cropPositionX??50),py:Number(editor.draft.cropPositionY??50),pointerId:event.pointerId};
    canvas.classList.add('is-dragging','is-manual-crop');video.setPointerCapture?.(event.pointerId);event.stopPropagation();event.preventDefault();
  };
  video.onpointermove=event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    const rect=canvas.getBoundingClientRect();
    editor.draft.cropPositionX=clamp(drag.px-(event.clientX-drag.x)/Math.max(1,rect.width)*100,0,100);
    editor.draft.cropPositionY=clamp(drag.py-(event.clientY-drag.y)/Math.max(1,rect.height)*100,0,100);
    applyFrameAtTime(editor.currentTime);
  };
  const finishDrag=event=>{if(!drag||(event&&event.pointerId!==drag.pointerId))return;drag=null;canvas.classList.remove('is-dragging');markEditorDirty();pushHistory();renderEditorTool()};
  video.onpointerup=finishDrag;video.onpointercancel=finishDrag;
  if(handle){
    handle.onpointerdown=event=>{
      if(event.button!==undefined&&event.button!==0)return;
      if(!ensureManual())return;
      resize={x:event.clientX,y:event.clientY,start:Number(editor.draft.smartFramingZoom||1),pointerId:event.pointerId};
      canvas.classList.add('is-resizing','is-manual-crop');handle.setPointerCapture?.(event.pointerId);event.stopPropagation();event.preventDefault();
    };
    handle.onpointermove=event=>{if(!resize||event.pointerId!==resize.pointerId)return;const rect=canvas.getBoundingClientRect(),delta=((event.clientX-resize.x)+(event.clientY-resize.y))/Math.max(1,rect.width+rect.height)*2;editor.draft.smartFramingZoom=clamp(resize.start+delta,.75,2.5);applyFrameAtTime(editor.currentTime)};
    const finishResize=event=>{if(!resize||(event&&event.pointerId!==resize.pointerId))return;resize=null;canvas.classList.remove('is-resizing');markEditorDirty();pushHistory();renderEditorTool()};
    handle.onpointerup=finishResize;handle.onpointercancel=finishResize;
  }
  canvas.onwheel=event=>{if(editor.draft?.fitMode!=='crop')return;event.preventDefault();selectEditorLayer('video');switchToManualFraming('Manual crop selected by zooming');editor.draft.smartFramingZoom=clamp(Number(editor.draft.smartFramingZoom||1)+(event.deltaY<0?.05:-.05),.75,2.5);applyFrameAtTime(editor.currentTime);markEditorDirty();debouncedHistory()};
}

function bindCaptionDrag(){
  const canvas=$('#dcVideoCanvas'),overlay=$('#dcCaptionOverlay'),guideV=$('#dcSnapGuideV'),guideH=$('#dcSnapGuideH');
  if(!canvas||!overlay)return;
  let drag=null;
  const snapPoints=[25,50,75],snapDistance=2.5;
  const showGuide=(guide,value,vertical)=>{if(!guide)return;guide.classList.add('show');guide.style[vertical?'left':'top']=`${value}%`};
  const hideGuides=()=>{guideV?.classList.remove('show');guideH?.classList.remove('show')};
  const isResizeHit=event=>{const box=overlay.getBoundingClientRect();return event.clientX>=box.right-44&&event.clientY>=box.bottom-44};
  overlay.ondblclick=()=>{editor.tool='captions';editor.captionTab='text';renderEditorTool();setTimeout(()=>$('#dcCaptionText')?.focus(),0)};
  overlay.onpointerdown=event=>{
    if(event.button!==undefined&&event.button!==0)return;
    selectEditorLayer('captions');const rect=canvas.getBoundingClientRect();
    const mode=isResizeHit(event)?'resize':'move';
    drag={mode,pointerId:event.pointerId,startClientX:event.clientX,startClientY:event.clientY,startX:Number(editor.draft.captionPositionX??50),startY:Number(editor.draft.captionPositionY??58),startSize:Number(editor.draft.captionFontSize||96),rect};
    overlay.classList.add(mode==='resize'?'is-resizing':'is-dragging','is-selected');overlay.setPointerCapture?.(event.pointerId);event.stopPropagation();event.preventDefault();
  };
  overlay.onpointermove=event=>{
    if(!drag||event.pointerId!==drag.pointerId)return;
    if(drag.mode==='resize'){
      const delta=(event.clientX-drag.startClientX+event.clientY-drag.startClientY)/2;
      editor.draft.captionFontSize=clamp(drag.startSize+delta/Math.max(1,drag.rect.height)*260,24,160);
      overlay.style.fontSize=`${clamp(Number(editor.draft.captionFontSize||96)/3.45,15,52)}px`;
      return;
    }
    let x=drag.startX+(event.clientX-drag.startClientX)/Math.max(1,drag.rect.width)*100;
    let y=drag.startY+(event.clientY-drag.startClientY)/Math.max(1,drag.rect.height)*100;
    hideGuides();
    for(const point of snapPoints){if(Math.abs(x-point)<=snapDistance){x=point;showGuide(guideV,point,true);break}}
    for(const point of snapPoints){if(Math.abs(y-point)<=snapDistance){y=point;showGuide(guideH,point,false);break}}
    const box=overlay.getBoundingClientRect();
    const halfW=Math.min(43,box.width/Math.max(1,drag.rect.width)*50),halfH=Math.min(22,box.height/Math.max(1,drag.rect.height)*50);
    editor.draft.captionPositionX=clamp(x,7+halfW,93-halfW);
    editor.draft.captionPositionY=clamp(y,8+halfH,88-halfH);
    overlay.style.left=`${editor.draft.captionPositionX}%`;overlay.style.top=`${editor.draft.captionPositionY}%`;
  };
  const finish=event=>{
    if(!drag||(event&&event.pointerId!==drag.pointerId))return;
    drag=null;hideGuides();overlay.classList.remove('is-dragging','is-resizing');markEditorDirty();pushHistory();renderEditorTool();
  };
  overlay.onpointerup=finish;overlay.onpointercancel=finish;
  canvas.addEventListener('pointerdown',event=>{if(!event.target.closest('#dcCaptionOverlay')&&!event.target.closest('#dcResizeHandle'))selectEditorLayer(event.target.closest('.dc-video-layer')?'video':'none')});
}

function bindVideo(clip){
  const video=$('#dcEditorVideo'),bg=$('#dcEditorVideoBg');if(!video)return;
  const start=Number(clip.startSec||0),end=Number(clip.endSec||start+Number(clip.durationMs||0)/1000);
  editor.sourceBase=start;editor.sourceEnd=end;editor.trimOut=Math.max(.1,end-start);
  const initialise=()=>{
    if(!editor.sourceFallback){try{video.currentTime=start;if(bg)bg.currentTime=start}catch{}}
    renderTimeline();updateCaptionAtTime(0);applyFrameAtTime(0);
  };
  video.onloadedmetadata=initialise;
  video.onerror=()=>{
    if(editor.sourceFallback)return;
    editor.sourceFallback=true;video.pause();if(bg)bg.pause();
    const status=$('#dcCaptionStatus');if(status)status.textContent='Original source unavailable — preview fallback disabled to prevent doubled captions';
    notify('The original lecture file is unavailable. The editor will not load the rendered clip because that would duplicate burned-in captions.','bad');
  };
  video.ontimeupdate=()=>{
    const local=clamp(video.currentTime-editor.sourceBase,0,editor.trimOut);editor.currentTime=local;syncBackgroundVideo();updatePlayhead(local);updateCaptionAtTime(local);applyFrameAtTime(local);
    $('#dcCanvasTime').textContent=`${formatClock(local)} / ${formatClock(editor.trimOut)}`;$('#dcTimelineTime').textContent=formatClock(local,true);
    if(video.currentTime>=editor.sourceEnd-.02){video.pause();video.currentTime=editor.sourceBase;if(bg)bg.currentTime=editor.sourceBase}
  };
  video.onplay=()=>{editor.playing=true;$('#dcPlayButton').innerHTML=ICON.pause;if(bg){syncBackgroundVideo(true);bg.play().catch(()=>{})}};
  video.onpause=()=>{editor.playing=false;$('#dcPlayButton').innerHTML=ICON.play;bg?.pause()};
  $('#dcTimelineScroll').addEventListener('click',event=>{if(event.target.closest('[data-caption-start]'))return;const content=event.target.closest('.dc-track-content,.dc-ruler');if(!content)return;const rect=content.getBoundingClientRect();seekEditor(clamp((event.clientX-rect.left)/rect.width,0,1)*editor.trimOut)});
}
function togglePlayback(){const video=$('#dcEditorVideo');if(!video)return;if(video.currentTime<editor.sourceBase||video.currentTime>=editor.sourceEnd)video.currentTime=editor.sourceBase;video.paused?video.play():video.pause()}
function seekEditor(seconds){const video=$('#dcEditorVideo'),bg=$('#dcEditorVideoBg');if(!video)return;const local=clamp(seconds,0,editor.trimOut);video.currentTime=editor.sourceBase+local;if(bg)bg.currentTime=video.currentTime;editor.currentTime=local;updateCaptionAtTime(local);applyFrameAtTime(local)}
function updatePlayhead(time){const duration=editor.trimOut||1,scroll=$('#dcTimelineScroll'),width=editor.timelineWidth||scroll?.clientWidth||0;const left=72+(time/duration)*Math.max(1,width-72);const head=$('#dcPlayhead');if(head)head.style.left=`${left}px`;applyFrameAtTime(time);$$('.dc-caption-block').forEach(b=>b.classList.toggle('active',time>=Number(b.dataset.captionStart)&&time<Number(b.dataset.captionEnd)))}

function updateEditorPreview(){
  const d=editor.draft,canvas=$('#dcVideoCanvas'),video=$('#dcEditorVideo'),bg=$('#dcEditorVideoBg'),overlay=$('#dcCaptionOverlay'),water=$('#dcWatermark'),line=$('#dcBrandLine');if(!canvas||!d)return;
  canvas.style.aspectRatio=`${d.width||1080}/${d.height||1920}`;canvas.dataset.fill=d.fitMode||'contain';canvas.dataset.framing=d.fitMode==='crop'&&d.smartFramingEnabled?editor.framingStatus:'off';canvas.classList.toggle('is-manual-crop',d.fitMode==='crop');canvas.style.setProperty('--dc-canvas-background',d.frameBackground||'#000000');const badge=$('#dcLayerBadge');if(badge)badge.textContent=d.fitMode==='contain'?'Fit · full source':d.fitMode==='blur'?'Blur · full source':'Fill · drag/resize video';
  if(bg){bg.style.filter=`blur(${Math.max(0,Number(d.blurStrength||28))}px) brightness(.72)`;bg.style.display=d.fitMode==='blur'?'block':'none';bg.style.pointerEvents='none'}
  const filters={natural:'',crisp:'contrast(1.08) saturate(1.08)',warm:'sepia(.15) saturate(1.12)',cinematic:'contrast(1.14) saturate(.84)',monochrome:'grayscale(1)',custom:''};
  video.style.filter=`${filters[d.filterPreset]||''} brightness(${1+Number(d.brightness||0)}) contrast(${Number(d.contrast||1)}) saturate(${Number(d.saturation||1)})`;
  const keepOverlayState = ['is-selected','is-dragging','is-resizing'].filter(cls=>overlay.classList.contains(cls));
  overlay.className=`dc-caption-overlay align-${d.captionHorizontal||'center'} ${keepOverlayState.join(' ')}`.trim();overlay.style.left=`${clamp(Number(d.captionPositionX??50),7,93)}%`;overlay.style.top=`${clamp(Number(d.captionPositionY??58),8,88)}%`;
  overlay.style.fontFamily=d.captionFont||'Manrope';overlay.style.fontSize=`${clamp(Number(d.captionFontSize||96)/3.45,15,52)}px`;overlay.style.fontWeight=String(clamp(Number(d.captionFontWeight||800),400,900));overlay.style.letterSpacing=`${clamp(Number(d.captionLetterSpacing||0)/3.45,-1.2,3.5)}px`;overlay.style.color=d.captionPrimary||'#fff';overlay.style.webkitTextStroke=`${Number(d.captionOutlineWidth||0)/3}px ${d.captionOutline||'#000'}`;overlay.style.textShadow=`0 ${clamp(Number(d.captionShadow||0)/2,0,4)}px ${clamp(Number(d.captionShadow||0)*1.8,0,12)}px rgba(0,0,0,.58)`;overlay.style.textTransform=d.captionUppercase?'uppercase':'none';overlay.style.setProperty('--dc-cap-highlight',d.captionHighlight||'#fff');overlay.style.setProperty('--dc-cap-highlight-font',d.captionHighlightFont||'Noto Serif');overlay.style.setProperty('--dc-cap-arabic-font',d.captionArabicFont||'Amiri');overlay.style.setProperty('--dc-cap-highlight-style',d.captionHighlightItalic===false?'normal':'italic');overlay.style.setProperty('--dc-cap-highlight-glow',`${clamp(Number(d.captionHighlightGlow||0)/2.5,0,14)}px`);overlay.style.setProperty('--dc-cap-bg-color',hexAlpha(d.captionBackground||'#000000',clamp(Number(d.captionBackgroundOpacity||0)/100,0,1)));overlay.style.lineHeight=String(d.captionLineHeight||.9);
  water.textContent=d.watermark||'';water.className=`dc-watermark ${d.watermarkPosition||'top-center'}`;water.style.color=d.watermarkColor||'#d9b478';water.style.opacity=clamp(Number(d.watermarkOpacity||100)/100,0,1);water.style.fontSize=`${clamp(Number(d.watermarkFontSize||28)/2.3,7,28)}px`;
  line.style.display=d.brandLineEnabled?'block':'none';line.style.background=d.brandLineColor||'#d9b478';applyFrameAtTime(editor.currentTime);
}
function updateCaptionAtTime(time){
  const overlay=$('#dcCaptionOverlay');if(!overlay)return;
  if(overlay.classList.contains('is-dragging')||overlay.classList.contains('is-resizing'))return;
  // Writing innerHTML on every frame re-creates and re-lays-out every word,
  // which reads as a visible shimmer while speech is running. Build the
  // markup first, then only touch the DOM when it has genuinely changed.
  const html=captionHtmlAtTime(time);
  // Compare against what is actually on screen, not just what was cached.
  // The overlay is rebuilt when a clip is opened or captions are reloaded,
  // so trusting a cached string alone could wrongly skip a real render.
  if(html===editor._lastCaptionHtml&&overlay.innerHTML===html)return;
  editor._lastCaptionHtml=html;
  overlay.innerHTML=html;
}
function isArabicWord(value){return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(String(value||''))}
function captionHtmlAtTime(time){
  const words=editor.captionWords;if(!words.length)return'';
  const offset=Number(editor.draft.captionTimingOffsetMs??0)/1000;
  const speechTime=time-offset;
  const hold=Math.min(.2,Math.max(0,Number(editor.draft.captionHoldSeconds??.04)));
  const index=words.findIndex(w=>speechTime>=Number(w.start)&&speechTime<Number(w.end)+hold);if(index<0)return'';
  const mode=editor.draft.captionMode||'dynamic-stack',max=Math.max(1,Number(editor.draft.captionMaxWords||4)),groups=speechGroups(words,max,Number(editor.draft.captionClearPause||.42)),group=groups.find(g=>index>=g.startIndex&&index<=g.endIndex);
  if(!group)return'';
  const visible=mode==='dynamic-stack'?words.slice(group.startIndex,index+1):words.slice(group.startIndex,group.endIndex+1);
  const html=mode==='dynamic-stack'
    ?visible.map((w,i)=>`<span class="dc-caption-stack-line ${i===visible.length-1?'active':''} ${isArabicWord(w.word)?'is-arabic':''}">${esc(w.word)}</span>`).join('')
    :visible.map((w,i)=>`<span class="dc-caption-word ${group.startIndex+i===index?'active':''} ${isArabicWord(w.word)?'is-arabic':''}">${esc(w.word)}</span>`).join(' ');
  return `<span class="dc-caption-bg">${html}</span>`;
}

function approximateWords(text,duration){
  const tokens=String(text||'').trim().split(/\s+/).filter(Boolean);if(!tokens.length)return[];const step=Math.max(.12,duration/tokens.length);return tokens.map((word,i)=>({word,start:i*step,end:Math.min(duration,(i+1)*step)}));
}
function speechGroups(words,maxWords,clearPause=.42){
  const groups=[];let start=0;
  for(let i=0;i<words.length;i++){
    const current=words[i],next=words[i+1],count=i-start+1,punctuation=/[.!?…][”"'’)]?$/.test(String(current.word||'')),gap=next?Number(next.start)-Number(current.end):Infinity;
    if(count>=maxWords||punctuation||gap>=clamp(Number(clearPause)||.42,.15,2)||!next){groups.push({startIndex:start,endIndex:i,start:Number(words[start].start),end:Number(current.end),text:words.slice(start,i+1).map(w=>w.word).join(' ')});start=i+1}
  }
  return groups;
}
function mapEditedWordsToSpeech(text,reference,duration){
  const tokens=String(text||'').trim().split(/\s+/).filter(Boolean);if(!tokens.length)return[];
  const source=(reference||[]).filter(w=>Number.isFinite(Number(w.start))&&Number(w.end)>Number(w.start));
  if(!source.length)return approximateWords(text,duration);
  if(tokens.length===source.length)return tokens.map((word,i)=>({...source[i],word}));
  return tokens.map((word,index)=>{
    const position=tokens.length===1?0:index/(tokens.length-1)*(source.length-1),left=Math.floor(position),right=Math.min(source.length-1,Math.ceil(position)),mix=position-left;
    const start=Number(source[left].start)+(Number(source[right].start)-Number(source[left].start))*mix;
    const nextPosition=Math.min(source.length-1,position+Math.max(.65,source.length/tokens.length)),nLeft=Math.floor(nextPosition),nRight=Math.min(source.length-1,Math.ceil(nextPosition)),nMix=nextPosition-nLeft;
    const estimatedEnd=Number(source[nLeft].end)+(Number(source[nRight].end)-Number(source[nLeft].end))*nMix;
    return{word,start,end:Math.max(start+.08,Math.min(duration,estimatedEnd))};
  });
}
function captionSegments(){const offset=Number(editor.draft.captionTimingOffsetMs??0)/1000;return speechGroups(editor.captionWords,Math.max(1,Number(editor.draft.captionMaxWords||4)),Number(editor.draft.captionClearPause||.42)).map(g=>({start:clamp(g.start+offset,0,editor.trimOut),end:clamp(g.end+offset,0,editor.trimOut),text:g.text})).filter(g=>g.end>g.start)}
function renderTimeline(){
  const duration=editor.trimOut||Math.max(.1,Number(currentClip()?.durationMs||0)/1000)||1,ruler=$('#dcRuler'),track=$('#dcCaptionTrack'),scroll=$('#dcTimelineScroll');if(!ruler||!track)return;
  editor.timelineWidth=Math.max(scroll?.clientWidth||0,72+Math.ceil(duration*46));
  scroll?.style.setProperty('--dc-timeline-width',`${editor.timelineWidth}px`);
  ruler.innerHTML=Array.from({length:6},(_,i)=>`<span style="left:${i*20}%">${formatClock(duration*i/5)}</span>`).join('');
  const segments=captionSegments();
  track.innerHTML=segments.map(s=>{const left=100*s.start/duration,width=Math.max(1.8,100*(s.end-s.start)/duration);return `<button class="dc-caption-block" title="${esc(s.text)}" data-caption-start="${s.start}" data-caption-end="${s.end}" style="left:${left}%;width:${width}%;min-width:96px">${esc(s.text)}</button>`}).join('');
  updatePlayhead(editor.currentTime);
}

function formatCaptionOffset(value){
  const ms=Math.round(Number(value)||0);
  if(ms===0)return'No offset';
  return `${Math.abs(ms)} ms ${ms<0?'earlier':'later'}`;
}
function nudgeCaptionTiming(amount){
  editor.draft.captionTimingOffsetMs=clamp(Number(editor.draft.captionTimingOffsetMs??0)+Number(amount||0),-1500,1500);
  markEditorDirty();pushHistory();renderEditorTool();updateCaptionAtTime(editor.currentTime);renderTimeline();
}
async function resyncCaptions(){
  const clip=currentClip(),button=$('#dcSyncCaptions');if(!clip||editor.captionSyncStatus==='syncing')return;
  editor.captionSyncStatus='syncing';renderEditorTool();
  try{
    const payload=await callApi(`/api/clips/${encodeURIComponent(clip.id)}/captions/resync`,{method:'POST',body:'{}'});
    if(!Array.isArray(payload.words)||!payload.words.length)throw new Error('No speech timestamps were returned.');
    editor.captionWords=payload.words.map(w=>({start:Number(w.start),end:Number(w.end),word:String(w.word||'').trim()})).filter(w=>w.word&&w.end>w.start).sort((a,b)=>a.start-b.start);editor.captionTimingReference=clone(editor.captionWords);
    editor.captionText=payload.transcript||editor.captionWords.map(w=>w.word).join(' ');
    editor.captionSource='whisper';editor.captionSyncStatus='idle';editor.draft.captionTimingOffsetMs=0;markEditorDirty();pushHistory();renderEditorTool();updateCaptionAtTime(editor.currentTime);renderTimeline();notify('Captions synchronised to this clip');
  }catch(error){editor.captionSyncStatus='error';editor.captionSyncMessage=error.message;notify(error.message,'bad');renderEditorTool()}
}

async function saveEditorDraft(){
  const clip=currentClip();if(!clip||editor.saving||editor.exporting)return;editor.saving=true;const button=$('#dcSaveDraft');if(button){button.disabled=true;button.textContent='Saving + re-rendering…'};
  try{
    await savePostDetails(false);
    await callApi(`/api/clips/${encodeURIComponent(clip.id)}`,{method:'PATCH',body:JSON.stringify({transcript:editor.captionText})});
    const draft=cleanDraft(editor.draft),current=DATA?.selectedTemplate;
    let result;
    if(current?.builtIn){
      result=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...draft,id:'',name:'My DeenClipped Template'},select:true})});
    }else if(current?.id){
      result=await callApi(`/api/templates/${encodeURIComponent(current.id)}`,{method:'PUT',body:JSON.stringify({template:{...draft,id:current.id,name:current.name}})});
    }else{
      result=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...draft,id:'',name:'My DeenClipped Template'},select:true})});
    }
    editor.draft={...clone(result.template),__clipId:clip.id};
    editor.dirty=false;clearEditorLocal();
    const count=Number(result.propagation?.queued||0);
    notify(`Saved. ${count} unposted clip${count===1?'':'s'} queued with this exact template, including scheduled clips.`);
    await refreshData();renderEditor(currentClip()||clip);
  }catch(error){notify(error.message,'bad')}finally{editor.saving=false;if(button){button.disabled=false;button.textContent='Save'}}
}
async function savePostDetails(showToast=true){
  const clip=currentClip();if(!clip)return;
  const title=$('#dcMetaTitle')?.value??clip.title,description=$('#dcMetaDescription')?.value??clip.description,hashtags=$('#dcMetaHashtags')?.value??clip.hashtags;
  await callApi(`/api/clips/${encodeURIComponent(clip.id)}`,{method:'PATCH',body:JSON.stringify({title,description,hashtags})});
  if(showToast)notify('Post details saved');await refreshData();
}
async function saveAudioSettings(){
  try{await callApi('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Number(editor.draft.musicVolumePercent||13)})});notify('Music level saved');await refreshData()}catch(e){notify(e.message,'bad')}
}
async function saveEditorPreset(){
  const clip=currentClip(),draft=cleanDraft(editor.draft);
  const current=DATA?.selectedTemplate,isBuiltIn=Boolean(current?.builtIn);
  // Built-in templates are protected, so the first save has to create your
  // own copy. After that this keeps updating that same one, which is what
  // makes a single look apply everywhere rather than piling up presets.
  const message=isBuiltIn
    ?'Save this look as your template?\n\nEvery new clip will use it automatically.'
    :`Update your template "${current?.name||'Custom'}" with this look?\n\nEvery new clip will use it automatically.`;
  if(!confirm(message))return;
  const button=$('#dcSavePreset');if(button){button.disabled=true;button.textContent='Saving…'}
  try{
    let result;
    if(isBuiltIn){
      const name=prompt('Name your template',`${clip?.title?'My style':'My style'}`)||'My style';
      result=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...draft,id:'',name},select:true})});
    }else{
      result=await callApi(`/api/templates/${encodeURIComponent(current.id)}`,{method:'PUT',body:JSON.stringify({template:{...draft,id:current.id,name:current.name}})});
      await callApi('/api/template',{method:'POST',body:JSON.stringify({id:current.id})});
    }
    editor.draft={...clone(result.template),__clipId:clip?.id};
    markEditorDirty(false);pushHistory();
    notify('Saved. Every new clip now uses this look.');
    await refreshData();renderEditorTool();return result.template;
  }catch(e){notify(e.message,'bad');return null}
  finally{if(button){button.disabled=false;button.textContent='Save as default for new clips'}}
}
async function applyPresetToAllClips(){
  if(!confirm('Apply this exact layout to every existing clip?\n\nUnposted clips will be replaced. Posted clips will be created as new re-post variants.'))return;
  const button=$('#dcApplyPresetAll');if(button){button.disabled=true;button.textContent='Queueing all…'}
  try{
    const template=await saveEditorPreset();if(!template)return;
    const result=await callApi('/api/templates/apply-all',{method:'POST',body:JSON.stringify({templateId:template.id})});
    notify(`Queued ${result.queued} existing clip${result.queued===1?'':'s'}. ${result.skipped||0} skipped.`);await refreshData();
  }catch(e){notify(e.message,'bad')}finally{if(button){button.disabled=false;button.textContent='Apply default to new + old clips'}}
}

async function renderEditedClip(){
  const clip=currentClip(),button=$('#dcRenderClip');if(!clip||editor.exporting||editor.saving)return;editor.exporting=true;if(button){button.disabled=true;button.textContent='Queueing…'};
  try{
    const title=$('#dcMetaTitle')?.value??clip.title,description=$('#dcMetaDescription')?.value??clip.description,hashtags=$('#dcMetaHashtags')?.value??clip.hashtags;
    await callApi(`/api/clips/${encodeURIComponent(clip.id)}`,{method:'PATCH',body:JSON.stringify({title,description,hashtags,transcript:editor.captionText})});
    if(editor.draft.musicVolumePercent)await callApi('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Number(editor.draft.musicVolumePercent)})});
    const template=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...cleanDraft(editor.draft),id:'',name:`${clip.title||'Clip'} · Editor`},select:false})});
    const asVariant=clip.status==='posted';
    await callApi(`/api/clips/${encodeURIComponent(clip.id)}/rerender`,{method:'POST',body:JSON.stringify({templateId:template.template.id,asVariant})});
    editor.dirty=false;clearEditorLocal();notify(asVariant?'Edited repost variant queued':'Edited clip queued for rendering');await refreshData();go('home');
  }catch(error){notify(error.message,'bad')}finally{editor.exporting=false;if(button){button.disabled=false;button.textContent='Export video'}}
}
function cleanDraft(value){const d=clone(value);for(const key of ['__clipId','builtIn','editable','updatedAt','version','musicVolumePercent'])delete d[key];return d}
function currentClip(){return (data()?.clips||[]).find(c=>c.id===editor.clipId)||null}

function renderGlobalSearch(){
  const query=$('#dcGlobalSearch').value.trim().toLowerCase(),box=$('#dcSearchResults');if(!query){box.classList.remove('show');return}
  const d=data()||{},items=[];
  NAV.filter(x=>x[1].toLowerCase().includes(query)).slice(0,4).forEach(x=>items.push({type:'page',id:x[0],title:x[1],sub:'Open page'}));
  (d.projects||[]).filter(p=>`${p.title||''} ${p.url||''}`.toLowerCase().includes(query)).slice(0,4).forEach(p=>items.push({type:'project',id:p.id,title:p.title||'Lecture',sub:`${p.clipCount||0} clips`}));
  (d.clips||[]).filter(c=>`${c.title||''} ${c.projectTitle||''} ${c.transcript||''}`.toLowerCase().includes(query)).slice(0,6).forEach(c=>items.push({type:'clip',id:c.id,title:c.title||'Clip',sub:`${c.projectTitle||'Lecture'} · ${c.score||0}/100`,img:c.thumbUrl}));
  box.innerHTML=items.length?items.map(i=>`<button data-search-type="${i.type}" data-search-id="${esc(i.id)}">${i.img?`<img src="${authedUrl(i.img)}">`:'<div class="dc-social-logo">⌕</div>'}<div><strong>${esc(i.title)}</strong><span>${esc(i.sub)}</span></div></button>`).join(''):`<div class="dc-empty">No matches</div>`;box.classList.add('show');
}


const GUIDE_STEPS = [
  {view:'home',target:'[data-tour="home-hero"]',title:'Welcome to DeenClipped',copy:'This is the main workspace. The goal is simple: import a lecture, approve the best clips, polish the template, then publish or download.'},
  {view:'home',target:'#dcTokenPill',title:'Your 3-day trial wallet',copy:'New accounts start with 40 tokens for generating and editing clips. Free downloads include a DeenClipped watermark; social posting unlocks with Premium.'},
  {view:'home',target:'[data-tour="create-form"]',title:'Create your first clips',copy:'Paste a supported lecture link or upload a video, choose the look and clip length, then generate. The token estimate is always shown before processing.'},
  {view:'home',target:'[data-tour="happening-now"]',title:'Working now and next action',copy:'Home shows the current job, latest result, next post and any attention items so users do not need to hunt through menus.'},
  {view:'projects',target:'#view-projects',title:'Projects hold each lecture',copy:'Every lecture stays together with its clips, status, errors, thumbnails and history. Failed old projects can be retried or deleted.'},
  {view:'review',target:'#view-review',title:'Clip Review is the approval queue',copy:'This is where users approve, reject, schedule, regenerate titles, make clips shorter or longer and open style/video edits.'},
  {view:'editor',target:'#view-editor',title:'Editor for one clip',copy:'The editor is for precise changes only: captions, framing, template look, audio and export. The normal review page should handle quick clip actions.'},
  {view:'schedule',target:'#view-schedule',title:'Publishing slots stay organised',copy:'Approved clips fill the next open slot. Premium accounts can post to connected channels; everyone can still preview and download their work.'},
  {view:'publishing',target:'#view-publishing',title:'Connect your own channels',copy:'TikTok, YouTube, Instagram and Facebook connections stay private to your account, and nothing posts without the publishing rules you choose.'},
  {view:'home',target:'#dcTopbar',title:'You are ready',copy:'Search stays at the top, billing is always one click away, and you can replay this guide from Demo whenever you need it.'}
];
let guideIndex = 0;
let guideRenderToken = 0;
function openGuidedTour(index=0){
  guideIndex = clamp(index,0,GUIDE_STEPS.length-1);
  let layer = $('#dcGuideLayer');
  if(!layer){
    layer=document.createElement('div');layer.id='dcGuideLayer';layer.className='dc-guide-layer';
    layer.innerHTML='<div class="dc-guide-spot" id="dcGuideSpot"></div><div class="dc-guide-card" id="dcGuideCard"><h3 id="dcGuideTitle"></h3><p id="dcGuideCopy"></p><div class="dc-guide-progress"><i id="dcGuideBar"></i></div><div class="dc-guide-foot"><span class="dc-guide-count" id="dcGuideCount"></span><button class="dc-btn secondary" id="dcGuideClose">Close</button><button class="dc-btn secondary" id="dcGuideBack">Back</button><button class="dc-btn" id="dcGuideNext">Next</button></div></div>';
    document.body.appendChild(layer);
    $('#dcGuideClose').onclick=closeGuidedTour;$('#dcGuideBack').onclick=()=>{guideIndex=Math.max(0,guideIndex-1);renderGuidedTour()};$('#dcGuideNext').onclick=()=>{if(guideIndex>=GUIDE_STEPS.length-1)closeGuidedTour();else{guideIndex++;renderGuidedTour()}};
  }
  layer.classList.add('show');renderGuidedTour();
}
function closeGuidedTour(){seenSet('guided_demo','complete');$('#dcGuideLayer')?.remove()}
function visibleGuideTarget(selector){
  return $$(selector).find(element=>{
    if(!element?.isConnected)return false;
    const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
    return rect.width>8&&rect.height>8&&style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity||1)>.02;
  })||null;
}
function renderGuidedTour(){
  const token=++guideRenderToken;
  const step=GUIDE_STEPS[guideIndex]||GUIDE_STEPS[0];
  if(step.view && currentView!==step.view) go(step.view);
  setTimeout(()=>{
    if(token!==guideRenderToken)return;
    const target=visibleGuideTarget(step.target),spot=$('#dcGuideSpot'),card=$('#dcGuideCard');if(!spot||!card)return;
    $('#dcGuideTitle').textContent=step.title;$('#dcGuideCopy').textContent=step.copy;$('#dcGuideCount').textContent=`${guideIndex+1}/${GUIDE_STEPS.length}`;$('#dcGuideBar')?.style.setProperty('width',`${((guideIndex+1)/GUIDE_STEPS.length)*100}%`);$('#dcGuideBack').disabled=guideIndex===0;$('#dcGuideNext').textContent=guideIndex>=GUIDE_STEPS.length-1?'Finish':'Next';
    if(!target){spot.style.cssText='display:none';card.classList.add('dc-guide-missing');card.style.left=`${Math.max(14,(innerWidth-Math.min(360,innerWidth-28))/2)}px`;card.style.top=`${Math.max(14,(innerHeight-220)/2)}px`;return}
    card.classList.remove('dc-guide-missing');spot.style.display='block';target.scrollIntoView({block:'center',inline:'nearest',behavior:'auto'});
    setTimeout(()=>{
      if(token!==guideRenderToken)return;
      const liveTarget=visibleGuideTarget(step.target);if(!liveTarget){renderGuidedTour();return}
      const r=liveTarget.getBoundingClientRect(),pad=8;
      const left=Math.max(8,r.left-pad),top=Math.max(8,r.top-pad),right=Math.min(window.innerWidth-8,r.right+pad),bottom=Math.min(window.innerHeight-8,r.bottom+pad),width=Math.max(18,right-left),height=Math.max(18,bottom-top);
      spot.style.left=`${left}px`;spot.style.top=`${top}px`;spot.style.width=`${width}px`;spot.style.height=`${height}px`;
      const cardW=Math.min(360,window.innerWidth-28);let cx=Math.min(window.innerWidth-cardW-14,Math.max(14,left));let cy=top+height+14;
      if(cy+190>window.innerHeight)cy=Math.max(14,top-204);
      card.style.left=`${cx}px`;card.style.top=`${cy}px`;card.style.width=`${cardW}px`;
    },70);
  },70);
}

function providerInfo(provider){
  const d=data()||{}, social=d.social?.providers||{}, settings=d.publishingSettings||{};
  const metaMap={youtube:'youtube',tiktok:'tiktok',instagram:'meta',facebook:'meta'};
  const status=social[provider]||{};
  const setting=settings[provider]||{};
  const accounts=status.accounts||[];
  return {provider, connectProvider:metaMap[provider]||provider, status, setting, accounts, connected:Boolean(status.connected), configured:status.configured!==false, enabled:Boolean(setting.enabled), account:accounts.find(a=>a.id===setting.accountId)||accounts[0]||null};
}
function providerTitle(provider){return {youtube:'YouTube Shorts',tiktok:'TikTok',instagram:'Instagram Reels',facebook:'Facebook Reels'}[provider]||provider}
function providerSummary(info){
  if(!info.configured)return 'Needs API keys in Render environment variables.';
  if(!info.connected)return 'Ready to connect this publishing destination.';
  if(!info.enabled)return `${info.account?.name||'Connected account'} is connected. Turn it on when you are ready.`;
  if(info.provider==='tiktok')return `${info.account?.name||'TikTok account'} receives only clips you explicitly approve, using TikTok's current creator settings.`;
  return `${info.account?.name||'Account'} is ready for approved and scheduled clips.`;
}
function providerBadge(info){return !info.configured?'bad':info.enabled?'good':info.connected?'warn':''}

function premiumAccess(){
  const bill=billingInfo(),features=bill.features||{};
  return Boolean(features.premium||bill.current?.unlimited||['weekly','monthly','yearly'].includes(String(bill.current?.plan||'')));
}
function renderBrandKit(){
  const panel=$('#view-brand'),d=data();if(!panel||!d)return;
  const brand=d.brandSettings||{},premium=premiumAccess(),required=Boolean(d.billing?.features?.watermarkRequired);
  const text=required?'DEENCLIPPED':String(brand.watermarkText||'DEENCLIPPED');
  const enabled=required||brand.watermarkEnabled!==false;
  panel.innerHTML=`<div class="dc-brand-page">
    <section class="dc-product-hero dc-brand-hero"><div><span class="dc-product-kicker">${ICON.brand} Brand Kit</span><h1>Make every clip unmistakably yours.</h1><p>Keep your identity consistent across every render without rebuilding a template. Branding is applied by the server, so exports always match your plan.</p></div><div class="dc-premium-orb ${premium?'on':''}"><span>${ICON.brand}</span><strong>${premium?'Premium active':'Free plan'}</strong><small>${premium?'Watermark control unlocked':'DeenClipped mark required'}</small></div></section>
    <div class="dc-brand-layout"><section class="dc-brand-preview-card"><div class="dc-brand-phone"><img src="/marketing-assets/reel-beneficial.webp" alt="Brand watermark preview"><span class="dc-brand-watermark ${enabled?'':'off'}" id="dcBrandPreviewMark" style="--brand-color:${esc(brand.watermarkColor||'#D9B478')};--brand-opacity:${Number(brand.watermarkOpacity||88)/100}" data-position="${esc(brand.watermarkPosition||'top-center')}">${esc(text)}</span><i id="dcBrandPreviewLine" class="${brand.brandLineEnabled&&premium?'on':''}" style="--brand-color:${esc(brand.brandLineColor||'#D9B478')}"></i><div class="dc-brand-caption">WHAT YOU DO<br><em>consistently</em></div></div><div class="dc-brand-preview-copy"><strong>Live export preview</strong><span>Position, colour and visibility update as you edit.</span></div></section>
      <section class="dc-brand-controls"><div class="dc-brand-entitlement ${premium?'premium':'free'}"><span>${premium?ICON.check:ICON.warning}</span><div><strong>${premium?'Full brand control':'Free exports stay branded'}</strong><p>${premium?'Turn the watermark off for clean exports, use your own name, and add a branded colour line.':'Every free-token render includes “DEENCLIPPED”. Upgrade to switch it off or replace it with your own brand.'}</p></div>${premium?'':`<button class="dc-btn" id="dcBrandUpgrade">Unlock branding</button>`}</div>
        <form id="dcBrandForm" class="dc-brand-form"><label class="dc-switch-row wide"><span><strong>Show watermark</strong><span>${required?'Required on the free plan':'Turn branding on or off for every new render'}</span></span><input type="checkbox" name="watermarkEnabled" ${enabled?'checked':''} ${required?'disabled':''}></label><label class="wide">Watermark text<input name="watermarkText" maxlength="60" value="${esc(text)}" ${premium?'':'disabled'}></label><label class="${premium?'':'is-locked'}">Position<select name="watermarkPosition" ${premium?'':'disabled'}>${[['top-left','Top left'],['top-center','Top centre'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom centre'],['bottom-right','Bottom right']].map(([v,l])=>`<option value="${v}" ${(premium?brand.watermarkPosition:'top-center')===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="${premium?'':'is-locked'}">Colour<input name="watermarkColor" type="color" value="${esc(premium?(brand.watermarkColor||'#D9B478'):'#D9B478')}" ${premium?'':'disabled'}></label><label class="wide ${premium?'':'is-locked'}">Opacity <b id="dcBrandOpacityValue">${premium?Number(brand.watermarkOpacity||88):88}%</b><input name="watermarkOpacity" type="range" min="20" max="100" step="1" value="${premium?Number(brand.watermarkOpacity||88):88}" ${premium?'':'disabled'}></label><label class="dc-switch-row wide ${premium?'':'is-locked'}"><span><strong>Brand accent line</strong><span>Add a subtle colour edge to every clip</span></span><input type="checkbox" name="brandLineEnabled" ${brand.brandLineEnabled&&premium?'checked':''} ${premium?'':'disabled'}></label><label class="wide ${premium?'':'is-locked'}">Accent colour<input name="brandLineColor" type="color" value="${esc(brand.brandLineColor||'#D9B478')}" ${premium?'':'disabled'}></label><button class="dc-btn wide" type="submit">Save Brand Kit</button></form></section></div>
    <section class="dc-feature-ribbon"><article><span>${ICON.check}</span><strong>Server enforced</strong><p>Free accounts cannot bypass the watermark through browser requests.</p></article><article><span>${ICON.editor}</span><strong>One global identity</strong><p>New projects, rerenders and generated-more clips use the same branding.</p></article><article><span>${ICON.tiktok}</span><strong>Platform aware</strong><p>TikTok-safe publishing remains separated from normal downloadable exports.</p></article></section>
  </div>`;
  const form=$('#dcBrandForm');
  const paint=()=>{const fd=new FormData(form),mark=$('#dcBrandPreviewMark'),line=$('#dcBrandPreviewLine'),isOn=required||form.elements.watermarkEnabled.checked;mark.textContent=required?'DEENCLIPPED':String(fd.get('watermarkText')||'DEENCLIPPED');mark.dataset.position=String(fd.get('watermarkPosition')||'top-center');mark.style.setProperty('--brand-color',String(fd.get('watermarkColor')||'#D9B478'));mark.style.setProperty('--brand-opacity',Number(fd.get('watermarkOpacity')||88)/100);mark.classList.toggle('off',!isOn);line.classList.toggle('on',premium&&form.elements.brandLineEnabled.checked);line.style.setProperty('--brand-color',String(fd.get('brandLineColor')||'#D9B478'));$('#dcBrandOpacityValue').textContent=`${Number(fd.get('watermarkOpacity')||88)}%`};
  form.addEventListener('input',paint);form.addEventListener('change',paint);form.addEventListener('submit',saveBrandKit);
  if($('#dcBrandUpgrade'))$('#dcBrandUpgrade').onclick=openBillingModal;
  requestAnimationFrame(()=>animatePanel(panel));
}
async function saveBrandKit(event){
  event.preventDefault();const form=event.currentTarget,fd=new FormData(form),button=form.querySelector('[type=submit]');
  const payload={watermarkEnabled:form.elements.watermarkEnabled.checked,watermarkText:String(fd.get('watermarkText')||'DEENCLIPPED'),watermarkPosition:String(fd.get('watermarkPosition')||'top-center'),watermarkColor:String(fd.get('watermarkColor')||'#D9B478'),watermarkOpacity:Number(fd.get('watermarkOpacity')||88),brandLineEnabled:form.elements.brandLineEnabled.checked,brandLineColor:String(fd.get('brandLineColor')||'#D9B478')};
  try{button.disabled=true;button.textContent='Saving…';await callApi('/api/brand-settings',{method:'POST',body:JSON.stringify(payload)});notify('Brand Kit saved');await refreshData();renderBrandKit()}catch(error){notify(error.message,'bad');button.disabled=false;button.textContent='Save Brand Kit'}
}

const LAB_TOPICS=[
  ['Faith',['allah','faith','iman','tawakkul','trust','belief']],['Quran',['quran','surah','ayah','verse','recite']],['Prayer',['salah','prayer','sujood','masjid']],
  ['Character',['character','kindness','patience','sabr','honest','mercy']],['Dua',['dua','supplication','ask allah']],['Family',['family','parent','mother','father','marriage','children']],
  ['Akhirah',['akhirah','jannah','hellfire','death','judgement']],['Purpose',['purpose','dunya','life','success','deeds']]
];
function labTopic(clip){const text=`${clip.title||''} ${clip.description||''} ${clip.transcript||''}`.toLowerCase();return LAB_TOPICS.find(([,words])=>words.some(word=>text.includes(word)))?.[0]||'General reminders'}
function renderCreatorLab(){
  const panel=$('#view-lab'),d=data();if(!panel||!d)return;const clips=d.clips||[],premium=Boolean(d.billing?.features?.creatorLab||d.billing?.current?.unlimited);
  const scored=[...clips].sort((a,b)=>Number(b.score||0)-Number(a.score||0)),avg=Math.round(scored.reduce((sum,c)=>sum+Number(c.score||0),0)/Math.max(1,scored.length));
  const topicCounts=new Map();clips.forEach(c=>{const topic=labTopic(c);topicCounts.set(topic,(topicCounts.get(topic)||0)+1)});const topics=[...topicCounts.entries()].sort((a,b)=>b[1]-a[1]);
  const gaps=LAB_TOPICS.map(([name])=>name).filter(name=>!topicCounts.has(name)).slice(0,4);const strong=scored.filter(c=>Number(c.score||0)>=85),ready=clips.filter(c=>c.musicVerified&&c.renderVerified),waiting=clips.filter(c=>c.status==='waiting');
  const weeklyPlan=scored.slice(0,7);const body=premium?`<div class="dc-lab-grid"><section class="dc-lab-panel wide"><div class="dc-lab-head"><div><span>Next seven posts</span><h2>AI-ranked weekly lineup</h2></div><button class="dc-btn secondary" id="dcCopyLabPlan">Copy plan</button></div><div class="dc-lab-lineup">${weeklyPlan.length?weeklyPlan.map((clip,index)=>`<button data-edit-video-clip="${esc(clip.id)}"><span>${String(index+1).padStart(2,'0')}</span><div><strong>${esc(shortText(clip.title||'Untitled clip',58))}</strong><small>${esc(labTopic(clip))} · ${Number(clip.score||0)}/100 · ${esc(statusName(clip.status))}</small></div><i>${ICON.chevron}</i></button>`).join(''):`<div class="dc-lab-empty">Generate clips to build your first weekly lineup.</div>`}</div></section><section class="dc-lab-panel"><div class="dc-lab-head"><div><span>Content mix</span><h2>Topic coverage</h2></div></div><div class="dc-topic-cloud">${topics.length?topics.map(([name,count])=>`<span style="--weight:${Math.min(5,count)}"><b>${esc(name)}</b><em>${count}</em></span>`).join(''):'<p>No clip topics yet.</p>'}</div></section><section class="dc-lab-panel"><div class="dc-lab-head"><div><span>Opportunity</span><h2>Content gaps</h2></div></div><div class="dc-gap-list">${gaps.length?gaps.map(name=>`<div><span>${ICON.sparkles}</span><p><strong>${esc(name)}</strong><small>No recent clips cover this lane.</small></p></div>`).join(''):'<div><span>${ICON.check}</span><p><strong>Balanced library</strong><small>Your main content lanes are represented.</small></p></div>'}</div></section><section class="dc-lab-panel wide"><div class="dc-lab-head"><div><span>Hook intelligence</span><h2>Your strongest opening moments</h2></div><span class="dc-pill good">${strong.length} strong</span></div><div class="dc-lab-hooks">${strong.slice(0,6).map(c=>`<article><span>${Number(c.score||0)}</span><div><strong>${esc(shortText(c.title||'Strong clip',72))}</strong><small>${esc((c.scoreReasons||[])[0]||'Strong AI-selected opening and clear standalone context.')}</small></div><button class="dc-btn secondary" data-edit-video-clip="${esc(c.id)}">Refine</button></article>`).join('')||'<div class="dc-lab-empty">Clips scoring 85+ will appear here with their strongest hook reason.</div>'}</div></section></div>`:`<section class="dc-lab-locked"><div class="dc-lab-lock-icon">${ICON.lab}</div><span>Premium intelligence</span><h2>Turn your clip library into a content strategy.</h2><p>Creator Lab ranks a seven-post lineup, maps topic coverage, finds content gaps and surfaces the strongest hooks—using clips DeenClipped already understands.</p><div class="dc-lab-teasers"><span>Weekly lineup</span><span>Topic coverage</span><span>Content gaps</span><span>Hook intelligence</span></div><button class="dc-btn" id="dcLabUpgrade">Unlock Creator Lab</button></section>`;
  panel.innerHTML=`<div class="dc-lab-page"><section class="dc-product-hero dc-lab-hero"><div><span class="dc-product-kicker">${ICON.lab} Creator Lab</span><h1>Know what to publish next—and why.</h1><p>DeenClipped combines clip scores, real workflow state and topic coverage so your next action is obvious.</p></div><div class="dc-product-stats"><span><b>${clips.length}</b><em>clips analysed</em></span><span><b>${avg}</b><em>average score</em></span><span><b>${ready.length}</b><em>export ready</em></span><span><b>${waiting.length}</b><em>to review</em></span></div></section>${body}</div>`;
  if($('#dcLabUpgrade'))$('#dcLabUpgrade').onclick=openBillingModal;
  if($('#dcCopyLabPlan'))$('#dcCopyLabPlan').onclick=async()=>{const text=weeklyPlan.map((c,i)=>`${i+1}. ${c.title||'Untitled clip'} — ${labTopic(c)} — ${Number(c.score||0)}/100`).join('\n');try{await navigator.clipboard.writeText(text);notify('Weekly plan copied')}catch{notify('Copy was blocked by the browser','bad')}};
  requestAnimationFrame(()=>animatePanel(panel));
}

function renderTemplatesPage(){
  const panel=$('#view-templates'),d=data();if(!panel||!d)return;
  const templates=d.templates||[], selected=d.selectedTemplate||templates[0]||{};
  const custom=templates.filter(t=>!t.builtIn).length;
  const bulkAction=(d.clips||[]).length?`<div class="dc-studio-actions"><button class="dc-btn secondary" data-apply-template="${esc(selected.id||'')}">Apply default to clips</button></div>`:'';
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.style} Studio templates</span><h1>One look for every clip.</h1><p>Choose the default caption style here. Open a real clip when you want to make detailed visual changes.</p></div>${bulkAction}</section><div class="dc-studio-strip"><div class="dc-studio-stat"><strong>${templates.length}</strong><span>saved templates</span></div><div class="dc-studio-stat"><strong>${custom}</strong><span>custom looks</span></div><div class="dc-studio-stat"><strong>${esc(selected.name||'None')}</strong><span>current default</span></div></div><div class="dc-template-grid">${templates.map(templateCard).join('')||`<div class="dc-empty"><strong>No templates yet</strong><span>Save a look from the editor to reuse it here.</span></div>`}</div></div>`;
  requestAnimationFrame(()=>animatePanel(panel));
}
function templateCard(t){
  const selected=DATA?.selectedTemplate?.id===t.id;
  const more=`<details class="dc-clip-more"><summary>More</summary><div><button data-duplicate-template="${esc(t.id)}">Duplicate template</button>${!t.builtIn?`<button class="danger" data-delete-template="${esc(t.id)}">Delete template</button>`:''}</div></details>`;
  return `<article class="dc-template-card"><div class="dc-template-preview"><div class="dc-template-caption"><span>${esc(t.caption?.highlightStyle==='serif-italic'?'Modern':'BOLD')}</span><br><span style="font-size:.72em;color:${esc(t.caption?.highlightColor||'#fff')}">${esc(shortText(t.name||'Template',18))}</span></div></div><div class="dc-template-card-body"><div style="display:flex;align-items:center;gap:8px;justify-content:space-between"><h3>${esc(t.name||'Template')}</h3><span class="dc-pill ${selected?'good':''}">${selected?'Current':t.builtIn?'Built-in':'Custom'}</span></div><p>${esc(selected?'This look is used for new clips.':t.builtIn?'A ready-to-use DeenClipped caption style.':'Your reusable custom caption style.')}</p><div class="dc-template-actions simple"><button class="dc-btn" data-use-template="${esc(t.id)}" ${selected?'disabled':''}>${selected?'Current template':'Use template'}</button>${more}</div></div></article>`;
}
async function selectStudioTemplate(id){if(!id)return notify('Choose a template first','bad');try{await callApi('/api/template',{method:'POST',body:JSON.stringify({id})});notify('Template set as default');await refreshData();renderTemplatesPage()}catch(e){notify(e.message,'bad')}}
async function applyStudioTemplate(id){if(!id)return notify('Choose a template first','bad');if(!confirm('Apply this template to all existing clips that can be re-rendered?'))return;try{const r=await callApi('/api/templates/apply-all',{method:'POST',body:JSON.stringify({templateId:id})});notify(`Queued ${r.queued||0} clips for template update`);await refreshData();renderTemplatesPage()}catch(e){notify(e.message,'bad')}}
async function duplicateStudioTemplate(id){const base=(DATA?.templates||[]).find(t=>t.id===id);try{const r=await callApi(`/api/templates/${encodeURIComponent(id)}/duplicate`,{method:'POST',body:JSON.stringify({name:`${base?.name||'Template'} Copy`})});notify('Template duplicated');await refreshData();renderTemplatesPage()}catch(e){notify(e.message,'bad')}}
async function deleteStudioTemplate(id){if(!id)return;if(!confirm('Delete this custom template? Existing rendered videos remain unchanged.'))return;try{await callApi(`/api/templates/${encodeURIComponent(id)}`,{method:'DELETE'});notify('Template deleted');await refreshData();renderTemplatesPage()}catch(e){notify(e.message,'bad')}}
function renderInsightsPage(){
  const panel=$('#view-insights'),d=data();if(!panel||!d)return;
  const clips=d.clips||[], projects=d.projects||[];
  const approved=clips.filter(c=>['approved','scheduled','publishing','posted'].includes(c.status)).length;
  const waiting=clips.filter(c=>c.status==='waiting').length;
  const avg=Math.round(clips.reduce((a,c)=>a+Number(c.score||0),0)/Math.max(1,clips.length));
  const posted=clips.filter(c=>c.status==='posted').length;
  const hookStrong=clips.filter(c=>Number(c.hookScore||c.score||0)>=85).length;
  const failed=clips.filter(c=>String(c.status||'').includes('failed')).length + projects.filter(p=>String(p.status||'').includes('failed')).length;
  const insightAction=clips.length?`<div class="dc-studio-actions"><button class="dc-btn" data-dc-nav="review">Review clips</button></div>`:`<div class="dc-studio-actions"><button class="dc-btn" data-dc-nav="home">Create clips</button></div>`;
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.analytics} Studio insights</span><h1>Clip quality before social analytics.</h1><p>Until TikTok and Instagram performance data is connected, this page focuses on the signals DeenClipped already knows: scores, approvals, failed jobs and publishing readiness.</p></div>${insightAction}</section><div class="dc-studio-strip"><div class="dc-studio-stat"><strong>${clips.length}</strong><span>clips generated</span></div><div class="dc-studio-stat"><strong>${avg}</strong><span>average score</span></div><div class="dc-studio-stat"><strong>${approved}</strong><span>approved / scheduled</span></div><div class="dc-studio-stat"><strong>${posted}</strong><span>posted clips</span></div></div><div class="dc-insight-grid"><section class="dc-insight-panel"><h2>Quality signals</h2>${qualityRow('Strong hooks',hookStrong,clips.length)}${qualityRow('Waiting review',waiting,clips.length)}${qualityRow('Approved flow',approved,clips.length)}${qualityRow('Needs attention',failed,Math.max(1,failed+clips.length))}</section><section class="dc-insight-panel"><h2>Best next actions</h2><div class="dc-studio-roadmap"><div class="dc-road-step"><span>${ICON.review}</span><div><strong>Approve the strongest clips</strong><em>${waiting} clips are waiting in Clip Review.</em></div></div><div class="dc-road-step"><span>${ICON.style}</span><div><strong>Keep one template live</strong><em>${esc(d.selectedTemplate?.name||'No template selected')}</em></div></div><div class="dc-road-step"><span>${ICON.social}</span><div><strong>Connect channels</strong><em>${connectedPlatformCount(d)} publishing destinations connected.</em></div></div></div></section></div></div>`;
  requestAnimationFrame(()=>animatePanel(panel));
}
function qualityRow(label,value,total){const pct=Math.max(0,Math.min(100,Math.round(Number(value||0)/Math.max(1,Number(total||1))*100)));return `<div class="dc-quality-row"><span>${esc(label)}</span><div class="dc-quality-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`}
function connectedPlatformCount(d){const providers=d.social?.providers||{};return ['youtube','tiktok','instagram','facebook'].filter(p=>providerInfo(p).connected||providers[p]?.connected).length}
function publishingClipGroups(d){
  const clips=d.clips||[];
  return {
    queue:clips.filter(c=>['approved','ready','publish_failed'].includes(c.status)),
    scheduled:clips.filter(c=>['scheduled','publishing'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt||Infinity)-Number(b.scheduledAt||Infinity)),
    posted:clips.filter(c=>c.status==='posted').sort((a,b)=>Number(b.postedAt||b.updatedAt||0)-Number(a.postedAt||a.updatedAt||0))
  };
}
function publishingProvidersForClip(clip,providerInfos){
  const explicit=(clip.targets||[]).map(target=>typeof target==='string'?target:target?.provider).filter(Boolean);
  const enabled=providerInfos.filter(info=>info.connected&&info.enabled).map(info=>info.provider);
  const connected=providerInfos.filter(info=>info.connected).map(info=>info.provider);
  const keys=[...new Set(explicit.length?explicit:enabled.length?enabled:connected)];
  return keys.length?keys:['youtube','tiktok','instagram','facebook'];
}
function publishingWhen(clip,tab){
  const value=tab==='posted'?(clip.postedAt||clip.updatedAt):clip.scheduledAt;
  if(!value)return {primary:tab==='queue'?'Ready now':tab==='posted'?'Published':'Not scheduled',secondary:tab==='queue'?'Choose when to publish':'—'};
  const date=new Date(Number(value));
  if(Number.isNaN(date.getTime()))return {primary:statusName(clip.status),secondary:'—'};
  return {
    primary:new Intl.DateTimeFormat('en-AU',{weekday:'short',day:'numeric',month:'short'}).format(date),
    secondary:new Intl.DateTimeFormat('en-AU',{hour:'2-digit',minute:'2-digit'}).format(date)
  };
}
function publishingRow(clip,tab,providerInfos,projects){
  const providers=publishingProvidersForClip(clip,providerInfos),when=publishingWhen(clip,tab);
  const project=projects.find(item=>item.id===clip.projectId);
  const source=projectDisplayTitle(project||{})||'DeenClipped project';
  const thumb=clip.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="${esc(clip.title||'Clip')} thumbnail">`:ICON.play;
  const brands=providers.slice(0,3).map(key=>`<span class="dc-publish-brand ${esc(key)} ${providerInfos.find(info=>info.provider===key)?.connected?'on':''}" title="${esc(providerTitle(key))}">${socialSvg(key)}</span>`).join('');
  const more=providers.length>3?`<span class="dc-publish-brand-more">+${providers.length-3}</span>`:'';
  let primary='';
  if(tab==='queue')primary=`${publishingButton(clip.status==='publish_failed'?'Retry post':'Post now',`data-post-clip="${esc(clip.id)}"`,'primary')}${publishingButton('Schedule',`data-schedule-clip="${esc(clip.id)}"`,'secondary')}`;
  else if(tab==='scheduled')primary=clip.status==='publishing'?`<button class="dc-btn secondary" disabled>Sending…</button>`:publishingButton('Post now',`data-post-clip="${esc(clip.id)}"`,'primary');
  const score=Math.round(Number(clip.score||0));
  return `<article class="dc-publish-row">
    <div class="dc-publish-clip"><button class="dc-publish-thumb ${clip.thumbUrl?'':'empty'}" type="button" data-edit-style-clip="${esc(clip.id)}">${thumb}<span>${formatDuration(clip.durationMs)}</span></button><div class="dc-publish-copy"><strong>${esc(shortText(clip.title||'Untitled clip',64))}</strong><span>${esc(shortText(source,48))}</span><span class="dc-publish-meta"><i class="${score>=85?'score':'attention'}">${score?`${score}/100`:'Needs score'}</i><i>${esc(statusName(clip.status))}</i></span></div></div>
    <div class="dc-publish-when"><span>${ICON.clock}</span><div><b>${esc(when.primary)}</b><em>${esc(when.secondary)}</em></div></div>
    <div class="dc-publish-brands">${brands}${more}</div>
    <div class="dc-publish-actions">${primary}<button class="dc-btn secondary" data-download-clip="${esc(clip.id)}">Download</button><button class="dc-publish-more" type="button" data-edit-style-clip="${esc(clip.id)}" title="Open editor" aria-label="Open clip editor">•••</button></div>
  </article>`;
}
function publishingConnection(info){
  const state=!info.configured?'Setup needed':info.connected?'Connected':'Not connected';
  const name=info.account?.name||providerTitle(info.provider);
  return `<div class="dc-publish-connection"><span class="dc-publish-brand ${esc(info.provider)} ${info.connected?'on':''}">${socialSvg(info.provider)}</span><div><strong>${esc(providerTitle(info.provider))}</strong><small>${esc(info.connected?name:state)}</small><small class="dc-publish-connection-status"><i class="${info.connected?'on':''}"></i>${esc(state)}</small></div><button type="button" class="dc-publish-connection-action" data-dc-nav="publishing">${info.connected?'Manage':'Connect'}</button></div>`;
}
function publishingZoneOffset(date,timeZone){
  const parts=new Intl.DateTimeFormat('en-US',{timeZone,hour12:false,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}).formatToParts(date).reduce((out,part)=>{if(part.type!=='literal')out[part.type]=Number(part.value);return out},{});
  return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour%24,parts.minute,parts.second)-date.getTime();
}
function publishingWallToInstant(y,m,day,hh,mm,timeZone){
  const guess=Date.UTC(y,m-1,day,hh,mm,0);let stamp=guess-publishingZoneOffset(new Date(guess),timeZone);stamp=guess-publishingZoneOffset(new Date(stamp),timeZone);return stamp;
}
function publishingScheduleSlots(d,days=5){
  const zone=d.timezone||'Australia/Perth',parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).filter(part=>part.type!=='literal').map(part=>[part.type,Number(part.value)])),slots=[];
  for(let offset=0;offset<days;offset++){
    const base=new Date(Date.UTC(parts.year,parts.month-1,parts.day+offset)),y=base.getUTCFullYear(),m=base.getUTCMonth()+1,day=base.getUTCDate();
    for(const time of d.postTimes||[]){const [hh,mm]=String(time).split(':').map(Number);if(!Number.isFinite(hh)||!Number.isFinite(mm))continue;slots.push({dayKey:`${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`,time,at:publishingWallToInstant(y,m,day,hh,mm,zone)})}
  }
  return slots;
}
function publishingSlotBoard(d,projects){
  const slots=publishingScheduleSlots(d,publishingSlotDays),scheduled=(d.clips||[]).filter(clip=>Number(clip.scheduledAt)>0),now=Date.now();
  const occupied=new Set(),clipFor=slot=>{const clip=scheduled.find(item=>!occupied.has(item.id)&&Math.abs(Number(item.scheduledAt)-slot.at)<90000);if(clip)occupied.add(clip.id);return clip};
  const rows=slots.map(slot=>({slot,clip:clipFor(slot)})),nextOpen=rows.find(item=>!item.clip&&item.slot.at>=now),zone=d.timezone||'Australia/Perth';
  if(!rows.length)return `<div class="dc-publish-empty"><div><div class="dc-empty-icon">${ICON.clock}</div><strong>No posting slots configured</strong><p>Add posting times to the server configuration, then approved clips will reserve them automatically.</p></div></div>`;
  let currentDay='';
  return `<div class="dc-publish-slot-tools"><div><strong>Automatic slot queue</strong><span>${esc(zone)} · approve a clip and it takes the next open time</span></div><div class="sched-range" aria-label="Schedule range"><button class="${publishingSlotDays===1?'on':''}" data-publish-slot-days="1">Today</button><button class="${publishingSlotDays===5?'on':''}" data-publish-slot-days="5">5 days</button><button class="${publishingSlotDays===14?'on':''}" data-publish-slot-days="14">2 weeks</button></div></div><div class="schedule-board">${rows.map(({slot,clip})=>{
    let day='';
    if(slot.dayKey!==currentDay){currentDay=slot.dayKey;const label=new Intl.DateTimeFormat('en-AU',{timeZone:zone,weekday:'long',day:'numeric',month:'long'}).format(new Date(slot.at));day=`<div class="board-day ${slot.dayKey===rows[0]?.slot.dayKey?'today':''}"><span class="code">${esc(label)}</span><span class="board-day-n">${(d.postTimes||[]).length} posting windows</span></div>`}
    const isNext=!clip&&nextOpen?.slot.at===slot.at,project=clip?projects.find(item=>item.id===clip.projectId):null,source=clip?(projectDisplayTitle(project||{})||clip.projectTitle||'DeenClipped project'):'';
    const media=clip?(clip.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="${esc(clip.title||'Clip')} thumbnail">`:ICON.play):`<span class="slot-open-icon">+</span>`;
    const badges=clip?`<div class="slot-badges"><span class="safe-badge ${clip.musicVerified?'good':'bad'}">Music</span><span class="safe-badge ${clip.renderVerified?'good':'bad'}">Render</span><span class="safe-badge">${esc(statusName(clip.status))}</span></div>`:'';
    const actions=clip?`${publishingButton('Post now',`data-post-clip="${esc(clip.id)}"`)}<button class="dc-btn secondary" data-download-clip="${esc(clip.id)}">Download</button><button class="dc-btn secondary" data-edit-style-clip="${esc(clip.id)}">Preview</button>`:`<span class="slot-status">${isNext?'Next available':'Available'}</span>`;
    return `${day}<article class="slot-card ${clip?'':'open'} ${isNext?'next':''} ${slot.at<now?'past':''}"><div class="slot-time">${esc(slot.time)}</div><button class="slot-media ${clip?'':'empty'}" type="button" ${clip?`data-edit-style-clip="${esc(clip.id)}"`:''}>${media}</button><div class="slot-what"><div class="slot-title">${clip?esc(clip.title||'Untitled clip'):'Open posting slot'}</div><div class="slot-from">${clip?esc(source):isNext?'The next approved clip will be placed here':'Approve clips to fill the schedule automatically'}</div>${badges}</div><div class="slot-actions">${actions}</div></article>`;
  }).join('')}</div>`;
}
function renderPublishingWorkspace(){
  const panel=$('#view-schedule'),d=data();if(!panel||!d)return;
  const groups=publishingClipGroups(d),providers=['youtube','tiktok','instagram','facebook'].map(providerInfo),projects=d.projects||[];
  if(!['slots','queue','posted'].includes(publishingQueueTab))publishingQueueTab='slots';
  const active=groups[publishingQueueTab]||[], connected=providers.filter(info=>info.connected).length;
  const previewPool=[...groups.queue,...groups.scheduled,...groups.posted].filter(clip=>clip.thumbUrl).slice(0,2);
  const access=publishingAccess();
  const accessBanner=access.allowed?'':`<section class="dc-publish-access"><span>${ICON.billing}</span><div><strong>${esc(access.title)}</strong><p>${esc(access.copy)}</p></div><button class="dc-btn" data-open-billing>${esc(access.action)}</button></section>`;
  const rows=active.length?active.map(clip=>publishingRow(clip,publishingQueueTab,providers,projects)).join(''):`<div class="dc-publish-empty"><div><div class="dc-empty-icon">${publishingQueueTab==='posted'?ICON.check:ICON.publish}</div><strong>${publishingQueueTab==='queue'?'Nothing waiting to publish':publishingQueueTab==='scheduled'?'No scheduled posts':'No published clips yet'}</strong><p>${publishingQueueTab==='queue'?'Approve a clip in Review and it will appear here, ready for posting or scheduling.':publishingQueueTab==='scheduled'?'Schedule an approved clip and its delivery time will show here.':'Published clips and their download links will stay easy to find here.'}</p><button class="dc-btn" data-dc-nav="review">Open Review</button></div></div>`;
  const boardContent=publishingQueueTab==='slots'?`<div class="dc-publish-slot-wrap">${publishingSlotBoard(d,projects)}</div>`:`<div class="dc-publish-columns"><span>Clip</span><span>Publish time</span><span>Channels</span><span>Actions</span></div><div class="dc-publish-list">${rows}</div>`;
  const previews=previewPool.length?previewPool.map(clip=>{const platform=publishingProvidersForClip(clip,providers)[0]||'youtube';return `<button class="dc-publish-preview" type="button" data-edit-style-clip="${esc(clip.id)}">${clip.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="${esc(clip.title||'Clip')} preview">`:''}<i class="dc-publish-preview-platform ${esc(platform)}">${socialSvg(platform)}</i><span>${esc(shortText(clip.title||'Clip',42))}</span></button>`}).join(''):`<div class="dc-publish-preview empty">${ICON.play}</div><div class="dc-publish-preview empty">${ICON.play}</div>`;
  const nextClip=groups.scheduled[0]||groups.queue[0]||null,nextTab=groups.scheduled[0]?'scheduled':'queue',nextWhen=nextClip?publishingWhen(nextClip,nextTab):null;
  const nextCard=nextClip?`<section class="dc-publish-side-card dc-publish-next"><div class="dc-publish-next-head"><span>${ICON.clock} Up next</span><span class="dc-pill ${nextTab==='scheduled'?'good':'warn'}">${nextTab==='scheduled'?'Scheduled':'Ready'}</span></div><div class="dc-publish-next-body"><strong>${esc(shortText(nextClip.title||'Untitled clip',70))}</strong><span>${esc(nextWhen.primary)} · ${esc(nextWhen.secondary)}</span><div class="dc-publish-next-actions"><button class="dc-btn secondary" data-edit-style-clip="${esc(nextClip.id)}">Preview</button>${nextTab==='queue'?publishingButton('Schedule',`data-schedule-clip="${esc(nextClip.id)}"`):publishingButton('Post now',`data-post-clip="${esc(nextClip.id)}"`)}</div></div></section>`:`<section class="dc-publish-side-card dc-publish-next"><div class="dc-publish-next-head"><span>${ICON.clock} Up next</span><span class="dc-pill">Clear</span></div><div class="dc-publish-next-body"><strong>Your publishing queue is clear.</strong><span>Approve a clip and its next action will appear here.</span><div class="dc-publish-next-actions"><button class="dc-btn secondary" data-dc-nav="review">Open Review</button></div></div></section>`;
  panel.innerHTML=`<div class="dc-publish-page">
    <section class="dc-publish-hero"><div><span class="dc-publish-kicker">${ICON.publish} Publishing command centre</span><h1>Every clip, channel and posting window—in one view.</h1><p>Review the final look, choose the right channels, then post now or schedule for later. Nothing leaves your workspace without your approval.</p><div class="dc-publish-hero-actions"><button class="dc-btn secondary" data-dc-nav="review">Review clips</button><button class="dc-btn" data-dc-nav="publishing">Manage channels</button></div></div><div class="dc-publish-summary"><span class="ready"><b>${groups.queue.length}</b><em>ready</em></span><span class="scheduled"><b>${groups.scheduled.length}</b><em>scheduled</em></span><span class="posted"><b>${groups.posted.length}</b><em>posted</em></span></div></section>
    ${accessBanner}<div class="dc-publish-layout"><section class="dc-publish-board"><div class="dc-publish-board-top"><div class="dc-publish-live"><span>${ICON.analytics}</span><div><strong>Live publishing queue</strong><small>${publishingQueueTab==='slots'?'Approve a clip and it moves straight into the next open slot':`${connected} of 4 channels connected · manual approval stays on`}</small></div></div><div class="dc-publish-board-tools"><span class="dc-publish-health ${connected?'ready':''}"><i></i>${connected?`${connected} channel${connected===1?'':'s'} ready`:'Connect a channel'}</span><button class="dc-btn secondary" data-dc-nav="publishing">Connections</button></div></div><nav class="dc-publish-tabs" aria-label="Publishing status"><button class="dc-publish-tab ${publishingQueueTab==='slots'?'on':''}" data-publish-tab="slots">Slots <b>${(d.postTimes||[]).length}</b></button><button class="dc-publish-tab ${publishingQueueTab==='queue'?'on':''}" data-publish-tab="queue">Publishing queue <b>${groups.queue.length}</b></button><button class="dc-publish-tab ${publishingQueueTab==='posted'?'on':''}" data-publish-tab="posted">Posted <b>${groups.posted.length}</b></button></nav>${boardContent}<div class="dc-publish-board-foot"><span>Want to post to more platforms?</span><button data-dc-nav="publishing">Connect more accounts →</button></div></section>
      <aside class="dc-publish-side">${nextCard}<section class="dc-publish-side-card"><div class="dc-publish-side-head"><span>${ICON.social}</span><div><strong>Platform connections</strong><small>Your own accounts and pages.</small></div></div><div class="dc-publish-connection-list">${providers.map(publishingConnection).join('')}</div><button class="dc-btn secondary dc-publish-connect" data-dc-nav="publishing">＋ Connect more platforms</button></section><section class="dc-publish-side-card"><div class="dc-publish-side-head"><span>${ICON.play}</span><div><strong>Quick preview</strong><small>Check the final crop before posting.</small></div></div><div class="dc-publish-previews">${previews}</div></section></aside>
    </div>
  </div>`;
  requestAnimationFrame(()=>animatePanel(panel));
}
function renderConnections(){
  const panel=$('#view-publishing'),d=data();if(!panel||!d)return;
  const providers=['youtube','tiktok','instagram','facebook'].map(providerInfo);
  const connected=providers.filter(p=>p.connected).length, enabled=providers.filter(p=>p.enabled).length;
  const destinationSettings=connected?`<section class="dc-settings-panel"><h2>Active destinations</h2><p>Only connected channels appear here. TikTok always uses the latest options returned for the connected creator and requires explicit approval for every post.</p><div class="dc-settings-form">${providers.filter(p=>p.connected).map(p=>destinationControl(p)).join('')}<button class="dc-btn wide" id="dcSavePublishing">Save active destinations</button></div></section>`:'';
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.social} Publishing hub</span><h1>Your channels, one approval flow.</h1><p>Connect each destination once. You still choose which clips are approved, scheduled or published.</p></div><div class="dc-manage-metrics"><span><b>${connected}</b><em>connected</em></span><span><b>${enabled}</b><em>active</em></span><span><b>${d.directPublishingEnabled?'Ready':'Review'}</b><em>posting mode</em></span></div></section><div class="dc-manage-grid">${providers.map(connectionCard).join('')}</div>${destinationSettings}</div>`;
  if($('#dcSavePublishing'))$('#dcSavePublishing').onclick=savePublishingRules;
  requestAnimationFrame(()=>animatePanel(panel));
}
function destinationControl(info){
  const base=`<label class="dc-switch-row wide"><span><strong>${esc(providerTitle(info.provider))}</strong><span>${esc(info.account?.name||'Connected account')}</span></span><input type="checkbox" id="dcPub_${esc(info.provider)}" ${info.enabled?'checked':''}></label>`;
  if(info.provider!=='tiktok')return base;
  const creator=info.account?.creatorInfo||{}, options=Array.isArray(creator.privacy_level_options)?creator.privacy_level_options:[];
  const privacy=info.setting?.privacy||'SELF_ONLY';
  const labels={SELF_ONLY:'Only me',MUTUAL_FOLLOW_FRIENDS:'Friends',FOLLOWER_OF_CREATOR:'Followers',PUBLIC_TO_EVERYONE:'Everyone'};
  const choices=(options.length?options:['SELF_ONLY']).map(value=>`<option value="${esc(value)}" ${value===privacy?'selected':''}>${esc(labels[value]||value)}</option>`).join('');
  return `${base}<div class="dc-tiktok-controls"><label>Privacy<select id="dcTikTokPrivacy">${choices}</select></label><label class="dc-switch-row"><span><strong>Allow comments</strong><span>${creator.comment_disabled?'Unavailable for this account':'Viewer comments on this post'}</span></span><input type="checkbox" id="dcTikTokComments" ${info.setting?.allowComments!==false&&!creator.comment_disabled?'checked':''} ${creator.comment_disabled?'disabled':''}></label><label class="dc-switch-row"><span><strong>Allow Duet</strong><span>${creator.duet_disabled?'Unavailable for this account':'Let viewers create Duets'}</span></span><input type="checkbox" id="dcTikTokDuet" ${info.setting?.allowDuet&&!creator.duet_disabled?'checked':''} ${creator.duet_disabled?'disabled':''}></label><label class="dc-switch-row"><span><strong>Allow Stitch</strong><span>${creator.stitch_disabled?'Unavailable for this account':'Let viewers create Stitches'}</span></span><input type="checkbox" id="dcTikTokStitch" ${info.setting?.allowStitch&&!creator.stitch_disabled?'checked':''} ${creator.stitch_disabled?'disabled':''}></label><p class="dc-tiktok-review-note">Posting as <b>${esc(info.account?.name||'TikTok creator')}</b>${creator.max_video_post_duration_sec?` · maximum ${esc(creator.max_video_post_duration_sec)} seconds`:''}. Test the connection again whenever TikTok options change.</p></div>`;
}
function connectionCard(info){
  const connectLabel=info.connected?'Reconnect':'Connect';
  const account=info.account?.name||'No account linked';
  const secondary=info.connected?`<details class="dc-clip-more"><summary>More</summary><div><button data-social-test="${esc(info.connectProvider)}">Test connection</button><button class="danger" data-social-disconnect="${esc(info.connectProvider)}">Disconnect</button></div></details>`:'';
  return `<article class="dc-manage-card"><div class="dc-manage-card-top"><span class="dc-manage-logo dc-social-logo ${esc(info.provider)}">${socialSvg(info.provider)}</span><div class="dc-manage-copy"><strong>${esc(providerTitle(info.provider))}</strong><span>${esc(providerSummary(info))}</span></div><span class="dc-pill ${providerBadge(info)}">${info.enabled?'Active':info.connected?'Connected':info.configured?'Not connected':'Setup needed'}</span></div><div class="dc-manage-list"><div class="dc-manage-row"><div><strong>${esc(account)}</strong><span>${info.status.lastTestAt?`Checked ${formatRelative(info.status.lastTestAt)}`:info.status.lastTestError?`Connection issue: ${shortError(info.status.lastTestError)}`:info.connected?'Ready to test and publish.':'Connect to make this destination available.'}</span></div></div></div><div class="dc-manage-actions simple ${info.connected?'two':''}"><button class="dc-btn" data-social-connect="${esc(info.connectProvider)}" ${!info.configured?'disabled':''}>${connectLabel}</button>${secondary}</div></article>`;
}
async function beginSocialConnection(provider){try{const result=await callApi(`/api/social/${encodeURIComponent(provider)}/connect`,{method:'POST'});if(result.url)location.href=result.url;else notify('Connect URL was not returned','bad')}catch(e){notify(e.message,'bad')}}
function connectSocial(provider){
  if(provider!=='youtube')return beginSocialConnection(provider);
  $('#dcYouTubeConsentLayer')?.remove();
  const layer=document.createElement('div');layer.id='dcYouTubeConsentLayer';layer.className='dc-billing-notice-layer';
  layer.innerHTML=`<section class="dc-billing-notice-card dc-youtube-consent-card" role="dialog" aria-modal="true" aria-labelledby="dcYouTubeConsentTitle"><div class="dc-billing-notice-head"><div><span>${socialSvg('youtube')} YouTube connection</span><h2 id="dcYouTubeConsentTitle">Choose exactly what DeenClipped may do.</h2><p>Google will show these permissions again before anything is connected.</p></div><button class="dc-notice-close" id="dcYouTubeConsentClose" type="button" aria-label="Close">×</button></div><div class="dc-billing-notice-body"><div class="dc-charge-terms"><span>Read your connected channel identity so DeenClipped can show and test the correct destination.</span><span>Upload only the clips you explicitly approve or schedule for that channel.</span><span>Store the encrypted connection token until you disconnect; no Google password, watch history or browser cookies are requested.</span><span>Disconnecting removes the stored credential, disables future uploads and asks Google to revoke access.</span></div><p class="dc-charge-muted">DeenClipped's use of Google data follows its <a href="/privacy" target="_blank" rel="noopener">Privacy Policy</a>, the <a href="/terms" target="_blank" rel="noopener">Terms of Service</a> and Google's Limited Use requirements.</p><div class="dc-billing-notice-actions"><button class="dc-btn secondary" id="dcYouTubeConsentCancel" type="button">Cancel</button><button class="dc-btn" id="dcYouTubeConsentContinue" type="button">I understand — Continue to Google</button></div></div></section>`;
  document.body.appendChild(layer);
  const close=()=>layer.remove();
  $('#dcYouTubeConsentClose').onclick=close;$('#dcYouTubeConsentCancel').onclick=close;
  $('#dcYouTubeConsentContinue').onclick=()=>{close();beginSocialConnection('youtube')};
  layer.addEventListener('click',event=>{if(event.target===layer)close()});
}
async function testSocial(provider){try{await callApi(`/api/social/${encodeURIComponent(provider)}/test`,{method:'POST',body:JSON.stringify({})});notify('Connection test passed');await refreshData();renderConnections()}catch(e){notify(e.message,'bad');await refreshData();renderConnections()}}
async function disconnectSocial(provider){if(!confirm(`Disconnect ${provider}?`))return;try{await callApi(`/api/social/${encodeURIComponent(provider)}/disconnect`,{method:'POST'});notify('Disconnected');await refreshData();renderConnections()}catch(e){notify(e.message,'bad')}}
async function savePublishingRules(){
  const d=data()||{}, current=d.publishingSettings||{};
  const next={enabled:false,youtube:{...(current.youtube||{}),enabled:$('#dcPub_youtube')?.checked||false},instagram:{...(current.instagram||{}),enabled:$('#dcPub_instagram')?.checked||false,shareToFeed:true},facebook:{...(current.facebook||{}),enabled:$('#dcPub_facebook')?.checked||false},tiktok:{...(current.tiktok||{}),enabled:$('#dcPub_tiktok')?.checked||false,privacy:$('#dcTikTokPrivacy')?.value||current.tiktok?.privacy||'SELF_ONLY',allowComments:$('#dcTikTokComments')?.checked??current.tiktok?.allowComments!==false,allowDuet:$('#dcTikTokDuet')?.checked??Boolean(current.tiktok?.allowDuet),allowStitch:$('#dcTikTokStitch')?.checked??Boolean(current.tiktok?.allowStitch)}};
  next.enabled=['youtube','instagram','facebook','tiktok'].some(p=>next[p].enabled);
  ['youtube','instagram','facebook','tiktok'].forEach(p=>{const info=providerInfo(p);if(info.account&&!next[p].accountId)next[p].accountId=info.account.id});
  try{await callApi('/api/publishing-settings',{method:'POST',body:JSON.stringify(next)});notify('Publishing rules saved');await refreshData();renderConnections()}catch(e){notify(e.message,'bad')}
}
function renderAudioLibrary(){
  const panel=$('#view-music'),d=data();if(!panel||!d)return;
  const tracks=d.tracks||[], settings=d.musicSettings||{};
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.music} Audio library</span><h1>Clean background audio for every render.</h1><p>Upload nasheed tracks, preview them, remove old ones and keep the mix low under the speaker.</p></div><div class="dc-manage-metrics"><span><b>${tracks.length}</b><em>tracks</em></span><span><b>${settings.volumePercent||13}%</b><em>volume</em></span><span><b>${settings.shuffle!==false?'On':'Off'}</b><em>shuffle</em></span></div></section><div class="dc-settings-grid"><section class="dc-settings-panel"><h2>Upload nasheed</h2><p>Add a clean MP3, M4A, WAV or OGG track. It can rotate through new renders.</p><div class="dc-upload-zone"><input type="file" id="dcMusicFile" accept="audio/*"><button class="dc-btn" id="dcUploadMusic">Upload track</button></div></section><section class="dc-settings-panel"><h2>Global audio level</h2><p>Keep this low so speech stays clear.</p><div class="dc-settings-form"><label class="wide">Music volume %<input type="number" min="1" max="50" id="dcMusicVolume" value="${esc(settings.volumePercent||13)}"></label><button class="dc-btn wide" id="dcSaveMusicSettings">Save audio settings</button></div></section></div><div class="dc-manage-grid">${tracks.length?tracks.map(trackCard).join(''):`<div class="dc-review-empty-pro"><div><div class="dc-empty-icon">${ICON.music}</div><strong>No audio tracks yet</strong><p>Add a nasheed track to give rendered clips consistent background audio.</p></div></div>`}</div></div>`;
  $('#dcUploadMusic').onclick=uploadTrack;
  $('#dcSaveMusicSettings').onclick=saveMusicSettings;
  requestAnimationFrame(()=>animatePanel(panel));
}
function trackCard(t){return `<article class="dc-manage-card"><div class="dc-manage-card-top"><span class="dc-manage-logo">${ICON.music}</span><div class="dc-manage-copy"><strong>${esc(t.name||'Nasheed track')}</strong><span>${esc(t.durationSec?formatClock(t.durationSec):'Background audio')}</span></div><span class="dc-pill good">Ready</span></div><div class="dc-manage-list"><div class="dc-manage-row"><audio controls preload="none" src="${authedUrl(`/api/music/${encodeURIComponent(t.id)}/audio`)}"></audio></div></div><div class="dc-manage-actions"><button class="dc-btn secondary" disabled>Used in renders</button><button class="dc-btn danger" data-delete-track="${esc(t.id)}">Delete</button></div></article>`}
function fileToBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result||'').split(',')[1]||'');reader.onerror=()=>reject(reader.error||new Error('Could not read file'));reader.readAsDataURL(file)})}
async function uploadTrack(){const file=$('#dcMusicFile')?.files?.[0];if(!file)return notify('Choose an audio file first','bad');try{const data64=await fileToBase64(file);await callApi('/api/music',{method:'POST',body:JSON.stringify({name:file.name,data:data64,mimeType:file.type||'audio/mpeg'})});notify('Track uploaded');await refreshData();renderAudioLibrary()}catch(e){notify(e.message,'bad')}}
async function saveMusicSettings(){try{await callApi('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Number($('#dcMusicVolume')?.value||13)})});notify('Audio settings saved');await refreshData();renderAudioLibrary()}catch(e){notify(e.message,'bad')}}
async function deleteTrack(id){if(!confirm('Delete this audio track?'))return;try{await callApi(`/api/music/${encodeURIComponent(id)}`,{method:'DELETE'});notify('Track deleted');await refreshData();renderAudioLibrary()}catch(e){notify(e.message,'bad')}}
function renderSettingsPage(){
  const panel=$('#view-automation'),d=data();if(!panel||!d)return;
  const auto=d.automationSettings||{}, clip=d.clipSettings||{};
  const alerts=notificationPrefs(),permission=notificationPermissionCopy();
  const alertToggle=(id,title,copy,checked)=>`<label class="dc-switch-row"><span><strong>${esc(title)}</strong><span>${esc(copy)}</span></span><input type="checkbox" id="${id}" ${checked?'checked':''}></label>`;
  panel.innerHTML=`<div class="dc-manage-page">
    <section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.settings} Studio settings</span><h1>Real controls for generation, alerts and posting.</h1><p>Tune clip generation, automatic approval and the moments DeenClipped should announce. Source uploads stay inside each customer’s private workspace.</p></div><div class="dc-manage-metrics"><span><b>${auto.enabled?'On':'Off'}</b><em>automation</em></span><span><b>${permission.label}</b><em>alerts</em></span><span><b>${clip.clipMaxSeconds||60}s</b><em>max length</em></span></div></section>
    <div class="dc-settings-grid">
      <section class="dc-settings-panel"><h2>Clip generation</h2><p>These defaults apply to new lecture imports.</p><div class="dc-settings-form"><label>Clips per lecture<input type="number" min="1" max="30" id="dcSetClipCount" value="${esc(clip.clipsPerVideo||8)}"></label><label>Minimum seconds<input type="number" min="3" max="180" id="dcSetMinSec" value="${esc(clip.clipMinSeconds||30)}"></label><label>Maximum seconds<input type="number" min="3" max="180" id="dcSetMaxSec" value="${esc(clip.clipMaxSeconds||60)}"></label><button class="dc-btn wide" id="dcSaveClipSettings">Save generation settings</button></div></section>
      <section class="dc-settings-panel"><h2>Automation rules</h2><p>Controls which generated clips are allowed into the automatic workflow.</p><div class="dc-settings-form"><label class="dc-switch-row wide"><span><strong>Automation enabled</strong><span>Approve strong clips automatically</span></span><input type="checkbox" id="dcAutoEnabled" ${auto.enabled?'checked':''}></label><label>Minimum score<input type="number" min="1" max="100" id="dcAutoScore" value="${esc(auto.minimumScore||80)}"></label><label>Minimum quality<input type="number" min="1" max="100" id="dcAutoQuality" value="${esc(auto.minimumQuality||72)}"></label><label>Max per project<input type="number" min="1" max="20" id="dcAutoMax" value="${esc(auto.maxPerProject||4)}"></label><label class="dc-switch-row"><span><strong>Review required</strong><span>Keep manual check before posting</span></span><input type="checkbox" id="dcReviewRequired" ${auto.skipReviewRequired===false?'checked':''}></label><button class="dc-btn wide" id="dcSaveAutomation">Save automation</button></div></section>
      <section class="dc-settings-panel dc-alert-settings">
        <div class="dc-alert-head"><div><h2>Notifications & sounds</h2><p>Get a clean alert when processing finishes, a post goes live, or the workflow needs attention.</p></div><span class="dc-alert-status ${permission.tone}"><i></i>${esc(permission.label)}</span></div>
        <div class="dc-alert-grid">
          <article class="dc-alert-card"><div class="dc-alert-card-head"><span>${ICON.publish}</span><div><strong>Chrome & Safari notifications</strong><small>${esc(permission.copy)}</small></div></div><div class="dc-alert-options">${alertToggle('dcAlertComplete','Clips ready','When processing or a re-render finishes',alerts.completed)}${alertToggle('dcAlertPublishing','Post published','When a platform confirms the upload',alerts.publishing)}${alertToggle('dcAlertFailures','Needs attention','Failed processing or publishing',alerts.failures)}${alertToggle('dcAlertStarted','Processing started','Optional early progress alert',alerts.started)}</div><div class="dc-alert-actions"><button class="dc-btn" id="dcEnableNotifications" ${notificationPermission()==='unsupported'||notificationPermission()==='denied'?'disabled':''}>${notificationPermission()==='granted'?(alerts.desktop?'Notifications enabled':'Resume notifications'):'Enable notifications'}</button><button class="dc-btn secondary" id="dcPauseNotifications" ${!alerts.desktop?'disabled':''}>Pause</button><button class="dc-btn secondary" id="dcTestNotification" ${notificationPermission()!=='granted'?'disabled':''}>Send test</button></div><div class="dc-browser-note">Chrome: click the lock icon → Site settings → Notifications. Safari: Safari Settings → Websites → Notifications. Alerts currently run while DeenClipped is open.</div></article>
          <article class="dc-alert-card"><div class="dc-alert-card-head"><span>${ICON.audio}</span><div><strong>Workflow sounds</strong><small>Short, subtle chimes—never speech or music over your editor.</small></div></div><div class="dc-alert-options">${alertToggle('dcAlertSounds','Sounds enabled','Play chimes for selected events',alerts.sounds)}${alertToggle('dcAlertRespectMedia','Respect playback','Stay silent while a video or track is playing',alerts.respectMedia)}</div><div class="dc-volume-row"><input type="range" min="0" max="100" step="5" id="dcAlertVolume" value="${esc(alerts.volume)}"><output id="dcAlertVolumeOut">${esc(alerts.volume)}%</output></div><div class="dc-alert-actions"><button class="dc-btn secondary" id="dcTestSound">Play test sound</button></div><div class="dc-browser-note">Your preferences are saved to this browser and kept separate for each DeenClipped account.</div></article>
        </div>
      </section>
    </div>
  </div>`;
  $('#dcSaveClipSettings').onclick=saveClipSettingsPanel;
  $('#dcSaveAutomation').onclick=saveAutomationPanel;
  bindNotificationSettings();
  requestAnimationFrame(()=>animatePanel(panel));
}
async function saveClipSettingsPanel(){try{await callApi('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcSetClipCount')?.value||8),clipMinSeconds:Number($('#dcSetMinSec')?.value||30),clipMaxSeconds:Number($('#dcSetMaxSec')?.value||60)})});notify('Generation settings saved');await refreshData();renderSettingsPage()}catch(e){notify(e.message,'bad')}}
async function saveAutomationPanel(){try{await callApi('/api/automation-settings',{method:'POST',body:JSON.stringify({enabled:$('#dcAutoEnabled')?.checked,minimumScore:Number($('#dcAutoScore')?.value||80),minimumQuality:Number($('#dcAutoQuality')?.value||72),maxPerProject:Number($('#dcAutoMax')?.value||4),skipReviewRequired:!$('#dcReviewRequired')?.checked})});notify('Automation saved');await refreshData();renderSettingsPage()}catch(e){notify(e.message,'bad')}}
function bindNotificationSettings(){
  const fields={dcAlertComplete:'completed',dcAlertPublishing:'publishing',dcAlertFailures:'failures',dcAlertStarted:'started',dcAlertSounds:'sounds',dcAlertRespectMedia:'respectMedia'};
  Object.entries(fields).forEach(([id,key])=>$('#'+id)?.addEventListener('change',event=>{const checked=event.currentTarget.checked;saveNotificationPrefs({[key]:checked});if(key==='sounds'&&checked)playNotificationSound('test',true)}));
  $('#dcAlertVolume')?.addEventListener('input',event=>{const volume=Number(event.currentTarget.value||0);saveNotificationPrefs({volume});if($('#dcAlertVolumeOut'))$('#dcAlertVolumeOut').textContent=`${volume}%`});
  $('#dcEnableNotifications')?.addEventListener('click',async()=>{await requestDesktopNotifications();renderSettingsPage()});
  $('#dcPauseNotifications')?.addEventListener('click',()=>{saveNotificationPrefs({desktop:false});notify('Desktop notifications paused');renderSettingsPage()});
  $('#dcTestSound')?.addEventListener('click',()=>{saveNotificationPrefs({sounds:true});playNotificationSound('test',true);if($('#dcAlertSounds'))$('#dcAlertSounds').checked=true;notify('Sound is working','good')});
  $('#dcTestNotification')?.addEventListener('click',()=>{saveNotificationPrefs({desktop:true});pushDesktopNotification('DeenClipped test','Notifications are working. We’ll use this for finished clips and publishing updates.','test','home',true);notify('Test notification sent','good')});
}
function renderSidebarLive(){
  const box=$('#dcSidebarLive'),d=data();if(!box||!d)return;
  const jobs=activeJobs();const clips=d.clips||[];
  const waiting=clips.filter(c=>c.status==='waiting').length;
  const scheduled=clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
  const next=clips.filter(c=>Number(c.scheduledAt)>Date.now()&&!['posted','ready'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt))[0];
  const current=jobs[0];
  const busy=Boolean(current);
  const icon=busy?(current.kind==='publish'?ICON.publish:current.kind==='render'?ICON.editor:ICON.scissors):(waiting?ICON.review:ICON.check);
  const title=busy?shortText(current.title||'Working now',30):(waiting?`${waiting} clips need review`:'Studio is clear');
  const stage=busy?`${shortText(current.stage||'Processing',28)}${Number.isFinite(current.progress)?` · ${Math.round(current.progress)}%`:''}`:(next?`Next post ${formatDate(next.scheduledAt)}`:'No active render or post');
  const pct=busy&&Number.isFinite(current.progress)?clamp(current.progress,0,100):(waiting?42:100);
  const nextLine=next?`<div class="dc-now-next"><b>Next</b><span>${esc(shortText(next.title||'Scheduled clip',26))} · ${formatDate(next.scheduledAt)}</span></div>`:`<div class="dc-now-next"><b>Next</b><span>${waiting?'Review clips to build the schedule':'Approve a clip to start scheduling'}</span></div>`;
  box.classList.add('v3-now');
  box.innerHTML=`<div class="dc-now-topline"><span class="dc-now-chip ${busy?'busy':'good'}">${busy?'Live':'Ready'}</span><span class="dc-now-title">Happening now</span></div><div class="dc-now-focus"><span class="dc-now-focus-icon">${icon}</span><div><strong>${esc(title)}</strong><span>${esc(stage)}</span></div></div><div class="dc-now-progress"><i style="width:${pct}%"></i></div>${nextLine}<div class="dc-now-mini-stats"><span><b>${waiting}</b><em>review</em></span><span><b>${scheduled}</b><em>scheduled</em></span></div><div class="dc-sidebar-live-foot"><button class="dc-btn secondary" data-dc-nav="review">Review</button><button class="dc-btn secondary" data-dc-nav="schedule">Schedule</button></div>`;
}

function billingInfo(){return data()?.billing || {current:{plan:'free',remaining:0,used:0,allowance:0},features:{socialPublishing:false,canPublish:false,publishingBlockCode:'publishing_requires_premium'},plans:{},tokenRatePerMinute:1}}
function publishingAccess(){
  const bill=billingInfo(),cur=bill.current||{},features=bill.features||{};
  if(cur.unlimited||features.canPublish)return{allowed:true,code:'',title:'Publishing ready',copy:'Your account can publish to connected channels.',action:'Post now'};
  if(features.publishingBlockCode==='publishing_tokens_empty'||(features.socialPublishing!==false&&Number(cur.remaining||0)<=0))return{allowed:false,code:'publishing_tokens_empty',title:'Add tokens to keep posting',copy:'Your wallet is at zero. Existing clips stay available, but social posting pauses until you add tokens or change plan.',action:'Add tokens'};
  return{allowed:false,code:'publishing_requires_premium',title:'Publishing unlocks with Premium',copy:'Your 3-day, 40-token trial is for browsing, generating, editing and watermarked downloads. Choose Weekly, Monthly or Yearly when you are ready to post.',action:'View Premium'};
}
function publishingButton(label='Post now',attributes='',extra=''){
  const access=publishingAccess();
  return access.allowed?`<button class="dc-btn ${extra}" ${attributes}>${esc(label)}</button>`:`<button class="dc-btn ${extra}" data-open-billing>${esc(access.action)}</button>`;
}
function handlePublishingError(error){
  if(!['publishing_requires_premium','publishing_tokens_empty','free_expired','insufficient_tokens'].includes(String(error?.code||'')))return false;
  notify(error.message||'Choose a plan to continue.','bad');
  $('.billing-block')?.remove();
  openBillingModal();
  return true;
}
function subscriptionDate(value,withTime=false){
  const stamp=Number(value||0);if(!stamp)return'—';
  return new Intl.DateTimeFormat('en-AU',withTime?{day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}:{day:'numeric',month:'short',year:'numeric'}).format(new Date(stamp));
}
function subscriptionStatus(cur={}){
  if(cur.unlimited)return{label:'Owner access',tone:'owner',detail:'No token or billing limits'};
  if(cur.cancelAtPeriodEnd)return{label:'Ending soon',tone:'warn',detail:`Access continues until ${subscriptionDate(cur.periodEnd||cur.cancelAt)}`};
  if(cur.trial?.active)return{label:'Trial active',tone:'good',detail:`${cur.trial.daysLeft||1} day${cur.trial.daysLeft===1?'':'s'} remaining`};
  if(cur.freeTier?.onFree)return cur.freeTier.expired?{label:'Free access ended',tone:'bad',detail:'Choose a plan to resume processing'}:{label:'Free access',tone:'free',detail:`${cur.freeTier.daysLeft??0} day${cur.freeTier.daysLeft===1?'':'s'} remaining`};
  if(String(cur.status||'').toLowerCase()==='past_due')return{label:'Payment needed',tone:'bad',detail:'Update your payment method to keep access'};
  return{label:'Active',tone:'good',detail:'Your subscription is running normally'};
}
async function startSubscriptionCheckout(plan,button){
  if(!plan||button?.disabled)return;
  const original=button?.textContent||'Choose plan';
  try{if(button){button.disabled=true;button.textContent='Opening secure checkout…'}const res=await callApi('/api/billing/checkout',{method:'POST',body:JSON.stringify({plan})});if(res.url)location.href=res.url;else throw new Error('Stripe did not return a checkout URL.');}
  catch(e){notify(e.message,'bad');if(button){button.disabled=false;button.textContent=original}}
}
async function startTopupCheckout(packageId,button){
  if(!packageId||button?.disabled)return;
  const original=button?.textContent||'Buy tokens';
  try{if(button){button.disabled=true;button.textContent='Opening secure checkout…'}const res=await callApi('/api/billing/topup',{method:'POST',body:JSON.stringify({package:packageId})});if(res.url)location.href=res.url;else throw new Error('Stripe did not return a checkout URL.');}
  catch(e){notify(e.message,'bad');if(button){button.disabled=false;button.textContent=original}}
}
async function openBillingPortal(button){
  const original=button?.textContent||'Billing & invoice details';
  try{if(button){button.disabled=true;button.textContent='Opening Stripe…'}const res=await callApi('/api/billing/portal',{method:'POST',body:'{}'});if(res.url)location.href=res.url;else throw new Error('Stripe did not return a billing portal URL.');}
  catch(e){notify(e.message,'bad');if(button){button.disabled=false;button.textContent=original}}
}
function renderSubscriptionPage(){
  const panel=$('#view-subscription'),d=data();if(!panel||!d)return;
  const bill=billingInfo(),cur=bill.current||{},plans=bill.plans||{},topups=Object.values(bill.topups||{}),events=bill.recentEvents||[];
  const currentPlan=plans[cur.plan]||{name:cur.unlimited?'Owner':'Free',interval:cur.unlimited?'account':'one-time',tokens:cur.allowance||0,features:[]};
  const status=subscriptionStatus(cur),remaining=cur.unlimited?'∞':Math.max(0,Math.round(Number(cur.remaining||0))),allowance=cur.unlimited?'Unlimited':Math.max(0,Math.round(Number(cur.allowance||0)));
  const used=Math.max(0,Math.round(Number(cur.used||0))),reserved=Math.max(0,Math.round(Number(cur.reserved||0))),bonus=Math.max(0,Math.round(Number(cur.bonusTokens||0)));
  const pct=cur.unlimited?100:Number(cur.allowance)>0?clamp(((Number(cur.used||0)+Number(cur.reserved||0))/Number(cur.allowance))*100,0,100):0;
  const planFeatures=[...(currentPlan.features||[])];
  if(bill.features?.premium)planFeatures.push('Clean exports without forced watermark','Custom Brand Kit');
  if(bill.features?.creatorLab)planFeatures.push('Creator Lab intelligence');
  if(bill.features?.batchPublishing)planFeatures.push('Batch scheduling and publishing');
  if(!planFeatures.length)planFeatures.push('Exact word-sync captions','Editor and clip review','DeenClipped branded exports');
  const uniqueFeatures=[...new Set(planFeatures)];
  const periodLabel=cur.unlimited?'Plan access':cur.cancelAtPeriodEnd?'Access until':cur.trial?.active?'Trial ends':cur.freeTier?.onFree?'Free access ends':cur.periodEnd?'Next renewal':'Billing period';
  const periodValue=cur.unlimited?'No expiry':subscriptionDate(cur.trial?.active?cur.trial.endsAt:cur.freeTier?.onFree?cur.freeTier.expiresAt:cur.periodEnd);
  const email=d.user?.email||d.account?.email||'Signed-in account';
  const interval=currentPlan.interval==='one-time'?'Free access':`${String(currentPlan.interval||'account').replace(/^./,c=>c.toUpperCase())} billing`;
  const eventRows=events.slice(0,6).map(event=>{
    const added=event.type==='tokens_added';const amount=Math.round(Number(event.amount||0));
    return `<div class="dc-sub-event"><span class="dc-sub-event-icon ${added?'added':'used'}">${added?'+':'−'}</span><div><strong>${esc(event.message||event.reason||'Billing activity')}</strong><small>${esc(subscriptionDate(event.createdAt,true))}${event.remaining!==undefined?` · ${esc(Math.round(Number(event.remaining||0)))} tokens left`:''}</small></div><b class="${added?'added':''}">${added?'+':'−'}${esc(amount)}</b></div>`;
  }).join('');
  const topupCards=topups.map(pack=>`<article class="dc-sub-topup ${pack.id==='boost300'?'featured':''}"><div><span>${esc(pack.badge||'Token pack')}</span><strong>${esc(pack.name||'Top-up')}</strong><small>${esc(pack.description||'One-time tokens for your wallet.')}</small></div><div class="dc-sub-topup-value"><b>${esc(pack.tokens||0)}</b><em>tokens</em><strong>${esc(pack.priceLabel||'Price at checkout')}</strong></div><button class="dc-btn ${pack.id==='boost300'?'':'secondary'}" data-sub-topup="${esc(pack.id)}" ${pack.enabled?'':'disabled'}>${pack.enabled?'Buy once':'Coming soon'}</button></article>`).join('');
  panel.innerHTML=`<div class="dc-subscription-page">
    <section class="dc-sub-hero"><div><span class="dc-product-kicker">${ICON.billing} Account & billing</span><h1>Your subscription, without the guesswork.</h1><p>See your real plan, token balance, renewal status and payments in one place. Stripe securely handles card and invoice details.</p></div><div class="dc-sub-hero-balance"><span>Available now</span><strong>${esc(remaining)}</strong><small>${cur.unlimited?'unlimited tokens':'tokens ready to use'}</small><div><i style="width:${pct}%"></i></div></div></section>
    <div class="dc-sub-main-grid">
      <section class="dc-sub-card dc-sub-plan-card"><div class="dc-sub-card-head"><div><span>Current plan</span><h2>${esc(currentPlan.name||cur.plan||'Free')} <small>${esc(interval)}</small></h2></div><b class="dc-sub-status ${status.tone}"><i></i>${esc(status.label)}</b></div><p class="dc-sub-status-detail">${esc(status.detail)}</p><div class="dc-sub-account"><span>${esc(email)}</span><em>Account owner</em></div><div class="dc-sub-token-grid"><span><b>${esc(remaining)}</b><em>available</em></span><span><b>${esc(allowance)}</b><em>allowance</em></span><span><b>${esc(used)}</b><em>used</em></span><span><b>${esc(bonus)}</b><em>top-up</em></span></div><div class="dc-sub-usage"><div><span>Current-period usage</span><b>${esc(used)} used${reserved?` · ${esc(reserved)} reserved`:''}</b></div><i><em style="width:${pct}%"></em></i></div><div class="dc-sub-actions"><button class="dc-btn" id="dcSubChangePlan">Compare or change plan</button>${!cur.unlimited?'<button class="dc-btn secondary" id="dcSubJumpTopups">Add tokens</button>':''}</div></section>
      <section class="dc-sub-card dc-sub-features"><div class="dc-sub-card-head"><div><span>Included in your plan</span><h2>Unlocked features</h2></div><button class="dc-text-action" id="dcSubCompare">Compare plans →</button></div><div class="dc-sub-feature-list">${uniqueFeatures.map(feature=>`<div><span>${ICON.check}</span><strong>${esc(feature)}</strong></div>`).join('')}</div></section>
      <section class="dc-sub-card dc-sub-payment"><div class="dc-sub-card-head"><div><span>${cur.unlimited?'Account access':'Stripe account'}</span><h2>Billing & payment</h2></div><span class="dc-secure-chip">${cur.unlimited?'Unlimited':'Secure'}</span></div><div class="dc-sub-payment-rows"><div><span>${esc(periodLabel)}</span><b>${esc(periodValue)}</b></div><div><span>Billing period</span><b>${esc(interval)}</b></div><div><span>Plan price</span><b>${esc(cur.unlimited?'Included':currentPlan.priceLabel||currentPlan.name||'Free')}</b></div><div><span>Payment details</span><b>${cur.unlimited?'Not required':cur.stripeCustomerId?'Managed in Stripe':'Not added yet'}</b></div></div><button class="dc-btn wide" id="dcSubPortal" ${cur.stripeCustomerId&&bill.portalConfigured&&!cur.unlimited?'':'disabled'}>${cur.unlimited?'No billing required':cur.stripeCustomerId?'Billing & invoice details':'No payment profile yet'}</button>${cur.cancelAtPeriodEnd?'<p class="dc-sub-cancel-note">Your plan is scheduled to end. Use Stripe billing details to resume it before the access date.</p>':'<p class="dc-sub-security">DeenClipped never stores your complete card details.</p>'}</section>
    </div>
    <section class="dc-sub-section" id="dcSubTopups"><div class="dc-sub-section-head"><div><span>One-time packs</span><h2>Add tokens without changing your plan</h2><p>Top-up tokens stay in your wallet when your subscription renews.</p></div><span class="dc-sub-rate">${esc(bill.tokenRatePerMinute||1)} token / source minute</span></div><div class="dc-sub-topup-grid">${topupCards||'<div class="dc-empty"><strong>No top-up packs configured</strong><span>Your plan allowance is still available.</span></div>'}</div></section>
    <section class="dc-sub-card dc-sub-activity"><div class="dc-sub-card-head"><div><span>Wallet history</span><h2>Recent billing activity</h2></div><span class="dc-secure-chip">Last ${Math.min(events.length,6)}</span></div><div class="dc-sub-event-list">${eventRows||`<div class="dc-sub-empty"><span>${ICON.billing}</span><strong>No billing activity yet</strong><p>Token charges and top-ups will appear here after your first import or purchase.</p></div>`}</div></section>
  </div>`;
  $('#dcSubChangePlan').onclick=openBillingModal;$('#dcSubCompare').onclick=openBillingModal;
  $('#dcSubJumpTopups')?.addEventListener('click',()=>$('#dcSubTopups')?.scrollIntoView({behavior:'smooth',block:'start'}));
  $('#dcSubPortal')?.addEventListener('click',event=>openBillingPortal(event.currentTarget));
  $$('[data-sub-topup]',panel).forEach(button=>button.addEventListener('click',()=>startTopupCheckout(button.dataset.subTopup,button)));
  requestAnimationFrame(()=>animatePanel(panel));
}
function updateTokenPill(){
  const pill=$('#dcTokenPill'); if(!pill)return;
  const bill=billingInfo(),cur=bill.current||{},trial=cur.trial||{};
  const rawRemaining=Math.max(0,Math.round(Number(cur.remaining||0)));
  const label=cur.unlimited?'∞':String(rawRemaining);
  const spoken=cur.unlimited?'unlimited tokens':`${rawRemaining} tokens`;
  const rate=`${Number(bill.tokenRatePerMinute||1)}/min`;
  const trialCopy=trial.active?`<em class="dc-trial-mini"><span class="dc-token-trial-dot"></span>${esc(trial.daysLeft||1)}d trial</em>`:'';
  pill.classList.toggle('trial',!!trial.active);
  pill.classList.toggle('warn',!cur.unlimited && !trial.active && rawRemaining<=10);
  pill.innerHTML=`${ICON.tokens}<span class="dc-token-label">Tokens</span><strong class="dc-token-main">${esc(label)}</strong><em class="dc-token-rate">${esc(rate)}</em>${trialCopy}`;
  pill.title=cur.unlimited?'Admin accounts have unlimited tokens':`${spoken} left · ${Number(bill.tokenRatePerMinute||1)} token/min charged for source video minutes${trial.active?` · Trial ends in ${trial.daysLeft} day${trial.daysLeft===1?'':'s'}`:''}`;
}
function openBillingModal(){
  $('#dcBillingLayer')?.remove();
  const bill=billingInfo(),cur=bill.current||{},plans=bill.plans||{},trial=cur.trial||{},freeTier=cur.freeTier||{};
  const currentPlan=cur.plan||'free';
  const unlimited=!!cur.unlimited;
  const allowance=Math.max(0,Number(cur.allowance||0));
  const used=Math.max(0,Number(cur.used||0));
  const reserved=Math.max(0,Number(cur.reserved||0));
  const remaining=Math.max(0,Number(cur.remaining||0));
  const rate=Number(bill.tokenRatePerMinute||1);
  const pct=unlimited?100:allowance?clamp(((used+reserved)/allowance)*100,0,100):0;
  const minutesFor=tokens=>Math.max(1,Math.floor(Number(tokens||0)/Math.max(.1,rate)));
  const intervalWord={free:'free access',weekly:'week',monthly:'month',yearly:'year'};
  const sortPlans=['free','weekly','monthly','yearly'];
  const trialDays=Math.max(0,Number(bill.trialDays||7));
  const planCards=sortPlans.map(id=>{
    const plan=plans[id]||{};
    const isFree=id==='free';
    const isCurrent=currentPlan===id && (isFree||cur.status!=='free');
    const enabled=isFree||plan.enabled!==false&&plan.priceId;
    const featured=id==='monthly';
    const tokens=Number(plan.tokens||0);
    const label=isFree?(isCurrent?'Keep browsing':'Explore free'):isCurrent?'Current plan':enabled?(plan.trialEligible?`Start ${trialDays}-day trial`:`Subscribe ${id}`):'Stripe price needed';
    const featureCopy=[`${minutesFor(tokens)} source minutes`,...(Array.isArray(plan.features)?plan.features:[]),...(isFree?['Browse, edit and download','Social posting not included']:['Social publishing included'])];
    const subtitle=isFree?'Try DeenClipped first':id==='weekly'?'Cheapest paid option':id==='monthly'?'Creator favourite':'Best long-term value';
    const price=isFree?'Free':plan.priceLabel||'Price shown at checkout';
    const action=isFree?'data-billing-free':`data-billing-checkout="${esc(id)}"`;
    return `<article id="dcBillingPlan_${esc(id)}" class="dc-plan-card ${featured?'featured':''} ${isCurrent?'current':''}" data-billing-plan="${esc(id)}">${featured?'<div class="dc-plan-featured-label">Most popular</div>':''}<div class="dc-plan-content"><div class="dc-plan-top"><div><h3>${esc(plan.name||id)}</h3><span>${esc(subtitle)}</span></div>${!featured||isCurrent?`<span class="badge">${esc(isCurrent?'Active':plan.badge||(isFree?'Free':'Plan'))}</span>`:''}</div><div class="dc-plan-price">${esc(price)}${isFree?'':`<span> / ${esc(intervalWord[id]||id)}</span>`}</div><div class="tokens">${esc(tokens)} <span>tokens included</span></div><p>${esc(plan.description||'Token allowance for clipping lectures.')}</p><div class="dc-plan-divider"></div><div class="dc-plan-features">${featureCopy.map(item=>`<span>${esc(item)}</span>`).join('')}</div><button class="dc-btn ${isCurrent?'secondary':''}" ${action} ${enabled&&!isCurrent?'':'disabled'}>${esc(label)}</button></div></article>`;
  }).join('');
  const usageLabel=unlimited?'Unlimited':trial.active?'Trial wallet':'Available now';
  const usageValue=unlimited?'∞':String(Math.round(remaining));
  const usageSub=unlimited?'tokens':'tokens left';
  const allowanceCopy=unlimited?'Owner account':`${Math.round(allowance)} allowance`;
  const spentCopy=unlimited?'No charges':`${Math.round(used)} used${reserved?` · ${Math.round(reserved)} reserved`:''}`;
  const billingReady=!!bill.stripeConfigured;
  const trialStatus=trial.active?`Paid trial ends in ${trial.daysLeft} day${trial.daysLeft===1?'':'s'}`:freeTier.onFree&&!freeTier.expired?`${freeTier.daysLeft??0} days of free access left`:trial.ended||freeTier.expired?'Trial ended':`${trialDays}-day paid trial available`;
  const layer=document.createElement('div');layer.id='dcBillingLayer';layer.className='dc-billing-layer show';
  layer.innerHTML=`<section class="dc-billing-card" role="dialog" aria-modal="true" aria-labelledby="dcBillingTitle"><div class="dc-billing-head"><div><span class="dc-billing-kicker">${ICON.tokens} Tokens & billing</span><h2 id="dcBillingTitle">Every option, side by side.</h2><p>Free is for exploring with watermarked downloads. Weekly, Monthly and Yearly unlock social publishing—choose the pace that fits you.</p></div><button class="dc-billing-close" id="dcBillingClose" type="button" aria-label="Close">×</button></div><div class="dc-wallet-strip"><div><span>${esc(usageLabel)}</span><strong>${esc(usageValue)} <small>${esc(usageSub)}</small></strong></div><div><span>Current allowance</span><strong>${esc(allowanceCopy)}</strong></div><div><span>Usage</span><strong>${esc(spentCopy)}</strong></div><div><span>Source rate</span><strong>${esc(rate)} <small>token/min</small></strong></div><span class="dc-status-pill ${unlimited?'warn':trial.active?'good':''}">${esc(unlimited?'Admin mode':trialStatus)}</span><div class="dc-wallet-progress" aria-hidden="true"><i style="width:${pct}%"></i></div></div><div class="dc-plan-grid">${planCards}</div><div class="dc-billing-explainer"><span><b>Explore free</b>40 tokens for 3 days, with DeenClipped watermark.</span><span><b>Publish on Premium</b>Weekly, Monthly and Yearly can post to connected channels.</span><span><b>Edits stay free</b>Template updates and rerenders use no tokens.</span></div><div class="dc-billing-foot"><div class="dc-billing-note"><i class="${billingReady?'':'warn'}"></i><span>${billingReady?'Secure checkout powered by Stripe.':'Stripe checkout is being configured.'}</span></div><button class="dc-btn secondary" id="dcBillingPortal" type="button" ${cur.stripeCustomerId?'':'disabled'}>Manage billing</button></div></section>`;
  document.body.append(layer);
  $('#dcBillingClose').onclick=()=>layer.remove();
  layer.addEventListener('click',event=>{if(event.target===layer)layer.remove()});
  $('[data-billing-free]',layer)?.addEventListener('click',()=>layer.remove());
  $$('[data-billing-checkout]',layer).forEach(btn=>btn.addEventListener('click',async()=>{
    const plan=btn.dataset.billingCheckout; if(!plan||btn.disabled)return;
    try{btn.disabled=true;btn.textContent='Opening Stripe…';const res=await callApi('/api/billing/checkout',{method:'POST',body:JSON.stringify({plan})}); if(res.url) location.href=res.url; else throw new Error('Stripe did not return a checkout URL.');}
    catch(e){notify(e.message,'bad');btn.disabled=false;btn.textContent='Try again';}
  }));
  $('#dcBillingPortal')?.addEventListener('click',async()=>{try{const res=await callApi('/api/billing/portal',{method:'POST',body:'{}'}); if(res.url) location.href=res.url;}catch(e){notify(e.message,'bad')}});
}
function seenStoreKey(kind,id){
  const user=(data()?.user?.id || data()?.user?.email || 'anon');
  return `dc_${kind}_${user}_${id}`;
}
function seenGet(kind,id){try{return localStorage.getItem(seenStoreKey(kind,id))==='1'}catch{return false}}
function seenSet(kind,id){try{localStorage.setItem(seenStoreKey(kind,id),'1')}catch{}}
function showTokenToast(event){
  if(!event?.id || seenGet('token_event',event.id))return;
  seenSet('token_event',event.id);
  const existing=$('.dc-token-toast'); if(existing) existing.remove();
  const el=document.createElement('div'); el.className='dc-token-toast good';
  const amount=Math.round(Number(event.amount||0));
  const remaining=event.remaining!==undefined?` · ${Math.round(Number(event.remaining||0))} left`:'';
  el.innerHTML=`<strong>${amount} token${amount===1?'':'s'} used</strong><span>${esc(event.message||'Tokens were charged after processing.')}${esc(remaining)}</span>`;
  document.body.append(el);
  setTimeout(()=>{if(el.isConnected)el.remove()},6200);
}
function maybeShowTokenEvents(){
  const bill=billingInfo();
  const events=(bill.recentEvents||[]).filter(e=>e?.type==='tokens_charged'||Number(e?.amount)>0);
  if(events[0])showTokenToast(events[0]);
}
function showBillingNotice(notice){
  if(!notice?.id || seenGet('billing_notice',notice.id))return;
  seenSet('billing_notice',notice.id);
  $('#dcBillingNoticeLayer')?.remove();
  const layer=document.createElement('div'); layer.id='dcBillingNoticeLayer'; layer.className='dc-billing-notice-layer';
  const points=notice.kind==='free_welcome'?['40 tokens for 3 days','Generate, edit and download with a watermark','Social posting unlocks with Premium']:notice.kind==='tokens_empty'?['Your existing clips stay available','Generating and posting pause at zero','Choose a plan or add a token pack']:notice.kind==='trial_ended'||notice.kind==='free_expired'?['Your existing projects and clips stay safe','New processing resumes as soon as you choose a plan','Plans and token usage stay available from the top bar']:['Tokens are shown before each import',`Paid-plan trials last ${billingInfo().trialDays||7} days`,'Manage your plan any time from the token button'];
  const laterLabel=notice.kind==='free_welcome'?'Keep browsing':'Not now';
  layer.innerHTML=`<section class="dc-billing-notice-card" role="dialog" aria-modal="true"><div class="dc-billing-notice-head"><div><span><i class="dc-notice-mark"></i> Billing update</span><h2>${esc(notice.title||'Account update')}</h2><p>${esc(notice.message||'Review your tokens and plan.')}</p></div><button class="dc-notice-close" id="dcBillingNoticeClose" type="button" aria-label="Close">×</button></div><div class="dc-billing-notice-body"><div class="dc-charge-terms">${points.map(point=>`<span>${esc(point)}</span>`).join('')}</div><div class="dc-billing-notice-actions"><button class="dc-btn secondary" id="dcBillingNoticeLater" type="button">${esc(laterLabel)}</button><button class="dc-btn" id="dcBillingNoticeAction" type="button">${esc(notice.action||'View plans')}</button></div></div></section>`;
  document.body.append(layer);
  const close=()=>layer.remove();
  $('#dcBillingNoticeClose').onclick=close; $('#dcBillingNoticeLater').onclick=close;
  $('#dcBillingNoticeAction').onclick=()=>{close();openBillingModal();};
  layer.addEventListener('click',event=>{if(event.target===layer)close()});
}
function maybeShowBillingNotices(){
  if($('#dcGuideLayer')||$('#dcBillingLayer')||$('#dcBillingNoticeLayer'))return;
  const notices=billingInfo().notices||[];
  const unseen=notices.find(notice=>notice?.id&&!seenGet('billing_notice',notice.id));
  if(unseen)showBillingNotice(unseen);
}
function renderCurrent(){if(currentView==='admin')renderAdminPage();if(currentView==='home')renderHome();if(currentView==='projects')renderProjects();if(currentView==='review')renderReview();if(currentView==='editor')ensureEditor();if(currentView==='schedule')renderPublishingWorkspace();if(currentView==='publishing')renderConnections();if(currentView==='templates')renderTemplatesPage();if(currentView==='brand')renderBrandKit();if(currentView==='lab')renderCreatorLab();if(currentView==='music')renderAudioLibrary();if(currentView==='insights')renderInsightsPage();if(currentView==='automation')renderSettingsPage();if(currentView==='subscription')renderSubscriptionPage();lastDataSignature=structuralDataSignature(data())}
async function refreshData(){if(typeof refresh==='function')return refresh();try{DATA=await callApi('/api/state')}catch{}}
function hexAlpha(hex,alpha){const value=String(hex||'#000000').replace('#','');if(!/^[0-9a-fA-F]{6}$/.test(value))return `rgba(0,0,0,${alpha})`;const n=parseInt(value,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`}
function formatDuration(ms){const s=Math.max(0,Math.round(Number(ms||0)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
function formatClock(sec,decimal=false){const n=Math.max(0,Number(sec||0)),m=Math.floor(n/60),s=decimal?n%60:Math.floor(n%60);return decimal?`${m}:${s.toFixed(1).padStart(4,'0')}`:`${m}:${String(s).padStart(2,'0')}`}
function formatDate(value){if(!value)return'—';return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(value)))}
function formatRelative(value){const diff=Date.now()-Number(value||0);if(diff<60000)return'Just now';if(diff<3600000)return`${Math.round(diff/60000)}m ago`;if(diff<86400000)return`${Math.round(diff/3600000)}h ago`;return`${Math.round(diff/86400000)}d ago`}
function statusName(value){const map={queued:'Queued',processing:'Processing',done:'Ready',completed:'Ready',waiting:'Ready to review',approved:'Approved',scheduled:'Scheduled',publishing:'Publishing',posted:'Posted',publish_failed:'Publish failed',failed:'Failed',ready:'Ready'};return map[value]||String(value||'Draft').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())}

function structuralDataSignature(d=data()){
  if(!d)return'';
  const providers=Object.entries(d.social?.providers||{}).map(([key,value])=>[key,Boolean(value?.configured),Boolean(value?.connected),(value?.accounts||[]).map(account=>account.id)]);
  const current=d.billing?.current||{};
  return JSON.stringify({
    p:(d.projects||[]).map(p=>[p.id,p.status,Boolean(p.error),p.moreJob?.status,Boolean(p.moreJob?.error),Boolean(p.sourceReusable)]),
    c:(d.clips||[]).map(c=>[c.id,c.status,c.scheduledAt,c.postedAt,(c.targets||[]).map(t=>[t.provider,t.status])]),
    r:(d.rerenderJobs||[]).map(r=>[r.id,r.status,Boolean(r.error)]),
    s:providers,t:d.selectedTemplate?.id||'',a:(d.tracks||[]).map(track=>track.id),
    b:[current.plan,current.remaining,current.used,current.periodEnd,current.cancelAtPeriodEnd,current.trial?.active,current.freeTier?.expired]
  });
}

function patchLiveProgress(){
  const d=data();if(!d)return;
  const current=activeJobs()[0];
  if(current){
    const progress=Number.isFinite(Number(current.progress))?clamp(Number(current.progress),0,100):null;
    $$('[data-live-job="current"]').forEach(root=>{
      const title=$('[data-live-title]',root),stage=$('[data-live-stage]',root),summary=$('[data-live-summary]',root),bar=$('[data-live-progress]',root),wrap=$('[data-live-progress-wrap]',root),percent=$('[data-live-percent]',root);
      if(title)title.textContent=shortText(current.title||'Working now',72);
      if(stage)stage.textContent=shortText(current.stage||'Working now',90);
      if(summary)summary.textContent=`${shortText(current.title||'Working now',58)} · ${shortText(current.stage||'Working now',50)}`;
      if(bar&&progress!==null)bar.style.width=`${progress}%`;
      if(wrap)wrap.hidden=progress===null;
      if(percent)percent.textContent=progress===null?'Live':`${Math.round(progress)}%`;
    });
  }
  const projects=new Map((d.projects||[]).map(project=>[String(project.id),project]));
  $$('[data-live-project]').forEach(root=>{
    const project=projects.get(root.dataset.liveProject);if(!project)return;
    const busy=['queued','processing'].includes(project.status);if(!busy)return;
    const progress=clamp(Number(project.progress||0),0,100),bar=$('[data-live-progress]',root),stage=$('[data-live-stage]',root);
    if(bar)bar.style.width=`${progress}%`;
    if(stage){stage.lastChild.textContent=shortText(project.stage||'Processing',30);stage.className='dc-library-row-state blue'}
  });
  $$('[data-live-more-job]').forEach(root=>{
    const project=projects.get(root.dataset.liveMoreJob),job=project?.moreJob;if(!job)return;
    const progress=clamp(Number(job.progress||0),0,100),bar=$('[data-live-progress]',root),stage=$('[data-live-stage]',root),percent=$('[data-live-percent]',root);
    if(bar)bar.style.width=`${progress}%`;if(stage)stage.textContent=job.stage||'Generating more clips';if(percent)percent.textContent=`${Math.round(progress)}%`;
  });
}

function sync(){
  injectShell();
  hideLegacyProjectBrowser();
  const live=Boolean($('#app')&&!$('#app').classList.contains('hide'));
  $('#dcSidebar').style.display=live?'flex':'none';$('#dcTopbar').style.display=live?'flex':'none';
  if(!live||!data())return;
  // Only one view panel may ever be visible. The original app still controls
  // the legacy library/queue panels, so if both scripts touch visibility at
  // once a stale panel can be left on screen and appear to overlap the
  // sidebar. Re-asserting it here means any such race self-corrects.
  if(currentView){
    const active=`view-${currentView}`;
    $$('.main-col > .panel').forEach(p=>{
      const shouldHide=p.id!==active;
      if(p.classList.contains('hide')!==shouldHide)p.classList.toggle('hide',shouldHide);
    });
  }
  const adminNav=$('#dcAdminNav');if(adminNav)adminNav.style.display=isOperator()?'':'none';
  detectWorkflowSignals(data());
  const jobs=activeJobs(),issues=workspaceFailures(data()),health=$('#dcHealth');health.className=`dc-health ${issues.length?'bad':jobs.length?'busy':!data().readiness?.ready?'bad':''}`;$('span',health).textContent=issues.length?`${issues.length} ${issues.length===1?'issue':'issues'}`:jobs.length?`${jobs.length} active`:data().readiness?.ready?'Ready':'Setup needed';health.style.cursor='pointer';health.onclick=()=>openIssuesPanel();updateTokenPill();maybeShowBillingNotices();maybeShowTokenEvents();
  const signature=structuralDataSignature(data());
  if(signature!==lastDataSignature){lastDataSignature=signature;if(currentView!=='editor'||!editor.dirty)renderCurrent();else{renderTimeline();}}
  patchLiveProgress();
  paintWork();
}
/* ==========================================================================
 * ADMIN CONSOLE  (owner / admin accounts only)
 * ========================================================================== */

let adminOps = null;
let adminOpsLoading = false;
let adminOpsError = '';
let adminTab = 'overview';
let adminAnalytics = null;
let adminUserQuery = '';
let adminUserPlan = 'all';

function isOperator(){
  const role=String(data()?.role||'').toLowerCase();
  return role==='owner'||role==='admin';
}

function formatBytes(bytes){
  const n=Number(bytes||0);
  if(!Number.isFinite(n)||n<=0)return '0 B';
  const units=['B','KB','MB','GB','TB'];
  const i=Math.min(units.length-1,Math.floor(Math.log(n)/Math.log(1024)));
  return `${(n/Math.pow(1024,i)).toFixed(i===0?0:i===1?0:2)} ${units[i]}`;
}
function formatMoney(amount,currency='USD'){
  const n=Number(amount||0);
  try{return new Intl.NumberFormat('en-AU',{style:'currency',currency,maximumFractionDigits:2}).format(n)}
  catch{return `${currency} ${n.toFixed(2)}`}
}
function formatDay(value){
  if(!value)return '—';
  return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',year:'numeric'}).format(new Date(Number(value)));
}

async function loadAdminOps(force=false){
  if(adminOpsLoading)return;
  if(adminOps&&!force)return;
  adminOpsLoading=true;adminOpsError='';
  try{
    const [ops,stats]=await Promise.all([
      callApi('/api/admin/operations'),
      callApi('/api/admin/analytics').catch(()=>null)
    ]);
    adminOps=ops;
    if(stats)adminAnalytics=stats;
  }catch(error){
    adminOpsError=error.message||'Could not load admin data.';
  }finally{
    adminOpsLoading=false;
    if(currentView==='admin')renderAdminPage();
  }
}

function adminStatusPill(status){
  if(status==='ok')return `<span class="dc-status-pill good">Connected</span>`;
  if(status==='missing')return `<span class="dc-status-pill bad">Missing</span>`;
  return `<span class="dc-status-pill">Optional</span>`;
}

function adminTabs(){
  const tabs=[['overview','Command centre'],['services','Infrastructure'],['subscriptions','Revenue'],['users','Users'],['activity','Activity'],['storage','Storage'],['integrations','Integrations'],['vendors','Costs']];
  return `<div class="dc-admin-tabs">${tabs.map(([id,label])=>`<button class="dc-admin-tab${adminTab===id?' is-active':''}" type="button" data-admin-tab="${id}">${esc(label)}</button>`).join('')}</div>`;
}

function adminOverview(){
  const ops=adminOps,stats=adminAnalytics;
  if(!ops)return '';
  const o=stats?.overview||{};
  const sub=ops.subscriptions||{};
  const storage=ops.storage||{};
  const summary=ops.integrationSummary||{};
  const vendors=ops.vendors||{};
  const cards=[
    ['Signed-up users',o.users??sub.totalUsers??0,`${o.newUsers30d??0} new in 30 days`],
    ['Active (7 days)',o.activeUsers7d??0,`${sub.trialUsers??0} on trial`],
    ['Paying subscribers',sub.payingUsers??0,sub.stripeReady?'Stripe live':'Stripe not configured'],
    ['Storage used',formatBytes(storage.totalBytes),`${(storage.totalObjects||0).toLocaleString()} objects`],
    ['Videos processed',o.projects??0,`${o.processingProjects??0} running now`],
    ['Clips posted',o.postedClips??0,`${o.clips??0} generated total`],
    ['Integrations',`${summary.ok??0}/${summary.total??0}`,summary.missing?`${summary.missing} required missing`:'All required connected'],
    ['Monthly running cost',formatMoney(vendors.totalMonthly||0),vendors.nextRenewal?`Next: ${esc(vendors.nextRenewal.name)}`:'No renewals tracked'],
  ];
  const alerts=[];
  if(summary.missing)alerts.push(`${summary.missing} required integration${summary.missing===1?'':'s'} not configured.`);
  if(!sub.stripeReady)alerts.push('Stripe is not fully configured, so no payments can be taken yet.');
  (vendors.vendors||[]).filter(v=>v.overdue).forEach(v=>alerts.push(`${v.name} renewal date has passed.`));
  (vendors.vendors||[]).filter(v=>v.dueSoon).forEach(v=>alerts.push(`${v.name} renews in ${v.daysUntilRenewal} day${v.daysUntilRenewal===1?'':'s'}.`));
  if(storage.truncated)alerts.push('Storage scan stopped early — the bucket is very large, totals are a lower bound.');
  const required=Math.max(1,Number(summary.total||0)),healthy=Math.max(0,required-Number(summary.missing||0));
  const health=Math.max(0,Math.min(100,Math.round((healthy/required)*70+(sub.stripeReady?15:0)+(!storage.error&&storage.configured?15:0))));
  const users=Math.max(0,Number(o.users??sub.totalUsers??0)),active=Number(o.activeUsers7d||0),paid=Number(sub.payingUsers||0),posted=Number(o.postedClips||0);
  const recent=(stats?.recentActivity||[]).slice(0,5);
  return `<section class="dc-admin-command-row"><article class="dc-admin-health"><div class="dc-admin-health-ring" style="--score:${health}"><strong>${health}</strong><span>/100</span></div><div><span class="dc-admin-card-label">Business health</span><h2>${health>=85?'Launch systems healthy':health>=60?'A few items need attention':'Action required before launch'}</h2><p>${alerts.length?`${alerts.length} open item${alerts.length===1?'':'s'} need review.`:'Core services, billing and storage are ready.'}</p></div></article><div class="dc-admin-quick-actions"><button type="button" data-admin-jump="services">Check infrastructure</button><button type="button" data-admin-jump="subscriptions">Review revenue</button><button type="button" data-admin-jump="users">Find a user</button><button type="button" data-admin-jump="integrations">Open integrations</button></div></section>
  ${alerts.length?`<section class="dc-admin-alerts"><div class="dc-admin-section-title"><div><span>Needs attention</span><h2>Fix these before they become incidents.</h2></div><span class="dc-status-pill bad">${alerts.length} open</span></div>${alerts.map(a=>`<div class="dc-admin-alert">${ICON.alert||''}<span>${esc(a)}</span></div>`).join('')}</section>`:''}
  <div class="dc-admin-grid dc-admin-kpi-grid">${cards.map(([label,value,sub2],index)=>`<article class="dc-admin-card ${index<3?'priority':''}"><span class="dc-admin-card-label">${esc(label)}</span><strong>${esc(String(value))}</strong><em>${esc(sub2)}</em></article>`).join('')}</div>
  <section class="dc-admin-overview-split"><article class="dc-admin-panel"><div class="dc-admin-panel-head"><div><span class="dc-admin-card-label">Creator funnel</span><h2>From signup to published clip</h2></div></div><div class="dc-admin-funnel"><div><span>Signed up</span><strong>${users}</strong><i style="width:100%"></i></div><div><span>Active this week</span><strong>${active}</strong><i style="width:${users?Math.max(5,active/users*100):0}%"></i></div><div><span>Paying</span><strong>${paid}</strong><i style="width:${users?Math.max(5,paid/users*100):0}%"></i></div><div><span>Clips posted</span><strong>${posted}</strong><i style="width:${Math.max(5,Math.min(100,posted/Math.max(1,users)*12))}%"></i></div></div></article><article class="dc-admin-panel"><div class="dc-admin-panel-head"><div><span class="dc-admin-card-label">Latest token activity</span><h2>What just happened</h2></div><button class="dc-admin-text-btn" type="button" data-admin-jump="activity">View all</button></div><div class="dc-admin-timeline">${recent.length?recent.map(e=>`<div><i class="${e.type==='tokens_charged'?'used':'added'}"></i><span><strong>${esc(e.message||e.type||'Billing event')}</strong><small>${formatRelative(e.createdAt)}</small></span><b>${e.amount?`${e.type==='tokens_charged'?'−':'+'}${Number(e.amount).toLocaleString()}`:'—'}</b></div>`).join(''):'<p class="dc-admin-note">No recent token activity.</p>'}</div></article></section>`;
}

function adminSubscriptions(){
  const sub=adminOps?.subscriptions;if(!sub)return '';
  const prices=sub.planPrices||{};
  const planRows=(sub.plans||[]).map(p=>`<tr><td><strong>${esc(p.plan)}</strong>${prices[p.plan]?`<span class="dc-admin-dim"> · ${esc(prices[p.plan])}</span>`:''}</td><td>${p.users}</td><td>${p.active}</td><td>${p.trialing}</td><td>${p.canceled}</td></tr>`).join('');
  const renewalRows=(sub.upcomingRenewals||[]).map(r=>`<tr><td><strong>${esc(r.name)}</strong><span class="dc-admin-dim">${esc(r.email)}</span></td><td>${esc(r.plan)}</td><td>${esc(r.status)}</td><td>${formatDay(r.renewsAt)}</td><td>${r.daysUntil<0?'<span class="dc-status-pill bad">Overdue</span>':`${r.daysUntil}d`}</td></tr>`).join('');
  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Plans</h2>${sub.stripeReady?`<span class="dc-status-pill good">Stripe live</span>`:`<span class="dc-status-pill bad">Stripe not configured</span>`}</div>
    <p class="dc-admin-note">${sub.payingUsers||0} paying · ${sub.trialUsers||0} trialing · ${sub.totalUsers||0} total accounts. Trial length ${sub.trialDays||0} days.</p>
    <table class="dc-admin-table"><thead><tr><th>Plan</th><th>Users</th><th>Active</th><th>Trialing</th><th>Cancelled</th></tr></thead><tbody>${planRows||'<tr><td colspan="5">No plan data yet.</td></tr>'}</tbody></table></section>
  <section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Upcoming renewals</h2></div>
    <table class="dc-admin-table"><thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Renews</th><th>In</th></tr></thead><tbody>${renewalRows||'<tr><td colspan="5">No subscription renewals scheduled.</td></tr>'}</tbody></table></section>`;
}

function adminStorage(){
  const s=adminOps?.storage;if(!s)return '';
  if(!s.configured)return `<section class="dc-admin-panel"><h2>Storage</h2><p class="dc-admin-note">Object storage is not configured.</p></section>`;
  if(s.error)return `<section class="dc-admin-panel"><h2>Storage</h2><p class="dc-admin-note">Could not read the bucket: ${esc(s.error)}</p></section>`;
  const max=Math.max(1,...(s.folders||[]).map(f=>f.bytes));
  const rows=(s.folders||[]).map(f=>`<div class="dc-quality-row"><span>${esc(f.prefix)}/</span><div class="dc-quality-bar"><i style="width:${Math.round(f.bytes/max*100)}%"></i></div><b>${formatBytes(f.bytes)}</b></div><div class="dc-admin-dim" style="margin:-4px 0 10px">${f.objects.toLocaleString()} objects</div>`).join('');
  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>${esc(s.bucket)}</h2><span class="dc-status-pill">${esc(s.region)}</span></div>
    <div class="dc-admin-grid">
      <article class="dc-admin-card"><span class="dc-admin-card-label">Total stored</span><strong>${formatBytes(s.totalBytes)}</strong><em>${(s.totalObjects||0).toLocaleString()} objects</em></article>
      <article class="dc-admin-card"><span class="dc-admin-card-label">Oldest file</span><strong>${formatDay(s.oldestAt)}</strong><em>first upload</em></article>
      <article class="dc-admin-card"><span class="dc-admin-card-label">Newest file</span><strong>${formatDay(s.newestAt)}</strong><em>most recent write</em></article>
    </div>
    ${s.truncated?`<p class="dc-admin-note">Scan stopped after ${s.scannedPages} pages — totals are a lower bound.</p>`:''}
    <h3 class="dc-admin-subhead">Breakdown by folder</h3>${rows||'<p class="dc-admin-note">Bucket is empty.</p>'}</section>`;
}

function adminIntegrations(){
  const rows=adminOps?.integrations||[];
  const grouped=new Map();
  rows.forEach(r=>{const list=grouped.get(r.category)||[];list.push(r);grouped.set(r.category,list)});
  return [...grouped.entries()].map(([category,items])=>`<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>${esc(category)}</h2></div>
    <div class="dc-admin-list">${items.map(item=>`<div class="dc-admin-row"><div class="dc-admin-row-copy"><strong>${esc(item.name)}${item.required?'<em class="dc-admin-req">required</em>':''}</strong><span>${esc(item.detail)}</span><span class="dc-admin-dim">${item.envKeys.map(esc).join(' · ')}</span></div><div class="dc-admin-row-actions">${adminStatusPill(item.status)}${item.dashboard?`<a class="dc-btn secondary" href="${esc(item.dashboard)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}</div></div>`).join('')}</div></section>`).join('');
}

function adminVendors(){
  const v=adminOps?.vendors;if(!v)return '';
  const rows=(v.vendors||[]).map(row=>`<div class="dc-admin-row"><div class="dc-admin-row-copy"><strong>${esc(row.name)}</strong><span>${esc(row.plan||'—')} · ${formatMoney(row.cost,row.currency)} ${esc(row.cycle)}</span>${row.notes?`<span class="dc-admin-dim">${esc(row.notes)}</span>`:''}</div><div class="dc-admin-row-actions">${row.renewsAt?`<span class="dc-status-pill${row.overdue?' bad':row.dueSoon?' warn':''}">${row.overdue?'Overdue':`${formatDay(row.renewsAt)}`}</span>`:'<span class="dc-status-pill">No date</span>'}${row.url?`<a class="dc-btn secondary" href="${esc(row.url)}" target="_blank" rel="noopener noreferrer">Open</a>`:''}<button class="dc-btn secondary" type="button" data-vendor-delete="${esc(row.id)}">Remove</button></div></div>`).join('');
  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>What you pay for</h2><span class="dc-status-pill">${formatMoney(v.totalMonthly||0)} / month</span></div>
    <p class="dc-admin-note">These services have no API to query, so record them here to keep every renewal date in one place.</p>
    <div class="dc-admin-list">${rows||'<p class="dc-admin-note">Nothing recorded yet.</p>'}</div>
    <h3 class="dc-admin-subhead">Add or update</h3>
    <form class="dc-admin-form" id="dcVendorForm">
      <label>Service<input name="name" placeholder="SocialKit" required></label>
      <label>Plan<input name="plan" placeholder="Pro"></label>
      <label>Cost<input name="cost" type="number" min="0" step="0.01" placeholder="29"></label>
      <label>Currency<input name="currency" value="USD" maxlength="6"></label>
      <label>Billing cycle<select name="cycle"><option value="monthly">Monthly</option><option value="yearly">Yearly</option><option value="weekly">Weekly</option><option value="one-off">One-off</option></select></label>
      <label>Next payment<input name="renewsAt" type="date"></label>
      <label class="wide">Dashboard URL<input name="url" type="url" placeholder="https://..."></label>
      <label class="wide">Notes<input name="notes" placeholder="Card ending 1234"></label>
      <div class="wide"><button class="dc-btn" type="submit">Save service</button></div>
    </form></section>`;
}

function adminUsers(){
  const users=adminAnalytics?.users||[];
  const query=adminUserQuery.trim().toLowerCase();
  const filtered=users.filter(u=>(adminUserPlan==='all'||u.plan===adminUserPlan)&&(!query||`${u.name} ${u.email} ${u.plan} ${u.billingStatus} ${u.role}`.toLowerCase().includes(query)));
  const rows=filtered.slice(0,250).map(u=>`<tr><td><strong>${esc(u.name)}</strong><span class="dc-admin-dim">${esc(u.email)}</span></td><td><span class="dc-status-pill ${u.plan==='monthly'||u.plan==='yearly'?'good':''}">${esc(u.plan)}</span></td><td>${esc(u.billingStatus)}</td><td><strong>${u.remainingTokens===null?'∞':Number(u.remainingTokens||0).toLocaleString()}</strong><span class="dc-admin-dim">${Number(u.tokensUsed||0).toLocaleString()} used</span></td><td>${u.projects}</td><td>${u.clips}</td><td>${u.posted}</td><td>${u.failed?`<span class="dc-status-pill bad">${u.failed}</span>`:'0'}</td><td>${u.lastLoginAt?formatRelative(u.lastLoginAt):'Never'}</td></tr>`).join('');
  return `<section class="dc-admin-panel dc-admin-users-panel"><div class="dc-admin-panel-head"><div><span class="dc-admin-card-label">Account directory</span><h2>Users and customer health</h2><p class="dc-admin-note">Search accounts, inspect product usage and export the current operational view.</p></div><span class="dc-status-pill">${filtered.length} of ${users.length}</span></div><div class="dc-admin-user-tools"><label class="dc-admin-search-box"><span>⌕</span><input id="dcAdminUserSearch" type="search" value="${esc(adminUserQuery)}" placeholder="Search name, email, role or status"></label><select id="dcAdminPlanFilter" aria-label="Filter users by plan"><option value="all">All plans</option>${['free','weekly','monthly','yearly','admin'].map(p=>`<option value="${p}" ${adminUserPlan===p?'selected':''}>${p[0].toUpperCase()+p.slice(1)}</option>`).join('')}</select><button class="dc-btn secondary" type="button" id="dcAdminExportUsers">Export CSV</button></div><table class="dc-admin-table"><thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Tokens</th><th>Videos</th><th>Clips</th><th>Posted</th><th>Failures</th><th>Last seen</th></tr></thead><tbody>${rows||'<tr><td colspan="9">No accounts match these filters.</td></tr>'}</tbody></table></section>`;
}

function adminActivity(){
  const billing=adminAnalytics?.recentActivity||[],app=adminAnalytics?.recentApplicationActivity||[];
  const events=[...billing.map(e=>({...e,kind:'billing',label:e.message||e.type||'Billing activity'})),...app.map((e,index)=>({...e,id:`app_${index}`,kind:'system',label:`${String(e.level||'info').toUpperCase()} application event`}))].sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0)).slice(0,80);
  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><div><span class="dc-admin-card-label">Audit stream</span><h2>Recent account and system activity</h2><p class="dc-admin-note">A read-only operational trail. Sensitive payloads and credentials are never included.</p></div><span class="dc-status-pill">${events.length} events</span></div><div class="dc-admin-activity-list">${events.length?events.map(e=>`<div class="dc-admin-activity-item"><span class="dc-admin-activity-icon ${esc(e.kind)}">${e.kind==='billing'?'$':'•'}</span><div><strong>${esc(e.label)}</strong><span>${e.userId?`User ${esc(String(e.userId).slice(0,12))} · `:''}${esc(formatDay(e.createdAt))} · ${esc(formatRelative(e.createdAt))}</span></div><b>${e.amount?`${e.type==='tokens_charged'?'−':'+'}${Number(e.amount).toLocaleString()} tokens`:esc(e.level||e.kind)}</b></div>`).join(''):'<p class="dc-admin-note">No recent activity has been recorded.</p>'}</div></section>`;
}

function exportAdminUsers(){
  const users=adminAnalytics?.users||[];
  const headings=['Name','Email','Role','Plan','Billing status','Tokens remaining','Tokens used','Projects','Clips','Posted','Failures','Joined','Last login'];
  const cell=value=>`"${String(value??'').replace(/"/g,'""')}"`;
  const rows=users.map(u=>[u.name,u.email,u.role,u.plan,u.billingStatus,u.remainingTokens===null?'unlimited':u.remainingTokens,u.tokensUsed,u.projects,u.clips,u.posted,u.failed,new Date(u.createdAt||0).toISOString(),u.lastLoginAt?new Date(u.lastLoginAt).toISOString():'']);
  const blob=new Blob([[headings,...rows].map(row=>row.map(cell).join(',')).join('\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`deenclipped-users-${new Date().toISOString().slice(0,10)}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}


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

function renderAdminPage(){
  const panel=$('#view-admin');if(!panel)return;
  if(!isOperator()){panel.innerHTML=`<div class="dc-empty v3"><div><div class="dc-empty-icon">${ICON.settings}</div><strong>Not available</strong></div></div>`;return}
  if(!adminOps&&!adminOpsError){
    panel.innerHTML=`<div class="dc-manage-page"><section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.analytics} Admin console</span><h1>Loading operations data…</h1><p>Reading storage totals, integration status and subscription records.</p></div></section></div>`;
    loadAdminOps();return;
  }
  const body=adminOpsError
    ? `<section class="dc-admin-panel"><h2>Could not load</h2><p class="dc-admin-note">${esc(adminOpsError)}</p><button class="dc-btn" type="button" id="dcAdminRetry">Try again</button></section>`
    : adminTab==='overview'?adminOverview()
      :adminTab==='services'?adminServices()
      :adminTab==='subscriptions'?adminSubscriptions()
        :adminTab==='users'?adminUsers()
          :adminTab==='activity'?adminActivity()
            :adminTab==='storage'?adminStorage()
          :adminTab==='integrations'?adminIntegrations()
            :adminTab==='vendors'?adminVendors()
              :adminOverview();
  const generated=adminOps?.generatedAt||adminAnalytics?.generatedAt;
  const missing=Number(adminOps?.integrationSummary?.missing||0);
  panel.innerHTML=`<div class="dc-manage-page">
    <section class="dc-studio-hero dc-admin-hero"><div><span class="dc-manage-kicker">${ICON.analytics} Owner command centre</span><h1>Run DeenClipped with confidence.</h1><p>Customers, revenue, infrastructure, integrations and operating costs—one secure view with no secrets exposed.</p><div class="dc-admin-live-line"><span><i class="${missing?'warn':''}"></i>${missing?`${missing} required setup item${missing===1?'':'s'}`:'Core systems ready'}</span><span>Updated ${generated?formatRelative(generated):'just now'}</span></div></div><div class="dc-studio-actions"><button class="dc-btn secondary dc-svg" type="button" id="dcAdminRefresh">${ICON.refresh||''} Refresh data</button></div></section>
    ${adminTabs()}${body}</div>`;
  $$('[data-admin-tab]',panel).forEach(btn=>btn.addEventListener('click',()=>{adminTab=btn.dataset.adminTab;renderAdminPage();}));
  $$('[data-admin-jump]',panel).forEach(btn=>btn.addEventListener('click',()=>{adminTab=btn.dataset.adminJump;renderAdminPage();}));
  $$('[data-vendor-delete]',panel).forEach(btn=>btn.addEventListener('click',async()=>{
    try{await callApi(`/api/admin/vendors/${encodeURIComponent(btn.dataset.vendorDelete)}`,{method:'DELETE'});notify('Removed.','good');adminOps=null;renderAdminPage();}
    catch(error){notify(error.message,'bad')}
  }));
  $('#dcAdminRefresh')?.addEventListener('click',()=>{adminOps=null;adminAnalytics=null;renderAdminPage();});
  $('#dcAdminRetry')?.addEventListener('click',()=>{adminOpsError='';adminOps=null;renderAdminPage();});
  let userSearchTimer;
  $('#dcAdminUserSearch')?.addEventListener('input',event=>{clearTimeout(userSearchTimer);const value=event.target.value;userSearchTimer=setTimeout(()=>{adminUserQuery=value;renderAdminPage();const input=$('#dcAdminUserSearch');if(input){input.focus();input.setSelectionRange(input.value.length,input.value.length)}},180)});
  $('#dcAdminPlanFilter')?.addEventListener('change',event=>{adminUserPlan=event.target.value;renderAdminPage()});
  $('#dcAdminExportUsers')?.addEventListener('click',exportAdminUsers);
  $('#dcSocialkitForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const fd=new FormData(event.target);
    try{
      await callApi('/api/admin/service-meta',{method:'POST',body:JSON.stringify({service:'socialkit',planCredits:Number(fd.get('planCredits')||0),resetDay:Number(fd.get('resetDay')||0)})});
      notify('Saved.','good');adminOps=null;renderAdminPage();
    }catch(error){notify(error.message,'bad')}
  });
  $('#dcVendorForm')?.addEventListener('submit',async event=>{
    event.preventDefault();
    const form=event.target,fd=new FormData(form);
    const renews=String(fd.get('renewsAt')||'');
    const payload={
      name:String(fd.get('name')||''),plan:String(fd.get('plan')||''),
      cost:Number(fd.get('cost')||0),currency:String(fd.get('currency')||'USD'),
      cycle:String(fd.get('cycle')||'monthly'),url:String(fd.get('url')||''),
      notes:String(fd.get('notes')||''),renewsAt:renews?Date.parse(`${renews}T12:00:00`):0,
    };
    try{
      await callApi('/api/admin/vendors',{method:'POST',body:JSON.stringify(payload)});
      notify('Saved.','good');adminOps=null;renderAdminPage();
    }catch(error){notify(error.message,'bad')}
  });
  requestAnimationFrame(()=>animatePanel(panel));
}

const DC_ADMIN_CSS = `
/* --- Admin console ------------------------------------------------------- */
.dc-admin-tabs{position:sticky;top:68px;z-index:12;display:flex;gap:4px;overflow-x:auto;margin:0;padding:5px;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:rgba(11,11,13,.88);backdrop-filter:blur(18px);scrollbar-width:none}
.dc-admin-tabs::-webkit-scrollbar{display:none}
#dcSidebar{background:#0c0c0e!important;z-index:400!important}
#dcTopbar{z-index:390!important}
body.dc-app .main-col>.panel{position:relative;z-index:1}
body.dc-app #app>.wrap{box-sizing:border-box}
body.dc-project-open .dc-project-detail-page,body.dc-project-open .dc-project-clip-grid{min-width:0!important;max-width:100%!important}
.dc-manage-page>*{min-width:0;max-width:100%}
.dc-admin-grid,.dc-admin-panel,.dc-admin-list,.dc-admin-row{min-width:0;max-width:100%}
.dc-admin-table{display:block;overflow-x:auto;white-space:nowrap}
.dc-admin-row-copy strong,.dc-admin-row-copy span{overflow-wrap:anywhere}
.dc-admin-tab{min-height:38px;flex:0 0 auto;padding:0 14px;border:0;border-radius:11px;background:transparent;color:var(--dc-muted);font-size:10px;font-weight:800}
.dc-admin-tab:hover{color:var(--dc-text);border-color:rgba(221,183,118,.3)}
.dc-admin-tab.is-active{background:linear-gradient(145deg,rgba(217,180,120,.19),rgba(217,180,120,.08));box-shadow:0 0 0 1px rgba(217,180,120,.28) inset;color:var(--dc-accent2)}
.dc-admin-hero{border-color:rgba(217,180,120,.25)!important;background:radial-gradient(circle at 86% 5%,rgba(217,180,120,.18),transparent 35%),radial-gradient(circle at 15% 120%,rgba(66,168,255,.09),transparent 30%),linear-gradient(145deg,#18140f,#101014 62%)!important}
.dc-admin-live-line{display:flex;gap:14px;flex-wrap:wrap;margin-top:13px;color:var(--dc-muted);font-size:9px}.dc-admin-live-line span{display:inline-flex;align-items:center;gap:6px}.dc-admin-live-line i{width:7px;height:7px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 4px rgba(83,199,139,.09)}.dc-admin-live-line i.warn{background:var(--dc-orange);box-shadow:0 0 0 4px rgba(229,169,87,.09)}
.dc-admin-command-row{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(320px,.75fr);gap:12px}.dc-admin-health{display:flex;align-items:center;gap:18px;padding:20px;border:1px solid rgba(217,180,120,.18);border-radius:22px;background:linear-gradient(145deg,rgba(217,180,120,.08),rgba(255,255,255,.022))}.dc-admin-health-ring{--score:0;position:relative;width:94px;height:94px;flex:0 0 94px;display:grid;place-content:center;text-align:center;border-radius:50%;background:radial-gradient(circle at center,#111114 58%,transparent 60%),conic-gradient(var(--dc-accent2) calc(var(--score)*1%),rgba(255,255,255,.07) 0)}.dc-admin-health-ring strong{font-size:28px;line-height:1;letter-spacing:-.05em}.dc-admin-health-ring span{margin-top:2px;color:var(--dc-muted);font-size:8px}.dc-admin-health h2{margin:5px 0 4px;font-size:19px}.dc-admin-health p{margin:0;color:var(--dc-muted);font-size:10px}.dc-admin-quick-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-admin-quick-actions button{min-height:55px;padding:0 13px;border:1px solid rgba(255,255,255,.075);border-radius:15px;background:linear-gradient(145deg,#151519,#0d0d10);color:var(--dc-muted);font-size:10px;font-weight:750;text-align:left}.dc-admin-quick-actions button:hover{border-color:rgba(217,180,120,.26);color:var(--dc-text);transform:translateY(-1px)}
.dc-admin-section-title{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:3px}.dc-admin-section-title span:first-child{color:#ffb3b3;font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.dc-admin-section-title h2{margin:4px 0 0;font-size:15px;color:var(--dc-text)}
.dc-admin-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}
.dc-admin-card{padding:15px;border:1px solid var(--dc-line);border-radius:18px;background:linear-gradient(145deg,#151519,#0d0d10)}
.dc-admin-kpi-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.dc-admin-card.priority{border-color:rgba(217,180,120,.16);background:radial-gradient(circle at 100% 0,rgba(217,180,120,.09),transparent 45%),linear-gradient(145deg,#171619,#0d0d10)}
.dc-admin-card-label{display:block;color:var(--dc-subtle);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}
.dc-admin-card strong{display:block;font-size:24px;margin:7px 0 3px;letter-spacing:-.02em}
.dc-admin-card em{display:block;font-style:normal;color:var(--dc-muted);font-size:9.5px}
.dc-admin-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}
.dc-admin-panel-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px}
.dc-admin-panel h2{font-size:16px;margin:0}
.dc-admin-panel-head>div>.dc-admin-note{margin:5px 0 0}.dc-admin-overview-split{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dc-admin-funnel{display:grid;gap:12px}.dc-admin-funnel>div{position:relative;display:grid;grid-template-columns:1fr auto;gap:8px;padding-bottom:8px}.dc-admin-funnel span{color:var(--dc-muted);font-size:10px}.dc-admin-funnel strong{font-size:11px}.dc-admin-funnel i{position:absolute;left:0;bottom:0;height:4px;max-width:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2))}.dc-admin-text-btn{border:0;background:transparent;color:var(--dc-accent2);font-size:9px;font-weight:800}.dc-admin-timeline{display:grid}.dc-admin-timeline>div{display:grid;grid-template-columns:10px minmax(0,1fr) auto;gap:9px;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.055)}.dc-admin-timeline>div:last-child{border-bottom:0}.dc-admin-timeline i{width:8px;height:8px;border-radius:50%;background:var(--dc-green)}.dc-admin-timeline i.used{background:var(--dc-accent)}.dc-admin-timeline span strong,.dc-admin-timeline span small{display:block}.dc-admin-timeline span strong{font-size:9.5px}.dc-admin-timeline span small{margin-top:2px;color:var(--dc-subtle);font-size:8px}.dc-admin-timeline>div>b{color:var(--dc-accent2);font-size:10px}
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
.dc-admin-users-panel{overflow:hidden}.dc-admin-users-panel>.dc-admin-table{margin:0 -16px -16px;width:calc(100% + 32px)}.dc-admin-user-tools{display:grid;grid-template-columns:minmax(220px,1fr) 150px auto;gap:8px;margin:12px 0}.dc-admin-search-box{position:relative}.dc-admin-search-box span{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--dc-subtle)}.dc-admin-search-box input,.dc-admin-user-tools select{width:100%;height:40px;border:1px solid var(--dc-line);border-radius:11px;background:#0b0b0d;color:var(--dc-text)}.dc-admin-search-box input{padding:0 12px 0 34px}.dc-admin-user-tools select{padding:0 10px}.dc-admin-user-tools .dc-btn{height:40px}
.dc-admin-activity-list{display:grid}.dc-admin-activity-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:11px;align-items:center;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.055)}.dc-admin-activity-item:last-child{border-bottom:0}.dc-admin-activity-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(255,255,255,.055);color:var(--dc-muted);font-weight:900}.dc-admin-activity-icon.billing{background:rgba(217,180,120,.11);color:var(--dc-accent2)}.dc-admin-activity-item>div strong,.dc-admin-activity-item>div span{display:block}.dc-admin-activity-item>div strong{font-size:10px}.dc-admin-activity-item>div span{margin-top:3px;color:var(--dc-subtle);font-size:8.5px}.dc-admin-activity-item>b{color:var(--dc-muted);font-size:9px;text-transform:capitalize}
.dc-admin-alerts{display:grid;gap:7px}
.dc-admin-alert{display:flex;align-items:center;gap:9px;padding:10px 12px;border:1px solid rgba(255,138,138,.24);border-radius:12px;background:rgba(255,90,90,.07);color:#ffb3b3;font-size:10.5px}
.dc-admin-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.dc-admin-form label{display:grid;gap:6px;color:var(--dc-muted);font-size:9px}
.dc-admin-form input,.dc-admin-form select{width:100%;height:38px;padding:0 10px;border:1px solid var(--dc-line);border-radius:10px;background:#0b0b0d;color:var(--dc-text)}
.dc-admin-form .wide{grid-column:1/-1}
@media(max-width:1050px){.dc-admin-kpi-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-admin-command-row,.dc-admin-overview-split{grid-template-columns:1fr}}
@media(max-width:820px){.dc-admin-form{grid-template-columns:1fr}.dc-admin-row{flex-direction:column;align-items:flex-start}.dc-admin-user-tools{grid-template-columns:1fr}.dc-admin-tabs{top:60px}.dc-admin-command-row{grid-template-columns:1fr}.dc-admin-health{align-items:flex-start}.dc-admin-activity-item{grid-template-columns:30px minmax(0,1fr)}.dc-admin-activity-item>b{grid-column:2}.dc-admin-kpi-grid{grid-template-columns:1fr 1fr}}
@media(max-width:520px){.dc-admin-health{flex-direction:column}.dc-admin-quick-actions,.dc-admin-kpi-grid{grid-template-columns:1fr}.dc-admin-tabs{margin-left:-2px;margin-right:-2px}}

/* --- Editor reliability and selection system ---------------------------- */
#dcEditorSaveState{font-weight:750;color:var(--dc-green)}#dcEditorSaveState.is-draft{color:var(--dc-accent2)}
.dc-layer-switch{display:flex;gap:3px;padding:3px;border:1px solid rgba(255,255,255,.08);border-radius:9px;background:#09090b}.dc-layer-switch button,.dc-safe-toggle{min-height:28px;padding:0 9px;border:0;border-radius:6px;background:transparent;color:var(--dc-subtle);font-size:8px;font-weight:800}.dc-layer-switch button.on,.dc-safe-toggle.on{background:rgba(217,180,120,.13);color:var(--dc-accent2);box-shadow:0 0 0 1px rgba(217,180,120,.22) inset}.dc-safe-toggle{border:1px solid rgba(255,255,255,.07)}
.dc-video-canvas.is-video-selected{box-shadow:0 0 0 2px rgba(217,180,120,.72),0 26px 70px rgba(0,0,0,.58)!important}.dc-video-canvas.is-video-selected .dc-layer-badge{background:rgba(217,180,120,.9);color:#17120a}.dc-video-canvas:not(.is-video-selected) .dc-resize-handle{opacity:.55}
.dc-safe-zone{position:absolute;inset:8% 7% 12%;z-index:12;display:none;border:1px dashed rgba(255,255,255,.38);border-radius:8px;pointer-events:none}.dc-safe-zone.show{display:block}.dc-safe-zone::before,.dc-safe-zone::after{content:'';position:absolute;background:rgba(255,255,255,.18)}.dc-safe-zone::before{left:50%;top:0;bottom:0;width:1px}.dc-safe-zone::after{left:0;right:0;top:50%;height:1px}.dc-safe-zone span{position:absolute;right:6px;top:6px;padding:3px 5px;border-radius:5px;background:#000a;color:#aaa;font-size:6px;letter-spacing:.07em;text-transform:uppercase}
.dc-caption-overlay.is-selected{outline:2px solid rgba(255,255,255,.76);outline-offset:9px}.dc-caption-overlay.is-selected::before{content:'CAPTIONS';position:absolute;left:-10px;top:-28px;padding:4px 7px;border-radius:6px;background:rgba(217,180,120,.92);color:#17120a;font-size:6px;font-weight:950;letter-spacing:.08em;-webkit-text-stroke:0}.dc-caption-overlay.is-selected::after{border-color:var(--dc-accent2);background:#111}.dc-timeline-help{color:var(--dc-subtle);font-size:7.5px}
@media(max-width:900px){.dc-canvas-toolbar{flex-wrap:wrap;height:auto!important;min-height:48px;padding-top:7px!important;padding-bottom:7px!important}.dc-canvas-toolbar .dc-zoom{display:none}.dc-layer-switch{order:4}.dc-safe-toggle{order:5}}
@media(max-width:520px){.dc-caption-edit-shortcut,.dc-safe-toggle{display:none}.dc-layer-switch button{padding:0 7px}.dc-timeline-help{display:none}}

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
`;
const DC_PRODUCT_CSS = `
/* --- Product-wide premium system --------------------------------------- */
:root{--dc-page-accent:#d9b478;--dc-page-soft:rgba(217,180,120,.12)}
body.dc-app{background:radial-gradient(circle at 82% -10%,rgba(67,132,195,.08),transparent 34%),radial-gradient(circle at 18% 108%,rgba(217,180,120,.06),transparent 30%),#09090b!important}
body.dc-app #app>.wrap::before{content:'';position:fixed;z-index:-1;left:var(--dc-side);right:0;top:var(--dc-top);height:240px;background:linear-gradient(180deg,var(--dc-page-soft),transparent);opacity:.35;pointer-events:none}
body.dc-app .main-col>.panel{--page-accent:var(--dc-page-accent);--page-soft:var(--dc-page-soft);isolation:isolate}
#view-home{--page-accent:#d9b478;--page-soft:rgba(217,180,120,.12)}#view-projects{--page-accent:#72b7ff;--page-soft:rgba(75,151,228,.12)}#view-review{--page-accent:#edb763;--page-soft:rgba(237,183,99,.12)}#view-editor{--page-accent:#b796ff;--page-soft:rgba(159,117,244,.12)}#view-schedule{--page-accent:#70d7a2;--page-soft:rgba(84,201,143,.11)}#view-publishing{--page-accent:#66d5ff;--page-soft:rgba(71,189,232,.11)}#view-templates{--page-accent:#d9b478;--page-soft:rgba(217,180,120,.12)}#view-brand{--page-accent:#efc976;--page-soft:rgba(239,201,118,.13)}#view-lab{--page-accent:#b590ff;--page-soft:rgba(155,111,240,.13)}#view-music{--page-accent:#ff8fc9;--page-soft:rgba(235,104,173,.12)}#view-insights{--page-accent:#71d6a0;--page-soft:rgba(83,199,139,.12)}#view-automation{--page-accent:#8eb9ff;--page-soft:rgba(97,151,233,.12)}#view-subscription{--page-accent:#e8bd76;--page-soft:rgba(232,189,118,.13)}
body.dc-app .dc-page-head,body.dc-app .dc-review-hero-pro,body.dc-app .dc-manage-hero,body.dc-app .dc-studio-hero,body.dc-app .dc-publish-hero,body.dc-app .dc-product-hero{border-color:color-mix(in srgb,var(--page-accent) 25%,transparent)!important;background:radial-gradient(circle at 7% 0,var(--page-soft),transparent 35%),radial-gradient(circle at 92% 18%,rgba(78,145,223,.07),transparent 27%),linear-gradient(145deg,#17171b,#0c0c0f)!important;box-shadow:0 25px 75px rgba(0,0,0,.22)}
body.dc-app .dc-page-head::before,body.dc-app .dc-manage-hero::before,body.dc-app .dc-studio-hero::before,body.dc-app .dc-product-hero::before{content:'';position:absolute;left:24px;right:24px;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,var(--page-accent),transparent);opacity:.42}
#dcTopbar{background:rgba(11,11,14,.84)!important;box-shadow:0 10px 35px rgba(0,0,0,.18);backdrop-filter:blur(22px) saturate(1.2)}#dcSidebar{background:linear-gradient(180deg,#0d0d10,#09090b)!important;box-shadow:12px 0 40px rgba(0,0,0,.12)}
.dc-nav-button[data-dc-nav=projects] .dc-nav-icon{color:#72b7ff}.dc-nav-button[data-dc-nav=review] .dc-nav-icon{color:#edb763}.dc-nav-button[data-dc-nav=schedule] .dc-nav-icon{color:#70d7a2}.dc-nav-button[data-dc-nav=publishing] .dc-nav-icon{color:#66d5ff}.dc-nav-button[data-dc-nav=editor] .dc-nav-icon{color:#b796ff}.dc-nav-button[data-dc-nav=brand] .dc-nav-icon{color:#efc976}.dc-nav-button[data-dc-nav=lab] .dc-nav-icon{color:#b590ff}.dc-nav-button[data-dc-nav=music] .dc-nav-icon{color:#ff8fc9}.dc-nav-button[data-dc-nav=insights] .dc-nav-icon{color:#71d6a0}.dc-nav-button[data-dc-nav=automation] .dc-nav-icon{color:#8eb9ff}.dc-nav-button[data-dc-nav=subscription] .dc-nav-icon{color:#e8bd76}
.dc-nav-button.is-active{background:linear-gradient(90deg,color-mix(in srgb,currentColor 10%,transparent),rgba(255,255,255,.025))!important;box-shadow:0 0 0 1px rgba(255,255,255,.035) inset}.dc-nav-button.is-active::before{content:'';position:absolute;left:0;top:9px;bottom:9px;width:3px;border-radius:99px;background:currentColor;box-shadow:0 0 18px currentColor}.dc-nav-button[data-dc-nav=brand] .dc-nav-name::after,.dc-nav-button[data-dc-nav=lab] .dc-nav-name::after{content:'PRO';display:inline-flex;margin-left:7px;padding:2px 5px;border:1px solid rgba(217,180,120,.2);border-radius:99px;background:rgba(217,180,120,.08);color:#e8c37f;font-size:6px;font-weight:950;letter-spacing:.08em;vertical-align:middle}
.dc-product-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:24px;align-items:center;padding:30px;border:1px solid var(--dc-line);border-radius:28px}.dc-product-kicker{display:inline-flex;align-items:center;gap:8px;color:var(--page-accent);font-size:9px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.dc-product-kicker svg{width:16px;height:16px}.dc-product-hero h1{max-width:760px;margin:10px 0 8px;font-size:clamp(32px,4vw,50px);line-height:.96;letter-spacing:-.055em}.dc-product-hero p{max-width:720px;margin:0;color:var(--dc-muted);font-size:12px;line-height:1.6}
.dc-premium-orb{width:180px;min-height:150px;display:grid;place-items:center;align-content:center;text-align:center;padding:18px;border:1px solid rgba(255,255,255,.09);border-radius:25px;background:radial-gradient(circle at 50% 10%,rgba(255,255,255,.08),transparent 55%),rgba(0,0,0,.18)}.dc-premium-orb>span{width:48px;height:48px;display:grid;place-items:center;border-radius:16px;background:rgba(255,255,255,.055);color:var(--dc-muted)}.dc-premium-orb.on>span{background:rgba(217,180,120,.13);color:#efc976;box-shadow:0 0 30px rgba(217,180,120,.12)}.dc-premium-orb svg{width:25px;height:25px}.dc-premium-orb strong,.dc-premium-orb small{display:block}.dc-premium-orb strong{margin-top:10px;font-size:12px}.dc-premium-orb small{margin-top:3px;color:var(--dc-muted);font-size:8.5px}
.dc-brand-page,.dc-lab-page{display:grid;gap:15px}.dc-brand-layout{display:grid;grid-template-columns:minmax(300px,.75fr) minmax(430px,1.25fr);gap:15px}.dc-brand-preview-card,.dc-brand-controls,.dc-lab-panel,.dc-lab-locked{border:1px solid var(--dc-line);border-radius:25px;background:linear-gradient(145deg,#16161a,#0c0c0f);box-shadow:0 22px 65px rgba(0,0,0,.18)}.dc-brand-preview-card{min-height:610px;display:grid;place-items:center;align-content:center;padding:24px}.dc-brand-phone{position:relative;width:min(270px,80%);aspect-ratio:9/16;overflow:hidden;border:1px solid rgba(239,201,118,.35);border-radius:27px;background:#050506;box-shadow:0 28px 75px rgba(0,0,0,.5),0 0 35px rgba(239,201,118,.08)}.dc-brand-phone img{width:100%;height:100%;object-fit:cover;filter:saturate(.78) brightness(.8)}.dc-brand-watermark{position:absolute;z-index:3;padding:5px 8px;border-radius:7px;background:rgba(0,0,0,.48);color:var(--brand-color);font-size:10px;font-weight:950;letter-spacing:.15em;opacity:var(--brand-opacity);transition:.2s ease}.dc-brand-watermark.off{opacity:0}.dc-brand-watermark[data-position=top-left]{left:8%;top:7%}.dc-brand-watermark[data-position=top-center]{left:50%;top:7%;transform:translateX(-50%)}.dc-brand-watermark[data-position=top-right]{right:8%;top:7%}.dc-brand-watermark[data-position=bottom-left]{left:8%;bottom:7%}.dc-brand-watermark[data-position=bottom-center]{left:50%;bottom:7%;transform:translateX(-50%)}.dc-brand-watermark[data-position=bottom-right]{right:8%;bottom:7%}.dc-brand-phone>i{position:absolute;inset:auto 0 0;height:0;background:var(--brand-color);transition:height .2s}.dc-brand-phone>i.on{height:7px}.dc-brand-caption{position:absolute;left:10%;right:10%;top:52%;text-align:center;color:white;font:900 22px/1 Manrope,sans-serif;text-shadow:0 2px 10px #000;-webkit-text-stroke:1px #000}.dc-brand-caption em{color:#efc976;font-family:serif}.dc-brand-preview-copy{text-align:center;margin-top:17px}.dc-brand-preview-copy strong,.dc-brand-preview-copy span{display:block}.dc-brand-preview-copy strong{font-size:13px}.dc-brand-preview-copy span{margin-top:4px;color:var(--dc-muted);font-size:9px}
.dc-brand-controls{padding:20px}.dc-brand-entitlement{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:12px;align-items:center;margin-bottom:15px;padding:14px;border:1px solid rgba(255,255,255,.075);border-radius:18px;background:rgba(255,255,255,.025)}.dc-brand-entitlement>span{width:42px;height:42px;display:grid;place-items:center;border-radius:14px;background:rgba(217,180,120,.10);color:#efc976}.dc-brand-entitlement.free>span{background:rgba(229,169,87,.10);color:var(--dc-orange)}.dc-brand-entitlement svg{width:22px;height:22px}.dc-brand-entitlement strong{font-size:12px}.dc-brand-entitlement p{margin:4px 0 0;color:var(--dc-muted);font-size:9.5px;line-height:1.45}.dc-brand-form{display:grid;grid-template-columns:1fr 1fr;gap:10px}.dc-brand-form>label{display:grid;gap:7px;padding:12px;border:1px solid rgba(255,255,255,.065);border-radius:15px;background:rgba(0,0,0,.18);color:var(--dc-muted);font-size:9px}.dc-brand-form .wide{grid-column:1/-1}.dc-brand-form input:not([type=checkbox]):not([type=range]),.dc-brand-form select{width:100%;height:42px;padding:0 11px;border:1px solid var(--dc-line);border-radius:11px;background:#09090b;color:var(--dc-text)}.dc-brand-form input[type=color]{padding:4px!important}.dc-brand-form input[type=range]{width:100%;accent-color:#d9b478}.dc-brand-form label>b{justify-self:end;color:var(--dc-text)}.dc-brand-form .is-locked{opacity:.52}.dc-feature-ribbon{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.dc-feature-ribbon article{display:grid;grid-template-columns:38px 1fr;gap:2px 11px;padding:15px;border:1px solid var(--dc-line);border-radius:19px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-feature-ribbon article>span{grid-row:1/3;width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:var(--page-soft);color:var(--page-accent)}.dc-feature-ribbon svg{width:20px;height:20px}.dc-feature-ribbon strong{font-size:11px}.dc-feature-ribbon p{margin:3px 0 0;color:var(--dc-muted);font-size:8.5px;line-height:1.45}
.dc-editor-brand-summary{display:grid;grid-template-columns:36px minmax(0,1fr);gap:10px;align-items:center;padding:12px;border:1px solid rgba(255,255,255,.075);border-radius:14px;background:rgba(0,0,0,.22)}.dc-editor-brand-summary>span{width:36px;height:36px;display:grid;place-items:center;border-radius:11px;background:rgba(217,180,120,.11);color:#efc976}.dc-editor-brand-summary svg{width:19px;height:19px}.dc-editor-brand-summary strong,.dc-editor-brand-summary small{display:block}.dc-editor-brand-summary strong{font-size:10px}.dc-editor-brand-summary small{margin-top:3px;color:var(--dc-muted);font-size:8px;line-height:1.35}.dc-editor-brand-summary .dc-btn{grid-column:1/-1;width:100%}.dc-editor-brand-summary.locked{border-color:rgba(229,169,87,.2)}
.dc-product-stats{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-product-stats>span{min-width:110px;padding:11px;border:1px solid rgba(255,255,255,.075);border-radius:14px;background:rgba(0,0,0,.19)}.dc-product-stats b,.dc-product-stats em{display:block}.dc-product-stats b{font-size:23px}.dc-product-stats em{margin-top:2px;color:var(--dc-muted);font-size:8px;font-style:normal}.dc-lab-grid{display:grid;grid-template-columns:1fr 1fr;gap:15px}.dc-lab-panel{padding:18px}.dc-lab-panel.wide{grid-column:1/-1}.dc-lab-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:13px}.dc-lab-head span{color:#b590ff;font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.dc-lab-head h2{margin:4px 0 0;font-size:16px}.dc-lab-lineup{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-lab-lineup>button{display:grid;grid-template-columns:34px minmax(0,1fr) 20px;gap:10px;align-items:center;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(0,0,0,.19);color:var(--dc-text);text-align:left}.dc-lab-lineup>button:hover{border-color:rgba(181,144,255,.3);transform:translateY(-1px)}.dc-lab-lineup>button>span{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(181,144,255,.10);color:#c8acff;font-size:9px;font-weight:900}.dc-lab-lineup strong,.dc-lab-lineup small{display:block}.dc-lab-lineup strong{font-size:10.5px}.dc-lab-lineup small{margin-top:3px;color:var(--dc-muted);font-size:8px}.dc-lab-lineup i{color:var(--dc-subtle)}.dc-lab-lineup svg{width:16px;height:16px}.dc-topic-cloud{display:flex;gap:8px;flex-wrap:wrap}.dc-topic-cloud>span{display:inline-flex;align-items:center;gap:7px;padding:9px 11px;border:1px solid rgba(181,144,255,.13);border-radius:999px;background:rgba(181,144,255,.055);font-size:calc(8px + var(--weight)*.7px)}.dc-topic-cloud em{min-width:21px;height:21px;display:grid;place-items:center;border-radius:99px;background:rgba(181,144,255,.13);color:#c8acff;font-size:8px;font-style:normal}.dc-gap-list{display:grid;gap:8px}.dc-gap-list>div{display:grid;grid-template-columns:34px 1fr;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.06);border-radius:13px;background:rgba(0,0,0,.17)}.dc-gap-list>div>span{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(181,144,255,.1);color:#c8acff}.dc-gap-list svg{width:18px;height:18px}.dc-gap-list p{margin:0}.dc-gap-list strong,.dc-gap-list small{display:block}.dc-gap-list strong{font-size:10px}.dc-gap-list small{margin-top:2px;color:var(--dc-muted);font-size:8px}.dc-lab-hooks{display:grid;gap:8px}.dc-lab-hooks article{display:grid;grid-template-columns:42px minmax(0,1fr) auto;gap:11px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.06);border-radius:14px;background:rgba(0,0,0,.17)}.dc-lab-hooks article>span{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(113,214,160,.09);color:#71d6a0;font-weight:950}.dc-lab-hooks strong,.dc-lab-hooks small{display:block}.dc-lab-hooks strong{font-size:10.5px}.dc-lab-hooks small{margin-top:3px;color:var(--dc-muted);font-size:8px}.dc-lab-empty{grid-column:1/-1;padding:25px;text-align:center;color:var(--dc-muted);font-size:10px}.dc-lab-locked{position:relative;overflow:hidden;min-height:470px;display:grid;place-items:center;align-content:center;text-align:center;padding:34px;background:radial-gradient(circle at 50% 12%,rgba(181,144,255,.13),transparent 36%),linear-gradient(145deg,#16141d,#0c0c0f)}.dc-lab-lock-icon{width:68px;height:68px;display:grid;place-items:center;border:1px solid rgba(181,144,255,.22);border-radius:22px;background:rgba(181,144,255,.09);color:#c8acff;box-shadow:0 0 45px rgba(181,144,255,.10)}.dc-lab-lock-icon svg{width:33px;height:33px}.dc-lab-locked>span{margin-top:18px;color:#c8acff;font-size:8px;font-weight:900;letter-spacing:.13em;text-transform:uppercase}.dc-lab-locked h2{max-width:620px;margin:8px 0 8px;font-size:32px;letter-spacing:-.045em}.dc-lab-locked p{max-width:650px;margin:0;color:var(--dc-muted);font-size:11px;line-height:1.6}.dc-lab-teasers{display:flex;gap:7px;flex-wrap:wrap;justify-content:center;margin:18px 0}.dc-lab-teasers span{padding:8px 10px;border:1px solid rgba(181,144,255,.14);border-radius:99px;background:rgba(181,144,255,.055);color:#c9b0f8;font-size:8.5px}
/* Subscription account centre */
.dc-subscription-page{display:grid;gap:16px}.dc-sub-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) 250px;gap:28px;align-items:center;padding:30px;border:1px solid rgba(232,189,118,.25);border-radius:28px;background:radial-gradient(circle at 7% 0,rgba(232,189,118,.15),transparent 38%),radial-gradient(circle at 90% 20%,rgba(90,148,235,.10),transparent 30%),linear-gradient(145deg,#18171a,#0c0c0f);box-shadow:0 25px 75px rgba(0,0,0,.22)}.dc-sub-hero::after{content:'';position:absolute;left:28px;right:28px;bottom:-1px;height:1px;background:linear-gradient(90deg,transparent,#e8bd76,transparent);opacity:.55}.dc-sub-hero h1{max-width:790px;margin:10px 0 9px;font-size:clamp(34px,4vw,52px);line-height:.96;letter-spacing:-.058em}.dc-sub-hero p{max-width:720px;margin:0;color:var(--dc-muted);font-size:12px;line-height:1.65}.dc-sub-hero-balance{position:relative;padding:19px;border:1px solid rgba(255,255,255,.09);border-radius:22px;background:rgba(0,0,0,.27);box-shadow:0 18px 48px rgba(0,0,0,.24)}.dc-sub-hero-balance>span,.dc-sub-hero-balance>small,.dc-sub-hero-balance>strong{display:block}.dc-sub-hero-balance>span{color:#e8bd76;font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.dc-sub-hero-balance>strong{margin-top:5px;font-size:43px;line-height:1;letter-spacing:-.06em}.dc-sub-hero-balance>small{margin-top:4px;color:var(--dc-muted);font-size:9px}.dc-sub-hero-balance>div{height:5px;margin-top:15px;overflow:hidden;border-radius:99px;background:#2a292d}.dc-sub-hero-balance>div i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#e8bd76,#f3d7a1)}
.dc-sub-main-grid{display:grid;grid-template-columns:1.08fr .92fr .88fr;gap:14px;align-items:stretch}.dc-sub-card,.dc-sub-section{border:1px solid var(--dc-line);border-radius:24px;background:radial-gradient(circle at 100% 0,rgba(255,255,255,.045),transparent 35%),linear-gradient(145deg,#16161a,#0c0c0f);box-shadow:0 22px 60px rgba(0,0,0,.17)}.dc-sub-card{padding:18px}.dc-sub-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px}.dc-sub-card-head>div>span{display:block;color:var(--dc-subtle);font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.dc-sub-card-head h2{margin:5px 0 0;font-size:18px;letter-spacing:-.025em}.dc-sub-card-head h2 small{margin-left:6px;color:var(--dc-muted);font-size:9px;font-weight:600;letter-spacing:0}.dc-sub-status{display:inline-flex;align-items:center;gap:6px;min-height:27px;padding:0 9px;border:1px solid rgba(83,199,139,.18);border-radius:99px;background:rgba(83,199,139,.08);color:#74d9a5;font-size:8px;white-space:nowrap}.dc-sub-status i{width:6px;height:6px;border-radius:50%;background:currentColor;box-shadow:0 0 10px currentColor}.dc-sub-status.warn{border-color:rgba(229,169,87,.25);background:rgba(229,169,87,.09);color:#e9b66b}.dc-sub-status.bad{border-color:rgba(239,107,122,.25);background:rgba(239,107,122,.09);color:#f18591}.dc-sub-status.free{border-color:rgba(114,183,255,.2);background:rgba(114,183,255,.08);color:#87c5ff}.dc-sub-status.owner{border-color:rgba(232,189,118,.25);background:rgba(232,189,118,.09);color:#efcf98}.dc-sub-status-detail{margin:-4px 0 13px;color:var(--dc-muted);font-size:9.5px}.dc-sub-account{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 11px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(0,0,0,.19)}.dc-sub-account span{overflow:hidden;text-overflow:ellipsis;color:var(--dc-text);font-size:9px;white-space:nowrap}.dc-sub-account em{color:var(--dc-subtle);font-size:8px;font-style:normal;white-space:nowrap}.dc-sub-token-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin:12px 0}.dc-sub-token-grid>span{padding:10px;border:1px solid rgba(255,255,255,.06);border-radius:13px;background:rgba(255,255,255,.025)}.dc-sub-token-grid b,.dc-sub-token-grid em{display:block}.dc-sub-token-grid b{font-size:18px;letter-spacing:-.035em}.dc-sub-token-grid em{margin-top:2px;color:var(--dc-subtle);font-size:7.5px;font-style:normal}.dc-sub-usage>div{display:flex;justify-content:space-between;gap:10px;color:var(--dc-muted);font-size:8px}.dc-sub-usage>div b{color:var(--dc-text);font-weight:650}.dc-sub-usage>i{display:block;height:5px;margin-top:7px;overflow:hidden;border-radius:99px;background:#29292d}.dc-sub-usage>i em{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,#e8bd76,#f1d39c)}.dc-sub-actions{display:flex;gap:7px;margin-top:14px}.dc-sub-actions .dc-btn{flex:1;padding:0 10px}.dc-text-action{border:0;background:transparent;color:#e8bd76;font-size:8.5px;font-weight:800}.dc-text-action:hover{color:#f4d9a5}.dc-sub-feature-list{display:grid;gap:7px}.dc-sub-feature-list>div{display:grid;grid-template-columns:27px minmax(0,1fr);gap:9px;align-items:center;min-height:38px;padding:7px 9px;border:1px solid rgba(255,255,255,.055);border-radius:11px;background:rgba(0,0,0,.17)}.dc-sub-feature-list>div span{width:27px;height:27px;display:grid;place-items:center;border-radius:9px;background:rgba(83,199,139,.09);color:#65d099}.dc-sub-feature-list svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2}.dc-sub-feature-list strong{font-size:9px;line-height:1.35}.dc-secure-chip{display:inline-flex;align-items:center;min-height:24px;padding:0 8px;border:1px solid rgba(114,183,255,.17);border-radius:99px;background:rgba(114,183,255,.07);color:#8bc6ff;font-size:7.5px;font-weight:850}.dc-sub-payment-rows{display:grid;margin-bottom:14px}.dc-sub-payment-rows>div{display:flex;justify-content:space-between;gap:13px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.055)}.dc-sub-payment-rows span{color:var(--dc-muted);font-size:8.5px}.dc-sub-payment-rows b{max-width:58%;font-size:9px;text-align:right}.dc-sub-payment .wide{width:100%}.dc-sub-security,.dc-sub-cancel-note{margin:10px 0 0;color:var(--dc-subtle);font-size:8px;line-height:1.45;text-align:center}.dc-sub-cancel-note{padding:9px;border:1px solid rgba(229,169,87,.16);border-radius:10px;background:rgba(229,169,87,.055);color:#e5b979;text-align:left}
.dc-sub-section{padding:20px;scroll-margin-top:86px}.dc-sub-section-head{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:14px}.dc-sub-section-head>div>span{color:#e8bd76;font-size:8px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.dc-sub-section-head h2{margin:5px 0 3px;font-size:20px}.dc-sub-section-head p{margin:0;color:var(--dc-muted);font-size:9px}.dc-sub-rate{display:inline-flex;min-height:28px;align-items:center;padding:0 10px;border:1px solid rgba(232,189,118,.18);border-radius:99px;background:rgba(232,189,118,.06);color:#e8bd76;font-size:8px;white-space:nowrap}.dc-sub-topup-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}.dc-sub-topup{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-rows:1fr auto;gap:10px 14px;padding:14px;border:1px solid rgba(255,255,255,.065);border-radius:17px;background:rgba(0,0,0,.19)}.dc-sub-topup.featured{border-color:rgba(232,189,118,.27);background:radial-gradient(circle at 100% 0,rgba(232,189,118,.1),transparent 40%),rgba(0,0,0,.2)}.dc-sub-topup>div:first-child span,.dc-sub-topup>div:first-child strong,.dc-sub-topup>div:first-child small{display:block}.dc-sub-topup>div:first-child span{color:#e8bd76;font-size:7px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.dc-sub-topup>div:first-child strong{margin-top:4px;font-size:13px}.dc-sub-topup>div:first-child small{margin-top:4px;color:var(--dc-muted);font-size:8px;line-height:1.4}.dc-sub-topup-value{text-align:right}.dc-sub-topup-value b,.dc-sub-topup-value em,.dc-sub-topup-value strong{display:block}.dc-sub-topup-value b{font-size:26px;letter-spacing:-.055em}.dc-sub-topup-value em{color:var(--dc-subtle);font-size:7px;font-style:normal}.dc-sub-topup-value strong{margin-top:5px;color:#e8bd76;font-size:9px}.dc-sub-topup .dc-btn{grid-column:1/-1;width:100%;min-height:34px;font-size:8px}.dc-sub-activity{padding:20px}.dc-sub-event-list{display:grid}.dc-sub-event{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.055)}.dc-sub-event:last-child{border-bottom:0}.dc-sub-event-icon{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(232,189,118,.09);color:#e8bd76;font-size:15px;font-weight:700}.dc-sub-event-icon.added{background:rgba(83,199,139,.09);color:#69d39c}.dc-sub-event>div strong,.dc-sub-event>div small{display:block}.dc-sub-event>div strong{font-size:9.5px}.dc-sub-event>div small{margin-top:3px;color:var(--dc-subtle);font-size:8px}.dc-sub-event>b{color:#e8bd76;font-size:11px}.dc-sub-event>b.added{color:#69d39c}.dc-sub-empty{display:grid;place-items:center;padding:28px;text-align:center}.dc-sub-empty>span{width:48px;height:48px;display:grid;place-items:center;border:1px solid rgba(232,189,118,.15);border-radius:16px;background:rgba(232,189,118,.06);color:#e8bd76}.dc-sub-empty svg{width:23px;height:23px;fill:none;stroke:currentColor;stroke-width:1.7}.dc-sub-empty strong{margin-top:11px;font-size:11px}.dc-sub-empty p{max-width:420px;margin:4px 0 0;color:var(--dc-muted);font-size:8.5px;line-height:1.5}
@media(max-width:1200px){.dc-sub-main-grid{grid-template-columns:1fr 1fr}.dc-sub-payment{grid-column:1/-1}.dc-sub-payment-rows{grid-template-columns:1fr 1fr;column-gap:22px}}
@media(max-width:840px){.dc-sub-hero{grid-template-columns:1fr}.dc-sub-hero-balance{width:100%}.dc-sub-main-grid,.dc-sub-topup-grid{grid-template-columns:1fr}.dc-sub-payment{grid-column:auto}.dc-sub-payment-rows{grid-template-columns:1fr}.dc-sub-section-head{align-items:flex-start;flex-direction:column}}
@media(max-width:520px){.dc-sub-hero{padding:22px;border-radius:22px}.dc-sub-hero h1{font-size:34px}.dc-sub-token-grid{grid-template-columns:1fr 1fr}.dc-sub-actions{flex-direction:column}.dc-sub-card,.dc-sub-section{padding:15px;border-radius:19px}.dc-sub-card-head{align-items:flex-start;flex-direction:column}.dc-sub-topup{grid-template-columns:1fr}.dc-sub-topup-value{text-align:left}}

/* Browser notifications and workflow sounds */
.dc-alert-settings{grid-column:1/-1;position:relative;overflow:hidden;background:radial-gradient(circle at 100% 0,rgba(142,185,255,.11),transparent 36%),linear-gradient(145deg,#151519,#0d0d10)}.dc-alert-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:14px}.dc-alert-head p{margin-bottom:0}.dc-alert-status{display:inline-flex;align-items:center;gap:7px;min-height:29px;padding:0 10px;border:1px solid rgba(255,255,255,.08);border-radius:999px;color:var(--dc-muted);background:rgba(0,0,0,.2);font-size:8px;font-weight:850;white-space:nowrap}.dc-alert-status i{width:7px;height:7px;border-radius:50%;background:var(--dc-orange);box-shadow:0 0 10px currentColor}.dc-alert-status.good{color:var(--dc-green)}.dc-alert-status.bad{color:var(--dc-red)}.dc-alert-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dc-alert-card{padding:14px;border:1px solid rgba(255,255,255,.065);border-radius:17px;background:rgba(0,0,0,.22)}.dc-alert-card-head{display:flex;align-items:center;gap:10px;margin-bottom:11px}.dc-alert-card-head>span{width:38px;height:38px;display:grid;place-items:center;border-radius:12px;background:rgba(142,185,255,.1);color:#9bc4ff}.dc-alert-card-head svg{width:19px;height:19px}.dc-alert-card-head strong,.dc-alert-card-head small{display:block}.dc-alert-card-head strong{font-size:11px}.dc-alert-card-head small{margin-top:3px;color:var(--dc-muted);font-size:8.5px;line-height:1.4}.dc-alert-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:11px}.dc-alert-actions .dc-btn{min-height:34px;padding:0 11px;font-size:8.5px}.dc-alert-options{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-alert-options .dc-switch-row{min-height:58px;padding:9px}.dc-alert-options .dc-switch-row strong{font-size:9.5px}.dc-alert-options .dc-switch-row span span{font-size:7.7px}.dc-volume-row{display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:10px;align-items:center;margin-top:10px}.dc-volume-row input{width:100%;accent-color:var(--dc-accent)}.dc-volume-row output{height:30px;display:grid;place-items:center;border:1px solid var(--dc-line);border-radius:9px;background:#0b0b0d;color:var(--dc-accent2);font-size:8.5px}.dc-browser-note{margin-top:10px;padding:9px 10px;border:1px solid rgba(255,255,255,.055);border-radius:11px;background:rgba(255,255,255,.025);color:var(--dc-subtle);font-size:7.8px;line-height:1.5}
@media(max-width:820px){.dc-alert-grid,.dc-alert-options{grid-template-columns:1fr}.dc-alert-head{align-items:flex-start;flex-direction:column}}

/* Publishing v4 control-room layer */
.dc-publish-board-top{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.065);background:linear-gradient(90deg,rgba(112,215,162,.055),transparent 44%)}.dc-publish-live{display:flex;align-items:center;gap:10px}.dc-publish-live>span{width:34px;height:34px;display:grid;place-items:center;border-radius:11px;background:rgba(112,215,162,.09);color:#70d7a2}.dc-publish-live svg{width:18px;height:18px}.dc-publish-live strong,.dc-publish-live small{display:block}.dc-publish-live strong{font-size:10px}.dc-publish-live small{margin-top:2px;color:var(--dc-subtle);font-size:8px}.dc-publish-board-tools{display:flex;align-items:center;gap:7px}.dc-publish-board-tools .dc-btn{min-height:34px;padding:0 11px;font-size:8.5px}.dc-publish-health{display:inline-flex;align-items:center;gap:7px;min-height:29px;padding:0 10px;border:1px solid rgba(255,255,255,.07);border-radius:999px;background:rgba(0,0,0,.2);color:var(--dc-muted);font-size:8px}.dc-publish-health i{width:6px;height:6px;border-radius:50%;background:var(--dc-orange);box-shadow:0 0 9px currentColor}.dc-publish-health.ready i{background:#70d7a2}.dc-publish-meta{display:flex!important;align-items:center;gap:6px!important;margin-top:7px!important}.dc-publish-meta i{display:inline-flex;align-items:center;min-height:20px;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.045);color:var(--dc-muted);font-size:7px;font-style:normal}.dc-publish-meta i.score{background:rgba(112,215,162,.08);color:#8ce8b9}.dc-publish-meta i.attention{background:rgba(237,183,99,.09);color:#edb763}.dc-publish-row{position:relative}.dc-publish-row:before{content:'';position:absolute;left:0;top:18px;bottom:18px;width:2px;border-radius:99px;background:transparent}.dc-publish-row:hover:before{background:var(--dc-accent)}.dc-publish-hero>div:first-child{min-width:0}.dc-publish-summary{flex:0 0 246px;display:grid;grid-template-columns:repeat(3,1fr);flex-wrap:nowrap}.dc-publish-summary span{min-width:0}.dc-publish-empty .dc-empty-icon{width:58px;height:58px;display:grid;place-items:center;margin:0 auto 14px;border:1px solid rgba(112,215,162,.14);border-radius:18px;background:rgba(112,215,162,.06);color:#70d7a2}.dc-publish-empty .dc-empty-icon svg{width:27px;height:27px}
.dc-publish-connection-action{min-height:27px;padding:0 9px;border:1px solid rgba(255,255,255,.09);border-radius:8px;color:var(--dc-text);font-size:7.5px;font-weight:760}.dc-publish-connection-action:hover{border-color:rgba(102,213,255,.32);background:rgba(102,213,255,.06)}.dc-publish-connection-status{display:flex!important;align-items:center;gap:5px!important;margin-top:3px!important}.dc-publish-connection-status i{width:5px;height:5px;border-radius:50%;background:var(--dc-orange)}.dc-publish-connection-status i.on{background:#70d7a2;box-shadow:0 0 8px rgba(112,215,162,.42)}.dc-publish-preview-platform{position:absolute;z-index:2;right:7px;top:7px;width:25px;height:25px;display:grid;place-items:center;border:1px solid rgba(255,255,255,.12);border-radius:8px;background:rgba(5,5,6,.76);color:#fff}.dc-publish-preview-platform svg{width:13px;height:13px}.dc-publish-next{padding:16px;background:radial-gradient(circle at 90% 0,rgba(112,215,162,.1),transparent 43%),linear-gradient(145deg,#15171a,#0d0d10)}.dc-publish-next-head{display:flex;align-items:center;justify-content:space-between;gap:10px}.dc-publish-next-head>span:first-child{display:flex;align-items:center;gap:7px;color:#86e6b5;font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase}.dc-publish-next-head svg{width:14px;height:14px}.dc-publish-next-body{margin-top:13px;padding:13px;border:1px solid rgba(255,255,255,.065);border-radius:15px;background:rgba(0,0,0,.22)}.dc-publish-next-body strong,.dc-publish-next-body span{display:block}.dc-publish-next-body strong{font-size:11px;line-height:1.4}.dc-publish-next-body span{margin-top:5px;color:var(--dc-subtle);font-size:8px}.dc-publish-next-actions{display:flex;gap:7px;margin-top:11px}.dc-publish-next-actions .dc-btn{flex:1;min-height:34px;padding:0 9px;font-size:8px}.dc-publish-hero-actions{position:relative;z-index:1;display:flex;align-items:center;gap:8px;margin-top:13px}.dc-publish-hero-actions .dc-btn{min-height:36px;padding:0 13px;font-size:8.5px}.dc-publish-summary span.ready b{color:#8ce8b9}.dc-publish-summary span.scheduled b{color:#8eb9ff}.dc-publish-summary span.posted b{color:#d9b478}
.dc-publish-access{display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:14px;padding:15px 17px;border:1px solid rgba(217,180,120,.26);border-radius:18px;background:linear-gradient(110deg,rgba(217,180,120,.12),rgba(217,180,120,.035));box-shadow:0 18px 48px rgba(0,0,0,.18)}.dc-publish-access>span{width:42px;height:42px;display:grid;place-items:center;border-radius:13px;background:rgba(217,180,120,.13);color:var(--dc-accent2)}.dc-publish-access svg{width:21px;height:21px}.dc-publish-access strong{display:block;font-size:12px}.dc-publish-access p{margin:4px 0 0;color:var(--dc-muted);font-size:9px;line-height:1.45}.dc-publish-access .dc-btn{min-width:126px}
body.dc-app .dc-billing-card{width:min(1320px,calc(100vw - 30px));max-height:calc(100dvh - 24px);overflow-y:auto}body.dc-app .dc-plan-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));width:auto;margin:0;padding:0 30px 18px;gap:12px}body.dc-app .dc-plan-card{min-width:0;min-height:418px}body.dc-app .dc-plan-content{min-height:418px;padding:19px}.dc-plan-card.featured .dc-plan-content{min-height:379px}body.dc-app .dc-plan-card p{min-height:48px}body.dc-app .dc-plan-features{gap:8px}.dc-plan-features span{align-items:flex-start}
@media(max-width:1120px){body.dc-app .dc-plan-grid{grid-template-columns:repeat(2,minmax(0,1fr))}body.dc-app .dc-plan-card,body.dc-app .dc-plan-content{min-height:0}.dc-plan-card.featured .dc-plan-content{min-height:0}}
@media(max-width:1050px){.dc-brand-layout{grid-template-columns:1fr}.dc-brand-preview-card{min-height:520px}.dc-product-hero{grid-template-columns:1fr}.dc-premium-orb{width:100%;min-height:110px;grid-template-columns:48px auto;column-gap:12px;text-align:left}.dc-premium-orb>span{grid-row:1/3}.dc-product-stats{width:100%;grid-template-columns:repeat(4,1fr)}}
@media(max-width:760px){.dc-feature-ribbon,.dc-lab-grid,.dc-lab-lineup{grid-template-columns:1fr}.dc-lab-panel.wide{grid-column:auto}.dc-product-stats{grid-template-columns:1fr 1fr}.dc-brand-form{grid-template-columns:1fr}.dc-brand-form .wide{grid-column:auto}.dc-brand-entitlement{grid-template-columns:38px 1fr}.dc-brand-entitlement .dc-btn{grid-column:1/-1}.dc-lab-hooks article{grid-template-columns:38px 1fr}.dc-lab-hooks article .dc-btn{grid-column:1/-1}.dc-feature-ribbon article{grid-template-columns:34px 1fr}.dc-publish-board-top{align-items:flex-start;flex-direction:column}.dc-publish-board-tools{width:100%;justify-content:space-between}.dc-publish-hero-actions{flex-wrap:wrap}}
@media(max-width:520px){.dc-product-hero{padding:22px;border-radius:22px}.dc-product-hero h1{font-size:34px}.dc-brand-controls{padding:14px}.dc-brand-preview-card{min-height:480px;padding:15px}.dc-brand-phone{width:220px}.dc-product-stats{grid-template-columns:1fr 1fr}.dc-lab-locked{padding:28px 18px}.dc-lab-locked h2{font-size:27px}}
@media(max-width:680px){body.dc-app .dc-plan-grid{grid-template-columns:1fr;padding-left:16px!important;padding-right:16px!important}.dc-publish-access{grid-template-columns:38px 1fr}.dc-publish-access .dc-btn{grid-column:1/-1;width:100%}}
`;
try{const s=document.createElement('style');s.textContent=DC_ADMIN_CSS+DC_PRODUCT_CSS;document.head.append(s);}catch{}

function boot(){injectShell();setTimeout(()=>{go('home');try{if(!seenGet('guided_demo','complete')){const start=()=>{if($('#app')&&!$('#app').classList.contains('hide')&&$('#view-home'))openGuidedTour(0);else setTimeout(start,400)};setTimeout(start,700)}}catch{}},80);setInterval(sync,900)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
