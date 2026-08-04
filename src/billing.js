import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save, log } from './store.js';

const now = () => Date.now();
const secondsToMs = value => Math.max(0, Number(value || 0) * 1000);
const cleanEmail = value => String(value || '').trim().toLowerCase();

export const PLAN_ORDER = ['weekly', 'monthly', 'yearly'];

function periodMs(interval) {
  if (interval === 'weekly') return 7 * 24 * 60 * 60 * 1000;
  if (interval === 'yearly') return 365 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

export function plans() {
  return {
    free: {
      id: 'free', name: 'Free', interval: 'one-time', badge: 'Test drive',
      tokens: config.tokensFree, priceId: '', enabled: true,
      description: 'Try the studio before upgrading.',
    },
    weekly: {
      id: 'weekly', name: 'Weekly', interval: 'week', badge: 'Start small',
      tokens: config.tokensWeekly, priceId: config.stripePriceWeekly, enabled: Boolean(config.stripePriceWeekly),
      description: 'Lower token pack for testing weekly content.',
    },
    monthly: {
      id: 'monthly', name: 'Monthly', interval: 'month', badge: 'Best for creators',
      tokens: config.tokensMonthly, priceId: config.stripePriceMonthly, enabled: Boolean(config.stripePriceMonthly),
      description: 'More tokens for regular lecture clipping.',
    },
    yearly: {
      id: 'yearly', name: 'Yearly', interval: 'year', badge: 'Biggest allowance',
      tokens: config.tokensYearly, priceId: config.stripePriceYearly, enabled: Boolean(config.stripePriceYearly),
      description: 'The largest token pool for serious posting.',
    },
  };
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

export function ensureBillingState() {
  if (!Array.isArray(state.billingEvents)) state.billingEvents = [];
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
  billing.periodStart ||= user.createdAt || now();
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
  return {
    enabled: config.stripeEnabled,
    stripeConfigured: Boolean(config.stripeSecretKey),
    checkoutConfigured: Boolean(config.stripePriceWeekly || config.stripePriceMonthly || config.stripePriceYearly),
    portalConfigured: Boolean(config.stripeSecretKey),
    tokenRatePerMinute: tokenRate(),
    trialDays: config.stripeTrialDays,
    current: {
      plan: currentPlan,
      status: billing.status || 'free',
      unlimited,
      allowance: unlimited ? null : allow,
      used,
      reserved,
      remaining: unlimited ? null : Math.max(0, allow - used - reserved),
      periodStart: billing.periodStart || null,
      periodEnd: billing.periodEnd || null,
      stripeCustomerId: billing.stripeCustomerId || '',
      stripeSubscriptionId: billing.stripeSubscriptionId || '',
    },
    plans: plans(),
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
    throw new Error(`Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}. Upgrade or wait for your plan to renew.`);
  }
  return true;
}

export function assertCanStartProject(user) {
  if (isUnlimited(user)) return true;
  return assertCanSpend(user, config.minimumTokensToStart, 'start a new lecture');
}

export function chargeTokens(userId, tokens, reason = 'usage', meta = {}) {
  ensureBillingState();
  const user = (state.authUsers || []).find(item => item.id === userId);
  if (!user || isUnlimited(user)) return { charged: 0, unlimited: true };
  const billing = ensureUserBilling(user);
  const amount = Math.max(1, Math.ceil(Number(tokens || 0)));
  billing.tokensUsed = Math.max(0, Number(billing.tokensUsed || 0)) + amount;
  user.updatedAt = now();
  const event = {
    id: `bill_${now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id, amount, reason, meta, createdAt: now(),
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
    success_url: `${appBase()}/?billing=success`,
    cancel_url: `${appBase()}/?billing=cancelled`,
    'line_items[0][price]': plan.priceId,
    'line_items[0][quantity]': '1',
    'metadata[userId]': user.id,
    'metadata[plan]': plan.id,
    'subscription_data[metadata][userId]': user.id,
    'subscription_data[metadata][plan]': plan.id,
    allow_promotion_codes: 'true',
  };
  if (config.stripeTrialDays > 0) params['subscription_data[trial_period_days]'] = String(config.stripeTrialDays);
  const session = await stripeRequest('/checkout/sessions', params);
  return { id: session.id, url: session.url };
}

export async function createPortalSession(user) {
  ensureBillingState();
  if (!user) throw new Error('Sign in to continue.');
  const customer = await ensureStripeCustomer(user);
  const session = await stripeRequest('/billing_portal/sessions', { customer, return_url: `${appBase()}/?billing=portal` });
  return { id: session.id, url: session.url };
}

export function verifyStripeSignature(rawBody, signatureHeader) {
  if (!config.stripeWebhookSecret) {
    if (!config.stripeSecretKey) throw new Error('Stripe is not configured.');
    return JSON.parse(rawBody || '{}');
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
  const object = event?.data?.object || {};
  switch (event?.type) {
    case 'checkout.session.completed': {
      const user = (state.authUsers || []).find(item => item.id === object.metadata?.userId);
      if (user) {
        const billing = ensureUserBilling(user);
        billing.stripeCustomerId = typeof object.customer === 'string' ? object.customer : object.customer?.id || billing.stripeCustomerId || '';
        billing.stripeSubscriptionId = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id || billing.stripeSubscriptionId || '';
        billing.plan = object.metadata?.plan || billing.plan || 'free';
        billing.status = 'checkout_complete';
        save();
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
  return { ok: true };
}
