# LIVE INTELLIGENCE RUNTIME MAX-POWER SPRINT

**Project:** Cosmos Arbitrage Control Room  
**Date:** 2026-07-11  
**Director:** Claude Code / Fable 5  
**Builder:** one Codex 5.6 Ultra lead using bounded subagents  
**Working checkout:** `/Users/cosmosgeek/Desktop/Main`  
**Expected starting line:** completed Market Intelligence feature branch in Main; verify the actual branch and SHA before acting  
**Separate in-progress line:** `/Users/cosmosgeek/Desktop/Main-backend-foundation-20260711-070056` — read-only and completely out of scope

---

## 0. One-sentence target

Build the **live public-market runtime and adapter layer** that turns the existing Binance data sources into truthful, bounded, health-graded inputs for `server/src/intelligenceFoundation/**`, without creating another strategy engine, another control plane, another proposal queue, another ledger, any production route, or any money-moving authority.

The finished chain for this sprint is:

```text
Current Binance public sources and existing runtime feeds
→ source lifecycle / freshness / sequence truth
→ full-universe synchronization
→ broad Spot and USD-M observations
→ bounded focused depth/trade enrichment
→ historical baseline bootstrap
→ derivatives-context enrichment
→ intelligenceFoundation evidence/features/attention inputs
→ runtime snapshot + trigger capture + public no-key smoke proof
```

This sprint supplies the **nerves and blood supply** between the already-built market-intelligence organs and real public market data.

It does **not** integrate the separate backend-foundation branch, expose UI controls, place or validate orders, use private account data, or start live trading.

---

# 1. Why this is the correct third build

Three major code lines now exist or are being built:

1. **Audited Main** — the real cockpit, existing Binance/account services, existing Basis and Volume engines, risk, ledger, Health, Logs, and UI.
2. **Backend Foundation** — contracts, Control Plane, canonical read model, execution/recovery, multi-leg risk, reconciliation, exchange boundary, replay, and diagnostics in an isolated clone.
3. **Market Intelligence Foundation** — coverage truth, evidence normalization, per-symbol features, attention allocation, thesis/forensics, pre-event outcomes, and topology in the Main feature branch.

The largest independent gap that can be built while Backend Foundation is still running is the runtime layer that makes the Market Intelligence Foundation consume **real, current, bounded public market evidence**.

Do not use this sprint for another abstract framework. At the end, a standalone no-key harness must be able to demonstrate:

```text
real Binance public messages arrive
→ source ages and sequence health are measured
→ symbols are joined into one universe
→ quiet symbols remain visible
→ broad observations reach intelligence contracts
→ focus allocation requests richer streams
→ richer evidence is normalized
→ deterministic runtime snapshots and captures are produced
```

---

# 2. Start gate — protect every existing line of work

Before any edit:

1. Work only in `/Users/cosmosgeek/Desktop/Main`.
2. Confirm the Market Intelligence sprint is finished and no Codex or subagent is still writing in Main.
3. Confirm the Backend Foundation work is running only in its isolated clone and will not touch Main.
4. Run:

```bash
cd /Users/cosmosgeek/Desktop/Main
git branch --show-current
git rev-parse HEAD
git status --short
git log --oneline --decorate -20
```

5. Expected evidence from the prior acceptance report is a Market Intelligence final commit around `3340f75`. **Verify it; do not trust or invent it.**
6. Read `MARKET_INTELLIGENCE_COMPONENTS.md` and `MARKET_INTELLIGENCE_RECEIPT.md` and confirm the intelligence code really exists under `server/src/intelligenceFoundation/**`.
7. Preserve the known local input documents if they remain untracked. Do not delete, move, stash, clean, or overwrite them.
8. Run the current production build and complete repository tests once. Record the exact commands and counts.
9. Create a new branch from the verified Market Intelligence tip:

```text
live-intelligence-runtime-main-20260711
```

Add a numeric suffix if it exists.

10. If Main contains any unfamiliar tracked edit or an active writer, stop before editing and report the exact blocker.

Do not merge, rebase, reset, clean, force-push, or touch the Backend Foundation clone.

---

# 3. Minimal read order

Read only what is needed to build correctly:

1. applicable `AGENTS.md` files;
2. `MISSION.md`;
3. current-truth header and active phase of `PROJECT_MEMORY.md`;
4. `MARKET_INTELLIGENCE_COMPONENTS.md`;
5. `MARKET_INTELLIGENCE_RECEIPT.md`;
6. contracts and public APIs under `server/src/intelligenceFoundation/**`;
7. current Basis and Volume runtime/source interfaces and focused tests;
8. current read-only Binance public adapters, WebSocket wrappers, market-data services, and book-stream code;
9. package scripts and TypeScript configuration;
10. this directive.

Do not reread the entire historical journal unless a concrete source-ownership ambiguity requires it.

Before creating any source, scheduler, book, cache, or runtime, search the current codebase for an equivalent. Prefer an adapter around an authoritative existing source over a duplicate socket, timer, cache, or universe.

---

# 4. Required current external research

Before coding network semantics, research only current primary documentation and record the exact pages and access date in the receipt.

At minimum verify:

- Binance Spot WebSocket stream base URLs, combined streams, connection lifetime, ping/pong behavior, stream limits, message limits, and all-market stream semantics;
- Binance USD-M Futures **current tiered WebSocket hosts** and the 2026 legacy-host decommissioning notice;
- Spot and Futures aggregate-trade streams;
- Spot and Futures book-ticker and diff-depth streams;
- official local-order-book snapshot-plus-delta procedures;
- all-market mark-price/funding streams;
- funding history and funding-info endpoints;
- open interest and open-interest history/statistics;
- taker buy/sell volume and long/short context;
- liquidation streams;
- exchange-information and symbol-filter semantics;
- REST request-weight headers and current rate-limit behavior;
- margin `maxBorrowable` and interest-history semantics only to document the later signed boundary — no private call belongs in this sprint.

Important current anchor to verify: Binance announced that legacy USD-M Futures WebSocket URLs were permanently decommissioned on **2026-04-23** in favor of the tiered `/public`, `/market`, and `/private` model. Never copy an old tutorial URL merely because it connects.

Record discrepancies between current official documentation and existing code. Do not silently rewrite existing production sources in this sprint; expose the discrepancy in the receipt and build the new adapter against the current official contract.

---

# 5. Exclusive write territory

All new production code:

```text
server/src/intelligenceRuntime/**
```

All new deterministic tests:

```text
server/test/intelligenceRuntime/**
```

Allowed root artifacts:

```text
LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md
LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md
```

Everything else is read-only, including:

```text
web/**
server/src/index.ts
server/src/types.ts
server/src/config.ts
server/src/ledger.ts
server/src/services/**
server/src/binance/**
server/src/engine/**
server/src/foundation/**
server/src/intelligenceFoundation/**
package.json
server/package.json
package-lock.json
.env
.env.*
data/**
MISSION.md
BLUEPRINT.md
ENGINE.md
PROJECT_MEMORY.md
README.md
```

The new code may **import** authoritative existing modules and intelligence contracts. It may not edit their owners.

Only the Codex lead may stage, commit, or modify the Git index. Subagents receive exclusive directories and may not spawn writing subagents.

---

# 6. Authority map — no duplicate truths

The following ownership is mandatory:

- `server/src/intelligenceFoundation/**` owns normalized intelligence evidence, features, universe semantics, attention, thesis/forensics, outcomes, and intelligence topology.
- Existing Basis and Volume engines own strategy decisions and proposals.
- Existing Binance/runtime modules own any source that is already authoritative and working.
- Existing ledger owns durable audit truth.
- Backend Foundation owns future Control Plane, canonical execution, risk, reconciliation, generic replay, and diagnostics contracts.
- This sprint owns only:
  - runtime acquisition from public market sources;
  - source lifecycle, sequence, freshness, lag, and rate-budget truth;
  - adapters into intelligence contracts;
  - bounded broad-versus-focused data allocation;
  - historical bootstrap scheduling;
  - runtime capture coordination through injected storage ports;
  - render-ready runtime snapshots;
  - a manual public no-key smoke harness.

This sprint must not create:

- another Basis engine;
- another Volume engine;
- another candidate scoring language when the intelligence foundation already supplies it;
- another proposal queue;
- another risk engine;
- another execution coordinator;
- another ledger or production database;
- another global market cache competing with existing state;
- another Control Plane;
- another generic replay system that overlaps Backend Foundation.

When current source code already provides a feed, write a narrow adapter. Create a new transport only for a genuinely missing source and document why reuse was impossible.

---

# 7. Hard safety and anti-garbage rules

