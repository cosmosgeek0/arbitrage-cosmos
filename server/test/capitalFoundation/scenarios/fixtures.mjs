import {
  adaptBasisProposalToCapitalCandidate,
  adaptMarketIntelligenceEvidenceReference,
  adaptVolumeProposalToCapitalCandidate,
} from '../../../dist/capitalFoundation/scenarios/index.js';
import {
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  createSyntheticConservativeEconomicFactBinding,
  deriveActivePositionId,
  derivePositionThesisId,
} from '../../../dist/capitalFoundation/contracts/index.js';
import {
  deriveOpportunityEligibilityPolicyRevision,
  evaluateOpportunityEligibility,
} from '../../../dist/capitalFoundation/opportunities/index.js';
import {
  deriveCapitalBudgetPolicyRevision,
} from '../../../dist/capitalFoundation/budgets/index.js';
import {
  allocateCapital,
  deriveAllocationSizingAuthorityRevision,
} from '../../../dist/capitalFoundation/allocation/index.js';
import { planEconomicAction } from '../../../dist/capitalFoundation/actions/index.js';
import {
  composeEconomicReport,
  deriveEconomicAccountingPolicyRevision,
} from '../../../dist/capitalFoundation/economics/index.js';
import { projectActivePosition } from '../../../dist/capitalFoundation/positions/index.js';
import {
  deriveBasisSupervisionPolicyRevision,
  deriveCommonSupervisionPolicyRevision,
  deriveVolumeSupervisionPolicyRevision,
  superviseBasisPosition,
  superviseVolumePosition,
} from '../../../dist/capitalFoundation/supervision/index.js';
import { projectActiveCapitalTopology } from '../../../dist/capitalFoundation/topology/index.js';

export const NOW = 1_900_000_000_000;

export function truth(sourceId = 'capital.scenario', overrides = {}) {
  return assessCapitalTruth({
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
      ...(overrides.source ?? {}),
    },
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
    requiredValuePresent: overrides.requiredValuePresent ?? true,
    divergent: overrides.divergent ?? false,
    reasons: overrides.reasons ?? [],
    evidenceReferences: overrides.evidenceReferences ?? [],
    revision: overrides.revision ?? `${sourceId}-r1`,
  });
}

export function intelligenceTruth(overrides = {}) {
  return {
    schemaVersion: 'mi-scenario-1',
    producerVersion: 'mi-scenario-producer-1',
    configurationVersion: 'mi-config-1',
    featureVersion: 'mi-feature-1',
    authority: {
      kind: 'REPLAY_SUPPLIED',
      sourceId: 'mi.scenario',
      dataset: 'capital-scenario',
      endpointClass: 'INJECTED',
    },
    provenance: {
      sourceRecordIds: ['mi-scenario-record-1'],
      sourceSet: ['scenario'],
      transforms: ['reference-only'],
    },
    temporal: {
      sourceEventTimeMs: NOW - 100,
      sourceTransactionTimeMs: null,
      receivedTimeMs: NOW - 90,
      sequence: null,
    },
    freshness: {
      basis: 'SOURCE_EVENT_TIME',
      evaluatedAtMs: NOW,
      ageMs: 100,
      maxAgeMs: 1_000_000,
      state: 'FRESH',
    },
    completeness: {
      state: 'COMPLETE',
      observedFields: ['scenario'],
      missingFields: [],
      reasonCodes: [],
    },
    ...overrides,
  };
}

export function exactEconomics(overrides = {}, scopeOverrides = {}) {
  const values = {
    valuationAsset: 'USDT',
    requestedCapital: '100',
    expectedGrossEdge: '12',
    expectedNetEdge: '8',
    estimatedFees: '1',
    estimatedFunding: '0',
    estimatedBorrowCost: '0',
    estimatedSpreadCost: '1',
    estimatedSlippage: '1',
    estimatedLatencyCost: '0.25',
    estimatedAdverseSelectionCost: '0.5',
    estimatedRecoveryCost: '0.75',
    estimatedCapitalOpportunityCost: '1.5',
    liquidityCapacity: '1000',
    expectedBorrowScope: {
      accountId: 'synthetic-account', symbol: scopeOverrides.symbol ?? 'BTCUSDT',
      asset: (scopeOverrides.symbol ?? 'BTCUSDT').replace('USDT', ''),
      mode: 'CROSS_CLASSIC', permissionId: 'synthetic-permission',
    },
    exactSourceIds: ['scenario-exact-economics'],
    missingFields: [],
    ...overrides,
  };
  const fact = (kind, value, sourceId) => value === null ? null : createSyntheticConservativeEconomicFactBinding({
    kind,
    scope: {
      proposalId: scopeOverrides.proposalId ?? 'basis-proposal-basis-1',
      proposalRevision: null,
      proposalUpdatedAtMs: scopeOverrides.proposalUpdatedAtMs ?? NOW - 100,
      proposalConfigRevision: scopeOverrides.proposalConfigRevision ?? 'basis-config-1',
      correlationId: scopeOverrides.correlationId ?? 'basis-1:correlation',
      strategy: scopeOverrides.strategy ?? 'BASIS',
      symbol: scopeOverrides.symbol ?? 'BTCUSDT',
      instrumentIds: scopeOverrides.instrumentIds ?? ['BINANCE:SPOT:BTCUSDT', 'BINANCE:USD_M_PERPETUAL:BTCUSDT'],
      ownerRecordId: `${sourceId}-record`,
      ownerConfigRevision: scopeOverrides.proposalConfigRevision ?? 'basis-config-1',
    },
    borrowScope: kind === 'BORROW' ? {
      ...values.expectedBorrowScope,
      truthEvaluatedAtMs: scopeOverrides.proposalUpdatedAtMs ?? NOW - 100,
      truthExpiresAtMs: NOW + 900,
    } : null,
    value,
    unit: values.valuationAsset,
    source: {
      sourceTimeMs: NOW - 100,
      receivedAtMs: NOW - 90,
      maxAgeMs: 1_000_000,
      authority: 'SYNTHETIC_TEST',
      completeness: 'COMPLETE',
      sourceId,
    },
    ownerRevision: `${sourceId}-r1`,
    completeness: 'COMPLETE',
    evidenceIds: [`${sourceId}-e1`],
  });
  return {
    ...values,
    fundingFact: Object.hasOwn(overrides, 'fundingFact')
      ? overrides.fundingFact
      : fact('FUNDING', values.estimatedFunding, 'scenario-funding-fact'),
    borrowFact: Object.hasOwn(overrides, 'borrowFact')
      ? overrides.borrowFact
      : fact('BORROW', values.estimatedBorrowCost, 'scenario-borrow-fact'),
    capitalOpportunityFact: Object.hasOwn(overrides, 'capitalOpportunityFact')
      ? overrides.capitalOpportunityFact
      : fact('CAPITAL_OPPORTUNITY', values.estimatedCapitalOpportunityCost, 'scenario-capital-opportunity-fact'),
  };
}

