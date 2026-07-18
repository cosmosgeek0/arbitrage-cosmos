import { createHash } from 'node:crypto';

import type {
  LedgerEventRecord,
  ProductIncidentPersistenceInput,
  ProductIncidentRecord,
  ProductPersistenceMutationResult,
  SystemJsonValue,
} from '../../systemIntegration/persistence/types.js';
import { PRODUCT_INCIDENT_ACK_EVENT_KIND } from '../../systemIntegration/persistence/types.js';

const INCIDENT_ACK_SCHEMA = 'cosmos.product-incident-ack.v1' as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_UTC_MS = 4_102_444_800_000;
const INCIDENT_SEVERITIES = Object.freeze(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const);
const INCIDENT_STATES = Object.freeze(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'] as const);

export interface ProductIncidentPersistencePort {
  readProductIncident(incidentId: string): Readonly<ProductIncidentRecord> | null;
  readProductIncidentAcknowledgement(
    incidentId: string,
    idempotencyKey: string,
  ): Readonly<LedgerEventRecord> | null;
  compareAndTransitionProductIncident(
    input: Readonly<ProductIncidentPersistenceInput>,
  ): Readonly<ProductPersistenceMutationResult>;
}

export interface ProductIncidentAcknowledgementRequest {
  readonly incidentId: string;
  readonly expectedLedgerEventId: number;
  readonly idempotencyKey: string;
  readonly actor: Readonly<{
    readonly id: string;
    readonly source: 'loopback' | 'cloudflare-access';
  }>;
  readonly acknowledgedAtMs: number;
  readonly reason: string;
}

export type ProductIncidentAcknowledgementFailureCode =
  | 'ACK_REQUEST_INVALID'
  | 'INCIDENT_NOT_FOUND'
  | 'INCIDENT_REVISION_CONFLICT'
  | 'INCIDENT_ALREADY_RESOLVED'
  | 'INCIDENT_ACK_IDEMPOTENCY_CONFLICT'
  | 'INCIDENT_PERSISTENCE_UNAVAILABLE'
  | 'INCIDENT_ACK_READBACK_UNPROVEN';

export type ProductIncidentAcknowledgementResult =
  | Readonly<{
      readonly ok: true;
      readonly status: 'ACKNOWLEDGED' | 'ALREADY_ACKNOWLEDGED';
      readonly receiptId: string;
      readonly correlationId: string;
      readonly incident: Readonly<ProductIncidentRecord>;
    }>
  | Readonly<{
      readonly ok: false;
      readonly code: ProductIncidentAcknowledgementFailureCode;
      readonly currentLedgerEventId: number | null;
    }>;

function plainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const canonical = [...expected].sort();
  return actual.length === canonical.length
    && actual.every((key, index) => key === canonical[index]);
}

function utcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= MAX_UTC_MS;
}

function validRequest(value: unknown): value is Readonly<ProductIncidentAcknowledgementRequest> {
  if (!plainObject(value) || !exactKeys(value, [
    'incidentId', 'expectedLedgerEventId', 'idempotencyKey', 'actor',
    'acknowledgedAtMs', 'reason',
  ])) return false;
  if (!plainObject(value.actor) || !exactKeys(value.actor, ['id', 'source'])) return false;
  return typeof value.incidentId === 'string' && IDENTIFIER.test(value.incidentId)
    && Number.isSafeInteger(value.expectedLedgerEventId) && Number(value.expectedLedgerEventId) >= 1
    && typeof value.idempotencyKey === 'string' && IDEMPOTENCY_KEY.test(value.idempotencyKey)
    && typeof value.actor.id === 'string' && IDENTIFIER.test(value.actor.id)
    && (value.actor.source === 'loopback' || value.actor.source === 'cloudflare-access')
    && utcMillis(value.acknowledgedAtMs)
    && typeof value.reason === 'string'
    && value.reason === value.reason.trim()
    && value.reason.length >= 1
    && value.reason.length <= 500;
}

function acknowledgementCorrelationId(request: Readonly<ProductIncidentAcknowledgementRequest>): string {
  const digest = createHash('sha256').update(JSON.stringify({
    schema: INCIDENT_ACK_SCHEMA,
    incidentId: request.incidentId,
    expectedLedgerEventId: request.expectedLedgerEventId,
    idempotencyKey: request.idempotencyKey,
  }), 'utf8').digest('hex');
  return `product.incident.ack.${digest.slice(0, 48)}`;
}

