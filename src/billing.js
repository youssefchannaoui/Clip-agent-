import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save, log } from './store.js';

const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
const secondsToMs = value => Math.max(0, Number(value || 0) * 1000);
const cleanEmail = value => String(value || '').trim().toLowerCase();

// Carries a machine-readable reason so the dashboard can show the right
// upsell instead of dumping a sentence into a toast.
export class BillingError extends Error {
  constructor(message, code = 'billing_error', details = {}) {
    super(message);
    this.name = 'BillingError';
    this.code = code;
    Object.assign(this, details);
  }
}

export const PLAN_ORDER = ['weekly', 'monthly', 'yearly'];
export const TOPUP_ORDER = ['boost100', 'boost300', 'boost750'];

function periodMs(interval) {
  if (interval === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  if (interval === 'yearly') return 365 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

export function trialAllowed(planId) {
  if (!(config.stripeTrialDays > 0)) return false;
  return config.trialPlans.includes(String(planId || '').toLowerCase());
}

export function plans() {
  return {
    free: {
      id: 'free', name: 'Free', interval: 'one-time', badge: 'Test drive',
      tokens: config.tokensFree, priceId: '', enabled: true,
      days: config.freeTierDays,
      description: config.freeTierDays > 0
        ? `Try the studio free for ${config.freeTierDays} days.`
        : 'Try the studio before upgrading.',
    },
    weekly: {
      id: 'weekly', name: 'Weekly', interval: 'week', badge: 'Start small',
      tokens: config.tokensWeekly, priceId: config.stripePriceWeekly, priceLabel: config.planPriceWeeklyLabel,
      enabled: Boolean(config.stripePriceWeekly), trialEligible: trialAllowed('weekly'),
      description: 'Affordable access for occasional lecture clipping.',
    },
    monthly: {
      id: 'monthly', name: 'Monthly', interval: 'month', badge: '',
      tokens: config.tokensMonthly, priceId: config.stripePriceMonthly, priceLabel: config.planPriceMonthlyLabel,
      listPriceLabel: config.planPriceMonthlyListLabel,
      enabled: Boolean(config.stripePriceMonthly), trialEligible: trialAllowed('monthly'),
      description: 'The best balance for creators posting consistently.',
    },
    yearly: {
      id: 'yearly', name: 'Yearly', interval: 'year', badge: 'Best value',
      tokens: config.tokensYearly, priceId: config.stripePriceYearly, priceLabel: config.planPriceYearlyLabel,
      enabled: Boolean(config.stripePriceYearly), trialEligible: trialAllowed('yearly'),
      description: 'The lowest long-term cost for regular publishing.',
    },
  };
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
      badge: 'Best seller', description: 'Extra room for a busy week without changing your plan.',
      enabled: Boolean(config.stripePriceTopup300),
    },
    boost750: {
      id: 'boost750', name: 'Studio boost', tokens: 750,
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
  const plan = plans()[planId] || plans().free;
  return Math.max(0, Number(plan.tokens || 0));
}

export function tokenRate() {
  return Math.max(0.1, Number(config.tokensPerMinute || 1));
}

export function tokenCostForSeconds(seconds = 0) {
  return Math.max(1, Math.ceil((Math.max(0, Number(seconds) || 0) / 60) * tokenRate()));
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
  // The free grant is a trial of the product, not a standing entitlement.
  // Stamped once, at first sight of the account, and never extended.
  if (billing.plan === 'free' && !billing.freeExpiresAt && config.freeTierDays > 0) {
    billing.freeExpiresAt = Number(billing.periodStart) + config.freeTierDays * DAY_MS;
  }
  billing.periodEnd ||= billing.plan === 'free' || billing.plan === 'admin'
    ? null
    : billing.periodStart + periodMs(billing.plan);

  if (!isUnlimited(user) && billing.periodEnd && now() > Number(billing.periodEnd)) {
    billing.periodStart = now();
    billing.periodEnd = now() + periodMs(billing.plan);
    billing.tokensUsed = 0;
    billing.tokensReserved = 0;
  }
  return billing;
}

export function freeTierState(billing = {}) {
  const onFree = String(billing.plan || 'free') === 'free';
  const expiresAt = Number(billing.freeExpiresAt || 0) || null;
  if (!onFree || !expiresAt) {
    return { onFree, expiresAt: null, expired: false, daysLeft: null };
  }
  return {
    onFree: true,
    expiresAt,
    expired: expiresAt <= now(),
    daysLeft: daysRemaining(expiresAt),
  };
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
  const allow = unlimited ? Infinity : allowance(currentPlan);
  const used = Number(billing.tokensUsed || 0);
  const reserved = Number(billing.tokensReserved || 0);
  const bonusTokens = Math.max(0, Number(billing.bonusTokens || 0));
  const trial = trialState(billing);
  const freeTier = unlimited ? { onFree: false, expiresAt: null, expired: false, daysLeft: null } : freeTierState(billing);
  const baseRemaining = unlimited ? null : Math.max(0, allow - used - reserved);
  const remaining = unlimited ? null : baseRemaining + bonusTokens;
  const periodEndsInDays = billing.periodEnd ? daysRemaining(billing.periodEnd) : null;
  const notices = [];
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
  if (freeTier.onFree && freeTier.expired) {
    notices.push({
      id: `free-expired-${freeTier.expiresAt}`,
      kind: 'free_expired',
      title: 'Your free trial has ended',
      message: `The free tier runs for ${config.freeTierDays} days. Choose a plan to keep generating clips — your existing clips stay where they are.`,
      action: 'Choose plan',
    });
  } else if (freeTier.onFree && freeTier.daysLeft !== null && freeTier.daysLeft <= 1) {
    notices.push({
      id: `free-ending-${freeTier.expiresAt}`,
      kind: 'free_ending',
      title: freeTier.daysLeft === 0 ? 'Free access ends today' : 'Free access ends tomorrow',
      message: 'Pick a plan to keep your studio open.',
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
    terms: [
      `${tokenRate()} token per source video minute`,
      'Tokens are charged after the source duration is known',
      'Template updates and rerenders are free',
      `${config.stripeTrialDays || 7}-day trial on ${config.trialPlans.join(' and ')} plans`,
      'Unused trial access does not roll into another trial',
      'Purchased top-up tokens do not expire when a subscription renews',
    ],
    current: {
      plan: currentPlan,
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
      trial,
      freeTier,
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
  const freeTier = info.current.freeTier || {};
  // Checked before the balance: an expired free account is blocked even if
  // it still shows unspent tokens.
  if (freeTier.onFree && freeTier.expired) {
    throw new BillingError(
      `Your ${config.freeTierDays}-day free trial has ended. Choose a plan to ${action}.`,
      'free_expired',
      { needed, remaining, plan: info.current.plan, expiredAt: freeTier.expiresAt },
    );
  }
  if (remaining < needed) {
    throw new BillingError(
      `Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}.`,
      'insufficient_tokens',
      { needed, remaining, shortfall: needed - remaining, plan: info.current.plan },
    );
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

export function chargeTokens(userId, tokens, reason = 'usage', meta = {}) {
  ensureBillingState();
  const user = (state.authUsers || []).find(item => item.id === userId);
  if (!user || isUnlimited(user)) return { charged: 0, unlimited: true };
  const billing = ensureUserBilling(user);
  const amount = Math.max(1, Math.ceil(Number(tokens || 0)));
  const planAllowance = allowance(billing.plan || 'free');
  const usedBefore = Math.max(0, Number(billing.tokensUsed || 0));
  const reserved = Math.max(0, Number(billing.tokensReserved || 0));
  const baseAvailable = Math.max(0, planAllowance - usedBefore - reserved);
  const bonusAvailable = Math.max(0, Number(billing.bonusTokens || 0));
  if (baseAvailable + bonusAvailable < amount) {
    throw new Error(`Not enough tokens. This charge needs ${amount}, but only ${baseAvailable + bonusAvailable} are available.`);
  }
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
  log(`Charged ${amount} token${amount === 1 ? '' : 's'} to ${user.email || user.id} for ${reason}.`);
  return { charged: amount, unlimited: false, event };
}

export function chargeSourceMinutes(userId, seconds, meta = {}) {
  const tokens = tokenCostForSeconds(seconds);
  return chargeTokens(userId, tokens, 'source minutes', { seconds: Math.round(Number(seconds || 0)), ...meta });
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

async function ensureStripeCustomer(user) {
  const billing = ensureUserBilling(user);
  if (billing.stripeCustomerId) return billing.stripeCustomerId;
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

export async function createCheckoutSession(user, planId) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const plan = plans()[planId];
  if (!plan || !PLAN_ORDER.includes(plan.id)) throw new Error('Choose weekly, monthly, or yearly.');
  if (!plan.priceId) throw new Error(`${plan.name} does not have a Stripe price ID configured yet.`);
  const customer = await ensureStripeCustomer(user);
  const params = {
    mode: 'subscription',
    customer,
    success_url: `${appBase()}/app?billing=success`,
    cancel_url: `${appBase()}/plans?billing=cancelled`,
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': '1',
    'metadata[userId]': user.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][userId]': user.id,
    'subscription_data[metadata][plan]': plan.id,
  };
  // A coupon and customer-entered promo codes are mutually exclusive in
  // Stripe. The Monthly coupon turns the A$34.99 list price into the
  // A$29.99 the page advertises, so it has to be applied server-side --
  // leaving it to the customer to type would bill them the list price.
  const coupon = plan.id === 'monthly' ? config.stripeCouponMonthly : '';
  if (coupon) params['discounts[0][coupon]'] = coupon;
  else params.allow_promotion_codes = 'true';
  if (trialAllowed(plan.id)) params['subscription_data[trial_period_days]'] = String(config.stripeTrialDays);
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
    remaining: Math.max(0, allowance(billing.plan || 'free') - Number(billing.tokensUsed || 0) - Number(billing.tokensReserved || 0)) + billing.bonusTokens,
    message: `${pack.tokens} top-up tokens added to your wallet.`,
  };
  state.billingEvents.unshift(event);
  state.billingEvents = state.billingEvents.slice(0, 500);
  user.updatedAt = now();
  save();
  log(`Added ${pack.tokens} top-up tokens to ${user.email || user.id}.`);
  return { granted: pack.tokens, balance: billing.bonusTokens, event };
}

export async function createPortalSession(user) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const customer = await ensureStripeCustomer(user);
  const session = await stripeRequest('/billing_portal/sessions', { customer, return_url: `${appBase()}/app?billing=portal` });
  return { id: session.id, url: session.url };
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

function userByCustomer(customerId) {
  return (state.authUsers || []).find(user => user.billing?.stripeCustomerId === customerId) || null;
}
function userBySubscription(subscriptionId) {
  return (state.authUsers || []).find(user => user.billing?.stripeSubscriptionId === subscriptionId) || null;
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
  billing.trialStart = secondsToMs(subscription.trial_start) || billing.trialStart || null;
  billing.trialEnd = secondsToMs(subscription.trial_end) || billing.trialEnd || null;
  if (nextPeriodStart && nextPeriodStart !== oldPeriodStart) {
    billing.tokensUsed = 0;
    billing.tokensReserved = 0;
  }
  user.updatedAt = now();
  save();
  log(`Billing updated for ${user.email || user.id}: ${plan} is ${billing.status}.`);
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
  billing.tokensReserved = 0;
  save();
  log(`Billing cancelled for ${user.email || user.id}; reverted to free tokens.`);
  return user;
}

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
        }
      }
      break;
    }
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      updateFromSubscription(object);
      break;
    case 'customer.subscription.deleted':
      clearSubscription(object);
      break;
    case 'invoice.paid':
    case 'invoice.payment_succeeded': {
      const subscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id;
      const user = userBySubscription(subscriptionId) || userByCustomer(typeof object.customer === 'string' ? object.customer : object.customer?.id);
      if (user) { ensureUserBilling(user); save(); }
      break;
    }
    case 'invoice.payment_failed': {
      const user = userByCustomer(typeof object.customer === 'string' ? object.customer : object.customer?.id);
      if (user && !isUnlimited(user)) { const billing = ensureUserBilling(user); billing.status = 'past_due'; save(); }
      break;
    }
    default:
      break;
  }
  state.processedStripeEvents.unshift({ id: eventId, type: String(event.type || ''), objectId: String(object.id || ''), processedAt: now() });
  state.processedStripeEvents = state.processedStripeEvents.slice(0, 1000);
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
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/auth/') || raw.startsWith('/login') || raw.startsWith('/plans') || /[\r\n]/.test(raw)) return '/';
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
  const returnValue = esc(safeReturn(returnTo));
  // The configured label often already carries its own period ('A$9.99 / week'),
  // and the card template appends one too, which rendered 'A$9.99 / week / week'.
  // Strip any trailing period off the label and let the template own it.
  const priceAmount = plan => {
    const raw = String(plan.priceLabel || '').trim();
    if (!raw) return 'Set price';
    const interval = String(plan.interval || '').trim();
    if (!interval) return raw;
    const stripped = raw.replace(new RegExp(`\\s*/\\s*${interval}\\s*$`, 'i'), '').trim();
    return stripped || raw;
  };
  const perMinute = plan => {
    const match = String(plan.priceLabel || '').match(/([\d]+(?:\.[\d]+)?)/);
    const tokens = Number(plan.tokens || 0);
    if (!match || !tokens) return '';
    const cents = (Number(match[1]) / tokens) * 100;
    if (!Number.isFinite(cents) || cents <= 0) return '';
    return `${cents.toFixed(1)}c per source minute`;
  };
  const amountOf = plan => {
    const match = String(plan?.priceLabel || '').match(/([\d]+(?:\.[\d]+)?)/);
    return match ? Number(match[1]) : 0;
  };
  // Yearly is shown as a monthly equivalent against the monthly plan. A$249
  // as the biggest number on the page reads as the dearest option otherwise.
  const monthlyAmount = amountOf(bill.plans?.monthly);
  const yearlyAmount = amountOf(bill.plans?.yearly);
  const yearlySaving = monthlyAmount && yearlyAmount
    ? Math.round((1 - (yearlyAmount / 12) / monthlyAmount) * 100)
    : 0;
  const yearlyPerMonth = yearlyAmount ? (yearlyAmount / 12).toFixed(2) : '';
  const planCards = PLAN_ORDER.map(id => bill.plans?.[id]).filter(Boolean).map((plan, index) => {
    const configured = Boolean(plan.priceId);
    const current = cur.plan === plan.id && cur.status !== 'free';
    const canTrial = Boolean(plan.trialEligible) && trialDays > 0;
    const saving = plan.id === 'yearly' && yearlySaving > 0 ? yearlySaving : 0;
    const cta = current ? 'Current plan' : configured ? (canTrial ? `Start ${trialDays}-day trial` : 'Subscribe') : 'Stripe price required';
    const rate = perMinute(plan);
    return `<article class="dc-plan ${plan.id === 'monthly' ? 'featured' : ''}" style="--i:${index + 2}">
      <div class="plan-top">${plan.badge ? `<span class="badge">${esc(plan.badge)}</span>` : '<span></span>'}${plan.id === 'monthly' ? '<span class="popular">Most popular</span>' : ''}${saving ? `<span class="popular saving">Save ${saving}%</span>` : ''}</div>
      <h2>${esc(plan.name)}</h2>
      <div class="money">${plan.listPriceLabel ? `<s>${esc(plan.listPriceLabel)}</s> ` : ''}${esc(priceAmount(plan))}<small> / ${esc(plan.interval)}</small></div>
      ${plan.id === 'yearly' && yearlyPerMonth ? `<div class="per-month">works out to A$${esc(yearlyPerMonth)} a month</div>` : ''}
      ${rate ? `<div class="per-min">${esc(rate)}</div>` : ''}
      <p>${esc(plan.description)}</p>
      <div class="tokens"><b>${esc(plan.tokens)}</b><span>tokens included every ${esc(plan.interval)}</span></div>
      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>${canTrial ? `${trialDays}-day trial when shown at checkout` : 'Billed immediately, cancel any time'}</li></ul>
      <form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${esc(plan.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button class="${plan.id === 'monthly' ? 'cta-primary' : 'cta-secondary'}" type="submit" ${configured && !current ? '' : 'disabled'}>${esc(cta)}</button></form>
    </article>`;
  }).join('');
  // The free tier is what new accounts actually start on, so it belongs beside
  // the paid plans rather than in a footnote below the token shop.
  const freePlan = bill.plans?.free;
  const onFree = !cur.plan || cur.plan === 'free' || cur.status === 'free';
  const freeCard = freePlan ? `<article class="dc-plan free-plan" style="--i:1">
      <div class="plan-top"><span class="badge">${esc(freePlan.badge || 'Start here')}</span><span class="popular free-tag">No card needed</span></div>
      <h2>${esc(freePlan.name)}</h2>
      <div class="money">A$0<small> / to start</small></div>
      <p>${esc(freePlan.description)}</p>
      <div class="tokens"><b>${esc(freePlan.tokens)}</b><span>tokens to try it out</span></div>
      <ul><li>${esc(tokenRate())} token per selected source minute</li><li>Review, editor, templates and publishing</li><li>Template-only rerenders stay free</li><li>${freePlan.days ? `Expires ${freePlan.days} days after signup` : 'Upgrade any time, keep your clips'}</li></ul>
      ${onFree
        ? `<form method="post" action="/billing/continue-free"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit">Start with ${esc(freePlan.tokens)} free tokens</button></form>`
        : `<form><button type="button" disabled>Included with every account</button></form>`}
    </article>` : '';

  const topupCards = TOPUP_ORDER.map(id => bill.topups?.[id]).filter(Boolean).map((pack, index) => {
    const configured = Boolean(pack.priceId);
    return `<article class="dc-topup ${pack.id === 'boost300' ? 'featured' : ''}" style="--i:${index + 1}">
      <span class="badge">${esc(pack.badge || 'Top-up')}</span>
      <div><h3>${esc(pack.name)}</h3><p>${esc(pack.description)}</p></div>
      <div class="topup-value"><b>+${esc(pack.tokens)}</b><span>tokens</span></div>
      <div class="topup-price">${esc(pack.priceLabel || 'Set price')}<small> one-time</small></div>
      <form method="post" action="/billing/topup"><input type="hidden" name="package" value="${esc(pack.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit" ${configured && !cur.unlimited ? '' : 'disabled'}>${cur.unlimited ? 'Unlimited owner account' : configured ? 'Add tokens' : 'Stripe price required'}</button></form>
    </article>`;
  }).join('');
  const remaining = cur.unlimited ? '∞' : Math.round(Number(cur.remaining || 0));
  const bonus = cur.unlimited ? 'Unlimited' : `${Math.round(Number(cur.bonusTokens || 0))} top-up`;
  const pct = cur.unlimited ? 100 : Math.max(4, Math.min(100, (Number(cur.used || 0) / Math.max(1, Number(cur.allowance || 1))) * 100));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Plans & token shop · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#070708;--panel:#111113;--panel2:#18181c;--line:rgba(255,255,255,.10);--text:#faf8f3;--muted:#aaa6a0;--gold:#e4bc71;--gold2:#f2d696;--green:#59d493;--red:#ef6b7a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 50% -8%,rgba(228,188,113,.18),transparent 32%),radial-gradient(circle at 8% 38%,rgba(70,112,120,.08),transparent 24%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);padding:26px}.wrap{width:min(1240px,100%);margin:0 auto}.top{height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:42px}.brand{display:flex;align-items:center;gap:12px;text-decoration:none;color:inherit}.logo{width:43px;height:43px;border-radius:14px;display:grid;place-items:center;border:1px solid rgba(228,188,113,.34);background:linear-gradient(145deg,#2a251d,#0c0c0e);color:var(--gold);font-weight:950}.brand strong,.brand span{display:block}.brand strong{font-size:16px}.brand span{font-size:11px;color:var(--muted);margin-top:2px}.account{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px}.ghost{min-height:40px;padding:0 14px;border-radius:12px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}.hero{text-align:center;max-width:850px;margin:0 auto 34px}.eyebrow{display:inline-flex;min-height:30px;align-items:center;padding:0 12px;border-radius:999px;border:1px solid rgba(228,188,113,.28);background:rgba(228,188,113,.08);color:var(--gold2);font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:clamp(42px,6vw,70px);line-height:.96;letter-spacing:-.065em;margin:20px 0 14px}.hero p{color:var(--muted);font-size:16px;line-height:1.65;margin:0}.wallet{display:grid;grid-template-columns:1.15fr .85fr;gap:14px;margin:0 0 22px}.wallet-main,.wallet-rule{padding:22px;border:1px solid var(--line);border-radius:24px;background:linear-gradient(160deg,rgba(255,255,255,.055),rgba(255,255,255,.018));box-shadow:0 24px 70px rgba(0,0,0,.26)}.wallet-head{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px}.wallet-number{font-size:46px;font-weight:950;letter-spacing:-.06em;margin:10px 0 3px}.wallet-number span{font-size:13px;color:var(--muted);font-weight:650;letter-spacing:0}.bar{height:8px;background:#26262b;border-radius:999px;overflow:hidden;margin-top:14px}.bar i{display:block;height:100%;border-radius:inherit;background:linear-gradient(90deg,var(--gold),var(--gold2));width:${pct}%}.wallet-rule b,.wallet-rule span{display:block}.wallet-rule b{font-size:26px}.wallet-rule span{font-size:12px;color:var(--muted);margin-top:5px}.section-title{text-align:center;max-width:720px;margin:52px auto 24px}.section-title span{font-size:10px;text-transform:uppercase;letter-spacing:.12em;font-weight:900;color:var(--gold2)}.section-title h2{font-size:36px;letter-spacing:-.045em;margin:9px 0}.section-title p{color:var(--muted);font-size:14px;margin:0}.plans{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}.dc-plan.free-plan{border-color:rgba(89,212,147,.30);background:linear-gradient(180deg,rgba(89,212,147,.07),rgba(255,255,255,.02))}.dc-plan.free-plan .badge{color:var(--green);border-color:rgba(89,212,147,.34);background:rgba(89,212,147,.10)}.dc-plan.free-plan .popular.free-tag{color:#062;background:var(--green)}.dc-plan.free-plan .tokens b{color:var(--green)}.dc-plan.free-plan button{background:linear-gradient(180deg,#6fe0a4,#3fbe80);color:#042314}@media(max-width:1180px){.plans{grid-template-columns:repeat(2,minmax(0,1fr))}}.dc-plan,.dc-topup{border:1px solid var(--line);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.048),rgba(255,255,255,.018));padding:21px;display:flex;flex-direction:column;gap:12px;position:relative}.dc-plan.featured,.dc-topup.featured{border-color:rgba(228,188,113,.47);box-shadow:0 0 0 1px rgba(228,188,113,.10) inset,0 26px 75px rgba(228,188,113,.06)}.plan-top{display:flex;justify-content:space-between;align-items:center}.badge,.popular{min-height:24px;padding:0 9px;display:inline-flex;align-items:center;border-radius:999px;background:rgba(228,188,113,.10);color:var(--gold2);font-size:9px;font-weight:850}.popular{background:var(--gold);color:#171108}.dc-plan h2,.dc-topup h3{font-size:22px;margin:0}.money{font-size:35px;font-weight:950;letter-spacing:-.055em}.money small,.topup-price small{font-size:12px;color:var(--muted);font-weight:600;letter-spacing:0}.money s{font-size:20px;color:var(--muted);font-weight:700;text-decoration-thickness:2px;margin-right:4px}.per-min{font-size:11px;color:var(--gold2);font-weight:700;letter-spacing:.02em;margin:-6px 0 0}.dc-plan p,.dc-topup p{color:var(--muted);font-size:12.5px;line-height:1.55;margin:0}.tokens{padding:12px;border-radius:15px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06)}.tokens b,.tokens span{display:block}.tokens b{font-size:24px}.tokens span{font-size:10px;color:var(--muted);margin-top:2px}.dc-plan ul{margin:0;padding:0;list-style:none;display:grid;gap:8px;color:#d5d0c8;font-size:11.5px}.dc-plan li:before{content:'✓';color:var(--green);margin-right:8px}.dc-plan button,.dc-topup button,.free button{width:100%;height:46px;border:0;border-radius:13px;background:linear-gradient(135deg,var(--gold2),var(--gold));color:#171108;font-weight:850;cursor:pointer;margin-top:auto}.dc-plan button:disabled,.dc-topup button:disabled{opacity:.42;cursor:not-allowed}.topups{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.topup-value b,.topup-value span{display:block}.topup-value b{font-size:38px;letter-spacing:-.055em}.topup-value span{font-size:11px;color:var(--muted)}.topup-price{font-size:20px;font-weight:850}.shop-note{text-align:center;color:var(--muted);font-size:12px;margin:16px auto 0;max-width:760px}.free{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding:17px 20px;border:1px solid var(--line);border-radius:20px;background:rgba(255,255,255,.025)}.free strong,.free span{display:block}.free span{color:var(--muted);font-size:12px;margin-top:3px}.free button{width:auto;min-width:210px;background:#0e0e10;color:var(--text);border:1px solid var(--line)}.alerts{margin-bottom:14px}.alert{padding:12px 14px;border-radius:14px;font-size:12px;margin-bottom:8px}.alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.25);color:#ffb7bf}.alert.good{background:rgba(89,212,147,.1);border:1px solid rgba(89,212,147,.25);color:#baffd5}.foot{text-align:center;color:var(--muted);font-size:11px;line-height:1.65;margin:28px auto 8px;max-width:850px}@media(max-width:900px){body{padding:16px}.plans,.topups,.wallet{grid-template-columns:1fr}.hero h1{font-size:42px}.top{height:auto;align-items:flex-start;flex-direction:column;margin-bottom:30px}.free{align-items:stretch;flex-direction:column}.free button{width:100%}}@media(max-width:560px){.account span{display:none}.hero h1{font-size:38px}.wallet-main,.wallet-rule,.dc-plan,.dc-topup{border-radius:19px}}@keyframes dcRise{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}@keyframes dcRiseFeatured{from{opacity:0;transform:translateY(18px) scale(1.03)}to{opacity:1;transform:scale(1.03)}}@keyframes dcPulse{0%,100%{box-shadow:0 0 0 0 rgba(228,188,113,.42)}50%{box-shadow:0 0 0 9px rgba(228,188,113,0)}}@keyframes dcGlow{0%,100%{opacity:.35}50%{opacity:.75}}.dc-plan,.dc-topup{opacity:0;animation:dcRise .5s cubic-bezier(.2,.7,.3,1) forwards;animation-delay:calc(var(--i,1) * 70ms);transition:transform .28s cubic-bezier(.2,.7,.3,1),border-color .28s,box-shadow .28s}.dc-plan:hover,.dc-topup:hover{transform:translateY(-5px);border-color:rgba(228,188,113,.38);box-shadow:0 30px 70px rgba(0,0,0,.4)}.dc-plan.featured{transform:scale(1.03);animation-name:dcRiseFeatured;border-color:rgba(228,188,113,.62);z-index:2}.dc-plan.featured:hover{transform:translateY(-5px) scale(1.03)}.dc-plan.featured:before{content:'';position:absolute;inset:-1px;border-radius:inherit;padding:1px;background:linear-gradient(140deg,rgba(242,214,150,.85),rgba(228,188,113,.15),rgba(242,214,150,.7));-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:dcGlow 3.4s ease-in-out infinite;pointer-events:none}.cta-primary{background:linear-gradient(135deg,var(--gold2),var(--gold))!important;color:#171108!important;animation:dcPulse 2.6s ease-in-out infinite}.cta-primary:hover{filter:brightness(1.07)}.cta-secondary{background:transparent!important;color:var(--text)!important;border:1px solid rgba(255,255,255,.16)!important;transition:border-color .2s,background .2s}.cta-secondary:hover:not(:disabled){border-color:rgba(228,188,113,.55)!important;background:rgba(228,188,113,.07)!important}.dc-plan button:disabled{animation:none}.popular.saving{background:var(--green);color:#04240f}.per-month{font-size:12.5px;color:var(--text);font-weight:750;margin:-6px 0 0}.compare{text-align:center;max-width:720px;margin:22px auto 0;padding:13px 18px;border:1px solid rgba(228,188,113,.20);border-radius:16px;background:rgba(228,188,113,.05);color:#d5d0c8;font-size:12.5px;line-height:1.6}.wallet.compact{margin-top:34px}.wallet.compact .wallet-number{font-size:34px}@media(prefers-reduced-motion:reduce){.dc-plan,.dc-topup{opacity:1;animation:none;transition:none}.dc-plan.featured{transform:scale(1.03)}.dc-plan:hover,.dc-topup:hover{transform:none}.dc-plan.featured:hover{transform:scale(1.03)}.cta-primary{animation:none}.dc-plan.featured:before{animation:none;opacity:.6}}
  </style></head><body><main class="wrap"><div class="top"><a class="brand" href="/"><div class="logo">DC</div><div><strong>DeenClipped</strong><span>Plans & token shop</span></div></a><div class="account"><span>${esc(user?.email || user?.name || 'Signed in')}</span><a class="ghost" href="/app">Dashboard</a><form method="post" action="/auth/logout"><button class="ghost" type="submit">Log out</button></form></div></div><div class="alerts">${error ? `<div class="alert bad">${esc(error)}</div>` : ''}${info ? `<div class="alert good">${esc(info)}</div>` : ''}</div><section class="hero"><span class="eyebrow">Simple, affordable creator pricing</span><h1>Choose a plan. Add tokens only when you need them.</h1><p>DeenClipped keeps pricing tied to selected source minutes. Your subscription refreshes normally, while one-time top-up tokens stay in your wallet until you use them.</p></section><div class="section-title"><span>Subscriptions</span><h2>Built for different posting rhythms.</h2><p>Start small, publish consistently, or lock in the best annual value.</p></div><section class="plans">${freeCard}${planCards}</section><p class="compare">Opus Clip Pro is US$29/month for 300 minutes. DeenClipped Monthly gives you ${esc(bill.plans?.monthly?.tokens || 400)} minutes for A$29.99 &mdash; roughly half the cost per minute of video.</p><section class="wallet compact"><div class="wallet-main"><div class="wallet-head"><span>Your wallet</span><span>${esc(cur.plan || 'free')} plan</span></div><div class="wallet-number">${esc(remaining)} <span>tokens available</span></div><div class="wallet-head"><span>${esc(bonus)} tokens</span><span>${cur.unlimited ? 'No usage limits' : `${Math.round(Number(cur.used || 0))} used this period`}</span></div><div class="bar"><i></i></div></div><div class="wallet-rule"><b>${esc(bill.tokenRatePerMinute || 1)} token/min</b><span>Only the selected source range is charged. Editing, reviewing and template-only rerenders do not consume extra tokens.</span></div></section><div class="section-title"><span>Token shop</span><h2>Need more without changing your plan?</h2><p>Buy a one-time token pack. Top-up tokens are added to your current wallet and do not disappear at your next renewal.</p></div><section class="topups" id="token-shop">${topupCards}</section><p class="shop-note">Token packs are optional and available alongside free, weekly, monthly and yearly plans. Stripe shows the final total before payment.</p><section class="free"><div><strong>Already have free tokens?</strong><span>Head back to the dashboard. You can return to Plans &amp; tokens any time from the token pill in the top bar.</span></div><form method="post" action="/billing/continue-free"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit">Continue with free tokens</button></form></section><div class="foot">Payments are handled by Stripe. DeenClipped does not store complete card details. Prices shown are configuration-driven labels and Stripe shows the final amount before payment.</div></main></body></html>`;
}
