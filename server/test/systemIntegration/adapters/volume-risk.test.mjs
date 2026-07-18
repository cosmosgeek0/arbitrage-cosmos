import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  createProductionSystemIntegrationPorts,
  createProductionVolumeRiskPort,
} from '../../../dist/systemIntegration/production/index.js';
import { deriveRiskIntentDigest } from '../../../dist/foundation/risk/index.js';

const NOW = 1_900_000_000_000;

class ManualClock {
  constructor(now = NOW) { this.now = now; }
  nowMs() { return this.now; }
}

function proposalCut(overrides = {}) {
  return {
    proposalId: 'vp-r57-source',
    proposalRevision: 3,
    proposalDigest: `vprop_${'a'.repeat(64)}`,
    configurationRevision: `vcfg_${'c'.repeat(64)}`,
    correlationId: 'volume-correlation-r57',
    symbol: 'BTCUSDT',
    direction: 'long',
    featureObservedAtMs: NOW - 100,
    updatedTs: NOW - 100,
    expiresAtMs: NOW + 10_000,
    ...overrides,
  };
}

function policy() {
  return {
    verdictTtlMs: 5_000,
    minEvidenceAuthority: 'SYNTHETIC_TEST',
    maxSpotPerpSkewMs: 50,
    minLegNotionalUsd: 10,
    maxLegNotionalUsd: 200,
    maxGrossNotionalUsd: 400,
    maxHedgeRatioDeviationPct: 1,
    maxResidualDeltaUsd: 1,
    maxNakedDurationMs: 5_000,
    minNetEdgePct: 0.2,
    maxSpreadPct: 0.1,
    minTopDepthUsd: 1_000,
    maxSlippagePct: 0.1,
    marginHeadroomBufferPct: 10,
    minLiquidationDistancePct: 20,
    maxLiquidationReferenceDriftPct: 1,
    maxBorrowHourlyRatePct: 0.5,
    maxDailyLossUsd: 1_000,
    maxDailyNotionalUsd: 10_000,
    maxOpenOrdersPerSymbol: 5,
    maxTotalOpenOrders: 10,
    cooldownMs: 1_000,
  };
}

function riskEvidence(binding, overrides = {}) {
  return {
    binding,
    intent: {
      accountId: 'account-r57',
      legs: [
        {
          legKey: 'SPOT_BUY', venue: 'BINANCE_SPOT', symbol: binding.symbol,
          positionBucket: 'SPOT_CASH', side: 'BUY', intendedPrice: 100,
          intendedQty: 1, requiredPermission: 'SPOT', estimatedRequiredMarginUsd: 0,
        },
        {
          legKey: 'PERP_SELL', venue: 'BINANCE_USDM', symbol: binding.symbol,
          positionBucket: 'USDM_ONE_WAY', side: 'SELL', intendedPrice: 100,
          intendedQty: 1, requiredPermission: 'FUTURES', estimatedRequiredMarginUsd: 100,
        },
      ],
      declaredMaxNakedDurationMs: 1_000,
      estimatedRequiredMarginUsd: 100,
      requiredBorrowUsd: 0,
    },
    approval: null,
    killSwitch: null,
    market: null,
    account: null,
    borrow: null,
    existingPlans: null,
    cooldown: null,
    policy: policy(),
    ...overrides,
  };
}

function digestIntent(requiredBorrowUsd) {
  return {
    planId: `plan_${'1'.repeat(16)}`,
    accountId: 'account-r57',
    proposalRef: `cprop_${'2'.repeat(16)}`,
    riskClass: 'RISK_INCREASING',
    legs: [
      {
        legKey: 'SPOT_BUY', venue: 'BINANCE_SPOT', symbol: 'BTCUSDT',
        positionBucket: 'SPOT_CASH', side: 'BUY', intendedPrice: 100,
        intendedQty: 1, requiredPermission: 'SPOT', estimatedRequiredMarginUsd: 0,
      },
      {
        legKey: 'PERP_SELL', venue: 'BINANCE_USDM', symbol: 'BTCUSDT',
        positionBucket: 'USDM_ONE_WAY', side: 'SELL', intendedPrice: 100,
        intendedQty: 1, requiredPermission: 'FUTURES', estimatedRequiredMarginUsd: 100,
      },
    ],
    declaredMaxNakedDurationMs: 1_000,
    estimatedRequiredMarginUsd: 100,
    requiredBorrowUsd,
  };
}

