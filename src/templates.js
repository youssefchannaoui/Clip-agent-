import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, selectedTemplateId, setSelectedTemplateId, settingDefaults } from './store.js';

const builtInDir = path.join(config.root, 'src', 'templates');
const customDir = path.join(config.dataDir, 'templates');
fs.mkdirSync(customDir, { recursive: true });

const DEFAULTS = Object.freeze({
  name: 'Custom Template',
  description: 'A reusable DeenClipped video style.',
  width: 1080,
  height: 1920,
  fitMode: 'contain',
  smartFramingEnabled: true,
  smartFramingBias: 'auto',
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
  captionHighlightItalic: true,
  captionHighlightGlow: 0,
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
});

const ENUMS = {
  fitMode: ['contain', 'blur', 'crop'],
  smartFramingBias: ['auto', 'left', 'center', 'right'],
  filterPreset: ['natural', 'crisp', 'warm', 'cinematic', 'monochrome', 'custom'],
  captionMode: ['phrase', 'word', 'dynamic-stack'],
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
  captionFontSize: [24, 140], captionOutlineWidth: [0, 14], captionShadow: [0, 8], captionBackgroundOpacity: [0, 100],
  // Clamped to what clip_worker.py accepts for the highlight's glow.
  captionHighlightGlow: [0, 30],
  // 960 is half of a 1920-tall frame. The caption anchors to whichever edge it
  // is nearer, so the cap is what decides how far toward the centre it can
  // travel -- at 800 there was a band around the middle it could not reach from
  // either side, and the drag stalled there.
  captionMarginV: [20, 960], captionMarginH: [20, 700], captionMaxWords: [1, 12],
  captionStackMaxWords: [1, 6], captionStackProbability: [0, 1], captionClearPause: [0.15, 2], captionLineHeight: [0.65, 1.4],
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
  for (const key of ['captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic']) {
    output[key] = Boolean(source[key]);
  }
  // Opening title cards are intentionally disabled. Clips begin immediately with spoken captions.
  output.hookEnabled = false;
  // Upgrade old word-highlight templates to the new viral stacked-caption renderer once.
  if (input && input.captionMode === 'word' && input.captionStackMaxWords == null && input.captionHorizontal == null) {
    output.captionMode = 'dynamic-stack';
  }
  output.captionFont = cleanText(source.captionFont, DEFAULTS.captionFont, 80);
  output.captionHighlightFont = cleanText(source.captionHighlightFont, DEFAULTS.captionHighlightFont, 80);
  output.watermark = cleanText(source.watermark, DEFAULTS.watermark, 60);
  output.version = Math.max(1, Math.round(Number(source.version) || 1));
  output.updatedAt = Number(source.updatedAt) || Date.now();
  output.builtIn = Boolean(builtIn);
  output.editable = !builtIn;
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
  'captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic',
  'captionFont', 'captionHighlightFont', 'watermark',
]);

const CLIP_STYLE_FIELD_SET = new Set(CLIP_STYLE_FIELDS);
const COLOUR_FIELDS = new Set(['frameBackground', 'captionPrimary', 'captionHighlight', 'captionOutline',
  'captionBackground', 'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor']);
