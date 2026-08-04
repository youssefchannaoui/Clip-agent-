/**
 * Mapping Faster-Whisper word timings onto a single clip.
 *
 * The worker transcribes the whole lecture and stores word-level timings in
 * absolute source time. A clip is a slice of that lecture, so its captions
 * need those same words shifted into clip-relative time.
 *
 * This exists as its own module so the mapping can be tested directly. It was
 * the cause of a real bug: the endpoint serving this did not exist, the editor
 * got a 404, and fell back to spreading words evenly across the clip at a
 * fixed cadence — so captions appeared during silence and never matched
 * speech.
 */

/**
 * @param {Array} segments transcript segments, each with a `words` array of
 *   `{start, end, word}` in absolute source seconds
 * @param {number} clipStart clip start in absolute source seconds
 * @param {number} clipEnd clip end in absolute source seconds
 * @returns {Array} words in clip-relative seconds, ordered by start time
 */
export function wordsForClip(segments, clipStart, clipEnd) {
  const start = Number(clipStart) || 0;
  const end = Number(clipEnd) || 0;
  const duration = Math.max(0, end - start);
  if (!Array.isArray(segments) || duration <= 0) return [];

  const words = [];
  for (const segment of segments) {
    for (const word of segment?.words || []) {
      const wordStart = Number(word?.start);
      const wordEnd = Number(word?.end);
      const text = String(word?.word ?? '').trim();
      if (!text) continue;
      if (!Number.isFinite(wordStart) || !Number.isFinite(wordEnd)) continue;
      if (wordEnd <= wordStart) continue;

      // Skip words that fall entirely outside this clip. Words that straddle
      // an edge are kept and trimmed, so a clip never opens or closes on a
      // half-missing word.
      if (wordEnd <= start || wordStart >= end) continue;

      const relStart = Math.max(0, wordStart - start);
      const relEnd = Math.min(duration, wordEnd - start);
      if (relEnd <= relStart) continue;

      words.push({ start: relStart, end: relEnd, word: text });
    }
  }

  words.sort((a, b) => a.start - b.start);
  return words;
}

/**
 * Gaps between words are silence. The editor uses these to hide captions
 * when nobody is speaking, rather than leaving the last words on screen.
 *
 * @param {Array} words clip-relative words from `wordsForClip`
 * @param {number} duration clip duration in seconds
 * @param {number} minGap shortest gap worth treating as real silence
 * @returns {Array} `{start, end}` spans of silence in clip-relative seconds
 */
export function silenceSpans(words, duration, minGap = 0.35) {
  const total = Math.max(0, Number(duration) || 0);
  if (!Array.isArray(words) || !words.length) {
    return total > 0 ? [{ start: 0, end: total }] : [];
  }

  const spans = [];
  let cursor = 0;
  for (const word of words) {
    if (word.start - cursor >= minGap) spans.push({ start: cursor, end: word.start });
    cursor = Math.max(cursor, word.end);
  }
  if (total - cursor >= minGap) spans.push({ start: cursor, end: total });
  return spans;
}
