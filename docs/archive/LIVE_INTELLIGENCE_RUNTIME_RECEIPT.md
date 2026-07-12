# Live Intelligence Runtime Max-Power Sprint Receipt

## Checkout and corrected start gate

- Working checkout: `/Users/cosmosgeek/Desktop/Main`
- Feature branch: `live-intelligence-runtime-main-20260711`
- Verified starting/current-main SHA:
  `c4ae7a9aee51050da2076bf4a454988b1d372bc4`
- The directive's older expected Market Intelligence tip was
  `3340f75270049de96846d153672b91f065844eef`; it is a verified ancestor of the
  actual base.
- Merged Backend Foundation tip
  `20eba6e759127c28167e1de4d79c8c9342812ddd` is also a verified ancestor of the
  actual base.
- No branch was created, no merge/rebase/reset/clean was performed, and nothing
  was pushed.
- The defunct Foundation clone was ignored. `server/src/foundation/**` and
  `server/src/intelligenceFoundation/**` were imported read-only and not edited.

## Preserved root inputs

The five untracked owner inputs remained untracked and byte-identical from the
recorded baseline:

| File | SHA-256 |
| --- | --- |
| `ENGINE_SPRINT_5H.md` | `5749b585b5f0f19fff964bc191df802c1461a6ae9614fc1547c8c8a668a403a0` |
| `LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md` | `4ae6fcab355a4ac6e75c1fe04275ad59ca27498e68c642519a293265ab76d0bb` |
| `MARKET_INTELLIGENCE_MAX_POWER_SPRINT.md` | `8b57083ae0ad5646ba47f89c043a0aa822478b68c4599c637527f35ea236c653` |
| `PARALLEL_BACKEND_MAX_POWER_SPRINT.md` | `7c302981955dc883ee55848147ec9515a3005a02c63eacf6acdc95106ea1bac6` |
| `What-i-want.txt` | `2be43babcad82690096365c58a806dad0978921ef0f441bc38e0c06153de7b23` |

## Recorded baseline

Before runtime edits:

- `npm test`: **PASS, 377/377-equivalent**.
- Intelligence Foundation: **152/152**.
- Required merged Foundation subset: **871/871** — contracts 304, USD-M
  boundary 310, reconciliation 98, compatibility 159.
- Full Foundation corpus: **2,860/2,860** across 24 scripts/fixture modules.

## Current official research

Primary Binance sources were checked on **2026-07-11** before network semantics
were implemented:

