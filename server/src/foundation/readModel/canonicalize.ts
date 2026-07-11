/**
 * Lane B — Canonical Basis/Volume read model: per-record canonicalization.
 *
 * Maps ONE child record (DecisionInput/ProposalInput) into the frozen
 * CanonicalDecision/CanonicalProposal shape, or into a NAMED RejectedRecord.
 * Nothing is fabricated:
 *   - facts the child did not supply stay null ('UNKNOWN' for the string-
 *     state facts direction/borrowState, per the contracts' unknown-value
 *     discipline);
 *   - malformed timestamps are rejected (MALFORMED_TIMESTAMP), never
 *     repaired or defaulted;
 *   - out-of-range numbers are rejected, never clamped;
 *   - source vocabulary (IDs, direction, lifecycle labels, reject codes,
 *     evidence) is preserved verbatim — canonicalization adds identity,
 *     never meaning.
 *
 * The child's human-readable `humanReason`/`reason` strings have NO slot in
 * the frozen CanonicalOpportunity shape and are NOT copied into evidence
 * (that would fabricate an evidence field the child did not emit). Reported
 * as a contract gap; adapters may fold them into evidence themselves.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type {
  CanonicalDecision,
  CanonicalLifecycle,
  CanonicalProposal,
  Completeness,
  DataAuthority,
  OpportunityKind,
  StrategySource,
  ValidationIssue,
} from '../contracts/index.js';
import {
  UNKNOWN,
  canonicalJson,
  createSourcedTimestamp,
  deriveCanonicalDecisionId,
  deriveCanonicalProposalId,
  deriveSourceDecisionId,
  deriveSourceProposalId,
  isValidUtcMillis,
  validateCanonicalOpportunity,
} from '../contracts/index.js';
import type { DecisionInput, ProposalInput } from './ports.js';

// ---------- named rejection ----------

/** Reject codes this lane can emit. Every rejection is one of these. */
export const READ_MODEL_REJECT_CODES = [
  'PORT_RECORD_INVALID',
  'MALFORMED_TIMESTAMP',
  'EVIDENCE_INVALID',
  'CANONICAL_VALIDATION_FAILED',
  'CANONICAL_ID_CONFLICT',
  'SNAPSHOT_PROVENANCE_INVALID',
] as const;
export type ReadModelRejectCode = (typeof READ_MODEL_REJECT_CODES)[number];

/** One rejected input record — explicit, named, and countable. */
export interface RejectedRecord {
  kind: OpportunityKind;
  source: StrategySource;
  /** Best-effort stable key of the offending input ('UNKNOWN' when unusable). */
  sourceKey: string;
  symbol: string | null;
  code: ReadModelRejectCode;
  issues: readonly ValidationIssue[];
}

export type CanonicalizeResult<T> =
  | {
      readonly ok: true;
      readonly record: T;
      /** Exact canonical JSON of every validated, semantically relevant child field. */
      readonly sourceCanonical: string;
    }
  | { readonly ok: false; readonly reject: RejectedRecord };

// ---------- lifecycle bucketing (verbatim label always preserved) ----------

/**
 * v0 DecisionKind -> canonical lifecycle bucket. Rationale: 'reject' is a
 * terminal named rejection; 'ignore' means the engine looked and finished
 * with the symbol (CLOSED); 'watch'/'focus'/'proposal' are live interest
 * (OPEN). Unlisted labels bucket to 'UNKNOWN' — never guessed.
 */
export const DECISION_KIND_LIFECYCLE: Readonly<Record<string, CanonicalLifecycle>> = Object.freeze({
  ignore: 'CLOSED',
  watch: 'OPEN',
  focus: 'OPEN',
  proposal: 'OPEN',
  reject: 'REJECTED',
});

/**
 * v0 ProposalStatus -> canonical lifecycle bucket. 'approved_manual' is a
 * finished proposal from the read model's viewpoint (CLOSED). Unlisted
 * labels bucket to 'UNKNOWN'.
 */
