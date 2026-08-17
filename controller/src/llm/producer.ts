// Public surface for the experimental Producer contracts. The evaluation
// harness and a future Rehearsal Room share this boundary so the benchmark
// cannot quietly drift away from the split architecture it is meant to prove.

export {
  PRODUCER_TRANSITIONS,
  ProducerPickSchema,
  ProducerSegmentSchema,
  producerPickSystem,
  producerSelectSystem,
  producerSegmentSystem,
  checkProducerPick,
  checkProducerSegment,
} from './internal/producer/contracts.js';

export {
  parseFunctionGemmaCall,
  parseOpenAiCalls,
  producerRouterConfig,
  routeProducerDiscovery,
  type RoutedDiscovery,
} from './internal/producer/router.js';
