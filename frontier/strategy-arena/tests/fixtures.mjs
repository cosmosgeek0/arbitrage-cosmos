import {
  createArenaPolicy,
  createEvaluationCampaign,
  createEventContext,
  createQValidationAuthority,
  createShadowExposureProjection,
  createStrategyObservation,
  createStrategySnapshot,
  createSyntheticEconomicProjection,
  createSyntheticOutcomeProjection,
} from '../src/index.mjs';
import { createScenarioReference } from '../../dock/src/index.mjs';

export const BASE_SHA = 'f0168cb37bd04d21bc90591ab2256770de3b75bc';
export const Q_SHA = '02b4eccc8d2ef53b830cafae06e5175715fa6ebb';
export const L_SHA = 'df6b472993ca9659ce09cf5f72004981c6835f0d';
export const CLOCK = Object.freeze({ clockId: 'fixture://strategy-arena/clock/q14-validation-window', evaluationCutoffMs: 1_772_226_800_000 });

export function ownerRef({ commit, path, pointer = null, gitObjectSha, contentSha256, projectionSha256 = null, schemaId, schemaVersion = '1', posture = 'OWNER_EVIDENCE' }) {
  return {
    ref: `git:${commit}:${path}${pointer === null ? '' : `#${pointer}`}`,
    gitObjectSha,
    contentSha256,
    projectionSha256,
    schemaId,
    schemaVersion,
    posture,
  };
}

const Q14_PATH = 'quant/generated/q14/q14_validation_golden_v1.json';
const Q14_OBJECT = 'd13141000460086c60918a8c8e99123f7049c750';
const Q14_SHA256 = '539c95b264333208dfd37c96856be32bd130b41907560558a38bd323e53b20c9';
const Q15_PATH = 'quant/generated/q15/registry_cards.v1.json';
const Q15_OBJECT = '681fd0c84528b1f1907c20c95db4c55bf1a381d9';
const Q15_SHA256 = '0457f22f9b713955f654d99b7dcfe9795d84c71c7ec8baf5a927e007d5a08fb5';

