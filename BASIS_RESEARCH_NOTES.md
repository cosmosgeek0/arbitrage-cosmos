# BASIS_RESEARCH_NOTES.md — Binance data surface for the basis engine

Written 2026-07-08 by the BASIS overdrive agent. Sources: developers.binance.com (spot
WS market streams, USD-M futures WS market streams, margin borrow-and-repay docs),
fetched today. Items marked **[verify-at-wiring]** were not fully renderable in docs
today and must be re-checked before any live adapter is written. **No live wiring
exists in this pass — every adapter in `server/src/engine/basis/` is an interface fed
by fixtures/synthetic ticks.**

## 1. Spot market data (wss://stream.binance.com:9443)

| Need | Stream | Speed | Fields we consume |
|---|---|---|---|
| Executable spot bid/ask | `{symbol}@bookTicker` | real-time | `u` updateId, `s`, `b`/`B` best bid px/qty, `a`/`A` best ask px/qty (no event time — stamp on receive) |
| Depth at intended size | `{symbol}@depth5@100ms` (also 10/20 levels, 1000ms) | 100ms/1000ms | `lastUpdateId`, `bids[]`, `asks[]` (px, qty ladders) |
| Trade flow (secondary for basis) | `{symbol}@aggTrade` | real-time | `p`, `q`, `T`, `m` (buyer-is-maker) |
| Cheap universe heartbeat | `{symbol}@miniTicker` / `!miniTicker@arr` | 1000ms | `c`,`o`,`h`,`l`,`v`,`q` |

- Combined streams: connect `wss://stream.binance.com:9443/stream`, then `SUBSCRIBE`
  with `params: ["btcusdt@bookTicker", ...]`. Spot bookTicker has **no `E` event time**
  → the adapter must stamp local receive time; staleness for spot books is
  receive-time-based. **[verify-at-wiring]** current per-connection stream cap
  (historically 1024 streams, 5 inbound control msgs/sec, 24h connection lifetime).

## 2. USD-M futures market data (wss://fstream.binance.com)

| Need | Stream | Speed | Fields we consume |
|---|---|---|---|
| Executable perp bid/ask | `{symbol}@bookTicker` | real-time | `u`, `E` event time, `T` transaction time, `s`, `b`/`B`, `a`/`A` |
| Mark + funding + next funding | `{symbol}@markPrice` (or `@markPrice@1s`; `!markPrice@arr` for all) | 3s default / 1s | `p` mark, `i` index, `r` funding rate, `T` next funding time **[verify-at-wiring: field letters per current doc render]** |
| Perp depth | `{symbol}@depth5@100ms` | 100/250/500ms | `U`/`u` ids, `b`/`a` ladders |

- Futures bookTicker **does** carry `E`/`T` → perp staleness can use exchange event
  time; spot cannot. The engine therefore tracks per-leg staleness separately and a
  **cross-leg timestamp skew** signal (a "gap" computed from books observed 4s apart
  is fiction).
- Funding history (backtest/flip-risk baseline): `GET /fapi/v1/fundingRate`;
  point-in-time funding also on `GET /fapi/v1/premiumIndex` (mark, lastFundingRate,
  nextFundingTime). **[verify-at-wiring]** request weights.

## 3. Exchange filters (tick/step/minNotional)

- Spot: `GET /api/v3/exchangeInfo` (weight ~20) → `filters[]`: `PRICE_FILTER.tickSize`,
  `LOT_SIZE.stepSize`, `NOTIONAL.minNotional`.
- Futures: `GET /fapi/v1/exchangeInfo` → same concepts, plus `contractType`
  (`PERPETUAL` only for us), `status == TRADING`.
- Consumed as static `SymbolMeta` data (frozen v0 type) — refreshed slowly, never per tick.

## 4. Margin / borrow surface (all SIGNED — unavailable until keys exist)

- Max borrowable: `GET /sapi/v1/margin/maxBorrowable` — **weight 50 (IP)**, params
  `asset`, optional `isolatedSymbol`; returns `amount` (system availability) and
  `borrowLimit` (account level). Weight 50 means: **never poll per tick** — cache per
  asset, refresh on demand when a reverse-basis signal is near actionable.
- Borrow/repay + interest rate: `/sapi/v1/margin/borrow-repay`,
  `/sapi/v1/margin/interestRateHistory`, cross-margin data endpoints for VIP-tier
  hourly rates. **[verify-at-wiring]** exact paths — margin docs were reorganized.
- Consequence baked into the engine: borrow state is an **injectable data model**
  (`BorrowInfo` per asset: status unknown/available/unavailable, maxBorrowable,
  hourlyRatePct, asOfTs). With no keys the provider returns `unknown` → every
  reverse-basis (short-spot/long-perp) signal terminates in a **named reject**
  (`borrow_unknown`), never a proposal. This matches ENGINE.md §11.

## 5. Design consequences adopted in `engine/basis/`

1. **Interfaces over sockets.** `BasisMarketFeed` (spot book, perp book, mark/funding,
   depth, borrow) is a plain ingest API; tests and the replay runner push synthetic
   ticks through the same path live adapters will use later.
2. **Two staleness clocks.** Spot staleness = local receive age; perp staleness can use
   exchange `E`. Both guarded by `staleMs`; plus cross-leg skew guard.
3. **Funding is a first-class cost.** `r` + `T` from markPrice stream → funding carry
   over expected hold, flip risk from recent funding history (injected fixture),
   time-to-funding capture bonus/penalty.
4. **Depth ladders are optional.** bookTicker gives top-of-book qty only; depth5 gives
   ladders for focused symbols. Slippage model works from either (degraded confidence
   without ladders) — mirrors focus-tier economics (§6, §10).
5. **Weight-aware borrow.** maxBorrowable at weight 50 → borrow preflight is
   cached/injected, refreshed only for near-actionable reverse signals.
