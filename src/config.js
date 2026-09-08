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
// Was the variable actually SET, or is the default underneath it doing the
// talking? `number()` cannot answer that -- it folds an unset variable and a
// typed one into the same figure -- and for MAX_CONCURRENT_JOBS the two mean
// opposite things (see maxConcurrentJobsExplicit below). Empty counts as
// unset: a blank field in Render's variable list is an operator who never
// answered, and Number('') is 0, which would otherwise read as a deliberate
// instruction to run as few jobs as possible.
const numberWasSet = value => {
  const raw = String(value ?? '').trim();
  return raw !== '' && Number.isFinite(Number(raw));
};
const boolean = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

// The one version number, read from package.json so there is exactly one
// place to bump. Release rule: patch for fixes, minor for features -- and the
// number's whole job is to appear in the update announcements on the owner's
// feed, so "what changed?" has an answer that two people can say to each other.
let appVersion = '0.0.0';
try {
  appVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version || appVersion;
} catch { /* a missing manifest must not stop boot; the announcement just goes unversioned */ }

// The version at which worker/ LAST CHANGED, stamped by whoever changed it and
// enforced by scripts/check-version-bump.mjs. It is what decides whether a box
// is genuinely behind: appVersion moves several times a day without worker/
// moving at all, so comparing the box against THAT reports a stale worker on
// nearly every web deploy -- an alert nobody reads, and then the real one is
// missed too.
let workerRelease = '';
try {
  workerRelease = fs.readFileSync(path.join(root, 'worker', 'RELEASE'), 'utf8').trim();
} catch { /* absent means "unknown", which the checks read as nothing to say */ }

