import { types as utilTypes } from 'node:util';

import { PROPERTY_CATALOG } from '../explicitState/properties.mjs';
import { CANONICAL_MODELS } from '../explicitState/index.mjs';
import { canonicalJson, runModels } from '../explicitState/kernel.mjs';
import { MODEL_MANIFEST, MODEL_MANIFEST_BY_ID } from '../fixtures/model-manifest.mjs';
import { evaluateConformanceMapping, validateConformanceMapping } from './conformance.mjs';
import { validateExplicitStateReport } from './report.mjs';
import { evaluateCounterexampleTriage, validateCounterexampleTriage } from './triage.mjs';
import { CONFORMANCE_VERDICTS } from './vocabularies.mjs';
import { isPlainObject } from './validation.mjs';

export const FORMAL_VIEW_MODEL_SCHEMA = 'ip-assurance.s3.formal-view-model.v1';

const IMPLEMENTATION_PRECEDENCE = Object.freeze({
  SUPPORTING_EVIDENCE: 0,
  REFERENCE_ONLY: 1,
  UNKNOWN: 2,
  MISMATCH: 3,
});
const REQUIRED_AMENDMENT_PROPERTIES = Object.freeze(PROPERTY_CATALOG
  .filter((entry) => /^S3-(SAF|LIV)-/.test(entry.propertyId))
  .map((entry) => entry.propertyId));
const CANONICAL_MODEL_IDS = Object.freeze(MODEL_MANIFEST.map((entry) => entry.modelId).sort());
const PACKET_TOOLING_STATUS = 'TLA_TOOLING_NOT_CONFIGURED';
const MAX_SNAPSHOT_ARRAY_LENGTH = 100_000;
const MAX_SNAPSHOT_OBJECT_KEYS = 10_000;

