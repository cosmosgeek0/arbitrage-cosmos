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
  canonicalJson,
  deriveRiskVerdict,
  isValidUtcMillis,
  riskMaximumExactDecimal,
  stableHash128Hex,
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
import type {
  NormalBasisApprovedRiskBinding,
  NormalBasisRiskBaseline,
  NormalBasisRiskLegBinding,
  PlanIntent,
  RiskEvaluationInput,
} from './types.js';
import {
  deriveRiskIntentDigest,
  NORMAL_BASIS_RISK_BINDING_SCHEMA,
  NORMAL_BASIS_RISK_BINDING_VERSION,
  validateRiskEvaluationInput,
} from './types.js';

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
 * Verdict-scoped gross-USD authority: an approval can authorize no more than
 * the exact plan size that was evaluated; a known rejection authorizes zero;
 * missing decisive evidence remains null rather than inventing permission.
 */
function deriveMaximumAllowedSize(checks: readonly Readonly<RiskCheck>[]): number | null {
  if (checks.some((check) => check.blocking && check.status === 'UNKNOWN')) return null;
  if (checks.some((check) => check.blocking && check.status === 'FAIL')) return 0;
  const gross = checks.find((check) => check.code === 'MAX_GROSS_NOTIONAL');
  const amount = typeof gross?.observed === 'number'
    ? gross.observed
    : typeof gross?.observed === 'string'
      ? Number(gross.observed)
      : null;
  return amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null;
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
    correlationId: input.correlationId,
    checks,
    evaluatedAt: nowMs,
    ttlMs: horizon.ttlMs,
    maxAllowedSize: deriveMaximumAllowedSize(checks),
  });
  if (verdict.expiresAt === horizon.expiresAt) return verdict;
  // Frozen deriveRiskVerdict intentionally requires a positive TTL. At an
  // exact evidence boundary the safe hard horizon is evaluatedAt itself;
  // retain the shared fail-closed derivation and clamp only the expiry field.
  return Object.freeze({ ...verdict, expiresAt: horizon.expiresAt });
}

// ---------------------------------------------------------------------------
// Normal-Basis approved-entry projection (pure, additive, default off)
// ---------------------------------------------------------------------------

/** Existing riskv_ law already used by the canonical engine attachment path. */
export function deriveRiskVerdictDigest(verdict: Readonly<RiskVerdict>): string {
  return `riskv_${stableHash128Hex(`foundationRiskVerdict|${canonicalJson(verdict)}`)}`;
}

function freshCompleteBasisMs(value: unknown, nowMs: number, label: string): number {
  const issues = validateSourcedTimestamp(value);
  if (issues.length > 0) throw new TypeError(`${label} must be a valid sourced timestamp`);
  const stamp = value as SourcedTimestamp;
  if (stamp.completeness !== 'COMPLETE') {
    throw new TypeError(`${label} must be COMPLETE`);
  }
  const basis = stamp.sourceTimeMs ?? stamp.receivedAtMs;
  if (basis > nowMs || nowMs - basis > stamp.maxAgeMs) {
    throw new TypeError(`${label} must be fresh at the risk evaluation time`);
  }
  return basis;
}

function normalBasisLegs(intent: PlanIntent): {
  spot: PlanIntent['legs'][number];
  perp: PlanIntent['legs'][number];
} {
  if (intent.riskClass !== 'RISK_INCREASING') {
    throw new TypeError('normal-Basis binding requires a risk-increasing entry intent');
  }
  if (intent.requiredBorrowUsd !== 0) {
    throw new TypeError('normal-Basis binding does not support borrow or reverse Basis');
  }
  if (intent.legs.length !== 2) {
    throw new TypeError('normal-Basis binding requires exactly two entry legs');
  }
  const spot = intent.legs.find(
    (leg) =>
      leg.venue === 'BINANCE_SPOT' &&
      leg.positionBucket === 'SPOT_CASH' &&
      leg.requiredPermission === 'SPOT' &&
      leg.side === 'BUY',
  );
  const perp = intent.legs.find(
    (leg) =>
      leg.venue === 'BINANCE_USDM' &&
      leg.positionBucket === 'USDM_ONE_WAY' &&
      leg.requiredPermission === 'FUTURES' &&
      leg.side === 'SELL',
  );
  if (spot === undefined || perp === undefined || spot.symbol !== perp.symbol) {
    throw new TypeError(
      'normal-Basis binding requires one cash Spot BUY and one same-symbol one-way USD-M SELL',
    );
  }
  if (
    intent.proposalRef === null ||
    intent.declaredMaxNakedDurationMs === null
  ) {
    throw new TypeError('normal-Basis binding requires proposal and naked-duration intent terms');
  }
  return { spot, perp };
}

