import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateProposalOutcomes,
  recordProposalOutcome,
} from '../dist/foundation/calibration/index.js';
import {
  composeEconomicReport,
  deriveEconomicAccountingPolicyRevision,
} from '../dist/capitalFoundation/economics/index.js';
import {
  STRATEGY_DECAY_AXES,
  STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA,
  STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA_VERSION,
  deriveStrategyDecayMeasurementPolicyRevision,
  deriveStrategyDecayPolicyRevision,
  evaluateStrategyDecayGovernance,
  measureStrategyDecay,
} from '../dist/engine/decay/index.js';

const NOW = 1_800_000_000_000;
const WINDOW_MS = 1_000;
const BASELINE_WINDOW = Object.freeze({ startAtMs: NOW - 5_000, endAtMs: NOW - 4_000 });
const CURRENT_WINDOW = Object.freeze({ startAtMs: NOW - 3_000, endAtMs: NOW - 2_000 });
const CONFIG_VERSION = 'basis-config-decay-v1';
const DIRECTION = 'LONG_SPOT_SHORT_PERP';
const REQUIRED_ECONOMIC_KINDS = Object.freeze([
  'MARK_TO_MARKET_LEG_PNL',
  'REALIZED_LEG_PNL',
  'FUNDING',
  'BORROW_INTEREST_AND_FEES',
  'TRADING_COMMISSIONS',
  'ENTRY_SPREAD_COST',
  'EXIT_SPREAD_COST',
  'ESTIMATED_SLIPPAGE',
  'ONE_LEG_EXPOSURE',
  'CONVERSION_VALUATION',
  'OPERATIONAL_RECOVERY_COST',
  'RESIDUAL_UNEXPLAINED',
]);

function measurementPolicy(overrides = {}) {
  const semantics = {
    schema: STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA,
    schemaVersion: STRATEGY_DECAY_MEASUREMENT_POLICY_SCHEMA_VERSION,
    policyId: 'engine.strategy-decay.measurement.v1',
    windowDurationMs: WINDOW_MS,
    minimumWindowGapMs: 500,
    minimumCalibrationSamples: 4,
    minimumClosedOutcomeSamples: 4,
    minimumDirectCrowdingSamples: 4,
    calibrationGapIncreaseDegradedPpm: 50_000,
    calibrationGapIncreaseDeadPpm: 150_000,
    netValueDeclineDegradedPpm: 250_000,
    netValueDeclineDeadPpm: 500_000,
    competitorDisplacementDegradedPpm: 500_000,
    competitorDisplacementDeadPpm: 750_000,
    ...overrides,
  };
  return Object.freeze({
    ...semantics,
    policyRevision: deriveStrategyDecayMeasurementPolicyRevision(semantics),
  });
}

function binding(owner, suffix, authority = 'PRODUCTION') {
  return Object.freeze({
    owner,
    authority,
    sourceId: authority === 'UNKNOWN' ? null : `${owner.toLowerCase()}:owner`,
    revision: authority === 'UNKNOWN' ? null : `${owner.toLowerCase()}:revision-${suffix}`,
  });
}

