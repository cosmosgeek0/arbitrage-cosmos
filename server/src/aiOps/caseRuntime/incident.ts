import type {
  ShadowAdmissionPolicy,
  ShadowAdmissionProjection,
  ShadowAdmissionState,
  ShadowDepthSignals,
  ShadowFingerprintState,
  ShadowModelDepth,
  ShadowNormalizedObservation,
  ShadowObservationInput,
  ShadowSeverity,
  ShadowSeveritySignals,
} from './types.js';
import { redactShadowUntrustedText } from './evidence.js';
import {
  assertClosedKeys,
  assertDigest,
  assertIdentifier,
  assertPositive,
  assertSafeNonNegative,
  assertUtc,
  boundedSortedIdentifiers,
  canonicalJson,
  compareCodeUnitStrings,
  digestValue,
  sha256,
  shadowSpeculativeId,
  snapshotInertJson,
  snapshotInertJsonPreservingDeepFreeze,
} from './support.js';
import { SHADOW_A2_STATUS } from './types.js';

const MAX_MESSAGE_BYTES = 16_384;
const MAX_ATTRIBUTES = 64;
const MAX_ATTRIBUTE_KEY_BYTES = 128;
const MAX_ATTRIBUTE_VALUE_BYTES = 2_048;
const MAX_REASON_CODES = 32;

const VOLATILE_ATTRIBUTE_PATTERN = /^(?:timestamp|time|request_id|trace_id|span_id|event_id|nonce|sequence|attempt|observed_at|received_at)$/iu;
const CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
const ISO_TIME_PATTERN = /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/giu;
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu;
const HASH_PATTERN = /\b[0-9a-f]{24,128}\b/giu;
const IP_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu;
const NUMBER_PATTERN = /(?<![A-Za-z])[-+]?\d+(?:\.\d+)?(?![A-Za-z])/gu;
function redactUntrustedText(
  evidenceId: string,
  sourceKind: 'LOG',
  text: string,
): Readonly<{ text: string; redactionCount: number }> {
  return redactShadowUntrustedText(evidenceId, sourceKind, text);
}

function assertBoundedText(value: unknown, label: string, maximumBytes: number): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || Buffer.byteLength(value, 'utf8') > maximumBytes) {
    throw new TypeError(`${label} must be non-empty bounded text`);
  }
}

function normalizeMessage(message: string): string {
  return message
    .normalize('NFKC')
    .replace(CONTROL_PATTERN, '')
    .replace(ISO_TIME_PATTERN, '<time>')
    .replace(UUID_PATTERN, '<uuid>')
    .replace(HASH_PATTERN, '<digest>')
    .replace(IP_PATTERN, '<ip>')
    .replace(NUMBER_PATTERN, '<number>')
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();
}

function normalizeAttributes(
  input: Readonly<Record<string, string | number | boolean | null>>,
): Readonly<{ attributes: Readonly<Record<string, string | number | boolean | null>>; redactionCount: number }> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('observation.attributes must be a plain object');
  }
  assertClosedKeys(input, Object.keys(input), 'observation.attributes');
  const entries = Object.keys(input).map((rawKey) => {
    assertBoundedText(rawKey, 'observation attribute key', MAX_ATTRIBUTE_KEY_BYTES);
    const key = rawKey.normalize('NFKC').replace(CONTROL_PATTERN, '').trim().toLowerCase();
    assertBoundedText(key, 'normalized observation attribute key', MAX_ATTRIBUTE_KEY_BYTES);
    return Object.freeze({ rawKey, key, value: input[rawKey] });
  }).sort((left, right) => compareCodeUnitStrings(left.key, right.key));
  if (entries.length > MAX_ATTRIBUTES) throw new TypeError('observation.attributes exceeds its item bound');
  if (new Set(entries.map((entry) => entry.key)).size !== entries.length) {
    throw new TypeError('observation attribute keys collide after canonical normalization');
  }
  const canonicalInputKeys = new Set(entries.map((entry) => entry.key));
  const output: Record<string, string | number | boolean | null> = Object.create(null) as Record<string, string | number | boolean | null>;
  let redactionCount = 0;
  let redactedKeyCount = 0;
  for (const { key, value } of entries) {
    if (typeof value === 'number' && (!Number.isFinite(value) || !Number.isSafeInteger(value))) {
      throw new TypeError('numeric observation attributes must be finite safe integers');
    }
    if (!['string', 'number', 'boolean'].includes(typeof value) && value !== null) {
      throw new TypeError('observation attribute value is unsupported');
    }
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > MAX_ATTRIBUTE_VALUE_BYTES) {
      throw new TypeError('observation attribute value exceeds its byte bound');
    }
    const keyProjection = redactUntrustedText('observation-attribute-key', 'LOG', key.normalize('NFKC').replace(CONTROL_PATTERN, ''));
    if (keyProjection.redactionCount > 0) {
      redactedKeyCount += 1;
      redactionCount += keyProjection.redactionCount + 1;
      let replacementKey = `redacted_attribute_${redactedKeyCount}`;
      while (Object.hasOwn(output, replacementKey) || canonicalInputKeys.has(replacementKey)) {
        redactedKeyCount += 1;
        replacementKey = `redacted_attribute_${redactedKeyCount}`;
      }
      output[replacementKey] = '[REDACTED]';
      continue;
    }
    if (typeof value === 'string') {
      const normalized = value.normalize('NFKC').replace(CONTROL_PATTERN, '');
      if (Buffer.byteLength(normalized, 'utf8') > MAX_ATTRIBUTE_VALUE_BYTES) {
        throw new TypeError('normalized observation attribute value exceeds its byte bound');
      }
      const raw = `${key}=${normalized}`;
      const redacted = redactUntrustedText('observation-attribute', 'LOG', raw);
      redactionCount += redacted.redactionCount;
      output[key] = redacted.redactionCount > 0
        ? '[REDACTED]'
        : redacted.text.slice(key.length + 1);
    } else {
      output[key] = value;
    }
  }
  return Object.freeze({ attributes: Object.freeze(output), redactionCount });
}