function legProjection(leg: PlanIntent['legs'][number]): Readonly<NormalBasisRiskLegBinding> {
  return Object.freeze({
    legKey: leg.legKey,
    venue: leg.venue as 'BINANCE_SPOT' | 'BINANCE_USDM',
    positionBucket: leg.positionBucket as 'SPOT_CASH' | 'USDM_ONE_WAY',
    side: leg.side,
    symbol: leg.symbol,
    intendedPrice: leg.intendedPrice,
    intendedQty: leg.intendedQty,
  });
}

function deriveNormalBasisBaseline(
  input: RiskEvaluationInput,
  symbol: string,
): Readonly<NormalBasisRiskBaseline> {
  const snapshot = input.account?.exposures;
  if (
    snapshot === null ||
    snapshot === undefined ||
    snapshot.accountId !== input.intent.accountId ||
    snapshot.positionMode !== 'ONE_WAY' ||
    !Array.isArray(snapshot.positions)
  ) {
    throw new TypeError(
      'normal-Basis binding requires a complete account-bound one-way exposure baseline',
    );
  }
  const observedAtMs = freshCompleteBasisMs(
    snapshot.observedAt,
    input.nowMs,
    'normal-Basis exposure baseline',
  );
  const quantity = (
    venue: 'BINANCE_SPOT' | 'BINANCE_USDM',
    positionBucket: 'SPOT_CASH' | 'USDM_ONE_WAY',
  ): number => {
    const matches = snapshot.positions.filter(
      (row) =>
        typeof row === 'object' &&
        row !== null &&
        row.venue === venue &&
        row.symbol === symbol &&
        row.positionBucket === positionBucket,
    );
    if (matches.length > 1) {
      throw new TypeError(`normal-Basis exposure baseline duplicates ${venue}/${positionBucket}`);
    }
    if (matches.length === 0) return 0;
    const row = matches[0];
    if (typeof row.signedBaseQty !== 'number' || !Number.isFinite(row.signedBaseQty)) {
      throw new TypeError(`normal-Basis exposure baseline has invalid ${venue} quantity`);
    }
    freshCompleteBasisMs(row.observedAt, input.nowMs, `normal-Basis ${venue} baseline row`);
    return Object.is(row.signedBaseQty, -0) ? 0 : row.signedBaseQty;
  };
  return Object.freeze({
    accountId: input.intent.accountId,
    symbol,
    positionMode: 'ONE_WAY' as const,
    observedAtMs,
    spotSignedBaseQty: quantity('BINANCE_SPOT', 'SPOT_CASH'),
    perpSignedBaseQty: quantity('BINANCE_USDM', 'USDM_ONE_WAY'),
  });
}

/**
 * Evaluate and bind the sole supported normal-Basis entry.
 *
 * The caller supplies the real RiskEvaluationInput, never verdict claims.
 * Generic evaluateMultiLegRisk and deriveRiskIntentDigest remain unchanged;
 * this projection consumes their exact outputs and the existing riskv_ law.
 */
