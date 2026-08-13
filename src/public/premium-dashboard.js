(() => {
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatNumber = value => new Intl.NumberFormat('en-AU').format(Math.round(number(value)));
const formatDate = value => value ? new Intl.DateTimeFormat('en-AU', {
  day: 'numeric', month: 'short', year: 'numeric',
}).format(new Date(value)) : 'Never';
const data = () => {
  try { return typeof DATA !== 'undefined' ? DATA : null; } catch { return null; }
};
const isOperator = () => ['owner', 'admin'].includes(String(data()?.user?.role || '').toLowerCase());

const icon = {
  wallet: '<svg viewBox="0 0 24 24"><path d="M4 6.5h14a2 2 0 0 1 2 2V19H4a2 2 0 0 1-2-2V6.5a2 2 0 0 1 2-2h12"/><path d="M16 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/></svg>',
  admin: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v5c0 5.2 3.3 8.5 8 10 4.7-1.5 8-4.8 8-10V6Z"/><path d="M9 12h6M12 9v6"/></svg>',
  web: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
  refresh: '<svg viewBox="0 0 24 24"><path d="M20 7v5h-5"/><path d="M4 17v-5h5"/><path d="M6.1 9a7 7 0 0 1 11.5-2L20 9M4 15l2.4 2A7 7 0 0 0 18 15"/></svg>',
};

const css = String.raw`
/* Premium dashboard layer: no editor selectors */
body.dc-app{
  background:
    radial-gradient(circle at 28% 4%,rgba(217,180,120,.075),transparent 28%),
    radial-gradient(circle at 92% 22%,rgba(74,110,120,.055),transparent 24%),
    #08080a!important;
}
body.dc-app #dcSidebar{background:linear-gradient(180deg,rgba(15,15,18,.99),rgba(7,7,9,.99) 82%)!important;border-right-color:rgba(255,255,255,.075)!important}
body.dc-app #dcTopbar{background:rgba(9,9,11,.88)!important;border-bottom-color:rgba(255,255,255,.075)!important;box-shadow:0 16px 50px rgba(0,0,0,.16)}
body.dc-app #view-home .dc-page-head h1{font-size:30px!important;letter-spacing:-.045em!important}
body.dc-app #view-home .dc-create-card{border-radius:22px!important;padding:25px!important;background:radial-gradient(circle at 92% 5%,rgba(217,180,120,.15),transparent 34%),linear-gradient(135deg,#18130e,#111113 56%)!important;box-shadow:0 26px 80px rgba(0,0,0,.25)!important}
body.dc-app #view-home .dc-create-card h2{font-size:27px!important;letter-spacing:-.04em!important}
body.dc-app #view-home .dc-metric,
body.dc-app #view-home .dc-card{border-radius:16px!important;border-color:rgba(255,255,255,.075)!important;background:linear-gradient(165deg,rgba(255,255,255,.045),rgba(255,255,255,.018))!important;box-shadow:0 18px 55px rgba(0,0,0,.13)}
body.dc-app #view-home .dc-metric{padding:17px!important}
body.dc-app #view-home .dc-metric strong{font-size:25px!important;letter-spacing:-.035em}
body.dc-app #view-home .dc-home-grid{gap:16px!important}
body.dc-app #view-projects .dc-project-card,
body.dc-app #view-review .dc-clip-card{border-radius:17px!important;border-color:rgba(255,255,255,.075)!important;box-shadow:0 20px 60px rgba(0,0,0,.16)}
.dc-premium-nav-separator{height:1px;background:rgba(255,255,255,.065);margin:11px 9px}
.dc-premium-site-link{width:100%;min-height:39px;display:flex;align-items:center;gap:11px;padding:0 10px;border-radius:9px;color:var(--dc-muted);text-decoration:none;font-size:11px}
.dc-premium-site-link:hover{background:var(--dc-panel2);color:var(--dc-text)}
.dc-premium-site-link svg,.dc-premium-nav-button svg{width:19px;height:19px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.dc-premium-nav-button{width:100%;min-height:42px;display:flex;align-items:center;gap:11px;padding:8px 10px;border-radius:8px;color:var(--dc-muted);text-align:left;margin-bottom:3px}
.dc-premium-nav-button:hover{background:var(--dc-panel2);color:var(--dc-text)}
.dc-premium-nav-button.is-active{background:rgba(217,180,120,.11);color:var(--dc-text)}
.dc-premium-nav-button .dc-nav-icon{width:21px;height:21px;display:grid;place-items:center;flex:0 0 21px}
.dc-premium-nav-button .dc-nav-name{font-size:12.5px;font-weight:540}
body.dc-side-collapsed .dc-premium-nav-button .dc-nav-name,
body.dc-side-collapsed .dc-premium-site-link span{display:none}
body.dc-side-collapsed .dc-premium-nav-button,
body.dc-side-collapsed .dc-premium-site-link{justify-content:center;padding-left:0;padding-right:0}
.dc-wallet-bonus{display:inline-flex;align-items:center;min-height:22px;padding:0 8px;border-radius:999px;border:1px solid rgba(89,212,147,.23);background:rgba(89,212,147,.07);color:var(--dc-green);font-size:8px;font-weight:800}
.dc-topup-shop{margin:4px 30px 20px;padding:20px;border-radius:21px;border:1px solid rgba(217,180,120,.23);background:radial-gradient(circle at 0 0,rgba(217,180,120,.12),transparent 38%),rgba(255,255,255,.024)}
.dc-topup-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:13px}
.dc-topup-head h3{font-size:18px;margin:0}.dc-topup-head p{font-size:9px;color:var(--dc-muted);margin:4px 0 0}.dc-topup-head span{font-size:8px;color:var(--dc-green);white-space:nowrap}
.dc-topup-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:9px}
.dc-topup-card{padding:14px;border:1px solid var(--dc-line);border-radius:15px;background:rgba(8,8,10,.66)}
.dc-topup-card.featured{border-color:rgba(217,180,120,.4);box-shadow:0 16px 40px rgba(217,180,120,.055)}
.dc-topup-card .label{display:flex;justify-content:space-between;gap:8px;color:var(--dc-muted);font-size:8px}.dc-topup-card .label b{color:var(--dc-accent2)}
.dc-topup-card strong{display:block;font-size:26px;letter-spacing:-.04em;margin:9px 0 1px}.dc-topup-card small{display:block;color:var(--dc-muted);font-size:8px}
.dc-topup-card button{width:100%;min-height:35px;margin-top:12px;border-radius:10px;border:0;background:linear-gradient(135deg,var(--dc-accent2),var(--dc-accent));color:#171108;font-size:9px;font-weight:900}
.dc-topup-card button:disabled{opacity:.42}
#premiumAdminView{max-width:1540px;margin:0 auto}
.dc-admin-head{position:relative;overflow:hidden;padding:27px;border:1px solid rgba(217,180,120,.23);border-radius:24px;background:radial-gradient(circle at 86% 10%,rgba(217,180,120,.17),transparent 34%),linear-gradient(145deg,#17130f,#101013 60%);box-shadow:0 28px 90px rgba(0,0,0,.25);margin-bottom:16px}
.dc-admin-head:after{content:"";position:absolute;right:-80px;bottom:-130px;width:300px;height:300px;border-radius:50%;border:1px solid rgba(217,180,120,.1)}
.dc-admin-head>div{position:relative;z-index:1}.dc-admin-head span{font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:var(--dc-accent2);font-weight:900}.dc-admin-head h1{font-size:34px;letter-spacing:-.05em;margin:10px 0 6px}.dc-admin-head p{max-width:700px;color:var(--dc-muted);font-size:11px;margin:0}.dc-admin-head .dc-btn{position:absolute;right:27px;top:27px;z-index:2}
.dc-admin-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:15px}
.dc-admin-metric{padding:17px;border:1px solid var(--dc-line);border-radius:16px;background:linear-gradient(160deg,rgba(255,255,255,.045),rgba(255,255,255,.017))}
.dc-admin-metric span,.dc-admin-metric strong{display:block}.dc-admin-metric span{font-size:8px;color:var(--dc-muted);text-transform:uppercase;letter-spacing:.08em}.dc-admin-metric strong{font-size:25px;letter-spacing:-.04em;margin:7px 0 2px}.dc-admin-metric small{font-size:8px;color:var(--dc-subtle)}
.dc-admin-grid{display:grid;grid-template-columns:.75fr 1.25fr;gap:14px;margin-bottom:14px}.dc-admin-panel{padding:18px;border:1px solid var(--dc-line);border-radius:18px;background:rgba(17,17,19,.86)}.dc-admin-panel h2{font-size:13px;margin:0 0 13px}.dc-plan-bars{display:grid;gap:9px}.dc-plan-row{display:grid;grid-template-columns:72px minmax(0,1fr) 32px;align-items:center;gap:9px;font-size:9px;color:var(--dc-muted)}.dc-plan-bar{height:7px;background:var(--dc-line);border-radius:999px;overflow:hidden}.dc-plan-bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--dc-accent),var(--dc-accent2))}
.dc-admin-social{display:flex;flex-wrap:wrap;gap:7px;margin-top:15px;padding-top:14px;border-top:1px solid var(--dc-line)}.dc-admin-social span{display:inline-flex;align-items:center;gap:6px;min-height:25px;padding:0 8px;border:1px solid var(--dc-line);border-radius:999px;color:var(--dc-muted);font-size:8px}.dc-admin-social b{color:var(--dc-text)}.dc-admin-events{display:grid;gap:7px}.dc-admin-event{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:8px}.dc-admin-event:last-child{border-bottom:0}.dc-admin-event b,.dc-admin-event span{display:block}.dc-admin-event span{color:var(--dc-muted);margin-top:2px}.dc-admin-event>strong{color:var(--dc-accent2);font-size:9px}
.dc-usage-chart{height:180px;display:flex;align-items:flex-end;gap:6px;padding-top:18px}.dc-usage-day{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:100%}.dc-usage-column{width:100%;max-width:24px;min-height:2px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--dc-accent2),var(--dc-accent));position:relative}.dc-usage-column.added{box-shadow:0 0 0 2px rgba(89,212,147,.35) inset}.dc-usage-day small{font-size:6.5px;color:var(--dc-subtle);white-space:nowrap}
.dc-admin-users{overflow:hidden;border:1px solid var(--dc-line);border-radius:18px;background:rgba(17,17,19,.86)}.dc-admin-users-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:17px 18px;border-bottom:1px solid var(--dc-line)}.dc-admin-users-head h2{font-size:13px;margin:0}.dc-admin-search{width:min(300px,45%);height:35px!important;min-height:35px!important;border-radius:9px!important}
.dc-admin-table-wrap{overflow:auto}.dc-admin-table{width:100%;border-collapse:collapse;min-width:900px}.dc-admin-table th,.dc-admin-table td{text-align:left;padding:11px 14px;border-bottom:1px solid rgba(255,255,255,.055);font-size:9px}.dc-admin-table th{color:var(--dc-subtle);font-size:7.5px;text-transform:uppercase;letter-spacing:.08em;background:rgba(255,255,255,.018)}.dc-admin-table td{color:var(--dc-muted)}.dc-admin-user{display:flex;align-items:center;gap:9px}.dc-admin-avatar{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:rgba(217,180,120,.12);color:var(--dc-accent2);font-weight:850}.dc-admin-user b,.dc-admin-user span{display:block;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dc-admin-user b{color:var(--dc-text);font-size:9.5px}.dc-admin-user span{font-size:7.5px;margin-top:2px}.dc-admin-role{display:inline-flex;min-height:20px;align-items:center;padding:0 7px;border-radius:999px;background:rgba(255,255,255,.045);font-size:7.5px}.dc-admin-role.owner{background:rgba(217,180,120,.11);color:var(--dc-accent2)}
.dc-admin-empty{padding:40px;text-align:center;color:var(--dc-muted);font-size:10px}
@media(max-width:950px){.dc-admin-metrics{grid-template-columns:repeat(2,1fr)}.dc-admin-grid{grid-template-columns:1fr}.dc-topup-grid{grid-template-columns:1fr}.dc-topup-shop{margin-left:18px;margin-right:18px}}
@media(max-width:560px){.dc-admin-metrics{grid-template-columns:1fr}.dc-admin-head .dc-btn{position:static;margin-top:16px}.dc-admin-head h1{font-size:28px}.dc-admin-users-head{align-items:stretch;flex-direction:column}.dc-admin-search{width:100%}}
`;

function injectStyles() {
  if ($('#dcPremiumStyles')) return;
  const style = document.createElement('style');
  style.id = 'dcPremiumStyles';
  style.textContent = css;
  document.head.append(style);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload;
}

function billingInfo() {
  return data()?.billing || {};
}

function addNavigation() {
  const nav = $('.dc-nav-scroll');
  const bottom = $('.dc-sidebar-bottom');
  if (!nav || !bottom || $('#dcPremiumBillingNav')) return false;
  const user = data()?.user;
  if (!user) return false;
  const group = document.createElement('div');
  group.className = 'dc-nav-group';
  group.id = 'dcPremiumManageGroup';
  group.innerHTML = `<div class="dc-nav-label"><span>Account</span><i></i></div>
    <button class="dc-premium-nav-button" id="dcPremiumBillingNav" type="button"><span class="dc-nav-icon">${icon.wallet}</span><span class="dc-nav-name">Plans & tokens</span></button>
    ${isOperator() ? `<button class="dc-premium-nav-button" id="dcPremiumAdminNav" type="button"><span class="dc-nav-icon">${icon.admin}</span><span class="dc-nav-name">Admin analytics</span></button>` : ''}`;
  nav.append(group);

  if (isOperator()) {
    const website = document.createElement('a');
    website.className = 'dc-premium-site-link';
    website.href = '/';
    website.innerHTML = `${icon.web}<span>Public website</span>`;
    bottom.prepend(website);
  }

  $('#dcPremiumBillingNav')?.addEventListener('click', () => $('#dcTokenPill')?.click());
  $('#dcPremiumAdminNav')?.addEventListener('click', openAdmin);

  document.addEventListener('click', event => {
    if (event.target.closest('[data-dc-nav]')) closeAdmin();
  }, true);

  addAccountMenuLinks();
  return true;
}

function addAccountMenuLinks() {
  const menu = $('.dc-account-menu');
  if (!menu || menu.dataset.premiumLinks === '1') return;
  if (!data()?.user) return;
  menu.dataset.premiumLinks = '1';
  const billing = document.createElement('button');
  billing.type = 'button';
  billing.className = 'dc-account-action';
  billing.innerHTML = '<span>Plans & token shop</span><b>Open</b>';
  billing.addEventListener('click', () => {
    menu.classList.remove('show');
    $('#dcTokenPill')?.click();
  });
  const form = $('form', menu);
  menu.insertBefore(billing, form || null);
  if (isOperator()) {
    const website = document.createElement('a');
    website.className = 'dc-account-action';
    website.href = '/';
    website.style.textDecoration = 'none';
    website.innerHTML = '<span>Public website</span><b>Open</b>';
    menu.insertBefore(website, form || null);
    const adminButton = document.createElement('button');
    adminButton.type = 'button';
    adminButton.className = 'dc-account-action';
    adminButton.innerHTML = '<span>Admin analytics</span><b>Owner</b>';
    adminButton.addEventListener('click', () => {
      menu.classList.remove('show');
      openAdmin();
    });
    menu.insertBefore(adminButton, form || null);
  }
}

function addTopupShop(layer) {
  const card = $('.dc-billing-card', layer);
  if (!card || $('.dc-topup-shop', card)) return;
  const bill = billingInfo();
  const cur = bill.current || {};
  const packs = ['boost100', 'boost300', 'boost750'].map(id => bill.topups?.[id]).filter(Boolean);
  if (!packs.length) return;
  const section = document.createElement('section');
  section.className = 'dc-topup-shop';
  section.innerHTML = `<div class="dc-topup-head"><div><h3>One-time token shop</h3><p>Add extra tokens without changing your current subscription.</p></div><span>${cur.unlimited ? 'Owner account is unlimited' : `${formatNumber(cur.bonusTokens || 0)} top-up tokens in wallet`}</span></div>
    <div class="dc-topup-grid">${packs.map(pack => `<article class="dc-topup-card ${pack.id === 'boost300' ? 'featured' : ''}">
      <div class="label"><span>${esc(pack.name)}</span><b>${esc(pack.badge || '')}</b></div>
      <strong>+${formatNumber(pack.tokens)}</strong><small>tokens · ${esc(pack.priceLabel || 'Price set in Stripe')}</small>
      <button type="button" data-premium-topup="${esc(pack.id)}" ${pack.enabled && !cur.unlimited ? '' : 'disabled'}>${cur.unlimited ? 'Unlimited account' : pack.enabled ? 'Add tokens' : 'Stripe price needed'}</button>
    </article>`).join('')}</div>`;
  const foot = $('.dc-billing-foot', card);
  card.insertBefore(section, foot || null);
  $$('[data-premium-topup]', section).forEach(button => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const original = button.textContent;
      try {
        button.disabled = true;
        button.textContent = 'Opening Stripe…';
        const result = await request('/api/billing/topup-checkout', {
          method: 'POST',
          body: JSON.stringify({ package: button.dataset.premiumTopup }),
        });
        if (!result.url) throw new Error('Stripe did not return a checkout URL.');
        location.href = result.url;
      } catch (error) {
        button.disabled = false;
        button.textContent = original;
        if (typeof toast === 'function') toast(error.message, 'bad');
        else alert(error.message);
      }
    });
  });
  const usageMeta = $('.dc-usage-meta', card);
  if (usageMeta && !$('.dc-wallet-bonus', usageMeta) && !cur.unlimited) {
    const badge = document.createElement('span');
    badge.className = 'dc-wallet-bonus';
    badge.textContent = `${formatNumber(cur.bonusTokens || 0)} top-up tokens`;
    usageMeta.append(badge);
  }
}

