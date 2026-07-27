import assert from "node:assert/strict";
import test from "node:test";

import {
  buildSpotLedgerAppendIntent,
  classifySpotLedgerDiscrepancy,
  coalesceSpotLedgerAppendIntents,
  spotCorrelationKeys,
} from "../../../dist/foundation/reconciliation/spotLedgerBridge.js";
import { planSpotRestartRecovery } from "../../../dist/foundation/reconciliation/spotRestartRecovery.js";

const T0 = 1_900_000_000_000;
const clock = Object.freeze({ nowMs: () => T0 });

function correlation(overrides = {}) {
  return Object.freeze({
    ticketId: "ticket/spot-001",
    clientOrderId: "client-order-001",
    orderId: "venue-order-001",
    fillId: null,
    cancelId: null,
    flattenId: null,
    attemptKind: "ORDER",
    ...overrides,
  });
}

test("spot bridge derives stable ticket/order/fill/cancel/flatten keys and coalesces exact duplicates", () => {
  const orderCorrelation = correlation();
  const fillCorrelation = correlation({ fillId: "trade-7" });
  const cancelCorrelation = correlation({
    cancelId: "cancel-3",
    attemptKind: "CANCEL",
  });
  const flattenCorrelation = correlation({
    flattenId: "flatten-2",
    attemptKind: "FLATTEN",
  });

  const orderKeys = spotCorrelationKeys(orderCorrelation);
  const fillKeys = spotCorrelationKeys(fillCorrelation);
  const cancelKeys = spotCorrelationKeys(cancelCorrelation);
  const flattenKeys = spotCorrelationKeys(flattenCorrelation);
  assert.equal(orderKeys.ticket, fillKeys.ticket);
  assert.equal(orderKeys.clientOrder, cancelKeys.clientOrder);
  assert.match(fillKeys.fill, /trade-7$/);
  assert.match(cancelKeys.cancel, /cancel-3$/);
  assert.match(flattenKeys.flatten, /flatten-2$/);

  const input = Object.freeze({
    eventKind: "ORDER",
    eventRevision: "private-order-cut-9",
    symbol: "BTCUSDT",
    correlation: orderCorrelation,
    side: "BUY",
    baseQuantity: "0.125",
    quoteQuantity: "8125",
    feeQuantity: null,
    feeAsset: null,
    occurredAtMs: T0 - 10,
    status: "OPEN",
    reasonCodes: Object.freeze(["ORDER_OBSERVED"]),
  });
  const first = buildSpotLedgerAppendIntent(input, clock);
  const duplicate = buildSpotLedgerAppendIntent(
    input,
    Object.freeze({ nowMs: () => T0 + 500 }),
  );
  const coalesced = coalesceSpotLedgerAppendIntents([first, duplicate]);
  assert.equal(first.dedupeKey, duplicate.dedupeKey);
  assert.equal(first.data.dedupeKey, first.dedupeKey);
  assert.equal(first.createdAt, T0);
  assert.equal(duplicate.createdAt, T0 + 500);
  assert.equal(coalesced.append.length, 1);
  assert.deepEqual(coalesced.duplicateDedupeKeys, [first.dedupeKey]);
  assert.equal(coalesced.conflicts.length, 0);
});

test("spot bridge retains exact financial equality fields and rejects incomplete fill truth", () => {
  const fillInput = Object.freeze({
    eventKind: "FILL",
    eventRevision: "private-fill-cut-11",
    symbol: "BTCUSDT",
    correlation: correlation({ fillId: "trade-11" }),
    side: "SELL",
    baseQuantity: "0.125",
    quoteQuantity: "8125.5",
    feeQuantity: "0.000125",
    feeAsset: "BNB",
    occurredAtMs: T0 - 5,
    status: "FILLED",
    reasonCodes: Object.freeze(["FILL_OBSERVED"]),
  });
  const fill = buildSpotLedgerAppendIntent(fillInput, clock);
  assert.deepEqual(
    {
      side: fill.data.side,
      baseQuantity: fill.data.baseQuantity,
      quoteQuantity: fill.data.quoteQuantity,
      feeQuantity: fill.data.feeQuantity,
      feeAsset: fill.data.feeAsset,
    },
    {
      side: "SELL",
      baseQuantity: "0.125",
      quoteQuantity: "8125.5",
      feeQuantity: "0.000125",
      feeAsset: "BNB",
    },
  );
  const changedFinancialTruth = buildSpotLedgerAppendIntent(
    { ...fillInput, feeQuantity: "0.000126" },
    clock,
  );
  const conflictingReplay = coalesceSpotLedgerAppendIntents([
    fill,
    changedFinancialTruth,
  ]);
  assert.equal(conflictingReplay.duplicateDedupeKeys.length, 0);
  assert.equal(conflictingReplay.conflicts.length, 1);
  assert.equal(conflictingReplay.conflicts[0].dedupeKey, fill.dedupeKey);
  assert.throws(
    () => buildSpotLedgerAppendIntent(
      { ...fillInput, feeQuantity: null },
      clock,
    ),
    /fee quantity must be a canonical non-negative exact decimal/,
  );
  assert.throws(
    () => buildSpotLedgerAppendIntent(
      {
        ...fillInput,
        eventKind: "CANCEL",
        correlation: correlation({
          fillId: null,
          cancelId: "cancel-11",
          attemptKind: "CANCEL",
        }),
      },
      clock,
    ),
    /CANCEL event cannot carry financial observation fields/,
  );
});