export function normalizeObservation(input: Readonly<ShadowObservationInput>): Readonly<ShadowNormalizedObservation> {
  input = snapshotInertJson(input, 'observation') as Readonly<ShadowObservationInput>;
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('observation must be a plain object');
  assertClosedKeys(input, [
    'schema', 'source', 'producerRevision', 'eventId', 'sequence', 'dedupKey', 'eventType', 'resourceId',
    'componentId', 'incidentId', 'occurredAtMs', 'observedAtMs', 'replayClassification',
    'dataClassification', 'provenanceDigest', 'traceId', 'spanId', 'message', 'reasonCodes', 'attributes',
  ], 'observation');
  if (input.schema !== 'AI_OPS_A2_OBSERVATION_V1') throw new TypeError('observation schema unsupported');
  assertIdentifier(input.source, 'observation.source');
  assertIdentifier(input.producerRevision, 'observation.producerRevision');
  assertIdentifier(input.eventId, 'observation.eventId');
  assertSafeNonNegative(input.sequence, 'observation.sequence');
  assertIdentifier(input.dedupKey, 'observation.dedupKey');
  assertIdentifier(input.eventType, 'observation.eventType');
  assertIdentifier(input.resourceId, 'observation.resourceId');
  assertIdentifier(input.componentId, 'observation.componentId');
  if (input.incidentId !== null) assertIdentifier(input.incidentId, 'observation.incidentId');
  if (input.occurredAtMs !== null) assertUtc(input.occurredAtMs, 'observation.occurredAtMs');
  assertUtc(input.observedAtMs, 'observation.observedAtMs');
  if (input.occurredAtMs !== null && input.observedAtMs < input.occurredAtMs) {
    throw new TypeError('observation observed time cannot precede occurrence time');
  }
  if (!(['LIVE', 'REPLAY', 'REDRIVE'] as const).includes(input.replayClassification)) {
    throw new TypeError('observation replay classification unsupported');
  }
  if (!(['PUBLIC', 'INTERNAL', 'SENSITIVE_REDACTED'] as const).includes(input.dataClassification)) {
    throw new TypeError('observation data classification unsupported');
  }
  if (!/^[a-f0-9]{64}$/u.test(input.provenanceDigest)) throw new TypeError('observation provenance digest invalid');
  if (input.traceId !== null) assertIdentifier(input.traceId, 'observation.traceId');
  if (input.spanId !== null) assertIdentifier(input.spanId, 'observation.spanId');
  assertBoundedText(input.message, 'observation.message', MAX_MESSAGE_BYTES);
  const reasonCodes = boundedSortedIdentifiers(input.reasonCodes, 'observation.reasonCodes', MAX_REASON_CODES);
  const normalizedAttributes = normalizeAttributes(input.attributes);
  const messageRedaction = redactUntrustedText('observation-message', 'LOG', input.message);
  const redactedMessage = messageRedaction.text;
  const template = normalizeMessage(redactedMessage);
  if (template.length === 0) throw new TypeError('observation message is empty after normalization');
  assertBoundedText(template, 'normalized observation template', MAX_MESSAGE_BYTES);
  const content = {
    source: input.source,
    producerRevision: input.producerRevision,
    eventId: input.eventId,
    sequence: input.sequence,
    dedupKey: input.dedupKey,
    eventType: input.eventType,
    resourceId: input.resourceId,
    componentId: input.componentId,
    incidentId: input.incidentId,
    occurredAtMs: input.occurredAtMs,
    observedAtMs: input.observedAtMs,
    replayClassification: input.replayClassification,
    dataClassification: input.dataClassification,
    provenanceDigest: input.provenanceDigest,
    traceId: input.traceId,
    spanId: input.spanId,
    messageDigest: sha256(input.message),
    template,
    redactionApplied: messageRedaction.redactionCount + normalizedAttributes.redactionCount > 0,
    reasonCodes,
    attributes: normalizedAttributes.attributes,
  };
  return Object.freeze({
    schema: 'AI_OPS_A2_NORMALIZED_OBSERVATION_V1',
    shadowStatus: SHADOW_A2_STATUS,
    ...content,
    contentDigest: digestValue(content),
  });
}

/** Severity reads only operational effect signals; it never reads model depth. */
export function projectSeverity(signals: Readonly<ShadowSeveritySignals>): ShadowSeverity | null {
  if (typeof signals !== 'object' || signals === null || Array.isArray(signals)) throw new TypeError('severity signals must be an object');
  assertClosedKeys(signals, [
    'safetyInvariantBreached', 'deterministicControlLost', 'customerImpact', 'capitalRelevant',
    'availabilityLoss', 'dataIntegrity',
  ], 'severity signals');
  for (const value of [signals.safetyInvariantBreached, signals.deterministicControlLost, signals.capitalRelevant]) {
    if (value !== true && value !== false && value !== null) throw new TypeError('severity boolean signals must be boolean or null');
  }
  if (!(['NONE', 'LIMITED', 'BROAD', 'UNKNOWN'] as const).includes(signals.customerImpact)) throw new TypeError('customer impact unsupported');
  if (!(['NONE', 'PARTIAL', 'TOTAL', 'UNKNOWN'] as const).includes(signals.availabilityLoss)) throw new TypeError('availability loss unsupported');
  if (!(['INTACT', 'DEGRADED', 'CORRUPT', 'UNKNOWN'] as const).includes(signals.dataIntegrity)) throw new TypeError('data integrity unsupported');
  if (signals.safetyInvariantBreached === true || signals.deterministicControlLost === true) return 'SEV0_SAFETY';
  if (signals.safetyInvariantBreached === null || signals.deterministicControlLost === null) return null;
  if (signals.customerImpact === 'BROAD' || signals.availabilityLoss === 'TOTAL' || signals.dataIntegrity === 'CORRUPT') {
    return 'SEV1_CRITICAL';
  }
  if (signals.customerImpact === 'UNKNOWN' || signals.availabilityLoss === 'UNKNOWN' || signals.dataIntegrity === 'UNKNOWN') return null;
  if (signals.capitalRelevant === true || signals.availabilityLoss === 'PARTIAL' || signals.dataIntegrity === 'DEGRADED') {
    return 'SEV2_MAJOR';
  }
  if (signals.capitalRelevant === null) return null;
  if (signals.customerImpact === 'LIMITED') return 'SEV3_DEGRADED';
  return 'SEV4_INFORMATIONAL';
}

