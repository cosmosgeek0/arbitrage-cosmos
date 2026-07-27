/**
 * Pure adapter from spot reconciliation facts to the existing Ledger's
 * `LedgerEventInput` envelope. This module owns no persistence and performs no
 * append itself; the canonical Ledger remains the only durable store.
 */

export const SPOT_LEDGER_EVENT_KINDS = [
  "ATTEMPT",
  "ORDER",
  "FILL",
  "CANCEL",
  "FLATTEN",
  "RECONCILIATION",
  "RECOVERY",
] as const;
export type SpotLedgerEventKind = (typeof SPOT_LEDGER_EVENT_KINDS)[number];

export type SpotAttemptKind = "ORDER" | "CANCEL" | "FLATTEN";
export type SpotSide = "BUY" | "SELL";

export interface SpotClock {
  nowMs(): number;
}

export interface SpotCorrelation {
  readonly ticketId: string;
  readonly clientOrderId: string;
  readonly orderId: string | null;
  readonly fillId: string | null;
  readonly cancelId: string | null;
  readonly flattenId: string | null;
  readonly attemptKind: SpotAttemptKind;
}

export interface SpotCorrelationKeys {
  readonly ticket: string;
  readonly clientOrder: string;
  readonly order: string | null;
  readonly fill: string | null;
  readonly cancel: string | null;
  readonly flatten: string | null;
  readonly attempt: string;
}

export type SpotReconciliationStatus =
  | "EXACT"
  | "PENDING"
  | "PARTIAL"
  | "AMBIGUOUS"
  | "DIVERGED"
  | "STALE"
  | "UNAVAILABLE";

export type SpotLedgerProjectionState =
  | "ABSENT"
  | "INTENT_ONLY"
  | "MATCHED"
  | "CONFLICT";

export type SpotDiscrepancyClassification =
  | "EXACT"
  | "PARTIAL"
  | "UNKNOWN"
  | "DIVERGED";

export interface SpotDiscrepancyInput {
  readonly canonicalStatus: SpotReconciliationStatus;
  readonly ledgerState: SpotLedgerProjectionState;
}

export interface SpotDiscrepancyResult extends SpotDiscrepancyInput {
  readonly classification: SpotDiscrepancyClassification;
  readonly reasonCodes: readonly string[];
  readonly executionAuthority: "NONE";
  readonly externalActionAuthorization: "NONE";
}

export interface SpotLedgerFactInput {
  readonly eventKind: SpotLedgerEventKind;
  readonly eventRevision: string;
  readonly symbol: string;
  readonly correlation: Readonly<SpotCorrelation>;
  readonly side?: SpotSide | null;
  readonly baseQuantity?: string | null;
  readonly quoteQuantity?: string | null;
  readonly feeQuantity?: string | null;
  readonly feeAsset?: string | null;
  readonly occurredAtMs: number;
  readonly status: string;
  readonly reasonCodes?: readonly string[];
}

export interface SpotLedgerEventData {
  readonly schema: "cosmos.foundation.spot-ledger-bridge.v1";
  readonly version: 1;
  readonly eventKind: SpotLedgerEventKind;
  readonly eventRevision: string;
  readonly dedupeKey: string;
  readonly correlation: Readonly<SpotCorrelation>;
  readonly correlationKeys: Readonly<SpotCorrelationKeys>;
  readonly side: SpotSide | null;
  readonly baseQuantity: string | null;
  readonly quoteQuantity: string | null;
  readonly feeQuantity: string | null;
  readonly feeAsset: string | null;
  readonly occurredAtMs: number;
  readonly status: string;
  readonly reasonCodes: readonly string[];
  readonly executionAuthority: "NONE";
  readonly externalActionAuthorization: "NONE";
}

/**
 * Structurally compatible with the canonical Ledger's `LedgerEventInput`.
 * `dedupeKey` is adapter metadata and is also retained in `data`; the Ledger
 * adapter appends this envelope after applying the pure coalescing result.
 */
