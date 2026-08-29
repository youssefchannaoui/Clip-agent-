import crypto from 'node:crypto';
import { config } from './config.js';

export class WorkerUnavailableError extends Error {
  constructor(message = 'The processing worker is temporarily unavailable. Your job remains queued.') {
    super(message); this.name = 'WorkerUnavailableError'; this.code = 'worker_unavailable';
  }
}

export function configured() { return Boolean(config.workerBaseUrl && config.workerSharedSecret); }

export function signature(secret, timestamp, method, pathname, body = '') {
  return crypto.createHmac('sha256', secret).update(`${timestamp}\n${method.toUpperCase()}\n${pathname}\n${body}`).digest('hex');
}

async function request(pathname, { method = 'GET', body = null, timeoutMs = config.workerRequestTimeoutMs } = {}) {
  if (!configured()) throw new WorkerUnavailableError('The external processing worker is not configured.');
  const raw = body === null ? '' : JSON.stringify(body);
  const timestamp = String(Date.now());
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${config.workerBaseUrl}${pathname}`, {
      method, signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-deenclipped-timestamp': timestamp,
        'x-deenclipped-signature': signature(config.workerSharedSecret, timestamp, method, pathname, raw),
      },
      body: raw || undefined,
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Worker returned HTTP ${response.status}.`);
      error.code = payload.code || (response.status >= 500 ? 'worker_unavailable' : 'worker_error');
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'TypeError' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') throw new WorkerUnavailableError();
    throw error;
  } finally { clearTimeout(timer); }
}

export const health = () => request('/health');
export const readiness = () => request('/readiness');
export const createJob = job => request('/jobs', { method: 'POST', body: job });
export const getJob = id => request(`/jobs/${encodeURIComponent(id)}`);
export const cancelJob = id => request(`/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: {} });
// DeenAI's Ask. A longer window than the default: qwen on a 2-core box thinks
// in tens of seconds, and aborting at 30 made every long answer a failure.
export const advise = payload => request('/ai/advise', { method: 'POST', body: payload, timeoutMs: 90_000 });
