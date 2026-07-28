import { Buffer } from 'node:buffer';

import {
  MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES,
  PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA,
  PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION,
  decodePublicBasisOpportunityObservation,
  type PublicBasisOpportunityObservation,
} from './publicOpportunityObservation.js';

export const PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND =
  'basis.public_opportunity_observed.v1' as const;
export const PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_STORE_RELEASE_STATE =
  'NOT_CONFIGURED' as const;
export const MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_PAYLOAD_BYTES = 8 * 1_024;

const EVENT_METADATA = Object.freeze({
  severity: 'info',
  source: 'basis.public-opportunity-observation.v1',
  strategy: 'basis',
  status: 'OBSERVED',
  reason: 'PUBLIC_SOURCE_ONLY',
  message: 'Public basis opportunity observation recorded.',
} as const);

export interface PublicBasisOpportunityObservationLedgerEventInput {
  readonly kind: string;
  readonly symbol?: string | null;
  readonly data?: unknown;
  readonly severity?: string | null;
  readonly source?: string | null;
  readonly strategy?: string | null;
  readonly status?: string | null;
  readonly reason?: string | null;
  readonly message?: string | null;
  readonly correlation?: string | null;
  readonly createdAt?: number;
}

export interface PublicBasisOpportunityObservationLedgerEvent {
  readonly id: number;
  readonly ts: number;
  readonly kind: string;
  readonly symbol: string | null;
  readonly data: unknown;
}

/**
 * Structural seam over the existing Ledger owner. The caller supplies that
 * owner; this source-only adapter never constructs persistence.
 */
export interface PublicBasisOpportunityObservationLedgerPort {
  logEventsAtomically(
    records: readonly PublicBasisOpportunityObservationLedgerEventInput[],
  ): readonly PublicBasisOpportunityObservationLedgerEvent[];
}

export type PublicBasisOpportunityObservationAppendFailureCode =
  | 'OBSERVATION_INVALID'
  | 'EVENT_PAYLOAD_OVERBOUND'
  | 'LEDGER_APPEND_FAILED'
  | 'LEDGER_COMMIT_READBACK_INVALID';

export type PublicBasisOpportunityObservationAppendResult =
  | Readonly<{
      disposition: 'APPENDED';
      rawLedgerEventId: number;
      semanticObservationId: string;
      committedAtMs: number;
    }>
  | Readonly<{
      disposition: 'REJECTED';
      rawLedgerEventId: null;
      semanticObservationId: string | null;
      committedAtMs: null;
      reasonCode: Extract<
        PublicBasisOpportunityObservationAppendFailureCode,
        'OBSERVATION_INVALID' | 'EVENT_PAYLOAD_OVERBOUND'
      >;
    }>
  | Readonly<{
      disposition: 'PERSISTENCE_UNAVAILABLE';
      rawLedgerEventId: null;
      semanticObservationId: string;
      committedAtMs: null;
      reasonCode: 'LEDGER_APPEND_FAILED';
    }>
  | Readonly<{
      disposition: 'COMMIT_READBACK_INVALID';
      rawLedgerEventId: null;
      semanticObservationId: string;
      committedAtMs: null;
      reasonCode: 'LEDGER_COMMIT_READBACK_INVALID';
    }>;

function rejected(
  reasonCode: 'OBSERVATION_INVALID' | 'EVENT_PAYLOAD_OVERBOUND',
  semanticObservationId: string | null,
): PublicBasisOpportunityObservationAppendResult {
  return Object.freeze({
    disposition: 'REJECTED',
    rawLedgerEventId: null,
    semanticObservationId,
    committedAtMs: null,
    reasonCode,
  });
}

function persistenceUnavailable(
  semanticObservationId: string,
): PublicBasisOpportunityObservationAppendResult {
  return Object.freeze({
    disposition: 'PERSISTENCE_UNAVAILABLE',
    rawLedgerEventId: null,
    semanticObservationId,
    committedAtMs: null,
    reasonCode: 'LEDGER_APPEND_FAILED',
  });
}

function invalidReadback(
  semanticObservationId: string,
): PublicBasisOpportunityObservationAppendResult {
  return Object.freeze({
    disposition: 'COMMIT_READBACK_INVALID',
    rawLedgerEventId: null,
    semanticObservationId,
    committedAtMs: null,
    reasonCode: 'LEDGER_COMMIT_READBACK_INVALID',
  });
}