const BOOLEAN_FIELDS = new Set(['captionUppercase', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled', 'captionHighlightItalic']);

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
    } else if (key === 'captionFont' || key === 'captionHighlightFont') {
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
  const custom = fs.readdirSync(customDir)
    .filter(name => name.endsWith('.json'))
    .map(name => readTemplateFile(path.join(customDir, name), false))
    .filter(Boolean)
    .filter(template => viewerId && templateOwner(template) === viewerId);
  const byId = new Map();
  for (const template of [...builtIns, ...custom]) byId.set(template.id, template);
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

function writeCustom(template) {
  const file = path.join(customDir, `${safeId(template.id)}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...template, builtIn: undefined, editable: undefined }, null, 2));
}

export function createTemplate(user, input = {}) {
  const ownerId = userIdOf(user);
  if (!ownerId) throw new Error('A template needs an account.');
  // Ids are unique across every account, not just the caller's, so one
  // creator's new template can never overwrite another's file on disk.
  const takenIds = new Set(allTemplateIds());
  let id = safeId(input.id || input.name || 'custom-template');
  if (takenIds.has(id)) id = `${id}-${crypto.randomBytes(3).toString('hex')}`;
  // Names have to be unique too, not just ids. The template picker selects by
  // name, so duplicating twice produced two rows reading "X copy" and the second
  // one could never be chosen -- picking it always resolved to the first.
  const name = uniqueName(user, input.name || 'Custom template');
  const template = sanitiseTemplate({ ...DEFAULTS, ...input, id, name, version: 1, updatedAt: Date.now() }, { id, builtIn: false, userId: ownerId });
  writeCustom(template);
  return template;
}

export function updateTemplate(user, id, input = {}) {
  const existing = templateById(id, user);
  if (!existing) throw new Error('That template does not exist.');
  if (existing.builtIn) throw new Error('Built-in templates are protected. Duplicate it first, then edit your copy.');
  const template = sanitiseTemplate(
    { ...existing, ...input, id, version: (existing.version || 1) + 1, updatedAt: Date.now() },
    { id, builtIn: false, userId: templateOwner(existing) },
  );
  writeCustom(template);
  return template;
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
export function saveTemplate(user, id, input = {}, { allowFork = false } = {}) {
  const existing = templateById(id, user);
  if (!existing) throw new Error('That template does not exist.');
  if (!existing.builtIn) {
    return { template: updateTemplate(user, id, input), forked: false, from: '' };
  }
  // Forking is deliberate, not implicit. Every control on the Templates screen
  // writes through the same endpoint on a debounce, so an unguarded fork would
  // mint a fresh copy on each slider drag. Only the explicit Save asks for it;
  // anything else still gets the old refusal.
  if (!allowFork) throw new Error('Built-in templates are protected. Duplicate it first, then edit your copy.');
  const template = createTemplate(user, {
    ...existing, ...input, id: '', name: copyName(user, existing.name), builtIn: false,
  });
  setSelectedTemplate(user, template.id);
  return { template, forked: true, from: existing.name };
}

// "Modern Minimal (my copy)", then "(my copy 2)" and so on. Numbering only from
// the second, because "(my copy 1)" reads like there are others.
function copyName(user, base) {
  return uniqueName(user, `${base} (my copy)`, n => `${base} (my copy ${n})`);
}

// A name no other template of this user already has. `numbered` builds the
// fallbacks; by default it appends " 2", " 3" and so on.
function uniqueName(user, wanted, numbered = n => `${wanted} ${n}`) {
  const clean = cleanText(wanted, 'Custom template', 70);
  const taken = new Set(listTemplates(user).map(template => template.name));
  if (!taken.has(clean)) return clean;
  for (let n = 2; n < 200; n += 1) {
    const candidate = cleanText(numbered(n), 'Custom template', 70);
    if (!taken.has(candidate)) return candidate;
  }
  return cleanText(`${clean} ${Date.now()}`, 'Custom template', 70);
}

export function duplicateTemplate(user, id, name = '') {
  const source = templateById(id, user);
  if (!source) throw new Error('That template does not exist.');
  return createTemplate(user, { ...source, id: '', name: cleanText(name, `${source.name} Copy`, 70), description: source.description });
}

export function deleteTemplate(user, id) {
  const existing = templateById(id, user);
  if (!existing) return false;
  if (existing.builtIn) throw new Error('Built-in templates cannot be deleted.');
  fs.rmSync(path.join(customDir, `${safeId(id)}.json`), { force: true });
  if (selectedTemplateId(user) === id) setSelectedTemplateId(user, config.defaultTemplateId);
  return true;
}

/** Every custom template id on disk, across all accounts. */
function allTemplateIds() {
  const builtIns = fs.existsSync(builtInDir)
    ? fs.readdirSync(builtInDir).filter(name => name.endsWith('.json')).map(name => path.basename(name, '.json'))
    : [];
  const custom = fs.readdirSync(customDir).filter(name => name.endsWith('.json')).map(name => path.basename(name, '.json'));
  return [...builtIns, ...custom];
}

export function defaultTemplateDraft() {
  return sanitiseTemplate({ ...DEFAULTS, id: 'new-template', name: 'New Template' }, { id: 'new-template', builtIn: false });
}
