import {
  redactDiagnosticEvidence,
} from '../../productAssurance/diagnostics/boundary.js';
import type {
  ShadowEvidenceBundle,
  ShadowEvidenceBundleContext,
  ShadowEvidenceInput,
  ShadowEvidencePointer,
  ShadowPointerValidation,
} from './types.js';
import { SHADOW_A2_STATUS } from './types.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertPositive,
  assertUtc,
  boundedSortedIdentifiers,
  compareCodeUnitStrings,
  digestValue,
  sha256,
  sortedUnique,
  shadowSpeculativeId,
  snapshotInertJson,
} from './support.js';

const SUPPLEMENTAL_SECRET_PATTERNS = Object.freeze([
  /["']?(?:client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token|password|passwd|pwd|passphrase|secret[_-]?key|secret|token)["']?\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')/giu,
  /["']?(?:aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token|aws[_-]?access[_-]?key[_-]?id|private[_-]?key|service[_-]?account[_-]?key|api[_-]?(?:key|secret))["']?\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*')/giu,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,255}|github_pat_[A-Za-z0-9_]{20,255}|AIza[0-9A-Za-z_-]{35}|xox[baprs]-[A-Za-z0-9-]{10,255})\b/gu,
  /\b(?:aws[_-]?secret[_-]?access[_-]?key|aws[_-]?session[_-]?token|aws[_-]?access[_-]?key[_-]?id|private[_-]?key|service[_-]?account[_-]?key|api[_-]?(?:key|secret))\b\s*[:=]\s*[^\s,;}{]+/giu,
  /\b(?:client[_-]?secret|auth[_-]?token|access[_-]?token|refresh[_-]?token|session[_-]?token)\b\s*[:=]\s*[^\s,;}{]+/giu,
  /\b(?:password|passwd|pwd|passphrase|secret[_-]?key|secret|token)\b\s*[:=]\s*[^\s,;}{]+/giu,
  /\bauthorization\b\s*[:=]\s*(?:(?:Basic|Bearer)\s+)?[A-Za-z0-9._~+\/-]{4,}/giu,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/gu,
  /\b(?:password|passwd|pwd|passphrase|secret[_-]?key|secret|token)\s+(?:is|equals)\s+[^\s,;}{]+/giu,
  /\b(?:cookie|set-cookie|session(?:id)?|dsn)\b\s*[:=]\s*[^\s,;}{]+/giu,
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/giu,
  /\b[A-Za-z0-9+/_=-]{48,}\b/gu,
] as const);

const REDACTION_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;

export function redactShadowUntrustedText(
  evidenceId: string,
  sourceKind: ShadowEvidenceInput['sourceKind'],
  text: string,
): Readonly<{ text: string; redactionCount: number }> {
  if (typeof text !== 'string') throw new TypeError('untrusted evidence text must be a string');
  const canonicalText = text.normalize('NFKC').replace(REDACTION_CONTROL_PATTERN, '');
  let redacted = canonicalText;
  let redactionCount = 0;
  for (const pattern of SUPPLEMENTAL_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, () => {
      redactionCount += 1;
      return '[REDACTED]';
    });
  }
  const shared = redactDiagnosticEvidence([{ evidenceId, sourceKind, rawDigest: sha256(redacted), text: redacted }]);
  redacted = shared.evidence[0]?.redactedText ?? '';
  redactionCount += shared.redactionCount;
  return Object.freeze({ text: redacted, redactionCount });
}

export interface ShadowEvidenceLimits {
  readonly maximumItems: number;
  readonly maximumOmittedItems: number;
  readonly maximumRawBytes: number;
  readonly maximumItemBytes: number;
  readonly maximumAgeMs: number;
}

function validatePointer(pointer: Readonly<ShadowEvidencePointer>, limits: Readonly<ShadowEvidenceLimits>): void {
  assertClosedKeys(pointer, ['pointerId', 'ownerId', 'artifactId', 'rawDigest', 'byteLength', 'capturedAtMs'], 'evidence pointer');
  assertIdentifier(pointer.pointerId, 'pointer.pointerId');
  assertIdentifier(pointer.ownerId, 'pointer.ownerId');
  assertIdentifier(pointer.artifactId, 'pointer.artifactId');
  assertDigest(pointer.rawDigest, 'pointer.rawDigest');
  if (!Number.isSafeInteger(pointer.byteLength) || pointer.byteLength < 0 || pointer.byteLength > limits.maximumItemBytes) {
    throw new TypeError('pointer.byteLength is outside the evidence bound');
  }
  assertUtc(pointer.capturedAtMs, 'pointer.capturedAtMs');
}