function sourceStamp(sourceId, updatedAtMs = NOW - 100) {
  return {
    sourceTimeMs: updatedAtMs,
    receivedAtMs: updatedAtMs + 10,
    maxAgeMs: 1_000_000,
    authority: 'SYNTHETIC_TEST',
    completeness: 'COMPLETE',
    sourceId,
  };
}

export function proposalSeed(strategy = 'BASIS', overrides = {}) {
  const basis = strategy === 'BASIS';
  const key = overrides.key ?? (basis ? 'basis-1' : 'volume-1');
  const sourceId = overrides.sourceId ?? `${basis ? 'basis' : 'volume'}-proposal-${key}`;
  const symbol = overrides.symbol ?? (basis ? 'BTCUSDT' : 'ETHUSDT');
  const direction = overrides.direction ?? (basis ? 'long_spot_short_perp' : 'long');
  const status = overrides.status ?? 'open';
  const lifecycle = overrides.lifecycle ?? ({
    open: 'OPEN', updated: 'OPEN', expired: 'EXPIRED', rejected: 'REJECTED', approved_manual: 'CLOSED',
  })[status] ?? 'UNKNOWN';
  const createdAtMs = overrides.createdAtMs ?? NOW - 500;
  const updatedAtMs = overrides.updatedAtMs ?? NOW - 100;
  const expiresAtMs = Object.prototype.hasOwnProperty.call(overrides, 'expiresAtMs')
    ? overrides.expiresAtMs
    : NOW + 100_000;
  const configRevision = overrides.configRevision ?? `${basis ? 'basis' : 'volume'}-config-1`;
  const canonical = {
    kind: 'PROPOSAL',
    canonicalId: `cprop_${strategy.toLowerCase()}_${key}`,
    source: strategy,
    sourceId,
    symbol,
    direction,
    lifecycle,
    sourceLifecycle: status,
    observedAt: sourceStamp(`${strategy.toLowerCase()}.scenario`, updatedAtMs),
    expiresAtMs,
    configVersion: configRevision,
    ...(overrides.canonical ?? {}),
  };
  const metadata = {
    bindingId: `${key}:metadata`,
    correlationId: `${key}:correlation`,
    createdAtMs,
    updatedAtMs,
    truth: truth(`${key}.metadata`),
    ...(overrides.metadata ?? {}),
  };
  const common = {
    canonical,
    metadata,
    configuration: {
      bindingId: `${key}:configuration`,
      revision: configRevision,
      truth: truth(`${key}.configuration`),
      ...(overrides.configuration ?? {}),
    },
    expiration: {
      bindingId: `${key}:expiration`,
      expiresAtMs,
      truth: truth(`${key}.expiration`),
      ...(overrides.expiration ?? {}),
    },
    economics: exactEconomics(overrides.economics, {
      proposalId: sourceId,
      proposalUpdatedAtMs: updatedAtMs,
      proposalConfigRevision: configRevision,
      correlationId: `${key}:correlation`,
      strategy,
      symbol,
      instrumentIds: basis
        ? [`BINANCE:SPOT:${symbol}`, `BINANCE:USD_M_PERPETUAL:${symbol}`]
        : [`BINANCE:SPOT:${symbol}`],
    }),
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
  };
  if (basis) {
    const instruments = {
      strategy: 'BASIS',
      bindingId: `${key}:instruments`,
      spotInstrumentId: overrides.spotInstrumentId ?? `BINANCE:SPOT:${symbol}`,
      perpetualInstrumentId: overrides.perpetualInstrumentId ?? `BINANCE:USD_M_PERPETUAL:${symbol}`,
      truth: truth(`${key}.instruments`),
      ...(overrides.instruments ?? {}),
    };
    const source = {
      id: sourceId,
      correlationId: metadata.correlationId,
      strategy: 'basis',
      symbol,
      direction,
      createdTs: createdAtMs,
      updatedTs: updatedAtMs,
      status,
      invalidationSpec: { expiresTs: expiresAtMs },
      ...(overrides.source ?? {}),
    };
    return adaptBasisProposalToCapitalCandidate({ source, instruments, ...common });
  }
  const instruments = {
    strategy: 'VOLUME',
    bindingId: `${key}:instrument`,
    instrumentId: overrides.instrumentId ?? `BINANCE:SPOT:${symbol}`,
    truth: truth(`${key}.instrument`),
    ...(overrides.instruments ?? {}),
  };
  const source = {
    id: sourceId,
    correlationId: metadata.correlationId,
    strategy: 'volume_spike',
    symbol,
    direction,
    createdTs: createdAtMs,
    updatedTs: updatedAtMs,
    status,
    ...(overrides.source ?? {}),
  };
  return adaptVolumeProposalToCapitalCandidate({ source, instruments, ...common });
}

