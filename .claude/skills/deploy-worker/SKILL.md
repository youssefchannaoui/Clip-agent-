---
name: deploy-worker
description: Deploy the worker to the Hetzner box and PROVE it landed. Use when the user says "deploy the worker", "deploy the box", "push to hetzner", "make it live", or whenever a handover or Owner → Health shows the box running an older version than package.json. Pushing to GitHub does NOT deploy the worker; only this does.
---

# Deploy the worker

Render takes the web app on every push to `deenclipped-v2-2`. **Nothing takes
the box.** That gap has cost this project weeks twice — every worker change
committed, green, pushed, and not running, because nobody SSHed in. This skill
exists so that never depends on someone remembering.

Read `CLAUDE.md` → **Deploys** before deviating from any of this.

## First: does this session have a route to the box?

The routes are not equivalent and not all sessions have all of them. Work down
the list and use the first that applies. **If none applies, say so plainly and
stop** — do not imply the box was deployed.

### 1. SSH (a session running on Youssef's Mac)

```bash
ssh -i ~/.ssh/deenclipped_worker root@135.181.149.182
cd /opt/deenclipped && git pull && bash worker/deploy.sh
```

The key is **`deenclipped_worker`**. The similarly named `~/.ssh/deenclipped`
sitting beside it is rejected by the box — stopping at that first
`Permission denied` reads as "SSH is not set up here", and it is not.

`worker/deploy.sh` already stamps the CDN domain into `worker/.env`, rebuilds,
runs `docker builder prune -f` and calls `worker/verify-deploy.sh`. Do not
hand-roll those steps.

### 2. Dispatch the workflow (any session that can reach GitHub)

`.github/workflows/deploy-worker.yml`, via `workflow_dispatch`. It does the
same pull-and-rebuild over SSH and fails the run if the version it reads out of
the running container is not this commit's.

It needs one repository secret, `WORKER_SSH_KEY` (or `WORKER_SSH_PASSWORD`).
If neither is armed the run stops at the first step and says so — that is a
report that the deploy did NOT happen, never a green.

### 3. The Hetzner web console (no SSH, e.g. a phone)

Server → Console. Type these as **three separate lines**:

```
cd /opt/deenclipped
git pull
bash worker/deploy.sh
```

Two things about that console, both learned the hard way:

- **It strips SHIFT from symbol keys.** A pipe arrives as a backslash, an
  underscore as a hyphen, `#` as 3, `*` as 8, `$` as 4. One probe line once
  left the shell inside an open backtick. So: letters, digits, dots, slashes,
  hyphens and spaces only — which is exactly why `worker/deploy.sh` exists and
  why there is no `&&` above.
- **It silently disconnects.** Keystrokes typed into a dead console echo as
  ghost text and never run; a pull-and-build was "done" twice without ever
  happening. Press Return and confirm a fresh prompt before every batch.

## Then prove it landed — this is not optional

A clean build log proves nothing. Docker will happily rebuild an identical
image from cache and print success. Two checks, both on the box:

```bash
git log --oneline -1     # must name the commit you expect
docker exec worker-deenclipped-worker-1 \
  python3 -c "import json;print(json.load(open('/app/package.json'))['version'])"
```

That version must equal `node -p "require('./package.json').version"` in the
repo. Also glance at `df -h /` — the build cache accumulates invisibly and once
took the disk to 69%, which reads exactly like a box running out of room for
customer data.

If either check disagrees, the deploy did not land. Say that, do not round it
up to success.

## Report honestly

- Name the commit and version now running, and the two checks that established
  it. "The build succeeded" is not evidence.
- If you could not reach the box at all, the whole report is: which routes you
  tried, why each failed, and what one action would unblock it. **Never let a
  push imply a deploy.**
- Confirm it in the product too where you can: **Owner → Health → Deployed**
  compares the worker's reported version with the app's and says "Worker
  changes since then are not live" when they differ.
