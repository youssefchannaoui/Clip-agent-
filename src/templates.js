import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, selectedTemplateId, setSelectedTemplateId, settingDefaults } from './store.js';
import { readUserSetting, writeUserSetting } from './tenancy.js';

const builtInDir = path.join(config.root, 'src', 'templates');
const customDir = path.join(config.dataDir, 'templates');
fs.mkdirSync(customDir, { recursive: true });

const DEFAULTS = Object.freeze({
  name: 'Custom Template',
  description: 'A reusable DeenClipped video style.',
  width: 1080,
  height: 1920,
  // 'contain' letterboxes: a 16:9 lecture in a 9:16 frame left roughly 65% of
  // every Reel as black bars, checked on a real render. It also made
  // blurStrength below a setting that does nothing -- the blurred backdrop is
  // only built when fitMode is 'blur', so a default of 28 sat there inert.
  // 'blur' fills the frame and still shows the whole speaker; 'crop' fills it
  // by cutting into the sides instead.
  fitMode: 'blur',
  smartFramingEnabled: true,
  smartFramingBias: 'auto',
  // Push the framed subject across the frame, as a percentage, to clear room
  // beside them. Positive moves them right. 0 leaves smart framing to place
  // them as it always has, which is every template that does not ask.
  framingSubjectBias: 0,
  frameBackground: '#000000',
  blurStrength: 28,
  filterPreset: 'natural',
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  sharpen: 0.45,
  vignette: 0,
  // Grain, warmth and crop zoom. The editor has always drawn these three
  // controls; until now nothing held them, so sanitiseTemplate() dropped the
  // values and the sliders did nothing.
  grain: 0,
  warm: 0,
  smartFramingZoom: 1,
  // Where the crop window sits when framing is manual, as fractions of the
  // slack (0.5/0.5 is centred -- the old hardcoded behaviour). The editor has
  // always drawn the drag-to-position control; the values were dropped here.
  cropPositionX: 0.5,
  cropPositionY: 0.5,
  // How much air detect_main_face_crop leaves around the speaker. The worker
  // has read this for as long as smart framing existed (default 0.18); the
  // editor's slider saved it and this schema threw it away.
  smartFramingPadding: 0.18,
  // Nudges every caption earlier (negative) or later. The editor's timing
  // control wrote this into the void.
  captionTimingOffsetMs: 0,
  // Tracking between caption letters, in frame pixels (ASS Spacing). Applies
  // to the Latin caption face only -- Arabic letters join, so spacing an ayah
  // out would break the script.
  captionLetterSpacing: 0,
  captionMode: 'dynamic-stack',
  captionFont: 'DejaVu Sans',
  captionFontSize: 96,
  captionPrimary: '#FFFFFF',
  captionHighlight: '#D9B478',
  // The highlighted word can differ from the rest of the caption in face, slant
  // and glow, which is what makes the stacked style read. clip_worker.py has
  // always rendered these; nothing here stored them, so sanitiseTemplate()
  // dropped every value and the worker silently used its own defaults.
  captionHighlightFont: 'DejaVu Serif',
  // The face the Arabic is set in. Amiri and Scheherazade both draw the
  // end-of-ayah ornament with the verse number inside it; a Latin face does not
  // and would leave a bare circle.
  captionArabicFont: 'Amiri',
  // Translation under the ayah, in the Quran caption mode.
  captionTranslation: true,
  captionTranslationSize: 46,
  captionHighlightItalic: true,
  captionHighlightGlow: 0,
  // Caption animation. The renderer has always popped the live word by 8% over
  // 120ms; both numbers were hardcoded, so the effect could be neither tuned
  // nor turned off. A pop of 100 is no pop at all.
  captionPopScale: 108,
  captionPopMs: 120,
  captionFadeMs: 0,
  captionOutline: '#09090A',
  captionOutlineWidth: 5,
  captionShadow: 1,
  captionBackground: '#000000',
  captionBackgroundOpacity: 0,
  captionPosition: 'middle',
  captionHorizontal: 'right',
  captionMarginV: 180,
  captionMarginH: 90,
  captionMaxWords: 4,
  captionStackMaxWords: 4,
  // How many lines a stacked-build block grows to before it clears, and how
  // far the lines vary in size. 0 variation draws every line at
  // captionFontSize; 100 is the full spread measured off the reference edits
  // (0.58 / 0.74 / 1.00 of the caption size), which is what gives the block
  // its rhythm. Only the stack-build caption mode reads either.
  captionStackLines: 4,
  captionSizeVariation: 0,
  // How much of the frame width a stacked-build block may fill before it
  // wraps. 100 is edge to edge.
  captionBlockWidth: 100,
  captionStackProbability: 0.42,
  captionClearPause: 0.42,
  captionLineHeight: 0.88,
  captionUppercase: false,
  hookEnabled: false,
  hookDuration: 2.4,
  hookFontSize: 56,
  hookColor: '#FFFFFF',
  hookBackground: '#09090A',
  hookBackgroundOpacity: 72,
  watermark: 'DEENCLIPPED',
  watermarkFontSize: 28,
  watermarkColor: '#D9B478',
  watermarkOpacity: 100,
  watermarkPosition: 'top-center',
  watermarkMarginV: 90,
  watermarkMarginH: 48,
  brandLineEnabled: false,
  brandLineColor: '#D9B478',
  brandLineHeight: 8,
  voiceEnhance: true,
  // Draw the captions behind the speaker rather than over them. The worker
  // segments the person per frame to do it; where that is unavailable the
  // captions render in front, so this is a preference, never a hard promise.
  captionBehindSubject: false,
});

