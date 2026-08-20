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

export function presign({ method = 'GET', key, expiresSec = 900, contentType = '' }) {
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
  const headerPairs = contentType
    ? [['content-type', contentType], ['host', base.host]]
    : [['host', base.host]];
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

export function createUpload(userId, fileName, contentType = 'video/mp4') {
  if (!configured()) throw new Error('Direct upload storage is not configured. Contact the site owner.');
  const extension = path.extname(String(fileName || '')).toLowerCase();
  if (!['.mp4', '.mov', '.m4v', '.webm', '.mkv'].includes(extension)) throw new Error('Upload an MP4, MOV, M4V, WebM or MKV video.');
  const safeName = path.basename(String(fileName || 'video.mp4')).replace(/[^A-Za-z0-9._-]+/g, '-').slice(-120);
  const key = assertStorageObjectKey(`${uploadPrefixFor(userId)}${Date.now()}-${crypto.randomBytes(6).toString('hex')}-${safeName}`);
  return { key, uploadUrl: presign({ method: 'PUT', key, contentType }), contentType, expiresIn: 900 };
}
