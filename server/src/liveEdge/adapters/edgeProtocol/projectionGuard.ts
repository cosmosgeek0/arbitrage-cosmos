import { createHash } from 'node:crypto';

import { canonicalJson } from '../../../foundation/contracts/index.js';
import { BoundedIdentityRegistry } from '../../integration/identityRegistry.js';

import type { EdgeProtocolV1Client } from './client.js';
import type { JsonRecord, ProtocolProjectionDisposition } from './types.js';

export type CanonicalProjectionOrigin = 'CANONICAL_OPERATIONAL_PROJECTION' | 'SYNTHETIC_TEST_FIXTURE';

const SAFE_OPEN_KEYS = new Set([
  'basis',
  'borrow',
  'capitalMandateRef',
  'cohort',
  'costCalibration',
  'decisionReasonCodes',
  'directional',
  'executionPlanRef',
  'fees',
  'funding',
  'labelKind',
  'latencyCalibration',
  'modelVersion',
  'proposalRef',
  'reconciliationRef',
  'reconciliationState',
  'recovery',
  'regime',
  'residual',
  'riskVerdictRef',
  'slippage',
  'slippageCalibration',
  'sourceCompleteness',
  'strategyFamily',
]);
const PRIVATE_KEY = /account|balance|wallet|permission|credential|private|api_?key|api_?secret|signature|listenkey/i;
const PRIVATE_VALUE = /private[_-]?sentinel|api[_-]?key|api[_-]?secret|credential|wallet[_-]?id|account[_-]?id/i;
const SAFE_TEXT = /^(?:-?[0-9]{1,24}(?:\.[0-9]{1,18})?|[A-Za-z0-9_.:\-]{1,128})$/;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsPrivateProjectionData(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  if (depth > 16) return true;
  budget.nodes += 1;
  if (budget.nodes > 4_096) return true;
  if (typeof value === 'string') return PRIVATE_VALUE.test(value);
  if (value === null || typeof value !== 'object') return false;
  if (Array.isArray(value)) {
    return value.some((entry) => containsPrivateProjectionData(entry, depth + 1, budget));
  }
  if (!isRecord(value)) return true;
  return Object.keys(value).some((key) => (
    PRIVATE_KEY.test(key) || containsPrivateProjectionData(value[key], depth + 1, budget)
  ));
}

function safeOpenProjection(value: unknown, depth = 0, budget = { nodes: 0 }): boolean {
  if (depth > 8) return false;
  budget.nodes += 1;
  if (budget.nodes > 512) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value === 'string') return SAFE_TEXT.test(value) && !PRIVATE_VALUE.test(value);
  if (Array.isArray(value)) {
    return value.length <= 64 && value.every((entry) => safeOpenProjection(entry, depth + 1, budget));
  }
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  if (keys.length > 64) return false;
  return keys.every((key) => (
    SAFE_OPEN_KEYS.has(key)
    && !PRIVATE_KEY.test(key)
    && safeOpenProjection(value[key], depth + 1, budget)
  ));
}

function stringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function errorCode(error: JsonRecord): string {
  return typeof error.code === 'string' ? error.code : 'PROTOCOL_INVALID';
}

function disposition(
  kind: ProtocolProjectionDisposition['kind'],
  schema: string | null,
  identity: string | null,
  revision: number | null,
  reasonCode: string,
): Readonly<ProtocolProjectionDisposition> {
  return Object.freeze({ kind, schema, identity, revision, reasonCode });
}

/**
 * Directional outbound guard. It accepts only schema-valid outcome/feedback
 * projections supplied by a declared canonical operational owner (or an
 * explicit deterministic test fixture), and maintains bounded dedupe state.
 */
export class EdgeProtocolProjectionGuard {
  readonly #client: EdgeProtocolV1Client;
  readonly #identities: BoundedIdentityRegistry;
  readonly #retentionMs: number;