function runtime(cut = proposalCut()) {
  const state = { cut, reads: 0, records: [], forceReject: false };
  return {
    state,
    value: {
      readProposalRiskCut(proposalId) {
        state.reads += 1;
        return state.cut?.proposalId === proposalId ? structuredClone(state.cut) : null;
      },
      recordFoundationRiskResult(input) {
        state.records.push(structuredClone(input));
        if (state.forceReject || state.cut === null) return false;
        return input.expectedProposalId === state.cut.proposalId
          && input.expectedProposalRevision === state.cut.proposalRevision
          && input.expectedProposalDigest === state.cut.proposalDigest
          && input.expectedConfigurationRevision === state.cut.configurationRevision
          && input.expectedCorrelationId === state.cut.correlationId;
      },
    },
  };
}

function factory(owner = null, volumeRiskRuntime = runtime()) {
  const market = {
    feeds: {}, pairCount: 0,
    async init() {}, start() {}, stop() {}, allRows() { return []; },
    priceUpdatedAt() { return null; }, markEventTimestamp() { return null; },
  };
  const basis = {
    async start() {}, stop() {}, setIntakePaused() { return true; }, intakePaused() { return false; },
    connectionStatus() { return { running: false, lastBookTs: null, lastMarkTs: null, lastError: null }; },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
  };
  const volume = {
    ...volumeRiskRuntime.value,
    async start() {}, stop() {}, setIntakePaused() { return true; }, intakePaused() { return false; },
    connectionStatus() {
      return {
        running: false, streamState: 'starting', streamConnections: 0,
        openConnections: 0, lastBookTs: null, lastTradeTs: null,
      };
    },
    integrationSnapshot() { return { lastTickTs: null, decisions: [], proposals: [] }; },
  };
  return {
    ports: createProductionSystemIntegrationPorts({
      clock: new ManualClock(), market, basis, volume, volumeRiskEvidenceOwner: owner,
    }),
    volumeRiskRuntime,
  };
}

test('real production factory mounts an honest NOT_CONFIGURED Volume risk callsite', () => {
  const built = factory();
  const result = built.ports.volumeRisk.evaluateAndAttach('vp-r57-source');
  assert.equal(result.state, 'NOT_CONFIGURED');
  assert.equal(built.volumeRiskRuntime.state.reads, 0);
  assert.equal(built.volumeRiskRuntime.state.records.length, 0);
});

test('configured callsite invokes Foundation risk once and attaches the exact blocked verdict', () => {
  let ownerReads = 0;
  const owner = {
    readRiskEvidence(binding) {
      ownerReads += 1;
      return riskEvidence(binding);
    },
  };
  const built = factory(owner);
  const result = built.ports.volumeRisk.evaluateAndAttach('vp-r57-source');
  assert.equal(result.state, 'EVALUATED');
  assert.equal(result.verdict.allowed, false);
  assert.ok(result.verdict.checks.length > 20);
  assert.ok(result.verdict.blockingCodes.includes('APPROVAL_PRESENT'));
  assert.match(result.verdictDigest, /^riskv_[0-9a-f]{32}$/);
  assert.equal(ownerReads, 1);
  assert.equal(built.volumeRiskRuntime.state.reads, 1);
  assert.equal(built.volumeRiskRuntime.state.records.length, 1);
  const recorded = built.volumeRiskRuntime.state.records[0];
  assert.equal(recorded.expectedProposalRevision, 3);
  assert.equal(recorded.verdictDigest, result.verdictDigest);
  assert.equal(recorded.verdict.allowed, false);
});

