/**
 * Retrieval over the product's own documentation.
 *
 * "How do I use DeenClipped?" is the one question a general model answers
 * worst and most confidently: it will describe a plausible dashboard that
 * does not exist, and send somebody looking for a screen this app has never
 * had. That has already happened here — the failure guidance told people to
 * open "the Platforms page", which lives only in a dashboard deleted months
 * ago.
 *
 * So product questions are answered from `src/help.js` — the same articles
 * the Help screen renders, which `test/help-content.test.mjs` already holds
 * to describing what the app ACTUALLY does. There is one source of product
 * truth, and DeenAI reads it rather than remembering it.
 *
 * The index is built once, in memory, from pure data with no imports. There
 * is no vector store and no embedding call: the corpus is twenty articles,
 * and a scored keyword match over titles, summaries, steps and notes finds
 * the right one in microseconds without a network round trip or a dependency.
 */

import { CATEGORIES } from './help.js';
import * as actions from './deenai-actions.js';

/** Words that match everything and therefore rank nothing. */
const STOP = new Set(('a an and are as at be but by can do does for from has have how i if in into is it its'
  + ' me my of on or should that the their then there these this to up use used want was what when where which'
  + ' who why will with you your').split(' '));

function terms(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
}

/**
 * Every article, flattened with the text that can be searched and the screen
 * it belongs to.
 *
 * The screen is taken from `deenai-actions.js` — the frozen table the studio
 * already uses to navigate — so a documentation answer can only ever offer to
 * open a screen the app can actually reach. A link built from a guess is the
 * "Platforms page" bug by another road.
 */
const SCREEN_HINTS = Object.freeze([
  [/queue|review|approve|reject|decide/, 'open-review'],
  [/schedul|posting window|calendar|slot|when it posts/, 'open-schedule'],
  [/connect|channel|tiktok|youtube|instagram|facebook|publish/, 'open-connections'],
  [/template|caption|style|watermark|look|atmosphere|brand/, 'open-templates'],
  [/nasheed|music|audio bed/, 'open-nasheed'],
  [/token|plan|billing|subscription|upgrade|price/, 'open-plans'],
  [/import|lecture|library|upload|link|source/, 'open-library'],
]);

function screenFor(text) {
  const hay = String(text || '').toLowerCase();
  for (const [re, id] of SCREEN_HINTS) if (re.test(hay)) return id;
  return '';
}

let INDEX = null;

function build() {
  const docs = [];
  for (const category of CATEGORIES) {
    for (const article of category.articles || []) {
      const body = [
        article.summary || '',
        ...(article.steps || []),
        ...(article.notes || []),
      ].filter(Boolean);
      const blob = [category.title, article.title, ...body].join(' ');
      const screenId = screenFor(`${article.title} ${category.title} ${article.summary || ''}`);
      const step = actions.ACTIONS?.[screenId];
      docs.push({
        id: `${category.id}/${article.id}`,
        category: category.title,
        title: article.title,
        summary: article.summary || '',
        steps: article.steps || [],
        notes: article.notes || [],
        // Only a screen the frozen action table names. No screen is better
        // than one that does not open.
        screen: step ? screenId : '',
        screenLabel: step ? step.label : '',
        weight: (() => {
          const counts = new Map();
          const push = (text, mult) => {
            for (const t of terms(text)) counts.set(t, (counts.get(t) || 0) + mult);
          };
          push(article.title, 4);
          push(category.title, 2);
          push(article.summary, 2);
          push(body.join(' '), 1);
          return counts;
        })(),
      });
    }
  }
  return docs;
}

export function index() {
  if (!INDEX) INDEX = build();
  return INDEX;
}

/** Only for tests that mutate the corpus; the app builds once. */
export function resetIndex() { INDEX = null; }

/**
 * The best few articles for a question, with a floor.
 *
 * Returning the "least bad" article for a question the documentation does not
 * cover is how a product assistant starts making things up with a citation
 * attached. Below `minScore` this returns NOTHING, and the caller says it
 * does not know.
 */
export function search(question, { limit = 3, minScore = 0 } = {}) {
  const wanted = terms(question);
  if (!wanted.length) return [];
  // The floor scales with how much was asked. A fixed floor either lets a
  // one-word question match anything (the "least bad article" failure) or
  // silences a specific one -- measured: at a flat 6, "what is a nasheed for"
  // returned nothing while "how do I connect tiktok" returned two good hits.
  const floor = minScore || 3 + wanted.length;
  const scored = index().map(doc => {
    let score = 0;
    for (const term of wanted) {
      const exact = doc.weight.get(term);
      if (exact) { score += exact; continue; }
      // A prefix match ("caption" for "captions") is worth something, and a
      // whole word is worth more.
      for (const [key, w] of doc.weight) {
        if (key.startsWith(term) || term.startsWith(key)) { score += w * 0.5; break; }
      }
    }
    return { doc, score };
  }).filter(hit => hit.score >= floor)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map(({ doc, score }) => ({
    id: doc.id,
    title: doc.title,
    category: doc.category,
    summary: doc.summary,
    steps: doc.steps.slice(0, 6),
    notes: doc.notes.slice(0, 3),
    screen: doc.screen,
    screenLabel: doc.screenLabel,
    score: Math.round(score * 10) / 10,
  }));
}

/** The passages, flattened for a prompt, with their titles as citations. */
export function passages(question, opts) {
  return search(question, opts).map(hit => {
    const lines = [`## ${hit.title} (${hit.category})`];
    if (hit.summary) lines.push(hit.summary);
    hit.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    hit.notes.forEach(n => lines.push(`Note: ${n}`));
    if (hit.screenLabel) lines.push(`Screen: ${hit.screenLabel}`);
    return lines.join('\n');
  });
}
