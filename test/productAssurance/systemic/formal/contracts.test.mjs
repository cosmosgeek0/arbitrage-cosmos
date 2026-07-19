import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  computeCounterexampleTraceSha256,
  evaluateConformanceMapping,
  evaluateCounterexampleTriage,
  MODEL_ELEMENT_MANIFEST_BY_ID,
  projectFormalAssuranceView,
  validateConformanceMapping,
  validateExplicitStateReport,
  validateCounterexampleTriage,
} from '../../../../fixtures/productAssurance/systemic/formal/contracts/index.mjs';
import { CANONICAL_MODELS, NEGATIVE_CONTROL_MODELS } from '../../../../fixtures/productAssurance/systemic/formal/explicitState/index.mjs';
import { EXPLICIT_STATE_CHECKER, runModels } from '../../../../fixtures/productAssurance/systemic/formal/explicitState/kernel.mjs';
import { CONFORMANCE_FIXTURES, FORMAL_FIXTURE_TIME_MS, IMPLEMENTATION_RELEASE_SHA } from '../../../../fixtures/productAssurance/systemic/formal/fixtures/conformance-fixtures.mjs';
import { buildFormalPacketView } from '../../../../fixtures/productAssurance/systemic/formal/fixtures/formal-view-fixture.mjs';
import { MODEL_HASHES, MODEL_MANIFEST_BY_ID, MODEL_MANIFEST_SCHEMA } from '../../../../fixtures/productAssurance/systemic/formal/fixtures/model-manifest.mjs';
import {
  buildCounterexampleTriageFixtures,
  buildCounterexampleTriageInventory,
} from '../../../../fixtures/productAssurance/systemic/formal/fixtures/triage-fixtures.mjs';

test('formal contract tests exercise the public contract barrel', () => {
  const source = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  const formalContractImports = [...source.matchAll(/from\s+['"]([^'"]+)['"]/g)]
    .map((match) => match[1])
    .filter((specifier) => specifier.includes('/systemic/formal/contracts/'));

  assert.deepEqual(formalContractImports, [
    '../../../../fixtures/productAssurance/systemic/formal/contracts/index.mjs',
  ]);
});

function supportingCandidate() {
  const source = CONFORMANCE_FIXTURES[0];
  const mappings = source.mappings.map((row) => Object.freeze({ ...row, status: 'MAPPED' }));
  const success = Object.freeze({
    traceId: 'S3-CONFORMANCE-M01-SUCCESS',
    status: 'REPRODUCED',
    traceSha256: 'a'.repeat(64),
    harness: 'server/test/formal-success.mjs',
    evidenceRefs: Object.freeze(['receipt:success']),
  });
  const counterexample = Object.freeze({
    traceId: 'S3-CONFORMANCE-M01-COUNTEREXAMPLE',
    status: 'REPRODUCED',
    traceSha256: 'b'.repeat(64),
    harness: 'server/test/formal-fault.mjs',
    evidenceRefs: Object.freeze(['receipt:fault']),
  });
  return Object.freeze({
    ...source,
    mappings: Object.freeze(mappings),
    replays: Object.freeze({ representativeSuccess: success, validatedCounterexamples: Object.freeze([counterexample]) }),
    mismatches: Object.freeze([]),
    unreachableAbstractions: Object.freeze([]),
    omittedEnvironmentBehavior: Object.freeze([]),
  });
}

function conformanceContext(candidate) {
  return Object.freeze({
    verificationAuthority: 'INDEPENDENT_READBACK',
    modelIdentity: Object.freeze({
      manifestSchemaVersion: MODEL_MANIFEST_SCHEMA,
      modelId: MODEL_MANIFEST_BY_ID[candidate.modelId].modelId,
      modelVersion: MODEL_MANIFEST_BY_ID[candidate.modelId].modelVersion,
      modelContentSha256: MODEL_MANIFEST_BY_ID[candidate.modelId].bundleSha256,
    }),
    implementationReleaseSha: candidate.implementationReleaseSha,
    expectedModelElements: MODEL_ELEMENT_MANIFEST_BY_ID[candidate.modelId],
    verifiedMappingEvidenceRefs: Object.freeze([...new Set(candidate.mappings.flatMap((row) => row.evidenceRefs))]),
    ordinaryHarnesses: Object.freeze(['server/test/formal-success.mjs', 'server/test/formal-fault.mjs']),
    verifiedReplayEvidenceRefs: Object.freeze(['receipt:success', 'receipt:fault']),
  });
}

