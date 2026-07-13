# D0013 — L08 deterministic execution-policy law

Status: `ACCEPTED_FOR_LANE_L08`

Date: `2026-07-13`

Authority: pure, deterministic comparison of injected execution-mechanics
candidates for an already-authorized intent only. This decision grants no
strategy, Capital, Risk, ticket, order, execution, reconciliation, persistence,
connector, signer, transport, retry or external-action authority.

## Controlling inputs

- Accepted task: `live-edge-receipts/TASKS/L08.md`
- Accepted L07 receipt: `live-edge-receipts/RECEIPTS/L07.md`
- Frozen protocol SHA: `73e1a1ff7daa48df8dac45713fc5f106842edafc`
- `ARCHITECTURE.md` Part II canonical owner map
- `LIVE_EXECUTION_REALISM_CONTROL_PROOF_12H.md` Section 16
- Accepted L02–L07 owner seams and limitations

Current public documentation was rechecked on `2026-07-13`. The pinned
official Binance Spot documentation commit
`31643ed390e2aa450ce872981556186acf96a195` matched the upstream `master` tip
at verification time. No Binance endpoint, account, credential, signed
operation, listen key, socket, deployment or process was called.

## Current primary sources

### Binance Spot

- New-order, cancel and cancel-replace behavior:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/rest-api.md`
- Order types, TIF and order/symbol status:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/enums.md`
- Exact symbol/exchange filter constraints:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/filters.md`
- Commission calculation and fee-asset distinctions:
  `https://github.com/binance/binance-spot-api-docs/blob/31643ed390e2aa450ce872981556186acf96a195/faqs/commission_faq.md`

Spot cancel-replace is one matching-engine operation with explicit
`STOP_ON_FAILURE`/`ALLOW_FAILURE`, separate cancel/new results, partial mixed
response states, filter/order-count prechecks and a documented unfilled-order
count effect even when a replacement is not attempted. L02 did not accept an
atomic cancel-replace contract. L08 therefore rejects atomic cancel-replace
and models only a separate replacement candidate after exact observed cancel
or reconciliation evidence.

### Binance USD-M Futures

- Current new-order and response/TIF/product-mode fields:
  `https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#new-order`
- Current individual cancel contract:
  `https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/trade/rest-api/Cancel-Order`

The current USD-M document exposes additional `GTD`, `priceMatch`, STP,
conditional and hedge-mode fields. Their current existence does not widen the
accepted L02/L04 subset. L08's closed schema recognizes only L04-proved
`LIMIT`/`MARKET` types and applicable `GTC`/`IOC`/`FOK`; only a bounded
L04-ready `LIMIT` candidate can become a plan. `GTD`, price-match, STP and
conditional orders remain unavailable in this phase.

Accepted L04 deliberately records Spot execution rules and Spot TIF as
unavailable because Runtime symbol metadata does not prove them. L08 therefore
cannot plan a Spot `LIMIT/GTC|IOC|FOK` candidate from the accepted owner seam.
It retains the product in the closed schema but fails it closed. The missing
owner bridge is recorded as a director-owned patch request; L08 does not infer
Spot capability from the USD-M or documentary contract path.

Although current venue contracts expose `MARKET`, a venue market order cannot
mechanically enforce L08's exact side-correct price bound. L08 therefore names
`PRICE_BOUND_EXCEEDED` for every market candidate instead of treating an
estimated notional or current book as a send-time bound. Aggressive mechanics
remain expressible through exact L04-proved bounded `LIMIT/IOC|FOK` terms.

### Exact tail-risk method

- Rockafellar and Uryasev, *Optimization of Conditional Value-at-Risk*:
  `https://sites.math.washington.edu/~rtr/papers/rtr179-CVaR1.pdf`

The paper defines CVaR as the conditional expectation in the loss tail above
the selected VaR threshold. L08 adopts only the risk-measure concept. For its
bounded injected discrete PPM distributions, it calculates the exact worst
tail mass, including a partial probability atom at the VaR boundary, using
integer/exact-decimal arithmetic. It introduces no optimizer, stochastic
sampler or model.

### Deterministic execution references

- NautilusTrader `v1.230.0` Beta release:
  `https://github.com/nautechsystems/nautilus_trader/releases/tag/v1.230.0`
- Deterministic backtest, fill/latency and consumed-liquidity concepts:
  `https://nautilustrader.io/docs/latest/concepts/backtesting/`
- Order/emulation separation:
  `https://nautilustrader.io/docs/latest/concepts/orders/`
  and `https://nautilustrader.io/docs/latest/concepts/orders/emulated/`