const ENUMS = {
  fitMode: ['contain', 'blur', 'crop'],
  smartFramingBias: ['auto', 'left', 'center', 'right'],
  filterPreset: ['natural', 'crisp', 'warm', 'cinematic', 'monochrome', 'custom'],
  // 'quran' captions the ayah being recited, in Arabic with its translation,
  // taken from the corpus rather than from the transcript. It falls back to
  // phrase captions on any segment that is not a confident match.
  // 'stack-build' reveals a word at a time into a block that grows downward
  // and then clears whole -- captionHighlight is the colour a word waits in
  // before it is spoken, the same meaning it carries in 'fill'.
  // 'cards' is the plainest of them: a fixed number of words on one line,
  // swapped outright when the next card is due -- no highlight and no fade.
  captionMode: ['phrase', 'word', 'dynamic-stack', 'quran', 'fill', 'stack-build', 'cards'],
  captionPosition: ['top', 'middle', 'bottom'],
  captionHorizontal: ['left', 'center', 'right'],
  watermarkPosition: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
};

// Exported so the design importer can correct range inputs whose min/max were
// drawn as literals. A slider that cannot reach the schema's range is a control
// that silently truncates what the user asks for.
export const NUMBER_RANGES = {
  width: [360, 2160], height: [360, 3840], blurStrength: [0, 60],
  brightness: [-1, 1], contrast: [0.5, 2], saturation: [0, 3], gamma: [0.5, 2], sharpen: [0, 2], vignette: [0, 1],
  // grain is a percentage; warm runs cool-to-warm through neutral; zoom is a
  // crop multiplier, so 1 is the untouched framing.
  grain: [0, 100], warm: [-100, 100], smartFramingZoom: [0.75, 2.5],
  cropPositionX: [0, 1], cropPositionY: [0, 1], smartFramingPadding: [0, 0.5], captionTimingOffsetMs: [-2000, 2000],
  // Down to -20 because the stacked-build face is set very tight: matching the
  // reference at a 126px caption needs about -11px, and the old -4 floor
  // silently truncated it to a third of the ask.
  captionLetterSpacing: [-20, 40],
  // Up to 240 because ASS sizes are Win-cell sizes, not em sizes: Montserrat's
  // cell is 1.562em, so the reference's largest line -- an x-height of 65px --
  // is \fs187. At the old 140 ceiling it silently came out two thirds the size.
  captionFontSize: [24, 240], captionOutlineWidth: [0, 14], captionShadow: [0, 8], captionBackgroundOpacity: [0, 100],
  // Clamped to what clip_worker.py accepts for the highlight's glow.
  captionHighlightGlow: [0, 30],
  captionTranslationSize: [20, 90],
  // 100 = no pop. 0ms on either timing switches that animation off.
  // Below 100 starts the word small and grows it in; above, it overshoots and
  // settles. 100 is no pop either way.
  captionPopScale: [60, 140], captionPopMs: [0, 400], captionFadeMs: [0, 600],
  // 960 is half of a 1920-tall frame. The caption anchors to whichever edge it
  // is nearer, so the cap is what decides how far toward the centre it can
  // travel -- at 800 there was a band around the middle it could not reach from
  // either side, and the drag stalled there.
  captionMarginV: [20, 960], captionMarginH: [20, 700], captionMaxWords: [1, 12],
  captionStackMaxWords: [1, 6], captionStackLines: [2, 6], captionSizeVariation: [0, 100],
  captionBlockWidth: [30, 100], framingSubjectBias: [-50, 50],
  captionStackProbability: [0, 1], captionClearPause: [0.15, 2], captionLineHeight: [0.65, 1.4],
  hookDuration: [0.5, 8], hookFontSize: [24, 120], hookBackgroundOpacity: [0, 100],
  watermarkFontSize: [12, 90], watermarkOpacity: [0, 100], watermarkMarginV: [10, 500], watermarkMarginH: [10, 500],
  brandLineHeight: [2, 30],
};

