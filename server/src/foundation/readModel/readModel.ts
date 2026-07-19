/**
 * Lane B — Canonical Basis/Volume read model: the builder.
 *
 * `buildCanonicalReadModel` is a PURE FUNCTION over injected port data and an
 * injected clock. It republishes what the child engines already decided in
 * one canonical shape, and nothing else:
 *
 *   - owns no strategy logic, no timer, no proposal lifecycle, no cache;
 *   - creates no signal; every fact traces to a child record verbatim;
 *   - never mutates its input (all output structures are fresh copies);
 *   - preserves child authority/provenance; the local receipt time never
 *     overwrites the source event time;
 *   - evaluates freshness PER SOURCE against the injected clock, so a stale
 *     Basis snapshot can never poison a healthy Volume snapshot;
 *   - makes source disappearance explicit (presence 'ABSENT' for a declared
 *     null; a named failure when a source key is omitted entirely);
 *   - rejects malformed input with named codes and reconciles every count:
 *     inputs === canonical + duplicates + rejected, per source and per kind.
 *
 * Ordering uses ONLY the frozen `compareCanonicalOpportunities` comparator
 * (lifecycle, source, source-local rank, canonicalId tie-break). No
 * cross-strategy score exists anywhere in this lane.
 *
 * FUTURE WIRING SEAM (post-audit, not in this lane): a composition-root
 * adapter captures `BasisEngine.decisions()/openProposals()` and the volume
 * runtime snapshot into `EngineSnapshotInput` (stamping receivedAtMs from the
 * runtime clock and authority 'DERIVED_LIVE'), then calls
 * `buildCanonicalReadModel` and serves the view over an existing route.
 * Until then nothing constructs live inputs; live authority: NONE.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type {
  CanonicalDecision,
  CanonicalOpportunity,
  CanonicalProposal,
  ContractResult,
  FreshnessReport,
  SourcedTimestamp,
  StrategySource,
  StructuredFailure,
  ValidationIssue,
} from '../contracts/index.js';
import {
  canonicalJson,
  compareCanonicalOpportunities,
  createSourcedTimestamp,
  createStructuredFailure,
  evaluateFreshness,
  fail,
  failureFromIssues,
  isValidUtcMillis,
  ok,
} from '../contracts/index.js';
import type { EngineSnapshotInput, ReadModelInput } from './ports.js';
import {
  inspectEngineSnapshotInput,
  inspectOwnDataRecord,
  type EngineSnapshotInspection,
} from './ports.js';
import type { CanonicalizeResult, RejectedRecord } from './canonicalize.js';
import { canonicalizeDecision, canonicalizeProposal } from './canonicalize.js';

const COMPONENT = 'foundation.readModel';

// ---------- output vocabulary ----------

/**
 * Explicit source presence. 'ABSENT' = the caller declared the source gone
 * (null snapshot); 'INVALID' = a snapshot arrived but its provenance was
 * malformed, so every record in it was rejected. Never silent.
 */
export const SOURCE_PRESENCE_STATES = ['PRESENT', 'ABSENT', 'INVALID'] as const;
export type SourcePresence = (typeof SOURCE_PRESENCE_STATES)[number];

/** Per-source, per-kind count reconciliation. Must always balance. */
export interface SourceReconciliation {
  inputDecisions: number;
  inputProposals: number;
  canonicalDecisions: number;
  canonicalProposals: number;
  duplicateDecisions: number;
  duplicateProposals: number;
  rejectedDecisions: number;
  rejectedProposals: number;
  /** input === canonical + duplicates + rejected, for BOTH kinds. */
  balanced: boolean;
}

/** One strategy source's slice of the read model. */
export interface SourceSection {
  source: StrategySource;
  presence: SourcePresence;
  /** Snapshot-level provenance timestamp; null unless PRESENT. */
  snapshotTimestamp: Readonly<SourcedTimestamp> | null;
  /** Snapshot freshness vs the injected clock; null unless PRESENT. */
  freshness: Readonly<FreshnessReport> | null;
  /** Why the section is INVALID; null otherwise. */
  failure: Readonly<StructuredFailure> | null;
  decisions: readonly CanonicalDecision[];
  proposals: readonly CanonicalProposal[];
  rejects: readonly RejectedRecord[];
  reconciliation: SourceReconciliation;
}

