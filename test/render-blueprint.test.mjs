import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

/**
 * render.yaml describes the LIVE service (v3.144.6).
 *
 * `deenclipped-ai` is Blueprint managed, so this file is not documentation —
 * a sync applies it. Until 7 Sept 2026 it described a service that had not
 * existed for months: runtime node against a Docker service, a 1GB disk named
 * deenclipped-metadata at /var/data against a 10GB deenclipped-data at
 * /app/data, and DATA_DIR pointed at that missing mount.
 *
 * DATA_DIR is the one that matters. The whole database is one state.json on
 * that disk, so pointing it at a mount that does not exist boots the app with
 * an empty one — every account, clip, connection and stored token gone from
 * its view.
 *
 * These assertions are read off the live service (Render API, 7 Sept 2026).
 */
const yaml = fs.readFileSync(new URL('../render.yaml', import.meta.url), 'utf8');
// COMMENTS STRIPPED FOR THE "must not contain" CHECKS. The header of that file
// QUOTES every wrong value it used to carry — "runtime: node", "qwen3:4b",
// "ffmpegapi" — so a doesNotMatch over the whole text fails on the explanation
// of the fix. Ninth time this repo has hit that shape: strip, never reword.
const settings = yaml.replace(/^\s*#.*$/gm, '');

function value(key) {
  const m = new RegExp(`- key: ${key}\\n\\s+value: (.+)`).exec(yaml);
  // YAML quotes numeric values ("7"), so strip them or every numeric
  // comparison in this file fails on the quotes rather than the number.
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

test('the runtime matches the live service', () => {
  assert.match(yaml, /runtime: docker/, 'the service is built from a Dockerfile');
  assert.match(yaml, /dockerfilePath: \.\/Dockerfile/);
  assert.doesNotMatch(settings, /runtime: node/, 'it was node, which is not what runs');
  assert.doesNotMatch(settings, /startCommand:/, 'a Docker service has no start command here');
  assert.ok(fs.existsSync(new URL('../Dockerfile', import.meta.url)), 'and that Dockerfile exists');
});

test('THE DISK AND DATA_DIR AGREE, and both match the live disk', () => {
  // The single most damaging line in this file. Read off the Render API:
  // disk deenclipped-data, mountPath /app/data, sizeGB 10.
  assert.match(yaml, /name: deenclipped-data/);
  assert.match(yaml, /mountPath: \/app\/data/);
  assert.match(yaml, /sizeGB: 10/);
  assert.equal(value('DATA_DIR'), '/app/data',
    'DATA_DIR must point at the disk that is actually mounted');
  const mount = /mountPath: (\S+)/.exec(yaml)[1];
  assert.equal(value('DATA_DIR'), mount, 'and they must be the same path, always');
});

test('no value in here is one the box would refuse', () => {
  // qwen3:4b is 2.5G against a 2G container cap — it OOM-kills, and dmesg on
  // the box has five of them. The model belongs to the box's own env anyway.
  assert.doesNotMatch(settings, /qwen3:4b/, 'the model that does not fit');
  // SocialKit / ffmpegapi was removed on 26 Aug 2026; the chain is yt-dlp.
  assert.doesNotMatch(settings, /ffmpegapi/, 'the removed import provider');
  assert.equal(value('VIDEO_IMPORT_PROVIDER'), 'ytdlp');
});

test('no secret is written into the repo', () => {
  // Every credential is `sync: false` — set in the dashboard, never here.
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'APP_SESSION_SECRET',
    'SOCIAL_TOKEN_KEY', 'WORKER_SHARED_SECRET', 'EMAIL_API_KEY',
    'OBJECT_STORAGE_SECRET_KEY', 'TIKTOK_CLIENT_SECRET', 'META_APP_SECRET',
    'GOOGLE_CLIENT_SECRET', 'TURNSTILE_SECRET']) {
    assert.match(yaml, new RegExp(`- key: ${key}\\n\\s+sync: false`), `${key} is not stored here`);
  }
  assert.doesNotMatch(settings, /sk_live|sk_test|whsec_|AKIA|-----BEGIN/, 'no credential shape anywhere');
});

test('the variables a customer would notice are declared', () => {
  // Not exhaustive — the dashboard holds ~96 — but these are the ones whose
  // absence breaks something a person would report: money, mail, the worker,
  // and the media domain (r2.dev is rate limited and must never reach a player).
  for (const key of ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'EMAIL_API_KEY',
    'EMAIL_FROM', 'WORKER_BASE_URL', 'WORKER_SHARED_SECRET', 'MEDIA_PUBLIC_BASE',
    'PUBLIC_BASE_URL', 'DATA_DIR', 'APP_SESSION_SECRET', 'SOCIAL_TOKEN_KEY']) {
    assert.match(yaml, new RegExp(`- key: ${key}\\n`), `${key} is described`);
  }
});

test('the trial length here agrees with the code', async () => {
  // Six places used to name it and they disagreed; this is a seventh, so it
  // reads the same number rather than adding another one to drift.
  const { default: pkg } = await import('../package.json', { with: { type: 'json' } });
  assert.ok(pkg.version, 'sanity');
  const config = fs.readFileSync(new URL('../src/config.js', import.meta.url), 'utf8');
  const dflt = /number\(process\.env\.STRIPE_TRIAL_DAYS, (\d+)\)/.exec(config);
  assert.ok(dflt, 'the code has a default');
  assert.equal(value('STRIPE_TRIAL_DAYS'), dflt[1],
    'the blueprint and the code must name the same trial length');
});
