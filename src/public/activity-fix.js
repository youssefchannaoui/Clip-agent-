(() => {
  'use strict';
  const requests = new Map();
  const $ = selector => document.querySelector(selector);
  const escText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
  const style=document.createElement('style');
  style.textContent=`
    #globalWorkDock{position:fixed;right:18px;bottom:18px;z-index:280;display:none;min-width:290px;max-width:420px;background:rgba(14,14,16,.97);border:1px solid var(--line-lit);border-radius:14px;padding:12px 14px;box-shadow:0 18px 55px rgba(0,0,0,.45)}
    #globalWorkDock.show{display:block}#globalWorkDock .dock-row{display:flex;align-items:center;gap:10px}#globalWorkDock .dock-copy{min-width:0;flex:1}#globalWorkDock strong{display:block;font-size:13px}#globalWorkDock span{display:block;color:var(--mute);font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #nowList .live-progress{height:4px;background:var(--line);border-radius:999px;overflow:hidden;margin-top:7px}#nowList .live-progress i{display:block;height:100%;background:var(--blue);border-radius:inherit;transition:width .4s ease-out}
    #nowList .now-timing{margin-top:5px;font-variant-numeric:tabular-nums}
  `;
  document.head.appendChild(style);
  const dock=document.createElement('div');
  dock.id='globalWorkDock';
  dock.innerHTML='<div class="dock-row"><span class="spin"></span><div class="dock-copy"><strong>Working…</strong><span>Updating DeenClipped</span></div></div>';
  document.body.appendChild(dock);

  function labelFor(url,method){
    if(/\/rerender$/.test(url))return ['Re-render queued','The worker is preparing the new video'];
    if(url==='/api/clips/schedule-selected')return ['Scheduling selected clips','Assigning posting times'];
    if(/\/publish$/.test(url))return ['Starting upload','Creating the platform transfer'];
    if(/\/more-clips$/.test(url))return ['Generating more clips','Reusing the saved lecture'];
    if(/\/api\/templates/.test(url)||url==='/api/template')return ['Saving template','Updating future render settings'];
    if(url==='/api/videos')return ['Adding lecture','Creating the clipping job'];
    return ['Working…',`${method} ${url}`];
  }
  function paintDock(){
    const current=[...requests.values()].at(-1);
    dock.classList.toggle('show',Boolean(current));
    if(!current)return;
    const [title,stage]=labelFor(current.url,current.method);
    dock.querySelector('strong').textContent=title;
    dock.querySelector('.dock-copy span').textContent=stage;
  }

  window.addEventListener('deen:api-start',event=>{
    const options=event.detail||{};
    const method=String(options.method||'GET').toUpperCase();
    if(method==='GET') return null;
    requests.set(options.id,options);
    paintDock();
    return null;
  });
  window.addEventListener('deen:api-end',event=>{
    const options=event.detail||{};
    const method=String(options.method||'GET').toUpperCase();
    if(method==='GET') return null;
    requests.delete(options.id);
    paintDock();
    return null;
  });

  function fmtDuration(ms){
    if(!Number.isFinite(ms)||ms<0)return null;
    const s=Math.round(ms/1000);
    if(s<60)return `${s}s`;
    const m=Math.floor(s/60),rs=s%60;
    if(m<60)return rs?`${m}m ${rs}s`:`${m}m`;
    const h=Math.floor(m/60),rm=m%60;
    return rm?`${h}h ${rm}m`:`${h}h`;
  }
  function etaFor(row){
    const started=Number(row.startedAt||0);
    const progress=Number(row.progress);
    if(!started||!Number.isFinite(progress))return null;
    const elapsed=Date.now()-started;
    if(elapsed<4000||progress<5||progress>=100)return null;
    const remaining=elapsed/(progress/100)-elapsed;
    if(!Number.isFinite(remaining)||remaining<0||remaining>4*60*60*1000)return null;
    return remaining;
  }
  function activities(){
    const source=typeof DATA!=='undefined'?DATA:null;
    if(!source)return [];
    const out=[];
    for(const p of source.projects||[]){
      if(['queued','processing'].includes(p.status))out.push({title:p.title||'Lecture',stage:p.stage||p.status,progress:Number(p.progress||0),startedAt:p.startedAt,status:p.status});
      const m=p.moreJob;
      if(m&&['queued','processing'].includes(m.status))out.push({title:`More clips · ${p.title||'Lecture'}`,stage:m.stage||m.status,progress:Number(m.progress||0),startedAt:m.startedAt,status:m.status});
    }
    for(const j of source.rerenderJobs||[]){
      if(['queued','processing'].includes(j.status)){
        const c=(source.clips||[]).find(x=>x.id===j.clipId);
        out.push({title:`Re-rendering ${c?.title||'clip'}`,stage:j.stage||j.status,progress:Number(j.progress||0),startedAt:j.startedAt,status:j.status});
      }
    }
    for(const c of source.clips||[]){
      for(const t of c.targets||[]){
        if(['retrying','publishing','processing'].includes(t.status))out.push({title:`${c.title||'Clip'} → ${t.provider}`,stage:t.stage||t.platformStatus||t.status,progress:Number.isFinite(t.progressPercent)?Number(t.progressPercent):null,startedAt:t.startedAt||t.updatedAt,status:t.status});
      }
    }
    return out;
  }
  function render(){
    const list=$('#nowList');
    if(!list)return;
    const rows=activities();
    if(!rows.length){list.innerHTML='<div class="now-idle">Nothing is processing right now.</div>';return}
    list.innerHTML=rows.slice(0,10).map(row=>{
      const p=Number.isFinite(row.progress)?Math.max(0,Math.min(100,row.progress)):null;
      const eta=etaFor(row);
      const elapsed=row.startedAt?fmtDuration(Date.now()-Number(row.startedAt)):null;
      let timing=row.status==='queued'?'Waiting to start':eta!==null?`About ${fmtDuration(eta)} left`:p!==null&&p>0&&p<100?'Estimating time left…':'In progress';
      if(elapsed)timing+=` · running ${elapsed}`;
      return `<div class="now-item"><span class="spin"></span><div class="now-what"><div class="now-title">${escText(row.title)}</div><div class="now-stage">${escText(row.stage)}</div>${p!==null?`<div class="live-progress"><i style="width:${p}%"></i></div>`:''}<div class="now-stage now-timing">${p!==null?`${Math.round(p)}% · `:''}${escText(timing)}</div></div></div>`;
    }).join('');
  }
  setTimeout(render,0);
  setInterval(render,1000);
})();


/* Workspace redesign loader bundled here so the existing server route can load it
   without changing src/server.js or src/public/index.html. */
