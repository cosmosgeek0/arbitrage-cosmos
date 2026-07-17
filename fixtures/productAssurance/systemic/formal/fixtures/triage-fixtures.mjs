import {
  computeCounterexampleTraceSha256,
  COUNTEREXAMPLE_TRIAGE_SCHEMA,
} from '../contracts/triage.mjs';
import { NEGATIVE_CONTROL_MODELS } from '../explicitState/index.mjs';
import { exploreModel } from '../explicitState/kernel.mjs';
import { FORMAL_FIXTURE_TIME_MS, IMPLEMENTATION_RELEASE_SHA } from './conformance-fixtures.mjs';
import { MODEL_MANIFEST_BY_ID } from './model-manifest.mjs';

const DISPOSITIONS = Object.freeze([
  'IMPLEMENTATION_RELEVANT_VALIDATED',
  'SPECIFICATION_MODEL_DEFECT',
  'ASSUMPTION_VIOLATION',
  'SPURIOUS_UNREACHABLE_UNDER_IMPLEMENTATION_CONSTRAINTS',
  'UNRESOLVED',
]);

function counterexampleForProperty(property, report) {
  if (property.status !== 'FAIL' || property.trace === null) {
    throw new TypeError(`${report.profile}:${property.propertyId} did not yield a counterexample`);
  }
  if (property.kind === 'SAFETY') return Object.freeze({
    propertyId: property.propertyId,
    trace: Object.freeze({ steps: property.trace, loopStart: null }),
  });
  return Object.freeze({ propertyId: property.propertyId, trace: property.trace });
}

function modelEvidence(model) {
  const report = exploreModel(model);
  if (report.overallStatus !== 'FAIL' || report.exploration.status !== 'EXHAUSTIVE') {
    throw new TypeError(`${model.modelId}:${model.profile} must be an exhaustive failing negative control`);
  }
  const manifest = MODEL_MANIFEST_BY_ID[report.modelId];
  if (manifest === undefined) throw new TypeError(`${report.modelId} is absent from the packet manifest`);
  const sourceRef = manifest.files.find((file) => file.path.startsWith('explicitState/model-') && file.path.endsWith('.mjs'))?.path;
  if (sourceRef === undefined) throw new TypeError(`${report.modelId} has no model source in the packet manifest`);
  const evidenceRef = `${sourceRef}#profile=${model.profile}`;
  return Object.freeze({ model, report, manifest, sourceRef, evidenceRef });
}

function buildTriageRow({ evidence, failure, triageId, disposition, reachabilityBasis }) {
  const { model, report, manifest, sourceRef, evidenceRef } = evidence;
  return Object.freeze({
    schemaVersion: COUNTEREXAMPLE_TRIAGE_SCHEMA,
    triageId,
    modelId: report.modelId,
    modelVersion: report.modelVersion,
    modelContentSha256: manifest.bundleSha256,
    modelProfile: report.profile,
    profileProvenance: Object.freeze({
      kind: 'PACKET_NEGATIVE_CONTROL',
      sourceRef,
      graphFingerprint: report.exploration.graphFingerprint,
      evidenceRefs: Object.freeze([evidenceRef]),
    }),
    propertyId: failure.propertyId,
    checkerId: report.checker.checkerId,
    checkerVersion: report.checker.checkerVersion,
    bounds: report.executedBounds,
    assumptions: report.assumptions,
    trace: failure.trace,
    traceSha256: computeCounterexampleTraceSha256(failure.trace),
    firstBadIndex: failure.trace.steps.length - 1,
    disposition,
    evidenceRefs: Object.freeze([evidenceRef]),
    reachabilityBasis,
    implementationReplay: Object.freeze({
      status: disposition === 'IMPLEMENTATION_RELEVANT_VALIDATED' ? 'NOT_RUN' : 'NOT_APPLICABLE',
      implementationReleaseSha: disposition === 'IMPLEMENTATION_RELEVANT_VALIDATED' ? IMPLEMENTATION_RELEASE_SHA : null,
      harness: null,
      evidenceRefs: Object.freeze([]),
    }),
    reviewer: 'FORMAL_PACKET_REFERENCE_REVIEW',
    reviewedAtMs: FORMAL_FIXTURE_TIME_MS,
  });
}

export function buildCounterexampleTriageFixtures() {
  return Object.freeze(NEGATIVE_CONTROL_MODELS.slice(0, 5).map((model, index) => {
    const evidence = modelEvidence(model);
    const property = evidence.report.properties.find((entry) => entry.status === 'FAIL');
    if (property === undefined) throw new TypeError(`${evidence.report.profile} did not yield a counterexample`);
    return buildTriageRow({
      evidence,
      failure: counterexampleForProperty(property, evidence.report),
      triageId: `S3-TRIAGE-EXAMPLE-${index + 1}`,
      disposition: DISPOSITIONS[index],
      reachabilityBasis: `Deterministic packet-local negative control ${model.profile}; this five-disposition demonstration is not the complete counterexample inventory or implementation replay evidence.`,
    });
  }));
}

export function buildCounterexampleTriageInventory() {
  const rows = NEGATIVE_CONTROL_MODELS.flatMap((model) => {
    const evidence = modelEvidence(model);
    return evidence.report.properties
      .filter((property) => property.status === 'FAIL')
      .map((property) => buildTriageRow({
        evidence,
        failure: counterexampleForProperty(property, evidence.report),
        triageId: `S3-TRIAGE-NC-${evidence.report.modelId}-${model.profile}-${property.propertyId}`,
        disposition: 'SPECIFICATION_MODEL_DEFECT',
        reachabilityBasis: `Exact exhaustive packet negative-control trace for ${model.profile}:${property.propertyId}; retained for model mutation proof only and never runtime-corpus eligible.`,
      }));
  });
  rows.sort((left, right) => {
    const leftKey = `${left.modelId}\u0000${left.modelProfile}\u0000${left.propertyId}`;
    const rightKey = `${right.modelId}\u0000${right.modelProfile}\u0000${right.propertyId}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  return Object.freeze(rows);
}
