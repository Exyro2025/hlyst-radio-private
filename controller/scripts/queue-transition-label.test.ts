// Pins the admin queue's plain-language description of the imminent seam.
// The mixer stores exit effects on the outgoing track and entry effects on
// the incoming track, so this is deliberately tested as a pair.

import assert from 'node:assert/strict';
import { nextTransitionLabel } from '../src/broadcast/queue/pure.js';

const item = (track = {}, stemSeam = false) => ({ track, stemSeam });

assert.equal(nextTransitionLabel(null, null), null);
assert.equal(nextTransitionLabel(null, item()), 'Normal');

assert.equal(nextTransitionLabel(item({ washout: true }), item()), 'Washout');
assert.equal(nextTransitionLabel(item({ loop: true }), item()), 'Loop');
assert.equal(nextTransitionLabel(item(), item({ sweep: true })), 'Sweep');
assert.equal(nextTransitionLabel(item(), item({ blend: true })), 'Blend');
assert.equal(nextTransitionLabel(item(), item({ dissolve: true })), 'Dissolve');
assert.equal(nextTransitionLabel(item(), item({ chop: true })), 'Chop');

assert.equal(
  nextTransitionLabel(item({ washout: true }), item({ sweep: true })),
  'Washout + Sweep',
);
assert.equal(
  nextTransitionLabel(item({ washout: true }), item({ blend: true })),
  'Washout + Blend',
);

// These combinations are suppressed by radio.liq even if malformed queue
// state contains both flags, so the label must describe what actually airs.
assert.equal(
  nextTransitionLabel(item({ washout: true }), item({ dissolve: true, chop: true })),
  'Washout',
);
assert.equal(
  nextTransitionLabel(item({ loop: true }), item({ sweep: true, blend: true })),
  'Loop',
);

// A loop/washout on the incoming track shapes its own future exit, not the
// seam into it; reporting it here would put the label one track early.
assert.equal(nextTransitionLabel(item(), item({ loop: true, washout: true })), 'Normal');

assert.equal(
  nextTransitionLabel(item({ washout: true }), item({ sweep: true }, true)),
  'Stem blend',
);

console.log('queue transition label tests passed');
