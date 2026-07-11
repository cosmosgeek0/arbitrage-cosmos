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
import type { Completeness, DataAuthority, ValidationIssue } from '../contracts/index.js';
import { isCompleteness, isDataAuthority, isValidUtcMillis } from '../contracts/index.js';

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
export function validateEngineSnapshotInput(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'engine snapshot must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
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
  if (!Array.isArray(rec.decisions)) {
    issues.push({ path: 'decisions', code: 'ARRAY_REQUIRED', message: 'decisions must be an array' });
  }
  if (!Array.isArray(rec.proposals)) {
    issues.push({ path: 'proposals', code: 'ARRAY_REQUIRED', message: 'proposals must be an array' });
  }
  return issues;
}