function observeBilling() {
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.id === 'dcBillingLayer') addTopupShop(node);
        const layer = node.querySelector?.('#dcBillingLayer');
        if (layer) addTopupShop(layer);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const existing = $('#dcBillingLayer');
  if (existing) addTopupShop(existing);
}

function ensureAdminView() {
  let view = $('#premiumAdminView');
  if (view) return view;
  const main = $('.main-col');
  if (!main) return null;
  view = document.createElement('section');
  view.id = 'premiumAdminView';
  view.className = 'panel hide';
  view.innerHTML = '<div class="dc-admin-empty">Loading owner analytics…</div>';
  main.append(view);
  return view;
}

function closeAdmin() {
  const view = $('#premiumAdminView');
  if (view) view.classList.add('hide');
  $('#dcPremiumAdminNav')?.classList.remove('is-active');
}

async function openAdmin() {
  if (!isOperator()) return;
  const view = ensureAdminView();
  if (!view) return;
  $$('.main-col > .panel').forEach(panel => panel.classList.add('hide'));
  view.classList.remove('hide');
  $$('[data-dc-nav]').forEach(button => button.classList.remove('is-active'));
  $('#dcPremiumAdminNav')?.classList.add('is-active');
  if ($('#dcPageName')) $('#dcPageName').textContent = 'Admin analytics';
  if ($('#dcPageSub')) $('#dcPageSub').textContent = 'Owner/admin-only product usage and account health';
  document.body.classList.remove('dc-menu-open');
  await renderAdmin();
}

