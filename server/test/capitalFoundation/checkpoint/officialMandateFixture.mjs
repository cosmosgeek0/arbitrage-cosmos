import { assessCapitalTruth } from '../../../dist/capitalFoundation/contracts/index.js';
import {
  buildCapitalMandate,
  buildStagedPlan,
  createStagedPlanConfiguration,
} from '../../../dist/capitalFoundation/stages/index.js';

const INCREASE_GATES = ['OPERATOR_APPROVAL', 'MULTI_LEG_RISK', 'FRESH_ACCOUNT_TRUTH', 'FRESH_MARKET_EVIDENCE'];

function stage(stageName, sequence, amounts, nextStage) {
  const increasing = stageName === 'CONFIRM' || stageName === 'ADD';
  return {
    stage: stageName,
    sequence,
    maximumAdditionalExposure: amounts[0],
    maximumTotalExposure: amounts[1],
    reservationConsumption: amounts[2],
    prerequisites: increasing
      ? [{ code: `${stageName}_EVIDENCE`, required: true, evidenceMaximumAgeMs: 1_000, detail: 'fresh fixture evidence' }]
      : [],
    economicThesisConditions: increasing ? [`${stageName}_THESIS`] : [],
    invalidationConditions: increasing ? [`${stageName}_INVALID`] : [],
    maximumTimeInStageMs: 60_000,
    requiredApprovalActions: stageName === 'CONFIRM' ? ['OPEN'] : stageName === 'ADD' ? ['ADD'] : [],
    requiredFutureGates: increasing ? INCREASE_GATES : [],
    liquidityRequirement: increasing ? '1000' : null,
    maximumNakedLegAmount: increasing ? '5' : '0',
    maximumNakedLegDurationMs: increasing ? 5_000 : 0,
    stopAddingConditions: increasing ? [`${stageName}_STOP`] : [],
    allowedNextStages: nextStage === null ? [] : [nextStage],
    reductionConditions: stageName === 'REDUCE' ? ['REDUCTION_REQUIRED'] : [],
    cancellableBeforeEntry: true,
    nextStageConditions: nextStage === null ? [] : [{ targetStage: nextStage, conditions: [`${stageName}_TO_${nextStage}`] }],
    skipConditions: stageName === 'OBSERVE'
      ? [{ targetStage: 'CONFIRM', skippedStages: ['PROBE'], conditions: ['PROBE_NOT_REQUIRED'] }]
      : [],
    unenteredCancellationConditions: ['PROPOSAL_EXPIRED'],
  };
}

