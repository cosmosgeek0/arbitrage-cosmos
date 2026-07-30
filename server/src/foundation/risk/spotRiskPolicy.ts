/**
 * Hard, fail-closed risk policy for a canonical Spot execution ticket.
 *
 * All monetary inputs are non-negative plain-decimal strings. The evaluator
 * uses exact integer arithmetic through the Binance Spot decimal kernel and
 * accepts time/control state only through explicit inputs.
 *
 * Pure module: no I/O, clocks, environment reads, or floating-point math.
 */
import {
  addSpotDecimals,
  compareSpotDecimals,
  multiplySpotDecimals,
  normalizeSpotDecimal,
} from '../exchange/binanceSpot/filters.js';

/** Current explicit owner authority: no Spot order may exceed 10 quote units. */
export const OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE = '10' as const;

export interface SpotRiskPolicy {
  readonly minOrderNotionalQuote: string;
  readonly maxOrderNotionalQuote: string;
  readonly maxLossPerOrderQuote: string;
  readonly maxDailyLossQuote: string;
}

export interface SpotRiskSubject {
  /**
   * Optional only for source compatibility with pre-classification callers.
   * Missing classification is UNKNOWN and blocks; it never implies authority.
   */
  readonly purpose?: 'ENTRY' | 'FLATTEN';
  readonly riskEffect?:
    | 'RISK_INCREASING'
    | 'UNPROVEN_RISK_REDUCTION'
    | 'RECONCILED_RISK_REDUCTION';
  readonly quantity: string;
  /** LIMIT order price; null identifies a MARKET order. */
  readonly price: string | null;
  /** Conservative explicit reference used for MARKET order notional. */
  readonly riskReferencePrice: string;
  /** Worst-case quote loss produced by the strategy/risk model. */
  readonly estimatedMaxLossQuote: string;
  readonly expiresAtMs: number;
  /**
   * Durable cumulative facts required for an exact recovery SELL. Values are
   * measured before the candidate FOK order.
   */
  readonly recovery?: Readonly<{
    readonly attributableBaseQuantity: string;
    readonly cumulativeFilledSellQuantity: string;
    readonly cumulativeAuthorizedLifecycleTurnoverQuote: string;
    readonly maximumAuthorizedLifecycleTurnoverQuote: string;
  }>;
}

export interface SpotKillSwitchEvidence {
  readonly engaged: boolean;
}

export interface SpotRiskEvaluationInput {
  readonly nowMs: number;
  readonly policy: SpotRiskPolicy;
  readonly subject: SpotRiskSubject;
  /** Null means the control state is unavailable and therefore blocks. */
  readonly killSwitch: SpotKillSwitchEvidence | null;
  /** Non-negative realized loss in the current policy day; null blocks. */
  readonly realizedDailyLossQuote: string | null;
}

export const SPOT_RISK_CHECK_CODES = [
  'POLICY_VALID',
  'RISK_CLASSIFICATION_PROVEN',
  'TICKET_UNEXPIRED',
  'KILL_SWITCH_CLEAR',
  'ORDER_NOTIONAL_MIN',
  'ORDER_NOTIONAL_MAX',
  'RECOVERY_SELL_WITHIN_ATTRIBUTABLE_BASE',
  'RECOVERY_AUTHORIZED_TURNOVER_CAP',
  'ORDER_MAX_LOSS',
  'PROJECTED_DAILY_LOSS',
] as const;

export type SpotRiskCheckCode = (typeof SPOT_RISK_CHECK_CODES)[number];
export type SpotRiskCheckStatus = 'PASS' | 'FAIL' | 'UNKNOWN';

export interface SpotRiskCheck {
  readonly code: SpotRiskCheckCode;
  readonly status: SpotRiskCheckStatus;
  readonly observed: string | boolean | number | null;
  readonly limit: string | boolean | number | null;
  readonly detail: string;
}

export interface SpotRiskVerdict {
  readonly allowed: boolean;
  readonly orderNotionalQuote: string | null;
  readonly projectedDailyLossQuote: string | null;
  readonly blockingCodes: readonly SpotRiskCheckCode[];
  readonly checks: readonly Readonly<SpotRiskCheck>[];
}

