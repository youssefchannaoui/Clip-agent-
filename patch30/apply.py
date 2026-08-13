#!/usr/bin/env python3
r"""
Stop throwing away the worker's progress detail, and group re-renders into
batches so the UI can say "2 of 4 done" truthfully.

WHAT WAS WRONG
--------------
worker/clip_worker.py emits rich progress on every step:

    progress("Rendering clip 3 of 8", 79, currentClip=3, totalClips=8, etaSec=41)

parseWorkerLine() in src/local-engine.js kept exactly two of those fields —
stage and progress — and dropped the rest on the floor. `etaSec` appears 13
times in the worker and zero times anywhere in src/ or the browser. So the
progress bar had no ETA and no clip counter because the data never survived
the first hop, not because nobody had written the UI.

Separately, saving a template queues one independent re-render per clip with
nothing linking them. There was no way to know four jobs came from one
action, so "2 of 4" was not computable at all.

WHAT THIS ADDS
--------------
1. parseWorkerLine() keeps etaSec, currentClip, totalClips, sourceDurationSec
   and processedSec, and appends each distinct stage to a bounded per-job
   `stages` log with timestamps. The log is capped at 40 entries so a long
   job cannot grow state.json without bound.

2. queueClipRerender() accepts a batchId/batchLabel/batchTotal, and
   queueTemplateForEveryUnpostedClip() mints one batch per template save and
   stamps every queued job with it, plus startedAt so elapsed time is
   measurable.

3. Both are surfaced to the browser. The client can now group by batchId,
   count finished jobs, read each job's real stage, and derive a batch ETA
   from how long the finished ones actually took — which is a better estimate
   than the worker can give, because the worker only sees one job.

Nothing about how work is executed changes. This is plumbing that was
already being produced and discarded.

Run from your repo root:

    python3 patch30/apply.py
"""
import pathlib
import sys

ROOT = pathlib.Path.cwd()
ENGINE = ROOT / "src/local-engine.js"
SERVER = ROOT / "src/server.js"
if not ENGINE.exists():
    sys.exit("Can't find src/local-engine.js — run this from your repo root, not ~.")

changed = []
skipped = []


def edit(path, old, new, label):
    text = path.read_text()
    if new and new in text and old not in text:
        skipped.append(f"{label} (already applied)")
        return
    if old not in text:
        sys.exit(f"ANCHOR NOT FOUND for '{label}' in {path.name}.\nExpected:\n{old[:260]}\n\nNothing written.")
    if text.count(old) != 1:
        sys.exit(f"ANCHOR NOT UNIQUE ({text.count(old)}x) for '{label}'. Aborting.")
    path.write_text(text.replace(old, new))
    changed.append(label)


# ------------------------------------------- 1. keep the full progress payload
edit(
    ENGINE,
    """  if (payload.type === 'progress') {
    record.stage = String(payload.stage || 'Processing');
    record.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
    record.status = 'processing';
    record.updatedAt = Date.now();
    save();""",
    """  if (payload.type === 'progress') {
    const stage = String(payload.stage || 'Processing');
    // The worker already reports all of this on every step. Keeping only
    // stage+progress is why the UI had no ETA and no clip counter.
    const num = value => (Number.isFinite(Number(value)) ? Number(value) : null);
    record.stage = stage;
    record.progress = Math.max(0, Math.min(100, Number(payload.progress) || 0));
    record.etaSec = num(payload.etaSec);
    record.currentClip = num(payload.currentClip);
    record.totalClips = num(payload.totalClips);
    record.sourceDurationSec = num(payload.sourceDurationSec);
    record.processedSec = num(payload.processedSec);
    record.status = 'processing';
    if (!record.startedAt) record.startedAt = Date.now();
    // One entry per distinct stage, so the log reads as steps rather than
    // one line per percentage tick. Bounded so state.json cannot grow.
    record.stages = Array.isArray(record.stages) ? record.stages : [];
    if (record.stages[record.stages.length - 1]?.stage !== stage) {
      record.stages.push({ stage, at: Date.now(), progress: record.progress });
      if (record.stages.length > 40) record.stages = record.stages.slice(-40);
    }
    record.updatedAt = Date.now();
    save();""",
    "keep etaSec, clip counters and a bounded stage log",
)