function validateLimits(limits: Readonly<ShadowEvidenceLimits>): void {
  assertClosedKeys(limits, [
    'maximumItems', 'maximumOmittedItems', 'maximumRawBytes', 'maximumItemBytes', 'maximumAgeMs',
  ], 'evidence limits');
  assertPositive(limits.maximumItems, 'limits.maximumItems');
  assertPositive(limits.maximumOmittedItems, 'limits.maximumOmittedItems');
  assertPositive(limits.maximumRawBytes, 'limits.maximumRawBytes');
  assertPositive(limits.maximumItemBytes, 'limits.maximumItemBytes');
  assertPositive(limits.maximumAgeMs, 'limits.maximumAgeMs');
  if (limits.maximumItemBytes > limits.maximumRawBytes) {
    throw new TypeError('maximum item bytes cannot exceed maximum bundle bytes');
  }
  if (
    limits.maximumItems > 128
    || limits.maximumOmittedItems > 256
    || limits.maximumItemBytes > 16_384
    || limits.maximumRawBytes > 1024 * 1024
    || limits.maximumAgeMs > 24 * 60 * 60 * 1_000
  ) throw new TypeError('evidence limits exceed absolute shadow bounds');
}

export function buildEvidenceBundle(
  context: Readonly<ShadowEvidenceBundleContext>,
  evidence: readonly Readonly<ShadowEvidenceInput>[],
  limits: Readonly<ShadowEvidenceLimits>,
): Readonly<ShadowEvidenceBundle> {
  const limitSnapshot = snapshotInertJson(limits, 'evidence limits') as Readonly<ShadowEvidenceLimits>;
  const contextSnapshot = snapshotInertJson(context, 'evidence bundle context') as Readonly<ShadowEvidenceBundleContext>;
  const evidenceSnapshot = snapshotInertJson(evidence, 'evidence input') as readonly Readonly<ShadowEvidenceInput>[];
  const metadata = validateBundleContext(contextSnapshot);
  validateLimits(limitSnapshot);
  if (!Array.isArray(evidenceSnapshot)) throw new TypeError('evidence must be an array');
  if (evidenceSnapshot.length > limitSnapshot.maximumItems + limitSnapshot.maximumOmittedItems) {
    throw new RangeError('evidence input exceeds selected plus omission bounds');
  }
  const inspected: ShadowEvidenceInput[] = [];
  for (const entry of evidenceSnapshot) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new TypeError('evidence item must be a plain object');
    assertClosedKeys(entry, [
      'pointerId', 'ownerId', 'artifactId', 'rawDigest', 'byteLength', 'capturedAtMs', 'sourceKind', 'text',
    ], 'evidence item');
    validatePointer({
      pointerId: entry.pointerId,
      ownerId: entry.ownerId,
      artifactId: entry.artifactId,
      rawDigest: entry.rawDigest,
      byteLength: entry.byteLength,
      capturedAtMs: entry.capturedAtMs,
    }, limitSnapshot);
    if (entry.capturedAtMs > contextSnapshot.createdAtMs) throw new TypeError('evidence capture time cannot follow bundle creation');
    if (entry.capturedAtMs < contextSnapshot.evidenceWindowStartMs || entry.capturedAtMs > contextSnapshot.evidenceWindowEndMs) {
      throw new TypeError('evidence capture time is outside the declared evidence window');
    }
    if (typeof entry.text !== 'string') throw new TypeError('evidence text must be a string');
    const actualBytes = Buffer.byteLength(entry.text, 'utf8');
    if (actualBytes !== entry.byteLength) throw new TypeError('evidence byte length does not match its pointer');
    if (sha256(entry.text) !== entry.rawDigest) throw new TypeError('evidence raw digest does not match its text');
    inspected.push(Object.freeze({ ...entry }));
  }
  const sorted = inspected.sort((left, right) => compareCodeUnitStrings(left.pointerId, right.pointerId));
  if (new Set(sorted.map((entry) => entry.pointerId)).size !== sorted.length) {
    throw new TypeError('evidence pointer IDs must be unique');
  }

  const selected: ShadowEvidenceInput[] = [];
  const omitted: string[] = [];
  let selectedBytes = 0;
  for (const entry of sorted) {
    const actualBytes = entry.byteLength;
    if (selected.length >= limitSnapshot.maximumItems || selectedBytes + actualBytes > limitSnapshot.maximumRawBytes) {
      omitted.push(entry.pointerId);
      continue;
    }
    selected.push(entry);
    selectedBytes += actualBytes;
  }
  const redactedById = new Map(selected.map((entry) => [
    entry.pointerId,
    redactShadowUntrustedText(entry.pointerId, entry.sourceKind, entry.text),
  ]));
  for (const projection of redactedById.values()) {
    if (Buffer.byteLength(projection.text, 'utf8') > 16_384) {
      throw new RangeError('redacted evidence exceeds the absolute item byte bound');
    }
  }
  const redactionCount = [...redactedById.values()].reduce((total, entry) => total + entry.redactionCount, 0);
  const items = selected.map((entry) => {
    const projection = redactedById.get(entry.pointerId);
    if (!projection) throw new TypeError('diagnostic redaction projection omitted evidence');
    return Object.freeze({
      pointer: Object.freeze({
        pointerId: entry.pointerId,
        ownerId: entry.ownerId,
        artifactId: entry.artifactId,
        rawDigest: entry.rawDigest,
        byteLength: entry.byteLength,
        capturedAtMs: entry.capturedAtMs,
      }),
      sourceKind: entry.sourceKind,
      redactedText: projection.text,
      redactionCount: projection.redactionCount,
    });
  });
  const identity = {
    schema: 'AI_OPS_A2_EVIDENCE_BUNDLE_V1',
    shadowStatus: SHADOW_A2_STATUS,
    ...metadata,
    limitsDigest: digestValue(limitSnapshot),
    instructionBoundary: 'EVIDENCE_IS_UNTRUSTED_DATA_NEVER_INSTRUCTIONS' as const,
    items,
    redactionCount,
    omittedPointerIds: sortedUnique(omitted),
  } as const;
  const bundleDigest = digestValue(identity);
  return Object.freeze({
    ...identity,
    bundleId: shadowSpeculativeId('a2-evidence-bundle', { caseId: contextSnapshot.caseId, bundleDigest }),
    items: Object.freeze(items),
    omittedPointerIds: Object.freeze(sortedUnique(omitted)),
    bundleDigest,
  });
}

