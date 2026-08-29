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
/**
 * The insight cards. Each one is a claim the account's own data supports,
 * with the working in the body — advice that cannot say where its numbers
 * came from is noise with confidence.
 *
 * The FIRST card is the headline and the screen gives it the room: where it
 * has a `figure` (a lecture's keep rate), that figure is drawn large beside
 * the lecture's own name. Everything else is a plain row.
 */
export function insights(user) {
  const clips = ownClips(user);
  const projects = ownProjects(user);
  const cards = [];
  const kept = clips.filter(c => decided(c) === 'approved');
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
      kicker: 'Clip more from',
      // The lecture's OWN name, not a sentence wrapped around it: a recitation
      // titled in Arabic has to be able to render right-to-left in Amiri, and
      // it cannot if it is glued into the middle of an English string.
      title: String(title).slice(0, 90),
      rtl: isArabic(title),
      figure: best.kept + '/' + best.total,
      figureLabel: 'Clips kept',
      figureNote: 'your best keep rate',
      body: 'More sections of the same lecture are the cheapest good clips you can make: '
        + 'the import is cached, so they cost minutes, not bandwidth.',
    });
  }

  // Scripture held for review is unpublished reach sitting in a queue.
  const flagged = waiting.filter(c => c.reviewRequired).length;
  if (flagged) {
    cards.push({
      icon: 'ph ph-book-open-text', tone: '',
      title: flagged + ' scripture clip' + (flagged === 1 ? '' : 's') + ' await' + (flagged === 1 ? 's' : '') + ' the shaykh',
      body: 'Quran clips are consistently the strongest performers for accounts like this one, and they publish nothing until a person signs them off. Reviewing these first usually beats making more clips.',
    });
  }

  // A destination that keeps refusing is a growth ceiling, not a log line.
  for (const [provider, n] of failedByProvider(clips)) {
    if (n < 2) continue;
    cards.push({
      icon: 'ph ph-warning-circle', tone: 'warn',
      title: providerName(provider) + ' has refused ' + n + ' posts',
      body: 'Every refusal is reach you already paid to render. Open the schedule row\u2019s explanation — the fix is usually the account connection or a platform review, not the clip.',
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
        ? Math.round(questions / kept.length * 100) + '% open as questions — that pattern is working for you; the worker\u2019s "question hook" score reason agrees. Lean into it.'
        : 'Openers that pose a question ("Have you ever…") outperform statements in short-form. Try approving a few and compare.',
    });
  }

  // Consistency, which the algorithms reward more than any single clip.
  if (clips.some(c => c.postedAt)) {
    const days = postedDays(clips);
    cards.push({
      icon: 'ph ph-calendar-check', tone: days >= 10 ? 'good' : '',
      title: days >= 10 ? 'You are posting almost every day' : 'Posting is the gap, not the clips',
      body: days >= 10
        ? 'That regularity is what feeds every platform\u2019s recommendation system. Keep the streak — approved clips take the next free slots automatically.'
        : 'Short-form rewards showing up daily more than any single clip. Keep the review queue clear and enough approved clips banked to fill every posting window.',
    });
  }

  return cards.slice(0, 5);
}

/**
 * The band of figures across the top of the screen: four numbers a person can
 * act on, each with the sentence that says what to do about it. Computed from
 * the same records as the cards, in the same module, so the two can never
 * disagree — which is exactly what would happen if the screen counted its own.
 */
