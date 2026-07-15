import { deepFreeze, sha256 } from '../../dock/src/index.mjs';
import { OWNER_CONTRACTS, ownerFixtureRef } from '../src/owner-contracts.mjs';
import {
  ALTERNATIVE_MANIFEST_SHA256,
  PREDECLARED_ALTERNATIVE_MANIFEST,
  policyManifestEntry,
} from '../src/policy-manifest.mjs';

export { ALTERNATIVE_MANIFEST_SHA256, OWNER_CONTRACTS, PREDECLARED_ALTERNATIVE_MANIFEST };

const CUTOFF_MS = 1_784_130_000_000;
const DECISION_MS = CUTOFF_MS + 1_000;
const EVALUATED_MS = CUTOFF_MS + 300_000;

function policyFixture(kind) {
  return policyManifestEntry(kind);
}

function ownerEvidence(kind) {
  const executionPolicy = kind === 'EXECUTION_POLICY';
  const contract = executionPolicy ? OWNER_CONTRACTS.L_EXECUTION_POLICY : OWNER_CONTRACTS.Q_EXPERIMENT;
  return {
    schema: 'PolicyOwnerEvidenceRefV1',
    version: 1,
    ...contract,
    ...(executionPolicy
      ? {
          evidenceClass: 'ACCEPTED_FIXTURE_FACTORY_SOURCE_ONLY',
          evidenceRef: 'git:df6b472993ca9659ce09cf5f72004981c6835f0d:server/test/liveEdge/executionPolicy/fixtures.mjs#makeCandidate',
          evidenceCommitSha: 'df6b472993ca9659ce09cf5f72004981c6835f0d',
          evidenceContentHash: 'e1ab8c2274553eb23bffa70829172fdbb939fb7e4ad559890e6bdd953605e5a9',
          fixtureRecordId: null,
          fixtureRevision: null,
          fixtureContentHash: null,
          payloadAvailable: false,
          alternativePolicyPayloadAvailable: false,
          truthClass: 'ACCEPTED_FIXTURE_FACTORY_SOURCE_ONLY',
          materializationState: 'NOT_MATERIALIZED',
          evaluationState: 'NOT_EVALUATED',
          authorityClass: 'NO_AUTHORITY',
        }
      : {
          evidenceClass: 'LOCAL_Q15_EXPERIMENT_FIXTURE',
          evidenceRef: 'frontier/decision-lab/fixtures/factory.mjs#Q15_EXPERIMENT_FIXTURE',
          evidenceCommitSha: null,
          evidenceContentHash: sha256(Q15_EXPERIMENT_FIXTURE),
          fixtureRecordId: Q15_EXPERIMENT_FIXTURE.cardId,
          fixtureRevision: Q15_EXPERIMENT_FIXTURE.revision,
          fixtureContentHash: sha256(Q15_EXPERIMENT_FIXTURE),
          payloadAvailable: true,
          alternativePolicyPayloadAvailable: false,
          truthClass: 'SYNTHETIC_FIXTURE_REFERENCE',
          materializationState: 'MATERIALIZED_FIXTURE',
          evaluationState: 'NOT_EVALUATED',
          authorityClass: 'NO_AUTHORITY',
        }),
  };
}

function alternativeManifestRef(kind) {
  const entry = policyFixture(kind);
  return {
    schema: 'AlternativeManifestRefV1',
    version: 1,
    referenceClass: 'SYNTHETIC_SCENARIO_PREDECLARATION_METADATA_ONLY',
    manifestRef: 'frontier/decision-lab/src/policy-manifest.mjs#PREDECLARED_ALTERNATIVE_MANIFEST',
    manifestHash: ALTERNATIVE_MANIFEST_SHA256,
    entryId: entry.entryId,
    entryRevision: entry.entryRevision,
    entryHash: entry.entryHash,
    kind: entry.kind,
    scenarioPredeclaredAtMs: entry.scenarioPredeclaredAtMs,
    authorityClass: 'NO_AUTHORITY',
    temporalAuthority: false,
  };
}

function costEvidence(kind, id, ref) {
  return {
    ref: ref(kind === 'REALIZED' ? 'CAPITAL_ECONOMICS' : 'Q_OUTCOME', `cost:${id}`),
    quoteAsset: 'USDT',
    totalQuote: kind === 'REALIZED' ? '1.25' : '1.5',
  };
}