export const REFS = Object.freeze({
  q14Source: ownerRef({ commit: Q_SHA, path: Q14_PATH, gitObjectSha: Q14_OBJECT, contentSha256: Q14_SHA256, schemaId: 'Q14ValidationGoldenV1', posture: 'SYNTHETIC_ONLY' }),
  q14ValidationFolds: ownerRef({ commit: Q_SHA, path: Q14_PATH, pointer: '/plan/folds', gitObjectSha: Q14_OBJECT, contentSha256: Q14_SHA256, projectionSha256: '45d95a79c9ed28fedc488538405aa22c4684d4373fa82f59e5bd2daafad9ed71', schemaId: 'Q14ValidationFoldsV1', posture: 'SYNTHETIC_ONLY' }),
  q14DatasetDigest: ownerRef({ commit: Q_SHA, path: Q14_PATH, pointer: '/datasetDigest', gitObjectSha: Q14_OBJECT, contentSha256: Q14_SHA256, projectionSha256: '99fb6a3c9ee41f7b1895d7f46e69793948a01dfb179cda2e65413089cff8400a', schemaId: 'Q14DatasetDigestV1', posture: 'SYNTHETIC_ONLY' }),
  q14PlanStatus: ownerRef({ commit: Q_SHA, path: Q14_PATH, pointer: '/plan/status', gitObjectSha: Q14_OBJECT, contentSha256: Q14_SHA256, projectionSha256: 'bb3389e2cbcd7bf4d4fcbf732e19b71490126f21ec98b92ce63ac9f464e845c1', schemaId: 'Q14PlanStatusV1', posture: 'SYNTHETIC_ONLY' }),
  q14HoldoutPolicy: ownerRef({ commit: Q_SHA, path: Q14_PATH, pointer: '/plan/spec', gitObjectSha: Q14_OBJECT, contentSha256: Q14_SHA256, projectionSha256: 'af8915a48b59e6dcbcab7d63969400d32c5d2706dd7e9f948dd5c3db4d87f83e', schemaId: 'Q14HoldoutPolicyV1', posture: 'SYNTHETIC_ONLY' }),
  q15ExperimentCard: ownerRef({ commit: Q_SHA, path: Q15_PATH, pointer: '/experimentCard', gitObjectSha: Q15_OBJECT, contentSha256: Q15_SHA256, projectionSha256: '21d679bed82c95892c96a8f4513e3cd3d3f1a39e9992ee72c7f718db73eed68b', schemaId: 'Q15ExperimentCardV1', posture: 'SYNTHETIC_ONLY' }),
  q15LogisticModelCard: ownerRef({ commit: Q_SHA, path: Q15_PATH, pointer: '/modelCards/0', gitObjectSha: Q15_OBJECT, contentSha256: Q15_SHA256, projectionSha256: '52ca18a4529084b1d8b3b271e0d0522a8d515bfe7ee47a04de2f60f815993b0e', schemaId: 'Q15ModelCardV1', posture: 'SYNTHETIC_ONLY' }),
  q15XgbModelCard: ownerRef({ commit: Q_SHA, path: Q15_PATH, pointer: '/modelCards/1', gitObjectSha: Q15_OBJECT, contentSha256: Q15_SHA256, projectionSha256: '1c7057bbe78f2f0de583bd63f2efb06161acaf27433a058fd53dbaa08fe12df2', schemaId: 'Q15ModelCardV1', posture: 'SYNTHETIC_ONLY' }),
  qDisposition: ownerRef({ commit: Q_SHA, path: 'quant/src/quant_edge/labels/disposition.py', pointer: 'EventDisposition', gitObjectSha: 'f1d67f847cd982c18a5809f6851545ee7bf5c020', contentSha256: '3998cfe32649f527a6bdba064d029cb292a26208781269b1ff4bfdff705275f1', schemaId: 'EventDisposition', posture: 'OWNER_CONTRACT' }),
  capitalEconomics: ownerRef({ commit: BASE_SHA, path: 'server/src/capitalFoundation/economics/types.ts', pointer: 'EconomicReport', gitObjectSha: '0bd0eac74dd8197282cc591bb9d73df29e40af9f', contentSha256: '0234aa421140ddab58436756b72d254599944dd85d49a745013aac026f4f265a', schemaId: 'CapitalEconomicReport', posture: 'OWNER_CONTRACT' }),
  capitalAllocation: ownerRef({ commit: BASE_SHA, path: 'server/src/capitalFoundation/allocation/types.ts', gitObjectSha: '53ef386730e701829003f2c3991550abb9e20419', contentSha256: '9c6c34727bd2796eca8fc5514727425b17a037fd7388c3ab93a43d601d69677a', schemaId: 'CapitalAllocationTypes', posture: 'OWNER_CONTRACT' }),
  risk: ownerRef({ commit: BASE_SHA, path: 'server/src/foundation/risk/types.ts', gitObjectSha: '13c594d105143d586dec7798a29d9561d60cf96c', contentSha256: '58475311e6e687e0fb36a0fe2dfcaa5303033e549a44f0ab29d671c4c88ca3c3', schemaId: 'FoundationRiskTypes', posture: 'OWNER_CONTRACT' }),
  recovery: ownerRef({ commit: BASE_SHA, path: 'server/src/foundation/execution/recovery.ts', gitObjectSha: 'd8b28d80a70f75ad7a6aca5311e6bf86c52e8d60', contentSha256: 'a0df76f2cd91991c6c5424be33fb421888cd191a83303de200a69799313e75d9', schemaId: 'FoundationRecoveryGuidance', posture: 'OWNER_CONTRACT' }),
  lTwinScenarioTypes: ownerRef({ commit: L_SHA, path: 'server/src/liveEdge/adapters/exchangeTwin/types.ts', gitObjectSha: 'fbe134a0b95496dc718db1fb10412ca57712afe7', contentSha256: 'c3bf70a72a5d87d6899e0cc21a7dcd106842e6de57002c8fcbd08decdea097f9', schemaId: 'LTwinScenarioAndRecoveryTypes', posture: 'OWNER_CONTRACT' }),
  outcome: ownerRef({ commit: BASE_SHA, path: 'server/src/intelligenceFoundation/outcomes/types.ts', gitObjectSha: 'ef01e6976bcaed9a1c6b64bdd9d01b98c3663c3d', contentSha256: '5e2e48d2aff325c96c13c1abd3ce8ef8e285b1d9c4e025fc05a56214bcf60472', schemaId: 'IntelligenceOutcomeTypes', posture: 'OWNER_CONTRACT' }),
  basisTree: ownerRef({ commit: BASE_SHA, path: 'server/src/engine/basis', gitObjectSha: 'fa6ff1969828e980710cd273a3e207239dfb64ba', contentSha256: 'f63149662b6cada5b4cbf300f5ae5913fe84f7abf8b9d2ee27df8c67bea69cda', schemaId: 'CanonicalStrategyTree', posture: 'CANONICAL_SOURCE' }),
  volumeTree: ownerRef({ commit: BASE_SHA, path: 'server/src/engine/volume', gitObjectSha: 'db13a8a375b73eefc8c02f301957694b60e4a6ab', contentSha256: '23ddc737d68caa41fc8a7005b4a9f68d825810573dbcbd9904a288fb84320c70', schemaId: 'CanonicalStrategyTree', posture: 'CANONICAL_SOURCE' }),
});