export function eligibilityPolicy(overrides = {}) {
  const authorityOverrides = overrides.authority ?? {};
  const draft = {
    authority: {
      revision: 'pending-content-address',
      sourceId: 'capital.scenario.eligibility-policy',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 5_000,
      effectiveUntilMs: NOW + 1_000_000,
      ...authorityOverrides,
      revision: 'pending-content-address',
    },
    acceptedProposalConfigRevisions: {
      BASIS: ['basis-config-1'],
      VOLUME: ['volume-config-1'],
      ...(overrides.acceptedProposalConfigRevisions ?? {}),
    },
    acceptedEvidenceConfigRevisions: {
      BASIS: ['mi-config-1'],
      VOLUME: ['mi-config-1'],
      ...(overrides.acceptedEvidenceConfigRevisions ?? {}),
    },
    evidenceRequirement: { BASIS: 'OPTIONAL', VOLUME: 'OPTIONAL', ...(overrides.evidenceRequirement ?? {}) },
    basisMode: overrides.basisMode ?? 'MANUAL_ARMED',
    volumeMode: overrides.volumeMode ?? 'ADVISORY',
  };
  return {
    ...draft,
    authority: {
      ...draft.authority,
      revision: deriveOpportunityEligibilityPolicyRevision(draft),
    },
  };
}

export function eligibilityCandidate(seed, overrides = {}) {
  return {
    intake: seed.intake,
    structure: seed.structure,
    requiredEvidenceIds: [],
    evidenceReferences: [],
    thesisReference: null,
    conflictScope: { exclusiveCapitalClaimIds: [] },
    ...overrides,
  };
}

export function evaluateSeeds(seeds, overrides = {}) {
  const candidates = overrides.candidates
    ?? seeds.map((seed) => eligibilityCandidate(seed));
  return evaluateOpportunityEligibility(
    candidates,
    overrides.policy ?? eligibilityPolicy(),
    overrides.nowMs ?? NOW,
  );
}

function exactBound(value, maximum = '1000000') {
  return { value, minimum: '0', maximum, unit: 'USDT' };
}

function integerBound(value, maximum, unit) {
  return { value, minimum: 0, maximum, unit };
}

export function budgetPolicy(overrides = {}) {
  const authorityOverride = overrides.authority ?? {};
  const draft = {
    authority: {
      revision: 'pending-content-address',
      sourceId: 'capital.scenario.budget-policy',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 5_000,
      effectiveUntilMs: NOW + 1_000_000,
      ...authorityOverride,
      revision: 'pending-content-address',
    },
    valuationAsset: 'USDT',
    portfolioGrossLimit: exactBound('1000'),
    portfolioNetLimit: exactBound('1000'),
    perStrategyLimits: { BASIS: exactBound('1000'), VOLUME: exactBound('1000') },
    perSymbolLimit: exactBound('1000'),
    perCorrelatedGroupLimit: exactBound('1000'),
    perVenueInstrumentLimit: exactBound('1000'),
    riskReductionReserve: exactBound('100'),
    maximumConcurrentPlans: integerBound(10, 100, 'COUNT'),
    maximumActivePositions: integerBound(10, 100, 'COUNT'),
    reservationTtlMs: integerBound(60_000, 600_000, 'MILLISECONDS'),
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'authority')),
  };
  const revision = deriveCapitalBudgetPolicyRevision(draft);
  return { ...draft, authority: { ...draft.authority, revision } };
}

export function budgetSnapshot(overrides = {}) {
  const entryCollateralAvailable = overrides.entryCollateralAvailable ?? '1000';
  const protectedRiskReductionReserve = overrides.protectedRiskReductionReserve ?? '100';
  const otherUnavailableCollateral = overrides.collateralPoolBinding?.otherUnavailableCollateral ?? '0';
  const currentConcurrentPlans = overrides.currentConcurrentPlans ?? 0;
  const currentActivePositions = overrides.currentActivePositions ?? 0;
  const commitments = overrides.commitments ?? [
    ...Array.from({ length: currentConcurrentPlans }, (_, index) => ({
      id: `scenario-plan-${index}`, capitalClaimKey: `scenario-plan-claim-${index}`, kind: 'STAGED_PLAN',
    })),
    ...Array.from({ length: currentActivePositions }, (_, index) => ({
      id: `scenario-position-${index}`, capitalClaimKey: `scenario-position-claim-${index}`, kind: 'ACTIVE_POSITION',
    })),
  ];
  return {
    valuationAsset: 'USDT',
    truth: truth('scenario.budget'),
    entryCollateralAvailable,
    protectedRiskReductionReserve,
    collateralPoolBinding: overrides.collateralPoolBinding ?? {
      sourcePoolId: 'scenario-account-collateral-pool',
      sourcePoolTotal: addExactDecimals(
        addExactDecimals(entryCollateralAvailable, protectedRiskReductionReserve),
        otherUnavailableCollateral,
      ),
      otherUnavailableCollateral,
    },
    marginHeadroomAvailable: '1000',
    grossExposureAndCommitments: '0',
    netDirectionalExposure: '0',
    strategyUse: [],
    symbolUse: [],
    correlatedGroupUse: [],
    venueInstrumentUse: [],
    currentConcurrentPlans,
    currentActivePositions,
    borrowCapacityByAsset: [{ key: 'GLOBAL_BORROW', amount: '10000' }],
    liquidityCapacityByKey: [{ key: 'GLOBAL_LIQUIDITY', amount: '10000' }],
    commitmentCoverage: {
      orders: 'COMPLETE', reservations: 'COMPLETE', plans: 'COMPLETE',
      partiallyExposedPositions: 'COMPLETE', activePositions: 'COMPLETE',
    },
    commitments,
    ...overrides,
  };
}