1. No live orders.
2. No test orders.
3. No order cancellation or replacement.
4. No private account endpoints.
5. No borrow, repay, transfer, withdrawal, leverage, collateral, or margin-mode action.
6. No API key, secret, `.env`, AWS credential, private payload, or production database access.
7. All default and deterministic tests are network-free.
8. Production adapters may perform public network I/O only after explicit construction and `start()`; imports must be pure.
9. No timer, socket, file write, or process starts at module import.
10. Every queue, ring, cache, map, and retained history is bounded.
11. Every dropped/coalesced event is counted and explained; no silent loss.
12. Source event time, local receive time, processing time, and snapshot time remain distinct.
13. A connected socket with no current messages is degraded or failed, never healthy.
14. Missing data remains `UNKNOWN`, `UNAVAILABLE`, or a named failure — never zero.
15. The runtime must continue broad observation when one optional enrichment source fails.
16. Focused enrichment may never silently remove an active-capital symbol supplied through a protected-symbol port.
17. No fabricated confidence, pump probability, profitability, or tradeability verdict.
18. No UI, API route, server startup hook, package dependency, deployment, or process-manager change.
19. No generated line padding, TODO-only modules, fake-success results, generic manager classes, or duplicated engines.
20. A module counts only if it compiles and has deterministic success and failure proofs.

---

# 8. Required runtime contracts

Use the frozen `intelligenceFoundation` contracts directly wherever possible.

Create only runtime-local ports that are not already represented, such as:

```text
RuntimeClock
PublicRestTransport
PublicWebSocketTransport
SourceLifecyclePort
SourceEventSink
RuntimeMetricSink
CaptureStoragePort
BaselineCheckpointPort
ProtectedSymbolPort
ManualSmokeReporter
```

Runtime-local ports must not redefine:

- authority/provenance;
- instrument identity;
- evidence envelopes;
- feature values;
- attention tiers;
- thesis packets;
- outcome labels;
- stable failure records;
- topology descriptors.

If the intelligence contract lacks a field that production data genuinely requires, do not edit it in a worker lane. Return a narrowly documented contract-change request to the lead. The lead may either adapt locally without loss or stop and report the incompatibility for convergence.

---

# 9. WAVE 0 — lead-owned capability and source map

Before writing workers:

## 9.1 Inventory authoritative current sources

Create an in-memory capability matrix with:

```text
capability
existing owner/path
current transport
current authority
current event time
current receive time
freshness behavior
sequence behavior
broad or focused
reuse/adapt/new decision
known defect
```

Inventory at minimum:

- Spot exchange information;
- Futures exchange information;
- all-symbol Spot price/ticker state;
- all-symbol Futures price/book state;
- mark/index/funding state;
- Spot aggregate trades;
- Futures aggregate trades;
- Spot depth;
- Futures depth;
- klines/history;
- open interest;
- taker buy/sell context;
- long/short context;
- liquidations;
- current Basis runtime source ports;
- current Volume runtime source ports;
- account/borrow sources, marked out of scope here.

## 9.2 Freeze source IDs and lifecycle vocabulary

Create a small lead-owned runtime kernel under:

```text
server/src/intelligenceRuntime/contracts/**
server/test/intelligenceRuntime/contracts/**
```

Required lifecycle states:

```text
STOPPED
CONNECTING
WARMING
LIVE
SILENT
STALE
DEGRADED
BACKING_OFF
RATE_LIMITED
FAILED
```

Each source snapshot must expose:

```text
stable source ID
transport kind
desired state
observed state
connection generation
connectedAt
lastMessageSourceTime
lastMessageReceiveTime
lastProcessedTime
messageAgeMs
processingLagMs
message count
invalid count
duplicate count
out-of-order count
sequence-gap count
dropped/coalesced count
reconnect count
backoff state
rate-budget state
last error
recommended action
authority/completeness
```

Tests must prove stable serialization, injected time, invalid timestamp rejection, state transitions, silent-socket detection, and import purity.

Commit Wave 0 before parallel source work begins.

---

# 10. WAVE 1 — broad universe and source lifecycle

Run bounded agents only after Wave 0 is frozen.

## Lane A — Universe source adapter

Path:

```text
server/src/intelligenceRuntime/universe/**
server/test/intelligenceRuntime/universe/**
```

Build a runtime adapter that:

