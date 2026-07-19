/**
 * Lane B — Canonical Basis/Volume read model: input PORTS (lane-local).
 *
 * These are NARROW port shapes that mirror what the existing engines already
 * publish (see server/src/engine/v0/types.ts `Decision`/`EngineProposal`,
 * plus engine/basis/types.ts and engine/volume/types.ts — consulted
 * READ-ONLY; nothing here imports engine code). Concrete post-audit adapters
 * translate live engine snapshots into these shapes; the read model core
 * only ever sees injected port data.
 *
 * LAWS:
 *   - The read model owns no strategy logic, timer, proposal lifecycle, or
 *     cache. It never mutates port input and never fabricates values.
 *   - Source disappearance is EXPLICIT: a caller must pass `null` for a
 *     missing source. An omitted/undefined source key is a named failure
 *     (SOURCE_PRESENCE_UNDECLARED), never silent absence.
 *   - All times are UTC ms supplied by the caller (engine event times and an
 *     injected clock). No wall clock is read anywhere in this lane.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import { isProxy } from 'node:util/types';
import type { Completeness, DataAuthority, ValidationIssue } from '../contracts/index.js';
import { isCompleteness, isDataAuthority, isValidUtcMillis } from '../contracts/index.js';

// ---------- guarded plain-data inspection ----------

export interface OwnDataRecordInspection {
  readonly values: Readonly<Record<string, unknown>>;
  readonly issues: readonly ValidationIssue[];
}

export interface OwnDataArrayInspection {
  readonly isArray: boolean;
  readonly shapeValid: boolean;
  readonly values: readonly unknown[];
  readonly invalidElementIndices: readonly number[];
  readonly declaredLength: number | null;
  readonly limitExceeded: boolean;
}

export const MAX_READ_MODEL_RECORDS_PER_KIND = 10_000 as const;
const MAX_REPORTED_SHAPE_ISSUES = 128;

/** Node's internal-slot check does not invoke Proxy traps, including revoked Proxies. */
export function isProxyValue(value: unknown): boolean {
  return ((typeof value === 'object' && value !== null) || typeof value === 'function')
    && isProxy(value);
}

/**
 * Read only named own data descriptors. Accessors, inherited fields, exotic
 * objects, and Proxies are rejected without invoking user code.
 */
export function inspectOwnDataRecord(
  input: unknown,
  keys: readonly string[],
  path = '',
): OwnDataRecordInspection {
  const values = Object.create(null) as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  const issuePath = (key = ''): string => path.length === 0 ? key : key.length === 0 ? path : `${path}.${key}`;

  const objectLike = (typeof input === 'object' && input !== null) || typeof input === 'function';
  const proxy = isProxyValue(input);
  if (!objectLike || proxy) {
    return {
      values: Object.freeze(values),
      issues: Object.freeze([{
        path,
        code: proxy ? 'PROXY_NOT_ALLOWED' : 'OBJECT_REQUIRED',
        message: proxy
          ? `${path || 'value'} must not be a Proxy`
          : `${path || 'value'} must be a plain object`,
      }]),
    };
  }

  try {
    const record = input as object;
    if (Array.isArray(record)) {
      issues.push({
        path,
        code: 'OBJECT_REQUIRED',
        message: `${path || 'value'} must be a plain object`,
      });
    }
    const prototype = Object.getPrototypeOf(record);
    if (prototype !== Object.prototype && prototype !== null) {
      issues.push({
        path,
        code: 'PLAIN_OBJECT_REQUIRED',
        message: `${path || 'value'} must have Object.prototype or null prototype`,
      });
    }
    const allowed = new Set<string>(keys);
    const ownKeys = Reflect.ownKeys(record);
    let reported = 0;
    for (const ownKey of ownKeys) {
      if (typeof ownKey !== 'string') {
        if (reported < MAX_REPORTED_SHAPE_ISSUES) {
          issues.push({
            path,
            code: 'SYMBOL_FIELD_NOT_ALLOWED',
            message: `${path || 'value'} must not contain symbol fields`,
          });
        }
        reported += 1;
      } else if (!allowed.has(ownKey)) {
        if (reported < MAX_REPORTED_SHAPE_ISSUES) {
          issues.push({
            path: issuePath(ownKey),
            code: 'UNKNOWN_FIELD',
            message: `unexpected field '${ownKey.slice(0, 200)}'`,
          });
        }
        reported += 1;
      }
    }
    if (reported > MAX_REPORTED_SHAPE_ISSUES) {
      issues.push({
        path,
        code: 'SHAPE_ISSUE_LIMIT_EXCEEDED',
        message: `${path || 'value'} contains more than ${MAX_REPORTED_SHAPE_ISSUES} unsupported fields`,
      });
    }
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(record, key);
      if (descriptor === undefined) continue;
      if (!Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        issues.push({
          path: issuePath(key),
          code: 'OWN_DATA_PROPERTY_REQUIRED',
          message: `${issuePath(key)} must be an own data property; accessors are not invoked`,
        });
        continue;
      }
      values[key] = descriptor.value;
    }
  } catch {
    issues.push({
      path,
      code: 'PROPERTY_INSPECTION_FAILED',
      message: `${path || 'value'} property descriptors could not be inspected safely`,
    });
  }
  return { values: Object.freeze(values), issues: Object.freeze(issues) };
}