export const PROPOSAL_STATUS_LIFECYCLE: Readonly<Record<string, CanonicalLifecycle>> = Object.freeze({
  open: 'OPEN',
  updated: 'OPEN',
  expired: 'EXPIRED',
  rejected: 'REJECTED',
  approved_manual: 'CLOSED',
});

function bucketLifecycle(table: Readonly<Record<string, CanonicalLifecycle>>, label: string): CanonicalLifecycle {
  return Object.prototype.hasOwnProperty.call(table, label) ? table[label] : 'UNKNOWN';
}

// ---------- plain-data evidence cloning ----------

/**
 * Deep-copies child evidence as plain data so (a) the output cannot alias
 * mutable input and (b) freezing the output never touches the child's
 * objects. Rejects anything that is not honest plain data (undefined,
 * functions, symbols, bigints, non-finite numbers, class instances, cycles).
 */
function clonePlain(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null) return null;
  const t = typeof value;
  if (t === 'boolean' || t === 'string') return value;
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new RangeError(`non-finite number at ${path}`);
    return value;
  }
  if (t !== 'object') throw new RangeError(`unserializable ${t} at ${path}`);
  const obj = value as object;
  if (seen.has(obj)) throw new RangeError(`cyclic structure at ${path}`);
  if (Array.isArray(obj)) {
    seen.add(obj);
    const out: unknown[] = [];
    for (let i = 0; i < obj.length; i++) {
      if (!Object.prototype.hasOwnProperty.call(obj, i)) {
        throw new RangeError(`sparse array hole at ${path}[${i}]`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(obj, String(i));
      if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new RangeError(`non-data property at ${path}[${i}]`);
      }
      out.push(clonePlain(descriptor.value, `${path}[${i}]`, seen));
    }
    for (const key of Reflect.ownKeys(obj)) {
      if (key === 'length') continue;
      if (
        typeof key !== 'string' ||
        !/^(0|[1-9][0-9]*)$/.test(key) ||
        Number(key) >= obj.length
      ) {
        throw new RangeError(`non-index array property at ${path}`);
      }
    }
    seen.delete(obj);
    return Object.freeze(out);
  }
  const proto = Object.getPrototypeOf(obj);
  if (proto !== Object.prototype && proto !== null) {
    throw new RangeError(`non-plain object at ${path}`);
  }
  seen.add(obj);
  const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(obj)) {
    if (typeof key !== 'string') {
      throw new RangeError(`symbol key at ${path}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RangeError(`non-data property at ${path}.${key}`);
    }
    if (descriptor.value === undefined) throw new RangeError(`undefined value at ${path}.${key}`);
    out[key] = clonePlain(descriptor.value, `${path}.${key}`, seen);
  }
  seen.delete(obj);
  return Object.freeze(out);
}

type EvidenceCloneResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> | null }
  | { readonly ok: false; readonly issue: ValidationIssue };

function cloneEvidence(evidence: unknown): EvidenceCloneResult {
  if (evidence === null) return { ok: true, value: null };
  if (typeof evidence !== 'object' || Array.isArray(evidence)) {
    return {
      ok: false,
      issue: { path: 'evidence', code: 'EVIDENCE_INVALID', message: 'evidence must be null or a plain object' },
    };
  }
  try {
    return { ok: true, value: clonePlain(evidence, 'evidence', new Set()) as Readonly<Record<string, unknown>> };
  } catch (err) {
    return {
      ok: false,
      issue: { path: 'evidence', code: 'EVIDENCE_NOT_PLAIN_DATA', message: (err as Error).message },
    };
  }
}

// ---------- snapshot provenance carried per record ----------

/** Provenance every canonical record inherits from its snapshot capture. */
export interface SnapshotProvenance {
  sourceId: string;
  /** Local receipt time from the injected clock — NEVER the source event time. */
  receivedAtMs: number;
  maxAgeMs: number;
  authority: DataAuthority;
  completeness: Completeness;
  configVersion: string | null;
}

// ---------- shared validation helpers ----------

function reqString(issues: ValidationIssue[], path: string, v: unknown, maxLen: number): void {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) {
    issues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} must be a non-empty string (<=${maxLen} chars)` });
  }
}

