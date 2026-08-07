#!/usr/bin/env python3
"""
Pricing v2 — allowances, trial gating, free-tier expiry, plans page.

Backs the Stripe sandbox changes made on 8 Aug 2026 (see STRIPE-SANDBOX-V2.md).

WHAT CHANGES
------------
1. Allowances: weekly 120 -> 75, monthly 650 -> 400, yearly 9000 -> 4800.
   Stripe product descriptions already say these numbers. Until this lands,
   Stripe and the app disagree about what a customer bought.

2. Top-up labels: A$4.99/11.99/24.99 -> A$8.99/24.49/59.99. The old Creator
   boost priced tokens at A$0.040/min against a monthly plan rate of
   A$0.046/min, so top-ups undercut the subscription they were meant to
   supplement. All three packs now price above the plan rate.

3. Monthly checkout applies coupon STRIPE_COUPON_MONTHLY (LAUNCH500) against
   the A$34.99 list price, so the customer pays A$29.99 and the invoice shows
   a real discount. Stripe rejects `discounts` together with
   `allow_promotion_codes`, so the latter is dropped when a coupon applies.

   *** Without this, checkout against the new price bills A$34.99. ***

4. Trials are restricted to monthly/yearly (TRIAL_PLANS). A 7-day trial on a
   7-day billing cycle made the entire first Weekly period free.

5. Free tier expires after FREE_TIER_DAYS (default 3), enforced server-side in
   assertCanSpend — not in the UI, where it could be bypassed.

6. assertCanSpend now throws BillingError with a `code` ('free_expired' or
   'insufficient_tokens') plus the numbers, so the dashboard can render a
   proper upsell modal instead of a toast. (Modal itself is patch8.)

7. Plans page: fixes the doubled period suffix ("A$9.99 / week / week"),
   removes the duplicate badge on Monthly ("Most popular" AND "Recommended"),
   shows the A$34.99 strikethrough, and adds a per-minute rate to each card.

Run from your repo root:

    python3 patch7/apply.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "billing.js").exists():
    sys.exit("Can't find src/billing.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label):
    """Idempotent anchored replace. Fails loudly rather than half-applying."""
    path = ROOT / relpath
    text = path.read_text()
    # Deciding "already applied" is fiddlier than it looks.
    #   - `new in text` alone false-positives when `new` is a substring of
    #     something inserted earlier in this same run (skips a real edit).
    #   - `old not in text` alone false-negatives whenever `new` contains `old`,
    #     which is the common "keep the line, append below it" shape (applies twice).
    # So: count anchors that survive with every copy of `new` removed. Zero of
    # those plus `new` present means there is genuinely nothing left to do.
    outstanding = text.replace(new, "").count(old)
    if outstanding == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if outstanding == 0:
        sys.exit(
            f"ANCHOR NOT FOUND for '{label}' in {relpath}.\n"
            f"Expected to find:\n{old}\n\n"
            "Nothing has been written. The file has probably drifted — "
            "re-read it and update this patch."
        )
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}' in {relpath}. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ---------------------------------------------------------------- config.js

edit(
    "src/config.js",
    "  tokensWeekly: Math.max(1, Math.round(number(process.env.TOKENS_WEEKLY, 120))),",
    "  tokensWeekly: Math.max(1, Math.round(number(process.env.TOKENS_WEEKLY, 75))),",
    "weekly allowance 120 -> 75",
)

edit(
    "src/config.js",
    "  tokensMonthly: Math.max(1, Math.round(number(process.env.TOKENS_MONTHLY, 650))),",
    "  tokensMonthly: Math.max(1, Math.round(number(process.env.TOKENS_MONTHLY, 400))),",
    "monthly allowance 650 -> 400",
)

edit(
    "src/config.js",
    "  tokensYearly: Math.max(1, Math.round(number(process.env.TOKENS_YEARLY, 9000))),",
    "  tokensYearly: Math.max(1, Math.round(number(process.env.TOKENS_YEARLY, 4800))),",
    "yearly allowance 9000 -> 4800",
)

edit(
    "src/config.js",
    "  topupPrice100Label: process.env.TOPUP_PRICE_100_LABEL || 'A$4.99',\n"
    "  topupPrice300Label: process.env.TOPUP_PRICE_300_LABEL || 'A$11.99',\n"
    "  topupPrice750Label: process.env.TOPUP_PRICE_750_LABEL || 'A$24.99',",
    "  topupPrice100Label: process.env.TOPUP_PRICE_100_LABEL || 'A$8.99',\n"
    "  topupPrice300Label: process.env.TOPUP_PRICE_300_LABEL || 'A$24.49',\n"
    "  topupPrice750Label: process.env.TOPUP_PRICE_750_LABEL || 'A$59.99',",
    "top-up labels repriced above plan rate",
)

edit(
    "src/config.js",
    "  stripeTrialDays: Math.max(0, Math.round(number(process.env.STRIPE_TRIAL_DAYS, 7))),",
    "  stripeTrialDays: Math.max(0, Math.round(number(process.env.STRIPE_TRIAL_DAYS, 7))),\n"
    "  // Trials only make sense where the trial is shorter than the billing\n"
    "  // cycle. A 7-day trial on a 7-day Weekly plan is a free first period.\n"
    "  trialPlans: String(process.env.TRIAL_PLANS || 'monthly,yearly')\n"
    "    .split(',').map(value => value.trim().toLowerCase()).filter(Boolean),\n"
    "  stripeCouponMonthly: process.env.STRIPE_COUPON_MONTHLY || '',\n"
    "  planPriceMonthlyListLabel: process.env.PLAN_PRICE_MONTHLY_LIST_LABEL || '',\n"
    "  freeTierDays: Math.max(0, Math.round(number(process.env.FREE_TIER_DAYS, 3))),",
    "new config: trialPlans, monthly coupon, list label, freeTierDays",
)


# --------------------------------------------------------------- billing.js

edit(
    "src/billing.js",
    "export const PLAN_ORDER = ['weekly', 'monthly', 'yearly'];",
    "// Carries a machine-readable reason so the dashboard can show the right\n"
    "// upsell instead of dumping a sentence into a toast.\n"
    "export class BillingError extends Error {\n"
    "  constructor(message, code = 'billing_error', details = {}) {\n"
    "    super(message);\n"
    "    this.name = 'BillingError';\n"
    "    this.code = code;\n"
    "    Object.assign(this, details);\n"
    "  }\n"
    "}\n"
    "\n"
    "export const PLAN_ORDER = ['weekly', 'monthly', 'yearly'];",
    "BillingError class",
)

edit(
    "src/billing.js",
    "      tokens: config.tokensWeekly, priceId: config.stripePriceWeekly, priceLabel: config.planPriceWeeklyLabel,\n"
    "      enabled: Boolean(config.stripePriceWeekly),",
    "      tokens: config.tokensWeekly, priceId: config.stripePriceWeekly, priceLabel: config.planPriceWeeklyLabel,\n"
    "      enabled: Boolean(config.stripePriceWeekly), trialEligible: trialAllowed('weekly'),",
    "weekly trialEligible",
)

edit(
    "src/billing.js",
    "      tokens: config.tokensMonthly, priceId: config.stripePriceMonthly, priceLabel: config.planPriceMonthlyLabel,\n"
    "      enabled: Boolean(config.stripePriceMonthly),",
    "      tokens: config.tokensMonthly, priceId: config.stripePriceMonthly, priceLabel: config.planPriceMonthlyLabel,\n"
    "      listPriceLabel: config.planPriceMonthlyListLabel,\n"
    "      enabled: Boolean(config.stripePriceMonthly), trialEligible: trialAllowed('monthly'),",
    "monthly trialEligible + list price label",
)

edit(
    "src/billing.js",
    "      tokens: config.tokensYearly, priceId: config.stripePriceYearly, priceLabel: config.planPriceYearlyLabel,\n"
    "      enabled: Boolean(config.stripePriceYearly),",
    "      tokens: config.tokensYearly, priceId: config.stripePriceYearly, priceLabel: config.planPriceYearlyLabel,\n"
    "      enabled: Boolean(config.stripePriceYearly), trialEligible: trialAllowed('yearly'),",
    "yearly trialEligible",
)

edit(
    "src/billing.js",
    "export function plans() {\n  return {",
    "export function trialAllowed(planId) {\n"
    "  if (!(config.stripeTrialDays > 0)) return false;\n"
    "  return config.trialPlans.includes(String(planId || '').toLowerCase());\n"
    "}\n"
    "\n"
    "export function plans() {\n  return {",
    "trialAllowed() helper",
)

# --- free tier expiry -------------------------------------------------------

edit(
    "src/billing.js",
    "  billing.periodStart ||= user.createdAt || now();",
    "  billing.periodStart ||= user.createdAt || now();\n"
    "  // The free grant is a trial of the product, not a standing entitlement.\n"
    "  // Stamped once, at first sight of the account, and never extended.\n"
    "  if (billing.plan === 'free' && !billing.freeExpiresAt && config.freeTierDays > 0) {\n"
    "    billing.freeExpiresAt = Number(billing.periodStart) + config.freeTierDays * DAY_MS;\n"
    "  }",
    "stamp freeExpiresAt at account creation",
)

edit(
    "src/billing.js",
    "export function isUnlimited(user) {",
    "export function freeTierState(billing = {}) {\n"
    "  const onFree = String(billing.plan || 'free') === 'free';\n"
    "  const expiresAt = Number(billing.freeExpiresAt || 0) || null;\n"
    "  if (!onFree || !expiresAt) {\n"
    "    return { onFree, expiresAt: null, expired: false, daysLeft: null };\n"
    "  }\n"
    "  return {\n"
    "    onFree: true,\n"
    "    expiresAt,\n"
    "    expired: expiresAt <= now(),\n"
    "    daysLeft: daysRemaining(expiresAt),\n"
    "  };\n"
    "}\n"
    "\n"
    "export function isUnlimited(user) {",
    "freeTierState() helper",
)

edit(
    "src/billing.js",
    "  const trial = trialState(billing);\n"
    "  const baseRemaining = unlimited ? null : Math.max(0, allow - used - reserved);",
    "  const trial = trialState(billing);\n"
    "  const freeTier = unlimited ? { onFree: false, expiresAt: null, expired: false, daysLeft: null } : freeTierState(billing);\n"
    "  const baseRemaining = unlimited ? null : Math.max(0, allow - used - reserved);",
    "publicBilling: compute freeTier",
)

edit(
    "src/billing.js",
    "  if (!unlimited && remaining !== null && allow > 0 && remaining <= Math.max(5, Math.ceil(allow * 0.1))) {",
    "  if (freeTier.onFree && freeTier.expired) {\n"
    "    notices.push({\n"
    "      id: `free-expired-${freeTier.expiresAt}`,\n"
    "      kind: 'free_expired',\n"
    "      title: 'Your free trial has ended',\n"
    "      message: `The free tier runs for ${config.freeTierDays} days. Choose a plan to keep generating clips — your existing clips stay where they are.`,\n"
    "      action: 'Choose plan',\n"
    "    });\n"
    "  } else if (freeTier.onFree && freeTier.daysLeft !== null && freeTier.daysLeft <= 1) {\n"
    "    notices.push({\n"
    "      id: `free-ending-${freeTier.expiresAt}`,\n"
    "      kind: 'free_ending',\n"
    "      title: freeTier.daysLeft === 0 ? 'Free access ends today' : 'Free access ends tomorrow',\n"
    "      message: 'Pick a plan to keep your studio open.',\n"
    "      action: 'Choose plan',\n"
    "    });\n"
    "  }\n"
    "  if (!unlimited && remaining !== null && allow > 0 && remaining <= Math.max(5, Math.ceil(allow * 0.1))) {",
    "publicBilling: free tier notices",
)

edit(
    "src/billing.js",
    "      periodEndsInDays,\n      trial,",
    "      periodEndsInDays,\n      trial,\n      freeTier,",
    "publicBilling: expose freeTier",
)

# --- structured refusals ----------------------------------------------------

edit(
    "src/billing.js",
    "  const info = publicBilling(user);\n"
    "  const needed = Math.max(1, Math.ceil(Number(tokens || 0)));\n"
    "  const remaining = Number(info.current.remaining || 0);\n"
    "  if (remaining < needed) {\n"
    "    throw new Error(`Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}. Upgrade or wait for your plan to renew.`);\n"
    "  }\n"
    "  return true;",
    "  const info = publicBilling(user);\n"
    "  const needed = Math.max(1, Math.ceil(Number(tokens || 0)));\n"
    "  const remaining = Number(info.current.remaining || 0);\n"
    "  const freeTier = info.current.freeTier || {};\n"
    "  // Checked before the balance: an expired free account is blocked even if\n"
    "  // it still shows unspent tokens.\n"
    "  if (freeTier.onFree && freeTier.expired) {\n"
    "    throw new BillingError(\n"
    "      `Your ${config.freeTierDays}-day free trial has ended. Choose a plan to ${action}.`,\n"
    "      'free_expired',\n"
    "      { needed, remaining, plan: info.current.plan, expiredAt: freeTier.expiresAt },\n"
    "    );\n"
    "  }\n"
    "  if (remaining < needed) {\n"
    "    throw new BillingError(\n"
    "      `Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}.`,\n"
    "      'insufficient_tokens',\n"
    "      { needed, remaining, shortfall: needed - remaining, plan: info.current.plan },\n"
    "    );\n"
    "  }\n"
    "  return true;",
    "assertCanSpend: structured refusals + free expiry gate",
)

# --- checkout ---------------------------------------------------------------

edit(
    "src/billing.js",
    "    'subscription_data[metadata][plan]': plan.id,\n"
    "    allow_promotion_codes: 'true',\n"
    "  };\n"
    "  if (config.stripeTrialDays > 0) params['subscription_data[trial_period_days]'] = String(config.stripeTrialDays);",
    "    'subscription_data[metadata][plan]': plan.id,\n"
    "  };\n"
    "  // A coupon and customer-entered promo codes are mutually exclusive in\n"
    "  // Stripe. The Monthly coupon turns the A$34.99 list price into the\n"
    "  // A$29.99 the page advertises, so it has to be applied server-side --\n"
    "  // leaving it to the customer to type would bill them the list price.\n"
    "  const coupon = plan.id === 'monthly' ? config.stripeCouponMonthly : '';\n"
    "  if (coupon) params['discounts[0][coupon]'] = coupon;\n"
    "  else params.allow_promotion_codes = 'true';\n"
    "  if (trialAllowed(plan.id)) params['subscription_data[trial_period_days]'] = String(config.stripeTrialDays);",
    "checkout: monthly coupon + per-plan trial",
)

# --- plans page -------------------------------------------------------------

edit(
    "src/billing.js",
    "  const planCards = PLAN_ORDER.map(id => bill.plans?.[id]).filter(Boolean).map(plan => {\n"
    "    const configured = Boolean(plan.priceId);\n"
    "    const current = cur.plan === plan.id && cur.status !== 'free';\n"
    "    const cta = current ? 'Current plan' : configured ? (trialDays > 0 ? `Start ${trialDays}-day trial` : 'Subscribe') : 'Stripe price required';",
    "  // The configured label often already carries its own period ('A$9.99 / week'),\n"
    "  // and the card template appends one too, which rendered 'A$9.99 / week / week'.\n"
    "  // Strip any trailing period off the label and let the template own it.\n"
    "  const priceAmount = plan => {\n"
    "    const raw = String(plan.priceLabel || '').trim();\n"
    "    if (!raw) return 'Set price';\n"
    "    const interval = String(plan.interval || '').trim();\n"
    "    if (!interval) return raw;\n"
    "    const stripped = raw.replace(new RegExp(`\\\\s*/\\\\s*${interval}\\\\s*$`, 'i'), '').trim();\n"
    "    return stripped || raw;\n"
    "  };\n"
    "  const perMinute = plan => {\n"
    "    const match = String(plan.priceLabel || '').match(/([\\d]+(?:\\.[\\d]+)?)/);\n"
    "    const tokens = Number(plan.tokens || 0);\n"
    "    if (!match || !tokens) return '';\n"
    "    const cents = (Number(match[1]) / tokens) * 100;\n"
    "    if (!Number.isFinite(cents) || cents <= 0) return '';\n"
    "    return `${cents.toFixed(1)}c per source minute`;\n"
    "  };\n"
    "  const planCards = PLAN_ORDER.map(id => bill.plans?.[id]).filter(Boolean).map(plan => {\n"
    "    const configured = Boolean(plan.priceId);\n"
    "    const current = cur.plan === plan.id && cur.status !== 'free';\n"
    "    const canTrial = Boolean(plan.trialEligible) && trialDays > 0;\n"
    "    const cta = current ? 'Current plan' : configured ? (canTrial ? `Start ${trialDays}-day trial` : 'Subscribe') : 'Stripe price required';\n"
    "    const rate = perMinute(plan);",
    "plans page: price/rate helpers + per-plan CTA",
)

edit(
    "src/billing.js",
    '      <div class="plan-top"><span class="badge">${esc(plan.badge || \'\')}</span>${plan.id === \'monthly\' ? \'<span class="popular">Recommended</span>\' : \'\'}</div>\n'
    "      <h2>${esc(plan.name)}</h2>\n"
    '      <div class="money">${esc(plan.priceLabel || \'Set price\')}<small> / ${esc(plan.interval)}</small></div>',
    '      <div class="plan-top">${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : \'<span></span>\'}${plan.id === \'monthly\' ? \'<span class="popular">Recommended</span>\' : \'\'}</div>\n'
    "      <h2>${esc(plan.name)}</h2>\n"
    '      <div class="money">${plan.listPriceLabel ? `<s>${esc(plan.listPriceLabel)}</s> ` : \'\'}${esc(priceAmount(plan))}<small> / ${esc(plan.interval)}</small></div>\n'
    '      ${rate ? `<div class="per-min">${esc(rate)}</div>` : \'\'}',
    "plans page: strikethrough + per-minute rate + suffix fix",
)

edit(
    "src/billing.js",
    "      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>${trialDays ? `${trialDays}-day trial when shown at checkout` : 'Starts immediately'}</li></ul>",
    "      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>${canTrial ? `${trialDays}-day trial when shown at checkout` : 'Billed immediately, cancel any time'}</li></ul>",
    "plans page: honest trial bullet",
)

# Monthly already carries a "Most popular" badge; the second "Recommended" pill
# is redundant. Swap the badge to the pill so exactly one shows.
edit(
    "src/billing.js",
    "      id: 'monthly', name: 'Monthly', interval: 'month', badge: 'Most popular',",
    "      id: 'monthly', name: 'Monthly', interval: 'month', badge: '',",
    "monthly: drop duplicate badge",
)

edit(
    "src/billing.js",
    "      id: 'free', name: 'Free', interval: 'one-time', badge: 'Test drive',\n"
    "      tokens: config.tokensFree, priceId: '', enabled: true,\n"
    "      description: 'Try the studio before upgrading.',",
    "      id: 'free', name: 'Free', interval: 'one-time', badge: 'Test drive',\n"
    "      tokens: config.tokensFree, priceId: '', enabled: true,\n"
    "      days: config.freeTierDays,\n"
    "      description: config.freeTierDays > 0\n"
    "        ? `Try the studio free for ${config.freeTierDays} days.`\n"
    "        : 'Try the studio before upgrading.',",
    "free plan: surface the 3-day window",
)

edit(
    "src/billing.js",
    "      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>Upgrade any time, keep your clips</li></ul>",
    "      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>${freePlan.days ? `Expires ${freePlan.days} days after signup` : 'Upgrade any time, keep your clips'}</li></ul>",
    "free card: state the expiry",
)

edit(
    "src/billing.js",
    "      `${config.stripeTrialDays || 7}-day trial on paid plans`,",
    "      `${config.stripeTrialDays || 7}-day trial on ${config.trialPlans.join(' and ')} plans`,",
    "terms: trial applies to some plans only",
)

# --- styles -----------------------------------------------------------------

edit(
    "src/billing.js",
    ".money small,.topup-price small{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:0}",
    ".money small,.topup-price small{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:0}"
    ".money s{font-size:20px;color:var(--muted);font-weight:700;text-decoration-thickness:2px;margin-right:4px}"
    ".per-min{font-size:11px;color:var(--gold2);font-weight:700;letter-spacing:.02em;margin:-6px 0 0}",
    "styles: strikethrough + per-minute rate",
)


print("patch7 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print(
    "\nNext:\n"
    "  node --check src/billing.js && node --check src/config.js\n"
    "  npm test\n"
    "  node scripts/check-ui.mjs\n"
    "\nThen set on Render (sandbox values from STRIPE-SANDBOX-V2.md):\n"
    "  STRIPE_PRICE_MONTHLY=price_1U1qM03QNbMPZhPDsIMDXVO5\n"
    "  STRIPE_PRICE_YEARLY=price_1U1qNn3QNbMPZhPDvt2VQStg\n"
    "  STRIPE_PRICE_TOPUP_100=price_1U1qNp3QNbMPZhPD5BBiG0XZ\n"
    "  STRIPE_PRICE_TOPUP_300=price_1U1qNr3QNbMPZhPDdblJWhCN\n"
    "  STRIPE_PRICE_TOPUP_750=price_1U1qNs3QNbMPZhPD3WHDi9FP\n"
    "  STRIPE_COUPON_MONTHLY=LAUNCH500\n"
    "  PLAN_PRICE_MONTHLY_LABEL=A$29.99\n"
    "  PLAN_PRICE_MONTHLY_LIST_LABEL=A$34.99\n"
    "  PLAN_PRICE_WEEKLY_LABEL=A$9.99\n"
    "  PLAN_PRICE_YEARLY_LABEL=A$249\n"
)