/** Snapshot an Array's own index data descriptors without invoking element accessors. */
export function inspectOwnDataArray(
  input: unknown,
  maxLength: number = MAX_READ_MODEL_RECORDS_PER_KIND,
): OwnDataArrayInspection {
  if (typeof input !== 'object' || input === null || isProxyValue(input)) {
    return {
      isArray: false,
      shapeValid: false,
      values: Object.freeze([]),
      invalidElementIndices: Object.freeze([]),
      declaredLength: null,
      limitExceeded: false,
    };
  }
  try {
    if (!Array.isArray(input)) {
      return {
        isArray: false,
        shapeValid: false,
        values: Object.freeze([]),
        invalidElementIndices: Object.freeze([]),
        declaredLength: null,
        limitExceeded: false,
      };
    }
    const lengthDescriptor = Object.getOwnPropertyDescriptor(input, 'length');
    if (lengthDescriptor === undefined || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')) {
      return {
        isArray: false,
        shapeValid: false,
        values: Object.freeze([]),
        invalidElementIndices: Object.freeze([]),
        declaredLength: null,
        limitExceeded: false,
      };
    }
    const length = lengthDescriptor.value;
    if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
      return {
        isArray: false,
        shapeValid: false,
        values: Object.freeze([]),
        invalidElementIndices: Object.freeze([]),
        declaredLength: null,
        limitExceeded: false,
      };
    }
    if (length > maxLength) {
      return {
        isArray: true,
        shapeValid: Object.getPrototypeOf(input) === Array.prototype,
        values: Object.freeze([]),
        invalidElementIndices: Object.freeze([]),
        declaredLength: length,
        limitExceeded: true,
      };
    }
    const values = new Array<unknown>(length);
    const invalidElementIndices: number[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
      if (descriptor === undefined || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        values[index] = undefined;
        invalidElementIndices.push(index);
      } else {
        values[index] = descriptor.value;
      }
    }
    const shapeValid = Object.getPrototypeOf(input) === Array.prototype
      && Reflect.ownKeys(input).every((key) => key === 'length' || (
        typeof key === 'string'
          && /^(0|[1-9][0-9]*)$/.test(key)
          && Number(key) < length
      ));
    return {
      isArray: true,
      shapeValid,
      values: Object.freeze(values),
      invalidElementIndices: Object.freeze(invalidElementIndices),
      declaredLength: length,
      limitExceeded: false,
    };
  } catch {
    return {
      isArray: false,
      shapeValid: false,
      values: Object.freeze([]),
      invalidElementIndices: Object.freeze([]),
      declaredLength: null,
      limitExceeded: false,
    };
  }
}

// ---------- per-record ports ----------

/**
 * One narrow projection of a v0 `Decision`. The post-audit adapter copies
 * typed child facts into the nullable canonical slots below; it passes null
 * when the child did not supply the fact and never derives strategy values.
 * The engine assigns decisions no record ID; identity is the semantic composite
 * `correlationId|symbol|ts|kind` (never an array position).
 */
