# Live Intelligence Runtime Component Manifest

This manifest describes the bounded runtime delivered under
`server/src/intelligenceRuntime/**` and its deterministic proofs under
`server/test/intelligenceRuntime/**`. It acquires or accepts public market
truth, grades that truth, and adapts it into the existing
`intelligenceFoundation` contracts. It owns no proposal, risk, execution,
account, ledger, route, UI, or live-money authority.

## Runtime topology identities

| Component | Future Control Plane component ID |
| --- | --- |
| Lifecycle | `runtime-component:0a092a9b0edf658ceb112a70` |
| Universe | `runtime-component:b0ea22b99dfa8c5ec6ddb1ee` |
| Broad Spot | `runtime-component:ac54e11cb6e8b435c2dfbe7e` |
| Broad USD-M Futures | `runtime-component:74e3bd3defe2c4ae8a1114c4` |
| Intelligence bridge | `runtime-component:91ca60d4bb87900772fa4d0f` |
| Focus allocator | `runtime-component:673665e308205c824ff07135` |
| Local books | `runtime-component:02e7f3da27c29156dac276ec` |
| Historical baseline | `runtime-component:98ed1efe112333f1b4f38e4c` |
| Derivatives context | `runtime-component:c8685474533b8142d47d67a8` |
| Runtime snapshot | `runtime-component:8ed91473d866fac46c39d828` |
| Trigger capture | `runtime-component:b3ba5b1ec041b751ef004124` |

Contracts are a shared kernel. Smoke, capacity, fixtures, and compatibility
proofs are deliberately not managed runtime topology nodes.

## Component records

### Runtime contracts and source catalog

- **Path:** `server/src/intelligenceRuntime/contracts/**`
- **Responsibility:** Runtime-local public transport ports, injected clock and
  jitter contracts, source IDs, endpoint catalog, lifecycle vocabulary, strict
  bounded JSON measurement, and stable source snapshots.
- **Authoritative inputs:** Frozen `intelligenceFoundation` contracts, declared
  public source definitions, and caller-supplied clock values.
- **Outputs:** Stable source IDs, public endpoint descriptors, validated source
  definitions, lifecycle snapshots, and runtime-local port types.
- **Owned state:** `SourceLifecycleTracker` counters, lifecycle timestamps,
  generation, backoff/rate-budget projection, and last bounded error.
- **Non-owned state:** Instrument/evidence authority, universe semantics,
  features, attention, outcomes, and Foundation topology.
- **Existing source reused:** Foundation contracts and Binance source facts are
  imported read-only; they are not redefined.
- **Network behavior:** None.
- **Bounds:** Strict JSON is capped at 256 MiB, depth 64, and 1,000,000 nodes;
  source silence/staleness/future-skew/retry values have hard ceilings.
- **Freshness/sequence semantics:** Source, receipt, processing, and snapshot
  times stay distinct; future and regressed knowledge is rejected.
- **Tests:** 19 contract and import-purity tests.
- **Failure modes:** Accessor/cyclic/custom JSON, contradictory definitions,
  future/regressed time, silent/stale source, counter overflow.
- **Future Control Plane component ID:** None; this is a shared schema kernel.
- **Future Health/Dashboard surface:** Contract behind every source-health row.
- **Live money authority:** **NONE**.

### Source lifecycle, queues, backoff, and budgets

- **Path:** `server/src/intelligenceRuntime/lifecycle/**`
- **Responsibility:** Explicit start/stop/tick WebSocket lifecycle, useful-message
  health, rotations, deterministic backoff, bounded queues, control throttling,
  REST weight accounting, and lag percentiles.
- **Authoritative inputs:** Injected public WebSocket transport, clock, jitter,
  decoder, sink, and exact data-only configuration.
- **Outputs:** Source events, queue/control/lag snapshots, retry decisions, and
  rate-budget truth.
- **Owned state:** Active connection and generation, retry/cooldown, bounded
  queue, control window, and bounded lag rings.
- **Non-owned state:** Market payload semantics and downstream evidence.
- **Existing source reused:** Can wrap current authoritative source owners; it
  does not replace `BinanceStream` or add application wiring.
