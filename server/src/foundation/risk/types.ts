/**
 * Lane D — multi-leg risk evaluator: input snapshot types (lane-local).
 *
 * The evaluator is a PURE input-to-verdict function. Everything it may look
 * at arrives inside one RiskEvaluationInput snapshot: plan intent, proposal
 * and approval evidence, kill-switch state, market/account/borrow evidence,
 * existing plans, cooldown state, the limits policy, and the injected clock
 * value `nowMs`. Nothing is read from the environment, the wall clock, or
 * any live service.
 *
 * UNKNOWN DISCIPLINE (mirrors contracts/authority.ts):
 *   - `null` on an evidence field means "we do not know" — it yields an
 *     UNKNOWN check, which fail-closes on blocking checks.
 *   - 0 is a KNOWN value (e.g. requiredBorrowUsd === 0 means "no borrow is
 *     needed", which is a pass, not an unknown).
 *
 * THROW vs UNKNOWN boundary:
 *   - Malformed intent/policy/nowMs is programmer error => TypeError.
 *   - Missing or malformed EVIDENCE is an operational condition => the
 *     corresponding checks report UNKNOWN and fail closed. Evidence never
 *     throws.
 *
 * CONTRACT GAP NOTE: the frozen contracts define no approval, kill-switch,
 * or account-evidence shapes, so those are defined lane-locally here (as the
 * lane brief permits). They reuse frozen primitives (SourcedTimestamp,
 * ActionRiskClass, Venue, CanonicalLifecycle, PlanLifecycle) so a future
 * contract promotion is mechanical.
 *
 * Pure module: no I/O, no clocks, no env, no import-time side effects.
 */
import type {
  ActionRiskClass,
  CanonicalLifecycle,
  DataAuthority,
  PlanLifecycle,
  SourcedTimestamp,
  ValidationIssue,
  Venue,
} from '../contracts/index.js';
import {
  isActionRiskClass,
  canonicalJson,
  isCanonicalLifecycle,
  isDataAuthority,
  isValidUtcMillis,
  isVenue,
  MAX_UTC_MS,
  stableHash128Hex,
} from '../contracts/index.js';

// ---------- plan intent ----------

export const LEG_PERMISSIONS = Object.freeze(['SPOT', 'MARGIN', 'FUTURES'] as const);
export type LegPermission = (typeof LEG_PERMISSIONS)[number];

export const POSITION_BUCKETS = Object.freeze([
  'SPOT_CASH',
  'MARGIN_CROSS',
  'MARGIN_ISOLATED',
  'USDM_ONE_WAY',
] as const);
export type PositionBucket = (typeof POSITION_BUCKETS)[number];

export function isPositionBucket(value: unknown): value is PositionBucket {
  return typeof value === 'string' && (POSITION_BUCKETS as readonly string[]).includes(value);
}

export function isLegPermission(value: unknown): value is LegPermission {
  return typeof value === 'string' && (LEG_PERMISSIONS as readonly string[]).includes(value);
}

export const LEG_SIDES = Object.freeze(['BUY', 'SELL'] as const);
export type LegSide = (typeof LEG_SIDES)[number];

/** Hard bound keeps every per-leg risk pass deterministic and stack-safe. */
export const MAX_RISK_LEGS = 64;

/** Canonical exchange symbol alphabet; control characters and key delimiters are forbidden. */
const SYMBOL_PATTERN = /^[A-Z0-9][A-Z0-9_]{0,63}$/;

export function isLegSide(value: unknown): value is LegSide {
  return typeof value === 'string' && (LEG_SIDES as readonly string[]).includes(value);
}

export interface PlanLegIntent {
  /** Stable caller-chosen key, unique within the intent, e.g. 'SPOT_BUY'. */
  legKey: string;
  venue: Venue;
  symbol: string;
  /** Exact product/account bucket; venue+symbol alone cannot distinguish cash from margin. */
  positionBucket: PositionBucket;
  side: LegSide;
  /** Intended limit/reference price (> 0). An unpriceable leg cannot be risk-checked. */
  intendedPrice: number;
  /** Intended base quantity (> 0). */
  intendedQty: number;
  /** The account permission this leg's order requires. */
  requiredPermission: LegPermission;
  /** Additional margin assigned to this exact product bucket; null = unknown. */
  estimatedRequiredMarginUsd: number | null;
}

