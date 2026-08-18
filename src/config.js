import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const number = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const boolean = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

export const config = {
  root,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  port: number(process.env.PORT, 3000),
  password: process.env.APP_PASSWORD || '',
  publicBaseUrl: (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  timezone: process.env.TIMEZONE || 'Australia/Perth',
  postTimes: (process.env.POST_TIMES || '07:00,12:00,17:00,20:30')
    .split(',').map(value => value.trim()).filter(Boolean),

  pythonBin: process.env.PYTHON_BIN || 'python3',
  workerScript: path.join(root, 'worker', 'clip_worker.py'),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  aiModel: process.env.CLIP_AI_MODEL || 'small',
  aiDevice: process.env.CLIP_AI_DEVICE || 'auto',
  aiComputeType: process.env.CLIP_AI_COMPUTE_TYPE || 'int8',
  aiTask: process.env.CLIP_AI_TASK || 'transcribe',
  aiLanguage: process.env.CLIP_AI_LANGUAGE || '',
  maxConcurrentJobs: Math.max(1, Math.round(number(process.env.MAX_CONCURRENT_JOBS, 1))),
  maxSourceMinutes: Math.max(5, number(process.env.MAX_SOURCE_MINUTES, 180)),
  maxVideoUploadBytes: Math.max(50, number(process.env.MAX_VIDEO_UPLOAD_MB, 2048)) * 1024 * 1024,
  keepSourceFiles: boolean(process.env.KEEP_SOURCE_FILES, true),

  processingMode: String(process.env.PROCESSING_MODE || (process.env.WORKER_BASE_URL ? 'remote' : 'local')).toLowerCase(),
  workerBaseUrl: (process.env.WORKER_BASE_URL || '').replace(/\/+$/, ''),
  workerSharedSecret: process.env.WORKER_SHARED_SECRET || '',
  workerRequestTimeoutMs: Math.max(5_000, Math.round(number(process.env.WORKER_REQUEST_TIMEOUT_MS, 30_000))),
  workerPollIntervalMs: Math.max(1_000, Math.round(number(process.env.WORKER_POLL_INTERVAL_MS, 5_000))),
  workerJobTimeoutMs: Math.max(10 * 60_000, Math.round(number(process.env.WORKER_JOB_TIMEOUT_MS, 6 * 60 * 60_000))),
  workerCallbackSecret: process.env.WORKER_CALLBACK_SECRET || process.env.WORKER_SHARED_SECRET || '',

  videoImportProvider: String(process.env.VIDEO_IMPORT_PROVIDER || 'ffmpegapi').toLowerCase(),
  videoImportApiUrl: (process.env.VIDEO_IMPORT_API_URL || 'https://ffmpegapi.net').replace(/\/+$/, ''),
  videoImportApiKey: process.env.VIDEO_IMPORT_API_KEY || '',
  videoImportPollIntervalMs: Math.max(1_000, Math.round(number(process.env.VIDEO_IMPORT_POLL_INTERVAL_MS, 5_000))),
  videoImportTimeoutMs: Math.max(60_000, Math.round(number(process.env.VIDEO_IMPORT_TIMEOUT_MS, 1_800_000))),

  objectStorageEndpoint: (process.env.OBJECT_STORAGE_ENDPOINT || '').replace(/\/+$/, ''),
  objectStorageRegion: process.env.OBJECT_STORAGE_REGION || 'auto',
  objectStorageBucket: process.env.OBJECT_STORAGE_BUCKET || '',
  objectStorageAccessKey: process.env.OBJECT_STORAGE_ACCESS_KEY || '',
  objectStorageSecretKey: process.env.OBJECT_STORAGE_SECRET_KEY || '',
  objectStoragePublicUrl: (process.env.OBJECT_STORAGE_PUBLIC_URL || '').replace(/\/+$/, ''),

  defaultTemplateId: process.env.DEFAULT_TEMPLATE_ID || 'deenclipped-gold',
  clipsPerVideo: Math.max(1, Math.round(number(process.env.CLIPS_PER_VIDEO, 8))),
  clipMinSeconds: Math.max(3, Math.round(number(process.env.CLIP_MIN_SECONDS, 20))),
  clipMaxSeconds: Math.max(5, Math.round(number(process.env.CLIP_MAX_SECONDS, 90))),
  musicVolumePercent: Math.max(1, Math.min(50, Math.round(number(process.env.MUSIC_VOLUME_PERCENT, 13)))),

  ollamaUrl: (process.env.OLLAMA_URL || '').replace(/\/+$/, ''),
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:4b',

  socialTokenKey: process.env.SOCIAL_TOKEN_KEY || '',
  socialPublishEnabled: boolean(process.env.SOCIAL_PUBLISH_ENABLED, true),
  socialMaxAttempts: Math.max(1, Math.round(number(process.env.SOCIAL_MAX_ATTEMPTS, 5))),
  socialPollIntervalMs: Math.max(5_000, Math.round(number(process.env.SOCIAL_POLL_INTERVAL_MS, 15_000))),
  socialProcessingTimeoutMs: Math.max(10 * 60_000, Math.round(number(process.env.SOCIAL_PROCESSING_TIMEOUT_MS, 2 * 60 * 60_000))),
  socialMediaUrlTtlMs: Math.max(60 * 60_000, Math.round(number(process.env.SOCIAL_MEDIA_URL_TTL_MS, 24 * 60 * 60_000))),


  authRequired: boolean(process.env.AUTH_REQUIRED, Boolean(process.env.GOOGLE_SIGNIN_CLIENT_ID || process.env.APPLE_SIGNIN_CLIENT_ID || process.env.APP_PASSWORD)),
  emailSigninEnabled: boolean(process.env.EMAIL_SIGNIN_ENABLED, true),
  sessionSecret: process.env.APP_SESSION_SECRET || process.env.SOCIAL_TOKEN_KEY || process.env.APP_PASSWORD || 'dev-session-secret-change-me',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@deenclipped.local',
  // Accounts that get operator (admin) access when they sign in, whatever
  // provider they arrive through. Exists because production disables the
  // admin-password fallback, which made the bootstrap owner unreachable and
  // left no living account able to open an operator page. The default is the
  // operator's own address so a fresh deploy is administrable at all.
  operatorEmails: String(process.env.OPERATOR_EMAILS ?? 'youssefchannaoui05@gmail.com')
    .split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean),
  adminName: process.env.ADMIN_NAME || 'DeenClipped Admin',

  googleSigninClientId: process.env.GOOGLE_SIGNIN_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
  googleSigninClientSecret: process.env.GOOGLE_SIGNIN_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
  googleSigninRedirectUri: process.env.GOOGLE_SIGNIN_REDIRECT_URI || '',

  appleSigninClientId: process.env.APPLE_SIGNIN_CLIENT_ID || '',
  appleSigninTeamId: process.env.APPLE_SIGNIN_TEAM_ID || '',
  appleSigninKeyId: process.env.APPLE_SIGNIN_KEY_ID || '',
  appleSigninPrivateKey: (process.env.APPLE_SIGNIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  appleSigninRedirectUri: process.env.APPLE_SIGNIN_REDIRECT_URI || '',

  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || '',
  googleAuthBase: (process.env.GOOGLE_AUTH_BASE || 'https://accounts.google.com').replace(/\/+$/, ''),
  googleTokenUrl: process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
  googleRevokeUrl: process.env.GOOGLE_REVOKE_URL || 'https://oauth2.googleapis.com/revoke',
  youtubeApiBase: (process.env.YOUTUBE_API_BASE || 'https://www.googleapis.com').replace(/\/+$/, ''),
  youtubeDataApiKey: process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_YOUTUBE_API_KEY || '',

  vizardApiKey: process.env.VIZARD_API_KEY || '',
  vizardApiBase: (process.env.VIZARD_API_BASE_URL || 'https://elb-api.vizard.ai/hvizard-server-front/open-api/v1').replace(/\/+$/, ''),
  vizardPollIntervalMs: Math.max(5_000, Math.round(number(process.env.VIZARD_POLL_INTERVAL_MS, 30_000))),
  vizardProcessingTimeoutMs: Math.max(10 * 60_000, Math.round(number(process.env.VIZARD_PROCESSING_TIMEOUT_MS, 90 * 60_000))),
  vizardMaxClips: Math.max(1, Math.min(100, Math.round(number(process.env.VIZARD_MAX_CLIPS, 8)))),
  vizardClipModel: ['clip_v1', 'clip_v2'].includes(process.env.VIZARD_CLIP_MODEL) ? process.env.VIZARD_CLIP_MODEL : 'clip_v1',

  metaAppId: process.env.META_APP_ID || '',
  metaAppSecret: process.env.META_APP_SECRET || '',
  metaRedirectUri: process.env.META_REDIRECT_URI || '',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
  metaGraphBase: (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, ''),
  metaDialogBase: (process.env.META_DIALOG_BASE || 'https://www.facebook.com').replace(/\/+$/, ''),

  tiktokClientKey: process.env.TIKTOK_CLIENT_KEY || '',
  tiktokClientSecret: process.env.TIKTOK_CLIENT_SECRET || '',

  stripeEnabled: boolean(process.env.STRIPE_ENABLED, Boolean(process.env.STRIPE_SECRET_KEY)),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
  stripePriceWeekly: process.env.STRIPE_PRICE_WEEKLY || '',
  stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY || '',
  stripePriceYearly: process.env.STRIPE_PRICE_YEARLY || '',
  stripePriceTopup100: process.env.STRIPE_PRICE_TOPUP_100 || '',
  stripePriceTopup300: process.env.STRIPE_PRICE_TOPUP_300 || '',
  stripePriceTopup750: process.env.STRIPE_PRICE_TOPUP_750 || '',
  // Prices, in AUD. These are labels only -- Stripe holds the real amounts, and
  // these must be kept equal to them or the dashboard advertises one price and
  // charges another.
  //
  // A token is one minute of source video, the same unit Opus Clip and Vizard
  // bill in, so the comparison below is like for like. Opus charges about
  // A$0.15/minute on both its paid tiers; these sit at a third of that, which
  // the self-hosted Whisper and Ollama make affordable -- a competitor paying
  // per minute for someone else's API cannot follow the price down.
  //
  //   weekly    A$9   / 120   = A$0.075 per token
  //   monthly   A$29  / 650   = A$0.045 per token
  //   yearly    A$290 / 9000  = A$0.032 per token   (two months free)
  planPriceWeeklyLabel: process.env.PLAN_PRICE_WEEKLY_LABEL || 'A$9',
  planPriceMonthlyLabel: process.env.PLAN_PRICE_MONTHLY_LABEL || 'A$29',
  planPriceYearlyLabel: process.env.PLAN_PRICE_YEARLY_LABEL || 'A$290',
  // Top-ups are for running out mid-month, so every pack costs MORE per token
  // than the monthly plan. They used to cost less -- the 750 pack worked out at
  // A$0.033 against the plan's A$0.045 -- which rewarded cancelling the
  // subscription and buying packs instead.
  //
  //   100  A$6.99  = A$0.070 per token
  //   300  A$17.99 = A$0.060 per token
  //   750  A$39.99 = A$0.053 per token
  topupPrice100Label: process.env.TOPUP_PRICE_100_LABEL || 'A$6.99',
  topupPrice300Label: process.env.TOPUP_PRICE_300_LABEL || 'A$17.99',
  topupPrice750Label: process.env.TOPUP_PRICE_750_LABEL || 'A$39.99',
  stripeTrialDays: Math.max(0, Math.round(number(process.env.STRIPE_TRIAL_DAYS, 7))),
  tokensFree: Math.max(0, Math.round(number(process.env.TOKENS_FREE, 40))),
  tokensWeekly: Math.max(1, Math.round(number(process.env.TOKENS_WEEKLY, 120))),
  tokensMonthly: Math.max(1, Math.round(number(process.env.TOKENS_MONTHLY, 650))),
  tokensYearly: Math.max(1, Math.round(number(process.env.TOKENS_YEARLY, 9000))),
  tokensPerMinute: Math.max(0.1, number(process.env.TOKENS_PER_MINUTE, 1)),
  minimumTokensToStart: Math.max(1, Math.round(number(process.env.MINIMUM_TOKENS_TO_START, 10))),
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI || '',
  tiktokAuthBase: (process.env.TIKTOK_AUTH_BASE || 'https://www.tiktok.com').replace(/\/+$/, ''),
  tiktokApiBase: (process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com').replace(/\/+$/, ''),
};

for (const dir of [
  config.dataDir,
  path.join(config.dataDir, 'jobs'),
  path.join(config.dataDir, 'sources'),
  path.join(config.dataDir, 'clips'),
  path.join(config.dataDir, 'music'),
]) {
  fs.mkdirSync(dir, { recursive: true });
}

if (!config.password) {
  console.warn('[warn] APP_PASSWORD is not set. Anyone with the link can use the app if AUTH_REQUIRED is disabled.');
}
if (config.authRequired && config.sessionSecret === 'dev-session-secret-change-me') {
  console.warn('[warn] APP_SESSION_SECRET is not set. Set a long random secret before public launch.');
}
