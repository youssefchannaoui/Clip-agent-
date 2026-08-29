import * as billing from './billing.js';
import * as workerClient from './worker-client.js';
import { state } from './store.js';
import { config } from './config.js';

/**
 * DeenAI — the growth assistant, for Pro accounts.
 *
 * Two halves, deliberately different in kind:
 *
 *  - INSIGHTS are computed here, from the account's own records, with the
 *    arithmetic shown. No model is involved, so they can never hallucinate a
 *    number: every figure on a card is countable in the same state file the
 *    rest of the app reads. Where the data is too thin to say something
 *    honestly (a lecture with two clips has no "keep rate"), the card is
 *    omitted rather than padded.
 *
 *  - ASK is the self-hosted Ollama on the worker box, handed a compact summary
 *    of the same numbers plus the question. Nothing leaves the server the
 *    product does not already run — the same privacy posture as transcripts,
 *    which is the entire reason a hosted model is not used here.
 *
 * The gate is Pro (or the operator). Everyone else may LOOK: the endpoint
 * returns demo cards marked as such, so the tab can show what it does without
 * doing it — a shop window, not a side door.
 */

/** The one plan gate for this feature, named in test/plan-gating.test.mjs. */
export function deenaiAccess(user) {
  return billing.isPaid(user) || billing.isUnlimited(user);
}

const DAY_MS = 24 * 60 * 60 * 1000;

function ownClips(user) {
  return (state.clips || []).filter(c => !c.userId || c.userId === user.id);
}
function ownProjects(user) {
  return (state.projects || []).filter(p => !p.userId || p.userId === user.id);
}
function decided(clip) {
  if (clip.status === 'rejected') return 'rejected';
  if (['approved', 'scheduled', 'publishing', 'retrying', 'ready', 'posted'].includes(clip.status)) return 'approved';
  return null;
}

/**
 * The insight cards. Each one is a claim the account's own data supports,
 * with the working in the body — advice that cannot say where its numbers
 * came from is noise with confidence.
 */
export function insights(user) {
  const clips = ownClips(user);
  const projects = ownProjects(user);
  const cards = [];
  const kept = clips.filter(c => decided(c) === 'approved');
  const rejected = clips.filter(c => decided(c) === 'rejected');
  const waiting = clips.filter(c => c.status === 'waiting');

  // Which lecture earns its minutes. Only lectures with enough clips to judge.
  const byProject = new Map();
  for (const c of clips) {
    const bucket = byProject.get(c.projectId) || { total: 0, kept: 0 };
    bucket.total += 1;
    if (decided(c) === 'approved') bucket.kept += 1;
    byProject.set(c.projectId, bucket);
  }
  let best = null;
  for (const [projectId, bucket] of byProject) {
    if (bucket.total < 3) continue;
    const rate = bucket.kept / bucket.total;
    if (!best || rate > best.rate) best = { projectId, rate, ...bucket };
  }
  if (best && best.kept > 0) {
    const title = projects.find(p => p.id === best.projectId)?.title || 'that lecture';
    cards.push({
      icon: 'ph ph-film-script', tone: 'gold',
      title: 'Clip more from ' + String(title).slice(0, 60),
      body: 'You kept ' + best.kept + ' of its ' + best.total + ' clips — your best keep rate. '
        + 'More sections of the same lecture are the cheapest good clips you can make: the import is cached, so they cost minutes, not bandwidth.',
    });
  }

  // Where the approval bar actually sits, and what clears it right now.
  const scoresOf = list => list.map(c => Number(c.score) || 0).filter(Boolean).sort((a, b) => a - b);
  const keptScores = scoresOf(kept);
  if (keptScores.length >= 5) {
    const bar = keptScores[Math.floor(keptScores.length * 0.25)];
    const above = waiting.filter(c => (Number(c.score) || 0) >= bar).length;
    cards.push({
      icon: 'ph ph-target', tone: '',
      title: 'Your bar is around ' + bar,
      body: 'Three quarters of what you approve scores ' + bar + ' or higher.'
        + (above ? ' ' + above + ' waiting clip' + (above === 1 ? '' : 's') + ' clear that bar — review those first and the queue works highest-value-first.' : ' Nothing waiting clears it yet.'),
    });
  }

  // Consistency, which the algorithms reward more than any single clip.
  const twoWeeks = Date.now() - 14 * DAY_MS;
  const postDays = new Set(clips.filter(c => Number(c.postedAt) > twoWeeks)
    .map(c => new Date(Number(c.postedAt)).toISOString().slice(0, 10)));
  if (clips.some(c => c.postedAt)) {
    cards.push({
      icon: 'ph ph-calendar-check', tone: postDays.size >= 10 ? 'good' : '',
      title: 'Posted on ' + postDays.size + ' of the last 14 days',
      body: postDays.size >= 10
        ? 'That regularity is what feeds every platform’s recommendation system. Keep the streak — approved clips take the next free slots automatically.'
        : 'Short-form rewards showing up daily more than any single clip. Keep the review queue clear and enough approved clips banked to fill every posting window.',
    });
  }

  // A destination that keeps refusing is a growth ceiling, not a log line.
  const failedTargets = new Map();
  for (const c of clips) {
    for (const t of c.targets || []) {
      if (t.status === 'failed') failedTargets.set(t.provider, (failedTargets.get(t.provider) || 0) + 1);
    }
  }
  for (const [provider, n] of failedTargets) {
    if (n < 2) continue;
    cards.push({
      icon: 'ph ph-warning-circle', tone: 'warn',
      title: (provider === 'tiktok' ? 'TikTok' : provider === 'youtube' ? 'YouTube' : provider) + ' has refused ' + n + ' posts',
      body: 'Every refusal is reach you already paid to render. Open the schedule row’s explanation — the fix is usually the account connection or a platform review, not the clip.',
    });
  }

  // Scripture held for review is unpublished reach sitting in a queue.
  const flagged = waiting.filter(c => c.reviewRequired).length;
  if (flagged) {
    cards.push({
      icon: 'ph ph-book-open-text', tone: '',
      title: flagged + ' scripture clip' + (flagged === 1 ? '' : 's') + ' await review',
      body: 'Quran clips are consistently the strongest performers for accounts like this one, and they publish nothing until a person signs them off. Reviewing these first usually beats making more clips.',
    });
  }

  // What your approved hooks look like, so the next titles can match them.
  const words = t => String(t || '').trim().split(/\s+/).filter(Boolean).length;
  if (kept.length >= 5) {
    const avg = Math.round(kept.reduce((a, c) => a + words(c.title), 0) / kept.length);
    const questions = kept.filter(c => /\?|^(do|did|have|has|are|is|what|why|how|when|who)\b/i.test(String(c.title || ''))).length;
    cards.push({
      icon: 'ph ph-text-aa', tone: '',
      title: 'Your approved hooks average ' + avg + ' words',
      body: questions >= Math.ceil(kept.length / 3)
        ? Math.round(questions / kept.length * 100) + '% open as questions — that pattern is working for you; the worker’s "question hook" score reason agrees. Lean into it.'
        : 'Openers that pose a question ("Have you ever…") outperform statements in short-form. Try approving a few and compare.',
    });
  }

  // The queue itself, when it is the bottleneck.
  if (waiting.length >= 8) {
    cards.push({
      icon: 'ph ph-stack', tone: '',
      title: waiting.length + ' clips are waiting on you',
      body: 'Nothing posts without a decision. The deck with the keyboard (A / X / S) clears a queue this size in a few minutes.',
    });
  }

  return cards.slice(0, 6);
}

