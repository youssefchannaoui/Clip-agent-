#!/usr/bin/env python3
r"""
Carry the useful half of the parallel Clip Styles commit into the studio.

CONTEXT
-------
origin/deenclipped-v2-2 gained two commits that redesigned Channels and Clip
Styles in parallel with today's work, both branching off the same base. The
owner chose to keep this branch's versions. Most of a290ff1 is a large
DC_STYLE_V2_CSS constant re-skinning the old card-and-modal grid, which the
studio replaced outright — but three changes inside templatePreviewMarkup()
are real improvements that the studio benefits from, because the studio
renders that same preview at both strip and stage size:

1. templatePreviewWords(mode) — each caption mode previews different sample
   text, so switching mode in the studio visibly changes the specimen
   instead of re-flowing the same sentence.
2. Retuned clamps. The old divisors let a high captionFontSize overflow the
   142px strip thumbnail; the new ones cap size, outline and shadow tighter.
   This is the "stable caption previews" in that commit's title, and it
   matters more in the studio than it did in the old grid because the strip
   thumbnails are smaller.
3. data-caption-mode on the phone plus a .dc-style-preview-shade overlay, so
   captions stay legible over a bright frame.

Everything else from those commits is deliberately left behind.

Run from your repo root:

    python3 patch27/apply.py
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


def edit(path, old, new, label):
    text = path.read_text()
    outstanding = text.replace(new, "").count(old) if new else text.count(old)
    if outstanding == 0 and new and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if old not in text:
        sys.exit(f"ANCHOR NOT FOUND for '{label}'.\nExpected:\n{old[:220]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# 1. Sample words per caption mode.
edit(
    JS,
    "function templatePreviewMarkup(t,sourcePreview='',large=false){",
    "function templatePreviewWords(mode){\n"
    "  if(mode==='phrase')return `<span>Faith grows through patient action.</span>`;\n"
    "  if(mode==='word')return `<span>Small acts build</span><em>real faith</em>`;\n"
    "  return `<span>STAY</span><em>CONSISTENT</em>`;\n"
    "}\n"
    "function templatePreviewMarkup(t,sourcePreview='',large=false){",
    "add templatePreviewWords(mode)",
)

edit(
    JS,
    "  const caption=mode==='phrase'?`<span>Faith grows through consistent action</span>`:mode==='word'?`<span>Faith grows through</span><em>consistent action</em>`:`<span>Faith grows</span><em>through action</em>`;",
    "  const caption=templatePreviewWords(mode);",
    "use templatePreviewWords() in the preview",
)

# 2. Clamps that keep a large captionFontSize inside the small thumbnail.
edit(
    JS,
    "  const fontSize=clamp(Number(t.captionFontSize||82)/(large?3.2:4.6),large?19:14,large?42:29),weight=clamp(Number(t.captionFontWeight||800),400,900),outline=clamp(Number(t.captionOutlineWidth||4)/(large?2.8:4),0,4),shadow=clamp(Number(t.captionShadow||1),0,8);",
    "  const fontSize=clamp(Number(t.captionFontSize||82)/(large?3.1:4.8),large?20:14,large?38:26),weight=clamp(Number(t.captionFontWeight||800),400,900),outline=clamp(Number(t.captionOutlineWidth||4)/(large?3.2:4.8),0,3),shadow=clamp(Number(t.captionShadow||1),0,7);",
    "retune preview clamps so big caption sizes cannot overflow",
)

# 3. Mode hook + legibility shade.
edit(
    JS,
    '  return `<div class="dc-style-phone ${large?\'large\':\'\'}" data-fit="${esc(fit)}" style="--style-bg:',
    '  return `<div class="dc-style-phone ${large?\'large\':\'\'}" data-fit="${esc(fit)}" data-caption-mode="${esc(mode)}" style="--style-bg:',
    "expose the caption mode on the preview element",
)
edit(
    JS,
    '">${media}<span class="dc-style-sample-badge">Sample preview</span>',
    '">${media}<div class="dc-style-preview-shade"></div><span class="dc-style-sample-badge">Sample preview</span>',
    "add the legibility shade over the frame",
)

# CSS for the shade only. The rest of DC_STYLE_V2_CSS styled the old grid.
CSS_ANCHOR = "/* Clip Styles studio"
CSS_BLOCK = """body.dc-app .dc-style-preview-shade { position:absolute;z-index:2;inset:0;pointer-events:none;background:linear-gradient(180deg,rgba(0,0,0,.22),transparent 28%,transparent 61%,rgba(0,0,0,.42)); }

"""
css_text = CSS.read_text()
if "dc-style-preview-shade" in css_text:
    skipped.append("CSS: preview shade (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: preview shade")
else:
    sys.exit("CSS anchor not found in studio-v6.css. Nothing written.")

js = JS.read_text()
names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch27 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
