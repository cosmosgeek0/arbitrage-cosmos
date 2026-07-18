import { createHash } from 'node:crypto';

import type {
  LedgerEventRecord,
  ProductIncidentPersistenceInput,
  ProductIncidentRecord,
  ProductIncidentRotationInput,
  ProductPersistenceAuditRecord,
  ProductPersistenceMutationResult,
  SystemJsonValue,
} from '../../systemIntegration/persistence/types.js';
import {
  productIncidentAcknowledgementControlId,
} from '../runtime/controls.js';
import { readProductIncidentAcknowledgementEvidence } from './owner.js';
import type {
  ProductRuntimeIncidentProjection,
  ProductRuntimeIncidentSnapshot,
} from '../runtime/types.js';

const ROUTE_SCHEMA = 'cosmos.product-incident-route.v1' as const;
const ROTATION_SCHEMA = 'cosmos.product-incident-rotation.v1' as const;
const SOURCE_DISPOSITION_SCHEMA = 'cosmos.product-incident-source-disposition.v1' as const;
const ROUTE_AUDIT_KEYS = Object.freeze([
  'schema', 'operation', 'sourceEventId', 'sourceEventKind', 'sourceGroup',
  'sourceStatus', 'sourceDetail', 'sourceObservedAtMs', 'incidentId', 'fingerprint', 'rootComponentId',
  'severity', 'capitalRelevant', 'state', 'firstSeenAtMs', 'lastSeenAtMs',
  'eventCount', 'acknowledgedAtMs', 'acknowledgedByOperatorId', 'resolvedAtMs',
  'reasonCode', 'correlationId', 'routing', 'externalActionAuthorization',
]);
const SOURCE_DISPOSITION_KEYS = Object.freeze([
  'schema', 'operation', 'sourceEventId', 'sourceEventKind', 'sourceGroup',
  'sourceStatus', 'sourceDetail', 'sourceObservedAtMs', 'rootComponentId',
  'groupingDigest', 'incidentId', 'priorDispositionEventId', 'priorSourceEventId',
  'priorObservedAtMs', 'externalActionAuthorization',
]);
const ROTATION_KEYS = Object.freeze([
  'schema', 'operation', 'incidentId', 'expectedLedgerEventId', 'reasonCode',
  'retentionLimit', 'snapshot', 'externalActionAuthorization',
]);
const ROTATION_SNAPSHOT_KEYS = Object.freeze([
  'incidentId', 'fingerprint', 'rootComponentId', 'severity', 'capitalRelevant',
  'state', 'firstSeenAtMs', 'lastSeenAtMs', 'eventCount', 'acknowledgedAtMs',
  'acknowledgedByOperatorId', 'resolvedAtMs', 'correlationId', 'ledgerEventId',
  'sourceGroup', 'openingRoutingReceiptEventId', 'openingSourceEventId',
  'recoveryRoutingReceiptEventId', 'recoverySourceEventId',
]);
const ROUTER_FINGERPRINT_PREFIX = 'incident.connection_unhealthy.' as const;
const ACK_SCHEMAS = new Set(['cosmos.product-incident-ack.v1', 'cosmos.product-incident-ack.v2']);
const MAX_BOOTSTRAP_PAGE = 500;
const MAX_INCIDENTS = 200;
const MAX_UTC_MS = 4_102_444_800_000;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const);
const CAPITAL_RELEVANT_COMPONENT_IDS = new Set([
  'control-api', 'market-streams', 'binance-rest', 'strategy-runtimes', 'ledger-db',
]);

export interface ProductIncidentRouterPersistencePort {
  readProductIncident(incidentId: string): Readonly<ProductIncidentRecord> | null;
  readProductIncidentSourceEvent(sourceEventId: number): Readonly<LedgerEventRecord> | null;
  readProductIncidentsByFingerprintPrefix(
    fingerprintPrefix: string,
    limit: number,
  ): readonly Readonly<ProductIncidentRecord>[];
  countProductIncidentsByFingerprintPrefix(fingerprintPrefix: string): number;
  readProductIncidentRoutingBySourceEventId(sourceEventId: number): Readonly<LedgerEventRecord> | null;
  readProductIncidentRoutingByReceiptEventId(receiptEventId: number): Readonly<LedgerEventRecord> | null;
  readLatestProductIncidentSourceDisposition(
    componentId: string,
    sourceGroup: string,
  ): Readonly<LedgerEventRecord> | null;
  readPreviousProductIncidentSourceDisposition(
    componentId: string,
    sourceGroup: string,
    beforeSourceEventId: number,
  ): Readonly<LedgerEventRecord> | null;
  readPreviousProductIncidentRoutedDisposition(
    componentId: string,
    sourceGroup: string,
    beforeSourceEventId: number,
  ): Readonly<LedgerEventRecord> | null;
  readProductIncidentAcknowledgementByIncidentId(
    incidentId: string,
  ): Readonly<LedgerEventRecord> | null;
  readProductIncidentOpeningRoutingByIncidentId(incidentId: string): Readonly<LedgerEventRecord> | null;
  readProductIncidentRotationByIncidentId(incidentId: string): Readonly<LedgerEventRecord> | null;
  readOldestResolvedProductIncidentByFingerprintPrefix(
    fingerprintPrefix: string,
  ): Readonly<ProductIncidentRecord> | null;
  compareAndTransitionProductIncident(
    input: Readonly<ProductIncidentPersistenceInput>,
  ): Readonly<ProductPersistenceMutationResult>;
  compareAndRotateResolvedProductIncident(
    input: Readonly<ProductIncidentRotationInput>,
  ): Readonly<ProductPersistenceMutationResult>;
  recordProductIncidentSourceDisposition(
    audit: Readonly<ProductPersistenceAuditRecord>,
  ): Readonly<ProductPersistenceMutationResult>;
  advanceProductIncidentRouterCheckpoint(sourceEventId: number): void;
}

export type ProductIncidentIngestResult = Readonly<{
  disposition: 'OPENED' | 'GROUPED' | 'RESOLVED' | 'IDEMPOTENT_REPLAY' | 'IGNORED';
  incidentId: string | null;
  sourceEventId: number;
}>;

interface AdmittedSourceEvent {
  readonly id: number;
  readonly ts: number;
  readonly kind: 'connection_alert' | 'connection_recovered';
  readonly componentId: string;
  readonly group: string;
  readonly status: 'degraded' | 'outage' | 'operational';
  readonly detail: string;
  readonly observedAtMs: number;
}

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function utcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function admittedSourceEvent(value: unknown): Readonly<AdmittedSourceEvent> | null {
  if (!plainObject(value)
    || !Number.isSafeInteger(value.id) || Number(value.id) < 1
    || !utcMillis(value.ts)
    || (value.kind !== 'connection_alert' && value.kind !== 'connection_recovered')
    || !plainObject(value.data)) return null;
  const data = value.data;
  if (typeof data.componentId !== 'string' || !IDENTIFIER.test(data.componentId)
    || typeof data.group !== 'string' || !IDENTIFIER.test(data.group)
    || (data.status !== 'degraded' && data.status !== 'outage' && data.status !== 'operational')
    || typeof data.detail !== 'string' || data.detail.length > 2_000
    || !utcMillis(data.observedAt)
    || Number(data.observedAt) > Number(value.ts)
    || (value.kind === 'connection_alert' && data.status === 'operational')
    || (value.kind === 'connection_recovered' && data.status !== 'operational')) return null;
  return Object.freeze({
    id: Number(value.id),
    ts: Number(value.ts),
    kind: value.kind,
    componentId: data.componentId,
    group: data.group,
    status: data.status,
    detail: data.detail,
    observedAtMs: data.observedAt,
  });
}

function exactAdmittedSourceEvent(
  left: Readonly<AdmittedSourceEvent>,
  right: Readonly<AdmittedSourceEvent>,
): boolean {
  return left.id === right.id
    && left.ts === right.ts
    && left.kind === right.kind
    && left.componentId === right.componentId
    && left.group === right.group
    && left.status === right.status
    && left.detail === right.detail
    && left.observedAtMs === right.observedAtMs;
}

function groupingDigest(event: Readonly<AdmittedSourceEvent>): string {
  return createHash('sha256')
    .update('product-incident-group.v1\0', 'utf8')
    .update(event.componentId, 'utf8')
    .update('\0', 'utf8')
    .update(event.group, 'utf8')
    .digest('hex');
}

