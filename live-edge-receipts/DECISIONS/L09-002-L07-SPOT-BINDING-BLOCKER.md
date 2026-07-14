# L09-002 — accepted Spot policy binding does not reach the L07 twin

Status: `BLOCKED_FOR_LANE_L09`

Date: `2026-07-13`

Authority: launch-gate decision for L09 only. This decision creates no
strategy, Capital, Risk, execution, reconciliation, control, persistence,
exchange or external-action authority.

## Decision

The L09-001 resume condition is satisfied: the director rebased L09 onto the
accepted L08.1 cut, and the accepted evaluator now emits the required ordered,
non-sendable normal-Basis policy plan.

L09 nevertheless remains blocked before implementation because the next owner
in the required chain, the accepted L07 exchange twin, has no seam that consumes
the L08.1 Spot order/TIF binding. The exact accepted Spot `BUY LIMIT GTC` leg is
therefore rejected by L07 as `PREFLIGHT_NOT_EXACT` with zero fill. A matching
USD-M `SELL LIMIT GTC` fixture fills, proving that this is the Spot owner-binding
gap rather than a general twin failure.

The exclusive future adapter route remains:

- `server/src/liveEdge/adapters/normalBasis/**`
- `server/test/liveEdge/normalBasis/**`

No implementation is permitted until the shared owner path can carry the exact
L08.1 Spot capability through L07 without forging or bypassing owner truth.

## Mechanical evidence

The accepted L08.1 proof passes and emits:

```json
{
  "disposition": "PLANNED",
  "sequenceMode": "ORDERED",
  "legs": [
    { "product": "SPOT", "side": "BUY", "orderType": "LIMIT", "timeInForce": "GTC" },
    { "product": "USD_M_PERPETUAL", "side": "SELL", "quantitySource": "ACTUAL_FILL_OF_LEG" }
  ],
  "sendEligible": false,
  "actionAuthority": "NONE_RECORD_ONLY",
  "externalActionAuthorization": "NONE"
}
```

The current L04 owner has two deliberate entrypoints:

1. `preflightInstrumentSizing(registry, request)` preserves the accepted
   pre-bridge behavior and returns `BLOCKED` with
   `TIME_IN_FORCE_NOT_ADVERTISED` for the exact Spot `LIMIT GTC` request.
2. `bindSpotOrderTifCapability(registry, request)` binds the documentary
   capability and returns `PASS`, `GTC`, `sendEligible=false` and authority
   `NONE`.

L07 calls only the first entrypoint in
`server/src/liveEdge/adapters/exchangeTwin/ownerEvidence.ts`. Its exact
preflight gate requires `staticState=PASS` with no reasons, then maps failure to
`PREFLIGHT_NOT_EXACT` at venue arrival. The compiled paired probe produced:

```json
{"product":"SPOT","venueStatus":"BLOCKED","localTruth":"OBSERVED","filledQuantity":"0","blockedReasonCodes":["PREFLIGHT_NOT_EXACT"],"authority":["SYNTHETIC_FIXTURE","NONE_RECORD_ONLY","NONE"]}
{"product":"USD_M_PERPETUAL","venueStatus":"FILLED","localTruth":"ACKNOWLEDGED","filledQuantity":"0.03","blockedReasonCodes":[],"authority":["SYNTHETIC_FIXTURE","NONE_RECORD_ONLY","NONE"]}
```

The accumulated live-edge purity gate also forbids direct imports of Foundation
execution/risk/reconciliation, Capital, strategy engines and Ledger from the
exclusive L09 source path. Any resumed design must preserve that gate through
an explicitly accepted injection/composition seam rather than weakening it
inside L09.

## Current official-source check

Official public sources were rechecked on `2026-07-13`; no endpoint or account
was called.

- Spot order statuses and `GTC`/`IOC`/`FOK` semantics:
  `https://developers.binance.com/en/docs/products/spot/enums`
- Spot execution reports retain last and cumulative fill quantity:
  `https://developers.binance.com/en/docs/products/spot/user-data-stream`
- Spot timeouts and some server errors leave execution status unknown:
  `https://developers.binance.com/en/docs/products/spot/rest-api`
- USD-M order mode, `positionSide` and `reduceOnly` semantics:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade`

These semantics confirm that partial fills and ambiguity must remain visible;
they do not create the missing L07 owner-binding seam.

## Rejected alternatives

- `REJECT`: handcraft an L07 Spot `PASS` result. L07 must replay its canonical
  owner and validates checkpoints against that result.
- `REJECT`: change the accepted Spot action to `MARKET`, null TIF or a USD-M
  product merely to make L07 pass. That no longer proves the accepted L08.1
  plan.
- `REJECT`: duplicate L07 fill mechanics under `normalBasis/**`. L07 is the
  accepted exchange-simulation owner.
- `REJECT`: bypass L07 with a generic Foundation fake port. The required L09
  chain explicitly includes accepted L06/L07 evidence.
- `REJECT`: import or recreate Foundation, Capital, Basis or reconciliation
  authority inside `liveEdge/**`. The authority map and purity gate forbid it.
- `REJECT`: edit L04, L07, L08.1, Foundation or the purity gate from this shard.
  Those paths are outside L09's exclusive allowlist.

## Required director action

Land a separately owned shared bridge that lets L07 rerun and bind the exact
accepted L08.1 Spot capability while preserving the legacy one-argument L04
preflight's fail-closed behavior. The director must also provide an accepted
composition seam that lets L09 adapt, rather than import or replace, the
Foundation lifecycle under the live-edge purity law. Rebase L09 onto that exact
accepted cut and provide the new SHA.

Until then, L09 is `BLOCKED_SHARED_OWNER_DEPENDENCY`, not `PARTIAL`,
`LANE_READY` or `ACCEPTED`.

## Hard boundary

No private read, signer, signed/test/live order, real send/query/cancel, socket,
listen key, Margin action, capital mutation, AWS/Cloudflare/deployment action,
service restart, withdrawal, transfer or push occurred. No secret was inspected.