function metric(label, value, detail) {
  return `<article class="dc-admin-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(detail)}</small></article>`;
}

function renderPlans(plans = {}) {
  const order = ['free', 'weekly', 'monthly', 'yearly', 'admin', 'other'];
  const maximum = Math.max(1, ...order.map(key => number(plans[key])));
  return order.filter(key => number(plans[key]) > 0).map(key => `<div class="dc-plan-row"><span>${esc(key)}</span><div class="dc-plan-bar"><i style="width:${Math.max(5, number(plans[key]) / maximum * 100)}%"></i></div><b>${formatNumber(plans[key])}</b></div>`).join('') || '<div class="dc-admin-empty">No plan data yet.</div>';
}

function renderUsage(usage = []) {
  const maximum = Math.max(1, ...usage.map(day => Math.max(number(day.tokensUsed), number(day.tokensAdded))));
  return usage.map(day => {
    const amount = Math.max(number(day.tokensUsed), number(day.tokensAdded));
    const height = Math.max(2, amount / maximum * 138);
    const label = new Date(`${day.date}T00:00:00Z`).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    return `<div class="dc-usage-day" title="${esc(`${label}: ${day.tokensUsed} used, ${day.tokensAdded} added`)}"><div class="dc-usage-column ${day.tokensAdded > day.tokensUsed ? 'added' : ''}" style="height:${height}px"></div><small>${esc(label)}</small></div>`;
  }).join('');
}

