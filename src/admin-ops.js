/**
 * Operations dashboard data for owner/admin accounts.
 *
 * This is deliberately separate from admin.js (which reports on *users*).
 * This module reports on *the business*: which third-party services are wired
 * up, how much object storage is being consumed, what each vendor costs and
 * when the next payment is due.
 */
import { config } from './config.js';
import { state, save } from './store.js';
import * as objectStorage from './object-storage.js';
import { publicBilling } from './billing.js';
import * as serviceMetrics from './service-metrics.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VENDOR_DEFAULTS_VERSION = 1;
const DEFAULT_VENDOR_COSTS = [
  {
    id: 'vendor_socialkit', name: 'SocialKit', plan: 'Video import API', cost: 29,
    currency: 'USD', cycle: 'monthly', renewsAt: null,
    url: 'https://socialkit.dev/dashboard',
    notes: 'Confirmed monthly import-provider cost.',
  },
  {
    id: 'vendor_hetzner', name: 'Hetzner', plan: 'Processing worker VPS', cost: 25,
    currency: 'USD', cycle: 'monthly', renewsAt: null,
    url: 'https://console.hetzner.cloud/',
    notes: 'Confirmed monthly CPU and RAM worker cost.',
  },
];

function requireOperator(user) {
  if (!user || !['owner', 'admin'].includes(String(user.role || '').toLowerCase())) {
    throw Object.assign(new Error('Not found.'), { statusCode: 404 });
  }
  return user;
}

const present = value => Boolean(String(value || '').trim());

/**
 * Every external service the app depends on, and whether its credentials are
 * actually present in the environment. `required` marks the ones the core
 * pipeline cannot run without.
 */
function integrations() {
  const rows = [
    {
      id: 'storage', name: 'Cloudflare R2', category: 'Storage', required: true,
      configured: objectStorage.configured(),
      detail: config.objectStorageBucket ? `Bucket ${config.objectStorageBucket}` : 'No bucket configured',
      dashboard: 'https://dash.cloudflare.com/?to=/:account/r2/overview',
      envKeys: ['OBJECT_STORAGE_ENDPOINT', 'OBJECT_STORAGE_BUCKET', 'OBJECT_STORAGE_ACCESS_KEY', 'OBJECT_STORAGE_SECRET_KEY'],
    },
    {
      id: 'worker', name: 'Processing worker', category: 'Compute', required: true,
      configured: present(config.workerBaseUrl) && present(config.workerSharedSecret),
      detail: config.workerBaseUrl ? config.workerBaseUrl : 'No worker URL configured',
      dashboard: 'https://console.hetzner.cloud/',
      envKeys: ['WORKER_BASE_URL', 'WORKER_SHARED_SECRET'],
    },
    {
      id: 'import', name: 'Video import API', category: 'Ingest', required: true,
      configured: present(config.videoImportApiKey),
      detail: config.videoImportProvider ? `Provider: ${config.videoImportProvider}` : 'No provider selected',
      dashboard: 'https://socialkit.dev/dashboard',
      envKeys: ['VIDEO_IMPORT_PROVIDER', 'VIDEO_IMPORT_API_KEY'],
    },
    {
      id: 'stripe', name: 'Stripe', category: 'Payments', required: false,
      configured: Boolean(config.stripeEnabled) && present(config.stripeSecretKey) && present(config.stripeWebhookSecret),
      detail: present(config.stripeSecretKey)
        ? `${[config.stripePriceWeekly, config.stripePriceMonthly, config.stripePriceYearly].filter(present).length} of 3 plan prices set`
        : 'No secret key configured',
      dashboard: 'https://dashboard.stripe.com/',
      envKeys: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_WEEKLY', 'STRIPE_PRICE_MONTHLY', 'STRIPE_PRICE_YEARLY'],
    },
    {
      id: 'google-signin', name: 'Google Sign-In', category: 'Auth', required: false,
      configured: present(config.googleSigninClientId) && present(config.googleSigninClientSecret),
      detail: present(config.googleSigninClientId) ? 'OAuth client configured' : 'Not configured',
      dashboard: 'https://console.cloud.google.com/apis/credentials',
      envKeys: ['GOOGLE_SIGNIN_CLIENT_ID', 'GOOGLE_SIGNIN_CLIENT_SECRET'],
    },
    {
      id: 'youtube', name: 'YouTube Data API', category: 'Publishing', required: false,
      configured: present(config.googleClientId) && present(config.googleClientSecret),
      detail: present(config.googleClientId) ? 'Publishing client configured' : 'Not configured',
      dashboard: 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas',
      envKeys: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    },
    {
      id: 'meta', name: 'Instagram / Facebook', category: 'Publishing', required: false,
      configured: present(config.metaAppId) && present(config.metaAppSecret),
      detail: present(config.metaAppId) ? `Graph ${config.metaGraphVersion || ''}`.trim() : 'Not configured',
      dashboard: 'https://developers.facebook.com/apps/',
      envKeys: ['META_APP_ID', 'META_APP_SECRET', 'META_REDIRECT_URI'],
    },
    {
      id: 'tiktok', name: 'TikTok', category: 'Publishing', required: false,
      configured: present(config.tiktokClientKey) && present(config.tiktokClientSecret),
      detail: present(config.tiktokClientKey) ? 'Client key configured' : 'Not configured',
      dashboard: 'https://developers.tiktok.com/',
      envKeys: ['TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET', 'TIKTOK_REDIRECT_URI'],
    },
    {
      id: 'host', name: 'Render (web service)', category: 'Hosting', required: true,
      configured: present(config.publicBaseUrl),
      detail: config.publicBaseUrl || 'No public base URL set',
      dashboard: 'https://dashboard.render.com/',
      envKeys: ['PUBLIC_BASE_URL'],
    },
  ];

  return rows.map(row => ({
    ...row,
    status: row.configured ? 'ok' : row.required ? 'missing' : 'optional',
  }));
}