/** Model depth reads only epistemic/workload signals; it never reads severity. */
export function projectModelDepth(signals: Readonly<ShadowDepthSignals>): ShadowModelDepth | null {
  if (typeof signals !== 'object' || signals === null || Array.isArray(signals)) throw new TypeError('depth signals must be an object');
  assertClosedKeys(signals, [
    'deterministicExplanationAvailable', 'evidenceCompleteness', 'novelty', 'causalAmbiguity',
    'repairOrAdjudicationRequested',
  ], 'depth signals');
  if (![true, false, null].includes(signals.deterministicExplanationAvailable)) throw new TypeError('deterministic explanation signal unsupported');
  if (!(['COMPLETE', 'PARTIAL', 'MISSING', 'UNKNOWN'] as const).includes(signals.evidenceCompleteness)) throw new TypeError('evidence completeness unsupported');
  if (!(['KNOWN', 'VARIANT', 'NOVEL', 'UNKNOWN'] as const).includes(signals.novelty)) throw new TypeError('novelty unsupported');
  if (!(['NONE', 'LOW', 'HIGH', 'UNKNOWN'] as const).includes(signals.causalAmbiguity)) throw new TypeError('causal ambiguity unsupported');
  if (!(['NONE', 'REPAIR', 'ADJUDICATE'] as const).includes(signals.repairOrAdjudicationRequested)) throw new TypeError('repair request unsupported');
  if (signals.repairOrAdjudicationRequested === 'ADJUDICATE') return 'L5_ADJUDICATE';
  if (signals.repairOrAdjudicationRequested === 'REPAIR') return 'L4_REPAIR';
  if (signals.novelty === 'NOVEL' || signals.causalAmbiguity === 'HIGH') return 'L3_RESEARCH';
  if (signals.novelty === 'UNKNOWN' || signals.causalAmbiguity === 'UNKNOWN') return null;
  if (signals.evidenceCompleteness === 'PARTIAL' || signals.novelty === 'VARIANT' || signals.causalAmbiguity === 'LOW') {
    return 'L2_DIAGNOSE';
  }
  if (signals.evidenceCompleteness === 'UNKNOWN') return null;
  if (signals.deterministicExplanationAvailable === false) return 'L1_CLASSIFY';
  if (signals.deterministicExplanationAvailable === null) return null;
  if (
    signals.deterministicExplanationAvailable === true
    && signals.evidenceCompleteness === 'COMPLETE'
    && signals.novelty === 'KNOWN'
    && signals.causalAmbiguity === 'NONE'
  ) return 'L0_DETERMINISTIC';
  return null;
}

function validatePolicy(policy: Readonly<ShadowAdmissionPolicy>): void {
  assertClosedKeys(policy, [
    'policyRevision', 'dedupWindowMs', 'cooldownMs', 'stormWindowMs', 'stormThreshold',
    'maximumFingerprints', 'maximumStormChildren', 'maximumSourceEventReceipts',
  ], 'admission policy');
  assertIdentifier(policy.policyRevision, 'policy.policyRevision');
  assertSafeNonNegative(policy.dedupWindowMs, 'policy.dedupWindowMs');
  assertSafeNonNegative(policy.cooldownMs, 'policy.cooldownMs');
  assertPositive(policy.stormWindowMs, 'policy.stormWindowMs');
  assertPositive(policy.stormThreshold, 'policy.stormThreshold');
  assertPositive(policy.maximumFingerprints, 'policy.maximumFingerprints');
  assertPositive(policy.maximumStormChildren, 'policy.maximumStormChildren');
  assertPositive(policy.maximumSourceEventReceipts, 'policy.maximumSourceEventReceipts');
  if (policy.stormThreshold > policy.maximumStormChildren) throw new TypeError('storm threshold exceeds retained storm bound');
  if (
    policy.dedupWindowMs > 24 * 60 * 60 * 1_000
    || policy.cooldownMs > 24 * 60 * 60 * 1_000
    || policy.stormWindowMs > 24 * 60 * 60 * 1_000
    || policy.maximumFingerprints > 10_000
    || policy.maximumStormChildren > 10_000
    || policy.maximumSourceEventReceipts > 10_000
  ) {
    throw new TypeError('admission policy exceeds absolute shadow bounds');
  }
}

