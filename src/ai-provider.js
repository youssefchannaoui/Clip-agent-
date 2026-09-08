/**
 * One way to talk to a model, and two things behind it.
 *
 * DeenAI V1 called the worker's Ollama directly, so the assistant's ceiling
 * WAS qwen3:1.7b — a model this file's own record shows inventing figures,
 * copying transcripts and reciting its own system prompt, none of which a
 * prompt fixed. V2 puts an adapter in front:
 *
 *   anthropic  the strategist. Streaming, tool use, structured results.
 *   ollama     a clearly-labelled LIMITED fallback on the worker box, for a
 *              deployment with no key or an outage at the primary. It has no
 *              tools and its answers are marked as coming from it.
 *
 * NO DEPENDENCY. This repo has none on purpose — that is what lets CI and a
 * phone session run the whole suite from a clean checkout — so this is
 * `fetch`, a hand-written SSE reader and nothing else. The SDK would be
 * convenient and would cost the property that makes the suite portable.
 */

import { config } from './config.js';
import * as workerClient from './worker-client.js';

export const PROVIDERS = Object.freeze(['anthropic', 'ollama']);

/** Which provider would actually answer right now, and why not the other. */
export function providerStatus() {
  const primary = Boolean(config.anthropicApiKey);
  const fallback = config.processingMode === 'remote';
  return {
    primary: primary ? 'anthropic' : null,
    primaryModel: primary ? config.deenaiModel : null,
    fallback: fallback ? 'ollama' : null,
    fallbackModel: fallback ? config.ollamaModel : null,
    ready: primary || fallback,
    // Said plainly rather than hidden: a deployment running on the fallback is
    // running a much smaller model, and every answer says so on screen.
    note: primary
      ? null
      : (fallback
        ? 'Running on the local fallback model, which is small: answers are shorter and it has no tools.'
        : 'No model is reachable from this deployment.'),
  };
}

class ProviderError extends Error {
  constructor(message, { provider, statusCode = 502, retryable = false } = {}) {
    super(message);
    this.provider = provider;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}
export { ProviderError };

/* ------------------------------------------------------------------ */
/* Anthropic                                                            */
/* ------------------------------------------------------------------ */

const EFFORT_THINKING = Object.freeze({ low: 0, medium: 2000, high: 6000, xhigh: 10000 });

/**
 * Read a Messages-API SSE stream into one assistant turn.
 *
 * Streaming is not a flourish here: a growth answer that reads several tools
 * takes seconds, and a button that sits still for eight of them reads as
 * broken — the exact complaint that produced this rebuild. `onDelta` is
 * called with each text fragment as it arrives.
 *
 * The parse is deliberately narrow: `content_block_start`, the two delta
 * kinds, `content_block_stop`, `message_delta` and `error`. Anything else on
 * the wire is skipped rather than guessed at.
 */
async function readStream(response, onDelta) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new ProviderError('The model stream could not be read.', { provider: 'anthropic' });
  const decoder = new TextDecoder();
  let buffer = '';
  const blocks = [];
  let stopReason = '';
  let usage = null;

  const handle = payload => {
    const type = payload?.type;
    if (type === 'content_block_start') {
      const block = payload.content_block || {};
      blocks[payload.index] = block.type === 'tool_use'
        ? { type: 'tool_use', id: block.id, name: block.name, json: '' }
        : { type: 'text', text: '' };
      return;
    }
    if (type === 'content_block_delta') {
      const block = blocks[payload.index];
      if (!block) return;
      const delta = payload.delta || {};
      if (delta.type === 'text_delta') {
        block.text = (block.text || '') + (delta.text || '');
        if (onDelta && delta.text) onDelta(delta.text);
      } else if (delta.type === 'input_json_delta') {
        block.json = (block.json || '') + (delta.partial_json || '');
      }
      return;
    }
    if (type === 'message_delta') {
      stopReason = payload.delta?.stop_reason || stopReason;
      usage = payload.usage || usage;
      return;
    }
    if (type === 'error') {
      throw new ProviderError(String(payload.error?.message || 'The model stream failed.'), { provider: 'anthropic' });
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // SSE events are separated by a blank line; a partial one stays in the
    // buffer until the rest of it arrives.
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === '[DONE]') continue;
        let payload;
        try { payload = JSON.parse(raw); } catch { continue; }
        handle(payload);
      }
    }
  }

  const text = blocks.filter(b => b && b.type === 'text').map(b => b.text).join('').trim();
  const toolCalls = blocks.filter(b => b && b.type === 'tool_use').map(b => {
    let input = {};
    // A tool call whose arguments did not finish arriving is dropped rather
    // than half-read: a partial object silently becomes a wrong argument.
    try { input = b.json ? JSON.parse(b.json) : {}; } catch { input = null; }
    return input === null ? null : { id: b.id, name: b.name, input };
  }).filter(Boolean);
  return { text, toolCalls, stopReason, usage };
}