export interface PlanIntent {
  planId: string;
  /** Stable exchange/account scope for every private fact used by the verdict. */
  accountId: string;
  /**
   * Canonical proposal this plan came from; null for recovery/close intents
   * that do not originate from a strategy proposal.
   */
  proposalRef: string | null;
  /** RISK_INCREASING entry vs explicitly risk-reducing close/recovery. */
  riskClass: ActionRiskClass;
  legs: readonly PlanLegIntent[];
  /** Plan's own declared cap on single-leg (naked) exposure time; null = undeclared. */
  declaredMaxNakedDurationMs: number | null;
  /** Estimated additional margin the plan consumes; 0 = known none; null = unknown. */
  estimatedRequiredMarginUsd: number | null;
  /** Borrow the plan needs; 0 = known none (skips borrow gates); null = unknown. */
  requiredBorrowUsd: number | null;
}

/**
 * Immutable approval/proposal binding for the complete semantic intent.
 * Legs are sorted by stable legKey, never by caller array position.
 */
export function deriveRiskIntentDigest(intent: PlanIntent): string {
  const issues = validatePlanIntent(intent);
  if (issues.length > 0) {
    throw new TypeError(
      `deriveRiskIntentDigest: invalid intent — ${issues.map((issue) => `${issue.path}:${issue.code}`).join(', ')}`,
    );
  }
  const semantic = {
    planId: intent.planId,
    accountId: intent.accountId,
    proposalRef: intent.proposalRef,
    riskClass: intent.riskClass,
    legs: [...intent.legs]
      .sort((a, b) => (a.legKey < b.legKey ? -1 : a.legKey > b.legKey ? 1 : 0))
      .map((leg) => ({
        legKey: leg.legKey,
        venue: leg.venue,
        symbol: leg.symbol,
        positionBucket: leg.positionBucket,
        side: leg.side,
        intendedPrice: leg.intendedPrice,
        intendedQty: leg.intendedQty,
        requiredPermission: leg.requiredPermission,
        estimatedRequiredMarginUsd: leg.estimatedRequiredMarginUsd,
      })),
    declaredMaxNakedDurationMs: intent.declaredMaxNakedDurationMs,
    estimatedRequiredMarginUsd: intent.estimatedRequiredMarginUsd,
    requiredBorrowUsd: intent.requiredBorrowUsd,
  };
  return `riskint_${stableHash128Hex(`riskIntent|${canonicalJson(semantic)}`)}`;
}

// ---------- limits / policy configuration ----------

export interface RiskPolicy {
  /** Verdict validity window, ms (> 0). */
  verdictTtlMs: number;
  /** Weakest raw DataAuthority acceptable for supplied evidence. */
  minEvidenceAuthority: DataAuthority;
  /** Max spread between leg evidence basis times, ms. */
  maxSpotPerpSkewMs: number;
  minLegNotionalUsd: number;
  maxLegNotionalUsd: number;
  maxGrossNotionalUsd: number;
  /** Max |buyQty - sellQty| / max(buyQty, sellQty) * 100 across hedge legs. */
  maxHedgeRatioDeviationPct: number;
  /** Max |signed notional sum| left unhedged, USD. */
  maxResidualDeltaUsd: number;
  /** Policy ceiling on a plan's declared naked-exposure window, ms. */
  maxNakedDurationMs: number;
  minNetEdgePct: number;
  maxSpreadPct: number;
  minTopDepthUsd: number;
  maxSlippagePct: number;
  /** Extra headroom demanded on top of required margin, pct (>= 0). */
  marginHeadroomBufferPct: number;
  minLiquidationDistancePct: number;
  /** Maximum permitted divergence between liquidation mark and leg reference. */
  maxLiquidationReferenceDriftPct: number;
  maxBorrowHourlyRatePct: number;
  maxDailyLossUsd: number;
  maxDailyNotionalUsd: number;
  maxOpenOrdersPerSymbol: number;
  maxTotalOpenOrders: number;
  /** Minimum quiet period since the last relevant entry, ms. */
  cooldownMs: number;
}

