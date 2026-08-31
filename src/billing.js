import crypto from 'node:crypto';
import * as auth from './auth.js';
import { config } from './config.js';
import * as ownerFeed from './owner-feed.js';
import * as metrics from './metrics.js';
import * as referrals from './referrals.js';
import { state, save, log } from './store.js';

const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const secondsToMs = value => Math.max(0, Number(value || 0) * 1000);
const cleanEmail = value => String(value || '').trim().toLowerCase();

/**
 * Three tiers, each sold at three billing periods.
 *
 * What was here before called weekly/monthly/yearly "plans", which made a
 * BILLING PERIOD look like a product tier: there was one paid tier sold three
 * ways. Tiers and periods are separate axes now, and the plan id carries both
 * (`pro_monthly`, `studio_yearly`).
 *
 * The three original ids are still accepted everywhere and mean Pro at that
 * period -- `normalisePlanId` maps them. Every live subscriber is on one of
 * them, stored on their record and inside Stripe's own metadata, so dropping
 * them would move paying customers onto the free plan on the next webhook.
 */
/**
 * How long a plan's period runs.
 *
 * Takes a PLAN ID, which now carries its tier: 'pro_weekly', not 'weekly'.
 * Reading it as a bare interval would quietly give every weekly subscriber a
 * 30-day period -- the fallback, not an error.
 */
function periodMs(planId) {
  const id = String(planId || '');
  if (id === 'weekly' || id.endsWith('_weekly')) return 7 * 24 * 60 * 60 * 1000;
  if (id === 'yearly' || id.endsWith('_yearly')) return 365 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

export const TIER_ORDER = ['basic', 'pro', 'studio'];
export const PERIOD_ORDER = ['weekly', 'monthly', 'yearly'];
const TIER_RANK = { basic: 0, pro: 1, studio: 2 };

export const TOPUP_ORDER = ['boost100', 'boost300', 'boost750'];

export const PLAN_ORDER = [
  'pro_weekly', 'pro_monthly', 'pro_yearly',
  'studio_weekly', 'studio_monthly', 'studio_yearly',
];

/** The three ids that predate tiers. Each one means Pro at that period. */
const LEGACY_PLAN_IDS = { weekly: 'pro_weekly', monthly: 'pro_monthly', yearly: 'pro_yearly' };

export function normalisePlanId(planId) {
  const id = String(planId || 'free');
  return LEGACY_PLAN_IDS[id] || id;
}

export const TIERS = Object.freeze({
  basic: Object.freeze({
    id: 'basic', name: 'Basic', badge: 'Free',
    tagline: `Try the whole studio for ${config.stripeTrialDays} days.`,
  }),
  pro: Object.freeze({
    id: 'pro', name: 'Pro', badge: 'Most popular',
    tagline: 'Everything you need to publish consistently.',
  }),
  studio: Object.freeze({
    id: 'studio', name: 'Studio', badge: 'For channels at scale',
    // NOT "approve on autopilot": auto-approve was dropped from Studio once it
    // turned out to be free for everyone already. A tagline is a promise.
    tagline: 'Ask DeenAI, jump the queue, post more every day.',
  }),
});

const PLAN_GRID = {
  pro: {
    weekly: { tokens: () => config.tokensWeekly, price: () => config.stripePriceWeekly, label: () => config.planPriceWeeklyLabel },
    monthly: { tokens: () => config.tokensMonthly, price: () => config.stripePriceMonthly, label: () => config.planPriceMonthlyLabel },
    yearly: { tokens: () => config.tokensYearly, price: () => config.stripePriceYearly, label: () => config.planPriceYearlyLabel },
  },
  studio: {
    weekly: { tokens: () => config.tokensStudioWeekly, price: () => config.stripePriceStudioWeekly, label: () => config.planPriceStudioWeeklyLabel },
    monthly: { tokens: () => config.tokensStudioMonthly, price: () => config.stripePriceStudioMonthly, label: () => config.planPriceStudioMonthlyLabel },
    yearly: { tokens: () => config.tokensStudioYearly, price: () => config.stripePriceStudioYearly, label: () => config.planPriceStudioYearlyLabel },
  },
};

const PERIOD_NAMES = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };

export function plans() {
  const out = {
    free: {
      id: 'free', tier: 'basic', period: 'once', interval: 'one-time', name: 'Basic', badge: 'Free',
      tokens: config.tokensFree, priceId: '', enabled: true,
      description: `Try the studio for ${config.stripeTrialDays} days with ${config.tokensFree} tokens.`,
    },
  };
  for (const tier of ['pro', 'studio']) {
    for (const period of PERIOD_ORDER) {
      const cell = PLAN_GRID[tier][period];
      const priceId = cell.price();
      out[`${tier}_${period}`] = {
        id: `${tier}_${period}`, tier, period, interval: period,
        name: `${TIERS[tier].name} ${PERIOD_NAMES[period]}`,
        badge: period === 'monthly' ? 'Most popular' : period === 'yearly' ? 'Two months free' : 'Start small',
        tokens: cell.tokens(), priceId, priceLabel: cell.label(),
        enabled: Boolean(priceId),
        description: TIERS[tier].tagline,
      };
    }
  }
  return out;
}

/**
 * Which tier this account is on.
 *
 * The operator counts as Studio: the person running the product must never be
 * locked out of a feature of it, which is what isUnlimited has always meant.
 */
export function tierOf(user) {
  if (isUnlimited(user)) return 'studio';
  return paidTierOf(user);
}

/**
 * The tier this account actually PAYS for, ignoring the operator's unlimited
 * flag.
 *
 * Feature access and queue position are not the same question. The operator
 * must never be locked out of a feature of their own product -- but letting
 * that same flag jump the render queue puts the owner's test import in front
 * of a paying customer's lecture on a single-slot worker. A test caught
 * exactly that.
 */
export function paidTierOf(user) {
  if (!user) return 'basic';
  const billing = ensureUserBilling(user);
  const id = normalisePlanId(billing?.plan || 'free');
  if (id === 'free' || !billing?.plan) return 'basic';
  return id.startsWith('studio') ? 'studio' : 'pro';
}

/** Paid-tier comparison, for the things money buys rather than role does. */
export function paysForAtLeast(user, tier) {
  return TIER_RANK[paidTierOf(user)] >= (TIER_RANK[tier] ?? 99);
}

/** The one comparison the feature gates use. */
export function atLeast(user, tier) {
  return TIER_RANK[tierOf(user)] >= (TIER_RANK[tier] ?? 99);
}

/**
 * Platforms whose credentials can currently hold more than one account.
 *
 * This is a fact about the OAuth STORE, not about what is sold.
 * `setConnection` in tenancy.js writes `socialConnections[userId][provider] =
 * connection` -- one object, overwritten -- so a second YouTube channel would
 * destroy the first one's refresh token. Meta is different by construction:
 * one Facebook login stores `{ provider: 'meta', accounts: [...] }`, a LIST of
 * Pages and Instagram accounts, which `selectedAccount` already picks from by
 * id.
 *
 * So Facebook and Instagram can genuinely fan out today and YouTube and TikTok
 * cannot, and offering a second YouTube slot would be a control that cannot
 * reach an export -- invariant 9. When the store learns to hold several
 * connections per provider, add them here; nothing else in the cap changes.
 */
export const MULTI_ACCOUNT_PROVIDERS = Object.freeze(['facebook', 'instagram']);

/**
 * How many accounts on ONE platform this account may publish a clip to.
 *
 * Per platform, never a total: Studio is three YouTube channels AND three
 * TikToks, not three destinations shared out between them.
 *
 * Deliberately `atLeast`, not `paysForAtLeast`. This is feature access, and the
 * operator must not be locked out of their own product -- the money-based check
 * is for queue position and posting slots, where counting the owner as Studio
 * would let a test import preempt a paying customer.
 */
export function accountsPerPlatform(user, provider = '') {
  if (!atLeast(user, 'studio')) return 1;
  if (provider && !MULTI_ACCOUNT_PROVIDERS.includes(provider)) return 1;
  return Math.max(1, config.accountsPerPlatformStudio);
}

export function topups() {
  return {
    boost100: {
      id: 'boost100', name: 'Quick boost', tokens: 100,
      priceId: config.stripePriceTopup100, priceLabel: config.topupPrice100Label,
      badge: 'Light use', description: 'A small top-up for one more lecture or a few extra clips.',
      enabled: Boolean(config.stripePriceTopup100),
    },
    boost300: {
      id: 'boost300', name: 'Creator boost', tokens: 300,
      priceId: config.stripePriceTopup300, priceLabel: config.topupPrice300Label,
      badge: 'Most popular', description: 'Extra room for a busy week without changing your plan.',
      enabled: Boolean(config.stripePriceTopup300),
    },
    boost750: {
      id: 'boost750', name: 'Campaign boost', tokens: 750,
      priceId: config.stripePriceTopup750, priceLabel: config.topupPrice750Label,
      badge: 'Best value', description: 'A larger one-time token pack for long lectures and campaigns.',
      enabled: Boolean(config.stripePriceTopup750),
    },
  };
}

function topupForPrice(priceId = '') {
  return Object.values(topups()).find(pack => pack.priceId && pack.priceId === priceId) || null;
}

function planForPrice(priceId = '') {
  const found = Object.values(plans()).find(plan => plan.priceId && plan.priceId === priceId);
  return found?.id || '';
}

function allowance(planId) {
  const plan = plans()[normalisePlanId(planId)] || plans().free;
  return Math.max(0, Number(plan.tokens || 0));
}

/**
 * What this account may actually spend right now.
 *
 * A trial is free machine time, not a free plan: each token is a source minute
 * that burns proxy bandwidth on import and storage on render. Granted at the
 * plan's face value, one seven-day yearly trial hands out 6000 minutes — more
 * bandwidth than the proxy plan sells in a month — and then cancels. So while
 * the subscription is `trialing`, the ceiling is TOKENS_TRIAL.
 *
 * The cap lifts by itself: converting to a paid period moves
 * `current_period_start`, which resets `tokensUsed` in updateFromSubscription,
 * so the customer's first paid day starts on a clean full allowance.
 */
function walletAllowance(billing = {}, user = null) {
  const planId = normalisePlanId(billing.plan || 'free');
  const full = allowance(planId);
  // The free plan IS the trial: a fixed number of tokens inside a fixed number
  // of days. Once the window closes the allowance is nothing, not a smaller
  // something -- otherwise cancelling and re-subscribing mints a fresh free
  // wallet on every lap.
  if (planId === 'free') return freeWindow(user, billing).expired ? 0 : full;
  const cap = Math.max(0, Number(config.tokensTrial || 0));
  if (!cap) return full;
  return trialState(billing).active ? Math.min(cap, full) : full;
}

