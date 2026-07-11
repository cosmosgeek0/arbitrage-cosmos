import {
  absoluteExactDecimal,
  addExactDecimals,
  assessCapitalTruth,
  capitalDigest,
  compareExactDecimals,
  deriveCapitalConfigRevision,
  deriveAllocationDecisionId,
  deriveOpportunityConsiderationId,
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
import { isValidUtcMillis } from '../../foundation/contracts/index.js';
import {
  ECONOMIC_DIRECTIONS,
  type AllocationAuthorityReceipt,
  type AllocationBatchInput,
  type AllocationBatchResult,
  type AllocationCandidate,
} from './types.js';

const ZERO = normalizeNonNegativeExactDecimal('0');
const QUANTUM = normalizeNonNegativeExactDecimal('0.000000000000000000000001');

function sortedUnique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function compareText(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}

function toMap(values: readonly KeyedExactAmount[]): Map<string, NonNegativeDecimal> {
  return new Map(values.map((entry) => [entry.key, entry.amount]));
}

function fromMap(values: ReadonlyMap<string, NonNegativeDecimal>): readonly KeyedExactAmount[] {
  return Object.freeze([...values].sort(([a], [b]) => compareText(a, b)).map(([key, amount]) => Object.freeze({ key, amount })));
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
  // Avoid an unnecessary capacity * request intermediate. With canonical
  // 96-digit decimals, two individually valid tiny values may otherwise
  // underflow the representable domain even when the full request fits.
  if (compareExactDecimals(capacity, fullRequirement) >= 0) return requested;
  const cap = divideExactDecimals(multiplyExactDecimals(capacity, requested), fullRequirement, 24);
  const provisional = compareExactDecimals(cap, requested) >= 0
    ? requested
    : normalizeNonNegativeExactDecimal(cap);
  if (!isExactPositive(provisional)) return ZERO;
  // Usage is conservatively rounded up by scaledRequirement. If the domain's
  // exact scale is finer than that accounting quantum, a positive rounded use
  // may exceed exact capacity; fail closed instead of clamping the overrun.
  return compareExactDecimals(scaledRequirement(fullRequirement, provisional, requested), capacity) <= 0
    ? provisional
    : ZERO;
}

function scaledRequirement(
  fullRequirement: NonNegativeDecimal,
  granted: NonNegativeDecimal,
  requested: NonNegativeDecimal,
): NonNegativeDecimal {
  if (!isExactPositive(fullRequirement) || !isExactPositive(granted)) return ZERO;
  if (compareExactDecimals(granted, requested) === 0) return fullRequirement;
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

function canonicalCapitalIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 256
    && value === value.trim()
    && value === value.toUpperCase()
    && /^[A-Z0-9][A-Z0-9._:/-]*$/.test(value);
}

function nonEmptyExactString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && value === value.trim();
}

function canonicalDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
}

function exactNonNegativeOrNull(value: unknown): NonNegativeDecimal | null {
  try {
    const normalized = normalizeNonNegativeExactDecimal(value as ExactDecimal);
    return normalized === value ? normalized : null;
  } catch {
    return null;
  }
}

function considerationEconomicDirection(
  consideration: AllocationCandidate['consideration'],
): AllocationCandidate['economicDirection'] {
  if (!Array.isArray(consideration.legs) || consideration.legs.length === 0
      || consideration.legs.some((leg) => leg.side !== 'LONG' && leg.side !== 'SHORT')) return 'UNKNOWN';
  const long = consideration.legs.some((leg) => leg.side === 'LONG');
  const short = consideration.legs.some((leg) => leg.side === 'SHORT');
  return long && short ? 'HEDGED' : long ? 'LONG' : short ? 'SHORT' : 'UNKNOWN';
}

function validateAmounts(
  values: readonly KeyedExactAmount[],
  label: string,
  reasons: string[],
  requireNonEmpty = true,
  conservativeMinimum: NonNegativeDecimal | null = null,
): void {
  if (requireNonEmpty && values.length === 0) reasons.push(`${label}_MISSING`);
  const seen = new Set<string>();
  for (const item of values) {
    if (!canonicalCapitalIdentifier(item.key)) reasons.push(`${label}_KEY_NOT_CANONICAL`);
    if (seen.has(item.key)) reasons.push(`${label}_KEY_DUPLICATE`);
    seen.add(item.key);
    try {
      const amount = normalizeNonNegativeExactDecimal(item.amount);
      if (amount !== item.amount || !isExactPositive(amount)) reasons.push(`${label}_AMOUNT_INVALID`);
      else if (conservativeMinimum !== null && compareExactDecimals(amount, conservativeMinimum) < 0) {
        reasons.push(`${label}_UNDERSTATES_REQUEST`);
      }
    } catch {
      reasons.push(`${label}_AMOUNT_INVALID`);
    }
  }
}

