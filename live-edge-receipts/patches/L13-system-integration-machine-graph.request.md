# L13 integration request — canonical machine-graph evidence consumption

Request status: `DEFERRED_TO_I00_UNAPPLIED`

Requested owner: System Integration serial integration lead

## Request

After L13 lane acceptance, adapt the inert
`LIVE_EDGE_MACHINE_GRAPH_EVIDENCE_SNAPSHOT_V1` projection into the existing
System Integration supervisor. The integration owner must:

- map only validated role bindings onto its existing canonical components and
  topology; never accept an adapter-invented node or edge;
- retain Foundation Control as desired/observed whole-machine owner and
  Foundation Observability as metric/health/alarm owner;
- preserve nullable unknown, stale, incomplete, reset and window evidence;
- select first root blocker only in the canonical supervisor;
- persist commands only through the accepted command owner and expose them
  only through an authenticated exact-target route;
- keep all 18 actions unavailable until their individual persistence,
  authorization, target, application and verification seams pass;
- treat `HALT` as a recommendation until the canonical control owner applies
  and records it;
- keep liquidation, Capital mutation and external money actions impossible;
- render live/synthetic/stale/unknown truth without client-side health,
  readiness or strategy recomputation.

## Acceptance required from the integration owner

- exact 27-role and canonical-component mapping proof;
- topology/root-cause/attention tests using the existing supervisor;
- Foundation control and observability owner suites;
- authenticated preview/digest/version/idempotency control tests;
- persistence/restart and false-green degraded-state tests;
- rendered cockpit inspection under the `DESIGN.md` ship gate;
- proof that `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.

## Prohibited interpretation

This request is not permission to deploy, restart, fetch private/account data,
retrieve credentials, send a signed request, place a test/live order,
borrow/repay, mutate Capital, transfer/withdraw, merge or push. The L13 adapter
is synthetic, record-only and unwired until the integration owner accepts it.