  constructor(client: EdgeProtocolV1Client, identityCapacity: number, retentionMs: number) {
    if (typeof client?.decode !== 'function') throw new TypeError('edge protocol client is required');
    if (!Number.isSafeInteger(retentionMs) || retentionMs < 1 || retentionMs > 365 * 24 * 60 * 60_000) {
      throw new TypeError('projection retentionMs is outside the L adapter safety bound');
    }
    this.#client = client;
    this.#identities = new BoundedIdentityRegistry(identityCapacity);
    this.#retentionMs = retentionMs;
  }

  observeOutbound(
    frame: string | Uint8Array,
    nowMs: number,
    origin: CanonicalProjectionOrigin,
  ): Readonly<ProtocolProjectionDisposition> {
    if (origin !== 'CANONICAL_OPERATIONAL_PROJECTION' && origin !== 'SYNTHETIC_TEST_FIXTURE') {
      throw new TypeError('projection origin is invalid');
    }
    const decoded = this.#client.decode(frame, nowMs);
    if (!decoded.ok) return disposition('INVALID', null, null, null, errorCode(decoded.error));
    const { schema, revision, value } = decoded.envelope;
    if (schema !== 'EdgeOutcomeEnvelopeV1' && schema !== 'EdgeFeedbackEnvelopeV1') {
      return disposition('INVALID', schema, null, revision, 'PROJECTION_DIRECTION_INVALID');
    }
    if (containsPrivateProjectionData(value)
      || !safeOpenProjection(value.decisionLineage ?? null)
      || !safeOpenProjection(value.pnlAttribution ?? null)
      || !safeOpenProjection(value.projection ?? null)) {
      return disposition('INVALID', schema, null, revision, 'PROJECTION_SANITIZATION_FAILED');
    }

    const isOutcome = schema === 'EdgeOutcomeEnvelopeV1';
    const identity = stringField(value, isOutcome ? 'outcomeId' : 'dedupeKey');
    const contentBinding = stringField(value, isOutcome ? 'contentHash' : 'payloadHash');
    if (identity === null || contentBinding === null) {
      return disposition('INVALID', schema, null, revision, 'PROJECTION_IDENTITY_MISSING');
    }
    const immutable = isOutcome
      ? {
          schema,
          identity,
          traceId: value.traceId,
          assessmentId: value.assessmentId,
          cohort: value.cohort,
          labelKind: value.labelKind,
        }
      : {
          schema,
          identity,
          outcomeId: value.outcomeId,
          assessmentId: value.assessmentId,
          traceId: value.traceId,
        };
    const retainUntilMs = nowMs + this.#retentionMs;
    if (!Number.isSafeInteger(retainUntilMs)) {
      return disposition('INVALID', schema, identity, revision, 'PROJECTION_RETENTION_OVERFLOW');
    }
    const observation = {
      namespace: isOutcome ? 'outcome' : 'feedback',
      id: identity,
      revision,
      // Same-revision idempotency is byte/body identity, not trust in a
      // peer-declared content binding. The client accepts canonical wire JSON
      // only, so this digest changes for every decoded body change while an
      // exact redelivery remains a no-op.
      fingerprint: decoded.envelope.fingerprintSha256,
      immutableFingerprint: sha256(canonicalJson(immutable)),
      retainUntilMs,
    };
    const preflight = this.#identities.preflight(observation, nowMs);
    if (preflight.kind === 'DUPLICATE_NOOP') {
      return disposition('DUPLICATE_NOOP', schema, identity, revision, preflight.reasonCode);
    }
    if (preflight.kind === 'IDENTITY_CONFLICT') {
      return disposition('IDENTITY_CONFLICT', schema, identity, revision, preflight.reasonCode);
    }
    if (preflight.kind === 'REVISION_STALE') {
      return disposition('REVISION_STALE', schema, identity, revision, preflight.reasonCode);
    }
    if (preflight.kind === 'CAPACITY_BLOCKED') {
      return disposition('CAPACITY_BLOCKED', schema, identity, revision, preflight.reasonCode);
    }
    this.#identities.record(observation, preflight.kind, nowMs);
    return disposition('ACCEPTED', schema, identity, revision, 'CANONICAL_PROJECTION_ACCEPTED');
  }

  identitySnapshot() {
    return this.#identities.snapshot();
  }
}