function currentTruthState(truth: Readonly<TruthMetadata>, nowMs: number): TruthMetadata['completeness'] {
  try {
    if (truth.completeness !== 'COMPLETE') return truth.completeness;
    return assessCapitalTruth({
      source: truth.source,
      evaluatedAtMs: nowMs,
      requiredValuePresent: true,
      reasons: truth.reasons,
      evidenceReferences: truth.evidenceReferences,
      revision: truth.revision,
    }).completeness;
  } catch {
    return 'UNKNOWN';
  }
}

function sizingAuthoritySemantics(candidate: Readonly<AllocationCandidate>): unknown {
  return Object.freeze({
    consideration: candidate.consideration,
    considerationId: candidate.considerationId,
    considerationDigest: candidate.considerationDigest,
    eligibilityPolicyRevision: candidate.eligibilityPolicyRevision,
    sizingAuthoritySourceId: candidate.sizingAuthority.sourceId,
    eligibilityStatus: candidate.eligibilityStatus,
    considerationMode: candidate.considerationMode,
    truth: candidate.truth,
    strategy: candidate.strategy,
    valuationAsset: candidate.valuationAsset,
    primarySymbol: candidate.primarySymbol,
    economicDirection: candidate.economicDirection,
    requestedAmount: candidate.requestedAmount,
    grossExposureIncrease: candidate.grossExposureIncrease,
    netDirectionalExposureDelta: candidate.netDirectionalExposureDelta,
    collateralRequired: candidate.collateralRequired,
    marginRequired: candidate.marginRequired,
    strategyRequirements: candidate.strategyRequirements,
    symbolRequirements: candidate.symbolRequirements,
    correlatedGroupRequirements: candidate.correlatedGroupRequirements,
    venueInstrumentRequirements: candidate.venueInstrumentRequirements,
    borrowRequired: candidate.borrowRequired,
    borrowRequirements: candidate.borrowRequirements,
    liquidityRequirements: candidate.liquidityRequirements,
    conflictingConsiderationIds: candidate.conflictingConsiderationIds,
  });
}

/**
 * Content-addresses the complete upstream consideration and every allocation
 * geometry field. This is a deterministic integrity receipt, not issuer
 * authentication; a trusted sizing adapter remains a future boundary. The
 * allocator's independent conservative charge laws remain mandatory even for
 * a caller that can recompute this revision.
 */
export function deriveAllocationSizingAuthorityRevision(
  candidate: Readonly<AllocationCandidate>,
): AllocationCandidate['sizingAuthority']['revision'] {
  return deriveCapitalConfigRevision('allocation-sizing-authority', sizingAuthoritySemantics(candidate));
}

function truthValidityExclusiveMs(truth: Readonly<TruthMetadata>): number | null {
  try {
    if (truth.completeness !== 'COMPLETE') return null;
    const basis = truth.source.sourceTimeMs ?? truth.source.receivedAtMs;
    const inclusive = basis + truth.source.maxAgeMs;
    const exclusive = inclusive + 1;
    return isValidUtcMillis(exclusive) ? exclusive : null;
  } catch {
    return null;
  }
}

function allocationReplayReceipt(
  input: Readonly<AllocationBatchInput>,
  candidate: Readonly<AllocationCandidate>,
  decision: Readonly<AllocationDecision>,
  batchCandidateDigests: readonly string[],
): Readonly<AllocationAuthorityReceipt> {
  const snapshotUntil = truthValidityExclusiveMs(input.snapshot.truth);
  const candidateUntil = truthValidityExclusiveMs(candidate.truth);
  const validUntilMs = snapshotUntil === null || candidateUntil === null
    ? null
    : Math.min(snapshotUntil, candidateUntil, input.policy.authority.effectiveUntilMs ?? snapshotUntil);
  const semantic = Object.freeze({
    allocationDecisionId: decision.id,
    considerationId: decision.considerationId,
    decisionDigest: capitalDigest(decision),
    policyRevision: input.policy.authority.revision,
    policyDigest: capitalDigest(input.policy),
    snapshotDigest: capitalDigest(input.snapshot),
    candidateDigest: capitalDigest(candidate),
    batchCandidateDigests: Object.freeze([...batchCandidateDigests]),
    decidedAtMs: decision.decidedAtMs,
    validUntilMs,
  });
  return Object.freeze({ ...semantic, digest: capitalDigest(semantic) });
}