function auditSnapshot(
  incident: Readonly<ProductIncidentRecord>,
  state: string,
  acknowledgedAtMs: number | null,
  acknowledgedByOperatorId: string | null,
): SystemJsonValue {
  return Object.freeze({
    incidentId: incident.incidentId,
    fingerprint: incident.fingerprint,
    rootComponentId: incident.rootComponentId,
    severity: incident.severity,
    capitalRelevant: incident.capitalRelevant,
    state,
    firstSeenAtMs: incident.firstSeenAtMs,
    lastSeenAtMs: incident.lastSeenAtMs,
    eventCount: incident.eventCount,
    acknowledgedAtMs,
    acknowledgedByOperatorId,
    resolvedAtMs: incident.resolvedAtMs,
    correlationId: incident.correlationId,
  });
}

function auditData(
  request: Readonly<ProductIncidentAcknowledgementRequest>,
  incident: Readonly<ProductIncidentRecord>,
  commandCorrelationId: string,
): SystemJsonValue {
  return Object.freeze({
    schema: INCIDENT_ACK_SCHEMA,
    operation: 'ACKNOWLEDGE',
    incidentId: incident.incidentId,
    expectedLedgerEventId: request.expectedLedgerEventId,
    idempotencyKey: request.idempotencyKey,
    actor: Object.freeze({ id: request.actor.id, source: request.actor.source }),
    acknowledgedAtMs: request.acknowledgedAtMs,
    reason: request.reason,
    commandCorrelationId,
    incidentCorrelationId: incident.correlationId,
    before: auditSnapshot(
      incident,
      incident.state,
      incident.acknowledgedAtMs,
      incident.acknowledgedByOperatorId,
    ),
    after: auditSnapshot(
      incident,
      'ACKNOWLEDGED',
      request.acknowledgedAtMs,
      request.actor.id,
    ),
    externalActionAuthorization: 'NONE',
  });
}

const INCIDENT_SNAPSHOT_KEYS = Object.freeze([
  'incidentId', 'fingerprint', 'rootComponentId', 'severity', 'capitalRelevant',
  'state', 'firstSeenAtMs', 'lastSeenAtMs', 'eventCount', 'acknowledgedAtMs',
  'acknowledgedByOperatorId', 'resolvedAtMs', 'correlationId',
] as const);

function validAuditSnapshot(value: unknown): value is Record<string, unknown> {
  if (!plainObject(value) || !exactKeys(value, INCIDENT_SNAPSHOT_KEYS)) return false;
  const acknowledgementAbsent = value.acknowledgedAtMs === null
    && value.acknowledgedByOperatorId === null;
  const acknowledgementPresent = utcMillis(value.acknowledgedAtMs)
    && typeof value.acknowledgedByOperatorId === 'string'
    && IDENTIFIER.test(value.acknowledgedByOperatorId);
  const validLifecycle = value.state === 'OPEN'
    ? acknowledgementAbsent && value.resolvedAtMs === null
    : value.state === 'ACKNOWLEDGED'
      ? acknowledgementPresent && value.resolvedAtMs === null
      : value.state === 'RESOLVED'
        && (acknowledgementAbsent || acknowledgementPresent)
        && utcMillis(value.resolvedAtMs)
        && value.resolvedAtMs === value.lastSeenAtMs
        && (value.acknowledgedAtMs === null
          || Number(value.acknowledgedAtMs) <= Number(value.resolvedAtMs));
  return typeof value.incidentId === 'string' && IDENTIFIER.test(value.incidentId)
    && typeof value.fingerprint === 'string' && IDENTIFIER.test(value.fingerprint)
    && typeof value.rootComponentId === 'string' && IDENTIFIER.test(value.rootComponentId)
    && typeof value.severity === 'string'
    && INCIDENT_SEVERITIES.includes(value.severity as (typeof INCIDENT_SEVERITIES)[number])
    && typeof value.capitalRelevant === 'boolean'
    && typeof value.state === 'string'
    && INCIDENT_STATES.includes(value.state as (typeof INCIDENT_STATES)[number])
    && utcMillis(value.firstSeenAtMs)
    && utcMillis(value.lastSeenAtMs)
    && Number(value.lastSeenAtMs) >= Number(value.firstSeenAtMs)
    && Number.isSafeInteger(value.eventCount) && Number(value.eventCount) >= 1
    && (value.acknowledgedAtMs === null || utcMillis(value.acknowledgedAtMs))
    && (value.acknowledgedByOperatorId === null
      || (typeof value.acknowledgedByOperatorId === 'string' && IDENTIFIER.test(value.acknowledgedByOperatorId)))
    && ((value.acknowledgedAtMs === null) === (value.acknowledgedByOperatorId === null))
    && (value.resolvedAtMs === null || utcMillis(value.resolvedAtMs))
    && (value.acknowledgedAtMs === null || value.acknowledgedAtMs >= value.firstSeenAtMs)
    && (value.resolvedAtMs === null || value.resolvedAtMs >= value.firstSeenAtMs)
    && typeof value.correlationId === 'string' && IDENTIFIER.test(value.correlationId)
    && validLifecycle;
}

