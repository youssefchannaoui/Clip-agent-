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
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
};
const notify = (message, kind='good') => {
  if (typeof toast === 'function') return toast(message, kind);
  console[kind === 'bad' ? 'error' : 'log'](message);
};

const ICON = {
  home:'<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3Z"/></svg>',
  projects:'<svg viewBox="0 0 24 24"><path d="M3.5 6.5h6l1.8 2h9.2v11H3.5Z"/></svg>',
  review:'<svg viewBox="0 0 24 24"><path d="M5 4h14v16H5Z"/><path d="m8 12 2.2 2.2L16 8.5"/></svg>',
  editor:'<svg viewBox="0 0 24 24"><path d="m4 16.5 9-9 3.5 3.5-9 9H4Z"/><path d="m15 6 1.5-1.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L18 9"/></svg>',
  publish:'<svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 20h16"/></svg>',
  analytics:'<svg viewBox="0 0 24 24"><path d="M4 20V11m5 9V4m6 16v-7m5 7H2"/></svg>',
  social:'<svg viewBox="0 0 24 24"><circle cx="7" cy="12" r="3"/><circle cx="17" cy="6" r="3"/><circle cx="17" cy="18" r="3"/><path d="m9.5 10.5 5-3m-5 6 5 3"/></svg>',
  music:'<svg viewBox="0 0 24 24"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  settings:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3v-.2h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></svg>',
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
  scissors:'<svg viewBox="0 0 24 24"><circle cx="6" cy="7" r="3"/><circle cx="6" cy="17" r="3"/><path d="M8.7 8.7 20 20M8.7 15.3 20 4"/></svg>',
  youtube:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.5 31.5 0 0 0 0 12a31.5 31.5 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.5 31.5 0 0 0 24 12a31.5 31.5 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z"/></svg>',
  tiktok:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.7 2c.4 3.2 2.2 5.1 5.3 5.3v3.6c-1.8.2-3.5-.4-5.2-1.5v6.8c0 8.6-9.4 11.3-13.2 5.1-2.5-4.1-1-11.3 7-11.6v3.8c-.6.1-1.2.2-1.7.4-1.6.5-2.5 2-2.2 3.7.6 3.2 6.3 4.1 5.8-2.1V2h4.2Z"/></svg>',
  instagram:'<svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none"/></svg>',
  facebook:'<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8.5V6.8c0-.8.3-1.3 1.4-1.3H18V2.2c-.5-.1-2.1-.2-3.3-.2-3.2 0-5.2 1.9-5.2 5.3v1.2H6v3.7h3.5V22H14v-9.8h3.5l.6-3.7H14Z"/></svg>',
};

const CREATE_NAV = [
  ['home','Home','home'], ['projects','Projects','projects'], ['review','Clip Review','review'], ['editor','Editor','editor']
];
const PUBLISH_NAV = [
  ['schedule','Schedule','publish'], ['publishing','Platforms','social']
];
const STUDIO_NAV = [
  ['templates','Templates','style'], ['music','Nasheeds','music'], ['insights','Insights','analytics'], ['automation','Settings','settings']
];
const NAV = [...CREATE_NAV, ...PUBLISH_NAV, ...STUDIO_NAV];
const MANAGE = [];
const CUSTOM = new Set(['home','projects','review','editor','publishing','templates','music','automation','insights']);

let currentView = 'home';
let selectedProjectId = '';
let selectedClipId = '';
let projectQuery = '';
let projectFilter = 'all';
let projectSort = 'newest';
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
#dcWork{position:fixed;right:16px;bottom:16px;z-index:300;display:none;align-items:center;gap:9px;min-width:260px;max-width:380px;padding:10px 12px;border:1px solid var(--dc-line2);border-radius:9px;background:#111113ee;box-shadow:var(--dc-shadow);backdrop-filter:blur(12px)}#dcWork.show{display:flex}#dcWork strong,#dcWork span{display:block}#dcWork strong{font-size:10px}#dcWork span{font-size:8px;color:var(--dc-muted);margin-top:2px}#dcShade{display:none;position:fixed;inset:0;z-index:185;background:#0009}
@keyframes dcSpin{to{transform:rotate(360deg)}}@keyframes dcPulse{50%{opacity:.35}}
@media(max-width:1250px){:root{--dc-side:208px}.dc-create-grid{grid-template-columns:minmax(220px,1fr) 150px 110px 135px}.dc-create-grid .dc-btn{grid-column:1/-1}.dc-home-grid{grid-template-columns:1fr}.dc-editor-workspace{grid-template-columns:58px 260px minmax(350px,1fr)}}
@media(max-width:980px){:root{--dc-side:72px}body:not(.dc-side-expanded) .dc-brand-copy,body:not(.dc-side-expanded) .dc-nav-label,body:not(.dc-side-expanded) .dc-nav-name,body:not(.dc-side-expanded) .dc-collapse span{display:none}body:not(.dc-side-expanded) #dcBrand,body:not(.dc-side-expanded) .dc-nav-button,body:not(.dc-side-expanded) .dc-collapse{justify-content:center;padding-left:0;padding-right:0}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-create-grid{grid-template-columns:1fr 1fr}.dc-create-grid input{grid-column:1/-1}.dc-project-grid{grid-template-columns:repeat(auto-fit,minmax(255px,1fr))}.dc-editor-page{height:auto;min-height:0}.dc-editor-workspace{height:auto;grid-template-columns:58px minmax(260px,1fr);grid-template-rows:360px minmax(520px,auto) 174px}.dc-tool-rail{grid-row:1/4}.dc-tool-panel{grid-column:2;grid-row:1;max-height:360px;border-right:0;border-bottom:1px solid var(--dc-line)}.dc-canvas-area{grid-column:2;grid-row:2;min-height:520px}.dc-timeline{grid-column:2;grid-row:3}.dc-tool-content{max-height:310px}.dc-video-canvas{height:min(55vh,520px)}}
@media(max-width:720px){:root{--dc-side:0px;--dc-top:58px}body.dc-app #app>.wrap{padding:calc(var(--dc-top) + env(safe-area-inset-top) + 12px) 10px calc(82px + env(safe-area-inset-bottom))!important}#dcSidebar{width:min(280px,86vw);transform:translateX(-102%);padding-top:env(safe-area-inset-top);box-shadow:var(--dc-shadow)}body.dc-menu-open #dcSidebar{transform:translateX(0)}body.dc-menu-open #dcShade{display:block}#dcTopbar{left:0;top:env(safe-area-inset-top);height:58px;padding:0 10px}.dc-mobile-menu{display:grid;place-items:center}.dc-page-title{min-width:0;flex:1}.dc-page-title span,.dc-global-search,.dc-health{display:none}.dc-top-actions .dc-btn{padding:0 10px}.dc-create-card{padding:16px}.dc-create-card h2{font-size:19px}.dc-create-grid,.dc-filterbar,.dc-social-grid{grid-template-columns:1fr}.dc-create-grid input{grid-column:auto}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-page-head h1{font-size:21px}.dc-project-grid,.dc-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.dc-project-cover{height:110px}.dc-project-actions,.dc-clip-actions{grid-template-columns:1fr}.dc-editor-header{position:sticky;top:calc(58px + env(safe-area-inset-top));z-index:10}.dc-editor-workspace{grid-template-columns:1fr;grid-template-rows:58px auto minmax(470px,auto) 174px}.dc-tool-rail{grid-column:1;grid-row:1;flex-direction:row;overflow:auto;border-right:0;border-bottom:1px solid var(--dc-line);padding:4px}.dc-tool-button{min-width:58px;height:49px;min-height:49px}.dc-tool-panel{grid-column:1;grid-row:2;max-height:none}.dc-tool-content{max-height:none}.dc-canvas-area{grid-column:1;grid-row:3;min-height:470px}.dc-timeline{grid-column:1;grid-row:4}.dc-video-canvas{height:min(54dvh,490px)}.dc-style-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:460px){.dc-project-grid,.dc-clip-grid{grid-template-columns:1fr}.dc-home-metrics{grid-template-columns:1fr 1fr}.dc-page-title strong{font-size:12px}.dc-top-actions .dc-btn span{display:none}.dc-caption-overlay{font-size:22px}.dc-editor-header .dc-pill{display:none}.dc-style-grid{grid-template-columns:1fr 1fr}}

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

@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.001ms!important;transition-duration:.001ms!important;scroll-behavior:auto!important}}