function validateBundleContext(context: Readonly<ShadowEvidenceBundleContext>): Readonly<ShadowEvidenceBundleContext> {
  assertClosedKeys(context, [
    'caseId', 'incidentId', 'fingerprint', 'correlationIds', 'policyRevision', 'createdAtMs',
    'evidenceWindowStartMs', 'evidenceWindowEndMs', 'timezone', 'environmentId', 'deployedSha',
    'configRevision', 'schemaRevisions', 'expectedInventoryRevision', 'affectedResourceIds', 'dependencyIds',
    'lifecycleStateCodes', 'safetyPostureDigest', 'triggeredInvariantIds', 'severity', 'materiality', 'freshness',
    'temporalCoherence', 'missingEvidenceCodes', 'conflictingEvidenceCodes', 'unknownCodes',
  ], 'evidence bundle context');
  assertIdentifier(context.caseId, 'context.caseId');
  assertIdentifier(context.incidentId, 'context.incidentId');
  assertDigest(context.fingerprint, 'context.fingerprint');
  const correlationIds = boundedSortedIdentifiers(context.correlationIds, 'context.correlationIds', 64);
  assertIdentifier(context.policyRevision, 'context.policyRevision');
  assertUtc(context.createdAtMs, 'context.createdAtMs');
  assertUtc(context.evidenceWindowStartMs, 'context.evidenceWindowStartMs');
  assertUtc(context.evidenceWindowEndMs, 'context.evidenceWindowEndMs');
  if (context.evidenceWindowStartMs > context.evidenceWindowEndMs || context.evidenceWindowEndMs > context.createdAtMs) {
    throw new TypeError('evidence window lineage invalid');
  }
  if (context.timezone !== 'UTC') throw new TypeError('evidence bundle timezone must be UTC');
  assertIdentifier(context.environmentId, 'context.environmentId');
  if (!/^[a-f0-9]{40}$/u.test(context.deployedSha)) throw new TypeError('evidence deployed SHA must be a full Git SHA');
  assertIdentifier(context.configRevision, 'context.configRevision');
  const schemaRevisions = boundedSortedIdentifiers(context.schemaRevisions, 'context.schemaRevisions', 64);
  assertIdentifier(context.expectedInventoryRevision, 'context.expectedInventoryRevision');
  const affectedResourceIds = boundedSortedIdentifiers(context.affectedResourceIds, 'context.affectedResourceIds', 128);
  const dependencyIds = boundedSortedIdentifiers(context.dependencyIds, 'context.dependencyIds', 128);
  const lifecycleStateCodes = boundedSortedIdentifiers(context.lifecycleStateCodes, 'context.lifecycleStateCodes', 64);
  assertDigest(context.safetyPostureDigest, 'context.safetyPostureDigest');
  const triggeredInvariantIds = boundedSortedIdentifiers(context.triggeredInvariantIds, 'context.triggeredInvariantIds', 64);
  if (context.severity !== null && !(['SEV0_SAFETY', 'SEV1_CRITICAL', 'SEV2_MAJOR', 'SEV3_DEGRADED', 'SEV4_INFORMATIONAL'] as const).includes(context.severity)) {
    throw new TypeError('evidence severity invalid');
  }
  if (!(['MATERIAL', 'NON_MATERIAL', 'UNKNOWN'] as const).includes(context.materiality)) throw new TypeError('evidence materiality invalid');
  if (!(['FRESH', 'STALE', 'UNKNOWN'] as const).includes(context.freshness)) throw new TypeError('evidence freshness invalid');
  if (!(['COHERENT', 'CONFLICTING', 'UNKNOWN'] as const).includes(context.temporalCoherence)) throw new TypeError('evidence temporal coherence invalid');
  const missingEvidenceCodes = boundedSortedIdentifiers(context.missingEvidenceCodes, 'context.missingEvidenceCodes', 64);
  const conflictingEvidenceCodes = boundedSortedIdentifiers(context.conflictingEvidenceCodes, 'context.conflictingEvidenceCodes', 64);
  const unknownCodes = boundedSortedIdentifiers(context.unknownCodes, 'context.unknownCodes', 64);
  return Object.freeze({
    ...context,
    correlationIds,
    schemaRevisions,
    affectedResourceIds,
    dependencyIds,
    lifecycleStateCodes,
    triggeredInvariantIds,
    missingEvidenceCodes,
    conflictingEvidenceCodes,
    unknownCodes,
  });
}