/** What a locked account sees: the shape of the product, unmistakably not theirs. */
export function demoInsights() {
  return [
    { icon: 'ph ph-film-script', tone: 'gold', demo: true,
      title: 'Clip more from “Patience in Hardship”',
      body: 'You kept 7 of its 9 clips — your best keep rate. More sections of the same lecture are the cheapest good clips you can make.' },
    { icon: 'ph ph-target', tone: '', demo: true,
      title: 'Your bar is around 78',
      body: 'Three quarters of what you approve scores 78 or higher. 4 waiting clips clear that bar — review those first.' },
    { icon: 'ph ph-calendar-check', tone: 'good', demo: true,
      title: 'Posted on 11 of the last 14 days',
      body: 'That regularity is what feeds every platform’s recommendation system. Keep the streak.' },
    { icon: 'ph ph-text-aa', tone: '', demo: true,
      title: 'Your approved hooks average 9 words',
      body: '40% open as questions — that pattern is working; the worker’s "question hook" score reason agrees.' },
  ];
}

/** The compact account summary Ask hands the model — numbers, never transcripts. */
export function askContext(user) {
  const clips = ownClips(user);
  const projects = ownProjects(user);
  const kept = clips.filter(c => decided(c) === 'approved');
  return {
    lectures: projects.length,
    clipsTotal: clips.length,
    clipsKept: kept.length,
    clipsWaiting: clips.filter(c => c.status === 'waiting').length,
    clipsPosted: clips.filter(c => c.postedAt).length,
    averageKeptScore: kept.length ? Math.round(kept.reduce((a, c) => a + (Number(c.score) || 0), 0) / kept.length) : null,
    postingWindows: (config.postTimes || []).length || undefined,
    recentKeptTitles: kept.slice(-5).map(c => String(c.title || '').slice(0, 80)),
    destinations: [...new Set(clips.flatMap(c => (c.targets || []).map(t => t.provider)))],
  };
}

export async function ask(user, question) {
  const q = String(question || '').trim();
  if (!q) throw Object.assign(new Error('Ask a question first.'), { statusCode: 400 });
  if (q.length > 500) throw Object.assign(new Error('Keep the question under 500 characters.'), { statusCode: 400 });
  if (config.processingMode !== 'remote') {
    throw Object.assign(new Error('DeenAI answers run on the render worker, which this deployment does not have connected.'), { statusCode: 503 });
  }
  const result = await workerClient.advise({ question: q, context: askContext(user) });
  const answer = String(result?.answer || '').trim();
  if (!answer) throw Object.assign(new Error('DeenAI had no answer. Try rephrasing the question.'), { statusCode: 502 });
  return answer;
}