/**
 * How long a free account may keep working.
 *
 * Free used to be unlimited in time -- 40 tokens that never expired, so an
 * account could sit on the free plan forever and simply never pay. The window
 * starts when the account is created and does not restart, so a lapsed
 * subscriber cannot fall back into it either.
 */
function freeWindow(user, billing = {}) {
  const days = Math.max(0, Number(config.stripeTrialDays || 0));
  const startedAt = Number(user?.createdAt || billing.periodStart || 0);
  if (!days || !startedAt) return { endsAt: null, daysLeft: null, expired: false };
  const endsAt = startedAt + days * DAY_MS;
  return { endsAt, daysLeft: daysRemaining(endsAt), expired: now() >= endsAt };
}

export function tokenRate() {
  return Math.max(0.1, Number(config.tokensPerMinute || 1));
}

export function tokenCostForSeconds(seconds = 0) {
  return Math.max(1, Math.ceil((Math.max(0, Number(seconds) || 0) / 60) * tokenRate()));
}

/**
 * The source length that would cost this many tokens — the inverse of
 * tokenCostForSeconds. Used to hold a floor against an account when the real
 * duration is not knowable yet, which in remote mode is every link import.
 */
export function secondsForTokenCost(tokens = 0) {
  const rate = tokenRate() || 1;
  return (Math.max(0, Number(tokens) || 0) / rate) * 60;
}

export function tokenCostForMinutes(minutes = 0) {
  return Math.max(1, Math.ceil(Math.max(0, Number(minutes) || 0) * tokenRate()));
}

function daysRemaining(timestamp) {
  const target = Number(timestamp || 0);
  if (!target) return null;
  return Math.max(0, Math.ceil((target - now()) / DAY_MS));
}

function trialState(billing = {}) {
  const trialStart = Number(billing.trialStart || 0) || null;
  const trialEnd = Number(billing.trialEnd || 0) || null;
  const status = String(billing.status || '').toLowerCase();
  const active = status === 'trialing' && trialEnd && trialEnd > now();
  const ended = Boolean(trialEnd && trialEnd <= now() && status !== 'active');
  return {
    active: Boolean(active),
    ended,
    startsAt: trialStart,
    endsAt: trialEnd,
    daysLeft: active ? daysRemaining(trialEnd) : null,
  };
}

export function ensureBillingState() {
  if (!Array.isArray(state.billingEvents)) state.billingEvents = [];
  if (!Array.isArray(state.revenueEvents)) state.revenueEvents = [];
  if (!Array.isArray(state.processedStripeEvents)) state.processedStripeEvents = [];
  if (!state.billingSettings || typeof state.billingSettings !== 'object') state.billingSettings = {};
  for (const user of state.authUsers || []) ensureUserBilling(user);
}

export function ensureUserBilling(user) {
  if (!user) return null;
  user.billing ||= {};
  const billing = user.billing;
  billing.plan ||= user.role === 'owner' || user.role === 'admin' ? 'admin' : 'free';
  billing.status ||= billing.plan === 'admin' ? 'active' : 'free';
  billing.tokensUsed = Math.max(0, Number(billing.tokensUsed || 0));
  billing.tokensReserved = Math.max(0, Number(billing.tokensReserved || 0));
  billing.bonusTokens = Math.max(0, Number(billing.bonusTokens || 0));
  if (!Array.isArray(billing.processedTopupSessions)) billing.processedTopupSessions = [];
  billing.periodStart ||= user.createdAt || now();
  billing.periodEnd ||= billing.plan === 'free' || billing.plan === 'admin'
    ? null
    : billing.periodStart + periodMs(billing.plan);

  if (!isUnlimited(user) && billing.periodEnd && now() > Number(billing.periodEnd)) {
    billing.periodStart = now();
    billing.periodEnd = now() + periodMs(billing.plan);
    billing.tokensUsed = 0;
    // tokensReserved is left alone: those holds belong to jobs still running,
    // and each is released when its job finishes. Zeroing it here let a later
    // release clobber another job's hold.
  }
  return billing;
}

/**
 * What the free plan may and may not do -- the whole rule, in one place.
 *
 * The decision (23 Aug 2026) is that free limits VOLUME and POLISH, never
 * capability. A free account runs the entire loop: import, clip, edit,
 * re-render, schedule, automate and publish straight to TikTok, YouTube and
 * Instagram, with as many clips per lecture as it likes. Publishing is the
 * point of the product; gating it would sell nothing and teach nobody what
 * DeenClipped is for. Clips per lecture cost nothing extra to gate anyway --
 * tokens are charged per source MINUTE, so ten clips from one lecture cost
 * exactly what three do.
 *
 * The ceiling is the token allowance, and the two Pro features are the two
 * that touch how a clip LOOKS: whose name is on it, and which style it is in.
 *
 * PRO is the exhaustive list. Anything not named here is core and free, and
 * test/plan-gating.test.mjs fails if a gate appears anywhere else.
 */
/**
 * Every feature a plan can unlock, and the LOWEST tier that has it.
 *
 * One table, because there used to be two truths -- a list of Pro features and
 * a separate function deciding who got them -- and a feature could be in the
 * list without a gate, or gated without ever being advertised. `planFeatures`
 * is derived from this, the pricing screen is derived from this, and the
 * gate-law test asserts this table against the gates that read it.
 */
export const FEATURES = Object.freeze({
  watermark: Object.freeze({ tier: 'pro', label: 'Remove the DeenClipped watermark' }),
  templates: Object.freeze({ tier: 'pro', label: 'Every template in the catalogue, not only the default style' }),
  deenai: Object.freeze({ tier: 'pro', label: 'DeenAI insights — growth advice counted from your own clips' }),
  deenaiAsk: Object.freeze({ tier: 'studio', label: 'Ask DeenAI anything, answered on our own server' }),
  // NOT auto-approve: automation with a minimum score has always been free for
  // every account (`automationSettings`, up to 20 clips a lecture), and putting
  // a fence around a feature people already have takes something away rather
  // than selling something new.
  priorityRender: Object.freeze({ tier: 'studio', label: 'Your lectures jump the render queue' }),
  extraSlots: Object.freeze({ tier: 'studio', label: `Post up to ${config.postSlotsStudio} times a day, not four` }),
  multiChannel: Object.freeze({ tier: 'studio', label: `Send one clip to up to ${config.accountsPerPlatformStudio} accounts on a platform` }),
});

/** Kept as a name because the marketing pages and tests speak in these terms. */
export const PRO_FEATURES = Object.freeze(Object.fromEntries(
  Object.entries(FEATURES).filter(([, f]) => f.tier === 'pro').map(([key, f]) => [key, f.label]),
));

export const STUDIO_FEATURES = Object.freeze(Object.fromEntries(
  Object.entries(FEATURES).filter(([, f]) => f.tier === 'studio').map(([key, f]) => [key, f.label]),
));

/** What a tier includes, cumulative: Studio has everything Pro has. */
export function featuresForTier(tier) {
  const rank = TIER_RANK[tier] ?? 0;
  return Object.fromEntries(Object.entries(FEATURES).map(([key, f]) => [key, rank >= TIER_RANK[f.tier]]));
}

export const FREE_INCLUDES = Object.freeze([
  'Publishing straight to TikTok, YouTube and Instagram',
  'Scheduling and automation',
  'As many clips per lecture as you want',
  'The editor, the review queue and re-renders',
  'The default template, with the DeenClipped watermark',
]);

/** Which Pro features this account has. Everything else is core. */
export function planFeatures(user) {
  return featuresForTier(tierOf(user));
}

// "Pro" for feature gates: any plan that is not free. The admin plan counts --
// the operator's own account must never be locked out of its own features.
export function isPaid(user) {
  const billing = ensureUserBilling(user);
  return Boolean(billing && billing.plan && billing.plan !== 'free');
}

export function isUnlimited(user) {
  return Boolean(user && ['owner', 'admin'].includes(String(user.role || '').toLowerCase()));
}