function clamp(value, minimum, maximum, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function cleanText(value, fallback, max = 120) {
  const text = String(value ?? '').trim();
  return (text || fallback).slice(0, max);
}

/**
 * A font name goes straight into an ASS style row, where fields are separated
 * by commas and rows by newlines. Left alone, a name containing either could
 * shift every following field or append whole style rows of its own -- the one
 * piece of user text on the rendering path that was not sanitised.
 */
function cleanFontName(value, fallback, max = 80) {
  const text = String(value ?? '').replace(/[,\r\n{}:]/g, ' ').replace(/\s+/g, ' ').trim();
  return (text || fallback).slice(0, max);
}

function cleanColor(value, fallback) {
  const text = String(value || '').trim().toUpperCase();
  return /^#[0-9A-F]{6}$/.test(text) ? text : fallback;
}

function safeId(value = '') {
  const cleaned = String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return cleaned || `template-${crypto.randomBytes(4).toString('hex')}`;
}

export function sanitiseTemplate(input = {}, { id = '', builtIn = false, userId = '' } = {}) {
  const source = { ...DEFAULTS, ...(input || {}) };
  const output = {
    id: safeId(id || source.id || source.name),
    name: cleanText(source.name, DEFAULTS.name, 70),
    description: cleanText(source.description, DEFAULTS.description, 240),
  };

  for (const [key, allowed] of Object.entries(ENUMS)) {
    output[key] = allowed.includes(source[key]) ? source[key] : DEFAULTS[key];
  }
  for (const [key, [minimum, maximum]] of Object.entries(NUMBER_RANGES)) {
    output[key] = clamp(source[key], minimum, maximum, DEFAULTS[key]);
  }
  for (const key of ['frameBackground', 'captionPrimary', 'captionHighlight', 'captionOutline', 'captionBackground', 'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor']) {
    output[key] = cleanColor(source[key], DEFAULTS[key]);
  }
  for (const key of ['captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic', 'captionTranslation', 'captionBehindSubject']) {
    output[key] = Boolean(source[key]);
  }
  // Opening title cards are intentionally disabled. Clips begin immediately with spoken captions.
  output.hookEnabled = false;
  // Upgrade old word-highlight templates to the new viral stacked-caption renderer once.
  if (input && input.captionMode === 'word' && input.captionStackMaxWords == null && input.captionHorizontal == null) {
    output.captionMode = 'dynamic-stack';
  }
  output.captionFont = cleanFontName(source.captionFont, DEFAULTS.captionFont, 80);
  output.captionHighlightFont = cleanFontName(source.captionHighlightFont, DEFAULTS.captionHighlightFont, 80);
  output.captionArabicFont = cleanFontName(source.captionArabicFont, DEFAULTS.captionArabicFont, 80);
  // An empty watermark is a real choice, not a missing field: TikTok rejects
  // videos carrying third-party watermarks, so "none" must be saveable. Only
  // an absent field falls back to the default.
  output.watermark = String(source.watermark ?? '').trim() === '' && 'watermark' in (input || {})
    ? ''
    : cleanText(source.watermark, DEFAULTS.watermark, 60);
  output.version = Math.max(1, Math.round(Number(source.version) || 1));
  output.updatedAt = Number(source.updatedAt) || Date.now();
  output.builtIn = Boolean(builtIn);
  output.editable = !builtIn;
  // Which plan a template belongs to. Read from the shipped file and only for
  // built-ins, so it is a property of the catalogue rather than of the style:
  // a custom template or an account's patch cannot declare itself free.
  output.pro = builtIn ? Boolean(source.pro) : false;
  // Built-in templates are shared by everyone; custom ones belong to one account.
  output.userId = builtIn ? null : (userId || source.userId || null);
  return output;
}

/**
 * The fields one clip may override on top of its template.
 *
 * Identity (`id`, `name`, `description`) and frame geometry (`width`, `height`)
 * are deliberately absent: invariant 3 in CLAUDE.md says applying a style must
 * never write identity, and changing the output size of a single clip would
 * desync it from every sibling in the same lecture.
 */
export const CLIP_STYLE_FIELDS = Object.freeze([
  ...Object.keys(ENUMS),
  ...Object.keys(NUMBER_RANGES).filter(key => key !== 'width' && key !== 'height'),
  'frameBackground', 'captionPrimary', 'captionHighlight', 'captionOutline', 'captionBackground',
  'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor',
  'captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic', 'captionTranslation',
  'captionBehindSubject',
  'captionFont', 'captionHighlightFont', 'captionArabicFont', 'watermark',
]);

/**
 * Framing belongs to the clip, never to the shared look.
 *
 * Two clips cut from one lecture point at different moments, so the speaker is
 * in a different part of the frame in each. Copying one clip's crop onto its
 * siblings re-centres them all on wherever *this* clip's speaker happened to be
 * and decapitates the rest -- which is why "Save to all clips" must carry the
 * look and leave the framing alone.
 *
 * cropPositionX/Y were already kept out of CLIP_STYLE_FIELDS for this reason;
 * these are the rest of the Framing tab, which the apply-style route was
 * overwriting because it replaced a sibling's overrides wholesale.
 */
export const FRAMING_FIELDS = Object.freeze([
  'cropPositionX', 'cropPositionY', 'fitMode', 'smartFramingZoom', 'smartFramingEnabled', 'smartFramingPadding',
]);

const CLIP_STYLE_FIELD_SET = new Set(CLIP_STYLE_FIELDS);
const COLOUR_FIELDS = new Set(['frameBackground', 'captionPrimary', 'captionHighlight', 'captionOutline',
  'captionBackground', 'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor']);
const BOOLEAN_FIELDS = new Set(['captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic', 'captionTranslation', 'captionBehindSubject']);

/**
 * Validate a partial style patch for a single clip.
 *
 * Unlike sanitiseTemplate this does NOT fill in defaults — a key the caller did
 * not send stays absent, so the clip keeps inheriting it from the template.
 * Unknown and malformed keys are dropped rather than throwing, so a stale client
 * cannot wedge a save.
 */
export function sanitiseClipStyle(patch = {}) {
  const output = {};
  if (!patch || typeof patch !== 'object') return output;
  for (const [key, value] of Object.entries(patch)) {
    if (!CLIP_STYLE_FIELD_SET.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (ENUMS[key]) {
      if (ENUMS[key].includes(value)) output[key] = value;
    } else if (NUMBER_RANGES[key]) {
      const [minimum, maximum] = NUMBER_RANGES[key];
      const number = Number(value);
      if (Number.isFinite(number)) output[key] = Math.min(maximum, Math.max(minimum, number));
    } else if (COLOUR_FIELDS.has(key)) {
      const text = String(value).trim().toUpperCase();
      if (/^#[0-9A-F]{6}$/.test(text)) output[key] = text;
    } else if (BOOLEAN_FIELDS.has(key)) {
      output[key] = Boolean(value);
    } else if (key === 'captionFont' || key === 'captionHighlightFont' || key === 'captionArabicFont') {
      output[key] = cleanText(value, DEFAULTS[key], 80);
    } else if (key === 'watermark') {
      output[key] = cleanText(value, DEFAULTS.watermark, 60);
    }
  }
  return output;
}

/**
 * The style a single clip actually renders with: its template, with that clip's
 * own overrides laid on top. Identity and version are taken from the template so
 * a clip override can never rename a style or fake its version.
 */
export function templateForClip(template, overrides) {
  if (!template) return template;
  const patch = sanitiseClipStyle(overrides);
  if (!Object.keys(patch).length) return template;
  const merged = sanitiseTemplate(
    { ...template, ...patch },
    { id: template.id, builtIn: Boolean(template.builtIn), userId: template.userId || '' },
  );
  merged.name = template.name;
  merged.description = template.description;
  merged.pro = Boolean(template.pro);
  merged.version = template.version || 1;
  merged.updatedAt = template.updatedAt || Date.now();
  return merged;
}

function readTemplateFile(file, builtIn) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return sanitiseTemplate(raw, { id: raw.id || path.basename(file, '.json'), builtIn, userId: raw.userId || '' });
  } catch {
    return null;
  }
}

/** The account that owns a custom template, or the operator for pre-migration files. */
function templateOwner(template) {
  return template?.userId || legacyTemplateOwnerId();
}

/**
 * Custom templates saved before accounts existed have no owner recorded. They
 * were made by the person running the app privately, so they belong to the
 * operator — the same rule the state migration uses.
 */
function legacyTemplateOwnerId() {
  const users = Array.isArray(state.authUsers) ? state.authUsers : [];
  return users.find(user => user?.role === 'owner')?.id || users[0]?.id || 'user_admin';
}

function userIdOf(user) {
  if (!user) return '';
  return typeof user === 'string' ? user : String(user.id || '');
}

/**
 * Templates visible to one account: every built-in, plus that account's own
 * custom templates. Another creator's custom template is not listed and cannot
 * be resolved by id, so it can never be selected or applied by mistake.
 */
export function listTemplates(user) {
  const viewerId = userIdOf(user);
  const builtIns = fs.existsSync(builtInDir)
    ? fs.readdirSync(builtInDir).filter(name => name.endsWith('.json')).map(name => readTemplateFile(path.join(builtInDir, name), true)).filter(Boolean)
    : [];
  // Two templates, one per kind of content: Quran Recitation for recitations,
  // Simple Bold for lectures. The old catalogue (four more built-ins plus
  // every fork a customer had ever saved) put eight near-identical rows in the
  // picker; the product decision is one template per content type, and future
  // templates are added per type rather than as a flat list. Existing custom
  // forks stay on disk so nothing a clip references is destroyed, but they are
  // no longer listed or selectable.
  const custom = [];
  const byId = new Map();
  for (const template of [...builtIns, ...custom]) byId.set(template.id, withAccountEdits(template, user));
  return [...byId.values()].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name));
}