test('all thirteen packet conformance fixtures are valid and stay fail-closed', () => {
  const verdicts = CONFORMANCE_FIXTURES.map((fixture) => {
    assert.equal(validateConformanceMapping(fixture).ok, true, fixture.modelId);
    const result = evaluateConformanceMapping(fixture);
    assert.equal(result.runtimeClaimClosure, 'NOT_PERMITTED');
    assert.notEqual(result.verdict, 'SUPPORTING_EVIDENCE');
    return result.verdict;
  });
  assert.deepEqual(verdicts, [
    'MISMATCH', 'MISMATCH', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN', 'UNKNOWN',
    'UNKNOWN', 'REFERENCE_ONLY', 'REFERENCE_ONLY', 'REFERENCE_ONLY', 'REFERENCE_ONLY',
    'MISMATCH',
  ]);
});

test('self-declared conformance data cannot produce supporting evidence without a pinned owner registry', () => {
  const candidate = supportingCandidate();
  assert.equal(validateConformanceMapping(candidate).ok, true);
  const unverified = evaluateConformanceMapping(candidate);
  assert.equal(unverified.verdict, 'REFERENCE_ONLY');
  assert.equal(unverified.reasons.includes('INDEPENDENT_VERIFICATION_AUTHORITY_MISSING'), true);
  assert.equal(unverified.reasons.includes('REPLAY_PROVENANCE_NOT_VERIFIED'), true);

  const verified = evaluateConformanceMapping(candidate, conformanceContext(candidate));
  assert.equal(verified.verdict, 'REFERENCE_ONLY');
  assert.equal(verified.reasons.includes('OWNER_EVIDENCE_REGISTRY_NOT_CONFIGURED'), true);
  assert.equal(verified.reasons.includes('MAPPING_EVIDENCE_NOT_VERIFIED'), true);
  assert.equal(verified.reasons.includes('REPLAY_PROVENANCE_NOT_VERIFIED'), true);
  assert.equal(verified.runtimeClaimClosure, 'NOT_PERMITTED');
});

test('conformance identity and model elements are bound to the canonical packet manifest', () => {
  const candidate = supportingCandidate();
  const fabricatedHash = Object.freeze({ ...candidate, modelContentSha256: '0'.repeat(64) });
  const hashValidation = validateConformanceMapping(fabricatedHash);
  assert.equal(hashValidation.ok, false);
  assert.equal(hashValidation.issues.some((issue) => issue.code === 'MODEL_HASH_MISMATCH'), true);
  assert.equal(evaluateConformanceMapping(fabricatedHash, conformanceContext(candidate)).verdict, 'UNKNOWN');

  const fabricatedRows = candidate.mappings.map((row, index) => index === 0
    ? Object.freeze({ ...row, modelElementId: 'CALLER_INVENTED_STATE' })
    : row);
  const fabricatedElement = Object.freeze({ ...candidate, mappings: Object.freeze(fabricatedRows) });
  const elementValidation = validateConformanceMapping(fabricatedElement);
  assert.equal(elementValidation.ok, false);
  assert.equal(elementValidation.issues.some((issue) => issue.code === 'MODEL_ELEMENT_MANIFEST_MISMATCH'), true);
});

test('lowercase unknown versions and material omissions downgrade conformance', () => {
  const candidate = supportingCandidate();
  const unknownVersion = Object.freeze({
    ...candidate,
    implementationSchemaVersions: Object.freeze(['unknown-lowercase']),
  });
  assert.equal(evaluateConformanceMapping(unknownVersion, conformanceContext(unknownVersion)).verdict, 'UNKNOWN');

  const omitted = Object.freeze({
    ...candidate,
    omittedEnvironmentBehavior: Object.freeze(['All external behavior omitted.']),
  });
  const result = evaluateConformanceMapping(omitted, conformanceContext(omitted));
  assert.equal(result.verdict, 'REFERENCE_ONLY');
  assert.equal(result.reasons.includes('OMITTED_ENVIRONMENT_BEHAVIOR_PRESENT'), true);
});