export function scenarioReference() {
  return createScenarioReference({
    scenarioId: 'frontier.scenario-bank.example',
    scenarioVersion: '1.0.0',
    extensionProviderRef: 'F12',
    fixtureSchemaRef: 'frontier/dock/contracts/v1/dock-v1.schema.json#/$defs/ScenarioReferenceV1',
    seed: 715,
    clockRef: 'fixture://clock/fixed-2026-07-15',
    lineageRefs: ['git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/src/liveEdge/adapters/exchangeTwin/types.ts'],
    expectedCanonicalPostureRefs: [
      'git:c57610cb5f7d56efb61e53ae27057fbe92a6a2f6:IP_ASSURANCE.md',
      'git:08a0a09780727e2b4ba59017b5701998abe29b77:server/src/productAssurance/faults/harness.ts#evaluateCanonicalFaultHarness',
    ],
  });
}

export function qAuthority(overrides = {}) {
  const range = (start, end) => Array.from({ length: end - start + 1 }, (_, index) => `s-${String(start + index).padStart(4, '0')}`);
  return createQValidationAuthority({
    schema: 'QValidationAuthorityProjectionV1',
    version: 1,
    posture: 'FIXTURE_CONFORMANCE_ONLY',
    sourceArtifactRef: REFS.q14Source,
    validationFoldsRef: REFS.q14ValidationFolds,
    validationFoldsDigest: REFS.q14ValidationFolds.projectionSha256,
    datasetDigestRef: REFS.q14DatasetDigest,
    datasetDigest: '701e256d7beb6161812ed2d5edba16069856c1ded12e996b987c7e758249724b',
    planStatusRef: REFS.q14PlanStatus,
    planStatus: 'VALID',
    holdoutPolicyRef: REFS.q14HoldoutPolicy,
    folds: [
      { foldId: 'fold-01', status: 'VALID', validationSampleIds: range(13, 25), validationStartCutoffNs: '1772046800000000000', validationEndCutoffNs: '1772090000000000000', purgedCount: 0, embargoedCount: 1, groupConflictCount: 0 },
      { foldId: 'fold-02', status: 'VALID', validationSampleIds: range(26, 38), validationStartCutoffNs: '1772093600000000000', validationEndCutoffNs: '1772136800000000000', purgedCount: 0, embargoedCount: 1, groupConflictCount: 0 },
      { foldId: 'fold-03', status: 'VALID', validationSampleIds: range(39, 51), validationStartCutoffNs: '1772140400000000000', validationEndCutoffNs: '1772183600000000000', purgedCount: 0, embargoedCount: 1, groupConflictCount: 0 },
      { foldId: 'fold-04', status: 'VALID', validationSampleIds: range(52, 63), validationStartCutoffNs: '1772187200000000000', validationEndCutoffNs: '1772226800000000000', purgedCount: 0, embargoedCount: 1, groupConflictCount: 0 },
    ],
    holdoutAccessState: 'SEALED_REQUIRES_NEW_Q_GRANT_AND_REPLAY_BUNDLE',
    ...overrides,
  });
}

