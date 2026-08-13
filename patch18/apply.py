#!/usr/bin/env python3
"""
Rebuild AI Director as a grounded chat assistant.

THE COMPLAINT
-------------
"ai detector makes zero sense i want a redo and easy to read and use a ai
chat box maybe for like posting ideas and etc"

The old page was five analytics panels stacked together — a weekly lineup,
a topic cloud, a content-gaps list, a hook-intelligence list and an
explainable-intelligence grid with eight score bars. All of it was real
data, none of it answered a question you'd actually ask. You had to read
the whole page and work out the implication yourself.

WHY THIS NEEDS NO LLM CALL
---------------------------
Worker intelligence (worker/intelligence.py) already computes, per clip,
from the actual transcript: primaryTitle, alternateTitles, searchTerms,
pinnedComment, callToAction, per-platform captions, and a directorBrief
with hookPreview, payoffPreview, bestPlatforms, platformFit and `why`.
The server ships all of it to the client on every clip (publicClip in
src/server.js). So the assistant answers from data that is already on the
page.

That matters for more than convenience:
  - It cannot hallucinate. Every title, caption and hook it returns was
    derived from words the speaker actually said — which is the whole point
    for Islamic lecture content, where inventing a quotation is the worst
    possible failure.
  - It works with no OLLAMA_URL reachable from Render, no API key, no
    per-message cost, and no network round-trip.
  - It stays honest: when a clip predates the growth pack, the assistant
    says so and points at re-processing rather than improvising.

WHAT IT ANSWERS
---------------
what to post next · captions · alternate titles · hashtags and search terms
· the hook and payoff · which platform fits · why a clip scores well ·
which topics the library is missing. Anything else gets a plain "I can't
answer that from your clips" plus what it can do — it never bluffs.

DESIGN
------
Settings visual language, same as Quality Center: `.dc-settings-command`
hero and `.dc-settings-section` panels, so all three screens share one
system. Chat replies can include clip cards with real thumbnails and
one-tap copy buttons for any generated copy.

Run from your repo root:

    python3 patch18/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
JS = ROOT / "src/public/activity-fix.js"
CSS = ROOT / "src/public/studio-v6.css"
if not JS.exists():
    sys.exit("Can't find src/public/activity-fix.js — run this from your repo root, not ~.")

changed = []
skipped = []

# --------------------------------------------------------------- JS rewrite

NEW_FN = r"""const DIRECTOR_CHIPS=[
  ['What should I post next?','next'],
  ['Write captions for this clip','caption'],
  ['Give me another title','title'],
  ['Which platform fits best?','platform'],
  ['What topics am I missing?','ideas'],
];
const directorChat={messages:[],draft:'',focusId:''};
function directorRanked(){return [...(data()?.clips||[])].sort((a,b)=>Number(b.score||0)-Number(a.score||0))}
function directorFocus(){const clips=directorRanked();return clips.find(c=>c.id===directorChat.focusId)||clips[0]||null}
function directorSay(role,parts){directorChat.messages.push({role,parts:Array.isArray(parts)?parts:[{type:'text',value:String(parts)}]})}
function directorMissingPack(clip){
  return [{type:'text',value:`"${shortText(clip.title||'This clip',60)}" was processed before DeenClipped started generating post copy, so I have no grounded titles or captions for it. Re-process that lecture and I'll have them.`}];
}
function directorAnswer(question){
  const text=String(question||'').toLowerCase().trim();
  const clips=directorRanked(),clip=directorFocus();
  const has=(...words)=>words.some(word=>text.includes(word));
  if(!clips.length)return [{type:'text',value:'You have no clips yet. Generate some from a lecture and I can suggest what to post, write captions and pick platforms.'}];

  if(has('next','lineup','week','schedule','order','first'))
    {const queue=clips.filter(c=>c.status!=='posted').slice(0,7);
     return queue.length?[{type:'text',value:`Post these in this order — ranked by how well each one holds attention.`},{type:'clips',ids:queue.map(c=>c.id)}]:[{type:'text',value:'Every clip you have is already posted. Generate more from a new lecture.'}];}

  if(!clip)return [{type:'text',value:'Pick a clip first and I can work on it.'}];
  const pack=clip.growthPack||{},brief=pack.directorBrief||{},platforms=pack.platforms||{};

  if(has('caption','description','write','copy','post text')){
    if(!platforms.tiktok&&!platforms.youtube)return directorMissingPack(clip);
    const parts=[{type:'text',value:`Grounded captions for "${shortText(clip.title||'this clip',52)}" — every line comes from the transcript.`}];
    if(platforms.youtube?.title)parts.push({type:'copy',label:'YouTube title',value:platforms.youtube.title});
    if(platforms.youtube?.description)parts.push({type:'copy',label:'YouTube description',value:platforms.youtube.description});
    if(platforms.tiktok?.caption)parts.push({type:'copy',label:'TikTok caption',value:platforms.tiktok.caption});
    if(platforms.instagram?.caption)parts.push({type:'copy',label:'Instagram caption',value:platforms.instagram.caption});
    return parts;
  }

  if(has('title','headline','name it','rename')){
    const titles=[pack.primaryTitle,...(pack.alternateTitles||[])].filter(Boolean);
    if(!titles.length)return directorMissingPack(clip);
    return [{type:'text',value:'Every one of these is drawn from what the speaker actually said:'},...titles.map((value,index)=>({type:'copy',label:index?`Alternative ${index}`:'Suggested title',value}))];
  }

  if(has('hashtag','tag','search','seo','discover')){
    const terms=pack.searchTerms||[];const tags=String(clip.hashtags||'').trim();
    if(!terms.length&&!tags)return directorMissingPack(clip);
    const parts=[{type:'text',value:'Tags and search terms taken from the topic of this clip:'}];
    if(tags)parts.push({type:'copy',label:'Hashtags',value:tags});
    if(terms.length)parts.push({type:'copy',label:'Search terms',value:terms.join(', ')});
    return parts;
  }

  if(has('hook','opening','first three','first 3','start','payoff','ending')){
    if(!brief.hookPreview&&!brief.payoffPreview)return directorMissingPack(clip);
    const parts=[];
    if(brief.hookPreview)parts.push({type:'text',value:`Opening line: "${brief.hookPreview}"`});
    if(brief.payoffPreview)parts.push({type:'text',value:`Closing payoff: "${brief.payoffPreview}"`});
    parts.push({type:'text',value:'If the opening does not stand alone without context, trim the clip so it starts later.'});
    return parts;
  }

  if(has('platform','where','youtube','tiktok','instagram','facebook','best fit')){
    const fit=brief.platformFit||{};const best=brief.bestPlatforms||[];
    if(!best.length)return directorMissingPack(clip);
    const names={youtube:'YouTube Shorts',tiktok:'TikTok',instagram:'Instagram Reels',facebook:'Facebook Reels'};
    const ordered=Object.entries(fit).sort((a,b)=>b[1]-a[1]).map(([key,value])=>`${names[key]||key} ${Math.round(value)}`).join(' · ');
    return [{type:'text',value:`Best fit: ${best.map(name=>names[name]||name).join(' and ')}.`},{type:'text',value:`Scored across all four: ${ordered}.`}];
  }

  if(has('why','score','strong','good','work','retention')){
    const reasons=[...(brief.why||[]),...(clip.scoreReasons||[])].filter(Boolean).slice(0,4);
    const parts=[{type:'text',value:`"${shortText(clip.title||'This clip',52)}" scores ${Math.round(clip.score||0)} out of 100.${brief.forecast?` Retention forecast: ${brief.forecast}.`:''}`}];
    if(reasons.length)parts.push({type:'text',value:reasons.join(' · ')});
    if(clip.scoreBreakdown||clip.quality?.scoreBreakdown)parts.push({type:'dimensions',id:clip.id});
    return parts;
  }

  if(has('idea','topic','gap','cover','missing','content')){
    const counts=new Map();clips.forEach(c=>{const topic=labTopic(c);counts.set(topic,(counts.get(topic)||0)+1)});
    const gaps=LAB_TOPICS.map(([name])=>name).filter(name=>!counts.has(name));
    const covered=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,3).map(([name,count])=>`${name} (${count})`).join(', ');
    const parts=[{type:'text',value:covered?`You post most about ${covered}.`:'Your clips do not group into a clear topic yet.'}];
    parts.push({type:'text',value:gaps.length?`Nothing in your library covers ${gaps.slice(0,4).join(', ')} — lectures on those would widen your reach.`:'Your main topics are all represented, so keep going deeper rather than wider.'});
    return parts;
  }

  return [
    {type:'text',value:"I can only answer from the clips you've generated, and that one is outside what I can see."},
    {type:'text',value:'Ask me what to post next, for captions, titles, hashtags, the hook, which platform fits, why a clip scores well, or which topics you are missing.'},
  ];
}
function directorAsk(question){
  const clean=String(question||'').trim();if(!clean)return;
  directorSay('user',[{type:'text',value:clean}]);
  directorSay('director',directorAnswer(clean));
  directorChat.draft='';
  renderCreatorLab();
  const thread=$('#dcDirectorThread');if(thread)thread.scrollTop=thread.scrollHeight;
  $('#dcDirectorInput')?.focus();
}
function directorPartHtml(part,messageIndex,partIndex){
  if(part.type==='copy')return `<div class="dc-director-copy"><div><small>${esc(part.label)}</small><p>${esc(part.value)}</p></div><button class="dc-btn secondary" data-director-copy="${messageIndex}:${partIndex}">Copy</button></div>`;
  if(part.type==='clips'){
    const clips=data()?.clips||[];
    return `<div class="dc-director-clips">${part.ids.map((id,order)=>{const clip=clips.find(c=>c.id===id);if(!clip)return '';return `<button data-edit-video-clip="${esc(clip.id)}"><i>${order+1}</i><span class="dc-director-thumb">${clip.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="">`:ICON.play}</span><b>${esc(shortText(clip.title||'Untitled clip',54))}</b><em>${Math.round(clip.score||0)}</em></button>`}).join('')}</div>`;
  }
  if(part.type==='dimensions'){
    const clip=(data()?.clips||[]).find(c=>c.id===part.id);
    return clip?`<div class="dc-lab-dimensions">${labDimensionRows(clip)}</div>`:'';
  }
  return `<p>${esc(part.value)}</p>`;
}
function renderCreatorLab(){
  const panel=$('#view-lab'),d=data();if(!panel||!d)return;
  const clips=d.clips||[],premium=Boolean(d.billing?.features?.creatorLab||d.billing?.current?.unlimited);
  const ranked=directorRanked(),avg=Math.round(ranked.reduce((sum,c)=>sum+Number(c.score||0),0)/Math.max(1,ranked.length));
  const ready=clips.filter(c=>c.musicVerified&&c.renderVerified).length,waiting=clips.filter(c=>c.status==='waiting').length;
  const focus=directorFocus();
  const hero=`<section class="dc-settings-command"><div><span class="dc-settings-kicker">${ICON.lab} AI Director <b class="dc-inline-pro">PRO</b></span><h1>Ask what to post next.</h1><p>Answers come from what the speaker actually said in your lectures — never invented.</p></div><div class="dc-settings-command-status"><span class="${clips.length?'on':''}"><i>${ICON.lab}</i><b>${clips.length} analysed</b><em>clips</em></span><span class="${avg>=72?'on':''}"><i>${ICON.sparkles}</i><b>${avg} average</b><em>quality score</em></span><span class="${ready?'on':''}"><i>${ICON.check}</i><b>${ready} ready</b><em>export verified</em></span></div></section>`;

  if(!premium){
    panel.innerHTML=`<div class="dc-settings-hub dc-director-page">${hero}<section class="dc-lab-locked"><div class="dc-lab-lock-icon">${ICON.lab}</div><span>Premium intelligence</span><h2>Ask your library what to post next.</h2><p>AI Director answers in plain language using the titles, hooks and captions DeenClipped already generated from your transcripts.</p><div class="dc-lab-teasers">${DIRECTOR_CHIPS.map(([label])=>`<span>${esc(label)}</span>`).join('')}</div><button class="dc-btn" id="dcLabUpgrade">Unlock AI Director</button></section></div>`;
    if($('#dcLabUpgrade'))$('#dcLabUpgrade').onclick=openBillingModal;
    requestAnimationFrame(()=>animatePanel(panel));
    return;
  }

  const thread=directorChat.messages.length
    ?directorChat.messages.map((message,messageIndex)=>`<div class="dc-director-msg ${message.role}">${message.parts.map((part,partIndex)=>directorPartHtml(part,messageIndex,partIndex)).join('')}</div>`).join('')
    :`<div class="dc-director-welcome"><span>${ICON.sparkles}</span><strong>Ask me anything about your clips.</strong><p>I read the transcripts DeenClipped already analysed, so nothing I suggest is made up.</p></div>`;
  const focusCard=focus?`<div class="dc-director-focus"><span class="dc-director-thumb">${focus.thumbUrl?`<img src="${authedUrl(focus.thumbUrl)}" alt="">`:ICON.play}</span><div><small>Working on</small><select id="dcDirectorFocus">${ranked.map(c=>`<option value="${esc(c.id)}" ${c.id===focus.id?'selected':''}>${esc(shortText(c.title||'Untitled clip',48))}</option>`).join('')}</select></div></div>`:'';

  panel.innerHTML=`<div class="dc-settings-hub dc-director-page">${hero}
    <section class="dc-settings-section violet"><header><span>${ICON.sparkles}</span><div><small>Assistant</small><h2>Ask about your clips</h2></div><b>Grounded in your transcripts</b></header>
      <div class="dc-director-body">${focusCard}<div class="dc-director-thread" id="dcDirectorThread">${thread}</div>
        <div class="dc-director-chips">${DIRECTOR_CHIPS.map(([label])=>`<button data-director-chip="${esc(label)}">${esc(label)}</button>`).join('')}</div>
        <form class="dc-director-composer" id="dcDirectorForm"><input id="dcDirectorInput" placeholder="Ask about a clip, a caption, or what to post next" autocomplete="off" value="${esc(directorChat.draft)}"><button class="dc-btn" type="submit">Ask</button></form>
      </div></section>
    <section class="dc-settings-section"><header><span>${ICON.publish}</span><div><small>Queue</small><h2>Post these next</h2></div><b>${Math.min(7,ranked.filter(c=>c.status!=='posted').length)} clips</b></header>
      <div class="dc-director-lineup">${ranked.filter(c=>c.status!=='posted').slice(0,7).map((clip,index)=>`<button data-edit-video-clip="${esc(clip.id)}"><i>${index+1}</i><span class="dc-director-thumb">${clip.thumbUrl?`<img src="${authedUrl(clip.thumbUrl)}" alt="">`:ICON.play}</span><div><strong>${esc(shortText(clip.title||'Untitled clip',56))}</strong><small>${esc(labTopic(clip))} · ${esc(statusName(clip.status))}</small></div><em>${Math.round(clip.score||0)}</em></button>`).join('')||'<div class="dc-qc-empty">Everything is posted. Generate clips from a new lecture.</div>'}</div></section>
  </div>`;

  $('#dcDirectorForm')?.addEventListener('submit',event=>{event.preventDefault();directorAsk($('#dcDirectorInput')?.value)});
  $('#dcDirectorInput')?.addEventListener('input',event=>{directorChat.draft=event.target.value});
  $('#dcDirectorFocus')?.addEventListener('change',event=>{directorChat.focusId=event.target.value;renderCreatorLab()});
  $$('[data-director-chip]',panel).forEach(button=>button.addEventListener('click',()=>directorAsk(button.dataset.directorChip)));
  $$('[data-director-copy]',panel).forEach(button=>button.addEventListener('click',async()=>{
    const [messageIndex,partIndex]=button.dataset.directorCopy.split(':').map(Number);
    const value=directorChat.messages[messageIndex]?.parts[partIndex]?.value||'';
    try{await navigator.clipboard.writeText(value);notify('Copied')}catch{notify('Copy was blocked by the browser','bad')}
  }));
  const threadEl=$('#dcDirectorThread');if(threadEl)threadEl.scrollTop=threadEl.scrollHeight;
  requestAnimationFrame(()=>animatePanel(panel));
}
"""

text = JS.read_text()
START = "function renderCreatorLab(){"
# Order matters: the replacement re-declares renderCreatorLab(), so checking
# for that name first would happily re-slice and duplicate the whole block on
# a second run. The rewrite is identified by a symbol only it introduces.
if "function directorAnswer(question){" in text:
    skipped.append("renderCreatorLab(): grounded chat assistant (already applied)")
elif START in text:
    start = text.index(START)
    end = text.index("\n}\n", start) + 3
    old = text[start:end]
    if "animatePanel(panel)" not in old:
        sys.exit("Sliced renderCreatorLab() does not look like the whole function. Nothing written.")
    JS.write_text(text[:start] + NEW_FN + text[end:])
    changed.append("renderCreatorLab(): rebuilt as a grounded chat assistant")
else:
    sys.exit("Could not find renderCreatorLab(). Nothing written.")


# --------------------------------------------------------------------- CSS

CSS_ANCHOR = "/* Consistent screen language across the existing, already-functional views. */"
CSS_BLOCK = """/* AI Director — chat surface. Reuses the Settings section shell; only the
 * thread, chips and composer are new. */
body.dc-app .dc-director-page { display:grid;gap:16px; }
body.dc-app .dc-director-body { display:grid;gap:12px;padding:18px 20px; }
body.dc-app .dc-director-focus { display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.065);border-radius:14px;background:rgba(2,2,4,.23); }
body.dc-app .dc-director-focus small { display:block;color:var(--v6-muted);font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase; }
body.dc-app .dc-director-focus select { width:100%;margin-top:5px;height:34px;padding:0 9px;border:1px solid rgba(255,255,255,.09);border-radius:10px;background:#09090b;color:var(--v6-text);font-size:10px; }
body.dc-app .dc-director-thumb { display:grid;place-items:center;overflow:hidden;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:#060607;color:var(--v6-muted); }
body.dc-app .dc-director-thumb img { width:100%;height:100%;object-fit:cover; }
body.dc-app .dc-director-thumb svg { width:16px;height:16px;fill:none;stroke:currentColor;opacity:.55; }
body.dc-app .dc-director-focus>.dc-director-thumb { width:64px;height:44px; }
body.dc-app .dc-director-thread { display:grid;gap:10px;max-height:440px;overflow-y:auto;padding:4px; }
body.dc-app .dc-director-msg { display:grid;gap:8px;max-width:86%;padding:12px 14px;border-radius:15px;font-size:11px;line-height:1.6; }
body.dc-app .dc-director-msg p { margin:0; }
body.dc-app .dc-director-msg.user { justify-self:end;background:rgba(181,144,255,.13);border:1px solid rgba(181,144,255,.20); }
body.dc-app .dc-director-msg.director { justify-self:start;background:rgba(2,2,4,.30);border:1px solid rgba(255,255,255,.07); }
body.dc-app .dc-director-welcome { display:grid;place-items:center;text-align:center;padding:30px 20px;border:1px dashed rgba(255,255,255,.08);border-radius:16px; }
body.dc-app .dc-director-welcome>span { width:42px;height:42px;display:grid;place-items:center;margin-bottom:11px;border-radius:13px;background:rgba(181,144,255,.10);color:#c8acff; }
body.dc-app .dc-director-welcome svg { width:20px;height:20px;fill:none;stroke:currentColor; }
body.dc-app .dc-director-welcome strong { font-size:13px; }
body.dc-app .dc-director-welcome p { margin:5px 0 0;color:var(--v6-muted);font-size:10px;max-width:380px;line-height:1.55; }
body.dc-app .dc-director-copy { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px;border:1px solid rgba(255,255,255,.07);border-radius:12px;background:rgba(0,0,0,.26); }
body.dc-app .dc-director-copy small { color:#c8acff;font-size:8px;font-weight:900;letter-spacing:.1em;text-transform:uppercase; }
body.dc-app .dc-director-copy p { margin:5px 0 0;font-size:10px;line-height:1.55;white-space:pre-wrap; }
body.dc-app .dc-director-copy .dc-btn { min-height:30px;padding:0 11px;font-size:8px; }
body.dc-app .dc-director-clips,body.dc-app .dc-director-lineup { display:grid;gap:8px; }
body.dc-app .dc-director-lineup { padding:18px 20px; }
body.dc-app .dc-director-clips>button,body.dc-app .dc-director-lineup>button {
  display:grid;grid-template-columns:26px 74px minmax(0,1fr) auto;gap:11px;align-items:center;width:100%;
  padding:9px;border:1px solid rgba(255,255,255,.065);border-radius:13px;background:rgba(2,2,4,.23);
  color:var(--v6-text);text-align:left;transition:transform .18s ease,border-color .18s ease;
}
body.dc-app .dc-director-clips>button:hover,body.dc-app .dc-director-lineup>button:hover { transform:translateY(-2px);border-color:rgba(181,144,255,.32); }
body.dc-app .dc-director-clips>button>i,body.dc-app .dc-director-lineup>button>i { width:26px;height:26px;display:grid;place-items:center;border-radius:9px;background:rgba(181,144,255,.10);color:#c8acff;font-size:9px;font-style:normal;font-weight:900; }
body.dc-app .dc-director-clips .dc-director-thumb,body.dc-app .dc-director-lineup .dc-director-thumb { width:74px;height:46px; }
body.dc-app .dc-director-clips>button>b { font-size:10.5px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-director-lineup strong { display:block;font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
body.dc-app .dc-director-lineup small { display:block;margin-top:3px;color:var(--v6-muted);font-size:8px; }
body.dc-app .dc-director-clips>button>em,body.dc-app .dc-director-lineup>button>em { font-style:normal;font-size:11px;font-weight:900;color:#c8acff; }
body.dc-app .dc-director-chips { display:flex;gap:7px;flex-wrap:wrap; }
body.dc-app .dc-director-chips>button { padding:8px 11px;border:1px solid rgba(181,144,255,.16);border-radius:999px;background:rgba(181,144,255,.06);color:#c9b0f8;font-size:9px;transition:.16s; }
body.dc-app .dc-director-chips>button:hover { border-color:rgba(181,144,255,.38);background:rgba(181,144,255,.12); }
body.dc-app .dc-director-composer { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px; }
body.dc-app .dc-director-composer input { height:44px;padding:0 14px;border:1px solid rgba(255,255,255,.09);border-radius:13px;background:#09090b;color:var(--v6-text);font-size:11px;outline:0; }
body.dc-app .dc-director-composer input:focus { border-color:rgba(181,144,255,.45);box-shadow:0 0 0 3px rgba(181,144,255,.10); }
body.dc-app .dc-director-composer .dc-btn { min-height:44px;padding:0 20px; }
@media (max-width:760px) {
  body.dc-app .dc-director-msg { max-width:100%; }
  body.dc-app .dc-director-clips>button,body.dc-app .dc-director-lineup>button { grid-template-columns:24px 60px minmax(0,1fr) auto;gap:9px; }
  body.dc-app .dc-director-clips .dc-director-thumb,body.dc-app .dc-director-lineup .dc-director-thumb { width:60px;height:38px; }
}

"""

css_text = CSS.read_text()
if "body.dc-app .dc-director-thread" in css_text:
    skipped.append("CSS: AI Director chat styles (already applied)")
elif CSS_ANCHOR in css_text:
    CSS.write_text(css_text.replace(CSS_ANCHOR, CSS_BLOCK + CSS_ANCHOR, 1))
    changed.append("CSS: AI Director chat styles")
else:
    sys.exit("CSS anchor comment not found in studio-v6.css. Nothing written.")

print("patch18 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print("\nNext:\n  npm run check && npm test\n")