function liability(state, id, ref) {
  if (state === 'NOT_APPLICABLE') return { state, ref: null, asset: null, quantity: null };
  if (state === 'UNKNOWN' || state === 'UNAVAILABLE') return { state, ref: null, asset: null, quantity: null };
  return {
    state,
    ref: ref('L_RECOVERY', `liability:${id}`),
    asset: null,
    quantity: null,
  };
}

function availableOutcome({ id, attributionContract, realizationClass, positionTaken, marketPathHash, costAssumptionHash, ref }) {
  return {
    schema: 'OutcomeEvidenceV1',
    version: 1,
    outcomeId: `outcome:${id}`,
    outcomeRevision: 'v1',
    outcomeAttributionRef: ref(attributionContract, `outcome-ref:${id}`),
    state: 'AVAILABLE',
    realizationClass,
    positionTaken,
    marketPathHash,
    costAssumptionHash,
    mfePct: positionTaken ? '1.75' : null,
    maePct: positionTaken ? '0.6' : null,
    timeInExposureMs: positionTaken ? 120_000 : 0,
    realizedCost: realizationClass === 'REALIZED' ? costEvidence('REALIZED', id, ref) : null,
    hypotheticalCost: realizationClass === 'HYPOTHETICAL_PATH_CONDITIONAL' && positionTaken
      ? costEvidence('HYPOTHETICAL', id, ref)
      : null,
    residualLiability: positionTaken ? liability('NONE', id, ref) : liability('NOT_APPLICABLE', id, ref),
    uncertainty: {
      state: 'BOUNDED_BY_OWNER',
      reasonCodes: [],
    },
  };
}

function unavailableOutcome({ id, marketPathHash, costAssumptionHash, ref }) {
  return {
    schema: 'OutcomeEvidenceV1',
    version: 1,
    outcomeId: `outcome:${id}`,
    outcomeRevision: 'v1',
    outcomeAttributionRef: ref('Q_EXCURSION', `outcome-ref:${id}`),
    state: 'UNAVAILABLE',
    realizationClass: 'UNAVAILABLE',
    positionTaken: null,
    marketPathHash,
    costAssumptionHash,
    mfePct: null,
    maePct: null,
    timeInExposureMs: null,
    realizedCost: null,
    hypotheticalCost: null,
    residualLiability: liability('UNAVAILABLE', id, ref),
    uncertainty: {
      state: 'UNAVAILABLE',
      reasonCodes: ['OWNER_OUTCOME_UNAVAILABLE'],
    },
  };
}

function support(kind) {
  if (kind === 'POSITIVE') {
    return { propensityStatus: 'POSITIVE', supportStatus: 'PRESENT', loggingPropensity: '1', targetPropensity: '1' };
  }
  if (kind === 'ZERO') {
    return { propensityStatus: 'ZERO', supportStatus: 'ABSENT', loggingPropensity: '0', targetPropensity: '1' };
  }
  return { propensityStatus: 'UNKNOWN', supportStatus: 'UNKNOWN', loggingPropensity: null, targetPropensity: null };
}

function feasibility(state) {
  return {
    state,
    reasonCodes: state === 'POSSIBLE_AT_CUTOFF' ? [] : [`FEASIBILITY_${state}`],
  };
}