function sameUnacknowledgedTruth(before: Record<string, unknown>, after: Record<string, unknown>): boolean {
  return INCIDENT_SNAPSHOT_KEYS.every((key) => (
    key === 'state' || key === 'acknowledgedAtMs' || key === 'acknowledgedByOperatorId'
      ? true
      : before[key] === after[key]
  ));
}

function acknowledgementFromEvent(
  event: Readonly<LedgerEventRecord>,
  request: Readonly<ProductIncidentAcknowledgementRequest>,
  correlationId: string,
): Readonly<ProductIncidentRecord> | null {
  const data = event.data;
  if (!Number.isSafeInteger(event.id) || event.id < 1 || !utcMillis(event.ts)
    || event.kind !== PRODUCT_INCIDENT_ACK_EVENT_KIND || event.symbol !== null
    || !plainObject(data) || !exactKeys(data, [
      'schema', 'operation', 'incidentId', 'expectedLedgerEventId',
      'idempotencyKey', 'actor', 'acknowledgedAtMs', 'reason',
      'commandCorrelationId', 'incidentCorrelationId', 'before', 'after',
      'externalActionAuthorization',
    ]) || !plainObject(data.actor)
    || !validAuditSnapshot(data.before) || !validAuditSnapshot(data.after)) return null;
  const before = data.before;
  const after = data.after;
  const valid = data.schema === INCIDENT_ACK_SCHEMA
    && data.operation === 'ACKNOWLEDGE'
    && data.incidentId === request.incidentId
    && data.expectedLedgerEventId === request.expectedLedgerEventId
    && data.idempotencyKey === request.idempotencyKey
    && data.acknowledgedAtMs === request.acknowledgedAtMs
    && data.reason === request.reason
    && data.commandCorrelationId === correlationId
    && data.incidentCorrelationId === after.correlationId
    && data.externalActionAuthorization === 'NONE'
    && exactKeys(data.actor, ['id', 'source'])
    && data.actor.id === request.actor.id
    && data.actor.source === request.actor.source
    && before.incidentId === request.incidentId
    && before.state !== 'ACKNOWLEDGED'
    && before.acknowledgedAtMs === null
    && before.acknowledgedByOperatorId === null
    && after.incidentId === request.incidentId
    && after.state === 'ACKNOWLEDGED'
    && after.acknowledgedAtMs === request.acknowledgedAtMs
    && after.acknowledgedByOperatorId === request.actor.id
    && sameUnacknowledgedTruth(before, after);
  if (!valid) return null;
  return Object.freeze({
    incidentId: after.incidentId as string,
    fingerprint: after.fingerprint as string,
    rootComponentId: after.rootComponentId as string,
    severity: after.severity as string,
    capitalRelevant: after.capitalRelevant as boolean,
    state: after.state as string,
    firstSeenAtMs: after.firstSeenAtMs as number,
    lastSeenAtMs: after.lastSeenAtMs as number,
    eventCount: after.eventCount as number,
    acknowledgedAtMs: after.acknowledgedAtMs as number,
    acknowledgedByOperatorId: after.acknowledgedByOperatorId as string,
    resolvedAtMs: after.resolvedAtMs as number | null,
    correlationId: after.correlationId as string,
    ledgerEventId: event.id,
    lastAudit: Object.freeze({
      id: event.id,
      ts: event.ts,
      kind: event.kind,
      symbol: event.symbol,
      data: data as SystemJsonValue,
    }),
  });
}