export interface SpotLedgerAppendIntent {
  readonly kind: string;
  readonly symbol: string;
  readonly data: Readonly<SpotLedgerEventData>;
  readonly severity: "info" | "warning";
  readonly source: "foundation.reconciliation.spot";
  readonly strategy: null;
  readonly status: string;
  readonly reason: string | null;
  readonly message: null;
  readonly correlation: string;
  readonly createdAt: number;
  readonly dedupeKey: string;
}

export interface SpotLedgerIntentConflict {
  readonly dedupeKey: string;
  readonly first: Readonly<SpotLedgerAppendIntent>;
  readonly conflicting: Readonly<SpotLedgerAppendIntent>;
}

export interface CoalescedSpotLedgerIntents {
  readonly append: readonly Readonly<SpotLedgerAppendIntent>[];
  readonly duplicateDedupeKeys: readonly string[];
  readonly conflicts: readonly Readonly<SpotLedgerIntentConflict>[];
}

const MAX_UTC_MS = 8_640_000_000_000_000;
const EVENT_KIND_TO_LEDGER_KIND: Readonly<Record<SpotLedgerEventKind, string>> =
  Object.freeze({
    ATTEMPT: "foundation.spot.attempt",
    ORDER: "foundation.spot.order",
    FILL: "foundation.spot.fill",
    CANCEL: "foundation.spot.cancel",
    FLATTEN: "foundation.spot.flatten",
    RECONCILIATION: "foundation.spot.reconciliation",
    RECOVERY: "foundation.spot.restart-recovery",
  });

function assertUtcMs(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_UTC_MS) {
    throw new TypeError(`${label} must be a non-negative safe UTC millisecond`);
  }
  return value;
}

function identity(value: string, label: string, maximumLength = 256): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new TypeError(`${label} is malformed`);
  }
  return value;
}

function statusIdentity(value: string): string {
  if (
    typeof value !== "string" ||
    !/^[A-Z][A-Z0-9_.:-]{0,63}$/u.test(value)
  ) {
    throw new TypeError("spot ledger status is malformed");
  }
  return value;
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function scopedKey(scope: string, parts: readonly string[]): string {
  return `spot/${scope}/${parts.map(segment).join("/")}`;
}

function normalizeReasonCodes(value: readonly string[] | undefined): readonly string[] {
  if (value === undefined) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 64) {
    throw new TypeError("spot ledger reason codes are malformed");
  }
  const normalized = value.map((reason) => {
    if (
      typeof reason !== "string" ||
      !/^[A-Z][A-Z0-9_.:-]{0,95}$/u.test(reason)
    ) {
      throw new TypeError("spot ledger reason code is malformed");
    }
    return reason;
  });
  return Object.freeze([...new Set(normalized)].sort());
}

function exactQuantity(
  value: string | null | undefined,
  label: string,
): string {
  if (
    typeof value !== "string" ||
    value.length > 96 ||
    !/^(?:0|[1-9][0-9]*|(?:0|[1-9][0-9]*)\.[0-9]*[1-9])$/u.test(value)
  ) {
    throw new TypeError(`${label} must be a canonical non-negative exact decimal`);
  }
  return value;
}

interface SpotFinancialTruth {
  readonly side: SpotSide | null;
  readonly baseQuantity: string | null;
  readonly quoteQuantity: string | null;
  readonly feeQuantity: string | null;
  readonly feeAsset: string | null;
}

