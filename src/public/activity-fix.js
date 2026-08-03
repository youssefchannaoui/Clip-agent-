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

const NAV = [
  ['home','Home','home'], ['projects','Projects','projects'], ['review','Clip Review','review'],
  ['editor','Editor','editor'], ['schedule','Publish','publish'], ['insights','Analytics','analytics']
];
const MANAGE = [['publishing','Connections','social'], ['music','Audio library','music'], ['automation','Settings','settings']];
const CUSTOM = new Set(['home','projects','review','editor']);

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
`;

function injectShell(){
  if (shellReady) return;
  shellReady = true;
  const style = document.createElement('style');
  style.id = 'dcPhase4Styles'; style.textContent = css + v3Css + v3ProjectCss; document.head.appendChild(style);
  document.body.classList.add('dc-app');

  const side = document.createElement('aside'); side.id = 'dcSidebar';
  side.innerHTML = `<div id="dcBrand"><div class="dc-logo"><svg viewBox="0 0 24 26" fill="none"><path d="M3.2 25V11.4C3.2 6.6 12 1 12 1s8.8 5.6 8.8 10.4V25Z" stroke="currentColor" stroke-width="1.7"/><path d="M10 11.2 15.4 14.6 10 18Z" fill="currentColor"/></svg></div><div class="dc-brand-copy"><strong>DeenClipped</strong><span>AI clip workspace</span></div></div><div class="dc-nav-scroll"><div class="dc-nav-label">Workspace</div>${NAV.map(([v,l,i])=>navButton(v,l,i)).join('')}<div class="dc-sidebar-live" id="dcSidebarLive"></div><div class="dc-nav-label">Manage</div>${MANAGE.map(([v,l,i])=>navButton(v,l,i)).join('')}</div><div class="dc-sidebar-bottom"><button class="dc-collapse" id="dcCollapse"><span class="dc-nav-icon">${ICON.collapse}</span><span>Collapse sidebar</span></button></div>`;

  const top = document.createElement('header'); top.id = 'dcTopbar';
  top.innerHTML = `<button class="dc-mobile-menu dc-svg" id="dcMobileMenu" type="button" aria-label="Open menu">${ICON.menu}</button><div class="dc-page-title"><strong id="dcPageName">Home</strong><span id="dcPageSub">Everything important in one place</span></div><div class="dc-global-search">${ICON.search}<input id="dcGlobalSearch" placeholder="Search projects and clips"><div class="dc-search-results" id="dcSearchResults"></div></div><div class="dc-top-actions"><div class="dc-health" id="dcHealth"><i></i><span>Checking</span></div><button class="dc-btn secondary dc-tour-launch" id="dcTourLaunch" type="button">Guided demo</button><button class="dc-btn" id="dcNewProject"><span>＋ New project</span></button></div>`;

  const work = document.createElement('div'); work.id = 'dcWork';
  work.innerHTML = `<span class="dc-spinner"></span><div><strong>Working…</strong><span>Saving changes</span></div>`;
  const shade = document.createElement('button'); shade.id = 'dcShade'; shade.type='button'; shade.setAttribute('aria-label','Close menu');
  document.body.append(side, top, shade, work);

  const main = $('.main-col');
  if (main) {
    for (const name of ['home','projects','review','editor']) {
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
  const schedule = event.target.closest('[data-schedule-clip]'); if (schedule) { scheduleClip(schedule.dataset.scheduleClip); return; }
  const approve = event.target.closest('[data-approve-clip]'); if (approve) { approveClip(approve.dataset.approveClip); return; }
  const post = event.target.closest('[data-post-clip]'); if (post) { postClip(post.dataset.postClip); return; }
  const discard = event.target.closest('[data-delete-clip]'); if (discard) { deleteClip(discard.dataset.deleteClip); return; }
  const retry = event.target.closest('[data-retry-project]'); if (retry) { retryProject(retry.dataset.retryProject); return; }
  const more = event.target.closest('[data-more-project]'); if (more) { generateMore(more.dataset.moreProject); return; }
  const delProject = event.target.closest('[data-delete-project]'); if (delProject) { deleteProject(delProject.dataset.deleteProject); return; }
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
    schedule:['Publish','Scheduling and platform delivery'], insights:['Analytics','Content and publishing performance'],
    publishing:['Connections','Connected publishing destinations'], music:['Audio library','Nasheed tracks and volume'],
    automation:['Settings','Generation rules and system health']
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
  const waiting = clips.filter(c=>c.status==='waiting').length, scheduled = clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length, posted = clips.filter(c=>c.status==='posted').length;
  const selectedTemplate=d.selectedTemplate?.name || d.templateDraft?.name || 'Choose template';
  panel.innerHTML = `<section class="dc-v3-hero slim" data-tour="home-hero"><div><div class="dc-v3-kicker">${ICON.scissors} V3 workspace</div><h1 class="dc-v3-title">Clean clips, faster review, simpler publishing.</h1><p class="dc-v3-copy">Start with a lecture, review the strongest moments, edit the look, then publish without hunting through walls of text.</p><div class="dc-v3-actions"><button class="dc-btn" id="dcHeroCreate">Start with YouTube</button><button class="dc-btn secondary" id="dcHeroTour">Guided demo</button><button class="dc-btn secondary" data-dc-nav="review">Open Clip Review</button></div></div><div class="dc-v3-phone-wall" aria-label="Recent clip thumbnails">${heroThumbs(clips)}</div></section><section class="dc-card dc-create-card v3" data-tour="create-form"><div class="dc-create-grid"><input id="dcCreateUrl" placeholder="Paste YouTube or video URL"><select id="dcCreateTemplate" data-tour="template-picker">${(d.templates||[]).map(t=>`<option value="${esc(t.id)}" ${t.id===d.selectedTemplate?.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select><select id="dcCreateCount"><option>4</option><option selected>8</option><option>12</option><option>16</option></select><select id="dcCreateDuration"><option value="15,45">15–45 sec</option><option value="30,60" selected>30–60 sec</option><option value="45,90">45–90 sec</option></select><button class="dc-btn" id="dcGenerate" data-tour="generate-button">Generate clips</button></div></section><div class="dc-home-metrics v3 tight">${metric(projects.length,'Lectures')}${metric(clips.length,'Clips')}${metric(waiting,'Review')}${metric(scheduled,'Scheduled')}${metric(posted,'Posted')}</div><div class="dc-home-quick"><button class="dc-v3-source" type="button" id="dcSourceYouTube"><span class="dc-v3-platform youtube">${socialSvg('youtube')}</span><strong>YouTube import</strong><span>Paste one or more lecture links.</span></button><button class="dc-v3-source" type="button" data-dc-nav="review"><span class="dc-v3-platform template">${ICON.review}</span><strong>Clip Review</strong><span>${waiting} clips need approval.</span></button><button class="dc-v3-source" type="button" data-dc-nav="editor"><span class="dc-v3-platform template">${ICON.style}</span><strong>${esc(selectedTemplate)}</strong><span>Default look for renders.</span></button><button class="dc-v3-source" type="button" data-dc-nav="publishing"><span class="dc-v3-platform publish">${ICON.social}</span><strong>Connections</strong><span>TikTok, Instagram, Facebook and YouTube.</span></button></div><div class="dc-home-main-grid"><div class="dc-stack"><section class="dc-card dc-card-pad v3-card" data-tour="happening-now"><div class="dc-card-head"><div><h2>Happening now</h2><p>Only current work and latest result.</p></div><span class="dc-pill ${jobs.length?'warn':'good'}">${jobs.length?`${jobs.length} live`:'All clear'}</span></div><div class="dc-row-list compact">${jobs.length?jobs.slice(0,3).map(jobRow).join(''):latestActivity(d)}</div></section><section class="dc-card dc-card-pad v3-card"><div class="dc-card-head"><div><h2>Recent projects</h2><p>Continue from the last lecture.</p></div><button class="dc-btn secondary" data-dc-nav="projects">View all</button></div><div class="dc-row-list compact">${recentProjects(projects,clips)}</div></section></div><div class="dc-home-side-stack"><section class="dc-card dc-card-pad v3-card" data-tour="platform-cards"><div class="dc-card-head"><div><h2>Platform connections</h2><p>Ready before posting.</p></div><button class="dc-btn secondary" data-dc-nav="publishing">Manage</button></div><div class="dc-social-grid clean">${socialCards(d)}</div></section><section class="dc-card dc-card-pad v3-card"><div class="dc-card-head"><div><h2>Upcoming posts</h2><p>${scheduled} ready or scheduled.</p></div><button class="dc-btn secondary" data-dc-nav="schedule">Open publish</button></div><div class="dc-row-list compact">${upcomingRows(clips)}</div></section><section class="dc-card dc-card-pad v3-card"><div class="dc-card-head"><div><h2>Needs attention</h2><p>Problems only.</p></div></div><div class="dc-row-list compact">${attentionRows(d)}</div></section></div></div>`;
  $('#dcGenerate').onclick=generateProject; $('#dcHeroCreate').onclick=()=>$('#dcCreateUrl').focus(); $('#dcSourceYouTube').onclick=()=>$('#dcCreateUrl').focus(); $('#dcHeroTour').onclick=()=>openGuidedTour(0);
  requestAnimationFrame(()=>animatePanel(panel));
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
  panel.innerHTML=`<div class="dc-page-head"><div><h1>Clip Review</h1><p>Approve, edit or discard the AI-selected clips before posting.</p></div></div><div class="dc-review-toolbar"><span class="dc-pill ${waiting.length?'warn':'good'}">${waiting.length} waiting</span><span class="spacer"></span><button class="dc-btn secondary" id="dcApproveVerified" ${!waiting.length?'disabled':''}>Approve verified</button><button class="dc-btn" id="dcScheduleAll" ${!waiting.length?'disabled':''}>Schedule all</button></div><div class="dc-review-list">${waiting.length?waiting.map(reviewRow).join(''):`<div class="dc-empty v3"><div><div class="dc-empty-icon">${ICON.check}</div><strong>Clip review is clear</strong><p>New generated clips will appear here before they are scheduled.</p></div></div>`}</div>`;
  $('#dcApproveVerified').onclick=approveVerified;
  $('#dcScheduleAll').onclick=()=>scheduleMany(waiting.map(c=>c.id));
}
function reviewRow(c){
  return `<article class="dc-review-item"><button class="dc-review-media" type="button" data-edit-clip="${esc(c.id)}">${c.thumbUrl?`<img src="${authedUrl(c.thumbUrl)}" alt="${esc(c.title||'Clip')} thumbnail">`:''}<span class="dc-review-score">${Math.round(c.score||0)}</span></button><div class="dc-review-copy"><h3>${esc(c.title||'Untitled clip')}</h3><p>${formatDuration(c.durationMs)} · quality ${Math.round(c.quality||c.score||0)}/100 · ${statusName(c.status)}</p></div><div class="dc-review-actions"><button class="dc-btn" data-approve-clip="${esc(c.id)}">Approve</button><button class="dc-btn secondary" data-edit-style-clip="${esc(c.id)}">Edit style</button><button class="dc-btn secondary" data-edit-video-clip="${esc(c.id)}">Edit video</button><button class="dc-btn secondary" data-schedule-clip="${esc(c.id)}">Schedule</button><button class="dc-btn danger" data-delete-clip="${esc(c.id)}">Reject</button></div></article>`;
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
  [...NAV,...MANAGE].filter(x=>x[1].toLowerCase().includes(query)).slice(0,4).forEach(x=>items.push({type:'page',id:x[0],title:x[1],sub:'Open page'}));
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
function renderSidebarLive(){
  const box=$('#dcSidebarLive'),d=data();if(!box||!d)return;
  const jobs=activeJobs();const clips=d.clips||[];const waiting=clips.filter(c=>c.status==='waiting').length;const next=clips.filter(c=>Number(c.scheduledAt)>Date.now()).sort((a,b)=>a.scheduledAt-b.scheduledAt)[0];
  const current=jobs[0];
  const currentRow=current?`<div class="dc-mini-job"><span class="dc-mini-job-icon">${current.kind==='publish'?ICON.publish:current.kind==='render'?ICON.editor:ICON.scissors}</span><div><strong>${esc(shortText(current.title,28))}</strong><span>${esc(shortText(current.stage,26))}${Number.isFinite(current.progress)?` · ${Math.round(current.progress)}%`:''}</span></div></div>`:`<div class="dc-mini-job"><span class="dc-mini-job-icon">${ICON.home}</span><div><strong>${waiting?`${waiting} to review`:'All clear'}</strong><span>${next?`Next ${formatDate(next.scheduledAt)}`:'No active job'}</span></div></div>`;
  const nextRow=next?`<div class="dc-mini-job"><span class="dc-mini-job-icon">${ICON.publish}</span><div><strong>Next post</strong><span>${formatDate(next.scheduledAt)}</span></div></div>`:'';
  box.innerHTML=`<div class="dc-sidebar-live-head"><div><strong>Happening now</strong><br><span>${jobs.length?'Live job':'Workflow status'}</span></div><i class="dc-live-orb ${jobs.length?'busy':''}"></i></div>${currentRow}${nextRow}<div class="dc-sidebar-status-pills"><div class="dc-side-pill"><b>${waiting}</b><span>review</span></div><div class="dc-side-pill"><b>${clips.filter(c=>['approved','scheduled','publishing'].includes(c.status)).length}</b><span>scheduled</span></div></div><div class="dc-sidebar-live-foot"><button class="dc-btn secondary" data-dc-nav="review">Review</button><button class="dc-btn secondary" data-dc-nav="schedule">Publish</button></div>`;
}
function renderCurrent(){if(currentView==='home')renderHome();if(currentView==='projects')renderProjects();if(currentView==='review')renderReview();if(currentView==='editor')ensureEditor()}
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