test("canonical partial and unavailable exchange truth cannot become false ledger exact", () => {
  assert.deepEqual(
    classifySpotLedgerDiscrepancy({
      canonicalStatus: "PARTIAL",
      ledgerState: "MATCHED",
    }),
    {
      canonicalStatus: "PARTIAL",
      ledgerState: "MATCHED",
      classification: "PARTIAL",
      reasonCodes: ["CANONICAL_RECONCILIATION_PARTIAL"],
      executionAuthority: "NONE",
      externalActionAuthorization: "NONE",
    },
  );
  assert.equal(
    classifySpotLedgerDiscrepancy({
      canonicalStatus: "UNAVAILABLE",
      ledgerState: "MATCHED",
    }).classification,
    "UNKNOWN",
  );
  assert.equal(
    classifySpotLedgerDiscrepancy({
      canonicalStatus: "EXACT",
      ledgerState: "INTENT_ONLY",
    }).classification,
    "PARTIAL",
  );
  assert.equal(
    classifySpotLedgerDiscrepancy({
      canonicalStatus: "EXACT",
      ledgerState: "MATCHED",
    }).classification,
    "EXACT",
  );
});

test("restart recovery queries ambiguous/open attempts before retry review and never sends", () => {
  const ambiguous = Object.freeze({
    symbol: "BTCUSDT",
    correlation: correlation(),
    attemptState: "AMBIGUOUS",
    exchangeQueryState: "NOT_QUERIED",
    canonicalStatus: null,
  });
  const open = Object.freeze({
    symbol: "ETHUSDT",
    correlation: correlation({
      ticketId: "ticket-spot-002",
      clientOrderId: "client-order-002",
      orderId: "venue-order-002",
    }),
    attemptState: "OPEN",
    exchangeQueryState: "FOUND_OPEN",
    canonicalStatus: "PENDING",
  });
  const firstPass = planSpotRestartRecovery(
    "restart-20260727-a",
    [open, ambiguous],
    clock,
  );
  const ambiguousStep = firstPass.steps.find(
    (step) => step.kind === "QUERY_BY_CLIENT_ORDER_ID",
  );
  assert.ok(ambiguousStep);
  assert.equal(ambiguousStep.queryRequired, true);
  assert.equal(ambiguousStep.retryAuthorized, false);
  assert.ok(firstPass.steps.some((step) => step.kind === "HOLD_OPEN_ATTEMPT"));
  assert.equal(firstPass.queriesBeforeRetry, true);
  assert.equal(firstPass.sendsPerformed, 0);
  assert.equal(firstPass.sendAuthorized, false);
  assert.equal(firstPass.retryAuthorized, false);
  assert.ok(firstPass.appendIntents.every((intent) =>
    intent.kind === "foundation.spot.restart-recovery" &&
    intent.data.externalActionAuthorization === "NONE"
  ));

  const afterAuthoritativeQuery = planSpotRestartRecovery(
    "restart-20260727-b",
    [
      {
        ...ambiguous,
        exchangeQueryState: "AUTHORITATIVE_NOT_FOUND",
      },
    ],
    clock,
  );
  assert.equal(afterAuthoritativeQuery.steps[0].kind, "RETRY_REVIEW_REQUIRED");
  assert.equal(afterAuthoritativeQuery.steps[0].queryRequired, false);
  assert.equal(afterAuthoritativeQuery.steps[0].retryReviewRequired, true);
  assert.equal(afterAuthoritativeQuery.steps[0].retryAuthorized, false);
  assert.equal(afterAuthoritativeQuery.sendAuthorized, false);
});
