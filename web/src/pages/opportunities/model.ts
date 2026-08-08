/**
 * Bounded browser mirror of the passive production Opportunities read port.
 *
 * This file deliberately does not import server code. The server owns the
 * contract; this mirror gives the mounted HTTP reader one strict admission
 * boundary while keeping this page provider-free. It never constructs,
 * re-ranks, merges, or enriches Basis and Volume records.
 */

export const OPPORTUNITY_SOURCES = ['BASIS', 'VOLUME'] as const;
export type OpportunitySource = (typeof OPPORTUNITY_SOURCES)[number];

export const OPPORTUNITY_LIFECYCLES = [
  'OPEN',
  'EXPIRED',
  'REJECTED',
  'CLOSED',
  'UNKNOWN',
] as const;
export type OpportunityLifecycle = (typeof OPPORTUNITY_LIFECYCLES)[number];

export const OPPORTUNITY_AUTHORITIES = [
  'LIVE_PUBLIC',
  'LIVE_PRIVATE',
  'DERIVED_LIVE',
  'RECORDED_REPLAY',
  'SYNTHETIC_TEST',
  'UNAVAILABLE',
] as const;
export type OpportunityDataAuthority = (typeof OPPORTUNITY_AUTHORITIES)[number];

export const OPPORTUNITY_IDENTITY_OWNERS = [
  'AUDITED_APP',
  'INTELLIGENCE_RUNTIME',
  'MARKET_INTELLIGENCE',
  'Q_INFERENCE',
  'BASIS_ENGINE',
  'VOLUME_ENGINE',
  'CAPITAL_SUPERVISION',
  'BACKEND_FOUNDATION_CONTROL',
  'BACKEND_FOUNDATION_RISK',
  'BACKEND_FOUNDATION_EXECUTION',
  'BACKEND_FOUNDATION_RECONCILIATION',
  'EXISTING_LEDGER',
  'SYSTEM_INTEGRATION',
] as const;
export type OpportunityIdentityOwner = (typeof OPPORTUNITY_IDENTITY_OWNERS)[number];

export const OPPORTUNITY_FRESHNESS_STATES = [
  'FRESH',
  'STALE',
  'UNAVAILABLE',
  'CLOCK_SKEWED',
] as const;
export type OpportunityFreshnessState = (typeof OPPORTUNITY_FRESHNESS_STATES)[number];

export interface OpportunitySourcedTimestamp {
  readonly sourceTimeMs: number | null;
  readonly receivedAtMs: number;
  readonly maxAgeMs: number;
  readonly authority: OpportunityDataAuthority;
  readonly completeness: 'COMPLETE' | 'PARTIAL' | 'UNAVAILABLE';
  readonly sourceId: string;
}

export interface OpportunityFreshnessReport {
  readonly state: OpportunityFreshnessState;
  readonly ageMs: number | null;
  readonly basis: 'SOURCE_TIME' | 'RECEIPT_TIME' | 'NONE';
  readonly effectiveAuthority: OpportunityDataAuthority;
  readonly evaluatedAt: number;
}

export interface CanonicalOpportunity {
  readonly kind: 'DECISION' | 'PROPOSAL';
  readonly canonicalId: string;
  readonly source: OpportunitySource;
  readonly sourceId: string;
  readonly symbol: string;
  readonly direction: string;
  readonly lifecycle: OpportunityLifecycle;
  readonly sourceLifecycle: string;
  readonly observedAt: Readonly<OpportunitySourcedTimestamp>;
  readonly expiresAtMs: number | null;
  readonly sourceLocalRank: number | null;
  /** Owner-reported net edge in percentage points; null means unknown. */
  readonly netEdgePct: number | null;
  readonly confidence: number | null;
  readonly borrowState: string;
  readonly evidence: Readonly<Record<string, unknown>> | null;
  readonly rejectionReasons: readonly string[];
  readonly configVersion: string | null;
}

export interface OpportunityValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface OpportunityStructuredFailure {
  readonly component: string;
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly occurredAt: number;
  readonly retryable: boolean;
  readonly safeCurrentState: string;
  readonly recommendedOperatorAction: string;
  readonly correlationId: string;
}

export interface OpportunityRejectedRecord {
  readonly kind: 'DECISION' | 'PROPOSAL';
  readonly source: OpportunitySource;
  readonly sourceKey: string;
  readonly symbol: string | null;
  readonly code:
    | 'PORT_RECORD_INVALID'
    | 'MALFORMED_TIMESTAMP'
    | 'EVIDENCE_INVALID'
    | 'CANONICAL_VALIDATION_FAILED'
    | 'CANONICAL_ID_CONFLICT'
    | 'SNAPSHOT_PROVENANCE_INVALID';
  readonly issues: readonly OpportunityValidationIssue[];
}

export interface OpportunitySourceReconciliation {
  readonly inputDecisions: number;
  readonly inputProposals: number;
  readonly canonicalDecisions: number;
  readonly canonicalProposals: number;
  readonly duplicateDecisions: number;
  readonly duplicateProposals: number;
  readonly rejectedDecisions: number;
  readonly rejectedProposals: number;
  readonly balanced: boolean;
}

export interface OpportunitySourceSection {
  readonly source: OpportunitySource;
  readonly presence: 'PRESENT' | 'ABSENT' | 'INVALID';
  readonly snapshotTimestamp: Readonly<OpportunitySourcedTimestamp> | null;
  readonly freshness: Readonly<OpportunityFreshnessReport> | null;
  readonly failure: Readonly<OpportunityStructuredFailure> | null;
  readonly decisions: readonly Readonly<CanonicalOpportunity>[];
  readonly proposals: readonly Readonly<CanonicalOpportunity>[];
  readonly rejects: readonly Readonly<OpportunityRejectedRecord>[];
  readonly reconciliation: Readonly<OpportunitySourceReconciliation>;
}

export interface OpportunitiesCanonicalView {
  readonly evaluatedAtMs: number;
  readonly correlationId: string;
  readonly basis: Readonly<OpportunitySourceSection>;
  readonly volume: Readonly<OpportunitySourceSection>;
  /**
   * Server-owned order. Consumers must not sort by edge, confidence, or any
   * other cross-strategy score.
   */
  readonly ordered: readonly Readonly<CanonicalOpportunity>[];
  readonly reconciliation: Readonly<{
    readonly inputRecords: number;
    readonly canonicalRecords: number;
    readonly duplicateRecords: number;
    readonly rejectedRecords: number;
    readonly balanced: boolean;
  }>;
}

