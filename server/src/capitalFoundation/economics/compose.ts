import {
  ECONOMIC_COMPONENT_KINDS,
  addExactDecimals,
  capitalDigest,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  isExactDecimal,
  normalizeExactDecimal,
  sumExactDecimals,
  validateEconomicComponent,
  type CapitalTruthState,
  type ConfigurationAuthority,
  type EconomicComponent,
  type EconomicComponentKind,
  type EconomicEstimateRange,
  type ExactDecimal,
} from '../contracts/index.js';
import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  ECONOMIC_DIMENSIONS,
  ECONOMIC_SCOPE_KINDS,
  EXECUTION_COST_BASES,
  PRICE_PNL_BASES,
  type ComposeEconomicReportInput,
  type EconomicDimension,
  type EconomicDimensionSummary,
  type EconomicAccountingPolicy,
  type EconomicAccountingPolicySemantics,
  type EconomicMeasure,
  type EconomicReport,
  type RollUpEconomicReportsInput,
} from './types.js';

const ZERO = normalizeExactDecimal('0');
const PRICE_LEG_KINDS = Object.freeze(['MARK_TO_MARKET_LEG_PNL', 'REALIZED_LEG_PNL'] as const);
const PRICE_DECOMPOSITION_KINDS = Object.freeze(['BASIS_CONVERGENCE_DIVERGENCE', 'DIRECTIONAL_CONTRIBUTION'] as const);
const DETAILED_EXECUTION_KINDS = Object.freeze(['ENTRY_SPREAD_COST', 'EXIT_SPREAD_COST', 'ESTIMATED_SLIPPAGE', 'REALIZED_SLIPPAGE'] as const);
const INDEPENDENT_NET_KINDS = Object.freeze([
  'FUNDING',
  'BORROW_INTEREST_AND_FEES',
  'TRADING_COMMISSIONS',
  'ONE_LEG_EXPOSURE',
  'CONVERSION_VALUATION',
  'OPERATIONAL_RECOVERY_COST',
  'RESIDUAL_UNEXPLAINED',
] as const);

function sortedUnique<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort()) as readonly T[];
}

function nonEmpty(value: unknown, maximum = 256): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= maximum;
}

function economicPolicyPayload(
  policy: Readonly<EconomicAccountingPolicy> | Readonly<EconomicAccountingPolicySemantics>,
): Readonly<EconomicAccountingPolicySemantics> {
  const authority = policy?.authority as Partial<ConfigurationAuthority> | undefined;
  if (!authority || !nonEmpty(authority.sourceId)) throw new TypeError('economic policy source identity is invalid');
  if (!isValidUtcMillis(authority.issuedAtMs) || !isValidUtcMillis(authority.effectiveFromMs)) {
    throw new TypeError('economic policy issue and effective times must be UTC milliseconds');
  }
  if (authority.effectiveUntilMs !== null && !isValidUtcMillis(authority.effectiveUntilMs)) {
    throw new TypeError('economic policy expiry must be null or UTC milliseconds');
  }
  if (authority.issuedAtMs > authority.effectiveFromMs) throw new TypeError('economic policy cannot be issued after it becomes effective');
  if (authority.effectiveUntilMs !== null && authority.effectiveUntilMs <= authority.effectiveFromMs) {
    throw new TypeError('economic policy effective window is invalid');
  }
  if (!(PRICE_PNL_BASES as readonly string[]).includes(policy.pricePnlBasis)) throw new TypeError('economic policy price PnL basis is invalid');
  if (!(EXECUTION_COST_BASES as readonly string[]).includes(policy.executionCostBasis)) throw new TypeError('economic policy execution cost basis is invalid');
  if (!Array.isArray(policy.expectedComponentKinds)) throw new TypeError('economic policy expected component kinds must be an array');
  if (new Set(policy.expectedComponentKinds).size !== policy.expectedComponentKinds.length) {
    throw new TypeError('economic policy expected component kinds must be unique');
  }
  for (const kind of policy.expectedComponentKinds) {
    if (!(ECONOMIC_COMPONENT_KINDS as readonly string[]).includes(kind)) throw new TypeError(`expected economic component kind ${kind} is invalid`);
  }
  return Object.freeze({
    authority: Object.freeze({
      sourceId: authority.sourceId,
      issuedAtMs: authority.issuedAtMs,
      effectiveFromMs: authority.effectiveFromMs,
      effectiveUntilMs: authority.effectiveUntilMs,
    }),
    pricePnlBasis: policy.pricePnlBasis,
    executionCostBasis: policy.executionCostBasis,
    expectedComponentKinds: sortedUnique(policy.expectedComponentKinds),
  });
}

