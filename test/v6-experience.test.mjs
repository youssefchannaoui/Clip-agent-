import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { accountExperience, featureAccess } from '../src/billing.js';

const ui = fs.readFileSync(new URL('../src/public/activity-fix.js', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/public/studio-v6.css', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const workerIntelligence = fs.readFileSync(new URL('../worker/intelligence.py', import.meta.url), 'utf8');

test('one authoritative account experience covers the full customer lifecycle', () => {
  const free = accountExperience({ billing:{ plan:'free',status:'free' }, remaining:40, freeTier:{ expired:false } });
  const expired = accountExperience({ billing:{ plan:'free',status:'free' }, remaining:12, freeTier:{ expired:true } });
  const paidTrial = accountExperience({ billing:{ plan:'monthly',status:'trialing' }, remaining:400, trial:{ active:true } });
  const active = accountExperience({ billing:{ plan:'monthly',status:'active' }, remaining:300 });
  const empty = accountExperience({ billing:{ plan:'monthly',status:'active' }, remaining:0 });
  const canceling = accountExperience({ billing:{ plan:'yearly',status:'active',cancelAtPeriodEnd:true }, remaining:100 });
  const pastDue = accountExperience({ billing:{ plan:'weekly',status:'past_due' }, remaining:70 });
  const owner = accountExperience({ billing:{ plan:'admin',status:'active' }, unlimited:true });

  assert.equal(free.id, 'free_trial');
  assert.equal(free.watermarkRequired, true);
  assert.equal(free.canPublish, false);
  assert.equal(expired.id, 'free_expired');
  assert.equal(expired.browseOnly, true);
  assert.equal(paidTrial.id, 'premium_trial');
  assert.equal(paidTrial.canPublish, true);
  assert.equal(active.id, 'premium_active');
  assert.equal(empty.id, 'premium_empty');
  assert.equal(empty.canGenerate, false);
  assert.equal(canceling.id, 'premium_canceling');
  assert.equal(pastDue.id, 'premium_past_due');
  assert.equal(pastDue.browseOnly, true);
  assert.equal(owner.id, 'owner');
  assert.equal(owner.canGenerate, true);
});

test('V6 exposes distinct account-aware journeys instead of cosmetic plan badges', () => {
  assert.match(ui, /function clientExperience\(\)/);
  assert.match(ui, /function syncAccountExperience\(\)/);
  assert.match(ui, /data-account-mode=/);
  assert.match(ui, /dc-v6-trial-path/);
  assert.match(ui, /dc-v6-create-lock/);
  assert.match(ui, /Your existing workspace remains available/);
  assert.match(css, /data-dc-experience="free_trial"/);
  assert.match(css, /data-dc-experience="owner"/);
});

test('Quality Center is fully removed, with nothing left behind', () => {
  // Deleted 11 Aug at the owner's request. Views are generated from the NAV
  // arrays, so a stale render function or nav entry would resurrect a
  // half-working screen rather than fail loudly.
  assert.doesNotMatch(ui, /Quality Center/);
  assert.doesNotMatch(ui, /renderQualityCenter/);
  assert.doesNotMatch(ui, /qualityAssessment/);
  assert.doesNotMatch(ui, /qualityClipRow/);
  assert.doesNotMatch(css, /#view-quality/);
});

test('the modular V6 stylesheet is cache-versioned and served by the app', () => {
  assert.match(server, /studioV6CssPage/);
  assert.match(server, /studioV6CssVersion/);
  assert.match(server, /pathname === '\/studio-v6\.css'/);
  assert.match(server, /<link rel="stylesheet" href="\/studio-v6\.css\?v=/);
});

test('premium feature gates match the plans in both UI and server code', () => {
  const weekly = featureAccess({ role:'creator', createdAt:Date.now(), billing:{ plan:'weekly', status:'active' } });
  const monthly = featureAccess({ role:'creator', createdAt:Date.now(), billing:{ plan:'monthly', status:'active' } });
  assert.equal(weekly.customBranding, true);
  assert.equal(weekly.socialPublishing, true);
  assert.equal(weekly.aiDirector, false);
  assert.equal(weekly.advancedFraming, false);
  assert.equal(monthly.aiDirector, true);
  assert.equal(monthly.advancedFraming, true);
  assert.match(server, /featureAccess\(currentUser\)\.advancedFraming/);
  assert.match(ui, /AI speaker focus \$\{aiAllowed\?'':'· PRO'\}/);
});

test('V6 original artwork and director intelligence are product assets, not mock-only concepts', () => {
  assert.equal(fs.existsSync(new URL('../src/public/marketing-assets/v6-studio-transform.png', import.meta.url)), true);
  assert.match(ui, /v6-studio-transform\.png/);
  assert.match(ui, /directorBrief/);
  assert.match(workerIntelligence, /openingStrength/);
  assert.match(workerIntelligence, /payoffStrength/);
  assert.match(workerIntelligence, /bestPlatforms/);
});
