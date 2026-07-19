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
  isCompleteness,
  isDataAuthority,
  isValidUtcMillis,
  validateCanonicalOpportunity,
} from '../contracts/index.js';
import type { DecisionInput, ProposalInput } from './ports.js';
import { inspectOwnDataArray, inspectOwnDataRecord, isProxyValue } from './ports.js';

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

export const MAX_READ_MODEL_EVIDENCE_DEPTH = 32 as const;
export const MAX_READ_MODEL_EVIDENCE_NODES = 20_000 as const;
export const MAX_READ_MODEL_EVIDENCE_ARRAY_LENGTH = 10_000 as const;
export const MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS = 1_000 as const;
export const MAX_READ_MODEL_EVIDENCE_KEY_LENGTH = 1_024 as const;
export const MAX_READ_MODEL_EVIDENCE_STRING_LENGTH = 262_144 as const;
export const MAX_READ_MODEL_EVIDENCE_BYTES = 512 * 1_024;
export const MAX_READ_MODEL_HUMAN_REASON_LENGTH = 10_000 as const;
export const MAX_READ_MODEL_REJECTION_REASONS = 1_000 as const;
export const MAX_READ_MODEL_REJECTION_REASON_LENGTH = 1_000 as const;

interface EvidenceCloneBudget {
  nodes: number;
  bytes: number;
}

function jsonStringByteLength(value: string): number {
  let bytes = 2; // JSON quotes
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0x22 || code === 0x5c || code === 0x08 || code === 0x09
      || code === 0x0a || code === 0x0c || code === 0x0d) {
      bytes += 2;
    } else if (code <= 0x1f) {
      bytes += 6;
    } else if (code <= 0x7f) {
      bytes += 1;
    } else if (code <= 0x7ff) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 6;
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function chargeEvidenceBytes(budget: EvidenceCloneBudget, bytes: number, path: string): void {
  budget.bytes += bytes;
  if (budget.bytes > MAX_READ_MODEL_EVIDENCE_BYTES) {
    throw new RangeError(`evidence exceeds ${MAX_READ_MODEL_EVIDENCE_BYTES} canonical bytes at ${path}`);
  }
}

/**
 * Deep-copies child evidence as plain data so (a) the output cannot alias
 * mutable input and (b) freezing the output never touches the child's
 * objects. Rejects anything that is not honest plain data (undefined,
 * functions, symbols, bigints, non-finite numbers, class instances, cycles).
 */
