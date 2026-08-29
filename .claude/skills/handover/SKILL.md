---
name: handover
description: Produce the exact current handover for DeenClipped — where the code is, what is actually live, what is green, what is blocked and on whom, and the single next action. Use whenever the user says "hand over", "handover", "give me the handover", "where are we", "catch me up", or "brief the next chat", and at the end of a session before the context runs out.
---

# Handover

Sessions do not share memory. This one cannot read any other chat, and no other
chat can read this one. **The repository is the only thing that syncs** — git
plus `CLAUDE.md`. So a handover is not a recollection, it is a *measurement*
taken now, from the repo and the live services.

Never write a handover from memory. Every line below is something you go and
check. If a check cannot be run, say so in the handover rather than omitting it
— a gap stated is useful, a gap hidden is how the box sat on old code for weeks.

## Measure first

Run these before writing anything. They are cheap.

```bash
git fetch origin 2>/dev/null
git log --oneline -5                                   # what this session did
git status --short                                     # anything uncommitted
git log --oneline HEAD..origin/deenclipped-v2-2        # anything I have not pulled
git log --oneline origin/deenclipped-v2-2..HEAD        # anything I have not pushed
git ls-remote --heads origin                           # other branches, possibly unmerged
node -p "require('./package.json').version"            # the release this code is
git log --oneline 72fea1a..HEAD -- worker/             # worker commits, for the box check
```

Then, as far as this session can reach:

- **Tests** — `npm test` and `npm run check`. Report the real numbers, and say
  whether you ran them this session or are quoting `CLAUDE.md`. Never present a
  remembered count as a fresh one.
- **CI** — the latest `Launch checks` run on `deenclipped-v2-2`. Red branch is
  the first thing the next session needs to know.
- **The web app** — Render deploys `deenclipped-v2-2` automatically. Check the
  newest deploy is `live` and name the commit it carries.
- **The worker box** — this is the one that has been wrong twice. A push does
  NOT deploy it. Say which commit the box is on if you can establish it
  (Owner → Health → Deployed, or a successful `deploy-worker.yml` run), and if
  you cannot, say plainly that it is unknown and therefore assumed behind.

## Then write it

Keep to the shape Youssef asked for: **Current Goal, Blockers, Next Immediate
Action**, at most ten bullets, under 150 lines. Overwrite — never append a log
of past sessions; `CLAUDE.md` already holds the durable history.

```
## Current goal
One sentence. What is being worked on right now, not the whole project.

## State
- Branch / HEAD / version, and whether anything is uncommitted or unpushed.
- Tests: N JS + N Python, green or not, run when.
- Web app: live on <commit>, or not.
- Worker box: on <commit>, or UNKNOWN AND ASSUMED BEHIND.
- Any other branch carrying unmerged work.

## Blockers
- Each one with WHO it is on. "Waiting on Youssef" and "waiting on code" are
  different and must not be blurred. If it needs a credential, a dashboard, a
  platform review or a machine this session cannot reach, say exactly that.

## Next immediate action
One thing. The thing the next session should do first.
```

## Rules the handover must respect

- **Say what is NOT done.** A handover that only lists wins is worse than none.
  If something shipped but is unverified — no screenshot, no rendered frame, no
  deploy — that is part of the state, not a footnote.
- **A green suite is not verification for anything visual**, and a push is not a
  worker deploy. Do not let either imply the other.
- **Name the blocked party.** Most stalled items here are waiting on a person,
  not on code.
- **Never put a credential in the handover** — not a key, not a password, not a
  webhook secret. Name where it lives instead.
- **Check for a second session** before claiming the branch is settled. Another
  chat may hold unpushed work; `git ls-remote` and the unmerged-branch check
  above are how you find it.

## Making it stick

Anything the next session must know in a week does not belong in a chat
message — it belongs in `CLAUDE.md`, committed. If the handover surfaces a fact
with that shelf life (a new invariant, a trap that cost real time, a changed
deploy path), add it there in the same breath and say you did.