function assertNormalizedObservation(observation: Readonly<ShadowNormalizedObservation>): void {
  if (typeof observation !== 'object' || observation === null || Array.isArray(observation)) throw new TypeError('normalized observation must be an object');
  assertClosedKeys(observation, [
    'schema', 'shadowStatus', 'source', 'producerRevision', 'eventId', 'sequence', 'dedupKey', 'eventType',
    'resourceId', 'componentId', 'incidentId', 'occurredAtMs', 'observedAtMs', 'replayClassification',
    'dataClassification', 'provenanceDigest', 'traceId', 'spanId', 'messageDigest', 'template',
    'redactionApplied', 'reasonCodes', 'attributes', 'contentDigest',
  ], 'normalized observation');
  if (observation.schema !== 'AI_OPS_A2_NORMALIZED_OBSERVATION_V1' || observation.shadowStatus !== SHADOW_A2_STATUS) {
    throw new TypeError('normalized observation schema or status unsupported');
  }
  assertIdentifier(observation.source, 'observation.source');
  assertIdentifier(observation.producerRevision, 'observation.producerRevision');
  assertIdentifier(observation.eventId, 'observation.eventId');
  assertSafeNonNegative(observation.sequence, 'observation.sequence');
  assertIdentifier(observation.dedupKey, 'observation.dedupKey');
  assertIdentifier(observation.eventType, 'observation.eventType');
  assertIdentifier(observation.resourceId, 'observation.resourceId');
  assertIdentifier(observation.componentId, 'observation.componentId');
  if (observation.incidentId !== null) assertIdentifier(observation.incidentId, 'observation.incidentId');
  if (observation.occurredAtMs !== null) assertUtc(observation.occurredAtMs, 'observation.occurredAtMs');
  assertUtc(observation.observedAtMs, 'observation.observedAtMs');
  if (observation.occurredAtMs !== null && observation.observedAtMs < observation.occurredAtMs) throw new TypeError('normalized observation time lineage invalid');
  if (!(['LIVE', 'REPLAY', 'REDRIVE'] as const).includes(observation.replayClassification)) throw new TypeError('normalized replay classification invalid');
  if (!(['PUBLIC', 'INTERNAL', 'SENSITIVE_REDACTED'] as const).includes(observation.dataClassification)) throw new TypeError('normalized data classification invalid');
  if (observation.traceId !== null) assertIdentifier(observation.traceId, 'observation.traceId');
  if (observation.spanId !== null) assertIdentifier(observation.spanId, 'observation.spanId');
  assertBoundedText(observation.template, 'observation.template', MAX_MESSAGE_BYTES);
  const canonicalReasons = boundedSortedIdentifiers(observation.reasonCodes, 'observation.reasonCodes', MAX_REASON_CODES);
  if (canonicalJson(canonicalReasons) !== canonicalJson(observation.reasonCodes)) throw new TypeError('normalized observation reason codes are not canonical');
  const checkedAttributes = normalizeAttributes(observation.attributes);
  if (canonicalJson(checkedAttributes.attributes) !== canonicalJson(observation.attributes)) throw new TypeError('normalized observation attributes are not redacted canonical data');
  const checkedTemplate = redactUntrustedText('normalized-template', 'LOG', observation.template);
  if (checkedTemplate.redactionCount > 0) throw new TypeError('normalized observation template contains unredacted secret material');
  if (normalizeMessage(observation.template) !== observation.template) throw new TypeError('normalized observation template is not canonical');
  if (typeof observation.redactionApplied !== 'boolean') throw new TypeError('observation redaction posture invalid');
  if (!/^[a-f0-9]{64}$/u.test(observation.messageDigest) || !/^[a-f0-9]{64}$/u.test(observation.provenanceDigest)) {
    throw new TypeError('normalized observation digest invalid');
  }
  const { contentDigest, schema: _schema, shadowStatus: _status, ...content } = observation;
  if (digestValue(content) !== contentDigest) throw new TypeError('normalized observation content digest mismatch');
}

function materialAttributes(observation: Readonly<ShadowNormalizedObservation>): Readonly<Record<string, string | number | boolean | null>> {
  const result: Record<string, string | number | boolean | null> = Object.create(null) as Record<string, string | number | boolean | null>;
  for (const key of Object.keys(observation.attributes).sort()) {
    if (!VOLATILE_ATTRIBUTE_PATTERN.test(key)) result[key] = observation.attributes[key] ?? null;
  }
  return Object.freeze(result);
}

export function fingerprintObservation(
  observation: Readonly<ShadowNormalizedObservation>,
  policyRevision: string,
): string {
  observation = snapshotInertJson(observation, 'normalized observation') as Readonly<ShadowNormalizedObservation>;
  assertNormalizedObservation(observation);
  assertIdentifier(policyRevision, 'policyRevision');
  return sha256(canonicalJson({
    schema: observation.schema,
    policyRevision,
    source: observation.source,
    producerRevision: observation.producerRevision,
    eventType: observation.eventType,
    resourceId: observation.resourceId,
    componentId: observation.componentId,
    template: observation.template,
    reasonCodes: observation.reasonCodes,
    materialAttributes: materialAttributes(observation),
  }));
}

export function createAdmissionState(policyRevision: string): Readonly<ShadowAdmissionState> {
  assertIdentifier(policyRevision, 'policyRevision');
  return Object.freeze({
    schema: 'AI_OPS_A2_ADMISSION_STATE_V1',
    shadowStatus: SHADOW_A2_STATUS,
    policyRevision,
    fingerprints: Object.freeze([]),
    stormObservations: Object.freeze([]),
    stormParents: Object.freeze([]),
  });
}