export interface OpportunityIdentityAlias {
  readonly systemId: string;
  readonly owner: OpportunityIdentityOwner;
  readonly ownerId: string;
  readonly canonicalProjectionId: string | null;
  readonly correlationId: string;
  readonly revisionDigest: string | null;
}

export interface OpportunityDialectLoss {
  readonly code:
    | 'TRANSACTION_TIME_USED_AS_SOURCE_TIME'
    | 'TRANSACTION_TIME_NOT_REPRESENTABLE'
    | 'SEQUENCE_NOT_REPRESENTABLE'
    | 'SOURCE_TIME_UNAVAILABLE'
    | 'MAX_AGE_MISSING'
    | 'REVISION_UNAVAILABLE'
    | 'SOURCE_ID_DERIVED'
    | 'RUNTIME_SAMPLED_LOWER_BOUND'
    | 'RUNTIME_UNKNOWN_MAPPED_UNAVAILABLE'
    | 'MI_MISSING_MAPPED_UNAVAILABLE'
    | 'MI_UNKNOWN_MAPPED_UNAVAILABLE'
    | 'UPSTREAM_AUTHORITY_MISSING'
    | 'AUTHORITY_CONTEXT_MISMATCH'
    | 'OPERATOR_AUTHORITY_UNREPRESENTABLE'
    | 'UNKNOWN_AUTHORITY'
    | 'STALE_AUTHORITY_DOWNGRADED'
    | 'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE'
    | 'ORIGIN_FAILURE_DETAIL_REDACTED'
    | 'BINARY64_PROJECTION';
  readonly detail: string;
  readonly sourcePath: string | null;
  readonly targetPath: string | null;
}

export interface OpportunitiesOwnerOrder {
  readonly basis: Readonly<{
    readonly decisions: readonly string[];
    readonly proposals: readonly string[];
  }>;
  readonly volume: Readonly<{
    readonly decisions: readonly string[];
    readonly proposals: readonly string[];
  }>;
}

interface OpportunitiesReadAuthority {
  readonly maximumActionAuthority: 'ADVISORY';
  readonly capitalReservationAuthority: 'NONE';
  readonly executionAuthority: 'NONE';
}

export type OpportunitiesReadResult = Readonly<
  | (OpportunitiesReadAuthority & {
      readonly state: 'AVAILABLE' | 'DEGRADED';
      readonly evaluatedAtMs: number;
      readonly reasonCodes: readonly string[];
      readonly view: Readonly<OpportunitiesCanonicalView>;
      readonly identities: readonly Readonly<OpportunityIdentityAlias>[];
      readonly losses: readonly Readonly<OpportunityDialectLoss>[];
      readonly ownerOrderedCanonicalIds: Readonly<OpportunitiesOwnerOrder>;
    })
  | (OpportunitiesReadAuthority & {
      readonly state: 'UNAVAILABLE';
      readonly evaluatedAtMs: number | null;
      readonly reasonCodes: readonly string[];
      readonly view: null;
      readonly identities: readonly [];
      readonly losses: readonly Readonly<OpportunityDialectLoss>[];
      readonly ownerOrderedCanonicalIds: null;
    })
>;

export type OpportunitiesDecodeResult =
  | Readonly<{ ok: true; value: OpportunitiesReadResult }>
  | Readonly<{ ok: false; issues: readonly OpportunityValidationIssue[] }>;

const UTC_MAX_MS = 4_102_444_800_000;
const MAX_RECORDS = 10_000;
const MAX_REASONS = 2_000;
const MAX_IDENTITIES = 20_000;
const MAX_LOSSES = 2_000;
const MAX_EVIDENCE_NODES = 20_000;
const MAX_EVIDENCE_DEPTH = 32;
const CODE_RE = /^[A-Z][A-Z0-9_]{0,99}$/;
const DIALECT_LOSS_CODES: readonly OpportunityDialectLoss['code'][] = [
  'TRANSACTION_TIME_USED_AS_SOURCE_TIME',
  'TRANSACTION_TIME_NOT_REPRESENTABLE',
  'SEQUENCE_NOT_REPRESENTABLE',
  'SOURCE_TIME_UNAVAILABLE',
  'MAX_AGE_MISSING',
  'REVISION_UNAVAILABLE',
  'SOURCE_ID_DERIVED',
  'RUNTIME_SAMPLED_LOWER_BOUND',
  'RUNTIME_UNKNOWN_MAPPED_UNAVAILABLE',
  'MI_MISSING_MAPPED_UNAVAILABLE',
  'MI_UNKNOWN_MAPPED_UNAVAILABLE',
  'UPSTREAM_AUTHORITY_MISSING',
  'AUTHORITY_CONTEXT_MISMATCH',
  'OPERATOR_AUTHORITY_UNREPRESENTABLE',
  'UNKNOWN_AUTHORITY',
  'STALE_AUTHORITY_DOWNGRADED',
  'ORIGIN_FAILURE_FIELDS_RETAINED_IN_TRACE',
  'ORIGIN_FAILURE_DETAIL_REDACTED',
  'BINARY64_PROJECTION',
];
const REJECT_CODES: readonly OpportunityRejectedRecord['code'][] = [
  'PORT_RECORD_INVALID',
  'MALFORMED_TIMESTAMP',
  'EVIDENCE_INVALID',
  'CANONICAL_VALIDATION_FAILED',
  'CANONICAL_ID_CONFLICT',
  'SNAPSHOT_PROVENANCE_INVALID',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function isUtcMs(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    && value <= UTC_MAX_MS;
}

function hasOnly(
  value: Record<string, unknown>,
  keys: readonly string[],
  path: string,
  issues: OpportunityValidationIssue[],
): void {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.push({
        path: `${path}.${key}`,
        code: 'UNKNOWN_FIELD',
        message: `Unexpected field '${key}'.`,
      });
    }
  }
}

