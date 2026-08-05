const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be']);

export function parseYouTubeUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Paste a complete YouTube video URL.'); }
  if (url.protocol !== 'https:') throw new Error('YouTube imports must use HTTPS.');
  const host = url.hostname.toLowerCase();
  if (!YOUTUBE_HOSTS.has(host)) throw new Error('Only YouTube video URLs are supported for link imports.');
  if (url.searchParams.has('list')) throw new Error('Playlists are not supported. Paste one YouTube video, or upload the original MP4.');

  let videoId = '';
  if (host === 'youtu.be') videoId = url.pathname.split('/').filter(Boolean)[0] || '';
  else if (url.pathname === '/watch') videoId = url.searchParams.get('v') || '';
  else {
    const match = url.pathname.match(/^\/(?:shorts|embed|v)\/([^/]+)/);
    videoId = match?.[1] || '';
  }
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) {
    throw new Error('That is not a supported single-video YouTube URL.');
  }
  return {
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
  };
}

export function isYouTubeUrl(value) {
  try { parseYouTubeUrl(value); return true; }
  catch { return false; }
}

export function assertStorageObjectKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 1024 || key.startsWith('/') || key.includes('\\') || key.split('/').includes('..')) {
    throw new Error('The uploaded video reference is invalid.');
  }
  if (!/^uploads\/[A-Za-z0-9_-]+\/[A-Za-z0-9._/-]+$/.test(key)) {
    throw new Error('The uploaded video reference is outside the permitted storage area.');
  }
  return key;
}