function validateAdmissionState(current: Readonly<ShadowAdmissionState>, policy: Readonly<ShadowAdmissionPolicy>): void {
  if (typeof current !== 'object' || current === null || Array.isArray(current)) throw new TypeError('admission state must be an object');
  assertClosedKeys(current, ['schema', 'shadowStatus', 'policyRevision', 'fingerprints', 'stormObservations', 'stormParents'], 'admission state');
  if (current.schema !== 'AI_OPS_A2_ADMISSION_STATE_V1' || current.shadowStatus !== SHADOW_A2_STATUS || current.policyRevision !== policy.policyRevision) {
    throw new TypeError('admission state policy revision mismatch');
  }
  if (!Array.isArray(current.fingerprints) || current.fingerprints.length > policy.maximumFingerprints) throw new TypeError('admission fingerprint bound invalid');
  if (!Array.isArray(current.stormObservations) || current.stormObservations.length > policy.maximumStormChildren) throw new TypeError('admission storm bound invalid');
  if (!Array.isArray(current.stormParents) || current.stormParents.length > policy.maximumStormChildren) throw new TypeError('admission storm-parent bound invalid');
  if (new Set(current.fingerprints.map((entry) => entry.fingerprint)).size !== current.fingerprints.length) throw new TypeError('admission fingerprints must be unique');
  const sourceEventKeys = new Set<string>();
  const durableSourceEvents: Array<Readonly<{
    fingerprint: string;
    sourceEventKey: string;
    observedAtMs: number;
    componentId: string;
  }>> = [];
  for (const entry of current.fingerprints) {
    assertClosedKeys(entry, [
      'fingerprint', 'proposedIncidentId', 'firstObservedAtMs', 'lastObservedAtMs', 'occurrenceCount', 'cooldownUntilMs',
      'rootFingerprint', 'sourceEvents',
    ], 'admission fingerprint');
    assertDigest(entry.fingerprint, 'fingerprint.fingerprint');
    assertIdentifier(entry.proposedIncidentId, 'fingerprint.proposedIncidentId');
    const expectedIncidentId = shadowSpeculativeId('a2-incident', {
      fingerprint: entry.fingerprint,
      policyRevision: policy.policyRevision,
    });
    if (entry.proposedIncidentId !== expectedIncidentId) throw new TypeError('proposed incident identity is not canonical');
    assertUtc(entry.firstObservedAtMs, 'fingerprint.firstObservedAtMs');
    assertUtc(entry.lastObservedAtMs, 'fingerprint.lastObservedAtMs');
    if (entry.lastObservedAtMs < entry.firstObservedAtMs) throw new TypeError('fingerprint time lineage invalid');
    assertPositive(entry.occurrenceCount, 'fingerprint.occurrenceCount');
    if (entry.cooldownUntilMs !== null) {
      assertUtc(entry.cooldownUntilMs, 'fingerprint.cooldownUntilMs');
    }
    if (entry.rootFingerprint !== null) assertDigest(entry.rootFingerprint, 'fingerprint.rootFingerprint');
    if (!Array.isArray(entry.sourceEvents) || entry.sourceEvents.length > policy.maximumSourceEventReceipts || entry.sourceEvents.length !== entry.occurrenceCount) {
      throw new TypeError('fingerprint source-event receipt lineage invalid');
    }
    for (const sourceEvent of entry.sourceEvents) {
      assertClosedKeys(sourceEvent, ['sourceEventKey', 'contentDigest', 'observedAtMs', 'componentId'], 'source-event receipt');
      assertIdentifier(sourceEvent.sourceEventKey, 'sourceEvent.sourceEventKey');
      assertDigest(sourceEvent.contentDigest, 'sourceEvent.contentDigest');
      assertUtc(sourceEvent.observedAtMs, 'sourceEvent.observedAtMs');
      assertIdentifier(sourceEvent.componentId, 'sourceEvent.componentId');
      if (sourceEvent.observedAtMs < entry.firstObservedAtMs || sourceEvent.observedAtMs > entry.lastObservedAtMs) {
        throw new TypeError('source-event receipt time is outside fingerprint lineage');
      }
      if (sourceEventKeys.has(sourceEvent.sourceEventKey)) throw new TypeError('source-event receipt identity must be globally unique');
      sourceEventKeys.add(sourceEvent.sourceEventKey);
      durableSourceEvents.push(Object.freeze({
        fingerprint: entry.fingerprint,
        sourceEventKey: sourceEvent.sourceEventKey,
        observedAtMs: sourceEvent.observedAtMs,
        componentId: sourceEvent.componentId,
      }));
    }
    if (new Set(entry.sourceEvents.map(
      (sourceEvent: ShadowFingerprintState['sourceEvents'][number]) => sourceEvent.componentId,
    )).size > 1) {
      throw new TypeError('fingerprint source-event component lineage conflict');
    }
  }
  for (const entry of current.fingerprints) {
    let cursor = entry.rootFingerprint;
    const visited = new Set<string>([entry.fingerprint]);
    while (cursor !== null) {
      if (visited.has(cursor)) throw new TypeError('admission inhibition cycle invalid');
      visited.add(cursor);
      const root = current.fingerprints.find((candidate) => candidate.fingerprint === cursor);
      if (!root) throw new TypeError('admission inhibition root missing');
      cursor = root.rootFingerprint;
    }
  }
  const stormObservations = current.stormObservations;
  if (new Set(stormObservations.map((storm) => storm.sourceEventKey)).size !== stormObservations.length) {
    throw new TypeError('storm observation source-event receipts must be unique');
  }
  for (const storm of stormObservations) {
    assertClosedKeys(storm, ['componentId', 'observedAtMs', 'fingerprint', 'eventId', 'sourceEventKey'], 'storm observation');
    assertIdentifier(storm.componentId, 'storm.componentId');
    assertUtc(storm.observedAtMs, 'storm.observedAtMs');
    assertDigest(storm.fingerprint, 'storm.fingerprint');
    assertIdentifier(storm.eventId, 'storm.eventId');
    assertIdentifier(storm.sourceEventKey, 'storm.sourceEventKey');
    const fingerprintOwner = current.fingerprints.find((entry) => entry.fingerprint === storm.fingerprint);
    if (!fingerprintOwner) throw new TypeError('storm observation fingerprint is missing');
    const matchingReceipt = fingerprintOwner.sourceEvents.filter((receipt: ShadowFingerprintState['sourceEvents'][number]) => (
      receipt.sourceEventKey === storm.sourceEventKey
      && receipt.observedAtMs === storm.observedAtMs
      && receipt.componentId === storm.componentId
    ));
    if (matchingReceipt.length !== 1) throw new TypeError('storm observation is not backed by its canonical source-event receipt');
  }
  if (new Set(current.stormParents.map((parent) => parent.componentId)).size !== current.stormParents.length) {
    throw new TypeError('storm parent components must be unique');
  }
  for (const parent of current.stormParents) {
    assertClosedKeys(parent, ['componentId', 'parentId', 'anchorEventId', 'activatedAtMs', 'lastObservedAtMs'], 'storm parent');
    assertIdentifier(parent.componentId, 'stormParent.componentId');
    assertIdentifier(parent.parentId, 'stormParent.parentId');
    assertIdentifier(parent.anchorEventId, 'stormParent.anchorEventId');
    assertUtc(parent.activatedAtMs, 'stormParent.activatedAtMs');
    assertUtc(parent.lastObservedAtMs, 'stormParent.lastObservedAtMs');
    if (parent.lastObservedAtMs < parent.activatedAtMs) throw new TypeError('storm parent time lineage invalid');
    const componentReceipts = durableSourceEvents.filter((receipt) => receipt.componentId === parent.componentId);
    if (!componentReceipts.some((receipt) => receipt.sourceEventKey === parent.anchorEventId)) {
      throw new TypeError('storm parent anchor is not backed by a durable source-event receipt');
    }
    if (!componentReceipts.some((receipt) => receipt.observedAtMs === parent.activatedAtMs)) {
      throw new TypeError('storm parent activation is not backed by a durable source-event receipt');
    }
    const lastComponentObservationMs = componentReceipts.reduce(
      (latest, receipt) => Math.max(latest, receipt.observedAtMs),
      -1,
    );
    if (parent.lastObservedAtMs !== lastComponentObservationMs) {
      throw new TypeError('storm parent last observation is not bound to the latest durable source-event receipt');
    }
    const expectedParentId = shadowSpeculativeId('a2-storm-parent', {
      componentId: parent.componentId,
      policyRevision: policy.policyRevision,
    });
    if (parent.parentId !== expectedParentId) throw new TypeError('storm parent identity is not canonical');
  }
}