function issue(
  issues: OpportunityValidationIssue[],
  path: string,
  code: string,
  message: string,
): void {
  issues.push({ path, code, message });
}

function stringValue(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  maxLength = 1_000,
): value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength) {
    issue(issues, path, 'NON_EMPTY_STRING_REQUIRED', `Expected a non-empty string up to ${maxLength} characters.`);
    return false;
  }
  return true;
}

function nullableString(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  maxLength = 1_000,
): boolean {
  return value === null || stringValue(value, path, issues, maxLength);
}

function finiteNullable(value: unknown, path: string, issues: OpportunityValidationIssue[]): boolean {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
    issue(issues, path, 'FINITE_NUMBER_OR_NULL_REQUIRED', 'Expected a finite number or null.');
    return false;
  }
  return true;
}

function nonNegativeInteger(value: unknown, path: string, issues: OpportunityValidationIssue[]): boolean {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    issue(issues, path, 'NON_NEGATIVE_INTEGER_REQUIRED', 'Expected a non-negative safe integer.');
    return false;
  }
  return true;
}

function stringArray(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  max = MAX_REASONS,
): value is readonly string[] {
  if (!Array.isArray(value) || value.length > max) {
    issue(issues, path, 'BOUNDED_ARRAY_REQUIRED', `Expected an array of at most ${max} strings.`);
    return false;
  }
  value.forEach((entry, index) => stringValue(entry, `${path}[${index}]`, issues));
  return true;
}

function inspectJsonValue(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  budget: { nodes: number },
  seen: Set<object>,
  depth = 0,
): void {
  budget.nodes += 1;
  if (budget.nodes > MAX_EVIDENCE_NODES || depth > MAX_EVIDENCE_DEPTH) {
    issue(issues, path, 'EVIDENCE_BOUND_EXCEEDED', 'Evidence exceeds the frontend admission bound.');
    return;
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) issue(issues, path, 'FINITE_NUMBER_REQUIRED', 'Evidence numbers must be finite.');
    return;
  }
  if (typeof value !== 'object' || value === null) {
    issue(issues, path, 'PLAIN_JSON_REQUIRED', 'Evidence must contain plain JSON data only.');
    return;
  }
  if (seen.has(value)) {
    issue(issues, path, 'CYCLIC_VALUE_REJECTED', 'Cyclic evidence is not accepted.');
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_RECORDS) {
      issue(issues, path, 'ARRAY_BOUND_EXCEEDED', `Evidence arrays may contain at most ${MAX_RECORDS} values.`);
    } else {
      value.forEach((entry, index) => inspectJsonValue(entry, `${path}[${index}]`, issues, budget, seen, depth + 1));
    }
  } else if (!isRecord(value)) {
    issue(issues, path, 'PLAIN_JSON_REQUIRED', 'Evidence must contain plain objects only.');
  } else {
    const entries = Object.entries(value);
    if (entries.length > 1_000) {
      issue(issues, path, 'OBJECT_BOUND_EXCEEDED', 'Evidence objects may contain at most 1,000 keys.');
    } else {
      entries.forEach(([key, entry]) => inspectJsonValue(entry, `${path}.${key}`, issues, budget, seen, depth + 1));
    }
  }
  seen.delete(value);
}

function inspectTimestamp(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a sourced timestamp.');
    return;
  }
  hasOnly(value, ['sourceTimeMs', 'receivedAtMs', 'maxAgeMs', 'authority', 'completeness', 'sourceId'], path, issues);
  if (value.sourceTimeMs !== null && !isUtcMs(value.sourceTimeMs)) {
    issue(issues, `${path}.sourceTimeMs`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds or null.');
  }
  if (!isUtcMs(value.receivedAtMs)) {
    issue(issues, `${path}.receivedAtMs`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds.');
  }
  if (typeof value.maxAgeMs !== 'number' || !Number.isSafeInteger(value.maxAgeMs) || value.maxAgeMs <= 0) {
    issue(issues, `${path}.maxAgeMs`, 'POSITIVE_INTEGER_REQUIRED', 'Expected a positive safe integer.');
  }
  if (!OPPORTUNITY_AUTHORITIES.includes(value.authority as OpportunityDataAuthority)) {
    issue(issues, `${path}.authority`, 'AUTHORITY_INVALID', 'Unknown data authority.');
  }
  if (!['COMPLETE', 'PARTIAL', 'UNAVAILABLE'].includes(String(value.completeness))) {
    issue(issues, `${path}.completeness`, 'COMPLETENESS_INVALID', 'Unknown completeness state.');
  }
  stringValue(value.sourceId, `${path}.sourceId`, issues, 200);
}

function inspectFreshness(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a freshness report.');
    return;
  }
  hasOnly(value, ['state', 'ageMs', 'basis', 'effectiveAuthority', 'evaluatedAt'], path, issues);
  if (!OPPORTUNITY_FRESHNESS_STATES.includes(value.state as OpportunityFreshnessState)) {
    issue(issues, `${path}.state`, 'FRESHNESS_INVALID', 'Unknown freshness state.');
  }
  finiteNullable(value.ageMs, `${path}.ageMs`, issues);
  if (!['SOURCE_TIME', 'RECEIPT_TIME', 'NONE'].includes(String(value.basis))) {
    issue(issues, `${path}.basis`, 'FRESHNESS_BASIS_INVALID', 'Unknown freshness basis.');
  }
  if (!OPPORTUNITY_AUTHORITIES.includes(value.effectiveAuthority as OpportunityDataAuthority)) {
    issue(issues, `${path}.effectiveAuthority`, 'AUTHORITY_INVALID', 'Unknown effective authority.');
  }
  if (!isUtcMs(value.evaluatedAt)) {
    issue(issues, `${path}.evaluatedAt`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds.');
  }
}

function inspectCanonical(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  expectedKind?: 'DECISION' | 'PROPOSAL',
  expectedSource?: OpportunitySource,
): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a canonical opportunity.');
    return;
  }
  hasOnly(value, [
    'kind', 'canonicalId', 'source', 'sourceId', 'symbol', 'direction', 'lifecycle',
    'sourceLifecycle', 'observedAt', 'expiresAtMs', 'sourceLocalRank', 'netEdgePct',
    'confidence', 'borrowState', 'evidence', 'rejectionReasons', 'configVersion',
  ], path, issues);
  if (!['DECISION', 'PROPOSAL'].includes(String(value.kind)) || (expectedKind && value.kind !== expectedKind)) {
    issue(issues, `${path}.kind`, 'KIND_INVALID', `Expected ${expectedKind ?? 'DECISION or PROPOSAL'}.`);
  }
  stringValue(value.canonicalId, `${path}.canonicalId`, issues, 300);
  if (!OPPORTUNITY_SOURCES.includes(value.source as OpportunitySource) || (expectedSource && value.source !== expectedSource)) {
    issue(issues, `${path}.source`, 'SOURCE_INVALID', `Expected ${expectedSource ?? 'BASIS or VOLUME'}.`);
  }
  stringValue(value.sourceId, `${path}.sourceId`, issues, 300);
  stringValue(value.symbol, `${path}.symbol`, issues, 64);
  stringValue(value.direction, `${path}.direction`, issues, 128);
  if (!OPPORTUNITY_LIFECYCLES.includes(value.lifecycle as OpportunityLifecycle)) {
    issue(issues, `${path}.lifecycle`, 'LIFECYCLE_INVALID', 'Unknown canonical lifecycle.');
  }
  stringValue(value.sourceLifecycle, `${path}.sourceLifecycle`, issues, 128);
  inspectTimestamp(value.observedAt, `${path}.observedAt`, issues);
  if (value.expiresAtMs !== null && !isUtcMs(value.expiresAtMs)) {
    issue(issues, `${path}.expiresAtMs`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds or null.');
  }
  if (value.sourceLocalRank !== null) nonNegativeInteger(value.sourceLocalRank, `${path}.sourceLocalRank`, issues);
  finiteNullable(value.netEdgePct, `${path}.netEdgePct`, issues);
  if (
    value.confidence !== null
    && (typeof value.confidence !== 'number'
      || !Number.isFinite(value.confidence)
      || value.confidence < 0
      || value.confidence > 1)
  ) {
    issue(issues, `${path}.confidence`, 'CONFIDENCE_INVALID', 'Expected confidence in [0,1] or null.');
  }
  stringValue(value.borrowState, `${path}.borrowState`, issues, 64);
  if (value.evidence !== null) {
    if (!isRecord(value.evidence)) {
      issue(issues, `${path}.evidence`, 'PLAIN_OBJECT_REQUIRED', 'Expected a plain object or null.');
    } else {
      inspectJsonValue(value.evidence, `${path}.evidence`, issues, { nodes: 0 }, new Set());
    }
  }
  stringArray(value.rejectionReasons, `${path}.rejectionReasons`, issues);
  nullableString(value.configVersion, `${path}.configVersion`, issues, 300);
}