export type ShadowPointerReadback =
  | Readonly<{
      state: 'AVAILABLE';
      rawDigest: string;
      byteLength: number;
      observedAtMs: number;
      sourceKind: ShadowEvidenceInput['sourceKind'];
      rawText: string;
    }>
  | Readonly<{ state: 'UNAVAILABLE' | 'UNKNOWN' }>;

/** Structural owner adapter only; A2 performs no I/O and owns no evidence store. */
export interface ShadowEvidencePointerReadPort {
  readEvidencePointer(pointer: Readonly<ShadowEvidencePointer>): ShadowPointerReadback;
}

function assertEvidenceBundle(bundle: Readonly<ShadowEvidenceBundle>, limits: Readonly<ShadowEvidenceLimits>): void {
  if (typeof bundle !== 'object' || bundle === null || Array.isArray(bundle)) throw new TypeError('evidence bundle must be an object');
  assertClosedKeys(bundle, [
    'schema', 'shadowStatus', 'bundleId', 'caseId', 'incidentId', 'fingerprint', 'correlationIds',
    'policyRevision', 'createdAtMs', 'evidenceWindowStartMs', 'evidenceWindowEndMs', 'timezone', 'environmentId',
    'deployedSha', 'configRevision', 'schemaRevisions', 'expectedInventoryRevision', 'affectedResourceIds',
    'dependencyIds', 'lifecycleStateCodes', 'safetyPostureDigest', 'triggeredInvariantIds', 'severity', 'materiality',
    'freshness', 'temporalCoherence', 'missingEvidenceCodes', 'conflictingEvidenceCodes', 'unknownCodes',
    'limitsDigest', 'instructionBoundary', 'items', 'redactionCount', 'omittedPointerIds', 'bundleDigest',
  ], 'evidence bundle');
  if (bundle.schema !== 'AI_OPS_A2_EVIDENCE_BUNDLE_V1' || bundle.shadowStatus !== SHADOW_A2_STATUS) {
    throw new TypeError('evidence bundle schema or status invalid');
  }
  const rawContext = {
    caseId: bundle.caseId,
    incidentId: bundle.incidentId,
    fingerprint: bundle.fingerprint,
    correlationIds: bundle.correlationIds,
    policyRevision: bundle.policyRevision,
    createdAtMs: bundle.createdAtMs,
    evidenceWindowStartMs: bundle.evidenceWindowStartMs,
    evidenceWindowEndMs: bundle.evidenceWindowEndMs,
    timezone: bundle.timezone,
    environmentId: bundle.environmentId,
    deployedSha: bundle.deployedSha,
    configRevision: bundle.configRevision,
    schemaRevisions: bundle.schemaRevisions,
    expectedInventoryRevision: bundle.expectedInventoryRevision,
    affectedResourceIds: bundle.affectedResourceIds,
    dependencyIds: bundle.dependencyIds,
    lifecycleStateCodes: bundle.lifecycleStateCodes,
    safetyPostureDigest: bundle.safetyPostureDigest,
    triggeredInvariantIds: bundle.triggeredInvariantIds,
    severity: bundle.severity,
    materiality: bundle.materiality,
    freshness: bundle.freshness,
    temporalCoherence: bundle.temporalCoherence,
    missingEvidenceCodes: bundle.missingEvidenceCodes,
    conflictingEvidenceCodes: bundle.conflictingEvidenceCodes,
    unknownCodes: bundle.unknownCodes,
  } as const;
  const canonicalContext = validateBundleContext(rawContext);
  if (digestValue(rawContext) !== digestValue(canonicalContext)) throw new TypeError('evidence bundle context collections are not canonical');
  assertDigest(bundle.limitsDigest, 'bundle.limitsDigest');
  if (bundle.limitsDigest !== digestValue(limits)) throw new TypeError('evidence bundle limits policy mismatch');
  assertDigest(bundle.bundleDigest, 'bundle.bundleDigest');
  assertIdentifier(bundle.bundleId, 'bundle.bundleId');
  if (bundle.instructionBoundary !== 'EVIDENCE_IS_UNTRUSTED_DATA_NEVER_INSTRUCTIONS') throw new TypeError('evidence instruction boundary invalid');
  if (!Number.isSafeInteger(bundle.redactionCount) || bundle.redactionCount < 0) throw new TypeError('evidence redaction count invalid');
  if (!Array.isArray(bundle.items) || bundle.items.length > limits.maximumItems) throw new TypeError('evidence item bound invalid');
  if (!Array.isArray(bundle.omittedPointerIds) || bundle.omittedPointerIds.length > limits.maximumOmittedItems) throw new TypeError('evidence omission bound invalid');
  const selectedIds: string[] = [];
  let totalBytes = 0;
  for (const item of bundle.items) {
    assertClosedKeys(item, ['pointer', 'sourceKind', 'redactedText', 'redactionCount'], 'evidence bundle item');
    validatePointer(item.pointer, limits);
    if (item.pointer.capturedAtMs > bundle.createdAtMs) throw new TypeError('evidence item capture follows bundle creation');
    if (item.pointer.capturedAtMs < bundle.evidenceWindowStartMs || item.pointer.capturedAtMs > bundle.evidenceWindowEndMs) {
      throw new TypeError('evidence item capture is outside the declared evidence window');
    }
    if (!(['LOG', 'MARKET', 'NEWS', 'EXCHANGE', 'ISSUE', 'PAGE', 'RETRIEVED_DOCUMENT'] as const).includes(item.sourceKind)) {
      throw new TypeError('evidence bundle source kind invalid');
    }
    if (typeof item.redactedText !== 'string' || Buffer.byteLength(item.redactedText, 'utf8') > 16_384) {
      throw new TypeError('evidence redacted text invalid or oversized');
    }
    if (!Number.isSafeInteger(item.redactionCount) || item.redactionCount < 0) throw new TypeError('evidence item redaction count invalid');
    const redactionReadback = redactShadowUntrustedText(item.pointer.pointerId, item.sourceKind, item.redactedText);
    if (redactionReadback.redactionCount > 0 || redactionReadback.text !== item.redactedText) {
      throw new TypeError('evidence bundle contains unredacted secret material');
    }
    selectedIds.push(item.pointer.pointerId);
    totalBytes += item.pointer.byteLength;
  }
  if (totalBytes > limits.maximumRawBytes) throw new TypeError('evidence selected bytes exceed bundle limit');
  if (bundle.items.reduce((total, item) => total + item.redactionCount, 0) !== bundle.redactionCount) {
    throw new TypeError('evidence redaction count mismatch');
  }
  if (new Set(selectedIds).size !== selectedIds.length) throw new TypeError('evidence bundle pointer IDs must be unique');
  if (digestValue(selectedIds) !== digestValue([...selectedIds].sort(compareCodeUnitStrings))) throw new TypeError('evidence bundle pointer IDs are not canonical');
  for (const id of bundle.omittedPointerIds) assertIdentifier(id, 'bundle.omittedPointerIds[]');
  if (new Set(bundle.omittedPointerIds).size !== bundle.omittedPointerIds.length) throw new TypeError('evidence omission IDs must be unique');
  if (digestValue(bundle.omittedPointerIds) !== digestValue(sortedUnique(bundle.omittedPointerIds))) throw new TypeError('evidence omission IDs are not canonical');
  if (bundle.omittedPointerIds.some((id) => selectedIds.includes(id))) throw new TypeError('evidence pointer cannot be selected and omitted');
  const { bundleId: _bundleId, bundleDigest: _bundleDigest, ...identity } = bundle;
  if (digestValue(identity) !== bundle.bundleDigest) throw new TypeError('evidence bundle digest mismatch');
  const expectedId = shadowSpeculativeId('a2-evidence-bundle', { caseId: bundle.caseId, bundleDigest: bundle.bundleDigest });
  if (bundle.bundleId !== expectedId) throw new TypeError('evidence bundle ID mismatch');
}

