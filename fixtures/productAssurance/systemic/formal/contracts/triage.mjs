import { createHash } from 'node:crypto';

import { REPLAY_STATUSES, TRIAGE_DISPOSITIONS } from './vocabularies.mjs';
import {
  canonicalJson,
  cloneFrozenJson,
  EXPLICIT_STATE_CHECKER,
  exploreModel,
} from '../explicitState/kernel.mjs';
import { CANONICAL_MODELS, NEGATIVE_CONTROL_MODELS } from '../explicitState/index.mjs';
import { PROPERTY_BY_ID } from '../explicitState/properties.mjs';
import {
  MODEL_MANIFEST_BY_ID,
  MODEL_MANIFEST_SCHEMA,
} from '../fixtures/model-manifest.mjs';
import {
  boundedString,
  boundedStringArray,
  enumValue,
  exactKeys,
  gitSha,
  isPlainObject,
  issue,
  result,
  safeInteger,
  sha256,
  stableId,
} from './validation.mjs';

export const COUNTEREXAMPLE_TRIAGE_SCHEMA = 'ip-assurance.s3.counterexample-triage.v1';
export const COUNTEREXAMPLE_TRACE_HASH_DOMAIN = 'ip-assurance.s3.counterexample-trace.v1';
export const COUNTEREXAMPLE_BINDING_HASH_DOMAIN = 'ip-assurance.s3.counterexample-binding.v1';

const ACTION_ID = /^[A-Z][A-Z0-9_]{1,95}$/;
const GRAPH_FINGERPRINT = /^[a-f0-9]{16}$/;
const PROFILE_KINDS = Object.freeze([
  'PACKET_NEGATIVE_CONTROL',
  'CANONICAL_CHECKER_COUNTEREXAMPLE',
]);
const MAX_INPUT_GRAPH_NODES = 100_000;

function validatePlainDataGraph(value, path, issues, ancestors = new Set(), budget = { remaining: MAX_INPUT_GRAPH_NODES }) {
  if (value === null || typeof value !== 'object') return true;
  if (budget.remaining <= 0) {
    issues.push(issue(path, 'INPUT_GRAPH_TOO_LARGE', `input graph exceeds ${MAX_INPUT_GRAPH_NODES} objects and arrays`));
    return false;
  }
  budget.remaining -= 1;
  if (ancestors.has(value)) {
    issues.push(issue(path, 'CYCLIC_INPUT', 'input must be an acyclic JSON data graph'));
    return false;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    issues.push(issue(path, 'PLAIN_DATA_REQUIRED', 'input objects must use the ordinary object or null prototype'));
    return false;
  }

  let valid = true;
  ancestors.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (Array.isArray(value) && key === 'length') continue;
    const childPath = typeof key === 'symbol' ? `${path}.[symbol]` : `${path}.${key}`;
    if (typeof key === 'symbol') {
      issues.push(issue(childPath, 'SYMBOL_PROPERTY_FORBIDDEN', 'symbol properties are not JSON data'));
      valid = false;
      continue;
    }
    if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) {
      issues.push(issue(childPath, 'ARRAY_PROPERTY_FORBIDDEN', 'arrays may contain indexed elements only'));
      valid = false;
      continue;
    }
    if (descriptor.get !== undefined || descriptor.set !== undefined) {
      issues.push(issue(childPath, 'ACCESSOR_FORBIDDEN', 'getters and setters are not accepted assurance data'));
      valid = false;
      continue;
    }
    if (!descriptor.enumerable) {
      issues.push(issue(childPath, 'NON_ENUMERABLE_PROPERTY_FORBIDDEN', 'non-enumerable properties are not JSON data'));
      valid = false;
      continue;
    }
    if (!validatePlainDataGraph(descriptor.value, childPath, issues, ancestors, budget)) valid = false;
  }
  ancestors.delete(value);
  return valid;
}

function snapshotPlainData(value) {
  const issues = [];
  try {
    if (!validatePlainDataGraph(value, '$', issues)) return Object.freeze({ ok: false, issues: Object.freeze(issues) });
    return Object.freeze({ ok: true, value: cloneFrozenJson(value) });
  } catch (error) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([issue('$', 'SNAPSHOT_FAILED', `${error.name}: ${error.message}`)]),
    });
  }
}

