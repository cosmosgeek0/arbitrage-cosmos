import {
  buildSpotLedgerAppendIntent,
  spotCorrelationKeys,
  type SpotClock,
  type SpotCorrelation,
  type SpotLedgerAppendIntent,
  type SpotReconciliationStatus,
} from "./spotLedgerBridge.js";

export type SpotRestartAttemptState =
  | "AMBIGUOUS"
  | "OPEN"
  | "PARTIAL"
  | "TERMINAL";

export type SpotExchangeQueryState =
  | "NOT_QUERIED"
  | "FOUND_OPEN"
  | "FOUND_PARTIAL"
  | "FOUND_TERMINAL"
  | "AUTHORITATIVE_NOT_FOUND"
  | "UNAVAILABLE"
  | "AMBIGUOUS";

export type SpotRestartStepKind =
  | "QUERY_BY_CLIENT_ORDER_ID"
  | "HOLD_OPEN_ATTEMPT"
  | "HOLD_PARTIAL_ATTEMPT"
  | "RECONCILE_TERMINAL"
  | "RETRY_REVIEW_REQUIRED"
  | "MANUAL_REVIEW_REQUIRED"
  | "NO_ACTION";

export interface SpotRestartAttempt {
  readonly symbol: string;
  readonly correlation: Readonly<SpotCorrelation>;
  readonly attemptState: SpotRestartAttemptState;
  readonly exchangeQueryState: SpotExchangeQueryState;
  readonly canonicalStatus: SpotReconciliationStatus | null;
}

export interface SpotRestartRecoveryStep {
  readonly ordinal: number;
  readonly attemptKey: string;
  readonly kind: SpotRestartStepKind;
  readonly reasonCodes: readonly string[];
  readonly queryRequired: boolean;
  readonly retryReviewRequired: boolean;
  readonly sendAuthorized: false;
  readonly retryAuthorized: false;
  readonly externalActionAuthorization: "NONE";
}

export interface SpotRestartRecoveryPlan {
  readonly schema: "cosmos.foundation.spot-restart-recovery.v1";
  readonly version: 1;
  readonly restartId: string;
  readonly generatedAtMs: number;
  readonly steps: readonly Readonly<SpotRestartRecoveryStep>[];
  readonly appendIntents: readonly Readonly<SpotLedgerAppendIntent>[];
  readonly queriesBeforeRetry: true;
  readonly sendsPerformed: 0;
  readonly sendAuthorized: false;
  readonly retryAuthorized: false;
  readonly executionAuthority: "NONE";
  readonly externalActionAuthorization: "NONE";
}

const MAX_UTC_MS = 8_640_000_000_000_000;

function normalizedRestartId(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 128 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError("restart id is malformed");
  }
  return value;
}

function generatedTime(clock: Readonly<SpotClock>): number {
  if (typeof clock !== "object" || clock === null || typeof clock.nowMs !== "function") {
    throw new TypeError("restart recovery clock is malformed");
  }
  const value = clock.nowMs();
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UTC_MS) {
    throw new TypeError("restart recovery time is malformed");
  }
  return value;
}

function stepForAttempt(
  attempt: Readonly<SpotRestartAttempt>,
  ordinal: number,
): Readonly<SpotRestartRecoveryStep> {
  const attemptKey = spotCorrelationKeys(attempt.correlation).attempt;
  const base = {
    ordinal,
    attemptKey,
    sendAuthorized: false as const,
    retryAuthorized: false as const,
    externalActionAuthorization: "NONE" as const,
  };

  if (
    attempt.attemptState === "TERMINAL" &&
    attempt.exchangeQueryState === "FOUND_TERMINAL" &&
    attempt.canonicalStatus === "EXACT"
  ) {
    return Object.freeze({
      ...base,
      kind: "NO_ACTION" as const,
      reasonCodes: Object.freeze([]),
      queryRequired: false,
      retryReviewRequired: false,
    });
  }

  if (
    attempt.exchangeQueryState === "NOT_QUERIED" ||
    attempt.exchangeQueryState === "UNAVAILABLE" ||
    attempt.exchangeQueryState === "AMBIGUOUS"
  ) {
    const queryReason =
      attempt.exchangeQueryState === "NOT_QUERIED"
        ? "EXCHANGE_IDENTITY_QUERY_REQUIRED"
        : `EXCHANGE_IDENTITY_QUERY_${attempt.exchangeQueryState}`;
    return Object.freeze({
      ...base,
      kind: "QUERY_BY_CLIENT_ORDER_ID" as const,
      reasonCodes: Object.freeze([
        queryReason,
        `${attempt.attemptState}_ATTEMPT_RETRY_BLOCKED`,
      ]),
      queryRequired: true,
      retryReviewRequired: false,
    });
  }

  if (attempt.exchangeQueryState === "FOUND_OPEN") {
    return Object.freeze({
      ...base,
      kind: "HOLD_OPEN_ATTEMPT" as const,
      reasonCodes: Object.freeze(["EXCHANGE_ORDER_STILL_OPEN"]),
      queryRequired: false,
      retryReviewRequired: false,
    });
  }
  if (attempt.exchangeQueryState === "FOUND_PARTIAL") {
    return Object.freeze({
      ...base,
      kind: "HOLD_PARTIAL_ATTEMPT" as const,
      reasonCodes: Object.freeze(["EXCHANGE_ORDER_PARTIALLY_FILLED"]),
      queryRequired: false,
      retryReviewRequired: false,
    });
  }
  if (attempt.exchangeQueryState === "FOUND_TERMINAL") {
    return Object.freeze({
      ...base,
      kind: "RECONCILE_TERMINAL" as const,
      reasonCodes: Object.freeze([
        attempt.canonicalStatus === null
          ? "CANONICAL_RECONCILIATION_REQUIRED"
          : `CANONICAL_RECONCILIATION_${attempt.canonicalStatus}`,
      ]),
      queryRequired: false,
      retryReviewRequired: false,
    });
  }
  if (
    attempt.exchangeQueryState === "AUTHORITATIVE_NOT_FOUND" &&
    (attempt.attemptState === "AMBIGUOUS" ||
      attempt.attemptState === "OPEN" ||
      attempt.attemptState === "PARTIAL")
  ) {
    return Object.freeze({
      ...base,
      kind: "RETRY_REVIEW_REQUIRED" as const,
      reasonCodes: Object.freeze([
        "AUTHORITATIVE_QUERY_FOUND_NO_ORDER",
        "RETRY_REQUIRES_FRESH_EXPLICIT_AUTHORITY",
      ]),
      queryRequired: false,
      retryReviewRequired: true,
    });
  }
  return Object.freeze({
    ...base,
    kind: "MANUAL_REVIEW_REQUIRED" as const,
    reasonCodes: Object.freeze(["RESTART_STATE_COMBINATION_UNRESOLVED"]),
    queryRequired: false,
    retryReviewRequired: false,
  });
}

