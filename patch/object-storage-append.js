
/* ---------------------------------------------------------------------------
 * Storage usage reporting (admin only)
 *
 * Cloudflare R2 speaks the S3 ListObjectsV2 API, so we can total up how much
 * space the bucket is actually using by paging through the object list. This
 * is signed the same way presign() is — the only difference is that the
 * signature covers a bucket-level GET with query parameters instead of a
 * single object key.
 * ------------------------------------------------------------------------- */

function presignBucketQuery(query = {}, expiresSec = 300) {
  if (!configured()) throw new Error('Object storage is not configured.');
  const base = storageBase();
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const day = stamp.slice(0, 8);
  const region = config.objectStorageRegion || 'auto';
  const scope = `${day}/${region}/s3/aws4_request`;
  const signedHeaders = 'host';
  const params = new URLSearchParams({
    ...query,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.objectStorageAccessKey}/${scope}`,
    'X-Amz-Date': stamp,
    'X-Amz-Expires': String(Math.max(60, Math.min(3600, Number(expiresSec) || 300))),
    'X-Amz-SignedHeaders': signedHeaders,
  });
  const canonicalQuery = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encode(k)}=${encode(v)}`)
    .join('&');
  const headers = `host:${base.host}\n`;
  const canonical = ['GET', base.pathname, canonicalQuery, headers, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256(canonical)].join('\n');
  const dateKey = hmac(`AWS4${config.objectStorageSecretKey}`, day);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, 's3');
  const signingKey = hmac(serviceKey, 'aws4_request');
  params.set('X-Amz-Signature', crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex'));
  base.search = params.toString();
  return base.toString();
}

function xmlValue(block, tag) {
  const found = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  if (!found) return '';
  return found[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/**
 * Walk the bucket and total up object count and bytes, grouped by top-level
 * prefix (uploads/, projects/, clips/ ...). Capped at maxPages so a very large
 * bucket can never hang the admin page; `truncated` says whether we stopped
 * early.
 */
export async function storageUsage({ maxPages = 20, pageSize = 1000 } = {}) {
  if (!configured()) {
    return { configured: false, bucket: '', totalBytes: 0, totalObjects: 0, folders: [], truncated: false, scannedPages: 0, newestAt: null, oldestAt: null };
  }
  const folders = new Map();
  let token = '';
  let pages = 0;
  let totalBytes = 0;
  let totalObjects = 0;
  let truncated = false;
  let newestAt = 0;
  let oldestAt = 0;

  while (pages < maxPages) {
    pages += 1;
    const query = { 'list-type': '2', 'max-keys': String(pageSize) };
    if (token) query['continuation-token'] = token;
    const response = await fetch(presignBucketQuery(query));
    if (!response.ok) throw new Error(`Storage listing failed with status ${response.status}.`);
    const xml = await response.text();

    for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
      const block = match[1];
      const key = xmlValue(block, 'Key');
      const size = Number(xmlValue(block, 'Size') || 0);
      const modified = Date.parse(xmlValue(block, 'LastModified')) || 0;
      totalObjects += 1;
      totalBytes += Number.isFinite(size) ? size : 0;
      if (modified) {
        if (!oldestAt || modified < oldestAt) oldestAt = modified;
        if (modified > newestAt) newestAt = modified;
      }
      const top = key.includes('/') ? key.slice(0, key.indexOf('/')) : 'root';
      const entry = folders.get(top) || { prefix: top, objects: 0, bytes: 0 };
      entry.objects += 1;
      entry.bytes += Number.isFinite(size) ? size : 0;
      folders.set(top, entry);
    }

    const isTruncated = /<IsTruncated>\s*true\s*<\/IsTruncated>/i.test(xml);
    token = xmlValue(xml, 'NextContinuationToken');
    if (!isTruncated || !token) break;
    if (pages >= maxPages) truncated = true;
  }

  return {
    configured: true,
    bucket: config.objectStorageBucket,
    endpoint: config.objectStorageEndpoint,
    region: config.objectStorageRegion || 'auto',
    totalBytes,
    totalObjects,
    truncated,
    scannedPages: pages,
    newestAt: newestAt || null,
    oldestAt: oldestAt || null,
    folders: [...folders.values()].sort((a, b) => b.bytes - a.bytes),
  };
}