function renderRecentEvents(events = []) {
  return events.slice(0, 8).map(event => `<div class="dc-admin-event"><div><b>${esc(event.message || event.type || 'Billing activity')}</b><span>${esc(formatDate(event.createdAt))}</span></div><strong>${event.amount ? `${event.type === 'tokens_charged' ? '−' : '+'}${formatNumber(event.amount)}` : '—'}</strong></div>`).join('') || '<div class="dc-admin-empty">No billing activity yet.</div>';
}

function userRow(user) {
  const avatar = user.picture
    ? `<img class="dc-admin-avatar" src="${esc(user.picture)}" alt="">`
    : `<span class="dc-admin-avatar">${esc((user.name || user.email || 'U').slice(0, 1).toUpperCase())}</span>`;
  return `<tr data-admin-user-row data-admin-search="${esc(`${user.name} ${user.email} ${user.plan} ${user.role}`.toLowerCase())}">
    <td><div class="dc-admin-user">${avatar}<div><b>${esc(user.name)}</b><span>${esc(user.email || 'No email')}</span></div></div></td>
    <td><span class="dc-admin-role ${user.role === 'owner' ? 'owner' : ''}">${esc(user.role)}</span></td>
    <td>${esc(user.plan)}</td>
    <td>${user.remainingTokens === null ? '∞' : formatNumber(user.remainingTokens)}</td>
    <td>${formatNumber(user.projects)}</td>
    <td>${formatNumber(user.clips)}</td>
    <td>${formatNumber(user.posted)}</td>
    <td>${esc(formatDate(user.lastLoginAt))}</td>
  </tr>`;
}

