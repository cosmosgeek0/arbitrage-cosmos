/**
 * Foundation contracts — canonical opportunity vocabulary (WAVE 0, frozen).
 *
 * The Basis and Volume engines remain the only strategy authorities. The
 * canonical read model (Lane B) republishes their decisions/proposals in ONE
 * shape without inventing values. This module freezes that shape.
 *
 * LAWS:
 *   - No cross-strategy score exists. Deterministic ordering may use
 *     lifecycle, source, and source-local rank ONLY (plus canonical ID as a
 *     final total-order tie-break).
 *   - Facts the child engine did not supply stay null ('UNKNOWN' for
 *     borrow) — never defaulted.
 *   - Source identifiers and strategy-specific vocabulary are preserved
 *     verbatim; canonicalization adds identity, never meaning.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type { SourcedTimestamp } from './time.js';
import { validateSourcedTimestamp, isValidUtcMillis } from './time.js';
import type { ValidationIssue } from './failures.js';

// ---------- vocabulary ----------

export const STRATEGY_SOURCES = ['BASIS', 'VOLUME'] as const;
export type StrategySource = (typeof STRATEGY_SOURCES)[number];

export function isStrategySource(value: unknown): value is StrategySource {
  return typeof value === 'string' && (STRATEGY_SOURCES as readonly string[]).includes(value);
}

/**
 * Normalized lifecycle. The child's own lifecycle label is preserved
 * verbatim in `sourceLifecycle`; this union only buckets it for ordering
 * and filtering. 'UNKNOWN' is legal and means exactly that.
 */
export const CANONICAL_LIFECYCLES = ['OPEN', 'EXPIRED', 'REJECTED', 'CLOSED', 'UNKNOWN'] as const;
export type CanonicalLifecycle = (typeof CANONICAL_LIFECYCLES)[number];

export function isCanonicalLifecycle(value: unknown): value is CanonicalLifecycle {
  return typeof value === 'string' && (CANONICAL_LIFECYCLES as readonly string[]).includes(value);
}

export const OPPORTUNITY_KINDS = ['DECISION', 'PROPOSAL'] as const;
export type OpportunityKind = (typeof OPPORTUNITY_KINDS)[number];

// ---------- canonical record shape ----------

export interface CanonicalOpportunity {
  kind: OpportunityKind;
  /** Deterministic canonical ID (cdec_ or cprop_ prefixed, from identity.ts). */
  canonicalId: string;
  source: StrategySource;
  /** The source engine's own record ID, preserved verbatim. */
  sourceId: string;
  symbol: string;
  /** Strategy-specific direction label, preserved verbatim. */
  direction: string;
  lifecycle: CanonicalLifecycle;
  /** The child's lifecycle label, verbatim (e.g. 'proposed', 'watching'). */
  sourceLifecycle: string;
  /** When the child observed the fact — full provenance, never collapsed. */
  observedAt: SourcedTimestamp;
  /** Child-declared expiry (UTC ms); null when the child declared none. */
  expiresAtMs: number | null;
  /** Rank inside its OWN strategy's output; meaningless across strategies. */
  sourceLocalRank: number | null;
  /** Net edge pct — ONLY when the child supplied one; never computed here. */
  netEdgePct: number | null;
  /** Confidence 0..1 — ONLY when the child supplied one. */
  confidence: number | null;
  /** Borrow state label from the child ('available'/'unknown'/...); 'UNKNOWN' when absent. */
  borrowState: string;
  /** Child-supplied evidence payload, plain data, preserved as-is. */
  evidence: Readonly<Record<string, unknown>> | null;
  /** Named rejection reasons from the child; empty when none. */
  rejectionReasons: readonly string[];
  /** Child engine configuration version; null when the child supplied none. */
  configVersion: string | null;
}

export interface CanonicalDecision extends CanonicalOpportunity {
  kind: 'DECISION';
}

export interface CanonicalProposal extends CanonicalOpportunity {
  kind: 'PROPOSAL';
}

// ---------- validation ----------

function pushStr(issues: ValidationIssue[], path: string, v: unknown, maxLen = 300): void {
  if (typeof v !== 'string' || v.trim().length === 0 || v.length > maxLen) {
    issues.push({ path, code: 'NON_EMPTY_STRING_REQUIRED', message: `${path} must be a non-empty string (<=${maxLen} chars)` });
  }
}