function normalizeFinancialTruth(
  value: Readonly<SpotLedgerFactInput>,
  correlation: Readonly<SpotCorrelation>,
): Readonly<SpotFinancialTruth> {
  const noFinancialObservation =
    value.eventKind === "CANCEL" ||
    value.eventKind === "RECOVERY" ||
    (value.eventKind === "ATTEMPT" && correlation.attemptKind === "CANCEL");
  if (noFinancialObservation) {
    if (
      value.side != null ||
      value.baseQuantity != null ||
      value.quoteQuantity != null ||
      value.feeQuantity != null ||
      value.feeAsset != null
    ) {
      throw new TypeError(`${value.eventKind} event cannot carry financial observation fields`);
    }
    return Object.freeze({
      side: null,
      baseQuantity: null,
      quoteQuantity: null,
      feeQuantity: null,
      feeAsset: null,
    });
  }

  if (value.side !== "BUY" && value.side !== "SELL") {
    throw new TypeError(`${value.eventKind} event requires BUY or SELL side`);
  }
  const baseQuantity = exactQuantity(value.baseQuantity, "base quantity");
  const quoteQuantity = exactQuantity(value.quoteQuantity, "quote quantity");
  const fullFeeObservation =
    value.eventKind === "FILL" || value.eventKind === "RECONCILIATION";
  if (fullFeeObservation) {
    const feeQuantity = exactQuantity(value.feeQuantity, "fee quantity");
    const feeAsset = identity(value.feeAsset as string, "fee asset", 64);
    return Object.freeze({
      side: value.side,
      baseQuantity,
      quoteQuantity,
      feeQuantity,
      feeAsset,
    });
  }
  if (value.feeQuantity != null || value.feeAsset != null) {
    throw new TypeError(`${value.eventKind} event cannot carry fill fee observation`);
  }
  return Object.freeze({
    side: value.side,
    baseQuantity,
    quoteQuantity,
    feeQuantity: null,
    feeAsset: null,
  });
}

function normalizeCorrelation(
  value: Readonly<SpotCorrelation>,
): Readonly<SpotCorrelation> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("spot correlation must be an object");
  }
  const normalized = Object.freeze({
    ticketId: identity(value.ticketId, "ticket id"),
    clientOrderId: identity(value.clientOrderId, "client order id"),
    orderId: value.orderId === null ? null : identity(value.orderId, "order id"),
    fillId: value.fillId === null ? null : identity(value.fillId, "fill id"),
    cancelId: value.cancelId === null ? null : identity(value.cancelId, "cancel id"),
    flattenId:
      value.flattenId === null ? null : identity(value.flattenId, "flatten id"),
    attemptKind: value.attemptKind,
  });
  if (
    normalized.attemptKind !== "ORDER" &&
    normalized.attemptKind !== "CANCEL" &&
    normalized.attemptKind !== "FLATTEN"
  ) {
    throw new TypeError("spot attempt kind is malformed");
  }
  if (normalized.attemptKind === "CANCEL" && normalized.cancelId === null) {
    throw new TypeError("cancel attempt requires cancel id");
  }
  if (normalized.attemptKind === "FLATTEN" && normalized.flattenId === null) {
    throw new TypeError("flatten attempt requires flatten id");
  }
  return normalized;
}

export function spotCorrelationKeys(
  value: Readonly<SpotCorrelation>,
): Readonly<SpotCorrelationKeys> {
  const correlation = normalizeCorrelation(value);
  const ticket = scopedKey("ticket", [correlation.ticketId]);
  const clientOrder = scopedKey("client-order", [
    correlation.ticketId,
    correlation.clientOrderId,
  ]);
  const order =
    correlation.orderId === null
      ? null
      : scopedKey("order", [
          correlation.ticketId,
          correlation.clientOrderId,
          correlation.orderId,
        ]);
  const fill =
    correlation.fillId === null
      ? null
      : scopedKey("fill", [
          correlation.ticketId,
          correlation.clientOrderId,
          correlation.orderId ?? "ORDER_ID_UNKNOWN",
          correlation.fillId,
        ]);
  const cancel =
    correlation.cancelId === null
      ? null
      : scopedKey("cancel", [
          correlation.ticketId,
          correlation.clientOrderId,
          correlation.orderId ?? "ORDER_ID_UNKNOWN",
          correlation.cancelId,
        ]);
  const flatten =
    correlation.flattenId === null
      ? null
      : scopedKey("flatten", [
          correlation.ticketId,
          correlation.clientOrderId,
          correlation.flattenId,
        ]);
  const attempt =
    correlation.attemptKind === "ORDER"
      ? scopedKey("attempt", ["ORDER", clientOrder])
      : correlation.attemptKind === "CANCEL"
        ? scopedKey("attempt", ["CANCEL", cancel!])
        : scopedKey("attempt", ["FLATTEN", flatten!]);
  return Object.freeze({
    ticket,
    clientOrder,
    order,
    fill,
    cancel,
    flatten,
    attempt,
  });
}