/* --- Vendor / renewal tracker -------------------------------------------- */
/* These are things you pay for that have no API we can query, so they are
 * recorded by hand and stored alongside everything else in state.json. */

function vendorStore() {
  if (!Array.isArray(state.adminVendors)) state.adminVendors = [];
  if (Number(state.adminVendorDefaultsVersion || 0) < VENDOR_DEFAULTS_VERSION) {
    const normalName = value => String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const existing = new Set(state.adminVendors.map(row => normalName(row?.name)));
    for (const vendor of DEFAULT_VENDOR_COSTS) {
      if (!existing.has(normalName(vendor.name))) {
        state.adminVendors.push({ ...vendor, updatedAt: Date.now() });
      }
    }
    state.adminVendorDefaultsVersion = VENDOR_DEFAULTS_VERSION;
    save();
  }
  return state.adminVendors;
}

function normaliseVendor(input = {}) {
  const cycle = ['monthly', 'yearly', 'weekly', 'one-off'].includes(String(input.cycle || '').toLowerCase())
    ? String(input.cycle).toLowerCase()
    : 'monthly';
  const renewsAt = Number(input.renewsAt || 0);
  return {
    id: String(input.id || '').trim() || `vendor_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    name: String(input.name || '').trim().slice(0, 80),
    plan: String(input.plan || '').trim().slice(0, 80),
    cost: Math.max(0, Number(input.cost || 0)),
    currency: String(input.currency || 'USD').trim().toUpperCase().slice(0, 6) || 'USD',
    cycle,
    renewsAt: Number.isFinite(renewsAt) && renewsAt > 0 ? renewsAt : null,
    url: String(input.url || '').trim().slice(0, 300),
    notes: String(input.notes || '').trim().slice(0, 400),
    updatedAt: Date.now(),
  };
}

function vendorRows() {
  const now = Date.now();
  return vendorStore()
    .map(vendor => {
      const daysUntil = vendor.renewsAt ? Math.ceil((vendor.renewsAt - now) / DAY_MS) : null;
      return {
        ...vendor,
        daysUntilRenewal: daysUntil,
        overdue: daysUntil !== null && daysUntil < 0,
        dueSoon: daysUntil !== null && daysUntil >= 0 && daysUntil <= 7,
        monthlyEquivalent:
          vendor.cycle === 'yearly' ? vendor.cost / 12
            : vendor.cycle === 'weekly' ? (vendor.cost * 52) / 12
              : vendor.cycle === 'one-off' ? 0
                : vendor.cost,
      };
    })
    .sort((a, b) => {
      if (a.renewsAt && b.renewsAt) return a.renewsAt - b.renewsAt;
      if (a.renewsAt) return -1;
      if (b.renewsAt) return 1;
      return a.name.localeCompare(b.name);
    });
}

export function listVendors(user) {
  requireOperator(user);
  const rows = vendorRows();
  return {
    vendors: rows,
    totalMonthly: rows.reduce((sum, row) => sum + Number(row.monthlyEquivalent || 0), 0),
    nextRenewal: rows.find(row => row.renewsAt && !row.overdue) || null,
  };
}

export function saveVendor(user, input) {
  requireOperator(user);
  const vendor = normaliseVendor(input);
  if (!vendor.name) throw Object.assign(new Error('A vendor name is required.'), { statusCode: 400 });
  const list = vendorStore();
  const index = list.findIndex(row => row.id === vendor.id);
  if (index >= 0) list[index] = { ...list[index], ...vendor };
  else list.push(vendor);
  save();
  return listVendors(user);
}

export function deleteVendor(user, id) {
  requireOperator(user);
  const list = vendorStore();
  const index = list.findIndex(row => row.id === String(id || ''));
  if (index >= 0) { list.splice(index, 1); save(); }
  return listVendors(user);
}

/* --- Subscription rollup -------------------------------------------------- */

function subscriptions() {
  const users = Array.isArray(state.authUsers) ? state.authUsers : [];
  const byPlan = new Map();
  let payingUsers = 0;
  let trialUsers = 0;
  const renewals = [];

  for (const account of users) {
    const bill = publicBilling(account);
    const current = bill.current || {};
    const plan = String(current.plan || 'free');
    const row = byPlan.get(plan) || { plan, users: 0, active: 0, trialing: 0, canceled: 0 };
    row.users += 1;
    if (current.status === 'active') row.active += 1;
    if (current.status === 'trialing') { row.trialing += 1; trialUsers += 1; }
    if (current.status === 'canceled') row.canceled += 1;
    if (['weekly', 'monthly', 'yearly'].includes(plan) && current.status !== 'canceled') payingUsers += 1;
    byPlan.set(plan, row);

    const renewAt = Number(current.periodEnd || 0);
    if (renewAt > 0 && ['weekly', 'monthly', 'yearly'].includes(plan)) {
      renewals.push({
        userId: account.id,
        name: account.name || account.email || 'Creator',
        email: account.email || '',
        plan,
        status: current.status || '',
        renewsAt: renewAt,
        daysUntil: Math.ceil((renewAt - Date.now()) / DAY_MS),
      });
    }
  }

  const planPrices = {
    weekly: config.planPriceWeeklyLabel || '',
    monthly: config.planPriceMonthlyLabel || '',
    yearly: config.planPriceYearlyLabel || '',
  };

  return {
    stripeReady: Boolean(config.stripeEnabled && config.stripeSecretKey && config.stripeWebhookSecret),
    trialDays: Number(config.stripeTrialDays || 0),
    planPrices,
    plans: [...byPlan.values()].sort((a, b) => b.users - a.users),
    payingUsers,
    trialUsers,
    totalUsers: users.length,
    upcomingRenewals: renewals.sort((a, b) => a.renewsAt - b.renewsAt).slice(0, 25),
  };
}

/* --- Top-level payload ---------------------------------------------------- */

export async function operations(user) {
  requireOperator(user);
  let storage;
  try {
    storage = await objectStorage.storageUsage();
  } catch (error) {
    storage = { configured: objectStorage.configured(), error: error.message, totalBytes: 0, totalObjects: 0, folders: [] };
  }
  const rows = integrations();
  let live;
  try { live = await serviceMetrics.allMetrics(); }
  catch (error) { live = { error: error.message }; }
  return {
    generatedAt: Date.now(),
    live,
    storage,
    integrations: rows,
    integrationSummary: {
      total: rows.length,
      ok: rows.filter(row => row.status === 'ok').length,
      missing: rows.filter(row => row.status === 'missing').length,
      optional: rows.filter(row => row.status === 'optional').length,
    },
    subscriptions: subscriptions(),
    vendors: listVendors(user),
    limits: {
      maxSourceMinutes: Number(config.maxSourceMinutes || 0),
      maxVideoUploadBytes: Number(config.maxVideoUploadBytes || 0),
      maxConcurrentJobs: Number(config.maxConcurrentJobs || 0),
      tokensPerMinute: Number(config.tokensPerMinute || 1),
    },
  };
}

/* --- Editable per-service metadata (plan sizes, reset days) --------------- */

export function saveServiceMeta(user, input = {}) {
  requireOperator(user);
  const service = String(input.service || '').trim().toLowerCase();
  if (!service) throw Object.assign(new Error('A service name is required.'), { statusCode: 400 });
  if (!state.adminServiceMeta || typeof state.adminServiceMeta !== 'object') state.adminServiceMeta = {};
  const planCredits = Math.max(0, Number(input.planCredits || 0));
  const resetDayRaw = Number(input.resetDay || 0);
  const resetDay = resetDayRaw >= 1 && resetDayRaw <= 31 ? Math.floor(resetDayRaw) : 0;
  state.adminServiceMeta[service] = { planCredits, resetDay, updatedAt: Date.now() };
  save();
  return state.adminServiceMeta[service];
}