function inspectFailure(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a structured failure.');
    return;
  }
  hasOnly(value, [
    'component', 'stage', 'code', 'message', 'occurredAt', 'retryable',
    'safeCurrentState', 'recommendedOperatorAction', 'correlationId',
  ], path, issues);
  stringValue(value.component, `${path}.component`, issues, 200);
  stringValue(value.stage, `${path}.stage`, issues, 200);
  if (typeof value.code !== 'string' || !CODE_RE.test(value.code)) {
    issue(issues, `${path}.code`, 'CODE_INVALID', 'Expected an upper-snake machine code.');
  }
  stringValue(value.message, `${path}.message`, issues, 10_000);
  if (!isUtcMs(value.occurredAt)) issue(issues, `${path}.occurredAt`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds.');
  if (typeof value.retryable !== 'boolean') issue(issues, `${path}.retryable`, 'BOOLEAN_REQUIRED', 'Expected a boolean.');
  stringValue(value.safeCurrentState, `${path}.safeCurrentState`, issues, 200);
  stringValue(value.recommendedOperatorAction, `${path}.recommendedOperatorAction`, issues, 500);
  stringValue(value.correlationId, `${path}.correlationId`, issues, 128);
}

function inspectValidationIssue(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a validation issue.');
    return;
  }
  hasOnly(value, ['path', 'code', 'message'], path, issues);
  if (typeof value.path !== 'string' || value.path.length > 2_000) {
    issue(issues, `${path}.path`, 'STRING_REQUIRED', 'Expected a bounded path string.');
  }
  stringValue(value.code, `${path}.code`, issues, 200);
  stringValue(value.message, `${path}.message`, issues, 10_000);
}