function hashCanonical(domain, value) {
  return createHash('sha256')
    .update(`${domain}\n${canonicalJson(value)}\n`, 'utf8')
    .digest('hex');
}

export function computeCounterexampleTraceSha256(trace) {
  return hashCanonical(COUNTEREXAMPLE_TRACE_HASH_DOMAIN, trace);
}

function counterexampleBinding(value) {
  return Object.freeze({
    schemaVersion: value.schemaVersion,
    modelId: value.modelId,
    modelVersion: value.modelVersion,
    modelContentSha256: value.modelContentSha256,
    modelProfile: value.modelProfile,
    profileProvenance: value.profileProvenance,
    propertyId: value.propertyId,
    checkerId: value.checkerId,
    checkerVersion: value.checkerVersion,
    bounds: value.bounds,
    assumptions: value.assumptions,
    traceSha256: value.traceSha256,
    firstBadIndex: value.firstBadIndex,
  });
}

export function computeCounterexampleBindingSha256(value) {
  return hashCanonical(COUNTEREXAMPLE_BINDING_HASH_DOMAIN, counterexampleBinding(value));
}

function validateBounds(value, issues) {
  if (!exactKeys(value, ['maxStates', 'maxTransitions', 'maxDepth'], '$.bounds', issues)) return;
  safeInteger(value.maxStates, '$.bounds.maxStates', issues, { min: 1, max: 1_000_000 });
  safeInteger(value.maxTransitions, '$.bounds.maxTransitions', issues, { min: 1, max: 10_000_000 });
  safeInteger(value.maxDepth, '$.bounds.maxDepth', issues, { min: 1, max: 100_000 });
}

function validateProfileProvenance(value, issues) {
  if (!exactKeys(value, ['kind', 'sourceRef', 'graphFingerprint', 'evidenceRefs'], '$.profileProvenance', issues)) return;
  enumValue(value.kind, PROFILE_KINDS, '$.profileProvenance.kind', issues);
  boundedString(value.sourceRef, '$.profileProvenance.sourceRef', issues, { max: 500 });
  boundedString(value.graphFingerprint, '$.profileProvenance.graphFingerprint', issues, {
    min: 16,
    max: 16,
    pattern: GRAPH_FINGERPRINT,
  });
  boundedStringArray(value.evidenceRefs, '$.profileProvenance.evidenceRefs', issues, { min: 1, max: 32, itemMax: 500 });
}

function validateTrace(value, issues) {
  if (!exactKeys(value, ['steps', 'loopStart'], '$.trace', issues)) return;
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 1_024) {
    issues.push(issue('$.trace.steps', 'ARRAY_BOUNDS', 'trace must contain 1..1024 steps'));
  } else {
    for (let index = 0; index < value.steps.length; index += 1) {
      const step = value.steps[index];
      const path = `$.trace.steps[${index}]`;
      if (!exactKeys(step, ['index', 'actionId', 'state'], path, issues)) continue;
      safeInteger(step.index, `${path}.index`, issues, { min: index, max: index });
      boundedString(step.actionId, `${path}.actionId`, issues, { min: 2, max: 96, pattern: ACTION_ID });
      if (index === 0 && step.actionId !== 'INIT') {
        issues.push(issue(`${path}.actionId`, 'TRACE_INIT_REQUIRED', 'the first trace action must be INIT'));
      }
      if (!isPlainObject(step.state)) {
        issues.push(issue(`${path}.state`, 'OBJECT_REQUIRED', 'state must be a plain object'));
      } else {
        try {
          if (canonicalJson(step.state).length > 100_000) {
            issues.push(issue(`${path}.state`, 'STATE_TOO_LARGE', 'canonical state exceeds 100000 characters'));
          }
        } catch (error) {
          issues.push(issue(`${path}.state`, 'STATE_NOT_CANONICAL_JSON', `${error.name}: ${error.message}`));
        }
      }
    }
  }
  if (value.loopStart !== null) {
    safeInteger(value.loopStart, '$.trace.loopStart', issues, { min: 0, max: Math.max(0, (value.steps?.length ?? 1) - 1) });
  }
}