export interface AdmitObservationInput {
  readonly observation: Readonly<ShadowNormalizedObservation>;
  readonly admissionAtMs: number;
  readonly severitySignals: Readonly<ShadowSeveritySignals>;
  readonly depthSignals: Readonly<ShadowDepthSignals>;
  readonly rootFingerprint: string | null;
  readonly materiality: 'MATERIAL' | 'NON_MATERIAL' | 'UNKNOWN';
}

export interface AdmitObservationResult {
  readonly shadowStatus: typeof SHADOW_A2_STATUS;
  readonly state: Readonly<ShadowAdmissionState>;
  readonly projection: Readonly<ShadowAdmissionProjection>;
}

export function admitObservation(
  current: Readonly<ShadowAdmissionState>,
  input: Readonly<AdmitObservationInput>,
  policy: Readonly<ShadowAdmissionPolicy>,
): Readonly<AdmitObservationResult> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'admission state') as Readonly<ShadowAdmissionState>;
  input = snapshotInertJson(input, 'admission input') as Readonly<AdmitObservationInput>;
  policy = snapshotInertJson(policy, 'admission policy') as Readonly<ShadowAdmissionPolicy>;
  validatePolicy(policy);
  validateAdmissionState(current, policy);
  assertClosedKeys(input, [
    'observation', 'admissionAtMs', 'severitySignals', 'depthSignals', 'rootFingerprint', 'materiality',
  ], 'admission input');
  const observation = input.observation;
  assertNormalizedObservation(observation);
  assertUtc(input.admissionAtMs, 'input.admissionAtMs');
  if (observation.observedAtMs > input.admissionAtMs) throw new TypeError('future observation cannot enter admission state');
  if (!(['MATERIAL', 'NON_MATERIAL', 'UNKNOWN'] as const).includes(input.materiality)) throw new TypeError('admission materiality unsupported');
  const severity = projectSeverity(input.severitySignals);
  const requestedModelDepth = projectModelDepth(input.depthSignals);
  const fingerprint = fingerprintObservation(observation, policy.policyRevision);
  if (input.rootFingerprint !== null) {
    if (!/^[a-f0-9]{64}$/u.test(input.rootFingerprint)) throw new TypeError('root fingerprint must be a SHA-256 digest');
    if (input.rootFingerprint === fingerprint) throw new TypeError('incident inhibition cannot target itself');
    let cursor: string | null = input.rootFingerprint;
    const visited = new Set<string>([fingerprint]);
    while (cursor !== null) {
      if (visited.has(cursor)) throw new TypeError('incident inhibition cycle refused');
      visited.add(cursor);
      const root = current.fingerprints.find((entry) => entry.fingerprint === cursor);
      if (!root) throw new TypeError('incident inhibition root is not present');
      cursor = root.rootFingerprint;
    }
  }
  const sourceEventKey = shadowSpeculativeId('a2-source-event', {
    source: observation.source,
    producerRevision: observation.producerRevision,
    dedupKey: observation.dedupKey,
  });
  const eventPayloadDigest = digestValue({
    source: observation.source,
    producerRevision: observation.producerRevision,
    dedupKey: observation.dedupKey,
    eventType: observation.eventType,
    resourceId: observation.resourceId,
    componentId: observation.componentId,
    incidentId: observation.incidentId,
    occurredAtMs: observation.occurredAtMs,
    dataClassification: observation.dataClassification,
    provenanceDigest: observation.provenanceDigest,
    traceId: observation.traceId,
    spanId: observation.spanId,
    messageDigest: observation.messageDigest,
    reasonCodes: observation.reasonCodes,
    attributes: observation.attributes,
    severitySignals: input.severitySignals,
    depthSignals: input.depthSignals,
    rootFingerprint: input.rootFingerprint,
    materiality: input.materiality,
  });
  const priorSourceEvent = current.fingerprints
    .flatMap((entry) => entry.sourceEvents)
    .find((entry) => entry.sourceEventKey === sourceEventKey);
  if (priorSourceEvent && priorSourceEvent.contentDigest !== eventPayloadDigest) {
    throw new TypeError('same source event identity has conflicting content');
  }
  const previous = current.fingerprints.find((entry) => entry.fingerprint === fingerprint);
  if (previous && previous.rootFingerprint !== input.rootFingerprint) {
    throw new TypeError('fingerprint inhibition root lineage conflict');
  }
  const sameReplay = priorSourceEvent !== undefined;
  const proposedIncidentId = previous?.proposedIncidentId ?? shadowSpeculativeId('a2-incident', {
    fingerprint,
    policyRevision: policy.policyRevision,
  });
  if (sameReplay) {
    if (!previous) throw new TypeError('source-event receipt has no fingerprint owner');
    return Object.freeze({
      shadowStatus: SHADOW_A2_STATUS,
      state: current,
      projection: Object.freeze({
        schema: 'AI_OPS_A2_ADMISSION_PROJECTION_V1',
        shadowStatus: SHADOW_A2_STATUS,
        disposition: 'DEDUPLICATED',
        admitted: false,
        severity,
        requestedModelDepth,
        fingerprint,
        proposedIncidentId,
        stormParentId: null,
        inhibitedByFingerprint: previous.rootFingerprint,
        evidenceRetained: true,
        reasonCodes: Object.freeze(['EXACT_EVENT_REPLAY']),
      }),
    });
  }
  const withinDedup = previous?.sourceEvents.some(
    (receipt) => Math.abs(observation.observedAtMs - receipt.observedAtMs) <= policy.dedupWindowMs,
  ) ?? false;
  const cooling = previous?.cooldownUntilMs !== null
    && previous?.cooldownUntilMs !== undefined
    && observation.observedAtMs < previous.cooldownUntilMs;

  const admissionWatermarkMs = current.fingerprints.reduce(
    (watermark, entry) => Math.max(watermark, entry.lastObservedAtMs),
    observation.observedAtMs,
  );
  const retainedStorm = current.stormObservations
    .filter((entry) => admissionWatermarkMs - entry.observedAtMs <= policy.stormWindowMs);
  const componentStorm = retainedStorm.filter((entry) => (
    entry.componentId === observation.componentId
    && Math.abs(observation.observedAtMs - entry.observedAtMs) <= policy.stormWindowMs
  ));
  const stormActive = componentStorm.length + 1 >= policy.stormThreshold;
  const stormAnchorSourceEventKey = [...componentStorm, {
    componentId: observation.componentId,
    observedAtMs: observation.observedAtMs,
    fingerprint,
    eventId: observation.eventId,
    sourceEventKey,
  }].sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareCodeUnitStrings(left.sourceEventKey, right.sourceEventKey)
  ))[0]?.sourceEventKey ?? sourceEventKey;
  const activeStormParents = current.stormParents.filter((parent) => admissionWatermarkMs - parent.lastObservedAtMs <= policy.stormWindowMs);
  const existingStormParent = activeStormParents.find((parent) => parent.componentId === observation.componentId) ?? null;
  if (stormActive && existingStormParent === null && activeStormParents.length >= policy.maximumStormChildren) {
    throw new RangeError('storm parent capacity reached');
  }
  const stormParentId = stormActive
    ? existingStormParent?.parentId ?? shadowSpeculativeId('a2-storm-parent', {
        componentId: observation.componentId,
        policyRevision: policy.policyRevision,
      })
    : null;

  let disposition: ShadowAdmissionProjection['disposition'] = 'ADMIT_PROPOSAL';
  const reasons: string[] = [];
  if (withinDedup) {
    disposition = 'DEDUPLICATED';
    reasons.push('FINGERPRINT_WITHIN_DEDUP_WINDOW');
  } else if (cooling) {
    disposition = 'COOLDOWN_SUPPRESSED';
    reasons.push('FINGERPRINT_COOLDOWN_ACTIVE');
  } else if (input.rootFingerprint !== null) {
    disposition = 'INHIBITED_CHILD';
    reasons.push('ROOT_CAUSE_INHIBITION_PROJECTED');
  } else if (stormActive) {
    disposition = 'STORM_CHILD';
    reasons.push('STORM_PARENT_PROJECTED');
  } else {
    reasons.push('INCIDENT_ADMISSION_PROJECTED');
  }
  if (
    !['DEDUPLICATED', 'COOLDOWN_SUPPRESSED'].includes(disposition)
    && (severity === null || requestedModelDepth === null || input.materiality === 'UNKNOWN')
  ) {
    disposition = 'QUARANTINED_INCOMPLETE';
    reasons.push('ADMISSION_INPUT_INCOMPLETE');
  } else if (
    !['DEDUPLICATED', 'COOLDOWN_SUPPRESSED'].includes(disposition)
    && (severity === 'SEV4_INFORMATIONAL' || input.materiality === 'NON_MATERIAL')
  ) {
    disposition = 'STORE_AND_AGGREGATE';
    reasons.push('INFORMATIONAL_OR_NON_MATERIAL');
  } else if (requestedModelDepth === 'L0_DETERMINISTIC' && disposition === 'ADMIT_PROPOSAL') {
    disposition = 'DETERMINISTIC_PATH';
    reasons.push('DETERMINISTIC_RUNBOOK_PATH');
  }
  if (!previous && current.fingerprints.length >= policy.maximumFingerprints) {
    throw new RangeError('admission fingerprint capacity reached');
  }
  if (previous && previous.sourceEvents.length >= policy.maximumSourceEventReceipts) {
    throw new RangeError('source-event receipt capacity reached');
  }
  const nextFingerprint: Readonly<ShadowFingerprintState> = Object.freeze({
    fingerprint,
    proposedIncidentId,
    firstObservedAtMs: Math.min(previous?.firstObservedAtMs ?? observation.observedAtMs, observation.observedAtMs),
    lastObservedAtMs: Math.max(previous?.lastObservedAtMs ?? observation.observedAtMs, observation.observedAtMs),
    occurrenceCount: (previous?.occurrenceCount ?? 0) + 1,
    cooldownUntilMs: previous?.cooldownUntilMs ?? null,
    rootFingerprint: previous?.rootFingerprint ?? input.rootFingerprint,
    sourceEvents: Object.freeze([
      ...(previous?.sourceEvents ?? []),
      Object.freeze({
        sourceEventKey,
        contentDigest: eventPayloadDigest,
        observedAtMs: observation.observedAtMs,
        componentId: observation.componentId,
      }),
    ]),
  });
  const fingerprints = [
    ...current.fingerprints.filter((entry) => entry.fingerprint !== fingerprint),
    nextFingerprint,
  ].sort((left, right) => left.lastObservedAtMs - right.lastObservedAtMs || compareCodeUnitStrings(left.fingerprint, right.fingerprint));
  const incomingWithinActiveStormWindow = admissionWatermarkMs - observation.observedAtMs <= policy.stormWindowMs;
  const stormCandidates = [
    ...retainedStorm,
    ...(incomingWithinActiveStormWindow ? [Object.freeze({
      componentId: observation.componentId,
      observedAtMs: observation.observedAtMs,
      fingerprint,
      eventId: observation.eventId,
      sourceEventKey,
    })] : []),
  ];
  const byComponent = new Map<string, typeof stormCandidates>();
  for (const entry of stormCandidates) {
    const group = byComponent.get(entry.componentId) ?? [];
    group.push(entry);
    byComponent.set(entry.componentId, group);
  }
  const requiredCausalEntries = [...byComponent.values()].flatMap((entries) => {
    const ordered = entries.sort((left, right) => (
      left.observedAtMs - right.observedAtMs || compareCodeUnitStrings(left.sourceEventKey, right.sourceEventKey)
    ));
    const requiredCount = Math.min(ordered.length, policy.stormThreshold - 1);
    return requiredCount <= 1 ? ordered.slice(0, requiredCount) : [ordered[0], ...ordered.slice(-(requiredCount - 1))];
  });
  if (requiredCausalEntries.length > policy.maximumStormChildren) {
    throw new RangeError('storm causal retention capacity reached');
  }
  const requiredSourceEventKeys = new Set(requiredCausalEntries.map((entry) => entry.sourceEventKey));
  const remainingStormCapacity = policy.maximumStormChildren - requiredCausalEntries.length;
  const orderedNonRequired = stormCandidates.filter((entry) => !requiredSourceEventKeys.has(entry.sourceEventKey)).sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareCodeUnitStrings(left.sourceEventKey, right.sourceEventKey)
  ));
  const newestNonRequired = remainingStormCapacity === 0 ? [] : orderedNonRequired.slice(-remainingStormCapacity);
  const stormObservations = [...requiredCausalEntries, ...newestNonRequired].sort((left, right) => (
    left.observedAtMs - right.observedAtMs || compareCodeUnitStrings(left.sourceEventKey, right.sourceEventKey)
  ));
  const componentTimeline = stormCandidates
    .filter((entry) => entry.componentId === observation.componentId)
    .sort((left, right) => left.observedAtMs - right.observedAtMs || compareCodeUnitStrings(left.sourceEventKey, right.sourceEventKey));
  const thresholdObservedAtMs = componentTimeline.length >= policy.stormThreshold
    ? componentTimeline[policy.stormThreshold - 1]?.observedAtMs ?? null
    : null;
  const stormParents = stormActive || existingStormParent !== null
    ? [
        ...activeStormParents.filter((parent) => parent.componentId !== observation.componentId),
        Object.freeze({
          componentId: observation.componentId,
          parentId: existingStormParent?.parentId ?? stormParentId as string,
          anchorEventId: componentTimeline[0]?.sourceEventKey ?? existingStormParent?.anchorEventId ?? stormAnchorSourceEventKey,
          activatedAtMs: Math.min(
            existingStormParent?.activatedAtMs ?? thresholdObservedAtMs ?? observation.observedAtMs,
            thresholdObservedAtMs ?? existingStormParent?.activatedAtMs ?? observation.observedAtMs,
          ),
          lastObservedAtMs: Math.max(
            existingStormParent?.lastObservedAtMs ?? observation.observedAtMs,
            observation.observedAtMs,
            ...componentTimeline.map((entry) => entry.observedAtMs),
          ),
        }),
      ].sort((left, right) => compareCodeUnitStrings(left.componentId, right.componentId))
    : activeStormParents;
  const nextState: Readonly<ShadowAdmissionState> = Object.freeze({
    schema: 'AI_OPS_A2_ADMISSION_STATE_V1',
    shadowStatus: SHADOW_A2_STATUS,
    policyRevision: policy.policyRevision,
    fingerprints: Object.freeze(fingerprints),
    stormObservations: Object.freeze(stormObservations),
    stormParents: Object.freeze(stormParents),
  });
  validateAdmissionState(nextState, policy);
  const projection: Readonly<ShadowAdmissionProjection> = Object.freeze({
    schema: 'AI_OPS_A2_ADMISSION_PROJECTION_V1',
    shadowStatus: SHADOW_A2_STATUS,
    disposition,
    admitted: ['ADMIT_PROPOSAL', 'DETERMINISTIC_PATH'].includes(disposition),
    severity,
    requestedModelDepth,
    fingerprint,
    proposedIncidentId,
    stormParentId,
    inhibitedByFingerprint: input.rootFingerprint,
    evidenceRetained: true,
    reasonCodes: Object.freeze(reasons),
  });
  return Object.freeze({ shadowStatus: SHADOW_A2_STATUS, state: nextState, projection });
}