- consumes current Spot and USD-M exchange-information responses through injected transports;
- joins them into the existing intelligence universe contracts;
- preserves every supported quiet symbol;
- distinguishes visibility, data coverage, focus eligibility, and tradeability;
- handles symbol status changes, delists, new listings, aliases, contract changes, and missing Spot or Perpetual legs;
- preserves price, quantity, notional, tick, step, and contract metadata as evidence rather than assumptions;
- emits deterministic universe diffs and a complete snapshot;
- refreshes only when explicitly ticked by the runner;
- never performs an implicit poll at import.

Tests: initial join, quiet symbol retained, listing, delisting, status change, duplicate alias, missing leg, contract metadata change, stale source, partial refresh, deterministic diff.

## Lane B — Broad Spot adapter

Path:

```text
server/src/intelligenceRuntime/spot/**
server/test/intelligenceRuntime/spot/**
```

Adapter-first requirements:

- reuse current authoritative Spot market feeds where possible;
- normalize broad all-symbol price/ticker/book observations into intelligence evidence;
- use aggregate trades only where broad transport and budget make it justified;
- preserve source/receive timestamps and explicitly mark streams with no exchange event time;
- detect duplicates, malformed numeric fields, stale symbols, silent global streams, partial arrays, and source-wide gaps;
- expose backpressure and coalescing policy;
- never relabel 24-hour volume as 1-second, 5-second, or 1-minute activity;
- never silently exclude dormant symbols because no ticker changed in the latest payload.

Tests: full array, changed-symbol-only array, missing event time, duplicate update, stale one-symbol state, silent connection, backpressure, malformed value, reconnect generation, deterministic normalization.

## Lane C — Broad USD-M Futures adapter

Path:

```text
server/src/intelligenceRuntime/futures/**
server/test/intelligenceRuntime/futures/**
```

Build current-protocol adapters for:

- all-symbol Futures book/ticker state;
- all-market mark/index/funding state;
- contract status and symbol identity;
- optional broad liquidation context where current official streams support it.

Requirements:

- use the current tiered Futures WebSocket model;
- correctly separate USD-M from any merged COIN-M payload using current official fields;
- treat a socket that accepts but emits no useful messages as `SILENT`/`STALE`;
- preserve event time and receive time;
- expose funding interval and next funding time when supplied;
- distinguish mark, index, last, bid, and ask;
- never infer executable basis from mark price alone.

Tests: USD-M filter, merged-universe payload, mark/funding update, missing event time, stale symbol, silent connection, reconnect, malformed price, partial payload, deterministic normalization.

## Lane D — Connection lifecycle, backpressure, and rate budget

Path:

```text
server/src/intelligenceRuntime/lifecycle/**
server/test/intelligenceRuntime/lifecycle/**
```

Build reusable deterministic components for:

- explicit start/stop;
- connection generation and scheduled rotation;
- ping/pong/heartbeat handling through injected transport events;
- exponential backoff with injected jitter source;
- maximum retry ceilings and cooldown;
- message-arrival health independent of socket-open state;
- bounded inbound queue;
- coalescing for replaceable state updates;
- no coalescing for sequence-sensitive depth updates;
- subscription/control-message throttling;
- REST request-weight budget tracking from returned headers;
- per-source and global processing-lag metrics;
- graceful shutdown and cleanup.

No real timer may be hidden. The runner supplies clock/tick calls or injected schedulers.

Tests: normal connect, silent socket, 24-hour-style rotation simulation, reconnect storm, backoff reset, rate-limit response, budget recovery, queue overflow, state coalescing, depth no-coalesce, stop during backoff, deterministic repeated run.

---

# 11. WAVE 2 — focused enrichment and history

## Lane E — Focus subscription planner and stream allocator

Path:

```text
server/src/intelligenceRuntime/focus/**
server/test/intelligenceRuntime/focus/**
```

Consume the existing intelligence attention plan through an injected port.

Build:

- mapping from requested evidence to concrete current Spot/Futures streams;
- bounded stream and connection allocation;
- deterministic subscribe/unsubscribe batches;
- control-message rate enforcement;
- warm-up and readiness state;
- hysteresis/cooldown to avoid churn;
- protected-symbol handling for active capital supplied later;
- fallback when one venue/source is unavailable;
- explicit reasons for unfulfilled enrichment requests;
- no strategy scoring and no proposal generation.

Tests: promotion, demotion, same-priority tie, budget exhaustion, control-rate limit, focus thrash, failed source, protected symbol, partial evidence, reconnect replay, deterministic allocation.

## Lane F — Local order-book builders

Path:

```text
server/src/intelligenceRuntime/books/**
server/test/intelligenceRuntime/books/**
```