export function templateById(id, user) {
  return listTemplates(user).find(template => template.id === id) || null;
}

export function selectedTemplate(user) {
  const templates = listTemplates(user);
  const selected = templates.find(template => template.id === selectedTemplateId(user));
  return selected || templates.find(template => template.id === config.defaultTemplateId) || templates[0] || null;
}

export function setSelectedTemplate(user, id) {
  const template = templateById(id, user);
  if (!template) throw new Error('That template is not available.');
  setSelectedTemplateId(user, template.id);
  return template;
}

export function createTemplate() {
  // One template per content type. Minting copies is what turned two templates
  // into eight near-identical rows; edits land on the built-in itself, scoped
  // to the account, so there is nothing a copy would be for.
  throw new Error('One template per content type — edit the template directly; copies are no longer created.');
}

// Save always means save.
//
// Editing a built-in and pressing Save used to fail with "Built-in templates are
// protected. Duplicate it first, then edit your copy." -- an instruction to go
// and do by hand the one thing the button was for. The built-ins do still have
// to stay pristine, since every account shares them, so the edit is forked onto
// a copy of the user's own and they are switched to it.
//
// Returns { template, forked, from } so the caller can say what happened.
// Silently editing something other than what the user had open would be worse
// than the error was.
/**
 * Per-account edits to a built-in, keyed by the built-in's id.
 *
 * The catalogue is one template per kind of content, so editing one must not
 * mint a copy -- forking is what turned two templates into eight. An account's
 * changes are stored as a patch over the shipped file and merged at read time,
 * so ids stay stable ('quran-recitation', 'simple-bold'), every clip keeps a
 * resolvable templateId, and Save always means save.
 */