(() => {
  'use strict';
  if (!document.getElementById('dcWorkspaceShellStyles')) {
    const style = document.createElement('style');
    style.id = 'dcWorkspaceShellStyles';
    style.textContent = "/* DeenClipped Workspace Shell \u2014 Phase 1\n   Additive UI layer: preserves existing IDs, routes and click handlers. */\n:root{\n  --dc-bg:#0a0a0b;\n  --dc-panel:#121214;\n  --dc-panel-2:#18181b;\n  --dc-panel-3:#202024;\n  --dc-line:#2a2a2f;\n  --dc-line-strong:#3a3a42;\n  --dc-text:#f6f6f7;\n  --dc-muted:#a0a0aa;\n  --dc-subtle:#707079;\n  --dc-accent:#d9b478;\n  --dc-accent-hover:#e5c58d;\n  --dc-success:#4fbd83;\n  --dc-warning:#e5aa57;\n  --dc-danger:#ee6676;\n  --dc-sidebar-w:244px;\n  --dc-sidebar-collapsed:76px;\n  --dc-topbar-h:72px;\n  --dc-radius:10px;\n  --dc-shadow:0 18px 55px rgba(0,0,0,.34);\n}\nbody.dc-workspace{\n  overflow-x:hidden;\n  background:var(--dc-bg);\n}\nbody.dc-workspace #app{\n  min-height:100vh;\n}\nbody.dc-workspace #app>.wrap{\n  width:auto!important;\n  max-width:none!important;\n  margin:0!important;\n  padding:var(--dc-topbar-h) 28px 100px calc(var(--dc-sidebar-w) + 28px)!important;\n  transition:padding-left .2s ease;\n}\nbody.dc-workspace.dc-sidebar-collapsed #app>.wrap{\n  padding-left:calc(var(--dc-sidebar-collapsed) + 28px)!important;\n}\nbody.dc-workspace .top{\n  display:none!important;\n}\nbody.dc-workspace .shell{\n  display:block!important;\n  padding-top:28px!important;\n}\nbody.dc-workspace .main-col{\n  width:100%!important;\n}\nbody.dc-workspace .side{\n  display:none!important;\n}\nbody.dc-workspace .panel{\n  max-width:1480px;\n  margin:0 auto;\n}\nbody.dc-workspace .slab{\n  border-radius:var(--dc-radius)!important;\n  background:var(--dc-panel)!important;\n  border-color:var(--dc-line)!important;\n}\nbody.dc-workspace .btn{\n  min-height:40px;\n  border-radius:8px!important;\n}\nbody.dc-workspace .btn:not(.btn-ghost){\n  background:var(--dc-accent)!important;\n  color:#1b140a!important;\n}\nbody.dc-workspace .btn:not(.btn-ghost):hover:not([disabled]){\n  background:var(--dc-accent-hover)!important;\n}\nbody.dc-workspace .btn-ghost{\n  background:transparent!important;\n  border-color:var(--dc-line)!important;\n}\nbody.dc-workspace .btn-ghost:hover{\n  background:var(--dc-panel-2)!important;\n  border-color:var(--dc-line-strong)!important;\n}\n.dc-sidebar{\n  position:fixed;\n  inset:0 auto 0 0;\n  z-index:160;\n  width:var(--dc-sidebar-w);\n  display:flex;\n  flex-direction:column;\n  background:#0d0d0f;\n  border-right:1px solid var(--dc-line);\n  transition:width .2s ease;\n}\n.dc-sidebar__brand{\n  height:var(--dc-topbar-h);\n  display:flex;\n  align-items:center;\n  gap:12px;\n  padding:0 18px;\n  border-bottom:1px solid var(--dc-line);\n  overflow:hidden;\n}\n.dc-brandmark{\n  width:36px;height:36px;flex:0 0 36px;\n  display:grid;place-items:center;\n  border-radius:10px;\n  color:var(--dc-accent);\n  background:rgba(217,180,120,.08);\n  border:1px solid rgba(217,180,120,.2);\n}\n.dc-brandmark svg{width:21px;height:24px}\n.dc-brandcopy{min-width:0}\n.dc-brandcopy strong{\n  display:block;\n  color:var(--dc-text);\n  font:600 16px/1.25 var(--brand,Inter,sans-serif);\n  white-space:nowrap;\n}\n.dc-brandcopy span{\n  display:block;\n  color:var(--dc-subtle);\n  font-size:11px;\n  white-space:nowrap;\n}\n.dc-sidebar__scroll{\n  flex:1;\n  overflow:auto;\n  padding:14px 10px;\n}\n.dc-nav-label{\n  padding:12px 10px 7px;\n  color:var(--dc-subtle);\n  font-size:10px;\n  font-weight:700;\n  letter-spacing:.11em;\n  text-transform:uppercase;\n  white-space:nowrap;\n}\n.dc-nav{\n  display:flex;\n  flex-direction:column;\n  gap:4px;\n}\n.dc-nav-btn{\n  width:100%;\n  min-height:42px;\n  display:flex;\n  align-items:center;\n  gap:12px;\n  padding:9px 11px;\n  border-radius:8px;\n  color:var(--dc-muted);\n  text-align:left;\n  transition:background .14s ease,color .14s ease;\n}\n.dc-nav-btn:hover{\n  background:var(--dc-panel-2);\n  color:var(--dc-text);\n}\n.dc-nav-btn.is-active{\n  background:rgba(217,180,120,.11);\n  color:var(--dc-text);\n}\n.dc-nav-btn.is-active .dc-nav-icon{color:var(--dc-accent)}\n.dc-nav-icon{\n  width:20px;height:20px;flex:0 0 20px;\n  display:grid;place-items:center;\n  color:currentColor;\n}\n.dc-nav-icon svg{width:19px;height:19px;stroke:currentColor}\n.dc-nav-copy{\n  flex:1;\n  min-width:0;\n  overflow:hidden;\n  white-space:nowrap;\n  font-size:13.5px;\n  font-weight:520;\n}\n.dc-nav-count{\n  min-width:22px;\n  height:21px;\n  padding:0 6px;\n  display:grid;\n  place-items:center;\n  border-radius:999px;\n  background:var(--dc-panel-3);\n  color:var(--dc-muted);\n  font-size:11px;\n}\n.dc-nav-count:empty{display:none}\n.dc-sidebar__bottom{\n  padding:10px;\n  border-top:1px solid var(--dc-line);\n}\n.dc-sidebar-toggle{\n  width:100%;\n  display:flex;\n  align-items:center;\n  gap:12px;\n  min-height:40px;\n  padding:8px 11px;\n  border-radius:8px;\n  color:var(--dc-subtle);\n}\n.dc-sidebar-toggle:hover{background:var(--dc-panel-2);color:var(--dc-text)}\nbody.dc-workspace.dc-sidebar-collapsed .dc-sidebar{\n  width:var(--dc-sidebar-collapsed);\n}\nbody.dc-workspace.dc-sidebar-collapsed .dc-brandcopy,\nbody.dc-workspace.dc-sidebar-collapsed .dc-nav-copy,\nbody.dc-workspace.dc-sidebar-collapsed .dc-nav-label,\nbody.dc-workspace.dc-sidebar-collapsed .dc-nav-count,\nbody.dc-workspace.dc-sidebar-collapsed .dc-sidebar-toggle span{\n  display:none;\n}\nbody.dc-workspace.dc-sidebar-collapsed .dc-sidebar__brand{\n  justify-content:center;padding:0;\n}\nbody.dc-workspace.dc-sidebar-collapsed .dc-nav-btn,\nbody.dc-workspace.dc-sidebar-collapsed .dc-sidebar-toggle{\n  justify-content:center;padding-left:0;padding-right:0;\n}\n.dc-topbar{\n  position:fixed;\n  inset:0 0 auto var(--dc-sidebar-w);\n  z-index:150;\n  height:var(--dc-topbar-h);\n  display:flex;\n  align-items:center;\n  gap:18px;\n  padding:0 28px;\n  background:rgba(10,10,11,.94);\n  backdrop-filter:blur(14px);\n  border-bottom:1px solid var(--dc-line);\n  transition:left .2s ease;\n}\nbody.dc-workspace.dc-sidebar-collapsed .dc-topbar{\n  left:var(--dc-sidebar-collapsed);\n}\n.dc-topbar__title{\n  min-width:180px;\n}\n.dc-topbar__eyebrow{\n  color:var(--dc-subtle);\n  font-size:11px;\n  line-height:1.2;\n}\n.dc-topbar__title strong{\n  display:block;\n  color:var(--dc-text);\n  font-size:16px;\n  line-height:1.35;\n}\n.dc-global-search{\n  position:relative;\n  flex:1;\n  max-width:560px;\n}\n.dc-global-search input{\n  width:100%;\n  height:40px!important;\n  min-height:40px!important;\n  padding:0 38px 0 38px!important;\n  background:var(--dc-panel)!important;\n  border-color:var(--dc-line)!important;\n}\n.dc-global-search svg{\n  position:absolute;left:13px;top:11px;\n  width:18px;height:18px;\n  stroke:var(--dc-subtle);\n}\n.dc-search-kbd{\n  position:absolute;right:11px;top:9px;\n  min-width:24px;height:22px;\n  display:grid;place-items:center;\n  border:1px solid var(--dc-line);\n  border-radius:5px;\n  color:var(--dc-subtle);\n  font-size:10px;\n}\n.dc-search-results{\n  position:absolute;\n  top:46px;left:0;right:0;\n  display:none;\n  max-height:420px;\n  overflow:auto;\n  padding:7px;\n  background:var(--dc-panel);\n  border:1px solid var(--dc-line-strong);\n  border-radius:10px;\n  box-shadow:var(--dc-shadow);\n}\n.dc-search-results.is-open{display:block}\n.dc-search-result{\n  width:100%;\n  display:flex;\n  align-items:center;\n  gap:10px;\n  padding:10px;\n  border-radius:7px;\n  text-align:left;\n  color:var(--dc-text);\n}\n.dc-search-result:hover{background:var(--dc-panel-2)}\n.dc-search-thumb{\n  width:42px;height:42px;flex:0 0 42px;\n  border-radius:6px;\n  object-fit:cover;\n  background:var(--dc-panel-3);\n}\n.dc-search-copy{min-width:0}\n.dc-search-copy strong,.dc-search-copy span{\n  display:block;\n  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\n}\n.dc-search-copy strong{font-size:13px}\n.dc-search-copy span{color:var(--dc-subtle);font-size:11.5px}\n.dc-topbar__actions{\n  margin-left:auto;\n  display:flex;\n  align-items:center;\n  gap:9px;\n}\n.dc-status-button{\n  min-height:40px;\n  display:flex;\n  align-items:center;\n  gap:9px;\n  padding:0 12px;\n  border:1px solid var(--dc-line);\n  border-radius:8px;\n  color:var(--dc-muted);\n}\n.dc-status-button:hover{background:var(--dc-panel);color:var(--dc-text)}\n.dc-status-dot{\n  width:8px;height:8px;border-radius:50%;\n  background:var(--dc-success);\n}\n.dc-status-dot.is-busy{background:var(--dc-warning);box-shadow:0 0 0 4px rgba(229,170,87,.1)}\n.dc-status-dot.is-error{background:var(--dc-danger)}\n.dc-top-primary{\n  min-height:40px!important;\n  padding:0 15px!important;\n}\n.dc-home{\n  display:none;\n  max-width:1480px;\n  margin:0 auto;\n}\n.dc-home.is-active{display:block}\n.dc-home-hero{\n  display:flex;\n  align-items:flex-start;\n  justify-content:space-between;\n  gap:24px;\n  margin-bottom:24px;\n}\n.dc-home-hero h1{\n  margin:0;\n  color:var(--dc-text);\n  font:650 27px/1.2 var(--brand,Inter,sans-serif);\n  letter-spacing:-.025em;\n}\n.dc-home-hero p{\n  margin:7px 0 0;\n  color:var(--dc-muted);\n  font-size:13.5px;\n}\n.dc-home-actions{display:flex;gap:9px;flex-wrap:wrap}\n.dc-summary-grid{\n  display:grid;\n  grid-template-columns:repeat(4,minmax(0,1fr));\n  gap:14px;\n  margin-bottom:24px;\n}\n.dc-summary-card{\n  min-height:122px;\n  padding:18px;\n  text-align:left;\n  background:var(--dc-panel);\n  border:1px solid var(--dc-line);\n  border-radius:var(--dc-radius);\n  transition:border-color .14s ease,transform .14s ease;\n}\n.dc-summary-card:hover{\n  border-color:var(--dc-line-strong);\n  transform:translateY(-1px);\n}\n.dc-summary-card__top{\n  display:flex;justify-content:space-between;align-items:center;gap:12px;\n}\n.dc-summary-card__label{color:var(--dc-muted);font-size:12px;font-weight:600}\n.dc-summary-card__value{\n  margin-top:13px;\n  color:var(--dc-text);\n  font:650 29px/1 var(--brand,Inter,sans-serif);\n}\n.dc-summary-card__note{margin-top:8px;color:var(--dc-subtle);font-size:11.5px}\n.dc-home-grid{\n  display:grid;\n  grid-template-columns:minmax(0,1.55fr) minmax(320px,.85fr);\n  gap:18px;\n}\n.dc-home-stack{display:flex;flex-direction:column;gap:18px}\n.dc-home-panel{\n  background:var(--dc-panel);\n  border:1px solid var(--dc-line);\n  border-radius:var(--dc-radius);\n  overflow:hidden;\n}\n.dc-home-panel__head{\n  display:flex;align-items:center;justify-content:space-between;gap:12px;\n  min-height:54px;\n  padding:0 17px;\n  border-bottom:1px solid var(--dc-line);\n}\n.dc-home-panel__head h2{font-size:14px!important}\n.dc-home-panel__body{padding:8px}\n.dc-home-empty{\n  padding:30px 18px;\n  text-align:center;\n  color:var(--dc-subtle);\n  font-size:12.5px;\n}\n.dc-project-row,.dc-publish-row,.dc-attention-row{\n  display:flex;\n  align-items:center;\n  gap:12px;\n  padding:11px;\n  border-radius:8px;\n}\n.dc-project-row:hover,.dc-publish-row:hover,.dc-attention-row:hover{background:var(--dc-panel-2)}\n.dc-project-thumb{\n  width:68px;height:48px;flex:0 0 68px;\n  object-fit:cover;\n  border-radius:7px;\n  background:var(--dc-panel-3);\n}\n.dc-row-copy{min-width:0;flex:1}\n.dc-row-copy strong{\n  display:block;\n  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\n  font-size:13px;\n}\n.dc-row-copy span{\n  display:block;\n  margin-top:3px;\n  color:var(--dc-subtle);\n  font-size:11.5px;\n  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;\n}\n.dc-row-action{\n  flex:0 0 auto;\n  min-height:34px!important;\n  padding:0 10px!important;\n  font-size:11.5px!important;\n}\n.dc-row-time{\n  flex:0 0 auto;\n  color:var(--dc-muted);\n  font-size:11.5px;\n  text-align:right;\n}\n.dc-attention-icon{\n  width:30px;height:30px;flex:0 0 30px;\n  display:grid;place-items:center;\n  border-radius:8px;\n  background:rgba(238,102,118,.09);\n  color:var(--dc-danger);\n}\n.dc-attention-row.is-warning .dc-attention-icon{\n  background:rgba(229,170,87,.09);\n  color:var(--dc-warning);\n}\n.dc-settings-drawer,.dc-activity-drawer{\n  position:fixed;\n  inset:0 0 0 auto;\n  z-index:220;\n  width:min(520px,100vw);\n  transform:translateX(102%);\n  transition:transform .2s ease;\n  background:#0f0f11;\n  border-left:1px solid var(--dc-line);\n  box-shadow:var(--dc-shadow);\n}\n.dc-settings-drawer.is-open,.dc-activity-drawer.is-open{transform:translateX(0)}\n.dc-drawer-head{\n  height:var(--dc-topbar-h);\n  display:flex;align-items:center;justify-content:space-between;\n  padding:0 20px;\n  border-bottom:1px solid var(--dc-line);\n}\n.dc-drawer-head strong{font-size:15px}\n.dc-drawer-close{\n  width:36px;height:36px;display:grid;place-items:center;\n  border-radius:8px;color:var(--dc-muted);\n}\n.dc-drawer-close:hover{background:var(--dc-panel-2);color:var(--dc-text)}\n.dc-drawer-body{\n  height:calc(100vh - var(--dc-topbar-h));\n  overflow:auto;\n  padding:18px;\n}\n.dc-settings-group{margin-bottom:22px}\n.dc-settings-group h3{\n  margin:0 0 8px;\n  color:var(--dc-subtle);\n  font-size:10.5px;\n  letter-spacing:.09em;\n  text-transform:uppercase;\n}\n.dc-settings-link{\n  width:100%;\n  display:flex;align-items:center;justify-content:space-between;gap:12px;\n  padding:13px;\n  border-radius:8px;\n  color:var(--dc-text);\n  text-align:left;\n}\n.dc-settings-link:hover{background:var(--dc-panel-2)}\n.dc-settings-link span{color:var(--dc-subtle);font-size:11.5px}\n.dc-overlay{\n  position:fixed;inset:0;z-index:210;\n  display:none;background:rgba(0,0,0,.55);\n}\n.dc-overlay.is-open{display:block}\n.dc-toast-stack{\n  position:fixed;right:18px;bottom:18px;z-index:300;\n  display:flex;flex-direction:column;gap:8px;\n  width:min(390px,calc(100vw - 36px));\n}\n.dc-toast{\n  padding:12px 14px;\n  border:1px solid var(--dc-line-strong);\n  border-radius:9px;\n  background:#141416;\n  box-shadow:var(--dc-shadow);\n  color:var(--dc-text);\n  font-size:12.5px;\n}\n.dc-toast.is-error{border-color:rgba(238,102,118,.5)}\n.dc-toast.is-success{border-color:rgba(79,189,131,.45)}\n.dc-mobile-menu{display:none}\n@media (max-width:1100px){\n  :root{--dc-sidebar-w:210px}\n  .dc-summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}\n  .dc-home-grid{grid-template-columns:1fr}\n  .dc-global-search{max-width:360px}\n}\n@media (max-width:820px){\n  body.dc-workspace #app>.wrap,\n  body.dc-workspace.dc-sidebar-collapsed #app>.wrap{\n    padding:calc(var(--dc-topbar-h) + 18px) 16px 90px!important;\n  }\n  .dc-sidebar{transform:translateX(-102%);width:min(280px,86vw)!important;box-shadow:var(--dc-shadow)}\n  .dc-sidebar.is-mobile-open{transform:translateX(0)}\n  .dc-topbar,.dc-workspace.dc-sidebar-collapsed .dc-topbar{left:0!important;padding:0 14px}\n  .dc-mobile-menu{\n    width:40px;height:40px;display:grid;place-items:center;\n    border-radius:8px;color:var(--dc-muted);\n  }\n  .dc-mobile-menu:hover{background:var(--dc-panel);color:var(--dc-text)}\n  .dc-topbar__title{min-width:0;flex:1}\n  .dc-global-search{display:none}\n  .dc-status-button span{display:none}\n  .dc-summary-grid{grid-template-columns:1fr 1fr}\n  .dc-home-hero{display:block}\n  .dc-home-actions{margin-top:16px}\n}\n@media (max-width:540px){\n  .dc-summary-grid{grid-template-columns:1fr}\n  .dc-top-primary{padding:0 11px!important}\n  .dc-top-primary span{display:none}\n}\n@media (prefers-reduced-motion:reduce){\n  *,*::before,*::after{\n    scroll-behavior:auto!important;\n    animation-duration:.001ms!important;\n    animation-iteration-count:1!important;\n    transition-duration:.001ms!important;\n  }\n}\n";
    document.head.appendChild(style);
  }
})();

