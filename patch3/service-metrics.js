/**
 * Live metrics pulled from the services DeenClipped runs on.
 *
 * Every provider here is optional and independently guarded: if a token is
 * missing or an upstream call fails, that provider reports `configured:false`
 * or an `error` string and the rest of the dashboard still renders. The admin
 * console must never go blank because Cloudflare had a bad minute.
 */
import { config } from './config.js';
import { state } from './store.js';
import * as workerClient from './worker-client.js';

const TIMEOUT_MS = 12_000;
const DAY_MS = 24 * 60 * 60 * 1000;

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text }; }
    if (!response.ok) {
      const detail = payload?.error?.message || payload?.errors?.[0]?.message || payload?.message || `HTTP ${response.status}`;
      throw new Error(detail);
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

/* --- Worker box (Hetzner VPS) -------------------------------------------- */

export async function workerMetrics() {
  if (!workerClient.configured()) return { configured: false };
  try {
    const payload = await workerClient.metrics();
    return { configured: true, ...payload };
  } catch (error) {
    // Older workers predate /metrics; fall back to the readiness endpoint so
    // the panel still shows disk and queue instead of nothing at all.
    try {
      const readiness = await workerClient.readiness();
      return {
        configured: true,
        legacy: true,
        note: 'Worker has not been rebuilt with the metrics endpoint yet.',
        disk: { freeBytes: readiness.freeBytes ?? null, totalBytes: null, usedBytes: null, percent: null },
        queue: { depth: readiness.queueDepth ?? 0, running: readiness.running ?? 0, maxConcurrent: null },
        cpu: { percent: null, cores: null, loadAverage: null },
        memory: { usedBytes: null, totalBytes: null, percent: null },
      };
    } catch (fallbackError) {
      return { configured: true, error: fallbackError.message || error.message };
    }
  }
}

/* --- Cloudflare R2 -------------------------------------------------------- */

export function cloudflareConfigured() {
  return Boolean(config.cloudflareApiToken && config.cloudflareAccountId);
}

export async function cloudflareMetrics() {
  if (!cloudflareConfigured()) {
    return { configured: false, envKeys: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'] };
  }
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const until = new Date().toISOString();
  const query = `query R2Usage($accountTag: String!, $since: Time!, $until: Time!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        r2OperationsAdaptiveGroups(
          limit: 100,
          filter: { datetime_geq: $since, datetime_leq: $until }
        ) { dimensions { actionType } sum { requests } }
        r2StorageAdaptiveGroups(
          limit: 1,
          orderBy: [datetime_DESC],
          filter: { datetime_geq: $since, datetime_leq: $until }
        ) { max { payloadSize objectCount } }
      }
    }
  }`;
  try {
    const payload = await fetchJson('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.cloudflareApiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ query, variables: { accountTag: config.cloudflareAccountId, since, until } }),
    });
    if (Array.isArray(payload.errors) && payload.errors.length) {
      throw new Error(payload.errors[0]?.message || 'Cloudflare GraphQL returned an error.');
    }
    const account = payload?.data?.viewer?.accounts?.[0] || {};
    const operations = account.r2OperationsAdaptiveGroups || [];
    // Class A = mutating/list calls (billed higher), Class B = reads.
    const CLASS_A = new Set(['PutObject', 'CopyObject', 'ListObjects', 'ListBuckets', 'CompleteMultipartUpload', 'CreateMultipartUpload', 'UploadPart', 'PutBucket', 'DeleteBucket']);
    let classA = 0, classB = 0;
    const byAction = [];
    for (const row of operations) {
      const action = row?.dimensions?.actionType || 'unknown';
      const requests = Number(row?.sum?.requests || 0);
      byAction.push({ action, requests });
      if (CLASS_A.has(action)) classA += requests; else classB += requests;
    }
    const storage = account.r2StorageAdaptiveGroups?.[0]?.max || {};
    return {
      configured: true,
      windowDays: 30,
      classAOperations: classA,
      classBOperations: classB,
      totalOperations: classA + classB,
      byAction: byAction.sort((a, b) => b.requests - a.requests).slice(0, 12),
      storedBytes: Number(storage.payloadSize || 0) || null,
      objectCount: Number(storage.objectCount || 0) || null,
      // R2 free tier, for context on how close you are to paying.
      freeTier: { classA: 1_000_000, classB: 10_000_000, storageGb: 10 },
    };
  } catch (error) {
    return { configured: true, error: error.message };
  }
}

/* --- Hetzner Cloud -------------------------------------------------------- */

export function hetznerConfigured() {
  return Boolean(config.hetznerApiToken);
}

export async function hetznerMetrics() {
  if (!hetznerConfigured()) return { configured: false, envKeys: ['HETZNER_API_TOKEN'] };
  try {
    const payload = await fetchJson('https://api.hetzner.cloud/v1/servers', {
      headers: { authorization: `Bearer ${config.hetznerApiToken}` },
    });
    const servers = (payload.servers || []).map(server => {
      const price = server.server_type?.prices?.[0] || {};
      const monthly = Number(price.price_monthly?.gross || 0);
      const included = Number(server.server_type?.included_traffic || 0);
      const outgoing = Number(server.outgoing_traffic || 0);
      return {
        id: server.id,
        name: server.name,
        status: server.status,
        serverType: server.server_type?.name || '',
        cores: server.server_type?.cores ?? null,
        memoryGb: server.server_type?.memory ?? null,
        diskGb: server.server_type?.disk ?? null,
        location: server.datacenter?.location?.city || '',
        monthlyCost: monthly || null,
        currency: 'EUR',
        includedTrafficBytes: included || null,
        outgoingTrafficBytes: outgoing || null,
        trafficPercent: included > 0 ? Math.round((outgoing / included) * 1000) / 10 : null,
        createdAt: server.created ? Date.parse(server.created) : null,
      };
    });
    return {
      configured: true,
      servers,
      totalMonthlyCost: servers.reduce((sum, server) => sum + Number(server.monthlyCost || 0), 0),
      currency: 'EUR',
    };
  } catch (error) {
    return { configured: true, error: error.message };
  }
}

/* --- SocialKit credit estimate ------------------------------------------- */

/**
 * SocialKit exposes no usage endpoint, so this is derived from our own job
 * history: they bill 1 credit per minute of source video. It is explicitly an
 * estimate and is labelled as such in the UI — treat the SocialKit dashboard
 * as the source of truth.
 */
export function socialkitEstimate() {
  const provider = String(config.videoImportProvider || '').toLowerCase();
  if (provider !== 'socialkit') return { applicable: false, provider: config.videoImportProvider || 'none' };

  const settings = state.adminServiceMeta?.socialkit || {};
  const resetDay = Number(settings.resetDay || 0);
  const planCredits = Number(settings.planCredits || 0);

  // Work out the current billing window from the reset day. Months have
  // different lengths, so asking for day 31 in February must not silently roll
  // into March — clamp to the last real day of the target month instead.
  const startOfDay = (year, month, day) => {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDay));
  };

  let windowStart;
  let windowEnd = null;
  if (resetDay >= 1 && resetDay <= 31) {
    const now = new Date();
    const thisMonth = startOfDay(now.getFullYear(), now.getMonth(), resetDay);
    // Before this month's reset day, we are still inside the window that opened
    // last month. On or after it, the current window began this month.
    const start = thisMonth.getTime() <= now.getTime()
      ? thisMonth
      : startOfDay(now.getFullYear(), now.getMonth() - 1, resetDay);
    windowStart = start.getTime();
    windowEnd = startOfDay(start.getFullYear(), start.getMonth() + 1, resetDay).getTime();
  } else {
    windowStart = Date.now() - 30 * DAY_MS;
    windowEnd = Date.now();
  }

  const projects = Array.isArray(state.projects) ? state.projects : [];

  // Sum credits for link imports inside an arbitrary window. Direct uploads
  // never touch SocialKit, so they cost nothing.
  const usageBetween = (from, to) => {
    let credits = 0;
    let count = 0;
    for (const project of projects) {
      const at = Number(project.submittedAt || project.createdAt || 0);
      if (!at || at < from || at >= to) continue;
      if (String(project.sourceKind || 'link') === 'object_storage') continue;
      const seconds = Number(project.sourceDurationSec || project.durationSec || 0);
      if (seconds > 0) credits += Math.ceil(seconds / 60);
      count += 1;
    }
    return { credits, count };
  };

  const current = usageBetween(windowStart, windowEnd || Date.now() + DAY_MS);
  const creditsUsed = current.credits;
  const imports = current.count;

  // On (or just after) the reset day the current window is nearly empty, which
  // on its own tells you nothing useful. Reporting the previous period as well
  // keeps the panel meaningful every day of the month.
  const previousStart = new Date(windowStart);
  previousStart.setMonth(previousStart.getMonth() - 1);
  const previous = usageBetween(previousStart.getTime(), windowStart);
  const daysIntoWindow = Math.max(0, Math.floor((Date.now() - windowStart) / DAY_MS));

  return {
    applicable: true,
    estimate: true,
    windowStart,
    windowEnd,
    resetDay: resetDay || null,
    planCredits: planCredits || null,
    creditsUsedEstimate: creditsUsed,
    creditsRemainingEstimate: planCredits ? Math.max(0, planCredits - creditsUsed) : null,
    percentUsed: planCredits ? Math.min(100, Math.round((creditsUsed / planCredits) * 100)) : null,
    importsThisWindow: imports,
    daysIntoWindow,
    previousPeriod: { creditsUsed: previous.credits, imports: previous.count },
    dashboard: 'https://socialkit.dev/dashboard',
  };
}

/* --- Combined ------------------------------------------------------------- */

export async function allMetrics() {
  const [worker, cloudflare, hetzner] = await Promise.all([
    workerMetrics().catch(error => ({ configured: true, error: error.message })),
    cloudflareMetrics().catch(error => ({ configured: true, error: error.message })),
    hetznerMetrics().catch(error => ({ configured: true, error: error.message })),
  ]);
  return { at: Date.now(), worker, cloudflare, hetzner, socialkit: socialkitEstimate() };
}