export function evaluateNormalBasisRiskBinding(
  input: RiskEvaluationInput,
): Readonly<NormalBasisApprovedRiskBinding> {
  const verdict = evaluateMultiLegRisk(input);
  const { spot, perp } = normalBasisLegs(input.intent);
  if (
    verdict.correlationId !== input.correlationId ||
    verdict.decision !== 'APPROVED' ||
    verdict.allowed !== true ||
    verdict.requiredConfirmation !== false ||
    verdict.maxAllowedSize === null ||
    !Number.isFinite(verdict.maxAllowedSize) ||
    verdict.maxAllowedSize <= 0
  ) {
    throw new TypeError('normal-Basis binding requires the real allowing generic risk verdict');
  }
  if (
    input.proposal === null ||
    input.approval === null ||
    input.intent.proposalRef === null ||
    input.proposal.proposalId !== input.intent.proposalRef ||
    input.proposal.entryIntentDigest !== deriveRiskIntentDigest(input.intent) ||
    input.approval.intentDigest !== deriveRiskIntentDigest(input.intent)
  ) {
    throw new TypeError('normal-Basis binding requires proposal and approval bound to the real intent');
  }
  const entryExpiresAtMs = Math.min(
    verdict.expiresAt,
    input.proposal.expiresAtMs ?? verdict.expiresAt,
    input.approval.expiresAtMs,
  );
  if (!isValidUtcMillis(entryExpiresAtMs) || entryExpiresAtMs <= input.nowMs) {
    throw new TypeError('normal-Basis entry authority must have a future earliest expiry');
  }
  const grossEntryNotional =
    spot.intendedPrice * spot.intendedQty + perp.intendedPrice * perp.intendedQty;
  if (
    !Number.isFinite(grossEntryNotional) ||
    grossEntryNotional <= 0 ||
    grossEntryNotional > verdict.maxAllowedSize
  ) {
    throw new TypeError('normal-Basis entry exceeds the exact approved gross-USD cap');
  }
  const baseline = deriveNormalBasisBaseline(input, spot.symbol);
  const riskIntentDigest = deriveRiskIntentDigest(input.intent);
  const riskVerdictDigest = deriveRiskVerdictDigest(verdict);
  const approvedEntryGrossNotionalExact = riskMaximumExactDecimal(verdict.maxAllowedSize);
  if (approvedEntryGrossNotionalExact === null) {
    throw new TypeError('normal-Basis approved entry cap must be known');
  }
  const semantic = {
    schema: NORMAL_BASIS_RISK_BINDING_SCHEMA,
    version: NORMAL_BASIS_RISK_BINDING_VERSION,
    planId: input.intent.planId,
    correlationId: input.correlationId,
    accountId: input.intent.accountId,
    proposalRef: input.intent.proposalRef,
    riskClass: 'RISK_INCREASING' as const,
    riskIntentDigest,
    riskVerdictDigest,
    verdictDecision: 'APPROVED' as const,
    verdictEvaluatedAtMs: verdict.evaluatedAt,
    entryExpiresAtMs,
    approvedEntryGrossNotionalExact,
    declaredMaxNakedDurationMs: input.intent.declaredMaxNakedDurationMs as number,
    requiredBorrowUsd: 0 as const,
    spot: legProjection(spot),
    perp: legProjection(perp),
    baseline,
  };
  return Object.freeze({
    ...semantic,
    bindingId: `nbrisk_${stableHash128Hex(
      `normalBasisApprovedRisk|${canonicalJson(semantic)}`,
    )}`,
  });
}

const NORMAL_BASIS_RISK_BINDING_KEYS = Object.freeze([
  'schema',
  'version',
  'bindingId',
  'planId',
  'correlationId',
  'accountId',
  'proposalRef',
  'riskClass',
  'riskIntentDigest',
  'riskVerdictDigest',
  'verdictDecision',
  'verdictEvaluatedAtMs',
  'entryExpiresAtMs',
  'approvedEntryGrossNotionalExact',
  'declaredMaxNakedDurationMs',
  'requiredBorrowUsd',
  'spot',
  'perp',
  'baseline',
] as const);

/**
 * Validate a serialized compact projection without pretending to re-evaluate
 * historical evidence. New bindings can only be created by the real evaluator
 * above; replay verifies the exact closed shape and its content identity.
 */
