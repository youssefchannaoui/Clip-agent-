#!/usr/bin/env python3
"""
Out-of-tokens / trial-expired upsell modal.

patch7 made assertCanSpend throw BillingError with a `code`. That code was
being thrown away: server.js serialises errors as `{ error: error.message }`,
so the browser only ever saw a sentence, and the dashboard dropped it into a
3-second toast. A creator who runs dry mid-import gets a grey toast that
vanishes before they've read it, and no route to fixing it.

WHAT CHANGES
------------
1. server.js gains errorBody(), which carries `code` and the token numbers
   through to the client. All 40 `{ error: error.message }` sites use it.
   Errors without a code serialise exactly as before.

2. index.html's api() wrapper attaches code/needed/remaining/shortfall to the
   Error it throws, so existing call sites keep working unchanged.

3. A modal is shown centrally from api() whenever a refusal carries a billing
   code — one hook rather than editing every call site:
     - free_expired        -> "your 3 days are up", route to plans
     - insufficient_tokens -> shows the shortfall, offers upgrade or top-up

   The modal is driven by the server's refusal, never by a client-side balance
   guess, so it cannot desync from what the server will actually allow.

Run from your repo root:

    python3 patch8/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
if not (ROOT / "src" / "server.js").exists():
    sys.exit("Can't find src/server.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(relpath, old, new, label, count=1):
    path = ROOT / relpath
    text = path.read_text()
    # Deciding "already applied" is fiddlier than it looks.
    #   - `new in text` alone false-positives when `new` is a substring of
    #     something inserted earlier in this same run (skips a real edit).
    #   - `old not in text` alone false-negatives whenever `new` contains `old`,
    #     which is the common "keep the line, append below it" shape (applies twice).
    # So: count anchors that survive with every copy of `new` removed.
    found = text.replace(new, "").count(old)
    if found == 0 and new in text:
        skipped.append(f"{label} (already applied)")
        return
    if found == 0:
        sys.exit(
            f"ANCHOR NOT FOUND for '{label}' in {relpath}.\n"
            f"Expected:\n{old}\n\nNothing written."
        )
    if count == 1 and found != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({found}x) for '{label}' in {relpath}. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(f"{label} ({found}x)" if count != 1 else label)


# ---------------------------------------------------------------- server.js

edit(
    "src/server.js",
    "function json(res, status, value) {",
    "// BillingError and friends carry a machine-readable `code` plus the token\n"
    "// numbers. Without this the client only sees a sentence and cannot tell an\n"
    "// out-of-tokens refusal apart from any other 400.\n"
    "function errorBody(error) {\n"
    "  const body = { error: error?.message || 'Something went wrong.' };\n"
    "  if (!error?.code) return body;\n"
    "  body.code = error.code;\n"
    "  for (const key of ['needed', 'remaining', 'shortfall', 'plan', 'expiredAt']) {\n"
    "    if (error[key] !== undefined) body[key] = error[key];\n"
    "  }\n"
    "  return body;\n"
    "}\n"
    "\n"
    "function json(res, status, value) {",
    "errorBody() helper",
)

edit(
    "src/server.js",
    "{ error: error.message }",
    "errorBody(error)",
    "propagate error codes through JSON responses",
    count=40,
)

edit(
    "src/server.js",
    "route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, { error: error.message || 'Unexpected server error.' }); });",
    "route(req, res, url).catch(error => { console.error(error); if (!res.headersSent) json(res, 500, errorBody(error)); });",
    "top-level handler carries codes too",
)


# --------------------------------------------------------------- index.html

edit(
    "src/public/index.html",
    "    if(!r.ok)throw new Error(b.error||`Request failed (${r.status})`);",
    "    if(!r.ok){const err=new Error(b.error||`Request failed (${r.status})`);\n"
    "      if(b.code){err.code=b.code;for(const k of ['needed','remaining','shortfall','plan','expiredAt'])if(b[k]!==undefined)err[k]=b[k];\n"
    "        showBillingBlock(err);}\n"
    "      throw err;}",
    "api(): attach codes and raise the modal",
)

edit(
    "src/public/index.html",
    "function toast(message,type=''){const box=$('#toasts');if(!box)return;const n=document.createElement('div');n.className=`toast ${type}`;n.textContent=message;box.append(n);setTimeout(()=>n.remove(),3600)}",
    "function toast(message,type=''){const box=$('#toasts');if(!box)return;const n=document.createElement('div');n.className=`toast ${type}`;n.textContent=message;box.append(n);setTimeout(()=>n.remove(),3600)}\n"
    "// A toast is the wrong shape for \"you cannot continue until you pay\": it\n"
    "// disappears in 3.6s and offers nowhere to go. These two refusals get a\n"
    "// modal with the actual next step instead.\n"
    "const BILLING_BLOCKS={\n"
    "  free_expired:{\n"
    "    title:'Your free trial has ended',\n"
    "    body:()=>'The free tier runs for a few days so you can try the studio. Choose a plan to keep generating clips — everything you have already made stays where it is.',\n"
    "    primary:{label:'See plans',href:'/plans'},\n"
    "    secondary:null,\n"
    "  },\n"
    "  insufficient_tokens:{\n"
    "    title:'Not enough tokens',\n"
    "    body:e=>{\n"
    "      const short=Number(e.shortfall||0),need=Number(e.needed||0),have=Number(e.remaining||0);\n"
    "      if(short>0)return `This needs about ${need} tokens and you have ${have}. You are ${short} short.`;\n"
    "      return 'You do not have enough tokens left for this job.';\n"
    "    },\n"
    "    primary:{label:'Upgrade plan',href:'/plans'},\n"
    "    secondary:{label:'Buy a token pack',href:'/plans#token-shop'},\n"
    "  },\n"
    "};\n"
    "let BILLING_MODAL=null;\n"
    "function showBillingBlock(error){\n"
    "  const spec=BILLING_BLOCKS[error&&error.code];\n"
    "  if(!spec)return false;\n"
    "  if(BILLING_MODAL)BILLING_MODAL.remove();\n"
    "  const wrap=document.createElement('div');\n"
    "  wrap.className='billing-block';\n"
    "  wrap.setAttribute('role','dialog');\n"
    "  wrap.setAttribute('aria-modal','true');\n"
    "  const card=document.createElement('div');\n"
    "  card.className='billing-block-card';\n"
    "  const h=document.createElement('h3');h.textContent=spec.title;\n"
    "  const p=document.createElement('p');p.textContent=spec.body(error||{});\n"
    "  const row=document.createElement('div');row.className='billing-block-row';\n"
    "  const primary=document.createElement('a');\n"
    "  primary.className='billing-block-primary';\n"
    "  primary.href=spec.primary.href;primary.textContent=spec.primary.label;\n"
    "  row.append(primary);\n"
    "  if(spec.secondary){\n"
    "    const secondary=document.createElement('a');\n"
    "    secondary.className='billing-block-secondary';\n"
    "    secondary.href=spec.secondary.href;secondary.textContent=spec.secondary.label;\n"
    "    row.append(secondary);\n"
    "  }\n"
    "  const close=document.createElement('button');\n"
    "  close.type='button';close.className='billing-block-close';\n"
    "  close.setAttribute('aria-label','Close');close.textContent='\\u00d7';\n"
    "  const dismiss=()=>{wrap.remove();if(BILLING_MODAL===wrap)BILLING_MODAL=null;};\n"
    "  close.addEventListener('click',dismiss);\n"
    "  wrap.addEventListener('click',event=>{if(event.target===wrap)dismiss();});\n"
    "  document.addEventListener('keydown',function onKey(event){\n"
    "    if(event.key!=='Escape')return;\n"
    "    dismiss();document.removeEventListener('keydown',onKey);\n"
    "  });\n"
    "  card.append(close,h,p,row);\n"
    "  wrap.append(card);\n"
    "  document.body.append(wrap);\n"
    "  BILLING_MODAL=wrap;\n"
    "  primary.focus();\n"
    "  return true;\n"
    "}",
    "showBillingBlock() modal",
)

edit(
    "src/public/index.html",
    '<div class="toasts" id="toasts"></div>',
    '<div class="toasts" id="toasts"></div>\n'
    "<style>\n"
    ".billing-block{position:fixed;inset:0;z-index:9000;display:grid;place-items:center;padding:20px;background:rgba(4,4,6,.72);backdrop-filter:blur(6px)}\n"
    ".billing-block-card{position:relative;width:min(430px,100%);padding:26px;border-radius:22px;border:1px solid rgba(228,188,113,.34);background:linear-gradient(170deg,#17171b,#0b0b0d);box-shadow:0 30px 90px rgba(0,0,0,.55);color:#faf8f3}\n"
    ".billing-block-card h3{margin:0 0 10px;font-size:21px;letter-spacing:-.03em}\n"
    ".billing-block-card p{margin:0 0 20px;font-size:13.5px;line-height:1.6;color:#aaa6a0}\n"
    ".billing-block-row{display:flex;flex-wrap:wrap;gap:9px}\n"
    ".billing-block-row a{flex:1 1 150px;min-height:44px;display:inline-flex;align-items:center;justify-content:center;border-radius:12px;font-size:13px;font-weight:850;text-decoration:none}\n"
    ".billing-block-primary{background:linear-gradient(135deg,#f2d696,#e4bc71);color:#171108}\n"
    ".billing-block-secondary{border:1px solid rgba(255,255,255,.14);color:#faf8f3}\n"
    ".billing-block-close{position:absolute;top:12px;right:12px;width:30px;height:30px;border:0;border-radius:9px;background:transparent;color:#aaa6a0;font-size:19px;line-height:1;cursor:pointer}\n"
    ".billing-block-close:hover{background:rgba(255,255,255,.07);color:#faf8f3}\n"
    "</style>",
    "modal styles",
)


print("patch8 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
if not changed:
    print("  (nothing to do — patch was already applied)")
print(
    "\nNext:\n"
    "  node --check src/server.js\n"
    "  npm test\n"
    "  node scripts/check-ui.mjs\n"
)
