import { createHash } from 'node:crypto';
import path from 'node:path';
import type {
  CanonicalSupervisorOpsReadback,
  DeploymentFreezeClearAuditRecord,
  DeploymentFreezeClearOwnerOptions,
  DeploymentFreezeClearOwnerPort,
  DeploymentFreezeClearRequest,
  DeploymentFreezeClearResult,
} from './types.js';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MAX_UTC_MS = 4_102_444_800_000;
const SENSITIVE = /(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_ -]?secret|password|authorization|bearer|access[_ -]?token|signature)\s*[:=]?\s*[A-Za-z0-9+/_=-]{12,})/i;

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${canonical(row[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(canonical(value), 'utf8').digest('hex')}`;
}

function utc(value: unknown): number | null {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isSafeInteger(parsed)
    && parsed >= 0
    && parsed <= MAX_UTC_MS
    && new Date(parsed).toISOString().replace('.000Z', 'Z') === value
    ? parsed
    : null;
}

function validRequest(value: Readonly<DeploymentFreezeClearRequest>): boolean {
  return value !== null
    && typeof value === 'object'
    && IDEMPOTENCY_KEY.test(value.idempotencyKey)
    && utc(value.expectedObservedAtUtc) !== null
    && typeof value.reason === 'string'
    && value.reason === value.reason.trim()
    && value.reason.length >= 1
    && value.reason.length <= 240
    && !/[\u0000-\u001f\u007f]/.test(value.reason)
    && !SENSITIVE.test(value.reason)
    && Number.isSafeInteger(value.requestedAtMs)
    && value.requestedAtMs >= 0
    && value.requestedAtMs <= MAX_UTC_MS
    && typeof value.actor?.id === 'string'
    && value.actor.id === value.actor.id.trim()
    && value.actor.id.length >= 1
    && value.actor.id.length <= 160
    && (value.actor.email === null || (typeof value.actor.email === 'string' && value.actor.email.length <= 320))
    && (value.actor.source === 'loopback' || value.actor.source === 'cloudflare-access');
}

function healthy(
  readback: Readonly<CanonicalSupervisorOpsReadback>,
  request: Readonly<DeploymentFreezeClearRequest>,
): string | null {
  if (readback?.source !== 'CANONICAL_SUPERVISOR_READBACK') return 'CANONICAL_RECOVERY_READBACK_INVALID';
  const observedAtMs = utc(readback.observedAtUtc);
  const validUntilMs = utc(readback.validUntilUtc);
  if (observedAtMs === null || validUntilMs === null || validUntilMs <= observedAtMs) {
    return 'CANONICAL_RECOVERY_READBACK_INVALID';
  }
  if (readback.observedAtUtc !== request.expectedObservedAtUtc) return 'CANONICAL_RECOVERY_REVISION_CONFLICT';
  if (observedAtMs > request.requestedAtMs || validUntilMs <= request.requestedAtMs) {
    return 'CANONICAL_RECOVERY_READBACK_STALE';
  }
  if (readback.deploymentFrozen !== true
    || readback.exposureState !== 'NONE'
    || readback.ambiguityState !== 'NONE'
    || readback.recoveryState !== 'NONE'
    || !Number.isSafeInteger(readback.currentSchemaVersion)
    || !Number.isSafeInteger(readback.rollbackFloor)
    || (readback.currentSchemaVersion as number) < (readback.rollbackFloor as number)) {
    return 'CANONICAL_RECOVERY_NOT_HEALTHY';
  }
  return null;
}

function failed(code: string): DeploymentFreezeClearResult {
  return Object.freeze({ ok: false as const, code });
}

class DeploymentFreezeClearOwner implements DeploymentFreezeClearOwnerPort {
  constructor(private readonly options: Readonly<DeploymentFreezeClearOwnerOptions>) {}

  async canClear(expectedObservedAtUtc: string, requestedAtMs: number): Promise<Readonly<{ ok: boolean; code: string }>> {
    const freeze = this.options.readFreeze();
    if (freeze.state === 'UNKNOWN_FROZEN') return Object.freeze({ ok: false, code: 'DEPLOYMENT_FREEZE_READBACK_UNKNOWN' });
    if (freeze.state !== 'FROZEN' || freeze.deploymentFrozen !== true || freeze.ambiguity !== 'NONE') {
      return Object.freeze({ ok: false, code: 'DEPLOYMENT_FREEZE_NOT_PRESENT' });
    }
    let ops: Readonly<CanonicalSupervisorOpsReadback>;
    try { ops = await this.options.readCanonicalOps(); } catch {
      return Object.freeze({ ok: false, code: 'CANONICAL_RECOVERY_READBACK_UNAVAILABLE' });
    }
    const probe = Object.freeze({
      idempotencyKey: 'freeze.clear.probe',
      expectedObservedAtUtc,
      reason: 'Bounded deployment freeze clear applicability probe.',
      requestedAtMs,
      actor: Object.freeze({ id: 'system-integration', email: null, source: 'loopback' as const }),
    });
    const failure = healthy(ops, probe);
    return Object.freeze({ ok: failure === null, code: failure ?? 'FREEZE_CLEAR_ACCEPTED' });
  }

  readEffect(): 'APPLIED' | 'NOT_APPLIED' | 'UNKNOWN' {
    try {
      const projection = this.options.readFreeze();
      return projection.state === 'NOT_FROZEN'
        ? 'APPLIED'
        : projection.state === 'FROZEN' ? 'NOT_APPLIED' : 'UNKNOWN';
    } catch {
      return 'UNKNOWN';
    }
  }

  async clear(request: Readonly<DeploymentFreezeClearRequest>): Promise<DeploymentFreezeClearResult> {
    if (!validRequest(request)) return failed('INVALID_FREEZE_CLEAR_REQUEST');
    const requestDigest = digest({
      idempotencyKey: request.idempotencyKey,
      expectedObservedAtUtc: request.expectedObservedAtUtc,
      reason: request.reason,
      requestedAtMs: request.requestedAtMs,
      actor: request.actor,
    });
    let existing;
    try { existing = await this.options.persistence.read(request.idempotencyKey); } catch {
      return failed('FREEZE_CLEAR_PERSISTENCE_UNAVAILABLE');
    }
    if (existing !== null) {
      if (existing.requestDigest !== requestDigest) return failed('IDEMPOTENCY_CONFLICT');
      const replay = this.options.readFreeze();
      return replay.state === 'NOT_FROZEN'
        ? Object.freeze({ ok: true as const, status: 'CLEARED' as const, receiptId: existing.receiptId, observedAtUtc: replay.observedAtUtc })
        : failed('FREEZE_CLEAR_READBACK_UNCONFIRMED');
    }

    const applicability = await this.canClear(request.expectedObservedAtUtc, request.requestedAtMs);
    if (!applicability.ok) return failed(applicability.code);

    const record: Readonly<DeploymentFreezeClearAuditRecord> = Object.freeze({
      schema: 'cosmos.deployment-freeze-clear.v1' as const,
      idempotencyKey: request.idempotencyKey,
      expectedObservedAtUtc: request.expectedObservedAtUtc,
      reason: request.reason,
      requestedAtMs: request.requestedAtMs,
      actor: Object.freeze({ ...request.actor }),
      requestDigest,
      result: 'CLEAR_AUTHORIZED' as const,
    });
    let appended;
    try { appended = await this.options.persistence.append(record); } catch {
      return failed('FREEZE_CLEAR_PERSISTENCE_UNAVAILABLE');
    }
    if (appended.kind === 'CONFLICT') return failed('IDEMPOTENCY_CONFLICT');
    if (appended.record.requestDigest !== requestDigest) return failed('FREEZE_CLEAR_PERSISTENCE_INVALID');
    if (appended.kind === 'APPENDED') {
      try { this.options.fileSystem.removeRegularFileNoFollow(this.options.markerPath as string); } catch {
        return failed('FREEZE_CLEAR_REMOVE_FAILED');
      }
    }
    const after = this.options.readFreeze();
    if (after.state !== 'NOT_FROZEN' || after.deploymentFrozen !== false || after.ambiguity !== 'NONE') {
      return failed('FREEZE_CLEAR_READBACK_UNCONFIRMED');
    }
    return Object.freeze({
      ok: true as const,
      status: 'CLEARED' as const,
      receiptId: appended.record.receiptId,
      observedAtUtc: after.observedAtUtc,
    });
  }
}

export function createDeploymentFreezeClearOwner(
  options: Readonly<DeploymentFreezeClearOwnerOptions>,
): DeploymentFreezeClearOwnerPort {
  if (!options || typeof options.clock?.nowMs !== 'function'
    || typeof options.readCanonicalOps !== 'function'
    || typeof options.readFreeze !== 'function'
    || typeof options.persistence?.read !== 'function'
    || typeof options.persistence?.append !== 'function'
    || typeof options.fileSystem?.removeRegularFileNoFollow !== 'function'
    || typeof options.markerPath !== 'string'
    || !path.isAbsolute(options.markerPath)
    || path.basename(options.markerPath) !== 'deploy-frozen.json') {
    throw new TypeError('deployment freeze clear owner requires exact canonical ports and marker path');
  }
  return Object.freeze(new DeploymentFreezeClearOwner(Object.freeze({ ...options })));
}
