/**
 * Read-only Basis/Volume capture adapters.
 *
 * The existing engines remain the only strategy authorities. This boundary
 * reads complete engine-owned records through a structural port, preserves
 * them as plain-data evidence, and projects the narrow Foundation
 * EngineSnapshotInput shape. It cannot reserve capital, run risk, or execute.
 */
import { isPromise } from 'node:util/types';
import {
  buildCanonicalReadModel,
  createReadModelStructuralInputRejection,
  decisionEngineKey,
  inspectOwnDataArray,
  inspectOwnDataRecord,
  isProxyValue,
  MAX_READ_MODEL_EVIDENCE_ARRAY_LENGTH,
  MAX_READ_MODEL_EVIDENCE_BYTES,
  MAX_READ_MODEL_EVIDENCE_DEPTH,
  MAX_READ_MODEL_EVIDENCE_KEY_LENGTH,
  MAX_READ_MODEL_EVIDENCE_NODES,
  MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS,
  MAX_READ_MODEL_EVIDENCE_STRING_LENGTH,
  validateEngineSnapshotInput,
  type CanonicalReadModelView,
  type DecisionInput,
  type EngineSnapshotInput,
  type ProposalInput,
  type ReadModelStructuralInputFailure,
} from '../../foundation/readModel/index.js';
import {
  canonicalJson,
  createStructuredFailure,
  deriveCanonicalDecisionId,
  deriveCanonicalProposalId,
  deriveSourceDecisionId,
  deriveSourceProposalId,
  isValidUtcMillis,
  observeRejectedThenable,
  stableHash128Hex,
  stableHash64Hex,
  type Completeness,
  type DataAuthority,
  type StrategySource,
  type ValidationIssue,
} from '../../foundation/contracts/index.js';
import type {
  Decision,
  EngineProposal,
} from '../../engine/v0/types.js';
import type {
  DialectLoss,
  DialectTranslation,
  OpaqueIdentityAlias,
  SafeModeContext,
} from '../contracts/types.js';
import {
  createOpaqueIdentityAlias,
  validateOpaqueIdentityAlias,
} from '../contracts/validation.js';

const COMPONENT = 'systemIntegration.adapters.engineCapture';
const DEFAULT_RECORD_LIMIT = 2_000;
const HARD_RECORD_LIMIT = 10_000;
const HARD_IDENTITY_LIMIT = HARD_RECORD_LIMIT * 2;
const MAX_RECORD_BYTES = MAX_READ_MODEL_EVIDENCE_BYTES;

export type EngineFamily = 'BASIS' | 'VOLUME';

/** Composition supplies wrappers over existing engine-owned read methods. */
export interface EngineCapturePort {
  readonly readDecisions: (limit: number) => readonly Readonly<Decision>[];
  readonly readProposals: (limit: number) => readonly Readonly<EngineProposal>[];
  /** Null means the source dialect has no per-record revision. */
  readonly readRecordRevision?: (
    kind: 'DECISION' | 'PROPOSAL',
    ownerId: string,
  ) => string | null;
}

export interface CaptureEngineSnapshotInput extends SafeModeContext {
  readonly family: EngineFamily;
  readonly sourceId: string;
  readonly snapshotTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly authority: DataAuthority;
  readonly completeness: Completeness;
  readonly configVersion: string | null;
  readonly recordLimit?: number;
  readonly port: EngineCapturePort;
}

/**
 * Safe marker retained in a snapshot array when the source record could not
 * be copied without invoking code. The Foundation record canonicalizer sees
 * the unknown marker field and emits a balanced PORT_RECORD_INVALID reject;
 * no hostile source object is ever republished.
 */
export interface GuardedCapturedRecordRejection {
  readonly captureBoundaryRejection:
    | 'SOURCE_RECORD_NOT_GUARDED_PLAIN_DATA'
    | 'ENGINE_FAMILY_MISMATCH';
}

export interface GuardedEngineSnapshotInput
  extends Omit<EngineSnapshotInput, 'decisions' | 'proposals'> {
  readonly decisions: readonly (DecisionInput | GuardedCapturedRecordRejection)[];
  readonly proposals: readonly (ProposalInput | GuardedCapturedRecordRejection)[];
}

export interface EngineCaptureProjection {
  readonly family: EngineFamily;
  readonly snapshot: Readonly<GuardedEngineSnapshotInput>;
  readonly identities: readonly Readonly<OpaqueIdentityAlias>[];
  /** Content address over family plus every exact alias field. */
  readonly identityBindingDigest: string;
  /** This read boundary can expose proposals, never reserve or execute them. */
  readonly maximumActionAuthority: 'ADVISORY';
  readonly capitalReservationAuthority: 'NONE';
  readonly executionAuthority: 'NONE';
}

export interface BuildCapturedReadModelInput extends SafeModeContext {
  readonly basis: Readonly<EngineCaptureProjection> | null;
  readonly volume: Readonly<EngineCaptureProjection> | null;
}

export interface CapturedCanonicalReadModelProjection {
  readonly view: Readonly<CanonicalReadModelView>;
  readonly identities: readonly Readonly<OpaqueIdentityAlias>[];
}

export interface CapturedReadModelStructuralInputRejection {
  readonly ok: false;
  readonly failureKind: 'STRUCTURAL_INPUT_REJECTION';
  readonly structuralFailure: Readonly<ReadModelStructuralInputFailure>;
  readonly losses: readonly Readonly<DialectLoss>[];
}

