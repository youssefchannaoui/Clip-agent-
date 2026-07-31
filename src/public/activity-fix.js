(() => {
  'use strict';

  const liveActions = new Map();
  let sequence = 0;

  const style = document.createElement('style');
  style.textContent = `
    #nowList .live-now-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0 0 10px;margin-bottom:2px;border-bottom:1px solid var(--line);font-size:12px;color:var(--mute)}
    #nowList .live-now-summary strong{color:var(--text-2);font-weight:600}
    #nowList .live-activity{align-items:flex-start}
    #nowList .live-activity-icon{width:18px;height:18px;min-width:18px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;margin-top:3px;border:1px solid var(--line-lit);font-size:11px;font-weight:700;color:var(--mute)}
    #nowList .live-activity-icon.running{border:2px solid var(--line-lit);border-right-color:var(--blue);animation:turn .65s linear infinite;color:transparent}
    #nowList .live-activity-icon.pending{border-color:rgba(217,180,120,.58);color:var(--blue-soft)}
    #nowList .live-activity-icon.done{border-color:rgba(72,190,132,.5);color:#7dd9a7}
    #nowList .live-activity-icon.failed{border-color:rgba(255,85,102,.55);color:var(--red)}
    #nowList .live-activity-progress{height:4px;background:var(--line);border-radius:999px;overflow:hidden;margin-top:7px}
    #nowList .live-activity-progress span{display:block;height:100%;background:var(--blue);border-radius:inherit}
    #nowList .live-activity-meta{display:flex;gap:7px;flex-wrap:wrap;color:var(--mute-2);font-size:11px;margin-top:3px}
    #nowList .live-activity.failed .now-stage{color:var(--red)}
  `;
  document.head.appendChild(style);

  function now() { return Date.now(); }
  function relativeTime(at) {
    const seconds = Math.max(0, Math.round((now() - Number(at || now())) / 1000));
    if (seconds < 5) return 'now';
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
  function safeData() { return typeof DATA !== 'undefined' ? DATA : null; }
  function safeClip(id) {
    try { return typeof clipById === 'function' ? clipById(id) : safeData()?.clips?.find(clip => clip.id === id); }
    catch { return safeData()?.clips?.find(clip => clip.id === id); }
  }
  function actionLabel(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    let body = {};
    try { body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body || {}); } catch {}
    const clipMatch = String(url).match(/\/api\/clips\/([^/]+)/);
    const clip = clipMatch ? safeClip(decodeURIComponent(clipMatch[1])) : null;
    const clipTitle = clip?.title || 'clip';

    if (url === '/api/videos') return { title: 'Adding lecture', stage: 'Creating a new clipping job' };
    if (/\/more-clips$/.test(url)) return { title: 'Generating more clips', stage: 'Queueing the saved-source job' };
    if (url === '/api/clips/schedule-selected') return { title: 'Scheduling selected clips', stage: `Assigning ${Array.isArray(body.ids) ? body.ids.length : 0} clips to posting slots` };
    if (/\/publish$/.test(url)) return { title: `Posting ${clipTitle}`, stage: 'Creating platform upload' };
    if (/\/retry-publish$/.test(url)) return { title: `Retrying ${clipTitle}`, stage: 'Restarting platform transfer' };
    if (/\/rerender$/.test(url)) return { title: `Re-rendering ${clipTitle}`, stage: 'Queueing template render' };
    if (/\/ready$/.test(url)) return { title: `Preparing ${clipTitle}`, stage: 'Making the clip export-ready' };
    if (method === 'PATCH' && clipMatch && body.status === 'approved') return { title: `Scheduling ${clipTitle}`, stage: 'Assigning the next available posting slot' };
    if (method === 'PATCH' && clipMatch && body.status === 'waiting') return { title: `Returning ${clipTitle}`, stage: 'Moving the clip back to review' };
    if (method === 'DELETE' && clipMatch) return { title: `Deleting ${clipTitle}`, stage: 'Removing rendered files' };
    if (/\/projects\/.+\/retry$/.test(url)) return { title: 'Retrying lecture', stage: 'Returning the lecture to the worker queue' };
    if (method === 'DELETE' && /\/projects\//.test(url)) return { title: 'Removing lecture', stage: 'Deleting source, transcript and clips' };
    if (url === '/api/music' && method === 'POST') return { title: 'Uploading nasheed', stage: 'Saving and validating the audio track' };
    if (/\/api\/music\//.test(url) && method === 'DELETE') return { title: 'Deleting nasheed', stage: 'Updating the music library' };
    if (url === '/api/publishing-settings') return { title: 'Saving publishing settings', stage: 'Updating destinations and privacy' };
    if (url === '/api/automation-settings') return { title: 'Saving automation settings', stage: 'Updating quality gates' };
    if (url === '/api/clip-settings') return { title: 'Saving clip settings', stage: 'Updating generation limits' };
    if (url === '/api/music-settings') return { title: 'Saving music settings', stage: 'Updating the audio mix' };
    if (/\/api\/templates/.test(url)) return { title: 'Updating template', stage: 'Saving caption and visual settings' };
    if (/\/api\/social\//.test(url)) return { title: 'Updating social account', stage: 'Connecting, testing or disconnecting' };
    if (url === '/api/admin/youtube-cookies') return { title: 'Updating YouTube access', stage: method === 'DELETE' ? 'Removing downloader cookies' : 'Saving downloader cookies' };
    if (method !== 'GET') return { title: 'Updating DeenClipped', stage: `${method} ${url}` };
    return null;
  }
  function setAction(id, patch) {
    const previous = liveActions.get(id) || { id, startedAt: now(), updatedAt: now(), state: 'running' };
    liveActions.set(id, { ...previous, ...patch, updatedAt: now() });
    renderUnifiedNow();
  }
  function finishAction(id, state, stage, detail = '') {
    setAction(id, { state, stage, detail, completedAt: now() });
    setTimeout(() => {
      const current = liveActions.get(id);
      if (current?.completedAt && now() - current.completedAt >= (state === 'failed' ? 30000 : 12000)) {
        liveActions.delete(id);
        renderUnifiedNow();
      }
    }, state === 'failed' ? 30500 : 12500);
  }

  if (typeof api === 'function') {
    const originalApi = api;
    api = async function trackedApi(url, options = {}) {
      const label = actionLabel(url, options);
      if (!label) return originalApi(url, options);
      const id = `client-${++sequence}`;
      setAction(id, { ...label, state: 'running', kind: 'client' });
      try {
        const result = await originalApi(url, options);
        let detail = '';
        if (url === '/api/clips/schedule-selected') {
          detail = `${Number(result?.scheduled || 0)} scheduled${result?.alreadyScheduled ? ` · ${result.alreadyScheduled} already scheduled` : ''}${result?.failed ? ` · ${result.failed} failed` : ''}`;
        }
        finishAction(id, 'done', 'Completed', detail);
        return result;
      } catch (error) {
        finishAction(id, 'failed', 'Failed', error?.message || 'Unknown error');
        throw error;
      }
    };
  }

  function unifiedActivities() {
    const data = safeData();
    const activities = [];
    const seen = new Set();
    const add = activity => {
      if (!activity?.id || seen.has(activity.id)) return;
      seen.add(activity.id);
      activities.push(activity);
    };

    for (const activity of liveActions.values()) add(activity);
    if (!data) return activities;

    for (const project of data.projects || []) {
      if (['queued', 'processing'].includes(project.status)) {
        add({ id: `project-${project.id}`, title: project.title || 'Lecture', stage: project.stage || project.status, progress: Number(project.progress || 0), state: 'running', updatedAt: project.updatedAt || project.submittedAt });
      } else if (project.status === 'failed' && now() - Number(project.completedAt || project.submittedAt || 0) < 24 * 60 * 60 * 1000) {
        add({ id: `project-failed-${project.id}`, title: project.title || 'Lecture', stage: project.stage || 'Processing failed', detail: project.error || '', state: 'failed', updatedAt: project.completedAt || project.submittedAt });
      }
      const more = project.moreJob;
      if (more && ['queued', 'processing'].includes(more.status)) {
        add({ id: `more-${more.id || project.id}`, title: `More clips · ${project.title || 'Lecture'}`, stage: more.stage || 'Generating additional clips', progress: Number(more.progress || 0), state: 'running', updatedAt: more.updatedAt || more.startedAt || more.createdAt });
      } else if (more?.status === 'failed' && now() - Number(more.completedAt || more.updatedAt || more.createdAt || 0) < 60 * 60 * 1000) {
        add({ id: `more-failed-${more.id || project.id}`, title: `More clips · ${project.title || 'Lecture'}`, stage: 'Generation failed', detail: more.error || '', state: 'failed', updatedAt: more.completedAt || more.updatedAt || more.createdAt });
      }
    }

    for (const job of data.rerenderJobs || []) {
      if (['queued', 'processing'].includes(job.status)) {
        const clip = safeClip(job.clipId);
        add({ id: `rerender-${job.id}`, title: `Re-rendering ${clip?.title || 'clip'}`, stage: job.stage || job.status, progress: Number(job.progress || 0), state: 'running', updatedAt: job.updatedAt || job.startedAt || job.createdAt });
      }
    }

    const scheduled = [];
    for (const clip of data.clips || []) {
      if (clip.status === 'approved') {
        add({ id: `approved-${clip.id}`, title: clip.title || 'Clip', stage: 'Assigning the next posting slot', state: 'running', updatedAt: clip.approvedAt || clip.addedAt });
      }
      const activeTargets = (clip.targets || []).filter(target => ['scheduled', 'retrying', 'publishing', 'processing'].includes(target.status));
      for (const target of activeTargets) {
        const isTransfer = ['retrying', 'publishing', 'processing'].includes(target.status);
        add({
          id: `target-${clip.id}-${target.provider}`,
          title: `${clip.title || 'Clip'} → ${target.provider}`,
          stage: target.stage || target.platformStatus || target.status,
          detail: target.error || target.platformStatus || '',
          progress: Number.isFinite(target.progressPercent) ? Number(target.progressPercent) : null,
          state: isTransfer ? 'running' : 'pending',
          updatedAt: target.updatedAt || clip.scheduledAt || clip.addedAt,
        });
      }
      if (clip.status === 'scheduled' && !activeTargets.length) {
        scheduled.push({ id: `scheduled-${clip.id}`, title: clip.title || 'Clip', stage: `Scheduled ${clip.scheduledLabel || ''}`.trim(), state: 'pending', updatedAt: clip.scheduledAt || clip.addedAt });
      }
      if (clip.status === 'publish_failed') {
        const error = (clip.targets || []).find(target => target.error)?.error || 'Publishing failed';
        add({ id: `failed-${clip.id}`, title: clip.title || 'Clip', stage: 'Publishing failed', detail: error, state: 'failed', updatedAt: Math.max(0, ...(clip.targets || []).map(target => Number(target.updatedAt || 0))) || clip.addedAt });
      }
    }
    scheduled.sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0)).forEach(add);

    for (const item of (data.log || []).slice(0, 20)) {
      if (!item?.at || now() - Number(item.at) > 15 * 60 * 1000) continue;
      add({ id: `log-${item.at}-${item.message}`, title: item.message || 'Activity', stage: 'Recent activity', state: item.level === 'error' ? 'failed' : item.level === 'warn' ? 'pending' : 'done', updatedAt: item.at });
    }

    const priority = { running: 0, failed: 1, pending: 2, done: 3 };
    activities.sort((a, b) => (priority[a.state] ?? 9) - (priority[b.state] ?? 9) || Number(b.updatedAt || b.startedAt || 0) - Number(a.updatedAt || a.startedAt || 0));
    return activities.slice(0, 40);
  }

  function renderUnifiedNow() {
    const list = document.querySelector('#nowList');
    if (!list || typeof esc !== 'function') return;
    const activities = unifiedActivities();
    const running = activities.filter(item => item.state === 'running').length;
    const pending = activities.filter(item => item.state === 'pending').length;
    const failed = activities.filter(item => item.state === 'failed').length;
    if (document.querySelector('#nowIcon')) document.querySelector('#nowIcon').textContent = running ? '⚡ ' : '';
    if (!activities.length) {
      list.innerHTML = '<div class="now-idle">Nothing is processing, scheduling or publishing right now.</div>';
      return;
    }
    const summary = `<div class="live-now-summary"><strong>${running} running · ${pending} queued${failed ? ` · ${failed} failed` : ''}</strong><span>${activities.length} shown</span></div>`;
    list.innerHTML = summary + activities.map(item => {
      const icon = item.state === 'done' ? '✓' : item.state === 'failed' ? '×' : item.state === 'pending' ? '•' : '';
      const progress = Number.isFinite(item.progress) ? Math.max(0, Math.min(100, Number(item.progress))) : null;
      return `<div class="now-item live-activity ${esc(item.state || 'pending')}"><span class="live-activity-icon ${esc(item.state || 'pending')}">${icon}</span><div class="now-what"><div class="now-title">${esc(item.title || 'Activity')}</div><div class="now-stage">${esc(item.stage || item.state || '')}${item.detail ? ` · ${esc(item.detail)}` : ''}</div>${progress !== null ? `<div class="live-activity-progress"><span style="width:${progress}%"></span></div>` : ''}<div class="live-activity-meta"><span>${relativeTime(item.updatedAt || item.startedAt)}</span>${progress !== null ? `<span>${progress}%</span>` : ''}</div></div></div>`;
    }).join('');
  }

  if (typeof renderSide === 'function') {
    const originalRenderSide = renderSide;
    renderSide = function enhancedRenderSide() {
      originalRenderSide();
      renderUnifiedNow();
    };
  }

  async function scheduleLibraryIds(ids, button = null) {
    const unique = [...new Set((ids || []).map(String))].filter(id => {
      const clip = safeClip(id);
      return clip && !libraryClipPosted(clip) && !libraryClipActive(clip);
    });
    if (!unique.length) return toast('Select at least one unposted clip','bad');
    if (button) setBusy(button, true, 'Scheduling…');
    try {
      const result = await api('/api/clips/schedule-selected', { method: 'POST', body: JSON.stringify({ ids: unique }) });
      const parts = [];
      if (result.scheduled) parts.push(`${result.scheduled} scheduled`);
      if (result.alreadyScheduled) parts.push(`${result.alreadyScheduled} already scheduled`);
      if (result.failed) parts.push(`${result.failed} failed`);
      toast(parts.join(' · ') || 'No clips changed', result.failed && !result.scheduled ? 'bad' : 'good');
      if (result.failed) {
        const first = (result.results || []).find(item => !item.ok);
        if (first?.error) toast(first.error, 'bad');
      }
      if (typeof LIBRARY_SELECTED !== 'undefined') LIBRARY_SELECTED.clear();
      await refresh();
      if (typeof renderProjectClips === 'function' && typeof LIBRARY_PROJECT_ID !== 'undefined' && LIBRARY_PROJECT_ID) renderProjectClips();
    } catch (error) {
      toast(error.message, 'bad');
    }
    if (button) setBusy(button, false);
  }

  if (typeof bindProjectClipActions === 'function') {
    const originalBindProjectClipActions = bindProjectClipActions;
    bindProjectClipActions = function enhancedBindProjectClipActions() {
      originalBindProjectClipActions();
      document.querySelectorAll('[data-library-schedule]').forEach(button => {
        button.onclick = () => scheduleLibraryIds([button.dataset.librarySchedule], button);
      });
    };
  }

  const bulkSchedule = document.querySelector('#scheduleSelectedLibraryClips');
  if (bulkSchedule) {
    bulkSchedule.onclick = () => {
      const ids = typeof LIBRARY_SELECTED !== 'undefined' ? [...LIBRARY_SELECTED] : [];
      scheduleLibraryIds(ids, bulkSchedule);
    };
  }

  setInterval(renderUnifiedNow, 1000);
  setTimeout(renderUnifiedNow, 0);
})();