export function publicBilling(user) {
  ensureBillingState();
  if (!user) return { enabled: config.stripeEnabled, plans: plans(), tokenRatePerMinute: tokenRate() };
  const billing = ensureUserBilling(user);
  const unlimited = isUnlimited(user);
  const currentPlan = billing.plan || 'free';
  const allow = unlimited ? Infinity : walletAllowance(billing, user);
  const used = Number(billing.tokensUsed || 0);
  const reserved = Number(billing.tokensReserved || 0);
  const bonusTokens = Math.max(0, Number(billing.bonusTokens || 0));
  const trial = trialState(billing);
  const baseRemaining = unlimited ? null : Math.max(0, allow - used - reserved);
  const remaining = unlimited ? null : baseRemaining + bonusTokens;
  const periodEndsInDays = billing.periodEnd ? daysRemaining(billing.periodEnd) : null;
  const free = unlimited ? { expired: false, daysLeft: null, endsAt: null } : freeWindow(user, billing);
  const notices = [];
  // The free window is the one wall a new account actually hits, so it is
  // announced before it arrives and stated plainly once it has.
  if (!unlimited && currentPlan === 'free' && free.endsAt) {
    if (free.expired) {
      notices.push({
        id: `free-ended-${free.endsAt}`,
        kind: 'free_ended',
        title: 'Your free trial has ended',
        message: `Your ${config.stripeTrialDays} free days are up. Choose a plan to keep importing lectures and making clips.`,
        action: 'Choose plan',
        blocking: true,
      });
    } else {
      notices.push({
        id: `free-ending-${free.endsAt}`,
        kind: 'free_ending',
        title: free.daysLeft <= 1 ? 'Free trial ends today' : `${free.daysLeft} free days left`,
        message: `You have ${Math.round(remaining || 0)} tokens and ${free.daysLeft} day${free.daysLeft === 1 ? '' : 's'} of free use. After that a plan is needed to keep going.`,
        action: 'See plans',
      });
    }
  }
  if (trial.active && trial.daysLeft <= 2) {
    notices.push({
      id: `trial-ending-${billing.trialEnd}`,
      kind: 'trial_ending',
      title: `Trial ends in ${trial.daysLeft} day${trial.daysLeft === 1 ? '' : 's'}`,
      message: 'Choose a plan or confirm your billing details before the trial ends to keep posting without interruption.',
      action: 'Manage plan',
    });
  }
  if (trial.ended) {
    notices.push({
      id: `trial-ended-${billing.trialEnd}`,
      kind: 'trial_ended',
      title: 'Your trial has ended',
      message: 'Start a weekly, monthly or yearly plan to keep generating clips.',
      action: 'Choose plan',
    });
  }
  if (!unlimited && remaining !== null && allow > 0 && remaining <= Math.max(5, Math.ceil(allow * 0.1))) {
    notices.push({
      id: `low-tokens-${currentPlan}-${billing.periodStart}`,
      kind: 'low_tokens',
      title: `${Math.round(remaining)} tokens left`,
      message: 'You are close to your token limit. Upgrade before importing another long lecture.',
      action: 'Upgrade',
    });
  }
  return {
    enabled: config.stripeEnabled,
    stripeConfigured: Boolean(config.stripeSecretKey),
    checkoutConfigured: Boolean(config.stripePriceWeekly || config.stripePriceMonthly || config.stripePriceYearly),
    topupCheckoutConfigured: Boolean(config.stripePriceTopup100 || config.stripePriceTopup300 || config.stripePriceTopup750),
    portalConfigured: Boolean(config.stripeSecretKey),
    tokenRatePerMinute: tokenRate(),
    trialDays: config.stripeTrialDays,
    trialTokens: Math.max(0, Number(config.tokensTrial || 0)),
    terms: [
      `${tokenRate()} token per source video minute`,
      'Tokens are charged after the source duration is known',
      'Template updates and rerenders are free',
      config.tokensTrial
        ? `${config.stripeTrialDays || 7}-day trial on paid plans, with ${config.tokensTrial} tokens to try it`
        : `${config.stripeTrialDays || 7}-day trial on paid plans`,
      config.tokensTrial ? 'Your full plan allowance starts on the first paid day' : '',
      'Unused trial access does not roll into another trial',
      'Purchased top-up tokens do not expire when a subscription renews',
    ].filter(Boolean),
    proFeatures: PRO_FEATURES,
    // What each tier ADDS over the one below it, from the same table the gates
    // read. The screen used to repeat one flat Pro list on every card, which
    // with three tiers would show the same three lines three times and hide
    // the actual difference between them.
    tierAdds: {
      basic: [],
      pro: Object.values(PRO_FEATURES),
      studio: Object.values(STUDIO_FEATURES),
    },
    // The dashboard needs to distinguish "no tokens" from "address not
    // confirmed yet" -- they are refused the same way and mean different things.
    emailVerificationRequired: auth.verificationRequired(),
    emailVerified: auth.isVerified(user),
    freeIncludes: FREE_INCLUDES,
    current: {
      plan: currentPlan,
      features: planFeatures(user),
      status: billing.status || 'free',
      unlimited,
      allowance: unlimited ? null : allow,
      baseRemaining,
      bonusTokens: unlimited ? null : bonusTokens,
      totalAvailable: unlimited ? null : remaining,
      used,
      reserved,
      remaining,
      periodStart: billing.periodStart || null,
      periodEnd: billing.periodEnd || null,
      periodEndsInDays,
      cancelAtPeriodEnd: Boolean(billing.cancelAtPeriodEnd),
      // Stripe's own cancel_at when it sent one, else the period end -- which is
      // when access actually stops either way.
      cancelAt: billing.cancelAtPeriodEnd ? (billing.cancelAt || billing.periodEnd || null) : null,
      trial,
      freeTrial: unlimited ? { endsAt: null, daysLeft: null, expired: false } : freeWindow(user, billing),
      stripeCustomerId: billing.stripeCustomerId || '',
      stripeSubscriptionId: billing.stripeSubscriptionId || '',
    },
    plans: plans(),
    topups: topups(),
    notices,
    recentEvents: (state.billingEvents || []).filter(event => event.userId === user.id).slice(0, 10),
  };
}

export function assertCanSpend(user, tokens, action = 'start this job') {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  if (isUnlimited(user)) return true;
  const info = publicBilling(user);
  const needed = Math.max(1, Math.ceil(Number(tokens || 0)));
  const remaining = Number(info.current.remaining || 0);
  if (remaining < needed) {
    // Two different walls, two different sentences. "You have 0 tokens" is
    // useless advice to someone whose free days simply ran out -- waiting for a
    // renewal that will never come is exactly the wrong next move.
    const free = info.current?.freeTrial;
    if (free?.expired && (info.current?.plan || 'free') === 'free') {
      const error = new Error(`Your ${config.stripeTrialDays}-day free trial has ended. Choose a plan to keep making clips.`);
      error.statusCode = 402;
      error.needsPlan = true;
      throw error;
    }
    const error = new Error(`Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}. Buy a top-up, or upgrade your plan.`);
    error.statusCode = 402;
    error.needsTokens = true;
    throw error;
  }
  return true;
}

export function assertCanStartProject(user) {
  if (isUnlimited(user)) return true;
  return assertCanSpend(user, config.minimumTokensToStart, 'start a new lecture');
}

export function estimateTokenCharge(user, minutes = 0) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const estimatedMinutes = Math.max(1, Math.ceil(Number(minutes || 0)));
  const estimatedTokens = tokenCostForMinutes(estimatedMinutes);
  const info = publicBilling(user);
  const remaining = info.current?.unlimited ? null : Number(info.current?.remaining || 0);
  return {
    estimatedMinutes,
    estimatedTokens,
    rate: tokenRate(),
    unlimited: Boolean(info.current?.unlimited),
    remaining,
    enough: info.current?.unlimited || remaining >= estimatedTokens,
    minimumToStart: config.minimumTokensToStart,
    terms: info.terms || [],
  };
}

// Reserving holds tokens against work that has started but not yet been charged.
// tokensReserved was already subtracted from availability everywhere, but nothing
// ever set it, so remaining-token figures ignored jobs in flight and an account
// could start more work than it could pay for.
export function reserveTokens(userId, tokens, meta = {}) {
  ensureBillingState();
  const user = (state.authUsers || []).find(item => item.id === userId);
  if (!user || isUnlimited(user)) return { reserved: 0, unlimited: true };
  const amount = Math.max(0, Math.ceil(Number(tokens || 0)));
  if (!amount) return { reserved: 0, unlimited: false };
  const billing = ensureUserBilling(user);
  const planAllowance = walletAllowance(billing, user);
  const used = Math.max(0, Number(billing.tokensUsed || 0));
  const reserved = Math.max(0, Number(billing.tokensReserved || 0));
  const available = Math.max(0, planAllowance - used - reserved) + Math.max(0, Number(billing.bonusTokens || 0));
  if (available < amount) {
    throw new Error(`Not enough tokens. This job needs about ${amount}, but only ${available} are available.`);
  }
  billing.tokensReserved = reserved + amount;
  user.updatedAt = now();
  save();
  return { reserved: amount, unlimited: false, meta };
}

// Releasing is always safe to call, including twice: a reservation that is no
// longer held simply clamps at zero. Charging happens separately, once the real
// duration is known.
export function releaseTokens(userId, tokens) {
  ensureBillingState();
  const user = (state.authUsers || []).find(item => item.id === userId);
  if (!user || isUnlimited(user)) return { released: 0 };
  const amount = Math.max(0, Math.ceil(Number(tokens || 0)));
  if (!amount) return { released: 0 };
  const billing = ensureUserBilling(user);
  const before = Math.max(0, Number(billing.tokensReserved || 0));
  billing.tokensReserved = Math.max(0, before - amount);
  user.updatedAt = now();
  save();
  return { released: before - billing.tokensReserved };
}

export function chargeTokens(userId, tokens, reason = 'usage', meta = {}, { allowPartial = false } = {}) {
  ensureBillingState();
  const user = (state.authUsers || []).find(item => item.id === userId);
  if (!user || isUnlimited(user)) return { charged: 0, unlimited: true, shortfall: 0 };
  const billing = ensureUserBilling(user);
  const owed = Math.max(1, Math.ceil(Number(tokens || 0)));
  const planAllowance = walletAllowance(billing, user);
  const usedBefore = Math.max(0, Number(billing.tokensUsed || 0));
  const reserved = Math.max(0, Number(billing.tokensReserved || 0));
  const baseAvailable = Math.max(0, planAllowance - usedBefore - reserved);
  const bonusAvailable = Math.max(0, Number(billing.bonusTokens || 0));
  if (baseAvailable + bonusAvailable < owed && !allowPartial) {
    throw new Error(`Not enough tokens. This charge needs ${owed}, but only ${baseAvailable + bonusAvailable} are available.`);
  }
  // A completed job is charged for whatever the account can cover. Waiving the
  // whole charge on a shortfall meant the work was delivered free and the
  // balance left untouched, so it could be repeated indefinitely.
  const amount = Math.min(owed, baseAvailable + bonusAvailable);
  const shortfall = owed - amount;
  if (!amount) return { charged: 0, unlimited: false, shortfall };
  const subscriptionUsed = Math.min(baseAvailable, amount);
  const bonusUsed = amount - subscriptionUsed;
  billing.bonusTokens = Math.max(0, Number(billing.bonusTokens || 0) - bonusUsed);
  billing.tokensUsed = usedBefore + subscriptionUsed;
  user.updatedAt = now();
  const beforeRemaining = Math.max(0, planAllowance - Number(billing.tokensUsed || 0) - reserved) + Number(billing.bonusTokens || 0);
  const event = {
    id: `bill_${now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id, amount, reason, meta: { ...meta, subscriptionUsed, bonusUsed }, createdAt: now(),
    type: 'tokens_charged',
    remaining: beforeRemaining,
    message: `${amount} token${amount === 1 ? '' : 's'} used for ${reason}.`,
  };
  state.billingEvents.unshift(event);
  state.billingEvents = state.billingEvents.slice(0, 500);
  save();
  log(`Charged ${amount} token${amount === 1 ? '' : 's'} to ${user.email || user.id} for ${reason}.`, 'info', user.id);
  return { charged: amount, unlimited: false, shortfall, event };
}

export function chargeSourceMinutes(userId, seconds, meta = {}, options = {}) {
  const tokens = tokenCostForSeconds(seconds);
  return chargeTokens(userId, tokens, 'source minutes', { seconds: Math.round(Number(seconds || 0)), ...meta }, options);
}

export function chargeOutputMinutes(userId, seconds, meta = {}) {
  const tokens = tokenCostForSeconds(seconds);
  return chargeTokens(userId, tokens, 'extra clip minutes', { seconds: Math.round(Number(seconds || 0)), ...meta });
}

async function stripeRequest(pathname, params = {}) {
  if (!config.stripeSecretKey) throw new Error('Stripe is not configured. Add STRIPE_SECRET_KEY in Render.');
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') body.append(key, String(value));
  }
  const response = await fetch(`https://api.stripe.com/v1${pathname}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe request failed with ${response.status}.`);
  return payload;
}

/**
 * Read from Stripe.
 *
 * stripeRequest posts, because everything it was built for creates something.
 * Reads need GET with a query string -- Stripe treats a POST to a read
 * endpoint as a write attempt -- and the owner dashboard is all reads. Kept
 * here rather than in owner.js so the secret key stays in one module.
 *
 * Returns null rather than throwing when Stripe is not configured: the owner
 * dashboard must still render its costs and users on a deployment with no
 * Stripe key, and a thrown error there would take the whole page down.
 */
export async function stripeGet(pathname, params = {}) {
  if (!config.stripeSecretKey) return null;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) { for (const item of value) query.append(key, String(item)); continue; }
    query.append(key, String(value));
  }
  const suffix = query.toString() ? `?${query}` : '';
  const response = await fetch(`https://api.stripe.com/v1${pathname}${suffix}`, {
    headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || `Stripe read failed with ${response.status}.`);
  return payload;
}

