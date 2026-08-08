#!/usr/bin/env python3
"""
Marketing pricing page: bring it in line with the logged-in plans page.

patch7 and patch9 only touched src/billing.js, which renders /plans behind
login. The public /pricing page is a separate implementation in
src/marketing.js — and it is the one a stranger evaluating whether to pay you
actually sees first. It picked up the new token counts automatically (they come
from config) but got none of the positioning work.

WHAT CHANGES
------------
1. Removes "Prices remain configuration-driven until the final Stripe products
   are confirmed." That is developer scaffolding on a public sales page. It
   reads as unfinished to anyone deciding whether to trust you with a card.

2. "Most popular" appeared on both the Monthly plan and the Creator boost pack,
   on the same page. The pack becomes "Best seller", matching what patch9 did
   in billing.js.

3. Monthly shows A$34.99 struck through against A$29.99, backed by the real
   Stripe list price and the LAUNCH500 coupon.

4. Yearly shows its per-month equivalent and a "Save N%" badge, computed from
   the configured labels rather than hardcoded.

5. Each plan card gains a per-minute rate, which turns "Best value" from a
   claim into an arithmetic fact.

6. The free card states the 3-day window, matching what the app now enforces.
   Advertising an open-ended free tier that expires in 3 days is the kind of
   thing that generates refund requests.

7. A factual comparison line against Opus Clip's published pricing.

Run from your repo root:

    python3 patch10/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "marketing.js").exists():
    sys.exit("Can't find src/marketing.js — run this from your repo root, not ~.")

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


# ------------------------------------------------------------ plan card data

edit(
    "src/marketing.js",
    "function pricingCards(currentUser = null) {\n"
    "  const accountUrl = currentUser ? '/plans' : '/login?returnTo=/plans';\n"
    "  const plans = [",
    "// Pulls the numeric amount out of a configured label like 'A$29.99' so the\n"
    "// savings maths follows configuration instead of being hardcoded here.\n"
    "function labelAmount(label) {\n"
    "  const match = String(label || '').match(/([\\d]+(?:\\.[\\d]+)?)/);\n"
    "  return match ? Number(match[1]) : 0;\n"
    "}\n"
    "\n"
    "function perMinuteRate(label, tokens) {\n"
    "  const amount = labelAmount(label);\n"
    "  const count = Number(tokens || 0);\n"
    "  if (!amount || !count) return '';\n"
    "  return `${((amount / count) * 100).toFixed(1)}c per source minute`;\n"
    "}\n"
    "\n"
    "function pricingCards(currentUser = null) {\n"
    "  const accountUrl = currentUser ? '/plans' : '/login?returnTo=/plans';\n"
    "  const monthlyAmount = labelAmount(config.planPriceMonthlyLabel);\n"
    "  const yearlyAmount = labelAmount(config.planPriceYearlyLabel);\n"
    "  const yearlySaving = monthlyAmount && yearlyAmount\n"
    "    ? Math.round((1 - (yearlyAmount / 12) / monthlyAmount) * 100)\n"
    "    : 0;\n"
    "  const plans = [",
    "marketing: per-minute + savings maths",
)

edit(
    "src/marketing.js",
    "    { id: 'free', kicker: 'Start', name: 'Free', price: 'A$0', tokens: config.tokensFree, interval: 'starter tokens', copy: 'Explore the complete workflow before choosing a paid plan.', enabled: true },",
    "    { id: 'free', kicker: 'Start', name: 'Free', price: 'A$0', tokens: config.tokensFree, interval: 'starter tokens', copy: config.freeTierDays > 0 ? `Explore the complete workflow free for ${config.freeTierDays} days.` : 'Explore the complete workflow before choosing a paid plan.', enabled: true },",
    "marketing: free card states the window",
)

edit(
    "src/marketing.js",
    "    { id: 'monthly', kicker: 'Consistent', name: 'Monthly', price: config.planPriceMonthlyLabel, tokens: config.tokensMonthly, interval: 'tokens/month', copy: 'For creators building a dependable short-form schedule.', enabled: Boolean(config.stripePriceMonthly), popular: true },",
    "    { id: 'monthly', kicker: 'Consistent', name: 'Monthly', price: config.planPriceMonthlyLabel, listPrice: config.planPriceMonthlyListLabel, tokens: config.tokensMonthly, interval: 'tokens/month', copy: 'For creators building a dependable short-form schedule.', enabled: Boolean(config.stripePriceMonthly), popular: true },",
    "marketing: monthly list price",
)

edit(
    "src/marketing.js",
    "    { id: 'yearly', kicker: 'Best value', name: 'Yearly', price: config.planPriceYearlyLabel, tokens: config.tokensYearly, interval: 'tokens/year', copy: 'For higher-volume clipping across the full year.', enabled: Boolean(config.stripePriceYearly) },",
    "    { id: 'yearly', kicker: 'Best value', name: 'Yearly', price: config.planPriceYearlyLabel, tokens: config.tokensYearly, interval: 'tokens/year', copy: 'For higher-volume clipping across the full year.', enabled: Boolean(config.stripePriceYearly), saving: yearlySaving, perMonth: yearlyAmount ? (yearlyAmount / 12).toFixed(2) : '' },",
    "marketing: yearly savings data",
)

edit(
    "src/marketing.js",
    '  return `<div class="pricing-grid">${plans.map(plan => `<article class="price-card ${plan.popular ? \'popular\' : \'\'}">${plan.popular ? \'<span class="popular-label">Most popular</span>\' : \'\'}<span class="plan-kicker">${escapeHtml(plan.kicker)}</span><h3>${escapeHtml(plan.name)}</h3><div class="plan-price-label">${escapeHtml(plan.price)}</div>',
    '  return `<div class="pricing-grid">${plans.map(plan => `<article class="price-card ${plan.popular ? \'popular\' : \'\'}">${plan.popular ? \'<span class="popular-label">Most popular</span>\' : \'\'}${plan.saving > 0 ? `<span class="popular-label saving">Save ${plan.saving}%</span>` : \'\'}<span class="plan-kicker">${escapeHtml(plan.kicker)}</span><h3>${escapeHtml(plan.name)}</h3><div class="plan-price-label">${plan.listPrice ? `<s>${escapeHtml(plan.listPrice)}</s> ` : \'\'}${escapeHtml(plan.price)}</div>${plan.perMonth ? `<div class="plan-permonth">works out to A$${escapeHtml(plan.perMonth)} a month</div>` : \'\'}',
    "marketing: strikethrough + savings badge + per-month",
)

edit(
    "src/marketing.js",
    "<p>${escapeHtml(plan.copy)}</p><ul><li>Selected source-time processing</li><li>Review, editor and templates included</li><li>Ordinary template rerenders are free</li></ul>",
    "<p>${escapeHtml(plan.copy)}</p>${perMinuteRate(plan.price, plan.tokens) ? `<div class=\"plan-permin\">${escapeHtml(perMinuteRate(plan.price, plan.tokens))}</div>` : ''}<ul><li>Selected source-time processing</li><li>Review, editor and templates included</li><li>Ordinary template rerenders are free</li></ul>",
    "marketing: per-minute rate on each card",
)

# --------------------------------------------------------------- top-up pack

edit(
    "src/marketing.js",
    "    { name: 'Creator boost', tokens: 300, price: config.topupPrice300Label, enabled: Boolean(config.stripePriceTopup300), popular: true },",
    "    { name: 'Creator boost', tokens: 300, price: config.topupPrice300Label, enabled: Boolean(config.stripePriceTopup300), popular: true, label: 'Best seller' },",
    "marketing: top-up gets its own label",
)

edit(
    "src/marketing.js",
    '${pack.popular ? \'<span class="popular-label">Most popular</span>\' : \'\'}<span class="plan-kicker">One-time purchase</span>',
    '${pack.popular ? `<span class="popular-label">${escapeHtml(pack.label || \'Best seller\')}</span>` : \'\'}<span class="plan-kicker">One-time purchase</span>',
    "marketing: no second 'Most popular'",
)

# ------------------------------------------------------------- page copy

edit(
    "src/marketing.js",
    "<h2>Built for different publishing rhythms.</h2><p>Prices remain configuration-driven until the final Stripe products are confirmed.</p></div>",
    "<h2>Built for different publishing rhythms.</h2><p>Start small, publish consistently, or lock in the best annual value. Every plan bills in source minutes, so you only pay for the footage you actually process.</p></div>",
    "marketing: drop the scaffolding copy",
)

edit(
    "src/marketing.js",
    "${pricingCards(currentUser)}${tokenShop(currentUser)}",
    "${pricingCards(currentUser)}<p class=\"pricing-compare\">Opus Clip Pro is US$29 a month for 300 minutes. DeenClipped Monthly gives you ${config.tokensMonthly} minutes for ${escapeHtml(config.planPriceMonthlyLabel)} &mdash; roughly half the cost per minute of video.</p>${tokenShop(currentUser)}",
    "marketing: comparison line",
)

# ------------------------------------------------------------------- styles

edit(
    "src/public/marketing.css",
    ".plan-price-label{min-height:20px;margin:9px 0 3px;color:var(--gold-bright);font-size:14px;font-weight:800}",
    ".plan-price-label{min-height:20px;margin:9px 0 3px;color:var(--gold-bright);font-size:14px;font-weight:800}"
    ".plan-price-label s{color:var(--muted);font-weight:600;text-decoration-thickness:2px;margin-right:5px}"
    ".plan-permonth{margin:0 0 4px;color:#e7e2da;font-size:12px;font-weight:750}"
    ".plan-permin{margin:2px 0 0;color:var(--gold-bright);font-size:10.5px;font-weight:750;letter-spacing:.02em}"
    ".popular-label.saving{background:var(--green);color:#04240f;right:auto;left:18px}"
    ".pricing-compare{max-width:720px;margin:26px auto 0;padding:13px 18px;text-align:center;border:1px solid rgba(217,182,111,.2);border-radius:16px;background:rgba(217,182,111,.05);color:#c6c1ba;font-size:12.5px;line-height:1.6}",
    "marketing.css: strikethrough, rates, savings badge",
)


print("patch10 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check\n  npm test\n")
