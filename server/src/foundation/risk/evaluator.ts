/**
 * Lane D — multi-leg risk evaluator: the single entry point.
 *
 * evaluateMultiLegRisk(input) is a PURE function from one fully-injected
 * snapshot to a frozen RiskVerdict:
 *   - no I/O, no clock reads (nowMs is injected), no env access;
 *   - inputs are never mutated;
 *   - same input => byte-identical verdict (stable check ordering, and
 *     blockingCodes inherit that order via deriveRiskVerdict).
 *
 * CHECK ORDER (fixed; per-leg codes are suffixed with stable legKey):
 *   KILL_SWITCH,
 *   APPROVAL_PRESENT, APPROVAL_EXPIRY, APPROVAL_SCOPE,
 *   RECOVERY_RISK_REDUCTION,
 *   PROPOSAL_PRESENT, PROPOSAL_EXPIRY,
 *   EVIDENCE_AUTHORITY,
 *   LEG_EVIDENCE_FRESHNESS_i...,
 *   SPOT_PERP_SKEW,
 *   PERMISSION_POSTURE,
 *   SYMBOL_FILTERS_i...,
 *   LEG_NOTIONAL_i...,
 *   MAX_GROSS_NOTIONAL, HEDGE_RATIO_TOLERANCE, RESIDUAL_DELTA,
 *   MAX_NAKED_DURATION,
 *   NET_EDGE, COST_EVIDENCE, SPREAD, DEPTH, SLIPPAGE,
 *   MARGIN_HEADROOM, LIQUIDATION_DISTANCE,
 *   BORROW_AVAILABILITY, BORROW_AMOUNT, BORROW_RATE, BORROW_FRESHNESS,
 *   DAILY_LOSS_LIMIT, DAILY_NOTIONAL_LIMIT,
 *   DUPLICATE_ACTIVE_PLAN, OPEN_ORDER_LIMIT, COOLDOWN.
 *
 * FAIL-CLOSED: deriveRiskVerdict (frozen contract) allows only when every
 * blocking check is PASS; blocking UNKNOWN blocks exactly like FAIL.
 *
 * FUTURE WIRING SEAM: a future execution coordinator (Lane C) calls this
 * before any leg submission, passing a snapshot it assembles from the
 * control plane (kill switch), the operator approval store, the canonical
 * read model (proposal), the exchange boundary (market/filters/account),
 * borrow truth, its own plan registry, and its injected clock. Nothing in
 * this module registers routes, timers, or singletons.
 * Race-free wiring order is coordinator-owned: atomically claim/reserve the
 * plan identity, snapshot the registry/account evidence, evaluate this pure
 * verdict, then submit only while both the claim and verdict remain valid.
 * The evaluator deliberately does not pretend a pure snapshot can provide
 * the coordinator's atomic reservation guarantee.
 *
 * LIVE AUTHORITY: NONE. This module can never place, modify, or cancel
 * anything; it only judges snapshots.
 */
import type { RiskCheck, RiskVerdict, SourcedTimestamp } from '../contracts/index.js';
import {
  deriveRiskVerdict,
  isValidUtcMillis,
  validateSourcedTimestamp,
} from '../contracts/index.js';
import {
  checkApproval,
  checkBorrow,
  checkCooldown,
  checkDailyLimits,
  checkDuplicatePlan,
  checkEdgeEvidence,
  checkEvidenceAuthority,
  checkGrossNotional,
  checkHedgeRatio,
  checkKillSwitch,
  checkLegFreshness,
  checkLegNotional,
  checkLiquidationDistance,
  checkMarginHeadroom,
  checkMaxNakedDuration,
  checkOpenOrderLimit,
  checkPermissionPosture,
  checkProposal,
  checkRecoveryRiskReduction,
  checkResidualDelta,
  checkSpotPerpSkew,
  checkSpotInventory,
  checkSymbolFilters,
} from './checks.js';
import type { PlanIntent, RiskEvaluationInput } from './types.js';
import { validateRiskEvaluationInput } from './types.js';