Build bounded Spot and Futures local-book reducers using injected REST snapshots and diff streams.

Required behavior:

- official snapshot-plus-delta sequencing;
- pre-snapshot buffering with strict bounds;
- duplicate/out-of-order/gap detection;
- automatic invalidation and explicit resync request;
- crossed/impossible-book detection;
- bid/ask, spread, depth-at-distance, book slope, imbalance, replenishment/depletion evidence;
- intended-size slippage query;
- source and receive times;
- book age and completeness;
- no individual-order identity claims;
- no hidden network call inside the reducer.

Tests: correct bootstrap, buffered deltas, duplicate, out-of-order, sequence gap, crossed book, resync, bound exceeded, depth metrics, slippage query, stale book, deterministic replay.

## Lane G — Historical baseline bootstrap scheduler

Path:

```text
server/src/intelligenceRuntime/baseline/**
server/test/intelligenceRuntime/baseline/**
```

Build a resumable, request-budget-aware bootstrap engine for completed public history supplied by current REST adapters.

Requirements:

- per-symbol and per-feature bootstrap plans;
- 1m and longer completed kline/history support where current endpoints permit;
- no contamination from an incomplete current candle unless explicitly marked;
- bounded parallelism;
- request-weight accounting;
- retry/backoff and partial completion;
- persisted checkpoint through an injected port, not direct production disk access;
- feature/version identity;
- listing-age awareness;
- honest `INSUFFICIENT_HISTORY`, `PARTIAL`, `STALE`, and `COMPLETE` states;
- prioritized bootstrap for focused symbols without starving universe coverage.

Tests: cold start, resume, partial history, delisted symbol, short listing age, rate-limit pause, retry, focused priority, no starvation, incomplete candle, deterministic plan.

## Lane H — Derivatives-context enrichment

Path:

```text
server/src/intelligenceRuntime/derivatives/**
server/test/intelligenceRuntime/derivatives/**
```

Build cached, TTL-bound, request-budgeted public enrichers for current available context:

- open interest;
- open-interest statistics/history;
- funding history and funding-info context;
- taker buy/sell volume;
- global/top-trader long/short context when current access permits;
- liquidation context;
- optional ADL/insurance/context facts only when current official data clearly supports the intended interpretation.

Each fact must expose:

```text
source
source time
receive time
TTL
availability
completeness
request cost
last error
```

Unavailable or API-key-gated context remains unavailable. Do not invent it, substitute zero, or weaken the entire broad public runtime because one optional context endpoint is unavailable.

Tests: fresh fact, TTL expiry, rate limit, permission/API-key-required response, partial symbol coverage, stale cache, source disagreement, zero versus unknown, deterministic refresh plan.

---

# 12. WAVE 3 — intelligence bridge, capture, and runtime truth

## Lane I — IntelligenceFoundation bridge

Path:

```text
server/src/intelligenceRuntime/bridge/**
server/test/intelligenceRuntime/bridge/**
```

Build the narrow composition layer that:

- maps broad and focused runtime events into existing evidence contracts;
- updates the existing universe reducer;
- feeds the existing feature bank with correct windows and event times;
- obtains attention plans without mutating the strategy engines;
- requests focused enrichment;
- builds thesis/forensics inputs when evidence is sufficient;
- emits outcome-freeze requests at trigger points;
- preserves correlation IDs from source → evidence → feature → attention → thesis;
- exposes stable snapshots for a later canonical read model;
- consumes optional Basis/Volume hints through injected ports;
- never creates, accepts, rejects, queues, or executes a trade proposal.

Tests: broad event path, focus path, stale source, missing Futures, one-print noise, full thesis input, correlation continuity, repeated deterministic output, no input mutation, bounded memory.

## Lane J — Trigger capture and live outcome collection coordinator

Path:

```text
server/src/intelligenceRuntime/capture/**
server/test/intelligenceRuntime/capture/**
```

Coordinate existing intelligence outcome contracts with an injected capture storage port.

Required behavior:

- pre-trigger bounded ring buffers by symbol/source;
- trigger-time freeze;
- configurable post-trigger windows;
- later horizon observations;
- no-look-ahead separation;
- capture completeness and truncation markers;
- checksums and stable IDs;
- source/version identities;
- bounded retention and eviction;
- recovery from a persisted capture checkpoint supplied through an injected port;
- no direct production DB or filesystem writes.