async function renderAdmin() {
  const view = ensureAdminView();
  if (!view) return;
  view.innerHTML = '<div class="dc-admin-empty">Loading owner analytics…</div>';
  try {
    const result = await request('/api/admin/analytics');
    const overview = result.overview || {};
    view.innerHTML = `<section class="dc-admin-head"><div><span>Admin control centre</span><h1>See how DeenClipped is being used.</h1><p>Private analytics for accounts, projects, generated clips, publishing activity and token usage. This page is available only to owner and admin roles.</p></div><button class="dc-btn secondary dc-svg" id="dcAdminRefresh" type="button">${icon.refresh} Refresh</button></section>
      <section class="dc-admin-metrics">
        ${metric('Total users', formatNumber(overview.users), `${formatNumber(overview.newUsers30d)} joined in 30 days`)}
        ${metric('Active users', formatNumber(overview.activeUsers7d), 'Signed in during the last 7 days')}
        ${metric('Projects', formatNumber(overview.projects), `${formatNumber(overview.processingProjects)} processing now`)}
        ${metric('Generated clips', formatNumber(overview.clips), `${formatNumber(overview.postedClips)} posted`)}
        ${metric('Ready clips', formatNumber(overview.readyClips), 'Waiting, approved or scheduled')}
        ${metric('Failed projects', formatNumber(overview.failedProjects), 'Needs attention')}
        ${metric('Paid users', formatNumber(overview.paidUsers), `${formatNumber(overview.trialUsers)} trialing`)}
        ${metric('Free users', formatNumber(overview.freeUsers), 'Starter accounts')}
        ${metric('Tokens used', formatNumber(overview.tokensUsed30d), 'Across the last 30 days')}
        ${metric('Top-up tokens sold', formatNumber(overview.tokensSold30d), 'Across the last 30 days')}
        ${metric('Top-up balances', formatNumber(overview.purchasedTopupBalance), 'Unused purchased tokens')}
      </section>
      <section class="dc-admin-grid"><article class="dc-admin-panel"><h2>Accounts by plan</h2><div class="dc-plan-bars">${renderPlans(result.plans)}</div><div class="dc-admin-social">${Object.entries(result.social || {}).map(([provider, count]) => `<span>${esc(provider)} <b>${formatNumber(count)}</b></span>`).join('')}</div></article><article class="dc-admin-panel"><h2>14-day token activity</h2><div class="dc-usage-chart">${renderUsage(result.usage)}</div></article></section>
      <section class="dc-admin-panel" style="margin-bottom:14px"><h2>Recent billing activity</h2><div class="dc-admin-events">${renderRecentEvents(result.recentActivity)}</div></section>
      <section class="dc-admin-users"><div class="dc-admin-users-head"><div><h2>Creator accounts</h2><span class="code">${formatNumber(result.users?.length || 0)} accounts shown</span></div><input class="dc-admin-search" id="dcAdminSearch" placeholder="Search name, email, plan or role"></div><div class="dc-admin-table-wrap"><table class="dc-admin-table"><thead><tr><th>Account</th><th>Role</th><th>Plan</th><th>Tokens</th><th>Projects</th><th>Clips</th><th>Posted</th><th>Last login</th></tr></thead><tbody>${(result.users || []).map(userRow).join('')}</tbody></table></div></section>`;
    $('#dcAdminRefresh')?.addEventListener('click', renderAdmin);
    $('#dcAdminSearch')?.addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      $$('[data-admin-user-row]', view).forEach(row => {
        row.style.display = !query || row.dataset.adminSearch.includes(query) ? '' : 'none';
      });
    });
  } catch (error) {
    view.innerHTML = `<div class="dc-admin-empty"><strong>Analytics could not load.</strong><br>${esc(error.message)}</div>`;
  }
}

function addSettingsWebsiteLink() {
  if (!isOperator()) return;
  const view = $('#view-automation');
  if (!view || $('[data-premium-website-card]', view)) return;
  const card = document.createElement('div');
  card.className = 'dc-card dc-card-pad';
  card.dataset.premiumWebsiteCard = '1';
  card.style.marginTop = '14px';
  card.innerHTML = `<div class="dc-card-head"><div><h2>Public website</h2><p>Open the sales homepage without signing out.</p></div><a class="dc-btn secondary" href="/">Open website</a></div>`;
  view.append(card);
}

function boot() {
  injectStyles();
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    if (addNavigation() || attempts > 120) clearInterval(timer);
    addAccountMenuLinks();
    addSettingsWebsiteLink();
  }, 250);
  observeBilling();
  const params = new URLSearchParams(location.search);
  if (params.get('admin') === '1') {
    const openTimer = setInterval(() => {
      if ($('#dcPremiumAdminNav')) {
        clearInterval(openTimer);
        openAdmin();
      }
    }, 300);
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
})();
