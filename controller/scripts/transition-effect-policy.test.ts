// Pins the controller-owned transition-effect pacing. The model is advisory:
// it cannot make the station effect-heavy by repeatedly choosing a treatment.

import assert from 'node:assert/strict';
import {
  MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS,
  editorialEffectAllowed,
  nextPlainTransitionsSinceEffect,
} from '../src/broadcast/transition-effect-policy.js';

assert.equal(MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS, 2, 'effects need two plain seams between them');
assert.equal(editorialEffectAllowed(2), true, 'a cold or rested station may honour an editorial effect');
assert.equal(editorialEffectAllowed(1), false, 'one plain seam is not enough');
assert.equal(editorialEffectAllowed(0), false, 'back-to-back effects are never editorially armed');

let plainSinceEffect = MIN_PLAIN_TRANSITIONS_BETWEEN_EFFECTS;
plainSinceEffect = nextPlainTransitionsSinceEffect({ plainTransitionsSinceEffect: plainSinceEffect, effectFired: true });
assert.equal(plainSinceEffect, 0, 'any effect on air starts the cooldown');
plainSinceEffect = nextPlainTransitionsSinceEffect({ plainTransitionsSinceEffect: plainSinceEffect, effectFired: false });
assert.equal(plainSinceEffect, 1, 'first final plain seam advances the cooldown');
plainSinceEffect = nextPlainTransitionsSinceEffect({ plainTransitionsSinceEffect: plainSinceEffect, effectFired: false });
assert.equal(plainSinceEffect, 2, 'second final plain seam reopens editorial effects');
assert.equal(editorialEffectAllowed(plainSinceEffect), true, 'the next editorial effect may now arm');
assert.equal(
  nextPlainTransitionsSinceEffect({ plainTransitionsSinceEffect: 2, effectFired: false }),
  2,
  'the counter saturates once the station is eligible',
);