function optString(issues: ValidationIssue[], path: string, v: unknown, maxLen: number): void {
  if (v !== null && (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen)) {
    issues.push({ path, code: 'NULL_OR_NON_EMPTY_STRING_REQUIRED', message: `${path} must be null or a non-empty string (<=${maxLen} chars)` });
  }
}

function reqUtc(tsIssues: ValidationIssue[], path: string, v: unknown): void {
  if (!isValidUtcMillis(v)) {
    tsIssues.push({ path, code: 'UTC_MILLIS_INVALID', message: `${path} must be a safe-integer UTC ms in range` });
  }
}

function optUtc(tsIssues: ValidationIssue[], path: string, v: unknown): void {
  if (v !== null && !isValidUtcMillis(v)) {
    tsIssues.push({ path, code: 'UTC_MILLIS_INVALID', message: `${path} must be null or a safe-integer UTC ms in range` });
  }
}

function keyPart(v: unknown): string {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '?';
}

function reject(
  kind: OpportunityKind,
  source: StrategySource,
  sourceKey: string,
  symbol: unknown,
  code: ReadModelRejectCode,
  issues: readonly ValidationIssue[],
): CanonicalizeResult<never> {
  return {
    ok: false,
    reject: Object.freeze({
      kind,
      source,
      sourceKey,
      symbol: typeof symbol === 'string' && symbol.length > 0 ? symbol : null,
      code,
      issues: Object.freeze([...issues]),
    }),
  };
}

// ---------- decision canonicalization ----------

/** Semantic identity of a decision (the engine assigns decisions no ID). */
export function decisionEngineKey(input: Pick<DecisionInput, 'correlationId' | 'symbol' | 'ts' | 'kind'>): string {
  return `${input.correlationId}|${input.symbol}|${input.ts}|${input.kind}`;
}