export function allocationCandidate(consideration, overrides = {}) {
  const basis = consideration.proposal.strategy === 'BASIS';
  const direction = consideration.proposal.direction;
  const economicDirection = direction === 'long' ? 'LONG'
    : direction === 'short' ? 'SHORT'
      : 'HEDGED';
  const requestedAmount = consideration.economics.requestedCapital ?? '0';
  const eligibilityPolicyRevision = overrides.eligibilityPolicyRevision
    ?? eligibilityPolicy().authority.revision;
  const sizingSourceId = overrides.sizingAuthority?.sourceId
    ?? 'capital.scenario.allocation-sizing';
  const draft = {
    consideration,
    considerationId: consideration.id,
    considerationDigest: capitalDigest(consideration),
    eligibilityPolicyRevision,
    sizingAuthority: { revision: 'pending-content-address', sourceId: sizingSourceId },
    eligibilityStatus: consideration.status,
    considerationMode: consideration.mode,
    truth: consideration.truth,
    strategy: consideration.proposal.strategy,
    valuationAsset: consideration.economics.valuationAsset,
    primarySymbol: consideration.proposal.symbol,
    economicDirection,
    requestedAmount,
    grossExposureIncrease: requestedAmount,
    netDirectionalExposureDelta: basis ? '0' : requestedAmount,
    collateralRequired: requestedAmount,
    marginRequired: requestedAmount,
    strategyRequirements: [{ key: consideration.proposal.strategy, amount: requestedAmount }],
    symbolRequirements: [{ key: consideration.proposal.symbol, amount: requestedAmount }],
    correlatedGroupRequirements: [{ key: 'GLOBAL_CORRELATED', amount: requestedAmount }],
    venueInstrumentRequirements: [{ key: 'GLOBAL_VENUE', amount: requestedAmount }],
    borrowRequired: consideration.legs.some((leg) => leg.borrowRequired === true),
    borrowRequirements: consideration.legs.some((leg) => leg.borrowRequired === true)
      ? [{ key: 'GLOBAL_BORROW', amount: requestedAmount }]
      : [],
    liquidityRequirements: [{ key: 'GLOBAL_LIQUIDITY', amount: requestedAmount }],
    conflictingConsiderationIds: consideration.conflictingConsiderationIds,
    ...overrides,
    sizingAuthority: { revision: 'pending-content-address', sourceId: sizingSourceId },
  };
  return {
    ...draft,
    sizingAuthority: {
      ...draft.sizingAuthority,
      revision: deriveAllocationSizingAuthorityRevision(draft),
    },
  };
}

export function allocationFor(considerations, overrides = {}) {
  const candidates = overrides.candidates
    ?? considerations.map((consideration) => allocationCandidate(consideration));
  const input = {
    policy: overrides.policy ?? budgetPolicy(),
    snapshot: overrides.snapshot ?? budgetSnapshot(),
    candidates,
    nowMs: overrides.nowMs ?? NOW,
  };
  return { input, result: allocateCapital(input) };
}

export function actionDecision(kind = 'HOLD', overrides = {}) {
  const common = {
    kind,
    why: ['scenario economic decision'],
    triggerCodes: ['SCENARIO_TRIGGER'],
    supportingEvidenceIds: ['scenario-evidence'],
    conflictingEvidenceIds: [],
    requiredFutureGates: [],
    blockingFacts: [],
    urgency: 'ELEVATED',
    hardDeadlineMs: NOW + 10_000,
    economicCostOfWaiting: '2',
    expectedCostOfActing: '1',
    invalidationConditions: ['position revision changes'],
  };
  const specific = kind === 'ADD_STAGE'
    ? {
        targetTotalExposure: '250', targetBaseQuantity: null, targetHedgeRatio: '1',
        authority: overrides.stageAuthorization,
      }
    : kind === 'REDUCE'
      ? {
          targetTotalExposure: '100', targetNetDirectionalExposure: '0',
          targetBaseQuantity: null, targetHedgeRatio: '1',
        }
      : kind === 'REQUEST_HEDGE'
        ? { targetQuoteDelta: '-20', targetBaseQuantity: null, targetHedgeRatio: '1' }
        : kind === 'NO_ACTION_UNKNOWN'
          ? { unknownReasonCodes: ['SCENARIO_UNKNOWN'] }
          : {};
  return { ...common, ...specific, ...overrides };
}