export function buildOfficialMandateFixture(nowMs) {
  const configuration = createStagedPlanConfiguration({
    sourceId: 'official-mandate-fixture',
    issuedAtMs: nowMs - 2_000,
    effectiveFromMs: nowMs - 1_000,
    effectiveUntilMs: nowMs + 500_000,
    maximumPlanExposure: { value: '100', minimum: '0', maximum: '200', unit: 'USDT' },
    maximumPlanDurationMs: { value: 300_000, minimum: 1, maximum: 500_000, unit: 'MILLISECONDS' },
    maximumStageDurationMs: { value: 60_000, minimum: 1, maximum: 120_000, unit: 'MILLISECONDS' },
    maximumEvidenceAgeMs: { value: 1_000, minimum: 1, maximum: 5_000, unit: 'MILLISECONDS' },
    maximumNakedLegAmount: { value: '5', minimum: '0', maximum: '10', unit: 'USDT' },
    maximumNakedLegDurationMs: { value: 5_000, minimum: 1, maximum: 10_000, unit: 'MILLISECONDS' },
  });
  const reservation = {
    id: 'reservation-official', allocationDecisionId: 'allocation-official', considerationId: 'consideration-official',
    amount: '100', consumedAmount: '0', valuationAsset: 'USDT', state: 'ACTIVE', createdAtMs: nowMs - 500,
    expiresAtMs: nowMs + 300_000, releasedAtMs: null, revision: 1, idempotencyKey: 'reservation:official',
  };
  const stages = [
    stage('OBSERVE', 0, ['0', '0', '0'], 'CONFIRM'),
    stage('CONFIRM', 1, ['40', '40', '40'], 'ADD'),
    stage('ADD', 2, ['60', '100', '60'], 'HOLD'),
    stage('HOLD', 3, ['0', '100', '0'], 'REDUCE'),
    stage('REDUCE', 4, ['0', '40', '0'], 'EXIT'),
    stage('EXIT', 5, ['0', '0', '0'], null),
  ];
  const planResult = buildStagedPlan({
    reservation, proposalIntakeDigest: 'proposal-intake-official', valuationAsset: 'USDT', configuration, stages,
    activeStage: 'OBSERVE', createdAtMs: nowMs, expiresAtMs: nowMs + 200_000, correlationId: 'plan-official',
  });
  if (!planResult.ok) throw new TypeError(`official plan fixture failed: ${planResult.failure.code}`);
  const plan = planResult.value;
  const proposal = {
    sourceProposalId: 'proposal-official', canonicalProposalId: 'proposal-official-canonical', sourceCorrelationId: 'proposal-official-correlation',
    strategy: 'BASIS', symbol: 'BTCUSDT', direction: 'long_spot_short_perp', sourceLifecycle: 'open', sourceRevision: null,
    sourceConfigRevision: null, createdAtMs: nowMs - 1_000, updatedAtMs: nowMs, expiresAtMs: nowMs + 250_000,
    intakeDigest: plan.proposalIntakeDigest,
  };
  const consideration = {
    id: reservation.considerationId, proposal, economics: { valuationAsset: 'USDT' }, evidenceTruth: 'COMPLETE',
    truth: assessCapitalTruth({
      source: { sourceTimeMs: nowMs - 10, receivedAtMs: nowMs - 5, maxAgeMs: 1_000,
        authority: 'SYNTHETIC_TEST', completeness: 'COMPLETE', sourceId: 'official-mandate-fixture' },
      evaluatedAtMs: nowMs, requiredValuePresent: true, revision: 'official-opportunity-truth-r1',
    }),
    evaluatedAtMs: nowMs, mode: 'MANUAL_ARMED', status: 'ELIGIBLE',
  };
  const mandateResult = buildCapitalMandate({
    consideration, allocationDecisionId: reservation.allocationDecisionId, reservation, plan, configuration,
    targetMaximumExposure: '100', createdAtMs: nowMs, expiresAtMs: nowMs + 150_000, correlationId: 'mandate-official',
  });
  if (!mandateResult.ok) throw new TypeError(`official mandate fixture failed: ${mandateResult.failure.code}`);
  const mandate = mandateResult.value;
  const approval = {
    id: 'approval-official', operatorIdentityReference: 'operator-official', proposalId: proposal.sourceProposalId,
    proposalRevision: null, proposalIntakeDigest: mandate.proposalIntakeDigest, mandateId: mandate.id,
    mandateRevision: mandate.revision, mandateDigest: mandate.digest, stagedPlanId: mandate.stagedPlanId,
    stagedPlanRevision: mandate.stagedPlanRevision, stagedPlanDigest: mandate.stagedPlanDigest, strategy: 'BASIS',
    symbols: ['BTCUSDT'], instruments: ['BTCUSDT:PERP', 'BTCUSDT:SPOT'], allowedActionClasses: ['ADD', 'OPEN', 'REDUCE'],
    maximumNotional: '100', valuationAsset: mandate.valuationAsset, mode: 'MANUAL_ARMED', configRevision: mandate.configRevision,
    issuedAtMs: nowMs + 1, expiresAtMs: nowMs + 100_000, revokedAtMs: null, revocationReasonReference: null,
    stageLimits: [{ stage: 'ADD', maximumExposure: '100' }], reasonReference: 'operator-reviewed-official',
    useScopeKey: 'approval:official',
  };
  return { configuration, reservation, plan, proposal, consideration, mandate, approval };
}
