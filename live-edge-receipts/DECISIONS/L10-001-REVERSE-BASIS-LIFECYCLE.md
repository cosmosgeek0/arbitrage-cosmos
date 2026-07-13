# L10-001 — reverse-Basis synthetic mechanics and liability boundary

Status: ACCEPTED_FOR_L10_IMPLEMENTATION
Checked: 2026-07-13

## Decision

L10 owns only a narrow deterministic liability/lifecycle overlay. Existing
Basis, Capital, Foundation Risk, L07 exchange twin, L08 execution policy and
future canonical reconciliation owners remain authoritative.

The accepted L07 twin supports `SPOT` and `USD_M_PERPETUAL`, not a Binance
Margin mutation identity. L10 may consume an L07 `SPOT` scenario for the same
Spot instrument only as `SPOT_MARKET_MECHANICS_ONLY` evidence of deterministic
book, fill, latency, ambiguity, cancel and recovery behavior. A separate
injected L10 witness retains the Margin account realm, cross/isolated mode,
isolated symbol, borrow transaction, Margin order identity and liability
revision. The adapter must reject any attempt to treat the L07 Spot mutation
identity as the Margin hand.

Accepted L08 also cannot authorize a Margin product in this tree. Its first
ordered leg is deliberately an `USD_M_PERPETUAL` mechanics witness carrying
the injected Margin realm only so L10 can reuse the accepted ordered/actual-fill
grammar. It is never represented as a Margin-capable L08 plan, never sent, and
never treated as the L07 Margin mutation identity. The L08 input is persisted
with each witness and re-evaluated inside L10 before its decision or plan is
trusted.

This loss is explicit and safe: the shard proves offline lifecycle invariants,
not a signed Margin adapter, canonical exchange fill, or integrated execution
path. Shared support for a real Margin product/venue remains director-owned.

Restart truth retains the full preflight, initial liability, exact pre-repay
liability basis, first/last order event-envelope times, recovery-evidence
occurrence times and one frozen recovery target. A content hash alone is not
acceptance: restore revalidates the owner chain at every mutation boundary,
principal/interest monotonicity, confirmed-principal and paired-fill quantity
bounds, naked/gross limits, staged order causality, exact repay basis,
zero-liability reconciliation and terminal residual-liability law.

## Current official source constraints applied to fixtures

- Binance Margin borrow/repay uses a realm flag, an isolated symbol when
  isolated, and returns a transaction ID.
- Maximum borrowable is current account/system availability, distinct from the
  account borrow limit, and is transient evidence.
- Cross and isolated account records expose borrowed principal, interest and
  collateral/margin posture; isolated records bind the symbol explicitly.
- Margin orders expose explicit `isIsolated`, order identity, executed quantity
  and status. Automatic side-effect modes exist but are outside L10; fixtures
  model separate borrow and repay observations only.
- Borrow and interest records distinguish principal and interest. Liability is
  therefore never inferred from order quantity or fabricated as zero.

Official references checked on 2026-07-13:

- <https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/borrow-repay>
- <https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/account>
- <https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/trade>

## Terminal invariant

`CLOSED` and `RECOVERED` require all of the following at the same evaluated
time: confirmed repay, exact-zero principal/interest/total liability, current
complete closure reconciliation, no open order, no ambiguous mutation, no L07
ordering/local-truth/recovery ambiguity, no unmatched fill, no Margin short,
no Futures long and no hedge drift. Otherwise the lifecycle is fail-closed.
