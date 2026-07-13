# L08 shared-owner request — Spot execution/TIF capability bridge

Status: `DIRECTOR_REVIEW_REQUIRED`

Requester: L08 production order-policy lane

Owner paths requested: director-controlled L04/static owner seam and later
integration only. This file authorizes no shared edit.

## Exact gap

Accepted L04 intentionally records `SPOT_EXECUTION_RULES_UNAVAILABLE` and
`SPOT_TIME_IN_FORCE_UNAVAILABLE`. Runtime Spot symbol metadata does not expose
a symbol-level TIF list, and the accepted L04 waiting/preflight seam therefore
cannot prove a Spot `LIMIT` candidate with `GTC`, `IOC` or `FOK`.

L08 consumes that truth unchanged. A Spot leg is `BLOCKED`, and no candidate
may infer Spot TIF support from USD-M capability metadata or from a documentary
contract alone. `MARKET` is also unavailable in L08 because it cannot
mechanically enforce the exact policy price bound.

## Requested director decision

If later integration requires Spot order policy, define one narrow owner bridge
that binds the accepted L02 Spot order/TIF contract to the exact L04 instrument,
filter, source-evidence, snapshot and waiting revisions. The bridge must remain
non-sendable, preserve current product-specific losses, and prove invalidation
when either documentary or Runtime evidence changes.

Until that bridge is accepted and tested, the correct posture is
`INSTRUMENT_OR_FILTER_UNAVAILABLE`. This gap does not block L08's fail-closed
USD-M bounded-policy proof and creates no execution authority.
