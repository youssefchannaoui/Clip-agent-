#!/usr/bin/env python3
"""
Re-skin Quality Center in the Settings visual language. Less text, bigger art.

WHAT I GOT WRONG IN patch15
----------------------------
Simplifying the *information* was right. But I invented a fresh set of bare
CSS classes that opted out of the design system every other screen uses, so
the page rendered as flat grey boxes next to genuinely designed neighbours.

Settings is the best-looking screen in the app, and it earns that with a
repeatable pattern:
  - `.dc-settings-command`  — hero with layered radial gradients and a
                              3-up status strip (`.dc-settings-command-status`)
  - `.dc-settings-section`  — card whose <header> is a 46px accent icon tile
                              + uppercase kicker + heading + right-side badge,
                              tinted by `--setting-accent` / `--setting-soft`
                              with `.violet` / `.blue` variants

WHAT THIS PATCH DOES
--------------------
Rebuilds Quality Center on those exact classes instead of parallel ones, so
it inherits the gradients, tints and spacing for free and cannot drift from
Settings later. Adds a `.green` section variant (the only genuinely new
token) because "ready to post" reads green, and the palette already defines
--v6-green for it.

Also cuts the writing down, per the brief:
  - Ready rows show a title and a badge. No sentence — "cleared" is the
    whole point of the list they're sitting in.
  - Blocked rows keep exactly one short reason and one button.
  - Thumbnails go 72x68 -> 104x64 (16:9) so the art carries the row rather
    than the copy.

Logic is untouched: renderQualityCenter(), qualityAssessment() and
qualityPrimaryIssue() keep the same behaviour. Presentation only.

Run from your repo root:

    python3 patch17/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "public" / "activity-fix.js").exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

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
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:400]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ---------------------------------------------------------------- row markup
# Ready rows lose their sentence entirely — the list they're in already says
# it. Blocked rows keep one reason and one button.

edit(
    "src/public/activity-fix.js",
    """  return `<article class="dc-qc-row"><button class="dc-qc-thumb" data-edit-video-clip="${id}">${item.clip.thumbUrl?`<img src="${authedUrl(item.clip.thumbUrl)}" alt="${esc(item.clip.title||'Clip')} thumbnail">`:ICON.play}</button><div class="dc-qc-copy"><div class="dc-qc-title-row"><strong>${esc(shortText(item.clip.title||'Untitled clip',72))}</strong><span class="dc-pill ${isReady?'good':'warn'}">${isReady?'Good':'Needs review'}</span></div><p>${isReady?'All checks passed.':esc(primary.reason)}</p></div><div class="dc-qc-actions">${isReady?`<button class="dc-btn secondary" data-edit-video-clip="${id}">Open editor</button>`:primary.button}</div></article>`;""",
    """  return `<article class="dc-qc-row"><button class="dc-qc-thumb" data-edit-video-clip="${id}">${item.clip.thumbUrl?`<img src="${authedUrl(item.clip.thumbUrl)}" alt="${esc(item.clip.title||'Clip')} thumbnail">`:ICON.play}</button><div class="dc-qc-copy"><div class="dc-qc-title-row"><strong>${esc(shortText(item.clip.title||'Untitled clip',64))}</strong><span class="dc-pill ${isReady?'good':'warn'}">${isReady?'Good':'Needs review'}</span></div>${isReady?'':`<p>${esc(primary.reason)}</p>`}</div><div class="dc-qc-actions">${isReady?`<button class="dc-btn secondary" data-edit-video-clip="${id}">Open editor</button>`:primary.button}</div></article>`;""",
    "row: drop the redundant sentence on cleared clips",
)


# ------------------------------------------------------- sections + the hero

edit(
    "src/public/activity-fix.js",
    """  const lists=`<section class="dc-qc-group"><div class="dc-qc-group-head"><h2>Ready to post</h2><span class="dc-pill good">${ready.length}</span></div><div class="dc-qc-list">${ready.length?ready.map(item=>qualityRow(item,true)).join(''):'<div class="dc-qc-empty">Nothing is fully clear yet — fix the items below first.</div>'}</div></section>
    <section class="dc-qc-group"><div class="dc-qc-group-head"><h2>Needs a fix</h2><span class="dc-pill ${blocked.length?'warn':'good'}">${blocked.length}</span></div><div class="dc-qc-list">${blocked.length?blocked.map(item=>qualityRow(item,false)).join(''):`<div class="dc-qc-empty">${ICON.check} Nothing is blocked.</div>`}</div></section>`;""",
    """  const lists=`<section class="dc-settings-section green"><header><span>${ICON.check}</span><div><small>Cleared</small><h2>Ready to post</h2></div><b>${ready.length} ${ready.length===1?'clip':'clips'}</b></header><div class="dc-qc-list">${ready.length?ready.map(item=>qualityRow(item,true)).join(''):'<div class="dc-qc-empty">Nothing is fully clear yet — fix the items below first.</div>'}</div></section>
    <section class="dc-settings-section"><header><span>${ICON.warning}</span><div><small>Blocked</small><h2>Needs a fix</h2></div><b>${blocked.length} ${blocked.length===1?'clip':'clips'}</b></header><div class="dc-qc-list">${blocked.length?blocked.map(item=>qualityRow(item,false)).join(''):`<div class="dc-qc-empty">${ICON.check} Nothing is blocked.</div>`}</div></section>`;""",
    "sections: reuse the Settings section pattern (icon tile, kicker, badge)",
)

edit(
    "src/public/activity-fix.js",
    """  panel.innerHTML=`<div class="dc-qc-page"><section class="dc-qc-hero"><div><span class="dc-product-kicker">${ICON.quality} Quality Center</span><h1>What can post right now.</h1><p>Everything ready to go out, and everything that's blocked with one reason and one fix.</p></div><button class="dc-btn" id="dcQualityRefresh">Run fresh checks</button></section>
    ${clips.length?lists:empty}
  </div>`;""",
    """  const connected=connectedPlatformCount(d);
  panel.innerHTML=`<div class="dc-settings-hub dc-qc-page"><section class="dc-settings-command"><div><span class="dc-settings-kicker">${ICON.quality} Quality Center</span><h1>What can post right now.</h1><p>Everything cleared to go out, and everything blocked — with the one thing that fixes it.</p><div class="dc-qc-hero-actions"><button class="dc-btn" id="dcQualityRefresh">Run fresh checks</button></div></div><div class="dc-settings-command-status"><span class="${ready.length?'on':''}"><i>${ICON.check}</i><b>${ready.length} ready</b><em>cleared to post</em></span><span class="${blocked.length?'':'on'}"><i>${ICON.warning}</i><b>${blocked.length} blocked</b><em>need a fix</em></span><span class="${connected?'on':''}"><i>${ICON.social}</i><b>${connected} connected</b><em>channels</em></span></div></section>
    ${clips.length?lists:empty}
  </div>`;""",
    "hero: reuse the Settings command hero with its 3-up status strip",
)


# ---------------------------------------------------------------------- CSS

CSS_PATH = ROOT / "src/public/studio-v6.css"
css_text = CSS_PATH.read_text()

CSS_OLD_START = "body.dc-app .dc-qc-page { display:flex;flex-direction:column;gap:14px; }"
CSS_OLD_END = "body.dc-app .dc-qc-empty-page { min-height:220px;display:grid;place-items:center;align-content:center; }.dc-qc-empty-page>svg{width:35px;height:35px;margin-bottom:10px;color:var(--v6-green)}.dc-qc-empty-page strong{color:#fff;font-size:13px;display:block;margin-bottom:4px}.dc-qc-empty-page p{margin:0 0 13px}"

CSS_NEW = """/* Quality Center reuses the Settings section/hero pattern wholesale so the
 * two screens cannot drift apart. Only the clip rows are new. */