export function snapshotValidatedEvidenceBundle(
  bundle: Readonly<ShadowEvidenceBundle>,
  limits: Readonly<ShadowEvidenceLimits>,
): Readonly<ShadowEvidenceBundle> {
  const limitSnapshot = snapshotInertJson(limits, 'evidence limits') as Readonly<ShadowEvidenceLimits>;
  validateLimits(limitSnapshot);
  const snapshot = snapshotInertJson(bundle, 'evidence bundle') as Readonly<ShadowEvidenceBundle>;
  assertEvidenceBundle(snapshot, limitSnapshot);
  return snapshot;
}

export function validateEvidencePointers(
  bundle: Readonly<ShadowEvidenceBundle>,
  nowMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  port: Readonly<ShadowEvidencePointerReadPort>,
): readonly Readonly<ShadowPointerValidation>[] {
  assertUtc(nowMs, 'nowMs');
  limits = snapshotInertJson(limits, 'evidence limits') as Readonly<ShadowEvidenceLimits>;
  validateLimits(limits);
  bundle = snapshotValidatedEvidenceBundle(bundle, limits);
  return Object.freeze(bundle.items.map((item) => {
    const { pointer } = item;
    validatePointer(pointer, limits);
    let readback: unknown;
    try {
      readback = port.readEvidencePointer(pointer);
    } catch {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze(['OWNER_READ_FAILED']),
      });
    }
    if (typeof readback !== 'object' || readback === null || Array.isArray(readback)) {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze(['OWNER_READBACK_MALFORMED']),
      });
    }
    let state: unknown;
    try {
      const stateDescriptor = Object.getOwnPropertyDescriptor(readback, 'state');
      if (!stateDescriptor || !('value' in stateDescriptor)) throw new TypeError('evidence owner readback state must be inert data');
      state = stateDescriptor.value;
      if (state === 'UNAVAILABLE' || state === 'UNKNOWN') {
        assertClosedKeys(readback, ['state'], 'evidence owner readback');
      } else if (state === 'AVAILABLE') {
        assertClosedKeys(readback, ['state', 'rawDigest', 'byteLength', 'observedAtMs', 'sourceKind', 'rawText'], 'evidence owner readback');
      } else {
        throw new TypeError('evidence owner readback state unsupported');
      }
    } catch {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze(['OWNER_READBACK_MALFORMED']),
      });
    }
    if (state !== 'AVAILABLE') {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze([state === 'UNAVAILABLE' ? 'OWNER_UNAVAILABLE' : 'OWNER_READBACK_UNKNOWN']),
      });
    }
    const available = readback as Readonly<Extract<ShadowPointerReadback, { state: 'AVAILABLE' }>>;
    if (
      typeof available.rawDigest !== 'string'
      || !/^[a-f0-9]{64}$/u.test(available.rawDigest)
      || !Number.isSafeInteger(available.byteLength)
      || available.byteLength < 0
      || available.byteLength > limits.maximumItemBytes
      || !Number.isSafeInteger(available.observedAtMs)
      || typeof available.rawText !== 'string'
      || Buffer.byteLength(available.rawText, 'utf8') > limits.maximumItemBytes
      || !(['LOG', 'MARKET', 'NEWS', 'EXCHANGE', 'ISSUE', 'PAGE', 'RETRIEVED_DOCUMENT'] as const).includes(available.sourceKind)
    ) {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze(['OWNER_READBACK_MALFORMED']),
      });
    }
    const ownerBytes = Buffer.byteLength(available.rawText, 'utf8');
    if (ownerBytes !== available.byteLength || sha256(available.rawText) !== available.rawDigest) {
      return Object.freeze({
        shadowStatus: SHADOW_A2_STATUS,
        bundleDigest: bundle.bundleDigest,
        pointerId: pointer.pointerId,
        disposition: 'INCONCLUSIVE',
        reasonCodes: Object.freeze(['OWNER_READBACK_CONTENT_INVALID']),
      });
    }
    const reasons: string[] = [];
    if (available.byteLength !== pointer.byteLength) {
      reasons.push('POINTER_BYTE_LENGTH_MISMATCH');
    }
    if (available.rawDigest !== pointer.rawDigest) {
      reasons.push('POINTER_DIGEST_MISMATCH');
    }
    if (available.sourceKind !== item.sourceKind) reasons.push('POINTER_SOURCE_KIND_MISMATCH');
    const projection = redactShadowUntrustedText(pointer.pointerId, available.sourceKind, available.rawText);
    if (projection.text !== item.redactedText || projection.redactionCount !== item.redactionCount) {
      reasons.push('REDACTED_PROJECTION_MISMATCH');
    }
    if (available.observedAtMs < pointer.capturedAtMs || available.observedAtMs > nowMs) {
      reasons.push('READBACK_TIME_INVALID');
    }
    if (bundle.createdAtMs > nowMs || bundle.evidenceWindowEndMs > nowMs) reasons.push('BUNDLE_FROM_FUTURE');
    if (pointer.capturedAtMs > nowMs) reasons.push('EVIDENCE_FROM_FUTURE');
    if (nowMs - pointer.capturedAtMs > limits.maximumAgeMs) reasons.push('EVIDENCE_STALE');
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      bundleDigest: bundle.bundleDigest,
      pointerId: pointer.pointerId,
      disposition: reasons.length === 0 ? 'VALIDATED' : 'INVALIDATED',
      reasonCodes: Object.freeze(reasons),
    });
  }));
}