export interface DecisionInput {
  symbol: string;
  /** The engine's own decision event time (UTC ms). */
  ts: number;
  /** v0 DecisionKind label, verbatim ('ignore'|'watch'|'focus'|'proposal'|'reject'). */
  kind: string;
  /** Named reject code from the engine; null when the decision is not a reject. */
  rejectCode: string | null;
  /** Human explanation (not part of the canonical shape; see canonicalize.ts). */
  humanReason: string;
  correlationId: string;
  /** Strategy-specific direction when the engine attached one; null otherwise. */
  direction: string | null;
  /** Net edge exactly as the child attached it; null when absent. */
  netEdgePct: number | null;
  /** Confidence 0..1 exactly as the child attached it; null when absent. */
  confidence: number | null;
  /** Child borrow-state label verbatim; null when absent. */
  borrowStatus: string | null;
  /** Decisive numbers snapshotted by the engine; plain data. */
  evidence: Readonly<Record<string, unknown>> | null;
}

/**
 * One engine proposal, mirroring v0 `EngineProposal` (+ the child-declared
 * expiry from e.g. basis `invalidationSpec.expiresTs`). Extra child fields
 * an adapter wants preserved belong inside `evidence`.
 */
export interface ProposalInput {
  /** The engine's own proposal ID, verbatim. */
  id: string;
  correlationId: string;
  symbol: string;
  /** v0 ProposalDirection label, verbatim (e.g. 'long_spot_short_perp', 'long'). */
  direction: string;
  createdTs: number;
  updatedTs: number;
  /** v0 ProposalStatus label, verbatim ('open'|'updated'|'expired'|'rejected'|'approved_manual'). */
  status: string;
  /** Human explanation (not part of the canonical shape; see canonicalize.ts). */
  reason: string;
  /** Net edge pct exactly as the child computed it; null when not supplied. */
  netEdgePct: number | null;
  /** Confidence 0..1 exactly as the child computed it; null when not supplied. */
  confidence: number | null;
  /** v0 borrowStatus label verbatim ('not_needed'|'unknown'|...); null when not supplied. */
  borrowStatus: string | null;
  /** Child-declared expiry (UTC ms); null when the child declared none. */
  expiresAtMs: number | null;
  /** Rank inside this engine's OWN output ordering; null when unranked. */
  sourceLocalRank: number | null;
  /** Named rejection reasons from the child; null/empty when none. */
  rejectionReasons: readonly string[] | null;
  evidence: Readonly<Record<string, unknown>> | null;
}

// ---------- snapshot port ----------

/**
 * One captured engine snapshot. The capture site (a post-audit adapter)
 * supplies full provenance; the read model NEVER invents any of it.
 */
export interface EngineSnapshotInput {
  /** Source identity, e.g. 'engine.basis.snapshot'. */
  sourceId: string;
  /** The engine's own snapshot/tick time (UTC ms); null when it declared none. */
  snapshotTimeMs: number | null;
  /** Local receipt time from the caller's INJECTED clock at capture. */
  receivedAtMs: number;
  /** Freshness budget (ms, > 0) for this snapshot's facts. */
  maxAgeMs: number;
  /** How the snapshot was obtained; preserved, never upgraded. */
  authority: DataAuthority;
  completeness: Completeness;
  /** Child engine configuration version; null when the child supplied none. */
  configVersion: string | null;
  decisions: readonly DecisionInput[];
  proposals: readonly ProposalInput[];
}

/**
 * Full build input. `basis`/`volume` MUST each be a snapshot or an explicit
 * `null` (source disappeared). Omitting a key is a named failure.
 */
export interface ReadModelInput {
  /** Evaluation clock (UTC ms) — injected; never read from a wall clock here. */
  nowMs: number;
  /** Correlation ID linking this build to the command/tick that caused it. */
  correlationId: string;
  basis: EngineSnapshotInput | null;
  volume: EngineSnapshotInput | null;
}

// ---------- snapshot provenance validation ----------

function checkString(
  issues: ValidationIssue[],
  path: string,
  v: unknown,
  maxLen: number,
): void {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) {
    issues.push({
      path,
      code: 'NON_EMPTY_STRING_REQUIRED',
      message: `${path} must be a non-empty string (<=${maxLen} chars)`,
    });
  }
}

/**
 * Structural validation of snapshot-level provenance. Empty array = valid.
 * Never throws. Record-level validation lives in canonicalize.ts so that a
 * single malformed record rejects THAT record, not the whole snapshot.
 */
const ENGINE_SNAPSHOT_KEYS = [
  'sourceId',
  'snapshotTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'configVersion',
  'decisions',
  'proposals',
] as const;

