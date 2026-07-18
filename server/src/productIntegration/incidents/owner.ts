import { createHash } from 'node:crypto';

import type {
  ProductIncidentPersistenceInput,
  ProductIncidentRecord,
  ProductPersistenceMutationResult,
  SystemJsonValue,
} from '../../systemIntegration/persistence/types.js';

const INCIDENT_ACK_SCHEMA = 'cosmos.product-incident-ack.v1' as const;
const INCIDENT_TRANSITION_EVENT_KIND = 'product.incident.transition' as const;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const MAX_UTC_MS = 4_102_444_800_000;

export interface ProductIncidentPersistencePort {
  readProductIncident(incidentId: string): Readonly<ProductIncidentRecord> | null;
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
    preservedRootComponentId: incident.rootComponentId,
    preservedSeverity: incident.severity,
    preservedCapitalRelevant: incident.capitalRelevant,
    preservedEventCount: incident.eventCount,
    externalActionAuthorization: 'NONE',
  });
}

function acknowledgementReplayMatches(
  incident: Readonly<ProductIncidentRecord>,
  request: Readonly<ProductIncidentAcknowledgementRequest>,
  correlationId: string,
): boolean {
  const data = incident.lastAudit.data;
  if (!plainObject(data) || !plainObject(data.actor)) return false;
  return incident.lastAudit.kind === INCIDENT_TRANSITION_EVENT_KIND
    && data.schema === INCIDENT_ACK_SCHEMA
    && data.operation === 'ACKNOWLEDGE'
    && data.incidentId === request.incidentId
    && data.expectedLedgerEventId === request.expectedLedgerEventId
    && data.idempotencyKey === request.idempotencyKey
    && data.acknowledgedAtMs === request.acknowledgedAtMs
    && data.reason === request.reason
    && data.commandCorrelationId === correlationId
    && data.incidentCorrelationId === incident.correlationId
    && data.preservedRootComponentId === incident.rootComponentId
    && data.preservedSeverity === incident.severity
    && data.preservedCapitalRelevant === incident.capitalRelevant
    && data.preservedEventCount === incident.eventCount
    && data.externalActionAuthorization === 'NONE'
    && exactKeys(data.actor, ['id', 'source'])
    && data.actor.id === request.actor.id
    && data.actor.source === request.actor.source;
}

function acknowledgementReadbackMatches(
  before: Readonly<ProductIncidentRecord>,
  after: Readonly<ProductIncidentRecord>,
  request: Readonly<ProductIncidentAcknowledgementRequest>,
  ledgerEventId: number,
  correlationId: string,
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
    && acknowledgementReplayMatches(after, request, correlationId);
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
    try {
      before = this.persistence.readProductIncident(request.incidentId);
    } catch {
      return failure('INCIDENT_PERSISTENCE_UNAVAILABLE', null);
    }
    if (before === null) return failure('INCIDENT_NOT_FOUND', null);
    const commandCorrelationId = acknowledgementCorrelationId(request);

    if (before.acknowledgedAtMs !== null || before.acknowledgedByOperatorId !== null) {
      if (!acknowledgementReplayMatches(before, request, commandCorrelationId)) {
        return failure('INCIDENT_ACK_IDEMPOTENCY_CONFLICT', before.ledgerEventId);
      }
      return Object.freeze({
        ok: true,
        status: 'ALREADY_ACKNOWLEDGED',
        receiptId: `ledger-event:${before.ledgerEventId}`,
        correlationId: commandCorrelationId,
        incident: before,
      });
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
        kind: INCIDENT_TRANSITION_EVENT_KIND,
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
    try {
      after = this.persistence.readProductIncident(request.incidentId);
    } catch {
      return failure('INCIDENT_ACK_READBACK_UNPROVEN', mutation.ledgerEvent.id);
    }
    if (after === null || !acknowledgementReadbackMatches(
      before,
      after,
      request,
      mutation.ledgerEvent.id,
      commandCorrelationId,
    )) return failure('INCIDENT_ACK_READBACK_UNPROVEN', mutation.ledgerEvent.id);

    return Object.freeze({
      ok: true,
      status: mutation.disposition === 'IDEMPOTENT_REPLAY' ? 'ALREADY_ACKNOWLEDGED' : 'ACKNOWLEDGED',
      receiptId: `ledger-event:${mutation.ledgerEvent.id}`,
      correlationId: commandCorrelationId,
      incident: after,
    });
  }
}

export function createProductIncidentOwner(
  persistence: Readonly<ProductIncidentPersistencePort>,
): ProductIncidentOwner {
  return new ProductIncidentOwner(persistence);
}