async function anthropicTurn({ system, messages, tools, onDelta, signal, maxTokens }) {
  if (!config.anthropicApiKey) {
    throw new ProviderError('No API key is configured for the primary model.', { provider: 'anthropic', statusCode: 503 });
  }
  const think = EFFORT_THINKING[config.deenaiEffort] ?? EFFORT_THINKING.medium;
  const body = {
    model: config.deenaiModel,
    max_tokens: maxTokens || config.deenaiMaxTokens,
    stream: true,
    system,
    messages,
  };
  if (tools && tools.length) body.tools = tools;
  // Extended thinking where the effort asks for it AND the budget leaves room
  // for an answer after it. Silently sending a thinking budget larger than
  // max_tokens is a 400 that reads like a broken request.
  if (think > 0 && body.max_tokens > think + 512) {
    body.thinking = { type: 'enabled', budget_tokens: think };
  }
  let response;
  try {
    response = await fetch(`${config.anthropicBaseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': config.anthropicApiKey,
        'anthropic-version': '2023-06-01',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ProviderError(`Could not reach the model: ${error.message}`, { provider: 'anthropic', retryable: true });
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let message = `The model refused the request (${response.status}).`;
    try {
      const parsed = JSON.parse(detail);
      if (parsed?.error?.message) message = String(parsed.error.message);
    } catch { /* the body was not JSON; the status is what we have */ }
    // 429 and 5xx are worth another go; 400 and 401 are not, and retrying one
    // just spends the budget twice on the same refusal.
    throw new ProviderError(message, {
      provider: 'anthropic',
      statusCode: response.status === 401 ? 503 : 502,
      retryable: response.status === 429 || response.status >= 500,
    });
  }
  return readStream(response, onDelta);
}

/* ------------------------------------------------------------------ */
/* Ollama fallback                                                      */
/* ------------------------------------------------------------------ */

/**
 * The worker's own model, through the route that already exists.
 *
 * NO TOOLS. qwen3:1.7b does not do tool use reliably and this repo has the
 * measurements to say so, so the fallback is handed a pre-computed digest and
 * asked one question. It answers or it does not; it never drafts, schedules
 * or reads a transcript.
 */
async function ollamaTurn({ question, digest }) {
  if (config.processingMode !== 'remote') {
    throw new ProviderError('DeenAI answers need the render worker, which this deployment does not have connected.', { provider: 'ollama', statusCode: 503 });
  }
  const result = await workerClient.advise({ question, context: digest });
  const answer = String(result?.answer || '').trim();
  if (!answer) throw new ProviderError('The fallback model had no answer.', { provider: 'ollama' });
  return { text: answer, toolCalls: [], stopReason: 'end_turn', usage: null };
}

/* ------------------------------------------------------------------ */
/* The one entry point                                                  */
/* ------------------------------------------------------------------ */

/**
 * One assistant turn.
 *
 * `prefer` is honoured where it can be. Falling back is a LABELLED event, not
 * a silent one: the return carries the provider that actually answered and
 * `degraded` when it was not the primary, and every surface shows it. An
 * assistant quietly answering from a much smaller model is how somebody comes
 * to believe the product got worse for no reason.
 */
export async function turn({
  system, messages, tools, question, digest,
  onDelta, signal, maxTokens, prefer = 'anthropic', allowFallback = true,
} = {}) {
  const status = providerStatus();
  const wantsPrimary = prefer === 'anthropic' && status.primary;
  if (wantsPrimary) {
    try {
      const out = await anthropicTurn({ system, messages, tools, onDelta, signal, maxTokens });
      return { ...out, provider: 'anthropic', model: config.deenaiModel, degraded: false };
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      if (!allowFallback || !status.fallback) throw error;
      // Fall through to the small model rather than answering nothing. The
      // caller is told, and says so on screen.
      const out = await ollamaTurn({ question, digest });
      return {
        ...out, provider: 'ollama', model: config.ollamaModel, degraded: true,
        degradedReason: String(error.message || 'the main model was unavailable'),
      };
    }
  }
  if (status.fallback) {
    const out = await ollamaTurn({ question, digest });
    return {
      ...out, provider: 'ollama', model: config.ollamaModel,
      degraded: Boolean(status.primary), degradedReason: status.primary ? 'the fallback was asked for' : '',
    };
  }
  throw new ProviderError('No model is configured for this deployment.', { provider: 'none', statusCode: 503 });
}