/**
 * Deterministic integrity address for every economic-accounting policy
 * semantic. This does not authenticate the named source; a future trusted
 * configuration adapter must own distribution and source trust.
 */
export function deriveEconomicAccountingPolicyRevision(
  policy: Readonly<EconomicAccountingPolicy> | Readonly<EconomicAccountingPolicySemantics>,
): EconomicAccountingPolicy['authority']['revision'] {
  return deriveCapitalConfigRevision('economic-accounting-policy', economicPolicyPayload(policy));
}

export function validateEconomicAccountingPolicy(
  value: unknown,
  evaluatedAtMs: number,
): readonly string[] {
  const policy = value as Partial<EconomicAccountingPolicy> | null;
  const authority = policy?.authority as Partial<ConfigurationAuthority> | undefined;
  const issues: string[] = [];
  if (!isValidUtcMillis(evaluatedAtMs)) issues.push('EVALUATED_AT_INVALID');
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return Object.freeze([...issues, 'ECONOMIC_POLICY_REQUIRED']);
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) {
    issues.push('ECONOMIC_POLICY_AUTHORITY_REQUIRED');
  } else {
    if (!nonEmpty(authority.revision)) issues.push('ECONOMIC_POLICY_REVISION_REQUIRED');
    if (!nonEmpty(authority.sourceId)) issues.push('ECONOMIC_POLICY_SOURCE_INVALID');
    if (!isValidUtcMillis(authority.issuedAtMs)) issues.push('ECONOMIC_POLICY_ISSUED_AT_INVALID');
    if (!isValidUtcMillis(authority.effectiveFromMs)) issues.push('ECONOMIC_POLICY_EFFECTIVE_FROM_INVALID');
    if (authority.effectiveUntilMs !== null && !isValidUtcMillis(authority.effectiveUntilMs)) issues.push('ECONOMIC_POLICY_EFFECTIVE_UNTIL_INVALID');
    if (isValidUtcMillis(authority.issuedAtMs) && isValidUtcMillis(authority.effectiveFromMs)
      && authority.issuedAtMs > authority.effectiveFromMs) issues.push('ECONOMIC_POLICY_ISSUED_AFTER_EFFECTIVE');
    if (authority.effectiveUntilMs !== null && isValidUtcMillis(authority.effectiveFromMs)
      && isValidUtcMillis(authority.effectiveUntilMs) && authority.effectiveUntilMs <= authority.effectiveFromMs) {
      issues.push('ECONOMIC_POLICY_EFFECTIVE_WINDOW_INVALID');
    }
    if (isValidUtcMillis(evaluatedAtMs) && isValidUtcMillis(authority.effectiveFromMs)
      && evaluatedAtMs < authority.effectiveFromMs) issues.push('ECONOMIC_POLICY_NOT_YET_EFFECTIVE');
    if (isValidUtcMillis(evaluatedAtMs) && authority.effectiveUntilMs !== null
      && isValidUtcMillis(authority.effectiveUntilMs) && evaluatedAtMs >= authority.effectiveUntilMs) {
      issues.push('ECONOMIC_POLICY_EXPIRED');
    }
  }
  if (!(PRICE_PNL_BASES as readonly unknown[]).includes(policy.pricePnlBasis)) issues.push('ECONOMIC_POLICY_PRICE_PNL_BASIS_INVALID');
  if (!(EXECUTION_COST_BASES as readonly unknown[]).includes(policy.executionCostBasis)) issues.push('ECONOMIC_POLICY_EXECUTION_COST_BASIS_INVALID');
  if (!Array.isArray(policy.expectedComponentKinds)
    || policy.expectedComponentKinds.some((kind) => !(ECONOMIC_COMPONENT_KINDS as readonly unknown[]).includes(kind))) {
    issues.push('ECONOMIC_POLICY_EXPECTED_KINDS_INVALID');
  } else if (new Set(policy.expectedComponentKinds).size !== policy.expectedComponentKinds.length) {
    issues.push('ECONOMIC_POLICY_EXPECTED_KINDS_DUPLICATE');
  }
  if (issues.length === 0) {
    try {
      if (authority?.revision !== deriveEconomicAccountingPolicyRevision(policy as EconomicAccountingPolicy)) {
        issues.push('ECONOMIC_POLICY_REVISION_CONTENT_MISMATCH');
      }
    } catch {
      issues.push('ECONOMIC_POLICY_REVISION_CONTENT_MISMATCH');
    }
  }
  return Object.freeze([...new Set(issues)].sort());
}

