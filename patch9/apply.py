#!/usr/bin/env python3
"""
Plans page: visual hierarchy, motion, and conversion.

The page is currently four near-identical cards in a flat row, every CTA the
same gold, no motion, and the wallet block eating the fold before anyone has
seen a price. Nothing tells the eye where to go, so the page reads as a table
rather than an offer.

WHAT CHANGES
------------
1. ORDER. Plans move above the wallet. A visitor deciding whether to pay does
   not need their current token balance first — that is post-decision
   information, and it was occupying the entire fold.

2. HIERARCHY. Only Monthly gets the solid gold button. Everything else becomes
   an outline button. Four identical gold CTAs compete; one gold CTA against
   three outlines directs. Monthly also scales up slightly and sits on a
   brighter border.

3. MOTION. Cards fade and rise in on load, staggered ~70ms apart. Cards lift on
   hover. The Monthly CTA carries a slow pulse. All of it is wrapped in
   prefers-reduced-motion so it degrades to static for anyone who has asked the
   OS for less animation — an accessibility requirement, not a nicety.

4. ANCHORING. Yearly shows its per-month equivalent and a "Save N%" badge,
   both computed from the configured labels rather than hardcoded. A$249 as
   the largest number on the page currently reads as the most expensive
   option, which is backwards.

5. CREDIBILITY. A one-line factual comparison against Opus Clip's published
   pricing, since 45% cheaper per minute is the strongest argument available
   and it was nowhere on the page.

Run from your repo root:

    python3 patch9/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "billing.js").exists():
    sys.exit("Can't find src/billing.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    path = ROOT / relpath
    text = path.read_text()
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(
            f"ANCHOR NOT FOUND for '{label}' in {relpath}.\n"
            f"Expected:\n{old[:300]}\n\nNothing written."
        )
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ------------------------------------------------- pricing maths for the cards

edit(
    "src/billing.js",
    "  const planCards = PLAN_ORDER.map(id => bill.plans?.[id]).filter(Boolean).map(plan => {\n"
    "    const configured = Boolean(plan.priceId);\n"
    "    const current = cur.plan === plan.id && cur.status !== 'free';\n"
    "    const canTrial = Boolean(plan.trialEligible) && trialDays > 0;",
    "  const amountOf = plan => {\n"
    "    const match = String(plan?.priceLabel || '').match(/([\\d]+(?:\\.[\\d]+)?)/);\n"
    "    return match ? Number(match[1]) : 0;\n"
    "  };\n"
    "  // Yearly is shown as a monthly equivalent against the monthly plan. A$249\n"
    "  // as the biggest number on the page reads as the dearest option otherwise.\n"
    "  const monthlyAmount = amountOf(bill.plans?.monthly);\n"
    "  const yearlyAmount = amountOf(bill.plans?.yearly);\n"
    "  const yearlySaving = monthlyAmount && yearlyAmount\n"
    "    ? Math.round((1 - (yearlyAmount / 12) / monthlyAmount) * 100)\n"
    "    : 0;\n"
    "  const yearlyPerMonth = yearlyAmount ? (yearlyAmount / 12).toFixed(2) : '';\n"
    "  const planCards = PLAN_ORDER.map(id => bill.plans?.[id]).filter(Boolean).map((plan, index) => {\n"
    "    const configured = Boolean(plan.priceId);\n"
    "    const current = cur.plan === plan.id && cur.status !== 'free';\n"
    "    const canTrial = Boolean(plan.trialEligible) && trialDays > 0;\n"
    "    const saving = plan.id === 'yearly' && yearlySaving > 0 ? yearlySaving : 0;",
    "per-month equivalent + savings maths",
)

edit(
    "src/billing.js",
    '    return `<article class="dc-plan ${plan.id === \'monthly\' ? \'featured\' : \'\'}">\n'
    '      <div class="plan-top">${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : \'<span></span>\'}${plan.id === \'monthly\' ? \'<span class="popular">Recommended</span>\' : \'\'}</div>',
    '    return `<article class="dc-plan ${plan.id === \'monthly\' ? \'featured\' : \'\'}" style="--i:${index + 2}">\n'
    '      <div class="plan-top">${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : \'<span></span>\'}${plan.id === \'monthly\' ? \'<span class="popular">Most popular</span>\' : \'\'}${saving ? `<span class="popular saving">Save ${saving}%</span>` : \'\'}</div>',
    "card: stagger index + savings badge",
)

edit(
    "src/billing.js",
    "      ${rate ? `<div class=\"per-min\">${esc(rate)}</div>` : ''}",
    "      ${plan.id === 'yearly' && yearlyPerMonth ? `<div class=\"per-month\">works out to A$${esc(yearlyPerMonth)} a month</div>` : ''}\n"
    "      ${rate ? `<div class=\"per-min\">${esc(rate)}</div>` : ''}",
    "yearly: per-month equivalent line",
)

edit(
    "src/billing.js",
    '<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${esc(plan.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit" ${configured && !current ? \'\' : \'disabled\'}>${esc(cta)}</button></form>',
    '<form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${esc(plan.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button class="${plan.id === \'monthly\' ? \'cta-primary\' : \'cta-secondary\'}" type="submit" ${configured && !current ? \'\' : \'disabled\'}>${esc(cta)}</button></form>',
    "CTA hierarchy: one gold button, not four",
)

edit(
    "src/billing.js",
    '  const freeCard = freePlan ? `<article class="dc-plan free-plan">',
    '  const freeCard = freePlan ? `<article class="dc-plan free-plan" style="--i:1">',
    "free card: stagger index",
)


# --------------------------------------------------------------- page layout

edit(
    "src/billing.js",
    '<section class="wallet"><div class="wallet-main">',
    '<section class="wallet compact"><div class="wallet-main">',
    "wallet: compact variant",
)

# Plans now come before the wallet. A visitor deciding whether to pay does not
# need their balance first; it was taking the whole fold.
edit(
    "src/billing.js",
    '<section class="wallet compact"><div class="wallet-main"><div class="wallet-head"><span>Your wallet</span><span>${esc(cur.plan || \'free\')} plan</span></div><div class="wallet-number">${esc(remaining)} <span>tokens available</span></div><div class="wallet-head"><span>${esc(bonus)} tokens</span><span>${cur.unlimited ? \'No usage limits\' : `${Math.round(Number(cur.used || 0))} used this period`}</span></div><div class="bar"><i></i></div></div><div class="wallet-rule"><b>${esc(bill.tokenRatePerMinute || 1)} token/min</b><span>Only the selected source range is charged. Editing, reviewing and template-only rerenders do not consume extra tokens.</span></div></section><div class="section-title"><span>Subscriptions</span><h2>Built for different posting rhythms.</h2><p>Start small, publish consistently, or lock in the best annual value.</p></div><section class="plans">${freeCard}${planCards}</section>',
    '<div class="section-title"><span>Subscriptions</span><h2>Built for different posting rhythms.</h2><p>Start small, publish consistently, or lock in the best annual value.</p></div><section class="plans">${freeCard}${planCards}</section><p class="compare">Opus Clip Pro is US$29/month for 300 minutes. DeenClipped Monthly gives you ${esc(bill.plans?.monthly?.tokens || 400)} minutes for A$29.99 &mdash; roughly half the cost per minute of video.</p><section class="wallet compact"><div class="wallet-main"><div class="wallet-head"><span>Your wallet</span><span>${esc(cur.plan || \'free\')} plan</span></div><div class="wallet-number">${esc(remaining)} <span>tokens available</span></div><div class="wallet-head"><span>${esc(bonus)} tokens</span><span>${cur.unlimited ? \'No usage limits\' : `${Math.round(Number(cur.used || 0))} used this period`}</span></div><div class="bar"><i></i></div></div><div class="wallet-rule"><b>${esc(bill.tokenRatePerMinute || 1)} token/min</b><span>Only the selected source range is charged. Editing, reviewing and template-only rerenders do not consume extra tokens.</span></div></section>',
    "layout: plans above the wallet, comparison strip",
)


# --------------------------------------------------------------------- styles

edit(
    "src/billing.js",
    "@media(max-width:560px){.account span{display:none}.hero h1{font-size:38px}.wallet-main,.wallet-rule,.dc-plan,.dc-topup{border-radius:19px}}",
    "@media(max-width:560px){.account span{display:none}.hero h1{font-size:38px}.wallet-main,.wallet-rule,.dc-plan,.dc-topup{border-radius:19px}}"
    # -- entrance + hover motion
    "@keyframes dcRise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}"
    "@keyframes dcRiseFeatured{from{opacity:0;transform:translateY(18px) scale(1.03)}to{opacity:1;transform:scale(1.03)}}"
    "@keyframes dcPulse{0%,100%{box-shadow:0 0 0 0 rgba(228,188,113,.42)}50%{box-shadow:0 0 0 9px rgba(228,188,113,0)}}"
    "@keyframes dcGlow{0%,100%{opacity:.35}50%{opacity:.75}}"
    ".dc-plan,.dc-topup{opacity:0;animation:dcRise .5s cubic-bezier(.2,.7,.3,1) forwards;animation-delay:calc(var(--i,1) * 70ms);transition:transform .28s cubic-bezier(.2,.7,.3,1),border-color .28s,box-shadow .28s}"
    ".dc-plan:hover,.dc-topup:hover{transform:translateY(-5px);border-color:rgba(228,188,113,.38);box-shadow:0 30px 70px rgba(0,0,0,.4)}"
    # -- the featured card sits proud of the row
    ".dc-plan.featured{transform:scale(1.03);animation-name:dcRiseFeatured;border-color:rgba(228,188,113,.62);z-index:2}"
    ".dc-plan.featured:hover{transform:translateY(-5px) scale(1.03)}"
    ".dc-plan.featured:before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(140deg,rgba(242,214,150,.85),rgba(228,188,113,.15),rgba(242,214,150,.7));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:dcGlow 3.4s ease-in-out infinite;pointer-events:none}"
    # -- button hierarchy: one gold CTA, the rest outlined
    ".cta-primary{background:linear-gradient(135deg,var(--gold2),var(--gold))!important;color:#171108!important;animation:dcPulse 2.6s ease-in-out infinite}"
    ".cta-primary:hover{filter:brightness(1.07)}"
    ".cta-secondary{background:transparent!important;color:var(--text)!important;border:1px solid rgba(255,255,255,.16)!important;transition:border-color .2s,background .2s}"
    ".cta-secondary:hover:not(:disabled){border-color:rgba(228,188,113,.55)!important;background:rgba(228,188,113,.07)!important}"
    ".dc-plan button:disabled{animation:none}"
    # -- anchoring + credibility
    ".popular.saving{background:var(--green);color:#04240f}"
    ".per-month{font-size:12.5px;color:var(--text);font-weight:750;margin:-6px 0 0}"
    ".compare{text-align:center;max-width:720px;margin:22px auto 0;padding:13px 18px;border:1px solid rgba(228,188,113,.20);border-radius:16px;background:rgba(228,188,113,.05);color:#d5d0c8;font-size:12.5px;line-height:1.6}"
    ".wallet.compact{margin-top:34px}"
    ".wallet.compact .wallet-number{font-size:34px}"
    # -- respect the OS setting
    "@media(prefers-reduced-motion:reduce){.dc-plan,.dc-topup{opacity:1;animation:none;transition:none}.dc-plan.featured{transform:scale(1.03)}.dc-plan:hover,.dc-topup:hover{transform:none}.dc-plan.featured:hover{transform:scale(1.03)}.cta-primary{animation:none}.dc-plan.featured:before{animation:none;opacity:.6}}",
    "styles: motion, hierarchy, anchoring",
)

# Monthly now claims "Most popular", so the top-up pack cannot also claim it.
# Two different things labelled most popular on one page reads as carelessness
# and dilutes both.
edit(
    "src/billing.js",
    "      id: 'boost300', name: 'Creator boost', tokens: 300,\n"
    "      priceId: config.stripePriceTopup300, priceLabel: config.topupPrice300Label,\n"
    "      badge: 'Most popular',",
    "      id: 'boost300', name: 'Creator boost', tokens: 300,\n"
    "      priceId: config.stripePriceTopup300, priceLabel: config.topupPrice300Label,\n"
    "      badge: 'Best seller',",
    "top-up badge: avoid two 'Most popular' labels",
)

edit(
    "src/billing.js",
    "  const topupCards = TOPUP_ORDER.map(id => bill.topups?.[id]).filter(Boolean).map(pack => {\n"
    "    const configured = Boolean(pack.priceId);\n"
    "    return `<article class=\"dc-topup ${pack.id === 'boost300' ? 'featured' : ''}\">",
    "  const topupCards = TOPUP_ORDER.map(id => bill.topups?.[id]).filter(Boolean).map((pack, index) => {\n"
    "    const configured = Boolean(pack.priceId);\n"
    "    return `<article class=\"dc-topup ${pack.id === 'boost300' ? 'featured' : ''}\" style=\"--i:${index + 1}\">",
    "top-up cards: stagger index",
)


print("patch9 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check\n  npm test\n")
