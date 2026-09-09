import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test, { after } from 'node:test';

/**
 * Where a pasted link's title, length and thumbnail come from (9 Sept 2026).
 *
 * Google refused this app's OAuth data-access verification on 8 Sept 2026,
 * citing API ToS section 5a -- "Content Accessible Through our APIs" -- over
 * clipping arbitrary third-party videos. Section 5a governs what is reached
 * THROUGH a Google API, and the only reason an arbitrary video was ever inside
 * its jurisdiction is that this app called `videos.list` about it for exactly
 * three fields.
 *
 * So they are read from the box instead: the machine with yt-dlp, the cookies
 * and the residential pool, which is the same machine and the SAME OPTIONS
 * that will fetch the file. test/youtube-compliance.test.mjs is the law that
 * no googleapis endpoint may ask about a video again; this file drives what
 * replaced it, against a fake worker on a local port.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-source-meta-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'source-metadata-secret-long-enough-here';

// The fake worker. It records what it was asked, so the test can assert on the
// REQUEST as well as the answer -- a probe that carries a Google credential,
// or that forgets the network block the download uses, is the fault.
const asked = [];
let mode = 'ok';
const worker = http.createServer((req, res) => {
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && req.url === '/source-info') {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      asked.push({ body: JSON.parse(raw || '{}'), headers: req.headers });
      if (mode === 'down') { res.destroy(); return; }
      if (mode === 'refused') return send(502, { error: 'Private video', code: 'metadata_unavailable' });
      send(200, { url: 'https://www.youtube.com/watch?v=abc12345678', title: 'The Mercy of Allah', durationSec: 1936, thumbnail: 'https://i.ytimg.com/vi/abc12345678/maxres.jpg', extractor: 'Youtube' });
    });
    return;
  }
  send(404, { error: 'Not found.' });
});
await new Promise(resolve => worker.listen(0, '127.0.0.1', resolve));
const port = worker.address().port;

process.env.WORKER_BASE_URL = `http://127.0.0.1:${port}`;
process.env.WORKER_SHARED_SECRET = 'worker-shared-secret-long-enough-here';
process.env.PUBLIC_BASE_URL = 'https://deenclipped.online';

const engine = await import('../src/local-engine.js');
const store = await import('../src/store.js');

after(async () => {
  await new Promise(resolve => worker.close(resolve));
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* a leftover temp dir is harmless */ }
});

const URL_UNDER_TEST = 'https://www.youtube.com/watch?v=abc12345678';

test('a pasted link is described by the worker, not by Google', async () => {
  asked.length = 0; mode = 'ok';
  const info = await engine.sourceInfo(URL_UNDER_TEST);
  assert.equal(asked.length, 1, 'the box was asked exactly once');
  assert.equal(info.title, 'The Mercy of Allah');
  assert.equal(info.durationSec, 1936);
  assert.equal(info.durationKnown, true, 'a known length is what gives the job panel its range picker');
  assert.match(info.thumbnail, /i\.ytimg\.com/);
});

test('the probe carries no Google credential, and is signed like every other worker call', async () => {
  asked.length = 0; mode = 'ok';
  await engine.sourceInfo(URL_UNDER_TEST);
  const [call] = asked;
  // The whole point: the request that identifies a third-party video reaches
  // our own box, not Google, and carries nothing of the customer's Google
  // account with it.
  const body = JSON.stringify(call.body);
  assert.doesNotMatch(body, /googleapis|access_token|refresh|Bearer|youtubeDataApiKey|AIza/i,
    'a metadata probe must carry no Google credential of any kind');
  assert.deepEqual(Object.keys(call.body).sort(), ['network', 'url'].filter(k => k in call.body).sort());
  assert.ok(call.headers['x-deenclipped-signature'], 'behind the same HMAC as every other worker route');
  assert.ok(call.headers['x-deenclipped-timestamp']);
});

test('the probe asks the way the download will ask', async () => {
  // A length quoted from a request the download cannot repeat is a length the
  // customer is shown and then charged against something else. One definition
  // of the network block, used by both.
  store.state.importNetwork = { proxy: 'http://user:secret@exit.example:1080', cookiesText: '# Netscape\n.youtube.com\tTRUE\t/\tTRUE\t0\tX\tY' };
  asked.length = 0; mode = 'ok';
  await engine.sourceInfo(URL_UNDER_TEST);
  const sent = asked[0].body.network;
  const download = engine.withImportNetwork({ type: 'youtube', url: URL_UNDER_TEST }).network;
  assert.deepEqual(sent, download, 'the probe and the download are handed the same network block');
  store.state.importNetwork = {};
});

test('a worker that cannot answer does not break the paste box', async () => {
  // The fallbacks are the app's own page lookup and then a validated-only
  // answer the worker confirms after it downloads. Neither involves Google.
  asked.length = 0; mode = 'refused';
  const info = await engine.sourceInfo(URL_UNDER_TEST);
  assert.equal(asked.length, 1);
  assert.equal(info.durationKnown, false, 'no invented length');
  assert.equal(info.extractor, 'validated-only');
  assert.match(info.warning || '', /Worker metadata lookup failed/, 'the reason survives for the activity feed');
  assert.match(info.thumbnail, /abc12345678/, 'the poster URL needs no lookup at all');
});

test('a worker that is unreachable is the same as one that refuses', async () => {
  asked.length = 0; mode = 'down';
  const info = await engine.sourceInfo(URL_UNDER_TEST);
  assert.equal(info.durationKnown, false);
  assert.equal(info.extractor, 'validated-only');
});

test('nothing in the source-metadata path names a googleapis endpoint', () => {
  const engineSource = fs.readFileSync(new URL('../src/local-engine.js', import.meta.url), 'utf8');
  const clientSource = fs.readFileSync(new URL('../src/worker-client.js', import.meta.url), 'utf8');
  // Comments explain the removal by name, so they are stripped first -- this
  // repo has been caught eleven times by a test failing on its own reason.
  const strip = text => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const [name, text] of [['local-engine.js', engineSource], ['worker-client.js', clientSource]]) {
    assert.doesNotMatch(strip(text), /googleapis|youtube\/v3/, `${name} must not reach a Google API about a video`);
  }
});