function freezeCheck(
  code: SpotRiskCheckCode,
  status: SpotRiskCheckStatus,
  observed: SpotRiskCheck['observed'],
  limit: SpotRiskCheck['limit'],
  detail: string,
): Readonly<SpotRiskCheck> {
  return Object.freeze({ code, status, observed, limit, detail });
}

function positiveDecimal(value: unknown, fieldName: string): string {
  const normalized = normalizeSpotDecimal(value as string, fieldName);
  if (normalized === '0') {
    throw new TypeError(`${fieldName} must be positive`);
  }
  return normalized;
}

export function createSpotRiskPolicy(
  input: SpotRiskPolicy,
): Readonly<SpotRiskPolicy> {
  const minOrderNotionalQuote = positiveDecimal(
    input?.minOrderNotionalQuote,
    'minOrderNotionalQuote',
  );
  const maxOrderNotionalQuote = positiveDecimal(
    input?.maxOrderNotionalQuote,
    'maxOrderNotionalQuote',
  );
  const maxLossPerOrderQuote = positiveDecimal(
    input?.maxLossPerOrderQuote,
    'maxLossPerOrderQuote',
  );
  const maxDailyLossQuote = positiveDecimal(
    input?.maxDailyLossQuote,
    'maxDailyLossQuote',
  );
  if (
    compareSpotDecimals(minOrderNotionalQuote, maxOrderNotionalQuote) > 0
  ) {
    throw new TypeError(
      'minOrderNotionalQuote must not exceed maxOrderNotionalQuote',
    );
  }
  if (
    compareSpotDecimals(
      maxOrderNotionalQuote,
      OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE,
    ) > 0
  ) {
    throw new TypeError(
      `maxOrderNotionalQuote must not exceed owner ceiling ${OWNER_SPOT_MAX_ORDER_NOTIONAL_QUOTE}`,
    );
  }
  if (compareSpotDecimals(maxLossPerOrderQuote, maxDailyLossQuote) > 0) {
    throw new TypeError(
      'maxLossPerOrderQuote must not exceed maxDailyLossQuote',
    );
  }
  return Object.freeze({
    minOrderNotionalQuote,
    maxOrderNotionalQuote,
    maxLossPerOrderQuote,
    maxDailyLossQuote,
  });
}

function freezeVerdict(
  checks: SpotRiskCheck[],
  orderNotionalQuote: string | null,
  projectedDailyLossQuote: string | null,
): Readonly<SpotRiskVerdict> {
  const frozenChecks = Object.freeze(
    checks.map((check) => Object.freeze({ ...check })),
  );
  const blockingCodes = Object.freeze(
    frozenChecks
      .filter((check) => check.status !== 'PASS')
      .map((check) => check.code),
  );
  return Object.freeze({
    allowed: blockingCodes.length === 0,
    orderNotionalQuote,
    projectedDailyLossQuote,
    blockingCodes,
    checks: frozenChecks,
  });
}

/**
 * Every FAIL or UNKNOWN check blocks. Limit equality is allowed.
 * The daily-loss check reserves the ticket's entire estimated maximum loss.
 */
