#!/usr/bin/env python3
"""
Plans page: make the free tier a real, findable option.

Right now the 40-token free tier only exists as a small grey strip at the very
bottom of the page, below the token shop ("Not ready to subscribe?"). New users
have to scroll past three paid plans and three top-up packs to find the thing
they are supposed to start with.

This promotes Free to a proper card, first in the plans row, so the page reads
Free -> Weekly -> Monthly -> Yearly.

Also fixes a real labelling bug: the CTA is built as

    `Start ${trialDays || 7}-day trial`

so with STRIPE_TRIAL_DAYS=0 it still advertises "Start 7-day trial" while
checkout charges immediately. Now says "Subscribe" when there is no trial.

Run from your repo root:

    python3 patch6/apply.py
"""
import pathlib, sys

ROOT = pathlib.Path.cwd()
path = ROOT / "src/billing.js"
if not path.exists():
    sys.exit("Can't find src/billing.js — run this from your repo root.")

text = path.read_text()
changed = False

print("\nFree tier visibility\n" + "=" * 21)

# --- 1. Fix the trial label bug -------------------------------------------
old_cta = "const cta = current ? 'Current plan' : configured ? `Start ${trialDays || 7}-day trial` : 'Stripe price required';"
new_cta = "const cta = current ? 'Current plan' : configured ? (trialDays > 0 ? `Start ${trialDays}-day trial` : 'Subscribe') : 'Stripe price required';"
if new_cta in text:
    print("  · already applied: trial label fix")
elif old_cta not in text:
    print("  ! skipped trial label fix (anchor not found)")
else:
    text = text.replace(old_cta, new_cta, 1)
    changed = True
    print("  ✓ CTA no longer advertises a trial when trials are off")

# --- 2. Build the free card ------------------------------------------------
anchor = "  const topupCards = TOPUP_ORDER.map(id => bill.topups?.[id])"
free_card = '''  // The free tier is what new accounts actually start on, so it belongs beside
  // the paid plans rather than in a footnote below the token shop.
  const freePlan = bill.plans?.free;
  const onFree = !cur.plan || cur.plan === 'free' || cur.status === 'free';
  const freeCard = freePlan ? `<article class="dc-plan free-plan">
      <div class="plan-top"><span class="badge">${esc(freePlan.badge || 'Start here')}</span><span class="popular free-tag">No card needed</span></div>
      <h2>${esc(freePlan.name)}</h2>
      <div class="money">A$0<small> / to start</small></div>
      <p>${esc(freePlan.description)}</p>
      <div class="tokens"><b>${esc(freePlan.tokens)}</b><span>tokens to try it out</span></div>
      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>Upgrade any time, keep your clips</li></ul>
      ${onFree
        ? `<form method="post" action="/billing/continue-free"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit">Start with ${esc(freePlan.tokens)} free tokens</button></form>`
        : `<form><button type="button" disabled>Included with every account</button></form>`}
    </article>` : '';

''' + anchor

if "const freeCard = freePlan ?" in text:
    print("  · already applied: free plan card")
elif anchor not in text:
    sys.exit("  ERROR: could not find topupCards to insert the free card before.")
else:
    text = text.replace(anchor, free_card, 1)
    changed = True
    print("  ✓ free plan card built")

# --- 3. Render it first in the plans grid ----------------------------------
old_section = '<section class="plans">${planCards}</section>'
new_section = '<section class="plans">${freeCard}${planCards}</section>'
if new_section in text:
    print("  · already applied: free card in grid")
elif old_section not in text:
    print("  ! skipped grid insert (anchor not found)")
else:
    text = text.replace(old_section, new_section, 1)
    changed = True
    print("  ✓ free card renders first in the plans row")

# --- 4. Four columns + styling --------------------------------------------
old_css = ".plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}"
new_css = (".plans{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}"
           ".dc-plan.free-plan{border-color:rgba(89,212,147,.30);background:linear-gradient(180deg,rgba(89,212,147,.07),rgba(255,255,255,.02))}"
           ".dc-plan.free-plan .badge{color:var(--green);border-color:rgba(89,212,147,.34);background:rgba(89,212,147,.10)}"
           ".dc-plan.free-plan .popular.free-tag{color:#062;background:var(--green)}"
           ".dc-plan.free-plan .tokens b{color:var(--green)}"
           ".dc-plan.free-plan button{background:linear-gradient(180deg,#6fe0a4,#3fbe80);color:#04231４}"
           "@media(max-width:1180px){.plans{grid-template-columns:repeat(2,minmax(0,1fr))}}")
# guard against the stray full-width character sneaking in
new_css = new_css.replace("#04231４", "#042314")

if ".dc-plan.free-plan{" in text:
    print("  · already applied: free card styling")
elif old_css not in text:
    print("  ! skipped styling (anchor not found)")
else:
    text = text.replace(old_css, new_css, 1)
    changed = True
    print("  ✓ four-column grid + free card styling")

# --- 5. Soften the now-redundant bottom strip ------------------------------
old_strip = '<section class="free"><div><strong>Not ready to subscribe?</strong><span>Continue with free starter tokens and return to Plans & tokens from the dashboard whenever you need more.</span></div>'
new_strip = '<section class="free"><div><strong>Already have free tokens?</strong><span>Head back to the dashboard. You can return to Plans &amp; tokens any time from the token pill in the top bar.</span></div>'
if new_strip in text:
    print("  · already applied: bottom strip reworded")
elif old_strip not in text:
    print("  ! skipped bottom strip (anchor not found)")
else:
    text = text.replace(old_strip, new_strip, 1)
    changed = True
    print("  ✓ bottom strip reworded (no longer the only way to find free)")

if changed:
    path.write_text(text)
    print("""
Saved. Then:

  node --check src/billing.js
  git add -A && git commit -m "Promote free tier to a plan card on the plans page"
  git push

The plans row becomes: Free · Weekly · Monthly · Yearly
Four columns on wide screens, two below 1180px, one below 900px.""")
else:
    print("\nNothing to do — already applied.")
