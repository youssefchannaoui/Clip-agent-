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
  smartFramingPadding: 0.18,
  smartFramingZoom: 1,
  smartFramingSmoothing: 0.68,
  frameBackground: '#000000',
  blurStrength: 28,
  filterPreset: 'natural',
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  sharpen: 0.45,
  vignette: 0,
  captionMode: 'dynamic-stack',
  captionFont: 'DejaVu Sans',
  captionHighlightFont: 'DejaVu Serif',
  captionArabicFont: 'Amiri',
  captionHighlightItalic: true,
  captionHighlightGlow: 0,
  captionFontSize: 96,
  captionFontWeight: 800,
  captionLetterSpacing: 0,
  captionPrimary: '#FFFFFF',
  captionHighlight: '#D9B478',
  captionOutline: '#09090A',
  captionOutlineWidth: 5,
  captionShadow: 1,
  captionBackground: '#000000',
  captionBackgroundOpacity: 0,
  captionPosition: 'middle',
  captionHorizontal: 'right',
  captionPositionX: 78,
  captionPositionY: 58,
  captionMarginV: 180,
  captionMarginH: 90,
  captionMaxWords: 4,
  captionStackMaxWords: 4,
  captionStackProbability: 0.42,
  captionClearPause: 0.42,
  captionHoldSeconds: 0.04,
  captionTimingOffsetMs: 0,
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

const NUMBER_RANGES = {
  width: [360, 2160], height: [360, 3840], blurStrength: [0, 60],
  smartFramingPadding: [0.05, 0.45], smartFramingZoom: [0.75, 1.35], smartFramingSmoothing: [0, 0.95],
  brightness: [-1, 1], contrast: [0.5, 2], saturation: [0, 3], gamma: [0.5, 2], sharpen: [0, 2], vignette: [0, 1],
  captionFontSize: [24, 180], captionFontWeight: [400, 900], captionLetterSpacing: [-4, 12],
  captionOutlineWidth: [0, 14], captionShadow: [0, 8], captionBackgroundOpacity: [0, 100], captionHighlightGlow: [0, 30],
  captionMarginV: [20, 800], captionMarginH: [20, 700], captionMaxWords: [1, 12],
  captionPositionX: [0, 100], captionPositionY: [0, 100], captionTimingOffsetMs: [-1500, 1500], captionHoldSeconds: [0, 0.2],
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
  if (input?.captionPositionX == null) output.captionPositionX = ({ left: 22, center: 50, right: 78 })[output.captionHorizontal] ?? 50;
  if (input?.captionPositionY == null) output.captionPositionY = ({ top: 24, middle: 58, bottom: 76 })[output.captionPosition] ?? 58;
  for (const key of ['frameBackground', 'captionPrimary', 'captionHighlight', 'captionOutline', 'captionBackground', 'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor']) {
    output[key] = cleanColor(source[key], DEFAULTS[key]);
  }
  for (const key of ['captionUppercase', 'captionHighlightItalic', 'brandLineEnabled', 'voiceEnhance', 'smartFramingEnabled']) {
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
  output.captionArabicFont = cleanText(source.captionArabicFont, DEFAULTS.captionArabicFont, 80);
  output.watermark = cleanText(source.watermark, DEFAULTS.watermark, 60);
  output.version = Math.max(1, Math.round(Number(source.version) || 1));
  output.updatedAt = Number(source.updatedAt) || Date.now();
  output.builtIn = Boolean(builtIn);
  output.editable = !builtIn;
  // Built-in templates are shared by everyone; custom ones belong to one account.
  output.userId = builtIn ? null : (userId || source.userId || null);
  return output;
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
  const template = sanitiseTemplate({ ...DEFAULTS, ...input, id, version: 1, updatedAt: Date.now() }, { id, builtIn: false, userId: ownerId });
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