test('mapped conformance rows require symbols, evidence, and mapped postconditions', () => {
  const candidate = supportingCandidate();
  const brokenRows = candidate.mappings.map((row, index) => index === 0
    ? Object.freeze({ ...row, implementationSymbol: null, evidenceRefs: Object.freeze([]) })
    : row);
  const broken = Object.freeze({ ...candidate, mappings: Object.freeze(brokenRows) });
  const validated = validateConformanceMapping(broken);
  assert.equal(validated.ok, false);
  assert.equal(validated.issues.some((issue) => issue.code === 'SYMBOL_REQUIRED'), true);
  assert.equal(evaluateConformanceMapping(broken).verdict, 'UNKNOWN');
  assert.doesNotThrow(() => validateConformanceMapping(Object.freeze({ schemaVersion: 'ip-assurance.s3.conformance-map.v1' })));
  assert.equal(validateConformanceMapping(Object.freeze({ schemaVersion: 'ip-assurance.s3.conformance-map.v1' })).ok, false);

  const nullEvidenceRows = candidate.mappings.map((row, index) => index === 0
    ? Object.freeze({ ...row, evidenceRefs: null })
    : row);
  const nullEvidence = Object.freeze({ ...candidate, mappings: Object.freeze(nullEvidenceRows) });
  assert.doesNotThrow(() => validateConformanceMapping(nullEvidence));
  assert.equal(validateConformanceMapping(nullEvidence).ok, false);

  const contradictoryReplay = Object.freeze({
    ...candidate,
    replays: Object.freeze({
      ...candidate.replays,
      representativeSuccess: Object.freeze({
        ...candidate.replays.representativeSuccess,
        status: 'NOT_RUN',
      }),
    }),
  });
  const replayValidation = validateConformanceMapping(contradictoryReplay);
  assert.equal(replayValidation.ok, false);
  assert.equal(replayValidation.issues.some((issue) => issue.code === 'REPLAY_STATUS_CONFLICT'), true);

  const missingTraceHash = Object.freeze({
    ...candidate,
    replays: Object.freeze({
      ...candidate.replays,
      representativeSuccess: Object.freeze({
        ...candidate.replays.representativeSuccess,
        traceSha256: null,
      }),
    }),
  });
  const traceHashValidation = validateConformanceMapping(missingTraceHash);
  assert.equal(traceHashValidation.ok, false);
  assert.equal(traceHashValidation.issues.some((issue) => issue.code === 'TRACE_HASH_REQUIRED'), true);
});

test('five deterministic triage fixtures cover every §4.4 disposition without corpus promotion', () => {
  const fixtures = buildCounterexampleTriageFixtures();
  assert.equal(fixtures.length, 5);
  assert.deepEqual(fixtures.map((fixture) => fixture.disposition), [
    'IMPLEMENTATION_RELEVANT_VALIDATED',
    'SPECIFICATION_MODEL_DEFECT',
    'ASSUMPTION_VIOLATION',
    'SPURIOUS_UNREACHABLE_UNDER_IMPLEMENTATION_CONSTRAINTS',
    'UNRESOLVED',
  ]);
  for (const fixture of fixtures) {
    assert.equal(validateCounterexampleTriage(fixture).ok, true, fixture.triageId);
    const result = evaluateCounterexampleTriage(fixture);
    assert.equal(result.runtimeCorpusEligible, false, fixture.triageId);
    assert.deepEqual(result.destinations, []);
  }
});

test('complete triage inventory authenticates every failed negative-control property across all profiles', () => {
  const actualFailures = NEGATIVE_CONTROL_MODELS.flatMap((model) => {
    const report = runModels(Object.freeze([model]))[0];
    return report.properties
      .filter((property) => property.status === 'FAIL')
      .map((property) => `${report.modelId}:${report.profile}:${property.propertyId}`);
  }).sort();
  const inventory = buildCounterexampleTriageInventory();
  const inventoryIdentities = inventory
    .map((triage) => `${triage.modelId}:${triage.modelProfile}:${triage.propertyId}`)
    .sort();

  assert.equal(actualFailures.length, 25);
  assert.equal(inventory.length, actualFailures.length);
  assert.deepEqual(inventoryIdentities, actualFailures);
  assert.equal(new Set(inventory.map((triage) => triage.triageId)).size, inventory.length);
  assert.deepEqual(
    [...new Set(inventory.map((triage) => triage.modelProfile))].sort(),
    NEGATIVE_CONTROL_MODELS.map((model) => model.profile).sort(),
  );

  for (const triage of inventory) {
    assert.equal(validateCounterexampleTriage(triage).ok, true, triage.triageId);
    const evaluated = evaluateCounterexampleTriage(triage);
    assert.equal(evaluated.counterexampleSource, 'EXACT_PACKET_NEGATIVE_CONTROL', triage.triageId);
    assert.equal(evaluated.status, 'MODEL_LIMITATION_ONLY', triage.triageId);
    assert.equal(evaluated.runtimeCorpusEligible, false, triage.triageId);
    assert.deepEqual(evaluated.destinations, [], triage.triageId);
  }
});