function builtInOverrides(user) {
  const id = userIdOf(user);
  if (!id) return {};
  const stored = readUserSetting(state, id, 'templateOverrides');
  return stored && typeof stored === 'object' ? stored : {};
}

function withAccountEdits(template, user) {
  if (!template?.builtIn) return template;
  const patch = builtInOverrides(user)[template.id];
  if (!patch || typeof patch !== 'object') return { ...template, editable: true };
  const merged = sanitiseTemplate({ ...template, ...patch }, { id: template.id, builtIn: true, userId: '' });
  merged.editable = true;
  // Taken from the shipped template, never from the patch: an account's own
  // edits decide how a template looks, not which plan it is on.
  merged.pro = Boolean(template.pro);
  // The account's own save counter, plus any shipped bump that landed after
  // the patch was written. Without the second term a deploy that changed the
  // shipped file was invisible: the look changed under the account's clips
  // and "outdated" never showed, because the patch's counter masked it.
  const recordedShipped = Number.isFinite(Number(patch.shippedVersion)) && patch.shippedVersion !== undefined && patch.shippedVersion !== null
    ? Number(patch.shippedVersion)
    : (template.version || 1);
  const shippedDrift = Math.max(0, (template.version || 1) - recordedShipped);
  merged.version = (Number(patch.version) || template.version || 1) + shippedDrift;
  if (Number(patch.updatedAt)) merged.updatedAt = Number(patch.updatedAt);
  return merged;
}

