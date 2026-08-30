import * as billing from './billing.js';
import * as workerClient from './worker-client.js';
import { state } from './store.js';
import * as referrals from './referrals.js';
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

/**
 * The two plan gates for this feature, named in test/plan-gating.test.mjs.
 *
 * They are deliberately separate. The INSIGHTS are arithmetic over the
 * account's own records and cost nothing to serve, so Pro keeps them. ASK
 * spends a slot on the render box's Ollama and is what Studio is for. A single
 * gate would have meant either giving Studio's compute away with Pro or taking
 * back something Pro already shipped with.
 */
export function deenaiAccess(user) {
  return billing.atLeast(user, 'pro');
}

export function deenaiAskAccess(user) {
  return billing.atLeast(user, 'studio');
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

/**
 * What this account should do NEXT, ahead of anything it should know.
 *
 * The insight cards below describe patterns, which is the right thing to tell
 * somebody whose workflow is running. It is the wrong thing to tell somebody
 * who is stuck: an account with twelve clips sitting unreviewed was being told
 * its approved hooks average nine words. True, and useless.
 *
 * So the first card is the one action that unblocks them, and it appears ONLY
 * while there is one — an account that has taken a lecture all the way through
 * sees the patterns, as before.
 *
 * Derived from the same records as the growth funnel, deliberately: two
 * definitions of "stuck" would eventually disagree, and the owner's dashboard
 * and the customer's advice must not tell different stories about the same
 * account.
 */
function nextActionCard(user) {
  const step = referrals.nextStep(state, user.id);
  if (!step || step.key === 'done' || step.key === 'processing') return null;
  // "Subscribe" is derived from revenue events, and an account can hold a paid
  // plan without one — granted, comped, or migrated. Telling a paying customer
  // to subscribe is the kind of thing that makes them doubt every other number
  // on the screen.
  if (step.key === 'upgrade' && billing.isPaid(user)) return null;
  return {
    icon: 'ph ph-arrow-right', tone: 'gold',
    kicker: 'Do this next',
    title: step.title,
    body: step.body,
  };
}

/**
 * What the clips you KEEP have in common with each other, and not with the
 * ones you threw away.
 *
 * This is the strongest signal in the product and nothing was reading it. A
 * person watched a clip and said no — that judgement is worth more than any
 * score, and it is the one thing a competitor cannot copy, because it is about
 * this account's taste rather than about video in general.
 *
 * Only speaks with enough of both to compare. Six kept and six rejected is the
 * floor: below that a "pattern" is one clip's accident, and advice built on it
 * would send somebody off in the wrong direction with confidence.
 */
function tasteCard(user) {
  const clips = ownClips(user);
  const kept = clips.filter(c => decided(c) === 'approved');
  const dropped = clips.filter(c => decided(c) === 'rejected');
  if (kept.length < 6 || dropped.length < 6) return null;

  const seconds = c => Math.max(0, Number(c.endSec) - Number(c.startSec));
  const median = list => {
    const v = list.map(seconds).filter(n => n > 0).sort((a, b) => a - b);
    if (!v.length) return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const keptLength = median(kept);
  const droppedLength = median(dropped);
  if (!keptLength || !droppedLength) return null;

  const gap = keptLength - droppedLength;
  // Under eight seconds apart is not a preference, it is noise.
  if (Math.abs(gap) < 8) return null;

  const shorter = gap < 0;
  return {
    icon: 'ph ph-scissors', tone: 'gold',
    kicker: 'You keep the',
    title: shorter ? 'shorter ones' : 'longer ones',
    line: shorter ? 'You keep the shorter ones' : 'You keep the longer ones',
    body: `Across ${kept.length} clips you kept and ${dropped.length} you rejected, the keepers run about `
      + `${Math.round(keptLength)}s against ${Math.round(droppedLength)}s for the ones you dropped. `
      + (shorter
        ? 'Marking tighter sections of a lecture gets you more usable clips per token, because the pipeline is already cutting closer to what you would have chosen.'
        : 'The moments worth keeping in your lectures need room to land, so a longer selection is not waste here — it is where your keepers come from.'),
  };
}

/**
 * Does the score agree with you?
 *
 * The worker scores every candidate and a person then approves or rejects it.
 * Nobody was comparing the two. Over enough decisions that comparison says
 * whether the scoring is calibrated FOR THIS ACCOUNT — and it is the number
 * that should drive the auto-approve threshold, which is currently a guess
 * somebody typed.
 *
 * Reported only when the two genuinely disagree, because "the score broadly
 * matches your judgement" is not worth a card.
 */
function calibrationCard(user) {
  const clips = ownClips(user).filter(c => Number.isFinite(Number(c.score)));
  const kept = clips.filter(c => decided(c) === 'approved');
  const dropped = clips.filter(c => decided(c) === 'rejected');
  if (kept.length < 6 || dropped.length < 6) return null;

  const mean = list => Math.round(list.reduce((a, c) => a + Number(c.score), 0) / list.length);
  const keptScore = mean(kept);
  const droppedScore = mean(dropped);

  // High-scoring clips the person threw away: the case where trusting the
  // score automatically would have published something they did not want.
  const highButRejected = dropped.filter(c => Number(c.score) >= 85).length;
  if (highButRejected < 3 && keptScore - droppedScore >= 8) return null;

  return {
    icon: 'ph ph-gauge', tone: 'gold',
    kicker: 'The score and you',
    title: highButRejected >= 3
      ? `You rejected ${highButRejected} clips the model rated 85+`
      : 'The score is not separating your keepers',
    body: `Kept clips average ${keptScore}, rejected ones ${droppedScore}. `
      + (highButRejected >= 3
        ? 'Auto-approve on a score threshold would have published those. Keep reviewing by hand on this account — the score is finding candidates, not making your decision.'
        : 'The two groups score almost the same, which means the number is not telling you anything useful yet. Judge on the clip, not the figure beside it.'),
  };
}

/**
 * Minutes in, clips out.
 *
 * The cards above all look at clips. None of them looked at what those clips
 * COST — and the product charges by the source minute, so the question a
 * customer actually has is how many minutes buy a keeper.
 */
function yieldCard(user) {
  const clips = ownClips(user);
  const projects = ownProjects(user).filter(p => Number(p.sourceDurationSec) > 0);
  if (projects.length < 2) return null;
  const kept = clips.filter(c => decided(c) === 'approved');
  if (kept.length < 3) return null;

  const minutes = projects.reduce((sum, p) => {
    const start = Number(p.sourceStartSec) || 0;
    const end = Number(p.sourceEndSec) || Number(p.sourceDurationSec) || 0;
    return sum + Math.max(0, (end - start) / 60);
  }, 0);
  if (minutes < 5) return null;

  const perKeeper = minutes / kept.length;
  return {
    icon: 'ph ph-coins', tone: 'gold',
    kicker: 'Every keeper costs you',
    title: `${Math.round(perKeeper)} source minutes`,
    line: `Every keeper costs you about ${Math.round(perKeeper)} source minutes`,
    body: `You have processed about ${Math.round(minutes)} minutes across ${projects.length} lectures and kept ${kept.length} clips. `
      + (perKeeper > 20
        ? 'That is a lot of minutes per usable clip. Marking a tighter range — the part you would replay — usually costs less and yields more, because most of a recording is setup and repetition.'
        : 'That is an efficient rate: you are already selecting the part of each lecture worth processing rather than sending the whole file.'),
  };
}

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
      line: isArabic(title) ? String(title).slice(0, 90) : `Clip more from “${String(title).slice(0, 80)}”`,
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
  const titled = kept.filter(c => words(c.title) > 0);
  // Titled clips only. Averaging in the untitled ones produced "your approved
  // hooks average 0 words", which is a card that makes the reader distrust
  // every other number beside it.
  if (titled.length >= 5) {
    const avg = Math.round(titled.reduce((a, c) => a + words(c.title), 0) / titled.length);
    const questions = titled.filter(c => /\?|^(do|did|have|has|are|is|what|why|how|when|who)\b/i.test(String(c.title || ''))).length;
    cards.push({
      icon: 'ph ph-text-aa', tone: '',
      title: 'Your approved hooks average ' + avg + ' words',
      body: questions >= Math.ceil(titled.length / 3)
        ? Math.round(questions / titled.length * 100) + '% open as questions — that pattern is working for you; the worker\u2019s "question hook" score reason agrees. Lean into it.'
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

  /*
   * Ordered by how much of it is about THIS account.
   *
   * The cards were previously in the order they were written, which meant the
   * two most specific things the product can say — what you keep, and whether
   * the score agrees with you — fell off the end of a five-card list behind
   * generic advice about hook length. Advice anyone could give goes last.
   *
   * Only five are shown, so this ordering decides what a customer actually
   * reads.
   */
  for (const card of [tasteCard(user), calibrationCard(user), yieldCard(user)]) {
    if (card) cards.push(card);
  }

  const rank = card => {
    if (card.kicker === 'Do this next') return 0;          // unblocks them
    if (card.kicker === 'The score and you') return 1;     // their decisions vs the model
    if (card.kicker === 'You keep the') return 2;          // their taste
    if (card.kicker === 'Clip more from') return 3;        // their best source
    if (card.kicker === 'Every keeper costs you') return 4; // their economics
    return 5;                                               // advice anyone could give
  };
  cards.sort((a, b) => rank(a) - rank(b));

  const next = nextActionCard(user);
  if (next) cards.unshift(next);

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

/**
 * It carries the INSIGHTS and the band as well as the raw counts.
 *
 * The model was being asked to notice, from bare totals, what this module had
 * already worked out two functions earlier -- so it either redid the
 * arithmetic badly or answered in generalities about short-form video. Handing
 * it the findings makes the answer specific to THIS account, and means a
 * spoken answer and the cards on screen cannot contradict each other.
 */
export function askContext(user) {
  const clips = ownClips(user);
  const projects = ownProjects(user);
  const kept = clips.filter(c => decided(c) === 'approved');
  const waiting = clips.filter(c => c.status === 'waiting');
  const failures = [...failedByProvider(clips)].map(([provider, n]) => providerName(provider) + ': ' + n);
  return {
    insights: insights(user)
      .map(card => [card.kicker, card.title].filter(Boolean).join(' ') + ' \u2014 ' + card.body)
      .slice(0, 4),
    figures: metrics(user).map(m => m.label + ': ' + m.value + (m.unit ? ' ' + m.unit : '') + ' (' + m.note + ')'),
    lectures: projects.length,
    clipsTotal: clips.length,
    clipsKept: kept.length,
    clipsWaiting: waiting.length,
    clipsPosted: clips.filter(c => c.postedAt).length,
    scriptureAwaitingReview: waiting.filter(c => c.reviewRequired).length || undefined,
    averageKeptScore: kept.length ? Math.round(kept.reduce((a, c) => a + (Number(c.score) || 0), 0) / kept.length) : null,
    postingWindowsPerDay: (config.postTimes || []).length || undefined,
    failedPostsByDestination: failures.length ? failures : undefined,
    recentKeptTitles: kept.slice(-5).map(c => String(c.title || '').slice(0, 80)),
    destinations: [...new Set(clips.flatMap(c => (c.targets || []).map(t => t.provider)))],
  };
}

export async function ask(user, question) {
  const q = String(question || '').trim();
  if (!q) throw Object.assign(new Error('Ask a question first.'), { statusCode: 400 });
  if (q.length > 500) throw Object.assign(new Error('Keep the question under 500 characters.'), { statusCode: 400 });
  if (!deenaiAskAccess(user)) {
    throw Object.assign(new Error('Asking DeenAI is a Studio feature. Pro shows the insights; Studio answers questions.'), { statusCode: 403 });
  }
  if (config.processingMode !== 'remote') {
    throw Object.assign(new Error('DeenAI answers run on the render worker, which this deployment does not have connected.'), { statusCode: 503 });
  }
  const result = await workerClient.advise({ question: q, context: askContext(user) });
  const answer = String(result?.answer || '').trim();
  if (!answer) throw Object.assign(new Error('DeenAI had no answer. Try rephrasing the question.'), { statusCode: 502 });
  return answer;
}
