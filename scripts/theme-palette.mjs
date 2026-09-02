/**
 * One definition of "what does this colour become in daylight".
 *
 * Shared by the two generators so the sheet built from the design export and
 * the tokens used by inline styles cannot drift apart — a mid grey that became
 * two different tans would show as a seam down the middle of the screen.
 */

/** The twelve the palette was designed around, taken from the phone's paper
 *  theme so the two surfaces are one product in daylight. These win over the
 *  algorithm below; everything else is derived. */
export const NAMED = new Map(Object.entries({
  // GROUNDS. The page is a light neutral and a CARD IS WHITE, so a box reads
  // as a box the way it does at night (where the page is #09090A and a card
  // #17171A). The first cut of this theme made both cream and the boxes
  // vanished into the page -- Youssef, 3 Sept 2026: "scrap the cream make it
  // white ... show boxes more like night shows."
  '#09090a': '#ECECEE', '#0b0b0d': '#E7E7EA', '#0e0e11': '#ECECEE', '#101013': '#E7E7EA',
  '#121214': '#FFFFFF', '#17171a': '#FFFFFF', '#1a1a1e': '#F7F7F9', '#19191c': '#F7F7F9',
  // LINES. Strong enough to draw the box, quiet enough not to become a grid.
  '#1e1e22': '#E2E2E6', '#26262a': '#D4D4DA', '#34343a': '#BCBCC4', '#37373d': '#B7B7C0',
  // INK, near-black rather than brown.
  '#6e6e76': '#86868F', '#8b8b93': '#62626B', '#a2a2aa': '#55555E', '#75717b': '#75757E',
  '#5e5e66': '#8A8A93', '#bcbcc3': '#33333A', '#e9e9ed': '#1D1D22', '#f2f2f4': '#141418',
  '#f8f8f9': '#141418',
  // Gold darkens rather than disappears: the brand colour at a luminance that
  // can be read on paper.
  '#d9b478': '#A2762C', '#f0d6a6': '#7E5B18', '#e6b770': '#8C6118',
  // The "+" in an empty posting slot. A faithful inversion keeps it as faint
  // on paper as it is on black, but it is an AFFORDANCE -- it says the square
  // can be pressed — and paper has less to hide behind than a dark ground.
  '#33333c': '#A6A6B0', '#33333a': '#A6A6B0',
  '#ffffff': '#17171A', '#fff': '#17171A', '#000000': '#2B2B31', '#000': '#2B2B31',
  // The status colours keep their MEANING and lose their glow. Green still
  // means posted and red still means failed, but #7FD1A6 on paper is a pastel
  // nobody reads as a number — the phone's paper theme darkens them for the
  // same reason (--dcm-ok #2E7955, --dcm-bad #A64738).
  '#7fd1a6': '#2E7955', '#5bbd8a': '#26654699'.slice(0, 7), '#ff5566': '#A64738',
  '#ff0033': '#A11226', '#e5484d': '#A64738',
}));

const expand = (hex) => {
  const h = hex.replace('#', '');
  return h.length === 3 ? h.split('').map(c => c + c).join('') : h;
};

/** Hue, saturation and lightness, 0..1. */
export function toHsl(hex) {
  const h = expand(hex);
  const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let hue;
  if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) hue = ((b - r) / d + 2) / 6;
  else hue = ((r - g) / d + 4) / 6;
  return { h: hue, s, l };
}

const hex2 = (n) => Math.round(Math.max(0, Math.min(255, n * 255))).toString(16).padStart(2, '0');

function hslToHex(h, s, l) {
  if (!s) { const v = hex2(l); return `#${v}${v}${v}`.toUpperCase(); }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    let x = t; if (x < 0) x += 1; if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return `#${hex2(channel(h + 1 / 3))}${hex2(channel(h))}${hex2(channel(h - 1 / 3))}`.toUpperCase();
}

/** Is this a neutral — a grey the theme owns — rather than a brand or status colour? */
/** Warm — the gold and cream family, hue roughly 18° to 62°. */
const isWarm = ({ h, s }) => s >= 0.18 && h > 0.05 && h < 0.17;

export function isNeutral(hex) {
  const { h, s, l } = toHsl(hex);
  // A pale gold is not a neutral by saturation, but it exists only as light on
  // black: #C9A87A read as a smear on paper. Warm tones darken from a lower
  // threshold than everything else, which is what catches the DeenAI kickers
  // and the token chips without touching a green or a red.
  if (isWarm({ h, s }) && l > 0.55) return true;
  // A grey the theme owns, OR any very LIGHT colour. The second half matters
  // more than it looks: a pale warm cream like #E7DCC8 is saturated enough to
  // read as "a colour", but it only exists as text on a dark ground — left
  // alone it became cream on paper, which is what kept the nasheed banner and
  // the token chip unreadable after everything else had lit.
  return s < 0.18 || l > 0.68;
}

/**
 * The daylight counterpart of a dark colour, or null to leave it alone.
 *
 * Named colours win. Anything else that is NEUTRAL has its lightness inverted
 * and is warmed towards the paper's hue, so the long tail of near-identical
 * greys in the export moves with the twelve instead of staying as dark
 * islands — the topbar's second gradient stop was exactly such an island, and
 * it kept the whole header black on a lit page.
 *
 * Saturated colours are returned null: red still means failed and green still
 * means posted, whatever the ground is.
 */
export function daylight(hex) {
  const key = String(hex || '').toLowerCase();
  if (NAMED.has(key)) return NAMED.get(key);
  const { h, s, l } = toHsl(key);
  if (!isNeutral(key)) return null;
  // A light colour that carries real hue — the pale golds — keeps its hue and
  // darkens, so it stays recognisably the brand rather than turning grey.
  if (s >= 0.18) {
    const lit = Math.max(0.16, Math.min(0.42, 1 - l));
    return hslToHex(h, Math.min(0.75, s * 1.15), lit);
  }
  // THE GROUNDS DO NOT INVERT, THEY REORDER. At night a card is LIGHTER than
  // the page (#17171A on #09090A); in daylight it must still be lighter
  // (white on a grey page). A plain inversion reverses that order among the
  // near-blacks, and it did: the month cell is #151517, which inverted to a
  // grey DARKER than the page it sits on, so every cell read as a hole rather
  // than a card. Anything below .10 lightness is a ground and is mapped, in
  // order, onto the band just above the page's own .93.
  if (l < 0.10) return hslToHex(0, 0, 0.925 + (l / 0.10) * 0.075);
  // Everything above that is ink, a line or a chip -- there the inversion is
  // right, because those ARE lighter than their ground at night and must be
  // darker than it on white. Pulled a little away from the extremes: pure
  // inversion puts body text at a grey that is washed out on paper.
  // 0.88 rather than a straight inversion. At 0.97 a night "faint marker"
  // (#4A4A52) came back at .68 lightness -- legible on black, and on white a
  // grey nobody reads. Measured across ten screens: 4 elements too pale
  // before, 0 after.
  const lit = Math.max(0.06, Math.min(0.97, (1 - l) * 0.88));
  // Barely warm. The first version of this theme pushed saturation to .30 at
  // the light end, which is what made every ground read as cream; the answer
  // to "white, gold and black" is to let the GOLD carry the warmth and leave
  // the greys alone.
  const sat = Math.max(0, Math.min(0.035, 0.01 + 0.03 * lit));
  return hslToHex(38 / 360, sat, lit);
}