function acknowledgementReadbackMatches(
  before: Readonly<ProductIncidentRecord>,
  after: Readonly<ProductIncidentRecord>,
  request: Readonly<ProductIncidentAcknowledgementRequest>,
  ledgerEventId: number,
  correlationId: string,
  acknowledgement: Readonly<ProductIncidentRecord>,
): boolean {
  return after.incidentId === before.incidentId
    && after.fingerprint === before.fingerprint
    && after.rootComponentId === before.rootComponentId
    && after.severity === before.severity
    && after.capitalRelevant === before.capitalRelevant
    && after.firstSeenAtMs === before.firstSeenAtMs
    && after.lastSeenAtMs === before.lastSeenAtMs
    && after.eventCount === before.eventCount
    && after.resolvedAtMs === before.resolvedAtMs
    && after.correlationId === before.correlationId
    && after.state === 'ACKNOWLEDGED'
    && after.acknowledgedAtMs === request.acknowledgedAtMs
    && after.acknowledgedByOperatorId === request.actor.id
    && after.ledgerEventId === ledgerEventId
    && acknowledgement.ledgerEventId === ledgerEventId
    && acknowledgement.correlationId === after.correlationId
    && acknowledgement.state === after.state
    && acknowledgement.acknowledgedAtMs === after.acknowledgedAtMs
    && acknowledgement.acknowledgedByOperatorId === after.acknowledgedByOperatorId
    && acknowledgementFromEvent(acknowledgement.lastAudit, request, correlationId) !== null;
}

function failure(
  code: ProductIncidentAcknowledgementFailureCode,
  currentLedgerEventId: number | null,
): Readonly<Extract<ProductIncidentAcknowledgementResult, { readonly ok: false }>> {
  return Object.freeze({ ok: false, code, currentLedgerEventId });
}

/**
 * Canonical Product incident owner. It owns acknowledgement semantics only;
 * the existing Ledger remains the sole durable store and revision authority.
 */
export class ProductIncidentOwner {
  private readonly persistence: Readonly<ProductIncidentPersistencePort>;

  constructor(persistence: Readonly<ProductIncidentPersistencePort>) {
    if (!persistence || typeof persistence.readProductIncident !== 'function'
      || typeof persistence.readProductIncidentAcknowledgement !== 'function'
      || typeof persistence.compareAndTransitionProductIncident !== 'function') {
      throw new TypeError('ProductIncidentOwner requires the sole-Ledger incident port.');
    }
    this.persistence = persistence;
  }