export interface ShadowInvestigationEnvelope {
  readonly schema: 'AI_OPS_A2_INVESTIGATION_ZONE_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly trustedPolicyDigest: string;
  readonly evidenceBundleDigest: string;
  readonly untrustedEvidence: Readonly<ShadowEvidenceBundle>;
  readonly operationalAuthority: 'NONE';
  readonly capabilityRequestsFromEvidence: 'IGNORED';
}

export function createInvestigationEnvelope(
  caseId: string,
  trustedPolicyDigest: string,
  bundle: Readonly<ShadowEvidenceBundle>,
  limits: Readonly<ShadowEvidenceLimits>,
): Readonly<ShadowInvestigationEnvelope> {
  assertIdentifier(caseId, 'caseId');
  assertDigest(trustedPolicyDigest, 'trustedPolicyDigest');
  const limitSnapshot = snapshotInertJson(limits, 'evidence limits') as Readonly<ShadowEvidenceLimits>;
  const isolatedBundle = snapshotValidatedEvidenceBundle(bundle, limitSnapshot);
  if (isolatedBundle.caseId !== caseId) throw new TypeError('evidence bundle belongs to a different case');
  return Object.freeze({
    schema: 'AI_OPS_A2_INVESTIGATION_ZONE_V1',
    shadowStatus: SHADOW_A2_STATUS,
    caseId,
    trustedPolicyDigest,
    evidenceBundleDigest: isolatedBundle.bundleDigest,
    untrustedEvidence: isolatedBundle,
    operationalAuthority: 'NONE',
    capabilityRequestsFromEvidence: 'IGNORED',
  });
}