test('mismatched or throwing evidence fails closed without a Volume mutation', () => {
  const mismatchRuntime = runtime();
  const mismatch = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: mismatchRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        return riskEvidence({ ...binding, proposalRevision: binding.proposalRevision + 1 });
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(mismatch.state, 'INPUT_REJECTED');
  assert.equal(mismatchRuntime.state.records.length, 0);

  const throwingRuntime = runtime();
  const throwing = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: throwingRuntime.value,
    owner: { readRiskEvidence() { throw new Error('private detail'); } },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(throwing.state, 'INPUT_REJECTED');
  assert.deepEqual(throwing.reasonCodes, ['VOLUME_RISK_EVIDENCE_READ_FAILED']);
  assert.equal(throwingRuntime.state.records.length, 0);

  let proxyTraps = 0;
  const hostileProxy = (target) => new Proxy(target, {
    get() { proxyTraps += 1; throw new Error('risk evidence proxy get must not run'); },
    getPrototypeOf() { proxyTraps += 1; throw new Error('risk evidence prototype trap must not run'); },
    ownKeys() { proxyTraps += 1; throw new Error('risk evidence key trap must not run'); },
    getOwnPropertyDescriptor() { proxyTraps += 1; throw new Error('risk evidence descriptor trap must not run'); },
  });
  const proxyRuntime = runtime();
  const proxyResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: proxyRuntime.value,
    owner: { readRiskEvidence(binding) { return hostileProxy(riskEvidence(binding)); } },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(proxyResult.state, 'INPUT_REJECTED');
  assert.equal(proxyRuntime.state.records.length, 0);
  assert.equal(proxyTraps, 0);

  let getterReads = 0;
  const accessorRuntime = runtime();
  const accessorResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: accessorRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        const value = riskEvidence(binding);
        const intent = { ...value.intent };
        Object.defineProperty(intent, 'legs', {
          enumerable: true,
          get() { getterReads += 1; throw new Error('risk evidence getter must not run'); },
        });
        return { ...value, intent };
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(accessorResult.state, 'INPUT_REJECTED');
  assert.equal(accessorRuntime.state.records.length, 0);
  assert.equal(getterReads, 0);

  const legProxyRuntime = runtime();
  const legProxyResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: legProxyRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        const value = riskEvidence(binding);
        return {
          ...value,
          intent: {
            ...value.intent,
            legs: [hostileProxy(value.intent.legs[0]), value.intent.legs[1]],
          },
        };
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(legProxyResult.state, 'INPUT_REJECTED');
  assert.equal(legProxyRuntime.state.records.length, 0);
  assert.equal(proxyTraps, 0);

  const sharedTimestampRuntime = runtime();
  const sharedTimestampResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: sharedTimestampRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        const observedAt = Object.freeze({
          sourceTimeMs: NOW - 10,
          receivedAtMs: NOW - 5,
          maxAgeMs: 1_000,
          authority: 'SYNTHETIC_TEST',
          completeness: 'COMPLETE',
          sourceId: 'shared.r57.owner-cut',
        });
        return riskEvidence(binding, {
          killSwitch: {
            accountId: 'account-r57',
            engaged: false,
            observedAt,
            reason: null,
          },
          cooldown: {
            accountId: 'account-r57',
            symbols: [binding.symbol],
            lastEntryAtMs: null,
            observedAt,
          },
        });
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(sharedTimestampResult.state, 'EVALUATED');
  assert.equal(sharedTimestampRuntime.state.records.length, 1);

  const cycleRuntime = runtime();
  const cycleResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: cycleRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        const value = riskEvidence(binding);
        value.policy.cycle = value.policy;
        return value;
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(cycleResult.state, 'INPUT_REJECTED');
  assert.equal(cycleRuntime.state.records.length, 0);

  const previousIntendedQtyDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'intendedQty');
  const missingLegQuantityEvidence = (binding) => {
    const value = riskEvidence(binding);
    return {
      ...value,
      intent: {
        ...value.intent,
        legs: value.intent.legs.map((leg) => {
          const withoutQuantity = { ...leg };
          delete withoutQuantity.intendedQty;
          return withoutQuantity;
        }),
      },
    };
  };
  let inheritedQuantityReads = 0;
  const inheritedQuantityGetterRuntime = runtime();
  let inheritedQuantityGetterResult;
  try {
    Object.defineProperty(Object.prototype, 'intendedQty', {
      configurable: true,
      get() {
        inheritedQuantityReads += 1;
        return 1;
      },
    });
    inheritedQuantityGetterResult = createProductionVolumeRiskPort({
      clock: new ManualClock(),
      runtime: inheritedQuantityGetterRuntime.value,
      owner: { readRiskEvidence: missingLegQuantityEvidence },
    }).evaluateAndAttach('vp-r57-source');
  } finally {
    if (previousIntendedQtyDescriptor === undefined) delete Object.prototype.intendedQty;
    else Object.defineProperty(Object.prototype, 'intendedQty', previousIntendedQtyDescriptor);
  }
  assert.equal(inheritedQuantityGetterResult.state, 'INPUT_REJECTED');
  assert.equal(inheritedQuantityGetterRuntime.state.records.length, 0);
  assert.equal(inheritedQuantityReads, 0);

  const inheritedQuantityValueRuntime = runtime();
  let inheritedQuantityValueResult;
  try {
    Object.defineProperty(Object.prototype, 'intendedQty', {
      configurable: true,
      value: 1,
    });
    inheritedQuantityValueResult = createProductionVolumeRiskPort({
      clock: new ManualClock(),
      runtime: inheritedQuantityValueRuntime.value,
      owner: { readRiskEvidence: missingLegQuantityEvidence },
    }).evaluateAndAttach('vp-r57-source');
  } finally {
    if (previousIntendedQtyDescriptor === undefined) delete Object.prototype.intendedQty;
    else Object.defineProperty(Object.prototype, 'intendedQty', previousIntendedQtyDescriptor);
  }
  assert.equal(inheritedQuantityValueResult.state, 'INPUT_REJECTED');
  assert.equal(inheritedQuantityValueRuntime.state.records.length, 0);

  const pollutionRuntime = runtime();
  const pollutionResult = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: pollutionRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        const value = riskEvidence(binding);
        const pollutedPolicy = { ...value.policy };
        Object.defineProperty(pollutedPolicy, '__proto__', {
          enumerable: true,
          value: { verdictTtlMs: 1 },
        });
        return { ...value, policy: pollutedPolicy };
      },
    },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(pollutionResult.state, 'INPUT_REJECTED');
  assert.equal(pollutionRuntime.state.records.length, 0);

  let inheritedPolicyReads = 0;
  const previousVerdictTtlDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'verdictTtlMs');
  const inheritedPolicyRuntime = runtime();
  let inheritedPolicyResult;
  try {
    Object.defineProperty(Object.prototype, 'verdictTtlMs', {
      configurable: true,
      get() {
        inheritedPolicyReads += 1;
        return 5_000;
      },
    });
    inheritedPolicyResult = createProductionVolumeRiskPort({
      clock: new ManualClock(),
      runtime: inheritedPolicyRuntime.value,
      owner: {
        readRiskEvidence(binding) {
          const value = riskEvidence(binding);
          const inheritedPolicy = { ...value.policy };
          delete inheritedPolicy.verdictTtlMs;
          return { ...value, policy: inheritedPolicy };
        },
      },
    }).evaluateAndAttach('vp-r57-source');
  } finally {
    if (previousVerdictTtlDescriptor === undefined) delete Object.prototype.verdictTtlMs;
    else Object.defineProperty(Object.prototype, 'verdictTtlMs', previousVerdictTtlDescriptor);
  }
  assert.equal(inheritedPolicyResult.state, 'INPUT_REJECTED');
  assert.equal(inheritedPolicyRuntime.state.records.length, 0);
  assert.equal(inheritedPolicyReads, 0);
});