function episodeFingerprint(event: Readonly<AdmittedSourceEvent>, digest: string): string {
  return `${ROUTER_FINGERPRINT_PREFIX}${digest}.episode.${event.id}`;
}

function incidentId(event: Readonly<AdmittedSourceEvent>, digest: string): string {
  return `incident.product.${digest}.episode.${event.id}`;
}

function correlationId(event: Readonly<AdmittedSourceEvent>, digest: string): string {
  return `product.incident.${digest.slice(0, 32)}.${event.id}`;
}

function baseFingerprintPrefix(digest: string): string {
  return `${ROUTER_FINGERPRINT_PREFIX}${digest}.episode.`;
}

function severityFor(event: Readonly<AdmittedSourceEvent>): ProductRuntimeIncidentProjection['severity'] {
  if (event.status === 'outage') return 'CRITICAL';
  if (event.status === 'degraded') return 'HIGH';
  return 'MEDIUM';
}

function capitalRelevantFor(componentId: string): boolean {
  return CAPITAL_RELEVANT_COMPONENT_IDS.has(componentId);
}

function maximumSeverity(
  left: ProductRuntimeIncidentProjection['severity'],
  right: ProductRuntimeIncidentProjection['severity'],
): ProductRuntimeIncidentProjection['severity'] {
  return SEVERITIES.indexOf(left) <= SEVERITIES.indexOf(right) ? left : right;
}

function routingAudit(
  operation: 'OPEN' | 'GROUP' | 'RESOLVE',
  event: Readonly<AdmittedSourceEvent>,
  input: Readonly<{
    incidentId: string;
    fingerprint: string;
    severity: ProductRuntimeIncidentProjection['severity'];
    capitalRelevant: boolean;
    state: ProductRuntimeIncidentProjection['state'];
    firstSeenAtMs: number;
    lastSeenAtMs: number;
    eventCount: number;
    acknowledgedAtMs: number | null;
    acknowledgedByOperatorId: string | null;
    resolvedAtMs: number | null;
    correlationId: string;
  }>,
): SystemJsonValue {
  return Object.freeze({
    schema: ROUTE_SCHEMA,
    operation,
    sourceEventId: event.id,
    sourceEventKind: event.kind,
    sourceGroup: event.group,
    sourceStatus: event.status,
    sourceDetail: event.detail,
    sourceObservedAtMs: event.observedAtMs,
    incidentId: input.incidentId,
    fingerprint: input.fingerprint,
    rootComponentId: event.componentId,
    severity: input.severity,
    capitalRelevant: input.capitalRelevant,
    state: input.state,
    firstSeenAtMs: input.firstSeenAtMs,
    lastSeenAtMs: input.lastSeenAtMs,
    eventCount: input.eventCount,
    acknowledgedAtMs: input.acknowledgedAtMs,
    acknowledgedByOperatorId: input.acknowledgedByOperatorId,
    resolvedAtMs: input.resolvedAtMs,
    reasonCode: 'CONNECTION_UNHEALTHY',
    correlationId: input.correlationId,
    routing: Object.freeze({
      inApp: 'WIRED_LOCAL',
      externalPaging: 'NOT_CONFIGURED',
    }),
    externalActionAuthorization: 'NONE',
  });
}

function rotationAudit(
  record: Readonly<ProductIncidentRecord>,
  proof: Readonly<{
    sourceGroup: string;
    openingRoutingReceiptEventId: number;
    openingSourceEventId: number;
    recoveryRoutingReceiptEventId: number;
    recoverySourceEventId: number;
  }>,
): SystemJsonValue {
  return Object.freeze({
    schema: ROTATION_SCHEMA,
    operation: 'ROTATE_RESOLVED',
    incidentId: record.incidentId,
    expectedLedgerEventId: record.ledgerEventId,
    reasonCode: 'BOUNDED_TOP_N_RETENTION',
    retentionLimit: MAX_INCIDENTS,
    snapshot: Object.freeze({
      incidentId: record.incidentId,
      fingerprint: record.fingerprint,
      rootComponentId: record.rootComponentId,
      severity: record.severity,
      capitalRelevant: record.capitalRelevant,
      state: record.state,
      firstSeenAtMs: record.firstSeenAtMs,
      lastSeenAtMs: record.lastSeenAtMs,
      eventCount: record.eventCount,
      acknowledgedAtMs: record.acknowledgedAtMs,
      acknowledgedByOperatorId: record.acknowledgedByOperatorId,
      resolvedAtMs: record.resolvedAtMs,
      correlationId: record.correlationId,
      ledgerEventId: record.ledgerEventId,
      sourceGroup: proof.sourceGroup,
      openingRoutingReceiptEventId: proof.openingRoutingReceiptEventId,
      openingSourceEventId: proof.openingSourceEventId,
      recoveryRoutingReceiptEventId: proof.recoveryRoutingReceiptEventId,
      recoverySourceEventId: proof.recoverySourceEventId,
    }),
    externalActionAuthorization: 'NONE',
  });
}

function ignoredSourceAudit(
  disposition: 'IGNORE_NO_ACTIVE' | 'IGNORE_LATE',
  event: Readonly<AdmittedSourceEvent>,
  digest: string,
  prior: Readonly<{
    dispositionEventId: number;
    sourceEventId: number;
    observedAtMs: number;
  }> | null,
): SystemJsonValue {
  return Object.freeze({
    schema: SOURCE_DISPOSITION_SCHEMA,
    operation: disposition,
    sourceEventId: event.id,
    sourceEventKind: event.kind,
    sourceGroup: event.group,
    sourceStatus: event.status,
    sourceDetail: event.detail,
    sourceObservedAtMs: event.observedAtMs,
    rootComponentId: event.componentId,
    groupingDigest: digest,
    incidentId: null,
    priorDispositionEventId: prior?.dispositionEventId ?? null,
    priorSourceEventId: prior?.sourceEventId ?? null,
    priorObservedAtMs: prior?.observedAtMs ?? null,
    externalActionAuthorization: 'NONE',
  });
}

function mutationDisposition(
  mutation: Readonly<ProductPersistenceMutationResult>,
  committed: ProductIncidentIngestResult['disposition'],
  incidentIdentity: string,
  sourceEventId: number,
): Readonly<ProductIncidentIngestResult> {
  if (mutation.disposition === 'COMMITTED_NEW') {
    return Object.freeze({ disposition: committed, incidentId: incidentIdentity, sourceEventId });
  }
  if (mutation.disposition === 'IDEMPOTENT_REPLAY') {
    return Object.freeze({ disposition: 'IDEMPOTENT_REPLAY', incidentId: incidentIdentity, sourceEventId });
  }
  throw new Error(`Product incident route transition failed closed: ${mutation.disposition}`);
}

function recordIgnoredSourceDisposition(
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
  disposition: 'IGNORE_NO_ACTIVE' | 'IGNORE_LATE',
  event: Readonly<AdmittedSourceEvent>,
  digest: string,
  prior: Readonly<{
    dispositionEventId: number;
    sourceEventId: number;
    observedAtMs: number;
  }> | null,
): Readonly<ProductIncidentIngestResult> {
  const mutation = persistence.recordProductIncidentSourceDisposition(Object.freeze({
    kind: 'product.incident.source_ignored',
    symbol: null,
    data: ignoredSourceAudit(disposition, event, digest, prior),
  }));
  if (mutation.disposition === 'COMMITTED_NEW') {
    return Object.freeze({ disposition: 'IGNORED', incidentId: null, sourceEventId: event.id });
  }
  if (mutation.disposition === 'IDEMPOTENT_REPLAY') {
    return Object.freeze({ disposition: 'IDEMPOTENT_REPLAY', incidentId: null, sourceEventId: event.id });
  }
  throw new Error(`Product incident ignored-source persistence failed closed: ${mutation.disposition}`);
}

function isRouterIncident(record: Readonly<ProductIncidentRecord>): boolean {
  return record.fingerprint.startsWith(ROUTER_FINGERPRINT_PREFIX);
}