function clonePlain(
  value: unknown,
  path: string,
  seen: Set<object>,
  budget: EvidenceCloneBudget,
  depth: number,
): unknown {
  if (depth > MAX_READ_MODEL_EVIDENCE_DEPTH) {
    throw new RangeError(`evidence exceeds depth ${MAX_READ_MODEL_EVIDENCE_DEPTH} at ${path}`);
  }
  budget.nodes += 1;
  chargeEvidenceBytes(budget, 1, path);
  if (budget.nodes > MAX_READ_MODEL_EVIDENCE_NODES) {
    throw new RangeError(`evidence exceeds ${MAX_READ_MODEL_EVIDENCE_NODES} nodes`);
  }
  if (value === null) {
    chargeEvidenceBytes(budget, 4, path);
    return null;
  }
  const t = typeof value;
  if (t === 'boolean') {
    chargeEvidenceBytes(budget, value ? 4 : 5, path);
    return value;
  }
  if (t === 'string') {
    if ((value as string).length > MAX_READ_MODEL_EVIDENCE_STRING_LENGTH) {
      throw new RangeError(`string exceeds ${MAX_READ_MODEL_EVIDENCE_STRING_LENGTH} UTF-16 code units at ${path}`);
    }
    chargeEvidenceBytes(budget, jsonStringByteLength(value as string), path);
    return value;
  }
  if (t === 'number') {
    if (!Number.isFinite(value as number)) throw new RangeError(`non-finite number at ${path}`);
    chargeEvidenceBytes(budget, String(value).length, path);
    return value;
  }
  if (t !== 'object') throw new RangeError(`unserializable ${t} at ${path}`);
  const obj = value as object;
  if (isProxyValue(obj)) throw new RangeError(`Proxy is not plain data at ${path}`);
  if (seen.has(obj)) throw new RangeError(`cyclic structure at ${path}`);
  if (Array.isArray(obj)) {
    if (Object.getPrototypeOf(obj) !== Array.prototype) {
      throw new RangeError(`non-plain array at ${path}`);
    }
    if (obj.length > MAX_READ_MODEL_EVIDENCE_ARRAY_LENGTH) {
      throw new RangeError(`array exceeds ${MAX_READ_MODEL_EVIDENCE_ARRAY_LENGTH} elements at ${path}`);
    }
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
      out.push(clonePlain(descriptor.value, `${path}[${i}]`, seen, budget, depth + 1));
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
  const ownKeys = Reflect.ownKeys(obj);
  if (ownKeys.length > MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS) {
    throw new RangeError(`object exceeds ${MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS} keys at ${path}`);
  }
  for (const key of ownKeys) {
    if (typeof key !== 'string') {
      throw new RangeError(`symbol key at ${path}`);
    }
    if (key.length > MAX_READ_MODEL_EVIDENCE_KEY_LENGTH) {
      throw new RangeError(`key exceeds ${MAX_READ_MODEL_EVIDENCE_KEY_LENGTH} UTF-16 code units at ${path}`);
    }
    chargeEvidenceBytes(budget, jsonStringByteLength(key) + 1, path);
    const descriptor = Object.getOwnPropertyDescriptor(obj, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new RangeError(`non-data property at ${path}.${key}`);
    }
    if (descriptor.value === undefined) throw new RangeError(`undefined value at ${path}.${key}`);
    out[key] = clonePlain(descriptor.value, `${path}.${key}`, seen, budget, depth + 1);
  }
  seen.delete(obj);
  return Object.freeze(out);
}

type EvidenceCloneResult =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> | null }
  | { readonly ok: false; readonly issue: ValidationIssue };