export function policy(overrides = {}) {
  return createArenaPolicy({
    schema: 'StrategyArenaPolicyV1',
    version: 1,
    policyId: 'strategy-arena-policy',
    policyVersion: '1.0.0',
    minimumComparableEvents: 4,
    maximumFalsePositiveRatePpm: 300_000,
    maximumAmbiguityRatePpm: 300_000,
    maximumRecoveryBurdenMicros: '120',
    maximumCapacityConstraintRatePpm: 250_000,
    demotionRequiresBreaches: 2,
    retirementRequiresBreaches: 3,
    metricOrder: [
      'FIXTURE_NET_OUTCOME_MICROS',
      'COST_SURVIVAL_RATE_PPM',
      'NON_ACTION_QUALITY_PPM',
      'FALSE_POSITIVE_RATE_PPM_INVERTED',
      'RECOVERY_BURDEN_MICROS_INVERTED',
      'AMBIGUITY_RATE_PPM_INVERTED',
      'CAPACITY_CONSTRAINT_RATE_PPM_INVERTED',
      'WORST_SLICE_NET_MICROS',
    ],
    metricDirections: {
      FIXTURE_NET_OUTCOME_MICROS: 'MAXIMIZE',
      COST_SURVIVAL_RATE_PPM: 'MAXIMIZE',
      NON_ACTION_QUALITY_PPM: 'MAXIMIZE',
      FALSE_POSITIVE_RATE_PPM_INVERTED: 'MAXIMIZE',
      RECOVERY_BURDEN_MICROS_INVERTED: 'MAXIMIZE',
      AMBIGUITY_RATE_PPM_INVERTED: 'MAXIMIZE',
      CAPACITY_CONSTRAINT_RATE_PPM_INVERTED: 'MAXIMIZE',
      WORST_SLICE_NET_MICROS: 'MAXIMIZE',
    },
    ...overrides,
  });
}

export function snapshot(id, arenaPolicy, overrides = {}) {
  const strategy = id === 'basis' ? REFS.basisTree : REFS.volumeTree;
  return createStrategySnapshot({
    schema: 'StrategyEvaluationSnapshotV1',
    version: 1,
    snapshotId: `snapshot.${id}.v1`,
    canonicalStrategyRef: strategy.ref,
    canonicalStrategyHash: strategy.gitObjectSha,
    canonicalStrategyContentSha256: strategy.contentSha256,
    qExperimentAndModelRefs: [],
    evidenceSnapshotRefs: [strategy],
    capitalRiskAssumptionRefs: [REFS.capitalAllocation, REFS.capitalEconomics].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    executionCostAndRecoveryRefs: [REFS.lTwinScenarioTypes, REFS.recovery, REFS.risk].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    evaluationCampaignId: 'campaign.strategy-arena.fixture.001',
    evaluationPolicyVersion: `${arenaPolicy.policyId}.${arenaPolicy.policyVersion}`,
    evaluationPolicyHash: arenaPolicy.policyHash,
    fixtureClock: CLOCK,
    seed: 20260716,
    holdoutPolicyRef: REFS.q14HoldoutPolicy,
    knownMissingInputs: [],
    ...overrides,
  });
}

export function outcome(eventId, outcomeClass, ambiguityState = 'CLEAR', overrides = {}) {
  return createSyntheticOutcomeProjection({
    schema: 'SyntheticOutcomeProjectionV1',
    version: 1,
    state: outcomeClass === 'UNKNOWN' ? 'UNKNOWN' : 'AVAILABLE',
    outcomeClass,
    ambiguityState,
    reality: 'HYPOTHETICAL_REPLAY',
    ownerContractRef: REFS.outcome,
    fixtureFactRef: `fixture://strategy-arena/outcomes/${eventId}`,
    attributionComputed: false,
    reasonCodes: outcomeClass === 'UNKNOWN' ? ['OWNER_OUTCOME_UNAVAILABLE'] : [],
    ...overrides,
  });
}