export interface ShadowEffectZoneProjection {
  readonly schema: 'AI_OPS_A2_EFFECT_ZONE_PROJECTION_V1';
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly caseId: string;
  readonly evidenceBundleDigest: string;
  readonly evidenceLimitsDigest: string;
  readonly evaluatedAtMs: number;
  readonly pointerValidationDigest: string;
  readonly evidenceValidUntilMs: number | null;
  readonly disposition: 'PROPOSAL_ONLY' | 'QUARANTINED';
  readonly operationalAuthority: 'NONE';
  readonly validatedPointerIds: readonly string[];
  readonly reasonCodes: readonly string[];
}

export function projectEffectZone(
  caseId: string,
  bundle: Readonly<ShadowEvidenceBundle>,
  nowMs: number,
  limits: Readonly<ShadowEvidenceLimits>,
  port: Readonly<ShadowEvidencePointerReadPort>,
): Readonly<ShadowEffectZoneProjection> {
  assertIdentifier(caseId, 'caseId');
  const limitSnapshot = snapshotInertJson(limits, 'evidence limits') as Readonly<ShadowEvidenceLimits>;
  const bundleSnapshot = snapshotValidatedEvidenceBundle(bundle, limitSnapshot);
  if (bundleSnapshot.caseId !== caseId) throw new TypeError('effect projection bundle belongs to a different case');
  const validations = validateEvidencePointers(bundleSnapshot, nowMs, limitSnapshot, port);
  const expectedIds = bundleSnapshot.items.map((entry) => entry.pointer.pointerId).sort(compareCodeUnitStrings);
  const actualIds = validations.map((entry) => entry.pointerId).sort(compareCodeUnitStrings);
  if (new Set(actualIds).size !== actualIds.length || canonicalSet(actualIds) !== canonicalSet(expectedIds)) {
    throw new TypeError('effect projection pointer validation set mismatch');
  }
  if (validations.some((entry) => entry.bundleDigest !== bundleSnapshot.bundleDigest || entry.shadowStatus !== SHADOW_A2_STATUS)) {
    throw new TypeError('effect projection pointer validation binding mismatch');
  }
  const validated = validations.filter((entry) => entry.disposition === 'VALIDATED').map((entry) => entry.pointerId);
  const blocked = validations.filter((entry) => entry.disposition !== 'VALIDATED');
  const postureComplete = bundleSnapshot.severity !== null
    && bundleSnapshot.materiality !== 'UNKNOWN'
    && bundleSnapshot.freshness === 'FRESH'
    && bundleSnapshot.temporalCoherence === 'COHERENT'
    && bundleSnapshot.missingEvidenceCodes.length === 0
    && bundleSnapshot.conflictingEvidenceCodes.length === 0
    && bundleSnapshot.unknownCodes.length === 0;
  const fullyValidated = blocked.length === 0
    && validations.length > 0
    && bundleSnapshot.omittedPointerIds.length === 0
    && postureComplete;
  const blockedReasons = [
    ...(bundleSnapshot.omittedPointerIds.length > 0 ? ['EVIDENCE_OMISSIONS_PRESENT'] : []),
    ...(blocked.length > 0 || validations.length === 0 ? ['EVIDENCE_POINTER_VALIDATION_INCOMPLETE'] : []),
    ...(bundleSnapshot.severity === null ? ['EVIDENCE_SEVERITY_UNKNOWN'] : []),
    ...(bundleSnapshot.materiality === 'UNKNOWN' ? ['EVIDENCE_MATERIALITY_UNKNOWN'] : []),
    ...(bundleSnapshot.freshness !== 'FRESH' ? ['EVIDENCE_NOT_FRESH'] : []),
    ...(bundleSnapshot.temporalCoherence !== 'COHERENT' ? ['EVIDENCE_TEMPORALLY_INCOHERENT'] : []),
    ...(bundleSnapshot.missingEvidenceCodes.length > 0 ? ['EVIDENCE_MISSING'] : []),
    ...(bundleSnapshot.conflictingEvidenceCodes.length > 0 ? ['EVIDENCE_CONFLICTING'] : []),
    ...(bundleSnapshot.unknownCodes.length > 0 ? ['EVIDENCE_UNKNOWN'] : []),
  ];
  const evidenceValidUntilMs = bundleSnapshot.items.length === 0
    ? null
    : Math.min(...bundleSnapshot.items.map((entry) => entry.pointer.capturedAtMs + limitSnapshot.maximumAgeMs));
  if (evidenceValidUntilMs !== null) assertUtc(evidenceValidUntilMs, 'evidenceValidUntilMs');
  return Object.freeze({
    schema: 'AI_OPS_A2_EFFECT_ZONE_PROJECTION_V1',
    shadowStatus: SHADOW_A2_STATUS,
    caseId,
    evidenceBundleDigest: bundleSnapshot.bundleDigest,
    evidenceLimitsDigest: bundleSnapshot.limitsDigest,
    evaluatedAtMs: nowMs,
    pointerValidationDigest: digestValue(validations),
    evidenceValidUntilMs,
    disposition: fullyValidated ? 'PROPOSAL_ONLY' : 'QUARANTINED',
    operationalAuthority: 'NONE',
    validatedPointerIds: Object.freeze(sortedUnique(validated)),
    reasonCodes: Object.freeze(sortedUnique(fullyValidated ? ['ALL_EVIDENCE_POINTERS_VALIDATED'] : blockedReasons)),
  });
}

function canonicalSet(values: readonly string[]): string {
  return JSON.stringify(values);
}