function identityKeyForEvent(
  eventKind: SpotLedgerEventKind,
  keys: Readonly<SpotCorrelationKeys>,
): string {
  switch (eventKind) {
    case "ATTEMPT":
    case "RECONCILIATION":
    case "RECOVERY":
      return keys.attempt;
    case "ORDER":
      if (keys.order === null) throw new TypeError("order event requires order id");
      return keys.order;
    case "FILL":
      if (keys.order === null || keys.fill === null) {
        throw new TypeError("fill event requires order and fill ids");
      }
      return keys.fill;
    case "CANCEL":
      if (keys.cancel === null) throw new TypeError("cancel event requires cancel id");
      return keys.cancel;
    case "FLATTEN":
      if (keys.flatten === null) {
        throw new TypeError("flatten event requires flatten id");
      }
      return keys.flatten;
  }
}

export function buildSpotLedgerAppendIntent(
  value: Readonly<SpotLedgerFactInput>,
  clock: Readonly<SpotClock>,
): Readonly<SpotLedgerAppendIntent> {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("spot ledger fact must be an object");
  }
  if (!(SPOT_LEDGER_EVENT_KINDS as readonly unknown[]).includes(value.eventKind)) {
    throw new TypeError("spot ledger event kind is malformed");
  }
  if (typeof clock !== "object" || clock === null || typeof clock.nowMs !== "function") {
    throw new TypeError("spot ledger clock is malformed");
  }
  const createdAt = assertUtcMs(clock.nowMs(), "spot ledger created time");
  const occurredAtMs = assertUtcMs(value.occurredAtMs, "spot ledger occurrence time");
  if (occurredAtMs > createdAt) {
    throw new TypeError("spot ledger occurrence time exceeds injected receipt time");
  }
  const eventRevision = identity(value.eventRevision, "event revision");
  const symbol = identity(value.symbol, "spot symbol", 96);
  const correlation = normalizeCorrelation(value.correlation);
  const correlationKeys = spotCorrelationKeys(correlation);
  const financialTruth = normalizeFinancialTruth(value, correlation);
  const status = statusIdentity(value.status);
  const reasonCodes = normalizeReasonCodes(value.reasonCodes);
  const eventIdentity = identityKeyForEvent(value.eventKind, correlationKeys);
  const dedupeKey = `${eventIdentity}/event/${value.eventKind.toLowerCase()}/${segment(eventRevision)}`;
  const data = Object.freeze({
    schema: "cosmos.foundation.spot-ledger-bridge.v1" as const,
    version: 1 as const,
    eventKind: value.eventKind,
    eventRevision,
    dedupeKey,
    correlation,
    correlationKeys,
    ...financialTruth,
    occurredAtMs,
    status,
    reasonCodes,
    executionAuthority: "NONE" as const,
    externalActionAuthorization: "NONE" as const,
  });
  const warningStatuses = new Set([
    "AMBIGUOUS",
    "DIVERGED",
    "STALE",
    "UNAVAILABLE",
    "UNKNOWN",
    "QUERY_REQUIRED",
    "MANUAL_REVIEW_REQUIRED",
  ]);
  return Object.freeze({
    kind: EVENT_KIND_TO_LEDGER_KIND[value.eventKind],
    symbol,
    data,
    severity: warningStatuses.has(status) ? "warning" : "info",
    source: "foundation.reconciliation.spot" as const,
    strategy: null,
    status,
    reason: reasonCodes[0] ?? null,
    message: null,
    correlation: correlationKeys.attempt,
    createdAt,
    dedupeKey,
  });
}

