import { isCompleteness, isDataAuthority, isValidUtcMillis } from '../../foundation/contracts/index.js';
import type {
  ProductCapitalRiskReference,
  ProductExecutionReference,
  ProductStrategyDecisionReference,
} from '../contracts/index.js';

const ID = /^[A-Za-z0-9_.:\-]{1,128}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,99}$/;

function ids(name: string, values: readonly string[], maximum = 1_024): readonly string[] {
  if (!Array.isArray(values) || values.length > maximum || values.some((value) => !ID.test(value)) || new Set(values).size !== values.length) throw new TypeError(`${name} is invalid`);
  return Object.freeze([...values]);
}

function codes(name: string, values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > 128 || values.some((value) => !CODE.test(value))) throw new TypeError(`${name} is invalid`);
  return Object.freeze([...new Set(values)]);
}

/** Opaque Basis/Volume owner projection; scores and ranks are never recomputed. */
export function projectStrategyDecisionReference(input: ProductStrategyDecisionReference): Readonly<ProductStrategyDecisionReference> {
  if (!['BASIS', 'VOLUME'].includes(input.strategy)) throw new TypeError('strategy is invalid');
  for (const [name, value] of [['ownerId', input.ownerId], ['decisionId', input.decisionId], ['correlationId', input.correlationId]] as const) if (!ID.test(value)) throw new TypeError(`${name} is invalid`);
  if (input.proposalId !== null && !ID.test(input.proposalId)) throw new TypeError('proposalId is invalid');
  if (input.revision !== null && (input.revision.length === 0 || input.revision.length > 128)) throw new TypeError('revision is invalid');
  if (!isValidUtcMillis(input.occurredAtMs)) throw new TypeError('occurredAtMs is invalid');
  if (input.expiresAtMs !== null && (!isValidUtcMillis(input.expiresAtMs) || input.expiresAtMs < input.occurredAtMs)) throw new TypeError('expiresAtMs is invalid');
  if (!isDataAuthority(input.authority) || !isCompleteness(input.completeness)) throw new TypeError('strategy truth metadata is invalid');
  if (!['PROPOSED', 'REJECTED', 'NO_ACTION', 'UNKNOWN'].includes(input.verdict)) throw new TypeError('verdict is invalid');
  return Object.freeze({ ...input, reasonCodes: codes('reasonCodes', input.reasonCodes) });
}

/** Preserve Capital and Risk owner verdicts without synthesizing approval. */
export function projectCapitalRiskReference(input: ProductCapitalRiskReference): Readonly<ProductCapitalRiskReference> {
  if (!ID.test(input.opportunityId)) throw new TypeError('opportunityId is invalid');
  if (input.capitalVerdictId !== null && !ID.test(input.capitalVerdictId)) throw new TypeError('capitalVerdictId is invalid');
  if (input.riskVerdictId !== null && !ID.test(input.riskVerdictId)) throw new TypeError('riskVerdictId is invalid');
  if (!['PERMIT', 'CAP', 'REJECT', 'UNAVAILABLE'].includes(input.capitalVerdict)) throw new TypeError('capitalVerdict is invalid');
  if (!['APPROVE', 'CAP', 'REJECT', 'UNAVAILABLE'].includes(input.riskVerdict)) throw new TypeError('riskVerdict is invalid');
  if (!isValidUtcMillis(input.evaluatedAtMs) || !isDataAuthority(input.authority)) throw new TypeError('capital/risk evidence is invalid');
  if (input.capitalVerdict !== 'UNAVAILABLE' && input.capitalVerdictId === null) throw new TypeError('available capital verdict requires its owner ID');
  if (input.riskVerdict !== 'UNAVAILABLE' && input.riskVerdictId === null) throw new TypeError('available risk verdict requires its owner ID');
  if (input.authority === 'UNAVAILABLE' && (input.capitalVerdict !== 'UNAVAILABLE' || input.riskVerdict !== 'UNAVAILABLE')) throw new TypeError('unavailable authority cannot carry an available verdict');
  if ((input.riskVerdict === 'APPROVE' || input.riskVerdict === 'CAP') && (input.capitalVerdict === 'REJECT' || input.capitalVerdict === 'UNAVAILABLE')) throw new TypeError('risk cannot approve when Capital rejected or is unavailable');
  return Object.freeze({ ...input, reasonCodes: codes('reasonCodes', input.reasonCodes) });
}

/** Preserve L/Foundation execution, reconciliation, position and recovery references. */
export function projectExecutionReference(input: ProductExecutionReference): Readonly<ProductExecutionReference> {
  if (input.ticketId !== null && !ID.test(input.ticketId)) throw new TypeError('ticketId is invalid');
  if (typeof input.executionState !== 'string' || input.executionState.length === 0 || input.executionState.length > 128) throw new TypeError('executionState is invalid');
  if (!['EXACT', 'PENDING', 'PARTIAL', 'AMBIGUOUS', 'DIVERGED', 'STALE', 'UNAVAILABLE'].includes(input.reconciliationState)) throw new TypeError('reconciliationState is invalid');
  if (typeof input.blocksNewExposure !== 'boolean' || !isDataAuthority(input.authority) || !isValidUtcMillis(input.observedAtMs)) throw new TypeError('execution evidence is invalid');
  if (input.reconciliationState !== 'EXACT' && input.blocksNewExposure !== true) throw new TypeError('non-exact reconciliation must block new exposure');
  if (input.reconciliationState === 'EXACT' && input.authority === 'UNAVAILABLE') throw new TypeError('exact reconciliation cannot have unavailable authority');
  return Object.freeze({
    ...input,
    positionIds: ids('positionIds', input.positionIds),
    liabilityIds: ids('liabilityIds', input.liabilityIds),
    recoveryCampaignIds: ids('recoveryCampaignIds', input.recoveryCampaignIds),
    reasonCodes: codes('reasonCodes', input.reasonCodes),
  });
}