export function saveTemplate(user, id, input = {}) {
  const existing = templateById(id, user);
  if (!existing) throw new Error('That template does not exist.');
  // Every listed template is a built-in; an account edits it in place and the
  // change is scoped to that account. Identity never moves.
  const userId = userIdOf(user);
  if (!userId) throw new Error('Saving a template needs an account.');
  const cleaned = sanitiseTemplate({ ...existing, ...input }, { id, builtIn: true, userId: '' });
  const patch = {};
  const shipped = readTemplateFile(path.join(builtInDir, `${id}.json`), true) || existing;
  for (const key of Object.keys(cleaned)) {
    if (['id', 'builtIn', 'editable', 'userId', 'version', 'updatedAt', 'pro'].includes(key)) continue;
    if (JSON.stringify(cleaned[key]) !== JSON.stringify(shipped[key])) patch[key] = cleaned[key];
  }
  patch.version = (Number(existing.version) || 1) + 1;
  patch.shippedVersion = Number(shipped.version) || 1;
  patch.updatedAt = Date.now();
  const all = { ...builtInOverrides(user) };
  all[id] = patch;
  writeUserSetting(state, userId, 'templateOverrides', all);
  save();
  return { template: templateById(id, user), forked: false, from: '' };
}

export function duplicateTemplate() {
  throw new Error('One template per content type — edit the template directly; copies are no longer created.');
}

export function deleteTemplate(user, id) {
  const existing = templateById(id, user);
  if (!existing) return false;
  throw new Error('Built-in templates cannot be deleted.');
}

export function defaultTemplateDraft() {
  return sanitiseTemplate({ ...DEFAULTS, id: 'new-template', name: 'New Template' }, { id: 'new-template', builtIn: false });
}