function alternative({
  id,
  kind,
  role,
  disposition,
  fixtureClass,
  canonicalDecisionRef,
  marketPathRef,
  costAssumptionRef,
  state = 'POSSIBLE_AT_CUTOFF',
  outcomeAvailable = true,
  ref,
}) {
  const owner = role === 'OBSERVED_DECISION'
    ? canonicalDecisionRef.owner
    : kind === 'EXECUTION_POLICY' ? 'L_EXECUTION_POLICY' : 'Q_RESEARCH';
  const isSynthetic = fixtureClass === 'SYNTHETIC_FIXTURE';
  const effectiveState = role === 'COUNTERFACTUAL_ALTERNATIVE' || !isSynthetic ? 'UNKNOWN' : state;
  const effectiveOutcomeAvailable = false;
  let outcome;
  if (!effectiveOutcomeAvailable || effectiveState !== 'POSSIBLE_AT_CUTOFF') {
    outcome = unavailableOutcome({
      id,
      marketPathHash: marketPathRef.fixtureIdentityHash,
      costAssumptionHash: costAssumptionRef.fixtureIdentityHash,
      ref,
    });
  } else if (role === 'OBSERVED_DECISION' && disposition === 'ACCEPTED') {
    outcome = availableOutcome({
      id,
      attributionContract: 'MAIN_OUTCOME',
      realizationClass: 'REALIZED',
      positionTaken: true,
      marketPathHash: marketPathRef.fixtureIdentityHash,
      costAssumptionHash: costAssumptionRef.fixtureIdentityHash,
      ref,
    });
  } else if (role === 'OBSERVED_DECISION') {
    outcome = availableOutcome({
      id,
      attributionContract: 'Q_EXCURSION',
      realizationClass: 'NOT_APPLICABLE_NO_POSITION',
      positionTaken: false,
      marketPathHash: marketPathRef.fixtureIdentityHash,
      costAssumptionHash: costAssumptionRef.fixtureIdentityHash,
      ref,
    });
  } else {
    outcome = availableOutcome({
      id,
      attributionContract: 'Q_EXCURSION',
      realizationClass: kind === 'NO_TRADE' ? 'NOT_APPLICABLE_NO_POSITION' : 'HYPOTHETICAL_PATH_CONDITIONAL',
      positionTaken: kind !== 'NO_TRADE',
      marketPathHash: marketPathRef.fixtureIdentityHash,
      costAssumptionHash: costAssumptionRef.fixtureIdentityHash,
      ref,
    });
  }
  return {
    schema: 'AlternativeReferenceV1',
    version: 1,
    alternativeId: `alternative:${id}`,
    alternativeRevision: policyFixture(kind).entryRevision,
    kind,
    role,
    owner,
    predeclarationStatus: isSynthetic ? 'SYNTHETIC_SCENARIO_PREDECLARED' : role === 'OBSERVED_DECISION' ? 'NOT_APPLICABLE_OBSERVED' : 'RECORDED_EVIDENCE_UNAVAILABLE',
    predeclaredAtMs: isSynthetic ? policyFixture(kind).scenarioPredeclaredAtMs : null,
    ownerEvidenceRef: role === 'OBSERVED_DECISION' ? canonicalDecisionRef : ownerEvidence(kind),
    alternativeManifestRef: alternativeManifestRef(kind),
    feasibility: feasibility(effectiveState),
    support: support('UNKNOWN'),
    marketPathRef,
    costAssumptionRef,
    outcome,
  };
}

function ablationResult(id, marketPathRef, costAssumptionRef, informationSet, available = true) {
  const localResultCore = {
    fixtureRecordId: `ablation-result:${id}`,
    fixtureRevision: 'v1',
    fixtureRecordRef: 'frontier/decision-lab/fixtures/factory.mjs#makeDecisionLabFixture',
    fixtureTruthClass: 'SYNTHETIC_FIXTURE_REFERENCE',
  };
  return {
    state: available ? 'AVAILABLE' : 'UNAVAILABLE',
    decisionAction: available ? 'ABSTAIN_UNKNOWN' : 'UNAVAILABLE',
    reasonCodes: available ? ['DATA_INSUFFICIENT'] : ['REAL_EVIDENCE_ABLATION_UNAVAILABLE'],
    resultRef: available ? { ...localResultCore, fixtureRecordHash: sha256(localResultCore) } : null,
    informationSet,
    marketPathHash: marketPathRef.fixtureIdentityHash,
    costAssumptionHash: costAssumptionRef.fixtureIdentityHash,
  };
}

