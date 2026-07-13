# D0012 — L07 deterministic exchange-twin policy

Status: `ACCEPTED_FOR_LANE_L07`

Date: `2026-07-13`

Authority: pure, deterministic construction, validation and reduction of
injected synthetic exchange scenarios only. This decision grants no order,
execution, reconciliation, persistence, connector, signer, private-read,
transport, retry or external-action authority.

## Controlling inputs

- Accepted task: `live-edge-receipts/TASKS/L07.md`
- Accepted L06 receipt: `live-edge-receipts/RECEIPTS/L06.md`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- `ARCHITECTURE.md` Part II canonical owner map
- `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` Section 15
- Accepted L02 Binance source matrix and L03–L06 owner seams

Current public documentation was rechecked on 2026-07-13. The pinned official
Binance source commit `31643ed390e2aa450ce872981556186acf96a195`
matched the upstream `master` tip at verification time. No Binance endpoint,
account, credential, signed operation, listen key, socket, deployment or
process was called.

## Current official sources

### Binance Spot

- General REST, rate and ambiguous-result rules:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/rest-api.md`
- Order types, TIF and symbol/order statuses:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/enums.md`
- Symbol and exchange filters:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/filters.md`
- Diff-depth sequencing and local-book reconstruction:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/web-socket-streams.md`

The current enum contract defines `GTC`, `IOC` and `FOK`; `IOC` expires the
unfilled remainder and `FOK` expires unless the full quantity can fill. Symbol
status includes `TRADING`, `END_OF_DAY`, `HALT`, `BREAK` and `CANCEL_ONLY`.
The depth contract requires a snapshot/update-ID bridge and discarding the
local book after an update gap. These facts constrain injected fixtures; they
do not authorize a stream or request.

The REST contract still says 5xx execution status is `UNKNOWN`, not failed.
Rate-limit excess produces 429, continued violation can produce 418, and
`Retry-After` carries the cooldown. The twin must preserve those outcomes and
must never turn ambiguity into a retry instruction.

### Framework releases and licenses

- NautilusTrader `v1.230.0`, **Beta**, released 2026-06-29:
  `https://github.com/nautechsystems/nautilus_trader/releases/tag/v1.230.0`
- NautilusTrader license, `LGPL-3.0`:
  `https://github.com/nautechsystems/nautilus_trader/blob/v1.230.0/LICENSE`
- NautilusTrader deterministic backtesting and book concepts:
  `https://nautilustrader.io/docs/latest/concepts/backtesting/`
  and `https://nautilustrader.io/docs/latest/concepts/order_book/`
- Hummingbot `v2.15.0`, released 2026-06-16:
  `https://github.com/hummingbot/hummingbot/releases/tag/v2.15.0`
- Hummingbot license, `Apache-2.0`:
  `https://github.com/hummingbot/hummingbot/blob/v2.15.0/LICENSE`
- Hummingbot connector order-lifecycle reference:
  `https://hummingbot.org/connectors/connectors/architecture/order_lifecycle/`

## Framework fit

| Candidate | Capability | Classification | Decision |
| --- | --- | --- | --- |
| Existing Node/TypeScript live-edge code | closed values, exact revisions, injected clocks, bounded pure reducers and network-free tests | `ADOPT` | Continue the repository's current runtime and owner seams. |
| NautilusTrader v1.230.0 Beta | deterministic event/replay, order-book consumption and conservative fill-model concepts | `REFERENCE_ONLY` | Use concepts as adversarial design references; import no Rust/Python runtime or framework state. |
| NautilusTrader v1.230.0 Beta | live execution, OMS, cache, reconciliation and venue adapters | `REJECT` | Embedding would create a second authority/process and an unproved LGPL/runtime integration burden. |
| Hummingbot v2.15.0 | connector and order-lifecycle patterns | `REFERENCE_ONLY` | Use lifecycle patterns only as review input; import no connector or framework state. |
| Hummingbot v2.15.0 | live connector, OMS, strategy runtime or process | `REJECT` | Embedding would duplicate existing execution, strategy, cache and recovery owners. |

No framework package, generated client or runtime is added in L07. A useful
reference does not become a production dependency or authority.

## Deterministic twin law

- The twin consumes only closed injected fixtures with exact timestamps,
  sequences, event IDs, model revision and seed. Ambient clock, timers,
  sockets, network, filesystem, environment and randomness are forbidden.
- Canonical event ordering uses occurrence time, conservative event priority
  and stable sequence/ID. Equivalent accepted event sets must yield identical
  state and outcome hashes regardless of insertion order.
