# L09-001 — accepted Spot policy plan is a hard prerequisite

Status: `BLOCKED_FOR_LANE_L09`

Date: `2026-07-13`

Authority: launch-gate decision for L09 only. This decision creates no
strategy, Capital, Risk, execution, reconciliation, control, persistence,
exchange or external-action authority.

## Decision

L09 will not implement or accept a normal-Basis lifecycle until the director
lands the already-requested Spot order/TIF capability bridge in the canonical
L04/L08 owner path.

The exclusive future adapter route is fixed as
`server/src/liveEdge/adapters/normalBasis/**`, with matching tests at
`server/test/liveEdge/normalBasis/**`. The adapter must reuse the existing
Foundation execution coordinator and accepted L06/L07/L08 outputs. It may not
create a new coordinator or forge an L08 plan.

## Mechanical evidence

Accepted L08 contains two simultaneous laws:

1. `PolicyLeg.product === "SPOT"` is valid only with
   `l04PreflightState === "BLOCKED"` and an empty
   `allowedTimeInForce` set because accepted L04 has no bound Spot TIF owner
   evidence.
2. Policy evaluation adds `INSTRUMENT_OR_FILTER_UNAVAILABLE` for every leg
   whose L04 preflight state is not `PASS`, returning no selected plan.

The compiled accepted evaluator was run with both legal owner truth and a
forged positive projection:

```json
{
  "acceptedOwnerSpot": {
    "disposition": "REJECTED",
    "reasonCodes": ["INSTRUMENT_OR_FILTER_UNAVAILABLE"],
    "selectedPlan": null
  },
  "forgedSpotPass": {
    "disposition": "REJECTED",
    "reasonCodes": ["INPUT_REJECTED"],
    "selectedPlan": null
  }
}
```

The existing request
`live-edge-receipts/patches/L08-spot-tif-capability.request.md` describes the
same gap and remains `DIRECTOR_REVIEW_REQUIRED`. Its SHA-256 is
`a80a5f5d70ed2345fc9fc2b085aeab56ff9734ac4afc7e719ea8d5f5d985c0c6`.

## Current primary-source check

Official sources were rechecked on `2026-07-13`; no endpoint or account was
called.

- Spot order statuses retain `PARTIALLY_FILLED` distinctly and treat
  `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED` and `EXPIRED_IN_MATCH` as named
  terminal outcomes:
  `https://github.com/binance/binance-spot-api-docs/blob/master/enums.md#order-status-status`
- Spot execution reports carry last and cumulative filled quantity, so a
  terminal order can still leave economic exposure:
  `https://github.com/binance/binance-spot-api-docs/blob/master/user-data-stream.md#order-update`
- Spot HTTP 5xx execution status is `UNKNOWN`, not proved failure:
  `https://github.com/binance/binance-spot-api-docs/blob/master/rest-api.md#general-api-information`
- Current USD-M order semantics default `positionSide=BOTH` in one-way mode,
  require `positionSide` in hedge mode, and do not permit `reduceOnly` in
  hedge mode:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-order`

These sources confirm the lifecycle invariants to prove after unblock; they do
not repair the missing accepted Spot capability binding.

## Rejected alternatives

- `REJECT`: relabel the L08 default test leg named `leg-spot`; its actual
  product is `USD_M_PERPETUAL`.
- `REJECT`: handcraft a `PLANNED` L08 object; this bypasses the accepted
  evaluator and owner revisions.
- `REJECT`: implement a synthetic L09 ticket reducer/coordinator; Foundation
  already owns the lifecycle.
- `REJECT`: edit L04/L08 from this shard; those are shared owner paths outside
  the exclusive allowlist.
- `REJECT`: claim a fail-closed rejection as staged-entry/hedge/close
  acceptance; it does not exercise the required chain.

## Required director action

Accept or replace the existing L08 Spot capability patch request in the shared
owner path, run its focused/accumulated/full gates, and provide L09 a new exact
base SHA. Until then, L09 is `BLOCKED`, not `PARTIAL`, `LANE_READY` or
`ACCEPTED`.

## Hard boundary

No private read, signer, signed/test/live order, real query/cancel, socket,
Margin action, capital mutation, AWS/Cloudflare/deployment action, service
restart, push, withdrawal or transfer occurred. No secret was inspected.