function makeAblation({
  id,
  kind,
  removedRefId,
  marketPathRef,
  costAssumptionRef,
  baselineSet,
  variantSet,
  baselineAvailable = true,
  variantAvailable = true,
  fixtureClass,
  ref,
}) {
  const isSynthetic = fixtureClass === 'SYNTHETIC_FIXTURE';
  return {
    schema: 'AblationComparisonV1',
    version: 1,
    ablationId: `ablation:${id}`,
    ablationRevision: 'v1',
    kind,
    predeclarationStatus: isSynthetic ? 'SYNTHETIC_SCENARIO_PREDECLARED' : 'RECORDED_EVIDENCE_UNAVAILABLE',
    predeclaredAtMs: isSynthetic ? CUTOFF_MS - 120_000 : null,
    qExperimentEvidenceRef: ownerEvidence('Q_ASSISTED'),
    removedRefId,
    baseline: ablationResult('frozen-baseline', marketPathRef, costAssumptionRef, baselineSet, false),
    variant: ablationResult(`${id}:variant`, marketPathRef, costAssumptionRef, variantSet, false),
  };
}

export const Q15_EXPERIMENT_FIXTURE = deepFreeze({
  artifactIds: ['artifact:q17:assessment'],
  attemptedTrialIds: ['trial:0001'],
  cardId: 'q15-card:decision-lab-fixture',
  codeCommit: '6b18928c282f19128a033ed33910754cbdc2cbe0',
  datasetManifestIds: ['dataset:q05:fixture'],
  decision: 'ABSTAIN_UNKNOWN',
  dependencyLockSha256: sha256('q15-decision-lab-fixture-lock'),
  experimentId: 'experiment:decision-lab-fixture',
  featureVersions: ['q06-feature-registry-v1'],
  hypothesisId: 'hypothesis:decision-counterfactual-sensitivity',
  labelVersions: ['q05-label-v1'],
  latencyResourceBenchmark: ['fixture-only:no-runtime-benchmark'],
  metricsAndIntervals: ['DATA_INSUFFICIENT'],
  modelCardIds: ['model-card:q15:fixture'],
  parameters: {
    alternativeManifestSha256: ALTERNATIVE_MANIFEST_SHA256,
    alternativeSet: 'predeclared',
    evaluationMode: 'descriptive-path-replay',
  },
  posture: 'SYNTHETIC_ONLY',
  revision: 'v1',
  schema: 'Q15ExperimentCardV1',
  seed: '13',
  splitFoldIds: ['split:fixture-only'],
  version: 1,
});