test('hostile negative-control profiles remain non-promotable under complete independent readback', () => {
  const source = buildCounterexampleTriageFixtures()[0];
  const candidate = Object.freeze({
    ...source,
    implementationReplay: Object.freeze({
      status: 'REPRODUCED',
      implementationReleaseSha: IMPLEMENTATION_RELEASE_SHA,
      harness: 'server/test/ordinary-fault-harness.mjs',
      evidenceRefs: Object.freeze(['receipt:ordinary-replay']),
    }),
  });
  assert.equal(evaluateCounterexampleTriage(candidate).runtimeCorpusEligible, false);
  const context = Object.freeze({
    verificationAuthority: 'INDEPENDENT_READBACK',
    modelIdentity: Object.freeze({
      manifestSchemaVersion: MODEL_MANIFEST_SCHEMA,
      acceptance: 'ACCEPTED_READBACK',
      modelId: candidate.modelId,
      modelVersion: candidate.modelVersion,
      modelContentSha256: candidate.modelContentSha256,
      propertyIds: Object.freeze([candidate.propertyId]),
      profileIds: Object.freeze([candidate.modelProfile]),
    }),
    profileIdentity: Object.freeze({
      modelId: candidate.modelId,
      modelProfile: candidate.modelProfile,
      kind: candidate.profileProvenance.kind,
      sourceRef: candidate.profileProvenance.sourceRef,
      graphFingerprint: candidate.profileProvenance.graphFingerprint,
    }),
    checkerIdentity: EXPLICIT_STATE_CHECKER,
    implementationReleaseSha: IMPLEMENTATION_RELEASE_SHA,
    ordinaryHarnesses: Object.freeze(['server/test/ordinary-fault-harness.mjs']),
    verifiedEvidenceRefs: Object.freeze([
      ...candidate.evidenceRefs,
      ...candidate.profileProvenance.evidenceRefs,
      ...candidate.implementationReplay.evidenceRefs,
    ]),
    acceptedReviewers: Object.freeze([candidate.reviewer]),
  });
  const rejected = evaluateCounterexampleTriage(candidate, context);
  assert.equal(rejected.counterexampleSource, 'EXACT_PACKET_NEGATIVE_CONTROL');
  assert.equal(rejected.status, 'REJECTED_NEGATIVE_CONTROL');
  assert.equal(rejected.runtimeCorpusEligible, false);
  assert.deepEqual(rejected.destinations, []);
  assert.equal(rejected.verificationReasons.includes('NEGATIVE_CONTROL_PROFILE_NOT_RUNTIME_EVIDENCE'), true);
  assert.equal(rejected.verificationReasons.includes('OWNER_PINNED_CANONICAL_REPLAY_REQUIRED'), true);

  const wrongHarness = Object.freeze({ ...context, ordinaryHarnesses: Object.freeze(['server/test/not-the-replay.mjs']) });
  assert.equal(evaluateCounterexampleTriage(candidate, wrongHarness).runtimeCorpusEligible, false);
});

