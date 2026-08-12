import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { state, save, selectedTemplateId, setSelectedTemplateId, settingDefaults } from './store.js';

const builtInDir = path.join(config.root, 'src', 'templates');
const customDir = path.join(config.dataDir, 'templates');
const shopCatalogFile = path.join(config.root, 'src', 'templates', 'shop', 'catalog.json');
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
  // Shortest time the crop stays on one speaker after moving to them. Without
  // a hold, two people in conversation can satisfy the switch test repeatedly
  // and leave the frame oscillating between them.
  smartFramingDwellSeconds: 1.2,
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
  // Writing direction for captions. 'auto' decides per line from the script,
  // which is what mixed Arabic/English lectures need — the same clip can have
  // an Arabic ayah and an English explanation seconds apart.
  captionDirection: 'auto',
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
  captionDirection: ['auto', 'ltr', 'rtl'],
  captionPosition: ['top', 'middle', 'bottom'],
  captionHorizontal: ['left', 'center', 'right'],
  watermarkPosition: ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'],
};

const NUMBER_RANGES = {
  width: [360, 2160], height: [360, 3840], blurStrength: [0, 60],
  smartFramingPadding: [0.05, 0.45], smartFramingZoom: [0.75, 1.35], smartFramingSmoothing: [0, 0.95],
  smartFramingDwellSeconds: [0, 5],
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

function shopCatalogSource() {
  try {
    const parsed = JSON.parse(fs.readFileSync(shopCatalogFile, 'utf8'));
    return Array.isArray(parsed?.products) ? parsed.products : [];
  } catch (error) {
    console.error(`Template Shop catalog could not be read: ${error.message}`);
    return [];
  }
}

function shopProductSource(id) {
  return shopCatalogSource().find(product => product?.id === String(id || '')) || null;
}

function shopEntitlements() {
  if (!Array.isArray(state.templateEntitlements)) state.templateEntitlements = [];
  return state.templateEntitlements;
}

function entitlementFor(user, productId) {
  const userId = userIdOf(user);
  return shopEntitlements().find(item => item?.userId === userId && item?.productId === productId && item?.status === 'active') || null;
}

function entitlementForCheckoutSession(checkoutSessionId) {
  const sessionId = cleanText(checkoutSessionId, '', 120);
  return sessionId ? shopEntitlements().find(item => item?.checkoutSessionId === sessionId && item?.status === 'active') || null : null;
}

function hasProAccess(user) {
  if (['owner', 'admin'].includes(String(user?.role || '').toLowerCase())) return true;
  return ['weekly', 'monthly', 'yearly'].includes(String(user?.billing?.plan || 'free').toLowerCase())
    && !['past_due', 'cancelled', 'canceled', 'incomplete_expired'].includes(String(user?.billing?.status || '').toLowerCase());
}

function productAccess(product, user) {
  const acquired = entitlementFor(user, product.id);
  const accessType = String(product?.access?.type || 'purchase');
  const pro = hasProAccess(user);
  const includedNow = accessType === 'free' || (accessType === 'pro' && pro);
  // A Pro acquisition remembers that the user added the product, but it does
  // not turn a subscription benefit into a permanent purchase. Existing clip
  // snapshots remain intact; applying it to new work locks again if Pro ends.
  const acquiredAccess = Boolean(acquired && (acquired.source !== 'pro' || pro));
  // Being eligible to acquire is not the same as having the product in My
  // Templates. Free/Pro cards enter the editor only after an explicit Add.
  const accessible = Boolean(acquiredAccess);
  let accessState = 'purchase_required';
  if (acquiredAccess) accessState = acquired.source === 'purchase' ? 'purchased' : 'acquired';
  else if (acquired?.source === 'pro' && !pro) accessState = 'pro_required';
  else if (accessType === 'free') accessState = 'available_free';
  else if (accessType === 'pro') accessState = pro ? 'available_pro' : 'pro_required';
  return {
    accessType,
    accessState,
    acquired: Boolean(acquiredAccess),
    inLibrary: Boolean(acquired),
    accessible,
    canAcquire: !acquired && includedNow,
    canCustomize: accessible,
    canCheckout: !accessible && accessType === 'purchase' && Boolean(process.env[String(product.stripePriceEnv || '')]),
    entitlement: acquired,
  };
}

function publicProduct(product, user) {
  const access = productAccess(product, user);
  const priceConfigured = access.accessType === 'purchase' && Boolean(process.env[String(product.stripePriceEnv || '')]);
  return {
    id: String(product.id),
    templateId: String(product.templateId),
    name: cleanText(product.name, 'DeenClipped Template', 70),
    description: cleanText(product.description, 'A DeenClipped template.', 240),
    category: cleanText(product.category, 'Featured', 40),
    access: {
      type: access.accessType,
      label: cleanText(product?.access?.label, access.accessType === 'free' ? 'Free' : 'Premium', 30),
      amount: access.accessType === 'purchase' ? Math.max(0, Math.round(Number(product?.access?.amount || 0))) : null,
      currency: access.accessType === 'purchase' ? cleanText(product?.access?.currency, 'AUD', 3).toUpperCase() : null,
    },
    badges: Array.isArray(product.badges) ? product.badges.map(item => cleanText(item, '', 30)).filter(Boolean).slice(0, 4) : [],
    features: Array.isArray(product.features) ? product.features.map(item => cleanText(item, '', 90)).filter(Boolean).slice(0, 8) : [],
    preview: {
      posterUrl: String(product?.preview?.posterUrl || '').startsWith('/marketing-assets/') ? String(product.preview.posterUrl) : '',
      aspectRatio: ['9:16', '4:5', '1:1', '16:9'].includes(product?.preview?.aspectRatio) ? product.preview.aspectRatio : '9:16',
      accent: cleanColor(product?.preview?.accent, '#D9B478'),
      captionSample: cleanText(product?.preview?.captionSample, 'Create something worth sharing.', 100),
    },
    accessState: access.accessState,
    acquired: access.acquired,
    inLibrary: access.inLibrary,
    accessible: access.accessible,
    canAcquire: access.canAcquire,
    canCustomize: access.canCustomize,
    canCheckout: access.canCheckout,
    checkoutConfigured: priceConfigured,
    acquiredAt: access.entitlement?.acquiredAt || null,
  };
}

function shopTemplate(product, user) {
  const access = productAccess(product, user);
  if (!access.accessible) return null;
  const template = sanitiseTemplate(
    { ...(product.template || {}), id: product.templateId, name: product.name, description: product.description },
    { id: product.templateId, builtIn: false },
  );
  return {
    ...template,
    shopProductId: product.id,
    shopAccessType: access.accessType,
    acquired: access.acquired,
    builtIn: false,
    serverOwned: true,
    editable: false,
    // Keep the catalogue stable across reads. Catalog products change only
    // when DeenClipped ships a new version, not every time /api/state loads.
    updatedAt: Math.max(1, Math.round(Number(product.version || 1))),
  };
}

/** Safe, presentation-only catalog metadata plus server-derived permissions. */
export function listTemplateShop(user) {
  return shopCatalogSource().map(product => publicProduct(product, user));
}

export function templateShopProduct(id, user) {
  const product = shopProductSource(id);
  return product ? publicProduct(product, user) : null;
}

/**
 * Resolve a shop master for an in-app composition preview.
 *
 * Previewing does not acquire the product and never adds it to listTemplates.
 * The returned object is still sanitised through the real template schema, so
 * the composition uses values the renderer understands rather than a second
 * hand-authored preview schema.
 */
export function templateShopPreviewStyle(id) {
  const product = shopProductSource(id);
  if (!product) return null;
  return {
    ...sanitiseTemplate(
      { ...(product.template || {}), id: product.templateId, name: product.name, description: product.description },
      { id: product.templateId, builtIn: false },
    ),
    shopProductId: product.id,
  };
}

/** Payment details are server-only and must never be returned by the catalog API. */
export function templateShopCheckoutDefinition(id) {
  const product = shopProductSource(id);
  if (!product || product?.access?.type !== 'purchase') return null;
  return {
    id: product.id,
    name: cleanText(product.name, 'DeenClipped Template', 70),
    templateId: product.templateId,
    priceId: String(process.env[String(product.stripePriceEnv || '')] || ''),
  };
}

function recordEntitlement(user, product, source, references = {}) {
  const userId = userIdOf(user);
  if (!userId) throw new Error('A Template Shop item needs an account.');
  const existing = entitlementFor(user, product.id);
  if (existing) return { entitlement: existing, duplicate: true };
  if (source === 'purchase' && entitlementForCheckoutSession(references.checkoutSessionId)) {
    // A verified session may unlock one product only. Treat the replay as an
    // idempotent no-op so Stripe retries cannot turn into webhook failures.
    return { entitlement: entitlementForCheckoutSession(references.checkoutSessionId), duplicate: true, sessionMismatch: true };
  }
  const entitlement = {
    id: `tplent_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`,
    userId,
    productId: product.id,
    templateId: product.templateId,
    source,
    status: 'active',
    acquiredAt: Date.now(),
    checkoutSessionId: cleanText(references.checkoutSessionId, '', 120),
    stripeEventId: cleanText(references.stripeEventId, '', 120),
    paymentIntentId: cleanText(references.paymentIntentId, '', 120),
  };
  shopEntitlements().push(entitlement);
  save();
  return { entitlement, duplicate: false };
}

/** Idempotent acquisition for products already included in the account. */
export function acquireTemplateShopProduct(user, id) {
  const product = shopProductSource(id);
  if (!product) throw Object.assign(new Error('That Template Shop item does not exist.'), { statusCode: 404 });
  const accessType = String(product?.access?.type || 'purchase');
  if (accessType === 'purchase') throw Object.assign(new Error('Complete the verified checkout to unlock this template.'), { statusCode: 402, code: 'template_purchase_required' });
  if (accessType === 'pro' && !hasProAccess(user)) throw Object.assign(new Error('This template is included with Pro.'), { statusCode: 403, code: 'template_pro_required' });
  const result = recordEntitlement(user, product, accessType);
  return { ...result, product: publicProduct(product, user), template: shopTemplate(product, user) };
}

/** Called only from the verified Stripe webhook path. */
export function grantPurchasedTemplate(user, id, references = {}) {
  const product = shopProductSource(id);
  if (!product || product?.access?.type !== 'purchase') throw new Error('Unknown purchasable Template Shop item.');
  const checkoutSessionId = cleanText(references.checkoutSessionId, '', 120);
  if (!checkoutSessionId) throw new Error('A verified Stripe Checkout session is required to unlock a template.');
  const result = recordEntitlement(user, product, 'purchase', { ...references, checkoutSessionId });
  return { ...result, product: publicProduct(product, user), template: shopTemplate(product, user) };
}

/** Make an editable user-owned copy. The shop master remains immutable. */
export function customizeTemplateShopProduct(user, id, name = '') {
  const product = shopProductSource(id);
  if (!product) throw Object.assign(new Error('That Template Shop item does not exist.'), { statusCode: 404 });
  const source = shopTemplate(product, user);
  if (!source) {
    const access = productAccess(product, user);
    const code = access.accessType === 'pro' ? 'template_pro_required' : 'template_purchase_required';
    throw Object.assign(new Error(access.accessType === 'pro' ? 'This template is included with Pro.' : 'Purchase this template before customising it.'), { statusCode: access.accessType === 'pro' ? 403 : 402, code });
  }
  const template = createTemplate(user, {
    ...source,
    id: '',
    name: cleanText(name, `${product.name} Copy`, 70),
    description: `Customised from ${product.name}.`,
  });
  return { template, product: publicProduct(product, user) };
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
  const shop = shopCatalogSource().map(product => shopTemplate(product, user)).filter(Boolean);
  const byId = new Map();
  for (const template of [...builtIns, ...shop, ...custom]) byId.set(template.id, template);
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
  if (existing.builtIn || existing.serverOwned) throw new Error('DeenClipped templates are protected. Duplicate it first, then edit your copy.');
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
  if (existing.builtIn || existing.serverOwned) throw new Error('DeenClipped templates cannot be deleted.');
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
  const shop = shopCatalogSource().map(product => String(product.templateId || '')).filter(Boolean);
  return [...builtIns, ...shop, ...custom];
}

export function defaultTemplateDraft() {
  return sanitiseTemplate({ ...DEFAULTS, id: 'new-template', name: 'New Template' }, { id: 'new-template', builtIn: false });
}

/**
 * The Clip Style contract: exactly which fields applying a style may write.
 *
 * Without this list "apply a style" means "spread the whole template over the
 * clip", which silently carries identity (a style's own name and id) and
 * per-clip framing along with the look. The two categories excluded below are
 * the ones that actually cause damage:
 *
 *   identity   copying `id`/`name` onto a clip makes it claim to *be* the
 *              style, so later edits appear to mutate the saved style.
 *   clip data  cropPositionX/Y is where the subject sits in *this* clip. It
 *              reads like part of the look, but applying one clip's framing to
 *              every other clip moves the speaker off-centre in all of them.
 *              captionTimingOffsetMs is also clip-specific: it corrects the
 *              speech alignment of one recording and must not move captions
 *              in every clip that shares the same visual style.
 *
 * Derived from DEFAULTS rather than hand-listed, so a field added to the
 * schema cannot be quietly left out of styles — but the exclusions are
 * explicit, so adding one is a deliberate act with a reason attached.
 */
const STYLE_EXCLUDED_FIELDS = Object.freeze([
  // Identity of the style record itself.
  'id', 'name', 'description', 'builtIn', 'editable', 'userId', 'version', 'updatedAt',
  // Server-side library provenance never belongs inside a clip snapshot.
  'serverOwned', 'shopProductId', 'shopAccessType', 'acquired',
  // Per-clip framing and speech alignment. See above.
  'cropPositionX', 'cropPositionY', 'captionTimingOffsetMs',
]);

export const CLIP_STYLE_FIELDS = Object.freeze(
  Object.keys(DEFAULTS).filter(key => !STYLE_EXCLUDED_FIELDS.includes(key)).sort(),
);

/** True when a field may be written by applying a Clip Style. */
export function isClipStyleField(key) {
  return CLIP_STYLE_FIELDS.includes(String(key));
}

/**
 * The settings a Clip Style contributes to a clip — a copy, never a reference.
 *
 * Callers must treat the result as the complete set of changes applying a
 * style makes. Anything absent here is clip-owned and has to survive untouched:
 * the video, transcript wording, clip timing, text layers and this clip's
 * framing.
 */
export function clipStyleSettings(template = {}) {
  const out = {};
  for (const key of CLIP_STYLE_FIELDS) {
    if (template[key] !== undefined) out[key] = template[key];
  }
  return JSON.parse(JSON.stringify(out));
}

/**
 * Fields where a clip has diverged from the style it has applied.
 *
 * Drives the "This clip has custom changes" state, and decides what
 * "Reset to style" puts back. Compared by value, so re-selecting the same
 * option does not count as a change.
 */
export function clipStyleDrift(clip = {}, template = {}) {
  return CLIP_STYLE_FIELDS.filter(key => {
    if (template[key] === undefined || clip[key] === undefined) return false;
    return JSON.stringify(clip[key]) !== JSON.stringify(template[key]);
  });
}
