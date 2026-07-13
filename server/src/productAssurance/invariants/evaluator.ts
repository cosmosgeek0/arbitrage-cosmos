import {
  ASSURANCE_SEVERITIES,
  assertIdentifier,
  assertPositiveSafeInteger,
  assertSafeNonNegativeInteger,
  assertUtcMs,
  evaluateEvidenceBinding,
  evaluateEvidenceRef,
  isPlainRecord,
  sortedUnique,
  verdictFromReasons,
  type AssuranceEvidenceRef,
  type AssuranceEvidenceBinding,
  type AssuranceSeverity,
  type AssuranceVerdict,
} from '../common.js';

export const INVARIANT_FAMILIES = Object.freeze([
  'DURABLE_INTENT_AND_MUTATION_IDENTITY',
  'EXECUTION_FENCING_EPOCH',
  'RECONCILIATION_BEFORE_NEW_EXPOSURE',
  'SOURCE_FRESHNESS_COMPLETENESS_CONTINUITY',
  'LOCAL_EXCHANGE_TRUTH',
  'CAPITAL_EXPOSURE_LIMITS',
  'HALT_KILL_COVERAGE',
  'RISK_REDUCING_AVAILABILITY',
  'ONE_EXCHANGE_HAND_AND_LEASE',
  'WITHDRAWAL_TRANSFER_IMPOSSIBILITY',
  'TRUTH_REALM_SEPARATION',
  'INSTRUMENT_ACCOUNT_COMPATIBILITY',
  'DURABLE_ADVANCEMENT',
  'REVISION_COMPATIBILITY',
  'BACKUP_WATCHDOG_PROBE_FRESHNESS',
] as const);
export type InvariantFamily = (typeof INVARIANT_FAMILIES)[number];

export type AssuranceFactValue = boolean | number | string | null;

export interface AssuranceFact {
  readonly factId: string;
  readonly value: AssuranceFactValue;
  readonly evidence: Readonly<AssuranceEvidenceRef>;
  readonly evidenceBinding: Readonly<AssuranceEvidenceBinding>;
}

export interface InvariantEvidenceContext {
  readonly releaseId: string;
  readonly testedCommit: string;
}

export type InvariantRule =
  | { readonly kind: 'ALL_TRUE' }
  | { readonly kind: 'EXACTLY_ONE_TRUE' }
  | { readonly kind: 'EQUALS'; readonly expected: boolean | number | string }
  | { readonly kind: 'NOT_EQUALS'; readonly forbidden: boolean | number | string }
  | { readonly kind: 'LESS_THAN_OR_EQUAL'; readonly maximum: number }
  | { readonly kind: 'PRESENT' };

export interface SafetyInvariantDefinition {
  readonly schema: 'PRODUCT_ASSURANCE_INVARIANT_V1';
  readonly revision: number;
  readonly invariantId: string;
  readonly family: InvariantFamily;
  readonly ownerId: string;
  readonly expression: string;
  readonly factIds: readonly string[];
  readonly factOwnerIds: Readonly<Record<string, string>>;
  readonly rule: InvariantRule;
  readonly cadenceMs: number;
  readonly severity: AssuranceSeverity;
  readonly capitalRelevant: boolean;
  readonly missingDataBehavior: 'UNKNOWN_BLOCKS_TRADE_READINESS';
  readonly failSafeAction: string;
  readonly incidentId: string;
  readonly cockpitSurface: string;
  readonly repairControlId: string | null;
  readonly runbookId: string;
  readonly adversarialTestIds: readonly string[];
  readonly independentVerificationRequired: boolean;
}

export interface SafetyInvariantResult {
  readonly invariantId: string;
  readonly family: InvariantFamily;
  readonly verdict: AssuranceVerdict;
  readonly evaluatedAtMs: number;
  readonly reasonCodes: readonly string[];
  readonly evidenceIds: readonly string[];
  readonly capitalRelevant: boolean;
  readonly severity: AssuranceSeverity;
  readonly failSafeAction: string;
}

export interface InvariantCatalogProjection {
  readonly evaluatedAtMs: number;
  readonly results: readonly Readonly<SafetyInvariantResult>[];
  readonly counts: Readonly<Record<AssuranceVerdict, number>>;
  readonly tradeReadinessVerdict: AssuranceVerdict;
  readonly blockingInvariantIds: readonly string[];
  readonly unknownCriticalInvariantIds: readonly string[];
}