- **Network behavior:** Only through an explicitly constructed injected public
  transport after `start()`; no hidden scheduler or import-time work.
- **Bounds:** Per-entry payload up to 64 MiB plus envelope, aggregate queue up to
  512 MiB, queue capacity 1,000,000, throttle/lag registries 100,000, rotation
  seven days, and bounded retry/cooldown.
- **Freshness/sequence semantics:** Socket-open and useful-message health are
  separate; sequence-sensitive entries never coalesce and overflow requires
  resync; all local reads are no-look-ahead.
- **Tests:** 33 lifecycle and import-purity tests.
- **Failure modes:** Open timeout, silent/stale socket, malformed frame,
  oversize/overflow, resync, send/sink failure, retry ceiling, 418/429 cooldown,
  future/regressed clock, and exact-config rejection.
- **Future Control Plane component ID:** `runtime-component:0a092a9b0edf658ceb112a70`.
- **Future Health/Dashboard surface:** Source age/state, reconnects, queue
  pressure, drops/coalesces, lag, and REST budget.
- **Live money authority:** **NONE**.

### Public universe

- **Path:** `server/src/intelligenceRuntime/universe/**`
- **Responsibility:** Join complete Spot and USD-M exchange information while
  preserving quiet/inactive markets, raw filters, aliases, and deterministic
  listing changes.
- **Authoritative inputs:** Official-shaped exchange-info responses supplied by
  an injected public REST transport and injected clock.
- **Outputs:** Foundation `UniverseGraph`, graph diff, listing metadata/change
  records, coverage/source truth, and render views.
- **Owned state:** Bounded per-source rows, last complete responses, fixed-window
  budgets, last graph/snapshot, and one coalesced in-flight tick.
- **Non-owned state:** Foundation universe rules and downstream focus decisions.
- **Existing source reused:** The existing exchange-info owner was inventoried;
  a raw injected adapter was required because its projection drops quiet,
  inactive, non-USDT, and response-budget evidence.
- **Network behavior:** Injected public REST only on explicit `tick()`.
- **Bounds:** Defaults include 10,000 symbols/source, 24 MiB response, 128
  filters, 64 aliases, and 512 failures/256 KiB; hard symbol cap is 12,000 and
  hard failure cap is 4,096/16 MiB.
- **Freshness/sequence semantics:** Source and receipt times remain distinct;
  future/regressed receipts fail; partial refresh merges without false delists;
  only complete refresh may remove rows.
- **Tests:** 31 universe and import-purity tests.
- **Failure modes:** Partial/empty response, stale retained rows, 418/429,
  malformed identities/filters, listing/status/contract changes, and bounded
  failure truncation.
- **Future Control Plane component ID:** `runtime-component:b0ea22b99dfa8c5ec6ddb1ee`.
- **Future Health/Dashboard surface:** Visible/paired/missing markets, quiet
  symbols, eligibility, source freshness, and listing changes.
- **Live money authority:** **NONE**.

### Broad Spot

- **Path:** `server/src/intelligenceRuntime/spot/**`
- **Responsibility:** Pure broad reducer for changed-only `!miniTicker@arr`,
  book ticker, and aggregate trade observations without relabeling rolling-24h
  values as short-window activity.
- **Authoritative inputs:** Canonical Spot universe and official-shaped raw feed
  messages supplied by existing owners or injected transports.
- **Outputs:** Rolling-24h observations, runtime source events,
  Foundation-normalized book/trade evidence, coverage, metrics, and snapshot.
- **Owned state:** Per-symbol last ticker/book, bounded recent trades, cumulative
  coverage, source trackers, and aggregate-byte-bounded backpressure.
- **Non-owned state:** Strategy scoring, focus decisions, proposals, and orders.
- **Existing source reused:** Adapts current MarketEngine mini-ticker and current
  Volume/BookStream trade/book delivery; no production socket is added.
- **Network behavior:** None.
- **Bounds:** Default 10,000 symbols/frame, 64 trades/symbol, queue 4,096, and
  2 MiB per payload; hard 20,000 symbols, 50,000 records/frame, 256 trades,
  16,384 queue entries, and 16 MiB per/aggregate retained payload.
