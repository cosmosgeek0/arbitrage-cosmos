/**
 * Read-only Basis/Volume capture adapters.
 *
 * The existing engines remain the only strategy authorities. This boundary
 * reads complete engine-owned records through a structural port, preserves
 * them as plain-data evidence, and projects the narrow Foundation
 * EngineSnapshotInput shape. It cannot reserve capital, run risk, or execute.
 */
import {
  buildCanonicalReadModel,
  decisionEngineKey,
  validateEngineSnapshotInput,
  type CanonicalReadModelView,
  type DecisionInput,
  type EngineSnapshotInput,
  type ProposalInput,
} from '../../foundation/readModel/index.js';
import {
  canonicalJson,
  createStructuredFailure,
  deriveCanonicalDecisionId,
  deriveCanonicalProposalId,
  deriveSourceDecisionId,
  deriveSourceProposalId,
  stableHash64Hex,
  type Completeness,
  type DataAuthority,
  type StrategySource,
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
import { createOpaqueIdentityAlias } from '../contracts/validation.js';

const COMPONENT = 'systemIntegration.adapters.engineCapture';
const DEFAULT_RECORD_LIMIT = 2_000;
const HARD_RECORD_LIMIT = 10_000;
const MAX_RECORD_BYTES = 512 * 1024;

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

export interface EngineCaptureProjection {
  readonly family: EngineFamily;
  readonly snapshot: Readonly<EngineSnapshotInput>;
  readonly identities: readonly Readonly<OpaqueIdentityAlias>[];
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

function boundedRecordLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_RECORD_LIMIT;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > HARD_RECORD_LIMIT) {
    throw new RangeError(`recordLimit must be a safe integer in [1, ${HARD_RECORD_LIMIT}]`);
  }
  return resolved;
}

