/* ==========================================================================
 * ADMIN CONSOLE  (owner / admin accounts only)
 * ========================================================================== */

let adminOps = null;
let adminOpsLoading = false;
let adminOpsError = '';
let adminTab = 'overview';
let adminAnalytics = null;

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
  const tabs=[['overview','Overview'],['subscriptions','Subscriptions'],['storage','Storage'],['integrations','Integrations'],['vendors','Costs & renewals'],['users','Users']];
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

  return `${alerts.length?`<section class="dc-admin-alerts">${alerts.map(a=>`<div class="dc-admin-alert">${ICON.alert||''}<span>${esc(a)}</span></div>`).join('')}</section>`:''}
  <div class="dc-admin-grid">${cards.map(([label,value,sub2])=>`<article class="dc-admin-card"><span class="dc-admin-card-label">${esc(label)}</span><strong>${esc(String(value))}</strong><em>${esc(sub2)}</em></article>`).join('')}</div>`;
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
  const rows=users.slice(0,100).map(u=>`<tr><td><strong>${esc(u.name)}</strong><span class="dc-admin-dim">${esc(u.email)}</span></td><td>${esc(u.plan)}</td><td>${esc(u.billingStatus)}</td><td>${u.projects}</td><td>${u.clips}</td><td>${u.posted}</td><td>${formatDay(u.createdAt)}</td><td>${u.lastLoginAt?formatRelative(u.lastLoginAt):'—'}</td></tr>`).join('');
  return `<section class="dc-admin-panel"><div class="dc-admin-panel-head"><h2>Accounts</h2><span class="dc-status-pill">${users.length} shown</span></div>
    <table class="dc-admin-table"><thead><tr><th>Account</th><th>Plan</th><th>Status</th><th>Videos</th><th>Clips</th><th>Posted</th><th>Joined</th><th>Last seen</th></tr></thead><tbody>${rows||'<tr><td colspan="8">No accounts yet.</td></tr>'}</tbody></table></section>`;
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
      :adminTab==='subscriptions'?adminSubscriptions()
        :adminTab==='storage'?adminStorage()
          :adminTab==='integrations'?adminIntegrations()
            :adminTab==='vendors'?adminVendors()
              :adminUsers();
  panel.innerHTML=`<div class="dc-manage-page">
    <section class="dc-studio-hero"><div><span class="dc-manage-kicker">${ICON.analytics} Admin console</span><h1>Everything about the business in one place.</h1><p>Only owner and admin accounts can see this page. Creators never see this tab.</p></div><div class="dc-studio-actions"><button class="dc-btn secondary" type="button" id="dcAdminRefresh">Refresh</button></div></section>
    ${adminTabs()}${body}</div>`;
  $('#dcAdminRefresh')?.addEventListener('click',()=>{adminOps=null;adminAnalytics=null;renderAdminPage();});
  $('#dcAdminRetry')?.addEventListener('click',()=>{adminOpsError='';adminOps=null;renderAdminPage();});
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
