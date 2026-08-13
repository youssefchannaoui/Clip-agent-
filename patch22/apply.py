#!/usr/bin/env python3
"""
Redesign Clip Styles. "templates look so bad i still dont like it at all".

WHAT WAS WRONG
--------------
A style is a visual thing, but the card gave the preview about a third of
its height and spent the rest on words: a category line, a name, a
description sentence, and three spec chips (caption mode, fit mode, font)
that repeat what the preview already shows you. So you read the card
instead of looking at it, and the thing you actually judge — how captions
sit on a real frame — was the smallest element.

The page also opened with a three-step "Preview / Use / Fine-tune" ribbon
and a "current default" banner before you reached a single style, and split
built-in from custom with two full section headers even when you had no
custom styles at all.

WHAT CHANGES
------------
- The preview becomes the card. Bigger, 9:16, edge to edge at the top, with
  the name and one badge overlaid on a gradient scrim instead of stacked
  underneath in their own block.
- The description sentence and the three spec chips are gone. Caption mode
  and fit are legible from the preview itself; the font name is not a
  reason to pick a style.
- Two Settings sections: "Ready-made" and "Your styles". The custom section
  only renders when custom styles exist, so an empty account sees one grid
  instead of two headers and an empty state.
- The step ribbon goes. The current default is shown as the selected card,
  which is where you would look for it.

PRESERVED: every action hook — data-preview-template, data-use-template,
data-duplicate-template, data-delete-template, data-open-style-editor,
data-apply-template — plus templatePreviewMarkup() and the modal that
openTemplatePreview() renders, both untouched.

Run from your repo root:

    python3 patch22/apply.py
"""
import pathlib
import re
import sys