export function validateAllocationCandidate(candidate: Readonly<AllocationCandidate>, nowMs: number): readonly string[] {
  const reasons: string[] = [];
  const validNow = isValidUtcMillis(nowMs);
  if (!validNow) reasons.push('NOW_INVALID');

  let consideration: AllocationCandidate['consideration'] | null = null;
  try {
    consideration = candidate.consideration;
    if (consideration === null || typeof consideration !== 'object') throw new TypeError('consideration missing');
    if (!nonEmptyExactString(candidate.eligibilityPolicyRevision)) reasons.push('ELIGIBILITY_POLICY_REVISION_INVALID');
    if (!canonicalDigest(candidate.considerationDigest)
      || candidate.considerationDigest !== capitalDigest(consideration)) {
      reasons.push('CONSIDERATION_DIGEST_MISMATCH');
    }
    const expectedConsiderationId = deriveOpportunityConsiderationId({
      proposalId: consideration.proposal.sourceProposalId,
      proposalRevision: consideration.proposal.sourceRevision,
      intakeDigest: consideration.proposal.intakeDigest,
      policyRevision: candidate.eligibilityPolicyRevision,
    });
    if (candidate.considerationId !== consideration.id || candidate.considerationId !== expectedConsiderationId) {
      reasons.push('CONSIDERATION_ID_MISMATCH');
    }
    if (candidate.eligibilityStatus !== consideration.status) reasons.push('CONSIDERATION_STATUS_BINDING_MISMATCH');
    if (candidate.considerationMode !== consideration.mode) reasons.push('CONSIDERATION_MODE_BINDING_MISMATCH');
    if (capitalDigest(candidate.truth) !== capitalDigest(consideration.truth)) reasons.push('CONSIDERATION_TRUTH_BINDING_MISMATCH');
    if (candidate.strategy !== consideration.proposal.strategy) reasons.push('CONSIDERATION_STRATEGY_BINDING_MISMATCH');
    if (candidate.valuationAsset !== consideration.economics.valuationAsset) reasons.push('CONSIDERATION_VALUATION_BINDING_MISMATCH');
    if (candidate.primarySymbol !== consideration.proposal.symbol) reasons.push('CONSIDERATION_SYMBOL_BINDING_MISMATCH');
    if (candidate.economicDirection !== considerationEconomicDirection(consideration)) {
      reasons.push('CONSIDERATION_DIRECTION_BINDING_MISMATCH');
    }
    if (candidate.requestedAmount !== consideration.economics.requestedCapital) reasons.push('CONSIDERATION_REQUEST_BINDING_MISMATCH');
    if (capitalDigest(candidate.conflictingConsiderationIds) !== capitalDigest(consideration.conflictingConsiderationIds)) {
      reasons.push('CONSIDERATION_CONFLICT_BINDING_MISMATCH');
    }
    if (!isValidUtcMillis(consideration.evaluatedAtMs)
      || (validNow && consideration.evaluatedAtMs > nowMs)) reasons.push('CONSIDERATION_EVALUATED_AT_INVALID');
    // Eligibility owns evidence requirements. Optional absent evidence may be
    // UNKNOWN while the content-bound consideration itself is still ELIGIBLE
    // with COMPLETE aggregate truth; allocation must not invent a stricter,
    // duplicate evidence policy here.
    if (consideration.proposal.strategy === 'VOLUME') reasons.push('CONSIDERATION_STRATEGY_NOT_CAPITAL_AUTHORIZED');
  } catch {
    reasons.push('CONSIDERATION_BINDING_INVALID');
  }

  try {
    if (!nonEmptyExactString(candidate.sizingAuthority.sourceId)) reasons.push('SIZING_AUTHORITY_SOURCE_INVALID');
    if (!nonEmptyExactString(candidate.sizingAuthority.revision)
      || candidate.sizingAuthority.revision !== deriveAllocationSizingAuthorityRevision(candidate)) {
      reasons.push('SIZING_AUTHORITY_REVISION_MISMATCH');
    }
  } catch {
    reasons.push('SIZING_AUTHORITY_INVALID');
  }

  if (candidate.eligibilityStatus !== 'ELIGIBLE') reasons.push(`CONSIDERATION_${candidate.eligibilityStatus}`);
  if (candidate.considerationMode !== 'MANUAL_ARMED') reasons.push(`MODE_${candidate.considerationMode}_CANNOT_RESERVE`);
  const truthState = currentTruthState(candidate.truth, validNow ? nowMs : 0);
  let permitsExposure = false;
  try {
    permitsExposure = truthAllowsNewExposure(candidate.truth);
  } catch {
    permitsExposure = false;
  }
  if (truthState !== 'COMPLETE' || !permitsExposure) reasons.push(`CONSIDERATION_TRUTH_${truthState}`);
  if (!canonicalCapitalIdentifier(candidate.valuationAsset)) reasons.push('VALUATION_ASSET_NOT_CANONICAL');
  if (!canonicalCapitalIdentifier(candidate.primarySymbol)) reasons.push('PRIMARY_SYMBOL_NOT_CANONICAL');
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
  const requested = exactNonNegativeOrNull(candidate.requestedAmount);
  const gross = exactNonNegativeOrNull(candidate.grossExposureIncrease);
  const collateral = exactNonNegativeOrNull(candidate.collateralRequired);
  const margin = exactNonNegativeOrNull(candidate.marginRequired);
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
    if (gross !== null && compareExactDecimals(absoluteExactDecimal(candidate.netDirectionalExposureDelta), gross) > 0) {
      reasons.push('NET_DELTA_EXCEEDS_GROSS');
    }
  }
  if (requested !== null && gross !== null && compareExactDecimals(gross, requested) < 0) reasons.push('GROSS_UNDERSTATES_REQUEST');
  if (requested !== null && collateral !== null && compareExactDecimals(collateral, requested) !== 0) {
    reasons.push('COLLATERAL_MUST_EQUAL_REQUEST');
  }
  const minimumCharge = gross === null
    ? requested
    : requested === null
      ? gross
      : compareExactDecimals(gross, requested) >= 0 ? gross : requested;
  validateAmounts(candidate.strategyRequirements, 'STRATEGY_REQUIREMENT', reasons, true, minimumCharge);
  validateAmounts(candidate.symbolRequirements, 'SYMBOL_REQUIREMENT', reasons, true, minimumCharge);
  validateAmounts(candidate.correlatedGroupRequirements, 'CORRELATED_GROUP_REQUIREMENT', reasons, true, minimumCharge);
  validateAmounts(candidate.venueInstrumentRequirements, 'VENUE_INSTRUMENT_REQUIREMENT', reasons, true, minimumCharge);
  validateAmounts(candidate.borrowRequirements, 'BORROW_REQUIREMENT', reasons, candidate.borrowRequired === true, minimumCharge);
  validateAmounts(candidate.liquidityRequirements, 'LIQUIDITY_REQUIREMENT', reasons, true, minimumCharge);
  if (candidate.borrowRequired === null) reasons.push('BORROW_REQUIREMENT_UNKNOWN');
  if (candidate.borrowRequired === false && candidate.borrowRequirements.length > 0) reasons.push('BORROW_REQUIREMENT_CONTRADICTORY');
  if (consideration !== null) {
    const upstreamBorrowRequired = consideration.legs.some((leg) => leg.borrowRequired === null)
      ? null
      : consideration.legs.some((leg) => leg.borrowRequired === true);
    if (candidate.borrowRequired !== upstreamBorrowRequired) reasons.push('BORROW_REQUIREMENT_BINDING_MISMATCH');
    if (consideration.legs.length === 0) reasons.push('CONSIDERATION_LEGS_MISSING');
    if (consideration.legs.some((leg) => leg.role === 'PERPETUAL')
      && requested !== null && margin !== null && compareExactDecimals(margin, requested) < 0) {
      reasons.push('MARGIN_UNDERSTATES_PERPETUAL_REQUEST');
    }
    const upstreamLiquidity = exactNonNegativeOrNull(consideration.economics.liquidityCapacity);
    if (upstreamLiquidity === null) reasons.push('CONSIDERATION_LIQUIDITY_UNKNOWN');
    else if (requested !== null && compareExactDecimals(upstreamLiquidity, requested) < 0) {
      reasons.push('CONSIDERATION_LIQUIDITY_UNDERSIZES_REQUEST');
    }
  }
  if (!candidate.symbolRequirements.some((item) => item.key === candidate.primarySymbol)) reasons.push('PRIMARY_SYMBOL_REQUIREMENT_MISSING');
  if (!candidate.strategyRequirements.some((item) => item.key === candidate.strategy)) reasons.push('STRATEGY_REQUIREMENT_MISSING');
  if (candidate.strategyRequirements.length !== 1 || candidate.strategyRequirements[0]?.key !== candidate.strategy) {
    reasons.push('STRATEGY_REQUIREMENT_CONTRADICTORY');
  }
  return sortedUnique(reasons);
}