export function metrics(user) {
  const clips = ownClips(user);
  const kept = clips.filter(c => decided(c) === 'approved');
  const waiting = clips.filter(c => c.status === 'waiting');
  const rows = [];

  const keptScores = kept.map(c => Number(c.score) || 0).filter(Boolean).sort((a, b) => a - b);
  if (keptScores.length >= 5) {
    const bar = keptScores[Math.floor(keptScores.length * 0.25)];
    const above = waiting.filter(c => (Number(c.score) || 0) >= bar).length;
    rows.push({
      key: 'bar', label: 'Approval bar', value: String(bar), tone: 'gold',
      note: above
        ? above + ' waiting clip' + (above === 1 ? '' : 's') + ' clear it — review those first'
        : 'nothing waiting clears it yet',
    });
  }

  if (clips.some(c => c.postedAt)) {
    rows.push({
      key: 'posted', label: 'Posted', value: String(postedDays(clips)), unit: 'of 14 days', tone: '',
      note: 'consistency feeds every algorithm',
    });
  }

  const failures = [...failedByProvider(clips)];
  if (failures.length) {
    const [provider, n] = failures.sort((a, b) => b[1] - a[1])[0];
    rows.push({
      key: 'refused', label: providerName(provider) + ' refusals', value: String(n), tone: 'warn',
      note: n > 1 ? 'one connection fix, not ' + n + ' bad clips' : 'reach you already paid to render',
    });
  }

  if (waiting.length) {
    rows.push({
      key: 'waiting', label: 'Awaiting review', value: String(waiting.length), tone: '',
      note: 'the deck (A / X / S) clears this in minutes',
    });
  }

  return rows.slice(0, 4);
}

const ARABIC = /[\u0600-\u06FF\u0750-\u077F]/;
function isArabic(text) { return ARABIC.test(String(text || '')); }

function providerName(provider) {
  return { tiktok: 'TikTok', youtube: 'YouTube', instagram: 'Instagram', facebook: 'Facebook' }[provider] || provider;
}

function failedByProvider(clips) {
  const failed = new Map();
  for (const c of clips) {
    for (const t of c.targets || []) {
      if (t.status === 'failed') failed.set(t.provider, (failed.get(t.provider) || 0) + 1);
    }
  }
  return failed;
}

/** Distinct days posted on in the last fortnight. */
function postedDays(clips) {
  const since = Date.now() - 14 * DAY_MS;
  return new Set(clips.filter(c => Number(c.postedAt) > since)
    .map(c => new Date(Number(c.postedAt)).toISOString().slice(0, 10))).size;
}

/** What a locked account sees: the shape of the product, unmistakably not theirs. */
export function demoInsights() {
  return [
    { icon: 'ph ph-film-script', tone: 'gold', demo: true,
      kicker: 'Clip more from', title: '\u201cPatience in Hardship\u201d', rtl: false,
      figure: '7/9', figureLabel: 'Clips kept', figureNote: 'your best keep rate',
      body: 'More sections of the same lecture are the cheapest good clips you can make: the import is cached, so they cost minutes, not bandwidth.' },
    { icon: 'ph ph-book-open-text', tone: '', demo: true,
      title: '2 scripture clips await the shaykh',
      body: 'Quran clips are consistently the strongest performers for accounts like this one, and they publish nothing until a person signs them off.' },
    { icon: 'ph ph-text-aa', tone: '', demo: true,
      title: 'Your approved hooks average 9 words',
      body: '40% open as questions — that pattern is working; the worker\u2019s "question hook" score reason agrees.' },
    { icon: 'ph ph-calendar-check', tone: 'good', demo: true,
      title: 'You are posting almost every day',
      body: 'That regularity is what feeds every platform\u2019s recommendation system. Keep the streak.' },
  ];
}

export function demoMetrics() {
  return [
    { key: 'bar', label: 'Approval bar', value: '78', tone: 'gold', note: '4 waiting clips clear it — review those first', demo: true },
    { key: 'posted', label: 'Posted', value: '11', unit: 'of 14 days', tone: '', note: 'consistency feeds every algorithm', demo: true },
    { key: 'refused', label: 'TikTok refusals', value: '2', tone: 'warn', note: 'one connection fix, not 2 bad clips', demo: true },
    { key: 'waiting', label: 'Awaiting review', value: '6', tone: '', note: 'the deck (A / X / S) clears this in minutes', demo: true },
  ];
}

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
