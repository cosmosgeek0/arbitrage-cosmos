# L09-006 — D0009 account-isolation owner dependency

Decision status: `BLOCKED_SHARED_L02_L05_OWNER_DEPENDENCY`

Decision date: `2026-07-13`

Director ruling verified:
`3acd1164671ecb8f19b4649455fabbdc17181a9d`

Correction base:
`a7a0f7c8f154539b05b7fb9845f1a4a3dec60eb8`

## Decision

Do not commit or accept the D-LAUNCH-12 correction as L09.

The correction phase found a precise shared-owner dependency that the granted
paths cannot resolve. Canonical L05 truth reports `USDM_ACCOUNT`,
`USDM_POSITIONS` and standard `USDM_OPEN_ORDERS` as current, complete and
usable, but reports `USDM_ALGO_OPEN_ORDERS` as:

- `readState=UNAVAILABLE`;
- `completeness=UNAVAILABLE`;
- `usableAsPrivateEvidence=false`; and
- `gapReason=UNAVAILABLE_L02_CONTRACT_GAP_USDM_ALGO_OPEN_ORDERS`.

Accepted decision D0009 states that standard USD-M `/openOrders` cannot prove
product-wide conditional-order absence. A normalBasis-only projection cannot
convert this explicit owner gap into an empty set without duplicating L02/L05
private-truth authority.

D-LAUNCH-12 grants normalBasis, Foundation execution and accepted L07 twin
paths only. It does not authorize the L02 Binance contract matrix or L05
private-truth owner, and it does not explicitly waive or supersede D0009.

## Rejected false-green fragment

The correction briefly added a standard-order-only flat-account predicate.
Independent review proved that predicate was not an account-isolation proof:

1. it omitted the separately owned algo-order fact; and
2. it required a zero target position for close/recovery USD-M legs, even
   though a reduce-only BUY must be bound to the exact checkpoint-proved short
   residual.

That predicate, its flat fixture rewrite and its apparent positive tests were
removed. They are not retained as evidence and are not represented as a
partial solution.

## Surviving correction work

The uncommitted working tree retains independently reviewable corrections for
the other named findings:

- base-asset fee-adjusted Spot exposure remains distinct from gross fill;
- L03 request semantics are retained through a bounded secret-free owner input
  witness and replayed by L07, so a recomputed self-attested projection fails;
- entry venue-arrival expiry is exclusive and fail-closed;
- the Foundation binary64 close residual is projected to exact L07 decimal
  only after strict raw Foundation equality;
- `REJECTED` and `EXPIRED_IN_MATCH` are retained, and terminal partials map to
  canonical `CANCELLED` truth;
- terminal `FAILED` agreement is represented; and
- partial, rejected and terminal-partial close plus close/recovery cold-restart
  cases retain residual and same-identity safety.

These changes are not an accepted implementation cut. No implementation commit
was created because the mandatory account-isolation finding remains unresolved
before the accumulated/full gate sequence.

## Independent review

Two separate read-only reviews reached the same blocking verdict:

- `correction_scope_review`: D0009 makes complete open-order isolation
  impossible under the granted paths; the standard-only fragment must not be
  presented as complete.
- `correction_behavior_review`: no normalBasis-only positive proof exists;
  stage-aware standard position truth is locally implementable only after the
  algo-order dependency is resolved or explicitly narrowed.

The behavior review also found and caused correction of a request-evidence
self-attestation weakness and required a direct hostile exact-decimal seam
proof before this stop.

## Required director ruling

Resume only after one of these is recorded durably:

1. exact owner-scoped L02/L05 path authority to add the current USD-M all-algo
   open-orders contract and usable private fact, followed by a stage-aware
   normalBasis proof across account, position, standard-order and algo-order
   cuts; or
2. an explicit evidence-backed ruling that narrows the L09-005 account/open-
   order isolation finding and specifically disposes D0009.

No System Integration exception is inferred. The mandated post-correction
System Integration result was not reached in this blocked attempt and remains
unwaived.

## Preserved boundary

No private/account read, credential access, signer call, signed/test/live
order, real send/query/cancel, Margin action, capital mutation, network call,
cloud mutation, deployment, process restart, merge, push, withdrawal or
transfer was performed. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