function frozenComponent(component: Readonly<EconomicComponent>): Readonly<EconomicComponent> {
  const sourceIds = Array.isArray(component.sourceIds)
    ? component.sourceIds.filter((value): value is string => typeof value === 'string')
    : [];
  const reasonCodes = Array.isArray(component.reasonCodes)
    ? component.reasonCodes.filter((value): value is string => typeof value === 'string')
    : [];
  return Object.freeze({
    ...component,
    estimateRange: component.estimateRange === null
      ? null
      : Object.freeze({ ...component.estimateRange }),
    sourceIds: Object.freeze([...sourceIds]),
    reasonCodes: Object.freeze([...reasonCodes]),
  });
}

function assertInput(input: ComposeEconomicReportInput): void {
  if (!(ECONOMIC_SCOPE_KINDS as readonly string[]).includes(input.scope.kind)) throw new TypeError('economic scope kind is invalid');
  if (typeof input.scope.id !== 'string' || input.scope.id.trim().length === 0) throw new TypeError('economic scope ID is required');
  if (typeof input.valuationAsset !== 'string' || input.valuationAsset.trim().length === 0) throw new TypeError('valuation asset is required');
  if (!isValidUtcMillis(input.evaluatedAtMs)) throw new TypeError('evaluatedAtMs must be injected UTC milliseconds');
  const policyIssues = validateEconomicAccountingPolicy(input.policy, input.evaluatedAtMs);
  if (policyIssues.length > 0) throw new TypeError(`economic accounting policy invalid: ${policyIssues.join(',')}`);
}

function slippageSlotKey(component: Readonly<EconomicComponent>): string {
  const hasExecutionIdentity = component.legId !== null || component.correlationId !== null;
  const sourceIds = Array.isArray(component.sourceIds)
    ? component.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string')
    : [];
  return capitalDigest({
    strategy: component.strategy,
    opportunityId: component.opportunityId,
    configRevision: component.configRevision,
    stage: component.stage,
    symbol: component.symbol,
    legId: component.legId,
    correlationId: component.correlationId,
    fallbackSourceIds: hasExecutionIdentity ? [] : sortedUnique(sourceIds),
  });
}

function includedKinds(input: ComposeEconomicReportInput): ReadonlySet<EconomicComponentKind> {
  const selected: EconomicComponentKind[] = [
    ...(input.policy.pricePnlBasis === 'LEG_PRICE' ? PRICE_LEG_KINDS : PRICE_DECOMPOSITION_KINDS),
    ...INDEPENDENT_NET_KINDS,
  ];
  if (input.policy.executionCostBasis === 'EXECUTION_SHORTFALL') {
    selected.push('EXECUTION_SHORTFALL');
  } else {
    selected.push('ENTRY_SPREAD_COST', 'EXIT_SPREAD_COST', 'ESTIMATED_SLIPPAGE', 'REALIZED_SLIPPAGE');
  }
  return new Set(selected);
}