body.dc-app .dc-qc-page { display:grid;gap:16px; }
body.dc-app .dc-qc-hero-actions { margin-top:18px; }
body.dc-app .dc-settings-section.green { --setting-accent:#72dda9;--setting-soft:rgba(104,213,157,.10); }
body.dc-app .dc-qc-list { display:grid;gap:9px;padding:18px 20px; }
body.dc-app .dc-qc-row {
  display:grid;grid-template-columns:104px minmax(0,1fr) auto;gap:14px;align-items:center;
  padding:11px;border:1px solid rgba(255,255,255,.065);border-radius:16px;background:rgba(2,2,4,.23);
  transition:transform .18s ease,border-color .18s ease;
}
body.dc-app .dc-qc-row:hover { transform:translateY(-2px);border-color:color-mix(in srgb,var(--setting-accent) 34%,transparent); }
body.dc-app .dc-qc-thumb { width:104px;height:64px;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.06);background:#060607;color:var(--v6-muted);display:grid;place-items:center; }
body.dc-app .dc-qc-thumb img { width:100%;height:100%;object-fit:cover; }
body.dc-app .dc-qc-thumb svg { width:20px;height:20px;fill:none;stroke:currentColor;opacity:.55; }
body.dc-app .dc-qc-copy { min-width:0; }
body.dc-app .dc-qc-title-row { display:flex;align-items:center;gap:9px;flex-wrap:wrap; }
body.dc-app .dc-qc-title-row strong { font-size:11.5px;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%; }
body.dc-app .dc-qc-copy p { margin:6px 0 0;color:var(--v6-muted);font-size:9px;line-height:1.5; }
body.dc-app .dc-qc-actions { display:flex;gap:7px;flex-shrink:0; }
body.dc-app .dc-qc-actions .dc-btn { min-height:36px;padding:0 14px;font-size:8.5px; }
body.dc-app .dc-qc-empty { margin:18px 20px;padding:26px;text-align:center;color:var(--v6-muted);border:1px dashed rgba(255,255,255,.08);border-radius:15px;font-size:9.5px; }
body.dc-app .dc-qc-empty svg { width:17px;height:17px;fill:none;stroke:currentColor;vertical-align:-3px;margin-right:6px;color:var(--v6-green); }
body.dc-app .dc-qc-empty-page { min-height:240px;display:grid;place-items:center;align-content:center;text-align:center;padding:34px;border:1px dashed var(--v6-line);border-radius:22px;color:var(--v6-muted); }.dc-qc-empty-page>svg{width:38px;height:38px;margin-bottom:12px;color:var(--v6-green)}.dc-qc-empty-page strong{color:#fff;font-size:14px;display:block;margin-bottom:5px}.dc-qc-empty-page p{margin:0 0 15px;font-size:9.5px}"""

if CSS_OLD_START in css_text:
    start = css_text.index(CSS_OLD_START)
    if CSS_OLD_END not in css_text:
        sys.exit("CSS end anchor for the dc-qc-* block was not found. Nothing written.")
    end = css_text.index(CSS_OLD_END) + len(CSS_OLD_END)
    CSS_PATH.write_text(css_text[:start] + CSS_NEW + css_text[end:])
    changed.append("CSS: dc-qc-* rebuilt on the Settings pattern")
elif "body.dc-app .dc-settings-section.green" in css_text:
    skipped.append("CSS: dc-qc-* rebuilt on the Settings pattern (already applied)")
else:
    sys.exit("CSS anchor for the dc-qc-* block was not found. Nothing written.")


# The hero and sections are Settings components now, so they already have
# their own breakpoints. Only the clip rows still need one.
edit(
    "src/public/studio-v6.css",
    "  body.dc-app .dc-qc-hero { padding:20px 16px;min-height:0;flex-direction:column;align-items:flex-start;gap:12px; }\n"
    "  body.dc-app .dc-qc-hero h1 { font-size:30px; }\n"
    "  body.dc-app .dc-qc-row { grid-template-columns:54px minmax(0,1fr); }.dc-qc-thumb{width:54px!important;height:62px!important}.dc-qc-actions{grid-column:1/-1;justify-content:flex-end}\n",
    "  body.dc-app .dc-qc-list { padding:14px; }\n"
    "  body.dc-app .dc-qc-row { grid-template-columns:78px minmax(0,1fr); }.dc-qc-thumb{width:78px!important;height:50px!important}.dc-qc-actions{grid-column:1/-1;justify-content:flex-end}\n",
    "CSS: 760px breakpoint keeps the thumbnail 16:9 and wraps the action",
)

edit(
    "src/public/studio-v6.css",
    "  body.dc-app .dc-qc-row { grid-template-columns:66px minmax(0,1fr); }\n"
    "  body.dc-app .dc-qc-thumb { width:66px;height:70px; }\n"
    "  body.dc-app .dc-qc-actions { grid-column:1/-1;justify-content:flex-end; }\n",
    "",
    "CSS: drop the 980px row override (the 760px one is enough)",
)

print("patch17 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