function exactRoutedSourceEvent(
  routed: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
): boolean {
  const data = routed.data;
  const expected = source.kind === 'connection_recovered'
    ? Object.freeze({ kind: 'product.incident.resolved', operation: 'RESOLVE' })
    : routed.kind === 'product.incident.opened'
      ? Object.freeze({ kind: 'product.incident.opened', operation: 'OPEN' })
      : Object.freeze({ kind: 'product.incident.grouped', operation: 'GROUP' });
  if (!(routed.id > source.id
    && routed.kind === expected.kind
    && routed.symbol === null
    && plainObject(data)
    && Object.keys(data).length === ROUTE_AUDIT_KEYS.length
    && ROUTE_AUDIT_KEYS.every((key) => Object.hasOwn(data, key))
    && data.schema === ROUTE_SCHEMA
    && data.operation === expected.operation
    && data.sourceEventId === source.id
    && data.sourceEventKind === source.kind
    && data.sourceGroup === source.group
    && data.sourceStatus === source.status
    && data.sourceDetail === source.detail
    && data.sourceObservedAtMs === source.observedAtMs
    && data.rootComponentId === source.componentId
    && typeof data.incidentId === 'string' && IDENTIFIER.test(data.incidentId)
    && typeof data.fingerprint === 'string' && IDENTIFIER.test(data.fingerprint)
    && typeof data.correlationId === 'string' && IDENTIFIER.test(data.correlationId)
    && SEVERITIES.includes(data.severity as (typeof SEVERITIES)[number])
    && typeof data.capitalRelevant === 'boolean'
    && ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(String(data.state))
    && utcMillis(data.firstSeenAtMs)
    && utcMillis(data.lastSeenAtMs)
    && Number(data.lastSeenAtMs) >= Number(data.firstSeenAtMs)
    && Number.isSafeInteger(data.eventCount) && Number(data.eventCount) >= 1
    && (data.acknowledgedAtMs === null || utcMillis(data.acknowledgedAtMs))
    && (data.acknowledgedByOperatorId === null
      || (typeof data.acknowledgedByOperatorId === 'string'
        && IDENTIFIER.test(data.acknowledgedByOperatorId)))
    && ((data.acknowledgedAtMs === null) === (data.acknowledgedByOperatorId === null))
    && (data.resolvedAtMs === null || utcMillis(data.resolvedAtMs))
    && data.reasonCode === 'CONNECTION_UNHEALTHY'
    && plainObject(data.routing)
    && Object.keys(data.routing).length === 2
    && data.routing.inApp === 'WIRED_LOCAL'
    && data.routing.externalPaging === 'NOT_CONFIGURED'
    && data.externalActionAuthorization === 'NONE')) return false;

  const digest = groupingDigest(source);
  const prefix = baseFingerprintPrefix(digest);
  const episodeText = typeof data.fingerprint === 'string' && data.fingerprint.startsWith(prefix)
    ? data.fingerprint.slice(prefix.length)
    : '';
  const episodeSourceEventId = /^[1-9][0-9]{0,15}$/.test(episodeText) ? Number(episodeText) : null;
  if (episodeSourceEventId === null || !Number.isSafeInteger(episodeSourceEventId)
    || data.incidentId !== `incident.product.${digest}.episode.${episodeSourceEventId}`
    || data.correlationId !== `product.incident.${digest.slice(0, 32)}.${episodeSourceEventId}`
    || data.lastSeenAtMs !== source.observedAtMs) return false;
  const acknowledgementPaired = (data.acknowledgedAtMs === null)
    === (data.acknowledgedByOperatorId === null);
  if (!acknowledgementPaired
    || (data.acknowledgedAtMs !== null
      && Number(data.acknowledgedAtMs) < Number(data.firstSeenAtMs))) return false;
  if (expected.operation === 'OPEN') {
    return episodeSourceEventId === source.id
      && data.severity === severityFor(source)
      && data.capitalRelevant === capitalRelevantFor(source.componentId)
      && data.state === 'OPEN'
      && data.firstSeenAtMs === source.observedAtMs
      && data.eventCount === 1
      && data.acknowledgedAtMs === null
      && data.acknowledgedByOperatorId === null
      && data.resolvedAtMs === null;
  }
  if (expected.operation === 'GROUP') {
    return (data.state === 'OPEN' || data.state === 'ACKNOWLEDGED')
      && Number(data.firstSeenAtMs) <= source.observedAtMs
      && Number(data.eventCount) >= 2
      && data.resolvedAtMs === null
      && SEVERITIES.indexOf(data.severity as (typeof SEVERITIES)[number])
        <= SEVERITIES.indexOf(severityFor(source))
      && (!capitalRelevantFor(source.componentId) || data.capitalRelevant === true);
  }
  return data.state === 'RESOLVED'
    && Number(data.firstSeenAtMs) <= source.observedAtMs
    && Number(data.eventCount) >= 2
    && data.resolvedAtMs === source.observedAtMs
    && (data.acknowledgedAtMs === null || Number(data.acknowledgedAtMs) <= source.observedAtMs);
}

function exactIgnoredSourceEvent(
  disposition: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
): boolean {
  const data = disposition.data;
  return disposition.id > source.id
    && disposition.kind === 'product.incident.source_ignored'
    && disposition.symbol === null
    && plainObject(data)
    && Object.keys(data).length === SOURCE_DISPOSITION_KEYS.length
    && SOURCE_DISPOSITION_KEYS.every((key) => Object.hasOwn(data, key))
    && data.schema === SOURCE_DISPOSITION_SCHEMA
    && (data.operation === 'IGNORE_NO_ACTIVE' || data.operation === 'IGNORE_LATE')
    && data.sourceEventId === source.id
    && data.sourceEventKind === source.kind
    && data.sourceGroup === source.group
    && data.sourceStatus === source.status
    && data.sourceDetail === source.detail
    && data.sourceObservedAtMs === source.observedAtMs
    && data.rootComponentId === source.componentId
    && data.groupingDigest === groupingDigest(source)
    && data.incidentId === null
    && ((data.priorDispositionEventId === null
      && data.priorSourceEventId === null
      && data.priorObservedAtMs === null)
      || (Number.isSafeInteger(data.priorDispositionEventId)
        && Number(data.priorDispositionEventId) >= 1
        && Number.isSafeInteger(data.priorSourceEventId)
        && Number(data.priorSourceEventId) >= 1
        && utcMillis(data.priorObservedAtMs)))
    && (data.operation !== 'IGNORE_NO_ACTIVE' || source.kind === 'connection_recovered')
    && (data.operation !== 'IGNORE_NO_ACTIVE'
      || data.priorObservedAtMs === null
      || Number(data.priorObservedAtMs) <= source.observedAtMs)
    && (data.operation !== 'IGNORE_LATE'
      || (data.priorSourceEventId !== null
        && Number(data.priorSourceEventId) < source.id
        && Number(data.priorObservedAtMs) > source.observedAtMs))
    && data.externalActionAuthorization === 'NONE';
}

function exactSourceDisposition(
  disposition: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
): boolean {
  return exactIgnoredSourceEvent(disposition, source)
    || exactRoutedSourceEvent(disposition, source);
}

function effectiveSourceHighWater(
  disposition: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
): number | null {
  if (!plainObject(disposition.data)) return null;
  if (disposition.data.schema === SOURCE_DISPOSITION_SCHEMA
    && disposition.data.operation === 'IGNORE_LATE') {
    return utcMillis(disposition.data.priorObservedAtMs)
      && Number(disposition.data.priorObservedAtMs) > source.observedAtMs
      ? Number(disposition.data.priorObservedAtMs)
      : null;
  }
  return source.observedAtMs;
}

function exactAcknowledgementForRoute(
  route: Readonly<LedgerEventRecord>,
  predecessor: Readonly<LedgerEventRecord>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  if (!plainObject(route.data) || !plainObject(predecessor.data)
    || typeof route.data.incidentId !== 'string') return false;
  const routeData = route.data;
  const previousData = predecessor.data;
  const incidentIdentity = routeData.incidentId as string;
  const acknowledgement = persistence.readProductIncidentAcknowledgementByIncidentId(incidentIdentity);
  if (routeData.acknowledgedAtMs === null || routeData.acknowledgedByOperatorId === null) {
    return (acknowledgement === null || acknowledgement.id > route.id)
      && previousData.acknowledgedAtMs === null
      && previousData.acknowledgedByOperatorId === null
      && previousData.state === 'OPEN'
      && routeData.state !== 'ACKNOWLEDGED';
  }
  if (acknowledgement === null || acknowledgement.id >= route.id) return false;
  const evidence = readProductIncidentAcknowledgementEvidence(acknowledgement);
  if (evidence === null
    || evidence.incidentId !== routeData.incidentId
    || evidence.incidentCorrelationId !== routeData.correlationId
    || evidence.acknowledgedAtMs !== routeData.acknowledgedAtMs
    || evidence.actor.id !== routeData.acknowledgedByOperatorId
    || evidence.after.fingerprint !== routeData.fingerprint
    || evidence.after.rootComponentId !== routeData.rootComponentId
    || evidence.after.firstSeenAtMs !== routeData.firstSeenAtMs) return false;

  if (previousData.state === 'OPEN') {
    return predecessor.id < acknowledgement.id
      && evidence.expectedLedgerEventId === predecessor.id
      && evidence.before.ledgerEventId === undefined
      && evidence.before.eventCount === previousData.eventCount
      && evidence.before.lastSeenAtMs === previousData.lastSeenAtMs
      && evidence.before.severity === previousData.severity
      && evidence.before.capitalRelevant === previousData.capitalRelevant;
  }
  return previousData.state === 'ACKNOWLEDGED'
    && acknowledgement.id <= predecessor.id
    && previousData.acknowledgedAtMs === routeData.acknowledgedAtMs
    && previousData.acknowledgedByOperatorId === routeData.acknowledgedByOperatorId;
}

