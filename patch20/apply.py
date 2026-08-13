#!/usr/bin/env python3
"""
Redesign Channels on the Settings visual language.

THE COMPLAINT
-------------
"connections channel page needs to be redone as well its not nice"

The page was on the older `.dc-manage-*` system — flat cards, a metrics
strip, and the active-destination switches dumped into a `.dc-settings-panel`
underneath with a paragraph of explanation above them. Nothing was broken;
it just looked like a different product to Settings and Quality Center.

WHAT CHANGES
------------
Presentation only. Every behaviour is preserved exactly:

  - data-social-connect / -test / -disconnect attributes are untouched, so
    the existing click delegation and the YouTube consent modal (which is
    Google-compliance copy, not decoration) keep working.
  - destinationControl() is reused verbatim, so the TikTok privacy select,
    comment/duet/stitch switches and their disabled states are unchanged.
  - Every control ID savePublishingRules() reads is preserved:
    dcPub_youtube, dcPub_tiktok, dcPub_instagram, dcPub_facebook,
    dcTikTokPrivacy, dcTikTokComments, dcTikTokDuet, dcTikTokStitch,
    dcSavePublishing.

The channel cards lead with the platform mark on its own brand-tinted tile
(the `.dc-social-logo` rules already carry YouTube red, TikTok cyan/pink,
Instagram's gradient and Facebook blue), so the grid reads as four
recognisable logos rather than four paragraphs.

Run from your repo root:

    python3 patch20/apply.py
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


OLD_RENDER = """function renderConnections(){
  const panel=$('#view-publishing'),d=data();if(!panel||!d)return;
  const providers=['youtube','tiktok','instagram','facebook'].map(providerInfo);
  const connected=providers.filter(p=>p.connected).length, enabled=providers.filter(p=>p.enabled).length;
  const destinationSettings=connected?`<section class="dc-settings-panel"><h2>Active destinations</h2><p>Only connected channels appear here. TikTok always uses the latest options returned for the connected creator and requires explicit approval for every post.</p><div class="dc-settings-form">${providers.filter(p=>p.connected).map(p=>destinationControl(p)).join('')}<button class="dc-btn wide" id="dcSavePublishing">Save active destinations</button></div></section>`:'';
  panel.innerHTML=`<div class="dc-manage-page"><section class="dc-manage-hero"><div><span class="dc-manage-kicker">${ICON.social} Publishing hub</span><h1>Your channels, one approval flow.</h1><p>Connect each destination once. You still choose which clips are approved, scheduled or published.</p></div><div class="dc-manage-metrics"><span><b>${connected}</b><em>connected</em></span><span><b>${enabled}</b><em>active</em></span><span><b>${d.directPublishingEnabled?'Ready':'Review'}</b><em>posting mode</em></span></div></section><div class="dc-manage-grid">${providers.map(connectionCard).join('')}</div>${destinationSettings}</div>`;
  if($('#dcSavePublishing'))$('#dcSavePublishing').onclick=savePublishingRules;
  requestAnimationFrame(()=>animatePanel(panel));
}"""

NEW_RENDER = """function renderConnections(){
  const panel=$('#view-publishing'),d=data();if(!panel||!d)return;
  const providers=['youtube','tiktok','instagram','facebook'].map(providerInfo);
  const connected=providers.filter(p=>p.connected).length, enabled=providers.filter(p=>p.enabled).length;
  const destinationSettings=connected?`<section class="dc-settings-section blue"><header><span>${ICON.check}</span><div><small>Active</small><h2>Where approved clips go</h2></div><b>${enabled} of ${connected} on</b></header><div class="dc-channel-destinations">${providers.filter(p=>p.connected).map(p=>destinationControl(p)).join('')}<button class="dc-btn" id="dcSavePublishing">Save active destinations</button></div></section>`:'';
  panel.innerHTML=`<div class="dc-settings-hub dc-channels-page"><section class="dc-settings-command"><div><span class="dc-settings-kicker">${ICON.social} Publishing hub</span><h1>Your channels, one approval flow.</h1><p>Connect each destination once. Nothing leaves the studio until you approve it.</p></div><div class="dc-settings-command-status"><span class="${connected?'on':''}"><i>${ICON.social}</i><b>${connected} of 4</b><em>connected</em></span><span class="${enabled?'on':''}"><i>${ICON.check}</i><b>${enabled} active</b><em>destinations</em></span><span class="${d.directPublishingEnabled?'on':''}"><i>${ICON.publish}</i><b>${d.directPublishingEnabled?'Ready':'Review'}</b><em>posting mode</em></span></div></section>
    <section class="dc-settings-section"><header><span>${ICON.social}</span><div><small>Destinations</small><h2>Channels</h2></div><b>${connected} connected</b></header><div class="dc-channel-grid">${providers.map(connectionCard).join('')}</div></section>
    ${destinationSettings}</div>`;
  if($('#dcSavePublishing'))$('#dcSavePublishing').onclick=savePublishingRules;
  requestAnimationFrame(()=>animatePanel(panel));
}"""

edit("src/public/activity-fix.js", OLD_RENDER, NEW_RENDER, "renderConnections(): Settings hero + sectioned channel grid")


OLD_CARD = """function connectionCard(info){
  const connectLabel=info.connected?'Reconnect':'Connect';
  const account=info.account?.name||'No account linked';
  const secondary=info.connected?`<details class="dc-clip-more"><summary>More</summary><div><button data-social-test="${esc(info.connectProvider)}">Test connection</button><button class="danger" data-social-disconnect="${esc(info.connectProvider)}">Disconnect</button></div></details>`:'';
  return `<article class="dc-manage-card"><div class="dc-manage-card-top"><span class="dc-manage-logo dc-social-logo ${esc(info.provider)}">${socialSvg(info.provider)}</span><div class="dc-manage-copy"><strong>${esc(providerTitle(info.provider))}</strong><span>${esc(providerSummary(info))}</span></div><span class="dc-pill ${providerBadge(info)}">${info.enabled?'Active':info.connected?'Connected':info.configured?'Not connected':'Setup needed'}</span></div><div class="dc-manage-list"><div class="dc-manage-row"><div><strong>${esc(account)}</strong><span>${info.status.lastTestAt?`Checked ${formatRelative(info.status.lastTestAt)}`:info.status.lastTestError?`Connection issue: ${shortError(info.status.lastTestError)}`:info.connected?'Ready to test and publish.':'Connect to make this destination available.'}</span></div></div></div><div class="dc-manage-actions simple ${info.connected?'two':''}"><button class="dc-btn" data-social-connect="${esc(info.connectProvider)}" ${!info.configured?'disabled':''}>${connectLabel}</button>${secondary}</div></article>`;
}"""

NEW_CARD = """function connectionCard(info){
  const connectLabel=info.connected?'Reconnect':'Connect';
  const account=info.account?.name||'No account linked';
  const state=info.enabled?'Active':info.connected?'Connected':info.configured?'Not connected':'Setup needed';
  // Only surface a live health line when there is something real to report;
  // a card that always carries a sentence is what made this page noisy.
  const health=info.status.lastTestError?`<p class="dc-channel-health bad">${esc(shortError(info.status.lastTestError))}</p>`
    :info.status.lastTestAt?`<p class="dc-channel-health">Checked ${esc(formatRelative(info.status.lastTestAt))}</p>`
    :!info.configured?`<p class="dc-channel-health bad">Needs API keys in Render.</p>`:'';
  const secondary=info.connected?`<details class="dc-clip-more"><summary>More</summary><div><button data-social-test="${esc(info.connectProvider)}">Test connection</button><button class="danger" data-social-disconnect="${esc(info.connectProvider)}">Disconnect</button></div></details>`:'';
  return `<article class="dc-channel-card ${esc(info.provider)} ${info.connected?'is-connected':''}"><div class="dc-channel-top"><span class="dc-channel-logo dc-social-logo ${esc(info.provider)}">${socialSvg(info.provider)}</span><div class="dc-channel-name"><strong>${esc(providerTitle(info.provider))}</strong><small>${esc(account)}</small></div><span class="dc-pill ${providerBadge(info)}">${esc(state)}</span></div>${health}<div class="dc-channel-actions"><button class="dc-btn ${info.connected?'secondary':''}" data-social-connect="${esc(info.connectProvider)}" ${!info.configured?'disabled':''}>${connectLabel}</button>${secondary}</div></article>`;
}"""

edit("src/public/activity-fix.js", OLD_CARD, NEW_CARD, "connectionCard(): logo-led card, health line only when real")


# ---------------------------------------------------------------------- CSS

CSS_ANCHOR = "/* Consistent screen language across the existing, already-functional views. */"
CSS_BLOCK = """/* Channels — Settings sections plus a logo-led destination grid. */
body.dc-app .dc-channels-page { display:grid;gap:16px; }
body.dc-app .dc-channel-grid { display:grid;grid-template-columns:repeat(auto-fit,minmax(248px,1fr));gap:11px;padding:18px 20px; }
body.dc-app .dc-channel-card { display:grid;gap:11px;align-content:start;padding:15px;border:1px solid rgba(255,255,255,.07);border-radius:18px;background:rgba(2,2,4,.23);transition:transform .18s ease,border-color .18s ease; }
body.dc-app .dc-channel-card:hover { transform:translateY(-2px); }
body.dc-app .dc-channel-card.youtube:hover { border-color:rgba(255,69,107,.34); }
body.dc-app .dc-channel-card.tiktok:hover { border-color:rgba(79,245,239,.30); }
body.dc-app .dc-channel-card.instagram:hover { border-color:rgba(255,145,196,.32); }
body.dc-app .dc-channel-card.facebook:hover { border-color:rgba(139,188,255,.32); }
body.dc-app .dc-channel-top { display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:11px;align-items:center; }
body.dc-app .dc-channel-logo { width:46px;height:46px;display:grid;place-items:center;border-radius:14px; }
body.dc-app .dc-channel-logo svg { width:23px;height:23px; }
body.dc-app .dc-channel-name { min-width:0; }
body.dc-app .dc-channel-name strong { display:block;font-size:12px;letter-spacing:-.01em; }
body.dc-app .dc-channel-name small { display:block;margin-top:3px;color:var(--v6-muted);font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-channel-health { margin:0;color:var(--v6-muted);font-size:9px;line-height:1.5; }
body.dc-app .dc-channel-health.bad { color:#f5a3ae; }
body.dc-app .dc-channel-actions { display:flex;gap:7px;align-items:center; }
body.dc-app .dc-channel-actions .dc-btn { flex:1;min-height:36px;padding:0 12px;font-size:8.5px; }
body.dc-app .dc-channel-destinations { display:grid;gap:9px;padding:18px 20px; }
body.dc-app .dc-channel-destinations>.dc-btn { justify-self:start;min-height:38px;padding:0 18px;margin-top:4px; }
body.dc-app .dc-channel-destinations .dc-switch-row { border-radius:14px; }
body.dc-app .dc-channel-destinations .dc-tiktok-controls { display:grid;gap:9px;padding:13px;border:1px solid rgba(255,255,255,.06);border-radius:15px;background:rgba(0,0,0,.20); }
body.dc-app .dc-channel-destinations .dc-tiktok-controls>label:first-child { display:grid;gap:6px;color:var(--v6-muted);font-size:9px; }
body.dc-app .dc-channel-destinations .dc-tiktok-controls select { height:38px;padding:0 10px;border:1px solid rgba(255,255,255,.09);border-radius:11px;background:#09090b;color:var(--v6-text);font-size:10px; }
body.dc-app .dc-tiktok-review-note { margin:2px 0 0;color:var(--v6-muted);font-size:8.5px;line-height:1.5; }
@media (max-width:760px) { body.dc-app .dc-channel-grid { grid-template-columns:1fr;padding:14px; } body.dc-app .dc-channel-destinations { padding:14px; } }

"""

css_text = CSS.read_text()
if "body.dc-app .dc-channel-grid" in css_text:
    skipped.append("CSS: Channels styles (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: Channels styles")
else:
    sys.exit("CSS anchor comment not found in studio-v6.css. Nothing written.")


# Guard: the control IDs savePublishingRules() reads must all survive.
js = JS.read_text()
for control in ("dcPub_", "dcTikTokPrivacy", "dcTikTokComments", "dcTikTokDuet", "dcTikTokStitch", "dcSavePublishing"):
    if control not in js:
        sys.exit(f"Control id '{control}' disappeared — savePublishingRules() would silently stop saving.")
for hook in ("data-social-connect", "data-social-test", "data-social-disconnect"):
    if hook not in js:
        sys.exit(f"Click hook '{hook}' disappeared — the connect flow would break.")

names = re.findall(r"^function ([A-Za-z0-9_]+)", js, re.M)
dupes = sorted({n for n in names if names.count(n) > 1})
if dupes:
    sys.exit(f"Duplicate top-level function declarations: {', '.join(dupes)}")

print("patch20 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nControl ids and click hooks verified present. No duplicate declarations.")
print("\nNext:\n  npm run check && npm test\n")
