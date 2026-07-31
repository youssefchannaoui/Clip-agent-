(() => {
'use strict';
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const E=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
const D=()=>typeof DATA!=='undefined'?DATA:null;
const A=async(url,opt={})=>{if(typeof api==='function')return api(url,opt);const h={'Content-Type':'application/json',...(opt.headers||{})};if(typeof PW!=='undefined'&&PW)h['x-app-password']=PW;const r=await fetch(url,{...opt,headers:h}),j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error||r.statusText);return j};
const T=(m,t='good')=>typeof toast==='function'?toast(m,t):console[t==='bad'?'error':'log'](m);
const U=url=>typeof withPw==='function'?withPw(url):(typeof PW!=='undefined'&&PW?`${url}${url.includes('?')?'&':'?'}pw=${encodeURIComponent(PW)}`:url);
const C=(n,a,b)=>Math.min(b,Math.max(a,Number(n)||0));
const clone=x=>JSON.parse(JSON.stringify(x||{}));
const icons={home:'⌂',projects:'▣',queue:'☷',editor:'✎',schedule:'◷',insights:'▥',publishing:'↗',music:'♪',automation:'⚙'};
const nav=[['home','Home'],['projects','Projects'],['queue','Review clips'],['editor','Editor'],['schedule','Publish'],['insights','Analytics']];const manageNav=[['publishing','Social accounts'],['music','Music'],['automation','Settings']];
let view='home',clipId='',projectId='',projectFilter='all',projectSort='score',projectQuery='',draft=null,dirty=false,tab='captions',shell=false,lastSig='';
const style=`
:root{--dc-bg:#09090b;--dc-p:#121214;--dc-p2:#19191c;--dc-p3:#222226;--dc-ln:#2b2b30;--dc-ln2:#3b3b42;--dc-t:#f7f7f8;--dc-m:#a0a0aa;--dc-s:#74747d;--dc-a:#d9b478;--dc-a2:#efd4a5;--dc-g:#55c58b;--dc-w:#e4aa5c;--dc-b:#ee6878;--dc-side:238px;--dc-top:68px}
*{box-sizing:border-box}.dc-live{background:var(--dc-bg)!important}.dc-live #app>.wrap{max-width:none!important;width:auto!important;margin:0!important;padding:var(--dc-top) 26px 100px calc(var(--dc-side) + 26px)!important}.dc-live .top,.dc-live .side{display:none!important}.dc-live .shell{display:block!important;padding-top:26px!important}.dc-live .main-col{width:100%!important}.dc-live .panel{max-width:1500px;margin:auto}.dc-live .slab{background:var(--dc-p)!important;border-color:var(--dc-ln)!important;border-radius:11px!important}
#dcSide{position:fixed;inset:0 auto 0 0;width:var(--dc-side);z-index:180;background:#0d0d0f;border-right:1px solid var(--dc-ln);display:flex;flex-direction:column}#dcBrand{height:var(--dc-top);display:flex;align-items:center;gap:11px;padding:0 17px;border-bottom:1px solid var(--dc-ln)}.dc-logo{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;color:var(--dc-a);font-size:20px;background:#d9b47812;border:1px solid #d9b47834}.dc-brand strong{display:block;font:600 16px/1.2 Outfit,Inter,sans-serif}.dc-brand span{display:block;color:var(--dc-s);font-size:10px;margin-top:2px}.dc-nav{padding:14px 10px;overflow:auto}.dc-nav-label{padding:10px 10px 7px;color:var(--dc-s);font-size:9px;font-weight:700;letter-spacing:.13em;text-transform:uppercase}.dc-nav button{width:100%;height:42px;display:flex;align-items:center;gap:11px;padding:0 11px;border-radius:8px;color:var(--dc-m);text-align:left}.dc-nav button:hover{background:var(--dc-p2);color:var(--dc-t)}.dc-nav button.on{background:#d9b47816;color:var(--dc-t)}.dc-nav button.on i{color:var(--dc-a)}.dc-nav i{width:20px;font-style:normal;text-align:center;font-size:18px}.dc-nav b{font-size:13px;font-weight:520;flex:1}.dc-badge{min-width:20px;height:20px;padding:0 5px;border-radius:99px;display:grid;place-items:center;background:var(--dc-p3);font-size:10px;color:var(--dc-m)}
#dcTop{position:fixed;inset:0 0 auto var(--dc-side);height:var(--dc-top);z-index:170;background:#0d0d0fee;backdrop-filter:blur(16px);border-bottom:1px solid var(--dc-ln);display:flex;align-items:center;gap:18px;padding:0 26px}.dc-top-title{min-width:185px}.dc-top-title strong{display:block;font-size:14px}.dc-top-title span{display:block;color:var(--dc-s);font-size:10px}.dc-search{position:relative;flex:1;max-width:620px}.dc-search input{height:38px!important;min-height:38px!important;padding:0 14px!important;border-radius:9px!important;background:var(--dc-p)!important}.dc-results{display:none;position:absolute;top:45px;left:0;right:0;max-height:420px;overflow:auto;background:#111113;border:1px solid var(--dc-ln2);border-radius:10px;box-shadow:0 18px 50px #0008;padding:7px}.dc-results.show{display:block}.dc-results button{width:100%;display:flex;align-items:center;gap:10px;text-align:left;color:var(--dc-t);padding:9px;border-radius:7px}.dc-results button:hover{background:var(--dc-p2)}.dc-results img{width:50px;height:34px;object-fit:cover;border-radius:5px}.dc-results strong,.dc-results span{display:block}.dc-results strong{font-size:12px}.dc-results span{color:var(--dc-m);font-size:10px}.dc-top-actions{margin-left:auto;display:flex;align-items:center;gap:9px}.dc-health{display:flex;align-items:center;gap:7px;color:var(--dc-m);font-size:11px}.dc-health i{width:7px;height:7px;border-radius:50%;background:var(--dc-g)}.dc-health.busy i{background:var(--dc-a);animation:dcp 1s infinite}.dc-health.bad i{background:var(--dc-b)}
.dc-btn{min-height:38px;display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:0 14px;border-radius:8px;background:var(--dc-a);color:#1a1308;font-size:12px;font-weight:650}.dc-btn:hover{background:var(--dc-a2)}.dc-btn.alt{background:transparent;color:var(--dc-t);border:1px solid var(--dc-ln)}.dc-btn.alt:hover{background:var(--dc-p2);border-color:var(--dc-ln2)}.dc-btn:disabled{opacity:.45}.dc-page-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:18px}.dc-page-head h1{margin:0;font-size:27px;line-height:1.15}.dc-page-head p{margin:6px 0 0;color:var(--dc-m);font-size:12px}.dc-card{background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:11px}.dc-pad{padding:18px}.dc-card-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:14px}.dc-card-head h2{margin:0;font-size:14px}.dc-card-head p{margin:3px 0 0;color:var(--dc-m);font-size:10px}.dc-pill{padding:4px 8px;border-radius:99px;background:var(--dc-p3);color:var(--dc-m);font-size:9px}.dc-pill.good{color:var(--dc-g);background:#55c58b12}.dc-pill.busy{color:var(--dc-a2);background:#d9b47813}.dc-pill.bad{color:var(--dc-b);background:#ee687812}
.dc-create{padding:22px;background:linear-gradient(135deg,#17130e,#121214 42%);border-color:#d9b47830}.dc-create h1{font-size:25px;margin:0}.dc-create p{color:var(--dc-m);font-size:11px;margin:6px 0 16px}.dc-create-row{display:grid;grid-template-columns:minmax(260px,1fr) 170px 110px 130px;gap:9px}.dc-create-row input,.dc-create-row select,.dc-inspect input,.dc-inspect select,.dc-inspect textarea{width:100%;height:40px;min-height:40px;background:#0d0d0f;border:1px solid var(--dc-ln);border-radius:8px;color:var(--dc-t);padding:0 11px}.dc-create-row textarea{grid-column:1/-1;min-height:66px;resize:vertical;background:#0d0d0f;border:1px solid var(--dc-ln);border-radius:8px;color:var(--dc-t);padding:10px 11px}.dc-home-grid{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(330px,.65fr);gap:15px;margin-top:15px}.dc-stack{display:flex;flex-direction:column;gap:15px}.dc-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.dc-metric{padding:14px;background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:10px}.dc-metric strong{display:block;font-size:20px}.dc-metric span{display:block;color:var(--dc-m);font-size:9px;margin-top:3px}.dc-now{display:flex;flex-direction:column;gap:8px}.dc-now-row{padding:11px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}.dc-now-top{display:flex;align-items:center;gap:9px}.dc-spin{width:12px;height:12px;border:2px solid var(--dc-ln2);border-top-color:var(--dc-a);border-radius:50%;animation:dcr .8s linear infinite}.dc-now-copy{flex:1;min-width:0}.dc-now-copy strong,.dc-now-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-now-copy strong{font-size:11px}.dc-now-copy span{font-size:9px;color:var(--dc-m)}.dc-progress{height:3px;background:var(--dc-ln);border-radius:9px;margin-top:8px;overflow:hidden}.dc-progress i{display:block;height:100%;background:var(--dc-a)}.dc-empty{padding:24px;text-align:center;color:var(--dc-m);font-size:10px;border:1px dashed var(--dc-ln);border-radius:8px}.dc-empty strong{display:block;color:var(--dc-t);font-size:12px;margin-bottom:3px}.dc-social-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}.dc-social{padding:12px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}.dc-social-top{display:flex;align-items:center;gap:8px}.dc-social-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:8px;background:var(--dc-p3);font-weight:800}.dc-social-copy{min-width:0;flex:1}.dc-social-copy strong,.dc-social-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-social-copy strong{font-size:10px}.dc-social-copy span{font-size:9px;color:var(--dc-m)}.dc-social button{width:100%;height:30px;margin-top:9px;font-size:10px}.dc-list{display:flex;flex-direction:column;gap:7px}.dc-list-row{display:flex;align-items:center;gap:10px;padding:9px;border:1px solid var(--dc-ln);border-radius:8px}.dc-list-row img{width:58px;height:38px;object-fit:cover;border-radius:5px;background:#000}.dc-list-copy{flex:1;min-width:0}.dc-list-copy strong,.dc-list-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-list-copy strong{font-size:10px}.dc-list-copy span{font-size:9px;color:var(--dc-m)}.dc-action{width:26px;height:26px;border-radius:7px;background:var(--dc-p3);color:var(--dc-t)}.dc-tools{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.dc-tool{padding:12px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}.dc-tool b{display:block;font-size:10px}.dc-tool span{display:block;color:var(--dc-m);font-size:9px;margin-top:4px;line-height:1.45}
.dc-editor-layout{height:calc(100vh - 119px);min-height:650px;display:grid;grid-template-columns:230px minmax(420px,1fr) 330px;grid-template-rows:minmax(0,1fr) 148px;border:1px solid var(--dc-ln);border-radius:11px;overflow:hidden;background:#0d0d0f}.dc-rail{grid-row:1/3;background:var(--dc-p);border-right:1px solid var(--dc-ln);display:flex;flex-direction:column}.dc-rail-head{padding:13px;border-bottom:1px solid var(--dc-ln)}.dc-rail-head strong{font-size:12px}.dc-rail-head input{width:100%;height:34px;min-height:34px;margin-top:8px;padding:0 9px;background:#0c0c0e;border:1px solid var(--dc-ln);border-radius:7px;color:var(--dc-t)}.dc-clips{padding:9px;overflow:auto}.dc-clip{width:100%;display:grid;grid-template-columns:58px minmax(0,1fr);gap:8px;padding:7px;border-radius:7px;text-align:left;color:var(--dc-t);border:1px solid transparent}.dc-clip:hover{background:var(--dc-p2)}.dc-clip.on{background:#d9b47812;border-color:#d9b47832}.dc-clip img{width:58px;height:40px;object-fit:cover;border-radius:5px}.dc-clip strong,.dc-clip span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-clip strong{font-size:9px}.dc-clip span{font-size:8px;color:var(--dc-m);margin-top:3px}.dc-stage{position:relative;display:flex;flex-direction:column;min-width:0;background:#080809}.dc-stagebar{height:50px;padding:0 14px;border-bottom:1px solid var(--dc-ln);display:flex;align-items:center;gap:8px}.dc-stagebar select{height:32px;max-width:210px;background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:7px;color:var(--dc-t);padding:0 8px}.dc-stagebar .spacer{flex:1}.dc-canvas-wrap{flex:1;display:grid;place-items:center;padding:18px;overflow:hidden;background-image:linear-gradient(45deg,#111 25%,transparent 25%),linear-gradient(-45deg,#111 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#111 75%),linear-gradient(-45deg,transparent 75%,#111 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}.dc-canvas{position:relative;height:min(63vh,620px);max-width:100%;aspect-ratio:9/16;background:#000;overflow:hidden;box-shadow:0 18px 55px #000}.dc-canvas video{width:100%;height:100%;object-fit:contain}.dc-cap{position:absolute;left:7%;right:7%;z-index:3;font-weight:800;line-height:.98;text-align:right;color:#fff;font-size:28px;-webkit-text-stroke:1.5px #000;paint-order:stroke fill}.dc-cap.top{top:13%}.dc-cap.middle{top:48%;transform:translateY(-50%)}.dc-cap.bottom{bottom:14%}.dc-cap.left{text-align:left}.dc-cap.center{text-align:center}.dc-water{position:absolute;z-index:4;color:var(--dc-a);font-size:12px;font-weight:800;letter-spacing:.08em}.dc-water.top-left{top:5%;left:5%}.dc-water.top-center{top:5%;left:50%;transform:translateX(-50%)}.dc-water.top-right{top:5%;right:5%}.dc-water.bottom-left{bottom:5%;left:5%}.dc-water.bottom-center{bottom:5%;left:50%;transform:translateX(-50%)}.dc-water.bottom-right{bottom:5%;right:5%}.dc-brandline{position:absolute;z-index:4;left:0;right:0;bottom:0;height:3px;background:var(--dc-a)}.dc-inspector{background:var(--dc-p);border-left:1px solid var(--dc-ln);display:flex;flex-direction:column;min-width:0}.dc-tabs{height:50px;display:flex;overflow:auto;border-bottom:1px solid var(--dc-ln);padding:0 8px}.dc-tabs button{min-width:max-content;padding:0 9px;color:var(--dc-m);font-size:9px;border-bottom:2px solid transparent}.dc-tabs button.on{color:var(--dc-t);border-color:var(--dc-a)}.dc-inspect{padding:14px;overflow:auto}.dc-group{margin-bottom:16px}.dc-group h3{font-size:10px;margin:0 0 9px;color:var(--dc-a2);text-transform:uppercase;letter-spacing:.08em}.dc-field{margin-bottom:9px}.dc-field label{display:flex;justify-content:space-between;gap:8px;color:var(--dc-m);font-size:9px;margin-bottom:5px}.dc-field input[type=range]{padding:0;height:24px;background:transparent;border:0}.dc-field input[type=color]{padding:3px}.dc-field textarea{height:auto;min-height:74px;padding:9px;resize:vertical}.dc-check{display:flex;align-items:center;gap:7px;color:var(--dc-m);font-size:9px}.dc-check input{width:15px;height:15px}.dc-layouts{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.dc-layouts button{padding:10px 6px;border:1px solid var(--dc-ln);border-radius:7px;color:var(--dc-m);font-size:9px}.dc-layouts button:hover{border-color:var(--dc-a);color:var(--dc-t)}.dc-timeline{grid-column:2/4;border-top:1px solid var(--dc-ln);background:var(--dc-p);padding:10px 14px}.dc-timebar{display:flex;justify-content:space-between;color:var(--dc-m);font-size:8px}.dc-track{position:relative;height:62px;margin-top:6px;background:#0d0d0f;border:1px solid var(--dc-ln);border-radius:7px;overflow:hidden;cursor:pointer}.dc-wave{position:absolute;inset:0;display:flex;align-items:center;gap:2px;padding:0 5px}.dc-wave i{flex:1;max-width:4px;background:#d9b47875;border-radius:2px}.dc-playhead{position:absolute;top:0;bottom:0;width:2px;background:var(--dc-a);left:0;pointer-events:none}.dc-editor-foot{position:fixed;left:calc(var(--dc-side) + 26px);right:26px;bottom:15px;z-index:165;display:none;align-items:center;gap:9px;padding:9px 11px;border-radius:10px;background:#111113ed;border:1px solid var(--dc-ln2);backdrop-filter:blur(12px);box-shadow:0 12px 40px #0008}.dc-editor-foot.show{display:flex}.dc-editor-foot .copy{flex:1}.dc-editor-foot strong,.dc-editor-foot span{display:block}.dc-editor-foot strong{font-size:10px}.dc-editor-foot span{font-size:8px;color:var(--dc-m)}.dc-dirty{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--dc-s);margin-right:5px}.dc-dirty.on{background:var(--dc-w)}
#dcWorkDock{position:fixed;right:16px;bottom:16px;z-index:290;min-width:280px;max-width:380px;padding:11px 13px;border-radius:10px;background:#111113ee;border:1px solid var(--dc-ln2);box-shadow:0 15px 45px #0008;display:none}#dcWorkDock.show{display:flex;gap:9px;align-items:center}#dcWorkDock strong,#dcWorkDock span{display:block}#dcWorkDock strong{font-size:10px}#dcWorkDock span{font-size:8px;color:var(--dc-m)}
@keyframes dcr{to{transform:rotate(360deg)}}@keyframes dcp{50%{opacity:.35}}
@media(max-width:1150px){.dc-editor-layout{grid-template-columns:200px minmax(360px,1fr) 300px}.dc-home-grid{grid-template-columns:1fr}.dc-create-row{grid-template-columns:1fr 150px 100px}.dc-create-row .dc-btn{grid-column:1/-1}.dc-tools{grid-template-columns:repeat(2,1fr)}}
@media(max-width:850px){:root{--dc-side:74px}.dc-brand .dc-brand,.dc-nav b,.dc-nav-label,.dc-badge{display:none}.dc-brand{justify-content:center;padding:0}.dc-nav button{justify-content:center;padding:0}.dc-live #app>.wrap{padding-left:94px!important}#dcTop{left:74px}.dc-editor-layout{height:auto;grid-template-columns:1fr;grid-template-rows:auto}.dc-rail{grid-row:auto;max-height:190px;border-right:0;border-bottom:1px solid var(--dc-ln)}.dc-clips{display:grid;grid-template-columns:repeat(3,minmax(160px,1fr))}.dc-stage{min-height:580px}.dc-inspector{border-left:0;border-top:1px solid var(--dc-ln);min-height:460px}.dc-timeline{grid-column:1}.dc-editor-foot{left:94px}.dc-metrics{grid-template-columns:repeat(2,1fr)}}
@media(max-width:620px){#dcSide{display:none}#dcTop{left:0;height:58px;padding:0 12px}.dc-top-title,.dc-search,.dc-health{display:none}.dc-live #app>.wrap{padding:64px 12px 90px!important}.dc-create-row,.dc-social-grid,.dc-tools{grid-template-columns:1fr}.dc-metrics{grid-template-columns:repeat(2,1fr)}.dc-editor-layout{border-radius:8px}.dc-clips{grid-template-columns:repeat(2,minmax(150px,1fr))}.dc-canvas{height:min(57vh,500px)}.dc-editor-foot{left:12px;right:12px}.dc-editor-foot .copy{display:none}}

/* Phase 2C: clarity, responsive library and one integrated editor */
:root{--dc-topbar:68px;--dc-safe-top:env(safe-area-inset-top,0px);--dc-top:calc(var(--dc-topbar) + var(--dc-safe-top))}#dcSide{padding-top:var(--dc-safe-top)!important}#dcBrand{height:var(--dc-topbar)!important;flex:0 0 var(--dc-topbar)}#dcTop{top:var(--dc-safe-top)!important;height:var(--dc-topbar)!important}
.dc-badge{display:none!important}.dc-menu{display:none;width:38px;height:38px;border-radius:8px;color:var(--dc-m);font-size:19px}.dc-menu:hover{background:var(--dc-p2);color:var(--dc-t)}
#dcShade{display:none;position:fixed;inset:0;z-index:176;background:#0009;border:0}.dc-manage-label{margin-top:12px}#dcMobileNav{display:none!important}
.dc-live .panel,.dc-live .panel *{min-width:0}.dc-live .head,.dc-live .sched-head,.dc-live .library-controls,.dc-live .library-browser-tools,.dc-live .intake-row{max-width:100%}
.dc-live .library-browser{position:relative!important;inset:auto!important;width:100%!important;max-width:100%!important;height:auto!important;min-height:0!important;overflow:visible!important;background:transparent!important}
.dc-live .library-browser-head{position:relative!important;top:auto!important;display:grid!important;grid-template-columns:minmax(260px,1fr) minmax(340px,520px)!important;gap:16px!important;align-items:start!important;width:100%!important;padding:0 0 16px!important;background:transparent!important}
.dc-live .library-browser-title{min-width:0!important}.dc-live .library-browser-title strong,.dc-live .library-browser-title span{display:block!important;max-width:100%!important;white-space:normal!important;overflow-wrap:anywhere!important}
.dc-live .library-browser-tools{display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr))!important;gap:8px!important;width:100%!important}.dc-live .library-browser-tools>*{width:100%!important;min-width:0!important}
.dc-live .library-browser-body{height:auto!important;max-height:none!important;overflow:visible!important;padding:0!important}.dc-live .library-clip-grid{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(235px,1fr))!important;gap:14px!important;align-items:start!important;width:100%!important}
.dc-live .library-clip{width:100%!important;min-width:0!important;max-width:none!important;overflow:hidden!important}.dc-live .library-clip-media{width:100%!important}.dc-live .library-clip-media img{width:100%!important;height:auto!important;aspect-ratio:9/16!important;object-fit:cover!important}
.dc-live .library-clip-body{min-width:0!important}.dc-live .library-clip-name,.dc-live .library-clip-sub{white-space:normal!important;overflow-wrap:anywhere!important}.dc-live .library-clip-actions{display:grid!important;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}.dc-live .library-clip-actions .btn,.dc-live .library-clip-actions a.btn{width:100%!important;min-width:0!important;padding-left:8px!important;padding-right:8px!important;white-space:normal!important;text-align:center!important}
.dc-live .library-browser-foot{position:sticky!important;left:auto!important;right:auto!important;bottom:0!important;width:100%!important;min-height:64px!important;margin-top:16px!important;padding:10px!important;display:flex!important;gap:8px!important;flex-wrap:wrap!important;background:#101012f4!important;border:1px solid var(--dc-ln)!important;border-radius:10px!important;backdrop-filter:blur(14px)!important;z-index:20!important}.dc-live .library-browser-foot .btn{flex:0 1 auto!important;min-width:130px!important}.dc-live .library-browser-count{margin-right:auto!important}
.dc-live .library-controls{display:grid!important;grid-template-columns:minmax(220px,1fr) repeat(2,minmax(145px,220px))!important;gap:9px!important}.dc-live .library-controls>*{min-width:0!important;width:100%!important}
.dc-live .lec-grid{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))!important}.dc-live .clip-actions,.dc-live .queue-actions,.dc-live .bulk-actions{display:flex!important;flex-wrap:wrap!important;gap:8px!important}.dc-live .clip-actions .btn,.dc-live .queue-actions .btn{flex:1 1 120px!important;min-width:0!important;white-space:normal!important}
.dc-editor-intro{display:flex;align-items:center;gap:12px;justify-content:space-between;margin-bottom:10px}.dc-editor-intro strong,.dc-editor-intro span{display:block}.dc-editor-intro strong{font-size:13px}.dc-editor-intro>div>span{font-size:10px;color:var(--dc-m);margin-top:2px}.dc-style-pick{display:flex;align-items:center;gap:7px;color:var(--dc-m);font-size:9px}.dc-style-pick select{min-width:170px}.dc-editor-foot{position:sticky!important;left:auto!important;right:auto!important;bottom:10px!important;margin:12px 0 0!important;width:100%!important;max-width:none!important;flex-wrap:wrap!important}.dc-editor-foot .dc-btn{flex:0 1 auto}.dc-editor-foot .copy{min-width:180px}
@media(max-width:1280px){:root{--dc-side:214px}.dc-live #app>.wrap{padding-left:calc(var(--dc-side) + 20px)!important;padding-right:20px!important}.dc-editor-layout{height:auto!important;min-height:0!important;grid-template-columns:minmax(0,1fr) 300px!important;grid-template-rows:116px minmax(540px,1fr) 124px!important}.dc-rail{grid-column:1/3!important;grid-row:1!important;border-right:0!important;border-bottom:1px solid var(--dc-ln)!important;display:grid!important;grid-template-columns:190px minmax(0,1fr)!important}.dc-rail-head{border-bottom:0!important;border-right:1px solid var(--dc-ln)!important}.dc-clips{display:flex!important;gap:7px!important;overflow-x:auto!important;overflow-y:hidden!important}.dc-clip{flex:0 0 210px!important}.dc-stage{grid-column:1!important;grid-row:2!important}.dc-inspector{grid-column:2!important;grid-row:2!important}.dc-timeline{grid-column:1/3!important;grid-row:3!important}.dc-live .library-browser-head{grid-template-columns:1fr!important}.dc-live .library-browser-tools{grid-template-columns:repeat(3,minmax(0,1fr))!important}}
@media(max-width:980px){:root{--dc-side:76px}.dc-brand{display:none!important}.dc-nav-label,.dc-nav b{display:none!important}.dc-nav button{justify-content:center!important;padding:0!important}.dc-live #app>.wrap{padding-left:96px!important}#dcTop{left:76px!important}.dc-home-grid{grid-template-columns:1fr!important}.dc-create-row{grid-template-columns:1fr 1fr!important}.dc-create-row input{grid-column:1/-1!important}.dc-create-row .dc-btn{grid-column:1/-1!important}.dc-live .library-clip-grid{grid-template-columns:repeat(auto-fit,minmax(215px,1fr))!important}.dc-live .library-controls{grid-template-columns:1fr 1fr!important}.dc-live .library-controls>:first-child{grid-column:1/-1!important}.dc-editor-layout{grid-template-columns:1fr!important;grid-template-rows:116px minmax(520px,auto) auto 124px!important}.dc-rail{grid-column:1!important}.dc-stage{grid-column:1!important;grid-row:2!important}.dc-inspector{grid-column:1!important;grid-row:3!important;border-left:0!important;border-top:1px solid var(--dc-ln)!important;min-height:0!important;max-height:none!important}.dc-timeline{grid-column:1!important;grid-row:4!important}.dc-inspect{max-height:none!important}.dc-stagebar{flex-wrap:wrap!important;height:auto!important;min-height:52px!important;padding:8px!important}.dc-stagebar .spacer{display:none!important}.dc-style-pick{flex:1 1 190px!important}.dc-style-pick select{width:100%!important;min-width:0!important}}
@media(max-width:700px){:root{--dc-side:0px;--dc-top:58px}#dcSide{transform:translateX(-102%);width:min(280px,86vw)!important;padding-top:env(safe-area-inset-top)!important;transition:transform .18s ease;box-shadow:0 18px 55px #000b}body.dc-menu-open #dcSide{transform:translateX(0)}body.dc-menu-open #dcShade{display:block}#dcTop{left:0!important;top:env(safe-area-inset-top)!important;height:58px!important;padding:0 10px!important}.dc-menu{display:grid;place-items:center}.dc-top-title{min-width:0!important;flex:1}.dc-top-title span,.dc-search,.dc-health{display:none!important}.dc-live #app>.wrap{padding:calc(58px + env(safe-area-inset-top)) 10px calc(86px + env(safe-area-inset-bottom))!important}#dcMobileNav{position:fixed!important;display:flex!important;left:8px;right:8px;bottom:calc(8px + env(safe-area-inset-bottom));z-index:210;height:62px;padding:6px;border:1px solid var(--dc-ln2);border-radius:13px;background:#111113f4;backdrop-filter:blur(16px);box-shadow:0 16px 45px #000a}#dcMobileNav button{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;color:var(--dc-s);border-radius:8px}#dcMobileNav button.on{background:#d9b47814;color:var(--dc-a2)}#dcMobileNav i{font-style:normal;font-size:17px}#dcMobileNav span{font-size:8px}.dc-top-actions .dc-btn{padding:0 10px!important}.dc-page-head h1{font-size:22px!important}.dc-create{padding:16px!important}.dc-create h1{font-size:20px!important}.dc-create-row,.dc-metrics,.dc-social-grid,.dc-tools,.dc-live .library-controls,.dc-live .library-browser-tools{grid-template-columns:1fr!important}.dc-create-row input,.dc-create-row .dc-btn,.dc-live .library-controls>:first-child{grid-column:auto!important}.dc-live .library-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:9px!important}.dc-live .library-clip-actions{grid-template-columns:1fr!important}.dc-live .library-browser-foot{position:relative!important}.dc-live .library-browser-foot .btn{flex:1 1 120px!important}.dc-editor-layout{border-radius:8px!important}.dc-rail{display:block!important;max-height:190px!important}.dc-rail-head{border-right:0!important;border-bottom:1px solid var(--dc-ln)!important}.dc-clips{display:flex!important}.dc-clip{flex-basis:190px!important}.dc-canvas{height:min(56dvh,500px)!important}.dc-editor-foot{position:relative!important;bottom:auto!important}.dc-editor-foot .copy{width:100%!important;flex-basis:100%!important}.dc-editor-foot .dc-btn{flex:1 1 140px!important}}
@media(max-width:440px){.dc-live .library-clip-grid{grid-template-columns:1fr!important}.dc-metrics{grid-template-columns:1fr 1fr!important}.dc-editor-foot .dc-check{width:100%!important}.dc-top-actions .dc-btn{font-size:0!important}.dc-top-actions .dc-btn::after{content:'＋';font-size:18px}}

/* Phase 3A — Home command centre */
/* Phase 3B — stable responsive workspace */
.dc-live .dc-card,.dc-live .dc-pad,.dc-live .dc-home-grid>*{min-width:0}
.dc-live button,.dc-live input,.dc-live select,.dc-live textarea{max-width:100%}
.dc-home-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:14px;margin-bottom:16px}
.dc-home-heading h1{margin:0;font-size:27px;letter-spacing:-.025em;line-height:1.15}
.dc-home-heading p{margin:6px 0 0;color:var(--dc-m);font-size:11px}
.dc-home-heading-actions{display:flex;gap:8px;flex-wrap:wrap}
.dc-create-command{padding:18px;background:linear-gradient(135deg,#18130d,#121214 48%);border-color:#d9b47838}
.dc-create-command-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;margin-bottom:13px}
.dc-create-command-top h2{margin:0;font-size:17px}
.dc-create-command-top p{margin:4px 0 0;color:var(--dc-m);font-size:10px}
.dc-create-main{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:9px}
.dc-create-main input{height:44px!important;min-height:44px!important;background:#0d0d0f!important;border:1px solid var(--dc-ln)!important;border-radius:9px!important;padding:0 13px!important}
.dc-create-main .dc-btn{height:44px;min-width:132px}
.dc-create-options{margin-top:10px;border-top:1px solid #ffffff0d;padding-top:10px}
.dc-create-options summary{display:flex;align-items:center;gap:8px;cursor:pointer;color:var(--dc-m);font-size:10px;list-style:none}
.dc-create-options summary::-webkit-details-marker{display:none}
.dc-create-options summary::before{content:'›';font-size:16px;transition:transform .16s ease}
.dc-create-options[open] summary::before{transform:rotate(90deg)}
.dc-create-options summary span{margin-left:auto;color:var(--dc-s)}
.dc-option-grid{display:grid;grid-template-columns:minmax(180px,1fr) 1fr 130px 150px;gap:8px;margin-top:11px}
.dc-option-grid input,.dc-option-grid select{height:38px!important;min-height:38px!important;background:#0d0d0f!important;border:1px solid var(--dc-ln)!important;border-radius:8px!important;padding:0 10px!important;font-size:11px}
.dc-pipeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));margin-top:12px;background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:11px;overflow:hidden}
.dc-pipe{min-width:0;display:flex;align-items:center;gap:10px;padding:13px 14px;text-align:left;color:var(--dc-t);border-right:1px solid var(--dc-ln)}
.dc-pipe:last-child{border-right:0}
.dc-pipe:hover{background:var(--dc-p2)}
.dc-pipe i{width:28px;height:28px;flex:0 0 28px;display:grid;place-items:center;border-radius:8px;background:var(--dc-p3);font-style:normal;font-size:12px;color:var(--dc-a2)}
.dc-pipe-copy{min-width:0;flex:1}
.dc-pipe-copy strong,.dc-pipe-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dc-pipe-copy strong{font-size:13px}
.dc-pipe-copy span{color:var(--dc-m);font-size:8.5px;margin-top:2px}
.dc-home-command-grid{display:grid;grid-template-columns:minmax(0,1.42fr) minmax(310px,.58fr);gap:15px;margin-top:15px}
.dc-home-column{display:flex;flex-direction:column;gap:15px;min-width:0}
.dc-now-hero{border-color:#d9b47830;background:linear-gradient(180deg,#151310,#121214 45%)}
.dc-now-hero .dc-pad{padding:19px}
.dc-now-row{padding:13px;background:#0e0e10;border-color:var(--dc-ln);border-radius:9px}
.dc-now-top{align-items:flex-start}
.dc-job-icon{width:32px;height:32px;flex:0 0 32px;display:grid;place-items:center;border-radius:9px;background:var(--dc-p3);font-size:13px;color:var(--dc-a2)}
.dc-job-icon.generation{background:#d9b47813}
.dc-job-icon.editor{background:#8a74e817;color:#b7a6ff}
.dc-job-icon.publish{background:#55c58b15;color:var(--dc-g)}
.dc-job-main{min-width:0;flex:1}
.dc-job-title{display:flex;align-items:center;gap:8px;min-width:0}
.dc-job-title strong{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}
.dc-job-title .dc-pill{flex:0 0 auto}
.dc-job-stage{color:var(--dc-m);font-size:9px;margin-top:3px;overflow-wrap:anywhere}
.dc-job-bottom{display:flex;align-items:center;gap:9px;margin-top:9px}
.dc-job-bottom .dc-progress{margin:0;flex:1;height:4px}
.dc-job-time{flex:0 0 auto;color:var(--dc-s);font-size:8.5px}
.dc-job-open{flex:0 0 auto;height:29px!important;min-height:29px!important;padding:0 9px!important;font-size:9px!important}
.dc-idle-now{display:flex;align-items:center;gap:12px;padding:16px;border:1px dashed var(--dc-ln2);border-radius:9px;background:#0d0d0f}
.dc-idle-icon{width:38px;height:38px;display:grid;place-items:center;border-radius:10px;background:#55c58b13;color:var(--dc-g);font-size:18px}
.dc-idle-now strong,.dc-idle-now span{display:block}
.dc-idle-now strong{font-size:11px}
.dc-idle-now span{color:var(--dc-m);font-size:9px;margin-top:2px}
.dc-ready-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.dc-ready-card{min-width:0;overflow:hidden;border:1px solid var(--dc-ln);border-radius:9px;background:#0d0d0f}
.dc-ready-media{position:relative;aspect-ratio:16/10;background:#050506;overflow:hidden}
.dc-ready-media img{width:100%;height:100%;display:block;object-fit:cover}
.dc-score{position:absolute;left:7px;bottom:7px;padding:3px 6px;border-radius:99px;background:#09090bdd;color:#c9ff55;font-size:9px;font-weight:700}
.dc-ready-body{padding:10px}
.dc-ready-body strong{display:block;font-size:10.5px;line-height:1.35;min-height:28px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}
.dc-ready-body span{display:block;color:var(--dc-m);font-size:8.5px;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-ready-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:9px}
.dc-ready-actions .dc-btn{height:31px;min-height:31px;padding:0 7px;font-size:9px}
.dc-smart-action{padding:16px;border:1px solid #d9b47830;border-radius:10px;background:linear-gradient(135deg,#17130e,#0e0e10)}
.dc-smart-action-top{display:flex;align-items:flex-start;gap:10px}
.dc-smart-icon{width:35px;height:35px;flex:0 0 35px;display:grid;place-items:center;border-radius:10px;background:#d9b47817;color:var(--dc-a2);font-size:16px}
.dc-smart-copy{min-width:0;flex:1}
.dc-smart-copy strong,.dc-smart-copy span{display:block}
.dc-smart-copy strong{font-size:11px}
.dc-smart-copy span{font-size:9px;color:var(--dc-m);margin-top:3px;line-height:1.45}
.dc-smart-action .dc-btn{width:100%;margin-top:12px}
.dc-social-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 11px;margin-bottom:9px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}
.dc-social-summary strong,.dc-social-summary span{display:block}
.dc-social-summary strong{font-size:11px}
.dc-social-summary span{color:var(--dc-m);font-size:8.5px;margin-top:2px}
.dc-social-list{display:flex;flex-direction:column;gap:7px}
.dc-social-line{display:flex;align-items:center;gap:9px;padding:9px 10px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f;min-width:0}
.dc-social-mark{width:29px;height:29px;flex:0 0 29px;display:grid;place-items:center;border-radius:8px;background:var(--dc-p3);font-size:9px;font-weight:800}
.dc-social-line-copy{min-width:0;flex:1}
.dc-social-line-copy strong,.dc-social-line-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-social-line-copy strong{font-size:10px}
.dc-social-line-copy span{font-size:8.5px;color:var(--dc-m);margin-top:2px}
.dc-social-line .dc-btn{height:29px;min-height:29px;padding:0 9px;font-size:8.5px}
.dc-next-post{display:flex;align-items:center;gap:10px;padding:10px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}
.dc-next-post img{width:62px;height:43px;object-fit:cover;border-radius:6px;background:#050506}
.dc-next-post-copy{min-width:0;flex:1}
.dc-next-post-copy strong,.dc-next-post-copy span{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dc-next-post-copy strong{font-size:10px}
.dc-next-post-copy span{font-size:8.5px;color:var(--dc-m);margin-top:2px}
.dc-activity-list{display:flex;flex-direction:column}
.dc-activity-row{display:flex;align-items:flex-start;gap:9px;padding:8px 1px;border-bottom:1px solid #ffffff0b}
.dc-activity-row:last-child{border-bottom:0}
.dc-activity-dot{width:7px;height:7px;flex:0 0 7px;margin-top:5px;border-radius:50%;background:var(--dc-s)}
.dc-activity-dot.good{background:var(--dc-g)}
.dc-activity-dot.warn{background:var(--dc-w)}
.dc-activity-dot.bad{background:var(--dc-b)}
.dc-activity-copy{min-width:0;flex:1}
.dc-activity-copy strong{display:block;font-size:9.5px;line-height:1.4;overflow-wrap:anywhere}
.dc-activity-copy span{display:block;color:var(--dc-s);font-size:8px;margin-top:2px}
.dc-compact-list .dc-list-row{padding:9px 10px}
.dc-compact-list .dc-social-icon{width:29px;height:29px;flex:0 0 29px}
.dc-system-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:10px}
.dc-system-item{padding:8px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f}
.dc-system-item strong,.dc-system-item span{display:block}
.dc-system-item strong{font-size:9.5px}
.dc-system-item span{font-size:8px;color:var(--dc-m);margin-top:2px}
@media(max-width:1150px){
  .dc-home-command-grid{grid-template-columns:1fr}
  .dc-option-grid{grid-template-columns:1fr 1fr}
  .dc-ready-grid{grid-template-columns:repeat(3,minmax(180px,1fr))}
}
@media(max-width:820px){
  .dc-pipeline{display:flex;overflow-x:auto;scroll-snap-type:x proximity}
  .dc-pipe{min-width:170px;scroll-snap-align:start}
  .dc-ready-grid{display:flex;overflow-x:auto;padding-bottom:3px;scroll-snap-type:x proximity}
  .dc-ready-card{flex:0 0 220px;scroll-snap-align:start}
}
@media(max-width:700px){
  .dc-home-heading{align-items:flex-start}
  .dc-home-heading h1{font-size:22px}
  .dc-home-heading-actions .dc-btn:first-child{display:none}
  .dc-create-command{padding:15px}
  .dc-create-command-top{display:block}
  .dc-create-main{grid-template-columns:1fr}
  .dc-create-main .dc-btn{width:100%}
  .dc-option-grid{grid-template-columns:1fr}
  .dc-job-bottom{flex-wrap:wrap}
  .dc-job-bottom .dc-progress{flex-basis:100%}
  .dc-job-time{flex:1}
  .dc-system-strip{grid-template-columns:1fr}
}
@media(max-width:440px){
  .dc-ready-card{flex-basis:200px}
  .dc-pipe{min-width:155px;padding:11px}
}

/* Phase 3B — stable Projects, true sidebar collapse and overflow repair */
.dc-nav{flex:1;min-height:0}.dc-side-foot{padding:9px 10px calc(9px + env(safe-area-inset-bottom));border-top:1px solid var(--dc-ln)}
.dc-side-toggle{width:100%;height:40px;display:flex;align-items:center;gap:11px;padding:0 11px;border-radius:8px;color:var(--dc-m);text-align:left}.dc-side-toggle:hover{background:var(--dc-p2);color:var(--dc-t)}.dc-side-toggle i{width:20px;font-style:normal;text-align:center;font-size:18px}.dc-side-toggle span{font-size:11px;font-weight:600}.dc-side-toggle .dc-collapse-arrow{transition:transform .18s ease}
body.dc-side-mini{--dc-side:76px}body.dc-side-mini .dc-brand,body.dc-side-mini .dc-nav-label,body.dc-side-mini .dc-nav b,body.dc-side-mini .dc-side-toggle span{display:none!important}body.dc-side-mini #dcBrand,body.dc-side-mini .dc-nav button,body.dc-side-mini .dc-side-toggle{justify-content:center!important;padding-left:0!important;padding-right:0!important}body.dc-side-mini .dc-collapse-arrow{transform:rotate(180deg)}
.dc-live button,.dc-live .btn,.dc-live .dc-btn,.dc-live a.btn{max-width:100%;min-width:0}.dc-live .btn,.dc-live .dc-btn,.dc-live a.btn{overflow:hidden;text-overflow:ellipsis}.dc-live .head,.dc-live .sched-head{align-items:flex-start!important}.dc-live .head>*,.dc-live .sched-head>*{min-width:0}.dc-live .head h2,.dc-live .head .note,.dc-live .sched-head h2,.dc-live .sched-head .note{overflow-wrap:anywhere}
.dc-live .clip-actions,.dc-live .library-clip-actions,.dc-live .track-actions{display:flex!important;flex-wrap:wrap!important;gap:7px!important}.dc-live .clip-actions .btn,.dc-live .library-clip-actions .btn,.dc-live .library-clip-actions a.btn,.dc-live .track-actions .btn{flex:1 1 118px!important;width:auto!important;min-width:0!important;min-height:38px!important;padding:7px 9px!important;white-space:normal!important;line-height:1.2!important}
.dc-live #videoModal{display:none!important;pointer-events:none!important}.dc-live .video-modal:not(#rerenderModal){display:none!important}.dc-live[data-dc-view="projects"] #view-library{display:none!important}
.dc-projects-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:17px}.dc-projects-head h1{margin:0;font-size:26px;line-height:1.16}.dc-projects-head p{margin:6px 0 0;color:var(--dc-m);font-size:11px}.dc-projects-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-project-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 180px 180px;gap:9px;margin-bottom:14px}.dc-project-toolbar input,.dc-project-toolbar select{width:100%;height:40px;min-height:40px;background:#0d0d0f;border:1px solid var(--dc-ln);border-radius:8px;color:var(--dc-t);padding:0 11px}.dc-project-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:13px}.dc-project-card{min-width:0;overflow:hidden;background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:11px;transition:border-color .15s ease,transform .15s ease}.dc-project-card:hover{border-color:var(--dc-ln2);transform:translateY(-1px)}.dc-project-cover{position:relative;width:100%;aspect-ratio:16/9;background:#070708;overflow:hidden}.dc-project-cover img{width:100%;height:100%;display:block;object-fit:cover}.dc-project-cover-empty{width:100%;height:100%;display:grid;place-items:center;color:var(--dc-s);font-size:25px;background:linear-gradient(135deg,#17130e,#0b0b0d)}.dc-project-state{position:absolute;left:9px;bottom:9px;padding:4px 7px;border-radius:99px;background:#09090be8;color:var(--dc-m);font-size:9px}.dc-project-state.good{color:var(--dc-g)}.dc-project-state.bad{color:var(--dc-b)}.dc-project-card-body{padding:13px}.dc-project-card-body h3{margin:0;font-size:12px;line-height:1.4;min-height:34px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.dc-project-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:7px;color:var(--dc-m);font-size:9px}.dc-project-meta span{white-space:nowrap}.dc-project-progress{height:4px;margin-top:10px;background:var(--dc-ln);border-radius:99px;overflow:hidden}.dc-project-progress i{display:block;height:100%;background:var(--dc-a)}.dc-project-card-actions{display:grid;grid-template-columns:1fr auto;gap:7px;margin-top:11px}.dc-project-card-actions .dc-btn{height:34px;min-height:34px;padding:0 10px;font-size:9px}.dc-project-detail-top{display:flex;align-items:flex-start;gap:12px;margin-bottom:14px}.dc-project-detail-copy{min-width:0;flex:1}.dc-project-detail-copy h1{margin:0;font-size:23px;line-height:1.2;overflow-wrap:anywhere}.dc-project-detail-copy p{margin:6px 0 0;color:var(--dc-m);font-size:10px}.dc-project-detail-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.dc-project-filterbar{display:grid;grid-template-columns:minmax(210px,1fr) 160px 160px;gap:8px;margin:13px 0}.dc-project-filterbar input,.dc-project-filterbar select,.dc-project-detail-actions select{height:38px;min-height:38px;background:#0d0d0f;border:1px solid var(--dc-ln);border-radius:8px;color:var(--dc-t);padding:0 10px;min-width:0}.dc-project-clip-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;align-items:start}.dc-project-clip{min-width:0;overflow:hidden;background:var(--dc-p);border:1px solid var(--dc-ln);border-radius:10px}.dc-project-clip-media{position:relative;width:100%;aspect-ratio:9/16;background:#050506;overflow:hidden}.dc-project-clip-media img{width:100%;height:100%;display:block;object-fit:cover}.dc-project-clip-media:hover img{transform:scale(1.01)}.dc-project-clip-media img{transition:transform .16s ease}.dc-project-clip-duration,.dc-project-clip-score{position:absolute;top:8px;padding:3px 6px;border-radius:99px;background:#09090be8;font-size:9px}.dc-project-clip-duration{right:8px;color:var(--dc-t)}.dc-project-clip-score{left:8px;color:#c9ff55;font-weight:750}.dc-project-clip-body{padding:11px}.dc-project-clip-body h3{margin:0;font-size:11px;line-height:1.4;min-height:31px;overflow:hidden;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2}.dc-project-clip-sub{margin-top:5px;color:var(--dc-m);font-size:8.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-project-targets{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}.dc-project-target{padding:3px 6px;border-radius:99px;background:var(--dc-p3);color:var(--dc-m);font-size:8px}.dc-project-target.bad{color:var(--dc-b);background:#ee687812}.dc-project-target.good{color:var(--dc-g);background:#55c58b12}.dc-project-clip-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin-top:10px}.dc-project-clip-actions .dc-btn,.dc-project-clip-actions a.dc-btn{height:34px;min-height:34px;padding:0 7px;font-size:9px;white-space:normal;line-height:1.15;text-align:center}.dc-project-empty{grid-column:1/-1}.dc-project-note{padding:10px 12px;margin-bottom:13px;border:1px solid var(--dc-ln);border-radius:8px;background:#0d0d0f;color:var(--dc-m);font-size:9px;overflow-wrap:anywhere}
@media(max-width:1320px){.dc-project-clip-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.dc-project-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:980px){body.dc-side-mini{--dc-side:76px}.dc-project-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.dc-project-toolbar,.dc-project-filterbar{grid-template-columns:1fr 1fr}.dc-project-toolbar>:first-child,.dc-project-filterbar>:first-child{grid-column:1/-1}}
@media(max-width:700px){body.dc-side-mini{--dc-side:0px}.dc-side-foot{display:none}.dc-projects-head,.dc-project-detail-top{display:block}.dc-projects-actions,.dc-project-detail-actions{margin-top:12px;justify-content:flex-start}.dc-project-grid{grid-template-columns:1fr}.dc-project-clip-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.dc-project-clip-actions{grid-template-columns:1fr}.dc-project-toolbar,.dc-project-filterbar{grid-template-columns:1fr}.dc-project-toolbar>:first-child,.dc-project-filterbar>:first-child{grid-column:auto}}
@media(max-width:430px){.dc-project-clip-grid{grid-template-columns:1fr}.dc-projects-actions .dc-btn,.dc-project-detail-actions .dc-btn{flex:1 1 130px}}


`;
function active(){
  const d=D(),out=[],seen=new Set();
  if(!d)return out;
  const add=item=>{
    const progress=Number(item.progress);
    const clean={...item,progress:Number.isFinite(progress)?C(progress,0,100):null};
    const key=`${clean.kind}|${clean.title}|${clean.stage}`;
    if(seen.has(key))return;
    seen.add(key);out.push(clean);
  };
  (d.projects||[]).forEach(p=>{
    if(['queued','processing'].includes(p.status))add({kind:'generation',title:p.title||'Lecture',stage:p.stage||p.status,progress:p.progress,startedAt:p.startedAt||p.submittedAt,view:'projects',projectId:p.id});
    const m=p.moreJob;
    if(m&&['queued','processing'].includes(m.status))add({kind:'generation',title:`More clips · ${p.title||'Lecture'}`,stage:m.stage||m.status,progress:m.progress,startedAt:m.startedAt||m.createdAt,view:'projects',projectId:p.id});
  });
  (d.rerenderJobs||[]).forEach(j=>{
    if(['queued','processing'].includes(j.status)){
      const c=(d.clips||[]).find(x=>x.id===j.clipId);
      add({kind:'editor',title:`Editing ${c?.title||'clip'}`,stage:j.stage||j.status,progress:j.progress,startedAt:j.startedAt||j.createdAt,view:'editor',clipId:j.clipId});
    }
  });
  (d.clips||[]).forEach(c=>(c.targets||[]).forEach(t=>{
    if(['retrying','publishing','processing'].includes(t.status))add({kind:'publish',title:`${c.title||'Clip'} → ${t.provider}`,stage:t.stage||t.status,progress:t.progressPercent,startedAt:t.processingStartedAt||t.startedAt||t.updatedAt,view:'schedule',clipId:c.id,provider:t.provider});
  }));
  for(const r of requests.values()){
    const url=String(r.url||'');
    const kind=/publish|schedule/.test(url)?'publish':/rerender|template/.test(url)?'editor':'generation';
    const title=/rerender/.test(url)?'Preparing an edited render':/publish/.test(url)?'Starting a social upload':url==='/api/videos'?'Adding a new lecture':'Saving your changes';
    add({kind,title,stage:'Sending the request securely',progress:null,startedAt:r.startedAt||Date.now(),view:kind==='editor'?'editor':kind==='publish'?'schedule':'home'});
  }
  return out;
}
function dcDuration(ms){
  const total=Math.max(0,Math.round(Number(ms||0)/1000));
  if(total<60)return`${total}s`;
  const minutes=Math.floor(total/60),seconds=total%60;
  if(minutes<60)return seconds?`${minutes}m ${seconds}s`:`${minutes}m`;
  const hours=Math.floor(minutes/60),rest=minutes%60;
  return rest?`${hours}h ${rest}m`:`${hours}h`;
}
function dcJobTime(item){
  const started=Number(item.startedAt||0);
  if(!started)return item.progress!=null&&item.progress>0?'Estimating time left…':'In progress';
  const elapsed=Math.max(0,Date.now()-started);
  const bits=[`Running ${dcDuration(elapsed)}`];
  const p=Number(item.progress);
  if(Number.isFinite(p)&&p>=5&&p<96&&elapsed>4000){
    const remain=elapsed/(p/100)-elapsed;
    if(Number.isFinite(remain)&&remain>0&&remain<4*60*60*1000)bits.push(`about ${dcDuration(remain)} left`);
  }
  return bits.join(' · ');
}
function dcWhen(value){
  const n=Number(value||0);if(!n)return'';
  const delta=n-Date.now(),abs=Math.abs(delta);
  if(abs<60000)return delta>=0?'in under a minute':'just now';
  if(abs<3600000)return delta>=0?`in ${Math.round(abs/60000)}m`:`${Math.round(abs/60000)}m ago`;
  if(abs<86400000)return delta>=0?`in ${Math.round(abs/3600000)}h`:`${Math.round(abs/3600000)}h ago`;
  return new Date(n).toLocaleString('en-AU',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}
function dcLogItem(entry){
  if(typeof entry==='string')return{message:entry,at:0,level:''};
  const x=entry||{};
  return{message:String(x.message||x.text||x.msg||x.event||'Activity updated'),at:Number(x.at||x.createdAt||x.timestamp||x.time||0),level:String(x.level||x.type||'')};
}
function dcRecommendation(d,jobs){
  const clips=d.clips||[],projects=d.projects||[];
  const failedProjects=projects.filter(p=>p.status==='failed').length;
  const failedPosts=clips.filter(c=>c.status==='publish_failed').length;
  const waiting=clips.filter(c=>c.status==='waiting').length;
  const approved=clips.filter(c=>['approved','ready'].includes(c.status)).length;
  const connected=Object.values(d.social?.providers||{}).filter(x=>x.connected).length;
  if(failedProjects||failedPosts)return{icon:'!',title:'Fix a blocked item',detail:`${failedProjects+failedPosts} item${failedProjects+failedPosts===1?' needs':'s need'} attention before the workflow is clear.`,label:'Open needs attention',action:'attention'};
  if(jobs.length)return{icon:'↻',title:'Work is running',detail:`${jobs.length} active task${jobs.length===1?' is':'s are'} processing. You can leave this page and come back safely.`,label:'View live progress',action:'now'};
  if(waiting)return{icon:'✓',title:`Review ${waiting} generated clip${waiting===1?'':'s'}`,detail:'Choose the strongest reminders, edit them, then schedule the approved versions.',label:'Review clips',view:'queue'};
  if(approved)return{icon:'◷',title:`Schedule ${approved} ready clip${approved===1?'':'s'}`,detail:'These clips are ready for a publishing time or manual export.',label:'Open publishing',view:'schedule'};
  if(!d.readiness?.musicReady)return{icon:'♪',title:'Add your nasheed library',detail:'At least one track is required before DeenClipped can render a lecture.',label:'Open Music',view:'music'};
  if(!connected)return{icon:'↗',title:'Connect a social account',detail:'Connect YouTube, Instagram, Facebook or TikTok before scheduling automatic posts.',label:'Manage connections',view:'publishing'};
  if(!projects.length)return{icon:'＋',title:'Create your first clips',detail:'Paste a lecture link above and DeenClipped will find, caption and render the best moments.',label:'Paste a lecture link',action:'focus'};
  return{icon:'＋',title:'Create the next project',detail:'Your queue is clear. Add another lecture or open a recent project to generate more clips.',label:'New project',action:'focus'};
}
function count(k){const d=D();if(!d)return'';if(k==='queue')return(d.clips||[]).filter(c=>c.status==='waiting').length||'';if(k==='projects')return(d.projects||[]).length||'';if(k==='schedule')return(d.clips||[]).filter(c=>['approved','scheduled','publishing','publish_failed'].includes(c.status)).length||'';if(k==='publishing')return Object.values(d.social?.providers||{}).filter(p=>p.connected).length||'';return''}
function build(){if(shell)return;shell=true;document.head.append(Object.assign(document.createElement('style'),{id:'dcStyles',textContent:style}));const side=document.createElement('aside');side.id='dcSide';side.innerHTML=`<div id="dcBrand"><div class="dc-logo">▶</div><div class="dc-brand"><strong>DeenClipped</strong><span>AI clip workspace</span></div></div><div class="dc-nav"><div class="dc-nav-label">Create</div>${nav.map(([v,l])=>`<button data-dc-view="${v}" title="${E(l)}"><i>${icons[v]||'•'}</i><b>${l}</b></button>`).join('')}<div class="dc-nav-label dc-manage-label">Manage</div>${manageNav.map(([v,l])=>`<button data-dc-view="${v}" title="${E(l)}"><i>${icons[v]||'•'}</i><b>${l}</b></button>`).join('')}</div><div class="dc-side-foot"><button class="dc-side-toggle" id="dcCollapse" type="button" title="Collapse sidebar"><i class="dc-collapse-arrow">‹</i><span>Collapse sidebar</span></button></div>`;const top=document.createElement('header');top.id='dcTop';top.innerHTML=`<button class="dc-menu" id="dcMenu" type="button" aria-label="Open menu">☰</button><div class="dc-top-title"><strong id="dcTitle">Home</strong><span id="dcSubtitle">Create, review, edit and publish</span></div><div class="dc-search"><input id="dcSearch" placeholder="Search projects and clips…"><div class="dc-results" id="dcResults"></div></div><div class="dc-top-actions"><div class="dc-health" id="dcHealth"><i></i><span>Checking</span></div><button class="dc-btn" data-new-project>＋ New project</button></div>`;const mobile=document.createElement('nav');mobile.id='dcMobileNav';mobile.innerHTML=[['home','Home'],['projects','Projects'],['queue','Review'],['editor','Editor'],['schedule','Publish']].map(([v,l])=>`<button data-dc-view="${v}"><i>${icons[v]}</i><span>${l}</span></button>`).join('');const shade=document.createElement('button');shade.id='dcShade';shade.type='button';shade.setAttribute('aria-label','Close menu');const dock=document.createElement('div');dock.id='dcWorkDock';dock.innerHTML=`<span class="dc-spin"></span><div><strong>Working…</strong><span>DeenClipped is processing</span></div>`;document.body.append(side,top,mobile,shade,dock);const main=$('.main-col');if(main){const home=document.createElement('section');home.className='panel hide';home.id='view-home';const projects=document.createElement('section');projects.className='panel hide';projects.id='view-projects';const editor=document.createElement('section');editor.className='panel hide';editor.id='view-editor';main.prepend(editor);main.prepend(projects);main.prepend(home)}try{if(localStorage.getItem('dcSidebarMini')==='1')document.body.classList.add('dc-side-mini')}catch{}bindShell()}
function bindShell(){$$('[data-dc-view]').forEach(b=>b.onclick=()=>{go(b.dataset.dcView);document.body.classList.remove('dc-menu-open')});$('[data-new-project]')?.addEventListener('click',()=>{go('home');setTimeout(()=>$('[name=dcUrls]')?.focus(),60)});$('#dcSearch')?.addEventListener('input',search);$('#dcMenu')?.addEventListener('click',()=>document.body.classList.toggle('dc-menu-open'));$('#dcCollapse')?.addEventListener('click',()=>{document.body.classList.toggle('dc-side-mini');try{localStorage.setItem('dcSidebarMini',document.body.classList.contains('dc-side-mini')?'1':'0')}catch{}});$('#dcHealth')?.addEventListener('click',()=>{go('home');setTimeout(()=>$('#dcHappening')?.scrollIntoView({behavior:'smooth',block:'start'}),40)});$('#dcShade')?.addEventListener('click',()=>document.body.classList.remove('dc-menu-open'));document.addEventListener('click',e=>{if(!e.target.closest('.dc-search'))$('#dcResults')?.classList.remove('show')});document.addEventListener('click',e=>{const previewButton=e.target.closest('[data-preview],.library-clip-media,.clip-thumb');if(previewButton){const id=previewButton.dataset.preview||previewButton.dataset.clipId||previewButton.closest('[data-preview]')?.dataset.preview;if(id){e.preventDefault();e.stopImmediatePropagation();$('#videoModal')?.classList.add('hide');const old=$('#previewVideo');if(old){try{old.pause()}catch{}old.removeAttribute('src')}clipId=id;draft=null;dirty=false;go('editor');return}}const editButton=e.target.closest('[data-rerender]');if(editButton){e.preventDefault();e.stopImmediatePropagation();clipId=editButton.dataset.rerender;draft=null;dirty=false;go('editor');return}const projectButton=e.target.closest('[data-open-project]');if(projectButton){e.preventDefault();e.stopImmediatePropagation();projectId=projectButton.dataset.openProject;go('projects')}},true)}
function go(v){view=v;document.body.dataset.dcView=v;$$('[data-dc-view]').forEach(b=>b.classList.toggle('on',b.dataset.dcView===v));if(typeof showView==='function')showView(v);else $$('.panel').forEach(p=>p.classList.toggle('hide',p.id!==`view-${v}`));const names={home:['Home','Create, review, edit and publish'],projects:['Projects','Open a lecture, edit clips and generate more'],queue:['Review clips','Choose what is ready to edit or publish'],editor:['Editor','All visual styles and clip controls live here'],schedule:['Publish','Schedule and follow platform posts'],insights:['Analytics','Performance and output insights'],publishing:['Social accounts','Connect and manage destinations'],music:['Music','Nasheed library and audio settings'],automation:['Settings','Generation rules and system health']};$('#dcTitle').textContent=names[v]?.[0]||v;$('#dcSubtitle').textContent=names[v]?.[1]||'';$('#dcEditorFoot')?.classList.toggle('show',v==='editor');if(v==='home'){ensureHome();paintHome()}if(v==='projects')renderProjects();if(v==='editor')renderEditor();window.scrollTo({top:0,behavior:'auto'})}
function ensureHome(){
  const p=$('#view-home');
  if(!p||p.dataset.phase3)return;
  p.dataset.phase3='1';
  p.innerHTML=`
    <div class="dc-home-heading">
      <div><h1>Home</h1><p>Create clips, see live work, fix blockers and keep publishing from one place.</p></div>
      <div class="dc-home-heading-actions">
        <button class="dc-btn alt" id="dcRefreshHome" type="button">Refresh</button>
        <button class="dc-btn" type="button" data-focus-url>＋ New project</button>
      </div>
    </div>
    <section class="dc-card dc-create-command">
      <div class="dc-create-command-top">
        <div><h2>Create clips from a lecture</h2><p>Paste a public video URL. DeenClipped will find highlights, caption, frame and render them.</p></div>
        <span class="dc-pill good">Self-hosted</span>
      </div>
      <div class="dc-create-main">
        <input name="dcUrls" type="url" inputmode="url" placeholder="Paste a YouTube or public video URL">
        <button class="dc-btn" id="dcGenerate" type="button">Generate clips</button>
      </div>
      <details class="dc-create-options" id="dcCreateOptions">
        <summary>Generation settings <span id="dcHomeSettingsSummary">Default style · 8 clips · 30–60 sec</span></summary>
        <div class="dc-option-grid">
          <input id="dcProjectTitle" placeholder="Optional project name">
          <select id="dcHomeTemplate" aria-label="Editing style"></select>
          <select id="dcHomeCount" aria-label="Number of clips"><option value="4">4 clips</option><option value="8" selected>8 clips</option><option value="12">12 clips</option><option value="16">16 clips</option></select>
          <select id="dcHomeDuration" aria-label="Clip length"><option value="15,45">15–45 seconds</option><option value="30,60" selected>30–60 seconds</option><option value="45,90">45–90 seconds</option></select>
        </div>
      </details>
    </section>
    <div class="dc-pipeline" id="dcPipeline"></div>
    <div class="dc-home-command-grid">
      <div class="dc-home-column">
        <section class="dc-card dc-now-hero" id="dcHappening">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Happening now</h2><p>Generation, editing and publishing progress updates automatically.</p></div><span id="dcNowPill" class="dc-pill"></span></div>
            <div class="dc-now" id="dcNow"></div>
          </div>
        </section>
        <section class="dc-card">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Ready for you</h2><p>Your highest-scoring clips that need review or editing.</p></div><button class="dc-btn alt" data-dc-view="queue">See all clips</button></div>
            <div class="dc-ready-grid" id="dcReady"></div>
          </div>
        </section>
        <section class="dc-card">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Recent projects</h2><p>Continue a lecture or generate more clips from its saved source.</p></div><button class="dc-btn alt" data-dc-view="projects">All projects</button></div>
            <div class="dc-list dc-compact-list" id="dcRecent"></div>
          </div>
        </section>
      </div>
      <div class="dc-home-column">
        <section class="dc-smart-action" id="dcNextAction"></section>
        <section class="dc-card">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Social accounts</h2><p>Know what is connected before you schedule.</p></div><button class="dc-btn alt" data-dc-view="publishing">Manage</button></div>
            <div id="dcSocialSummary"></div>
            <div class="dc-social-list" id="dcSocial"></div>
          </div>
        </section>
        <section class="dc-card">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Upcoming posts</h2><p>The next clips leaving your queue.</p></div><button class="dc-btn alt" data-dc-view="schedule">Open Publish</button></div>
            <div class="dc-list" id="dcUpcoming"></div>
          </div>
        </section>
        <section class="dc-card" id="dcAttentionCard">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Needs attention</h2><p>Only genuine blockers and failed work appear here.</p></div></div>
            <div class="dc-list dc-compact-list" id="dcAttention"></div>
          </div>
        </section>
        <section class="dc-card">
          <div class="dc-pad">
            <div class="dc-card-head"><div><h2>Recent activity</h2><p>A simple record of what DeenClipped has done.</p></div></div>
            <div class="dc-activity-list" id="dcActivity"></div>
            <div class="dc-system-strip" id="dcSystem"></div>
          </div>
        </section>
      </div>
    </div>`;
  $$('[data-dc-view]',p).forEach(b=>b.onclick=()=>go(b.dataset.dcView));
  $$('[data-focus-url]',p).forEach(b=>b.onclick=()=>{go('home');setTimeout(()=>$('[name=dcUrls]')?.focus(),40)});
  $('#dcGenerate').onclick=generate;
  $('#dcRefreshHome').onclick=async()=>{const b=$('#dcRefreshHome');b.disabled=true;b.textContent='Refreshing…';try{if(typeof refresh==='function')await refresh({quiet:false});paintHome()}finally{b.disabled=false;b.textContent='Refresh'}};
  ['dcHomeTemplate','dcHomeCount','dcHomeDuration'].forEach(id=>$('#'+id)?.addEventListener('change',paintHomeSettings));
}
function paintHomeSettings(){
  const t=$('#dcHomeTemplate')?.selectedOptions?.[0]?.textContent||'Default style';
  const c=$('#dcHomeCount')?.value||8;
  const duration=$('#dcHomeDuration')?.selectedOptions?.[0]?.textContent||'30–60 seconds';
  if($('#dcHomeSettingsSummary'))$('#dcHomeSettingsSummary').textContent=`${t} · ${c} clips · ${duration}`;
}
function paintHome(){
  const d=D();if(!d)return;
  const clips=d.clips||[],projects=d.projects||[],jobs=active();
  const waiting=clips.filter(c=>c.status==='waiting').length;
  const processing=projects.filter(p=>['queued','processing'].includes(p.status)).length+(d.rerenderJobs||[]).filter(j=>['queued','processing'].includes(j.status)).length;
  const scheduled=clips.filter(c=>['approved','scheduled','publishing','publish_failed'].includes(c.status)).length;
  const weekAgo=Date.now()-7*86400000;
  const publishedWeek=clips.filter(c=>c.status==='posted'&&Number(c.postedAt||0)>=weekAgo).length;
  const pipeline=[
    ['＋',projects.length,'Projects','projects'],
    ['↻',processing,'Processing','home'],
    ['✓',waiting,'Review','queue'],
    ['◷',scheduled,'Publish queue','schedule'],
    ['↗',publishedWeek,'Published this week','insights']
  ];
  $('#dcPipeline').innerHTML=pipeline.map(([icon,value,label,target])=>`<button class="dc-pipe" type="button" data-pipe="${target}"><i>${icon}</i><span class="dc-pipe-copy"><strong>${value}</strong><span>${E(label)}</span></span></button>`).join('');
  $$('[data-pipe]').forEach(b=>b.onclick=()=>{if(b.dataset.pipe==='home')$('#dcHappening')?.scrollIntoView({behavior:'smooth',block:'start'});else go(b.dataset.pipe)});
  const currentTemplate=d.selectedTemplate?.id;
  const templateSelect=$('#dcHomeTemplate');
  if(templateSelect){
    const previous=templateSelect.value;
    templateSelect.innerHTML=(d.templates||[]).map(t=>`<option value="${E(t.id)}" ${t.id===(previous||currentTemplate)?'selected':''}>${E(t.name)}</option>`).join('');
  }
  paintHomeSettings();
  const pill=$('#dcNowPill');
  pill.className=`dc-pill ${jobs.length?'busy':'good'}`;
  pill.textContent=jobs.length?`${jobs.length} active`:'All clear';
  $('#dcNow').innerHTML=jobs.length?jobs.slice(0,10).map((x,index)=>`
    <div class="dc-now-row">
      <div class="dc-now-top">
        <div class="dc-job-icon ${E(x.kind)}">${x.kind==='generation'?'✦':x.kind==='editor'?'✎':'↗'}</div>
        <div class="dc-job-main">
          <div class="dc-job-title"><strong>${E(x.title)}</strong><span class="dc-pill ${x.kind==='publish'?'good':'busy'}">${E(x.kind==='generation'?'Generating':x.kind==='editor'?'Rendering':'Publishing')}</span></div>
          <div class="dc-job-stage">${E(x.stage||'Working')}</div>
          <div class="dc-job-bottom">
            ${x.progress!=null?`<div class="dc-progress"><i style="width:${C(x.progress,0,100)}%"></i></div>`:'<div class="dc-progress"><i style="width:35%;animation:dcp 1.2s ease-in-out infinite"></i></div>'}
            <span class="dc-job-time">${x.progress!=null?`${Math.round(x.progress)}% · `:''}${E(dcJobTime(x))}</span>
            <button class="dc-btn alt dc-job-open" type="button" data-job="${index}">Open</button>
          </div>
        </div>
      </div>
    </div>`).join(''):`<div class="dc-idle-now"><div class="dc-idle-icon">✓</div><div><strong>No work is running</strong><span>New generations, edited renders and social uploads will appear here immediately.</span></div></div>`;
  $$('[data-job]').forEach(b=>b.onclick=()=>{const job=jobs[Number(b.dataset.job)];if(!job)return;if(job.clipId&&job.view==='editor'){clipId=job.clipId;draft=null}if(job.projectId&&job.view==='projects'){projectId=job.projectId;go('projects');return}go(job.view||'home')});
  const ready=[...clips].filter(c=>['waiting','approved','ready','publish_failed'].includes(c.status)).sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,6);
  $('#dcReady').innerHTML=ready.length?ready.map(c=>`
    <article class="dc-ready-card">
      <div class="dc-ready-media"><img loading="lazy" src="${U(c.thumbUrl)}" alt=""><span class="dc-score">${Number(c.score||0)}</span></div>
      <div class="dc-ready-body">
        <strong>${E(c.title||'Untitled clip')}</strong><span>${E(c.projectTitle||'Lecture')} · ${E(String(c.status||'waiting').replace(/_/g,' '))}</span>
        <div class="dc-ready-actions"><button class="dc-btn alt" type="button" data-ready-review="${E(c.id)}">Review</button><button class="dc-btn" type="button" data-ready-edit="${E(c.id)}">Edit</button></div>
      </div>
    </article>`).join(''):`<div class="dc-empty" style="grid-column:1/-1"><strong>No clips need work</strong>Generate a lecture above or open a project to create more moments.</div>`;
  $$('[data-ready-review]').forEach(b=>b.onclick=()=>go('queue'));
  $$('[data-ready-edit]').forEach(b=>b.onclick=()=>{clipId=b.dataset.readyEdit;draft=null;dirty=false;go('editor')});
  const recent=[...projects].sort((a,b)=>Number(b.submittedAt||b.completedAt||0)-Number(a.submittedAt||a.completedAt||0)).slice(0,5);
  $('#dcRecent').innerHTML=recent.length?recent.map(p=>{
    const own=clips.filter(c=>c.projectId===p.id),thumb=own[0]?.thumbUrl;
    const available=own.filter(c=>c.status==='waiting').length,posted=own.filter(c=>c.status==='posted').length;
    return`<div class="dc-list-row">${thumb?`<img loading="lazy" src="${U(thumb)}" alt="">`:'<div class="dc-social-icon">▶</div>'}<div class="dc-list-copy"><strong>${E(p.title||'Lecture')}</strong><span>${own.length} clips · ${available} to review · ${posted} posted · ${E(p.stage||p.status)}</span></div><button class="dc-btn alt dc-job-open" data-open-project="${E(p.id)}">Open</button></div>`}).join(''):`<div class="dc-empty"><strong>No projects yet</strong>Paste a lecture link above to start.</div>`;
  $$('[data-open-project]').forEach(b=>b.onclick=()=>{projectId=b.dataset.openProject;go('projects')});
  const rec=dcRecommendation(d,jobs);
  $('#dcNextAction').innerHTML=`<div class="dc-smart-action-top"><div class="dc-smart-icon">${rec.icon}</div><div class="dc-smart-copy"><strong>${E(rec.title)}</strong><span>${E(rec.detail)}</span></div></div><button class="dc-btn" id="dcRecommendedAction" type="button">${E(rec.label)}</button>`;
  $('#dcRecommendedAction').onclick=()=>{if(rec.view)return go(rec.view);if(rec.action==='focus')return $('[name=dcUrls]')?.focus();if(rec.action==='now')return $('#dcHappening')?.scrollIntoView({behavior:'smooth',block:'start'});if(rec.action==='attention')return $('#dcAttentionCard')?.scrollIntoView({behavior:'smooth',block:'start'})};
  paintSocial();
  paintAttention();
  const upcoming=clips.filter(c=>Number(c.scheduledAt||0)>Date.now()&&!['posted','ready'].includes(c.status)).sort((a,b)=>Number(a.scheduledAt)-Number(b.scheduledAt)).slice(0,4);
  $('#dcUpcoming').innerHTML=upcoming.length?upcoming.map((c,index)=>`<button class="dc-next-post" type="button" data-upcoming="${E(c.id)}"><img loading="lazy" src="${U(c.thumbUrl)}" alt=""><span class="dc-next-post-copy"><strong>${E(c.title||'Untitled clip')}</strong><span>${index===0?'Next · ':''}${E(dcWhen(c.scheduledAt))} · ${E((c.targets||[]).map(t=>t.provider).join(', ')||'local export')}</span></span><span>›</span></button>`).join(''):`<div class="dc-empty"><strong>No posts scheduled</strong>Review a clip, then add it to the publishing queue.</div>`;
  $$('[data-upcoming]').forEach(b=>b.onclick=()=>go('schedule'));
  const logs=(d.log||[]).slice(0,6).map(dcLogItem);
  $('#dcActivity').innerHTML=logs.length?logs.map(x=>`<div class="dc-activity-row"><i class="dc-activity-dot ${/error|fail/i.test(x.level+x.message)?'bad':/warn|retry/i.test(x.level+x.message)?'warn':'good'}"></i><div class="dc-activity-copy"><strong>${E(x.message)}</strong><span>${x.at?E(dcWhen(x.at)):'Recent'}</span></div></div>`).join(''):`<div class="dc-empty"><strong>No activity yet</strong>Completed actions and system messages will appear here.</div>`;
  const connected=Object.values(d.social?.providers||{}).filter(x=>x.connected).length;
  $('#dcSystem').innerHTML=[
    ['Renderer',d.readiness?.ready?'Ready':'Setup needed'],
    ['Music',`${(d.tracks||[]).length} track${(d.tracks||[]).length===1?'':'s'}`],
    ['Connections',`${connected}/4 connected`]
  ].map(([a,b])=>`<div class="dc-system-item"><strong>${E(a)}</strong><span>${E(b)}</span></div>`).join('');
}
function paintSocial(){
  const d=D(),p=d?.social?.providers||{};
  const names={youtube:['YT','YouTube'],instagram:['IG','Instagram'],facebook:['FB','Facebook'],tiktok:['TT','TikTok']};
  const connected=Object.values(p).filter(x=>x.connected).length;
  const configured=Object.values(p).filter(x=>x.configured).length;
  const globalOn=Boolean(d?.publishingSettings?.enabled);
  $('#dcSocialSummary').innerHTML=`<div class="dc-social-summary"><div><strong>${connected} of 4 connected</strong><span>${globalOn?'Automatic publishing is enabled':'Automatic publishing is paused'} · ${configured} configured</span></div><span class="dc-pill ${connected?'good':'busy'}">${connected?'Ready':'Set up'}</span></div>`;
  $('#dcSocial').innerHTML=Object.entries(names).map(([k,[mark,name]])=>{
    const x=p[k]||{},acct=x.accounts?.[0]?.name;
    const status=x.connected?(acct||'Connected'):x.configured?'Ready to connect':'Developer setup required';
    return`<div class="dc-social-line"><div class="dc-social-mark">${mark}</div><div class="dc-social-line-copy"><strong>${name}</strong><span>${E(status)}</span></div><span class="dc-pill ${x.connected?'good':x.configured?'busy':'bad'}">${x.connected?'Connected':x.configured?'Offline':'Missing'}</span><button class="dc-btn ${x.connected?'alt':''}" type="button" data-social="${k}" ${!x.configured?'disabled':''}>${x.connected?'Manage':'Connect'}</button></div>`;
  }).join('');
  $$('[data-social]').forEach(b=>b.onclick=async()=>{
    const k=b.dataset.social,x=p[k];
    if(x?.connected)return go('publishing');
    b.disabled=true;b.textContent='Opening…';
    try{
      const provider=k==='instagram'||k==='facebook'?'meta':k;
      const r=await A(`/api/social/${provider}/connect`,{method:'POST',body:'{}'});
      location.href=r.url;
    }catch(e){T(e.message,'bad');b.disabled=false;b.textContent='Connect'}
  });
}
function paintAttention(){
  const d=D(),items=[],providers=d.social?.providers||{},publish=d.publishingSettings||{};
  if(!d.readiness?.templateReady)items.push(['No editing style selected','Open Editor and choose a style','editor']);
  if(!d.readiness?.musicReady)items.push(['Music is missing','Upload at least one nasheed before generating','music']);
  if(!d.social?.securityReady)items.push(['Publishing security is incomplete','SOCIAL_TOKEN_KEY needs setup','publishing']);
  if(publish.enabled&&!d.directPublishingEnabled)items.push(['Direct publishing is disabled','Enable SOCIAL_PUBLISH_ENABLED in the deployment','publishing']);
  for(const name of ['youtube','instagram','facebook','tiktok']){
    if(publish[name]?.enabled&&!providers[name]?.connected)items.push([`${name} is enabled but disconnected`,'Reconnect the account before its next scheduled post','publishing']);
    if(providers[name]?.lastTestError)items.push([`${name} connection test failed`,providers[name].lastTestError,'publishing']);
  }
  (d.projects||[]).filter(p=>p.status==='failed').slice(0,3).forEach(p=>items.push([p.title||'Lecture failed',p.error||p.stage||'Open the project to retry','library']));
  (d.rerenderJobs||[]).filter(j=>j.status==='failed').slice(0,2).forEach(j=>{const c=(d.clips||[]).find(x=>x.id===j.clipId);items.push([`Edit failed: ${c?.title||'Clip'}`,j.error||j.stage||'Open Editor to try again','editor'])});
  (d.clips||[]).filter(c=>c.status==='publish_failed').slice(0,3).forEach(c=>items.push([c.title||'Post failed',(c.targets||[]).find(t=>t.error)?.error||'Open publishing status','schedule']));
  (d.clips||[]).filter(c=>c.reviewRequired&&c.status==='waiting').slice(0,2).forEach(c=>items.push([`Review quotation: ${c.title}`,'This clip was flagged for manual quotation review','queue']));
  $('#dcAttention').innerHTML=items.length?items.slice(0,7).map((i,index)=>`<div class="dc-list-row"><div class="dc-social-icon">!</div><div class="dc-list-copy"><strong>${E(i[0])}</strong><span>${E(i[1])}</span></div><button class="dc-btn alt dc-job-open" data-attn="${index}">Open</button></div>`).join(''):`<div class="dc-empty"><strong>Everything looks healthy</strong>No blocking issue needs your attention.</div>`;
  $$('[data-attn]').forEach(b=>b.onclick=()=>go(items[Number(b.dataset.attn)]?.[2]||'home'));
}
async function generate(){
  const urls=$('[name=dcUrls]')?.value.trim();
  if(!urls)return T('Paste a video link first','bad');
  const b=$('#dcGenerate'),[min,max]=($('#dcHomeDuration')?.value||'30,60').split(',').map(Number);
  b.disabled=true;b.textContent='Queueing…';
  try{
    const templateId=$('#dcHomeTemplate')?.value||D()?.selectedTemplate?.id;
    if(templateId)await A('/api/template',{method:'POST',body:JSON.stringify({id:templateId})});
    await A('/api/clip-settings',{method:'POST',body:JSON.stringify({clipsPerVideo:Number($('#dcHomeCount')?.value||8),clipMinSeconds:min,clipMaxSeconds:max})});
    const r=await A('/api/videos',{method:'POST',body:JSON.stringify({urls,title:$('#dcProjectTitle')?.value.trim()||''})});
    const failed=(r.results||[]).filter(x=>!x.ok);
    T(failed.length?`${r.results.length-failed.length} queued, ${failed.length} failed`:'Lecture queued — it is now in Happening now',failed.length?'bad':'good');
    $('[name=dcUrls]').value='';if($('#dcProjectTitle'))$('#dcProjectTitle').value='';
    $('#dcCreateOptions')?.removeAttribute('open');
    if(typeof refresh==='function')await refresh();
    paintHome();
    $('#dcHappening')?.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){T(e.message,'bad')}
  finally{b.disabled=false;b.textContent='Generate clips'}
}

function projectStatus(p){if(p.status==='failed')return['Failed','bad'];if(['queued','processing'].includes(p.status))return['Processing','busy'];if(['done','completed'].includes(p.status))return['Ready','good'];return[String(p.status||'Draft').replace(/_/g,' '),'']}
function projectClipStatus(c){if(c.status==='publish_failed')return'Publish failed';if(c.status==='posted')return'Posted';if(c.status==='scheduled')return'Scheduled';if(c.status==='publishing')return'Publishing';if(c.status==='approved'||c.status==='ready')return'Ready to publish';return'Needs review'}
function projectDuration(c){const seconds=Math.max(0,Math.round(Number(c.durationMs||0)/1000));return`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`}
function renderProjects(){const p=$('#view-projects'),d=D();if(!p||!d)return;const allProjects=[...(d.projects||[])],allClips=d.clips||[];if(projectId&&!allProjects.some(x=>x.id===projectId))projectId='';if(!projectId){let projects=allProjects.filter(x=>!projectQuery||`${x.title||''} ${x.url||''}`.toLowerCase().includes(projectQuery.toLowerCase()));if(projectSort==='oldest')projects.sort((a,b)=>Number(a.submittedAt||0)-Number(b.submittedAt||0));else if(projectSort==='clips')projects.sort((a,b)=>allClips.filter(c=>c.projectId===b.id).length-allClips.filter(c=>c.projectId===a.id).length);else projects.sort((a,b)=>Number(b.submittedAt||b.completedAt||0)-Number(a.submittedAt||a.completedAt||0));p.innerHTML=`<div class="dc-projects-head"><div><h1>Projects</h1><p>Each lecture stays together with its generated clips. Open one without loading the old preview browser.</p></div><div class="dc-projects-actions"><button class="dc-btn" data-project-new>＋ New project</button></div></div><div class="dc-project-toolbar"><input id="dcProjectSearch" value="${E(projectQuery)}" placeholder="Search lectures…"><select id="dcProjectSort"><option value="newest" ${projectSort==='newest'?'selected':''}>Newest first</option><option value="oldest" ${projectSort==='oldest'?'selected':''}>Oldest first</option><option value="clips" ${projectSort==='clips'?'selected':''}>Most clips</option></select><select disabled><option>${projects.length} project${projects.length===1?'':'s'}</option></select></div><div class="dc-project-grid">${projects.length?projects.map(x=>{const clips=allClips.filter(c=>c.projectId===x.id),thumb=clips[0]?.thumbUrl,waiting=clips.filter(c=>c.status==='waiting').length,posted=clips.filter(c=>c.status==='posted').length,[status,klass]=projectStatus(x);return`<article class="dc-project-card"><button class="dc-project-cover" type="button" data-project-open="${E(x.id)}">${thumb?`<img loading="lazy" src="${U(thumb)}" alt="">`:'<span class="dc-project-cover-empty">▶</span>'}<span class="dc-project-state ${klass}">${E(status)}</span></button><div class="dc-project-card-body"><h3>${E(x.title||'Untitled lecture')}</h3><div class="dc-project-meta"><span>${clips.length} clips</span><span>${waiting} to review</span><span>${posted} posted</span></div>${['queued','processing'].includes(x.status)?`<div class="dc-project-progress"><i style="width:${C(x.progress,0,100)}%"></i></div>`:''}<div class="dc-project-card-actions"><button class="dc-btn" data-project-open="${E(x.id)}">Open project</button><button class="dc-btn alt" data-project-edit-first="${E(x.id)}" ${clips.length?'':'disabled'}>Editor</button></div></div></article>`}).join(''):`<div class="dc-empty dc-project-empty"><strong>No matching projects</strong>Paste a lecture on Home to create one.</div>`}</div>`;$('#dcProjectSearch').oninput=e=>{projectQuery=e.target.value;const pos=e.target.selectionStart;renderProjects();const input=$('#dcProjectSearch');input?.focus();try{input?.setSelectionRange(pos,pos)}catch{}};$('#dcProjectSort').onchange=e=>{projectSort=e.target.value;renderProjects()};$('[data-project-new]').onclick=()=>{go('home');setTimeout(()=>$('[name=dcUrls]')?.focus(),60)};$$('[data-project-open]').forEach(b=>b.onclick=()=>{projectId=b.dataset.projectOpen;projectFilter='all';projectQuery='';renderProjects();window.scrollTo({top:0})});$$('[data-project-edit-first]').forEach(b=>b.onclick=()=>{const c=allClips.find(x=>x.projectId===b.dataset.projectEditFirst);if(!c)return;clipId=c.id;draft=null;go('editor')});return}
const project=allProjects.find(x=>x.id===projectId),projectClips=allClips.filter(c=>c.projectId===projectId);let clips=projectClips.filter(c=>{if(projectQuery&&!`${c.title||''} ${c.transcript||''}`.toLowerCase().includes(projectQuery.toLowerCase()))return false;if(projectFilter==='ready')return['waiting','approved','ready'].includes(c.status);if(projectFilter==='scheduled')return['scheduled','publishing'].includes(c.status);if(projectFilter==='posted')return c.status==='posted';if(projectFilter==='failed')return c.status==='publish_failed'||(c.targets||[]).some(t=>t.status==='failed');return true});if(projectSort==='newest')clips.sort((a,b)=>Number(b.addedAt||0)-Number(a.addedAt||0));else if(projectSort==='duration')clips.sort((a,b)=>Number(b.durationMs||0)-Number(a.durationMs||0));else clips.sort((a,b)=>Number(b.score||0)-Number(a.score||0));const available=projectClips.filter(c=>c.status==='waiting').length,posted=projectClips.filter(c=>c.status==='posted').length,activeMore=['queued','processing'].includes(project.moreJob?.status);p.innerHTML=`<div class="dc-project-detail-top"><button class="dc-btn alt" id="dcProjectsBack">← Projects</button><div class="dc-project-detail-copy"><h1>${E(project.title||'Untitled lecture')}</h1><p>${projectClips.length} clips · ${available} to review · ${posted} posted · ${E(project.stage||project.status)}</p></div><div class="dc-project-detail-actions"><select id="dcMoreCount" aria-label="Generate more count"><option value="4">4 more</option><option value="8" selected>8 more</option><option value="12">12 more</option></select><button class="dc-btn" id="dcMoreClips" ${activeMore||!project.sourceReusable?'disabled':''}>${activeMore?`Generating ${Math.round(Number(project.moreJob?.progress||0))}%`:project.sourceReusable?'Generate more clips':'Saved source unavailable'}</button></div></div>${project.moreJob?.status==='failed'?`<div class="dc-project-note" style="color:var(--dc-b)">${E(project.moreJob.error||'Generate more failed')}</div>`:project.moreJob?.status==='done'?`<div class="dc-project-note" style="color:var(--dc-g)">${Number(project.moreJob.importedCount||0)} new clips were added to this project.</div>`:''}<div class="dc-project-filterbar"><input id="dcProjectClipSearch" value="${E(projectQuery)}" placeholder="Search clips or transcript…"><select id="dcProjectFilter"><option value="all" ${projectFilter==='all'?'selected':''}>All clips</option><option value="ready" ${projectFilter==='ready'?'selected':''}>Needs work</option><option value="scheduled" ${projectFilter==='scheduled'?'selected':''}>Scheduled / publishing</option><option value="posted" ${projectFilter==='posted'?'selected':''}>Posted</option><option value="failed" ${projectFilter==='failed'?'selected':''}>Failed</option></select><select id="dcProjectClipSort"><option value="score" ${projectSort==='score'?'selected':''}>Highest score</option><option value="newest" ${projectSort==='newest'?'selected':''}>Newest</option><option value="duration" ${projectSort==='duration'?'selected':''}>Longest</option></select></div><div class="dc-project-clip-grid">${clips.length?clips.map(c=>{const post=(c.targets||[]).find(t=>t.postUrl),failed=(c.targets||[]).find(t=>t.status==='failed'),canSchedule=['waiting','approved','ready','publish_failed'].includes(c.status)&&c.status!=='posted',canPost=c.status!=='posted'&&!['publishing'].includes(c.status);return`<article class="dc-project-clip"><button class="dc-project-clip-media" type="button" data-project-edit="${E(c.id)}"><img loading="lazy" src="${U(c.thumbUrl)}" alt=""><span class="dc-project-clip-score">${Number(c.score||0)}</span><span class="dc-project-clip-duration">${projectDuration(c)}</span></button><div class="dc-project-clip-body"><h3>${E(c.title||'Untitled clip')}</h3><div class="dc-project-clip-sub">${E(projectClipStatus(c))}${c.scheduledLabel?` · ${E(c.scheduledLabel)}`:''}</div><div class="dc-project-targets">${(c.targets||[]).map(t=>`<span class="dc-project-target ${t.status==='failed'?'bad':t.status==='posted'?'good':''}">${E(t.provider)} · ${E(t.status)}</span>`).join('')}</div><div class="dc-project-clip-actions"><button class="dc-btn" data-project-edit="${E(c.id)}">Edit</button>${canSchedule?`<button class="dc-btn alt" data-project-schedule="${E(c.id)}">Schedule</button>`:''}${canPost?`<button class="dc-btn alt" data-project-post="${E(c.id)}">Post now</button>`:''}<a class="dc-btn alt" href="${U(`/api/clips/${encodeURIComponent(c.id)}/download`)}" download>Download</a>${post?`<a class="dc-btn alt" href="${E(post.postUrl)}" target="_blank" rel="noopener">Open post</a>`:''}${failed?`<button class="dc-btn alt" data-project-retry="${E(c.id)}" data-provider="${E(failed.provider)}">Retry ${E(failed.provider)}</button>`:''}</div></div></article>`}).join(''):`<div class="dc-empty dc-project-empty"><strong>No clips match this view</strong>Change the filter or generate more clips.</div>`}</div>`;$('#dcProjectsBack').onclick=()=>{projectId='';projectQuery='';projectSort='newest';renderProjects();window.scrollTo({top:0})};$('#dcProjectClipSearch').oninput=e=>{projectQuery=e.target.value;const pos=e.target.selectionStart;renderProjects();const input=$('#dcProjectClipSearch');input?.focus();try{input?.setSelectionRange(pos,pos)}catch{}};$('#dcProjectFilter').onchange=e=>{projectFilter=e.target.value;renderProjects()};$('#dcProjectClipSort').onchange=e=>{projectSort=e.target.value;renderProjects()};$('#dcMoreClips').onclick=async()=>{const b=$('#dcMoreClips'),count=Number($('#dcMoreCount').value||8);if(!confirm(`Generate ${count} more unused clips from this saved lecture?`))return;b.disabled=true;b.textContent='Queueing…';try{await A(`/api/projects/${encodeURIComponent(project.id)}/more-clips`,{method:'POST',body:JSON.stringify({count})});T(`${count} more clips queued`);if(typeof refresh==='function')await refresh();renderProjects()}catch(e){T(e.message,'bad')}finally{if(b){b.disabled=false;b.textContent='Generate more clips'}}};$$('[data-project-edit]').forEach(b=>b.onclick=()=>{clipId=b.dataset.projectEdit;draft=null;dirty=false;go('editor')});$$('[data-project-schedule]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Scheduling…';try{await A('/api/clips/schedule-selected',{method:'POST',body:JSON.stringify({ids:[b.dataset.projectSchedule]})});T('Clip scheduled');if(typeof refresh==='function')await refresh();renderProjects()}catch(e){T(e.message,'bad')}finally{b.disabled=false}});$$('[data-project-post]').forEach(b=>b.onclick=async()=>{const c=allClips.find(x=>x.id===b.dataset.projectPost);if(!c||!confirm(`Post “${c.title||'this clip'}” now to the enabled destinations?`))return;b.disabled=true;b.textContent='Starting…';try{await A(`/api/clips/${encodeURIComponent(c.id)}/publish`,{method:'POST'});T('Publishing started');if(typeof refresh==='function')await refresh();renderProjects()}catch(e){T(e.message,'bad')}finally{b.disabled=false}});$$('[data-project-retry]').forEach(b=>b.onclick=async()=>{b.disabled=true;b.textContent='Retrying…';try{await A(`/api/clips/${encodeURIComponent(b.dataset.projectRetry)}/retry-publish`,{method:'POST',body:JSON.stringify({provider:b.dataset.provider})});T('Publish retry queued');if(typeof refresh==='function')await refresh();renderProjects()}catch(e){T(e.message,'bad')}finally{b.disabled=false}})}
function search(){const q=$('#dcSearch').value.trim().toLowerCase(),box=$('#dcResults');if(!q){box.classList.remove('show');return}const d=D()||{},res=[];[...nav,...manageNav].filter(x=>x[1].toLowerCase().includes(q)).slice(0,4).forEach(x=>res.push({type:'page',id:x[0],title:x[1],sub:'Open page'}));(d.clips||[]).filter(c=>`${c.title} ${c.projectTitle} ${c.transcript}`.toLowerCase().includes(q)).slice(0,6).forEach(c=>res.push({type:'clip',id:c.id,title:c.title||'Clip',sub:`${c.projectTitle||'Lecture'} · ${c.score||0}/100`,img:c.thumbUrl}));(d.projects||[]).filter(p=>`${p.title} ${p.url}`.toLowerCase().includes(q)).slice(0,4).forEach(p=>res.push({type:'project',id:p.id,title:p.title||'Lecture',sub:`${p.clipCount||0} clips`}));box.innerHTML=res.map(r=>`<button data-rtype="${r.type}" data-rid="${E(r.id)}">${r.img?`<img src="${U(r.img)}">`:'<div class="dc-social-icon">⌕</div>'}<div><strong>${E(r.title)}</strong><span>${E(r.sub)}</span></div></button>`).join('')||'<div class="dc-empty">No matches</div>';box.classList.add('show');$$('[data-rtype]',box).forEach(b=>b.onclick=()=>{box.classList.remove('show');$('#dcSearch').value='';if(b.dataset.rtype==='page')go(b.dataset.rid);if(b.dataset.rtype==='clip'){clipId=b.dataset.rid;draft=null;go('editor')}if(b.dataset.rtype==='project'){projectId=b.dataset.rid;projectQuery='';go('projects')}})}
const cur=()=>D()?.clips?.find(c=>c.id===clipId)||null;
function baseDraft(c){const d=D(),t=d?.templates?.find(x=>x.id===c?.templateId)||d?.selectedTemplate||d?.templates?.[0]||d?.templateDraft||{};return{...clone(t),__clipId:c?.id}}
function field(label,key,type='text',min='',max='',step=''){const v=draft?.[key]??'';if(type==='check')return`<label class="dc-check"><input type="checkbox" data-key="${key}" ${v?'checked':''}>${label}</label>`;if(type==='select')return'';return`<div class="dc-field"><label><span>${label}</span>${type==='range'?`<b data-out="${key}">${v}</b>`:''}</label><input type="${type}" data-key="${key}" value="${E(v)}" ${min!==''?`min="${min}"`:''} ${max!==''?`max="${max}"`:''} ${step!==''?`step="${step}"`:''}></div>`}
function select(label,key,opts){return`<div class="dc-field"><label>${label}</label><select data-key="${key}">${opts.map(x=>`<option value="${E(x[0])}" ${draft?.[key]===x[0]?'selected':''}>${E(x[1])}</option>`).join('')}</select></div>`}
function inspector(c){if(tab==='captions')return`<div class="dc-group"><h3>Caption style</h3>${select('Behaviour','captionMode',[['dynamic-stack','Dynamic viral stack'],['word','Word highlight'],['phrase','Phrase captions']])}${select('Font','captionFont',[['Poppins','Poppins'],['Montserrat','Montserrat'],['Playfair Display','Playfair Display'],['Amiri','Amiri'],['Scheherazade New','Scheherazade Arabic'],['DejaVu Sans','DejaVu Sans']])}${field('Font size','captionFontSize','range',24,140,1)}${select('Vertical position','captionPosition',[['top','Top'],['middle','Middle'],['bottom','Bottom']])}${select('Alignment','captionHorizontal',[['left','Left'],['center','Centre'],['right','Right']])}<div class="dc-layouts"><label>Text <input type="color" data-key="captionPrimary" value="${E(draft.captionPrimary)}"></label><label>Highlight <input type="color" data-key="captionHighlight" value="${E(draft.captionHighlight)}"></label><label>Outline <input type="color" data-key="captionOutline" value="${E(draft.captionOutline)}"></label><label>Background <input type="color" data-key="captionBackground" value="${E(draft.captionBackground)}"></label></div>${field('Outline width','captionOutlineWidth','range',0,14,1)}${field('Uppercase','captionUppercase','check')}</div>`;
if(tab==='layout')return`<div class="dc-group"><h3>Quick layouts</h3><div class="dc-layouts"><button data-layout="speaker">Speaker focus</button><button data-layout="fit">Full video</button><button data-layout="cinema">Cinematic</button><button data-layout="clean">Clean minimal</button></div></div><div class="dc-group"><h3>Canvas</h3>${select('Aspect ratio','ratio',[['9:16','Vertical 9:16'],['1:1','Square 1:1'],['4:5','Portrait 4:5'],['16:9','Landscape 16:9']])}${select('Framing','fitMode',[['contain','Fit entire video'],['blur','Blurred background'],['crop','Fill / crop']])}${field('Smart framing','smartFramingEnabled','check')}${select('Speaker bias','smartFramingBias',[['auto','Automatic'],['left','Left'],['center','Centre'],['right','Right']])}${field('Blur strength','blurStrength','range',0,60,1)}</div>`;
if(tab==='brand')return`<div class="dc-group"><h3>Watermark</h3>${field('Text','watermark')}${select('Position','watermarkPosition',[['top-left','Top left'],['top-center','Top centre'],['top-right','Top right'],['bottom-left','Bottom left'],['bottom-center','Bottom centre'],['bottom-right','Bottom right']])}${field('Size','watermarkFontSize','range',12,90,1)}${field('Opacity','watermarkOpacity','range',0,100,1)}<div class="dc-field"><label>Colour</label><input type="color" data-key="watermarkColor" value="${E(draft.watermarkColor)}"></div>${field('Brand line','brandLineEnabled','check')}<div class="dc-field"><label>Brand line colour</label><input type="color" data-key="brandLineColor" value="${E(draft.brandLineColor)}"></div></div>`;
if(tab==='video')return`<div class="dc-group"><h3>Video look</h3>${select('Filter','filterPreset',[['natural','Natural'],['crisp','Crisp'],['warm','Warm'],['cinematic','Cinematic'],['monochrome','Monochrome'],['custom','Custom']])}${field('Brightness','brightness','range',-1,1,.05)}${field('Contrast','contrast','range',.5,2,.05)}${field('Saturation','saturation','range',0,3,.05)}${field('Sharpen','sharpen','range',0,2,.05)}${field('Vignette','vignette','range',0,1,.05)}</div>`;
if(tab==='audio')return`<div class="dc-group"><h3>Audio</h3>${field('Voice enhancement','voiceEnhance','check')}${field('Nasheed volume','musicVol','range',1,50,1)}<button class="dc-btn alt" id="dcSaveAudio">Save global music level</button></div>`;
return`<div class="dc-group"><h3>Post details</h3><div class="dc-field"><label>Title</label><input data-meta="title" value="${E(c.title||'')}"></div><div class="dc-field"><label>Description</label><textarea data-meta="description">${E(c.description||'')}</textarea></div><div class="dc-field"><label>Hashtags</label><textarea data-meta="hashtags">${E(c.hashtags||'')}</textarea></div><button class="dc-btn alt" id="dcSaveMeta">Save post copy</button></div>`}
function renderEditor(){const p=$('#view-editor'),d=D();if(!p||!d)return;const clips=[...(d.clips||[])].sort((a,b)=>(b.addedAt||0)-(a.addedAt||0));if(!clipId||!clips.some(c=>c.id===clipId))clipId=(clips.find(c=>c.status==='waiting')||clips[0])?.id||'';const c=cur();if(c&&(!draft||draft.__clipId!==c.id)){draft=baseDraft(c);draft.musicVol=d.musicSettings?.volumePercent||13;dirty=false}if(!c){p.innerHTML=`<div class="dc-page-head"><div><h1>Editor</h1><p>Generate a clip first, then edit it here.</p></div></div><div class="dc-card dc-pad"><div class="dc-empty"><strong>No clips available</strong>Create clips from Home to open the editor.</div></div>`;return}const templates=d.templates||[];p.innerHTML=`<div class="dc-editor-intro"><div><strong>${E(c.title||'Untitled clip')}</strong><span>${E(c.projectTitle||'Lecture')} · ${c.score||0}/100</span></div><span class="dc-pill ${c.status==='posted'?'good':'busy'}">${E(c.status)}</span></div><div class="dc-editor-layout"><aside class="dc-rail"><div class="dc-rail-head"><strong>Clips</strong><input id="dcClipSearch" placeholder="Search clips…"></div><div class="dc-clips" id="dcClipList">${clips.map(x=>`<button class="dc-clip ${x.id===c.id?'on':''}" data-clip="${E(x.id)}"><img src="${U(x.thumbUrl)}"><div><strong>${E(x.title||'Untitled')}</strong><span>${E(x.projectTitle||'Lecture')} · ${x.score||0}/100</span></div></button>`).join('')}</div></aside><main class="dc-stage"><div class="dc-stagebar"><button class="dc-btn alt dc-play" id="dcPlay">▶</button><label class="dc-style-pick"><span>Style</span><select id="dcPreset">${templates.map(t=>`<option value="${E(t.id)}" ${t.id===draft.id?'selected':''}>${E(t.name)}</option>`).join('')}</select></label><button class="dc-btn alt" id="dcSavePreset">Save style</button><span class="spacer"></span></div><div class="dc-canvas-wrap"><div class="dc-canvas" id="dcCanvas"><video id="dcVideo" src="${U(c.videoUrl)}" preload="metadata" playsinline></video><div class="dc-cap ${E(draft.captionPosition||'middle')} ${E(draft.captionHorizontal||'right')}">A reminder can change your entire day</div><div class="dc-water ${E(draft.watermarkPosition||'top-center')}">${E(draft.watermark||'')}</div><div class="dc-brandline"></div></div></div></main><aside class="dc-inspector"><div class="dc-tabs">${['captions','layout','brand','video','audio','post'].map(x=>`<button data-tab="${x}" class="${tab===x?'on':''}">${x[0].toUpperCase()+x.slice(1)}</button>`).join('')}</div><div class="dc-inspect">${inspector(c)}</div></aside><div class="dc-timeline"><div class="dc-timebar"><span id="dcTime">0:00</span><span>${Math.round(Number(c.startSec||0))}s–${Math.round(Number(c.endSec||0))}s source</span><span>${Math.round(Number(c.durationMs||0)/1000)} sec</span></div><div class="dc-track" id="dcTrack"><div class="dc-wave">${Array.from({length:80},(_,i)=>`<i style="height:${16+((i*17)%38)}px"></i>`).join('')}</div><div class="dc-playhead" id="dcHead"></div></div></div></div>`;makeFoot(c);bindEditor(c);preview()}
function makeFoot(c){$('#dcEditorFoot')?.remove();const f=document.createElement('div');f.id='dcEditorFoot';f.className=`dc-editor-foot ${view==='editor'?'show':''}`;f.innerHTML=`<div class="copy"><strong><i class="dc-dirty ${dirty?'on':''}"></i>${E(c.title)}</strong><span id="dcSaveNote">${dirty?'Unsaved visual changes':'Ready to edit and render'}</span></div>${c.status==='posted'?'<label class="dc-check"><input id="dcVariant" type="checkbox" checked disabled>Create repost variant</label>':'<label class="dc-check"><input id="dcVariant" type="checkbox">Keep original as variant</label>'}<button class="dc-btn alt" id="dcSaveMetaFoot">Save post details</button><button class="dc-btn" id="dcRender">Render edited clip</button>`;$('#view-editor')?.append(f);$('#dcRender').onclick=renderClip;$('#dcSaveMetaFoot').onclick=saveMeta}
function bindEditor(c){$$('[data-clip]').forEach(b=>b.onclick=()=>{clipId=b.dataset.clip;draft=null;dirty=false;renderEditor()});$('#dcClipSearch').oninput=e=>{const q=e.target.value.toLowerCase();$$('[data-clip]').forEach(b=>b.style.display=b.textContent.toLowerCase().includes(q)?'grid':'none')};$$('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderEditor()});$$('[data-key]').forEach(i=>{i.oninput=()=>change(i);i.onchange=()=>change(i)});$$('[data-layout]').forEach(b=>b.onclick=()=>layout(b.dataset.layout));$('#dcPreset').onchange=()=>{const t=D().templates.find(x=>x.id===$('#dcPreset').value);if(t){draft={...clone(t),__clipId:c.id,musicVol:D().musicSettings?.volumePercent||13};dirty=true;renderEditor()}};$('#dcSavePreset').onclick=savePreset;$('#dcSaveMeta')?.addEventListener('click',saveMeta);$('#dcSaveAudio')?.addEventListener('click',saveAudio);const v=$('#dcVideo');$('#dcPlay').onclick=()=>v.paused?v.play():v.pause();v.onplay=()=>$('#dcPlay').textContent='❚❚';v.onpause=()=>$('#dcPlay').textContent='▶';v.ontimeupdate=()=>{const pct=v.duration?100*v.currentTime/v.duration:0;$('#dcHead').style.left=`${pct}%`;$('#dcTime').textContent=`${Math.floor(v.currentTime/60)}:${String(Math.floor(v.currentTime%60)).padStart(2,'0')}`};$('#dcTrack').onclick=e=>{const r=e.currentTarget.getBoundingClientRect();if(v.duration)v.currentTime=C((e.clientX-r.left)/r.width,0,1)*v.duration}}
function change(i){let v=i.type==='checkbox'?i.checked:['range','number'].includes(i.type)?Number(i.value):i.value;if(i.dataset.key==='ratio'){const m={'9:16':[1080,1920],'1:1':[1080,1080],'4:5':[1080,1350],'16:9':[1920,1080]};[draft.width,draft.height]=m[v];draft.ratio=v}else draft[i.dataset.key]=v;$(`[data-out="${i.dataset.key}"]`)?.replaceChildren(document.createTextNode(String(v)));dirty=true;preview();$('.dc-dirty')?.classList.add('on');if($('#dcSaveNote'))$('#dcSaveNote').textContent='Unsaved visual changes'}
function preview(){if(!draft)return;const can=$('#dcCanvas'),v=$('#dcVideo'),cap=$('.dc-cap'),w=$('.dc-water'),line=$('.dc-brandline');if(!can)return;can.style.aspectRatio=`${draft.width||1080}/${draft.height||1920}`;v.style.objectFit=draft.fitMode==='crop'?'cover':'contain';const presets={natural:'',crisp:'contrast(1.08) saturate(1.08)',warm:'sepia(.15) saturate(1.12)',cinematic:'contrast(1.14) saturate(.84)',monochrome:'grayscale(1)',custom:''};v.style.filter=`${presets[draft.filterPreset]||''} brightness(${1+Number(draft.brightness||0)}) contrast(${Number(draft.contrast||1)}) saturate(${Number(draft.saturation||1)})`;cap.className=`dc-cap ${draft.captionPosition||'middle'} ${draft.captionHorizontal||'right'}`;cap.style.fontFamily=draft.captionFont||'Inter';cap.style.fontSize=`${C(Number(draft.captionFontSize||96)/3.4,15,46)}px`;cap.style.color=draft.captionPrimary||'#fff';cap.style.webkitTextStroke=`${Number(draft.captionOutlineWidth||0)/3}px ${draft.captionOutline||'#000'}`;cap.style.textTransform=draft.captionUppercase?'uppercase':'none';w.textContent=draft.watermark||'';w.className=`dc-water ${draft.watermarkPosition||'top-center'}`;w.style.color=draft.watermarkColor||'#d9b478';w.style.opacity=C(Number(draft.watermarkOpacity||100)/100,0,1);w.style.fontSize=`${C(Number(draft.watermarkFontSize||28)/2.2,7,28)}px`;line.style.display=draft.brandLineEnabled?'block':'none';line.style.background=draft.brandLineColor||'#d9b478'}
function layout(x){if(x==='speaker')Object.assign(draft,{fitMode:'crop',smartFramingEnabled:true,smartFramingBias:'auto',filterPreset:'natural',captionPosition:'middle'});if(x==='fit')Object.assign(draft,{fitMode:'contain',smartFramingEnabled:false,frameBackground:'#000'});if(x==='cinema')Object.assign(draft,{fitMode:'crop',filterPreset:'cinematic',vignette:.35,captionFont:'Playfair Display',captionPosition:'bottom'});if(x==='clean')Object.assign(draft,{fitMode:'contain',filterPreset:'natural',captionMode:'phrase',captionHorizontal:'center',captionPosition:'middle',watermark:'',brandLineEnabled:false});dirty=true;renderEditor()}
function payload(name){const x=clone(draft);delete x.__clipId;delete x.builtIn;delete x.editable;delete x.updatedAt;delete x.version;delete x.musicVol;delete x.ratio;x.id='';x.name=name||x.name||'Editor preset';return x}
async function savePreset(){const c=cur(),name=prompt('Style name',`${draft.name||c.title} · Edited`);if(!name)return;const b=$('#dcSavePreset');b.disabled=true;b.textContent='Saving…';try{const r=await A('/api/templates',{method:'POST',body:JSON.stringify({template:payload(name),select:false})});draft={...clone(r.template),__clipId:c.id,musicVol:D().musicSettings?.volumePercent||13};dirty=false;T('Style saved inside Editor');if(typeof refresh==='function')await refresh();renderEditor()}catch(e){T(e.message,'bad')}finally{if(b){b.disabled=false;b.textContent='Save style'}}}
async function saveMeta(){const c=cur();if(!c)return;const title=$('[data-meta=title]')?.value??c.title,description=$('[data-meta=description]')?.value??c.description,hashtags=$('[data-meta=hashtags]')?.value??c.hashtags;try{await A(`/api/clips/${encodeURIComponent(c.id)}`,{method:'PATCH',body:JSON.stringify({title,description,hashtags})});T('Post copy saved');if(typeof refresh==='function')await refresh()}catch(e){T(e.message,'bad')}}
async function saveAudio(){try{await A('/api/music-settings',{method:'POST',body:JSON.stringify({volumePercent:Number(draft.musicVol||13)})});T('Music level saved');if(typeof refresh==='function')await refresh()}catch(e){T(e.message,'bad')}}
async function renderClip(){const c=cur(),b=$('#dcRender');if(!c)return;b.disabled=true;b.textContent='Queueing render…';try{await saveMeta();const r=await A('/api/templates',{method:'POST',body:JSON.stringify({template:payload(`${c.title||'Clip'} · Editor`),select:false})});const variant=c.status==='posted'||Boolean($('#dcVariant')?.checked);await A(`/api/clips/${encodeURIComponent(c.id)}/rerender`,{method:'POST',body:JSON.stringify({templateId:r.template.id,asVariant:variant})});dirty=false;T(variant?'Edited variant queued':'Edited re-render queued');if(typeof refresh==='function')await refresh();go('home')}catch(e){T(e.message,'bad')}finally{if(b){b.disabled=false;b.textContent='Render edited clip'}}}
const requests=new Map();function hook(){window.addEventListener('deen:api-start',e=>{const o=e.detail||{},m=String(o.method||'GET').toUpperCase();if(m==='GET')return;requests.set(o.id,o);dock()});window.addEventListener('deen:api-end',e=>{const o=e.detail||{},m=String(o.method||'GET').toUpperCase();if(m==='GET')return;requests.delete(o.id);dock()})}function dock(){const x=[...requests.values()].at(-1),el=$('#dcWorkDock');if(!el)return;el.classList.toggle('show',!!x);if(x){$('strong',el).textContent=/rerender/.test(x.url)?'Re-render queued':/publish/.test(x.url)?'Starting upload':x.url==='/api/videos'?'Adding lecture':'Saving changes';$('span:last-child',el).textContent=x.url||'Working'}}
function sync(){build();const live=!!($('#app')&&!$('#app').classList.contains('hide'));document.body.classList.toggle('dc-live',live);$('#dcSide').style.display=live?'flex':'none';$('#dcTop').style.display=live?'flex':'none';$('#dcMobileNav').style.display=live?'flex':'none';if(!live||!D())return;const a=active(),h=$('#dcHealth');h.className=`dc-health ${a.length?'busy':!D().readiness?.ready?'bad':''}`;$('span',h).textContent=a.length?`${a.length} active`:D().readiness?.ready?'Ready':'Setup needed';if(view==='home'){ensureHome();paintHome()}const sig=`${D().clips?.map(x=>x.status+Number(x.scheduledAt||0)+(x.targets||[]).map(t=>t.status+t.progressPercent).join()).join()}|${D().projects?.map(x=>x.status+x.progress+x.moreJob?.status+x.moreJob?.progress).join()}|${D().rerenderJobs?.map(x=>x.status+x.progress).join()}|${D().log?.length}|${a.length}`;if(sig!==lastSig){lastSig=sig;const typingProject=document.activeElement?.matches?.('#dcProjectSearch,#dcProjectClipSearch');if(view==='projects'&&!typingProject)renderProjects();if(view==='editor'&&cur()&&!$('#dcVideo'))renderEditor()}}
function boot(){build();hook();setTimeout(()=>go('home'),50);setInterval(sync,1000)}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
