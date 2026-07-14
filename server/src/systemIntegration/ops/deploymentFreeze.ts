import path from 'node:path';
import type {
  DeploymentFreezeFileRead,
  DeploymentFreezeProjection,
  DeploymentFreezeProjectionState,
  DeploymentFreezeReaderOptions,
  DeploymentFreezeReadPort,
} from './types.js';

const MARKER_MAX_BYTES = 16 * 1_024;
const DEFAULT_LEASE_MS = 10 * 60 * 1_000;
const UTC_SECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const MARKER_KEYS = Object.freeze([
  'exposure',
  'operatorAction',
  'reason',
  'releaseId',
  'ts',
] as const);
const MARKER_EXPOSURE_STATES = new Set([
  'NONE',
  'ACTIVE',
  'AMBIGUOUS',
  'RECOVERY_REQUIRED',
  'UNKNOWN',
]);

function validUtcMillis(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= 8_640_000_000_000_000;
}

function utcSeconds(value: number): string {
  return new Date(Math.floor(value / 1_000) * 1_000).toISOString().replace('.000Z', 'Z');
}

function exactUtcSeconds(value: unknown): value is string {
  if (typeof value !== 'string' || !UTC_SECONDS.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && utcSeconds(parsed) === value;
}

function exactKeys(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  return keys.length === MARKER_KEYS.length
    && keys.every((key, index) => key === MARKER_KEYS[index]);
}

function boundedText(value: unknown, maximum: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && value.trim() === value
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function validMarker(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  if (!exactKeys(marker) || !exactUtcSeconds(marker.ts)) return false;
  return boundedText(marker.releaseId, 200)
    && boundedText(marker.reason, 1_000)
    && MARKER_EXPOSURE_STATES.has(String(marker.exposure))
    && marker.operatorAction === 'required';
}

function result(
  nowMs: number,
  leaseMs: number,
  state: DeploymentFreezeProjectionState,
  reason: string | null,
): Readonly<DeploymentFreezeProjection> {
  return Object.freeze({
    source: 'CANONICAL_DEPLOYMENT_FREEZE_MARKER_READBACK',
    state,
    ambiguity: state === 'UNKNOWN_FROZEN' ? 'UNKNOWN' : 'NONE',
    reasons: Object.freeze(reason === null ? [] : [reason]),
    observedAtUtc: utcSeconds(nowMs),
    validUntilUtc: utcSeconds(nowMs + leaseMs),
    deploymentFrozen: state === 'FROZEN' ? true : state === 'NOT_FROZEN' ? false : 'UNKNOWN',
  });
}

class FileDeploymentFreezeReader implements DeploymentFreezeReadPort {
  private readonly leaseMs: number;

  constructor(private readonly options: DeploymentFreezeReaderOptions) {
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  }

  read(): Readonly<DeploymentFreezeProjection> {
    const nowMs = this.options.clock.nowMs();
    if (!validUtcMillis(nowMs) || !validUtcMillis(nowMs + this.leaseMs)) {
      throw new TypeError('deployment freeze clock returned invalid UTC milliseconds');
    }
    const markerPath = this.options.markerPath;
    if (markerPath === null || !path.isAbsolute(markerPath)) {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_NOT_CONFIGURED');
    }
    let parent: 'TRUSTED_DIRECTORY' | 'UNAVAILABLE' = 'UNAVAILABLE';
    try { parent = this.options.fileSystem.inspectParentDirectory(path.dirname(markerPath)); } catch { /* UNKNOWN_FROZEN */ }
    if (parent !== 'TRUSTED_DIRECTORY') {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_PARENT_UNAVAILABLE');
    }
    let read: DeploymentFreezeFileRead = Object.freeze({ state: 'UNAVAILABLE' });
    try { read = this.options.fileSystem.readRegularFileNoFollow(markerPath, MARKER_MAX_BYTES); } catch { /* UNKNOWN_FROZEN */ }
    if (read === null || typeof read !== 'object' || !['AVAILABLE', 'ABSENT', 'UNAVAILABLE'].includes(read.state)) {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_UNAVAILABLE');
    }
    if (read.state === 'ABSENT') return result(nowMs, this.leaseMs, 'NOT_FROZEN', null);
    if (read.state !== 'AVAILABLE') {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_UNAVAILABLE');
    }
    if (typeof read.raw !== 'string') {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_UNAVAILABLE');
    }
    if (Buffer.byteLength(read.raw, 'utf8') > MARKER_MAX_BYTES) {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_OVERSIZED');
    }
    try {
      if (!validMarker(JSON.parse(read.raw))) {
        return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_MALFORMED');
      }
    } catch {
      return result(nowMs, this.leaseMs, 'UNKNOWN_FROZEN', 'DEPLOYMENT_FREEZE_MARKER_MALFORMED');
    }
    return result(nowMs, this.leaseMs, 'FROZEN', 'DEPLOYMENT_FREEZE_MARKER_PRESENT');
  }
}

/** Pure constructor: filesystem and clock effects occur only on explicit read. */
export function createDeploymentFreezeReader(options: DeploymentFreezeReaderOptions): DeploymentFreezeReadPort {
  if (
    !options
    || typeof options.clock?.nowMs !== 'function'
    || typeof options.fileSystem?.inspectParentDirectory !== 'function'
    || typeof options.fileSystem?.readRegularFileNoFollow !== 'function'
  ) throw new TypeError('deployment freeze reader requires injected clock and filesystem ports');
  const markerPath = typeof options.markerPath === 'string'
    && options.markerPath.trim() === options.markerPath
    && options.markerPath.length > 0
    ? options.markerPath
    : null;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 5 * 60 * 1_000 || leaseMs > 60 * 60 * 1_000) {
    throw new RangeError('deployment freeze readback lease must be 5-60 minutes');
  }
  return Object.freeze(new FileDeploymentFreezeReader(Object.freeze({ ...options, markerPath, leaseMs })));
}