function outcomeRecord(prefix, window, index, predictedProbabilityPpm, realizedSuccess) {
  const observationStart = window.startAtMs + index * 100;
  const observationEnd = observationStart + 50;
  const input = {
    canonicalProposalId: `cprop_decay_${prefix}_${index}`,
    planId: `plan_decay_${prefix}_${index}`,
    source: 'BASIS',
    strategySchema: 'basis.proposal-outcome.v1',
    configVersion: CONFIG_VERSION,
    direction: DIRECTION,
    resultUnit: 'USD_MICROS',
    proposalObservedAtMs: observationStart,
    observationWindow: { startAtMs: observationStart, endAtMs: observationEnd },
    status: 'COMPLETE',
    finalizedAtMs: observationEnd,
    predictedProbabilityPpm,
    realizedSuccess,
    grossResultMicrounits: realizedSuccess ? 1_000 : -1_000,
    feesMicrounits: 0,
    slippageMicrounits: 0,
    otherCostsMicrounits: 0,
    netResultMicrounits: realizedSuccess ? 1_000 : -1_000,
    fillRatioPpm: 1_000_000,
  };
  const result = recordProposalOutcome(input, {
    nowMs: NOW,
    correlationId: `cor_decay_calibration_${prefix}_${index}`,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.failure.message);
  return result.value;
}

function calibrationReport(prefix, window, predictions, outcomes) {
  const records = predictions.map((predicted, index) => outcomeRecord(prefix, window, index, predicted, outcomes[index]));
  const result = aggregateProposalOutcomes({
    nowMs: NOW,
    correlationId: `cor_decay_report_${prefix}`,
    cohort: {
      source: 'BASIS',
      strategySchema: 'basis.proposal-outcome.v1',
      configVersion: CONFIG_VERSION,
      direction: DIRECTION,
      resultUnit: 'USD_MICROS',
      observationHorizonMs: 50,
    },
    records,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.failure.message);
  return result.value;
}

function economicPolicy(_evaluatedAtMs) {
  const semantics = {
    authority: {
      sourceId: 'capital-policy-registry:closed-outcome-decay',
      issuedAtMs: NOW - 10_000,
      effectiveFromMs: NOW - 9_000,
      effectiveUntilMs: NOW + 1,
    },
    pricePnlBasis: 'LEG_PRICE',
    executionCostBasis: 'DETAILED_SPREAD_SLIPPAGE',
    expectedComponentKinds: REQUIRED_ECONOMIC_KINDS,
  };
  return Object.freeze({
    ...semantics,
    authority: Object.freeze({
      ...semantics.authority,
      revision: deriveEconomicAccountingPolicyRevision(semantics),
    }),
  });
}

function economicComponent(kind, scope, evaluatedAtMs, amount = null) {
  const applicable = kind === 'REALIZED_LEG_PNL';
  return Object.freeze({
    id: `economic-${scope.id}-${kind.toLowerCase()}`,
    kind,
    status: applicable ? 'KNOWN' : 'NOT_APPLICABLE',
    amount: applicable ? amount : null,
    estimateRange: null,
    valuationAsset: 'USDT',
    observedAtMs: applicable ? evaluatedAtMs : null,
    sourceIds: Object.freeze([`${applicable ? 'ledger-fill' : 'not-applicable'}-${scope.id}-${kind}`]),
    reasonCodes: Object.freeze([]),
    strategy: scope.strategy,
    opportunityId: scope.opportunityId,
    configRevision: scope.configRevision,
    stage: scope.stage,
    symbol: scope.symbol,
    legId: scope.legId,
    correlationId: scope.correlationId,
  });
}

function closedOutcomeReport(prefix, index, window, netValue) {
  const evaluatedAtMs = window.startAtMs + 500 + index;
  const scope = Object.freeze({
    kind: 'CLOSED_OUTCOME',
    id: `closed-outcome-${prefix}-${index}`,
    strategy: 'BASIS',
    opportunityId: `opportunity-${prefix}-${index}`,
    configRevision: CONFIG_VERSION,
    stage: 'CLOSED',
    symbol: 'BTCUSDT',
    legId: `leg-${prefix}-${index}`,
    correlationId: `cor-economic-${prefix}-${index}`,
  });
  const report = composeEconomicReport({
    scope,
    valuationAsset: 'USDT',
    components: REQUIRED_ECONOMIC_KINDS.map((kind) => economicComponent(kind, scope, evaluatedAtMs, netValue)),
    policy: economicPolicy(evaluatedAtMs),
    evaluatedAtMs,
  });
  assert.equal(report.accountingStatus, 'COMPLETE');
  assert.equal(report.accountingConfidence, 'HIGH');
  assert.equal(report.identity.proven, true);
  return report;
}

function evidenceWindow(prefix, window, options = {}) {
  const authority = options.authority ?? 'PRODUCTION';
  const predictions = options.predictions ?? [500_000, 500_000, 500_000, 500_000];
  const outcomes = options.outcomes ?? [true, true, false, false];
  const nets = options.netValues ?? ['100', '100', '100', '100'];
  const displaced = options.displaced ?? 1;
  return Object.freeze({
    window,
    calibration: Object.freeze({
      binding: binding('FOUNDATION_CALIBRATION', prefix, authority),
      report: options.calibrationReport ?? calibrationReport(prefix, window, predictions, outcomes),
    }),
    closedOutcomes: Object.freeze({
      binding: binding('CAPITAL_CLOSED_OUTCOME', prefix, authority),
      reports: Object.freeze(options.reports ?? nets.map((net, index) => closedOutcomeReport(prefix, index, window, net))),
    }),
    directCrowding: options.directCrowding === null ? null : Object.freeze({
      binding: binding('ENGINE_DIRECT_CROWDING', prefix, authority),
      eligibleOpportunityCount: 4,
      competitorDisplacedOpportunityCount: displaced,
      observationIds: Object.freeze(options.observationIds ?? [0, 1, 2, 3].map((index) => `crowding-observation-${prefix}-${index}`)),
    }),
  });
}

function input(overrides = {}) {
  return {
    policy: measurementPolicy(),
    strategy: 'BASIS',
    configVersion: CONFIG_VERSION,
    direction: DIRECTION,
    evaluatedAtMs: NOW,
    baseline: evidenceWindow('baseline', BASELINE_WINDOW),
    current: evidenceWindow('current', CURRENT_WINDOW, { netValues: ['90', '90', '90', '90'] }),
    ...overrides,
  };
}

function measured(candidate) {
  const result = measureStrategyDecay(candidate);
  assert.equal(result.ok, true, result.ok ? '' : result.reasonCodes.join(','));
  return result.measurement;
}

test('canonical Foundation calibration and Capital CLOSED_OUTCOME corpora produce all named stable axes', () => {
  const measurement = measured(input());
  assert.deepEqual(measurement.axes.map((axis) => axis.axis), STRATEGY_DECAY_AXES);
  assert.deepEqual(measurement.axes.map((axis) => axis.state), ['STABLE', 'STABLE', 'STABLE']);
  assert.equal(measurement.state, 'STABLE');
  assert.equal(measurement.evidenceAuthority, 'PRODUCTION');
  assert.ok(measurement.reasonCodes.includes('CHRONOLOGICAL_NON_OVERLAP_PROVEN'));
  assert.match(measurement.measurementId, /^decaymeas_[a-f0-9]{32}$/);
});

test('calibration failure, closed-outcome value collapse, and direct crowding are independently named DEAD axes', () => {
  const current = evidenceWindow('dead-current', CURRENT_WINDOW, {
    predictions: [1_000_000, 1_000_000, 1_000_000, 1_000_000],
    outcomes: [false, false, false, false],
    netValues: ['40', '40', '40', '40'],
    displaced: 4,
  });
  const measurement = measured(input({ current }));
  assert.deepEqual(measurement.axes.map((axis) => axis.state), ['DEAD', 'DEAD', 'DEAD']);
  assert.equal(measurement.state, 'DEAD');
  assert.ok(measurement.reasonCodes.includes('CALIBRATION_RELIABILITY_DEAD'));
  assert.ok(measurement.reasonCodes.includes('CLOSED_OUTCOME_NET_VALUE_DEAD'));
  assert.ok(measurement.reasonCodes.includes('DIRECT_CROWDING_DEAD'));

  const governanceSemantics = {
    policyId: 'engine.strategy-decay.governance.v1',
    reduceAfterConsecutiveDegradedWindows: 1,
    disableAfterConsecutiveDeadWindows: 2,
    retireAfterConsecutiveDeadWindows: 3,
    maximumRecentDecisions: 8,
  };
  const governed = evaluateStrategyDecayGovernance({
    policy: { ...governanceSemantics, policyRevision: deriveStrategyDecayPolicyRevision(governanceSemantics) },
    measurement,
    previousState: null,
  });
  assert.equal(governed.ok, true);
  assert.equal(governed.decision.kind, 'REDUCE');
  assert.equal(governed.decision.researchState, 'PENDING_REVIEW');
});

test('missing direct production crowding remains UNKNOWN and can only HOLD_UNKNOWN', () => {
  const baseline = evidenceWindow('missing-direct-base', BASELINE_WINDOW, { directCrowding: null });
  const current = evidenceWindow('missing-direct-current', CURRENT_WINDOW, { directCrowding: null });
  const measurement = measured(input({ baseline, current }));
  assert.equal(measurement.state, 'UNKNOWN');
  assert.equal(measurement.evidenceAuthority, 'UNKNOWN');
  assert.equal(measurement.axes[2].state, 'UNKNOWN');
  assert.deepEqual(measurement.axes[2].reasonCodes, ['DIRECT_CROWDING_PRODUCTION_EVIDENCE_UNAVAILABLE']);

  const governanceSemantics = {
    policyId: 'engine.strategy-decay.governance.v1',
    reduceAfterConsecutiveDegradedWindows: 1,
    disableAfterConsecutiveDeadWindows: 2,
    retireAfterConsecutiveDeadWindows: 3,
    maximumRecentDecisions: 8,
  };
  const governed = evaluateStrategyDecayGovernance({
    policy: { ...governanceSemantics, policyRevision: deriveStrategyDecayPolicyRevision(governanceSemantics) },
    measurement,
    previousState: null,
  });
  assert.equal(governed.ok, true);
  assert.equal(governed.decision.kind, 'HOLD_UNKNOWN');
});

test('replay-only evidence, insufficient samples, and overlapping calibration IDs never become production decay truth', () => {
  const replay = measured(input({
    baseline: evidenceWindow('replay-base', BASELINE_WINDOW, { authority: 'RECORDED_REPLAY' }),
    current: evidenceWindow('replay-current', CURRENT_WINDOW, { authority: 'RECORDED_REPLAY' }),
  }));
  assert.equal(replay.evidenceAuthority, 'RECORDED_REPLAY');
  assert.equal(replay.state, 'UNKNOWN');
  assert.ok(replay.axes.every((axis) => axis.state === 'UNKNOWN'));

  const insufficient = measured(input({ policy: measurementPolicy({ minimumCalibrationSamples: 5 }) }));
  assert.equal(insufficient.state, 'UNKNOWN');
  assert.equal(insufficient.axes[0].state, 'UNKNOWN');

  const shared = calibrationReport('shared', BASELINE_WINDOW, [500_000, 500_000, 500_000, 500_000], [true, true, false, false]);
  const baseline = evidenceWindow('overlap-base', BASELINE_WINDOW, { calibrationReport: shared });
  const current = evidenceWindow('overlap-current', CURRENT_WINDOW, { calibrationReport: shared });
  const overlapping = measured(input({ baseline, current }));
  assert.equal(overlapping.axes[0].state, 'UNKNOWN');
  assert.deepEqual(overlapping.axes[0].reasonCodes, ['CALIBRATION_SAMPLE_OVERLAP']);
});

test('self-mutating calibration and non-CLOSED_OUTCOME Capital scope are excluded from trusted production corpora', () => {
  const honestCurrent = evidenceWindow('trust-current', CURRENT_WINDOW);
  const mutableCalibration = {
    ...honestCurrent.calibration.report,
    automaticStrategyMutation: true,
  };
  const wrongScope = {
    ...honestCurrent.closedOutcomes.reports[0],
    scope: {
      ...honestCurrent.closedOutcomes.reports[0].scope,
      kind: 'POSITION',
    },
  };
  const current = {
    ...honestCurrent,
    calibration: {
      ...honestCurrent.calibration,
      report: mutableCalibration,
    },
    closedOutcomes: {
      ...honestCurrent.closedOutcomes,
      reports: [wrongScope, ...honestCurrent.closedOutcomes.reports.slice(1)],
    },
  };
  const measurement = measured(input({ current }));
  assert.equal(measurement.state, 'UNKNOWN');
  assert.equal(measurement.axes[0].state, 'UNKNOWN');
  assert.equal(measurement.axes[1].state, 'UNKNOWN');
  assert.deepEqual(measurement.axes[0].reasonCodes, ['CALIBRATION_PRODUCTION_CORPUS_UNAVAILABLE']);
  assert.deepEqual(measurement.axes[1].reasonCodes, ['CAPITAL_CLOSED_OUTCOME_PRODUCTION_CORPUS_UNAVAILABLE']);
});

test('overlapping time windows and hostile accessor or Proxy inputs fail before evidence evaluation', () => {
  const overlappingWindow = Object.freeze({ startAtMs: NOW - 4_500, endAtMs: NOW - 3_500 });
  const overlap = measureStrategyDecay(input({
    current: evidenceWindow('time-overlap', overlappingWindow),
  }));
  assert.deepEqual(overlap, { ok: false, reasonCodes: ['MEASUREMENT_WINDOWS_OVERLAP_OR_GAP_INSUFFICIENT'] });

  let reads = 0;
  const hostile = input();
  Object.defineProperty(hostile, 'current', {
    enumerable: true,
    get() { reads += 1; throw new Error('must not run'); },
  });
  assert.deepEqual(measureStrategyDecay(hostile), {
    ok: false,
    reasonCodes: ['MEASUREMENT_INPUT_UNSAFE_OR_INVALID'],
  });
  assert.equal(reads, 0);
  const proxy = new Proxy({}, { ownKeys() { throw new Error('hostile proxy'); } });
  assert.deepEqual(measureStrategyDecay(proxy), {
    ok: false,
    reasonCodes: ['MEASUREMENT_INPUT_UNSAFE_OR_INVALID'],
  });
});

test('measurement is deterministic and corpus order cannot change its ID or verdict', () => {
  const firstInput = input();
  const first = measured(firstInput);
  const second = measured(firstInput);
  assert.deepEqual(second, first);
  const reorderedCurrent = {
    ...firstInput.current,
    closedOutcomes: {
      ...firstInput.current.closedOutcomes,
      reports: [...firstInput.current.closedOutcomes.reports].reverse(),
    },
    directCrowding: {
      ...firstInput.current.directCrowding,
      observationIds: [...firstInput.current.directCrowding.observationIds].reverse(),
    },
  };
  const reordered = measured({ ...firstInput, current: reorderedCurrent });
  assert.deepEqual(reordered, first);

  const changedPolicy = measured({
    ...firstInput,
    policy: measurementPolicy({ calibrationGapIncreaseDegradedPpm: 60_000 }),
  });
  assert.deepEqual(changedPolicy.axes, first.axes);
  assert.notEqual(changedPolicy.measurementId, first.measurementId);

  const reboundCurrent = {
    ...firstInput.current,
    directCrowding: {
      ...firstInput.current.directCrowding,
      binding: {
        ...firstInput.current.directCrowding.binding,
        revision: 'engine_direct_crowding:revision-current-rebound',
      },
    },
  };
  const rebound = measured({ ...firstInput, current: reboundCurrent });
  assert.deepEqual(rebound.axes.map((axis) => axis.state), first.axes.map((axis) => axis.state));
  assert.notEqual(rebound.measurementId, first.measurementId);
});
