import { config } from './config.js';
import { state } from './store.js';
import { connectionListFor } from './tenancy.js';
import { parseYouTubeUrl } from './video-import.js';

/**
 * A pasted YouTube link must name a video on a channel this account has
 * CONNECTED. Uploads are untouched.
 *
 * WHY THIS EXISTS, in Google's own words. On 8 September 2026 they refused
 * DeenClipped's OAuth data-access verification:
 *
 *     "the feature that allows users to ingest, download, and create
 *      derivative clips from arbitrary YouTube videos facilitates the
 *      unauthorized downloading and modification of third-party intellectual
 *      property"
 *
 * citing Google APIs Terms of Service section 5a. That section is also the way
 * through, and the fix is shaped by its exact wording: content accessible
 * through the APIs "may be subject to intellectual property rights, and, if
 * so, you may not use it unless you are LICENSED TO DO SO BY THE OWNER of that
 * content."
 *
 * So the video has to be the signed-in person's own, and the licence has to be
 * something the product can PROVE rather than something a customer asserts on
 * a checkbox -- an attestation would leave the facilitation exactly where it
 * was. OAuth is the proof, and both halves already existed before this module:
 * `channels.list?mine=true` names the channels they control (stored as the
 * connection's accountId), `videos.list?part=snippet` names the channel a
 * video belongs to. This compares the two. Neither word in Google's sentence
 * survives it: the video is not "arbitrary" and it is not "third-party".
 *
 * IT FAILS CLOSED, EVERY WAY -- no API key, a refused lookup, a deleted video,
 * a network error, a connection with no channel id on it. An ownership claim
 * that cannot be checked has not been proven, and the entire purpose of this
 * module is that nothing unverified reaches the downloader. Same posture, and
 * the same reason, as the Turnstile gate: a challenge that cannot be checked
 * has not been passed.
 */

const LOOKUP_TIMEOUT_MS = 12_000;

/** The YouTube channels this account has proven it controls, via OAuth. */
export function connectedChannelIds(user) {
  const userId = String(user?.id || user || '');
  if (!userId) return [];
  return connectionListFor(state.socialConnections, userId, 'youtube')
    // A blank accountId must never be a wildcard. It is honoured as "the only
    // connection" on the PUBLISH path (v3.56.0) because a record written
    // before multi-channel has one -- but here it would match every video on
    // YouTube, which is the whole hole this module closes.
    .map(item => String(item?.accountId || '').trim())
    .filter(Boolean);
}

/** Which channel a video belongs to, straight from the Data API. */
export async function channelForVideo(videoId) {
  const key = String(config.youtubeDataApiKey || '').trim();
  if (!key) {
    const error = new Error('Link import is unavailable on this deployment — it cannot confirm which channel a video is on. Use Upload MP4.');
    error.ownershipUnverifiable = true;
    throw error;
  }
  const url = `${config.youtubeApiBase}/youtube/v3/videos?part=snippet&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error?.message || `YouTube Data API HTTP ${response.status}`);
    const item = Array.isArray(payload?.items) ? payload.items[0] : null;
    // Empty means the video is private, deleted, or the id is wrong. An API
    // key sees public and unlisted videos; a private one is invisible to it,
    // so a private video cannot be imported by link even by its owner. That is
    // the same limit OpusClip's own channel import carries, and the message
    // names the way round it.
    if (!item) return null;
    return {
      channelId: String(item?.snippet?.channelId || '').trim(),
      channelTitle: String(item?.snippet?.channelTitle || '').trim(),
    };
  } finally { clearTimeout(timer); }
}

/**
 * Refuse the import unless the video is on a channel this account connected.
 *
 * Throws with the way forward named. Returns the resolved channel, so a caller
 * can record which connection authorised the import.
 */
export async function assertOwnsVideo(user, url) {
  const parsed = parseYouTubeUrl(url);
  const mine = connectedChannelIds(user);
  if (!mine.length) {
    throw new Error('Connect the YouTube channel this video is on first. If the video is not yours, use Upload MP4 instead.');
  }

  let found = null;
  try { found = await channelForVideo(parsed.videoId); }
  catch (error) {
    if (error.ownershipUnverifiable) throw error;
    // A lookup that did not answer is not permission. Say it is temporary,
    // because it usually is, and name the way past it either way.
    throw new Error(`Could not confirm which channel that video is on (${String(error.message).slice(0, 40)}). Try again, or use Upload MP4.`);
  }

  if (!found) throw new Error('That video is not visible on YouTube — private, deleted, or a wrong link. Download it from Studio and use Upload MP4.');
  if (!found.channelId) throw new Error('YouTube did not say which channel that video is on, so it cannot be imported. Use Upload MP4.');
  if (!mine.includes(found.channelId)) {
    // The name is capped: it is somebody's channel title and can be long, and
    // the notification dock clamps to three lines — past that the ACTION is the
    // half that gets cut, which is the v3.169.0 fault.
    const name = found.channelTitle.length > 30 ? `${found.channelTitle.slice(0, 29)}\u2026` : found.channelTitle;
    const whose = name ? `"${name}"` : 'a channel you have not connected';
    throw new Error(`That video is on ${whose}, which you have not connected. Connect it, or use Upload MP4.`);
  }
  return found;
}

/**
 * Re-running a link import that was already authorised once.
 *
 * Synchronous on purpose: retryProject and queueMoreClips are, and the answer
 * does not need the network. `sourceChannelId` is stamped on the project at
 * submit by the gate above, so a re-run only has to ask whether that channel is
 * STILL connected -- disconnecting a channel withdraws the licence it granted,
 * and a lecture from it must stop being re-downloadable at that moment.
 *
 * A project imported before this shipped carries no channel and cannot be
 * re-verified without asking YouTube, so it is refused with the one-paste way
 * round it. There are very few of those and none of them is worth a guess.
 */
export function assertStillOwns(user, project) {
  if (String(project?.sourceKind || 'link') !== 'link') return;
  if (!isYouTubeLink(String(project?.url || ''))) return;
  const channelId = String(project?.sourceChannelId || '').trim();
  if (!channelId) throw new Error('This lecture predates DeenClipped recording its channel. Paste the link again to re-import it.');
  if (!connectedChannelIds(user).includes(channelId)) throw new Error('The channel this lecture came from is no longer connected. Reconnect it, or use Upload MP4.');
}

/** True when a link needs the gate at all. Uploads and file paths do not. */
export function isYouTubeLink(value) {
  try { parseYouTubeUrl(value); return true; }
  catch { return false; }
}
