import {
  absoluteExactDecimal,
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  deriveAllocationDecisionId,
  divideExactDecimals,
  isExactPositive,
  multiplyExactDecimals,
  normalizeExactDecimal,
  normalizeNonNegativeExactDecimal,
  subtractExactDecimals,
  truthAllowsNewExposure,
  type AllocationAuditStep,
  type AllocationDecision,
  type ExactDecimal,
  type NonNegativeDecimal,
  type TruthMetadata,
} from '../contracts/index.js';
import { validateBudgetContext, type KeyedExactAmount } from '../budgets/index.js';
import { ECONOMIC_DIRECTIONS, type AllocationBatchInput, type AllocationBatchResult, type AllocationCandidate } from './types.js';

const ZERO = normalizeNonNegativeExactDecimal('0');
const QUANTUM = normalizeNonNegativeExactDecimal('0.000000000000000000000001');

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function toMap(values: readonly KeyedExactAmount[]): Map<string, NonNegativeDecimal> {
  return new Map(values.map((entry) => [entry.key, entry.amount]));
}

function fromMap(values: ReadonlyMap<string, NonNegativeDecimal>): readonly KeyedExactAmount[] {
  return Object.freeze([...values].sort(([a], [b]) => a.localeCompare(b)).map(([key, amount]) => Object.freeze({ key, amount })));
}

function nonNegativeDifference(limit: NonNegativeDecimal, used: NonNegativeDecimal): NonNegativeDecimal {
  return compareExactDecimals(limit, used) <= 0
    ? ZERO
    : normalizeNonNegativeExactDecimal(subtractExactDecimals(limit, used));
}

function grantForCapacity(
  capacity: NonNegativeDecimal,
  fullRequirement: NonNegativeDecimal,
  requested: NonNegativeDecimal,
): NonNegativeDecimal {
  if (!isExactPositive(fullRequirement)) return requested;
  const cap = divideExactDecimals(multiplyExactDecimals(capacity, requested), fullRequirement, 24);
  if (compareExactDecimals(cap, requested) >= 0) return requested;
  return normalizeNonNegativeExactDecimal(cap);
}

function scaledRequirement(
  fullRequirement: NonNegativeDecimal,
  granted: NonNegativeDecimal,
  requested: NonNegativeDecimal,
): NonNegativeDecimal {
  if (!isExactPositive(fullRequirement) || !isExactPositive(granted)) return ZERO;
  const numerator = multiplyExactDecimals(fullRequirement, granted);
  const truncated = normalizeNonNegativeExactDecimal(divideExactDecimals(numerator, requested, 24));
  return compareExactDecimals(multiplyExactDecimals(truncated, requested), numerator) < 0
    ? normalizeNonNegativeExactDecimal(addExactDecimals(truncated, QUANTUM))
    : truncated;
}

function scaledSignedRequirement(full: ExactDecimal, granted: NonNegativeDecimal, requested: NonNegativeDecimal): ExactDecimal {
  if (!isExactPositive(granted) || full === ZERO) return ZERO;
  const magnitude = scaledRequirement(absoluteExactDecimal(full), granted, requested);
  return full.startsWith('-') ? normalizeExactDecimal(`-${magnitude}`) : magnitude;
}

function validateAmounts(values: readonly KeyedExactAmount[], label: string, reasons: string[], requireNonEmpty = true): void {
  if (requireNonEmpty && values.length === 0) reasons.push(`${label}_MISSING`);
  const seen = new Set<string>();
  for (const item of values) {
    if (item.key.trim().length === 0) reasons.push(`${label}_KEY_MISSING`);
    if (seen.has(item.key)) reasons.push(`${label}_KEY_DUPLICATE`);
    seen.add(item.key);
    try {
      const amount = normalizeNonNegativeExactDecimal(item.amount);
      if (amount !== item.amount || !isExactPositive(amount)) reasons.push(`${label}_AMOUNT_INVALID`);
    } catch {
      reasons.push(`${label}_AMOUNT_INVALID`);
    }
  }
}

function currentTruthState(truth: Readonly<TruthMetadata>, nowMs: number): TruthMetadata['completeness'] {
  if (truth.completeness !== 'COMPLETE') return truth.completeness;
  return assessCapitalTruth({
    source: truth.source,
    evaluatedAtMs: nowMs,
    requiredValuePresent: true,
    reasons: truth.reasons,
    evidenceReferences: truth.evidenceReferences,
    revision: truth.revision,
  }).completeness;
}