export const config = {
  appVersion,
  workerRelease,
  root,
  dataDir: process.env.DATA_DIR || path.join(root, 'data'),
  port: number(process.env.PORT, 3000),
  password: process.env.APP_PASSWORD || '',
  publicBaseUrl: (process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, ''),
  // Search Console / Bing verification, as env vars rather than a code change.
  // Both consoles accept a meta tag as proof of ownership, and doing it this
  // way means claiming the property is a variable on Render and a restart --
  // not a commit, a review and a deploy for a string that is not a secret.
  // Trimmed: a token pasted into a hosting panel picks up whitespace routinely,
  // and the resulting failure looks identical to the wrong token entirely.
  googleSiteVerification: String(process.env.GOOGLE_SITE_VERIFICATION || '').trim(),
  bingSiteVerification: String(process.env.BING_SITE_VERIFICATION || '').trim(),
  /*
   * Referral and affiliate economics, as configuration.
   *
   * Every default is OFF or ZERO, deliberately. The business rules are not
   * approved, and code that pays out by default pays out before anybody
   * decided to. Turning these on is a decision recorded in an environment
   * variable, which is where a decision about money belongs -- not in a
   * constant somebody changes while doing something else.
   */
  referralsEnabled: boolean(process.env.REFERRALS_ENABLED, true),
  // Source minutes granted to the person who was INVITED, at signup.
  referralBonusInvited: Math.max(0, number(process.env.REFERRAL_BONUS_INVITED, 0)),
  // Source minutes granted to the INVITER, when the invited account activates
  // -- processes a video and approves a clip. Never merely for signing up.
  referralBonusActivated: Math.max(0, number(process.env.REFERRAL_BONUS_ACTIVATED, 0)),
  /*
   * A further grant when the invited account first SUBSCRIBES. Once, ever.
   *
   * Set to 50 on 1 Sept 2026 by Youssef, who asked for a reward on the
   * inviter's side to sit beside the invited person's 30% off: "give me a
   * reasonable amount of tokens that they also receive once they've
   * subscribed to a plan."
   *
   * 50 is Youssef's call over the 100 first proposed here. Pro monthly is
   * A$29 for 650 tokens, so this is about 7.7% of a month -- roughly one more
   * lecture. Capped at three invites a link, the whole exposure is 150 tokens
   * per referrer against A$29/month recurring per conversion.
   *
   * This is the one default in this block that is deliberately non-zero, and
   * only because the decision was actually made. The env var still wins, so
   * it can be turned down or off without a deploy.
   */
  referralBonusPaid: Math.max(0, number(process.env.REFERRAL_BONUS_PAID, 50)),

  /*
   * The task ladder's rewards, in source minutes.
   *
   * Youssef, 3 Sept 2026, on the setup card: "add tasks like upload your first
   * 3 clips finish 1 week finish 1 month and etc and they can earn tokens with
   * it as well." That is the decision the zeroes above were waiting for, so
   * these ship non-zero -- but the amounts below are a PROPOSAL and the env
   * still wins, so they can be tuned without a deploy.
   *
   * REDUCED on Youssef's instruction the same day ("Reduce token reward"), from
   * 10/15/25/40/60. The old ladder was 150 tokens -- three times what a
   * REFERRAL pays for bringing a paying customer, which is the wrong ordering:
   * nothing a customer does alone should be worth more than delivering
   * somebody else's subscription.
   *
   * So the whole ladder is 45 now, deliberately under `referralBonusPaid` (50).
   * Pro monthly is A$29 for 650 tokens, so working all of it earns about 6.9%
   * of one month, spread over the thirty separate posting days the last rung
   * needs -- months of real use.
   *
   * The unit is 5, and that is not arbitrary: a lecture costs about a token a
   * minute, so 5 tokens is one five-minute run -- the exact size the product's
   * own first-run copy calls "plenty for a first run".
   *
   * It cannot be farmed. Every rung is keyed and granted once (billing's
   * processedBonusGrants refuses a repeat), importing a lecture COSTS more
   * than any rung pays, and the two largest rungs need ten posted clips across
   * thirty different days on a real connected channel. A throwaway account
   * cannot reach them.
   *
   * The first two rungs pay NOTHING deliberately: importing already spends
   * tokens and approving is one click. The ladder starts paying at the moment
   * something of the customer's actually shipped.
   */
  taskRewardsEnabled: boolean(process.env.TASK_REWARDS_ENABLED, true),
  taskRewardPublish: Math.max(0, number(process.env.TASK_REWARD_PUBLISH, 5)),
  taskRewardThree: Math.max(0, number(process.env.TASK_REWARD_THREE, 5)),
  taskRewardTen: Math.max(0, number(process.env.TASK_REWARD_TEN, 5)),
  taskRewardWeek: Math.max(0, number(process.env.TASK_REWARD_WEEK, 5)),
  taskRewardMonth: Math.max(0, number(process.env.TASK_REWARD_MONTH, 10)),
  // Coming back. Rebalanced rather than added on top: the eight paying rungs
  // still total 45, so widening the ladder did not quietly raise its price.
  taskRewardVisit3: Math.max(0, number(process.env.TASK_REWARD_VISIT3, 5)),
  taskRewardVisit7: Math.max(0, number(process.env.TASK_REWARD_VISIT7, 5)),
  taskRewardVisit30: Math.max(0, number(process.env.TASK_REWARD_VISIT30, 5)),

  /*
   * The invite discount.
   *
   * The percentage lives in STRIPE, not here: a Stripe coupon carries the
   * amount, the duration and whether it applies once or for several months,
   * and duplicating any of that in this file would let the two disagree about
   * what a customer was promised. This holds only the coupon's ID and the cap.
   *
   * Empty by default, which switches the whole thing off.
   */
  stripeReferralCoupon: String(process.env.STRIPE_REFERRAL_COUPON || '').trim(),
  // How many invited people one referrer's link can discount. Youssef,
  // 31 Aug 2026: "max 3 people".
  referralDiscountMaxUses: Math.max(0, number(process.env.REFERRAL_DISCOUNT_MAX_USES, 3)),

  /*
   * The two growth loops added 2 Sept 2026 (src/nudges.js, social.postCredit).
   *
   * Lifecycle nudges: one email per account per step it is stuck on -- never
   * imported, never reviewed, never connected, free days closing. Inert until
   * EMAIL_API_KEY is set, silenced per account by the bell's own toggle.
   *
   * The post credit: a free-plan post carries "Clipped with DeenClipped" and
   * the poster's OWN invite link in its caption, the watermark policy written
   * where platforms show text. Paid plans never carry it. Both default on
   * because both follow decisions already recorded; either flips off here
   * without a deploy.
   */
  nudgeEmailsEnabled: boolean(process.env.NUDGE_EMAILS, true),
  postCreditEnabled: boolean(process.env.POST_CREDIT, true),

  /*
   * Web Push -- notifications that arrive with the app closed (src/push.js).
   *
   * The keys are OPTIONAL on purpose. With none set the server generates a
   * pair once and keeps it in state.json, so push works on a fresh deployment
   * with nobody having to run a key generator first. Set them here only to pin
   * the identity somewhere more durable than the data directory -- and then
   * NEVER change them: every subscription in the wild is bound to the public
   * key it was created with, and a new pair silently invalidates all of them.
   *
   * The subject is a contact for the push service operator, and it must be a
   * mailto: or https: URL -- some services reject the request outright without
   * one, with a 400 that says nothing about why.
   */
  pushNotifsEnabled: boolean(process.env.PUSH_NOTIFS, true),
  // Cloudflare Turnstile — the "are you a robot" box on sign-up. Both are
  // trimmed: a credential pasted into Render's variable field picks up a
  // trailing newline routinely, and the resulting failure is indistinguishable
  // from the wrong key entirely. With neither set the check is INERT, so a
  // deployment that has not configured it signs people up exactly as before
  // rather than locking everybody out of a box that cannot render.
  turnstileSiteKey: String(process.env.TURNSTILE_SITE_KEY || '').trim(),
  turnstileSecret: String(process.env.TURNSTILE_SECRET || '').trim(),
  vapidPublicKey: (process.env.VAPID_PUBLIC_KEY || '').trim(),
  vapidPrivateKey: (process.env.VAPID_PRIVATE_KEY || '').trim(),
  vapidSubject: (process.env.VAPID_SUBJECT || 'mailto:support@deenclipped.online').trim(),

  // Affiliates are an application, not an open door: nobody is approved
  // automatically and no payout runs without a person deciding.
  //
  // ON by default as of v3.165.0, and that is a smaller decision than it looks
  // -- switching it on lets somebody APPLY and lets an approved affiliate
  // accrue a balance. It moves no money: a commission is only ever paid by an
  // operator creating a payout batch by hand. The "code that pays out by
  // default pays out before anybody decided to" rule (referrals.js) is about
  // automatic GRANTS, and there are none here.
  affiliatesEnabled: boolean(process.env.AFFILIATES_ENABLED, true),

  // THE NUMBERS ARE OPUSCLIP'S, deliberately (Youssef, 8 Sept 2026: "just kinda
  // look at Opus and see how they how they do it ... we'll kinda copy the exact
  // same thing because it's just affiliate"). Read off their published terms in
  // September 2026 and checked against the field: Pictory 20-50% recurring /
  // 90-day cookie, vidyo.ai up to 40% / 60-day, InVideo 50% monthly / 120-day,
  // Creatify 25-30% for 12 months / 30-day, Descript 15% one-off. 25% for
  // twelve months on a 60-day cookie is squarely the middle of that and is
  // exactly what the tool this product is compared with pays.
  affiliateCommissionPercent: Math.min(50, Math.max(0, number(process.env.AFFILIATE_COMMISSION_PERCENT, 25))),
  // How many months of a subscription earn commission, from that account's
  // FIRST paid invoice. 0 = first payment only.
  affiliateCommissionMonths: Math.max(0, number(process.env.AFFILIATE_COMMISSION_MONTHS, 12)),
  // Days a commission is held before it is payable, so a refund window closes
  // first. A commission paid before the refund window is a commission clawed
  // back from someone who has already spent it. 30 is OpusClip's; the hold is
  // only meaningful because `charge.refunded` and `charge.dispute.created` are
  // now watched and void a commission that is still inside it.
  affiliatePendingDays: Math.max(0, number(process.env.AFFILIATE_PENDING_DAYS, 30)),
  // Per CURRENCY, in minor units, and not an absolute wall -- the operator may
  // pay a smaller balance. It exists so a transfer does not cost more in fees
  // than it moves. A$20 against OpusClip's US$20; the field guidance is that a
  // threshold more than 30% of affiliates never reach is set too high, and at
  // 25% of A$29.99 this is three months of one referred subscriber.
  affiliateMinimumPayoutMinor: Math.max(0, number(process.env.AFFILIATE_MIN_PAYOUT_MINOR, 2000)),
  // The attribution window, in days. The `dc_ref` cookie carries it, so this is
  // also how long an invite link is remembered for the token referral -- one
  // cookie, one answer, and 60 days is the market's own (OpusClip, vidyo.ai).
  affiliateCookieDays: Math.max(1, number(process.env.AFFILIATE_COOKIE_DAYS, 60)),

  timezone: process.env.TIMEZONE || 'Australia/Perth',
  postTimes: (process.env.POST_TIMES || '07:00,12:00,17:00,20:30')
    .split(',').map(value => value.trim()).filter(Boolean),

  pythonBin: process.env.PYTHON_BIN || 'python3',
  workerScript: path.join(root, 'worker', 'clip_worker.py'),
  ffmpegPath: process.env.FFMPEG_PATH || 'ffmpeg',
  ffprobePath: process.env.FFPROBE_PATH || 'ffprobe',
  // The SELF-HOSTED fallback only, and that is a change from what this used to
  // be. The worker box puts its own CAPACITY choice into clip_worker's
  // environment and clip_worker now prefers that over the job payload, so on
  // the remote path this value is ignored -- the box picked 'medium' for
  // itself and was being overruled by this line in every job for a fortnight.
  // 'small' stays because it is the honest default for a self-hosted
  // deployment on hardware nobody has measured.
  aiModel: process.env.CLIP_AI_MODEL || 'small',
  aiDevice: process.env.CLIP_AI_DEVICE || 'auto',
  aiComputeType: process.env.CLIP_AI_COMPUTE_TYPE || 'int8',
  aiTask: process.env.CLIP_AI_TASK || 'transcribe',
  aiLanguage: process.env.CLIP_AI_LANGUAGE || '',
  // How many lectures the APP will have in flight. On the remote path this is
  // no longer the whole answer: the worker reports its own slot count in
  // /readiness's capabilities, and local-engine's concurrencyLimit() reads it
  // -- because the box is what actually has the cores, and a number typed here
  // once cannot know that the box was resized. Two of the box's three slots
  // were unreachable from this queue until it did.
  maxConcurrentJobs: Math.max(1, Math.round(number(process.env.MAX_CONCURRENT_JOBS, 1))),
  // Whether the figure above was TYPED or is just the default. An explicit
  // MAX_CONCURRENT_JOBS still wins and may only ever CAP the box's number,
  // never raise it: an operator who sets 1 is asking for one whatever the box
  // reports, and one who sets 8 against a 3-slot box gets 3, because the box
  // is authoritative for its own hardware. Unset means the app has no opinion
  // and the box's number stands alone. The default is baked into the line
  // above, so that distinction cannot be recovered from maxConcurrentJobs
  // afterwards and has to travel beside it.
  maxConcurrentJobsExplicit: numberWasSet(process.env.MAX_CONCURRENT_JOBS),
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

  // state.json is the whole database and nothing held a second copy of it.
  // On by default: a deployment that has somewhere to put a backup should be
  // taking one, not waiting to be told to.
  backupEnabled: boolean(process.env.BACKUP_ENABLED, true),
  backupIntervalHours: Math.max(1, Math.min(24, number(process.env.BACKUP_INTERVAL_HOURS, 4))),

  defaultTemplateId: process.env.DEFAULT_TEMPLATE_ID || 'clean-line',
  clipsPerVideo: Math.max(1, Math.round(number(process.env.CLIPS_PER_VIDEO, 8))),
  clipMinSeconds: Math.max(3, Math.round(number(process.env.CLIP_MIN_SECONDS, 20))),
  clipMaxSeconds: Math.max(5, Math.round(number(process.env.CLIP_MAX_SECONDS, 90))),
  musicVolumePercent: Math.max(1, Math.min(50, Math.round(number(process.env.MUSIC_VOLUME_PERCENT, 13)))),

  ollamaUrl: (process.env.OLLAMA_URL || '').replace(/\/+$/, ''),
  // The SELF-HOSTED fallback only. This comment used to end "this value is
  // sent to the worker in the job settings and wins over the worker's own
  // default, so raising the box means raising it here too" -- that stopped
  // being true when clip_worker learned to prefer OLLAMA_MODEL from its own
  // environment, and a stale claim of exactly that kind is what hid the
  // whisper-model bug for a fortnight. The box sets its own model now; raising
  // the box means raising it ON the box.
  // The value itself is unchanged, and is the honest default for a self-hosted
  // deployment on unknown hardware: qwen3:4b measures 2.4-3.0G resident and
  // was OOM-killed 42 times on the 3.7G box, taking the whole machine with it
  // because the kills were global rather than per-container.
  ollamaModel: process.env.OLLAMA_MODEL || 'qwen3:1.7b',

  /*
   * DeenAI V2's primary model.
   *
   * The strategist is a hosted Claude model; the box's qwen3:1.7b stays as a
   * clearly-labelled limited fallback and nothing more. That is a change of
   * posture and it is deliberate: TRANSCRIPTS still never leave the server
   * (the worker transcribes, scores and titles locally, exactly as before),
   * and what goes to this model is the account's own COMPUTED figures plus
   * whatever text the person deliberately attaches to a conversation.
   * `deenai-chat.js` states that boundary and a test drives it.
   *
   * Trimmed, like every other credential read here: a key pasted into
   * Render's variable field picks up a trailing newline routinely, and the
   * resulting 401 is indistinguishable from a wrong key.
   */
  anthropicApiKey: String(process.env.ANTHROPIC_API_KEY || '').trim(),
  anthropicBaseUrl: String(process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').trim().replace(/\/+$/, ''),
  deenaiModel: String(process.env.DEENAI_MODEL || 'claude-sonnet-5').trim(),
  // Medium effort, per the brief. Sent as the thinking budget where the model
  // supports it; ignored where it does not.
  deenaiEffort: String(process.env.DEENAI_EFFORT || 'medium').trim().toLowerCase(),
  deenaiMaxTokens: Math.max(256, Math.min(8000, Math.round(number(process.env.DEENAI_MAX_TOKENS, 2000)))),
  // A whole conversation turn, tool round trips included. Under the browser's
  // own patience and well under any proxy's -- an answer nobody receives is
  // the single Ollama slot spent for nothing, the fault v3.143.2 fixed on the
  // worker side.
  deenaiBudgetMs: Math.max(10_000, Math.min(180_000, Math.round(number(process.env.DEENAI_BUDGET_MS, 75_000)))),
  deenaiMaxToolRounds: Math.max(1, Math.min(12, Math.round(number(process.env.DEENAI_MAX_TOOL_ROUNDS, 6)))),

  socialTokenKey: process.env.SOCIAL_TOKEN_KEY || '',
  socialPublishEnabled: boolean(process.env.SOCIAL_PUBLISH_ENABLED, true),
  socialMaxAttempts: Math.max(1, Math.round(number(process.env.SOCIAL_MAX_ATTEMPTS, 5))),
  socialPollIntervalMs: Math.max(5_000, Math.round(number(process.env.SOCIAL_POLL_INTERVAL_MS, 15_000))),
  socialProcessingTimeoutMs: Math.max(10 * 60_000, Math.round(number(process.env.SOCIAL_PROCESSING_TIMEOUT_MS, 2 * 60 * 60_000))),
  socialMediaUrlTtlMs: Math.max(60 * 60_000, Math.round(number(process.env.SOCIAL_MEDIA_URL_TTL_MS, 24 * 60 * 60_000))),


  // Defaults to ON. It used to be derived from whether sign-in credentials
  // happened to be configured, so if those variables ever went missing at once
  // -- a botched rotation, a wiped environment group -- the app would come back
  // up with authentication silently switched off and serve the owner account to
  // anyone. Turning it off is now something you have to say out loud.
  authRequired: boolean(process.env.AUTH_REQUIRED, true),
  emailSigninEnabled: boolean(process.env.EMAIL_SIGNIN_ENABLED, true),
  // Transactional email. Without a key and a from-address nothing is sent and
  // address verification stays off, so an unconfigured deployment behaves
  // exactly as it did rather than locking its owner out waiting for a mail.
  emailProvider: (process.env.EMAIL_PROVIDER || 'resend').toLowerCase(),
  emailApiKey: process.env.EMAIL_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || '',
  // APP_SESSION_SECRET is deliberately NOT read into config any more. Nothing
  // ever consumed it: sessions are opaque 36-byte random tokens, stored server
  // side as SHA-256 hashes and validated by lookup in auth.js sessionUser().
  // They are never signed, so there was no secret to get wrong -- and the
  // guards that refused to start on a "short session secret" were protecting a
  // value no code path reads. Keeping them would have gone on telling the
  // operator that rotating it hardened something.
  supportEmail: process.env.SUPPORT_EMAIL || 'support@deenclipped.online',
  adminEmail: process.env.ADMIN_EMAIL || 'admin@deenclipped.local',
  // Accounts that get operator (admin) access when they sign in, whatever
  // provider they arrive through. Exists because production disables the
  // admin-password fallback, which made the bootstrap owner unreachable and
  // left no living account able to open an operator page. The default is the
  // operator's own address so a fresh deploy is administrable at all.
  // A push channel that needs no account: any string here becomes a topic on
  // ntfy.sh, and every alert is POSTed to it alongside (or instead of) email.
  // Email needs a provider key the deployment did not have, which left every
  // alert silently unsent -- the exact "limiter not crossed by a route" shape.
  alertNtfyTopic: String(process.env.ALERT_NTFY_TOPIC || '').trim(),
  // The business FEED (signups, jobs, sales, daily pulse) -- a separate topic
  // from the alarms above, so routine activity never trains the owner to
  // swipe away the channel that carries real fires.
  activityNtfyTopic: String(process.env.ACTIVITY_NTFY_TOPIC || '').trim(),
  operatorEmails: String(process.env.OPERATOR_EMAILS ?? 'youssefchannaoui05@gmail.com')
    .split(',').map(entry => entry.trim().toLowerCase()).filter(Boolean),
  adminName: process.env.ADMIN_NAME || 'DeenClipped Admin',

  googleSigninClientId: String(process.env.GOOGLE_SIGNIN_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleSigninClientSecret: String(process.env.GOOGLE_SIGNIN_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  googleSigninRedirectUri: process.env.GOOGLE_SIGNIN_REDIRECT_URI || '',

  appleSigninClientId: String(process.env.APPLE_SIGNIN_CLIENT_ID || '').trim(),
  appleSigninTeamId: process.env.APPLE_SIGNIN_TEAM_ID || '',
  appleSigninKeyId: process.env.APPLE_SIGNIN_KEY_ID || '',
  appleSigninPrivateKey: (process.env.APPLE_SIGNIN_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  appleSigninRedirectUri: process.env.APPLE_SIGNIN_REDIRECT_URI || '',

  googleClientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(),
  googleClientSecret: String(process.env.GOOGLE_CLIENT_SECRET || '').trim(),
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

  metaAppId: String(process.env.META_APP_ID || '').trim(),
  metaAppSecret: String(process.env.META_APP_SECRET || '').trim(),
  metaLoginConfigId: String(process.env.META_LOGIN_CONFIG_ID || '').trim(),
  metaRedirectUri: process.env.META_REDIRECT_URI || '',
  metaGraphVersion: process.env.META_GRAPH_VERSION || 'v23.0',
  metaGraphBase: (process.env.META_GRAPH_BASE || 'https://graph.facebook.com').replace(/\/+$/, ''),
  metaDialogBase: (process.env.META_DIALOG_BASE || 'https://www.facebook.com').replace(/\/+$/, ''),

  /*
   * INSTAGRAM LOGIN -- a SECOND way to connect Instagram, and the one most
   * people can actually use.
   *
   * Youssef, 8 Sept 2026: "whenever I log in to Instagram, it gives me Meta,
   * and some people don't have Meta connected with Facebook ... make it a bit
   * easier so people can log in with either one."
   *
   * He is describing a real requirement of the path this app has always used.
   * Facebook Login + `instagram_content_publish` reaches an Instagram account
   * ONLY through a Facebook Page it is linked to, so a creator with a
   * professional Instagram and no Page -- or no Facebook at all -- cannot
   * connect however many times they try.
   *
   * Meta's "Instagram API with Instagram Login" authorises the Instagram
   * account DIRECTLY (www.instagram.com/oauth/authorize) and publishes through
   * graph.instagram.com with no Page in the chain. It is a different app id
   * and secret from the Facebook one: in the Meta dashboard it is the
   * Instagram product's own "Instagram app ID" and "Instagram app secret".
   *
   * INERT WITHOUT THEM. With these unset the Instagram row behaves exactly as
   * it does today and connects through Meta -- the same shape as Turnstile and
   * Stripe, so an unconfigured deployment loses nothing.
   */
  instagramClientId: String(process.env.INSTAGRAM_CLIENT_ID || '').trim(),
  instagramClientSecret: String(process.env.INSTAGRAM_CLIENT_SECRET || '').trim(),
  instagramRedirectUri: process.env.INSTAGRAM_REDIRECT_URI || '',
  // Three different hosts, and they are not interchangeable: the dialog lives
  // on www, the code exchange on api, everything afterwards on graph.
  instagramAuthBase: (process.env.INSTAGRAM_AUTH_BASE || 'https://www.instagram.com').replace(/\/+$/, ''),
  instagramApiBase: (process.env.INSTAGRAM_API_BASE || 'https://api.instagram.com').replace(/\/+$/, ''),
  instagramGraphBase: (process.env.INSTAGRAM_GRAPH_BASE || 'https://graph.instagram.com').replace(/\/+$/, ''),

  // Trimmed, like Stripe's and Turnstile's above, and for the same reason --
  // this repo has now paid for that lesson three times. A credential pasted
  // into Render's variable field picks up a trailing newline routinely, and
  // NOTHING about the resulting failure says so: the token exchange comes back
  // as a TikTok API error indistinguishable from having copied the wrong
  // secret entirely, right after a swap, which is exactly when you would
  // believe it. Whitespace around a credential is never meaningful.
  tiktokClientKey: String(process.env.TIKTOK_CLIENT_KEY || '').trim(),
  tiktokClientSecret: String(process.env.TIKTOK_CLIENT_SECRET || '').trim(),

  stripeEnabled: boolean(process.env.STRIPE_ENABLED, Boolean(process.env.STRIPE_SECRET_KEY)),
  // Trimmed, both of them. A secret pasted into Render's variable field picks
  // up a trailing newline or space more often than anyone admits, and neither
  // failure says so: the webhook secret produces "Invalid Stripe signature" on
  // every delivery -- indistinguishable from having copied the wrong endpoint's
  // secret -- and the API key produces a 401 the app reports as Stripe being
  // down. Whitespace around a credential is never meaningful.
  stripeSecretKey: String(process.env.STRIPE_SECRET_KEY || '').trim(),
  stripeWebhookSecret: String(process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  // Pro's three billing periods. The env names have no tier in them because
  // these three existed before Studio did and are live in Stripe -- renaming
  // them would silently unconfigure the plan every current subscriber is on.
  stripePriceWeekly: process.env.STRIPE_PRICE_WEEKLY || '',
  stripePriceMonthly: process.env.STRIPE_PRICE_MONTHLY || '',
  stripePriceYearly: process.env.STRIPE_PRICE_YEARLY || '',
  // Studio's three. Absent, the Studio column still renders and says it is not
  // open yet rather than offering a button that cannot charge anyone.
  stripePriceStudioWeekly: process.env.STRIPE_PRICE_STUDIO_WEEKLY || '',
  stripePriceStudioMonthly: process.env.STRIPE_PRICE_STUDIO_MONTHLY || '',
  stripePriceStudioYearly: process.env.STRIPE_PRICE_STUDIO_YEARLY || '',
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
  //   studio wk A$19  / 300   = A$0.063 per token
  //   studio mo A$59  / 1600  = A$0.037 per token
  //   studio yr A$590 / 22000 = A$0.027 per token   (two months free)
  planPriceWeeklyLabel: process.env.PLAN_PRICE_WEEKLY_LABEL || 'A$9',
  planPriceMonthlyLabel: process.env.PLAN_PRICE_MONTHLY_LABEL || 'A$29',
  planPriceYearlyLabel: process.env.PLAN_PRICE_YEARLY_LABEL || 'A$290',
  planPriceStudioWeeklyLabel: process.env.PLAN_PRICE_STUDIO_WEEKLY_LABEL || 'A$19',
  planPriceStudioMonthlyLabel: process.env.PLAN_PRICE_STUDIO_MONTHLY_LABEL || 'A$59',
  planPriceStudioYearlyLabel: process.env.PLAN_PRICE_STUDIO_YEARLY_LABEL || 'A$590',
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
  tokensStudioWeekly: Math.max(1, Math.round(number(process.env.TOKENS_STUDIO_WEEKLY, 300))),
  tokensStudioMonthly: Math.max(1, Math.round(number(process.env.TOKENS_STUDIO_MONTHLY, 1600))),
  tokensStudioYearly: Math.max(1, Math.round(number(process.env.TOKENS_STUDIO_YEARLY, 22000))),
  // Studio's extra posting windows. Everyone gets POST_TIMES; Studio may fill
  // this many slots a day instead. A number, not a second list of times: the
  // schedule spreads them across the day itself.
  postSlotsStudio: Math.max(1, Math.round(number(process.env.POST_SLOTS_STUDIO, 8))),
  // A trial hands out real machine time: every token is a source minute that
  // costs proxy bandwidth and storage. Uncapped, a yearly trial grants its
  // whole 6000-minute allowance for free, which is more bandwidth than the
  // proxy plan sells in a month. 0 disables the cap.
  tokensTrial: Math.max(0, Math.round(number(process.env.TOKENS_TRIAL, 40))),
  /*
   * What an access code hands over, and it is deliberately generous: a full
   * Pro MONTH of tokens inside a fortnight. A tester who runs out on day four
   * has not tested anything, and the whole point of the code is to find out
   * what the product does in somebody else's hands. Per-code values override
   * these; they are only the defaults the owner's form starts from.
   */
  accessCodeDays: Math.max(1, Math.round(number(process.env.ACCESS_CODE_DAYS, 14))),
  accessCodeTokens: Math.max(1, Math.round(number(process.env.ACCESS_CODE_TOKENS, 650))),
  tokensPerMinute: Math.max(0.1, number(process.env.TOKENS_PER_MINUTE, 1)),
  minimumTokensToStart: Math.max(1, Math.round(number(process.env.MINIMUM_TOKENS_TO_START, 10))),
  tiktokRedirectUri: process.env.TIKTOK_REDIRECT_URI || '',
  tiktokAuthBase: (process.env.TIKTOK_AUTH_BASE || 'https://www.tiktok.com').replace(/\/+$/, ''),
  tiktokApiBase: (process.env.TIKTOK_API_BASE || 'https://open.tiktokapis.com').replace(/\/+$/, ''),
  // Public CDN base for rendered media. R2's pub-*.r2.dev endpoint is a
  // development URL: Cloudflare rate-limits it (we measured five straight GET
  // 503s in one editor session) and it sends no CORS headers. When this is
  // set to a custom domain bound to the same bucket, every stored r2.dev URL
  // is rewritten to it at the moment it leaves the server.
  mediaPublicBase: (process.env.MEDIA_PUBLIC_BASE || '').replace(/\/+$/, ''),
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

/**
 * The subset that means "this deployment is not safe to serve", as opposed to
 * "this deployment is missing a feature". These stop the process; the rest only
 * fail /readyz.
 *
 * The session-secret fallback chain reaches APP_PASSWORD, which was four
 * characters on a public domain -- and the startup warning only ever caught the
 * literal dev default, so a short real value passed in silence and cookies
 * signed with it could be forged instantly. A misconfigured instance used to
 * keep answering while its health check went red.
 */
export function fatalConfigurationErrors() {
  const errors = [];
  const live = config.publicBaseUrl.startsWith('https://');
  if (!live) return errors;
  if (!config.authRequired) {
    errors.push('AUTH_REQUIRED is off on a public deployment. Refusing to start: this would serve the owner account to anyone.');
  }
  if (config.password && config.password.length < 12) {
    errors.push('APP_PASSWORD is shorter than 12 characters. Refusing to start: it is a live credential on a public domain.');
  }
  return errors;
}

export function productionConfigurationErrors() {
  const errors = [];
  if (!config.authRequired) errors.push('AUTH_REQUIRED must be enabled.');
  if (config.password && config.password.length < 12) errors.push('APP_PASSWORD must contain at least 12 characters when the admin password fallback is enabled.');
  if (config.socialPublishEnabled && (!config.socialTokenKey || config.socialTokenKey.length < 32)) errors.push('SOCIAL_TOKEN_KEY must contain at least 32 characters when social publishing is enabled.');
  if (config.processingMode === 'remote') {
    if (!config.workerBaseUrl) errors.push('WORKER_BASE_URL is required for remote processing.');
    if (!config.workerSharedSecret || config.workerSharedSecret.length < 32) errors.push('WORKER_SHARED_SECRET must contain at least 32 characters.');
    if (!config.workerCallbackSecret || config.workerCallbackSecret.length < 32) errors.push('WORKER_CALLBACK_SECRET must contain at least 32 characters.');
    if (!config.objectStorageEndpoint || !config.objectStorageBucket || !config.objectStorageAccessKey || !config.objectStorageSecretKey) errors.push('Object storage credentials are required for remote processing.');
  }
  if (config.stripeEnabled) {
    if (!config.stripeSecretKey) errors.push('STRIPE_SECRET_KEY is required when Stripe is enabled.');
    if (!config.stripeWebhookSecret) errors.push('STRIPE_WEBHOOK_SECRET is required when Stripe is enabled.');
    if (!config.stripePriceWeekly || !config.stripePriceMonthly || !config.stripePriceYearly) errors.push('All subscription Stripe price IDs are required when Stripe is enabled.');
    if (!config.stripePriceTopup100 || !config.stripePriceTopup300 || !config.stripePriceTopup750) errors.push('All token top-up Stripe price IDs are required when Stripe is enabled.');
  }
  return errors;
}

if (!config.password) {
  console.warn('[warn] APP_PASSWORD is not set. Anyone with the link can use the app if AUTH_REQUIRED is disabled.');
}