- Venue-oracle state and locally observable state remain separate. An injected
  venue effect may exist while local truth remains `UNKNOWN`; oracle truth is
  never promoted to canonical Foundation or cockpit truth.
- Every output is deeply frozen, bounded and marked
  `simulationAuthority=SYNTHETIC_FIXTURE`,
  `actionAuthority=NONE_RECORD_ONLY` and
  `externalActionAuthorization=NONE`.

## Book and conservative fill law

- Books are exact-decimal, symbol/product-bound snapshots and deltas with
  source sequence and revision. Duplicate/regressed/gapped, crossed,
  unsorted, overbound or otherwise invalid evidence fails closed; a named gap
  makes the book unavailable until an explicit fresh snapshot.
- Fills consume only unconsumed opposite-side liquidity present at venue
  arrival. Total fill cannot exceed requested quantity, the submitted limit
  or explicit eligible depth. A displayed quantity cannot be reused until a
  fresh source revision explicitly replenishes it.
- `FOK` pre-scans eligible depth and is all-or-zero. `IOC` fills eligible
  immediate depth then expires the exact remainder. `GTC` fills its immediately
  marketable part and rests the remainder. `MARKET` has no fabricated or
  infinite liquidity; insufficient explicit depth may partially fill and then
  expire.
- Public L2 cannot prove queue position. Passive queue is `ESTIMATED` or
  `UNKNOWN`; a passive fill requires explicit trade-through plus an injected
  queue-ahead estimate. Quote removal alone is never a fill, and uncalibrated
  cancellation benefit is unavailable.
- ACK, new/working, partial fill, terminal and reconciled/local observation are
  separate axes. Requested quantity and ACK are never fill evidence.

## Status, filter, TIF, ambiguity and rate law

- L07 accepts only the L04-proved `LIMIT`/`MARKET` fixture subset and explicit
  applicable `GTC`/`IOC`/`FOK`; it does not widen L04 with maker-only,
  post-only, price-match, STP or cancel-replace claims.
- L04 static preflight is rerun at injected venue arrival. Only exact `PASS`
  with no transformation and unchanged submitted quantity is admitted.
  Status/filter/reference/book changes during latency affect the result.
- Only `TRADING` admits synthetic placement. `CANCEL_ONLY` admits only an
  explicit cancel fixture; halt, break, end-of-day and unknown block placement.
- Timeout, 5xx or disconnect after possible venue effect remains locally
  `UNKNOWN`; private-before-HTTP and HTTP-before-private must converge without
  resubmission. Equal-time contradictory ordering remains `AMBIGUOUS` unless
  an injected source sequence resolves it.
- L03 remains rate owner. L07 consumes its injected capacity/cooldown evidence:
  exhausted capacity blocks synthetic arrival, 429 observes the injected
  cooldown, and 418 opens manual-circuit posture. L07 creates no limiter and
  emits no retry authority.

## Cancel, crash, fee and calibration law

- Cancel takes effect at its injected venue-arrival time. Fill-before-cancel
  may win; cancel-before-trade blocks later fill. A dropped cancel response is
  `UNKNOWN` pending injected owner reconciliation. Replacement is a distinct
  explicit fixture, never a claim that cancel-replace is accepted.
- Crash may drop configured local deliveries but cannot erase a venue effect
  already reached. Restart stays `RECOVERY_REQUIRED` until exact injected
  owner-reconciliation evidence arrives. Restore cannot duplicate events,
  depth consumption, fills or identities.
- Exact versioned maker/taker fee evidence is retained per fill. When fee asset
  is not quote and exact conversion evidence is absent, quote-equivalent fee
  is `null`, never zero. Spread/depth impact, latency movement, fees and
  adverse selection remain separate axes.
- Calibration is a versioned comparison of predicted versus injected recorded
  outcome revisions. L07 may validate lineage and compute exact residuals; it
  may not train, fit, store, promote or mutate a model. Missing, stale,
  incompatible or insufficient evidence is `UNAVAILABLE`/`null`, never a
  fabricated probability or confidence.

## Owner and hard external boundary

Foundation remains execution and reconciliation owner; L03 owns rate and
ambiguity; L04 owns static filters/sizing; L05 owns private truth; L06 owns
mutation/outcome identity and injected recovery evidence. The L07 twin is a
synthetic venue-oracle adapter and emits no canonical fill, position,
reconciliation verdict, supervisor truth, ticket transition or durable state.

No private/account read, credential access, signer call, signed/test/live
order, send/query/cancel, listen key, socket, Margin action, capital change,
AWS/Cloudflare/Secrets mutation, deployment, restart or push is authorized or
performed. No withdrawal or transfer-out path is permitted.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.