export function canonicalizeDecision(
  source: StrategySource,
  input: unknown,
  provenance: SnapshotProvenance,
): CanonicalizeResult<CanonicalDecision> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return reject('DECISION', source, 'UNKNOWN', null, 'PORT_RECORD_INVALID', [
      { path: '', code: 'OBJECT_REQUIRED', message: 'decision input must be a plain object' },
    ]);
  }
  const rec = input as unknown as Record<string, unknown>;
  const sourceKey = `${keyPart(rec.correlationId)}|${keyPart(rec.symbol)}|${keyPart(rec.ts)}|${keyPart(rec.kind)}`;

  const issues: ValidationIssue[] = [];
  const tsIssues: ValidationIssue[] = [];
  reqString(issues, 'symbol', rec.symbol, 64);
  reqString(issues, 'kind', rec.kind, 64);
  reqString(issues, 'correlationId', rec.correlationId, 128);
  optString(issues, 'rejectCode', rec.rejectCode, 64);
  optString(issues, 'direction', rec.direction, 128);
  optString(issues, 'borrowStatus', rec.borrowStatus, 64);
  if (typeof rec.humanReason !== 'string') {
    issues.push({ path: 'humanReason', code: 'STRING_REQUIRED', message: 'humanReason must be a string' });
  }
  if (rec.netEdgePct !== null && (typeof rec.netEdgePct !== 'number' || !Number.isFinite(rec.netEdgePct))) {
    issues.push({ path: 'netEdgePct', code: 'NUMBER_INVALID', message: 'netEdgePct must be null or a finite number' });
  }
  if (
    rec.confidence !== null &&
    (typeof rec.confidence !== 'number' || !Number.isFinite(rec.confidence) || rec.confidence < 0 || rec.confidence > 1)
  ) {
    issues.push({ path: 'confidence', code: 'CONFIDENCE_INVALID', message: 'confidence must be null or a number in [0,1]' });
  }
  reqUtc(tsIssues, 'ts', rec.ts);

  if (tsIssues.length > 0) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'MALFORMED_TIMESTAMP', [...tsIssues, ...issues]);
  }
  if (issues.length > 0) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', issues);
  }

  const evidence = cloneEvidence(rec.evidence);
  if (!evidence.ok) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'EVIDENCE_INVALID', [evidence.issue]);
  }

  const valid = input as DecisionInput;
  const engineKey = decisionEngineKey(valid);
  if (engineKey.length > 256) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', [
      { path: '', code: 'ENGINE_KEY_TOO_LONG', message: `decision identity composite exceeds 256 chars (${engineKey.length})` },
    ]);
  }
  const sourceRecordId = deriveSourceDecisionId({ source, engineKey });
  const canonicalId = deriveCanonicalDecisionId({ source, sourceRecordId, symbol: valid.symbol });

  const record: CanonicalDecision = {
    kind: 'DECISION',
    canonicalId,
    source,
    sourceId: engineKey,
    symbol: valid.symbol,
    direction: valid.direction ?? UNKNOWN,
    lifecycle: bucketLifecycle(DECISION_KIND_LIFECYCLE, valid.kind),
    sourceLifecycle: valid.kind,
    observedAt: createSourcedTimestamp({
      sourceTimeMs: valid.ts,
      receivedAtMs: provenance.receivedAtMs,
      maxAgeMs: provenance.maxAgeMs,
      authority: provenance.authority,
      completeness: provenance.completeness,
      sourceId: provenance.sourceId,
    }),
    expiresAtMs: null,
    sourceLocalRank: null,
    netEdgePct: valid.netEdgePct,
    confidence: valid.confidence,
    borrowState: valid.borrowStatus ?? UNKNOWN,
    evidence: evidence.value,
    rejectionReasons: Object.freeze(valid.rejectCode !== null ? [valid.rejectCode] : []),
    configVersion: provenance.configVersion,
  };

  const contractIssues = validateCanonicalOpportunity(record);
  if (contractIssues.length > 0) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'CANONICAL_VALIDATION_FAILED', contractIssues);
  }
  return {
    ok: true,
    record: Object.freeze(record),
    sourceCanonical: canonicalJson({
      symbol: valid.symbol,
      ts: valid.ts,
      kind: valid.kind,
      rejectCode: valid.rejectCode,
      humanReason: valid.humanReason,
      correlationId: valid.correlationId,
      direction: valid.direction,
      netEdgePct: valid.netEdgePct,
      confidence: valid.confidence,
      borrowStatus: valid.borrowStatus,
      evidence: evidence.value,
    }),
  };
}

// ---------- proposal canonicalization ----------