function intentFingerprint(intent: Readonly<SpotLedgerAppendIntent>): string {
  return JSON.stringify([
    intent.kind,
    intent.symbol,
    intent.data,
    intent.severity,
    intent.source,
    intent.strategy,
    intent.status,
    intent.reason,
    intent.message,
    intent.correlation,
  ]);
}

export function coalesceSpotLedgerAppendIntents(
  values: readonly Readonly<SpotLedgerAppendIntent>[],
): Readonly<CoalescedSpotLedgerIntents> {
  if (!Array.isArray(values) || values.length > 4_096) {
    throw new TypeError("spot ledger append intent batch is malformed");
  }
  const append: Readonly<SpotLedgerAppendIntent>[] = [];
  const duplicates: string[] = [];
  const conflicts: Readonly<SpotLedgerIntentConflict>[] = [];
  const seen = new Map<
    string,
    { readonly intent: Readonly<SpotLedgerAppendIntent>; readonly fingerprint: string }
  >();
  for (const intent of values) {
    if (typeof intent !== "object" || intent === null) {
      throw new TypeError("spot ledger append intent is malformed");
    }
    const prior = seen.get(intent.dedupeKey);
    const fingerprint = intentFingerprint(intent);
    if (prior === undefined) {
      seen.set(intent.dedupeKey, { intent, fingerprint });
      append.push(intent);
    } else if (prior.fingerprint === fingerprint) {
      duplicates.push(intent.dedupeKey);
    } else {
      conflicts.push(
        Object.freeze({
          dedupeKey: intent.dedupeKey,
          first: prior.intent,
          conflicting: intent,
        }),
      );
    }
  }
  return Object.freeze({
    append: Object.freeze(append),
    duplicateDedupeKeys: Object.freeze([...new Set(duplicates)].sort()),
    conflicts: Object.freeze(conflicts),
  });
}

export function classifySpotLedgerDiscrepancy(
  input: Readonly<SpotDiscrepancyInput>,
): Readonly<SpotDiscrepancyResult> {
  const status = input.canonicalStatus;
  const ledgerState = input.ledgerState;
  if (
    ![
      "EXACT",
      "PENDING",
      "PARTIAL",
      "AMBIGUOUS",
      "DIVERGED",
      "STALE",
      "UNAVAILABLE",
    ].includes(status)
  ) {
    throw new TypeError("canonical reconciliation status is malformed");
  }
  if (!["ABSENT", "INTENT_ONLY", "MATCHED", "CONFLICT"].includes(ledgerState)) {
    throw new TypeError("spot ledger projection state is malformed");
  }

  let classification: SpotDiscrepancyClassification;
  let reasonCodes: readonly string[];
  if (ledgerState === "CONFLICT" || status === "DIVERGED") {
    classification = "DIVERGED";
    reasonCodes = Object.freeze([
      ledgerState === "CONFLICT"
        ? "LEDGER_PROJECTION_CONFLICT"
        : "CANONICAL_RECONCILIATION_DIVERGED",
    ]);
  } else if (status === "AMBIGUOUS" || status === "STALE" || status === "UNAVAILABLE") {
    classification = "UNKNOWN";
    reasonCodes = Object.freeze([`CANONICAL_RECONCILIATION_${status}`]);
  } else if (status === "PENDING" || status === "PARTIAL") {
    classification = "PARTIAL";
    reasonCodes = Object.freeze([`CANONICAL_RECONCILIATION_${status}`]);
  } else if (ledgerState !== "MATCHED") {
    classification = "PARTIAL";
    reasonCodes = Object.freeze([
      ledgerState === "ABSENT"
        ? "CANONICAL_FACT_MISSING_FROM_LEDGER"
        : "LEDGER_HAS_INTENT_WITHOUT_MATCHED_OBSERVATION",
    ]);
  } else {
    classification = "EXACT";
    reasonCodes = Object.freeze([]);
  }
  return Object.freeze({
    canonicalStatus: status,
    ledgerState,
    classification,
    reasonCodes,
    executionAuthority: "NONE" as const,
    externalActionAuthorization: "NONE" as const,
  });
}