function inspectReject(
  value: unknown,
  path: string,
  issues: OpportunityValidationIssue[],
  expectedSource: OpportunitySource,
): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a rejected record.');
    return;
  }
  hasOnly(value, ['kind', 'source', 'sourceKey', 'symbol', 'code', 'issues'], path, issues);
  if (!['DECISION', 'PROPOSAL'].includes(String(value.kind))) issue(issues, `${path}.kind`, 'KIND_INVALID', 'Unknown kind.');
  if (value.source !== expectedSource) issue(issues, `${path}.source`, 'SOURCE_INVALID', `Expected ${expectedSource}.`);
  stringValue(value.sourceKey, `${path}.sourceKey`, issues, 300);
  nullableString(value.symbol, `${path}.symbol`, issues, 64);
  if (!REJECT_CODES.includes(value.code as OpportunityRejectedRecord['code'])) {
    issue(issues, `${path}.code`, 'REJECT_CODE_INVALID', 'Unknown read-model reject code.');
  }
  if (!Array.isArray(value.issues) || value.issues.length > MAX_REASONS) {
    issue(issues, `${path}.issues`, 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_REASONS} validation issues.`);
  } else {
    value.issues.forEach((entry, index) => inspectValidationIssue(entry, `${path}.issues[${index}]`, issues));
  }
}

function inspectReconciliation(
  value: unknown,
  path: string,
  keys: readonly string[],
  issues: OpportunityValidationIssue[],
): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a reconciliation record.');
    return;
  }
  hasOnly(value, [...keys, 'balanced'], path, issues);
  keys.forEach((key) => nonNegativeInteger(value[key], `${path}.${key}`, issues));
  if (typeof value.balanced !== 'boolean') issue(issues, `${path}.balanced`, 'BOOLEAN_REQUIRED', 'Expected a boolean.');
}

function inspectSection(
  value: unknown,
  path: string,
  source: OpportunitySource,
  issues: OpportunityValidationIssue[],
): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected an opportunity source section.');
    return;
  }
  hasOnly(value, [
    'source', 'presence', 'snapshotTimestamp', 'freshness', 'failure',
    'decisions', 'proposals', 'rejects', 'reconciliation',
  ], path, issues);
  if (value.source !== source) issue(issues, `${path}.source`, 'SOURCE_INVALID', `Expected ${source}.`);
  if (!['PRESENT', 'ABSENT', 'INVALID'].includes(String(value.presence))) {
    issue(issues, `${path}.presence`, 'PRESENCE_INVALID', 'Unknown source presence.');
  }
  if (value.snapshotTimestamp !== null) inspectTimestamp(value.snapshotTimestamp, `${path}.snapshotTimestamp`, issues);
  if (value.freshness !== null) inspectFreshness(value.freshness, `${path}.freshness`, issues);
  if (value.failure !== null) inspectFailure(value.failure, `${path}.failure`, issues);
  if (value.presence === 'PRESENT' && (value.snapshotTimestamp === null || value.freshness === null)) {
    issue(issues, path, 'PRESENT_PROVENANCE_REQUIRED', 'Present sources require timestamp and freshness.');
  }
  if (value.presence !== 'PRESENT' && (value.snapshotTimestamp !== null || value.freshness !== null)) {
    issue(issues, path, 'NON_PRESENT_PROVENANCE_REJECTED', 'Absent or invalid sources cannot claim snapshot provenance.');
  }
  const arrays: readonly ['decisions' | 'proposals', 'DECISION' | 'PROPOSAL'][] = [
    ['decisions', 'DECISION'],
    ['proposals', 'PROPOSAL'],
  ];
  arrays.forEach(([key, kind]) => {
    const rows = value[key];
    if (!Array.isArray(rows) || rows.length > MAX_RECORDS) {
      issue(issues, `${path}.${key}`, 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_RECORDS} records.`);
    } else {
      rows.forEach((row, index) => inspectCanonical(row, `${path}.${key}[${index}]`, issues, kind, source));
    }
  });
  if (!Array.isArray(value.rejects) || value.rejects.length > MAX_RECORDS) {
    issue(issues, `${path}.rejects`, 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_RECORDS} rejects.`);
  } else {
    value.rejects.forEach((row, index) => inspectReject(row, `${path}.rejects[${index}]`, issues, source));
  }
  inspectReconciliation(value.reconciliation, `${path}.reconciliation`, [
    'inputDecisions',
    'inputProposals',
    'canonicalDecisions',
    'canonicalProposals',
    'duplicateDecisions',
    'duplicateProposals',
    'rejectedDecisions',
    'rejectedProposals',
  ], issues);
}

function inspectView(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a canonical read-model view.');
    return;
  }
  hasOnly(value, ['evaluatedAtMs', 'correlationId', 'basis', 'volume', 'ordered', 'reconciliation'], path, issues);
  if (!isUtcMs(value.evaluatedAtMs)) issue(issues, `${path}.evaluatedAtMs`, 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds.');
  stringValue(value.correlationId, `${path}.correlationId`, issues, 128);
  inspectSection(value.basis, `${path}.basis`, 'BASIS', issues);
  inspectSection(value.volume, `${path}.volume`, 'VOLUME', issues);
  if (!Array.isArray(value.ordered) || value.ordered.length > MAX_RECORDS) {
    issue(issues, `${path}.ordered`, 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_RECORDS} ordered records.`);
  } else {
    const ids = new Set<string>();
    value.ordered.forEach((row, index) => {
      inspectCanonical(row, `${path}.ordered[${index}]`, issues);
      if (isRecord(row) && typeof row.canonicalId === 'string') {
        if (ids.has(row.canonicalId)) issue(issues, `${path}.ordered[${index}].canonicalId`, 'DUPLICATE_CANONICAL_ID', 'Ordered IDs must be unique.');
        ids.add(row.canonicalId);
      }
    });
  }
  inspectReconciliation(value.reconciliation, `${path}.reconciliation`, [
    'inputRecords',
    'canonicalRecords',
    'duplicateRecords',
    'rejectedRecords',
  ], issues);
}

function inspectIdentity(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected an opaque identity alias.');
    return;
  }
  hasOnly(value, ['systemId', 'owner', 'ownerId', 'canonicalProjectionId', 'correlationId', 'revisionDigest'], path, issues);
  stringValue(value.systemId, `${path}.systemId`, issues, 300);
  if (!OPPORTUNITY_IDENTITY_OWNERS.includes(value.owner as OpportunityIdentityOwner)) {
    issue(issues, `${path}.owner`, 'IDENTITY_OWNER_INVALID', 'Unknown identity owner.');
  }
  stringValue(value.ownerId, `${path}.ownerId`, issues, 300);
  nullableString(value.canonicalProjectionId, `${path}.canonicalProjectionId`, issues, 300);
  stringValue(value.correlationId, `${path}.correlationId`, issues, 128);
  nullableString(value.revisionDigest, `${path}.revisionDigest`, issues, 300);
}

function inspectLoss(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected a dialect loss.');
    return;
  }
  hasOnly(value, ['code', 'detail', 'sourcePath', 'targetPath'], path, issues);
  if (!DIALECT_LOSS_CODES.includes(value.code as OpportunityDialectLoss['code'])) {
    issue(issues, `${path}.code`, 'DIALECT_LOSS_CODE_INVALID', 'Unknown dialect loss code.');
  }
  stringValue(value.detail, `${path}.detail`, issues, 10_000);
  nullableString(value.sourcePath, `${path}.sourcePath`, issues, 2_000);
  nullableString(value.targetPath, `${path}.targetPath`, issues, 2_000);
}

