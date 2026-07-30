import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save } from './store.js';

const builtInDir = path.join(config.root, 'src', 'templates');
const customDir = path.join(config.dataDir, 'templates');
fs.mkdirSync(customDir, { recursive: true });

const DEFAULTS = Object.freeze({
  name: 'Custom Template',
  description: 'A reusable DeenClipped video style.',
  width: 1080,
  height: 1920,
  fitMode: 'blur',
  blurStrength: 28,
  filterPreset: 'natural',
  brightness: 0,
  contrast: 1,
  saturation: 1,
  gamma: 1,
  sharpen: 0.45,
  vignette: 0,
  captionMode: 'word',
  captionFont: 'DejaVu Sans',
  captionFontSize: 62,
  captionPrimary: '#FFFFFF',
  captionHighlight: '#D9B478',
  captionOutline: '#09090A',
  captionOutlineWidth: 5,
  captionShadow: 1,
  captionBackground: '#000000',
  captionBackgroundOpacity: 0,
  captionPosition: 'bottom',
  captionMarginV: 230,
  captionMaxWords: 6,
  captionUppercase: false,
  hookEnabled: true,
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
  fitMode: ['blur', 'crop'],
  filterPreset: ['natural', 'crisp', 'warm', 'cinematic', 'monochrome', 'custom'],
  captionMode: ['phrase', 'word'],
  captionPosition: ['top', 'middle', 'bottom'],
  watermarkPosition: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
};

const NUMBER_RANGES = {
  width: [360, 2160], height: [640, 3840], blurStrength: [0, 60],
  brightness: [-1, 1], contrast: [0.5, 2], saturation: [0, 3], gamma: [0.5, 2], sharpen: [0, 2], vignette: [0, 1],
  captionFontSize: [24, 140], captionOutlineWidth: [0, 14], captionShadow: [0, 8], captionBackgroundOpacity: [0, 100],
  captionMarginV: [20, 800], captionMaxWords: [2, 12], hookDuration: [0.5, 8], hookFontSize: [24, 120], hookBackgroundOpacity: [0, 100],
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

export function sanitiseTemplate(input = {}, { id = '', builtIn = false } = {}) {
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
  for (const key of ['captionPrimary', 'captionHighlight', 'captionOutline', 'captionBackground', 'hookColor', 'hookBackground', 'watermarkColor', 'brandLineColor']) {
    output[key] = cleanColor(source[key], DEFAULTS[key]);
  }
  for (const key of ['captionUppercase', 'hookEnabled', 'brandLineEnabled', 'voiceEnhance']) {
    output[key] = Boolean(source[key]);
  }
  output.captionFont = cleanText(source.captionFont, DEFAULTS.captionFont, 80);
  output.watermark = cleanText(source.watermark, DEFAULTS.watermark, 60);
  output.version = Math.max(1, Math.round(Number(source.version) || 1));
  output.updatedAt = Number(source.updatedAt) || Date.now();
  output.builtIn = Boolean(builtIn);
  output.editable = !builtIn;
  return output;
}

function readTemplateFile(file, builtIn) {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    return sanitiseTemplate(raw, { id: raw.id || path.basename(file, '.json'), builtIn });
  } catch {
    return null;
  }
}

export function listTemplates() {
  const builtIns = fs.existsSync(builtInDir)
    ? fs.readdirSync(builtInDir).filter(name => name.endsWith('.json')).map(name => readTemplateFile(path.join(builtInDir, name), true)).filter(Boolean)
    : [];
  const custom = fs.readdirSync(customDir).filter(name => name.endsWith('.json')).map(name => readTemplateFile(path.join(customDir, name), false)).filter(Boolean);
  const byId = new Map();
  for (const template of [...builtIns, ...custom]) byId.set(template.id, template);
  return [...byId.values()].sort((a, b) => Number(a.builtIn) - Number(b.builtIn) || a.name.localeCompare(b.name));
}

export function templateById(id) {
  return listTemplates().find(template => template.id === id) || null;
}

export function selectedTemplate() {
  const templates = listTemplates();
  const selected = templates.find(template => template.id === state.selectedTemplateId);
  return selected || templates.find(template => template.id === config.defaultTemplateId) || templates[0] || null;
}

export function setSelectedTemplate(id) {
  const template = templateById(id);
  if (!template) throw new Error('That template is not available.');
  state.selectedTemplateId = template.id;
  save();
  return template;
}

function writeCustom(template) {
  const file = path.join(customDir, `${safeId(template.id)}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...template, builtIn: undefined, editable: undefined }, null, 2));
}

export function createTemplate(input = {}) {
  const existing = new Set(listTemplates().map(item => item.id));
  let id = safeId(input.id || input.name || 'custom-template');
  if (existing.has(id)) id = `${id}-${crypto.randomBytes(3).toString('hex')}`;
  const template = sanitiseTemplate({ ...DEFAULTS, ...input, id, version: 1, updatedAt: Date.now() }, { id, builtIn: false });
  writeCustom(template);
  return template;
}

export function updateTemplate(id, input = {}) {
  const existing = templateById(id);
  if (!existing) throw new Error('That template does not exist.');
  if (existing.builtIn) throw new Error('Built-in templates are protected. Duplicate it first, then edit your copy.');
  const template = sanitiseTemplate({ ...existing, ...input, id, version: (existing.version || 1) + 1, updatedAt: Date.now() }, { id, builtIn: false });
  writeCustom(template);
  return template;
}

export function duplicateTemplate(id, name = '') {
  const source = templateById(id);
  if (!source) throw new Error('That template does not exist.');
  return createTemplate({ ...source, id: '', name: cleanText(name, `${source.name} Copy`, 70), description: source.description });
}

export function deleteTemplate(id) {
  const existing = templateById(id);
  if (!existing) return false;
  if (existing.builtIn) throw new Error('Built-in templates cannot be deleted.');
  fs.rmSync(path.join(customDir, `${safeId(id)}.json`), { force: true });
  if (state.selectedTemplateId === id) {
    state.selectedTemplateId = config.defaultTemplateId;
    save();
  }
  return true;
}

export function defaultTemplateDraft() {
  return sanitiseTemplate({ ...DEFAULTS, id: 'new-template', name: 'New Template' }, { id: 'new-template', builtIn: false });
}
