import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'deenclipped-template-shop-'));
process.env.STRIPE_SECRET_KEY = 'sk_test_template_shop';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_template_shop';
delete process.env.STRIPE_PRICE_TEMPLATE_MIDNIGHT_SIGNAL;

const templates = await import('../src/templates.js');
const billing = await import('../src/billing.js');
const { state, selectedTemplateId } = await import('../src/store.js');

const freeUser = {
  id: 'shop-free', email: 'free@shop.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'free', status: 'free', stripeCustomerId: 'cus_shop_free' },
};
const proUser = {
  id: 'shop-pro', email: 'pro@shop.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'monthly', status: 'active', stripeCustomerId: 'cus_shop_pro' },
};
const otherUser = {
  id: 'shop-other', email: 'other@shop.test', role: 'creator', createdAt: Date.now(),
  billing: { plan: 'free', status: 'free', stripeCustomerId: 'cus_shop_other' },
};
state.authUsers = [freeUser, proUser, otherUser];
state.templateEntitlements = [];
state.processedStripeEvents = [];

test('catalog exposes four safe products and derives access on the server', () => {
  const freeCatalog = templates.listTemplateShop(freeUser);
  assert.equal(freeCatalog.length, 4);
  assert.deepEqual(new Set(freeCatalog.map(item => item.access.type)), new Set(['free', 'pro', 'purchase']));
  assert.equal(freeCatalog.find(item => item.id === 'clean-focus').accessState, 'available_free');
  assert.equal(freeCatalog.find(item => item.id === 'golden-reflection').accessState, 'pro_required');
  assert.equal(freeCatalog.find(item => item.id === 'midnight-signal').canCheckout, false);

  const proCatalog = templates.listTemplateShop(proUser);
  assert.equal(proCatalog.find(item => item.id === 'golden-reflection').accessState, 'available_pro');
  assert.equal(proCatalog.find(item => item.id === 'golden-reflection').canAcquire, true);

  for (const product of freeCatalog) {
    assert.ok(!('template' in product), 'raw renderer settings must not be public shop metadata');
    assert.ok(!('stripePriceEnv' in product), 'server configuration names must stay private');
    assert.ok(!('priceId' in product.access), 'Stripe price IDs must stay private');
  }
});

test('free acquisition is idempotent, tenant scoped and does not change the default', () => {
  const before = selectedTemplateId(freeUser);
  const first = templates.acquireTemplateShopProduct(freeUser, 'clean-focus');
  const again = templates.acquireTemplateShopProduct(freeUser, 'clean-focus');
  assert.equal(first.duplicate, false);
  assert.equal(again.duplicate, true);
  assert.equal(state.templateEntitlements.filter(item => item.userId === freeUser.id && item.productId === 'clean-focus').length, 1);
  assert.ok(templates.templateById('dc-shop-clean-focus', freeUser));
  assert.equal(templates.templateById('dc-shop-clean-focus', otherUser), null);
  assert.equal(selectedTemplateId(freeUser), before);
});

test('Pro products require Pro and relock for new work when Pro ends', () => {
  assert.throws(() => templates.acquireTemplateShopProduct(freeUser, 'golden-reflection'), error => {
    assert.equal(error.code, 'template_pro_required');
    assert.equal(error.statusCode, 403);
    return true;
  });
  templates.acquireTemplateShopProduct(proUser, 'golden-reflection');
  assert.ok(templates.templateById('dc-shop-golden-reflection', proUser));
  proUser.billing.plan = 'free';
  proUser.billing.status = 'cancelled';
  assert.equal(templates.templateById('dc-shop-golden-reflection', proUser), null);
  assert.equal(templates.templateShopProduct('golden-reflection', proUser).accessState, 'pro_required');
  // Previous clip snapshots do not depend on this lookup and remain renderable.
  proUser.billing.plan = 'monthly';
  proUser.billing.status = 'active';
});

test('customising makes an editable account copy and never selects it', () => {
  const before = selectedTemplateId(freeUser);
  const { template } = templates.customizeTemplateShopProduct(freeUser, 'clean-focus', 'My Clean Focus');
  assert.equal(template.name, 'My Clean Focus');
  assert.equal(template.userId, freeUser.id);
  assert.equal(template.editable, true);
  assert.notEqual(template.id, 'dc-shop-clean-focus');
  assert.equal(selectedTemplateId(freeUser), before);
  assert.equal(templates.templateById(template.id, otherUser), null);
  assert.throws(() => templates.updateTemplate(freeUser, 'dc-shop-clean-focus', { name: 'Changed master' }), /protected/i);
});

test('paid products never unlock through acquire or unconfigured checkout', async () => {
  assert.throws(() => templates.acquireTemplateShopProduct(freeUser, 'midnight-signal'), error => {
    assert.equal(error.code, 'template_purchase_required');
    assert.equal(error.statusCode, 402);
    return true;
  });
  await assert.rejects(() => billing.createTemplateCheckoutSession(freeUser, 'midnight-signal'), error => {
    assert.equal(error.code, 'template_checkout_not_configured');
    assert.equal(error.statusCode, 503);
    return true;
  });
  assert.equal(templates.templateById('dc-shop-midnight-signal', freeUser), null);
});

test('a verified paid webhook grants once and never changes template selection', () => {
  const before = selectedTemplateId(freeUser);
  const event = eventId => ({
    id: eventId,
    type: 'checkout.session.completed',
    data: { object: {
      id: 'cs_template_1', mode: 'payment', payment_status: 'paid', customer: 'cus_shop_free',
      payment_intent: 'pi_template_1',
      metadata: { userId: freeUser.id, kind: 'template_purchase', productId: 'midnight-signal' },
    } },
  });
  billing.handleWebhookEvent(event('evt_template_1'));
  assert.ok(templates.templateById('dc-shop-midnight-signal', freeUser));
  assert.equal(templates.templateById('dc-shop-midnight-signal', otherUser), null);
  assert.equal(selectedTemplateId(freeUser), before);
  billing.handleWebhookEvent(event('evt_template_2'));
  assert.equal(state.templateEntitlements.filter(item => item.userId === freeUser.id && item.productId === 'midnight-signal').length, 1);
  const entitlement = state.templateEntitlements.find(item => item.userId === freeUser.id && item.productId === 'midnight-signal');
  assert.equal(entitlement.checkoutSessionId, 'cs_template_1');
  assert.equal(entitlement.stripeEventId, 'evt_template_1');
});

test('an unpaid template checkout never grants access', () => {
  billing.handleWebhookEvent({
    id: 'evt_template_unpaid', type: 'checkout.session.completed', data: { object: {
      id: 'cs_template_unpaid', mode: 'payment', payment_status: 'unpaid', customer: 'cus_shop_other',
      metadata: { userId: otherUser.id, kind: 'template_purchase', productId: 'midnight-signal' },
    } },
  });
  assert.equal(templates.templateById('dc-shop-midnight-signal', otherUser), null);
});