- **Freshness/sequence semantics:** Old/stopped generations inspect no payload;
  direct frames hash only a bounded prefix with explicit overflow identity;
  aggregate IDs are monotonic and quiet symbols stay visible.
- **Tests:** 38 Spot and import-purity tests.
- **Failure modes:** Unknown/malformed/stale symbol, duplicate/out-of-order,
  old generation, source gap, payload/accessor rejection, count/byte pressure,
  and silent/stale global stream.
- **Future Control Plane component ID:** `runtime-component:ac54e11cb6e8b435c2dfbe7e`.
- **Future Health/Dashboard surface:** Spot coverage, quiet-symbol visibility,
  source ages, accepted/ignored/dropped counts, and queue bytes.
- **Live money authority:** **NONE**.

### Broad USD-M Futures

- **Path:** `server/src/intelligenceRuntime/futures/**`
- **Responsibility:** Decode current tiered-host all-book, mark/funding,
  contract-info, and sampled-liquidation streams and normalize public evidence.
- **Authoritative inputs:** Official-shaped frames, injected clock, and injected
  authoritative USD-M Perpetual instrument resolver.
- **Outputs:** Typed observations/events, normalized book/mark/funding evidence,
  ignored/invalid/drop counters, and runtime snapshot.
- **Owned state:** Per-feed lifecycle, bounded symbol slots, pinned full
  instrument identities, monotonic cursors, liquidation ring/cursors.
- **Non-owned state:** Executable basis, strategy decisions, proposals, risk,
  orders, and account state.
- **Existing source reused:** Adapts current tiered mark/liquidation owners;
  tiered all-book protocol is new because no current production owner existed,
  but transport remains injected/manual-smoke only.
- **Network behavior:** None.
- **Bounds:** Defaults 2,048 symbols/liquidations and 4,096 records/message;
  hard caps 16,384 symbols, liquidations, and records, plus 1,024 brackets.
- **Freshness/sequence semantics:** Numeric `st=1` is USD-M; valid COIN-M,
  delivery, inactive, and settling records are ignored rather than mislabeled;
  `E`, `T`, `u`, `ps`, generation, and receive time remain distinct. Resolver
  identity is pinned and resolver reentrancy cannot mutate lifecycle/state.
- **Tests:** 34 Futures and import-purity tests.
- **Failure modes:** Malformed/crossed payload, identity drift/conflict,
  resolver unavailable/malformed/reentrant, duplicate/out-of-order cursor,
  old generation, capacity pressure, and silent/stale feed.
- **Future Control Plane component ID:** `runtime-component:74e3bd3defe2c4ae8a1114c4`.
- **Future Health/Dashboard surface:** Book/mark/funding/contract coverage,
  ignored-versus-invalid truth, generation, and source age.
- **Live money authority:** **NONE**.

### IntelligenceFoundation bridge

- **Path:** `server/src/intelligenceRuntime/bridge/**`
- **Responsibility:** Narrow public evidence-only composition into existing
  Foundation feature, attention, thesis, forensics, lineage, and freeze-request
  contracts.
- **Authoritative inputs:** Universe graph, normalized public evidence,
  source-quality overrides, protected-symbol port, and read-only Basis/Volume
  candidate hint ports.
- **Outputs:** Ingest receipts, public attention plan, evidence lineage,
  intelligence artifacts, freeze requests, and bridge snapshot.
- **Owned state:** Bounded evidence/correlation/failure indexes, one FeatureBank,
  prior allocations, artifacts, and pending triggers.
- **Non-owned state:** Basis/Volume strategy authority, proposals, risk,
  execution, and outcome attribution.
- **Existing source reused:** Directly invokes frozen Foundation validators,
  FeatureBank, attention, thesis, forensics, and outcome contracts.
- **Network behavior:** None.
- **Bounds:** Defaults include 640 universe nodes/16 MiB graph, 4,096 evidence
  per batch, 2 MiB/evidence, 65,536 indexed evidence, 131,072 lineage entries,
  128 artifacts, and 512 failures.
- **Freshness/sequence semantics:** Future evidence and universe rollback fail;
  source correlation roots remain continuous through each derived artifact.
