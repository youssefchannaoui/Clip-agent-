import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// AI Director answers entirely from the growth pack the worker already
// derived from the transcript, so its behaviour is testable without a
// browser, a server or a model. These tests execute the real answer engine
// lifted out of activity-fix.js rather than grepping it for strings.

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const between = (from, to) => {
  const start = ui.indexOf(from);
  const end = ui.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `could not slice ${from} .. ${to}`);
  return ui.slice(start, end);
};

const source =
  'const shortText=(v,n)=>String(v||"").slice(0,n);\nconst data=()=>DATA;\n' +
  between('const LAB_TOPICS=[', 'function labDimensionRows') +
  between('const DIRECTOR_CHIPS=[', 'function directorAsk(') +
  '; return { directorAnswer, directorFocus, directorChat };';

const load = clips => new Function('DATA', source)({ clips });
const ask = (clips, question) => load(clips).directorAnswer(question);
const texts = parts => parts.filter(p => p.type === 'text').map(p => p.value).join(' ');
const labels = parts => parts.filter(p => p.type === 'copy').map(p => p.label);

const CLIP = {
  id: 'c1', title: 'How As-Salaam heals the heart', score: 88, status: 'ready',
  hashtags: '#iman #peace', scoreReasons: ['Strong standalone opening'],
  growthPack: {
    primaryTitle: 'How As-Salaam Heals The Heart',
    alternateTitles: ['Finding Peace In His Name'],
    searchTerms: ['as-salaam', 'inner peace'],
    platforms: {
      youtube: { title: 'How As-Salaam Heals The Heart', description: 'A reminder on divine peace.' },
      tiktok: { caption: 'Peace begins with Him.' },
      instagram: { caption: 'A reminder.' },
    },
    directorBrief: {
      forecast: 'strong',
      hookPreview: 'Allah is As-Salaam, the source of peace.',
      payoffPreview: 'Return to Him and find rest.',
      bestPlatforms: ['youtube', 'instagram'],
      platformFit: { youtube: 91, tiktok: 70, instagram: 85, facebook: 78 },
      why: ['Strong opening', 'Clear viewer value'],
    },
  },
};
const clip = (over = {}) => ({ ...CLIP, ...over });

test('an empty library is stated plainly instead of guessed around', () => {
  assert.match(texts(ask([], 'what should I post next')), /no clips yet/i);
});

test('"what should I post next" returns a ranked queue of real clips', () => {
  const parts = ask([clip(), clip({ id: 'c2', title: 'Gratitude', score: 80 })], 'what should I post next?');
  const list = parts.find(p => p.type === 'clips');
  assert.ok(list, 'should return a clip list');
  assert.deepEqual(list.ids, ['c1', 'c2'], 'highest score first');
});

test('posted clips are excluded from the queue', () => {
  const parts = ask([clip({ status: 'posted' }), clip({ id: 'c2', title: 'Gratitude', score: 80 })], 'what should I post next?');
  assert.deepEqual(parts.find(p => p.type === 'clips').ids, ['c2']);
});

test('captions come back per platform, straight from the growth pack', () => {
  const parts = ask([clip()], 'write captions for this clip');
  assert.deepEqual(labels(parts), ['YouTube title', 'YouTube description', 'TikTok caption', 'Instagram caption']);
  assert.equal(parts.find(p => p.label === 'TikTok caption').value, 'Peace begins with Him.');
});

test('titles offer the primary plus every alternate', () => {
  const parts = ask([clip()], 'give me another title');
  assert.deepEqual(labels(parts), ['Suggested title', 'Alternative 1']);
  assert.equal(parts[1].value, 'How As-Salaam Heals The Heart');
});

test('platform advice names the best fit and shows every score', () => {
  const answer = texts(ask([clip()], 'which platform fits best?'));
  assert.match(answer, /Best fit: YouTube Shorts and Instagram Reels/);
  assert.match(answer, /YouTube Shorts 91/);
  assert.match(answer, /TikTok 70/);
});

test('the hook answer quotes the transcript, not a paraphrase', () => {
  const answer = texts(ask([clip()], 'what is the hook'));
  assert.match(answer, /Allah is As-Salaam, the source of peace\./);
  assert.match(answer, /Return to Him and find rest\./);
});

test('score explanations reuse the computed reasons', () => {
  const answer = texts(ask([clip()], 'why is this good'));
  assert.match(answer, /scores 88 out of 100/);
  assert.match(answer, /Retention forecast: strong/);
  assert.match(answer, /Clear viewer value/);
});

test('a clip with no growth pack is declined, never improvised', () => {
  // The critical guarantee: inventing a title or quotation for a lecture is
  // the worst failure this product can have.
  for (const question of ['write captions', 'give me a title', 'hashtags', 'what is the hook']) {
    const answer = texts(ask([clip({ growthPack: null, hashtags: '' })], question));
    assert.match(answer, /processed before DeenClipped started generating post copy/, `"${question}" must decline`);
  }
});

test('an out-of-scope question is refused with a list of what it can do', () => {
  const answer = texts(ask([clip()], 'what is the weather in Sydney'));
  assert.match(answer, /I can only answer from the clips you've generated/);
  assert.match(answer, /captions, titles, hashtags/);
});

test('topic gaps are computed from the library, not hardcoded', () => {
  const answer = texts(ask([clip({ transcript: 'salah and prayer in the masjid' })], 'what topics am I missing?'));
  assert.match(answer, /Prayer/);
  assert.doesNotMatch(answer, /Nothing in your library covers[^.]*Prayer/);
});