/** True when a Stripe key is present at all, so callers can say why a figure is missing. */
export function stripeConfigured() {
  return Boolean(config.stripeSecretKey);
}

/**
 * The Stripe customer for this account, creating one if the stored id is no
 * longer real.
 *
 * A stored id used to be trusted on sight, which broke the day the test key
 * was swapped for the live one: every account carried a `cus_…` minted in test
 * mode, live Stripe answered "No such customer", and checkout returned 400 for
 * all of them. Nobody could pay, and the only symptom was an error message
 * naming an id the customer has never heard of.
 *
 * A stored id is therefore checked before it is used. The check costs one GET
 * and only runs when an id exists; a missing or deleted customer is forgotten
 * and replaced rather than reported. Recreating is safe -- the id is a pointer
 * to a billing profile, not to money, and a fresh one simply starts empty.
 */
async function ensureStripeCustomer(user) {
  const billing = ensureUserBilling(user);
  const stored = billing.stripeCustomerId || '';
  if (stored) {
    const existing = await stripeGet(`/customers/${encodeURIComponent(stored)}`).catch(() => null);
    if (existing?.id && !existing.deleted) return existing.id;
    log(`Stripe customer ${stored} no longer exists; issuing a new one for ${user.email || user.id}.`, 'warn', user.id);
    billing.stripeCustomerId = '';
    // The subscription pointer belonged to that customer, so it cannot outlive
    // it. Leaving it behind would send the portal after a subscription that
    // does not exist either.
    billing.stripeSubscriptionId = '';
    billing.stripePriceId = '';
  }
  const customer = await stripeRequest('/customers', {
    email: user.email || '',
    name: user.name || user.email || 'DeenClipped creator',
    'metadata[userId]': user.id,
  });
  billing.stripeCustomerId = customer.id;
  save();
  return customer.id;
}

function appBase() {
  return (config.publicBaseUrl || '').replace(/\/+$/, '') || `http://localhost:${config.port}`;
}

/**
 * The subscription Stripe currently believes in, or null.
 *
 * The stored id is checked rather than trusted, for the same reason
 * ensureStripeCustomer checks the customer: an id can outlive the object it
 * points at, and acting on a dead one is how an account ends up paying for two
 * subscriptions at once.
 */
async function liveSubscription(user) {
  const billing = ensureUserBilling(user);
  const id = billing.stripeSubscriptionId || '';
  if (!id) return null;
  const found = await stripeGet(`/subscriptions/${encodeURIComponent(id)}`).catch(() => null);
  if (!found?.id) return null;
  return ['active', 'trialing', 'past_due', 'unpaid'].includes(String(found.status || '')) ? found : null;
}

/**
 * Move an existing subscriber to a different plan.
 *
 * Checkout used to be the only path, and checkout only ever creates. A
 * customer moving from weekly to monthly got a SECOND subscription while the
 * first kept billing, and the app overwrote the stored id so only the newer one
 * was ever visible here. Two charges a month, one of them invisible.
 *
 * Switching edits the existing subscription in place. Stripe prorates, so the
 * customer pays the difference rather than the whole price again, and there is
 * only ever one subscription per account.
 */
async function switchSubscriptionPlan(user, subscription, plan) {
  const item = subscription.items?.data?.[0];
  if (!item?.id) throw new Error('That subscription has no billable item to move.');
  const updated = await stripeRequest(`/subscriptions/${encodeURIComponent(subscription.id)}`, {
    'items[0][id]': item.id,
    'items[0][price]': plan.priceId,
    proration_behavior: 'create_prorations',
    'metadata[userId]': user.id,
    'metadata[plan]': plan.id,
  });
  updateFromSubscription(updated);
  log(`Switched ${user.email || user.id} to ${plan.name} in place; no second subscription created.`, 'info', user.id);
  return { switched: true, plan: plan.id, planName: plan.name };
}

/**
 * One or the other. Never both.
 *
 * Split out as a pure function so the no-stacking rule can be TESTED by
 * calling it, rather than by a test reading the source and matching on text —
 * the first version of that test failed against a comment that happened to
 * contain the words it was looking for.
 *
 * Returns the checkout parameters for exactly one of two worlds: an automatic
 * invite discount with no promo box, or a promo box with no automatic
 * discount. Stripe rejects a session carrying both, which is what makes this
 * rule enforceable rather than remembered.
 */
export function checkoutDiscountParams(discount, coupon) {
  if (discount?.eligible && coupon) return { 'discounts[0][coupon]': coupon };
  return { allow_promotion_codes: 'true' };
}

export async function createCheckoutSession(user, planId) {
  metrics.event('checkout_started');
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  // Normalised, because the three original ids are still in the wild: in
  // Stripe metadata, in any link someone saved, and in every test written
  // before tiers existed. Refusing them here would break checkout for exactly
  // the customers who already pay.
  const plan = plans()[normalisePlanId(planId)];
  if (!plan || !PLAN_ORDER.includes(plan.id)) throw new Error('Choose a Pro or Studio plan.');
  if (!plan.priceId) throw new Error(`${plan.name} does not have a Stripe price ID configured yet.`);

  const billing = ensureUserBilling(user);
  const existing = await liveSubscription(user);
  if (existing) {
    if (normalisePlanId(billing.plan) === plan.id) throw new Error(`You are already on ${plan.name}.`);
    return switchSubscriptionPlan(user, existing, plan);
  }

  const customer = await ensureStripeCustomer(user);
  const params = {
    mode: 'subscription',
    customer,
    // The session id travels back so the return can be CONFIRMED against
    // Stripe directly. Without it the only thing that grants a plan is the
    // webhook, and a webhook is a thing that can be misconfigured, delayed or
    // dropped -- in which case the customer has paid and has nothing.
    success_url: `${appBase()}/app?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBase()}/plans?billing=cancelled`,
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': '1',
    'metadata[userId]': user.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][userId]': user.id,
    'subscription_data[metadata][plan]': plan.id,
  };

  /*
   * The invite discount, and why it cannot stack.
   *
   * Stripe refuses a session that carries BOTH `discounts` and
   * `allow_promotion_codes` — you may have an automatic discount or a box to
   * type a code into, never both. That is not a limitation to work around; it
   * is exactly the rule Youssef asked for ("it doesn't overlap other codes"),
   * enforced by Stripe rather than by us remembering to.
   *
   * So the choice is made here, once: an eligible invited customer gets the
   * referral coupon applied automatically and NO promo box. Everyone else gets
   * the promo box as before. A referred customer who would rather use a
   * different code can still do it — from the pricing page, without the invite
   * link's cookie — which is a trade worth making for a rule that cannot be
   * got round.
   *
   * The percentage is not here. It lives on the Stripe coupon, along with how
   * long it lasts, because duplicating it would let the two disagree about
   * what a customer was promised.
   */
  Object.assign(params, checkoutDiscountParams(
    config.stripeReferralCoupon
      ? referrals.discountEligible(state, user, config.referralDiscountMaxUses)
      : { eligible: false, reason: 'no-coupon-configured' },
    config.stripeReferralCoupon,
  ));
  // One trial per account, ever. This used to be applied on every checkout, so
  // cancelling and re-subscribing -- or upgrading, before switching existed --
  // handed out another free week each time.
  const hadTrial = Boolean(billing.trialStart || billing.trialEnd);
  if (config.stripeTrialDays > 0 && !hadTrial) {
    params['subscription_data[trial_period_days]'] = String(config.stripeTrialDays);
  }
  const session = await stripeRequest('/checkout/sessions', params);
  return { id: session.id, url: session.url };
}

export async function createTopupCheckoutSession(user, packageId) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  if (isUnlimited(user)) throw new Error('Owner and admin accounts already have unlimited tokens.');
  const pack = topups()[packageId];
  if (!pack || !TOPUP_ORDER.includes(pack.id)) throw new Error('Choose a valid token pack.');
  if (!pack.priceId) throw new Error(`${pack.name} does not have a Stripe price ID configured yet.`);
  const customer = await ensureStripeCustomer(user);
  const session = await stripeRequest('/checkout/sessions', {
    mode: 'payment',
    customer,
    success_url: `${appBase()}/app?billing=topup-success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appBase()}/plans?billing=topup-cancelled`,
    'line_items[0][price]': pack.priceId,
    'line_items[0][quantity]': '1',
    'metadata[userId]': user.id,
    'metadata[kind]': 'token_topup',
    'metadata[package]': pack.id,
    'metadata[tokens]': String(pack.tokens),
    allow_promotion_codes: 'true',
  });
  return { id: session.id, url: session.url };
}

/**
 * Grant bonus tokens for a reason that is not a purchase.
 *
 * Referral rewards need the same balance a top-up writes to -- a separate
 * "referral minutes" pool would be a second currency the allowance code does
 * not know about, and the customer would see a number that did not spend.
 *
 * Idempotency is the CALLER's job here and deliberately so: this function is
 * given a reason key, refuses a key it has already honoured, and records it.
 * Doing it any other way means a re-run of a settle pass tops somebody up
 * every time it runs.
 */
/**
 * What the invite coupon is actually worth, asked of Stripe.
 *
 * NOT a configured string. A `REFERRAL_DISCOUNT_LABEL=30% off` sitting beside
 * a coupon somebody later edited to 20% would have the product promising one
 * number while charging another -- the exact "two places that can disagree"
 * problem this codebase keeps having to fix. Stripe holds the coupon, so
 * Stripe is asked.
 *
 * Cached for an hour: it is read on every load of the invite panel and it
 * changes approximately never. On any failure this returns null and the panel
 * says there is a discount without naming a figure -- worse copy and true,
 * rather than better copy and possibly false.
 */
let couponCache = { at: 0, value: null };
export async function referralCouponSummary() {
  if (!config.stripeReferralCoupon || !config.stripeSecretKey) return null;
  if (couponCache.at && Date.now() - couponCache.at < 3_600_000) return couponCache.value;
  try {
    const coupon = await stripeGet(`/coupons/${encodeURIComponent(config.stripeReferralCoupon)}`);
    const percent = Number(coupon?.percent_off) || 0;
    const amount = Number(coupon?.amount_off) || 0;
    const value = {
      label: percent ? `${percent}% off`
        : amount ? `${(amount / 100).toFixed(2)} ${String(coupon.currency || '').toUpperCase()} off`
          : 'a discount',
      duration: String(coupon?.duration || ''),
      months: Number(coupon?.duration_in_months) || 0,
      valid: coupon?.valid !== false,
    };
    couponCache = { at: Date.now(), value };
    return value;
  } catch {
    // A coupon that cannot be read is not a coupon that can be described.
    couponCache = { at: Date.now(), value: null };
    return null;
  }
}