function snapshotData(value, path = '$', ancestors = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains a non-data value`);
  if (utilTypes.isProxy(value)) throw new TypeError(`${path} cannot be a Proxy`);
  const isArray = Array.isArray(value);
  if (!isArray && !isPlainObject(value)) throw new TypeError(`${path} must contain only arrays and plain objects`);
  if (ancestors.has(value)) throw new TypeError(`${path} contains a cycle`);
  ancestors.add(value);
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key === 'symbol')) throw new TypeError(`${path} cannot contain symbol fields`);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (Object.hasOwn(descriptor, 'get') || Object.hasOwn(descriptor, 'set')) {
        throw new TypeError(`${path}.${String(key)} cannot be an accessor`);
      }
    }
    if (isArray) {
      const length = descriptors.length?.value;
      if (!Number.isSafeInteger(length) || length < 0 || length > MAX_SNAPSHOT_ARRAY_LENGTH) throw new TypeError(`${path} has an invalid array length`);
      const indexKeys = keys.filter((key) => key !== 'length');
      if (indexKeys.length !== length) throw new TypeError(`${path} must be a dense array without extra fields`);
      const snapshot = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = descriptors[key];
        if (descriptor === undefined || descriptor.enumerable !== true) throw new TypeError(`${path}[${index}] must be an enumerable data field`);
        snapshot[index] = snapshotData(descriptor.value, `${path}[${index}]`, ancestors);
      }
      return Object.freeze(snapshot);
    }
    if (keys.length > MAX_SNAPSHOT_OBJECT_KEYS) throw new TypeError(`${path} has too many fields`);
    const prototype = Object.getPrototypeOf(value);
    const snapshot = Object.create(prototype === null ? null : Object.prototype);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (descriptor.enumerable !== true) throw new TypeError(`${path}.${key} must be an enumerable data field`);
      Object.defineProperty(snapshot, key, {
        value: snapshotData(descriptor.value, `${path}.${key}`, ancestors),
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    return Object.freeze(snapshot);
  } finally {
    ancestors.delete(value);
  }
}

function hasExactKeys(value, keys) {
  if (!isPlainObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function assertInput(input) {
  const expectedModelCount = CANONICAL_MODEL_IDS.length;
  const inputKeys = [
    'reports', 'conformanceMappings', 'conformanceVerificationContextsByModel',
    'counterexampleTriages', 'triageVerificationContextsById', 'generatedAtMs',
  ];
  if (!hasExactKeys(input, inputKeys)) throw new TypeError('view input must be a closed plain object');
  if (!Array.isArray(input.reports) || input.reports.length !== expectedModelCount) throw new TypeError(`view input requires exactly ${expectedModelCount} model reports`);
  if (!Array.isArray(input.conformanceMappings) || input.conformanceMappings.length !== expectedModelCount) throw new TypeError(`view input requires exactly ${expectedModelCount} conformance mappings`);
  if (!isPlainObject(input.conformanceVerificationContextsByModel)) throw new TypeError('conformanceVerificationContextsByModel must be a plain object');
  if (!Array.isArray(input.counterexampleTriages) || input.counterexampleTriages.length > 256) throw new TypeError('counterexampleTriages must be a bounded array');
  if (!isPlainObject(input.triageVerificationContextsById)) throw new TypeError('triageVerificationContextsById must be a plain object');
  if (!Number.isSafeInteger(input.generatedAtMs) || input.generatedAtMs < 0) throw new TypeError('generatedAtMs must be injected UTC milliseconds');
  input.reports.forEach((report, index) => {
    const validated = validateExplicitStateReport(report);
    if (!validated.ok) throw new TypeError(`model report ${index} is invalid: ${validated.issues[0].code}`);
  });
  const ids = new Set(input.reports.map((report) => report.modelId));
  if (ids.size !== expectedModelCount || CANONICAL_MODEL_IDS.some((modelId) => !ids.has(modelId))) throw new TypeError('model report IDs must match the canonical manifest exactly');
  const canonicalReports = new Map(runModels(CANONICAL_MODELS).map((report) => [report.modelId, report]));
  input.reports.forEach((report, index) => {
    const manifest = MODEL_MANIFEST_BY_ID[report.modelId];
    if (manifest === undefined || manifest.modelVersion !== report.modelVersion) throw new TypeError(`model report ${index} does not match the canonical manifest`);
    const canonicalReport = canonicalReports.get(report.modelId);
    if (canonicalReport === undefined || canonicalJson(report) !== canonicalJson(canonicalReport)) {
      throw new TypeError(`model report ${index} is not byte-for-byte canonical checker output`);
    }
  });
  const conformanceIds = new Set();
  const conformanceResults = input.conformanceMappings.map((mapping, index) => {
    const validated = validateConformanceMapping(mapping);
    if (!validated.ok) throw new TypeError(`conformance mapping ${index} is invalid: ${validated.issues[0].code}`);
    if (!ids.has(mapping.modelId) || conformanceIds.has(mapping.modelId)) throw new TypeError(`conformance mapping ${index} has a duplicate or unknown model ID`);
    conformanceIds.add(mapping.modelId);
    const context = input.conformanceVerificationContextsByModel[mapping.modelId] ?? null;
    const evaluated = evaluateConformanceMapping(mapping, context);
    if (!CONFORMANCE_VERDICTS.includes(evaluated.verdict) || evaluated.runtimeClaimClosure !== 'NOT_PERMITTED') {
      throw new TypeError(`conformance mapping ${index} produced an invalid evaluation`);
    }
    return evaluated;
  });
  if (conformanceIds.size !== expectedModelCount) throw new TypeError('conformance model IDs must match the canonical reports exactly');
  for (const key of Object.keys(input.conformanceVerificationContextsByModel)) {
    if (!ids.has(key)) throw new TypeError(`conformance context has an unknown model ID: ${key}`);
  }
  const triageIds = new Set();
  const triageResults = input.counterexampleTriages.map((triage, index) => {
    const validated = validateCounterexampleTriage(triage);
    if (!validated.ok) throw new TypeError(`counterexample triage ${index} is invalid: ${validated.issues[0].code}`);
    if (!ids.has(triage.modelId) || triageIds.has(triage.triageId)) throw new TypeError(`counterexample triage ${index} has a duplicate or unknown identity`);
    triageIds.add(triage.triageId);
    return evaluateCounterexampleTriage(triage, input.triageVerificationContextsById[triage.triageId] ?? null);
  });
  for (const key of Object.keys(input.triageVerificationContextsById)) {
    if (!triageIds.has(key)) throw new TypeError(`triage context has an unknown triage ID: ${key}`);
  }
  return Object.freeze({
    conformanceResults: Object.freeze(conformanceResults),
    triageResults: Object.freeze(triageResults),
  });
}

function weakestImplementation(results) {
  return results.reduce((weakest, result) => (
    IMPLEMENTATION_PRECEDENCE[result.verdict] > IMPLEMENTATION_PRECEDENCE[weakest]
      ? result.verdict
      : weakest
  ), 'SUPPORTING_EVIDENCE');
}

export function projectFormalAssuranceView(rawInput) {
  const input = snapshotData(rawInput);
  const { conformanceResults, triageResults } = assertInput(input);
  const conformanceByModel = new Map(conformanceResults.map((result) => [result.modelId, result]));
  const triageByModel = new Map();
  for (const triage of triageResults) {
    if (!triageByModel.has(triage.modelId)) triageByModel.set(triage.modelId, []);
    triageByModel.get(triage.modelId).push(triage);
  }

  const coveredProperties = new Set(input.reports.flatMap((report) => report.properties.map((property) => property.propertyId)));
  const missingPropertyIds = REQUIRED_AMENDMENT_PROPERTIES.filter((propertyId) => !coveredProperties.has(propertyId));
  const anyCounterexample = input.reports.some((report) => report.overallStatus === 'FAIL');
  const completePass = missingPropertyIds.length === 0 && input.reports.every(
    (report) => report.overallStatus === 'PASS' && report.exploration.status === 'EXHAUSTIVE',
  );
  const boundedModelStatus = anyCounterexample
    ? 'COUNTEREXAMPLE'
    : completePass ? 'BOUNDED_EXHAUSTIVE_PASS' : 'UNKNOWN_INCOMPLETE';
  const implementationAssuranceStatus = weakestImplementation(conformanceResults);

  const models = [...input.reports]
    .sort((left, right) => left.modelId < right.modelId ? -1 : left.modelId > right.modelId ? 1 : 0)
    .map((report) => {
      const conformance = conformanceByModel.get(report.modelId);
      if (conformance === undefined) throw new TypeError(`missing conformance result for ${report.modelId}`);
      const triage = triageByModel.get(report.modelId) ?? [];
      return Object.freeze({
        modelId: report.modelId,
        modelVersion: report.modelVersion,
        modelContentSha256: MODEL_MANIFEST_BY_ID[report.modelId].bundleSha256,
        verificationStatus: report.overallStatus === 'PASS' && report.exploration.status === 'EXHAUSTIVE'
          ? 'BOUNDED_EXHAUSTIVE_PASS'
          : report.overallStatus === 'FAIL' ? 'COUNTEREXAMPLE' : 'UNKNOWN_INCOMPLETE',
        sourceTruth: 'SYNTHETIC_ONLY',
        runtimeWiring: 'NOT_WIRED',
        states: report.exploration.states,
        transitions: report.exploration.transitions,
        maxDepthReached: report.exploration.maxDepthReached,
        graphFingerprint: report.exploration.graphFingerprint,
        failedPropertyIds: Object.freeze(report.properties.filter((property) => property.status === 'FAIL').map((property) => property.propertyId).sort()),
        unknownPropertyIds: Object.freeze(report.properties.filter((property) => property.status === 'UNKNOWN').map((property) => property.propertyId).sort()),
        assumptions: report.assumptions,
        conformanceVerdict: conformance.verdict,
        conformanceReasons: conformance.reasons,
        triage: Object.freeze({
          total: triage.length,
          runtimeCorpusEligible: triage.filter((entry) => entry.runtimeCorpusEligible).length,
          unresolved: triage.filter((entry) => entry.status === 'UNRESOLVED' || entry.status === 'PENDING_IMPLEMENTATION_VALIDATION').length,
        }),
      });
    });

  const annunciators = [];
  if (boundedModelStatus !== 'BOUNDED_EXHAUSTIVE_PASS') annunciators.push(Object.freeze({ code: 'BOUNDED_MODEL_NOT_PROVEN', severity: 'BLOCKING' }));
  if (missingPropertyIds.length > 0) annunciators.push(Object.freeze({ code: 'AMENDMENT_PROPERTY_COVERAGE_INCOMPLETE', severity: 'BLOCKING', propertyIds: Object.freeze(missingPropertyIds) }));
  annunciators.push(Object.freeze({ code: 'TLA_TOOLING_NOT_VERIFIED', severity: 'INFO' }));
  if (implementationAssuranceStatus !== 'SUPPORTING_EVIDENCE') annunciators.push(Object.freeze({ code: 'IMPLEMENTATION_CONFORMANCE_NOT_PROVEN', severity: 'BLOCKING' }));

  return Object.freeze({
    schemaVersion: FORMAL_VIEW_MODEL_SCHEMA,
    generatedAtMs: input.generatedAtMs,
    sourceTruth: 'SYNTHETIC_ONLY',
    releaseLabels: completePass ? Object.freeze(['BUILT_AND_TESTED', 'SYNTHETIC_ONLY']) : Object.freeze(['SYNTHETIC_ONLY']),
    toolingStatus: PACKET_TOOLING_STATUS,
    overall: Object.freeze({
      boundedModelStatus,
      implementationAssuranceStatus,
      runtimeClaimClosure: 'NOT_PERMITTED',
      modelCount: 7,
      exhaustiveModelCount: input.reports.filter((report) => report.exploration.status === 'EXHAUSTIVE').length,
      passedWithinBoundsCount: input.reports.filter((report) => report.overallStatus === 'PASS' && report.exploration.status === 'EXHAUSTIVE').length,
    }),
    annunciators: Object.freeze(annunciators),
    models: Object.freeze(models),
  });
}
