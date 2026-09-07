/*
 * WHERE A DEENAI CARD SENDS YOU.
 *
 * Every insight this module produces names a screen -- "open the Review
 * queue", "the fix is usually the account connection", "clip more of that
 * lecture" -- and until now not one of them was clickable. The headline card
 * is the clearest case: `nextActionCard` is built from `referrals.nextStep`,
 * which returns the step AND its action, and DeenAI dropped the action on the
 * floor. So the one card whose whole job is "do this next" was a dead end,
 * while the identical step is a button in the task ladder two panels away.
 * That is invariant 9 -- a control that cannot reach what it names -- read as
 * a card rather than a button.
 *
 * THE WHOLE TABLE IS 'go'. Every entry navigates and nothing mutates: no
 * approve, no schedule, no setting written. That is a deliberate ceiling
 * rather than a first step, and the reason is in this repo's own record --
 * a bulk-approve from here would stamp `approvedBy: 'deenai'`, and
 * social.js skips a TikTok target for any clip not approved manually (TikTok's
 * per-post consent rule). So an "approve these six" button would silently drop
 * a destination the customer pays for. An assistant that can only take you to
 * the screen cannot do that, and the person still presses the real button
 * with the real confirmation in front of them.
 *
 * The client sends an ID and nothing else -- never a screen name, never a
 * handler name -- so there is no capability here to escalate: an id that is
 * not in this frozen table resolves to nothing.
 */

// id -> { label, step }. `step` is the action StudioAdapter.goToStep already
// understands, so this adds no second destination map; the studio has one.
export const ACTIONS = Object.freeze({
  'open-review': Object.freeze({ label: 'Open the review queue', step: 'review' }),
  'open-connections': Object.freeze({ label: 'Open Connections', step: 'connect' }),
  'open-schedule': Object.freeze({ label: 'Open the schedule', step: 'schedule' }),
  'open-nasheed': Object.freeze({ label: 'Open the nasheed library', step: 'nasheed' }),
  'open-paste': Object.freeze({ label: 'Add a lecture', step: 'paste' }),
  'open-library': Object.freeze({ label: 'Open the lecture library', step: 'library' }),
});

// The steps referrals.nextStep can return, mapped to an action. Frozen and
// exhaustive over the keys that carry work: 'processing' and 'done' are not
// somewhere to go, and nextActionCard already refuses to draw for them.
const STEP_ACTIONS = Object.freeze({
  import: 'open-paste',
  'no-clips': 'open-paste',
  review: 'open-review',
  publish: 'open-connections',
  upgrade: null,
});

// OWN KEYS ONLY. `ACTIONS['constructor']` is truthy on any object literal --
// Object.prototype is still behind a frozen one -- so a lookup that trusts the
// bare index resolves 'constructor', 'toString' and '__proto__' to something.
// Harmless today, because every id is written by this repo; the point is that
// the id is the ONLY thing on the wire, so it must never resolve to anything
// the table does not itself name. Found by a test asking for 'constructor'.
function own(table, key) {
  const k = String(key || '');
  return Object.prototype.hasOwnProperty.call(table, k) ? table[k] : null;
}

export function actionForStep(key) {
  const id = own(STEP_ACTIONS, key);
  const found = id ? own(ACTIONS, id) : null;
  return found ? { id, ...found } : null;
}

export function action(id) {
  const found = own(ACTIONS, id);
  return found ? { id: String(id), ...found } : null;
}
