/**
 * Wave 3 Lane — dormant proposal outcome attribution/calibration seam.
 *
 * A future composition root injects finalized proposal/plan evidence and an
 * evaluation clock. This module owns no state, route, timer, cache, strategy
 * threshold, or execution authority.
 */
export * from './types.js';
export { recordProposalOutcome } from './record.js';
export { aggregateProposalOutcomes } from './aggregate.js';