function effectiveVerdictHorizon(
  input: RiskEvaluationInput,
  intent: PlanIntent,
  checks: readonly Readonly<RiskCheck>[],
): { ttlMs: number; expiresAt: number } {
  let expiresAt = input.nowMs + input.policy.verdictTtlMs;
  const clampToHorizon = (horizonMs: number): void => {
    if (isValidUtcMillis(horizonMs)) {
      expiresAt = Math.min(expiresAt, Math.max(input.nowMs, horizonMs));
    }
  };
  const isEntry = intent.riskClass === 'RISK_INCREASING';
  if (isValidUtcMillis(input.approval?.expiresAtMs)) {
    clampToHorizon(input.approval.expiresAtMs);
  }
  if (isEntry && isValidUtcMillis(input.proposal?.expiresAtMs)) {
    clampToHorizon(input.proposal.expiresAtMs);
  }

  const timestamps: unknown[] = [];
  const push = (value: unknown): void => {
    if (value !== null && value !== undefined) timestamps.push(value);
  };
  push(input.approval?.observedAt);
  if (isEntry) {
    push(input.killSwitch?.observedAt);
    push(input.proposal?.observedAt);
    push(input.market?.edgeObservedAt);
  }
  if (Array.isArray(input.market?.legs)) {
    const keys = new Set(intent.legs.map((leg) => leg.legKey));
    for (const row of input.market.legs) {
      if (typeof row === 'object' && row !== null && keys.has(row.legKey)) {
        push(row.observedAt);
        push(row.filters?.observedAt);
      }
    }
  }
  push(input.account?.permissions?.observedAt);
  if (Array.isArray(input.account?.spotInventory)) {
    const cashSymbols = new Set(
      intent.legs
        .filter((leg) => leg.positionBucket === 'SPOT_CASH')
        .map((leg) => leg.symbol),
    );
    for (const row of input.account.spotInventory) {
      if (typeof row === 'object' && row !== null && cashSymbols.has(row.symbol)) push(row.observedAt);
    }
  }
  if (!isEntry || intent.legs.some((leg) => leg.venue === 'BINANCE_USDM')) {
    push(input.account?.exposures?.observedAt);
  }
  if (!isEntry && Array.isArray(input.account?.exposures?.positions)) {
    const symbols = new Set(intent.legs.map((leg) => leg.symbol));
    for (const row of input.account.exposures.positions) {
      if (typeof row === 'object' && row !== null && symbols.has(row.symbol)) push(row.observedAt);
    }
  }
  if (Array.isArray(input.account?.marginHeadrooms)) {
    const requiredScopes = new Set(
      intent.legs
        .filter(
          (leg) =>
            (leg.venue === 'BINANCE_USDM' || leg.requiredPermission === 'MARGIN') &&
            (isEntry || leg.estimatedRequiredMarginUsd !== 0),
        )
        .map((leg) => `${leg.positionBucket}:${leg.positionBucket === 'MARGIN_ISOLATED' ? leg.symbol : '*'}`),
    );
    for (const row of input.account.marginHeadrooms) {
      if (typeof row !== 'object' || row === null) continue;
      const scope = `${row.positionBucket}:${row.scopeSymbol ?? '*'}`;
      if (requiredScopes.has(scope)) push(row.observedAt);
    }
  }
  const liquidationCheck = checks.find((check) => check.code === 'LIQUIDATION_DISTANCE');
  if (liquidationCheck?.status === 'PASS' && liquidationCheck.evidenceTimestamp !== null && Array.isArray(input.account?.liquidations)) {
    const perpKeys = new Set(intent.legs.filter((leg) => leg.venue === 'BINANCE_USDM').map((leg) => leg.legKey));
    for (const row of input.account.liquidations) {
      if (typeof row === 'object' && row !== null && perpKeys.has(row.legKey)) push(row.observedAt);
    }
  }
  if (isEntry) {
    push(input.account?.dailyStatsObservedAt);
    push(input.account?.openOrders?.observedAt);
    push(input.cooldown?.observedAt);
  }
  if (intent.requiredBorrowUsd !== 0) push(input.borrow?.observedAt);
  push(input.existingPlans?.observedAt);
  if (isEntry && isValidUtcMillis(input.account?.dailyPeriodEndMs)) {
    clampToHorizon(input.account.dailyPeriodEndMs);
  }

  for (const candidate of timestamps) {
    if (validateSourcedTimestamp(candidate).length > 0) continue;
    const ts = candidate as SourcedTimestamp;
    const basis = ts.sourceTimeMs ?? ts.receivedAtMs;
    const horizon = basis + ts.maxAgeMs;
    if (Number.isSafeInteger(horizon)) clampToHorizon(horizon);
  }
  return {
    ttlMs: Math.max(1, expiresAt - input.nowMs),
    expiresAt,
  };
}