export type CapturedReadModelResult =
  | DialectTranslation<Readonly<CapturedCanonicalReadModelProjection>>
  | CapturedReadModelStructuralInputRejection;

export type CapturedEngineSnapshotResult =
  | DialectTranslation<Readonly<EngineCaptureProjection>>
  | CapturedReadModelStructuralInputRejection;

function dialectLoss(
  code: DialectLoss['code'],
  detail: string,
  sourcePath: string | null,
  targetPath: string | null,
): Readonly<DialectLoss> {
  return Object.freeze({ code, detail, sourcePath, targetPath });
}

function freezeLosses(values: readonly Readonly<DialectLoss>[]): readonly Readonly<DialectLoss>[] {
  return Object.freeze([...values]);
}

function capturedStructuralInputRejection(
  issues: readonly ValidationIssue[],
): CapturedReadModelStructuralInputRejection {
  const rejection = createReadModelStructuralInputRejection(issues);
  return Object.freeze({
    ...rejection,
    losses: Object.freeze([]),
  });
}

function rejected<T>(
  input: SafeModeContext,
  code: string,
  message: string,
  found: readonly Readonly<DialectLoss>[] = [],
): DialectTranslation<T> {
  return Object.freeze({
    ok: false,
    failure: createStructuredFailure({
      component: COMPONENT,
      stage: 'capture',
      code,
      message,
      occurredAt: input.nowMs,
      retryable: false,
      safeCurrentState: input.safeCurrentState,
      recommendedOperatorAction: 'Inspect the engine-owned snapshot and adapter metadata before retrying.',
      correlationId: input.correlationId,
    }),
    losses: freezeLosses(found),
  });
}

function boundedRecordLimit(value: unknown): number | null {
  const resolved = value ?? DEFAULT_RECORD_LIMIT;
  if (typeof resolved !== 'number'
    || !Number.isSafeInteger(resolved)
    || resolved < 1
    || resolved > HARD_RECORD_LIMIT) {
    return null;
  }
  return resolved as number;
}

interface CaptureCloneBudget {
  nodes: number;
  bytes: number;
}

function chargeCaptureBytes(budget: CaptureCloneBudget, bytes: number, path: string): void {
  budget.bytes += bytes;
  if (budget.bytes > MAX_RECORD_BYTES) {
    throw new RangeError(`${path} exceeds the ${MAX_RECORD_BYTES}-byte source-record budget`);
  }
}