function validateDefinition(definition: Readonly<SafetyInvariantDefinition>): void {
  if (definition.schema !== 'PRODUCT_ASSURANCE_INVARIANT_V1') throw new TypeError('invariant schema unsupported');
  assertSafeNonNegativeInteger(definition.revision, 'definition.revision');
  assertIdentifier(definition.invariantId, 'definition.invariantId');
  assertIdentifier(definition.ownerId, 'definition.ownerId');
  assertPositiveSafeInteger(definition.cadenceMs, 'definition.cadenceMs');
  if (!(INVARIANT_FAMILIES as readonly string[]).includes(definition.family)) throw new TypeError('invariant family unsupported');
  if (!(ASSURANCE_SEVERITIES as readonly unknown[]).includes(definition.severity)) throw new TypeError('invariant severity unsupported');
  if (typeof definition.expression !== 'string' || definition.expression.trim().length === 0) throw new TypeError('invariant expression must be non-empty');
  if (definition.missingDataBehavior !== 'UNKNOWN_BLOCKS_TRADE_READINESS') throw new TypeError('invariant missing-data behavior unsupported');
  if (typeof definition.capitalRelevant !== 'boolean') throw new TypeError('invariant capitalRelevant must be boolean');
  if (typeof definition.independentVerificationRequired !== 'boolean') throw new TypeError('invariant independentVerificationRequired must be boolean');
  if (definition.factIds.length === 0) throw new TypeError('invariant requires at least one fact');
  if (new Set(definition.factIds).size !== definition.factIds.length) throw new TypeError('invariant factIds must be unique');
  for (const factId of definition.factIds) assertIdentifier(factId, 'definition.factId');
  const ownerKeys = Object.keys(definition.factOwnerIds).sort();
  const factKeys = [...definition.factIds].sort();
  if (ownerKeys.join('\n') !== factKeys.join('\n')) throw new TypeError('invariant factOwnerIds must bind every declared fact exactly once');
  for (const factId of definition.factIds) assertIdentifier(definition.factOwnerIds[factId], `definition.factOwnerIds.${factId}`);
  assertIdentifier(definition.failSafeAction, 'definition.failSafeAction');
  assertIdentifier(definition.incidentId, 'definition.incidentId');
  assertIdentifier(definition.cockpitSurface, 'definition.cockpitSurface');
  if (definition.repairControlId !== null) assertIdentifier(definition.repairControlId, 'definition.repairControlId');
  assertIdentifier(definition.runbookId, 'definition.runbookId');
  if (new Set(definition.adversarialTestIds).size !== definition.adversarialTestIds.length) {
    throw new TypeError('invariant adversarialTestIds must be unique');
  }
  for (const testId of definition.adversarialTestIds) assertIdentifier(testId, 'definition.adversarialTestId');
  validateRule(definition.rule);
}

function validateRule(rule: Readonly<InvariantRule>): void {
  if (!isPlainRecord(rule)) throw new TypeError('invariant rule must be a plain record');
  if (!['ALL_TRUE', 'EXACTLY_ONE_TRUE', 'EQUALS', 'NOT_EQUALS', 'LESS_THAN_OR_EQUAL', 'PRESENT'].includes(rule.kind)) {
    throw new TypeError('invariant rule kind unsupported');
  }
  if (rule.kind === 'EQUALS') validateComparableValue(rule.expected, 'rule.expected');
  if (rule.kind === 'NOT_EQUALS') validateComparableValue(rule.forbidden, 'rule.forbidden');
  if (rule.kind === 'LESS_THAN_OR_EQUAL' && !Number.isFinite(rule.maximum)) {
    throw new TypeError('rule.maximum must be finite');
  }
}

function validateComparableValue(value: unknown, label: string): asserts value is boolean | number | string {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
    return;
  }
  if (typeof value === 'string') {
    if (value.trim().length === 0 || value.length > 1_024) throw new TypeError(`${label} must be a non-empty bounded string`);
    return;
  }
  if (typeof value !== 'boolean') throw new TypeError(`${label} must be boolean, finite number, or non-empty string`);
}

function validateFacts(facts: readonly Readonly<AssuranceFact>[], nowMs: number): void {
  const ids = facts.map((fact) => fact.factId);
  if (new Set(ids).size !== ids.length) throw new TypeError('facts contain duplicate IDs');
  for (const fact of facts) {
    assertIdentifier(fact.factId, 'fact.factId');
    if (fact.value !== null) validateComparableValue(fact.value, `fact ${fact.factId}.value`);
    evaluateEvidenceRef(fact.evidence, nowMs, false);
  }
}

function rulePasses(rule: Readonly<InvariantRule>, values: readonly Exclude<AssuranceFactValue, null>[]): boolean {
  if (rule.kind === 'ALL_TRUE') return values.every((value) => value === true);
  if (rule.kind === 'EXACTLY_ONE_TRUE') return values.filter((value) => value === true).length === 1 && values.every((value) => typeof value === 'boolean');
  if (rule.kind === 'EQUALS') return values.length === 1 && values[0] === rule.expected;
  if (rule.kind === 'NOT_EQUALS') return values.every((value) => value !== rule.forbidden);
  if (rule.kind === 'LESS_THAN_OR_EQUAL') return values.length === 1 && typeof values[0] === 'number' && Number.isFinite(values[0]) && values[0] <= rule.maximum;
  return values.length > 0;
}

