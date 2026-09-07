import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// One wall-clock budget for a whole AI request, and a limiter on both AI
// routes (v3.143.2).
//
// A LIVE BUG: both worker AI endpoints retry up to three times and both gave
// EACH attempt the full timeout — 3×90s on the title path, 3×75s on Ask —
// against a client that aborts at 90s. So a slow box could spend four and a
// half minutes of its single Ollama slot on an answer nobody would receive,
// and the customer got WorkerUnavailableError's default sentence, "Your job
// remains queued", about an operation that queues nothing.
//
// These are source tests on purpose: the failure only appears with a slow box
// and a real clock, and there is no executed output to read for "the second
// attempt was given what was left". The Python side drives the arithmetic.

const service = fs.readFileSync(new URL('../worker/service.py', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/worker-client.js', import.meta.url), 'utf8');

test('no AI call carries a fixed timeout any more', () => {
  const code = service.replace(/#.*$/gm, '');
  // The two that were there, by value, so a reintroduced literal is caught.
  assert.doesNotMatch(code, /urlopen\([^)]*timeout=90\)/, 'the title path');
  assert.doesNotMatch(code, /urlopen\([^)]*timeout=75\)/, 'Ask');
  assert.equal((code.match(/timeout=ai_timeout\(deadline\)/g) || []).length, 2,
    'both AI paths take what is left of the budget');
});

test('the budget covers the retries, not each attempt', () => {
  // Each retry loop must refuse to start an attempt that cannot finish.
  const loops = service.match(/for attempt, temperature in enumerate\(\([^)]*\)\):\n(?:.*\n){1,8}/g) || [];
  assert.equal(loops.length, 2, 'Ask and the title path both retry');
  for (const loop of loops) {
    assert.match(loop, /if attempt and not ai_time_left\(deadline\)/, 'and both check the budget first');
  }
  // And the whole budget must sit UNDER the client's own abort, or the app
  // gives up while the box is still working and the slot is spent for nothing.
  const budget = Number(/AI_BUDGET_SECONDS = float\(os\.getenv\("AI_BUDGET_SECONDS", "(\d+)"\)\)/.exec(service)[1]);
  const abort = Number(/timeoutMs: (\d+)_000/.exec(client)[1]);
  assert.ok(budget < abort, `the worker's budget (${budget}s) finishes inside the client's abort (${abort}s)`);
});

test('an attempt is never given a pointless timeout', () => {
  // A nearly-spent budget must still ask a real question rather than timing
  // out on arrival, so what is left is floored.
  assert.match(service, /def ai_timeout\(deadline: float\) -> float:[\s\S]*?max\(AI_MIN_ATTEMPT_SECONDS/);
});

test('both AI routes are rate-limited, per account', () => {
  // Neither had a limiter while sign-up, verify, forgot, redeem and presign
  // all do -- and each press now costs up to three generations on a box with
  // ONE Ollama slot, so one account could hold the model against everyone.
  for (const key of ['deenai-ask:', 'deenai-title:']) {
    const call = new RegExp(`rateLimit\\(\`${key}\\$\\{currentUser\\.id\\}\``);
    assert.match(server, call, `${key} is limited by ACCOUNT, not by IP`);
  }
  // Both refuse with 429 and say when to come back.
  const asks = server.slice(server.indexOf('deenai-ask:'), server.indexOf('deenai-ask:') + 500);
  assert.match(asks, /429/);
  assert.match(asks, /retryAfterSec/);
});

test('the limiter runs AFTER the plan gate', () => {
  // Or a free account's refusal would depend on how often it had asked, and
  // the honest answer ("this is a Pro feature") would come and go.
  const at = server.indexOf("pathname === '/api/deenai/ask'");
  const block = server.slice(at, at + 1400);
  assert.ok(block.indexOf('deenaiAskAccess') < block.indexOf('deenai-ask:'),
    'the plan is checked before the throttle');
});