export interface EngineSnapshotInspection {
  readonly snapshot: Readonly<Record<string, unknown>>;
  readonly decisions: readonly unknown[];
  readonly proposals: readonly unknown[];
  readonly decisionCount: number;
  readonly proposalCount: number;
  readonly issues: readonly ValidationIssue[];
}

export function inspectEngineSnapshotInput(input: unknown): EngineSnapshotInspection {
  const inspected = inspectOwnDataRecord(input, ENGINE_SNAPSHOT_KEYS, 'snapshot');
  const issues: ValidationIssue[] = [...inspected.issues];
  const rec = inspected.values;
  checkString(issues, 'sourceId', rec.sourceId, 200);
  if (rec.snapshotTimeMs !== null && !isValidUtcMillis(rec.snapshotTimeMs)) {
    issues.push({
      path: 'snapshotTimeMs',
      code: 'UTC_MILLIS_INVALID',
      message: 'snapshotTimeMs must be null or a safe-integer UTC ms in range',
    });
  }
  if (!isValidUtcMillis(rec.receivedAtMs)) {
    issues.push({
      path: 'receivedAtMs',
      code: 'UTC_MILLIS_INVALID',
      message: 'receivedAtMs must be a safe-integer UTC ms in range',
    });
  }
  if (typeof rec.maxAgeMs !== 'number' || !Number.isSafeInteger(rec.maxAgeMs) || rec.maxAgeMs <= 0) {
    issues.push({
      path: 'maxAgeMs',
      code: 'POSITIVE_INTEGER_REQUIRED',
      message: 'maxAgeMs must be a positive safe integer',
    });
  }
  if (!isDataAuthority(rec.authority)) {
    issues.push({ path: 'authority', code: 'AUTHORITY_INVALID', message: 'authority must be a DataAuthority' });
  }
  if (!isCompleteness(rec.completeness)) {
    issues.push({ path: 'completeness', code: 'COMPLETENESS_INVALID', message: 'completeness must be a Completeness state' });
  }
  if (rec.configVersion !== null && (typeof rec.configVersion !== 'string' || rec.configVersion.length === 0 || rec.configVersion.length > 200)) {
    issues.push({ path: 'configVersion', code: 'CONFIG_VERSION_INVALID', message: 'configVersion must be null or a non-empty string (<=200 chars)' });
  }
  const decisions = inspectOwnDataArray(rec.decisions);
  if (!decisions.isArray) {
    issues.push({ path: 'decisions', code: 'ARRAY_REQUIRED', message: 'decisions must be an array' });
  } else if (decisions.limitExceeded) {
    issues.push({
      path: 'decisions',
      code: 'ARRAY_LIMIT_EXCEEDED',
      message: `decisions must contain at most ${MAX_READ_MODEL_RECORDS_PER_KIND} records`,
    });
  } else if (!decisions.shapeValid) {
    issues.push({ path: 'decisions', code: 'ARRAY_SHAPE_INVALID', message: 'decisions must be a plain Array with only index data fields' });
  }
  const proposals = inspectOwnDataArray(rec.proposals);
  if (!proposals.isArray) {
    issues.push({ path: 'proposals', code: 'ARRAY_REQUIRED', message: 'proposals must be an array' });
  } else if (proposals.limitExceeded) {
    issues.push({
      path: 'proposals',
      code: 'ARRAY_LIMIT_EXCEEDED',
      message: `proposals must contain at most ${MAX_READ_MODEL_RECORDS_PER_KIND} records`,
    });
  } else if (!proposals.shapeValid) {
    issues.push({ path: 'proposals', code: 'ARRAY_SHAPE_INVALID', message: 'proposals must be a plain Array with only index data fields' });
  }
  const snapshot = Object.freeze({
    sourceId: rec.sourceId,
    snapshotTimeMs: rec.snapshotTimeMs,
    receivedAtMs: rec.receivedAtMs,
    maxAgeMs: rec.maxAgeMs,
    authority: rec.authority,
    completeness: rec.completeness,
    configVersion: rec.configVersion,
    decisions: decisions.values,
    proposals: proposals.values,
  });
  return {
    snapshot,
    decisions: decisions.values,
    proposals: proposals.values,
    decisionCount: decisions.declaredLength ?? 0,
    proposalCount: proposals.declaredLength ?? 0,
    issues: Object.freeze(issues),
  };
}

export function validateEngineSnapshotInput(input: unknown): ValidationIssue[] {
  return [...inspectEngineSnapshotInput(input).issues];
}
