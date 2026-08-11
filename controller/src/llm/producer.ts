// Public surface for the experimental Producer contracts. The evaluation
// harness and a future Rehearsal Room share this boundary so the benchmark
// cannot quietly drift away from the split architecture it is meant to prove.

export {
  PRODUCER_TRANSITIONS,
  ProducerPickSchema,
  ProducerSegmentSchema,
  producerPickSystem,
  producerSegmentSystem,
  checkProducerPick,
  checkProducerSegment,
} from './internal/producer/contracts.js';