export function grantBonusTokens(user, tokens, reason, key) {
  ensureBillingState();
  const amount = Math.max(0, Math.round(Number(tokens) || 0));
  if (!user || !amount) return { granted: 0 };
  if (isUnlimited(user)) return { granted: 0, unlimited: true };
  const billing = ensureUserBilling(user);
  const grantKey = String(key || reason || '');
  if (!grantKey) throw new Error('A bonus grant needs a key, or it will be granted again.');
  billing.processedBonusGrants ||= [];
  if (billing.processedBonusGrants.includes(grantKey)) {
    return { granted: 0, duplicate: true, balance: billing.bonusTokens };
  }
  billing.bonusTokens = Math.max(0, Number(billing.bonusTokens || 0)) + amount;
  billing.processedBonusGrants.unshift(grantKey);
  billing.processedBonusGrants = billing.processedBonusGrants.slice(0, 200);
  state.billingEvents.unshift({
    id: `bill_${now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id,
    amount,
    reason: String(reason || 'bonus'),
    meta: { key: grantKey },
    createdAt: now(),
  });
  state.billingEvents = state.billingEvents.slice(0, 5000);
  save();
  return { granted: amount, balance: billing.bonusTokens };
}

export function grantTopup(user, packageId, references = {}) {
  ensureBillingState();
  if (!user || isUnlimited(user)) return { granted: 0, unlimited: Boolean(user && isUnlimited(user)) };
  const pack = topups()[packageId];
  if (!pack) throw new Error('Unknown token top-up package.');
  const billing = ensureUserBilling(user);
  const refs = typeof references === 'string' ? { sessionId: references } : references;
  const cleanSessionId = String(refs.sessionId || '');
  if (!cleanSessionId) throw new Error('A verified Stripe Checkout session is required to grant a token top-up.');
  if (billing.processedTopupSessions.includes(cleanSessionId)) {
    return { granted: 0, duplicate: true, balance: billing.bonusTokens };
  }
  billing.bonusTokens = Math.max(0, Number(billing.bonusTokens || 0)) + Number(pack.tokens || 0);
  billing.processedTopupSessions.unshift(cleanSessionId);
  billing.processedTopupSessions = billing.processedTopupSessions.slice(0, 100);
  const event = {
    id: `bill_${now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id,
    amount: Number(pack.tokens || 0),
    reason: 'token top-up',
    meta: {
      packageId: pack.id,
      sessionId: cleanSessionId,
      stripeEventId: String(refs.eventId || ''),
      paymentIntentId: String(refs.paymentIntentId || ''),
      customerId: String(refs.customerId || ''),
    },
    createdAt: now(),
    type: 'tokens_added',
    remaining: Math.max(0, walletAllowance(billing, user) - Number(billing.tokensUsed || 0) - Number(billing.tokensReserved || 0)) + billing.bonusTokens,
    message: `${pack.tokens} top-up tokens added to your wallet.`,
  };
  state.billingEvents.unshift(event);
  state.billingEvents = state.billingEvents.slice(0, 500);
  user.updatedAt = now();
  save();
  log(`Added ${pack.tokens} top-up tokens to ${user.email || user.id}.`, 'info', user.id);
  return { granted: pack.tokens, balance: billing.bonusTokens, event };
}

/**
 * Apply a completed Checkout session the customer has just come back from.
 *
 * The webhook is not a safety net, it is the ONLY net: a plan is granted by
 * `checkout.session.completed` and made real by `customer.subscription.*`. So
 * a signing secret that does not match -- which is exactly what has been
 * alerting on this deployment -- means a customer pays Stripe successfully and
 * their account stays on free. They see the charge and nothing else.
 *
 * This is the second net, and it reads from a different credential: the SECRET
 * KEY, which has demonstrably been working the whole time (checkout sessions
 * are being created with it). Stripe's own guidance is to fulfil on both the
 * return and the webhook rather than trusting either alone.
 *
 * Both paths converge on the same functions -- `grantTopup` and
 * `updateFromSubscription` -- so there is one place that grants a plan and one
 * place that grants tokens. Both already refuse to act twice: `grantTopup`
 * dedupes on the session id, and `recordRevenue` on the Stripe object id, so a
 * webhook that turns up late (or a customer who reloads the success page)
 * cannot double-grant.
 */
export async function confirmCheckoutSession(user, sessionId) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const id = String(sessionId || '').trim();
  // Shape-checked before it is spent on a network call: this is a value out of
  // a query string, and everything else here trusts that it named a session.
  if (!/^cs_[A-Za-z0-9_]{8,255}$/.test(id)) throw new Error('That is not a Checkout session.');

  const session = await stripeGet(`/checkout/sessions/${id}`, { 'expand[]': ['subscription', 'line_items'] });
  // stripeGet answers null rather than throwing on a deployment with no key,
  // so that the owner dashboard still renders. Here that is a refusal.
  if (!session) throw new Error('Stripe is not configured on this deployment.');
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id || '';
  const billing = ensureUserBilling(user);

  // Fetching first is unavoidable -- only Stripe knows whose session this is --
  // so the ownership check has to be explicit and has to refuse by default.
  // Both checkout creators stamp metadata.userId, so the fallback only covers
  // a session made before they did.
  const claimed = String(session.metadata?.userId || '');
  const ownedByMetadata = claimed && claimed === user.id;
  const ownedByCustomer = !claimed && customerId && customerId === String(billing.stripeCustomerId || '');
  if (!ownedByMetadata && !ownedByCustomer) throw new Error('That payment belongs to a different account.');

  if (session.status !== 'complete') return { ok: true, applied: false, reason: 'incomplete' };

  if (session.mode === 'payment' || session.metadata?.kind === 'token_topup') {
    if (session.payment_status !== 'paid') return { ok: true, applied: false, reason: 'unpaid' };
    const packageId = session.metadata?.package || topupForPrice(session.line_items?.data?.[0]?.price?.id)?.id;
    if (!packageId) return { ok: true, applied: false, reason: 'unknown_package' };
    billing.stripeCustomerId = customerId || billing.stripeCustomerId || '';
    recordRevenue({
      kind: 'topup', userId: user.id,
      amountMinor: session.amount_total, currency: session.currency,
      description: topups()[packageId]?.name || packageId,
      stripeId: String(session.id || ''),
    });
    const result = grantTopup(user, packageId, {
      sessionId: session.id,
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id,
      customerId,
    });
    return { ok: true, applied: !result.duplicate, kind: 'topup', granted: result.granted, duplicate: Boolean(result.duplicate) };
  }

  // A trial subscription is `no_payment_required`, which is a perfectly good
  // reason to switch the plan on -- refusing anything but 'paid' here would
  // strand every trial that started while the webhook was down.
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    return { ok: true, applied: false, reason: 'unpaid' };
  }
  billing.stripeCustomerId = customerId || billing.stripeCustomerId || '';
  const subscription = typeof session.subscription === 'object' && session.subscription ? session.subscription : null;
  if (subscription) {
    // The expanded subscription carries the period, the status and the trial,
    // so this lands the account in exactly the state the webhook pair would
    // have left it in -- not a half-state that says "checkout_complete".
    updateFromSubscription({ ...subscription, metadata: { userId: user.id, ...(subscription.metadata || {}) } });
  } else {
    billing.stripeSubscriptionId = typeof session.subscription === 'string' ? session.subscription : billing.stripeSubscriptionId || '';
    billing.plan = normalisePlanId(session.metadata?.plan || billing.plan || 'free');
    billing.status = 'checkout_complete';
    user.updatedAt = now();
    save();
  }
  return { ok: true, applied: true, kind: 'subscription', plan: ensureUserBilling(user).plan, status: ensureUserBilling(user).status };
}

/**
 * Cancel at the end of the paid period, or take that cancellation back.
 *
 * Never an immediate cancel. They have paid through the period, the tokens for
 * it are already theirs, and cutting access on the day they cancel would be
 * taking back something sold. Stripe keeps the subscription live and sends
 * `customer.subscription.deleted` when the period actually ends, which is what
 * flips the account to free -- so the wind-down needs no scheduling here.
 *
 * The local flag is written from Stripe's response rather than from the
 * argument, and without waiting for the webhook: the customer is looking at
 * the screen right now, and a cancel that appears to do nothing is one they
 * will either do again or charge back.
 */
export async function setCancelAtPeriodEnd(user, cancel = true) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  if (isUnlimited(user)) throw new Error('This account has no subscription to cancel.');
  const billing = ensureUserBilling(user);
  const subscriptionId = String(billing.stripeSubscriptionId || '');
  if (!subscriptionId) throw new Error('There is no active subscription on this account.');
  const subscription = await stripeRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    cancel_at_period_end: cancel ? 'true' : 'false',
  });
  billing.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  billing.cancelAt = secondsToMs(subscription.cancel_at) || null;
  if (secondsToMs(subscription.current_period_end)) {
    billing.periodEnd = secondsToMs(subscription.current_period_end);
  }
  user.updatedAt = now();
  save();
  log(
    billing.cancelAtPeriodEnd
      ? `Subscription for ${user.email || user.id} will end at the close of the paid period.`
      : `Subscription for ${user.email || user.id} was resumed before it ended.`,
    'info', user.id,
  );
  return {
    cancelAtPeriodEnd: billing.cancelAtPeriodEnd,
    cancelAt: billing.cancelAtPeriodEnd ? (billing.cancelAt || billing.periodEnd || null) : null,
    periodEnd: billing.periodEnd || null,
  };
}

export async function createPortalSession(user) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const customer = await ensureStripeCustomer(user);
  const session = await stripeRequest('/billing_portal/sessions', { customer, return_url: `${appBase()}/app?billing=portal` });
  return { id: session.id, url: session.url };
}

/**
 * What the configured signing secret LOOKS like -- never what it is.
 *
 * "Invalid Stripe signature" has two ordinary causes and the message cannot
 * tell them apart: the secret belongs to a different endpoint, or it picked up
 * whitespace on its way into Render's variable field. Both are one glance to
 * rule out and neither is visible from a phone at 3am, so the alert now carries
 * the shape of the value. Length, prefix and whitespace only: none of that is
 * secret material, and an alert mail is not a secure channel.
 */