function blockedDecision(candidate: Readonly<AllocationCandidate>, nowMs: number, reasons: readonly string[], policyRevision: AllocationDecision['policyRevision']): AllocationDecision {
  const blockingReasons = sortedUnique(reasons);
  const priorityKey = candidate.considerationId;
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
    .sort((left, right) => compareText(capitalDigest(left), capitalDigest(right)))[0]);
  const conflictEligible = unique.filter((candidate) => validateAllocationCandidate(candidate, input.nowMs).length === 0);
  const conflicts = opposingConflicts(conflictEligible);
  const explicitConflicts = new Set<string>();
  for (const candidate of conflictEligible) {
    if (candidate.conflictingConsiderationIds.length > 0) explicitConflicts.add(candidate.considerationId);
    for (const id of candidate.conflictingConsiderationIds) explicitConflicts.add(id);
  }
  // Every candidate in this lane is an unopened opportunity. Scarce capital is
  // therefore ordered only by its canonical consideration identity; callers
  // cannot self-promote through scores, classes, or presentation labels.
  unique.sort((a, b) => compareText(a.considerationId, b.considerationId));

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
    if (plans >= input.policy.maximumConcurrentPlans.value) {
      grant = applyCap(audit, 'CONCURRENT_PLAN_LIMIT', grant, ZERO, 'maximum concurrent plans reached');
    }
    if (positions >= input.policy.maximumActivePositions.value) {
      grant = applyCap(audit, 'ACTIVE_POSITION_LIMIT', grant, ZERO, 'maximum active positions reached');
    }

    const dimensionalCaps = (
      code: string,
      requirements: readonly KeyedExactAmount[],
      use: Map<string, NonNegativeDecimal>,
      limit: NonNegativeDecimal,
    ): void => {
      for (const requirement of [...requirements].sort((a, b) => compareText(a.key, b.key))) {
        const allowed = grantForCapacity(nonNegativeDifference(limit, use.get(requirement.key) ?? ZERO), requirement.amount, candidate.requestedAmount);
        grant = applyCap(audit, `${code}:${requirement.key}`, grant, allowed, `${code.toLowerCase()} budget`);
      }
    };
    dimensionalCaps('STRATEGY', candidate.strategyRequirements, strategy, input.policy.perStrategyLimits[candidate.strategy].value);
    dimensionalCaps('SYMBOL', candidate.symbolRequirements, symbol, input.policy.perSymbolLimit.value);
    dimensionalCaps('CORRELATED_GROUP', candidate.correlatedGroupRequirements, correlated, input.policy.perCorrelatedGroupLimit.value);
    dimensionalCaps('VENUE_INSTRUMENT', candidate.venueInstrumentRequirements, venue, input.policy.perVenueInstrumentLimit.value);
    for (const requirement of [...candidate.borrowRequirements].sort((a, b) => compareText(a.key, b.key))) {
      const capacity = borrow.get(requirement.key);
      grant = applyCap(audit, `BORROW:${requirement.key}`, grant,
        capacity === undefined ? ZERO : grantForCapacity(capacity, requirement.amount, candidate.requestedAmount),
        capacity === undefined ? 'borrow capacity unknown' : 'remaining borrow capacity');
    }
    for (const requirement of [...candidate.liquidityRequirements].sort((a, b) => compareText(a.key, b.key))) {
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
    const priorityKey = candidate.considerationId;
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
    // A positive grant authorizes one unopened opportunity, so it always
    // consumes one plan slot and one prospective active-position slot.
    plans += 1;
    positions += 1;
  }

  return Object.freeze({
    decisions: Object.freeze(decisions),
    authorities: Object.freeze(decisions.map((decision) => {
      const candidate = unique.find((entry) => entry.considerationId === decision.considerationId);
      if (candidate === undefined) throw new TypeError('allocation decision lost its canonical candidate binding');
      const batchCandidateDigests = [...input.candidates].map((entry) => capitalDigest(entry)).sort(compareText);
      return allocationReplayReceipt(input, candidate, decision, batchCandidateDigests);
    })),
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
