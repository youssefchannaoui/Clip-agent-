import { state, save, log } from './store.js';

/**
 * YouTube API Data is not kept for longer than 30 days.
 *
 * Policy III.E.4.a-g of the YouTube API Services Developer Policies: an API
 * Client must refresh, update or delete the API Data it stores at least every
 * 30 days, and must not display stored statistics beyond that window.
 *
 * What this project actually holds, established by audit rather than assumed:
 *
 *   - Video metadata for an imported link -- title, duration and thumbnail URL
 *     from `videos?part=snippet,contentDetails`. Cached on the project so the
 *     library can show a card without calling the API again.
 *   - The connected channel's id, title and avatar URL, read once at connect.
 *   - The video id of a clip this app itself uploaded.
 *
 * No statistics are ever requested: the only read is `part=snippet,
 * contentDetails`, so there is no view, like or comment count anywhere in the
 * data. That is why this sweep is about metadata rather than counts.
 *
 * Deleting rather than refreshing is the deliberate choice. A refresh would
 * mean calling YouTube on a schedule for videos nobody is looking at, which
 * spends quota to hold data the app can re-fetch on demand the moment it is
 * needed again. The channel id and our own upload ids are kept: the first is
 * the address publishing is sent to, the second is a record of what this app
 * did, and neither is descriptive data about a YouTube resource.
 */

export const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** Fields cached from the YouTube Data API, and the stamp that dates them. */
const PROJECT_FIELDS = ['sourceTitle', 'sourceThumbUrl', 'sourceDurationSec', 'sourceFullDurationSec'];
const CONNECTION_FIELDS = ['name', 'avatar'];

/**
 * Mark a record as holding freshly-read YouTube API data.
 *
 * Called at the moment of caching, so the clock starts when the data arrived
 * rather than when the record happened to be created.
 */
export function stampYouTubeData(record, at = Date.now()) {
  if (record && typeof record === 'object') record.youtubeDataAt = at;
  return record;
}

function expired(record, now, retentionMs) {
  const at = Number(record?.youtubeDataAt || 0);
  // No stamp means the data predates this rule. Treating it as expired is the
  // conservative reading, and re-fetching costs one API call.
  if (!at) return true;
  return now - at > retentionMs;
}

/**
 * Clear YouTube API data older than the retention window.
 *
 * Returns what it cleared so the caller can log it -- an audit that says
 * "nothing to do" is as useful as one that says "cleared 12", because it is
 * evidence the sweep ran.
 */
export function sweepYouTubeData({ now = Date.now(), retentionMs = RETENTION_MS } = {}) {
  let projects = 0;
  let connections = 0;

  for (const project of Array.isArray(state.projects) ? state.projects : []) {
    // Only link imports carry API data. An uploaded file's title came from the
    // customer's own filename and is theirs, not YouTube's.
    if (!project?.url) continue;
    // Uploads carry a display string in url ("Uploaded file · name.mp4"); the
    // kind is what says where the title came from.
    if (project.sourceKind && project.sourceKind !== 'link') continue;
    if (!expired(project, now, retentionMs)) continue;
    let touched = false;
    for (const field of PROJECT_FIELDS) {
      if (project[field] !== undefined && project[field] !== null) { project[field] = null; touched = true; }
    }
    if (touched) { delete project.youtubeDataAt; projects += 1; }
  }

  const byUser = state.socialConnections && typeof state.socialConnections === 'object' ? state.socialConnections : {};
  for (const accounts of Object.values(byUser)) {
    // tenancy.setConnection stores one object per provider under each user;
    // an array is the older shape and is still read.
    const list = Array.isArray(accounts) ? accounts : Object.values(accounts && typeof accounts === 'object' ? accounts : {});
    for (const account of list) {
      if (account?.provider !== 'youtube') continue;
      if (!expired(account, now, retentionMs)) continue;
      let touched = false;
      for (const field of CONNECTION_FIELDS) {
        if (account[field]) { account[field] = ''; touched = true; }
      }
      // accountId stays: it is where publishing is addressed, not a description
      // of a YouTube resource, and losing it would break the connection itself.
      if (touched) { delete account.youtubeDataAt; connections += 1; }
    }
  }

  if (projects || connections) {
    save();
    log(`YouTube data retention: cleared cached metadata on ${projects} project(s) and ${connections} channel connection(s) older than ${Math.round(retentionMs / 86400000)} days.`);
  }
  return { projects, connections };
}

/**
 * Run the sweep now and once a day after.
 *
 * Daily rather than hourly because the window is 30 days: a sweep that runs
 * every day can be at most a day late, which is well inside the policy.
 */
export function startYouTubeRetention({ intervalMs = 24 * 60 * 60 * 1000 } = {}) {
  const result = sweepYouTubeData();
  const timer = setInterval(() => {
    try { sweepYouTubeData(); } catch (error) { log(`YouTube data retention sweep failed: ${error.message}`, 'error'); }
  }, intervalMs);
  timer.unref?.();
  return { timer, first: result };
}
