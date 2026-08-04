import crypto from 'node:crypto';
import { config } from './config.js';
import { state, save, log } from './store.js';

const now = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;
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
  const trial = trialState(billing);
  const remaining = unlimited ? null : Math.max(0, allow - used - reserved);
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
    portalConfigured: Boolean(config.stripeSecretKey),
    tokenRatePerMinute: tokenRate(),
    trialDays: config.stripeTrialDays,
    terms: [
      `${tokenRate()} token per source video minute`,
      'Tokens are charged after the source duration is known',
      'Template updates and rerenders are free',
      `${config.stripeTrialDays || 7}-day trial on paid plans`,
      'Unused trial access does not roll into another trial',
    ],
    current: {
      plan: currentPlan,
      status: billing.status || 'free',
      unlimited,
      allowance: unlimited ? null : allow,
      used,
      reserved,
      remaining,
      periodStart: billing.periodStart || null,
      periodEnd: billing.periodEnd || null,
      periodEndsInDays,
      trial,
      stripeCustomerId: billing.stripeCustomerId || '',
      stripeSubscriptionId: billing.stripeSubscriptionId || '',
    },
    plans: plans(),
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
    throw new Error(`Not enough tokens to ${action}. You have ${remaining} tokens left and this needs about ${needed}. Upgrade or wait for your plan to renew.`);
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
  billing.tokensUsed = Math.max(0, Number(billing.tokensUsed || 0)) + amount;
  user.updatedAt = now();
  const beforeRemaining = Math.max(0, allowance(billing.plan || 'free') - Number(billing.tokensUsed || 0) - Number(billing.tokensReserved || 0));
  const event = {
    id: `bill_${now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId: user.id, amount, reason, meta, createdAt: now(),
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
  const planList = ['weekly', 'monthly', 'yearly'].map(id => bill.plans?.[id]).filter(Boolean);
  const returnValue = esc(safeReturn(returnTo));
  const planCards = planList.map(plan => {
    const configured = Boolean(plan.priceId);
    const current = cur.plan === plan.id && cur.status !== 'free';
    return `<article class="dc-plan ${plan.id === 'monthly' ? 'featured' : ''}">
      <span class="badge">${esc(plan.badge || '')}</span>
      <h2>${esc(plan.name)}</h2>
      <p>${esc(plan.description)}</p>
      <div class="tokens"><b>${esc(plan.tokens)}</b><span>tokens / ${esc(plan.interval)}</span></div>
      <ul><li>${esc(tokenRate())} token per source minute</li><li>Template rerenders do not cost tokens</li><li>${trialDays ? `${trialDays}-day free trial` : 'Starts immediately'}</li></ul>
      <form method="post" action="/billing/checkout"><input type="hidden" name="plan" value="${esc(plan.id)}"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit" ${configured && !current ? '' : 'disabled'}>${current ? 'Current plan' : configured ? `Start ${trialDays || 7}-day trial` : 'Add Stripe price'}</button></form>
    </article>`;
  }).join('');
  const remaining = cur.unlimited ? '∞' : Number(cur.remaining || 0);
  const allowance = cur.unlimited ? 'unlimited' : `${remaining} left of ${Number(cur.allowance || 0)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Choose plan · DeenClipped</title><style>
  :root{color-scheme:dark;--bg:#08080a;--panel:#111114;--panel2:#19191d;--line:#2c2c33;--text:#f8f7f4;--muted:#a7a4ad;--gold:#d9b478;--gold2:#f0d29e;--green:#53c78b;--red:#ef6b7a}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 18% 0,rgba(217,180,120,.17),transparent 33%),radial-gradient(circle at 80% 10%,rgba(85,183,255,.10),transparent 34%),var(--bg);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:var(--text);padding:30px}.wrap{width:min(1160px,100%);margin:0 auto}.top{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:12px}.logo{width:42px;height:42px;border-radius:14px;display:grid;place-items:center;border:1px solid rgba(217,180,120,.3);background:rgba(217,180,120,.10);color:var(--gold);font-weight:900}.brand strong,.brand span{display:block}.brand strong{font-size:16px}.brand span{font-size:12px;color:var(--muted);margin-top:2px}.account{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:12px}.ghost{min-height:40px;padding:0 14px;border-radius:999px;border:1px solid var(--line);background:#0b0b0d;color:var(--text);cursor:pointer}.hero{display:grid;grid-template-columns:1.08fr .92fr;gap:18px;margin-bottom:18px}.hero-card,.usage{border:1px solid rgba(255,255,255,.09);border-radius:28px;background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.025));box-shadow:0 24px 80px rgba(0,0,0,.28);padding:28px;overflow:hidden;position:relative}.hero-card:after{content:'';position:absolute;right:-70px;bottom:-90px;width:310px;height:310px;border-radius:50%;background:radial-gradient(circle,rgba(217,180,120,.16),transparent 68%)}.eyebrow{display:inline-flex;min-height:28px;align-items:center;padding:0 11px;border-radius:999px;border:1px solid rgba(217,180,120,.23);background:rgba(217,180,120,.08);color:var(--gold2);font-size:11px;font-weight:900;letter-spacing:.09em;text-transform:uppercase}.hero h1{font-size:48px;line-height:.98;letter-spacing:-.06em;margin:20px 0 12px}.hero p{color:var(--muted);line-height:1.65;margin:0;max-width:620px}.usage h2{font-size:18px;margin:0 0 10px}.usage .big{font-size:42px;font-weight:950;letter-spacing:-.05em}.usage .big span{font-size:14px;color:var(--muted);font-weight:700}.bar{height:10px;background:#25252b;border-radius:999px;overflow:hidden;margin:14px 0}.bar i{display:block;height:100%;width:34%;border-radius:999px;background:linear-gradient(90deg,var(--gold),var(--gold2));box-shadow:0 0 24px rgba(217,180,120,.35)}.rate{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:14px}.rate div{padding:12px;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.03)}.rate b,.rate span{display:block}.rate span{font-size:12px;color:var(--muted);margin-top:4px}.alerts{margin-bottom:14px}.alert{padding:12px 14px;border-radius:16px;font-size:13px;margin-bottom:10px}.alert.bad{background:rgba(239,107,122,.1);border:1px solid rgba(239,107,122,.25);color:#ffb7bf}.alert.good{background:rgba(83,199,139,.1);border:1px solid rgba(83,199,139,.25);color:#b7ffd3}.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.dc-plan{border:1px solid rgba(255,255,255,.09);border-radius:24px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.02));padding:20px;display:flex;flex-direction:column;gap:12px}.dc-plan.featured{border-color:rgba(217,180,120,.46);box-shadow:0 0 0 1px rgba(217,180,120,.14) inset,0 24px 70px rgba(217,180,120,.06)}.badge{align-self:flex-start;min-height:24px;padding:0 9px;display:inline-flex;align-items:center;border-radius:999px;background:rgba(217,180,120,.10);color:var(--gold2);font-size:11px;font-weight:850}.dc-plan h2{font-size:22px;margin:0}.dc-plan p{color:var(--muted);font-size:13px;line-height:1.55;margin:0}.tokens b{font-size:40px;letter-spacing:-.05em}.tokens span{display:block;color:var(--muted);font-size:12px}.dc-plan ul{margin:0;padding-left:18px;color:var(--muted);font-size:12px;line-height:1.75}.dc-plan button,.free button{width:100%;height:48px;border:0;border-radius:999px;background:linear-gradient(135deg,var(--gold),var(--gold2));color:#1a1207;font-weight:850;cursor:pointer;margin-top:auto}.dc-plan button:disabled{opacity:.45;cursor:not-allowed}.free{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:16px;padding:16px 18px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.03)}.free strong,.free span{display:block}.free span{color:var(--muted);font-size:13px;margin-top:3px}.free button{width:auto;min-width:190px;background:#0c0c0f;color:var(--text);border:1px solid var(--line)}.foot{color:var(--muted);font-size:12px;line-height:1.6;margin-top:18px}@media(max-width:900px){body{padding:16px}.hero,.plans{grid-template-columns:1fr}.hero h1{font-size:36px}.top{align-items:flex-start;flex-direction:column}.free{align-items:stretch;flex-direction:column}.free button{width:100%}}
  </style></head><body><main class="wrap"><div class="top"><div class="brand"><div class="logo">DC</div><div><strong>DeenClipped Studio</strong><span>Choose your creator plan</span></div></div><div class="account"><span>${esc(user?.email || user?.name || 'Signed in')}</span><form method="post" action="/auth/logout"><button class="ghost" type="submit">Log out</button></form></div></div><div class="alerts">${error ? `<div class="alert bad">${esc(error)}</div>` : ''}${info ? `<div class="alert good">${esc(info)}</div>` : ''}</div><section class="hero"><div class="hero-card"><span class="eyebrow">Free trial and tokens</span><h1>Pick how many clips you want to create.</h1><p>DeenClipped uses tokens so creators only pay for processing time. Weekly gives a smaller allowance, monthly gives more, and yearly is built for serious posting. Admin accounts stay unlimited.</p></div><aside class="usage"><h2>Your token wallet</h2><div class="big">${esc(remaining)} <span>${esc(allowance)}</span></div><div class="bar"><i style="width:${cur.unlimited ? 100 : Math.max(6, Math.min(100, ((Number(cur.used || 0) / Math.max(1, Number(cur.allowance || 1))) * 100)))}%"></i></div><div class="rate"><div><b>${esc(bill.tokenRatePerMinute || 1)} token/min</b><span>Source video charge rate</span></div><div><b>${trialDays || 7} days</b><span>Free trial on paid plans</span></div></div></aside></section><section class="plans">${planCards}</section><section class="free"><div><strong>Not ready to subscribe?</strong><span>Continue with free starter tokens and upgrade from the top-bar token button later.</span></div><form method="post" action="/billing/continue-free"><input type="hidden" name="returnTo" value="${returnValue}"><button type="submit">Continue with free tokens</button></form></section><div class="foot">Stripe Checkout handles cards, Apple Pay and Google Pay when configured. DeenClipped does not store card details.</div></main></body></html>`;
}