- **Tests:** 23 bridge and import-purity tests.
- **Failure modes:** Non-public/BORROW authority, malformed/oversized evidence or
  graph, duplicate conflict, stale/missing legs, bounded eviction/truncation,
  and insufficient thesis/forensics input.
- **Future Control Plane component ID:** `runtime-component:91ca60d4bb87900772fa4d0f`.
- **Future Health/Dashboard surface:** Evidence path, requested focus, lineage,
  artifact readiness, and bridge failures.
- **Live money authority:** **NONE**; `createsProposal=false`,
  `executesAction=false`.

### Focus subscription allocator

- **Path:** `server/src/intelligenceRuntime/focus/**`
- **Responsibility:** Deterministically map Foundation attention into existing
  broad delivery, public REST intents, and bounded Spot/USD-M subscription
  commands.
- **Authoritative inputs:** Attention plan, capability catalog, delivered
  evidence, protected-symbol port, connection/ACK/message observations.
- **Outputs:** Subscribe/unsubscribe command batches, fulfillment reasons, and
  allocator snapshot.
- **Owned state:** Bounded connections, stream assignments, pending controls,
  release cooldowns, and plan watermark.
- **Non-owned state:** Transport send, candidate scoring, proposals, and capital.
- **Existing source reused:** Fresh broad evidence is reused before allocation;
  resources map to current Spot delivery and current tiered USD-M routes.
- **Network behavior:** None; commands are outputs only.
- **Bounds:** Defaults 5,000 allocations/capabilities, 50,000 requirements,
  4,096 streams, 1,024 pending controls, and 200 streams/control; hard total
  stream cap 32,768.
- **Freshness/sequence semantics:** ACK/readiness are generation/time bound;
  plan time cannot regress; hysteresis/cooldown prevent churn; protected
  symbols cannot be silently evicted.
- **Tests:** 23 focus and import-purity tests.
- **Failure modes:** Missing capability, unavailable route, stream/connection/
  control pressure, ACK timeout/retry ceiling, private endpoint request, and
  unresolved protected demand.
- **Future Control Plane component ID:** `runtime-component:673665e308205c824ff07135`.
- **Future Health/Dashboard surface:** Requested/delivered/warming/unfulfilled
  evidence, protected rows, connections, and control backlog.
- **Live money authority:** **NONE**.

### Local order books

- **Path:** `server/src/intelligenceRuntime/books/**`
- **Responsibility:** Official snapshot-plus-delta Spot/USD-M local books,
  resync requests, depth/flow metrics, and intended-size slippage.
- **Authoritative inputs:** Normalized public depth snapshots/deltas, injected
  clock, connection generation, and sync token.
- **Outputs:** Apply outcomes, explicit public snapshot/resync requests,
  book/flow evidence, slippage answers, and snapshot.
- **Owned state:** Bids/asks, bounded pre-snapshot buffer, cursor, fingerprints,
  flow ring, counters, and pending resync.
- **Non-owned state:** REST fetch, individual order identity, strategy/risk.
- **Existing source reused:** Current depth20 UI feed was inventoried but is not
  sequence-complete; this reducer consumes injected official diff events and
  does not replace that service.
- **Network behavior:** None; snapshot/resync is an output request.
- **Bounds:** Spot snapshot 5,000, USD-M snapshot 1,000; bounded levels,
  buffered events, fingerprints, flow samples, level updates, bands, and
  metric windows.
- **Freshness/sequence semantics:** Spot bootstrap requires
  `U <= lastUpdateId + 1 <= u`; USD-M requires documented `pu` predecessor;
  future snapshot/slippage reads fail.
- **Tests:** 35 books and import-purity tests.
- **Failure modes:** Missing bridge, sequence gap/predecessor mismatch,
  conflicting cursor reuse, crossed/empty book, stale snapshot, bound pressure,
  old generation, and obsolete sync epoch.
- **Future Control Plane component ID:** `runtime-component:02e7f3da27c29156dac276ec`.
- **Future Health/Dashboard surface:** Live/warming/stale books, gap/resync
  counts, spread, depth, imbalance, flow, and slippage.
- **Live money authority:** **NONE**.

### Historical baseline bootstrap