export function evaluateSpotRiskPolicy(
  input: SpotRiskEvaluationInput,
): Readonly<SpotRiskVerdict> {
  const checks: SpotRiskCheck[] = [];
  let policy: Readonly<SpotRiskPolicy>;
  try {
    policy = createSpotRiskPolicy(input?.policy);
    checks.push(
      freezeCheck('POLICY_VALID', 'PASS', true, true, 'Risk policy is valid.'),
    );
  } catch {
    checks.push(
      freezeCheck(
        'POLICY_VALID',
        'UNKNOWN',
        null,
        true,
        'Risk policy is missing or malformed.',
      ),
    );
    return freezeVerdict(checks, null, null);
  }

  if (
    input.subject?.purpose === 'ENTRY' &&
    input.subject.riskEffect === 'RISK_INCREASING'
  ) {
    checks.push(
      freezeCheck(
        'RISK_CLASSIFICATION_PROVEN',
        'PASS',
        input.subject.riskEffect,
        'RISK_INCREASING',
        'Entry ticket is classified under the full risk-increasing policy.',
      ),
    );
  } else if (
    input.subject?.purpose === 'FLATTEN' &&
    input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION'
  ) {
    checks.push(
      freezeCheck(
        'RISK_CLASSIFICATION_PROVEN',
        'PASS',
        input.subject.riskEffect,
        'RECONCILED_RISK_REDUCTION',
        'Integration supplied a reconciled risk-reduction classification.',
      ),
    );
  } else if (
    input.subject?.purpose === 'FLATTEN' &&
    input.subject.riskEffect === 'UNPROVEN_RISK_REDUCTION'
  ) {
    checks.push(
      freezeCheck(
        'RISK_CLASSIFICATION_PROVEN',
        'UNKNOWN',
        input.subject.riskEffect,
        'RECONCILED_RISK_REDUCTION_PROOF',
        'Flatten purpose alone does not prove risk reduction; reconciled account, symbol, position, and side evidence is required.',
      ),
    );
  } else {
    checks.push(
      freezeCheck(
        'RISK_CLASSIFICATION_PROVEN',
        'UNKNOWN',
        typeof input.subject?.riskEffect === 'string'
          ? input.subject.riskEffect
          : null,
        'RISK_INCREASING|RECONCILED_RISK_REDUCTION_PROOF',
        'Ticket purpose and risk classification are missing or inconsistent.',
      ),
    );
  }

  const nowValid =
    Number.isSafeInteger(input?.nowMs) && input.nowMs >= 0;
  const expiryValid =
    Number.isSafeInteger(input?.subject?.expiresAtMs) &&
    input.subject.expiresAtMs >= 0;
  if (!nowValid || !expiryValid) {
    checks.push(
      freezeCheck(
        'TICKET_UNEXPIRED',
        'UNKNOWN',
        expiryValid ? input.subject.expiresAtMs : null,
        nowValid ? input.nowMs : null,
        'Injected evaluation time or ticket expiry is malformed.',
      ),
    );
  } else if (input.nowMs >= input.subject.expiresAtMs) {
    checks.push(
      freezeCheck(
        'TICKET_UNEXPIRED',
        'FAIL',
        input.nowMs,
        input.subject.expiresAtMs,
        'Ticket is expired.',
      ),
    );
  } else {
    checks.push(
      freezeCheck(
        'TICKET_UNEXPIRED',
        'PASS',
        input.nowMs,
        input.subject.expiresAtMs,
        'Ticket is within its explicit validity window.',
      ),
    );
  }

  if (
    input.killSwitch === null ||
    typeof input.killSwitch?.engaged !== 'boolean'
  ) {
    checks.push(
      freezeCheck(
        'KILL_SWITCH_CLEAR',
        'UNKNOWN',
        null,
        false,
        'Kill-switch state is unavailable.',
      ),
    );
  } else if (
    input.killSwitch.engaged
    && input.subject?.purpose === 'FLATTEN'
    && input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION'
  ) {
    checks.push(
      freezeCheck(
        'KILL_SWITCH_CLEAR',
        'PASS',
        true,
        'RECOVERY_ONLY',
        'Kill switch blocks new risk but preserves exact reconciled flatten recovery until flat.',
      ),
    );
  } else if (input.killSwitch.engaged) {
    checks.push(
      freezeCheck(
        'KILL_SWITCH_CLEAR',
        'FAIL',
        true,
        false,
        'Kill switch is engaged.',
      ),
    );
  } else {
    checks.push(
      freezeCheck(
        'KILL_SWITCH_CLEAR',
        'PASS',
        false,
        false,
        'Kill switch is clear.',
      ),
    );
  }

  let quantity: string | null = null;
  let notionalPrice: string | null = null;
  let estimatedMaxLoss: string | null = null;
  let orderNotional: string | null = null;
  try {
    quantity = positiveDecimal(input.subject.quantity, 'subject.quantity');
    notionalPrice =
      input.subject.price === null
        ? positiveDecimal(
            input.subject.riskReferencePrice,
            'subject.riskReferencePrice',
          )
        : positiveDecimal(input.subject.price, 'subject.price');
    estimatedMaxLoss = normalizeSpotDecimal(
      input.subject.estimatedMaxLossQuote,
      'subject.estimatedMaxLossQuote',
    );
    orderNotional = multiplySpotDecimals(quantity, notionalPrice);
  } catch {
    // Individual UNKNOWN checks below preserve a complete fail-closed verdict.
  }

  if (orderNotional === null) {
    checks.push(
      freezeCheck(
        'ORDER_NOTIONAL_MIN',
        'UNKNOWN',
        null,
        policy.minOrderNotionalQuote,
        'Ticket quantity or reference price is malformed.',
      ),
      freezeCheck(
        'ORDER_NOTIONAL_MAX',
        'UNKNOWN',
        null,
        policy.maxOrderNotionalQuote,
        'Ticket quantity or reference price is malformed.',
      ),
    );
  } else {
    const recoveryReduction =
      input.subject?.purpose === 'FLATTEN'
      && input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION';
    checks.push(
      !recoveryReduction
      && compareSpotDecimals(orderNotional, policy.minOrderNotionalQuote) < 0
        ? freezeCheck(
            'ORDER_NOTIONAL_MIN',
            'FAIL',
            orderNotional,
            policy.minOrderNotionalQuote,
            'Order notional is below the policy minimum.',
          )
        : freezeCheck(
            'ORDER_NOTIONAL_MIN',
            'PASS',
            orderNotional,
            recoveryReduction
              ? 'RECOVERY_REDUCTION'
              : policy.minOrderNotionalQuote,
            recoveryReduction
              ? 'Exact recovery reduction is not stranded by an entry minimum.'
              : 'Order notional meets the policy minimum.',
          ),
      compareSpotDecimals(orderNotional, policy.maxOrderNotionalQuote) > 0
        ? freezeCheck(
            'ORDER_NOTIONAL_MAX',
            'FAIL',
            orderNotional,
            policy.maxOrderNotionalQuote,
            'Order notional exceeds the policy maximum.',
          )
        : freezeCheck(
            'ORDER_NOTIONAL_MAX',
            'PASS',
            orderNotional,
            policy.maxOrderNotionalQuote,
            'Order notional is within the policy maximum.',
          ),
    );
  }

  if (
    input.subject?.purpose === 'FLATTEN'
    && input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION'
  ) {
    try {
      if (quantity === null || orderNotional === null) throw new TypeError();
      const attributable = normalizeSpotDecimal(
        input.subject.recovery?.attributableBaseQuantity as string,
        'subject.recovery.attributableBaseQuantity',
      );
      const cumulativeSell = normalizeSpotDecimal(
        input.subject.recovery?.cumulativeFilledSellQuantity as string,
        'subject.recovery.cumulativeFilledSellQuantity',
      );
      const cumulativeAuthorized = normalizeSpotDecimal(
        input.subject.recovery
          ?.cumulativeAuthorizedLifecycleTurnoverQuote as string,
        'subject.recovery.cumulativeAuthorizedLifecycleTurnoverQuote',
      );
      const maximumAuthorized = positiveDecimal(
        input.subject.recovery?.maximumAuthorizedLifecycleTurnoverQuote,
        'subject.recovery.maximumAuthorizedLifecycleTurnoverQuote',
      );
      const projectedSell = addSpotDecimals(cumulativeSell, quantity);
      const projectedAuthorized = addSpotDecimals(
        cumulativeAuthorized,
        orderNotional,
      );
      checks.push(
        compareSpotDecimals(projectedSell, attributable) <= 0
          ? freezeCheck(
              'RECOVERY_SELL_WITHIN_ATTRIBUTABLE_BASE',
              'PASS',
              projectedSell,
              attributable,
              'Candidate cumulative SELL remains within exact canary-attributable base.',
            )
          : freezeCheck(
              'RECOVERY_SELL_WITHIN_ATTRIBUTABLE_BASE',
              'FAIL',
              projectedSell,
              attributable,
              'Candidate cumulative SELL would consume non-canary base inventory.',
            ),
        compareSpotDecimals(
          projectedAuthorized,
          maximumAuthorized,
        ) <= 0
          ? freezeCheck(
              'RECOVERY_AUTHORIZED_TURNOVER_CAP',
              'PASS',
              projectedAuthorized,
              maximumAuthorized,
              'Candidate cumulative authorized turnover remains within the lifecycle cap.',
            )
          : freezeCheck(
              'RECOVERY_AUTHORIZED_TURNOVER_CAP',
              'FAIL',
              projectedAuthorized,
              maximumAuthorized,
              'Candidate cumulative authorized turnover exceeds the lifecycle cap.',
            ),
      );
    } catch {
      checks.push(
        freezeCheck(
          'RECOVERY_SELL_WITHIN_ATTRIBUTABLE_BASE',
          'UNKNOWN',
          null,
          null,
          'Exact attributable-base recovery facts are missing or malformed.',
        ),
        freezeCheck(
          'RECOVERY_AUTHORIZED_TURNOVER_CAP',
          'UNKNOWN',
          null,
          null,
          'Exact authorized-turnover recovery facts are missing or malformed.',
        ),
      );
    }
  }

  if (estimatedMaxLoss === null) {
    checks.push(
      freezeCheck(
        'ORDER_MAX_LOSS',
        'UNKNOWN',
        null,
        policy.maxLossPerOrderQuote,
        'Estimated maximum loss is malformed.',
      ),
    );
  } else if (
    input.subject?.purpose === 'FLATTEN'
    && input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION'
  ) {
    checks.push(
      freezeCheck(
        'ORDER_MAX_LOSS',
        'PASS',
        estimatedMaxLoss,
        'RECOVERY_REDUCTION',
        'Exact recovery reduction is not blocked by a new-risk loss reservation.',
      ),
    );
  } else if (
    compareSpotDecimals(estimatedMaxLoss, policy.maxLossPerOrderQuote) > 0
  ) {
    checks.push(
      freezeCheck(
        'ORDER_MAX_LOSS',
        'FAIL',
        estimatedMaxLoss,
        policy.maxLossPerOrderQuote,
        'Estimated maximum loss exceeds the per-order limit.',
      ),
    );
  } else {
    checks.push(
      freezeCheck(
        'ORDER_MAX_LOSS',
        'PASS',
        estimatedMaxLoss,
        policy.maxLossPerOrderQuote,
        'Estimated maximum loss is within the per-order limit.',
      ),
    );
  }

  let projectedDailyLoss: string | null = null;
  const recoveryReduction =
    input.subject?.purpose === 'FLATTEN'
    && input.subject.riskEffect === 'RECONCILED_RISK_REDUCTION';
  try {
    if (input.realizedDailyLossQuote === null || estimatedMaxLoss === null) {
      throw new TypeError('daily loss evidence unavailable');
    }
    const realized = normalizeSpotDecimal(
      input.realizedDailyLossQuote,
      'realizedDailyLossQuote',
    );
    projectedDailyLoss = recoveryReduction
      ? realized
      : addSpotDecimals(realized, estimatedMaxLoss);
  } catch {
    // UNKNOWN below.
  }
  if (projectedDailyLoss === null) {
    checks.push(
      freezeCheck(
        'PROJECTED_DAILY_LOSS',
        'UNKNOWN',
        null,
        policy.maxDailyLossQuote,
        'Daily realized-loss evidence or ticket max loss is unavailable.',
      ),
    );
  } else if (recoveryReduction) {
    checks.push(
      freezeCheck(
        'PROJECTED_DAILY_LOSS',
        'PASS',
        projectedDailyLoss,
        'RECOVERY_REDUCTION',
        'Exact recovery reduction remains available after a daily-loss stop.',
      ),
    );
  } else if (
    compareSpotDecimals(projectedDailyLoss, policy.maxDailyLossQuote) > 0
  ) {
    checks.push(
      freezeCheck(
        'PROJECTED_DAILY_LOSS',
        'FAIL',
        projectedDailyLoss,
        policy.maxDailyLossQuote,
        'Projected daily loss exceeds the daily limit.',
      ),
    );
  } else {
    checks.push(
      freezeCheck(
        'PROJECTED_DAILY_LOSS',
        'PASS',
        projectedDailyLoss,
        policy.maxDailyLossQuote,
        'Projected daily loss is within the daily limit.',
      ),
    );
  }

  return freezeVerdict(checks, orderNotional, projectedDailyLoss);
}

export class SpotRiskRejectedError extends Error {
  readonly verdict: Readonly<SpotRiskVerdict>;

  constructor(verdict: Readonly<SpotRiskVerdict>) {
    super(`Spot risk rejected: ${verdict.blockingCodes.join(',')}`);
    this.name = 'SpotRiskRejectedError';
    this.verdict = verdict;
  }
}

export function assertSpotRiskAllowed(
  input: SpotRiskEvaluationInput,
): Readonly<SpotRiskVerdict> {
  const verdict = evaluateSpotRiskPolicy(input);
  if (!verdict.allowed) throw new SpotRiskRejectedError(verdict);
  return verdict;
}