export function eventContext(eventNumber, sampleId, foldId, outcomeClass, ambiguityState = 'CLEAR', overrides = {}) {
  const scenario = scenarioReference();
  const sampleIndex = Number(sampleId.slice(2));
  const eventTimeMs = 1_772_000_000_000 + sampleIndex * 3_600_000;
  return createEventContext({
    schema: 'StrategyArenaEventContextV1',
    version: 1,
    eventId: `E${eventNumber}`,
    sampleId,
    qFoldId: foldId,
    partition: 'WALK_FORWARD_VALIDATION',
    eventTimeMs,
    receiveTimeMs: eventTimeMs + 100,
    symbol: eventNumber % 2 === 0 ? 'ETHUSDT' : 'BTCUSDT',
    regime: eventNumber <= 2 ? 'CALM' : 'STRESSED',
    qSplitMembershipRef: REFS.q14ValidationFolds,
    scenarioHash: scenario.scenarioHash,
    evidenceSnapshotRefs: [REFS.outcome],
    outcome: outcome(`E${eventNumber}`, outcomeClass, ambiguityState),
    ...overrides,
  });
}

export function economics(eventId, snapshotId, { gross = '200', net = '160', fees = '20', slippage = '10', fundingBorrow = '5', latency = '5', recovery = '0', state = 'AVAILABLE', overrides = {} } = {}) {
  const noExposure = state === 'NO_EXPOSURE';
  const unknown = state === 'UNKNOWN';
  return createSyntheticEconomicProjection({
    schema: 'SyntheticEconomicProjectionV1',
    version: 1,
    state,
    reality: 'HYPOTHETICAL_REPLAY',
    valuationUnit: 'USDT_MICROS',
    grossOutcomeMicros: noExposure ? null : gross,
    costMicros: noExposure ? null : { fees, slippage: unknown ? null : slippage, fundingBorrow, latency, recovery },
    fixtureNetOutcomeMicros: noExposure || unknown ? null : net,
    accountingStatus: noExposure ? 'NOT_APPLICABLE' : unknown ? 'INCOMPLETE' : 'FIXTURE_PROVIDED',
    ownerContractRef: REFS.capitalEconomics,
    fixtureFactRef: `fixture://strategy-arena/economics/${snapshotId}/${eventId}`,
    attributionComputed: false,
    reasonCodes: unknown ? ['OWNER_ECONOMICS_PARTIAL_OR_UNAVAILABLE'] : [],
    ...overrides,
  });
}

export function exposure(eventId, snapshotId, { state = 'SHADOW_EXPOSED', allocationState = 'GRANTED', demandUnits = 10, grantedUnits = 10, eventTimeMs, start = 0, overrides = {} } = {}) {
  const noExposure = state === 'NO_EXPOSURE';
  const unknown = state === 'UNKNOWN';
  return createShadowExposureProjection({
    schema: 'ShadowExposureProjectionV1',
    version: 1,
    state,
    reality: 'HYPOTHETICAL_REPLAY',
    openedAtMs: noExposure || unknown ? null : eventTimeMs + start,
    closedAtMs: noExposure || unknown ? null : eventTimeMs + start + 5_000,
    capacityUnit: unknown ? null : 'FIXTURE_CAPACITY_UNITS',
    valuationAsset: unknown ? null : 'USDT_MICROS',
    demandUnits: unknown ? null : demandUnits,
    grantedUnits: unknown ? null : grantedUnits,
    allocationState: unknown ? 'UNKNOWN' : allocationState,
    ownerContractRef: REFS.capitalAllocation,
    fixtureFactRef: `fixture://strategy-arena/exposures/${snapshotId}/${eventId}`,
    reasonCodes: unknown ? ['OWNER_CAPACITY_UNAVAILABLE'] : [],
    ...overrides,
  });
}