// ---------- evidence shapes (all optional at the snapshot level) ----------

export interface KillSwitchEvidence {
  accountId: string;
  engaged: boolean;
  /** Provenance/freshness of the observed control-plane state. */
  observedAt: SourcedTimestamp;
  reason: string | null;
}

export interface ApprovalEvidence {
  approvalId: string;
  /** The plan this approval covers; must equal intent.planId. */
  subjectPlanId: string;
  /** The risk class the operator explicitly authorized. */
  authorizedRiskClass: ActionRiskClass;
  /** Immutable digest of the exact intent the operator approved. */
  intentDigest: string;
  grantedAtMs: number;
  expiresAtMs: number;
  /** Provenance/freshness of the approval-store record (revocation-aware). */
  observedAt: SourcedTimestamp;
}

export interface ProposalEvidence {
  proposalId: string;
  /** Immutable digest of the exact risk-increasing plan derived from it. */
  entryIntentDigest: string;
  lifecycle: CanonicalLifecycle;
  /** Child-declared expiry; null when the child declared none. */
  expiresAtMs: number | null;
  observedAt: SourcedTimestamp;
}

export interface SymbolFilterEvidence {
  venue: Venue;
  symbol: string;
  minPrice: number;
  /** null means the venue supplied no enabled maximum-price filter. */
  maxPrice: number | null;
  tickSize: number;
  minQty: number;
  /** null means the venue supplied no enabled maximum-quantity filter. */
  maxQty: number | null;
  stepSize: number;
  minNotionalUsd: number;
  /** null means the venue supplied no enabled maximum-notional filter. */
  maxNotionalUsd: number | null;
  observedAt: SourcedTimestamp;
}

export interface LegMarketEvidence {
  /** Matches PlanLegIntent.legKey. */
  legKey: string;
  /** Prevents evidence for another instrument/venue from matching by key alone. */
  venue: Venue;
  symbol: string;
  /** Fresh executable/mark reference used for conservative USD exposure. */
  referencePrice: number | null;
  observedAt: SourcedTimestamp;
  spreadPct: number | null;
  topDepthUsd: number | null;
  filters: SymbolFilterEvidence | null;
}

export interface MarketEvidence {
  legs: readonly LegMarketEvidence[];
  /** Binds intent-dependent edge/cost/slippage estimates to exact plan semantics. */
  edgeIntentDigest: string;
  /** Net edge AFTER estimated costs; null when the source supplied none. */
  netEdgePct: number | null;
  estimatedCostPct: number | null;
  estimatedSlippagePct: number | null;
  /** Provenance of the edge/cost/slippage estimates. */
  edgeObservedAt: SourcedTimestamp | null;
}

export interface PermissionEvidence {
  accountId: string;
  spot: boolean | null;
  margin: boolean | null;
  futures: boolean | null;
  observedAt: SourcedTimestamp;
}

export interface MarginHeadroomEvidence {
  accountId: string;
  positionBucket: PositionBucket;
  /** Required only for MARGIN_ISOLATED; null for cross-margin and USD-M wallets. */
  scopeSymbol: string | null;
  availableMarginUsd: number | null;
  observedAt: SourcedTimestamp;
}

export interface LiquidationEvidence {
  /** The USD-M intent leg this projection describes. */
  legKey: string;
  accountId: string;
  venue: Venue;
  symbol: string;
  intentDigest: string;
  /** Signed base quantity remaining after this exact intent. */
  projectedSignedBaseQty: number;
  markPrice: number;
  /** Projected post-entry liquidation price for the perp exposure. */
  liquidationPrice: number | null;
  observedAt: SourcedTimestamp;
}

export interface OpenOrdersEvidence {
  total: number;
  /** Complete symbol->count map; a missing key is a KNOWN zero when the snapshot is COMPLETE. */
  perSymbol: Readonly<Record<string, number>>;
  observedAt: SourcedTimestamp;
}