- **Path:** `server/src/intelligenceRuntime/baseline/**`
- **Responsibility:** Resumable, completed-kline-only, listing-aware bootstrap
  with focus priority, no starvation, weight reservation, and checkpoints.
- **Authoritative inputs:** Plan plus injected clock, public history, weight,
  checkpoint, and idempotent sink ports.
- **Outputs:** Canonical completed candles, sink batches, checkpoint receipts,
  item states, and scheduler snapshot.
- **Owned state:** Stable plan/item IDs, cursors, retries, dispatch/accounting
  totals, focus streak, and checkpoint generation.
- **Non-owned state:** Direct disk, cache, feature mutation, and strategy state.
- **Existing source reused:** Existing kline helpers were inventoried; a new
  scheduler was required for injected time, completed-only truth, returned
  weight, resumability, and exact checkpoints.
- **Network behavior:** Only through injected public history port on `tick()`.
- **Bounds:** Defaults 10,000 plan items, parallelism 4, page 1,000, 1,000
  pages/item, 100,000 records/item, retry ceiling 5; every knob has a hard cap.
- **Freshness/sequence semantics:** Incomplete candles are excluded; receipt
  lies between dispatch and completion; outcome application, retry, freshness,
  render, and checkpoint use monotonic completion knowledge time.
- **Tests:** 32 baseline and import-purity tests.
- **Failure modes:** Insufficient history/listing age, delist/unavailable,
  rate limit, retry exhaustion, partial/gapped pages, bound pressure,
  sink/checkpoint/settlement failure.
- **Future Control Plane component ID:** `runtime-component:98ed1efe112333f1b4f38e4c`.
- **Future Health/Dashboard surface:** Complete/partial/stale/insufficient
  counts, records, retries, and actual REST weight.
- **Live money authority:** **NONE**.

### Derivatives context enrichment

- **Path:** `server/src/intelligenceRuntime/derivatives/**`
- **Responsibility:** TTL-bound public no-key open interest, OI history,
  funding history/info, taker flow, global long/short, and injected sampled
  liquidation context.
- **Authoritative inputs:** Bounded symbol set, injected public REST transport,
  rate budget, clock, and exact current liquidation events.
- **Outputs:** Refresh plan/report, per-kind facts, availability/completeness,
  disagreements, coverage, and snapshot.
- **Owned state:** Bounded kind/symbol cache, next-refresh times, liquidation
  generation, and monotonic clock/observation watermarks.
- **Non-owned state:** API-key-required top-trader facts, account data,
  proposals, and execution.
- **Existing source reused:** Existing OI/telemetry capabilities informed the
  adapter; top-trader calls were not copied because current docs require an API
  key. Existing direct helpers do not expose injected receipt/weight truth.
- **Network behavior:** Injected public REST only on explicit `refresh()`;
  liquidation is injected stream input.
- **Bounds:** Defaults 512 symbols, 500 rows/series, 10,000 funding-info rows,
  4 MiB response; hard 10,000 symbols and 64 MiB response. Headers are strict
  data-only with 64/count and 32 KiB aggregate caps.
- **Freshness/sequence semantics:** Per-kind TTL/source/receive/completion time;
  completion drives evaluation and stale status; zero remains distinct from
  unknown; prior liquidation generation is rejected.
- **Tests:** 32 derivatives and import-purity tests.
- **Failure modes:** Budget denial, 418/429, 401/403/API-key-required,
  malformed/oversized body or headers, TTL expiry, source disagreement, and
  optional-source loss.
- **Future Control Plane component ID:** `runtime-component:c8685474533b8142d47d67a8`.
- **Future Health/Dashboard surface:** Fact coverage, TTL/stale/unavailable
  truth, REST weight, disagreements, and API-key-required gaps.
- **Live money authority:** **NONE**.

### Runtime snapshot and topology adapter

- **Path:** `server/src/intelligenceRuntime/snapshot/**`
- **Responsibility:** Pure read-only aggregation into one bounded Health/
  Dashboard model and typed dependency topology.
- **Authoritative inputs:** Already-captured runtime component snapshots and
  optional immutable Foundation topology.