function inspectOwnerOrder(value: unknown, path: string, issues: OpportunityValidationIssue[]): void {
  if (!isRecord(value)) {
    issue(issues, path, 'OBJECT_REQUIRED', 'Expected owner-ordered canonical IDs.');
    return;
  }
  hasOnly(value, ['basis', 'volume'], path, issues);
  (['basis', 'volume'] as const).forEach((source) => {
    const section = value[source];
    if (!isRecord(section)) {
      issue(issues, `${path}.${source}`, 'OBJECT_REQUIRED', 'Expected decisions and proposals arrays.');
      return;
    }
    hasOnly(section, ['decisions', 'proposals'], `${path}.${source}`, issues);
    stringArray(section.decisions, `${path}.${source}.decisions`, issues, MAX_RECORDS);
    stringArray(section.proposals, `${path}.${source}.proposals`, issues, MAX_RECORDS);
  });
}

function samePlainValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((entry, index) => samePlainValue(entry, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => (
      key === rightKeys[index] && samePlainValue(left[key], right[key])
    ));
}

function cloneAndFreeze<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((entry) => cloneAndFreeze(entry))) as T;
  }
  if (!isRecord(value)) return value;
  const copy: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) copy[key] = cloneAndFreeze(entry);
  return Object.freeze(copy) as T;
}

function reconciliationMatches(
  record: Record<string, unknown>,
  inputKey: string,
  canonicalKey: string,
  duplicateKey: string,
  rejectedKey: string,
): boolean {
  return record[inputKey] === (
    Number(record[canonicalKey])
    + Number(record[duplicateKey])
    + Number(record[rejectedKey])
  );
}

function inspectFreshnessCoherence(
  section: Record<string, unknown>,
  path: string,
  evaluatedAtMs: number,
  issues: OpportunityValidationIssue[],
): void {
  if (section.presence !== 'PRESENT'
      || !isRecord(section.snapshotTimestamp)
      || !isRecord(section.freshness)) return;

  const timestamp = section.snapshotTimestamp;
  const freshness = section.freshness;
  if (freshness.evaluatedAt !== evaluatedAtMs) {
    issue(issues, `${path}.freshness.evaluatedAt`, 'FRESHNESS_EVALUATION_TIME_MISMATCH', 'Freshness must use the view evaluation time.');
  }

  const unavailableTimestamp = timestamp.completeness === 'UNAVAILABLE'
    || timestamp.authority === 'UNAVAILABLE';
  const sourceTimeMs = timestamp.sourceTimeMs as number | null;
  const basis = sourceTimeMs === null ? 'RECEIPT_TIME' : 'SOURCE_TIME';
  const basisTime = sourceTimeMs ?? (timestamp.receivedAtMs as number);
  const ageMs = evaluatedAtMs - basisTime;
  const expectedState: OpportunityFreshnessState = unavailableTimestamp
    ? 'UNAVAILABLE'
    : ageMs < -2_000
      ? 'CLOCK_SKEWED'
      : ageMs <= Number(timestamp.maxAgeMs)
        ? 'FRESH'
        : 'STALE';
  const expectedBasis = unavailableTimestamp ? 'NONE' : basis;
  const expectedAge = unavailableTimestamp ? null : ageMs;
  const expectedAuthority = expectedState === 'FRESH'
    ? timestamp.authority
    : 'UNAVAILABLE';

  if (freshness.state !== expectedState
      || freshness.basis !== expectedBasis
      || !Object.is(freshness.ageMs, expectedAge)
      || freshness.effectiveAuthority !== expectedAuthority) {
    issue(
      issues,
      `${path}.freshness`,
      'FRESHNESS_PROVENANCE_CONTRADICTION',
      'Freshness state, age, basis, and effective authority must match snapshot provenance.',
    );
  }
}

function inspectSourceReconciliationCoherence(
  section: Record<string, unknown>,
  path: string,
  issues: OpportunityValidationIssue[],
): void {
  if (!Array.isArray(section.decisions)
      || !Array.isArray(section.proposals)
      || !Array.isArray(section.rejects)
      || !isRecord(section.reconciliation)) return;

  const reconciliation = section.reconciliation;
  const rejectedDecisions = section.rejects.filter(
    (row) => isRecord(row) && row.kind === 'DECISION',
  ).length;
  const rejectedProposals = section.rejects.filter(
    (row) => isRecord(row) && row.kind === 'PROPOSAL',
  ).length;

  if (reconciliation.canonicalDecisions !== section.decisions.length
      || reconciliation.canonicalProposals !== section.proposals.length
      || reconciliation.rejectedDecisions !== rejectedDecisions
      || reconciliation.rejectedProposals !== rejectedProposals) {
    issue(
      issues,
      `${path}.reconciliation`,
      'SOURCE_RECONCILIATION_COUNT_MISMATCH',
      'Source reconciliation counts must match the records that are present.',
    );
  }

  const balanced = reconciliationMatches(
    reconciliation,
    'inputDecisions',
    'canonicalDecisions',
    'duplicateDecisions',
    'rejectedDecisions',
  ) && reconciliationMatches(
    reconciliation,
    'inputProposals',
    'canonicalProposals',
    'duplicateProposals',
    'rejectedProposals',
  );
  if (reconciliation.balanced !== balanced) {
    issue(
      issues,
      `${path}.reconciliation.balanced`,
      'SOURCE_RECONCILIATION_FLAG_MISMATCH',
      'The balanced flag must describe the published counts.',
    );
  }
}