function exactRoutedTransitionReadback(
  routed: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  if (!exactRoutedSourceEvent(routed, source) || !plainObject(routed.data)) return false;
  const data = routed.data;
  const predecessor = persistence.readPreviousProductIncidentRoutedDisposition(
    source.componentId,
    source.group,
    source.id,
  );
  if (data.operation === 'OPEN') {
    if (predecessor === null) return true;
    if (!plainObject(predecessor.data)
      || !Number.isSafeInteger(predecessor.data.sourceEventId)) return false;
    const priorSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
      Number(predecessor.data.sourceEventId),
    ));
    return priorSource !== null
      && priorSource.id < source.id
      && predecessor.id < routed.id
      && exactRoutedSourceEvent(predecessor, priorSource)
      && predecessor.data.operation === 'RESOLVE'
      && Number(predecessor.data.sourceObservedAtMs) <= source.observedAtMs;
  }
  if (predecessor === null || !plainObject(predecessor.data)
    || !Number.isSafeInteger(predecessor.data.sourceEventId)) return false;
  const previousData = predecessor.data;
  const priorSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(previousData.sourceEventId),
  ));
  if (priorSource === null
    || !exactRoutedSourceEvent(predecessor, priorSource)
    || priorSource.id >= source.id
    || predecessor.id >= routed.id
    || Number(previousData.sourceObservedAtMs) > source.observedAtMs
    || previousData.operation === 'RESOLVE'
    || data.incidentId !== previousData.incidentId
    || data.fingerprint !== previousData.fingerprint
    || data.rootComponentId !== previousData.rootComponentId
    || data.correlationId !== previousData.correlationId
    || data.firstSeenAtMs !== previousData.firstSeenAtMs
    || data.eventCount !== Number(previousData.eventCount) + 1
    || !exactAcknowledgementForRoute(routed, predecessor, persistence)) return false;
  if (data.operation === 'GROUP') {
    return data.severity === maximumSeverity(
      previousData.severity as ProductRuntimeIncidentProjection['severity'],
      severityFor(source),
    )
      && data.capitalRelevant === (
        Boolean(previousData.capitalRelevant) || capitalRelevantFor(source.componentId)
      )
      && data.resolvedAtMs === null;
  }
  return data.operation === 'RESOLVE'
    && data.severity === previousData.severity
    && data.capitalRelevant === previousData.capitalRelevant
    && data.resolvedAtMs === source.observedAtMs;
}

function inactivePreviousRouteProof(
  source: Readonly<AdmittedSourceEvent>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
  beforeDispositionEventId = Number.MAX_SAFE_INTEGER,
): boolean {
  const previousRoute = persistence.readPreviousProductIncidentRoutedDisposition(
    source.componentId,
    source.group,
    source.id,
  );
  if (previousRoute === null) return true;
  if (!plainObject(previousRoute.data)
    || !Number.isSafeInteger(previousRoute.data.sourceEventId)) return false;
  const routeSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(previousRoute.data.sourceEventId),
  ));
  return routeSource !== null
    && routeSource.id < source.id
    && previousRoute.id < beforeDispositionEventId
    && exactRoutedTransitionReadback(previousRoute, routeSource, persistence)
    && previousRoute.data.operation === 'RESOLVE';
}

function exactIgnoredSourcePriorProof(
  disposition: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  if (!exactIgnoredSourceEvent(disposition, source) || !plainObject(disposition.data)) return false;
  const data = disposition.data;
  const priorDisposition = persistence.readPreviousProductIncidentSourceDisposition(
    source.componentId,
    source.group,
    source.id,
  );
  if (priorDisposition === null) {
    return data.operation === 'IGNORE_NO_ACTIVE'
      && inactivePreviousRouteProof(source, persistence, disposition.id)
      && data.priorDispositionEventId === null
      && data.priorSourceEventId === null
      && data.priorObservedAtMs === null;
  }
  if (!plainObject(priorDisposition.data)
    || !Number.isSafeInteger(priorDisposition.data.sourceEventId)) return false;
  const priorSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(priorDisposition.data.sourceEventId),
  ));
  const priorHighWater = priorSource === null
    ? null
    : effectiveSourceHighWater(priorDisposition, priorSource);
  if (priorSource === null || !exactSourceDisposition(priorDisposition, priorSource)
    || priorHighWater === null
    || priorSource.id >= priorDisposition.id
    || priorDisposition.id >= disposition.id
    || source.id >= disposition.id) return false;
  return data.priorDispositionEventId === priorDisposition.id
    && data.priorSourceEventId === priorSource.id
    && data.priorObservedAtMs === priorHighWater
    && (data.operation !== 'IGNORE_NO_ACTIVE'
      || inactivePreviousRouteProof(source, persistence, disposition.id));
}

function exactSourceDispositionReadback(
  disposition: Readonly<LedgerEventRecord>,
  source: Readonly<AdmittedSourceEvent>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  return exactRoutedTransitionReadback(disposition, source, persistence)
    || exactIgnoredSourcePriorProof(disposition, source, persistence);
}

function exactRoutedIncidentCurrent(
  routed: Readonly<LedgerEventRecord>,
  record: Readonly<ProductIncidentRecord> | null,
): record is Readonly<ProductIncidentRecord> {
  if (record === null || !plainObject(routed.data)) return false;
  const data = routed.data;
  const routeState = String(data.state);
  const stateCanAdvance = routeState === record.state
    || (routeState === 'OPEN' && (record.state === 'ACKNOWLEDGED' || record.state === 'RESOLVED'))
    || (routeState === 'ACKNOWLEDGED' && record.state === 'RESOLVED');
  return data.incidentId === record.incidentId
    && data.fingerprint === record.fingerprint
    && data.rootComponentId === record.rootComponentId
    && data.correlationId === record.correlationId
    && data.firstSeenAtMs === record.firstSeenAtMs
    && Number.isSafeInteger(data.lastSeenAtMs)
    && Number(data.lastSeenAtMs) <= record.lastSeenAtMs
    && Number.isSafeInteger(data.eventCount)
    && Number(data.eventCount) <= record.eventCount
    && routed.id <= record.ledgerEventId
    && SEVERITIES.indexOf(record.severity as (typeof SEVERITIES)[number])
      <= SEVERITIES.indexOf(data.severity as (typeof SEVERITIES)[number])
    && (data.capitalRelevant !== true || record.capitalRelevant)
    && stateCanAdvance
    && (data.acknowledgedAtMs === null
      || (data.acknowledgedAtMs === record.acknowledgedAtMs
        && data.acknowledgedByOperatorId === record.acknowledgedByOperatorId))
    && (data.resolvedAtMs === null || data.resolvedAtMs === record.resolvedAtMs);
}