  acknowledge(value: unknown): Readonly<ProductIncidentAcknowledgementResult> {
    let request: Readonly<ProductIncidentAcknowledgementRequest>;
    try {
      if (!validRequest(value)) return failure('ACK_REQUEST_INVALID', null);
      request = value;
    } catch {
      return failure('ACK_REQUEST_INVALID', null);
    }

    let before: Readonly<ProductIncidentRecord> | null;
    let historicalAcknowledgement: Readonly<LedgerEventRecord> | null;
    try {
      before = this.persistence.readProductIncident(request.incidentId);
      historicalAcknowledgement = this.persistence.readProductIncidentAcknowledgement(
        request.incidentId,
        request.idempotencyKey,
      );
    } catch {
      return failure('INCIDENT_PERSISTENCE_UNAVAILABLE', null);
    }
    if (before === null) return failure('INCIDENT_NOT_FOUND', null);
    const commandCorrelationId = acknowledgementCorrelationId(request);

    if (historicalAcknowledgement !== null) {
      const historicalIncident = acknowledgementFromEvent(
        historicalAcknowledgement,
        request,
        commandCorrelationId,
      );
      if (historicalIncident === null
        || before.acknowledgedAtMs !== historicalIncident.acknowledgedAtMs
        || before.acknowledgedByOperatorId !== historicalIncident.acknowledgedByOperatorId) {
        return failure('INCIDENT_ACK_READBACK_UNPROVEN', before.ledgerEventId);
      }
      return Object.freeze({
        ok: true,
        status: 'ALREADY_ACKNOWLEDGED',
        receiptId: `ledger-event:${historicalIncident.ledgerEventId}`,
        correlationId: commandCorrelationId,
        incident: historicalIncident,
      });
    }

    if (before.acknowledgedAtMs !== null || before.acknowledgedByOperatorId !== null) {
      return failure('INCIDENT_ACK_IDEMPOTENCY_CONFLICT', before.ledgerEventId);
    }
    if (before.resolvedAtMs !== null || before.state === 'RESOLVED') {
      return failure('INCIDENT_ALREADY_RESOLVED', before.ledgerEventId);
    }
    if (before.ledgerEventId !== request.expectedLedgerEventId) {
      return failure('INCIDENT_REVISION_CONFLICT', before.ledgerEventId);
    }
    if (request.acknowledgedAtMs < before.firstSeenAtMs) {
      return failure('ACK_REQUEST_INVALID', before.ledgerEventId);
    }

    const persistenceInput: ProductIncidentPersistenceInput = Object.freeze({
      incidentId: before.incidentId,
      fingerprint: before.fingerprint,
      rootComponentId: before.rootComponentId,
      severity: before.severity,
      capitalRelevant: before.capitalRelevant,
      expectedLedgerEventId: request.expectedLedgerEventId,
      state: 'ACKNOWLEDGED',
      firstSeenAtMs: before.firstSeenAtMs,
      lastSeenAtMs: before.lastSeenAtMs,
      eventCount: before.eventCount,
      acknowledgedAtMs: request.acknowledgedAtMs,
      acknowledgedByOperatorId: request.actor.id,
      resolvedAtMs: before.resolvedAtMs,
      correlationId: before.correlationId,
      audit: Object.freeze({
        kind: PRODUCT_INCIDENT_ACK_EVENT_KIND,
        symbol: null,
        data: auditData(request, before, commandCorrelationId),
      }),
    });

    let mutation: Readonly<ProductPersistenceMutationResult>;
    try {
      mutation = this.persistence.compareAndTransitionProductIncident(persistenceInput);
    } catch {
      return failure('INCIDENT_PERSISTENCE_UNAVAILABLE', before.ledgerEventId);
    }
    if (mutation.disposition === 'VERSION_CONFLICT') {
      const current = mutation.currentRevision === null ? null : Number(mutation.currentRevision);
      return failure('INCIDENT_REVISION_CONFLICT', Number.isSafeInteger(current) ? current : null);
    }
    if (mutation.disposition !== 'COMMITTED_NEW' && mutation.disposition !== 'IDEMPOTENT_REPLAY') {
      return failure('INCIDENT_ACK_IDEMPOTENCY_CONFLICT', before.ledgerEventId);
    }

    let after: Readonly<ProductIncidentRecord> | null;
    let acknowledgementEvent: Readonly<LedgerEventRecord> | null;
    try {
      after = this.persistence.readProductIncident(request.incidentId);
      acknowledgementEvent = this.persistence.readProductIncidentAcknowledgement(
        request.incidentId,
        request.idempotencyKey,
      );
    } catch {
      return failure('INCIDENT_ACK_READBACK_UNPROVEN', mutation.ledgerEvent.id);
    }
    const acknowledgement = acknowledgementEvent === null
      ? null
      : acknowledgementFromEvent(acknowledgementEvent, request, commandCorrelationId);
    if (after === null || acknowledgement === null || !acknowledgementReadbackMatches(
      before,
      after,
      request,
      mutation.ledgerEvent.id,
      commandCorrelationId,
      acknowledgement,
    )) return failure('INCIDENT_ACK_READBACK_UNPROVEN', mutation.ledgerEvent.id);

    return Object.freeze({
      ok: true,
      status: mutation.disposition === 'IDEMPOTENT_REPLAY' ? 'ALREADY_ACKNOWLEDGED' : 'ACKNOWLEDGED',
      receiptId: `ledger-event:${mutation.ledgerEvent.id}`,
      correlationId: commandCorrelationId,
      incident: acknowledgement,
    });
  }
}

export function createProductIncidentOwner(
  persistence: Readonly<ProductIncidentPersistencePort>,
): ProductIncidentOwner {
  return new ProductIncidentOwner(persistence);
}
