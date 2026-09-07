import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';

/**
 * The box can be ASKED what DeenAI actually answers (v3.143.3).
 *
 * No test in this repo can tell you what qwen3:1.7b does with a correct
 * prompt. v3.122.0 shipped five title shapes proven by nine unit tests, and
 * four of the five echoed the current title on the box -- the tests asserted
 * the PROMPT, and the prompt was right. Ask had never been read from the app
 * at all; the two failures that prompted v3.142.0's rejection gate (an
 * invented "80%" and an audience claim) were found by asking it one real
 * question from a browser.
 *
 * deploy-worker.yml's `advise` input runs .github/scripts/advise-probe.py
 * INSIDE the container, so the answers below come from a version the run has
 * just proved. What CI can pin is the drift it can see.
 */
const script = fs.readFileSync(new URL('../.github/scripts/advise-probe.py', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/deploy-worker.yml', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../worker/service.py', import.meta.url), 'utf8');

test('the probe parses', () => {
  execFileSync('python3', ['-m', 'py_compile', '.github/scripts/advise-probe.py'], { stdio: 'pipe' });
});

test('it keeps the seam the workflow checks for', () => {
  assert.ok(script.includes('\nPARAMS = {}\n'), 'the literal the runner looks for');
  assert.match(workflow, /advise-probe\.py[\s\S]{0,400}?PARAMS = \{\}/,
    'and the workflow refuses to run a script that lost it');
});

test('the secret is signed with, never printed', () => {
  // Strip string literals before searching: NAMING the variable in an error
  // is what a good error does, and matching the raw line fails on the honest
  // one. The lesson worker-diagnose.test.mjs already recorded.
  const code = script.replace(/"""[\s\S]*?"""/g, '').replace(/'[^']*'|"[^"]*"/g, "''");
  const prints = code.split('\n').filter(l => /\bprint\(/.test(l));
  for (const line of prints) {
    assert.ok(!/SECRET/.test(line), `a print names the secret: ${line.trim()}`);
  }
  assert.match(script, /hmac\.new\(SECRET\.encode\(\)/, 'it signs with it');
  assert.match(script, /127\.0\.0\.1/, 'and asks the worker beside it');
});

test('an advise dispatch never deploys, and a push never probes', () => {
  const step = workflow.indexOf("- name: Ask the box's DeenAI what it answers");
  assert.ok(step > 0, 'the step exists');
  assert.match(workflow.slice(step, step + 300), /if: inputs\.advise == true/,
    'dispatch only — it spends the box\'s single Ollama slot');
  // The rebuild is skipped for a question, so asking cannot restart a job.
  const rebuild = workflow.indexOf('- name: Pull and rebuild on the box');
  assert.ok(rebuild > 0);
  assert.match(workflow.slice(rebuild, rebuild + 400), /if: inputs\.diagnose != true/);
});

test('what fails the run is a rule, never taste', () => {
  // A dull answer is the finding. Three things are not opinions: the box
  // refusing everything, this prompt's wording coming back, and a figure the
  // account does not have.
  assert.match(script, /refused == len\(QUESTIONS\)/);
  assert.match(script, /::error::.*repeated this prompt/);
  assert.match(script, /::error::.*stated a figure/);
  assert.match(script, /a dull one is a finding, not a failure/);
  // Audience language is REPORTED and not failed: the word can appear in an
  // honest sentence, and the worker's own gate is what refuses the claim.
  const at = script.indexOf('AUDIENCE_MARKERS = (');
  assert.ok(at > 0);
  assert.ok(!/::error::/.test(script.slice(script.indexOf('seen = [m for m in AUDIENCE_MARKERS'), script.indexOf('print("%d refused'))),
    'an audience word alone does not fail the run');
});

test('the probe asks the questions the app actually puts in the box', () => {
  // A probe asking about shapes nobody can send reports confidently on
  // nothing -- the rule clip-ai-probe.test.mjs established for CLIP_STYLES.
  const adapter = fs.readFileSync(new URL('../src/public/studio-adapter.js', import.meta.url), 'utf8');
  const chips = /var AI_PROMPTS = \[([^\]]+)\]/.exec(adapter)[1]
    .split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  assert.equal(chips.length, 3);
  for (const chip of chips) {
    assert.ok(script.includes(chip), `the probe asks "${chip}"`);
  }
});

test('the leak markers it checks are the worker\'s own', () => {
  // Two lists that can drift are two answers to one question: the probe would
  // pass an answer the worker itself would have rejected.
  const workerList = /ADVISE_LEAKED = \(([\s\S]*?)\)/.exec(service)[1];
  for (const marker of ['begin untrusted', 'end untrusted', 'account context', 'before you answer']) {
    assert.ok(workerList.includes(marker), `the worker refuses "${marker}"`);
    assert.ok(script.includes(marker), `and the probe looks for it`);
  }
});