export interface SpotInventoryEvidence {
  accountId: string;
  symbol: string;
  availableBaseQty: number;
  availableQuoteUsd: number;
  observedAt: SourcedTimestamp;
}

export interface PositionExposureEvidence {
  venue: Venue;
  symbol: string;
  positionBucket: PositionBucket;
  /** Signed base quantity: positive long, negative short, zero flat. */
  signedBaseQty: number;
  observedAt: SourcedTimestamp;
}

export interface ExposureSnapshotEvidence {
  /** Account binding prevents a fresh snapshot from another account being replayed here. */
  accountId: string;
  /** Signed net quantities prove recovery only in one-way mode. */
  positionMode: 'ONE_WAY' | 'HEDGE' | null;
  positions: readonly PositionExposureEvidence[];
  /** Must be COMPLETE before omitted venue/symbol rows can mean known zero. */
  observedAt: SourcedTimestamp;
}

export interface AccountEvidence {
  accountId: string;
  permissions: PermissionEvidence | null;
  spotInventory: readonly SpotInventoryEvidence[] | null;
  /** Known-complete position/delta rows used to prove recovery reduces risk. */
  exposures: ExposureSnapshotEvidence | null;
  /** One independently sourced row per non-fungible margin wallet/scope. */
  marginHeadrooms: readonly MarginHeadroomEvidence[] | null;
  /** One projection per USD-M leg; null means unavailable. */
  liquidations: readonly LiquidationEvidence[] | null;
  /** Positive = realized loss today; negative = profit. Null = unknown. */
  dailyRealizedLossUsd: number | null;
  dailyTradedNotionalUsd: number | null;
  /** UTC accounting window to which both daily values belong. */
  dailyPeriodStartMs: number | null;
  dailyPeriodEndMs: number | null;
  dailyStatsObservedAt: SourcedTimestamp | null;
  openOrders: OpenOrdersEvidence | null;
}

/** Section-18 borrow truth vocabulary (lane-local copy; Lane borrow owns the source). */
export const BORROW_EVIDENCE_STATES = Object.freeze([
  'AVAILABLE',
  'UNAVAILABLE',
  'UNKNOWN',
  'STALE',
  'PERMISSION_MISSING',
  'ACCOUNT_MODE_MISMATCH',
  'RATE_LIMITED',
  'SOURCE_ERROR',
] as const);
export type BorrowEvidenceState = (typeof BORROW_EVIDENCE_STATES)[number];

export function isBorrowEvidenceState(value: unknown): value is BorrowEvidenceState {
  return typeof value === 'string' && (BORROW_EVIDENCE_STATES as readonly string[]).includes(value);
}

export interface BorrowEvidence {
  accountId: string;
  /** The sole margin-sell symbol covered by this snapshot. */
  symbol: string;
  positionBucket: 'MARGIN_CROSS' | 'MARGIN_ISOLATED';
  state: BorrowEvidenceState;
  maxBorrowableUsd: number | null;
  hourlyRatePct: number | null;
  observedAt: SourcedTimestamp;
}

export interface ExistingPlanSummary {
  planId: string;
  symbols: readonly string[];
  lifecycle: PlanLifecycle;
}

/** Known-complete coordinator plan registry snapshot. */
export interface ExistingPlansEvidence {
  accountId: string;
  plans: readonly ExistingPlanSummary[];
  observedAt: SourcedTimestamp;
}

export interface CooldownEvidence {
  accountId: string;
  /** Complete normalized symbol scope for the last-entry fact. */
  symbols: readonly string[];
  /** Last relevant entry time; null = KNOWN "no prior entry" (passes). */
  lastEntryAtMs: number | null;
  observedAt: SourcedTimestamp;
}

// ---------- the full snapshot ----------

export interface RiskEvaluationInput {
  /** From the caller's injected clock (real, replay-virtual, or test). */
  nowMs: number;
  intent: PlanIntent;
  proposal: ProposalEvidence | null;
  approval: ApprovalEvidence | null;
  killSwitch: KillSwitchEvidence | null;
  market: MarketEvidence | null;
  account: AccountEvidence | null;
  borrow: BorrowEvidence | null;
  /** Known-complete coordinator plan-registry snapshot; null = unknown. */
  existingPlans: ExistingPlansEvidence | null;
  cooldown: CooldownEvidence | null;
  policy: RiskPolicy;
}