test('fabricated counterexample actions, states, hashes, and canonical relabeling fail closed', () => {
  const source = buildCounterexampleTriageFixtures()[0];
  const lastIndex = source.trace.steps.length - 1;
  const fabricatedSteps = source.trace.steps.map((step, index) => index === lastIndex
    ? Object.freeze({ ...step, actionId: 'FABRICATED_ACTION' })
    : step);
  const fabricatedTrace = Object.freeze({ ...source.trace, steps: Object.freeze(fabricatedSteps) });
  const fabricated = Object.freeze({
    ...source,
    trace: fabricatedTrace,
    traceSha256: computeCounterexampleTraceSha256(fabricatedTrace),
  });
  assert.equal(validateCounterexampleTriage(fabricated).ok, true);
  const fabricatedResult = evaluateCounterexampleTriage(fabricated);
  assert.equal(fabricatedResult.status, 'REJECTED_UNVERIFIED_COUNTEREXAMPLE');
  assert.equal(fabricatedResult.verificationReasons.includes('NEGATIVE_CONTROL_TRACE_MISMATCH'), true);

  const fabricatedStateSteps = source.trace.steps.map((step, index) => index === lastIndex
    ? Object.freeze({ ...step, state: Object.freeze({ ...step.state, fabricatedMarker: true }) })
    : step);
  const fabricatedStateTrace = Object.freeze({ ...source.trace, steps: Object.freeze(fabricatedStateSteps) });
  const fabricatedState = Object.freeze({
    ...source,
    trace: fabricatedStateTrace,
    traceSha256: computeCounterexampleTraceSha256(fabricatedStateTrace),
  });
  assert.equal(validateCounterexampleTriage(fabricatedState).ok, true);
  assert.equal(evaluateCounterexampleTriage(fabricatedState).status, 'REJECTED_UNVERIFIED_COUNTEREXAMPLE');

  const falseInitSteps = source.trace.steps.map((step, index) => index === 0
    ? Object.freeze({ ...step, actionId: 'FABRICATED_INIT' })
    : step);
  const falseInitTrace = Object.freeze({ ...source.trace, steps: Object.freeze(falseInitSteps) });
  const falseInit = Object.freeze({
    ...source,
    trace: falseInitTrace,
    traceSha256: computeCounterexampleTraceSha256(falseInitTrace),
  });
  const falseInitValidation = validateCounterexampleTriage(falseInit);
  assert.equal(falseInitValidation.ok, false);
  assert.equal(falseInitValidation.issues.some((entry) => entry.code === 'TRACE_INIT_REQUIRED'), true);

  const badHash = Object.freeze({ ...source, traceSha256: 'f'.repeat(64) });
  const badHashValidation = validateCounterexampleTriage(badHash);
  assert.equal(badHashValidation.ok, false);
  assert.equal(badHashValidation.issues.some((entry) => entry.code === 'TRACE_HASH_MISMATCH'), true);
  assert.equal(evaluateCounterexampleTriage(badHash).status, 'REJECTED_INVALID');

  const relabeled = Object.freeze({
    ...source,
    modelProfile: 'CANONICAL',
    profileProvenance: Object.freeze({
      ...source.profileProvenance,
      kind: 'CANONICAL_CHECKER_COUNTEREXAMPLE',
    }),
  });
  assert.equal(validateCounterexampleTriage(relabeled).ok, true);
  const relabeledResult = evaluateCounterexampleTriage(relabeled);
  assert.equal(relabeledResult.status, 'REJECTED_UNVERIFIED_COUNTEREXAMPLE');
  assert.equal(relabeledResult.verificationReasons.includes('CANONICAL_MODEL_HAS_NO_MATCHING_FAILURE'), true);

  const malformed = Object.freeze({ ...source, checkerVersion: null });
  assert.doesNotThrow(() => validateCounterexampleTriage(malformed));
  assert.equal(evaluateCounterexampleTriage(malformed).status, 'REJECTED_INVALID');
});

test('triage rejects accessor-backed profile provenance before authentication or status projection', () => {
  const source = buildCounterexampleTriageFixtures()[0];
  let accessorReads = 0;
  const profileProvenance = { ...source.profileProvenance };
  Object.defineProperty(profileProvenance, 'kind', {
    configurable: true,
    enumerable: true,
    get() {
      accessorReads += 1;
      return accessorReads === 1 ? 'PACKET_NEGATIVE_CONTROL' : 'CANONICAL_CHECKER_COUNTEREXAMPLE';
    },
  });
  const accessorBacked = Object.freeze({ ...source, profileProvenance });

  const validated = validateCounterexampleTriage(accessorBacked);
  assert.equal(validated.ok, false);
  assert.equal(validated.issues.some((entry) => entry.code === 'ACCESSOR_FORBIDDEN'), true);
  assert.equal(evaluateCounterexampleTriage(accessorBacked).status, 'REJECTED_INVALID');
  assert.equal(accessorReads, 0);
});

test('REPRODUCED triage replay requires release, harness, and non-empty evidence', () => {
  const source = buildCounterexampleTriageFixtures()[0];
  const incompleteReplay = Object.freeze({
    ...source,
    implementationReplay: Object.freeze({
      status: 'REPRODUCED',
      implementationReleaseSha: null,
      harness: null,
      evidenceRefs: Object.freeze([]),
    }),
  });
  const validated = validateCounterexampleTriage(incompleteReplay);
  assert.equal(validated.ok, false);
  assert.equal(validated.issues.some((entry) => entry.code === 'REPLAY_RELEASE_REQUIRED'), true);
  assert.equal(validated.issues.some((entry) => entry.code === 'REPLAY_HARNESS_REQUIRED'), true);
  assert.equal(validated.issues.some((entry) => entry.code === 'REPLAY_EVIDENCE_REQUIRED'), true);
  assert.equal(evaluateCounterexampleTriage(incompleteReplay).status, 'REJECTED_INVALID');
});