function decodeObservation(value: unknown): Readonly<PublicBasisOpportunityObservation> | null {
  try {
    return decodePublicBasisOpportunityObservation(value);
  } catch {
    return null;
  }
}

function validCommittedIdentity(
  event: Readonly<PublicBasisOpportunityObservationLedgerEvent>,
  observation: Readonly<PublicBasisOpportunityObservation>,
): boolean {
  if (!Number.isSafeInteger(event.id) || event.id < 1
      || !Number.isSafeInteger(event.ts) || event.ts < 0
      || event.ts < observation.evaluatedAtMs
      || event.kind !== PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND
      || event.symbol !== observation.symbol) {
    return false;
  }
  const decoded = decodeObservation(event.data);
  return decoded !== null
    && decoded.schema === PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_SCHEMA
    && decoded.version === PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_VERSION
    && decoded.observationId === observation.observationId
    && decoded.contentDigestSha256 === observation.contentDigestSha256;
}

/**
 * Appends every valid supplied observation. Semantic retry identity is carried
 * in the payload; this writer deliberately performs no dedupe or throttling.
 *
 * The one-record atomic API returns only after commit and suppresses
 * post-commit listener failures, so listener delivery cannot turn a committed
 * observation into a retryable append failure.
 */
export function appendPublicOpportunityObservation(
  ledger: PublicBasisOpportunityObservationLedgerPort,
  observation: Readonly<PublicBasisOpportunityObservation>,
): PublicBasisOpportunityObservationAppendResult;
export function appendPublicOpportunityObservation(
  ledger: PublicBasisOpportunityObservationLedgerPort,
  observation: unknown,
): PublicBasisOpportunityObservationAppendResult;
export function appendPublicOpportunityObservation(
  ledger: PublicBasisOpportunityObservationLedgerPort,
  observation: unknown,
): PublicBasisOpportunityObservationAppendResult {
  const decoded = decodeObservation(observation);
  if (decoded === null) return rejected('OBSERVATION_INVALID', null);

  let serialized: string;
  try {
    const encoded = JSON.stringify(decoded);
    if (typeof encoded !== 'string') {
      return rejected('OBSERVATION_INVALID', decoded.observationId);
    }
    serialized = encoded;
  } catch {
    return rejected('OBSERVATION_INVALID', decoded.observationId);
  }
  const maximumPayloadBytes = Math.min(
    MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_PAYLOAD_BYTES,
    MAX_PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_PAYLOAD_BYTES,
  );
  if (Buffer.byteLength(serialized, 'utf8') > maximumPayloadBytes) {
    return rejected('EVENT_PAYLOAD_OVERBOUND', decoded.observationId);
  }

  let committed: readonly PublicBasisOpportunityObservationLedgerEvent[];
  try {
    committed = ledger.logEventsAtomically(Object.freeze([Object.freeze({
      kind: PUBLIC_BASIS_OPPORTUNITY_OBSERVATION_EVENT_KIND,
      symbol: decoded.symbol,
      data: decoded,
      ...EVENT_METADATA,
      correlation: decoded.correlationId,
      createdAt: decoded.observedAtMs,
    })]));
  } catch {
    return persistenceUnavailable(decoded.observationId);
  }

  let readback: Readonly<Pick<
    PublicBasisOpportunityObservationLedgerEvent,
    'id' | 'ts'
  >> | null = null;
  try {
    if (Array.isArray(committed)
        && committed.length === 1
        && committed[0] !== null
        && typeof committed[0] === 'object') {
      const snapshot = Object.freeze({
        id: committed[0].id,
        ts: committed[0].ts,
        kind: committed[0].kind,
        symbol: committed[0].symbol,
        data: committed[0].data,
      });
      if (validCommittedIdentity(snapshot, decoded)) {
        readback = Object.freeze({ id: snapshot.id, ts: snapshot.ts });
      }
    }
  } catch {
    readback = null;
  }
  if (readback === null) {
    return invalidReadback(decoded.observationId);
  }

  return Object.freeze({
    disposition: 'APPENDED',
    rawLedgerEventId: readback.id,
    semanticObservationId: decoded.observationId,
    committedAtMs: readback.ts,
  });
}