function inspectProjectionCoherence(
  input: Record<string, unknown>,
  issues: OpportunityValidationIssue[],
): void {
  if (!isRecord(input.view)
      || !isRecord(input.view.basis)
      || !isRecord(input.view.volume)
      || !Array.isArray(input.view.ordered)
      || !isRecord(input.view.reconciliation)
      || !Array.isArray(input.identities)
      || !isRecord(input.ownerOrderedCanonicalIds)) return;

  const view = input.view as Record<string, unknown>;
  const basisSection = view.basis as Record<string, unknown>;
  const volumeSection = view.volume as Record<string, unknown>;
  const ordered = view.ordered as unknown[];
  const viewReconciliation = view.reconciliation as Record<string, unknown>;
  const identities = input.identities as unknown[];
  const ownerOrder = input.ownerOrderedCanonicalIds as Record<string, unknown>;
  const evaluatedAtMs = view.evaluatedAtMs as number;
  const sections = [
    { key: 'basis', source: 'BASIS', value: basisSection },
    { key: 'volume', source: 'VOLUME', value: volumeSection },
  ] as const;

  for (const section of sections) {
    inspectFreshnessCoherence(
      section.value,
      `$.view.${section.key}`,
      evaluatedAtMs,
      issues,
    );
    inspectSourceReconciliationCoherence(
      section.value,
      `$.view.${section.key}`,
      issues,
    );
  }

  if (input.state === 'AVAILABLE') {
    const fresh = sections.every(({ value }) => (
      value.presence === 'PRESENT'
      && isRecord(value.freshness)
      && value.freshness.state === 'FRESH'
    ));
    if (!fresh) {
      issue(
        issues,
        '$.state',
        'AVAILABLE_REQUIRES_FRESH_SOURCES',
        'AVAILABLE requires present, fresh Basis and Volume sources.',
      );
    }
    if (Array.isArray(input.reasonCodes) && input.reasonCodes.length !== 0) {
      issue(issues, '$.reasonCodes', 'AVAILABLE_REASONS_MUST_BE_EMPTY', 'AVAILABLE cannot carry degradation reasons.');
    }
    const sourceClean = sections.every(({ value }) => (
      value.failure === null
      && Array.isArray(value.rejects)
      && value.rejects.length === 0
      && isRecord(value.reconciliation)
      && value.reconciliation.balanced === true
    ));
    if (!sourceClean || viewReconciliation.balanced !== true) {
      issue(
        issues,
        '$.state',
        'AVAILABLE_CONTRADICTS_RECONCILIATION',
        'AVAILABLE requires clean, balanced source and view reconciliation.',
      );
    }
  } else if (input.state === 'DEGRADED') {
    if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length === 0) {
      issue(issues, '$.reasonCodes', 'DEGRADED_REQUIRES_REASON', 'DEGRADED requires at least one named reason.');
    }
  }

  const sectionRows: Record<string, unknown>[] = [];
  for (const { value } of sections) {
    if (Array.isArray(value.decisions)) sectionRows.push(...value.decisions.filter(isRecord));
    if (Array.isArray(value.proposals)) sectionRows.push(...value.proposals.filter(isRecord));
  }
  const sectionById = new Map<string, Record<string, unknown>>();
  for (const row of sectionRows) {
    const id = row.canonicalId as string;
    if (sectionById.has(id)) {
      issue(issues, '$.view', 'CANONICAL_ID_DUPLICATED_ACROSS_SECTIONS', `Canonical ID '${id}' appears more than once.`);
    } else {
      sectionById.set(id, row);
    }
  }

  if (ordered.length !== sectionRows.length) {
    issue(issues, '$.view.ordered', 'ORDERED_RECORD_COUNT_MISMATCH', 'Ordered records must exactly cover both source sections.');
  }
  const orderedIds = new Set<string>();
  for (const [index, row] of ordered.entries()) {
    if (!isRecord(row)) continue;
    const id = row.canonicalId as string;
    if (orderedIds.has(id)) {
      issue(issues, `$.view.ordered[${index}].canonicalId`, 'DUPLICATE_CANONICAL_ID', 'Ordered IDs must be unique.');
    }
    orderedIds.add(id);
    const sectionRow = sectionById.get(id);
    if (sectionRow === undefined || !samePlainValue(sectionRow, row)) {
      issue(
        issues,
        `$.view.ordered[${index}]`,
        'ORDERED_RECORD_BINDING_MISMATCH',
        'Each ordered row must exactly match one row in its source section.',
      );
    }
  }

  const sourceInputRecords = sections.reduce((sum, { value }) => {
    const reconciliation = value.reconciliation;
    return sum + (isRecord(reconciliation)
      ? Number(reconciliation.inputDecisions) + Number(reconciliation.inputProposals)
      : 0);
  }, 0);
  const sourceDuplicateRecords = sections.reduce((sum, { value }) => {
    const reconciliation = value.reconciliation;
    return sum + (isRecord(reconciliation)
      ? Number(reconciliation.duplicateDecisions) + Number(reconciliation.duplicateProposals)
      : 0);
  }, 0);
  const sourceRejectedRecords = sections.reduce((sum, { value }) => (
    sum + (Array.isArray(value.rejects) ? value.rejects.length : 0)
  ), 0);
  const reconciliation = viewReconciliation;
  if (reconciliation.inputRecords !== sourceInputRecords
      || reconciliation.canonicalRecords !== sectionRows.length
      || reconciliation.duplicateRecords !== sourceDuplicateRecords
      || reconciliation.rejectedRecords !== sourceRejectedRecords) {
    issue(
      issues,
      '$.view.reconciliation',
      'VIEW_RECONCILIATION_COUNT_MISMATCH',
      'View reconciliation must equal the two published source sections.',
    );
  }
  const viewBalanced = reconciliationMatches(
    reconciliation,
    'inputRecords',
    'canonicalRecords',
    'duplicateRecords',
    'rejectedRecords',
  );
  if (reconciliation.balanced !== viewBalanced) {
    issue(
      issues,
      '$.view.reconciliation.balanced',
      'VIEW_RECONCILIATION_FLAG_MISMATCH',
      'The view balanced flag must describe the published counts.',
    );
  }

  const ownerEntries = [
    { sourceKey: 'basis', source: 'BASIS', kindKey: 'decisions', kind: 'DECISION' },
    { sourceKey: 'basis', source: 'BASIS', kindKey: 'proposals', kind: 'PROPOSAL' },
    { sourceKey: 'volume', source: 'VOLUME', kindKey: 'decisions', kind: 'DECISION' },
    { sourceKey: 'volume', source: 'VOLUME', kindKey: 'proposals', kind: 'PROPOSAL' },
  ] as const;
  const ownerBoundIds = new Set<string>();
  for (const entry of ownerEntries) {
    const ownerSource = ownerOrder[entry.sourceKey];
    if (!isRecord(ownerSource) || !Array.isArray(ownerSource[entry.kindKey])) continue;
    const ids = ownerSource[entry.kindKey] as unknown[];
    for (const rawId of ids) {
      if (typeof rawId !== 'string') continue;
      const id = rawId;
      const row = sectionById.get(id);
      if (ownerBoundIds.has(id)
          || row === undefined
          || row.source !== entry.source
          || row.kind !== entry.kind) {
        issue(
          issues,
          `$.ownerOrderedCanonicalIds.${entry.sourceKey}.${entry.kindKey}`,
          'OWNER_ORDER_BINDING_MISMATCH',
          'Owner order must bind every canonical ID exactly once to its source and kind.',
        );
      }
      ownerBoundIds.add(id);
    }
  }
  if (ownerBoundIds.size !== sectionById.size) {
    issue(
      issues,
      '$.ownerOrderedCanonicalIds',
      'OWNER_ORDER_INCOMPLETE',
      'Owner order must cover every canonical record exactly once.',
    );
  }

  const identityIds = new Set<string>();
  for (const [index, identity] of identities.entries()) {
    if (!isRecord(identity) || typeof identity.canonicalProjectionId !== 'string') continue;
    const id = identity.canonicalProjectionId;
    const row = sectionById.get(id);
    const expectedOwner = row?.source === 'BASIS' ? 'BASIS_ENGINE' : 'VOLUME_ENGINE';
    if (identityIds.has(id)
        || row === undefined
        || identity.owner !== expectedOwner
        || identity.ownerId !== row.sourceId
        || identity.correlationId !== view.correlationId) {
      issue(
        issues,
        `$.identities[${index}]`,
        'IDENTITY_BINDING_MISMATCH',
        'Identity aliases must bind exactly to canonical source records.',
      );
    }
    identityIds.add(id);
  }
  if (identityIds.size !== sectionById.size) {
    issue(
      issues,
      '$.identities',
      'IDENTITY_BINDING_INCOMPLETE',
      'Identity aliases must cover every canonical record exactly once.',
    );
  }
}