/** Whole-view count reconciliation across both sources and kinds. */
export interface ReadModelReconciliation {
  inputRecords: number;
  canonicalRecords: number;
  duplicateRecords: number;
  rejectedRecords: number;
  balanced: boolean;
}

export interface CanonicalReadModelView {
  /** The injected clock value the view was built against. */
  evaluatedAtMs: number;
  correlationId: string;
  basis: SourceSection;
  volume: SourceSection;
  /**
   * All canonical records from both sections in the frozen deterministic
   * order (lifecycle, source, source-local rank, canonicalId). Staleness is
   * visible via each section's freshness report — stale records are shown,
   * never silently hidden.
   */
  ordered: readonly CanonicalOpportunity[];
  reconciliation: ReadModelReconciliation;
}

/**
 * Structural rejection used only when hostile outer metadata prevents the
 * caller from supplying a trustworthy injected clock/correlation. It is not
 * a StructuredFailure: unavailable metadata remains null instead of forged.
 */
export interface ReadModelStructuralInputFailure {
  readonly code: 'READ_MODEL_STRUCTURAL_INPUT_INVALID';
  readonly message: string;
  readonly occurredAt: null;
  readonly correlationId: null;
  readonly metadataAuthority: 'UNAVAILABLE';
  readonly safeCurrentState: 'READ_MODEL_NOT_BUILT';
  readonly issues: readonly ValidationIssue[];
}

export interface ReadModelStructuralInputRejection {
  readonly ok: false;
  readonly failureKind: 'STRUCTURAL_INPUT_REJECTION';
  readonly structuralFailure: Readonly<ReadModelStructuralInputFailure>;
}

export type CanonicalReadModelResult =
  | ContractResult<CanonicalReadModelView>
  | ReadModelStructuralInputRejection;

// ---------- internals ----------

function deepFreeze<T>(value: T, seen: Set<object> = new Set()): T {
  if (typeof value !== 'object' || value === null) return value;
  const obj = value as unknown as object;
  if (seen.has(obj)) return value;
  seen.add(obj);
  for (const key of Object.keys(obj)) {
    deepFreeze((obj as Record<string, unknown>)[key], seen);
  }
  Object.freeze(obj);
  return value;
}

function keyPart(v: unknown): string {
  if (typeof v === 'string' && v.length > 0) return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '?';
}

export function createReadModelStructuralInputRejection(
  issues: readonly ValidationIssue[],
): ReadModelStructuralInputRejection {
  return Object.freeze({
    ok: false as const,
    failureKind: 'STRUCTURAL_INPUT_REJECTION' as const,
    structuralFailure: Object.freeze({
      code: 'READ_MODEL_STRUCTURAL_INPUT_INVALID' as const,
      message: 'Read-model input metadata is unavailable or malformed; no canonical state was built.',
      occurredAt: null,
      correlationId: null,
      metadataAuthority: 'UNAVAILABLE' as const,
      safeCurrentState: 'READ_MODEL_NOT_BUILT' as const,
      issues: Object.freeze([...issues]),
    }),
  });
}

function compareRejects(a: RejectedRecord, b: RejectedRecord): number {
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  if (a.sourceKey !== b.sourceKey) return a.sourceKey < b.sourceKey ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  const aSymbol = a.symbol ?? '';
  const bSymbol = b.symbol ?? '';
  if (aSymbol !== bSymbol) return aSymbol < bSymbol ? -1 : 1;
  const aIssues = canonicalJson(a.issues);
  const bIssues = canonicalJson(b.issues);
  return aIssues < bIssues ? -1 : aIssues > bIssues ? 1 : 0;
}

interface KindOutcome<T extends CanonicalOpportunity> {
  kept: T[];
  duplicates: number;
  rejects: RejectedRecord[];
}

/**
 * Exact deduplication + conflict detection per canonical ID:
 *   - byte-identical canonical records whose complete validated child
 *     projections are also identical collapse to one (counted as duplicates);
 *   - records sharing an ID but DIFFERING in canonical OR source content are ALL rejected
 *     (CANONICAL_ID_CONFLICT) — the read model never picks a winner.
 */