function statusForStep(step: Readonly<SpotRestartRecoveryStep>): string {
  switch (step.kind) {
    case "QUERY_BY_CLIENT_ORDER_ID":
      return "QUERY_REQUIRED";
    case "HOLD_OPEN_ATTEMPT":
    case "HOLD_PARTIAL_ATTEMPT":
      return "HELD";
    case "RECONCILE_TERMINAL":
      return "RECONCILIATION_REQUIRED";
    case "RETRY_REVIEW_REQUIRED":
      return "RETRY_REVIEW_REQUIRED";
    case "MANUAL_REVIEW_REQUIRED":
      return "MANUAL_REVIEW_REQUIRED";
    case "NO_ACTION":
      return "NO_ACTION";
  }
}

export function planSpotRestartRecovery(
  restartIdValue: string,
  attemptsValue: readonly Readonly<SpotRestartAttempt>[],
  clock: Readonly<SpotClock>,
): Readonly<SpotRestartRecoveryPlan> {
  const restartId = normalizedRestartId(restartIdValue);
  if (!Array.isArray(attemptsValue) || attemptsValue.length > 4_096) {
    throw new TypeError("restart attempts are malformed");
  }
  const generatedAtMs = generatedTime(clock);
  const fixedClock = Object.freeze({ nowMs: () => generatedAtMs });
  const attempts = [...attemptsValue].sort((left, right) => {
    const leftKey = spotCorrelationKeys(left.correlation).attempt;
    const rightKey = spotCorrelationKeys(right.correlation).attempt;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
  const seen = new Set<string>();
  const steps = attempts.map((attempt, index) => {
    if (typeof attempt !== "object" || attempt === null) {
      throw new TypeError("restart attempt is malformed");
    }
    if (!["AMBIGUOUS", "OPEN", "PARTIAL", "TERMINAL"].includes(attempt.attemptState)) {
      throw new TypeError("restart attempt state is malformed");
    }
    if (
      ![
        "NOT_QUERIED",
        "FOUND_OPEN",
        "FOUND_PARTIAL",
        "FOUND_TERMINAL",
        "AUTHORITATIVE_NOT_FOUND",
        "UNAVAILABLE",
        "AMBIGUOUS",
      ].includes(attempt.exchangeQueryState)
    ) {
      throw new TypeError("exchange query state is malformed");
    }
    const attemptKey = spotCorrelationKeys(attempt.correlation).attempt;
    if (seen.has(attemptKey)) {
      throw new TypeError("restart attempts reuse an attempt correlation");
    }
    seen.add(attemptKey);
    return stepForAttempt(attempt, index);
  });
  const appendIntents = steps.map((step, index) => {
    const attempt = attempts[index]!;
    return buildSpotLedgerAppendIntent(
      {
        eventKind: "RECOVERY",
        eventRevision: `${restartId}.${step.ordinal}.${step.kind}`,
        symbol: attempt.symbol,
        correlation: attempt.correlation,
        occurredAtMs: generatedAtMs,
        status: statusForStep(step),
        reasonCodes: step.reasonCodes,
      },
      fixedClock,
    );
  });
  return Object.freeze({
    schema: "cosmos.foundation.spot-restart-recovery.v1" as const,
    version: 1 as const,
    restartId,
    generatedAtMs,
    steps: Object.freeze(steps),
    appendIntents: Object.freeze(appendIntents),
    queriesBeforeRetry: true as const,
    sendsPerformed: 0 as const,
    sendAuthorized: false as const,
    retryAuthorized: false as const,
    executionAuthority: "NONE" as const,
    externalActionAuthorization: "NONE" as const,
  });
}