- [Spot WebSocket streams](https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md)
- [Spot REST market data](https://developers.binance.com/en/docs/products/spot/rest-api)
- [USD-M 2026 WebSocket migration notice](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/Important-WebSocket-Change-Notice)
- [USD-M public WebSocket streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/public)
- [USD-M market WebSocket streams](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/ws-streams/market)
- [USD-M REST market data](https://developers.binance.com/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/market-data)
- [USD-M local order-book procedure](https://developers.binance.com/en/docs/products/derivatives-trading-usds-futures/websocket-market-streams/How-to-manage-a-local-order-book-correctly)
- [Margin max-borrow semantics](https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/borrow-repay#query-max-borrow)
- [Margin interest-history semantics](https://developers.binance.com/en/docs/catalog/core-trading-margin-trading/api/rest-api/borrow-repay#get-interest-history)

Material finding: legacy USD-M WebSocket URLs were permanently decommissioned
on 2026-04-23. Runtime descriptors use the current tiered `/public` and
`/market` hosts. Current API-key-required top-trader context is represented as
unavailable and is never requested by the no-key runtime.

## Capability inventory and reuse decisions

| Capability | Existing owner/evidence | Runtime decision |
| --- | --- | --- |
| Spot/USD-M exchange info | Existing REST projection | Inject raw public responses because the existing projection drops quiet/inactive/raw rule and response-budget truth. |
| Spot all-market mini ticker | MarketEngine/BinanceStream | Adapt existing raw delivery; no production socket. |
| Spot book/trades | Existing REST, VolumeRuntime, BookStreamHub | Reuse through injected payload/delivery ports. |
| USD-M all-book | Existing REST only | Add current tiered protocol adapter; transport remains injected/manual-smoke only. |
| Mark/funding and liquidation | Existing current tiered MarketEngine owners | Adapt with exact USD-M and sampled-source semantics. |
| Spot depth | Existing depth20 UI feed is not sequence-complete | Add reducer for injected official snapshot+diff events; do not replace UI owner. |
| Futures depth/trades | No authoritative current production owner found | Add focus/resource and reducer seams; no application socket wiring. |
| Kline history | Existing ambient-clock/cache helpers | Add injected completed-only, weight-aware, resumable scheduler. |
| OI/history/taker/global ratio | Existing direct REST helpers | Add injected TTL/receipt/header/budget truth. |
| Top-trader ratio | Existing telemetry attempts it | Do not copy; current docs mark it API-key-required. |
| Basis/Volume hints | Existing strategy runtimes | Consume only future read-only injected hint ports. |
| Borrow/maxBorrow/interest | Existing signed account/loan owners | Out of scope; BORROW evidence is rejected. |
| Capture/read model | No equivalent public runtime owner | Add injected-storage capture and pure snapshot only. |

## Checkpoint commits

| SHA | Checkpoint |
| --- | --- |
| `bcd4373d4e998e2b511eb433e8a170dd2adebe8f` | Freeze source lifecycle contracts. |
| `c40c7b986129fcceb4e1e88c177b0d7a248b51d4` | Add bounded broad market sources. |
| `223f9c6a11fa4265b6ccde9f42ae35e0997093fc` | Harden public source truth. |
| `ecfd06b390e39bee9d831d8f418af2150855f4db` | Bridge public evidence into intelligence. |
| `b5088e98c3562e2b673bbbe324b461f89cf0a21d` | Add focused market enrichment. |
| `772b6629a240ab74db6b337663087fec1c7ac09d` | Compose snapshot and capture runtime. |
| `f4ba5f9ce9ae591dfc719de30522f10bb8f31962` | Add explicit public smoke harness. |
| `5c6259de5f86d210f2f5366e97976abbf75dcf6c` | Adapt current public universe schemas. |
| `b5f45947f097a06c79581c55f68a77fef897a8cd` | Accept current UTF-8 market symbols. |
| `4cd6e9575e54c804095fe74c760e5d131f613261` | Harden bounded runtime truth. |
| `6233aece19aaf342c83caa9519e4f2ee0b5e05d5` | Prove bounded capacity model. |

The code-complete SHA before the two receipt files is
`6233aece19aaf342c83caa9519e4f2ee0b5e05d5`. The receipt commit cannot
self-reference; its full SHA is reported in the final handoff.

## Lanes built

Completed lanes: contracts, lifecycle/backpressure/rate budget, public universe,
broad Spot, broad USD-M Futures, bridge, focus allocator, local books, historical
baseline, derivatives context, runtime snapshot/topology, capture coordinator,
manual no-key smoke, deterministic capacity model, fixtures, and the 18-scenario
compatibility harness.

Bounded lead subagents were used for exclusive lane construction, adversarial
review, tests, smoke semantics, capacity, and manifest inventory. Only the lead
staged and committed.

Deliberately skipped: production routes/startup, UI, package/config changes,
private account sources, signed endpoints, proposals, risk verdicts, execution,
orders, borrow/repay/transfer/withdrawal, direct production persistence, and a
second Control Plane/replay/ledger.

## Exact authored file inventory

```text
server/src/intelligenceRuntime/baseline/candles.ts
server/src/intelligenceRuntime/baseline/config.ts
server/src/intelligenceRuntime/baseline/index.ts
server/src/intelligenceRuntime/baseline/scheduler.ts
server/src/intelligenceRuntime/baseline/types.ts
server/src/intelligenceRuntime/books/index.ts
server/src/intelligenceRuntime/books/localBook.ts
server/src/intelligenceRuntime/books/metrics.ts
server/src/intelligenceRuntime/books/types.ts
server/src/intelligenceRuntime/bridge/boundedIndex.ts
server/src/intelligenceRuntime/bridge/bridge.ts
server/src/intelligenceRuntime/bridge/index.ts
server/src/intelligenceRuntime/bridge/projection.ts
server/src/intelligenceRuntime/bridge/types.ts
server/src/intelligenceRuntime/capacity/index.ts
server/src/intelligenceRuntime/capacity/memory.ts
server/src/intelligenceRuntime/capacity/statistics.ts
server/src/intelligenceRuntime/capacity/types.ts
server/src/intelligenceRuntime/capacity/workload.ts
server/src/intelligenceRuntime/capture/checksum.ts
server/src/intelligenceRuntime/capture/config.ts
server/src/intelligenceRuntime/capture/coordinator.ts
server/src/intelligenceRuntime/capture/index.ts
server/src/intelligenceRuntime/capture/types.ts
server/src/intelligenceRuntime/contracts/boundedJson.ts
server/src/intelligenceRuntime/contracts/index.ts
server/src/intelligenceRuntime/contracts/sourceCatalog.ts
server/src/intelligenceRuntime/contracts/sourceLifecycle.ts
server/src/intelligenceRuntime/contracts/types.ts
server/src/intelligenceRuntime/derivatives/enricher.ts
server/src/intelligenceRuntime/derivatives/index.ts
server/src/intelligenceRuntime/derivatives/parsers.ts
server/src/intelligenceRuntime/derivatives/sources.ts
server/src/intelligenceRuntime/derivatives/types.ts
server/src/intelligenceRuntime/focus/allocator.ts
server/src/intelligenceRuntime/focus/catalog.ts
server/src/intelligenceRuntime/focus/config.ts
server/src/intelligenceRuntime/focus/index.ts
server/src/intelligenceRuntime/focus/types.ts
server/src/intelligenceRuntime/futures/adapter.ts
server/src/intelligenceRuntime/futures/decode.ts
server/src/intelligenceRuntime/futures/index.ts
server/src/intelligenceRuntime/futures/types.ts
server/src/intelligenceRuntime/lifecycle/backoff.ts
server/src/intelligenceRuntime/lifecycle/configValidation.ts
server/src/intelligenceRuntime/lifecycle/index.ts
server/src/intelligenceRuntime/lifecycle/lagMetrics.ts
server/src/intelligenceRuntime/lifecycle/queue.ts
server/src/intelligenceRuntime/lifecycle/rateBudget.ts
server/src/intelligenceRuntime/lifecycle/throttle.ts
server/src/intelligenceRuntime/lifecycle/websocketRunner.ts
server/src/intelligenceRuntime/smoke/config.ts
server/src/intelligenceRuntime/smoke/harness.ts
server/src/intelligenceRuntime/smoke/index.ts
server/src/intelligenceRuntime/smoke/manual.ts
server/src/intelligenceRuntime/smoke/nodeTransport.ts
server/src/intelligenceRuntime/smoke/types.ts
server/src/intelligenceRuntime/snapshot/aggregate.ts
server/src/intelligenceRuntime/snapshot/index.ts
server/src/intelligenceRuntime/snapshot/topology.ts
server/src/intelligenceRuntime/snapshot/types.ts
server/src/intelligenceRuntime/spot/backpressure.ts
server/src/intelligenceRuntime/spot/index.ts
server/src/intelligenceRuntime/spot/reducer.ts
server/src/intelligenceRuntime/spot/types.ts
server/src/intelligenceRuntime/universe/adapter.ts
server/src/intelligenceRuntime/universe/index.ts
server/src/intelligenceRuntime/universe/parsers.ts
server/src/intelligenceRuntime/universe/shardedGraph.ts
server/src/intelligenceRuntime/universe/truth.ts
server/src/intelligenceRuntime/universe/types.ts
server/test/intelligenceRuntime/baseline/baseline.test.mjs
server/test/intelligenceRuntime/baseline/import-purity.test.mjs
server/test/intelligenceRuntime/books/books.test.mjs
server/test/intelligenceRuntime/books/import-purity.test.mjs
server/test/intelligenceRuntime/bridge/bridge.test.mjs
server/test/intelligenceRuntime/bridge/import-purity.test.mjs
server/test/intelligenceRuntime/capacity/capacity.test.mjs
server/test/intelligenceRuntime/capacity/import-purity.test.mjs
server/test/intelligenceRuntime/capture/capture.test.mjs
server/test/intelligenceRuntime/capture/import-purity.test.mjs
server/test/intelligenceRuntime/contracts/contracts.test.mjs
server/test/intelligenceRuntime/contracts/import-purity.test.mjs
server/test/intelligenceRuntime/derivatives/derivatives.test.mjs
server/test/intelligenceRuntime/derivatives/import-purity.test.mjs
server/test/intelligenceRuntime/fixtures/binance-public-fixtures.mjs
server/test/intelligenceRuntime/focus/focus.test.mjs
server/test/intelligenceRuntime/focus/import-purity.test.mjs
server/test/intelligenceRuntime/futures/futures.test.mjs
server/test/intelligenceRuntime/futures/import-purity.test.mjs
server/test/intelligenceRuntime/integration/import-purity.test.mjs
server/test/intelligenceRuntime/integration/runtime-compatibility.test.mjs
server/test/intelligenceRuntime/lifecycle/import-purity.test.mjs
server/test/intelligenceRuntime/lifecycle/lifecycle.test.mjs
server/test/intelligenceRuntime/smoke/import-purity.test.mjs
server/test/intelligenceRuntime/smoke/smoke.test.mjs
server/test/intelligenceRuntime/snapshot/import-purity.test.mjs
server/test/intelligenceRuntime/snapshot/snapshot.test.mjs
server/test/intelligenceRuntime/spot/import-purity.test.mjs
server/test/intelligenceRuntime/spot/spot.test.mjs
server/test/intelligenceRuntime/universe/import-purity.test.mjs
server/test/intelligenceRuntime/universe/universe.test.mjs
LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md
LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md
```

## Deterministic verification

All deterministic runtime tests use injected/fixed clocks and fake ports. They
use no public network, credential, environment secret, production database, or
hidden random ID.

| Lane | Tests |
| --- | ---: |
| Contracts | 19 |
| Lifecycle | 33 |
| Universe | 31 |
| Spot | 38 |
| Futures | 34 |
| Bridge | 23 |
| Focus | 23 |
| Books | 35 |
| Baseline | 32 |
| Derivatives | 32 |
| Snapshot | 25 |
| Capture | 21 |
| Smoke | 12 |
| Capacity | 17 |
| Integration | 19 |
| **Total** | **394/394** |

Final acceptance:

- `npm test`: **PASS, 377/377-equivalent** — Basis 107, Volume 124,
  financial safety 59, storage/config/AWS 29, Node suites 50, stream lifecycle
  7, perimeter 1.
- `npm run test:integration`: **PASS, 72/72 app gates**.
- Runtime corpus: **394/394**.
- Intelligence Foundation: **152/152**.
- Required Foundation subset: **871/871**.
- Full Foundation corpus: **2,860/2,860 across 24 scripts/fixture modules**.
- Build/typecheck: server and web **PASS**. The existing 607.01 kB Vite chunk
  warning is unchanged.
- `git diff --check`: **PASS**.
- Import purity: one import-purity test per runtime lane, all **PASS**.

The integration harness proves all 18 directive scenarios: advancing sources,
quiet symbol retention, persistent Spot wakeup, isolated-print rejection,
Spot/Futures lead asymmetry, derivative-led context, market-relative behavior,
silent/stale sources, duplicate/out-of-order handling, depth gap/resync, focus
replacement, protected retention, rate-limit isolation, partial baseline,
future-free capture, complete shutdown, and inert imports.

## Manual public no-key smoke

Command:

```bash
node server/dist/intelligenceRuntime/smoke/manual.js --duration-ms 15000 --symbol BTCUSDT
```

Result on 2026-07-11: **PARTIAL**, with **0 blockers**, **3 conservative
warnings**, and all required public sources fresh.

- Spot exchange info: PASS.
- USD-M exchange info: PASS.
- Universe: COMPLETE, 3,848 nodes; BTCUSDT present.
- Spot broad: 15/15 semantically accepted.
- USD-M all-book: 1,113/1,336 accepted; 223 valid out-of-scope current merged
  records ignored; zero dropped.
- USD-M mark/funding: 14/28 accepted; 14 valid out-of-scope/inactive records
  ignored; zero dropped.
- Temporary BTCUSDT focus: PASS without a proposal.
- Focus traffic: 208 aggregate trades and 143 depth messages observed.
- Foundation-normalized evidence: 17,881 records.
- Shutdown: 4/4 created transports opened, received close requests, and emitted
  close; no dirty shutdown.
- Credentials used: false. Private endpoints used: false. Money authority:
  `NONE`.

The three warnings are expected finite-window truth:
`SOURCE_EVIDENCE_PARTIAL` for changed-only Spot mini-ticker coverage,
`SPOT_COVERAGE_PARTIAL`, and `FUTURES_COVERAGE_PARTIAL`. No source was blocked,
stale, unavailable, or ended before shutdown. The aggregate outcome remains
PARTIAL because conservative full-universe coverage is not fabricated from a
15-second sample.

## Safety, scope, and bounds proof

- Code before receipts changed exactly 102 files: 71 under
  `server/src/intelligenceRuntime/**` and 31 under
  `server/test/intelligenceRuntime/**`; no other path changed.
- The two root artifacts are the only allowed non-runtime authored files.
- Protected-tree diff is empty for `web/**`, `server/src/foundation/**`,
  `server/src/intelligenceFoundation/**`, services, Binance owners, engines,
  routes/startup, ledger, package files, lockfile, config, and data.
- Static import scan found no runtime production import from existing
  foundation/services/binance/engine/ledger owners other than the explicitly
  allowed read-only `intelligenceFoundation` contracts.
- Static scan found no `process.env`, filesystem/database/AWS dependency, or
  private/money-action URL literal under runtime production code.
- Concrete network/timers exist only in `smoke/nodeTransport.ts`, the explicit
  manually invoked public proof. Other `fetch` matches are injected port method
  names.
- Public authority is exact and allowlisted. Capture rejects BORROW, account,
  private, spoofed authority, and checkpoint-restored authority drift.
- Every queue, ring, map, cache, failure set, snapshot list, checkpoint, header
  envelope, response body, and retained graph has count/byte/depth limits.
- Source/receipt/completion/processing/snapshot times remain distinct;
  no-look-ahead and rollback tests pass.
- Runtime outputs explicitly expose `liveMoneyAuthority: NONE`,
  `createsProposal: false`, and `executesAction: false` where applicable.

## Future integration seams

1. Current source owners expose raw public payload/delivery adapters into the
   runtime ports; convergence must not add duplicate production sockets.
2. `ProtectedSymbolPort` and read-only Basis/Volume hint ports are supplied by
   their existing owners.
3. Focus commands are sent by a future audited lifecycle owner; the allocator
   itself never sends.
4. Local books receive an audited public snapshot port; reducers never fetch.
5. `BaselineSink` remains the explicit seam until Foundation adopts a completed
   historical-candle seed contract.
6. Derivatives facts receive a selected evidence mapping only where frozen
   Foundation contracts can represent them without loss.
7. Capture storage and baseline checkpoint ports receive audited durable
   adapters; current code performs no direct disk/DB write.
8. Runtime snapshot is ready for later Control Plane/Health/Dashboard reads but
   is not registered in application startup.

## Honest remaining gaps

- No production composition/startup/route/UI is wired in this sprint.
- Futures aggregate-trade/depth transport still needs an approved current source
  owner during convergence.
- Baseline-to-FeatureBank historical seeding remains a named contract seam.
- API-key-required top-trader context remains unavailable by design.
- Liquidation coverage remains a sampled lower bound.
- Capacity results are deterministic local-model evidence, not a production
  throughput claim.
- The manual smoke's finite observation window cannot claim complete
  all-universe changed-only coverage.

## Handoff state before receipt commit

- Branch: `live-intelligence-runtime-main-20260711`
- Code-complete SHA: `6233aece19aaf342c83caa9519e4f2ee0b5e05d5`
- Working tree: clean except the five preserved untracked root inputs and these
  two allowed receipt files.
- Merge/push status: not merged, not pushed.