export function observation(strategy, context, { disposition = 'ACTED', economicsOptions = {}, exposureOptions = {}, contention = [], servingPosture = 'ADVISORY', overrides = {} } = {}) {
  const nonActed = disposition !== 'ACTED' && disposition !== 'DATA_INVALID';
  const dataInvalid = disposition === 'DATA_INVALID';
  const snapshotId = strategy.snapshotId;
  return createStrategyObservation({
    schema: 'StrategyObservationV1',
    version: 1,
    observationId: `observation.${snapshotId}.${context.eventId}`,
    strategySnapshotHash: strategy.snapshotHash,
    eventContextHash: context.eventContextHash,
    decisionDisposition: disposition,
    servingPosture: dataInvalid ? 'ABSTAIN_UNKNOWN' : servingPosture,
    decisionOwnerRef: REFS.qDisposition,
    decisionReasonCodes: [dataInvalid ? 'GAPPED_OR_UNKNOWN_EVIDENCE' : disposition === 'ACTED' ? 'SYNTHETIC_FIXTURE_ASSERTION' : 'FIXTURE_NON_ACTION'],
    economics: economics(context.eventId, snapshotId, { state: dataInvalid ? 'UNKNOWN' : nonActed ? 'NO_EXPOSURE' : 'AVAILABLE', ...economicsOptions }),
    shadowExposure: exposure(context.eventId, snapshotId, { state: dataInvalid ? 'UNKNOWN' : nonActed ? 'NO_EXPOSURE' : 'SHADOW_EXPOSED', allocationState: nonActed ? 'NOT_REQUESTED' : 'GRANTED', demandUnits: nonActed ? 0 : 10, grantedUnits: nonActed ? 0 : 10, eventTimeMs: context.eventTimeMs, ...exposureOptions }),
    capitalContentionRefs: [...contention].sort(),
    ownerEvidenceRefs: [REFS.capitalAllocation, REFS.capitalEconomics, REFS.outcome, REFS.qDisposition, REFS.recovery, REFS.risk].sort((a, b) => a.ref < b.ref ? -1 : a.ref > b.ref ? 1 : 0),
    ...overrides,
  });
}

export function baseTournament({ campaignOverrides = {}, policyOverrides = {}, snapshotOverrides = {}, observationOverrides = {} } = {}) {
  const arenaPolicy = policy(policyOverrides);
  const basis = snapshot('basis', arenaPolicy, snapshotOverrides.basis ?? {});
  const volume = snapshot('volume', arenaPolicy, snapshotOverrides.volume ?? {});
  const contexts = [
    eventContext(1, 's-0013', 'fold-01', 'FAVORABLE'),
    eventContext(2, 's-0014', 'fold-01', 'UNFAVORABLE'),
    eventContext(3, 's-0026', 'fold-02', 'FAVORABLE', 'AMBIGUOUS'),
    eventContext(4, 's-0027', 'fold-02', 'FAVORABLE'),
  ];
  const rows = [
    observation(basis, contexts[0], { economicsOptions: { gross: '220', net: '180' } }),
    observation(basis, contexts[1], { disposition: 'REJECTED' }),
    observation(basis, contexts[2], { economicsOptions: { gross: '190', net: '145', recovery: '5' } }),
    observation(basis, contexts[3], { economicsOptions: { gross: '150', net: '105', recovery: '5' }, contention: ['fixture://capital/contention/E4'] }),
    observation(volume, contexts[0], { economicsOptions: { gross: '170', net: '125', recovery: '5' } }),
    observation(volume, contexts[1], { economicsOptions: { gross: '-20', net: '-70', recovery: '10' } }),
    observation(volume, contexts[2], { disposition: 'REJECTED' }),
    observation(volume, contexts[3], { economicsOptions: { gross: '130', net: '80', recovery: '10' }, contention: ['fixture://capital/contention/E4'] }),
  ];
  for (const [key, override] of Object.entries(observationOverrides)) rows[Number(key)] = override(rows[Number(key)], { basis, volume, contexts });
  const authority = qAuthority();
  const campaign = createEvaluationCampaign({
    schema: 'StrategyArenaCampaignV1',
    version: 1,
    campaignId: 'campaign.strategy-arena.fixture.001',
    campaignPhase: 'ITERATION',
    evaluationPolicy: arenaPolicy,
    fixtureClock: CLOCK,
    seed: 20260716,
    qValidationAuthority: authority,
    strategyTrialEvidenceState: 'UNAVAILABLE_NO_Q_WHOLE_STRATEGY_TRIAL_LINKAGE',
    strategyRecordedTrialCount: null,
    strategySelectionPressureRefs: [],
    selectionPressureReasonCodes: ['CAMPAIGN_BOUND_Q_SELECTION_BUNDLE_MISSING'],
    strategySnapshots: [volume, basis],
    scenarioReferences: [scenarioReference()],
    eventContexts: [...contexts].reverse(),
    observations: [...rows].reverse(),
    ...campaignOverrides,
  });
  return { arenaPolicy, authority, basis, volume, contexts, rows, campaign };
}