(() => {
  'use strict';

  const ICONS = {
    home:'<svg viewBox="0 0 24 24" fill="none"><path d="M3 10.8 12 3l9 7.8V21h-6v-6H9v6H3V10.8Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    projects:'<svg viewBox="0 0 24 24" fill="none"><path d="M3.5 6.5h6l1.6 2h9.4v10.8H3.5V6.5Z" stroke-width="1.7" stroke-linejoin="round"/></svg>',
    editor:'<svg viewBox="0 0 24 24" fill="none"><path d="m4 16.5 8.8-8.8 3.5 3.5L7.5 20H4v-3.5Z" stroke-width="1.7"/><path d="m14.5 6 1.7-1.7a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5L18 9.5" stroke-width="1.7"/></svg>',
    publish:'<svg viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0 4-4m-4 4-4-4" stroke-width="1.7" stroke-linecap="round"/><path d="M5 19h14" stroke-width="1.7" stroke-linecap="round"/></svg>',
    library:'<svg viewBox="0 0 24 24" fill="none"><rect x="3.5" y="4" width="7" height="7" rx="1.5" stroke-width="1.7"/><rect x="13.5" y="4" width="7" height="7" rx="1.5" stroke-width="1.7"/><rect x="3.5" y="14" width="7" height="7" rx="1.5" stroke-width="1.7"/><rect x="13.5" y="14" width="7" height="7" rx="1.5" stroke-width="1.7"/></svg>',
    analytics:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 20V10m6 10V4m6 16v-7m4 7H2" stroke-width="1.7" stroke-linecap="round"/></svg>',
    settings:'<svg viewBox="0 0 24 24" fill="none"><path d="M9.8 3.5h4.4l.7 2.3 2 .9 2.1-1.1 3.1 3.1-1.1 2.1.9 2 .1.1-2.4.7-.7 2.3-4.4 1.8-1.1-2.1-2-.9-.7-2.3H9.8l-.7 2.3-2 .9L5 5.6 1.9 8.7 3 10.8l-.9 2-.1.1 2.4.7.7 2.3 4.4-1.8 1.1 2.1 2 .9.7 2.3Z" stroke-width="1.3" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke-width="1.7"/></svg>',
    status:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 17h3l2-6 3 9 2-13 2 10h4" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    connections:'<svg viewBox="0 0 24 24" fill="none"><path d="M8.5 15.5 6 18a3 3 0 0 1-4.2-4.2l4-4A3 3 0 0 1 10 9.5" stroke-width="1.7" stroke-linecap="round"/><path d="m15.5 8.5 2.5-2.5a3 3 0 1 1 4.2 4.2l-4 4a3 3 0 0 1-4.2.3" stroke-width="1.7" stroke-linecap="round"/><path d="m8 16 8-8" stroke-width="1.7" stroke-linecap="round"/></svg>',
    search:'<svg viewBox="0 0 24 24" fill="none"><circle cx="10.5" cy="10.5" r="6.5" stroke-width="1.7"/><path d="m16 16 5 5" stroke-width="1.7" stroke-linecap="round"/></svg>',
    menu:'<svg viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke-width="1.7" stroke-linecap="round"/></svg>',
    chevron:'<svg viewBox="0 0 24 24" fill="none"><path d="m9 6 6 6-6 6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    close:'<svg viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke-width="1.7" stroke-linecap="round"/></svg>',
    collapse:'<svg viewBox="0 0 24 24" fill="none"><path d="m14 6-6 6 6 6" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const isVisible = el => Boolean(el && !el.classList.contains('hide') && getComputedStyle(el).display !== 'none');
  const state = { current:'home', drawer:null, searchOpen:false };
  let lastSnapshot = '';

  function data(){
    try { return typeof DATA !== 'undefined' && DATA ? DATA : {projects:[],clips:[],rerenderJobs:[],log:[],social:{},publishingSettings:{}}; }
    catch { return {projects:[],clips:[],rerenderJobs:[],log:[],social:{},publishingSettings:{}}; }
  }

  function fmtDate(value, withTime=true){
    if(!value) return '—';
    const date = new Date(Number(value));
    if(Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, withTime
      ? {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}
      : {month:'short',day:'numeric'}).format(date);
  }

  function relative(value){
    if(!value) return 'Recently';
    const diff = Date.now() - Number(value);
    const abs = Math.abs(diff);
    if(abs < 60_000) return 'Just now';
    if(abs < 3_600_000) return `${Math.round(abs/60_000)}m ago`;
    if(abs < 86_400_000) return `${Math.round(abs/3_600_000)}h ago`;
    if(abs < 7*86_400_000) return `${Math.round(abs/86_400_000)}d ago`;
    return fmtDate(value,false);
  }

  function statusLabel(raw){
    const map = {
      queued:'Processing', processing:'Processing', waiting:'Ready to review',
      approved:'Approved', ready:'Ready to schedule', scheduled:'Scheduled',
      publishing:'Publishing', posted:'Published', publish_failed:'Failed',
      failed:'Failed', retrying:'Retry scheduled'
    };
    return map[raw] || String(raw || 'Draft').replace(/_/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
  }

  function nextActionForProject(project, clips){
    if(project.status === 'failed') return {label:'Fix failed job',view:'queue'};
    if(['queued','processing'].includes(project.status)) return {label:'View progress',view:'queue'};
    const own = clips.filter(c=>c.projectId===project.id);
    const waiting = own.filter(c=>c.status==='waiting').length;
    const failed = own.filter(c=>c.status==='publish_failed' || (c.targets||[]).some(t=>t.status==='failed')).length;
    const approved = own.filter(c=>['approved','ready'].includes(c.status)).length;
    if(failed) return {label:'Fix failed publish',view:'schedule'};
    if(waiting) return {label:`Review ${waiting} clip${waiting===1?'':'s'}`,view:'library'};
    if(approved) return {label:'Schedule approved clips',view:'library'};
    return {label:'Open project',view:'library'};
  }

  function clickLegacy(view){
    const tab = $(`.tab[data-view="${view}"]`);
    if(tab){
      tab.click();
      setCurrent(view);
      return true;
    }
    return false;
  }

  function setCurrent(target){
    state.current = target;
    const home = $('#dcHome');
    if(home) home.classList.toggle('is-active', target==='home');
    $$('.panel').forEach(panel=>{
      if(target==='home') panel.classList.add('dc-hidden-by-home');
      else panel.classList.remove('dc-hidden-by-home');
    });
    if(target==='home'){
      $$('.panel').forEach(panel=>panel.style.display='none');
    }else{
      $$('.panel').forEach(panel=>panel.style.removeProperty('display'));
      const visiblePanel = $(`#view-${target}`);
      if(visiblePanel) visiblePanel.classList.remove('hide');
    }
    $$('.dc-nav-btn[data-target]').forEach(btn=>btn.classList.toggle('is-active', btn.dataset.target===target));
    const titles = {
      home:['Workspace','Home'],
      queue:['Workspace','Projects'],
      library:['Workspace','Content Library'],
      schedule:['Workspace','Publishing'],
      publishing:['Settings','Publishing'],
      insights:['Workspace','Analytics'],
      templates:['Settings','Presets'],
      music:['Settings','Music'],
      automation:['Settings','Automation']
    };
    const [eyebrow,title] = titles[target] || ['Workspace','DeenClipped'];
    $('#dcPageEyebrow').textContent = eyebrow;
    $('#dcPageTitle').textContent = title;
    closeSearch();
    if(target==='home') renderHome();
  }

  function navigate(target){
    if(target==='home'){
      setCurrent('home');
      return;
    }
    clickLegacy(target);
  }

  function makeNavButton({target,label,icon,countId,action}){
    const btn = document.createElement('button');
    btn.type='button';
    btn.className='dc-nav-btn';
    if(target) btn.dataset.target=target;
    btn.innerHTML=`<span class="dc-nav-icon">${ICONS[icon]}</span><span class="dc-nav-copy">${esc(label)}</span>${countId?`<span class="dc-nav-count" id="${countId}"></span>`:''}`;
    btn.addEventListener('click',()=> action ? action() : navigate(target));
    btn.title=label;
    return btn;
  }

  function createShell(){
    if($('#dcSidebar')) return;
    document.body.classList.add('dc-workspace');

    const sidebar = document.createElement('aside');
    sidebar.id='dcSidebar';
    sidebar.className='dc-sidebar';
    sidebar.innerHTML=`
      <div class="dc-sidebar__brand">
        <div class="dc-brandmark">
          <svg viewBox="0 0 24 26" fill="none"><path d="M3.2 25V11.4C3.2 6.6 12 1 12 1s8.8 5.6 8.8 10.4V25Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M10 11.2 15.4 14.6 10 18Z" fill="currentColor"/></svg>
        </div>
        <div class="dc-brandcopy"><strong>DeenClipped</strong><span>Creator workspace</span></div>
      </div>
      <div class="dc-sidebar__scroll">
        <div class="dc-nav-label">Workspace</div>
        <nav class="dc-nav" id="dcPrimaryNav"></nav>
        <div class="dc-nav-label">Manage</div>
        <nav class="dc-nav" id="dcSecondaryNav"></nav>
      </div>
      <div class="dc-sidebar__bottom">
        <button type="button" class="dc-sidebar-toggle" id="dcSidebarToggle">
          <span class="dc-nav-icon">${ICONS.collapse}</span><span>Collapse sidebar</span>
        </button>
      </div>`;
    document.body.appendChild(sidebar);

    const primary = $('#dcPrimaryNav');
    [
      {target:'home',label:'Home',icon:'home'},
      {target:'queue',label:'Projects',icon:'projects',countId:'dcProjectCount'},
      {target:'library',label:'Editor',icon:'editor',countId:'dcReviewCount'},
      {target:'schedule',label:'Publishing',icon:'publish',countId:'dcScheduleCount'},
      {target:'library',label:'Content Library',icon:'library'},
      {target:'insights',label:'Analytics',icon:'analytics'}
    ].forEach(item=>primary.appendChild(makeNavButton(item)));

    const secondary = $('#dcSecondaryNav');
    secondary.appendChild(makeNavButton({label:'Settings',icon:'settings',action:()=>openDrawer('settings')}));
    secondary.appendChild(makeNavButton({label:'System status',icon:'status',action:()=>openSystemStatus()}));
    secondary.appendChild(makeNavButton({label:'Connected accounts',icon:'connections',action:()=>{navigate('publishing');setTimeout(()=>$('#view-publishing')?.scrollIntoView({behavior:'smooth'}),0)}}));

    const topbar = document.createElement('header');
    topbar.id='dcTopbar';
    topbar.className='dc-topbar';
    topbar.innerHTML=`
      <button class="dc-mobile-menu" id="dcMobileMenu" type="button" aria-label="Open navigation">${ICONS.menu}</button>
      <div class="dc-topbar__title">
        <span class="dc-topbar__eyebrow" id="dcPageEyebrow">Workspace</span>
        <strong id="dcPageTitle">Home</strong>
      </div>
      <div class="dc-global-search">
        ${ICONS.search}
        <input id="dcGlobalSearch" type="search" autocomplete="off" placeholder="Search projects and clips" aria-label="Search projects and clips">
        <span class="dc-search-kbd">/</span>
        <div class="dc-search-results" id="dcSearchResults"></div>
      </div>
      <div class="dc-topbar__actions">
        <button type="button" class="dc-status-button" id="dcProcessingButton">
          <i class="dc-status-dot" id="dcProcessingDot"></i><span id="dcProcessingText">Idle</span>
        </button>
        <button type="button" class="dc-status-button" id="dcAttentionButton" aria-label="Needs attention">
          <span>Attention</span><b class="dc-nav-count" id="dcAttentionCount"></b>
        </button>
        <button type="button" class="btn dc-top-primary" id="dcNewProject"><span>New project</span></button>
      </div>`;
    document.body.appendChild(topbar);

    const home = document.createElement('section');
    home.id='dcHome';
    home.className='dc-home is-active';
    const shell = $('.shell');
    if(shell) shell.parentNode.insertBefore(home,shell);

    const overlay=document.createElement('div');
    overlay.id='dcOverlay';
    overlay.className='dc-overlay';
    document.body.appendChild(overlay);

    const settings=document.createElement('aside');
    settings.id='dcSettingsDrawer';
    settings.className='dc-settings-drawer';
    settings.innerHTML=`
      <div class="dc-drawer-head"><strong>Settings</strong><button class="dc-drawer-close" type="button" data-close-drawer>${ICONS.close}</button></div>
      <div class="dc-drawer-body">
        <div class="dc-settings-group"><h3>Content</h3>
          <button class="dc-settings-link" data-settings-view="automation"><b>Generation & automation</b><span>Quality, approval and limits</span></button>
          <button class="dc-settings-link" data-settings-view="templates"><b>Editor presets</b><span>Visual styles and defaults</span></button>
          <button class="dc-settings-link" data-settings-view="music"><b>Music</b><span>Nasheed library and volume</span></button>
        </div>
        <div class="dc-settings-group"><h3>Distribution</h3>
          <button class="dc-settings-link" data-settings-view="publishing"><b>Publishing & connections</b><span>Accounts and platform defaults</span></button>
          <button class="dc-settings-link" data-settings-system><b>System</b><span>FFmpeg, worker and storage health</span></button>
        </div>
      </div>`;
    document.body.appendChild(settings);

    const activity=document.createElement('aside');
    activity.id='dcActivityDrawer';
    activity.className='dc-activity-drawer';
    activity.innerHTML=`
      <div class="dc-drawer-head"><strong>Processing and attention</strong><button class="dc-drawer-close" type="button" data-close-drawer>${ICONS.close}</button></div>
      <div class="dc-drawer-body" id="dcActivityBody"></div>`;
    document.body.appendChild(activity);

    const toasts=document.createElement('div');
    toasts.id='dcToastStack';
    toasts.className='dc-toast-stack';
    document.body.appendChild(toasts);

    $('#dcSidebarToggle').addEventListener('click',()=>{
      document.body.classList.toggle('dc-sidebar-collapsed');
      localStorage.setItem('dcSidebarCollapsed',document.body.classList.contains('dc-sidebar-collapsed')?'1':'0');
    });
    if(localStorage.getItem('dcSidebarCollapsed')==='1') document.body.classList.add('dc-sidebar-collapsed');

    $('#dcMobileMenu').addEventListener('click',()=>sidebar.classList.toggle('is-mobile-open'));
    overlay.addEventListener('click',closeDrawer);
    $$('[data-close-drawer]').forEach(btn=>btn.addEventListener('click',closeDrawer));
    $$('[data-settings-view]').forEach(btn=>btn.addEventListener('click',()=>{closeDrawer();navigate(btn.dataset.settingsView)}));
    $('[data-settings-system]').addEventListener('click',openSystemStatus);
    $('#dcProcessingButton').addEventListener('click',()=>openDrawer('activity'));
    $('#dcAttentionButton').addEventListener('click',()=>openDrawer('activity'));
    $('#dcNewProject').addEventListener('click',openNewProject);
    $('#dcGlobalSearch').addEventListener('input',e=>renderSearch(e.target.value));
    $('#dcGlobalSearch').addEventListener('focus',e=>renderSearch(e.target.value));
    document.addEventListener('click',e=>{if(!e.target.closest('.dc-global-search')) closeSearch()});
    document.addEventListener('keydown',handleGlobalKeys);

    observeLegacyTabs();
    setCurrent('home');
    renderAll();
  }

  function openNewProject(){
    navigate('queue');
    setTimeout(()=>{
      $('#urls')?.focus();
      $('#urls')?.scrollIntoView({behavior:'smooth',block:'center'});
    },40);
  }

  function openDrawer(which){
    closeDrawer();
    state.drawer=which;
    $('#dcOverlay').classList.add('is-open');
    const drawer = which==='settings' ? $('#dcSettingsDrawer') : $('#dcActivityDrawer');
    drawer.classList.add('is-open');
    if(which==='activity') renderActivity();
    drawer.querySelector('button')?.focus();
  }

  function closeDrawer(){
    state.drawer=null;
    $('#dcOverlay')?.classList.remove('is-open');
    $('#dcSettingsDrawer')?.classList.remove('is-open');
    $('#dcActivityDrawer')?.classList.remove('is-open');
  }

  async function openSystemStatus(){
    openDrawer('activity');
    const body=$('#dcActivityBody');
    body.innerHTML='<div class="dc-home-empty"><span class="spin"></span><div style="margin-top:10px">Checking system health…</div></div>';
    try{
      const response=await apiGet('/api/diagnostics');
      const items=[
        ['FFmpeg',response.ffmpeg?.ok,response.ffmpeg?.error||response.ffmpeg?.version||'Ready'],
        ['Worker',response.worker?.ok,response.worker?.error||'Ready'],
        ['Renderer',response.readiness?.ready!==false,response.readiness?.reason||'Ready'],
        ['Persistent storage',true,'Connected']
      ];
      body.innerHTML=`<div class="dc-home-panel"><div class="dc-home-panel__body">${items.map(([name,ok,note])=>`
        <div class="dc-attention-row ${ok?'':'is-warning'}"><span class="dc-attention-icon">${ok?'✓':'!'}</span><div class="dc-row-copy"><strong>${esc(name)} — ${ok?'Healthy':'Needs attention'}</strong><span>${esc(note)}</span></div></div>`).join('')}</div></div>`;
    }catch(error){
      body.innerHTML=`<div class="dc-attention-row"><span class="dc-attention-icon">!</span><div class="dc-row-copy"><strong>System check failed</strong><span>${esc(error.message)}</span></div></div>`;
    }
  }

  async function apiGet(url){
    const headers={};
    try{
      const pw=localStorage.getItem('pw')||sessionStorage.getItem('pw')||'';
      if(pw) headers['x-app-password']=pw;
    }catch{}
    const response=await fetch(url,{headers});
    const text=await response.text();
    let payload={};
    try{payload=text?JSON.parse(text):{}}catch{payload={error:text}}
    if(!response.ok) throw new Error(payload.error||`${response.status} ${response.statusText}`);
    return payload;
  }

  function observeLegacyTabs(){
    $$('.tab[data-view]').forEach(tab=>tab.addEventListener('click',()=>{
      const view=tab.dataset.view;
      if(view) setTimeout(()=>setCurrent(view),0);
    }));
  }

  function renderAll(){
    renderHome();
    renderCounts();
    if(state.drawer==='activity') renderActivity();
  }

  function snapshot(){
    const d=data();
    return JSON.stringify({
      projects:(d.projects||[]).map(p=>[p.id,p.status,p.stage,p.progress,p.error,p.completedAt,p.moreJob?.status,p.moreJob?.progress]),
      clips:(d.clips||[]).map(c=>[c.id,c.status,c.scheduledAt,c.postedAt,c.rerender?.status,(c.targets||[]).map(t=>[t.provider,t.status,t.error,t.stage])]),
      social:d.social?.providers,
      activeJobs:d.activeJobs
    });
  }

  function compute(){
    const d=data();
    const projects=d.projects||[];
    const clips=d.clips||[];
    const rerenders=d.rerenderJobs||[];
    const processingProjects=projects.filter(p=>['queued','processing'].includes(p.status));
    const processingRerenders=rerenders.filter(r=>['queued','processing'].includes(r.status));
    const processingTargets=[];
    clips.forEach(c=>(c.targets||[]).forEach(t=>{if(['retrying','publishing','processing'].includes(t.status))processingTargets.push({clip:c,target:t})}));
    const ready=clips.filter(c=>c.status==='waiting');
    const scheduled=clips.filter(c=>c.status==='scheduled');
    const weekAgo=Date.now()-7*86400000;
    const publishedWeek=clips.filter(c=>c.status==='posted' && Number(c.postedAt||0)>=weekAgo);
    const attention=[];
    projects.filter(p=>p.status==='failed'||p.error).forEach(p=>attention.push({kind:'error',title:p.title||'Project failed',detail:p.error||p.stage||'Processing failed',view:'queue'}));
    rerenders.filter(r=>r.status==='failed'||r.error).forEach(r=>{
      const clip=clips.find(c=>c.id===r.clipId);
      attention.push({kind:'error',title:`Render failed: ${clip?.title||'Clip'}`,detail:r.error||r.stage||'Render failed',view:'library'});
    });
    clips.forEach(c=>(c.targets||[]).filter(t=>t.status==='failed').forEach(t=>attention.push({kind:'error',title:`${t.provider} publish failed`,detail:`${c.title}: ${t.error||t.stage||'Upload failed'}`,view:'schedule'})));
    clips.filter(c=>c.reviewRequired&&c.status==='waiting').forEach(c=>attention.push({kind:'warning',title:'Quotation review required',detail:c.title,view:'library'}));
    const ps=d.publishingSettings||{};
    const providers=d.social?.providers||{};
    ['youtube','instagram','facebook','tiktok'].forEach(name=>{
      if(ps.enabled&&ps[name]?.enabled&&!providers[name]?.connected) attention.push({kind:'warning',title:`${name} disconnected`,detail:'Reconnect the enabled publishing account.',view:'publishing'});
    });
    if(!(d.tracks||[]).length) attention.push({kind:'warning',title:'Music library is empty',detail:'Add a nasheed before generating new clips.',view:'music'});
    return {d,projects,clips,processingProjects,processingRerenders,processingTargets,ready,scheduled,publishedWeek,attention};
  }

  function renderCounts(){
    const c=compute();
    const active=c.processingProjects.length+c.processingRerenders.length+c.processingTargets.length;
    setText('dcProjectCount',c.projects.length||'');
    setText('dcReviewCount',c.ready.length||'');
    setText('dcScheduleCount',c.scheduled.length||'');
    setText('dcAttentionCount',c.attention.length||'');
    const dot=$('#dcProcessingDot');
    const text=$('#dcProcessingText');
    dot.classList.toggle('is-busy',active>0);
    dot.classList.toggle('is-error',c.attention.some(x=>x.kind==='error'));
    text.textContent=active?`${active} active`:'Idle';
  }

  function setText(id,value){const el=document.getElementById(id);if(el)el.textContent=String(value??'')}

  function renderHome(){
    const c=compute();
    const recentProjects=[...c.projects].sort((a,b)=>Number(b.completedAt||b.submittedAt||0)-Number(a.completedAt||a.submittedAt||0)).slice(0,6);
    const upcoming=[...c.scheduled].sort((a,b)=>Number(a.scheduledAt||0)-Number(b.scheduledAt||0)).slice(0,6);
    $('#dcHome').innerHTML=`
      <div class="dc-home-hero">
        <div><h1>Your content workspace</h1><p>${c.processingProjects.length||c.processingRerenders.length?'Processing is underway. You can keep working elsewhere.':'Everything is ready. Start a project or continue reviewing clips.'}</p></div>
        <div class="dc-home-actions">
          <button class="btn btn-ghost" type="button" data-home-import>Import lecture</button>
          <button class="btn" type="button" data-home-new>New project</button>
        </div>
      </div>
      <div class="dc-summary-grid">
        ${summaryCard('Processing',c.processingProjects.length+c.processingRerenders.length,'Jobs currently running','queue')}
        ${summaryCard('Ready to review',c.ready.length,'Clips waiting for your decision','library')}
        ${summaryCard('Scheduled',c.scheduled.length,'Upcoming platform posts','schedule')}
        ${summaryCard('Published this week',c.publishedWeek.length,'Completed in the last 7 days','insights')}
      </div>
      <div class="dc-home-grid">
        <div class="dc-home-stack">
          <section class="dc-home-panel">
            <div class="dc-home-panel__head"><h2>Continue working</h2><button class="btn btn-ghost btn-sm" type="button" data-home-view="queue">View all</button></div>
            <div class="dc-home-panel__body">
              ${recentProjects.length?recentProjects.map(p=>projectRow(p,c.clips)).join(''):'<div class="dc-home-empty">No projects yet. Import a lecture to create your first set of clips.</div>'}
            </div>
          </section>
          ${c.attention.length?`<section class="dc-home-panel">
            <div class="dc-home-panel__head"><h2>Needs attention</h2><span class="dc-nav-count">${c.attention.length}</span></div>
            <div class="dc-home-panel__body">${c.attention.slice(0,7).map(attentionRow).join('')}</div>
          </section>`:''}
        </div>
        <section class="dc-home-panel">
          <div class="dc-home-panel__head"><h2>Upcoming publishing</h2><button class="btn btn-ghost btn-sm" type="button" data-home-view="schedule">Open queue</button></div>
          <div class="dc-home-panel__body">
            ${upcoming.length?upcoming.map(publishRow).join(''):'<div class="dc-home-empty">Nothing is scheduled. Approve clips, then add them to the publishing queue.</div>'}
          </div>
        </section>
      </div>`;
    $$('[data-home-new],[data-home-import]').forEach(btn=>btn.addEventListener('click',openNewProject));
    $$('[data-home-view]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.homeView)));
    $$('[data-home-card]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.homeCard)));
    $$('[data-home-project]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.homeProject)));
    $$('[data-home-attention]').forEach(btn=>btn.addEventListener('click',()=>navigate(btn.dataset.homeAttention)));
  }

  function summaryCard(label,value,note,view){
    return `<button class="dc-summary-card" type="button" data-home-card="${view}">
      <div class="dc-summary-card__top"><span class="dc-summary-card__label">${esc(label)}</span><span>${ICONS.chevron}</span></div>
      <div class="dc-summary-card__value">${value}</div><div class="dc-summary-card__note">${esc(note)}</div>
    </button>`;
  }

  function projectRow(project,clips){
    const action=nextActionForProject(project,clips);
    const own=clips.filter(c=>c.projectId===project.id);
    const stage=project.status==='failed'?(project.error||'Processing failed'):(project.stage||`${own.length} clip${own.length===1?'':'s'}`);
    const thumb=own[0]?.thumbUrl||'';
    return `<div class="dc-project-row">
      ${thumb?`<img class="dc-project-thumb" loading="lazy" src="${esc(thumb)}" alt="">`:'<div class="dc-project-thumb"></div>'}
      <div class="dc-row-copy"><strong>${esc(project.title||'Untitled lecture')}</strong><span>${esc(statusLabel(project.status))} · ${esc(stage)}</span></div>
      <div class="dc-row-time">${relative(project.completedAt||project.submittedAt)}</div>
      <button class="btn btn-ghost dc-row-action" type="button" data-home-project="${action.view}">${esc(action.label)}</button>
    </div>`;
  }

  function publishRow(clip){
    const provider=(clip.targets||[]).map(t=>t.provider).join(', ')||'Local';
    return `<button class="dc-publish-row" type="button" data-home-card="schedule">
      ${clip.thumbUrl?`<img class="dc-project-thumb" loading="lazy" src="${esc(clip.thumbUrl)}" alt="">`:'<div class="dc-project-thumb"></div>'}
      <div class="dc-row-copy"><strong>${esc(clip.title||'Untitled clip')}</strong><span>${esc(provider)} · ${esc(statusLabel(clip.status))}</span></div>
      <div class="dc-row-time">${fmtDate(clip.scheduledAt)}</div>
    </button>`;
  }

  function attentionRow(item){
    return `<button class="dc-attention-row ${item.kind==='warning'?'is-warning':''}" type="button" data-home-attention="${esc(item.view)}">
      <span class="dc-attention-icon">${item.kind==='warning'?'!':'×'}</span>
      <div class="dc-row-copy"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}</span></div>
      <span>${ICONS.chevron}</span>
    </button>`;
  }

  function renderActivity(){
    const c=compute();
    const active=[];
    c.processingProjects.forEach(p=>active.push({title:p.title||'Lecture',detail:p.stage||p.status,progress:p.progress,view:'queue'}));
    c.processingRerenders.forEach(r=>{const clip=c.clips.find(x=>x.id===r.clipId);active.push({title:`Rendering ${clip?.title||'clip'}`,detail:r.stage||r.status,progress:r.progress,view:'library'})});
    c.processingTargets.forEach(({clip,target})=>active.push({title:`${clip.title} → ${target.provider}`,detail:target.stage||target.status,progress:target.progressPercent,view:'schedule'}));
    $('#dcActivityBody').innerHTML=`
      <div class="dc-settings-group"><h3>Processing now</h3>
        <div class="dc-home-panel"><div class="dc-home-panel__body">${active.length?active.map(item=>`
          <button class="dc-project-row" type="button" data-activity-view="${item.view}">
            <span class="spin"></span><div class="dc-row-copy"><strong>${esc(item.title)}</strong><span>${esc(item.detail)}${Number.isFinite(Number(item.progress))?` · ${Math.round(Number(item.progress))}%`:''}</span></div>
          </button>`).join(''):'<div class="dc-home-empty">Nothing is processing right now.</div>'}</div></div>
      </div>
      <div class="dc-settings-group"><h3>Needs attention</h3>
        <div class="dc-home-panel"><div class="dc-home-panel__body">${c.attention.length?c.attention.map(attentionRow).join(''):'<div class="dc-home-empty">No failures or blocked items need your attention.</div>'}</div></div>
      </div>`;
    $$('[data-activity-view]').forEach(btn=>btn.addEventListener('click',()=>{closeDrawer();navigate(btn.dataset.activityView)}));
    $$('[data-home-attention]').forEach(btn=>btn.addEventListener('click',()=>{closeDrawer();navigate(btn.dataset.homeAttention)}));
  }

  function renderSearch(query){
    const input=String(query||'').trim().toLowerCase();
    const results=$('#dcSearchResults');
    if(!input){
      results.innerHTML='<div class="dc-home-empty">Type a project or clip name.</div>';
      results.classList.add('is-open');
      return;
    }
    const c=compute();
    const rows=[
      ...c.projects.filter(p=>(p.title||'').toLowerCase().includes(input)).map(p=>({title:p.title,type:'Project',detail:statusLabel(p.status),view:'queue'})),
      ...c.clips.filter(p=>`${p.title||''} ${p.description||''} ${p.projectTitle||''}`.toLowerCase().includes(input)).map(p=>({title:p.title,type:'Clip',detail:`${p.projectTitle||'Project'} · ${statusLabel(p.status)}`,view:'library',thumb:p.thumbUrl}))
    ].slice(0,12);
    results.innerHTML=rows.length?rows.map((row,index)=>`<button class="dc-search-result" type="button" data-search-index="${index}">
      ${row.thumb?`<img class="dc-search-thumb" src="${esc(row.thumb)}" alt="">`:'<span class="dc-search-thumb"></span>'}
      <span class="dc-search-copy"><strong>${esc(row.title)}</strong><span>${esc(row.type)} · ${esc(row.detail)}</span></span>
    </button>`).join(''):'<div class="dc-home-empty">No matching projects or clips.</div>';
    results.classList.add('is-open');
    $$('[data-search-index]',results).forEach(btn=>btn.addEventListener('click',()=>{const row=rows[Number(btn.dataset.searchIndex)];closeSearch();navigate(row.view)}));
  }

  function closeSearch(){
    $('#dcSearchResults')?.classList.remove('is-open');
  }

  function handleGlobalKeys(event){
    if(event.key==='Escape'){
      closeSearch();
      closeDrawer();
      $('#dcSidebar')?.classList.remove('is-mobile-open');
      return;
    }
    if(event.key==='/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName||'')){
      event.preventDefault();
      $('#dcGlobalSearch')?.focus();
    }
  }

  function toast(message,type='success'){
    const el=document.createElement('div');
    el.className=`dc-toast is-${type}`;
    el.textContent=message;
    $('#dcToastStack').appendChild(el);
    setTimeout(()=>el.remove(),3600);
  }

  function hookApiEvents(){
    window.addEventListener('deen:api-end',event=>{
      const detail=event.detail||{};
      const method=String(detail.method||'GET').toUpperCase();
      if(method==='GET') return;
      setTimeout(()=>{
        renderAll();
        const label = detail.url?.includes('rerender') ? 'Render queued'
          : detail.url?.includes('schedule') ? 'Schedule updated'
          : detail.url?.includes('/publish') ? 'Publishing started'
          : 'Changes saved';
        toast(label,'success');
      },300);
    });
  }

  function boot(){
    const app=$('#app');
    if(!app) return setTimeout(boot,120);
    if(!isVisible(app)) return setTimeout(boot,120);
    createShell();
    hookApiEvents();
    setInterval(()=>{
      const next=snapshot();
      if(next!==lastSnapshot){
        lastSnapshot=next;
        renderAll();
      }
    },1200);
  }

  boot();
})();