function cloneEvidence(evidence: unknown): EvidenceCloneResult {
  if (evidence === null) return { ok: true, value: null };
  if (typeof evidence !== 'object' || isProxyValue(evidence)) {
    return {
      ok: false,
      issue: { path: 'evidence', code: 'EVIDENCE_INVALID', message: 'evidence must be null or a plain object' },
    };
  }
  try {
    if (Array.isArray(evidence)) {
      return {
        ok: false,
        issue: { path: 'evidence', code: 'EVIDENCE_INVALID', message: 'evidence must be null or a plain object' },
      };
    }
    const cloned = clonePlain(
      evidence,
      'evidence',
      new Set(),
      { nodes: 0, bytes: 0 },
      0,
    ) as Readonly<Record<string, unknown>>;
    const exactBytes = utf8ByteLength(canonicalJson(cloned));
    if (exactBytes > MAX_READ_MODEL_EVIDENCE_BYTES) {
      throw new RangeError(`evidence exceeds ${MAX_READ_MODEL_EVIDENCE_BYTES} canonical bytes`);
    }
    return { ok: true, value: cloned };
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

const SNAPSHOT_PROVENANCE_KEYS = [
  'sourceId',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'configVersion',
] as const;

type SnapshotProvenanceInspection =
  | { readonly ok: true; readonly value: SnapshotProvenance }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function inspectSnapshotProvenance(input: unknown): SnapshotProvenanceInspection {
  const inspected = inspectOwnDataRecord(input, SNAPSHOT_PROVENANCE_KEYS, 'provenance');
  const rec = inspected.values;
  const issues: ValidationIssue[] = [...inspected.issues];
  if (typeof rec.sourceId !== 'string' || rec.sourceId.trim().length === 0 || rec.sourceId.length > 200) {
    issues.push({ path: 'provenance.sourceId', code: 'NON_EMPTY_STRING_REQUIRED', message: 'sourceId must be a non-empty string (<=200 chars)' });
  }
  if (!isValidUtcMillis(rec.receivedAtMs)) {
    issues.push({ path: 'provenance.receivedAtMs', code: 'UTC_MILLIS_INVALID', message: 'receivedAtMs must be valid UTC ms' });
  }
  if (typeof rec.maxAgeMs !== 'number' || !Number.isSafeInteger(rec.maxAgeMs) || rec.maxAgeMs <= 0) {
    issues.push({ path: 'provenance.maxAgeMs', code: 'POSITIVE_INTEGER_REQUIRED', message: 'maxAgeMs must be a positive safe integer' });
  }
  if (!isDataAuthority(rec.authority)) {
    issues.push({ path: 'provenance.authority', code: 'AUTHORITY_INVALID', message: 'authority must be a DataAuthority' });
  }
  if (!isCompleteness(rec.completeness)) {
    issues.push({ path: 'provenance.completeness', code: 'COMPLETENESS_INVALID', message: 'completeness must be a Completeness state' });
  }
  if (rec.configVersion !== null && (
    typeof rec.configVersion !== 'string'
      || rec.configVersion.length === 0
      || rec.configVersion.length > 200
  )) {
    issues.push({ path: 'provenance.configVersion', code: 'CONFIG_VERSION_INVALID', message: 'configVersion must be null or a non-empty string (<=200 chars)' });
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return { ok: true, value: rec as unknown as SnapshotProvenance };
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

const DECISION_INPUT_KEYS = [
  'symbol',
  'ts',
  'kind',
  'rejectCode',
  'humanReason',
  'correlationId',
  'direction',
  'netEdgePct',
  'confidence',
  'borrowStatus',
  'evidence',
] as const;

/** Semantic identity of a decision (the engine assigns decisions no ID). */
export function decisionEngineKey(input: Pick<DecisionInput, 'correlationId' | 'symbol' | 'ts' | 'kind'>): string {
  const inspected = inspectOwnDataRecord(input, DECISION_INPUT_KEYS, 'decisionIdentity');
  const rec = inspected.values;
  if (inspected.issues.length > 0
    || typeof rec.correlationId !== 'string'
    || typeof rec.symbol !== 'string'
    || !isValidUtcMillis(rec.ts)
    || typeof rec.kind !== 'string') {
    throw new TypeError('decisionEngineKey: identity must contain guarded own data fields');
  }
  return `${rec.correlationId}|${rec.symbol}|${rec.ts}|${rec.kind}`;
}

export function canonicalizeDecision(
  source: StrategySource,
  input: unknown,
  provenance: SnapshotProvenance,
): CanonicalizeResult<CanonicalDecision> {
  const inspected = inspectOwnDataRecord(input, DECISION_INPUT_KEYS, 'decision');
  const rec = inspected.values;
  const sourceKey = `${keyPart(rec.correlationId)}|${keyPart(rec.symbol)}|${keyPart(rec.ts)}|${keyPart(rec.kind)}`;
  if (inspected.issues.length > 0) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', inspected.issues);
  }
  const provenanceInspection = inspectSnapshotProvenance(provenance);
  if (!provenanceInspection.ok) {
    return reject('DECISION', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', provenanceInspection.issues);
  }
  const validProvenance = provenanceInspection.value;

  const issues: ValidationIssue[] = [];
  const tsIssues: ValidationIssue[] = [];
  reqString(issues, 'symbol', rec.symbol, 64);
  reqString(issues, 'kind', rec.kind, 64);
  reqString(issues, 'correlationId', rec.correlationId, 128);
  optString(issues, 'rejectCode', rec.rejectCode, 64);
  optString(issues, 'direction', rec.direction, 128);
  optString(issues, 'borrowStatus', rec.borrowStatus, 64);
  if (typeof rec.humanReason !== 'string' || rec.humanReason.length > MAX_READ_MODEL_HUMAN_REASON_LENGTH) {
    issues.push({ path: 'humanReason', code: 'STRING_INVALID', message: `humanReason must be a string (<=${MAX_READ_MODEL_HUMAN_REASON_LENGTH} chars)` });
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

  const valid = rec as unknown as DecisionInput;
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
      receivedAtMs: validProvenance.receivedAtMs,
      maxAgeMs: validProvenance.maxAgeMs,
      authority: validProvenance.authority,
      completeness: validProvenance.completeness,
      sourceId: validProvenance.sourceId,
    }),
    expiresAtMs: null,
    sourceLocalRank: null,
    netEdgePct: valid.netEdgePct,
    confidence: valid.confidence,
    borrowState: valid.borrowStatus ?? UNKNOWN,
    evidence: evidence.value,
    rejectionReasons: Object.freeze(valid.rejectCode !== null ? [valid.rejectCode] : []),
    configVersion: validProvenance.configVersion,
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
  const inspected = inspectOwnDataRecord(input, [
    'id',
    'correlationId',
    'symbol',
    'direction',
    'createdTs',
    'updatedTs',
    'status',
    'reason',
    'netEdgePct',
    'confidence',
    'borrowStatus',
    'expiresAtMs',
    'sourceLocalRank',
    'rejectionReasons',
    'evidence',
  ], 'proposal');
  const rec = inspected.values;
  const idPart = keyPart(rec.id);
  const sourceKey = idPart === '?' ? 'UNKNOWN' : idPart;
  if (inspected.issues.length > 0) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', inspected.issues);
  }
  const provenanceInspection = inspectSnapshotProvenance(provenance);
  if (!provenanceInspection.ok) {
    return reject('PROPOSAL', source, sourceKey, rec.symbol, 'PORT_RECORD_INVALID', provenanceInspection.issues);
  }
  const validProvenance = provenanceInspection.value;

  const issues: ValidationIssue[] = [];
  const tsIssues: ValidationIssue[] = [];
  reqString(issues, 'id', rec.id, 200);
  reqString(issues, 'correlationId', rec.correlationId, 128);
  reqString(issues, 'symbol', rec.symbol, 64);
  reqString(issues, 'direction', rec.direction, 128);
  reqString(issues, 'status', rec.status, 128);
  optString(issues, 'borrowStatus', rec.borrowStatus, 64);
  if (typeof rec.reason !== 'string' || rec.reason.length > MAX_READ_MODEL_HUMAN_REASON_LENGTH) {
    issues.push({ path: 'reason', code: 'STRING_INVALID', message: `reason must be a string (<=${MAX_READ_MODEL_HUMAN_REASON_LENGTH} chars)` });
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
  const rejectionReasons = rec.rejectionReasons === null
    ? null
    : inspectOwnDataArray(rec.rejectionReasons, MAX_READ_MODEL_REJECTION_REASONS);
  if (rejectionReasons !== null && (
    !rejectionReasons.isArray
      || !rejectionReasons.shapeValid
      || rejectionReasons.limitExceeded
      || rejectionReasons.invalidElementIndices.length > 0
      || rejectionReasons.values.some((reason) => (
        typeof reason !== 'string'
          || reason.length === 0
          || reason.length > MAX_READ_MODEL_REJECTION_REASON_LENGTH
      ))
  )) {
    issues.push({
      path: 'rejectionReasons',
      code: 'REASONS_INVALID',
      message: `rejectionReasons must contain at most ${MAX_READ_MODEL_REJECTION_REASONS} strings of 1..${MAX_READ_MODEL_REJECTION_REASON_LENGTH} chars`,
    });
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

  const valid = Object.freeze({
    ...rec,
    rejectionReasons: rejectionReasons === null ? null : rejectionReasons.values,
  }) as unknown as ProposalInput;
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
      receivedAtMs: validProvenance.receivedAtMs,
      maxAgeMs: validProvenance.maxAgeMs,
      authority: validProvenance.authority,
      completeness: validProvenance.completeness,
      sourceId: validProvenance.sourceId,
    }),
    expiresAtMs: valid.expiresAtMs,
    sourceLocalRank: valid.sourceLocalRank,
    netEdgePct: valid.netEdgePct,
    confidence: valid.confidence,
    borrowState: valid.borrowStatus ?? UNKNOWN,
    evidence: evidence.value,
    rejectionReasons: Object.freeze(valid.rejectionReasons !== null ? [...valid.rejectionReasons] : []),
    configVersion: validProvenance.configVersion,
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