// ---------- structural validation (intent / policy / nowMs only) ----------

const LEG_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

function pushIssue(issues: ValidationIssue[], path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function isFinitePositive(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

function isFiniteNonNegative(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function validateLeg(leg: unknown, path: string, issues: ValidationIssue[]): void {
  if (typeof leg !== 'object' || leg === null || Array.isArray(leg)) {
    pushIssue(issues, path, 'OBJECT_REQUIRED', 'leg must be a plain object');
    return;
  }
  const rec = leg as Record<string, unknown>;
  if (typeof rec.legKey !== 'string' || !LEG_KEY_PATTERN.test(rec.legKey)) {
    pushIssue(issues, `${path}.legKey`, 'LEG_KEY_INVALID', 'legKey must match /^[A-Z][A-Z0-9_]{0,63}$/');
  }
  if (!isVenue(rec.venue)) {
    pushIssue(issues, `${path}.venue`, 'VENUE_INVALID', 'venue must be a known Venue');
  }
  if (typeof rec.symbol !== 'string' || !SYMBOL_PATTERN.test(rec.symbol)) {
    pushIssue(issues, `${path}.symbol`, 'SYMBOL_INVALID', 'symbol must match /^[A-Z0-9][A-Z0-9_]{0,63}$/');
  }
  if (!isPositionBucket(rec.positionBucket)) {
    pushIssue(issues, `${path}.positionBucket`, 'POSITION_BUCKET_INVALID', 'positionBucket must be a known product/account bucket');
  } else if (rec.venue === 'BINANCE_USDM' && rec.positionBucket !== 'USDM_ONE_WAY') {
    pushIssue(issues, `${path}.positionBucket`, 'POSITION_BUCKET_VENUE_MISMATCH', 'USD-M legs require USDM_ONE_WAY');
  } else if (rec.venue === 'BINANCE_SPOT' && rec.requiredPermission === 'SPOT' && rec.positionBucket !== 'SPOT_CASH') {
    pushIssue(issues, `${path}.positionBucket`, 'POSITION_BUCKET_PERMISSION_MISMATCH', 'cash SPOT legs require SPOT_CASH');
  } else if (
    rec.venue === 'BINANCE_SPOT' &&
    rec.requiredPermission === 'MARGIN' &&
    !['MARGIN_CROSS', 'MARGIN_ISOLATED'].includes(rec.positionBucket)
  ) {
    pushIssue(issues, `${path}.positionBucket`, 'POSITION_BUCKET_PERMISSION_MISMATCH', 'MARGIN legs require an explicit cross or isolated margin bucket');
  }
  if (!isLegSide(rec.side)) {
    pushIssue(issues, `${path}.side`, 'SIDE_INVALID', "side must be 'BUY' or 'SELL'");
  }
  if (!isFinitePositive(rec.intendedPrice)) {
    pushIssue(issues, `${path}.intendedPrice`, 'POSITIVE_NUMBER_REQUIRED', 'intendedPrice must be a finite number > 0');
  }
  if (!isFinitePositive(rec.intendedQty)) {
    pushIssue(issues, `${path}.intendedQty`, 'POSITIVE_NUMBER_REQUIRED', 'intendedQty must be a finite number > 0');
  }
  if (
    isFinitePositive(rec.intendedPrice) &&
    isFinitePositive(rec.intendedQty) &&
    !Number.isFinite((rec.intendedPrice as number) * (rec.intendedQty as number))
  ) {
    pushIssue(issues, `${path}`, 'NOTIONAL_OVERFLOW', 'intendedPrice * intendedQty must be finite');
  }
  if (!isLegPermission(rec.requiredPermission)) {
    pushIssue(issues, `${path}.requiredPermission`, 'PERMISSION_INVALID', "requiredPermission must be 'SPOT' | 'MARGIN' | 'FUTURES'");
  } else if (rec.venue === 'BINANCE_USDM' && rec.requiredPermission !== 'FUTURES') {
    pushIssue(
      issues,
      `${path}.requiredPermission`,
      'PERMISSION_VENUE_MISMATCH',
      'BINANCE_USDM legs require FUTURES permission',
    );
  } else if (rec.venue === 'BINANCE_SPOT' && rec.requiredPermission === 'FUTURES') {
    pushIssue(
      issues,
      `${path}.requiredPermission`,
      'PERMISSION_VENUE_MISMATCH',
      'BINANCE_SPOT legs require SPOT or MARGIN permission',
    );
  }
  if (rec.estimatedRequiredMarginUsd !== null && !isFiniteNonNegative(rec.estimatedRequiredMarginUsd)) {
    pushIssue(issues, `${path}.estimatedRequiredMarginUsd`, 'NON_NEGATIVE_NUMBER_OR_NULL_REQUIRED', 'per-leg estimatedRequiredMarginUsd must be null or a finite number >= 0');
  }
  if (
    rec.positionBucket === 'SPOT_CASH' &&
    rec.estimatedRequiredMarginUsd !== 0
  ) {
    pushIssue(issues, `${path}.estimatedRequiredMarginUsd`, 'CASH_MARGIN_MUST_BE_ZERO', 'SPOT_CASH legs must declare known zero required margin');
  }
}

/** Structural validation of intent. Empty array = valid. Never throws. */
export function validatePlanIntent(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'intent must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  if (typeof rec.planId !== 'string' || rec.planId.trim().length === 0 || rec.planId.length > 128) {
    pushIssue(issues, 'planId', 'NON_EMPTY_STRING_REQUIRED', 'planId must be a non-empty string (<=128 chars)');
  }
  if (typeof rec.accountId !== 'string' || rec.accountId.trim().length === 0 || rec.accountId.length > 128) {
    pushIssue(issues, 'accountId', 'NON_EMPTY_STRING_REQUIRED', 'accountId must be a non-empty string (<=128 chars)');
  }
  if (
    rec.proposalRef !== null &&
    (typeof rec.proposalRef !== 'string' || rec.proposalRef.length === 0 || rec.proposalRef.length > 128)
  ) {
    pushIssue(issues, 'proposalRef', 'PROPOSAL_REF_INVALID', 'proposalRef must be null or a non-empty string (<=128 chars)');
  }
  if (!isActionRiskClass(rec.riskClass)) {
    pushIssue(issues, 'riskClass', 'RISK_CLASS_INVALID', "riskClass must be 'RISK_INCREASING' or 'RISK_REDUCING'");
  }
  if (!Array.isArray(rec.legs) || rec.legs.length === 0) {
    pushIssue(issues, 'legs', 'LEGS_REQUIRED', 'legs must be a non-empty array');
  } else {
    if (rec.legs.length > MAX_RISK_LEGS) {
      pushIssue(issues, 'legs', 'TOO_MANY_LEGS', `legs must contain at most ${MAX_RISK_LEGS} entries`);
    }
    const boundedLegs = rec.legs.slice(0, MAX_RISK_LEGS);
    boundedLegs.forEach((leg, i) => validateLeg(leg, `legs[${i}]`, issues));
    const keys = boundedLegs
      .filter((l): l is Record<string, unknown> => typeof l === 'object' && l !== null)
      .map((l) => l.legKey)
      .filter((k): k is string => typeof k === 'string');
    if (new Set(keys).size !== keys.length) {
      pushIssue(issues, 'legs', 'LEG_KEYS_NOT_UNIQUE', 'legKey values must be unique within an intent');
    }
    if (rec.riskClass === 'RISK_INCREASING') {
      if (boundedLegs.length < 2) {
        pushIssue(issues, 'legs', 'MULTI_LEG_ENTRY_REQUIRED', 'risk-increasing entry requires at least two legs');
      }
      const sides = new Set(
        boundedLegs
          .filter((leg): leg is Record<string, unknown> => typeof leg === 'object' && leg !== null)
          .map((leg) => leg.side),
      );
      if (!sides.has('BUY') || !sides.has('SELL')) {
        pushIssue(issues, 'legs', 'OPPOSING_SIDES_REQUIRED', 'risk-increasing entry requires both BUY and SELL exposure');
      }
    }
  }
  if (
    rec.declaredMaxNakedDurationMs !== null &&
    (typeof rec.declaredMaxNakedDurationMs !== 'number' ||
      !Number.isSafeInteger(rec.declaredMaxNakedDurationMs) ||
      rec.declaredMaxNakedDurationMs <= 0)
  ) {
    pushIssue(issues, 'declaredMaxNakedDurationMs', 'POSITIVE_INTEGER_OR_NULL_REQUIRED', 'declaredMaxNakedDurationMs must be null or a positive safe integer');
  }
  if (rec.estimatedRequiredMarginUsd !== null && !isFiniteNonNegative(rec.estimatedRequiredMarginUsd)) {
    pushIssue(issues, 'estimatedRequiredMarginUsd', 'NON_NEGATIVE_NUMBER_OR_NULL_REQUIRED', 'estimatedRequiredMarginUsd must be null or a finite number >= 0');
  }
  if (rec.requiredBorrowUsd !== null && !isFiniteNonNegative(rec.requiredBorrowUsd)) {
    pushIssue(issues, 'requiredBorrowUsd', 'NON_NEGATIVE_NUMBER_OR_NULL_REQUIRED', 'requiredBorrowUsd must be null or a finite number >= 0');
  }
  return issues;
}

type PolicyFieldKind = 'POSITIVE_INT_MS' | 'NON_NEGATIVE_INT_MS' | 'NON_NEGATIVE_NUMBER' | 'FINITE_NUMBER' | 'NON_NEGATIVE_INT' | 'AUTHORITY';

const POLICY_FIELDS: readonly (readonly [keyof RiskPolicy, PolicyFieldKind])[] = [
  ['verdictTtlMs', 'POSITIVE_INT_MS'],
  ['minEvidenceAuthority', 'AUTHORITY'],
  ['maxSpotPerpSkewMs', 'NON_NEGATIVE_INT_MS'],
  ['minLegNotionalUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxLegNotionalUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxGrossNotionalUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxHedgeRatioDeviationPct', 'NON_NEGATIVE_NUMBER'],
  ['maxResidualDeltaUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxNakedDurationMs', 'POSITIVE_INT_MS'],
  ['minNetEdgePct', 'FINITE_NUMBER'],
  ['maxSpreadPct', 'NON_NEGATIVE_NUMBER'],
  ['minTopDepthUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxSlippagePct', 'NON_NEGATIVE_NUMBER'],
  ['marginHeadroomBufferPct', 'NON_NEGATIVE_NUMBER'],
  ['minLiquidationDistancePct', 'NON_NEGATIVE_NUMBER'],
  ['maxLiquidationReferenceDriftPct', 'NON_NEGATIVE_NUMBER'],
  ['maxBorrowHourlyRatePct', 'NON_NEGATIVE_NUMBER'],
  ['maxDailyLossUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxDailyNotionalUsd', 'NON_NEGATIVE_NUMBER'],
  ['maxOpenOrdersPerSymbol', 'NON_NEGATIVE_INT'],
  ['maxTotalOpenOrders', 'NON_NEGATIVE_INT'],
  ['cooldownMs', 'NON_NEGATIVE_INT_MS'],
];

/** Structural validation of policy. Empty array = valid. Never throws. */
export function validateRiskPolicy(input: unknown): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'policy must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  for (const [field, kind] of POLICY_FIELDS) {
    const v = rec[field];
    switch (kind) {
      case 'POSITIVE_INT_MS':
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0) {
          pushIssue(issues, field, 'POSITIVE_INTEGER_REQUIRED', `${field} must be a positive safe integer`);
        }
        break;
      case 'NON_NEGATIVE_INT_MS':
      case 'NON_NEGATIVE_INT':
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
          pushIssue(issues, field, 'NON_NEGATIVE_INTEGER_REQUIRED', `${field} must be a non-negative safe integer`);
        }
        break;
      case 'NON_NEGATIVE_NUMBER':
        if (!isFiniteNonNegative(v)) {
          pushIssue(issues, field, 'NON_NEGATIVE_NUMBER_REQUIRED', `${field} must be a finite number >= 0`);
        }
        break;
      case 'FINITE_NUMBER':
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          pushIssue(issues, field, 'FINITE_NUMBER_REQUIRED', `${field} must be a finite number`);
        }
        break;
      case 'AUTHORITY':
        if (!isDataAuthority(v)) {
          pushIssue(issues, field, 'AUTHORITY_INVALID', `${field} must be a DataAuthority`);
        }
        break;
    }
  }
  if (
    isFiniteNonNegative(rec.minLegNotionalUsd) &&
    isFiniteNonNegative(rec.maxLegNotionalUsd) &&
    rec.minLegNotionalUsd > rec.maxLegNotionalUsd
  ) {
    pushIssue(
      issues,
      'minLegNotionalUsd',
      'POLICY_RANGE_INVALID',
      'minLegNotionalUsd must not exceed maxLegNotionalUsd',
    );
  }
  if (
    Number.isSafeInteger(rec.maxOpenOrdersPerSymbol) &&
    Number.isSafeInteger(rec.maxTotalOpenOrders) &&
    (rec.maxOpenOrdersPerSymbol as number) > (rec.maxTotalOpenOrders as number)
  ) {
    pushIssue(
      issues,
      'maxOpenOrdersPerSymbol',
      'POLICY_RANGE_INVALID',
      'maxOpenOrdersPerSymbol must not exceed maxTotalOpenOrders',
    );
  }
  if (rec.minEvidenceAuthority === 'UNAVAILABLE') {
    pushIssue(
      issues,
      'minEvidenceAuthority',
      'AUTHORITY_FLOOR_INVALID',
      'UNAVAILABLE cannot be used as an evidence authority floor',
    );
  }
  if (
    typeof rec.maxHedgeRatioDeviationPct === 'number' &&
    Number.isFinite(rec.maxHedgeRatioDeviationPct) &&
    rec.maxHedgeRatioDeviationPct >= 100
  ) {
    pushIssue(
      issues,
      'maxHedgeRatioDeviationPct',
      'HEDGE_TOLERANCE_INVALID',
      'maxHedgeRatioDeviationPct must be less than 100',
    );
  }
  return issues;
}

