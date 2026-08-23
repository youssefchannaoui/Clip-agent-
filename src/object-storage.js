import crypto from 'node:crypto';
import path from 'node:path';
import { config } from './config.js';
import { assertStorageObjectKey } from './video-import.js';

const encode = value => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest();

export function configured() {
  return Boolean(config.objectStorageEndpoint && config.objectStorageBucket && config.objectStorageAccessKey && config.objectStorageSecretKey);
}

function storageBase() {
  const endpoint = new URL(config.objectStorageEndpoint);
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${encode(config.objectStorageBucket)}`;
  return endpoint;
}

export function publicObjectUrl(key) {
  const safe = String(key || '').split('/').map(encode).join('/');
  if (config.objectStoragePublicUrl) return `${config.objectStoragePublicUrl.replace(/\/$/, '')}/${safe}`;
  const base = storageBase();
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${safe}`;
  return base.toString();
}

export function presign({ method = 'GET', key, expiresSec = 900, contentType = '', contentLength = 0 }) {
  if (!configured()) throw new Error('Object storage is not configured.');
  const safeKey = String(key || '').split('/').filter(Boolean).map(encode).join('/');
  if (!safeKey) throw new Error('Object storage key is required.');
  const base = storageBase();
  base.pathname = `${base.pathname.replace(/\/$/, '')}/${safeKey}`;

  const now = new Date();
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const region = config.objectStorageRegion || 'auto';
  const scope = `${day}/${region}/s3/aws4_request`;
  // Signing content-length is what actually binds the size. A presigned PUT is
  // otherwise a licence to write a file of ANY size into the bucket, and the
  // only number anyone checked was one the client had sent about itself.
  // Browsers set Content-Length from the body and forbid overriding it, so a
  // caller that asks for 10MB and sends 3GB fails the signature at the bucket.
  const headerPairs = [['host', base.host]];
  if (contentType) headerPairs.push(['content-type', contentType]);
  if (contentLength > 0) headerPairs.push(['content-length', String(contentLength)]);
  headerPairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const signedHeaders = headerPairs.map(([name]) => name).join(';');
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.objectStorageAccessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(60, Math.min(3600, Number(expiresSec) || 900))),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, v]) => `${encode(k)}=${encode(v)}`).join('&');
  const headers = `${headerPairs.map(([name, value]) => `${name}:${value}`).join('\n')}\n`;
  const canonical = [method.toUpperCase(), base.pathname, canonicalQuery, headers, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const dateKey = hmac(`AWS4${config.objectStorageSecretKey}`, day);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  params.set('X-Amz-Signature', crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex'));
  base.search = params.toString();
  return base.toString();
}

export const uploadPrefixFor = userId => `uploads/${String(userId).replace(/[^A-Za-z0-9_-]/g, '_')}/`;

/**
 * Best-effort delete of a stored object. Rerenders and deletions replace the
 * object keys on the record; without this the superseded MP4s and thumbnails
 * stayed in the bucket forever, publicly addressable and billed.
 * Failures are logged by the caller's catch -- a leak is not worth failing
 * the operation that revealed it.
 */
export async function deleteObject(key) {
  if (!configured() || !key) return false;
  const url = presign({ method: 'DELETE', key, expiresSec: 300 });
  const response = await fetch(url, { method: 'DELETE' });
  // 204 is the success; 404 means it is already gone, which is the goal state.
  if (!response.ok && response.status !== 404) {
    throw new Error(`Object storage delete returned HTTP ${response.status}.`);
  }
  return true;
}

// The type is decided here, from the extension we just validated -- never
// taken from the caller. The client used to send it and the server signed
// whatever it was told, so a file named promo.mp4 could be declared text/html
// and stored as a live web page on the media domain, served from the same
// origin family as the product.
const UPLOAD_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
});

export function createUpload(userId, fileName, size = 0) {
  if (!configured()) throw new Error('Direct upload storage is not configured. Contact the site owner.');
  const extension = path.extname(String(fileName || '')).toLowerCase();
  const contentType = UPLOAD_TYPES[extension];
  if (!contentType) throw new Error('Upload an MP4, MOV, M4V, WebM or MKV video.');
  const bytes = Math.floor(Number(size) || 0);
  if (!(bytes > 0)) throw new Error('The size of the file is required before an upload can start.');
  if (bytes > config.maxVideoUploadBytes) {
    throw new Error(`That file is ${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB. The limit is ${Math.round(config.maxVideoUploadBytes / 1024 / 1024)}MB.`);
  }
  const safeName = path.basename(String(fileName || 'video.mp4')).replace(/[^A-Za-z0-9._-]+/g, '-').slice(-120);
  const key = assertStorageObjectKey(`${uploadPrefixFor(userId)}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`);
  return { key, uploadUrl: presign({ method: 'PUT', key, contentType, contentLength: bytes }), contentType, expiresIn: 900, maxBytes: bytes };
}