Do not duplicate the Backend Foundation generic replay engine. This module owns only live intelligence capture coordination and maps into the existing intelligence outcome records.

Tests: pre/post capture, trigger freeze, future-data rejection, truncation, eviction, restart checkpoint, duplicate trigger, incomplete horizon, checksum, deterministic output.

## Lane K — Runtime snapshot and topology adapter

Path:

```text
server/src/intelligenceRuntime/snapshot/**
server/test/intelligenceRuntime/snapshot/**
```

Produce one render-ready read model for later Control Plane/Health/Dashboard integration.

Expose:

- broad universe count and coverage;
- source lifecycle and message age;
- Spot/Futures/mark/funding coverage;
- focused symbol count and requested versus delivered evidence;
- baseline completion;
- sequence gaps and resyncs;
- queue depth, processing lag, drops/coalesces;
- REST weight budget;
- capture state;
- last success and error;
- blocking versus warning reasons;
- desired/observed state;
- stable component topology nodes and typed edges compatible with the intelligence topology model.

This is a read model, not a supervisor. It cannot start, stop, restart, or mutate components.

Tests: healthy, warming, silent stream, stale source, rate limited, degraded focused evidence, sequence-gap storm, capture truncation, deterministic aggregate health.

## Lane L — Public no-key smoke harness

Path:

```text
server/src/intelligenceRuntime/smoke/**
server/test/intelligenceRuntime/smoke/**
```

Create an explicit, manually invoked, no-key public smoke program. It must never run as part of normal unit tests or application startup.

The smoke should run for a bounded duration and prove as many of these as current public availability permits:

1. Spot and Futures exchange information load;
2. universe join succeeds;
3. broad Spot messages arrive;
4. broad Futures messages arrive;
5. mark/funding messages arrive;
6. message age advances correctly;
7. one or more symbols can be promoted into temporary focus without a strategy proposal;
8. focused aggregate trade or depth evidence arrives;
9. normalized intelligence evidence is produced;
10. the final runtime snapshot reports exact source health and gaps;
11. no private endpoint or credential is used;
12. shutdown closes every transport cleanly.

A blocked network, geolocation restriction, HTTP 451, or unavailable optional source is an honest smoke result. It must not fail deterministic unit tests or become fake green.

## Lane M — Capacity and performance model

Path:

```text
server/src/intelligenceRuntime/capacity/**
server/test/intelligenceRuntime/capacity/**
```

Build deterministic load/capacity proofs using synthetic events:

- 452-symbol broad state;
- configurable message rates;
- bounded focus tiers;
- depth/trade burst handling;
- queue and coalescing behavior;
- memory-bound estimates from actual retained structures;
- processing-lag percentiles;
- overload degradation rules;
- optional-source shedding before core broad observation;
- active-capital protection.

Do not claim production capacity from synthetic tests alone. Report the model assumptions and measured local results separately.

---

# 13. Lead-owned compatibility harness

Path:

```text
server/test/intelligenceRuntime/integration/**
server/test/intelligenceRuntime/fixtures/**
```

Using injected fake transports and clocks, prove:

```text
Spot/Futures metadata
→ full universe
→ broad source events
→ source health
→ normalized evidence
→ feature update
→ early candidate evidence
→ attention allocation
→ focused stream plan
→ depth/trade enrichment
→ thesis/forensics input
→ trigger capture
→ runtime/topology snapshot
```

Required scenarios:

1. all sources healthy and advancing;
2. dormant symbol remains quiet;
3. persistent Spot-led wakeup is promoted;
4. one isolated large print is not promoted;
5. Spot leads while Futures lags;
6. Futures/OI/liquidation context leads;
7. market-wide move is distinguished from symbol-specific behavior;
8. broad socket open but silent;
9. stale Spot with fresh Futures;
10. stale Futures with fresh Spot;
11. duplicate and out-of-order event;
12. depth sequence gap and resync;
13. focus budget exhaustion and deterministic replacement;
14. protected symbol survives eviction pressure;
15. REST rate limit pauses optional enrichment;
16. partial baseline remains partial;
17. capture is frozen without future leakage;
18. shutdown is complete and import remains side-effect-free.

The output must contain evidence and runtime truth only. It must not contain a trade proposal, risk approval, order plan, or execution action.

---

# 14. Testing and verification

Every deterministic test must:

- use an injected/fixed clock;
- use synthetic official-shaped fixtures;
- use no real network;
- use no environment variable or credential;
- use no production database;
- use no nondeterministic ID or hidden random value;
- fail on fabricated zeroes;
- fail on unbounded retention;
- fail on import-time side effects;
- fail on accidental strategy/proposal/execution authority.

After each checkpoint:

1. build the server;
2. run the new focused tests;
3. run all Market Intelligence tests;
4. run existing Basis and Volume proofs;
5. run the complete current repository suite;
6. run `git diff --check`;
7. inspect changed paths.

The manual no-key smoke is separate. Run it only after deterministic gates pass and only when the environment allows public Binance access.

---

# 15. Required manifests and receipt

Create `LIVE_INTELLIGENCE_RUNTIME_COMPONENTS.md`.

For every component record:

```text
path
responsibility
authoritative inputs
outputs
owned state
non-owned state
existing source reused
network behavior
bounds
freshness/sequence semantics
tests
failure modes
future Control Plane component ID
future Health/Dashboard surface
live money authority: NONE
```

Create `LIVE_INTELLIGENCE_RUNTIME_RECEIPT.md` containing:

- starting branch and SHA;
- expected versus actual Market Intelligence tip;
- checkpoint commits;
- agents/lanes used;
- current official Binance pages researched and access date;
- capability map and reuse decisions;
- modules built and skipped;
- exact files;
- public source behavior;
- focused test counts;
- compatibility scenarios;
- existing repository/Basis/Volume/Market Intelligence results;
- deterministic no-network proof;
- import-purity proof;
- no-secret/no-private-endpoint/no-money-action proof;
- bounded-memory/backpressure proof;
- optional manual public smoke result;
- every source unavailable, stale, or blocked during smoke;
- files changed outside scope, expected none;
- exact future integration seams;
- honest remaining gaps;
- final SHA and tree status.

Keep the receipt concise and factual. Do not repeat project history or paste large code excerpts.

---

# 16. Priority if capacity ends

Finish in this order:

1. Wave 0 runtime contracts and capability map;
2. lifecycle/backpressure/rate budget;
3. universe adapter;
4. broad Spot and Futures adapters;
5. intelligence bridge;
6. focus allocator;
7. local books;
8. baseline bootstrap;
9. derivatives enrichment;
10. runtime snapshot;
11. capture coordinator;
12. compatibility harness;
13. manual public smoke;
14. capacity model;
15. manifest and receipt.

Never leave a half-implemented lane in the final commit. A lane counts only when it compiles, passes its focused tests, and appears accurately in the receipt. Remove only your own incomplete lane if necessary; never delete earlier project work.

---

# 17. Acceptance gate

Do not claim completion unless:

- the work began from the verified Market Intelligence tip;
- no second writer touched Main;
- all changed production files are under `server/src/intelligenceRuntime/**`;
- all changed tests are under `server/test/intelligenceRuntime/**`;
- only the two allowed root receipts were added;
- existing `intelligenceFoundation` files were not changed;
- existing Basis/Volume engines and runtime services were not changed;
- Backend Foundation was not touched;
- no route, startup hook, UI, package, config, ledger, data, or deployment file changed;
- every implemented module has meaningful deterministic success/failure tests;
- imports have no side effects;
- every retained structure is bounded;
- source event time and receive time remain separate;
- silent sockets and stale sources cannot be green;
- quiet symbols remain visible in the broad universe;
- broad and focused work are budgeted separately;
- no optional enrichment failure kills core observation;
- no private endpoint, key, order, borrow, transfer, or live-money action exists;
- no proposal, risk verdict, order plan, or execution authority was duplicated;
- all existing and new required suites pass;
- optional public smoke results are reported honestly;
- component manifest and receipt match Git and test evidence;
- all work is committed on the feature branch;
- the working tree is clean except explicitly preserved input documents;
- nothing is merged into `current-main` or pushed unless the owner separately authorizes it.

---

# 18. What this sprint delivers to the owner

After this sprint, the project should own a tested runtime that can be connected later so the owner can see:

- whether every broad market source is actually delivering current messages;
- how much of the Binance universe is visible;
- which symbols are warming, live, stale, or missing evidence;
- which candidates received deeper attention and why;
- whether depth/trade/derivatives enrichment was fulfilled;
- whether baselines are complete;
- whether sequence gaps, lag, rate limits, or overload are degrading the result;
- what evidence reached the intelligence layer;
- what was captured before and after an event;
- and exactly what would block downstream trust.

It still will not trade. It will make the intelligence layer **real-data ready** and make later convergence materially smaller.