- **Outputs:** `RuntimeIntelligenceSnapshot`, blockers/warnings, component/source
  views, typed edges, and Foundation bindings.
- **Owned state:** None.
- **Non-owned state:** Component lifecycle, supervision, safe controls, and
  Foundation static observed state.
- **Existing source reused:** Binds to stable Foundation topology IDs without
  mutating the Foundation catalog.
- **Network behavior:** None.
- **Bounds:** Defaults 128 sources, 256 reasons/nodes/bindings, 1,024 edges,
  and 256-character rendering; hard caps 1,024 sources, 4,096 reasons/nodes,
  32,768 edges, 16,384 market nodes, and 8,192 books.
- **Freshness/sequence semantics:** Every nested timestamp is bounded by its
  owning component cutoff and outer snapshot; silent/stale core sources cannot
  be green.
- **Tests:** 25 snapshot and import-purity tests.
- **Failure modes:** Required source stopped/silent/stale, rate pressure,
  focus degradation, sequence-gap storm, capture truncation, bounded view
  truncation, and future nested knowledge.
- **Future Control Plane component ID:** `runtime-component:8ed91473d866fac46c39d828`.
- **Future Health/Dashboard surface:** Canonical runtime health and dependency
  graph read model.
- **Live money authority:** **NONE**.

### Trigger capture and outcome coordinator

- **Path:** `server/src/intelligenceRuntime/capture/**`
- **Responsibility:** Bounded public-evidence pre/post-trigger capture, exact
  horizon attribution, checksums, checkpoint save/restore, and truncation truth.
- **Authoritative inputs:** Allowlisted normalized public evidence, bridge
  freeze request, outcome policies, injected storage, and clock.
- **Outputs:** Ingest/trigger/tick/checkpoint/restore receipts, capture records,
  Foundation outcome labels, and snapshot.
- **Owned state:** Bounded pre-rings, captures, horizons, trigger/ring
  tombstones, failures, and checkpoint/mutation generation.
- **Non-owned state:** Generic Foundation replay, production DB/filesystem,
  proposal/execution records, and account data.
- **Existing source reused:** Uses frozen Foundation freeze/outcome contracts;
  no second replay system is created.
- **Network behavior:** None; storage is an injected JSON port.
- **Bounds:** Defaults 2,048 rings x 256 evidence, 1,024 freeze evidence,
  4,096 post evidence/capture, 256 active, 1,024 retained, 2 MiB/evidence,
  8 MiB frozen record, and 128 MiB checkpoint.
- **Freshness/sequence semantics:** Trigger equals evidence cutoff; future data
  is rejected; horizons see only knowledge available by due time; checkpoint
  authority and checksums are revalidated.
- **Tests:** 21 capture and import-purity tests.
- **Failure modes:** Wrong authority/private/BORROW, look-ahead, truncation,
  missing required source, duplicate conflict, retention eviction, oversized
  record/checkpoint, checksum/storage/restore failure.
- **Future Control Plane component ID:** `runtime-component:b3ba5b1ec041b751ef004124`.
- **Future Health/Dashboard surface:** Active/completed/incomplete/truncated
  captures, missing sources, and checkpoint posture.
- **Live money authority:** **NONE**.

### Manual no-key public smoke

- **Path:** `server/src/intelligenceRuntime/smoke/**`
- **Responsibility:** Explicit bounded proof of public exchange information,
  broad streams, temporary focus, normalization, runtime health, and shutdown.
- **Authoritative inputs:** Manual invocation and exact public allowlisted REST/
  WebSocket transports.
- **Outputs:** Immutable `PublicNoKeySmokeResult` and step receipts.
- **Owned state:** Per-run counters, observation-window snapshots, bounded
  evidence IDs, and shutdown receipts.
- **Non-owned state:** Application startup, supervisor, credentials, account,
  strategy, and live action.
- **Existing source reused:** Composes Universe, Spot, Futures, and Snapshot.
  This is the only concrete new transport and exists solely for manual proof.
- **Network behavior:** Real public network only when manually invoked; imports
  and deterministic tests remain inert/network-free.