/**
 * Structural validation of the parts the evaluator refuses to run without:
 * nowMs, intent, policy. Evidence fields are NOT validated here — malformed
 * or missing evidence yields UNKNOWN checks, never a throw.
 */
export function validateRiskEvaluationInput(input: unknown): ValidationIssue[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return [{ path: '', code: 'OBJECT_REQUIRED', message: 'evaluation input must be a plain object' }];
  }
  const rec = input as Record<string, unknown>;
  const issues: ValidationIssue[] = [];
  if (!isValidUtcMillis(rec.nowMs)) {
    pushIssue(issues, 'nowMs', 'UTC_MILLIS_INVALID', 'nowMs must be a safe-integer UTC ms from an injected clock');
  }
  for (const issue of validatePlanIntent(rec.intent)) {
    issues.push({ ...issue, path: issue.path ? `intent.${issue.path}` : 'intent' });
  }
  for (const issue of validateRiskPolicy(rec.policy)) {
    issues.push({ ...issue, path: issue.path ? `policy.${issue.path}` : 'policy' });
  }
  const ttl =
    typeof rec.policy === 'object' && rec.policy !== null
      ? (rec.policy as Record<string, unknown>).verdictTtlMs
      : null;
  if (
    isValidUtcMillis(rec.nowMs) &&
    typeof ttl === 'number' &&
    Number.isSafeInteger(ttl) &&
    ttl > 0 &&
    rec.nowMs + ttl > MAX_UTC_MS
  ) {
    pushIssue(
      issues,
      'policy.verdictTtlMs',
      'VERDICT_EXPIRY_OUT_OF_RANGE',
      'nowMs + verdictTtlMs must remain within the contract UTC range',
    );
  }
  return issues;
}

// re-export for consumers that only import lane types
export type { CanonicalLifecycle, PlanLifecycle };