/** Structural validation of a canonical record. Empty array = valid. */
export function validateCanonicalOpportunity(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'canonical opportunity must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  if (rec.kind !== 'DECISION' && rec.kind !== 'PROPOSAL') {
    issues.push({ path: 'kind', code: 'KIND_INVALID', message: "kind must be 'DECISION' or 'PROPOSAL'" });
  }
  pushStr(issues, 'canonicalId', rec.canonicalId);
  if (!isStrategySource(rec.source)) {
    issues.push({ path: 'source', code: 'SOURCE_INVALID', message: "source must be 'BASIS' or 'VOLUME'" });
  }
  pushStr(issues, 'sourceId', rec.sourceId);
  pushStr(issues, 'symbol', rec.symbol, 64);
  pushStr(issues, 'direction', rec.direction, 128);
  if (!isCanonicalLifecycle(rec.lifecycle)) {
    issues.push({ path: 'lifecycle', code: 'LIFECYCLE_INVALID', message: 'lifecycle must be a CanonicalLifecycle' });
  }
  pushStr(issues, 'sourceLifecycle', rec.sourceLifecycle, 128);
  for (const issue of validateSourcedTimestamp(rec.observedAt)) {
    issues.push({ ...issue, path: `observedAt.${issue.path}` });
  }
  if (rec.expiresAtMs !== null && !isValidUtcMillis(rec.expiresAtMs)) {
    issues.push({ path: 'expiresAtMs', code: 'UTC_MILLIS_INVALID', message: 'expiresAtMs must be null or valid UTC ms' });
  }
  if (rec.sourceLocalRank !== null && (typeof rec.sourceLocalRank !== 'number' || !Number.isSafeInteger(rec.sourceLocalRank) || rec.sourceLocalRank < 0)) {
    issues.push({ path: 'sourceLocalRank', code: 'RANK_INVALID', message: 'sourceLocalRank must be null or a non-negative integer' });
  }
  if (rec.netEdgePct !== null && (typeof rec.netEdgePct !== 'number' || !Number.isFinite(rec.netEdgePct))) {
    issues.push({ path: 'netEdgePct', code: 'NUMBER_INVALID', message: 'netEdgePct must be null or a finite number' });
  }
  if (rec.confidence !== null && (typeof rec.confidence !== 'number' || !Number.isFinite(rec.confidence) || rec.confidence < 0 || rec.confidence > 1)) {
    issues.push({ path: 'confidence', code: 'CONFIDENCE_INVALID', message: 'confidence must be null or a number in [0,1]' });
  }
  pushStr(issues, 'borrowState', rec.borrowState, 64);
  if (rec.evidence !== null && (typeof rec.evidence !== 'object' || Array.isArray(rec.evidence))) {
    issues.push({ path: 'evidence', code: 'EVIDENCE_INVALID', message: 'evidence must be null or a plain object' });
  }
  if (!Array.isArray(rec.rejectionReasons) || rec.rejectionReasons.some((r) => typeof r !== 'string' || r.length === 0)) {
    issues.push({ path: 'rejectionReasons', code: 'REASONS_INVALID', message: 'rejectionReasons must be an array of non-empty strings' });
  }
  if (rec.configVersion !== null && (typeof rec.configVersion !== 'string' || rec.configVersion.length === 0)) {
    issues.push({ path: 'configVersion', code: 'CONFIG_VERSION_INVALID', message: 'configVersion must be null or a non-empty string' });
  }
  return issues;
}

// ---------- deterministic ordering ----------

/** Lifecycle display/processing order. NOT a cross-strategy quality score. */
const LIFECYCLE_ORDER: Readonly<Record<CanonicalLifecycle, number>> = Object.freeze({
  OPEN: 0,
  EXPIRED: 1,
  REJECTED: 2,
  CLOSED: 3,
  UNKNOWN: 4,
});

/**
 * Deterministic total order over canonical records using ONLY the fields the
 * directive permits: lifecycle bucket, then source (alphabetical), then
 * source-local rank (nulls after known ranks — an unranked record never
 * outranks a ranked one), then canonicalId as the final tie-break. No edge,
 * confidence, or any invented cross-strategy score participates.
 */
export function compareCanonicalOpportunities(a: CanonicalOpportunity, b: CanonicalOpportunity): number {
  if (!isCanonicalLifecycle(a.lifecycle) || !isCanonicalLifecycle(b.lifecycle)) {
    throw new TypeError('compareCanonicalOpportunities: invalid lifecycle');
  }
  const byLifecycle = LIFECYCLE_ORDER[a.lifecycle] - LIFECYCLE_ORDER[b.lifecycle];
  if (byLifecycle !== 0) return byLifecycle;
  const bySource = a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
  if (bySource !== 0) return bySource;
  const aRank = a.sourceLocalRank;
  const bRank = b.sourceLocalRank;
  if (aRank !== bRank) {
    if (aRank === null) return 1;
    if (bRank === null) return -1;
    return aRank - bRank;
  }
  return a.canonicalId < b.canonicalId ? -1 : a.canonicalId > b.canonicalId ? 1 : 0;
}