---

# 19. What remains after this sprint

Do not expand this task into the following dependent work:

1. reconcile Market Intelligence and Backend Foundation contract languages;
2. integrate Foundation checkpoints onto audited Main;
3. connect the new runtime as a managed Control Plane component;
4. connect one canonical candidate/opportunity funnel;
5. build proposal-to-economic-plan conversion;
6. build capital allocation and staged sizing;
7. connect multi-leg risk and execution in blocked/validate-only mode;
8. add durable active-position checkpoints and restart reconciliation;
9. build active-position gap/funding/borrow/PnL/exit supervision;
10. add emergency hedge/unwind authority;
11. add actual signed Spot/Futures/borrow adapters;
12. expose authenticated status/control APIs and versioned configuration history;
13. make the existing cockpit render the truthful dependency graph and controls;
14. deploy read-only to EC2 with external process supervision;
15. collect live outcomes and calibrate features;
16. only after all prior gates, validate the smallest manually approved exchange-valid trade.

The next whole-system task after Backend Foundation finishes is **Convergence and Vertical Slice Integration**, led by Fable/Claude and implemented by Codex in a fresh integration worktree.

---

# 20. Director instruction for Claude Code / Fable 5

Give Claude Code this file and this instruction:

> Act as director, not the primary coder. Work against `/Users/cosmosgeek/Desktop/Main` only after verifying the completed Market Intelligence branch is clean and no writer remains. Read `LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md`, the two Market Intelligence receipts, and the actual source map. Create the new runtime feature branch required by the directive, then launch one Codex 5.6 Ultra lead in that branch. Codex owns construction and may use bounded subagents with exclusive directories. You own scope, collision prevention, checkpoint review, acceptance evidence, and the final receipt. Do not touch the separate Backend Foundation clone, do not integrate branches, and do not let Fable workers implement the lanes themselves. Stop only for a real source-of-truth conflict or safety blocker.

Claude must monitor that Codex does not replace existing market sources merely because writing a fresh socket is easier.

---

# 21. Exact first message for the Codex lead

> Execute `LIVE_INTELLIGENCE_RUNTIME_MAX_POWER_SPRINT.md` completely as the lead builder inside `/Users/cosmosgeek/Desktop/Main`. Start by verifying the completed Market Intelligence branch/SHA, proving no writer is active, recording the baseline build/tests, and creating the required `live-intelligence-runtime-main-20260711` feature branch. Build only under `server/src/intelligenceRuntime/**` and `server/test/intelligenceRuntime/**`, plus the two allowed receipts. Inventory and adapt existing authoritative public sources before creating any transport. Use current official Binance documentation, injected clocks/transports, bounded queues and memory, network-free deterministic tests, and an explicit optional no-key public smoke. Do not edit or duplicate existing engines, intelligenceFoundation, foundation, routes, services, Binance owners, ledger, UI, packages, config, secrets, data, or deployment. Do not create proposals, risk verdicts, execution plans, private calls, or money actions. Continue through as many priority lanes as capacity permits, checkpoint only complete tested lanes, run every acceptance gate, commit the result, and report exact SHAs and remaining seams.

---

# 22. Final response format

```text
LIVE INTELLIGENCE RUNTIME SPRINT — RESULT

Starting branch:
Starting SHA:
Ending branch:
Ending SHA:
Market Intelligence tip verified:
Backend Foundation touched:
Capability map:
Existing sources reused:
New adapters built:
Runtime components completed:
Components skipped:
Focused tests:
Compatibility harness:
Existing repository tests:
Basis tests:
Volume tests:
Market Intelligence tests:
Public no-key smoke:
Source/sequence/freshness findings:
Bounds/backpressure findings:
Secrets/private endpoints touched:
Money actions added:
Files outside scope:
Manifest:
Receipt:
Working-tree status:
Push status:
Exact future integration seams:
Next convergence action:
```

Do not report success by line count. Report real source coverage, runtime behavior, tests, limits, and exact gaps.

---

# 23. Final definition of success

This sprint succeeds when the project has a reusable, independently tested public-market runtime that can feed the Market Intelligence Foundation with truthful live evidence and can later be supervised by Backend Foundation without either branch being rewritten.

It is successful if it makes later convergence narrower, source health visible, full-universe monitoring bounded, focused enrichment deliberate, and every missing or stale fact explicit.

It is not successful merely because sockets connect, files are numerous, or tests are numerous.