function minimumExpectedKinds(input: ComposeEconomicReportInput): readonly EconomicComponentKind[] {
  const price = input.policy.pricePnlBasis === 'LEG_PRICE'
    ? [...PRICE_LEG_KINDS]
    : [...PRICE_DECOMPOSITION_KINDS];
  const execution: EconomicComponentKind[] = input.policy.executionCostBasis === 'EXECUTION_SHORTFALL'
    ? ['EXECUTION_SHORTFALL']
    : [
        'ENTRY_SPREAD_COST',
        'EXIT_SPREAD_COST',
        input.policy.expectedComponentKinds.includes('REALIZED_SLIPPAGE')
          || input.components.some((component) => component.kind === 'REALIZED_SLIPPAGE')
          ? 'REALIZED_SLIPPAGE'
          : 'ESTIMATED_SLIPPAGE',
      ];
  return sortedUnique([...price, ...execution, ...INDEPENDENT_NET_KINDS]);
}

function componentRange(component: Readonly<EconomicComponent>): Readonly<EconomicEstimateRange> | null {
  if (component.status !== 'ESTIMATED' || component.estimateRange === null) return null;
  if (!isExactDecimal(component.estimateRange.low) || !isExactDecimal(component.estimateRange.high)) return null;
  if (compareExactDecimals(component.estimateRange.low, component.estimateRange.high) > 0) return null;
  return component.estimateRange;
}

function sumKnown(components: readonly Readonly<EconomicComponent>[]): ExactDecimal {
  return sumExactDecimals(components
    .filter((component) => component.status === 'KNOWN' && component.amount !== null)
    .map((component) => component.amount as ExactDecimal));
}

function estimateRange(
  known: ExactDecimal,
  components: readonly Readonly<EconomicComponent>[],
): Readonly<EconomicEstimateRange> | null {
  const validRanges = components
    .filter((component) => component.status === 'ESTIMATED')
    .map((component) => componentRange(component))
    .filter((range): range is Readonly<EconomicEstimateRange> => range !== null);
  if (validRanges.length === 0) return null;
  return Object.freeze({
    low: validRanges.reduce((total, range) => addExactDecimals(total, range.low), known),
    high: validRanges.reduce((total, range) => addExactDecimals(total, range.high), known),
  });
}

function missingKindsFor(
  kinds: readonly EconomicComponentKind[],
  components: readonly Readonly<EconomicComponent>[],
  expected: ReadonlySet<EconomicComponentKind>,
  divergentIds: ReadonlySet<string> = new Set(),
): readonly EconomicComponentKind[] {
  return sortedUnique(kinds.filter((kind) => {
    if (!expected.has(kind)) return false;
    const matching = components.filter((component) => component.kind === kind);
    const validMatching = matching.filter((component) => !divergentIds.has(component.id));
    return validMatching.length === 0
      || matching.some((component) => component.status === 'MISSING')
      || !validMatching.some((component) => component.status === 'KNOWN'
        || component.status === 'ESTIMATED'
        || component.status === 'NOT_APPLICABLE');
  }));
}

function measure(
  kinds: readonly EconomicComponentKind[],
  components: readonly Readonly<EconomicComponent>[],
  expected: ReadonlySet<EconomicComponentKind>,
  divergentIds: ReadonlySet<string>,
  selectedIds: ReadonlySet<string> | null = null,
): Readonly<EconomicMeasure> {
  const relevant = components.filter((component) => kinds.includes(component.kind));
  const selected = selectedIds === null ? relevant : relevant.filter((component) => selectedIds.has(component.id));
  const missing = missingKindsFor(kinds, components, expected, divergentIds);
  const known = selected.filter((component) => !divergentIds.has(component.id)
    && component.status === 'KNOWN' && component.amount !== null && isExactDecimal(component.amount));
  const estimates = selected.filter((component) => !divergentIds.has(component.id)
    && component.status === 'ESTIMATED' && componentRange(component) !== null);
  const divergent = relevant.some((component) => divergentIds.has(component.id));
  const knownAmount = known.length === 0 ? null : sumKnown(known);
  const range = estimateRange(knownAmount ?? ZERO, estimates);
  let status: EconomicMeasure['status'];
  if (divergent) status = 'DIVERGENT';
  else if (missing.length > 0) status = 'MISSING';
  else if (estimates.length > 0) status = 'ESTIMATED';
  else if (known.length > 0) status = 'KNOWN';
  else status = 'NOT_APPLICABLE';
  return Object.freeze({
    status,
    knownAmount,
    estimatedRange: range,
    componentIds: sortedUnique(selected.map((component) => component.id)),
    missingComponentKinds: missing,
    reasonCodes: sortedUnique([
      ...(divergent ? ['DIVERGENT_COMPONENT'] : []),
      ...missing.map((kind) => `MISSING_${kind}`),
    ]),
  });
}