function collapse<T extends CanonicalOpportunity>(
  results: readonly CanonicalizeResult<T>[],
  source: StrategySource,
): KindOutcome<T> {
  const rejects: RejectedRecord[] = [];
  const groups = new Map<string, { record: T; canonicalJson: string; sourceCanonical: string }[]>();
  for (const result of results) {
    if (!result.ok) {
      rejects.push(result.reject);
      continue;
    }
    const entry = {
      record: result.record,
      canonicalJson: canonicalJson(result.record),
      sourceCanonical: result.sourceCanonical,
    };
    const group = groups.get(result.record.canonicalId);
    if (group) group.push(entry);
    else groups.set(result.record.canonicalId, [entry]);
  }
  const kept: T[] = [];
  let duplicates = 0;
  for (const [canonicalId, group] of groups) {
    if (group.length === 1) {
      kept.push(group[0].record);
      continue;
    }
    const allEqual = group.every(
      (m) =>
        m.canonicalJson === group[0].canonicalJson &&
        m.sourceCanonical === group[0].sourceCanonical,
    );
    if (allEqual) {
      kept.push(group[0].record);
      duplicates += group.length - 1;
      continue;
    }
    for (const member of group) {
      rejects.push({
        kind: member.record.kind,
        source,
        sourceKey: member.record.sourceId,
        symbol: member.record.symbol,
        code: 'CANONICAL_ID_CONFLICT',
        issues: [
          {
            path: 'canonicalId',
            code: 'CANONICAL_ID_CONFLICT',
            message: `canonical ID ${canonicalId} maps to differing record content; all conflicting records rejected`,
          },
        ],
      });
    }
  }
  kept.sort(compareCanonicalOpportunities);
  return { kept, duplicates, rejects };
}

function emptyReconciliation(): SourceReconciliation {
  return {
    inputDecisions: 0,
    inputProposals: 0,
    canonicalDecisions: 0,
    canonicalProposals: 0,
    duplicateDecisions: 0,
    duplicateProposals: 0,
    rejectedDecisions: 0,
    rejectedProposals: 0,
    balanced: true,
  };
}

function absentSection(source: StrategySource): SourceSection {
  return {
    source,
    presence: 'ABSENT',
    snapshotTimestamp: null,
    freshness: null,
    failure: null,
    decisions: [],
    proposals: [],
    rejects: [],
    reconciliation: emptyReconciliation(),
  };
}

function invalidSection(
  source: StrategySource,
  inspected: EngineSnapshotInspection,
  nowMs: number,
  correlationId: string,
): SourceSection {
  const issues = inspected.issues;
  const failure = failureFromIssues(issues, {
    component: COMPONENT,
    stage: `validate:snapshot:${source}`,
    occurredAt: nowMs,
    correlationId,
    code: 'SNAPSHOT_PROVENANCE_INVALID',
    retryable: false,
    safeCurrentState: 'SOURCE_EXCLUDED_FROM_VIEW',
    recommendedOperatorAction: 'Fix the snapshot adapter so it supplies valid provenance for this source.',
  });

  const decisionsIn = inspected.decisions;
  const proposalsIn = inspected.proposals;

  const rejects: RejectedRecord[] = [];
  for (const d of decisionsIn) {
    const dr = inspectOwnDataRecord(d, ['correlationId', 'symbol', 'ts', 'kind'], 'decision').values;
    rejects.push({
      kind: 'DECISION',
      source,
      sourceKey: `${keyPart(dr.correlationId)}|${keyPart(dr.symbol)}|${keyPart(dr.ts)}|${keyPart(dr.kind)}`,
      symbol: typeof dr.symbol === 'string' && dr.symbol.length > 0 ? dr.symbol : null,
      code: 'SNAPSHOT_PROVENANCE_INVALID',
      issues: [],
    });
  }
  for (const p of proposalsIn) {
    const pr = inspectOwnDataRecord(p, ['id', 'symbol'], 'proposal').values;
    const idPart = keyPart(pr.id);
    rejects.push({
      kind: 'PROPOSAL',
      source,
      sourceKey: idPart === '?' ? 'UNKNOWN' : idPart,
      symbol: typeof pr.symbol === 'string' && pr.symbol.length > 0 ? pr.symbol : null,
      code: 'SNAPSHOT_PROVENANCE_INVALID',
      issues: [],
    });
  }
  rejects.sort(compareRejects);

  return {
    source,
    presence: 'INVALID',
    snapshotTimestamp: null,
    freshness: null,
    failure,
    decisions: [],
    proposals: [],
    rejects,
    reconciliation: {
      inputDecisions: inspected.decisionCount,
      inputProposals: inspected.proposalCount,
      canonicalDecisions: 0,
      canonicalProposals: 0,
      duplicateDecisions: 0,
      duplicateProposals: 0,
      rejectedDecisions: inspected.decisionCount,
      rejectedProposals: inspected.proposalCount,
      balanced: true,
    },
  };
}