test('JSON-equivalent negative-zero owner evidence is rejected before intent hashing or persistence', () => {
  const positiveZeroIntent = digestIntent(0);
  const negativeZeroIntent = digestIntent(-0);
  assert.equal(
    deriveRiskIntentDigest(negativeZeroIntent),
    deriveRiskIntentDigest(positiveZeroIntent),
    'the Foundation digest alone cannot distinguish +0 from -0',
  );

  const cases = [
    (binding) => riskEvidence(binding, {
      intent: { ...riskEvidence(binding).intent, requiredBorrowUsd: -0 },
    }),
    (binding) => riskEvidence(binding, {
      policy: { ...policy(), maxResidualDeltaUsd: -0 },
    }),
    (binding) => riskEvidence(binding, {
      killSwitch: {
        accountId: 'account-r57',
        engaged: false,
        observedAt: {
          sourceTimeMs: -0,
          receivedAtMs: NOW,
          maxAgeMs: 1_000,
          authority: 'SYNTHETIC_TEST',
          completeness: 'COMPLETE',
          sourceId: 'negative-zero-r57',
        },
        reason: null,
      },
    }),
  ];
  for (const buildEvidence of cases) {
    const volumeRuntime = runtime();
    const result = createProductionVolumeRiskPort({
      clock: new ManualClock(),
      runtime: volumeRuntime.value,
      owner: { readRiskEvidence: buildEvidence },
    }).evaluateAndAttach('vp-r57-source');
    assert.equal(result.state, 'INPUT_REJECTED');
    assert.deepEqual(result.reasonCodes, ['VOLUME_RISK_EVIDENCE_BINDING_INVALID']);
    assert.equal(volumeRuntime.state.records.length, 0);
  }
});