test('fabricated properties are rejected before counterexample promotion', () => {
  const source = buildCounterexampleTriageFixtures()[0];
  const fake = Object.freeze({ ...source, propertyId: 'FAKE-PROPERTY' });
  const validated = validateCounterexampleTriage(fake);
  assert.equal(validated.ok, false);
  assert.equal(validated.issues.some((issue) => issue.code === 'PROPERTY_UNKNOWN'), true);
  assert.equal(evaluateCounterexampleTriage(fake).runtimeCorpusEligible, false);
  assert.doesNotThrow(() => validateCounterexampleTriage(Object.freeze({ schemaVersion: 'ip-assurance.s3.counterexample-triage.v1' })));
});

test('render-neutral view separates bounded model results from implementation assurance', () => {
  const view = buildFormalPacketView();
  assert.equal(view.generatedAtMs, FORMAL_FIXTURE_TIME_MS);
  assert.equal(view.sourceTruth, 'SYNTHETIC_ONLY');
  assert.equal(view.toolingStatus, 'TLA_TOOLING_NOT_CONFIGURED');
  assert.equal(view.overall.boundedModelStatus, 'BOUNDED_EXHAUSTIVE_PASS');
  assert.equal(view.overall.implementationAssuranceStatus, 'MISMATCH');
  assert.equal(view.overall.runtimeClaimClosure, 'NOT_PERMITTED');
  assert.equal(view.models.length, 13);
  assert.equal(view.models.every((model) => model.sourceTruth === 'SYNTHETIC_ONLY' && model.runtimeWiring === 'NOT_WIRED'), true);
  assert.equal(view.models.reduce((total, model) => total + model.triage.total, 0), 25);
  assert.equal(view.models.every((model) => model.triage.total >= 1 && model.triage.runtimeCorpusEligible === 0), true);
  const inventoryCounts = new Map();
  for (const triage of buildCounterexampleTriageInventory()) {
    inventoryCounts.set(triage.modelId, (inventoryCounts.get(triage.modelId) ?? 0) + 1);
  }
  assert.deepEqual(
    view.models.map((model) => Object.freeze([model.modelId, model.triage.total])),
    view.models.map((model) => Object.freeze([model.modelId, inventoryCounts.get(model.modelId)])),
  );
  assert.equal(view.annunciators.some((entry) => entry.code === 'IMPLEMENTATION_CONFORMANCE_NOT_PROVEN'), true);
  assert.equal(Object.isFrozen(view), true);
});