export function validateAllocationCandidate(candidate: Readonly<AllocationCandidate>, nowMs: number): readonly string[] {
  const reasons: string[] = [];
  const validNow = Number.isSafeInteger(nowMs) && nowMs >= 0;
  if (!validNow) reasons.push('NOW_INVALID');
  if (candidate.eligibilityStatus !== 'ELIGIBLE') reasons.push(`CONSIDERATION_${candidate.eligibilityStatus}`);
  if (candidate.considerationMode !== 'MANUAL_ARMED') reasons.push(`MODE_${candidate.considerationMode}_CANNOT_RESERVE`);
  const truthState = validNow ? currentTruthState(candidate.truth, nowMs) : candidate.truth.completeness;
  if (truthState !== 'COMPLETE' || !truthAllowsNewExposure(candidate.truth)) reasons.push(`CONSIDERATION_TRUTH_${truthState}`);
  if (candidate.valuationAsset.trim().length === 0) reasons.push('VALUATION_ASSET_MISSING');
  if (candidate.primarySymbol.trim().length === 0) reasons.push('PRIMARY_SYMBOL_MISSING');
  if (!(ECONOMIC_DIRECTIONS as readonly string[]).includes(candidate.economicDirection) || candidate.economicDirection === 'UNKNOWN') {
    reasons.push('ECONOMIC_DIRECTION_UNKNOWN');
  }
  for (const [label, value, positive] of [
    ['REQUESTED', candidate.requestedAmount, true],
    ['GROSS', candidate.grossExposureIncrease, true],
    ['COLLATERAL', candidate.collateralRequired, false],
    ['MARGIN', candidate.marginRequired, false],
  ] as const) {
    try {
      const normalized = normalizeNonNegativeExactDecimal(value);
      if (normalized !== value || (positive && !isExactPositive(normalized))) reasons.push(`${label}_AMOUNT_INVALID`);
    } catch {
      reasons.push(`${label}_AMOUNT_INVALID`);
    }
  }
  let netValid = false;
  try {
    if (normalizeExactDecimal(candidate.netDirectionalExposureDelta) !== candidate.netDirectionalExposureDelta) {
      reasons.push('NET_DELTA_INVALID');
    } else netValid = true;
  } catch {
    reasons.push('NET_DELTA_INVALID');
  }
  if (netValid) {
    if (candidate.economicDirection === 'HEDGED' && candidate.netDirectionalExposureDelta !== '0') reasons.push('HEDGED_NET_DELTA_NONZERO');
    if (candidate.economicDirection === 'LONG' && compareExactDecimals(candidate.netDirectionalExposureDelta, ZERO) <= 0) reasons.push('LONG_NET_DELTA_NOT_POSITIVE');
    if (candidate.economicDirection === 'SHORT' && compareExactDecimals(candidate.netDirectionalExposureDelta, ZERO) >= 0) reasons.push('SHORT_NET_DELTA_NOT_NEGATIVE');
  }
  validateAmounts(candidate.strategyRequirements, 'STRATEGY_REQUIREMENT', reasons);
  validateAmounts(candidate.symbolRequirements, 'SYMBOL_REQUIREMENT', reasons);
  validateAmounts(candidate.correlatedGroupRequirements, 'CORRELATED_GROUP_REQUIREMENT', reasons);
  validateAmounts(candidate.venueInstrumentRequirements, 'VENUE_INSTRUMENT_REQUIREMENT', reasons);
  validateAmounts(candidate.borrowRequirements, 'BORROW_REQUIREMENT', reasons, candidate.borrowRequired === true);
  validateAmounts(candidate.liquidityRequirements, 'LIQUIDITY_REQUIREMENT', reasons);
  if (candidate.borrowRequired === null) reasons.push('BORROW_REQUIREMENT_UNKNOWN');
  if (candidate.borrowRequired === false && candidate.borrowRequirements.length > 0) reasons.push('BORROW_REQUIREMENT_CONTRADICTORY');
  if (!candidate.symbolRequirements.some((item) => item.key === candidate.primarySymbol)) reasons.push('PRIMARY_SYMBOL_REQUIREMENT_MISSING');
  if (!candidate.strategyRequirements.some((item) => item.key === candidate.strategy)) reasons.push('STRATEGY_REQUIREMENT_MISSING');
  if (candidate.strategyRequirements.length !== 1 || candidate.strategyRequirements[0]?.key !== candidate.strategy) {
    reasons.push('STRATEGY_REQUIREMENT_CONTRADICTORY');
  }
  if (!Number.isSafeInteger(candidate.priority.policyClass) || candidate.priority.policyClass < 0) reasons.push('PRIORITY_CLASS_INVALID');
  if (candidate.priority.stableKey.trim().length === 0) reasons.push('PRIORITY_KEY_MISSING');
  return sortedUnique(reasons);
}