export function makeDecisionLabFixture({
  disposition = 'ACCEPTED',
  fixtureClass = 'SYNTHETIC_FIXTURE',
  unavailableRealAblation = false,
} = {}) {
  const fixtureTruthClass = fixtureClass === 'SYNTHETIC_FIXTURE'
    ? 'SYNTHETIC_FIXTURE_REFERENCE'
    : 'UNVERIFIED_RECORDED_SHAPE_REFERENCE';
  const ref = (contractKey, recordId, revision = 'v1', contentHash = null) => ownerFixtureRef(
    contractKey,
    recordId,
    ['Q_EXPERIMENT', 'L_EXECUTION_POLICY', 'L_MARKET_PATH'].includes(contractKey)
      ? 'SYNTHETIC_FIXTURE_REFERENCE'
      : fixtureTruthClass,
    revision,
    contentHash,
  );
  const canonicalDecisionRef = ref(
    disposition === 'ABSTAINED' ? 'Q_ABSTENTION' : disposition === 'MISSED_OPPORTUNITY' ? 'Q_DISPOSITION' : 'MAIN_DECISION',
    `decision:${disposition.toLowerCase()}`,
  );
  const qExperimentRef = ref(
    'Q_EXPERIMENT',
    Q15_EXPERIMENT_FIXTURE.cardId,
    Q15_EXPERIMENT_FIXTURE.revision,
    sha256(Q15_EXPERIMENT_FIXTURE),
  );
  const marketPathRef = ref('L_MARKET_PATH', `market-path:${fixtureClass.toLowerCase()}`);
  const costAssumptionRef = ref('Q_COST_SCENARIO', 'cost-assumption:identical-v1');
  const decision = {
    schema: 'DecisionEnvelopeV1',
    version: 1,
    disposition,
    decisionTimeMs: DECISION_MS,
    informationCutoffMs: CUTOFF_MS,
    canonicalDecisionRef,
    qExperimentRef,
    marketPathRef,
    costAssumptionRef,
    featureRefs: [
      { ref: ref('Q_FEATURE', 'feature:market-flow'), featureFamilyId: 'market_flow', informationRole: 'MARKET_ONLY', asOfMs: CUTOFF_MS, inputLastEventMs: CUTOFF_MS - 10 },
      { ref: ref('Q_FEATURE', 'feature:q-intelligence'), featureFamilyId: 'q_intelligence', informationRole: 'Q_ASSISTED', asOfMs: CUTOFF_MS - 1, inputLastEventMs: CUTOFF_MS - 20 },
      { ref: ref('MAIN_FEATURE', 'feature:liquidity'), featureFamilyId: 'liquidity', informationRole: 'MARKET_ONLY', asOfMs: CUTOFF_MS - 2, inputLastEventMs: CUTOFF_MS - 30 },
    ],
    evidenceRefs: [
      {
        ref: ref('MAIN_INFORMATION', 'evidence:spot-book'),
        sourceFamilyId: 'spot_book', informationRole: 'MARKET_ONLY', upstreamOriginId: 'binance-public', copyClusterId: null,
        eventTimeMs: CUTOFF_MS - 50, publishedTimeMs: CUTOFF_MS - 45, observedTimeMs: CUTOFF_MS - 40, validUntilMs: CUTOFF_MS + 1_000,
      },
      {
        ref: ref('Q_COMPARISON', 'evidence:q-assessment'),
        sourceFamilyId: 'q_assessment', informationRole: 'Q_ASSISTED', upstreamOriginId: 'q-runtime', copyClusterId: null,
        eventTimeMs: CUTOFF_MS - 80, publishedTimeMs: CUTOFF_MS - 70, observedTimeMs: CUTOFF_MS - 60, validUntilMs: CUTOFF_MS + 1_000,
      },
      {
        ref: ref('Q_MARKET_EVIDENCE', 'evidence:mirror-a'),
        sourceFamilyId: 'macro_mirror_a', informationRole: 'MARKET_ONLY', upstreamOriginId: 'official-macro-origin', copyClusterId: 'macro-copy-cluster',
        eventTimeMs: CUTOFF_MS - 500, publishedTimeMs: CUTOFF_MS - 450, observedTimeMs: CUTOFF_MS - 400, validUntilMs: CUTOFF_MS + 10_000,
      },
      {
        ref: ref('Q_MARKET_EVIDENCE', 'evidence:mirror-b'),
        sourceFamilyId: 'macro_mirror_b', informationRole: 'MARKET_ONLY', upstreamOriginId: 'official-macro-origin', copyClusterId: 'macro-copy-cluster',
        eventTimeMs: CUTOFF_MS - 500, publishedTimeMs: CUTOFF_MS - 440, observedTimeMs: CUTOFF_MS - 390, validUntilMs: CUTOFF_MS + 10_000,
      },
    ],
    biasAssessment: {
      selectionBias: { status: 'UNKNOWN', reasonCodes: ['SELECTION_PROCESS_NOT_RANDOMIZED'] },
      survivorshipBias: { status: 'PRESENT', reasonCodes: ['OBSERVED_DECISION_SELECTED_FOR_REVIEW'] },
      hindsightRisk: { status: 'UNKNOWN', reasonCodes: ['RETROSPECTIVE_REPORT'] },
      copiedSourceRisk: { status: 'PRESENT', reasonCodes: ['SHARED_UPSTREAM_SOURCE'] },
      confounding: { status: 'UNKNOWN', reasonCodes: ['MARKET_RESPONSE_NOT_IDENTIFIED'] },
    },
  };
  const observedKind = disposition === 'ACCEPTED' ? 'ENTRY' : 'NO_TRADE';
  const isSynthetic = fixtureClass === 'SYNTHETIC_FIXTURE';
  const alternativeContext = {
    disposition,
    fixtureClass,
    canonicalDecisionRef,
    marketPathRef,
    costAssumptionRef,
    ref,
  };
  const alternatives = [
    alternative({ ...alternativeContext, id: 'observed', kind: observedKind, role: 'OBSERVED_DECISION' }),
    alternative({
      ...alternativeContext,
      id: observedKind === 'ENTRY' ? 'no-trade' : 'entry',
      kind: observedKind === 'ENTRY' ? 'NO_TRADE' : 'ENTRY',
      role: 'COUNTERFACTUAL_ALTERNATIVE',
      outcomeAvailable: isSynthetic,
    }),
    alternative({ ...alternativeContext, id: 'earlier', kind: 'EARLIER_TIMING', role: 'COUNTERFACTUAL_ALTERNATIVE', outcomeAvailable: isSynthetic }),
    alternative({ ...alternativeContext, id: 'delayed', kind: 'DELAYED_TIMING', role: 'COUNTERFACTUAL_ALTERNATIVE', outcomeAvailable: isSynthetic }),
    alternative({ ...alternativeContext, id: 'threshold', kind: 'THRESHOLD', role: 'COUNTERFACTUAL_ALTERNATIVE', outcomeAvailable: isSynthetic }),
    alternative({ ...alternativeContext, id: 'exit', kind: 'EXIT', role: 'COUNTERFACTUAL_ALTERNATIVE', outcomeAvailable: false }),
    alternative({ ...alternativeContext, id: 'execution', kind: 'EXECUTION_POLICY', role: 'COUNTERFACTUAL_ALTERNATIVE', state: 'UNKNOWN' }),
  ];
  const allFeatureIds = decision.featureRefs.map((entry) => entry.ref.fixtureRecordId).sort();
  const allEvidenceIds = decision.evidenceRefs.map((entry) => entry.ref.fixtureRecordId).sort();
  const informationSet = (featureRefIds, evidenceRefIds) => {
    const core = { featureRefIds: [...featureRefIds].sort(), evidenceRefIds: [...evidenceRefIds].sort() };
    return { ...core, informationSetHash: sha256(core) };
  };
  const baselineSet = informationSet(allFeatureIds, allEvidenceIds);
  const ablations = [
    makeAblation({
      id: 'q-vs-market', kind: 'Q_ASSISTED_VS_MARKET_ONLY', removedRefId: null, marketPathRef, costAssumptionRef,
      baselineSet,
      variantSet: informationSet(
        decision.featureRefs.filter((entry) => entry.informationRole === 'MARKET_ONLY').map((entry) => entry.ref.fixtureRecordId),
        decision.evidenceRefs.filter((entry) => entry.informationRole === 'MARKET_ONLY').map((entry) => entry.ref.fixtureRecordId),
      ),
      baselineAvailable: isSynthetic,
      variantAvailable: isSynthetic && !unavailableRealAblation,
      fixtureClass,
      ref,
    }),
    ...decision.evidenceRefs.map((entry) => makeAblation({
      id: `remove-source:${entry.ref.fixtureRecordId}`,
      kind: 'REMOVE_EVIDENCE_SOURCE',
      removedRefId: entry.ref.fixtureRecordId,
      marketPathRef,
      costAssumptionRef,
      baselineSet,
      variantSet: informationSet(allFeatureIds, allEvidenceIds.filter((id) => id !== entry.ref.fixtureRecordId)),
      baselineAvailable: isSynthetic,
      variantAvailable: isSynthetic && !unavailableRealAblation,
      fixtureClass,
      ref,
    })),
    ...decision.featureRefs.map((entry) => makeAblation({
      id: `remove-family:${entry.featureFamilyId}`,
      kind: 'REMOVE_FEATURE_FAMILY',
      removedRefId: entry.featureFamilyId,
      marketPathRef,
      costAssumptionRef,
      baselineSet,
      variantSet: informationSet(allFeatureIds.filter((id) => id !== entry.ref.fixtureRecordId), allEvidenceIds),
      baselineAvailable: isSynthetic,
      variantAvailable: isSynthetic && !unavailableRealAblation,
      fixtureClass,
      ref,
    })),
  ];
  return deepFreeze({
    schema: 'DecisionLabRequestV1',
    version: 1,
    requestId: `decision-lab:${fixtureClass.toLowerCase()}:${disposition.toLowerCase()}`,
    evaluatedAtMs: EVALUATED_MS,
    fixtureClass,
    decision,
    alternatives,
    ablations,
  });
}

export const FIXTURE_CLOCK = deepFreeze({ cutoffMs: CUTOFF_MS, decisionMs: DECISION_MS, evaluatedMs: EVALUATED_MS });