export function canonicalizeProposal(
  source: StrategySource,
  input: unknown,
  provenance: SnapshotProvenance,
): CanonicalizeResult<CanonicalProposal> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return reject('PROPOSAL', source, 'UNKNOWN', null, 'PORT_RECORD_INVALID', [
      { path: '', code: 'OBJECT_REQUIRED', message: 'proposal input must be a plain object' },
    ]);
  }
  const rec = input as unknown as Record<string, unknown>;
  const idPart = keyPart(rec.id);
  const sourceKey = idPart === '?' ? 'UNKNOWN' : idPart;

  const issues: ValidationIssue[] = [];
  const tsIssues: ValidationIssue[] = [];
  reqString(issues, 'id', rec.id, 200);
  reqString(issues, 'correlationId', rec.correlationId, 128);
  reqString(issues, 'symbol', rec.symbol, 64);
  reqString(issues, 'direction', rec.direction, 128);
  reqString(issues, 'status', rec.status, 128);
  optString(issues, 'borrowStatus', rec.borrowStatus, 64);
  if (typeof rec.reason !== 'string') {
    issues.push({ path: 'reason', code: 'STRING_REQUIRED', message: 'reason must be a string' });
  }
  if (rec.netEdgePct !== null && (typeof rec.netEdgePct !== 'number' || !Number.isFinite(rec.netEdgePct))) {
    issues.push({ path: 'netEdgePct', code: 'NUMBER_INVALID', message: 'netEdgePct must be null or a finite number' });
  }
  if (
    rec.confidence !== null &&
    (typeof rec.confidence !== 'number' || !Number.isFinite(rec.confidence) || rec.confidence < 0 || rec.confidence > 1)
  ) {
    issues.push({ path: 'confidence', code: 'CONFIDENCE_INVALID', message: 'confidence must be null or a number in [0,1]' });
  }
  if (
    rec.sourceLocalRank !== null &&
    (typeof rec.sourceLocalRank !== 'number' || !Number.isSafeInteger(rec.sourceLocalRank) || rec.sourceLocalRank < 0)
  ) {
    issues.push({ path: 'sourceLocalRank', code: 'RANK_INVALID', message: 'sourceLocalRank must be null or a non-negative integer' });
  }
  if (
    rec.rejectionReasons !== null &&
    (!Array.isArray(rec.rejectionReasons) || rec.rejectionReasons.some((r) => typeof r !== 'string' || r.length === 0))
  ) {
    issues.push({ path: 'rejectionReasons', code: 'REASONS_INVALID', message: 'rejectionReasons must be null or an array of non-empty strings' });
  }
  reqUtc(tsIssues, 'createdTs', rec.createdTs);
  reqUtc(tsIssues, 'updatedTs', rec.updatedTs);
  optUtc(tsIssues, 'expiresAtMs', rec.expiresAtMs);

  if (tsIssues.length > 0) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'MALFORMED_TIMESTAMP', [...tsIssues, ...issues]);
  }
  if (issues.length > 0) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', issues);
  }

  const evidence = cloneEvidence(rec.evidence);
  if (!evidence.ok) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'EVIDENCE_INVALID', [evidence.issue]);
  }

  const valid = input as ProposalInput;
  const sourceRecordId = deriveSourceProposalId({ source, engineKey: valid.id });
  const canonicalId = deriveCanonicalProposalId({ source, sourceRecordId, symbol: valid.symbol });

  const record: CanonicalProposal = {
    kind: 'PROPOSAL',
    canonicalId,
    source,
    sourceId: valid.id,
    symbol: valid.symbol,
    direction: valid.direction,
    lifecycle: bucketLifecycle(PROPOSAL_STATUS_LIFECYCLE, valid.status),
    sourceLifecycle: valid.status,
    observedAt: createSourcedTimestamp({
      sourceTimeMs: valid.updatedTs,
      receivedAtMs: provenance.receivedAtMs,
      maxAgeMs: provenance.maxAgeMs,
      authority: provenance.authority,
      completeness: provenance.completeness,
      sourceId: provenance.sourceId,
    }),
    expiresAtMs: valid.expiresAtMs,
    sourceLocalRank: valid.sourceLocalRank,
    netEdgePct: valid.netEdgePct,
    confidence: valid.confidence,
    borrowState: valid.borrowStatus ?? UNKNOWN,
    evidence: evidence.value,
    rejectionReasons: Object.freeze(valid.rejectionReasons !== null ? [...valid.rejectionReasons] : []),
    configVersion: provenance.configVersion,
  };

  const contractIssues = validateCanonicalOpportunity(record);
  if (contractIssues.length > 0) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'CANONICAL_VALIDATION_FAILED', contractIssues);
  }
  return {
    ok: true,
    record: Object.freeze(record),
    sourceCanonical: canonicalJson({
      id: valid.id,
      correlationId: valid.correlationId,
      symbol: valid.symbol,
      direction: valid.direction,
      createdTs: valid.createdTs,
      updatedTs: valid.updatedTs,
      status: valid.status,
      reason: valid.reason,
      netEdgePct: valid.netEdgePct,
      confidence: valid.confidence,
      borrowStatus: valid.borrowStatus,
      expiresAtMs: valid.expiresAtMs,
      sourceLocalRank: valid.sourceLocalRank,
      rejectionReasons: valid.rejectionReasons,
      evidence: evidence.value,
    }),
  };
}