function dimensionValue(component: Readonly<EconomicComponent>, dimension: EconomicDimension): string | null {
  return component[dimension];
}

function dimensionSummary(
  input: ComposeEconomicReportInput,
  dimension: EconomicDimension,
): Readonly<EconomicDimensionSummary> {
  const expectedValue = input.scope[dimension];
  const relevant = input.components.filter((component) => component.status !== 'NOT_APPLICABLE');
  const missing = relevant.filter((component) => dimensionValue(component, dimension) === null).map((component) => component.id);
  const conflicts = expectedValue === null ? [] : relevant
    .filter((component) => {
      const value = dimensionValue(component, dimension);
      return value !== null && value !== expectedValue;
    })
    .map((component) => component.id);
  const values = sortedUnique(relevant
    .map((component) => dimensionValue(component, dimension))
    .filter((value): value is string => value !== null));
  let completeness: CapitalTruthState;
  if (conflicts.length > 0) completeness = 'DIVERGENT';
  else if (relevant.length === 0 || values.length === 0) completeness = 'UNKNOWN';
  else if (missing.length > 0) completeness = 'PARTIAL';
  else completeness = 'COMPLETE';
  return Object.freeze({
    dimension,
    expectedValue,
    values,
    completeness,
    missingComponentIds: sortedUnique(missing),
    conflictingComponentIds: sortedUnique(conflicts),
  });
}