export function webhookSecretNote() {
  const raw = String(process.env.STRIPE_WEBHOOK_SECRET || '');
  const value = raw.trim();
  if (!value) return 'STRIPE_WEBHOOK_SECRET is not set on Render at all.';
  const notes = [`${value.length} characters`];
  if (!value.startsWith('whsec_')) {
    notes.push('does NOT begin with whsec_, so it is probably not a signing secret at all');
  }
  if (raw !== value) {
    notes.push('had stray whitespace around it, which this build trims -- that alone may have been the fault');
  }
  return `The configured STRIPE_WEBHOOK_SECRET is ${notes.join('; ')}.`;
}

export function verifyStripeSignature(rawBody, signatureHeader) {
  if (!config.stripeWebhookSecret) {
    throw new Error('Stripe webhooks are not configured. Add STRIPE_WEBHOOK_SECRET in Render.');
  }
  const parts = String(signatureHeader || '').split(',').reduce((acc, part) => {
    const [key, value] = part.split('=');
    if (!acc[key]) acc[key] = [];
    acc[key].push(value);
    return acc;
  }, {});
  const timestamp = parts.t?.[0];
  const signatures = parts.v1 || [];
  if (!timestamp || !signatures.length) throw new Error('Missing Stripe signature.');
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > 300) throw new Error('Expired Stripe signature.');
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(signedPayload).digest('hex');
  const ok = signatures.some(sig => {
    const a = Buffer.from(String(sig || ''), 'hex');
    const b = Buffer.from(expected, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
  if (!ok) throw new Error('Invalid Stripe signature.');
  return JSON.parse(rawBody || '{}');
}

/*
 * Both of these refuse an empty id, and that guard is the whole point.
 *
 * Without it, `userBySubscription(undefined)` compares undefined against
 * `user.billing?.stripeSubscriptionId`, which is ALSO undefined for every
 * account that has a billing record but no subscription -- so the first such
 * account matched, and an invoice carrying no subscription id had its money
 * recorded against a stranger. Found while testing landing-page attribution:
 * the payment was credited to the wrong person entirely, which is a worse bug
 * than the one being looked for.
 */
function userByCustomer(customerId) {
  const id = String(customerId || '');
  if (!id) return null;
  return (state.authUsers || []).find(user => user.billing?.stripeCustomerId === id) || null;
}
function userBySubscription(subscriptionId) {
  const id = String(subscriptionId || '');
  if (!id) return null;
  return (state.authUsers || []).find(user => user.billing?.stripeSubscriptionId === id) || null;
}

function subscriptionPlan(subscription = {}) {
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id || subscription.plan?.id || '';
  return planForPrice(priceId) || subscription.metadata?.plan || 'free';
}

function updateFromSubscription(subscription = {}) {
  const userId = subscription.metadata?.userId || '';
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
  const user = (state.authUsers || []).find(item => item.id === userId) || userByCustomer(customerId) || userBySubscription(subscription.id);
  if (!user) return null;
  const billing = ensureUserBilling(user);
  const plan = subscriptionPlan(subscription);
  const oldPeriodStart = Number(billing.periodStart || 0);
  const nextPeriodStart = secondsToMs(subscription.current_period_start) || oldPeriodStart || now();
  billing.plan = plan;
  billing.status = subscription.status || 'active';
  billing.stripeCustomerId = customerId || billing.stripeCustomerId || '';
  billing.stripeSubscriptionId = subscription.id || billing.stripeSubscriptionId || '';
  billing.stripePriceId = subscription.items?.data?.[0]?.price?.id || billing.stripePriceId || '';
  billing.periodStart = nextPeriodStart;
  billing.periodEnd = secondsToMs(subscription.current_period_end) || (nextPeriodStart + periodMs(plan));
  // A cancellation that has not taken effect yet. Stripe keeps the
  // subscription active and sends `deleted` at period end, so this flag is the
  // ONLY signal that it is winding down -- without it a cancelled customer sees
  // "Current plan" with no end date and reasonably concludes it did not work.
  billing.cancelAtPeriodEnd = Boolean(subscription.cancel_at_period_end);
  billing.cancelAt = secondsToMs(subscription.cancel_at) || null;
  billing.trialStart = secondsToMs(subscription.trial_start) || billing.trialStart || null;
  billing.trialEnd = secondsToMs(subscription.trial_end) || billing.trialEnd || null;
  if (nextPeriodStart && nextPeriodStart !== oldPeriodStart) {
    billing.tokensUsed = 0;
  }
  user.updatedAt = now();
  save();
  log(`Billing updated for ${user.email || user.id}: ${plan} is ${billing.status}.`, 'info', user.id);
  return user;
}

function clearSubscription(subscription = {}) {
  const user = userBySubscription(subscription.id) || userByCustomer(typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id);
  if (!user || isUnlimited(user)) return null;
  const billing = ensureUserBilling(user);
  billing.plan = 'free';
  billing.status = 'cancelled';
  billing.stripeSubscriptionId = '';
  billing.stripePriceId = '';
  billing.periodStart = now();
  billing.periodEnd = null;
  billing.tokensUsed = 0;
  // It has happened; it is no longer pending.
  billing.cancelAtPeriodEnd = false;
  billing.cancelAt = null;
  save();
  log(`Billing cancelled for ${user.email || user.id}; reverted to free tokens.`, 'info', user.id);
  return user;
}

/**
 * Record what a payment was actually worth.
 *
 * The webhook handler used to receive invoice.paid and keep nothing but the
 * fact of it -- so the product knew a customer had paid and never how much.
 * There was no figure anywhere in the app to answer "what came in this month",
 * which is why the owner dashboard has to ask Stripe for history.
 *
 * Amounts are stored in minor units exactly as Stripe sends them (cents), with
 * the currency beside them. Never as a float: 17.99 + 6.99 in binary floating
 * point is not 24.98, and a money total that is wrong in the last cent is a
 * money total nobody trusts.
 *
 * Stripe is still the authority for history -- this only accrues from now on,
 * and is what lets the dashboard show revenue when Stripe is unreachable.
 */
function recordRevenue({ kind, userId = '', amountMinor = 0, currency = '', description = '', stripeId = '', eventId = '' }) {
  const amount = Math.round(Number(amountMinor) || 0);
  if (!amount) return;
  ensureBillingState();
  // Same guard the event log uses: a replayed webhook must not double-count
  // money, and Stripe retries on any non-2xx.
  if (stripeId && state.revenueEvents.some(item => item?.stripeId === stripeId)) return;
  state.revenueEvents.unshift({
    id: `rev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`,
    kind, userId, amountMinor: amount,
    currency: String(currency || '').toLowerCase(),
    description, stripeId, eventId, createdAt: now(),
  });
  state.revenueEvents = state.revenueEvents.slice(0, 5000);

  // Credit the page that earned it.
  //
  // A Stripe webhook carries no cookie, so the landing path cannot come from
  // the request -- it comes off the account, where it was stamped at sign-up.
  // That is the whole reason the field exists rather than the cookie alone.
  //
  // Counted once per account: a subscription renewing every month is not the
  // landing page earning a new customer every month, and counting it that way
  // would make the oldest page look like the best one.
  try {
    const user = (state.authUsers || []).find(item => item?.id === userId);
    if (user?.signupLanding && !user.landingCredited) {
      user.landingCredited = true;
      // The conversion itself, recorded once, so "which page produced paying
      // customers" can be answered with the plan and the first amount rather
      // than a bare count. Renewals do NOT reach here -- landingCredited is
      // already true -- which is what keeps new-customer acquisition separate
      // from recurring revenue.
      user.convertedAt = now();
      // The invite discount is spent HERE, on a real payment — not when the
      // checkout page was opened. Otherwise anyone could burn a referrer's
      // three by opening three checkouts and closing them.
      if (referrals.markDiscountUsed(user)) metrics.event('referral_discount_used');
      user.firstPaidAmountMinor = Math.round(Number(amountMinor) || 0);
      user.firstPaidCurrency = String(currency || '').toLowerCase();
      user.firstPaidPlan = String(user.billing?.plan || '');
      metrics.attribute('paid', user.signupLanding);
    }
  } catch { /* attribution must never fail a payment */ }
}

// Comfortably past Stripe's retry schedule, which runs for about three days.
// Anything inside this window must still be recognised as already handled.
const STRIPE_DEDUPE_WINDOW_MS = 10 * 24 * 60 * 60_000;

export function handleWebhookEvent(event) {
  ensureBillingState();
  const eventId = String(event?.id || '');
  if (!eventId) throw new Error('Invalid Stripe event.');
  if (state.processedStripeEvents.some(item => item?.id === eventId)) return { ok: true, duplicate: true };
  const object = event?.data?.object || {};
  switch (event?.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded': {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      const user = (state.authUsers || []).find(item => item.id === object.metadata?.userId) || userByCustomer(customerId);
      if (user) {
        const userBilling = ensureUserBilling(user);
        userBilling.stripeCustomerId = customerId || userBilling.stripeCustomerId || '';
        if (object.metadata?.kind === 'token_topup' || object.mode === 'payment') {
          if (object.payment_status !== 'paid') break;
          const packageId = object.metadata?.package || topupForPrice(object.line_items?.data?.[0]?.price?.id)?.id;
          if (packageId) recordRevenue({
            kind: 'topup', userId: user.id,
            amountMinor: object.amount_total, currency: object.currency,
            description: topups()[packageId]?.name || packageId,
            stripeId: String(object.id || ''), eventId,
          });
          if (packageId) ownerFeed.revenue('topup', user, object.amount_total, object.currency, topups()[packageId]?.name || packageId).catch(() => {});
          if (packageId) grantTopup(user, packageId, {
            sessionId: object.id,
            eventId,
            paymentIntentId: typeof object.payment_intent === 'string' ? object.payment_intent : object.payment_intent?.id,
            customerId,
          });
        } else {
          userBilling.stripeSubscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id || userBilling.stripeSubscriptionId || '';
          userBilling.plan = object.metadata?.plan || userBilling.plan || 'free';
          userBilling.status = 'checkout_complete';
          save();
          ownerFeed.subscriptionStarted(user, userBilling.plan).catch(() => {});
        }
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      updateFromSubscription(object);
      break;
    case 'customer.subscription.deleted': {
      const gone = userBySubscription(typeof object.id === 'string' ? object.id : '');
      clearSubscription(object);
      ownerFeed.subscriptionEnded(gone).catch(() => {});
      break;
    }
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      const user = userBySubscription(subscriptionId) || userByCustomer(typeof object.customer === 'string' ? object.customer : object.customer?.id);
      if (user) { ensureUserBilling(user); save(); }
      // Recorded whether or not the invoice maps to a known account: money that
      // arrived is money that arrived, and dropping it because the customer
      // lookup missed would understate revenue.
      recordRevenue({
        kind: 'subscription', userId: user?.id || '',
        amountMinor: object.amount_paid, currency: object.currency,
        description: object.lines?.data?.[0]?.description || 'Subscription invoice',
        stripeId: String(object.id || ''), eventId,
      });
      ownerFeed.revenue('invoice', user, object.amount_paid, object.currency,
        object.lines?.data?.[0]?.description || 'Subscription invoice').catch(() => {});
      break;
    }
    case 'invoice.payment_failed': {
      const user = userByCustomer(typeof object.customer === 'string' ? object.customer : object.customer?.id);
      if (user && !isUnlimited(user)) { const billing = ensureUserBilling(user); billing.status = 'past_due'; save(); }
      ownerFeed.paymentFailed(user).catch(() => {});
      break;
    }
    default:
      break;
  }
  state.processedStripeEvents.unshift({ id: eventId, type: String(event.type || ''), objectId: String(object.id || ''), processedAt: now() });
  // Trimmed by AGE, not by count.
  //
  // A flat cap of 1000 is the wrong axis: Stripe retries a failed delivery over
  // a window measured in days, so what decides whether a replay is still
  // recognised is how long ago it arrived, not how many events came after it.
  // At a thousand events inside that window -- a busy few days, which is the
  // point of going public -- the oldest fell off the list and a retry of it
  // would have been processed a second time. For a top-up that is tokens
  // granted twice.
  //
  // The window is well past Stripe's own retry schedule, and the count cap
  // stays only as a backstop against unbounded growth.
  const dedupeFloor = now() - STRIPE_DEDUPE_WINDOW_MS;
  state.processedStripeEvents = state.processedStripeEvents
    .filter(item => Number(item?.processedAt || 0) >= dedupeFloor)
    .slice(0, 20000);
  save();
  return { ok: true };
}

export function markPlansSeen(user) {
  ensureBillingState();
  if (!user) return null;
  const billing = ensureUserBilling(user);
  billing.plansSeenAt = now();
  user.updatedAt = now();
  save();
  return billing;
}

export function needsPlanChoice(user) {
  ensureBillingState();
  if (!user || isUnlimited(user)) return false;
  const billing = ensureUserBilling(user);
  if (billing.plansSeenAt || billing.stripeSubscriptionId) return false;
  return true;
}

function safeReturn(value = '/') {
  const raw = String(value || '/').trim() || '/';
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/auth/') || raw.startsWith('/login') || raw.startsWith('/plans') || /[\r\n]/.test(raw)) return '/';
  return raw;
}

export function postLoginRedirect(user, returnTo = '/') {
  const destination = safeReturn(returnTo);
  return needsPlanChoice(user) ? `/plans?returnTo=${encodeURIComponent(destination)}` : destination;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

export function plansPage(user, { error = '', info = '', returnTo = '/' } = {}) {
  ensureBillingState();
  const bill = publicBilling(user);
  const cur = bill.current || {};
  const trialDays = Math.max(0, Number(bill.trialDays || 0));
  const trialTokens = Math.max(0, Number(bill.trialTokens || 0));
  // Say the trial's real size on the card. A plan that advertises 6000 tokens
  // and hands a trial 75 is a surprise the customer finds after paying nothing
  // and getting stuck.
  const trialLine = !trialDays
    ? 'Starts immediately'
    : trialTokens
      ? `${trialDays}-day trial with ${trialTokens} tokens, then your full allowance`
      : `${trialDays}-day trial when shown at checkout`;
  const returnValue = esc(safeReturn(returnTo));
  // Three tier columns, each carrying its own three periods, rather than six
  // flat cards in a row. A period is a way to PAY for a tier, not a product of
  // its own -- laid out flat, "Pro Weekly" and "Studio Yearly" sit side by side
  // as though a customer were choosing between them.
  const tierColumn = tier => {
    const periods = PERIOD_ORDER.map(period => bill.plans?.[`${tier}_${period}`]).filter(Boolean);
    if (!periods.length) return '';
    const monthly = periods.find(plan => plan.period === 'monthly') || periods[0];
    const onThis = periods.some(plan => plan.id === normalisePlanId(cur.plan) && cur.status !== 'free');
    const adds = tier === 'studio' ? Object.values(STUDIO_FEATURES) : Object.values(PRO_FEATURES);
    // One price and one button per card, in three variants. Only the variant
    // matching the switch at the top of the page is displayed -- three price
    // buttons stacked inside every card was the clutter this replaced.
    const period = periods.map(plan => {
      const configured = Boolean(plan.priceId);
      const current = normalisePlanId(cur.plan) === plan.id && cur.status !== 'free';
      // Spelled out rather than derived: 'weekly'.replace('ly','') is 'week',
      // and patching around that turned every weekly button into "a year".
      const each = { weekly: 'week', monthly: 'month', yearly: 'year' }[plan.period] || plan.period;
      const cta = current ? 'Current plan' : configured ? `Choose ${esc(TIERS[tier].name)}` : 'Opening soon';
      return {
        money: `<div class="money per-${plan.period}">${configured ? esc(plan.priceLabel || '') : 'Soon'}<small> / ${esc(each)}</small></div>`,
        tokens: `<div class="tokens per-${plan.period}"><b>${esc(Number(plan.tokens).toLocaleString())}</b><span>tokens every ${esc(each)}</span></div>`,
        form: `<form class="per-${plan.period}" method="post" action="/billing/checkout">
          <input type="hidden" name="plan" value="${esc(plan.id)}">
          <input type="hidden" name="returnTo" value="${returnValue}">
          <button type="submit" ${configured && !current ? '' : 'disabled'}>${cta}</button>
        </form>`,
      };
    });
    const moneyRows = period.map(row => row.money).join('');
    const tokenRows = period.map(row => row.tokens).join('');
    const buttons = period.map(row => row.form).join('');
    return `<article class="dc-plan ${tier === 'pro' ? 'featured' : ''}">
      <div class="plan-top"><span class="badge">${esc(TIERS[tier].badge)}</span>${onThis ? '<span class="popular">Your plan</span>' : ''}</div>
      <h2>${esc(TIERS[tier].name)}</h2>
      <p>${esc(TIERS[tier].tagline)}</p>
      ${moneyRows}
      ${tokenRows}
      <ul><li>Everything in ${tier === 'studio' ? 'Pro' : 'Basic'}, plus:</li>${adds.map(line => `<li>${esc(line)}</li>`).join('')}<li>${esc(trialLine)}</li></ul>
      ${buttons}
    </article>`;
  };

  const basicCard = `<article class="dc-plan">
    <div class="plan-top"><span class="badge">${esc(TIERS.basic.badge)}</span>${cur.status === 'free' || !cur.plan || cur.plan === 'free' ? '<span class="popular">Your plan</span>' : ''}</div>
    <h2>${esc(TIERS.basic.name)}</h2>
    <p>${esc(TIERS.basic.tagline)}</p>
    <div class="money">Free<small> / ${esc(String(trialDays || 3))} days</small></div>
    <div class="tokens"><b>${esc(String(bill.plans?.free?.tokens ?? 0))}</b><span>tokens to try it with</span></div>
    <ul>${FREE_INCLUDES.map(line => `<li>${esc(line)}</li>`).join('')}</ul>
    <button type="button" disabled>Where you start</button>
  </article>`;

  const planCards = basicCard + tierColumn('pro') + tierColumn('studio');
  const topupCards = TOPUP_ORDER.map(id => bill.topups?.[id]).filter(Boolean).map(pack => {
    const configured = Boolean(pack.priceId);
    return `<article class="dc-topup ${pack.id === 'boost300' ? 'featured' : ''}">
      <span class="badge">${esc(pack.badge || 'Top-up')}</span>
      <div><h3>${esc(pack.name)}</h3><p>${esc(pack.description)}</p></div>
      <div class="topup-value"><b>+${esc(pack.tokens)}</b><span>tokens</span></div>
      <div class="topup-price">${esc(pack.priceLabel || 'Set price')}<small> one-time</small></div>
      <form method="post" action="/billing/topup"><input type="hidden" name="package" value="${esc(pack.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit" ${configured && !cur.unlimited ? '' : 'disabled'}>${cur.unlimited ? 'Unlimited owner account' : configured ? 'Add tokens' : 'Stripe price required'}</button></form>
    </article>`;
  }).join('');
  const remaining = cur.unlimited ? '∞' : Math.round(Number(cur.remaining || 0));
  const pct = cur.unlimited ? 100 : Math.max(4, Math.min(100, (Number(cur.used || 0) / Math.max(1, Number(cur.allowance || 1))) * 100));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Plans & token shop · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#070708;--panel:#111113;--panel2:#18181c;--line:rgba(255,255,255,.10);--text:#faf8f3;--muted:#aaa6a0;--gold:#e4bc71;--gold2:#f2d696;--green:#59d493;--red:#ef6b7a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -8%,rgba(228,188,113,.18),transparent 32%),radial-gradient(circle at 8% 38%,rgba(70,112,120,.08),transparent 24%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);padding:26px}.wrap{width:min(1240px,100%);margin:0 auto}.top{height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:42px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.logo{width:43px;height:43px;border-radius:14px;display:grid;place-items:center;border:1px solid rgba(228,188,113,.34);background:linear-gradient(145deg,#2a251d,#0c0c0e);color:var(--gold);font-weight:950}.brand strong,.brand span{display:block}.brand strong{font-size:16px}.brand span{font-size:11px;color:var(--muted);margin-top:2px}.account{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px}.ghost{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}.hero{text-align:center;max-width:760px;margin:0 auto 26px}.eyebrow{display:inline-flex;min-height:30px;align-items:center;padding:0 12px;border-radius:999px;border:1px solid rgba(228,188,113,.28);background:rgba(228,188,113,.08);color:var(--gold2);font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:clamp(30px,4vw,46px);line-height:1.04;letter-spacing:-.045em;margin:14px 0 10px}.hero p{color:var(--muted);font-size:14px;line-height:1.6;margin:0}.wallet{padding:20px 22px;margin:0 0 26px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.018));box-shadow:0 24px 70px rgba(0,0,0,.26)}
.wallet-top{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.wallet-top strong{font-size:13px;font-weight:700}
.wallet-plan{min-height:24px;padding:0 10px;display:inline-flex;align-items:center;border-radius:999px;border:1px solid rgba(228,188,113,.28);background:rgba(228,188,113,.08);color:var(--gold2);font-size:10px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.wallet-facts{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;background:var(--line);border-radius:14px;overflow:hidden}
.wallet-fact{padding:14px 16px;background:#0d0d0f}
.wallet-fact span{display:block;font-size:9.5px;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.wallet-fact b{display:block;margin-top:6px;font-size:26px;font-weight:900;letter-spacing:-.04em;line-height:1.05}
.wallet-fact i{display:block;margin-top:4px;font-size:11px;font-style:normal;color:var(--muted);line-height:1.45}
.bar{height:6px;background:#26262b;border-radius:999px;overflow:hidden;margin-top:16px}.bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--gold),var(--gold2));width:${pct}%}.section-title{text-align:center;max-width:720px;margin:56px auto 24px}.section-title span{font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:var(--gold2)}.section-title h2{font-size:26px;letter-spacing:-.035em;margin:8px 0}.section-title p{color:var(--muted);font-size:14px;margin:0}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.dc-plan,.dc-topup{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.048),rgba(255,255,255,.018));padding:28px 26px;display:flex;flex-direction:column;gap:16px;position:relative}.dc-plan.featured,.dc-topup.featured{border-color:rgba(228,188,113,.47);box-shadow:0 0 0 1px rgba(228,188,113,.10) inset,0 26px 75px rgba(228,188,113,.06)}.plan-top{display:flex;justify-content:space-between;align-items:center}.badge,.popular{min-height:24px;padding:0 9px;display:inline-flex;align-items:center;border-radius:999px;background:rgba(228,188,113,.10);color:var(--gold2);font-size:9px;font-weight:850}.popular{background:var(--gold);color:#171108}.dc-plan h2,.dc-topup h3{font-size:23px;margin:0;letter-spacing:-.02em}.money{font-size:35px;font-weight:950;letter-spacing:-.055em}.money small,.topup-price small{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:0}.dc-plan p,.dc-topup p{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0}.dc-plan>p{min-height:40px}.tokens{padding:16px;border-radius:15px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}.tokens b,.tokens span{display:block}.tokens b{font-size:24px}.tokens span{font-size:10px;color:var(--muted);margin-top:2px}.dc-plan ul{margin:0;padding:0;list-style:none;display:grid;gap:12px;color:#d5d0c8;font-size:12.5px;line-height:1.5}.dc-plan li:before{content:'✓';color:var(--green);margin-right:8px}.dc-plan button,.dc-topup button,.free button{width:100%;height:46px;border:0;border-radius:13px;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#171108;font-weight:850;cursor:pointer;margin-top:auto}@keyframes dcRise{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}@keyframes dcPrice{from{opacity:0;transform:translateY(-7px)}to{opacity:1;transform:none}}@keyframes dcFade{from{opacity:0}to{opacity:1}}.hero,.wallet,.section-title,.period-switch,.free{animation:dcFade .5s ease both}.dc-topup{animation:dcRise .55s cubic-bezier(.2,.8,.2,1) both}.dc-plan,.dc-topup{transition:transform .2s ease,border-color .2s ease,box-shadow .2s ease}.topups .dc-topup:nth-child(2){animation-delay:.08s}.topups .dc-topup:nth-child(3){animation-delay:.16s}.dc-plan:hover{transform:translateY(-5px);border-color:rgba(228,188,113,.42);box-shadow:0 32px 66px rgba(0,0,0,.46)}.dc-topup:hover{transform:translateY(-4px);border-color:rgba(228,188,113,.34)}@keyframes dcSlideA{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}@keyframes dcSlideB{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}@keyframes dcSlideC{from{opacity:0;transform:translateX(34px)}to{opacity:1;transform:none}}#per-weekly:checked~.plans .dc-plan{animation:dcSlideA .38s cubic-bezier(.2,.8,.2,1) both}#per-monthly:checked~.plans .dc-plan{animation:dcSlideB .38s cubic-bezier(.2,.8,.2,1) both}#per-yearly:checked~.plans .dc-plan{animation:dcSlideC .38s cubic-bezier(.2,.8,.2,1) both}.plans .dc-plan:nth-child(2){animation-delay:.05s!important}.plans .dc-plan:nth-child(3){animation-delay:.1s!important}.dc-plan button,.dc-topup button{transition:transform .16s ease,filter .16s ease,box-shadow .16s ease}.dc-plan button:not(:disabled):hover,.dc-topup button:not(:disabled):hover{transform:translateY(-2px);filter:brightness(1.07);box-shadow:0 14px 30px rgba(228,188,113,.22)}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}.dcperiod{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}.period-switch{position:relative;display:flex;align-items:center;justify-content:center;gap:4px;width:max-content;max-width:100%;margin:0 auto 26px;padding:4px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.03)}.period-switch label{position:relative;z-index:1;width:104px;text-align:center;padding:10px 0;border-radius:999px;font-size:12.5px;font-weight:850;color:var(--muted);cursor:pointer;transition:color .18s ease}.period-switch label:hover{color:var(--text)}.period-switch::before{content:'';position:absolute;top:4px;left:4px;width:104px;height:calc(100% - 8px);border-radius:999px;background:linear-gradient(135deg,var(--gold2),var(--gold));transition:transform .32s cubic-bezier(.2,.8,.2,1)}.period-note{display:none;text-align:center;margin:-8px auto 16px;font-size:11.5px;font-weight:700;color:var(--gold2)}#per-weekly:checked~.period-switch label[for=per-weekly],#per-monthly:checked~.period-switch label[for=per-monthly],#per-yearly:checked~.period-switch label[for=per-yearly]{color:#171108}#per-weekly:checked~.period-switch::before{transform:translateX(0)}#per-monthly:checked~.period-switch::before{transform:translateX(108px)}#per-yearly:checked~.period-switch::before{transform:translateX(216px)}#per-yearly:checked~.period-note{display:block}.dcperiod:focus-visible~.period-switch{outline:2px solid var(--gold2);outline-offset:3px}.plans .per-weekly,.plans .per-monthly,.plans .per-yearly{display:none}#per-weekly:checked~.plans .per-weekly,#per-monthly:checked~.plans .per-monthly,#per-yearly:checked~.plans .per-yearly{display:block}.dc-plan form{margin-top:auto}.dc-plan button:disabled,.dc-topup button:disabled{opacity:.42;cursor:not-allowed}.topups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:22px}.topup-value b,.topup-value span{display:block}.topup-value b{font-size:38px;letter-spacing:-.055em}.topup-value span{font-size:11px;color:var(--muted)}.topup-price{font-size:20px;font-weight:850}.shop-note{text-align:center;color:var(--muted);font-size:12px;margin:16px auto 0;max-width:760px}.free{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding:17px 20px;border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.025)}.free strong,.free span{display:block}.free span{color:var(--muted);font-size:12px;margin-top:3px}.free button{width:auto;min-width:210px;background:#0e0e10;color:var(--text);border:1px solid var(--line)}.alerts{margin-bottom:14px}.alert{padding:12px 14px;border-radius:14px;font-size:12px;margin-bottom:8px}.alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.25);color:#ffb7bf}.alert.good{background:rgba(89,212,147,.1);border:1px solid rgba(89,212,147,.25);color:#baffd5}.foot{text-align:center;color:var(--muted);font-size:11px;line-height:1.65;margin:28px auto 8px;max-width:850px}@media(max-width:900px){body{padding:16px}.plans,.topups,.wallet{grid-template-columns:1fr}.hero h1{font-size:42px}.top{height:auto;align-items:flex-start;flex-direction:column;margin-bottom:30px}.free{align-items:stretch;flex-direction:column}.free button{width:100%}}@media(max-width:560px){.account span{display:none}.hero h1{font-size:38px}.wallet-main,.wallet-rule,.dc-plan,.dc-topup{border-radius:19px}}
  </style></head><body><main class="wrap"><div class="top"><a class="brand" href="/"><div class="logo">DC</div><div><strong>DeenClipped</strong><span>Plans & token shop</span></div></a><div class="account"><span>${esc(user?.email || user?.name || 'Signed in')}</span><a class="ghost" href="/app">Dashboard</a><form method="post" action="/auth/logout"><button class="ghost" type="submit">Log out</button></form></div></div><div class="alerts">${error ? `<div class="alert bad">${esc(error)}</div>` : ''}${info ? `<div class="alert good">${esc(info)}</div>` : ''}</div><section class="hero"><span class="eyebrow">Simple, affordable creator pricing</span><h1>Choose a plan. Add tokens only when you need them.</h1><p>DeenClipped keeps pricing tied to selected source minutes. Your subscription refreshes normally, while one-time top-up tokens stay in your wallet until you use them.</p></section><section class="wallet"><div class="wallet-top"><strong>Your wallet</strong><span class="wallet-plan">${esc(cur.plan || 'free')} plan</span></div><div class="wallet-facts"><div class="wallet-fact"><span>Available now</span><b>${esc(remaining)}</b><i>tokens you can spend today</i></div><div class="wallet-fact"><span>Used this period</span><b>${cur.unlimited ? '\u2014' : esc(String(Math.round(Number(cur.used || 0))))}</b><i>${cur.unlimited ? 'no usage limit on this plan' : 'resets when the plan renews'}</i></div><div class="wallet-fact"><span>Top-ups</span><b>${cur.unlimited ? '\u221e' : esc(String(Math.round(Number(cur.bonusTokens || 0))))}</b><i>bought tokens, never expire</i></div><div class="wallet-fact"><span>What it costs</span><b>${esc(String(bill.tokenRatePerMinute || 1))}/min</b><i>only the range you select is charged</i></div></div><div class="bar"><i></i></div></section><div class="section-title"><span>Subscriptions</span><h2>Built for different posting rhythms.</h2><p>Start small, publish consistently, or lock in the best annual value.</p></div><input type="radio" name="dcperiod" id="per-weekly" class="dcperiod"><input type="radio" name="dcperiod" id="per-monthly" class="dcperiod" checked><input type="radio" name="dcperiod" id="per-yearly" class="dcperiod"><div class="period-switch"><label for="per-weekly">Weekly</label><label for="per-monthly">Monthly</label><label for="per-yearly">Yearly</label></div><p class="period-note">Two months free on every yearly plan</p><section class="plans">${planCards}</section><div class="section-title"><span>Token shop</span><h2>Need more without changing your plan?</h2><p>Buy a one-time token pack. Top-up tokens are added to your current wallet and do not disappear at your next renewal.</p></div><section class="topups" id="token-shop">${topupCards}</section><p class="shop-note">Token packs are optional and available alongside free, weekly, monthly and yearly plans. Stripe shows the final total before payment.</p><section class="free"><div><strong>Not ready to subscribe?</strong><span>Continue with free starter tokens and return to Plans & tokens from the dashboard whenever you need more.</span></div><form method="post" action="/billing/continue-free"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit">Continue with free tokens</button></form></section><div class="foot">Payments are handled by Stripe. DeenClipped does not store complete card details. Prices shown are configuration-driven labels and Stripe shows the final amount before payment.</div></main></body></html>`;
}