export function actionProjection(position, overrides = {}) {
  return {
    positionId: position.id,
    positionRevision: position.revision,
    thesisId: position.thesis.id,
    thesisRevision: position.thesis.revision,
    valuationAsset: position.legs[0]?.valuationAsset ?? 'USDT',
    currentTotalExposure: position.totalGrossExposure,
    currentNetDirectionalExposure: position.netDirectionalExposure,
    currentBaseQuantity: null,
    currentHedgeRatio: position.hedgeRatio,
    completeness: position.truth.completeness,
    truthReasonCodes: position.truth.reasons,
    activeStageAuthority: null,
    ...overrides,
  };
}

export function controlPosture(posture = 'OPEN', overrides = {}) {
  return {
    posture,
    truth: truth('scenario.control'),
    revision: `control-${posture}`,
    reasonCodes: posture === 'OPEN' ? [] : [posture],
    ...overrides,
  };
}

export function planIntent(position, kind = 'HOLD', overrides = {}) {
  const result = planEconomicAction({
    position: overrides.positionProjection ?? actionProjection(position),
    decision: overrides.decision ?? actionDecision(kind, overrides.decisionOverrides),
    controlPosture: overrides.controlPosture ?? controlPosture(),
    nowMs: overrides.nowMs ?? NOW,
    idempotencyKey: overrides.idempotencyKey ?? `scenario:${position.id}:${kind}`,
    correlationKey: overrides.correlationKey ?? `scenario:${position.id}`,
  });
  if (!result.ok) throw new Error(`planIntent ${kind} failed: ${result.failure.code}`);
  return result.value;
}

export function thesis(strategy = 'BASIS', key = 'incumbent', overrides = {}) {
  return {
    id: derivePositionThesisId({ strategy, key }),
    revision: 1,
    strategy,
    proposalId: overrides.proposalId ?? `${strategy.toLowerCase()}-proposal-${key}`,
    originalEvidenceIds: ['scenario-evidence'],
    intelligenceThesisPacketId: 'mi-thesis-scenario',
    openedAtMs: NOW - 10_000,
    expectedHorizonMs: 1_000_000,
    maximumHoldingHorizonMs: 2_000_000,
    targetConditions: ['target'],
    invalidationConditions: ['invalidated'],
    stopAddingConditions: ['stale'],
    configRevision: `${strategy.toLowerCase()}-config-1`,
    ...overrides,
  };
}

export function positionLeg(id, side, exposure = '100', overrides = {}) {
  return {
    id,
    instrumentId: id,
    symbol: overrides.symbol ?? 'BTCUSDT',
    side,
    quantity: exposure === '0' ? '0' : '1',
    quoteExposure: exposure,
    valuationAsset: 'USDT',
    externalLifecycle: exposure === '0' ? 'CANCELLED' : 'FILLED',
    truth: truth(`${id}.leg`),
    ...overrides,
  };
}

export function projectedPosition(strategy = 'BASIS', overrides = {}) {
  const key = overrides.key ?? `${strategy.toLowerCase()}-incumbent`;
  const legs = overrides.legs ?? (strategy === 'BASIS'
    ? [positionLeg(`${key}:spot`, 'LONG'), positionLeg(`${key}:perp`, 'SHORT')]
    : [positionLeg(`${key}:directional`, overrides.directionSide ?? 'LONG')]);
  const reconciliationStatus = overrides.reconciliationStatus ?? 'EXACT';
  const result = projectActivePosition({
    ...(overrides.id === undefined ? {} : { id: overrides.id }),
    revision: overrides.revision ?? 1,
    mandateId: overrides.mandateId ?? `mandate-${key}`,
    thesis: overrides.thesis ?? thesis(strategy, key,
      overrides.proposalId === undefined ? {} : { proposalId: overrides.proposalId }),
    sourceState: overrides.sourceState ?? 'ACTIVE',
    sourceCapitalLifecycle: overrides.sourceCapitalLifecycle ?? 'ACTIVE',
    legs,
    oneLegSinceMs: overrides.oneLegSinceMs ?? null,
    executionState: overrides.executionState === null ? null : {
      externalPlanId: `external-plan-${key}`,
      correlationId: `execution-correlation-${key}`,
      lifecycle: overrides.executionLifecycle ?? 'HEDGED_OPEN',
      observedAtMs: NOW - 50,
      sequence: 2,
      revision: 'exec-r2',
      truth: truth(`${key}.execution`),
      ...(overrides.executionState ?? {}),
    },
    reconciliationState: overrides.reconciliationState === null ? null : {
      externalPlanId: overrides.reconciliationExternalPlanId ?? `external-plan-${key}`,
      correlationId: `execution-correlation-${key}`,
      status: reconciliationStatus,
      observedAtMs: NOW - 40,
      sequence: 3,
      revision: 'recon-r3',
      reasonCodes: reconciliationStatus === 'EXACT' ? [] : ['SCENARIO_RECONCILIATION_ISSUE'],
      truth: truth(`${key}.reconciliation`, { divergent: reconciliationStatus === 'DIVERGED' }),
      ...(overrides.reconciliationState ?? {}),
    },
    outstandingActionIntentIds: overrides.outstandingActionIntentIds ?? [],
    openedAtMs: overrides.openedAtMs ?? NOW - 10_000,
    lastTransitionAtMs: overrides.lastTransitionAtMs ?? NOW - 1_000,
    truth: overrides.truth ?? truth(`${key}.position`),
    projectedAtMs: overrides.projectedAtMs ?? NOW,
  });
  return result;
}