function blockedDecision(candidate: Readonly<AllocationCandidate>, nowMs: number, reasons: readonly string[], policyRevision: AllocationDecision['policyRevision']): AllocationDecision {
  const blockingReasons = sortedUnique(reasons);
  const priorityKey = `${candidate.priority.policyClass}:${candidate.priority.stableKey}:${candidate.considerationId}`;
  return Object.freeze({
    id: deriveAllocationDecisionId({ considerationId: candidate.considerationId, policyRevision, nowMs, blockingReasons }),
    considerationId: candidate.considerationId,
    status: 'BLOCKED',
    requestedAmount: candidate.requestedAmount,
    grantedAmount: ZERO,
    valuationAsset: candidate.valuationAsset,
    priorityKey,
    policyRevision,
    audit: Object.freeze([Object.freeze({
      code: 'BLOCKED_INPUT', before: candidate.requestedAmount, after: ZERO, limit: ZERO,
      reason: blockingReasons.join('|'),
    })]),
    blockingReasons,
    decidedAtMs: nowMs,
  });
}

function opposingConflicts(candidates: readonly Readonly<AllocationCandidate>[]): Set<string> {
  const bySymbol = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (candidate.economicDirection !== 'LONG' && candidate.economicDirection !== 'SHORT') continue;
    const directions = bySymbol.get(candidate.primarySymbol) ?? new Set<string>();
    directions.add(candidate.economicDirection);
    bySymbol.set(candidate.primarySymbol, directions);
  }
  return new Set([...bySymbol].filter(([, values]) => values.size > 1).map(([symbol]) => symbol));
}