function validateReplay(value, issues) {
  if (!exactKeys(value, ['status', 'implementationReleaseSha', 'harness', 'evidenceRefs'], '$.implementationReplay', issues)) return;
  enumValue(value.status, REPLAY_STATUSES, '$.implementationReplay.status', issues);
  if (value.implementationReleaseSha !== null) gitSha(value.implementationReleaseSha, '$.implementationReplay.implementationReleaseSha', issues);
  if (value.harness !== null) boundedString(value.harness, '$.implementationReplay.harness', issues, { max: 500 });
  boundedStringArray(value.evidenceRefs, '$.implementationReplay.evidenceRefs', issues, { max: 32, itemMax: 500 });
  if (value.status === 'REPRODUCED') {
    if (value.implementationReleaseSha === null) {
      issues.push(issue('$.implementationReplay.implementationReleaseSha', 'REPLAY_RELEASE_REQUIRED', 'REPRODUCED replay requires an implementation release SHA'));
    }
    if (value.harness === null) {
      issues.push(issue('$.implementationReplay.harness', 'REPLAY_HARNESS_REQUIRED', 'REPRODUCED replay requires an ordinary harness'));
    }
    if (Array.isArray(value.evidenceRefs) && value.evidenceRefs.length === 0) {
      issues.push(issue('$.implementationReplay.evidenceRefs', 'REPLAY_EVIDENCE_REQUIRED', 'REPRODUCED replay requires evidence'));
    }
  }
}

export function validateCounterexampleTriage(value) {
  const issues = [];
  try {
    const snapshot = snapshotPlainData(value);
    if (!snapshot.ok) return result(null, snapshot.issues);
    value = snapshot.value;
    const keys = [
      'schemaVersion', 'triageId', 'modelId', 'modelVersion', 'modelContentSha256',
      'modelProfile', 'profileProvenance', 'propertyId', 'checkerId', 'checkerVersion',
      'bounds', 'assumptions', 'trace', 'traceSha256', 'firstBadIndex', 'disposition',
      'evidenceRefs', 'reachabilityBasis', 'implementationReplay', 'reviewer', 'reviewedAtMs',
    ];
    if (!exactKeys(value, keys, '$', issues)) return result(null, issues);
    if (value.schemaVersion !== COUNTEREXAMPLE_TRIAGE_SCHEMA) issues.push(issue('$.schemaVersion', 'SCHEMA_UNSUPPORTED', 'unsupported triage schema'));
    stableId(value.triageId, '$.triageId', issues);
    stableId(value.modelId, '$.modelId', issues);
    boundedString(value.modelVersion, '$.modelVersion', issues, { max: 80 });
    sha256(value.modelContentSha256, '$.modelContentSha256', issues);
    stableId(value.modelProfile, '$.modelProfile', issues);
    validateProfileProvenance(value.profileProvenance, issues);
    stableId(value.propertyId, '$.propertyId', issues);
    if (PROPERTY_BY_ID[value.propertyId] === undefined) issues.push(issue('$.propertyId', 'PROPERTY_UNKNOWN', 'property is not in the packet catalog'));
    stableId(value.checkerId, '$.checkerId', issues);
    if (boundedString(value.checkerVersion, '$.checkerVersion', issues, { max: 80 })) {
      const normalizedVersion = value.checkerVersion.toUpperCase();
      if (normalizedVersion.startsWith('UNKNOWN') || normalizedVersion.startsWith('UNVERIFIED')) {
        issues.push(issue('$.checkerVersion', 'CHECKER_VERSION_UNVERIFIED', 'checker version must be concrete'));
      }
    }
    validateBounds(value.bounds, issues);
    boundedStringArray(value.assumptions, '$.assumptions', issues, { min: 1, max: 32, itemMax: 500 });
    validateTrace(value.trace, issues);
    sha256(value.traceSha256, '$.traceSha256', issues);
    try {
      if (computeCounterexampleTraceSha256(value.trace) !== value.traceSha256) {
        issues.push(issue('$.traceSha256', 'TRACE_HASH_MISMATCH', 'trace does not match its declared SHA-256'));
      }
    } catch (error) {
      issues.push(issue('$.traceSha256', 'TRACE_HASH_UNAVAILABLE', `${error.name}: ${error.message}`));
    }
    safeInteger(value.firstBadIndex, '$.firstBadIndex', issues, { min: 0, max: Math.max(0, (value.trace?.steps?.length ?? 1) - 1) });
    enumValue(value.disposition, TRIAGE_DISPOSITIONS, '$.disposition', issues);
    boundedStringArray(value.evidenceRefs, '$.evidenceRefs', issues, { min: 1, max: 32, itemMax: 500 });
    boundedString(value.reachabilityBasis, '$.reachabilityBasis', issues, { max: 1_000 });
    validateReplay(value.implementationReplay, issues);
    boundedString(value.reviewer, '$.reviewer', issues, { max: 160 });
    safeInteger(value.reviewedAtMs, '$.reviewedAtMs', issues, { min: 0 });

    if (isPlainObject(value.profileProvenance)) {
      if (value.profileProvenance.kind === 'PACKET_NEGATIVE_CONTROL' && value.modelProfile === 'CANONICAL') {
        issues.push(issue('$.modelProfile', 'PROFILE_KIND_MISMATCH', 'a negative-control profile cannot be CANONICAL'));
      }
      if (value.profileProvenance.kind === 'CANONICAL_CHECKER_COUNTEREXAMPLE' && value.modelProfile !== 'CANONICAL') {
        issues.push(issue('$.modelProfile', 'PROFILE_KIND_MISMATCH', 'canonical checker counterexamples must use the CANONICAL profile'));
      }
    }
  } catch (error) {
    issues.push(issue('$', 'VALIDATION_EXCEPTION', `${error.name}: ${error.message}`));
  }
  return result(value, issues);
}

