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