function presentSection(
  source: StrategySource,
  snapshot: EngineSnapshotInput,
  nowMs: number,
): SourceSection {
  const snapshotTimestamp = createSourcedTimestamp({
    sourceTimeMs: snapshot.snapshotTimeMs,
    receivedAtMs: snapshot.receivedAtMs,
    maxAgeMs: snapshot.maxAgeMs,
    authority: snapshot.authority,
    completeness: snapshot.completeness,
    sourceId: snapshot.sourceId,
  });
  const freshness = evaluateFreshness(snapshotTimestamp, nowMs);

  const provenance = {
    sourceId: snapshot.sourceId,
    receivedAtMs: snapshot.receivedAtMs,
    maxAgeMs: snapshot.maxAgeMs,
    authority: snapshot.authority,
    completeness: snapshot.completeness,
    configVersion: snapshot.configVersion,
  };

  const decisionOutcome = collapse(
    Array.from(snapshot.decisions, (d) => canonicalizeDecision(source, d, provenance)),
    source,
  );
  const proposalOutcome = collapse(
    Array.from(snapshot.proposals, (p) => canonicalizeProposal(source, p, provenance)),
    source,
  );

  const rejects = [...decisionOutcome.rejects, ...proposalOutcome.rejects].sort(compareRejects);

  const reconciliation: SourceReconciliation = {
    inputDecisions: snapshot.decisions.length,
    inputProposals: snapshot.proposals.length,
    canonicalDecisions: decisionOutcome.kept.length,
    canonicalProposals: proposalOutcome.kept.length,
    duplicateDecisions: decisionOutcome.duplicates,
    duplicateProposals: proposalOutcome.duplicates,
    rejectedDecisions: decisionOutcome.rejects.length,
    rejectedProposals: proposalOutcome.rejects.length,
    balanced: false,
  };
  reconciliation.balanced =
    reconciliation.inputDecisions ===
      reconciliation.canonicalDecisions + reconciliation.duplicateDecisions + reconciliation.rejectedDecisions &&
    reconciliation.inputProposals ===
      reconciliation.canonicalProposals + reconciliation.duplicateProposals + reconciliation.rejectedProposals;

  return {
    source,
    presence: 'PRESENT',
    snapshotTimestamp,
    freshness,
    failure: null,
    decisions: decisionOutcome.kept,
    proposals: proposalOutcome.kept,
    rejects,
    reconciliation,
  };
}

function buildSection(
  source: StrategySource,
  snapshot: EngineSnapshotInput | null,
  nowMs: number,
  correlationId: string,
): SourceSection {
  if (snapshot === null) return absentSection(source);
  const inspected = inspectEngineSnapshotInput(snapshot);
  if (inspected.issues.length > 0) return invalidSection(source, inspected, nowMs, correlationId);
  return presentSection(source, inspected.snapshot as unknown as EngineSnapshotInput, nowMs);
}

// ---------- the builder ----------

/**
 * Build one canonical view from injected child snapshots. Deterministic:
 * the same input (including nowMs) always yields a byte-identical view,
 * regardless of record order inside the input arrays.
 *
 * Never throws for hostile input. When outer metadata cannot provide a
 * trustworthy injected clock/correlation, a distinct structural rejection
 * preserves both as unavailable nulls; it never forges a StructuredFailure.
 * Undeclared sources, malformed snapshots, and malformed records travel as
 * named failures/rejects inside the result, per source, so one source's
 * trouble never hides the other source's health.
 */