export function markFingerprintResolved(
  current: Readonly<ShadowAdmissionState>,
  fingerprint: string,
  resolvedAtMs: number,
  policy: Readonly<ShadowAdmissionPolicy>,
): Readonly<ShadowAdmissionState> {
  current = snapshotInertJsonPreservingDeepFreeze(current, 'admission state') as Readonly<ShadowAdmissionState>;
  policy = snapshotInertJson(policy, 'admission policy') as Readonly<ShadowAdmissionPolicy>;
  validatePolicy(policy);
  validateAdmissionState(current, policy);
  assertUtc(resolvedAtMs, 'resolvedAtMs');
  const found = current.fingerprints.find((entry) => entry.fingerprint === fingerprint);
  if (!found) throw new TypeError('fingerprint is not present in admission state');
  if (resolvedAtMs < found.lastObservedAtMs) throw new TypeError('resolution cannot precede last observation');
  const projectedCooldownUntilMs = resolvedAtMs + policy.cooldownMs;
  assertUtc(projectedCooldownUntilMs, 'cooldownUntilMs');
  const cooldownUntilMs = Math.max(found.cooldownUntilMs ?? projectedCooldownUntilMs, projectedCooldownUntilMs);
  return Object.freeze({
    ...current,
    fingerprints: Object.freeze(current.fingerprints.map((entry) => entry.fingerprint === fingerprint
      ? Object.freeze({ ...entry, cooldownUntilMs })
      : entry)),
  });
}