function policyAuthority(name) {
  return {
    revision: `pending-${name}-policy`,
    sourceId: `capital.scenario.${name}-policy`,
    issuedAtMs: NOW - 10_000,
    effectiveFromMs: NOW - 5_000,
    effectiveUntilMs: NOW + 1_000_000,
  };
}

function supervisionExactBound(value, maximum = '1000000', unit = 'RATIO') {
  return { value, minimum: '0', maximum, unit };
}

function supervisionIntegerBound(value, maximum = 10_000_000, unit = 'MILLISECONDS') {
  return { value, minimum: 0, maximum, unit };
}

function commonSupervisionPolicy() {
  const draft = {
    authority: policyAuthority('common'), valuationAsset: 'USDT',
    targetHedgeRatio: supervisionExactBound('1', '2'),
    maximumHedgeRatioDrift: supervisionExactBound('0.05', '1'),
    maximumOneLegExposure: supervisionExactBound('50', '1000', 'USDT'),
    maximumOneLegDurationMs: supervisionIntegerBound(1_000),
    emergencyOneLegDurationMs: supervisionIntegerBound(2_000),
    minimumExitCapacity: supervisionExactBound('150', '10000', 'USDT'),
    minimumAvailableDepth: supervisionExactBound('150', '10000', 'USDT'),
    maximumExecutableSpreadCost: supervisionExactBound('5', '100', 'USDT'),
    maximumProjectedExitCost: supervisionExactBound('10', '100', 'USDT'),
    maximumTotalGrossExposure: supervisionExactBound('1000', '10000', 'USDT'),
    reductionTargetExposure: supervisionExactBound('100', '10000', 'USDT'),
    maximumOutstandingIntents: supervisionIntegerBound(2, 100, 'COUNT'),
  };
  return { ...draft, authority: { ...draft.authority, revision: deriveCommonSupervisionPolicyRevision(draft) } };
}

function basisSupervisionPolicy() {
  const draft = {
    authority: policyAuthority('basis'), minimumRemainingEdge: supervisionExactBound('1', '100'),
    minimumRemainingEdgeForAdd: supervisionExactBound('2', '100'),
    maximumAdverseBasisMove: supervisionExactBound('0.02', '1'),
    maximumAdverseFundingRate: supervisionExactBound('0.01', '1'),
    fundingExitLeadTimeMs: supervisionIntegerBound(60_000),
    maximumBorrowRate: supervisionExactBound('0.02', '1'),
    maximumHedgeDrift: supervisionExactBound('0.05', '1'),
    minimumLiquidationDistance: supervisionExactBound('2', '100'),
    minimumMarginDistance: supervisionExactBound('2', '100'),
    maximumLiquidityDeterioration: supervisionExactBound('0.5', '1'),
    requiredConvergingObservationsForAdd: supervisionIntegerBound(3, 10, 'COUNT'),
  };
  return { ...draft, authority: { ...draft.authority, revision: deriveBasisSupervisionPolicyRevision(draft) } };
}

function volumeSupervisionPolicy() {
  const draft = {
    authority: policyAuthority('volume'), minimumContinuationStrength: supervisionExactBound('0.5', '1'),
    minimumAccelerationStrengthForAdd: supervisionExactBound('0.6', '1'),
    maximumExhaustionStrength: supervisionExactBound('0.7', '1'),
    maximumReversalStrength: supervisionExactBound('0.6', '1'),
    maximumCrowdingStrength: supervisionExactBound('0.8', '1'),
    maximumLiquidityDeterioration: supervisionExactBound('0.5', '1'),
    requireSpotLeadershipForAdd: true, reduceOnPerpetualLeadership: true,
  };
  return { ...draft, authority: { ...draft.authority, revision: deriveVolumeSupervisionPolicyRevision(draft) } };
}

export function commonSupervision(position, overrides = {}) {
  const expectedLegs = overrides.expectedLegs ?? position.legs.map((leg) => ({
    instrumentId: leg.instrumentId,
    side: leg.side,
  }));
  return {
    position,
    expectedLegs,
    market: {
      executableSpreadCost: '1', availableDepth: '500', exitCapacity: '500', projectedExitCost: '2',
      truth: truth('scenario.market'), evidenceIds: ['market-evidence'], ...(overrides.market ?? {}),
    },
    costs: {
      accruedKnownCost: '3', projectedAdditionalCost: '2', truth: truth('scenario.costs'),
      sourceIds: ['scenario-cost-source'], ...(overrides.costs ?? {}),
    },
    thesisAssessment: {
      invalidated: false, targetReached: false, supportingEvidenceIds: ['scenario-support'],
      conflictingEvidenceIds: [], reasonCodes: [], truth: truth('scenario.thesis-assessment'),
      ...(overrides.thesisAssessment ?? {}),
    },
    controlPosture: overrides.controlPosture ?? controlPosture(),
    policy: overrides.policy ?? commonSupervisionPolicy(),
    activeStageAuthority: Object.prototype.hasOwnProperty.call(overrides, 'activeStageAuthority')
      ? overrides.activeStageAuthority
      : null,
    nextStageAuthority: Object.prototype.hasOwnProperty.call(overrides, 'nextStageAuthority')
      ? overrides.nextStageAuthority
      : null,
    economicCostOfWaiting: '4',
    expectedCostOfActing: '2',
    nowMs: overrides.nowMs ?? NOW,
  };
}

