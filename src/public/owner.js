/*
 * Owner dashboard.
 *
 * Two rules this file keeps, both deliberate:
 *
 * 1. Nothing is ever built by interpolating into innerHTML. This page renders
 *    account names, emails and cost names -- all attacker-supplied in the case
 *    of an email -- and the product has already shipped one reflected XSS. The
 *    `el` helper sets textContent, so a name containing markup renders as that
 *    name and nothing else.
 * 2. A figure that is not known renders as "not set", never as zero. A burn of
 *    $0 and a burn nobody has entered look identical in a total, and only one
 *    of them means the business is free to run.
 */
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const state = { finance: null, analytics: null, days: 180, meta: null, userFilter: '' };

  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'text') node.textContent = String(value);
      else if (key === 'class') node.className = value;
      else if (key === 'dataset') for (const [k, v] of Object.entries(value)) node.dataset[k] = String(v);
      else node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  }

  const replace = (host, nodes) => { if (host) { host.replaceChildren(...[].concat(nodes).filter(Boolean)); } };

  /** Minor units in, human money out. Falls back to a plain number if the currency code is junk. */
  function money(minor, currency) {
    const amount = Number(minor || 0) / 100;
    const code = String(currency || state.finance?.currency || 'aud').toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(amount);
    } catch {
      return `${code} ${amount.toFixed(2)}`;
    }
  }

  const num = value => new Intl.NumberFormat().format(Number(value || 0));

  function date(ms) {
    if (!ms) return '—';
    const d = new Date(Number(ms));
    return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  }

  function relativeDays(days) {
    if (days === null || days === undefined) return '';
    if (days < 0) return `${Math.abs(days)}d overdue`;
    if (days === 0) return 'today';
    if (days === 1) return 'tomorrow';
    return `in ${days}d`;
  }

  function tile(label, value, { foot = '', tone = '' } = {}) {
    const valueClass = ['ow-tile-value', tone && `is-${tone}`].filter(Boolean).join(' ');
    return el('div', { class: 'ow-tile' }, [
      el('div', { class: 'ow-tile-label', text: label }),
      el('div', { class: valueClass, text: value }),
      foot ? el('div', { class: 'ow-tile-foot', text: foot }) : null,
    ]);
  }

  function table(headers, rows, { empty = 'Nothing yet.' } = {}) {
    // `h.label || h` printed "[object Object]" for the deliberately blank
    // action column, because an empty label fell through to the object itself.
    const thead = el('thead', {}, el('tr', {}, headers.map(h =>
      el('th', { class: h.num ? 'num' : '', text: typeof h === 'string' ? h : (h.label ?? '') }))));
    if (!rows.length) {
      return [thead, el('tbody', {}, el('tr', {}, el('td', { colspan: String(headers.length) },
        el('div', { class: 'ow-empty', text: empty }))))];
    }
    return [thead, el('tbody', {}, rows)];
  }

  // ── overview ─────────────────────────────────────────────────────────────
  function renderOverview() {
    const f = state.finance;
    const a = state.analytics;
    if (!f) return;

    const burnKnown = f.moneyOut.unpricedCount === 0;
    const profit = f.profit.monthlyNetMinor;

    replace($('overviewTiles'), [
      tile('Recurring revenue (MRR)', f.moneyIn.mrrMinor ? money(f.moneyIn.mrrMinor) : 'none active', {
        foot: f.moneyIn.activeSubscriptions
          ? `${num(f.moneyIn.activeSubscriptions)} active subscription${f.moneyIn.activeSubscriptions === 1 ? '' : 's'}`
          : 'No active Stripe subscriptions',
        tone: f.moneyIn.mrrMinor ? 'pos' : 'unknown',
      }),
      tile('Net in, this month', money(f.moneyIn.thisMonthNetMinor), {
        foot: `${money(f.moneyIn.thisMonthGrossMinor)} gross, after Stripe fees`,
      }),
      tile('Monthly out', burnKnown ? money(f.moneyOut.totalMonthlyOutMinor) : `${money(f.moneyOut.totalMonthlyOutMinor)}+`, {
        foot: `${money(f.moneyOut.monthlyBurnMinor)} subscriptions + ${money(f.moneyOut.oneOff?.monthlyAverageMinor || 0)} usage`
          + (burnKnown ? '' : ` · ${f.moneyOut.unpricedCount} still need an amount`),
        tone: burnKnown ? '' : 'unknown',
      }),
      tile('Profit, this month', money(profit), {
        foot: burnKnown
          ? (f.profit.marginPercent === null ? 'No revenue this month' : `${f.profit.marginPercent}% margin`)
          : 'Understated — costs are missing amounts',
        tone: profit > 0 ? 'pos' : profit < 0 ? 'neg' : '',
      }),
      tile('Accounts', num(a?.overview.users ?? 0), {
        foot: `${num(a?.overview.newUsers30d ?? 0)} new in 30d · ${num(a?.overview.activeUsers7d ?? 0)} active in 7d`,
      }),
      tile('Paying accounts', num(a?.overview.paidUsers ?? 0), {
        foot: `${num(a?.overview.freeUsers ?? 0)} free · ${num(a?.overview.trialUsers ?? 0)} trialing`,
        tone: (a?.overview.paidUsers ?? 0) > 0 ? 'pos' : 'unknown',
      }),
    ]);

    renderChart(f);
    renderUpcoming($('overviewUpcoming'), f);
  }

  function renderChart(f) {
    const months = f.months || [];
    const burn = f.moneyOut.monthlyBurnMinor;
    const peak = Math.max(1, ...months.map(m => Math.max(m.netMinor, burn)));
    const columns = months.map(m => {
      const inH = Math.max(2, Math.round((Math.max(0, m.netMinor) / peak) * 165));
      const outH = Math.max(2, Math.round((burn / peak) * 165));
      const label = new Date(`${m.month}-01T00:00:00Z`)
        .toLocaleDateString(undefined, { month: 'short', timeZone: 'UTC' });
      return el('div', { class: 'ow-chart-col' }, [
        el('div', { class: 'ow-chart-bars' }, [
          el('div', { class: 'ow-bar ow-bar-in', style: `height:${inH}px`, title: `${m.month} net in ${money(m.netMinor)}` }),
          el('div', { class: 'ow-bar ow-bar-out', style: `height:${outH}px`, title: `current burn ${money(burn)}` }),
        ]),
        el('div', { class: 'ow-chart-label', text: label }),
      ]);
    });
    // Six flat bars at zero read as a broken chart rather than an empty one.
    const hasAnything = burn > 0 || months.some(m => m.netMinor !== 0);
    replace($('monthChart'), hasAnything && columns.length
      ? columns
      : el('div', { class: 'ow-empty', text: 'Nothing to plot yet — no revenue in this window, and no cost amounts set.' }));
    // Said plainly: historic burn was never recorded, so the out bar is today's
    // figure repeated. Drawing it as if it were history would be a lie in a chart.
    replace($('chartHint'), [
      el('span', { class: 'ow-legend' }, [
        el('span', {}, [el('i', { style: 'background:linear-gradient(180deg,#f1d18e,#d9b66f)' }), 'net in']),
        el('span', {}, [el('i', { style: 'background:#3a3a42' }), 'burn (today’s, not historic)']),
      ]),
    ]);
  }

  function renderUpcoming(host, f) {
    const rows = (f.moneyOut.dueNext60Days || []).map(item => el('tr', {}, [
      el('td', { class: 'wrap' }, [
        el('div', { text: item.name }),
        item.vendor ? el('div', { class: 'ow-tile-foot', text: item.vendor }) : null,
      ]),
      el('td', {}, el('span', {
        class: 'ow-pill',
        dataset: { tone: item.daysAway < 0 ? 'bad' : item.daysAway <= 7 ? 'warn' : 'good' },
        text: relativeDays(item.daysAway),
      })),
      el('td', { text: date(item.dueAt) }),
      el('td', { class: 'num', text: item.needsAmount ? 'not set' : money(item.amountMinor, item.currency) }),
    ]));
    const total = f.moneyOut.dueNext60DaysTotalMinor;
    replace(host, [
      el('div', { class: 'ow-scroll' }, el('table', { class: 'ow-table' },
        table([{ label: 'Cost' }, { label: 'When' }, { label: 'Date' }, { label: 'Amount', num: true }], rows, {
          empty: 'No payment dates set yet. Add them on a cost so they show up here.',
        }))),
      rows.length ? el('p', { class: 'ow-note', text: `${money(total)} due across the next 60 days.` }) : null,
    ]);
  }

  // ── money in ─────────────────────────────────────────────────────────────
  function renderIn() {
    const f = state.finance;
    if (!f) return;
    const windowLabel = `over the last ${f.moneyIn.windowDays} days`;

    replace($('inTiles'), [
      tile('Gross in', money(f.moneyIn.grossMinor), { foot: windowLabel }),
      tile('Stripe fees', money(f.moneyIn.feeMinor), {
        foot: f.moneyIn.grossMinor
          ? `${Math.round((f.moneyIn.feeMinor / f.moneyIn.grossMinor) * 1000) / 10}% of gross`
          : windowLabel,
        tone: f.moneyIn.feeMinor ? 'neg' : '',
      }),
      tile('Net in', money(f.moneyIn.netMinor), { foot: 'What actually landed', tone: f.moneyIn.netMinor ? 'pos' : '' }),
      tile('Refunded', money(f.moneyIn.refundMinor), { foot: windowLabel, tone: f.moneyIn.refundMinor ? 'neg' : '' }),
      tile('MRR', f.moneyIn.mrrMinor ? money(f.moneyIn.mrrMinor) : 'none', { foot: 'From active subscriptions', tone: f.moneyIn.mrrMinor ? 'pos' : 'unknown' }),
      tile('ARR', f.moneyIn.arrMinor ? money(f.moneyIn.arrMinor) : 'none', { foot: 'MRR x 12', tone: f.moneyIn.arrMinor ? 'pos' : 'unknown' }),
    ]);

    const rows = (f.months || []).map(m => el('tr', {}, [
      el('td', { text: m.month }),
      el('td', { class: 'num', text: money(m.grossMinor) }),
      el('td', { class: 'num', text: money(m.feeMinor) }),
      el('td', { class: 'num', text: money(m.netMinor) }),
      el('td', { class: 'num', text: m.refundMinor ? money(m.refundMinor) : '—' }),
      el('td', { class: 'num', text: num(m.count) }),
    ]));
    replace($('inMonths'), table(
      [{ label: 'Month' }, { label: 'Gross', num: true }, { label: 'Fees', num: true },
       { label: 'Net', num: true }, { label: 'Refunds', num: true }, { label: 'Payments', num: true }],
      rows, { empty: 'No payments in this window.' }));

    replace($('inSource'), [el('span', {
      text: f.moneyIn.source === 'stripe'
        ? 'Read live from Stripe balance transactions, so fees are real.'
        : `Stripe could not be read, so these are the ${f.moneyIn.localEventCount} payments recorded locally — fees are not known on this path.`,
    })]);

    const plans = Object.entries(f.moneyIn.planCounts || {});
    replace($('inPlans'), plans.length
      ? el('div', {}, plans.map(([label, count]) => el('div', { class: 'ow-catrow' }, [
          el('span', { class: 'name', text: label }),
          el('span', { class: 'ow-catbar' }, el('span', { style: `width:${Math.round((count / Math.max(...plans.map(p => p[1]))) * 100)}%` })),
          el('span', { class: 'val', text: `${num(count)} active` }),
        ])))
      : el('div', { class: 'ow-empty', text: 'No active subscriptions.' }));

    const recent = (f.recentRevenue || []).map(event => el('tr', {}, [
      el('td', { text: date(event.createdAt) }),
      el('td', {}, el('span', { class: 'ow-pill', dataset: { tone: event.kind === 'topup' ? 'gold' : 'good' }, text: event.kind })),
      el('td', { class: 'wrap', text: event.description || '—' }),
      el('td', { class: 'num', text: money(event.amountMinor, event.currency) }),
    ]));
    replace($('inRecent'), table(
      [{ label: 'Date' }, { label: 'Kind' }, { label: 'Description' }, { label: 'Amount', num: true }],
      recent, { empty: 'No payments recorded locally yet. This fills as Stripe webhooks arrive.' }));
  }

  // ── money out ────────────────────────────────────────────────────────────
  function renderOut() {
    const f = state.finance;
    if (!f) return;

    replace($('outTiles'), [
      tile('Subscriptions', money(f.moneyOut.monthlyBurnMinor), {
        foot: f.moneyOut.unpricedCount ? `Understated: ${f.moneyOut.unpricedCount} without an amount` : 'Per month, all priced',
        tone: f.moneyOut.unpricedCount ? 'unknown' : '',
      }),
      tile('Usage and one-offs', money(f.moneyOut.oneOff?.monthlyAverageMinor || 0), {
        foot: `Averaged from ${(f.moneyOut.oneOff?.rows || []).length} payment(s) across the ${f.moneyOut.oneOff?.coveredDays || 0} days they span`,
      }),
      tile('Total out, per month', money(f.moneyOut.totalMonthlyOutMinor), { foot: 'What profit is measured against' }),
      tile('Due in 60 days', money(f.moneyOut.dueNext60DaysTotalMinor), { foot: `${(f.moneyOut.dueNext60Days || []).length} payment(s) scheduled` }),
      tile('Tracked costs', num(f.moneyOut.entries), { foot: 'Active entries in the ledger' }),
    ]);

    replace($('outNote'), [el('span', {
      text: f.moneyOut.unpricedCount
        ? `${f.moneyOut.unpricedNames.join(', ')} — seeded from this deployment's infrastructure but with no amount, because a guessed hosting bill would make the profit figure fiction. Set them once and every total below becomes real.`
        : 'Every active cost has an amount, so burn and profit are complete.',
    })]);

    const rows = (f.costs || []).map(cost => el('tr', {}, [
      el('td', { class: 'wrap' }, [
        el('div', { text: cost.name }),
        cost.notes ? el('div', { class: 'ow-tile-foot', text: cost.notes }) : null,
      ]),
      el('td', { text: cost.vendor || '—' }),
      el('td', {}, el('span', { class: 'ow-pill', text: cost.category })),
      el('td', { text: cost.cadence }),
      el('td', { class: 'num' }, cost.needsAmount
        ? el('span', { class: 'ow-pill', dataset: { tone: 'warn' }, text: 'not set' })
        : document.createTextNode(money(cost.amountMinor, cost.currency))),
      el('td', { class: 'num', text: cost.monthlyMinor ? money(cost.monthlyMinor, cost.currency) : '—' }),
      el('td', {}, cost.nextDueAt
        ? document.createTextNode(date(cost.nextDueAt))
        : el('span', { class: 'ow-pill', dataset: { tone: 'warn' }, text: 'no date' })),
      el('td', {}, [
        cost.active === false ? el('span', { class: 'ow-pill', text: 'paused' }) : null,
        el('button', { type: 'button', class: 'ow-btn ow-btn-quiet', dataset: { edit: cost.id }, text: 'Edit' }),
      ]),
    ]));
    replace($('costTable'), table(
      [{ label: 'Cost' }, { label: 'Vendor' }, { label: 'Category' }, { label: 'Cadence' },
       { label: 'Amount', num: true }, { label: 'Per month', num: true }, { label: 'Next due' }, { label: '' }],
      rows, { empty: 'No costs tracked yet.' }));

    const oneOff = f.moneyOut.oneOff || { rows: [], totalMinor: 0, monthlyAverageMinor: 0, days: 90 };
    const spendRows = (oneOff.rows || []).slice(0, 60).map(item => el('tr', {}, [
      el('td', { text: date(item.paidAt) }),
      el('td', { class: 'wrap' }, [
        el('div', { text: item.name }),
        item.notes ? el('div', { class: 'ow-tile-foot', text: item.notes }) : null,
      ]),
      el('td', { text: item.vendor || '—' }),
      el('td', {}, el('span', { class: 'ow-pill', text: item.source })),
      el('td', { class: 'num', text: money(item.amountMinor, item.currency) }),
    ]));
    replace($('spendTable'), table(
      [{ label: 'Paid' }, { label: 'What' }, { label: 'Vendor' }, { label: 'Source' }, { label: 'Amount', num: true }],
      spendRows, { empty: 'No one-off payments recorded yet.' }));
    replace($('spendHint'), [el('span', {
      text: oneOff.rows.length
        ? `${money(oneOff.totalMinor)} across ${oneOff.coveredDays} days of payments — about ${money(oneOff.monthlyAverageMinor)} a month, from what was actually paid.`
        : '',
    })]);

    const cats = Object.entries(f.moneyOut.byCategory || {}).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const catPeak = Math.max(1, ...cats.map(c => c[1]));
    replace($('outCategories'), cats.length
      ? el('div', {}, cats.map(([name, value]) => el('div', { class: 'ow-catrow' }, [
          el('span', { class: 'name', text: name }),
          el('span', { class: 'ow-catbar' }, el('span', { style: `width:${Math.round((value / catPeak) * 100)}%` })),
          el('span', { class: 'val', text: money(value) }),
        ])))
      : el('div', { class: 'ow-empty', text: 'Set an amount on a cost and it will break down here.' }));
  }

  // ── users ────────────────────────────────────────────────────────────────
  function renderUsers() {
    const a = state.analytics;
    if (!a) return;

    replace($('usersTiles'), [
      tile('Total accounts', num(a.overview.users)),
      tile('Active, 7 days', num(a.overview.activeUsers7d), { foot: `${num(a.overview.newUsers30d)} joined in 30 days` }),
      tile('Projects', num(a.overview.projects), { foot: `${num(a.overview.processingProjects)} processing · ${num(a.overview.failedProjects)} failed` }),
      tile('Clips', num(a.overview.clips), { foot: `${num(a.overview.postedClips)} posted · ${num(a.overview.readyClips)} ready` }),
      tile('Tokens used, 30d', num(a.overview.tokensUsed30d), { foot: `${num(a.overview.tokensSold30d)} sold` }),
      tile('Unspent top-ups', num(a.overview.purchasedTopupBalance), { foot: 'Tokens customers have paid for and not used' }),
    ]);

    const filter = state.userFilter.trim().toLowerCase();
    const users = (a.users || []).filter(u => !filter
      || `${u.name} ${u.email} ${u.plan} ${u.role}`.toLowerCase().includes(filter));

    const rows = users.map(u => el('tr', {}, [
      el('td', { class: 'wrap' }, [
        el('div', { text: u.name }),
        el('div', { class: 'ow-tile-foot', text: u.email || 'no email' }),
      ]),
      el('td', {}, el('span', {
        class: 'ow-pill',
        dataset: { tone: ['weekly', 'monthly', 'yearly'].includes(u.plan) ? 'good' : u.plan === 'admin' ? 'gold' : '' },
        text: u.plan,
      })),
      el('td', { text: u.billingStatus }),
      el('td', { class: 'num', text: u.remainingTokens === null ? 'unlimited' : num(u.remainingTokens) }),
      el('td', { class: 'num', text: num(u.tokensUsed) }),
      el('td', { class: 'num', text: num(u.projects) }),
      el('td', { class: 'num', text: num(u.clips) }),
      el('td', { class: 'num', text: num(u.posted) }),
      el('td', { text: date(u.lastLoginAt) }),
      el('td', { text: (u.providers || []).join(', ') || '—' }),
    ]));
    replace($('userTable'), table(
      [{ label: 'Account' }, { label: 'Plan' }, { label: 'Status' }, { label: 'Tokens left', num: true },
       { label: 'Used', num: true }, { label: 'Projects', num: true }, { label: 'Clips', num: true },
       { label: 'Posted', num: true }, { label: 'Last seen' }, { label: 'Sign-in' }],
      rows, { empty: filter ? 'No accounts match that filter.' : 'No accounts yet.' }));
  }

  // ── activity ─────────────────────────────────────────────────────────────
  function renderActivity() {
    const a = state.analytics;
    if (!a) return;
    const rows = (a.recentActivity || []).map(event => el('tr', {}, [
      el('td', { text: date(event.createdAt) }),
      el('td', {}, el('span', { class: 'ow-pill', dataset: { tone: event.type === 'tokens_added' ? 'good' : '' }, text: event.type })),
      el('td', { class: 'num', text: num(event.amount) }),
      el('td', { class: 'wrap', text: event.message || '—' }),
    ]));
    replace($('activityBilling'), table(
      [{ label: 'When' }, { label: 'Event' }, { label: 'Tokens', num: true }, { label: 'Detail' }],
      rows, { empty: 'No billing events yet.' }));

    const social = Object.entries(a.social || {}).filter(([, v]) => v >= 0);
    replace($('activitySocial'), social.length
      ? el('div', {}, social.map(([name, count]) => el('div', { class: 'ow-catrow' }, [
          el('span', { class: 'name', text: name }),
          el('span', { class: 'ow-catbar' }, el('span', { style: `width:${count ? Math.round((count / Math.max(1, ...social.map(s => s[1]))) * 100) : 0}%` })),
          el('span', { class: 'val', text: `${num(count)} account(s)` }),
        ])))
      : el('div', { class: 'ow-empty', text: 'No connected accounts.' }));
  }

  // ── cost dialog ──────────────────────────────────────────────────────────
  function openCost(cost) {
    const dialog = $('costDialog');
    $('costDialogTitle').textContent = cost ? 'Edit cost' : 'Add a cost';
    $('costId').value = cost?.id || '';
    $('costName').value = cost?.name || '';
    $('costVendor').value = cost?.vendor || '';
    $('costAmount').value = cost && cost.amountMinor ? (cost.amountMinor / 100).toFixed(2) : '';
    $('costCurrency').value = cost?.currency || state.finance?.currency || 'aud';
    $('costCadence').value = cost?.cadence || 'monthly';
    $('costCategory').value = cost?.category || 'other';
    $('costDue').value = cost?.nextDueAt ? new Date(cost.nextDueAt).toISOString().slice(0, 10) : '';
    $('costNotes').value = cost?.notes || '';
    $('costActive').checked = cost ? cost.active !== false : true;
    $('costDelete').hidden = !cost;
    $('costError').hidden = true;
    dialog.showModal();
  }

  async function saveCost() {
    const error = $('costError');
    const due = $('costDue').value;
    const payload = {
      id: $('costId').value || undefined,
      name: $('costName').value,
      vendor: $('costVendor').value,
      amount: Number($('costAmount').value || 0),
      currency: $('costCurrency').value,
      cadence: $('costCadence').value,
      category: $('costCategory').value,
      // Parsed as UTC midday, so a date typed in Australia does not land on the
      // previous day for the server.
      nextDueAt: due ? Date.parse(`${due}T12:00:00Z`) : null,
      notes: $('costNotes').value,
      active: $('costActive').checked,
    };
    if (!payload.name.trim()) { error.textContent = 'A cost needs a name.'; error.hidden = false; return; }
    try {
      const response = await fetch('/api/owner/costs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not save that cost.');
      $('costDialog').close();
      await load();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }

  async function deleteCost() {
    const id = $('costId').value;
    if (!id) return;
    const error = $('costError');
    try {
      const response = await fetch(`/api/owner/costs/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not delete that cost.');
      $('costDialog').close();
      await load();
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    }
  }

  // ── loading ──────────────────────────────────────────────────────────────
  function banner(message, kind = 'warn') {
    const host = $('ownerBanner');
    if (!message) { host.hidden = true; return; }
    host.dataset.kind = kind;
    host.textContent = message;
    host.hidden = false;
  }

  async function load() {
    banner('');
    $('ownerSubtitle').textContent = 'Loading…';
    const [financeRes, analyticsRes] = await Promise.allSettled([
      fetch(`/api/owner/finance?days=${state.days}`).then(r => r.json().then(body => {
        if (!r.ok) throw new Error(body.error || 'Finance failed to load.');
        return body;
      })),
      fetch('/api/admin/analytics').then(r => r.json().then(body => {
        if (!r.ok) throw new Error(body.error || 'Analytics failed to load.');
        return body;
      })),
    ]);

    const notes = [];
    if (financeRes.status === 'fulfilled') state.finance = financeRes.value;
    else notes.push(`Finance: ${financeRes.reason.message}`);
    if (analyticsRes.status === 'fulfilled') state.analytics = analyticsRes.value;
    else notes.push(`Users: ${analyticsRes.reason.message}`);

    const f = state.finance;
    if (f) {
      const mode = $('ownerMode');
      mode.textContent = { live: 'Stripe live', test: 'Stripe test mode', none: 'Stripe not configured' }[f.stripe.mode] || 'Stripe';
      mode.dataset.mode = f.stripe.mode;
      mode.hidden = false;
      // The single most important caveat on the page: in test mode every figure
      // below is sandbox data, and it looks exactly like real money. Only said
      // when a key actually exists -- claiming "test mode" on a deployment with
      // no Stripe key at all contradicted the very next sentence.
      if (f.stripe.mode === 'test') notes.push('Stripe is in test mode, so every revenue figure here is sandbox data, not real money.');
      if (!f.stripe.configured) notes.push('No Stripe key is configured on this deployment, so revenue cannot be read.');
      else if (!f.stripe.revenueAvailable) notes.push(`Stripe revenue could not be read: ${f.stripe.revenueReason}`);
      for (const problem of f.stripe.problems || []) notes.push(problem);
      if (f.profit.completeness) notes.push(f.profit.completeness);
      $('ownerSubtitle').textContent = `Updated ${new Date(f.generatedAt).toLocaleTimeString()}`;
    } else {
      $('ownerSubtitle').textContent = 'Could not load';
    }

    banner(notes.join('  ·  '), financeRes.status === 'rejected' ? 'error' : 'warn');
    renderOverview(); renderIn(); renderOut(); renderUsers(); renderActivity(); loadHealth();
  }

  // Fetched on its own rather than folded into load(): the worker half can be
  // slow or unreachable, and the books must not wait on it to draw.
  async function loadHealth() {
    let health;
    try {
      const response = await fetch('/api/owner/health?days=7', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(String(response.status));
      health = await response.json();
    } catch {
      replace($('healthTiles'), el('p', { class: 'ow-empty', text: 'Could not read pipeline health.' }));
      return;
    }

    const totals = health.totals || {};
    const worker = health.worker || {};
    replace($('healthTiles'), [
      tile('Jobs finished', String((totals.completed || 0) + (totals.failed || 0)), { foot: `last ${health.days} days` }),
      tile('Failed', String(totals.failed || 0), {
        foot: `${totals.failureRate || 0}% of finished jobs`,
        tone: (totals.failed || 0) ? 'neg' : '',
      }),
      tile('Worker', worker.error ? 'Unreachable' : 'Reachable', {
        foot: worker.error ? String(worker.error).slice(0, 60) : 'answered its health check',
        tone: worker.error ? 'neg' : 'pos',
      }),
    ]);

    // table() wants rows that are already <tr> nodes -- it appends them
    // straight into a tbody. Handing it arrays of strings threw
    // "parameter 1 is not of type 'Node'" and left all three tables blank
    // while the tiles above them read 2 failed, which is a worse state than
    // an error: the page looked answered and said nothing.
    const codeRows = (health.topFailures || []).map(row => el('tr', {}, [
      el('td', {}, el('span', { class: 'ow-pill', dataset: { tone: 'bad' }, text: row.code })),
      el('td', { class: 'num', text: String(row.count) }),
      el('td', { class: 'wrap', text: row.sample || '—' }),
    ]));
    replace($('healthCodes'), table(
      [{ label: 'Code' }, { label: 'Times', num: true }, { label: 'Most recent message' }],
      codeRows, { empty: 'Nothing has failed in this window.' }));

    const providerRows = Object.entries(health.importProviders || {})
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => el('tr', {}, [
        el('td', { text: name }),
        el('td', { class: 'num', text: String(count) }),
      ]));
    replace($('healthProviders'), table(
      [{ label: 'Importer' }, { label: 'Jobs completed', num: true }],
      providerRows, { empty: 'No completed imports in this window.' }));

    const recentRows = (health.recent || []).map(row => el('tr', {}, [
      el('td', { text: row.at ? date(row.at) : '—' }),
      el('td', { class: 'wrap', text: row.title || row.id || '—' }),
      el('td', {}, el('span', { class: 'ow-pill', dataset: { tone: 'bad' }, text: row.code })),
      el('td', { class: 'wrap', text: row.error || '—' }),
    ]));
    replace($('healthRecent'), table(
      [{ label: 'When' }, { label: 'Lecture' }, { label: 'Code' }, { label: 'Message' }],
      recentRows, { empty: 'No failures to show.' }));
  }

  function activate(name) {
    for (const tab of document.querySelectorAll('.ow-tab')) tab.classList.toggle('is-active', tab.dataset.tab === name);
    for (const panel of document.querySelectorAll('.ow-panel')) panel.classList.toggle('is-active', panel.id === `panel-${name}`);
    // The tab lives in the URL so a reload, or a bookmark, comes back here.
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
  }

  function boot() {
    for (const [id, options] of [['costCadence', ['weekly', 'monthly', 'quarterly', 'yearly', 'once']],
                                 ['costCategory', ['hosting', 'storage', 'domain', 'ai', 'tooling', 'marketing', 'other']]]) {
      replace($(id), options.map(value => el('option', { value, text: value })));
    }

    $('ownerTabs').addEventListener('click', event => {
      const tab = event.target.closest('.ow-tab');
      if (tab) activate(tab.dataset.tab);
    });
    $('ownerRefresh').addEventListener('click', () => { load(); });
    $('ownerWindow').addEventListener('change', event => { state.days = Number(event.target.value) || 180; load(); });
    $('userSearch').addEventListener('input', event => { state.userFilter = event.target.value; renderUsers(); });
    $('costAdd').addEventListener('click', () => openCost(null));
    $('costSave').addEventListener('click', saveCost);
    $('costDelete').addEventListener('click', deleteCost);
    $('costCancel').addEventListener('click', () => $('costDialog').close());
    $('costTable').addEventListener('click', event => {
      const button = event.target.closest('[data-edit]');
      if (!button) return;
      const cost = (state.finance?.costs || []).find(item => item.id === button.dataset.edit);
      if (cost) openCost(cost);
    });

    const initial = location.hash.slice(1);
    activate(['overview', 'in', 'out', 'users', 'activity', 'health'].includes(initial) ? initial : 'overview');
    load();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