export function evaluateSafetyInvariant(
  definition: Readonly<SafetyInvariantDefinition>,
  facts: readonly Readonly<AssuranceFact>[],
  nowMs: number,
  evidenceContext: Readonly<InvariantEvidenceContext>,
): Readonly<SafetyInvariantResult> {
  validateDefinition(definition);
  assertUtcMs(nowMs, 'nowMs');
  assertIdentifier(evidenceContext.releaseId, 'evidenceContext.releaseId');
  if (!/^[a-f0-9]{40}$/u.test(evidenceContext.testedCommit)) {
    throw new TypeError('evidenceContext.testedCommit must be a full lowercase Git SHA-1');
  }
  validateFacts(facts, nowMs);
  const factById = new Map(facts.map((fact) => [fact.factId, fact]));
  const failReasons: string[] = [];
  const unknownReasons: string[] = [];
  const evidenceIds: string[] = [];
  const values: Exclude<AssuranceFactValue, null>[] = [];

  for (const factId of definition.factIds) {
    const fact = factById.get(factId);
    if (fact === undefined) {
      unknownReasons.push('REQUIRED_FACT_MISSING');
      continue;
    }
    assertIdentifier(fact.factId, 'fact.factId');
    const evidence = evaluateEvidenceRef(fact.evidence, nowMs, definition.independentVerificationRequired);
    const binding = evaluateEvidenceBinding(fact.evidence, fact.evidenceBinding, {
      ownerId: definition.factOwnerIds[factId],
      releaseId: evidenceContext.releaseId,
      testedCommit: evidenceContext.testedCommit,
      subjectId: `INVARIANT:${definition.invariantId}:FACT:${factId}`,
      evidenceDigest: fact.evidence.digest ?? '',
    });
    evidenceIds.push(...evidence.evidenceIds);
    if (evidence.verdict === 'FAIL') failReasons.push(...evidence.reasonCodes);
    if (evidence.verdict === 'UNKNOWN') unknownReasons.push(...evidence.reasonCodes);
    if (binding.verdict === 'FAIL') failReasons.push(...binding.reasonCodes);
    if (fact.evidence.ownerId !== definition.factOwnerIds[factId]) failReasons.push('FACT_CANONICAL_OWNER_MISMATCH');
    if (fact.value === null) unknownReasons.push('REQUIRED_FACT_UNKNOWN');
    else values.push(fact.value);
  }
  if (failReasons.length === 0 && unknownReasons.length === 0 && !rulePasses(definition.rule, values)) {
    failReasons.push('INVARIANT_EXPRESSION_FALSE');
  }
  return Object.freeze({
    invariantId: definition.invariantId,
    family: definition.family,
    verdict: verdictFromReasons(failReasons, unknownReasons),
    evaluatedAtMs: nowMs,
    reasonCodes: sortedUnique([...failReasons, ...unknownReasons]),
    evidenceIds: sortedUnique(evidenceIds),
    capitalRelevant: definition.capitalRelevant,
    severity: definition.severity,
    failSafeAction: definition.failSafeAction,
  });
}

export function evaluateInvariantCatalog(
  definitions: readonly Readonly<SafetyInvariantDefinition>[],
  facts: readonly Readonly<AssuranceFact>[],
  nowMs: number,
  evidenceContext: Readonly<InvariantEvidenceContext>,
): Readonly<InvariantCatalogProjection> {
  assertUtcMs(nowMs, 'nowMs');
  validateFacts(facts, nowMs);
  const ids = definitions.map((definition) => definition.invariantId);
  if (new Set(ids).size !== ids.length) throw new TypeError('invariant catalog contains duplicate IDs');
  const results = definitions.map((definition) => evaluateSafetyInvariant(
    definition,
    facts,
    nowMs,
    evidenceContext,
  ));
  const counts: Record<AssuranceVerdict, number> = { PASS: 0, FAIL: 0, UNKNOWN: 0 };
  for (const result of results) counts[result.verdict] += 1;
  const blocking = results.filter((result) => (result.capitalRelevant || result.severity === 'CRITICAL') && result.verdict !== 'PASS');
  const unknownCritical = results.filter((result) => result.severity === 'CRITICAL' && result.verdict === 'UNKNOWN');
  const tradeReadinessVerdict: AssuranceVerdict = definitions.length === 0
    ? 'UNKNOWN'
    : blocking.some((result) => result.verdict === 'FAIL')
      ? 'FAIL'
      : blocking.length > 0
        ? 'UNKNOWN'
        : 'PASS';
  return Object.freeze({
    evaluatedAtMs: nowMs,
    results: Object.freeze(results),
    counts: Object.freeze({ ...counts }),
    tradeReadinessVerdict,
    blockingInvariantIds: sortedUnique(blocking.map((result) => result.invariantId)),
    unknownCriticalInvariantIds: sortedUnique(unknownCritical.map((result) => result.invariantId)),
  });
}