/**
 * Strictly admits an ordinary-data read result. Unknown fields and malformed
 * nested records fail the whole boundary; callers must then render
 * UNAVAILABLE rather than partially trusting the payload.
 */
export function decodeOpportunitiesReadResult(input: unknown): OpportunitiesDecodeResult {
  const issues: OpportunityValidationIssue[] = [];
  if (!isRecord(input)) {
    return Object.freeze({
      ok: false,
      issues: Object.freeze([{
        path: '$',
        code: 'OBJECT_REQUIRED',
        message: 'Expected a ProductionOpportunitiesReadResult object.',
      }]),
    });
  }
  hasOnly(input, [
    'maximumActionAuthority',
    'capitalReservationAuthority',
    'executionAuthority',
    'state',
    'evaluatedAtMs',
    'reasonCodes',
    'view',
    'identities',
    'losses',
    'ownerOrderedCanonicalIds',
  ], '$', issues);
  if (input.maximumActionAuthority !== 'ADVISORY') {
    issue(issues, '$.maximumActionAuthority', 'AUTHORITY_INVALID', 'Maximum action authority must be ADVISORY.');
  }
  if (input.capitalReservationAuthority !== 'NONE') {
    issue(issues, '$.capitalReservationAuthority', 'AUTHORITY_INVALID', 'Capital reservation authority must be NONE.');
  }
  if (input.executionAuthority !== 'NONE') {
    issue(issues, '$.executionAuthority', 'AUTHORITY_INVALID', 'Execution authority must be NONE.');
  }
  if (!['AVAILABLE', 'DEGRADED', 'UNAVAILABLE'].includes(String(input.state))) {
    issue(issues, '$.state', 'STATE_INVALID', 'Unknown Opportunities read state.');
  }
  stringArray(input.reasonCodes, '$.reasonCodes', issues);
  if (!Array.isArray(input.losses) || input.losses.length > MAX_LOSSES) {
    issue(issues, '$.losses', 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_LOSSES} dialect losses.`);
  } else {
    input.losses.forEach((value, index) => inspectLoss(value, `$.losses[${index}]`, issues));
  }

  if (input.state === 'UNAVAILABLE') {
    if (input.evaluatedAtMs !== null && !isUtcMs(input.evaluatedAtMs)) {
      issue(issues, '$.evaluatedAtMs', 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds or null.');
    }
    if (input.view !== null) issue(issues, '$.view', 'UNAVAILABLE_VIEW_MUST_BE_NULL', 'Unavailable results cannot carry a view.');
    if (!Array.isArray(input.identities) || input.identities.length !== 0) {
      issue(issues, '$.identities', 'UNAVAILABLE_IDENTITIES_MUST_BE_EMPTY', 'Unavailable results cannot carry identities.');
    }
    if (input.ownerOrderedCanonicalIds !== null) {
      issue(issues, '$.ownerOrderedCanonicalIds', 'UNAVAILABLE_OWNER_ORDER_MUST_BE_NULL', 'Unavailable results cannot carry owner order.');
    }
    if (!Array.isArray(input.reasonCodes) || input.reasonCodes.length === 0) {
      issue(issues, '$.reasonCodes', 'UNAVAILABLE_REQUIRES_REASON', 'UNAVAILABLE requires at least one named reason.');
    }
  } else if (input.state === 'AVAILABLE' || input.state === 'DEGRADED') {
    if (!isUtcMs(input.evaluatedAtMs)) issue(issues, '$.evaluatedAtMs', 'UTC_MILLIS_INVALID', 'Expected UTC milliseconds.');
    inspectView(input.view, '$.view', issues);
    if (isRecord(input.view) && input.view.evaluatedAtMs !== input.evaluatedAtMs) {
      issue(issues, '$.view.evaluatedAtMs', 'EVALUATION_TIME_MISMATCH', 'View and result evaluation times must match.');
    }
    if (!Array.isArray(input.identities) || input.identities.length > MAX_IDENTITIES) {
      issue(issues, '$.identities', 'BOUNDED_ARRAY_REQUIRED', `Expected at most ${MAX_IDENTITIES} identities.`);
    } else {
      input.identities.forEach((value, index) => inspectIdentity(value, `$.identities[${index}]`, issues));
    }
    inspectOwnerOrder(input.ownerOrderedCanonicalIds, '$.ownerOrderedCanonicalIds', issues);
  }

  if (issues.length === 0 && input.state !== 'UNAVAILABLE') {
    inspectProjectionCoherence(input, issues);
  }
  if (issues.length > 0) {
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }
  return Object.freeze({
    ok: true,
    value: cloneAndFreeze(input) as unknown as OpportunitiesReadResult,
  });
}
