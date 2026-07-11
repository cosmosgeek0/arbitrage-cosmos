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
import { validateEngineSnapshotInput } from './ports.js';
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
  snapshot: unknown,
  nowMs: number,
  correlationId: string,
): SourceSection {
  const issues = validateEngineSnapshotInput(snapshot);
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

  const rec =
    typeof snapshot === 'object' && snapshot !== null && !Array.isArray(snapshot)
      ? (snapshot as Record<string, unknown>)
      : {};
  const decisionsIn = Array.isArray(rec.decisions) ? rec.decisions : [];
  const proposalsIn = Array.isArray(rec.proposals) ? rec.proposals : [];

  const rejects: RejectedRecord[] = [];
  for (const d of decisionsIn) {
    const dr = typeof d === 'object' && d !== null ? (d as Record<string, unknown>) : {};
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
    const pr = typeof p === 'object' && p !== null ? (p as Record<string, unknown>) : {};
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
      inputDecisions: decisionsIn.length,
      inputProposals: proposalsIn.length,
      canonicalDecisions: 0,
      canonicalProposals: 0,
      duplicateDecisions: 0,
      duplicateProposals: 0,
      rejectedDecisions: decisionsIn.length,
      rejectedProposals: proposalsIn.length,
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
  const issues = validateEngineSnapshotInput(snapshot);
  if (issues.length > 0) return invalidSection(source, snapshot, nowMs, correlationId);
  return presentSection(source, snapshot, nowMs);
}

// ---------- the builder ----------

/**
 * Build one canonical view from injected child snapshots. Deterministic:
 * the same input (including nowMs) always yields a byte-identical view,
 * regardless of record order inside the input arrays.
 *
 * Throws TypeError only on programmer misuse (non-object input, invalid
 * injected clock, invalid correlationId). Operational problems — undeclared
 * sources, malformed snapshots, malformed records — travel as named
 * failures/rejects inside the result, per source, so one source's trouble
 * never hides the other source's health.
 */
export function buildCanonicalReadModel(input: ReadModelInput): ContractResult<CanonicalReadModelView> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new TypeError('buildCanonicalReadModel: input must be a plain object');
  }
  const rec = input as unknown as Record<string, unknown>;
  if (!isValidUtcMillis(rec.nowMs)) {
    throw new TypeError('buildCanonicalReadModel: nowMs must be a safe-integer UTC ms from an injected clock');
  }
  const nowMs = rec.nowMs as number;
  if (typeof rec.correlationId !== 'string' || rec.correlationId.trim().length === 0 || rec.correlationId.length > 128) {
    throw new TypeError('buildCanonicalReadModel: correlationId must be a non-empty string (<=128 chars)');
  }
  const correlationId = rec.correlationId;

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