ROOT = pathlib.Path.cwd()
JS = ROOT / "src/public/activity-fix.js"
CSS = ROOT / "src/public/studio-v6.css"
if not JS.exists():
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
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {relpath}.\nExpected:\n{old[:300]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


OLD_CARD = """  return `<article class="dc-template-card dc-style-card ${selected?'is-current':''}"><button class="dc-style-card-preview" type="button" data-preview-template="${esc(t.id)}" aria-label="Preview ${esc(t.name||'style')}">${templatePreviewMarkup(t,sourcePreview)}<span class="dc-style-enlarge">${ICON.search} View larger</span></button><div class="dc-style-card-body"><div class="dc-style-card-title"><div><small>${t.builtIn?'DeenClipped style':'Your custom style'}</small><h3>${esc(t.name||'Untitled style')}</h3></div><span class="dc-pill ${selected?'good':''}">${selected?'Default':t.builtIn?'Built-in':'Custom'}</span></div><p>${esc(t.description||'A reusable look for captions, framing and colour.')}</p><div class="dc-style-specs"><span>${templateModeLabel(t.captionMode)}</span><span>${templateFitLabel(t.fitMode)}</span><span>${esc(t.captionFont||'Default font')}</span></div><div class="dc-style-card-actions"><button class="dc-btn secondary" data-preview-template="${esc(t.id)}">Preview</button><button class="dc-btn" data-use-template="${esc(t.id)}" ${selected?'disabled':''}>${selected?'Used for new clips':'Use for new clips'}</button>${more}</div></div></article>`;"""

NEW_CARD = """  return `<article class="dc-style-tile ${selected?'is-current':''}"><button class="dc-style-tile-preview" type="button" data-preview-template="${esc(t.id)}" aria-label="Preview ${esc(t.name||'style')}">${templatePreviewMarkup(t,sourcePreview)}<span class="dc-style-scrim"><strong>${esc(t.name||'Untitled style')}</strong>${selected?'<b class="dc-style-flag">Default</b>':''}</span><span class="dc-style-enlarge">${ICON.search}</span></button><div class="dc-style-tile-actions"><button class="dc-btn" data-use-template="${esc(t.id)}" ${selected?'disabled':''}>${selected?'In use':'Use this'}</button>${more}</div></article>`;"""

edit("src/public/activity-fix.js", OLD_CARD, NEW_CARD, "templateCard(): preview-led tile, name overlaid, chips removed")


js = JS.read_text()
START = "  panel.innerHTML=`<div class=\"dc-styles-page\">"
if START in js:
    start = js.index(START)
    end = js.index("  $$('.dc-style-phone img',panel)", start)
    old = js[start:end]
    if "data-open-style-editor" not in old:
        sys.exit("Sliced Clip Styles markup looks wrong — aborting rather than guessing.")

    NEW_MARKUP = """  panel.innerHTML=`<div class="dc-settings-hub dc-styles-page">
    <section class="dc-settings-command"><div><span class="dc-settings-kicker">${ICON.style} Clip styles</span><h1>Choose how new clips look.</h1><p>Captions, framing, colour and watermark placement. Existing clips stay as they are.</p></div><div class="dc-settings-command-status"><span class="on"><i>${ICON.check}</i><b>${esc(shortText(selected.name||'None',18))}</b><em>current default</em></span><span class="${recommended.length?'on':''}"><i>${ICON.style}</i><b>${recommended.length} ready-made</b><em>styles</em></span><span class="${custom.length?'on':''}"><i>${ICON.brand}</i><b>${custom.length} custom</b><em>yours</em></span></div></section>
    <section class="dc-settings-section"><header><span>${ICON.style}</span><div><small>Ready-made</small><h2>Recommended styles</h2></div>${hasClips?`<b><button type="button" data-apply-template="${esc(selected.id||'')}">Apply default to existing clips</button></b>`:''}</header><div class="dc-style-grid">${recommendedCards||`<div class="dc-qc-empty">Default styles could not be loaded.</div>`}</div></section>
    ${custom.length?`<section class="dc-settings-section violet"><header><span>${ICON.brand}</span><div><small>Your studio</small><h2>Your styles</h2></div><b>${custom.length} saved</b></header><div class="dc-style-grid">${customCards}</div></section>`:`<div class="dc-style-make"><span>${ICON.style}</span><div><strong>Create your own style</strong><p>Open a clip, adjust captions and colour, then save the look.</p></div><button class="dc-btn" data-open-style-editor>${hasClips?'Open editor':'Create a clip first'}</button></div>`}
  </div>`;
"""
    JS.write_text(js[:start] + NEW_MARKUP + js[end:])
    changed.append("renderTemplatesPage(): Settings sections, custom grid only when it exists")
elif 'class="dc-settings-hub dc-styles-page"' in js:
    skipped.append("renderTemplatesPage(): Settings sections (already applied)")
else:
    sys.exit("Could not find the Clip Styles markup. Nothing written.")


# ---------------------------------------------------------------------- CSS

CSS_ANCHOR = "/* Consistent screen language across the existing, already-functional views. */"
CSS_BLOCK = """/* Clip Styles — the preview is the card. */
body.dc-app .dc-styles-page { display:grid;gap:16px; }
body.dc-app .dc-style-grid { display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:12px;padding:18px 20px; }
body.dc-app .dc-style-tile { display:grid;gap:9px;border-radius:18px; }
body.dc-app .dc-style-tile-preview { position:relative;display:block;width:100%;aspect-ratio:9/16;overflow:hidden;border:1px solid rgba(255,255,255,.08);border-radius:16px;background:#060607;padding:0;transition:transform .18s ease,border-color .18s ease; }
body.dc-app .dc-style-tile-preview:hover { transform:translateY(-3px);border-color:rgba(224,186,117,.42); }
body.dc-app .dc-style-tile.is-current .dc-style-tile-preview { border-color:rgba(104,213,157,.55);box-shadow:0 0 0 1px rgba(104,213,157,.28); }
body.dc-app .dc-style-tile-preview .dc-style-phone { position:absolute;inset:0;width:100%;height:100%;border-radius:0;border:0;box-shadow:none; }
body.dc-app .dc-style-scrim { position:absolute;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:22px 11px 11px;background:linear-gradient(180deg,transparent,rgba(3,4,6,.92));text-align:left; }
body.dc-app .dc-style-scrim strong { font-size:10.5px;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-style-flag { flex-shrink:0;padding:4px 8px;border-radius:999px;background:rgba(104,213,157,.20);color:#8fe6bb;font-size:7.5px;letter-spacing:.06em;text-transform:uppercase; }
body.dc-app .dc-style-enlarge { position:absolute;top:9px;right:9px;width:27px;height:27px;display:grid;place-items:center;border-radius:9px;background:rgba(3,4,6,.68);color:#fff;opacity:0;transition:opacity .18s ease; }
body.dc-app .dc-style-enlarge svg { width:14px;height:14px;fill:none;stroke:currentColor; }
body.dc-app .dc-style-tile-preview:hover .dc-style-enlarge { opacity:1; }
body.dc-app .dc-style-tile-actions { display:flex;gap:7px;align-items:center; }
body.dc-app .dc-style-tile-actions .dc-btn { flex:1;min-height:34px;padding:0 10px;font-size:8.5px; }
body.dc-app .dc-styles-page .dc-settings-section>header>b { padding:0; }
body.dc-app .dc-styles-page .dc-settings-section>header>b button { padding:8px 12px;border-radius:999px;background:transparent;color:var(--setting-accent);font-size:7.5px;white-space:nowrap; }
body.dc-app .dc-style-make { display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:13px;align-items:center;padding:16px 18px;border:1px dashed rgba(255,255,255,.10);border-radius:18px; }
body.dc-app .dc-style-make>span { width:44px;height:44px;display:grid;place-items:center;border-radius:13px;background:rgba(181,144,255,.10);color:#c8acff; }
body.dc-app .dc-style-make svg { width:21px;height:21px;fill:none;stroke:currentColor; }
body.dc-app .dc-style-make strong { font-size:12px; }
body.dc-app .dc-style-make p { margin:4px 0 0;color:var(--v6-muted);font-size:9px; }
@media (max-width:760px) {
  body.dc-app .dc-style-grid { grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;padding:14px; }
  body.dc-app .dc-style-make { grid-template-columns:44px minmax(0,1fr); }
  body.dc-app .dc-style-make .dc-btn { grid-column:1/-1;width:100%; }
}

"""

css_text = CSS.read_text()
if "body.dc-app .dc-style-tile-preview" in css_text:
    skipped.append("CSS: Clip Styles styles (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: Clip Styles styles")
else:
    sys.exit("CSS anchor comment not found in studio-v6.css. Nothing written.")


js = JS.read_text()
for hook in ("data-preview-template", "data-use-template", "data-duplicate-template",
             "data-delete-template", "data-open-style-editor", "data-apply-template"):
    if hook not in js:
        sys.exit(f"Action hook '{hook}' disappeared — that control would stop working.")

names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch22 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nAll 6 style action hooks verified present. No duplicate declarations.")
print("\nNext:\n  npm run check && npm test\n")