function modelSourceRef(manifest) {
  return manifest?.files?.find((file) => file.path.startsWith('explicitState/model-') && file.path.endsWith('.mjs'))?.path ?? null;
}

function normalizeFailureTrace(property) {
  if (property.kind === 'SAFETY') return Object.freeze({ steps: property.trace, loopStart: null });
  return property.trace;
}

function verifyExactPacketNegativeControl(value) {
  if (value.profileProvenance.kind !== 'PACKET_NEGATIVE_CONTROL') {
    return Object.freeze({ verified: false, reason: 'NOT_PACKET_NEGATIVE_CONTROL' });
  }
  const model = NEGATIVE_CONTROL_MODELS.find((candidate) => (
    candidate.modelId === value.modelId && candidate.profile === value.modelProfile
  ));
  const manifest = MODEL_MANIFEST_BY_ID[value.modelId];
  if (model === undefined || manifest === undefined) {
    return Object.freeze({ verified: false, reason: 'NEGATIVE_CONTROL_PROFILE_UNKNOWN' });
  }
  const report = exploreModel(model);
  const property = report.properties.find((entry) => entry.propertyId === value.propertyId && entry.status === 'FAIL' && entry.trace !== null);
  if (property === undefined) return Object.freeze({ verified: false, reason: 'NEGATIVE_CONTROL_PROPERTY_NOT_FAILED' });
  const expectedTrace = normalizeFailureTrace(property);
  const expectedEvidence = `${modelSourceRef(manifest)}#profile=${model.profile}`;
  const exact = report.schemaVersion === 'ip-assurance.s3.explicit-state-report.v1'
    && report.exploration.status === 'EXHAUSTIVE'
    && report.modelVersion === value.modelVersion
    && manifest.modelVersion === value.modelVersion
    && manifest.bundleSha256 === value.modelContentSha256
    && report.checker.checkerId === value.checkerId
    && report.checker.checkerVersion === value.checkerVersion
    && canonicalJson(report.executedBounds) === canonicalJson(value.bounds)
    && canonicalJson(report.assumptions) === canonicalJson(value.assumptions)
    && report.exploration.graphFingerprint === value.profileProvenance.graphFingerprint
    && modelSourceRef(manifest) === value.profileProvenance.sourceRef
    && value.profileProvenance.evidenceRefs.includes(expectedEvidence)
    && canonicalJson(expectedTrace) === canonicalJson(value.trace)
    && computeCounterexampleTraceSha256(expectedTrace) === value.traceSha256
    && value.firstBadIndex === expectedTrace.steps.length - 1;
  return exact
    ? Object.freeze({ verified: true, reason: null, source: 'EXACT_PACKET_NEGATIVE_CONTROL' })
    : Object.freeze({ verified: false, reason: 'NEGATIVE_CONTROL_TRACE_MISMATCH' });
}

