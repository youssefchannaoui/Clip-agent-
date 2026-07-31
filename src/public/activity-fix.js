(() => {
  'use strict';
  const requests = new Map();
  const $ = selector => document.querySelector(selector);
  const escText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const style=document.createElement('style');
  style.textContent=`
    #globalWorkDock{position:fixed;right:18px;bottom:18px;z-index:180;display:none;min-width:290px;max-width:420px;background:rgba(14,14,16,.97);border:1px solid var(--line-lit);border-radius:14px;padding:12px 14px;box-shadow:0 18px 55px rgba(0,0,0,.45)}
    #globalWorkDock.show{display:block}#globalWorkDock .dock-row{display:flex;align-items:center;gap:10px}#globalWorkDock .dock-copy{min-width:0;flex:1}#globalWorkDock strong{display:block;font-size:13px}#globalWorkDock span{display:block;color:var(--mute);font-size:12px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #nowList .live-progress{height:4px;background:var(--line);border-radius:999px;overflow:hidden;margin-top:7px}#nowList .live-progress i{display:block;height:100%;background:var(--blue);border-radius:inherit;transition:width .4s ease-out}
    #nowList .now-timing{margin-top:5px;font-variant-numeric:tabular-nums}
  `;
  document.head.appendChild(style);
  const dock=document.createElement('div');dock.id='globalWorkDock';dock.innerHTML='<div class="dock-row"><span class="spin"></span><div class="dock-copy"><strong>Working…</strong><span>Updating DeenClipped</span></div></div>';document.body.appendChild(dock);

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
    const current=[...requests.values()].at(-1);dock.classList.toggle('show',Boolean(current));
    if(!current)return;const [title,stage]=labelFor(current.url,current.method);dock.querySelector('strong').textContent=title;dock.querySelector('.dock-copy span').textContent=stage;
  }
  window.addEventListener('deen:api-start',e=>{requests.set(e.detail.id,e.detail);paintDock()});
  window.addEventListener('deen:api-end',e=>{requests.delete(e.detail.id);paintDock()});

  function fmtDuration(ms){
    if(!Number.isFinite(ms)||ms<0)return null;
    const s=Math.round(ms/1000);
    if(s<60)return `${s}s`;
    const m=Math.floor(s/60),rs=s%60;
    if(m<60)return rs?`${m}m ${rs}s`:`${m}m`;
    const h=Math.floor(m/60),rm=m%60;
    return rm?`${h}h ${rm}m`:`${h}h`;
  }

  /**
   * Work out a real ETA from how long this job has actually been running
   * and how far it has actually got — not a fixed guess. Deliberately
   * returns null rather than a number when an estimate would be
   * meaningless (nothing started yet, no measurable progress, or so
   * little progress that the projection would swing wildly), because a
   * confidently wrong ETA is worse than honestly saying "estimating".
   */
  function etaFor(row){
    const started=Number(row.startedAt||0);
    const progress=Number(row.progress);
    if(!started||!Number.isFinite(progress))return null;
    const elapsed=Date.now()-started;
    if(elapsed<4000)return null;           // too early to say anything useful
    if(progress<5||progress>=100)return null; // projection unreliable at the extremes
    const totalEstimate=elapsed/(progress/100);
    const remaining=totalEstimate-elapsed;
    if(!Number.isFinite(remaining)||remaining<0)return null;
    if(remaining>4*60*60*1000)return null;  // implausible; don't show a silly number
    return remaining;
  }

  function activities(){
    const data=typeof DATA!=='undefined'?DATA:null;if(!data)return [];
    const out=[];
    for(const p of data.projects||[]){
      if(['queued','processing'].includes(p.status))out.push({title:p.title||'Lecture',stage:p.stage||p.status,progress:Number(p.progress||0),startedAt:p.startedAt,status:p.status,kind:'Clipping lecture'});
      const m=p.moreJob;if(m&&['queued','processing'].includes(m.status))out.push({title:`More clips · ${p.title||'Lecture'}`,stage:m.stage||m.status,progress:Number(m.progress||0),startedAt:m.startedAt,status:m.status,kind:'Generating more clips'});
    }
    for(const j of data.rerenderJobs||[]){if(['queued','processing'].includes(j.status)){const c=(data.clips||[]).find(x=>x.id===j.clipId);out.push({title:`Re-rendering ${c?.title||'clip'}`,stage:j.stage||j.status,progress:Number(j.progress||0),startedAt:j.startedAt,status:j.status,kind:'Re-rendering clip'})}}
    for(const c of data.clips||[]){for(const t of c.targets||[]){if(['retrying','publishing','processing'].includes(t.status))out.push({title:`${c.title||'Clip'} → ${t.provider}`,stage:t.stage||t.platformStatus||t.status,progress:Number.isFinite(t.progressPercent)?Number(t.progressPercent):null,startedAt:t.startedAt||t.updatedAt,status:t.status,kind:'Publishing'})}}
    return out;
  }
  function render(){
    const list=$('#nowList');if(!list)return;const rows=activities();
    if(!rows.length){list.innerHTML='<div class="now-idle">Nothing is processing right now.</div>';return}
    list.innerHTML=rows.slice(0,10).map(row=>{
      const p=Number.isFinite(row.progress)?Math.max(0,Math.min(100,row.progress)):null;
      const eta=etaFor(row);
      const elapsed=row.startedAt?fmtDuration(Date.now()-Number(row.startedAt)):null;

      let timing;
      if(row.status==='queued'){
        timing='Waiting to start';
      }else if(eta!==null){
        timing=`About ${fmtDuration(eta)} left`;
      }else if(p!==null&&p>0&&p<100){
        timing='Estimating time left…';
      }else{
        timing='In progress';
      }
      if(elapsed)timing+=` · running ${elapsed}`;

      return `<div class="now-item"><span class="spin"></span><div class="now-what">`
        +`<div class="now-title">${escText(row.title)}</div>`
        +`<div class="now-stage">${escText(row.stage)}</div>`
        +(p!==null?`<div class="live-progress"><i style="width:${p}%"></i></div>`:'')
        +`<div class="now-stage now-timing">${p!==null?`${Math.round(p)}% · `:''}${escText(timing)}</div>`
        +`</div></div>`;
    }).join('');
  }
  const observer=new MutationObserver(()=>setTimeout(render,0));
  const start=()=>{const list=$('#nowList');if(list)observer.observe(list,{childList:true});render()};
  setTimeout(start,0);setInterval(render,1000);
})();