test('negative-zero production clock time is rejected before owner reads or persistence', () => {
  const positiveZeroRuntime = runtime(proposalCut({
    featureObservedAtMs: 0,
    updatedTs: 0,
    expiresAtMs: 10_000,
  }));
  const positiveZeroResult = createProductionVolumeRiskPort({
    clock: new ManualClock(0),
    runtime: positiveZeroRuntime.value,
    owner: { readRiskEvidence: (binding) => riskEvidence(binding) },
  }).evaluateAndAttach('vp-r57-source');
  assert.equal(positiveZeroResult.state, 'EVALUATED');
  assert.equal(positiveZeroRuntime.state.records.length, 1);

  let ownerReads = 0;
  const volumeRuntime = runtime(proposalCut({
    featureObservedAtMs: 0,
    updatedTs: 0,
    expiresAtMs: 10_000,
  }));
  const port = createProductionVolumeRiskPort({
    clock: new ManualClock(-0),
    runtime: volumeRuntime.value,
    owner: {
      readRiskEvidence(binding) {
        ownerReads += 1;
        return riskEvidence(binding);
      },
    },
  });
  assert.throws(
    () => port.evaluateAndAttach('vp-r57-source'),
    /clock\.nowMs returned invalid UTC ms/,
  );
  assert.equal(ownerReads, 0);
  assert.equal(volumeRuntime.state.reads, 0);
  assert.equal(volumeRuntime.state.records.length, 0);
});

test('a proposal refresh between read and compare-and-record cannot receive a delayed verdict', () => {
  const raced = runtime();
  const port = createProductionVolumeRiskPort({
    clock: new ManualClock(),
    runtime: raced.value,
    owner: {
      readRiskEvidence(binding) {
        raced.state.cut = {
          ...raced.state.cut,
          proposalRevision: raced.state.cut.proposalRevision + 1,
          proposalDigest: `vprop_${'b'.repeat(64)}`,
        };
        return riskEvidence(binding);
      },
    },
  });
  const result = port.evaluateAndAttach('vp-r57-source');
  assert.equal(result.state, 'PROPOSAL_CUT_CHANGED');
  assert.equal(raced.state.records.length, 1);
  assert.equal(raced.state.records[0].expectedProposalRevision, 3);
});

test('production Volume risk composition imports no legacy/private/synthetic risk owner', () => {
  const source = readFileSync(fileURLToPath(new URL(
    '../../../src/systemIntegration/production/volumeRisk.ts',
    import.meta.url,
  )), 'utf8');
  assert.match(source, /evaluateMultiLegRisk/);
  assert.doesNotMatch(source, /services\/risk|services\/orders|services\/loans|binance\/private|liveEdge/);
  const runtimeSource = readFileSync(fileURLToPath(new URL(
    '../../../src/services/volumeRuntime.ts',
    import.meta.url,
  )), 'utf8');
  for (const field of [
    'proposalRevision', 'proposalDigest', 'configurationRevision',
    'featureObservedAtMs', 'expiresAtMs', 'baselineVolume',
    'currentVolume1m', 'tradeCountMultiple', 'riskResult',
  ]) assert.match(runtimeSource, new RegExp(`${field}: proposal\\.${field}`));
});
