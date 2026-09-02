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
  '#0e0e11': '#EFE7D8', '#101013': '#E8DECB', '#121214': '#FFFDF7', '#17171a': '#F6F0E2',
  '#1e1e22': '#E4DAC5', '#26262a': '#D5C8AC', '#34343a': '#C2B291', '#6e6e76': '#8A7F6A',
  '#8b8b93': '#635B4B', '#bcbcc3': '#332D24', '#e9e9ed': '#221D16', '#f2f2f4': '#181510',
  '#09090a': '#EBE2D0', '#0b0b0d': '#E2D8C3', '#1a1a1e': '#F8F3E7', '#a2a2aa': '#544C3D',
  '#75717b': '#726855', '#19191c': '#EFE8DA', '#37373d': '#CBBC9C', '#f8f8f9': '#181510',
  '#5e5e66': '#7E7462',
  // Gold darkens rather than disappears: the brand colour at a luminance that
  // can be read on paper.
  '#d9b478': '#A2762C', '#f0d6a6': '#7E5B18', '#e6b770': '#8C6118',
  // The "+" in an empty posting slot. A faithful inversion keeps it as faint
  // on paper as it is on black, but it is an AFFORDANCE -- it says the square
  // can be pressed — and paper has less to hide behind than a dark ground.
  '#33333c': '#A2957C', '#33333a': '#A2957C',
  '#ffffff': '#1D1A15', '#fff': '#1D1A15', '#000000': '#3A2C14', '#000': '#3A2C14',
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
  // Inverted, then pulled a little away from the extremes: pure inversion puts
  // body text at a grey that is legible on black and washed out on paper.
  const lit = Math.max(0.06, Math.min(0.95, (1 - l) * 0.94));
  // Warm, and more so the lighter it gets — paper is not neutral grey.
  const sat = Math.max(0.04, Math.min(0.30, 0.06 + 0.26 * lit));
  return hslToHex(38 / 360, sat, lit);
}