/**
 * Evaluate a multi-leg action snapshot into a frozen RiskVerdict.
 * Throws TypeError only for malformed nowMs/intent/policy (programmer
 * error); missing or malformed EVIDENCE becomes UNKNOWN checks instead.
 */
export function evaluateMultiLegRisk(input: RiskEvaluationInput): Readonly<RiskVerdict> {
  const issues = validateRiskEvaluationInput(input);
  if (issues.length > 0) {
    throw new TypeError(
      `evaluateMultiLegRisk: invalid input — ${issues.map((i) => `${i.path}:${i.code}`).join(', ')}`,
    );
  }

  const { nowMs, policy } = input;
  // Approval/proposal digests already canonicalize leg order. Run every
  // arithmetic and per-leg pass over that same stable order so callers cannot
  // change a verdict by permuting semantically identical legs.
  const intent: PlanIntent = {
    ...input.intent,
    legs: Object.freeze(
      [...input.intent.legs].sort((a, b) =>
        a.legKey < b.legKey ? -1 : a.legKey > b.legKey ? 1 : 0,
      ),
    ),
  };
  const riskClass = intent.riskClass;
  const proposal = input.proposal ?? null;
  const approval = input.approval ?? null;
  const killSwitch = input.killSwitch ?? null;
  const market = input.market ?? null;
  const account = input.account ?? null;
  const borrow = input.borrow ?? null;
  const existingPlans = input.existingPlans ?? null;
  const cooldown = input.cooldown ?? null;

  const checks: Readonly<RiskCheck>[] = [
    checkKillSwitch(killSwitch, nowMs, riskClass, intent.accountId),
    ...checkApproval(approval, intent, nowMs, riskClass),
    checkRecoveryRiskReduction(intent, account, nowMs),
    ...checkProposal(proposal, intent, nowMs, riskClass),
    checkEvidenceAuthority(
      {
        intent,
        killSwitch,
        approval,
        proposal,
        market,
        account,
        borrow,
        existingPlans,
        cooldown,
      },
      policy,
      riskClass,
    ),
    ...checkLegFreshness(intent, market, nowMs, riskClass),
    checkSpotPerpSkew(intent, market, policy, riskClass),
    checkPermissionPosture(intent, account, nowMs, riskClass),
    checkSpotInventory(intent, market, account, nowMs),
    ...checkSymbolFilters(intent, market, nowMs, riskClass),
    ...checkLegNotional(intent, market, policy, riskClass),
    checkGrossNotional(intent, market, policy, riskClass),
    checkHedgeRatio(intent, policy, riskClass),
    checkResidualDelta(intent, market, policy, riskClass),
    checkMaxNakedDuration(intent, policy, riskClass),
    ...checkEdgeEvidence(market, intent, policy, nowMs, riskClass),
    checkMarginHeadroom(intent, market, account, policy, nowMs, riskClass),
    checkLiquidationDistance(intent, market, account, policy, nowMs, riskClass),
    ...checkBorrow(intent, market, account, borrow, policy, nowMs, riskClass),
    ...checkDailyLimits(intent, market, account, policy, nowMs, riskClass),
    checkDuplicatePlan(intent, existingPlans, nowMs, riskClass),
    checkOpenOrderLimit(intent, account, policy, nowMs, riskClass),
    checkCooldown(intent, cooldown, policy, nowMs, riskClass),
  ];

  const horizon = effectiveVerdictHorizon(input, intent, checks);
  const verdict = deriveRiskVerdict({
    checks,
    evaluatedAt: nowMs,
    ttlMs: horizon.ttlMs,
  });
  if (verdict.expiresAt === horizon.expiresAt) return verdict;
  // Frozen deriveRiskVerdict intentionally requires a positive TTL. At an
  // exact evidence boundary the safe hard horizon is evaluatedAt itself;
  // retain the shared fail-closed derivation and clamp only the expiry field.
  return Object.freeze({ ...verdict, expiresAt: horizon.expiresAt });
}