- **Bounds:** Default 15 seconds, configurable maximum 60 seconds; four public
  connections, 2 MiB/message, 10,000 messages/source, 512 retained evidence
  IDs, 32 steps, and 32 MiB REST response.
- **Freshness/sequence semantics:** Observation truth freezes at window close;
  shutdown grace cannot age PASS to PARTIAL and late messages are ignored.
- **Tests:** 12 smoke and import-purity/allowlist tests.
- **Failure modes:** 451/geolocation block, HTTP/socket error, early/silent
  close, semantic invalidity, message cap, and dirty shutdown.
- **Future Control Plane component ID:** None; manual acceptance artifact.
- **Future Health/Dashboard surface:** Operations/acceptance receipt only.
- **Live money authority:** **NONE**; credentials/private endpoints are
  structurally impossible in the result contract.

### Capacity and performance model

- **Path:** `server/src/intelligenceRuntime/capacity/**`
- **Responsibility:** Deterministic 452-symbol synthetic queue, lag, overload,
  focus-protection, and retained-memory model.
- **Authoritative inputs:** Canonical bounded workload plan and synthetic
  official-shaped events.
- **Outputs:** Deterministic capacity report with queue/channel/lag/focus/memory
  truth and explicit non-production caveat.
- **Owned state:** Test-local synthetic queues, reducers, lag rings, overload
  controller, and retained-graph audit.
- **Non-owned state:** Production sizing claim, supervisor, strategy, capital.
- **Existing source reused:** Exercises actual runtime Spot, Futures, lifecycle,
  focus, and memory structures rather than parallel mock managers.
- **Network behavior:** None.
- **Bounds:** Exactly 452 symbols; at most 300 seconds, 100,000 ticks,
  50,000 messages/second/channel, 1,000,000 messages, 32 bursts, 16,384 per
  queue/65,536 aggregate, 128 focus requests, 25 protected symbols, and
  1,000,000 memory nodes.
- **Freshness/sequence semantics:** Fixed injected time and canonical workload
  ID; queue loss/resync, lag percentiles, shedding, and protection are explicit.
- **Tests:** 17 capacity and import-purity tests.
- **Failure modes:** Forged plan/version, impossible counts, burst overlap,
  queue loss/resync, lag thresholds, optional shedding, and malicious retained
  graphs/config accessors.
- **Future Control Plane component ID:** None; engineering proof artifact.
- **Future Health/Dashboard surface:** Sizing/overload evidence only; no
  production capacity claim.
- **Live money authority:** **NONE**.

### Fixtures and compatibility harness

- **Path:** `server/test/intelligenceRuntime/fixtures/**` and
  `server/test/intelligenceRuntime/integration/**`
- **Responsibility:** Official-shaped, fixed-clock, network-free composition
  proof for all 18 mandated public-runtime scenarios.
- **Authoritative inputs:** Synthetic public fixtures and every runtime lane.
- **Outputs:** Evidence and runtime truth only.
- **Owned state:** Test process only.
- **Non-owned state:** Production wiring and every strategy/money authority.
- **Existing source reused:** Exercises the real runtime and frozen Foundation
  contracts through fake injected ports.
- **Network behavior:** None; import tripwires reject network/timers/randomness.
- **Bounds:** All fixtures and fake ports use the same production hard bounds.
- **Freshness/sequence semantics:** Fixed clock, exact generations, and explicit
  no-look-ahead capture.
- **Tests:** 19 integration/import-purity tests, including the 18 required
  scenarios.
- **Failure modes:** Any schema, provenance, time, capacity, or authority
  mismatch fails the harness.
- **Future Control Plane component ID:** None; test artifact.
- **Future Health/Dashboard surface:** None.
- **Live money authority:** **NONE**; no proposal, risk verdict, order plan, or
  execution action may appear.

## Singular authority boundary

- Existing Basis and Volume engines remain the only strategy/proposal owners.
- Existing ledger, account, risk, control, reconciliation, and execution owners
  remain unchanged.
- `intelligenceFoundation` remains the owner of evidence, universe, features,
  attention, thesis/forensics, outcomes, and static topology semantics.
- This runtime owns only public acquisition/adaptation, source truth, bounded
  allocation, history bootstrap, capture coordination, and a read-only snapshot.