export function buildCanonicalReadModel(input: ReadModelInput): CanonicalReadModelResult {
  const inspectedInput = inspectOwnDataRecord(
    input,
    ['nowMs', 'correlationId', 'basis', 'volume'],
    'input',
  );
  const rec = inspectedInput.values;
  const metadataIssues = inspectedInput.issues.filter((issue) => (
    (issue.path === 'input' && [
      'PROXY_NOT_ALLOWED',
      'PROPERTY_INSPECTION_FAILED',
    ].includes(issue.code))
      || issue.path === 'input.nowMs'
      || issue.path === 'input.correlationId'
  ));
  if (!isValidUtcMillis(rec.nowMs)) {
    metadataIssues.push({
      path: 'input.nowMs',
      code: 'UTC_MILLIS_INVALID',
      message: 'nowMs must be a safe-integer UTC ms from an injected clock',
    });
  }
  if (typeof rec.correlationId !== 'string' || rec.correlationId.trim().length === 0 || rec.correlationId.length > 128) {
    metadataIssues.push({
      path: 'input.correlationId',
      code: 'NON_EMPTY_STRING_REQUIRED',
      message: 'correlationId must be a non-empty string (<=128 chars)',
    });
  }
  if (metadataIssues.length > 0) return createReadModelStructuralInputRejection(metadataIssues);

  const nowMs = rec.nowMs as number;
  const correlationId = rec.correlationId as string;

  if (inspectedInput.issues.length > 0) {
    return fail(
      createStructuredFailure({
        component: COMPONENT,
        stage: 'validate:input',
        code: 'READ_MODEL_INPUT_SHAPE_INVALID',
        message: 'read-model input must contain only closed own data fields',
        occurredAt: nowMs,
        retryable: false,
        safeCurrentState: 'READ_MODEL_NOT_BUILT',
        recommendedOperatorAction: 'Replace accessors, Proxies, symbols, and unknown side fields with explicit plain data.',
        correlationId,
      }),
    );
  }

  const undeclared: string[] = [];
  for (const key of ['basis', 'volume'] as const) {
    if (!Object.prototype.hasOwnProperty.call(rec, key) || rec[key] === undefined) {
      undeclared.push(key);
    }
  }
  if (undeclared.length > 0) {
    return fail(
      createStructuredFailure({
        component: COMPONENT,
        stage: 'validate:input',
        code: 'SOURCE_PRESENCE_UNDECLARED',
        message:
          `source presence undeclared for: ${undeclared.join(', ')} — ` +
          'every source must be a snapshot object or an explicit null (source disappeared)',
        occurredAt: nowMs,
        retryable: false,
        safeCurrentState: 'READ_MODEL_NOT_BUILT',
        recommendedOperatorAction: 'Declare every strategy source explicitly; pass null for a disappeared source.',
        correlationId,
      }),
    );
  }

  const basis = buildSection('BASIS', rec.basis as EngineSnapshotInput | null, nowMs, correlationId);
  const volume = buildSection('VOLUME', rec.volume as EngineSnapshotInput | null, nowMs, correlationId);

  const ordered: CanonicalOpportunity[] = [
    ...basis.decisions,
    ...basis.proposals,
    ...volume.decisions,
    ...volume.proposals,
  ].sort(compareCanonicalOpportunities);

  const totals = {
    inputRecords: 0,
    canonicalRecords: 0,
    duplicateRecords: 0,
    rejectedRecords: 0,
  };
  for (const section of [basis, volume]) {
    const r = section.reconciliation;
    totals.inputRecords += r.inputDecisions + r.inputProposals;
    totals.canonicalRecords += r.canonicalDecisions + r.canonicalProposals;
    totals.duplicateRecords += r.duplicateDecisions + r.duplicateProposals;
    totals.rejectedRecords += r.rejectedDecisions + r.rejectedProposals;
  }
  const reconciliation: ReadModelReconciliation = {
    ...totals,
    balanced:
      basis.reconciliation.balanced &&
      volume.reconciliation.balanced &&
      totals.inputRecords === totals.canonicalRecords + totals.duplicateRecords + totals.rejectedRecords,
  };

  const view: CanonicalReadModelView = {
    evaluatedAtMs: nowMs,
    correlationId,
    basis,
    volume,
    ordered,
    reconciliation,
  };
  return ok(deepFreeze(view));
}