function verifyExactCanonicalCounterexample(value) {
  if (value.modelProfile !== 'CANONICAL' || value.profileProvenance.kind !== 'CANONICAL_CHECKER_COUNTEREXAMPLE') {
    return Object.freeze({ verified: false, reason: 'NOT_CANONICAL_CHECKER_COUNTEREXAMPLE' });
  }
  const model = CANONICAL_MODELS.find((candidate) => candidate.modelId === value.modelId && candidate.profile === 'CANONICAL');
  const manifest = MODEL_MANIFEST_BY_ID[value.modelId];
  if (model === undefined || manifest === undefined) {
    return Object.freeze({ verified: false, reason: 'CANONICAL_MODEL_PROFILE_UNKNOWN' });
  }
  const report = exploreModel(model);
  const property = report.properties.find((entry) => entry.propertyId === value.propertyId && entry.status === 'FAIL' && entry.trace !== null);
  if (property === undefined) return Object.freeze({ verified: false, reason: 'CANONICAL_MODEL_HAS_NO_MATCHING_FAILURE' });
  const expectedTrace = normalizeFailureTrace(property);
  const expectedEvidence = `${modelSourceRef(manifest)}#profile=CANONICAL`;
  const exact = report.exploration.status === 'EXHAUSTIVE'
    && report.modelVersion === value.modelVersion
    && manifest.modelVersion === value.modelVersion
    && manifest.bundleSha256 === value.modelContentSha256
    && report.checker.checkerId === value.checkerId
    && report.checker.checkerVersion === value.checkerVersion
    && canonicalJson(report.executedBounds) === canonicalJson(value.bounds)
    && canonicalJson(report.assumptions) === canonicalJson(value.assumptions)
    && report.exploration.graphFingerprint === value.profileProvenance.graphFingerprint
    && modelSourceRef(manifest) === value.profileProvenance.sourceRef
    && value.profileProvenance.evidenceRefs.includes(expectedEvidence)
    && canonicalJson(expectedTrace) === canonicalJson(value.trace)
    && computeCounterexampleTraceSha256(expectedTrace) === value.traceSha256
    && value.firstBadIndex === expectedTrace.steps.length - 1;
  return exact
    ? Object.freeze({ verified: true, reason: null })
    : Object.freeze({ verified: false, reason: 'CANONICAL_COUNTEREXAMPLE_TRACE_MISMATCH' });
}

function verifiedEvidenceSet(context) {
  return new Set(Array.isArray(context?.verifiedEvidenceRefs) ? context.verifiedEvidenceRefs : []);
}

function findOwnerPinnedCanonicalReplay(value, context) {
  if (value.modelProfile !== 'CANONICAL' || value.profileProvenance.kind !== 'CANONICAL_CHECKER_COUNTEREXAMPLE') return null;
  const bindingSha256 = computeCounterexampleBindingSha256(value);
  const verifiedEvidence = verifiedEvidenceSet(context);
  const records = Array.isArray(context?.ownerPinnedCanonicalCounterexamples)
    ? context.ownerPinnedCanonicalCounterexamples
    : [];
  return records.find((record) => isPlainObject(record)
    && record.authority === 'CANONICAL_OWNER_PINNED'
    && record.status === 'EXACT_REPLAY_VERIFIED'
    && record.counterexampleBindingSha256 === bindingSha256
    && record.implementationReleaseSha === value.implementationReplay.implementationReleaseSha
    && record.harness === value.implementationReplay.harness
    && Array.isArray(record.evidenceRefs)
    && record.evidenceRefs.length > 0
    && record.evidenceRefs.every((entry) => verifiedEvidence.has(entry))) ?? null;
}