export function validateNormalBasisApprovedRiskBinding(
  candidate: unknown,
): Readonly<NormalBasisApprovedRiskBinding> {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new TypeError('normal-Basis risk binding must be an object');
  }
  const risk = candidate as NormalBasisApprovedRiskBinding;
  if (
    Object.keys(candidate).sort().join('|') !== [...NORMAL_BASIS_RISK_BINDING_KEYS].sort().join('|') ||
    risk.schema !== NORMAL_BASIS_RISK_BINDING_SCHEMA ||
    risk.version !== NORMAL_BASIS_RISK_BINDING_VERSION ||
    typeof risk.bindingId !== 'string' ||
    !/^nbrisk_[0-9a-f]{32}$/.test(risk.bindingId) ||
    typeof risk.planId !== 'string' ||
    typeof risk.correlationId !== 'string' ||
    typeof risk.accountId !== 'string' ||
    typeof risk.proposalRef !== 'string' ||
    risk.riskClass !== 'RISK_INCREASING' ||
    !/^riskint_[0-9a-f]{32}$/.test(risk.riskIntentDigest) ||
    !/^riskv_[0-9a-f]{32}$/.test(risk.riskVerdictDigest) ||
    risk.verdictDecision !== 'APPROVED' ||
    !isValidUtcMillis(risk.verdictEvaluatedAtMs) ||
    !isValidUtcMillis(risk.entryExpiresAtMs) ||
    risk.entryExpiresAtMs <= risk.verdictEvaluatedAtMs ||
    typeof risk.approvedEntryGrossNotionalExact !== 'string' ||
    !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(risk.approvedEntryGrossNotionalExact) ||
    /^0(?:\.0*)?$/.test(risk.approvedEntryGrossNotionalExact) ||
    !Number.isSafeInteger(risk.declaredMaxNakedDurationMs) ||
    risk.declaredMaxNakedDurationMs <= 0 ||
    risk.requiredBorrowUsd !== 0
  ) {
    throw new TypeError('normal-Basis risk binding has invalid authority terms');
  }
  const validLeg = (
    leg: NormalBasisRiskLegBinding,
    venue: 'BINANCE_SPOT' | 'BINANCE_USDM',
    positionBucket: 'SPOT_CASH' | 'USDM_ONE_WAY',
    side: 'BUY' | 'SELL',
  ): boolean =>
    typeof leg === 'object' &&
    leg !== null &&
    Object.keys(leg).sort().join('|') ===
      ['legKey', 'venue', 'positionBucket', 'side', 'symbol', 'intendedPrice', 'intendedQty'].sort().join('|') &&
    leg.venue === venue &&
    leg.positionBucket === positionBucket &&
    leg.side === side &&
    typeof leg.legKey === 'string' &&
    typeof leg.symbol === 'string' &&
    typeof leg.intendedPrice === 'number' &&
    Number.isFinite(leg.intendedPrice) &&
    leg.intendedPrice > 0 &&
    typeof leg.intendedQty === 'number' &&
    Number.isFinite(leg.intendedQty) &&
    leg.intendedQty > 0;
  const baseline = risk.baseline;
  if (
    !validLeg(risk.spot, 'BINANCE_SPOT', 'SPOT_CASH', 'BUY') ||
    !validLeg(risk.perp, 'BINANCE_USDM', 'USDM_ONE_WAY', 'SELL') ||
    risk.spot.symbol !== risk.perp.symbol ||
    typeof baseline !== 'object' ||
    baseline === null ||
    Object.keys(baseline).sort().join('|') !==
      ['accountId', 'symbol', 'positionMode', 'observedAtMs', 'spotSignedBaseQty', 'perpSignedBaseQty'].sort().join('|') ||
    baseline.accountId !== risk.accountId ||
    baseline.symbol !== risk.spot.symbol ||
    baseline.positionMode !== 'ONE_WAY' ||
    !isValidUtcMillis(baseline.observedAtMs) ||
    !Number.isFinite(baseline.spotSignedBaseQty) ||
    !Number.isFinite(baseline.perpSignedBaseQty)
  ) {
    throw new TypeError('normal-Basis risk binding has invalid legs or baseline');
  }
  const {
    bindingId: _bindingId,
    ...semantic
  } = risk;
  const expectedBindingId = `nbrisk_${stableHash128Hex(
    `normalBasisApprovedRisk|${canonicalJson(semantic)}`,
  )}`;
  if (risk.bindingId !== expectedBindingId) {
    throw new TypeError('normal-Basis risk binding content identity mismatch');
  }
  return Object.freeze({
    ...semantic,
    spot: Object.freeze({ ...semantic.spot }),
    perp: Object.freeze({ ...semantic.perp }),
    baseline: Object.freeze({ ...semantic.baseline }),
    bindingId: expectedBindingId,
  });
}