function exactRotationForRoutedIncident(
  routed: Readonly<LedgerEventRecord>,
  rotation: Readonly<LedgerEventRecord> | null,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  if (rotation === null || rotation.kind !== 'product.incident.rotated'
    || rotation.symbol !== null || !plainObject(rotation.data) || !plainObject(routed.data)) return false;
  const data = rotation.data;
  const snapshot = data.snapshot;
  if (Object.keys(data).length !== ROTATION_KEYS.length
    || !ROTATION_KEYS.every((key) => Object.hasOwn(data, key))
    || !plainObject(snapshot)
    || Object.keys(snapshot).length !== ROTATION_SNAPSHOT_KEYS.length
    || !ROTATION_SNAPSHOT_KEYS.every((key) => Object.hasOwn(snapshot, key))) return false;
  const route = routed.data;
  if (!(data.schema === ROTATION_SCHEMA
    && data.operation === 'ROTATE_RESOLVED'
    && data.incidentId === route.incidentId
    && data.expectedLedgerEventId === snapshot.ledgerEventId
    && data.reasonCode === 'BOUNDED_TOP_N_RETENTION'
    && data.retentionLimit === MAX_INCIDENTS
    && data.externalActionAuthorization === 'NONE'
    && rotation.id > Number(snapshot.ledgerEventId)
    && Number(snapshot.ledgerEventId) >= routed.id
    && snapshot.incidentId === route.incidentId
    && snapshot.fingerprint === route.fingerprint
    && snapshot.rootComponentId === route.rootComponentId
    && snapshot.correlationId === route.correlationId
    && snapshot.firstSeenAtMs === route.firstSeenAtMs
    && Number(snapshot.lastSeenAtMs) >= Number(route.lastSeenAtMs)
    && Number(snapshot.eventCount) >= Number(route.eventCount)
    && SEVERITIES.includes(snapshot.severity as (typeof SEVERITIES)[number])
    && SEVERITIES.indexOf(snapshot.severity as (typeof SEVERITIES)[number])
      <= SEVERITIES.indexOf(route.severity as (typeof SEVERITIES)[number])
    && (route.capitalRelevant !== true || snapshot.capitalRelevant === true)
    && snapshot.state === 'RESOLVED'
    && snapshot.resolvedAtMs === snapshot.lastSeenAtMs
    && ((snapshot.acknowledgedAtMs === null) === (snapshot.acknowledgedByOperatorId === null))
    && typeof snapshot.sourceGroup === 'string'
    && IDENTIFIER.test(snapshot.sourceGroup)
    && Number.isSafeInteger(snapshot.openingRoutingReceiptEventId)
    && Number.isSafeInteger(snapshot.openingSourceEventId)
    && Number.isSafeInteger(snapshot.recoveryRoutingReceiptEventId)
    && Number.isSafeInteger(snapshot.recoverySourceEventId)
    && snapshot.recoveryRoutingReceiptEventId === snapshot.ledgerEventId
    && Number(snapshot.openingSourceEventId) < Number(snapshot.openingRoutingReceiptEventId)
    && Number(snapshot.recoverySourceEventId) < Number(snapshot.recoveryRoutingReceiptEventId)
    && (route.acknowledgedAtMs === null
      || (snapshot.acknowledgedAtMs === route.acknowledgedAtMs
        && snapshot.acknowledgedByOperatorId === route.acknowledgedByOperatorId)))) return false;
  const opening = persistence.readProductIncidentOpeningRoutingByIncidentId(String(snapshot.incidentId));
  const openingSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(snapshot.openingSourceEventId),
  ));
  const recovery = persistence.readProductIncidentRoutingBySourceEventId(
    Number(snapshot.recoverySourceEventId),
  );
  const recoverySource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(snapshot.recoverySourceEventId),
  ));
  if (opening === null || openingSource === null || recovery === null || recoverySource === null
    || opening.id !== snapshot.openingRoutingReceiptEventId
    || recovery.id !== snapshot.recoveryRoutingReceiptEventId
    || openingSource.id !== snapshot.openingSourceEventId
    || openingSource.group !== snapshot.sourceGroup
    || !exactRoutedTransitionReadback(opening, openingSource, persistence)
    || !exactRoutedTransitionReadback(recovery, recoverySource, persistence)
    || !plainObject(recovery.data)
    || recovery.data.operation !== 'RESOLVE'
    || recovery.data.incidentId !== snapshot.incidentId
    || recovery.data.fingerprint !== snapshot.fingerprint
    || recovery.data.rootComponentId !== snapshot.rootComponentId
    || recovery.data.severity !== snapshot.severity
    || recovery.data.capitalRelevant !== snapshot.capitalRelevant
    || recovery.data.state !== snapshot.state
    || recovery.data.firstSeenAtMs !== snapshot.firstSeenAtMs
    || recovery.data.lastSeenAtMs !== snapshot.lastSeenAtMs
    || recovery.data.eventCount !== snapshot.eventCount
    || recovery.data.acknowledgedAtMs !== snapshot.acknowledgedAtMs
    || recovery.data.acknowledgedByOperatorId !== snapshot.acknowledgedByOperatorId
    || recovery.data.resolvedAtMs !== snapshot.resolvedAtMs
    || recovery.data.correlationId !== snapshot.correlationId) return false;
  if (snapshot.acknowledgedAtMs !== null) {
    const acknowledgement = persistence.readProductIncidentAcknowledgementByIncidentId(
      String(snapshot.incidentId),
    );
    const evidence = acknowledgement === null ? null : readProductIncidentAcknowledgementEvidence(acknowledgement);
    if (evidence === null
      || acknowledgement!.id >= recovery.id
      || evidence.acknowledgedAtMs !== snapshot.acknowledgedAtMs
      || evidence.actor.id !== snapshot.acknowledgedByOperatorId) return false;
  }
  return true;
}

function routerOwnerAudit(record: Readonly<ProductIncidentRecord>): boolean {
  const data = record.lastAudit.data;
  return plainObject(data) && (
    (data.schema === ROUTE_SCHEMA
      && ['product.incident.opened', 'product.incident.grouped', 'product.incident.resolved']
        .includes(record.lastAudit.kind))
    || (ACK_SCHEMAS.has(String(data.schema)) && record.lastAudit.kind === 'incident_acknowledged')
  );
}

function exactAcknowledgementOwnedCurrent(
  record: Readonly<ProductIncidentRecord>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  const acknowledgement = persistence.readProductIncidentAcknowledgementByIncidentId(record.incidentId);
  if (acknowledgement === null || acknowledgement.id !== record.ledgerEventId) return false;
  const evidence = readProductIncidentAcknowledgementEvidence(acknowledgement);
  const after = evidence?.after;
  const predecessor = evidence === null
    ? null
    : persistence.readProductIncidentRoutingByReceiptEventId(evidence.expectedLedgerEventId);
  if (evidence === null || predecessor === null || !plainObject(predecessor.data)
    || !Number.isSafeInteger(predecessor.data.sourceEventId)) return false;
  const predecessorSource = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(predecessor.data.sourceEventId),
  ));
  const before = evidence.before;
  return evidence !== null
    && after !== undefined
    && predecessorSource !== null
    && predecessor.id === evidence.expectedLedgerEventId
    && predecessor.id < acknowledgement.id
    && exactRoutedTransitionReadback(predecessor, predecessorSource, persistence)
    && predecessor.data.incidentId === record.incidentId
    && predecessor.data.state === 'OPEN'
    && predecessor.data.acknowledgedAtMs === null
    && predecessor.data.acknowledgedByOperatorId === null
    && before.incidentId === predecessor.data.incidentId
    && before.fingerprint === predecessor.data.fingerprint
    && before.rootComponentId === predecessor.data.rootComponentId
    && before.severity === predecessor.data.severity
    && before.capitalRelevant === predecessor.data.capitalRelevant
    && before.state === predecessor.data.state
    && before.firstSeenAtMs === predecessor.data.firstSeenAtMs
    && before.lastSeenAtMs === predecessor.data.lastSeenAtMs
    && before.eventCount === predecessor.data.eventCount
    && before.acknowledgedAtMs === predecessor.data.acknowledgedAtMs
    && before.acknowledgedByOperatorId === predecessor.data.acknowledgedByOperatorId
    && before.resolvedAtMs === predecessor.data.resolvedAtMs
    && before.correlationId === predecessor.data.correlationId
    && after.incidentId === record.incidentId
    && after.fingerprint === record.fingerprint
    && after.rootComponentId === record.rootComponentId
    && after.severity === record.severity
    && after.capitalRelevant === record.capitalRelevant
    && after.state === record.state
    && after.firstSeenAtMs === record.firstSeenAtMs
    && after.lastSeenAtMs === record.lastSeenAtMs
    && after.eventCount === record.eventCount
    && after.acknowledgedAtMs === record.acknowledgedAtMs
    && after.acknowledgedByOperatorId === record.acknowledgedByOperatorId
    && after.resolvedAtMs === record.resolvedAtMs
    && after.correlationId === record.correlationId
    && after.ledgerEventId === record.ledgerEventId;
}

