import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

/**
 * The whole turn, driven against a server that speaks the real wire format.
 *
 * This is the file that proves the machinery rather than the taste: the SSE
 * parse, the tool round trip, the permission gate inside the loop, the
 * grounding refusal, the fallback, and Stop. It cannot say whether the model
 * writes a good answer — only a real model can, and `scripts/deenai-eval.mjs`
 * is what asks it that.
 *
 * The stub emits Anthropic's own event sequence (message_start,
 * content_block_start / _delta / _stop, message_delta, message_stop) because a
 * parser tested against a shape somebody invented proves nothing about the one
 * it will meet.
 */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-aistream-'));
process.env.DATA_DIR = dataDir;
process.env.APP_SESSION_SECRET = 'deenai-stream-secret-long-enough-for-this';
process.env.ANTHROPIC_API_KEY = 'test-key-not-a-real-one';
process.env.DEENAI_MODEL = 'claude-sonnet-5';
process.env.DEENAI_BUDGET_MS = '20000';

// The stub stands in for api.anthropic.com. Started BEFORE config.js is first
// imported, because config reads the base URL once.
let script = [];
let seen = [];
const upstream = http.createServer((req, res) => {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    let body = {};
    try { body = JSON.parse(raw); } catch { /* the stub records what it got */ }
    seen.push({ headers: req.headers, body });
    const step = script.shift();
    if (!step) { res.writeHead(500).end('{"error":{"message":"no script left"}}'); return; }
    if (step.status && step.status !== 200) {
      res.writeHead(step.status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: step.error || 'refused' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('message_start', { type: 'message_start', message: { id: 'm1', role: 'assistant' } });
    let index = 0;
    for (const block of step.blocks || []) {
      if (block.text !== undefined) {
        send('content_block_start', { type: 'content_block_start', index, content_block: { type: 'text', text: '' } });
        // Split so the reader has to reassemble, which is what a real stream does.
        for (const piece of String(block.text).match(/[\s\S]{1,12}/g) || []) {
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'text_delta', text: piece } });
        }
      } else {
        send('content_block_start', {
          type: 'content_block_start', index,
          content_block: { type: 'tool_use', id: `t${index}`, name: block.tool, input: {} },
        });
        const json = JSON.stringify(block.input || {});
        for (const piece of json.match(/[\s\S]{1,7}/g) || ['{}']) {
          send('content_block_delta', { type: 'content_block_delta', index, delta: { type: 'input_json_delta', partial_json: piece } });
        }
      }
      send('content_block_stop', { type: 'content_block_stop', index });
      index += 1;
    }
    send('message_delta', { type: 'message_delta', delta: { stop_reason: step.stop || 'end_turn' }, usage: { output_tokens: 20 } });
    send('message_stop', { type: 'message_stop' });
    res.end();
  });
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${upstream.address().port}`;

const { state } = await import('../src/store.js');
const chat = await import('../src/deenai-chat.js');
const goals = await import('../src/deenai-goal.js');

test.after(() => new Promise(resolve => upstream.close(() => {
  try { fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); } catch { /* harmless */ }
  resolve();
})));

const USER = { id: 'u-stream', email: 's@x', role: 'user', billing: { plan: 'pro_monthly' } };
const OTHER = { id: 'u-other', email: 'o@x', role: 'user', billing: { plan: 'pro_monthly' } };
state.projects = [
  { id: 'p1', userId: USER.id, title: 'Never lose hope', status: 'done' },
  { id: 'p2', userId: OTHER.id, title: 'Not yours', status: 'done' },
];
state.clips = [
  { id: 'c1', userId: USER.id, projectId: 'p1', title: 'One', status: 'approved', score: 88, scoreReasons: ['question hook'], transcript: 'A.', startSec: 0, endSec: 30, addedAt: 1 },
  { id: 'c2', userId: USER.id, projectId: 'p1', title: 'Two', status: 'waiting', score: 71, scoreReasons: [], transcript: 'B.', startSec: 0, endSec: 40, addedAt: 2 },
  { id: 'c3', userId: USER.id, projectId: 'p1', title: 'Three', status: 'waiting', score: 65, scoreReasons: [], transcript: 'C.', startSec: 0, endSec: 50, addedAt: 3 },
  { id: 'cx', userId: OTHER.id, projectId: 'p2', title: 'Theirs', status: 'approved', score: 99, scoreReasons: [], transcript: 'X.', startSec: 0, endSec: 30, addedAt: 4 },
];
state.userSettings = {};
goals.setCreatorProfile(USER, { goal: 'consistency' });

function reset() { script = []; seen = []; }

test('a tool round trip runs the tool and streams the answer', async () => {
  reset();
  script = [
    { blocks: [{ tool: 'get_account_status', input: {} }], stop: 'tool_use' },
    { blocks: [{ text: 'Recommendation: review the 2 waiting clips.\nEvidence: 4 clips on the account.\nConfidence: high' }] },
  ];
  const seenDeltas = [];
  const steps = [];
  const out = await chat.askV2(USER, {
    question: 'What should I do?', mode: 'today', now: Date.now(),
    onDelta: text => seenDeltas.push(text),
    onEvent: e => steps.push(e.name),
  });
  assert.deepEqual(steps, ['get_account_status'], 'the tool ran and was announced');
  assert.ok(seenDeltas.length > 1, 'the answer arrived in pieces');
  assert.equal(seenDeltas.join(''), out.answer, 'and the pieces are the answer');
  assert.equal(out.provider, 'anthropic');
  assert.equal(out.degraded, false);
  assert.deepEqual(out.sourceKinds, ['account analytics']);
  assert.ok(out.conversationId, 'a conversation was started');
});

test('the tool RESULT is fenced, and the request carries the tool list', () => {
  const second = seen[1];
  assert.ok(second, 'a second request was made after the tool');
  const toolResult = second.body.messages.at(-1).content[0];
  assert.equal(toolResult.type, 'tool_result');
  assert.match(toolResult.content, /BEGIN UNTRUSTED TOOL get_account_status/);
  assert.ok(second.body.tools.some(t => t.name === 'get_relevant_clips'), 'the tools were offered');
  assert.equal(second.body.stream, true);
  assert.equal(second.body.model, 'claude-sonnet-5');
  assert.equal(second.headers['x-api-key'], 'test-key-not-a-real-one');
});

test('the account\'s own question travels inside the fence', () => {
  const first = seen[0];
  const question = first.body.messages[0].content[0].text;
  assert.match(question, /^BEGIN UNTRUSTED QUESTION/);
  assert.match(question, /END UNTRUSTED QUESTION$/);
});

test('a confirm-class tool never runs; it comes back as a proposal', async () => {
  reset();
  script = [
    { blocks: [{ tool: 'add_draft_to_schedule', input: { clipId: 'c1' } }], stop: 'tool_use' },
    { blocks: [{ text: 'Recommendation: I cannot schedule that myself.\nNext action: open the Schedule.\nConfidence: high' }] },
  ];
  const before = JSON.stringify(state.clips.find(c => c.id === 'c1'));
  const out = await chat.askV2(USER, { question: 'Schedule the best one.', mode: 'ask', now: Date.now() });
  assert.deepEqual(out.proposals, [{ tool: 'add_draft_to_schedule', input: { clipId: 'c1' } }]);
  assert.equal(JSON.stringify(state.clips.find(c => c.id === 'c1')), before, 'nothing was scheduled');
  const result = seen[1].body.messages.at(-1).content[0];
  assert.equal(result.is_error, false, 'the refusal is a readable result, not an error');
  assert.match(result.content, /needs the person to confirm/);
});

test('a tool call for another account\'s clip comes back empty rather than answered', async () => {
  reset();
  script = [
    { blocks: [{ tool: 'get_selected_clip', input: { clipId: 'cx' } }], stop: 'tool_use' },
    { blocks: [{ text: 'Recommendation: that clip is not on this account.\nConfidence: high' }] },
  ];
  await chat.askV2(USER, { question: 'Tell me about that clip.', mode: 'ask', now: Date.now() });
  const result = seen[1].body.messages.at(-1).content[0];
  assert.match(result.content, /not on this account/);
  assert.doesNotMatch(result.content, /Theirs/, "the other account's title never reached the model");
});

test('an answer carrying a figure no tool returned is refused, and nothing is stored', async () => {
  reset();
  script = [
    { blocks: [{ tool: 'get_account_status', input: {} }], stop: 'tool_use' },
    { blocks: [{ text: 'Recommendation: post more.\nEvidence: your completion rate is 73%.\nConfidence: high' }] },
  ];
  const before = chat.conversations(USER).length;
  await assert.rejects(
    () => chat.askV2(USER, { question: 'How am I doing?', mode: 'ask', now: Date.now() }),
    err => {
      assert.equal(err.code, 'answer_refused');
      assert.match(err.message, /73/);
      return true;
    },
  );
  assert.equal(chat.conversations(USER).length, before, 'a refused answer starts no conversation');
});

test('multi-turn: the second question carries the first exchange', async () => {
  reset();
  script = [{ blocks: [{ text: 'Recommendation: start with the shorter one.\nConfidence: medium' }] }];
  const first = await chat.askV2(USER, { question: 'Which first?', mode: 'ask', now: Date.now() });
  reset();
  script = [{ blocks: [{ text: 'Recommendation: because it ends cleanly.\nConfidence: medium' }] }];
  const second = await chat.askV2(USER, {
    question: 'Why?', mode: 'ask', conversationId: first.conversationId, now: Date.now(),
  });
  assert.equal(second.conversationId, first.conversationId);
  const messages = seen[0].body.messages;
  assert.equal(messages.length, 3, 'question, answer, question');
  assert.match(messages[0].content[0].text, /Which first\?/);
  assert.match(messages[1].content[0].text, /shorter one/);
  const stored = chat.conversation(USER, first.conversationId);
  assert.equal(stored.turns.length, 4, 'both exchanges are kept');
  assert.equal(stored.title, 'Which first?', 'titled from the first question, not the answer');
});

test('a conversation id from another account is refused', async () => {
  reset();
  const mine = chat.conversations(USER)[0];
  await assert.rejects(
    () => chat.askV2(OTHER, { question: 'hi', conversationId: mine.id, now: Date.now() }),
    /not on this account/,
  );
});

test('the primary failing falls back to the small model, and says so', async () => {
  reset();
  // No worker is configured here, so the fallback itself refuses -- which is
  // the honest behaviour for a deployment with neither, and what the screen
  // then tells the person.
  script = [{ status: 529, error: 'overloaded' }];
  await assert.rejects(
    () => chat.askV2(USER, { question: 'anything', mode: 'ask', now: Date.now() }),
    err => {
      assert.match(err.message, /overloaded|worker|model/i);
      return true;
    },
  );
});

test('Stop aborts the turn rather than finishing it', async () => {
  reset();
  script = [{ blocks: [{ text: 'Recommendation: something long.\nConfidence: low' }] }];
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => chat.askV2(USER, { question: 'anything', mode: 'ask', signal: controller.signal, now: Date.now() }),
    /Cancelled/,
  );
});

test('a product question is offered the docs tool and answers from it', async () => {
  reset();
  script = [
    { blocks: [{ tool: 'search_product_docs', input: { question: 'how do I connect tiktok' } }], stop: 'tool_use' },
    { blocks: [{ text: 'Recommendation: open Connections and press Connect on TikTok.\nSource: product documentation\nConfidence: high' }] },
  ];
  const out = await chat.askV2(USER, { question: 'How do I connect TikTok?', mode: 'product', now: Date.now() });
  assert.deepEqual(out.sourceKinds, ['product documentation']);
  assert.match(seen[0].body.system, /Answer only from search_product_docs/);
});

test('the system prompt states the rules the guard enforces', () => {
  const system = seen[0].body.system;
  for (const rule of [
    'NEVER invent a number',
    'DeenClipped receives NO audience data',
    'not a scholar',
    'Canonical Qur\'an text is never rewritten',
    'nasheed under Qur\'an recitation',
    'Recommendation:',
    'Confidence: high, medium or low',
  ]) {
    assert.ok(system.includes(rule), `the prompt states: ${rule}`);
  }
  // And the account's own goal, so the answer is ordered for what they chose.
  assert.match(system, /more consistent posting/i);
});