function authenticateCounterexample(value, context) {
  const negativeControl = verifyExactPacketNegativeControl(value);
  if (negativeControl.verified) return negativeControl;
  const canonicalCounterexample = verifyExactCanonicalCounterexample(value);
  const ownerPinned = canonicalCounterexample.verified ? findOwnerPinnedCanonicalReplay(value, context) : null;
  if (canonicalCounterexample.verified && ownerPinned !== null) {
    return Object.freeze({ verified: true, reason: null, source: 'OWNER_PINNED_CANONICAL_REPLAY' });
  }
  return Object.freeze({
    verified: false,
    reason: negativeControl.reason !== 'NOT_PACKET_NEGATIVE_CONTROL'
      ? negativeControl.reason
      : (canonicalCounterexample.verified
        ? 'OWNER_PINNED_CANONICAL_REPLAY_MISSING'
        : canonicalCounterexample.reason),
  });
}

function verifyPromotionContext(value, context, counterexampleAuthentication) {
  const reasons = [];
  if (!isPlainObject(context)) return Object.freeze(['VERIFICATION_CONTEXT_MISSING']);
  if (context.verificationAuthority !== 'INDEPENDENT_READBACK') reasons.push('INDEPENDENT_VERIFICATION_AUTHORITY_MISSING');

  const manifest = MODEL_MANIFEST_BY_ID[value.modelId];
  if (manifest === undefined
    || manifest.modelVersion !== value.modelVersion
    || manifest.bundleSha256 !== value.modelContentSha256) reasons.push('PACKET_MODEL_MANIFEST_MISMATCH');

  const model = isPlainObject(context.modelIdentity) ? context.modelIdentity : null;
  if (model === null
    || model.manifestSchemaVersion !== MODEL_MANIFEST_SCHEMA
    || model.acceptance !== 'ACCEPTED_READBACK'
    || model.modelId !== value.modelId
    || model.modelVersion !== value.modelVersion
    || model.modelContentSha256 !== value.modelContentSha256
    || !Array.isArray(model.propertyIds)
    || !model.propertyIds.includes(value.propertyId)
    || !Array.isArray(model.profileIds)
    || !model.profileIds.includes(value.modelProfile)) reasons.push('MODEL_MANIFEST_MISMATCH');

  const profile = isPlainObject(context.profileIdentity) ? context.profileIdentity : null;
  if (profile === null
    || profile.modelId !== value.modelId
    || profile.modelProfile !== value.modelProfile
    || profile.kind !== value.profileProvenance.kind
    || profile.sourceRef !== value.profileProvenance.sourceRef
    || profile.graphFingerprint !== value.profileProvenance.graphFingerprint) reasons.push('PROFILE_PROVENANCE_MISMATCH');

  const checker = isPlainObject(context.checkerIdentity) ? context.checkerIdentity : null;
  if (checker === null
    || checker.checkerId !== value.checkerId
    || checker.checkerVersion !== value.checkerVersion
    || checker.checkerId !== EXPLICIT_STATE_CHECKER.checkerId
    || checker.checkerVersion !== EXPLICIT_STATE_CHECKER.checkerVersion) reasons.push('CHECKER_IDENTITY_MISMATCH');
  if (!counterexampleAuthentication.verified) reasons.push(counterexampleAuthentication.reason);
  if (value.profileProvenance.kind === 'PACKET_NEGATIVE_CONTROL') reasons.push('NEGATIVE_CONTROL_PROFILE_NOT_RUNTIME_EVIDENCE');
  if (counterexampleAuthentication.source !== 'OWNER_PINNED_CANONICAL_REPLAY') reasons.push('OWNER_PINNED_CANONICAL_REPLAY_REQUIRED');
  if (context.implementationReleaseSha !== value.implementationReplay.implementationReleaseSha) reasons.push('IMPLEMENTATION_RELEASE_MISMATCH');
  const harnesses = new Set(Array.isArray(context.ordinaryHarnesses) ? context.ordinaryHarnesses : []);
  if (value.implementationReplay.harness === null || !harnesses.has(value.implementationReplay.harness)) reasons.push('ORDINARY_HARNESS_NOT_VERIFIED');
  const evidence = verifiedEvidenceSet(context);
  const evidenceRefs = [
    ...value.evidenceRefs,
    ...value.profileProvenance.evidenceRefs,
    ...value.implementationReplay.evidenceRefs,
  ];
  if (!evidenceRefs.every((entry) => evidence.has(entry))) reasons.push('EVIDENCE_READBACK_NOT_VERIFIED');
  const reviewers = new Set(Array.isArray(context.acceptedReviewers) ? context.acceptedReviewers : []);
  if (!reviewers.has(value.reviewer)) reasons.push('REVIEWER_NOT_ACCEPTED');
  return Object.freeze([...new Set(reasons)].sort());
}