test('view projection rejects caller verdicts, fabricated hashes, forged checker reports, and triage result objects', () => {
  const reports = runModels(CANONICAL_MODELS);
  const viewInput = (overrides = {}) => ({
    reports,
    conformanceMappings: CONFORMANCE_FIXTURES,
    conformanceVerificationContextsByModel: Object.freeze({}),
    counterexampleTriages: Object.freeze([]),
    triageVerificationContextsById: Object.freeze({}),
    generatedAtMs: FORMAL_FIXTURE_TIME_MS,
    ...overrides,
  });
  const results = CONFORMANCE_FIXTURES.map((fixture) => evaluateConformanceMapping(fixture));
  const bogus = results.map((entry, index) => index === 0 ? Object.freeze({ ...entry, verdict: 'BOGUS' }) : entry);
  assert.throws(() => projectFormalAssuranceView(viewInput({
    conformanceResults: bogus,
  })), /closed plain object/);

  const fabricatedHash = Object.freeze({ ...CONFORMANCE_FIXTURES[0], modelContentSha256: 'f'.repeat(64) });
  assert.throws(() => projectFormalAssuranceView(viewInput({
    conformanceMappings: Object.freeze([fabricatedHash, ...CONFORMANCE_FIXTURES.slice(1)]),
  })), /MODEL_HASH_MISMATCH/);

  const malformedReport = Object.freeze({ ...reports[0], properties: Object.freeze([]) });
  assert.equal(validateExplicitStateReport(malformedReport).ok, false);
  assert.throws(() => projectFormalAssuranceView(viewInput({
    reports: Object.freeze([malformedReport, ...reports.slice(1)]),
  })), /model report 0 is invalid/);

  const forgedReports = [
    Object.freeze({
      ...reports[0],
      exploration: Object.freeze({ ...reports[0].exploration, states: reports[0].exploration.states + 1 }),
    }),
    Object.freeze({
      ...reports[0],
      exploration: Object.freeze({ ...reports[0].exploration, graphFingerprint: '0'.repeat(16) }),
    }),
    Object.freeze({
      ...reports[0],
      properties: Object.freeze(reports[0].properties.map((property, index) => index === 0
        ? Object.freeze({ ...property, detail: 'fabricated checker result' })
        : property)),
    }),
  ];
  for (const forged of forgedReports) {
    const validation = validateExplicitStateReport(forged);
    assert.equal(validation.ok, false);
    assert.equal(validation.issues.some((issue) => issue.code === 'REPORT_IDENTITY_MISMATCH'), true);
    assert.throws(() => projectFormalAssuranceView(viewInput({
      reports: Object.freeze([forged, ...reports.slice(1)]),
    })), /REPORT_IDENTITY_MISMATCH/);
  }

  const forgedAcceptedTriage = Object.freeze({
    status: 'ACCEPTED_FOR_OWNER_INSERTION',
    runtimeCorpusEligible: true,
    destinations: Object.freeze(['IP_PROOF']),
    modelDisposition: 'IMPLEMENTATION_RELEVANT_VALIDATED',
    triageId: 'FORGED-TRIAGE',
    modelId: reports[0].modelId,
    counterexampleSource: 'OWNER_PINNED_CANONICAL_REPLAY',
    verificationReasons: Object.freeze([]),
    issues: Object.freeze([]),
  });
  assert.throws(() => projectFormalAssuranceView(viewInput({
    counterexampleTriages: Object.freeze([forgedAcceptedTriage]),
  })), /counterexample triage 0 is invalid/);

  assert.throws(() => projectFormalAssuranceView(viewInput({ toolingStatus: 'TLA_CHECKED' })), /closed plain object/);

  let topLevelReads = 0;
  const topLevelAccessor = viewInput();
  Object.defineProperty(topLevelAccessor, 'reports', {
    enumerable: true,
    get() {
      topLevelReads += 1;
      return reports;
    },
  });
  assert.throws(() => projectFormalAssuranceView(topLevelAccessor), /cannot be an accessor/);
  assert.equal(topLevelReads, 0);

  let nestedReads = 0;
  const accessorExploration = { ...reports[0].exploration };
  Object.defineProperty(accessorExploration, 'states', {
    enumerable: true,
    get() {
      nestedReads += 1;
      return nestedReads < 3 ? reports[0].exploration.states : 999_999;
    },
  });
  const nestedAccessorReport = Object.freeze({ ...reports[0], exploration: accessorExploration });
  assert.throws(() => projectFormalAssuranceView(viewInput({
    reports: Object.freeze([nestedAccessorReport, ...reports.slice(1)]),
  })), /cannot be an accessor/);
  assert.equal(nestedReads, 0);

  let toolingReads = 0;
  const toolingAccessor = viewInput();
  Object.defineProperty(toolingAccessor, 'toolingStatus', {
    enumerable: true,
    get() {
      toolingReads += 1;
      return 'TLA_CHECKED';
    },
  });
  assert.throws(() => projectFormalAssuranceView(toolingAccessor), /cannot be an accessor/);
  assert.equal(toolingReads, 0);
});

test('explicit-state report validation rejects null or partial rows without throwing', () => {
  const report = runModels(CANONICAL_MODELS)[0];
  for (const properties of [
    Object.freeze([null]),
    Object.freeze([Object.freeze({ propertyId: 'S3-SAF-04' })]),
  ]) {
    const malformed = Object.freeze({ ...report, properties });
    assert.doesNotThrow(() => validateExplicitStateReport(malformed));
    assert.equal(validateExplicitStateReport(malformed).ok, false);
  }
  const nullCoverage = Object.freeze({
    ...report,
    exploration: Object.freeze({ ...report.exploration, actionCoverage: Object.freeze([null]) }),
  });
  assert.doesNotThrow(() => validateExplicitStateReport(nullCoverage));
  assert.equal(validateExplicitStateReport(nullCoverage).ok, false);
});