function clonePlain(
  value: unknown,
  path: string,
  seen: Set<object>,
  budget: CaptureCloneBudget,
  depth: number,
): unknown {
  if (depth > MAX_READ_MODEL_EVIDENCE_DEPTH) {
    throw new RangeError(`${path} exceeds depth ${MAX_READ_MODEL_EVIDENCE_DEPTH}`);
  }
  budget.nodes += 1;
  chargeCaptureBytes(budget, 1, path);
  if (budget.nodes > MAX_READ_MODEL_EVIDENCE_NODES) {
    throw new RangeError(`${path} exceeds ${MAX_READ_MODEL_EVIDENCE_NODES} nodes`);
  }
  if (value === null) {
    chargeCaptureBytes(budget, 4, path);
    return value;
  }
  if (typeof value === 'boolean') {
    chargeCaptureBytes(budget, value ? 4 : 5, path);
    return value;
  }
  if (typeof value === 'string') {
    if (value.length > MAX_READ_MODEL_EVIDENCE_STRING_LENGTH) {
      throw new RangeError(`${path} exceeds ${MAX_READ_MODEL_EVIDENCE_STRING_LENGTH} UTF-16 code units`);
    }
    chargeCaptureBytes(budget, Buffer.byteLength(value, 'utf8') + 2, path);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    chargeCaptureBytes(budget, String(value).length, path);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains unsupported ${typeof value}`);
  if (isProxyValue(value)) throw new TypeError(`${path} contains a Proxy`);
  if (seen.has(value)) throw new TypeError(`${path} is cyclic`);
  if (Array.isArray(value)) {
    const inspected = inspectOwnDataArray(value, MAX_READ_MODEL_EVIDENCE_ARRAY_LENGTH);
    if (!inspected.isArray || !inspected.shapeValid || inspected.limitExceeded
      || inspected.invalidElementIndices.length > 0) {
      throw new TypeError(`${path} must be a bounded plain dense Array with only index data properties`);
    }
    seen.add(value);
    const result = inspected.values.map((entry, index) => (
      clonePlain(entry, `${path}[${index}]`, seen, budget, depth + 1)
    ));
    seen.delete(value);
    return Object.freeze(result);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length > MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS) {
    throw new RangeError(`${path} exceeds ${MAX_READ_MODEL_EVIDENCE_OBJECT_KEYS} keys`);
  }
  seen.add(value);
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of ownKeys) {
    if (typeof key !== 'string') throw new TypeError(`${path} contains a symbol key`);
    if (key.length > MAX_READ_MODEL_EVIDENCE_KEY_LENGTH) {
      throw new RangeError(`${path} contains a key longer than ${MAX_READ_MODEL_EVIDENCE_KEY_LENGTH} UTF-16 code units`);
    }
    chargeCaptureBytes(budget, Buffer.byteLength(key, 'utf8') + 3, path);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} is not an enumerable data property`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${path}.${key} is undefined`);
    result[key] = clonePlain(descriptor.value, `${path}.${key}`, seen, budget, depth + 1);
  }
  seen.delete(value);
  return Object.freeze(result);
}

interface GuardedSourceRecord {
  readonly record: Readonly<Record<string, unknown>>;
  readonly evidence: Readonly<Record<string, unknown>>;
}

function preserveSourceRecord(value: unknown, path: string): GuardedSourceRecord {
  const cloned = clonePlain(value, path, new Set(), { nodes: 0, bytes: 0 }, 0);
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    throw new TypeError(`${path} must be a plain record`);
  }
  const bytes = Buffer.byteLength(canonicalJson(cloned), 'utf8');
  if (bytes > MAX_RECORD_BYTES) throw new RangeError(`${path} exceeds ${MAX_RECORD_BYTES} bytes`);
  return Object.freeze({
    record: cloned as Readonly<Record<string, unknown>>,
    evidence: Object.freeze({ sourceRecord: cloned }),
  });
}

function captureRecordEvidence(
  record: Readonly<Record<string, unknown>>,
  revisionDigest: string | null,
): Readonly<Record<string, unknown>> {
  return Object.freeze({
    sourceRecord: record,
    captureRecordRevisionDigest: revisionDigest,
  });
}

function exactEvidenceValue(record: Readonly<Record<string, unknown>>, key: string): unknown {
  const evidence = record.evidence;
  if (typeof evidence !== 'object' || evidence === null || Array.isArray(evidence)) return undefined;
  return (evidence as Readonly<Record<string, unknown>>)[key];
}

function exactEvidenceString(record: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = exactEvidenceValue(record, key);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function exactEvidenceNumber(record: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = exactEvidenceValue(record, key);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decisionInput(
  record: Readonly<Record<string, unknown>>,
  evidence: Readonly<Record<string, unknown>>,
): DecisionInput {
  return Object.freeze({
    symbol: record.symbol,
    ts: record.ts,
    kind: record.kind,
    rejectCode: record.rejectCode,
    humanReason: record.humanReason,
    correlationId: record.correlationId,
    direction: exactEvidenceString(record, 'direction'),
    netEdgePct: exactEvidenceNumber(record, 'netEdgePct'),
    confidence: exactEvidenceNumber(record, 'confidence'),
    borrowStatus: exactEvidenceString(record, 'borrowStatus'),
    evidence,
  }) as unknown as DecisionInput;
}

function proposalExpiry(record: Readonly<Record<string, unknown>>): number | null {
  const spec = record.invalidationSpec;
  if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return null;
  const expiresTs = (spec as Readonly<Record<string, unknown>>).expiresTs;
  return typeof expiresTs === 'number' && Number.isSafeInteger(expiresTs) ? expiresTs : null;
}

function proposalInput(
  record: Readonly<Record<string, unknown>>,
  evidence: Readonly<Record<string, unknown>>,
): ProposalInput {
  return Object.freeze({
    id: record.id,
    correlationId: record.correlationId,
    symbol: record.symbol,
    direction: record.direction,
    createdTs: record.createdTs,
    updatedTs: record.updatedTs,
    status: record.status,
    reason: record.reason,
    netEdgePct: record.netEdgePct,
    confidence: record.confidence,
    borrowStatus: record.borrowStatus,
    expiresAtMs: proposalExpiry(record),
    sourceLocalRank: null,
    rejectionReasons: null,
    evidence,
  }) as unknown as ProposalInput;
}

function guardedRecordRejection(
  code: GuardedCapturedRecordRejection['captureBoundaryRejection'],
): Readonly<GuardedCapturedRecordRejection> {
  return Object.freeze({ captureBoundaryRejection: code });
}

function sourceForFamily(family: EngineFamily): StrategySource {
  return family;
}

function expectedStrategy(family: EngineFamily): Decision['strategy'] {
  return family === 'BASIS' ? 'basis' : 'volume_spike';
}

function recordAlias(
  family: EngineFamily,
  correlationId: string,
  kind: 'DECISION' | 'PROPOSAL',
  ownerId: string,
  symbol: string,
  revisionDigest: string | null,
): Readonly<OpaqueIdentityAlias> {
  const source = sourceForFamily(family);
  const sourceRecordId = kind === 'DECISION'
    ? deriveSourceDecisionId({ source, engineKey: ownerId })
    : deriveSourceProposalId({ source, engineKey: ownerId });
  const canonicalProjectionId = kind === 'DECISION'
    ? deriveCanonicalDecisionId({ source, sourceRecordId, symbol })
    : deriveCanonicalProposalId({ source, sourceRecordId, symbol });
  return createOpaqueIdentityAlias({
    systemId: `engine-alias-${stableHash64Hex(`${source}|${kind}|${ownerId}`)}`,
    owner: family === 'BASIS' ? 'BASIS_ENGINE' : 'VOLUME_ENGINE',
    ownerId,
    canonicalProjectionId,
    correlationId,
    revisionDigest,
  });
}

type IdentityBindingResult =
  | { readonly ok: true; readonly identities: readonly Readonly<OpaqueIdentityAlias>[] }
  | { readonly ok: false };

type RevisionAnchorInspection =
  | { readonly ok: true; readonly value: string | null }
  | { readonly ok: false };

function inspectCanonicalRevisionAnchor(evidence: unknown): RevisionAnchorInspection {
  const inspected = inspectOwnDataRecord(
    evidence,
    ['sourceRecord', 'captureRecordRevisionDigest'],
    'canonicalRecord.evidence',
  );
  const rec = inspected.values;
  const hasSourceRecord = Object.prototype.hasOwnProperty.call(rec, 'sourceRecord');
  const hasRevision = Object.prototype.hasOwnProperty.call(rec, 'captureRecordRevisionDigest');
  const revision = rec.captureRecordRevisionDigest;
  if (inspected.issues.length > 0
    || !hasSourceRecord
    || !hasRevision
    || typeof rec.sourceRecord !== 'object'
    || rec.sourceRecord === null
    || Array.isArray(rec.sourceRecord)
    || (revision !== null && (
      typeof revision !== 'string'
      || revision.length === 0
      || revision.length > 256
      || revision.trim() !== revision
      || /[\r\n\0]/.test(revision)
    ))) {
    return { ok: false };
  }
  return { ok: true, value: revision as string | null };
}

function deriveIdentityBindingDigest(
  family: EngineFamily,
  identities: readonly Readonly<OpaqueIdentityAlias>[],
): string {
  return `engine-identity-binding-${stableHash128Hex(canonicalJson({ family, identities }))}`;
}

function bindIdentitiesToCanonicalSection(
  family: EngineFamily,
  section: Readonly<CanonicalReadModelView['basis']>,
  identities: readonly Readonly<OpaqueIdentityAlias>[],
  correlationId: string,
  discardUnbound = false,
): IdentityBindingResult {
  const expectedOwner = family === 'BASIS' ? 'BASIS_ENGINE' : 'VOLUME_ENGINE';
  const expected = new Map<string, {
    readonly ownerId: string;
    readonly systemId: string;
    readonly revisionDigest: string | null;
  }>();
  for (const record of [...section.decisions, ...section.proposals]) {
    const revisionAnchor = inspectCanonicalRevisionAnchor(record.evidence);
    if (!revisionAnchor.ok) return { ok: false };
    expected.set(record.canonicalId, {
      ownerId: record.sourceId,
      systemId: `engine-alias-${stableHash64Hex(`${family}|${record.kind}|${record.sourceId}`)}`,
      revisionDigest: revisionAnchor.value,
    });
  }
  if (!discardUnbound && identities.length !== expected.size) return { ok: false };

  const seen = new Set<string>();
  const bound: Readonly<OpaqueIdentityAlias>[] = [];
  for (const identity of identities) {
    if (identity.canonicalProjectionId === null || seen.has(identity.canonicalProjectionId)) {
      if (discardUnbound) continue;
      return { ok: false };
    }
    const binding = expected.get(identity.canonicalProjectionId);
    if (binding === undefined
      || identity.owner !== expectedOwner
      || identity.ownerId !== binding.ownerId
      || identity.systemId !== binding.systemId
      || identity.correlationId !== correlationId
      || identity.revisionDigest !== binding.revisionDigest) {
      if (discardUnbound) continue;
      return { ok: false };
    }
    seen.add(identity.canonicalProjectionId);
    bound.push(identity);
  }
  return bound.length === expected.size
    ? { ok: true, identities: Object.freeze(bound) }
    : { ok: false };
}

const CAPTURE_INPUT_KEYS = [
  'nowMs',
  'correlationId',
  'safeCurrentState',
  'family',
  'sourceId',
  'snapshotTimeMs',
  'receivedAtMs',
  'maxAgeMs',
  'authority',
  'completeness',
  'configVersion',
  'recordLimit',
  'port',
] as const;

const CAPTURE_PORT_KEYS = [
  'readDecisions',
  'readProposals',
  'readRecordRevision',
] as const;

function validSafeCurrentState(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function trustedMetadataIssues(
  inspectedIssues: readonly ValidationIssue[],
  values: Readonly<Record<string, unknown>>,
  path: string,
): ValidationIssue[] {
  const issues = inspectedIssues.filter((issue) => (
    (issue.path === path && [
      'PROXY_NOT_ALLOWED',
      'PROPERTY_INSPECTION_FAILED',
    ].includes(issue.code))
      || issue.path === `${path}.nowMs`
      || issue.path === `${path}.correlationId`
  ));
  if (!isValidUtcMillis(values.nowMs)) {
    issues.push({
      path: `${path}.nowMs`,
      code: 'UTC_MILLIS_INVALID',
      message: 'nowMs must be valid injected UTC ms',
    });
  }
  if (typeof values.correlationId !== 'string'
    || values.correlationId.trim().length === 0
    || values.correlationId.length > 128) {
    issues.push({
      path: `${path}.correlationId`,
      code: 'CORRELATION_INVALID',
      message: 'correlationId must be a non-empty string (<=128 chars)',
    });
  }
  return issues;
}

function captureIssueMessage(issues: readonly ValidationIssue[]): string {
  return issues.length === 0
    ? 'Engine capture input is invalid.'
    : `Engine capture input is invalid: ${issues.slice(0, 16).map((entry) => `${entry.path}:${entry.code}`).join(', ')}.`;
}

export function captureEngineSnapshot(
  input: CaptureEngineSnapshotInput,
): CapturedEngineSnapshotResult {
  const found: Readonly<DialectLoss>[] = [];
  const inspectedInput = inspectOwnDataRecord(input, CAPTURE_INPUT_KEYS, 'captureInput');
  const rec = inspectedInput.values;
  const metadataIssues = trustedMetadataIssues(inspectedInput.issues, rec, 'captureInput');
  if (metadataIssues.length > 0) return capturedStructuralInputRejection(metadataIssues);

  const safeInput = Object.freeze({
    nowMs: rec.nowMs,
    correlationId: rec.correlationId,
    safeCurrentState: validSafeCurrentState(rec.safeCurrentState)
      ? rec.safeCurrentState
      : 'ENGINE_SNAPSHOT_NOT_CAPTURED',
  }) as SafeModeContext;
  const inputIssues: ValidationIssue[] = [...inspectedInput.issues];
  if (!validSafeCurrentState(rec.safeCurrentState)) {
    inputIssues.push({
      path: 'captureInput.safeCurrentState',
      code: 'SAFE_STATE_INVALID',
      message: 'safeCurrentState must be a non-empty string (<=200 chars)',
    });
  }
  if (rec.family !== 'BASIS' && rec.family !== 'VOLUME') {
    inputIssues.push({ path: 'captureInput.family', code: 'ENGINE_FAMILY_INVALID', message: 'family must be BASIS or VOLUME' });
  }
  const limit = boundedRecordLimit(rec.recordLimit);
  if (limit === null) {
    inputIssues.push({
      path: 'captureInput.recordLimit',
      code: 'RECORD_LIMIT_INVALID',
      message: `recordLimit must be a safe integer in [1, ${HARD_RECORD_LIMIT}]`,
    });
  }

  const snapshotMetadata = Object.freeze({
    sourceId: rec.sourceId,
    snapshotTimeMs: rec.snapshotTimeMs,
    receivedAtMs: rec.receivedAtMs,
    maxAgeMs: rec.maxAgeMs,
    authority: rec.authority,
    completeness: rec.completeness,
    configVersion: rec.configVersion,
    decisions: Object.freeze([]),
    proposals: Object.freeze([]),
  });
  inputIssues.push(...validateEngineSnapshotInput(snapshotMetadata));

  const inspectedPort = inspectOwnDataRecord(rec.port, CAPTURE_PORT_KEYS, 'captureInput.port');
  inputIssues.push(...inspectedPort.issues);
  const port = inspectedPort.values;
  if (typeof port.readDecisions !== 'function' || isProxyValue(port.readDecisions)) {
    inputIssues.push({ path: 'captureInput.port.readDecisions', code: 'FUNCTION_REQUIRED', message: 'readDecisions must be a non-Proxy function data property' });
  }
  if (typeof port.readProposals !== 'function' || isProxyValue(port.readProposals)) {
    inputIssues.push({ path: 'captureInput.port.readProposals', code: 'FUNCTION_REQUIRED', message: 'readProposals must be a non-Proxy function data property' });
  }
  if (port.readRecordRevision !== undefined
    && (typeof port.readRecordRevision !== 'function' || isProxyValue(port.readRecordRevision))) {
    inputIssues.push({ path: 'captureInput.port.readRecordRevision', code: 'FUNCTION_OR_UNDEFINED_REQUIRED', message: 'readRecordRevision must be an optional non-Proxy function data property' });
  }
  if (inputIssues.length > 0) {
    return rejected(safeInput, 'ENGINE_CAPTURE_INPUT_INVALID', captureIssueMessage(inputIssues), found);
  }

  const family = rec.family as EngineFamily;
  const readDecisions = port.readDecisions as EngineCapturePort['readDecisions'];
  const readProposals = port.readProposals as EngineCapturePort['readProposals'];
  const readRecordRevision = port.readRecordRevision as EngineCapturePort['readRecordRevision'];
  const identities: Readonly<OpaqueIdentityAlias>[] = [];
  const mappedDecisions: (DecisionInput | GuardedCapturedRecordRejection)[] = [];
  const mappedProposals: (ProposalInput | GuardedCapturedRecordRejection)[] = [];
  const strategy = expectedStrategy(family);

  const readRevision = (kind: 'DECISION' | 'PROPOSAL', ownerId: string): string | null => {
    let revision: string | null = null;
    if (readRecordRevision !== undefined) {
      try {
        const candidate = readRecordRevision(kind, ownerId);
        if (isPromise(candidate)) {
          observeRejectedThenable(candidate);
        } else if (typeof candidate === 'string'
          && candidate.length > 0
          && candidate.length <= 256
          && candidate.trim() === candidate
          && !/[\r\n\0]/.test(candidate)) {
          revision = candidate;
        }
      } catch {
        revision = null;
      }
    }
    if (revision === null) found.push(dialectLoss(
      'REVISION_UNAVAILABLE',
      `The source engine supplied no usable per-${kind === 'DECISION' ? 'decision' : 'proposal'} revision; the adapter did not invent one.`,
      kind === 'DECISION' ? 'Decision' : 'EngineProposal',
      'OpaqueIdentityAlias.revisionDigest',
    ));
    return revision;
  };

  try {
    const decisionOutput = readDecisions(limit as number);
    if (isPromise(decisionOutput)) {
      observeRejectedThenable(decisionOutput);
      return rejected(
        safeInput,
        'ENGINE_CAPTURE_PORT_INVALID',
        'Engine decision port must return a synchronous bounded plain Array.',
        found,
      );
    }
    const decisions = inspectOwnDataArray(decisionOutput, limit as number);
    if (!decisions.isArray || !decisions.shapeValid || decisions.limitExceeded
      || decisions.invalidElementIndices.length > 0) {
      return rejected(
        safeInput,
        decisions.limitExceeded ? 'ENGINE_CAPTURE_BOUNDS_EXCEEDED' : 'ENGINE_CAPTURE_PORT_INVALID',
        'Engine decision port must return a bounded plain dense Array with only index data properties.',
        found,
      );
    }
    for (const sourceRecord of decisions.values) {
      let guarded: GuardedSourceRecord;
      try {
        guarded = preserveSourceRecord(sourceRecord, 'decision');
      } catch {
        mappedDecisions.push(guardedRecordRejection('SOURCE_RECORD_NOT_GUARDED_PLAIN_DATA'));
        continue;
      }
      if (guarded.record.strategy !== strategy) {
        mappedDecisions.push(guardedRecordRejection('ENGINE_FAMILY_MISMATCH'));
        continue;
      }
      const identityCandidate = decisionInput(guarded.record, guarded.evidence);
      let revision: string | null = null;
      let alias: Readonly<OpaqueIdentityAlias> | null = null;
      try {
        const ownerId = decisionEngineKey(identityCandidate);
        const symbol = identityCandidate.symbol;
        revision = readRevision('DECISION', ownerId);
        alias = recordAlias(family, safeInput.correlationId, 'DECISION', ownerId, symbol, revision);
      } catch {
        // The guarded record remains for Foundation's named per-record reject.
      }
      mappedDecisions.push(decisionInput(
        guarded.record,
        captureRecordEvidence(guarded.record, revision),
      ));
      if (alias !== null) {
        identities.push(alias);
        found.push(dialectLoss(
          'SOURCE_ID_DERIVED',
          'The engine decision contract has no record ID; its documented semantic composite is retained as the opaque owner ID.',
          'Decision.{correlationId,symbol,ts,kind}',
          'OpaqueIdentityAlias.ownerId',
        ));
      }
    }

    const proposalOutput = readProposals(limit as number);
    if (isPromise(proposalOutput)) {
      observeRejectedThenable(proposalOutput);
      return rejected(
        safeInput,
        'ENGINE_CAPTURE_PORT_INVALID',
        'Engine proposal port must return a synchronous bounded plain Array.',
        found,
      );
    }
    const proposals = inspectOwnDataArray(proposalOutput, limit as number);
    if (!proposals.isArray || !proposals.shapeValid || proposals.limitExceeded
      || proposals.invalidElementIndices.length > 0) {
      return rejected(
        safeInput,
        proposals.limitExceeded ? 'ENGINE_CAPTURE_BOUNDS_EXCEEDED' : 'ENGINE_CAPTURE_PORT_INVALID',
        'Engine proposal port must return a bounded plain dense Array with only index data properties.',
        found,
      );
    }
    for (const sourceRecord of proposals.values) {
      let guarded: GuardedSourceRecord;
      try {
        guarded = preserveSourceRecord(sourceRecord, 'proposal');
      } catch {
        mappedProposals.push(guardedRecordRejection('SOURCE_RECORD_NOT_GUARDED_PLAIN_DATA'));
        continue;
      }
      if (guarded.record.strategy !== strategy) {
        mappedProposals.push(guardedRecordRejection('ENGINE_FAMILY_MISMATCH'));
        continue;
      }
      const identityCandidate = proposalInput(guarded.record, guarded.evidence);
      let revision: string | null = null;
      let alias: Readonly<OpaqueIdentityAlias> | null = null;
      if (typeof identityCandidate.id === 'string' && typeof identityCandidate.symbol === 'string') {
        try {
          revision = readRevision('PROPOSAL', identityCandidate.id);
          alias = recordAlias(
            family,
            safeInput.correlationId,
            'PROPOSAL',
            identityCandidate.id,
            identityCandidate.symbol,
            revision,
          );
        } catch {
          // The guarded record remains for Foundation's named per-record reject.
        }
      }
      mappedProposals.push(proposalInput(
        guarded.record,
        captureRecordEvidence(guarded.record, revision),
      ));
      if (alias !== null) identities.push(alias);
    }

    const snapshot: GuardedEngineSnapshotInput = Object.freeze({
      sourceId: rec.sourceId as string,
      snapshotTimeMs: rec.snapshotTimeMs as number | null,
      receivedAtMs: rec.receivedAtMs as number,
      maxAgeMs: rec.maxAgeMs as number,
      authority: rec.authority as DataAuthority,
      completeness: rec.completeness as Completeness,
      configVersion: rec.configVersion as string | null,
      decisions: Object.freeze(mappedDecisions),
      proposals: Object.freeze(mappedProposals),
    });
    const issues = validateEngineSnapshotInput(snapshot);
    if (issues.length > 0) {
      return rejected(
        safeInput,
        'ENGINE_SNAPSHOT_INVALID',
        `Captured engine snapshot is invalid: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}.`,
        found,
      );
    }
    const canonical = buildCanonicalReadModel({
      nowMs: safeInput.nowMs,
      correlationId: safeInput.correlationId,
      basis: family === 'BASIS' ? snapshot as unknown as EngineSnapshotInput : null,
      volume: family === 'VOLUME' ? snapshot as unknown as EngineSnapshotInput : null,
    });
    if (!canonical.ok) {
      return rejected(
        safeInput,
        'ENGINE_SNAPSHOT_INVALID',
        'Captured engine snapshot could not be checked against the canonical record boundary.',
        found,
      );
    }
    const identityBinding = bindIdentitiesToCanonicalSection(
      family,
      family === 'BASIS' ? canonical.value.basis : canonical.value.volume,
      identities,
      safeInput.correlationId,
      true,
    );
    if (!identityBinding.ok) {
      return rejected(
        safeInput,
        'ENGINE_IDENTITY_BINDING_INVALID',
        'Captured engine identities do not exactly bind the canonical records.',
        found,
      );
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        family,
        snapshot,
        identities: identityBinding.identities,
        identityBindingDigest: deriveIdentityBindingDigest(family, identityBinding.identities),
        maximumActionAuthority: 'ADVISORY' as const,
        capitalReservationAuthority: 'NONE' as const,
        executionAuthority: 'NONE' as const,
      }),
      losses: freezeLosses(found),
    });
  } catch {
    return rejected(
      safeInput,
      'ENGINE_CAPTURE_FAILED',
      'Engine capture port invocation or guarded snapshot projection failed.',
      found,
    );
  }
}

const CAPTURE_PROJECTION_KEYS = [
  'family',
  'snapshot',
  'identities',
  'identityBindingDigest',
  'maximumActionAuthority',
  'capitalReservationAuthority',
  'executionAuthority',
] as const;

const IDENTITY_ALIAS_KEYS = [
  'systemId',
  'owner',
  'ownerId',
  'canonicalProjectionId',
  'correlationId',
  'revisionDigest',
] as const;

function inspectIdentityAlias(
  value: unknown,
  path: string,
): { readonly value: Readonly<OpaqueIdentityAlias> | null; readonly issues: readonly ValidationIssue[] } {
  const inspected = inspectOwnDataRecord(value, IDENTITY_ALIAS_KEYS, path);
  const candidate = Object.freeze({
    systemId: inspected.values.systemId,
    owner: inspected.values.owner,
    ownerId: inspected.values.ownerId,
    canonicalProjectionId: inspected.values.canonicalProjectionId,
    correlationId: inspected.values.correlationId,
    revisionDigest: inspected.values.revisionDigest,
  });
  const issues: ValidationIssue[] = [...inspected.issues];
  for (const issue of validateOpaqueIdentityAlias(candidate)) {
    issues.push({
      ...issue,
      path: issue.path.length === 0 ? path : `${path}.${issue.path}`,
    });
  }
  return {
    value: issues.length === 0 ? candidate as Readonly<OpaqueIdentityAlias> : null,
    issues: Object.freeze(issues),
  };
}

function inspectCaptureProjection(
  value: unknown,
  path: string,
): { readonly ok: true; readonly value: Readonly<EngineCaptureProjection> }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] } {
  const inspected = inspectOwnDataRecord(value, CAPTURE_PROJECTION_KEYS, path);
  const rec = inspected.values;
  const issues: ValidationIssue[] = [...inspected.issues];
  const identities = inspectOwnDataArray(rec.identities, HARD_IDENTITY_LIMIT);
  const guardedIdentities: Readonly<OpaqueIdentityAlias>[] = [];
  if (rec.family !== 'BASIS' && rec.family !== 'VOLUME') {
    issues.push({ path: `${path}.family`, code: 'ENGINE_FAMILY_INVALID', message: 'family must be BASIS or VOLUME' });
  }
  if (typeof rec.snapshot !== 'object' || rec.snapshot === null) {
    issues.push({ path: `${path}.snapshot`, code: 'OBJECT_REQUIRED', message: 'snapshot must be an object' });
  }
  if (!identities.isArray || !identities.shapeValid || identities.limitExceeded
    || identities.invalidElementIndices.length > 0) {
    issues.push({ path: `${path}.identities`, code: 'ARRAY_SHAPE_INVALID', message: 'identities must be a bounded plain Array' });
  } else {
    identities.values.forEach((identity, index) => {
      const identityInspection = inspectIdentityAlias(identity, `${path}.identities[${index}]`);
      issues.push(...identityInspection.issues);
      if (identityInspection.value !== null) guardedIdentities.push(identityInspection.value);
    });
  }
  if (typeof rec.identityBindingDigest !== 'string'
    || !/^engine-identity-binding-[a-f0-9]{32}$/.test(rec.identityBindingDigest)) {
    issues.push({
      path: `${path}.identityBindingDigest`,
      code: 'IDENTITY_BINDING_DIGEST_INVALID',
      message: 'identityBindingDigest must be the canonical capture-owned alias content address',
    });
  } else if ((rec.family === 'BASIS' || rec.family === 'VOLUME')
    && identities.isArray
    && identities.shapeValid
    && !identities.limitExceeded
    && identities.invalidElementIndices.length === 0
    && guardedIdentities.length === identities.values.length
    && rec.identityBindingDigest !== deriveIdentityBindingDigest(rec.family, guardedIdentities)) {
    issues.push({
      path: `${path}.identityBindingDigest`,
      code: 'IDENTITY_BINDING_DIGEST_MISMATCH',
      message: 'identityBindingDigest does not match the exact guarded aliases',
    });
  }
  if (rec.maximumActionAuthority !== 'ADVISORY'
    || rec.capitalReservationAuthority !== 'NONE'
    || rec.executionAuthority !== 'NONE') {
    issues.push({ path, code: 'AUTHORITY_INVALID', message: 'capture projection must retain advisory/read-only authority' });
  }
  if (issues.length > 0) return { ok: false, issues: Object.freeze(issues) };
  return {
    ok: true,
    value: Object.freeze({
      family: rec.family,
      snapshot: rec.snapshot,
      identities: Object.freeze(guardedIdentities),
      identityBindingDigest: rec.identityBindingDigest,
      maximumActionAuthority: rec.maximumActionAuthority,
      capitalReservationAuthority: rec.capitalReservationAuthority,
      executionAuthority: rec.executionAuthority,
    }) as Readonly<EngineCaptureProjection>,
  };
}

export function buildCanonicalReadModelFromCaptures(
  input: BuildCapturedReadModelInput,
): CapturedReadModelResult {
  const inspectedInput = inspectOwnDataRecord(
    input,
    ['nowMs', 'correlationId', 'safeCurrentState', 'basis', 'volume'],
    'capturedReadModelInput',
  );
  const rec = inspectedInput.values;
  const structuralIssues = trustedMetadataIssues(inspectedInput.issues, rec, 'capturedReadModelInput');
  if (structuralIssues.length > 0) return capturedStructuralInputRejection(structuralIssues);

  const safeInput = Object.freeze({
    nowMs: rec.nowMs,
    correlationId: rec.correlationId,
    safeCurrentState: validSafeCurrentState(rec.safeCurrentState)
      ? rec.safeCurrentState
      : 'READ_MODEL_NOT_BUILT',
  }) as SafeModeContext;
  const inputIssues: ValidationIssue[] = [...inspectedInput.issues];
  if (!validSafeCurrentState(rec.safeCurrentState)) {
    inputIssues.push({ path: 'capturedReadModelInput.safeCurrentState', code: 'SAFE_STATE_INVALID', message: 'safeCurrentState must be a non-empty string (<=200 chars)' });
  }
  if (rec.basis !== null && (typeof rec.basis !== 'object' || rec.basis === null)) {
    inputIssues.push({ path: 'capturedReadModelInput.basis', code: 'OBJECT_OR_NULL_REQUIRED', message: 'basis must be a capture projection or null' });
  }
  if (rec.volume !== null && (typeof rec.volume !== 'object' || rec.volume === null)) {
    inputIssues.push({ path: 'capturedReadModelInput.volume', code: 'OBJECT_OR_NULL_REQUIRED', message: 'volume must be a capture projection or null' });
  }
  if (inputIssues.length > 0) {
    return rejected(
      safeInput,
      'ENGINE_CAPTURE_INPUT_INVALID',
      inputIssues[0]?.message ?? 'Captured read-model input is invalid.',
    );
  }
  const basisInspection = rec.basis === null ? null : inspectCaptureProjection(rec.basis, 'basis');
  const volumeInspection = rec.volume === null ? null : inspectCaptureProjection(rec.volume, 'volume');
  if (basisInspection !== null && !basisInspection.ok) {
    return rejected(safeInput, 'ENGINE_CAPTURE_INPUT_INVALID', basisInspection.issues[0]?.message ?? 'Basis capture projection is invalid.');
  }
  if (volumeInspection !== null && !volumeInspection.ok) {
    return rejected(safeInput, 'ENGINE_CAPTURE_INPUT_INVALID', volumeInspection.issues[0]?.message ?? 'Volume capture projection is invalid.');
  }
  const basis = basisInspection?.value ?? null;
  const volume = volumeInspection?.value ?? null;
  if (basis !== null && basis.family !== 'BASIS') {
    return rejected(safeInput, 'ENGINE_FAMILY_MISMATCH', 'Basis capture slot received a non-Basis engine capture.');
  }
  if (volume !== null && volume.family !== 'VOLUME') {
    return rejected(safeInput, 'ENGINE_FAMILY_MISMATCH', 'Volume capture slot received a non-Volume engine capture.');
  }
  const result = buildCanonicalReadModel({
    nowMs: safeInput.nowMs,
    correlationId: safeInput.correlationId,
    basis: basis === null ? null : basis.snapshot as unknown as EngineSnapshotInput,
    volume: volume === null ? null : volume.snapshot as unknown as EngineSnapshotInput,
  });
  if (!result.ok) {
    if ('structuralFailure' in result) {
      return Object.freeze({ ...result, losses: Object.freeze([]) });
    }
    return Object.freeze({ ok: false, failure: result.failure, losses: Object.freeze([]) });
  }
  const basisIdentities = basis === null
    ? { ok: true as const, identities: Object.freeze([]) as readonly Readonly<OpaqueIdentityAlias>[] }
    : bindIdentitiesToCanonicalSection('BASIS', result.value.basis, basis.identities, safeInput.correlationId);
  const volumeIdentities = volume === null
    ? { ok: true as const, identities: Object.freeze([]) as readonly Readonly<OpaqueIdentityAlias>[] }
    : bindIdentitiesToCanonicalSection('VOLUME', result.value.volume, volume.identities, safeInput.correlationId);
  if (!basisIdentities.ok || !volumeIdentities.ok) {
    return rejected(
      safeInput,
      'ENGINE_IDENTITY_BINDING_INVALID',
      'Capture identities must bind exactly once to canonical records from the same engine family.',
    );
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      view: result.value,
      identities: Object.freeze([
        ...basisIdentities.identities,
        ...volumeIdentities.identities,
      ]),
    }),
    losses: Object.freeze([]),
  });
}
