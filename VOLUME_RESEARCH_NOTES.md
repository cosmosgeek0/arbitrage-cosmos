# VOLUME_RESEARCH_NOTES.md — Binance data surface for wakeup detection

Date: 2026-07-08. Sources: developers.binance.com spot WS-streams + REST market-data docs
(fetched today), plus operational limits from prior integration knowledge — items marked
**[verify-at-wiring]** must be re-checked against live docs before any network code ships.
Everything below is design input only; the volume engine consumes these shapes through
fixture-fed adapter interfaces (`server/src/engine/volume/adapters.ts`). No live wiring in this pass.

## 1. Streams that matter for wakeup detection

| Stream | Name pattern | Rate | Use in this engine |
|---|---|---|---|
| Aggregate trade | `<symbol>@aggTrade` | real-time | Primary tape input. Fields: `p` price, `q` base qty, `T` trade time, `m` buyer-is-maker (true ⇒ taker SOLD), `f`/`l` first/last tradeId (l−f+1 = prints aggregated). Binance aggregates same-price/side fills within ~100ms, so it is cheaper than `@trade` while preserving burst structure. |
| Trade | `<symbol>@trade` | real-time | Higher message rate than aggTrade; only needed if per-print wash forensics prove insufficient on aggTrade. Not planned for v1. |
| Mini ticker ALL | `!miniTicker@arr` | 1000ms | **Universe-tier heartbeat in ONE stream**: every symbol that ticked in the last second, with close `c`, open `o`, high `h`, low `l`, 24h base vol `v`, 24h quote vol `q`. This is how thousands of symbols get lightweight monitoring without thousands of subscriptions. |
| Book ticker | `<symbol>@bookTicker` | real-time | Best bid/ask + top qty (`b`,`B`,`a`,`A`) → spread bps + top-of-book depth USD. Spot has **no** all-symbols bookTicker array stream anymore **[verify-at-wiring]** → subscribe per candidate/focus symbol only. |
| Partial depth | `<symbol>@depth5/10/20@100ms` | 100ms or 1000ms | Focus-tier only: depth quality, depth-vanishing detection. 20 levels @100ms per focused symbol. |
| Kline | `<symbol>@kline_1m` | ~1-2s | Optional live baseline maintenance; v1 builds baselines from the engine's own 1m rollups instead. |
| Rolling window | `<symbol>@ticker_1h` | 1000ms | Possible cheap 1h context; not required (we build our own 1h window). |

## 2. Connection / rate budget

- Combined streams: `wss://stream.binance.com:9443/stream?streams=a/b/c`. Up to **1024 streams per connection**, control messages (SUB/UNSUB) limited to **5 msg/sec**, connections dropped at **24h**; server pings every ~20s, pong within ~1min **[verify-at-wiring — the current doc page did not restate these limits]**.
- REST weights (fetched today): klines = 2, 24h ticker all-symbols = 80, aggTrades = 4, depth ≤100 levels = 5. IP budget ~6000 weight/min **[verify-at-wiring]**.
- Baseline backfill plan: `GET /api/v3/klines?interval=1m&limit=240` = weight 2/symbol. Full 3000-symbol backfill ≈ 6000 weight → stagger over ≥2 min or backfill lazily on first candidacy; universe eligibility from one 24h-ticker call (weight 80).

## 3. Tier budget (fits easily in one connection)

- Universe (~3000 syms): `!miniTicker@arr` → 1 stream total. 1s cadence is enough to notice "a dead symbol printed volume" and promote it.
- Candidate (≤~100 syms): + `@aggTrade` + `@bookTicker` → 2 streams each.
- Focus (hard cap 25): + `@depth20@100ms` → 1 more each.
- Worst case ≈ 1 + 200 + 25 = ~226 streams « 1024. SUB/UNSUB churn must respect the 5 msg/sec control limit → batch (un)subscribes; the focus manager's cooldown/TTL already dampens churn.

## 4. Consequences baked into the engine design

1. **1s buckets are the finest honest granularity** for universe tier (miniTicker cadence); aggTrade gives sub-second granularity only for candidate/focus symbols. The rolling engine therefore keeps a 60×1s fine ring + 240×1m coarse ring per symbol; raw trades kept only in a short bounded window (wash/one-print forensics), per ENGINE.md "keep raw event window briefly".
2. **Baselines must be robust**: median + MAD over per-minute quote volume/trade count (a single spike minute must not poison "normal"). Dead symbols have ~0 median → baseline floor (config) keeps multiples finite and explainable.
3. **`m` (buyer-is-maker) is the only taker-direction signal** on public streams → taker-buy ratio derived from aggTrade only; when a symbol has no aggTrade subscription yet (universe tier), taker imbalance is `null` ⇒ detector must treat that as `taker_imbalance_missing`, never guess.
4. **aggTrade `f`/`l` span** exposes how many raw prints an aggregate contains — used by the one-print detector (a single huge aggregate with tiny print span is the classic fake wakeup).
5. Depth data arrives only after focus promotion → depth checks must degrade gracefully (bookTicker-only depth score) instead of blocking candidacy.
