# L11-001 — Volume directional lifecycle boundary

Status: `ACCEPTED_FOR_LANE_L11`

Date: `2026-07-13`

## Decision

L11 is one pure adapter projection over existing owners. It consumes closed,
versioned facts from the Volume engine/advisory seam, Capital mandate,
Foundation Risk, account/position truth, L04 sizing, canonical occupancy/
journal projection and the accepted L07 deterministic exchange twin.

It owns no detector, score, proposal, Capital allocation/reservation, Risk
verdict, operator approval, position, ticket, action journal, reconciliation,
recovery, feedback outcome, exchange, signer, connector, route or persistence.
Its action/recovery/feedback values are recommendations for later owner wiring
and are mechanically non-sendable.

## Staging and cap law

- `PROBE`, `CONFIRM` and final `HOLD` sizing cuts are cumulative L04 owner
  projections, strictly increasing and individually bounded by one policy PPM
  ladder and one injected Capital maximum.
- Actual L07 fill quote notional accumulates against that same mandate usage.
  Any over-cap fill is exposure truth plus `RECOVERY_REQUIRED`, never a hidden
  stage success.
- Every increasing request quantity is re-derived from the exact retained
  cumulative cut. Every `REDUCE` quantity is re-derived from the retained
  episode target. A rehashed request cannot substitute a different quantity.
- `ADD_ALLOWED` is an advisory state between confirmed evidence and the final
  add request. The add still requires fresh proposal/advisory/account/Capital/
  Risk/approval/market/sizing/occupancy gates.
- LONG uses quote-funded Spot. SHORT requires an exact pre-owned-base inventory
  revision and enough projected inventory for the full stage cut. No borrow,
  Margin, Futures or transfer path is inferred.

## Protection-revision law

Time-stop, loss-stop, trailing activation/distance, evidence age, no-repeat
window, stage caps, exhaustion reduction and source-degradation posture are one
content-addressed policy. An active lifecycle accepts only the next exact
predecessor revision and rejects any widening of loss, time, trailing, evidence
age or stage exposure. A revision cannot shorten the no-repeat window, weaken
exhaustion reduction or change `EXIT` source-degradation posture back to
`REDUCE`. The favorable price extreme is explicitly preserved.

Loss and trailing comparisons use exact decimal/integer-BPS arithmetic and
trigger inclusively at equality. Time-stop uses only the injected evaluation
time; there is no timer or wall clock.

## Exit and recovery law

All simultaneously true exit facts are retained. A closed total precedence
selects the primary reason. Reconciliation mismatch/unknown has first priority
and hands off to recovery. Global halt, manual close, thesis invalidation,
reversal, maximum loss, trailing stop, time stop and configured source
degradation plan EXIT. Exhaustion, spread/depth deterioration and REDUCE source
degradation plan reduction. A pending action plus a new exit trigger first
requires reconciliation; the adapter never assumes whether the venue acted.

L07 checkpoint validation and replay are mandatory before consuming a twin
state. Only `localTruth=OBSERVED` with exact side, product, symbol, quantity,
price/notional bounds and no open remainder may change projected exposure.
ACK, timeout, 5xx, crash/restart, ordering ambiguity, local/venue mismatch,
recovery flags, open remainder or bound breach cannot authorize another action.
Recovery outputs are recommendation-only handoffs to the existing Foundation
owner.

Exact replay of a settled historical twin is inert and cannot contaminate an
unrelated current recovery correlation. Canonical `NO_EFFECT` may close a
pending entry only when canonical occupancy also proves the ticket absent; the
flat lifecycle then terminalizes and cannot silently repeat. A recovery
resolution cannot hide a still-present halt, reversal, exhaustion or other
protection trigger: unknown truth returns to recovery, while known truth
requires a fresh current Risk recheck before a new risk-reducing request.

## Current primary-source basis

Current primary sources were rechecked before implementation on `2026-07-13`:

- Binance Spot REST general information, updated June/July 2026:
  <https://developers.binance.com/en/docs/products/spot/rest-api>
- Binance Spot enum/TIF definitions:
  <https://developers.binance.com/en/docs/products/spot/enums>
- Binance Spot filters:
  <https://developers.binance.com/en/docs/products/spot/filters>
- Binance Spot User Data Stream execution reports:
  <https://developers.binance.com/en/docs/products/spot/user-data-stream>
- Official Binance trailing-stop FAQ:
  <https://github.com/binance/binance-spot-api-docs/blob/master/faqs/trailing-stop-faq.md>
- SEC market-access risk controls FAQ:
  <https://www.sec.gov/rules-regulations/staff-guidance/trading-markets-frequently-asked-questions/divisionsmarketregfaq-0>
- FIX Session Layer Technical Standard:
  <https://www.fixtrading.org/wp-content/uploads/download-manager-files/FIX_Session_Layer_June_2020.pdf>

Selected implications: venue timeout/5xx is `UNKNOWN` until observation/query;
client order identity and venue limits do not enforce one local lifecycle;
trailing state retains a favorable extreme and uses BIPS; replay/recovery must
be ordered and duplicate-safe. These sources guide the adapter; repository
authority and safety law remain controlling.

## Accepted upstream limitation

L08 correctly reports Spot TIF/execution capability unavailable from the
accepted L04 owner seam, and its production policy rejects market orders that
cannot mechanically enforce the exact price bound. L11 therefore proves only
an L07 synthetic Spot lifecycle and separately rejects any twin fill outside
its injected bound. It does not claim an L08 production Spot plan, production
wiring or live readiness. The existing director request remains
`live-edge-receipts/patches/L08-spot-tif-capability.request.md`; L11 does not
edit or bypass it.

## Explicit non-effects

No private/account endpoint, credential, signer, order, Margin action, capital
change, network, database, deployment, process, cloud or external-action path
was accessed or added. No secret was inspected. No withdrawal or transfer
capability exists. `LIVE_EXECUTION_NOT_IMPLEMENTED` remains enforced.