export function allocateCapital(input: Readonly<AllocationBatchInput>): AllocationBatchResult {
  const context = validateBudgetContext(input.policy, input.snapshot, input.nowMs);
  const duplicateIds = new Set<string>();
  const grouped = new Map<string, Readonly<AllocationCandidate>[]>();
  for (const candidate of input.candidates) grouped.set(candidate.considerationId, [...(grouped.get(candidate.considerationId) ?? []), candidate]);
  for (const [id, entries] of grouped) if (entries.length > 1) duplicateIds.add(id);
  const unique = [...grouped.values()].map((entries) => [...entries]
    .sort((left, right) => capitalDigest(left).localeCompare(capitalDigest(right)))[0]);
  const conflictEligible = unique.filter((candidate) => validateAllocationCandidate(candidate, input.nowMs).length === 0);
  const conflicts = opposingConflicts(conflictEligible);
  const explicitConflicts = new Set<string>();
  for (const candidate of conflictEligible) {
    if (candidate.conflictingConsiderationIds.length > 0) explicitConflicts.add(candidate.considerationId);
    for (const id of candidate.conflictingConsiderationIds) explicitConflicts.add(id);
  }
  unique.sort((a, b) => b.priority.policyClass - a.priority.policyClass
    || a.priority.stableKey.localeCompare(b.priority.stableKey)
    || a.considerationId.localeCompare(b.considerationId));

  let gross = input.snapshot.grossExposureAndCommitments;
  let net = input.snapshot.netDirectionalExposure;
  let collateral = input.snapshot.entryCollateralAvailable;
  let margin = input.snapshot.marginHeadroomAvailable;
  let plans = input.snapshot.currentConcurrentPlans;
  let positions = input.snapshot.currentActivePositions;
  const strategy = toMap(input.snapshot.strategyUse);
  const symbol = toMap(input.snapshot.symbolUse);
  const correlated = toMap(input.snapshot.correlatedGroupUse);
  const venue = toMap(input.snapshot.venueInstrumentUse);
  const borrow = toMap(input.snapshot.borrowCapacityByAsset);
  const liquidity = toMap(input.snapshot.liquidityCapacityByKey);
  const decisions: AllocationDecision[] = [];

  const applyCap = (audit: AllocationAuditStep[], code: string, grant: NonNegativeDecimal, allowed: NonNegativeDecimal, reason: string): NonNegativeDecimal => {
    const after = compareExactDecimals(grant, allowed) <= 0 ? grant : allowed;
    audit.push(Object.freeze({ code, before: grant, after, limit: allowed, reason }));
    return after;
  };

  for (const candidate of unique) {
    const reasons = [...context.reasonCodes, ...validateAllocationCandidate(candidate, input.nowMs)];
    if (candidate.valuationAsset !== input.policy.valuationAsset) reasons.push('VALUATION_ASSET_MISMATCH');
    if (duplicateIds.has(candidate.considerationId)) reasons.push('DUPLICATE_CONSIDERATION_ID');
    if (conflicts.has(candidate.primarySymbol) || explicitConflicts.has(candidate.considerationId)) reasons.push('CONFLICTING_OPPORTUNITY');
    if (reasons.length > 0) {
      decisions.push(blockedDecision(candidate, input.nowMs, reasons, input.policy.authority.revision));
      continue;
    }

    let grant = candidate.requestedAmount;
    const audit: AllocationAuditStep[] = [];
    grant = applyCap(audit, 'PORTFOLIO_GROSS', grant,
      grantForCapacity(nonNegativeDifference(input.policy.portfolioGrossLimit.value, gross), candidate.grossExposureIncrease, candidate.requestedAmount),
      'portfolio gross exposure plus commitments');
    const signedNetCapacity = compareExactDecimals(candidate.netDirectionalExposureDelta, ZERO) >= 0
      ? subtractExactDecimals(input.policy.portfolioNetLimit.value, net)
      : addExactDecimals(input.policy.portfolioNetLimit.value, net);
    const netCapacity = compareExactDecimals(signedNetCapacity, ZERO) <= 0
      ? ZERO
      : normalizeNonNegativeExactDecimal(signedNetCapacity);
    grant = applyCap(audit, 'PORTFOLIO_NET', grant,
      grantForCapacity(netCapacity, absoluteExactDecimal(candidate.netDirectionalExposureDelta), candidate.requestedAmount),
      'signed portfolio net exposure');
    grant = applyCap(audit, 'ENTRY_COLLATERAL', grant,
      grantForCapacity(collateral, candidate.collateralRequired, candidate.requestedAmount),
      'entry collateral excludes protected risk-reduction reserve');
    grant = applyCap(audit, 'MARGIN_HEADROOM', grant,
      grantForCapacity(margin, candidate.marginRequired, candidate.requestedAmount), 'remaining margin headroom');
    if (candidate.opensNewPlan && plans >= input.policy.maximumConcurrentPlans.value) {
      grant = applyCap(audit, 'CONCURRENT_PLAN_LIMIT', grant, ZERO, 'maximum concurrent plans reached');
    }
    if (candidate.opensNewActivePosition && positions >= input.policy.maximumActivePositions.value) {
      grant = applyCap(audit, 'ACTIVE_POSITION_LIMIT', grant, ZERO, 'maximum active positions reached');
    }

    const dimensionalCaps = (
      code: string,
      requirements: readonly KeyedExactAmount[],
      use: Map<string, NonNegativeDecimal>,
      limit: NonNegativeDecimal,
    ): void => {
      for (const requirement of [...requirements].sort((a, b) => a.key.localeCompare(b.key))) {
        const allowed = grantForCapacity(nonNegativeDifference(limit, use.get(requirement.key) ?? ZERO), requirement.amount, candidate.requestedAmount);
        grant = applyCap(audit, `${code}:${requirement.key}`, grant, allowed, `${code.toLowerCase()} budget`);
      }
    };
    dimensionalCaps('STRATEGY', candidate.strategyRequirements, strategy, input.policy.perStrategyLimits[candidate.strategy].value);
    dimensionalCaps('SYMBOL', candidate.symbolRequirements, symbol, input.policy.perSymbolLimit.value);
    dimensionalCaps('CORRELATED_GROUP', candidate.correlatedGroupRequirements, correlated, input.policy.perCorrelatedGroupLimit.value);
    dimensionalCaps('VENUE_INSTRUMENT', candidate.venueInstrumentRequirements, venue, input.policy.perVenueInstrumentLimit.value);
    for (const requirement of [...candidate.borrowRequirements].sort((a, b) => a.key.localeCompare(b.key))) {
      const capacity = borrow.get(requirement.key);
      grant = applyCap(audit, `BORROW:${requirement.key}`, grant,
        capacity === undefined ? ZERO : grantForCapacity(capacity, requirement.amount, candidate.requestedAmount),
        capacity === undefined ? 'borrow capacity unknown' : 'remaining borrow capacity');
    }
    for (const requirement of [...candidate.liquidityRequirements].sort((a, b) => a.key.localeCompare(b.key))) {
      const capacity = liquidity.get(requirement.key);
      grant = applyCap(audit, `LIQUIDITY:${requirement.key}`, grant,
        capacity === undefined ? ZERO : grantForCapacity(capacity, requirement.amount, candidate.requestedAmount),
        capacity === undefined ? 'liquidity capacity unknown' : 'intended-size liquidity capacity');
    }

    const projectedNet = addExactDecimals(net, scaledSignedRequirement(
      candidate.netDirectionalExposureDelta, grant, candidate.requestedAmount,
    ));
    if (compareExactDecimals(absoluteExactDecimal(projectedNet), input.policy.portfolioNetLimit.value) > 0) {
      grant = applyCap(audit, 'PORTFOLIO_NET_PRECISION', grant, ZERO, 'exact scaling would cross the signed net boundary');
    }

    const blockingReasons = grant === ZERO
      ? sortedUnique(audit.filter((step) => step.limit === ZERO).map((step) => step.code))
      : Object.freeze([] as string[]);
    const status = grant === ZERO ? 'BLOCKED' : compareExactDecimals(grant, candidate.requestedAmount) < 0 ? 'CAPPED' : 'GRANTED';
    const priorityKey = `${candidate.priority.policyClass}:${candidate.priority.stableKey}:${candidate.considerationId}`;
    decisions.push(Object.freeze({
      id: deriveAllocationDecisionId({ considerationId: candidate.considerationId, policyRevision: input.policy.authority.revision, nowMs: input.nowMs, grant }),
      considerationId: candidate.considerationId,
      status,
      requestedAmount: candidate.requestedAmount,
      grantedAmount: grant,
      valuationAsset: candidate.valuationAsset,
      priorityKey,
      policyRevision: input.policy.authority.revision,
      audit: Object.freeze(audit),
      blockingReasons,
      decidedAtMs: input.nowMs,
    }));
    if (grant === ZERO) continue;

    const addUse = (target: Map<string, NonNegativeDecimal>, requirements: readonly KeyedExactAmount[]): void => {
      for (const requirement of requirements) {
        target.set(requirement.key, normalizeNonNegativeExactDecimal(addExactDecimals(
          target.get(requirement.key) ?? ZERO,
          scaledRequirement(requirement.amount, grant, candidate.requestedAmount),
        )));
      }
    };
    const subtractCapacity = (target: Map<string, NonNegativeDecimal>, requirements: readonly KeyedExactAmount[]): void => {
      for (const requirement of requirements) {
        const current = target.get(requirement.key) ?? ZERO;
        target.set(requirement.key, nonNegativeDifference(current, scaledRequirement(requirement.amount, grant, candidate.requestedAmount)));
      }
    };
    gross = normalizeNonNegativeExactDecimal(addExactDecimals(gross, scaledRequirement(candidate.grossExposureIncrease, grant, candidate.requestedAmount)));
    net = addExactDecimals(net, scaledSignedRequirement(candidate.netDirectionalExposureDelta, grant, candidate.requestedAmount));
    collateral = nonNegativeDifference(collateral, scaledRequirement(candidate.collateralRequired, grant, candidate.requestedAmount));
    margin = nonNegativeDifference(margin, scaledRequirement(candidate.marginRequired, grant, candidate.requestedAmount));
    addUse(strategy, candidate.strategyRequirements);
    addUse(symbol, candidate.symbolRequirements);
    addUse(correlated, candidate.correlatedGroupRequirements);
    addUse(venue, candidate.venueInstrumentRequirements);
    subtractCapacity(borrow, candidate.borrowRequirements);
    subtractCapacity(liquidity, candidate.liquidityRequirements);
    if (candidate.opensNewPlan) plans += 1;
    if (candidate.opensNewActivePosition) positions += 1;
  }

  return Object.freeze({
    decisions: Object.freeze(decisions),
    remainder: Object.freeze({
      grossExposureAndCommitments: gross,
      netDirectionalExposure: net,
      entryCollateralAvailable: collateral,
      marginHeadroomAvailable: margin,
      strategyUse: fromMap(strategy),
      symbolUse: fromMap(symbol),
      correlatedGroupUse: fromMap(correlated),
      venueInstrumentUse: fromMap(venue),
      borrowCapacityByAsset: fromMap(borrow),
      liquidityCapacityByKey: fromMap(liquidity),
      concurrentPlans: plans,
      activePositions: positions,
    }),
  });
}