export function basisSupervisionInput(position, overrides = {}) {
  const facts = overrides.basis ?? {};
  return {
    common: commonSupervision(position, overrides.common ?? {}),
    basis: {
      entryExecutableBasis: '0.04', currentExecutableBasis: '0.01',
      convergencePath: [
        { executableBasis: '0.03', observedAtMs: NOW - 300, truth: truth('basis.path.1'), evidenceId: 'basis-path-1' },
        { executableBasis: '0.02', observedAtMs: NOW - 200, truth: truth('basis.path.2'), evidenceId: 'basis-path-2' },
        { executableBasis: '0.01', observedAtMs: NOW - 100, truth: truth('basis.path.3'), evidenceId: 'basis-path-3' },
      ],
      expectedRemainingEdgeAfterExitCosts: '10',
      funding: {
        rate: '0.0001', direction: 'PAID', nextFundingAtMs: NOW + 30_000, accruedFunding: '-0.1',
        truth: truth('basis.funding'), evidenceIds: ['basis-funding'], ...(facts.funding ?? {}),
      },
      borrow: {
        availability: 'AVAILABLE', rate: '0.001', accruedCost: '0.1', truth: truth('basis.borrow'),
        evidenceIds: ['basis-borrow'], ...(facts.borrow ?? {}),
      },
      hedgeDrift: '0', liquidationDistance: '10', marginDistance: '10',
      spotLiquidityDeterioration: '0.1', perpetualLiquidityDeterioration: '0.1',
      truth: truth('basis.facts'), evidenceIds: ['basis-facts'],
      ...Object.fromEntries(Object.entries(facts).filter(([key]) => !['funding', 'borrow'].includes(key))),
    },
    policy: overrides.policy ?? basisSupervisionPolicy(),
  };
}

function signal(state, strength = null, sourceId = 'volume.signal') {
  return { state, strength, truth: truth(sourceId), evidenceIds: [sourceId] };
}

export function volumeSupervisionInput(position, overrides = {}) {
  return {
    common: commonSupervision(position, overrides.common ?? {}),
    volume: {
      originalThesisStage: 'ACTIVE', continuation: signal('PRESENT', '0.9', 'volume.continuation'),
      acceleration: signal('PRESENT', '0.8', 'volume.acceleration'),
      exhaustion: signal('ABSENT', '0', 'volume.exhaustion'), reversal: signal('ABSENT', '0', 'volume.reversal'),
      leadership: 'SPOT', liquidityDeterioration: '0.1', crowding: signal('ABSENT', '0', 'volume.crowding'),
      funding: signal('UNKNOWN', null, 'volume.funding'), openInterest: signal('UNKNOWN', null, 'volume.oi'),
      falseFollowThrough: false, washLike: false, calibrationMode: 'MANUAL_ARMED',
      calibrationTruth: truth('volume.calibration'), truth: truth('volume.facts'),
      evidenceIds: ['volume-facts'], ...(overrides.volume ?? {}),
    },
    policy: overrides.policy ?? volumeSupervisionPolicy(),
  };
}

export function superviseBasis(position, overrides = {}) {
  return superviseBasisPosition(basisSupervisionInput(position, overrides));
}

export function superviseVolume(position, overrides = {}) {
  return superviseVolumePosition(volumeSupervisionInput(position, overrides));
}

export function economicComponent(id, kind, amount, overrides = {}) {
  const status = overrides.status ?? 'KNOWN';
  return {
    id, kind, status, amount,
    estimateRange: status === 'ESTIMATED' ? (overrides.estimateRange ?? { low: amount, high: amount }) : null,
    valuationAsset: overrides.valuationAsset ?? 'USDT',
    observedAtMs: status === 'MISSING' || status === 'NOT_APPLICABLE' ? null : NOW,
    sourceIds: overrides.sourceIds ?? [`source-${id}`],
    reasonCodes: overrides.reasonCodes ?? [],
    strategy: overrides.strategy ?? 'BASIS',
    opportunityId: overrides.opportunityId ?? 'scenario-opportunity',
    configRevision: overrides.configRevision ?? 'scenario-config',
    stage: overrides.stage ?? 'HOLD',
    symbol: overrides.symbol ?? 'BTCUSDT',
    legId: overrides.legId ?? null,
    correlationId: overrides.correlationId ?? 'scenario-economics',
  };
}