function clonePlain(value: unknown, path: string, seen: Set<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} contains a non-finite number`);
    return value;
  }
  if (typeof value !== 'object') throw new TypeError(`${path} contains unsupported ${typeof value}`);
  if (seen.has(value)) throw new TypeError(`${path} is cyclic`);
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${path} contains a non-plain object`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry, index) => clonePlain(entry, `${path}[${index}]`, seen));
    seen.delete(value);
    return Object.freeze(result);
  }
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new TypeError(`${path} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} is not an enumerable data property`);
    }
    if (descriptor.value === undefined) throw new TypeError(`${path}.${key} is undefined`);
    result[key] = clonePlain(descriptor.value, `${path}.${key}`, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function preserveSourceRecord(value: unknown, path: string): Readonly<Record<string, unknown>> {
  const cloned = clonePlain(value, path, new Set());
  if (typeof cloned !== 'object' || cloned === null || Array.isArray(cloned)) {
    throw new TypeError(`${path} must be a plain record`);
  }
  const bytes = Buffer.byteLength(canonicalJson(cloned), 'utf8');
  if (bytes > MAX_RECORD_BYTES) throw new RangeError(`${path} exceeds ${MAX_RECORD_BYTES} bytes`);
  return Object.freeze({ sourceRecord: cloned });
}

function exactEvidenceString(record: Decision, key: string): string | null {
  const value = record.evidence[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function exactEvidenceNumber(record: Decision, key: string): number | null {
  const value = record.evidence[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function decisionInput(record: Readonly<Decision>): DecisionInput {
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
    evidence: preserveSourceRecord(record, 'decision'),
  });
}

function proposalExpiry(record: Readonly<EngineProposal>): number | null {
  const extension = record as Readonly<EngineProposal> & {
    readonly invalidationSpec?: Readonly<{ readonly expiresTs?: unknown }>;
  };
  const expiresTs = extension.invalidationSpec?.expiresTs;
  return typeof expiresTs === 'number' && Number.isSafeInteger(expiresTs) ? expiresTs : null;
}

function proposalInput(record: Readonly<EngineProposal>): ProposalInput {
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
    evidence: preserveSourceRecord(record, 'proposal'),
  });
}

function sourceForFamily(family: EngineFamily): StrategySource {
  return family;
}

function expectedStrategy(family: EngineFamily): Decision['strategy'] {
  return family === 'BASIS' ? 'basis' : 'volume_spike';
}

function recordAlias(
  input: CaptureEngineSnapshotInput,
  kind: 'DECISION' | 'PROPOSAL',
  ownerId: string,
  symbol: string,
  revisionDigest: string | null,
): Readonly<OpaqueIdentityAlias> {
  const source = sourceForFamily(input.family);
  const sourceRecordId = kind === 'DECISION'
    ? deriveSourceDecisionId({ source, engineKey: ownerId })
    : deriveSourceProposalId({ source, engineKey: ownerId });
  const canonicalProjectionId = kind === 'DECISION'
    ? deriveCanonicalDecisionId({ source, sourceRecordId, symbol })
    : deriveCanonicalProposalId({ source, sourceRecordId, symbol });
  return createOpaqueIdentityAlias({
    systemId: `engine-alias-${stableHash64Hex(`${source}|${kind}|${ownerId}`)}`,
    owner: input.family === 'BASIS' ? 'BASIS_ENGINE' : 'VOLUME_ENGINE',
    ownerId,
    canonicalProjectionId,
    correlationId: input.correlationId,
    revisionDigest,
  });
}

export function captureEngineSnapshot(
  input: CaptureEngineSnapshotInput,
): DialectTranslation<Readonly<EngineCaptureProjection>> {
  const found: Readonly<DialectLoss>[] = [];
  try {
    const limit = boundedRecordLimit(input.recordLimit);
    const decisions = input.port.readDecisions(limit);
    const proposals = input.port.readProposals(limit);
    if (!Array.isArray(decisions) || !Array.isArray(proposals)) {
      return rejected(input, 'ENGINE_CAPTURE_PORT_INVALID', 'Engine capture port must return arrays.', found);
    }
    if (decisions.length > limit || proposals.length > limit) {
      return rejected(input, 'ENGINE_CAPTURE_BOUNDS_EXCEEDED', 'Engine capture port exceeded the requested record limit.', found);
    }
    const strategy = expectedStrategy(input.family);
    if (decisions.some((record) => record.strategy !== strategy)
        || proposals.some((record) => record.strategy !== strategy)) {
      return rejected(
        input,
        'ENGINE_FAMILY_MISMATCH',
        `${input.family} capture contained a record owned by another strategy.`,
        found,
      );
    }

    const identities: Readonly<OpaqueIdentityAlias>[] = [];
    const mappedDecisions: DecisionInput[] = [];
    for (const record of decisions) {
      const mapped = decisionInput(record);
      const ownerId = decisionEngineKey(mapped);
      found.push(dialectLoss(
        'SOURCE_ID_DERIVED',
        'The engine decision contract has no record ID; its documented semantic composite is retained as the opaque owner ID.',
        'Decision.{correlationId,symbol,ts,kind}',
        'OpaqueIdentityAlias.ownerId',
      ));
      const revision = input.port.readRecordRevision?.('DECISION', ownerId) ?? null;
      if (revision === null) found.push(dialectLoss(
        'REVISION_UNAVAILABLE',
        'The source engine supplied no per-decision revision; the adapter did not invent one.',
        'Decision',
        'OpaqueIdentityAlias.revisionDigest',
      ));
      identities.push(recordAlias(input, 'DECISION', ownerId, record.symbol, revision));
      mappedDecisions.push(mapped);
    }

    const mappedProposals: ProposalInput[] = [];
    for (const record of proposals) {
      const revision = input.port.readRecordRevision?.('PROPOSAL', record.id) ?? null;
      if (revision === null) found.push(dialectLoss(
        'REVISION_UNAVAILABLE',
        'The source engine supplied no per-proposal revision; source ID and snapshot config version remain separate and exact.',
        'EngineProposal',
        'OpaqueIdentityAlias.revisionDigest',
      ));
      identities.push(recordAlias(input, 'PROPOSAL', record.id, record.symbol, revision));
      mappedProposals.push(proposalInput(record));
    }

    const snapshot: EngineSnapshotInput = Object.freeze({
      sourceId: input.sourceId,
      snapshotTimeMs: input.snapshotTimeMs,
      receivedAtMs: input.receivedAtMs,
      maxAgeMs: input.maxAgeMs,
      authority: input.authority,
      completeness: input.completeness,
      configVersion: input.configVersion,
      decisions: Object.freeze(mappedDecisions),
      proposals: Object.freeze(mappedProposals),
    });
    const issues = validateEngineSnapshotInput(snapshot);
    if (issues.length > 0) {
      return rejected(
        input,
        'ENGINE_SNAPSHOT_INVALID',
        `Captured engine snapshot is invalid: ${issues.map((entry) => `${entry.path}:${entry.code}`).join(', ')}.`,
        found,
      );
    }
    return Object.freeze({
      ok: true,
      value: Object.freeze({
        family: input.family,
        snapshot,
        identities: Object.freeze(identities),
        maximumActionAuthority: 'ADVISORY' as const,
        capitalReservationAuthority: 'NONE' as const,
        executionAuthority: 'NONE' as const,
      }),
      losses: freezeLosses(found),
    });
  } catch (error) {
    return rejected(
      input,
      'ENGINE_CAPTURE_FAILED',
      error instanceof Error ? error.message : 'Engine capture failed.',
      found,
    );
  }
}

export function buildCanonicalReadModelFromCaptures(
  input: BuildCapturedReadModelInput,
): DialectTranslation<Readonly<CapturedCanonicalReadModelProjection>> {
  if (input.basis !== null && input.basis.family !== 'BASIS') {
    return rejected(input, 'ENGINE_FAMILY_MISMATCH', 'Basis capture slot received a non-Basis engine capture.');
  }
  if (input.volume !== null && input.volume.family !== 'VOLUME') {
    return rejected(input, 'ENGINE_FAMILY_MISMATCH', 'Volume capture slot received a non-Volume engine capture.');
  }
  const result = buildCanonicalReadModel({
    nowMs: input.nowMs,
    correlationId: input.correlationId,
    basis: input.basis?.snapshot ?? null,
    volume: input.volume?.snapshot ?? null,
  });
  if (!result.ok) {
    return Object.freeze({ ok: false, failure: result.failure, losses: Object.freeze([]) });
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      view: result.value,
      identities: Object.freeze([
        ...(input.basis?.identities ?? []),
        ...(input.volume?.identities ?? []),
      ]),
    }),
    losses: Object.freeze([]),
  });
}