export function evaluateCounterexampleTriage(value, context = null) {
  let validated;
  try {
    validated = validateCounterexampleTriage(value);
  } catch (error) {
    validated = Object.freeze({ ok: false, issues: Object.freeze([issue('$', 'VALIDATION_EXCEPTION', `${error.name}: ${error.message}`)]) });
  }
  if (!validated.ok) {
    return Object.freeze({
      status: 'REJECTED_INVALID',
      runtimeCorpusEligible: false,
      destinations: Object.freeze([]),
      verificationReasons: Object.freeze(['TRIAGE_INPUT_INVALID']),
      issues: validated.issues,
    });
  }

  value = validated.value;
  if (context !== null) {
    const contextSnapshot = snapshotPlainData(context);
    context = contextSnapshot.ok ? contextSnapshot.value : null;
  }

  const counterexampleAuthentication = authenticateCounterexample(value, context);
  if (!counterexampleAuthentication.verified) {
    return Object.freeze({
      status: 'REJECTED_UNVERIFIED_COUNTEREXAMPLE',
      runtimeCorpusEligible: false,
      destinations: Object.freeze([]),
      modelDisposition: value.disposition,
      triageId: value.triageId,
      modelId: value.modelId,
      verificationReasons: Object.freeze([counterexampleAuthentication.reason]),
      issues: Object.freeze([]),
    });
  }

  const isImplementationCandidate = value.disposition === 'IMPLEMENTATION_RELEVANT_VALIDATED';
  const replayReproduced = value.implementationReplay.status === 'REPRODUCED'
    && value.implementationReplay.implementationReleaseSha !== null
    && value.implementationReplay.harness !== null
    && value.implementationReplay.evidenceRefs.length > 0;
  const verificationReasons = isImplementationCandidate
    ? verifyPromotionContext(value, context, counterexampleAuthentication)
    : (value.profileProvenance.kind === 'PACKET_NEGATIVE_CONTROL'
      ? Object.freeze(['NEGATIVE_CONTROL_PROFILE_NOT_RUNTIME_EVIDENCE'])
      : Object.freeze([]));
  const eligible = isImplementationCandidate
    && replayReproduced
    && counterexampleAuthentication.source === 'OWNER_PINNED_CANONICAL_REPLAY'
    && verificationReasons.length === 0;
  let status;
  if (eligible) status = 'ACCEPTED_FOR_OWNER_INSERTION';
  else if (isImplementationCandidate && value.profileProvenance.kind === 'PACKET_NEGATIVE_CONTROL') status = 'REJECTED_NEGATIVE_CONTROL';
  else if (isImplementationCandidate) status = 'PENDING_IMPLEMENTATION_VALIDATION';
  else if (value.disposition === 'UNRESOLVED') status = 'UNRESOLVED';
  else status = 'MODEL_LIMITATION_ONLY';

  return Object.freeze({
    status,
    runtimeCorpusEligible: eligible,
    destinations: eligible
      ? Object.freeze(['FAULT_INJECTION_AND_SOAK_REPORT', 'OPERATIONAL_FAILURE_ATLAS', 'SAFETY_INVARIANT_CATALOG', 'IP_PROOF'])
      : Object.freeze([]),
    modelDisposition: value.disposition,
    triageId: value.triageId,
    modelId: value.modelId,
    counterexampleSource: counterexampleAuthentication.source,
    verificationReasons,
    issues: Object.freeze([]),
  });
}