export function economicReport(components = null, overrides = {}) {
  const notApplicable = (id, kind) => economicComponent(id, kind, null, {
    status: 'NOT_APPLICABLE', sourceIds: [], reasonCodes: ['NOT_APPLICABLE_TO_SCENARIO'],
  });
  const raw = components ?? [
    economicComponent('scenario-mtm', 'MARK_TO_MARKET_LEG_PNL', '0'),
    notApplicable('scenario-realized', 'REALIZED_LEG_PNL'),
    notApplicable('scenario-fees', 'TRADING_COMMISSIONS'),
    notApplicable('scenario-entry-spread', 'ENTRY_SPREAD_COST'),
    notApplicable('scenario-exit-spread', 'EXIT_SPREAD_COST'),
    notApplicable('scenario-slippage', 'ESTIMATED_SLIPPAGE'),
    notApplicable('scenario-funding', 'FUNDING'),
    notApplicable('scenario-borrow', 'BORROW_INTEREST_AND_FEES'),
    notApplicable('scenario-one-leg', 'ONE_LEG_EXPOSURE'),
    notApplicable('scenario-conversion', 'CONVERSION_VALUATION'),
    notApplicable('scenario-recovery', 'OPERATIONAL_RECOVERY_COST'),
    economicComponent('scenario-residual', 'RESIDUAL_UNEXPLAINED', '0'),
  ];
  const scope = {
    kind: 'POSITION', id: overrides.positionId ?? 'scenario-position', strategy: overrides.strategy ?? 'BASIS',
    opportunityId: overrides.opportunityId ?? 'scenario-opportunity', configRevision: 'scenario-config',
    stage: 'HOLD', symbol: overrides.symbol ?? 'BTCUSDT', legId: null,
    correlationId: overrides.correlationId ?? 'scenario-economics',
  };
  const supplied = raw.map((component) => ({
    ...component,
    strategy: scope.strategy,
    opportunityId: scope.opportunityId,
    configRevision: scope.configRevision,
    stage: scope.stage,
    symbol: scope.symbol,
    correlationId: scope.correlationId,
  }));
  const policyOverrides = overrides.policy ?? {};
  const authorityOverrides = policyOverrides.authority ?? {};
  const policySemantics = {
    authority: {
      sourceId: 'capital.scenario.economic-policy',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 5_000,
      effectiveUntilMs: NOW + 1_000_000,
      ...authorityOverrides,
    },
    pricePnlBasis: policyOverrides.pricePnlBasis ?? 'LEG_PRICE',
    executionCostBasis: policyOverrides.executionCostBasis ?? 'DETAILED_SPREAD_SLIPPAGE',
    expectedComponentKinds: policyOverrides.expectedComponentKinds
      ?? [...new Set(supplied.map((component) => component.kind))],
  };
  const policy = {
    ...policySemantics,
    authority: {
      ...policySemantics.authority,
      revision: deriveEconomicAccountingPolicyRevision(policySemantics),
    },
  };
  return composeEconomicReport({
    scope,
    valuationAsset: overrides.valuationAsset ?? 'USDT',
    components: supplied,
    policy,
    evaluatedAtMs: overrides.evaluatedAtMs ?? NOW,
  });
}

function uniqueBy(values, key) {
  return [...new Map(values.filter(Boolean).map((value) => [key(value), value])).values()];
}

function topologyInput({
  considerations, decisions, positions, intents, reports, extras = {},
}) {
  const economics = reports.map((report, index) => ({
    id: `economics-record-${positions[index]?.id ?? index}`,
    positionId: positions[index]?.id ?? positions[0].id,
    revision: 1,
    attribution: report.attribution,
  }));
  const executionReferences = uniqueBy(positions.map((position) => position.executionReference), (item) => item.id);
  const reconciliationReferences = uniqueBy(positions.map((position) => position.reconciliationReference), (item) => item.id);
  const proposals = uniqueBy(considerations.map((consideration) => consideration.proposal), (item) => item.sourceProposalId);
  const supervisionDecisions = intents.map((intent) => ({
    id: `supervision-${intent.id}`,
    positionId: intent.positionId,
    status: intent.kind,
    truth: positions.find((position) => position.id === intent.positionId)?.truth ?? truth('scenario.supervision'),
    lastTransitionAtMs: intent.createdAtMs,
    reasonCodes: intent.why,
    actionIntentIds: [intent.id],
  }));
  return {
    evaluatedAtMs: NOW,
    proposals,
    evidence: [],
    considerations,
    allocationDecisions: decisions,
    reservations: [],
    mandates: [],
    stagedPlans: [],
    approvals: [],
    riskDecisions: [],
    executionReferences,
    positions,
    reconciliationReferences,
    supervisionDecisions,
    intents,
    economics,
    checkpoint: null,
    truthReferences: [],
    ...extras,
  };
}

export function terminalTuple({
  considerations,
  decisions,
  positions,
  intents,
  reports,
  topologyExtras = {},
}) {
  const topologyProjection = projectActiveCapitalTopology(topologyInput({
    considerations, decisions, positions, intents, reports, extras: topologyExtras,
  }));
  return Object.freeze({
    capitalDecision: Object.freeze([...decisions]),
    positionActionIntent: Object.freeze([...intents]),
    economicAttribution: Object.freeze(reports.map((report) => report.attribution)),
    topologyProjection,
  });
}

export function baseWorld(overrides = {}) {
  const seed = overrides.seed ?? proposalSeed('BASIS', { key: overrides.key ?? 'base' });
  const eligibility = overrides.eligibility ?? evaluateSeeds([seed]);
  const allocation = overrides.allocation ?? allocationFor(eligibility.considerations);
  const projected = overrides.projected ?? projectedPosition('BASIS', {
    key: overrides.positionKey ?? 'incumbent',
    proposalId: seed.intake.proposal.sourceProposalId,
  });
  const intent = overrides.intent ?? planIntent(projected.position, 'HOLD');
  const report = overrides.report ?? economicReport(null, {
    positionId: projected.position.id,
    opportunityId: eligibility.considerations[0].id,
  });
  return {
    seed,
    eligibility,
    allocation,
    projected,
    position: projected.position,
    intent,
    report,
  };
}

export function evidenceReference(kind = 'TRADE', overrides = {}) {
  return adaptMarketIntelligenceEvidenceReference({
    id: overrides.id ?? `scenario-evidence-${kind}`,
    kind,
    instrument: { instrumentId: overrides.instrumentId ?? 'BINANCE:SPOT:BTCUSDT' },
    truth: overrides.truth ?? intelligenceTruth(),
  });
}

export function deterministicPositionId(key) {
  return deriveActivePositionId({ scenario: key });
}