export function composeEconomicReport(input: ComposeEconomicReportInput): Readonly<EconomicReport> {
  assertInput(input);
  const effectiveExpectedKinds = sortedUnique([...input.policy.expectedComponentKinds, ...minimumExpectedKinds(input)]);
  const expected = new Set(effectiveExpectedKinds);
  const componentIds = input.components.map((component) => component.id);
  const duplicateIds = sortedUnique(componentIds.filter((id, index) => componentIds.indexOf(id) !== index));
  const divergentReasons: string[] = duplicateIds.map((id) => `DUPLICATE_COMPONENT_ID:${id}`);
  const divergentIds = new Set<string>(duplicateIds);
  const provenanceOwners = new Map<string, string>();
  for (const component of input.components) {
    const issues = validateEconomicComponent(component);
    if (issues.length > 0) {
      divergentIds.add(component.id);
      divergentReasons.push(...issues.map((issue) => `INVALID_COMPONENT:${component.id}:${issue}`));
    }
    if (component.valuationAsset !== input.valuationAsset) {
      divergentIds.add(component.id);
      divergentReasons.push(`MIXED_VALUATION_ASSET:${component.id}:${component.valuationAsset}`);
    }
    const sourceIds = Array.isArray(component.sourceIds)
      ? sortedUnique(component.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === 'string' && sourceId.trim().length > 0))
      : [];
    if (!Array.isArray(component.sourceIds) || component.sourceIds.some((sourceId) => typeof sourceId !== 'string')) {
      divergentIds.add(component.id);
      divergentReasons.push(`INVALID_COMPONENT:${component.id}:SOURCE_IDS_INVALID`);
    }
    if ((component.status === 'KNOWN' || component.status === 'ESTIMATED') && sourceIds.length === 0) {
      divergentIds.add(component.id);
      divergentReasons.push(`INVALID_COMPONENT:${component.id}:PROVENANCE_SOURCE_REQUIRED`);
    }
    if (sourceIds.length > 0) {
      const provenanceKey = capitalDigest({
        kind: component.kind,
        sourceIds,
        valuationAsset: component.valuationAsset,
        strategy: component.strategy,
        opportunityId: component.opportunityId,
        configRevision: component.configRevision,
        stage: component.stage,
        symbol: component.symbol,
        legId: component.legId,
        correlationId: component.correlationId,
      });
      const priorId = provenanceOwners.get(provenanceKey);
      if (priorId !== undefined && priorId !== component.id) {
        divergentIds.add(priorId);
        divergentIds.add(component.id);
        divergentReasons.push(`DUPLICATE_COMPONENT_PROVENANCE:${provenanceKey}:${priorId}:${component.id}`);
      } else {
        provenanceOwners.set(provenanceKey, component.id);
      }
    }
  }
  const dimensions = ECONOMIC_DIMENSIONS.map((dimension) => dimensionSummary(input, dimension));
  for (const dimension of dimensions) {
    if (dimension.completeness === 'DIVERGENT') {
      divergentReasons.push(`ATTRIBUTION_DIMENSION_DIVERGENT:${dimension.dimension}`);
      dimension.conflictingComponentIds.forEach((id) => divergentIds.add(id));
    }
  }
  const missingComponentKinds = missingKindsFor(
    effectiveExpectedKinds,
    input.components,
    expected,
    divergentIds,
  );
  const selection = includedKinds(input);
  const realizedSlippageSlots = new Set(input.components
    .filter((component) => component.kind === 'REALIZED_SLIPPAGE'
      && !divergentIds.has(component.id)
      && (component.status === 'KNOWN' || component.status === 'ESTIMATED'))
    .map(slippageSlotKey));
  const seen = new Set<string>();
  const included = input.components.filter((component) => {
    if (seen.has(component.id)) return false;
    seen.add(component.id);
    return selection.has(component.kind)
      && !(component.kind === 'ESTIMATED_SLIPPAGE' && realizedSlippageSlots.has(slippageSlotKey(component)))
      && component.valuationAsset === input.valuationAsset
      && !divergentIds.has(component.id)
      && (component.status === 'KNOWN' || component.status === 'ESTIMATED');
  });
  const knownIncluded = included.filter((component) => component.status === 'KNOWN' && component.amount !== null);
  const estimatedIncluded = included.filter((component) => component.status === 'ESTIMATED');
  const netKnown = sumKnown(knownIncluded);
  const netEstimatedRange = estimateRange(netKnown, estimatedIncluded);
  const structurallyDivergent = divergentReasons.length > 0;
  const residual = input.components.filter((component) => component.kind === 'RESIDUAL_UNEXPLAINED');
  const nonZeroResidual = residual.some((component) => component.amount !== null
    && isExactDecimal(component.amount)
    && compareExactDecimals(component.amount, ZERO) !== 0);
  const hasEstimate = estimatedIncluded.length > 0;
  const hasKnown = input.components.some((component) => component.status === 'KNOWN');
  const hasApplicable = input.components.some((component) => component.status !== 'NOT_APPLICABLE');
  const hasAccountingEvidence = input.components.length > 0;
  const accountingIdentityProven = !structurallyDivergent
    && missingComponentKinds.length === 0
    && hasAccountingEvidence;
  const incomplete = !hasAccountingEvidence
    || missingComponentKinds.length > 0
    || hasEstimate
    || nonZeroResidual
    || dimensions.some((dimension) => dimension.completeness === 'PARTIAL'
      || (hasApplicable && dimension.completeness === 'UNKNOWN'));
  const completeness: CapitalTruthState = structurallyDivergent
    ? 'DIVERGENT'
    : !hasKnown && missingComponentKinds.length > 0
      ? 'UNKNOWN'
      : incomplete
        ? 'PARTIAL'
        : 'COMPLETE';
  const includedComponentIds = sortedUnique(included.map((component) => component.id));
  const excludedComponentIds = sortedUnique(input.components
    .map((component) => component.id)
    .filter((id) => !includedComponentIds.includes(id)));
  const attribution = Object.freeze({
    components: Object.freeze(input.components.map(frozenComponent)),
    valuationAsset: input.valuationAsset,
    netKnown,
    netEstimatedRange,
    completeness,
    accountingIdentityProven,
    includedComponentIds,
    missingComponentKinds,
    divergentReasons: sortedUnique(divergentReasons),
    evaluatedAtMs: input.evaluatedAtMs,
  });
  const measures = Object.freeze({
    grossPricePnl: measure([...PRICE_LEG_KINDS], input.components, expected, divergentIds),
    basisContribution: measure(['BASIS_CONVERGENCE_DIVERGENCE'], input.components, expected, divergentIds),
    directionalContribution: measure(['DIRECTIONAL_CONTRIBUTION'], input.components, expected, divergentIds),
    realizedPnl: measure(['REALIZED_LEG_PNL'], input.components, expected, divergentIds),
    unrealizedPnl: measure(['MARK_TO_MARKET_LEG_PNL'], input.components, expected, divergentIds),
    fees: measure(['TRADING_COMMISSIONS'], input.components, expected, divergentIds),
    spread: measure(['ENTRY_SPREAD_COST', 'EXIT_SPREAD_COST'], input.components, expected, divergentIds),
    slippage: measure(
      ['ESTIMATED_SLIPPAGE', 'REALIZED_SLIPPAGE'],
      input.components,
      expected,
      divergentIds,
      new Set(included
        .filter((component) => component.kind === 'ESTIMATED_SLIPPAGE' || component.kind === 'REALIZED_SLIPPAGE')
        .map((component) => component.id)),
    ),
    funding: measure(['FUNDING'], input.components, expected, divergentIds),
    borrow: measure(['BORROW_INTEREST_AND_FEES'], input.components, expected, divergentIds),
    executionShortfall: measure(['EXECUTION_SHORTFALL'], input.components, expected, divergentIds),
    oneLegExposure: measure(['ONE_LEG_EXPOSURE'], input.components, expected, divergentIds),
    recovery: measure(['OPERATIONAL_RECOVERY_COST'], input.components, expected, divergentIds),
    fxValuation: measure(['CONVERSION_VALUATION'], input.components, expected, divergentIds),
    unexplainedResidual: measure(['RESIDUAL_UNEXPLAINED'], input.components, expected, divergentIds),
  });
  const identity = Object.freeze({
    knownIncludedComponentIds: sortedUnique(knownIncluded.map((component) => component.id)),
    estimatedIncludedComponentIds: sortedUnique(estimatedIncluded.map((component) => component.id)),
    knownComponentSum: netKnown,
    estimatedLowSum: netEstimatedRange?.low ?? null,
    estimatedHighSum: netEstimatedRange?.high ?? null,
    equation: 'NET_KNOWN_EQUALS_SUM_KNOWN_INCLUDED_COMPONENTS' as const,
    proven: accountingIdentityProven,
  });
  return Object.freeze({
    scope: Object.freeze({ ...input.scope }),
    policy: Object.freeze({
      ...input.policy,
      authority: Object.freeze({ ...input.policy.authority }),
      expectedComponentKinds: Object.freeze([...input.policy.expectedComponentKinds]),
    }),
    attribution,
    measures,
    dimensions: Object.freeze(dimensions),
    accountingStatus: structurallyDivergent ? 'DIVERGENT' : incomplete ? 'INCOMPLETE' : 'COMPLETE',
    accountingConfidence: structurallyDivergent || completeness === 'UNKNOWN' || !accountingIdentityProven
      ? 'NONE'
      : missingComponentKinds.length > 0 || nonZeroResidual
        ? 'LOW'
        : hasEstimate || completeness === 'PARTIAL'
          ? 'MEDIUM'
          : 'HIGH',
    identity,
    excludedComponentIds,
  });
}

/** Roll-up is component composition, not summing child nets, so duplicates remain detectable. */
export function rollUpEconomicReports(input: RollUpEconomicReportsInput): Readonly<EconomicReport> {
  return composeEconomicReport({
    scope: input.scope,
    valuationAsset: input.valuationAsset,
    components: input.childReports.flatMap((report) => report.attribution.components),
    policy: input.policy,
    evaluatedAtMs: input.evaluatedAtMs,
  });
}