These are reference-only. L08 imports no framework runtime, execution
algorithm, order emulator, cache, OMS, connector or probabilistic fill model.

## Capability fit

| Candidate | Capability | Classification | Decision |
| --- | --- | --- | --- |
| Existing Capital exact-decimal value object | signed/non-negative decimal arithmetic | `ADOPT` | Import the narrow pure contract leaf; create no numeric owner. |
| Existing L02/L04/L06/L07 seams | product/TIF/filter, mutation ambiguity and injected exchange evidence | `ADOPT` | Bind exact revisions/closed values without reimplementing their owners. |
| Rockafellar-Uryasev CVaR | conservative tail-risk definition | `ADOPT_CONCEPT` | Implement one bounded exact discrete PPM calculation with partial boundary mass. |
| NautilusTrader v1.230.0 Beta | deterministic replay, execution algorithms and order-emulation concepts | `REFERENCE_ONLY` | Use as independent design input; import no runtime or state. |
| Spot atomic cancel-replace | combined cancel/new matching-engine action | `REJECT_UNACCEPTED_CONTRACT` | L02 has no accepted contract; require separate confirmed cancel then distinct replacement identity. |
| USD-M GTD/priceMatch/STP/conditionals | wider current venue feature set | `REJECT_OUTSIDE_L04_SUBSET` | Do not widen accepted static request truth in L08. |

## Policy law

- L08 receives an already-authorized intent plus exact Capital/Risk limits and
  owner revisions. It cannot approve, reserve, enlarge, renew, revoke or
  reinterpret them.
- Mandate, Capital reservation, Foundation Risk and Operator Approval retain
  four distinct exact constraint envelopes bound to their exact owner
  revisions. Every price, quantity, notional, naked-exposure, duration,
  recovery, scenario-loss, CVaR and completion gate must pass every envelope;
  L08 never collapses them into a caller-widenable local limit.
- Candidate distributions are injected calibrated evidence. L08 validates
  exact probability mass, freshness, identity, dimensions and sample posture;
  it never predicts or fabricates fill probability.
- Every scenario retains filled quantity by leg, signed fee/rebate and separate
  non-negative adverse-selection, opportunity-decay, cancel/race, unhedged and
  recovery costs. Missing axes are unavailable, not zero.
- Exact expected values and CVaR are reproduced from the scenario set. Ranking
  uses one declared conservative objective; hard price, quantity, notional,
  Capital, Risk, naked-exposure, duration, recovery and tail limits apply
  before ranking and cannot be traded off.
- Passive/aggressive posture is an output rationale, never a fixed preference.
  A lower headline maker fee cannot defeat wait, decay, adverse, ambiguity or
  recovery tail evidence.
- Ordered second-leg policy depends on actual first-leg fill evidence. Requested
  quantity and ACK are never fill evidence. Concurrent policy retains explicit
  per-leg partial/ambiguity and recovery transitions.
- Ordered actions carry an exact `ACTUAL_FILL_OF_LEG` quantity source and a
  maximum authorized cap. Recovery actions require exact current-position and
  recovery-evidence revisions plus `RISK_REDUCING_ONLY`; cancel/replacement
  graphs are same-leg, single-use and deadline-monotonic.
- Model, calibration, exchange-twin, book, cost, current-state and recovery
  dependency revisions retain their kind binding. The calibration owner
  supplies the minimum required sample count; L08 only enforces below/equality.
- Every distribution retains exact fill latency in milliseconds. The objective
  ranks maximum then expected latency after CVaR, maximum loss, expected loss
  and recovery cost, before naked duration, fill and completion.
- Timeout, disconnect, 5xx and cancel ambiguity require reconciliation. They
  never authorize blind retry, duplicate placement or a hidden replacement.
- Equivalent candidate sets are order-independent. IDs and revisions are exact
  content commitments, outputs are deeply frozen and all structures are
  bounded.

## Owner and hard external boundary

Existing Basis/Volume engines remain strategy owner; Capital owns allocation
and reservations; Foundation owns Risk, execution and reconciliation; Ledger
owns durability; L03 owns request/rate ambiguity; L04 owns filters/sizing; L06
owns mutation identity; L07 owns synthetic exchange behavior. L08 compares
mechanics only and emits no canonical plan/ticket/order/fill/position/liability
or supervisor truth.

No private/account read, credential access, signer call, signed/test/live
order, send/query/cancel, listen key, socket, Margin action, capital change,
AWS/Cloudflare/Secrets mutation, deployment, restart or push is authorized or
performed. No withdrawal or transfer-out path is permitted.
`LIVE_EXECUTION_NOT_IMPLEMENTED` remains mechanically enforced.