# ------------------------------------------------------- 2. batch the queue
edit(
    ENGINE,
    "export function queueClipRerender(clipId, templateId, { asVariant = false } = {}) {",
    "export function queueClipRerender(clipId, templateId, { asVariant = false, batchId = '', batchLabel = '', batchTotal = 0 } = {}) {",
    "queueClipRerender accepts batch details",
)

edit(
    ENGINE,
    """    asVariant: Boolean(asVariant), status: 'queued', stage: 'Waiting to re-render', progress: 0, engine: project.engine === 'remote' ? 'remote' : 'self-hosted',
    createdAt: Date.now(), jobFile: file, resultPath,""",
    """    asVariant: Boolean(asVariant), status: 'queued', stage: 'Waiting to re-render', progress: 0, engine: project.engine === 'remote' ? 'remote' : 'self-hosted',
    createdAt: Date.now(), jobFile: file, resultPath,
    clipTitle: clip.title || '', projectId: project.id, projectTitle: project.title || '',
    batchId: String(batchId || ''), batchLabel: String(batchLabel || ''), batchTotal: Number(batchTotal || 0),
    stages: [], etaSec: null, currentClip: null, totalClips: null, startedAt: null,""",
    "stamp batch details and titles onto the job record",
)


# --------------------------------------------- 3. one batch per template save
edit(
    SERVER,
    """function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update') {
  let queued = 0;
  let skipped = 0;
  const errors = [];""",
    """function queueTemplateForEveryUnpostedClip(template, user, reason = 'template update') {
  let queued = 0;
  let skipped = 0;
  const errors = [];
  // One id per action, so the browser can group these jobs and count them
  // instead of showing four unrelated bars.
  const batchId = `batch_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const eligible = ownedBy(state.clips, user?.id).filter(clip => clip.status !== 'posted' && !clip.variantOf).length;""",
    "mint a batch id per template save",
)

edit(
    SERVER,
    "      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false });",
    "      agent.engine.queueClipRerender(clip.id, template.id, { asVariant: false, batchId, batchLabel: `Applying \"${template.name}\"`, batchTotal: eligible });",
    "stamp every queued re-render with the batch",
)


# --------------------------------------------------- 4. send it to the client
edit(
    SERVER,
    "    rerenderJobs: ownedBy(state.rerenderJobs, user.id).filter(job => clipsForUser.some(clip => clip.id === job.clipId)).slice(0, 30),",
    """    rerenderJobs: ownedBy(state.rerenderJobs, user.id)
      .filter(job => clipsForUser.some(clip => clip.id === job.clipId))
      .slice(0, 30)
      .map(job => ({
        id: job.id, clipId: job.clipId, status: job.status, stage: job.stage, progress: job.progress,
        error: job.error || null, asVariant: Boolean(job.asVariant), engine: job.engine || '',
        createdAt: job.createdAt || null, startedAt: job.startedAt || null, updatedAt: job.updatedAt || null,
        finishedAt: job.finishedAt || null,
        clipTitle: job.clipTitle || '', projectTitle: job.projectTitle || '',
        templateName: job.templateName || '',
        batchId: job.batchId || '', batchLabel: job.batchLabel || '', batchTotal: Number(job.batchTotal || 0),
        etaSec: Number.isFinite(Number(job.etaSec)) ? Number(job.etaSec) : null,
        currentClip: job.currentClip ?? null, totalClips: job.totalClips ?? null,
        stages: Array.isArray(job.stages) ? job.stages.slice(-12) : [],
      })),""",
    "expose the richer re-render job shape to the browser",
)


# Record when a job finishes so elapsed time is measurable for the ETA.
engine = ENGINE.read_text()
if "job.finishedAt = Date.now()" not in engine and "record.finishedAt = Date.now()" not in engine:
    marker = "  const newer = state.rerenderJobs.find(item => item.clipId === jobRecord.clipId"
    if marker not in engine:
        sys.exit("Could not find the re-render completion path to stamp finishedAt.")
    engine = engine.replace(
        marker,
        "  jobRecord.finishedAt = Date.now();\n" + marker,
        1,
    )
    ENGINE.write_text(engine)
    changed.append("stamp finishedAt so batch ETA can be measured")
else:
    skipped.append("finishedAt stamp (already applied)")

print("patch30 applied\n")
for item in changed:
    print(f"  changed  {item}")
for item in skipped:
    print(f"  skipped  {item}")
print("\nNext:\n  npm run check && npm test\n")