function exactCurrentIncidentAudit(
  record: Readonly<ProductIncidentRecord>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): boolean {
  if (record.lastAudit.id !== record.ledgerEventId) return false;
  if (record.lastAudit.kind === 'incident_acknowledged') {
    return exactAcknowledgementOwnedCurrent(record, persistence);
  }
  const acknowledgement = persistence.readProductIncidentAcknowledgementByIncidentId(record.incidentId);
  if ((record.acknowledgedAtMs === null) !== (acknowledgement === null)) return false;
  if (!plainObject(record.lastAudit.data)
    || !Number.isSafeInteger(record.lastAudit.data.sourceEventId)) return false;
  const source = admittedSourceEvent(persistence.readProductIncidentSourceEvent(
    Number(record.lastAudit.data.sourceEventId),
  ));
  return source !== null
    && exactRoutedTransitionReadback(record.lastAudit, source, persistence)
    && exactRoutedIncidentCurrent(record.lastAudit, record);
}

function exactRecoverySourceEventId(
  record: Readonly<ProductIncidentRecord>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): number | null {
  const data = record.lastAudit.data;
  const sourceEventId = record.state === 'RESOLVED'
    && record.lastAudit.kind === 'product.incident.resolved'
    && plainObject(data)
    && data.schema === ROUTE_SCHEMA
    && data.operation === 'RESOLVE'
    && Number.isSafeInteger(data.sourceEventId)
    && Number(data.sourceEventId) >= 1
    ? Number(data.sourceEventId)
    : null;
  if (sourceEventId === null) return null;
  const source = admittedSourceEvent(persistence.readProductIncidentSourceEvent(sourceEventId));
  return source !== null
    && source.kind === 'connection_recovered'
    && exactRoutedTransitionReadback(record.lastAudit, source, persistence)
    && exactRoutedIncidentCurrent(record.lastAudit, record)
    ? sourceEventId
    : null;
}

function openingRoutingProof(
  record: Readonly<ProductIncidentRecord>,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): Readonly<{ receiptId: number; sourceEventId: number; sourceGroup: string }> {
  const opening = persistence.readProductIncidentOpeningRoutingByIncidentId(record.incidentId);
  if (opening === null || !plainObject(opening.data)
    || opening.kind !== 'product.incident.opened'
    || opening.data.operation !== 'OPEN'
    || !Number.isSafeInteger(opening.data.sourceEventId)) {
    throw new Error('Durable Product incident opening route is missing.');
  }
  const sourceRecord = persistence.readProductIncidentSourceEvent(Number(opening.data.sourceEventId));
  const source = admittedSourceEvent(sourceRecord);
  if (source === null
    || !exactRoutedTransitionReadback(opening, source, persistence)
    || !exactRoutedIncidentCurrent(opening, record)) {
    throw new Error('Durable Product incident opening route is invalid.');
  }
  return Object.freeze({ receiptId: opening.id, sourceEventId: source.id, sourceGroup: source.group });
}

function projection(
  record: Readonly<ProductIncidentRecord>,
  inAppRoutingReceiptId: number,
  sourceGroup: string,
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): Readonly<ProductRuntimeIncidentProjection> {
  if (!isRouterIncident(record)
    || !routerOwnerAudit(record)
    || !exactCurrentIncidentAudit(record, persistence)
    || !IDENTIFIER.test(record.incidentId)
    || !IDENTIFIER.test(record.rootComponentId)
    || !SEVERITIES.includes(record.severity as (typeof SEVERITIES)[number])
    || !['OPEN', 'ACKNOWLEDGED', 'RESOLVED'].includes(record.state)
    || !Number.isSafeInteger(record.ledgerEventId) || record.ledgerEventId < 1
    || !Number.isSafeInteger(record.eventCount) || record.eventCount < 1
    || !utcMillis(record.firstSeenAtMs) || !utcMillis(record.lastSeenAtMs)
    || (record.acknowledgedAtMs !== null && !utcMillis(record.acknowledgedAtMs))
    || (record.resolvedAtMs !== null && !utcMillis(record.resolvedAtMs))
    || (record.acknowledgedAtMs !== null && record.acknowledgedAtMs < record.firstSeenAtMs)
    || (record.resolvedAtMs !== null && record.resolvedAtMs < record.firstSeenAtMs)) {
    throw new Error('Durable Product incident projection is invalid.');
  }
  const state = record.state as ProductRuntimeIncidentProjection['state'];
  const severity = record.severity as ProductRuntimeIncidentProjection['severity'];
  const recoverySourceEventId = exactRecoverySourceEventId(record, persistence);
  if ((state === 'RESOLVED') !== (recoverySourceEventId !== null)) {
    throw new Error('Durable Product incident recovery proof is invalid.');
  }
  const operatorAction = state === 'OPEN'
    ? 'Acknowledge the incident while root-cause and recovery truth remain active.'
    : state === 'ACKNOWLEDGED'
      ? `Acknowledged by ${record.acknowledgedByOperatorId}; recovery remains unproven.`
      : 'Recovery is proven by an explicit matching source event.';
  return Object.freeze({
    incidentId: record.incidentId,
    fingerprint: record.fingerprint,
    ledgerEventId: record.ledgerEventId,
    severity,
    rootComponentId: record.rootComponentId,
    sourceGroup,
    capitalRelevant: record.capitalRelevant,
    firstSeenAtMs: record.firstSeenAtMs,
    lastSeenAtMs: record.lastSeenAtMs,
    count: record.eventCount,
    state,
    reasonCode: 'CONNECTION_UNHEALTHY',
    operatorAction,
    correlationId: record.correlationId,
    acknowledgedAtMs: record.acknowledgedAtMs,
    acknowledgedByOperatorId: record.acknowledgedByOperatorId,
    resolvedAtMs: record.resolvedAtMs,
    acknowledgementControlId: productIncidentAcknowledgementControlId(record.incidentId),
    routing: Object.freeze({
      inApp: Object.freeze({ state: 'WIRED_LOCAL', receiptId: `ledger-event:${inAppRoutingReceiptId}` }),
      externalPaging: Object.freeze({
        state: 'NOT_CONFIGURED',
        receiptId: null,
        blocker: 'EXTERNAL_PAGING_OWNER_NOT_CONFIGURED',
      }),
    }),
    recoveryProof: Object.freeze({
      state: state === 'RESOLVED' ? 'PROVEN' : 'PENDING',
      sourceEventId: recoverySourceEventId,
      resolvedAtMs: record.resolvedAtMs,
    }),
  });
}

/** Product-owned deterministic local incident grouping and recovery router. */
export class ProductIncidentRouter {
  private readonly persistence: Readonly<ProductIncidentRouterPersistencePort>;
  private bootstrapped = false;
  private bootstrapInProgress = false;
  private bootstrapPreviousSourceEventId = 0;
  private unavailableReason: string | null = null;

  constructor(persistence: Readonly<ProductIncidentRouterPersistencePort>) {
    if (!persistence
      || typeof persistence.readProductIncident !== 'function'
      || typeof persistence.readProductIncidentSourceEvent !== 'function'
      || typeof persistence.readProductIncidentRoutingBySourceEventId !== 'function'
      || typeof persistence.readProductIncidentRoutingByReceiptEventId !== 'function'
      || typeof persistence.readLatestProductIncidentSourceDisposition !== 'function'
      || typeof persistence.readPreviousProductIncidentSourceDisposition !== 'function'
      || typeof persistence.readPreviousProductIncidentRoutedDisposition !== 'function'
      || typeof persistence.readProductIncidentAcknowledgementByIncidentId !== 'function'
      || typeof persistence.readProductIncidentOpeningRoutingByIncidentId !== 'function'
      || typeof persistence.readProductIncidentRotationByIncidentId !== 'function'
      || typeof persistence.readOldestResolvedProductIncidentByFingerprintPrefix !== 'function'
      || typeof persistence.readProductIncidentsByFingerprintPrefix !== 'function'
      || typeof persistence.countProductIncidentsByFingerprintPrefix !== 'function'
      || typeof persistence.compareAndTransitionProductIncident !== 'function'
      || typeof persistence.compareAndRotateResolvedProductIncident !== 'function'
      || typeof persistence.recordProductIncidentSourceDisposition !== 'function'
      || typeof persistence.advanceProductIncidentRouterCheckpoint !== 'function') {
      throw new TypeError('ProductIncidentRouter requires the sole-Ledger incident routing port.');
    }
    this.persistence = persistence;
  }

  failClosed(reason: 'INCIDENT_ROUTER_LIVE_INGEST_FAILED'): void {
    this.unavailableReason = reason;
    this.bootstrapInProgress = false;
    this.bootstrapped = true;
  }

