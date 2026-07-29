import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

// Minimal .env reader so there's no extra dependency.
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const bool = (v, fallback) => (v === undefined || v === '' ? fallback : /^(1|true|yes)$/i.test(v));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

export const config = {
  root,
  dataDir: path.join(root, 'data'),
  port: num(process.env.PORT, 3000),
  password: process.env.APP_PASSWORD || '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, ''),

  opusKey: process.env.OPUS_API_KEY || '',
  opusOrgId: process.env.OPUS_ORG_ID || '',
  brandTemplateId: process.env.OPUS_BRAND_TEMPLATE_ID || '',

  postTimes: (process.env.POST_TIMES || '07:00,12:00,17:00,20:30')
    .split(',').map(s => s.trim()).filter(Boolean),
  timezone: process.env.TIMEZONE || 'Australia/Perth',

  // 0 means "keep every clip Opus returns" — this used to default to 4 and
  // quietly discard the rest, which was never the intent.
  clipsPerVideo: num(process.env.CLIPS_PER_VIDEO, 0),
  clipMinSeconds: num(process.env.CLIP_MIN_SECONDS, 20),
  clipMaxSeconds: num(process.env.CLIP_MAX_SECONDS, 90),
  autoApprove: bool(process.env.AUTO_APPROVE, false),

  copyPrompt: process.env.COPY_PROMPT
    || 'Write a plain, respectful caption for a short Islamic reminder. No hype, no clickbait, no emojis. Never paraphrase or invent Quran or hadith wording. If a source is unclear, describe the topic only.',
};

if (!config.password) {
  console.warn('[warn] APP_PASSWORD is not set — anyone with the link can use this app.');
}