test('explicit-state report validation binds model identity and rejects impossible exploration coherence', () => {
  const canonical = runModels(CANONICAL_MODELS)[0];
  const negative = runModels(NEGATIVE_CONTROL_MODELS)[0];
  const canonicalValidation = validateExplicitStateReport(canonical);
  assert.equal(canonicalValidation.ok, true);
  assert.equal(Object.isFrozen(canonicalValidation.value), true);
  assert.notEqual(canonicalValidation.value, canonical);
  assert.equal(validateExplicitStateReport(negative).ok, true);

  const cases = [
    [Object.freeze({
      ...canonical,
      exploration: Object.freeze({ ...canonical.exploration, states: canonical.executedBounds.maxStates + 1 }),
    }), 'COUNT_EXCEEDS_BOUND'],
    [Object.freeze({
      ...canonical,
      exploration: Object.freeze({ ...canonical.exploration, actionCoverage: Object.freeze([]) }),
    }), 'ACTION_COVERAGE_MISMATCH'],
    [Object.freeze({
      ...canonical,
      exploration: Object.freeze({
        ...canonical.exploration,
        deadlocks: canonical.exploration.states,
      }),
    }), 'STATE_PARTITION_INVALID'],
    [Object.freeze({
      ...canonical,
      exploration: Object.freeze({ ...canonical.exploration, truncatedReasons: Object.freeze(['MAX_STATES']) }),
    }), 'EXPLORATION_STATUS_CONFLICT'],
    [Object.freeze({
      ...canonical,
      executedBounds: Object.freeze({ ...canonical.executedBounds, maxStates: canonical.declaredBounds.maxStates + 1 }),
    }), 'EXECUTED_BOUNDS_EXCEED_DECLARED'],
  ];
  for (const [forged, expectedCode] of cases) {
    const validation = validateExplicitStateReport(forged);
    assert.equal(validation.ok, false);
    assert.equal(validation.issues.some((entry) => entry.code === expectedCode), true, expectedCode);
  }

  const reproducedFalseGreen = Object.freeze({
    ...canonical,
    properties: Object.freeze([canonical.properties[0]]),
    exploration: Object.freeze({
      ...canonical.exploration,
      states: 999_999,
      deadlocks: 999_999,
      graphFingerprint: '0'.repeat(16),
      actionCoverage: Object.freeze([]),
    }),
  });
  const falseGreenValidation = validateExplicitStateReport(reproducedFalseGreen);
  assert.equal(falseGreenValidation.ok, false);
  for (const code of ['COUNT_EXCEEDS_BOUND', 'STATE_PARTITION_INVALID', 'ACTION_COVERAGE_MISMATCH', 'MODEL_PROPERTY_SET_MISMATCH']) {
    assert.equal(falseGreenValidation.issues.some((entry) => entry.code === code), true, code);
  }
});

test('explicit-state report validation rejects accessors without invoking them', () => {
  const report = runModels(CANONICAL_MODELS)[0];
  let topLevelReads = 0;
  const topLevelAccessor = { ...report };
  Object.defineProperty(topLevelAccessor, 'overallStatus', {
    enumerable: true,
    get() {
      topLevelReads += 1;
      return topLevelReads === 1 ? 'PASS' : 'FAIL';
    },
  });
  const topLevelValidation = validateExplicitStateReport(topLevelAccessor);
  assert.equal(topLevelValidation.ok, false);
  assert.equal(topLevelValidation.issues.some((entry) => entry.code === 'INPUT_SNAPSHOT_INVALID'), true);
  assert.equal(topLevelReads, 0);

  let nestedReads = 0;
  const exploration = { ...report.exploration };
  Object.defineProperty(exploration, 'states', {
    enumerable: true,
    get() {
      nestedReads += 1;
      return nestedReads < 3 ? report.exploration.states : 999_999;
    },
  });
  const nestedAccessor = Object.freeze({ ...report, exploration });
  const nestedValidation = validateExplicitStateReport(nestedAccessor);
  assert.equal(nestedValidation.ok, false);
  assert.equal(nestedValidation.issues.some((entry) => entry.code === 'INPUT_SNAPSHOT_INVALID'), true);
  assert.equal(nestedReads, 0);
});

test('packet JSON schemas parse, use draft 2020-12, and close object extension points', () => {
  const schemaDir = fileURLToPath(new URL('../../../../fixtures/productAssurance/systemic/formal/contracts/schemas/', import.meta.url));
  for (const name of [
    'conformance-map.v1.schema.json',
    'counterexample-triage.v1.schema.json',
    'explicit-state-report.v1.schema.json',
  ]) {
    const schema = JSON.parse(readFileSync(`${schemaDir}${name}`, 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.equal(schema.additionalProperties, false);
    assert.equal(typeof schema.$id, 'string');
  }
});

test('manifest IDs and hashes cover exactly the canonical model reports', () => {
  const reports = runModels(CANONICAL_MODELS);
  assert.deepEqual(Object.keys(MODEL_HASHES).sort(), reports.map((report) => report.modelId).sort());
  for (const report of reports) {
    assert.match(MODEL_MANIFEST_BY_ID[report.modelId].bundleSha256, /^[a-f0-9]{64}$/);
  }
});