  beginBootstrap(): void {
    if (this.bootstrapped || this.bootstrapInProgress) {
      this.unavailableReason = 'INCIDENT_ROUTER_BOOTSTRAP_FAILED';
      this.bootstrapInProgress = false;
      this.bootstrapped = true;
      return;
    }
    this.bootstrapPreviousSourceEventId = 0;
    this.unavailableReason = null;
    this.bootstrapInProgress = true;
  }

  bootstrapPage(events: readonly Readonly<LedgerEventRecord>[]): boolean {
    if (!this.bootstrapInProgress || this.unavailableReason !== null) return false;
    if (!Array.isArray(events) || events.length > MAX_BOOTSTRAP_PAGE) {
      this.unavailableReason = 'INCIDENT_ROUTER_BOOTSTRAP_PAGE_BOUND_EXCEEDED';
      this.bootstrapInProgress = false;
      this.bootstrapped = true;
      return false;
    }
    try {
      for (const event of events) {
        const eventId = plainObject(event) && Number.isSafeInteger(event.id) ? Number(event.id) : null;
        if (eventId === null || eventId <= this.bootstrapPreviousSourceEventId) {
          throw new Error('Product incident bootstrap order is invalid.');
        }
        this.ingest(event);
        this.persistence.advanceProductIncidentRouterCheckpoint(eventId);
        this.bootstrapPreviousSourceEventId = eventId;
      }
      return true;
    } catch {
      this.unavailableReason = 'INCIDENT_ROUTER_BOOTSTRAP_FAILED';
      this.bootstrapInProgress = false;
      this.bootstrapped = true;
      return false;
    }
  }

  completeBootstrap(): void {
    if (!this.bootstrapInProgress || this.unavailableReason !== null) {
      this.unavailableReason ??= 'INCIDENT_ROUTER_BOOTSTRAP_FAILED';
    }
    this.bootstrapInProgress = false;
    this.bootstrapped = true;
  }

  bootstrap(events: readonly Readonly<LedgerEventRecord>[]): void {
    this.beginBootstrap();
    if (this.bootstrapPage(events)) this.completeBootstrap();
  }

  ingest(value: unknown): Readonly<ProductIncidentIngestResult> {
    if (this.bootstrapped && this.unavailableReason !== null) {
      throw new Error(`Product incident router is unavailable: ${this.unavailableReason}`);
    }
    const submittedEvent = admittedSourceEvent(value);
    if (submittedEvent === null) {
      if (plainObject(value) && value.kind !== 'connection_alert' && value.kind !== 'connection_recovered') {
        return Object.freeze({ disposition: 'IGNORED', incidentId: null, sourceEventId: 0 });
      }
      throw new TypeError('Product incident source event is invalid.');
    }
    const durableSourceRecord = this.persistence.readProductIncidentSourceEvent(submittedEvent.id);
    const event = admittedSourceEvent(durableSourceRecord);
    if (event === null || !exactAdmittedSourceEvent(event, submittedEvent)) {
      throw new Error('Product incident source event is not exact durable Ledger truth.');
    }
    const routed = this.persistence.readProductIncidentRoutingBySourceEventId(event.id);
    if (routed !== null) {
      if (!exactSourceDispositionReadback(routed, event, this.persistence)) {
        throw new Error('Product incident source route readback is invalid.');
      }
      if (exactIgnoredSourceEvent(routed, event)) {
        return Object.freeze({ disposition: 'IDEMPOTENT_REPLAY', incidentId: null, sourceEventId: event.id });
      }
      const routedIncidentId = plainObject(routed.data) && typeof routed.data.incidentId === 'string'
        ? routed.data.incidentId
        : null;
      const routedIncident = routedIncidentId === null ? null : this.persistence.readProductIncident(routedIncidentId);
      if (!exactRoutedIncidentCurrent(routed, routedIncident)) {
        const rotation = routedIncident === null && routedIncidentId !== null
          ? this.persistence.readProductIncidentRotationByIncidentId(routedIncidentId)
          : null;
        if (!exactRotationForRoutedIncident(routed, rotation, this.persistence)) {
          throw new Error('Product incident source route has no exact durable incident or rotation readback.');
        }
      }
      return Object.freeze({
        disposition: 'IDEMPOTENT_REPLAY',
        incidentId: routedIncidentId,
        sourceEventId: event.id,
      });
    }
    const digest = groupingDigest(event);
    const previousDisposition = this.persistence.readLatestProductIncidentSourceDisposition(
      event.componentId,
      event.group,
    );
    let previousProof: Readonly<{
      dispositionEventId: number;
      sourceEventId: number;
      observedAtMs: number;
    }> | null = null;
    if (previousDisposition !== null) {
      if (!plainObject(previousDisposition.data)
        || !Number.isSafeInteger(previousDisposition.data.sourceEventId)) {
        throw new Error('Product incident source high-water readback is invalid.');
      }
      const previousSource = admittedSourceEvent(this.persistence.readProductIncidentSourceEvent(
        Number(previousDisposition.data.sourceEventId),
      ));
      if (previousSource === null
        || !exactSourceDispositionReadback(previousDisposition, previousSource, this.persistence)
        || previousSource.id >= event.id) {
        throw new Error('Product incident source high-water proof is invalid.');
      }
      previousProof = Object.freeze({
        dispositionEventId: previousDisposition.id,
        sourceEventId: previousSource.id,
        observedAtMs: effectiveSourceHighWater(previousDisposition, previousSource) ?? -1,
      });
      if (!utcMillis(previousProof.observedAtMs)) {
        throw new Error('Product incident source high-water value is invalid.');
      }
      if (event.observedAtMs < previousProof.observedAtMs) {
        return recordIgnoredSourceDisposition(
          this.persistence,
          'IGNORE_LATE',
          event,
          digest,
          previousProof,
        );
      }
    }
    const prefix = baseFingerprintPrefix(digest);
    const recordCount = this.persistence.countProductIncidentsByFingerprintPrefix(ROUTER_FINGERPRINT_PREFIX);
    if (!Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > MAX_INCIDENTS) {
      throw new Error('Product incident router capacity is exceeded.');
    }
    const records = this.persistence.readProductIncidentsByFingerprintPrefix(
      ROUTER_FINGERPRINT_PREFIX,
      MAX_INCIDENTS,
    );
    if (records.length !== recordCount) {
      throw new Error('Product incident router namespace readback is incomplete.');
    }
    const active = records.filter((record) => record.fingerprint.startsWith(prefix) && record.state !== 'RESOLVED');
    if (active.length > 1) throw new Error('Product incident grouping has multiple active episodes.');

    if (event.kind === 'connection_recovered') {
      const current = active[0];
      if (!current) {
        if (!inactivePreviousRouteProof(event, this.persistence)) {
          throw new Error('Product incident unmatched recovery lacks inactive-route proof.');
        }
        return recordIgnoredSourceDisposition(
          this.persistence,
          'IGNORE_NO_ACTIVE',
          event,
          digest,
          previousProof,
        );
      }
      if (event.observedAtMs < current.lastSeenAtMs) {
        throw new Error('Product incident recovery chronology regressed.');
      }
      const lastSeenAtMs = event.observedAtMs;
      const audit = routingAudit('RESOLVE', event, {
        incidentId: current.incidentId,
        fingerprint: current.fingerprint,
        severity: current.severity as ProductRuntimeIncidentProjection['severity'],
        capitalRelevant: current.capitalRelevant,
        state: 'RESOLVED',
        firstSeenAtMs: current.firstSeenAtMs,
        lastSeenAtMs,
        eventCount: current.eventCount + 1,
        acknowledgedAtMs: current.acknowledgedAtMs,
        acknowledgedByOperatorId: current.acknowledgedByOperatorId,
        resolvedAtMs: lastSeenAtMs,
        correlationId: current.correlationId,
      });
      const mutation = this.persistence.compareAndTransitionProductIncident(Object.freeze({
        incidentId: current.incidentId,
        fingerprint: current.fingerprint,
        rootComponentId: current.rootComponentId,
        severity: current.severity,
        capitalRelevant: current.capitalRelevant,
        expectedLedgerEventId: current.ledgerEventId,
        state: 'RESOLVED',
        firstSeenAtMs: current.firstSeenAtMs,
        lastSeenAtMs,
        eventCount: current.eventCount + 1,
        acknowledgedAtMs: current.acknowledgedAtMs,
        acknowledgedByOperatorId: current.acknowledgedByOperatorId,
        resolvedAtMs: lastSeenAtMs,
        correlationId: current.correlationId,
        audit: Object.freeze({ kind: 'product.incident.resolved', symbol: null, data: audit }),
      }));
      return mutationDisposition(mutation, 'RESOLVED', current.incidentId, event.id);
    }

    const incomingSeverity = severityFor(event);
    const incomingCapitalRelevant = capitalRelevantFor(event.componentId);
    const current = active[0];
    if (current) {
      if (event.observedAtMs < current.lastSeenAtMs) {
        throw new Error('Product incident grouping chronology regressed.');
      }
      const nextSeverity = maximumSeverity(
        current.severity as ProductRuntimeIncidentProjection['severity'],
        incomingSeverity,
      );
      const nextCapitalRelevant = current.capitalRelevant || incomingCapitalRelevant;
      const nextLastSeenAtMs = event.observedAtMs;
      const audit = routingAudit('GROUP', event, {
        incidentId: current.incidentId,
        fingerprint: current.fingerprint,
        severity: nextSeverity,
        capitalRelevant: nextCapitalRelevant,
        state: current.state as ProductRuntimeIncidentProjection['state'],
        firstSeenAtMs: current.firstSeenAtMs,
        lastSeenAtMs: nextLastSeenAtMs,
        eventCount: current.eventCount + 1,
        acknowledgedAtMs: current.acknowledgedAtMs,
        acknowledgedByOperatorId: current.acknowledgedByOperatorId,
        resolvedAtMs: null,
        correlationId: current.correlationId,
      });
      const mutation = this.persistence.compareAndTransitionProductIncident(Object.freeze({
        incidentId: current.incidentId,
        fingerprint: current.fingerprint,
        rootComponentId: current.rootComponentId,
        severity: nextSeverity,
        capitalRelevant: nextCapitalRelevant,
        expectedLedgerEventId: current.ledgerEventId,
        state: current.state,
        firstSeenAtMs: current.firstSeenAtMs,
        lastSeenAtMs: nextLastSeenAtMs,
        eventCount: current.eventCount + 1,
        acknowledgedAtMs: current.acknowledgedAtMs,
        acknowledgedByOperatorId: current.acknowledgedByOperatorId,
        resolvedAtMs: null,
        correlationId: current.correlationId,
        audit: Object.freeze({ kind: 'product.incident.grouped', symbol: null, data: audit }),
      }));
      return mutationDisposition(mutation, 'GROUPED', current.incidentId, event.id);
    }

    const newIncidentId = incidentId(event, digest);
    if (recordCount >= MAX_INCIDENTS) {
      const oldestResolved = this.persistence.readOldestResolvedProductIncidentByFingerprintPrefix(
        ROUTER_FINGERPRINT_PREFIX,
      );
      if (oldestResolved === null) {
        throw new Error('Product incident active attention capacity is exceeded.');
      }
      const rotationOpening = openingRoutingProof(oldestResolved, this.persistence);
      const rotationRecoverySourceEventId = exactRecoverySourceEventId(oldestResolved, this.persistence);
      const verifiedRotationProjection = projection(
        oldestResolved,
        rotationOpening.receiptId,
        rotationOpening.sourceGroup,
        this.persistence,
      );
      if (rotationRecoverySourceEventId === null || verifiedRotationProjection.state !== 'RESOLVED') {
        throw new Error('Product incident top-N rotation proof is invalid.');
      }
      const rotationProof = Object.freeze({
        sourceGroup: rotationOpening.sourceGroup,
        openingRoutingReceiptEventId: rotationOpening.receiptId,
        openingSourceEventId: rotationOpening.sourceEventId,
        recoveryRoutingReceiptEventId: oldestResolved.ledgerEventId,
        recoverySourceEventId: rotationRecoverySourceEventId,
      });
      const rotation = this.persistence.compareAndRotateResolvedProductIncident(Object.freeze({
        incidentId: oldestResolved.incidentId,
        expectedLedgerEventId: oldestResolved.ledgerEventId,
        audit: Object.freeze({
          kind: 'product.incident.rotated',
          symbol: null,
          data: rotationAudit(oldestResolved, rotationProof),
        }),
      }));
      if (rotation.disposition !== 'COMMITTED_NEW'
        && rotation.disposition !== 'IDEMPOTENT_REPLAY') {
        throw new Error(`Product incident top-N rotation failed closed: ${rotation.disposition}`);
      }
      const remaining = this.persistence.countProductIncidentsByFingerprintPrefix(
        ROUTER_FINGERPRINT_PREFIX,
      );
      if (remaining !== recordCount - 1) {
        throw new Error('Product incident top-N rotation readback is invalid.');
      }
      const rotationReadback = this.persistence.readProductIncidentRotationByIncidentId(
        oldestResolved.incidentId,
      );
      if (!exactRotationForRoutedIncident(
        oldestResolved.lastAudit,
        rotationReadback,
        this.persistence,
      )) throw new Error('Product incident top-N rotation receipt is invalid.');
    }
    const fingerprint = episodeFingerprint(event, digest);
    const newCorrelationId = correlationId(event, digest);
    const audit = routingAudit('OPEN', event, {
      incidentId: newIncidentId,
      fingerprint,
      severity: incomingSeverity,
      capitalRelevant: incomingCapitalRelevant,
      state: 'OPEN',
      firstSeenAtMs: event.observedAtMs,
      lastSeenAtMs: event.observedAtMs,
      eventCount: 1,
      acknowledgedAtMs: null,
      acknowledgedByOperatorId: null,
      resolvedAtMs: null,
      correlationId: newCorrelationId,
    });
    const mutation = this.persistence.compareAndTransitionProductIncident(Object.freeze({
      incidentId: newIncidentId,
      fingerprint,
      rootComponentId: event.componentId,
      severity: incomingSeverity,
      capitalRelevant: incomingCapitalRelevant,
      expectedLedgerEventId: null,
      state: 'OPEN',
      firstSeenAtMs: event.observedAtMs,
      lastSeenAtMs: event.observedAtMs,
      eventCount: 1,
      acknowledgedAtMs: null,
      acknowledgedByOperatorId: null,
      resolvedAtMs: null,
      correlationId: newCorrelationId,
      audit: Object.freeze({ kind: 'product.incident.opened', symbol: null, data: audit }),
    }));
    return mutationDisposition(mutation, 'OPENED', newIncidentId, event.id);
  }