/* V3 polish pass: premium icons, cleaner sidebar, cards-first home, project cards, clip review queue */
.dc-icon svg,.dc-nav-icon svg,.dc-tool-icon svg,.dc-svg svg{overflow:visible}.dc-nav-button[data-dc-nav="review"] .dc-nav-name::after{content:''}.dc-v3-hero{min-height:310px;padding:28px 28px!important;grid-template-columns:minmax(360px,1.05fr) minmax(320px,.95fr);align-items:center}.dc-v3-kicker svg{width:15px;height:15px}.dc-v3-title{font-size:clamp(28px,3.4vw,42px)!important;line-height:.98!important;max-width:720px}.dc-v3-copy{max-width:680px}.dc-v3-source-row{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.dc-v3-source{position:relative;overflow:hidden;padding:18px 18px 16px!important;min-height:126px;display:grid;grid-template-columns:46px 1fr;grid-template-rows:auto auto;align-content:center;column-gap:14px;text-align:left}.dc-v3-source strong{font-size:14px;align-self:end}.dc-v3-source>span:last-child{grid-column:2;color:var(--dc-muted);font-size:10px;line-height:1.35}.dc-v3-platform{grid-row:1/3;width:46px;height:46px;border-radius:15px;display:grid;place-items:center}.dc-v3-platform svg{width:24px;height:24px}.dc-v3-platform.youtube{background:rgba(255,0,51,.12);color:#ff335f}.dc-v3-platform.template{background:rgba(217,180,120,.14);color:var(--dc-accent2)}.dc-v3-platform.publish{background:rgba(51,203,255,.1);color:#7de4ff}.dc-home-metrics.v3{grid-template-columns:repeat(5,minmax(120px,1fr));gap:10px}.dc-metric{padding:18px!important}.dc-metric strong{font-size:25px!important}.dc-home-dashboard{display:grid;grid-template-columns:minmax(420px,1.25fr) minmax(320px,.85fr);gap:14px;margin-top:14px}.dc-dashboard-card{min-height:0}.dc-dashboard-card .dc-card-head p{display:none}.dc-row-list.compact{display:grid;gap:8px}.dc-row-list.compact .dc-list-row{min-height:56px;padding:10px 12px}.dc-list-copy strong{font-size:11.5px}.dc-list-copy span{font-size:9px}.dc-social-grid.clean{grid-template-columns:1fr 1fr;gap:9px}.dc-social-card.v3{padding:12px;background:linear-gradient(145deg,rgba(255,255,255,.035),rgba(255,255,255,.012));border-color:#32323a}.dc-social-logo{width:34px!important;height:34px!important;border-radius:11px!important;display:grid;place-items:center}.dc-social-logo svg{width:18px;height:18px}.dc-social-logo.youtube{background:rgba(255,0,51,.13);color:#ff335f}.dc-social-logo.tiktok{background:linear-gradient(135deg,rgba(37,244,238,.16),rgba(254,44,85,.12));color:#38f2ec}.dc-social-logo.instagram{background:linear-gradient(135deg,rgba(255,221,87,.18),rgba(214,41,118,.18),rgba(81,91,212,.16));color:#ff7ebe}.dc-social-logo.facebook{background:rgba(24,119,242,.15);color:#71adff}.dc-sidebar-live{padding:9px;margin:10px 0 6px;border-radius:12px;background:#111113;border-color:#2c2c33}.dc-sidebar-live-head{margin-bottom:7px}.dc-sidebar-live-head strong{font-size:10px}.dc-sidebar-live-head span{font-size:7.8px}.dc-mini-job{grid-template-columns:24px minmax(0,1fr);padding:7px;margin-top:6px;border-radius:9px}.dc-mini-job-icon{width:24px;height:24px;border-radius:8px}.dc-mini-job strong{font-size:8.7px}.dc-mini-job span{font-size:7.5px}.dc-sidebar-status-pills{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:7px}.dc-side-pill{padding:7px;border:1px solid var(--dc-line);border-radius:8px;background:#0b0b0d}.dc-side-pill b,.dc-side-pill span{display:block}.dc-side-pill b{font-size:10px}.dc-side-pill span{font-size:7.3px;color:var(--dc-subtle);margin-top:1px}.dc-sidebar-live-foot{grid-template-columns:1fr;margin-top:7px}.dc-sidebar-live-foot .dc-btn{min-height:28px}.dc-project-grid{grid-template-columns:repeat(auto-fit,minmax(310px,1fr));gap:14px}.dc-project-card{border-radius:15px;background:linear-gradient(180deg,#151519,#101013);box-shadow:0 15px 45px rgba(0,0,0,.18)}.dc-project-cover{height:205px;border-bottom:1px solid var(--dc-line);background:radial-gradient(circle at 30% 18%,rgba(217,180,120,.14),transparent 36%),#070708}.dc-project-cover img{filter:none;object-fit:cover;transform:scale(1.01)}.dc-project-cover:empty::after,.dc-project-cover:not(:has(img))::after{content:'Lecture';position:absolute;inset:auto 16px 16px;color:var(--dc-muted);font-size:12px}.dc-project-status{left:12px;right:auto;top:12px}.dc-project-body{padding:15px 15px 16px}.dc-project-body h3{font-size:14px;line-height:1.25;white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;min-height:34px}.dc-project-body p{display:none}.dc-project-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0}.dc-project-stat{padding:9px;border:1px solid var(--dc-line);border-radius:9px;background:#0b0b0d}.dc-project-actions{grid-template-columns:1fr}.dc-project-actions .dc-btn.secondary{min-height:36px}.dc-review-list{display:grid;gap:12px}.dc-review-item{display:grid;grid-template-columns:92px minmax(0,1fr) auto;gap:14px;align-items:center;padding:12px;border:1px solid var(--dc-line);border-radius:14px;background:linear-gradient(145deg,#151519,#101013)}.dc-review-media{position:relative;width:92px;aspect-ratio:9/16;border-radius:10px;overflow:hidden;background:#000}.dc-review-media img{width:100%;height:100%;object-fit:cover}.dc-review-score{position:absolute;left:6px;bottom:6px;min-width:28px;height:24px;border-radius:999px;background:#0a0a0ddd;color:#b9ff69;display:grid;place-items:center;font-weight:900;font-size:10px}.dc-review-copy h3{font-size:14px;margin:0 0 6px;line-height:1.25}.dc-review-copy p{margin:0;color:var(--dc-muted);font-size:10px}.dc-review-actions{display:grid;grid-template-columns:repeat(4,minmax(80px,1fr));gap:8px;min-width:360px}.dc-btn.ghost{background:transparent;border-color:var(--dc-line)}.dc-empty.v3{min-height:170px;display:grid;place-items:center;text-align:center;border:1px dashed #373740;border-radius:14px;background:#101013}.dc-empty.v3 .dc-empty-icon{width:46px;height:46px;margin:0 auto 10px;border-radius:14px;background:rgba(217,180,120,.11);display:grid;place-items:center;color:var(--dc-accent2)}.dc-empty.v3 .dc-empty-icon svg{width:24px;height:24px}.dc-caption-block{height:28px;display:flex;align-items:center;overflow:visible;white-space:nowrap}.dc-timeline-scroll{overflow-x:auto!important}.dc-timeline-scroll::-webkit-scrollbar{height:10px}.dc-timeline-scroll::-webkit-scrollbar-thumb{background:#555;border-radius:99px}.dc-timeline-scroll::-webkit-scrollbar-track{background:#19191e}
@media(max-width:1200px){.dc-home-dashboard{grid-template-columns:1fr}.dc-home-metrics.v3{grid-template-columns:repeat(3,minmax(120px,1fr))}.dc-review-item{grid-template-columns:78px minmax(0,1fr)}.dc-review-actions{grid-column:1/-1;min-width:0}}
@media(max-width:720px){.dc-v3-hero{grid-template-columns:1fr;min-height:0;padding:18px!important}.dc-v3-source-row,.dc-social-grid.clean{grid-template-columns:1fr}.dc-home-metrics.v3{grid-template-columns:1fr 1fr}.dc-review-item{grid-template-columns:72px 1fr}.dc-review-actions{grid-template-columns:1fr 1fr}.dc-project-grid{grid-template-columns:1fr}}

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
.dc-guide-layer{position:fixed;inset:0;z-index:9999;pointer-events:none}.dc-guide-spot{position:fixed;border:2px solid var(--dc-accent);border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.68),0 0 34px rgba(217,180,120,.38);transition:all .22s ease;pointer-events:none}.dc-guide-card{position:fixed;max-width:min(360px,calc(100vw - 28px));padding:16px;border:1px solid rgba(217,180,120,.24);border-radius:18px;background:linear-gradient(180deg,#17171a,#0e0e10);box-shadow:0 24px 70px rgba(0,0,0,.55);pointer-events:auto;transition:left .22s ease,top .22s ease}.dc-guide-card h3{margin:0;font-size:16px;letter-spacing:-.02em}.dc-guide-card p{margin:7px 0 13px;color:var(--dc-muted);font-size:12px;line-height:1.55}.dc-guide-foot{display:flex;align-items:center;gap:8px}.dc-guide-count{margin-right:auto;color:var(--dc-muted);font-size:10px}.dc-guide-foot .dc-btn{min-height:36px;font-size:10px}.dc-guide-missing{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%)}
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

`;


const clipToolsCss = String.raw`
/* Clip Review feature pass: hook detector + post copy generator. Editor CSS untouched. */
.dc-review-page-pro{display:grid;gap:16px}.dc-review-hero-pro{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:22px;border:1px solid rgba(217,180,120,.20);border-radius:24px;background:radial-gradient(circle at 0 0,rgba(217,180,120,.13),transparent 34%),linear-gradient(145deg,#151519,#0d0d10)}.dc-review-hero-pro h1{font-size:32px;line-height:1;margin:8px 0 8px;letter-spacing:-.035em}.dc-review-hero-pro p{margin:0;color:var(--dc-muted);font-size:12px;max-width:620px;line-height:1.5}.dc-review-kicker{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border:1px solid rgba(217,180,120,.22);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}.dc-review-metrics-pro{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-review-metrics-pro span{min-width:92px;padding:10px 12px;border:1px solid var(--dc-line);border-radius:14px;background:#09090b}.dc-review-metrics-pro b,.dc-review-metrics-pro em{display:block}.dc-review-metrics-pro b{font-size:20px}.dc-review-metrics-pro em{font-style:normal;color:var(--dc-muted);font-size:9px;margin-top:2px}.dc-review-list.pro{display:grid;grid-template-columns:repeat(auto-fit,minmax(520px,1fr));gap:14px}.dc-review-item.pro{display:grid;grid-template-columns:118px minmax(0,1fr);gap:14px;align-items:stretch;padding:14px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 20px 50px rgba(0,0,0,.18)}.dc-review-item.pro:hover{border-color:var(--dc-line2)}.dc-review-item.pro .dc-review-media{width:118px;border-radius:16px;box-shadow:0 16px 40px #0007}.dc-review-item.pro .dc-review-score{left:8px;bottom:8px;height:28px;min-width:34px;font-size:11px}.dc-review-main{min-width:0;display:flex;flex-direction:column;gap:10px}.dc-review-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.dc-review-title-row h3{font-size:15px;line-height:1.22;margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.dc-review-title-row small{white-space:nowrap;color:var(--dc-muted);font-size:9px;margin-top:3px}.dc-hook-strip{display:grid;grid-template-columns:minmax(130px,.38fr) minmax(0,1fr);gap:8px}.dc-hook-card,.dc-copy-card{border:1px solid var(--dc-line);border-radius:14px;background:#09090b;padding:10px}.dc-hook-card strong,.dc-copy-card strong{display:flex;align-items:center;gap:7px;font-size:10px}.dc-hook-card p,.dc-copy-card p{margin:6px 0 0;color:var(--dc-muted);font-size:9px;line-height:1.45}.dc-hook-badge{display:inline-flex;align-items:center;gap:6px;min-height:24px;padding:0 8px;border-radius:999px;font-size:9px;font-weight:800}.dc-hook-badge.good{background:rgba(83,199,139,.10);color:var(--dc-green)}.dc-hook-badge.warn{background:rgba(229,169,87,.10);color:var(--dc-orange)}.dc-copy-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}.dc-copy-mini{padding:9px;border:1px solid var(--dc-line);border-radius:12px;background:#0d0d10;min-width:0}.dc-copy-mini b,.dc-copy-mini span{display:block}.dc-copy-mini b{font-size:8.5px;color:var(--dc-accent2);text-transform:uppercase;letter-spacing:.07em}.dc-copy-mini span{font-size:9.5px;color:var(--dc-text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:5px}.dc-review-actions.pro{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;min-width:0}.dc-review-actions.pro .dc-btn{min-width:0;padding:0 8px;font-size:9.5px}.dc-review-actions.pro .wide{grid-column:span 2}.dc-review-empty-pro{min-height:260px;display:grid;place-items:center;padding:30px;border:1px dashed #373740;border-radius:24px;background:radial-gradient(circle at 50% 0,rgba(217,180,120,.10),transparent 42%),#101013;text-align:center}.dc-review-empty-pro .dc-empty-icon{width:58px;height:58px;margin:0 auto 13px;border-radius:20px;background:rgba(217,180,120,.12);display:grid;place-items:center;color:var(--dc-accent2)}.dc-review-empty-pro strong{display:block;font-size:18px}.dc-review-empty-pro p{color:var(--dc-muted);font-size:12px;margin:7px 0 16px}.dc-review-toolbar.pro{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.dc-review-toolbar.pro .spacer{flex:1}@media(max-width:760px){.dc-review-hero-pro{grid-template-columns:1fr}.dc-review-metrics-pro{justify-content:flex-start}.dc-review-list.pro{grid-template-columns:1fr}.dc-review-item.pro{grid-template-columns:94px minmax(0,1fr);padding:11px}.dc-review-item.pro .dc-review-media{width:94px}.dc-hook-strip,.dc-copy-grid{grid-template-columns:1fr}.dc-review-actions.pro{grid-template-columns:1fr 1fr}.dc-review-actions.pro .wide{grid-column:auto}}


/* V3H: premium icons, cleaner sidebar and complete manage tabs */
.dc-nav-icon{border-radius:9px;background:rgba(255,255,255,.035);color:var(--dc-muted);transition:background .18s ease,color .18s ease,transform .18s ease}.dc-nav-button.is-active .dc-nav-icon{background:rgba(217,180,120,.16);box-shadow:0 0 0 1px rgba(217,180,120,.18) inset;color:var(--dc-accent2)}.dc-nav-button:hover .dc-nav-icon{transform:translateY(-1px);background:rgba(255,255,255,.06)}.dc-v3-platform,.dc-social-logo,.dc-mini-job-icon{position:relative;overflow:hidden}.dc-v3-platform::after,.dc-social-logo::after,.dc-mini-job-icon::after{content:'';position:absolute;inset:-40%;background:radial-gradient(circle at 30% 20%,rgba(255,255,255,.20),transparent 38%);pointer-events:none}.dc-v3-platform svg,.dc-social-logo svg,.dc-mini-job-icon svg{position:relative;z-index:1}.dc-v3-platform.youtube,.dc-social-logo.youtube{background:linear-gradient(135deg,rgba(255,0,51,.20),rgba(255,255,255,.045));color:#ff456b}.dc-v3-platform.tiktok,.dc-social-logo.tiktok{background:linear-gradient(135deg,rgba(37,244,238,.18),rgba(254,44,85,.12));color:#4ff5ef}.dc-v3-platform.instagram,.dc-social-logo.instagram{background:linear-gradient(135deg,rgba(252,204,99,.20),rgba(225,48,108,.18),rgba(91,81,216,.16));color:#ff91c4}.dc-v3-platform.facebook,.dc-social-logo.facebook{background:linear-gradient(135deg,rgba(24,119,242,.22),rgba(255,255,255,.045));color:#8bbcff}.dc-sidebar-live{background:radial-gradient(circle at 0 0,rgba(217,180,120,.13),transparent 35%),linear-gradient(180deg,#141418,#0b0b0d)!important;border-color:rgba(217,180,120,.22)!important;box-shadow:0 14px 36px rgba(0,0,0,.24)}.dc-sidebar-live-head{align-items:flex-start}.dc-live-orb{position:relative}.dc-live-orb::after{content:'';position:absolute;inset:-5px;border-radius:50%;border:1px solid currentColor;opacity:.18}.dc-sidebar-status-pills{grid-template-columns:1fr 1fr!important}.dc-side-pill{background:rgba(255,255,255,.035)!important;border-color:rgba(255,255,255,.07)!important}.dc-sidebar-live-foot .dc-btn{border-radius:9px!important}.dc-mini-job{background:rgba(0,0,0,.28)!important;border-color:rgba(255,255,255,.06)!important}.dc-manage-page{display:grid;gap:16px}.dc-manage-hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:22px;border:1px solid rgba(217,180,120,.20);border-radius:24px;background:radial-gradient(circle at 4% 0,rgba(217,180,120,.14),transparent 35%),linear-gradient(145deg,#151519,#0d0d10);overflow:hidden}.dc-manage-hero h1{font-size:32px;line-height:1;margin:8px 0 8px;letter-spacing:-.04em}.dc-manage-hero p{margin:0;color:var(--dc-muted);font-size:12px;max-width:650px;line-height:1.55}.dc-manage-kicker{display:inline-flex;align-items:center;gap:8px;min-height:28px;padding:0 10px;border:1px solid rgba(217,180,120,.22);border-radius:999px;background:rgba(217,180,120,.07);color:var(--dc-accent2);font-size:9px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.dc-manage-metrics{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-manage-metrics span{min-width:98px;padding:10px 12px;border:1px solid var(--dc-line);border-radius:14px;background:#09090b}.dc-manage-metrics b,.dc-manage-metrics em{display:block}.dc-manage-metrics b{font-size:20px}.dc-manage-metrics em{font-style:normal;color:var(--dc-muted);font-size:9px;margin-top:2px}.dc-manage-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:14px}.dc-manage-card{position:relative;overflow:hidden;padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 18px 45px rgba(0,0,0,.18)}.dc-manage-card::after{content:'';position:absolute;right:-48px;bottom:-60px;width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.035);pointer-events:none}.dc-manage-card-top{position:relative;z-index:1;display:flex;align-items:flex-start;gap:12px}.dc-manage-logo{width:48px;height:48px;flex:0 0 48px;border-radius:16px;display:grid;place-items:center}.dc-manage-logo svg{width:24px;height:24px;fill:currentColor}.dc-manage-copy{min-width:0;flex:1}.dc-manage-copy strong,.dc-manage-copy span{display:block}.dc-manage-copy strong{font-size:15px}.dc-manage-copy span{color:var(--dc-muted);font-size:10px;line-height:1.45;margin-top:4px}.dc-manage-actions{position:relative;z-index:1;display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:14px}.dc-manage-actions .dc-btn{min-width:0;padding:0 9px}.dc-manage-list{position:relative;z-index:1;margin-top:12px;display:grid;gap:7px}.dc-manage-row{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:12px;background:rgba(0,0,0,.22)}.dc-manage-row strong,.dc-manage-row span{display:block}.dc-manage-row strong{font-size:10.5px}.dc-manage-row span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-manage-row audio{width:100%;height:32px}.dc-settings-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,.7fr);gap:14px}.dc-settings-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-settings-panel h2{font-size:16px;margin:0 0 4px}.dc-settings-panel p{font-size:10px;color:var(--dc-muted);margin:0 0 14px;line-height:1.5}.dc-settings-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dc-settings-form label{display:grid;gap:6px;color:var(--dc-muted);font-size:9px}.dc-settings-form input,.dc-settings-form select{width:100%;height:40px;padding:0 10px;border:1px solid var(--dc-line);border-radius:11px;background:#0b0b0d;color:var(--dc-text)}.dc-settings-form .wide{grid-column:1/-1}.dc-switch-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(0,0,0,.22)}.dc-switch-row strong,.dc-switch-row span{display:block}.dc-switch-row strong{font-size:11px}.dc-switch-row span{font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-switch-row input{width:18px;height:18px}.dc-upload-zone{display:grid;gap:8px;padding:14px;border:1px dashed rgba(217,180,120,.28);border-radius:16px;background:rgba(217,180,120,.045)}.dc-upload-zone input{height:auto;padding:10px}.dc-home-quick .dc-v3-source{border-color:rgba(255,255,255,.08);background:radial-gradient(circle at 100% 0,rgba(255,255,255,.045),transparent 38%),linear-gradient(145deg,#151519,#0d0d10)}.dc-home-quick .dc-v3-source:hover{border-color:rgba(217,180,120,.38);box-shadow:0 16px 42px rgba(0,0,0,.25)}
.dc-nav-group{margin-bottom:8px}.dc-nav-label{display:flex;align-items:center;gap:8px;padding:13px 10px 7px}.dc-nav-label span{white-space:nowrap}.dc-nav-label i{height:1px;flex:1;background:linear-gradient(90deg,var(--dc-line),transparent)}body.dc-side-collapsed .dc-nav-label i{display:none}.dc-sidebar-live{margin:12px 0 10px!important}.dc-sidebar-live-head{display:flex;align-items:center;justify-content:space-between}.dc-live-orb{width:9px;height:9px;border-radius:50%;background:var(--dc-green);box-shadow:0 0 0 5px rgba(83,199,139,.08)}.dc-live-orb.busy{background:var(--dc-accent);box-shadow:0 0 0 5px rgba(217,180,120,.10);animation:dcPulse 1s infinite}.dc-sidebar-live-foot{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px}.dc-sidebar-live-foot .dc-btn{min-height:30px;font-size:8px;padding:0 6px}.dc-studio-hero{position:relative;overflow:hidden;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:18px;align-items:end;padding:24px;border:1px solid rgba(217,180,120,.20);border-radius:26px;background:radial-gradient(circle at 6% 0,rgba(217,180,120,.16),transparent 34%),radial-gradient(circle at 90% 20%,rgba(85,183,255,.10),transparent 30%),linear-gradient(145deg,#151519,#0d0d10)}.dc-studio-hero h1{font-size:34px;line-height:.98;letter-spacing:-.045em;margin:8px 0 7px}.dc-studio-hero p{max-width:650px;margin:0;color:var(--dc-muted);font-size:12px;line-height:1.55}.dc-studio-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-studio-strip{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:10px}.dc-studio-stat{padding:13px;border:1px solid var(--dc-line);border-radius:17px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-studio-stat strong,.dc-studio-stat span{display:block}.dc-studio-stat strong{font-size:21px}.dc-studio-stat span{font-size:9px;color:var(--dc-muted);margin-top:3px}.dc-template-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:14px}.dc-template-card{overflow:hidden;border:1px solid var(--dc-line);border-radius:23px;background:linear-gradient(145deg,#151519,#0d0d10);box-shadow:0 18px 45px rgba(0,0,0,.18)}.dc-template-preview{height:150px;position:relative;background:linear-gradient(135deg,#111,#222 45%,#09090b);display:grid;place-items:center}.dc-template-preview::before{content:'';position:absolute;inset:18px 42px;border-radius:18px;background:linear-gradient(180deg,#2d2d35,#0e0e10);border:1px solid rgba(255,255,255,.08)}.dc-template-caption{position:relative;text-align:center;font-size:20px;font-weight:900;line-height:1;color:#fff;text-shadow:0 2px 8px #000;-webkit-text-stroke:1px #000}.dc-template-card-body{padding:14px}.dc-template-card-body h3{font-size:14px;margin:0}.dc-template-card-body p{font-size:9px;color:var(--dc-muted);line-height:1.45;margin:5px 0 12px}.dc-template-actions{display:grid;grid-template-columns:1fr 1fr;gap:7px}.dc-template-actions .dc-btn{min-width:0;padding:0 8px;font-size:9px}.dc-insight-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(300px,.9fr);gap:14px}.dc-insight-panel{padding:16px;border:1px solid var(--dc-line);border-radius:22px;background:linear-gradient(145deg,#151519,#0d0d10)}.dc-insight-panel h2{font-size:16px;margin:0 0 10px}.dc-quality-row{display:grid;grid-template-columns:110px 1fr 48px;gap:10px;align-items:center;margin:10px 0}.dc-quality-row span,.dc-quality-row b{font-size:9px;color:var(--dc-muted)}.dc-quality-row b{color:var(--dc-text);text-align:right}.dc-quality-bar{height:9px;border-radius:999px;background:#25252a;overflow:hidden}.dc-quality-bar i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2))}.dc-studio-roadmap{display:grid;gap:8px}.dc-road-step{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(0,0,0,.22)}.dc-road-step span{width:30px;height:30px;border-radius:11px;display:grid;place-items:center;background:rgba(217,180,120,.10);color:var(--dc-accent2)}.dc-road-step strong,.dc-road-step em{display:block}.dc-road-step strong{font-size:10.5px}.dc-road-step em{font-style:normal;font-size:8.5px;color:var(--dc-muted);margin-top:2px}.dc-manage-hero{border-radius:26px!important}.dc-manage-kicker svg{width:15px;height:15px}@media(max-width:900px){.dc-studio-hero,.dc-insight-grid{grid-template-columns:1fr}.dc-studio-actions{justify-content:flex-start}.dc-template-actions{grid-template-columns:1fr}}
@media(max-width:900px){.dc-manage-hero,.dc-settings-grid{grid-template-columns:1fr}.dc-manage-metrics{justify-content:flex-start}.dc-manage-actions{grid-template-columns:1fr}.dc-settings-form{grid-template-columns:1fr}.dc-settings-form .wide{grid-column:auto}}
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
`;

function injectShell(){
  if (shellReady) return;
  shellReady = true;
  const style = document.createElement('style');
  style.id = 'dcPhase4Styles'; style.textContent = css + v3Css + v3ProjectCss + clipToolsCss + scheduleKeepCss; document.head.appendChild(style);
  document.body.classList.add('dc-app');

  const side = document.createElement('aside'); side.id = 'dcSidebar';
  side.innerHTML = `<div id="dcBrand"><div class="dc-logo"><svg viewBox="0 0 24 26" fill="none"><path d="M3.2 25V11.4C3.2 6.6 12 1 12 1s8.8 5.6 8.8 10.4V25Z" stroke="currentColor" stroke-width="1.7"/><path d="M10 11.2 15.4 14.6 10 18Z" fill="currentColor"/></svg></div><div class="dc-brand-copy"><strong>DeenClipped</strong><span>AI clip workspace</span></div></div><div class="dc-nav-scroll"><div class="dc-nav-group"><div class="dc-nav-label"><span>Create</span><i></i></div>${CREATE_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-nav-group"><div class="dc-nav-label"><span>Publish</span><i></i></div>${PUBLISH_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-sidebar-live" id="dcSidebarLive"></div><div class="dc-nav-group"><div class="dc-nav-label"><span>Studio</span><i></i></div>${STUDIO_NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}</div></div><div class="dc-sidebar-bottom"><button class="dc-collapse" id="dcCollapse"><span class="dc-nav-icon">${ICON.collapse}</span><span>Collapse sidebar</span></button></div>`;

  const top = document.createElement('header'); top.id = 'dcTopbar';
  top.innerHTML = `<button class="dc-mobile-menu dc-svg" id="dcMobileMenu" type="button" aria-label="Open menu">${ICON.menu}</button><div class="dc-page-title"><strong id="dcPageName">Home</strong><span id="dcPageSub">Everything important in one place</span></div><div class="dc-global-search">${ICON.search}<input id="dcGlobalSearch" placeholder="Search projects and clips"><div class="dc-search-results" id="dcSearchResults"></div></div><div class="dc-top-actions"><div class="dc-health" id="dcHealth"><i></i><span>Checking</span></div><button class="dc-btn secondary dc-tour-launch" id="dcTourLaunch" type="button">Guided demo</button><button class="dc-btn" id="dcNewProject"><span>＋ New project</span></button></div>`;

  const work = document.createElement('div'); work.id = 'dcWork';
  work.innerHTML = `<span class="dc-spinner"></span><div><strong>Working…</strong><span>Saving changes</span></div>`;
  const shade = document.createElement('button'); shade.id = 'dcShade'; shade.type='button'; shade.setAttribute('aria-label','Close menu');
  document.body.append(side, top, shade, work);

  const main = $('.main-col');
  if (main) {
    for (const name of ['home','projects','review','editor','publishing','templates','music','automation','insights']) {
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
  $('#dcGlobalSearch').addEventListener('input', renderGlobalSearch);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') { document.body.classList.remove('dc-menu-open'); $('#dcSearchResults')?.classList.remove('show'); }
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '');
    if (!typing && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redoEditor() : undoEditor(); }
    if (!typing && event.code === 'Space' && currentView === 'editor') { event.preventDefault(); togglePlayback(); }
  });
  window.addEventListener('deen:api-start', onApiStart);
  window.addEventListener('deen:api-end', onApiEnd);
}

function handleClick(event){
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
  if (project) { selectedProjectId = project.dataset.openProject; go('projects'); return; }
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
  const discard = event.target.closest('[data-delete-clip]'); if (discard) { deleteClip(discard.dataset.deleteClip); return; }
  const retry = event.target.closest('[data-retry-project]'); if (retry) { retryProject(retry.dataset.retryProject); return; }
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
  requestMap.set(item.id, item); paintWork();
}
function onApiEnd(event){
  const item = event.detail || {}; const method = String(item.method || 'GET').toUpperCase();
  if (method === 'GET') return;
  requestMap.delete(item.id); paintWork(); lastWriteAt = Date.now();
}
function paintWork(){
  const el = $('#dcWork'); if (!el) return;
  const item = [...requestMap.values()].at(-1); el.classList.toggle('show', Boolean(item));
  if (!item) return;
  const url = String(item.url || '');
  $('strong', el).textContent = /rerender/.test(url) ? 'Rendering edited clip' : /publish/.test(url) ? 'Starting publishing' : /videos/.test(url) ? 'Adding lecture' : 'Saving changes';
  $('span:last-child', el).textContent = url;
}

function go(view){
  if(view!=='projects')document.body.classList.remove('dc-project-open');
  currentView = view;
  $$('[data-dc-nav]').forEach(b => b.classList.toggle('is-active', b.dataset.dcNav === view));
  const labels = {
    home:['Home','Everything important in one place'], projects:['Projects','Lectures and all generated clips'],
    review:['Clip Review','Approve AI clips before posting'], editor:['Editor','Edit the selected clip'],
    schedule:['Schedule','Queued posts and delivery timing'], insights:['Insights','Clip quality and studio signals'],
    publishing:['Platforms','Connected publishing destinations'], templates:['Templates','Caption styles and reusable looks'], music:['Nasheeds','Background tracks and audio level'],
    automation:['Settings','Generation rules and studio controls']
  };
  $('#dcPageName').textContent = labels[view]?.[0] || view;
  $('#dcPageSub').textContent = labels[view]?.[1] || '';

  if (CUSTOM.has(view)) {
    $$('.main-col > .panel').forEach(p => p.classList.add('hide'));
    $(`#view-${view}`)?.classList.remove('hide');
    if (view === 'home') renderHome();
    if (view === 'projects') renderProjects();
    if (view === 'review') renderReview();
    if (view === 'editor') ensureEditor();
    if (view === 'publishing') renderConnections();
    if (view === 'templates') renderTemplatesPage();
    if (view === 'music') renderAudioLibrary();
    if (view === 'insights') renderInsightsPage();
    if (view === 'automation') renderSettingsPage();
  } else if (typeof showView === 'function') {
    showView(view);
  } else {
    $$('.main-col > .panel').forEach(p => p.classList.toggle('hide', p.id !== `view-${view}`));
  }
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
  const next = nextScheduledClip(clips);
  panel.innerHTML = `
    <div class="dc-home-v3g">
      <section class="dc-home-hero-g" data-tour="home-hero">
        <div class="dc-home-hero-copy">
          <div class="dc-v3-kicker">${ICON.scissors} V3 workspace</div>
          <h1>One clean workflow. Import, review, edit, publish.</h1>
          <p>DeenClipped turns long lectures into captioned vertical clips, then keeps the next action clear.</p>
          <div class="dc-stat-ribbon" aria-label="Workspace summary">
            ${tinyStat(projects.length,'lectures')}${tinyStat(clips.length,'clips')}${tinyStat(waiting,'review')}${tinyStat(scheduled,'scheduled')}${tinyStat(posted,'posted')}
          </div>
          <div class="dc-v3-actions">
            <button class="dc-btn" id="dcHeroCreate">Paste a lecture</button>
            <button class="dc-btn secondary" data-dc-nav="review">Review clips</button>
            <button class="dc-btn secondary" id="dcHeroTour">Guided demo</button>
          </div>
        </div>
        <div class="dc-hero-stage" aria-label="Recent clip previews">${heroThumbs(clips)}</div>
      </section>

      <section class="dc-home-import-g" data-tour="create-form">
        <span class="dc-import-icon">${socialSvg('youtube')}</span>
        <input id="dcCreateUrl" placeholder="Paste YouTube or video URL">
        <select id="dcCreateTemplate" data-tour="template-picker">${(d.templates||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===d.selectedTemplate?.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select>
        <select id="dcCreateCount"><option>4</option><option selected>8</option><option>12</option><option>16</option></select>
        <select id="dcCreateDuration"><option value="15,45">15–45 sec</option><option value="30,60" selected>30–60 sec</option><option value="45,90">45–90 sec</option></select>
        <button class="dc-btn" id="dcGenerate" data-tour="generate-button">Generate</button>
      </section>

      <section class="dc-home-flow-g" aria-label="Main workflow">
        ${flowCard('Import','Paste lecture links',socialSvg('youtube'),'dcSourceYouTube')}
        ${flowCard('Review',waiting ? `${waiting} clips waiting` : 'Nothing waiting',ICON.review,'review')}
        ${flowCard('Template',selectedTemplate,ICON.style,'editor')}
        ${flowCard('Publish',scheduled ? `${scheduled} clips scheduled` : 'Connect platforms',ICON.publish,'schedule')}
      </section>

      <section class="dc-home-command-g" data-tour="happening-now">
        <div class="dc-home-main-g">
          ${liveFocusPanel(d,jobs,next,selectedTemplate)}
          <div class="dc-project-gallery-g">
            <div class="dc-simple-head"><div><h2>Recent projects</h2><p>Pick up from a lecture without reading a log.</p></div><button class="dc-btn secondary" data-dc-nav="projects">View all</button></div>
            <div class="dc-project-strip-g">${recentProjectsCinema(projects,clips)}</div>
          </div>
        </div>
        <aside class="dc-home-dock-g">
          ${nextPostDock(next)}
          ${platformDock(d)}
          ${attentionDock(d)}
        </aside>
      </section>
    </div>`;
  $('#dcGenerate').onclick=generateProject;
  $('#dcHeroCreate').onclick=()=>$('#dcCreateUrl').focus();
  const source=$('#dcSourceYouTube'); if(source) source.onclick=()=>$('#dcCreateUrl').focus();
  $('#dcHeroTour').onclick=()=>openGuidedTour(0);
  requestAnimationFrame(()=>animatePanel(panel));
}
function tinyStat(value,label){return `<span class="dc-tiny-stat"><b>${esc(value)}</b>${esc(label)}</span>`}
function flowCard(title,note,icon,target){
  const attr = target === 'dcSourceYouTube' ? 'id="dcSourceYouTube"' : `data-dc-nav="${esc(target)}"`;
  return `<button class="dc-flow-card-g" type="button" ${attr}><span>${icon}</span><strong>${esc(title)}</strong><em>${esc(note)}</em></button>`;
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
    const own=clips.filter(c=>c.projectId===p.id), thumb=own.find(c=>c.thumbUrl)?.thumbUrl, failed=p.status==='failed'||p.error, scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
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
function projectDisplayTitle(p){return p.title || cleanUrlTitle(p.url) || 'Untitled lecture'}
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
    const own=clips.filter(c=>c.projectId===p.id),thumb=own.find(c=>c.thumbUrl)?.thumbUrl,failed=p.status==='failed'||p.error,busy=['queued','processing'].includes(p.status),scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
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

async function generateProject(){
  const url=$('#dcCreateUrl')?.value.trim(), button=$('#dcGenerate'); if(!url) return notify('Paste a video link first','bad');
  const [min,max]=$('#dcCreateDuration').value.split(',').map(Number); button.disabled=true; button.textContent='Queueing…';
  try{
    await callApi('/api/template',{method:'POST',body:JSON.stringify({id:$('#dcCreateTemplate').value})});
    await callApi('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcCreateCount').value),clipMinSeconds:min,clipMaxSeconds:max})});
    const result=await callApi('/api/videos',{method:'POST',body:JSON.stringify({urls:url})});
    const failed=(result.results||[]).filter(x=>!x.ok).length;
    notify(failed?`${result.results.length-failed} queued, ${failed} failed`:'Lecture queued — watch Happening now',failed?'bad':'good');
    $('#dcCreateUrl').value=''; await refreshData(); renderHome();
  }catch(error){notify(error.message,'bad')}finally{button.disabled=false;button.textContent='Generate clips'}
}

function renderProjects(){
  const panel=$('#view-projects'),d=data();if(!panel||!d)return;
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
  panel.innerHTML=`<div class="dc-page-head"><div><h1>Projects</h1><p>Lectures, generated clips and render status.</p></div><button class="dc-btn" data-dc-nav="home">＋ New project</button></div><div class="dc-filterbar"><input id="dcProjectSearch" placeholder="Search lectures" value="${esc(projectQuery)}"><select id="dcProjectFilter"><option value="all">All projects</option><option value="processing" ${projectFilter==='processing'?'selected':''}>Processing</option><option value="ready" ${projectFilter==='ready'?'selected':''}>Has clips to review</option><option value="issues" ${projectFilter==='issues'?'selected':''}>Issues</option></select><select id="dcProjectSort"><option value="newest">Newest first</option><option value="oldest" ${projectSort==='oldest'?'selected':''}>Oldest first</option><option value="az" ${projectSort==='az'?'selected':''}>A–Z</option></select></div><div class="dc-project-grid">${projects.length?projects.map(p=>projectCard(p,d.clips||[])).join(''):`<div class="dc-empty"><strong>No matching projects</strong>Change the search or filter.</div>`}</div>`;
  $('#dcProjectSearch').oninput=e=>{projectQuery=e.target.value.trim().toLowerCase();renderProjects()};
  $('#dcProjectFilter').onchange=e=>{projectFilter=e.target.value;renderProjects()};
  $('#dcProjectSort').onchange=e=>{projectSort=e.target.value;renderProjects()};
  requestAnimationFrame(()=>animatePanel(panel));
}
function projectCard(p,clips){
  const own=clips.filter(c=>c.projectId===p.id),thumb=own.find(c=>c.thumbUrl)?.thumbUrl,waiting=own.filter(c=>c.status==='waiting').length,scheduled=own.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length;
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
  const title=projectDisplayTitle(p), thumb=clips.find(c=>c.thumbUrl)?.thumbUrl;
  const waiting=clips.filter(c=>c.status==='waiting').length, scheduled=clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length, posted=clips.filter(c=>c.status==='posted').length, failed=p.status==='failed'||p.error;
  panel.innerHTML=`<div class="dc-project-detail-page"><div class="dc-project-detail-hero"><button class="dc-icon-btn dc-svg" id="dcBackProjects" title="Back to projects">${ICON.back}</button><div class="dc-project-detail-thumb">${thumb?`<img src="${authedUrl(thumb)}" alt="${esc(title)} thumbnail">`:`<div class="dc-project-placeholder">${ICON.projects}<span>Lecture</span></div>`}</div><div class="dc-project-detail-info"><span class="dc-pill ${failed?'bad':['queued','processing'].includes(p.status)?'warn':'good'}">${failed?'Needs retry':statusName(p.status)}</span><h1>${esc(title)}</h1><p>${clips.length} clips · ${posted} posted · ${scheduled} scheduled</p></div><div class="dc-project-detail-actions"><button class="dc-btn secondary" data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>Generate more</button>${failed?`<button class="dc-btn secondary" data-retry-project="${esc(p.id)}">Retry</button>`:''}<button class="dc-btn danger" data-delete-project="${esc(p.id)}">Delete project</button></div></div><div class="dc-project-detail-stats">${metric(clips.length,'Clips')}${metric(waiting,'Review')}${metric(scheduled,'Scheduled')}${metric(posted,'Posted')}${metric(Math.round((clips[0]?.score||0)),'Top score')}</div>${failed?`<div class="dc-project-error-mini">${esc(shortError(p.error||p.stage))}</div>`:''}${p.moreJob&&['queued','processing'].includes(p.moreJob.status)?`<div class="dc-card dc-card-pad"><div class="dc-now-row"><span class="dc-spinner"></span><div class="dc-now-main"><strong>${esc(p.moreJob.stage||'Generating more clips')}</strong><span>Reusing saved lecture and transcript.</span><div class="dc-progress"><i style="width:${clamp(p.moreJob.progress,0,100)}%"></i></div></div><span class="dc-pill warn">${Math.round(p.moreJob.progress||0)}%</span></div></div>`:''}<div class="dc-project-detail-filter"><select><option>All clips</option><option>Waiting review</option><option>Scheduled</option><option>Posted</option></select><select><option>Highest score</option><option>Newest first</option><option>Longest</option></select><span class="dc-pill">${clips.length} clips</span><button class="dc-btn secondary" data-more-project="${esc(p.id)}" ${!p.sourceReusable?'disabled':''}>More clips</button></div><div class="dc-project-clip-grid">${clips.length?clips.map(c=>clipCard(c,{detail:true})).join(''):`<div class="dc-empty dc-empty-full"><strong>No clips yet</strong>${['queued','processing'].includes(p.status)?'Processing is still underway.':'Generate more clips from this lecture.'}</div>`}</div></div>`;
  $('#dcBackProjects').onclick=()=>{selectedProjectId='';document.body.classList.remove('dc-project-open');renderProjects()};
  requestAnimationFrame(()=>animatePanel(panel));
}
function clipCard(c,opts={}){
  const canPost=['approved','ready','publish_failed','scheduled'].includes(c.status);
  const canSchedule=c.status==='waiting';
  const title=shortText(c.title||'Untitled clip', opts.detail?54:44);
  const sub=c.scheduledAt?`Scheduled · ${formatDate(c.scheduledAt)}`:statusName(c.status);
  return `<article class="dc-clip-card v3-full"><div class="dc-clip-media"><button class="dc-clip-media-button" data-edit-style-clip="${esc(c.id)}" type="button">${clipThumb(c)}</button><span class="dc-score">${Math.round(c.score||0)}</span><span class="dc-duration">${formatDuration(c.durationMs)}</span><span class="dc-clip-state dc-pill ${c.status==='posted'?'good':c.status==='waiting'?'warn':c.status==='publish_failed'?'bad':''}">${statusName(c.status)}</span></div><div class="dc-clip-body"><h3>${esc(title)}</h3><p>${esc(sub)}</p><div class="dc-clip-actions"><button class="dc-btn" data-edit-style-clip="${esc(c.id)}">Edit style</button><button class="dc-btn secondary" data-edit-video-clip="${esc(c.id)}">Edit video</button>${canPost?`<button class="dc-btn secondary" data-post-clip="${esc(c.id)}">Post now</button>`:canSchedule?`<button class="dc-btn secondary" data-schedule-clip="${esc(c.id)}">Schedule</button>`:`<button class="dc-btn secondary" data-download-clip="${esc(c.id)}">Download</button>`}<button class="dc-btn secondary" data-download-clip="${esc(c.id)}">Download</button><button class="dc-btn danger" data-delete-clip="${esc(c.id)}">Delete</button></div></div></article>`;
}

function renderReview(){
  const panel=$('#view-review'),d=data();if(!panel||!d)return;
  const waiting=[...(d.clips||[])].filter(c=>c.status==='waiting').sort((a,b)=>Number(b.score||0)-Number(a.score||0));
  const strong=waiting.filter(c=>hookInfo(c).strong).length;
  const avg=waiting.length?Math.round(waiting.reduce((sum,c)=>sum+Number(c.score||0),0)/waiting.length):0;
  panel.innerHTML=`<div class="dc-review-page-pro"><section class="dc-review-hero-pro"><div><span class="dc-review-kicker">Clip approval</span><h1>Pick winners fast.</h1><p>Every clip shows hook strength, suggested posting copy and quick actions. The editor is untouched unless you choose Edit style or Edit video.</p></div><div class="dc-review-metrics-pro"><span><b>${waiting.length}</b><em>waiting</em></span><span><b>${strong}</b><em>strong hooks</em></span><span><b>${avg}</b><em>avg score</em></span></div></section><div class="dc-review-toolbar pro"><span class="dc-pill ${waiting.length?'warn':'good'}">${waiting.length?`${waiting.length} clips need a decision`:'Review clear'}</span><span class="dc-pill ${strong?'good':'warn'}">${strong} strong hooks</span><span class="spacer"></span><button class="dc-btn secondary" id="dcApproveVerified" ${!waiting.length?'disabled':''}>Approve verified</button><button class="dc-btn" id="dcScheduleAll" ${!waiting.length?'disabled':''}>Schedule all</button></div><div class="dc-review-list pro">${waiting.length?waiting.map(reviewRow).join(''):`<div class="dc-review-empty-pro"><div><div class="dc-empty-icon">${ICON.review}</div><strong>Clip review is clear</strong><p>New AI-selected clips will appear here with hook scores and captions.</p><button class="dc-btn" data-dc-nav="home">Import another lecture</button></div></div>`}</div></div>`;
  $('#dcApproveVerified').onclick=approveVerified;
  $('#dcScheduleAll').onclick=()=>scheduleMany(waiting.map(c=>c.id));
  requestAnimationFrame(()=>animatePanel(panel));
}
function reviewRow(c){
  const hook=hookInfo(c), copy=socialCopyForClip(c);
  return `<article class="dc-review-item pro"><button class="dc-review-media" type="button" data-edit-clip="${esc(c.id)}" aria-label="Open ${esc(c.title||'clip')}">${c.thumbUrl?`<img src="${authedUrl(c.thumbUrl)}" alt="${esc(c.title||'Clip')} thumbnail">`:''}<span class="dc-review-score">${Math.round(c.score||0)}</span></button><div class="dc-review-main"><div class="dc-review-title-row"><h3>${esc(c.title||copy.title)}</h3><small>${formatDuration(c.durationMs)} · quality ${Math.round(c.quality||c.score||0)}/100</small></div><div class="dc-hook-strip"><div class="dc-hook-card"><strong><span class="dc-hook-badge ${hook.strong?'good':'warn'}">${hook.strong?'Strong':'Weak'} hook</span></strong><p>${esc(hook.suggestion)}</p></div><div class="dc-copy-card"><strong>Auto posting copy</strong><div class="dc-copy-grid"><div class="dc-copy-mini"><b>TikTok</b><span>${esc(copy.tiktok)}</span></div><div class="dc-copy-mini"><b>Instagram</b><span>${esc(copy.instagram)}</span></div><div class="dc-copy-mini"><b>Shorts title</b><span>${esc(copy.youtube)}</span></div><div class="dc-copy-mini"><b>Hashtags</b><span>${esc(copy.hashtags.join(' '))}</span></div></div></div></div><div class="dc-review-actions pro"><button class="dc-btn" data-approve-clip="${esc(c.id)}">Approve</button><button class="dc-btn secondary" data-edit-style-clip="${esc(c.id)}">Edit style</button><button class="dc-btn secondary" data-edit-video-clip="${esc(c.id)}">Edit video</button><button class="dc-btn secondary" data-regenerate-title="${esc(c.id)}">Regenerate title</button><button class="dc-btn secondary" data-make-shorter="${esc(c.id)}">Make shorter</button><button class="dc-btn secondary" data-make-longer="${esc(c.id)}">Make longer</button><button class="dc-btn danger wide" data-delete-clip="${esc(c.id)}">Delete</button></div></div></article>`;
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
  try{await callApi(`/api/clips/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({status:'approved'})});notify('Clip approved');await refreshData();renderReview()}catch(e){notify(e.message,'bad')}
}
async function scheduleMany(ids){
  if(!ids.length)return;if(!confirm(`Schedule ${ids.length} clip${ids.length===1?'':'s'}?`))return;
  try{const result=await callApi('/api/clips/schedule-selected',{method:'POST',body:JSON.stringify({ids})});notify(`${result.scheduled||0} clips scheduled`,result.failed?'bad':'good');await refreshData();renderReview()}catch(e){notify(e.message,'bad')}
}
async function scheduleClip(id){await scheduleMany([id]);if(currentView==='projects')renderProjects()}
async function postClip(id){if(!confirm('Post this clip now to the enabled destinations?'))return;try{await callApi(`/api/clips/${encodeURIComponent(id)}/publish`,{method:'POST'});notify('Publishing transfer created');await refreshData();renderCurrent()}catch(e){notify(e.message,'bad')}}
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
  const items=$$('.dc-card,.dc-project-card,.dc-clip-card,.dc-now-row,.dc-list-row,.dc-social-card',panel).slice(0,18);
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
        padding:Number(d.smartFramingPadding??.18),zoom:Number(d.smartFramingZoom??1),smoothing:Number(d.smartFramingSmoothing??.82)
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
  if(!clip){panel.innerHTML=`<div class="dc-page-head"><div><h1>Editor</h1><p>Generate a clip first.</p></div></div><div class="dc-card dc-card-pad"><div class="dc-empty"><strong>No clips available</strong>Create clips from Home, then open the editor.</div></div>`;return}
  if(editor.clipId!==clip.id){
    const pendingTool=editor.pendingTool||'captions', pendingTab=editor.pendingCaptionTab||'styles'; editor.pendingTool=''; editor.pendingCaptionTab='';
    editor.loading=true; editor.clipId=clip.id; editor.tool=pendingTool;editor.captionTab=pendingTool==='captions'?pendingTab:'styles';editor.search='';
    const template=(d.templates||[]).find(t=>t.id===clip.templateId)||d.selectedTemplate||(d.templates||[])[0]||d.templateDraft||{};
    const saved=loadEditorDraft(clip.id);
    editor.draft={...clone(template),...(saved?.draft||{}),__clipId:clip.id};editor.draft.cropPositionX??=50;editor.draft.cropPositionY??=50;editor.draft.captionTimingOffsetMs??=-120;
    editor.captionText=saved?.captionText??clip.transcript??'';
    editor.trimIn=0;editor.trimOut=Math.max(.1,Number(clip.durationMs||0)/1000);
    editor.dirty=Boolean(saved);editor.history=[];editor.historyIndex=-1;editor.sourceBase=Number(clip.startSec||0);editor.sourceEnd=Number(clip.endSec||editor.sourceBase+editor.trimOut);editor.sourceFallback=false;editor.framingPlan=clip.smartFraming||null;editor.framingStatus=editor.framingPlan?'ready':'idle';editor.framingMessage=editor.framingPlan?'Using the framing saved with this render':'Smart framing has not been analysed';pushHistory(true);
    editor.captionWords=approximateWords(editor.captionText,editor.trimOut);editor.captionSource='fallback';editor.backendCaptionReady=false;
    await loadCaptionWords(clip);
    editor.loading=false;
  }
  renderEditor(clip);
}
async function loadCaptionWords(clip){
  try{
    const payload=await callApi(`/api/clips/${encodeURIComponent(clip.id)}/captions`);
    if(editor.clipId!==clip.id)return;
    if(Array.isArray(payload.words)&&payload.words.length){
      editor.captionWords=payload.words.map(w=>({start:Number(w.start),end:Number(w.end),word:String(w.word||'').trim()})).filter(w=>w.word&&w.end>w.start).sort((a,b)=>a.start-b.start);
      editor.captionSource=payload.exact?'whisper':payload.edited?'edited':'fallback';editor.backendCaptionReady=true;editor.captionSyncStatus='idle';editor.captionSyncMessage=payload.synced?'Clip-specific speech timing loaded':'';if(!editor.dirty&&payload.transcript)editor.captionText=payload.transcript;
    }
  }catch{editor.captionWords=approximateWords(editor.captionText,Math.max(.1,Number(clip.durationMs||0)/1000));editor.captionSource='fallback'}
}
function loadEditorDraft(id){try{return JSON.parse(localStorage.getItem(`dc-editor-${id}`)||'null')}catch{return null}}
function saveEditorLocal(){try{localStorage.setItem(`dc-editor-${editor.clipId}`,JSON.stringify({draft:cleanDraft(editor.draft),captionText:editor.captionText,savedAt:Date.now()}))}catch{}}
function clearEditorLocal(){try{localStorage.removeItem(`dc-editor-${editor.clipId}`)}catch{}}

function renderEditor(clip){
  const panel=$('#view-editor'),d=data();if(!panel||!clip)return;
  panel.classList.add('dc-editor-page');
  const source=editorSourceUrl(clip);
  panel.innerHTML=`<div class="dc-editor-header"><button class="dc-icon-btn dc-svg" id="dcEditorBack" title="Back to project">${ICON.back}</button><div class="dc-editor-title"><strong>${esc(clip.title||'Untitled clip')}</strong><span>${esc(clip.projectTitle||'Lecture')} · ${Math.round(clip.score||0)}/100 · ${editor.dirty?'Unsaved changes':'Saved'}</span></div><button class="dc-icon-btn dc-svg" id="dcUndo" title="Undo" ${editor.historyIndex<=0?'disabled':''}>${ICON.undo}</button><button class="dc-icon-btn dc-svg" id="dcRedo" title="Redo" ${editor.historyIndex>=editor.history.length-1?'disabled':''}>${ICON.redo}</button><button class="dc-btn secondary" id="dcSaveDraft">Save</button><button class="dc-btn" id="dcRenderClip">Export video</button></div><div class="dc-editor-workspace"><nav class="dc-tool-rail">${toolButton('captions','Captions','captions')}${toolButton('canvas','Canvas','canvas')}${toolButton('style','Look','style')}${toolButton('audio','Audio','audio')}${toolButton('details','Post','details')}</nav><aside class="dc-tool-panel"><div class="dc-tool-head"><strong id="dcToolTitle">Captions</strong><span class="dc-pill ${editor.captionSource==='whisper'?'good':'warn'}" id="dcCaptionSource">${editor.captionSource==='whisper'?'Exact speech timing':editor.captionSource==='edited'?'Edited speech timing':'Estimated timing'}</span></div><div class="dc-tool-content" id="dcToolContent"></div></aside><main class="dc-canvas-area"><div class="dc-canvas-toolbar"><button class="dc-icon-btn dc-svg" id="dcPlayButton">${ICON.play}</button><span class="dc-timeline-time" id="dcCanvasTime">0:00 / ${formatClock(editor.trimOut)}</span><span class="spacer"></span><button type="button" class="dc-btn secondary dc-caption-edit-shortcut" id="dcOpenCaptionText">Edit captions</button><span class="dc-zoom">Preview · drag video or captions</span></div><div class="dc-canvas-wrap"><div class="dc-video-canvas" id="dcVideoCanvas"><video id="dcEditorVideoBg" class="dc-video-layer dc-video-bg" src="${source}" preload="metadata" muted playsinline></video><video id="dcEditorVideo" class="dc-video-layer dc-video-fg" src="${source}" preload="metadata" playsinline></video><div class="dc-framing-guide"></div><button type="button" class="dc-resize-handle" id="dcResizeHandle" aria-label="Resize video"></button><span class="dc-layer-badge" id="dcLayerBadge">Video layer</span><div class="dc-snap-guide vertical" id="dcSnapGuideV"></div><div class="dc-snap-guide horizontal" id="dcSnapGuideH"></div><div class="dc-caption-overlay" id="dcCaptionOverlay" role="group" aria-label="Caption layer"></div><div class="dc-watermark" id="dcWatermark"></div><div class="dc-brand-line" id="dcBrandLine"></div><span class="dc-caption-status" id="dcCaptionStatus">Captions follow the spoken words</span></div></div></main><section class="dc-timeline"><div class="dc-timeline-top"><span class="dc-timeline-time" id="dcTimelineTime">0:00.0</span><span class="spacer"></span></div><div class="dc-timeline-scroll" id="dcTimelineScroll"><div class="dc-ruler" id="dcRuler"></div><div class="dc-track-row"><div class="dc-track-label">Video</div><div class="dc-track-content"><div class="dc-video-block">${esc(clip.title||'Video')}</div></div></div><div class="dc-track-row"><div class="dc-track-label">Captions</div><div class="dc-track-content" id="dcCaptionTrack"></div></div><div class="dc-track-row"><div class="dc-track-label">Audio</div><div class="dc-track-content"><div class="dc-audio-block">${esc(clip.musicName||'Nasheed')}</div></div></div><div class="dc-playhead" id="dcPlayhead"></div></div></section></div>`;
  $('#dcEditorBack').onclick=()=>{selectedProjectId=clip.projectId;go('projects')};
  $('#dcUndo').onclick=undoEditor;$('#dcRedo').onclick=redoEditor;$('#dcSaveDraft').onclick=saveEditorDraft;$('#dcRenderClip').onclick=renderEditedClip;$('#dcPlayButton').onclick=togglePlayback;$('#dcOpenCaptionText')?.addEventListener('click',()=>{editor.tool='captions';editor.captionTab='text';renderEditorTool();setTimeout(()=>$('#dcCaptionText')?.focus(),0);});
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
  const offset=Number(editor.draft.captionTimingOffsetMs??-120);
  const syncTitle=busy?'Synchronising speech…':exact?'Speech timing synced':editor.captionSource==='edited'?'Edited timing':'Timing needs synchronising';
  const syncText=busy?'Re-transcribing this exact clip and rebuilding word timestamps.':exact?'Whisper word timestamps are loaded for this clip.':'Use Auto-sync before the final export so captions follow the voice.';
  return `<div class="dc-sync-card"><div class="dc-sync-top"><i class="dc-sync-dot ${busy?'busy':exact?'good':''}"></i><div class="dc-sync-copy"><strong>${syncTitle}</strong><span>${syncText}</span></div></div><div class="dc-sync-actions"><button type="button" class="dc-btn ${exact?'secondary':''}" id="dcSyncCaptions" ${busy?'disabled':''}>${busy?'Syncing…':'Auto-sync captions'}</button><button type="button" class="dc-btn secondary" data-caption-nudge="-100">Earlier</button><button type="button" class="dc-btn secondary" data-caption-nudge="100">Later</button></div><div class="dc-field" style="margin-top:11px"><div class="dc-timing-readout"><span>Fine timing</span><b id="dcTimingLabel">${formatCaptionOffset(offset)}</b></div><input type="range" data-template-key="captionTimingOffsetMs" value="${offset}" min="-1000" max="1000" step="20"></div></div><div class="dc-subtabs">${['styles','text','format','position'].map(x=>`<button type="button" class="${editor.captionTab===x?'on':''}" data-caption-tab="${x}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div>${editor.captionTab==='styles'?captionStyles():editor.captionTab==='text'?captionTextPanel():editor.captionTab==='format'?captionFormat():captionPosition()}`;
}

function captionStyles(){
  const styles=[['viral','Viral','Active spoken word'],['clean','Clean','Easy-to-read phrases'],['arabic','Arabic','Readable Arabic layout'],['cinema','Cinema','Lower cinematic captions']];
  return `<div class="dc-section"><h3>Caption style</h3><div class="dc-style-grid">${styles.map(([id,name,note])=>`<button type="button" class="dc-style-card" data-caption-style="${id}"><div class="dc-style-preview" style="${captionStylePreview(id)}">${id==='arabic'?'تذكير':'REMINDER'}</div><b>${name}</b><span>${note}</span></button>`).join('')}</div></div><div class="dc-caption-note">Drag the caption directly in the preview, or use Position. Guides snap at 25%, centre and 75%.</div>`;
}

function captionStylePreview(id){
  if(id==='gold')return'color:#d9b478;-webkit-text-stroke:1px #000';if(id==='clean')return'font-weight:600;background:#0008';if(id==='arabic')return"font-family:Amiri,serif;font-size:15px";if(id==='bold')return'font-size:13px;font-weight:900';if(id==='cinema')return"font-family:'Playfair Display',serif;font-size:11px";return'font-weight:900';
}
function captionTextPanel(){
  const groups=captionSegments().slice(0,30);
  return `<div class="dc-section"><h3>Edit caption transcript</h3><textarea class="dc-caption-editor" id="dcCaptionText">${esc(editor.captionText)}</textarea><div class="dc-caption-note" style="margin-top:7px">Whisper word timings are preserved. When words are changed, DeenClipped maps them onto the original speech spans instead of stretching captions across silence.</div></div><div class="dc-section"><h3>Speech-timed segments</h3><div class="dc-caption-list">${groups.map(g=>`<button class="dc-caption-line" data-caption-start="${g.start}"><span>${formatClock(g.start)}</span><b>${esc(g.text)}</b></button>`).join('')}</div></div>`; 
}
function captionFormat(){
  const d=editor.draft;
  return `<div class="dc-section"><h3>Behaviour</h3>${selectField('Caption mode','captionMode',[['dynamic-stack','Dynamic pop'],['word','Word highlight'],['phrase','Phrase captions']])}${selectField('Main font','captionFont',[['DejaVu Sans','DejaVu Sans'],['Amiri','Amiri'],['Scheherazade New','Scheherazade Arabic']])}${selectField('Important-word font','captionHighlightFont',[['DejaVu Serif','DejaVu Serif'],['DejaVu Sans','DejaVu Sans'],['Amiri','Amiri']])}${selectField('Arabic font','captionArabicFont',[['Amiri','Amiri'],['Scheherazade New','Scheherazade Arabic'],['DejaVu Sans','DejaVu Sans']])}${rangeField('Font size','captionFontSize',24,140,1)}${rangeField('Words per caption','captionMaxWords',1,12,1)}${checkField('Italic important words','captionHighlightItalic')}${checkField('Uppercase captions','captionUppercase')}</div><div class="dc-section"><h3>Clean emphasis</h3>${rangeField('Important-word glow','captionHighlightGlow',0,30,1)}<div class="dc-color-grid">${colorField('Text','captionPrimary')}${colorField('Important word','captionHighlight')}${colorField('Outline','captionOutline')}${colorField('Background','captionBackground')}</div>${rangeField('Outline','captionOutlineWidth',0,14,1)}${rangeField('Background opacity','captionBackgroundOpacity',0,100,1)}${rangeField('Line spacing','captionLineHeight',.65,1.4,.05)}</div>`;
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
  return `${templateStatus}<div class="dc-section"><h3>Video look</h3>${selectField('Filter','filterPreset',[['natural','Natural'],['crisp','Crisp'],['warm','Warm'],['cinematic','Cinematic'],['monochrome','Monochrome'],['custom','Custom']])}${rangeField('Brightness','brightness',-1,1,.05)}${rangeField('Contrast','contrast',.5,2,.05)}${rangeField('Saturation','saturation',0,3,.05)}<details class="dc-advanced"><summary>Advanced image controls</summary><div style="margin-top:10px">${rangeField('Sharpen','sharpen',0,2,.05)}${rangeField('Vignette','vignette',0,1,.05)}</div></details></div><div class="dc-section"><h3>Branding</h3>${textField('Watermark','watermark')}${selectField('Watermark position','watermarkPosition',[['top-left','Top left'],['top-center','Top centre'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom centre'],['bottom-right','Bottom right']])}<details class="dc-advanced"><summary>Advanced branding controls</summary><div style="margin-top:10px">${rangeField('Watermark size','watermarkFontSize',12,90,1)}${rangeField('Watermark opacity','watermarkOpacity',0,100,1)}${colorField('Watermark colour','watermarkColor')}${checkField('Brand line','brandLineEnabled')}${colorField('Brand line colour','brandLineColor')}</div></details></div><div class="dc-inline-actions"><button type="button" class="dc-btn secondary" id="dcSavePreset">Save as default for new clips</button><button type="button" class="dc-btn" id="dcApplyPresetAll">Apply default to new + old clips</button></div><div class="dc-caption-note" style="margin-top:7px">The saved default name is shown above. The second button saves the current look as that default and re-renders every existing clip with it.</div>`;
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
    editor.captionText=event.target.value;editor.captionWords=mapEditedWordsToSpeech(editor.captionText,editor.captionWords,Math.max(.1,editor.trimOut-editor.trimIn));editor.captionSource='edited';markEditorDirty();updateCaptionAtTime(editor.currentTime);renderTimeline();debouncedHistory();
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
  const snap=JSON.stringify({draft:cleanDraft(editor.draft),captionText:editor.captionText});
  if(!initial&&editor.history[editor.historyIndex]===snap)return;
  editor.history=editor.history.slice(0,editor.historyIndex+1);editor.history.push(snap);if(editor.history.length>40)editor.history.shift();editor.historyIndex=editor.history.length-1;
  $('#dcUndo')?.toggleAttribute('disabled',editor.historyIndex<=0);$('#dcRedo')?.toggleAttribute('disabled',editor.historyIndex>=editor.history.length-1);
}
function undoEditor(){if(editor.historyIndex<=0)return;editor.historyIndex--;restoreHistory()}
function redoEditor(){if(editor.historyIndex>=editor.history.length-1)return;editor.historyIndex++;restoreHistory()}
function restoreHistory(){const snap=JSON.parse(editor.history[editor.historyIndex]);editor.draft={...snap.draft,__clipId:editor.clipId};editor.captionText=snap.captionText;editor.captionWords=approximateWords(editor.captionText,Math.max(.1,editor.trimOut-editor.trimIn));markEditorDirty(false);renderEditor(currentClip())}
function markEditorDirty(push=true){editor.dirty=true;saveEditorLocal();const title=$('.dc-editor-title span');if(title)title.textContent=`${currentClip()?.projectTitle||'Lecture'} · ${Math.round(currentClip()?.score||0)}/100 · Unsaved changes`;if(push)saveEditorLocal()}

function applyCaptionStyle(id){
  const presets={
    viral:{captionMode:'dynamic-stack',captionFont:'Poppins',captionFontSize:100,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#09090A',captionOutlineWidth:5,captionBackgroundOpacity:0,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:4,captionUppercase:false},
    gold:{captionMode:'word',captionFont:'Montserrat',captionFontSize:92,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:5,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:5},
    clean:{captionMode:'phrase',captionFont:'Poppins',captionFontSize:72,captionPrimary:'#FFFFFF',captionHighlight:'#FFFFFF',captionOutline:'#000000',captionOutlineWidth:2,captionBackground:'#000000',captionBackgroundOpacity:55,captionPosition:'bottom',captionHorizontal:'center',captionMaxWords:7},
    arabic:{captionMode:'phrase',captionFont:'Amiri',captionFontSize:94,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:4,captionBackgroundOpacity:30,captionPosition:'bottom',captionHorizontal:'right',captionMaxWords:8},
    bold:{captionMode:'dynamic-stack',captionFont:'Poppins',captionFontSize:122,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:7,captionPosition:'middle',captionHorizontal:'center',captionMaxWords:3,captionUppercase:true},
    cinema:{captionMode:'phrase',captionFont:'Playfair Display',captionFontSize:70,captionPrimary:'#FFFFFF',captionHighlight:'#D9B478',captionOutline:'#000000',captionOutlineWidth:3,captionBackgroundOpacity:0,captionPosition:'bottom',captionHorizontal:'center',captionMaxWords:8}
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
  if(id==='speaker')Object.assign(editor.draft,{fitMode:'crop',smartFramingEnabled:true,smartFramingBias:'auto',smartFramingZoom:1,smartFramingPadding:.18,smartFramingSmoothing:.78});
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
    if(!ensureManual())return;
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
  canvas.onwheel=event=>{if(editor.draft?.fitMode!=='crop')return;event.preventDefault();switchToManualFraming('Manual crop selected by zooming');editor.draft.smartFramingZoom=clamp(Number(editor.draft.smartFramingZoom||1)+(event.deltaY<0?.05:-.05),.75,2.5);applyFrameAtTime(editor.currentTime);markEditorDirty(false)};
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
    const rect=canvas.getBoundingClientRect();
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
  canvas.addEventListener('pointerdown',event=>{if(!event.target.closest('#dcCaptionOverlay'))overlay.classList.remove('is-selected')});
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
  overlay.style.fontFamily=d.captionFont||'Poppins';overlay.style.fontSize=`${clamp(Number(d.captionFontSize||96)/3.45,15,47)}px`;overlay.style.color=d.captionPrimary||'#fff';overlay.style.webkitTextStroke=`${Number(d.captionOutlineWidth||0)/3}px ${d.captionOutline||'#000'}`;overlay.style.textShadow=`0 ${clamp(Number(d.captionShadow||0)/2,0,4)}px ${clamp(Number(d.captionShadow||0)*1.8,0,12)}px rgba(0,0,0,.58)`;overlay.style.textTransform=d.captionUppercase?'uppercase':'none';overlay.style.setProperty('--dc-cap-highlight',d.captionHighlight||'#fff');overlay.style.setProperty('--dc-cap-highlight-font',d.captionHighlightFont||'DejaVu Serif');overlay.style.setProperty('--dc-cap-arabic-font',d.captionArabicFont||'Amiri');overlay.style.setProperty('--dc-cap-highlight-style',d.captionHighlightItalic===false?'normal':'italic');overlay.style.setProperty('--dc-cap-highlight-glow',`${clamp(Number(d.captionHighlightGlow||0)/2.5,0,14)}px`);overlay.style.setProperty('--dc-cap-bg-color',hexAlpha(d.captionBackground||'#000000',clamp(Number(d.captionBackgroundOpacity||0)/100,0,1)));overlay.style.lineHeight=String(d.captionLineHeight||.9);
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
  const offset=Number(editor.draft.captionTimingOffsetMs??-120)/1000;
  const speechTime=time-offset;
  const hold=Math.min(.09,Math.max(0,Number(editor.draft.captionHoldSeconds??.06)));
  const index=words.findIndex(w=>speechTime>=Number(w.start)&&speechTime<Number(w.end)+hold);if(index<0)return'';
  const mode=editor.draft.captionMode||'dynamic-stack',max=Math.max(1,Number(editor.draft.captionMaxWords||4)),groups=speechGroups(words,max),group=groups.find(g=>index>=g.startIndex&&index<=g.endIndex);
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
function speechGroups(words,maxWords){
  const groups=[];let start=0;
  for(let i=0;i<words.length;i++){
    const current=words[i],next=words[i+1],count=i-start+1,punctuation=/[.!?…][”"'’)]?$/.test(String(current.word||'')),gap=next?Number(next.start)-Number(current.end):Infinity;
    if(count>=maxWords||punctuation||gap>=.34||!next){groups.push({startIndex:start,endIndex:i,start:Number(words[start].start),end:Number(current.end),text:words.slice(start,i+1).map(w=>w.word).join(' ')});start=i+1}
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
function captionSegments(){const offset=Number(editor.draft.captionTimingOffsetMs??-120)/1000;return speechGroups(editor.captionWords,Math.max(1,Number(editor.draft.captionMaxWords||4))).map(g=>({start:clamp(g.start+offset,0,editor.trimOut),end:clamp(g.end+offset,0,editor.trimOut),text:g.text})).filter(g=>g.end>g.start)}
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
  editor.draft.captionTimingOffsetMs=clamp(Number(editor.draft.captionTimingOffsetMs??-120)+Number(amount||0),-1000,1000);
  markEditorDirty();pushHistory();renderEditorTool();updateCaptionAtTime(editor.currentTime);renderTimeline();
}
async function resyncCaptions(){
  const clip=currentClip(),button=$('#dcSyncCaptions');if(!clip||editor.captionSyncStatus==='syncing')return;
  editor.captionSyncStatus='syncing';renderEditorTool();
  try{
    const payload=await callApi(`/api/clips/${encodeURIComponent(clip.id)}/captions/resync`,{method:'POST',body:'{}'});
    if(!Array.isArray(payload.words)||!payload.words.length)throw new Error('No speech timestamps were returned.');
    editor.captionWords=payload.words.map(w=>({start:Number(w.start),end:Number(w.end),word:String(w.word||'').trim()})).filter(w=>w.word&&w.end>w.start).sort((a,b)=>a.start-b.start);
    editor.captionText=payload.transcript||editor.captionWords.map(w=>w.word).join(' ');
    editor.captionSource='whisper';editor.captionSyncStatus='idle';editor.draft.captionTimingOffsetMs=-120;markEditorDirty();pushHistory();renderEditorTool();updateCaptionAtTime(editor.currentTime);renderTimeline();notify('Captions synchronised to this clip');
  }catch(error){editor.captionSyncStatus='error';editor.captionSyncMessage=error.message;notify(error.message,'bad');renderEditorTool()}
}

async function saveEditorDraft(){
  const clip=currentClip();if(!clip)return;const button=$('#dcSaveDraft');button.disabled=true;button.textContent='Saving + re-rendering…';
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
  }catch(error){notify(error.message,'bad')}finally{if(button){button.disabled=false;button.textContent='Save'}}
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
  const clip=currentClip(),button=$('#dcRenderClip');if(!clip)return;button.disabled=true;button.textContent='Queueing…';
  try{
    const title=$('#dcMetaTitle')?.value??clip.title,description=$('#dcMetaDescription')?.value??clip.description,hashtags=$('#dcMetaHashtags')?.value??clip.hashtags;
    await callApi(`/api/clips/${encodeURIComponent(clip.id)}`,{method:'PATCH',body:JSON.stringify({title,description,hashtags,transcript:editor.captionText})});
    if(editor.draft.musicVolumePercent)await callApi('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Number(editor.draft.musicVolumePercent)})});
    const template=await callApi('/api/templates',{method:'POST',body:JSON.stringify({template:{...cleanDraft(editor.draft),id:'',name:`${clip.title||'Clip'} · Editor`},select:false})});
    const asVariant=clip.status==='posted';
    await callApi(`/api/clips/${encodeURIComponent(clip.id)}/rerender`,{method:'POST',body:JSON.stringify({templateId:template.template.id,asVariant})});
    editor.dirty=false;clearEditorLocal();notify(asVariant?'Edited repost variant queued':'Edited clip queued for rendering');await refreshData();go('home');
  }catch(error){notify(error.message,'bad')}finally{if(button){button.disabled=false;button.textContent='Export video'}}
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
  {view:'home',target:'[data-tour="home-hero"]',title:'This is the new V3 home',copy:'New users see the whole workflow visually: import, clip, edit, publish. This is the demo area you can show during TikTok review.'},
  {view:'home',target:'[data-tour="create-form"]',title:'Paste the lecture here',copy:'Use this section to paste a YouTube lecture or source link, pick the template, clip count and duration.'},
  {view:'home',target:'[data-tour="generate-button"]',title:'Generate clips',copy:'This sends the lecture to the backend worker. Happening Now then shows download, transcription, clipping and render progress.'},
  {view:'home',target:'[data-tour="happening-now"]',title:'Happening Now',copy:'This is the old side-content idea brought back: active jobs, re-renders, uploads and latest activity stay visible.'},
  {view:'home',target:'[data-tour="platform-cards"]',title:'Connect platforms',copy:'Before TikTok approval, reviewers need to see account status and posting options clearly.'},
  {view:'projects',target:'[data-dc-nav="projects"]',title:'Projects',copy:'Each lecture has its own thumbnails, clips and editing history.'},
  {view:'review',target:'[data-dc-nav="review"]',title:'Review',copy:'Approve, edit, schedule or discard clips from one clear queue.'},
  {view:'editor',target:'[data-dc-nav="editor"]',title:'Editor',copy:'Open a clip to adjust captions, framing, style and export settings.'}
];
let guideIndex = 0;
function openGuidedTour(index=0){
  guideIndex = clamp(index,0,GUIDE_STEPS.length-1);
  let layer = $('#dcGuideLayer');
  if(!layer){
    layer=document.createElement('div');layer.id='dcGuideLayer';layer.className='dc-guide-layer';
    layer.innerHTML='<div class="dc-guide-spot" id="dcGuideSpot"></div><div class="dc-guide-card" id="dcGuideCard"><h3 id="dcGuideTitle"></h3><p id="dcGuideCopy"></p><div class="dc-guide-foot"><span class="dc-guide-count" id="dcGuideCount"></span><button class="dc-btn secondary" id="dcGuideClose">Close</button><button class="dc-btn secondary" id="dcGuideBack">Back</button><button class="dc-btn" id="dcGuideNext">Next</button></div></div>';
    document.body.appendChild(layer);
    $('#dcGuideClose').onclick=closeGuidedTour;$('#dcGuideBack').onclick=()=>{guideIndex=Math.max(0,guideIndex-1);renderGuidedTour()};$('#dcGuideNext').onclick=()=>{if(guideIndex>=GUIDE_STEPS.length-1)closeGuidedTour();else{guideIndex++;renderGuidedTour()}};
  }
  layer.classList.add('show');renderGuidedTour();
}
function closeGuidedTour(){ $('#dcGuideLayer')?.remove(); }
function renderGuidedTour(){
  const step=GUIDE_STEPS[guideIndex]||GUIDE_STEPS[0];
  if(step.view && currentView!==step.view) go(step.view);
  setTimeout(()=>{
    const target=$(step.target),spot=$('#dcGuideSpot'),card=$('#dcGuideCard');if(!spot||!card)return;
    $('#dcGuideTitle').textContent=step.title;$('#dcGuideCopy').textContent=step.copy;$('#dcGuideCount').textContent=`${guideIndex+1}/${GUIDE_STEPS.length}`;$('#dcGuideBack').disabled=guideIndex===0;$('#dcGuideNext').textContent=guideIndex>=GUIDE_STEPS.length-1?'Finish':'Next';
    if(!target){spot.style.cssText='left:50%;top:50%;width:1px;height:1px';card.classList.add('dc-guide-missing');return}
    card.classList.remove('dc-guide-missing');target.scrollIntoView({block:'center',inline:'center',behavior:'smooth'});
    setTimeout(()=>{
      const r=target.getBoundingClientRect(),pad=8;
      const left=Math.max(8,r.left-pad),top=Math.max(8,r.top-pad),width=Math.min(window.innerWidth-16,r.width+pad*2),height=Math.min(window.innerHeight-16,r.height+pad*2);
      spot.style.left=`${left}px`;spot.style.top=`${top}px`;spot.style.width=`${width}px`;spot.style.height=`${height}px`;
      const cardW=Math.min(360,window.innerWidth-28);let cx=Math.min(window.innerWidth-cardW-14,Math.max(14,left));let cy=top+height+14;
      if(cy+190>window.innerHeight)cy=Math.max(14,top-204);
      card.style.left=`${cx}px`;card.style.top=`${cy}px`;card.style.width=`${cardW}px`;
    },170);
  },80);
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
  if(!info.enabled)return `${info.account?.name||'Connected account'} is connected but publishing is off.`;
  return `${info.account?.name||'Account'} is enabled for automatic publishing.`;
}
function providerBadge(info){return !info.configured?'bad':info.enabled?'good':info.connected?'warn':''}

function renderTemplatesPage(){
  const panel=$('#view-templates'),d=data();if(!panel||!d)return;
  const templates=d.templates||[], selected=d.selectedTemplate||templates[0]||{};
  const custom=templates.filter(t=>!t.builtIn).length;
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.style} Studio templates</span><h1>One look for every clip.</h1><p>Pick the default caption style, duplicate a look, and apply it to existing clips without opening the editor.</p></div><div class="dc-studio-actions"><button class="dc-btn" data-dc-nav="editor">Open editor</button><button class="dc-btn secondary" data-apply-template="${esc(selected.id||'')}">Apply default to clips</button></div></section><div class="dc-studio-strip"><div class="dc-studio-stat"><strong>${templates.length}</strong><span>saved templates</span></div><div class="dc-studio-stat"><strong>${custom}</strong><span>custom looks</span></div><div class="dc-studio-stat"><strong>${esc(selected.name||'None')}</strong><span>current default</span></div></div><div class="dc-template-grid">${templates.map(templateCard).join('')||`<div class="dc-empty"><strong>No templates yet</strong><span>Save a look from the editor to reuse it here.</span></div>`}</div></div>`;
  requestAnimationFrame(()=>animatePanel(panel));
}
function templateCard(t){
  const selected=DATA?.selectedTemplate?.id===t.id;
  return `<article class="dc-template-card"><div class="dc-template-preview"><div class="dc-template-caption"><span>${esc(t.caption?.highlightStyle==='serif-italic'?'Modern':'BOLD')}</span><br><span style="font-size:.72em;color:${esc(t.caption?.highlightColor||'#fff')}">${esc(shortText(t.name||'Template',18))}</span></div></div><div class="dc-template-card-body"><div style="display:flex;align-items:center;gap:8px;justify-content:space-between"><h3>${esc(t.name||'Template')}</h3><span class="dc-pill ${selected?'good':''}">${selected?'Default':t.builtIn?'Built-in':'Custom'}</span></div><p>${esc(t.builtIn?'Protected built-in style. Duplicate or save from the editor to make your own version.':'Custom template. You can use it as default, duplicate it or delete it.')}</p><div class="dc-template-actions"><button class="dc-btn" data-use-template="${esc(t.id)}" ${selected?'disabled':''}>Set default</button><button class="dc-btn secondary" data-apply-template="${esc(t.id)}">Apply all</button><button class="dc-btn secondary" data-duplicate-template="${esc(t.id)}">Duplicate</button><button class="dc-btn danger" data-delete-template="${esc(t.id)}" ${t.builtIn?'disabled':''}>Delete</button></div></div></article>`;
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
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.analytics} Studio insights</span><h1>Clip quality before social analytics.</h1><p>Until TikTok and Instagram performance data is connected, this page focuses on the signals DeenClipped already knows: scores, approvals, failed jobs and publishing readiness.</p></div><div class="dc-studio-actions"><button class="dc-btn" data-dc-nav="review">Review clips</button><button class="dc-btn secondary" data-dc-nav="projects">Open projects</button></div></section><div class="dc-studio-strip"><div class="dc-studio-stat"><strong>${clips.length}</strong><span>clips generated</span></div><div class="dc-studio-stat"><strong>${avg}</strong><span>average score</span></div><div class="dc-studio-stat"><strong>${approved}</strong><span>approved / scheduled</span></div><div class="dc-studio-stat"><strong>${posted}</strong><span>posted clips</span></div></div><div class="dc-insight-grid"><section class="dc-insight-panel"><h2>Quality signals</h2>${qualityRow('Strong hooks',hookStrong,clips.length)}${qualityRow('Waiting review',waiting,clips.length)}${qualityRow('Approved flow',approved,clips.length)}${qualityRow('Needs attention',failed,Math.max(1,failed+clips.length))}</section><section class="dc-insight-panel"><h2>Best next actions</h2><div class="dc-studio-roadmap"><div class="dc-road-step"><span>${ICON.review}</span><div><strong>Approve the strongest clips</strong><em>${waiting} clips are waiting in Clip Review.</em></div></div><div class="dc-road-step"><span>${ICON.style}</span><div><strong>Keep one template live</strong><em>${esc(d.selectedTemplate?.name||'No template selected')}</em></div></div><div class="dc-road-step"><span>${ICON.social}</span><div><strong>Connect platforms</strong><em>${connectedPlatformCount(d)} publishing destinations connected.</em></div></div></div></section></div></div>`;
  requestAnimationFrame(()=>animatePanel(panel));
}
function qualityRow(label,value,total){const pct=Math.max(0,Math.min(100,Math.round(Number(value||0)/Math.max(1,Number(total||1))*100)));return `<div class="dc-quality-row"><span>${esc(label)}</span><div class="dc-quality-bar"><i style="width:${pct}%"></i></div><b>${pct}%</b></div>`}
function connectedPlatformCount(d){const providers=d.social?.providers||{};return ['youtube','tiktok','instagram','facebook'].filter(p=>providerInfo(p).connected||providers[p]?.connected).length}
function renderConnections(){
  const panel=$('#view-publishing'),d=data();if(!panel||!d)return;
  const providers=['youtube','tiktok','instagram','facebook'].map(providerInfo);
  const connected=providers.filter(p=>p.connected).length, enabled=providers.filter(p=>p.enabled).length;
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.social} Platforms</span><h1>Connect once, publish everywhere.</h1><p>Manage TikTok, YouTube, Instagram and Facebook from one visual command page.</p></div><div class="dc-manage-metrics"><span><b>${connected}</b><em>connected</em></span><span><b>${enabled}</b><em>enabled</em></span><span><b>${d.directPublishingEnabled?'On':'Off'}</b><em>server flag</em></span></div></section><div class="dc-manage-grid">${providers.map(connectionCard).join('')}</div><section class="dc-settings-panel"><h2>Automatic posting destinations</h2><p>Choose which connected platforms DeenClipped can use when clips are approved or scheduled.</p><div class="dc-settings-form">${providers.map(p=>`<label class="dc-switch-row"><span><strong>${esc(providerTitle(p.provider))}</strong><span>${esc(p.account?.name||'No account selected')}</span></span><input type="checkbox" id="dcPub_${esc(p.provider)}" ${p.enabled?'checked':''} ${!p.connected?'disabled':''}></label>`).join('')}<button class="dc-btn wide" id="dcSavePublishing">Save publishing rules</button></div></section></div>`;
  $('#dcSavePublishing').onclick=savePublishingRules;
  requestAnimationFrame(()=>animatePanel(panel));
}
function connectionCard(info){
  const connectLabel=info.connected?'Reconnect':'Connect';
  const account=info.account?.name||'No account linked';
  return `<article class="dc-manage-card"><div class="dc-manage-card-top"><span class="dc-manage-logo dc-social-logo ${esc(info.provider)}">${socialSvg(info.provider)}</span><div class="dc-manage-copy"><strong>${esc(providerTitle(info.provider))}</strong><span>${esc(providerSummary(info))}</span></div><span class="dc-pill ${providerBadge(info)}">${info.enabled?'Enabled':info.connected?'Connected':info.configured?'Not connected':'Setup'}</span></div><div class="dc-manage-list"><div class="dc-manage-row"><div><strong>${esc(account)}</strong><span>${info.status.lastTestAt?`Last tested ${formatRelative(info.status.lastTestAt)}`:info.status.lastTestError?`Test failed: ${shortError(info.status.lastTestError)}`:'Run a test after connecting.'}</span></div></div></div><div class="dc-manage-actions"><button class="dc-btn" data-social-connect="${esc(info.connectProvider)}">${connectLabel}</button><button class="dc-btn secondary" data-social-test="${esc(info.connectProvider)}" ${!info.connected?'disabled':''}>Test</button><button class="dc-btn danger" data-social-disconnect="${esc(info.connectProvider)}" ${!info.connected?'disabled':''}>Disconnect</button></div></article>`;
}
async function connectSocial(provider){try{const result=await callApi(`/api/social/${encodeURIComponent(provider)}/connect`,{method:'POST'});if(result.url)location.href=result.url;else notify('Connect URL was not returned','bad')}catch(e){notify(e.message,'bad')}}
async function testSocial(provider){try{await callApi(`/api/social/${encodeURIComponent(provider)}/test`,{method:'POST',body:JSON.stringify({})});notify('Connection test passed');await refreshData();renderConnections()}catch(e){notify(e.message,'bad');await refreshData();renderConnections()}}
async function disconnectSocial(provider){if(!confirm(`Disconnect ${provider}?`))return;try{await callApi(`/api/social/${encodeURIComponent(provider)}/disconnect`,{method:'POST'});notify('Disconnected');await refreshData();renderConnections()}catch(e){notify(e.message,'bad')}}
async function savePublishingRules(){
  const d=data()||{}, current=d.publishingSettings||{};
  const next={enabled:false,youtube:{...(current.youtube||{}),enabled:$('#dcPub_youtube')?.checked||false},instagram:{...(current.instagram||{}),enabled:$('#dcPub_instagram')?.checked||false,shareToFeed:true},facebook:{...(current.facebook||{}),enabled:$('#dcPub_facebook')?.checked||false},tiktok:{...(current.tiktok||{}),enabled:$('#dcPub_tiktok')?.checked||false,allowComments:current.tiktok?.allowComments!==false,allowDuet:Boolean(current.tiktok?.allowDuet),allowStitch:Boolean(current.tiktok?.allowStitch)}};
  next.enabled=['youtube','instagram','facebook','tiktok'].some(p=>next[p].enabled);
  ['youtube','instagram','facebook','tiktok'].forEach(p=>{const info=providerInfo(p);if(info.account&&!next[p].accountId)next[p].accountId=info.account.id});
  try{await callApi('/api/publishing-settings',{method:'POST',body:JSON.stringify(next)});notify('Publishing rules saved');await refreshData();renderConnections()}catch(e){notify(e.message,'bad')}
}
function renderAudioLibrary(){
  const panel=$('#view-music'),d=data();if(!panel||!d)return;
  const tracks=d.tracks||[], settings=d.musicSettings||{};
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.music} Nasheeds</span><h1>Clean background audio for every render.</h1><p>Upload nasheed tracks, preview them, remove old ones and keep the mix low under the speaker.</p></div><div class="dc-manage-metrics"><span><b>${tracks.length}</b><em>tracks</em></span><span><b>${settings.volumePercent||13}%</b><em>volume</em></span><span><b>${settings.shuffle!==false?'On':'Off'}</b><em>shuffle</em></span></div></section><div class="dc-settings-grid"><section class="dc-settings-panel"><h2>Upload nasheed</h2><p>Add a clean MP3, M4A, WAV or OGG track. It can rotate through new renders.</p><div class="dc-upload-zone"><input type="file" id="dcMusicFile" accept="audio/*"><button class="dc-btn" id="dcUploadMusic">Upload track</button></div></section><section class="dc-settings-panel"><h2>Global audio level</h2><p>Keep this low so speech stays clear.</p><div class="dc-settings-form"><label class="wide">Music volume %<input type="number" min="1" max="50" id="dcMusicVolume" value="${esc(settings.volumePercent||13)}"></label><button class="dc-btn wide" id="dcSaveMusicSettings">Save audio settings</button></div></section></div><div class="dc-manage-grid">${tracks.length?tracks.map(trackCard).join(''):`<div class="dc-review-empty-pro"><div><div class="dc-empty-icon">${ICON.music}</div><strong>No nasheed tracks yet</strong><p>Add a track so rendered clips have consistent background audio.</p></div></div>`}</div></div>`;
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
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.settings} Studio settings</span><h1>Real controls for generation and posting.</h1><p>Tune clip generation, automatic approval behaviour and YouTube downloader cookies without digging through plain text panels.</p></div><div class="dc-manage-metrics"><span><b>${auto.enabled?'On':'Off'}</b><em>automation</em></span><span><b>${auto.minimumScore||80}+</b><em>score</em></span><span><b>${clip.clipMaxSeconds||60}s</b><em>max length</em></span></div></section><div class="dc-settings-grid"><section class="dc-settings-panel"><h2>Clip generation</h2><p>These defaults apply to new lecture imports.</p><div class="dc-settings-form"><label>Clips per lecture<input type="number" min="1" max="30" id="dcSetClipCount" value="${esc(clip.clipsPerVideo||8)}"></label><label>Minimum seconds<input type="number" min="3" max="180" id="dcSetMinSec" value="${esc(clip.clipMinSeconds||30)}"></label><label>Maximum seconds<input type="number" min="3" max="180" id="dcSetMaxSec" value="${esc(clip.clipMaxSeconds||60)}"></label><button class="dc-btn wide" id="dcSaveClipSettings">Save generation settings</button></div></section><section class="dc-settings-panel"><h2>Automation rules</h2><p>Controls which generated clips are allowed into the automatic workflow.</p><div class="dc-settings-form"><label class="dc-switch-row wide"><span><strong>Automation enabled</strong><span>Approve strong clips automatically</span></span><input type="checkbox" id="dcAutoEnabled" ${auto.enabled?'checked':''}></label><label>Minimum score<input type="number" min="1" max="100" id="dcAutoScore" value="${esc(auto.minimumScore||80)}"></label><label>Minimum quality<input type="number" min="1" max="100" id="dcAutoQuality" value="${esc(auto.minimumQuality||72)}"></label><label>Max per project<input type="number" min="1" max="20" id="dcAutoMax" value="${esc(auto.maxPerProject||4)}"></label><label class="dc-switch-row"><span><strong>Review required</strong><span>Keep manual check before posting</span></span><input type="checkbox" id="dcReviewRequired" ${auto.skipReviewRequired===false?'checked':''}></label><button class="dc-btn wide" id="dcSaveAutomation">Save automation</button></div></section></div><section class="dc-settings-panel"><h2>YouTube downloader cookies</h2><p>Only use this for your private app. Uploading valid signed-in cookies helps Render download videos when YouTube blocks server traffic.</p><div class="dc-upload-zone"><input type="file" id="dcCookieFile" accept=".txt,text/plain"><div class="dc-manage-actions"><button class="dc-btn" id="dcUploadCookies">Upload cookies.txt</button><button class="dc-btn danger" id="dcDeleteCookies">Remove cookies</button></div></div></section></div>`;
  $('#dcSaveClipSettings').onclick=saveClipSettingsPanel;
  $('#dcSaveAutomation').onclick=saveAutomationPanel;
  $('#dcUploadCookies').onclick=uploadCookiesPanel;
  $('#dcDeleteCookies').onclick=deleteCookiesPanel;
  requestAnimationFrame(()=>animatePanel(panel));
}
async function saveClipSettingsPanel(){try{await callApi('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcSetClipCount')?.value||8),clipMinSeconds:Number($('#dcSetMinSec')?.value||30),clipMaxSeconds:Number($('#dcSetMaxSec')?.value||60)})});notify('Generation settings saved');await refreshData();renderSettingsPage()}catch(e){notify(e.message,'bad')}}
async function saveAutomationPanel(){try{await callApi('/api/automation-settings',{method:'POST',body:JSON.stringify({enabled:$('#dcAutoEnabled')?.checked,minimumScore:Number($('#dcAutoScore')?.value||80),minimumQuality:Number($('#dcAutoQuality')?.value||72),maxPerProject:Number($('#dcAutoMax')?.value||4),skipReviewRequired:!$('#dcReviewRequired')?.checked})});notify('Automation saved');await refreshData();renderSettingsPage()}catch(e){notify(e.message,'bad')}}
async function uploadCookiesPanel(){const file=$('#dcCookieFile')?.files?.[0];if(!file)return notify('Choose cookies.txt first','bad');try{const contents=await file.text();await callApi('/api/admin/youtube-cookies',{method:'POST',body:JSON.stringify({contents})});notify('YouTube cookies uploaded')}catch(e){notify(e.message,'bad')}}
async function deleteCookiesPanel(){if(!confirm('Remove YouTube downloader cookies?'))return;try{await callApi('/api/admin/youtube-cookies',{method:'DELETE'});notify('YouTube cookies removed')}catch(e){notify(e.message,'bad')}}
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
function renderCurrent(){if(currentView==='home')renderHome();if(currentView==='projects')renderProjects();if(currentView==='review')renderReview();if(currentView==='editor')ensureEditor();if(currentView==='publishing')renderConnections();if(currentView==='templates')renderTemplatesPage();if(currentView==='music')renderAudioLibrary();if(currentView==='insights')renderInsightsPage();if(currentView==='automation')renderSettingsPage()}
async function refreshData(){if(typeof refresh==='function')return refresh();try{DATA=await callApi('/api/state')}catch{}}
function hexAlpha(hex,alpha){const value=String(hex||'#000000').replace('#','');if(!/^[0-9a-fA-F]{6}$/.test(value))return `rgba(0,0,0,${alpha})`;const n=parseInt(value,16);return `rgba(${(n>>16)&255},${(n>>8)&255},${n&255},${alpha})`}
function formatDuration(ms){const s=Math.max(0,Math.round(Number(ms||0)/1000));return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`}
function formatClock(sec,decimal=false){const n=Math.max(0,Number(sec||0)),m=Math.floor(n/60),s=decimal?n%60:Math.floor(n%60);return decimal?`${m}:${s.toFixed(1).padStart(4,'0')}`:`${m}:${String(s).padStart(2,'0')}`}
function formatDate(value){if(!value)return'—';return new Intl.DateTimeFormat('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(Number(value)))}
function formatRelative(value){const diff=Date.now()-Number(value||0);if(diff<60000)return'Just now';if(diff<3600000)return`${Math.round(diff/60000)}m ago`;if(diff<86400000)return`${Math.round(diff/3600000)}h ago`;return`${Math.round(diff/86400000)}d ago`}
function statusName(value){const map={queued:'Queued',processing:'Processing',done:'Ready',completed:'Ready',waiting:'Ready to review',approved:'Approved',scheduled:'Scheduled',publishing:'Publishing',posted:'Posted',publish_failed:'Publish failed',failed:'Failed',ready:'Ready'};return map[value]||String(value||'Draft').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase())}

function sync(){
  injectShell();
  const live=Boolean($('#app')&&!$('#app').classList.contains('hide'));
  $('#dcSidebar').style.display=live?'flex':'none';$('#dcTopbar').style.display=live?'flex':'none';
  if(!live||!data())return;
  renderSidebarLive();
  const jobs=activeJobs(),health=$('#dcHealth');health.className=`dc-health ${jobs.length?'busy':!data().readiness?.ready?'bad':''}`;$('span',health).textContent=jobs.length?`${jobs.length} active`:data().readiness?.ready?'Ready':'Setup needed';
  const signature=JSON.stringify({p:(data().projects||[]).map(p=>[p.id,p.status,p.progress,p.moreJob?.status,p.moreJob?.progress]),c:(data().clips||[]).map(c=>[c.id,c.status,c.scheduledAt,c.postedAt,c.rerender?.status]),r:(data().rerenderJobs||[]).map(r=>[r.id,r.status,r.progress]),s:data().social?.providers});
  if(signature!==lastDataSignature){lastDataSignature=signature;if(currentView!=='editor'||!editor.dirty)renderCurrent();else{renderTimeline();}}
}
function boot(){injectShell();setTimeout(()=>go('home'),80);setInterval(sync,900)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