  readProjection(): Readonly<ProductRuntimeIncidentSnapshot> {
    if (!this.bootstrapped) {
      return Object.freeze({
        availability: Object.freeze({
          state: 'NOT_CONFIGURED',
          truthLabel: 'NOT_CONFIGURED',
          blocker: 'INCIDENT_ROUTER_BOOTSTRAP_REQUIRED',
        }),
        incidents: Object.freeze([]),
      });
    }
    if (this.unavailableReason !== null) {
      return Object.freeze({
        availability: Object.freeze({ state: 'UNAVAILABLE', truthLabel: 'UNAVAILABLE', blocker: this.unavailableReason }),
        incidents: Object.freeze([]),
      });
    }
    try {
      const recordCount = this.persistence.countProductIncidentsByFingerprintPrefix(ROUTER_FINGERPRINT_PREFIX);
      if (!Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > MAX_INCIDENTS) {
        return Object.freeze({
          availability: Object.freeze({
            state: 'UNAVAILABLE',
            truthLabel: 'UNAVAILABLE',
            blocker: 'INCIDENT_ROUTER_CAPACITY_EXCEEDED',
          }),
          incidents: Object.freeze([]),
        });
      }
      const records = this.persistence.readProductIncidentsByFingerprintPrefix(
        ROUTER_FINGERPRINT_PREFIX,
        MAX_INCIDENTS,
      );
      if (records.length !== recordCount) throw new Error('Product incident router namespace readback is incomplete.');
      const incidents = Object.freeze(
        records.map((record) => {
          const opening = openingRoutingProof(record, this.persistence);
          return projection(record, opening.receiptId, opening.sourceGroup, this.persistence);
        }),
      );
      return Object.freeze({
        availability: Object.freeze({ state: 'AVAILABLE', truthLabel: 'BUILT_AND_TESTED', blocker: null }),
        incidents,
      });
    } catch {
      return Object.freeze({
        availability: Object.freeze({
          state: 'UNAVAILABLE',
          truthLabel: 'UNAVAILABLE',
          blocker: 'INCIDENT_ROUTER_READBACK_INVALID',
        }),
        incidents: Object.freeze([]),
      });
    }
  }
}

export function createProductIncidentRouter(
  persistence: Readonly<ProductIncidentRouterPersistencePort>,
): ProductIncidentRouter {
  return new ProductIncidentRouter(persistence);
}
